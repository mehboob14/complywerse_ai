# GRC Database Schema - Domain Organization

This document organizes 100+ database tables by functional domain to help AI agents navigate the system efficiently.

## 🎯 Domain Categories

### 1. COMPLIANCE & FRAMEWORKS (Tables: 15)

**Purpose**: Manage regulatory frameworks, controls, and compliance programs

**Core Tables**:

- `grc_frameworks` - Regulatory frameworks (PCI DSS, ISO 27001, etc.)
- `grc_framework_domains` - Framework domains/categories
- `grc_control_objectives` - Control objectives within domains
- `grc_framework_controls` - Individual framework requirements/controls
- `grc_framework_sub_controls` - Sub-controls for detailed requirements
- `grc_normalized_controls` - Unified control library across frameworks
- `grc_control_mappings` - Framework-to-normalized control mappings
- `grc_compliance_programs` - Organization's compliance programs
- `grc_compliance_assessments` - Compliance status assessments
- `grc_uploaded_frameworks` - Uploaded framework documents
- `grc_parsed_framework_controls` - AI-parsed framework controls
- `grc_framework_control_alignments` - Control alignment analysis
- `grc_framework_assessments` - Framework assessment campaigns
- `grc_assessment_items` - Individual assessment line items
- `grc_assessment_remediations` - Remediation actions for gaps

**Link Tables**:

- `grc_common_control_groups` - Groups of similar controls
- `grc_common_control_group_mappings` - Control-to-group mappings
- `grc_control_similarity_mappings` - AI-detected control similarities
- `grc_control_inheritances` - Control inheritance relationships

**Key Queries**:

- "What does PCI DSS require?" → `grc_framework_controls`
- "Show ISO 27001 controls" → `grc_framework_controls` + framework joins
- "Compliance status" → `grc_compliance_assessments`

---

### 2. EVIDENCE & DOCUMENTATION (Tables: 12)

**Purpose**: Manage evidence collection, document version control

**Core Tables**:

- `grc_evidence` - Evidence artifacts (screenshots, logs, configs)
- `grc_evidence_versions` - Evidence version history
- `grc_evidence_control_mappings` - Evidence-to-control links
- `grc_evidence_ai_assessments` - AI quality assessments
- `grc_required_evidence` - Required evidence types per control
- `grc_ai_evidence_recommendations` - AI-suggested evidence
- `grc_curated_evidence_items` - Curated evidence library
- `grc_implementation_evidence` - Control implementation proofs
- `grc_control_evidence_mappings` - Evidence mappings for uploaded frameworks
- `grc_assessment_evidence` - Assessment-specific evidence
- `grc_audit_packages` - Auditor evidence packages
- `grc_audit_package_evidence` - Package contents
- `grc_audit_package_access_logs` - Access tracking

**Link Tables**:

- `grc_evidence_incident_links` - Evidence-to-incident mappings
- `grc_evidence_policy_links` - Evidence-to-policy mappings

**Key Queries**:

- "Show evidence for control X" → `grc_evidence_control_mappings`
- "Missing evidence" → LEFT JOIN NULL checks
- "Evidence quality scores" → `grc_evidence_ai_assessments`

---

### 3. RISK MANAGEMENT (Tables: 15)

**Purpose**: Enterprise risk management, KRIs, incidents

**Core Tables**:

- `grc_risks` - Risk register
- `grc_risk_kris` - Key Risk Indicators
- `grc_risk_kri_measurements` - KRI measurement data
- `grc_risk_incidents` - Risk-related incidents
- `grc_risk_reviews` - Periodic risk reviews
- `grc_risk_score_history` - Risk scoring over time
- `grc_risk_dependencies` - Inter-risk dependencies
- `grc_risk_appetite_configs` - Risk appetite thresholds
- `grc_risk_mitigation_actions` - Mitigation action plans
- `grc_risk_reports` - Risk reporting outputs
- `grc_likelihood_impact_scales` - Scoring scales

**Link Tables**:

- `grc_risk_control_links` - Risk-to-control associations
- `grc_risk_asset_links` - Risk-to-asset associations
- `grc_risk_evidence_links` - Risk supporting evidence
- `grc_risk_framework_control_links` - Risk-to-framework-control
- `grc_risk_governance_links` - Risk-to-governance-objective
- `grc_risk_audit_finding_links` - Risk-to-audit-finding

**Key Queries**:

- "High-severity risks" → `WHERE inherent_score >= 15 OR residual_score >= 15`
- "Overdue risks" → `WHERE review_date < CURRENT_DATE`
- "KRI trends" → `grc_risk_kri_measurements` + time series

---

### 4. GOVERNANCE (Tables: 18)

**Purpose**: Committees, policies, regulatory changes, objectives

**Core Tables**:

- `grc_governance_committees` - Governance committees (Board, Risk, Audit)
- `grc_committee_members` - Committee membership
- `grc_committee_charters` - Committee charters/mandates
- `grc_committee_meetings` - Meeting schedule and records
- `grc_meeting_agenda_items` - Meeting agenda line items
- `grc_meeting_minutes` - Meeting minutes/notes
- `grc_oversight_actions` - Actions assigned by committees
- `grc_governance_objectives` - Strategic governance goals
- `grc_governance_documents` - Policy/procedure documents
- `grc_governance_document_versions` - Document versions
- `grc_document_reviewers` - Review assignments
- `grc_document_approval_steps` - Approval workflow steps
- `grc_document_audit_logs` - Document access audit trail
- `grc_regulatory_changes` - Regulatory change tracking
- `grc_regulatory_impacts` - Impact analysis
- `grc_regulatory_actions` - Required actions
- `grc_regulatory_updates` - Updates to existing regulations

**Link Tables**:

- `grc_document_control_links` - Document-to-control mappings
- `grc_document_risk_links` - Document-to-risk mappings
- `grc_document_regulatory_links` - Document-to-regulation mappings
- `grc_document_asset_links` - Document-to-asset mappings

**Key Queries**:

- "Upcoming committee meetings" → `grc_committee_meetings WHERE meeting_date > NOW()`
- "Pending oversight actions" → `grc_oversight_actions WHERE status IN ('open', 'in_progress')`
- "Recent regulatory changes" → `grc_regulatory_changes ORDER BY published_date DESC`

---

### 5. VULNERABILITY MANAGEMENT (Tables: 7)

**Purpose**: Security vulnerability tracking and remediation

**Core Tables**:

- `grc_vulnerabilities` - Vulnerability register
- `grc_vulnerability_reports` - Scan reports (Nessus, Qualys)
- `grc_vulnerability_sla_config` - SLA by severity
- `grc_vulnerability_comments` - Discussion threads
- `grc_vulnerability_history` - Status change history

**Link Tables**:

- `grc_vulnerability_control_links` - Vuln-to-control mappings
- `grc_vulnerability_asset_links` - Vuln-to-asset mappings

**Key Queries**:

- "Critical vulns overdue" → `WHERE severity='critical' AND due_date < NOW() AND status != 'Closed'`
- "SLA breaches" → JOIN with `grc_vulnerability_sla_config`
- "Vulnerabilities by asset" → JOIN with `grc_vulnerability_asset_links`

---

### 6. INTERNAL CONTROLS (Tables: 6)

**Purpose**: Organization's internal control framework

**Core Tables**:

- `grc_internal_controls` - Internal control library
- `grc_internal_control_tests` - Control testing records
- `grc_internal_control_deficiencies` - Identified control gaps
- `grc_internal_control_remediations` - Remediation plans
- `grc_control_implementations` - Implementation status

**Link Tables**:

- `grc_internal_control_framework_links` - Internal-to-framework mappings

**Key Queries**:

- "Active internal controls" → `WHERE status = 'active'`
- "Controls by department" → `WHERE department_id = X`
- "Control test results" → `grc_internal_control_tests`

---

### 7. ATTESTATION & CERTIFICATION (Tables: 8)

**Purpose**: User attestations, compliance certifications

**Core Tables**:

- `grc_attestation_campaigns` - Attestation campaigns
- `grc_attestation_requests` - Individual requests
- `grc_attestation_responses` - User responses
- `grc_policy_attestations` - Policy acceptance tracking
- `grc_certification_journeys` - Certification programs
- `grc_certification_phases` - Certification milestones

**Key Queries**:

- "Pending attestations" → `WHERE status = 'pending' AND due_date > NOW()`
- "Overdue attestations" → `WHERE status != 'completed' AND due_date < NOW()`
- "Certification progress" → `grc_certification_phases` progress tracking

---

### 8. RCSA (Risk & Control Self-Assessment) (Tables: 5)

**Purpose**: Self-assessment campaigns and findings

**Core Tables**:

- `grc_rcsa_templates` - Assessment templates
- `grc_rcsa_campaigns` - Assessment campaigns
- `grc_rcsa_assessments` - Individual assessments
- `grc_rcsa_findings` - Identified findings
- `grc_rcsa_approvals` - Approval workflow

**Key Queries**:

- "Active RCSA campaigns" → `WHERE status IN ('in_progress', 'draft')`
- "RCSA findings by severity" → `grc_rcsa_findings GROUP BY severity`

---

### 9. ASSETS & INFRASTRUCTURE (Tables: 5)

**Purpose**: IT asset inventory and criticality

**Core Tables**:

- `grc_it_assets` - IT asset inventory
- `grc_asset_risk_assessments` - Asset risk profiles

**Link Tables**:

- `grc_asset_control_links` - Asset-to-control
- `grc_asset_framework_control_links` - Asset-to-framework-control
- `grc_asset_evidence_links` - Asset supporting evidence

**Key Queries**:

- "Critical assets" → `WHERE criticality IN ('Critical', 'High')`
- "Assets without controls" → LEFT JOIN NULL checks

---

### 10. ISSUES & EXCEPTIONS (Tables: 4)

**Purpose**: Issue tracking and control exceptions

**Core Tables**:

- `grc_issues` - Compliance issues/gaps
- `grc_exceptions` - Control exceptions/waivers

**Key Queries**:

- "Open high-severity issues" → `WHERE severity='high' AND status='open'`
- "Active exceptions" → `WHERE status='approved' AND expiry_date > NOW()`

---

### 11. POLICY MANAGEMENT (Tables: 5)

**Purpose**: Policy statements and compliance tracking

**Core Tables**:

- `grc_policy_statements` - Parsed policy statements
- `grc_policy_statement_compliance` - Compliance status per statement

**Key Queries**:

- "Non-compliant policy statements" → `WHERE compliance_status != 'compliant'`

---

### 12. WORKFLOW MANAGEMENT (Tables: 6)

**Purpose**: Approval workflows and automation

**Core Tables**:

- `grc_workflow_templates` - Reusable workflow definitions
- `grc_workflow_steps` - Workflow step configurations
- `grc_workflow_step_approvers` - Step approver assignments
- `grc_document_workflow_instances` - Active workflow instances
- `grc_document_workflow_actions` - Workflow action history
- `grc_document_approval_workflows` - Document approval tracking

**Key Queries**:

- "Pending approvals for user X" → `WHERE approver_id = X AND status = 'pending'`
- "Workflow bottlenecks" → Identify steps with long durations

---

### 13. DEPARTMENTS & USERS (Tables: 8)

**Purpose**: Organizational structure and user management

**Core Tables**:

- `grc_tenants` - Multi-tenant support
- `grc_tenant_users` - Tenant-user associations
- `grc_business_units` - Organizational units
- `grc_departments` - Departments
- `grc_department_members` - Department membership
- `grc_users` - User accounts
- `grc_roles` - Role definitions
- `grc_permissions` - Permission catalog
- `grc_role_permissions` - Role-permission mappings
- `grc_user_roles` - User-role assignments
- `grc_audit_logs` - System audit trail

---

### 14. DOCUMENT MANAGEMENT (General) (Tables: 4)

**Purpose**: Generic document storage

**Core Tables**:

- `grc_documents` - Document library
- `grc_document_versions` - Version control

---

## 🔍 Navigation Guide for AI Agents

### Question Type → Domain Mapping

**Compliance Questions**:

- "What does [framework] require?" → COMPLIANCE & FRAMEWORKS
- "Show [framework] controls" → COMPLIANCE & FRAMEWORKS
- "Compliance status" → COMPLIANCE & FRAMEWORKS

**Evidence Questions**:

- "Show evidence for..." → EVIDENCE & DOCUMENTATION
- "Missing evidence" → EVIDENCE & DOCUMENTATION
- "Evidence quality" → EVIDENCE & DOCUMENTATION

**Risk Questions**:

- "High-severity risks" → RISK MANAGEMENT
- "Risk trends" → RISK MANAGEMENT
- "KRI metrics" → RISK MANAGEMENT

**Governance Questions**:

- "Committee meetings" → GOVERNANCE
- "Regulatory changes" → GOVERNANCE
- "Policy documents" → GOVERNANCE

**Security Questions**:

- "Vulnerabilities" → VULNERABILITY MANAGEMENT
- "Security scans" → VULNERABILITY MANAGEMENT
- "SLA breaches" → VULNERABILITY MANAGEMENT

**Asset Questions**:

- "Critical assets" → ASSETS & INFRASTRUCTURE
- "Asset inventory" → ASSETS & INFRASTRUCTURE

**Attestation Questions**:

- "Pending attestations" → ATTESTATION & CERTIFICATION
- "Certification progress" → ATTESTATION & CERTIFICATION

### Common Cross-Domain Queries

**"Show controls linked to risk X"**:

1. Start in RISK MANAGEMENT: `grc_risks`
2. Join to COMPLIANCE: `grc_risk_framework_control_links`
3. Return framework controls

**"Which assets are affected by vulnerability X"**:

1. Start in VULNERABILITY MANAGEMENT: `grc_vulnerabilities`
2. Join to ASSETS: `grc_vulnerability_asset_links`
3. Return asset details

**"Evidence for framework control X"**:

1. Start in COMPLIANCE: `grc_framework_controls`
2. Join to EVIDENCE: `grc_evidence_control_mappings`
3. Return evidence items

## 🛡️ NULL Handling Best Practices

### Problem: Queries returning half-valued/half-null results

**Solution**: Always use COALESCE() for display columns

```sql
-- ❌ BAD: Returns NULLs
SELECT name, description, owner_id
FROM grc_risks

-- ✅ GOOD: Handles NULLs gracefully
SELECT
  id,
  COALESCE(title, 'Untitled Risk') as title,
  COALESCE(category, 'Uncategorized') as category,
  COALESCE(status, 'unknown') as status,
  COALESCE(inherent_score, 0) as inherent_score
FROM grc_risks
WHERE status = 'open'
```

### NULL-Safe Filtering

```sql
-- ❌ BAD: Misses NULL values
WHERE owner_id = 123

-- ✅ GOOD: Explicit NULL handling
WHERE owner_id = 123 OR owner_id IS NULL

-- ✅ BETTER: Use COALESCE in WHERE
WHERE COALESCE(owner_id, -1) = 123
```

### NULL-Safe Joins

```sql
-- ❌ BAD: Inner join drops unlinked items
FROM grc_controls c
JOIN grc_evidence_control_mappings ecm ON c.id = ecm.control_id

-- ✅ GOOD: Left join preserves controls without evidence
FROM grc_controls c
LEFT JOIN grc_evidence_control_mappings ecm ON c.id = ecm.control_id
WHERE ecm.id IS NULL  -- Find controls WITHOUT evidence
```

### NULL-Safe Aggregations

```sql
-- ❌ BAD: COUNT(*) includes NULLs
SELECT department_id, COUNT(*)
FROM grc_risks
GROUP BY department_id

-- ✅ GOOD: COUNT(column) excludes NULLs
SELECT
  COALESCE(department_id, -1) as dept,
  COUNT(id) as total_risks,
  COUNT(owner_id) as risks_with_owner,
  COUNT(*) - COUNT(owner_id) as risks_without_owner
FROM grc_risks
GROUP BY COALESCE(department_id, -1)
```

## 📊 Schema Update Strategy

When schema changes occur:

1. **Update Base Tables**: Modify hardcoded schema in `GRC_SCHEMA` constant
2. **Clear Cache**: Restart application to reload `CACHED_DB_SCHEMA`
3. **Verify Columns**: Use `load_full_database_schema()` to validate
4. **Test Queries**: Run sample queries to ensure NULL handling works

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-29  
**Tables Documented**: 100+
