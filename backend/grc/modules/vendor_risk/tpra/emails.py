"""The emails third-party risk sends, in the tenant's own words.

Five of them: the questionnaire invitation and the reminder a supplier receives,
the reminder and the escalation our people receive as a date nears or passes,
and the note that an attention item was assigned to someone. Each has built-in
wording, which is what went out before any of this was editable. A tenant can
change the subject and body, see it filled in with sample values before saving,
send it to themselves, and go back to the built-in wording.

Wording uses named placeholders in braces — {vendor}, {link} and the like, listed
for each email. Only an email's own placeholders are accepted, so a typo is
caught when it is saved rather than sent to a supplier, and the supplier emails
must keep {link}, without which the supplier could not reach the questionnaire.
Values are escaped in the HTML version and links made clickable.
"""
from __future__ import annotations

import html
import re
from datetime import datetime
from typing import Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import GRCUser, TPRAEmailTemplate, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from . import rbac, service

router = APIRouter(tags=["Vendor emails"])

CATALOGUE: Dict[str, dict] = {
    "questionnaire_invite": {
        "label": "Questionnaire invitation", "audience": "Supplier",
        "when": "A questionnaire is sent to a supplier's contact.",
        "placeholders": {"vendor": "The supplier's name", "link": "The link to the questionnaire",
                         "due": "When it is due, e.g. 'on 30 Oct 2026' or 'as soon as you can'",
                         "organisation": "Our organisation's name"},
        "required": ("link",),
        "subject": "Security questionnaire for {vendor}",
        "body": "Hello,\n\nPlease complete the security assessment questionnaire for {vendor}. It is due {due}.\n\n"
                "Open the questionnaire: {link}\n\nThank you,\n{organisation}",
        "sample": {"vendor": "Payroll Co", "link": "https://grc.example.com/vendor-risk/questionnaires/abc123",
                   "due": "on 30 Oct 2026", "organisation": "Acme Bank"},
    },
    "questionnaire_reminder": {
        "label": "Questionnaire reminder", "audience": "Supplier",
        "when": "A questionnaire is still unanswered as its due date nears, or after it passes; or it is sent again.",
        "placeholders": {"title": "What the reminder is about, in one sentence", "vendor": "The supplier's name",
                         "link": "The link to the questionnaire", "when": "When it is due, or how late it is",
                         "organisation": "Our organisation's name"},
        "required": ("link",),
        "subject": "{title}",
        "body": "{title}.\n\nOpen the questionnaire: {link}",
        "sample": {"title": "Reminder: the questionnaire for Payroll Co, due in 3 days", "vendor": "Payroll Co",
                   "link": "https://grc.example.com/vendor-risk/questionnaires/abc123", "when": "due in 3 days",
                   "organisation": "Acme Bank"},
    },
    "reminder": {
        "label": "Reminder to our people", "audience": "Our people",
        "when": "A reassessment, remediation, acceptance, contract, check-in or waiver date nears or passes.",
        "placeholders": {"title": "What is due, in one sentence", "link": "Where to act", "vendor": "The supplier's name"},
        "required": (),
        "subject": "{title}",
        "body": "{title}.\n\nOpen: {link}",
        "sample": {"title": "Contract 'MSA' with Payroll Co is due in 14 days (10 Oct 2026)",
                   "link": "https://grc.example.com/vendor-risk/contracts?contract=12", "vendor": "Payroll Co"},
    },
    "escalation": {
        "label": "Escalation", "audience": "Our people",
        "when": "Something is overdue past the escalation point, to the people named in the reminder settings.",
        "placeholders": {"title": "What is overdue, in one sentence", "link": "Where to act", "vendor": "The supplier's name",
                         "days_overdue": "How many days overdue"},
        "required": (),
        "subject": "Escalation: {title}",
        "body": "{title}.\n\nOpen: {link}",
        "sample": {"title": "Remediation 'Enable MFA' for Payroll Co is 16 days overdue",
                   "link": "https://grc.example.com/vendor-risk/vendors/3", "vendor": "Payroll Co", "days_overdue": "16"},
    },
    "attention_assigned": {
        "label": "Attention item assigned", "audience": "Our people",
        "when": "Someone assigns an item in the attention queue to a colleague.",
        "placeholders": {"title": "The item", "link": "Where to act", "vendor": "The supplier's name",
                         "assigned_by": "Who assigned it"},
        "required": (),
        "subject": "Assigned to you: {title}",
        "body": "{title}.\n\nOpen: {link}",
        "sample": {"title": "Payroll Co: questionnaire to review", "link": "https://grc.example.com/vendor-risk/attention",
                   "vendor": "Payroll Co", "assigned_by": "Ana Lyst"},
    },
}
_FIELD = re.compile(r"\{([a-z_]+)\}")
_URL = re.compile(r"(https?://[^\s<]+)")


def check(key: str, subject: str, body: str) -> Tuple[str, str]:
    """Cleaned wording, or ValueError saying what to fix."""
    spec = CATALOGUE[key]
    subject, body = " ".join((subject or "").split()), (body or "").replace("\r\n", "\n").strip()
    if not subject or len(subject) > 200:
        raise ValueError("The subject must be one line of at most 200 characters")
    if not body or len(body) > 5000:
        raise ValueError("The body must be between 1 and 5,000 characters")
    unknown = sorted({f for f in _FIELD.findall(subject + " " + body)} - set(spec["placeholders"]))
    if unknown:
        raise ValueError(f"{{{unknown[0]}}} is not one of this email's placeholders")
    missing = [f for f in spec["required"] if f"{{{f}}}" not in body]
    if missing:
        raise ValueError(f"The body must keep {{{missing[0]}}}, or the supplier cannot reach the questionnaire")
    return subject, body


def _fill(text: str, values: Dict[str, str], escape: bool) -> str:
    return _FIELD.sub(lambda m: (html.escape(str(values.get(m.group(1), ""))) if escape else str(values.get(m.group(1), "")))
                      if m.group(1) in values else m.group(0), text)


def to_html(body: str, values: Dict[str, str]) -> str:
    escaped = _fill(html.escape(body), values, escape=True)
    linked = _URL.sub(lambda m: f'<a href="{m.group(1)}">{m.group(1)}</a>', escaped)
    return "".join(f"<p>{p.replace(chr(10), '<br>')}</p>" for p in linked.split("\n\n") if p.strip())


def wording(db: Session, tenant_id: int, key: str) -> Tuple[str, str, Optional[TPRAEmailTemplate]]:
    row = db.query(TPRAEmailTemplate).filter(TPRAEmailTemplate.tenant_id == tenant_id, TPRAEmailTemplate.key == key).first()
    spec = CATALOGUE[key]
    return (row.subject, row.body, row) if row is not None else (spec["subject"], spec["body"], None)


def fill(subject: str, body: str, values: Dict[str, object]) -> Tuple[str, str, str]:
    values = {k: "" if v is None else str(v) for k, v in values.items()}
    return (_fill(subject, values, escape=False)[:500], _fill(body, values, escape=False), to_html(body, values))


def render(db: Session, tenant_id: int, key: str, values: Dict[str, object]) -> Tuple[str, str, str]:
    """(subject, text, html) for one email, in the tenant's wording."""
    subject, body, _ = wording(db, tenant_id, key)
    return fill(subject, body, values)


class Wordings:
    """The tenant's wording for each email, read once for a whole sweep."""

    def __init__(self, db: Session, tenant_id: int):
        self.db, self.tenant_id, self.seen = db, tenant_id, {}

    def render(self, key: str, values: Dict[str, object]) -> Tuple[str, str, str]:
        if key not in self.seen:
            self.seen[key] = wording(self.db, self.tenant_id, key)[:2]
        return fill(*self.seen[key], values)


# ── REST ─────────────────────────────────────────────────────────────────────

def _tid(user: GRCUser, db: Session) -> int:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids[0]


def _key(key: str) -> str:
    if key not in CATALOGUE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such email")
    return key


def _row(db: Session, tid: int, key: str) -> dict:
    spec = CATALOGUE[key]
    subject, body, row = wording(db, tid, key)
    who = db.get(GRCUser, row.updated_by) if row is not None and row.updated_by else None
    return {"key": key, "label": spec["label"], "audience": spec["audience"], "when": spec["when"],
            "placeholders": spec["placeholders"], "required": list(spec["required"]), "subject": subject, "body": body,
            "default_subject": spec["subject"], "default_body": spec["body"], "changed": row is not None,
            "updated_at": row.updated_at if row is not None else None,
            "updated_by": (who.display_name or who.username or who.email) if who else None}


@router.get("/email-templates")
def list_templates(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tid(user, db)
    return {"items": [_row(db, tid, k) for k in CATALOGUE]}


class WordingIn(BaseModel):
    subject: str = Field(..., max_length=400)
    body: str = Field(..., max_length=10000)


@router.post("/email-templates/{key}/preview")
def preview(key: str, body: WordingIn, user: GRCUser = Depends(require_auth)):
    spec = CATALOGUE[_key(key)]
    try:
        subject, text = check(key, body.subject, body.body)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return {"subject": _fill(subject, spec["sample"], escape=False), "text": _fill(text, spec["sample"], escape=False),
            "html": to_html(text, spec["sample"])}


@router.put("/email-templates/{key}")
def save(key: str, body: WordingIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tid(user, db)
    rbac.require_write(db, user, "vendors", "edit")
    _key(key)
    try:
        subject, text = check(key, body.subject, body.body)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    _, _, row = wording(db, tid, key)
    if row is None:
        row = TPRAEmailTemplate(tenant_id=tid, key=key)
        db.add(row)
    row.subject, row.body, row.updated_by, row.updated_at = subject, text, user.id, datetime.utcnow()
    service.write_audit(db, tid, entity="email_template", action="update", actor_id=user.id, to_value=key, reason=subject)
    db.commit()
    return _row(db, tid, key)


@router.delete("/email-templates/{key}")
def reset(key: str, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Back to the built-in wording."""
    tid = _tid(user, db)
    rbac.require_write(db, user, "vendors", "edit")
    _key(key)
    _, _, row = wording(db, tid, key)
    if row is not None:
        db.delete(row)
        service.write_audit(db, tid, entity="email_template", action="reset", actor_id=user.id, to_value=key)
        db.commit()
    return _row(db, tid, key)


@router.post("/email-templates/{key}/test")
def send_test(key: str, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The saved wording, with sample values, to the person asking."""
    from ...workflow_engine.services.email_service import send_email

    tid = _tid(user, db)
    spec = CATALOGUE[_key(key)]
    if not user.email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your account has no email address to send the test to")
    subject, text, body_html = render(db, tid, key, spec["sample"])
    result = send_email(db, tid, user.email, f"[Test] {subject}", body_html, text)
    if not result.get("success"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, result.get("message") or "Email is not set up for this organisation")
    return {"sent_to": user.email}
