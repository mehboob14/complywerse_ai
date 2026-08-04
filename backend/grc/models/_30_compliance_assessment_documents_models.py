from ._29_board_committee_management_models import *  # noqa: F401,F403

# =============================================================================
# 24. Compliance Assessment Documents Models
# =============================================================================

class ComplianceAssessmentDocument(Base):
    """Stores uploaded assessment documents (gap assessments, security checklists, audits)"""
    __tablename__ = "grc_compliance_assessment_documents"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(500), nullable=False)
    assessment_type = Column(String(100), nullable=False)  # gap_assessment, security_checklist, internal_audit
    source = Column(String(255), nullable=True)  # SBP, Internal, External Auditor
    file_name = Column(String(500), nullable=True)
    file_path = Column(String(1000), nullable=True)
    upload_date = Column(DateTime, default=datetime.utcnow)
    status = Column(String(50), default="draft")  # draft, in_progress, completed
    due_date = Column(DateTime, nullable=True)
    assessor = Column(String(255), nullable=True)
    overall_score = Column(Float, nullable=True)
    total_items = Column(Integer, default=0)
    complied_count = Column(Integer, default=0)
    partially_complied_count = Column(Integer, default=0)
    not_complied_count = Column(Integer, default=0)
    in_progress_count = Column(Integer, default=0)
    na_count = Column(Integer, default=0)
    notes = Column(Text, nullable=True)
    assessment_format = Column(String(50), default="standard")  # standard, xlsx_maturity
    xlsx_data = Column(JSON, nullable=True)  # Parsed multi-sheet data for maturity tool uploads
    # IT Assets this assessment is scoped to (e.g. the application ASVS verifies).
    # List of grc_it_assets.id; auditors set it from the assessment page.
    linked_asset_ids = Column(JSON, default=list)
    # Per-asset target level for level-scoped assessments (ASVS): {asset_id: 1|2|3}.
    # AI suggests it from the asset profile; user can override. Filters which
    # requirements apply to that asset.
    asset_levels = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    tenant = relationship("Tenant", back_populates="compliance_assessment_docs")
    creator = relationship("GRCUser")
    items = relationship("ComplianceAssessmentDocumentItem", back_populates="assessment", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_compliance_assessment_doc_tenant", "tenant_id"),
        Index("ix_compliance_assessment_doc_type", "assessment_type"),
        Index("ix_compliance_assessment_doc_status", "status"),
        Index("ix_compliance_assessment_doc_source", "source"),
    )


class ComplianceAssessmentDocumentItem(Base):
    """Individual control/question items within an assessment document"""
    __tablename__ = "grc_compliance_assessment_document_items"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_compliance_assessment_documents.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    item_number = Column(String(50), nullable=True)
    area_domain = Column(String(500), nullable=True)
    control_description = Column(Text, nullable=True)
    compliance_status = Column(String(50), default="in_progress")  # complied, partially_complied, not_complied, in_progress, na
    gaps_identified = Column(Text, nullable=True)
    proposed_solution = Column(Text, nullable=True)
    responsible_party = Column(String(255), nullable=True)
    timeline = Column(String(255), nullable=True)
    priority = Column(String(50), nullable=True)  # critical, high, medium, low
    evidence_reference = Column(Text, nullable=True)
    remarks = Column(Text, nullable=True)
    ai_evidence_recommendation = Column(Text, nullable=True)
    ai_recommendation_generated_at = Column(DateTime, nullable=True)
    # DCC-specific fields
    control_source = Column(String(50), nullable=True)   # 'dcc' for DCC-1:2022 controls
    control_type = Column(String(20), nullable=True)     # 'basic' or 'sub'
    subdomain_name = Column(Text, nullable=True)         # DCC subdomain label
    # PDPL maturity score (0-5). Drives compliance_status (3-5 => compliant).
    # NULL = not assessed yet. Editable per-control on the PDPL Assessment page.
    maturity_score = Column(Integer, nullable=True)
    # PDPL risk rating (free text: Low / Medium / High / Critical). Editable.
    risk_rating = Column(String(50), nullable=True)
    # Remediation Plan tracking — for gap items (e.g. PDPL controls scored < 3)
    # surfaced on the Remediation Plan tab. NULL until the item becomes a gap;
    # then tracked open -> in_progress -> closed independently of the
    # control's assessed compliance_status.
    remediation_status = Column(String(30), nullable=True)  # open, in_progress, closed
    # Per-asset verification status: {asset_id: compliance_status}. Used when an
    # assessment (e.g. ASVS) is verified separately against each in-scope asset —
    # the same requirement can Pass on one asset and Fail on another. The plain
    # compliance_status stays as the default / single-asset value.
    asset_status = Column(JSON, default=dict)
    # SLA / closure tracking. `target_date` is each point's own deadline (an
    # audit point carries its own timeline, independent of other points). When
    # NULL, the frontend SLA engine derives it as created_at + policy[priority].
    # `closed_at` is stamped when the point is closed (remediation_status=closed
    # or compliance_status=complied), so aging/closure math has a real date.
    target_date = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    assessment = relationship("ComplianceAssessmentDocument", back_populates="items")
    tenant = relationship("Tenant")
    evidence_uploads = relationship("AssessmentItemEvidence", back_populates="assessment_item", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_compliance_assessment_doc_item_assessment", "assessment_id"),
        Index("ix_compliance_assessment_doc_item_tenant", "tenant_id"),
        Index("ix_compliance_assessment_doc_item_status", "compliance_status"),
        Index("ix_compliance_assessment_doc_item_priority", "priority"),
    )


class ComplianceSlaPolicy(Base):
    """Tenant-level SLA policy for assessment points.

    Each priority tier gets an allowed number of days; a point's target date is
    derived as (date raised + tier days) unless an explicit target_date is set.
    `due_soon_days` is the default horizon for the "due soon" bucket. One row
    per tenant; the router upserts it and falls back to defaults when absent.
    """
    __tablename__ = "grc_compliance_sla_policy"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, unique=True, index=True)
    critical_days = Column(Integer, default=30)
    high_days = Column(Integer, default=60)
    medium_days = Column(Integer, default=90)
    low_days = Column(Integer, default=180)
    due_soon_days = Column(Integer, default=30)
    # Point-score weights (0-100) the bottom-up score is built from. User-tunable.
    score_closed_ontime = Column(Integer, default=100)
    score_closed_late = Column(Integer, default=70)
    score_on_track = Column(Integer, default=40)
    score_due_soon = Column(Integer, default=20)
    score_overdue = Column(Integer, default=0)
    score_no_date = Column(Integer, default=30)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")

