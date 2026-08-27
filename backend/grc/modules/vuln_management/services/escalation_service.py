import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session, joinedload

from ....models import (
    Vulnerability, VulnerabilitySLAConfig, GRCVulnWorkflowEscalation,
    GRCVulnWorkflowTemplate, GRCVulnEscalationLog, GRCVulnWorkflowHistory,
    GRCVulnWorkflowState, GRCDepartment, GRCUser, GRCDepartmentEscalationPath,
    GRCDepartmentMember, GRCVulnerabilityDepartmentAssignment
)
from .notification_service import NotificationService
from .email_service import EmailService

logger = logging.getLogger(__name__)


class EscalationService:
    DEFAULT_SLA = {
        "critical": 7,
        "high": 30,
        "medium": 90,
        "low": 180,
        "info": 365
    }
    
    @staticmethod
    def get_sla_days(db: Session, tenant_id: int, severity: str) -> int:
        sla = db.query(VulnerabilitySLAConfig).filter(
            VulnerabilitySLAConfig.tenant_id == tenant_id,
            VulnerabilitySLAConfig.severity == severity,
            VulnerabilitySLAConfig.is_active == True
        ).first()
        
        if sla:
            return sla.remediation_days
        return EscalationService.DEFAULT_SLA.get(severity, 90)
    
    @staticmethod
    def calculate_sla_percentage(
        discovered_at: datetime,
        sla_days: int
    ) -> float:
        days_open = (datetime.utcnow() - discovered_at).days
        if sla_days <= 0:
            return 100.0
        return (days_open / sla_days) * 100
    
    @staticmethod
    def get_days_open(discovered_at: datetime) -> int:
        return (datetime.utcnow() - discovered_at).days
    
    @staticmethod
    def check_escalation_already_triggered(
        db: Session,
        vulnerability_id: int,
        escalation_rule_id: int
    ) -> bool:
        existing = db.query(GRCVulnEscalationLog).filter(
            GRCVulnEscalationLog.vulnerability_id == vulnerability_id,
            GRCVulnEscalationLog.escalation_rule_id == escalation_rule_id
        ).first()
        return existing is not None
    
    @staticmethod
    def get_escalation_target(
        db: Session,
        department: GRCDepartment,
        target_role: str
    ) -> Optional[Dict[str, Any]]:
        if target_role == "lead":
            lead_member = db.query(GRCDepartmentMember).filter(
                GRCDepartmentMember.department_id == department.id,
                GRCDepartmentMember.role == "lead",
                GRCDepartmentMember.is_active == True
            ).first()
            if lead_member and lead_member.user:
                return {
                    "user_id": lead_member.user_id,
                    "user": lead_member.user,
                    "email_enabled": lead_member.email_notifications_enabled
                }
        
        elif target_role == "head":
            if department.department_head_user_id and department.department_head:
                head_member = db.query(GRCDepartmentMember).filter(
                    GRCDepartmentMember.department_id == department.id,
                    GRCDepartmentMember.user_id == department.department_head_user_id,
                    GRCDepartmentMember.is_active == True
                ).first()
                email_enabled = head_member.email_notifications_enabled if head_member else True
                return {
                    "user_id": department.department_head_user_id,
                    "user": department.department_head,
                    "email_enabled": email_enabled
                }
        
        elif target_role == "parent_dept_head":
            if department.parent_department_id:
                parent_dept = db.query(GRCDepartment).filter(
                    GRCDepartment.id == department.parent_department_id
                ).first()
                if parent_dept and parent_dept.department_head_user_id and parent_dept.department_head:
                    parent_head_member = db.query(GRCDepartmentMember).filter(
                        GRCDepartmentMember.department_id == parent_dept.id,
                        GRCDepartmentMember.user_id == parent_dept.department_head_user_id,
                        GRCDepartmentMember.is_active == True
                    ).first()
                    email_enabled = parent_head_member.email_notifications_enabled if parent_head_member else True
                    return {
                        "user_id": parent_dept.department_head_user_id,
                        "user": parent_dept.department_head,
                        "email_enabled": email_enabled,
                        "department": parent_dept
                    }
        
        return None
    
    @staticmethod
    def process_department_escalation(
        db: Session,
        vulnerability: Vulnerability,
        department: GRCDepartment,
        escalation_path: GRCDepartmentEscalationPath,
        sla_percentage: float,
        days_open: int,
        sla_days: int
    ) -> Optional[Dict[str, Any]]:
        target = EscalationService.get_escalation_target(db, department, escalation_path.target_role)
        
        if not target:
            logger.warning(f"No escalation target found for department {department.id} role {escalation_path.target_role}")
            return None
        
        existing_log = db.query(GRCVulnEscalationLog).filter(
            GRCVulnEscalationLog.vulnerability_id == vulnerability.id,
            GRCVulnEscalationLog.escalated_to_user_id == target["user_id"],
            GRCVulnEscalationLog.escalated_to_department_id == department.id
        ).first()
        
        if existing_log:
            return None
        
        days_overdue = max(0, days_open - sla_days) if sla_percentage >= 100 else 0
        days_remaining = max(0, sla_days - days_open)
        
        reason = f"SLA at {sla_percentage:.0f}% (threshold: {escalation_path.sla_threshold_percent}%)"
        if sla_percentage >= 100:
            reason = f"SLA breached - {days_overdue} days overdue"
        
        escalation_log = GRCVulnEscalationLog(
            vulnerability_id=vulnerability.id,
            escalation_rule_id=None,
            escalated_to_department_id=department.id,
            escalated_to_user_id=target["user_id"],
            notification_sent=True,
            notes=f"Level {escalation_path.escalation_level} escalation to {escalation_path.target_role}: {reason}"
        )
        db.add(escalation_log)
        
        try:
            if sla_percentage >= 100:
                NotificationService.create_sla_breach_notification(
                    db, vulnerability, days_overdue
                )
            else:
                NotificationService.create_sla_warning_notification(
                    db, vulnerability, sla_percentage, days_remaining
                )
        except Exception as e:
            logger.error(f"Failed to create notification: {e}")
        
        if target.get("email_enabled", True):
            try:
                user = target["user"]
                if sla_percentage >= 100:
                    EmailService.send_sla_breach(
                        recipient_email=user.email,
                        recipient_name=user.display_name,
                        vulnerability=vulnerability,
                        days_overdue=days_overdue
                    )
                    EmailService.send_escalation_notification(
                        recipient_email=user.email,
                        recipient_name=user.display_name,
                        vulnerability=vulnerability,
                        escalation_level=escalation_path.escalation_level,
                        reason=reason
                    )
                else:
                    EmailService.send_sla_warning(
                        recipient_email=user.email,
                        recipient_name=user.display_name,
                        vulnerability=vulnerability,
                        days_remaining=days_remaining,
                        sla_percent=sla_percentage
                    )
                    EmailService.send_escalation_notification(
                        recipient_email=user.email,
                        recipient_name=user.display_name,
                        vulnerability=vulnerability,
                        escalation_level=escalation_path.escalation_level,
                        reason=reason
                    )
            except Exception as e:
                logger.error(f"Failed to send escalation email: {e}")
        
        return {
            "vulnerability_id": vulnerability.id,
            "vuln_id": vulnerability.vuln_id,
            "department_id": department.id,
            "department_name": department.name,
            "escalation_level": escalation_path.escalation_level,
            "target_role": escalation_path.target_role,
            "escalated_to_user_id": target["user_id"],
            "escalated_to_user_name": target["user"].display_name if target.get("user") else None,
            "sla_percentage": sla_percentage,
            "days_open": days_open,
            "sla_threshold": escalation_path.sla_threshold_percent,
            "reason": reason,
            "email_sent": target.get("email_enabled", True)
        }
    
    @staticmethod
    def run_sla_check(
        db: Session,
        tenant_ids: List[int],
        send_emails: bool = True
    ) -> Dict[str, Any]:
        # Full terminal set — SLA warnings must never fire on findings already
        # fixed (remediated/verified), auto-closed by the scanner engine, or
        # closed with the asset.
        terminal_statuses = [
            "resolved", "remediated", "verified", "closed",
            "accepted", "false_positive", "auto_closed_decommissioned",
            "auto_closed_fixed",
        ]
        
        vulnerabilities = db.query(Vulnerability).options(
            joinedload(Vulnerability.assignee)
        ).filter(
            Vulnerability.tenant_id.in_(tenant_ids),
            Vulnerability.status.notin_(terminal_statuses)
        ).all()
        
        results = {
            "total_checked": len(vulnerabilities),
            "warnings_sent": 0,
            "breaches_detected": 0,
            "escalations_triggered": 0,
            "emails_sent": 0,
            "vulnerabilities_affected": [],
            "details": []
        }
        
        for vuln in vulnerabilities:
            if not vuln.discovered_at:
                continue
            
            sla_days = EscalationService.get_sla_days(db, vuln.tenant_id, vuln.severity)
            sla_percentage = EscalationService.calculate_sla_percentage(vuln.discovered_at, sla_days)
            days_open = EscalationService.get_days_open(vuln.discovered_at)
            days_remaining = max(0, sla_days - days_open)
            days_overdue = max(0, days_open - sla_days)
            
            dept_assignments = db.query(GRCVulnerabilityDepartmentAssignment).options(
                joinedload(GRCVulnerabilityDepartmentAssignment.department)
            ).filter(
                GRCVulnerabilityDepartmentAssignment.vulnerability_id == vuln.id
            ).all()
            
            for assignment in dept_assignments:
                department = assignment.department
                if not department or not department.is_active:
                    continue
                
                escalation_paths = db.query(GRCDepartmentEscalationPath).filter(
                    GRCDepartmentEscalationPath.department_id == department.id
                ).order_by(GRCDepartmentEscalationPath.escalation_level).all()
                
                for path in escalation_paths:
                    if sla_percentage >= path.sla_threshold_percent and path.auto_escalate:
                        result = EscalationService.process_department_escalation(
                            db=db,
                            vulnerability=vuln,
                            department=department,
                            escalation_path=path,
                            sla_percentage=sla_percentage,
                            days_open=days_open,
                            sla_days=sla_days
                        )
                        
                        if result:
                            results["escalations_triggered"] += 1
                            if result.get("email_sent"):
                                results["emails_sent"] += 1
                            if vuln.id not in results["vulnerabilities_affected"]:
                                results["vulnerabilities_affected"].append(vuln.id)
                            results["details"].append(result)
                            
                            if sla_percentage >= 100:
                                results["breaches_detected"] += 1
                            elif sla_percentage >= 75:
                                results["warnings_sent"] += 1
            
            if not dept_assignments:
                if sla_percentage >= 100 and vuln.assigned_to:
                    assignee = vuln.assignee
                    if assignee:
                        try:
                            NotificationService.create_sla_breach_notification(db, vuln, days_overdue)
                            if send_emails:
                                EmailService.send_sla_breach(
                                    recipient_email=assignee.email,
                                    recipient_name=assignee.display_name,
                                    vulnerability=vuln,
                                    days_overdue=days_overdue
                                )
                            results["breaches_detected"] += 1
                            results["emails_sent"] += 1
                            if vuln.id not in results["vulnerabilities_affected"]:
                                results["vulnerabilities_affected"].append(vuln.id)
                        except Exception as e:
                            logger.error(f"Failed to send breach notification: {e}")
                
                elif sla_percentage >= 75 and vuln.assigned_to:
                    assignee = vuln.assignee
                    if assignee:
                        try:
                            NotificationService.create_sla_warning_notification(
                                db, vuln, sla_percentage, days_remaining
                            )
                            if send_emails:
                                EmailService.send_sla_warning(
                                    recipient_email=assignee.email,
                                    recipient_name=assignee.display_name,
                                    vulnerability=vuln,
                                    days_remaining=days_remaining,
                                    sla_percent=sla_percentage
                                )
                            results["warnings_sent"] += 1
                            results["emails_sent"] += 1
                            if vuln.id not in results["vulnerabilities_affected"]:
                                results["vulnerabilities_affected"].append(vuln.id)
                        except Exception as e:
                            logger.error(f"Failed to send warning notification: {e}")
        
        db.commit()
        
        return results
    
    @staticmethod
    def check_vulnerability_escalations(
        db: Session,
        vulnerability: Vulnerability,
        escalation_rules: List[GRCVulnWorkflowEscalation],
        auto_transition: bool = True,
        system_user_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        results = []
        
        if not vulnerability.discovered_at:
            return results
        
        sla_days = EscalationService.get_sla_days(
            db, vulnerability.tenant_id, vulnerability.severity
        )
        sla_percentage = EscalationService.calculate_sla_percentage(
            vulnerability.discovered_at, sla_days
        )
        days_open = EscalationService.get_days_open(vulnerability.discovered_at)
        
        for rule in escalation_rules:
            if not rule.is_active:
                continue
            
            if EscalationService.check_escalation_already_triggered(
                db, vulnerability.id, rule.id
            ):
                continue
            
            triggered = False
            notes = ""
            
            if rule.trigger_type == "sla_percentage":
                if sla_percentage >= rule.trigger_value:
                    triggered = True
                    notes = f"SLA {sla_percentage:.1f}% consumed (threshold: {rule.trigger_value}%)"
            
            elif rule.trigger_type == "days_open":
                if days_open >= rule.trigger_value:
                    triggered = True
                    notes = f"Open for {days_open} days (threshold: {rule.trigger_value} days)"
            
            elif rule.trigger_type == "severity_escalation":
                severity_scores = {"critical": 5, "high": 4, "medium": 3, "low": 2, "info": 1}
                vuln_score = severity_scores.get(vulnerability.severity, 0)
                if vuln_score >= rule.trigger_value:
                    triggered = True
                    notes = f"Severity {vulnerability.severity} meets threshold"
            
            if triggered:
                escalation_log = GRCVulnEscalationLog(
                    vulnerability_id=vulnerability.id,
                    escalation_rule_id=rule.id,
                    escalated_to_department_id=rule.escalate_to_department_id,
                    notification_sent=True,
                    notes=notes
                )
                
                auto_transitioned = False
                new_state_id = None
                
                if auto_transition and rule.auto_transition_to_state_id:
                    new_state = db.query(GRCVulnWorkflowState).filter(
                        GRCVulnWorkflowState.id == rule.auto_transition_to_state_id
                    ).first()
                    
                    if new_state:
                        old_state_id = vulnerability.current_state_id
                        vulnerability.current_state_id = new_state.id
                        vulnerability.updated_at = datetime.utcnow()
                        
                        history = GRCVulnWorkflowHistory(
                            vulnerability_id=vulnerability.id,
                            from_state_id=old_state_id,
                            to_state_id=new_state.id,
                            performed_by=system_user_id or 1,
                            comment=f"Auto-transitioned by escalation rule: {rule.name}"
                        )
                        db.add(history)
                        
                        auto_transitioned = True
                        new_state_id = new_state.id
                        escalation_log.auto_transitioned = True
                        escalation_log.new_state_id = new_state_id
                
                db.add(escalation_log)
                
                if sla_percentage >= 100:
                    days_overdue = days_open - sla_days
                    NotificationService.create_sla_breach_notification(
                        db, vulnerability, max(0, days_overdue)
                    )
                    if vulnerability.assignee:
                        try:
                            EmailService.send_sla_breach(
                                recipient_email=vulnerability.assignee.email,
                                recipient_name=vulnerability.assignee.display_name,
                                vulnerability=vulnerability,
                                days_overdue=max(0, days_overdue)
                            )
                        except Exception as e:
                            logger.error(f"Failed to send SLA breach email: {e}")
                
                elif sla_percentage >= 75:
                    days_remaining = max(0, sla_days - days_open)
                    NotificationService.create_sla_warning_notification(
                        db, vulnerability, sla_percentage, days_remaining
                    )
                    if vulnerability.assignee:
                        try:
                            EmailService.send_sla_warning(
                                recipient_email=vulnerability.assignee.email,
                                recipient_name=vulnerability.assignee.display_name,
                                vulnerability=vulnerability,
                                days_remaining=days_remaining,
                                sla_percent=sla_percentage
                            )
                        except Exception as e:
                            logger.error(f"Failed to send SLA warning email: {e}")
                
                results.append({
                    "vulnerability_id": vulnerability.id,
                    "vuln_id": vulnerability.vuln_id,
                    "rule_id": rule.id,
                    "rule_name": rule.name,
                    "trigger_type": rule.trigger_type,
                    "trigger_value": rule.trigger_value,
                    "sla_percentage": sla_percentage,
                    "days_open": days_open,
                    "auto_transitioned": auto_transitioned,
                    "new_state_id": new_state_id,
                    "notes": notes
                })
        
        return results
    
    @staticmethod
    def run_escalation_check(
        db: Session,
        tenant_ids: List[int],
        auto_transition: bool = True,
        system_user_id: Optional[int] = None
    ) -> Dict[str, Any]:
        terminal_states = [
            "resolved", "remediated", "verified", "closed",
            "accepted", "false_positive", "auto_closed_decommissioned",
            "auto_closed_fixed",
        ]
        
        vulnerabilities = db.query(Vulnerability).filter(
            Vulnerability.tenant_id.in_(tenant_ids),
            Vulnerability.status.notin_(terminal_states)
        ).all()
        
        total_checked = len(vulnerabilities)
        escalations_triggered = 0
        vulnerabilities_affected = []
        all_details = []
        
        for vuln in vulnerabilities:
            template_id = vuln.workflow_template_id
            if not template_id:
                default_template = db.query(GRCVulnWorkflowTemplate).filter(
                    GRCVulnWorkflowTemplate.tenant_id == vuln.tenant_id,
                    GRCVulnWorkflowTemplate.is_default == True,
                    GRCVulnWorkflowTemplate.is_active == True
                ).first()
                if default_template:
                    template_id = default_template.id
            
            if not template_id:
                continue
            
            escalation_rules = db.query(GRCVulnWorkflowEscalation).filter(
                GRCVulnWorkflowEscalation.template_id == template_id,
                GRCVulnWorkflowEscalation.is_active == True
            ).all()
            
            if not escalation_rules:
                continue
            
            results = EscalationService.check_vulnerability_escalations(
                db, vuln, escalation_rules, auto_transition, system_user_id
            )
            
            if results:
                escalations_triggered += len(results)
                if vuln.id not in vulnerabilities_affected:
                    vulnerabilities_affected.append(vuln.id)
                all_details.extend(results)
        
        db.commit()
        
        return {
            "total_checked": total_checked,
            "escalations_triggered": escalations_triggered,
            "vulnerabilities_affected": vulnerabilities_affected,
            "details": all_details
        }
    
    @staticmethod
    def get_escalation_logs(
        db: Session,
        tenant_ids: List[int],
        vulnerability_id: Optional[int] = None,
        escalation_rule_id: Optional[int] = None,
        skip: int = 0,
        limit: int = 50
    ) -> List[GRCVulnEscalationLog]:
        query = db.query(GRCVulnEscalationLog).join(
            Vulnerability, GRCVulnEscalationLog.vulnerability_id == Vulnerability.id
        ).filter(
            Vulnerability.tenant_id.in_(tenant_ids)
        )
        
        if vulnerability_id:
            query = query.filter(GRCVulnEscalationLog.vulnerability_id == vulnerability_id)
        
        if escalation_rule_id:
            query = query.filter(GRCVulnEscalationLog.escalation_rule_id == escalation_rule_id)
        
        return query.order_by(
            GRCVulnEscalationLog.triggered_at.desc()
        ).offset(skip).limit(limit).all()
