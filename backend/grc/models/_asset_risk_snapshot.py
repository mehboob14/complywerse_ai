"""ComplyVerse risk posture — daily per-asset risk snapshot.

Risk Posture scores are computed LIVE from current data and are not otherwise
stored (grc/modules/risk_posture/service.py says "no cache in v1"). That makes a
score impossible to put in a report or to trend over time. This table is the
persistence layer:

  * ONE row per asset per day (UNIQUE on tenant+asset+snapshot_date).
  * Written by the risk-posture sweep (compute_tenant_posture) WRITE-ON-CHANGE,
    so routine dashboard polls stay read-only — the old per-poll write
    amplification is NOT reintroduced.
  * Within a day the row is updated in place to the latest computation; a new
    day appends a fresh row = clean daily history.
  * A downloaded report refreshes the current day's rows first, so the report
    always reflects risk current to that moment.

New additive table `grc_asset_risk_snapshots`. Created per-tenant by
Base.metadata.create_all(checkfirst=True) on tenant-engine init — registering
this class in grc/models/__init__.py is all that's needed; it appears on the
next backend start for each tenant DB (no ALTER, it's a brand-new table).
"""
from ._00_base import (
    Base,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    datetime,
)


class AssetRiskSnapshot(Base):
    __tablename__ = "grc_asset_risk_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # Plain int (no FK): an asset can be hard-deleted, but a snapshot is a
    # historical record that must survive its asset. asset_name is denormalized
    # so a report stays readable even after the asset is gone.
    asset_id = Column(Integer, index=True)
    asset_name = Column(String(255))

    # The calendar day this snapshot belongs to. Dedup key: one row per
    # (tenant, asset, day).
    snapshot_date = Column(Date, nullable=False, index=True)

    # Composite 0-100, higher = worse. NULL = unknown (nothing measured yet;
    # the engine refuses to invent a number).
    score = Column(Float, nullable=True)
    band = Column(String(40))                   # severity label: contained/watch/elevated/severe/unknown
    data_quality = Column(Float, nullable=True)  # % of weight covered by known dimensions
    known_dimensions = Column(String(120))       # comma-joined known dimension keys

    # Each dimension's CONTRIBUTION to the composite (0-100, renormalized; the
    # known ones sum to ~score). NULL where the dimension didn't apply (e.g. an
    # external/EASM asset has none of these internal dimensions).
    dim_cis = Column(Float, nullable=True)
    dim_vuln = Column(Float, nullable=True)
    dim_cia = Column(Float, nullable=True)
    dim_ctrl = Column(Float, nullable=True)
    dim_risk = Column(Float, nullable=True)

    snapshot_kind = Column(String(20), default="auto")   # auto (on compute) — reserved for future scheduled/manual
    computed_at = Column(DateTime, default=datetime.utcnow)   # exact time this row was last written

    __table_args__ = (
        UniqueConstraint("tenant_id", "asset_id", "snapshot_date", name="uq_risk_snapshot_day"),
        Index("ix_risk_snapshot_tenant_date", "tenant_id", "snapshot_date"),
        Index("ix_risk_snapshot_asset", "asset_id"),
    )
