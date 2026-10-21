"""Security hotfix (wt/sec-hotfix): ComplyChat cannot read secrets, and the
organisation, admin, evidence-approval and credential-using endpoints now need
their rights. Over HTTP on in-memory SQLite, plus pure-function checks for the
ComplyChat SQL guard and the chat-upload filter.

Each test gates on behaviour that was open before the fix:
 * validate_sql refuses password_hash / a JOIN to grc_users credentials /
   subqueries / CTEs that name secret tables, and still accepts normal SQL;
 * chat_upload vector hits are filtered to the person who uploaded them;
 * tenants / password-policy / role-members / teams writes refuse a plain user;
 * evidence approval is refused for a non-approver, allowed for the user approver,
   a role-tier approver, an administrator and the approvals-page editor, and
   pending-approvals lists only the items a person may act on;
 * the credential-using endpoints (workflow email-config, discovery connect +
   credentials, asset collect, agent scan-now-push, connect-wizard token) refuse
   a plain user without the right.
"""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")
os.environ.setdefault("OPENAI_API_KEY", "dummy")

from datetime import datetime  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
import grc.routers.admin_router as admin_mod  # noqa: E402
from grc.routers.tenants_router import router as tenants_router  # noqa: E402
from grc.routers.teams_router import router as teams_router  # noqa: E402
from grc.routers.compliance_assessments_router import router as assessments_router  # noqa: E402
from grc.routers.assets_router import router as assets_router  # noqa: E402
from grc.routers.connect_wizard_router import router as connect_wizard_router  # noqa: E402
from grc.modules.workflow_engine.routers.notifications import router as notifications_router  # noqa: E402
from grc.modules.asset_discovery.router import router as discovery_router  # noqa: E402
from grc.modules.agents.router import router as agents_router  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402


# ── ComplyChat SQL guard (pure function, no DB) ───────────────────────────────

from grc.modules.chatbot.complychat.complychat.grc_sql_agent import validate_sql  # noqa: E402

# A handful of real queries the agent generates for ordinary questions.
NORMAL_SQL = [
    "SELECT id, title, owner_id, status FROM grc_risks ORDER BY id LIMIT 10",
    "SELECT COALESCE(uf.name, 'x') as framework_name, COUNT(pfc.id) as control_count "
    "FROM grc_uploaded_frameworks uf LEFT JOIN grc_parsed_framework_controls pfc "
    "ON uf.id = pfc.uploaded_framework_id GROUP BY uf.id, uf.name ORDER BY control_count DESC LIMIT 100",
    "SELECT COALESCE(integration_type,'N/A') as integration_type, COALESCE(connection_name,'x') as name, "
    "COALESCE(status,'pending') as status, COALESCE(last_sync_status,'never') as last_sync "
    "FROM grc_integration_connections WHERE is_active = 1 ORDER BY integration_type LIMIT 30",
    "SELECT department_id, COUNT(*) FROM grc_risks GROUP BY department_id",
    # 'secretary_id' merely contains 'secret' — it is an allow-listed ordinary column.
    "SELECT secretary_id FROM grc_governance_committees LIMIT 5",
]

SECRET_SQL = [
    "SELECT username, password_hash FROM grc_users",
    "SELECT u.username, u.password_hash FROM grc_users u JOIN grc_risks r ON r.owner_id = u.id",
    "SELECT id FROM grc_risks WHERE owner_id IN (SELECT id FROM grc_users WHERE password_hash IS NOT NULL)",
    "WITH c AS (SELECT secret_encrypted FROM grc_credential_profiles) SELECT id FROM c LIMIT 5",
    "SELECT smtp_username, smtp_password FROM grc_workflow_email_configs",
    "SELECT name, username FROM grc_credential_profiles",          # a secrets-only table, even without a secret column
    "SELECT token, secret FROM grc_workflow_engine_webhooks",
    "SELECT client_secret_encrypted FROM grc_identity_provider_configs",
    "SELECT encrypted_credentials_blob FROM grc_cloud_connectors",
    "SELECT request_enc FROM ai_call_payloads",
    "SELECT b.password_hash FROM grc_risks a, grc_users b",          # secret column via comma-join
    "SELECT a.id FROM grc_risks a, pg_user b",                       # non-allowed table via comma-join
    "SELECT id FROM grc_risks JOIN information_schema.columns ic ON 1=1",  # non-allowed table via JOIN
    "SELECT oauth_tokens FROM grc_integration_connections",          # secret column in a mixed table
]


@pytest.mark.parametrize("sql", NORMAL_SQL)
def test_validate_sql_accepts_normal_questions(sql):
    assert validate_sql(sql) is True


@pytest.mark.parametrize("sql", SECRET_SQL)
def test_validate_sql_refuses_secrets_and_unknown_tables(sql):
    assert validate_sql(sql) is False


# ── chat_upload hits stay with the person who uploaded them ───────────────────

from grc.modules.chatbot.router import _own_chat_uploads_only  # noqa: E402


def test_chat_upload_hits_filtered_to_their_owner():
    hits = [
        {"payload": {"source_type": "chat_upload", "source_id": "mine"}},
        {"payload": {"source_type": "chat_upload", "source_id": "someone_else"}},
        {"payload": {"source_type": "governance_document", "source_id": "9"}},
    ]
    mine = _own_chat_uploads_only(hits, [{"id": "mine"}])
    assert mine == [hits[0], hits[2]]                 # my upload + the shared doc, never the other person's upload
    assert _own_chat_uploads_only(hits, []) == [hits[2]]   # no session uploads → no chat_upload hits at all


# ── HTTP fixture: one app, every router this hotfix touched ───────────────────

PLAIN, ADMIN = 1, 2
SETTINGS, ROLESVIEW, USERSEDIT, ASMTEDIT = 3, 4, 5, 6
WFINTEG, DISCOVER, ASSETEDIT, AGENTS = 7, 8, 9, 10
APPROVER_U, ROLEAPPR, STAFF = 11, 12, 13

# role_id → (role name, [permission names])
_ROLES = {
    1: ("Administrator", []),
    20: ("Settings editors", ["admin:settings:edit"]),
    21: ("Role viewers", ["admin:roles:view"]),
    22: ("User editors", ["admin:users:edit"]),
    23: ("Assessment editors", ["compliance:assessments:edit"]),
    24: ("Workflow integrators", ["workflow_engine:integrations:view", "workflow_engine:integrations:edit"]),
    25: ("Discoverers", ["compliance:discover:execute"]),
    26: ("Asset editors", ["assets:asset_inventory:edit"]),
    27: ("Agent managers", ["compliance:agents:manage"]),
    28: ("Tier-2 approvers", []),          # names an approval tier; holds no platform permission
}
# user_id → role_id
_USER_ROLE = {
    ADMIN: 1, SETTINGS: 20, ROLESVIEW: 21, USERSEDIT: 22, ASMTEDIT: 23,
    WFINTEG: 24, DISCOVER: 25, ASSETEDIT: 26, AGENTS: 27, ROLEAPPR: 28,
}


@pytest.fixture
def w():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()

    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    for uid, name in [(PLAIN, "plain"), (ADMIN, "ada"), (SETTINGS, "sue"), (ROLESVIEW, "rob"),
                      (USERSEDIT, "ueli"), (ASMTEDIT, "eve"), (WFINTEG, "wes"), (DISCOVER, "dan"),
                      (ASSETEDIT, "asa"), (AGENTS, "amy"), (APPROVER_U, "pat"), (ROLEAPPR, "rae"),
                      (STAFF, "sam")]:
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title()))

    perm_id = 100
    for role_id, (role_name, perms) in _ROLES.items():
        db.add(m.Role(id=role_id, tenant_id=1, name=role_name))
        for p in perms:
            module, submodule, action = p.split(":")
            db.add(m.Permission(id=perm_id, name=p, resource=f"{module}:{submodule}", action=action))
            db.add(m.RolePermission(role_id=role_id, permission_id=perm_id))
            perm_id += 1
    for uid, role_id in _USER_ROLE.items():
        db.add(m.UserRole(user_id=uid, role_id=role_id, tenant_id=1))

    # A team to update / delete / change members on.
    db.add(m.Team(id=10, tenant_id=1, name="Payments", is_active=True,
                  created_at=datetime.utcnow(), updated_at=datetime.utcnow()))
    db.add(m.TeamMember(id=5, team_id=10, user_id=STAFF, role_in_team="member", added_at=datetime.utcnow()))

    # Evidence approval: a workflow with a user tier (1) and a role tier (2), and
    # two pending evidence links — one awaiting the user tier, one the role tier.
    db.add(m.ComplianceAssessmentDocument(id=1, tenant_id=1, name="Gap A", assessment_type="gap_assessment"))
    db.add(m.ComplianceAssessmentDocumentItem(id=1, assessment_id=1, tenant_id=1, item_number="1",
                                              control_description="Encrypt data at rest"))
    db.add(m.Evidence(id=1, tenant_id=1, name="screenshot.png"))
    db.add(m.AssessmentEvidenceApprovalWorkflow(id=1, tenant_id=1, name="Two-tier"))
    db.add(m.AssessmentEvidenceApprovalTier(id=1, workflow_id=1, tier_order=1, tier_name="Reviewer",
                                            approver_type="user", approver_user_id=APPROVER_U))
    db.add(m.AssessmentEvidenceApprovalTier(id=2, workflow_id=1, tier_order=2, tier_name="Approver",
                                            approver_type="role", approver_role_id=28))
    db.add(m.AssessmentItemEvidence(id=1, assessment_item_id=1, evidence_id=1, tenant_id=1,
                                    workflow_id=1, current_tier=1, status="pending_tier_1"))
    db.add(m.AssessmentItemEvidence(id=2, assessment_item_id=1, evidence_id=1, tenant_id=1,
                                    workflow_id=1, current_tier=2, status="pending_tier_2"))
    db.commit()

    app = FastAPI()
    for r in (tenants_router, admin_mod.router, teams_router, assessments_router,
              assets_router, connect_wizard_router, notifications_router,
              discovery_router, agents_router):
        app.include_router(r)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[admin_mod.get_tenant_db] = lambda: db
    http = TestClient(app)

    def as_(uid):
        http.headers["Authorization"] = "Bearer " + create_access_token(
            {"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        return http

    yield db, as_
    db.close()


# ── Hole 2: the organisation record ───────────────────────────────────────────

TENANT_WRITES = [
    ("post", "/tenants", {"json": {"name": "New Co", "slug": "newco"}}),
    ("put", "/tenants/1", {"json": {"name": "Renamed"}}),
    ("delete", "/tenants/1", {}),
    ("post", "/tenants/1/users", {"json": {"user_id": PLAIN}}),
    ("post", "/tenants/1/business-units", {"json": {"name": "Treasury"}}),
]


def test_tenant_writes_refuse_a_plain_user_but_gets_stay_open(w):
    db, as_ = w
    http = as_(PLAIN)
    for method, path, kw in TENANT_WRITES:
        r = getattr(http, method)(path, **kw)
        assert r.status_code == 403, (method, path, r.status_code, r.text)
    # the pickers that read the org record still work for anyone signed in
    assert as_(PLAIN).get("/tenants/1").status_code == 200
    assert as_(PLAIN).get("/tenants").status_code == 200


def test_tenant_writes_allowed_for_an_administrator(w):
    db, as_ = w
    http = as_(ADMIN)
    assert http.post("/tenants/1/business-units", json={"name": "Treasury"}).status_code == 201
    assert http.post("/tenants/1/users", json={"user_id": PLAIN}).status_code == 201
    assert http.put("/tenants/1", json={"name": "Renamed"}).status_code == 200


# ── Hole 3: admin settings, role members, teams ───────────────────────────────

def test_password_policy_put_refused_without_the_right(w):
    db, as_ = w
    body = {"min_length": 12}
    assert as_(PLAIN).put("/admin/password-policy", json=body).status_code == 403
    assert as_(PLAIN).get("/admin/password-policy").status_code == 200          # read stays open
    assert as_(SETTINGS).put("/admin/password-policy", json=body).status_code == 200
    assert as_(ADMIN).put("/admin/password-policy", json=body).status_code == 200


def test_role_members_refused_without_the_right(w):
    db, as_ = w
    assert as_(PLAIN).get("/admin/roles/1/members").status_code == 403
    assert as_(ROLESVIEW).get("/admin/roles/1/members").status_code == 200
    assert as_(ADMIN).get("/admin/roles/1/members").status_code == 200


TEAM_WRITES = [
    ("post", "/admin/teams", {"json": {"name": "Identity"}}),
    ("patch", "/admin/teams/10", {"json": {"name": "Payments 2"}}),
    ("post", "/admin/teams/10/members", {"json": {"user_id": PLAIN, "role_in_team": "member"}}),
    ("patch", "/admin/teams/10/members/5", {"json": {"role_in_team": "lead"}}),
    ("delete", "/admin/teams/10/members/5", {}),
    ("delete", "/admin/teams/10", {}),
]


def test_team_writes_refuse_a_plain_user_but_gets_stay_open(w):
    db, as_ = w
    http = as_(PLAIN)
    for method, path, kw in TEAM_WRITES:
        r = getattr(http, method)(path, **kw)
        assert r.status_code == 403, (method, path, r.status_code, r.text)
    assert as_(PLAIN).get("/admin/teams").status_code == 200           # picker read stays open
    assert as_(PLAIN).get("/admin/teams/10").status_code == 200


@pytest.mark.parametrize("who", [ADMIN, USERSEDIT])
def test_team_writes_allowed_for_admin_or_users_edit(w, who):
    db, as_ = w
    assert as_(who).post("/admin/teams", json={"name": "Identity"}).status_code == 201
    assert as_(who).patch("/admin/teams/10", json={"name": "Payments 2"}).status_code == 200


# ── Hole 4: evidence approvals ────────────────────────────────────────────────

def _approve(http, link_id):
    return http.post(f"/compliance/assessments/evidence/{link_id}/approval", json={"action": "approve"})


def test_evidence_approval_refused_for_a_non_approver(w):
    db, as_ = w
    # a plain signed-in user, and a user who is the approver of a DIFFERENT tier
    assert _approve(as_(PLAIN), 1).status_code == 403
    assert _approve(as_(ROLEAPPR), 1).status_code == 403     # tier-2 role approver cannot act on a tier-1 item
    db.expire_all()
    assert db.get(m.AssessmentItemEvidence, 1).status == "pending_tier_1"   # unchanged


def test_evidence_approval_allowed_for_the_named_user_approver(w):
    db, as_ = w
    assert _approve(as_(APPROVER_U), 1).status_code == 200
    db.expire_all()
    assert db.get(m.AssessmentItemEvidence, 1).current_tier == 2            # advanced past tier 1


def test_evidence_approval_allowed_for_a_role_tier_approver(w):
    db, as_ = w
    assert _approve(as_(ROLEAPPR), 2).status_code == 200                    # member of the tier-2 role
    db.expire_all()
    assert db.get(m.AssessmentItemEvidence, 2).status == "approved"


@pytest.mark.parametrize("who", [ADMIN, ASMTEDIT])
def test_evidence_approval_allowed_for_admin_and_the_approvals_page_editor(w, who):
    db, as_ = w
    assert _approve(as_(who), 1).status_code == 200


def test_evidence_submit_stays_open_to_any_signed_in_user(w):
    db, as_ = w
    r = as_(PLAIN).post("/compliance/assessments/evidence/1/approval", json={"action": "submit"})
    assert r.status_code == 200          # submitting your own evidence for review is not an approval


def test_pending_approvals_lists_only_the_items_the_person_may_act_on(w):
    db, as_ = w

    def ids(uid):
        data = as_(uid).get("/compliance/assessments/pending-approvals").json()
        return sorted(item["id"] for item in data["pending_approvals"])

    assert ids(PLAIN) == []                 # no tiers, no oversight right → nothing
    assert ids(APPROVER_U) == [1]           # only the tier-1 item they approve
    assert ids(ROLEAPPR) == [2]             # only the tier-2 item their role approves
    assert ids(ADMIN) == [1, 2]             # administrators see everything
    assert ids(ASMTEDIT) == [1, 2]          # the approvals-page editor sees everything


# ── Hole 5: credential-using / settings endpoints ─────────────────────────────

def test_workflow_email_config_refused_without_the_integrations_right(w):
    db, as_ = w
    create = {"json": {"config_name": "default", "smtp_host": "smtp.test", "smtp_port": 587,
                       "smtp_username": "u", "smtp_password": "p", "from_email": "x@y.test"}}
    assert as_(PLAIN).post("/notifications/email-config", **create).status_code == 403
    assert as_(PLAIN).get("/notifications/email-config").status_code == 403
    # the right-holder (and admin) can both create and read
    assert as_(WFINTEG).post("/notifications/email-config", **create).status_code == 200
    assert as_(WFINTEG).get("/notifications/email-config").status_code == 200
    assert as_(ADMIN).get("/notifications/email-config").status_code == 200


# For discovery / assets / agents, the permission dependency runs before the body,
# so a user WITHOUT the right is 403 and a user WITH it gets past the gate (then a
# 404 for the row we didn't create). 403 vs not-403 is exactly the hole.
DISCOVERY_WRITES = [
    ("post", "/discovery/devices/1/connect", {"json": {"username": "a", "password": "b"}}),
    ("post", "/discovery/devices/1/connect-service", {"json": {"kind": "postgres", "password": "b"}}),
    ("post", "/discovery/assets/1/reconnect", {"json": {"username": "a", "password": "b"}}),
    ("post", "/discovery/devices/1/disconnect", {}),
    ("post", "/discovery/connect-all-discovered", {}),
    ("post", "/discovery/connect-selected", {"json": {"observation_ids": [1]}}),
    ("get", "/discovery/credentials", {}),
]


def test_discovery_connect_and_credentials_need_discover_execute(w):
    db, as_ = w
    for method, path, kw in DISCOVERY_WRITES:
        assert getattr(as_(PLAIN), method)(path, **kw).status_code == 403, (method, path)
        assert getattr(as_(DISCOVER), method)(path, **kw).status_code != 403, (method, path)


ASSET_CRED_ENDPOINTS = [
    ("post", "/assets/1/probe-inventory", {}),
    ("post", "/assets/1/collect-service", {"json": {"kind": "postgres"}}),
    ("get", "/assets/1/service-logins", {}),
]


def test_asset_credential_endpoints_need_discover_or_inventory_edit(w):
    db, as_ = w
    for method, path, kw in ASSET_CRED_ENDPOINTS:
        assert getattr(as_(PLAIN), method)(path, **kw).status_code == 403, (method, path)
        # either right opens the gate (404 for the missing asset, never 403)
        assert getattr(as_(DISCOVER), method)(path, **kw).status_code != 403, (method, path)
        assert getattr(as_(ASSETEDIT), method)(path, **kw).status_code != 403, (method, path)


def test_agent_scan_now_push_needs_agents_manage(w):
    db, as_ = w
    assert as_(PLAIN).post("/agents/scan-now-push/1").status_code == 403
    assert as_(AGENTS).post("/agents/scan-now-push/1").status_code != 403     # 404 (no asset), gate passed


def test_connect_wizard_issue_token_needs_agents_manage(w):
    db, as_ = w
    body = {"json": {"platform": "windows"}}
    assert as_(PLAIN).post("/connect-wizard/issue-token", **body).status_code == 403
    assert as_(AGENTS).post("/connect-wizard/issue-token", **body).status_code == 200
