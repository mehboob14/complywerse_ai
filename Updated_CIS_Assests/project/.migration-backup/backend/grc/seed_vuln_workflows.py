from .models import (
    SessionLocal, GRCVulnWorkflowTemplate, GRCVulnWorkflowState,
    GRCVulnWorkflowTransition, GRCVulnWorkflowEscalation, Tenant
)


def seed_default_vuln_workflow():
    """Seed a default vulnerability workflow template for each tenant."""
    db = SessionLocal()
    try:
        tenants = db.query(Tenant).filter(Tenant.is_active == True).all()
        
        for tenant in tenants:
            existing = db.query(GRCVulnWorkflowTemplate).filter(
                GRCVulnWorkflowTemplate.tenant_id == tenant.id,
                GRCVulnWorkflowTemplate.is_default == True
            ).first()
            
            if existing:
                continue
            
            template = GRCVulnWorkflowTemplate(
                tenant_id=tenant.id,
                name="Standard Remediation",
                description="Default vulnerability remediation workflow with standard review process",
                is_default=True,
                is_active=True
            )
            db.add(template)
            db.flush()
            
            states_data = [
                {
                    "name": "Open",
                    "state_type": "initial",
                    "order_index": 1,
                    "color": "#EF4444",
                    "requires_approval": False,
                    "requires_evidence": False,
                    "sla_multiplier": 1.0,
                    "is_terminal": False
                },
                {
                    "name": "In Progress",
                    "state_type": "in_progress",
                    "order_index": 2,
                    "color": "#F59E0B",
                    "requires_approval": False,
                    "requires_evidence": False,
                    "sla_multiplier": 1.0,
                    "is_terminal": False
                },
                {
                    "name": "Pending Review",
                    "state_type": "approval",
                    "order_index": 3,
                    "color": "#8B5CF6",
                    "requires_approval": True,
                    "requires_evidence": True,
                    "sla_multiplier": 0.5,
                    "is_terminal": False
                },
                {
                    "name": "Resolved",
                    "state_type": "resolved",
                    "order_index": 4,
                    "color": "#10B981",
                    "requires_approval": False,
                    "requires_evidence": False,
                    "sla_multiplier": 1.0,
                    "is_terminal": False
                },
                {
                    "name": "Closed",
                    "state_type": "closed",
                    "order_index": 5,
                    "color": "#6B7280",
                    "requires_approval": False,
                    "requires_evidence": False,
                    "sla_multiplier": 1.0,
                    "is_terminal": True
                },
                {
                    "name": "Risk Accepted",
                    "state_type": "exception",
                    "order_index": 6,
                    "color": "#EC4899",
                    "requires_approval": True,
                    "requires_evidence": True,
                    "sla_multiplier": 1.0,
                    "is_terminal": True
                }
            ]
            
            states = {}
            for state_data in states_data:
                state = GRCVulnWorkflowState(
                    template_id=template.id,
                    **state_data
                )
                db.add(state)
                db.flush()
                states[state_data["name"]] = state
            
            transitions_data = [
                {
                    "from_state": "Open",
                    "to_state": "In Progress",
                    "name": "Start Work",
                    "requires_comment": False,
                    "requires_approval": False,
                    "trigger_notification": True
                },
                {
                    "from_state": "In Progress",
                    "to_state": "Pending Review",
                    "name": "Submit for Review",
                    "requires_comment": True,
                    "requires_approval": False,
                    "trigger_notification": True
                },
                {
                    "from_state": "Pending Review",
                    "to_state": "Resolved",
                    "name": "Approve",
                    "requires_comment": False,
                    "requires_approval": True,
                    "approver_role": "lead",
                    "trigger_notification": True
                },
                {
                    "from_state": "Pending Review",
                    "to_state": "In Progress",
                    "name": "Request Changes",
                    "requires_comment": True,
                    "requires_approval": False,
                    "trigger_notification": True
                },
                {
                    "from_state": "Resolved",
                    "to_state": "Closed",
                    "name": "Close",
                    "requires_comment": False,
                    "requires_approval": False,
                    "trigger_notification": True
                },
                {
                    "from_state": "Resolved",
                    "to_state": "In Progress",
                    "name": "Reopen",
                    "requires_comment": True,
                    "requires_approval": False,
                    "trigger_notification": True
                },
                {
                    "from_state": "Open",
                    "to_state": "Risk Accepted",
                    "name": "Accept Risk",
                    "requires_comment": True,
                    "requires_approval": True,
                    "approver_role": "manager",
                    "trigger_notification": True
                },
                {
                    "from_state": "In Progress",
                    "to_state": "Risk Accepted",
                    "name": "Accept Risk",
                    "requires_comment": True,
                    "requires_approval": True,
                    "approver_role": "manager",
                    "trigger_notification": True
                }
            ]
            
            for trans_data in transitions_data:
                from_state = states[trans_data.pop("from_state")]
                to_state = states[trans_data.pop("to_state")]
                
                transition = GRCVulnWorkflowTransition(
                    template_id=template.id,
                    from_state_id=from_state.id,
                    to_state_id=to_state.id,
                    **trans_data
                )
                db.add(transition)
            
            escalations_data = [
                {
                    "name": "SLA 75% Warning",
                    "trigger_type": "sla_percentage",
                    "trigger_value": 75.0,
                    "escalate_to_role": "lead",
                    "notification_type": "both",
                    "is_active": True
                },
                {
                    "name": "SLA Breach",
                    "trigger_type": "sla_percentage",
                    "trigger_value": 100.0,
                    "escalate_to_role": "manager",
                    "notification_type": "both",
                    "is_active": True
                },
                {
                    "name": "Critical Overdue",
                    "trigger_type": "days_open",
                    "trigger_value": 14.0,
                    "escalate_to_role": "ciso",
                    "notification_type": "both",
                    "is_active": True
                }
            ]
            
            for esc_data in escalations_data:
                escalation = GRCVulnWorkflowEscalation(
                    template_id=template.id,
                    **esc_data
                )
                db.add(escalation)
        
        db.commit()
        print("Default vulnerability workflow templates seeded successfully")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding vulnerability workflows: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_default_vuln_workflow()
