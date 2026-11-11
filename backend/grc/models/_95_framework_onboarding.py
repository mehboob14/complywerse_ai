"""Framework onboarding (DECISIONS D66; plan ``docs/framework-onboarding-plan.md``): the organisation profile asked once, and the
onboarding every library framework goes through before its compliance journey may start. Additive: three tables, no column anywhere else.
Rules and shapes: ``modules/framework_onboarding/``."""
from datetime import datetime

from sqlalchemy import JSON, Column, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from ._00_base import Base


class FrameworkOrgProfile(Base):
    """The organisation profile: one row per tenant. ``values`` is {group: {field: value}}; the table fields keep rows that carry a
    stable ``id`` so a framework's scope can pick them. The five facts that live on the Tenant row (legal entity, industry, size,
    geography, regulatory scope) are NOT stored here: they are written through to the Tenant."""
    __tablename__ = "grc_fw_org_profile"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    values = Column(JSON, default=dict)
    groups_reviewed = Column(JSON, default=dict)            # {group: {"at": iso, "by": user id}}
    catalog_version = Column(Integer, default=1)
    updated_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class FrameworkOnboarding(Base):
    """One onboarding per tenant per library framework (an UploadedFramework row).
    States: draft -> ready (all required checks pass, waiting for approval) -> complete (approved, snapshot frozen); ``underway`` is the
    escape for a framework already running (a recorded reason; ``underway_source`` legacy = backfilled for a journey that pre-dates this)."""
    __tablename__ = "grc_framework_onboardings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id", ondelete="CASCADE"), nullable=False, index=True)
    framework_slug = Column(String(64), nullable=True)
    family = Column(String(40), nullable=False, default="general")
    catalog_version = Column(Integer, default=1)
    state = Column(String(20), nullable=False, default="draft")      # draft | ready | complete | underway
    answers = Column(JSON, default=dict)                    # {step: {field: value}}
    snapshot = Column(JSON, nullable=True)                  # frozen at approval: answers, the organisation rows picked, the catalog version
    submitted_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    approved_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approval_note = Column(Text, nullable=True)
    underway_kind = Column(String(80), nullable=True)
    underway_reason = Column(Text, nullable=True)
    underway_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    underway_at = Column(DateTime, nullable=True)
    underway_source = Column(String(10), nullable=True)     # manual | legacy
    reopened_count = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "uploaded_framework_id", name="uq_fw_onboarding_framework"),)


class FrameworkOnboardingEvent(Base):
    """Append-only history of an onboarding: created, saved, submitted, approved, reopened, marked_underway, journey_started, journey_blocked."""
    __tablename__ = "grc_framework_onboarding_events"

    id = Column(Integer, primary_key=True, index=True)
    onboarding_id = Column(Integer, ForeignKey("grc_framework_onboardings.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(30), nullable=False)
    actor_id = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    detail = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_fw_onboarding_event_order", "onboarding_id", "id"),)


class FrameworkExistingCompliance(Base):
    """What an organisation says it already has for a framework (a certificate, a report, an assessment, a plan): one row per item, kept apart from
    the compliance work itself. A row is a CLAIM with the documents that support it (``evidence_ids`` point at Evidence rows) and how far anyone has checked
    it (``verification_status``: declared -> evidence_received -> reviewed -> verified). It never sets a control or requirement status: only the platform's
    own assessments do. Rules: ``modules/framework_onboarding/existing.py``."""
    __tablename__ = "grc_fw_existing_compliance"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    onboarding_id = Column(Integer, ForeignKey("grc_framework_onboardings.id", ondelete="CASCADE"), nullable=False, index=True)
    assessment_type = Column(String(120), nullable=False)     # one of the framework's own types (catalog ``existing_types``)
    framework_version = Column(String(60), nullable=True)     # the version that was assessed
    assessment_date = Column(Date, nullable=True)
    valid_until = Column(Date, nullable=True)                 # a certificate's or attestation's expiry
    period_start = Column(Date, nullable=True)                # the period a report covers
    period_end = Column(Date, nullable=True)
    assessor_or_issuer = Column(String(200), nullable=True)
    scope_coverage = Column(String(20), nullable=True)        # Yes, completely | Partially | No | Not sure: does it cover the scope being set up
    scope_note = Column(Text, nullable=True)
    evidence_ids = Column(JSON, default=list)                 # Evidence rows uploaded here
    verification_status = Column(String(20), nullable=False, default="declared")
    verified_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    note = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class FrameworkVersionBaseline(Base):
    """What an approved (or underway) onboarding was settled against: the framework version the library held, the control texts, the shape of the
    questions and the version in use. ONE row per onboarding, moved on only by a person's review ("still correct") or a new approval; the earlier values go to
    ``history``. It is what a later change is measured against: nothing here is ever an answer, a snapshot or a compliance status, and the approved
    snapshot is not touched. ``source``: approval | first_check (an onboarding approved before this existed: tracked from then on) | review.
    Rules: ``modules/framework_onboarding/versioning.py``; design ``docs/framework-version-management.md``."""
    __tablename__ = "grc_fw_version_baseline"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    onboarding_id = Column(Integer, ForeignKey("grc_framework_onboardings.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id", ondelete="SET NULL"), nullable=True)   # the library row it was taken against
    framework_name = Column(String(255), nullable=True)
    library_version = Column(String(60), nullable=True)       # the library row's own version text
    library_key = Column(String(40), nullable=True)           # the catalog's key for it (catalog framework entry ``versions``), when it names one
    version_key = Column(String(40), nullable=True)           # the version in use: the answered one, else the library's
    declared_answer = Column(String(120), nullable=True)      # the version the organisation answered, as it answered
    catalog_version = Column(Integer, default=1)
    signature = Column(JSON, default=dict)                    # the questions as they were: {fields: {step.field: shape}, gate: {...}, versions: [...]}
    controls = Column(JSON, default=dict)                     # {control id: short hash of its text}
    controls_count = Column(Integer, default=0)
    source = Column(String(20), nullable=False, default="approval")
    taken_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    taken_at = Column(DateTime, default=datetime.utcnow)
    history = Column(JSON, default=list)                      # [{taken_at, source, library_version, version_key}], oldest first
    notified_change_id = Column(String(40), nullable=True)    # the change the program owner was last told about (never tell twice)
    notified_at = Column(DateTime, nullable=True)
    last_check = Column(JSON, nullable=True)                  # what the last check found, for the register: {at, state, reasons, counts}
    review_state = Column(String(20), nullable=True)          # changes_needed (reopened to change) | migrated (a newer onboarding took over); empty otherwise
    successor_onboarding_id = Column(Integer, ForeignKey("grc_framework_onboardings.id", ondelete="SET NULL"), nullable=True)
