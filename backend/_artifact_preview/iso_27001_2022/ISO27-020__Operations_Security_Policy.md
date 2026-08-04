<!-- iso_27001_2022 / ISO27-020 | type=Policy | mode=markdown | model=gpt-5.5 | 28745 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [ORG]-POL-OPS-SEC | 1.0 | [Information Security Manager] | [YYYY-MM-DD] | ISO/IEC 27001:2022 | A.8.x Technology Controls, including A.8.6, A.8.7, A.8.13, A.8.15, A.8.16, A.8.32 and related operations controls | Internal |

## Purpose

The purpose of this Operations Security Policy is to establish mandatory requirements for the secure operation, administration, monitoring, maintenance and resilience of [Organisation Name] information systems in alignment with ISO/IEC 27001:2022 technology controls.

This Policy ensures that operational activities are performed in a controlled, repeatable and auditable manner, including documented operating procedures, change management, capacity management, malware protection, backup, logging, monitoring and related operational safeguards.

## Scope

This Policy applies to:

- All information systems, applications, infrastructure, networks, cloud services, endpoints, databases and operational technology that process, store or transmit [Organisation Name] information.
- All production, pre-production, development, test and disaster recovery environments, unless formally excluded by approved risk assessment.
- All employees, contractors, suppliers, managed service providers and third parties who operate, administer, maintain, monitor or support [Organisation Name] information assets.
- All operational processes supporting the confidentiality, integrity, availability and resilience of information and information processing facilities.

This Policy covers, at minimum:

- Documented operating procedures.
- Change management.
- Capacity and performance management.
- Protection against malware and malicious code.
- Backup, restoration and recovery.
- Event logging and monitoring.
- Operational segregation and secure administration.
- Protection of operational tools, scripts, utilities and software installation processes.

## Policy Statements

1. **Documented Operating Procedures**

 1.1. [Organisation Name] shall maintain documented operating procedures for the secure operation and administration of information systems, infrastructure, applications and supporting services.

 1.2. Operating procedures shall be approved by authorised management, version controlled, protected from unauthorised modification and made available to personnel who require them to perform assigned duties.

 1.3. Operating procedures shall define, where applicable:

 | Procedure Area | Minimum Required Content |
 |---|---|
 | System start-up and shutdown | Authorised sequence, dependencies, validation checks and escalation steps |
 | Backup and restore | Backup scope, frequency, retention, encryption, restoration testing and responsibilities |
 | Change implementation | Pre-change checks, implementation steps, rollback steps, communication and approval requirements |
 | Logging and monitoring | Log sources, review frequency, alert handling and escalation paths |
 | Incident handling | Detection, containment, escalation, evidence preservation and communication requirements |
 | Batch jobs and scheduled tasks | Scheduling, ownership, failure handling and monitoring |
 | Privileged administration | Approved tools, access requirements, session logging and segregation of duties |
 | Maintenance activities | Maintenance windows, vendor access controls, validation and post-maintenance checks |

 1.4. Operating procedures shall be reviewed following significant system changes, security incidents, audit findings or process changes.

2. **Operational Change Management**

 2.1. Changes to production systems, infrastructure, network configurations, security controls, applications, cloud services and operational procedures shall be managed through a formal change management process.

 2.2. Changes shall be assessed for information security risk before approval and implementation.

 2.3. Changes shall not be implemented in production unless they are authorised, tested where practicable, documented and supported by a rollback or remediation plan.

 2.4. Emergency changes shall be permitted only where necessary to restore service, address urgent security risk or prevent material operational impact. Emergency changes shall be retrospectively reviewed and approved within the defined timeframe.

 2.5. The following minimum change records shall be maintained:

 | Change Type | Required Approval | Minimum Evidence | Retrospective Review |
 |---|---|---|---|
 | Standard pre-approved change | Service owner or delegated authority | Approved standard change model, implementation record, completion status | Periodic sampling |
 | Normal change | Change Advisory Board or authorised change approver | Risk assessment, test evidence, implementation plan, rollback plan, approval record | Required after implementation |
 | Emergency change | Emergency change approver or senior operational authority | Justification, impact assessment, implementation record, rollback or remediation action | Within [X] business days |
 | Security control change | Information Security approval and system owner approval | Security impact assessment, testing evidence, control validation | Required after implementation |
 | High-risk change | Senior management or designated governance body | Business impact assessment, risk acceptance where applicable, communication plan | Required after implementation |

 2.6. Changes shall be prioritised, classified and scheduled to minimise disruption to business operations and reduce security risk.

 2.7. Segregation of duties shall be applied so that, where practicable, the individual developing or requesting a change is not the sole approver of that change.

 2.8. Unauthorised changes shall be treated as security events and investigated in accordance with incident management requirements.

3. **Capacity and Performance Management**

 3.1. [Organisation Name] shall monitor and manage the capacity and performance of information systems to ensure current and future business and security requirements are met.

 3.2. Capacity planning shall consider processing, storage, memory, bandwidth, database capacity, licence utilisation, cloud resource consumption, system dependencies, resilience requirements and forecast business demand.

 3.3. Capacity thresholds shall be defined for critical systems, and alerts shall be configured where technically feasible.

 3.4. Capacity monitoring shall include, at minimum:

 | Resource Area | Monitoring Requirement | Minimum Review Frequency |
 |---|---|---|
 | Compute resources | CPU, memory and host utilisation | Monthly or automated alerting |
 | Storage | Used capacity, growth trend, free space and backup repository capacity | Monthly or automated alerting |
 | Network | Bandwidth, latency, packet loss and saturation events | Monthly or automated alerting |
 | Databases | Size, transaction volume, performance metrics and available capacity | Monthly |
 | Cloud services | Resource utilisation, quotas, scaling events and cost anomalies | Monthly |
 | Security tools | Log ingestion volume, alert processing capacity and retention capacity | Monthly |

 3.5. Capacity risks that may affect availability, security monitoring, backup success, resilience or service continuity shall be recorded, assessed and remediated through risk management, change management or service improvement processes.

4. **Protection Against Malware and Malicious Code**

 4.1. [Organisation Name] shall implement appropriate malware protection controls on endpoints, servers, email services, collaboration platforms, internet gateways, cloud workloads and other systems where technically feasible.

 4.2. Malware protection controls shall include prevention, detection, response and recovery capabilities proportionate to the risk and criticality of the system.

 4.3. Anti-malware, endpoint detection and response, email filtering and similar security tools shall be configured to update signatures, detection rules, engines and threat intelligence automatically where supported.

 4.4. Malware protection shall not be disabled, bypassed or materially weakened unless formally authorised through an approved exception or change process.

 4.5. Users shall not intentionally introduce, execute or distribute malware, unauthorised scripts, untrusted executables or suspicious files within [Organisation Name] systems.

 4.6. Detected malware events shall be logged, triaged, contained and escalated according to incident management procedures.

 4.7. Systems that cannot support standard malware protection, including legacy systems, appliances or operational technology, shall be subject to compensating controls such as network segmentation, application allowlisting, restricted administrative access, enhanced monitoring or supplier-supported controls.

5. **Backup, Restoration and Recovery**

 5.1. [Organisation Name] shall implement backups for information, software, configurations and systems required to meet business, legal, regulatory, contractual and continuity requirements.

 5.2. Backup requirements shall be defined based on business impact, recovery time objectives, recovery point objectives, legal retention obligations and information classification.

 5.3. Backup configurations shall specify scope, frequency, retention period, storage location, encryption, access restrictions and restoration responsibilities.

 5.4. Backup media and repositories shall be protected against unauthorised access, alteration, deletion, corruption and malware, including ransomware.

 5.5. Backups containing confidential, sensitive, regulated or personal information shall be encrypted in transit and at rest unless a documented risk assessment approves an alternative control.

 5.6. Backup access shall be restricted to authorised personnel and shall be reviewed periodically.

 5.7. Restoration tests shall be performed on a scheduled basis to verify that backups are complete, usable and capable of meeting recovery requirements.

 5.8. Backup failures shall be investigated and remediated within defined operational timeframes.

 5.9. Minimum backup requirements shall be established as follows unless superseded by an approved business impact analysis or system-specific recovery plan:

 | System / Data Category | Minimum Backup Frequency | Minimum Retention | Restoration Test Frequency | Minimum Protection Requirement |
 |---|---:|---:|---:|---|
 | Critical production systems | Daily | [X] days/months | Quarterly | Encrypted, access restricted, offline or immutable copy where feasible |
 | Business applications | Daily or as defined by RPO | [X] days/months | Semi-annually | Encrypted and access restricted |
 | Databases | Daily full or incremental per design | [X] days/months | Quarterly | Encrypted and integrity checked |
 | File shares and collaboration repositories | Daily | [X] days/months | Semi-annually | Encrypted and access restricted |
 | System configurations | After significant change and at scheduled intervals | [X] versions | Annually | Version controlled and access restricted |
 | Security logs requiring retention | As generated | Per legal, regulatory and security monitoring requirements | Annually | Tamper-resistant and access restricted |

6. **Logging**

 6.1. [Organisation Name] shall generate, retain, protect and review logs for systems and services where logs are necessary to support security monitoring, incident investigation, forensic analysis, auditability and operational troubleshooting.

 6.2. Logging shall be enabled for critical systems, security systems, privileged activities, authentication events, access to sensitive information, administrative actions, network security events and changes to security-relevant configurations.

 6.3. Logs shall include sufficient information to support investigation, including, where available:

 - User or system account identifier.
 - Source address, device or location.
 - Timestamp synchronised to an approved time source.
 - Event type and outcome.
 - Object or resource accessed.
 - Administrative command or activity performed.
 - Error condition or security alert details.

 6.4. Logs shall be protected from unauthorised access, alteration and deletion.

 6.5. Access to logs shall be restricted to authorised personnel with a legitimate operational, security, audit or compliance need.

 6.6. Log retention periods shall be defined according to legal, regulatory, contractual, operational and security monitoring requirements.

 6.7. Minimum logging requirements shall be as follows:

 | Log Source | Events to Capture | Minimum Retention | Review / Monitoring Requirement |
 |---|---|---:|---|
 | Identity and access management systems | Logons, failures, privilege changes, account creation/deletion, MFA events | [X] months | Automated alerting for high-risk events |
 | Servers and endpoints | Security events, administrative actions, malware detections, system errors | [X] months | Central collection where feasible |
 | Network devices | Configuration changes, access attempts, denied traffic, routing/security events | [X] months | Automated alerting for critical events |
 | Firewalls and security gateways | Allowed/blocked traffic, policy changes, threat detections | [X] months | Continuous monitoring |
 | Cloud platforms | Administrative actions, API calls, authentication events, resource changes | [X] months | Automated alerting for high-risk events |
 | Databases | Privileged access, failed access, schema changes, sensitive data access where feasible | [X] months | Periodic review or alerting |
 | Business-critical applications | Authentication, authorisation failures, administrative actions, sensitive transactions | [X] months | Risk-based review |
 | Backup platforms | Backup success/failure, restore activity, repository changes, deletion events | [X] months | Alerting for failures and deletions |

7. **Monitoring of Activities**

 7.1. [Organisation Name] shall monitor systems, networks, applications and security controls to detect anomalous activity, unauthorised access, malware, misuse, service degradation and potential information security incidents.

 7.2. Monitoring shall be proportionate to the criticality and risk profile of the system or service.

 7.3. Security monitoring alerts shall be triaged, prioritised, investigated and escalated according to defined severity criteria.

 7.4. Monitoring use cases shall include, at minimum:

 - Privileged account misuse.
 - Multiple failed authentication attempts.
 - Suspicious remote access.
 - Malware or endpoint security detections.
 - Unauthorised configuration changes.
 - Security tool disablement.
 - Unusual data transfer or exfiltration indicators.
 - Backup deletion or failure patterns.
 - High-risk cloud administrative activity.
 - Network scanning or exploitation attempts.

 7.5. Monitoring tools shall be maintained, tuned and tested to reduce false positives and ensure meaningful alerting.

 7.6. Monitoring activities shall comply with applicable privacy, employment and legal requirements.

8. **Clock Synchronisation**

 8.1. Systems generating security, audit or operational logs shall synchronise clocks to an approved and reliable time source.

 8.2. Time synchronisation settings shall be protected from unauthorised modification.

 8.3. Systems unable to synchronise to the approved time source shall be documented, risk assessed and subject to compensating controls.

9. **Use of Privileged Utility Programs and Administrative Tools**

 9.1. Use of privileged utilities, administrative tools, diagnostic tools, scripting tools and system-level management interfaces shall be restricted to authorised personnel.

 9.2. Privileged utility usage shall be logged where technically feasible.

 9.3. Privileged tools shall not be used to bypass security controls, access restrictions, logging, malware protection or change management requirements unless explicitly authorised for emergency response or approved maintenance.

 9.4. Administrative tools shall be obtained from trusted sources, maintained securely and removed when no longer required.

10. **Installation of Software on Operational Systems**

 10.1. Software shall not be installed on production systems, servers, endpoints or managed cloud environments unless authorised through approved software management, endpoint management or change management processes.

 10.2. Software shall be sourced from trusted repositories, approved suppliers or internally authorised distribution mechanisms.

 10.3. Unauthorised, unsupported, pirated, end-of-life or unlicensed software shall not be installed or used.

 10.4. Software installation rights shall be restricted based on role and business need.

 10.5. Installed software shall be inventoried, reviewed and removed where no longer required or where it presents unacceptable risk.

11. **Separation of Development, Test and Production Environments**

 11.1. Development, test, staging and production environments shall be segregated to reduce the risk of unauthorised access, unintended changes, data leakage or disruption to production services.

 11.2. Production data shall not be used in non-production environments unless authorised, protected according to its classification and subject to appropriate masking, anonymisation or compensating controls.

 11.3. Access to production environments shall be restricted to authorised personnel with a defined operational need.

 11.4. Changes shall be tested in non-production environments where practicable before production deployment.

12. **Secure Configuration and Operational Hardening**

 12.1. Systems shall be securely configured and hardened according to approved configuration standards, vendor guidance, regulatory requirements and risk-based baselines.

 12.2. Default passwords, unnecessary services, insecure protocols and unused accounts shall be removed, disabled or changed before systems are placed into production.

 12.3. Configuration changes affecting security posture shall be managed through change management.

 12.4. Configuration baselines shall be reviewed periodically and updated in response to new threats, vulnerabilities, system changes or audit findings.

13. **Operational Vulnerability and Patch Coordination**

 13.1. Operational teams shall support vulnerability management by identifying affected assets, assessing operational impact, testing remediation where appropriate and implementing approved patches or mitigations within defined timeframes.

 13.2. Security patches and updates shall be prioritised based on severity, exploitability, asset criticality and exposure.

 13.3. Where patches cannot be applied within required timeframes, compensating controls and risk acceptance shall be documented and approved.

14. **Protection of Information Systems During Audit and Testing**

 14.1. Security testing, audit activities, vulnerability scans and penetration tests involving operational systems shall be planned, authorised and controlled to minimise disruption and protect information.

 14.2. Testing shall be coordinated with system owners and operational teams, and shall define scope, timing, methods, access requirements and escalation contacts.

 14.3. Test accounts, tools and elevated access granted for audit or testing shall be removed or disabled after completion.

15. **Operational Resilience and Continuity Support**

 15.1. Operational security controls shall support business continuity, disaster recovery and incident response requirements.

 15.2. Critical operational dependencies, including third-party services, cloud platforms, network connectivity, backup repositories and identity services, shall be identified and considered in continuity planning.

 15.3. Operational recovery procedures shall be tested according to business continuity and disaster recovery requirements.

16. **Supplier and Managed Service Operations**

 16.1. Suppliers and managed service providers performing operational activities on behalf of [Organisation Name] shall comply with this Policy and applicable contractual security requirements.

 16.2. Supplier access to operational systems shall be authorised, time-bound where feasible, monitored and removed when no longer required.

 16.3. Supplier-performed changes, maintenance, monitoring or backup activities shall be recorded and subject to [Organisation Name] governance and oversight.

17. **Evidence and Records**

 17.1. Operational security activities shall generate and retain appropriate records to demonstrate compliance with this Policy and ISO/IEC 27001:2022 requirements.

 17.2. Records shall include, as applicable:

 - Approved operating procedures.
 - Change records and approvals.
 - Backup schedules, completion reports and restoration test results.
 - Capacity monitoring reports.
 - Malware detection and response records.
 - Log review and monitoring records.
 - Configuration baselines and changes.
 - Exception approvals.
 - Supplier operational activity records.

 17.3. Records shall be retained according to [Organisation Name] retention requirements and protected according to their classification.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Senior Management | Approves this Policy, ensures adequate resources are available and supports enforcement of operational security requirements. |
| Information Security Manager | Owns this Policy, defines security requirements, monitors compliance, reviews exceptions and reports material operational security risks. |
| IT Operations Manager | Ensures operating procedures, change controls, backup processes, capacity monitoring, logging and operational controls are implemented and maintained. |
| System Owners | Define operational requirements, approve system-specific changes, ensure risks are assessed and ensure systems comply with this Policy. |
| Service Owners | Ensure services meet availability, capacity, backup, monitoring and recovery requirements aligned with business needs. |
| Change Manager / Change Advisory Board | Oversees change management, ensures risk assessment and approvals are completed, and reviews emergency and failed changes. |
| Infrastructure and Platform Teams | Implement secure configurations, backups, logging, monitoring, malware protection, patching and operational maintenance activities. |
| Security Operations Team | Monitors security events, investigates alerts, supports incident response and maintains security monitoring use cases. |
| Application Teams | Ensure application logging, secure deployment, operational documentation and change controls are implemented. |
| Database Administrators | Ensure database backup, logging, access control, capacity and change requirements are implemented. |
| Endpoint Management Team | Ensures endpoint malware protection, software control, logging and secure configuration requirements are enforced. |
| Business Continuity / Disaster Recovery Owner | Defines recovery requirements and coordinates recovery testing with operational teams. |
| Procurement / Supplier Management | Ensures supplier contracts include applicable operational security, logging, access, backup and notification requirements. |
| Users | Follow approved operational instructions, avoid unauthorised software or malicious content and report suspected security events promptly. |
| Suppliers and Managed Service Providers | Comply with this Policy, contractual obligations and approved operational procedures when supporting [Organisation Name] systems. |

## Compliance, Monitoring & Enforcement

Compliance with this Policy shall be monitored through a combination of technical controls, management review, security monitoring, internal audit, supplier assurance and risk management activities.

The following compliance monitoring activities shall be performed:

| Control Area | Monitoring Activity | Minimum Frequency | Responsible Role |
|---|---|---:|---|
| Operating procedures | Review for currency, approval and completeness | Annually or after significant change | IT Operations Manager |
| Change management | Sample review of change records, approvals, testing and rollback evidence | Monthly or quarterly | Change Manager |
| Emergency changes | Retrospective review of justification, approval and closure | Within [X] business days | Change Manager |
| Capacity management | Review capacity dashboards, forecasts and threshold breaches | Monthly | Service Owner / IT Operations |
| Malware protection | Review coverage, update status, detections and unresolved issues | Monthly | Security Operations / Endpoint Team |
| Backup | Review backup success/failure reports and remediation actions | Daily or automated alerting | IT Operations |
| Restoration testing | Validate completion and results of restore tests | Quarterly or per recovery plan | IT Operations / DR Owner |
| Logging | Validate log source coverage, retention and access controls | Quarterly | Security Operations |
| Monitoring | Review alert handling, escalation and unresolved high-risk events | Monthly | Security Operations |
| Software installation | Review unauthorised or unsupported software detections | Quarterly | Endpoint / Platform Teams |
| Supplier operations | Review supplier access, changes and service reports | Quarterly or per contract | Supplier Manager |

Non-compliance with this Policy may result in one or more of the following actions:

- Formal risk assessment and remediation plan.
- Revocation or restriction of system access.
- Suspension of unauthorised operational activity.
- Escalation to management, risk governance or disciplinary processes.
- Contractual remedies for supplier non-compliance.
- Incident investigation where non-compliance creates or contributes to a security event.
- Reporting to regulators, customers or other stakeholders where legally or contractually required.

Intentional bypassing of operational security controls, unauthorised changes, disabling of malware protection, unauthorised deletion of logs or backups, or misuse of privileged tools shall be treated as serious security violations.

## Exceptions

Exceptions to this Policy shall be permitted only where there is a documented business or technical justification and the associated information security risk has been assessed and approved.

Exception requests shall include:

| Required Information | Description |
|---|---|
| Exception owner | Individual accountable for the exception |
| System or process affected | Asset, service, environment or procedure requiring exception |
| Policy requirement impacted | Specific clause or requirement that cannot be met |
| Business justification | Reason compliance is not currently feasible |
| Risk assessment | Security, operational, legal and compliance impact |
| Compensating controls | Alternative controls to reduce risk |
| Expiry date | Date by which the exception must be reviewed or remediated |
| Approval | Authorised approval from Information Security and relevant business/system owner |

Exceptions shall:

- Be time-bound.
- Be reviewed at least at expiry or upon material change.
- Not be used to permanently avoid compliance without formal risk acceptance.
- Be recorded in the [Risk Register / Exception Register].
- Be revoked if the business justification is no longer valid or the risk becomes unacceptable.

Emergency operational decisions made to protect life, safety, critical services or major business operations may temporarily deviate from this Policy but shall be documented, reviewed and formally approved or remediated as soon as practicable.

## Review & Maintenance

This Policy shall be reviewed at least annually and whenever significant changes occur that may affect operational security requirements, including:

- Changes to ISO/IEC 27001:2022 requirements or applicable laws and regulations.
- Significant changes to business operations, technology architecture or cloud usage.
- Introduction of new critical systems or services.
- Major security incidents or operational failures.
- Internal or external audit findings.
- Material changes to supplier or managed service arrangements.
- Changes to business continuity, disaster recovery or resilience requirements.

The Information Security Manager shall coordinate the review of this Policy with IT Operations, Security Operations, system owners, service owners, risk management and other relevant stakeholders.

Policy updates shall be approved by [Approving Authority] before publication. Superseded versions shall be retained according to [Organisation Name] document retention requirements.