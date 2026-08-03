#!/usr/bin/env python3
"""Add VulnerabilitySolution model to models.py"""

import re

model_code = '''class VulnerabilitySolution(Base):
    """Remediation solutions for vulnerabilities from scanner integrations"""
    __tablename__ = "grc_vulnerability_solutions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    external_solution_id = Column(String(255), nullable=False)
    remediation_summary = Column(Text, nullable=True)
    remediation_steps = Column(Text, nullable=True)
    solution_type = Column(String(100), nullable=True)
    remediation_estimate = Column(String(255), nullable=True)
    additional_info = Column(Text, nullable=True)
    applies_to = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    vulnerability = relationship("Vulnerability")

    __table_args__ = (
        Index("ix_solution_tenant", "tenant_id"),
        Index("ix_solution_vuln", "vulnerability_id"),
        Index("ix_solution_external_id", "tenant_id", "vulnerability_id", "external_solution_id"),
        UniqueConstraint("tenant_id", "vulnerability_id", "external_solution_id", name="uq_solution_external"),
    )


'''

with open('grc/models.py', 'r') as f:
    content = f.read()

# Find the location to insert (after ScanRecord's __table_args__)
pattern = r'(class ScanRecord\(Base\):.*?UniqueConstraint\("tenant_id", "connection_id", "external_scan_id", name="uq_scan_record_external"\),\s*\)\s*\n)'
if not re.search(pattern, content, re.DOTALL):
    print("ERROR: Could not find insertion point")
    exit(1)

# Find the exact position after the ScanRecord class closes
# Look for the comment "# =============" right after ScanRecord
insert_pos = content.rfind('# =============================================================================\n# 22. Workflow Automation')
if insert_pos == -1:
    print("ERROR: Could not find workflow section marker")
    exit(1)

# Insert the VulnerabilitySolution model
new_content = content[:insert_pos] + model_code + '\n' + content[insert_pos:]

with open('grc/models.py', 'w') as f:
    f.write(new_content)

print("✅ VulnerabilitySolution model added successfully")
