from ._02_password_session_policy_per_tenant_single_row import *  # noqa: F401,F403

# =============================================================================
# 2. RBAC Models
# =============================================================================

class Role(Base):
    __tablename__ = "grc_roles"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    is_system_role = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant", back_populates="roles")
    role_permissions = relationship("RolePermission", back_populates="role", cascade="all, delete-orphan")
    user_roles = relationship("UserRole", back_populates="role", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_role_tenant_name", "tenant_id", "name"),
    )


class Permission(Base):
    __tablename__ = "grc_permissions"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    resource = Column(String(100), nullable=False)
    action = Column(String(50), nullable=False)
    
    role_permissions = relationship("RolePermission", back_populates="permission", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_permission_resource_action", "resource", "action"),
    )


class RolePermission(Base):
    __tablename__ = "grc_role_permissions"
    
    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("grc_roles.id"), nullable=False, index=True)
    permission_id = Column(Integer, ForeignKey("grc_permissions.id"), nullable=False, index=True)
    
    role = relationship("Role", back_populates="role_permissions")
    permission = relationship("Permission", back_populates="role_permissions")
    
    __table_args__ = (
        Index("ix_role_permission_composite", "role_id", "permission_id"),
    )


class UserRole(Base):
    __tablename__ = "grc_user_roles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("grc_roles.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True, index=True)
    assigned_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    # Origin of the assignment. NULL means manually assigned (legacy + admin UI).
    # "sso" means it was applied by Entra group→role mapping; only those rows are
    # reconciled on each SSO sign-in so manual assignments aren't clobbered.
    source = Column(String(16), nullable=True, default=None)

    user = relationship("GRCUser", back_populates="user_roles", foreign_keys=[user_id])
    role = relationship("Role", back_populates="user_roles")
    tenant = relationship("Tenant", back_populates="user_roles")
    business_unit = relationship("BusinessUnit", back_populates="user_roles")
    assigner = relationship("GRCUser", foreign_keys=[assigned_by])

    __table_args__ = (
        Index("ix_user_role_tenant", "tenant_id", "user_id"),
    )

