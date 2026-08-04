import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class EmailService:
    SMTP_HOST = os.environ.get("SMTP_HOST")
    SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
    SMTP_USER = os.environ.get("SMTP_USER")
    SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD")
    SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", "noreply@grc-platform.com")
    
    @classmethod
    def is_smtp_configured(cls) -> bool:
        return all([cls.SMTP_HOST, cls.SMTP_USER, cls.SMTP_PASSWORD])
    
    @classmethod
    def _get_base_styles(cls) -> str:
        return """
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #1e3a5f 0%, #2c5282 100%); color: white; padding: 24px; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
            .content { padding: 32px 24px; }
            .info-box { background-color: #f7fafc; border-radius: 6px; padding: 16px; margin: 16px 0; border-left: 4px solid #3182ce; }
            .info-row { display: flex; margin: 8px 0; }
            .info-label { font-weight: 600; color: #4a5568; min-width: 140px; }
            .info-value { color: #2d3748; }
            .severity-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
            .severity-critical { background-color: #fed7d7; color: #c53030; }
            .severity-high { background-color: #feebc8; color: #c05621; }
            .severity-medium { background-color: #fefcbf; color: #b7791f; }
            .severity-low { background-color: #c6f6d5; color: #276749; }
            .severity-info { background-color: #bee3f8; color: #2b6cb0; }
            .alert-box { border-radius: 6px; padding: 16px; margin: 16px 0; }
            .alert-warning { background-color: #fffaf0; border: 1px solid #ed8936; }
            .alert-danger { background-color: #fff5f5; border: 1px solid #e53e3e; }
            .alert-info { background-color: #ebf8ff; border: 1px solid #4299e1; }
            .alert-success { background-color: #f0fff4; border: 1px solid #48bb78; }
            .footer { background-color: #f7fafc; padding: 20px 24px; text-align: center; font-size: 12px; color: #718096; border-top: 1px solid #e2e8f0; }
            .btn { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #3182ce 0%, #2b6cb0 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 16px 0; }
            .btn:hover { background: linear-gradient(135deg, #2b6cb0 0%, #2c5282 100%); }
            h2 { color: #2d3748; margin-top: 0; }
            p { color: #4a5568; line-height: 1.6; }
        </style>
        """
    
    @classmethod
    def _get_severity_class(cls, severity: str) -> str:
        return f"severity-{severity.lower()}" if severity else "severity-info"
    
    @classmethod
    def _send_email(cls, to_email: str, subject: str, html_content: str) -> bool:
        if not cls.is_smtp_configured():
            logger.info(f"[EMAIL SIMULATED] To: {to_email}")
            logger.info(f"[EMAIL SIMULATED] Subject: {subject}")
            logger.info(f"[EMAIL SIMULATED] Content: Email logged (SMTP not configured)")
            return True
        
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = cls.SMTP_FROM_EMAIL
            msg["To"] = to_email
            
            text_content = f"Subject: {subject}\n\nPlease view this email in an HTML-compatible email client."
            
            part1 = MIMEText(text_content, "plain")
            part2 = MIMEText(html_content, "html")
            
            msg.attach(part1)
            msg.attach(part2)
            
            with smtplib.SMTP(cls.SMTP_HOST, cls.SMTP_PORT) as server:
                server.starttls()
                server.login(cls.SMTP_USER, cls.SMTP_PASSWORD)
                server.sendmail(cls.SMTP_FROM_EMAIL, to_email, msg.as_string())
            
            logger.info(f"[EMAIL SENT] To: {to_email}, Subject: {subject}")
            return True
        except Exception as e:
            logger.error(f"[EMAIL FAILED] To: {to_email}, Error: {str(e)}")
            return False
    
    @classmethod
    def send_assignment_notification(
        cls,
        recipient_email: str,
        recipient_name: str,
        vulnerability: Any,
        department: Any,
        assigned_by: str
    ) -> bool:
        subject = f"[GRC] Vulnerability Assigned: {vulnerability.vuln_id}"
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>{cls._get_base_styles()}</head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Vulnerability Assignment</h1>
                </div>
                <div class="content">
                    <h2>Hello {recipient_name},</h2>
                    <p>A new vulnerability has been assigned to your department for remediation.</p>
                    
                    <div class="info-box">
                        <div class="info-row">
                            <span class="info-label">Vulnerability ID:</span>
                            <span class="info-value"><strong>{vulnerability.vuln_id}</strong></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Title:</span>
                            <span class="info-value">{vulnerability.title}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Severity:</span>
                            <span class="info-value"><span class="severity-badge {cls._get_severity_class(vulnerability.severity)}">{vulnerability.severity}</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">CVSS Score:</span>
                            <span class="info-value">{vulnerability.cvss_score or 'N/A'}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Affected Component:</span>
                            <span class="info-value">{vulnerability.affected_component or 'N/A'}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Department:</span>
                            <span class="info-value">{department.name} ({department.code})</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Assigned By:</span>
                            <span class="info-value">{assigned_by}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Due Date:</span>
                            <span class="info-value">{vulnerability.due_date.strftime('%Y-%m-%d') if vulnerability.due_date else 'Not Set'}</span>
                        </div>
                    </div>
                    
                    <p>Please review this vulnerability and begin the remediation process as soon as possible.</p>
                </div>
                <div class="footer">
                    <p>This is an automated notification from the GRC Vulnerability Management System.</p>
                    <p>&copy; {datetime.now().year} GRC Platform. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        return cls._send_email(recipient_email, subject, html_content)
    
    @classmethod
    def send_sla_warning(
        cls,
        recipient_email: str,
        recipient_name: str,
        vulnerability: Any,
        days_remaining: int,
        sla_percent: float
    ) -> bool:
        subject = f"[GRC] SLA Warning: {vulnerability.vuln_id} - {sla_percent:.0f}% Consumed"
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>{cls._get_base_styles()}</head>
        <body>
            <div class="container">
                <div class="header" style="background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);">
                    <h1>⚠️ SLA Warning</h1>
                </div>
                <div class="content">
                    <h2>Hello {recipient_name},</h2>
                    
                    <div class="alert-box alert-warning">
                        <p style="margin: 0; font-weight: 600;">SLA threshold approaching!</p>
                        <p style="margin: 8px 0 0 0;">The vulnerability below has consumed <strong>{sla_percent:.0f}%</strong> of its SLA with only <strong>{days_remaining} days</strong> remaining.</p>
                    </div>
                    
                    <div class="info-box">
                        <div class="info-row">
                            <span class="info-label">Vulnerability ID:</span>
                            <span class="info-value"><strong>{vulnerability.vuln_id}</strong></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Title:</span>
                            <span class="info-value">{vulnerability.title}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Severity:</span>
                            <span class="info-value"><span class="severity-badge {cls._get_severity_class(vulnerability.severity)}">{vulnerability.severity}</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">SLA Consumed:</span>
                            <span class="info-value" style="color: #c05621; font-weight: 600;">{sla_percent:.0f}%</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Days Remaining:</span>
                            <span class="info-value" style="color: #c05621; font-weight: 600;">{days_remaining} days</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Status:</span>
                            <span class="info-value">{vulnerability.status}</span>
                        </div>
                    </div>
                    
                    <p><strong>Action Required:</strong> Please prioritize this vulnerability to avoid an SLA breach.</p>
                </div>
                <div class="footer">
                    <p>This is an automated SLA warning from the GRC Vulnerability Management System.</p>
                    <p>&copy; {datetime.now().year} GRC Platform. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        return cls._send_email(recipient_email, subject, html_content)
    
    @classmethod
    def send_sla_breach(
        cls,
        recipient_email: str,
        recipient_name: str,
        vulnerability: Any,
        days_overdue: int
    ) -> bool:
        subject = f"[GRC] 🚨 SLA BREACH: {vulnerability.vuln_id} - {days_overdue} Days Overdue"
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>{cls._get_base_styles()}</head>
        <body>
            <div class="container">
                <div class="header" style="background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%);">
                    <h1>🚨 SLA BREACH</h1>
                </div>
                <div class="content">
                    <h2>Hello {recipient_name},</h2>
                    
                    <div class="alert-box alert-danger">
                        <p style="margin: 0; font-weight: 600; color: #c53030;">CRITICAL: SLA has been breached!</p>
                        <p style="margin: 8px 0 0 0;">The vulnerability below is now <strong>{days_overdue} days overdue</strong> and requires immediate attention.</p>
                    </div>
                    
                    <div class="info-box" style="border-left-color: #e53e3e;">
                        <div class="info-row">
                            <span class="info-label">Vulnerability ID:</span>
                            <span class="info-value"><strong>{vulnerability.vuln_id}</strong></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Title:</span>
                            <span class="info-value">{vulnerability.title}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Severity:</span>
                            <span class="info-value"><span class="severity-badge {cls._get_severity_class(vulnerability.severity)}">{vulnerability.severity}</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Days Overdue:</span>
                            <span class="info-value" style="color: #c53030; font-weight: 600;">{days_overdue} days</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Status:</span>
                            <span class="info-value">{vulnerability.status}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Affected Component:</span>
                            <span class="info-value">{vulnerability.affected_component or 'N/A'}</span>
                        </div>
                    </div>
                    
                    <p style="color: #c53030; font-weight: 600;">Immediate action is required to resolve this vulnerability.</p>
                    <p>This breach has been escalated and logged in the system.</p>
                </div>
                <div class="footer">
                    <p>This is an automated SLA breach alert from the GRC Vulnerability Management System.</p>
                    <p>&copy; {datetime.now().year} GRC Platform. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        return cls._send_email(recipient_email, subject, html_content)
    
    @classmethod
    def send_escalation_notification(
        cls,
        recipient_email: str,
        recipient_name: str,
        vulnerability: Any,
        escalation_level: int,
        reason: str
    ) -> bool:
        level_names = {1: "Level 1 - Team Lead", 2: "Level 2 - Department Head", 3: "Level 3 - Executive"}
        level_name = level_names.get(escalation_level, f"Level {escalation_level}")
        
        subject = f"[GRC] Escalation Notice: {vulnerability.vuln_id} - {level_name}"
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>{cls._get_base_styles()}</head>
        <body>
            <div class="container">
                <div class="header" style="background: linear-gradient(135deg, #805ad5 0%, #6b46c1 100%);">
                    <h1>📢 Escalation Notice</h1>
                </div>
                <div class="content">
                    <h2>Hello {recipient_name},</h2>
                    
                    <div class="alert-box alert-info" style="border-color: #805ad5;">
                        <p style="margin: 0; font-weight: 600; color: #553c9a;">Vulnerability Escalated to {level_name}</p>
                        <p style="margin: 8px 0 0 0;">Reason: {reason}</p>
                    </div>
                    
                    <div class="info-box" style="border-left-color: #805ad5;">
                        <div class="info-row">
                            <span class="info-label">Vulnerability ID:</span>
                            <span class="info-value"><strong>{vulnerability.vuln_id}</strong></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Title:</span>
                            <span class="info-value">{vulnerability.title}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Severity:</span>
                            <span class="info-value"><span class="severity-badge {cls._get_severity_class(vulnerability.severity)}">{vulnerability.severity}</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Escalation Level:</span>
                            <span class="info-value" style="color: #553c9a; font-weight: 600;">{level_name}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Current Status:</span>
                            <span class="info-value">{vulnerability.status}</span>
                        </div>
                    </div>
                    
                    <p>This vulnerability has been escalated to you for immediate attention. Please review and take appropriate action.</p>
                </div>
                <div class="footer">
                    <p>This is an automated escalation notice from the GRC Vulnerability Management System.</p>
                    <p>&copy; {datetime.now().year} GRC Platform. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        return cls._send_email(recipient_email, subject, html_content)
    
    @classmethod
    def send_status_change(
        cls,
        recipient_email: str,
        recipient_name: str,
        vulnerability: Any,
        old_status: Optional[str],
        new_status: str,
        changed_by: str
    ) -> bool:
        subject = f"[GRC] Status Change: {vulnerability.vuln_id} → {new_status}"
        
        status_colors = {
            "new": "#4299e1",
            "open": "#4299e1",
            "in_progress": "#ed8936",
            "pending_review": "#805ad5",
            "resolved": "#48bb78",
            "closed": "#48bb78",
            "accepted": "#718096",
        }
        
        new_status_color = status_colors.get(new_status.lower(), "#4299e1")
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>{cls._get_base_styles()}</head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Status Update</h1>
                </div>
                <div class="content">
                    <h2>Hello {recipient_name},</h2>
                    
                    <div class="alert-box alert-success">
                        <p style="margin: 0;">Vulnerability status has been updated:</p>
                        <p style="margin: 8px 0 0 0; font-size: 16px;">
                            {f'<span style="text-decoration: line-through; color: #718096;">{old_status}</span> → ' if old_status else ''}
                            <span style="color: {new_status_color}; font-weight: 600;">{new_status}</span>
                        </p>
                    </div>
                    
                    <div class="info-box">
                        <div class="info-row">
                            <span class="info-label">Vulnerability ID:</span>
                            <span class="info-value"><strong>{vulnerability.vuln_id}</strong></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Title:</span>
                            <span class="info-value">{vulnerability.title}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Severity:</span>
                            <span class="info-value"><span class="severity-badge {cls._get_severity_class(vulnerability.severity)}">{vulnerability.severity}</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Changed By:</span>
                            <span class="info-value">{changed_by}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Changed At:</span>
                            <span class="info-value">{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</span>
                        </div>
                    </div>
                </div>
                <div class="footer">
                    <p>This is an automated status notification from the GRC Vulnerability Management System.</p>
                    <p>&copy; {datetime.now().year} GRC Platform. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        return cls._send_email(recipient_email, subject, html_content)
