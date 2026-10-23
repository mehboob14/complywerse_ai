"""Vulnerability management x departments: workflow templates that hand work to a department, SLA escalations along a
department's escalation path, who may change the paths and assign vulnerabilities, and the department list/members the
Vulnerabilities > Departments page reads. Over HTTP through the mounted /vuln-management router, on in-memory SQLite."""
import os
from datetime import datetime, timedelta

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


# --- SLA escalation along a department's escalation path ----------------------------------------------------------------

def _breached_in_it(db):
    """A high finding open for 60 days (its SLA is 30) that sits with IT, whose level-1 path goes to the department head."""
    db.add(m.Vulnerability(id=1, tenant_id=1, vuln_id="VULN-1", title="Open port", severity="high", status="open",
                           discovered_at=datetime.utcnow() - timedelta(days=60)))
    db.flush()
    db.add(m.GRCVulnerabilityDepartmentAssignment(vulnerability_id=1, department_id=IT, assigned_by=ADMIN))
    db.add(m.GRCDepartmentEscalationPath(department_id=IT, escalation_level=1, target_role="head", sla_threshold_percent=75))
    db.commit()


def test_the_sla_check_escalates_along_a_departments_path_and_only_once(w):
    db, as_ = w
    _breached_in_it(db)
    http = as_(PLAIN)
    r = http.post("/vuln-management/escalations/run-sla-check?send_emails=false")
    assert r.status_code == 200, r.text
    assert [(d["department_id"], d["escalated_to_user_id"]) for d in r.json()["details"]] == [(IT, HEAD)]
    db.expire_all()
    logs = db.query(m.GRCVulnEscalationLog).all()
    assert [(x.vulnerability_id, x.escalation_rule_id, x.escalated_to_department_id, x.escalated_to_user_id) for x in logs] == [
        (1, None, IT, HEAD)]
    # that log row is what keeps the next run from escalating to the same person again
    again = http.post("/vuln-management/escalations/run-sla-check?send_emails=false")
    assert again.status_code == 200, again.text
    assert again.json()["escalations_triggered"] == 0
    assert db.query(m.GRCVulnEscalationLog).count() == 1


def test_a_departments_escalation_shows_in_the_escalation_logs(w):
    db, as_ = w
    _breached_in_it(db)
    http = as_(PLAIN)
    assert http.post("/vuln-management/escalations/run-sla-check?send_emails=false").status_code == 200
    for url in ("/vuln-management/escalations/logs", "/vuln-management/vulnerabilities/1/escalations"):
        r = http.get(url)
        assert r.status_code == 200, (url, r.text)
        row = r.json()[0]
        assert (row["escalation_rule_id"], row["escalation_rule_name"], row["escalated_to_department_name"],
                row["escalated_to_user_name"]) == (None, None, "IT", "Hugo"), url


def test_tenants_made_before_get_the_rule_of_an_escalation_log_made_optional(monkeypatch):
    """create_all never alters a table: a tenant database made while escalation_rule_id was NOT NULL needs DROP NOT NULL
    (run for every tenant at its first connection). SQLite cannot drop it, so this checks the step is registered; the SQL
    itself was run against a throwaway Postgres database."""
    from grc.modules.compliance import schema_migrations as sm

    asked = []
    monkeypatch.setattr(sm, "_ensured_engines", set())
    monkeypatch.setattr(sm, "_ensure_column_nullable", lambda engine, table, column: asked.append((table, column)))
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    sm._ensure_for_engine(engine)
    assert ("grc_vuln_escalation_logs", "escalation_rule_id") in asked


# --- who may change escalation paths and assign vulnerabilities --------------------------------------------------------

NET = 11
# (kind, method, url, kwargs): the escalation paths are the organisation's structure (admin:organization:edit, like the
# department itself); handing a finding to a department is triage, like assigning it to a person (the vulnerability
# register's edit right)
WRITES = [
    ("paths", "post", f"/vuln-management/departments/{IT}/escalation-paths",
     {"json": {"escalation_level": 1, "target_role": "head", "sla_threshold_percent": 75, "auto_escalate": True}}),
    ("paths", "delete", f"/vuln-management/departments/{IT}/escalation-paths/1", {}),
    ("assign", "post", "/vuln-management/vulnerabilities/1/assign-department", {"json": {"department_id": NET}}),
    ("assign", "delete", f"/vuln-management/vulnerabilities/1/assign-department/{IT}", {}),
    ("assign", "post", "/vuln-management/vulnerabilities/bulk-assign", {"json": {"vulnerability_ids": [2], "department_id": NET}}),
]


@pytest.mark.parametrize("who, may", [
    (PLAIN, set()),
    (VULN_EDITOR, {"assign"}),
    (ORG_EDITOR, {"paths"}),
    (ADMIN, {"assign", "paths"}),
])
def test_escalation_paths_need_the_organisation_right_and_assigning_the_vulnerability_right(w, who, may):
    db, as_ = w
    db.add(m.GRCDepartment(id=NET, tenant_id=1, name="Network", code="NET"))
    db.add(m.Vulnerability(id=1, tenant_id=1, vuln_id="VULN-1", title="Open port", severity="high"))
    db.add(m.Vulnerability(id=2, tenant_id=1, vuln_id="VULN-2", title="Old TLS", severity="low"))
    db.flush()
    db.add(m.GRCDepartmentEscalationPath(id=1, department_id=IT, escalation_level=2, target_role="head"))
    db.add(m.GRCVulnerabilityDepartmentAssignment(vulnerability_id=1, department_id=IT, assigned_by=ADMIN))
    db.commit()
    http = as_(who)
    for kind, method, url, kw in WRITES:
        r = getattr(http, method)(url, **kw)
        if kind in may:
            assert r.status_code in (200, 201), (who, method, url, r.text)
        else:
            assert (r.status_code, r.json()["detail"]) == (403, "Permission denied"), (who, method, url, r.text)
    db.expire_all()
    paths = sorted(p.escalation_level for p in db.query(m.GRCDepartmentEscalationPath))
    assigned = sorted((a.vulnerability_id, a.department_id) for a in db.query(m.GRCVulnerabilityDepartmentAssignment))
    assert paths == ([1] if "paths" in may else [2])
    assert assigned == ([(1, NET), (2, NET)] if "assign" in may else [(1, IT)])
    # reading them stays open to anyone signed in
    assert http.get(f"/vuln-management/departments/{IT}/escalation-paths").status_code == 200
    assert http.get("/vuln-management/vulnerabilities/1/departments").status_code == 200


# --- what the Vulnerabilities > Departments page reads ------------------------------------------------------------------

def test_a_departments_members_can_be_listed(w):
    db, as_ = w
    db.add(m.GRCDepartmentMember(department_id=IT, user_id=PLAIN, role="member", is_active=False))   # left the department
    db.add(m.GRCDepartmentMember(department_id=IT, user_id=VULN_EDITOR, role="lead", escalation_order=1))
    db.commit()
    http = as_(PLAIN)
    r = http.get(f"/vuln-management/departments/{IT}/members")
    assert r.status_code == 200, r.text
    assert [(x["user_id"], x["role"], x["user_name"], x["user_email"]) for x in r.json()] == [
        (HEAD, "head", "Hugo", "hugo@acme.test"), (VULN_EDITOR, "lead", "Vera", "vera@acme.test")]
    assert http.get("/vuln-management/departments/999/members").status_code == 404


def test_the_department_list_counts_each_departments_findings(w):
    db, as_ = w
    db.add(m.GRCDepartment(id=11, tenant_id=1, name="Network", code="NET"))
    db.add_all([m.Vulnerability(id=i, tenant_id=1, vuln_id=f"VULN-{i}", title="t", severity="low") for i in (1, 2)])
    db.flush()
    db.add_all([m.GRCVulnerabilityDepartmentAssignment(vulnerability_id=i, department_id=IT) for i in (1, 2)])
    db.commit()
    rows = {d["name"]: (d["member_count"], d["vulnerability_count"]) for d in as_(PLAIN).get("/vuln-management/departments").json()}
    assert rows == {"IT": (1, 2), "Network": (0, 0)}
    saved = as_(ADMIN).put(f"/vuln-management/departments/{IT}", json={"description": "Infrastructure"})
    assert (saved.status_code, saved.json()["vulnerability_count"]) == (200, 2), saved.text
