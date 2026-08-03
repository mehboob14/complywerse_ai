<!-- iso_27001_2022 / ISO27-005 | type=Report | mode=markdown | model=gpt-5.5 | 50941 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [ISMS-RPT-001] | 1.0 | [ISMS Manager / CISO] | [YYYY-MM-DD] | ISO/IEC 27001:2022 | and Annex A | Confidential |

## Purpose

This ISO 27001 Gap Analysis Report documents the current state, target state, identified gaps, risks, and recommended actions for the organisation’s implementation of an Information Security Management System (ISMS) aligned to ISO/IEC 27001:2022.

The report specifically assesses readiness against:

- **ISO/IEC 27001:2022 — Information Security Management System**, requiring the organisation to establish, implement, maintain, and continually improve an ISMS, including the processes needed and their interactions.
- **ISO/IEC 27001:2022 — Actions to Address Risks and Opportunities**, requiring the organisation to determine ISMS risks and opportunities, perform information security risk assessment and treatment, produce a Statement of Applicability, and ensure risk treatment is integrated into ISMS planning.
- **ISO/IEC 27001:2022 Annex A controls**, used as the reference control set for information security risk treatment and applicability assessment.

This report is intended to support executive decision-making, implementation planning, internal audit readiness, and certification preparation.

## Reporting Period & Scope

### Reporting Period

| Item | Detail |
|---|---|
| Assessment period | [Start Date] to [End Date] |
| Report issue date | [YYYY-MM-DD] |
| Assessment type | ISO/IEC 27001:2022 gap analysis |
| Assessment objective | Determine current vs target maturity for ISO 27001 clauses and Annex A controls |
| Intended certification target date | [Target Certification Date] |

### Organisational Scope Assessed

The assessment covered the ISMS scope currently defined or proposed by the organisation.

| Scope Element | Included in Assessment | Notes |
|---|---:|---|
| Business units | Yes | [List business units / functions] |
| Locations | Yes | [Head office, remote workforce, data centres, cloud regions, etc.] |
| Technology platforms | Yes | [Core infrastructure, SaaS platforms, cloud services, endpoints, network services] |
| Information assets | Yes | Customer data, employee data, financial data, operational data, intellectual property, security logs |
| Third-party services | Yes | Cloud service providers, managed service providers, software vendors, professional services suppliers |
| People and roles | Yes | Executive management, IT, security, HR, legal, procurement, operations, system owners |
| Processes | Yes | Risk management, access control, incident management, supplier management, change management, business continuity |
| Exclusions | [Yes/No] | [Describe any proposed exclusions and justification] |

### ISO 27001 Coverage

This report covers all mandatory ISO/IEC 27001:2022 management system clauses and all Annex A control themes.

| ISO 27001 Area | Covered | Assessment Focus |
|---|---:|---|
| — Context of the organisation | Yes | ISMS scope, interested parties, internal/external issues, ISMS process definition |
| — Leadership | Yes | Policy, leadership commitment, roles, responsibilities, governance |
| — Planning | Yes | Risk assessment, risk treatment, objectives, opportunities |
| — Support | Yes | Resources, competence, awareness, communication, documented information |
| — Operation | Yes | Operational planning, risk assessment execution, risk treatment implementation |
| — Performance evaluation | Yes | Monitoring, measurement, internal audit, management review |
| — Improvement | Yes | Nonconformity, corrective action, continual improvement |
| Annex A — Controls | Yes | Organisational, people, physical, and technological controls |

### Rating Method

Findings are rated using the following readiness scale.

| Rating | Description | Certification Readiness Implication |
|---|---|---|
| 0 — Not Implemented | No evidence of process, control, ownership, or documented approach | Significant nonconformity likely |
| 1 — Initial / Ad Hoc | Activities occur inconsistently or informally; limited repeatability | High risk of nonconformity |
| 2 — Partially Implemented | Some documented or repeatable practices exist, but coverage is incomplete | Moderate risk of nonconformity |
| 3 — Largely Implemented | Process/control is mostly defined, implemented, and evidenced | Minor gaps may remain |
| 4 — Implemented and Managed | Fully implemented, documented, measured, and consistently followed | Ready for audit, subject to evidence validation |
| 5 — Optimised | Mature, measured, continually improved, and integrated into business governance | Exceeds minimum certification expectations |

### Gap Severity Definitions

| Severity | Definition | Required Response |
|---|---|---|
| Critical | Missing or ineffective requirement likely to prevent ISO 27001 certification or expose the organisation to material information security risk | Immediate executive attention and funded remediation |
| High | Significant weakness in mandatory clause or high-risk control area; likely major audit finding if unaddressed | Formal corrective action plan required |
| Medium | Partial implementation or inconsistent evidence; likely minor audit finding or risk treatment weakness | Remediation required before certification audit |
| Low | Documentation, evidence, consistency, or optimisation issue | Address through improvement plan |
| Observation | Good-practice recommendation; not necessarily a gap against ISO requirements | Consider for continual improvement |

## Executive Summary

The organisation has initiated activities aligned to ISO/IEC 27001:2022, including foundational security practices, selected technical controls, and informal risk management activities. However, the ISMS is not yet fully established as an integrated management system as required by ****, and the risk management lifecycle does not yet fully satisfy ****, particularly in relation to documented risk assessment criteria, risk treatment planning, Statement of Applicability development, risk owner approval, and traceability between risks, controls, objectives, and evidence.

Overall readiness is assessed as:

| Area | Current Maturity | Target Maturity | Overall Status |
|---|---:|---:|---|
| ISO 27001–10 | 2.1 / 5 | 4.0 / 5 | Material gaps remain |
| ISMS establishment and process integration | 1.8 / 5 | 4.0 / 5 | High-priority remediation required |
| Risk and opportunity planning | 1.7 / 5 | 4.0 / 5 | High-priority remediation required |
| Annex A controls | 2.4 / 5 | 3.5–4.0 / 5 | Partial implementation |
| Certification readiness | Not yet ready | Ready following remediation | Estimated [X] months to readiness |

### Key Strengths

- Executive interest in formalising an ISO 27001-aligned ISMS has been established.
- Core IT and security practices exist, including identity management, endpoint protection, backup processes, and incident response activities.
- Several Annex A controls are partially implemented through existing operational procedures and technical tooling.
- The organisation has identified key systems and business processes that can form the basis of the ISMS scope.
- Informal risk discussions occur within technology and management teams.

### Key Gaps

The most significant gaps are:

1. **ISMS processes are not fully defined or integrated** 
 The organisation has not yet documented all ISMS processes, their interactions, responsibilities, inputs, outputs, performance measures, and evidence requirements as expected by.

2. **Risk methodology is incomplete** 
 A formal information security risk assessment methodology, including risk criteria, likelihood/impact scales, acceptance criteria, risk owner responsibilities, and review frequency, is not yet fully documented or approved.

3. **Risk assessment and treatment are not sufficiently evidenced** 
 Risks have not been consistently identified, analysed, evaluated, assigned to owners, or linked to risk treatment decisions.

4. **Statement of Applicability is not complete** 
 Annex A control applicability, inclusion/exclusion rationale, implementation status, and linkage to risks and treatment plans are not yet formally maintained.

5. **Information security objectives are not fully measurable** 
 Security objectives do not yet consistently include measures, owners, timelines, monitoring methods, and linkage to business and risk priorities.

6. **Documented information requires consolidation and control** 
 Policies, procedures, records, and evidence are inconsistent in format, ownership, approval, versioning, and retention.

7. **Monitoring, internal audit, and management review are immature** 
 Performance evaluation activities required by are not yet operating as a repeatable ISMS cycle.

### Overall Conclusion

The organisation is at an early-to-intermediate stage of ISO/IEC 27001:2022 implementation. Certification is achievable, but the organisation should not proceed to a certification audit until the ISMS has been formally established, risk management activities completed and evidenced, Annex A applicability confirmed, and at least one full internal audit and management review cycle completed.

## Methodology

### Assessment Approach

The gap analysis was conducted using a structured current-state assessment against ISO/IEC 27001:2022 clauses and Annex A controls. The assessment considered whether required ISMS processes and controls are:

- Defined and approved.
- Implemented in practice.
- Assigned to accountable owners.
- Supported by documented information.
- Operating consistently across the ISMS scope.
- Monitored, reviewed, and improved.
- Traceable to risks, opportunities, objectives, and control requirements.

### Evidence Sources Reviewed

| Evidence Category | Examples Reviewed |
|---|---|
| Governance documents | Policies, charters, role descriptions, committee terms of reference |
| Risk documentation | Risk registers, risk assessment templates, treatment plans, issue logs |
| Technical evidence | Access control records, vulnerability reports, configuration standards, endpoint protection dashboards |
| Operational procedures | Incident response, change management, backup, onboarding/offboarding, supplier onboarding |
| HR and people evidence | Training records, acceptable use acknowledgement, screening practices |
| Supplier evidence | Contracts, security clauses, due diligence questionnaires, service reviews |
| Physical security evidence | Access logs, visitor procedures, facility controls |
| Audit and monitoring evidence | Internal reports, management dashboards, corrective action logs |
| Business continuity evidence | Backup tests, continuity plans, disaster recovery tests |

### Stakeholders Consulted

| Function / Role | Assessment Focus |
|---|---|
| Executive management | ISMS commitment, strategic objectives, risk appetite, resourcing |
| Information security | Risk management, controls, monitoring, incidents, policies |
| IT operations | Infrastructure, access management, change, backup, logging |
| HR | Screening, onboarding, offboarding, awareness, disciplinary process |
| Legal / compliance | Regulatory requirements, contractual obligations, privacy obligations |
| Procurement / vendor management | Supplier due diligence and ongoing monitoring |
| Facilities | Physical security and environmental safeguards |
| Business process owners | Asset ownership, risk ownership, process dependencies |

### Limitations

The conclusions in this report are based on information made available during the reporting period. Where evidence was unavailable, incomplete, or not formally approved, the associated requirement was rated no higher than partially implemented. The assessment does not constitute a certification audit and does not guarantee certification outcome.

## Detailed Findings / Results (with structure)

### 1. Summary of Findings by ISO 27001 Clause

| Clause | Requirement Area | Current State | Target State | Rating | Severity |
|---|---|---|---|---:|---|
| 4.1 | Understanding the organisation and its context | Internal and external issues are informally understood but not formally documented for ISMS purposes | Documented context analysis reviewed periodically and linked to ISMS scope and risks | 2 | Medium |
| 4.2 | Interested parties and requirements | Key stakeholders are known, but requirements are not systematically captured | Register of interested parties with legal, regulatory, contractual, and business requirements | 2 | Medium |
| 4.3 | ISMS scope | Draft or informal scope exists; boundaries and exclusions need refinement | Approved ISMS scope defining locations, functions, assets, technologies, interfaces, and exclusions | 2 | High |
| 4.4 | ISMS establishment and process interaction | ISMS processes are fragmented and not fully defined as an integrated management system | Established, implemented, maintained, and continually improved ISMS with defined processes and interactions | 1–2 | High |
| 5.1 | Leadership and commitment | Management support exists, but evidence of active ISMS leadership is limited | Demonstrable leadership commitment, resourcing, direction, reviews, and integration with business processes | 2 | Medium |
| 5.2 | Information security policy | Policy exists or is in draft, but may not be fully aligned to ISO 27001:2022 | Approved policy appropriate to purpose, communicated, available, and reviewed | 2 | Medium |
| 5.3 | Roles, responsibilities, and authorities | Security responsibilities exist informally; ISMS accountability not fully assigned | Defined, communicated, and evidenced ISMS roles and authorities | 2 | High |
| 6.1.1 | Actions to address risks and opportunities | Opportunities and ISMS-level risks are not consistently identified | Formal planning for risks/opportunities affecting ISMS intended outcomes | 1 | High |
| 6.1.2 | Information security risk assessment | No fully approved risk methodology or complete risk assessment evidence | Defined criteria and repeatable assessment process producing comparable results | 1–2 | Critical |
| 6.1.3 | Information security risk treatment | Control selection and treatment decisions are not consistently linked to assessed risks | Risk treatment plan, Statement of Applicability, risk owner approval, residual risk acceptance | 1–2 | Critical |
| 6.2 | Information security objectives | Objectives are not consistently measurable or assigned | Measurable objectives with owners, timelines, monitoring, and alignment to risks | 2 | Medium |
| 6.3 | Planning of changes | ISMS change planning is informal | Controlled planning for ISMS changes, including consequences, resources, responsibilities | 2 | Medium |
| 7.1 | Resources | Resources are available but not formally mapped to ISMS needs | Resource plan aligned to ISMS implementation and operation | 2 | Medium |
| 7.2 | Competence | Some security expertise exists; competence criteria are incomplete | Competence requirements, evidence, training, and evaluation records | 2 | Medium |
| 7.3 | Awareness | Security awareness occurs but may not cover ISMS policy, roles, and consequences | Awareness programme covering policy, contribution, obligations, and nonconformity impact | 2 | Medium |
| 7.4 | Communication | Security communications are ad hoc | Communication plan defining what, when, with whom, and by whom | 2 | Low |
| 7.5 | Documented information | Documentation exists but lacks consistent control and lifecycle management | Controlled documented information with approval, versioning, access, retention, and change control | 2 | High |
| 8.1 | Operational planning and control | Operational controls exist but are inconsistently tied to risk treatment | Planned, controlled ISMS operations with evidence of outsourced process control | 2 | High |
| 8.2 | Risk assessment operation | Risk assessments are not yet performed at planned intervals or after significant changes | Risk assessment performed according to approved methodology and schedule | 1 | Critical |
| 8.3 | Risk treatment operation | Treatment plans are not tracked through completion with residual risk acceptance | Treatment plans implemented, monitored, and reviewed | 1–2 | Critical |
| 9.1 | Monitoring, measurement, analysis, evaluation | Security metrics exist but ISMS performance measures are incomplete | Defined KPIs/KRIs, measurement methods, frequency, owners, and evaluation | 2 | Medium |
| 9.2 | Internal audit | ISO 27001 internal audit programme not yet established | Risk-based audit programme covering clauses, Annex A controls, and scope | 1 | High |
| 9.3 | Management review | Management reviews occur informally but not against ISO requirements | Scheduled management review covering all required ISO inputs and outputs | 1–2 | High |
| 10.1 | Continual improvement | Improvements are ad hoc | Continual improvement process linked to findings, metrics, audits, incidents, and reviews | 2 | Medium |
| 10.2 | Nonconformity and corrective action | Corrective actions are tracked inconsistently | Formal process for nonconformity, root cause, action, effectiveness review, records | 2 | Medium |

### 2. — ISMS Process Gap Findings requires the organisation to establish, implement, maintain, and continually improve the ISMS, including the processes needed and their interactions.

| ISMS Process Area | Current State | Gap | Required Target State | Severity |
|---|---|---|---|---|
| ISMS governance | Governance responsibilities are not fully documented or approved | Lack of clear ISMS accountability and escalation path | ISMS governance model with executive sponsor, ISMS owner, control owners, risk owners, and review forums | High |
| ISMS process map | No complete process interaction map exists | Inability to demonstrate how ISMS processes operate as a system | Process map showing context, risk, objectives, controls, operations, performance evaluation, and improvement cycle | High |
| Scope management | Scope not fully supported by boundary analysis and interested party requirements | Ambiguity in certification boundaries | Approved scope statement with boundaries, dependencies, outsourced processes, and exclusions | High |
| Documented information control | Document control is inconsistent across repositories | Evidence may not be reliable, current, or auditable | Controlled document register, versioning, approvals, review cycles, access controls, and retention | High |
| ISMS performance cycle | Monitoring, internal audit, management review, and corrective actions are not yet operating as a cycle | Incomplete Plan-Do-Check-Act evidence | Operating ISMS calendar covering risk reviews, objective reviews, audits, management reviews, and improvement actions | High |
| Outsourced process control | Supplier and outsourced service controls exist but are not consistently integrated into ISMS governance | Lack of assurance over external dependencies | Supplier risk management, contractual controls, monitoring, and service review records linked to ISMS risks | Medium |

### 3. — Risk and Opportunity Planning Gap Findings requires the organisation to determine risks and opportunities relevant to the ISMS, conduct risk assessment, perform risk treatment, and retain documented information.

| Requirement | Current State | Gap | Required Target State | Severity |
|---|---|---|---|---|
| Risks and opportunities to ISMS outcomes | Risks to achieving ISMS outcomes are not formally recorded | ISMS planning does not fully address intended outcomes, unwanted effects, or continual improvement | ISMS-level risks and opportunities register with actions, owners, and review dates | High |
| Risk assessment criteria | Criteria are incomplete or informal | Risk results may be inconsistent and not comparable | Approved criteria for likelihood, impact, risk levels, acceptance thresholds, and treatment triggers | Critical |
| Risk assessment process | Risk assessment is not consistently performed across assets, processes, and threats | Incomplete view of information security risk | Repeatable process for identifying, analysing, evaluating, and recording risks | Critical |
| Risk owner assignment | Risk ownership is inconsistent | Residual risk may not be accepted by accountable business owners | Named risk owners for each risk and documented risk acceptance authority | High |
| Risk treatment options | Treatment decisions are not consistently documented | No audit trail for accepting, avoiding, modifying, or sharing risks | Treatment option recorded for each unacceptable risk | High |
| Annex A control selection | Controls are not consistently selected based on risk assessment | Weak traceability from risk to control | Annex A controls evaluated and selected as treatment options where applicable | Critical |
| Statement of Applicability | SoA incomplete or absent | Mandatory ISO evidence missing | Approved SoA showing applicability, justification, implementation status, and exclusion rationale | Critical |
| Risk treatment plan | Treatment activities are not consolidated into a managed plan | Remediation cannot be tracked effectively | Risk treatment plan with owners, actions, dates, resources, and residual risk approval | Critical |
| Residual risk acceptance | Residual risks are not formally approved | Risk decisions may lack authority | Documented residual risk acceptance by authorised risk owners | High |
| Documented information | Risk records are incomplete | Insufficient audit evidence | Retained records of methodology, assessment, treatment, SoA, approvals, and reviews | High |

### 4. Annex A Control Theme Summary

ISO/IEC 27001:2022 Annex A includes 93 controls grouped into four themes. The organisation is required to consider these controls during risk treatment and document applicability in the Statement of Applicability.

| Annex A Theme | Controls | Current Maturity | Target Maturity | Overall Finding |
|---|---:|---:|---:|---|
| A.5 Organisational controls | 37 | 2.3 | 4.0 | Governance, supplier, asset, incident, and continuity controls require formalisation |
| A.6 People controls | 8 | 2.5 | 3.5–4.0 | HR security practices exist but require stronger evidence and lifecycle integration |
| A.7 Physical controls | 14 | 2.8 | 3.5–4.0 | Physical controls are partially implemented; documentation and monitoring require improvement |
| A.8 Technological controls | 34 | 2.4 | 4.0 | Several technical controls exist but require standardisation, monitoring, and risk linkage |

### 5. Annex A Detailed Gap Summary

#### A.5 Organisational Controls

| Control Area | Current State | Gap | Severity |
|---|---|---|---|
| Information security policies | Policies are incomplete or not consistently reviewed | Policy framework does not fully cover ISO 27001 expectations or Annex A areas | Medium |
| Information security roles and responsibilities | Roles exist informally | Control ownership and accountability are not consistently documented | High |
| Segregation of duties | Implemented in some systems | No complete segregation-of-duties assessment for critical processes | Medium |
| Management responsibilities | Managers support security but responsibilities are not embedded in role expectations | Inconsistent enforcement of security responsibilities | Medium |
| Contact with authorities and special interest groups | Not formally defined | No documented process for regulatory, law enforcement, CERT, or industry security contacts | Low |
| Threat intelligence | Informal threat monitoring occurs | No structured threat intelligence process linked to risk assessment | Medium |
| Information security in project management | Security involvement in projects is inconsistent | Risk and control requirements not embedded into project lifecycle | High |
| Inventory of information and associated assets | Asset inventories exist but are incomplete or not classification-linked | Asset ownership, criticality, and information classification need improvement | High |
| Acceptable use | Policy exists or is draft | User acknowledgement and monitoring evidence are incomplete | Medium |
| Return of assets | Offboarding practices exist | Asset return evidence is inconsistent | Medium |
| Classification and labelling | Classification approach is immature | Information handling requirements are not consistently defined or applied | High |
| Information transfer | Some secure transfer tools exist | Formal transfer rules and agreements are incomplete | Medium |
| Access control policy | Access practices exist | Policy and access rules are not consistently linked to business requirements and risk | High |
| Identity management | Centralised identity exists for some systems | Joiner-mover-leaver process is not fully evidenced for all platforms | High |
| Authentication information | Password/MFA practices exist | Requirements are not uniformly enforced or documented across all systems | High |
| Access rights | Reviews occur inconsistently | Periodic access review process and evidence are incomplete | High |
| Supplier relationships | Supplier onboarding includes limited security review | Supplier risk assessment and contractual requirements are inconsistent | High |
| Supplier agreements | Some contracts include security terms | Minimum information security clauses are not standardised | High |
| ICT supply chain | Not formally assessed | Supply chain risks are not systematically identified and treated | High |
| Supplier monitoring | Limited ongoing review | Supplier performance and security monitoring not risk-based | Medium |
| Cloud services | Cloud platforms are used | Cloud security responsibilities, configuration standards, and monitoring require formalisation | High |
| Incident management planning | Incident response activities exist | Incident procedures, classification, escalation, and lessons learned require strengthening | High |
| Information security during disruption | Some continuity planning exists | Information security continuity requirements are not fully embedded | Medium |
| ICT readiness for business continuity | Backups exist | Recovery objectives, testing, and evidence require improvement | High |
| Legal and contractual requirements | Requirements are known informally | Compliance obligations register is incomplete | High |
| Protection of records | Records are stored across systems | Retention, protection, and disposal requirements need formalisation | Medium |
| Privacy and PII protection | Privacy controls exist where legally required | Privacy obligations need linkage to ISMS risks and controls | High |
| Independent review | No formal independent ISMS review completed | Internal audit or external review required before certification | High |
| Compliance with policies and standards | Compliance checks are inconsistent | Need defined control testing and evidence collection | Medium |
| Documented operating procedures | Procedures vary by function | Critical operating procedures require standard format and approval | Medium |

#### A.6 People Controls

| Control Area | Current State | Gap | Severity |
|---|---|---|---|
| Screening | Pre-employment checks may occur for selected roles | Screening criteria are not risk-based or consistently evidenced | Medium |
| Terms and conditions of employment | Employment terms include general confidentiality | Information security responsibilities need explicit coverage | Medium |
| Awareness, education, and training | Security awareness occurs periodically | Training completion, role-based content, and effectiveness measurement need improvement | Medium |
| Disciplinary process | HR disciplinary process exists | Security policy violations are not explicitly integrated | Low |
| Responsibilities after termination or change | Offboarding process exists | Continuing confidentiality and access removal evidence require improvement | Medium |
| Confidentiality or non-disclosure agreements | NDAs used in some cases | Coverage for employees, contractors, and third parties requires validation | Medium |
| Remote working | Remote work is common | Remote work security requirements need formalisation and monitoring | High |
| Information security event reporting | Users can report incidents informally | Clear reporting channels, timelines, and awareness require improvement | Medium |

#### A.7 Physical Controls

| Control Area | Current State | Gap | Severity |
|---|---|---|---|
| Physical security perimeters | Controls exist at main facilities | Perimeter requirements and review evidence are incomplete | Medium |
| Physical entry | Access controls exist | Access approval and periodic review records need improvement | Medium |
| Securing offices and facilities | Basic controls are in place | Formal facility security standards required | Low |
| Physical security monitoring | Monitoring exists in some locations | Monitoring responsibilities and retention periods require documentation | Medium |
| Protection against environmental threats | Fire and environmental controls exist | Testing and maintenance evidence requires validation | Medium |
| Working in secure areas | Not consistently defined | Rules for secure areas require documentation | Low |
| Clear desk and clear screen | Informal expectations exist | Policy, awareness, and compliance checks need improvement | Low |
| Equipment siting and protection | Implemented operationally | Standards for critical equipment need formalisation | Medium |
| Security of assets off-premises | Remote work equipment is used | Controls for off-site assets require stronger tracking | Medium |
| Storage media | Media use is limited | Disposal, reuse, encryption, and handling requirements need documentation | Medium |
| Supporting utilities | Utilities are managed by facilities/providers | Assurance evidence and responsibility mapping are incomplete | Low |
| Cabling security | Basic protection exists | Cabling security controls are not formally assessed | Low |
| Equipment maintenance | Maintenance occurs | Maintenance records and supplier access controls require improvement | Medium |
| Secure disposal or reuse of equipment | Some disposal practices exist | Sanitisation certificates and disposal records are inconsistent | Medium |

#### A.8 Technological Controls

| Control Area | Current State | Gap | Severity |
|---|---|---|---|
| User endpoint devices | Endpoint protection exists | Baseline configuration and monitoring need standardisation | High |
| Privileged access rights | Admin accounts exist | Privileged access approval, review, and monitoring are incomplete | High |
| Information access restriction | Role-based access exists in some systems | Access models and data-level restrictions are inconsistent | High |
| Access to source code | Repositories are controlled | Formal source code access rules and review evidence required | Medium |
| Secure authentication | MFA used for some systems | MFA and password requirements not uniformly enforced | High |
| Capacity management | Informal monitoring exists | Capacity thresholds and review procedures require definition | Medium |
| Protection against malware | Anti-malware is deployed | Coverage, alert response, and exception management require evidence | Medium |
| Technical vulnerability management | Vulnerability scanning occurs inconsistently | Formal scanning, prioritisation, remediation SLAs, and exception process required | High |
| Configuration management | Configuration practices exist | Secure baselines and drift monitoring are incomplete | High |
| Information deletion | Deletion occurs operationally | Data deletion requirements and evidence are inconsistent | Medium |
| Data masking | Used in limited cases | Masking requirements for non-production and analytics environments are not formalised | Medium |
| Data leakage prevention | Limited DLP capability | DLP requirements and monitoring approach need risk-based definition | Medium |
| Information backup | Backups exist | Backup scope, frequency, encryption, restoration testing, and evidence require improvement | High |
| Redundancy | Some redundancy exists | Redundancy requirements aligned to business impact are incomplete | Medium |
| Logging | Logs are collected for some platforms | Logging scope, retention, monitoring, and alerting need formalisation | High |
| Monitoring activities | Security monitoring is partial | Detection use cases, escalation, and review evidence are incomplete | High |
| Clock synchronisation | Likely implemented technically | Evidence and standard configuration required | Low |
| Use of privileged utility programs | Not formally controlled | Administrative tools require authorisation and monitoring | Medium |
| Installation of software | Some restrictions exist | Approved software process and enforcement require improvement | Medium |
| Networks security | Network controls exist | Network architecture, segmentation, and firewall review evidence require improvement | High |
| Security of network services | Services are managed operationally | Security requirements in network service agreements need definition | Medium |
| Segregation of networks | Some segmentation exists | Segmentation design and risk rationale require documentation | High |
| Web filtering | May be implemented | Coverage and exception process require validation | Low |
| Use of cryptography | Encryption is used in some areas | Cryptographic standard and key management requirements are incomplete | High |
| Secure development lifecycle | Development practices vary | Secure SDLC, code review, testing, and release controls require formalisation | High |
| Application security requirements | Requirements are not consistently defined | Security requirements need integration into design and procurement | High |
| Secure system architecture | Architecture reviews occur informally | Secure architecture principles and review evidence required | Medium |
| Secure coding | Developer practices vary | Secure coding standards and training required | Medium |
| Security testing | Testing occurs inconsistently | Security testing criteria, frequency, and remediation tracking required | High |
| Outsourced development | Third parties may support development | Contractual and verification controls need strengthening | Medium |
| Change management | Change process exists | Security impact assessment and emergency change evidence require improvement | High |
| Test information | Production data may be used in testing | Test data protection and masking rules required | High |
| Protection of information systems during audit testing | Not formally defined | Audit testing rules and approval process required | Low |

### 6. Key Evidence Gaps

| Evidence Required | Current Availability | Impact |
|---|---|---|
| Approved ISMS scope statement | Partial | Certification scope may be challenged |
| ISMS process map | Not available | evidence incomplete |
| Interested parties and requirements register | Partial | Context and compliance linkage incomplete |
| Risk assessment methodology | Partial / draft | nonconformity risk |
| Completed information security risk assessment | Partial | Risk treatment cannot be fully justified |
| Risk treatment plan | Not complete | evidence incomplete |
| Statement of Applicability | Not complete | Mandatory certification evidence missing |
| Information security objectives | Partial | evidence incomplete |
| Internal audit programme and report | Not available | not satisfied |
| Management review minutes | Not ISO-aligned | not satisfied |
| Corrective action register | Partial | evidence incomplete |
| Control operating evidence | Partial | Annex A implementation cannot be fully demonstrated |

## Analysis

### ISMS Readiness Analysis

The organisation has implemented several security practices, but these practices are not yet consistently governed through a formal ISMS. ISO/IEC 27001:2022 requires more than technical control implementation; it requires a documented, repeatable, risk-based management system that is planned, operated, evaluated, and improved.

The primary readiness issue is not absence of all controls, but insufficient integration and evidence. Existing practices must be brought under ISMS governance with defined ownership, documentation, risk linkage, monitoring, and review.

### Analysis is central to certification readiness because it requires the organisation to operate an integrated ISMS. The current state indicates that individual processes exist across IT, security, HR, procurement, and facilities, but these processes are not yet fully connected through a documented ISMS operating model.

The organisation should be able to demonstrate:

- The ISMS scope and boundaries.
- The processes needed to run the ISMS.
- How those processes interact.
- Who owns and performs each process.
- What inputs, outputs, records, and performance indicators exist.
- How the ISMS is maintained and improved.
- How outsourced processes are controlled.
- How risk management drives control selection and operational priorities.

At present, gaps in documentation, ownership, and evidence would likely result in audit findings.

### Analysis presents the highest certification risk. ISO 27001 requires the organisation to define and apply a consistent information security risk assessment process. This process must establish risk criteria and produce consistent, valid, and comparable results.

The organisation must then perform risk treatment by:

- Selecting appropriate treatment options.
- Determining all controls necessary to implement treatment.
- Comparing selected controls with Annex A to ensure no necessary controls are omitted.
- Producing a Statement of Applicability.
- Creating a risk treatment plan.
- Obtaining risk owner approval of the plan and acceptance of residual risks.

The absence of a complete risk methodology, risk assessment, treatment plan, and Statement of Applicability represents a material gap. These items are core mandatory evidence for ISO 27001 certification.

### Annex A Analysis

The Annex A review shows that many controls are partially implemented, particularly in technology operations. However, several controls lack formal documentation, defined ownership, consistent execution, or evidence retention.

A recurring issue is that Annex A controls have not yet been systematically assessed for applicability based on risk. This weakens the organisation’s ability to justify control selection and exclusions. The Statement of Applicability should become the authoritative record linking Annex A controls to:

- Applicability decisions.
- Risk treatment decisions.
- Implementation status.
- Control owners.
- Supporting policies and procedures.
- Evidence sources.
- Exclusion justifications where applicable.

### Risk Implications

Failure to remediate the identified gaps may result in:

| Risk | Potential Impact |
|---|---|
| Certification non-readiness | Major nonconformities during Stage 1 or Stage 2 audit |
| Inconsistent risk decisions | Misaligned control investment and unmanaged residual risks |
| Incomplete regulatory compliance | Failure to identify legal, contractual, and privacy obligations |
| Weak supplier assurance | Inadequate oversight of outsourced services and cloud dependencies |
| Poor audit evidence | Inability to demonstrate implementation and effectiveness |
| Operational security exposure | Increased likelihood or impact of security incidents |
| Ineffective continual improvement | Security programme remains reactive rather than managed |

### Certification Readiness Estimate

Subject to resourcing and executive prioritisation, the estimated implementation effort is:

| Remediation Area | Estimated Duration | Dependency |
|---|---:|---|
| Scope, context, governance, and ISMS process design | 2–4 weeks | Executive approval and stakeholder input |
| Risk methodology, assessment, and treatment planning | 4–8 weeks | Asset/process inventory and risk owner participation |
| Statement of Applicability completion | 2–4 weeks | Risk assessment and control owner input |
| Policy and procedure remediation | 4–10 weeks | Document owners and approval workflow |
| Annex A control evidence uplift | 6–16 weeks | Technical and operational remediation effort |
| Internal audit and corrective actions | 3–6 weeks | ISMS operation evidence available |
| Management review and certification readiness | 1–2 weeks | Internal audit and metrics completed |

Indicative certification readiness timeframe: **[3–6 months]**, depending on available resources and complexity of the ISMS scope.

## Recommendations & Actions

### Recommended Remediation Priorities

| Priority | Recommendation | Rationale |
|---:|---|---|
| 1 | Approve ISMS scope, governance model, and implementation roadmap | Required foundation for and certification planning |
| 2 | Develop and approve information security risk methodology | Mandatory for |
| 3 | Complete formal information security risk assessment | Required to identify and evaluate risks consistently |
| 4 | Develop risk treatment plan and obtain risk owner approvals | Required for and |
| 5 | Complete Statement of Applicability | Mandatory ISO 27001 evidence and key certification artefact |
| 6 | Define ISMS process map and operating calendar | Demonstrates established and maintained ISMS under |
| 7 | Update policy and procedure framework | Supports consistent control implementation and evidence |
| 8 | Establish monitoring metrics and control evidence repository | Required for and audit readiness |
| 9 | Perform internal audit against ISO 27001:2022 | Required before certification and management review |
| 10 | Conduct ISO-aligned management review | Required for and continual improvement |

### Corrective Action Plan

| ID | Finding / Gap | Action Required | Owner | Due Date | Priority | Success Criteria |
|---|---|---|---|---|---|---|
| GA-001 | ISMS scope incomplete | Finalise and approve ISMS scope, including boundaries, exclusions, interfaces, and outsourced processes | [ISMS Manager] | [Date] | High | Approved scope statement available |
| GA-002 | ISMS processes not fully defined | Create ISMS process map and operating model showing process interactions | [ISMS Manager] | [Date] | High | Approved ISMS process map and RACI |
| GA-003 | Interested party requirements incomplete | Create register of interested parties and applicable requirements | [Compliance Lead] | [Date] | Medium | Register approved and linked to risks |
| GA-004 | Risk methodology incomplete | Define likelihood, impact, risk levels, acceptance criteria, and assessment rules | [Risk Manager] | [Date] | Critical | Approved risk assessment methodology |
| GA-005 | Risk assessment incomplete | Conduct risk assessment for in-scope assets, processes, threats, vulnerabilities, and impacts | [Risk Owners] | [Date] | Critical | Completed risk register with evaluated risks |
| GA-006 | Risk treatment plan absent/incomplete | Define treatment options, controls, owners, dates, and residual risk approvals | [Risk Manager] | [Date] | Critical | Approved treatment plan with risk owner sign-off |
| GA-007 | Statement of Applicability incomplete | Assess all Annex A controls for applicability and implementation status | [ISMS Manager] | [Date] | Critical | Approved SoA with inclusion/exclusion rationale |
| GA-008 | Information security objectives not measurable | Define ISMS objectives with metrics, owners, targets, and review frequency | [CISO / ISMS Manager] | [Date] | Medium | Objective register approved and monitored |
| GA-009 | Document control inconsistent | Implement document control procedure and document register | [Document Control Owner] | [Date] | High | Controlled documents versioned and approved |
| GA-010 | Supplier assurance incomplete | Implement supplier risk assessment, contractual clauses, and monitoring schedule | [Procurement Lead] | [Date] | High | Supplier register with risk ratings and reviews |
| GA-011 | Access review evidence incomplete | Establish periodic access review process for critical systems | [IT Operations Lead] | [Date] | High | Access reviews completed and exceptions remediated |
| GA-012 | Vulnerability management inconsistent | Define scanning frequency, severity SLAs, exception handling, and reporting | [Security Operations Lead] | [Date] | High | Vulnerability reports and remediation metrics available |
| GA-013 | Backup testing evidence incomplete | Define backup standard and perform restore testing for critical systems | [Infrastructure Lead] | [Date] | High | Successful restore test records available |
| GA-014 | Logging and monitoring incomplete | Define logging standard, retention, alerting, and monitoring responsibilities | [Security Operations Lead] | [Date] | High | Logging coverage matrix and alert evidence available |
| GA-015 | Internal audit programme absent | Establish and execute ISO 27001 internal audit programme | [Internal Audit Lead] | [Date] | High | Internal audit report and findings issued |
| GA-016 | Management review not ISO-aligned | Conduct management review covering ISO 27001 required inputs and outputs | [Executive Sponsor] | [Date] | High | Approved management review minutes and decisions |
| GA-017 | Corrective action tracking inconsistent | Implement corrective action register with root cause and effectiveness review | [ISMS Manager] | [Date] | Medium | Corrective actions tracked to closure |

### Implementation Timeline

| Phase | Activities | Target Completion | Key Deliverables |
|---|---|---|---|
| Phase 1 — Foundation | Scope, context, interested parties, governance, ISMS process map | [Date] | Scope statement, governance model, ISMS process map |
| Phase 2 — Risk Planning | Risk methodology, ISMS risks/opportunities, risk assessment criteria | [Date] | Risk methodology, risk criteria, risk register template |
| Phase 3 — Risk Assessment & Treatment | Perform risk assessment, select treatment options, develop treatment plan | [Date] | Risk register, treatment plan, residual risk approvals |
| Phase 4 — Annex A & SoA | Assess Annex A applicability, map controls to risks and evidence | [Date] | Statement of Applicability, control ownership matrix |
| Phase 5 — Documentation & Control Uplift | Update policies, procedures, standards, records, operational controls | [Date] | Controlled document set and evidence repository |
| Phase 6 — Performance Evaluation | Metrics, internal audit, corrective actions, management review | [Date] | KPI/KRI dashboard, audit report, management review minutes |
| Phase 7 — Certification Readiness | Final evidence review, pre-assessment remediation, certification planning | [Date] | Certification readiness pack |

### Minimum Evidence Pack Required Before Certification Audit

| Evidence Item | Required Status |
|---|---|
| Approved ISMS scope | Complete |
| Context and interested parties analysis | Complete |
| ISMS governance model and role assignments | Complete |
| Information security policy | Approved and communicated |
| Risk assessment methodology | Approved |
| Completed risk assessment | Complete and reviewed |
| Risk treatment plan | Approved and tracked |
| Statement of Applicability | Approved |
| Information security objectives | Defined, measured, and reviewed |
| Annex A control evidence | Available for applicable controls |
| Internal audit programme and report | Completed |
| Corrective action records | Open actions tracked; critical actions remediated |
| Management review minutes | Completed with required ISO inputs and outputs |
| Document control records | Available |
| Evidence of continual improvement | Available |

### Management Decisions Required

| Decision | Required By | Impact if Delayed |
|---|---|---|
| Confirm ISMS scope and certification boundary | [Executive Sponsor] | Delays all downstream risk and control activities |
| Approve risk methodology and acceptance criteria | [Risk Committee / Executive Management] | Prevents valid risk assessment and treatment |
| Assign risk owners and control owners | [Executive Management] | Weak accountability and audit evidence |
| Approve remediation budget and resources | [Executive Management] | Delays closure of high-risk gaps |
| Confirm certification target timeline | [Executive Management] | Impacts implementation sequencing and audit scheduling |

## Distribution & Confidentiality

### Distribution

This report is intended for authorised internal stakeholders responsible for ISMS governance, implementation, oversight, and assurance.

| Recipient / Group | Purpose |
|---|---|
| [Executive Sponsor] | Review findings, approve priorities, allocate resources |
| [CISO / Head of Information Security] | Own remediation strategy and ISMS implementation |
| [ISMS Manager] | Coordinate corrective actions and certification readiness |
| [Risk Committee] | Review risk methodology, treatment plans, and residual risk |
| [IT Leadership] | Implement and evidence technical and operational controls |
| [HR Leadership] | Address people control gaps |
| [Procurement / Vendor Management] | Address supplier and cloud control gaps |
| [Internal Audit] | Plan internal audit and assurance activities |
| [Legal / Compliance] | Validate legal, regulatory, contractual, and privacy obligations |
| [Certification Body / External Auditor] | Provided only when authorised by management |

### Confidentiality Requirements

This report is classified as **Confidential**. It contains sensitive information regarding the organisation’s security posture, control weaknesses, risk exposure, and certification readiness.

The following handling requirements apply:

- Distribution must be limited to authorised personnel with a legitimate business need.
- The report must not be shared externally without approval from [Executive Sponsor / CISO / Legal].
- External sharing with consultants, auditors, certification bodies, or suppliers must be subject to appropriate confidentiality obligations.
- Findings must not be copied into unsecured communication channels or public collaboration spaces.
- Any extracted action plans or summaries must retain the same classification unless formally downgraded.
- The report must be stored in an approved repository with access controls and version history.
- Superseded versions must be retained or disposed of in accordance with the organisation’s document retention requirements.

### Document Review and Retention

| Item | Requirement |
|---|---|
| Review frequency | At least annually or upon significant ISMS scope, risk, business, technology, or regulatory change |
| Next scheduled review | [YYYY-MM-DD] |
| Retention period | [Retention Period] |
| Authorised approver | [Executive Sponsor / CISO] |
| Repository | [Approved Document Repository] |