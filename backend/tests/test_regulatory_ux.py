"""What the revamped Regulatory Changes / Feed screens read (additive): the register's true total and per-row counts, the Overview's counters, My work,
the people the pickers offer, and the feed's "not relevant" state with its true counts. The feed payload never carries a model name."""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    AuditLog, Base, GRCUser, RegulatoryChange, RegulatoryFeedAssignment, RegulatoryFeedItem, RegulatoryFeedSource, RegulatoryImpactAssessment,
    RegulatoryImplementationTask, RegulatoryLink, RegulatoryObligation, Role, Tenant, UserRole, get_db,
)
from grc.modules.governance.routers import regulatory_changes, regulatory_feeds
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, Role, UserRole, RegulatoryChange, RegulatoryImpactAssessment, RegulatoryImplementationTask, RegulatoryObligation, RegulatoryLink,
           RegulatoryFeedSource, RegulatoryFeedItem, RegulatoryFeedAssignment, AuditLog]


def _day(offset: int) -> datetime:
    return datetime.combine(datetime.utcnow().date(), datetime.min.time()) + timedelta(days=offset)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([GRCUser(id=7, username="officer", display_name="Officer", email="o@bank.test", is_active=True, department="Compliance"),
               GRCUser(id=8, username="ayesha", display_name="Ayesha", email="a@bank.test", is_active=True),
               GRCUser(id=9, username="gone", display_name="Gone", email="g@bank.test", is_active=False)])
    s.add(Role(id=3, name="Compliance Officer"))
    s.add(UserRole(user_id=7, role_id=3, tenant_id=1))
    # change 1: open, effective in 10 days, 3 obligations (one removed), one met by a confirmed control, one suggestion; change 2: completed
    s.add(RegulatoryChange(id=1, tenant_id=1, title="Cyber resilience", source="SBP", status="under_assessment", priority="high", created_by=7,
                           assigned_to=7, effective_date=_day(10)))
    s.add(RegulatoryChange(id=2, tenant_id=1, title="Old circular", source="SAMA", status="completed", priority="low", created_by=7))
    s.add(RegulatoryChange(id=3, tenant_id=1, title="In force already", source="SBP", status="identified", priority="medium", created_by=7,
                           effective_date=_day(-5)))
    s.add_all([
        RegulatoryObligation(id=10, tenant_id=1, regulatory_change_id=1, summary="Report incidents", source="ai", verified=False, owner_id=7, owner_ids=[7]),
        RegulatoryObligation(id=11, tenant_id=1, regulatory_change_id=1, summary="Keep logs", source="ai", verified=True, compliance_status="compliant"),
        RegulatoryObligation(id=12, tenant_id=1, regulatory_change_id=1, summary="Removed one", source="ai", verified=True, deleted_at=datetime.utcnow()),
        RegulatoryObligation(id=13, tenant_id=1, regulatory_change_id=2, summary="Closed change duty", source="manual"),
    ])
    s.add_all([
        RegulatoryLink(id=1, tenant_id=1, regulatory_change_id=1, obligation_id=11, target_type="control", target_id=1, status="confirmed", source="manual"),
        RegulatoryLink(id=2, tenant_id=1, regulatory_change_id=1, obligation_id=10, target_type="control", target_id=2, status="proposed", source="ai"),
        RegulatoryLink(id=3, tenant_id=1, regulatory_change_id=1, obligation_id=12, target_type="control", target_id=3, status="confirmed", source="manual"),
    ])
    s.add_all([
        RegulatoryImplementationTask(id=1, tenant_id=1, regulatory_change_id=1, title="Late one", task_type="process_change", status="in_progress",
                                     due_date=_day(-2), assigned_to=7, assignee_ids=[7, 8]),
        RegulatoryImplementationTask(id=2, tenant_id=1, regulatory_change_id=1, title="Due today", task_type="process_change", status="pending", due_date=_day(0)),
        RegulatoryImplementationTask(id=3, tenant_id=1, regulatory_change_id=1, title="Done", task_type="process_change", status="completed", due_date=_day(-9)),
        RegulatoryImplementationTask(id=4, tenant_id=1, regulatory_change_id=2, title="On the closed one", task_type="process_change", status="pending", due_date=_day(-9)),
    ])
    s.add(RegulatoryFeedSource(id=1, tenant_id=1, name="SBP news", source_url="https://example.test/rss", regulator="SBP"))
    s.add_all([
        RegulatoryFeedItem(id=1, tenant_id=1, feed_source_id=1, guid="a", title="New one", status="new"),
        RegulatoryFeedItem(id=2, tenant_id=1, feed_source_id=1, guid="b", title="Read one", status="analyzed",
                           ai_analysis={"summary": "s", "priority": "high", "model_used": "gpt-x", "analyzed_at": "2026-11-01T00:00:00"}),
        RegulatoryFeedItem(id=3, tenant_id=1, feed_source_id=1, guid="c", title="Made a change", status="processed", regulatory_change_id=1),
    ])
    s.add(RegulatoryFeedAssignment(tenant_id=1, feed_source_id=1, assignee_type="role", role_id=3))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db):
    app = FastAPI()
    app.include_router(regulatory_changes.router)
    app.include_router(regulatory_feeds.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_the_register_says_how_many_match_and_counts_obligations_met_and_late_tasks_per_row(http):
    r = http.get("/regulatory-changes/changes", params={"limit": 2})
    assert r.status_code == 200
    assert r.headers["X-Total-Count"] == "3", "the true total, not the page"
    assert len(r.json()) == 2
    rows = {c["id"]: c for c in http.get("/regulatory-changes/changes").json()}
    one = rows[1]
    assert (one["obligation_count"], one["met_count"]) == (2, 1), "a removed obligation is not counted, nor is its link"
    assert (one["to_check_count"], one["suggestion_count"]) == (1, 1), "the unverified AI obligation, the undecided suggestion"
    assert one["late_task_count"] == 1, "late = not completed and the due DAY has passed: due today is not late, a completed one is not"
    assert rows[2]["obligation_count"] == 1 and rows[2]["met_count"] == 0
    assert http.get("/regulatory-changes/changes", params={"status": "completed"}).headers["X-Total-Count"] == "1"


def test_the_detail_of_a_change_still_answers_with_the_old_fields(http):
    one = http.get("/regulatory-changes/changes/1").json()
    assert one["task_count"] == 3 and one["completed_task_count"] == 1 and one["late_task_count"] == 1


def test_the_overview_counts_the_changes_being_worked_on_not_a_page(http):
    o = http.get("/regulatory-changes/overview").json()
    assert o["changes"] == {"open": 2, "by_status": {"under_assessment": 1, "identified": 1}, "effective_soon": 1, "in_force": 1}
    ob = o["obligations"]
    assert ob["total"] == 2 and ob["met"] == 1 and ob["suggestions"] == 1 and ob["to_check"] == 1
    assert ob["without_control"] == 0, "one is met, the other has a suggestion"
    assert ob["by_compliance"] == {"not_assessed": 1, "compliant": 1}
    assert o["tasks"] == {"open": 2, "late": 1, "unassigned": 1}, "the closed change's task is not this programme's work"
    assert o["feed"]["new"] == 1


def test_my_work_is_what_waits_for_the_signed_in_person(http):
    w = http.get("/regulatory-changes/my-work").json()
    assert [t["title"] for t in w["tasks"]] == ["Late one"] and w["tasks"][0]["late"] is True and w["tasks_total"] == 1
    assert [o["summary"] for o in w["obligations"]] == ["Report incidents"] and w["obligations"][0]["change_title"] == "Cyber resilience"
    assert [c["title"] for c in w["changes"]] == ["Cyber resilience"]
    assert w["feed_new"] == 1, "the new item of a source assigned to a role the person holds"


def test_the_people_lists_need_no_administrator_right_and_leave_out_inactive_accounts(http):
    p = http.get("/regulatory-changes/people").json()
    assert [u["display_name"] for u in p["users"]] == ["Ayesha", "Officer"]
    assert {u["id"]: u["department"] for u in p["users"]} == {7: "Compliance", 8: None}
    assert p["roles"] == [{"id": 3, "name": "Compliance Officer", "user_count": 1}]


def test_the_feed_counts_are_true_and_the_payload_never_names_a_model(http):
    assert http.get("/regulatory-feeds/items/counts").json() == {"new": 1, "analyzed": 1, "processed": 1, "ignored": 0, "total": 3}
    item = http.get("/regulatory-feeds/items/2").json()
    assert "model_used" not in item["ai_analysis"] and item["ai_analysis"]["summary"] == "s"
    assert all("model_used" not in (i["ai_analysis"] or {}) for i in http.get("/regulatory-feeds/items").json())


def test_not_relevant_takes_an_item_out_and_restore_brings_it_back_to_where_it_was(http):
    assert http.post("/regulatory-feeds/items/2/dismiss").json()["status"] == "ignored"
    assert http.post("/regulatory-feeds/items/1/dismiss").json()["status"] == "ignored"
    assert http.get("/regulatory-feeds/items/counts").json()["ignored"] == 2
    assert sorted(i["id"] for i in http.get("/regulatory-feeds/items", params={"status": "ignored"}).json()) == [1, 2]
    assert http.post("/regulatory-feeds/items/2/restore").json()["status"] == "analyzed", "the AI had read it"
    assert http.post("/regulatory-feeds/items/1/restore").json()["status"] == "new"
    assert http.post("/regulatory-feeds/items/1/restore").status_code == 400, "it was not dismissed any more"


def test_an_item_that_already_became_a_change_cannot_be_dismissed(http):
    r = http.post("/regulatory-feeds/items/3/dismiss")
    assert r.status_code == 400 and "regulatory change" in r.json()["detail"]
    assert http.get("/regulatory-feeds/items/3").json()["status"] == "processed"


def test_another_organisation_s_item_is_not_found(http, db):
    db.add(Tenant(id=2, name="Other", slug="other"))
    db.add(RegulatoryFeedItem(id=9, tenant_id=2, feed_source_id=1, guid="z", title="Not ours", status="new"))
    db.commit()
    assert http.post("/regulatory-feeds/items/9/dismiss").status_code == 404
    assert http.post("/regulatory-feeds/items/999/dismiss").status_code == 404
