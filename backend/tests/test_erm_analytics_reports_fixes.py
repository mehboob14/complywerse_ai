"""Risk Analytics and Risk Reports fixes (2026-11-11). In-memory SQLite.

- Scenario analysis skips a risk with no likelihood/impact instead of treating it as 0 (server) or 3 (page).
- A preset shifts only the categories it names; the rest come back unchanged.
- Bow-tie places a control by its own type, and claims no effectiveness nobody recorded.
- Aggregation averages and bands; nothing is summed and an unscored risk is not "low".
- KRI triggers and the executive report include standalone KRIs (no risk).
- The board report divides the residual average by the risks that have a residual score.
"""
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.erm.routers import advanced_analytics, reports
from grc.routers.auth_router import require_auth


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(m.Tenant(id=1, name="Bank", slug="bank", is_active=True))
    s.add(m.GRCUser(id=7, username="ada", email="ada@bank.test", display_name="Ada", is_active=True))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db):
    app = FastAPI()
    app.include_router(advanced_analytics.router)
    app.include_router(reports.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, 7)
    return TestClient(app)


def risk(db, id, category="operational", lk=None, imp=None, inherent=None, residual=None, **kw):
    r = m.Risk(id=id, tenant_id=1, title=f"Risk {id}", category=category, risk_category=category,
               residual_likelihood=lk, residual_impact=imp, inherent_score=inherent, residual_score=residual, **kw)
    db.add(r)
    db.commit()
    return r


# ── scenario analysis ────────────────────────────────────────────────────────

def test_an_unscored_risk_is_skipped_with_a_note_and_no_result_carries_a_null_change(http, db):
    risk(db, 1, lk=2, imp=3, residual=6)
    risk(db, 2)                                                          # never scored
    out = http.post("/analytics/scenario-analysis", json={"scenarios": [
        {"risk_id": 1, "adjusted_likelihood": 4, "adjusted_impact": 3},
        {"risk_id": 2, "adjusted_likelihood": 4, "adjusted_impact": 3},
    ]})
    assert out.status_code == 200, out.text
    body = out.json()
    assert [r["risk_id"] for r in body["results"]] == [1]
    row = body["results"][0]
    assert row["original_score"] == 6 and row["adjusted_score"] == 12 and row["score_change_pct"] == 100.0
    assert row["severity_original"] == "Medium" and row["severity_adjusted"] == "High"     # 6 / 12 cut-offs
    assert body["skipped"] == [{"risk_id": 2, "risk_title": "Risk 2", "reason": "No residual likelihood and impact"}]
    assert body["summary"]["risks_skipped"] == 1 and body["summary"]["total_original_score"] == 6


def test_a_preset_moves_only_the_categories_it_names(http, db):
    risk(db, 1, category="compliance", lk=2, imp=2, residual=4)
    risk(db, 2, category="operational", lk=2, imp=2, residual=4)
    out = http.post("/analytics/scenario-analysis",
                    json={"preset_id": "regulatory_change", "scenarios": [{"risk_id": 1}, {"risk_id": 2}]})
    assert out.status_code == 200, out.text
    rows = {r["risk_id"]: r for r in out.json()["results"]}
    assert (rows[1]["adjusted_likelihood"], rows[1]["adjusted_impact"]) == (3, 4)          # +1 / +2
    assert (rows[2]["adjusted_likelihood"], rows[2]["adjusted_impact"], rows[2]["score_change"]) == (2, 2, 0)
    assert out.json()["summary"]["risks_unchanged"] == 1


def test_a_preset_with_no_categories_moves_every_risk_and_stays_on_the_scale(http, db):
    risk(db, 1, category="strategic", lk=5, imp=1, residual=5)
    out = http.post("/analytics/scenario-analysis", json={"preset_id": "worst_case", "scenarios": [{"risk_id": 1}]})
    row = out.json()["results"][0]
    assert (row["adjusted_likelihood"], row["adjusted_impact"]) == (5, 2)
    assert http.post("/analytics/scenario-analysis", json={"preset_id": "nope", "scenarios": []}).status_code == 400


# ── bow-tie ──────────────────────────────────────────────────────────────────

def test_the_bow_tie_places_controls_by_their_own_type(http, db):
    risk(db, 1, lk=3, imp=3, residual=9)
    for cid, kind in ((11, "preventive"), (12, "detective"), (13, "corrective"), (14, None)):
        db.add(m.NormalizedControl(id=cid, code=f"C-{cid}", name=f"Control {cid}"))
        db.add(m.RiskControl(tenant_id=1, risk_id=1, control_source="normalized", control_id=cid))   # the one link (wave 5)
        if kind:
            db.add(m.CustomControlProfile(tenant_id=1, normalized_control_id=cid, control_type=kind))
    db.commit()
    body = http.get("/analytics/bowtie/1").json()
    assert [c["id"] for c in body["preventive_controls"]] == [11]
    assert sorted(c["id"] for c in body["mitigating_controls"]) == [12, 13]
    assert [c["id"] for c in body["unclassified_controls"]] == [14]
    assert {c["effectiveness"] for c in body["preventive_controls"] + body["mitigating_controls"]} == {"not assessed"}


# ── aggregation ──────────────────────────────────────────────────────────────

def test_aggregation_averages_what_was_scored_and_leaves_unscored_risks_out_of_the_bands(http, db):
    risk(db, 1, inherent=20, residual=12)
    risk(db, 2, inherent=10)
    risk(db, 3)
    summary = http.get("/analytics/aggregation").json()["enterprise_summary"]
    assert summary["avg_inherent_score"] == 15 and summary["avg_residual_score"] == 12
    assert (summary["critical_count"], summary["high_count"], summary["medium_count"], summary["low_count"]) == (0, 1, 1, 0)
    assert summary["unscored_count"] == 1 and "total_inherent_score" not in summary


# ── KRI triggers ─────────────────────────────────────────────────────────────

def red_kri(db, id, risk_id=None, measured=None):
    db.add(m.RiskKRI(id=id, tenant_id=1, risk_id=risk_id, name=f"KRI {id}", current_value=9, green_threshold=3,
                     amber_threshold=6, threshold_direction="lower_is_better", is_active=True, last_measured_at=measured))
    db.commit()


def test_kri_triggers_include_a_standalone_kri_by_its_own_id_and_real_time(http, db):
    risk(db, 1, lk=3, imp=3, residual=9)
    red_kri(db, 41, risk_id=1, measured=datetime(2026, 10, 1, 9, 30))
    red_kri(db, 42)                                                      # standalone, never measured
    alerts = {a["id"]: a for a in http.get("/analytics/kri-triggers").json()["alerts"]}
    assert set(alerts) == {41, 42}
    assert alerts[41]["risk_title"] == "Risk 1" and alerts[41]["triggered_at"] == "2026-10-01T09:30:00"
    assert alerts[42]["risk_id"] is None and alerts[42]["risk_title"] is None and alerts[42]["triggered_at"] is None
    assert alerts[42]["threshold_direction"] == "lower_is_better"


# ── reports ──────────────────────────────────────────────────────────────────

def test_the_board_residual_average_divides_by_risks_with_a_residual_score(http, db):
    risk(db, 1, inherent=20, residual=10)
    risk(db, 2, inherent=10)
    overview = http.get("/reports/board-summary").json()
    assert overview["risk_overview"]["avg_inherent_score"] == 15
    assert overview["risk_overview"]["avg_residual_score"] == 10       # was 5: divided by the 2 inherent scores
    assert overview["recommendations"] == []


def test_the_executive_report_bands_breaches_and_kris_follow_the_shared_rules(http, db):
    risk(db, 1, inherent=20, residual=14)
    risk(db, 2, category="compliance", inherent=8)
    risk(db, 3, category="financial")                                   # unscored: no band
    db.add(m.RiskAppetiteConfig(tenant_id=1, category="operational", max_acceptable_score=20, tolerance_threshold=12))
    db.add(m.RiskAppetiteConfig(tenant_id=1, category="compliance", max_acceptable_score=6))   # no tolerance set
    db.commit()
    red_kri(db, 42)
    body = http.get("/reports/executive-dashboard").json()
    assert body["risks_by_score_band"] == {"critical": 0, "high": 1, "medium": 1, "low": 0}
    assert {(b["risk_id"], b["threshold"]) for b in body["appetite_breaches"]} == {(1, 12), (2, 6)}
    assert [a["kri_id"] for a in body["kri_alerts"]] == [42]
    assert body["trend_summary"]["period"].startswith("as of ")
