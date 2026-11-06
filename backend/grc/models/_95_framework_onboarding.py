"""Framework onboarding (DECISIONS D66; plan ``docs/framework-onboarding-plan.md``): the organisation profile asked once, and the
onboarding every library framework goes through before its compliance journey may start. Additive: three tables, no column anywhere else.
Rules and shapes: ``modules/framework_onboarding/``."""
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint

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
