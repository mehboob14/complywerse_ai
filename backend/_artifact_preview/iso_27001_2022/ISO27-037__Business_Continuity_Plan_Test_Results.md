<!-- iso_27001_2022 / ISO27-037 | type=Plan | mode=markdown | model=gpt-5.5 | 55514 chars -->

| Metadata | Value |
|---|---|
| Document ID | [BCP-DR-PLAN-001] |
| Version | 1.0 |
| Owner | Business Continuity Manager |
| Effective Date | [YYYY-MM-DD] |
| Framework | ISO/IEC 27001:2022 |
| Classification | Internal |

## Purpose & Objectives

This Business Continuity Plan & Test Results document defines the organisation’s plan for establishing, maintaining, exercising, and improving ICT readiness for business continuity in alignment with ISO/IEC 27001:2022 Annex A.5.30.

The purpose of this plan is to ensure that the organisation can maintain or restore critical information and communication technology services within agreed continuity objectives following disruptive events. This includes preparedness for incidents such as cyber attacks, infrastructure failures, cloud service outages, data corruption, ransomware, telecommunications failures, facility loss, supply chain disruption, and other events that may affect the availability of information assets and supporting services.

The objectives of this plan are to:

1. Define the activities required to implement and maintain ICT continuity capabilities that support organisational business continuity requirements.
2. Establish recovery priorities for critical ICT services based on business impact and risk.
3. Document recovery objectives, including Recovery Time Objectives and Recovery Point Objectives.
4. Ensure ICT continuity arrangements are aligned with business continuity, incident management, information security, crisis management, supplier management, and risk management processes.
5. Define the approach for testing, exercising, recording, and improving business continuity and disaster recovery capabilities.
6. Provide a documented basis for audit evidence demonstrating that ICT readiness for business continuity is planned, implemented, tested, reviewed, and improved.
7. Ensure recovery arrangements address confidentiality, integrity, availability, authenticity, accountability, and resilience requirements for information and associated assets.
8. Confirm that continuity arrangements are proportionate to the organisation’s risk appetite, contractual obligations, legal and regulatory requirements, and stakeholder expectations.

For the purpose of this document:

- **Business Continuity Plan (BCP)** means the planned response for maintaining or restoring critical business processes during and after disruption.
- **Disaster Recovery Plan (DRP)** means the technical plan for restoring ICT infrastructure, applications, data, networks, and supporting services.
- **ICT readiness for business continuity** means the capability of ICT services and supporting arrangements to meet business continuity objectives during disruption.
- **Recovery Time Objective (RTO)** means the maximum acceptable time to restore a service or process.
- **Recovery Point Objective (RPO)** means the maximum acceptable data loss measured in time.
- **Maximum Tolerable Period of Disruption (MTPD)** means the maximum period after which disruption would create unacceptable impact.

## Scope

This plan applies to all ICT services, information assets, systems, facilities, suppliers, and personnel required to support critical and important business processes within the organisation’s ISO/IEC 27001:2022 Information Security Management System scope.

The scope includes:

| Scope Area | Included Activities |
|---|---|
| Critical business processes | Identification, prioritisation, continuity requirements, recovery dependencies, and business impact alignment |
| ICT services | Applications, infrastructure, networks, endpoints, identity services, collaboration platforms, databases, storage, backup platforms, monitoring tools, and security services |
| Information assets | Business-critical data, regulated data, customer data, operational data, configuration data, logs, keys, credentials, and recovery documentation |
| Cloud and hosted services | SaaS, PaaS, IaaS, managed hosting, cloud backup, cloud identity, and externally managed environments |
| On-premises technology | Data centres, server rooms, network infrastructure, local storage, telephony, printing, and facility-dependent ICT resources |
| Cyber resilience | Continuity response for ransomware, destructive malware, account compromise, denial of service, data corruption, and unauthorised system modification |
| Backup and restoration | Backup schedules, retention, immutability, encryption, restoration testing, backup access control, and backup monitoring |
| Disaster recovery | Failover, restoration, rebuild, reconfiguration, data recovery, infrastructure recovery, service validation, and controlled return to normal operations |
| Third parties | Suppliers and service providers that support critical ICT services, including contractual continuity commitments and recovery evidence |
| Testing and exercising | Tabletop exercises, technical recovery tests, backup restoration tests, failover tests, cyber recovery scenarios, supplier continuity validation, and post-test reporting |
| Governance and evidence | Plans, test reports, lessons learned, corrective actions, approvals, review records, and audit evidence |

Out of scope unless specifically included by the Business Continuity Manager and Information Security Manager:

- Personal, non-business systems not used to process organisational information.
- Systems formally retired or decommissioned.
- Non-critical test or development environments, unless required for recovery, validation, or operational resilience.
- Physical safety response plans, except where they intersect with ICT recovery and business continuity.
- Emergency evacuation procedures, except where they affect ICT continuity arrangements.

The scope of this plan shall be reviewed whenever there is a material change to business processes, information systems, suppliers, regulatory obligations, risk exposure, or organisational structure.

## Assumptions & Dependencies

The successful implementation and operation of this plan depends on the following assumptions and dependencies.

### Assumptions

| Ref | Assumption | Impact if Invalid | Owner |
|---|---|---|---|
| A1 | Business impact analysis has identified critical business processes and required recovery priorities. | RTOs and RPOs may not reflect business need. | Business Continuity Manager |
| A2 | Asset inventory, system ownership, and service dependency information are accurate and maintained. | Recovery plans may omit required systems or dependencies. | IT Operations Manager |
| A3 | Backup processes are operational, monitored, protected, and aligned to defined RPOs. | Data recovery may fail or exceed acceptable loss thresholds. | Infrastructure Manager |
| A4 | Recovery documentation is available during disruption, including when primary systems are unavailable. | Response teams may lack access to recovery instructions. | Disaster Recovery Coordinator |
| A5 | Key recovery personnel are trained and contactable during disruptive events. | Recovery may be delayed or uncoordinated. | Department Heads |
| A6 | Third-party providers can meet contractual continuity and recovery obligations. | Supplier failure may prevent achievement of recovery objectives. | Supplier Manager |
| A7 | Sufficient executive authority is available to make emergency decisions during major disruption. | Escalation and resource allocation may be delayed. | Executive Sponsor |
| A8 | Information security requirements continue to apply during continuity and recovery operations. | Emergency activity may introduce unauthorised access, data leakage, or control bypass. | Information Security Manager |
| A9 | Recovery environments and backup media are protected from the same threat scenarios affecting production systems. | Recovery capability may be compromised by correlated failures. | IT Operations Manager |
| A10 | Communication channels are available or alternatives are defined. | Coordination with stakeholders may be impaired. | Crisis Management Lead |

### Dependencies

| Dependency | Description | Required Continuity Consideration |
|---|---|---|
| Identity and access management | Directory services, privileged access, multi-factor authentication, single sign-on, emergency access accounts | Recovery access must be available if primary identity services are unavailable, while maintaining control and auditability |
| Network connectivity | Internet, WAN, VPN, firewalls, DNS, routing, load balancing | Alternate connectivity and configuration backups must support recovery |
| Cloud providers | Hosting, SaaS platforms, cloud storage, cloud databases, security services | Provider resilience, region availability, backup options, export capability, and support response must be understood |
| Backup platform | Backup software, repositories, keys, credentials, immutability, monitoring | Backups must be protected from tampering and tested through restoration |
| Endpoint and server management | Build images, configuration management, patch repositories, deployment tools | Recovery or rebuild must use trusted, current, and validated configurations |
| Security monitoring | SIEM, endpoint detection, vulnerability management, incident response tooling | Security visibility must remain available during continuity operations where feasible |
| Telecommunications | Voice, mobile, collaboration tools, conferencing, emergency notifications | Alternative communications must be available for crisis coordination |
| Facilities | Data centre, office locations, power, cooling, physical access, physical security | Facility dependencies must be included in recovery scenarios |
| Suppliers | Managed service providers, software vendors, telecoms, logistics, cloud support | Supplier continuity obligations must be documented and periodically validated |
| Key personnel | Technical teams, system owners, business process owners, executive decision-makers | Deputies, escalation paths, and out-of-hours availability must be defined |

### Planning Constraints

The following constraints shall be considered when planning and exercising continuity and disaster recovery arrangements:

- Recovery actions must not knowingly compromise legal, regulatory, contractual, privacy, or information security obligations.
- Emergency access must be time-bound, approved where practicable, logged, and reviewed after use.
- Recovery from cyber-related disruption must include validation that recovered environments are trusted and free from known compromise.
- Restoration of corrupted, encrypted, or maliciously altered data must not proceed until data integrity is assessed.
- Business-approved workarounds must be documented and risk-assessed where they bypass normal technology controls.
- Recovery priorities must be based on business impact, not solely technical convenience.
- Test results must be retained as evidence and used to drive corrective action.

## Approach / Phases

The organisation shall implement and maintain ICT readiness for business continuity through the following phased approach. Each phase produces documented outputs that support auditability, operational readiness, and continual improvement.

### Phase 1 — Governance and Planning Initiation

The organisation shall establish governance for business continuity and disaster recovery activities.

Key activities:

1. Appoint accountable owners for business continuity, disaster recovery, ICT service recovery, communications, and executive decision-making.
2. Confirm the ISO/IEC 27001:2022 ISMS scope and identify ICT services supporting in-scope business processes.
3. Define planning standards for BCP and DR documentation, including version control, approval, classification, accessibility, and retention.
4. Align this plan with:
 - Information Security Policy.
 - Incident Management Procedure.
 - Risk Management Methodology.
 - Supplier Security Management process.
 - Backup and Restore Procedure.
 - Access Control Policy.
 - Change Management Procedure.
 - Crisis Communications Plan.
 - Business Impact Analysis.
5. Establish test frequency and reporting expectations.
6. Define minimum evidence requirements for audit and management review.

Expected outputs:

| Output | Description | Owner |
|---|---|---|
| BCP/DR governance model | Accountability, decision authority, escalation routes, and reporting lines | Executive Sponsor |
| Planning criteria | Standards for recovery documentation, testing, and maintenance | Business Continuity Manager |
| Evidence register | List of records required to demonstrate control operation | Information Security Manager |

### Phase 2 — Business Impact Analysis and Recovery Requirements

The organisation shall determine continuity requirements for critical business processes and supporting ICT services.

Key activities:

1. Identify business processes within scope.
2. Determine impact over time for disruption scenarios, including financial, operational, legal, regulatory, contractual, customer, safety, and reputational impacts.
3. Identify maximum tolerable periods of disruption.
4. Define recovery requirements for supporting ICT services.
5. Establish RTOs and RPOs for systems and data.
6. Identify service dependencies, including upstream and downstream systems, suppliers, data flows, identity services, and infrastructure.
7. Confirm minimum service levels required during degraded operations.
8. Validate continuity requirements with business process owners.

Recovery priority classification:

| Priority | Description | Indicative RTO | Indicative RPO | Examples |
|---|---|---:|---:|---|
| Priority 1 — Mission Critical | Services required to prevent severe business, legal, regulatory, or customer impact | 0–4 hours | 0–1 hour | Payment processing, core customer platform, identity services, security monitoring |
| Priority 2 — Business Critical | Services required to maintain major operations | 4–24 hours | 4–24 hours | ERP, service desk, collaboration tools, operational reporting |
| Priority 3 — Important | Services that support normal operations but can tolerate temporary manual workaround | 1–3 business days | 1 business day | Internal knowledge base, non-critical reporting |
| Priority 4 — Standard | Services that may be restored after critical operations are stabilised | 3–10 business days | 1–5 business days | Archival systems, low-use internal tools |

Minimum recovery requirements table:

| System / Service | Business Process Supported | Priority | RTO | RPO | Key Dependencies | System Owner |
|---|---|---:|---:|---:|---|---|
| [Critical System 1] | [Business Process] | 1 | [e.g., 4 hours] | [e.g., 1 hour] | Identity, database, network, backup platform | [Owner] |
| [Critical System 2] | [Business Process] | 1 | [e.g., 4 hours] | [e.g., 15 minutes] | Cloud region, DNS, security monitoring | [Owner] |
| [Business Application] | [Business Process] | 2 | [e.g., 24 hours] | [e.g., 24 hours] | SaaS provider, integration platform | [Owner] |
| [Internal Service] | [Business Process] | 3 | [e.g., 3 business days] | [e.g., 1 business day] | File storage, endpoint access | [Owner] |

Expected outputs:

| Output | Description | Owner |
|---|---|---|
| Business Impact Analysis | Business-approved impact assessment and recovery priorities | Business Continuity Manager |
| ICT recovery requirements | RTOs, RPOs, dependencies, and service restoration criteria | IT Operations Manager |
| Criticality register | Prioritised list of systems and services supporting critical processes | Information Asset Owners |

### Phase 3 — Continuity and Disaster Recovery Design

The organisation shall design continuity and recovery capabilities that meet business-approved requirements and security obligations.

Key activities:

1. Define recovery strategies for each critical ICT service, including:
 - High availability.
 - Backup and restoration.
 - Alternate site or cloud region recovery.
 - System rebuild from trusted configuration.
 - Manual workaround.
 - Supplier-managed recovery.
 - Temporary degraded service.
2. Design backup arrangements to meet RPOs, including:
 - Backup frequency.
 - Retention periods.
 - Encryption.
 - Immutability or offline protection.
 - Segregation from production identity and administrative domains where appropriate.
 - Monitoring and alerting.
 - Periodic restoration testing.
3. Define recovery sequencing and dependencies.
4. Establish emergency access arrangements, including break-glass access, approvals, logging, and post-use review.
5. Define communications arrangements for internal teams, executives, customers, regulators, suppliers, and other interested parties.
6. Ensure recovery environments meet minimum security baselines before use.
7. Determine how integrity of systems and data will be validated before restoration or return to service.
8. Identify required supplier continuity commitments and evidence.
9. Define criteria for invoking BCP and DR arrangements.
10. Define criteria for returning to normal operations.

Recovery strategy matrix:

| Scenario | Primary Response Strategy | Recovery Considerations | Required Evidence |
|---|---|---|---|
| Cloud service outage | Failover to alternate region or provider-supported recovery where available | Validate DNS, identity, data replication, network routing, and provider incident status | Failover test report, provider SLA, architecture diagram |
| Ransomware or destructive malware | Isolate affected environment, invoke cyber incident response, restore from known-good backups | Validate backup integrity, compromise status, privileged access, and clean restore environment | Incident record, restore validation, forensic clearance |
| Data corruption | Stop replication where necessary, identify last known-good recovery point, restore affected data | Confirm scope of corruption and prevent overwrite of good backups | Restore test evidence, data integrity validation |
| Data centre outage | Transfer services to alternate site, cloud environment, or supplier recovery arrangement | Confirm power, cooling, physical access, connectivity, and hardware capacity | DR runbook, site test report |
| Network outage | Use alternate connectivity, route changes, remote access alternatives, or supplier escalation | Validate firewall rules, VPN, DNS, and monitoring | Network recovery test report |
| Identity platform outage | Invoke emergency identity recovery or break-glass access process | Maintain least privilege, logging, and post-event review | Emergency access log, access review |
| SaaS provider failure | Activate manual workaround, export data if available, supplier escalation | Confirm contractual recovery commitments and data portability | Supplier test evidence, communications log |
| Loss of key personnel | Use deputies, documented runbooks, and escalation roster | Confirm trained alternates and access rights | Training records, contact list test |

Expected outputs:

| Output | Description | Owner |
|---|---|---|
| BCP response strategy | Business continuity actions, invocation criteria, and communication approach | Business Continuity Manager |
| DR strategy | Technical recovery architecture and recovery methods | Disaster Recovery Coordinator |
| Backup strategy | Backup, retention, immutability, restore testing, and monitoring approach | Infrastructure Manager |
| Supplier continuity requirements | Contractual continuity expectations and evidence requirements | Supplier Manager |

### Phase 4 — Documentation and Readiness Preparation

The organisation shall create and maintain documented BCP and DR materials that can be used during disruption.

Key activities:

1. Prepare business continuity response plans for critical business processes.
2. Prepare system-specific DR runbooks for critical ICT services.
3. Document recovery sequencing and interdependencies.
4. Maintain current contact lists and escalation paths.
5. Prepare communications templates for major disruption scenarios.
6. Maintain inventory of recovery credentials, keys, licences, infrastructure configurations, and supplier contacts.
7. Store recovery documentation in secure, accessible, and resilient locations.
8. Ensure controlled copies are available if primary document management systems are unavailable.
9. Train recovery team members on their responsibilities.
10. Confirm that recovery documentation reflects current system architecture and supplier arrangements.

Minimum BCP/DR documentation set:

| Document / Record | Minimum Content | Owner | Review Frequency |
|---|---|---|---|
| Business Continuity Plan | Invocation criteria, business priorities, contacts, workarounds, communication process, recovery coordination | Business Continuity Manager | At least annually |
| Disaster Recovery Plan | Technical recovery strategies, runbooks, system dependencies, recovery sequence, validation steps | Disaster Recovery Coordinator | At least annually |
| System Recovery Runbooks | Step-by-step restoration instructions, access requirements, validation checks, rollback actions | System Owners | At least annually or after major change |
| Backup and Restore Procedure | Backup schedule, retention, restore process, backup monitoring, failure handling | Infrastructure Manager | At least annually |
| Emergency Contact List | Internal, supplier, executive, legal, regulatory, and communications contacts | Crisis Management Lead | Quarterly |
| Recovery Test Schedule | Planned exercises, scope, participants, objectives, success criteria | Business Continuity Manager | Annually |
| Test Reports | Exercise objectives, scenario, outcomes, issues, evidence, lessons learned, corrective actions | Exercise Lead | After each test |
| Corrective Action Register | Actions from tests, incidents, audits, reviews, owner, due date, status | Information Security Manager | Monthly until closure |

Expected outputs:

| Output | Description | Owner |
|---|---|---|
| Approved BCP | Business-approved continuity plan | Business Continuity Manager |
| Approved DRP | IT-approved disaster recovery plan aligned to business requirements | IT Operations Manager |
| Recovery runbooks | System-specific restoration instructions | System Owners |
| Training records | Evidence that relevant personnel understand their responsibilities | Department Heads |

### Phase 5 — Testing and Exercising

The organisation shall test and exercise BCP and DR arrangements to confirm that they are effective, current, and capable of meeting agreed recovery objectives.

Testing shall be risk-based and shall include both business continuity and technical recovery exercises. Tests shall be planned to avoid unacceptable disruption to live services unless explicitly approved.

Minimum testing programme:

| Test Type | Objective | Minimum Frequency | Typical Participants | Evidence Required |
|---|---|---:|---|---|
| BCP tabletop exercise | Validate decision-making, escalation, communications, and business workarounds | Annually | Executive Sponsor, Business Continuity Manager, process owners, communications, legal, IT | Exercise agenda, scenario, attendance, decisions, issues, actions |
| DR tabletop exercise | Validate recovery sequence, dependencies, runbooks, and roles | Annually | IT Operations, system owners, security, infrastructure, suppliers | Runbook review notes, dependency gaps, action log |
| Backup restoration test | Confirm backups can be restored and data integrity validated | Quarterly for critical systems; at least annually for others | Infrastructure, system owners, database administrators | Restore logs, screenshots, validation results |
| Technical recovery test | Confirm system or service can be recovered within RTO/RPO | At least annually for Priority 1 and Priority 2 systems | IT Operations, application teams, security | Test plan, timestamps, outcome, deviations |
| Cyber recovery exercise | Validate recovery from ransomware, destructive malware, or compromise scenario | Annually | Incident response, security, IT, legal, communications | Scenario report, isolation steps, restore validation, lessons learned |
| Supplier continuity validation | Confirm suppliers can meet continuity obligations | Annually for critical suppliers | Supplier Manager, service owners, procurement | Supplier attestation, test report, SLA review |
| Communications test | Validate contact lists and emergency communication channels | Semi-annually | Crisis team, recovery teams, executive contacts | Call tree results, delivery confirmation, exceptions |
| Failover test | Validate high availability or alternate environment operation | Risk-based; at least annually where used for Priority 1 services | Infrastructure, application owners, network, security | Failover evidence, monitoring output, service validation |

Test planning requirements:

| Requirement | Description |
|---|---|
| Defined objective | Each test must have clear objectives aligned to business continuity and ICT readiness requirements |
| Approved scope | Scope must identify systems, processes, teams, locations, suppliers, and exclusions |
| Scenario | Scenario must reflect credible disruption risks and include assumptions |
| Success criteria | Criteria must include RTO/RPO achievement where applicable |
| Evidence capture | Test activity must produce records sufficient for audit and improvement |
| Risk assessment | Potential operational impact of testing must be assessed and approved |
| Security validation | Recovery must preserve required information security controls |
| Post-test review | Outcomes, issues, lessons learned, and corrective actions must be documented |

Test results recording template:

| Field | Required Content |
|---|---|
| Test ID | Unique identifier, e.g., [DR-TEST-YYYY-001] |
| Test date | Date and time test was conducted |
| Test type | Tabletop, backup restore, failover, cyber recovery, supplier validation, communications test |
| Scenario | Description of simulated or tested disruption |
| Systems/processes in scope | Systems, services, business processes, or suppliers tested |
| Participants | Names or roles involved |
| Objectives | Intended outcomes and control requirements tested |
| Planned RTO/RPO | Applicable recovery objectives |
| Actual recovery time | Measured time from test start or incident declaration to service restoration |
| Actual recovery point | Measured data loss or restored point in time |
| Outcome | Pass, partial pass, fail, or deferred |
| Evidence collected | Logs, screenshots, monitoring records, meeting notes, supplier reports |
| Issues identified | Gaps, failures, delays, dependencies, documentation errors |
| Corrective actions | Action owner, due date, priority, tracking reference |
| Approval | Exercise lead and accountable owner sign-off |

Current test results summary:

| Test ID | Date | Test Type | Scope | Planned Objective | Result | Key Findings | Corrective Action Status |
|---|---:|---|---|---|---|---|---|
| [DR-TEST-YYYY-001] | [YYYY-MM-DD] | Backup restoration | [Critical System 1] database restore | Restore selected dataset within RPO and validate integrity | [Pass/Partial/Fail] | [Finding summary] | [Open/Closed/In Progress] |
| [BCP-EX-YYYY-001] | [YYYY-MM-DD] | BCP tabletop | Ransomware affecting core operations | Validate escalation, communication, and business workaround decisions | [Pass/Partial/Fail] | [Finding summary] | [Open/Closed/In Progress] |
| [DR-TEST-YYYY-002] | [YYYY-MM-DD] | Technical recovery | [Critical System 2] service recovery | Recover service within approved RTO | [Pass/Partial/Fail] | [Finding summary] | [Open/Closed/In Progress] |
| [COMMS-TEST-YYYY-001] | [YYYY-MM-DD] | Communications test | Emergency contact tree | Confirm contactability of recovery roles | [Pass/Partial/Fail] | [Finding summary] | [Open/Closed/In Progress] |
| [SUP-VAL-YYYY-001] | [YYYY-MM-DD] | Supplier continuity validation | [Critical Supplier] | Confirm supplier recovery commitments and evidence | [Pass/Partial/Fail] | [Finding summary] | [Open/Closed/In Progress] |

### Phase 6 — Invocation and Response Readiness

The organisation shall define clear criteria for invoking BCP and DR arrangements.

BCP or DR invocation may occur when one or more of the following conditions apply:

1. A critical ICT service is unavailable or expected to be unavailable beyond its tolerable outage threshold.
2. A cyber incident materially affects the availability, integrity, or trustworthiness of systems or data.
3. A facility, cloud region, network, or supplier outage threatens critical business operations.
4. Data loss, corruption, or unauthorised modification affects critical information assets.
5. A major incident cannot be resolved through normal incident management within business-approved timeframes.
6. Executive management determines that continuity arrangements are required to protect the organisation, customers, legal obligations, or contractual commitments.

Invocation decision authority:

| Situation | Decision Authority | Consultation Required |
|---|---|---|
| Business continuity invocation | Executive Sponsor or delegated Crisis Management Lead | Business Continuity Manager, affected business owner, Legal, Communications |
| Disaster recovery invocation | CIO / Head of IT or delegated IT Operations Manager | Disaster Recovery Coordinator, Information Security Manager, affected system owner |
| Cyber recovery invocation | Information Security Manager or Incident Response Lead, with executive escalation | IT Operations, Legal, Privacy, Executive Sponsor |
| Supplier continuity escalation | Supplier Manager or Service Owner | Procurement, Legal, affected business owner |
| Emergency communication activation | Crisis Management Lead | Communications, Legal, Executive Sponsor |

Minimum response sequence:

| Step | Activity | Primary Owner |
|---:|---|---|
| 1 | Detect or receive notification of disruption | Service Desk / Monitoring Team |
| 2 | Assess business and ICT impact | Incident Manager |
| 3 | Escalate to BCP/DR decision authority | Incident Manager |
| 4 | Decide whether to invoke BCP, DRP, or both | Executive Sponsor / IT Leadership |
| 5 | Activate recovery teams and communication channels | Business Continuity Manager |
| 6 | Stabilise incident and protect evidence where required | Information Security Manager |
| 7 | Execute approved recovery strategy | Disaster Recovery Coordinator |
| 8 | Validate recovered services, data integrity, and security controls | System Owners / Security Team |
| 9 | Communicate status to stakeholders | Crisis Management Lead |
| 10 | Return to normal operations when approved | Executive Sponsor / IT Leadership |
| 11 | Conduct post-incident review and update plans | Business Continuity Manager |

### Phase 7 — Post-Test and Post-Incident Improvement

The organisation shall use test results, incidents, audits, risk assessments, and management reviews to improve ICT readiness for business continuity.

Key activities:

1. Conduct post-test or post-incident review within a defined period after completion.
2. Compare actual results against approved RTOs, RPOs, recovery procedures, communication expectations, and security requirements.
3. Document lessons learned and root causes for failures or delays.
4. Record corrective actions with accountable owners and due dates.
5. Track corrective actions to closure.
6. Validate that corrective actions are effective.
7. Update BCP, DRP, runbooks, contact lists, dependency maps, supplier records, and training materials where required.
8. Report material issues to senior management and ISMS management review.
9. Re-test significant failed controls or recovery steps after remediation.

Corrective action tracking table:

| Action ID | Source | Issue / Gap | Risk Impact | Corrective Action | Owner | Due Date | Status |
|---|---|---|---|---|---|---:|---|
| [CA-YYYY-001] | [Test/Incident/Audit] | [Description] | [High/Medium/Low] | [Action] | [Owner] | [YYYY-MM-DD] | [Open/In Progress/Closed] |
| [CA-YYYY-002] | [Test/Incident/Audit] | [Description] | [High/Medium/Low] | [Action] | [Owner] | [YYYY-MM-DD] | [Open/In Progress/Closed] |
| [CA-YYYY-003] | [Test/Incident/Audit] | [Description] | [High/Medium/Low] | [Action] | [Owner] | [YYYY-MM-DD] | [Open/In Progress/Closed] |

Expected outputs:

| Output | Description | Owner |
|---|---|---|
| Test report | Formal record of exercise results and evidence | Exercise Lead |
| Lessons learned report | Summary of observations, root causes, and improvements | Business Continuity Manager |
| Corrective action register | Tracked remediation items from tests and incidents | Information Security Manager |
| Updated BCP/DRP | Revised plans incorporating approved improvements | Document Owners |

### Phase 8 — Maintenance and Continual Improvement

The organisation shall maintain BCP and DR arrangements so they remain current, effective, and aligned with business and technology changes.

Key activities:

1. Review BCP and DRP at least annually.
2. Review critical recovery information after major organisational, technical, supplier, or threat changes.
3. Update documentation after significant incidents, exercises, audit findings, or failed tests.
4. Confirm that recovery requirements remain aligned with business impact analysis and risk assessment.
5. Ensure continuity requirements are considered during project delivery, system design, supplier onboarding, and change management.
6. Validate that backup, restoration, and recovery monitoring remains effective.
7. Include BCP/DR readiness in management review reporting.
8. Retain evidence of reviews, approvals, test results, and improvements.

Minimum evidence retention:

| Evidence Type | Retention Period | Custodian |
|---|---:|---|
| Approved BCP and DRP versions | [e.g., 7 years] or in accordance with records retention requirements | Business Continuity Manager |
| Test plans and test results | [e.g., 3 years] | Business Continuity Manager |
| Backup restoration evidence | [e.g., 3 years] | Infrastructure Manager |
| Corrective action records | [e.g., 3 years after closure] | Information Security Manager |
| Management review reports | [e.g., 3 years] | ISMS Manager |
| Supplier continuity evidence | For contract duration plus [retention period] | Supplier Manager |
| Training and awareness records | [e.g., 3 years] | HR / Department Heads |

## Milestones & Timeline

The following timeline establishes the implementation and recurring operation plan for BCP/DR readiness in support of ISO/IEC 27001:2022 Annex A.5.30.

| Milestone ID | Milestone | Key Activities | Deliverables | Owner | Target Date / Frequency | Status |
|---|---|---|---|---|---:|---|
| M1 | Initiate BCP/DR governance | Confirm scope, appoint owners, approve planning approach | Approved governance model and plan | Executive Sponsor | [YYYY-MM-DD] | [Not Started/In Progress/Complete] |
| M2 | Complete business impact analysis | Identify critical processes, impacts, MTPDs, RTOs, RPOs | Approved BIA | Business Continuity Manager | [YYYY-MM-DD] | [Not Started/In Progress/Complete] |
| M3 | Identify critical ICT dependencies | Map systems, data, suppliers, infrastructure, identity, network, and integrations | Criticality and dependency register | IT Operations Manager | [YYYY-MM-DD] | [Not Started/In Progress/Complete] |
| M4 | Define recovery strategies | Select continuity and recovery methods for critical services | BCP/DR strategy matrix | Disaster Recovery Coordinator | [YYYY-MM-DD] | [Not Started/In Progress/Complete] |
| M5 | Validate backup capability | Review backup coverage, retention, immutability, encryption, monitoring, restore evidence | Backup readiness assessment | Infrastructure Manager | [YYYY-MM-DD] | [Not Started/In Progress/Complete] |
| M6 | Develop or update BCP | Document invocation, roles, communications, workarounds, escalation, and return to normal | Approved BCP | Business Continuity Manager | [YYYY-MM-DD] | [Not Started/In Progress/Complete] |
| M7 | Develop or update DRP | Document technical recovery sequence, runbooks, validation steps, emergency access | Approved DRP and runbooks | Disaster Recovery Coordinator | [YYYY-MM-DD] | [Not Started/In Progress/Complete] |
| M8 | Conduct training and awareness | Train recovery teams and business process owners on responsibilities | Training records | Department Heads | [YYYY-MM-DD], then annually | [Not Started/In Progress/Complete] |
| M9 | Conduct BCP tabletop exercise | Test business escalation, communications, decisions, and workarounds | BCP tabletop test report | Business Continuity Manager | Annually | [Not Started/In Progress/Complete] |
| M10 | Conduct DR tabletop exercise | Validate technical response, sequencing, dependencies, and documentation | DR tabletop test report | Disaster Recovery Coordinator | Annually | [Not Started/In Progress/Complete] |
| M11 | Conduct backup restore tests | Restore selected data and validate integrity against RPO | Backup restore test evidence | Infrastructure Manager | Quarterly for critical systems | [Not Started/In Progress/Complete] |
| M12 | Conduct technical recovery test | Recover selected critical service and measure RTO/RPO | Technical recovery test report | IT Operations Manager | Annually for Priority 1 and 2 systems | [Not Started/In Progress/Complete] |
| M13 | Conduct cyber recovery exercise | Validate ransomware/destructive malware recovery scenario | Cyber recovery exercise report | Information Security Manager | Annually | [Not Started/In Progress/Complete] |
| M14 | Validate supplier continuity | Obtain supplier evidence and review recovery commitments | Supplier continuity validation record | Supplier Manager | Annually for critical suppliers | [Not Started/In Progress/Complete] |
| M15 | Complete corrective actions | Track and close issues from testing, incidents, audits, and reviews | Updated corrective action register | Information Security Manager | Monthly review until closure | [Not Started/In Progress/Complete] |
| M16 | Management review reporting | Report readiness, test results, risks, and improvements to leadership | ISMS management review input | ISMS Manager | At least annually | [Not Started/In Progress/Complete] |
| M17 | Annual plan review | Review and update BCP/DR documentation and test programme | Approved updated documents | Business Continuity Manager | Annually | [Not Started/In Progress/Complete] |

## Roles & Responsibilities

The following roles are responsible for planning, implementing, testing, maintaining, and improving business continuity and disaster recovery arrangements.

| Role | Responsibilities |
|---|---|
| Executive Sponsor | Provides executive authority, approves major continuity decisions, allocates resources, accepts residual risk, and supports management review reporting |
| Business Continuity Manager | Owns the BCP programme, coordinates BIA activities, maintains BCP documentation, plans exercises, records test results, tracks lessons learned, and reports readiness |
| Information Security Manager | Ensures continuity and recovery activities maintain security requirements, supports cyber recovery planning, validates security controls during recovery, and tracks ISMS corrective actions |
| ISMS Manager | Ensures alignment with ISO/IEC 27001:2022 requirements, maintains audit evidence, coordinates management review inputs, and monitors continual improvement |
| Disaster Recovery Coordinator | Owns DR planning, coordinates technical recovery exercises, maintains DRP and recovery runbooks, and reports technical recovery readiness |
| CIO / Head of IT | Provides accountability for ICT recovery capability, approves DR strategy, ensures technology resources are available, and authorises technical recovery activity |
| IT Operations Manager | Maintains operational recovery capability, infrastructure resilience, monitoring, restoration procedures, configuration recovery, and technical staff readiness |
| Infrastructure Manager | Owns backup, storage, server, network, and platform recovery arrangements, including restore testing and backup monitoring |
| Application Owners | Define application recovery requirements, validate restored applications, maintain application recovery runbooks, and support testing |
| Information Asset Owners | Confirm criticality, recovery needs, data integrity requirements, and acceptable workaround arrangements for information assets |
| Business Process Owners | Define business continuity requirements, approve RTO/RPO expectations, participate in BIA, validate business workarounds, and confirm recovered services meet business need |
| Incident Manager | Coordinates major incident response, escalation, impact assessment, and interface between incident management and BCP/DR invocation |
| Crisis Management Lead | Coordinates executive-level crisis response, stakeholder communications, decision logs, and external communications governance |
| Communications Lead | Prepares and issues approved internal and external communications during exercises and real events |
| Legal / Privacy Representative | Advises on regulatory, contractual, privacy, notification, and evidence preservation obligations during disruption |
| Supplier Manager | Ensures critical suppliers have continuity commitments, collects supplier test evidence, manages escalations, and reviews supplier recovery performance |
| Procurement / Contract Owner | Ensures continuity, availability, notification, audit, and recovery requirements are included in supplier agreements |
| HR / People Team | Supports staff communication, availability planning, role coverage, and training record maintenance |
| Facilities Manager | Supports facility continuity dependencies, physical access, power, environmental controls, and alternate site considerations |
| Service Desk | Receives disruption reports, initiates escalation, records incidents, communicates user-facing updates, and supports recovery coordination |
| Recovery Team Members | Execute assigned recovery tasks, participate in exercises, maintain readiness, report issues, and follow approved recovery procedures |
| Internal Audit / Assurance | Provides independent assurance over BCP/DR design and operating effectiveness where included in the audit programme |

RACI matrix:

| Activity | Executive Sponsor | Business Continuity Manager | Information Security Manager | Disaster Recovery Coordinator | IT Operations | Business Owners | Supplier Manager |
|---|---|---|---|---|---|---|---|
| Approve BCP/DR approach | A | R | C | C | C | C | C |
| Complete business impact analysis | C | A/R | C | C | C | R | C |
| Define RTO/RPO | C | A | C | C | R | R | C |
| Develop BCP | C | A/R | C | C | C | R | C |
| Develop DRP and runbooks | C | C | C | A/R | R | C | C |
| Define backup and restoration controls | C | C | C | C | A/R | C | C |
| Conduct BCP exercises | C | A/R | C | C | C | R | C |
| Conduct DR tests | C | C | C | A/R | R | C | C |
| Conduct cyber recovery exercise | C | C | A/R | R | R | C | C |
| Validate supplier continuity | C | C | C | C | C | C | A/R |
| Track corrective actions | C | R | A/R | R | R | C | C |
| Approve residual risk | A | C | C | C | C | C | C |
| Report to management review | A | R | R | C | C | C | C |

Legend:

- **R** = Responsible.
- **A** = Accountable.
- **C** = Consulted.
- **I** = Informed.

## Resources

The organisation shall provide sufficient resources to establish, operate, test, and improve BCP and DR capabilities.

### People Resources

| Resource | Required Capability | Allocation / Requirement |
|---|---|---|
| Business Continuity Manager | BIA, BCP development, exercise facilitation, continuity governance | Assigned named owner with sufficient time and authority |
| Disaster Recovery Coordinator | Technical recovery planning, runbook development, recovery testing | Assigned named owner with authority across IT teams |
| Infrastructure Engineers | Backup, restoration, network, server, cloud, storage, identity, monitoring | Available for planning, tests, and emergency response |
| Application Specialists | Application recovery, configuration, validation, data integrity checks | Available for critical systems recovery and testing |
| Cybersecurity Team | Incident containment, threat validation, secure recovery, monitoring | Integrated into cyber recovery and DR planning |
| Business Process Representatives | Impact assessment, workarounds, recovery validation | Available for BIA and exercises |
| Supplier Contacts | Provider escalation, recovery status, technical support | Maintained for all critical suppliers |
| Legal / Privacy / Communications | Regulatory advice, external messaging, customer and stakeholder communications | Available during exercises and invoked events |

### Technology Resources

| Resource | Continuity Purpose | Minimum Expectation |
|---|---|---|
| Backup platform | Data protection and restoration | Monitored, encrypted, access-controlled, tested, and protected from tampering |
| Immutable or offline backups | Protection against ransomware and destructive activity | Used for critical systems where justified by risk |
| Alternate recovery environment | Service restoration when primary environment is unavailable | Sized and tested according to recovery priorities |
| Configuration management repository | Rebuild of systems and infrastructure | Current, backed up, access-controlled, and restorable |
| Infrastructure-as-code or build automation | Consistent recovery and rebuild | Maintained for critical environments where feasible |
| Monitoring and alerting tools | Detection of failures and recovery validation | Available during disruption or replaced by fallback monitoring |
| Security monitoring tools | Detection of compromise during recovery | Integrated with incident response and recovery operations |
| Secure communications tools | Crisis and recovery coordination | At least one alternate channel independent of primary collaboration platform |
| Emergency access mechanism | Access to critical services when standard identity services fail | Controlled, logged, tested, and reviewed |
| Documentation repository | Access to BCP/DR documents | Secure, backed up, and accessible during primary system outage |

### Information Resources

| Resource | Required Content |
|---|---|
| Asset inventory | Critical systems, owners, locations, data classifications, dependencies |
| Business impact analysis | Business priorities, MTPD, RTO, RPO, impact tolerances |
| Data flow diagrams | Critical data movements, integrations, third-party connections |
| Network diagrams | Recovery-relevant network paths, firewall dependencies, DNS and routing |
| Cloud architecture diagrams | Regions, zones, replication, service dependencies, identity dependencies |
| Supplier register | Critical suppliers, contacts, SLAs, continuity evidence, contractual commitments |
| Access records | Privileged accounts, emergency accounts, approval requirements |
| Backup schedule | Scope, frequency, retention, storage location, encryption, restore method |
| Recovery runbooks | Step-by-step technical recovery actions and validation criteria |
| Contact lists | Internal, supplier, executive, legal, communications, and emergency contacts |

### Financial and Contractual Resources

| Resource | Purpose |
|---|---|
| Budget for recovery infrastructure | Supports alternate environments, additional capacity, replication, backup storage, and recovery tooling |
| Budget for testing | Supports scheduled exercises, technical tests, supplier participation, and external facilitation where required |
| Supplier support agreements | Ensures timely support during disruptive events and recovery testing |
| Cyber incident support agreements | Provides access to forensic, legal, crisis communications, and recovery specialists where required |
| Software and licence availability | Ensures required licences are available for recovery environments |
| Insurance and risk financing | Supports financial resilience but does not replace required continuity capability |

## Success Metrics

The organisation shall monitor BCP/DR readiness using measurable indicators. Metrics shall be reviewed by relevant management and included in ISMS management review where appropriate.

| Metric | Target | Measurement Method | Reporting Frequency | Owner |
|---|---:|---|---|---|
| Critical business processes with current BIA | 100% | BIA register review | Annually | Business Continuity Manager |
| Priority 1 and Priority 2 systems with approved RTO/RPO | 100% | Criticality register review | Quarterly | IT Operations Manager |
| Priority 1 and Priority 2 systems with current DR runbooks | 100% | Runbook inventory review | Quarterly | Disaster Recovery Coordinator |
| Backup job success rate for critical systems | ≥ [e.g., 98%] monthly | Backup monitoring reports | Monthly | Infrastructure Manager |
| Critical system backup restore tests completed on schedule | 100% | Test schedule and evidence review | Quarterly | Infrastructure Manager |
| Technical recovery tests completed for Priority 1 and Priority 2 systems | 100% annually | Test reports | Annually | Disaster Recovery Coordinator |
| BCP tabletop exercise completed | 1 per year minimum | Exercise report | Annually | Business Continuity Manager |
| Cyber recovery exercise completed | 1 per year minimum | Exercise report | Annually | Information Security Manager |
| Emergency contact list accuracy | ≥ [e.g., 95%] successful contact confirmation | Communications test results | Semi-annually | Crisis Management Lead |
| Critical suppliers with continuity evidence reviewed | 100% annually | Supplier review records | Annually | Supplier Manager |
| Corrective actions closed by due date | ≥ [e.g., 90%] | Corrective action register | Monthly | Information Security Manager |
| RTO achievement in recovery tests | ≥ [e.g., 95%] of tested services meet approved RTO | Test timestamps and reports | After each test | Disaster Recovery Coordinator |
| RPO achievement in restore tests | ≥ [e.g., 95%] of tested restores meet approved RPO | Restore logs and validation evidence | After each test | Infrastructure Manager |
| Recovery documentation reviewed after major change | 100% of applicable changes | Change records and document review evidence | Monthly | Change Manager |
| Recovery team training completion | 100% of assigned recovery personnel | Training records | Annually | Department Heads |

Test result rating criteria:

| Rating | Definition | Required Action |
|---|---|---|
| Pass | Objectives achieved, RTO/RPO met where applicable, no material control gaps identified | Record evidence and continue scheduled testing |
| Partial Pass | Core objectives achieved, but minor gaps, delays, or documentation issues identified | Record corrective actions and track to closure |
| Fail | Recovery objective not achieved, material gap identified, or test could not be completed | Escalate to accountable owner, raise corrective action, perform root cause analysis, and re-test after remediation |
| Deferred | Test could not be performed due to approved business, technical, or supplier constraint | Record reason, approve revised test date, and monitor completion |

Minimum evidence of success shall include:

1. Approved BIA and recovery requirements.
2. Current BCP and DRP.
3. Current system recovery runbooks for critical systems.
4. Evidence of backup monitoring and restoration testing.
5. Exercise and test reports showing results against defined objectives.
6. Corrective action register with status and ownership.
7. Supplier continuity evidence for critical suppliers.
8. Management review records showing oversight of continuity readiness.
9. Records of improvements implemented following tests, incidents, and reviews.

## Review & Update Triggers

This plan and associated BCP/DR documentation shall be reviewed at planned intervals and whenever material changes occur.

### Scheduled Reviews

| Item | Review Frequency | Reviewer / Approver |
|---|---:|---|
| Business Continuity Plan | At least annually | Business Continuity Manager / Executive Sponsor |
| Disaster Recovery Plan | At least annually | Disaster Recovery Coordinator / CIO or Head of IT |
| Business Impact Analysis | At least annually or after major business change | Business Continuity Manager / Business Process Owners |
| Criticality and dependency register | Quarterly | IT Operations Manager |
| Emergency contact list | Quarterly | Crisis Management Lead |
| Backup and restore arrangements | Quarterly for critical systems; at least annually for others | Infrastructure Manager |
| Supplier continuity evidence | Annually for critical suppliers | Supplier Manager |
| Test schedule | Annually and after material change | Business Continuity Manager |
| Corrective action register | Monthly until open actions are closed | Information Security Manager |
| Metrics and readiness reporting | At least annually via management review | ISMS Manager |

### Event-Based Update Triggers

This plan shall be reviewed and updated when any of the following occur:

1. Significant change to business processes, operating model, products, services, locations, or organisational structure.
2. Introduction, replacement, migration, or retirement of critical ICT services.
3. Material change to system architecture, cloud provider configuration, network design, identity services, backup platform, or hosting arrangement.
4. Significant change in data classification, regulatory obligations, contractual requirements, customer commitments, or service level expectations.
5. New or changed supplier supporting a critical business process or ICT service.
6. Major incident, disaster, cyber attack, ransomware event, prolonged outage, data corruption event, or near miss.
7. Failed or partially failed BCP/DR test.
8. Audit finding, risk assessment outcome, management review action, or nonconformity related to continuity or recovery.
9. Change in threat landscape affecting ICT resilience, including increased ransomware, destructive malware, denial-of-service, geopolitical, or supply chain risk.
10. Discovery that recovery documentation, contact information, credentials, dependencies, or recovery steps are inaccurate.
11. Change in risk appetite or executive direction.
12. Change to legal, regulatory, contractual, or industry requirements affecting continuity or recovery.
13. Merger, acquisition, divestiture, outsourcing, insourcing, or major restructuring.
14. Material change to insurance, risk financing, or contractual liability assumptions.

### Review Outputs

Each review shall produce documented evidence including:

| Review Output | Required Content |
|---|---|
| Review record | Date, reviewer, documents reviewed, scope of review |
| Change summary | Updates made or confirmation that no changes were required |
| Approval record | Evidence of approval by document owner or accountable authority |
| Action log | Corrective or improvement actions with owner and due date |
| Version history | Updated document version, date, summary, and approver |
| Communication record | Evidence that relevant stakeholders were informed of material changes |

### Version History

| Version | Date | Summary of Changes | Author | Approver |
|---|---:|---|---|---|
| 1.0 | [YYYY-MM-DD] | Initial version aligned to ISO/IEC 27001:2022 Annex A.5.30 | Business Continuity Manager | Executive Sponsor |