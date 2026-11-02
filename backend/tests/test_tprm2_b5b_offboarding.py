"""TPRM parity, piece B5b (2026-10-29): offboarding the whole relationship or one engagement (R9).

The exit checklist gains "Final payments settled" for new exits; a list already laid out is not rewritten.
One engagement can be offboarded on its own: it gets its own exit checks, nothing is deleted, and the supplier
stays active with its portal links. Finishing that exit ends the engagement, as ending it always did. The whole
relationship works as before (links revoked, requests cancelled, archived when done) and now also tells why and
when it started. In-memory SQLite.
"""
from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Role, Tenant, TPRAAuditLog, TPRAEngagement, TPRAPortalToken, UserRole, Vendor, VendorAssessment,
)
from grc.modules.vendor_risk.routers import lifecycle
from grc.modules.vendor_risk.tpra import contacts, engagements, service

OWNER, ADMIN, NOBODY = 7, 70, 90


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@acme.test", display_name=f"User {uid}", is_active=True)
               for uid in (OWNER, ADMIN, NOBODY)])
    s.add(UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


def _user(db, uid):
    return db.get(GRCUser, uid)


def _vendor(db, **kw):
    v = Vendor(**{"tenant_id": 1, "name": "Payroll Co", "tier": "high", "status": "active", "owner_id": OWNER,
                  "data_access_level": "internal", **kw})
    db.add(v)
    db.commit()
    return v


def _engagement(db, v, name="Payroll run"):
    made = engagements.create_engagement(v.id, engagements.EngagementIn(name=name), db=db, user=_user(db, ADMIN))
    return db.get(TPRAEngagement, made["id"])


def _live_links(db, v):
    return db.query(TPRAPortalToken).filter(TPRAPortalToken.vendor_id == v.id, TPRAPortalToken.revoked_at.is_(None)).count()


def _start(db, e, reason="Replaced by the Contoso agreement", who=ADMIN):
    return engagements.start_exit(e.id, engagements.ExitStart(reason=reason), db=db, user=_user(db, who))


def _tick(db, e, who=ADMIN, only=None):
    items = db.get(TPRAEngagement, e.id).offboarding["items"]
    body = engagements.ExitUpdate(items=[{"item": i["item"], "done": only is None or i["item"] in only} for i in items])
    return engagements.update_exit(e.id, body, db=db, user=_user(db, who))


# ── the checklist ────────────────────────────────────────────────────────────

def test_the_standard_exit_ends_with_final_payments_settled_but_a_list_already_laid_out_is_not_rewritten(db):
    assert lifecycle.OFFBOARDING_CHECKLIST[-1] == "Final payments settled" == lifecycle.FINAL_PAYMENTS
    assert lifecycle.CONTRACTS_CLOSED in lifecycle.OFFBOARDING_CHECKLIST and len(lifecycle.OFFBOARDING_CHECKLIST) == 7

    fresh = _vendor(db, name="Fresh Co")
    out = lifecycle.begin_offboarding(fresh.id, lifecycle.OffboardIn(reason="Contract ended"), db=db, current_user=_user(db, ADMIN))
    assert [i["item"] for i in out["items"]] == lifecycle.OFFBOARDING_CHECKLIST

    old = _vendor(db, name="Old Co", offboarding_checklist=[
        {"item": s, "done": s == lifecycle.OFFBOARDING_CHECKLIST[0], "at": None, "by": None}
        for s in lifecycle.OFFBOARDING_CHECKLIST[:5]])
    again = lifecycle.begin_offboarding(old.id, lifecycle.OffboardIn(), db=db, current_user=_user(db, ADMIN))
    assert [i["item"] for i in again["items"]] == lifecycle.OFFBOARDING_CHECKLIST[:6]       # topped up as before, not given the new step
    assert again["items"][0]["done"] is True


def test_a_step_that_was_done_keeps_who_and_when_when_the_list_is_saved_again(db):
    v = _vendor(db)
    admin = _user(db, ADMIN)
    lifecycle.begin_offboarding(v.id, lifecycle.OffboardIn(), db=db, current_user=admin)
    items = lifecycle.get_offboarding(v.id, db=db, current_user=admin)["items"]
    first = lifecycle.update_offboarding(v.id, lifecycle.OffboardingUpdate(items=[{**items[0], "done": True}, *items[1:]]),
                                         db=db, current_user=admin)["items"][0]
    assert first["done"] is True and first["by"] == ADMIN and first["at"]
    forged = [{**i, "done": True, "by": 12345, "at": "1999-01-01T00:00:00"} for i in items[:2]] + items[2:]
    saved = lifecycle.update_offboarding(v.id, lifecycle.OffboardingUpdate(items=forged), db=db, current_user=_user(db, ADMIN))["items"]
    assert (saved[0]["at"], saved[0]["by"]) == (first["at"], ADMIN)                         # the first tick stands
    assert saved[1]["by"] == ADMIN and saved[1]["at"].startswith(str(datetime.utcnow().year))    # a client cannot say who or when


# ── the whole relationship ───────────────────────────────────────────────────

def test_the_whole_exit_says_why_and_when_it_started_and_keeps_notes(db):
    v = _vendor(db)
    contacts.add(db, v, ADMIN, name="Sam Lee", email="sam@payroll.test")
    c = contacts.add(db, v, ADMIN, name="Pat Roe", email="pat@payroll.test")
    contacts.issue(db, c, "invite", ADMIN)
    db.commit()
    admin = _user(db, ADMIN)

    before = lifecycle.get_offboarding(v.id, db=db, current_user=admin)
    assert (before["started"], before["reason"], before["started_at"], before["notes"], before["engagements"]) == (False, None, None, None, [])

    lifecycle.begin_offboarding(v.id, lifecycle.OffboardIn(reason="  Moved   to Contoso "), db=db, current_user=admin)
    out = lifecycle.get_offboarding(v.id, db=db, current_user=admin)
    assert out["started"] is True and out["reason"] == "Moved to Contoso" and out["started_by"] == "User 70"
    assert out["links_revoked"] == 1 and out["started_at"] and _live_links(db, v) == 0

    noted = lifecycle.update_offboarding(v.id, lifecycle.OffboardingUpdate(notes="Certificate filed under legal/2026"), db=db, current_user=admin)
    assert noted["notes"] == "Certificate filed under legal/2026" and len(noted["items"]) == 7        # notes alone leave the list as it is
    lifecycle.update_offboarding(v.id, lifecycle.OffboardingUpdate(notes="Certificate filed; access removal confirmed by IT"), db=db, current_user=admin)
    assert lifecycle.get_offboarding(v.id, db=db, current_user=admin)["notes"].endswith("confirmed by IT")
    with pytest.raises(HTTPException) as early:
        lifecycle.update_offboarding(_vendor(db, name="Other Co").id, lifecycle.OffboardingUpdate(notes="Too soon"), db=db, current_user=admin)
    assert early.value.status_code == 400


# ── one engagement ───────────────────────────────────────────────────────────

def test_one_engagement_can_be_offboarded_on_its_own_and_the_supplier_stays_active(db):
    v = _vendor(db)
    payroll, pensions = _engagement(db, v), _engagement(db, v, "Pensions")
    c = contacts.add(db, v, ADMIN, name="Sam Lee", email="sam@payroll.test")
    contacts.issue(db, c, "invite", ADMIN)
    db.commit()

    out = _start(db, payroll)
    assert out["id"] == payroll.id and out["status"] == "active"                     # still in use until the exit is done
    exit_ = out["offboarding"]
    assert (exit_["reason"], exit_["done"], exit_["total"]) == ("Replaced by the Contoso agreement", 0, 7)
    assert [i["item"] for i in db.get(TPRAEngagement, payroll.id).offboarding["items"]] == lifecycle.OFFBOARDING_CHECKLIST
    assert v.status == "active" and v.deleted_at is None and _live_links(db, v) == 1    # the supplier's door stays open
    assert db.get(TPRAEngagement, pensions.id).offboarding is None
    assert ("engagement", "offboard") in {(r.entity, r.action) for r in db.query(TPRAAuditLog).filter_by(vendor_id=v.id)}

    seen = lifecycle.get_offboarding(v.id, db=db, current_user=_user(db, ADMIN))
    assert seen["started"] is False and [(e["id"], e["name"], e["ended"], e["reason"]) for e in seen["engagements"]] == [
        (payroll.id, "Payroll run", False, "Replaced by the Contoso agreement")]
    listed = engagements.list_engagements(v.id, db=db, user=_user(db, ADMIN))["items"]
    assert {i["name"]: (i["offboarding"] or {}).get("total") for i in listed if not i["is_general"]} == {"Payroll run": 7, "Pensions": None}


def test_an_exit_needs_a_reason_and_cannot_start_twice_or_on_general_or_after_the_whole_exit(db):
    v = _vendor(db)
    payroll = _engagement(db, v)
    general = db.query(TPRAEngagement).filter_by(vendor_id=v.id, is_general=True).one()
    for reason in ("", "  ", "ab"):
        with pytest.raises(HTTPException) as no_reason:
            _start(db, payroll, reason=reason)
        assert no_reason.value.status_code == 400
    with pytest.raises(HTTPException) as on_general:
        _start(db, general)
    assert on_general.value.status_code == 400 and "offboard the supplier" in on_general.value.detail
    with pytest.raises(HTTPException) as denied:
        _start(db, payroll, who=NOBODY)
    assert denied.value.status_code == 403

    _start(db, payroll)
    with pytest.raises(HTTPException) as twice:
        _start(db, payroll)
    assert twice.value.status_code == 409 and "already under way" in twice.value.detail

    other = _engagement(db, v, "Pensions")
    lifecycle.begin_offboarding(v.id, lifecycle.OffboardIn(reason="Contract ended"), db=db, current_user=_user(db, ADMIN))
    with pytest.raises(HTTPException) as whole:
        _start(db, other)
    assert whole.value.status_code == 409 and "whole relationship" in whole.value.detail
    assert db.get(TPRAEngagement, payroll.id).offboarding is not None            # the one under way is left as it was


def test_an_engagement_exit_finishes_only_when_every_step_is_done_and_then_ends_the_engagement(db):
    v = _vendor(db)
    payroll, pensions = _engagement(db, v), _engagement(db, v, "Pensions")
    assessment = service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=payroll)
    db.commit()
    _start(db, payroll)

    with pytest.raises(HTTPException) as early:
        engagements.complete_exit(payroll.id, db=db, user=_user(db, ADMIN))
    assert early.value.status_code == 409 and len(early.value.detail["open"]) == 7

    half = _tick(db, payroll, only={lifecycle.OFFBOARDING_CHECKLIST[0], lifecycle.FINAL_PAYMENTS})
    assert (half["offboarding"]["done"], half["offboarding"]["total"]) == (2, 7)
    with pytest.raises(HTTPException) as still:
        engagements.complete_exit(payroll.id, db=db, user=_user(db, ADMIN))
    assert still.value.status_code == 409 and len(still.value.detail["open"]) == 5
    _tick(db, payroll)
    with pytest.raises(HTTPException) as denied:
        engagements.complete_exit(payroll.id, db=db, user=_user(db, NOBODY))
    assert denied.value.status_code == 403

    done = engagements.complete_exit(payroll.id, db=db, user=_user(db, ADMIN))
    db.expire_all()
    assert done["status"] == "ended" and done["ended_reason"] == "Replaced by the Contoso agreement"
    assert done["offboarding"]["completed_at"] and done["offboarding"]["done"] == 7
    assert db.get(VendorAssessment, assessment.id).lifecycle_status == "archived"           # nothing deleted, the assessment is kept
    assert db.get(Vendor, v.id).status == "active" and db.get(Vendor, v.id).deleted_at is None
    assert db.get(TPRAEngagement, pensions.id).status == "active"
    ended = db.query(TPRAAuditLog).filter_by(vendor_id=v.id, entity="engagement", action="end").one()
    assert ended.reason == "Replaced by the Contoso agreement"
    with pytest.raises(HTTPException) as again:
        engagements.complete_exit(payroll.id, db=db, user=_user(db, ADMIN))
    assert again.value.status_code == 400
    shown = lifecycle.get_offboarding(v.id, db=db, current_user=_user(db, ADMIN))["engagements"]
    assert [(e["name"], e["ended"], e["done"]) for e in shown] == [("Payroll run", True, 7)]   # kept as history


def test_the_exit_of_an_engagement_keeps_notes_and_its_own_list_apart_from_the_suppliers(db):
    v = _vendor(db, offboarding_checklist=[{"item": "Our own step", "done": False, "at": None, "by": None}])
    payroll = _engagement(db, v)
    _start(db, payroll)
    noted = engagements.update_exit(payroll.id, engagements.ExitUpdate(notes="  Destruction certificate is on the shared drive "),
                                    db=db, user=_user(db, ADMIN))
    assert noted["offboarding"]["notes"] == "Destruction certificate is on the shared drive" and noted["offboarding"]["total"] == 7
    extra = engagements.update_exit(payroll.id, engagements.ExitUpdate(items=[
        {"item": i["item"], "done": False} for i in db.get(TPRAEngagement, payroll.id).offboarding["items"]] + [{"item": "Collect the badges", "done": True}]),
        db=db, user=_user(db, ADMIN))
    assert extra["offboarding"]["total"] == 8 and extra["offboarding"]["done"] == 1
    assert db.get(Vendor, v.id).offboarding_checklist == [{"item": "Our own step", "done": False, "at": None, "by": None}]
    with pytest.raises(HTTPException) as denied:
        engagements.update_exit(payroll.id, engagements.ExitUpdate(notes="x"), db=db, user=_user(db, NOBODY))
    assert denied.value.status_code == 403
    pensions = _engagement(db, v, "Pensions")
    with pytest.raises(HTTPException) as none_open:
        engagements.update_exit(pensions.id, engagements.ExitUpdate(notes="x"), db=db, user=_user(db, ADMIN))
    assert none_open.value.status_code == 400


def test_the_supplier_stops_counting_an_ended_engagement_on_a_session_that_does_not_autoflush(db):
    """Tenant sessions do not autoflush (PITFALLS 74): the supplier's worst tier must leave out the engagement that just ended."""
    v = _vendor(db, tier="low")
    payroll = _engagement(db, v)
    payroll.tier = "critical"
    db.query(TPRAEngagement).filter_by(vendor_id=v.id, is_general=True).one().tier = "low"
    service.recache(db, v)
    db.commit()
    assert v.tier == "critical"
    lazy = sessionmaker(bind=db.get_bind(), autoflush=False)()
    try:
        engagements.end_engagement(payroll.id, engagements.EndIn(reason="Moved in house"), db=lazy, user=lazy.get(GRCUser, ADMIN))
        assert lazy.get(Vendor, v.id).tier == "low"
    finally:
        lazy.close()


def test_the_existing_end_engagement_still_works_with_no_exit(db):
    v = _vendor(db)
    payroll = _engagement(db, v)
    out = engagements.end_engagement(payroll.id, engagements.EndIn(reason="Moved in house"), db=db, user=_user(db, ADMIN))
    assert out["status"] == "ended" and out["ended_reason"] == "Moved in house" and out["offboarding"] is None
