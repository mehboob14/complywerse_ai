import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from grc.models import (
    Vulnerability,
    VulnerabilitySLAConfig,
    GRCUser,
)

from .analytics_service import SCANNER_SOURCES

logger = logging.getLogger(__name__)

DEFAULT_SLA_DAYS = {
    "critical": 7,
    "high": 30,
    "medium": 90,
    "low": 180,
    "info": 365,
}


class SLAIntegrationService:

    @staticmethod
    def get_sla_days(db: Session, tenant_id: int, severity: str) -> int:
        config = db.query(VulnerabilitySLAConfig).filter(
            VulnerabilitySLAConfig.tenant_id == tenant_id,
            VulnerabilitySLAConfig.severity == severity.lower(),
            VulnerabilitySLAConfig.is_active == True,
        ).first()
        if config:
            return config.remediation_days
        return DEFAULT_SLA_DAYS.get(severity.lower(), 90)

    @staticmethod
    def assign_sla_deadline(db: Session, vuln: Vulnerability):
        severity = (vuln.compliverse_severity or vuln.severity or "medium").lower()
        sla_days = SLAIntegrationService.get_sla_days(db, vuln.tenant_id, severity)
        discovery = vuln.first_detected or vuln.discovered_at or vuln.created_at or datetime.utcnow()
        vuln.due_date = discovery + timedelta(days=sla_days)
        vuln.updated_at = datetime.utcnow()

    @staticmethod
    def assign_sla_for_synced_vulns(
        db: Session,
        tenant_id: int,
        connection_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        query = db.query(Vulnerability).filter(
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.source.in_(SCANNER_SOURCES),
            Vulnerability.due_date.is_(None),
            Vulnerability.status.in_(["open", "under_review", "in_remediation"]),
        )
        if connection_id:
            query = query.filter(Vulnerability.connection_id == connection_id)

        vulns = query.all()
        assigned = 0

        for vuln in vulns:
            SLAIntegrationService.assign_sla_deadline(db, vuln)
            assigned += 1

        db.commit()
        return {"total_missing": len(vulns), "assigned": assigned}

    @staticmethod
    def check_sla_breaches(
        db: Session,
        tenant_id: int,
    ) -> Dict[str, Any]:
        now = datetime.utcnow()
        warning_threshold = now + timedelta(days=3)

        open_statuses = ("open", "under_review", "in_remediation")
        vulns = db.query(Vulnerability).filter(
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.source.in_(SCANNER_SOURCES),
            Vulnerability.status.in_(open_statuses),
            Vulnerability.due_date.isnot(None),
        ).all()

        breached = []
        warning = []
        on_track = []

        for vuln in vulns:
            if vuln.due_date <= now:
                breached.append(SLAIntegrationService._vuln_summary(vuln, "breached"))
            elif vuln.due_date <= warning_threshold:
                warning.append(SLAIntegrationService._vuln_summary(vuln, "warning"))
            else:
                on_track.append(vuln.id)

        return {
            "total_tracked": len(vulns),
            "breached_count": len(breached),
            "warning_count": len(warning),
            "on_track_count": len(on_track),
            "breached": breached,
            "warning": warning,
        }

    @staticmethod
    def run_sla_notifications(
        db: Session,
        tenant_id: int,
    ) -> Dict[str, Any]:
        from grc.modules.vuln_management.services.escalation_service import EscalationService
        from grc.modules.vuln_management.services.notification_service import NotificationService
        from grc.modules.vuln_management.services.email_service import EmailService

        now = datetime.utcnow()
        warning_threshold = now + timedelta(days=3)

        open_statuses = ("open", "under_review", "in_remediation")
        vulns = db.query(Vulnerability).filter(
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.source.in_(SCANNER_SOURCES),
            Vulnerability.status.in_(open_statuses),
            Vulnerability.due_date.isnot(None),
        ).all()

        warnings_sent = 0
        breaches_sent = 0

        for vuln in vulns:
            if not vuln.assigned_to:
                continue

            assignee = db.query(GRCUser).filter(GRCUser.id == vuln.assigned_to).first()
            if not assignee:
                continue

            if vuln.due_date <= now:
                try:
                    NotificationService.create_sla_breach_notification(db, vuln, assignee)
                    if assignee.email:
                        EmailService.send_sla_breach(
                            to_email=assignee.email,
                            user_name=assignee.display_name or assignee.username,
                            vuln_id=vuln.vuln_id,
                            title=vuln.title or "Untitled",
                            severity=vuln.compliverse_severity or vuln.severity or "medium",
                            due_date=vuln.due_date,
                            days_overdue=(now - vuln.due_date).days,
                        )
                    breaches_sent += 1
                except Exception as e:
                    logger.error(f"Error sending SLA breach notification for vuln {vuln.id}: {e}")

            elif vuln.due_date <= warning_threshold:
                try:
                    NotificationService.create_sla_warning_notification(db, vuln, assignee)
                    if assignee.email:
                        EmailService.send_sla_warning(
                            to_email=assignee.email,
                            user_name=assignee.display_name or assignee.username,
                            vuln_id=vuln.vuln_id,
                            title=vuln.title or "Untitled",
                            severity=vuln.compliverse_severity or vuln.severity or "medium",
                            due_date=vuln.due_date,
                            days_remaining=(vuln.due_date - now).days,
                        )
                    warnings_sent += 1
                except Exception as e:
                    logger.error(f"Error sending SLA warning for vuln {vuln.id}: {e}")

        return {"warnings_sent": warnings_sent, "breaches_sent": breaches_sent}

    @staticmethod
    def _vuln_summary(vuln: Vulnerability, sla_status: str) -> Dict[str, Any]:
        now = datetime.utcnow()
        return {
            "id": vuln.id,
            "vuln_id": vuln.vuln_id,
            "title": vuln.title,
            "severity": vuln.compliverse_severity or vuln.severity,
            "status": vuln.status,
            "due_date": vuln.due_date.isoformat() if vuln.due_date else None,
            "days_overdue": (now - vuln.due_date).days if vuln.due_date and vuln.due_date <= now else 0,
            "days_remaining": (vuln.due_date - now).days if vuln.due_date and vuln.due_date > now else 0,
            "sla_status": sla_status,
            "assigned_to": vuln.assigned_to,
        }
