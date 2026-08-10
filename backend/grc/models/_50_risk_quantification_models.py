from ._49_document_attestation_models import *  # noqa: F401,F403

# =============================================================================
# CRQM — Cyber Risk Quantification (FAIR) — Phase 1
# =============================================================================
#
# Turns a register risk into money: a versioned FAIR loss model per risk and
# immutable, seeded Monte Carlo runs. Design rules that matter here:
#
#   * Loss models are VERSIONED — editing an active model creates a new
#     version; the old one is archived, never mutated. The version an old
#     simulation used must stay readable exactly as it was, or the run's
#     numbers become unexplainable to an auditor.
#   * Simulation runs are IMMUTABLE and REPRODUCIBLE — the RNG seed and
#     engine version are stored on the row, so any historical figure can be
#     regenerated bit-for-bit.
#   * Assumptions are DATA, not comments: rationale fields on every estimate,
#     and an assumptions snapshot on every run (including the portfolio
#     independence assumption), because the defensibility of a quantified
#     risk lives in its assumptions.


class RiskLossModel(Base):
    """One versioned FAIR loss model for one risk.

    Frequency × magnitude, all estimates as min / most-likely / max ranges
    (never point values). `loss_components` is a JSON array of
    ``{key, label, kind: "primary"|"secondary", min, ml, max,
    probability, rationale}`` — `probability` (0-1, default 1.0) is the
    per-incident occurrence chance of that component (FAIR's secondary-loss
    frequency): a regulatory fine that materializes in ~15% of incidents is
    probability 0.15, not charged on every simulated event.

    Exactly one `active` model per risk, enforced transactionally by the
    service (row-locked promote-and-archive), not by convention.
    """
    __tablename__ = "grc_risk_loss_models"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id", ondelete="CASCADE"), nullable=False, index=True)

    version = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False, default="draft", index=True)  # draft | active | archived

    # Money-denominated outputs must be unambiguous from day one — ISO 4217.
    currency = Column(String(3), nullable=False, default="USD")

    # Threat event frequency: attempted events per year (min/ml/max).
    tef_min = Column(Float, nullable=True)
    tef_ml = Column(Float, nullable=True)
    tef_max = Column(Float, nullable=True)
    # Probability an attempt succeeds (0-1, min/ml/max) + where the estimate
    # came from — "estimated" or an evidence trail from CTEM validation
    # (e.g. "derived from 3 validated attack paths on linked assets").
    pos_min = Column(Float, nullable=True)
    pos_ml = Column(Float, nullable=True)
    pos_max = Column(Float, nullable=True)
    pos_basis = Column(Text, nullable=True)
    # Frozen CTEM evidence behind an ACCEPTED probability suggestion:
    # {fingerprint, band, finding_ids, snapshot_ids, verified_closures,
    # generated_at}. Written only when the user accepts a suggestion; the UI
    # compares fingerprint against current evidence to badge "evidence
    # updated since estimate" — an active model is never re-suggested into
    # silently.
    pos_evidence = Column(JSON, nullable=True)

    loss_components = Column(JSON, default=list, nullable=True)

    # Estimator calibration + the narrative an auditor reads first.
    confidence_pct = Column(Float, nullable=True)  # e.g. 90 = "90% confident"
    assumptions = Column(Text, nullable=True)

    created_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    risk = relationship("Risk", backref="loss_models")
    created_by = relationship("GRCUser", foreign_keys=[created_by_user_id])

    __table_args__ = (
        Index("ix_loss_model_risk_status", "risk_id", "status"),
        Index("ix_loss_model_tenant", "tenant_id"),
        UniqueConstraint("risk_id", "version", name="uq_loss_model_risk_version"),
    )


class RiskSimulationRun(Base):
    """One immutable Monte Carlo run — per-risk or portfolio.

    scope="risk": one loss model simulated alone.
    scope="portfolio": every active loss model sampled jointly per iteration.
    Portfolio runs assume INDEPENDENCE between scenarios — that assumption is
    stamped into `assumptions_snapshot` and must be surfaced wherever the
    portfolio curve is shown; independent sampling understates tail risk when
    risks are correlated. A shared-factor term is the designed later
    extension, not something this row pretends to have.

    Runs execute inline (numpy, milliseconds); `status` exists so a process
    death mid-write can be detected — a lazy sweep fails-out rows stuck in
    "running", they are never retried silently.
    """
    __tablename__ = "grc_risk_simulation_runs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    scope = Column(String(20), nullable=False, default="risk", index=True)  # risk | portfolio
    risk_id = Column(Integer, ForeignKey("grc_risks.id", ondelete="CASCADE"), nullable=True, index=True)
    loss_model_id = Column(Integer, ForeignKey("grc_risk_loss_models.id", ondelete="CASCADE"), nullable=True, index=True)

    status = Column(String(20), nullable=False, default="running", index=True)  # running | completed | failed
    error = Column(Text, nullable=True)
    # What caused this run: manual | activation (auto baseline on model
    # activation — keeps dashboards from ever showing a superseded model's
    # number) | comparison (ROI option run). Audit reads this to distinguish
    # human-triggered analysis from system-maintained freshness.
    trigger = Column(String(30), nullable=False, default="manual")

    iterations = Column(Integer, nullable=False, default=10000)
    seed = Column(Integer, nullable=False)
    engine_version = Column(String(30), nullable=False)
    currency = Column(String(3), nullable=True)

    # Headline figures as real columns so dashboards can query/sort without
    # unpacking JSON.
    ale_mean = Column(Float, nullable=True)      # annualized loss expectancy
    ale_median = Column(Float, nullable=True)
    p5 = Column(Float, nullable=True)
    p50 = Column(Float, nullable=True)
    p90 = Column(Float, nullable=True)
    p95 = Column(Float, nullable=True)
    p99 = Column(Float, nullable=True)

    # Loss exceedance curve: [{loss, prob}], ~50 downsampled points.
    lec_points = Column(JSON, default=list, nullable=True)
    # Tornado data: [{key, label, mean_contribution}] per loss component
    # (per risk for portfolio runs).
    component_contributions = Column(JSON, default=list, nullable=True)
    # Which control effects were applied (null/[] = baseline):
    # [{control_link_id, label, freq_reduction, mag_reduction}].
    # none_as_null: a baseline must be stored as SQL NULL — plain JSON columns
    # store Python None as JSON 'null', which .is_(None) filters silently miss
    # (found live: the dashboard's baseline lookup matched nothing).
    controls_scenario = Column(JSON(none_as_null=True), nullable=True)
    # What this run assumed, frozen at run time: loss-model summary, control
    # effects, and for portfolio runs the independence assumption text.
    assumptions_snapshot = Column(JSON, nullable=True)

    duration_ms = Column(Integer, nullable=True)
    triggered_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)

    tenant = relationship("Tenant")
    risk = relationship("Risk")
    loss_model = relationship("RiskLossModel", backref="simulation_runs")
    triggered_by = relationship("GRCUser", foreign_keys=[triggered_by_user_id])

    __table_args__ = (
        Index("ix_sim_run_risk", "risk_id", "created_at"),
        Index("ix_sim_run_tenant_scope", "tenant_id", "scope"),
        Index("ix_sim_run_status", "status"),
    )
