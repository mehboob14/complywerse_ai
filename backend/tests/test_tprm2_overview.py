"""TPRM parity, piece P0 (2026-10-29): the Overview's numbers and the module header's counts.

The program dashboard keeps every key it had and gains what Verity's Overview shows, each a link to the register
filtered the same way: not tiered, no owner, reassessment overdue, the suppliers waiting on each next action, by status,
by tier with the untiered apart, coverage (critical and high suppliers whose reassessment is not past) and the first
four requests waiting for review with a duplicate flag. Its severity counts are of open findings only (they counted
closed and accepted ones too). GET /vendor-risk/portfolio/counts gives the header and the rail their four numbers.
In-memory SQLite.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Role, Tenant, TPRAFinding, UserRole, Vendor, VendorAssessment, get_db
from grc.modules.vendor_risk.routers import vendors as vendor_routes
from grc.modules.vendor_risk.tpra import dashboard
from grc.routers.auth_router import require_auth

ADMIN, ADA, BEN = 1, 2, 3
NOW = datetime.utcnow()


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=uid, username=f"u{uid}", display_name=name, email=f"u{uid}@acme.test", is_active=True)
               for uid, name in ((ADMIN, "Admin"), (ADA, "Ada"), (BEN, "Ben"))])
    s.add(UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


def web(db, uid=ADMIN):
    app = FastAPI()
    app.include_router(dashboard.router, prefix="/vendor-risk")
    app.include_router(dashboard.portfolio_router, prefix="/vendor-risk")
    app.include_router(vendor_routes.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, uid)
    return TestClient(app)


def _vendor(db, name, **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", **kw})
    db.add(v)
    db.commit()
    return v


def _finding(db, v, severity, status, **kw):
    db.add(TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=_assessment(db, v).id, severity=severity,
                       status=status, title=f"{severity} {status}", domain=kw.get("domain", "cybersecurity")))
    db.commit()


def _assessment(db, v):
    a = db.query(VendorAssessment).filter_by(vendor_id=v.id).first()
    if a is None:
        a = VendorAssessment(tenant_id=1, vendor_id=v.id, status="in_progress", lifecycle_status="active",
                             current_stage="monitoring", version_no=1)
        db.add(a)
        db.commit()
    return a


@pytest.fixture()
def portfolio(db):
    scored = {"inherent_risk_score": 70.0, "residual_risk_score": 50.0}
    v = {}
    v["core"] = _vendor(db, "Core Bank", tier="critical", owner_id=ADA, next_reassessment_date=NOW + timedelta(days=100),
                        website="https://www.corebank.example", **scored)                       # [nothing: in its window]
    v["cloud"] = _vendor(db, "Cloud Co", tier="critical", owner_id=None, next_reassessment_date=NOW - timedelta(days=3),
                         **scored)                                                              # [reassessment overdue]
    v["mail"] = _vendor(db, "Mail Co", tier="high", owner_id=ADA, website="https://www.mailco.example/about",
                        **scored)                                                               # [nothing: no date]
    v["print"] = _vendor(db, "Print Co", owner_id=ADA)                                           # [not tiered]
    v["old"] = _vendor(db, "Old Co", tier="low", status="retired", owner_id=ADA, **scored)       # left off the Overview
    v["gone"] = _vendor(db, "Gone Co", tier="critical", owner_id=ADA, deleted_at=NOW, **scored)  # archived
    v["closed"] = _vendor(db, "Closed Co", tier="high", status="offboarded", owner_id=BEN,
                          next_reassessment_date=NOW - timedelta(days=30), **scored)            # [finish offboarding]
    for kind, status in (("core", "open"), ("core", "in_remediation"), ("core", "closed")):
        _finding(db, v[kind], "critical", status)
    _finding(db, v["mail"], "high", "open", domain="legal")
    _finding(db, v["mail"], "high", "accepted")
    _finding(db, v["print"], "medium", "closed")
    _finding(db, v["print"], "low", "open")
    _finding(db, v["gone"], "high", "open")                                                    # an archived supplier's
    return v


# ── the dashboard ────────────────────────────────────────────────────────────

def test_the_dashboard_keeps_every_key_it_had(db, portfolio):
    got = web(db).get("/vendor-risk/tpra/dashboard").json()
    assert {"scope", "kpis", "tier_distribution", "inherent_vs_residual", "findings_posture", "findings_severity",
            "findings_by_domain", "monitoring_feed", "top_residual_vendors"} <= set(got)
    assert {"active_vendors", "critical_coverage", "open_critical_findings", "overdue_reviews", "attention_open"} <= set(got["kpis"])
    assert got["scope"] == "portfolio" and got["kpis"]["active_vendors"] == 4          # retired, archived, offboarded are off it


def test_severity_counts_are_of_open_findings_not_closed_or_accepted_ones(db, portfolio):
    got = web(db).get("/vendor-risk/tpra/dashboard").json()
    assert got["findings_severity"] == {"critical": 2, "high": 1, "medium": 0, "low": 1}     # open + in remediation only
    assert got["findings_posture"] == {"open": 3, "in_remediation": 1, "accepted": 1, "closed": 2}   # every status, as before
    assert got["findings_by_domain"] == {"cybersecurity": 3, "legal": 1}
    assert got["kpis"]["open_critical_findings"] == 2


def test_the_tiles_count_what_the_register_lists_when_each_is_followed(db, portfolio):
    api = web(db)
    got = api.get("/vendor-risk/tpra/dashboard").json()
    assert (got["not_tiered"], got["no_owner"], got["reassessment_overdue"]) == (1, 1, 1)
    assert got["attention_counts"] == {"reassessment_overdue": 1, "not_tiered": 1, "offboarding": 1}
    assert list(got["attention_counts"]) == ["reassessment_overdue", "not_tiered", "offboarding"]    # the register's order
    # each count is the total of the register filtered the same way
    for code, n in got["attention_counts"].items():
        assert api.get(f"/vendor-risk/vendors?attention={code}").json()["total"] == n
    assert api.get("/vendor-risk/vendors?owner=unassigned&include_archived=false").json()["total"] >= got["no_owner"]
    assert [r["name"] for r in api.get("/vendor-risk/vendors?owner=unassigned").json()["items"]] == ["Cloud Co"]


def test_by_status_and_by_tier_count_suppliers_in_use_with_the_untiered_apart(db, portfolio):
    got = web(db).get("/vendor-risk/tpra/dashboard").json()
    assert got["by_status"] == {"active": 4, "offboarded": 1}
    assert got["tier_counts"] == {"critical": 2, "high": 2, "medium": 0, "low": 0, "not_tiered": 1}
    assert sum(got["tier_counts"].values()) == sum(got["by_status"].values())
    # a tier computed on an assessment under way is a tier, though the supplier's own score is not set
    v = portfolio["print"]
    db.add(VendorAssessment(tenant_id=1, vendor_id=v.id, status="in_progress", lifecycle_status="active",
                            current_stage="dd_planning", inherent_tier="medium", version_no=1))
    db.commit()
    again = web(db).get("/vendor-risk/tpra/dashboard").json()
    assert again["tier_counts"]["not_tiered"] == 0 and again["tier_counts"]["medium"] == 1
    assert "not_tiered" not in again["attention_counts"]


def test_coverage_is_critical_and_high_suppliers_in_use_whose_reassessment_is_not_past(db, portfolio):
    got = web(db).get("/vendor-risk/tpra/dashboard").json()["coverage"]
    # Core Bank is inside its window; Cloud Co is past it and Mail Co has no date; Closed Co has left
    assert got == {"in_window": 1, "total": 3, "percent": 33}
    for name in ("cloud", "mail"):
        portfolio[name].next_reassessment_date = NOW + timedelta(days=40)
    db.commit()
    assert web(db).get("/vendor-risk/tpra/dashboard").json()["coverage"] == {"in_window": 3, "total": 3, "percent": 100}


def test_with_no_critical_or_high_suppliers_coverage_has_no_percent(db):
    _vendor(db, "Small Co", tier="low", inherent_risk_score=10.0, owner_id=ADA)
    assert web(db).get("/vendor-risk/tpra/dashboard").json()["coverage"] == {"in_window": 0, "total": 0, "percent": None}


def test_the_first_four_requests_waiting_for_review_longest_first_with_a_duplicate_flag(db, portfolio):
    asked = [("Core Bank Ltd", None, "a"), ("Fresh Name", None, "b"), ("Other Name", "http://mailco.example/x", "c"),
             ("Fourth", None, "d"), ("Fifth", None, "e")]
    for n, (name, website, tag) in enumerate(asked):
        _vendor(db, name, website=website, status="requested", intake_status="submitted", requested_by=BEN,
                submitted_at=NOW - timedelta(days=20 - n))
    _vendor(db, "Still a draft", status="requested", intake_status="draft", requested_by=BEN)
    _vendor(db, "Turned down", status="rejected", intake_status="rejected", requested_by=BEN)
    got = web(db).get("/vendor-risk/tpra/dashboard").json()["intake_pending"]
    assert got["total"] == 5 and [i["name"] for i in got["items"]] == ["Core Bank Ltd", "Fresh Name", "Other Name", "Fourth"]
    assert [i["duplicate"] for i in got["items"]] == [True, False, True, False]     # by name without the legal form; by website
    first = got["items"][0]
    assert first["requested_by"] == "Ben" and first["requested_by_id"] == BEN and first["id"]
    assert first["submitted_at"] == (NOW - timedelta(days=20)).isoformat()
    # requests are not suppliers in use: none of the register's numbers count them
    api = web(db)
    full = api.get("/vendor-risk/tpra/dashboard").json()
    assert full["by_status"] == {"active": 4, "offboarded": 1} and full["no_owner"] == 1
    assert full["tier_counts"]["not_tiered"] == 1


def test_a_request_alone_with_its_name_is_not_its_own_duplicate(db):
    _vendor(db, "Lonely Co", website="https://lonely.example", status="requested", intake_status="submitted")
    item = web(db).get("/vendor-risk/tpra/dashboard").json()["intake_pending"]["items"][0]
    assert item["duplicate"] is False and item["requested_by"] is None


def test_my_queue_counts_my_suppliers_but_the_intake_card_is_the_whole_workspaces(db, portfolio):
    _vendor(db, "Waiting Co", status="requested", intake_status="submitted")
    got = web(db, ADA).get("/vendor-risk/tpra/dashboard?scope=mine").json()
    assert got["scope"] == "mine" and got["kpis"]["active_vendors"] == 3                 # Core Bank, Mail Co, Print Co
    assert (got["no_owner"], got["reassessment_overdue"], got["not_tiered"]) == (0, 0, 1)
    assert got["coverage"] == {"in_window": 1, "total": 2, "percent": 50}
    assert got["intake_pending"]["total"] == 1


def test_reading_the_overview_writes_nothing_of_the_new_numbers(db, portfolio):
    web(db).get("/vendor-risk/tpra/dashboard")
    before = db.query(Vendor).count(), db.query(TPRAFinding).count(), db.query(VendorAssessment).count()
    web(db).get("/vendor-risk/tpra/dashboard")
    assert (db.query(Vendor).count(), db.query(TPRAFinding).count(), db.query(VendorAssessment).count()) == before


# ── the header and rail counts ───────────────────────────────────────────────

def test_the_header_counts_are_suppliers_in_use_critical_ones_open_findings_and_requests_waiting(db, portfolio):
    for name in ("One", "Two"):
        _vendor(db, name, status="requested", intake_status="submitted")
    _vendor(db, "Drafted", status="requested", intake_status="draft")
    _vendor(db, "In review", status="onboarding", intake_status="in_review", tier="critical", inherent_risk_score=80.0)
    got = web(db).get("/vendor-risk/portfolio/counts").json()
    # in use as the register lists them: Core, Cloud, Mail, Print, Old (retired), Closed, In review; not the archived or requests
    assert got == {"vendors": 7, "critical": 3, "open_findings": 4, "intake_pending": 2}
    assert got["vendors"] == web(db).get("/vendor-risk/vendors").json()["total"]
    assert got["critical"] == web(db).get("/vendor-risk/vendors?tier=critical").json()["total"]


def test_the_counts_of_an_empty_workspace_are_zeros(db):
    assert web(db).get("/vendor-risk/portfolio/counts").json() == {"vendors": 0, "critical": 0, "open_findings": 0,
                                                                   "intake_pending": 0}
