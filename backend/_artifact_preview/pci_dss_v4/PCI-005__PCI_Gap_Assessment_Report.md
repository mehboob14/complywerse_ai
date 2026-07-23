<!-- pci_dss_v4 / PCI-005 | type=Report | mode=markdown | model=gpt-5.5 | 48008 chars -->

| Metadata | Value |
|---|---|
| Document ID | [PCI-GAP-REPORT-001] |
| Version | 1.0 |
| Owner | [PCI Compliance Owner / CISO] |
| Effective Date | [YYYY-MM-DD] |
| Framework | PCI DSS v4.0.1 |
| Classification | Confidential — Internal Use Only |

## Purpose

This PCI Gap Assessment Report documents the results of a self-readiness assessment against the Payment Card Industry Data Security Standard version 4.0.1, covering all 12 PCI DSS requirements.

The purpose of this report is to:

- Assess the organisation’s current level of readiness for PCI DSS v4.0.1 validation.
- Identify gaps between current controls and PCI DSS v4.0.1 requirements.
- Provide management with a clear view of compliance risk, remediation priorities, and evidence readiness.
- Support preparation for formal PCI DSS assessment activities, including Self-Assessment Questionnaire completion, Attestation of Compliance, or Qualified Security Assessor review, as applicable.
- Establish an actionable remediation plan to address control deficiencies affecting the cardholder data environment.

This report is intended to support internal governance and readiness planning. It does not constitute a formal PCI DSS certification or validation unless explicitly accepted by the relevant acquiring bank, payment brand, or Qualified Security Assessor.

## Reporting Period & Scope

### Reporting Period

| Item | Description |
|---|---|
| Assessment Period | [Start Date] to [End Date] |
| Report Date | [YYYY-MM-DD] |
| Assessment Type | Internal PCI DSS v4.0.1 gap assessment / self-readiness review |
| Assessment Status | Draft for management review |
| Target Validation Date | [YYYY-MM-DD] |
| Prior Assessment Reference | [Previous PCI assessment / SAQ / ROC reference, if applicable] |

### In-Scope PCI DSS Environment

This assessment considered systems, processes, people, facilities, and third parties that store, process, or transmit account data, or that can impact the security of the cardholder data environment.

The following PCI DSS data elements were considered:

| Data Category | Examples | PCI DSS Relevance |
|---|---|---|
| Cardholder Data | Primary Account Number, cardholder name, expiration date, service code | Subject to PCI DSS where stored, processed, or transmitted |
| Sensitive Authentication Data | Full track data, CVV2/CVC2/CID, PINs/PIN blocks | Must not be stored after authorisation, even if encrypted |
| Account Data Flows | Payment authorisation, settlement, tokenisation, refunds, chargebacks | Used to determine scope and control applicability |
| Connected-to Systems | Administrative systems, identity platforms, logging tools, vulnerability scanners, jump hosts | In scope where they impact CDE security |

### In-Scope Business Processes

| Process | Description | In Scope |
|---|---|---|
| E-commerce payment acceptance | [Website/application] routes payment transactions via [payment gateway/provider] | Yes |
| Card-present payment acceptance | [Retail/POS location or terminal estate] | [Yes/No] |
| Mail/telephone order processing | Manual entry of payment card data by authorised personnel | [Yes/No] |
| Refund and chargeback processing | Use of merchant portals and payment administration tools | Yes |
| Customer support | Handling of customer payment queries and potential exposure to account data | [Yes/No] |
| Payment reconciliation | Settlement and finance reconciliation activities | Yes |
| Third-party payment services | Use of payment gateway, acquiring bank, tokenisation, managed service providers | Yes |

### In-Scope Technology Components

| Component Type | Examples Reviewed | Scope Rationale |
|---|---|---|
| Network segments | CDE VLANs, firewall zones, cloud security groups, remote access paths | Store, process, transmit, or connect to CDE |
| Servers and platforms | Payment application servers, database servers, web servers, administrative hosts | Support payment processing or CDE management |
| Applications | Payment application, checkout page, APIs, back-office payment tools | Process or transmit cardholder data |
| Databases and storage | Transaction databases, logs, backups, data warehouses | Potential storage of PAN or account data |
| Endpoints | Administrator workstations, POS terminals, support desktops | Access to CDE or payment administration functions |
| Identity systems | Directory services, SSO, MFA, privileged access management | Authenticate access to CDE and security functions |
| Security tools | SIEM, vulnerability scanner, file integrity monitoring, endpoint detection | Required for PCI DSS monitoring and protection |
| Cloud services | [Cloud provider/account/subscription], hosted payment services | CDE hosting or connected-to environment |
| Third-party services | [Payment gateway], [managed service provider], [hosting provider] | Affect CDE security or PCI DSS responsibility allocation |

### Exclusions and Assumptions

| Item | Description |
|---|---|
| Excluded environment | [Systems, locations, or business units excluded from PCI DSS scope] |
| Exclusion rationale | Excluded where no storage, processing, transmission of account data occurs and no connectivity exists to the CDE |
| Reliance on third parties | Assessment considered third-party Attestations of Compliance, responsibility matrices, and service descriptions where available |
| Sampling approach | Evidence was reviewed using risk-based sampling. Absence of sampled exceptions does not guarantee universal control effectiveness |
| Customised approach | No customised approach controls were formally validated during this assessment unless stated in the detailed findings |
| Compensating controls | Compensating controls were not accepted as compliant unless documented, justified, and mapped to PCI DSS intent and rigor requirements |

## Executive Summary

### Overall Readiness Conclusion

Based on the evidence reviewed during the assessment period, the organisation is **partially ready** for PCI DSS v4.0.1 validation. Foundational controls are present across several requirements; however, gaps remain in documented scope validation, vulnerability management cadence, access governance, evidence retention, targeted risk analyses, and operational monitoring.

The organisation should not proceed to formal validation until high-priority gaps are remediated, evidence is retained, and management has confirmed that PCI DSS controls are operating consistently across the full in-scope environment.

### Readiness Rating

| Rating | Definition |
|---|---|
| Ready | Control is designed, implemented, operating, and evidence is available for assessor review |
| Mostly Ready | Control is implemented with minor documentation or evidence gaps |
| Partially Ready | Control exists but is inconsistently implemented, incomplete, or not fully evidenced |
| Not Ready | Control is absent, materially deficient, or not operating |
| Not Applicable | Requirement does not apply based on confirmed scope and documented rationale |

Overall rating: **Partially Ready**

### Summary by PCI DSS Requirement

| PCI DSS Requirement | Requirement Area | Readiness Rating | Key Observation |
|---|---|---:|---|
| 1 | Install and maintain network security controls | Partially Ready | Network controls exist, but rule review evidence and CDE segmentation validation require improvement |
| 2 | Apply secure configurations to all system components | Partially Ready | Hardening standards are incomplete for all platforms and default configurations require stronger evidence |
| 3 | Protect stored account data | Partially Ready | Data discovery and retention controls require formalisation; encryption evidence is incomplete |
| 4 | Protect cardholder data with strong cryptography during transmission | Mostly Ready | TLS controls are generally implemented, but protocol inventory and certificate governance need strengthening |
| 5 | Protect systems and networks from malicious software | Mostly Ready | Anti-malware controls are deployed; exception management and coverage reporting need improvement |
| 6 | Develop and maintain secure systems and software | Partially Ready | Vulnerability remediation and secure SDLC controls are not consistently evidenced |
| 7 | Restrict access to system components and cardholder data by business need to know | Partially Ready | Role-based access exists but access justification and periodic review records are incomplete |
| 8 | Identify users and authenticate access to system components | Partially Ready | MFA and unique IDs are in place for many systems; privileged and service account governance requires remediation |
| 9 | Restrict physical access to cardholder data | Mostly Ready | Physical access controls exist; visitor logs and media handling procedures require evidence improvement |
| 10 | Log and monitor all access to system components and cardholder data | Partially Ready | Logging is enabled for key systems, but coverage, daily review, and alert response evidence are incomplete |
| 11 | Test security of systems and networks regularly | Partially Ready | Vulnerability scanning occurs, but segmentation testing, penetration testing, and scan remediation evidence are incomplete |
| 12 | Support information security with organisational policies and programs | Partially Ready | Policies exist; targeted risk analyses, security awareness, incident response testing, and service provider oversight require strengthening |

### Key Risks Identified

| Risk ID | Risk Statement | PCI DSS Area | Severity |
|---|---|---|---|
| R-01 | Incomplete PCI DSS scope documentation may result in under-scoping of systems that store, process, transmit, or can impact cardholder data. | Requirements 1, 2, 3, 12 | High |
| R-02 | Insufficient evidence of network segmentation testing may prevent reliance on segmentation to reduce PCI DSS scope. | Requirements 1, 11 | High |
| R-03 | Vulnerability remediation is not consistently completed within required timeframes, increasing exposure to exploitable weaknesses. | Requirements 6, 11 | High |
| R-04 | Privileged access and service account management controls are not sufficiently documented or periodically reviewed. | Requirements 7, 8 | High |
| R-05 | Logging and monitoring coverage is incomplete across all in-scope systems, affecting detection and investigation capability. | Requirement 10 | Medium |
| R-06 | Targeted risk analyses required by PCI DSS v4.0.1 are not consistently documented to justify control frequencies. | Requirement 12 and applicable requirements | Medium |
| R-07 | Third-party PCI DSS responsibility allocation is incomplete, creating uncertainty over control ownership and validation evidence. | Requirement 12 | Medium |

### Management Attention Required

The following activities require management sponsorship before formal PCI DSS validation:

1. Confirm and approve the PCI DSS scope, including CDE diagrams, data flows, system inventories, and third-party dependencies.
2. Complete remediation of high-severity gaps and verify implementation through evidence-based testing.
3. Establish targeted risk analyses where PCI DSS v4.0.1 requires entity-defined frequencies.
4. Validate segmentation controls through appropriate technical testing.
5. Complete access reviews for all in-scope systems, privileged users, service accounts, and third-party access.
6. Confirm all service providers with PCI DSS responsibilities have current compliance evidence and written responsibility matrices.
7. Ensure policies, procedures, logs, scan results, review records, and operational evidence are retained for assessor review.

## Methodology

### Assessment Approach

The assessment was conducted using the PCI DSS v4.0.1 requirements and testing procedures as the primary evaluation criteria. The assessment reviewed control design, implementation status, operating effectiveness evidence, and readiness for formal validation.

The methodology included:

- Review of PCI DSS v4.0.1 requirements and applicability.
- Review of cardholder data flows and network diagrams.
- Interviews with business, technology, security, operations, and compliance stakeholders.
- Review of policies, standards, procedures, and technical configuration evidence.
- Review of vulnerability management, access management, logging, monitoring, incident response, and third-party governance records.
- Sampling of in-scope systems and evidence artefacts.
- Identification of gaps, risk ratings, and recommended remediation actions.

### Evidence Sources Reviewed

| Evidence Category | Examples |
|---|---|
| Scope documentation | Cardholder data flow diagrams, network diagrams, CDE inventory, third-party inventory |
| Network security | Firewall configurations, rule review records, segmentation test results, remote access controls |
| Configuration management | Build standards, baseline configuration records, hardening benchmarks, change tickets |
| Data protection | Data retention schedules, encryption configurations, key management procedures, data discovery outputs |
| Transmission security | TLS configurations, certificate inventory, external service configuration records |
| Endpoint and malware protection | EDR/anti-malware console reports, exception records, alert handling records |
| Secure development | SDLC procedures, code review evidence, vulnerability remediation tickets, change approvals |
| Access control | User access lists, role definitions, access approval records, periodic access review evidence |
| Authentication | MFA configurations, password policies, privileged access records, service account inventory |
| Physical security | Badge access records, visitor logs, camera coverage, media storage and destruction records |
| Logging and monitoring | SIEM configuration, log source inventory, daily review records, alert triage evidence |
| Security testing | Vulnerability scans, penetration tests, segmentation tests, ASV scans, remediation evidence |
| Governance | Policies, risk analyses, incident response plans, awareness training records, service provider AOCs |

### Readiness Assessment Criteria

Each requirement area was assessed using the following criteria:

| Criterion | Description |
|---|---|
| Applicability | Whether the PCI DSS requirement applies to the organisation’s payment environment |
| Control design | Whether the control is appropriately designed to meet the PCI DSS intent |
| Implementation | Whether the control has been implemented across the applicable in-scope environment |
| Operating evidence | Whether evidence demonstrates consistent operation over the assessment period |
| Documentation | Whether policies, procedures, standards, and records are complete and current |
| Assessor readiness | Whether evidence would likely support formal assessment testing procedures |

### Severity Rating Model

| Severity | Definition | Expected Management Response |
|---|---|---|
| Critical | Gap creates immediate risk of cardholder data compromise or prevents validation of a fundamental PCI DSS control | Immediate remediation and executive oversight |
| High | Gap materially affects PCI DSS compliance or creates significant security risk | Remediate before formal validation |
| Medium | Gap affects consistency, evidence quality, or control maturity and may impact assessment outcomes | Remediate through planned corrective action |
| Low | Minor documentation, evidence, or process improvement opportunity | Address through normal compliance improvement cycle |

### Limitations

This report reflects evidence made available during the assessment period. The assessment did not include exhaustive technical testing of every system component unless explicitly noted. Formal PCI DSS validation may identify additional gaps based on assessor sampling, updated scope information, or changes in the environment.

## Detailed Findings / Results (with structure)

### Summary of Findings

| Severity | Number of Findings | Percentage |
|---|---:|---:|
| Critical | 0 | 0% |
| High | 6 | [Calculated %] |
| Medium | 9 | [Calculated %] |
| Low | 4 | [Calculated %] |
| Total | 19 | 100% |

### Requirement 1 — Install and Maintain Network Security Controls

PCI DSS v4.0.1 requires network security controls to be defined, implemented, maintained, and reviewed to protect the CDE from unauthorised access. This includes configuration standards, documented network diagrams, data flow diagrams, firewall and router rule management, segmentation controls, inbound and outbound traffic restrictions, and secure administration.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-001 | 1.2.3, 1.2.4, 1.2.5 | Network and data flow diagrams exist but do not fully identify all CDE connections, third-party connections, wireless networks, cloud security boundaries, and flows of account data. | High | Partially Ready | Update and approve diagrams to include all CDE systems, connected-to systems, data flows, security control points, and third-party connectivity. |
| PCI-GAP-002 | 1.2.7, 1.3.1, 1.4.1 | Firewall and network security control rule reviews are not consistently evidenced at the required frequency, and some rules lack documented business justification. | High | Partially Ready | Perform formal rule recertification, document business justification, remove obsolete rules, and retain review evidence. |
| PCI-GAP-003 | 1.4.2, 11.4.5 | Segmentation is used to reduce PCI DSS scope, but recent segmentation testing evidence is incomplete. | High | Partially Ready | Complete segmentation validation using appropriate penetration testing methods and document results, remediation, and retesting. |

### Requirement 2 — Apply Secure Configurations to All System Components

PCI DSS v4.0.1 requires secure configurations for all system components. Vendor defaults must be changed, unnecessary services removed, configuration standards maintained, and administrative access secured.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-004 | 2.2.1, 2.2.2, 2.2.4 | Configuration standards are not complete for all in-scope platforms, including cloud services, containers, databases, network devices, and administrator workstations. | Medium | Partially Ready | Define and approve secure configuration baselines for all in-scope component types aligned to recognised hardening standards. |
| PCI-GAP-005 | 2.2.3, 2.2.5, 2.2.6 | Evidence is incomplete to demonstrate that vendor defaults, default passwords, unnecessary services, and insecure functions are removed or disabled before deployment. | Medium | Partially Ready | Implement pre-production configuration verification and retain build validation evidence. |

### Requirement 3 — Protect Stored Account Data

PCI DSS v4.0.1 requires stored account data to be minimised, protected, rendered unreadable where PAN is stored, and managed under defined retention and disposal requirements. Sensitive authentication data must not be stored after authorisation.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-006 | 3.1.1, 3.2.1, 3.3.1 | The organisation has not completed recent documented discovery to confirm where PAN or sensitive authentication data may reside across databases, logs, file shares, backups, and reporting systems. | High | Partially Ready | Perform account data discovery across the CDE and connected repositories; remediate unauthorised storage and document results. |
| PCI-GAP-007 | 3.4.1, 3.5.1, 3.6.1 | Encryption and key management controls are implemented for primary systems, but key custodianship, rotation, storage, access restriction, and key inventory evidence are incomplete. | Medium | Partially Ready | Formalise cryptographic key management procedures, maintain key inventory, and evidence key lifecycle controls. |
| PCI-GAP-008 | 3.3.2, 3.4.2 | Data retention and disposal requirements for account data are documented at a high level but not mapped to all storage locations and retention mechanisms. | Medium | Partially Ready | Establish detailed account data retention schedule and disposal validation process for all repositories. |

### Requirement 4 — Protect Cardholder Data with Strong Cryptography During Transmission Over Open, Public Networks

PCI DSS v4.0.1 requires strong cryptography and security protocols to protect cardholder data during transmission over open, public networks.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-009 | 4.2.1, 4.2.1.1 | TLS is implemented for primary payment channels, but the organisation lacks a complete inventory of certificates, protocols, cipher suites, and external transmission points. | Medium | Mostly Ready | Maintain a cryptographic transmission inventory and validate protocols and cipher suites against current industry standards. |
| PCI-GAP-010 | 4.2.1 | Certificate renewal and secure configuration monitoring are operational but not governed by a formally approved procedure. | Low | Mostly Ready | Document certificate lifecycle management and assign ownership for monitoring, renewal, and misconfiguration response. |

### Requirement 5 — Protect All Systems and Networks from Malicious Software

PCI DSS v4.0.1 requires systems to be protected from malware, including deployment, maintenance, monitoring, and periodic evaluation of anti-malware solutions.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-011 | 5.2.1, 5.3.2, 5.3.3 | Anti-malware tooling is deployed to most in-scope endpoints and servers; however, coverage reporting does not clearly confirm protection across all CDE system components. | Medium | Mostly Ready | Produce regular anti-malware coverage reports and remediate unmanaged or unprotected assets. |
| PCI-GAP-012 | 5.3.2.1, 5.3.3 | Exceptions to anti-malware controls are not consistently documented with approval, justification, expiry, and compensating monitoring. | Low | Mostly Ready | Establish formal exception management for malware protection controls. |

### Requirement 6 — Develop and Maintain Secure Systems and Software

PCI DSS v4.0.1 requires vulnerabilities to be identified and remediated, secure development practices to be followed, custom software to be protected from attacks, and changes to be controlled.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-013 | 6.3.1, 6.3.3 | Vulnerability identification processes exist, but remediation of high and critical vulnerabilities is not consistently completed within defined PCI DSS timeframes or supported by closure evidence. | High | Partially Ready | Enforce vulnerability remediation SLAs, track exceptions, verify remediation, and retain evidence. |
| PCI-GAP-014 | 6.2.3, 6.2.4, 6.5.1 | Secure software development lifecycle controls are partially documented; developer training, code review, and application security testing records are incomplete. | Medium | Partially Ready | Document secure SDLC requirements, train developers, and retain evidence of code review and security testing. |
| PCI-GAP-015 | 6.4.1, 6.4.2, 6.4.3 | Change management records do not consistently evidence security impact analysis, testing, approval, and back-out plans for all CDE-affecting changes. | Medium | Partially Ready | Update change procedures and enforce complete change record evidence for all CDE-affecting changes. |

### Requirement 7 — Restrict Access to System Components and Cardholder Data by Business Need to Know

PCI DSS v4.0.1 requires access to system components and cardholder data to be restricted based on business need, least privilege, and documented authorisation.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-016 | 7.2.1, 7.2.2, 7.2.4 | Role-based access is used, but roles are not fully mapped to business need, least privilege, and CDE functions. | High | Partially Ready | Define PCI-specific roles, authorised privileges, business justification, and approval requirements. |
| PCI-GAP-017 | 7.2.5, 7.2.6 | Periodic access reviews are performed for some systems but are incomplete across all CDE systems, privileged accounts, third-party accounts, and security tools. | High | Partially Ready | Perform full access recertification and document reviewer, decisions, removals, and retained approvals. |

### Requirement 8 — Identify Users and Authenticate Access to System Components

PCI DSS v4.0.1 requires unique user identification, strong authentication, multi-factor authentication where required, secure account lifecycle management, and controls for shared, service, and application accounts.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-018 | 8.2.1, 8.2.2, 8.6.1 | Service accounts and application accounts are not fully inventoried with owners, purpose, authentication method, privilege level, and rotation requirements. | High | Partially Ready | Create service account inventory and implement lifecycle, rotation, monitoring, and approval controls. |
| PCI-GAP-019 | 8.4.1, 8.4.2, 8.4.3 | MFA is implemented for remote and administrative access in many areas, but evidence does not confirm full MFA coverage for all CDE access paths. | High | Partially Ready | Validate MFA enforcement across all access into the CDE, all administrative access, and all remote access. |
| PCI-GAP-020 | 8.3.4, 8.3.6, 8.3.9 | Password and authentication parameters are configured in core identity systems, but local accounts and non-federated systems require additional validation. | Medium | Partially Ready | Review all local and standalone authentication stores for PCI DSS alignment. |

### Requirement 9 — Restrict Physical Access to Cardholder Data

PCI DSS v4.0.1 requires physical access controls to protect systems and media containing cardholder data.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-021 | 9.2.1, 9.2.4, 9.4.1 | Physical access controls are in place at primary facilities, but visitor logs and escort evidence are not consistently retained for all relevant locations. | Medium | Mostly Ready | Retain visitor logs, escort records, and access approvals for all facilities housing CDE systems or media. |
| PCI-GAP-022 | 9.4.2, 9.4.5, 9.5.1 | Media handling, storage, transport, and destruction procedures exist but are not consistently supported by chain-of-custody and destruction evidence. | Low | Mostly Ready | Implement standard media tracking and destruction certification process. |

### Requirement 10 — Log and Monitor All Access to System Components and Cardholder Data

PCI DSS v4.0.1 requires audit logs to be implemented, protected, reviewed, retained, and monitored to detect suspicious activity and support investigations.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-023 | 10.2.1, 10.2.2, 10.2.3 | Logging is enabled for key systems, but the log source inventory does not demonstrate complete coverage of all in-scope system components and security events required by PCI DSS. | Medium | Partially Ready | Establish complete PCI log source inventory and validate required event logging across all CDE components. |
| PCI-GAP-024 | 10.4.1, 10.4.2, 10.4.3 | Daily log review and automated alert review evidence is incomplete, and responsibilities for review escalation are not consistently documented. | Medium | Partially Ready | Define daily review procedures, alert triage workflow, escalation criteria, and evidence retention. |
| PCI-GAP-025 | 10.5.1, 10.5.2, 10.5.3 | Log retention is configured in the SIEM, but evidence is incomplete to confirm at least one year retention with three months immediately available for all required logs. | Medium | Partially Ready | Validate and document log retention configuration and retrieval testing. |

### Requirement 11 — Test Security of Systems and Networks Regularly

PCI DSS v4.0.1 requires regular vulnerability scanning, external ASV scanning, penetration testing, segmentation testing, intrusion detection or prevention, change detection, and incident response to test findings.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-026 | 11.3.1, 11.3.1.2, 11.3.2 | Internal and external vulnerability scans are performed, but scan scope, authenticated coverage, rescans, and remediation closure evidence are incomplete. | High | Partially Ready | Ensure complete scan scope, authenticated internal scanning, remediation tracking, rescans, and retained passing results. |
| PCI-GAP-027 | 11.3.2 | External ASV scan evidence is not complete for all externally exposed in-scope assets. | High | Partially Ready | Confirm external PCI scope, conduct ASV scans for all applicable assets, and retain passing ASV reports. |
| PCI-GAP-028 | 11.4.1, 11.4.4, 11.4.5 | Penetration testing methodology does not fully document coverage of application-layer, network-layer, internal, external, and segmentation testing requirements. | High | Partially Ready | Update penetration testing methodology, perform required testing, remediate findings, and retest. |
| PCI-GAP-029 | 11.5.1, 11.5.2 | Intrusion detection/prevention and change detection capabilities exist but coverage and alert response evidence require improvement. | Medium | Partially Ready | Validate IDS/IPS and change detection coverage for CDE systems and document alert response handling. |

### Requirement 12 — Support Information Security with Organisational Policies and Programs

PCI DSS v4.0.1 requires an information security policy program, risk management, security awareness, incident response, service provider management, personnel responsibilities, and targeted risk analyses.

| Finding ID | Requirement Reference | Finding | Severity | Current Readiness | Required Remediation |
|---|---|---|---|---|---|
| PCI-GAP-030 | 12.1.1, 12.1.2, 12.1.3 | Security policies exist but do not fully map to PCI DSS v4.0.1 responsibilities, review cycles, and requirement-specific operational procedures. | Medium | Partially Ready | Update security policy suite to align with PCI DSS v4.0.1 and define review ownership. |
| PCI-GAP-031 | 12.3.1, 12.3.2 | Targeted risk analyses are not consistently documented for PCI DSS requirements that allow entity-defined frequencies or require risk-based justification. | Medium | Partially Ready | Complete targeted risk analyses for applicable controls and retain documented rationale and approvals. |
| PCI-GAP-032 | 12.6.1, 12.6.2, 12.6.3 | Security awareness training exists, but PCI-specific awareness, acceptable use, phishing/social engineering, and role-based training evidence is incomplete. | Medium | Partially Ready | Update training content and retain completion records for all relevant personnel. |
| PCI-GAP-033 | 12.8.1, 12.8.2, 12.8.4, 12.8.5 | Service provider oversight is incomplete; not all PCI-relevant providers have current AOCs, responsibility matrices, and monitoring records. | Medium | Partially Ready | Maintain PCI service provider register, collect annual AOCs, document responsibilities, and monitor compliance status. |
| PCI-GAP-034 | 12.10.1, 12.10.2, 12.10.4, 12.10.5 | Incident response plan exists but has not been fully tested against payment card compromise scenarios and PCI notification requirements. | Medium | Partially Ready | Conduct PCI-specific incident response exercise and update procedures for payment brand/acquirer notification. |

### Requirement-Level Evidence Readiness

| PCI DSS Requirement | Evidence Readiness | Evidence Gaps |
|---|---|---|
| 1 | Moderate | Current diagrams, firewall reviews, segmentation test evidence |
| 2 | Moderate | Platform-specific hardening standards and build verification evidence |
| 3 | Low | Data discovery, retention mapping, key management evidence |
| 4 | High | Transmission inventory and certificate lifecycle documentation |
| 5 | High | Coverage reports and exception records |
| 6 | Moderate | Vulnerability closure, secure SDLC evidence, change records |
| 7 | Low | Role mapping, access recertification, least privilege evidence |
| 8 | Low | MFA coverage validation, service account inventory |
| 9 | High | Visitor and media handling records |
| 10 | Moderate | Log source coverage, daily review records, retention validation |
| 11 | Low | ASV scans, authenticated scans, penetration testing, segmentation testing |
| 12 | Moderate | Targeted risk analyses, service provider AOCs, IR test evidence |

## Analysis

### Overall Control Maturity

The organisation has established several foundational security controls relevant to PCI DSS v4.0.1, including network security controls, identity management, malware protection, vulnerability scanning, security policies, and third-party payment service relationships. However, PCI DSS v4.0.1 requires demonstrable, repeatable, and evidenced operation of controls across the full in-scope environment. The principal compliance challenge is not the complete absence of controls, but inconsistent scope definition, incomplete evidence, and uneven control operation across systems and service providers.

The most significant readiness concerns relate to:

- Scope accuracy and completeness.
- Segmentation validation.
- Stored account data discovery and retention.
- Vulnerability remediation and retesting.
- Privileged and service account governance.
- MFA coverage assurance.
- Log monitoring evidence.
- Penetration testing and ASV evidence.
- Targeted risk analyses introduced or emphasised under PCI DSS v4.0.1.
- Service provider responsibility and compliance evidence.

### Scope and Segmentation Risk

Accurate PCI DSS scope is foundational. The organisation relies on technical and logical segmentation to limit the CDE; however, incomplete diagrams and segmentation testing evidence weaken the defensibility of scope reduction. A formal assessor may expand the scope if segmentation cannot be proven effective.

The absence of complete and current data flow diagrams also increases the risk that account data storage, logging, backups, support processes, or third-party connections are overlooked.

### Evidence Readiness Risk

Many controls appear to be operating in practice, but evidence is not retained in a manner that supports PCI DSS testing procedures. PCI DSS validation requires more than verbal confirmation. It requires documented procedures, configuration outputs, tickets, logs, review records, approvals, scan results, and retained artefacts.

Common evidence deficiencies include:

- Lack of dated approvals.
- Missing reviewer names and review outcomes.
- Incomplete system coverage.
- Unclear linkage between assets, controls, and evidence.
- Incomplete remediation closure evidence.
- Missing retest results after corrective action.
- Lack of formalised responsibility matrices for third parties.

### PCI DSS v4.0.1 Transition Considerations

PCI DSS v4.0.1 includes a stronger emphasis on continuous security, targeted risk analyses, explicit roles and responsibilities, multi-factor authentication, secure software practices, anti-phishing and awareness considerations, service provider monitoring, and evidence-based control operation.

Where the organisation relies on entity-defined control frequencies, those frequencies must be supported by targeted risk analysis. Without documented risk analysis, assessor acceptance may be limited.

### Highest Priority Compliance Dependencies

The following dependencies are likely to determine whether the organisation can proceed to formal validation successfully:

| Dependency | Why It Matters |
|---|---|
| Approved PCI scope | Determines all applicable systems, processes, people, facilities, and third-party services |
| Data discovery completion | Confirms whether PAN or sensitive authentication data is stored unexpectedly |
| Segmentation test completion | Supports scope reduction and confirms CDE isolation |
| Vulnerability remediation closure | Demonstrates protection against known exploitable weaknesses |
| MFA validation | Confirms compliance for CDE access and administrative access |
| Access recertification | Demonstrates least privilege and business need-to-know |
| Log coverage validation | Supports detection, investigation, and auditability |
| ASV and penetration testing | Required evidence for external exposure and security testing |
| Service provider evidence | Confirms shared responsibility and third-party PCI compliance |
| Targeted risk analyses | Supports PCI DSS v4.0.1 entity-defined frequencies and risk-based decisions |

## Recommendations & Actions

### Remediation Priorities

The organisation should prioritise remediation based on PCI DSS validation impact, cardholder data risk, and implementation dependency.

| Priority | Action Area | Target Outcome | Recommended Timing |
|---|---|---|---|
| 1 | PCI scope confirmation | Approved CDE scope, diagrams, inventories, and data flows | Immediate |
| 2 | Segmentation validation | Evidence that segmentation effectively isolates the CDE | Immediate |
| 3 | Data discovery and retention | Confirmation that account data is stored only where authorised and protected | Immediate |
| 4 | Vulnerability remediation | Closure of high and critical vulnerabilities with retest evidence | Immediate |
| 5 | Access and MFA remediation | Verified least privilege, access reviews, and MFA enforcement | Immediate |
| 6 | Logging and monitoring | Complete log coverage, retention, daily review, and alert response evidence | 30–60 days |
| 7 | Security testing evidence | Passing ASV scans, internal scans, penetration testing, segmentation tests | 30–60 days |
| 8 | Governance updates | PCI-aligned policies, targeted risk analyses, role assignments | 30–60 days |
| 9 | Service provider oversight | Current AOCs, responsibility matrices, and monitoring records | 30–60 days |
| 10 | Incident response readiness | Tested PCI-specific incident response process | 60–90 days |

### Corrective Action Plan

| Action ID | Related Finding(s) | Corrective Action | Owner | Due Date | Success Criteria | Status |
|---|---|---|---|---|---|---|
| CAP-001 | PCI-GAP-001 | Update PCI scope documentation, including CDE inventory, connected-to systems, data flows, network diagrams, and third-party connections. | [Owner] | [YYYY-MM-DD] | Approved PCI scope pack with diagrams and inventory | Open |
| CAP-002 | PCI-GAP-002 | Conduct firewall and network security control rule recertification for all CDE boundary controls. | [Owner] | [YYYY-MM-DD] | Rule review evidence with business justification and removal of obsolete rules | Open |
| CAP-003 | PCI-GAP-003, PCI-GAP-028 | Perform segmentation testing and document methodology, results, remediation, and retesting. | [Owner] | [YYYY-MM-DD] | Successful segmentation test report covering all segmentation boundaries | Open |
| CAP-004 | PCI-GAP-006, PCI-GAP-008 | Conduct PAN and sensitive authentication data discovery across databases, logs, files, backups, and reports. | [Owner] | [YYYY-MM-DD] | Discovery report with remediation of unauthorised storage | Open |
| CAP-005 | PCI-GAP-007 | Formalise cryptographic key management procedures and produce key inventory. | [Owner] | [YYYY-MM-DD] | Approved key management procedure and access-restricted key inventory | Open |
| CAP-006 | PCI-GAP-013, PCI-GAP-026 | Remediate overdue critical and high vulnerabilities and complete rescans. | [Owner] | [YYYY-MM-DD] | No overdue critical/high vulnerabilities; retest evidence retained | Open |
| CAP-007 | PCI-GAP-014, PCI-GAP-015 | Update secure SDLC and change management procedures for CDE-affecting systems. | [Owner] | [YYYY-MM-DD] | Secure coding, review, testing, approval, and back-out evidence retained | Open |
| CAP-008 | PCI-GAP-016, PCI-GAP-017 | Complete access role mapping and periodic access recertification for all CDE systems. | [Owner] | [YYYY-MM-DD] | Access review results, removals, approvals, and exceptions retained | Open |
| CAP-009 | PCI-GAP-018 | Create and approve service account inventory with owner, purpose, privilege, authentication, and rotation requirements. | [Owner] | [YYYY-MM-DD] | Complete service account register and lifecycle controls | Open |
| CAP-010 | PCI-GAP-019, PCI-GAP-020 | Validate MFA and authentication controls across all CDE access paths and local accounts. | [Owner] | [YYYY-MM-DD] | MFA coverage report and remediation of uncovered access paths | Open |
| CAP-011 | PCI-GAP-023, PCI-GAP-024, PCI-GAP-025 | Validate log source coverage, daily review process, alert workflow, and retention. | [Owner] | [YYYY-MM-DD] | Complete log source inventory and evidence of review and retention | Open |
| CAP-012 | PCI-GAP-027 | Conduct ASV scans for all externally exposed in-scope assets and remediate failures. | [Owner] | [YYYY-MM-DD] | Passing ASV scan reports retained | Open |
| CAP-013 | PCI-GAP-030, PCI-GAP-031 | Update PCI security policies and complete targeted risk analyses for applicable requirements. | [Owner] | [YYYY-MM-DD] | Approved policy suite and targeted risk analysis records | Open |
| CAP-014 | PCI-GAP-033 | Collect current service provider AOCs and complete PCI responsibility matrices. | [Owner] | [YYYY-MM-DD] | Current AOCs and signed responsibility matrices for all PCI providers | Open |
| CAP-015 | PCI-GAP-034 | Conduct PCI-specific incident response tabletop exercise. | [Owner] | [YYYY-MM-DD] | Exercise report, lessons learned, and updated IR procedures | Open |

### Evidence Pack Required Before Formal Validation

Before engaging in formal PCI DSS validation, the organisation should compile an evidence pack containing at minimum:

| Evidence Area | Required Artefacts |
|---|---|
| Scope | Approved PCI scope statement, system inventory, network diagrams, data flow diagrams, third-party connection list |
| Requirement 1 | Firewall standards, rule reviews, segmentation design, network access control evidence |
| Requirement 2 | Secure configuration standards, build evidence, default account removal evidence |
| Requirement 3 | Data discovery results, retention schedule, encryption evidence, key management records |
| Requirement 4 | TLS configuration evidence, certificate inventory, public transmission inventory |
| Requirement 5 | Anti-malware coverage report, alert records, exception approvals |
| Requirement 6 | Vulnerability reports, remediation tickets, secure SDLC evidence, change records |
| Requirement 7 | Role definitions, access approvals, least privilege mapping, access reviews |
| Requirement 8 | MFA evidence, user account settings, service account inventory, authentication policies |
| Requirement 9 | Physical access logs, visitor records, media handling and destruction records |
| Requirement 10 | Log source inventory, SIEM evidence, daily review records, retention validation |
| Requirement 11 | Internal scans, ASV scans, penetration tests, segmentation tests, IDS/IPS evidence |
| Requirement 12 | Policies, risk analyses, training records, incident response test, service provider AOCs |

### Proposed Remediation Timeline

| Phase | Timeline | Objectives | Key Deliverables |
|---|---|---|---|
| Phase 1 — Stabilise Scope and Critical Controls | Weeks 1–4 | Confirm PCI scope, identify all account data locations, remediate immediate high-risk control gaps | Scope pack, data discovery report, firewall review, vulnerability remediation plan |
| Phase 2 — Complete High-Priority Remediation | Weeks 5–8 | Address segmentation, vulnerability, MFA, access, and service account gaps | Segmentation test, access review, MFA report, service account inventory |
| Phase 3 — Evidence and Governance Completion | Weeks 9–12 | Complete policies, targeted risk analyses, logging evidence, service provider oversight | Policy updates, TRA records, SIEM evidence, AOCs and responsibility matrices |
| Phase 4 — Validation Readiness Review | Weeks 13–14 | Confirm remediation effectiveness and evidence completeness | Management readiness sign-off and assessor evidence pack |

### Management Decisions Required

| Decision | Required By | Impact if Delayed |
|---|---|---|
| Approve confirmed PCI DSS scope | [Date] | Formal validation may be delayed or scope may expand |
| Approve remediation funding/resources | [Date] | High-risk findings may remain unresolved |
| Confirm formal validation approach | [Date] | SAQ/ROC planning and assessor engagement may be delayed |
| Accept remediation timeline | [Date] | Control owners may lack clear accountability |
| Confirm third-party responsibility allocation | [Date] | Service provider evidence gaps may affect validation |

## Distribution & Confidentiality

### Distribution

This report is confidential and intended only for authorised personnel with responsibility for PCI DSS compliance, information security, technology operations, risk management, legal, audit, and executive oversight.

| Recipient / Group | Purpose |
|---|---|
| [Executive Sponsor] | Executive oversight and remediation sponsorship |
| [CISO / Security Lead] | Control ownership and remediation coordination |
| [PCI Compliance Owner] | PCI DSS readiness management and evidence coordination |
| [Technology Operations Lead] | Infrastructure, logging, vulnerability, and network remediation |
| [Application Owner(s)] | Secure development, change management, and payment application remediation |
| [Risk / Compliance Team] | Governance tracking and readiness reporting |
| [Internal Audit] | Independent review and assurance planning |
| [Qualified Security Assessor, if engaged] | Formal assessment planning and evidence review |
| [Acquiring Bank / Payment Brand, if required] | Only where formally authorised by management |

### Confidentiality Requirements

This report contains sensitive information about the organisation’s payment environment, security controls, vulnerabilities, network architecture, service providers, and compliance posture. Unauthorised disclosure could increase risk to cardholder data and the CDE.

The following restrictions apply:

- This report must not be distributed outside the organisation without written approval from [Authorising Executive].
- Extracts may be shared with third parties only where necessary for PCI DSS remediation or validation and subject to appropriate confidentiality obligations.
- Technical details, vulnerability information, diagrams, and system inventories must be handled as confidential security information.
- Copies must be stored only in approved repositories with access restricted to authorised personnel.
- Superseded versions must be archived or destroyed in accordance with the organisation’s information classification and retention requirements.
- Public disclosure of this report, its findings, or remediation details is prohibited unless required by law or authorised by executive management.

### Record Retention

| Record Type | Retention Period | Repository |
|---|---:|---|
| Final PCI Gap Assessment Report | [Retention Period] | [Approved GRC repository] |
| Evidence reviewed | [Retention Period] | [Evidence repository] |
| Remediation plan and status updates | [Retention Period] | [GRC / ticketing system] |
| Management approvals | [Retention Period] | [Governance repository] |
| Formal validation evidence | In accordance with PCI DSS, acquiring bank, and organisational requirements | [PCI evidence repository] |