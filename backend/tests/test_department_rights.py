"""Departments, their heads and members are the organisation's structure (a department head can be asked to approve documents):
creating, changing or deleting a department and adding or removing its members needs admin:organization:edit (an administrator
holds it); reading them needs only a sign-in. Over HTTP through the mounted /vuln-management router, on in-memory SQLite."""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from grc.modules.vuln_management.router import router  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402

PLAIN, ADMIN, HOLDER, STAFF = 1, 2, 3, 4

# every route that changes a department or its members, with a body it would accept
CHANGES = [
    ("post", "/vuln-management/departments", {"json": {"name": "Finance", "code": "FIN", "department_head_user_id": PLAIN}}),
    ("put", "/vuln-management/departments/10", {"json": {"department_head_user_id": PLAIN}}),
    ("post", "/vuln-management/departments/10/members", {"json": {"user_id": PLAIN, "role": "head"}}),
    ("delete", f"/vuln-management/departments/10/members/{STAFF}", {}),
    ("delete", "/vuln-management/departments/10", {}),
]


@pytest.fixture
def w():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    for uid, name in [(PLAIN, "plain"), (ADMIN, "ada"), (HOLDER, "holder"), (STAFF, "staff")]:
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title()))
    db.add(m.Role(id=1, tenant_id=1, name="Administrator"))
    db.add(m.Role(id=2, tenant_id=1, name="Organisation editors"))
    db.add(m.Permission(id=1, name="admin:organization:edit", resource="admin:organization", action="edit"))
    db.add(m.RolePermission(role_id=2, permission_id=1))
    db.add(m.UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    db.add(m.UserRole(user_id=HOLDER, role_id=2, tenant_id=1))
    db.add(m.GRCDepartment(id=10, tenant_id=1, name="IT", code="IT", department_head_user_id=STAFF))
    db.add(m.GRCDepartmentMember(department_id=10, user_id=STAFF, role="head"))
    db.commit()
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[m.get_db] = lambda: db
    http = TestClient(app)

    def as_(uid):
        http.headers["Authorization"] = "Bearer " + create_access_token({"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        return http

    yield db, as_
    db.close()


def test_a_plain_user_may_read_departments_but_change_nothing(w):
    db, as_ = w
    http = as_(PLAIN)
    for method, path, kw in CHANGES:
        r = getattr(http, method)(path, **kw)
        assert (r.status_code, r.json()["detail"]) == (403, "Permission denied"), (method, path, r.text)
    db.expire_all()
    dept = db.get(m.GRCDepartment, 10)
    assert (dept.name, dept.is_active, dept.department_head_user_id) == ("IT", True, STAFF)
    assert db.query(m.GRCDepartment).count() == 1
    assert [(x.user_id, x.role, x.is_active) for x in db.query(m.GRCDepartmentMember)] == [(STAFF, "head", True)]
    assert [d["name"] for d in http.get("/vuln-management/departments").json()] == ["IT"]
    assert http.get("/vuln-management/departments/10").json()["department_head_user_id"] == STAFF


@pytest.mark.parametrize("who", [ADMIN, HOLDER])
def test_an_administrator_or_a_role_with_the_right_may_change_them(w, who):
    db, as_ = w
    http = as_(who)
    for method, path, kw in CHANGES:
        r = getattr(http, method)(path, **kw)
        assert r.status_code in (200, 201), (method, path, r.text)
    db.expire_all()
    assert db.query(m.GRCDepartment).filter_by(code="FIN").one().department_head_user_id == PLAIN
    dept = db.get(m.GRCDepartment, 10)
    assert (dept.department_head_user_id, dept.is_active) == (PLAIN, False)
    members = {x.user_id: (x.role, x.is_active) for x in db.query(m.GRCDepartmentMember).filter_by(department_id=10)}
    assert members == {PLAIN: ("head", True), STAFF: ("head", False)}
