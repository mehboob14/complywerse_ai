"""The QA re-check's last defects (2026-10-19): an archived document is changed through no route outside the document router either;
a job that started is never answered with an error because a diagnostic could not be written (a server without a console); a job's
stored error reaches the pages as a plain sentence, never a vendor's name or an HTTP code; a reviewer or approver nobody can sign for
does not hold up a stage someone else can sign, and an unknown person is refused; the AI Studio offers no Save on an archived
document. Over HTTP through the governance router, on in-memory SQLite."""
import importlib
import io
import sys
from datetime import datetime

import pytest
from fastapi import HTTPException

import grc.models as m
from grc.modules.governance.routers import gap_analysis as gap
from grc.modules.governance.routers import mappings, policy_parser

from test_document_archived_locked import LOCKED, archived  # noqa: F401  (archived is a fixture)
from test_esignature import _png
from test_governance_jobs_without_redis import REQUEST, _framework, jobs_started  # noqa: F401  (jobs_started is a fixture)
from test_governance_permissions import ADMIN, OWNER, SAM, doc, world  # noqa: F401  (world is a fixture)

KHALID = 11
AI_DOWN = "Comply Agent is not available right now. Try again later."


# ── 1. archived: no route outside the document router changes it ────────────
def test_no_route_outside_the_document_router_changes_an_archived_document(archived):
    w, db = archived, archived.db
    db.add(m.PolicyStatement(id=1, tenant_id=1, document_id=5, statement_code="PS-1", statement_text="Access is reviewed.", status="active"))
    db.add(m.DocumentApprovalStep(id=1, document_id=5, step_sequence=1, approver_id=ADMIN, status="pending"))    # an older approval
    db.get(m.PolicyGapFinding, 1).compliance_status = "not_addressed"
    db.commit()
    w.me["id"] = ADMIN                                         # may do anything, but not to an archived document
    for method, path, kw in [
        ("post", "/governance/documents/5/parse-policy", {}),
        ("post", "/governance/documents/5/statements", {"json": {"statement_text": "A new statement."}}),
        ("put", "/governance/documents/5/statements/1", {"json": {"statement_text": "Changed."}}),
        ("delete", "/governance/documents/5/statements/1", {}),
        ("post", "/governance/documents/5/statements/1/rollback", {"json": {"version_id": 1}}),
        ("post", "/governance/documents/5/reparse-proposals/apply", {"json": {"decisions": []}}),
        ("post", "/governance/documents/5/document-sync/check", {}),
        ("post", "/governance/documents/5/statements/convert-to-controls", {"json": {"statement_ids": [1]}}),
        ("post", "/governance/reviews/5/start", {}),
        ("post", "/governance/reviews/5/complete", {"json": {}}),
        ("put", "/governance/reviews/5/review-cycle", {"json": {"review_cycle_months": 6}}),
        ("post", "/governance/reviews/5/skip", {"json": {"reason": "Not needed this year at all."}}),
        ("post", "/governance/gap-analysis/findings/1/generate-fix", {}),
        ("post", "/governance/gap-analysis/document/5/recommended-controls/link", {"json": {"control_kind": "parsed", "control_id": 1}}),
        ("post", "/governance/mappings/document/5/run", {"json": {}}),
        ("post", "/governance/mappings/document/5/recommended-controls/link", {"json": {"control_kind": "parsed"}}),
        ("put", "/governance/documents/5/signoff/participants", {"json": {"reviewers": [{"target_type": "user", "target_id": SAM}]}}),
        ("post", "/governance/workflows/submit", {"json": {"document_id": 5}}),
        ("post", "/governance/workflows/steps/1/approve", {"json": {}}),           # approving would bring it out of the archive
        ("post", "/governance/workflows/steps/1/reject", {"json": {"comments": "No."}}),
        ("post", "/governance/workflows/documents/5/advance", {"json": {"action": "approve"}}),
        ("post", "/governance/workflows/documents/5/rollback", {"json": {}}),
        ("post", "/governance/workflows/documents/5/cancel", {"json": {}}),
        ("post", "/governance/documents/5/workflow/advance", {"json": {}}),
        ("post", "/governance/documents/5/workflow/reject", {"json": {}}),
    ]:
        r = getattr(w.http, method)(path, **kw)
        assert (r.status_code, r.json().get("detail")) == LOCKED, (method, path, r.text)
    admin = db.get(m.GRCUser, ADMIN)
    with pytest.raises(HTTPException) as refused:              # (the gap analysis reads the tenant from the request)
        gap.run_gap_analysis(gap.GapAnalysisRunRequest(document_id=5, run_all=True), REQUEST, db, admin)
    assert (refused.value.status_code, refused.value.detail) == LOCKED
    statements = importlib.import_module("grc.modules.compliance.routers.statements")
    with pytest.raises(HTTPException) as refused:              # a statement's own fields, through the compliance module
        statements.update_statement(1, statements.StatementUpdateRequest(priority="high"), db, admin)
    assert (refused.value.status_code, refused.value.detail) == LOCKED
    db.expire_all()
    d, s = doc(w), db.get(m.PolicyStatement, 1)
    assert (d.status, d.review_cycle_months, d.last_reviewed_at) == ("archived", 12, None)
    assert (s.statement_text, s.priority) == ("Access is reviewed.", "medium")
    assert db.query(m.PolicyStatement).count() == 1 and db.query(m.PolicyGapAnalysisRun).count() == 1
    assert db.get(m.DocumentApprovalStep, 1).status == "pending" and db.get(m.PolicyGapFinding, 1).suggested_clause_text is None


# ── 2. a started job is answered as started ──────────────────────────────────
def test_a_started_job_is_answered_as_started_on_a_server_without_a_console(world, jobs_started, monkeypatch):
    _framework(world.db)
    for name in ("stdout", "stderr"):                          # nothing can be written there (the dev servers have no console)
        dead = io.StringIO()
        dead.close()
        monkeypatch.setattr(sys, name, dead)
    owner = world.db.get(m.GRCUser, OWNER)
    policy_parser._parsing_status.pop(5, None)
    try:
        parsed = policy_parser.parse_policy_document(5, REQUEST, world.db, owner)
        assert policy_parser.maybe_autoparse_document(world.db, "cfsb", 5, OWNER) is True
    finally:
        policy_parser._parsing_status.pop(5, None)
    gaps = gap.run_gap_analysis(gap.GapAnalysisRunRequest(document_id=5, framework_ids=[7]), REQUEST, world.db, owner)
    assert (parsed["status"], parsed["task_id"], gaps["status"], gaps["task_id"]) == ("queued", "thread-parse", "queued", "thread-gap")
    assert [t[0] for t in jobs_started.threads] == ["parse", "parse", "gap"]


# ── 3. a job's stored error, as the pages read it ────────────────────────────
def test_a_jobs_stored_error_reaches_the_page_as_a_plain_sentence_and_stays_stored(world, monkeypatch):
    db, stored = world.db, "500: OpenAI integration not configured"
    for rid, error in [(2, stored), (3, "division by zero"), (4, "Framework not found")]:
        db.add(m.PolicyGapAnalysisRun(id=rid, tenant_id=1, document_id=5, status="failed", error_message=error, started_at=datetime.utcnow()))
    db.commit()
    world.me["id"] = OWNER
    runs = {r["id"]: r["error_message"] for r in world.http.get("/governance/gap-analysis/runs/5").json()["runs"]}
    assert (runs[2], runs[3], runs[4]) == (AI_DOWN, "It could not be completed. Try again.", "Framework not found")
    assert world.http.get("/governance/gap-analysis/findings/2").json()["run"]["error_message"] == AI_DOWN
    db.expire_all()
    assert db.get(m.PolicyGapAnalysisRun, 2).error_message == stored                    # kept for the logs
    policy_parser._parsing_status[5] = {"status": "failed", "error": stored, "updated_at": datetime.utcnow().isoformat()}
    try:
        status = world.http.get("/governance/documents/5/parse-status").json()         # (no tenant: the status kept in this process)
    finally:
        policy_parser._parsing_status.pop(5, None)
    assert (status["status"], status["error"]) == ("failed", AI_DOWN)
    monkeypatch.setattr("grc.job_status.get_status", lambda *a, **k: {
        "status": "failed", "error": "Error code: 401 - {'error': 'invalid api key'}", "updated_at": datetime.utcnow().isoformat()})
    state = mappings.document_mapping_run_status(5, REQUEST, db, db.get(m.GRCUser, OWNER))
    assert (state["status"], state["error"]) == ("failed", AI_DOWN)


# ── 4. a reviewer or approver nobody can sign for ────────────────────────────
def test_an_approver_nobody_can_sign_for_does_not_hold_up_the_approval_khalid_signs(world):
    db = world.db
    db.add(m.GRCUser(id=KHALID, username="khalid", display_name="Khalid Khan", email="khalid@cfsb.test"))
    db.commit()
    world.me["id"] = OWNER
    # role 23 was made by a connector: its only member is an account an access review imported
    r = world.http.put("/governance/documents/5/signoff/participants",
                       json={"approvers": [{"target_type": "role", "target_id": 23}, {"target_type": "user", "target_id": KHALID}]})
    assert r.status_code == 200, r.text
    sent = world.http.post("/governance/documents/5/signoff/send-for-review").json()
    assert sent["status"] == "pending_approval" and "can sign it" in sent["notice"]       # the notice names the role
    assert sent["progress"]["approver"] == {"required": 1, "signed": 0}
    world.me["id"] = KHALID
    signed = world.http.post("/governance/documents/5/signoff/sign", json={"signature_image": _png()})
    assert signed.status_code == 200, signed.text
    assert signed.json()["status"] == "approved" and doc(world).status == "approved"
    assert signed.json()["progress"]["approver"] == {"required": 1, "signed": 1}


def test_a_stage_of_participants_nobody_can_sign_for_keeps_its_rules(world):
    world.me["id"] = OWNER
    world.http.put("/governance/documents/5/signoff/participants", json={"approvers": [{"target_type": "role", "target_id": 23}]})
    sent = world.http.post("/governance/documents/5/signoff/send-for-review").json()
    assert sent["status"] == "draft" and doc(world).approved_at is None                      # never approved without them


def test_an_unknown_person_is_not_made_a_reviewer_or_approver(world):
    world.me["id"] = OWNER
    r = world.http.put("/governance/documents/5/signoff/participants", json={"approvers": [{"target_type": "user", "target_id": 999}]})
    assert r.status_code == 400 and r.json()["detail"] == "Nobody with user id 999 uses this platform. Choose another person."
    assert world.db.query(m.DocumentSignoffAssignment).count() == 0


# ── 8. the AI Studio on an archived document ─────────────────────────────────
def test_the_studio_offers_no_save_on_an_archived_document_and_says_it_is_archived(archived):
    archived.me["id"] = OWNER                                  # its owner: may save it once it is restored
    got = archived.http.get(f"/governance/studio/sessions/{archived.sid}").json()
    assert (got["may_save"], got["document_status"]) == (False, "archived")
