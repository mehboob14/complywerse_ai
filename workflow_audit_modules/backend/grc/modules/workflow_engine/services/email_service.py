"""SMTP email helper for workflow engine notifications."""
import logging
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from ....models import WorkflowEmailConfiguration


logger = logging.getLogger(__name__)


def _mask_email(value: str) -> str:
    if not value or "@" not in value:
        return "unknown"
    local, domain = value.split("@", 1)
    if len(local) <= 2:
        return f"{local[0]}***@{domain}" if local else f"***@{domain}"
    return f"{local[:2]}***@{domain}"


def _notification_html(subject: str, body: str, cta_url: str = "", cta_label: str = "") -> str:
    cta = ""
    if cta_url and cta_label:
        cta = (
            f'<p style="margin-top:20px">'
            f'<a href="{cta_url}" style="display:inline-block;padding:10px 14px;'
            f'background:#1f4b99;color:#fff;text-decoration:none;border-radius:6px;">{cta_label}</a></p>'
        )
    return (
        "<html><body style='font-family:Arial,Helvetica,sans-serif'>"
        f"<h3>{subject}</h3>"
        f"<div>{body}</div>"
        f"{cta}"
        "<hr style='margin-top:20px;border:none;border-top:1px solid #ddd'/>"
        "<p style='color:#666;font-size:12px'>ComplyVerse Workflow Engine</p>"
        "</body></html>"
    )


def send_email(
    db,
    tenant_id: int,
    to: str,
    subject: str,
    body_html: str,
    body_text: Optional[str] = None,
) -> dict:
    """
    Send an email using the tenant's configured SMTP settings.
    Returns {"success": True/False, "message": "..."}.
    """
    settings: Optional[WorkflowEmailConfiguration] = (
        db.query(WorkflowEmailConfiguration)
        .filter(
            WorkflowEmailConfiguration.tenant_id == tenant_id,
            WorkflowEmailConfiguration.is_active == True,
        )
        .first()
    )

    if not settings:
        # Fall back to environment variables (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, etc.)
        env_host = os.environ.get("SMTP_HOST", "")
        env_user = os.environ.get("SMTP_USER", "")
        env_pass = os.environ.get("SMTP_PASSWORD", "")
        env_from = os.environ.get("SMTP_FROM_EMAIL", env_user)
        env_port = int(os.environ.get("SMTP_PORT", "587") or "587")

        if env_host and env_user and env_pass:
            logger.info(
                "workflow.email.send.using_env_fallback tenant_id=%s to=%s",
                tenant_id,
                _mask_email(to),
            )
            # Build a temporary settings-like object from env vars
            class _EnvSettings:
                smtp_host = env_host
                smtp_port = env_port
                smtp_username = env_user
                smtp_password = env_pass
                from_email = env_from
                from_name = "ComplyVerse"
                use_tls = env_port != 465
            settings = _EnvSettings()  # type: ignore[assignment]
        else:
            logger.warning(
                "workflow.email.send.skipped no_active_smtp_config tenant_id=%s to=%s",
                tenant_id,
                _mask_email(to),
            )
            return {"success": False, "message": "Email settings not configured for this tenant"}

    from_addr = settings.from_email or "noreply@complyverse.app"
    from_name = settings.from_name or "ComplyVerse"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_addr}>"
    msg["To"] = to

    if body_text:
        msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    logger.info(
        "workflow.email.send.start tenant_id=%s to=%s subject=%s smtp_host=%s smtp_port=%s use_tls=%s",
        tenant_id,
        _mask_email(to),
        subject,
        settings.smtp_host,
        settings.smtp_port,
        bool(settings.use_tls),
    )

    try:
        if settings.use_tls:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.sendmail(from_addr, [to], msg.as_string())
        else:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=context, timeout=15) as server:
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.sendmail(from_addr, [to], msg.as_string())

        logger.info(
            "workflow.email.send.success tenant_id=%s to=%s subject=%s",
            tenant_id,
            _mask_email(to),
            subject,
        )
        return {"success": True, "message": f"Email sent to {to}"}

    except smtplib.SMTPAuthenticationError:
        logger.error(
            "workflow.email.send.failed auth tenant_id=%s to=%s smtp_host=%s",
            tenant_id,
            _mask_email(to),
            settings.smtp_host,
        )
        return {"success": False, "message": "SMTP authentication failed — check username/password"}
    except smtplib.SMTPConnectError as e:
        logger.error(
            "workflow.email.send.failed connect tenant_id=%s to=%s smtp_host=%s error=%s",
            tenant_id,
            _mask_email(to),
            settings.smtp_host,
            e,
        )
        return {"success": False, "message": f"Could not connect to SMTP server: {e}"}
    except Exception as e:
        logger.exception(
            "workflow.email.send.failed tenant_id=%s to=%s subject=%s",
            tenant_id,
            _mask_email(to),
            subject,
        )
        return {"success": False, "message": str(e)}


def send_bulk_email(db, tenant_id: int, recipients: list, subject: str, body_html: str) -> list:
    """Send to multiple recipients, return per-recipient results."""
    logger.info(
        "workflow.email.bulk.start tenant_id=%s recipients=%s subject=%s",
        tenant_id,
        len(recipients or []),
        subject,
    )
    results = [
        send_email(db, tenant_id, r, subject, body_html)
        for r in recipients
    ]
    success_count = len([r for r in results if r.get("success")])
    logger.info(
        "workflow.email.bulk.done tenant_id=%s recipients=%s success=%s failed=%s",
        tenant_id,
        len(recipients or []),
        success_count,
        (len(recipients or []) - success_count),
    )
    return results
