from ._56_scf_catalog_models import *  # noqa: F401,F403 — pulls Base, Column types, datetime via the section chain
from sqlalchemy import Time  # Frappe `Time` fields (opening_time, service-day hours); not re-exported by _00_base

# =============================================================================
# AVA-native Help Desk data model (engine conversion, step 1)
# =============================================================================
#
# Source of truth: the forked + rebranded Frappe Helpdesk DocType JSON under
# helpdesk-app/helpdesk/helpdesk/doctype/<name>/<name>.json. This module
# re-implements those DocTypes as native ComplyVerse SQLAlchemy models so the Help Desk
# can run inside ComplyVerse's own FastAPI/Postgres stack (one server) instead of on the
# Frappe framework. The proxy (grc/modules/helpdesk/router.py) is untouched; the
# native engine is built alongside it and cut over later.
#
# Conventions (see docs/HELPDESK_NATIVE_MODEL_MAP.md for the full field map):
#   * Table name  = "grc_hd_<name>".
#   * Surrogate   = id (Integer PK). Frappe's string `name` is kept as a column
#                   ONLY where it carries data (autoname Prompt doctypes).
#   * Tenancy     = tenant_id FK on every top-level table (ComplyVerse's per-tenant
#                   `ava_tenant` partition becomes a real FK). Child tables are
#                   scoped through their parent, so they carry no tenant_id.
#   * Frappe Link -> converted doctype  => real FK "<fieldname>_id" + relationship.
#   * Frappe Link -> framework doctype we do NOT convert (User, Contact, Email
#                   Account, Country, Assignment Rule, HD Agent Status)  => plain
#                   String holding the external name, noted in the map.
#   * Frappe Table/Table MultiSelect => a child model with parent FK + `idx`.
#   * Frappe Duration (seconds) -> Float. Rating -> Float. Time -> Time.
#     Section/Column/Tab Break, HTML, Button, virtual fields are layout-only and
#     dropped.


# ----------------------------------------------------------------------------
# CORE
# ----------------------------------------------------------------------------
class HDTicketStatus(Base):
    __tablename__ = "grc_hd_ticket_status"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    label_agent = Column(String(140), nullable=False)      # reqd, unique per tenant (Frappe autoname = this)
    label_customer = Column(String(140), nullable=True)
    different_view = Column(Boolean, default=False)
    category = Column(String(30), nullable=False)          # Open | Paused | Resolved
    color = Column(String(30), nullable=True)
    order = Column(Integer, nullable=True)
    enabled = Column(Boolean, default=True)
    # ITSM lifecycle metadata (workbook ingest). create_all can't add these to
    # existing tenant DBs, so itsm_seed ALTERs them in.
    process = Column(String(20), nullable=True)            # incident|problem|change|service_request, or "shared" when the label is used by >1 process
    is_initial = Column(Boolean, server_default=text("false"))
    is_terminal = Column(Boolean, server_default=text("false"))
    sort_order = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_ticket_status_label", "tenant_id", "label_agent", unique=True),
    )


class HDTicketPriority(Base):
    __tablename__ = "grc_hd_ticket_priority"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    name = Column(String(140), nullable=True)              # Frappe doc name (autoname Prompt) — the priority identifier
    level = Column(String(60), nullable=False, default="Medium")  # Urgent | High | Medium | Low
    description = Column(Text, nullable=True)
    disabled = Column(Boolean, default=False)
    # ITSM priority code/rank (workbook ingest). create_all can't add these to
    # existing tenant DBs, so itsm_seed ALTERs them in.
    code = Column(String(10), nullable=True)               # "P1".."P5"
    rank = Column(Integer, nullable=True)                  # 1 = most severe

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class HDTicketType(Base):
    __tablename__ = "grc_hd_ticket_type"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    name = Column(String(140), nullable=True)              # Frappe doc name (autoname Prompt) — the type identifier
    description = Column(Text, nullable=True)
    priority_id = Column(Integer, ForeignKey("grc_hd_ticket_priority.id"), nullable=True)  # default priority
    department_id = Column(Integer, ForeignKey("grc_hd_department.id"), nullable=True)  # ComplyVerse net-new: null = global type; set = dept-scoped category
    is_system = Column(Boolean, default=False)
    disabled = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    priority = relationship("HDTicketPriority")


class HDTicketTemplateField(Base):
    """Child of HD Ticket Template (istable)."""
    __tablename__ = "grc_hd_ticket_template_field"

    id = Column(Integer, primary_key=True)
    template_id = Column(Integer, ForeignKey("grc_hd_ticket_template.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    idx = Column(Integer, nullable=True)                   # row order within the parent

    fieldname = Column(String(140), nullable=True)
    required = Column(Boolean, default=False)
    visible_to = Column(String(30), nullable=True)         # Everyone | Agents
    editable_after_creation = Column(Boolean, default=True)
    url_method = Column(String(255), nullable=True)
    placeholder = Column(String(255), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    template = relationship("HDTicketTemplate", back_populates="fields")


class HDTicketTemplate(Base):
    __tablename__ = "grc_hd_ticket_template"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    template_name = Column(String(140), nullable=False)    # reqd, unique per tenant
    about = Column(Text, nullable=True)                    # Frappe Code(HTML)
    description_template = Column(Text, nullable=True)

    # ComplyVerse net-new: department-wise predefined request library (pre-fills New-Ticket).
    # create_all can't add these to existing tenant DBs, so itsm_seed ALTERs them in.
    department_id = Column(Integer, ForeignKey("grc_hd_department.id"), nullable=True)
    process = Column(String(20), server_default="incident")  # incident|problem|change|service_request|question
    default_subject = Column(String(255), nullable=True)
    default_description = Column(Text, nullable=True)
    default_category = Column(String(100), nullable=True)
    default_subcategory = Column(String(100), nullable=True)
    default_impact = Column(String(10), nullable=True)     # low | medium | high
    default_urgency = Column(String(10), nullable=True)    # low | medium | high
    icon = Column(String(40), nullable=True)               # lucide icon name for the card
    enabled = Column(Boolean, server_default=text("true"))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    fields = relationship("HDTicketTemplateField", back_populates="template",
                          cascade="all, delete-orphan", order_by="HDTicketTemplateField.idx")
    department = relationship("HDDepartment", foreign_keys=[department_id])

    __table_args__ = (
        Index("uq_hd_ticket_template_name", "tenant_id", "template_name", unique=True),
    )


class HDTicket(Base):
    __tablename__ = "grc_hd_ticket"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    # --- subject / identity ---
    subject = Column(String(255), nullable=False)          # reqd
    raised_by = Column(String(255), nullable=True)         # reporter email
    key = Column(String(255), nullable=True)

    # --- classification (converted-doctype links) ---
    status_id = Column(Integer, ForeignKey("grc_hd_ticket_status.id"), nullable=True, index=True)  # reqd in Frappe
    status_category = Column(String(60), nullable=True)    # fetched from status.category (Open/Paused/Resolved)
    priority_id = Column(Integer, ForeignKey("grc_hd_ticket_priority.id"), nullable=True)
    ticket_type_id = Column(Integer, ForeignKey("grc_hd_ticket_type.id"), nullable=True)
    agent_group_id = Column(Integer, ForeignKey("grc_teams.id"), nullable=True)  # "Team" — ComplyVerse Administration team (grc_teams), managed in one place
    department_id = Column(Integer, ForeignKey("grc_hd_department.id"), nullable=True, index=True)  # ComplyVerse net-new: intake department
    support_group_code = Column(String(40), nullable=True)  # ITIL support group (GRP-*); routes to its mapped ComplyVerse team (HDSupportGroupMap)
    template_id = Column(Integer, ForeignKey("grc_hd_ticket_template.id"), nullable=True)
    # Native equivalent of Frappe core `_assign` (JSON list), flattened to the
    # single assignee the Help Desk UI exposes as `agent` (A15 assign endpoint).
    # Holds the HD Agent's login email. Assignment-RULE selection (round-robin /
    # load-balance) is the assignment agent's job; this is just the store.
    assigned_agent = Column(String(255), nullable=True, index=True)

    # --- body ---
    description = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    resolution_details = Column(Text, nullable=True)

    # --- SLA ---
    sla_id = Column(Integer, ForeignKey("grc_hd_service_level_agreement.id"), nullable=True, index=True)
    agreement_status = Column(String(60), nullable=True)   # First Response Due | Resolution Due | Failed | Fulfilled | Paused
    response_by = Column(DateTime, nullable=True)
    resolution_by = Column(DateTime, nullable=True)
    service_level_agreement_creation = Column(DateTime, nullable=True)
    on_hold_since = Column(DateTime, nullable=True)
    total_hold_time = Column(Float, nullable=True)         # Duration (seconds)
    raised_outside_working_hours = Column(Boolean, default=False)

    # --- response metrics ---
    first_response_time = Column(Float, nullable=True)     # Duration
    first_responded_on = Column(DateTime, nullable=True)
    first_response_failed_by = Column(Float, nullable=True)
    avg_response_time = Column(Float, nullable=True)
    last_agent_response = Column(DateTime, nullable=True)
    last_customer_response = Column(DateTime, nullable=True)

    # --- resolution metrics ---
    opening_date = Column(Date, nullable=True)
    opening_time = Column(Time, nullable=True)
    resolution_date = Column(DateTime, nullable=True)
    resolution_time = Column(Float, nullable=True)         # Duration
    user_resolution_time = Column(Float, nullable=True)
    resolution_failed_by = Column(Float, nullable=True)

    # --- reference (framework links kept as String) ---
    contact = Column(String(255), nullable=True)           # -> Frappe Contact
    customer_id = Column(Integer, ForeignKey("grc_hd_customer.id"), nullable=True)
    email_account = Column(String(255), nullable=True)     # -> Frappe Email Account
    via_customer_portal = Column(Boolean, default=False)

    # --- split & merge (self references) ---
    is_merged = Column(Boolean, default=False)
    merged_with_id = Column(Integer, ForeignKey("grc_hd_ticket.id"), nullable=True)
    ticket_split_from_id = Column(Integer, ForeignKey("grc_hd_ticket.id"), nullable=True)

    # --- feedback / CSAT ---
    feedback_rating = Column(Float, nullable=True)         # Rating (0..1)
    feedback_id = Column(Integer, ForeignKey("grc_hd_ticket_feedback_option.id"), nullable=True)
    feedback_extra = Column(Text, nullable=True)

    # --- ITIL process discriminator + per-process extension fields (ITSM) ---
    # process is set at create and never auto-changes (spec §0). create_all can't
    # add these to existing tenant DBs, so itsm_seed.seed_itsm ALTERs them in.
    process = Column(String(20), nullable=False, server_default="incident")  # incident|problem|change|service_request|question
    # shared priority-matrix inputs (incident + service_request)
    impact = Column(String(10), nullable=True)             # low | medium | high
    urgency = Column(String(10), nullable=True)            # low | medium | high
    # change
    change_type = Column(String(20), nullable=True)        # standard | normal | emergency
    change_risk = Column(String(10), nullable=True)        # low | medium | high
    planned_start = Column(DateTime, nullable=True)
    planned_end = Column(DateTime, nullable=True)
    implementation_plan = Column(Text, nullable=True)
    backout_plan = Column(Text, nullable=True)
    approval_state = Column(String(20), nullable=True)     # draft|pending_approval|approved|rejected|scheduled|in_progress|review|closed|cancelled
    approved_by = Column(String(255), nullable=True)       # agent email
    approved_at = Column(DateTime, nullable=True)
    # Why a would-be-auto-approved (Standard) change was escalated to CAB — set by
    # the exposure-aware governance rule (approvals.requirements_for_change) when the
    # change's CI or a descendant is internet-facing / PCI. Lives on the ticket (like
    # approval_state/approved_by above) so change list/detail rows expose it with no
    # join; create_all can't add it to existing tenant DBs, so itsm_seed ALTERs it in.
    escalation_reason = Column(Text, nullable=True)
    # problem
    root_cause = Column(Text, nullable=True)
    workaround = Column(Text, nullable=True)
    known_error = Column(Boolean, server_default=text("false"))
    problem_resolution = Column(Text, nullable=True)
    # ponytail: JSON list of incident ids; add a link table only if reverse-lookup/perf ever matters.
    linked_incident_ids = Column(Text, nullable=True)      # JSON array of HDTicket ids, e.g. "[12,15]"
    # ITIL cross-process origin (Batch 4 linkage A): a change's originating
    # incident/problem. Soft self-link (plain Integer, no FK — like ava_asset_id)
    # so reverse surfacing ("Problem #X -> its changes", "part of Problem #X") is a
    # tenant-scoped query with no delete-order coupling. Incident<->Problem stays
    # on linked_incident_ids above; one scalar parent is cleaner than a bridge here.
    origin_ticket_id = Column(Integer, nullable=True, index=True)
    origin_process = Column(String(20), nullable=True)     # 'incident' | 'problem'
    # service request
    request_category = Column(String(100), nullable=True)
    request_subcategory = Column(String(100), nullable=True)
    # ITSM catalogue/CMDB links (workbook ingest, models/_62). Plain nullable FK
    # columns; create_all can't add these to existing tenant DBs, so itsm_seed
    # ALTERs them in.
    business_service_id = Column(Integer, ForeignKey("grc_hd_business_service.id"), nullable=True, index=True)
    ci_id = Column(Integer, ForeignKey("grc_hd_ci.id"), nullable=True, index=True)
    request_item_id = Column(Integer, ForeignKey("grc_hd_request_item.id"), nullable=True)
    incident_category_id = Column(Integer, ForeignKey("grc_hd_incident_category.id"), nullable=True, index=True)
    problem_category_id = Column(Integer, ForeignKey("grc_hd_problem_category.id"), nullable=True, index=True)
    change_category_id = Column(Integer, ForeignKey("grc_hd_change_category.id"), nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    status = relationship("HDTicketStatus")
    priority = relationship("HDTicketPriority")
    ticket_type = relationship("HDTicketType")
    team = relationship("Team")  # ComplyVerse Administration team (grc_teams)
    sla = relationship("HDServiceLevelAgreement")
    customer = relationship("HDCustomer")
    feedback = relationship("HDTicketFeedbackOption")
    merged_with = relationship("HDTicket", remote_side=[id], foreign_keys=[merged_with_id])
    split_from = relationship("HDTicket", remote_side=[id], foreign_keys=[ticket_split_from_id])
    department = relationship("HDDepartment", foreign_keys=[department_id])

    __table_args__ = (
        Index("ix_hd_ticket_tenant_status", "tenant_id", "status_id"),
    )


class HDTicketComment(Base):
    """Internal agent note on a ticket — repurposed as the native equivalent of
    Frappe's core `Comment` (comment_type "Comment"), the real internal-note
    store (logic spec §4.2). Frappe's own `HD Ticket Comment` doctype is
    deprecated; here the table is the live internal-notes store."""
    __tablename__ = "grc_hd_ticket_comment"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    reference_ticket_id = Column(Integer, ForeignKey("grc_hd_ticket.id", ondelete="CASCADE"),
                                 nullable=True, index=True)
    content = Column(Text, nullable=True)
    commented_by = Column(String(255), nullable=True)      # -> Frappe User
    is_pinned = Column(Boolean, default=False)
    # `reactions` (Table HD Comment Reaction) deferred — reactions not converted.

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    ticket = relationship("HDTicket")


class HDCommunication(Base):
    """Customer-facing reply thread for a ticket — the native equivalent of
    Frappe's core `Communication` doctype (logic spec §4.1).

    The forked Helpdesk builds a ticket's thread from THREE core stores, not the
    vestigial `HD Ticket Comment`/`HD Ticket Activity` doctypes (spec §4):
      * replies (customer email in/out)   -> this table (`sent_or_received`)
      * internal agent notes              -> repurposed `HDTicketComment`
      * field-change / system activity log -> repurposed `HDTicketActivity`
    So the model set is reconciled by ADDING this one table and REPURPOSING the
    two "vestigial" ones, rather than leaving the conversation unmodelled.
    """
    __tablename__ = "grc_hd_communication"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    reference_ticket_id = Column(Integer, ForeignKey("grc_hd_ticket.id", ondelete="CASCADE"),
                                 nullable=False, index=True)
    sent_or_received = Column(String(20), nullable=False, default="Sent")  # Sent (agent) | Received (customer)
    sender = Column(String(255), nullable=True)            # agent/customer email
    content = Column(Text, nullable=True)                  # HTML body
    communication_date = Column(DateTime, nullable=True, default=datetime.utcnow)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    ticket = relationship("HDTicket")


class HDTicketActivity(Base):
    """Field-change / system-event log for a ticket — the native equivalent of
    Frappe's `Version` + `Info`-comment activity feed (logic spec §4.3).

    Frappe's own `HD Ticket Activity` doctype is an empty `pass` controller that
    nothing writes; here the table is REPURPOSED as the real change log that the
    ticket core appends to on status/assignment/field changes."""
    __tablename__ = "grc_hd_ticket_activity"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    ticket_id = Column(Integer, ForeignKey("grc_hd_ticket.id", ondelete="CASCADE"),
                       nullable=True, index=True)
    action = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    ticket = relationship("HDTicket")


# ----------------------------------------------------------------------------
# PEOPLE
# ----------------------------------------------------------------------------
class HDAgent(Base):
    __tablename__ = "grc_hd_agent"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    user = Column(String(255), nullable=False)             # -> Frappe/ComplyVerse User (login email), reqd
    agent_name = Column(String(255), nullable=False)       # reqd
    user_image = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    availability = Column(String(60), nullable=True)       # -> HD Agent Status (not converted)
    availability_changed_on = Column(DateTime, nullable=True)
    availability_changed_by = Column(String(255), nullable=True)  # -> Frappe User

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_agent_user", "tenant_id", "user", unique=True),
    )


# NOTE: HDTeam / HDTeamMember are UNUSED by routing as of the teams unification.
# Help Desk routing teams are now ComplyVerse Administration teams (grc_teams / Team),
# managed in Administration → Teams. These two classes are kept only so the
# (empty) legacy tables still map; nothing reads or writes them. Safe to drop in
# a later cleanup migration.
class HDTeamMember(Base):
    """Child of HD Team (istable, Table MultiSelect of users). UNUSED — see note above."""
    __tablename__ = "grc_hd_team_member"

    id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("grc_hd_team.id", ondelete="CASCADE"),
                     nullable=False, index=True)
    idx = Column(Integer, nullable=True)

    user = Column(String(255), nullable=True)              # -> Frappe/ComplyVerse User

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    team = relationship("HDTeam", back_populates="users")


class HDTeam(Base):
    __tablename__ = "grc_hd_team"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    team_name = Column(String(140), nullable=False)        # reqd, unique per tenant
    assignment_rule = Column(String(255), nullable=True)   # -> Frappe Assignment Rule (not converted)
    ignore_restrictions = Column(Boolean, default=False)
    disabled = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    users = relationship("HDTeamMember", back_populates="team",
                         cascade="all, delete-orphan", order_by="HDTeamMember.idx")

    __table_args__ = (
        Index("uq_hd_team_name", "tenant_id", "team_name", unique=True),
    )


class HDCustomer(Base):
    __tablename__ = "grc_hd_customer"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    image = Column(String(255), nullable=True)
    customer_name = Column(String(255), nullable=True)     # unique per tenant
    customer_type = Column(String(30), nullable=True)      # Company | Individual | Partnership
    domain = Column(String(255), nullable=True)
    erpnext_customer = Column(String(255), nullable=True)  # hidden external ref
    country = Column(String(140), nullable=True)           # -> Frappe Country
    primary_contact = Column(String(255), nullable=True)   # -> Frappe Contact
    email_id = Column(String(255), nullable=True)
    mobile_no = Column(String(60), nullable=True)
    # `contacts` (Table HD Customer Member) deferred — child doctype not in scope.

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_customer_name", "tenant_id", "customer_name", unique=True),
    )


# ----------------------------------------------------------------------------
# SLA
# ----------------------------------------------------------------------------
class HDServiceLevelPriority(Base):
    """Child of HD Service Level Agreement (istable): per-priority targets."""
    __tablename__ = "grc_hd_service_level_priority"

    id = Column(Integer, primary_key=True)
    sla_id = Column(Integer, ForeignKey("grc_hd_service_level_agreement.id", ondelete="CASCADE"),
                    nullable=False, index=True)
    idx = Column(Integer, nullable=True)

    priority_id = Column(Integer, ForeignKey("grc_hd_ticket_priority.id"), nullable=True)
    default_priority = Column(Boolean, default=False)
    response_time = Column(Float, nullable=True)           # Duration (seconds)
    resolution_time = Column(Float, nullable=True)         # Duration (seconds)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    sla = relationship("HDServiceLevelAgreement", back_populates="priorities")
    priority = relationship("HDTicketPriority")


class HDServiceDay(Base):
    """Child of HD Service Level Agreement (istable): working hours per weekday."""
    __tablename__ = "grc_hd_service_day"

    id = Column(Integer, primary_key=True)
    sla_id = Column(Integer, ForeignKey("grc_hd_service_level_agreement.id", ondelete="CASCADE"),
                    nullable=False, index=True)
    idx = Column(Integer, nullable=True)

    workday = Column(String(20), nullable=False)           # Monday..Sunday, reqd
    start_time = Column(Time, nullable=True)               # reqd in Frappe
    end_time = Column(Time, nullable=True)                 # reqd in Frappe

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    sla = relationship("HDServiceLevelAgreement", back_populates="service_days")


class HDHoliday(Base):
    """Child of HD Service Holiday List (istable)."""
    __tablename__ = "grc_hd_holiday"

    id = Column(Integer, primary_key=True)
    holiday_list_id = Column(Integer, ForeignKey("grc_hd_service_holiday_list.id", ondelete="CASCADE"),
                             nullable=False, index=True)
    idx = Column(Integer, nullable=True)

    holiday_date = Column(Date, nullable=False)            # reqd
    description = Column(Text, nullable=True)              # reqd in Frappe
    weekly_off = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    holiday_list = relationship("HDServiceHolidayList", back_populates="holidays")


class HDServiceHolidayList(Base):
    __tablename__ = "grc_hd_service_holiday_list"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    holiday_list_name = Column(String(140), nullable=False)  # reqd, unique per tenant
    from_date = Column(Date, nullable=True)                # reqd in Frappe
    to_date = Column(Date, nullable=True)                  # reqd in Frappe
    total_holidays = Column(Integer, nullable=True)
    weekly_off = Column(String(20), nullable=True)
    color = Column(String(30), nullable=True)
    description = Column(String(255), nullable=True)
    recurring_holidays = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    holidays = relationship("HDHoliday", back_populates="holiday_list",
                            cascade="all, delete-orphan", order_by="HDHoliday.idx")

    __table_args__ = (
        Index("uq_hd_holiday_list_name", "tenant_id", "holiday_list_name", unique=True),
    )


class HDServiceLevelAgreement(Base):
    __tablename__ = "grc_hd_service_level_agreement"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    service_level = Column(String(140), nullable=False)    # reqd, unique per tenant
    description = Column(String(255), nullable=True)
    enabled = Column(Boolean, default=True)
    default_sla = Column(Boolean, default=False)
    rank = Column(Integer, nullable=True)
    condition = Column(Text, nullable=True)                # Python expression
    condition_json = Column(Text, nullable=True)           # portal-generated condition
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    apply_sla_for_resolution = Column(Boolean, default=True)

    holiday_list_id = Column(Integer, ForeignKey("grc_hd_service_holiday_list.id"), nullable=True)  # reqd in Frappe
    default_priority_id = Column(Integer, ForeignKey("grc_hd_ticket_priority.id"), nullable=True)
    default_ticket_status_id = Column(Integer, ForeignKey("grc_hd_ticket_status.id"), nullable=True)
    ticket_reopen_status_id = Column(Integer, ForeignKey("grc_hd_ticket_status.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    priorities = relationship("HDServiceLevelPriority", back_populates="sla",
                              cascade="all, delete-orphan", order_by="HDServiceLevelPriority.idx")
    service_days = relationship("HDServiceDay", back_populates="sla",
                                cascade="all, delete-orphan", order_by="HDServiceDay.idx")
    holiday_list = relationship("HDServiceHolidayList", foreign_keys=[holiday_list_id])
    default_priority = relationship("HDTicketPriority", foreign_keys=[default_priority_id])
    default_ticket_status = relationship("HDTicketStatus", foreign_keys=[default_ticket_status_id])
    ticket_reopen_status = relationship("HDTicketStatus", foreign_keys=[ticket_reopen_status_id])

    __table_args__ = (
        Index("uq_hd_sla_service_level", "tenant_id", "service_level", unique=True),
    )


# ----------------------------------------------------------------------------
# KNOWLEDGE BASE
# ----------------------------------------------------------------------------
class HDArticleCategory(Base):
    __tablename__ = "grc_hd_article_category"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    category_name = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    icon = Column(String(140), nullable=True)
    # Frappe nested-set (nsm_parent_field=parent_hd_article_category) -> self-FK:
    parent_category_id = Column(Integer, ForeignKey("grc_hd_article_category.id"), nullable=True)
    code = Column(String(40), nullable=True)                # ITSM workbook KBC-* code (itsm_seed ALTER on existing tenants)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    parent = relationship("HDArticleCategory", remote_side=[id])


class HDArticle(Base):
    __tablename__ = "grc_hd_article"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    title = Column(String(255), nullable=False)            # reqd
    category_id = Column(Integer, ForeignKey("grc_hd_article_category.id"), nullable=True)
    status = Column(String(30), nullable=True, default="Draft")  # Published | Draft | Archived
    published_on = Column(DateTime, nullable=True)
    author = Column(String(255), nullable=True)            # -> Frappe User
    idx = Column(Integer, nullable=True)                   # publish-order within a category (Frappe before_save append)
    views = Column(Integer, nullable=True, default=0)
    content = Column(Text, nullable=True)
    code = Column(String(40), nullable=True)                # ITSM workbook KB-* code (itsm_seed ALTER on existing tenants)
    # title_slug is a Frappe virtual (computed) field -> not stored.

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    category = relationship("HDArticleCategory")


# ----------------------------------------------------------------------------
# SAVED REPLIES
# ----------------------------------------------------------------------------
class HDSavedReply(Base):
    __tablename__ = "grc_hd_saved_reply"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    title = Column(String(255), nullable=False)            # reqd, unique per tenant
    message = Column(Text, nullable=False)                 # reqd
    scope = Column(String(20), nullable=False, default="Global")  # Global | Team | Personal
    owner = Column(String(255), nullable=True, index=True)  # creator email — Personal-scope read grant (Frappe doc owner)
    actions = Column(JSON, nullable=True)
    # `teams` (Table MultiSelect HD Saved Reply Team) deferred — child doctype not in scope.

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_saved_reply_title", "tenant_id", "title", unique=True),
    )


# ----------------------------------------------------------------------------
# FEEDBACK
# ----------------------------------------------------------------------------
class HDTicketFeedbackOption(Base):
    __tablename__ = "grc_hd_ticket_feedback_option"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    rating = Column(Float, nullable=True)                  # Frappe Rating (0..1)
    label = Column(String(140), nullable=True)             # unique per tenant
    disabled = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_feedback_option_label", "tenant_id", "label", unique=True),
    )


# =============================================================================
# Engine conversion, step 3 — tables the first pass deferred.
# Each is a faithful 1:1 of the forked Frappe DocType JSON (same field names,
# Link->FK/relationship, Check->Boolean, Select->String, Duration->Float, etc.),
# added so the remaining controller logic (agent availability, customer/contact
# CRUD, article feedback, saved-reply scope, saved views, settings, tags) can be
# converted onto real tables instead of being stubbed.
# =============================================================================

# ----------------------------------------------------------------------------
# PEOPLE — agent availability catalog + customer membership + contact store
# ----------------------------------------------------------------------------
class HDAgentStatus(Base):
    """`HD Agent Status` — the availability catalog HD Agent.availability points at.
    (HDAgent.availability stays a String holding this row's agent_status name, as
    Frappe's Link stores the doc name.)"""
    __tablename__ = "grc_hd_agent_status"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    agent_status = Column(String(140), nullable=True)      # unique per tenant (Frappe autoname = this)
    status_order = Column(Integer, nullable=True)
    category = Column(String(30), nullable=False)          # Active | Away | Unavailable, reqd
    color = Column(String(30), nullable=True)
    enabled = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_agent_status_name", "tenant_id", "agent_status", unique=True),
    )


class HDContact(Base):
    """Native conversion of the Frappe core `Contact` surface the Help Desk uses
    (contact.py / customer.py): the requester/customer person. Frappe's Contact
    carries email/phone child tables; here the primary email/mobile/phone are kept
    inline (what Help Desk reads), with the child rows dropped as layout detail."""
    __tablename__ = "grc_hd_contact"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    first_name = Column(String(140), nullable=True)
    last_name = Column(String(140), nullable=True)
    email_id = Column(String(255), nullable=True)          # primary email
    mobile_no = Column(String(60), nullable=True)
    phone = Column(String(60), nullable=True)
    company_name = Column(String(255), nullable=True)
    image = Column(String(255), nullable=True)
    user = Column(String(255), nullable=True)              # -> ComplyVerse/Frappe User login (invited contacts)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_hd_contact_tenant_email", "tenant_id", "email_id"),
    )


class HDCustomerMember(Base):
    """Child of HD Customer (istable): the customer<->contact membership + manager
    flag that HD Customer's role/permission logic depends on."""
    __tablename__ = "grc_hd_customer_member"

    id = Column(Integer, primary_key=True)
    customer_id = Column(Integer, ForeignKey("grc_hd_customer.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    idx = Column(Integer, nullable=True)

    contact_id = Column(Integer, ForeignKey("grc_hd_contact.id"), nullable=True)  # Frappe Link->Contact, reqd
    is_manager = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    customer = relationship("HDCustomer", backref="contacts")
    contact = relationship("HDContact")


# ----------------------------------------------------------------------------
# KNOWLEDGE BASE — per-user article like/dislike
# ----------------------------------------------------------------------------
class HDArticleFeedback(Base):
    """`HD Article Feedback` — one row per (user, article): 0 none / 1 like / 2 dislike."""
    __tablename__ = "grc_hd_article_feedback"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    article_id = Column(Integer, ForeignKey("grc_hd_article.id", ondelete="CASCADE"),
                        nullable=True, index=True)
    user = Column(String(255), nullable=True)              # -> User
    feedback = Column(Integer, nullable=True, default=0)    # 0 none | 1 like | 2 dislike

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    article = relationship("HDArticle")

    __table_args__ = (
        Index("uq_hd_article_feedback_user", "article_id", "user", unique=True),
    )


# ----------------------------------------------------------------------------
# SAVED REPLIES — Team-scope child
# ----------------------------------------------------------------------------
class HDSavedReplyTeam(Base):
    """Child of HD Saved Reply (istable): the teams a Team-scoped reply is visible to."""
    __tablename__ = "grc_hd_saved_reply_team"

    id = Column(Integer, primary_key=True)
    saved_reply_id = Column(Integer, ForeignKey("grc_hd_saved_reply.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    idx = Column(Integer, nullable=True)

    team_id = Column(Integer, ForeignKey("grc_teams.id"), nullable=True)  # ComplyVerse Administration team (grc_teams)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    saved_reply = relationship("HDSavedReply", backref="teams")
    team = relationship("Team")


# ----------------------------------------------------------------------------
# SAVED VIEWS — persisted list / kanban / group-by views
# ----------------------------------------------------------------------------
class HDView(Base):
    """`HD View` — a saved list/group_by/kanban view (filters/columns/order)."""
    __tablename__ = "grc_hd_view"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    label = Column(String(140), nullable=True)
    icon = Column(String(140), nullable=True)
    user = Column(String(255), nullable=True)              # -> User (owner of a personal view)
    is_default = Column(Boolean, default=False)
    is_customer_portal = Column(Boolean, default=False)
    is_standard = Column(Boolean, default=False)
    type = Column(String(20), nullable=True, default="list")  # list | group_by | kanban
    dt = Column(String(140), nullable=True)                # target doctype/name (e.g. "HD Ticket")
    route_name = Column(String(140), nullable=True)
    pinned = Column(Boolean, default=False)
    public = Column(Boolean, default=False)
    filters = Column(Text, nullable=True)                  # Frappe Code (JSON string)
    order_by = Column(Text, nullable=True)
    load_default_columns = Column(Boolean, default=False)
    columns = Column(Text, nullable=True)
    rows = Column(Text, nullable=True)
    group_by_field = Column(String(140), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ----------------------------------------------------------------------------
# TAGS — native tag store + ticket join (replaces Frappe core Tag / Tag Link)
# ----------------------------------------------------------------------------
class HDTag(Base):
    """Native tag master (Frappe used core `Tag` with app=helpdesk + a color)."""
    __tablename__ = "grc_hd_tag"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    name = Column(String(140), nullable=True)
    color = Column(String(30), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_tag_name", "tenant_id", "name", unique=True),
    )


class HDTicketTag(Base):
    """Ticket<->tag join (Frappe core `Tag Link`)."""
    __tablename__ = "grc_hd_ticket_tag"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("grc_hd_ticket.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    tag_id = Column(Integer, ForeignKey("grc_hd_tag.id", ondelete="CASCADE"),
                    nullable=False, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    ticket = relationship("HDTicket", backref="tags")
    tag = relationship("HDTag")

    __table_args__ = (
        Index("uq_hd_ticket_tag", "ticket_id", "tag_id", unique=True),
    )


# ----------------------------------------------------------------------------
# SETTINGS — the `HD Settings` singleton, one row per tenant
# ----------------------------------------------------------------------------
class HDSettings(Base):
    """`HD Settings` (Frappe issingle) -> one row per tenant. Links to converted
    doctypes become *_id FKs; the Assignment-Rule link stays a String (not
    converted). Email-template / search-weight fields are kept as columns for
    faithful parity even where the outbound-mail workflow is not yet wired."""
    __tablename__ = "grc_hd_settings"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    # --- defaults (links to converted doctypes) ---
    default_priority_id = Column(Integer, ForeignKey("grc_hd_ticket_priority.id"), nullable=True)
    default_agent_status_id = Column(Integer, ForeignKey("grc_hd_agent_status.id"), nullable=True)  # reqd in Frappe
    default_ticket_type_id = Column(Integer, ForeignKey("grc_hd_ticket_type.id"), nullable=True)
    default_ticket_status_id = Column(Integer, ForeignKey("grc_hd_ticket_status.id"), nullable=True)  # reqd
    ticket_reopen_status_id = Column(Integer, ForeignKey("grc_hd_ticket_status.id"), nullable=True)   # reqd
    update_status_to_id = Column(Integer, ForeignKey("grc_hd_ticket_status.id"), nullable=True)
    auto_close_status_id = Column(Integer, ForeignKey("grc_hd_ticket_status.id"), nullable=True)
    send_email_feedback_on_status_id = Column(Integer, ForeignKey("grc_hd_ticket_status.id"), nullable=True)
    base_support_rotation = Column(String(255), nullable=True)  # -> Frappe Assignment Rule (not converted)

    # --- routing / permission flags ---
    restrict_tickets_by_agent_group = Column(Boolean, default=False)
    do_not_restrict_tickets_without_an_agent_group = Column(Boolean, default=False)
    assign_within_team = Column(Boolean, default=False)
    disable_saved_replies_global_scope = Column(Boolean, default=False)
    prefer_knowledge_base = Column(Boolean, default=False)
    allow_anyone_to_create_tickets = Column(Boolean, default=False)
    is_feedback_mandatory = Column(Boolean, default=True)
    enable_comment_reactions = Column(Boolean, default=False)
    auto_set_customer_from_contact = Column(Boolean, default=True)

    # --- auto status / auto close ---
    auto_update_status = Column(Boolean, default=False)
    auto_close_tickets = Column(Boolean, default=False)
    auto_close_after_days = Column(Integer, default=14)

    # --- outside-hours banner ---
    enable_outside_hours_banner = Column(Boolean, default=False)
    outside_working_hours_message = Column(Text, nullable=True)

    # --- branding / setup ---
    brand_name = Column(String(255), nullable=True)
    brand_logo = Column(String(255), nullable=True)
    favicon = Column(String(255), nullable=True)
    setup_complete = Column(Boolean, default=False)
    initial_helpdesk_name_setup_skipped = Column(Boolean, default=False)
    show_customer_portal_permission_notice = Column(Boolean, default=False)
    show_ticket_field_permission_notice = Column(Boolean, default=False)
    persona_captured = Column(Boolean, default=False)

    # --- article search weights ---
    name_weight = Column(Integer, default=1)
    subject_weight = Column(Integer, default=6)
    description_weight = Column(Integer, default=5)
    headings_weight = Column(Integer, default=8)

    # --- email workflow toggles + templates ---
    skip_email_workflow = Column(Boolean, default=False)
    instantly_send_email = Column(Boolean, default=False)
    enable_email_ticket_feedback = Column(Boolean, default=False)
    feedback_email_content = Column(Text, nullable=True)
    send_acknowledgement_email = Column(Boolean, default=False)
    acknowledgement_email_content = Column(Text, nullable=True)
    enable_reply_email_to_agent = Column(Boolean, default=True)
    reply_email_to_agent_content = Column(Text, nullable=True)
    enable_reply_email_via_agent = Column(Boolean, default=True)
    reply_via_agent_email_content = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_settings_tenant", "tenant_id", unique=True),
    )


# =============================================================================
# NET-NEW (not in Frappe) — Departments: a general multi-department intake layer
# over the converted engine. Frappe Helpdesk has only HD Team; ComplyVerse adds a thin
# Department that maps to a default Team so the EXISTING assignment + SLA engines
# route a ticket onwards unchanged. HDTicket.department_id / HDTicketType.department_id
# carry the link; routing (department -> default_team -> agent_group) happens in
# the create-ticket path.
# =============================================================================
class HDDepartment(Base):
    __tablename__ = "grc_hd_department"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    name = Column(String(140), nullable=False)             # Sales, Finance, IT/Security, HR, ...
    description = Column(Text, nullable=True)
    default_team_id = Column(Integer, ForeignKey("grc_teams.id"), nullable=True)  # tickets route here — ComplyVerse Administration team (grc_teams)
    enabled = Column(Boolean, default=True)
    code = Column(String(40), nullable=True)                # ITSM workbook DEPT-* short code, e.g. "IT" (itsm_seed ALTER on existing tenants)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    default_team = relationship("Team", foreign_keys=[default_team_id])

    __table_args__ = (
        Index("uq_hd_department_name", "tenant_id", "name", unique=True),
    )


# =============================================================================
# ATTACHMENTS (bank-hardening, functional gap) — persisted ticket/reply files.
# Before this, reply/ticket attachments were a no-op. One row per stored file.
# SAFE storage: the file on disk is named by `storage_key` (a random uuid hex),
# NEVER by the client-supplied `filename`, so a crafted name (e.g. "../../x")
# can never escape the tenant-scoped upload dir. `filename` is kept for DISPLAY
# and the download Content-Disposition only. create_all makes this table on new
# tenants; itsm_seed.ensure_attachment_table CREATEs it on existing ones.
# =============================================================================
class HDAttachment(Base):
    __tablename__ = "grc_hd_attachment"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    ticket_id = Column(Integer, ForeignKey("grc_hd_ticket.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    # Optional link to the specific reply (HDCommunication) the file rode in on.
    reply_id = Column(Integer, ForeignKey("grc_hd_communication.id", ondelete="SET NULL"),
                      nullable=True, index=True)

    filename = Column(String(255), nullable=False)     # ORIGINAL name — display / download only
    content_type = Column(String(140), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    # Random uuid-based key; the on-disk filename AND the only path component we
    # ever build from. Never the client filename → no path traversal.
    storage_key = Column(String(64), nullable=False)
    uploaded_by = Column(String(255), nullable=True)   # acting user email

    created_at = Column(DateTime, default=datetime.utcnow)

    ticket = relationship("HDTicket")

    __table_args__ = (
        Index("ix_hd_attachment_tenant_ticket", "tenant_id", "ticket_id"),
        Index("ix_hd_attachment_storage_key", "storage_key"),
    )
