from ._39_ai_risk_assessment_template import *  # noqa: F401,F403

# =============================================================================
# 40. Generic AI Recommendation Store
# =============================================================================
#
# A tenant-shared store so any AI-generated recommendation a user reviews and
# SAVES persists and is visible to every other user with access to that module
# (instead of being recomputed/ephemeral per request).
#
# Keyed by (tenant_id, module, entity_type, entity_id, recommendation_type).
# Saving again for the same key UPSERTS — the latest reviewed output wins.


class AIRecommendation(Base):
    """One saved AI recommendation, shared across the tenant."""
    __tablename__ = "grc_ai_recommendations"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # Logical surface, e.g. erm_advanced_analytics | governance_policy_draft |
    # workflow_nl_design | compliance_plugin_analysis | erm_risk_suggestion.
    module = Column(String(60), nullable=False, index=True)
    # What the recommendation is attached to (risk | analytics | document …).
    entity_type = Column(String(60), nullable=True)
    # String so non-integer keys work; NULL = a module-level (not per-entity) rec.
    entity_id = Column(String(80), nullable=True, index=True)
    recommendation_type = Column(String(80), nullable=False)
    title = Column(String(300), nullable=True)
    summary = Column(Text, nullable=True)
    output = Column(JSON, default=dict)          # full AI result the UI re-renders
    model = Column(String(120), nullable=True)   # which model produced it
    status = Column(String(30), default="saved")  # saved | draft
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_ai_rec_tenant_module", "tenant_id", "module"),
        Index("ix_ai_rec_key", "tenant_id", "module", "entity_type", "entity_id", "recommendation_type"),
    )
