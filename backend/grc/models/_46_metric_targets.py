from ._45_report_definitions import *  # noqa: F401,F403 — continue the model chain (Base, Column, Integer, String, DateTime, JSON, ForeignKey, Index, UniqueConstraint, datetime, Boolean)

# `Float` isn't re-exported by the chain (same as Date in _42 / Boolean in _45),
# so import it explicitly.
from sqlalchemy import Float


class MetricTarget(Base):
    """A tenant's target / RAG thresholds for one trended metric.

    The metric *catalog* ships sensible default targets in code (so trend cards
    show a red/amber/green status out of the box); a row here overrides the
    default for one (metric, dimension, dimension_value) in one tenant. There is
    no Alembic in this app, so the table is created by the create_all self-heal
    on engine init and by an idempotent ensure-table in the trends service.

    Interpretation depends on the metric's direction (from the catalog):
      • up_good   — value ≥ target is on-target; ≥ warn is warning; else critical.
      • down_good — value ≤ target is on-target; ≤ warn is warning; else critical.
    `warn` is optional; when unset the status is a simple on/off-target split.
    """
    __tablename__ = "grc_metric_target"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    metric = Column(String(60), nullable=False)
    dimension = Column(String(40), nullable=False, default="overall")
    dimension_value = Column(String(120), nullable=False, default="all")

    target = Column(Float, nullable=True)
    warn = Column(Float, nullable=True)
    critical = Column(Float, nullable=True)

    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "metric", "dimension", "dimension_value",
                         name="uq_metric_target"),
    )
