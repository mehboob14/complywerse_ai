// ─── Framework-specific artifact template generator ──────────────────────────
// Generates structured, professional Markdown documents tailored to the artifact
// type, name, and framework context pulled from the catalog catalog.

export interface ArtifactMeta {
  name: string;
  artifactType: string;
  controlRef: string | null;
  description: string | null;
  frameworkName: string;
  frameworkKey: string;
  stage: string;
  artifactId: string;
  owner: string | null;
  format: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function docHeader(meta: ArtifactMeta, docClass = 'Internal'): string {
  return `# ${meta.name}

| | |
|---|---|
| **Document ID** | ${meta.artifactId} |
| **Framework** | ${meta.frameworkName} |
| **Control Reference** | ${meta.controlRef || 'N/A'} |
| **Document Type** | ${meta.artifactType} |
| **Classification** | ${docClass} |
| **Version** | 1.0 |
| **Date** | ${today()} |
| **Owner** | ${meta.owner || 'To Be Assigned'} |
| **Status** | Draft |

---
`;
}

function reviewTable(): string {
  return `## Document Review & Approval

| Version | Date | Author | Reviewed By | Approved By | Change Summary |
|---------|------|--------|-------------|-------------|----------------|
| 1.0 | ${today()} | | | | Initial draft |

---
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy Template
// ─────────────────────────────────────────────────────────────────────────────

function buildPolicyTemplate(meta: ArtifactMeta): string {
  const isISO = meta.frameworkKey.startsWith('iso_27001');
  const isPCI = meta.frameworkKey.startsWith('pci_dss');
  const isHIPAA = meta.frameworkKey === 'hipaa';
  const isGDPR = meta.frameworkKey === 'gdpr';

  const name = meta.name.toLowerCase();

  // Build context-aware policy requirements section
  let requirementsSection = '';
  if (name.includes('access control')) {
    requirementsSection = `## 4. Policy Requirements

### 4.1 Access Provisioning
- All access to systems and data must be formally requested, approved, and documented.
- Access requests must be approved by the data/system owner and the user's line manager.
- The principle of least privilege must be applied; users receive only the minimum access required.
- Privileged access (admin, root, service accounts) must be separately approved and regularly reviewed.

### 4.2 Authentication
- All user accounts must be protected by strong authentication mechanisms.
- Multi-factor authentication (MFA) must be enforced for remote access, privileged accounts, and cloud services.
- Password requirements: minimum 12 characters, complexity enforced, no reuse of last 10 passwords.
- Shared or generic accounts are prohibited except where technically justified and approved.

### 4.3 Access Review
- Access rights must be reviewed at least every 6 months by the system or data owner.
- Access for terminated or transferred employees must be revoked within 24 hours of notification.
- Dormant accounts unused for 90 days must be disabled pending review.

### 4.4 Remote & Third-Party Access
- Remote access must be granted only via approved, encrypted channels (VPN/zero-trust gateway).
- Third-party access must be time-limited, documented, and subject to the same review cycle.`;
  } else if (name.includes('information security policy') || name.includes('isms')) {
    requirementsSection = `## 4. Policy Requirements

### 4.1 Commitment
- ${meta.frameworkName} certification/compliance requires the organisation to demonstrate management commitment to information security through this Policy and supporting documentation.
- Leadership shall ensure adequate resources are allocated to implement, maintain, and continually improve the ISMS.

### 4.2 Security Objectives
- Information security objectives shall be established, measured, and reviewed at least annually.
- Objectives must be aligned with business goals, risk appetite, and regulatory requirements.

### 4.3 Risk-Based Approach
- All information security decisions shall be based on a risk assessment that considers confidentiality, integrity, and availability.
- Risk treatment options: accept, mitigate, transfer, or avoid — each requiring documented justification.

### 4.4 Continual Improvement
- Nonconformities, security incidents, and audit findings shall be used to drive continual improvement.
- The ISMS shall be reviewed at planned intervals and following significant changes.`;
  } else if (name.includes('acceptable use')) {
    requirementsSection = `## 4. Policy Requirements

### 4.1 Authorised Use
- Organisational IT systems and data may only be used for legitimate business purposes.
- Incidental personal use is permitted provided it does not impact productivity, security, or reputation.
- Users must not share credentials or allow others to use their accounts.

### 4.2 Prohibited Activities
The following activities are strictly prohibited:
- Accessing, storing, or transmitting offensive, illegal, or copyrighted material without authorisation.
- Circumventing security controls, installing unauthorised software, or disabling endpoint protection.
- Using organisational resources to conduct personal business or generate personal income.
- Accessing systems or data for which authorisation has not been granted.

### 4.3 Monitoring
- Organisational systems are subject to monitoring in accordance with applicable law and privacy requirements.
- Users have no expectation of privacy on organisational systems or networks.
- Monitoring logs may be used as evidence in disciplinary proceedings.`;
  } else if (name.includes('cryptography')) {
    requirementsSection = `## 4. Policy Requirements

### 4.1 Approved Cryptographic Standards
| Use Case | Algorithm | Minimum Key Length |
|---|---|---|
| Symmetric encryption | AES | 256-bit |
| Asymmetric encryption | RSA / ECC | RSA 2048-bit / ECC 256-bit |
| Hashing | SHA-2 family | SHA-256 minimum |
| TLS | TLS 1.2+ | — |
| Key exchange | ECDH / DH | 2048-bit |

### 4.2 Key Management
- Cryptographic keys must be protected throughout their lifecycle: generation, storage, distribution, use, and destruction.
- Key generation must use a FIPS 140-2 validated or equivalent random number generator.
- Keys must be stored in approved key management systems or HSMs; never in plain text.
- Keys must be rotated per the schedules defined in the Key Management Register.

### 4.3 Prohibited Algorithms
- MD5, SHA-1, DES, 3DES, RC4 are prohibited for new implementations.
- Existing uses of prohibited algorithms must be tracked and remediated on a risk-based schedule.`;
  } else {
    requirementsSection = `## 4. Policy Requirements

### 4.1 General Requirements
${meta.description ? `This policy addresses: ${meta.description}` : `This policy governs all activities related to ${meta.name.toLowerCase()} within the organisation.`}

The following requirements apply to all in-scope personnel and systems:

- **Compliance**: All personnel must comply with this policy and supporting procedures.
- **Risk Management**: Decisions must consider information security risks and applicable controls.
- **Exceptions**: Any exception to this policy must be formally requested, risk-assessed, and approved by the Information Security Officer (or equivalent).
- **Review**: This policy must be reviewed at least annually or following significant organisational or regulatory change.

### 4.2 Specific Control Requirements
${meta.controlRef ? `This policy supports compliance with **${meta.controlRef}** of the **${meta.frameworkName}** framework.` : ''}

[Add specific, measurable requirements relevant to this policy domain.]

### 4.3 Non-Compliance
Violations of this policy may result in disciplinary action up to and including termination. Significant violations may be reported to relevant authorities.`;
  }

  return `${docHeader(meta)}
## 1. Purpose

This policy establishes the organisation's requirements for ${meta.name.replace(/policy$/i, '').trim().toLowerCase()}, ensuring alignment with **${meta.frameworkName}**${meta.controlRef ? ` (${meta.controlRef})` : ''} and applicable regulatory obligations.

${meta.description ? `**Context:** ${meta.description}` : ''}

---

## 2. Scope

This policy applies to:
- All employees, contractors, consultants, and third parties with access to organisational information systems or data.
- All information assets regardless of format (digital, physical, or verbal).
- All organisational locations, including remote working environments.

**Exclusions:** [Document any explicit exclusions with justification.]

---

## 3. Roles & Responsibilities

| Role | Responsibility |
|------|---------------|
| Board / Executive Leadership | Endorsement and resource allocation |
| Information Security Officer | Policy ownership, interpretation, and enforcement |
| Departmental Managers | Ensuring team compliance |
| IT / Operations | Technical implementation of controls |
| All Personnel | Adherence to this policy |

---

${requirementsSection}

---

## 5. Related Documents

| Document | Type | Reference |
|----------|------|-----------|
${meta.frameworkName} Control Framework | Standard | ${meta.controlRef || '—'} |
Information Security Policy | Policy | — |
[Add related policies, procedures, and standards] | | |

---

## 6. Enforcement & Exceptions

- Violations must be reported to [security team contact].
- Exception requests must be submitted via [exception process], reviewed by the ISO, and approved by [approver].
- Approved exceptions are time-limited (maximum 12 months) and must be reviewed at renewal.

---

## 7. Review Schedule

| Review Frequency | Next Review | Review Owner |
|-----------------|-------------|--------------|
| Annual (or upon significant change) | ${new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0]} | Information Security Officer |

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedure Template
// ─────────────────────────────────────────────────────────────────────────────

function buildProcedureTemplate(meta: ArtifactMeta): string {
  const name = meta.name.toLowerCase();

  let stepsSection = '';
  if (name.includes('incident') || name.includes('response')) {
    stepsSection = `## 5. Procedure Steps

### Phase 1 – Detection & Identification
1. Any employee who suspects a security incident must report it immediately to the Security Operations Centre (SOC) or designated security contact.
2. The SOC analyst logs the report in the Incident Management System and assigns a ticket ID.
3. Initial triage is performed: confirm whether the event constitutes a security incident.
4. Assign severity level (P1 Critical / P2 High / P3 Medium / P4 Low) based on impact and urgency.

### Phase 2 – Containment
5. Implement short-term containment to limit damage (e.g., isolate affected systems, revoke compromised credentials).
6. Preserve forensic evidence: do not power off systems before imaging if avoidable.
7. Document all containment actions with timestamps in the incident ticket.
8. Notify relevant stakeholders per the Communication Matrix (see Appendix A).

### Phase 3 – Eradication & Recovery
9. Identify and eliminate the root cause (malware removal, patching, configuration fix).
10. Restore systems from verified clean backups; validate integrity before reconnecting.
11. Confirm no residual indicators of compromise remain.

### Phase 4 – Post-Incident Review
12. Within 5 business days of closure, conduct a lessons-learned review.
13. Identify control gaps and document corrective actions in the Nonconformity Register.
14. Update the Incident Log and close the ticket.`;
  } else if (name.includes('risk assessment')) {
    stepsSection = `## 5. Procedure Steps

### Step 1 – Scope Definition
1. Define the scope of the risk assessment: systems, processes, locations, and data types in scope.
2. Confirm the risk assessment team and assign roles (facilitator, asset owners, subject-matter experts).

### Step 2 – Asset Identification
3. Identify all information assets within scope from the Asset Inventory / Register.
4. For each asset, record: asset type, owner, criticality, and data classification.

### Step 3 – Threat & Vulnerability Identification
5. For each asset, identify relevant threats (using threat catalogues, STRIDE, MITRE ATT&CK as applicable).
6. Identify existing vulnerabilities: technical (CVEs, misconfigurations) and organisational (process gaps).

### Step 4 – Risk Analysis
7. Assess the **likelihood** of each threat exploiting the vulnerability (scale: 1=Rare, 2=Unlikely, 3=Possible, 4=Likely, 5=Almost Certain).
8. Assess the **impact** if the risk materialises (scale: 1=Negligible, 2=Minor, 3=Moderate, 4=Major, 5=Catastrophic).
9. Calculate **inherent risk score** = Likelihood × Impact.

### Step 5 – Risk Evaluation & Treatment
10. Compare each risk score against the Risk Acceptance Threshold (defined in Risk Management Policy).
11. For risks above the threshold, select a treatment option: Mitigate / Accept / Transfer / Avoid.
12. Document treatment decisions, responsible owners, and target residual risk in the Risk Register.

### Step 6 – Documentation & Review
13. Finalise the Risk Register and obtain sign-off from the risk owner(s) and Information Security Officer.
14. Schedule the next risk assessment review date.`;
  } else if (name.includes('document control')) {
    stepsSection = `## 5. Procedure Steps

### Step 1 – Document Creation
1. Author drafts the document using the approved template for the document type.
2. Assign a unique Document ID using the format: [DEPT]-[TYPE]-[NNN] (e.g., IS-POL-001).
3. Complete the document header: title, owner, classification, version (start at 0.1 for drafts).

### Step 2 – Review
4. Author circulates the draft to nominated reviewers via the Document Management System (DMS).
5. Reviewers provide feedback within the agreed review period (default: 5 business days).
6. Author incorporates feedback and updates the version number and change log.

### Step 3 – Approval
7. Final draft is submitted to the document approver (see Document Register for approver matrix).
8. Approver endorses the document; version number increments to the next whole number (e.g., 1.0).
9. Approved document is published in the DMS with effective date.

### Step 4 – Distribution
10. Notify relevant stakeholders of the new/updated document.
11. Archive the previous version; mark it as superseded.

### Step 5 – Review & Retirement
12. Review dates are set at creation and tracked in the Document Register.
13. At review, confirm document remains current, accurate, and fit for purpose.
14. Documents no longer required are marked as retired; retained per the Records Retention Schedule.`;
  } else {
    stepsSection = `## 5. Procedure Steps

### Step 1 – Preparation
1. Confirm scope, participants, and required inputs before commencing.
2. Review any prerequisites listed in Section 4.
3. Gather relevant templates, forms, and reference documents.

### Step 2 – Execution
4. [Describe the primary activity steps in sequence.]
5. [Each step should identify who performs it and what inputs/outputs are involved.]
6. [Include decision points and escalation criteria.]

### Step 3 – Validation
7. Review outputs for completeness and accuracy.
8. Obtain required sign-offs or approvals.
9. Address any issues identified before proceeding.

### Step 4 – Documentation
10. Record all outputs in the relevant log or register.
11. Store documentation in the approved repository with correct access controls.
12. Update the status of any related tasks or tickets.

### Step 5 – Closure
13. Notify stakeholders of completion.
14. Archive working documents per the Records Retention Schedule.`;
  }

  return `${docHeader(meta)}
## 1. Purpose

This procedure defines the step-by-step process for **${meta.name}**, ensuring consistent, controlled, and auditable execution in alignment with **${meta.frameworkName}**${meta.controlRef ? ` (${meta.controlRef})` : ''}.

${meta.description ? `**Context:** ${meta.description}` : ''}

---

## 2. Scope

This procedure applies to all personnel responsible for carrying out or overseeing the activities described herein.

**In Scope:** [List systems, teams, or processes covered]
**Out of Scope:** [List any explicit exclusions]

---

## 3. Roles & Responsibilities

| Role | Responsibility |
|------|---------------|
| Process Owner | Maintains and improves this procedure |
| Executor | Carries out the steps as defined |
| Approver | Signs off outputs where required |
| Auditor | Reviews records for compliance |

---

## 4. Prerequisites & Inputs

Before beginning this procedure, ensure:
- [ ] Required access and permissions are in place
- [ ] Relevant templates and forms are available
- [ ] Prior stage has been completed (if applicable): **${meta.stage}**
${meta.controlRef ? `- [ ] Familiarity with ${meta.frameworkName} **${meta.controlRef}** requirements` : ''}

---

${stepsSection}

---

## 6. Outputs & Records

| Output | Description | Storage Location | Retention |
|--------|-------------|-----------------|-----------|
| [Record/log name] | [Description] | [DMS / SharePoint / etc.] | [Period] |
| [Form/template name] | [Description] | [Location] | [Period] |

---

## 7. Metrics & KPIs

| Metric | Target | Measurement Frequency |
|--------|--------|-----------------------|
| Completion rate | 100% | Monthly |
| Average cycle time | < [X] days | Monthly |
| Exceptions logged | 0 critical | Per occurrence |

---

## 8. Related Documents

| Document | Type |
|----------|------|
| ${meta.name.replace(/procedure$/i, 'Policy').trim()} | Policy |
| [Supporting register or log] | Register |
| ${meta.frameworkName} Controls | Framework Reference |

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Register Template
// ─────────────────────────────────────────────────────────────────────────────

function buildRegisterTemplate(meta: ArtifactMeta): string {
  const name = meta.name.toLowerCase();
  let columnsSection = '';
  let sampleRow = '';

  if (name.includes('risk register') || name.includes('risk & opportunity')) {
    columnsSection = `## 4. Register Fields

| Field | Description |
|-------|-------------|
| Risk ID | Unique identifier (e.g., RISK-001) |
| Date Identified | Date the risk was logged |
| Risk Category | Operational / Strategic / Compliance / Financial / Reputational |
| Risk Description | Clear description of the risk event and its cause |
| Affected Asset/Process | Asset or process at risk |
| Likelihood (1–5) | Probability of occurrence |
| Impact (1–5) | Magnitude of consequences |
| Inherent Risk Score | Likelihood × Impact |
| Existing Controls | Controls currently in place |
| Residual Likelihood | After existing controls |
| Residual Impact | After existing controls |
| Residual Risk Score | Residual Likelihood × Residual Impact |
| Treatment Option | Mitigate / Accept / Transfer / Avoid |
| Treatment Actions | Specific mitigation steps |
| Risk Owner | Person accountable for treatment |
| Target Date | Date by which treatment is to be completed |
| Status | Open / In Progress / Closed / Accepted |
| Review Date | Next scheduled review |

## 5. Risk Scoring Matrix

| | **Impact 1 (Negligible)** | **Impact 2 (Minor)** | **Impact 3 (Moderate)** | **Impact 4 (Major)** | **Impact 5 (Critical)** |
|---|---|---|---|---|---|
| **Likelihood 5 (Almost Certain)** | 5 – Medium | 10 – High | 15 – Critical | 20 – Critical | 25 – Critical |
| **Likelihood 4 (Likely)** | 4 – Low | 8 – Medium | 12 – High | 16 – Critical | 20 – Critical |
| **Likelihood 3 (Possible)** | 3 – Low | 6 – Medium | 9 – High | 12 – High | 15 – Critical |
| **Likelihood 2 (Unlikely)** | 2 – Low | 4 – Low | 6 – Medium | 8 – Medium | 10 – High |
| **Likelihood 1 (Rare)** | 1 – Low | 2 – Low | 3 – Low | 4 – Low | 5 – Medium |

**Thresholds:** Low: 1–4 | Medium: 5–9 | High: 10–14 | Critical: 15–25`;
    sampleRow = `| RISK-001 | ${today()} | Operational | Unauthorised access to customer data | Customer DB | 3 | 4 | 12 – High | Firewall, MFA | 2 | 4 | 8 – Medium | Mitigate | Implement PAM solution | CISO | ${new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString().split('T')[0]} | In Progress | Quarterly |`;
  } else if (name.includes('asset') || name.includes('inventory')) {
    columnsSection = `## 4. Register Fields

| Field | Description |
|-------|-------------|
| Asset ID | Unique identifier (e.g., ASSET-001) |
| Asset Name | Descriptive name |
| Asset Type | Hardware / Software / Data / Service / People |
| Description | Brief description of purpose |
| Owner | Individual or team responsible |
| Custodian | Individual managing the asset day-to-day |
| Classification | Public / Internal / Confidential / Restricted |
| Location | Physical or logical location |
| IP Address / Hostname | (for network assets) |
| OS / Version | (for hardware/software) |
| Business Criticality | Critical / High / Medium / Low |
| Personal Data | Yes / No |
| Regulatory Scope | Frameworks this asset falls under |
| Purchase Date | — |
| End-of-Life Date | — |
| Status | Active / Retired / Disposed |`;
    sampleRow = `| ASSET-001 | Core Banking Application | Software | Primary transaction processing system | IT Director | Systems Admin | Confidential | Cloud – AWS eu-west-1 | banking-app.internal | Java 17 / RHEL 8 | Critical | Yes | PCI DSS, ISO 27001 | 2020-06-01 | 2027-06-01 | Active |`;
  } else if (name.includes('interested parties') || name.includes('stakeholder')) {
    columnsSection = `## 4. Register Fields

| Field | Description |
|-------|-------------|
| ID | Unique identifier |
| Stakeholder / Party | Name or category |
| Type | Internal / External |
| Interest / Expectation | What they need from the ISMS/FMS |
| Relevant Requirements | Regulatory, contractual, or internal obligations |
| Communication Method | How we engage with them |
| Review Frequency | How often expectations are reviewed |`;
    sampleRow = `| SP-001 | Customers | External | Data confidentiality and service availability | GDPR, contractual SLA | Customer portal, incident notifications | Annual |`;
  } else if (name.includes('incident') || name.includes('event log')) {
    columnsSection = `## 4. Register Fields

| Field | Description |
|-------|-------------|
| Incident ID | Unique reference (e.g., INC-2024-001) |
| Date/Time Detected | When the incident was first identified |
| Date/Time Reported | When it was formally logged |
| Reported By | Reporter name/role |
| Incident Type | Malware / Phishing / Unauthorised Access / Data Breach / Availability / Other |
| Affected Systems | Systems/data impacted |
| Severity | P1 Critical / P2 High / P3 Medium / P4 Low |
| Description | Brief factual account |
| Initial Response Actions | Steps taken at detection |
| Root Cause | Identified cause (post-investigation) |
| Data Involved | Personal data or sensitive data affected? |
| Regulatory Notification Required | Yes/No + date notified |
| Resolution Actions | Remediation steps taken |
| Lessons Learned | Process or control improvements identified |
| Status | Open / In Progress / Closed |
| Closure Date | — |`;
    sampleRow = `| INC-2024-001 | 2024-03-15 08:30 | 2024-03-15 09:00 | NOC Analyst | Phishing | Email system, 3 mailboxes | P2 High | Credential-harvesting email delivered to finance team | Accounts suspended, links blocked | Compromised credential re-use | No | No | Password reset, MFA enforced, phishing simulation added | Improve email gateway filtering | Closed | 2024-03-20 |`;
  } else if (name.includes('nonconformity') || name.includes('corrective action') || name.includes('improvement')) {
    columnsSection = `## 4. Register Fields

| Field | Description |
|-------|-------------|
| NC/CI ID | Unique reference |
| Date Raised | When identified |
| Source | Internal Audit / External Audit / Incident / Management Review / Employee Suggestion |
| Description | What was found or suggested |
| Root Cause | Underlying cause (5-Whys / Fishbone) |
| Immediate Correction | Short-term fix applied |
| Corrective / Improvement Action | Long-term preventive action |
| Owner | Person responsible for completion |
| Target Date | When action is due |
| Verification Method | How completion will be verified |
| Status | Open / In Progress / Verified / Closed |
| Closure Date | — |
| Effectiveness Review | Was the action effective? |`;
  } else {
    columnsSection = `## 4. Register Fields

| Field | Description |
|-------|-------------|
| ID | Unique identifier |
| Date | Date of entry |
| Description | What is being registered |
| Category / Type | Classification |
| Owner | Responsible individual |
| Status | Current state |
| Review Date | Next review |
| Notes | Additional context |`;
    sampleRow = `| REG-001 | ${today()} | [Entry description] | [Category] | [Owner] | Active | Quarterly | — |`;
  }

  return `${docHeader(meta)}
## 1. Purpose

This register provides a centralised, controlled record of **${meta.name.toLowerCase()}**, supporting compliance with **${meta.frameworkName}**${meta.controlRef ? ` (${meta.controlRef})` : ''} and enabling consistent oversight and management.

${meta.description ? `**Context:** ${meta.description}` : ''}

---

## 2. Scope

This register covers all relevant items within the scope of the organisation's ${meta.frameworkName} programme.

---

## 3. Register Maintenance

| Responsibility | Detail |
|---------------|--------|
| Register Owner | ${meta.owner || '[Assign owner]'} |
| Update Frequency | As entries are added/changed; reviewed at least quarterly |
| Access Control | Restricted to authorised personnel; available to auditors on request |
| Storage | [Document management system / SharePoint / etc.] |
| Retention | [Period as per Records Retention Schedule] |

---

${columnsSection}

---

## 5. Register Entries

${sampleRow ? `| *(Sample row below — replace with actual entries)* |\n|---|\n${sampleRow}` : `[Populate with entries following the field definitions above.]`}

---

## 6. Reporting

This register feeds into:
- Periodic management reports on [topic]
- ${meta.frameworkName} compliance evidence package
- Internal/external audit packs

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan Template
// ─────────────────────────────────────────────────────────────────────────────

function buildPlanTemplate(meta: ArtifactMeta): string {
  const name = meta.name.toLowerCase();

  let mainSection = '';
  if (name.includes('project charter') || name.includes('implementation roadmap')) {
    mainSection = `## 5. Phased Implementation Plan

| Phase | Activities | Owner | Start | End | Status |
|-------|-----------|-------|-------|-----|--------|
| Phase 1 – Initiation | Project setup, scope confirmation, stakeholder mapping | Project Lead | | | Not Started |
| Phase 2 – Gap Analysis | Current state assessment vs ${meta.frameworkName} requirements | Lead Auditor | | | Not Started |
| Phase 3 – Risk Assessment | Risk identification, analysis, and treatment planning | Risk Manager | | | Not Started |
| Phase 4 – Controls Implementation | Deploy technical and organisational controls | IT & CISO | | | Not Started |
| Phase 5 – Documentation | Develop all required policies, procedures, and records | Policy Team | | | Not Started |
| Phase 6 – Training & Awareness | Deliver training to all in-scope personnel | HR / Security | | | Not Started |
| Phase 7 – Internal Audit | Internal readiness assessment | Internal Audit | | | Not Started |
| Phase 8 – Certification Audit | Stage 1 (docs) + Stage 2 (operations) | External Auditor | | | Not Started |

## 6. Key Milestones

| Milestone | Target Date | Owner | Status |
|-----------|------------|-------|--------|
| Project kick-off | | Sponsor | |
| Gap analysis complete | | Lead Auditor | |
| Risk assessment approved | | CISO | |
| All policies in place | | Policy Owner | |
| Internal audit complete | | Internal Auditor | |
| Stage 1 audit passed | | Project Lead | |
| Certification achieved | | CEO / Sponsor | |`;
  } else if (name.includes('risk treatment')) {
    mainSection = `## 5. Risk Treatment Actions

| Risk ID | Risk Description | Treatment Option | Control(s) to Implement | Owner | Target Date | Priority | Status |
|---------|-----------------|-----------------|------------------------|-------|------------|----------|--------|
| RISK-001 | [Description] | Mitigate | [Control reference] | | | High | Open |
| RISK-002 | [Description] | Accept | Accepted — below threshold | | | Low | Accepted |

## 6. Control Implementation Summary

| Control Reference | Control Name | Implementation Status | Evidence Reference | Completion Date |
|------------------|-----------|-----------------------|---------------------|----------------|
| ${meta.controlRef || '[Ref]'} | ${meta.name} | In Progress | | |

## 7. Residual Risk Sign-Off

All residual risks must be reviewed and accepted by the risk owner and CISO before closure.

| Risk ID | Residual Score | Risk Owner Sign-Off | CISO Sign-Off | Date |
|---------|--------------|---------------------|---------------|------|
| | | | | |`;
  } else if (name.includes('business continuity') || name.includes('bcp') || name.includes('dr')) {
    mainSection = `## 5. Business Impact Analysis (BIA) Summary

| Business Function | Criticality | RTO (hrs) | RPO (hrs) | Minimum Resource Level |
|------------------|------------|-----------|-----------|----------------------|
| [Function 1] | Critical | 4 | 1 | [Resources required] |
| [Function 2] | High | 8 | 4 | [Resources required] |

## 6. Recovery Strategies

| Scenario | Recovery Strategy | Responsible Team | Recovery Site |
|----------|-----------------|------------------|--------------|
| IT system failure | Failover to DR site | IT Operations | [DR location] |
| Building unavailable | Remote working activation | HR + IT | Remote |
| Key personnel unavailability | Deputy activation | Department Head | — |

## 7. BC Test Schedule

| Test Type | Frequency | Last Conducted | Next Due | Owner |
|-----------|-----------|---------------|----------|-------|
| Tabletop exercise | Semi-annual | | | BC Manager |
| Full simulation | Annual | | | BC Manager |
| Technical failover test | Quarterly | | | IT Operations |`;
  } else if (name.includes('audit programme') || name.includes('audit plan')) {
    mainSection = `## 5. Audit Schedule

| Audit # | Audit Scope | Auditor | Planned Date | Status | Report Reference |
|---------|------------|---------|-------------|--------|-----------------|
| IA-2024-01 | [Scope area 1 — e.g., Access Control] | [Auditor name] | | Planned | |
| IA-2024-02 | [Scope area 2 — e.g., Incident Management] | [Auditor name] | | Planned | |
| IA-2024-03 | [Scope area 3 — e.g., Risk Management] | [Auditor name] | | Planned | |

## 6. Audit Criteria

All internal audits shall be conducted against:
- ${meta.frameworkName} requirements${meta.controlRef ? ` (${meta.controlRef})` : ''}
- Applicable policies and procedures
- Contractual and regulatory obligations

## 7. Audit Resources

| Resource | Requirement |
|----------|-------------|
| Lead Auditor | Trained ISO 27001 / ${meta.frameworkName} Internal Auditor |
| Independence | Auditors must not audit their own area |
| Tools | Audit checklist, evidence collection templates, CARs |`;
  } else {
    mainSection = `## 5. Plan Phases

| Phase | Objective | Key Activities | Owner | Timeline | Status |
|-------|-----------|---------------|-------|----------|--------|
| 1 | [Objective] | [Activities] | | | Not Started |
| 2 | [Objective] | [Activities] | | | Not Started |
| 3 | [Objective] | [Activities] | | | Not Started |

## 6. Milestones & Deliverables

| Milestone | Deliverable | Target Date | Owner | Status |
|-----------|------------|------------|-------|--------|
| [Milestone 1] | [Deliverable] | | | |
| [Milestone 2] | [Deliverable] | | | |

## 7. Resource Plan

| Resource Type | Requirement | Allocated |
|--------------|-------------|-----------|
| Personnel | [FTE / days] | |
| Budget | [Amount] | |
| Tools & Systems | [List] | |`;
  }

  return `${docHeader(meta)}
## 1. Purpose

This plan defines the structured approach for **${meta.name.toLowerCase()}**, providing governance, timelines, and accountability in support of **${meta.frameworkName}**${meta.controlRef ? ` (${meta.controlRef})` : ''}.

${meta.description ? `**Context:** ${meta.description}` : ''}

---

## 2. Objectives

1. [Primary objective]
2. [Secondary objective]
3. Achieve/maintain compliance with ${meta.frameworkName}${meta.controlRef ? ` ${meta.controlRef}` : ''}
4. [Specific measurable outcome]

---

## 3. Scope & Boundaries

**In Scope:**
- [Systems, processes, or locations covered]

**Out of Scope:**
- [Explicit exclusions with justification]

---

## 4. Governance

| Role | Responsibility |
|------|---------------|
| Sponsor | Executive accountability and resource sign-off |
| Plan Owner | Day-to-day management and reporting |
| Steering Group | Progress oversight and issue resolution |
| Participants | Execution of assigned tasks |

---

${mainSection}

---

## 8. Risks to Plan Delivery

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Resource constraints | Medium | High | Escalate to sponsor early |
| Scope creep | Medium | Medium | Strict change control |
| Stakeholder unavailability | Low | Medium | Backup contacts identified |

---

## 9. Communication Plan

| Audience | Information | Frequency | Channel |
|----------|------------|-----------|---------|
| Steering Group | Status update | Monthly | Meeting / Report |
| Participants | Task assignments | Per milestone | Email / DMS |
| Senior Leadership | Executive summary | Quarterly | Board report |

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Template
// ─────────────────────────────────────────────────────────────────────────────

function buildReportTemplate(meta: ArtifactMeta): string {
  const name = meta.name.toLowerCase();

  let findingsSection = '';
  if (name.includes('gap analysis')) {
    findingsSection = `## 5. Gap Analysis Findings

### Assessment Methodology
Controls assessed against: **${meta.frameworkName}** requirements.
Assessment method: Document review, interviews, technical testing (where applicable).

### Compliance Summary

| Domain / Clause | Requirement | Current Status | Gap Description | Priority |
|----------------|------------|---------------|-----------------|----------|
| ${meta.controlRef || '[Clause]'} | [Requirement summary] | Partial | [Description of gap] | High |
| | | | | |

### Overall Compliance Score

| Maturity Level | Definition | Count | % of Total |
|---------------|-----------|-------|------------|
| 1 – Non-Existent | No control in place | | |
| 2 – Initial | Ad hoc, undocumented | | |
| 3 – Defined | Documented, not consistently followed | | |
| 4 – Managed | Implemented and monitored | | |
| 5 – Optimised | Continually improved | | |

**Overall Maturity: [X.X / 5.0]**`;
  } else if (name.includes('audit report')) {
    findingsSection = `## 5. Audit Findings

### Finding Summary

| Finding ID | Clause / Control | Severity | Finding Description | Evidence |
|-----------|-----------------|----------|-------------------|----------|
| F-001 | ${meta.controlRef || '[Clause]'} | [Major/Minor/OFI] | [Description] | [Reference] |

### Finding Detail: F-001

**Clause:** ${meta.controlRef || '[Clause]'}
**Severity:** Major Nonconformity / Minor Nonconformity / Observation / Opportunity for Improvement

**Objective Evidence:**
[Describe what was observed, inspected, or tested.]

**Requirement:**
[Quote the relevant requirement from ${meta.frameworkName}.]

**Finding:**
[Describe the gap between the requirement and observed practice.]

**Required Action:**
[Corrective action required within [timeframe].]`;
  } else if (name.includes('soa') || name.includes('statement of applicability')) {
    findingsSection = `## 5. Control Applicability Assessment

### Summary

| Applicability | Count | % |
|--------------|-------|---|
| Applicable & Implemented | | |
| Applicable & Planned | | |
| Not Applicable | | |
| **Total Controls** | | 100% |

### Controls Table

| Control Ref | Control Name | Applicable? | Justification for Inclusion/Exclusion | Implementation Status | Evidence Reference |
|------------|-------------|------------|--------------------------------------|----------------------|-------------------|
| ${meta.controlRef || 'A.5.1'} | [Control name] | Yes | Required by risk assessment outcome | Implemented | [Doc ref] |
| | | | | | |

*(Complete for all ${meta.frameworkName} controls)*`;
  } else if (name.includes('kpi') || name.includes('metric') || name.includes('performance')) {
    findingsSection = `## 5. Performance Metrics

### KPI Dashboard — [Reporting Period]

| KPI | Target | Actual | Trend | Status |
|-----|--------|--------|-------|--------|
| Security incidents (P1/P2) | 0 per quarter | | | |
| Mean time to detect (MTTD) | < 24 hours | | | |
| Mean time to respond (MTTR) | < 4 hours (P1) | | | |
| Patch compliance (critical) | 100% within 72h | | | |
| Security training completion | ≥ 95% | | | |
| Access review completion | 100% on schedule | | | |
| Risk register reviewed | Quarterly | | | |
| Policy exceptions open | < 5 | | | |

### Key Findings
[Narrative on areas performing well and areas requiring attention.]

### Recommendations
[Action items for the next period.]`;
  } else {
    findingsSection = `## 5. Findings & Analysis

### Summary of Findings

| # | Area | Finding | Risk Level | Recommendation |
|---|------|---------|-----------|----------------|
| 1 | [Area] | [Finding description] | High / Medium / Low | [Action] |

### Detailed Analysis

[Provide detailed narrative analysis for each finding or metric area.]

### Positive Observations

[Document areas of good practice identified during the assessment.]`;
  }

  return `${docHeader(meta, 'Restricted')}
## 1. Executive Summary

This report presents the findings of the **${meta.name}** for **${meta.frameworkName}**${meta.controlRef ? ` (${meta.controlRef})` : ''}.

**Assessment Period:** [From] – [To]
**Conducted By:** [Name / Team]
**Report Date:** ${today()}

### Key Outcomes
- [Headline finding 1]
- [Headline finding 2]
- [Headline finding 3]

### Overall Rating
**[Satisfactory / Requires Improvement / Critical]**

---

## 2. Scope & Objectives

**Scope:** [Systems, processes, locations, or timeframes covered]
**Objectives:**
1. Assess compliance with ${meta.frameworkName}${meta.controlRef ? ` ${meta.controlRef}` : ''}
2. Identify gaps, nonconformities, and improvement opportunities
3. Provide recommendations to management

**Out of Scope:** [Exclusions]

---

## 3. Methodology

| Method | Description |
|--------|-------------|
| Document Review | Review of policies, procedures, and records |
| Interviews | Conducted with key process owners |
| Technical Testing | [Where applicable] |
| Observation | Direct observation of processes |

---

## 4. Context & Background

${meta.description || `This report was produced as part of the ${meta.frameworkName} compliance programme, specifically addressing the requirements of ${meta.controlRef || 'the relevant framework controls'}.`}

---

${findingsSection}

---

## 6. Recommendations

| Priority | Recommendation | Owner | Target Date |
|----------|---------------|-------|------------|
| High | [Action] | | |
| Medium | [Action] | | |
| Low | [Action] | | |

---

## 7. Conclusion

[Provide an overall conclusion on compliance status, key risks, and next steps.]

---

## 8. Distribution

| Recipient | Role | Date Shared |
|-----------|------|------------|
| [Name] | [Role] | |

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence Template
// ─────────────────────────────────────────────────────────────────────────────

function buildEvidenceTemplate(meta: ArtifactMeta): string {
  return `${docHeader(meta, 'Confidential')}
## 1. Purpose

This evidence pack documents compliance evidence for **${meta.name}** in support of the **${meta.frameworkName}** programme${meta.controlRef ? `, specifically ${meta.controlRef}` : ''}.

${meta.description ? `**Context:** ${meta.description}` : ''}

---

## 2. Evidence Summary

| Field | Detail |
|-------|--------|
| Evidence Pack ID | ${meta.artifactId}-EVID-${today().replace(/-/g, '')} |
| Framework | ${meta.frameworkName} |
| Control Reference | ${meta.controlRef || 'N/A'} |
| Collection Period | [From] – [To] |
| Collected By | [Name / Role] |
| Collection Date | ${today()} |
| Storage Location | [DMS path / folder] |

---

## 3. Evidence Items

| # | Evidence Type | Description | Source | Date | File Reference | Notes |
|---|--------------|-------------|--------|------|----------------|-------|
| 1 | [Policy/Screenshot/Log/Report] | [Description] | [System/Person] | | | |
| 2 | | | | | | |
| 3 | | | | | | |

---

## 4. Evidence Assessment

| Control Requirement | Evidence Provided | Coverage | Gaps |
|--------------------|------------------|---------|------|
| ${meta.controlRef || '[Requirement]'}: ${meta.description || '[Description]'} | [Evidence item references] | Full / Partial | [Gap if any] |

---

## 5. Chain of Custody

| Step | Action | Performed By | Date | Notes |
|------|--------|-------------|------|-------|
| 1 | Evidence collected | | | |
| 2 | Reviewed for completeness | | | |
| 3 | Uploaded to secure store | | | |
| 4 | Shared with auditor | | | |

---

## 6. Certification / Sign-Off

I confirm that the evidence listed in this pack is accurate, complete, and fairly represents the state of controls as at the collection date.

**Signed:** _______________________ **Date:** _______________________
**Name / Role:** _______________________________________________

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Record/Log Template
// ─────────────────────────────────────────────────────────────────────────────

function buildRecordLogTemplate(meta: ArtifactMeta): string {
  const name = meta.name.toLowerCase();
  let logFields = '';

  if (name.includes('training') || name.includes('competence')) {
    logFields = `## 4. Log Fields & Sample Entry

| Employee ID | Employee Name | Role | Training Title | Training Type | Delivery Method | Date Completed | Pass/Fail | Score | Trainer | Certificate Reference | Next Due |
|-------------|--------------|------|---------------|--------------|-----------------|----------------|-----------|-------|---------|----------------------|---------|
| EMP-001 | [Name] | [Role] | ${meta.frameworkName} Awareness | Mandatory | e-Learning | ${today()} | Pass | 92% | [Trainer] | CERT-001 | ${new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0]} |`;
  } else if (name.includes('access review')) {
    logFields = `## 4. Log Fields & Sample Entry

| Review ID | System / Application | Review Period | Reviewer | Date Completed | Accounts Reviewed | Accounts Removed | Accounts Modified | Privileged Accounts | Findings | Sign-Off |
|-----------|---------------------|--------------|----------|---------------|-------------------|-----------------|-------------------|--------------------|---------| ---------|
| AR-001 | [System] | Q1 ${new Date().getFullYear()} | [Reviewer] | ${today()} | 150 | 3 | 5 | 12 | No anomalies | [CISO] |`;
  } else if (name.includes('backup')) {
    logFields = `## 4. Log Fields & Sample Entry

| Backup ID | System | Backup Type | Start Time | End Time | Duration | Data Size | Success/Fail | Location | Retention Period | Restore Test Date | Restore Test Result | Notes |
|-----------|--------|------------|-----------|---------|---------|-----------|-------------|---------|-----------------|-------------------|--------------------| ------|
| BKP-001 | [System] | Full | ${today()} 02:00 | ${today()} 03:15 | 75 min | 250 GB | Success | [Backup store] | 30 days | | | |`;
  } else if (name.includes('change')) {
    logFields = `## 4. Log Fields & Sample Entry

| Change ID | Change Title | Category | Priority | Requestor | Date Requested | Description | Business Justification | Risk Assessment | Approved By | Approval Date | Implementation Date | Post-Impl Review | Status |
|-----------|-------------|---------|---------|---------|---------------|-------------|----------------------|----------------|------------|--------------|--------------------|-----------------| ------|
| CHG-001 | [Title] | Standard | Medium | [Requestor] | ${today()} | [Description] | [Justification] | Low | [CAB/Approver] | | | | Approved |`;
  } else if (name.includes('management review')) {
    logFields = `## 4. Meeting Record

**Meeting:** ${meta.name}
**Date:** ${today()}
**Attendees:** [List of attendees]
**Chair:** [Chair name/role]

### Agenda & Minutes

| Item | Discussion | Decision / Action | Owner | Due Date |
|------|-----------|-------------------|-------|---------|
| 1. Review of previous actions | | | | |
| 2. Internal/external audit results | | | | |
| 3. Security incidents and incidents | | | | |
| 4. Risk register review | | | | |
| 5. Resource adequacy | | | | |
| 6. ISMS performance metrics | | | | |
| 7. Opportunities for improvement | | | | |

**Minutes Approved By:** _______________________ **Date:** _______________________`;
  } else {
    logFields = `## 4. Log Fields & Sample Entry

| ID | Date | Description | Performed By | System / Asset | Outcome | Reference | Notes |
|----|------|-------------|-------------|----------------|---------|-----------|-------|
| LOG-001 | ${today()} | [Entry description] | [Name/Role] | [System] | [Outcome] | [Reference] | |`;
  }

  return `${docHeader(meta)}
## 1. Purpose

This record/log provides an auditable trail of **${meta.name.toLowerCase()}** activities, supporting compliance with **${meta.frameworkName}**${meta.controlRef ? ` (${meta.controlRef})` : ''}.

${meta.description ? `**Context:** ${meta.description}` : ''}

---

## 2. Retention & Storage

| Field | Detail |
|-------|--------|
| Record Owner | ${meta.owner || '[Assign owner]'} |
| Retention Period | [Per Records Retention Schedule — e.g., 3 years] |
| Storage Location | [DMS / SIEM / SharePoint / etc.] |
| Access Control | Restricted — [authorised roles only] |
| Format | This document + [system log export, where applicable] |

---

## 3. Maintenance Instructions

- Entries must be added promptly after each relevant event.
- Do not alter or delete existing entries; add amendment notes instead.
- The record must be reviewed by the record owner at [frequency].
- Records are subject to internal and external audit review.

---

${logFields}

---

## 5. Quality Checks

| Check | Frequency | Performed By | Date Last Checked |
|-------|-----------|-------------|-------------------|
| Completeness review | Monthly | Record Owner | |
| Accuracy spot-check | Quarterly | Internal Auditor | |
| Retention compliance | Annual | Compliance Team | |

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Form/Template Template
// ─────────────────────────────────────────────────────────────────────────────

function buildFormTemplate(meta: ArtifactMeta): string {
  return `${docHeader(meta)}
## 1. Instructions for Use

This template is provided to support consistent delivery of **${meta.name.toLowerCase()}** activities in alignment with **${meta.frameworkName}**${meta.controlRef ? ` (${meta.controlRef})` : ''}.

${meta.description ? `**Context:** ${meta.description}` : ''}

Complete all sections. Mark fields N/A only where the section is genuinely not applicable, with a brief justification.

---

## 2. Identification

| Field | Value |
|-------|-------|
| Reference # | |
| Date | |
| Completed By | |
| Role | |
| Department / Team | |
| Reviewed By | |

---

## 3. Section A — [Primary Information]

| # | Question / Field | Response |
|---|-----------------|---------|
| 1 | [Question or field label] | |
| 2 | [Question or field label] | |
| 3 | [Question or field label] | |
| 4 | [Question or field label] | |

---

## 4. Section B — [Assessment / Checklist]

| # | Criterion | Yes | No | N/A | Notes |
|---|-----------|-----|-----|-----|-------|
| 1 | [Criterion] | ☐ | ☐ | ☐ | |
| 2 | [Criterion] | ☐ | ☐ | ☐ | |
| 3 | [Criterion] | ☐ | ☐ | ☐ | |
| 4 | [Criterion] | ☐ | ☐ | ☐ | |

---

## 5. Section C — [Actions / Decisions]

| Action Required | Owner | Due Date | Priority | Status |
|----------------|-------|---------|----------|--------|
| | | | | |

---

## 6. Declaration & Sign-Off

By signing below, I confirm that this ${meta.name.toLowerCase()} has been completed accurately and in accordance with ${meta.frameworkName}${meta.controlRef ? ` (${meta.controlRef})` : ''}.

**Completed By:** _______________________
**Signature:** _________________________ **Date:** _______________

**Reviewed By:** _______________________
**Signature:** _________________________ **Date:** _______________

**Approved By:** _______________________
**Signature:** _________________________ **Date:** _______________

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attestation Template
// ─────────────────────────────────────────────────────────────────────────────

function buildAttestationTemplate(meta: ArtifactMeta): string {
  return `${docHeader(meta, 'Confidential')}
## 1. Attestation Statement

We, the undersigned, on behalf of **[Organisation Legal Name]**, hereby attest and declare that:

1. The organisation has implemented and maintains an information management system in conformance with the requirements of **${meta.frameworkName}**.

2. All controls, policies, procedures, and processes required by **${meta.frameworkName}**${meta.controlRef ? ` (${meta.controlRef})` : ''} have been implemented and are operating effectively as at the attestation date.

3. The organisation has conducted the required risk assessments, internal audits, and management reviews, and has addressed identified nonconformities.

4. This attestation covers the following scope: **[Insert ISMS/system scope]**

5. This attestation is made in good faith and based on evidence available at the time of signing.

---

## 2. Scope of Attestation

| Field | Detail |
|-------|--------|
| Organisation | [Legal entity name] |
| Registered Address | [Address] |
| Attestation Date | ${today()} |
| Period Covered | [From] – [To] |
| Framework | ${meta.frameworkName} |
| Scope | [ISMS / system / process scope] |
| Certification Body (if applicable) | [Certifying body name] |
| Certificate Number (if applicable) | [Number] |
| Certificate Validity | [Valid from] – [Valid to] |

---

## 3. Evidence Summary

The following key evidence supports this attestation:

| Evidence Type | Reference | Date |
|--------------|-----------|------|
| Risk Assessment | | |
| Statement of Applicability | | |
| Internal Audit Report | | |
| Management Review Minutes | | |
| External Audit Report (if applicable) | | |

---

## 4. Declarations

**Chief Executive Officer / Senior Responsible Owner**

Name: ___________________________________
Title: ____________________________________
Signature: ________________________________
Date: ____________________________________

**Chief Information Security Officer / Compliance Lead**

Name: ___________________________________
Title: ____________________________________
Signature: ________________________________
Date: ____________________________________

---

## 5. Certification (if externally certified)

*[To be completed by the accredited certification body]*

Certification Body: ___________________________________
Auditor Name: ___________________________________
Signature: ________________________________
Date of Issue: ____________________________________
Certificate Number: ____________________________________

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration / Hardening Template
// Used for technical baseline documents — system hardening guides, secure
// configuration standards, build manifests. Skips the generic "Purpose"
// lead; opens with system identification + baseline tables so it doesn't
// read like a policy.
// ─────────────────────────────────────────────────────────────────────────────

function buildConfigurationTemplate(meta: ArtifactMeta): string {
  const name = meta.name.toLowerCase();

  let baselineTable = '';
  if (name.includes('firewall') || name.includes('network')) {
    baselineTable = `### 2.2 Network / Firewall Baseline

| Setting | Required Value | Rationale |
|---|---|---|
| Default inbound policy | DENY | Implicit deny — only documented flows permitted |
| Default outbound policy | DENY (logged) | Block known C2 / exfil paths |
| Stateful inspection | ON | Required for return-traffic correlation |
| Logging level | INFO + DENY events | Feeds SIEM correlation rules |
| Management plane | Out-of-band / dedicated VRF | Prevents lateral movement |
| Default admin account | DISABLED | Replace with named accounts |
| SNMP community | Per-device random string | No "public"/"private" defaults |
| Time source | Internal NTP pool (≥2 sources) | Forensic correlation |
| Config backup | Daily, off-device, encrypted | RTO < 4h |`;
  } else if (name.includes('os') || name.includes('server') || name.includes('endpoint') || name.includes('workstation')) {
    baselineTable = `### 2.2 Operating-System Baseline

| Setting | Required Value | Rationale |
|---|---|---|
| OS version | Vendor-supported, current LTS | No EOL OS |
| Patch cadence | Critical: 7 days · High: 30 days | Closes CVE window |
| Disk encryption | FDE enabled (AES-256) | Lost/stolen device control |
| Local admin rights | Removed for standard users | Reduces blast radius |
| Endpoint protection agent | Installed, real-time on, telemetry to SIEM | Detect + respond |
| Firewall | ON, default-deny inbound | Reduces attack surface |
| USB mass storage | Blocked by policy / DLP allow-list | Prevents data exfil |
| Screen lock | ≤ 15 min inactivity | Tailgating defence |
| Boot integrity (Secure Boot / Measured Boot) | Enabled | Prevents pre-OS rootkits |
| Logging | Forwarding to SIEM | Detective coverage |`;
  } else if (name.includes('cloud') || name.includes('aws') || name.includes('azure') || name.includes('gcp')) {
    baselineTable = `### 2.2 Cloud Tenant Baseline

| Setting | Required Value | Rationale |
|---|---|---|
| Root / master account | MFA-required, hardware token, used only for break-glass | Most-privileged identity protection |
| Default region | Approved region(s) only | Data residency |
| Encryption at rest | KMS-managed keys with rotation | Confidentiality |
| Encryption in transit | TLS 1.2+ enforced | Eavesdropping defence |
| Logging | All API actions to audit log; immutable bucket; 1+ yr retention | Forensic / audit |
| Public storage buckets | Explicit allow-list only | Data exfil protection |
| IAM | No long-lived access keys; SSO + roles only | Credential theft defence |
| Network egress | NAT gateway / proxy; egress monitoring | C2 detection |
| Vulnerability scanning | Continuous (CSPM) | Drift detection |`;
  } else if (name.includes('database') || name.includes('db')) {
    baselineTable = `### 2.2 Database Baseline

| Setting | Required Value | Rationale |
|---|---|---|
| Authentication | Integrated / SSO (no shared accounts) | Identity provenance |
| Privileged access | Just-in-time, audited | Insider risk |
| Encryption at rest (TDE) | Enabled | Confidentiality |
| Encryption in transit (TLS) | Required, validated certs | Eavesdropping |
| Default users / sample DBs | Removed | Attack-surface reduction |
| Backup encryption | Enabled, separate key | Backup integrity |
| Audit log | All DDL + privileged DML | Compliance traceability |
| Vulnerability patches | Critical within 7 days | CVE window |`;
  } else {
    baselineTable = `### 2.2 Baseline Settings

| Setting | Required Value | Rationale |
|---|---|---|
| [Setting] | [Value] | [Why this matters] |
| [Setting] | [Value] | [Why this matters] |
| [Setting] | [Value] | [Why this matters] |
| [Setting] | [Value] | [Why this matters] |
| [Setting] | [Value] | [Why this matters] |`;
  }

  return `${docHeader(meta)}
## 1. System Identification

| Field | Value |
|---|---|
| System / Component | ${meta.name} |
| Owner | ${meta.owner || '[Assign owner]'} |
| Environment | Production / Staging / Dev / DR (delete as appropriate) |
| Hosting | On-premises / Cloud / Hybrid |
| Baseline Version | 1.0 |
| Baseline Date | ${today()} |
| Tested By | [Engineer name] |
| Approved By | [Role] |

---

## 2. Configuration Baseline

### 2.1 Source of Authority

This baseline is anchored to **${meta.frameworkName}**${meta.controlRef ? ` ${meta.controlRef}` : ''} and the vendor's hardening guide. Where the two diverge, the more restrictive setting applies.

${baselineTable}

---

## 3. Validation Evidence

For each setting above, capture **one** of:

- ✏️ Configuration export (e.g., \`show running-config\`, \`Get-MpPreference\`, IaC manifest)
- 📸 Screenshot of the management console showing the setting
- 🧪 Output of a validation command run on the live system

> Validation evidence must be dated, attributed to the engineer, and stored alongside this document. Re-capture at every change-window or at minimum annually.

### Validation Log

| Setting | Method | Evidence Reference | Captured By | Date | Result |
|---|---|---|---|---|---|
| [Setting] | Screenshot | [filename / DMS link] | | ${today()} | Pass / Fail |
| [Setting] | Config export | | | | |

---

## 4. Deviations & Exceptions

| Setting | Required | Actual | Justification | Compensating Control | Approver | Review Date |
|---|---|---|---|---|---|---|
| | | | | | | |

> Any deviation must be ticketed in the Exception Register before deployment.

---

## 5. Change Control

Configuration drift detection is performed by **[tool/owner]** every **[frequency]**. Detected drift must:

1. Be logged in the Change Register within 24 hours.
2. Be assessed for risk impact.
3. Be remediated to baseline OR formally accepted with a documented exception (Section 4).

---

## 6. Retirement

When the system reaches end-of-life:

- [ ] Final configuration export retained for the records-retention period
- [ ] All credentials and secrets rotated / revoked
- [ ] Data sanitised per the Data Disposal Procedure

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guidelines Template
// Advisory, recommendation-shaped doc — distinct from a Policy (mandatory).
// Opens with guiding principles rather than scope.
// ─────────────────────────────────────────────────────────────────────────────

function buildGuidelinesTemplate(meta: ArtifactMeta): string {
  return `${docHeader(meta)}
## 1. Guiding Principles

The following principles underpin every recommendation in this document. When in doubt, default to them.

1. **Least privilege** — grant the minimum access required for the task.
2. **Defence in depth** — layer controls so that no single failure exposes the asset.
3. **Fail safely** — when a control fails, the system should reach a more secure state.
4. **Document the why** — every deviation needs a recorded rationale.
5. **Validate, don't assume** — control existence is not control effectiveness.

---

## 2. When This Applies

These guidelines should be consulted whenever you are:

- Designing, building or modifying systems in the scope of **${meta.frameworkName}**${meta.controlRef ? ` ${meta.controlRef}` : ''}.
- Procuring third-party services that process organisational data.
- Reviewing exceptions to standing policies.
- Onboarding a new team or supplier.

${meta.description ? `**Context:** ${meta.description}\n` : ''}
---

## 3. Recommendations

### 3.1 Strongly Recommended (Do)

- ✅ [Concrete recommendation that should normally be followed]
- ✅ [Concrete recommendation]
- ✅ [Concrete recommendation]
- ✅ [Concrete recommendation]

### 3.2 Avoid (Don't)

- ❌ [Practice to avoid, with the risk it creates]
- ❌ [Practice to avoid, with the risk it creates]
- ❌ [Practice to avoid, with the risk it creates]

### 3.3 Use Judgement (It Depends)

- ⚖️ [Practice that's situational — note the deciding factors]
- ⚖️ [Practice that's situational — note the deciding factors]

---

## 4. Worked Examples

### Example A — [Common scenario]

**Situation:** [Describe a typical situation]

**Recommended approach:** [What to do]

**Why:** [The reasoning, including which principle in §1 it supports]

### Example B — [Edge case]

**Situation:** [Describe an edge case]

**Recommended approach:** [What to do, including any specific carve-outs]

**Why:** [The reasoning]

---

## 5. Deviating from These Guidelines

These are guidelines, not policy — but deviation should still be deliberate.

| Step | Action |
|---|---|
| 1 | Document the reason in writing |
| 2 | Identify compensating controls |
| 3 | Time-box the deviation (max 12 months) |
| 4 | Notify the document owner |
| 5 | Track to closure in the Exception Register |

---

## 6. References

| Document | Type | Why |
|---|---|---|
| [Related policy] | Policy | Sets the mandatory baseline |
| ${meta.frameworkName} ${meta.controlRef || ''} | Standard | Authoritative source |
| [Related procedure] | Procedure | Step-by-step execution |

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Standard Template
// Technical / operational standard — what's mandatory at a technology level.
// More prescriptive than Guidelines, narrower than a Policy.
// ─────────────────────────────────────────────────────────────────────────────

function buildStandardTemplate(meta: ArtifactMeta): string {
  return `${docHeader(meta)}
## 1. Statement

This standard defines the **mandatory** technical requirements for **${meta.name.toLowerCase()}** within the scope of **${meta.frameworkName}**${meta.controlRef ? ` (${meta.controlRef})` : ''}.

Compliance with this standard is not optional. Any deviation requires documented exception approval (Section 5).

${meta.description ? `**Context:** ${meta.description}\n` : ''}
---

## 2. Mandatory Requirements

| # | Requirement | Verification Method |
|---|---|---|
| R-01 | [Specific, measurable requirement] | Automated scan / Manual check / Code review |
| R-02 | [Specific, measurable requirement] | |
| R-03 | [Specific, measurable requirement] | |
| R-04 | [Specific, measurable requirement] | |
| R-05 | [Specific, measurable requirement] | |

---

## 3. Approved & Restricted

### 3.1 Approved

| Item | Version / Tier | Notes |
|---|---|---|
| [Technology / product] | [Version constraint] | [Approval reference] |
| [Technology / product] | | |

### 3.2 Restricted (do not deploy without exception)

| Item | Reason | Last Reviewed |
|---|---|---|
| [Technology / product] | [Risk / EOL / regulatory] | |
| [Technology / product] | | |

### 3.3 Prohibited

| Item | Reason | Remediation Path |
|---|---|---|
| [Technology / product] | [Reason — e.g. unsupported, known compromise] | Migrate to [alternative] by [date] |

---

## 4. Compliance Verification

| Verification | Frequency | Owner | Evidence Type |
|---|---|---|---|
| Automated scan against this standard | Daily | [Tool / Team] | Scan report |
| Sample audit | Quarterly | Internal Audit | Audit working paper |
| Self-attestation | Annual | System owners | Signed attestation |

---

## 5. Exceptions

Exceptions to this standard must be:

- Logged in the Exception Register before deployment
- Risk-assessed (likelihood × impact, with compensating controls)
- Time-limited (max **12 months**, renewable)
- Approved by **[Approver role]**

| Exception ID | Requirement | Justification | Compensating Control | Expiry | Approver |
|---|---|---|---|---|---|
| | | | | | |

---

## 6. Related Documents

| Document | Type | Relationship |
|---|---|---|
| [Parent policy] | Policy | Mandates this standard |
| [Implementation procedure] | Procedure | How to apply the standard |
| ${meta.frameworkName} ${meta.controlRef || ''} | Framework | Source of the requirement |

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrix Template
// RACI / risk / coverage matrices. Mostly table content, very little prose.
// ─────────────────────────────────────────────────────────────────────────────

function buildMatrixTemplate(meta: ArtifactMeta): string {
  const name = meta.name.toLowerCase();
  let matrixBody = '';

  if (name.includes('raci') || name.includes('responsibility')) {
    matrixBody = `## 4. RACI Matrix

**Legend:** R = Responsible · A = Accountable · C = Consulted · I = Informed

| Activity / Decision | Process Owner | Operations | Security | Risk | Compliance | Legal | Senior Mgmt |
|---|---|---|---|---|---|---|---|
| Define requirement | A | R | C | C | C | C | I |
| Implement control | C | R | A | C | I | I | I |
| Operate control | C | A/R | C | I | I | I | I |
| Monitor & report | C | R | A | C | I | I | I |
| Escalate exception | I | R | C | A | C | C | I |
| Sign-off audit findings | C | C | C | C | R | C | A |
| Review annually | C | R | A | C | C | I | I |`;
  } else if (name.includes('control') || name.includes('mapping') || name.includes('coverage')) {
    matrixBody = `## 4. Control Mapping Matrix

| ${meta.frameworkName} Ref | Control Title | Implementing Control(s) | Document Reference | Status | Owner |
|---|---|---|---|---|---|
| ${meta.controlRef || 'A.x.y'} | [Control name] | [Internal control name(s)] | [Policy/Procedure ID] | Implemented | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |

### Coverage Summary

| Status | Count | % |
|---|---|---|
| Implemented | | |
| Partially Implemented | | |
| Planned | | |
| Not Applicable | | |
| **Total** | | 100% |`;
  } else if (name.includes('risk')) {
    matrixBody = `## 4. Risk Matrix

| | **Impact 1 (Negligible)** | **Impact 2 (Minor)** | **Impact 3 (Moderate)** | **Impact 4 (Major)** | **Impact 5 (Critical)** |
|---|---|---|---|---|---|
| **Likelihood 5 (Almost Certain)** | 5 – Medium | 10 – High | 15 – Critical | 20 – Critical | 25 – Critical |
| **Likelihood 4 (Likely)** | 4 – Low | 8 – Medium | 12 – High | 16 – Critical | 20 – Critical |
| **Likelihood 3 (Possible)** | 3 – Low | 6 – Medium | 9 – High | 12 – High | 15 – Critical |
| **Likelihood 2 (Unlikely)** | 2 – Low | 4 – Low | 6 – Medium | 8 – Medium | 10 – High |
| **Likelihood 1 (Rare)** | 1 – Low | 2 – Low | 3 – Low | 4 – Low | 5 – Medium |

### Acceptance Thresholds

| Band | Score Range | Treatment |
|---|---|---|
| Low | 1 – 4 | Accept with monitoring |
| Medium | 5 – 9 | Mitigate or accept with risk-owner sign-off |
| High | 10 – 14 | Mitigate; escalate to CISO |
| Critical | 15 – 25 | Mitigate immediately; executive sign-off required |`;
  } else {
    matrixBody = `## 4. Matrix Content

| Row Dimension | Col A | Col B | Col C | Col D | Col E |
|---|---|---|---|---|---|
| [Row 1] | | | | | |
| [Row 2] | | | | | |
| [Row 3] | | | | | |
| [Row 4] | | | | | |
| [Row 5] | | | | | |

### Legend

| Value | Meaning |
|---|---|
| | |
| | |`;
  }

  return `${docHeader(meta)}
## 1. Overview

This matrix consolidates **${meta.name.toLowerCase()}** information in a single view, supporting **${meta.frameworkName}**${meta.controlRef ? ` ${meta.controlRef}` : ''} oversight.

${meta.description ? `**Context:** ${meta.description}\n` : ''}
---

## 2. How to Read

- Each row represents [row dimension — e.g., a control, a process, an activity].
- Each column represents [column dimension — e.g., a role, a status, a framework].
- A cell value indicates [meaning of the intersection].
- Empty cells mean [meaning of an empty cell — e.g., not applicable, not yet assessed].

---

## 3. Maintenance

| Field | Detail |
|---|---|
| Matrix Owner | ${meta.owner || '[Owner]'} |
| Update Trigger | New control / role / process change · Quarterly review |
| Review Frequency | Quarterly |
| Storage | [DMS path] |

---

${matrixBody}

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot / Visual Evidence Template
// ─────────────────────────────────────────────────────────────────────────────

function buildScreenshotTemplate(meta: ArtifactMeta): string {
  return `${docHeader(meta, 'Confidential')}
## 1. Capture Context

| Field | Value |
|---|---|
| Evidence Title | ${meta.name} |
| What this proves | ${meta.description || `Compliance with ${meta.frameworkName}${meta.controlRef ? ` ${meta.controlRef}` : ''}`} |
| System / Application | [System name + version] |
| Environment | Production / Staging / DR |
| Capture Date | ${today()} |
| Captured By | [Name / Role] |
| Capture Method | Screenshot · Screen recording · Console output |
| Chain of Custody | Stored in [DMS path]; SHA-256 hash on file |

---

## 2. Capture Instructions (re-run if evidence is contested)

1. Log in to **[system / URL]** as **[role — never use a shared account]**.
2. Navigate to **[exact menu path]**.
3. Apply filters: **[any filter values needed to make the evidence reproducible]**.
4. Capture the full screen (not a partial crop) so the URL, user, and date/time are visible.
5. Re-name the file using the convention \`{control_ref}_{system}_{YYYYMMDD}.png\`.
6. Compute SHA-256 hash; record in the table below.

---

## 3. Evidence

> **Embed the screenshot here.** Markdown supports image embedding via \`![alt](path)\`. Use the DMS URL or attach the file to this artifact in the platform.

**Filename:** \`[control_ref]_[system]_${today().replace(/-/g, '')}.png\`
**SHA-256:** \`[paste hash here]\`

\`![${meta.name}](path/to/screenshot.png)\`

---

## 4. Annotations

| # | Region of screenshot | Observation | Why it matters |
|---|---|---|---|
| 1 | Top-right corner | Logged in as **[role]** | Confirms privileged-access path |
| 2 | URL bar | TLS padlock + correct hostname | Rules out spoofing |
| 3 | Setting panel | **[Setting] = [Value]** | Demonstrates control is active |
| 4 | Footer / status bar | Timestamp matches capture date | Anti-staleness |

---

## 5. Validation

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Screenshot is full-resolution (not cropped) | Pass / Fail | | |
| Date/time stamps visible | Pass / Fail | | |
| User identity visible | Pass / Fail | | |
| Setting under test is clearly readable | Pass / Fail | | |
| Hash on file matches stored file | Pass / Fail | | |

---

## 6. Mapping to Requirement

This evidence supports compliance with **${meta.frameworkName}${meta.controlRef ? ` ${meta.controlRef}` : ''}** by demonstrating:

- [What specific requirement element this evidence shows]
- [What gap or risk this evidence retires]

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Training Record Template
// ─────────────────────────────────────────────────────────────────────────────

function buildTrainingTemplate(meta: ArtifactMeta): string {
  return `${docHeader(meta)}
## 1. Programme Overview

| Field | Value |
|---|---|
| Training Title | ${meta.name} |
| Framework Alignment | ${meta.frameworkName}${meta.controlRef ? ` (${meta.controlRef})` : ''} |
| Target Audience | [All staff / Engineers / Managers / Privileged users / Contractors] |
| Delivery Method | In-person · e-learning · Instructor-led virtual · Blended |
| Duration | [Hours] |
| Frequency | Once on join · Annual refresh · Event-triggered |
| Provider | Internal · External (specify) |
| Pass Threshold | [e.g., ≥ 80%] |

${meta.description ? `**Purpose:** ${meta.description}\n` : ''}
---

## 2. Learning Objectives

By the end of this training, participants will be able to:

1. [Observable, testable outcome — e.g., "Identify a phishing email by recognising sender-domain spoofing"]
2. [Observable, testable outcome]
3. [Observable, testable outcome]
4. [Observable, testable outcome]

---

## 3. Module Content

| # | Module | Duration | Key Topics | Assessment Item |
|---|---|---|---|---|
| 1 | [Module title] | [min] | [Topics covered] | Quiz Q1 – Q5 |
| 2 | [Module title] | [min] | | Quiz Q6 – Q10 |
| 3 | [Module title] | [min] | | Practical exercise |

---

## 4. Attendance & Completion Register

| # | Employee ID | Name | Role | Department | Start Date | Completion Date | Score | Pass/Fail | Certificate # | Next Due |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | EMP-001 | [Name] | [Role] | [Dept] | ${today()} | ${today()} | [%] | Pass | CERT-YYYY-NNNN | ${new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0]} |
| 2 | | | | | | | | | | |
| 3 | | | | | | | | | | |

---

## 5. Completion Summary

| Metric | Target | Actual |
|---|---|---|
| In-scope population | — | |
| Completed | ≥ 95% | |
| Passed first attempt | ≥ 90% | |
| Re-takes required | — | |
| Outstanding (overdue) | 0 | |

---

## 6. Effectiveness Review

| Indicator | Method | Observed Trend |
|---|---|---|
| Phishing-simulation click rate | Monthly campaign | [Trend up / down] |
| Incident reports from trained staff | Incident register | [Trend up / down] |
| Audit findings related to awareness | Internal audit | [Trend up / down] |

---

## 7. Records Retention

- Attendance roster, scores and certificates retained for **[period — e.g., 7 years]** per the Records Retention Schedule.
- Stored in **[DMS path / HR system]**; access restricted to HR + Compliance.

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract / Agreement Template
// ─────────────────────────────────────────────────────────────────────────────

function buildContractTemplate(meta: ArtifactMeta): string {
  return `${docHeader(meta, 'Confidential')}
## 1. Agreement Identification

| Field | Value |
|---|---|
| Agreement Title | ${meta.name} |
| Counterparty | [Legal entity name] |
| Counterparty Type | Supplier · Customer · Partner · Processor · Sub-processor |
| Internal Owner | ${meta.owner || '[Business owner]'} |
| Legal Owner | [Legal team contact] |
| Procurement Reference | [PO / contract ID] |
| Framework Driver | ${meta.frameworkName}${meta.controlRef ? ` (${meta.controlRef})` : ''} |

${meta.description ? `**Purpose:** ${meta.description}\n` : ''}
---

## 2. Term & Renewal

| Date Field | Value |
|---|---|
| Signature Date | |
| Effective Date | |
| Initial Term End | |
| Renewal Type | Auto-renew · Manual renew · Fixed term |
| Renewal Notice Period | [days] |
| Next Review Date | |

---

## 3. Security & Compliance Obligations

The following obligations are **mandatory** under this agreement and tie back to **${meta.frameworkName}**${meta.controlRef ? ` ${meta.controlRef}` : ''}:

| # | Obligation | Counterparty Commitment | Evidence Required | Review Cadence |
|---|---|---|---|---|
| 1 | Information security baseline | [e.g., ISO 27001 cert · SOC 2 Type II] | Annual cert / report | Annual |
| 2 | Data handling | Process data only per documented purpose | DPA executed | Annual |
| 3 | Sub-processor management | Maintain list + prior approval for changes | Updated list | Per change |
| 4 | Incident notification | ≤ 24h for confirmed incidents impacting our data | Notification log | Per incident |
| 5 | Right to audit | Pre-arranged audit + on-incident audit | Audit report | On request |
| 6 | Data return / destruction at termination | Verified destruction certificate | Destruction cert | At termination |

---

## 4. Service Levels (where applicable)

| Metric | Target | Penalty / Remedy |
|---|---|---|
| Availability | [e.g., 99.9%] | [Service credit / SLA breach process] |
| Incident response | [Time] | |
| Support response | [P1 / P2 / P3 times] | |

---

## 5. Key Contacts

| Role | Name | Email | Phone |
|---|---|---|---|
| Counterparty primary | | | |
| Counterparty security | | | |
| Counterparty escalation | | | |
| Internal owner | | | |
| Internal legal | | | |

---

## 6. Risk Assessment Outcome

| Field | Value |
|---|---|
| Vendor Risk Tier | Critical · High · Medium · Low |
| Due-Diligence Date | |
| Outstanding Findings | [Reference] |
| Required Mitigations | [List] |

---

## 7. Termination Conditions

- **For convenience:** [notice period]
- **For cause:** [breach types — security incident, insolvency, regulatory action]
- **Exit obligations:** Data return / destruction within [days]; cooperation with transition.

---

## 8. Records & Storage

| Field | Detail |
|---|---|
| Executed copy | [DMS path — restricted to Legal + Procurement + Owner] |
| Retention Period | [Per Records Retention Schedule — typically term + 7 years] |

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assessment Template (SoA, audit findings, control assessment, etc.)
// ─────────────────────────────────────────────────────────────────────────────

function buildAssessmentTemplate(meta: ArtifactMeta): string {
  const name = meta.name.toLowerCase();

  let bodySection = '';
  if (name.includes('vendor') || name.includes('supplier') || name.includes('third-party') || name.includes('third party')) {
    bodySection = `## 4. Vendor / Third-Party Findings

| Domain | Question | Vendor Response | Evidence Reviewed | Risk Rating | Action |
|---|---|---|---|---|---|
| Information Security | Holds ISO 27001 / SOC 2? | | Cert / report | Low / Med / High | |
| Data Protection | Processes personal data? | | DPA, sub-processor list | | |
| Business Continuity | Tested BCP/DR within 12 months? | | Test report | | |
| Incident Management | 24h breach-notification commitment? | | Contract clause | | |
| Encryption | Data at rest + in transit encrypted? | | Tech docs | | |
| Access Control | MFA + RBAC enforced? | | Policy / screenshot | | |
| Sub-Processors | List provided & approved? | | List | | |
| Right to Audit | Granted in contract? | | Contract | | |

### Risk Tier Decision

| Field | Value |
|---|---|
| Inherent Risk | [Tier based on data sensitivity × access scope] |
| Residual Risk | [Tier after controls] |
| Approved By | |
| Next Reassessment | |`;
  } else if (name.includes('privacy') || name.includes('dpia') || name.includes('data protection impact')) {
    bodySection = `## 4. Privacy Impact Assessment

### 4.1 Processing Description

| Field | Value |
|---|---|
| Purpose | |
| Lawful basis | Consent · Contract · Legal obligation · Vital interests · Public task · Legitimate interests |
| Data categories | [Personal · Special · Children · Financial · Health · etc.] |
| Volume (subjects) | |
| Retention period | |
| Cross-border transfer | Yes / No (mechanism) |

### 4.2 Necessity & Proportionality

[Why the processing is necessary, and why it cannot be achieved with less data.]

### 4.3 Risks to Data Subjects

| # | Risk | Likelihood | Severity | Mitigations | Residual |
|---|---|---|---|---|---|
| 1 | [e.g., unauthorised disclosure] | | | | |
| 2 | | | | | |

### 4.4 Outcome

| Field | Value |
|---|---|
| Recommendation | Proceed · Proceed with mitigations · Do not proceed |
| DPO consulted | Yes / No (date) |
| Supervisory authority consultation required | Yes / No |`;
  } else if (name.includes('soa') || name.includes('statement of applicability')) {
    bodySection = `## 4. Statement of Applicability

### 4.1 Summary

| Status | Count | % of Total |
|---|---|---|
| Applicable & Implemented | | |
| Applicable & Planned | | |
| Not Applicable (with justification) | | |
| **Total Controls** | | 100% |

### 4.2 Control Listing

| Control Ref | Control Title | Applicable? | Justification (if N/A) | Implementation Status | Evidence Reference |
|---|---|---|---|---|---|
| ${meta.controlRef || 'A.5.1'} | [Control] | Yes | — | Implemented | [Doc ID] |
| | | | | | |
| | | | | | |

*(Repeat for every control in **${meta.frameworkName}**)*`;
  } else {
    bodySection = `## 4. Assessment Findings

### 4.1 Methodology

| Method | Description |
|---|---|
| Document Review | [What was inspected] |
| Interviews | [Who was spoken to, key questions] |
| Technical Testing | [Scans / probes / config reviews performed] |
| Observation | [What was observed in operation] |

### 4.2 Findings

| Finding ID | Requirement | Observed State | Gap | Severity | Recommended Action | Owner | Due |
|---|---|---|---|---|---|---|---|
| F-01 | ${meta.controlRef || '[Ref]'} | [What was found] | [Delta from requirement] | Major · Minor · OFI | [Action] | | |
| F-02 | | | | | | | |

### 4.3 Maturity Rating

| Level | Definition | This Assessment |
|---|---|---|
| 1 – Non-Existent | No control in place | |
| 2 – Initial | Ad hoc, undocumented | |
| 3 – Defined | Documented, not consistently followed | |
| 4 – Managed | Implemented and monitored | |
| 5 – Optimised | Continually improved | |

**Overall Rating:** \`[X.X / 5.0]\``;
  }

  return `${docHeader(meta, 'Restricted')}
## 1. Assessment Identification

| Field | Value |
|---|---|
| Assessment | ${meta.name} |
| Framework | ${meta.frameworkName}${meta.controlRef ? ` (${meta.controlRef})` : ''} |
| Assessor | [Name / Role / Org] |
| Independence | Internal · External · Self |
| Assessment Period | [From] – [To] |
| Issue Date | ${today()} |
| Distribution | [Audience] |

${meta.description ? `**Context:** ${meta.description}\n` : ''}
---

## 2. Scope

**In Scope:**
- [Systems / locations / processes covered]

**Out of Scope:**
- [Explicit exclusions with justification]

---

## 3. Executive Summary

[Three to five sentences: what was assessed, what was found, what's next.]

### Key Conclusions

1. [Top finding or affirmation]
2. [Second-priority finding]
3. [Third priority]

---

${bodySection}

---

## 5. Recommendations

| Priority | Recommendation | Owner | Target Date | Linked Finding(s) |
|---|---|---|---|---|
| High | | | | F-01 |
| Medium | | | | |
| Low | | | | |

---

## 6. Sign-Off

| Role | Name | Signature | Date |
|---|---|---|---|
| Assessor | | | |
| Reviewer | | | |
| Owner | | | |

---

${reviewTable()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main dispatch function — case-insensitive with synonym handling.
// Anything we don't recognise falls back to the structured Evidence template
// (a generic-but-useful frame) rather than the policy template, which was
// the source of the "everything looks like a policy" complaint.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeArtifactType(raw: string): string {
  const k = (raw || '').toLowerCase().replace(/[_/\-\s]+/g, ' ').trim();

  // Direct hits first — fast path.
  if (k === 'policy' || k === 'policies') return 'policy';
  if (k === 'procedure' || k === 'procedures' || k === 'process' || k === 'sop') return 'procedure';
  if (k === 'register' || k === 'inventory' || k === 'log register') return 'register';
  if (k === 'plan' || k === 'roadmap' || k === 'charter') return 'plan';
  if (k === 'report' || k === 'audit report' || k === 'gap analysis') return 'report';
  if (k === 'evidence' || k === 'evidence pack') return 'evidence';
  if (k === 'record' || k === 'log' || k === 'record log' || k === 'minutes') return 'record';
  if (k === 'form' || k === 'template' || k === 'form template' || k === 'checklist') return 'form';
  if (k === 'attestation' || k === 'declaration' || k === 'certificate') return 'attestation';
  if (k === 'configuration' || k === 'config' || k === 'baseline' || k === 'hardening guide') return 'configuration';
  if (k === 'guideline' || k === 'guidelines' || k === 'guidance') return 'guidelines';
  if (k === 'standard' || k === 'technical standard') return 'standard';
  if (k === 'matrix' || k === 'raci' || k === 'mapping') return 'matrix';
  if (k === 'screenshot' || k === 'screen capture' || k === 'image' || k === 'observation') return 'screenshot';
  if (k === 'training' || k === 'training record' || k === 'awareness record' || k === 'competence record') return 'training';
  if (k === 'contract' || k === 'agreement' || k === 'dpa' || k === 'sla' || k === 'mou' || k === 'nda') return 'contract';
  if (k === 'assessment' || k === 'self assessment' || k === 'interview' || k === 'soa' || k === 'statement of applicability') return 'assessment';

  // Substring fall-backs — broader synonyms.
  if (k.includes('policy')) return 'policy';
  if (k.includes('procedure') || k.includes('process')) return 'procedure';
  if (k.includes('register') || k.includes('inventory')) return 'register';
  if (k.includes('plan')) return 'plan';
  if (k.includes('report')) return 'report';
  if (k.includes('evidence')) return 'evidence';
  if (k.includes('record') || k.includes('log') || k.includes('minutes')) return 'record';
  if (k.includes('form') || k.includes('template') || k.includes('checklist')) return 'form';
  if (k.includes('attest') || k.includes('certificate')) return 'attestation';
  if (k.includes('config') || k.includes('baseline') || k.includes('hardening')) return 'configuration';
  if (k.includes('guidelin') || k.includes('guidance')) return 'guidelines';
  if (k.includes('standard')) return 'standard';
  if (k.includes('matrix') || k.includes('raci') || k.includes('mapping')) return 'matrix';
  if (k.includes('screenshot') || k.includes('screen capture') || k.includes('image') || k.includes('observ')) return 'screenshot';
  if (k.includes('training') || k.includes('awareness') || k.includes('competence')) return 'training';
  if (k.includes('contract') || k.includes('agreement') || k.includes('dpa') || k.includes('sla')) return 'contract';
  if (k.includes('assessment') || k.includes('interview') || k.includes('soa') || k.includes('applicability')) return 'assessment';

  return 'evidence';
}

export function buildArtifactTemplate(meta: ArtifactMeta): string {
  switch (normalizeArtifactType(meta.artifactType)) {
    case 'policy':         return buildPolicyTemplate(meta);
    case 'procedure':      return buildProcedureTemplate(meta);
    case 'register':       return buildRegisterTemplate(meta);
    case 'plan':           return buildPlanTemplate(meta);
    case 'report':         return buildReportTemplate(meta);
    case 'evidence':       return buildEvidenceTemplate(meta);
    case 'record':         return buildRecordLogTemplate(meta);
    case 'form':           return buildFormTemplate(meta);
    case 'attestation':    return buildAttestationTemplate(meta);
    case 'configuration':  return buildConfigurationTemplate(meta);
    case 'guidelines':     return buildGuidelinesTemplate(meta);
    case 'standard':       return buildStandardTemplate(meta);
    case 'matrix':         return buildMatrixTemplate(meta);
    case 'screenshot':     return buildScreenshotTemplate(meta);
    case 'training':       return buildTrainingTemplate(meta);
    case 'contract':       return buildContractTemplate(meta);
    case 'assessment':     return buildAssessmentTemplate(meta);
    default:               return buildEvidenceTemplate(meta);
  }
}
