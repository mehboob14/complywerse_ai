"""Engagements: each use of a supplier has its own lifecycle, and the supplier shows its worst.

A supplier nobody has split is exactly what it always was (the rest of the TPRA
suite pins that). These pin what engagements add: General is the supplier itself
and resolves only to its own assessments; an engagement is tiered, scored and
approved on its own facts without moving General, the supplier's pointer or another
engagement; the supplier shows its worst open engagement, which a better
reassessment can improve; ending one deletes nothing.
"""
from datetime import datetime, time, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Risk, Role, Tenant, TPRAAuditLog, TPRAEngagement, TPRAFinding, TPRAQuestion,
    TPRAQuestionResponse, TPRARiskSnapshot, UserRole, Vendor, VendorAssessment,
)
from grc.modules.vendor_risk.tpra import api, attention, engagements, monitoring, reminders, service, tier_policy
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG
from grc.modules.vendor_risk.tpra.engine_tiering import FACTOR_KEYS, compute_inherent_tier, derive_factors_from_profile
from grc.modules.vendor_risk.tpra.stages import TIER_RANK

OWNER, ADMIN, HR, FIN, NOBODY = 7, 70, 80, 81, 90
TODAY = datetime.utcnow().date()
POLICY = dict(DEFAULT_TIERING_CONFIG["reminder_policy"])
MEDIUM, HIGH, CRITICAL = ({k: n for k in FACTOR_KEYS} for n in (1, 2, 4))     # 25, 50 and 100 on the defaults


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@acme.test", is_active=True)
               for uid in (OWNER, ADMIN, HR, FIN, NOBODY)])
    s.add(UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


def _user(db, uid):
    return db.get(GRCUser, uid)


def _vendor(db, **kw):
    v = Vendor(**{"tenant_id": 1, "name": "Acme Cloud", "tier": "medium", "status": "active",
                  "data_access_level": "internal", "data_types_accessed": [], "owner_id": OWNER, **kw})
    db.add(v)
    db.commit()
    return v


def _engage(db, v, name, **kw):
    body = engagements.EngagementIn(**{"name": name, "owner_id": HR, "data_access_level": "confidential", **kw})
    return db.get(TPRAEngagement, engagements.create_engagement(v.id, body, db=db, user=_user(db, ADMIN))["id"])


def _answer(db, a, key, answer, critical=False):
    q = TPRAQuestion(tenant_id=1, template_id=1, question_key=key, text=key, domain="cybersecurity",
                     qtype="yes_no", weight=1.0, critical_control=critical)
    db.add(q)
    db.flush()
    db.add(TPRAQuestionResponse(tenant_id=1, assessment_id=a.id, question_id=q.id, question_key=key, answer=answer))
    db.flush()


def _scored(db, v, a, factors, answer, critical=False):
    service.run_tiering(db, v, a, actor_id=ADMIN, factors=factors)
    _answer(db, a, f"q{a.id}", answer, critical)
    service.run_scoring(db, v, a, actor_id=ADMIN)
    db.commit()
    return a


def _state(a):
    return (a.engagement_id, a.lifecycle_status, a.current_stage, a.inherent_tier, a.inherent_score,
            a.residual_score, a.residual_rating, a.rating_grade, a.row_version)


# ── General is the supplier itself ───────────────────────────────────────────

def test_a_supplier_never_split_is_one_general_engagement_and_reading_it_writes_nothing(db):
    v = _vendor(db, tier="high", inherent_risk_score=60.0, next_reassessment_date=datetime(2027, 1, 1))
    a = service.ensure_active_assessment(db, v, actor_id=OWNER)
    db.commit()

    out = engagements.list_engagements(v.id, db=db, user=_user(db, NOBODY))
    assert [(i["id"], i["name"], i["is_general"], i["tier"], i["active_assessment_id"], i["next_reassessment_date"])
            for i in out["items"]] == [(None, "General", True, "high", a.id, "2027-01-01T00:00:00")]
    assert out["supplier"]["engagements"] == 1 and out["supplier"]["tier"] == "high"
    assert db.query(TPRAEngagement).count() == 0
    assert api.get_lifecycle(v.id, db=db, user=_user(db, NOBODY))["assessment"]["id"] == a.id


def test_the_first_engagement_makes_general_from_the_supplier_as_it_stood_and_rewrites_nothing(db):
    v = _vendor(db, tier="high", inherent_risk_score=60.0, residual_risk_score=40.0, risk_rating="medium")
    a = service.ensure_active_assessment(db, v, actor_id=OWNER)
    db.commit()

    payroll = _engage(db, v, "Payroll")
    general = service.general_row(db, v)
    assert (general.name, general.tier, general.inherent_risk_score, general.residual_risk_score,
            general.risk_rating, general.active_assessment_id) == ("General", "high", 60.0, 40.0, "medium", a.id)
    assert (payroll.tier, payroll.status, payroll.owner_id, payroll.data_access_level) == (None, "active", HR, "confidential")
    db.refresh(a)
    db.refresh(v)
    assert a.engagement_id is None and v.active_assessment_id == a.id
    assert (v.tier, v.inherent_risk_score, v.residual_risk_score, v.risk_rating) == ("high", 60.0, 40.0, "medium")

    _engage(db, v, "Data warehouse", owner_id=FIN)
    assert db.query(TPRAEngagement).filter(TPRAEngagement.is_general.is_(True)).count() == 1
    listed = engagements.list_engagements(v.id, db=db, user=_user(db, ADMIN))
    assert [i["name"] for i in listed["items"]] == ["General", "Data warehouse", "Payroll"]
    assert listed["supplier"]["engagements"] == 3
    assert [e.action for e in db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "engagement")] == ["create"] * 3

    with pytest.raises(HTTPException) as same:
        _engage(db, v, "payroll")
    with pytest.raises(HTTPException) as general_name:
        _engage(db, v, "general")
    with pytest.raises(HTTPException) as denied:
        engagements.create_engagement(v.id, engagements.EngagementIn(name="HR"), db=db, user=_user(db, NOBODY))
    assert (same.value.status_code, general_name.value.status_code, denied.value.status_code) == (409, 400, 403)


def test_general_never_resolves_to_an_engagements_assessment(db):
    v = _vendor(db)
    payroll = _engage(db, v, "Payroll")
    p = service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=payroll)
    db.commit()
    assert service.get_active_assessment(db, v) is None              # General has not started
    v.active_assessment_id = p.id                                     # a pointer gone wrong
    assert service.get_active_assessment(db, v) is None
    g = service.ensure_active_assessment(db, v, actor_id=ADMIN)
    assert g.id != p.id and g.engagement_id is None and v.active_assessment_id == g.id
    assert service.get_active_assessment(db, v, payroll).id == p.id and payroll.active_assessment_id == p.id
    # General's own row names General.
    assert service.get_active_assessment(db, v, service.general_row(db, v)).id == g.id


# ── each engagement on its own ───────────────────────────────────────────────

def test_tiering_scoring_and_approving_an_engagement_never_moves_general_the_pointer_or_another(db):
    v = _vendor(db)
    g = service.ensure_active_assessment(db, v, actor_id=OWNER)
    service.run_tiering(db, v, g, actor_id=OWNER, factors=MEDIUM)
    db.commit()
    payroll, warehouse = _engage(db, v, "Payroll"), _engage(db, v, "Data warehouse", owner_id=FIN)
    w = db.get(VendorAssessment, api.init_lifecycle(v.id, engagement_id=warehouse.id, db=db,
                                                    user=_user(db, ADMIN))["assessment"]["id"])
    general_before, warehouse_before = _state(g), _state(w)
    stage_before = v.lifecycle_stage

    p = service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=payroll)
    assert service.advance_stage(db, v, p, actor_id=ADMIN)["advanced"] is True     # payroll's owner and data access
    _scored(db, v, p, CRITICAL, "Yes")
    decided = api.create_approval(p.id, api.ApprovalIn(decision="approve"), db=db, user=_user(db, ADMIN))
    assert decided["assessment_id"] == p.id

    for row in (g, w, v, payroll, warehouse):
        db.refresh(row)
    assert _state(g) == general_before and _state(w) == warehouse_before
    assert (v.active_assessment_id, v.lifecycle_stage) == (g.id, stage_before)
    assert (warehouse.tier, warehouse.residual_risk_score, warehouse.active_assessment_id) == (None, None, w.id)
    assert (p.engagement_id, payroll.active_assessment_id, payroll.lifecycle_stage) == (payroll.id, p.id, "tiering")
    assert (payroll.tier, payroll.inherent_risk_score, payroll.residual_risk_score, payroll.rating_grade) == (
        "critical", p.inherent_score, p.residual_score, p.rating_grade)
    assert service.general_row(db, v).tier == "medium"                 # General's own tier stays General's
    assert v.tier == "critical"                                         # the supplier shows the worst
    assert [x.id for x in (service.get_active_assessment(db, v), service.get_active_assessment(db, v, payroll),
                           service.get_active_assessment(db, v, warehouse))] == [g.id, p.id, w.id]

    # A reassessment supersedes only its own scope's assessment.
    p2 = service.create_reassessment_version(db, v, actor_id=ADMIN, reason="Yearly", engagement=payroll)
    db.commit()
    db.refresh(g)
    assert (p.lifecycle_status, p2.engagement_id, p2.version_no, p2.supersedes_id) == ("superseded", payroll.id, 2, p.id)
    assert g.lifecycle_status == "active" and v.active_assessment_id == g.id
    g2 = service.create_reassessment_version(db, v, actor_id=ADMIN, reason="Yearly")
    db.commit()
    db.refresh(p2)
    assert (g.lifecycle_status, g2.engagement_id, g2.supersedes_id) == ("superseded", None, g.id)
    assert p2.lifecycle_status == "active" and v.active_assessment_id == g2.id and payroll.active_assessment_id == p2.id


def test_the_supplier_shows_its_worst_open_engagement_and_a_better_reassessment_improves_it(db):
    v = _vendor(db)
    g = _scored(db, v, service.ensure_active_assessment(db, v, actor_id=OWNER), MEDIUM, "Yes")
    payroll = _engage(db, v, "Payroll")
    p = _scored(db, v, service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=payroll), HIGH,
                "No", critical=True)
    db.refresh(v)
    worst = max(g.residual_score, p.residual_score)
    assert (v.tier, v.residual_risk_score, v.inherent_risk_score) == ("high", worst, max(g.inherent_score, p.inherent_score))
    assert v.risk_rating == max(g.residual_rating, p.residual_rating, key=TIER_RANK.get) == "high"

    # Reassessed and answered well: the supplier reads better too (the worst of now, not the worst ever).
    p2 = service.create_reassessment_version(db, v, actor_id=ADMIN, reason="Fixed", engagement=payroll)
    _answer(db, p2, "fixed", "Yes", critical=True)
    service.run_scoring(db, v, p2, actor_id=ADMIN)
    db.commit()
    db.refresh(v)
    assert v.residual_risk_score == max(g.residual_score, p2.residual_score) < worst
    assert TIER_RANK[v.risk_rating] < TIER_RANK["high"]
    # The snapshot is the supplier as a whole, naming what moved it.
    snap = db.query(TPRARiskSnapshot).order_by(TPRARiskSnapshot.id.desc()).first()
    assert (snap.residual_score, snap.residual_rating, snap.assessment_id, snap.engagement_id) == (
        v.residual_risk_score, v.risk_rating, p2.id, payroll.id)


def test_an_engagement_is_held_to_its_own_facts_at_intake_and_tiering(db):
    v = _vendor(db, tier="critical", data_access_level="restricted", data_types_accessed=["PII"])
    payroll = _engage(db, v, "Payroll", owner_id=None, data_access_level=None)
    p = service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=payroll)
    db.commit()
    blocked = service.evaluate_current(db, v, p, "intake")
    assert blocked["passed"] is False and len(blocked["blockers"]) == 2   # its own owner and data classification

    engagements.update_engagement(payroll.id, engagements.EngagementIn(owner_id=HR, data_access_level="internal",
                                                                         criticality="low"),
                                  db=db, user=_user(db, ADMIN))
    assert service.evaluate_current(db, v, p, "intake")["passed"] is True
    result = service.run_tiering(db, v, p, actor_id=ADMIN)
    expected = compute_inherent_tier(derive_factors_from_profile(
        {"data_access_level": "internal", "data_types_accessed": [], "geographic_locations": [],
         "business_criticality": "low"}), DEFAULT_TIERING_CONFIG)
    assert (result["tier"], result["score"]) == (expected["tier"], expected["score"])   # not the supplier's PII or tier
    assert p.tiering_basis["data_access_level"] == "internal"
    db.commit()

    # Its own intake answers set the factors when it has them.
    engagements.update_engagement(payroll.id, engagements.EngagementIn(
        intake={"answers": {"critical_function": "yes"}, "justifications": {"critical_function": "Pays all staff"}}),
        db=db, user=_user(db, ADMIN))
    result = service.run_tiering(db, v, p, actor_id=ADMIN)
    assert result["reasons"]["business_criticality"] == ["a critical service depends on them"]
    db.commit()
    # And a change to its facts is a reason to re-tier it, not the supplier.
    engagements.update_engagement(payroll.id, engagements.EngagementIn(data_access_level="restricted"),
                                  db=db, user=_user(db, ADMIN))
    assert tier_policy.retier_reasons(db, v, p) == ["data access went from internal to restricted"]
    assert tier_policy.requirements(db, v, p, service.get_tiering_config(db, 1))["tier"] == p.inherent_tier


def test_the_contracting_gate_counts_the_supplier_wide_contract_and_the_engagements_own(db):
    v = _vendor(db)
    payroll, warehouse = _engage(db, v, "Payroll"), _engage(db, v, "Data warehouse")
    g = service.ensure_active_assessment(db, v, actor_id=ADMIN)
    p, w = (service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=e) for e in (payroll, warehouse))
    admin = _user(db, ADMIN)

    def linked():
        return [service.build_stage_context(db, v, a, "contracting")["contract_linked"] for a in (g, p, w)]

    made = api.create_contract(v.id, api.ContractIn(title="Payroll DPA", engagement_id=payroll.id), db=db, user=admin)
    assert made["engagement_id"] == payroll.id and linked() == [False, True, False]
    api.create_contract(v.id, api.ContractIn(title="Master agreement"), db=db, user=admin)
    assert linked() == [True, True, True]
    moved = api.update_contract(made["id"], api.ContractUpdate(engagement_id=warehouse.id), db=db, user=admin)
    assert moved["engagement_id"] == warehouse.id

    other = _vendor(db, name="Other Co")
    elsewhere = _engage(db, other, "Elsewhere")
    with pytest.raises(HTTPException) as wrong:
        api.create_contract(v.id, api.ContractIn(title="x", engagement_id=elsewhere.id), db=db, user=admin)
    assert wrong.value.status_code == 404


def test_a_supplier_stays_suspended_while_any_engagement_has_an_open_critical(db):
    v = _vendor(db)
    payroll = _engage(db, v, "Payroll")
    g = service.ensure_active_assessment(db, v, actor_id=ADMIN)
    p = service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=payroll)
    g.current_stage = p.current_stage = "monitoring"            # both past their approval
    general_crit, payroll_crit = (TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, severity="critical",
                                              status="open", title="No MFA") for a in (g, p))
    db.add_all([general_crit, payroll_crit])
    db.commit()

    service.enforce_critical_invariant(db, v, p, ADMIN)
    assert v.status == "suspended"
    payroll_crit.status = "closed"                               # payroll's is fixed; General's stands
    service.enforce_critical_invariant(db, v, p, ADMIN)
    assert v.status == "suspended"
    general_crit.status = "closed"
    service.enforce_critical_invariant(db, v, g, ADMIN)
    assert v.status == "active"


def test_each_scope_has_its_own_register_entry_and_nothing_is_counted_twice(db):
    v = _vendor(db)
    g = _scored(db, v, service.ensure_active_assessment(db, v, actor_id=ADMIN), MEDIUM, "Yes")
    payroll = _engage(db, v, "Payroll")
    lookalike = Risk(tenant_id=1, title="Someone else's", category="third_party", residual_score=1.0,
                     source_reference=f"vendor:{v.id}/engagement:{payroll.id}0")
    db.add(lookalike)
    db.commit()
    p = _scored(db, v, service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=payroll), HIGH, "No", True)
    _answer(db, p, "again", "Yes")
    service.run_scoring(db, v, p, actor_id=ADMIN)                # re-scored: the same entry
    db.commit()

    ours = db.query(Risk).filter(Risk.id != lookalike.id).order_by(Risk.id).all()
    assert [(r.source_reference, r.title) for r in ours] == [
        (f"vendor:{v.id}/vendor_assessment:{g.id}", "Third-party risk: Acme Cloud"),
        (f"vendor:{v.id}/engagement:{payroll.id}", "Third-party risk: Acme Cloud — Payroll")]
    assert (ours[0].residual_score, ours[0].risk_sub_category) == (min(g.residual_score, g.inherent_score), "medium")
    assert (ours[1].residual_score, ours[1].risk_sub_category, ours[1].owner_id) == (
        min(p.residual_score, p.inherent_score), "high", HR)
    db.refresh(lookalike)
    assert (lookalike.title, lookalike.residual_score) == ("Someone else's", 1.0)


# ── ending one, and the dates ────────────────────────────────────────────────

def test_ending_an_engagement_deletes_nothing_and_the_supplier_shows_the_rest(db):
    v = _vendor(db)
    g = _scored(db, v, service.ensure_active_assessment(db, v, actor_id=ADMIN), MEDIUM, "Yes")
    payroll = _engage(db, v, "Payroll")
    p = _scored(db, v, service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=payroll), HIGH, "No", True)
    findings = db.query(TPRAFinding).filter(TPRAFinding.assessment_id == p.id).count()
    assert findings == 1 and v.tier == "high"

    admin = _user(db, ADMIN)
    out = engagements.end_engagement(payroll.id, engagements.EndIn(reason="Payroll moved in-house"), db=db, user=admin)
    for row in (payroll, p, v):
        db.refresh(row)
    assert (out["status"], payroll.ended_reason, payroll.end_date) == ("ended", "Payroll moved in-house", TODAY)
    assert payroll.archived_at is not None and (p.lifecycle_status, p.deleted_at) == ("archived", None)
    assert db.query(TPRAFinding).filter(TPRAFinding.assessment_id == p.id).count() == findings
    assert (v.tier, v.residual_risk_score, v.risk_rating) == ("medium", g.residual_score, g.residual_rating)
    ended = db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "engagement", TPRAAuditLog.action == "end").one()
    assert ended.reason == "Payroll moved in-house" and ended.extra["archived_assessments"] == [p.id]
    listed = engagements.list_engagements(v.id, db=db, user=admin)
    assert [(i["name"], i["status"]) for i in listed["items"]] == [("General", "active"), ("Payroll", "ended")]
    assert listed["supplier"]["engagements"] == 1

    general = service.general_row(db, v)
    refusals = [
        lambda: engagements.end_engagement(general.id, engagements.EndIn(reason="No longer"), db=db, user=admin),
        lambda: engagements.update_engagement(general.id, engagements.EngagementIn(name="All of it"), db=db, user=admin),
        lambda: engagements.end_engagement(payroll.id, engagements.EndIn(reason="Again"), db=db, user=admin),
        lambda: engagements.update_engagement(payroll.id, engagements.EngagementIn(name="Payroll 2"), db=db, user=admin),
        lambda: api.init_lifecycle(v.id, engagement_id=payroll.id, db=db, user=admin),
        lambda: api.reassess(v.id, api.ReassessIn(reason="x", engagement_id=payroll.id), db=db, user=admin),
    ]
    for refuse in refusals:
        with pytest.raises(HTTPException) as no:
            refuse()
        assert no.value.status_code == 400


def test_an_engagements_review_date_is_due_in_attention_and_reminders(db):
    v = _vendor(db)
    payroll = _engage(db, v, "Payroll", next_reassessment_date=datetime.combine(TODAY - timedelta(days=3), time()))
    _engage(db, v, "Data warehouse", next_reassessment_date=datetime.combine(TODAY + timedelta(days=60), time()))
    link = f"/vendor-risk/vendors/{v.id}?stage=reassessment&engagement={payroll.id}"

    due = [i for i in attention.open_items(db, 1, TODAY, POLICY) if i["condition"] == "reassessment_overdue"]
    assert [(i["record_type"], i["record_id"], i["link"], i["people"]) for i in due] == [
        ("engagement", payroll.id, link, [HR])]
    assert due[0]["title"] == f"Reassessment of Acme Cloud — Payroll was due on {TODAY - timedelta(days=3):%d %b %Y}"
    notices = [n for n in reminders.due_notices(db, 1, TODAY, POLICY) if n.kind == "reassessment_due"]
    assert [(n.subject_type, n.subject_id, n.link, n.recipients) for n in notices] == [
        ("engagement", payroll.id, link, [HR])]

    engagements.end_engagement(payroll.id, engagements.EndIn(reason="Done"), db=db, user=_user(db, ADMIN))
    assert not [i for i in attention.open_items(db, 1, TODAY, POLICY) if i["condition"] == "reassessment_overdue"]
    assert not [n for n in reminders.due_notices(db, 1, TODAY, POLICY) if n.kind == "reassessment_due"]


def test_an_engagements_reassessment_schedules_its_own_next_review(db):
    v = _vendor(db, next_reassessment_date=datetime(2030, 1, 1))
    payroll = _engage(db, v, "Payroll")
    p = service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=payroll)
    service.run_tiering(db, v, p, actor_id=ADMIN, factors=CRITICAL)
    service.create_reassessment_version(db, v, actor_id=ADMIN, reason="Yearly", engagement=payroll)
    db.commit()
    assert payroll.reassessment_cadence_days == 180 and payroll.next_reassessment_date.date() == TODAY + timedelta(days=180)
    assert v.next_reassessment_date == datetime(2030, 1, 1)


# ── the API and a signal ─────────────────────────────────────────────────────

def test_the_lifecycle_api_takes_an_engagement_and_leaving_it_out_means_general(db):
    v = _vendor(db)
    payroll = _engage(db, v, "Payroll")
    elsewhere = _engage(db, _vendor(db, name="Other Co"), "Elsewhere")
    admin = _user(db, ADMIN)

    started = api.init_lifecycle(v.id, engagement_id=payroll.id, db=db, user=admin)["assessment"]
    assert started["engagement_id"] == payroll.id
    assert api.get_lifecycle(v.id, db=db, user=admin)["assessment"] is None          # General has not started
    life = api.get_lifecycle(v.id, engagement_id=payroll.id, db=db, user=admin)
    assert (life["engagement_id"], life["assessment"]["id"], len(life["stages"]), life["current"]) == (
        payroll.id, started["id"], 11, "intake")

    general = service.general_row(db, v)
    g = api.init_lifecycle(v.id, body=api.ScopeIn(engagement_id=general.id), db=db, user=admin)["assessment"]
    assert g["engagement_id"] is None and api.get_lifecycle(v.id, db=db, user=admin)["assessment"]["id"] == g["id"]
    new = api.reassess(v.id, api.ReassessIn(reason="Scope grew", engagement_id=payroll.id), db=db, user=admin)
    assert (new["engagement_id"], new["version_no"]) == (payroll.id, 2)
    assert api.get_lifecycle(v.id, db=db, user=admin)["assessment"]["id"] == g["id"]
    versions = api.list_assessment_versions(v.id, engagement_id=payroll.id, db=db, user=admin)["items"]
    assert [(a["engagement_id"], a["version_no"]) for a in versions] == [(payroll.id, 2), (payroll.id, 1)]
    assert len(api.list_assessment_versions(v.id, db=db, user=admin)["items"]) == 3
    board = api.lifecycle_board(db=db, user=admin)["items"]
    assert [(r["vendor_id"], r["assessment_id"]) for r in board if r["vendor_id"] == v.id] == [(v.id, g["id"])]

    with pytest.raises(HTTPException) as foreign:
        api.get_lifecycle(v.id, engagement_id=elsewhere.id, db=db, user=admin)
    assert foreign.value.status_code == 404


def test_a_signal_reopens_each_scope_against_its_own_tier(db):
    v = _vendor(db)
    g = service.ensure_active_assessment(db, v, actor_id=ADMIN)
    service.run_tiering(db, v, g, actor_id=ADMIN, factors={k: 0 for k in FACTOR_KEYS})   # low: reopened by critical
    payroll = _engage(db, v, "Payroll")
    p = service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=payroll)
    service.run_tiering(db, v, p, actor_id=ADMIN, factors=CRITICAL)                      # critical: by medium
    _engage(db, v, "Not started yet")
    db.commit()

    sig, opened, _ = monitoring.record_signal(db, v, signal_type="adverse_media", severity="medium", actor_id=ADMIN)
    db.commit()
    db.refresh(g)
    new = db.get(VendorAssessment, opened)
    assert (new.engagement_id, new.supersedes_id, sig.triggered_assessment_id) == (payroll.id, p.id, opened)
    assert g.lifecycle_status == "active" and v.active_assessment_id == g.id
    assert db.query(VendorAssessment).filter(VendorAssessment.vendor_id == v.id).count() == 3
