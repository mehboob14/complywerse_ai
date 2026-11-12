"""Risk Reviews (wave 2-H): a review proposes, a second person approves, and only the approval changes the risk.

Scheduled -> in review (the risk owner starts) -> submitted (proposed likelihood / impact, findings; the risk unchanged) ->
approved by someone other than the reviewer (scores written with the review as the reason, next review scheduled by the
residual band) or returned with a note (back to in review). Non-admin roles throughout. In-memory SQLite, the real /erm router.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GRCUser, Permission, Risk, RiskReview, RiskScoreHistory, Role, RolePermission, Tenant,
                        UserRole, get_db)
from grc.modules.erm.router import router as erm_router
from grc.routers.auth_router import create_access_token, require_auth

OWNER, CHECKER, VIEWER = 7, 8, 9


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Risk editor"), Role(id=2, name="Risk viewer")])
    perms = {1: "erm:risks:view", 2: "erm:risks:edit", 3: "erm:risks:create"}
    s.add_all([Permission(id=i, name=n, resource="erm:risks", action=n.rsplit(":", 1)[1]) for i, n in perms.items()])
    s.add_all([RolePermission(role_id=1, permission_id=p) for p in (1, 2, 3)] + [RolePermission(role_id=2, permission_id=1)])
    s.add_all([GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True)
               for uid, name in ((OWNER, "owner"), (CHECKER, "checker"), (VIEWER, "viewer"))])
    s.add_all([UserRole(user_id=OWNER, role_id=1, tenant_id=1), UserRole(user_id=CHECKER, role_id=1, tenant_id=1),
               UserRole(user_id=VIEWER, role_id=2, tenant_id=1)])
    s.commit()
    yield s
    s.close()


def client(db, username="owner"):
    app = FastAPI()
    app.include_router(erm_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def add_risk(db, title="Payments outage", **fields):
    fields = {"inherent_likelihood": 4, "inherent_impact": 4, "inherent_score": 16, "residual_likelihood": 3,
              "residual_impact": 3, "residual_score": 9, "owner_id": OWNER, **fields}
    risk = Risk(tenant_id=1, title=title, category="operational", **fields)
    db.add(risk)
    db.commit()
    return risk.id


def scheduled(db, risk_id, reviewer=OWNER):
    due = (datetime.utcnow() + timedelta(days=7)).isoformat()
    made = client(db, "checker").post("/erm/reviews", json={"risk_id": risk_id, "due_date": due, "reviewer_id": reviewer})
    assert made.status_code == 201, made.text
    return made.json()["id"]


def submit(db, review_id, username="owner", **proposal):
    body = {"status": "submitted", "findings": "Control failed twice this quarter",
            "proposed_residual_likelihood": 4, "proposed_residual_impact": 4, **proposal}
    return client(db, username).put(f"/erm/reviews/{review_id}", json=body)


def near(when, days):
    return abs((datetime.fromisoformat(str(when)) - (datetime.utcnow() + timedelta(days=days))).total_seconds()) < 300


def open_reviews(db, risk_id):
    return db.query(RiskReview).filter(RiskReview.risk_id == risk_id,
                                       RiskReview.status.in_(("pending", "in_review", "submitted"))).all()


def test_starting_keeps_the_reviewer_and_submitting_leaves_the_risk_as_it_was(db):
    risk_id = add_risk(db)
    review_id = scheduled(db, risk_id)

    started = client(db, "checker").put(f"/erm/reviews/{review_id}", json={"status": "in_review"}).json()
    assert started["status"] == "in_review" and started["reviewer_id"] == OWNER and started["started_at"]

    sent = submit(db, review_id)
    assert sent.status_code == 200, sent.text
    body = sent.json()
    assert body["status"] == "submitted" and body["completed_at"] is None
    assert (body["proposed_residual_likelihood"], body["proposed_residual_impact"]) == (4, 4)
    risk = db.get(Risk, risk_id)
    db.refresh(risk)
    assert (risk.residual_likelihood, risk.residual_impact, risk.residual_score) == (3, 3, 9), "a submission is a proposal"
    assert db.query(RiskScoreHistory).count() == 0
    assert client(db, "viewer").put(f"/erm/reviews/{review_id}", json={"status": "approved"}).status_code == 403


def test_the_reviewer_cannot_approve_and_another_writes_the_scores_with_the_review_as_the_reason(db):
    risk_id = add_risk(db)
    review_id = scheduled(db, risk_id)
    submit(db, review_id)

    own = client(db, "owner").put(f"/erm/reviews/{review_id}", json={"status": "approved"})
    assert own.status_code == 409, own.text
    assert db.get(RiskReview, review_id).status == "submitted"

    approved = client(db, "checker").put(f"/erm/reviews/{review_id}", json={"status": "approved", "approval_notes": "Agreed"})
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["status"] == "approved" and body["approver_id"] == CHECKER and body["completed_at"]
    assert (body["previous_residual_score"], body["new_residual_score"]) == (9, 16)
    assert (body["previous_inherent_score"], body["new_inherent_score"]) == (16, 16)
    risk = db.get(Risk, risk_id)
    db.refresh(risk)
    assert (risk.residual_likelihood, risk.residual_impact, risk.residual_score) == (4, 4, 16)
    history = db.query(RiskScoreHistory).one()
    assert history.residual_score == 16 and history.changed_by == CHECKER
    assert history.reason.startswith(f"Review #{review_id}: Control failed twice")
    assert risk.review_date is not None and near(risk.review_date, 180), "high band: the next review in 180 days"
    assert client(db, "checker").put(f"/erm/reviews/{review_id}", json={"findings": "x"}).status_code == 409, \
        "an approved review is closed"


def test_whoever_submitted_cannot_approve_either(db):
    review_id = scheduled(db, add_risk(db))
    submit(db, review_id, username="checker")      # on the reviewer's behalf
    assert client(db, "checker").put(f"/erm/reviews/{review_id}", json={"status": "approved"}).status_code == 409


def test_returning_needs_a_note_and_sends_the_review_back_to_in_review(db):
    risk_id = add_risk(db)
    review_id = scheduled(db, risk_id)
    submit(db, review_id)

    bare = client(db, "checker").put(f"/erm/reviews/{review_id}", json={"status": "returned"})
    assert bare.status_code == 422, bare.text
    back = client(db, "checker").put(f"/erm/reviews/{review_id}",
                                     json={"status": "returned", "approval_notes": "Show the failed test evidence"})
    assert back.status_code == 200, back.text
    assert back.json()["status"] == "in_review" and back.json()["approval_notes"] == "Show the failed test evidence"
    risk = db.get(Risk, risk_id)
    db.refresh(risk)
    assert risk.residual_score == 9
    assert client(db, "checker").put(f"/erm/reviews/{review_id}", json={"status": "approved"}).status_code == 409, \
        "only a submitted review can be approved"
    assert submit(db, review_id).json()["status"] == "submitted"


def test_the_next_review_is_scheduled_by_the_residual_band_without_duplicates(db):
    critical = add_risk(db, "Core banking outage")
    review_id = scheduled(db, critical)
    submit(db, review_id, proposed_residual_likelihood=5, proposed_residual_impact=4)
    client(db, "checker").put(f"/erm/reviews/{review_id}", json={"status": "approved"})
    [nxt] = open_reviews(db, critical)
    assert nxt.status == "pending" and nxt.reviewer_id == OWNER and near(nxt.due_date, 90)
    assert db.get(Risk, critical).review_date == nxt.due_date

    low = add_risk(db, "Stationery theft", owner_id=None)
    review_id = scheduled(db, low, reviewer=OWNER)
    submit(db, review_id, proposed_residual_likelihood=1, proposed_residual_impact=2)
    client(db, "checker").put(f"/erm/reviews/{review_id}", json={"status": "approved"})
    [nxt] = open_reviews(db, low)
    assert near(nxt.due_date, 365) and nxt.reviewer_id is None, "no risk owner: nobody assigned"

    # An open review is already on the risk: approving another one does not add a second.
    twice = add_risk(db, "Card fraud")
    first, second = scheduled(db, twice), scheduled(db, twice)
    submit(db, first)
    client(db, "checker").put(f"/erm/reviews/{first}", json={"status": "approved"})
    assert [r.id for r in open_reviews(db, twice)] == [second]


def test_schedule_due_creates_one_review_per_active_risk_without_an_open_one(db):
    unreviewed = add_risk(db, "Ledger outage")
    covered = add_risk(db, "ATM cash-out")
    scheduled(db, covered)
    ownerless = add_risk(db, "Branch flood", owner_id=None)
    add_risk(db, "Retired product", status="closed")

    assert client(db, "viewer").post("/erm/reviews/schedule-due").status_code == 403
    made = client(db, "checker").post("/erm/reviews/schedule-due")
    assert made.status_code == 200, made.text
    body = made.json()
    assert sorted(r["risk_id"] for r in body["created"]) == [unreviewed, ownerless]
    assert {r["risk_id"]: r["reviewer_id"] for r in body["created"]} == {unreviewed: OWNER, ownerless: None}
    assert [r["risk_id"] for r in body["without_owner"]] == [ownerless]
    assert [len(open_reviews(db, r)) for r in (unreviewed, covered, ownerless)] == [1, 1, 1]
    assert client(db, "checker").post("/erm/reviews/schedule-due").json()["created"] == [], "no duplicates"


def test_the_old_completed_call_is_a_submit(db):
    risk_id = add_risk(db)
    review_id = scheduled(db, risk_id)
    done = client(db, "owner").put(f"/erm/reviews/{review_id}",
                                   json={"status": "completed", "new_residual_score": 6, "findings": "ok"})
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "submitted" and done.json()["completed_at"] is None
    assert db.query(RiskScoreHistory).count() == 0 and db.get(Risk, risk_id).residual_score == 9

    approved = client(db, "checker").put(f"/erm/reviews/{review_id}", json={"status": "approved"})
    assert approved.status_code == 200, approved.text
    risk = db.get(Risk, risk_id)
    db.refresh(risk)
    assert risk.residual_score == 6 and db.query(RiskScoreHistory).one().reason == f"Review #{review_id}: ok"
