from ._50_risk_quantification_models import *  # noqa: F401,F403

# =============================================================================
# CTEM Phase 2 — Control effectiveness evidence (validation → assurance)
# =============================================================================
#
# Automated, dated proof that a control's protection was EXERCISED — the
# complement to the CT&A workbench's human test records. Sources today:
#   * scanner_closure — a scanner-verified fix of a finding linked to the
#     control (proves remediation happened; capped at "remediation-verified",
#     it does NOT prove the control works);
#   * retest — a human retest of a linked finding (a genuine effectiveness
#     signal); BAS lands here later as a second genuine source.
#
# Deliberate design (review-settled):
#   * FACTS ONLY, no stored badge/tier. Staleness has no event — nothing
#     fires at month 18 — so the fresh/stale tier is DERIVED AT READ TIME
#     from these rows (services/control_assurance.py). A stored badge would
#     need a sweeper and would inevitably lie between sweeps.
#   * Bounded volume: one row per (control ref × vulnerability × source),
#     upserted in place — a noisy scanner closing 400 findings updates 400
#     rows once each, not appends forever; re-syncs cannot duplicate.
#   * The control reference mirrors VulnerabilityControlLink's four-way
#     polymorphism, because that's where the vuln↔control truth lives.


class ControlEffectivenessEvidence(Base):
    """One dated evidence fact: source X observed result Y for control C via
    finding V."""
    __tablename__ = "grc_control_effectiveness_evidence"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    # Exactly one of the four control references is set (mirrors
    # VulnerabilityControlLink).
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    internal_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=True, index=True)
    parsed_framework_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True, index=True)

    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id", ondelete="CASCADE"), nullable=False, index=True)

    source_type = Column(String(30), nullable=False, index=True)  # scanner_closure | retest (later: bas)
    result = Column(String(10), nullable=False)                   # pass | fail
    tested_at = Column(DateTime, nullable=False, index=True)
    # Provenance the panel shows verbatim: scan id/name, retest id/tester,
    # original result ("partial" maps to fail but is preserved here), etc.
    details = Column(JSON, nullable=True)

    # Soft retraction — set when the link that produced this evidence was
    # removed by RULE fluctuation (auto-map stale removal). Retracted rows are
    # excluded from every tier derivation and listing, but survive so a
    # crosswalk edit that gets reverted can REINSTATE them — producers fire
    # on events and past closures never replay, so hard-deleting on a rule
    # change would permanently degrade badges on an admin round-trip. Manual
    # unlink stays a hard delete: a human asserted the link (and therefore
    # its evidence) was wrong.
    retracted_at = Column(DateTime, nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    vulnerability = relationship("Vulnerability")

    __table_args__ = (
        Index("ix_ctrl_eff_tenant_source", "tenant_id", "source_type"),
        Index("ix_ctrl_eff_parsed", "parsed_framework_control_id", "tested_at"),
        Index("ix_ctrl_eff_internal", "internal_control_id", "tested_at"),
        Index("ix_ctrl_eff_framework", "framework_control_id", "tested_at"),
        Index("ix_ctrl_eff_normalized", "normalized_control_id", "tested_at"),
        # The upsert identity: one row per control-ref × finding × source.
        UniqueConstraint(
            "tenant_id", "vulnerability_id", "source_type",
            "framework_control_id", "normalized_control_id",
            "internal_control_id", "parsed_framework_control_id",
            name="uq_ctrl_eff_identity",
        ),
    )
