"""TPRM parity, piece P0 (2026-10-29): the workspace roster, "who is next" and Notify.

The roster names people for the eight review roles (not the business owner, who is the supplier's owner); it decides
whom the workflow asks and tells and grants nothing. Adding or removing a person is idempotent, needs the config
right, is audited, and takes only active people who sign in here. A supplier's own team seat wins over the roster, which
fills the seats it left empty (effective_team: the reviewers counted at planning, the people kept from approving).
GET next-stage names the stage after the one a supplier or engagement is on and the people behind its roles; POST
notify-stage tells them, in the app and by email. In-memory SQLite.
"""
from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Permission, Role, RolePermission, Tenant, TPRAAuditLog, TPRAEngagement, TPRARoster, UserRole,
    Vendor, VendorAssessment, WorkflowNotification,
)
from grc.modules.vendor_risk.tpra import engagements, policy, roster, service
from grc.modules.vendor_risk.tpra.bootstrap import get_tiering_config
from grc.modules.vendor_risk.tpra.stages import STAGE_ORDER
from grc.modules.workflow_engine.services import notification_service

ADMIN, EDITOR, READER, ALICE, BOB, CARA, GONE, BOT = 1, 2, 3, 4, 5, 6, 7, 8


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Roster editor"),
               Permission(id=1, name="vendor_risk:config:edit", resource="vendor_risk", action="edit"),
               Permission(id=2, name="vendor_risk:lifecycle:advance", resource="vendor_risk", action="advance"),
               RolePermission(role_id=2, permission_id=1), RolePermission(role_id=2, permission_id=2)])
    s.add_all([GRCUser(id=uid, username=f"u{uid}", display_name=f"User {uid}", email=f"u{uid}@acme.test",
                       is_active=uid != GONE) for uid in (ADMIN, EDITOR, READER, ALICE, BOB, CARA, GONE)])
    s.add(GRCUser(id=BOT, username="bot", email="bot@do.test", is_active=True, external_provider="digitalocean"))
    s.add_all([UserRole(user_id=ADMIN, role_id=1, tenant_id=1), UserRole(user_id=EDITOR, role_id=2, tenant_id=1)])
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def sent(monkeypatch):
    """What Notify would send, recorded instead of sent."""
    box = []

    def fake(db, **kw):
        box.append(kw)
        return {"notified_users": len(kw["user_ids"])}

    monkeypatch.setattr(notification_service, "send_workflow_notification", fake)
    return box


def _user(db, uid=ADMIN):
    return db.get(GRCUser, uid)


def add(db, role, uid, by=ADMIN):
    return roster.add_member(role, roster.MemberIn(user_id=uid), db=db, user=_user(db, by))


def remove(db, role, uid, by=ADMIN):
    return roster.remove_member(role, uid, db=db, user=_user(db, by))


def people(payload, role):
    return [m["user_id"] for r in payload["roles"] if r["key"] == role for m in r["members"]]


def _vendor(db, name="Acme Cloud", **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", "owner_id": ADMIN, **kw})
    db.add(v)
    db.commit()
    return v


def _at(db, v, stage, tier="medium", skipped=(), engagement=None):
    """An assessment of the supplier (or engagement) with every stage before `stage` complete and `stage` under way."""
    a = service.ensure_active_assessment(db, v, actor_id=ADMIN, engagement=engagement)
    a.inherent_tier, a.current_stage = tier, stage
    for s in service.get_stage_instances(db, a.id):
        s.status = ("skipped" if s.stage_key in skipped else "complete" if STAGE_ORDER[s.stage_key] < STAGE_ORDER[stage]
                    else "in_progress" if s.stage_key == stage else "not_started")
    db.commit()
    return a


def whose(db, v, uid=READER, engagement_id=None):
    return roster.next_stage(v.id, engagement_id=engagement_id, db=db, user=_user(db, uid))


# ── the roster ───────────────────────────────────────────────────────────────

def test_the_roster_lists_the_eight_roles_with_their_labels_and_nobody_yet(db):
    got = roster.get_roster(db=db, user=_user(db, READER))
    assert [r["key"] for r in got["roles"]] == ["tprm_lead", "tprm_analyst", "security", "privacy", "legal",
                                                "procurement", "exec_approver", "it"]
    assert got["roles"][0] == {"key": "tprm_lead", "label": "TPRM Lead", "hint": "Accountable for the assessment",
                               "members": []}
    assert got["roles"][6]["label"] == "Executive / Risk Committee"
    assert got["can_edit"] is False and roster.get_roster(db=db, user=_user(db, EDITOR))["can_edit"] is True
    assert db.query(TPRARoster).count() == 0


def test_a_role_holds_several_people_in_the_order_added_and_a_person_several_roles(db):
    add(db, "security", ALICE)
    add(db, "security", BOB)
    out = add(db, "security", ALICE)                                       # again: nothing changes
    assert people(out, "security") == [ALICE, BOB] and db.query(TPRARoster).count() == 2
    member = out["roles"][2]["members"][0]
    assert member == {"user_id": ALICE, "name": "User 4", "email": "u4@acme.test"}
    assert people(add(db, "legal", ALICE), "legal") == [ALICE]
    adds = db.query(TPRAAuditLog).filter_by(entity="roster", action="add").order_by(TPRAAuditLog.id).all()
    assert [(r.to_value, r.extra["user_id"], r.actor_id) for r in adds] == [
        ("security", ALICE, ADMIN), ("security", BOB, ADMIN), ("legal", ALICE, ADMIN)]      # the repeat wrote no row

    out = remove(db, "security", ALICE)
    assert people(out, "security") == [BOB] and people(out, "legal") == [ALICE]
    remove(db, "security", ALICE)                                           # again: nothing changes
    remove(db, "it", BOB)                                                   # not there: nothing changes
    assert db.query(TPRAAuditLog).filter_by(entity="roster", action="remove").count() == 1


def test_only_active_people_who_sign_in_here_are_put_on_a_role_by_someone_who_may(db):
    for uid, status in ((GONE, 400), (BOT, 400), (999, 400)):
        with pytest.raises(HTTPException) as refused:
            add(db, "security", uid)
        assert refused.value.status_code == status
    with pytest.raises(HTTPException) as imported:
        add(db, "security", BOT)
    assert "access review imported" in imported.value.detail
    with pytest.raises(HTTPException) as role:
        add(db, "janitor", ALICE)
    with pytest.raises(HTTPException) as owner:
        add(db, "business_owner", ALICE)                                    # the supplier's owner is not a workspace role
    assert (role.value.status_code, owner.value.status_code) == (404, 404)
    for act in (lambda: add(db, "security", ALICE, READER), lambda: remove(db, "security", ALICE, READER)):
        with pytest.raises(HTTPException) as denied:
            act()
        assert denied.value.status_code == 403
    assert people(add(db, "security", ALICE, EDITOR), "security") == [ALICE]        # the config right is enough
    assert db.query(TPRARoster).count() == 1


def test_someone_no_longer_active_or_a_connector_import_is_not_listed_or_asked(db):
    add(db, "security", ALICE)
    add(db, "security", BOB)
    db.add(TPRARoster(tenant_id=1, role="security", user_id=BOT))           # however it got there
    db.get(GRCUser, ALICE).is_active = False
    db.commit()
    assert people(roster.get_roster(db=db, user=_user(db)), "security") == [BOB]
    assert roster.effective_team(db, 1, None) == {"security": BOB}
    assert [m["user_id"] for m in roster.members_for(db, 1, "security")] == [BOB]


def test_a_suppliers_own_seat_wins_and_the_roster_fills_the_rest(db):
    add(db, "security", ALICE)
    add(db, "security", BOB)
    add(db, "legal", CARA)
    assert roster.effective_team(db, 1, None) == {"security": ALICE, "legal": CARA}          # the first person for a role
    own = {"security": BOB, "business_owner": ADMIN, "it": 0, "privacy": None}
    assert roster.effective_team(db, 1, own) == {"security": BOB, "business_owner": ADMIN, "legal": CARA}
    assert roster.members_for(db, 1, "it") == [] and roster.members_for(db, 1, "nonsense") == []
    assert db.query(TPRARoster).count() == 3                                 # asking wrote nothing


# ── who is next ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("stage, tier, skipped, expect, roles", [
    ("intake", "medium", (), "tiering", ["tprm_lead", "tprm_analyst"]),
    ("tiering", "medium", (), "dd_planning", ["security"]),
    ("tiering", "high", (), "dd_planning", ["security", "privacy"]),
    ("tiering", "critical", (), "dd_planning", ["security", "privacy", "legal"]),
    ("tiering", "low", ("dd_planning", "questionnaire", "scoring", "findings"), "contracting", ["legal", "procurement"]),
    ("dd_planning", "medium", (), "questionnaire", ["tprm_analyst"]),
    ("questionnaire", "medium", (), "scoring", ["tprm_analyst"]),
    ("scoring", "medium", (), "findings", ["security", "tprm_analyst"]),
    ("findings", "medium", (), "contracting", ["legal", "procurement"]),
    ("contracting", "medium", (), "approval", ["exec_approver", "tprm_lead"]),
    ("approval", "medium", (), "onboarding", ["it", "procurement"]),
    ("onboarding", "medium", (), "monitoring", ["tprm_lead"]),
    ("monitoring", "medium", (), "reassessment", ["tprm_lead"]),
    ("reassessment", "medium", (), None, []),
])
def test_the_stage_after_this_one_and_the_roles_it_waits_on(db, stage, tier, skipped, expect, roles):
    v = _vendor(db, tier=tier)
    _at(db, v, stage, tier, skipped)
    got = whose(db, v)
    assert got["stage_key"] == expect and [r["key"] for r in got["roles"]] == roles
    assert got["stage_label"] == (None if expect is None else service.STAGE_BY_KEY[expect]["label"])


def test_a_role_nobody_holds_is_missing_but_the_executive_approver_never_is(db):
    v = _vendor(db)
    _at(db, v, "contracting")
    got = whose(db, v)
    assert {r["key"]: r["missing"] for r in got["roles"]} == {"exec_approver": False, "tprm_lead": True}
    assert got["anyone_who_can_approve"] is True                          # none named: anyone with the approve right
    add(db, "tprm_lead", ALICE)
    assert {r["key"]: [m["user_id"] for m in r["members"]] for r in whose(db, v)["roles"]} == {
        "exec_approver": [], "tprm_lead": [ALICE]}
    assert whose(db, v)["anyone_who_can_approve"] is True                 # a lead is not the one who decides
    add(db, "exec_approver", BOB)
    got = whose(db, v)
    assert got["anyone_who_can_approve"] is False and got["roles"][0]["members"] == [{"user_id": BOB, "name": "User 5"}]
    _at(db, v, "scoring")
    assert whose(db, v)["anyone_who_can_approve"] is False                # only the approval stage asks


def test_the_suppliers_own_seat_is_the_one_asked_else_everyone_on_the_roster(db):
    add(db, "legal", ALICE)
    add(db, "legal", BOB)
    add(db, "procurement", CARA)
    v = _vendor(db)
    a = _at(db, v, "findings")
    got = {r["key"]: [m["user_id"] for m in r["members"]] for r in whose(db, v)["roles"]}
    assert got == {"legal": [ALICE, BOB], "procurement": [CARA]}           # the whole roster for a role, in order
    a.team_roster = {"legal": CARA, "procurement": GONE}                   # an own seat; one whose holder is no longer active
    db.commit()
    got = {r["key"]: [m["user_id"] for m in r["members"]] for r in whose(db, v)["roles"]}
    assert got == {"legal": [CARA], "procurement": [CARA]}


def test_planning_asks_the_reviewers_the_policy_names_for_the_assessment_it_was_tiered_under(db):
    policy.put_policy(policy.PolicyIn(required_reviewers={"medium": ["legal", "privacy"]}), db=db, user=_user(db))
    v = _vendor(db)
    a = _at(db, v, "tiering")
    assert [r["key"] for r in whose(db, v)["roles"]] == ["legal", "privacy"]          # not tiered yet: Settings as they are
    a.policy_snapshot = service.policy_snapshot(get_tiering_config(db, 1))            # tiered
    db.commit()
    policy.put_policy(policy.PolicyIn(required_reviewers={"medium": ["security"]}), db=db, user=_user(db))
    assert [r["key"] for r in whose(db, v)["roles"]] == ["legal", "privacy"]          # it keeps what it started under


def test_asking_who_is_next_writes_nothing_and_makes_no_assessment(db):
    v = _vendor(db)
    got = whose(db, v)
    assert got["stage_key"] == "tiering" and db.query(VendorAssessment).count() == 0
    assert db.query(TPRAAuditLog).count() == 0


def test_an_engagement_is_asked_about_on_its_own_lifecycle(db):
    v = _vendor(db)
    _at(db, v, "intake")
    payroll = db.get(TPRAEngagement, engagements.create_engagement(
        v.id, engagements.EngagementIn(name="Payroll"), db=db, user=_user(db))["id"])
    _at(db, v, "contracting", engagement=payroll)
    assert whose(db, v)["stage_key"] == "tiering"                           # General
    assert whose(db, v, engagement_id=payroll.id)["stage_key"] == "approval"
    general = service.general_row(db, v)
    assert whose(db, v, engagement_id=general.id)["stage_key"] == "tiering"
    with pytest.raises(HTTPException) as missing:
        whose(db, v, engagement_id=9999)
    other = _vendor(db, "Other Co")
    with pytest.raises(HTTPException) as foreign:                           # another supplier's engagement
        whose(db, other, engagement_id=payroll.id)
    assert (missing.value.status_code, foreign.value.status_code) == (404, 404)


def test_an_archived_or_unknown_supplier_has_no_next_stage(db):
    v = _vendor(db)
    v.deleted_at = datetime.utcnow()
    db.commit()
    for vendor_id in (v.id, 9999):
        with pytest.raises(HTTPException) as gone:
            roster.next_stage(vendor_id, engagement_id=None, db=db, user=_user(db))
        assert gone.value.status_code == 404


# ── Notify ───────────────────────────────────────────────────────────────────

def notify(db, v, uid=EDITOR, engagement_id=None):
    body = roster.NotifyIn(engagement_id=engagement_id) if engagement_id else None
    return roster.notify_stage(v.id, body, db=db, user=_user(db, uid))


def test_notify_tells_the_people_the_next_stage_waits_on_in_the_app_and_by_email_once(db, sent):
    add(db, "tprm_lead", ALICE)
    add(db, "tprm_analyst", BOB)
    add(db, "tprm_analyst", ALICE)                                         # holds two of the roles: told once
    v = _vendor(db)
    out = notify(db, v)
    assert out == {"notified": 2}
    kw = sent[0]
    assert kw["user_ids"] == [ALICE, BOB] and kw["channels"] == ["in_app", "email"] and kw["tenant_id"] == 1
    assert kw["subject"] == "Acme Cloud: Inherent Risk Tiering is ready for you"
    assert kw["link"] == f"/vendor-risk/vendors/{v.id}?stage=tiering" and kw["workflow_instance_id"] is None
    assert kw["notification_type"] == "assignment"
    trail = db.query(TPRAAuditLog).filter_by(entity="stage", action="notify").one()
    assert (trail.vendor_id, trail.actor_id, trail.to_value, trail.extra["user_ids"]) == (v.id, EDITOR, "tiering", [ALICE, BOB])


def test_notify_tells_nobody_when_the_roster_has_nobody_for_the_stage(db, sent):
    v = _vendor(db)
    assert notify(db, v) == {"notified": 0}
    assert sent == [] and db.query(TPRAAuditLog).filter_by(action="notify").count() == 0
    _at(db, v, "reassessment")                                              # and no stage comes after the last
    assert notify(db, v) == {"notified": 0}


def test_notify_needs_the_right_to_move_a_stage(db, sent):
    add(db, "tprm_lead", ALICE)
    v = _vendor(db)
    with pytest.raises(HTTPException) as denied:
        notify(db, v, READER)
    assert denied.value.status_code == 403 and sent == []
    assert notify(db, v, ADMIN) == {"notified": 1}


def test_notify_names_the_engagement_and_cannot_carry_markup_from_a_name(db, sent):
    add(db, "legal", ALICE)
    add(db, "procurement", BOB)
    v = _vendor(db, "<b>Evil</b> Co")
    payroll = db.get(TPRAEngagement, engagements.create_engagement(
        v.id, engagements.EngagementIn(name="Pay<script>roll"), db=db, user=_user(db))["id"])
    _at(db, v, "findings", engagement=payroll)
    assert notify(db, v, engagement_id=payroll.id) == {"notified": 2}
    kw = sent[0]
    assert "<" not in kw["subject"] and ">" not in kw["subject"]
    assert kw["subject"] == "bEvil/b Co (Payscriptroll): Contracting & Controls is ready for you"
    assert kw["link"] == f"/vendor-risk/vendors/{v.id}?stage=contracting&engagement={payroll.id}"


def test_notify_will_not_chase_an_engagement_that_has_ended(db, sent):
    add(db, "legal", ALICE)
    v = _vendor(db)
    payroll = db.get(TPRAEngagement, engagements.create_engagement(
        v.id, engagements.EngagementIn(name="Payroll"), db=db, user=_user(db))["id"])
    _at(db, v, "findings", engagement=payroll)
    engagements.end_engagement(payroll.id, engagements.EndIn(reason="Moved in house"), db=db, user=_user(db))
    with pytest.raises(HTTPException) as ended:
        notify(db, v, engagement_id=payroll.id)
    assert ended.value.status_code == 400 and sent == []
    assert whose(db, v, engagement_id=payroll.id)["stage_key"] == "contracting"       # asking is still allowed


def test_notify_puts_a_notice_in_each_persons_bell(db, monkeypatch):
    mailed = []
    monkeypatch.setattr(notification_service, "send_email", lambda *a, **kw: mailed.append(kw.get("to")) or {"success": True})
    add(db, "tprm_lead", ALICE)
    add(db, "tprm_analyst", BOB)
    v = _vendor(db)
    assert notify(db, v) == {"notified": 2}                                 # the real sender, its mail caught
    assert sorted(mailed) == ["u4@acme.test", "u5@acme.test"]
    rows = db.query(WorkflowNotification).order_by(WorkflowNotification.user_id).all()
    assert [(n.user_id, n.notification_type, n.link) for n in rows] == [
        (ALICE, "assignment", f"/vendor-risk/vendors/{v.id}?stage=tiering"),
        (BOB, "assignment", f"/vendor-risk/vendors/{v.id}?stage=tiering")]
    assert rows[0].subject == "Acme Cloud: Inherent Risk Tiering is ready for you"


def test_the_routes_answer_over_http_with_an_optional_body(db, sent):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from grc.models import get_db
    from grc.routers.auth_router import require_auth

    app = FastAPI()
    app.include_router(roster.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: _user(db, EDITOR)
    web = TestClient(app)
    v = _vendor(db)
    assert web.get("/vendor-risk/roster").json()["can_edit"] is True
    r = web.post("/vendor-risk/roster/tprm_lead/members", json={"user_id": ALICE})
    assert r.status_code == 200 and people(r.json(), "tprm_lead") == [ALICE]
    assert web.post("/vendor-risk/roster/janitor/members", json={"user_id": ALICE}).status_code == 404
    assert web.post("/vendor-risk/roster/tprm_lead/members", json={}).status_code == 422
    got = web.get(f"/vendor-risk/vendors/{v.id}/next-stage").json()
    assert got["stage_key"] == "tiering" and got["roles"][0]["members"] == [{"user_id": ALICE, "name": "User 4"}]
    assert web.post(f"/vendor-risk/vendors/{v.id}/notify-stage").json() == {"notified": 1}              # no body at all
    assert web.post(f"/vendor-risk/vendors/{v.id}/notify-stage", json={}).json() == {"notified": 1}
    assert web.post(f"/vendor-risk/vendors/{v.id}/notify-stage", json={"engagement_id": 999}).status_code == 404
    assert web.delete(f"/vendor-risk/roster/tprm_lead/members/{ALICE}").status_code == 200
    assert web.get(f"/vendor-risk/vendors/{v.id}/next-stage").json()["roles"][0]["missing"] is True
    assert len(sent) == 2
