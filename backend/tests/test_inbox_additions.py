"""Needs my action (the shared inbox): the additive server pieces the page reads (G3_inbox_contract A1-A4 and the digest link).

* A1  GET /governance/documents/lifecycle/mine rows also say when they were asked and by whom (a strict superset of the old keys);
* A2  GET /governance/documents/lifecycle/sent  - the workflow requests the person asked of others that still wait ("Sent by me");
* A3  GET /compliance/assessments/pending-approvals rows say whether the item is addressed to the person and who submitted it;
* A4  GET /governance/documents/signoff/my-pending rows say when the review round began;
* the digest of several acknowledgements opens the inbox on its acknowledgements.
Nothing here changes who may see or do what: the lists stay open to anyone signed in and show only the person's own queue.
SQLite, over HTTP through the whole governance router; the worlds are the ones of test_document_lifecycle and test_security_hotfix."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import grc.models as m
from grc.modules.governance import doc_lifecycle as life
from grc.modules.governance.router import router as governance_router
from grc.modules.governance.routers import document_signoff as signoff
from grc.routers.auth_router import require_auth

from test_document_lifecycle import _secret, doc, obligations, participants, sent_emails, sign, user, world   # noqa: F401  (fixtures + helpers)
from test_security_hotfix import ADMIN, APPROVER_U, ASMTEDIT, PLAIN, ROLEAPPR, STAFF, w   # noqa: F401  (the evidence-approval world)

OLD_KEYS = {"id", "kind", "document_id", "title", "doc_type", "status", "version", "due_date", "overdue", "escalation_level", "again", "proposal_id"}


@pytest.fixture
def http(world):
    """The CFSB world behind the whole governance router; ``me["id"]`` is who asks (Olivia owns document 5)."""
    db = world.factory()
    me = {"id": 1}
    app = FastAPI()
    app.include_router(governance_router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, me["id"])
    yield SimpleNamespace(db=db, me=me, c=TestClient(app))
    db.close()


def as_(http, uid):
    http.me["id"] = uid
    return http.c


def ask(db, document_id, kind, to, by=1, due_days=3, hours=1, **extra):
    """A request that waits, made directly (the flows are tested in test_document_lifecycle)."""
    ob = m.DocumentObligation(tenant_id=1, document_id=document_id, kind=kind, user_id=to, status="pending", requested_by=by,
                              requested_at=datetime.utcnow() - timedelta(hours=hours),
                              due_date=None if due_days is None else datetime.utcnow() + timedelta(days=due_days), **extra)
    db.add(ob)
    db.flush()
    return ob


def add_doc(db, did, owner=1, title=None, status="draft"):
    db.add(m.GovernanceDocument(id=did, tenant_id=1, title=title or f"Policy {did}", doc_type="policy", status=status, current_version="1.0",
                                owner_id=owner, author_id=owner))
    db.flush()


# ── A1 ───────────────────────────────────────────────────────────────────────
def test_my_requests_say_when_they_were_asked_and_by_whom_and_lose_no_key(http):
    db = http.db
    participants(db)
    signoff.send_for_review(5, db, user(db, 1))
    items = as_(http, 2).get("/governance/documents/lifecycle/mine").json()["items"]
    assert len(items) == 1 and OLD_KEYS <= set(items[0])
    row = items[0]
    assert (row["kind"], row["requested_by_id"], row["requested_by_name"]) == ("review", 1, "Olivia Owner")
    assert datetime.fromisoformat(row["requested_at"]) <= datetime.utcnow()
    assert row["due_date"] and row["title"] == "Access policy" and row["status"] == "pending_review"


def test_a_request_nobody_made_by_hand_says_so_instead_of_inventing_a_requester(http):
    db = http.db
    d = doc(db)
    d.status = "published"
    life.ensure_acknowledgements(db, d, None)             # the daily sweep and a publication by the system ask in nobody's name
    db.commit()
    (row,) = [i for i in as_(http, 6).get("/governance/documents/lifecycle/mine").json()["items"] if i["kind"] == "acknowledgement"]
    assert row["requested_by_id"] is None and row["requested_by_name"] is None and row["requested_at"]


# ── A2 ───────────────────────────────────────────────────────────────────────
def test_sent_lists_my_open_requests_of_other_people_one_row_per_document_and_kind(http):
    db = http.db
    participants(db)
    signoff.send_for_review(5, db, user(db, 1))
    out = as_(http, 1).get("/governance/documents/lifecycle/sent").json()
    assert out["enabled"] is True and out["total"] == 1 and out["truncated"] is False
    (row,) = out["items"]
    assert (row["document_id"], row["title"], row["doc_type"], row["kind"], row["status"]) == (5, "Access policy", "policy", "review", "pending_review")
    assert row["pending"] == 2 and row["waiting"] == ["Rana Reviewer", "Rafay Reviewer"] and row["waiting_more"] == 0
    assert row["overdue"] is False and row["escalated"] is False and row["proposal_id"] is None
    assert datetime.fromisoformat(row["next_due"]) > datetime.utcnow() and row["oldest_requested_at"]
    for uid in (2, 3, 6):                                     # the people asked, and someone who asked nothing, have nothing sent
        assert as_(http, uid).get("/governance/documents/lifecycle/sent").json()["items"] == [], uid
    sign(db, 2)                                               # one answered: one still waits
    (row,) = as_(http, 1).get("/governance/documents/lifecycle/sent").json()["items"]
    assert row["pending"] == 1 and row["waiting"] == ["Rafay Reviewer"]


def test_a_request_made_when_the_previous_person_signed_is_that_persons_not_the_authors(http):
    db = http.db
    participants(db)
    signoff.send_for_review(5, db, user(db, 1))
    sign(db, 2)
    sign(db, 3)                                               # the review is done: the approvers are asked, by the last signer
    assert {o.requested_by for o in obligations(db, "approval")} == {3}
    assert as_(http, 1).get("/governance/documents/lifecycle/sent").json()["items"] == []
    (row,) = as_(http, 3).get("/governance/documents/lifecycle/sent").json()["items"]
    assert (row["kind"], row["pending"], row["waiting"]) == ("approval", 2, ["Mina Manager", "Mo Manager"])


def test_what_i_asked_of_myself_is_not_sent(http):
    db = http.db
    ask(db, 5, "approval", to=1, by=1)
    db.commit()
    assert as_(http, 1).get("/governance/documents/lifecycle/sent").json() == {"enabled": True, "total": 0, "truncated": False, "items": []}


def test_sent_names_three_people_and_counts_the_rest_and_groups_proposed_changes_apart(http):
    db = http.db
    for uid in (2, 3, 4, 5, 6):
        ask(db, 5, "review", to=uid)
    ask(db, 5, "decide", to=2, proposal_id=11)
    ask(db, 5, "decide", to=3, proposal_id=12)
    db.commit()
    rows = as_(http, 1).get("/governance/documents/lifecycle/sent").json()["items"]
    review = next(r for r in rows if r["kind"] == "review")
    assert review["pending"] == 5 and review["waiting"] == ["Rana Reviewer", "Rafay Reviewer", "Mina Manager"] and review["waiting_more"] == 2
    assert sorted(r["proposal_id"] for r in rows if r["kind"] == "decide") == [11, 12]          # one row per proposed change


def test_sent_puts_overdue_first_then_the_soonest_due_and_flags_escalation(http):
    db = http.db
    for did in (6, 7, 8, 9):
        add_doc(db, did)
    ask(db, 6, "review", to=2, due_days=5)
    ask(db, 7, "approval", to=2, due_days=1)
    ask(db, 8, "review", to=2, due_days=None)                                    # no due date: last of the ones that wait
    ask(db, 9, "review", to=2, due_days=-3, escalation_level=1)
    db.commit()
    rows = as_(http, 1).get("/governance/documents/lifecycle/sent").json()["items"]
    assert [r["document_id"] for r in rows] == [9, 7, 6, 8]
    assert (rows[0]["overdue"], rows[0]["escalated"]) == (True, True) and rows[1]["overdue"] is False and rows[3]["next_due"] is None
    assert rows[2]["escalated"] is False


def test_sent_is_cut_at_two_hundred_rows_and_still_says_the_true_total(http):
    db = http.db
    for did in range(100, 305):
        add_doc(db, did)
        ask(db, did, "review", to=2, due_days=1 + did % 30)
    db.commit()
    out = as_(http, 1).get("/governance/documents/lifecycle/sent").json()
    assert out["total"] == 205 and out["truncated"] is True and len(out["items"]) == 200


def test_sent_takes_the_workflow_kinds_only_and_refuses_the_rest_in_words(http):
    db = http.db
    ask(db, 5, "review", to=2, due_days=2)
    ask(db, 5, "changes", to=3, due_days=3)                                     # a day later: the order below does not depend on the clock's resolution
    db.commit()
    c = as_(http, 1)
    assert {r["kind"] for r in c.get("/governance/documents/lifecycle/sent").json()["items"]} == {"review", "changes"}
    assert [r["kind"] for r in c.get("/governance/documents/lifecycle/sent?kinds=changes").json()["items"]] == ["changes"]
    assert [r["kind"] for r in c.get("/governance/documents/lifecycle/sent?kinds=review,%20changes").json()["items"]] == ["review", "changes"]
    for bad in ("acknowledgement", "review,bogus"):
        r = c.get(f"/governance/documents/lifecycle/sent?kinds={bad}")
        assert r.status_code == 400 and "Unknown kind" in r.json()["detail"], bad


def test_sent_never_names_a_document_the_person_may_not_read(http):
    db = http.db
    add_doc(db, 6, owner=6)                                   # Uma's draft: Olivia neither owns it, nor is asked, nor holds a library right
    ask(db, 5, "review", to=2)
    ask(db, 6, "review", to=2)
    db.commit()
    rows = as_(http, 1).get("/governance/documents/lifecycle/sent").json()["items"]
    assert [r["document_id"] for r in rows] == [5] and "Policy 6" not in str(rows)


def test_sent_is_off_where_the_life_cycle_is_off_and_open_to_anyone_signed_in(http, monkeypatch):
    db = http.db
    ask(db, 5, "review", to=2)
    db.commit()
    assert as_(http, 7).get("/governance/documents/lifecycle/sent").status_code == 200          # Adam holds no library right and asked nothing: an empty list, not a refusal
    monkeypatch.setattr("grc.config.DOCUMENT_LIFECYCLE_TENANTS", frozenset({"cfsb"}))
    db.query(m.Tenant).one().slug = "acme"
    db.commit()
    assert as_(http, 1).get("/governance/documents/lifecycle/sent").json() == {"enabled": False, "items": []}


def test_the_sent_route_is_not_taken_by_a_document_route(http):
    r = as_(http, 1).get("/governance/documents/lifecycle/sent")
    assert r.status_code == 200 and r.json()["enabled"] is True                                 # not 404 / 422 from /{document_id}/...


# ── A4 ───────────────────────────────────────────────────────────────────────
def test_documents_waiting_for_my_signature_say_when_the_round_began(world):
    with world.factory() as db:
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        (row,) = signoff.my_pending_signoffs(db, user(db, 2))["items"]
        assert row["round_started_at"] == doc(db).signoff_round_at.isoformat() and {"document_id", "title", "stage_name", "updated_at"} <= set(row)


# ── the digest ───────────────────────────────────────────────────────────────
def test_the_digest_of_several_documents_opens_the_inbox_on_its_acknowledgements(world, monkeypatch):
    import grc.modules.workflow_engine.services.notification_service as ns

    calls, real = [], ns.send_workflow_notification
    monkeypatch.setattr(ns, "send_workflow_notification", lambda db, **kw: (calls.append((kw["subject"], kw.get("link"))), real(db, **kw))[1])
    sent_emails(monkeypatch)
    with world.factory() as db:
        add_doc(db, 6, title="Backup policy", status="published")
        d = doc(db)
        d.status = "published"
        life.ensure_acknowledgements(db, d, 1)
        life.ensure_acknowledgements(db, db.get(m.GovernanceDocument, 6), 1)
        db.commit()
        calls.clear()
        life.sweep(db)
    digests = [link for subject, link in calls if subject == "2 documents to acknowledge"]
    assert digests and set(digests) == {life.INBOX_ACK_LINK} == {"/needs-my-action?section=ack"}


# ── A3 ───────────────────────────────────────────────────────────────────────
def test_evidence_to_approve_says_which_items_are_addressed_to_the_person(w):
    db, as_user = w
    db.get(m.AssessmentItemEvidence, 1).submitted_by = STAFF
    db.commit()

    def rows(uid):
        data = as_user(uid).get("/compliance/assessments/pending-approvals").json()
        assert data["total"] == len(data["pending_approvals"])
        return {i["id"]: i for i in data["pending_approvals"]}

    assert rows(PLAIN) == {}
    assert {i: r["addressed_to_me"] for i, r in rows(APPROVER_U).items()} == {1: True}              # the tier-1 user approver
    assert {i: r["addressed_to_me"] for i, r in rows(ROLEAPPR).items()} == {2: True}                # a member of the tier-2 role
    for uid in (ADMIN, ASMTEDIT):                                                                     # they can decide both, neither is addressed to them
        got = rows(uid)
        assert {i: (r["addressed_to_me"], r["can_approve"]) for i, r in got.items()} == {1: (False, True), 2: (False, True)}
    assert rows(ADMIN)[1]["submitted_by_name"] == "Sam" and rows(ADMIN)[2]["submitted_by_name"] is None
    assert {"id", "evidence_id", "evidence_name", "assessment_id", "assessment_name", "item_number", "control_description", "current_tier",
            "status", "workflow_name", "can_approve", "submitted_at"} <= set(rows(ADMIN)[1])         # the old keys are all still there


def test_an_administrator_who_is_the_tier_approver_is_addressed(w):
    db, as_user = w
    db.get(m.AssessmentEvidenceApprovalTier, 1).approver_user_id = ADMIN
    db.commit()
    rows = {i["id"]: i["addressed_to_me"] for i in as_user(ADMIN).get("/compliance/assessments/pending-approvals").json()["pending_approvals"]}
    assert rows == {1: True, 2: False}
