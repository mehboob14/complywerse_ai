from ._02_risk_mitigation_action_schemas import *  # noqa: F401,F403

# =============================================================================
# Likelihood Impact Scale Schemas
# =============================================================================

class LikelihoodImpactScaleBase(BaseModel):
    scale_type: str
    level: int
    label: str
    description: Optional[str] = None
    score_value: float
    color: Optional[str] = None
    is_default: bool = False


class LikelihoodImpactScaleCreate(LikelihoodImpactScaleBase):
    pass


class LikelihoodImpactScaleUpdate(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    score_value: Optional[float] = None
    color: Optional[str] = None
    is_default: Optional[bool] = None


class LikelihoodImpactScaleResponse(BaseModel):
    id: int
    tenant_id: int
    scale_type: str
    level: int
    label: str
    description: Optional[str]
    score_value: float
    color: Optional[str]
    is_default: bool
    created_at: datetime

    class Config:
        from_attributes = True

