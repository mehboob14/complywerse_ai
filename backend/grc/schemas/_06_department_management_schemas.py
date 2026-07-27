from ._05_vulnerability_management_schemas import *  # noqa: F401,F403

# =============================================================================
# Department Management Schemas
# =============================================================================

class GRCDepartmentCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    parent_department_id: Optional[int] = None
    department_head_user_id: Optional[int] = None


class GRCDepartmentUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    parent_department_id: Optional[int] = None
    department_head_user_id: Optional[int] = None
    is_active: Optional[bool] = None


class GRCDepartmentMemberResponse(BaseModel):
    id: int
    department_id: int
    user_id: int
    role: str
    email_notifications_enabled: bool
    escalation_order: int
    added_at: datetime
    added_by: Optional[int]
    is_active: bool
    user_name: Optional[str] = None
    user_email: Optional[str] = None

    class Config:
        from_attributes = True


class GRCDepartmentResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    code: str
    description: Optional[str]
    parent_department_id: Optional[int]
    parent_department_name: Optional[str] = None
    department_head_user_id: Optional[int]
    department_head_name: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    member_count: int = 0

    class Config:
        from_attributes = True


class GRCDepartmentDetailResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    code: str
    description: Optional[str]
    parent_department_id: Optional[int]
    parent_department_name: Optional[str] = None
    department_head_user_id: Optional[int]
    department_head_name: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    members: List[GRCDepartmentMemberResponse] = []
    sub_departments: List["GRCDepartmentResponse"] = []
    vulnerability_count: int = 0

    class Config:
        from_attributes = True


class GRCDepartmentMemberCreate(BaseModel):
    user_id: int
    role: str = "member"
    email_notifications_enabled: bool = True
    escalation_order: int = 0


class GRCVulnerabilityDepartmentAssignmentCreate(BaseModel):
    department_id: int
    priority: str = "medium"
    notes: Optional[str] = None
    sla_override_days: Optional[int] = None


class GRCVulnerabilityDepartmentAssignmentResponse(BaseModel):
    id: int
    vulnerability_id: int
    department_id: int
    department_name: Optional[str] = None
    department_code: Optional[str] = None
    assigned_by: Optional[int]
    assigner_name: Optional[str] = None
    assigned_at: datetime
    priority: str
    notes: Optional[str]
    sla_override_days: Optional[int]
    notification_sent: bool

    class Config:
        from_attributes = True


class GRCDepartmentEscalationPathCreate(BaseModel):
    escalation_level: int
    target_role: str
    sla_threshold_percent: int = 75
    auto_escalate: bool = True


class GRCDepartmentEscalationPathResponse(BaseModel):
    id: int
    department_id: int
    escalation_level: int
    target_role: str
    sla_threshold_percent: int
    auto_escalate: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BulkVulnerabilityAssignRequest(BaseModel):
    vulnerability_ids: List[int]
    department_id: int
    priority: str = "medium"
    notes: Optional[str] = None


class BulkVulnerabilityAssignResponse(BaseModel):
    success_count: int
    failed_count: int
    assignments: List[GRCVulnerabilityDepartmentAssignmentResponse] = []
    errors: List[Dict[str, Any]] = []

