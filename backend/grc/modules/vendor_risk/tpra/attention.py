"""The attention queue: what in the third-party programme needs somebody today.

Every condition is a query over current data, run each time the queue is read.
There is no task table to fall out of date, so an item leaves the queue the
moment the thing behind it is fixed.

People can snooze an item with a reason, assign it, add a note, or close it with
a closing note. Those live in grc_attention_state and grc_attention_activity,
keyed on (condition, record type, record id), and every one is also written to
the vendor's audit trail. A close holds only for the date that made the item
urgent: if the same record becomes urgent again on a new date, it comes back.

The dashboard tile counts this same list, so the two cannot disagree.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ....models import (
    AttentionActivity, AttentionState, Evidence, GRCUser, TPRAApproval, TPRAContract,
    TPRAControlObligation, TPRAEvidenceLink, TPRAFinding, TPRARiskAcceptance, TPRARiskSnapshot,
    Vendor, VendorAssessment, VendorQuestionnaireResponse, get_db,
)
from ....routers.auth_router import get_user_tenants, require_auth
from . import rbac
from .bootstrap import get_tiering_config
from .reminders import _INACTIVE_VENDOR, _day
from .schema_migrations import ensure_tpra_columns
from .service import write_audit
from .stages import remediation_sla_days_for

# condition → (label, base priority). Higher goes first.
CONDITIONS: Dict[str, tuple] = {
    "critical_finding_past_sla": ("Critical finding past its SLA", 90),
    "obligation_breached": ("Contract obligation breached", 85),
    "rating_dropped": ("Risk rating worsened", 75),
    "approved_never_tiered": ("Approved but never tiered", 70),
    "acceptance_expiring": ("Risk acceptance expiring", 65),
    "assessment_overdue": ("Assessment overdue", 65),
    "reassessment_overdue": ("Reassessment overdue", 65),
    "certificate_expiring": ("Certificate expiring", 55),
    "contract_expiring": ("Contract expiring", 55),
    "questionnaire_untouched": ("Questionnaire not started", 40),
}
_LAPSED_BONUS = 15              # a date that has passed outranks one that is coming
_TIER_BONUS = {"critical": 6, "high": 3, "low": -3}
_RATING_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}
_OPEN_FINDING = ("open", "in_remediation")
_ASSESSMENT_DONE = ("approved", "completed", "rejected", "cancelled", "canceled", "closed")
_POST_APPROVAL_STAGES = ("onboarding", "monitoring", "reassessment", "offboarding")
_EVIDENCE_RETIRED = ("archived", "superseded", "rejected", "deleted")
UNTOUCHED_AFTER_DAYS = 7        # a questionnaire nobody has opened for a week
DROP_LOOKBACK_DAYS = 30         # a worsened rating stays news for a month
_SNAPSHOT_HISTORY_DAYS = 120
ACTIONS = ("note", "assign", "snooze", "unsnooze", "close", "reopen")


def _days(n: int) -> str:
    return f"{n} day{'' if n == 1 else 's'}"


def _countdown(due: date, today: date, verb: str = "Expires") -> str:
    left = (due - today).days
    if left > 0:
        return f"{verb} in {_days(left)}"
    if left == 0:
        return f"{verb} today"
    return f"Expired {_days(-left)} ago" if verb == "Expires" else f"{_days(-left)} overdue"


def policy_for(db: Session, tenant_id: int) -> dict:
    return get_tiering_config(db, tenant_id).get("reminder_policy") or {}


# ── the conditions ───────────────────────────────────────────────────────────

def open_items(db: Session, tenant_id: int, today: date, policy: dict) -> List[dict]:
    """Every condition that holds right now, before anyone's snooze or close."""
    horizon = today + timedelta(days=int(policy.get("remind_before_days", 14)))
    items: List[dict] = []
    vendors = {v.id: v for v in db.query(Vendor).filter(
        Vendor.tenant_id == tenant_id, Vendor.deleted_at.is_(None))
        if (v.status or "").lower() not in _INACTIVE_VENDOR}
    vendor_ids = list(vendors) or [-1]

    def add(condition, record_type, record_id, vendor, since, title, badge, link, tone="amber", lapsed=False):
        label, base = CONDITIONS[condition]
        items.append({
            "key": f"{condition}:{record_type}:{record_id}",
            "condition": condition, "label": label, "record_type": record_type, "record_id": record_id,
            "vendor_id": vendor.id, "vendor_name": vendor.name, "vendor_tier": vendor.tier,
            "owner_id": vendor.owner_id, "title": title, "badge": badge, "tone": tone,
            "since": since.isoformat(), "link": link,
            "priority": base + (_LAPSED_BONUS if lapsed else 0)
            + _TIER_BONUS.get((vendor.tier or "").lower(), 0),
        })

    # Critical findings open longer than their severity's remediation SLA.
    for f in db.query(TPRAFinding).filter(
            TPRAFinding.tenant_id == tenant_id, TPRAFinding.deleted_at.is_(None),
            TPRAFinding.status.in_(_OPEN_FINDING), TPRAFinding.created_at.isnot(None),
            or_(TPRAFinding.severity == "critical", TPRAFinding.is_critical_control_fail.is_(True))):
        v = vendors.get(f.vendor_id)
        sla = remediation_sla_days_for(f.severity)
        deadline = _day(f.created_at) + timedelta(days=sla)
        if v is None or deadline >= today:
            continue
        add("critical_finding_past_sla", "finding", f.id, v, deadline,
            f"Critical finding '{f.title or 'Untitled'}' on {v.name} is past its {sla}-day SLA",
            f"{_days((today - deadline).days)} past SLA",
            f"/vendor-risk/vendors/{v.id}?stage=findings&finding={f.id}", tone="red")

    contracts = {c.id: c for c in db.query(TPRAContract).filter(
        TPRAContract.tenant_id == tenant_id, TPRAContract.deleted_at.is_(None))}

    # Contract obligations marked breached.
    for o in db.query(TPRAControlObligation).filter(
            TPRAControlObligation.tenant_id == tenant_id, TPRAControlObligation.deleted_at.is_(None),
            TPRAControlObligation.status == "breached"):
        c = contracts.get(o.contract_id)
        v = vendors.get(c.vendor_id) if c else None
        if v is None:
            continue
        add("obligation_breached", "obligation", o.id, v, _day(o.updated_at or o.created_at) or today,
            f"{v.name} breached a contract obligation: {(o.obligation or '').strip()[:140]}",
            "Breached", f"/vendor-risk/vendors/{v.id}?stage=contracting", tone="red")

    # Active contracts up for renewal or expiry, whichever comes first.
    for c in contracts.values():
        v = vendors.get(c.vendor_id)
        dates = [d for d in (_day(c.renewal_date), _day(c.expiry_date)) if d]
        if c.status != "active" or v is None or not dates or min(dates) > horizon:
            continue
        due = min(dates)
        add("contract_expiring", "contract", c.id, v, due,
            f"Contract '{c.title or 'contract'}' with {v.name} is up for renewal or expiry on {due:%d %b %Y}",
            _countdown(due, today, "Due"), f"/vendor-risk/vendors/{v.id}?stage=contracting",
            tone="red" if due < today else "amber", lapsed=due < today)

    # Certificates and other evidence a vendor supplied, expired or about to.
    seen = set()
    for link, ev in (db.query(TPRAEvidenceLink, Evidence)
                     .join(Evidence, Evidence.id == TPRAEvidenceLink.evidence_id)
                     .filter(TPRAEvidenceLink.tenant_id == tenant_id, TPRAEvidenceLink.deleted_at.is_(None),
                             Evidence.expiry_date.isnot(None))
                     .order_by(TPRAEvidenceLink.id)):
        v = vendors.get(link.vendor_id)
        due = _day(ev.expiry_date)
        if (v is None or due > horizon or (v.id, ev.id) in seen
                or (ev.status or "").lower() in _EVIDENCE_RETIRED):
            continue
        seen.add((v.id, ev.id))
        add("certificate_expiring", "evidence_link", link.id, v, due,
            f"{ev.name or 'Evidence'} from {v.name} {'expired' if due < today else 'expires'} on {due:%d %b %Y}",
            _countdown(due, today), f"/vendor-risk/vendors/{v.id}?stage=questionnaire",
            tone="red" if due < today else "amber", lapsed=due < today)

    # Risk acceptances running out — or already out while the finding still reads
    # "accepted", so nobody has decided again. Only each finding's latest counts.
    latest: Dict[int, TPRARiskAcceptance] = {}
    for a in db.query(TPRARiskAcceptance).filter(
            TPRARiskAcceptance.tenant_id == tenant_id, TPRARiskAcceptance.deleted_at.is_(None),
            TPRARiskAcceptance.status.in_(("active", "expired"))).order_by(TPRARiskAcceptance.id):
        latest[a.finding_id] = a
    findings = {f.id: f for f in db.query(TPRAFinding).filter(
        TPRAFinding.id.in_(list(latest) or [-1]), TPRAFinding.deleted_at.is_(None))}
    for a in latest.values():
        f = findings.get(a.finding_id)
        v = vendors.get(f.vendor_id) if f else None
        due = _day(a.expiry)
        if v is None or due is None or due > horizon or f.status == "closed":
            continue
        if a.status == "expired" and f.status != "accepted":
            continue
        add("acceptance_expiring", "acceptance", a.id, v, due,
            f"Risk acceptance of '{f.title or 'finding'}' on {v.name} "
            f"{'lapsed' if due < today else 'runs out'} on {due:%d %b %Y}",
            _countdown(due, today), f"/vendor-risk/vendors/{v.id}?stage=findings&finding={f.id}",
            tone="red" if due < today else "amber", lapsed=due < today)

    # Assessments past their due date and not finished.
    for a in db.query(VendorAssessment).filter(
            VendorAssessment.tenant_id == tenant_id, VendorAssessment.deleted_at.is_(None),
            VendorAssessment.due_date.isnot(None), VendorAssessment.completed_at.is_(None),
            or_(VendorAssessment.lifecycle_status == "active", VendorAssessment.lifecycle_status.is_(None))):
        v = vendors.get(a.vendor_id)
        due = _day(a.due_date)
        if v is None or due >= today or (a.status or "").lower() in _ASSESSMENT_DONE:
            continue
        kind = (a.assessment_type or "vendor").replace("_", " ")
        add("assessment_overdue", "assessment", a.id, v, due,
            f"The {kind} assessment of {v.name} was due on {due:%d %b %Y}",
            _countdown(due, today, "Due"), f"/vendor-risk/assessments/{a.id}", tone="red")

    # Reassessments whose date has passed.
    for v in vendors.values():
        due = _day(v.next_reassessment_date)
        if due is not None and due < today:
            add("reassessment_overdue", "vendor", v.id, v, due,
                f"Reassessment of {v.name} was due on {due:%d %b %Y}",
                _countdown(due, today, "Due"), f"/vendor-risk/vendors/{v.id}?stage=reassessment", tone="red")

    # Vendors approved, or already in use, whose inherent risk was never tiered.
    tiered = {vid for (vid,) in db.query(VendorAssessment.vendor_id).filter(
        VendorAssessment.tenant_id == tenant_id, VendorAssessment.deleted_at.is_(None),
        VendorAssessment.inherent_tier.isnot(None))}
    approved: Dict[int, datetime] = {}
    for vid, at in db.query(TPRAApproval.vendor_id, TPRAApproval.created_at).filter(
            TPRAApproval.tenant_id == tenant_id,
            TPRAApproval.decision.in_(("approve", "approve_with_conditions"))).order_by(TPRAApproval.id):
        approved.setdefault(vid, at)
    for v in vendors.values():
        if v.id in tiered or v.inherent_risk_score is not None:
            continue
        since = approved.get(v.id) or (
            v.created_at if (v.lifecycle_stage or "").lower() in _POST_APPROVAL_STAGES else None)
        if since is None:
            continue
        add("approved_never_tiered", "vendor", v.id, v, _day(since),
            f"{v.name} is approved but its inherent risk was never tiered",
            "Not tiered", f"/vendor-risk/vendors/{v.id}?stage=tiering", tone="red")

    # Residual rating worse than it was, within the last month. Snapshots are
    # written daily, so this finds the latest change rather than comparing the
    # last two rows, which are usually identical.
    changes: Dict[int, tuple] = {}
    current: Dict[int, str] = {}
    for s in db.query(TPRARiskSnapshot).filter(
            TPRARiskSnapshot.tenant_id == tenant_id, TPRARiskSnapshot.scope == "vendor",
            TPRARiskSnapshot.vendor_id.in_(vendor_ids), TPRARiskSnapshot.residual_rating.isnot(None),
            TPRARiskSnapshot.captured_at >= datetime.combine(
                today - timedelta(days=_SNAPSHOT_HISTORY_DAYS), time.min),
    ).order_by(TPRARiskSnapshot.vendor_id, TPRARiskSnapshot.captured_at, TPRARiskSnapshot.id):
        rating = (s.residual_rating or "").lower()
        if rating not in _RATING_RANK:
            continue
        before = current.get(s.vendor_id)
        if before is not None and before != rating:
            changes[s.vendor_id] = (before, rating, s)
        current[s.vendor_id] = rating
    for vid, (before, after, s) in changes.items():
        when = _day(s.captured_at)
        if _RATING_RANK[after] <= _RATING_RANK[before] or when < today - timedelta(days=DROP_LOOKBACK_DAYS):
            continue
        v = vendors[vid]
        add("rating_dropped", "snapshot", s.id, v, when,
            f"{v.name}'s residual rating worsened from {before} to {after} on {when:%d %b %Y}",
            f"{before.title()} → {after.title()}", f"/vendor-risk/vendors/{v.id}?stage=scoring",
            tone="red" if after in ("high", "critical") else "amber")

    # Questionnaires sent a week or more ago that the vendor has not opened.
    for qr in db.query(VendorQuestionnaireResponse).filter(
            VendorQuestionnaireResponse.tenant_id == tenant_id,
            VendorQuestionnaireResponse.status == "pending"):
        v = vendors.get(qr.vendor_id)
        sent = _day(qr.created_at)
        if v is None or sent is None or sent + timedelta(days=UNTOUCHED_AFTER_DAYS) > today:
            continue
        lapsed = qr.expires_at is not None and _day(qr.expires_at) < today
        add("questionnaire_untouched", "questionnaire", qr.id, v, sent + timedelta(days=UNTOUCHED_AFTER_DAYS),
            f"{v.name} has not started the questionnaire sent on {sent:%d %b %Y}"
            + ("; its link has expired" if lapsed else ""),
            "Link expired" if lapsed else f"Sent {_days((today - sent).days)} ago",
            f"/vendor-risk/assessments/{qr.assessment_id}?tab=questionnaire" if qr.assessment_id
            else f"/vendor-risk/vendors/{v.id}?stage=questionnaire")

    return items


# ── the queue, with what people did to it ────────────────────────────────────

def _names(db: Session, ids) -> Dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.display_name or u.username or u.email or f"User {u.id}"
            for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))}


def queue(db: Session, tenant_id: int, user_id: Optional[int], scope: str = "portfolio",
          view: str = "open", today: Optional[date] = None) -> dict:
    """The items in one view (open, snoozed or closed), ranked, with counts of all three.

    `scope=mine` keeps the items assigned to the caller, and the unassigned items
    on vendors the caller owns."""
    today = today or datetime.utcnow().date()
    states = {(s.condition, s.record_type, s.record_id): s for s in db.query(AttentionState).filter(
        AttentionState.tenant_id == tenant_id, AttentionState.condition.in_(list(CONDITIONS)))}
    counts = {"open": 0, "urgent": 0, "snoozed": 0, "closed": 0}
    by_condition = {key: 0 for key in CONDITIONS}
    shown = []
    for item in open_items(db, tenant_id, today, policy_for(db, tenant_id)):
        s = states.get((item["condition"], item["record_type"], item["record_id"]))
        snoozed = bool(s and s.snoozed_until and s.snoozed_until > today)
        closed = bool(s and s.closed_for and s.closed_for.isoformat() == item["since"])
        item.update({
            "assignee_id": s.assignee_id if s else None,
            "snoozed_until": s.snoozed_until.isoformat() if snoozed else None,
            "snooze_reason": s.snooze_reason if snoozed else None,
            "state": "closed" if closed else "snoozed" if snoozed else "open",
        })
        if scope == "mine" and user_id != (item["assignee_id"] or item["owner_id"]):
            continue
        counts[item["state"]] += 1
        if item["state"] == "open":
            by_condition[item["condition"]] += 1
            counts["urgent"] += item["tone"] == "red"
        if item["state"] == view:
            shown.append(item)
    shown.sort(key=lambda i: (-i["priority"], i["since"]))
    names = _names(db, [i["assignee_id"] for i in shown] + [i["owner_id"] for i in shown])
    for item in shown:
        item["assignee_name"] = names.get(item["assignee_id"])
        item["owner_name"] = names.get(item["owner_id"])
    return {"items": shown, "counts": counts, "by_condition": by_condition,
            "conditions": {k: label for k, (label, _) in CONDITIONS.items()}, "today": today.isoformat()}


def act(db: Session, tenant_id: int, actor_id: int, *, condition: str, record_type: str, record_id: int,
        action: str, text: Optional[str] = None, until: Optional[date] = None,
        assignee_id: Optional[int] = None, today: Optional[date] = None) -> dict:
    """Note, assign, snooze, unsnooze, close or reopen one item. Raises LookupError
    when the item no longer needs attention, ValueError when the request is wrong."""
    today = today or datetime.utcnow().date()
    key = (condition, record_type, record_id)
    item = next((i for i in open_items(db, tenant_id, today, policy_for(db, tenant_id))
                 if (i["condition"], i["record_type"], i["record_id"]) == key), None)
    if item is None:
        raise LookupError("This no longer needs attention")
    if action not in ACTIONS:
        raise ValueError(f"Unknown action '{action}'")
    text = " ".join((text or "").split()) or None
    if action in ("note", "snooze", "close") and not text:
        raise ValueError({"note": "Write the note", "snooze": "Give a reason for snoozing",
                          "close": "Add a closing note"}[action])
    if text and len(text) > 4000:
        raise ValueError("Keep it under 4,000 characters")

    if action != "note":
        state = db.query(AttentionState).filter(
            AttentionState.tenant_id == tenant_id, AttentionState.condition == condition,
            AttentionState.record_type == record_type, AttentionState.record_id == record_id).first()
        if state is None:
            state = AttentionState(tenant_id=tenant_id, condition=condition,
                                   record_type=record_type, record_id=record_id)
            db.add(state)
        if action == "assign":
            if assignee_id is not None and not db.query(GRCUser.id).filter(
                    GRCUser.id == assignee_id, GRCUser.is_active.is_(True)).first():
                raise ValueError("There is no active user with that id")
            state.assignee_id = assignee_id
        elif action == "snooze":
            if until is None or not today < until <= today + timedelta(days=365):
                raise ValueError("Snooze until a date after today and within a year")
            state.snoozed_until, state.snooze_reason = until, text
        elif action == "unsnooze":
            state.snoozed_until = state.snooze_reason = None
        elif action == "close":
            state.closed_for = date.fromisoformat(item["since"])
        elif action == "reopen":
            state.closed_for = None
        state.updated_by = actor_id

    db.add(AttentionActivity(tenant_id=tenant_id, condition=condition, record_type=record_type,
                             record_id=record_id, action=action, text=text, actor_id=actor_id,
                             assignee_id=assignee_id if action == "assign" else None))
    extra = {"condition": condition, "record_type": record_type, "record_id": record_id,
             "title": item["title"], "since": item["since"]}
    if until is not None and action == "snooze":
        extra["until"] = until.isoformat()
    if action == "assign":
        extra["assignee_id"] = assignee_id
    write_audit(db, tenant_id, entity="attention", action=action, vendor_id=item["vendor_id"],
                entity_id=record_id, actor_id=actor_id, to_value=item["label"], reason=text, extra=extra)

    if action == "assign" and assignee_id and assignee_id != actor_id:
        from ...workflow_engine.services.notification_service import send_workflow_notification
        send_workflow_notification(db, tenant_id=tenant_id, subject=f"Assigned to you: {item['title']}"[:500],
                                   message=f"{item['title']}.\n\nOpen: {item['link']}",
                                   workflow_instance_id=None, user_ids=[assignee_id],
                                   channels=["in_app"], notification_type="assignment")
    return item


# ── REST ─────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/tpra/attention", tags=["TPRA Attention"])


def _tenant(db: Session, user: GRCUser) -> int:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(403, "No tenant context")
    ensure_tpra_columns(db)
    return tids[0]


def _can_act(db: Session, user: GRCUser) -> bool:
    return rbac.user_has_any_permission(db, user, ["vendor_risk:vendors:edit", "erm:risks:edit"])


@router.get("")
def list_attention(
    scope: str = Query("portfolio", pattern="^(portfolio|mine)$"),
    view: str = Query("open", pattern="^(open|snoozed|closed)$"),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = _tenant(db, user)
    result = queue(db, tenant_id, user.id, scope=scope, view=view)
    result["can_act"] = _can_act(db, user)
    # The people an item can be assigned to — only for those allowed to assign.
    result["assignees"] = [
        {"id": u.id, "name": u.display_name or u.username or u.email}
        for u in db.query(GRCUser).filter(GRCUser.is_active.is_(True)).order_by(GRCUser.display_name)
    ] if result["can_act"] else []
    return result


@router.get("/history")
def item_history(
    condition: str, record_type: str, record_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = _tenant(db, user)
    rows = db.query(AttentionActivity).filter(
        AttentionActivity.tenant_id == tenant_id, AttentionActivity.condition == condition,
        AttentionActivity.record_type == record_type, AttentionActivity.record_id == record_id,
    ).order_by(AttentionActivity.id.desc()).limit(200).all()
    names = _names(db, [r.actor_id for r in rows] + [r.assignee_id for r in rows])
    return {"items": [{
        "id": r.id, "action": r.action, "text": r.text,
        "actor_id": r.actor_id, "actor_name": names.get(r.actor_id),
        "assignee_id": r.assignee_id, "assignee_name": names.get(r.assignee_id),
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]}


class ActIn(BaseModel):
    condition: str
    record_type: str
    record_id: int
    action: Literal["note", "assign", "snooze", "unsnooze", "close", "reopen"]
    text: Optional[str] = None
    until: Optional[date] = None
    assignee_id: Optional[int] = None


@router.post("/act")
def act_on_item(body: ActIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tenant_id = _tenant(db, user)
    rbac.require_write(db, user, "vendors", "edit")
    try:
        item = act(db, tenant_id, user.id, condition=body.condition, record_type=body.record_type,
                   record_id=body.record_id, action=body.action, text=body.text,
                   until=body.until, assignee_id=body.assignee_id)
        db.commit()
    except LookupError as exc:
        db.rollback()
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Someone else changed this item a moment ago. Reload and try again.")
    return {"ok": True, "key": item["key"], "action": body.action}
