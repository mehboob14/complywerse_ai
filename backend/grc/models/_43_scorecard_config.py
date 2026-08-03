from ._42_metric_snapshots import *  # noqa: F401,F403 — continue the model chain (Base, Column, Integer, String, DateTime, JSON, ForeignKey, Index, UniqueConstraint, datetime)


class ScorecardConfig(Base):
    """Per-tenant overrides for a module scorecard — the section weights and the
    target line. Only overrides are stored; anything absent falls back to the
    built-in default. One row per (tenant, module).

    config JSON shape: {"weights": {section_key: fraction, ...}, "target": 85}
    """
    __tablename__ = "grc_scorecard_config"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    module = Column(String(40), nullable=False)   # 'erm', 'governance', 'compliance', 'assets', ...
    config = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "module", name="uq_scorecard_config"),
        Index("ix_scorecard_config_lookup", "tenant_id", "module"),
    )
