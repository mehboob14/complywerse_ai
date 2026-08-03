<!-- pci_dss_v4 / PCI-009 | type=Report | mode=markdown | model=gpt-5.5 | 54430 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| PCI-REP-12.3-001 | 1.0 | [PCI Compliance Owner / CISO] | [Effective Date] | PCI DSS v4.0.1 | Requirement 12.3 | Confidential — Internal Use Only |

## Purpose

This report documents the annual risk assessment performed for the Cardholder Data Environment, hereafter referred to as the CDE, in support of PCI DSS v4.0.1 Requirement 12.3.

The purpose of this report is to:

- Formally identify and evaluate risks to the CDE.
- Confirm that threats and vulnerabilities affecting payment account data are understood and managed.
- Assess the adequacy of security controls supporting PCI DSS v4.0.1 compliance.
- Document risk decisions, residual risk, and required management actions.
- Support evidence requirements for PCI DSS Requirement 12.3 and related sub-requirements, including:
 - Risk analysis for defining and managing security control frequencies.
 - Annual confirmation of PCI DSS scope.
 - Annual review of hardware and software technologies in use.
 - Identification of risks associated with system components, people, processes, and third-party services that could affect cardholder data security.

This report is intended to provide management, control owners, PCI compliance stakeholders, and assessors with a clear and auditable record of the annual PCI risk assessment for the reporting period.

## Reporting Period & Scope

### Reporting Period

| Item | Details |
|---|---|
| Assessment Type | Annual PCI DSS Risk Assessment |
| Reporting Period Covered | [Start Date] to [End Date] |
| Assessment Fieldwork Period | [Fieldwork Start Date] to [Fieldwork End Date] |
| Report Date | [Report Date] |
| Next Scheduled Assessment | [Next Assessment Date] |
| Assessment Lead | [Assessment Lead Name / Role] |
| Approving Executive | [Executive Sponsor Name / Role] |

### PCI DSS Scope

This assessment covered the CDE and connected-to/security-impacting systems that store, process, transmit, or can affect the security of cardholder data.

The scope included:

- Systems that store, process, or transmit cardholder data.
- Systems connected to the CDE.
- Systems that provide security services to the CDE.
- Administrative access paths into the CDE.
- Network segmentation controls used to isolate the CDE.
- Third-party service providers that store, process, transmit, or could impact the security of cardholder data.
- Policies, standards, procedures, and operational processes supporting PCI DSS compliance.

### In-Scope Business Processes

| Business Process | Description | In Scope | Notes |
|---|---|---:|---|
| Card-present payment processing | Acceptance of payment cards through approved payment terminals | Yes | Includes terminal inventory, connectivity, and operational controls |
| E-commerce payment processing | Online customer card payment flow | Yes | Includes hosted payment page/API integration where applicable |
| Mail order / telephone order payment processing | Manual payment capture through authorised personnel | [Yes/No] | Applies only where payment data is received via phone/mail |
| Refund processing | Refund initiation and processing activities | Yes | Assessed for access control and transaction handling |
| Chargeback handling | Handling of disputes and transaction evidence | Yes | Assessed for exposure to cardholder data |
| Payment reconciliation | Finance reconciliation of payment records | Yes | Assessed for use of masked PAN and restricted access |
| Customer support | Customer payment-related enquiries | Yes | Assessed for access to payment systems and data handling |

### In-Scope Locations and Environments

| Location / Environment | Description | Scope Status |
|---|---|---|
| [Primary Office / Data Centre / Cloud Region] | [Description] | In scope |
| [Secondary Office / Disaster Recovery Site] | [Description] | In scope |
| [Cloud Environment / Account / Subscription] | [Description] | In scope |
| [Retail / Branch Locations] | [Description] | In scope |
| [Remote Administration Environment] | Administrative access into CDE | In scope |

### In-Scope System Components

| Component Category | Examples Included in Assessment |
|---|---|
| Payment applications | [Payment Application Names] |
| Web applications | [E-commerce Platform / Web Application Names] |
| Application servers | [Application Server Names / Groups] |
| Database servers | [Database Names / Clusters] |
| Network devices | Firewalls, routers, switches, load balancers, VPN concentrators |
| Security systems | SIEM, IDS/IPS, EDR, vulnerability scanners, WAF, file integrity monitoring |
| Identity and access systems | Directory services, MFA platform, privileged access management |
| Logging and monitoring systems | Central logging, alerting, time synchronisation services |
| End-user systems with CDE access | Administrative workstations, support workstations, jump hosts |
| Backup and recovery systems | Backup repositories, recovery platforms, key recovery processes |
| Cloud services | IaaS, PaaS, SaaS, storage, security monitoring, key management |
| Payment terminals | Card-present devices and associated management systems |

### Out-of-Scope Areas

The following areas were excluded from this PCI risk assessment because they do not store, process, transmit, or impact the security of cardholder data and are segmented from the CDE:

| Area | Reason for Exclusion | Validation Method |
|---|---|---|
| [Out-of-Scope Network / Business Unit] | No connectivity to CDE; no cardholder data processing | Segmentation review and network diagram validation |
| [Corporate SaaS Platform] | Does not store, process, or transmit cardholder data | Data flow review and vendor documentation |
| [Development Environment] | No production cardholder data permitted | Policy review, configuration review, sampling |

Any changes to systems, network connectivity, business processes, or third-party arrangements affecting cardholder data must trigger a PCI DSS scope review and risk reassessment in accordance with the organisation’s change management and PCI DSS governance processes.

## Executive Summary

The annual PCI risk assessment was completed for the reporting period identified above. The assessment evaluated risks to the confidentiality, integrity, and availability of cardholder data and the security of the CDE.

Overall, the CDE control environment is assessed as **[Effective / Partially Effective / Needs Improvement]**. The organisation maintains core PCI DSS controls, including network segmentation, access control, vulnerability management, logging, security awareness, incident response, and third-party oversight. However, this assessment identified risk areas requiring management attention to maintain compliance with PCI DSS v4.0.1 and reduce residual exposure.

### Overall Risk Rating

| Risk Category | Inherent Risk | Control Effectiveness | Residual Risk | Trend |
|---|---|---|---|---|
| CDE scope and segmentation | High | [Effective / Partially Effective] | [Low/Medium/High] | [Improving/Stable/Deteriorating] |
| Access control and authentication | High | [Effective / Partially Effective] | [Low/Medium/High] | [Improving/Stable/Deteriorating] |
| Vulnerability and patch management | High | [Effective / Partially Effective] | [Low/Medium/High] | [Improving/Stable/Deteriorating] |
| Logging, monitoring, and detection | High | [Effective / Partially Effective] | [Low/Medium/High] | [Improving/Stable/Deteriorating] |
| Cryptographic protections | High | [Effective / Partially Effective] | [Low/Medium/High] | [Improving/Stable/Deteriorating] |
| Third-party service provider risk | Medium | [Effective / Partially Effective] | [Low/Medium/High] | [Improving/Stable/Deteriorating] |
| Security awareness and personnel risk | Medium | [Effective / Partially Effective] | [Low/Medium/High] | [Improving/Stable/Deteriorating] |
| Technology lifecycle risk | Medium | [Effective / Partially Effective] | [Low/Medium/High] | [Improving/Stable/Deteriorating] |

### Key Conclusions

- The annual PCI DSS scope review was performed and confirmed that the documented CDE scope is **[accurate / accurate with exceptions / requires update]**.
- The risk assessment identified **[number]** risks requiring action, including **[number]** high-risk items, **[number]** medium-risk items, and **[number]** low-risk items.
- No evidence was identified that cardholder data is stored outside approved repositories; however, ongoing validation remains necessary for logs, support tools, and user-controlled storage locations.
- Network segmentation controls remain a critical dependency for reducing PCI DSS scope and must continue to be tested and monitored.
- Control frequencies requiring targeted risk analysis under PCI DSS v4.0.1 were reviewed and determined to be **[appropriate / requiring adjustment]**.
- Technology lifecycle review identified **[no unsupported technologies / unsupported or near end-of-life technologies requiring remediation]**.
- Third-party service provider evidence was reviewed for in-scope providers; **[all / some]** required PCI DSS compliance attestations were available and current.

### Summary of Findings

| Finding ID | Finding Title | Risk Rating | PCI DSS Relevance | Owner | Target Date |
|---|---|---:|---|---|---|
| PCI-RA-01 | [Finding Title] | High | Req 12.3, [Related Requirement] | [Owner] | [Date] |
| PCI-RA-02 | [Finding Title] | Medium | Req 12.3, [Related Requirement] | [Owner] | [Date] |
| PCI-RA-03 | [Finding Title] | Medium | Req 12.3, [Related Requirement] | [Owner] | [Date] |
| PCI-RA-04 | [Finding Title] | Low | Req 12.3, [Related Requirement] | [Owner] | [Date] |

### Management Attention Required

Management attention is required for:

1. Timely remediation of high and medium residual risks affecting the CDE.
2. Formal approval of any accepted residual risks.
3. Validation that PCI DSS scope documentation remains current following business, technology, and network changes.
4. Completion of action plans assigned in this report.
5. Ongoing tracking of remediation through the PCI governance forum or risk committee.

## Methodology

### Assessment Approach

The risk assessment followed a structured methodology aligned to PCI DSS v4.0.1 Requirement 12.3 and organisational risk management practices.

The assessment considered:

- Threats that could compromise cardholder data.
- Vulnerabilities in systems, processes, people, and third-party services.
- Likelihood of threat exploitation.
- Potential impact to cardholder data security and PCI DSS compliance.
- Existing preventive, detective, and corrective controls.
- Residual risk after consideration of current controls.
- Required remediation, risk acceptance, or control improvement actions.

### PCI DSS Requirement 12.3 Considerations

This assessment specifically considered the following PCI DSS v4.0.1 Requirement 12.3 expectations:

| PCI DSS Area | Assessment Consideration |
|---|---|
| Requirement 12.3 | Risks to the CDE are formally identified, evaluated, and managed |
| Req 12.3.1 | Targeted risk analyses are performed where PCI DSS allows frequencies to be defined by the entity |
| Req 12.3.2 | Targeted risk analyses are performed for requirements where periodicity is defined by risk |
| Req 12.3.3 | Cryptographic cipher suites and protocols are reviewed where required |
| Req 12.3.4 | Hardware and software technologies are reviewed at least once every 12 months |
| Req 12.3.5 | PCI DSS scope is documented and confirmed at least every 12 months and upon significant change |
| Req 12.3.6 | Security awareness training is reviewed to ensure personnel understand cardholder data security responsibilities |
| Req 12.3.7 | Personnel screening processes are considered where individuals have access to the CDE |
| Req 12.3.8 | PCI DSS applicability for third-party service provider relationships is considered where applicable |

### Information Sources Reviewed

The following information sources were reviewed during the assessment:

| Evidence Source | Reviewed | Notes |
|---|---:|---|
| Current PCI DSS scope document | Yes | Reviewed for accuracy against data flows and system inventory |
| CDE network diagrams | Yes | Reviewed for segmentation and connectivity |
| Cardholder data flow diagrams | Yes | Reviewed for storage, processing, and transmission paths |
| Asset inventory | Yes | Reviewed for in-scope system components |
| Payment application inventory | Yes | Reviewed for business process alignment |
| Firewall and segmentation documentation | Yes | Reviewed for CDE boundary controls |
| Vulnerability scan reports | Yes | Internal and external scans reviewed |
| Penetration test reports | Yes | Reviewed for CDE-related findings |
| ASV scan results | Yes | Reviewed for external exposure |
| Patch compliance reports | Yes | Reviewed for critical and high-risk vulnerabilities |
| Access review evidence | Yes | Reviewed for privileged and user access |
| MFA configuration evidence | Yes | Reviewed for administrative and remote access |
| Logging and monitoring evidence | Yes | Reviewed for security event visibility |
| Incident response records | Yes | Reviewed for CDE-related incidents |
| Security awareness training records | Yes | Reviewed for completion and content relevance |
| Third-party service provider attestations | Yes | AOCs/ROCs reviewed where applicable |
| Technology lifecycle register | Yes | Reviewed for unsupported or end-of-life components |
| Change management records | Sampled | Reviewed for CDE-impacting changes |
| Risk register | Yes | Reviewed for existing and open CDE risks |

### Interviews and Workshops

The following stakeholders were consulted:

| Function | Role / Team | Topics Covered |
|---|---|---|
| Information Security | [Security Team] | Threats, vulnerabilities, monitoring, incident response |
| IT Operations | [Infrastructure / Operations Team] | System administration, patching, backup, technology lifecycle |
| Network Engineering | [Network Team] | Segmentation, firewall rules, remote access |
| Application Owners | [Payment Application Owners] | Payment processing, application risks, change activity |
| Compliance | [PCI Compliance Team] | PCI DSS scope, evidence, control ownership |
| Finance / Payments | [Payments Operations Team] | Payment workflows and reconciliation |
| Customer Support | [Support Team] | Handling of cardholder data and call processes |
| Procurement / Vendor Management | [Vendor Management Team] | Third-party service provider oversight |
| Human Resources | [HR Team] | Security awareness, screening, role changes |

### Risk Rating Criteria

Risk ratings were determined using likelihood and impact. Residual risk reflects current controls in place at the time of assessment.

#### Likelihood Scale

| Rating | Description |
|---:|---|
| 1 — Rare | Unlikely to occur; no known active threat or material exposure |
| 2 — Unlikely | Could occur but not expected under normal conditions |
| 3 — Possible | Could occur due to known vulnerabilities, process gaps, or common threat activity |
| 4 — Likely | Expected to occur or has occurred previously |
| 5 — Almost Certain | Active, recurring, or highly probable exposure |

#### Impact Scale

| Rating | Description |
|---:|---|
| 1 — Insignificant | Minimal operational or compliance impact; no cardholder data exposure |
| 2 — Minor | Limited process or control impact; low likelihood of cardholder data compromise |
| 3 — Moderate | Material control weakness or compliance exposure; possible cardholder data impact |
| 4 — Major | Significant PCI DSS non-compliance or credible risk of cardholder data compromise |
| 5 — Severe | Actual or highly probable cardholder data compromise, regulatory impact, or major business disruption |

#### Risk Rating Matrix

| Score | Rating | Expected Treatment |
|---:|---|---|
| 1–4 | Low | Manage through routine controls and monitoring |
| 5–9 | Medium | Remediation plan required; management tracking recommended |
| 10–16 | High | Formal remediation plan required; senior management oversight required |
| 17–25 | Critical | Immediate action required; executive escalation required |

### Control Effectiveness Criteria

| Rating | Description |
|---|---|
| Effective | Control is designed appropriately, implemented, operating, and evidenced |
| Partially Effective | Control exists but has design, coverage, consistency, or evidence gaps |
| Ineffective | Control is absent, poorly designed, not operating, or not evidenced |
| Not Assessed | Control was outside the assessment scope or evidence was unavailable |

### Assumptions and Limitations

This assessment was based on evidence available during the fieldwork period and information provided by process and control owners. The assessment did not replace a PCI DSS Report on Compliance, Self-Assessment Questionnaire, penetration test, vulnerability scan, or forensic investigation. Where evidence was unavailable or incomplete, the risk rating reflects the uncertainty created by that limitation.

## Detailed Findings / Results

### 1. PCI DSS Scope and CDE Boundary

#### Assessment Result

The PCI DSS scope was reviewed against documented payment channels, data flows, network diagrams, system inventories, third-party services, and administrative access paths.

| Assessment Area | Result | Evidence Reviewed |
|---|---|---|
| CDE scope document exists | [Pass / Partial / Fail] | [Scope Document Name / Version] |
| Cardholder data flows documented | [Pass / Partial / Fail] | [Data Flow Diagram Name / Version] |
| Network diagrams reflect CDE boundaries | [Pass / Partial / Fail] | [Network Diagram Name / Version] |
| Connected-to and security-impacting systems identified | [Pass / Partial / Fail] | Asset inventory, firewall rules, IAM review |
| Segmentation controls documented | [Pass / Partial / Fail] | Firewall rules, VLANs, security groups |
| Annual scope confirmation completed | [Pass / Partial / Fail] | Scope review records |
| Scope review triggered by significant changes | [Pass / Partial / Fail] | Change records |

#### Finding PCI-RA-01: CDE Scope Documentation Requires Update

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-01 |
| Risk Rating | [High / Medium] |
| PCI DSS Reference | Req 12.3, Req 12.3.5 |
| Condition | The documented CDE scope does not fully reflect [new payment flow / cloud service / administrative access path / third-party integration]. |
| Criteria | PCI DSS requires the entity to document and confirm PCI DSS scope at least every 12 months and upon significant changes. |
| Cause | Scope documentation was not updated following [change / migration / new vendor onboarding]. |
| Risk | Incomplete scope may result in unassessed systems, omitted controls, inaccurate PCI DSS validation, and increased risk to cardholder data. |
| Current Controls | Change management, network diagrams, asset inventory, PCI compliance review. |
| Residual Risk | [High / Medium] |
| Required Action | Update scope documentation, validate data flows, confirm system inventory, and obtain management approval. |
| Owner | [Owner] |
| Target Date | [Date] |

### 2. Cardholder Data Storage, Processing, and Transmission

#### Assessment Result

The assessment reviewed whether cardholder data is stored, processed, and transmitted only through approved systems and whether sensitive authentication data is prohibited after authorisation.

| Assessment Area | Result | Evidence Reviewed |
|---|---|---|
| Approved cardholder data repositories identified | [Pass / Partial / Fail] | Data inventory, database review |
| Storage of PAN minimised | [Pass / Partial / Fail] | Application configuration, retention policy |
| PAN masking implemented where displayed | [Pass / Partial / Fail] | Application screenshots, role permissions |
| Sensitive authentication data not stored after authorisation | [Pass / Partial / Fail] | Data discovery, application design review |
| Transmission paths encrypted | [Pass / Partial / Fail] | TLS configuration, network flows |
| Logs reviewed for unintended PAN exposure | [Pass / Partial / Fail] | Log review sampling, SIEM queries |

#### Finding PCI-RA-02: Potential Exposure of PAN in Support or Log Data

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-02 |
| Risk Rating | [High / Medium] |
| PCI DSS Reference | Req 3, Req 4, Req 10, Req 12.3 |
| Condition | Sampling identified [potential / confirmed] instances where PAN may be present in [application logs / support tickets / exported reports]. |
| Criteria | Cardholder data storage must be minimised and protected, and PAN must not be exposed unnecessarily. |
| Cause | Logging and support handling controls do not consistently prevent capture of payment data. |
| Risk | Unauthorised disclosure of cardholder data, expanded PCI DSS scope, and non-compliance with data protection requirements. |
| Current Controls | Log retention controls, role-based access, support handling procedures. |
| Residual Risk | [High / Medium] |
| Required Action | Perform targeted data discovery, purge unauthorised PAN where permitted, implement masking/redaction, and update procedures. |
| Owner | [Owner] |
| Target Date | [Date] |

### 3. Targeted Risk Analyses and Defined Control Frequencies

#### Assessment Result

PCI DSS v4.0.1 permits certain control frequencies to be defined by the entity based on targeted risk analysis. The assessment reviewed whether defined frequencies are justified, documented, and approved.

| PCI DSS Activity | Current Frequency | Basis of Frequency | TRA Documented | Result |
|---|---:|---|---:|---|
| Review of user access privileges | [Quarterly] | Privileged access exposure and personnel movement | [Yes/No] | [Pass/Partial/Fail] |
| Review of service accounts | [Quarterly / Semi-annually] | Elevated access and non-human account risk | [Yes/No] | [Pass/Partial/Fail] |
| Review of firewall/security group rules | [Every 6 months] | CDE boundary risk | [Yes/No] | [Pass/Partial/Fail] |
| Review of logs/security events | [Daily] | Detection requirement and threat exposure | [Yes/No] | [Pass/Partial/Fail] |
| Vulnerability scanning | [Monthly / Quarterly] | Exposure and compliance requirement | [Yes/No] | [Pass/Partial/Fail] |
| Malware protection review | [Periodic] | Endpoint and server exposure | [Yes/No] | [Pass/Partial/Fail] |
| POI device inspection | [Periodic] | Device tampering risk | [Yes/No] | [Pass/Partial/Fail] |

#### Finding PCI-RA-03: Targeted Risk Analysis Evidence Incomplete for Defined Frequencies

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-03 |
| Risk Rating | Medium |
| PCI DSS Reference | Req 12.3.1, Req 12.3.2 |
| Condition | Some PCI DSS control frequencies were defined operationally but lacked documented targeted risk analysis demonstrating why the frequency is appropriate. |
| Criteria | Where PCI DSS requires a targeted risk analysis to define a frequency, the analysis must be documented, include risk factors, and support the selected frequency. |
| Cause | Operational schedules were established before PCI DSS v4.0.1 targeted risk analysis documentation was formalised. |
| Risk | Assessor challenge, inconsistent control operation, and inability to demonstrate that frequencies are risk-based and appropriate. |
| Current Controls | Operational calendars, recurring review activities, compliance tracking. |
| Residual Risk | Medium |
| Required Action | Complete targeted risk analyses for all entity-defined PCI DSS frequencies and obtain approval from risk owners. |
| Owner | [Owner] |
| Target Date | [Date] |

### 4. Vulnerability Management and Patch Risk

#### Assessment Result

The assessment reviewed vulnerability identification, prioritisation, remediation, and exception management for CDE systems.

| Assessment Area | Result | Evidence Reviewed |
|---|---|---|
| Internal vulnerability scans performed | [Pass / Partial / Fail] | Scan reports |
| External ASV scans performed | [Pass / Partial / Fail] | ASV attestations |
| Critical and high vulnerabilities tracked | [Pass / Partial / Fail] | Vulnerability register |
| Patch SLAs defined | [Pass / Partial / Fail] | Patch policy, tickets |
| Vulnerability exceptions approved | [Pass / Partial / Fail] | Exception records |
| Re-scans performed after remediation | [Pass / Partial / Fail] | Scan evidence |
| Penetration test findings tracked | [Pass / Partial / Fail] | Penetration test report, remediation plan |

#### Finding PCI-RA-04: Delayed Remediation of High-Risk Vulnerabilities

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-04 |
| Risk Rating | High |
| PCI DSS Reference | Req 6, Req 11, Req 12.3 |
| Condition | [Number] high-risk vulnerabilities affecting CDE or connected-to systems exceeded the defined remediation SLA. |
| Criteria | Vulnerabilities must be identified, risk-ranked, remediated, and verified in accordance with PCI DSS and organisational requirements. |
| Cause | Remediation delays due to [resource constraints / application compatibility / change windows / vendor dependency]. |
| Risk | Increased likelihood of exploitation, compromise of CDE systems, and potential cardholder data exposure. |
| Current Controls | Vulnerability scanning, patch management, change approval, compensating controls. |
| Residual Risk | High |
| Required Action | Prioritise remediation, document compensating controls where immediate patching is not feasible, and conduct verification scans. |
| Owner | [Owner] |
| Target Date | [Date] |

### 5. Access Control and Authentication Risk

#### Assessment Result

The assessment reviewed access provisioning, privileged access, MFA, service accounts, access reviews, and removal of terminated or transferred users.

| Assessment Area | Result | Evidence Reviewed |
|---|---|---|
| Role-based access implemented | [Pass / Partial / Fail] | IAM roles, access matrices |
| Access granted based on business need | [Pass / Partial / Fail] | Access requests |
| Privileged access restricted | [Pass / Partial / Fail] | Admin group membership |
| MFA enforced for CDE access | [Pass / Partial / Fail] | MFA configuration |
| User access reviews performed | [Pass / Partial / Fail] | Review records |
| Terminated users removed timely | [Pass / Partial / Fail] | HR termination samples |
| Service accounts inventoried and reviewed | [Pass / Partial / Fail] | Service account register |

#### Finding PCI-RA-05: Privileged Access Review Requires Strengthening

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-05 |
| Risk Rating | Medium |
| PCI DSS Reference | Req 7, Req 8, Req 12.3 |
| Condition | Evidence of privileged access review was incomplete for [system/application/group]. |
| Criteria | Access to CDE systems must be limited to authorised personnel based on job need and reviewed periodically. |
| Cause | Ownership of privileged access groups was not clearly assigned for all platforms. |
| Risk | Excessive or inappropriate privileged access could enable unauthorised changes, data access, or compromise. |
| Current Controls | MFA, access request workflow, directory group controls, logging. |
| Residual Risk | Medium |
| Required Action | Assign owners for all privileged groups, complete access recertification, and remove or justify unnecessary access. |
| Owner | [Owner] |
| Target Date | [Date] |

### 6. Logging, Monitoring, and Detection

#### Assessment Result

The assessment reviewed whether security events from CDE systems are logged, centralised, protected, retained, reviewed, and monitored.

| Assessment Area | Result | Evidence Reviewed |
|---|---|---|
| CDE systems send logs to central platform | [Pass / Partial / Fail] | SIEM source list |
| Critical security events captured | [Pass / Partial / Fail] | Logging configuration |
| Logs protected from unauthorised modification | [Pass / Partial / Fail] | SIEM access review |
| Time synchronisation configured | [Pass / Partial / Fail] | NTP configuration |
| Security alerts reviewed | [Pass / Partial / Fail] | Alert records |
| Log retention meets requirements | [Pass / Partial / Fail] | Retention configuration |
| Incident escalation procedures defined | [Pass / Partial / Fail] | Incident response plan |

#### Finding PCI-RA-06: Incomplete Log Source Coverage for CDE Supporting Systems

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-06 |
| Risk Rating | Medium |
| PCI DSS Reference | Req 10, Req 12.3 |
| Condition | [System / device category] logs were not consistently ingested into the central logging platform. |
| Criteria | CDE and security-impacting systems must generate and retain audit logs sufficient to detect and investigate suspicious activity. |
| Cause | Logging integration was not completed following [system deployment / migration / architecture change]. |
| Risk | Reduced detection capability and inability to investigate security events affecting cardholder data. |
| Current Controls | Local logging, SIEM monitoring for other systems, incident response process. |
| Residual Risk | Medium |
| Required Action | Integrate missing log sources, validate event types, configure alerts, and update the SIEM source inventory. |
| Owner | [Owner] |
| Target Date | [Date] |

### 7. Cryptography and Secure Transmission

#### Assessment Result

The assessment reviewed cryptographic protections for cardholder data transmission and storage, including cipher suites, protocols, certificate management, and key management dependencies.

| Assessment Area | Result | Evidence Reviewed |
|---|---|---|
| Strong cryptography used for cardholder data transmission | [Pass / Partial / Fail] | TLS scans, configuration review |
| Weak protocols disabled | [Pass / Partial / Fail] | SSL/TLS scan results |
| Certificates are current and managed | [Pass / Partial / Fail] | Certificate inventory |
| Cipher suites reviewed | [Pass / Partial / Fail] | Configuration baseline |
| Encryption keys managed securely | [Pass / Partial / Fail] | Key management procedures |
| Cryptographic technology lifecycle reviewed | [Pass / Partial / Fail] | Technology register |

#### Finding PCI-RA-07: Certificate and Cipher Suite Management Needs Formalisation

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-07 |
| Risk Rating | Medium |
| PCI DSS Reference | Req 3, Req 4, Req 12.3.3 |
| Condition | Cipher suite review and certificate inventory evidence was incomplete for [system/application]. |
| Criteria | Cryptographic protocols and cipher suites must be reviewed to confirm continued strength and suitability. |
| Cause | Cryptographic configuration review is performed technically but not consistently documented as part of PCI governance. |
| Risk | Weak or deprecated cryptography may remain in use, increasing risk of interception or compromise of cardholder data. |
| Current Controls | TLS configuration standards, automated certificate alerts, vulnerability scans. |
| Residual Risk | Medium |
| Required Action | Establish a formal annual cryptographic review, maintain certificate inventory, and remediate weak protocols/ciphers. |
| Owner | [Owner] |
| Target Date | [Date] |

### 8. Technology Lifecycle and Unsupported Systems

#### Assessment Result

The annual review of hardware and software technologies in use within the CDE was performed to identify unsupported, end-of-life, or high-risk technologies.

| Technology Category | Review Result | Risk Notes |
|---|---|---|
| Operating systems | [No issues / Issues identified] | [Details] |
| Databases | [No issues / Issues identified] | [Details] |
| Web/application platforms | [No issues / Issues identified] | [Details] |
| Network devices | [No issues / Issues identified] | [Details] |
| Security tools | [No issues / Issues identified] | [Details] |
| Payment applications | [No issues / Issues identified] | [Details] |
| Payment terminals | [No issues / Issues identified] | [Details] |
| Cloud services | [No issues / Issues identified] | [Details] |

#### Finding PCI-RA-08: End-of-Life Technology Identified in CDE-Supporting Environment

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-08 |
| Risk Rating | [High / Medium] |
| PCI DSS Reference | Req 6, Req 12.3.4 |
| Condition | [System / software / device] is approaching or has reached end-of-life or end-of-support. |
| Criteria | Hardware and software technologies must be reviewed at least once every 12 months to confirm they remain supported and secure. |
| Cause | Lifecycle tracking did not identify required upgrade timelines early enough for planned remediation. |
| Risk | Unsupported technology may not receive security patches, increasing vulnerability to exploitation and compliance risk. |
| Current Controls | Vulnerability scanning, compensating controls, network segmentation. |
| Residual Risk | [High / Medium] |
| Required Action | Develop and execute upgrade, replacement, isolation, or decommissioning plan. |
| Owner | [Owner] |
| Target Date | [Date] |

### 9. Third-Party Service Provider Risk

#### Assessment Result

Third-party service providers with access to, or impact on, cardholder data were reviewed for PCI DSS applicability, contractual responsibilities, and current compliance evidence.

| Service Provider | Service Provided | PCI Impact | Evidence Reviewed | Status |
|---|---|---|---|---|
| [Provider 1] | [Payment gateway / processor] | Stores/processes/transmits CHD | AOC, responsibility matrix | [Current / Expired / Pending] |
| [Provider 2] | [Cloud hosting] | Security-impacting CDE service | AOC, shared responsibility model | [Current / Expired / Pending] |
| [Provider 3] | [Managed security service] | Security monitoring | SOC report, contract, AOC if applicable | [Current / Expired / Pending] |
| [Provider 4] | [Support vendor] | Administrative access | Contract, access controls | [Current / Expired / Pending] |

#### Finding PCI-RA-09: Third-Party PCI Evidence Not Current for All Providers

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-09 |
| Risk Rating | Medium |
| PCI DSS Reference | Req 12.8, Req 12.3 |
| Condition | Current PCI DSS compliance evidence was not available for [Provider Name]. |
| Criteria | Service providers that store, process, transmit, or can affect the security of cardholder data must be monitored and their PCI DSS responsibilities understood. |
| Cause | Vendor evidence collection was not completed before expiration of prior documentation. |
| Risk | Inability to confirm third-party PCI DSS compliance and increased risk from outsourced payment functions. |
| Current Controls | Vendor register, contracts, annual vendor reviews. |
| Residual Risk | Medium |
| Required Action | Obtain current AOC/ROC or equivalent evidence, update responsibility matrix, and escalate if evidence is not provided. |
| Owner | [Owner] |
| Target Date | [Date] |

### 10. Security Awareness, Personnel, and Insider Risk

#### Assessment Result

The assessment reviewed security awareness training, personnel screening where applicable, acceptable use expectations, and role-based responsibilities for personnel with CDE access.

| Assessment Area | Result | Evidence Reviewed |
|---|---|---|
| Annual security awareness training completed | [Pass / Partial / Fail] | Training completion report |
| PCI-specific awareness included | [Pass / Partial / Fail] | Training content |
| Personnel with CDE access identified | [Pass / Partial / Fail] | Access lists |
| Role-based training provided where needed | [Pass / Partial / Fail] | Training records |
| Background screening performed where applicable | [Pass / Partial / Fail] | HR screening evidence |
| Termination and transfer processes reviewed | [Pass / Partial / Fail] | HR/IAM samples |

#### Finding PCI-RA-10: PCI-Specific Training Requires Improved Coverage

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-10 |
| Risk Rating | Low / Medium |
| PCI DSS Reference | Req 12.6, Req 12.3.6 |
| Condition | General security awareness training is completed, but PCI-specific content for personnel handling payment data is [limited / not role-specific / not consistently completed]. |
| Criteria | Personnel must be aware of their responsibilities for protecting cardholder data. |
| Cause | Training programme does not fully differentiate payment-handling roles from general users. |
| Risk | Personnel may mishandle cardholder data, increasing risk of unauthorised storage, disclosure, or process non-compliance. |
| Current Controls | Annual security awareness training, acceptable use policy, support procedures. |
| Residual Risk | [Low / Medium] |
| Required Action | Add PCI-specific modules for payment, support, finance, IT administration, and incident response roles. |
| Owner | [Owner] |
| Target Date | [Date] |

### 11. Incident Response and Resilience

#### Assessment Result

The assessment reviewed readiness to respond to suspected or confirmed compromise of cardholder data.

| Assessment Area | Result | Evidence Reviewed |
|---|---|---|
| Incident response plan includes payment data incidents | [Pass / Partial / Fail] | Incident response plan |
| PCI contact and escalation paths defined | [Pass / Partial / Fail] | Contact list |
| Payment brands/acquirer notification process defined | [Pass / Partial / Fail] | Incident procedures |
| Incident response testing performed | [Pass / Partial / Fail] | Tabletop records |
| Forensic investigation readiness considered | [Pass / Partial / Fail] | IR retainer, evidence handling procedures |
| Lessons learned tracked | [Pass / Partial / Fail] | Post-incident reports |

#### Finding PCI-RA-11: PCI Incident Response Scenario Testing Should Be Expanded

| Attribute | Detail |
|---|---|
| Finding ID | PCI-RA-11 |
| Risk Rating | Medium |
| PCI DSS Reference | Req 12.10, Req 12.3 |
| Condition | Incident response testing occurred, but did not fully test a suspected cardholder data compromise scenario involving [payment application / third-party provider / e-commerce channel]. |
| Criteria | Incident response procedures must be tested and capable of supporting timely response to cardholder data security events. |
| Cause | Recent exercises focused on general cyber incidents rather than PCI-specific escalation and evidence handling. |
| Risk | Delayed containment, incomplete notification, or poor evidence preservation during a payment data incident. |
| Current Controls | Incident response plan, security monitoring, escalation process. |
| Residual Risk | Medium |
| Required Action | Conduct PCI-specific tabletop exercise and update procedures based on lessons learned. |
| Owner | [Owner] |
| Target Date | [Date] |

### 12. Summary Risk Register

| Risk ID | Risk Statement | Likelihood | Impact | Inherent Risk | Control Effectiveness | Residual Risk | Treatment |
|---|---|---:|---:|---|---|---|---|
| PCI-RSK-001 | Incomplete PCI DSS scope may result in unassessed systems affecting cardholder data security. | 3 | 4 | High | [Partial] | [High/Medium] | Mitigate |
| PCI-RSK-002 | Cardholder data may be exposed through logs, reports, or support tools. | 3 | 5 | High | [Partial] | [High/Medium] | Mitigate |
| PCI-RSK-003 | Defined control frequencies may not be supported by documented targeted risk analysis. | 3 | 3 | Medium | [Partial] | Medium | Mitigate |
| PCI-RSK-004 | Delayed remediation of vulnerabilities may increase likelihood of CDE compromise. | 4 | 4 | High | [Partial] | High | Mitigate |
| PCI-RSK-005 | Excessive privileged access may allow unauthorised activity in the CDE. | 3 | 4 | High | [Partial] | Medium | Mitigate |
| PCI-RSK-006 | Incomplete log source coverage may reduce detection and investigation capability. | 3 | 4 | High | [Partial] | Medium | Mitigate |
| PCI-RSK-007 | Weak cryptography or unmanaged certificates may compromise secure transmission. | 2 | 4 | Medium | [Partial] | Medium | Mitigate |
| PCI-RSK-008 | Unsupported technology may expose the CDE to unpatched vulnerabilities. | 3 | 4 | High | [Partial] | [High/Medium] | Mitigate |
| PCI-RSK-009 | Third-party provider compliance evidence may be incomplete or expired. | 3 | 3 | Medium | [Partial] | Medium | Mitigate |
| PCI-RSK-010 | Personnel may mishandle cardholder data due to insufficient PCI-specific awareness. | 2 | 3 | Medium | [Partial] | [Low/Medium] | Mitigate |

## Analysis

### Overall Control Environment

The annual risk assessment indicates that the organisation has established a PCI DSS governance and control framework for the CDE. Key foundational controls are present, including:

- Defined PCI DSS ownership and compliance governance.
- Documented payment data flows and network diagrams.
- Network segmentation controls supporting scope reduction.
- Vulnerability scanning and patch management processes.
- Access control, MFA, and privileged access management controls.
- Centralised logging and security monitoring.
- Security awareness training.
- Incident response procedures.
- Third-party service provider oversight.

However, the assessment also identified areas where control operation, documentation, or evidence needs strengthening. These issues do not necessarily indicate a failure of the overall PCI programme, but they require timely remediation to maintain audit readiness and reduce residual risk.

### Risk Themes

#### 1. Scope Accuracy Remains a Critical Dependency

PCI DSS scope accuracy is foundational. If systems, data flows, administrative access paths, or third-party services are omitted from scope, related PCI DSS controls may not be applied or assessed. The assessment identified that scope documentation must be maintained more dynamically following significant changes.

Key drivers include:

- Cloud service adoption.
- New or modified payment integrations.
- Changes to administrative access paths.
- Third-party service changes.
- Network segmentation changes.

The annual scope review should remain supported by change-triggered scope impact assessments throughout the year.

#### 2. Control Frequencies Must Be Demonstrably Risk-Based

PCI DSS v4.0.1 places greater emphasis on targeted risk analysis where the entity defines control frequency. Operationally, many control activities are performed on a periodic basis, but documentation must clearly show why those frequencies are appropriate based on risk.

Targeted risk analyses should include:

- Assets and data affected.
- Threats and vulnerabilities.
- Control objective.
- Historical incidents or control failures.
- Exposure and business impact.
- Rationale for selected frequency.
- Approval by accountable risk owner.
- Review date and next review date.

Without this documentation, assessors may determine that the organisation has not fully met the intent of Requirement 12.3.

#### 3. Vulnerability and Technology Lifecycle Risk Requires Continued Prioritisation

Unpatched vulnerabilities and unsupported technologies remain among the highest-risk areas for the CDE. PCI DSS requires not only detection of vulnerabilities but effective remediation and verification. Delays caused by operational constraints should be formally risk-assessed, documented, and subject to compensating or interim controls.

Technology lifecycle management should be treated as a proactive PCI DSS control, not simply an IT asset management activity. Early identification of end-of-life components reduces emergency remediation and supports planned replacement.

#### 4. Detection Coverage Must Match CDE Scope

Logging and monitoring controls are effective only if all relevant CDE and security-impacting systems are included. Any gaps in log coverage reduce the organisation’s ability to detect unauthorised activity, investigate incidents, and demonstrate PCI DSS compliance.

Log source coverage should be reconciled regularly against:

- CDE asset inventory.
- Network diagrams.
- Cloud resources.
- Security tools.
- Privileged access paths.
- Payment applications and databases.

#### 5. Third-Party Risk Is Material to PCI DSS Compliance

Third-party service providers often perform functions directly relevant to PCI DSS, including payment processing, hosting, security monitoring, support, and application services. The organisation remains responsible for confirming service provider PCI DSS status and understanding the division of control responsibilities.

Current attestations, responsibility matrices, and contractual obligations must be maintained to prevent assurance gaps.

### Residual Risk Position

Based on current evidence, residual risk to the CDE is assessed as **[Low / Medium / High]** overall.

This rating reflects:

- The sensitivity of cardholder data.
- The threat landscape affecting payment environments.
- The importance of scope accuracy and segmentation.
- The number and severity of open findings.
- The maturity of existing controls.
- The extent of evidence available to support operating effectiveness.

Residual risk will reduce when high and medium findings are remediated, targeted risk analyses are completed, and evidence gaps are closed.

### Compliance Impact

The findings in this report may affect PCI DSS assessment readiness if not remediated before the next formal PCI DSS validation activity. Particular attention should be given to:

- Requirement 12.3 evidence completeness.
- Requirement 12.3.1 and 12.3.2 targeted risk analyses.
- Requirement 12.3.4 technology lifecycle review.
- Requirement 12.3.5 scope confirmation.
- Related controls under Requirements 3, 4, 6, 7, 8, 10, 11, 12.8, and 12.10.

The organisation should ensure that remediation evidence is retained in the PCI DSS evidence repository and mapped to the relevant PCI DSS requirements.

## Recommendations & Actions

### Priority Recommendations

1. **Update and approve PCI DSS scope documentation**
 - Validate all cardholder data flows, connected systems, third-party services, and administrative access paths.
 - Reconcile scope documentation with the asset inventory, network diagrams, firewall/security group rules, and payment process documentation.
 - Retain management approval as PCI DSS evidence.

2. **Complete targeted risk analyses for entity-defined control frequencies**
 - Identify all PCI DSS controls where frequency is defined by the organisation.
 - Document targeted risk analyses supporting each frequency.
 - Obtain approval from accountable control and risk owners.
 - Review at least annually and when significant changes occur.

3. **Remediate high-risk vulnerabilities and document exceptions**
 - Prioritise overdue high and critical vulnerabilities affecting CDE or connected-to systems.
 - Implement interim controls for vulnerabilities that cannot be remediated immediately.
 - Conduct re-scans to confirm remediation.
 - Escalate overdue remediation through governance channels.

4. **Strengthen data discovery and logging controls to prevent unintended PAN exposure**
 - Conduct targeted searches across logs, support tools, file shares, reports, and data exports.
 - Implement masking, redaction, or prevention controls where needed.
 - Confirm retention and disposal practices for any unauthorised cardholder data.

5. **Formalise technology lifecycle review**
 - Maintain a CDE technology register with vendor support dates.
 - Identify technologies within 12 months of end-of-support.
 - Establish upgrade, replacement, isolation, or decommissioning plans.
 - Track lifecycle risk through the PCI risk register.

6. **Improve evidence management for third-party service providers**
 - Obtain current Attestations of Compliance or equivalent evidence for all in-scope providers.
 - Maintain PCI responsibility matrices.
 - Track evidence expiry dates and renewal owners.
 - Escalate non-responsive or non-compliant providers.

7. **Expand PCI-specific training and incident response exercises**
 - Provide role-specific training for personnel handling or supporting cardholder data.
 - Conduct a PCI-focused incident response tabletop exercise.
 - Include payment brand/acquirer notification, evidence preservation, and third-party escalation.

### Remediation Action Plan

| Action ID | Related Finding | Action Required | Priority | Owner | Due Date | Evidence Required | Status |
|---|---|---|---|---|---|---|---|
| PCI-ACT-001 | PCI-RA-01 | Update PCI DSS scope documentation and obtain approval | High | [Owner] | [Date] | Approved scope document, updated diagrams, data flows | [Open/In Progress/Closed] |
| PCI-ACT-002 | PCI-RA-02 | Perform PAN discovery and remediate unauthorised storage | High | [Owner] | [Date] | Discovery results, purge records, masking controls | [Open/In Progress/Closed] |
| PCI-ACT-003 | PCI-RA-03 | Complete targeted risk analyses for all defined frequencies | Medium | [Owner] | [Date] | TRA forms, approvals, frequency register | [Open/In Progress/Closed] |
| PCI-ACT-004 | PCI-RA-04 | Remediate overdue high-risk vulnerabilities | High | [Owner] | [Date] | Patch tickets, rescan results, exception approvals | [Open/In Progress/Closed] |
| PCI-ACT-005 | PCI-RA-05 | Complete privileged access review and remove excessive access | Medium | [Owner] | [Date] | Access review evidence, removal tickets | [Open/In Progress/Closed] |
| PCI-ACT-006 | PCI-RA-06 | Integrate missing CDE log sources into SIEM | Medium | [Owner] | [Date] | SIEM source inventory, test alerts, log samples | [Open/In Progress/Closed] |
| PCI-ACT-007 | PCI-RA-07 | Complete cryptographic configuration and certificate review | Medium | [Owner] | [Date] | TLS scan results, certificate inventory, remediation tickets | [Open/In Progress/Closed] |
| PCI-ACT-008 | PCI-RA-08 | Develop lifecycle plan for unsupported or at-risk technology | High / Medium | [Owner] | [Date] | Upgrade plan, decommission plan, risk acceptance if applicable | [Open/In Progress/Closed] |
| PCI-ACT-009 | PCI-RA-09 | Obtain current PCI evidence from service providers | Medium | [Owner] | [Date] | AOC/ROC, responsibility matrix, vendor review record | [Open/In Progress/Closed] |
| PCI-ACT-010 | PCI-RA-10 | Deploy PCI-specific role-based awareness training | Low / Medium | [Owner] | [Date] | Training content, completion report | [Open/In Progress/Closed] |
| PCI-ACT-011 | PCI-RA-11 | Conduct PCI-specific incident response tabletop exercise | Medium | [Owner] | [Date] | Exercise plan, attendance, lessons learned, updated IR plan | [Open/In Progress/Closed] |

### Risk Treatment Requirements

All risks identified in this report must be treated using one of the following approved treatment options:

| Treatment Option | Description | Approval Requirement |
|---|---|---|
| Mitigate | Implement controls or remediation to reduce likelihood or impact | Control owner and risk owner approval |
| Avoid | Discontinue the activity causing the risk | Executive approval where business impact exists |
| Transfer | Transfer part of the risk through contractual, insurance, or outsourced controls | Legal/procurement and risk owner approval |
| Accept | Formally accept residual risk where remediation is not feasible or cost-effective | Senior management approval required |

High and critical residual risks must not be accepted without documented business justification, compensating controls where applicable, defined expiry date, and approval by [Risk Committee / Executive Sponsor].

### Management Approval

| Role | Name | Approval / Review | Date |
|---|---|---|---|
| PCI Compliance Owner | [Name] | Reviewed | [Date] |
| Chief Information Security Officer | [Name] | Approved | [Date] |
| IT Operations Owner | [Name] | Reviewed | [Date] |
| Business Owner for Payments | [Name] | Reviewed | [Date] |
| Risk Management Representative | [Name] | Reviewed | [Date] |
| Executive Sponsor | [Name] | Approved | [Date] |

## Distribution & Confidentiality

### Distribution List

This report contains sensitive information about the CDE, PCI DSS scope, security controls, vulnerabilities, third-party dependencies, and residual risks. Distribution must be limited to personnel with a legitimate business need.

| Recipient / Group | Purpose |
|---|---|
| [CISO / Security Leadership] | Risk oversight and remediation prioritisation |
| [PCI Compliance Team] | PCI DSS evidence and control tracking |
| [IT Operations Leadership] | Remediation and operational control ownership |
| [Application Owners] | Payment application risk remediation |
| [Network Engineering] | Segmentation, firewall, and connectivity remediation |
| [Risk Committee] | Risk governance and acceptance decisions |
| [Internal Audit] | Assurance planning and audit coordination |
| [Qualified Security Assessor / Assessor] | PCI DSS assessment evidence, where authorised |
| [Executive Sponsor] | Management accountability and funding decisions |

### Confidentiality Requirements

This report is classified as **Confidential — Internal Use Only**.

Recipients must:

- Not distribute this report outside approved recipients without authorisation from [PCI Compliance Owner / CISO].
- Store the report only in approved repositories with access controls.
- Not upload the report to unauthorised collaboration platforms, public repositories, or personal storage.
- Treat vulnerability, architecture, and control weakness information as sensitive security information.
- Redact sensitive technical details before sharing extracts with third parties unless approved.
- Ensure any external sharing is covered by appropriate contractual confidentiality obligations.

### Retention

| Record Type | Minimum Retention Period | Repository |
|---|---:|---|
| Final annual PCI risk assessment report | [Retention Period, e.g., 3 years] | [Approved GRC / PCI Evidence Repository] |
| Supporting evidence | [Retention Period] | [Evidence Repository] |
| Risk treatment approvals | [Retention Period] | [Risk Register / GRC Platform] |
| Remediation evidence | [Retention Period] | [Ticketing / GRC Platform] |
| Management approval records | [Retention Period] | [GRC Repository] |

### Review and Follow-Up

The remediation action plan must be reviewed at least monthly until all high and medium actions are closed. Status updates must be reported to [PCI Governance Forum / Risk Committee].

A follow-up validation must be performed by [Responsible Team] to confirm that remediation actions are complete and effective. Evidence of closure must be retained and mapped to the applicable PCI DSS requirements.