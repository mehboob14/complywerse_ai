"""The six module scorecards the Performance Overview and every module Overview read (Governance documents-overview, Compliance,
Assets inventory-overview, Issues & Incidents, Control Assurance, Risk Management sections-overview), over HTTP on in-memory SQLite.

What these pin:
  * the payload shape the Overviews read: top-level keys, the section keys, the exact attention_queue keys, the components shape
    and the grade bands (>= 85 excellent, >= 70 good, >= 50 fair, else poor) - a rename or a change breaks a module page;
  * the top-level `target` and `customized` (what the tenant tuned), equal to every component's target and to the editor's GET;
  * a GET never writes - not a row, not a flush that is rolled back later (the Compliance and Assurance scorecards used to insert a
    work item per internal control on every read and discard it on close; the Governance scorecard used to commit today's score);
  * those controls are still scored exactly as before, now in memory (scorecard_rows);
  * the Governance health trend gains a point only through POST /documents-overview/snapshot.
"""
import os
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import grc.models as m  # noqa: E402
from grc.modules.compliance import compliance_router  # noqa: E402
from grc.modules.control_library import control_library_router  # noqa: E402
from grc.modules.control_library.routers.workbench import sync_internal_control_work_items  # noqa: E402
from grc.modules.erm import erm_router  # noqa: E402
from grc.modules.governance import governance_module_router, permissions  # noqa: E402
from grc.modules.issue_management import issue_management_router  # noqa: E402
from grc.routers.assets_router import router as assets_router  # noqa: E402
from grc.routers.auth_router import create_access_token, require_auth  # noqa: E402
from grc.services import scorecard_config as sc  # noqa: E402

ADMIN, PLAIN = 1, 2
NOW = datetime.utcnow()

# module key (scorecard_config) -> (the scorecard, the tuning endpoint, the exact attention_queue keys)
MODULES = {
    "governance": ("/governance/dashboard/documents-overview", "/governance/dashboard/scorecard-config",
                   {"documents_awaiting_approval", "overdue_reviews", "expiring_documents_30d", "exceptions_attention", "open_gaps",
                    "overdue_attestations", "overdue_actions", "red_kris", "total"}),
    "compliance": ("/compliance/policies/dashboard/sections-overview", "/compliance/policies/dashboard/scorecard-config",
                   {"controls_without_evidence", "controls_unverified", "controls_untested", "overdue_control_tests", "evidence_stale",
                    "regulatory_overdue_tasks", "total"}),
    "assets": ("/assets/inventory-overview", "/assets/scorecard-config",
               {"assets_without_owner", "assets_unassessed", "open_critical_high_vulns", "stale_assets", "internet_facing_unassessed",
                "total"}),
    "issue_incident": ("/issue-management/dashboard/sections-overview", "/issue-management/dashboard/scorecard-config",
                       {"open_critical_issues", "sla_breached_issues", "open_critical_incidents", "open_incidents",
                        "overdue_corrective_actions", "serious_issues_unactioned", "total"}),
    "assurance": ("/control-library/assurance/sections-overview", "/control-library/assurance/scorecard-config",
                  {"controls_untested", "overdue_control_tests", "ineffective_key_controls", "total"}),
    "erm": ("/erm/dashboard/sections-overview", "/erm/dashboard/scorecard-config",
            {"critical_open_risks", "unscored_active_risks", "blocked_questions", "overdue_ai_reviews", "rcsa_open_findings",
             "controls_tests_overdue", "vendor_overdue_reassessments", "vendor_critical_findings", "vendor_overdue_remediations",
             "red_kris", "appetite_breaches", "overdue_mitigation_actions", "overdue_risk_reviews", "open_critical_incidents",
             "total"}),
}
GOVERNANCE, COMPLIANCE, ASSURANCE = (MODULES[k][0] for k in ("governance", "compliance", "assurance"))
SNAPSHOT = "/governance/dashboard/documents-overview/snapshot"
BASE_KEYS = {"as_of", "target", "customized", "sections", "attention_queue", "performance"}


def grade_of(score):
    return None if score is None else "excellent" if score >= 85 else "good" if score >= 70 else "fair" if score >= 50 else "poor"


@pytest.fixture(scope="module")
def engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    return engine


STATE = SimpleNamespace(db=None, me={"id": ADMIN})                  # the app is built once (it takes seconds); each test swaps this


@pytest.fixture(scope="module")
def client():
    app = FastAPI()
    for router in (governance_module_router, compliance_router, assets_router, issue_management_router, erm_router, control_library_router):
        app.include_router(router)
    app.dependency_overrides[m.get_db] = lambda: STATE.db
    app.dependency_overrides[require_auth] = lambda: STATE.db.get(m.GRCUser, STATE.me["id"])
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": "ada", "tenant_slug": "demo", "tenant_id": 1})
    return http


def build(engine, client, seeded):
    db = sessionmaker(bind=engine)()
    if seeded:
        db.add(m.Tenant(id=1, name="Demo Bank", slug="demo", primary_contact_email="ada@demo.test"))
    db.add(m.GRCUser(id=ADMIN, username="ada", email="ada@demo.test", display_name="Ada Admin"))
    db.add(m.GRCUser(id=PLAIN, username="pat", email="pat@demo.test", display_name="Pat Plain"))
    db.commit()
    me = {"id": ADMIN}
    STATE.db, STATE.me = db, me
    http = client
    writes = []

    def record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().split(None, 1)[0].upper() in ("INSERT", "UPDATE", "DELETE"):
            writes.append(statement[:70])

    event.listen(engine, "before_cursor_execute", record)
    return SimpleNamespace(db=db, http=http, me=me, writes=writes, _record=record)


def teardown(engine, w):
    event.remove(engine, "before_cursor_execute", w._record)
    w.db.rollback()
    w.db.close()
    with engine.begin() as conn:                                              # SQLite does not enforce the foreign keys: any order
        for table in m.Base.metadata.tables.values():
            conn.execute(table.delete())


@pytest.fixture
def world(engine, client):
    w = build(engine, client, seeded=True)
    yield w
    teardown(engine, w)


@pytest.fixture
def no_tenant(engine, client):
    w = build(engine, client, seeded=False)
    yield w
    teardown(engine, w)


def seed_controls(db):
    """Three internal controls. A (active, key, tested, one test late) has no work item; B (active) has a stored one that says something
    else than the register (the stored row wins); C is a draft with none.  Expected, by hand, in the tests below."""
    db.add_all([
        m.InternalControl(id=1, tenant_id=1, control_id="IC-1", name="A", status="active", is_key_control=True,
                          design_effectiveness="effective", operating_effectiveness="effective",
                          last_tested_at=NOW - timedelta(days=5), next_test_date=NOW - timedelta(days=2)),
        m.InternalControl(id=2, tenant_id=1, control_id="IC-2", name="B", status="active", is_key_control=False,
                          design_effectiveness="effective", operating_effectiveness="effective", next_test_date=NOW + timedelta(days=30)),
        m.InternalControl(id=3, tenant_id=1, control_id="IC-3", name="C", status="draft"),
    ])
    db.add_all([
        m.InternalControlTest(control_id=1, tenant_id=1, test_type="operating", exceptions_found=0, result="effective",
                              status="reviewed", tester_id=ADMIN, reviewer_id=PLAIN),
        m.InternalControlTest(control_id=1, tenant_id=1, test_type="design", exceptions_found=2, result="partially_effective",
                              status="completed", tester_id=ADMIN, reviewer_id=ADMIN),
    ])
    db.add(m.ControlWorkItem(id=1, tenant_id=1, source_type="internal", source_id=2, code="IC-2", name="B", status="active",
                             operating_effectiveness="ineffective", next_test_date=NOW + timedelta(days=30), is_key_control=False))
    db.commit()


def payload(w, key):
    got = w.http.get(MODULES[key][0])
    assert got.status_code == 200, got.text
    return got.json()


def without_as_of(data):
    return {k: v for k, v in data.items() if k != "as_of"}


# ───────────────────────────────── shape ─────────────────────────────────
@pytest.mark.parametrize("key", list(MODULES))
def test_the_payload_keeps_the_shape_the_overviews_read(world, key):
    data = payload(world, key)
    assert BASE_KEYS <= set(data)
    assert set(data["sections"]) == {k for k, _label, _weight in sc.DEFAULTS[key]["sections"]}, "the sections are the tuning editor's sections"
    for section in data["sections"].values():
        assert {"key", "label", "weight", "score", "metrics"} <= set(section)
        for metric in section["metrics"]:
            assert {"key", "label", "weight", "score", "numerator", "denominator", "formula"} <= set(metric)
    assert set(data["attention_queue"]) == MODULES[key][2], "module Overviews read these keys: never rename one"
    performance = data["performance"]
    assert {"score", "grade", "components"} <= set(performance)
    assert [set(c) for c in performance["components"]] == [{"key", "label", "score", "weight", "target"}] * len(data["sections"])
    assert [c["key"] for c in performance["components"]] == list(data["sections"])
    assert performance["grade"] == grade_of(performance["score"])


@pytest.mark.parametrize("key", list(MODULES))
def test_target_and_customized_are_top_level_and_default_to_85_and_false(world, key):
    data = payload(world, key)
    assert (data["target"], data["customized"]) == (85, False)
    assert {c["target"] for c in data["performance"]["components"]} == {85}


@pytest.mark.parametrize("key", ["compliance", "assets", "assurance"])
def test_with_no_tenant_the_payload_is_empty_and_still_carries_target_and_customized(no_tenant, key):
    got = no_tenant.http.get(MODULES[key][0])
    assert got.status_code == 200, got.text
    data = got.json()
    assert BASE_KEYS <= set(data) and (data["target"], data["customized"]) == (85, False)
    assert data["sections"] == {} and data["attention_queue"] == {}
    assert data["performance"]["score"] is None and data["performance"]["components"] == []


@pytest.mark.parametrize("key", list(MODULES))
def test_tuning_the_target_shows_at_the_top_and_in_every_component_and_resetting_clears_it(world, key):
    _scorecard, config, _keys = MODULES[key]
    assert world.http.put(config, json={"target": 92}).status_code == 200
    data = payload(world, key)
    assert (data["target"], data["customized"]) == (92, True)
    assert {c["target"] for c in data["performance"]["components"]} == {92}
    editor = world.http.get(config).json()
    assert (editor["target"], editor["customized"]) == (data["target"], data["customized"]), "the editor and the scorecard agree"
    assert data["performance"]["grade"] == grade_of(data["performance"]["score"]), "the target never moves the grade bands"

    assert world.http.delete(config).status_code == 200
    data = payload(world, key)
    assert (data["target"], data["customized"]) == (85, False)


@pytest.mark.parametrize("key", list(MODULES))
def test_tuning_only_the_weights_is_customized_with_the_default_target(world, key):
    config = MODULES[key][1]
    first, second = (k for k, _label, _weight in sc.DEFAULTS[key]["sections"][:2])
    assert world.http.put(config, json={"weights": {first: 3, second: 1}}).status_code == 200
    data = payload(world, key)
    assert (data["target"], data["customized"]) == (85, True)
    assert data["sections"][first]["weight"] == 0.75 and data["sections"][second]["weight"] == 0.25, "the weights renormalise"
    # a tuned target that equals the default is not a customisation
    assert world.http.delete(config).status_code == 200
    assert world.http.put(config, json={"target": 85}).status_code == 200
    assert payload(world, key)["customized"] is False


def test_the_customized_rule_is_the_editors():
    assert sc.is_customized({}, "erm") is False
    assert sc.is_customized({"target": 85}, "erm") is False
    assert sc.is_customized({"target": 80}, "erm") is True
    assert sc.is_customized({"weights": {"register": 1.0}}, "erm") is True
    assert sc.is_customized({"metric_weights": {"register": {"a": 1.0}}}, "erm") is True
    assert sc.is_customized({"weights": {}, "metric_weights": {}, "target": 85.0}, "erm") is False


# ───────────────────────────── a GET writes nothing ─────────────────────────────
@pytest.mark.parametrize("key", list(MODULES))
def test_reading_a_scorecard_writes_nothing_however_often(world, key):
    seed_controls(world.db)
    world.writes.clear()
    for _ in range(3):
        assert world.http.get(MODULES[key][0]).status_code == 200
    assert world.writes == [], "a GET must not insert, update or delete - not even a flush that the request later discards"
    assert world.db.query(m.ControlWorkItem).count() == 1 and world.db.query(m.ControlWorkTest).count() == 0
    assert world.db.query(m.MetricSnapshot).count() == 0


# ─────────────────── controls without a work item are scored in memory ───────────────────
def test_assurance_scores_a_control_that_has_no_work_item_yet_without_creating_one(world):
    seed_controls(world.db)
    data = payload(world, "assurance")
    s = data["sections"]
    assert s["coverage"]["counts"] == {"active": 2, "tested": 2, "scheduled": 2, "key_controls": 1}
    assert s["effectiveness"]["counts"] == {"active": 2, "operating_effective": 1, "design_effective": 1, "key_effective": 1}
    assert s["quality"]["counts"] == {"overdue_tests": 1, "tests": 2, "tests_clean": 1, "independently_reviewed": 1, "completed_tests": 2}
    assert data["attention_queue"] == {"controls_untested": 0, "overdue_control_tests": 1, "ineffective_key_controls": 0, "total": 1}
    assert [s[k]["score"] for k in ("coverage", "effectiveness", "quality")] == [100.0, 65.0, 50.0]
    assert (data["performance"]["score"], data["performance"]["grade"]) == (73.5, "good")
    assert world.db.query(m.ControlWorkItem).count() == 1, "only the stored one: nothing was materialised"


def test_compliance_scores_the_same_controls_by_its_own_rule_without_creating_work_items(world):
    seed_controls(world.db)
    eff = payload(world, "compliance")["sections"]["effectiveness"]["counts"]
    # tested = a last_tested_at or a test row (B has neither: its rated dropdown does not count here - the Assurance board's rule differs)
    assert eff == {"active": 2, "tested": 1, "operating_effective": 1, "ops_rated": 2, "overdue_tests": 1, "scheduled": 2,
                   "key_controls": 1, "key_effective": 1, "tests": 2}
    aq = payload(world, "compliance")["attention_queue"]
    assert (aq["controls_untested"], aq["overdue_control_tests"]) == (1, 1)
    assert world.db.query(m.ControlWorkItem).count() == 1


@pytest.mark.parametrize("key", ["assurance", "compliance"])
def test_scoring_in_memory_gives_the_numbers_the_old_materialising_read_gave(world, key):
    """The old GET inserted the missing work items (and their tests) before scoring; doing that for real must change nothing."""
    seed_controls(world.db)
    before = without_as_of(payload(world, key))
    assert sync_internal_control_work_items(world.db, 1) == 3                    # A, B (existing) and C: what the old read did
    world.db.commit()
    assert world.db.query(m.ControlWorkItem).count() == 3 and world.db.query(m.ControlWorkTest).count() == 2
    assert without_as_of(payload(world, key)) == before


def test_a_stored_work_item_wins_over_the_register_and_a_virtual_one_never_collides_with_it(world):
    from grc.modules.control_library.scorecard_rows import work_rows

    seed_controls(world.db)
    items, tests = work_rows(world.db, [1])
    assert sorted(w.id for w in items) == [-3, -1, 1], "A and C are virtual (negative ids), B is the stored row"
    stored = next(w for w in items if w.id == 1)
    assert stored.operating_effectiveness == "ineffective", "the stored row, not the register's 'effective'"
    assert sorted(t.work_item_id for t in tests) == [-1, -1]
    virtual = next(w for w in items if w.id == -3)
    assert (virtual.status, virtual.is_key_control, virtual.tenant_id) == ("draft", False, 1)


# ───────────────────────── the Governance snapshot is a POST ─────────────────────────
def snapshots(w):
    w.db.expire_all()
    return w.db.query(m.MetricSnapshot).filter_by(metric="governance_health").order_by(m.MetricSnapshot.as_of_date).all()


def test_reading_the_governance_scorecard_keeps_no_snapshot_and_the_trend_still_ends_at_todays_score(world):
    world.writes.clear()
    data = payload(world, "governance")
    assert world.writes == [] and snapshots(world) == []
    trend = data["performance"]["health_trend"]
    assert len(trend) == 1 and set(trend[0]) == {"label", "year", "value"}
    assert trend[0]["value"] == data["performance"]["score"] and trend[0]["year"] == str(NOW.year)


def test_the_snapshot_post_keeps_todays_score_once_a_day(world):
    first = world.http.post(SNAPSHOT)
    assert first.status_code == 200, first.text
    score = payload(world, "governance")["performance"]["score"]
    assert score is not None
    assert set(first.json()) == {"as_of", "score", "written"} and first.json()["score"] == score and first.json()["written"] == 1
    rows = snapshots(world)
    assert [(r.tenant_id, r.as_of_date, r.value) for r in rows] == [(1, NOW.date(), score)]

    assert world.http.post(SNAPSHOT).json()["written"] == 1
    assert len(snapshots(world)) == 1, "asking again the same day replaces the day's row"
    assert len(payload(world, "governance")["performance"]["health_trend"]) == 1


def test_earlier_snapshots_are_the_history_and_a_read_never_overwrites_todays(world):
    old = (NOW - timedelta(days=40)).date()
    world.db.add_all([m.MetricSnapshot(tenant_id=1, metric="governance_health", as_of_date=old, value=40.0),
                      m.MetricSnapshot(tenant_id=1, metric="governance_health", as_of_date=NOW.date(), value=10.0)])
    world.db.commit()
    world.writes.clear()
    trend = payload(world, "governance")["performance"]["health_trend"]
    assert world.writes == []
    assert [t["value"] for t in trend] == [40.0, 100.0], "the line ends at the number on the screen, not at the stale stored one"
    assert [r.value for r in snapshots(world)] == [40.0, 10.0], "and the stored row stays until someone snapshots"


def test_the_snapshot_needs_the_same_right_as_the_read(world):
    world.me["id"] = PLAIN
    refused = world.http.get(GOVERNANCE)
    assert refused.status_code == 403 and refused.json()["detail"] == permissions.LIBRARY_REFUSED
    post = world.http.post(SNAPSHOT)
    assert post.status_code == 403 and post.json()["detail"] == permissions.LIBRARY_REFUSED
    assert snapshots(world) == []


def test_the_snapshot_of_a_tenant_the_person_cannot_reach_is_refused(world):
    assert world.http.post(SNAPSHOT, params={"tenant_id": 99}).status_code == 403
    assert snapshots(world) == []
