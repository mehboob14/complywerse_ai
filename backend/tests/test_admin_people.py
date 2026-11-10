"""Administration > Users and Roles: what the redesigned pages rely on. In-memory SQLite.

* GET /admin/users and GET /admin/roles keep their payloads and now answer with a fixed number of queries (they used to run one or two per row).
* A person can be deactivated and reactivated with the field the server already takes (PUT is_active); a deactivated person's token is refused.
* A role needs a real name: blank and over-long names are refused (the page already asks for one), a name is stored trimmed.
"""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from grc.routers.admin_router import get_tenant_db, router as admin_routes  # noqa: E402
from grc.routers.auth_router import create_access_token, router as auth_routes  # noqa: E402

ADMIN_ROLE, AUDITORS = 10, 11


@pytest.fixture
def w():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    db.add(m.GRCUser(id=1, username="boss", email="boss@acme.test", display_name="Boss", is_active=True))
    db.add(m.Role(id=ADMIN_ROLE, tenant_id=1, name="Administrator", is_system_role=True))
    db.add(m.Role(id=AUDITORS, tenant_id=1, name="Auditors"))
    for pid, name in [(1, "governance:documents:view"), (2, "governance:documents:edit")]:
        db.add(m.Permission(id=pid, name=name, resource=name.rsplit(":", 1)[0], action=name.rsplit(":", 1)[1]))
        db.add(m.RolePermission(role_id=AUDITORS, permission_id=pid))
    db.commit()

    app = FastAPI()
    app.include_router(auth_routes)
    app.include_router(admin_routes)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[get_tenant_db] = lambda: db
    http = TestClient(app)

    def as_(uid):
        token = create_access_token({"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        http.headers["Authorization"] = f"Bearer {token}"
        return http

    def add_people(n, start=100):
        for i in range(start, start + n):
            db.add(m.GRCUser(id=i, username=f"p{i}", email=f"p{i}@acme.test", display_name=f"Person {i}", is_active=i % 5 != 0))
            db.add(m.UserRole(user_id=i, role_id=AUDITORS, tenant_id=1, source=None))
            if i % 3 == 0:
                db.add(m.UserRole(user_id=i, role_id=ADMIN_ROLE, tenant_id=1, source="app:salesforce"))   # a connector's link: never listed
        db.commit()

    def count(fn):
        seen = []
        listener = lambda conn, cursor, statement, parameters, context, executemany: seen.append(statement)  # noqa: E731
        event.listen(engine, "before_cursor_execute", listener)
        try:
            return fn(), len(seen)
        finally:
            event.remove(engine, "before_cursor_execute", listener)

    yield SimpleNamespace(db=db, as_=as_, add_people=add_people, count=count, user=lambda uid: db.get(m.GRCUser, uid))
    db.close()


def test_the_user_list_keeps_its_payload_and_its_query_count_does_not_grow_with_the_people(w):
    http = w.as_(1)
    w.add_people(3)
    small, few = w.count(lambda: http.get("/admin/users"))
    assert small.status_code == 200
    w.add_people(40, start=200)
    big, many = w.count(lambda: http.get("/admin/users"))
    assert len(big.json()) == 44 and many == few
    row = next(u for u in big.json() if u["id"] == 102)
    assert set(row) == {"id", "username", "email", "display_name", "is_active", "created_at", "last_login", "roles"}
    assert row["roles"] == [{"id": AUDITORS, "name": "Auditors"}], "only the roles the platform gave, a connector's link is not listed"
    assert next(u for u in big.json() if u["id"] == 205)["is_active"] is False, "inactive people are in the list (the page's Inactive chip counts them)"
    assert next(u for u in big.json() if u["id"] == 1)["roles"] == []
    assert [u["id"] for u in big.json()] == sorted(u["id"] for u in big.json()), "in account order"


def test_the_role_list_keeps_its_payload_counts_platform_given_people_only_and_does_not_query_per_role(w):
    http = w.as_(1)
    w.add_people(6)
    first, few = w.count(lambda: http.get("/admin/roles"))
    for i in range(30):
        w.db.add(m.Role(id=300 + i, tenant_id=1, name=f"Role {i}"))
    w.db.commit()
    again, many = w.count(lambda: http.get("/admin/roles"))
    assert many == few
    roles = {r["name"]: r for r in again.json()}
    assert set(roles["Auditors"]) == {"id", "name", "description", "is_system_role", "user_count", "permissions", "created_at"}
    assert roles["Auditors"]["permissions"] == ["governance:documents:view", "governance:documents:edit"]
    assert roles["Auditors"]["user_count"] == 6
    assert roles["Administrator"]["user_count"] == 0, "a connector's link to the Administrator role is not a person holding it"
    assert roles["Role 3"]["user_count"] == 0 and roles["Role 3"]["permissions"] == []
    assert [r["id"] for r in again.json()] == sorted(r["id"] for r in again.json()), "in role order"


def test_a_person_is_deactivated_and_reactivated_with_is_active_and_a_deactivated_token_is_refused(w):
    w.add_people(1)
    assert w.as_(1).put("/admin/users/100", json={"is_active": False}).status_code == 200
    assert next(u for u in w.as_(1).get("/admin/users").json() if u["id"] == 100)["is_active"] is False
    assert w.as_(100).get("/admin/roles").status_code == 403, "an inactive account is refused whatever it asks"
    assert w.as_(1).put("/admin/users/100", json={"is_active": True}).status_code == 200
    assert next(u for u in w.as_(1).get("/admin/users").json() if u["id"] == 100)["is_active"] is True
    # changing the status alone leaves the roles as they were
    assert next(u for u in w.as_(1).get("/admin/users").json() if u["id"] == 100)["roles"] == [{"id": AUDITORS, "name": "Auditors"}]


def test_a_role_needs_a_real_name_stored_trimmed(w):
    http = w.as_(1)
    assert http.post("/admin/roles", json={"name": "   ", "permission_names": []}).status_code == 400
    assert http.post("/admin/roles", json={"name": "", "permission_names": []}).status_code == 400
    long = http.post("/admin/roles", json={"name": "x" * 101, "permission_names": []})
    assert long.status_code == 400 and "100" in long.json()["detail"]
    ok = http.post("/admin/roles", json={"name": "  Reviewers  ", "permission_names": ["governance:documents:view"]})
    assert ok.status_code == 201
    role_id = ok.json()["role"]["id"]
    assert ok.json()["role"]["name"] == "Reviewers"
    assert http.post("/admin/roles", json={"name": "Reviewers"}).status_code == 400, "the name is taken (as before)"
    assert http.put(f"/admin/roles/{role_id}", json={"name": "  "}).status_code == 400
    assert http.get(f"/admin/roles/{role_id}").json()["name"] == "Reviewers", "a refused rename changes nothing"
    assert http.put(f"/admin/roles/{role_id}", json={"description": "Reads"}).status_code == 200, "a change that leaves the name alone needs no name"
    assert http.put(f"/admin/roles/{ADMIN_ROLE}", json={"name": "Boss"}).status_code == 400, "the Administrator role still cannot be changed"


def test_a_role_keeps_a_permission_name_the_catalogue_does_not_list_when_the_whole_list_is_sent_back(w):
    http = w.as_(1)
    made = http.post("/admin/roles", json={"name": "Odd", "permission_names": ["legacy:thing:view", "governance:documents:view"]}).json()["role"]["id"]
    held = http.get(f"/admin/roles/{made}").json()["permissions"]
    assert sorted(held) == ["governance:documents:view", "legacy:thing:view"]
    assert http.put(f"/admin/roles/{made}", json={"permission_names": held + ["governance:documents:edit"]}).status_code == 200
    assert sorted(http.get(f"/admin/roles/{made}").json()["permissions"]) == ["governance:documents:edit", "governance:documents:view", "legacy:thing:view"]


def test_a_persons_ai_usage_names_the_areas_for_the_screen_and_keeps_every_field_it_had(w):
    w.add_people(1)
    w.db.add(m.AIUsageEvent(actor_user_id=100, actor_username="p100", module_key="governance", feature_key="studio_draft", prompt_tokens=10,
                            completion_tokens=5, total_tokens=15, requested_model="some-model"))
    w.db.commit()
    body = w.as_(1).get("/admin/ai-usage/users/100").json()
    row = body["modules"][0]
    assert {"module_key", "feature_key", "calls", "prompt_tokens", "completion_tokens", "total_tokens", "estimated_cost"} <= set(row), "nothing was removed"
    assert row["module_label"] == "Governance" and row["feature_label"] == "Studio Draft"
    event = body["recent"][0]
    assert {"id", "occurred_at", "module_key", "feature_key", "model", "total_tokens", "status"} <= set(event), "nothing was removed"
    assert event["module_label"] == "Governance" and event["feature_label"] == "Studio Draft"
    assert body["summary"]["calls"] == 1
