from ._23_track_a_phase_7_cloud_connector_framework_foundation import *  # noqa: F401,F403

# =============================================================================
# 19. Department Management Models
# =============================================================================

class GRCDepartment(Base):
    """Departments for vulnerability remediation and management with hierarchy support"""
    __tablename__ = "grc_departments"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    code = Column(String(50), nullable=False)  # e.g., "IT-SEC", "NET-OPS"
    description = Column(Text, nullable=True)
    
    parent_department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=True, index=True)
    department_head_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    department_head = relationship("GRCUser", foreign_keys=[department_head_user_id])
    parent_department = relationship("GRCDepartment", remote_side=[id], backref="sub_departments")
    members = relationship("GRCDepartmentMember", back_populates="department", cascade="all, delete-orphan")
    vulnerability_assignments = relationship("GRCVulnerabilityDepartmentAssignment", back_populates="department", cascade="all, delete-orphan")
    escalation_paths = relationship("GRCDepartmentEscalationPath", back_populates="department", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_department_tenant_name"),
        UniqueConstraint("tenant_id", "code", name="uq_department_tenant_code"),
        Index("ix_department_tenant", "tenant_id"),
        Index("ix_department_parent", "parent_department_id"),
    )


class GRCDepartmentMember(Base):
    """Department membership for users"""
    __tablename__ = "grc_department_members"
    
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    
    role = Column(String(50), nullable=False, default="member")  # head, lead, member
    email_notifications_enabled = Column(Boolean, default=True)
    escalation_order = Column(Integer, default=0)  # Priority for escalations
    
    added_at = Column(DateTime, default=datetime.utcnow)
    added_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    is_active = Column(Boolean, default=True)
    
    department = relationship("GRCDepartment", back_populates="members")
    user = relationship("GRCUser", foreign_keys=[user_id])
    added_by_user = relationship("GRCUser", foreign_keys=[added_by])
    
    __table_args__ = (
        UniqueConstraint("department_id", "user_id", name="uq_department_member"),
        Index("ix_department_member_dept", "department_id"),
        Index("ix_department_member_user", "user_id"),
    )


class GRCVulnerabilityDepartmentAssignment(Base):
    """Assignment of vulnerabilities to departments"""
    __tablename__ = "grc_vulnerability_department_assignments"
    
    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=False, index=True)
    
    assigned_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    
    priority = Column(String(20), nullable=False, default="medium")  # high, medium, low
    notes = Column(Text, nullable=True)
    sla_override_days = Column(Integer, nullable=True)  # Override default SLA
    notification_sent = Column(Boolean, default=False)
    
    vulnerability = relationship("Vulnerability")
    department = relationship("GRCDepartment", back_populates="vulnerability_assignments")
    assigner = relationship("GRCUser", foreign_keys=[assigned_by])
    
    __table_args__ = (
        UniqueConstraint("vulnerability_id", "department_id", name="uq_vuln_department_assignment"),
        Index("ix_vuln_dept_assignment_vuln", "vulnerability_id"),
        Index("ix_vuln_dept_assignment_dept", "department_id"),
    )


class GRCDepartmentEscalationPath(Base):
    """Escalation paths for departments"""
    __tablename__ = "grc_department_escalation_paths"
    
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=False, index=True)
    
    escalation_level = Column(Integer, nullable=False)  # 1, 2, 3
    target_role = Column(String(50), nullable=False)  # lead, head, parent_dept_head
    sla_threshold_percent = Column(Integer, nullable=False, default=75)  # e.g., 75, 100
    auto_escalate = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    department = relationship("GRCDepartment", back_populates="escalation_paths")
    
    __table_args__ = (
        UniqueConstraint("department_id", "escalation_level", name="uq_dept_escalation_level"),
        Index("ix_dept_escalation_dept", "department_id"),
    )

