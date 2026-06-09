from ._36_is_projects_critical_tasks_models import *  # noqa: F401,F403

# =============================================================================
# Artifact Catalog & Tenant Artifacts
# =============================================================================

class ArtifactCatalogItem(Base):
    """Master catalog of artifacts per framework, seeded from Excel catalog."""
    __tablename__ = "grc_artifact_catalog_items"

    id = Column(Integer, primary_key=True, index=True)
    framework_key = Column(String(100), nullable=False, index=True)   # e.g. iso_27001_2022
    framework_name = Column(String(255), nullable=False)
    artifact_id = Column(String(50), nullable=False)                  # e.g. ISO27-001
    stage = Column(String(100), nullable=False)                       # Stage 1: ...
    stage_number = Column(Integer, nullable=True)
    name = Column(String(500), nullable=False)
    artifact_type = Column(String(100), nullable=False)               # Policy, Procedure, Register ...
    control_ref = Column(String(255), nullable=True)
    mandatory = Column(Boolean, default=False)
    description = Column(Text, nullable=True)
    format = Column(String(100), nullable=True)
    owner = Column(String(255), nullable=True)
    is_platform_native = Column(Boolean, default=False)               # True = link to real platform data
    platform_data_type = Column(String(100), nullable=True)          # risk_register, asset_inventory

    __table_args__ = (
        UniqueConstraint("framework_key", "artifact_id", name="uq_artifact_catalog_fw_id"),
        Index("ix_artifact_catalog_framework_key", "framework_key"),
    )


class AuditPlanEntry(Base):
    """Cybersecurity audit plan entry linked to a compliance assessment."""
    __tablename__ = "grc_audit_plan_entries"

    id               = Column(Integer, primary_key=True, index=True)
    assessment_id    = Column(Integer, ForeignKey("grc_compliance_assessment_documents.id"), nullable=False, index=True)
    tenant_id        = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    # Core audit plan fields (matching the NCA template columns)
    entry_type       = Column(String(20),  default="Audit")    # Audit | Review
    audit_id         = Column(String(30),  nullable=True)      # auto-generated: A001, R001 …
    audit_name       = Column(String(500), nullable=True)
    team_responsible = Column(String(200), nullable=True)      # Cybersecurity Org / Internal Audit / Third Party
    lead_auditor     = Column(String(255), nullable=True)
    audit_type       = Column(String(200), nullable=True)      # Design effectiveness / Operational / Both
    scope            = Column(Text,        nullable=True)
    methods          = Column(Text,        nullable=True)
    criteria         = Column(Text,        nullable=True)
    sampling         = Column(Text,        nullable=True)
    evidence_needed  = Column(Text,        nullable=True)
    duration         = Column(String(200), nullable=True)
    schedule         = Column(Text,        nullable=True)
    audit_start      = Column(Date,        nullable=True)
    audit_end        = Column(Date,        nullable=True)
    cost             = Column(String(100), nullable=True)
    comment          = Column(Text,        nullable=True)

    # Additional platform fields
    status           = Column(String(50),  default="planned")  # planned | in_progress | completed | cancelled
    priority         = Column(String(20),  nullable=True)      # critical | high | medium | low
    ai_recommendation              = Column(Text,     nullable=True)
    ai_recommendation_generated_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    assessment = relationship("ComplianceAssessmentDocument")
    tenant     = relationship("Tenant")

    __table_args__ = (
        Index("ix_grc_audit_plan_entries_assessment", "assessment_id"),
        Index("ix_grc_audit_plan_entries_tenant",     "tenant_id"),
    )


class NcaRiskEntry(Base):
    """NCA Cybersecurity Risk Management register entry (NCA template v0.9)."""
    __tablename__ = "grc_nca_risk_entries"

    id                             = Column(Integer, primary_key=True, index=True)
    tenant_id                      = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    risk_identifier                = Column(String(20),  nullable=True)   # RISK-001
    risk_area                      = Column(String(100), nullable=True)   # IT assets / Business process / Personnel
    risk_owner                     = Column(String(255), nullable=True)
    date_identified                = Column(Date,        nullable=True)
    description                    = Column(Text,        nullable=True)
    risk_cause                     = Column(Text,        nullable=True)
    threat                         = Column(String(255), nullable=True)
    risk_analysis                  = Column(Text,        nullable=True)
    date_analysis                  = Column(Date,        nullable=True)
    inherent_likelihood            = Column(Integer,     nullable=True)   # 1-5
    inherent_impact                = Column(Integer,     nullable=True)   # 1-5
    inherent_rating_override       = Column(String(20),  nullable=True)   # manual override
    treatment_type                 = Column(String(50),  nullable=True)   # Mitigation / Avoidance / Transfer / Acceptance
    treatment_description          = Column(Text,        nullable=True)
    treatment_owner                = Column(String(255), nullable=True)
    treatment_deadline             = Column(Date,        nullable=True)
    residual_description           = Column(Text,        nullable=True)
    residual_likelihood            = Column(Integer,     nullable=True)   # 1-5
    residual_impact                = Column(Integer,     nullable=True)   # 1-5
    following_steps                = Column(Text,        nullable=True)
    last_evaluation_date           = Column(Date,        nullable=True)
    comment                        = Column(Text,        nullable=True)
    risk_owner_user_id             = Column(Integer,     ForeignKey("grc_users.id"), nullable=True)
    treatment_owner_user_id        = Column(Integer,     ForeignKey("grc_users.id"), nullable=True)
    # Bridge to the general Risk record (auto-created so the NCA entry inherits the
    # full ERM detail page: tabs, mitigations, asset/control/dept/workflow links, etc.)
    bridged_risk_id                = Column(Integer,     ForeignKey("grc_risks.id"), nullable=True, index=True)
    linked_asset_ids               = Column(JSON,        default=list, nullable=True)
    linked_control_ids             = Column(JSON,        default=list, nullable=True)
    # mitigation_actions is a list of objects:
    # [{"id": str, "title": str, "owner": str, "owner_user_id": int|None,
    #   "due_date": "YYYY-MM-DD"|None, "status": str, "notes": str,
    #   "created_at": iso, "updated_at": iso}]
    mitigation_actions             = Column(JSON,        default=list, nullable=True)
    lifecycle_status               = Column(String(30),  default="open", nullable=True)  # open / in_progress / mitigated / accepted / closed
    ai_recommendation              = Column(Text,        nullable=True)
    ai_recommendation_generated_at = Column(DateTime,    nullable=True)
    created_at                     = Column(DateTime,    default=datetime.utcnow)
    updated_at                     = Column(DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")


class NcaVulnEntry(Base):
    """NCA Vulnerability Register entry."""
    __tablename__ = "grc_nca_vuln_entries"

    id                             = Column(Integer, primary_key=True, index=True)
    tenant_id                      = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vuln_identifier                = Column(String(20),  nullable=True)   # VULN-001
    title                          = Column(String(255), nullable=True)
    description                    = Column(Text,        nullable=True)
    vendor_link                    = Column(String(500), nullable=True)
    cve_number                     = Column(String(50),  nullable=True)
    cve_score                      = Column(Float,       nullable=True)   # 0-10
    affected_technology            = Column(Text,        nullable=True)
    affected_assets                = Column(Text,        nullable=True)
    threat_analysis                = Column(Text,        nullable=True)
    threat_severity                = Column(Integer,     nullable=True)   # 1-5
    risk_likelihood                = Column(Integer,     nullable=True)   # 1-5
    risk_severity                  = Column(Integer,     nullable=True)   # 1-5
    owner                          = Column(String(255), nullable=True)
    status                         = Column(String(30),  default="OPEN")  # OPEN / IN PROGRESS / ON HOLD / RESOLVED
    first_observation_date         = Column(Date,        nullable=True)
    due_date                       = Column(Date,        nullable=True)
    resolution_date                = Column(Date,        nullable=True)
    comments                       = Column(Text,        nullable=True)
    owner_user_id                  = Column(Integer,     ForeignKey("grc_users.id"), nullable=True)
    # Bridge to the general Vulnerability record (auto-created so the NCA entry
    # inherits the full vuln-management detail page: tabs, mitigations, asset/
    # control/dept/workflow/escalation/exception infrastructure).
    bridged_vulnerability_id       = Column(Integer,     ForeignKey("grc_vulnerabilities.id"), nullable=True, index=True)
    linked_asset_ids               = Column(JSON,        default=list, nullable=True)
    linked_control_ids             = Column(JSON,        default=list, nullable=True)
    mitigation_actions             = Column(JSON,        default=list, nullable=True)
    ai_recommendation              = Column(Text,        nullable=True)
    ai_recommendation_generated_at = Column(DateTime,    nullable=True)
    created_at                     = Column(DateTime,    default=datetime.utcnow)
    updated_at                     = Column(DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")


class NcaKpiEntry(Base):
    """NCA Cybersecurity Key Performance Indicator (KPI) Report Template entry.

    Captures both the KPI definition (KPI sheet) and its annual measurements
    (Measurement table sheet) in a single flat row so the user can upload the
    NCA template Excel as-is and edit everything in one form.
    """
    __tablename__ = "grc_nca_kpi_entries"

    id                             = Column(Integer, primary_key=True, index=True)
    tenant_id                      = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    # ── KPI definition (KPI sheet columns B-I in the NCA template) ──────────
    kpi_identifier                 = Column(String(20),  nullable=True)   # auto: KPI-001
    cybersecurity_domain           = Column(String(255), nullable=True)   # e.g. "Asset Management", "Network Security"
    kpi_name                       = Column(String(500), nullable=True)   # column D — Key Performance Indicator
    kpi_description                = Column(Text,        nullable=True)   # column E
    kpi_definition                 = Column(Text,        nullable=True)   # column F — formula/measurement
    kpi_type                       = Column(String(50),  nullable=True)   # Percentage / Number / etc.
    frequency                      = Column(String(50),  nullable=True)   # Quarterly / Weekly / Annually / Monthly / By-weekly
    data_source                    = Column(String(255), nullable=True)   # devices / databases / business apps / etc.

    # ── Reporting period + measurements (Measurement table sheet columns F-R) ─
    reporting_year                 = Column(Integer,     nullable=True)   # e.g. 2024
    prior_year_q4_actual           = Column(Float,       nullable=True)   # Prior Year Q4 Actual baseline

    q1_target                      = Column(Float,       nullable=True)
    q1_actual                      = Column(Float,       nullable=True)
    q1_notes                       = Column(Text,        nullable=True)

    q2_target                      = Column(Float,       nullable=True)
    q2_actual                      = Column(Float,       nullable=True)
    q2_notes                       = Column(Text,        nullable=True)

    q3_target                      = Column(Float,       nullable=True)
    q3_actual                      = Column(Float,       nullable=True)
    q3_notes                       = Column(Text,        nullable=True)

    q4_target                      = Column(Float,       nullable=True)
    q4_actual                      = Column(Float,       nullable=True)
    q4_notes                       = Column(Text,        nullable=True)

    # ── Platform integration (matches the pattern used by NcaVulnEntry / NcaRiskEntry) ─
    owner_user_id                  = Column(Integer,     ForeignKey("grc_users.id"), nullable=True)
    linked_risk_ids                = Column(JSON,        default=list, nullable=True)
    linked_control_ids             = Column(JSON,        default=list, nullable=True)
    ai_recommendation              = Column(Text,        nullable=True)
    ai_recommendation_generated_at = Column(DateTime,    nullable=True)
    created_at                     = Column(DateTime,    default=datetime.utcnow)
    updated_at                     = Column(DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")


class TenantArtifact(Base):
    """Tenant-specific artifact instance created from or linked to a catalog item."""
    __tablename__ = "grc_tenant_artifacts"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    catalog_item_id = Column(Integer, ForeignKey("grc_artifact_catalog_items.id"), nullable=True, index=True)
    assessment_id = Column(Integer, nullable=True, index=True)        # linked assessment (no FK — cross-table)
    framework_key = Column(String(100), nullable=False, index=True)

    # Artifact metadata (copied from catalog or user-provided)
    name = Column(String(500), nullable=False)
    artifact_type = Column(String(100), nullable=False)
    stage = Column(String(100), nullable=True)
    control_ref = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    format = Column(String(100), nullable=True)

    # Content
    content = Column(Text, nullable=True)                             # Editable rich-text / JSON content
    file_path = Column(String(500), nullable=True)                    # Uploaded file path
    file_name = Column(String(255), nullable=True)
    file_size = Column(Integer, nullable=True)

    # Status & ownership
    status = Column(String(50), default="draft")                      # draft, in_review, approved, archived
    assigned_to_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    reviewed_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    # Platform-native link
    is_platform_native = Column(Boolean, default=False)
    platform_data_type = Column(String(100), nullable=True)
    platform_record_count = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    catalog_item = relationship("ArtifactCatalogItem")
    assigned_to = relationship("GRCUser", foreign_keys=[assigned_to_id])
    created_by = relationship("GRCUser", foreign_keys=[created_by_id])
    reviewed_by = relationship("GRCUser", foreign_keys=[reviewed_by_id])
    approved_by = relationship("GRCUser", foreign_keys=[approved_by_id])

    __table_args__ = (
        Index("ix_tenant_artifact_tenant_framework", "tenant_id", "framework_key"),
        Index("ix_tenant_artifact_assessment", "tenant_id", "assessment_id"),
    )


# =============================================================================
# RCSA Custom Templates — bring-your-own-Excel-template RCSA
# Banks usually have a long-standing internal RCSA template (UBL's is the
# canonical example). Forcing them onto our question/response model breaks
# adoption. These two tables let a tenant upload their template once, persist
# its exact column structure, and then drive every row of data plus the
# re-export through that schema — additive to RCSATemplate/RCSAQuestion,
# which keep working unchanged for tenants that don't bring a custom file.
# =============================================================================

class RCSACustomTemplate(Base):
    """Tenant-uploaded RCSA Excel template + parsed schema.

    ``column_schema`` captures the column hierarchy the parser pulled out of
    the Excel (groups + sub-columns, e.g. "Inherent Risk Assessment" → Impact /
    Likelihood / Overall / Concept). It is the contract every CRUD payload
    and re-export call follows. ``original_file`` is the raw .xlsx so we can
    reproduce the operator's exact format on download/export.
    """
    __tablename__ = "grc_rcsa_custom_templates"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    # Free-text label for which functional area this template covers — e.g.
    # "Information Security", "Branch Operations", "Treasury". Surfaces in the
    # tenant's RCSA module nav so multiple uploads can coexist per tenant.
    function_area = Column(String(120), nullable=True)
    original_filename = Column(String(500), nullable=False)
    sheet_name = Column(String(255), nullable=True)
    # Parsed column hierarchy. Shape:
    #   {
    #     "header_row_count": 2,
    #     "data_start_row": 4,
    #     "groups": [{"label": "Inherent Risk Assessment",
    #                  "columns": [{"key": "inherent_impact", "label": "Impact/Severity",
    #                               "col_index": 10, "data_type": "number"}, ...]},
    #                ...],
    #     "flat_columns": [{"key": "...", "label": "...", "group": "...",
    #                       "col_index": <1-based>, "data_type": "..."}, ...]
    #   }
    column_schema = Column(JSON, nullable=False, default=dict)
    # Raw .xlsx bytes so we can re-emit the exact original layout on export.
    # Capped at 25 MB by the upload endpoint; a typical RCSA template is < 1 MB.
    original_file = Column(LargeBinary, nullable=True)
    file_sha256 = Column(String(64), nullable=True, index=True)
    # Whether this template is the tenant's active default (one per
    # function_area). Multiple templates can exist; only one is "live" per area.
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    rows = relationship("RCSACustomRow", back_populates="template", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_rcsa_custom_template_tenant", "tenant_id"),
        Index("ix_rcsa_custom_template_active", "tenant_id", "is_active"),
    )


class RCSACustomRow(Base):
    """One risk row inside a custom RCSA template's matrix.

    The row's actual content lives in ``data`` as a JSON blob keyed by the
    schema's ``flat_columns[i].key``. This keeps the model schema-agnostic
    (template-driven) while still letting us index a handful of
    cross-cutting fields (risk_id_text, overall_residual_score) for filters
    and dashboards.
    """
    __tablename__ = "grc_rcsa_custom_rows"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("grc_rcsa_custom_templates.id"), nullable=False, index=True)
    # Operator-provided Risk ID from the template (e.g. "IS-001"). Free text
    # because each bank has its own convention.
    risk_id_text = Column(String(60), nullable=True, index=True)
    # Convenience denorms for dashboards / sort/filter without parsing JSON:
    inherent_overall_label = Column(String(40), nullable=True)
    residual_overall_label = Column(String(40), nullable=True)
    inherent_overall_score = Column(Integer, nullable=True, index=True)
    residual_overall_score = Column(Integer, nullable=True, index=True)
    # Full row payload — keys match column_schema.flat_columns[i].key.
    data = Column(JSON, nullable=False, default=dict)
    # Optional linkage into the platform's Risk Register so a row can be
    # promoted to a first-class Risk with KRIs / mitigation actions.
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    # AI provenance — set when an LLM populated this row (or some of its
    # fields). Stored as a small JSON of {field_key: "ai|user|imported"}.
    field_origins = Column(JSON, nullable=True, default=dict)
    # Optional ownership — the tenant user accountable for this risk row.
    # Mirrors the assignment pattern used on Issues, Critical Tasks, and
    # Policy Statements. Idempotent column-add migration ensures existing
    # tenant DBs gain the column without a destructive recreate.
    assigned_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    # Cached AI explanation so re-opening the drawer doesn't re-spend
    # tokens until the user clicks "Re-analyze". `ai_explanation_at`
    # mirrors content-cache patterns elsewhere in the codebase.
    ai_explanation = Column(Text, nullable=True)
    ai_explanation_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    template = relationship("RCSACustomTemplate", back_populates="rows")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    updater = relationship("GRCUser", foreign_keys=[updated_by])
    assignee = relationship("GRCUser", foreign_keys=[assigned_user_id])
    linked_risk = relationship("Risk", foreign_keys=[linked_risk_id])
    evidence_items = relationship(
        "RCSACustomRowEvidence",
        back_populates="row",
        cascade="all, delete-orphan",
        order_by="desc(RCSACustomRowEvidence.uploaded_at)",
    )

    __table_args__ = (
        Index("ix_rcsa_custom_row_template", "template_id"),
        Index("ix_rcsa_custom_row_tenant_template", "tenant_id", "template_id"),
        Index("ix_rcsa_custom_row_residual", "tenant_id", "residual_overall_score"),
    )


class RCSACustomRowEvidence(Base):
    """Files attached to a single RCSA custom-template row.

    Storage layout matches the framework-risk-assessment evidence pattern:
    the upload writes to disk under `uploads/rcsa_custom_evidence/` and the
    file metadata lives in this row. We don't dual-write to the global
    Evidence repository — operators can re-attach via the regular evidence
    UI if cross-surfacing is needed.
    """
    __tablename__ = "grc_rcsa_custom_row_evidence"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    row_id = Column(Integer, ForeignKey("grc_rcsa_custom_rows.id"), nullable=False, index=True)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(120), nullable=True)
    description = Column(Text, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # When the operator linked an item from the Evidence Library instead
    # of uploading a fresh file, this FK keeps the lineage so the UI can
    # show "from library" + jump back to the original record. Stored
    # `file_path` mirrors the library item's path (we don't dup the file).
    linked_evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True, index=True)

    row = relationship("RCSACustomRow", back_populates="evidence_items")
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])
    linked_evidence = relationship("Evidence", foreign_keys=[linked_evidence_id])

    __table_args__ = (
        Index("ix_rcsa_custom_row_evidence_row", "row_id"),
        Index("ix_rcsa_custom_row_evidence_tenant", "tenant_id"),
    )


# =============================================================================
# Criticality Assessments (per the bank-provided templates)
# Two assessment types: Information System (ISCA) and Infrastructure Asset
# (IACA). Each item is an independent assessment row; can optionally link
# back to an ITAsset so the rating + criticality flow into the platform-
# native asset record. Score columns are individual so dashboards can
# filter/sort without parsing JSON.
# =============================================================================

class InfoSystemCriticalityItem(Base):
    """Information System Criticality Assessment item (ISCA).

    Implements every field on the bank-provided template:
      - Identity: name, description, address (URL/IP)
      - Stakeholders (Business Owner / Service Owner / Assessor), each with
        an optional user FK plus free-text fall-backs so an operator can
        record someone who isn't yet a platform user.
      - 8 scoring criteria (1–4 typical, 0/2/4 for Internet Facing, 0/4 for
        B2B Exposure). Score columns are int so SUM/AVG queries work.
      - Computed `total_score` (sum) and `criticality_level` band per the
        template's calculation sheet: 24-32 mission-critical, 19-23 high,
        13-18 moderate, 6-12 low.
    """
    __tablename__ = "grc_info_system_criticality_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    # Optional linkage to the platform IT asset inventory so the same record
    # surfaces under both /assets/<id> and the criticality assessment list.
    linked_asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=True, index=True)

    # Identity
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    address = Column(String(500), nullable=True)

    # Business Owner
    business_owner_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    business_owner_name = Column(String(255), nullable=True)
    business_owner_designation = Column(String(255), nullable=True)
    business_owner_phone = Column(String(64), nullable=True)
    business_owner_email = Column(String(255), nullable=True)

    # Service Owner / Delivery Manager
    service_owner_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    service_owner_name = Column(String(255), nullable=True)
    service_owner_designation = Column(String(255), nullable=True)
    service_owner_phone = Column(String(64), nullable=True)
    service_owner_email = Column(String(255), nullable=True)

    # Assessor (IT/IS)
    assessor_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    assessor_name = Column(String(255), nullable=True)
    assessor_designation = Column(String(255), nullable=True)
    assessor_phone = Column(String(64), nullable=True)
    assessor_email = Column(String(255), nullable=True)

    date_of_assessment = Column(Date, nullable=True)

    # Scoring (matches Selection sheet bands)
    operational_dependency = Column(Integer, nullable=True)            # 1-4
    financial_impact = Column(Integer, nullable=True)                  # 1-4
    customer_stakeholder_impact = Column(Integer, nullable=True)        # 1-4
    data_sensitivity = Column(Integer, nullable=True)                  # 1-4
    unauthorized_access_risk = Column(Integer, nullable=True)          # 1-4
    rto_rpo_requirements = Column(Integer, nullable=True)              # 1-4
    internet_facing = Column(Integer, nullable=True)                   # 0 / 2 / 4
    b2b_exposure = Column(Integer, nullable=True)                      # 0 / 4

    # Computed at write time so dashboards don't have to recalc per query.
    total_score = Column(Integer, nullable=True, index=True)
    # mission_critical | high | moderate | low | null (incomplete)
    criticality_level = Column(String(32), nullable=True, index=True)

    comments = Column(Text, nullable=True)

    # ── Approval workflow (Phase 2) ───────────────────────────────────────
    # draft → submitted → business_owner_review → ciso_review → approved |
    # rejected | returned. Edit is locked while in any review state.
    approval_status = Column(String(32), nullable=True, default="draft", index=True)
    current_approval_tier = Column(Integer, nullable=True)  # 1, 2, 3 or null
    submitted_at = Column(DateTime, nullable=True)
    submitted_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    rejected_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    rejection_reason = Column(Text, nullable=True)

    # Idempotent linkage into the Risk Register when an operator clicks
    # Promote-to-Risk. Carries enough state that re-clicking is a no-op.
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    linked_asset = relationship("ITAsset", foreign_keys=[linked_asset_id])
    business_owner_user = relationship("GRCUser", foreign_keys=[business_owner_user_id])
    service_owner_user = relationship("GRCUser", foreign_keys=[service_owner_user_id])
    assessor_user = relationship("GRCUser", foreign_keys=[assessor_user_id])
    submitter = relationship("GRCUser", foreign_keys=[submitted_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    rejecter = relationship("GRCUser", foreign_keys=[rejected_by])
    linked_risk = relationship("Risk", foreign_keys=[linked_risk_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    updater = relationship("GRCUser", foreign_keys=[updated_by])

    __table_args__ = (
        Index("ix_isca_tenant", "tenant_id"),
        Index("ix_isca_tenant_level", "tenant_id", "criticality_level"),
        Index("ix_isca_linked_asset", "linked_asset_id"),
        Index("ix_isca_tenant_status", "tenant_id", "approval_status"),
    )


class InfraAssetCriticalityItem(Base):
    """Infrastructure Asset Criticality Assessment item (IACA).

    Implements the weighted-scoring template: 9 criteria each rated 1–4,
    multiplied by a fixed weight from the template's Calculation sheet
    (15/12/12/10/10/10/10/11/10 %). Total score is the sum of weighted
    scores (range 0.0–4.0). Criticality level: ≥3.0 high, 2.0–2.99
    moderate, <2.0 low; ≥3.5 mission-critical.
    """
    __tablename__ = "grc_infra_asset_criticality_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    linked_asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=True, index=True)

    # Identity
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    make_model = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    associated_ips = Column(Text, nullable=True)
    fault_tolerance = Column(String(64), nullable=True)  # Yes / No / Partial / N/A

    # Asset Custodian
    custodian_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    custodian_name = Column(String(255), nullable=True)
    custodian_designation = Column(String(255), nullable=True)
    custodian_phone = Column(String(64), nullable=True)
    custodian_email = Column(String(255), nullable=True)

    # Asset Administrator
    administrator_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    administrator_name = Column(String(255), nullable=True)
    administrator_designation = Column(String(255), nullable=True)
    administrator_phone = Column(String(64), nullable=True)
    administrator_email = Column(String(255), nullable=True)

    # Assessor (IT/IS)
    assessor_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    assessor_name = Column(String(255), nullable=True)
    assessor_designation = Column(String(255), nullable=True)
    assessor_phone = Column(String(64), nullable=True)
    assessor_email = Column(String(255), nullable=True)

    date_of_assessment = Column(Date, nullable=True)

    # 9 weighted criteria, each rated 1-4 by the assessor.
    business_impact = Column(Integer, nullable=True)              # weight 15
    service_dependency = Column(Integer, nullable=True)           # weight 12
    data_sensitivity = Column(Integer, nullable=True)             # weight 12
    redundancy_failover = Column(Integer, nullable=True)          # weight 10
    rto = Column(Integer, nullable=True)                          # weight 10
    availability_requirement = Column(Integer, nullable=True)     # weight 10
    operational_disruption = Column(Integer, nullable=True)       # weight 10
    regulatory_dependency = Column(Integer, nullable=True)        # weight 11
    exposure = Column(Integer, nullable=True)                     # weight 10

    # Weighted total (0.00-4.00) and computed band.
    total_score = Column(Float, nullable=True, index=True)
    criticality_level = Column(String(32), nullable=True, index=True)

    comments = Column(Text, nullable=True)

    # ── Approval workflow (Phase 2) — mirrors ISCA shape ─────────────────
    approval_status = Column(String(32), nullable=True, default="draft", index=True)
    current_approval_tier = Column(Integer, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    submitted_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    rejected_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    rejection_reason = Column(Text, nullable=True)

    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    linked_asset = relationship("ITAsset", foreign_keys=[linked_asset_id])
    custodian_user = relationship("GRCUser", foreign_keys=[custodian_user_id])
    administrator_user = relationship("GRCUser", foreign_keys=[administrator_user_id])
    assessor_user = relationship("GRCUser", foreign_keys=[assessor_user_id])
    submitter = relationship("GRCUser", foreign_keys=[submitted_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    rejecter = relationship("GRCUser", foreign_keys=[rejected_by])
    linked_risk = relationship("Risk", foreign_keys=[linked_risk_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    updater = relationship("GRCUser", foreign_keys=[updated_by])

    __table_args__ = (
        Index("ix_iaca_tenant", "tenant_id"),
        Index("ix_iaca_tenant_level", "tenant_id", "criticality_level"),
        Index("ix_iaca_linked_asset", "linked_asset_id"),
        Index("ix_iaca_tenant_status", "tenant_id", "approval_status"),
    )


# ─── Criticality Assessments — collaboration tables (Phase 2) ────────────
# Three lightweight tables that hang off either ISCA or IACA via the
# discriminator pair (assessment_kind, assessment_id). Avoids two parallel
# table families when the rows are structurally identical — same approach
# as IssueActivity uses one table for all issue events.

class CriticalityAssessmentActivity(Base):
    """Per-item audit trail. Mirrors IssueActivity's shape: lightweight,
    populated explicitly by the router on every write path. Types include
    ``created``, ``updated``, ``score_changed``, ``submitted``, ``approved``,
    ``rejected``, ``returned``, ``commented``, ``evidence_uploaded``,
    ``evidence_deleted``, ``promoted_to_risk``, ``task_created``.
    """
    __tablename__ = "grc_criticality_assessment_activity"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # 'isca' | 'iaca' — pairs with assessment_id to point at the item.
    assessment_kind = Column(String(8), nullable=False)
    assessment_id = Column(Integer, nullable=False)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    type = Column(String(40), nullable=False)
    payload = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("GRCUser", foreign_keys=[user_id])

    __table_args__ = (
        Index(
            "ix_critassess_activity_target",
            "tenant_id", "assessment_kind", "assessment_id", "created_at",
        ),
    )


class CriticalityAssessmentComment(Base):
    """Threaded comments on a criticality assessment item. Mirrors
    IssueComment — `parent_id` self-FK enables one-level replies, deeper
    threading is allowed but the UI flattens to two levels.
    """
    __tablename__ = "grc_criticality_assessment_comments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    assessment_kind = Column(String(8), nullable=False)
    assessment_id = Column(Integer, nullable=False)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    parent_id = Column(Integer, ForeignKey("grc_criticality_assessment_comments.id"), nullable=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    edited_at = Column(DateTime, nullable=True)

    user = relationship("GRCUser", foreign_keys=[user_id])
    parent = relationship("CriticalityAssessmentComment", remote_side=[id])

    __table_args__ = (
        Index(
            "ix_critassess_comment_target",
            "tenant_id", "assessment_kind", "assessment_id", "created_at",
        ),
    )


class CriticalityAssessmentEvidence(Base):
    """Files attached to a single criticality assessment item. Disk layout
    mirrors `uploads/rcsa_custom_evidence/` — UUID-prefixed filenames,
    metadata in this row, no dual-write to the global Evidence repository.
    """
    __tablename__ = "grc_criticality_assessment_evidence"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    assessment_kind = Column(String(8), nullable=False)
    assessment_id = Column(Integer, nullable=False)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(120), nullable=True)
    description = Column(Text, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])

    __table_args__ = (
        Index(
            "ix_critassess_evidence_target",
            "tenant_id", "assessment_kind", "assessment_id",
        ),
    )


# =============================================================================
# CIS Integration — Agents, Plugin Engine, Risk Posture
# Additive only: every table is new, every FK targets pre-existing tables,
# no existing model is mutated. ITAsset and IntegrationConnection already
# present in this file are strict supersets of the CIS package versions,
# so they are not re-declared.
# =============================================================================

class ComplianceAgent(Base):
    """Collector agent registered to a tenant. Pushes scan results in
    instead of being pulled. Two operating modes:

      - collector: one agent per LAN, dials out, scans neighbors via
                   stored creds (Cywift-style).
      - endpoint:  one agent per host, scans only itself (per-endpoint
                   deployment via GPO / SCCM / Intune).
    """
    __tablename__ = "grc_compliance_agents"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=True, index=True)

    enrollment_token_hash = Column(String(128), nullable=True, index=True)
    api_token_hash = Column(String(128), nullable=True, index=True)

    agent_name = Column(String(255), nullable=False)
    mode = Column(String(20), default="collector")  # collector | endpoint
    os_family = Column(String(50), nullable=True)   # windows | linux | macos
    agent_version = Column(String(50), nullable=True)
    hostname = Column(String(255), nullable=True)
    ip_address = Column(String(50), nullable=True)

    status = Column(String(50), default="pending")  # pending | active | stale | revoked
    last_heartbeat_at = Column(DateTime, nullable=True)
    last_result_at = Column(DateTime, nullable=True)
    enrolled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    created_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    revoked_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    revoke_reason = Column(Text, nullable=True)

    # ─── Fleet enrollment (one token → N hosts) ──────────────────────────
    # A "fleet template" agent is a row whose enrollment_token can be used
    # by multiple hosts. Each successful enrollment spawns a new endpoint
    # agent child instead of burning the token. Quota + expiry let the
    # operator cap blast radius if the .cmd leaks.
    #   - kind='single'    → standard one-shot enrollment (default; legacy)
    #   - kind='template'  → fleet token, may be claimed up to enrollment_max_uses times
    #   - kind='spawned'   → endpoint agent created from a template; not a template itself
    kind = Column(String(20), nullable=False, server_default="single")
    enrollment_max_uses = Column(Integer, nullable=True)  # None = unlimited (still bounded by expiry)
    enrollment_uses = Column(Integer, nullable=False, server_default="0")
    enrollment_expires_at = Column(DateTime, nullable=True)
    spawned_from_agent_id = Column(Integer, ForeignKey("grc_compliance_agents.id"), nullable=True)

    # ─── Scan-now push (set by the asset page's Scan-now button) ─────────
    # When set, the next /jobs poll from this agent skips its normal 30s
    # tick and returns IMMEDIATELY with the asset's full rule batch. After
    # the agent has consumed the batch it clears the flag. Without this,
    # Scan-now had to wait up to 30s for the agent's natural heartbeat.
    pending_scan_at = Column(DateTime, nullable=True)
    pending_scan_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    tenant = relationship("Tenant")
    asset = relationship("ITAsset")
    created_by = relationship("GRCUser", foreign_keys=[created_by_user_id])
    revoked_by = relationship("GRCUser", foreign_keys=[revoked_by_user_id])

    __table_args__ = (
        Index("ix_agent_tenant_status", "tenant_id", "status"),
        UniqueConstraint("tenant_id", "agent_name", name="uq_agent_name_tenant"),
    )


class CisIngestJob(Base):
    """Tracks one PDF upload → rule-extraction job for the CIS plugin library."""
    __tablename__ = "grc_cis_ingest_jobs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    original_filename = Column(String(500), nullable=False)
    sha256 = Column(String(64), nullable=False, index=True)
    benchmark_label = Column(String(200), nullable=True)
    status = Column(String(30), nullable=False, default="pending")  # pending|running|completed|failed
    page_count = Column(Integer, nullable=True)
    rules_extracted = Column(Integer, default=0)
    rules_inserted = Column(Integer, default=0)
    rules_updated = Column(Integer, default=0)
    rules_flagged = Column(Integer, default=0)
    rules_toc_rejected = Column(Integer, default=0)
    ocr_pages = Column(Integer, default=0)
    error_text = Column(Text, nullable=True)
    extraction_log = Column(JSON, nullable=True, default=list)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    pdf_bytes = Column(LargeBinary, nullable=True)


class CompliancePlugin(Base):
    """A reusable compliance check plugin (e.g. one CIS benchmark rule).

    Library-style: tenant_id NULL = built-in catalog rule; tenant_id NOT NULL =
    tenant-customized clone or local rule.
    """
    __tablename__ = "grc_compliance_plugins"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    plugin_key = Column(String(200), nullable=False, index=True)
    benchmark = Column(String(100), nullable=False, index=True)
    rule_id = Column(String(50), nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    rationale = Column(Text, nullable=True)
    remediation = Column(Text, nullable=True)
    severity = Column(String(20), default="medium")
    runner_type = Column(String(30), nullable=False)
    check_definition = Column(JSON, nullable=False, default={})
    enabled = Column(Boolean, default=True)
    is_builtin = Column(Boolean, default=True)
    source_url = Column(String(500), nullable=True)
    schedule_cron = Column(String(50), nullable=True)
    # PDF-ingest provenance & hierarchy
    parent_plugin_id = Column(Integer, ForeignKey("grc_compliance_plugins.id"), nullable=True, index=True)
    depth = Column(Integer, default=0)
    section_path = Column(String(500), nullable=True)
    level = Column(String(20), nullable=True)
    assessment_status = Column(String(20), nullable=True)
    audit_steps_text = Column(Text, nullable=True)
    references_json = Column(JSON, nullable=True, default=list)
    cis_controls_json = Column(JSON, nullable=True, default=list)
    mitre_techniques_json = Column(JSON, nullable=True, default=list)
    confidence_score = Column(Float, nullable=True)
    review_status = Column(String(30), default="auto_approved")
    auto_generated_check = Column(Boolean, default=False)
    source_ingest_job_id = Column(Integer, ForeignKey("grc_cis_ingest_jobs.id"), nullable=True, index=True)
    # ── Block A: AI-determined os_keys (regex/AI pre-classification, persisted) ──
    # Required by /library-tree (jsonb_array_elements_text(os_keys)) and
    # /os-registry (`p.os_keys ? v.normalized_key`). Without these the
    # library page renders "Couldn't load the library tree" because the
    # tree query SQL fails on the missing column.
    os_keys = Column(JSON, nullable=True, default=list)
    classification_source = Column(String(20), nullable=True)  # 'regex' | 'ai' | 'unknown'
    classified_at = Column(DateTime, nullable=True)
    # ── Block H: rule numbering validation ──
    benchmark_version = Column(String(40), nullable=True)
    target_builds = Column(JSON, nullable=True, default=list)
    benchmark_section_path = Column(String(500), nullable=True)
    rule_id_validated_at = Column(DateTime, nullable=True)
    rule_id_validation_status = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    runs = relationship("CompliancePluginRun", back_populates="plugin", cascade="all, delete-orphan")
    control_mappings = relationship("PluginControlMapping", back_populates="plugin", cascade="all, delete-orphan")
    children = relationship("CompliancePlugin", backref=backref("parent", remote_side="CompliancePlugin.id"))

    __table_args__ = (
        UniqueConstraint("tenant_id", "plugin_key", name="uq_compliance_plugin_tenant_key"),
        Index("ix_compliance_plugin_benchmark", "benchmark"),
        Index("ix_compliance_plugin_runner", "runner_type"),
    )


class PluginControlMapping(Base):
    """Maps a plugin to one or more compliance/framework controls."""
    __tablename__ = "grc_plugin_control_mappings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    plugin_id = Column(Integer, ForeignKey("grc_compliance_plugins.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    weight = Column(Float, default=1.0)
    created_at = Column(DateTime, default=datetime.utcnow)

    plugin = relationship("CompliancePlugin", back_populates="control_mappings")

    __table_args__ = (
        Index("ix_plugin_control_mapping_plugin", "plugin_id"),
    )


class PluginScheduleOverride(Base):
    """Per-tenant scheduling override for a built-in plugin."""
    __tablename__ = "grc_plugin_schedule_overrides"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    plugin_id = Column(Integer, ForeignKey("grc_compliance_plugins.id"), nullable=False, index=True)
    schedule_cron = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "plugin_id", name="uq_plugin_schedule_override_tenant_plugin"),
    )


class PluginAssetScope(Base):
    """Per-tenant asset-scoping rules for a plugin.

    mode is one of: all | include | exclude.
    """
    __tablename__ = "grc_plugin_asset_scopes"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    plugin_id = Column(Integer, ForeignKey("grc_compliance_plugins.id"), nullable=False, index=True)
    mode = Column(String(20), nullable=False, default="all")
    asset_ids = Column(JSON, nullable=False, default=list)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "plugin_id", name="uq_plugin_asset_scope_tenant_plugin"),
    )


class CompliancePluginRun(Base):
    """An immutable record of a single plugin execution against an asset."""
    __tablename__ = "grc_compliance_plugin_runs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    plugin_id = Column(Integer, ForeignKey("grc_compliance_plugins.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=True, index=True)
    connection_id = Column(Integer, ForeignKey("grc_integration_connections.id"), nullable=True, index=True)
    status = Column(String(30), nullable=False, default="pending")
    result_summary = Column(Text, nullable=True)
    raw_output = Column(JSON, nullable=True)
    result_detail = Column(Text, nullable=True)
    remediation_shown = Column(Text, nullable=True)
    evidence_snapshot = Column(JSON, nullable=True)
    evidence_hash = Column(String(64), nullable=True, index=True)
    duration_ms = Column(Integer, nullable=True)
    triggered_by = Column(String(30), default="manual")
    triggered_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)


    is_leaked = Column(Boolean, nullable=False, server_default="false", default=False, index=True)

    plugin = relationship("CompliancePlugin", back_populates="runs")
    asset = relationship("ITAsset")
    connection = relationship("IntegrationConnection")

    __table_args__ = (
        Index("ix_plugin_run_tenant_status", "tenant_id", "status"),
        Index("ix_plugin_run_plugin_asset", "plugin_id", "asset_id"),
    )


class TenantRiskWeights(Base):
    """Per-tenant override of the 5-dimension risk-scoring formula.

    A row changes how CIS / vulnerability / CIA / control / linked-risk
    dimensions are blended for that tenant's Risk Posture screen. No row
    falls back to the hard-coded defaults in risk_posture/service.py.

    Each row must sum to ~100% (DB-side CHECK enforces ±1% tolerance).
    """
    __tablename__ = "grc_tenant_risk_weights"

    tenant_id   = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), primary_key=True)
    weight_cis  = Column(Numeric(5, 2), nullable=False, default=25)
    weight_vuln = Column(Numeric(5, 2), nullable=False, default=30)
    weight_cia  = Column(Numeric(5, 2), nullable=False, default=15)
    weight_ctrl = Column(Numeric(5, 2), nullable=False, default=15)
    weight_risk = Column(Numeric(5, 2), nullable=False, default=15)
    preset_name = Column(String(40), nullable=True)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by  = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)


class BenchmarkOsMapping(Base):
    """Strict-single-stage matcher map (CIS integration).

    Replaces the AI Stage-2 router with an explicit, auditable lookup:
    asset.os_normalized prefix → benchmark name. Most-specific pattern
    wins. Operator owns this mapping. Archive benchmarks just don't get
    a row → never in scope. No AI call, no mixing of versions.

    Examples:
      pattern='windows-11', benchmark='CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1'
      pattern='windows-10', benchmark='CIS_Microsoft_Windows_10_Enterprise_Benchmark_v3.0.0'
      pattern='ubuntu-22.04', benchmark='CIS_Ubuntu_Linux_22.04_LTS_Benchmark_v3.0.0'

    Matching:
      asset 'windows-11-25H2' → walks down to 'windows-11' → finds row → benchmark v5.0.1
    """
    __tablename__ = "grc_benchmark_os_mappings"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    os_pattern = Column(String(80), nullable=False, index=True)
    benchmark_name = Column(String(200), nullable=False)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False, server_default="true")
    priority = Column(Integer, default=100, nullable=False)  # lower = higher priority when multiple match
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_bos_tenant_active", "tenant_id", "is_active"),
        UniqueConstraint("tenant_id", "os_pattern", "benchmark_name",
                         name="uq_benchmark_os_map_tenant_pattern_bench"),
    )



class OsVersion(Base):


    __tablename__ = "grc_os_versions"
    id = Column(Integer, primary_key=True, index=True)
    family = Column(String(40), nullable=False, index=True)          # 'windows' | 'linux' | 'cisco' | 'cloud' | 'db' | 'container' | 'macos'
    product = Column(String(80), nullable=True)                       # 'windows-11' | 'ubuntu' | 'cisco-ios-xe'
    build = Column(String(40), nullable=True)                         # '23H2' | '22.04' | '17.6.4'
    normalized_key = Column(String(80), nullable=False, unique=True)  # join key, e.g. 'windows-11-23H2'
    parent_key = Column(String(80), nullable=True, index=True)        # FK by string to another row's normalized_key
    display_name = Column(String(120), nullable=False)
    release_year = Column(Integer, nullable=True)
    eol_year = Column(Integer, nullable=True)
    is_supported = Column(Boolean, default=True, nullable=False, server_default="true")
    benchmark_hint = Column(String(200), nullable=True)               # suggested benchmark this OS most often maps to
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_os_version_family_product", "family", "product"),
        Index("ix_os_version_parent", "parent_key"),
    )

