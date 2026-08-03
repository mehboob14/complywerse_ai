from ._01_advanced_erm_schemas import *  # noqa: F401,F403

# =============================================================================
# Risk Mitigation Action Schemas
# =============================================================================

class RiskMitigationActionBase(BaseModel):
    title: str
    description: Optional[str] = None
    action_type: str = "mitigate"
    priority: str = "medium"
    owner_id: Optional[int] = None
    due_date: Optional[datetime] = None
    expected_residual_reduction: Optional[float] = None
    notes: Optional[str] = None


class RiskMitigationActionCreate(RiskMitigationActionBase):
    risk_id: Optional[int] = None


class RiskMitigationActionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    action_type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    owner_id: Optional[int] = None
    due_date: Optional[datetime] = None
    expected_residual_reduction: Optional[float] = None
    actual_residual_reduction: Optional[float] = None
    evidence_id: Optional[int] = None
    notes: Optional[str] = None


class RiskMitigationActionResponse(BaseModel):
    id: int
    risk_id: int
    title: str
    description: Optional[str]
    action_type: str
    status: str
    priority: str
    owner_id: Optional[int]
    due_date: Optional[datetime]
    completed_at: Optional[datetime]
    expected_residual_reduction: Optional[float]
    actual_residual_reduction: Optional[float]
    evidence_id: Optional[int]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    owner_name: Optional[str] = None

    class Config:
        from_attributes = True

