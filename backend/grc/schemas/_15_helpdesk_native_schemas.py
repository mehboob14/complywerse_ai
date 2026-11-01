from ._14_rss_feed_ingestion_schemas import *  # noqa: F401,F403 — chains BaseModel/Optional/datetime from _00_base
from datetime import date, time  # not re-exported by the base chain

# =============================================================================
# AVA-native Help Desk schemas (engine conversion, step 1)
# =============================================================================
#
# Base / Create / Read trio per core entity, sized for the CRUD step that comes
# next — not the full field surface of the models. Writers send *_id FKs and the
# text fields; reads echo them plus id/tenant_id/timestamps. Child collections
# (SLA priorities/service days, team members, template fields) are modelled
# inline so an SLA or Team round-trips in one payload.
#
# `from_attributes = True` on Read models lets FastAPI serialize the SQLAlchemy
# rows directly.


# ---- Ticket -----------------------------------------------------------------
class HDTicketBase(BaseModel):
    subject: str
    raised_by: Optional[str] = None
    description: Optional[str] = None
    status_id: Optional[int] = None
    priority_id: Optional[int] = None
    ticket_type_id: Optional[int] = None
    agent_group_id: Optional[int] = None
    sla_id: Optional[int] = None
    customer_id: Optional[int] = None
    contact: Optional[str] = None


class HDTicketCreate(HDTicketBase):
    pass


class HDTicketUpdate(BaseModel):
    subject: Optional[str] = None
    description: Optional[str] = None
    status_id: Optional[int] = None
    priority_id: Optional[int] = None
    ticket_type_id: Optional[int] = None
    agent_group_id: Optional[int] = None
    sla_id: Optional[int] = None
    resolution_details: Optional[str] = None
    feedback_rating: Optional[float] = None
    feedback_id: Optional[int] = None


class HDTicketRead(HDTicketBase):
    id: int
    tenant_id: int
    status_category: Optional[str] = None
    agreement_status: Optional[str] = None
    response_by: Optional[datetime] = None
    resolution_by: Optional[datetime] = None
    first_responded_on: Optional[datetime] = None
    resolution_date: Optional[datetime] = None
    feedback_rating: Optional[float] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---- Agent ------------------------------------------------------------------
class HDAgentBase(BaseModel):
    user: str
    agent_name: str
    user_image: Optional[str] = None
    is_active: Optional[bool] = True
    availability: Optional[str] = None


class HDAgentCreate(HDAgentBase):
    pass


class HDAgentRead(HDAgentBase):
    id: int
    tenant_id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---- Team -------------------------------------------------------------------
class HDTeamMemberSchema(BaseModel):
    user: Optional[str] = None

    class Config:
        from_attributes = True


class HDTeamBase(BaseModel):
    team_name: str
    assignment_rule: Optional[str] = None
    ignore_restrictions: Optional[bool] = False
    disabled: Optional[bool] = False


class HDTeamCreate(HDTeamBase):
    users: List[HDTeamMemberSchema] = []


class HDTeamRead(HDTeamBase):
    id: int
    tenant_id: int
    users: List[HDTeamMemberSchema] = []
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---- Saved Reply ------------------------------------------------------------
class HDSavedReplyBase(BaseModel):
    title: str
    message: str
    scope: str = "Global"
    actions: Optional[Any] = None


class HDSavedReplyCreate(HDSavedReplyBase):
    pass


class HDSavedReplyRead(HDSavedReplyBase):
    id: int
    tenant_id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---- Article ----------------------------------------------------------------
class HDArticleBase(BaseModel):
    title: str
    category_id: Optional[int] = None
    status: Optional[str] = "Draft"
    content: Optional[str] = None
    author: Optional[str] = None


class HDArticleCreate(HDArticleBase):
    pass


class HDArticleRead(HDArticleBase):
    id: int
    tenant_id: int
    views: Optional[int] = 0
    published_on: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---- SLA (with inline child targets) ----------------------------------------
class HDServiceLevelPrioritySchema(BaseModel):
    priority_id: Optional[int] = None
    default_priority: Optional[bool] = False
    response_time: Optional[float] = None
    resolution_time: Optional[float] = None

    class Config:
        from_attributes = True


class HDServiceDaySchema(BaseModel):
    workday: str
    start_time: Optional[time] = None
    end_time: Optional[time] = None

    class Config:
        from_attributes = True


class HDServiceLevelAgreementBase(BaseModel):
    service_level: str
    description: Optional[str] = None
    enabled: Optional[bool] = True
    default_sla: Optional[bool] = False
    rank: Optional[int] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    apply_sla_for_resolution: Optional[bool] = True
    holiday_list_id: Optional[int] = None
    default_priority_id: Optional[int] = None
    default_ticket_status_id: Optional[int] = None
    ticket_reopen_status_id: Optional[int] = None


class HDServiceLevelAgreementCreate(HDServiceLevelAgreementBase):
    priorities: List[HDServiceLevelPrioritySchema] = []
    service_days: List[HDServiceDaySchema] = []


class HDServiceLevelAgreementRead(HDServiceLevelAgreementBase):
    id: int
    tenant_id: int
    priorities: List[HDServiceLevelPrioritySchema] = []
    service_days: List[HDServiceDaySchema] = []
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
