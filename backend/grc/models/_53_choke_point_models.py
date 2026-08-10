from ._52_ctem_scope_models import *  # noqa: F401,F403

# =============================================================================
# CTEM Phase 4 — Choke-point analysis
# =============================================================================
#
# A choke point is a FINDING whose remediation severs the most viable attack
# chains at once (a CVE present on many assets). Score = number of distinct
# viable (asset) chains the finding participates in — see
# services/choke_points.py for the ranking + the settled definition.
#
# Two persistence concerns, deliberately DECOUPLED:
#   * Snapshot + entries are REPLACE-FRIENDLY storage — recompute after each
#     sync may prune/replace them freely. Entries are SELF-CONTAINED (they
#     carry their own chain decomposition) so the explainability click never
#     joins to the mutable reachability tables.
#   * ChokePointFirstSeen is NOT replace-friendly — first-write-wins, never
#     updated. It is the only durable record of "when did this finding first
#     become rankable", which the (future) `prioritized` cycle counter is
#     derived from. If it lived inside the replaceable snapshot, a recompute
#     would destroy the event irrecoverably.


class ChokePointSnapshot(Base):
    """One computed choke-point ranking for a tenant, at a point in time."""
    __tablename__ = "grc_choke_point_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # Rendered ON the view — a ranking computed before the latest scan must
    # show its age (snapshot honesty).
    computed_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    algorithm_version = Column(String(60), nullable=True)
    finding_count = Column(Integer, default=0)
    # The tenant's FIRST ever snapshot stamps the whole existing chained
    # backlog at once — carried structurally so a cycle card can decompose
    # "prioritized: X (Y launch backfill)" rather than reading a spike as
    # workflow.
    is_inaugural = Column(Boolean, default=False, nullable=False)
    triggered_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    entries = relationship("ChokePointEntry", back_populates="snapshot",
                           cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_choke_snap_tenant_computed", "tenant_id", "computed_at"),
    )


class ChokePointEntry(Base):
    """One ranked finding within a snapshot — SELF-CONTAINED.

    `chains` holds the finding's viable-chain decomposition verbatim
    ([{asset_id, snapshot_id, verdict}]) so the explainability click reads
    from this row alone, never from the reachability tables that replace on
    the next sync. The finding is the stable key (a remediation targets a
    finding, not a technique).
    """
    __tablename__ = "grc_choke_point_entries"

    id = Column(Integer, primary_key=True, index=True)
    snapshot_id = Column(Integer, ForeignKey("grc_choke_point_snapshots.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id", ondelete="CASCADE"),
                              nullable=False, index=True)

    chain_count = Column(Integer, nullable=False, default=0)
    rank = Column(Integer, nullable=False)
    # [{asset_id, snapshot_id, verdict}] — the exact chains this finding's fix
    # would sever, frozen into the row (house frozen-payload style).
    chains = Column(JSON, default=list, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    snapshot = relationship("ChokePointSnapshot", back_populates="entries")

    __table_args__ = (
        Index("ix_choke_entry_snapshot_rank", "snapshot_id", "rank"),
        Index("ix_choke_entry_vuln", "vulnerability_id"),
    )


class ChokePointFirstSeen(Base):
    """Durable, first-write-wins record of when a finding first became a
    rankable choke point. Survives snapshot pruning; the `prioritized` cycle
    counter's event ("finding first appears in a snapshot in-window") reads
    from HERE, never from the replaceable snapshot rows.
    """
    __tablename__ = "grc_choke_point_first_seen"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id", ondelete="CASCADE"),
                              nullable=False, index=True)
    first_in_snapshot_at = Column(DateTime, nullable=False, index=True)
    first_snapshot_id = Column(Integer, ForeignKey("grc_choke_point_snapshots.id"), nullable=True)
    # True when this finding's first-appearance was the inaugural backfill
    # (stamped by the tenant's first-ever snapshot), so a cycle spanning launch
    # can label the spike as backfill rather than counting it as workflow.
    is_inaugural_backfill = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "vulnerability_id", name="uq_choke_first_seen"),
        Index("ix_choke_first_seen_at", "tenant_id", "first_in_snapshot_at"),
    )
