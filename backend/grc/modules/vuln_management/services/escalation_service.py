from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session, joinedload

from ....models import (
    Vulnerability, VulnerabilitySLAConfig, GRCVulnWorkflowEscalation,
    GRCVulnWorkflowTemplate, GRCVulnEscalationLog, GRCVulnWorkflowHistory,
    GRCVulnWorkflowState, GRCTeam, GRCUser
)
from .notification_service import NotificationService


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
                    escalated_to_team_id=rule.escalate_to_team_id,
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
                elif sla_percentage >= 75:
                    days_remaining = max(0, sla_days - days_open)
                    NotificationService.create_sla_warning_notification(
                        db, vulnerability, sla_percentage, days_remaining
                    )
                
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
        terminal_states = ["resolved", "accepted", "false_positive"]
        
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
