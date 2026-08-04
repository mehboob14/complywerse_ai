from ._05_identity_provider_integration_microsoft_entra_id_etc import *  # noqa: F401,F403

# =============================================================================
# 4. Audit Trail
# =============================================================================

class AuditLog(Base):
    __tablename__ = "grc_audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    action = Column(String(100), nullable=False)
    resource_type = Column(String(100), nullable=False)
    resource_id = Column(Integer, nullable=True)
    changes = Column(JSON, default={})
    ip_address = Column(String(50), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    
    tenant = relationship("Tenant", back_populates="audit_logs")
    user = relationship("GRCUser", back_populates="audit_logs")
    
    __table_args__ = (
        Index("ix_audit_log_tenant_timestamp", "tenant_id", "timestamp"),
        Index("ix_audit_log_resource", "resource_type", "resource_id"),
    )

