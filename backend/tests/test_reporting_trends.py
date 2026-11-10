"""Trends (Reports > Trends): the board reads every metric's history in ONE query, and the cards say whether the target was changed.

What this guards: `GET /reporting/trends/overview` used to read one metric at a time (31 reads for the board) and `GET /trends/breakdown` one slice at a time.
The batched readers must return exactly what the per-metric reader returned, the endpoints must not write, and the additive card keys must tell a changed
target from the default. In-memory SQLite, the two history tables only.
"""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from grc.models import MetricSnapshot, MetricTarget
from grc.routers import reporting_router as rr
from grc.services import metric_catalog, metric_snapshots


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    MetricSnapshot.__table__.create(engine)
    MetricTarget.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    session.info["engine"] = engine
    yield session
    session.close()


def _snap(db, metric, day, value, dimension="overall", dimension_value="all", tenant=1):
    db.add(MetricSnapshot(tenant_id=tenant, metric=metric, dimension=dimension, dimension_value=dimension_value, as_of_date=day, value=value, meta={}))


def _seed(db, days=40):
    today = date.today()
    for i in range(days, -1, -5):
        d = today - timedelta(days=i)
        _snap(db, "portfolio_avg_residual", d, 50.0 + i / 10)
        _snap(db, "open_risks", d, 10 + i)
        _snap(db, "open_risks", d, 99, tenant=2)               # another tenant: never in the answer
    for sev, base in (("critical", 2), ("high", 9), ("medium", 20)):
        for i in range(days, -1, -10):
            _snap(db, "vuln_open", today - timedelta(days=i), base + i // 10, dimension="severity", dimension_value=sev)
    db.commit()


def _count_selects(db, fn):
    engine = db.info["engine"]
    seen = []

    def before(conn, cursor, statement, params, context, executemany):
        if statement.lstrip().upper().startswith("SELECT") and "grc_metric_snapshot" in statement:
            seen.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    try:
        result = fn()
    finally:
        event.remove(engine, "before_cursor_execute", before)
    return result, len(seen)


def test_read_trends_is_one_query_and_equals_the_per_metric_reader(db):
    _seed(db)
    keys = ["portfolio_avg_residual", "open_risks", "no_such_history"]
    many, n = _count_selects(db, lambda: metric_snapshots.read_trends(db, [1], keys, 180))
    assert n == 1
    for key in keys:
        assert many[key] == metric_snapshots.read_trend(db, [1], key, 180)
    assert many["no_such_history"] == []                        # every metric asked for is a key
    assert all(p["value"] != 99 for p in many["open_risks"])    # tenant 2's rows are not here


def test_read_trends_respects_the_window_and_an_empty_ask(db):
    _seed(db)
    assert metric_snapshots.read_trends(db, [1], [], 180) == {}
    short = metric_snapshots.read_trends(db, [1], ["open_risks"], 7)["open_risks"]
    assert [p["date"] for p in short] == [(date.today() - timedelta(days=5)).isoformat(), date.today().isoformat()]
    assert short == metric_snapshots.read_trend(db, [1], "open_risks", 7)


def test_read_trend_slices_is_one_query_and_equals_the_per_slice_reader(db):
    _seed(db)
    slices, n = _count_selects(db, lambda: metric_snapshots.read_trend_slices(db, [1], "vuln_open", 180, "severity"))
    assert n == 1
    assert sorted(slices) == ["critical", "high", "medium"]
    for value, points in slices.items():
        assert points == metric_snapshots.read_trend(db, [1], "vuln_open", 180, "severity", value)


def test_the_overview_reads_the_history_once_whatever_the_number_of_metrics(db, monkeypatch):
    _seed(db)
    monkeypatch.setattr(rr, "_user_perm_names", lambda user, db_: {"*:*:*"})
    monkeypatch.setattr(rr, "_tenant_id", lambda user, db_: 1)
    out, n = _count_selects(db, lambda: rr.trends_overview(days=180, db=db, user=object()))
    assert len(out["cards"]) == len(metric_catalog.METRICS) >= 25
    assert n == 1, f"{n} reads of the snapshot table for the board"
    by_key = {c["key"]: c for c in out["cards"]}
    assert [p["value"] for p in by_key["open_risks"]["points"]] == [p["value"] for p in metric_snapshots.read_trend(db, [1], "open_risks", 180)]
    assert by_key["open_risks"]["current"] == by_key["open_risks"]["points"][-1]["value"]
    assert by_key["portfolio_avg_residual"]["status"] in ("ok", "warn", "critical", "none")


def test_the_overview_lists_only_the_metrics_the_caller_may_see(db, monkeypatch):
    _seed(db)
    monkeypatch.setattr(rr, "_user_perm_names", lambda user, db_: {"erm:risks:view"})
    monkeypatch.setattr(rr, "_tenant_id", lambda user, db_: 1)
    out = rr.trends_overview(days=90, db=db, user=object())
    assert out["cards"] and {c["module"] for c in out["cards"]} <= {"risk", "vendors"}
    monkeypatch.setattr(rr, "_user_perm_names", lambda user, db_: set())
    assert rr.trends_overview(days=90, db=db, user=object())["cards"] == []     # no module right: no cards (the page says so in words)


def test_breakdown_is_one_read_and_unchanged_in_shape(db, monkeypatch):
    _seed(db)
    monkeypatch.setattr(rr, "_user_perm_names", lambda user, db_: {"*:*:*"})
    monkeypatch.setattr(rr, "_tenant_id", lambda user, db_: 1)
    metric = metric_catalog.get("vuln_open")
    assert metric.dimension == "severity"
    out, n = _count_selects(db, lambda: rr.trends_breakdown(metric=metric.key, days=180, db=db, user=object()))
    assert n == 1
    assert out["dimension"] == "severity" and out["metric"] == metric.key
    assert [s["key"] for s in out["series"]] == sorted(s["key"] for s in out["series"])
    assert [s["key"] for s in out["series"]] == ["critical", "high", "medium"]
    assert all(set(p) == {"date", "value"} for s in out["series"] for p in s["points"])


def test_a_card_says_whether_the_target_was_changed_and_what_the_default_is(db, monkeypatch):
    monkeypatch.setattr(rr, "_user_perm_names", lambda user, db_: {"*:*:*"})
    monkeypatch.setattr(rr, "_tenant_id", lambda user, db_: 1)
    key = "portfolio_avg_residual"
    mdef = metric_catalog.get(key)
    before = {c["key"]: c for c in rr.trends_overview(days=30, db=db, user=object())["cards"]}[key]
    assert before["customized"] is False and before["target"] == mdef.target
    assert before["default_target"] == mdef.target and before["default_warn"] == mdef.warn

    rr.set_target(rr.TargetIn(metric=key, target=33.0, warn=44.0, critical=None), db=db, user=object())
    after = {c["key"]: c for c in rr.trends_overview(days=30, db=db, user=object())["cards"]}[key]
    assert after["customized"] is True and after["target"] == 33.0 and after["warn"] == 44.0
    assert after["default_target"] == mdef.target, "the default stays what Reset goes back to"
    series = rr.trends_series(metric=key, days=30, dimension="overall", dimension_value="all", db=db, user=object())
    assert series["customized"] is True and series["target"] == 33.0
    catalog = {m["key"]: m for m in rr.trends_catalog(db=db, user=object())["metrics"]}
    assert catalog[key]["customized"] is True

    rr.reset_target(metric=key, db=db, user=object())
    again = {c["key"]: c for c in rr.trends_overview(days=30, db=db, user=object())["cards"]}[key]
    assert again["customized"] is False and again["target"] == mdef.target


def test_no_trends_read_writes_a_snapshot(db, monkeypatch):
    """A GET never snapshots: the only writer is POST /trends/snapshot (and the sweep). Reading leaves the table as it was."""
    _seed(db)
    monkeypatch.setattr(rr, "_user_perm_names", lambda user, db_: {"*:*:*"})
    monkeypatch.setattr(rr, "_tenant_id", lambda user, db_: 1)
    count = lambda: db.query(MetricSnapshot).count()          # noqa: E731
    before = count()
    rr.trends_overview(days=180, db=db, user=object())
    rr.trends_series(metric="open_risks", days=180, dimension="overall", dimension_value="all", db=db, user=object())
    rr.trends_catalog(db=db, user=object())
    assert count() == before


def test_the_status_and_delta_rules_are_unchanged():
    mdef = metric_catalog.get("portfolio_avg_residual")                  # down_good
    assert metric_catalog.rag_status(30, "down_good", 40, 60) == "ok"
    assert metric_catalog.rag_status(50, "down_good", 40, 60) == "warn"
    assert metric_catalog.rag_status(70, "down_good", 40, 60) == "critical"
    assert metric_catalog.rag_status(50, "up_good", 40, 30) == "ok"
    assert metric_catalog.rag_status(None, "up_good", 40) == "none" and metric_catalog.rag_status(5, "neutral", 40) == "none"
    today = date.today()
    pts = [{"date": (today - timedelta(days=45)).isoformat(), "value": 10.0}, {"date": (today - timedelta(days=31)).isoformat(), "value": 20.0}, {"date": today.isoformat(), "value": 30.0}]
    stats = rr._series_stats(pts, mdef, 40, 60)
    assert stats["previous"] == 20.0 and stats["delta_abs"] == 10.0 and stats["delta_pct"] == 50.0
