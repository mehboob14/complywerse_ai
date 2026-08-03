"""Unified Control Library workbench — the WORK LAYER on top of the three control
SOURCES. A single working record (ControlWorkItem) points at its source
(internal control / framework control / normalized control); all the *work*
— assignment, status, effectiveness, test history, evidence, AI test-procedure
checklists, approval workflow and escalations — lives here, so the three source
tables stay untouched as pure definitions.

source_type / source_id:
  'internal'   → grc_internal_controls.id        (source = risk)
  'framework'  → grc_parsed_framework_controls.id (source = frameworks)
  'normalized' → grc_normalized_controls.id       (source = normalized controls)
"""
from ._43_scorecard_config import *  # noqa: F401,F403 — continue the model chain (Base, Column, Integer, String, Text, Boolean, DateTime, JSON, ForeignKey, UniqueConstraint, Index, datetime)


class ControlWorkItem(Base):
    """One workable control on the unified library surface. Assignment,
    effectiveness, status and dates live here; the source table is the
    definition. Denormalized display fields are cached from the source for fast
    listing/filtering (refreshed on write)."""
    __tablename__ = "grc_control_work_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    source_type = Column(String(20), nullable=False, index=True)   # internal | framework | normalized
    source_id = Column(Integer, nullable=False, index=True)         # id in the source table

    # cached-from-source display fields (so the list view needs no cross joins)
    code = Column(String(100), nullable=True)          # control code / reference
    name = Column(String(500), nullable=True)          # title
    description = Column(Text, nullable=True)
    domain = Column(String(255), nullable=True)
    category = Column(String(255), nullable=True)
    framework_name = Column(String(255), nullable=True)  # for framework source
    member_count = Column(Integer, default=0)            # for normalized: # framework members

    # assignment (reuse the certification pattern)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    assigned_to_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)  # legacy primary
    assigned_user_ids = Column(JSON, default=list)      # canonical multi-assignee [id, ...]

    # lifecycle / approval status (mirrors InternalControl.status)
    status = Column(String(50), default="draft")        # draft|pending_approval|active|inactive|deprecated
    workflow_status = Column(String(50), nullable=True) # pending_review|approved|rejected
    # compliance progress (mirrors ControlImplementation.status)
    implementation_status = Column(String(50), default="not_started")  # not_started|in_progress|implemented|verified|not_applicable

    # effectiveness + testing (mirrors InternalControl)
    design_effectiveness = Column(String(50), nullable=True)     # effective|partially_effective|ineffective|not_tested
    operating_effectiveness = Column(String(50), nullable=True)  # effective|partially_effective|ineffective|not_tested
    last_tested_at = Column(DateTime, nullable=True)
    next_test_date = Column(DateTime, nullable=True)
    frequency = Column(String(50), nullable=True)

    priority = Column(String(20), default="medium")     # low|medium|high|critical
    is_key_control = Column(Boolean, default=False)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "source_type", "source_id", name="uq_control_work_item_source"),
        Index("ix_control_work_item_lookup", "tenant_id", "source_type"),
    )


class ControlWorkTest(Base):
    """Effectiveness test record over a time window (mirrors InternalControlTest)."""
    __tablename__ = "grc_control_work_tests"

    id = Column(Integer, primary_key=True, index=True)
    work_item_id = Column(Integer, ForeignKey("grc_control_work_items.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False)

    test_type = Column(String(50), nullable=False)      # design | operating
    test_date = Column(DateTime, default=datetime.utcnow)
    test_period_start = Column(DateTime, nullable=True)
    test_period_end = Column(DateTime, nullable=True)
    tester_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    sample_size = Column(Integer, nullable=True)
    exceptions_found = Column(Integer, default=0)
    result = Column(String(50), nullable=False)         # effective|partially_effective|ineffective
    findings = Column(Text, nullable=True)
    recommendations = Column(Text, nullable=True)
    management_response = Column(Text, nullable=True)
    evidence_references = Column(JSON, default=list)
    status = Column(String(50), default="completed")    # in_progress|completed|reviewed
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ControlWorkTestProcedure(Base):
    """A persisted, numbered test-procedure point — the saved output of the
    'Get AI Recommendation' engine. Each point is a checkbox; evidence can be
    linked to it OPTIONALLY (via ControlWorkEvidence.test_procedure_id)."""
    __tablename__ = "grc_control_work_test_procedures"

    id = Column(Integer, primary_key=True, index=True)
    work_item_id = Column(Integer, ForeignKey("grc_control_work_items.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False)

    seq = Column(Integer, default=0)                    # 1,2,3… ordering
    procedure_type = Column(String(50), nullable=True)  # walkthrough|inquiry|observation|inspection|reperformance
    description = Column(Text, nullable=False)
    frequency = Column(String(100), nullable=True)
    sample_size = Column(String(100), nullable=True)
    source = Column(String(20), default="ai")           # ai | manual

    is_checked = Column(Boolean, default=False)
    checked_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    checked_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class ControlWorkEvidence(Base):
    """Evidence attached to a work item (mirrors ImplementationEvidence, with
    review). test_procedure_id set → the evidence backs a specific test-procedure
    point; null → it backs the control generally."""
    __tablename__ = "grc_control_work_evidence"

    id = Column(Integer, primary_key=True, index=True)
    work_item_id = Column(Integer, ForeignKey("grc_control_work_items.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False)
    test_procedure_id = Column(Integer, ForeignKey("grc_control_work_test_procedures.id"), nullable=True, index=True)

    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True)  # link into the shared evidence library
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)

    uploaded_at = Column(DateTime, default=datetime.utcnow)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    review_status = Column(String(50), default="pending")  # pending | approved | rejected
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)


class ControlWorkEscalation(Base):
    """Escalation rule (mirrors InternalControlEscalation)."""
    __tablename__ = "grc_control_work_escalations"

    id = Column(Integer, primary_key=True, index=True)
    work_item_id = Column(Integer, ForeignKey("grc_control_work_items.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False)

    escalation_level = Column(Integer, default=1)
    escalation_name = Column(String(100), nullable=False)
    trigger_condition = Column(String(100), nullable=False)  # test_failure|overdue_test|exception_found
    trigger_threshold = Column(Integer, nullable=True)
    escalate_to_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    escalate_to_role = Column(String(100), nullable=True)
    escalate_to_department_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True)
    escalation_timeframe_hours = Column(Integer, default=24)
    notification_required = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ControlWorkWorkflowAction(Base):
    """Approval-workflow history entry (mirrors InternalControlWorkflowAction)."""
    __tablename__ = "grc_control_work_workflow_actions"

    id = Column(Integer, primary_key=True, index=True)
    work_item_id = Column(Integer, ForeignKey("grc_control_work_items.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False)
    action = Column(String(50), nullable=False)         # submit|approve|reject|request_changes|escalate
    action_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    action_at = Column(DateTime, default=datetime.utcnow)
    from_status = Column(String(50), nullable=True)
    to_status = Column(String(50), nullable=True)
    comments = Column(Text, nullable=True)


class ControlWorkRiskLink(Base):
    """Risk association for a work item (mirrors InternalControlRiskLink) — lets
    any source control map to ERM risks (internal controls' source = risk)."""
    __tablename__ = "grc_control_work_risk_links"

    id = Column(Integer, primary_key=True, index=True)
    work_item_id = Column(Integer, ForeignKey("grc_control_work_items.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False)
    link_type = Column(String(50), default="mitigates")   # mitigates|monitors|detects
    effectiveness_rating = Column(String(50), nullable=True)  # high|medium|low
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    __table_args__ = (
        UniqueConstraint("work_item_id", "risk_id", name="uq_control_work_risk_link"),
    )


class ControlAssuranceSnapshot(Base):
    """A daily point-in-time snapshot of the tenant's control-assurance posture
    (overall + per-domain KPIs), so the hub can show REAL trend deltas instead of
    illustrative arrows. Written at most once per day, lazily, when the overview
    is first loaded that day."""
    __tablename__ = "grc_control_assurance_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    snapshot_date = Column(String(10), nullable=False)   # YYYY-MM-DD (one per tenant/day)
    controls = Column(Integer, default=0)
    tested = Column(Integer, default=0)
    effective = Column(Integer, default=0)
    partially_effective = Column(Integer, default=0)
    ineffective = Column(Integer, default=0)
    assigned = Column(Integer, default=0)
    evidence_pending = Column(Integer, default=0)
    overdue = Column(Integer, default=0)
    per_domain = Column(JSON, default=dict)              # {domain: {tested, effective, ...}}
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "snapshot_date", name="uq_control_assurance_snapshot_day"),
    )


# Ordered list of the workbench tables, for lazy creation (checkfirst=True).
CONTROL_WORKBENCH_MODELS = [
    ControlWorkItem,
    ControlWorkTestProcedure,   # before ControlWorkEvidence (FK target)
    ControlWorkTest,
    ControlWorkEvidence,
    ControlWorkEscalation,
    ControlWorkWorkflowAction,
    ControlWorkRiskLink,
    ControlAssuranceSnapshot,
]
