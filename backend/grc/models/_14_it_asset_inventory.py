from ._13_governance_document_management_enhanced import *  # noqa: F401,F403

# =============================================================================
# 11. IT Asset Inventory
# =============================================================================

class ITAsset(Base):
    __tablename__ = "grc_it_assets"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    asset_type = Column(String(50), nullable=False)  # application, infrastructure, data, cloud, third_party
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    owner_name = Column(String(255), nullable=True)
    custodian = Column(String(255), nullable=True)
    host_name = Column(String(255), nullable=True)
    ip_address = Column(String(50), nullable=True)
    # NO default. A row created without an explicit rating is UNRATED, not
    # "medium" — a default here is indistinguishable downstream from a real
    # assessment and was being laundered into CIA ratings, risk scores and
    # dollar valuations for assets nobody had ever looked at.
    criticality = Column(String(50), nullable=True)  # low, medium, high, critical
    confidentiality_rating = Column(Integer, nullable=True)
    integrity_rating = Column(Integer, nullable=True)
    availability_rating = Column(Integer, nullable=True)
    valuation = Column(Float, nullable=True)
    vendor = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    status = Column(String(50), default="active")  # active, inactive, decommissioned
    cde_environment = Column(Boolean, default=False)
    # PCI DSS cardholder-data-inventory attributes for CDE assets:
    # { pci_requirement, cardholder_data, encrypted, retention, assessment }.
    pci_dss = Column(JSON, nullable=True)

    # ── Phase 5.1: Exposure metadata ───────────────────────────────────────
    # Operational context that the existing `criticality`/`status` columns
    # don't capture. All nullable / safe-defaulted so existing rows behave
    # identically until a writer sets them.
    internet_facing = Column(Boolean, default=False)
    network_segment = Column(String(100), nullable=True)  # e.g. "dmz", "prod-app-tier"
    data_classification = Column(String(50), nullable=True)  # public, internal, confidential, restricted
    business_function = Column(String(100), nullable=True)  # e.g. "Payments", "HR Operations"
    compliance_scope = Column(JSON, default=list)  # ["PCI-DSS", "HIPAA", ...]

    # ── Phase 5.2: Ownership chain ─────────────────────────────────────────
    # Richer ownership model than the single legacy `owner_id`. Reads should
    # prefer `primary_owner_id` when set, else fall back to `owner_id`.
    # `owning_team` is a free-text label until a dedicated Teams table lands.
    primary_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    secondary_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    # Legacy text label — kept for back-compat with existing rows. New
    # writers prefer `owning_team_id` (FK to grc_teams). The detail
    # response derives a single human-readable team name from whichever is
    # populated.
    owning_team = Column(String(100), nullable=True)
    owning_team_id = Column(Integer, ForeignKey("grc_teams.id"), nullable=True, index=True)
    escalation_contact_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    business_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    # ── Phase 5.3: Lifecycle state machine ─────────────────────────────────
    # `lifecycle_state` runs alongside the legacy `status` column (working
    # agreement: additive only). Allowed transitions:
    #   planned → active → maintenance → decommissioned → retired
    # See services/asset_lifecycle.py for the machine.
    # No default. A lifecycle stage is a DECISION someone records (in
    # service / maintenance / decommissioning), and defaulting it to
    # "active" made every freshly-discovered asset look reviewed and
    # placed in service. `status` keeps its default because downstream
    # queries filter on it as an operational flag (active vs retired);
    # lifecycle_state is the field that carries the human judgement.
    lifecycle_state = Column(String(30), nullable=True)
    decommissioned_at = Column(DateTime, nullable=True)
    retirement_reason = Column(Text, nullable=True)
    replacement_asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=True)

    # ── Phase 5.4: Derived criticality score ───────────────────────────────
    # 0.0-10.0 numeric score derived ISO 27005-style from the CIA ratings +
    # exposure adjustments (data_classification, internet_facing,
    # business_function). Always computed on write; never user-supplied.
    # Read by the composite-priority formula in priority.py.
    criticality_score = Column(Float, nullable=True)
    # Audit-traceable override of the textual `criticality` bucket. When
    # `criticality_manual_override=True`, the `criticality` column is set
    # by the user (with an explanation in `criticality_override_reason`);
    # the numeric `criticality_score` still reflects the derived value so
    # the audit trail captures both "what the system computed" and "what
    # the user chose to publish".
    criticality_manual_override = Column(Boolean, default=False, nullable=True)
    criticality_override_reason = Column(Text, nullable=True)

    # ── Phase 5.5: Last-seen tracking ──────────────────────────────────────
    # Bumped by scanner ingest paths. Stale-asset filter on the UI checks
    # `last_seen_at < now - 30d`.
    last_seen_at = Column(DateTime, nullable=True)
    last_seen_source = Column(String(50), nullable=True)  # e.g. "nessus", "manual", "azure_defender"

    # ── CIS OS profile ─────────────────────────────────────────────────────
    # Populated by the Connect Wizard handshake (probes via WinRM / SSH /
    # boto3 on every connection) and by agent heartbeats. Drives the
    # BenchmarkOsMapping strict matcher that picks the right CIS plugin
    # set per asset. Free-form so we never lose a probe result we can't
    # categorize yet.
    os_family = Column(String(50), nullable=True)      # 'windows' | 'linux' | 'macos'
    os_version = Column(String(255), nullable=True)    # human display, e.g. "Microsoft Windows 11 Pro 23H2"
    os_normalized = Column(String(80), nullable=True, index=True)  # 'windows-11-23H2', 'ubuntu-22.04', …
    os_build = Column(String(40), nullable=True)       # '23H2' / '22H2' / '22.04.4'
    os_edition = Column(String(80), nullable=True)     # 'Enterprise' / 'Pro' / 'LTSC'

    # Host-applications model (Updated_CIS_Assests migration).
    # detected_software_json holds the enriched software inventory the agent or
    # agentless scanner wrote, each entry like:
    #   {software_key, name, version, source, benchmark_available, promoted_asset_id}
    # asset_role distinguishes a host OS from an application asset.
    # parent_asset_id links a promoted application asset back to the host that
    # detected it.
    detected_software_json = Column(JSON, default=list, nullable=True)
    asset_role = Column(String(50), nullable=True)     # 'host' | 'application' | None
    parent_asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=True, index=True)
    # Software-specific properties for an application asset, e.g. for
    # PostgreSQL: {"port": 5432, "data_directory": "...", "service_account":
    # "...", "listen_addresses": "*", "config_file": "..."}. Shape varies by
    # product on purpose — the alternative is a column per product per version.
    app_attributes_json = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant", back_populates="it_assets")
    # `owner` (legacy): back_populated by GRCUser.owned_assets. Kept for
    # backward compat — list/detail pages still resolve display_name from it
    # when the new ownership chain isn't populated.
    owner = relationship("GRCUser", back_populates="owned_assets", foreign_keys=[owner_id])
    # New ownership relationships are one-way (no back_populates) so we don't
    # have to touch GRCUser — `foreign_keys=...` disambiguates which FK each
    # relationship binds to since multiple columns now point at grc_users.id.
    primary_owner = relationship("GRCUser", foreign_keys=[primary_owner_id])
    secondary_owner = relationship("GRCUser", foreign_keys=[secondary_owner_id])
    escalation_contact = relationship("GRCUser", foreign_keys=[escalation_contact_id])
    business_owner = relationship("GRCUser", foreign_keys=[business_owner_id])
    owning_team_obj = relationship("Team", foreign_keys=[owning_team_id])
    # Self-referential: which asset replaced this one when retired.
    replacement_asset = relationship(
        "ITAsset",
        remote_side="ITAsset.id",
        foreign_keys=[replacement_asset_id],
    )
    control_links = relationship("AssetControlLink", back_populates="asset", cascade="all, delete-orphan")
    internal_control_links = relationship("AssetInternalControlLink", back_populates="asset", cascade="all, delete-orphan")
    risk_links = relationship("RiskAssetLink", back_populates="asset", cascade="all, delete-orphan")
    risk_assessments = relationship("AssetRiskAssessment", back_populates="asset", cascade="all, delete-orphan")
    framework_control_links = relationship("AssetFrameworkControlLink", back_populates="asset", cascade="all, delete-orphan")
    evidence_links = relationship("AssetEvidenceLink", back_populates="asset", cascade="all, delete-orphan")
    security_compliance_selections = relationship(
        "AssetSecurityComplianceSelection",
        back_populates="asset",
        cascade="all, delete-orphan",
    )

    # ── Risk Posture v2: business-impact context ────────────────────────
    # Used by the effective-risk formula in
    # `grc.modules.risk_posture.effective_risk.compute_effective_risk`
    # to apply business-impact multipliers ON TOP of CVSS / EPSS / KEV /
    # CIA contributions. All optional; if blank the formula treats the
    # asset as neutral (multiplier 1.0 = no boost).
    #
    # `op_dep_business_impact` is named distinctly from the existing
    # `operational_dependency` Integer column (Criticality Assessment
    # field, line 499 of _37_*) to avoid a column-name collision. The
    # business-impact field uses a varchar enum: low|medium|high|critical.
    is_customer_facing = Column(Boolean, nullable=False, server_default="false", default=False)
    is_internet_facing = Column(Boolean, nullable=False, server_default="false", default=False)
    regulated_data_type = Column(String(20), nullable=False, server_default="none", default="none")
    # values: none | pii | pci | phi | financial | multiple
    op_dep_business_impact = Column(String(20), nullable=False, server_default="medium", default="medium")
    # values: low | medium | high | critical
    business_impact_notes = Column(Text, nullable=True)

    # ── ITAM parity: hardware, procurement & identity extras ───────────────
    # Brings the asset record up to full ITAM parity (matches the dedicated
    # ITAM reference product). Powers the detail-page cards:
    #   Hardware & Telemetry · Network & Platform · Procurement & Cost.
    # All nullable / additive — existing rows are unaffected until set.
    cpu_cores = Column(Integer, nullable=True)        # vCPU count
    memory_gb = Column(Integer, nullable=True)        # RAM in GB
    storage_gb = Column(Integer, nullable=True)       # disk in GB
    agent_version = Column(String(50), nullable=True)
    manufacturer = Column(String(255), nullable=True)
    model = Column(String(255), nullable=True)
    serial_number = Column(String(255), nullable=True)
    department = Column(String(150), nullable=True)
    assigned_user = Column(String(255), nullable=True)
    purchase_cost = Column(Float, nullable=True)
    purchase_date = Column(DateTime, nullable=True)
    warranty_expiry = Column(DateTime, nullable=True)
    eol_date = Column(DateTime, nullable=True)
    # Deployment environment — production | staging | development | test | dr.
    environment = Column(String(50), nullable=True)

    # ── Identity-resolution keys (discovery) ──────────────────────────────
    # What the discovery identity resolver matches an observation against so
    # the same host seen by two sources collapses to ONE asset. All nullable.
    fqdn = Column(String(255), nullable=True, index=True)
    primary_mac = Column(String(64), nullable=True, index=True)
    cloud_resource_id = Column(String(255), nullable=True, index=True)
    source_system = Column(String(50), nullable=True)      # which system last asserted this asset
    first_seen_at = Column(DateTime, nullable=True)          # paired with last_seen_at
    # 'discovered' (auto-created by a scan, unconfirmed) | 'managed'
    # (operator-confirmed) | NULL (pre-existing / manually created).
    discovery_state = Column(String(30), nullable=True, index=True)

    # Endpoint security posture derived from detected_software_json by the
    # security_classifier: { has_antivirus, antivirus_products, has_edr,
    # edr_products, endpoint_protected, categories, ... }. Recomputed every time
    # the software inventory is refreshed (agent heartbeat / agentless probe).
    security_posture = Column(JSON, nullable=True)

    # ── Typed-asset model (per-platform components) ───────────────────────
    # An asset's REAL detail model differs by kind: a server has CPU/RAM/OS, a
    # database has version/databases/extensions, a network device has firmware/
    # interfaces, a cloud account has regions/resources. Rather than force every
    # kind through the server columns (which left a Postgres/Cisco/AWS asset
    # showing blank "VCPU / OS Edition"), the kind-specific facts live here.
    #   platform_kind: server | database | network | cloud | identity | cluster
    #   platform_properties: the collector's kind-specific JSON, rendered by the
    #     dedicated detail card the frontend picks for that kind.
    platform_kind = Column(String(30), nullable=True, index=True)
    platform_properties = Column(JSON, nullable=True)

    __table_args__ = (
        Index("ix_it_asset_tenant_type", "tenant_id", "asset_type"),
        Index("ix_it_asset_tenant_criticality", "tenant_id", "criticality"),
        # Phase 5 indexes — filters on the list page + stale-asset sweep.
        Index("ix_it_asset_lifecycle_state", "lifecycle_state"),
        Index("ix_it_asset_data_classification", "data_classification"),
        Index("ix_it_asset_internet_facing", "internet_facing"),
        Index("ix_it_asset_last_seen_at", "last_seen_at"),
        Index("ix_it_asset_criticality_score", "criticality_score"),
    )


class AssetControlLink(Base):
    __tablename__ = "grc_asset_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    
    asset = relationship("ITAsset", back_populates="control_links")
    normalized_control = relationship("NormalizedControl", back_populates="asset_links")
    
    __table_args__ = (
        Index("ix_asset_control_link", "asset_id", "normalized_control_id"),
    )


class AssetInternalControlLink(Base):
    """Links assets to ERM internal controls"""
    __tablename__ = "grc_asset_internal_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    internal_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=False, index=True)
    coverage_status = Column(String(50), default="partial")
    
    asset = relationship("ITAsset", back_populates="internal_control_links")
    internal_control = relationship("InternalControl")
    
    __table_args__ = (
        UniqueConstraint("asset_id", "internal_control_id", name="uq_asset_internal_control"),
    )


class AssetFrameworkControlLink(Base):
    """Links assets to framework controls"""
    __tablename__ = "grc_asset_framework_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=False, index=True)
    coverage_status = Column(String(50), default="partial")
    notes = Column(Text, nullable=True)
    
    asset = relationship("ITAsset", back_populates="framework_control_links")
    framework_control = relationship("FrameworkControl")
    
    __table_args__ = (
        UniqueConstraint("asset_id", "framework_control_id", name="uq_asset_framework_control"),
    )


class AssetEvidenceLink(Base):
    """Links assets to evidence items"""
    __tablename__ = "grc_asset_evidence_links"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    relationship_type = Column(String(50), default="supports")
    
    asset = relationship("ITAsset", back_populates="evidence_links")
    evidence = relationship("Evidence", back_populates="asset_links")
    
    __table_args__ = (
        UniqueConstraint("asset_id", "evidence_id", name="uq_asset_evidence"),
    )


class AssetRiskAssessment(Base):
    __tablename__ = "grc_asset_risk_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    assessment_date = Column(DateTime, default=datetime.utcnow)
    risk_score = Column(Float, nullable=True)
    coverage_percentage = Column(Float, nullable=True)
    gaps = Column(JSON, default={})
    assessor_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    asset = relationship("ITAsset", back_populates="risk_assessments")
    assessor = relationship("GRCUser", back_populates="asset_assessments")


class AssetSecurityComplianceSelection(Base):
    """Stores selected security compliance controls for an asset."""
    __tablename__ = "grc_asset_security_compliance_selections"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    benchmark = Column(String(100), nullable=False, default="CIS_WS2012R2")
    control_id = Column(String(128), nullable=False)
    selected_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    asset = relationship("ITAsset", back_populates="security_compliance_selections")
    selector = relationship("GRCUser")

    __table_args__ = (
        UniqueConstraint("asset_id", "benchmark", "control_id", name="uq_asset_security_compliance_selection"),
        Index("ix_asset_security_compliance_asset_benchmark", "asset_id", "benchmark"),
    )


class AssetSavedView(Base):
    """A named, reusable filter+sort combination for the IT Asset Inventory
    list. Owned by a user within a tenant; `filters` is the JSON blob the list
    toolbar produces (criticality/status/type/lifecycle/environment/...)."""
    __tablename__ = "grc_asset_saved_views"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    name = Column(String(120), nullable=False)
    filters = Column(JSON, default=dict)
    sort = Column(String(80), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)



# =============================================================================
# 11b. Asset-to-asset relationships (the CMDB edge table)
# =============================================================================
#
# Until now the only asset↔asset links were two scalar columns
# (`parent_asset_id`, `replacement_asset_id`) plus an *inference* from assets
# sharing an IP address. That inference is not a dependency graph: it cannot
# express "this app depends on that database", it cannot be created or removed
# by a human, and it makes blast radius a guess.
#
# This is a real typed edge. Direction matters — A depends_on B is not the same
# as B depends_on A — so queries must look at BOTH columns to show an asset all
# of its relationships.

ASSET_RELATIONSHIP_TYPES = (
    "depends_on",     # A stops working if B is down
    "hosts",          # A is the physical/virtual host of B
    "runs_on",        # inverse of hosts, stored explicitly for clarity
    "connects_to",    # network reachability
    "backs_up",       # A holds backups of B
    "replicates_to",  # A replicates data to B
    "member_of",      # A belongs to cluster/group B
)


class AssetRelationship(Base):
    """A directed, typed edge between two assets."""
    __tablename__ = "grc_asset_relationships"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_asset_id = Column(Integer, ForeignKey("grc_it_assets.id", ondelete="CASCADE"),
                             nullable=False, index=True)
    target_asset_id = Column(Integer, ForeignKey("grc_it_assets.id", ondelete="CASCADE"),
                             nullable=False, index=True)
    relationship_type = Column(String(40), nullable=False, default="depends_on")
    notes = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_by_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        # The same edge of the same kind should exist once.
        UniqueConstraint("source_asset_id", "target_asset_id", "relationship_type",
                         name="uq_asset_relationship"),
        Index("ix_asset_rel_tenant", "tenant_id"),
    )


# =============================================================================
# 11c. Alert acknowledgement state
# =============================================================================
#
# Asset alerts are DERIVED (open KEV, past-SLA, stale scan, exposure) — there is
# no alert producer, so storing the alerts themselves would mean inventing a
# feed. What we DO need to store is the human response to one: acknowledged or
# resolved, by whom, when.
#
# Keyed by (asset, kind) because that is the identity of a derived alert. If the
# underlying condition later clears and returns, the row is reused — the history
# of who last acknowledged it is more useful than a new empty record.

class AssetAlertState(Base):
    """Acknowledgement / resolution state for one derived alert on one asset."""
    __tablename__ = "grc_asset_alert_states"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    alert_kind = Column(String(40), nullable=False)      # kev | sla | stale | exposure
    status = Column(String(20), nullable=False, default="open")  # open|acknowledged|resolved
    acknowledged_by_name = Column(String(255), nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    resolved_by_name = Column(String(255), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("asset_id", "alert_kind", name="uq_asset_alert_state"),
    )
