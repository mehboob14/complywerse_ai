"""Tells people about third-party risk dates before and after they pass.

Five dates in this module carry a promise, and until now nothing acted on any of
them: a vendor's reassessment date, a questionnaire waiting on the vendor, a
remediation's due date, a risk acceptance's expiry, and a contract's renewal or
expiry. The platform clock queues this sweep daily.

The rhythm is one notice when the reminder window opens, then — once overdue —
one every repeat period: weekly by default, not daily nagging. Past the
escalation threshold the escalation contacts are told as well. A questionnaire,
acceptance or contract that has lapsed gets a single notice, not a weekly one.

Each notice is written to grc_tpra_reminders before it is sent, under a unique
key of what it is about, who it is for and which period it belongs to. The sweep
can therefore run any number of times a day and still tell each person once per
period; and a delivery that fails leaves no row, so the next run tries again.

An expired risk acceptance is marked expired here, so it stops mitigating the
finding it covered.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ....models import (
    Role, TPRAContract, TPRAFinding, TPRAReminder, TPRARemediation, TPRARiskAcceptance,
    UserRole, Vendor, VendorQuestionnaireResponse,
)

logger = logging.getLogger(__name__)

_INACTIVE_VENDOR = ("retired", "offboarded", "inactive", "terminated")
_REMEDIATION_DONE = ("completed", "complete", "closed", "verified", "cancelled", "canceled", "done")
_WAITING_ON_VENDOR = ("pending", "in_progress")
_MAX_DAYS = 3650


# ── policy ───────────────────────────────────────────────────────────────────

def clean_policy(raw: dict, current: dict) -> dict:
    """Validate a reminder-policy patch against the current policy."""
    if not isinstance(raw, dict):
        raise ValueError("The reminder policy must be an object")
    policy = dict(current)
    for key, value in raw.items():
        if key == "enabled":
            policy[key] = bool(value)
        elif key in ("remind_before_days", "repeat_every_days", "escalate_after_days"):
            try:
                number = int(value)
            except (TypeError, ValueError):
                raise ValueError(f"{key.replace('_', ' ')} must be a whole number of days")
            low = 1 if key == "repeat_every_days" else 0
            if not low <= number <= _MAX_DAYS:
                raise ValueError(f"{key.replace('_', ' ')} must be between {low} and {_MAX_DAYS}")
            policy[key] = number
        elif key == "escalate_to":
            if not isinstance(value, list) or len(value) > 20:
                raise ValueError("Escalate to must be a list of at most 20 entries")
            targets = []
            for entry in value:
                text = " ".join(str(entry or "").split())
                if not (text.startswith("role:") and len(text) > 5) and not (
                        text.startswith("user:") and text[5:].isdigit()):
                    raise ValueError(f"'{text}' must be 'role:<role name>' or 'user:<id>'")
                targets.append(text[:120])
            policy[key] = targets
        else:
            raise ValueError(f"Unknown reminder setting '{key}'")
    return policy


# ── the rhythm ───────────────────────────────────────────────────────────────

def reminder_period(due: date, today: date, before: int, every: int,
                    once_overdue: bool = False) -> Optional[date]:
    """Which reminder period `today` falls in for a date due on `due`, or None
    when nothing is owed yet.

    Before the due date there is one period, opening `before` days ahead. After
    it, a new period starts every `every` days — or never, for things that lapse
    once (`once_overdue`), whose single period starts on the due date.
    """
    days_left = (due - today).days
    if days_left > before:
        return None
    if days_left >= 0:
        return due - timedelta(days=before)
    if once_overdue:
        return due
    step = max(int(every or 1), 1)
    return due + timedelta(days=((-days_left) // step) * step)


@dataclass
class Notice:
    kind: str
    subject_type: str
    subject_id: int
    vendor_id: Optional[int]
    due_on: date
    period: date
    overdue_days: int
    title: str
    link: str
    recipients: List[int] = field(default_factory=list)


def _day(value) -> Optional[date]:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


def _when(due: date, today: date, lapsed_word: str = "overdue") -> str:
    days = (due - today).days
    if days > 1:
        return f"due in {days} days ({due:%d %b %Y})"
    if days == 1:
        return "due tomorrow"
    if days == 0:
        return "due today"
    return f"{-days} day{'s' if days != -1 else ''} {lapsed_word}"


# ── what is owed ─────────────────────────────────────────────────────────────

def due_notices(db: Session, tenant_id: int, today: date, policy: dict) -> List[Notice]:
    before = int(policy.get("remind_before_days", 14))
    every = int(policy.get("repeat_every_days", 7))
    notices: List[Notice] = []

    def add(kind, subject_type, subject_id, vendor_id, due, title, link, recipients, once=False):
        if due is None:
            return
        period = reminder_period(due, today, before, every, once_overdue=once)
        if period is None:
            return
        notices.append(Notice(kind, subject_type, subject_id, vendor_id, due, period,
                              max(0, (today - due).days), title, link,
                              [int(r) for r in dict.fromkeys(recipients) if r]))

    vendors = {v.id: v for v in db.query(Vendor).filter(
        Vendor.tenant_id == tenant_id, Vendor.deleted_at.is_(None))}

    # 1. Reassessments falling due.
    for v in vendors.values():
        if (v.status or "").lower() in _INACTIVE_VENDOR or not v.next_reassessment_date:
            continue
        due = _day(v.next_reassessment_date)
        add("reassessment_due", "vendor", v.id, v.id, due,
            f"Reassessment of {v.name} is {_when(due, today)}",
            f"/vendor-risk/vendors/{v.id}", [v.owner_id])

    # 2. Questionnaires still waiting on the vendor.
    for qr in db.query(VendorQuestionnaireResponse).filter(
            VendorQuestionnaireResponse.tenant_id == tenant_id,
            VendorQuestionnaireResponse.status.in_(_WAITING_ON_VENDOR),
            VendorQuestionnaireResponse.expires_at.isnot(None)):
        v = vendors.get(qr.vendor_id)
        if v is None:
            continue
        due = _day(qr.expires_at)
        state = (f"expired {(today - due).days} days ago unanswered" if due < today
                 else f"still unanswered; the link expires {_when(due, today)}")
        add("questionnaire_waiting", "questionnaire", qr.id, v.id, due,
            f"Questionnaire for {v.name} is {state}",
            f"/vendor-risk/vendors/{v.id}", [v.owner_id], once=True)

    findings: Dict[int, TPRAFinding] = {}

    def finding(finding_id: int) -> Optional[TPRAFinding]:
        if finding_id not in findings:
            findings[finding_id] = db.query(TPRAFinding).filter(TPRAFinding.id == finding_id).first()
        return findings[finding_id]

    # 3. Remediation falling due.
    for r in db.query(TPRARemediation).filter(
            TPRARemediation.tenant_id == tenant_id, TPRARemediation.deleted_at.is_(None),
            TPRARemediation.due_date.isnot(None)):
        if (r.status or "").lower() in _REMEDIATION_DONE:
            continue
        f = finding(r.finding_id)
        v = vendors.get(f.vendor_id) if f else None
        due = _day(r.due_date)
        label = r.title or (f.title if f else None) or "Remediation"
        add("remediation_due", "remediation", r.id, v.id if v else None, due,
            f"Remediation '{label}'{f' for {v.name}' if v else ''} is {_when(due, today)}",
            f"/vendor-risk/vendors/{v.id}" if v else "/vendor-risk/findings",
            [r.owner_id or (v.owner_id if v else None)])

    # 4. Risk acceptances expiring. One that has lapsed is marked expired, so it
    #    stops mitigating the finding it covered.
    for a in db.query(TPRARiskAcceptance).filter(
            TPRARiskAcceptance.tenant_id == tenant_id, TPRARiskAcceptance.deleted_at.is_(None),
            TPRARiskAcceptance.status == "active", TPRARiskAcceptance.expiry.isnot(None)):
        f = finding(a.finding_id)
        v = vendors.get(f.vendor_id) if f else None
        due = _day(a.expiry)
        if due < today:
            a.status = "expired"
        add("acceptance_expiring", "acceptance", a.id, v.id if v else None, due,
            f"Risk acceptance{f' on {v.name}' if v else ''} is {_when(due, today, 'past its expiry')}",
            f"/vendor-risk/vendors/{v.id}" if v else "/vendor-risk/findings",
            [a.accepted_by, v.owner_id if v else None], once=True)

    # 5. Contracts coming up for renewal or expiry — whichever comes first.
    for c in db.query(TPRAContract).filter(
            TPRAContract.tenant_id == tenant_id, TPRAContract.deleted_at.is_(None),
            TPRAContract.status == "active"):
        dates = [d for d in (_day(c.renewal_date), _day(c.expiry_date)) if d]
        v = vendors.get(c.vendor_id)
        if not dates or v is None:
            continue
        due = min(dates)
        add("contract_expiring", "contract", c.id, v.id, due,
            f"Contract '{c.title or 'contract'}' with {v.name} is {_when(due, today, 'past its date')}",
            f"/vendor-risk/vendors/{v.id}", [v.owner_id], once=True)

    return notices


# ── who else to tell ─────────────────────────────────────────────────────────

def escalation_users(db: Session, targets: Sequence[str]) -> List[int]:
    """The people behind 'role:<name>' and 'user:<id>' entries."""
    users: List[int] = []
    for target in targets or []:
        if target.startswith("user:") and target[5:].isdigit():
            users.append(int(target[5:]))
        elif target.startswith("role:"):
            name = target[5:].strip()
            role_ids = [r.id for r in db.query(Role).filter(Role.name == name)]
            if role_ids:
                users.extend(u.user_id for u in db.query(UserRole).filter(UserRole.role_id.in_(role_ids)))
    return list(dict.fromkeys(users))


# ── telling them ─────────────────────────────────────────────────────────────

def _deliver(db: Session, tenant_id: int, user_id: int, subject: str, message: str) -> None:
    from ...workflow_engine.services.notification_service import send_workflow_notification

    send_workflow_notification(db, tenant_id=tenant_id, subject=subject[:500], message=message,
                               workflow_instance_id=None, user_ids=[user_id],
                               channels=["in_app", "email"], notification_type="reminder")


def run(db: Session, tenant_id: int, policy: dict, today: Optional[date] = None,
        deliver: Callable[[Session, int, int, str, str], None] = _deliver) -> Dict[str, int]:
    """Send every reminder owed today, once. Returns counts."""
    today = today or datetime.utcnow().date()
    counts = {"owed": 0, "sent": 0, "already_sent": 0, "failed": 0, "no_recipient": 0}
    if not policy.get("enabled", True):
        return counts
    escalate_after = int(policy.get("escalate_after_days", 14))
    escalation = escalation_users(db, policy.get("escalate_to") or [])

    for notice in due_notices(db, tenant_id, today, policy):
        counts["owed"] += 1
        people: List[Tuple[int, int]] = [(uid, 0) for uid in notice.recipients]
        if notice.overdue_days and notice.overdue_days >= escalate_after:
            people += [(uid, 1) for uid in escalation if uid not in notice.recipients]
        if not people:
            counts["no_recipient"] += 1
            continue
        message = f"{notice.title}.\n\nOpen: {notice.link}"
        for user_id, escalated in people:
            subject = f"{'Escalation: ' if escalated else ''}{notice.title}"
            try:
                with db.begin_nested():
                    db.add(TPRAReminder(
                        tenant_id=tenant_id, kind=notice.kind, subject_type=notice.subject_type,
                        subject_id=notice.subject_id, vendor_id=notice.vendor_id, recipient_id=user_id,
                        period=notice.period, escalation=escalated, due_on=notice.due_on,
                    ))
                    db.flush()
                    deliver(db, tenant_id, user_id, subject, message)
                counts["sent"] += 1
            except IntegrityError:
                counts["already_sent"] += 1        # told this person this period already
            except Exception:  # noqa: BLE001 — no row is kept, so the next run retries
                logger.exception("tprm reminder %s:%s to user %s failed",
                                 notice.subject_type, notice.subject_id, user_id)
                counts["failed"] += 1
    db.commit()
    return counts
