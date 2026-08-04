from ._12_regulatory_change_management_schemas import *  # noqa: F401,F403

# =============================================================================
# Board & Committee Management Schemas
# =============================================================================

class GovernanceCommitteeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    committee_type: str  # board, risk_committee, audit_committee, compliance_committee, it_steering, custom
    chair_id: Optional[int] = None
    secretary_id: Optional[int] = None
    meeting_frequency: str = "quarterly"  # monthly, quarterly, annual, ad_hoc


class GovernanceCommitteeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    committee_type: Optional[str] = None
    chair_id: Optional[int] = None
    secretary_id: Optional[int] = None
    meeting_frequency: Optional[str] = None
    is_active: Optional[bool] = None


class GovernanceCommitteeResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    committee_type: str
    chair_id: Optional[int]
    chair_name: Optional[str] = None
    secretary_id: Optional[int]
    secretary_name: Optional[str] = None
    meeting_frequency: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    member_count: int = 0
    meeting_count: int = 0
    pending_actions_count: int = 0

    class Config:
        from_attributes = True


class CommitteeMemberCreate(BaseModel):
    user_id: int
    role: str = "member"  # chair, secretary, member, observer


class CommitteeMemberResponse(BaseModel):
    id: int
    tenant_id: int
    committee_id: int
    user_id: int
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    role: str
    joined_at: datetime
    left_at: Optional[datetime]
    is_active: bool

    class Config:
        from_attributes = True


class CommitteeCharterCreate(BaseModel):
    version: str = "1.0"
    title: str
    content: Optional[str] = None
    effective_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    status: str = "draft"


class CommitteeCharterUpdate(BaseModel):
    version: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    effective_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    status: Optional[str] = None


class CommitteeCharterResponse(BaseModel):
    id: int
    tenant_id: int
    committee_id: int
    version: str
    title: str
    content: Optional[str]
    effective_date: Optional[datetime]
    expiry_date: Optional[datetime]
    status: str
    approved_by: Optional[int]
    approver_name: Optional[str] = None
    approved_at: Optional[datetime]
    created_by: Optional[int]
    creator_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CommitteeMeetingCreate(BaseModel):
    meeting_number: Optional[str] = None
    title: str
    meeting_type: str = "regular"  # regular, special, emergency
    scheduled_date: datetime
    location: Optional[str] = None
    virtual_link: Optional[str] = None
    quorum_required: Optional[int] = None


class CommitteeMeetingUpdate(BaseModel):
    meeting_number: Optional[str] = None
    title: Optional[str] = None
    meeting_type: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    location: Optional[str] = None
    virtual_link: Optional[str] = None
    status: Optional[str] = None
    quorum_required: Optional[int] = None
    quorum_present: Optional[int] = None


class CommitteeMeetingResponse(BaseModel):
    id: int
    tenant_id: int
    committee_id: int
    committee_name: Optional[str] = None
    meeting_number: Optional[str]
    title: str
    meeting_type: str
    scheduled_date: datetime
    location: Optional[str]
    virtual_link: Optional[str]
    status: str
    quorum_required: Optional[int]
    quorum_present: Optional[int]
    created_by: Optional[int]
    creator_name: Optional[str] = None
    created_at: datetime
    agenda_item_count: int = 0
    action_count: int = 0
    has_minutes: bool = False

    class Config:
        from_attributes = True


class MeetingAgendaItemCreate(BaseModel):
    item_number: Optional[int] = None  # auto-assigned if omitted
    title: str
    description: Optional[str] = None
    item_type: str = "discussion"  # approval, discussion, information, action_review
    presenter_id: Optional[int] = None
    linked_document_id: Optional[int] = None
    linked_risk_id: Optional[int] = None
    linked_regulatory_change_id: Optional[int] = None
    time_allocated_minutes: Optional[int] = None
    duration_minutes: Optional[int] = None  # frontend alias for time_allocated_minutes


class MeetingAgendaItemUpdate(BaseModel):
    item_number: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    item_type: Optional[str] = None
    presenter_id: Optional[int] = None
    linked_document_id: Optional[int] = None
    linked_risk_id: Optional[int] = None
    linked_regulatory_change_id: Optional[int] = None
    time_allocated_minutes: Optional[int] = None
    status: Optional[str] = None
    outcome: Optional[str] = None
    decision_made: Optional[str] = None


class MeetingAgendaItemResponse(BaseModel):
    id: int
    tenant_id: int
    meeting_id: int
    item_number: int
    title: str
    description: Optional[str]
    item_type: str
    presenter_id: Optional[int]
    presenter_name: Optional[str] = None
    linked_document_id: Optional[int]
    linked_document_title: Optional[str] = None
    linked_risk_id: Optional[int]
    linked_risk_title: Optional[str] = None
    linked_regulatory_change_id: Optional[int]
    linked_regulatory_change_title: Optional[str] = None
    time_allocated_minutes: Optional[int]
    status: str
    outcome: Optional[str]
    decision_made: Optional[str]

    class Config:
        from_attributes = True


class MeetingMinutesCreate(BaseModel):
    content: Optional[str] = None
    attendees: List[Dict[str, Any]] = []
    status: str = "draft"


class MeetingMinutesUpdate(BaseModel):
    content: Optional[str] = None
    attendees: Optional[List[Dict[str, Any]]] = None
    status: Optional[str] = None


class MeetingMinutesResponse(BaseModel):
    id: int
    tenant_id: int
    meeting_id: int
    content: Optional[str]
    attendees: List[Dict[str, Any]]
    status: str
    drafted_by: Optional[int]
    drafter_name: Optional[str] = None
    drafted_at: datetime
    approved_by: Optional[int]
    approver_name: Optional[str] = None
    approved_at: Optional[datetime]

    class Config:
        from_attributes = True


class OversightActionCreate(BaseModel):
    action_number: Optional[str] = None
    title: str
    description: Optional[str] = None
    action_type: str = "follow_up"  # follow_up, policy_approval, risk_review, audit_response
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None
    linked_policy_id: Optional[int] = None
    linked_risk_id: Optional[int] = None
    agenda_item_id: Optional[int] = None


class OversightActionUpdate(BaseModel):
    action_number: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    action_type: Optional[str] = None
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = None
    completed_at: Optional[datetime] = None
    completion_notes: Optional[str] = None
    linked_policy_id: Optional[int] = None
    linked_risk_id: Optional[int] = None


class OversightActionResponse(BaseModel):
    id: int
    tenant_id: int
    committee_id: int
    committee_name: Optional[str] = None
    meeting_id: Optional[int]
    meeting_title: Optional[str] = None
    agenda_item_id: Optional[int]
    action_number: Optional[str]
    title: str
    description: Optional[str]
    action_type: str
    assigned_to: Optional[int]
    assignee_name: Optional[str] = None
    due_date: Optional[datetime]
    status: str
    completed_at: Optional[datetime]
    completion_notes: Optional[str]
    linked_policy_id: Optional[int]
    linked_policy_title: Optional[str] = None
    linked_risk_id: Optional[int]
    linked_risk_title: Optional[str] = None
    created_by: Optional[int]
    creator_name: Optional[str] = None
    created_at: datetime
    is_overdue: bool = False

    class Config:
        from_attributes = True


class CommitteeDashboardStats(BaseModel):
    total_committees: int
    active_committees: int
    by_type: Dict[str, int]
    total_meetings: int
    upcoming_meetings: int
    completed_meetings: int
    total_actions: int
    open_actions: int
    overdue_actions: int
    in_progress_actions: int
    completed_actions: int
    action_completion_rate: float = 0.0
    upcoming_meetings_list: List[Dict[str, Any]] = []
    overdue_actions_list: List[Dict[str, Any]] = []


class ConvertStatementsRequest(BaseModel):
    statement_ids: List[int]
    category: Optional[str] = None
    priority: Optional[str] = None


class InternalControlFromStatementResponse(BaseModel):
    id: int
    control_id: str
    name: str
    description: Optional[str]
    category: Optional[str]
    priority: str
    source_document_id: int
    source_statement_id: int
    tenant_id: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

