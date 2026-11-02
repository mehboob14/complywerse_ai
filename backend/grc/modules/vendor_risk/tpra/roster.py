"""The workspace roster: who the workflow asks at each review stage, and who is next on a supplier.

The roster names people for the review roles (TPRM lead, security, legal, …). It decides whom the workflow asks and
tells; it grants nothing, rights stay with roles. It is the default for a supplier's own team seats
(assessment.team_roster), which win where a supplier sets one (effective_team). Next and Notify look at the stage after
the one a supplier (or one of its engagements) is on, and at the people behind the roles that stage waits on.
This module imports nothing of service (service imports it), so what it needs of service is imported late.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ....models import GRCUser, TPRAEngagement, TPRARoster, Vendor, get_db
from ....routers.auth_router import platform_account, refuse_imported_accounts, require_auth
from . import policy, rbac
from .bootstrap import get_tiering_config
from .stages import ROSTER_ROLES, ROSTER_ROLE_KEYS, STAGE_KEYS, STAGE_ORDER, STAGE_ROLES, stage_label

router = APIRouter(tags=["Vendor roster"])
_LABEL = {r["key"]: r["label"] for r in ROSTER_ROLES}


def _person(user: GRCUser) -> dict:
    return {"user_id": user.id, "name": user.display_name or user.username or user.email, "email": user.email}


# ── what the rest of the module reads ────────────────────────────────────────

def roster_members(db: Session, tenant_id: int) -> Dict[str, List[dict]]:
    """{role: people} for every roster role: those who sign in here and are active, in the order they were added."""
    out: Dict[str, List[dict]] = {key: [] for key in ROSTER_ROLE_KEYS}
    rows = (db.query(TPRARoster.role, GRCUser).join(GRCUser, GRCUser.id == TPRARoster.user_id)
            .filter(TPRARoster.tenant_id == tenant_id, GRCUser.is_active.is_(True), platform_account())
            .order_by(TPRARoster.id))
    for role, user in rows:
        if role in out:
            out[role].append(_person(user))
    return out


def members_for(db: Session, tenant_id: int, role: str) -> List[dict]:
    """The people on the roster for one role: [{user_id, name, email}]."""
    return roster_members(db, tenant_id).get(role, [])


def effective_team(db: Session, tenant_id: int, team_roster: Optional[dict]) -> Dict[str, int]:
    """A supplier's team seats {role: user id}: its own where it set one, else the first person the roster names for
    the role."""
    team = {k: v for k, v in (team_roster or {}).items() if v}
    for role, people in roster_members(db, tenant_id).items():
        if people and role not in team:
            team[role] = people[0]["user_id"]
    return team


# ── the roster page ──────────────────────────────────────────────────────────

def _payload(db: Session, user: GRCUser, tenant_id: int) -> dict:
    people = roster_members(db, tenant_id)
    return {"roles": [{**r, "members": people[r["key"]]} for r in ROSTER_ROLES], "can_edit": policy.can_edit(db, user)}


@router.get("/roster")
def get_roster(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    return _payload(db, user, policy.tenant_of(db, user))


class MemberIn(BaseModel):
    user_id: int


def _write(db: Session, user: GRCUser, role: str) -> int:
    tenant_id = policy.tenant_of(db, user)
    rbac.require_write(db, user, "config", "edit")
    if role not in ROSTER_ROLE_KEYS:
        raise HTTPException(404, "There is no such roster role")
    return tenant_id


@router.post("/roster/{role}/members")
def add_member(role: str, body: MemberIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Put a person on a role; again for one already there changes nothing."""
    tenant_id = _write(db, user, role)
    refuse_imported_accounts(db, [body.user_id])
    person = db.query(GRCUser).filter(GRCUser.id == body.user_id, GRCUser.is_active.is_(True)).first()
    if person is None:
        raise HTTPException(400, "Choose an active user of this platform")
    held = db.query(TPRARoster.id).filter(TPRARoster.tenant_id == tenant_id, TPRARoster.role == role,
                                          TPRARoster.user_id == person.id).first()
    if held is None:
        from .service import write_audit           # late: service reads this module

        db.add(TPRARoster(tenant_id=tenant_id, role=role, user_id=person.id, created_by=user.id))
        write_audit(db, tenant_id, entity="roster", action="add", actor_id=user.id, to_value=role,
                    extra={"user_id": person.id})
        try:
            db.commit()
        except IntegrityError:                     # added by someone else at the same moment: it is there
            db.rollback()
    return _payload(db, user, tenant_id)


@router.delete("/roster/{role}/members/{user_id}")
def remove_member(role: str, user_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Take a person off a role; again for one not there changes nothing."""
    tenant_id = _write(db, user, role)
    row = db.query(TPRARoster).filter(TPRARoster.tenant_id == tenant_id, TPRARoster.role == role,
                                      TPRARoster.user_id == user_id).first()
    if row is not None:
        from .service import write_audit

        db.delete(row)
        write_audit(db, tenant_id, entity="roster", action="remove", actor_id=user.id, from_value=role,
                    extra={"user_id": user_id})
        db.commit()
    return _payload(db, user, tenant_id)


# ── who is next ──────────────────────────────────────────────────────────────

def _scope(db: Session, user: GRCUser, vendor_id: int, engagement_id: Optional[int]):
    tenant_id = policy.tenant_of(db, user)
    vendor = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id == tenant_id,
                                     Vendor.deleted_at.is_(None)).first()
    if vendor is None:
        raise HTTPException(404, "Vendor not found")
    engagement = None
    if engagement_id:
        found = db.query(TPRAEngagement).filter(TPRAEngagement.id == engagement_id,
                                                TPRAEngagement.vendor_id == vendor.id).first()
        if found is None:
            raise HTTPException(404, "Engagement not found")
        engagement = None if found.is_general else found
    return vendor, engagement


def whose_next(db: Session, vendor: Vendor, engagement: Optional[TPRAEngagement]) -> dict:
    """The stage after the one this scope is on (stepping over skipped ones), the roles it waits on and the people
    behind each: the supplier's own seat for the role, else everyone the roster names. Nothing is written."""
    from . import service                          # late: service reads this module

    assessment = service.get_active_assessment(db, vendor, engagement)
    current = (assessment.current_stage if assessment is not None else None) or "intake"
    settled = {s.stage_key: s.status for s in service.get_stage_instances(db, assessment.id)} if assessment else {}
    after = STAGE_KEYS[STAGE_ORDER.get(current, 1):]
    stage = next((k for k in after if settled.get(k) not in ("skipped", "complete")), None)
    cfg = service.config_for(db, assessment) if assessment is not None else get_tiering_config(db, vendor.tenant_id)
    tier = (assessment.inherent_tier if assessment is not None else None) or service.scope_row(db, vendor, engagement).tier
    keys = policy.required_reviewers(cfg, tier or "medium") if stage == "dd_planning" else STAGE_ROLES.get(stage, [])

    own = {k: int(v) for k, v in ((assessment.team_roster or {}) if assessment is not None else {}).items()
           if k in keys and v}
    holders = {u.id: _person(u) for u in db.query(GRCUser).filter(
        GRCUser.id.in_(set(own.values()) or {-1}), GRCUser.is_active.is_(True), platform_account())}
    people = roster_members(db, vendor.tenant_id)
    roles = []
    for key in keys:
        members = [holders[own[key]]] if own.get(key) in holders else people.get(key, [])
        roles.append({"key": key, "label": _LABEL.get(key, key),
                      "members": [{"user_id": m["user_id"], "name": m["name"]} for m in members],
                      "missing": not members and key != "exec_approver"})
    # Approval goes to anyone holding the approve right when no executive approver is named.
    anyone = stage == "approval" and not any(r["members"] for r in roles if r["key"] == "exec_approver")
    return {"stage_key": stage, "stage_label": stage_label(stage) if stage else None, "roles": roles,
            "anyone_who_can_approve": anyone}


@router.get("/vendors/{vendor_id}/next-stage")
def next_stage(vendor_id: int, engagement_id: Optional[int] = Query(None), db: Session = Depends(get_db),
               user: GRCUser = Depends(require_auth)):
    return whose_next(db, *_scope(db, user, vendor_id, engagement_id))


class NotifyIn(BaseModel):
    engagement_id: Optional[int] = None


@router.post("/vendors/{vendor_id}/notify-stage")
def notify_stage(vendor_id: int, body: Optional[NotifyIn] = None, db: Session = Depends(get_db),
                 user: GRCUser = Depends(require_auth)):
    """Tell the people the next stage waits on that it is theirs now, in the app and by email."""
    rbac.require_write(db, user, "lifecycle", "advance")
    vendor, engagement = _scope(db, user, vendor_id, body.engagement_id if body else None)
    if engagement is not None and engagement.status == "ended":
        raise HTTPException(400, "This engagement has ended")
    nxt = whose_next(db, vendor, engagement)
    ids = list(dict.fromkeys(m["user_id"] for r in nxt["roles"] for m in r["members"]))
    if not ids:
        return {"notified": 0}
    from ...workflow_engine.services.notification_service import send_workflow_notification
    from .service import write_audit

    def plain(text: str) -> str:                   # the email puts this in HTML: a name cannot bring markup
        return re.sub(r"[<>]", "", text or "")

    name = plain(vendor.name) + (f" ({plain(engagement.name)})" if engagement is not None else "")
    link = f"/vendor-risk/vendors/{vendor.id}?stage={nxt['stage_key']}" + (
        f"&engagement={engagement.id}" if engagement is not None else "")
    sent = send_workflow_notification(
        db, tenant_id=vendor.tenant_id, subject=f"{name}: {nxt['stage_label']} is ready for you"[:500],
        message="The stages before it are settled, and this one is waiting on you.", workflow_instance_id=None,
        user_ids=ids, channels=["in_app", "email"], notification_type="assignment", link=link)
    write_audit(db, vendor.tenant_id, entity="stage", action="notify", vendor_id=vendor.id, actor_id=user.id,
                to_value=nxt["stage_key"], extra={"user_ids": ids, "engagement_id": engagement.id if engagement else None})
    db.commit()
    return {"notified": sent["notified_users"]}
