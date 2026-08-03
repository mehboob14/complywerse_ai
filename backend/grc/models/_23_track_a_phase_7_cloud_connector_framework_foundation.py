from ._22_vulnerability_management_module import *  # noqa: F401,F403

# =============================================================================
# Track A / Phase 7 — Cloud Connector Framework (foundation)
# =============================================================================
# Unified entity for any external system that pushes data into the platform
# (AWS Inspector, Azure Defender, GCP SCC; later RHSA + Cisco PSIRT etc.).
# Today the Nessus/Nexpose integrations live under `IntegrationConnection`
# and use bespoke credential blobs. This entity is the cleaner pattern for
# new connectors; the legacy table is kept as-is so existing tenants keep
# syncing without a backfill.
#
# Encryption: `encrypted_credentials_blob` stores ciphertext only. The
# matching encryption helper lives in `services/connector_credentials.py`
# and is keyed off `CONNECTOR_MASTER_KEY` (env). Plaintext credentials never
# touch the DB — even on read, callers go through `decrypt_credentials()`
# which fails closed when the master key is missing.

class CloudConnector(Base):
    """Per-tenant cloud connector instance. Auth + sync state for one
    cloud account / subscription / project."""
    __tablename__ = "grc_cloud_connectors"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    # Stable identifier for the cloud SDK we'll call.
    # Allowed: "aws_inspector", "azure_defender", "gcp_scc", and future
    # PSIRTs ("rhsa", "cisco_psirt") if we choose to route them through the
    # same framework.
    provider = Column(String(50), nullable=False)
    display_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)

    # AES-encrypted JSON blob. Format depends on provider:
    #   aws_inspector → {"role_arn": "...", "external_id": "...", "regions": ["us-east-1"]}
    #   azure_defender → {"tenant_id": "...", "client_id": "...", "client_secret": "..."}
    #   gcp_scc → {"service_account_json": "..."}  (or WIF config)
    # Decryption is gated by `services/connector_credentials.decrypt_credentials()`.
    encrypted_credentials_blob = Column(Text, nullable=True)

    # Sync schedule in seconds. 6 hours default per the roadmap; admins
    # can override per connector. NULL means "manual sync only".
    sync_schedule_seconds = Column(Integer, default=6 * 60 * 60, nullable=True)

    # Lifecycle + health state.
    is_active = Column(Boolean, default=True, nullable=False)
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_status = Column(String(20), nullable=True)  # ok, partial, error
    last_sync_error = Column(Text, nullable=True)
    last_health_check_at = Column(DateTime, nullable=True)
    last_health_status = Column(String(20), nullable=True)  # ok, degraded, error
    # Running counters surfaced on the admin page — assets discovered,
    # vulns ingested, errors encountered. Cleared on connector reset.
    health_metrics = Column(JSON, default=dict, nullable=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    tenant = relationship("Tenant", foreign_keys=[tenant_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        Index("ix_cloud_connector_tenant_provider", "tenant_id", "provider"),
        Index("ix_cloud_connector_last_sync_at", "last_sync_at"),
    )


class VulnerabilityMitigation(Base):
    """Remediation tasks for vulnerabilities"""
    __tablename__ = "grc_vulnerability_mitigations"
    
    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    action_title = Column(String(255), nullable=False)
    action_description = Column(Text, nullable=True)
    action_type = Column(String(50), default="remediate")  # remediate, mitigate, transfer, accept
    
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    priority = Column(String(20), default="medium")  # critical, high, medium, low
    
    status = Column(String(50), default="pending")  # pending, in_progress, completed, cancelled
    
    target_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    effort_estimate = Column(String(50), nullable=True)  # hours, days
    actual_effort = Column(String(50), nullable=True)
    
    notes = Column(Text, nullable=True)
    
    erm_mitigation_id = Column(Integer, ForeignKey("grc_risk_mitigation_actions.id"), nullable=True)  # Link to ERM
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    vulnerability = relationship("Vulnerability", back_populates="mitigations")
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    __table_args__ = (
        Index("ix_vuln_mitigation_vuln", "vulnerability_id"),
        Index("ix_vuln_mitigation_status", "status"),
    )


class VulnerabilityAssetLink(Base):
    """Links vulnerabilities to affected IT assets"""
    __tablename__ = "grc_vulnerability_asset_links"

    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)

    impact_on_asset = Column(String(50), nullable=True)  # confidentiality, integrity, availability
    notes = Column(Text, nullable=True)

    # How this link was created. One of: manual / scanner / cpe_match /
    # cloud_sync / nca_bridge. Set by the code path that creates the link;
    # unknown rows default to "manual" so legacy data stays valid.
    link_source = Column(String(50), default="manual", nullable=True)
    # True when the link was created by automation (matcher / sync) rather
    # than a person. Surfaced as an "Auto" badge in the UI so reviewers can
    # spot false positives without inspecting metadata.
    auto_linked = Column(Boolean, default=False, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    vulnerability = relationship("Vulnerability", back_populates="asset_links")
    asset = relationship("ITAsset")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("vulnerability_id", "asset_id", name="uq_vuln_asset_link"),
        Index("ix_vuln_asset_link", "vulnerability_id", "asset_id"),
        # Drives the "show me all auto-linked vulns" filter on the asset
        # detail's linked-vulns list + the auditor's review queue.
        Index("ix_vuln_asset_link_source", "link_source"),
        Index("ix_vuln_asset_link_auto", "auto_linked"),
    )


class VulnerabilityDependency(Base):
    """Chain dependency: vuln A is only meaningfully exploitable if vuln B
    is also present (or vice-versa). Real-world example: a privilege-
    escalation flaw matters most when a remote-code-execution flaw lets an
    attacker reach the box in the first place. Surfacing the chain lets a
    triager push the right one to the top of the queue.

    Directionality: `dependent_vuln` requires `prerequisite_vuln` to be
    exploitable. Mark notes for the rationale ("PrintNightmare requires
    SMB foothold from CVE-X"). One row per directional edge — pair them up
    in two rows if a bidirectional relationship truly applies.
    """
    __tablename__ = "grc_vulnerability_dependencies"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    dependent_vuln_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    prerequisite_vuln_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    # Free-form rationale. Highly recommended so future readers know why
    # the chain was declared (vs. inferring from the two titles).
    notes = Column(Text, nullable=True)
    # Optional kill-chain stage tag: 'initial_access', 'execution',
    # 'privilege_escalation', 'lateral_movement', 'exfiltration'. Drives an
    # informational chip in the UI; no business logic depends on it yet.
    chain_stage = Column(String(50), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    dependent_vuln = relationship("Vulnerability", foreign_keys=[dependent_vuln_id])
    prerequisite_vuln = relationship("Vulnerability", foreign_keys=[prerequisite_vuln_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("dependent_vuln_id", "prerequisite_vuln_id", name="uq_vuln_dependency_pair"),
        Index("ix_vuln_dep_dependent", "dependent_vuln_id"),
        Index("ix_vuln_dep_prereq", "prerequisite_vuln_id"),
        Index("ix_vuln_dep_tenant", "tenant_id"),
    )


class Team(Base):
    """Org team (e.g., Payments, Identity, Platform Engineering).

    Used in two places today:
      * ITAsset.owning_team_id — picks the team that owns an asset.
      * Member list rendered in admin → Teams for ownership chain context.

    A team is tenant-scoped. Members are GRCUsers with a `role_in_team`
    label (lead / member / viewer) — independent of the platform-wide RBAC
    roles, since a person can be "lead of Payments team" while having a
    "Compliance Analyst" platform role.
    """
    __tablename__ = "grc_teams"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    # Optional: who runs the team day-to-day. Different from "member with
    # role_in_team='lead'" because a team can have multiple leads but only
    # one canonical contact.
    lead_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    lead = relationship("GRCUser", foreign_keys=[lead_user_id])
    members = relationship("TeamMember", back_populates="team", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_team_tenant_name"),
        Index("ix_team_tenant", "tenant_id"),
        Index("ix_team_tenant_active", "tenant_id", "is_active"),
    )


class TeamMember(Base):
    """Join row: which users belong to which team, and in what capacity."""
    __tablename__ = "grc_team_members"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("grc_teams.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    # In-team role label. Free-text-ish but the API restricts to a known set.
    role_in_team = Column(String(30), default="member", nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow)
    added_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    team = relationship("Team", back_populates="members")
    user = relationship("GRCUser", foreign_keys=[user_id])
    adder = relationship("GRCUser", foreign_keys=[added_by])

    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_team_member"),
        Index("ix_team_member_team", "team_id"),
        Index("ix_team_member_user", "user_id"),
    )


class SoftwareIdentifier(Base):
    """CPE / PURL identifier installed on an asset.

    Populated by the CPE matcher (Phase 4 piece) and by scanner adapters
    that report installed-software inventory. Drives the matcher that
    creates `VulnerabilityAssetLink` rows automatically for CVEs whose
    `affected_configurations` overlap an asset's identifiers.

    Stored normalised:
        identifier_type ∈ {"cpe", "purl"}
        identifier        — full identifier string, e.g.
                            "cpe:2.3:a:apache:log4j:2.14.1:*:*:*:*:*:*:*"
        vendor / product  — parsed components for cheap LIKE matching
        version           — parsed version for range comparison
    """
    __tablename__ = "grc_software_identifiers"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)

    identifier_type = Column(String(10), nullable=False)  # cpe | purl
    identifier = Column(String(500), nullable=False)
    vendor = Column(String(100), nullable=True)
    product = Column(String(100), nullable=True)
    version = Column(String(50), nullable=True)

    # Provenance — where the identifier came from. Same vocabulary as
    # VulnerabilityAssetLink.link_source so reports stay aligned.
    source = Column(String(50), default="manual", nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    asset = relationship("ITAsset")

    __table_args__ = (
        UniqueConstraint("tenant_id", "asset_id", "identifier",
                         name="uq_software_identifier"),
        Index("ix_software_identifier_tenant", "tenant_id"),
        Index("ix_software_identifier_asset", "asset_id"),
        # Cheap LIKE lookup during matcher runs.
        Index("ix_software_identifier_vendor_product", "vendor", "product"),
    )


class CweControlOverride(Base):
    """Per-tenant override on top of the static CWE → framework-control map.

    The default map in ``cwe_control_map.py`` ships sensible PCI / ISO /
    OWASP / NIST mappings for the CWE Top 25. This table lets a tenant's
    compliance team add their own organisation-specific links (e.g. "for
    us, CWE-89 also breaks SAMA CSF 4.2.1") OR remove a default link they
    disagree with (e.g. "we don't accept the NIST SI-15 mapping").

    Schema notes:
      - ``cwe_id`` accepts the literal sentinels ``__vuln_mgmt__`` (the
        always-applicable patch-management rule set) and ``__kev__``
        (always-applicable active-exploitation rule set) — operators can
        edit those baselines too.
      - ``framework_prefix`` matches the loose Framework.name substring
        rules used by the resolver. ``control_code_pattern`` matches the
        ParsedFrameworkControl.control_id / original_reference substring.
      - ``action`` is ``"add"`` or ``"remove"``. Add merges into the
        identifier list before the live query; remove filters matching
        defaults OUT of the list before querying.
    """
    __tablename__ = "grc_cwe_control_overrides"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # "CWE-89", "__vuln_mgmt__", "__kev__"
    cwe_id = Column(String(50), nullable=False, index=True)
    framework_prefix = Column(String(100), nullable=False)
    control_code_pattern = Column(String(100), nullable=False)
    # "add" or "remove"
    action = Column(String(10), nullable=False, default="add")
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "cwe_id", "framework_prefix", "control_code_pattern", "action",
            name="uq_cwe_override",
        ),
        Index("ix_cwe_override_tenant_cwe", "tenant_id", "cwe_id"),
    )


class VulnerabilityControlLink(Base):
    """Links vulnerabilities to framework controls they violate"""
    __tablename__ = "grc_vulnerability_control_links"

    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    internal_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=True, index=True)
    # New FK: targets `ParsedFrameworkControl` (controls produced by the
    # upload-driven seed path). The CWE auto-mapper uses this column
    # because seeded frameworks land in the parsed-control tables, not the
    # legacy Framework/FrameworkControl chain. Existing manual links keep
    # using `framework_control_id` / `internal_control_id` for backwards
    # compatibility.
    parsed_framework_control_id = Column(
        Integer, ForeignKey("grc_parsed_framework_controls.id"),
        nullable=True, index=True,
    )

    compliance_impact = Column(String(50), nullable=True)  # non_compliant, partial, at_risk
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    vulnerability = relationship("Vulnerability", back_populates="control_links")
    framework_control = relationship("FrameworkControl")
    normalized_control = relationship("NormalizedControl")
    internal_control = relationship("InternalControl")
    parsed_framework_control = relationship("ParsedFrameworkControl", foreign_keys=[parsed_framework_control_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        Index("ix_vuln_control_link", "vulnerability_id"),
        Index("ix_vuln_control_link_parsed", "parsed_framework_control_id"),
    )


class VulnerabilityRetest(Base):
    """Retest records after remediation"""
    __tablename__ = "grc_vulnerability_retests"
    
    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    retest_date = Column(DateTime, default=datetime.utcnow)
    tester_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    result = Column(String(50), nullable=False)  # pass, fail, partial
    findings = Column(Text, nullable=True)
    evidence = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    vulnerability = relationship("Vulnerability", back_populates="retests")
    tester = relationship("GRCUser", foreign_keys=[tester_id])
    
    __table_args__ = (
        Index("ix_vuln_retest_vuln", "vulnerability_id"),
    )


class VulnerabilityAIJob(Base):
    """AI analysis job tracking for vulnerability reports"""
    __tablename__ = "grc_vulnerability_ai_jobs"
    
    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("grc_vulnerability_reports.id"), nullable=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    job_type = Column(String(50), nullable=False)  # parse_report, analyze_vuln, suggest_fix, impact_assessment
    status = Column(String(50), default="pending")  # pending, processing, completed, failed
    
    input_data = Column(JSON, default={})
    output_data = Column(JSON, default={})
    error_message = Column(Text, nullable=True)
    
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    report = relationship("VulnerabilityReport", back_populates="ai_jobs")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    __table_args__ = (
        Index("ix_vuln_ai_job_report", "report_id"),
        Index("ix_vuln_ai_job_status", "status"),
    )


class VulnerabilitySLAConfig(Base):
    """SLA configuration by severity"""
    __tablename__ = "grc_vulnerability_sla_config"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    severity = Column(String(20), nullable=False)  # critical, high, medium, low, info
    remediation_days = Column(Integer, nullable=False)  # Days to remediate
    notification_days = Column(Integer, nullable=True)  # Optional days before due date for reminders
    escalation_days = Column(Integer, nullable=True)  # Optional days after due date for escalations
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("tenant_id", "severity", name="uq_vuln_sla_tenant_severity"),
        Index("ix_vuln_sla_tenant", "tenant_id"),
    )

