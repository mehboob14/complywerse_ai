"""The attention queue answers "what needs me today" from current data.

These pin each condition, the ranking, and what people rely on: a snooze comes
back on its date, a close holds only for the date that made the item urgent,
every action is recorded against the vendor, and the dashboard tile counts the
same list as the queue.
"""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    AttentionActivity, AttentionState, Base, Evidence, GRCUser, Tenant, TPRAApproval, TPRAAuditLog,
    TPRAContract, TPRAControlObligation, TPRAEvidenceLink, TPRAFinding, TPRAMonitoringSignal,
    TPRARemediation, TPRARiskAcceptance, TPRARiskSnapshot, TPRATieringConfig, Vendor, VendorAssessment,
    VendorQuestionnaireResponse, WorkflowNotification,
)
from grc.modules.vendor_risk.tpra import attention, dashboard

TODAY = date(2026, 9, 23)
_TABLES = [Tenant, GRCUser, Vendor, VendorAssessment, VendorQuestionnaireResponse, TPRAFinding,
           TPRARemediation, TPRARiskAcceptance, TPRAContract, TPRAControlObligation, TPRAApproval,
           Evidence, TPRAEvidenceLink, TPRARiskSnapshot, TPRATieringConfig, TPRAAuditLog,
           TPRAMonitoringSignal, AttentionState, AttentionActivity, WorkflowNotification]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add_all([GRCUser(id=7, username="owner", email="owner@x.test", display_name="Olu Owner", is_active=True),
               GRCUser(id=8, username="colleague", email="c@x.test", display_name="Cam Colleague", is_active=True)])
    s.commit()
    yield s
    s.close()


def _at(d: date, hour: int = 9) -> datetime:
    return datetime(d.year, d.month, d.day, hour, 0)


def ago(n: int, today: date = TODAY) -> date:
    return today - timedelta(days=n)


def ahead(n: int) -> date:
    return TODAY + timedelta(days=n)


def _vendor(db, name="Acme Cloud", **kw):
    v = Vendor(tenant_id=1, name=name, status=kw.pop("status", "active"), owner_id=kw.pop("owner_id", 7),
               tier=kw.pop("tier", "medium"), inherent_risk_score=kw.pop("inherent_risk_score", 40.0), **kw)
    db.add(v)
    db.commit()
    return v


def _add(db, *rows):
    db.add_all(rows)
    db.commit()
    return rows[0] if len(rows) == 1 else rows


def _queue(db, user_id=7, today=TODAY, **kw):
    return attention.queue(db, 1, user_id, today=today, **kw)


def _items(db, **kw):
    return _queue(db, **kw)["items"]


def _only(db, condition):
    found = [i for i in _items(db) if i["condition"] == condition]
    assert len(found) == 1, found
    return found[0]


# ── each condition ───────────────────────────────────────────────────────────

def test_a_quiet_programme_has_an_empty_queue(db):
    _vendor(db, next_reassessment_date=_at(ahead(90)))
    assert _items(db) == []


def test_a_critical_finding_past_its_sla(db):
    v = _vendor(db)
    _add(db,
         TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=1, severity="critical", title="No MFA",
                     status="open", created_at=_at(ago(10))),                    # SLA 7 days: 3 past
         TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=1, severity="critical", title="Fresh",
                     status="open", created_at=_at(ago(5))),                     # still inside its SLA
         TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=1, severity="critical", title="Fixed",
                     status="closed", created_at=_at(ago(60))),
         TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=1, severity="high", title="Backups untested",
                     status="in_remediation", is_critical_control_fail=True, created_at=_at(ago(40))))
    items = [i for i in _items(db) if i["condition"] == "critical_finding_past_sla"]
    assert sorted(i["title"].split("'")[1] for i in items) == ["Backups untested", "No MFA"]
    no_mfa = next(i for i in items if "No MFA" in i["title"])
    assert no_mfa["badge"] == "3 days past SLA" and no_mfa["since"] == ago(3).isoformat()
    assert no_mfa["link"].endswith(f"?stage=findings&finding={no_mfa['record_id']}")


def test_contracts_coming_up_and_obligations_breached(db):
    v = _vendor(db)
    soon, later, draft = _add(db,
        TPRAContract(tenant_id=1, vendor_id=v.id, title="MSA", status="active",
                     renewal_date=_at(ahead(10)), expiry_date=_at(ahead(300))),
        TPRAContract(tenant_id=1, vendor_id=v.id, title="DPA", status="active", expiry_date=_at(ahead(60))),
        TPRAContract(tenant_id=1, vendor_id=v.id, title="Draft", status="draft", expiry_date=_at(ahead(1))))
    _add(db, TPRAControlObligation(tenant_id=1, contract_id=later.id, obligation="Notify breaches in 24h",
                                   status="breached"),
         TPRAControlObligation(tenant_id=1, contract_id=later.id, obligation="Annual pen test", status="met"))
    contract = _only(db, "contract_expiring")
    assert contract["record_id"] == soon.id and contract["badge"] == "Due in 10 days"
    breach = _only(db, "obligation_breached")
    assert "Notify breaches in 24h" in breach["title"] and breach["tone"] == "red"


def test_an_expiring_certificate_is_listed_once_however_often_it_is_linked(db):
    v = _vendor(db)
    soc2, iso, old = _add(db,
        Evidence(tenant_id=1, name="SOC 2 Type II", expiry_date=_at(ago(2)), status="approved"),
        Evidence(tenant_id=1, name="ISO 27001", expiry_date=_at(ahead(90)), status="approved"),
        Evidence(tenant_id=1, name="Old pen test", expiry_date=_at(ago(1)), status="archived"))
    _add(db, TPRAEvidenceLink(tenant_id=1, vendor_id=v.id, assessment_id=1, evidence_id=soc2.id),
         TPRAEvidenceLink(tenant_id=1, vendor_id=v.id, finding_id=3, evidence_id=soc2.id),
         TPRAEvidenceLink(tenant_id=1, vendor_id=v.id, evidence_id=iso.id),
         TPRAEvidenceLink(tenant_id=1, vendor_id=v.id, evidence_id=old.id))
    cert = _only(db, "certificate_expiring")
    assert "SOC 2 Type II" in cert["title"] and cert["badge"] == "Expired 2 days ago"
    assert cert["priority"] == 55 + 15                    # lapsed outranks coming up


def test_acceptances_running_out_or_lapsed_with_nobody_deciding_again(db):
    v = _vendor(db)
    f = lambda title, status: TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=1, title=title,
                                          severity="high", status=status, created_at=_at(ago(5)))
    running_out, lapsed, reopened, renewed = _add(db, f("Running out", "accepted"), f("Lapsed", "accepted"),
                                                  f("Reopened", "open"), f("Renewed", "accepted"))
    _add(db,
         TPRARiskAcceptance(tenant_id=1, finding_id=running_out.id, status="active", expiry=_at(ahead(5))),
         TPRARiskAcceptance(tenant_id=1, finding_id=lapsed.id, status="expired", expiry=_at(ago(3))),
         TPRARiskAcceptance(tenant_id=1, finding_id=reopened.id, status="expired", expiry=_at(ago(3))),
         TPRARiskAcceptance(tenant_id=1, finding_id=renewed.id, status="expired", expiry=_at(ago(30))),
         TPRARiskAcceptance(tenant_id=1, finding_id=renewed.id, status="active", expiry=_at(ahead(200))))
    items = {i["title"].split("'")[1]: i for i in _items(db) if i["condition"] == "acceptance_expiring"}
    assert set(items) == {"Running out", "Lapsed"}
    assert items["Running out"]["badge"] == "Expires in 5 days" and items["Lapsed"]["tone"] == "red"


def test_overdue_assessments_and_reassessments(db):
    v = _vendor(db, next_reassessment_date=_at(ago(1)))
    late, _done, _old = _add(db,
        VendorAssessment(tenant_id=1, vendor_id=v.id, assessment_type="initial_onboarding",
                         status="in_progress", due_date=_at(ago(4))),
        VendorAssessment(tenant_id=1, vendor_id=v.id, status="approved", due_date=_at(ago(4))),
        VendorAssessment(tenant_id=1, vendor_id=v.id, status="draft", due_date=_at(ago(4)),
                         lifecycle_status="superseded"))
    assessment = _only(db, "assessment_overdue")
    assert assessment["record_id"] == late.id and assessment["badge"] == "4 days overdue"
    assert "initial onboarding" in assessment["title"]
    assert _only(db, "reassessment_overdue")["badge"] == "1 day overdue"


def test_approved_or_in_use_but_never_tiered(db):
    approved = _vendor(db, name="Approved", inherent_risk_score=None)
    tiered = _vendor(db, name="Tiered", inherent_risk_score=None)
    in_use = _vendor(db, name="In use", inherent_risk_score=None, lifecycle_stage="monitoring")
    _vendor(db, name="New", inherent_risk_score=None, lifecycle_stage="intake")
    _add(db, TPRAApproval(tenant_id=1, vendor_id=approved.id, assessment_id=1, decision="approve"),
         TPRAApproval(tenant_id=1, vendor_id=tiered.id, assessment_id=2, decision="approve"),
         VendorAssessment(tenant_id=1, vendor_id=tiered.id, status="approved", inherent_tier="high"))
    names = sorted(i["vendor_name"] for i in _items(db) if i["condition"] == "approved_never_tiered")
    assert names == ["Approved", "In use"] and in_use.id


def test_a_worsened_rating_is_found_through_the_daily_snapshots(db):
    worse = _vendor(db, name="Worse")
    better = _vendor(db, name="Better")
    stale = _vendor(db, name="Long ago")
    snap = lambda v, rating, d: TPRARiskSnapshot(tenant_id=1, scope="vendor", vendor_id=v.id,
                                                 residual_rating=rating, captured_at=_at(d))
    _add(db, snap(worse, "medium", ago(40)), snap(worse, "high", ago(10)),
         *[snap(worse, "high", ago(n)) for n in range(9, -1, -1)],       # the daily job repeats it
         snap(better, "high", ago(20)), snap(better, "medium", ago(5)),
         snap(stale, "medium", ago(60)), snap(stale, "critical", ago(45)))
    drop = _only(db, "rating_dropped")
    assert drop["vendor_name"] == "Worse" and drop["badge"] == "Medium → High"
    assert drop["since"] == ago(10).isoformat()


def test_a_questionnaire_the_vendor_never_opened(db):
    v = _vendor(db)
    q = lambda token, status, sent, expires=None: VendorQuestionnaireResponse(
        tenant_id=1, vendor_id=v.id, token=token, status=status, created_at=_at(sent),
        expires_at=_at(expires) if expires else None)
    _add(db, q("a", "pending", ago(8)), q("b", "pending", ago(3)), q("c", "in_progress", ago(30)),
         q("d", "pending", ago(20), expires=ago(5)))
    badges = sorted(i["badge"] for i in _items(db) if i["condition"] == "questionnaire_untouched")
    assert badges == ["Link expired", "Sent 8 days ago"]


# ── ranking ──────────────────────────────────────────────────────────────────

def test_priority_first_then_the_oldest_date(db):
    v = _vendor(db, name="Ordinary")
    crown = _vendor(db, name="Crown jewel", tier="critical", next_reassessment_date=_at(ago(2)))
    _add(db, TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=1, severity="critical", title="x",
                         status="open", created_at=_at(ago(30))),
         TPRAContract(tenant_id=1, vendor_id=v.id, title="MSA", status="active", expiry_date=_at(ago(1))),
         VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, token="t", status="pending",
                                     created_at=_at(ago(9))))
    order = [i["condition"] for i in _items(db)]
    assert order == ["critical_finding_past_sla", "reassessment_overdue", "contract_expiring",
                     "questionnaire_untouched"]
    assert _items(db)[1]["vendor_name"] == crown.name      # 65 + 6 for a critical-tier vendor


# ── what people do to an item ────────────────────────────────────────────────

def _overdue_reassessment(db, **kw):
    v = _vendor(db, next_reassessment_date=_at(ago(5)), **kw)
    return v, ("reassessment_overdue", "vendor", v.id)


def _act(db, key, action, actor=7, today=TODAY, **kw):
    condition, record_type, record_id = key
    item = attention.act(db, 1, actor, condition=condition, record_type=record_type, record_id=record_id,
                         action=action, today=today, **kw)
    db.commit()
    return item


def test_a_snooze_hides_an_item_until_its_date(db):
    _, key = _overdue_reassessment(db)
    with pytest.raises(ValueError):
        _act(db, key, "snooze", until=ahead(3))                  # a reason is required
    with pytest.raises(ValueError):
        _act(db, key, "snooze", until=TODAY, text="later")       # and a day after today
    _act(db, key, "snooze", until=ahead(3), text="Vendor is mid-audit")
    assert _items(db) == []
    snoozed = _items(db, view="snoozed")
    assert snoozed[0]["snoozed_until"] == ahead(3).isoformat()
    assert snoozed[0]["snooze_reason"] == "Vendor is mid-audit"
    assert _queue(db)["counts"] == {"open": 0, "urgent": 0, "snoozed": 1, "closed": 0}
    assert len(_items(db, today=ahead(3))) == 1                   # back on the day


def test_a_close_holds_only_for_the_date_that_made_it_urgent(db):
    v, key = _overdue_reassessment(db)
    with pytest.raises(ValueError):
        _act(db, key, "close")                                    # a closing note is required
    _act(db, key, "close", text="Reassessment booked for October with the vendor")
    assert _items(db) == [] and len(_items(db, view="closed")) == 1

    v.next_reassessment_date = _at(ago(1))                        # a new date: urgent again
    db.commit()
    assert [i["record_id"] for i in _items(db)] == [v.id]


def test_every_action_is_recorded_against_the_vendor(db):
    v, key = _overdue_reassessment(db)
    _act(db, key, "note", text="Chased the account manager")
    _act(db, key, "close", text="Booked for October")
    audit = db.query(TPRAAuditLog).filter(TPRAAuditLog.vendor_id == v.id).order_by(TPRAAuditLog.id).all()
    assert [(a.entity, a.action, a.reason) for a in audit] == [
        ("attention", "note", "Chased the account manager"), ("attention", "close", "Booked for October")]
    assert audit[1].extra["condition"] == "reassessment_overdue"
    assert db.query(AttentionActivity).count() == 2
    assert db.query(AttentionState).count() == 1                  # a note changes no state


def test_something_that_no_longer_needs_attention_cannot_be_acted_on(db):
    with pytest.raises(LookupError):
        _act(db, ("reassessment_overdue", "vendor", 999), "note", text="hello")


def test_mine_is_what_is_assigned_to_me_or_unassigned_on_my_vendors(db):
    _, key = _overdue_reassessment(db)
    assert len(_items(db, user_id=7, scope="mine")) == 1
    assert _items(db, user_id=8, scope="mine") == []

    _act(db, key, "assign", assignee_id=8)
    assert _items(db, user_id=7, scope="mine") == []
    mine = _items(db, user_id=8, scope="mine")
    assert mine[0]["assignee_name"] == "Cam Colleague" and mine[0]["owner_name"] == "Olu Owner"
    told = db.query(WorkflowNotification).filter(WorkflowNotification.user_id == 8).one()
    assert told.subject.startswith("Assigned to you: Reassessment of Acme Cloud")

    with pytest.raises(ValueError):
        _act(db, key, "assign", assignee_id=404)


def test_the_dashboard_tile_counts_the_same_list(db, monkeypatch):
    today = datetime.utcnow().date()          # the dashboard asks about today, not a fixed date
    monkeypatch.setattr(dashboard, "_tids", lambda user, db: [1])
    monkeypatch.setattr(dashboard, "_prep_tpra_db", lambda db, tids: None)
    _vendor(db, name="Late", next_reassessment_date=_at(ago(3, today)))
    snoozed = _vendor(db, name="Snoozed", next_reassessment_date=_at(ago(3, today)))
    unopened = _vendor(db, name="Unopened")
    _add(db, VendorQuestionnaireResponse(tenant_id=1, vendor_id=unopened.id, token="t", status="pending",
                                         created_at=_at(ago(10, today))))
    attention.act(db, 1, 7, condition="reassessment_overdue", record_type="vendor", record_id=snoozed.id,
                  action="snooze", until=today + timedelta(days=7), text="Waiting on the vendor", today=today)
    db.commit()

    owner = db.get(GRCUser, 7)
    kpis = dashboard.program_dashboard(scope="portfolio", db=db, user=owner)["kpis"]
    counts = attention.queue(db, 1, 7, today=today)["counts"]
    assert (kpis["attention_open"], kpis["attention_urgent"]) == (counts["open"], counts["urgent"]) == (2, 1)
