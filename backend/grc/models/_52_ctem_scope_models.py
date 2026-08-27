from ._51_control_effectiveness_models import *  # noqa: F401,F403

# =============================================================================
# CTEM Phase 3 — Scopes and cycles
# =============================================================================
#
# A scope is a named, bounded, business-owned slice of the attack surface
# ("customer payment platform"); a cycle is one human-driven run of the CTEM
# loop over it. Semantics settled in review BEFORE this code:
#
#   * Cadence is ADVISORY METADATA ONLY — no scheduler exists in this
#     architecture; cycles open and close by explicit human action and the
#     UI never implies otherwise.
#   * Closing FREEZES: the stage counts, the membership rule as-of-close,
#     and a deterministic membership hash (algorithm recorded alongside).
#     Full asset-list snapshots are deliberately not v1; a closed cycle is
#     verifiable against rule + hash, not re-explorable.
#   * Closed cycles are IMMUTABLE — same treatment as simulation runs.


class CtemScope(Base):
    """A bounded slice of the attack surface with a named business owner."""
    __tablename__ = "grc_ctem_scopes"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    # The person who will own the remediation later, agreed NOW — scoping is
    # a business exercise, not a technical one.
    business_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    # Advisory only ("monthly", "quarterly", free text). Nothing fires on it.
    cadence = Column(String(50), nullable=True)

    # Membership = explicit asset ids UNION assets matching the rule criteria
    # (AND across provided criteria). Resolved EXCLUSIVELY by
    # services/ctem_scopes.resolve_scope_assets — one resolver, used by every
    # register filter and every counter, so the counts always match the
    # filtered register they sit next to.
    # Shape: {"asset_ids": [..], "departments": [..], "asset_types": [..],
    #         "name_contains": "..."}
    membership_rule = Column(JSON, default=dict, nullable=True)

    is_active = Column(Boolean, default=True, nullable=False)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    business_owner = relationship("GRCUser", foreign_keys=[business_owner_id])
    cycles = relationship("CtemCycle", back_populates="scope", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_ctem_scope_name"),
        Index("ix_ctem_scope_tenant", "tenant_id"),
    )


class CtemCycle(Base):
    """One human-driven run of the CTEM loop over a scope.

    Stage counters are DERIVED while open (from real event tables — see
    services/ctem_scopes.py for the named table + timestamp per counter) and
    FROZEN into `counts` on close together with the rule and membership hash.
    "Prioritized" is deliberately absent until Phase 4's choke points give it
    a real event table to count from.
    """
    __tablename__ = "grc_ctem_cycles"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    scope_id = Column(Integer, ForeignKey("grc_ctem_scopes.id", ondelete="CASCADE"), nullable=False, index=True)

    status = Column(String(20), nullable=False, default="open", index=True)  # open | closed
    opened_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    opened_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    closed_at = Column(DateTime, nullable=True)
    closed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    # Frozen on close: {"member_assets": n, "discovered": n, "validated": n,
    # "mobilized": n}. NULL while open (derived live instead).
    counts = Column(JSON, nullable=True)
    # The rule EXACTLY as it was at close — membership churns, so the counts
    # are only meaningful next to the rule that produced them.
    membership_rule_frozen = Column(JSON, nullable=True)
    # Deterministic digest over the sorted member-asset ids; the algorithm
    # string travels with the hash so "did membership change" stays
    # answerable across engine versions.
    membership_hash = Column(String(64), nullable=True)
    hash_algorithm = Column(String(40), nullable=True)

    # Gated loop: {"discover": iso_ts, "prioritise": iso_ts, "validate": iso_ts}.
    # Presence of a key = that stage was RUN for this cycle; each stage's numbers
    # and the next stage's action unlock only once the previous key exists.
    # Validate is stamped server-side when its AI mapping run finishes.
    stage_progress = Column(JSON, nullable=True)

    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    scope = relationship("CtemScope", back_populates="cycles")
    opener = relationship("GRCUser", foreign_keys=[opened_by])
    closer = relationship("GRCUser", foreign_keys=[closed_by])

    __table_args__ = (
        Index("ix_ctem_cycle_scope", "scope_id", "status"),
        Index("ix_ctem_cycle_tenant", "tenant_id"),
    )
