"""Auditor Portal: what the front door's charts draw (Overview dashboards, 2026-11-11).

GET /auditor-portal/work/summary: files and scope requests per calendar month (sent, decided, waiting at the end of the month), the waiting ones by age, the
requirements by scope state. GET /auditor-portal/statutory-audit/observations/summary: open, the register's deadline chips, priority by status, opened and closed
per month, regulators. Both are reads, both agree with the numbers the front door and the register already show. In-memory SQLite, the route functions called directly.
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.auditor_portal.months import month_windows
from grc.modules.auditor_portal.routers import overview, statutory_audit as sa

NOW = datetime.utcnow()


def ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


@pytest.fixture()
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", is_active=True, primary_contact_email="ada@acme.test"))
    db.add_all([
        m.GRCUser(id=7, username="ada", email="ada@acme.test", display_name="Ada Admin", is_active=True),
        m.GRCUser(id=8, username="vic", email="vic@acme.test", display_name="Vic Viewer", is_active=True),
    ])
    db.add(m.UploadedFramework(id=3, tenant_id=1, name="ISO 27001", version="2022", file_name="iso.pdf", file_path="iso.pdf", file_type="pdf", uploaded_by=7))
    for i in range(1, 6):
        db.add(m.ParsedFrameworkControl(id=i, uploaded_framework_id=3, control_id=f"FW-{i:03d}", original_reference=f"A.{i}", title=f"Control {i}", description="x"))
    db.add(m.CertificationJourney(id=1, tenant_id=1, uploaded_framework_id=3, name="ISO 27001 - 2026", status="in_progress", started_at=ago(200)))
    db.flush()
    for i in range(1, 6):
        db.add(m.ControlImplementation(id=100 + i, journey_id=1, parsed_control_id=i, status="not_started"))
    db.commit()
    yield db
    db.close()


def user(db):
    return db.get(m.GRCUser, 7)


def file_row(db, impl, status, sent, decided=None):
    db.add(m.ImplementationEvidence(implementation_id=impl, file_name="f.pdf", uploaded_at=sent, uploaded_by=8, review_status=status, reviewed_at=decided, reviewed_by=7 if decided else None))
    db.flush()


def request(db, control, status, applicable, asked, decided=None):
    db.add(m.ClauseApplicability(tenant_id=1, uploaded_framework_id=3, control_id=control, is_applicable=applicable, status=status, requested_by=8, requested_at=asked,
                                 reviewed_by=7 if decided else None, reviewed_at=decided))
    db.flush()


def summary(db):
    return overview.get_work_summary(db=db, current_user=user(db))


def test_the_last_twelve_months_oldest_first_with_an_exclusive_end_and_the_year_boundary():
    w = month_windows(datetime(2026, 2, 17, 9, 30))
    assert len(w) == 12 and w[0][0] == "2025-03" and w[-1][0] == "2026-02" and w[-1][2] == datetime(2026, 3, 1)
    assert w[10][0] == "2026-01" and w[10][1] == datetime(2026, 1, 1) and w[10][2] == datetime(2026, 2, 1)
    assert w[9][2] == datetime(2026, 1, 1), "December ends where January starts"
    assert [k for k, _, _ in month_windows(datetime(2026, 12, 31), 2)] == ["2026-11", "2026-12"]
    assert month_windows(datetime(2026, 12, 31), 1)[0][2] == datetime(2027, 1, 1)


def test_the_front_door_charts_agree_with_the_counters_and_say_when_a_request_waited(world):
    db = world
    file_row(db, 101, "pending", ago(3))                          # waiting, under a week
    file_row(db, 102, None, ago(40))                              # no state is waiting, as the counters read it; 30-89 days
    file_row(db, 103, "pending", ago(120))                        # waiting, over 90 days
    file_row(db, 104, "approved", ago(100), decided=ago(20))      # waited from 100 to 20 days ago
    file_row(db, 105, "rejected", ago(10), decided=ago(2))
    db.commit()
    work = overview.get_work(limit=20, db=db, current_user=user(db))
    s = summary(db)
    assert len(s["months"]) == 12 and s["months"][-1] == f"{NOW:%Y-%m}"
    f = s["files"]
    assert f["waiting"][-1] == work["counters"]["files_to_review"] == 3, "the last month's backlog is the counter"
    assert sum(f["sent"]) == 5 and sum(f["decided"]) == 2
    assert s["aging"]["files"] == [1, 0, 0, 1, 1] and s["aging"]["undated"] == {"files": 0, "scope": 0}
    assert sum(s["aging"]["files"]) == work["counters"]["files_to_review"]
    # the approved file waited from 100 to 20 days ago: it is in the backlog of every month end between, and not after it was decided
    idx = {k: i for i, k in enumerate(s["months"])}
    ended = f"{ago(20):%Y-%m}"
    started = f"{ago(100):%Y-%m}"
    if ended in idx and started in idx and ended != started:
        before = idx[ended] - 1
        assert f["waiting"][before] >= 1


def test_a_request_decided_with_no_time_is_never_counted_as_waiting_in_the_past(world):
    db = world
    file_row(db, 101, "approved", ago(50), decided=None)           # decided, and nobody knows when
    file_row(db, 102, "pending", ago(50))
    db.commit()
    f = summary(db)["files"]
    assert f["waiting"][-1] == 1 and sum(f["decided"]) == 0 and sum(f["sent"]) == 2


def test_scope_requests_by_state_and_age_count_once_per_framework(world):
    db = world
    db.add(m.CertificationJourney(id=2, tenant_id=1, uploaded_framework_id=3, name="ISO 27001 - second pass", status="in_progress", started_at=ago(10)))
    db.flush()
    request(db, 1, "pending", True, ago(5))
    request(db, 2, "pending", False, ago(45))
    request(db, 3, "approved", True, ago(60), decided=ago(30))
    request(db, 4, "approved", False, ago(60), decided=ago(25))
    request(db, 5, "rejected", True, ago(70), decided=ago(15))
    db.commit()
    work = overview.get_work(limit=20, db=db, current_user=user(db))
    s = summary(db)
    assert s["scope_totals"] == {"controls": 5, "in_scope": 1, "out_of_scope": 1, "waiting": 2, "turned_down": 1, "no_request": 0}
    assert s["scope"]["waiting"][-1] == work["counters"]["scope_to_decide"] == 2, "two journeys share the framework: counted once"
    assert s["aging"]["scope"] == [1, 0, 0, 1, 0] and sum(s["scope"]["sent"]) == 5 and sum(s["scope"]["decided"]) == 3


def test_requirements_nobody_asked_about_are_counted(world):
    db = world
    request(db, 1, "approved", True, ago(5), decided=ago(1))
    db.commit()
    t = summary(db)["scope_totals"]
    assert (t["controls"], t["in_scope"], t["no_request"]) == (5, 1, 4)


def test_an_organisation_with_no_journey_gets_empty_charts_not_an_error(world):
    db = world
    db.query(m.ControlImplementation).delete()
    db.query(m.CertificationJourney).delete()
    db.commit()
    s = summary(db)
    assert len(s["months"]) == 12 and s["files"]["sent"] == [0] * 12 and s["scope"]["waiting"] == [0] * 12 and s["aging"]["files"] == [0] * 5
    assert s["scope_totals"]["controls"] == 0


def test_the_summary_reads_and_writes_nothing(world):
    db = world
    file_row(db, 101, "pending", ago(3))
    db.commit()
    before = db.query(m.AuditLog).count()
    summary(db)
    assert not db.dirty and not db.new and db.query(m.AuditLog).count() == before


# ── observations ─────────────────────────────────────────────────────────────

def obs(db, status="open", priority="medium", due=None, created=None, closed=None, source="SBP", title="An observation"):
    db.add(m.AuditObservation(tenant_id=1, title=title, status=status, priority=priority, due_date=due, created_at=created or ago(1), closed_at=closed, regulator_source=source))
    db.flush()


def observations(db):
    return sa.observations_summary(db=db, current_user=user(db))


def test_the_observation_summary_is_the_registers_own_chips(world):
    db = world
    obs(db, "open", "critical", due=ago(5))                       # overdue
    obs(db, "in_progress", "high", due=NOW + timedelta(days=10))  # due in 30 days
    obs(db, "open", "high", due=NOW + timedelta(days=400))        # later
    obs(db, "closed", "low", due=ago(50), created=ago(90), closed=ago(20))
    obs(db, "cancelled", "low", due=ago(50), created=ago(90), closed=ago(20))
    db.commit()
    s = observations(db)
    rows = sa.list_observations(search=None, status_filter=None, priority=None, regulator_source=None, audit_period=None, observation_type=None, category=None,
                                skip=0, limit=200, db=db, current_user=user(db))["items"]
    breached = [r for r in rows if r["sla"]["state"] == "breached"]
    due30 = [r for r in rows if r["status"] not in ("closed", "cancelled") and r["sla"]["state"] in ("due_soon", "on_track") and 0 <= r["sla"]["due_in_days"] <= 30]
    assert s["total"] == 5 and s["open"] == 3
    assert s["deadlines"]["overdue"] == len(breached) and s["deadlines"]["due_30"] == len(due30), "the same numbers as the register's Overdue and Due in 30 days chips"
    assert sum(s["deadlines"].values()) == s["open"]
    assert s["by_priority"]["critical"] == {"open": 1} and s["by_priority"]["high"] == {"in_progress": 1, "open": 1} and s["by_priority"]["low"] == {"closed": 1, "cancelled": 1}
    assert s["priorities"][:4] == ["critical", "high", "medium", "low"]
    assert [l["key"] for l in s["levels"]] == ["open", "in_progress", "complied", "closed", "cancelled"] and s["levels"][3]["terminal"] is True


def test_opened_and_closed_per_month_and_regulators_with_case_ignored(world):
    db = world
    obs(db, "open", created=ago(2), source="SBP")
    obs(db, "open", created=ago(2), source="sbp")
    obs(db, "closed", created=ago(400), closed=ago(2), source="SECP")                       # opened outside the window, closed inside it
    obs(db, "complied", created=ago(70), source=None)
    db.commit()
    s = observations(db)
    this_month = len(s["months"]) - 1
    assert s["opened"][this_month] == 2 and s["closed"][this_month] == 1 and sum(s["opened"]) == 3
    by = {(r["name"] or "").lower(): r for r in s["regulators"]}
    assert by["sbp"]["open"] == 2 and by["sbp"]["total"] == 2 and by["secp"]["open"] == 0 and by["secp"]["total"] == 1 and by[""]["open"] == 1
    assert [r["name"] for r in s["regulators"]][0] in ("SBP", "sbp"), "most open first"


def test_the_observation_summary_of_an_empty_register_is_empty_not_an_error(world):
    db = world
    s = observations(db)
    assert s["total"] == 0 and s["open"] == 0 and sum(s["deadlines"].values()) == 0 and s["by_priority"] == {} and s["regulators"] == []
    assert len(s["months"]) == 12 and s["opened"] == [0] * 12


def test_a_status_the_organisation_has_since_retired_still_has_its_column(world):
    db = world
    obs(db, "legacy_status", "high")
    db.commit()
    s = observations(db)
    assert "legacy_status" in [l["key"] for l in s["levels"]] and s["by_priority"]["high"] == {"legacy_status": 1} and s["open"] == 1
