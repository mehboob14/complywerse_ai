from ._03_rbac_models import *  # noqa: F401,F403

# =============================================================================
# 3. User Model (Extended)
# =============================================================================

class GRCUser(Base):
    __tablename__ = "grc_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    # Nullable to accommodate federated (SSO) users who never authenticate with a password.
    # Local-password users still get a bcrypt hash here on creation/update — existing flows unchanged.
    password_hash = Column(String(255), nullable=True)
    display_name = Column(String(255), nullable=True)
    department = Column(String(255), nullable=True)
    group = Column(String(255), nullable=True)
    division = Column(String(255), nullable=True)
    designation = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    # Federated identity (e.g. Microsoft Entra ID). NULL for local-password users.
    external_provider = Column(String(32), nullable=True, index=True)
    external_id = Column(String(128), nullable=True, index=True)

    # ---- Account lockout state (Admin → Password Policy controls thresholds) ----
    # Increment on each failed login, reset on success. When the count crosses
    # the policy's `lockout_threshold`, `locked_until` is set to now() +
    # policy.lockout_minutes. Login is blocked while `locked_until` > now().
    # All nullable so existing rows behave unchanged.
    failed_login_attempts = Column(Integer, default=0, nullable=True)
    locked_until = Column(DateTime, nullable=True)
    # Bumped on every authenticated request by the audit middleware. The login
    # handler refuses old tokens when `now - last_activity_at` > policy idle
    # timeout, so a forgotten-open tab is logged out server-side.
    last_activity_at = Column(DateTime, nullable=True)
    # Bumped whenever the user changes their password. Used by the future
    # "max password age" enforcement; safe to ignore for now.
    password_changed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_grc_users_external", "external_provider", "external_id"),
        Index("ix_grc_users_locked_until", "locked_until"),
    )
    
    tenant_users = relationship("TenantUser", back_populates="user", cascade="all, delete-orphan")
    user_roles = relationship(
        "UserRole",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="UserRole.user_id",
    )
    audit_logs = relationship("AuditLog", back_populates="user")
    uploaded_evidence = relationship("Evidence", back_populates="uploader", foreign_keys="Evidence.uploaded_by")
    evidence_versions = relationship("EvidenceVersion", back_populates="creator")
    owned_risks = relationship("Risk", back_populates="owner", foreign_keys="Risk.owner_id")
    owned_objectives = relationship("GovernanceObjective", back_populates="owner")
    owned_issues = relationship("Issue", back_populates="owner", foreign_keys="Issue.owner_id")
    owned_documents = relationship("Document", back_populates="owner", foreign_keys="Document.owner_id")
    approved_documents = relationship("Document", back_populates="approver", foreign_keys="Document.approved_by")
    document_versions = relationship("DocumentVersion", back_populates="creator")
    document_approvals = relationship("DocumentApprovalWorkflow", back_populates="approver")
    owned_gov_documents = relationship("GovernanceDocument", back_populates="owner", foreign_keys="GovernanceDocument.owner_id")
    # Phase 5.2 added 4 more FK columns from ITAsset → grc_users.id
    # (primary_owner_id, secondary_owner_id, escalation_contact_id,
    # business_owner_id). Without the explicit `foreign_keys` hint here,
    # SQLAlchemy can't decide which FK path back_populates this collection.
    owned_assets = relationship(
        "ITAsset",
        back_populates="owner",
        foreign_keys="ITAsset.owner_id",
    )
    asset_assessments = relationship("AssetRiskAssessment", back_populates="assessor")
    owned_programs = relationship("ComplianceProgram", back_populates="owner")
    compliance_assessments = relationship("GRCComplianceAssessment", back_populates="assessor")

