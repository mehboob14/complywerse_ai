"""Risk Management wave 3-K: the Overview's dashboards per audience (Board/CRO, risk team, risk owner, audit, third party).

GET /erm/dashboard/audience?view=... answers the template's DASH rows from the records, each with its drill-down link.
A measure with no data behind it is null with a reason, never a made-up figure; an empty tenant shows zeros, not health.
Net loss is kept per currency. In-memory SQLite through the real /erm router.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, BusinessUnit, GRCUser, InternalControl, Issue, IssueAction, Permission, RCSAApprovalHistory,
                        RCSAAssessment, RCSACampaign, Risk, RiskAppetiteConfig, RiskIncident, RiskKRI, RiskKRIMeasurement, RiskReview,
                        RiskScoreHistory, Role, RolePermission, Tenant, TPRAFinding, UserRole, Vendor, get_db)
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.routers.incidents import _quarter_start
from grc.modules.issue_management.services.risk_actions import add_risk_action
from grc.routers.auth_router import create_access_token, require_auth
from grc.routers.enriched_dashboard_router import router as enriched_router

OFFICER, OWNER, OTHER = 7, 8, 9
NOW = datetime.utcnow()


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Risk owner")])
    s.add(Permission(id=1, name="erm:risks:view", resource="erm:risks", action="view"))
    s.add(RolePermission(role_id=2, permission_id=1))
    s.add_all([GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True)
               for uid, name in ((OFFICER, "officer"), (OWNER, "owner"), (OTHER, "other"))])
    s.add_all([UserRole(user_id=OFFICER, role_id=1, tenant_id=1), UserRole(user_id=OWNER, role_id=2, tenant_id=1),
               UserRole(user_id=OTHER, role_id=2, tenant_id=1)])
    s.commit()
    yield s
    s.close()


def client(db, username="officer"):
    app = FastAPI()
    app.include_router(erm_router)
    app.include_router(enriched_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def view(db, name, username="officer"):
    got = client(db, username).get(f"/erm/dashboard/audience?view={name}")
    assert got.status_code == 200, got.text
    body = got.json()
    rows = {r["key"]: r for q in body["questions"] for r in q["rows"]}
    for r in rows.values():                       # every measure links somewhere, and a null always says why
        assert r["link"], r["key"]
        assert r["value"] is not None or r["reason"], r["key"]
    return body, rows


def risk(db, title, **fields):
    fields.setdefault("category", "operational")
    fields.setdefault("risk_category", fields["category"])
    row = Risk(tenant_id=1, title=title, **fields)
    db.add(row)
    db.commit()
    return row


def loss(db, when, gross, currency, recoveries=0, event_type="external_fraud", **fields):
    db.add(RiskIncident(tenant_id=1, title=f"{currency} {gross}", incident_date=when, gross_loss=gross,
                        recoveries=recoveries, currency=currency, event_type=event_type, **fields))
    db.commit()


# ── Board / CRO ──────────────────────────────────────────────────────────────────────────────────────────────────────

def test_board_view_answers_appetite_movers_losses_and_overdue_from_the_records(db):
    db.add(BusinessUnit(id=1, tenant_id=1, name="Payments"))
    db.add(RiskAppetiteConfig(tenant_id=1, category="operational", max_acceptable_score=15, tolerance_threshold=12))
    over = risk(db, "Card fraud", inherent_score=20, residual_score=16, business_unit_id=1)
    risk(db, "Branch cash", inherent_score=9, residual_score=6, status="accepted", acceptance_status="approved",
         acceptance_expires_at=NOW + timedelta(days=30))
    risk(db, "Long acceptance", inherent_score=9, residual_score=4, status="accepted", acceptance_status="approved",
         acceptance_expires_at=NOW + timedelta(days=200))
    mover = risk(db, "Core outage", category="technology", inherent_score=25, residual_score=20)
    db.add(RiskReview(risk_id=mover.id, status="approved", due_date=NOW, completed_at=NOW - timedelta(days=40),
                      new_residual_score=12))
    db.add_all([RiskKRI(tenant_id=1, risk_id=over.id, name="Failed payments", current_value=10, green_threshold=2,
                        amber_threshold=5, threshold_direction="lower_is_better", is_active=True, kind="kri"),
                RiskKRI(tenant_id=1, risk_id=over.id, name="Chargebacks", current_value=1, green_threshold=2,
                        amber_threshold=5, threshold_direction="lower_is_better", is_active=True, kind="kri")])
    db.commit()
    this_q, last_q = _quarter_start(NOW) + timedelta(hours=1), _quarter_start(NOW) - timedelta(days=1)
    loss(db, this_q, 1000, "USD", recoveries=200)
    loss(db, this_q, 500, "EUR")
    loss(db, last_q, 300, "USD")
    add_risk_action(db, over, OFFICER, title="Late 40 days", due_date=NOW - timedelta(days=40))
    add_risk_action(db, over, OFFICER, title="Late 10 days", due_date=NOW - timedelta(days=10))
    db.commit()

    body, rows = view(db, "board")
    assert [q["question"] for q in body["questions"]][:2] == ["Are we inside appetite?", "Which top risks moved?"]

    assert rows["outside_appetite"]["value"] == 1          # Core outage has no limit for its category
    [cat] = rows["outside_appetite"]["items"]
    assert (cat["category"], cat["tolerance"], cat["outside"]) == ("operational", 12, 1)
    assert rows["red_kris"]["value"] == 1 and rows["red_kris"]["items"][0]["name"] == "Failed payments"

    top = rows["top_risks"]["items"]
    assert top[0]["title"] == "Core outage" and (top[0]["change"], top[0]["direction"]) == (8, "up")
    assert top[1]["title"] == "Card fraud" and top[1]["direction"] is None     # no approved review to compare with

    totals = {t["currency"]: t for t in rows["net_loss"]["value"]}
    assert totals["USD"]["this_quarter"] == 800 and totals["USD"]["last_quarter"] == 300
    assert totals["EUR"]["this_quarter"] == 500 and totals["EUR"]["last_quarter"] == 0     # never added to dollars
    assert {(i["currency"], i["this_quarter"]) for i in rows["net_loss"]["items"]} == {("USD", 800), ("EUR", 500)}

    assert rows["overdue_actions_30"]["value"] == 1
    assert rows["overdue_actions_30"]["items"] == [{"unit": "Payments", "count": 1}]
    assert [a["title"] for a in rows["acceptances_expiring"]["items"]] == ["Branch cash"]
    assert rows["acceptances_expiring"]["items"][0]["link"].startswith("/erm/risks/")
    assert body["programme"]["performance"]["score"] == rows["programme_score"]["value"]


# ── Risk team ───────────────────────────────────────────────────────────────────────────────────────────────────────

def test_team_view_counts_gaps_campaign_progress_and_the_heatmaps(db):
    db.add_all([BusinessUnit(id=1, tenant_id=1, name="Retail"), BusinessUnit(id=2, tenant_id=1, name="Treasury")])
    risk(db, "Scored and owned", owner_id=OWNER, inherent_likelihood=4, inherent_impact=5, inherent_score=20,
         residual_likelihood=2, residual_impact=3, residual_score=6)
    risk(db, "No owner", inherent_score=9, residual_score=4)
    risk(db, "No scores", owner_id=OWNER)
    db.add(RCSACampaign(id=1, tenant_id=1, template_id=1, name="2026 H2", status="active", start_date=NOW,
                        due_date=NOW + timedelta(days=30)))
    db.add_all([RCSAAssessment(tenant_id=1, campaign_id=1, business_unit_id=1, status="approved"),
                RCSAAssessment(tenant_id=1, campaign_id=1, business_unit_id=2, status="in_progress")])
    db.commit()

    body, rows = view(db, "team")
    assert rows["unscored_unowned"]["items"] == [
        {"key": "unscored", "label": "Not fully scored", "count": 1, "link": "/erm/risks/list?filter=unscored"},
        {"key": "unowned", "label": "No risk owner", "count": 1, "link": "/erm/risks/list"}]
    assert rows["attention_queue"]["value"] == body["programme"]["attention_queue"]["total"]
    progress = {u["unit"]: u for u in rows["campaign_progress"]["items"]}
    assert (progress["Retail"]["assigned"], progress["Retail"]["submitted"], progress["Retail"]["approved"]) == (1, 1, 1)
    assert (progress["Treasury"]["submitted"], progress["Treasury"]["approved"]) == (0, 0)
    coverage = rows["assessment_coverage"]
    assert (coverage["numerator"], coverage["denominator"], coverage["value"], coverage["target"]) == (0, 3, 0, 85)
    assert rows["kri_freshness"]["value"] is None and "KRI" in rows["kri_freshness"]["reason"]
    cells = rows["heatmap"]["cells"]
    assert cells["inherent"] == [{"likelihood": 4, "impact": 5, "count": 1}]
    assert cells["residual"] == [{"likelihood": 2, "impact": 3, "count": 1}]


# ── Risk owner ──────────────────────────────────────────────────────────────────────────────────────────────────────

def test_owner_view_shows_only_my_items(db):
    mine = risk(db, "My risk", owner_id=OWNER, residual_score=16, review_date=NOW + timedelta(days=20))
    theirs = risk(db, "Their risk", owner_id=OTHER, residual_score=20)
    add_risk_action(db, mine, OFFICER, title="My action due soon", due_date=NOW + timedelta(days=5), assignee_id=OWNER)
    add_risk_action(db, mine, OFFICER, title="My action far off", due_date=NOW + timedelta(days=60), assignee_id=OWNER)
    add_risk_action(db, theirs, OFFICER, title="Their action", due_date=NOW - timedelta(days=5), assignee_id=OTHER)
    db.add_all([RiskKRI(tenant_id=1, name="My KRI", is_active=True, kind="kri", data_provider_id=OWNER,
                        next_due_date=NOW - timedelta(days=1)),
                RiskKRI(tenant_id=1, name="Their KRI", is_active=True, kind="kri", data_provider_id=OTHER,
                        next_due_date=NOW - timedelta(days=1)),
                RiskReview(risk_id=mine.id, status="in_review", due_date=NOW, reviewer_id=OWNER,
                           approval_notes="Explain the residual"),
                RiskReview(risk_id=theirs.id, status="in_review", due_date=NOW, reviewer_id=OTHER,
                           approval_notes="Not mine")])
    db.commit()
    loss(db, NOW, 10, "USD", reported_by=OWNER, validation_status="returned", validation_note="Add the recovery")

    _, rows = view(db, "owner", username="owner")
    assert rows["my_risks"]["value"] == 1 and rows["my_risks"]["bands"]["high"] == 1
    assert [r["title"] for r in rows["my_risks"]["items"]] == ["My risk"]
    assert [a["title"] for a in rows["my_actions"]["items"]] == ["My action due soon"]
    assert [k["name"] for k in rows["my_kri_values"]["items"]] == ["My KRI"]
    returned = {(i["kind"], i["note"]) for i in rows["returned_to_me"]["items"]}
    assert returned == {("review", "Explain the residual"), ("loss_event", "Add the recovery")}


# ── Internal audit ──────────────────────────────────────────────────────────────────────────────────────────────────

def test_audit_view_counts_self_approvals_score_changes_unverified_closures_and_unreviewed_risks(db):
    reviewed = risk(db, "Reviewed", inherent_score=9, residual_score=6, acceptance_requested_by=OFFICER,
                    accepted_by=OFFICER)
    risk(db, "Never reviewed", inherent_score=9)
    risk(db, "Independently accepted", acceptance_requested_by=OWNER, accepted_by=OFFICER)
    db.add_all([
        RiskReview(risk_id=reviewed.id, status="approved", due_date=NOW, completed_at=NOW - timedelta(days=30),
                   submitted_by=OFFICER, approver_id=OFFICER),
        InternalControl(tenant_id=1, control_id="IC-1", name="Dual sign-off", submitted_by=OWNER, approved_by=OWNER),
        InternalControl(tenant_id=1, control_id="IC-2", name="Checked", submitted_by=OWNER, approved_by=OFFICER),
        RiskScoreHistory(risk_id=reviewed.id, residual_score=6, changed_by=OFFICER, change_reason="Edited",
                         reason="Control tested", recorded_at=NOW - timedelta(days=5)),
        RiskScoreHistory(risk_id=reviewed.id, residual_score=9, changed_by=OFFICER, recorded_at=NOW - timedelta(days=200)),
    ])
    kri = RiskKRI(tenant_id=1, name="Self-checked", is_active=True, kind="kri")
    kpi = RiskKRI(tenant_id=1, name="A KPI publishes at once", is_active=True, kind="kpi")
    db.add_all([kri, kpi])
    db.flush()
    db.add_all([RiskKRIMeasurement(kri_id=kri.id, value=1, measured_by=OWNER, reviewed_by=OWNER, review_status="approved"),
                RiskKRIMeasurement(kri_id=kpi.id, value=1, measured_by=OWNER, reviewed_by=OWNER, review_status="approved")])
    db.add_all([RCSAAssessment(id=1, tenant_id=1, campaign_id=1, business_unit_id=1, status="approved", submitted_by=OWNER),
                RCSAAssessment(id=2, tenant_id=1, campaign_id=1, business_unit_id=2, status="approved", submitted_by=OWNER),
                RCSAApprovalHistory(assessment_id=1, action="approved", tier_number=1, performed_by=OWNER),
                RCSAApprovalHistory(assessment_id=2, action="submitted", tier_number=0, performed_by=OWNER),
                RCSAApprovalHistory(assessment_id=2, action="approved", tier_number=1, performed_by=OFFICER)])
    closed = Issue(tenant_id=1, title="Closed, action never verified", workflow_state="closed", status="closed")
    clean = Issue(tenant_id=1, title="Closed and verified", workflow_state="closed", status="closed")
    db.add_all([closed, clean])
    db.flush()
    db.add_all([IssueAction(issue_id=closed.id, title="Done, not checked", status="completed", completed_by=OWNER),
                IssueAction(issue_id=clean.id, title="Self-verified", status="verified", completed_by=OWNER,
                            verified_by_id=OWNER)])
    db.commit()
    loss(db, NOW, 10, "USD", reported_by=OWNER, validated_by=OWNER, validation_status="validated")

    _, rows = view(db, "audit")
    self_approvals = rows["self_approvals"]
    assert self_approvals["value"] == 7
    by_source = {i["source"]: i["count"] for i in self_approvals["items"]}
    assert by_source == {"rcsa": 1, "internal_controls": 1, "issue_actions": 1, "loss_validation": 1, "acceptances": 1,
                         "kri_values": 1, "reviews": 1}
    assert "Appetite statements" in self_approvals["checked"]
    changes = rows["score_changes"]
    assert changes["value"] == 1 and changes["items"][0]["reason"] == "Control tested"
    assert changes["items"][0]["by"] == "Officer"
    assert [i["title"] for i in rows["closed_unverified"]["items"]] == ["Closed, action never verified"]
    assert {i["title"] for i in rows["not_reviewed_12m"]["items"]} == {"Never reviewed", "Independently accepted"}


# ── Third party ─────────────────────────────────────────────────────────────────────────────────────────────────────

def test_third_party_view_reads_vendor_fields_by_materiality_and_says_why_concentration_has_no_limit(db):
    db.add_all([Vendor(id=1, tenant_id=1, name="Card processor", tier="critical", status="active",
                       residual_risk_score=80, risk_rating="critical", next_reassessment_date=NOW - timedelta(days=3)),
                Vendor(id=2, tenant_id=1, name="Stationery", tier="low", status="active"),
                Vendor(id=3, tenant_id=1, name="Gone", tier="critical", status="active", deleted_at=NOW)])
    db.add_all([TPRAFinding(tenant_id=1, vendor_id=1, assessment_id=1, title="No MFA", severity="critical", status="open"),
                TPRAFinding(tenant_id=1, vendor_id=1, assessment_id=1, title="Closed", severity="critical",
                            status="closed")])
    db.commit()

    _, rows = view(db, "third_party")
    matrix = {r["materiality"]: r for r in rows["vendors_by_band"]["items"]}     # wave 4-M: rows by materiality, not tier
    assert matrix["unclassified"]["critical"] == 1 and matrix["unclassified"]["unscored"] == 1
    assert rows["reassessments_overdue"]["value"] == 1
    assert rows["reassessments_overdue"]["items"][0]["link"] == "/vendor-risk/vendors/1"
    assert rows["critical_findings"]["value"] == 1
    assert rows["concentration"]["value"] is None and "concentration limit" in rows["concentration"]["reason"]
    # a risk owner without vendor-risk access sees the counts, not the vendor names
    _, rows = view(db, "third_party", username="owner")
    assert rows["reassessments_overdue"]["value"] == 1 and rows["reassessments_overdue"]["items"] == []


# ── Empty tenant, unknown data, unknown view ────────────────────────────────────────────────────────────────────────

def test_an_empty_tenant_shows_zeros_and_says_why_where_there_is_nothing_to_measure(db):
    _, board = view(db, "board")
    assert board["outside_appetite"]["value"] is None and "appetite" in board["outside_appetite"]["reason"].lower()
    assert board["red_kris"]["value"] == 0 and board["overdue_actions_30"]["value"] == 0
    assert board["net_loss"]["value"] == [] and board["acceptances_expiring"]["items"] == []
    assert board["programme_score"]["value"] is None and board["programme_score"]["reason"]
    _, team = view(db, "team")
    assert team["assessment_coverage"]["value"] is None and team["unscored_unowned"]["value"] == 0
    _, owner = view(db, "owner", username="owner")
    assert [owner[k]["value"] for k in ("my_risks", "my_actions", "my_kri_values", "returned_to_me")] == [0, 0, 0, 0]
    _, audit = view(db, "audit")
    assert audit["self_approvals"]["value"] == 0 and audit["not_reviewed_12m"]["value"] == 0
    _, tp = view(db, "third_party")
    assert tp["reassessments_overdue"]["value"] == 0 and tp["concentration"]["value"] is None


def test_an_unknown_view_is_refused(db):
    assert client(db).get("/erm/dashboard/audience?view=everything").status_code == 422


# ── Loss totals elsewhere: per currency, never one "$" figure ──────────────────────────────────────────────────────

def test_enriched_dashboard_loss_totals_are_net_per_currency(db):
    loss(db, NOW, 1000, "USD", recoveries=250)
    loss(db, NOW, 400, "EUR")
    http = client(db)
    for path in ("/enriched-dashboard/executive/summary", "/enriched-dashboard/incidents/summary"):
        body = http.get(path).json()
        assert {(r["currency"], r["net_loss"]) for r in body["net_loss_by_currency"]} == {("USD", 750), ("EUR", 400)}, path
        assert "total_financial_impact" in body      # old field kept for old clients
    [month] = [m for m in http.get("/enriched-dashboard/incidents/trends?months=1").json()["trends"]]
    assert {(r["currency"], r["net_loss"]) for r in month["net_loss_by_currency"]} == {("USD", 750), ("EUR", 400)}
    [cause] = http.get("/enriched-dashboard/incidents/root-causes").json()["root_causes"]
    assert {(r["currency"], r["net_loss"]) for r in cause["net_loss_by_currency"]} == {("USD", 750), ("EUR", 400)}
