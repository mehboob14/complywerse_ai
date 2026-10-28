"""What a monitoring signal sets off, besides what it always does.

Every verified signal does two things, and a tenant with no rules gets exactly
those: it is emailed to the supplier's owner and whoever the reminder settings
name once it is at or above their severity (the daily sweep, tpra/reminders.py),
and it reopens each scope's assessment when it is serious enough for that scope's
tier (the tier policy's reassess_on; a breach always). Those two are listed here as
the built-in rules and stay set where they always were.

A tenant's own rules add to them. Each is for some tiers and kinds of signal (none
named: all) from a least severity, and does one thing: tells people (the owner
too), plans a to-do on the supplier's action plan (for the people named, else the
owner), brings the next reassessment forward to today (no new cycle), or opens a
reassessment where the tier alone would not (joining one already open, as the
built-in does). They run where a signal is recorded (tpra/monitoring.py), on
verified signals of suppliers in use, in their order; each one that matches acts
once per signal and is written to the supplier's audit trail.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ....models import GRCUser, Role, TPRAActionItem, TPRAAlertRule, TPRAReminder, get_db
from ....routers.auth_router import refuse_imported_accounts, require_auth
from . import rbac, service, tier_policy
from .bootstrap import get_tiering_config
from .emails import render
from .graph import _tenant
from .reminders import _ALERT_TYPES, _INACTIVE_VENDOR, _day, _deliver as deliver, escalation_users
from .stages import TIERS

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Vendor alert rules"])

ACTIONS = {
    "notify": "Tell people",
    "create_task": "Plan a to-do",
    "bring_forward_reassessment": "Bring the reassessment forward",
    "open_reassessment": "Open a reassessment",
}
KINDS = {
    "breach": "Breach", "adverse_media": "Adverse media", "vulnerability": "Vulnerability",
    "security_rating": "Security rating", "cert_expiry": "Lapsed certificate", "financial": "Financial",
    "sla": "Missed service level",
}
_RANK = {s: n for n, s in enumerate(tier_policy.SEVERITIES, start=1)}      # low 1 … critical 4


# ── what a signal sets off ───────────────────────────────────────────────────

def for_supplier(db: Session, vendor) -> List[TPRAAlertRule]:
    """The tenant's rules that are on, in their order; none for a supplier not in use."""
    if vendor.deleted_at is not None or (vendor.status or "").lower() in _INACTIVE_VENDOR:
        return []
    return (db.query(TPRAAlertRule)
            .filter(TPRAAlertRule.tenant_id == vendor.tenant_id, TPRAAlertRule.enabled.is_(True))
            .order_by(TPRAAlertRule.position, TPRAAlertRule.id).all())


def matches(rule: TPRAAlertRule, signal, tier: Optional[str]) -> bool:
    """Whether a rule is for this signal on a scope of this tier."""
    return (_RANK.get((signal.severity or "").lower(), 0) >= _RANK.get(rule.min_severity, len(_RANK))
            and (not rule.signal_kinds or signal.signal_type in rule.signal_kinds)
            and (not rule.tiers or (tier or "medium").lower() in rule.tiers))


def _targets(rule: TPRAAlertRule) -> List[str]:
    return [f"user:{i}" for i in rule.notify_user_ids or []] + [f"role:{r}" for r in rule.notify_roles or []]


def _headline(vendor, signal) -> str:
    return (f"New {(signal.severity or '').lower()} alert on {vendor.name}: "
            f"{signal.title or signal.signal_type.replace('_', ' ')}")


def _notify(db: Session, vendor, signal, rule: TPRAAlertRule) -> int:
    """The owner and the people the rule names hear now, in the app and by email,
    once each: a reminder row per person, so the daily alert email skips them."""
    day = _day(signal.created_at) or datetime.utcnow().date()
    link = (f"/vendor-risk/alerts?alert={signal.id}" if signal.signal_type in _ALERT_TYPES
            else f"/vendor-risk/vendors/{vendor.id}?stage=monitoring")
    subject, message, _ = render(db, vendor.tenant_id, "alert",
                                 {"title": _headline(vendor, signal), "link": link, "vendor": vendor.name})
    told = 0
    for uid in dict.fromkeys(p for p in [vendor.owner_id, *escalation_users(db, _targets(rule))] if p):
        try:
            with db.begin_nested():
                db.add(TPRAReminder(tenant_id=vendor.tenant_id, kind="alert_new", subject_type="signal",
                                    subject_id=signal.id, vendor_id=vendor.id, recipient_id=uid, period=day,
                                    escalation=0, due_on=day))
                db.flush()
                deliver(db, vendor.tenant_id, uid, subject, message)
            told += 1
        except IntegrityError:
            pass                                    # an earlier rule told them already
        except Exception:  # noqa: BLE001 — recording a signal never fails over an email
            logger.warning("alert rule %s: user %s not told of signal %s", rule.id, uid, signal.id, exc_info=True)
    return told


def _todo(db: Session, vendor, signal, rule: TPRAAlertRule, actor_id: Optional[int]) -> int:
    """A to-do on the supplier's action plan, due today, for the people the rule
    names or else the owner: it joins their attention queue and is chased weekly."""
    item = TPRAActionItem(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, kind="todo", status="scheduled", created_by=actor_id,
        title=f"Look into: {signal.title or signal.signal_type.replace('_', ' ') + ' signal'}"[:200],
        note=f"Planned by the alert rule “{rule.name}”." + (f"\n\n{signal.detail}" if signal.detail else ""),
        due_on=datetime.utcnow().date(), assignee_ids=escalation_users(db, _targets(rule))[:20] or None,
    )
    db.add(item)
    db.flush()
    service.write_audit(db, vendor.tenant_id, entity="action", action="create", vendor_id=vendor.id,
                        entity_id=item.id, actor_id=actor_id, to_value=f"To-do on {item.due_on:%d %b %Y}",
                        reason=item.title)
    return item.id


def _bring_forward(db: Session, vendor, engagement, rule: TPRAAlertRule, signal,
                   actor_id: Optional[int]) -> Optional[str]:
    """The scope's next reassessment falls due today; no new cycle starts. One due
    already, or an engagement never assessed, is left as it is."""
    if engagement is not None and service.get_active_assessment(db, vendor, engagement) is None:
        return None
    holder, now = engagement or vendor, datetime.utcnow()
    due = _day(holder.next_reassessment_date)
    if due is not None and due <= now.date():
        return None
    holder.next_reassessment_date = now
    service.write_audit(db, vendor.tenant_id, entity="reassessment", action="bring_forward", vendor_id=vendor.id,
                        actor_id=actor_id, from_value=due.isoformat() if due else None,
                        to_value=now.date().isoformat(), reason=f"Alert rule “{rule.name}”: {_headline(vendor, signal)}",
                        extra={"signal_id": signal.id, "engagement_id": getattr(engagement, "id", None)})
    return engagement.name if engagement is not None else "General"


def act(db: Session, vendor, signal, fired: List[TPRAAlertRule], scopes: Dict[int, list], reopened: list,
        actor_id: Optional[int]) -> None:
    """Do what the rules that matched say, in their order. `scopes` are the scopes
    (None for General) each matched; `reopened` the ones the signal opened or joined
    (tpra/monitoring.py opens them, beside the built-in)."""
    for rule in fired:
        if rule.action == "notify":
            done = {"told": _notify(db, vendor, signal, rule)}
        elif rule.action == "create_task":
            done = {"action_id": _todo(db, vendor, signal, rule, actor_id)}
        elif rule.action == "bring_forward_reassessment":
            moved = [_bring_forward(db, vendor, e, rule, signal, actor_id) for e in scopes[rule.id] if e not in reopened]
            done = {"brought_forward": [m for m in moved if m]}
        else:
            done = {"reopened": [e.name if e is not None else "General" for e in scopes[rule.id] if e in reopened]}
        service.write_audit(db, vendor.tenant_id, entity="alert_rule", action="fire", vendor_id=vendor.id,
                            entity_id=rule.id, actor_id=actor_id, to_value=rule.action, reason=rule.name,
                            extra={"signal_id": signal.id, **done})


# ── the built-in rules ───────────────────────────────────────────────────────

def builtin(db: Session, tenant_id: int) -> List[dict]:
    """What every verified signal sets off before any rule, as the settings have it now."""
    cfg = get_tiering_config(db, tenant_id)
    reminders = cfg.get("reminder_policy") or {}
    policy = tier_policy.merged(cfg.get("tier_policy"))
    return [
        {"key": "email", "action": "notify", "name": "Email new alerts",
         "min_severity": reminders.get("alert_min_severity") or "high", "targets": reminders.get("alert_notify") or [],
         "enabled": reminders.get("enabled", True), "settings": "/vendor-risk/settings#reminders"},
        {"key": "reopen", "action": "open_reassessment", "name": "Reopen the assessment",
         "reassess_on": {t: tier_policy.reassess_threshold(t, policy) for t in TIERS}, "always": ["breach"],
         "enabled": True, "settings": "/vendor-risk/settings#tier-asks"},
    ]


# ── REST ─────────────────────────────────────────────────────────────────────

def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _row(r: TPRAAlertRule) -> dict:
    return {"id": r.id, "name": r.name, "tiers": r.tiers or [], "signal_kinds": r.signal_kinds or [],
            "min_severity": r.min_severity, "action": r.action, "notify_user_ids": r.notify_user_ids or [],
            "notify_roles": r.notify_roles or [], "enabled": bool(r.enabled), "position": r.position,
            "created_by": r.created_by, "created_at": _iso(r.created_at), "updated_at": _iso(r.updated_at)}


def _rules(db: Session, tenant_id: int) -> List[TPRAAlertRule]:
    return (db.query(TPRAAlertRule).filter(TPRAAlertRule.tenant_id == tenant_id)
            .order_by(TPRAAlertRule.position, TPRAAlertRule.id).all())


@router.get("/alert-rules")
def list_rules(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The built-in rules, then the tenant's own in the order they run."""
    tid = _tenant(db, user)
    return {"items": [_row(r) for r in _rules(db, tid)], "builtin": builtin(db, tid), "actions": ACTIONS,
            "kinds": KINDS, "severities": tier_policy.SEVERITIES, "tiers": TIERS}


class RuleIn(BaseModel):
    """Only the fields a request names are written."""
    name: Optional[str] = Field(None, max_length=120)
    tiers: Optional[List[Literal["critical", "high", "medium", "low"]]] = Field(None, max_length=4)
    signal_kinds: Optional[List[str]] = Field(None, max_length=20)
    min_severity: Optional[Literal["low", "medium", "high", "critical"]] = None
    action: Optional[Literal["notify", "create_task", "bring_forward_reassessment", "open_reassessment"]] = None
    notify_user_ids: Optional[List[int]] = Field(None, max_length=20)
    notify_roles: Optional[List[str]] = Field(None, max_length=20)
    enabled: Optional[bool] = None


def _clean(db: Session, body: RuleIn, given, current: Optional[TPRAAlertRule] = None) -> dict:
    """The fields a write names, checked."""
    out: dict = {}
    for key in given:
        value = getattr(body, key)
        if value is None and key in ("min_severity", "action", "enabled"):
            continue                                # these change but are never emptied
        if key == "name":
            value = " ".join((value or "").split())
            if not value:
                raise HTTPException(400, "Give the rule a name")
        elif key == "tiers":
            value = list(dict.fromkeys(value or []))
        elif key == "signal_kinds":
            value = list(dict.fromkeys(value or []))
            unknown = [k for k in value if k not in KINDS]
            if unknown:
                raise HTTPException(400, f"Unknown kind of signal: {', '.join(unknown)}")
        elif key == "notify_user_ids":
            value = list(dict.fromkeys(int(i) for i in value or [] if i))
            if value and db.query(GRCUser.id).filter(GRCUser.id.in_(value)).count() != len(value):
                raise HTTPException(400, "Everyone a rule names must be a platform user")
            refuse_imported_accounts(db, value, kept=(current.notify_user_ids or []) if current is not None else ())
        elif key == "notify_roles":
            value = list(dict.fromkeys(" ".join(str(n).split()) for n in value or [] if str(n).strip()))
            missing = set(value) - {n for (n,) in db.query(Role.name).filter(Role.name.in_(value))}
            if missing:
                raise HTTPException(400, f"There is no role called {', '.join(sorted(missing))}")
        out[key] = value
    return out


def _rule(db: Session, tenant_id: int, rule_id: int) -> TPRAAlertRule:
    rule = db.query(TPRAAlertRule).filter(TPRAAlertRule.id == rule_id, TPRAAlertRule.tenant_id == tenant_id).first()
    if rule is None:
        raise HTTPException(404, "Rule not found")
    return rule


@router.post("/alert-rules", status_code=201)
def create_rule(body: RuleIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """A new rule, run after the others."""
    tid = _tenant(db, user)
    rbac.require_write(db, user, "config", "edit")
    values = _clean(db, body, body.model_fields_set)
    if not values.get("action"):
        raise HTTPException(400, "Choose what the rule does")
    values.setdefault("min_severity", "high")
    values.setdefault("name", f"{ACTIONS[values['action']]} from {values['min_severity']}")
    last = db.query(func.max(TPRAAlertRule.position)).filter(TPRAAlertRule.tenant_id == tid).scalar()
    rule = TPRAAlertRule(tenant_id=tid, created_by=user.id, position=(last or 0) + 1, **values)
    db.add(rule)
    db.flush()
    service.write_audit(db, tid, entity="alert_rule", action="create", entity_id=rule.id, actor_id=user.id,
                        to_value=rule.name, extra={"rule": _row(rule)})
    db.commit()
    return _row(rule)


class OrderIn(BaseModel):
    ids: List[int] = Field(..., max_length=500)


@router.post("/alert-rules/order")
def reorder_rules(body: OrderIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The rules in a new order: every rule once."""
    tid = _tenant(db, user)
    rbac.require_write(db, user, "config", "edit")
    rows = {r.id: r for r in _rules(db, tid)}
    if sorted(body.ids) != sorted(rows):
        raise HTTPException(400, "Send every rule once, in the new order")
    for n, rule_id in enumerate(body.ids, start=1):
        rows[rule_id].position = n
    service.write_audit(db, tid, entity="alert_rule", action="reorder", actor_id=user.id,
                        to_value=", ".join(rows[i].name for i in body.ids)[:500])
    db.commit()
    return list_rules(db=db, user=user)


@router.put("/alert-rules/{rule_id}")
def update_rule(rule_id: int, body: RuleIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tenant(db, user)
    rbac.require_write(db, user, "config", "edit")
    rule = _rule(db, tid, rule_id)
    values = _clean(db, body, body.model_fields_set, rule)
    changes = {k: [getattr(rule, k), v] for k, v in values.items() if getattr(rule, k) != v}
    for key, (_, value) in changes.items():
        setattr(rule, key, value)
    if changes:
        service.write_audit(db, tid, entity="alert_rule", action="update", entity_id=rule.id, actor_id=user.id,
                            to_value=rule.name, extra={"changes": changes})
    db.commit()
    return _row(rule)
