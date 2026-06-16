# GRC Platform Database Schema Documentation

## Overview

This document provides a comprehensive overview of the Enterprise GRC (Governance, Risk, and Compliance) Platform database schema. The platform uses PostgreSQL with SQLAlchemy ORM and implements a multi-tenant architecture with row-level security.

**Database Engine:** PostgreSQL (Neon-backed)
**ORM:** SQLAlchemy
**Total Tables:** 80+
**Architecture:** Multi-tenant with complete tenant isolation

---

## Table of Contents

1. [Multi-Tenancy Models](#1-multi-tenancy-models)
2. [RBAC (Role-Based Access Control)](#2-rbac-models)
3. [User Management](#3-user-management)
4. [Audit Trail](#4-audit-trail)
5. [Framework Normalization](#5-framework-normalization)
6. [Normalized Control Model](#6-normalized-control-model)
7. [Common Control Library](#7-common-control-library)
8. [Evidence Management](#8-evidence-management)
9. [Enterprise Risk Management (ERM)](#9-enterprise-risk-management)
10. [Governance](#10-governance)
11. [Governance Document Management](#11-governance-document-management)
12. [IT Asset Inventory](#12-it-asset-inventory)
13. [Compliance Programs](#13-compliance-programs)
14. [Certification Journey](#14-certification-journey)
15. [Framework Upload & Parsing](#15-framework-upload--parsing)
16. [Policy Statement Compliance](#16-policy-statement-compliance)
17. [Customizable Workflows](#17-customizable-workflows)
18. [Internal Control Register](#18-internal-control-register)
19. [Vulnerability Management](#19-vulnerability-management)
20. [Department Management](#20-department-management)
21. [Vulnerability Workflow System](#21-vulnerability-workflow-system)

---

## 1. Multi-Tenancy Models

### grc_tenants
Core tenant table for multi-tenant isolation.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Tenant identifier |
| name | String(255) | Tenant organization name |
| slug | String(100) | Unique URL-friendly identifier |
| is_active | Boolean | Active status |
| created_at | DateTime | Creation timestamp |
| settings | JSON | Tenant-specific settings |

**Relationships:** All major entities link back to tenant for data isolation.

### grc_tenant_users
Maps users to tenants (many-to-many).

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Link identifier |
| user_id | Integer (FK) | Reference to grc_users |
| tenant_id | Integer (FK) | Reference to grc_tenants |
| is_primary | Boolean | Primary tenant flag |

### grc_business_units
Organizational hierarchy within tenants.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Business unit identifier |
| tenant_id | Integer (FK) | Parent tenant |
| name | String(255) | Unit name |
| parent_id | Integer (FK) | Self-reference for hierarchy |

---

## 2. RBAC Models

### grc_roles
Role definitions for access control.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Role identifier |
| tenant_id | Integer (FK) | Tenant scope (null = system role) |
| name | String(100) | Role name |
| description | Text | Role description |
| is_system_role | Boolean | System vs custom role |

### grc_permissions
Granular permission definitions.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Permission identifier |
| name | String(100) | Permission name (unique) |
| resource | String(100) | Resource type (risks, evidence, etc.) |
| action | String(50) | Action (create, read, update, delete) |

### grc_role_permissions
Maps permissions to roles.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Mapping identifier |
| role_id | Integer (FK) | Reference to role |
| permission_id | Integer (FK) | Reference to permission |

### grc_user_roles
Assigns roles to users within tenants.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Assignment identifier |
| user_id | Integer (FK) | User reference |
| role_id | Integer (FK) | Role reference |
| tenant_id | Integer (FK) | Tenant scope |
| business_unit_id | Integer (FK) | Optional BU scope |

---

## 3. User Management

### grc_users
Core user accounts.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | User identifier |
| username | String(100) | Unique username |
| email | String(255) | Unique email address |
| password_hash | String(255) | Hashed password |
| display_name | String(255) | Display name |
| is_active | Boolean | Account status |
| created_at | DateTime | Registration date |
| last_login | DateTime | Last login timestamp |

**Relationships:** Connected to virtually all entities as owner, creator, reviewer, etc.

---

## 4. Audit Trail

### grc_audit_logs
Complete audit trail for all actions.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Log identifier |
| tenant_id | Integer (FK) | Tenant scope |
| user_id | Integer (FK) | Acting user |
| action | String(100) | Action performed |
| resource_type | String(100) | Affected resource type |
| resource_id | Integer | Affected resource ID |
| changes | JSON | Change details |
| ip_address | String(50) | Client IP |
| timestamp | DateTime | Action timestamp |

---

## 5. Framework Normalization

### grc_frameworks
Regulatory and compliance frameworks.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Framework identifier |
| name | String(255) | Full framework name |
| short_code | String(50) | Abbreviation (ISO27001, PCI-DSS) |
| regulator | String(255) | Issuing authority |
| jurisdiction | String(100) | Geographic scope |
| region | String(100) | Regional scope |
| version | String(50) | Framework version |
| description | Text | Framework description |
| is_mandatory | Boolean | Mandatory compliance flag |
| enforcement_type | String(100) | Enforcement mechanism |
| is_active | Boolean | Active status |
| is_custom | Boolean | Custom vs pre-seeded |

### grc_framework_domains
Top-level domains within frameworks.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Domain identifier |
| framework_id | Integer (FK) | Parent framework |
| code | String(50) | Domain code |
| name | String(255) | Domain name |
| description | Text | Domain description |
| order | Integer | Display order |

### grc_control_objectives
Objectives within domains.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Objective identifier |
| domain_id | Integer (FK) | Parent domain |
| code | String(50) | Objective code |
| name | String(255) | Objective name |
| description | Text | Objective description |
| order | Integer | Display order |

### grc_framework_controls
Individual controls within objectives.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Control identifier |
| objective_id | Integer (FK) | Parent objective |
| code | String(50) | Control code |
| name | String(255) | Control name |
| statement | Text | Control statement |
| control_objective | Text | Control objective text |
| is_mandatory | Boolean | Required flag |
| risk_category | String(50) | Risk category |
| evidence_type | String(50) | Expected evidence type |
| implementation_guidance | Text | Implementation guidance |
| testing_guidance | Text | Testing guidance |
| order | Integer | Display order |

### grc_framework_sub_controls
Granular sub-controls.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Sub-control identifier |
| control_id | Integer (FK) | Parent control |
| code | String(50) | Sub-control code |
| name | String(255) | Sub-control name |
| statement | Text | Sub-control statement |
| description | Text | Description |
| order | Integer | Display order |
| evidence_recommendations | JSON | Recommended evidence |
| ai_matching_keywords | JSON | AI matching keywords |

---

## 6. Normalized Control Model

### grc_normalized_controls
Cross-framework normalized controls.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Control identifier |
| code | String(50) | Unique control code |
| name | String(255) | Control name |
| statement | Text | Control statement |
| objective | Text | Control objective |
| control_owner | String(255) | Assigned owner |
| implementation_guidance | Text | Implementation guidance |
| testing_guidance | Text | Testing guidance |
| maturity_level | Integer | Maturity level (0-5) |
| created_at | DateTime | Creation timestamp |

### grc_control_mappings
Maps framework controls to normalized controls.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Mapping identifier |
| normalized_control_id | Integer (FK) | Normalized control |
| framework_control_id | Integer (FK) | Framework control |
| mapping_type | String(20) | direct, partial, related |

### grc_required_evidence
Evidence requirements per normalized control.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Requirement identifier |
| normalized_control_id | Integer (FK) | Parent control |
| name | String(255) | Evidence name |
| description | Text | Evidence description |
| evidence_type | String(100) | Evidence type |
| validation_criteria | Text | Validation requirements |

---

## 7. Common Control Library

### grc_common_control_groups
Groups of related controls for unified management.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Group identifier |
| tenant_id | Integer (FK) | Tenant scope |
| code | String(50) | Group code |
| name | String(255) | Group name |
| description | Text | Description |
| category | String(100) | Category |
| domain | String(100) | Domain |
| keywords | JSON | Search keywords |
| ai_summary | Text | AI-generated summary |
| evidence_types | JSON | Expected evidence types |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |
| created_by | Integer (FK) | Creator |

### grc_common_control_group_mappings
Maps controls to common groups.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Mapping identifier |
| group_id | Integer (FK) | Control group |
| normalized_control_id | Integer (FK) | Normalized control |
| framework_control_id | Integer (FK) | Framework control |
| mapping_confidence | Float | AI confidence score |
| mapping_source | String(50) | manual or ai |
| created_at | DateTime | Creation timestamp |

### grc_control_similarity_mappings
AI-powered control similarity analysis.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Mapping identifier |
| tenant_id | Integer (FK) | Tenant scope |
| source_type | String(20) | Source control type |
| source_control_id | Integer | Source control ID |
| target_type | String(20) | Target control type |
| target_control_id | Integer | Target control ID |
| similarity_score | Float | Similarity (0-1) |
| similarity_type | String(50) | Similarity type |
| ai_reasoning | Text | AI explanation |
| verified | Boolean | Human verified |
| verified_by | Integer (FK) | Verifier |
| created_at | DateTime | Creation timestamp |

### grc_control_inheritance
Control inheritance relationships.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Relationship identifier |
| tenant_id | Integer (FK) | Tenant scope |
| parent_type | String(20) | Parent control type |
| parent_control_id | Integer | Parent control ID |
| child_type | String(20) | Child control type |
| child_control_id | Integer | Child control ID |
| inheritance_type | String(50) | Inheritance type |
| condition_description | Text | Conditions |
| coverage_percentage | Integer | Coverage (0-100) |
| created_at | DateTime | Creation timestamp |
| created_by | Integer (FK) | Creator |

### grc_ai_evidence_recommendations
AI-generated evidence recommendations.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Recommendation identifier |
| tenant_id | Integer (FK) | Tenant scope |
| group_id | Integer (FK) | Control group |
| normalized_control_id | Integer (FK) | Normalized control |
| framework_control_id | Integer (FK) | Framework control |
| evidence_type | String(100) | Evidence type |
| evidence_description | Text | Description |
| priority | String(20) | high, medium, low |
| ai_confidence | Float | Confidence score |
| ai_reasoning | Text | AI explanation |
| sample_evidence_names | JSON | Example evidence names |
| created_at | DateTime | Creation timestamp |

### grc_control_mapping_analysis
Tracks AI analysis jobs for control mapping.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Job identifier |
| tenant_id | Integer (FK) | Tenant scope |
| analysis_type | String(50) | Analysis type |
| status | String(20) | pending, processing, completed, failed |
| frameworks_analyzed | JSON | Frameworks included |
| total_controls_analyzed | Integer | Control count |
| mappings_created | Integer | Mappings created |
| groups_created | Integer | Groups created |
| started_at | DateTime | Start time |
| completed_at | DateTime | Completion time |
| error_message | Text | Error details |
| created_by | Integer (FK) | Creator |

---

## 8. Evidence Management

### grc_evidence
Core evidence records.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Evidence identifier |
| tenant_id | Integer (FK) | Tenant scope |
| name | String(255) | Evidence name |
| description | Text | Description |
| file_path | String(500) | Storage path |
| file_name | String(255) | Original filename |
| file_type | String(100) | MIME type |
| version | Integer | Version number |
| uploaded_by | Integer (FK) | Uploader |
| uploaded_at | DateTime | Upload timestamp |
| status | String(50) | draft, pending_review, approved, rejected |
| ocr_content | Text | Extracted text (OCR) |
| ocr_status | String(50) | OCR processing status |
| ocr_processed_at | DateTime | OCR timestamp |
| evidence_type | String(100) | Evidence category |
| collection_date | DateTime | Collection date |
| validity_period_days | Integer | Validity period |
| expiry_date | DateTime | Expiration date |
| recertification_date | DateTime | Recertification due |
| is_stale | Boolean | Stale flag |
| source_system | String(255) | Source system |
| content_summary | Text | AI summary |
| quality_score | Float | Quality score |
| submitted_by | Integer (FK) | Submitter |
| submitted_at | DateTime | Submission timestamp |
| reviewed_by | Integer (FK) | Reviewer |
| reviewed_at | DateTime | Review timestamp |
| review_comments | Text | Review comments |
| approved_by | Integer (FK) | Approver |
| approved_at | DateTime | Approval timestamp |

### grc_evidence_versions
Evidence version history.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Version identifier |
| evidence_id | Integer (FK) | Parent evidence |
| version_number | Integer | Version number |
| file_path | String(500) | Storage path |
| changes | Text | Change summary |
| created_at | DateTime | Creation timestamp |
| created_by | Integer (FK) | Creator |

### grc_evidence_control_mappings
Links evidence to controls.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Mapping identifier |
| evidence_id | Integer (FK) | Evidence reference |
| normalized_control_id | Integer (FK) | Normalized control |
| framework_control_id | Integer (FK) | Framework control |

### grc_evidence_ai_assessments
AI quality assessments for evidence.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Assessment identifier |
| evidence_id | Integer (FK) | Evidence reference |
| relevance_score | Float | Relevance score |
| adequacy_score | Float | Adequacy score |
| confidence_score | Float | Confidence score |
| gap_analysis | JSON | Gap analysis results |
| audit_readiness | Float | Audit readiness score |
| assessed_at | DateTime | Assessment timestamp |
| content_summary | Text | Content summary |
| recommendations | JSON | Improvement recommendations |
| detected_controls | JSON | Detected control coverage |
| compliance_gaps | JSON | Identified gaps |

### grc_audit_packages
Bundles evidence for audits.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Package identifier |
| tenant_id | Integer (FK) | Tenant scope |
| name | String(255) | Package name |
| description | Text | Description |
| framework_id | Integer (FK) | Target framework |
| audit_period_start | DateTime | Period start |
| audit_period_end | DateTime | Period end |
| status | String(50) | draft, finalized, exported, archived |
| created_by | Integer (FK) | Creator |
| created_at | DateTime | Creation timestamp |
| finalized_at | DateTime | Finalization timestamp |
| finalized_by | Integer (FK) | Finalizer |
| export_path | String(500) | Export location |
| exported_at | DateTime | Export timestamp |
| retention_until | DateTime | Retention date |
| is_legal_hold | Boolean | Legal hold flag |
| package_metadata | JSON | Additional metadata |

---

## 9. Enterprise Risk Management

### grc_risks
Core risk register.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Risk identifier |
| tenant_id | Integer (FK) | Tenant scope |
| business_unit_id | Integer (FK) | Business unit |
| title | String(255) | Risk title |
| description | Text | Risk description |
| category | String(50) | Risk category |
| risk_category | String(50) | Risk type |
| risk_sub_category | String(100) | Sub-category |
| owner_id | Integer (FK) | Risk owner |
| business_owner_id | Integer (FK) | Business owner |
| affected_department_ids | JSON | Affected departments |
| due_date | DateTime | Target date |
| review_date | DateTime | Next review |
| inherent_likelihood | Integer | Inherent likelihood (1-5) |
| inherent_impact | Integer | Inherent impact (1-5) |
| inherent_score | Float | Inherent risk score |
| residual_likelihood | Integer | Residual likelihood |
| residual_impact | Integer | Residual impact |
| residual_score | Float | Residual risk score |
| risk_appetite | String(50) | Risk appetite level |
| status | String(50) | open, in_progress, closed |
| treatment_plan | Text | Treatment plan |
| closure_status | String(50) | Closure status |
| closed_at | DateTime | Closure timestamp |
| closed_by | Integer (FK) | Closer |
| closure_notes | Text | Closure notes |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

### grc_risk_kris
Key Risk Indicators.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | KRI identifier |
| risk_id | Integer (FK) | Parent risk |
| name | String(255) | KRI name |
| description | Text | Description |
| metric_type | String(50) | numeric, percentage, count, boolean |
| unit | String(50) | Measurement unit |
| current_value | Float | Current value |
| green_threshold | Float | Green threshold |
| amber_threshold | Float | Amber threshold |
| threshold_direction | String(20) | lower_is_better, higher_is_better |
| frequency | String(50) | Measurement frequency |
| data_source | String(255) | Data source |
| owner_id | Integer (FK) | Owner |
| is_active | Boolean | Active flag |
| last_measured_at | DateTime | Last measurement |
| created_at | DateTime | Creation timestamp |

### grc_risk_incidents
Risk events and incidents.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Incident identifier |
| tenant_id | Integer (FK) | Tenant scope |
| risk_id | Integer (FK) | Related risk |
| title | String(255) | Incident title |
| description | Text | Description |
| incident_date | DateTime | Incident date |
| discovered_date | DateTime | Discovery date |
| severity | String(50) | Severity level |
| status | String(50) | Status |
| financial_impact | Float | Financial impact |
| operational_impact | Text | Operational impact |
| root_cause | Text | Root cause analysis |
| corrective_actions | Text | Corrective actions |
| lessons_learned | Text | Lessons learned |
| reported_by | Integer (FK) | Reporter |
| assigned_to | Integer (FK) | Assignee |
| resolved_at | DateTime | Resolution timestamp |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

### grc_risk_mitigation_actions
Risk treatment actions.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Action identifier |
| risk_id | Integer (FK) | Parent risk |
| title | String(255) | Action title |
| description | Text | Description |
| action_type | String(50) | mitigate, transfer, avoid, accept |
| status | String(50) | open, in_progress, completed, overdue, cancelled |
| priority | String(20) | Priority level |
| owner_id | Integer (FK) | Owner |
| due_date | DateTime | Due date |
| completed_at | DateTime | Completion timestamp |
| expected_residual_reduction | Float | Expected reduction |
| actual_residual_reduction | Float | Actual reduction |
| evidence_id | Integer (FK) | Supporting evidence |
| notes | Text | Notes |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

### grc_risk_appetite_config
Risk appetite settings per tenant/category.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Config identifier |
| tenant_id | Integer (FK) | Tenant scope |
| category | String(50) | Risk category |
| appetite_level | String(50) | averse, minimal, cautious, moderate, open, hungry |
| max_acceptable_score | Float | Maximum acceptable score |
| tolerance_threshold | Float | Tolerance threshold |
| escalation_owner_id | Integer (FK) | Escalation owner |
| alert_enabled | Boolean | Alert flag |
| description | Text | Description |
| updated_at | DateTime | Last update |

---

## 10. Governance

### grc_governance_objectives
Governance objectives and goals.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Objective identifier |
| tenant_id | Integer (FK) | Tenant scope |
| name | String(255) | Objective name |
| description | Text | Description |
| owner_id | Integer (FK) | Owner |
| status | String(50) | Status |
| target_date | DateTime | Target date |

### grc_exceptions
Control exceptions and waivers.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Exception identifier |
| tenant_id | Integer (FK) | Tenant scope |
| normalized_control_id | Integer (FK) | Control reference |
| title | String(255) | Exception title |
| justification | Text | Justification |
| approved_by | Integer | Approver |
| approval_date | DateTime | Approval date |
| expiry_date | DateTime | Expiration date |
| status | String(50) | pending, approved, rejected, expired |

### grc_issues
Audit findings and issues.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Issue identifier |
| tenant_id | Integer (FK) | Tenant scope |
| title | String(255) | Issue title |
| description | Text | Description |
| severity | String(50) | low, medium, high, critical |
| status | String(50) | open, in_progress, resolved, closed |
| owner_id | Integer (FK) | Owner |
| due_date | DateTime | Due date |
| created_at | DateTime | Creation timestamp |
| closed_at | DateTime | Closure timestamp |

---

## 11. Governance Document Management

### grc_governance_documents
Full lifecycle governance documents.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Document identifier |
| tenant_id | Integer (FK) | Tenant scope |
| document_code | String(50) | Document code |
| title | String(500) | Document title |
| description | Text | Description |
| content | Text | Document content |
| file_name | String(255) | File name |
| file_path | String(500) | Storage path |
| file_size | Integer | File size |
| file_type | String(50) | File type |
| doc_type | String(50) | policy, standard, procedure, guideline, charter, framework |
| doc_sub_type | String(100) | Sub-type |
| classification | String(50) | public, internal, confidential, restricted |
| parent_document_id | Integer (FK) | Parent document |
| current_version | String(50) | Current version |
| status | String(50) | Lifecycle status |
| owner_id | Integer (FK) | Owner |
| author_id | Integer (FK) | Author |
| department_id | Integer | Department |
| effective_date | DateTime | Effective date |
| expiry_date | DateTime | Expiration date |
| review_cycle_months | Integer | Review cycle |
| next_review_date | DateTime | Next review |
| last_reviewed_at | DateTime | Last review |
| last_reviewed_by | Integer (FK) | Reviewer |
| regulatory_scope | JSON | Regulatory scope |
| framework_ids | JSON | Framework links |
| tags | JSON | Tags |
| approved_by | Integer (FK) | Approver |
| approved_at | DateTime | Approval timestamp |
| published_by | Integer (FK) | Publisher |
| published_at | DateTime | Publication timestamp |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

### grc_governance_document_versions
Document version history.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Version identifier |
| document_id | Integer (FK) | Parent document |
| version_number | String(50) | Version number |
| change_type | String(20) | major, minor, patch |
| title | String(500) | Version title |
| content | Text | Version content |
| file_name | String(255) | File name |
| file_path | String(500) | Storage path |
| file_size | Integer | File size |
| file_type | String(50) | File type |
| change_summary | Text | Change summary |
| change_reason | Text | Change reason |
| status | String(50) | current, superseded, archived |
| created_at | DateTime | Creation timestamp |
| created_by | Integer (FK) | Creator |
| approved_by | Integer (FK) | Approver |
| approved_at | DateTime | Approval timestamp |

---

## 12. IT Asset Inventory

### grc_it_assets
IT asset register.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Asset identifier |
| tenant_id | Integer (FK) | Tenant scope |
| name | String(255) | Asset name |
| description | Text | Description |
| asset_type | String(50) | application, infrastructure, data, cloud, third_party |
| owner_id | Integer (FK) | Owner |
| criticality | String(50) | low, medium, high, critical |
| confidentiality_rating | Integer | CIA - Confidentiality (1-5) |
| integrity_rating | Integer | CIA - Integrity (1-5) |
| availability_rating | Integer | CIA - Availability (1-5) |
| valuation | Float | Asset value |
| vendor | String(255) | Vendor |
| location | String(255) | Location |
| status | String(50) | active, inactive, decommissioned |
| created_at | DateTime | Creation timestamp |

### grc_asset_risk_assessments
Asset risk assessments.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Assessment identifier |
| asset_id | Integer (FK) | Asset reference |
| assessment_date | DateTime | Assessment date |
| risk_score | Float | Risk score |
| coverage_percentage | Float | Control coverage |
| gaps | JSON | Identified gaps |
| assessor_id | Integer (FK) | Assessor |

---

## 13. Compliance Programs

### grc_compliance_programs
Compliance program tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Program identifier |
| tenant_id | Integer (FK) | Tenant scope |
| framework_id | Integer (FK) | Target framework |
| name | String(255) | Program name |
| description | Text | Description |
| status | String(50) | not_started, in_progress, completed |
| start_date | DateTime | Start date |
| target_date | DateTime | Target date |
| owner_id | Integer (FK) | Owner |

### grc_compliance_assessments
Control assessments within programs.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Assessment identifier |
| program_id | Integer (FK) | Program reference |
| normalized_control_id | Integer (FK) | Control reference |
| status | String(50) | not_assessed, compliant, partial, non_compliant |
| maturity_level | Integer | Maturity level |
| notes | Text | Notes |
| assessed_by | Integer (FK) | Assessor |
| assessed_at | DateTime | Assessment timestamp |

---

## 14. Certification Journey

### grc_certification_journeys
Tracks certification progress.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Journey identifier |
| tenant_id | Integer (FK) | Tenant scope |
| framework_id | Integer (FK) | Target framework |
| name | String(255) | Journey name |
| target_date | DateTime | Target date |
| started_at | DateTime | Start date |
| completed_at | DateTime | Completion date |
| status | String(50) | Status |
| current_phase | Integer | Current phase |
| notes | Text | Notes |

### grc_certification_phases
Framework-specific phases.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Phase identifier |
| framework_id | Integer (FK) | Framework reference |
| phase_number | Integer | Phase number |
| name | String(255) | Phase name |
| description | Text | Description |
| key_tasks | JSON | Key tasks |
| deliverables | JSON | Deliverables |

### grc_control_implementations
Control implementation tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Implementation identifier |
| journey_id | Integer (FK) | Journey reference |
| framework_control_id | Integer (FK) | Control reference |
| status | String(50) | Implementation status |
| implementation_notes | Text | Notes |
| implementation_date | DateTime | Implementation date |
| verified_date | DateTime | Verification date |
| verified_by | Integer (FK) | Verifier |
| is_applicable | Boolean | Applicability flag |
| priority | Integer | Priority (1-5) |

### grc_curated_evidence_items
Curated evidence requirements per control.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Item identifier |
| sub_control_id | Integer (FK) | Sub-control reference |
| framework_control_id | Integer (FK) | Control reference |
| title | String(255) | Evidence title |
| description | Text | Description |
| artifact_type | String(50) | policy, configuration, log, screenshot, report, record, certificate |
| format_guidance | Text | Format guidance |
| frequency | String(50) | one_time, monthly, quarterly, annual, as_needed |
| is_required | Boolean | Required flag |
| created_at | DateTime | Creation timestamp |

---

## 15. Framework Upload & Parsing

### grc_uploaded_frameworks
Uploaded framework documents.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Upload identifier |
| tenant_id | Integer (FK) | Tenant scope |
| name | String(255) | Framework name |
| description | Text | Description |
| file_name | String(255) | File name |
| file_path | String(500) | Storage path |
| file_size | Integer | File size |
| file_type | String(50) | pdf, docx |
| upload_status | String(50) | uploaded, parsing, parsed, published, failed |
| parse_error | Text | Error message |
| parsed_at | DateTime | Parse timestamp |
| published_framework_id | Integer (FK) | Published framework ID |
| published_at | DateTime | Publication timestamp |
| framework_type | String(100) | regulatory, industry_standard, internal |
| source_organization | String(255) | Source organization |
| version | String(50) | Version |
| effective_date | DateTime | Effective date |
| is_shared | Boolean | Shared flag |
| is_active | Boolean | Active flag |
| uploaded_by | Integer (FK) | Uploader |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

### grc_parsed_framework_controls
AI-extracted controls.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Control identifier |
| uploaded_framework_id | Integer (FK) | Upload reference |
| control_id | String(100) | Generated ID (FW-001) |
| original_reference | String(255) | Original clause number |
| title | String(500) | Control title |
| description | Text | Description |
| full_text | Text | Complete requirement text |
| domain | String(100) | Domain category |
| category | String(100) | Sub-category |
| is_mandatory | Boolean | Mandatory flag |
| priority | String(20) | Priority level |
| section_number | String(50) | Section number |
| parent_section | String(255) | Parent section |
| ai_confidence | Float | AI confidence score |
| ai_notes | Text | AI processing notes |
| is_verified | Boolean | Human verified flag |
| verified_by | Integer (FK) | Verifier |
| verified_at | DateTime | Verification timestamp |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

### grc_control_evidence_mappings
Evidence requirements from AI parsing.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Mapping identifier |
| parsed_control_id | Integer (FK) | Control reference |
| evidence_type | String(50) | Evidence type |
| evidence_description | Text | Evidence description |
| is_required | Boolean | Required flag |
| suggested_by_ai | Boolean | AI suggested flag |
| created_at | DateTime | Creation timestamp |

### grc_framework_control_alignments
Maps parsed controls to existing library.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Alignment identifier |
| parsed_control_id | Integer (FK) | Parsed control |
| normalized_control_id | Integer (FK) | Normalized control |
| framework_control_id | Integer (FK) | Framework control |
| alignment_type | String(50) | exact, partial, new |
| match_score | Float | Match score (0-1) |
| match_reason | Text | Match reason |
| is_confirmed | Boolean | Confirmed flag |
| confirmed_by | Integer (FK) | Confirmer |
| confirmed_at | DateTime | Confirmation timestamp |
| created_at | DateTime | Creation timestamp |

---

## 16. Policy Statement Compliance

### grc_policy_statements
Parsed policy statements.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Statement identifier |
| tenant_id | Integer (FK) | Tenant scope |
| document_id | Integer (FK) | Source document |
| document_version_id | Integer (FK) | Document version |
| statement_code | String(50) | Statement code |
| statement_text | Text | Statement text |
| statement_summary | String(500) | AI summary |
| category | String(100) | Category |
| sub_category | String(100) | Sub-category |
| priority | String(20) | Priority |
| is_mandatory | Boolean | Mandatory flag |
| ai_confidence | Float | AI confidence |
| ai_extracted_keywords | JSON | Keywords |
| ai_suggested_controls | JSON | Suggested controls |
| source_section | String(255) | Source section |
| source_page | Integer | Source page |
| status | String(50) | active, deprecated, superseded |
| effective_date | DateTime | Effective date |
| review_date | DateTime | Review date |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |
| created_by | Integer (FK) | Creator |

### grc_policy_statement_compliance
Compliance tracking for statements.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Compliance identifier |
| tenant_id | Integer (FK) | Tenant scope |
| statement_id | Integer (FK) | Statement reference |
| compliance_status | String(50) | Compliance status |
| compliance_score | Float | Compliance score |
| owner_id | Integer (FK) | Owner |
| department | String(100) | Department |
| assessment_date | DateTime | Assessment date |
| assessed_by | Integer (FK) | Assessor |
| next_assessment_date | DateTime | Next assessment |
| findings | Text | Findings |
| remediation_notes | Text | Remediation notes |
| remediation_due_date | DateTime | Remediation due |
| evidence_ids | JSON | Evidence links |
| control_ids | JSON | Control links |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

---

## 17. Customizable Workflows

### grc_workflow_templates
Configurable workflow templates.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Template identifier |
| tenant_id | Integer (FK) | Tenant scope |
| name | String(255) | Template name |
| description | Text | Description |
| doc_types | JSON | Applicable document types |
| is_default | Boolean | Default flag |
| is_active | Boolean | Active flag |
| allow_skip | Boolean | Allow skipping steps |
| require_all_approvers | Boolean | Require all approvers |
| auto_publish_on_complete | Boolean | Auto-publish flag |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |
| created_by | Integer (FK) | Creator |

### grc_workflow_steps
Individual workflow steps.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Step identifier |
| template_id | Integer (FK) | Template reference |
| name | String(255) | Step name |
| description | Text | Description |
| sequence | Integer | Execution order |
| step_type | String(50) | approval, review, notification, auto |
| approval_mode | String(50) | any, all, sequential |
| is_required | Boolean | Required flag |
| timeout_days | Integer | Timeout in days |
| on_approve_status | String(50) | Status on approval |
| on_reject_action | String(50) | Action on rejection |
| notify_on_pending | Boolean | Pending notification |
| notify_on_complete | Boolean | Complete notification |
| reminder_days | Integer | Reminder interval |
| created_at | DateTime | Creation timestamp |

### grc_document_workflow_instances
Runtime workflow instances.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Instance identifier |
| document_id | Integer (FK) | Document reference |
| template_id | Integer (FK) | Template reference |
| current_step_id | Integer (FK) | Current step |
| current_step_sequence | Integer | Current sequence |
| status | String(50) | active, completed, cancelled, on_hold |
| started_at | DateTime | Start timestamp |
| completed_at | DateTime | Completion timestamp |
| started_by | Integer (FK) | Initiator |

---

## 18. Internal Control Register

### grc_internal_controls
Organization's internal controls.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Control identifier |
| tenant_id | Integer (FK) | Tenant scope |
| control_id | String(50) | Control code (IC-001) |
| name | String(255) | Control name |
| description | Text | Description |
| category | String(100) | Category |
| sub_category | String(100) | Sub-category |
| control_type | String(50) | preventive, detective, corrective |
| control_nature | String(50) | manual, automated, hybrid |
| department_id | Integer (FK) | Department |
| owner_id | Integer (FK) | Owner |
| backup_owner_id | Integer (FK) | Backup owner |
| frequency | String(50) | Execution frequency |
| regulatory_source | String(255) | Regulatory source |
| effective_date | DateTime | Effective date |
| review_date | DateTime | Review date |
| status | String(50) | draft, pending_approval, active, inactive, deprecated |
| workflow_status | String(50) | Workflow status |
| design_effectiveness | String(50) | Design effectiveness |
| operating_effectiveness | String(50) | Operating effectiveness |
| last_tested_at | DateTime | Last test date |
| next_test_date | DateTime | Next test date |
| priority | String(20) | Priority |
| is_key_control | Boolean | Key control flag |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |
| created_by | Integer (FK) | Creator |
| approved_by | Integer (FK) | Approver |
| approved_at | DateTime | Approval timestamp |

### grc_internal_control_tests
Control testing records.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Test identifier |
| control_id | Integer (FK) | Control reference |
| tenant_id | Integer (FK) | Tenant scope |
| test_type | String(50) | design, operating |
| test_date | DateTime | Test date |
| test_period_start | DateTime | Period start |
| test_period_end | DateTime | Period end |
| tester_id | Integer (FK) | Tester |
| reviewer_id | Integer (FK) | Reviewer |
| sample_size | Integer | Sample size |
| exceptions_found | Integer | Exception count |
| result | String(50) | effective, partially_effective, ineffective |
| findings | Text | Findings |
| recommendations | Text | Recommendations |
| management_response | Text | Management response |
| evidence_references | JSON | Evidence references |
| status | String(50) | in_progress, completed, reviewed |
| reviewed_at | DateTime | Review timestamp |
| created_at | DateTime | Creation timestamp |

---

## 19. Vulnerability Management

### grc_vulnerability_reports
Uploaded vulnerability reports.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Report identifier |
| tenant_id | Integer (FK) | Tenant scope |
| name | String(255) | Report name |
| description | Text | Description |
| report_type | String(50) | vulnerability_scan, penetration_test, code_review, configuration_audit |
| file_path | String(500) | Storage path |
| file_name | String(255) | File name |
| file_type | String(50) | File type |
| scan_tool | String(100) | Scan tool used |
| scan_date | DateTime | Scan date |
| scan_scope | Text | Scan scope |
| asset_scope_ids | JSON | Assets in scope |
| total_vulnerabilities | Integer | Total count |
| critical_count | Integer | Critical count |
| high_count | Integer | High count |
| medium_count | Integer | Medium count |
| low_count | Integer | Low count |
| info_count | Integer | Info count |
| status | String(50) | uploaded, parsing, parsed, analyzed, closed |
| uploaded_by | Integer (FK) | Uploader |
| uploaded_at | DateTime | Upload timestamp |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

### grc_vulnerabilities
Individual vulnerability findings.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Vulnerability identifier |
| tenant_id | Integer (FK) | Tenant scope |
| report_id | Integer (FK) | Report reference |
| vuln_id | String(50) | Vulnerability code (VULN-001) |
| title | String(500) | Vulnerability title |
| description | Text | Description |
| severity | String(20) | critical, high, medium, low, info |
| cvss_score | Float | CVSS score (0-10) |
| cvss_vector | String(100) | CVSS vector |
| cve_id | String(50) | CVE identifier |
| cwe_id | String(50) | CWE identifier |
| affected_component | String(255) | Affected component |
| affected_host | String(255) | Affected host |
| affected_port | Integer | Affected port |
| affected_url | String(500) | Affected URL |
| evidence | Text | Technical evidence |
| reproduction_steps | Text | Reproduction steps |
| recommendation | Text | Manual recommendation |
| ai_recommendation | Text | AI-generated fix |
| ai_impact_assessment | Text | AI impact analysis |
| status | String(50) | open, in_progress, resolved, accepted, false_positive |
| resolution_notes | Text | Resolution notes |
| discovered_at | DateTime | Discovery date |
| due_date | DateTime | SLA due date |
| resolved_at | DateTime | Resolution date |
| assigned_to | Integer (FK) | Assignee |
| verified_by | Integer (FK) | Verifier |
| verified_at | DateTime | Verification date |
| is_exception | Boolean | Exception flag |
| exception_reason | Text | Exception reason |
| exception_approved_by | Integer (FK) | Exception approver |
| exception_expiry | DateTime | Exception expiry |
| workflow_template_id | Integer (FK) | Workflow template |
| current_state_id | Integer (FK) | Current workflow state |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

### grc_vulnerability_sla_config
SLA configuration by severity.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Config identifier |
| tenant_id | Integer (FK) | Tenant scope |
| severity | String(20) | Severity level |
| remediation_days | Integer | Days to remediate |
| is_active | Boolean | Active flag |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

---

## 20. Department Management

### grc_departments
Departments for vulnerability management.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Department identifier |
| tenant_id | Integer (FK) | Tenant scope |
| name | String(255) | Department name |
| code | String(50) | Department code |
| description | Text | Description |
| parent_department_id | Integer (FK) | Parent department |
| department_head_user_id | Integer (FK) | Department head |
| is_active | Boolean | Active flag |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

### grc_department_members
Department membership.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Member identifier |
| department_id | Integer (FK) | Department reference |
| user_id | Integer (FK) | User reference |
| role | String(50) | head, lead, member |
| email_notifications_enabled | Boolean | Email notification flag |
| escalation_order | Integer | Escalation priority |
| added_at | DateTime | Add timestamp |
| added_by | Integer (FK) | Adder |
| is_active | Boolean | Active flag |

### grc_vulnerability_department_assignments
Vulnerability-to-department assignments.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Assignment identifier |
| vulnerability_id | Integer (FK) | Vulnerability reference |
| department_id | Integer (FK) | Department reference |
| assigned_by | Integer (FK) | Assigner |
| assigned_at | DateTime | Assignment timestamp |
| priority | String(20) | Priority |
| notes | Text | Notes |
| sla_override_days | Integer | SLA override |
| notification_sent | Boolean | Notification flag |

### grc_department_escalation_paths
Department escalation paths.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Path identifier |
| department_id | Integer (FK) | Department reference |
| escalation_level | Integer | Level (1, 2, 3) |
| target_role | String(50) | lead, head, parent_dept_head |
| sla_threshold_percent | Integer | SLA threshold (75, 100) |
| auto_escalate | Boolean | Auto-escalate flag |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

---

## 21. Vulnerability Workflow System

### grc_vuln_workflow_templates
Vulnerability workflow templates.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Template identifier |
| tenant_id | Integer (FK) | Tenant scope |
| name | String(255) | Template name |
| description | Text | Description |
| is_default | Boolean | Default flag |
| is_active | Boolean | Active flag |
| created_by | Integer (FK) | Creator |
| created_at | DateTime | Creation timestamp |
| updated_at | DateTime | Last update |

### grc_vuln_workflow_states
Workflow states.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | State identifier |
| template_id | Integer (FK) | Template reference |
| name | String(100) | State name |
| state_type | String(50) | initial, in_progress, approval, resolved, closed, exception |
| order_index | Integer | Display order |
| color | String(20) | UI color |
| requires_approval | Boolean | Approval required |
| requires_evidence | Boolean | Evidence required |
| auto_assign_department_id | Integer (FK) | Auto-assign department |
| sla_multiplier | Float | SLA multiplier |
| is_terminal | Boolean | Terminal state flag |

### grc_vuln_workflow_transitions
State transitions.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Transition identifier |
| template_id | Integer (FK) | Template reference |
| from_state_id | Integer (FK) | Source state |
| to_state_id | Integer (FK) | Target state |
| name | String(100) | Transition name |
| requires_comment | Boolean | Comment required |
| requires_approval | Boolean | Approval required |
| approver_role | String(50) | Required approver role |
| allowed_roles | JSON | Allowed roles |
| trigger_notification | Boolean | Notification flag |

### grc_vuln_workflow_escalations
Escalation rules.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Escalation identifier |
| template_id | Integer (FK) | Template reference |
| name | String(100) | Rule name |
| trigger_type | String(50) | sla_percentage, days_open, severity_escalation |
| trigger_value | Float | Trigger value |
| escalate_to_department_id | Integer (FK) | Target department |
| escalate_to_role | String(50) | Target role |
| auto_transition_to_state_id | Integer (FK) | Auto-transition state |
| notification_type | String(20) | email, in_app, both |
| is_active | Boolean | Active flag |

### grc_vuln_workflow_history
Workflow audit trail.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | History identifier |
| vulnerability_id | Integer (FK) | Vulnerability reference |
| from_state_id | Integer (FK) | Previous state |
| to_state_id | Integer (FK) | New state |
| transition_id | Integer (FK) | Transition used |
| performed_by | Integer (FK) | Actor |
| comment | Text | Comment |
| performed_at | DateTime | Action timestamp |

### grc_vuln_notifications
Notification records.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Notification identifier |
| tenant_id | Integer (FK) | Tenant scope |
| vulnerability_id | Integer (FK) | Vulnerability reference |
| notification_type | String(50) | Notification type |
| title | String(255) | Title |
| message | Text | Message |
| recipient_user_id | Integer (FK) | Recipient user |
| recipient_department_id | Integer (FK) | Recipient department |
| triggered_by_user_id | Integer (FK) | Trigger user |
| is_read | Boolean | Read flag |
| read_at | DateTime | Read timestamp |
| created_at | DateTime | Creation timestamp |

---

## Data Flow Overview

### 1. Framework Management Flow
```
UploadedFramework → ParsedFrameworkControl → ControlEvidenceMapping
                                          → FrameworkControlAlignment
                  → (Publish) → Framework → FrameworkDomain → ControlObjective → FrameworkControl → FrameworkSubControl
                                                                                                  → CuratedEvidenceItem
```

### 2. Compliance Journey Flow
```
Framework → CertificationJourney → ControlImplementation → ImplementationEvidence
                                                        ↔ Evidence
```

### 3. Risk Management Flow
```
Risk → RiskControlLink → NormalizedControl
     → RiskAssetLink → ITAsset
     → RiskEvidenceLink → Evidence
     → RiskKRI → RiskKRIMeasurement
     → RiskIncident
     → RiskMitigationAction
     → RiskReview
     → RiskScoreHistory
```

### 4. Evidence Flow
```
Evidence → EvidenceVersion
        → EvidenceControlMapping → NormalizedControl/FrameworkControl
        → EvidenceAIAssessment
        → AuditPackageEvidence → AuditPackage
```

### 5. Governance Document Flow
```
GovernanceDocument → GovernanceDocumentVersion
                  → DocumentReviewer
                  → DocumentApprovalStep
                  → DocumentWorkflowInstance → DocumentWorkflowAction
                  → PolicyStatement → PolicyStatementCompliance
                  → DocumentControlLink → NormalizedControl
                  → DocumentRiskLink → Risk
                  → DocumentAssetLink → ITAsset
```

### 6. Vulnerability Management Flow
```
VulnerabilityReport → Vulnerability → VulnerabilityMitigation
                                   → VulnerabilityAssetLink → ITAsset
                                   → VulnerabilityControlLink → FrameworkControl/NormalizedControl/InternalControl
                                   → VulnerabilityRetest
                                   → GRCVulnWorkflowHistory
                                   → GRCVulnerabilityDepartmentAssignment → GRCDepartment
                                   → GRCVulnNotification
```

### 7. Internal Control Flow
```
InternalControl → InternalControlTest
               → InternalControlRiskLink → Risk
               → InternalControlFrameworkLink → FrameworkControl/NormalizedControl
               → InternalControlEscalation
               → InternalControlWorkflowAction
```

---

## Key Design Patterns

### 1. Multi-Tenancy
All major tables include a `tenant_id` foreign key for data isolation. Queries should always filter by tenant.

### 2. Soft Delete
Most entities use `is_active` or `status` fields rather than hard deletes for audit trail preservation.

### 3. Version Control
Documents, evidence, and policies maintain full version history with change tracking.

### 4. Workflow Engine
Configurable workflow templates with states, transitions, and escalations support customizable approval processes.

### 5. AI Integration
Multiple tables store AI-generated content (recommendations, assessments, similarities) with confidence scores.

### 6. Link Tables
Many-to-many relationships use dedicated link tables with additional metadata (e.g., link_type, notes, created_at).

### 7. Audit Trail
Comprehensive logging through dedicated audit tables and timestamp fields on all entities.

---

## Database Initialization

The database is initialized via `init_grc_db()` which:
1. Creates all tables via SQLAlchemy's `Base.metadata.create_all()`
2. Seeds 8 regulatory frameworks (ISO 27001, PCI-DSS, SOC 2, etc.)
3. Seeds sub-controls with evidence recommendations
4. Seeds curated evidence items
5. Seeds control-evidence mappings
6. Seeds certification phases
7. Seeds sample internal controls
8. Seeds sample vulnerabilities
9. Seeds default vulnerability workflow templates

---

## Indexes

The schema includes comprehensive indexes for:
- Foreign key relationships
- Common query patterns (tenant + status, tenant + type)
- Composite indexes for frequent joins
- Unique constraints for business rules

---

*Last Updated: January 2026*
