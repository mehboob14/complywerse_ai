from ._42_metric_snapshots import *  # noqa: F401,F403

# =============================================================================
# 43. Framework Template Models
#
# Backs the ISO 27001 (and future framework) template tabs on the framework
# detail page: tabular "registers" (Gap Analysis, Internal Audit Checklist,
# Risk Treatment Plan) and structured "documents" (ISMS Scope Statement,
# Internal Audit Procedure). Both are per-tenant and scoped to an uploaded
# framework, following the same additive/create_all provisioning as the rest
# of the platform (no Alembic).
# =============================================================================


class FrameworkRegisterEntry(Base):
    """One row in a framework template register.

    A single generic table powers several template registers, distinguished by
    ``register_type``. The columns are the union of the ISO 27001 templates'
    columns; each register uses the subset it needs (unused columns stay null).

    register_type:
        gap_analysis   -> Clause/area, Requirement, Status, Gap/action, Owner, Target date
        internal_audit -> Clause/control, Audit question, Evidence reviewed, Result, Finding type, Notes/action
        risk_treatment -> Risk ID, Risk description, Treatment option, Annex A/control,
                          Action plan, Owner, Target date, Status, Residual risk, Approved by
    """

    __tablename__ = "grc_framework_register_entries"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True, index=True)
    journey_id = Column(Integer, nullable=True, index=True)  # certification journey context (optional)

    register_type = Column(String(50), nullable=False, index=True)
    seq = Column(Integer, default=0)  # display order
    is_seed = Column(Boolean, default=False)  # created from the template defaults vs. user-added

    # Reference / clause / control / risk id
    reference = Column(String(255), nullable=True)
    # Requirement text / audit question / risk description
    title = Column(Text, nullable=True)

    # Assessment fields (union across the templates)
    status = Column(String(80), nullable=True)          # gap readiness / risk-treatment status
    result = Column(String(80), nullable=True)          # audit: conform / nonconform / ofi / na
    finding_type = Column(String(80), nullable=True)    # audit: nonconformity / ofi / observation
    treatment_option = Column(String(80), nullable=True)  # risk-treatment: mitigate/accept/avoid/transfer
    linked_control = Column(String(255), nullable=True)   # risk-treatment: Annex A control ref
    action = Column(Text, nullable=True)                # gap/action, action plan, notes/action
    evidence_reviewed = Column(Text, nullable=True)     # audit: evidence reviewed
    notes = Column(Text, nullable=True)
    justification = Column(Text, nullable=True)
    residual_risk = Column(String(80), nullable=True)   # risk-treatment
    approved_by = Column(String(255), nullable=True)    # risk-treatment approver (free text)

    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    owner_name = Column(String(255), nullable=True)     # free-text owner fallback
    target_date = Column(DateTime, nullable=True)

    # Move-to-risk linkage — the ERM Risk this entry was promoted into.
    risk_register_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    # Optional evidence linkage (id in the central evidence library).
    evidence_id = Column(Integer, nullable=True)

    # Any template-specific extras that don't warrant a column.
    data = Column(JSON, default={})

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("GRCUser", foreign_keys=[owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    risk = relationship("Risk", foreign_keys=[risk_register_id], uselist=False)

    __table_args__ = (
        Index("ix_fre_tenant_fw_type", "tenant_id", "uploaded_framework_id", "register_type"),
        Index("ix_fre_risk", "risk_register_id"),
    )


class FrameworkDocument(Base):
    """A structured framework template document (metadata box + sections).

    Backs the ISMS Scope Statement and Internal Audit Procedure tabs. Content is
    stored as structured sections (heading + body, optionally an editable table)
    so the templates stay queryable and can't lose their required sections.

    doc_type:
        isms_scope_statement
        internal_audit_procedure
    """

    __tablename__ = "grc_framework_documents"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True, index=True)
    journey_id = Column(Integer, nullable=True, index=True)

    doc_type = Column(String(80), nullable=False, index=True)
    title = Column(String(255), nullable=True)
    control_ref = Column(String(80), nullable=True)  # e.g. "Cl. 4.3"

    # Metadata / control box (structured, not markdown).
    organization = Column(String(255), nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    owner_name = Column(String(255), nullable=True)
    classification = Column(String(50), default="internal")
    version = Column(String(50), default="1.0")
    approved_by = Column(String(255), nullable=True)
    approval_date = Column(DateTime, nullable=True)
    effective_date = Column(DateTime, nullable=True)
    next_review_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="draft")  # draft | approved

    # Sections: [{ "heading": str, "body": str,
    #              "table"?: { "columns": [str], "rows": [[str]] } }, ...]
    sections = Column(JSON, default=[])

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("GRCUser", foreign_keys=[owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        Index("ix_framework_doc_tenant_type", "tenant_id", "uploaded_framework_id", "doc_type"),
    )
