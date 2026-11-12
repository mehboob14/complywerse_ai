"""Risk Management wave 5, integrity gaps in assessments: each rule holds on the server, not only on screen.

RCSA (configured tier approvers, findings raised as Issues, imported matrices read-only, overdue reminders with escalation,
1LINK import and seed on the CAPA tracker), framework IT risk assessments (locked once approved, reopened on the record),
Risk Reviews (hand-off notifications, reassigning the reviewer), scenarios (hand-off notifications, deleting a draft) and
committee packs (frozen and filed once). Non-admin roles throughout. In-memory SQLite, the real /erm router.
"""
import io
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.routers import rcsa as rcsa_routes
from grc.modules.erm.routers import reviews as review_routes
from grc.modules.erm.routers import scenarios as scenario_routes
from grc.modules.governance.routers import committees
from grc.routers.auth_router import create_access_token, require_auth

MAKER, CHECKER, SECOND, RISKER, RISKER2, COMMITTEE, VIEWER, RISKER3 = 7, 8, 9, 10, 11, 12, 13, 14
NOW = datetime.utcnow()
ROLE_PERMS = {
    1: ("erm:risks:view", "erm:rcsa:view"),                                                     # 1st line
    2: ("erm:risks:view", "erm:rcsa:view", "erm:rcsa:edit", "erm:rcsa:create"),                 # RCSA manager
    3: ("erm:risks:view", "erm:risks:edit", "erm:risks:create", "erm:risks:delete", "erm:rcsa:view"),   # risk team
    4: ("erm:risks:view", "erm:rcsa:view", "erm:rcsa:edit"),                                    # risk committee (a tier role)
}


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(m.Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([m.Role(id=i, name=n) for i, n in ((1, "1st line"), (2, "RCSA manager"), (3, "Risk team"), (4, "Committee"))])
    names = sorted({p for perms in ROLE_PERMS.values() for p in perms})
    s.add_all([m.Permission(id=i, name=n, resource=n.rsplit(":", 1)[0], action=n.rsplit(":", 1)[1])
               for i, n in enumerate(names, 1)])
    s.add_all([m.RolePermission(role_id=role, permission_id=names.index(p) + 1)
               for role, perms in ROLE_PERMS.items() for p in perms])
    users = ((MAKER, "maker", 1), (CHECKER, "checker", 2), (SECOND, "second", 2), (RISKER, "risker", 3),
             (RISKER2, "risker2", 3), (COMMITTEE, "committee", 4), (VIEWER, "viewer", 1), (RISKER3, "risker3", 3))
    s.add_all([m.GRCUser(id=uid, username=n, display_name=n.title(), email=f"{n}@bank.test", is_active=True)
               for uid, n, _ in users])
    s.add_all([m.UserRole(user_id=uid, role_id=role, tenant_id=1) for uid, _, role in users])
    s.add(m.Risk(id=5, tenant_id=1, title="Card fraud", category="operational", inherent_likelihood=4, inherent_impact=4,
                 inherent_score=16, residual_likelihood=2, residual_impact=4, residual_score=8, owner_id=RISKER))
    s.add(m.InternalControl(id=3, tenant_id=1, control_id="IC-003", name="Dual authorisation"))
    s.add(m.RCSATemplate(id=1, tenant_id=1, name="Ops", category="operational_risk", version="1.0"))
    s.add(m.RCSAQuestion(id=12, template_id=1, section="A", question_order=1, question_text="Card checks?",
                         question_type="control_rating", risk_id=5, internal_control_id=3))
    s.add(m.RCSACampaign(id=1, tenant_id=1, template_id=1, name="Q4 RCSA", period_type="quarterly", start_date=NOW,
                         due_date=NOW + timedelta(days=30), status="active", created_by=CHECKER))
    s.add_all([m.BusinessUnit(id=1, tenant_id=1, name="Retail"), m.BusinessUnit(id=2, tenant_id=1, name="Treasury")])
    s.commit()
    yield s
    s.close()


def client(db, username):
    app = FastAPI()
    app.include_router(erm_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(m.GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def notifications(monkeypatch, module):
    sent = []
    monkeypatch.setattr(module, "send_workflow_notification", lambda db_, **kw: sent.append(kw) or {"notified_users": 1})
    return sent


def to(sent):
    """Who each notification went to, in order."""
    return [sorted(kw.get("user_ids") or []) for kw in sent]


def audit(db, action):
    return db.query(m.AuditLog).filter_by(action=action).all()


# ── 1. RCSA: a configured tier approver alone approves that tier ─────────────────────────────────────────────────

def test_a_tier_with_a_configured_approver_is_approved_by_that_approver_or_their_delegate_only(db):
    db.add(m.RCSAApprovalWorkflow(id=1, tenant_id=1, name="Unit head then committee"))
    db.add_all([m.RCSAApprovalTier(workflow_id=1, tier_order=1, tier_name="Unit head", approver_type="user",
                                   approver_user_id=SECOND, can_delegate=True),
                m.RCSAApprovalTier(workflow_id=1, tier_order=2, tier_name="Committee", approver_type="role",
                                   approver_role_id=4, can_delegate=False)])
    db.query(m.RCSACampaign).filter_by(id=1).update({"approval_workflow_id": 1})
    db.add(m.RCSAAssessment(id=1, tenant_id=1, campaign_id=1, business_unit_id=1, assessor_id=MAKER, status="in_progress"))
    db.commit()
    assert client(db, "maker").post("/erm/rcsa/assessments/1/submit").status_code == 200

    checker = client(db, "checker")
    wrong = checker.post("/erm/rcsa/assessments/1/approve", json={})
    assert wrong.status_code == 403 and "Second" in wrong.json()["detail"], wrong.text
    assert checker.post("/erm/rcsa/assessments/1/reject", json={}).status_code == 403
    # nobody delegates a tier to themselves to get past its approver
    assert checker.post("/erm/rcsa/assessments/1/delegate", json={"delegate_to_user_id": CHECKER}).status_code == 403
    assert client(db, "second").post("/erm/rcsa/assessments/1/delegate",
                                     json={"delegate_to_user_id": CHECKER}).status_code == 200
    first = checker.post("/erm/rcsa/assessments/1/approve", json={})            # the delegate of tier 1
    assert first.status_code == 200 and first.json()["status"] == "under_review", first.text

    # tier 2 is the committee role: someone outside it is refused, and the role cannot delegate
    assert client(db, "second").post("/erm/rcsa/assessments/1/approve", json={}).status_code == 403
    assert client(db, "committee").post("/erm/rcsa/assessments/1/delegate",
                                        json={"delegate_to_user_id": SECOND}).status_code == 403
    done = client(db, "committee").post("/erm/rcsa/assessments/1/approve", json={})
    assert done.status_code == 200 and done.json()["status"] == "approved", done.text


# ── 2. RCSA: a finding is raised as an Issue linked to its risk and control ──────────────────────────────────────

def test_a_finding_is_raised_as_an_issue_on_its_risk_and_control_and_shows_the_issue(db):
    db.add(m.RCSAAssessment(id=1, tenant_id=1, campaign_id=1, business_unit_id=1, assessor_id=MAKER, status="approved"))
    db.add(m.RCSAFinding(id=4, tenant_id=1, assessment_id=1, finding_type="control_gap", severity="high",
                         title="Ineffective control: card checks", linked_risk_id=5, linked_internal_control_id=3))
    db.commit()
    assert client(db, "viewer").post("/erm/rcsa/findings/4/raise-issue").status_code == 403

    http = client(db, "checker")
    raised = http.post("/erm/rcsa/findings/4/raise-issue")
    assert raised.status_code == 201, raised.text
    issue = db.get(m.Issue, raised.json()["id"])
    assert (issue.source_type, issue.source_id, issue.tenant_id) == ("rcsa_finding", 4, 1)
    assert "card checks" in issue.title and issue.severity
    assert [link.risk_id for link in issue.risk_links] == [5]
    assert [link.internal_control_id for link in issue.control_links] == [3]
    assert http.post("/erm/rcsa/findings/4/raise-issue").status_code == 409            # one open issue per finding

    shown = http.get("/erm/rcsa/findings/4").json()["linked_issue"]
    assert (shown["id"], shown["code"], shown["workflow_state"]) == (issue.id, issue.code, issue.workflow_state)
    issue.workflow_state = "closed"
    db.commit()
    assert http.get("/erm/rcsa/findings/4").json()["linked_issue"]["workflow_state"] == "closed"


# ── 3. RCSA: an imported matrix is read-only on the server ───────────────────────────────────────────────────────

def test_an_imported_matrix_refuses_edits_but_still_reads(db):
    db.add(m.RCSACustomTemplate(id=1, tenant_id=1, name="Bank RCSA", original_filename="rcsa.xlsx", is_active=True,
                                column_schema={"flat_columns": [], "groups": []}, original_file=b"x"))
    db.add(m.RCSACustomRow(id=1, tenant_id=1, template_id=1, data={"risk_description": "Card fraud"}))
    db.commit()
    http = client(db, "checker")
    base = "/erm/rcsa/custom-templates/1"
    for res in (http.post(f"{base}/rows", json={"data": {"risk_description": "New"}}),
                http.put(f"{base}/rows/1", json={"data": {"risk_description": "Changed"}}),
                http.delete(f"{base}/rows/1"),
                http.post(f"{base}/import-rows", params={"replace": True})):
        assert res.status_code == 409 and "read-only" in res.json()["detail"], res.text
    db.expire_all()
    assert db.get(m.RCSACustomRow, 1).data == {"risk_description": "Card fraud"}
    assert db.query(m.RCSACustomRow).count() == 1
    assert http.get(f"{base}/rows").status_code == 200


# ── 4. RCSA: overdue assessments remind the assessor and escalate to the approver ────────────────────────────────

def test_overdue_assessments_remind_the_assessor_and_escalate_to_the_approver_after_the_grace_period(db, monkeypatch):
    sent = notifications(monkeypatch, rcsa_routes)
    db.add(m.RCSAApprovalWorkflow(id=1, tenant_id=1, name="Unit head"))
    db.add(m.RCSAApprovalTier(workflow_id=1, tier_order=1, tier_name="Unit head", approver_type="user",
                              approver_user_id=SECOND))
    db.query(m.RCSACampaign).filter_by(id=1).update({"due_date": NOW - timedelta(days=1)})     # late, within grace
    db.add(m.RCSACampaign(id=2, tenant_id=1, template_id=1, name="Q3 RCSA", start_date=NOW - timedelta(days=60),
                          due_date=NOW - timedelta(days=5), status="active", escalation_days_after=3,
                          approval_workflow_id=1, created_by=CHECKER))
    db.add_all([m.RCSAAssessment(id=1, tenant_id=1, campaign_id=1, business_unit_id=1, assessor_id=MAKER,
                                 status="in_progress"),
                m.RCSAAssessment(id=2, tenant_id=1, campaign_id=2, business_unit_id=1, assessor_id=VIEWER,
                                 status="not_started"),
                m.RCSAAssessment(id=3, tenant_id=1, campaign_id=2, business_unit_id=2, assessor_id=MAKER,
                                 status="submitted")])                                          # with the approver
    db.commit()

    result = rcsa_routes.send_overdue_reminders(db, [1], now=NOW)
    assert (result["reminded"], result["escalated"]) == (2, 1)
    by_link = {(kw["link"], tuple(kw["user_ids"])) for kw in sent}
    assert by_link == {("/erm/rcsa/assessments/1", (MAKER,)), ("/erm/rcsa/assessments/2", (VIEWER,)),
                       ("/erm/rcsa/assessments/2", (SECOND,))}

    from grc.celery_app import celery_app
    from grc.tasks import rcsa_reminders
    entry = celery_app.conf.beat_schedule["rcsa-overdue-daily-reminders"]
    assert entry["task"] == rcsa_reminders.daily_reminder_sweep.name == "grc.tasks.rcsa_reminders.daily_reminder_sweep"
    assert entry["schedule"] == 24 * 60 * 60


# ── 5. 1LINK import and seed: risk actions go on the CAPA tracker, not the frozen table ──────────────────────────

def test_the_onelink_seed_and_import_write_risk_actions_on_the_capa_tracker(db, monkeypatch):
    from openpyxl import Workbook

    from grc.modules.erm import onelink_register_import
    from grc.services.onelink_seed import seed_onelink

    summary = seed_onelink(db, 1)
    assert summary["mitigation_actions"] > 0
    rows = [{"risk_id": "R-1", "title": "Settlement failure", "description": "Settlement failure", "category": "operational",
             "sub_category": None, "inherent_likelihood": 2, "inherent_impact": 3, "inherent_score": 6.0,
             "residual_score": 4.0, "template_fields": {}, "mitigation_plan": "Daily limit monitoring",
             "risk_response": "Reduce"}]
    monkeypatch.setattr(onelink_register_import, "parse_onelink_workbook", lambda wb: rows)
    book = io.BytesIO()
    Workbook().save(book)
    imported = onelink_register_import.import_onelink_register(db, 1, book.getvalue())
    assert imported["created"] == 1 and not imported["errors"], imported

    assert db.query(m.RiskMitigationAction).count() == 0
    actions = db.query(m.IssueAction).join(m.Issue).filter(m.Issue.issue_type == "risk_treatment").all()
    assert len(actions) == summary["mitigation_actions"] + 1
    plan = next(a for a in actions if a.title == "Daily limit monitoring")
    assert plan.issue.source_id == db.query(m.Risk).filter_by(source_reference="1link-register:R-1").one().id
    assert all(a.completed_at for a in actions if a.status == "completed")


# ── 6. Framework IT risk assessment: locked once approved; reopened only on the record ───────────────────────────

def test_an_approved_framework_assessment_is_locked_until_someone_with_approve_rights_reopens_it(db):
    db.add(m.FrameworkRiskAssessment(id=9, tenant_id=1, name="SAMA CSF IT risk", status="approved", created_by=RISKER,
                                     submitted_by=RISKER, approved_by=RISKER2, approved_at=NOW))
    db.add(m.FrameworkRiskQuestion(id=91, assessment_id=9, question_text="Are backups tested?", residual_likelihood=2,
                                   residual_impact=2, residual_score=4, created_by=RISKER))
    db.commit()
    base = "/erm/framework-risk-assessments/9"
    http = client(db, "risker2")
    for res in (http.put(f"{base}/questions/91", json={"residual_likelihood": 5}),
                http.post(f"{base}/questions", json={"question_text": "Is MFA enforced?"}),
                http.delete(f"{base}/questions/91"),
                http.post(f"{base}/questions/91/evidence", files={"file": ("proof.txt", b"ok", "text/plain")}),
                http.post(f"{base}/generate-questions", json={"count": 5}),
                http.put(base, json={"status": "in_progress"})):
        assert res.status_code == 409, res.text
    # archived after approval is still locked
    assert http.put(base, json={"status": "archived"}).status_code == 200
    assert http.put(f"{base}/questions/91", json={"residual_likelihood": 5}).status_code == 409
    db.expire_all()
    assert db.get(m.FrameworkRiskQuestion, 91).residual_likelihood == 2

    assert client(db, "viewer").post(f"{base}/reopen", json={"reason": "New evidence"}).status_code == 403
    assert client(db, "risker").post(f"{base}/reopen", json={"reason": "New evidence"}).status_code == 409   # the maker
    assert http.post(f"{base}/reopen", json={"reason": " "}).status_code == 422
    reopened = http.post(f"{base}/reopen", json={"reason": "The backup test failed after approval"})
    assert reopened.status_code == 200, reopened.text
    assert (reopened.json()["status"], reopened.json()["approved_at"]) == ("in_progress", None)
    [row] = audit(db, "framework_assessment_reopened")
    assert row.user_id == RISKER2 and row.resource_id == 9 and "backup test failed" in row.changes["summary"]
    assert http.put(f"{base}/questions/91", json={"residual_likelihood": 5}).status_code == 200


# ── 7. Risk Reviews: each hand-off tells the next person ─────────────────────────────────────────────────────────

def review(db, **fields):
    row = m.RiskReview(risk_id=5, review_cycle="quarterly", review_type="periodic", due_date=NOW + timedelta(days=10),
                       reviewer_id=RISKER, **{"status": "pending", **fields})
    db.add(row)
    db.commit()
    return row.id


def test_submit_tells_the_approvers_and_approve_or_return_tells_the_reviewer(db, monkeypatch):
    sent = notifications(monkeypatch, review_routes)
    rid = review(db)
    owner, approver = client(db, "risker"), client(db, "risker2")
    assert owner.put(f"/erm/reviews/{rid}", json={"status": "submitted", "proposed_residual_likelihood": 3}).status_code == 200
    assert to(sent) == [[RISKER2, RISKER3]] and sent[0]["link"] == f"/erm/reviews?review={rid}"
    assert approver.put(f"/erm/reviews/{rid}", json={"status": "returned", "approval_notes": "Why 3?"}).status_code == 200
    assert to(sent)[1] == [RISKER] and "Why 3?" in sent[1]["message"]
    assert owner.put(f"/erm/reviews/{rid}", json={"status": "submitted"}).status_code == 200
    assert approver.put(f"/erm/reviews/{rid}", json={"status": "approved"}).status_code == 200
    assert to(sent)[2:] == [[RISKER2, RISKER3], [RISKER]]

    # a proposal another person submitted for the reviewer (an approved RCSA): neither of them is asked to approve it
    other = review(db, status="in_review")
    assert client(db, "risker3").put(f"/erm/reviews/{other}", json={"status": "submitted"}).status_code == 200
    assert to(sent)[-1] == [RISKER2]


# ── 8. Risk Reviews: an approver reassigns an unsubmitted review ─────────────────────────────────────────────────

def test_an_approver_reassigns_an_unsubmitted_review_on_the_record_and_the_new_reviewer_is_told(db, monkeypatch):
    sent = notifications(monkeypatch, review_routes)
    rid = review(db)
    assert client(db, "viewer").post(f"/erm/reviews/{rid}/reassign", json={"reviewer_id": RISKER3}).status_code == 403
    assert client(db, "risker").post(f"/erm/reviews/{rid}/reassign", json={"reviewer_id": RISKER3}).status_code == 409
    moved = client(db, "risker2").post(f"/erm/reviews/{rid}/reassign",
                                       json={"reviewer_id": RISKER3, "note": "Risker is on leave"})
    assert moved.status_code == 200 and moved.json()["reviewer_id"] == RISKER3, moved.text
    assert to(sent) == [[RISKER3]] and "Risker is on leave" in sent[0]["message"]
    [row] = audit(db, "risk_review_reassigned")
    assert row.user_id == RISKER2 and row.changes["snapshot"]["from"] == RISKER and row.changes["snapshot"]["to"] == RISKER3
    # the old update call takes the same road
    back = client(db, "risker2").put(f"/erm/reviews/{rid}", json={"reviewer_id": RISKER})
    assert back.status_code == 200 and len(audit(db, "risk_review_reassigned")) == 2 and to(sent)[-1] == [RISKER]

    client(db, "risker").put(f"/erm/reviews/{rid}", json={"status": "submitted"})
    late = client(db, "risker2").post(f"/erm/reviews/{rid}/reassign", json={"reviewer_id": RISKER3})
    assert late.status_code == 409, late.text


# ── 9. Scenarios: each hand-off tells the next person ────────────────────────────────────────────────────────────

ESTIMATES = {"title": "Card payments down for a day", "risk_ids": [5], "currency": "GBP", "one_in_years": 5,
             "loss_typical": 200_000, "loss_severe": 4_000_000, "workshop_notes": "Payments ops and IT, a full day."}


def test_scenario_run_review_approve_and_send_back_tell_the_next_person(db, monkeypatch):
    sent = notifications(monkeypatch, scenario_routes)
    runner, reviewer, approver = client(db, "risker"), client(db, "risker2"), client(db, "risker3")
    sid = runner.post("/erm/scenarios", json=ESTIMATES).json()["id"]
    assert runner.post(f"/erm/scenarios/{sid}/run", json={"iterations": 500}).status_code == 200
    assert to(sent) == [[RISKER2, RISKER3]] and sent[0]["link"] == f"/erm/analytics/scenario?id={sid}"
    assert reviewer.post(f"/erm/scenarios/{sid}/review", json={}).status_code == 200
    assert to(sent)[1] == [RISKER3]
    assert approver.post(f"/erm/scenarios/{sid}/approve", json={}).status_code == 200
    assert to(sent)[2] == [RISKER]

    other = runner.post("/erm/scenarios", json=ESTIMATES).json()["id"]
    runner.post(f"/erm/scenarios/{other}/run", json={"iterations": 500})
    assert reviewer.post(f"/erm/scenarios/{other}/send-back", json={"note": "Severe loss too low"}).status_code == 200
    assert to(sent)[-1] == [RISKER] and "Severe loss too low" in sent[-1]["message"]


# ── 10. Scenarios: a draft is deleted, an approved one never ─────────────────────────────────────────────────────

def test_a_draft_scenario_is_deleted_and_an_approved_or_running_one_is_not(db):
    db.add_all([m.RiskScenario(id=1, tenant_id=1, title="Draft", status="draft", created_by=RISKER),
                m.RiskScenario(id=2, tenant_id=1, title="Approved", status="approved", approved_by=RISKER2,
                               approved_at=NOW),
                m.RiskScenario(id=3, tenant_id=1, title="With the reviewer", status="reviewed")])
    db.commit()
    assert client(db, "checker").delete("/erm/scenarios/1").status_code == 403     # no risk delete grant
    http = client(db, "risker")
    assert http.delete("/erm/scenarios/2").status_code == 409
    assert http.delete("/erm/scenarios/3").status_code == 409
    assert http.delete("/erm/scenarios/1").status_code == 204
    db.expire_all()
    assert [s.id for s in db.query(m.RiskScenario).order_by(m.RiskScenario.id)] == [2, 3]


# ── 11. Committee packs: a pack two approvers freeze at once is frozen and filed once ────────────────────────────

def test_a_pack_frozen_by_someone_else_meanwhile_is_not_frozen_or_filed_again(db, tmp_path, monkeypatch):
    monkeypatch.setattr(committees, "MEETING_ATTACHMENT_DIR", str(tmp_path))
    db.add(m.GovernanceCommittee(id=1, tenant_id=1, name="Board Risk Committee", committee_type="risk_committee"))
    db.add(m.CommitteeMeeting(id=1, tenant_id=1, committee_id=1, title="BRC Q4", scheduled_date=NOW + timedelta(days=14)))
    db.commit()
    preparer = client(db, "risker")
    built = preparer.post("/erm/reports/generate", json={"report_type": "committee_pack", "title": "BRC pack",
                                                          "meeting_id": 1})
    assert built.status_code == 201, built.text
    pack_id = built.json()["id"]
    assert preparer.post(f"/erm/reports/packs/{pack_id}/ready").status_code == 200

    # this request read the pack while it was ready; another approver froze it before this one wrote
    stale = db.get(m.RiskReport, pack_id)
    assert stale.status == "ready"
    db.execute(text("UPDATE grc_risk_reports SET status = 'frozen', approved_by = :who WHERE id = :id"),
               {"who": RISKER3, "id": pack_id})
    late = client(db, "risker2").post(f"/erm/reports/packs/{pack_id}/freeze")
    assert late.status_code == 409, late.text
    assert db.query(m.MeetingAttachment).count() == 0
    db.expire_all()
    assert (db.get(m.RiskReport, pack_id).status, db.get(m.RiskReport, pack_id).approved_by) == ("frozen", RISKER3)
