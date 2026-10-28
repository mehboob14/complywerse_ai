"""Third-party risk: what we use a supplier for, each with its own tier and lifecycle
(vendor_risk/tpra/engagements.py).

An engagement is one use of a supplier by one part of the business. It is tiered,
assessed, approved and reassessed on its own: its assessments carry its id
(`grc_vendor_assessments.engagement_id`), and the supplier shows its worst open
engagement. `engagement_id` NULL is the General scope, the supplier as it always
was; a supplier with no rows here is exactly that.

The General row is made the first time an engagement is added, from the supplier's
facts and scores as they stood. From then on it holds General's own tier and scores,
because the supplier's become the worst of all its open engagements. General's facts,
active assessment, stage and review dates stay the supplier's own columns.

Ending an engagement deletes nothing: it is marked ended, with when and why.
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, text

from ._00_base import Base


class TPRAEngagement(Base):
    __tablename__ = "grc_tpra_engagements"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_general = Column(Boolean, nullable=False, default=False)
    owner_id = Column(Integer, nullable=True)            # the business owner of this use
    business_unit_id = Column(Integer, nullable=True)
    engagement_type = Column(String(40), nullable=True)  # tpra/intake.py ENGAGEMENTS
    data_access_level = Column(String(50), nullable=True)
    data_types_accessed = Column(JSON, nullable=True)
    services_provided = Column(JSON, nullable=True)
    criticality = Column(String(20), nullable=True)      # low | medium | high | critical: business criticality for tiering
    intake = Column(JSON, nullable=True)                 # {"answers": {...}, "justifications": {...}}, as on the supplier
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    # Kept by the lifecycle, like the supplier's own columns.
    tier = Column(String(20), nullable=True)
    inherent_risk_score = Column(Float, nullable=True)
    residual_risk_score = Column(Float, nullable=True)
    risk_rating = Column(String(20), nullable=True)
    rating_grade = Column(String(2), nullable=True)
    active_assessment_id = Column(Integer, nullable=True, index=True)
    lifecycle_stage = Column(String(40), nullable=True)
    reassessment_cadence_days = Column(Integer, nullable=True)
    next_reassessment_date = Column(DateTime, nullable=True)
    status = Column(String(20), nullable=False, default="active")   # active | ended
    ended_reason = Column(Text, nullable=True)
    archived_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_engagement_vendor", "vendor_id", "status"),
        # One General row per supplier, even when two people add its first engagement at once.
        Index("uq_tpra_engagement_general", "vendor_id", unique=True,
              postgresql_where=text("is_general"), sqlite_where=text("is_general")),
    )
