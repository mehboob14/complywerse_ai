"""SMTP transport for scheduled reports: one message WITH a file attachment.

Why this exists: neither existing email service can attach a file.
workflow_engine/services/email_service.send_email and
vuln_management/services/email_service.EmailService both build a
MIMEMultipart("alternative") of text + html only. Rather than edit either, this
module REUSES their configuration sources and adds the attachment. SMTP settings
are resolved in this order (first usable wins):

  1. the tenant's active WorkflowEmailConfiguration   (what workflow send_email reads)
  2. SMTP_HOST / SMTP_USER / SMTP_PASSWORD / SMTP_FROM_EMAIL / SMTP_PORT env
                                                      (the same fallback workflow uses)
  3. the Help Desk's default outgoing mailbox         (helpdesk_native.mail._default_outgoing)

TLS semantics are the same as theirs: use_tls -> STARTTLS on `port`, otherwise
implicit SSL (SMTP_SSL). When nothing is configured nothing is sent and the caller
gets {"success": False, ...} - never a silent "simulated" success, so the UI can
tell the user the report did not go out.
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from dataclasses import dataclass
from email import encoders
from email.header import Header
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

SMTP_TIMEOUT_SECONDS = 30
NOT_CONFIGURED_MESSAGE = (
    "Email is not configured for this workspace, so nothing was sent. Set up SMTP under "
    "Help Desk > Settings > Email (or provide the SMTP_* environment settings) and run it again."
)


@dataclass
class SmtpSettings:
    host: str
    port: int
    username: str
    password: str
    from_email: str
    from_name: str
    use_tls: bool          # True = STARTTLS on `port`; False = implicit SSL (SMTP_SSL)
    source: str            # "tenant" | "env" | "helpdesk"


def _mask(value: str) -> str:
    """Log-safe form of an email address (same idea as workflow's _mask_email)."""
    if not value or "@" not in value:
        return "unknown"
    local, domain = value.split("@", 1)
    return f"{local[:2]}***@{domain}" if len(local) > 2 else f"{local[:1]}***@{domain}"


def _plain_secret(value: Optional[str]) -> Optional[str]:
    """A stored password in clear. Workflow configs store plaintext, Help Desk
    mailboxes store enc:v1 ciphertext; None means "present but undecryptable"."""
    if not value:
        return ""
    try:
        from grc.crypto import decrypt_secret, is_encrypted
        return decrypt_secret(value) if is_encrypted(value) else value
    except Exception:  # noqa: BLE001 - e.g. SESSION_SECRET rotated
        logger.warning("report_scheduler.mailer: stored SMTP password could not be decrypted")
        return None


def resolve_smtp(db: Session, tenant_id: int) -> Optional[SmtpSettings]:
    """The SMTP settings a scheduled report will be sent with, or None."""
    # 1) tenant-configured workflow SMTP
    cfg = None
    try:
        from grc.models import WorkflowEmailConfiguration
        cfg = (
            db.query(WorkflowEmailConfiguration)
            .filter(
                WorkflowEmailConfiguration.tenant_id == tenant_id,
                WorkflowEmailConfiguration.is_active == True,  # noqa: E712
            )
            .order_by(WorkflowEmailConfiguration.id.asc())
            .first()
        )
    except Exception:  # noqa: BLE001 - a missing table must not poison the session
        db.rollback()
    if cfg is not None and cfg.smtp_host:
        pw = _plain_secret(cfg.smtp_password)
        if pw is not None:
            return SmtpSettings(
                host=cfg.smtp_host,
                port=int(cfg.smtp_port or 587),
                username=cfg.smtp_username or "",
                password=pw,
                from_email=cfg.from_email or "noreply@ava.app",
                from_name=cfg.from_name or "ComplyVerse",
                use_tls=bool(cfg.use_tls),
                source="tenant",
            )

    # 2) environment fallback (identical rule to workflow send_email: all three required)
    env_host = os.environ.get("SMTP_HOST", "")
    env_user = os.environ.get("SMTP_USER", "")
    env_pass = os.environ.get("SMTP_PASSWORD", "")
    if env_host and env_user and env_pass:
        try:
            env_port = int(os.environ.get("SMTP_PORT", "587") or "587")
        except ValueError:
            env_port = 587
        return SmtpSettings(
            host=env_host,
            port=env_port,
            username=env_user,
            password=env_pass,
            from_email=os.environ.get("SMTP_FROM_EMAIL") or env_user,
            from_name="ComplyVerse",
            use_tls=env_port != 465,
            source="env",
        )

    # 3) the Help Desk's default outgoing mailbox
    try:
        from grc.modules.helpdesk_native.mail import _default_outgoing
        acc = _default_outgoing(db, tenant_id)
    except Exception:  # noqa: BLE001
        db.rollback()
        acc = None
    if acc is not None and acc.smtp_host:
        pw = _plain_secret(acc.smtp_password)
        if pw is not None:
            use_tls = bool(acc.smtp_use_tls)
            return SmtpSettings(
                host=acc.smtp_host,
                port=int(acc.smtp_port or (587 if use_tls else 465)),
                username=acc.smtp_user or "",
                password=pw,
                from_email=acc.email_id or acc.smtp_user or "noreply@ava.app",
                from_name=acc.from_name or "ComplyVerse",
                use_tls=use_tls,
                source="helpdesk",
            )
    return None


def email_status(db: Session, tenant_id: int) -> Dict[str, Any]:
    """Is outbound email usable? (never exposes credentials)"""
    smtp = resolve_smtp(db, tenant_id)
    if smtp is None:
        return {"configured": False, "source": None, "from_email": None}
    return {"configured": True, "source": smtp.source, "from_email": smtp.from_email}


def _login(server: smtplib.SMTP, smtp: SmtpSettings) -> None:
    if smtp.username and smtp.password:
        server.login(smtp.username, smtp.password)


def send_with_attachment(
    smtp: SmtpSettings,
    recipients: List[str],
    subject: str,
    text: str,
    html: str,
    filename: str,
    data: bytes,
    mimetype: str,
) -> Dict[str, Any]:
    """Send ONE message (all recipients on the To line, a single copy of the
    attachment). Returns {"success", "message", "refused"}; never raises for
    transport problems."""
    recipients = [r for r in (recipients or []) if r]
    if not recipients:
        return {"success": False, "message": "There are no recipients to send to.", "refused": {}}

    envelope_from = parseaddr(smtp.from_email)[1] or smtp.from_email
    subject = " ".join((subject or "").split())          # one line: no header injection via CR/LF
    msg = MIMEMultipart("mixed")
    try:
        subject.encode("ascii")
        msg["Subject"] = subject                          # plain header when it can stay plain
    except UnicodeEncodeError:
        msg["Subject"] = Header(subject, "utf-8")         # RFC 2047 only when needed
    msg["From"] = formataddr((smtp.from_name or "", envelope_from))
    msg["To"] = ", ".join(recipients)
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain=(envelope_from.split("@", 1)[1] if "@" in envelope_from else None))

    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text, "plain", "utf-8"))
    alt.attach(MIMEText(html, "html", "utf-8"))
    msg.attach(alt)

    maintype, _, subtype = (mimetype or "application/octet-stream").partition("/")
    part = MIMEBase(maintype or "application", subtype or "octet-stream")
    part.set_payload(data)
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", "attachment", filename=filename)
    msg.attach(part)
    raw = msg.as_string()

    logger.info(
        "report_scheduler.email.start source=%s host=%s port=%s tls=%s recipients=%d bytes=%d",
        smtp.source, smtp.host, smtp.port, smtp.use_tls, len(recipients), len(data),
    )
    try:
        if smtp.use_tls:
            with smtplib.SMTP(smtp.host, smtp.port, timeout=SMTP_TIMEOUT_SECONDS) as server:
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
                _login(server, smtp)
                refused = server.sendmail(envelope_from, recipients, raw)
        else:
            with smtplib.SMTP_SSL(
                smtp.host, smtp.port, context=ssl.create_default_context(), timeout=SMTP_TIMEOUT_SECONDS
            ) as server:
                _login(server, smtp)
                refused = server.sendmail(envelope_from, recipients, raw)
    except smtplib.SMTPAuthenticationError:
        logger.error("report_scheduler.email.failed auth host=%s", smtp.host)
        return {"success": False, "message": "The mail server rejected the SMTP username/password.", "refused": {}}
    except smtplib.SMTPRecipientsRefused as exc:
        refused = {addr: f"{code} {msg_.decode('utf-8', 'replace') if isinstance(msg_, bytes) else msg_}"
                   for addr, (code, msg_) in (exc.recipients or {}).items()}
        logger.error("report_scheduler.email.failed all_recipients_refused n=%d", len(refused))
        return {"success": False, "message": "The mail server refused every recipient address.", "refused": refused}
    except smtplib.SMTPSenderRefused:
        logger.error("report_scheduler.email.failed sender_refused from=%s", _mask(envelope_from))
        return {"success": False, "message": f"The mail server refused the sender address {envelope_from}.", "refused": {}}
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
        logger.error("report_scheduler.email.failed host=%s err=%s", smtp.host, exc)
        return {"success": False, "message": f"Could not send the email: {exc}", "refused": {}}

    refused_out = {
        addr: f"{code} {msg_.decode('utf-8', 'replace') if isinstance(msg_, bytes) else msg_}"
        for addr, (code, msg_) in (refused or {}).items()
    }
    sent_n = len(recipients) - len(refused_out)
    message = f"Sent to {sent_n} recipient{'s' if sent_n != 1 else ''}."
    if refused_out:
        message += f" Refused: {', '.join(sorted(refused_out))}."
    logger.info("report_scheduler.email.success sent=%d refused=%d", sent_n, len(refused_out))
    return {"success": True, "message": message, "refused": refused_out}
