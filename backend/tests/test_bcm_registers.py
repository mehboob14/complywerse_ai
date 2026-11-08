"""Business Continuity registers (the Plans, Drills and Findings explorers of the UX revamp): the lean lists answer the same rows as the default lists with the counts the quick
views read, the findings register (filters, derived state, totals, owner and due day), the Overview's two additive blocks (`attention`, `mine`) and which lists they hold for whom,
the evidence a drill's result can point to, and the length and range limits that used to be a bare 500. In-memory SQLite; the routes are called directly (their permission
dependency is the same `bcm:*` key as before, and is passed as already satisfied)."""
import importlib
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

from datetime import datetime, timedelta  # noqa: E402

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from pydantic import ValidationError  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402

plans = importlib.import_module("grc.modules.bcm.routers.plans")
drills = importlib.import_module("grc.modules.bcm.routers.drills")
dash = importlib.import_module("grc.modules.bcm.routers.dashboard")

ADMIN, ANNA, VIC, VIEWER = 1, 2, 3, 4          # an administrator (the tenant's contact), two people who own things, and a person who may only view drills
NOW = datetime.utcnow()


@pytest.fixture
def w():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="CFSB", slug="cfsb", primary_contact_email="admin@cfsb.test"))
    for uid, name, email in [(ADMIN, "Ada Admin", "admin@cfsb.test"), (ANNA, "Anna Owner", "anna@cfsb.test"), (VIC, "Vic Owner", "vic@cfsb.test"), (VIEWER, "Vera Viewer", "vera@cfsb.test")]:
        db.add(m.GRCUser(id=uid, username=name.split()[0].lower(), password_hash="x", display_name=name, email=email))
    # the tenant's contact is its administrator; anna and vic hold the four view rights; vera holds drills only
    db.add(m.Role(id=10, tenant_id=1, name="Drill viewer"))
    db.add(m.Role(id=11, tenant_id=1, name="BCM reader"))
    for pid, name in enumerate(["bcm:drills:view", "bcm:plans:view", "bcm:bia:view", "bcm:findings:view"], start=1):
        db.add(m.Permission(id=pid, name=name, resource="bcm", action="view"))
        db.add(m.RolePermission(role_id=11, permission_id=pid))
    db.add(m.RolePermission(role_id=10, permission_id=1))
    db.add(m.UserRole(user_id=VIEWER, role_id=10, tenant_id=1))
    for uid in (ANNA, VIC):
        db.add(m.UserRole(user_id=uid, role_id=11, tenant_id=1))
    # plans: A is anna's and due for review, B is vic's with a far review day, C is retired
    db.add(m.BcmPlan(id=1, tenant_id=1, title="Core banking", status="approved", owner_id=ANNA, rto_hours=4, rpo_hours=1, next_review_due=NOW + timedelta(days=10), updated_at=NOW))
    db.add(m.BcmPlan(id=2, tenant_id=1, title="Payments", status="draft", owner_id=VIC, next_review_due=NOW + timedelta(days=200), updated_at=NOW - timedelta(days=1)))
    db.add(m.BcmPlan(id=3, tenant_id=1, title="Old site", status="retired", owner_id=ANNA, next_review_due=NOW - timedelta(days=30), updated_at=NOW - timedelta(days=2)))
    db.add(m.BcmBiaRecord(id=1, tenant_id=1, plan_id=1, process_name="Card authorisation", criticality_rating="critical", is_complete=False))
    db.add(m.BcmBiaRecord(id=2, tenant_id=1, plan_id=1, process_name="Statements", criticality_rating="low", is_complete=True))
    db.add(m.BcmBiaRecord(id=3, tenant_id=1, plan_id=3, process_name="Retired process", criticality_rating="high", is_complete=False))
    # drills: 1 overdue and anna's, 2 scheduled later and vic's, 3 completed with a result, 4 incident-triggered
    db.add(m.BcmDrill(id=1, tenant_id=1, plan_id=1, title="Failover test", status="scheduled", owner_id=ANNA, scheduled_date=NOW - timedelta(days=9), created_at=NOW - timedelta(days=40)))
    db.add(m.BcmDrill(id=2, tenant_id=1, plan_id=2, title="Call tree", drill_type="call_tree", status="scheduled", owner_id=VIC, scheduled_date=NOW + timedelta(days=20)))
    db.add(m.BcmDrill(id=3, tenant_id=1, plan_id=1, title="Tabletop", status="completed", owner_id=VIC, scheduled_date=NOW - timedelta(days=60)))
    db.add(m.BcmDrillResult(id=1, tenant_id=1, drill_id=3, rto_met=True, rpo_met=False))
    db.add(m.Issue(id=1, tenant_id=1, title="[BCM] Slow failover", code="ISS-1", workflow_state="in_progress", severity="high"))
    db.add(m.Issue(id=2, tenant_id=1, title="[BCM] Done", code="ISS-2", workflow_state="closed", severity="low"))
    # findings: 1 has an open issue, 2 a closed one, 3 has none and is anna's, 4 has none and no owner (on vic's drill), 5 has none and is on anna's overdue drill with no owner
    db.add(m.BcmFinding(id=1, tenant_id=1, drill_id=3, title="Slow failover", severity="high", linked_issue_id=1, created_at=NOW - timedelta(days=3)))
    db.add(m.BcmFinding(id=2, tenant_id=1, drill_id=3, title="Old gap", severity="low", linked_issue_id=2, created_at=NOW - timedelta(days=4)))
    db.add(m.BcmFinding(id=3, tenant_id=1, drill_id=3, title="No runbook", severity="medium", owner_id=ANNA, due_date=NOW + timedelta(days=5), created_at=NOW - timedelta(days=2)))
    db.add(m.BcmFinding(id=4, tenant_id=1, drill_id=3, title="Call list stale", severity="critical", created_at=NOW - timedelta(days=1)))
    db.add(m.BcmFinding(id=5, tenant_id=1, drill_id=1, title="Slot clash", severity="low", created_at=NOW))
    db.commit()
    yield db
    db.close()


def user(w, uid):
    return w.get(m.GRCUser, uid)


def call_plans(w, **kw):
    args = dict(status_filter=None, search=None, skip=0, limit=200, lean=False, db=w, current_user=user(w, ADMIN), _p=True)
    args.update(kw)
    return plans.list_plans(**args)


def call_drills(w, **kw):
    args = dict(plan_id=None, status_filter=None, source_type=None, drill_type=None, search=None, skip=0, limit=200, lean=False, db=w, current_user=user(w, ADMIN), _p=True)
    args.update(kw)
    return drills.list_drills(**args)


def call_findings(w, **kw):
    args = dict(severity=None, status_filter=None, drill_id=None, plan_id=None, owner_id=None, has_issue=None, search=None, skip=0, limit=1000, db=w, current_user=user(w, ADMIN), _p=True)
    args.update(kw)
    return drills.list_all_findings(**args)


# ── lean lists ───────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_lean_plans_answer_the_same_rows_as_the_default_list_with_the_counts_the_quick_views_read(w):
    full = {p["id"]: p for p in call_plans(w)["items"]}
    lean = call_plans(w, lean=True)
    assert lean["total"] == 3 and lean["truncated"] is False
    for row in lean["items"]:
        for key, value in row.items():
            if key in full[row["id"]]:
                assert full[row["id"]][key] == value, (row["id"], key)
        assert set(full[row["id"]]) - set(row) == {"created_by"}          # nothing the default list shows is lost but who made it
    by_id = {p["id"]: p for p in lean["items"]}
    assert by_id[1]["bia_incomplete"] == 1 and by_id[1]["bia_count"] == 2 and by_id[1]["drill_count"] == 2
    assert by_id[1]["last_drill_at"] is not None and by_id[2]["last_drill_at"] is not None
    assert by_id[3]["last_drill_at"] is None and by_id[3]["drill_count"] == 0


def test_lean_list_says_when_it_was_cut(w):
    cut = call_plans(w, lean=True, limit=2)
    assert len(cut["items"]) == 2 and cut["total"] == 3 and cut["truncated"] is True


def test_lean_drills_answer_the_same_rows_with_open_finding_counts(w):
    full = {d["id"]: d for d in call_drills(w)["items"]}
    lean = call_drills(w, lean=True)
    assert lean["total"] == 3 and lean["truncated"] is False
    for row in lean["items"]:
        for key in ("id", "plan_id", "plan_title", "title", "drill_type", "scheduled_date", "owner_id", "owner_name", "status", "is_overdue", "effective_status", "source_type",
                    "has_result", "finding_count"):
            assert row[key] == full[row["id"]][key], (row["id"], key)
    by_id = {d["id"]: d for d in lean["items"]}
    assert by_id[1]["effective_status"] == "overdue" and by_id[1]["open_finding_count"] == 1
    assert by_id[3]["finding_count"] == 4 and by_id[3]["open_finding_count"] == 3          # the closed issue's finding is not open
    assert by_id[3]["has_result"] is True and by_id[2]["finding_count"] == 0


def test_the_drill_status_filter_works_on_the_derived_overdue_state_and_counts_before_paging(w):
    overdue = call_drills(w, status_filter="overdue")
    assert [d["id"] for d in overdue["items"]] == [1] and overdue["total"] == 1
    scheduled = call_drills(w, status_filter="scheduled")                     # the overdue one is no longer "scheduled"
    assert [d["id"] for d in scheduled["items"]] == [2]
    paged = call_drills(w, skip=1, limit=1)
    assert paged["total"] == 3 and len(paged["items"]) == 1


# ── the findings register ────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_findings_register_names_drill_plan_owner_due_and_where_the_issue_stands(w):
    page = call_findings(w)
    assert page["total"] == 5 and page["truncated"] is False
    by_id = {f["id"]: f for f in page["items"]}
    assert by_id[1]["issue_status"] == "in_progress" and by_id[1]["issue_code"] == "ISS-1" and by_id[1]["is_open"] is True
    assert by_id[2]["issue_status"] == "closed" and by_id[2]["is_open"] is False
    assert by_id[3]["issue_status"] == "open" and by_id[3]["linked_issue_id"] is None and by_id[3]["owner_name"] == "Anna Owner" and by_id[3]["due_date"]
    assert by_id[3]["drill_title"] == "Tabletop" and by_id[3]["plan_title"] == "Core banking" and by_id[3]["plan_id"] == 1
    assert by_id[5]["drill_owner_id"] == ANNA


def test_the_findings_filters(w):
    assert [f["id"] for f in call_findings(w, severity="critical")["items"]] == [4]
    assert {f["id"] for f in call_findings(w, status_filter="open")["items"]} == {1, 3, 4, 5}
    assert {f["id"] for f in call_findings(w, status_filter="closed")["items"]} == {2}
    assert {f["id"] for f in call_findings(w, status_filter="in_progress")["items"]} == {1}
    assert {f["id"] for f in call_findings(w, has_issue=False)["items"]} == {3, 4, 5}
    assert {f["id"] for f in call_findings(w, has_issue=True)["items"]} == {1, 2}
    assert {f["id"] for f in call_findings(w, drill_id=1)["items"]} == {5}
    assert {f["id"] for f in call_findings(w, plan_id=1)["items"]} == {1, 2, 3, 4, 5}
    assert {f["id"] for f in call_findings(w, owner_id=ANNA)["items"]} == {3}
    assert {f["id"] for f in call_findings(w, search="runbook")["items"]} == {3}
    cut = call_findings(w, limit=2)
    assert len(cut["items"]) == 2 and cut["total"] == 5 and cut["truncated"] is True


def test_a_finding_takes_an_owner_and_a_due_day_and_both_come_back(w):
    created = drills.create_finding(
        3, drills.FindingCreate(title="Backup not tested", severity="low", owner_id=VIC, due_date=NOW + timedelta(days=30)), db=w, current_user=user(w, ADMIN), _p=True)
    assert created["owner_id"] == VIC and created["owner_name"] == "Vic Owner" and created["due_date"]
    changed = drills.update_finding(created["id"], drills.FindingUpdate(owner_id=ANNA, due_date=None), db=w, current_user=user(w, ADMIN), _p=True)
    assert changed["owner_id"] == ANNA and changed["due_date"] is None
    kept = drills.update_finding(created["id"], drills.FindingUpdate(severity="high"), db=w, current_user=user(w, ADMIN), _p=True)
    assert kept["owner_id"] == ANNA                                          # a field that was not sent is left alone
    in_drill = {f["id"]: f for f in drills.get_drill(3, db=w, current_user=user(w, ADMIN), _p=True)["findings"]}
    assert in_drill[created["id"]]["owner_name"] == "Anna Owner"


# ── the Overview's blocks ────────────────────────────────────────────────────────────────────────────────────────────────

def test_attention_counts_the_tenant_and_leaves_out_retired_plans(w):
    d = dash.dashboard(db=w, current_user=user(w, ADMIN), _p=True)
    assert d["attention"] == {"reviews_due": 1, "bia_without_strategy": 1, "findings_without_issue": 3}
    assert d["totals"]["overdue_drills"] == 1 and d["totals"]["open_findings"] == 4          # the existing figures are untouched


def test_mine_is_the_signed_in_persons_own_work(w):
    anna = dash.dashboard(db=w, current_user=user(w, ANNA), _p=True)["mine"]
    assert anna["counts"] == {"overdue_drills": 1, "reviews_due": 1, "bia_without_strategy": 1, "findings_without_issue": 2}
    assert [d["id"] for d in anna["overdue_drills"]] == [1]
    assert [p["id"] for p in anna["reviews_due"]] == [1]
    assert [b["process_name"] for b in anna["bia_without_strategy"]] == ["Card authorisation"]
    assert {f["id"] for f in anna["findings_without_issue"]} == {3, 5}                       # hers by owner, and one with no owner on a drill she owns
    vic = dash.dashboard(db=w, current_user=user(w, VIC), _p=True)["mine"]
    assert vic["counts"] == {"overdue_drills": 0, "reviews_due": 0, "bia_without_strategy": 0, "findings_without_issue": 1}      # finding 4: no owner, on the drill vic owns
    assert vic["findings_without_issue"][0]["id"] == 4


def test_a_list_is_only_included_for_a_person_who_may_read_that_kind_of_record(w):
    mine = dash.dashboard(db=w, current_user=user(w, VIEWER), _p=True)["mine"]
    assert set(mine) == {"counts", "overdue_drills"} and set(mine["counts"]) == {"overdue_drills"}      # drills only: no plans, BIA or findings view


# ── evidence on a result ────────────────────────────────────────────────────────────────────────────────────────────────

def test_a_result_can_point_to_evidence_and_says_its_name(w):
    w.add(m.Evidence(id=7, tenant_id=1, name="Failover test report.pdf", status="approved", evidence_type="report"))
    w.add(m.Evidence(id=8, tenant_id=1, name="Gone", status="archived"))
    w.commit()
    options = dash.evidence_options(search=None, limit=50, db=w, current_user=user(w, ADMIN), _p=True)["items"]
    assert [o["value"] for o in options] == [7] and "approved" in options[0]["subLabel"]
    saved = drills.upsert_result(1, drills.ResultUpsert(rto_met=True, evidence_ref_id=7), db=w, current_user=user(w, ADMIN), _p=True)
    assert saved["evidence_ref_id"] == 7 and saved["evidence_ref_title"] == "Failover test report.pdf"
    cleared = drills.upsert_result(1, drills.ResultUpsert(evidence_ref_id=None), db=w, current_user=user(w, ADMIN), _p=True)
    assert cleared["evidence_ref_id"] is None and cleared["evidence_ref_title"] is None
    with pytest.raises(HTTPException) as refused:
        drills.upsert_result(1, drills.ResultUpsert(evidence_ref_id=999), db=w, current_user=user(w, ADMIN), _p=True)
    assert refused.value.status_code == 404 and refused.value.detail == "Evidence not found"


# ── the limits ───────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("build", [
    lambda: plans.PlanCreate(title="x" * 256),
    lambda: plans.PlanCreate(title=""),
    lambda: plans.PlanCreate(title="ok", rto_hours=-5),
    lambda: plans.PlanCreate(title="ok", rpo_hours=2147483648),
    lambda: plans.PlanUpdate(title=None),
    lambda: plans.PlanUpdate(business_unit="x" * 256),
    lambda: plans.BiaCreate(process_name="x" * 256),
    lambda: plans.BiaCreate(process_name="ok", mtpd_hours=-1),
    lambda: plans.BiaUpdate(process_name=None),
    lambda: plans.DependencyCreate(dependency_type="system", name="x" * 256),
    lambda: drills.DrillCreate(plan_id=1, title="x" * 256),
    lambda: drills.DrillUpdate(title=None),
    lambda: drills.ResultUpsert(actual_rto_hours=-2),
    lambda: drills.ResultUpsert(actual_rpo_hours=99999999999),
    lambda: drills.FindingCreate(title="x" * 256),
    lambda: drills.FindingUpdate(title=None),
])
def test_a_title_or_hours_the_column_cannot_hold_is_refused_with_a_sentence_not_a_500(build):
    with pytest.raises(ValidationError):
        build()


def test_what_the_columns_hold_is_accepted():
    assert plans.PlanCreate(title="x" * 255, rto_hours=0, rpo_hours=2147483647).title == "x" * 255
    assert plans.PlanUpdate(description=None).model_dump(exclude_unset=True) == {"description": None}      # clearing an optional field is still allowed
    assert drills.ResultUpsert(actual_rto_hours=None).model_dump(exclude_unset=True) == {"actual_rto_hours": None}
