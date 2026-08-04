from ._41_tpra_lifecycle_models import *  # noqa: F401,F403 — continue the section chain

# `Date` isn't used elsewhere in the chain, so import it explicitly (everything
# else — Base, Column, Integer, String, Float, DateTime, JSON, ForeignKey, Index,
# UniqueConstraint, datetime — flows in via the star import above).
from sqlalchemy import Date


class MetricSnapshot(Base):
    """Generic portfolio-metric time-series (dashboard trends + reconciled headline
    history). One row per (tenant, metric, dimension, dimension_value, as_of_date) —
    a daily idempotent UPSERT. Values are computed through grc.services.metrics (the
    single source of truth), so stored history == live == every screen.

    metric examples: portfolio_avg_residual, portfolio_avg_inherent, open_risks,
      residual_band_<band>, compliance_pct, control_impl_pct, open_critical_issues,
      vuln_open_<sev>, board_readiness, appetite_utilization.
    dimension / dimension_value scope a metric (overall/all, risk_category/<cat>,
      framework/<name>, business_unit/<id>, severity_band/<band>).
    """
    __tablename__ = "grc_metric_snapshot"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    metric = Column(String(60), nullable=False)
    dimension = Column(String(40), nullable=False, default="overall")
    dimension_value = Column(String(120), nullable=False, default="all")
    as_of_date = Column(Date, nullable=False)
    value = Column(Float, nullable=True)
    meta = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "metric", "dimension", "dimension_value", "as_of_date",
                         name="uq_metric_snapshot"),
        Index("ix_metric_snapshot_lookup", "tenant_id", "metric", "as_of_date"),
    )
