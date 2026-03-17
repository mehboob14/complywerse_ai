"""SMTP email helper for workflow engine notifications."""
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from ....models import WorkflowEmailConfiguration


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

        return {"success": True, "message": f"Email sent to {to}"}

    except smtplib.SMTPAuthenticationError:
        return {"success": False, "message": "SMTP authentication failed — check username/password"}
    except smtplib.SMTPConnectError as e:
        return {"success": False, "message": f"Could not connect to SMTP server: {e}"}
    except Exception as e:
        return {"success": False, "message": str(e)}


def send_bulk_email(db, tenant_id: int, recipients: list, subject: str, body_html: str) -> list:
    """Send to multiple recipients, return per-recipient results."""
    return [
        send_email(db, tenant_id, r, subject, body_html)
        for r in recipients
    ]
