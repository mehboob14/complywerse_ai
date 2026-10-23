"""Vulnerability management x departments: workflow templates that hand work to a department, SLA escalations along a
department's escalation path, who may change the paths and assign vulnerabilities, and the department list/members the
Vulnerabilities > Departments page reads. Over HTTP through the mounted /vuln-management router, on in-memory SQLite."""
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

PLAIN, ADMIN, VULN_EDITOR, ORG_EDITOR, HEAD = 1, 2, 3, 4, 5
IT = 10


@pytest.fixture
def w():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    for uid, name in [(PLAIN, "plain"), (ADMIN, "ada"), (VULN_EDITOR, "vera"), (ORG_EDITOR, "orla"), (HEAD, "hugo")]:
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title()))
    db.add(m.Role(id=1, tenant_id=1, name="Administrator"))
    db.add(m.Role(id=2, tenant_id=1, name="Vulnerability editors"))
    db.add(m.Role(id=3, tenant_id=1, name="Organisation editors"))
    db.add(m.Permission(id=1, name="vulnerabilities:vulnerability_register:edit", resource="vulnerabilities:vulnerability_register", action="edit"))
    db.add(m.Permission(id=2, name="admin:organization:edit", resource="admin:organization", action="edit"))
    db.add(m.RolePermission(role_id=2, permission_id=1))
    db.add(m.RolePermission(role_id=3, permission_id=2))
    db.add(m.UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    db.add(m.UserRole(user_id=VULN_EDITOR, role_id=2, tenant_id=1))
    db.add(m.UserRole(user_id=ORG_EDITOR, role_id=3, tenant_id=1))
    db.add(m.GRCDepartment(id=IT, tenant_id=1, name="IT", code="IT", department_head_user_id=HEAD))
    db.add(m.GRCDepartmentMember(department_id=IT, user_id=HEAD, role="head"))
    db.commit()
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[m.get_db] = lambda: db
    http = TestClient(app, raise_server_exceptions=False)

    def as_(uid):
        http.headers["Authorization"] = "Bearer " + create_access_token({"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        return http

    yield db, as_
    db.close()


def _workflow(db):
    """Open -> Review (needs approval; its work goes to IT), and an escalation rule that goes to IT too."""
    db.add(m.GRCVulnWorkflowTemplate(id=1, tenant_id=1, name="Default", is_default=True))
    db.flush()
    db.add(m.GRCVulnWorkflowState(id=1, template_id=1, name="Open", state_type="initial", order_index=0))
    db.add(m.GRCVulnWorkflowState(id=2, template_id=1, name="Review", state_type="approval", order_index=1,
                                  requires_approval=True, auto_assign_department_id=IT))
    db.flush()
    db.add(m.GRCVulnWorkflowTransition(id=1, template_id=1, from_state_id=1, to_state_id=2, name="Submit", requires_approval=True,
                                       approver_role="manager"))
    db.add(m.GRCVulnWorkflowEscalation(id=1, template_id=1, name="SLA breach", trigger_type="sla_percentage", trigger_value=100,
                                       escalate_to_department_id=IT))
    db.add(m.Vulnerability(id=1, tenant_id=1, vuln_id="VULN-1", title="Open port", severity="high", current_state_id=1,
                           workflow_template_id=1))
    db.commit()


# --- workflows: the department a state or an escalation hands work to ---------------------------------------------------

def test_a_workflow_template_names_the_departments_its_states_and_escalations_hand_work_to(w):
    db, as_ = w
    _workflow(db)
    r = as_(PLAIN).get("/vuln-management/workflows/1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [(s["name"], s["auto_assign_department_id"], s["auto_assign_department_name"]) for s in body["states"]] == [
        ("Open", None, None), ("Review", IT, "IT")]
    assert [(e["escalate_to_department_id"], e["escalate_to_department_name"]) for e in body["escalations"]] == [(IT, "IT")]


def test_a_transition_that_needs_approval_asks_the_department_of_the_state_it_goes_to(w):
    db, as_ = w
    _workflow(db)
    r = as_(PLAIN).post("/vuln-management/vulnerabilities/1/transition", json={"transition_id": 1})
    assert r.status_code == 200, r.text
    db.expire_all()
    asked = db.query(m.GRCVulnNotification).filter_by(notification_type="approval_required").all()
    assert [(n.vulnerability_id, n.recipient_department_id, n.triggered_by_user_id) for n in asked] == [(1, IT, PLAIN)]
