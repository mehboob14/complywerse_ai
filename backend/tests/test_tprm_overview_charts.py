"""The Third-Party Vendor Risk Overview's chart datasets (GET /vendor-risk/tpra/overview-charts) and the extra fields of the risk trend.

The charts count the same vendors, classified the same way, as the program dashboard's tiles: the tier by band grid adds up to
`tier_counts`, the overdue column of the review calendar is the tile's `reassessment_overdue`, the severity by status grid holds the
dashboard's `findings_posture`. Read-only, in-memory SQLite.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Role, Tenant, TPRAEngagement, TPRAFinding, TPRAMonitoringSignal, TPRARemediation, TPRARiskSnapshot,
    UserRole, Vendor, VendorAssessment, get_db,
)
from grc.modules.vendor_risk.routers import vendors as vendor_routes
from grc.modules.vendor_risk.tpra import dashboard, overview_charts
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
    app.include_router(overview_charts.router, prefix="/vendor-risk")
    app.include_router(vendor_routes.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, uid)
    return TestClient(app)


def _vendor(db, name, **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", **kw})
    db.add(v)
    db.commit()
    return v


def _assessment(db, v, stage="monitoring"):
    a = db.query(VendorAssessment).filter_by(vendor_id=v.id).first()
    if a is None:
        a = VendorAssessment(tenant_id=1, vendor_id=v.id, status="in_progress", lifecycle_status="active",
                             current_stage=stage, version_no=1)
        db.add(a)
        db.commit()
    return a


def _finding(db, v, severity, status, age=5, **kw):
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=_assessment(db, v).id, severity=severity, status=status,
                    title=f"{severity} {status}", domain="cybersecurity", created_at=NOW - timedelta(days=age))
    db.add(f)
    db.commit()
    return f


def _signal(db, v, severity, days_ago, **kw):
    db.add(TPRAMonitoringSignal(tenant_id=1, vendor_id=v.id, signal_type="breach", severity=severity, title="s",
                                occurred_at=NOW - timedelta(days=days_ago), **kw))
    db.commit()


@pytest.fixture()
def portfolio(db):
    scored = {"inherent_risk_score": 70.0}
    v = {}
    v["core"] = _vendor(db, "Core Bank", tier="critical", owner_id=ADA, residual_risk_score=80.0,
                        next_reassessment_date=NOW + timedelta(days=100), **scored)             # critical tier, critical band, later
    v["cloud"] = _vendor(db, "Cloud Co", tier="critical", owner_id=None, residual_risk_score=55.0,
                         next_reassessment_date=NOW - timedelta(days=3), **scored)              # critical tier, high band, overdue
    v["mail"] = _vendor(db, "Mail Co", tier="high", owner_id=ADA, residual_risk_score=30.0,
                        next_reassessment_date=NOW + timedelta(days=20), **scored)              # high tier, medium band, 30 days
    v["pay"] = _vendor(db, "Pay Co", tier="high", owner_id=BEN, residual_risk_score=10.0, **scored)  # high tier, low band, no date
    v["print"] = _vendor(db, "Print Co", owner_id=ADA)                                           # not tiered, not scored, no date
    v["old"] = _vendor(db, "Old Co", tier="low", status="retired", owner_id=ADA, residual_risk_score=90.0, **scored)  # off the page
    v["gone"] = _vendor(db, "Gone Co", tier="critical", owner_id=ADA, deleted_at=NOW, residual_risk_score=90.0, **scored)
    v["asked"] = _vendor(db, "Asked Co", tier="high", intake_status="submitted", owner_id=ADA, **scored)   # a request, not a supplier
    v["hold"] = _vendor(db, "Hold Co", tier="medium", status="suspended", owner_id=ADA, residual_risk_score=40.0,
                        next_reassessment_date=NOW - timedelta(days=30), **scored)              # suspended: apart from the calendar
    # an engagement with an earlier date than the supplier's own wins
    db.add(TPRAEngagement(tenant_id=1, vendor_id=v["core"].id, name="Payments", is_general=False, status="active",
                          next_reassessment_date=NOW + timedelta(days=45)))
    db.commit()
    _assessment(db, v["core"], "monitoring")
    _assessment(db, v["cloud"], "approval")
    _assessment(db, v["mail"], "approval")
    return v


def test_the_tier_by_band_grid_adds_up_to_the_dashboards_tiers_and_bands_on_the_tenants_thresholds(db, portfolio):
    api = web(db)
    got = api.get("/vendor-risk/tpra/overview-charts").json()
    dash = api.get("/vendor-risk/tpra/dashboard").json()
    cells = got["risk_matrix"]["cells"]
    assert got["risk_matrix"]["tiers"] == ["critical", "high", "medium", "low", "not_tiered"]
    assert got["risk_matrix"]["bands"] == ["critical", "high", "medium", "low", "none"]
    assert {t: sum(row.values()) for t, row in cells.items()} == dash["tier_counts"]
    assert sum(sum(r.values()) for r in cells.values()) == dash["kpis"]["active_vendors"] == 5 + 1      # the suspended one is in use
    assert cells["critical"] == {"critical": 1, "high": 1, "medium": 0, "low": 0, "none": 0}
    assert cells["high"] == {"critical": 0, "high": 0, "medium": 1, "low": 1, "none": 0}
    assert cells["not_tiered"]["none"] == 1
    assert got["thresholds"] == {"critical": 75.0, "high": 50.0, "medium": 25.0}


def test_the_review_calendar_overdue_is_the_tiles_number_and_leaves_suspended_suppliers_apart(db, portfolio):
    api = web(db)
    got = api.get("/vendor-risk/tpra/overview-charts").json()["reviews"]
    dash = api.get("/vendor-risk/tpra/dashboard").json()
    by = {b: sum(row.values()) for b, row in got["cells"].items()}
    assert by["overdue"] == dash["reassessment_overdue"] == 1
    assert by == {"overdue": 1, "d30": 1, "d60": 1, "d90": 0, "later": 0, "none": 2}      # core: its engagement's date (45 days) is the earlier
    assert got["cells"]["overdue"]["critical"] == 1 and got["cells"]["d60"]["critical"] == 1
    assert got["apart"] == 1


def test_stages_come_in_the_lifecycles_order_and_those_without_a_review_are_counted_apart(db, portfolio):
    got = web(db).get("/vendor-risk/tpra/overview-charts").json()["stages"]
    assert [s["key"] for s in got["items"]][:3] == ["intake", "tiering", "dd_planning"]
    counts = {s["key"]: s["count"] for s in got["items"]}
    assert counts["approval"] == 2 and counts["monitoring"] == 1 and sum(counts.values()) == 3
    assert got["not_started"] == 3                                                             # pay, print, hold have no review started


def test_findings_by_severity_status_age_and_overdue_fixes(db, portfolio):
    core, mail, gone = portfolio["core"], portfolio["mail"], portfolio["gone"]
    _finding(db, core, "critical", "open", age=100)
    late = _finding(db, core, "critical", "in_remediation", age=10)
    db.add(TPRARemediation(tenant_id=1, finding_id=late.id, title="fix", status="open", due_date=NOW - timedelta(days=2)))
    db.commit()
    _finding(db, core, "critical", "closed")
    _finding(db, mail, "high", "open", age=40)
    _finding(db, mail, "high", "accepted")
    _finding(db, gone, "high", "open")                                                         # an archived supplier's
    api = web(db)
    got = api.get("/vendor-risk/tpra/overview-charts").json()["findings"]
    dash = api.get("/vendor-risk/tpra/dashboard").json()
    assert got["matrix"]["critical"] == {"open": 1, "in_remediation": 1, "accepted": 0, "closed": 1}
    assert got["matrix"]["high"] == {"open": 1, "in_remediation": 0, "accepted": 1, "closed": 0}
    total = {s: sum(got["matrix"][sev][s] for sev in got["severities"]) for s in got["statuses"]}
    assert total == {k: dash["findings_posture"][k] for k in total}
    assert got["age"]["critical"] == {"d30": 1, "d60": 0, "d90": 0, "older": 1}
    assert got["age"]["high"]["d60"] == 1
    assert got["overdue"] == {"critical": 1, "high": 0, "medium": 0, "low": 0}


def test_signals_by_month_and_severity_and_those_waiting(db, portfolio):
    core = portfolio["core"]
    _signal(db, core, "critical", 2)
    _signal(db, core, "high", 40, acknowledged=True)
    _signal(db, core, "high", 3, verified=False)                                               # did not survive verification
    _signal(db, portfolio["gone"], "critical", 1)                                              # an archived supplier's
    _signal(db, core, "low", 400)                                                              # older than six months
    got = web(db).get("/vendor-risk/tpra/overview-charts").json()["signals"]
    assert len(got["months"]) == 6 and got["months"][-1]["month"] == NOW.strftime("%Y-%m")
    assert sum(m["critical"] for m in got["months"]) == 1 and sum(m["high"] for m in got["months"]) == 1
    assert sum(m["low"] for m in got["months"]) == 0
    assert got["waiting"]["critical"] == 1 and got["waiting"]["high"] == 0


def test_my_vendors_are_the_callers_own(db, portfolio):
    mine = web(db, ADA).get("/vendor-risk/tpra/overview-charts", params={"scope": "mine"}).json()
    cells = mine["risk_matrix"]["cells"]
    assert sum(sum(r.values()) for r in cells.values()) == 4                                    # core, mail, print, hold
    assert mine["scope"] == "mine"
    assert web(db).get("/vendor-risk/tpra/overview-charts", params={"scope": "nobody"}).status_code == 422


def test_an_empty_tenant_gets_every_row_and_column_at_zero_not_nothing(db):
    got = web(db).get("/vendor-risk/tpra/overview-charts").json()
    assert all(v == 0 for row in got["risk_matrix"]["cells"].values() for v in row.values())
    assert len(got["risk_matrix"]["cells"]) == 5 and len(got["reviews"]["cells"]) == 6
    assert len(got["stages"]["items"]) == 11 and got["stages"]["not_started"] == 0
    assert len(got["signals"]["months"]) == 6


def test_the_risk_trend_also_gives_the_findings_and_vendor_count_of_each_snapshot(db):
    db.add(TPRARiskSnapshot(tenant_id=1, scope="portfolio", inherent_score=60.0, residual_score=40.0, open_findings=7,
                            critical_findings=2, vendor_count=12, captured_at=NOW - timedelta(days=35)))
    db.add(TPRARiskSnapshot(tenant_id=1, scope="portfolio", inherent_score=62.0, residual_score=41.0, open_findings=9,
                            critical_findings=3, vendor_count=13, captured_at=NOW))
    db.commit()
    got = web(db).get("/vendor-risk/tpra/risk-trend").json()
    assert [(s["inherent"], s["residual"]) for s in got["series"]] == [(60.0, 40.0), (62.0, 41.0)]       # what it had
    assert [(s["open_findings"], s["critical_findings"], s["vendor_count"]) for s in got["series"]] == [(7, 2, 12), (9, 3, 13)]
