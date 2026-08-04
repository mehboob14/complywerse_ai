from ._07_vulnerability_workflow_template_schemas import *  # noqa: F401,F403

# =============================================================================
# Escalation Log Schemas
# =============================================================================

class GRCVulnEscalationLogResponse(BaseModel):
    id: int
    vulnerability_id: int
    vulnerability_title: Optional[str] = None
    escalation_rule_id: int
    escalation_rule_name: Optional[str] = None
    triggered_at: datetime
    escalated_to_department_id: Optional[int]
    escalated_to_department_name: Optional[str] = None
    escalated_to_user_id: Optional[int]
    escalated_to_user_name: Optional[str] = None
    notification_sent: bool
    auto_transitioned: bool
    new_state_id: Optional[int]
    new_state_name: Optional[str] = None
    notes: Optional[str]

    class Config:
        from_attributes = True


class EscalationCheckResult(BaseModel):
    total_checked: int
    escalations_triggered: int
    vulnerabilities_affected: List[int] = []
    details: List[Dict[str, Any]] = []

