import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Iterable


class WorkflowEmailService:
    SMTP_HOST = os.environ.get("SMTP_HOST")
    SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
    SMTP_USER = os.environ.get("SMTP_USER")
    SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD")
    SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", "noreply@grc-platform.com")

    @classmethod
    def is_configured(cls) -> bool:
        return bool(cls.SMTP_HOST and cls.SMTP_USER and cls.SMTP_PASSWORD)

    @classmethod
    def send_email(cls, recipients: Iterable[str], subject: str, body: str) -> dict:
        recipient_list = sorted({str(r).strip() for r in (recipients or []) if r})
        if not recipient_list:
            return {"sent": False, "reason": "no_recipients", "recipient_count": 0}

        if not cls.is_configured():
            return {"sent": False, "reason": "smtp_not_configured", "recipient_count": len(recipient_list)}

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = cls.SMTP_FROM_EMAIL
        msg["To"] = ", ".join(recipient_list)
        msg.attach(MIMEText(body or "", "html"))

        try:
            with smtplib.SMTP(cls.SMTP_HOST, cls.SMTP_PORT) as server:
                server.starttls()
                server.login(cls.SMTP_USER, cls.SMTP_PASSWORD)
                server.sendmail(cls.SMTP_FROM_EMAIL, recipient_list, msg.as_string())
            return {"sent": True, "reason": None, "recipient_count": len(recipient_list)}
        except Exception as exc:
            return {"sent": False, "reason": str(exc), "recipient_count": len(recipient_list)}
