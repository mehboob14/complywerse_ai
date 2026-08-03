#!/usr/bin/env python3
"""Add OutboundExceptionRequest model to models.py"""

model_code = '''class OutboundExceptionRequest(Base):
    """Outbound exception push requests to vulnerability scanners"""
    __tablename__ = "grc_outbound_exception_requests"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    connection_id = Column(Integer, ForeignKey("grc_integration_connections.id"), nullable=False, index=True)
    exception_type = Column(String(50), nullable=False)  # false_positive, risk_accepted, deferred
    reason = Column(String(100), nullable=False)
    justification = Column(Text, nullable=False)
    requested_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    expires_at = Column(DateTime, nullable=True)
    status = Column(String(50), default="pending_approval")  # pending_approval, approved, rejected, pushed, failed
    reviewed_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    review_notes = Column(Text, nullable=True)
    push_status = Column(String(50), nullable=True)  # pending, pushed, failed
    push_error = Column(Text, nullable=True)
    external_exception_id = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    vulnerability = relationship("Vulnerability")
    connection = relationship("IntegrationConnection")
    requested_by = relationship("GRCUser", foreign_keys=[requested_by_user_id])
    reviewed_by = relationship("GRCUser", foreign_keys=[reviewed_by_user_id])

    __table_args__ = (
        Index("ix_outbound_exception_request_tenant", "tenant_id"),
        Index("ix_outbound_exception_request_vuln", "vulnerability_id"),
        Index("ix_outbound_exception_request_status", "status"),
        Index("ix_outbound_exception_request_connection", "connection_id"),
    )


'''

with open('grc/models.py', 'r') as f:
    content = f.read()

# Find the location to insert (before VulnerabilitySolution)
insert_pos = content.find('class VulnerabilitySolution(Base):')
if insert_pos == -1:
    # If VulnerabilitySolution doesn't exist, insert before WorkflowDefinition
    insert_pos = content.find('class WorkflowDefinition(Base):')
    if insert_pos == -1:
        print("ERROR: Could not find insertion point (no VulnerabilitySolution or WorkflowDefinition)")
        exit(1)
    # Find the start of the comment before WorkflowDefinition
    comment_pos = content.rfind('# =============================================================================\n# 22. Workflow Automation', 0, insert_pos)
    if comment_pos != -1:
        insert_pos = comment_pos

# Insert the OutboundExceptionRequest model
new_content = content[:insert_pos] + model_code + '\n' + content[insert_pos:]

with open('grc/models.py', 'w') as f:
    f.write(new_content)

print("✅ OutboundExceptionRequest model added successfully")
