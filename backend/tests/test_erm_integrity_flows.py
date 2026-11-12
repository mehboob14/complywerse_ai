"""Risk Management wave 5, integrity gaps in issues, workflows, third party, the register and the AI routes: each rule holds on
the server, not only on screen. In-memory SQLite.

1. Reopening a closed issue needs a reason, edit rights, and is in the issue's history (through /transition too).
2. A workflow step, and a settled vendor finding, close an issue only through the close path (maker-checker, open CAPA actions).
3. The workflow's internal-control lookup by name reads InternalControl.name.
4. A risk action copied with an old status ("pending") counts as open: the copy maps it, rows copied before are corrected.
5. Changing materiality on an approved scope sends it back to approval and tells the approvers.
6. Concentration counts a critical or important vendor that is the provider itself, per tenant.
7. The register's create and update take only register statuses; "draft" only through the Risk Library.
8. Risk posture leaves draft risks out; an asset with no linked risk still counts the risk dimension (owner, Sep 2026).
9. The ERM ai-suggest routes need the create or edit right of their record.
10. The KPI "incidents resolved" counts the incident register's done statuses only.
"""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, FrameworkRiskAssessment, FrameworkRiskQuestion, GRCUser, InternalControl, Issue,
                        IssueAction, IssueActivity, ITAsset, Permission, Risk, RiskAppetiteBreach, RiskAppetiteConfig,
                        RiskAssetLink, RiskIncident, RiskMitigationAction, Role, RolePermission, Tenant, TPRAAuditLog,
                        TPRAEngagement, TPRAFourthParty, TPRAStageInstance, UserRole, Vendor, get_db)
from grc.modules.erm.router import router as erm_router
from grc.modules.issue_management.routers import actions as capa, issues
from grc.modules.issue_management.services import risk_actions
from grc.modules.vendor_risk.router import router as vendor_router
from grc.modules.vendor_risk.tpra import service as tpra_service
from grc.modules.vendor_risk.tpra.stages import STAGE_ORDER
from grc.modules.workflow_engine.services import notification_service
from grc.modules.workflow_engine.services.action_handlers import ActionRefused, WorkflowActionHandlers
from grc.routers.auth_router import create_access_token, require_auth
from grc.routers.risks_router import router as legacy_risks_router

OFFICER, CHECKER, OWNER, VIEWER = 7, 8, 9, 10          # the first three are administrators
NAMES = {OFFICER: "officer", CHECKER: "checker", OWNER: "owner", VIEWER: "viewer"}
WHY = "Runs card authorisation: a critical function under EBA/GL/2019/02."


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Reader")])
    s.add_all([Permission(id=1, name="erm:risks:view", resource="erm", action="view"),
               Permission(id=2, name="issue_management:issues:view", resource="issue_management", action="view")])
    s.add_all([RolePermission(role_id=2, permission_id=1), RolePermission(role_id=2, permission_id=2)])
    s.add_all([GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True)
               for uid, name in NAMES.items()])
    s.add_all([UserRole(user_id=uid, role_id=1, tenant_id=1) for uid in (OFFICER, CHECKER, OWNER)])
    s.add(UserRole(user_id=VIEWER, role_id=2, tenant_id=1))
    s.commit()
    yield s
    s.close()


def client(db, uid=OFFICER):
    app = db.info.get("app")
    if app is None:
        app = db.info["app"] = FastAPI()
        for r in (erm_router, legacy_risks_router, vendor_router, issues.router, capa.router_issue, capa.router_actions):
            app.include_router(r)
        app.dependency_overrides[get_db] = lambda: db

        def who(request: Request) -> GRCUser:
            return db.get(GRCUser, int(request.headers["x-test-user"]))
        app.dependency_overrides[require_auth] = who
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": NAMES[uid]})
    http.headers["x-test-user"] = str(uid)
    return http


def save(db, row):
    db.add(row)
    db.commit()
    return row


# ── 1. reopening a closed issue ──────────────────────────────────────────────

def test_reopening_a_closed_issue_needs_a_reason_and_edit_rights_and_is_recorded(db):
    issue = save(db, Issue(tenant_id=1, title="Gap", status="closed", workflow_state="closed", closed_at=datetime.utcnow(),
                           approved_by_id=CHECKER))
    http = client(db)
    for body in ({"to_state": "in_progress"}, {"to_state": "in_progress", "reason": "oops"}):
        res = http.post(f"/issues/{issue.id}/transition", json=body)
        assert res.status_code == 400 and "reason" in res.json()["detail"], res.text
    assert http.post(f"/issues/{issue.id}/reopen", json={"reason": "short"}).status_code == 400
    assert client(db, VIEWER).post(f"/issues/{issue.id}/transition",
                                   json={"to_state": "in_progress", "reason": "The fix did not hold in testing"}).status_code == 403
    db.refresh(issue)
    assert issue.workflow_state == "closed"

    res = http.post(f"/issues/{issue.id}/transition", json={"to_state": "in_progress", "reason": "The fix did not hold in testing"})
    assert res.status_code == 200, res.text
    db.refresh(issue)
    assert (issue.workflow_state, issue.status, issue.closed_at, issue.approved_by_id) == ("in_progress", "open", None, None)
    reopened = db.query(IssueActivity).filter_by(issue_id=issue.id, type="reopened").one()
    assert reopened.user_id == OFFICER and reopened.payload["reason"] == "The fix did not hold in testing"


# ── 2. closing outside the API goes through the close path ───────────────────

def _run(owner_id=OWNER):
    return SimpleNamespace(id=1, tenant_id=1, context={}, trigger_payload={}), \
        SimpleNamespace(id=1, name="Close fixed gaps", created_by_id=owner_id)


def test_a_workflow_closes_an_issue_only_as_an_independent_owner_once_its_actions_are_done(db):
    issue = save(db, Issue(tenant_id=1, title="Gap", status="open", workflow_state="closure_review", assignee_id=OWNER))
    action = save(db, IssueAction(issue_id=issue.id, title="Patch the ledger", status="in_progress"))
    close = {"issue_id": issue.id, "to_state": "closed", "notes": "Patched and re-tested"}
    with pytest.raises(ActionRefused, match="someone else"):          # the workflow's owner is the issue's assignee
        WorkflowActionHandlers._transition_issue_state(db, *_run(OWNER), close)
    with pytest.raises(ActionRefused, match="Patch the ledger"):      # an independent owner, but an action is still open
        WorkflowActionHandlers._transition_issue_state(db, *_run(CHECKER), close)
    with pytest.raises(ActionRefused, match="notes"):
        WorkflowActionHandlers._transition_issue_state(db, *_run(CHECKER), {**close, "notes": ""})
    db.refresh(issue)
    assert issue.workflow_state == "closure_review" and issue.closed_at is None

    action.status = "completed"
    db.commit()
    done = WorkflowActionHandlers._transition_issue_state(db, *_run(CHECKER), close)
    assert done["to_state"] == "closed"
    db.commit()                         # the step executor commits the step
    db.refresh(issue)
    assert (issue.workflow_state, issue.status, issue.approved_by_id, issue.closure_notes) == (
        "closed", "closed", CHECKER, "Patched and re-tested")
    # reopening it is a person's call, with a reason
    with pytest.raises(ActionRefused, match="reason"):
        WorkflowActionHandlers._transition_issue_state(db, *_run(CHECKER), {"issue_id": issue.id, "to_state": "in_progress"})


def test_a_settled_vendor_finding_closes_its_issue_only_through_the_close_path(db):
    issue = save(db, Issue(tenant_id=1, title="Vendor finding: No MFA", status="open", workflow_state="new", assignee_id=OWNER))
    action = save(db, IssueAction(issue_id=issue.id, title="Investigate and remediate", status="planned"))
    finding = SimpleNamespace(id=5, tenant_id=1, linked_issue_id=issue.id, status="closed")
    settle = lambda uid: (tpra_service.close_finding_issue(db, finding, uid, reason="Resolved via the TPRA finding."),  # noqa: E731
                          db.commit(), db.refresh(issue))
    settle(CHECKER)
    # an action is still open: the issue waits for its closure sign-off, it is not closed
    assert (issue.workflow_state, issue.status, issue.closed_at) == ("closure_review", "open", None)
    waiting = db.query(IssueActivity).filter_by(issue_id=issue.id, type="status_change").one()
    assert (waiting.payload["from"], waiting.payload["to"]) == ("new", "closure_review")
    assert "Investigate and remediate" in waiting.payload["notes"]

    action.status = "completed"
    db.commit()
    settle(OWNER)                       # the issue's assignee settled the finding: someone else signs the closure off
    assert issue.workflow_state == "closure_review" and issue.closed_at is None
    tpra_service.close_finding_issue(db, finding, CHECKER, reason="Resolved via the TPRA finding.")
    db.commit()
    db.refresh(issue)
    assert (issue.workflow_state, issue.approved_by_id, issue.closure_notes) == ("closed", CHECKER, "Resolved via the TPRA finding.")


def test_a_workflow_kri_value_waits_for_a_checker_like_one_recorded_by_hand(db):
    from grc.models import RiskKRI, RiskKRIMeasurement
    kri = save(db, RiskKRI(tenant_id=1, name="Failed payments", green_threshold=5, amber_threshold=10, current_value=3,
                           owner_id=OFFICER))
    step = {"kri_id": kri.id, "value": 12, "notes": "From the payments feed"}
    with pytest.raises(ActionRefused, match="owner"):
        WorkflowActionHandlers._update_kri_value(db, *_run(None), step)
    got = WorkflowActionHandlers._update_kri_value(db, *_run(OFFICER), step)
    db.commit()
    db.refresh(kri)
    value = db.get(RiskKRIMeasurement, got["measurement_id"])
    assert (got["review_status"], value.review_status, value.measured_by, value.value) == ("submitted", "submitted", OFFICER, 12)
    assert kri.current_value == 3                                       # not published until a second person approves it
    with pytest.raises(ActionRefused, match="no KRI"):
        WorkflowActionHandlers._update_kri_value(db, *_run(OFFICER), {**step, "kri_id": kri.id + 99})


# ── 3. the internal-control lookup by name ───────────────────────────────────

def test_a_workflow_finds_an_internal_control_by_its_name(db):
    control = save(db, InternalControl(tenant_id=1, control_id="IC-001", name="Dual control on payments"))
    run = SimpleNamespace(id=1, tenant_id=1, context={},
                          trigger_payload={"resource_type": "internal_controls", "resource_name": "Dual control on payments"})
    got = WorkflowActionHandlers._execute_risk_action(db, run, SimpleNamespace(id=1), "create", "internal_controls",
                                                      "internal_control", {})
    assert got["control_id"] == control.id


def test_the_workflow_control_link_steps_write_the_one_link_table(db):
    from grc.models import FrameworkControl, RiskControl
    risk = save(db, Risk(tenant_id=1, title="Wire fraud", category="operational", status="open"))
    control = save(db, InternalControl(tenant_id=1, control_id="IC-002", name="Call-back on new payees"))
    catalog = save(db, FrameworkControl(objective_id=1, code="AC-2", name="Account management"))
    run = SimpleNamespace(id=1, tenant_id=1, context={}, trigger_payload={})
    act = lambda sub, fn, payload: WorkflowActionHandlers._execute_risk_action(  # noqa: E731
        db, run, SimpleNamespace(id=1, created_by_id=OFFICER), "create", sub, fn, payload)
    first = act("internal_controls", "link_control_to_risk", {"internal_control_id": control.id, "risk_id": risk.id})
    assert first["result"] == "linked", first
    again = act("internal_controls", "link_control_to_risk", {"internal_control_id": control.id, "risk_id": risk.id})
    assert again["link_id"] == first["link_id"]                          # an existing link is kept, not doubled
    assert act("risk_register", "link_risk_to_control", {"risk_id": risk.id, "control_id": catalog.id})["result"] == "linked"
    links = {(r.control_source, r.control_id, r.created_by) for r in db.query(RiskControl).filter_by(risk_id=risk.id)}
    assert links == {("internal", control.id, OFFICER), ("catalog", catalog.id, OFFICER)}


# ── 4. old "pending" actions count as open ───────────────────────────────────

def test_a_risk_action_saved_as_pending_counts_as_open_after_the_copy(db):
    risk = save(db, Risk(id=1, tenant_id=1, title="Wire fraud", category="operational", status="open"))
    save(db, RiskMitigationAction(risk_id=risk.id, title="Call-back on new payees", status=" Pending"))
    # copied by an earlier run with its old word kept
    early = risk_actions.add_risk_action(db, risk, None, title="Dual sign-off", status="pending")
    early.legacy_mitigation_action_id = save(db, RiskMitigationAction(risk_id=risk.id, title="Dual sign-off", status="pending",
                                                                      migrated_to_issue_action_id=early.id)).id
    db.commit()
    risk_actions.migrate_legacy_actions(db, [1])
    statuses = {a.title: a.status for a in risk_actions.risk_actions_query(db, [1])}
    assert statuses == {"Call-back on new payees": "planned", "Dual sign-off": "planned"}
    assert all(s in risk_actions.OPEN_ACTION_STATUSES for s in statuses.values())
    risk_actions.migrate_legacy_actions(db, [1])                          # idempotent
    assert risk_actions.risk_actions_query(db, [1]).count() == 2


# ── 5. materiality changed after approval ────────────────────────────────────

def _vendor(db, name="Card processor", **kw):
    return save(db, Vendor(**{"tenant_id": 1, "name": name, "tier": "high", "status": "active", "owner_id": OFFICER, **kw}))


def _work(db, v, current, engagement=None):
    a = tpra_service.ensure_active_assessment(db, v, actor_id=OFFICER, engagement=engagement)
    a.inherent_tier, a.inherent_score, a.current_stage = "low", 20.0, current
    for s in tpra_service.get_stage_instances(db, a.id):
        s.status = ("complete" if STAGE_ORDER[s.stage_key] < STAGE_ORDER[current]
                    else "in_progress" if s.stage_key == current else "not_started")
    (engagement or v).lifecycle_stage = current
    db.commit()
    return a


def _classify(db, v, yes, uid=CHECKER, **params):
    got = client(db, uid).put(f"/vendor-risk/tpra/vendors/{v.id}/materiality", params=params,
                              json={"critical_important": yes, "reason": WHY})
    assert got.status_code == 200, got.text
    return got.json()


def test_changing_materiality_after_approval_reopens_the_approval_and_tells_the_approvers(db, monkeypatch):
    sent = []
    monkeypatch.setattr(notification_service, "send_workflow_notification", lambda db_, **kw: sent.append(kw) or {})
    v = _vendor(db, critical_important=False)
    a = _work(db, v, "monitoring")
    body = _classify(db, v, True)
    assert body["approval_reopened"] == {"assessment_id": a.id, "stage": "approval"}
    db.expire_all()
    a = db.get(type(a), a.id)
    approval = db.query(TPRAStageInstance).filter_by(assessment_id=a.id, stage_key="approval").one()
    assert (a.current_stage, approval.status, db.get(Vendor, v.id).lifecycle_stage) == ("approval", "in_progress", "approval")
    back = db.query(TPRAAuditLog).filter_by(assessment_id=a.id, entity="stage", action="send_back").one()
    assert (back.actor_id, back.to_value) == (CHECKER, "approval") and "critical or important" in back.reason
    assert len(sent) == 1 and CHECKER not in sent[0]["user_ids"] and {OFFICER, OWNER} & set(sent[0]["user_ids"])
    assert sent[0]["link"].startswith(f"/vendor-risk/vendors/{v.id}")
    # the same answer again, a scope not yet approved, or the first answer on one approved before materiality, reopens nothing
    assert _classify(db, v, True)["approval_reopened"] is None
    other = _vendor(db, name="Stationery", critical_important=False)
    _work(db, other, "approval")
    assert _classify(db, other, True)["approval_reopened"] is None
    legacy = _vendor(db, name="Approved before materiality")
    _work(db, legacy, "monitoring")
    assert _classify(db, legacy, True)["approval_reopened"] is None
    assert len(sent) == 1


# ── 6. concentration: the provider itself, per tenant ────────────────────────

def test_concentration_counts_a_critical_vendor_that_is_the_provider_itself(db):
    db.add(RiskAppetiteConfig(tenant_id=1, category="third_party", max_acceptable_score=12, concentration_limit=1))
    aws = _vendor(db, name="Amazon Web Services", critical_important=True)          # hosting bought from AWS directly
    card = _vendor(db, name="Card processor", critical_important=True)
    save(db, TPRAFourthParty(tenant_id=1, vendor_id=card.id, name="AWS", platform="AWS", created_by=OFFICER))
    lone = _vendor(db, name="Payroll bureau", critical_important=True)               # relies on no one we know of
    seen = client(db).get("/vendor-risk/tpra/concentration/appetite").json()
    assert seen["platforms"][0] == {"platform": "AWS", "count": 2, "vendors": ["Amazon Web Services", "Card processor"]}
    assert [r["platform"] for r in seen["breaching"]] == ["AWS"]
    assert all(r["platform"] != lone.name for r in seen["platforms"])                # a supplier alone is no concentration
    assert client(db).get("/erm/appetite/breach-log").status_code == 200
    breach = db.query(RiskAppetiteBreach).filter_by(tenant_id=1, category="third_party").one()
    assert (breach.measured_value, breach.limit_value) == (2, 1)
    assert aws.id


def test_the_concentration_check_runs_for_each_tenant_it_is_given(db):
    from grc.modules.erm.routers.appetite import check_appetite
    db.add(Tenant(id=2, name="Bank two", slug="bank-two"))
    db.add_all([RiskAppetiteConfig(tenant_id=t, category="third_party", max_acceptable_score=12, concentration_limit=1)
                for t in (1, 2)])
    for name in ("Core banking", "Cards"):
        v = save(db, Vendor(tenant_id=2, name=name, tier="high", status="active", critical_important=True))
        db.add(TPRAFourthParty(tenant_id=2, vendor_id=v.id, name="Azure", platform="Azure", created_by=OFFICER))
    db.commit()
    assert check_appetite(db, [1, 2], ["third_party"])["opened"] == 1
    db.commit()
    assert [(b.tenant_id, b.measured_value) for b in db.query(RiskAppetiteBreach)] == [(2, 2)]


# ── 7. register statuses ─────────────────────────────────────────────────────

def test_the_register_takes_only_register_statuses_and_draft_only_from_the_library(db):
    http = client(db)
    new = {"title": "Ledger outage", "category": "operational"}
    for word, code in (("mitigating", 400), ("whatever", 400), ("draft", 409), ("accepted", 409)):
        res = http.post("/erm/risks", json={**new, "status": word})
        assert res.status_code == code, (word, res.text)
    assert db.query(Risk).count() == 0
    rid = http.post("/erm/risks", json={**new, "status": "in_treatment"}).json()["id"]
    assert http.post("/erm/risks", json=new).json()["status"] == "open"
    for url in (f"/erm/risks/{rid}", f"/risks/{rid}"):
        assert http.put(url, json={"status": "mitigating"}).status_code == 400
        assert http.put(url, json={"status": "draft"}).status_code == 409
    assert http.put(f"/erm/risks/{rid}", json={"status": "mitigated", "reason": "Controls in place"}).status_code == 200
    # a risk still holding an old word can be edited without changing it
    old = save(db, Risk(tenant_id=1, title="Old one", category="operational", status="monitoring"))
    assert http.put(f"/erm/risks/{old.id}", json={"status": "monitoring", "title": "Old one, renamed"}).status_code == 200


# ── 8. risk posture ──────────────────────────────────────────────────────────

def test_risk_posture_leaves_drafts_out_and_still_counts_an_asset_with_no_risk(db):
    from grc.modules.risk_posture.service import _risk_score
    asset = save(db, ITAsset(tenant_id=1, name="Core ledger", asset_type="application"))
    bare = save(db, ITAsset(tenant_id=1, name="Spare host", asset_type="infrastructure"))
    live = save(db, Risk(tenant_id=1, title="Ledger outage", category="operational", status="open", residual_score=10))
    draft = save(db, Risk(tenant_id=1, title="Proposed from the library", category="operational", status="draft",
                          residual_score=25))
    db.add_all([RiskAssetLink(risk_id=live.id, asset_id=asset.id), RiskAssetLink(risk_id=draft.id, asset_id=asset.id),
                RiskAssetLink(risk_id=draft.id, asset_id=bare.id)])
    db.commit()
    got = _risk_score(db, 1, asset.id)
    assert (got["total_linked"], got["active_count"], got["raw_points"], got["by_status"]) == (1, 1, 10.0, {"open": 1})
    # the owner's Sep 2026 rule: no risk linked counts as known, adding nothing (a draft is no risk yet)
    assert _risk_score(db, 1, bare.id) == {"score": 0.0, "known": True, "open_count": 0, "active_count": 0, "total_linked": 0,
                                           "raw_points": 0.0, "by_status": {}}


# ── 9. AI suggestions need the record's create or edit right ─────────────────

AI_ROUTES = ["/erm/risks/ai-suggest", "/erm/kris/ai-suggest", "/erm/appetite/ai-suggest", "/erm/mitigation-actions/ai-suggest",
             "/erm/internal-controls/ai-suggest-category", "/erm/incidents/ai-suggest",
             "/erm/risk-assessments/1/risks/1/ai-suggest", "/erm/framework-risk-assessments/1/questions/1/ai-suggest"]


@pytest.mark.parametrize("url", AI_ROUTES)
def test_a_reader_cannot_spend_ai_on_suggestions(db, url):
    save(db, FrameworkRiskAssessment(id=1, tenant_id=1, name="NCA ECC", created_by=OFFICER))
    question = save(db, FrameworkRiskQuestion(id=1, assessment_id=1, question_text="Is MFA enforced?",
                                                    created_by=OFFICER))
    reader = client(db, VIEWER)
    assert reader.get("/erm/risks").status_code == 200                    # the reader reads the module
    res = reader.post(url, json={"name": "Ledger outage", "title": "Ledger outage", "description": "x", "category": "operational"})
    assert res.status_code == 403, res.text
    if "framework" in url:                                                # the question's assignee answers it with view access
        question.assigned_user_id = VIEWER
        db.commit()
        assert reader.post(url, json={}).status_code != 403


# ── 10. the KPI on incidents ─────────────────────────────────────────────────

def test_the_incident_kpi_counts_resolved_and_closed_only(db):
    from grc.modules.assessments.kpi_live import compute_kpi_metrics
    now = datetime.utcnow()
    for st in ("resolved", "closed", "contained", "investigating"):
        db.add(RiskIncident(tenant_id=1, title=f"Event {st}", severity="medium", status=st, incident_date=now))
    db.commit()
    got = compute_kpi_metrics(db, tenant_ids=[1])["incident_resolution"]
    assert (got["numerator"], got["denominator"]) == (2, 4) and "contained" not in got["label"].lower()
