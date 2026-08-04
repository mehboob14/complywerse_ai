<!-- pci_dss_v4 / PCI-008 | type=Report | mode=markdown | model=gpt-5.5 | 42504 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [PCI-TRA-12.3.1-AF] | 1.0 | [CISO / PCI Compliance Owner] | [YYYY-MM-DD] | PCI DSS v4.0.1 | Requirement 12.3.1 | Confidential |

## Purpose

This report documents the Targeted Risk Analysis (TRA) performed to determine and justify the frequency of periodically performed security activities within the Cardholder Data Environment (CDE) and connected-to/security-impacting environments, in accordance with PCI DSS v4.0.1 Requirement 12.3.1.

PCI DSS v4.0.1 Requirement 12.3.1 requires that each PCI DSS requirement that provides flexibility for how frequently an activity is performed is supported by a targeted risk analysis that:

- Is performed according to all elements specified in Requirement 12.3.1.
- Identifies the assets being protected.
- Identifies the threats that the requirement is intended to protect against.
- Identifies factors that contribute to the likelihood and/or impact of a threat being realised.
- Provides a resulting analysis that determines and includes justification for the frequency at which the activity will be performed.
- Is reviewed at least once every 12 months and upon significant changes.

This report provides the documented rationale, risk assessment results, selected activity frequencies, and recommended actions for PCI DSS periodically performed activities that require frequency determination by targeted risk analysis.

## Reporting Period & Scope

### Reporting Period

| Field | Detail |
|---|---|
| Reporting Period Covered | [YYYY-MM-DD] to [YYYY-MM-DD] |
| TRA Assessment Date(s) | [YYYY-MM-DD] |
| Last TRA Review Date | [YYYY-MM-DD / Not previously performed] |
| Next Scheduled Review | [YYYY-MM-DD] |
| Trigger for Assessment | Annual PCI DSS v4.0.1 review / significant change / initial implementation |
| Assessor / Author | [Name, Role] |
| Reviewer(s) | [Name(s), Role(s)] |
| Approval Authority | [CISO / Risk Committee / PCI Executive Sponsor] |

### Scope

This TRA applies to periodically performed activities within the scope of the organisation’s PCI DSS v4.0.1 compliance programme where the standard requires the frequency to be defined through targeted risk analysis.

The scope includes:

- CDE systems that store, process, or transmit cardholder data.
- Systems connected to or security-impacting the CDE.
- Security tools and services that protect, monitor, administer, or provide access to the CDE.
- Third-party hosted or managed components where the organisation remains responsible for PCI DSS compliance.
- Processes and roles responsible for recurring security activities subject to frequency determination.

### In-Scope Environments

| Environment / Asset Group | Description | PCI DSS Relevance | Included in TRA |
|---|---|---|---|
| Payment Applications | Applications used to process payment transactions | Processes/transmits cardholder data | Yes |
| Databases Containing CHD/SAD Controls | Databases supporting payment services and tokenisation | Stores or protects cardholder data | Yes |
| Network Security Controls | Firewalls, routers, WAFs, segmentation controls | Protects CDE boundaries | Yes |
| Identity and Access Management | MFA, privileged access, user provisioning systems | Controls access to CDE | Yes |
| Logging and Monitoring Platforms | SIEM, log collectors, alerting systems | Supports detection and response | Yes |
| Vulnerability Management Tooling | Internal/external scanning, endpoint vulnerability tools | Identifies security weaknesses | Yes |
| Endpoint and Server Platforms | CDE servers, administrative workstations, jump hosts | Supports CDE operations | Yes |
| Third-Party Managed Services | [Service provider names/categories] | May impact CDE security | Yes, where applicable |

### Out-of-Scope Items

The following are excluded from this TRA:

- PCI DSS activities where the frequency is explicitly prescribed by PCI DSS v4.0.1 and does not permit frequency determination through TRA.
- Corporate systems with no connectivity to, administration of, or security impact on the CDE.
- Business continuity or operational activities not required or referenced by PCI DSS unless they directly support a scoped PCI DSS control.

## Executive Summary

A targeted risk analysis was performed to determine appropriate frequencies for PCI DSS periodically performed activities requiring risk-based scheduling under Requirement 12.3.1. The analysis considered the assets protected by each activity, applicable threats, likelihood and impact factors, current control maturity, environmental exposure, historical incidents, compensating monitoring capabilities, and dependency on third-party services.

The TRA concluded that higher-frequency execution is warranted for activities protecting externally exposed CDE components, privileged access, critical security control effectiveness, and detection capabilities. Lower but still controlled frequencies were determined acceptable for stable, lower-change activities with strong preventive controls and limited exposure.

### Summary of Results

| Activity ID | Periodic Activity | PCI DSS Requirement Supported | Risk Rating | Approved Frequency | Result |
|---|---|---:|---|---|---|
| TRA-AF-01 | Review of user access to application and system accounts | 7.2.5 / 7.2.5.1, where frequency is risk-based | High | Quarterly | Approved with action |
| TRA-AF-02 | Review of privileged access accounts | 7.2.5 / 7.2.5.1 | High | Monthly | Approved |
| TRA-AF-03 | Review of inactive user accounts | 8.2.6, where applicable to frequency determination | Medium | Monthly | Approved |
| TRA-AF-04 | Review of access rights for third-party/service provider accounts | 7.2.5 / 8.x supporting controls | High | Monthly and upon contract/service change | Approved |
| TRA-AF-05 | Review of firewall and network security control rule sets | 1.2.7, where frequency is defined by entity | High | At least every six months; quarterly for CDE boundary rules | Approved with action |
| TRA-AF-06 | Review of logs and security events not otherwise requiring daily review | 10.4.2.1 / supporting monitoring activities | Medium | Weekly | Approved |
| TRA-AF-07 | Review of vulnerability scan coverage and authenticated scan status | 11.3 supporting activities | Medium | Monthly | Approved |
| TRA-AF-08 | Review of malware protection coverage and exclusions | 5.x supporting activities | Medium | Monthly | Approved |
| TRA-AF-09 | Review of change records for CDE-impacting changes | 6.5 / 6.4 supporting activities | Medium | Monthly | Approved |
| TRA-AF-10 | Review of segmentation control effectiveness evidence between formal penetration tests | 11.4.5 supporting activities | High | Quarterly | Approved |
| TRA-AF-11 | Review of cryptographic key inventories and certificate expiry | 3.6 / 4.2 supporting activities | High | Monthly | Approved |
| TRA-AF-12 | Review of service provider PCI DSS compliance evidence | 12.8 supporting activities | Medium | Semi-annually; annually for AOC refresh | Approved |

### Overall Conclusion

The selected frequencies are appropriate to the organisation’s current CDE risk profile, provided that the recommended actions identified in this report are completed within the stated target dates. Frequencies must be reassessed at least annually and whenever significant changes occur, including changes to CDE architecture, payment channels, threat landscape, technology stack, business volume, third-party dependencies, or control performance.

## Methodology

### Assessment Approach

The TRA was conducted using a structured risk-based methodology aligned to PCI DSS v4.0.1 Requirement 12.3.1. For each periodically performed activity, the assessment identified:

1. The activity and PCI DSS requirement supported.
2. The assets or control objectives being protected.
3. The threat events the activity is intended to prevent, detect, or correct.
4. Likelihood factors, including exposure, change rate, threat intelligence, known vulnerabilities, historical findings, and control reliance.
5. Impact factors, including potential compromise of cardholder data, disruption to payment operations, regulatory impact, reputational harm, and compliance consequences.
6. Existing controls and monitoring that may reduce risk.
7. Recommended and approved performance frequency.
8. Evidence required to demonstrate that the frequency is followed.
9. Residual risk and required actions.

### Frequency Determination Criteria

Frequency decisions were based on the principle that activities with higher risk, greater exposure, higher control dependency, or greater potential impact require more frequent performance.

| Risk Rating | General Frequency Expectation | Typical Use Case |
|---|---|---|
| Critical | Daily to weekly, or continuous where feasible | Activities protecting highly exposed or high-impact systems with limited compensating controls |
| High | Monthly to quarterly | Activities protecting CDE boundaries, privileged access, high-risk third parties, cryptographic controls, and critical monitoring |
| Medium | Monthly to semi-annually | Stable activities with moderate exposure and compensating controls |
| Low | Semi-annually to annually | Low-change activities with minimal exposure and strong preventive controls |

### Risk Scoring Model

Risk scoring used a qualitative 5x5 model based on likelihood and impact.

| Score | Likelihood Definition | Impact Definition |
|---:|---|---|
| 1 | Rare; unlikely under current conditions | Minimal operational or compliance impact |
| 2 | Unlikely; possible but not expected | Limited impact; contained to non-critical systems |
| 3 | Possible; credible threat or moderate change rate | Moderate CDE control impact or compliance finding |
| 4 | Likely; active threat pattern, significant exposure, or control weakness | Significant CDE impact, reportable compliance issue, or operational disruption |
| 5 | Almost certain; known exploitation, repeated findings, or no effective control | Severe impact including CHD compromise, major PCI DSS non-compliance, or business disruption |

Risk rating was determined as follows:

| Inherent Risk Score | Risk Rating |
|---:|---|
| 1–4 | Low |
| 5–9 | Medium |
| 10–16 | High |
| 17–25 | Critical |

### Evidence Reviewed

| Evidence Type | Description | Source / System |
|---|---|---|
| PCI DSS Scope Documentation | Current CDE scope, data flows, system inventory, network diagrams | [GRC platform / repository] |
| Asset Inventory | CDE systems, connected systems, security tools, administrative systems | [CMDB / asset platform] |
| Access Reviews | Prior review results, exceptions, termination validation | [IAM / ticketing system] |
| Change Records | CDE-impacting change history and emergency changes | [Change management system] |
| Vulnerability Reports | Internal/external scan results and remediation trends | [Vulnerability management platform] |
| Firewall Reviews | Prior rule review records and rule recertification evidence | [Firewall management platform] |
| SIEM Metrics | Log ingestion status, alert volumes, triage metrics | [SIEM platform] |
| Incident Records | Security incidents, near misses, control failures | [Incident management system] |
| Service Provider Evidence | AOCs, responsibility matrices, service reports | [Vendor management repository] |
| Key and Certificate Inventory | Key custodians, certificate expiry, rotation evidence | [KMS / certificate management platform] |

### Assumptions and Limitations

| Area | Assumption / Limitation | Impact on TRA |
|---|---|---|
| Scope Accuracy | PCI DSS scope documentation is current as of [YYYY-MM-DD] | Material scope changes require TRA update |
| Evidence Completeness | Evidence repositories contain complete records for the reporting period | Gaps are captured as actions where identified |
| Threat Context | Analysis reflects current known threats to payment environments | Material threat changes may require interim review |
| Third-Party Reliance | Third-party control evidence is accurate and complete | Missing evidence increases residual risk |
| Technology Changes | No major undocumented changes occurred during the reporting period | Unrecorded changes could affect frequency conclusions |

## Detailed Findings / Results

### Finding TRA-AF-01: Review of User Access to Application and System Accounts

| Field | Detail |
|---|---|
| Activity | Review user access privileges for application and system accounts within or impacting the CDE |
| PCI DSS Requirement Supported | Requirement 7.2.5 / 7.2.5.1, as applicable to periodic review frequency |
| Assets Protected | Payment applications, CDE servers, databases, administrative consoles, IAM repositories |
| Current Frequency | [Current frequency, e.g., quarterly] |
| Approved Frequency | Quarterly |
| Risk Rating | High |
| Residual Risk | Medium |
| Result | Approved with action |

#### Threats Addressed

- Excessive or inappropriate access to CDE systems.
- Orphaned accounts remaining active after role change or termination.
- Unauthorised access to cardholder data or security-impacting functions.
- Privilege accumulation over time.
- Failure to detect inappropriate access granted through emergency or manual processes.

#### Likelihood Factors

| Factor | Assessment |
|---|---|
| User Population | Moderate to high number of users with CDE-impacting access |
| Change Rate | Regular joiner/mover/leaver activity |
| Access Complexity | Multiple applications and administrative platforms |
| Preventive Controls | Role-based access and manager approval are in place |
| Historical Issues | Prior reviews identified [low/moderate/high] volume of access correction items |
| Monitoring | Privileged activity logging and IAM reporting available |

#### Impact Factors

Unauthorised or excessive access could result in compromise of cardholder data, unauthorised alteration of payment processing systems, inability to demonstrate least privilege, and PCI DSS non-compliance.

#### Frequency Justification

A quarterly review is justified for standard user access because the access population changes regularly but is subject to preventive controls, including approval workflows, role-based access, and logging. Quarterly review provides timely detection of inappropriate access without duplicating continuous IAM controls. Increased frequency is required where access is privileged, third-party, or associated with elevated CDE administration.

#### Evidence Required

- Access review campaign records.
- Reviewer sign-off.
- List of access corrections.
- Evidence of remediation completion.
- Exception approvals with expiry dates.

---

### Finding TRA-AF-02: Review of Privileged Access Accounts

| Field | Detail |
|---|---|
| Activity | Review privileged, administrator, root, database administrator, security administrator, and emergency access accounts |
| PCI DSS Requirement Supported | Requirement 7.2.5 / 7.2.5.1 and supporting Requirement 8 controls |
| Assets Protected | CDE operating systems, databases, network devices, security tools, payment platforms |
| Current Frequency | [Current frequency, e.g., monthly] |
| Approved Frequency | Monthly |
| Risk Rating | High |
| Residual Risk | Medium |
| Result | Approved |

#### Threats Addressed

- Misuse of privileged access.
- Persistence through dormant administrator accounts.
- Unauthorised configuration changes.
- Bypass of security controls.
- Abuse of shared or emergency administrative access.

#### Likelihood Factors

Privileged accounts are high-value targets and are routinely targeted in payment environment compromises. Although MFA, privileged access management, and logging reduce likelihood, the potential for significant impact remains high.

#### Impact Factors

Compromise or misuse of privileged access could enable full control of CDE systems, disabling of security controls, access to stored cardholder data, alteration of logs, and significant PCI DSS compliance failure.

#### Frequency Justification

Monthly review is required because privileged accounts present elevated risk and may enable immediate compromise of CDE security. Monthly frequency aligns with the level of exposure and provides timely detection of inappropriate privileges, dormant accounts, and exceptions.

#### Evidence Required

- Monthly privileged account inventory.
- Review approval records.
- PAM export or administrative group membership reports.
- Remediation tickets for revoked or modified access.
- Evidence that emergency access was reviewed and removed or reapproved.

---

### Finding TRA-AF-03: Review of Inactive User Accounts

| Field | Detail |
|---|---|
| Activity | Review inactive user accounts and disable or remove accounts exceeding approved inactivity thresholds |
| PCI DSS Requirement Supported | Requirement 8.2.6 and supporting account lifecycle requirements |
| Assets Protected | CDE systems, IAM platforms, payment applications |
| Current Frequency | [Current frequency, e.g., monthly] |
| Approved Frequency | Monthly |
| Risk Rating | Medium |
| Residual Risk | Low to Medium |
| Result | Approved |

#### Threats Addressed

- Dormant account compromise.
- Unused credentials retained by former users.
- Accounts bypassing normal termination workflows.
- Increased attack surface for credential-based attacks.

#### Frequency Justification

Monthly review is appropriate because automated account inactivity controls are configured, but manual review is required to validate exceptions, service-impacting accounts, and systems without automated deactivation. Monthly frequency supports timely detection while recognising that primary prevention occurs through IAM lifecycle controls.

#### Evidence Required

- Inactive account report.
- Disabled or removed account list.
- Approved business exceptions.
- Review sign-off.

---

### Finding TRA-AF-04: Review of Third-Party and Service Provider Access

| Field | Detail |
|---|---|
| Activity | Review third-party, vendor, managed service provider, and remote support accounts with CDE access or CDE-impacting access |
| PCI DSS Requirement Supported | Requirements 7, 8, and 12.8 supporting service provider access governance |
| Assets Protected | Remote access gateways, administrative consoles, payment platforms, managed security services |
| Current Frequency | [Current frequency, e.g., monthly] |
| Approved Frequency | Monthly and upon contract, service, or personnel change |
| Risk Rating | High |
| Residual Risk | Medium |
| Result | Approved |

#### Threats Addressed

- Unauthorised vendor access.
- Continued access after contract termination or personnel change.
- Compromise of service provider credentials.
- Remote access abuse.
- Lack of accountability for third-party activity.

#### Frequency Justification

Monthly review is required because third-party access can introduce elevated risk due to external dependency, remote connectivity, and potential reduced visibility over personnel changes. Review must also occur upon service termination, contract change, or notification of personnel change.

#### Evidence Required

- Third-party account inventory.
- Vendor access authorisation records.
- MFA and remote access control validation.
- Review results and revocation records.
- Contract/service change trigger evidence.

---

### Finding TRA-AF-05: Review of Firewall and Network Security Control Rule Sets

| Field | Detail |
|---|---|
| Activity | Review firewall, router ACL, security group, WAF, and network security control rule sets protecting or segmenting the CDE |
| PCI DSS Requirement Supported | Requirement 1.2.7 and related Requirement 1 controls |
| Assets Protected | CDE network segments, internet-facing payment services, administrative access paths |
| Current Frequency | [Current frequency, e.g., semi-annually] |
| Approved Frequency | Semi-annually for all scoped rule sets; quarterly for CDE boundary and internet-facing rules |
| Risk Rating | High |
| Residual Risk | Medium |
| Result | Approved with action |

#### Threats Addressed

- Overly permissive inbound or outbound access.
- Unauthorised connectivity to the CDE.
- Stale temporary rules.
- Rule conflicts or shadowed rules.
- Segmentation degradation over time.

#### Likelihood Factors

| Factor | Assessment |
|---|---|
| External Exposure | Internet-facing payment services and remote administrative access paths exist |
| Change Rate | Firewall changes occur as part of application releases and operational support |
| Complexity | Multiple firewalls/security groups and hybrid connectivity are in use |
| Compensating Controls | Change approval, segmentation testing, logging, and vulnerability scanning are in place |
| Historical Findings | Prior reviews identified [number/type] stale or overly permissive rules |

#### Impact Factors

A misconfigured firewall or network security control could expose CDE systems to unauthorised networks, weaken segmentation, or permit attacker movement into the CDE.

#### Frequency Justification

PCI DSS expects periodic review of network security control rule sets. Given the CDE exposure and change rate, semi-annual review is the minimum acceptable frequency for scoped rule sets, while quarterly review is required for CDE boundary and internet-facing rules due to higher likelihood and impact.

#### Evidence Required

- Rule review reports.
- Business justification for retained rules.
- Decommissioned or modified rule evidence.
- Reviewer approval.
- Change records for remediation.

---

### Finding TRA-AF-06: Review of Logs and Security Events Not Otherwise Requiring Daily Review

| Field | Detail |
|---|---|
| Activity | Review security logs, alerts, and monitoring exceptions not subject to explicit daily review requirements |
| PCI DSS Requirement Supported | Requirement 10.4.2.1 and supporting Requirement 10 controls |
| Assets Protected | SIEM, CDE systems, security tools, payment applications |
| Current Frequency | [Current frequency, e.g., weekly] |
| Approved Frequency | Weekly |
| Risk Rating | Medium |
| Residual Risk | Medium |
| Result | Approved |

#### Threats Addressed

- Delayed detection of anomalous activity.
- Monitoring gaps due to log ingestion failures.
- Unreviewed lower-priority security events.
- Missed indicators of compromise.

#### Frequency Justification

Weekly review is justified for lower-priority or exception-based logs where high-risk events are already monitored continuously or daily through SIEM alerting. Weekly review ensures periodic oversight of trends, failures, and exceptions that could otherwise go unnoticed.

#### Evidence Required

- Weekly review checklist.
- SIEM search results or dashboard export.
- Alert triage records.
- Escalation tickets.
- Log source health report.

---

### Finding TRA-AF-07: Review of Vulnerability Scan Coverage and Authenticated Scan Status

| Field | Detail |
|---|---|
| Activity | Review vulnerability scan coverage, authenticated scan success, scan exclusions, and asset inclusion for CDE systems |
| PCI DSS Requirement Supported | Requirement 11.3 supporting vulnerability scanning controls |
| Assets Protected | CDE servers, network devices, applications, cloud assets |
| Current Frequency | [Current frequency, e.g., monthly] |
| Approved Frequency | Monthly |
| Risk Rating | Medium |
| Residual Risk | Low to Medium |
| Result | Approved |

#### Threats Addressed

- CDE assets missing from vulnerability scans.
- False sense of compliance due to failed authentication.
- Unapproved scan exclusions.
- Delayed identification of vulnerabilities.

#### Frequency Justification

Monthly review is appropriate because vulnerability scanning occurs at defined intervals and after significant changes, but scan coverage quality must be validated more frequently than annual assessment. Monthly review aligns with patch and vulnerability remediation cycles.

#### Evidence Required

- Asset-to-scan coverage reconciliation.
- Authenticated scan success reports.
- Scan exclusion approvals.
- Remediation tickets for coverage gaps.

---

### Finding TRA-AF-08: Review of Malware Protection Coverage and Exclusions

| Field | Detail |
|---|---|
| Activity | Review anti-malware/endpoint protection deployment, update status, policy compliance, and exclusions for CDE systems |
| PCI DSS Requirement Supported | Requirement 5 supporting malware protection controls |
| Assets Protected | CDE servers, administrative workstations, jump hosts, payment support systems |
| Current Frequency | [Current frequency, e.g., monthly] |
| Approved Frequency | Monthly |
| Risk Rating | Medium |
| Residual Risk | Low to Medium |
| Result | Approved |

#### Threats Addressed

- Malware infection of CDE systems.
- Unprotected or unmanaged endpoints.
- Excessive malware scanning exclusions.
- Outdated signatures or endpoint agents.

#### Frequency Justification

Monthly review is justified because endpoint tooling provides continuous protection and alerting, while periodic oversight is required to confirm coverage, update status, and appropriateness of exclusions. Monthly review supports timely correction of tool drift and unmanaged assets.

#### Evidence Required

- Endpoint protection coverage report.
- Agent health and update status.
- Exclusion list review.
- Remediation evidence for non-compliant endpoints.

---

### Finding TRA-AF-09: Review of CDE-Impacting Change Records

| Field | Detail |
|---|---|
| Activity | Review completed CDE-impacting changes to confirm security requirements, approvals, testing, and documentation were completed |
| PCI DSS Requirement Supported | Requirements 6.4 and 6.5 supporting secure change management |
| Assets Protected | Payment applications, infrastructure, network controls, security configurations |
| Current Frequency | [Current frequency, e.g., monthly] |
| Approved Frequency | Monthly |
| Risk Rating | Medium |
| Residual Risk | Medium |
| Result | Approved |

#### Threats Addressed

- Unauthorised or inadequately tested changes.
- CDE scope changes not reflected in documentation.
- Security controls weakened by production changes.
- Emergency changes not retrospectively approved.

#### Frequency Justification

Monthly review is appropriate because CDE changes occur regularly and can materially affect PCI DSS compliance. Monthly oversight enables timely identification of missing approvals, incomplete security testing, or documentation gaps before they become systemic.

#### Evidence Required

- Monthly change sample or full change population report.
- Security approval evidence.
- Testing records.
- Emergency change retrospective review.
- Remediation tickets for exceptions.

---

### Finding TRA-AF-10: Review of Segmentation Control Effectiveness Evidence

| Field | Detail |
|---|---|
| Activity | Review evidence indicating continued effectiveness of CDE segmentation controls between formal segmentation penetration tests |
| PCI DSS Requirement Supported | Requirement 11.4.5 supporting segmentation validation |
| Assets Protected | CDE network boundaries, connected networks, corporate networks, cloud segments |
| Current Frequency | [Current frequency, e.g., quarterly] |
| Approved Frequency | Quarterly |
| Risk Rating | High |
| Residual Risk | Medium |
| Result | Approved |

#### Threats Addressed

- Segmentation drift caused by network or firewall changes.
- New connectivity paths into the CDE.
- Cloud security group misconfiguration.
- Inability to rely on segmentation for PCI DSS scope reduction.

#### Frequency Justification

Quarterly review is required due to the importance of segmentation in limiting PCI DSS scope and protecting the CDE. Formal segmentation testing remains required at PCI DSS-prescribed intervals and after significant changes, but quarterly evidence review provides interim assurance that segmentation has not degraded.

#### Evidence Required

- Network connectivity review.
- Firewall/security group change review.
- Segmentation monitoring evidence.
- Exception and remediation records.
- Confirmation of no undocumented CDE connectivity.

---

### Finding TRA-AF-11: Review of Cryptographic Key Inventories and Certificate Expiry

| Field | Detail |
|---|---|
| Activity | Review cryptographic key inventories, certificate expiry, key custodians, and rotation/retirement status |
| PCI DSS Requirement Supported | Requirements 3.6 and 4.2 supporting cryptographic protection of account data |
| Assets Protected | Cardholder data repositories, payment applications, TLS endpoints, key management systems |
| Current Frequency | [Current frequency, e.g., monthly] |
| Approved Frequency | Monthly |
| Risk Rating | High |
| Residual Risk | Medium |
| Result | Approved |

#### Threats Addressed

- Expired certificates affecting secure transmission of account data.
- Untracked encryption keys.
- Continued use of retired or weak cryptographic material.
- Inadequate key custodian oversight.
- Failure to rotate keys when required.

#### Frequency Justification

Monthly review is required because failure of cryptographic controls could affect confidentiality of stored or transmitted account data and may cause payment service disruption. Certificate and key lifecycle events require proactive monitoring to prevent expiry, unauthorised use, or non-compliant cryptographic practices.

#### Evidence Required

- Key and certificate inventory.
- Expiry dashboard or report.
- Key custodian review sign-off.
- Rotation and retirement evidence.
- Exception approvals.

---

### Finding TRA-AF-12: Review of Service Provider PCI DSS Compliance Evidence

| Field | Detail |
|---|---|
| Activity | Review service provider PCI DSS compliance status, AOCs, responsibility matrices, and security assurance evidence |
| PCI DSS Requirement Supported | Requirement 12.8 supporting service provider management |
| Assets Protected | Outsourced payment services, hosted environments, managed security services, third-party platforms |
| Current Frequency | [Current frequency, e.g., annually] |
| Approved Frequency | Semi-annually for status review; annually for AOC refresh; upon material service change |
| Risk Rating | Medium |
| Residual Risk | Medium |
| Result | Approved |

#### Threats Addressed

- Reliance on non-compliant or expired service provider assurance.
- Undefined PCI DSS responsibility boundaries.
- Unidentified service changes affecting CDE risk.
- Third-party control failure.

#### Frequency Justification

Annual AOC collection remains necessary; however, semi-annual compliance status review is justified because service provider risk can change between annual attestations. Reviews must also occur upon onboarding, renewal, material service change, incident notification, or change in PCI DSS responsibility.

#### Evidence Required

- Current AOC or equivalent compliance evidence.
- Responsibility matrix.
- Service provider review record.
- Risk acceptance for gaps.
- Remediation or escalation evidence.

## Analysis

### Cross-Activity Risk Themes

The TRA identified the following common risk themes affecting activity frequency decisions:

| Theme | Observation | Effect on Frequency |
|---|---|---|
| Privileged Access Risk | Administrative and service provider accounts present elevated impact if misused | Requires monthly review |
| CDE Boundary Exposure | Internet-facing services and remote access paths increase likelihood of attack | Requires quarterly or more frequent boundary control review |
| Change-Driven Risk | Changes to applications, firewalls, cloud controls, and segmentation can alter PCI DSS scope and control effectiveness | Requires monthly or quarterly oversight depending on activity |
| Third-Party Dependency | Service providers may affect CDE security and compliance posture | Requires at least semi-annual assurance review and monthly access review |
| Monitoring Reliance | Several activities rely on SIEM, IAM, and vulnerability tooling for timely detection | Requires periodic tool health and coverage validation |
| Scope Integrity | Accurate asset inventory and segmentation are critical to determining PCI DSS scope | Requires ongoing reconciliation and periodic validation |

### Frequency Adequacy Assessment

| Frequency Category | Activities Assigned | Adequacy Conclusion |
|---|---|---|
| Monthly | Privileged access, inactive accounts, third-party access, vulnerability coverage, malware coverage, CDE change reviews, key/certificate review | Appropriate for high-change or high-impact activities |
| Quarterly | Standard access reviews, CDE boundary rule reviews, segmentation evidence reviews | Appropriate where risk is high but supported by preventive controls and monitoring |
| Semi-Annual | General scoped firewall/rule reviews, service provider compliance status review | Appropriate for stable control areas with lower change velocity |
| Annual | TRA review, service provider AOC refresh, policy-level assurance review | Appropriate only where PCI DSS permits annual cadence or activity is supported by interim controls |

### Residual Risk Position

Residual risk is considered acceptable for the selected frequencies where:

- The approved frequency is implemented and evidenced.
- Exceptions are tracked to completion.
- Significant changes trigger interim review.
- Control owners maintain complete records.
- Senior risk owner approval is obtained for any deferred actions or deviations.

Residual risk is elevated where:

- Access review evidence is incomplete.
- Firewall rule reviews do not distinguish CDE boundary rules from lower-risk rules.
- Third-party access is not promptly updated after personnel or contractual changes.
- Key and certificate inventories are not fully reconciled to production systems.
- Change records do not consistently identify PCI DSS impact.

### Significant Change Triggers

This TRA must be reviewed before the next annual cycle if any of the following occur:

| Trigger | Examples |
|---|---|
| CDE Architecture Change | New payment application, new CDE segment, migration to cloud, new data flow |
| Network Change | New remote access path, new firewall architecture, segmentation redesign |
| Threat Change | Active exploitation affecting payment environments, new malware campaign, relevant breach intelligence |
| Control Failure | Failed penetration test, major vulnerability, missed access review, logging outage |
| Business Change | New payment channel, acquisition, outsourcing of payment function |
| Third-Party Change | New service provider, material change in provider service, provider incident |
| Compliance Change | Updated PCI DSS interpretation, assessor feedback, new regulatory obligation |

## Recommendations & Actions

### Recommendations

1. **Formally approve and adopt the frequencies in this report** for all applicable PCI DSS periodically performed activities.
2. **Embed the approved frequencies into the compliance calendar** and assign accountable control owners.
3. **Maintain evidence repositories** for each periodic activity, including review outputs, sign-offs, remediation actions, and exception approvals.
4. **Define escalation rules** for missed or incomplete periodic activities, including notification to the PCI Compliance Owner and CISO.
5. **Ensure TRA review at least annually** and upon significant changes as required by PCI DSS v4.0.1 Requirement 12.3.1.
6. **Align internal GRC tooling** with the TRA frequency outcomes to enable automated reminders, status tracking, and audit reporting.
7. **Require documented risk acceptance** for any activity performed less frequently than approved in this TRA.
8. **Differentiate high-risk subsets** within broader activities, such as CDE boundary firewall rules, privileged access, and third-party access, rather than applying a single general frequency.

### Action Plan

| Action ID | Action | Owner | Priority | Target Date | Evidence of Completion | Status |
|---|---|---|---|---|---|---|
| ACT-12.3.1-01 | Approve TRA frequency decisions and record management acceptance | [CISO / Risk Owner] | High | [YYYY-MM-DD] | Signed approval or GRC approval record | Open |
| ACT-12.3.1-02 | Update PCI compliance calendar with approved activity frequencies | [PCI Compliance Manager] | High | [YYYY-MM-DD] | Updated compliance calendar | Open |
| ACT-12.3.1-03 | Configure GRC reminders and overdue escalation workflows | [GRC Platform Owner] | Medium | [YYYY-MM-DD] | Workflow configuration evidence | Open |
| ACT-12.3.1-04 | Separate CDE boundary rule reviews from general network rule reviews | [Network Security Owner] | High | [YYYY-MM-DD] | Updated review procedure and sample evidence | Open |
| ACT-12.3.1-05 | Implement monthly privileged and third-party access review reporting | [IAM Owner] | High | [YYYY-MM-DD] | Monthly access review reports | Open |
| ACT-12.3.1-06 | Reconcile key and certificate inventory to production payment systems | [Cryptography / Platform Owner] | High | [YYYY-MM-DD] | Reconciled inventory and sign-off | Open |
| ACT-12.3.1-07 | Document significant change triggers in the change management process | [Change Manager] | Medium | [YYYY-MM-DD] | Updated change templates and guidance | Open |
| ACT-12.3.1-08 | Establish quarterly segmentation evidence review pack | [Network Security Owner] | Medium | [YYYY-MM-DD] | Quarterly review pack template and first completed review | Open |
| ACT-12.3.1-09 | Update vendor management checklist to include semi-annual PCI compliance status review | [Vendor Management Owner] | Medium | [YYYY-MM-DD] | Updated checklist and review schedule | Open |
| ACT-12.3.1-10 | Create annual TRA review task and assign accountable reviewer | [PCI Compliance Manager] | High | [YYYY-MM-DD] | Scheduled annual review task | Open |

### Approved Frequency Register

| Activity ID | Activity | Approved Frequency | Responsible Owner | Evidence Repository | Escalation Threshold |
|---|---|---|---|---|---|
| TRA-AF-01 | Standard CDE user access review | Quarterly | [IAM Owner] | [GRC/IAM repository] | >10 business days overdue |
| TRA-AF-02 | Privileged access review | Monthly | [IAM / PAM Owner] | [PAM/GRC repository] | >5 business days overdue |
| TRA-AF-03 | Inactive account review | Monthly | [IAM Owner] | [IAM repository] | >5 business days overdue |
| TRA-AF-04 | Third-party access review | Monthly and upon service/personnel change | [Vendor Access Owner] | [IAM/vendor repository] | >5 business days overdue |
| TRA-AF-05 | Firewall and network security rule review | Semi-annually; quarterly for CDE boundary rules | [Network Security Owner] | [Firewall management/GRC repository] | >10 business days overdue |
| TRA-AF-06 | Non-daily log and event review | Weekly | [SOC Manager] | [SIEM/ticketing repository] | >2 business days overdue |
| TRA-AF-07 | Vulnerability scan coverage review | Monthly | [Vulnerability Manager] | [Vulnerability platform] | >5 business days overdue |
| TRA-AF-08 | Malware protection coverage review | Monthly | [Endpoint Security Owner] | [Endpoint security platform] | >5 business days overdue |
| TRA-AF-09 | CDE-impacting change review | Monthly | [Change Manager] | [Change management system] | >5 business days overdue |
| TRA-AF-10 | Segmentation effectiveness evidence review | Quarterly | [Network Security Owner] | [GRC/network repository] | >10 business days overdue |
| TRA-AF-11 | Key and certificate inventory review | Monthly | [Cryptography Owner] | [KMS/certificate repository] | >5 business days overdue |
| TRA-AF-12 | Service provider PCI DSS status review | Semi-annually; annually for AOC refresh | [Vendor Management Owner] | [Vendor management repository] | >15 business days overdue |

### Management Approval

| Role | Name | Decision | Date | Comments |
|---|---|---|---|---|
| PCI Compliance Owner | [Name] | Approved / Approved with conditions / Rejected | [YYYY-MM-DD] | [Comments] |
| CISO / Security Risk Owner | [Name] | Approved / Approved with conditions / Rejected | [YYYY-MM-DD] | [Comments] |
| Business Owner for Payment Services | [Name] | Approved / Approved with conditions / Rejected | [YYYY-MM-DD] | [Comments] |
| Internal Audit / Compliance Reviewer | [Name] | Reviewed / Not reviewed | [YYYY-MM-DD] | [Comments] |

## Distribution & Confidentiality

### Distribution

This report is distributed only to personnel with a legitimate business need to support PCI DSS governance, risk management, control operation, audit readiness, and compliance oversight.

| Recipient / Group | Purpose |
|---|---|
| [CISO / Information Security Leadership] | Risk ownership and approval |
| [PCI Compliance Owner / PCI Programme Team] | PCI DSS compliance management |
| [Control Owners] | Implementation of approved frequencies and actions |
| [Internal Audit / Compliance] | Independent review and audit planning |
| [Executive Risk Committee] | Oversight of residual risk and action status |
| [Qualified Security Assessor, if applicable] | PCI DSS assessment evidence |

### Confidentiality Requirements

This document is classified as **Confidential** because it contains information about PCI DSS control activities, CDE protection mechanisms, review frequencies, and potential control gaps. Unauthorised disclosure could assist threat actors in identifying monitoring intervals, control dependencies, or areas of elevated risk.

Handling requirements:

- Store only in approved repositories with access restricted to authorised personnel.
- Do not distribute externally without approval from [CISO / Legal / PCI Compliance Owner].
- Redact sensitive system names, internal network details, and security tool details before external sharing where appropriate.
- Retain according to the organisation’s PCI DSS evidence retention and records management requirements.
- Destroy or archive superseded versions in accordance with approved document control procedures.

### Review and Retention

| Requirement | Detail |
|---|---|
| Minimum Review Frequency | At least once every 12 months |
| Event-Driven Review | Required upon significant change affecting the CDE, risk environment, or control operation |
| Retention Period | [Retention period, e.g., minimum 3 years or as required by PCI DSS evidence retention policy] |
| Authoritative Repository | [GRC platform / document management system] |
| Superseded Version Handling | Retain prior approved versions for audit trail and historical comparison |