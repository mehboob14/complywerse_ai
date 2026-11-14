"""Native Help Desk EMAIL — inbound (IMAP) + outbound (SMTP).

Code conversion of Frappe Helpdesk's email LOGIC (which rode the Frappe framework's
Email Account + IMAP poller + `frappe.sendmail`) onto ComplyVerse's own stdlib SMTP/IMAP.
Source logic recovered from the fork (see git `2493ab1^`):

  * outbound  — `hd_ticket.py`: send_acknowledgement_email / reply_via_agent /
                send_reply_email_to_agent / handle_email_feedback, each rendering a
                template from HD Settings (falling back to the baked-in defaults in
                `hd_settings/helpers.py`) and calling `frappe.sendmail`. Gated by
                HD Settings skip_email_workflow / instantly_send_email / the per-
                template enable_* flags.  ->  here: `send()` + the `notify_*` hooks.
  * inbound   — `overrides/email_account.py`: poll the IMAP mailbox whose IMAP
                folder `append_to = HD Ticket`, skip machine mail that would start a
                loop (`auto_generated_reason`), and turn each message into a ticket
                or a reply.  ->  here: `poll()`.
  * feedback  — `hd_email_feedback.py`: the guest landing the CSAT link points at,
                authenticated by the ticket's `key` uuid.  ->  the /email/feedback
                endpoints.

SAFE WITHOUT CREDENTIALS (the whole point of local-only): `send()` and `poll()`
first resolve a configured account; with none, or one missing its host, they return
a no-op result and never open a socket. The `notify_*` hooks call `send()`, so a
help desk with no mailbox configured runs exactly as before.

Thread stitching: Frappe matched inbound replies to a ticket via the core
Communication's Message-ID (In-Reply-To / References headers). The native
Communication store (_60, not editable here) has no message_id column, so outbound
subjects carry a `[#<id>]` reference token and inbound reads it back — the standard
help-desk subject-token convention.
# ponytail: subject-token threading, not Message-ID. Upgrade path: add a
# message_id column to HDCommunication and match headers, when _60 is editable.
"""
from __future__ import annotations

import email as _email
import imaplib
import logging
import os
import re
import smtplib
import ssl
import uuid
from email.header import decode_header, make_header
from email.message import Message
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import parseaddr
from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...crypto import decrypt_secret, encrypt_secret
from ...models import HDEmailAccount, HDSettings, HDTicket, get_db
from . import tickets
from .audit import hd_audit
from .common import current_user_email, require_settings_manage, require_settings_view, tenant_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/helpdesk", tags=["Help Desk (native) — Email"])


# ─── templates (hd_settings/helpers.py get_default_email_content) ────────────
# The four Frappe defaults, verbatim. A tenant may override each via the matching
# HD Settings *_content column; a blank override falls back to these.
DEFAULT_TEMPLATES = {
    "acknowledgement": """\
<p>Hi,</p>
<br />
<p>Thank you for reaching out to us. We've received your request and created a support ticket.</p>
<p>
    <strong>Ticket ID:</strong> {{ doc.name }}<br />
    <strong>Subject:</strong> {{ doc.subject }}<br />
</p>
<p>Our team is reviewing it and will get back to you shortly.</p>
<br />
<p>Best,<br />Support Team</p>
""",
    "reply_to_agents": """\
<div>
  <p>Hello,</p>
  <p>You have a new reply on the ticket <strong>#{{ doc.name }}</strong>.</p>
  <p><strong>Subject:</strong> {{ doc.subject }}</p>
  <p><strong>Raised By:</strong> {{ doc.raised_by }}</p>
  <p><strong>Priority:</strong> {{ doc.priority }}</p>
   <div style="margin-bottom: 10px">
    <p style="margin-bottom: 20px">Message</p>
    <div style="background: #f3f5f8; padding: 10px; border-radius: 4px; border: 1px solid #e5e9ee;">
      {{ message }}
    </div>
  </div>
  <br />
  <p>You can view and respond to this ticket by <a href="{{ ticket_url }}">clicking here</a>.</p>
  <p>Regards,<br />Support Team</p>
</div>
""",
    "reply_via_agent": """\
<div>
  <h2><strong>Ticket #{{ doc.name }}</strong></h2>
  <h3>You have a new reply on this ticket</h3>
  <br />
  <div style="margin-bottom: 10px">
    <h3 style="margin-bottom: 20px">Message</h3>
    <div style="background: #f3f5f8; padding: 10px; border-radius: 4px; border: 1px solid #e5e9ee;">
      {{ message }}
    </div>
  </div>
  <p>Please visit the customer portal to reply to this message</p>
  <a href="{{ ticket_url }}" rel="noopener noreferrer" target="_blank">View in Portal</a>
  <br />
</div>
""",
    "share_feedback": """\
<p>Hello,</p>
<p>Thanks for reaching out to us. We'd love your feedback on your recent support experience with ticket #{{ doc.name }}.</p>
<a href="{{ url }}">Share Feedback</a>
<p>Thank you!<br>Support Team</p>""",
}

_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")


def render(content: Optional[str], kind: str, context: dict) -> str:
    """Frappe `_get_rendered_template`: use the override unless blank, else the
    default, then substitute the placeholders. Only the fixed set the four
    templates use (`{{ doc.X }}`, `{{ url }}`, `{{ message }}`, `{{ ticket_url }}`)
    is supported — no loops/conditionals, so no Jinja and no autoescape surprise on
    the raw-HTML `message`.
    # ponytail: flat {{ var }} substitution. Swap in Jinja (already installed) only
    # if templates ever need logic.
    """
    tpl = content if (content and content.strip()) else DEFAULT_TEMPLATES.get(kind, "")

    def sub(m: "re.Match") -> str:
        key = m.group(1)
        if key.startswith("doc."):
            return str((context.get("doc") or {}).get(key[4:], "") or "")
        return str(context.get(key, "") or "")

    return _PLACEHOLDER.sub(sub, tpl)


def _doc(ticket: HDTicket) -> dict:
    """The `doc` the templates read (Frappe passed the whole ticket as_dict)."""
    return {
        "name": str(ticket.id),
        "subject": ticket.subject or "",
        "raised_by": ticket.raised_by or "",
        "priority": (ticket.priority.name or ticket.priority.level) if ticket.priority else "",
    }


# ─── account store ───────────────────────────────────────────────────────────
_SECRET_FIELDS = ("smtp_password", "imap_password")


def account_dict(acc: HDEmailAccount) -> dict:
    """Serialize an account WITHOUT ever revealing a stored password (the UI only
    needs to know whether one is set)."""
    return {
        "id": acc.id,
        "name": acc.name,
        "email_id": acc.email_id,
        "from_name": acc.from_name,
        "enable_incoming": bool(acc.enable_incoming),
        "enable_outgoing": bool(acc.enable_outgoing),
        "default_outgoing": bool(acc.default_outgoing),
        "smtp_host": acc.smtp_host,
        "smtp_port": acc.smtp_port,
        "smtp_user": acc.smtp_user,
        "smtp_use_tls": bool(acc.smtp_use_tls),
        "has_smtp_password": bool(acc.smtp_password),
        "imap_host": acc.imap_host,
        "imap_port": acc.imap_port,
        "imap_user": acc.imap_user,
        "imap_use_ssl": bool(acc.imap_use_ssl),
        "imap_folder": acc.imap_folder,
        "has_imap_password": bool(acc.imap_password),
        "last_polled_at": acc.last_polled_at.isoformat() if acc.last_polled_at else None,
    }


_WRITABLE = {
    "name", "email_id", "from_name", "enable_incoming", "enable_outgoing",
    "default_outgoing", "smtp_host", "smtp_port", "smtp_user", "smtp_use_tls",
    "imap_host", "imap_port", "imap_user", "imap_use_ssl", "imap_folder",
}


def _apply(db: Session, tid: int, acc: HDEmailAccount, data: dict) -> None:
    """Set writable columns; encrypt the two password fields on write (empty/absent
    password leaves the stored one untouched — the UI never re-sends it)."""
    for k, v in data.items():
        if k in _WRITABLE:
            setattr(acc, k, v)
    for f in _SECRET_FIELDS:
        if data.get(f):
            setattr(acc, f, encrypt_secret(data[f]))
    # only one default_outgoing per tenant
    if data.get("default_outgoing"):
        db.query(HDEmailAccount).filter(
            HDEmailAccount.tenant_id == tid, HDEmailAccount.id != acc.id
        ).update({"default_outgoing": False}, synchronize_session=False)


def _default_outgoing(db: Session, tid: int) -> Optional[HDEmailAccount]:
    """The sender for ticket notifications: the default_outgoing account, else the
    first outgoing-enabled one (Frappe `default_outgoing_email_account`)."""
    q = db.query(HDEmailAccount).filter(
        HDEmailAccount.tenant_id == tid, HDEmailAccount.enable_outgoing == True  # noqa: E712
    )
    return q.filter(HDEmailAccount.default_outgoing == True).first() or q.first()  # noqa: E712


# ─── outbound (smtplib) ──────────────────────────────────────────────────────
def _tag_subject(subject: str, ticket_id) -> str:
    """Append the reference token inbound reads back (thread stitching)."""
    tok = f"[#{ticket_id}]"
    return subject if tok in subject else f"{subject} {tok}"


def send(db: Session, tid: int, recipients: List[str], subject: str, html: str,
         ticket_id=None, headers: Optional[dict] = None) -> dict:
    """Send one mail through the tenant's default outgoing account.

    GUARDED NO-OP: with no outgoing account configured (or one missing its SMTP
    host), nothing is sent and no socket opens — returns {"sent": False, ...}. A
    send failure is caught and returned, never raised, so a notification can never
    break the ticket operation that triggered it.
    """
    recipients = [r for r in (recipients or []) if r]
    if not recipients:
        return {"sent": False, "reason": "no_recipients"}

    acc = _default_outgoing(db, tid)
    if not acc or not acc.smtp_host:
        return {"sent": False, "reason": "no_account"}

    if ticket_id is not None:
        subject = _tag_subject(subject, ticket_id)

    from_addr = acc.email_id or acc.smtp_user or "noreply@helpdesk.local"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{acc.from_name} <{from_addr}>" if acc.from_name else from_addr
    msg["To"] = ", ".join(recipients)
    for k, v in (headers or {}).items():
        msg[k] = v
    msg.attach(MIMEText(html, "html", "utf-8"))

    password = decrypt_secret(acc.smtp_password) or ""
    port = acc.smtp_port or (587 if acc.smtp_use_tls else 465)
    try:
        if acc.smtp_use_tls:
            with smtplib.SMTP(acc.smtp_host, port, timeout=15) as s:
                s.ehlo()
                s.starttls(context=ssl.create_default_context())
                s.ehlo()
                if acc.smtp_user:
                    s.login(acc.smtp_user, password)
                s.sendmail(from_addr, recipients, msg.as_string())
        else:
            with smtplib.SMTP_SSL(acc.smtp_host, port,
                                  context=ssl.create_default_context(), timeout=15) as s:
                if acc.smtp_user:
                    s.login(acc.smtp_user, password)
                s.sendmail(from_addr, recipients, msg.as_string())
        return {"sent": True, "recipients": recipients}
    except Exception as e:  # noqa: BLE001 — never let a mail failure escape
        logger.warning("helpdesk.mail.send_failed tenant=%s err=%s", tid, e)
        return {"sent": False, "error": str(e)}


def _settings(db: Session, tid: int) -> Optional[HDSettings]:
    return db.query(HDSettings).filter(HDSettings.tenant_id == tid).first()


def _portal_url(path: str) -> str:
    base = (os.environ.get("HELPDESK_PORTAL_URL") or "").rstrip("/")
    return f"{base}{path}"


# ─── notifications (the ticket hooks call these) ─────────────────────────────
def notify_acknowledgement(db: Session, tid: int, ticket: HDTicket) -> dict:
    """hd_ticket.send_acknowledgement_email — on create, gated by HD Settings
    send_acknowledgement_email. Recipient = the raiser. X-Auto-Generated so our own
    looped-back copy is dropped by the inbound guard."""
    st = _settings(db, tid)
    if not st or not st.send_acknowledgement_email or st.skip_email_workflow:
        return {"sent": False, "reason": "disabled"}
    html = render(st.acknowledgement_email_content, "acknowledgement", {"doc": _doc(ticket)})
    return send(db, tid, [ticket.raised_by], f"Ticket #{ticket.id}: We've received your request",
                html, ticket_id=ticket.id, headers={"X-Auto-Generated": "hd-acknowledgement"})


def notify_reply_via_agent(db: Session, tid: int, ticket: HDTicket, message: str) -> dict:
    """hd_ticket.reply_via_agent — on an agent's public reply, gated by
    enable_reply_email_via_agent (and skip_email_workflow). Recipient = the
    customer (raised_by)."""
    st = _settings(db, tid)
    if not st or st.skip_email_workflow or not st.enable_reply_email_via_agent:
        return {"sent": False, "reason": "disabled"}
    ctx = {"doc": _doc(ticket), "message": message or "",
           "ticket_url": _portal_url(f"/helpdesk/tickets/{ticket.id}")}
    html = render(st.reply_via_agent_email_content, "reply_via_agent", ctx)
    return send(db, tid, [ticket.raised_by], f"Re: {ticket.subject}", html, ticket_id=ticket.id)


def notify_reply_to_agents(db: Session, tid: int, ticket: HDTicket, message: str) -> dict:
    """hd_ticket.send_reply_email_to_agent — on a customer reply, gated by
    enable_reply_email_to_agent. Recipients = the assigned agent(s)."""
    st = _settings(db, tid)
    if not st or not st.enable_reply_email_to_agent:
        return {"sent": False, "reason": "disabled"}
    if not ticket.assigned_agent:
        return {"sent": False, "reason": "no_agent"}
    ctx = {"doc": _doc(ticket), "message": message or "",
           "ticket_url": _portal_url(f"/helpdesk/tickets/{ticket.id}")}
    html = render(st.reply_email_to_agent_content, "reply_to_agents", ctx)
    return send(db, tid, [ticket.assigned_agent],
                f"Re: {ticket.subject} - #{ticket.id}", html, ticket_id=ticket.id)


def notify_feedback(db: Session, tid: int, ticket: HDTicket) -> dict:
    """hd_ticket.handle_email_feedback — on the status reaching the configured
    feedback status, gated by enable_email_ticket_feedback. Emails the raiser the
    CSAT link authenticated by the ticket's `key` uuid (minted here if missing)."""
    st = _settings(db, tid)
    if not st or not st.enable_email_ticket_feedback:
        return {"sent": False, "reason": "disabled"}
    if ticket.feedback_rating:  # already rated — Frappe skips
        return {"sent": False, "reason": "already_rated"}
    if not ticket.key:
        ticket.key = uuid.uuid4().hex
        db.flush()
    url = _portal_url(f"/ticket-feedback/new?key={ticket.key}")
    html = render(st.feedback_email_content, "share_feedback", {"doc": _doc(ticket), "url": url})
    return send(db, tid, [ticket.raised_by], f"Re: {ticket.subject}", html,
                ticket_id=ticket.id, headers={"X-Auto-Generated": "hd-email-feedback"})


def feedback_status_matches(db: Session, tid: int, new_status) -> bool:
    """Frappe `handle_email_feedback` gate: the new status equals HD Settings
    send_email_feedback_on_status, or that is unset and the status is Closed."""
    st = _settings(db, tid)
    if not st or not st.enable_email_ticket_feedback or new_status is None:
        return False
    if st.send_email_feedback_on_status_id:
        return new_status.id == st.send_email_feedback_on_status_id
    return (new_status.label_agent or "") == "Closed"


# ─── inbound (imaplib) ───────────────────────────────────────────────────────
_REF_TOKEN = re.compile(r"\[#(\d+)\]")
_LOOSE_TOKEN = re.compile(r"#(\d+)")


def auto_generated_reason(msg: Message) -> Optional[str]:
    """overrides/email_account.auto_generated_reason: why this mail must NOT become
    a ticket/reply (it would start a mail loop), else None. Bounces + auto-replies
    are machine mail; our own acknowledgement carries X-Auto-Generated."""
    if msg.get("X-Auto-Generated"):
        return "X-Auto-Generated"
    if (msg.get_content_type() == "multipart/report"
            and (msg.get_param("report-type") or "") == "delivery-status"):
        return "delivery status notification"
    if (msg.get("Return-Path") or "").strip() == "<>":
        return "null return-path"
    auto = (msg.get("Auto-Submitted") or "no").split(";")[0].strip().lower()
    if auto not in ("no", "auto-replied"):
        return f"Auto-Submitted: {auto}"
    return None


def _decode(value: Optional[str]) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:  # noqa: BLE001
        return value


def _body(msg: Message) -> str:
    """Plain-text body if present, else the HTML part, else the flat payload."""
    html = None
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            if "attachment" in disp:
                continue
            try:
                payload = part.get_payload(decode=True)
            except Exception:  # noqa: BLE001
                continue
            if payload is None:
                continue
            text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            if ctype == "text/plain":
                return text
            if ctype == "text/html" and html is None:
                html = text
        return html or ""
    payload = msg.get_payload(decode=True)
    if payload is None:
        return str(msg.get_payload() or "")
    return payload.decode(msg.get_content_charset() or "utf-8", errors="replace")


def _ticket_id_from_subject(subject: str) -> Optional[int]:
    m = _REF_TOKEN.search(subject) or _LOOSE_TOKEN.search(subject)
    return int(m.group(1)) if m else None


def _ingest_message(db: Session, tid: int, raw: bytes) -> Optional[str]:
    """Turn one raw RFC822 message into a ticket or a reply (Frappe InboundMail →
    append_to HD Ticket). Returns the ticket name, or None if skipped."""
    msg = _email.message_from_bytes(raw)
    reason = auto_generated_reason(msg)
    if reason:
        logger.info("helpdesk.mail.skip reason=%s", reason)
        return None

    subject = _decode(msg.get("Subject")) or "(no subject)"
    sender = parseaddr(msg.get("From") or "")[1] or None
    body = _body(msg)

    ref_id = _ticket_id_from_subject(subject)
    if ref_id is not None:
        existing = db.query(HDTicket).filter(
            HDTicket.id == ref_id, HDTicket.tenant_id == tid
        ).first()
        if existing:
            # reply to an existing ticket (reopen + Received Communication + notify agents)
            res = tickets.receive_customer_reply(db, tid, str(ref_id), body, sender=sender)
            return res.get("name")

    # no match → a brand-new ticket (its acknowledgement hook fires on create)
    res = tickets.create_ticket(db, tid, {"subject": subject, "description": body},
                                raised_by=sender)
    return res.get("name")


def poll(db: Session, tid: int) -> dict:
    """Fetch UNSEEN mail from every inbound-enabled account and ingest it.

    GUARDED NO-OP: no inbound account (or one missing its IMAP host) ⇒ nothing is
    fetched and no socket opens. Per-message failures are logged and skipped so one
    malformed mail can't abort the batch (Frappe's try/except + log_error)."""
    accounts = db.query(HDEmailAccount).filter(
        HDEmailAccount.tenant_id == tid, HDEmailAccount.enable_incoming == True  # noqa: E712
    ).all()
    accounts = [a for a in accounts if a.imap_host]
    if not accounts:
        return {"polled": 0, "created": 0, "reason": "no_account"}

    created = 0
    for acc in accounts:
        password = decrypt_secret(acc.imap_password) or ""
        port = acc.imap_port or 993
        try:
            if acc.imap_use_ssl:
                conn = imaplib.IMAP4_SSL(acc.imap_host, port,
                                         ssl_context=ssl.create_default_context())
            else:
                conn = imaplib.IMAP4(acc.imap_host, port)
            try:
                conn.login(acc.imap_user or "", password)
                conn.select(acc.imap_folder or "INBOX")
                typ, data = conn.search(None, "UNSEEN")
                if typ != "OK":
                    continue
                for num in (data[0].split() if data and data[0] else []):
                    typ, msg_data = conn.fetch(num, "(RFC822)")
                    if typ != "OK" or not msg_data or not msg_data[0]:
                        continue
                    raw = msg_data[0][1]
                    try:
                        if _ingest_message(db, tid, raw):
                            created += 1
                    except Exception as e:  # noqa: BLE001 — skip one bad mail, keep going
                        db.rollback()
                        logger.warning("helpdesk.mail.ingest_failed tenant=%s err=%s", tid, e)
            finally:
                try:
                    conn.logout()
                except Exception:  # noqa: BLE001
                    pass
        except Exception as e:  # noqa: BLE001 — connection/login failure for this account
            logger.warning("helpdesk.mail.poll_failed tenant=%s acc=%s err=%s", tid, acc.id, e)
            continue
        from datetime import datetime
        acc.last_polled_at = datetime.utcnow()
    db.commit()
    return {"polled": len(accounts), "created": created}


# ═══════════════════════════════════════════════════════════════════════════
# ROUTES — the main session mounts `router`.
# ═══════════════════════════════════════════════════════════════════════════
class EmailAccountBody(BaseModel):
    name: str
    email_id: Optional[str] = None
    from_name: Optional[str] = None
    enable_incoming: bool = False
    enable_outgoing: bool = False
    default_outgoing: bool = False
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None   # plaintext on the wire; stored encrypted. Blank = keep existing.
    smtp_use_tls: bool = True
    imap_host: Optional[str] = None
    imap_port: Optional[int] = 993
    imap_user: Optional[str] = None
    imap_password: Optional[str] = None   # blank = keep existing
    imap_use_ssl: bool = True
    imap_folder: Optional[str] = "INBOX"


class FeedbackBody(BaseModel):
    key: str
    rating: float
    extra: Optional[str] = None


@router.get("/email-accounts")
def list_accounts(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    tid = tenant_id(db)
    rows = db.query(HDEmailAccount).filter(HDEmailAccount.tenant_id == tid).all()
    return {"accounts": [account_dict(a) for a in rows]}


@router.post("/email-accounts")
def create_account(body: EmailAccountBody, request: Request, db: Session = Depends(get_db),
                   actor: str = Depends(current_user_email),
                   _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    data = body.model_dump()
    acc = HDEmailAccount(tenant_id=tid)
    db.add(acc)
    db.flush()
    _apply(db, tid, acc, data)
    db.commit()
    db.refresh(acc)
    # audit (H3): mailbox config + credential change — field names/ids only, never the secret (M2 PII)
    hd_audit(
        db, tenant_id=tid, actor_email=actor,
        action="helpdesk.email_account.create", entity="hd_email_account",
        entity_id=acc.id,
        after={
            "email_id": acc.email_id, "smtp_host": acc.smtp_host, "imap_host": acc.imap_host,
            "smtp_password_set": bool(data.get("smtp_password")),
            "imap_password_set": bool(data.get("imap_password")),
            "enable_incoming": bool(acc.enable_incoming),
            "enable_outgoing": bool(acc.enable_outgoing),
            "default_outgoing": bool(acc.default_outgoing),
        },
        request=request,
    )
    return account_dict(acc)


@router.put("/email-accounts/{account_id}")
def update_account(account_id: int, body: EmailAccountBody, request: Request,
                   db: Session = Depends(get_db),
                   actor: str = Depends(current_user_email),
                   _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    acc = db.query(HDEmailAccount).filter(
        HDEmailAccount.id == account_id, HDEmailAccount.tenant_id == tid).first()
    if not acc:
        return {"ok": False, "error": "not found"}
    before = {
        "email_id": acc.email_id, "smtp_host": acc.smtp_host, "imap_host": acc.imap_host,
        "enable_incoming": bool(acc.enable_incoming),
        "enable_outgoing": bool(acc.enable_outgoing),
        "default_outgoing": bool(acc.default_outgoing),
    }
    data = body.model_dump()
    _apply(db, tid, acc, data)
    db.commit()
    db.refresh(acc)
    # audit (H3): mailbox config + credential change — never log the secret itself (M2 PII)
    hd_audit(
        db, tenant_id=tid, actor_email=actor,
        action="helpdesk.email_account.update", entity="hd_email_account",
        entity_id=acc.id, before=before,
        after={
            "email_id": acc.email_id, "smtp_host": acc.smtp_host, "imap_host": acc.imap_host,
            "enable_incoming": bool(acc.enable_incoming),
            "enable_outgoing": bool(acc.enable_outgoing),
            "default_outgoing": bool(acc.default_outgoing),
            "smtp_password_changed": bool(data.get("smtp_password")),
            "imap_password_changed": bool(data.get("imap_password")),
        },
        request=request,
    )
    return account_dict(acc)


@router.delete("/email-accounts/{account_id}")
def delete_account(account_id: int, request: Request, db: Session = Depends(get_db),
                   actor: str = Depends(current_user_email),
                   _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    db.query(HDEmailAccount).filter(
        HDEmailAccount.id == account_id, HDEmailAccount.tenant_id == tid
    ).delete(synchronize_session=False)
    db.commit()
    # audit (H3): mailbox config removal
    hd_audit(
        db, tenant_id=tid, actor_email=actor,
        action="helpdesk.email_account.delete", entity="hd_email_account",
        entity_id=account_id, request=request,
    )
    return {"ok": True}


@router.post("/email-accounts/{account_id}/test")
def test_connection(account_id: int, db: Session = Depends(get_db),
                    _: bool = Depends(require_settings_manage)):
    """Attempt an SMTP and/or IMAP login with the stored credentials. Safe no-op
    (reports unconfigured) when a half has no host. Never raises."""
    tid = tenant_id(db)
    acc = db.query(HDEmailAccount).filter(
        HDEmailAccount.id == account_id, HDEmailAccount.tenant_id == tid).first()
    if not acc:
        return {"ok": False, "error": "not found"}

    out: dict = {"smtp": None, "imap": None}
    if acc.smtp_host:
        try:
            port = acc.smtp_port or (587 if acc.smtp_use_tls else 465)
            if acc.smtp_use_tls:
                with smtplib.SMTP(acc.smtp_host, port, timeout=15) as s:
                    s.ehlo(); s.starttls(context=ssl.create_default_context()); s.ehlo()
                    if acc.smtp_user:
                        s.login(acc.smtp_user, decrypt_secret(acc.smtp_password) or "")
            else:
                with smtplib.SMTP_SSL(acc.smtp_host, port,
                                      context=ssl.create_default_context(), timeout=15) as s:
                    if acc.smtp_user:
                        s.login(acc.smtp_user, decrypt_secret(acc.smtp_password) or "")
            out["smtp"] = {"ok": True}
        except Exception as e:  # noqa: BLE001
            out["smtp"] = {"ok": False, "error": str(e)}
    if acc.imap_host:
        try:
            port = acc.imap_port or 993
            conn = (imaplib.IMAP4_SSL(acc.imap_host, port,
                                      ssl_context=ssl.create_default_context())
                    if acc.imap_use_ssl else imaplib.IMAP4(acc.imap_host, port))
            try:
                conn.login(acc.imap_user or "", decrypt_secret(acc.imap_password) or "")
                conn.select(acc.imap_folder or "INBOX")
                out["imap"] = {"ok": True}
            finally:
                try:
                    conn.logout()
                except Exception:  # noqa: BLE001
                    pass
        except Exception as e:  # noqa: BLE001
            out["imap"] = {"ok": False, "error": str(e)}
    return {"ok": True, **out}


@router.post("/email/poll")
def manual_poll(db: Session = Depends(get_db), _: bool = Depends(require_settings_manage)):
    """Fetch new mail now. Safe no-op (polled=0) with no inbound account."""
    return poll(db, tenant_id(db))


# ─── CSAT feedback landing (hd_email_feedback) — guest-safe, key-authenticated ──
@router.get("/email/feedback")
def feedback_page(key: str, db: Session = Depends(get_db)):
    """What the CSAT link lands on: the ticket behind the key + whether it's already
    rated. No RBAC — the uuid key IS the authentication (Frappe guest form). Never
    4xx (contract §E) — a bad key returns {"ticket": null}."""
    tid = tenant_id(db)
    ticket = db.query(HDTicket).filter(
        HDTicket.tenant_id == tid, HDTicket.key == key).first() if (tid and key) else None
    if not ticket:
        return {"ticket": None}
    return {
        "ticket": {"name": str(ticket.id), "subject": ticket.subject},
        "already_rated": bool(ticket.feedback_rating),
    }


@router.post("/email/feedback")
def submit_feedback(body: FeedbackBody, db: Session = Depends(get_db)):
    """hd_email_feedback: validate the key → ticket, reject a second submission,
    write the rating/free-text and close the ticket. Guest-safe (key-authenticated)."""
    tid = tenant_id(db)
    ticket = db.query(HDTicket).filter(
        HDTicket.tenant_id == tid, HDTicket.key == body.key).first() if (tid and body.key) else None
    if not ticket:
        return {"ok": False, "error": "invalid key"}
    if ticket.feedback_rating:
        return {"ok": False, "error": "already submitted"}
    ticket.feedback_rating = body.rating
    ticket.feedback_extra = body.extra
    db.flush()
    tickets.set_status(db, tid, str(ticket.id), "Closed")  # commits
    return {"ok": True, "name": str(ticket.id)}


# ─── self-check (ponytail: one runnable check for the non-trivial logic) ─────
def _selfcheck() -> None:
    # template render: override wins, blank falls back to default, placeholders fill
    out = render(None, "acknowledgement", {"doc": {"name": "7", "subject": "VPN"}})
    assert "Ticket ID:</strong> 7" in out and "VPN" in out, out
    assert render("  ", "acknowledgement", {"doc": {"name": "9", "subject": "x"}}).find("9") > 0
    assert render("hi {{ message }}", "reply_via_agent", {"message": "<b>yo</b>"}) == "hi <b>yo</b>"
    # subject token round-trips
    assert _tag_subject("Re: Hello", 42) == "Re: Hello [#42]"
    assert _ticket_id_from_subject("Re: Hello [#42]") == 42
    assert _ticket_id_from_subject("Ticket #13: got it") == 13
    assert _ticket_id_from_subject("no number here") is None
    # loop guard
    ack = _email.message_from_string("X-Auto-Generated: hd-acknowledgement\n\nhi")
    assert auto_generated_reason(ack) == "X-Auto-Generated"
    human = _email.message_from_string("From: a@b.com\nSubject: help\n\nhi")
    assert auto_generated_reason(human) is None
    # body extraction prefers text/plain
    mp = _email.message_from_string(
        "Content-Type: multipart/alternative; boundary=b\n\n"
        "--b\nContent-Type: text/plain\n\nplain body\n--b\n"
        "Content-Type: text/html\n\n<p>html</p>\n--b--\n")
    assert _body(mp).strip() == "plain body", _body(mp)
    print("mail self-check OK")


if __name__ == "__main__":
    _selfcheck()
