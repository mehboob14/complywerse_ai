<!-- iso_27001_2022 / ISO27-024 | type=Procedure | mode=markdown | model=gpt-5.5 | 50074 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [ISMS-PROC-IM-001] | 1.0 | [Incident Management Owner / CISO] | [YYYY-MM-DD] | ISO/IEC 27001:2022 | A.5.24, A.5.25, A.5.26, A.5.27, A.5.28 | Internal |

## Purpose

This procedure defines the required method for detecting, reporting, assessing, responding to, learning from, and collecting evidence from information security events and incidents in support of the organisation’s Information Security Management System (ISMS).

It implements the following ISO/IEC 27001:2022 Annex A controls:

| Control | Control Title | Procedure Coverage |
|---|---|---|
| A.5.24 | Information security incident management planning and preparation | Establishes incident handling roles, communication paths, classification criteria, readiness requirements, and response workflow. |
| A.5.25 | Assessment and decision on information security events | Defines how reported events are assessed, triaged, classified, and escalated into incidents where appropriate. |
| A.5.26 | Response to information security incidents | Defines containment, eradication, recovery, communication, and closure activities. |
| A.5.27 | Learning from information security incidents | Defines post-incident review, root cause analysis, corrective actions, and improvement tracking. |
| A.5.28 | Collection of evidence | Defines requirements for preserving, handling, documenting, and storing evidence to support investigation, disciplinary action, legal action, regulatory response, or insurance claims. |

The objective is to ensure that information security events and incidents are handled consistently, promptly, lawfully, and effectively, with appropriate preservation of evidence and demonstrable lessons learned.

## Scope

This procedure applies to:

- All employees, contractors, temporary workers, third parties, and service providers who access, process, store, transmit, manage, or support organisational information assets.
- All information security events and suspected or confirmed information security incidents affecting:
 - Information systems, networks, applications, databases, cloud services, endpoints, mobile devices, operational technology, and infrastructure.
 - Confidentiality, integrity, or availability of information.
 - Personal data, customer data, intellectual property, regulated data, business-critical information, and ISMS in-scope assets.
 - Third-party or outsourced services used by the organisation.
- All phases of incident management, including:
 - Preparation.
 - Detection.
 - Reporting.
 - Assessment and classification.
 - Response.
 - Communication and escalation.
 - Evidence collection.
 - Recovery and closure.
 - Lessons learned and improvement.

This procedure covers information security incidents such as, but not limited to:

| Incident Type | Examples |
|---|---|
| Malware or ransomware | Malware infection, ransomware encryption, suspicious executable activity, command-and-control traffic. |
| Unauthorised access | Compromised account, privilege misuse, brute-force success, access by unauthorised third party. |
| Data breach or leakage | Loss, disclosure, alteration, exfiltration, or unauthorised access to confidential or personal data. |
| Phishing and social engineering | Credential harvesting, business email compromise, impersonation, fraudulent payment request. |
| Service disruption | Denial-of-service attack, cloud service compromise, business-critical system outage due to security event. |
| Vulnerability exploitation | Exploitation of known or zero-day vulnerability against organisational systems. |
| Insider threat | Malicious, negligent, or accidental actions causing security compromise. |
| Lost or stolen assets | Lost laptop, mobile device, removable media, access badge, or physical records. |
| Physical security event affecting information | Unauthorised entry to secure areas, tampering with equipment, theft of media. |
| Supplier-related incident | Incident at a supplier affecting organisational information, systems, or service delivery. |

Out of scope:

- Non-security operational IT incidents that do not affect confidentiality, integrity, availability, authenticity, or accountability of information.
- Health and safety incidents, unless they also create an information security impact.
- Purely financial fraud investigations with no information security component, unless digital evidence, compromised accounts, or security controls are involved.

Where an event has both information security and non-information-security aspects, this procedure shall be followed for the information security component and coordinated with applicable business continuity, privacy, legal, HR, physical security, fraud, or operational procedures.

## Prerequisites & Inputs

The following prerequisites shall be established and maintained before effective execution of this procedure.

### Required Prerequisites

| Prerequisite | Description | Responsible Role |
|---|---|---|
| Incident Management Owner | Accountable person assigned for maintaining this procedure and coordinating incident management capability. | [CISO / Head of Information Security] |
| Incident Response Team | Named internal or contracted personnel with defined technical, legal, privacy, communications, HR, supplier, and management responsibilities. | Incident Management Owner |
| Reporting Channels | Approved mechanisms for reporting events, including service desk, security mailbox, hotline, ticketing portal, SIEM/SOC alerting, or emergency contact process. | IT Service Management / Security Operations |
| Incident Register | Central register or case management system for recording all reported events, assessments, incidents, actions, decisions, evidence, communications, and closure outcomes. | Security Operations |
| Classification Criteria | Defined severity and priority model for information security events and incidents. | Incident Management Owner |
| Communication Contacts | Current internal and external contact lists, including executive management, legal counsel, privacy officer, regulators where applicable, cyber insurer, law enforcement, suppliers, and external response provider. | Incident Management Owner |
| Evidence Handling Capability | Approved evidence storage location, access controls, chain-of-custody template, forensic acquisition process, and secure transfer method. | Security Operations / Legal |
| Logging and Monitoring | Relevant logs, alerts, endpoint telemetry, network telemetry, cloud audit logs, identity logs, and application logs enabled for in-scope systems. | IT Operations / System Owners |
| Backup and Recovery Capability | Backup status, restoration procedures, recovery time objectives, and recovery point objectives documented for critical systems. | IT Operations / Business Continuity Owner |
| Awareness and Training | Personnel trained to recognise and report information security events promptly. Incident responders trained on assigned responsibilities. | HR / Information Security |
| Supplier Incident Obligations | Contracts or service agreements requiring suppliers to report relevant incidents within agreed timeframes and support investigation. | Procurement / Supplier Manager |

### Inputs

This procedure may be triggered by any of the following inputs:

- User or third-party report of a suspected security event.
- Security monitoring alert from SIEM, EDR, NDR, IDS/IPS, DLP, CASB, email security gateway, identity provider, cloud platform, vulnerability scanner, or log analytics platform.
- Notification from supplier, customer, regulator, cyber threat intelligence source, law enforcement, payment provider, or industry body.
- Discovery of lost or stolen device, media, documents, credentials, or access tokens.
- Detection of unusual system behaviour, data transfer, privileged activity, authentication activity, or configuration change.
- Notification from privacy, legal, HR, physical security, internal audit, business continuity, or fraud team.
- Public disclosure of vulnerability or active exploitation relevant to organisational assets.
- Evidence of policy violation that could affect information security.

### Incident Severity Classification

The following severity model shall be used for triage, escalation, response urgency, and reporting.

| Severity | Description | Examples | Initial Response Target | Escalation |
|---|---|---|---:|---|
| SEV-1 Critical | Confirmed or highly probable incident causing major business impact, significant data breach, ransomware, compromise of critical systems, regulatory exposure, or public/customer impact. | Ransomware on production systems; confirmed exfiltration of personal data; compromise of privileged identity provider account. | 15 minutes | Incident Management Owner, Executive Sponsor, Legal, Privacy, Business Continuity, Communications |
| SEV-2 High | Confirmed incident with material impact to important systems, sensitive data, multiple users, or elevated risk of escalation. | Compromised user account with access to sensitive systems; malware on multiple endpoints; exploitation of internet-facing system. | 1 hour | Incident Management Owner, System Owner, Legal/Privacy if data impact possible |
| SEV-3 Medium | Security incident or significant event with limited scope and controlled impact. | Single endpoint malware contained; phishing user submitted credentials but account quickly secured; unauthorised access attempt with limited exposure. | 4 business hours | Security Operations Lead, System Owner |
| SEV-4 Low | Security event requiring investigation but no confirmed compromise or minimal impact. | Blocked phishing email; failed brute-force attempts; policy violation with no data exposure. | 1 business day | Security Operations as required |

### Event-to-Incident Decision Criteria

An information security event shall be classified as an information security incident when one or more of the following are confirmed or reasonably suspected:

- Unauthorised access to systems, applications, accounts, networks, facilities, or information.
- Loss, theft, unauthorised disclosure, unauthorised modification, or destruction of information.
- Malware execution, persistence, command-and-control activity, ransomware activity, or unauthorised remote access tooling.
- Security control failure resulting in actual or likely compromise.
- Violation of information security policy causing material confidentiality, integrity, or availability risk.
- Abuse or compromise of privileged credentials.
- Exploitation of a vulnerability affecting an organisational asset.
- Disruption to critical or important business services due to malicious or unauthorised activity.
- Incident affecting information processed by or for the organisation through a supplier.
- Legal, regulatory, contractual, customer, or reputational exposure relating to information security.

## Step-by-Step Procedure (numbered)

### 1. Prepare and Maintain Incident Management Capability

1.1. The Incident Management Owner shall maintain an incident management plan that defines:

- Incident response roles and responsibilities.
- Approved reporting channels.
- Severity classification criteria.
- Escalation paths.
- Communication protocols.
- Evidence handling requirements.
- Interfaces with business continuity, disaster recovery, privacy, legal, HR, communications, and supplier management.
- Requirements for post-incident review and corrective action.

1.2. The Incident Management Owner shall appoint and maintain an Incident Response Team with appropriate coverage across the following functions:

| Function | Typical Responsibilities |
|---|---|
| Incident Commander | Coordinates the incident, assigns actions, approves response strategy, maintains decision log. |
| Security Operations | Performs detection, triage, containment, investigation, monitoring, and technical response. |
| IT Operations / Infrastructure | Supports system isolation, recovery, patching, restoration, and technical remediation. |
| System Owner | Provides business context, validates system criticality, approves service-impacting actions. |
| Legal | Advises on legal privilege, evidence handling, regulatory obligations, law enforcement, and contractual obligations. |
| Privacy / Data Protection | Assesses personal data impact and breach notification requirements. |
| Communications | Coordinates internal, customer, media, and stakeholder communications. |
| HR | Supports incidents involving employees, contractors, disciplinary matters, or insider threat. |
| Supplier Manager | Coordinates with third-party providers and obtains supplier incident information. |
| Business Continuity Lead | Coordinates continuity arrangements where service disruption affects critical operations. |

1.3. The Incident Management Owner shall ensure that contact lists are reviewed at least quarterly and after material organisational changes.

1.4. Security Operations shall ensure that incident monitoring and logging sources are operational for in-scope systems, proportionate to risk and legal requirements.

1.5. The Incident Management Owner shall ensure incident response exercises are conducted at least annually and after significant changes to the threat environment, technology estate, or business model.

1.6. The organisation shall ensure all personnel are informed of their obligation to report suspected information security events without delay.

1.7. The Incident Management Owner shall maintain incident response templates, including:

- Incident report form.
- Incident register.
- Severity assessment form.
- Action and decision log.
- Communications log.
- Evidence inventory.
- Chain-of-custody record.
- Post-incident review report.
- Corrective action tracker.

### 2. Detect or Identify an Information Security Event

2.1. An information security event may be detected through automated monitoring, user reporting, supplier notification, external notification, audit activity, system owner review, or management observation.

2.2. Any person who identifies or suspects an information security event shall report it immediately using an approved reporting channel.

2.3. Personnel shall not attempt to investigate beyond basic observation unless authorised to do so, because unauthorised actions may:

- Destroy or alter evidence.
- Alert an attacker.
- Increase operational disruption.
- Breach legal, contractual, or regulatory requirements.

2.4. If a suspected incident appears critical or urgent, the reporter shall use the emergency incident contact process rather than relying solely on email or standard ticketing queues.

2.5. Where a supplier detects an incident affecting organisational information or services, the Supplier Manager shall ensure the supplier provides incident details in accordance with contractual obligations and agreed reporting timeframes.

### 3. Report and Record the Event

3.1. The recipient of the report shall create an entry in the Incident Register or approved case management system.

3.2. The initial record shall include, as available:

| Field | Required Information |
|---|---|
| Event ID | Unique identifier assigned by the incident register or ticketing system. |
| Date and time reported | Date/time including time zone. |
| Reporter | Name, department, contact details, organisation if external. |
| Detection source | User report, SIEM alert, EDR alert, supplier notification, customer report, regulator notice, etc. |
| Description | Factual description of what was observed. |
| Affected assets | Systems, accounts, applications, networks, devices, data stores, locations. |
| Potential data involved | Personal data, confidential data, customer data, credentials, financial data, intellectual property. |
| Initial impact | Known or suspected confidentiality, integrity, availability impact. |
| Actions already taken | Any containment, user action, supplier action, or automated control response. |
| Supporting material | Screenshots, emails, logs, alert IDs, filenames, URLs, IP addresses, timestamps. |
| Initial severity | Preliminary severity based on available information. |
| Assigned owner | Person responsible for triage. |

3.3. The recipient shall acknowledge receipt to the reporter where appropriate and instruct the reporter to preserve relevant information and avoid further unauthorised handling.

3.4. If the report involves personal data, regulated data, legal claims, disciplinary matters, or potential criminal activity, Legal and Privacy shall be notified promptly according to the severity and escalation criteria.

3.5. The incident record shall be maintained throughout the lifecycle of the event or incident.

### 4. Conduct Initial Triage

4.1. Security Operations or the assigned triage owner shall review the report and available evidence to determine:

- Whether the report is an information security event.
- Whether the event appears to be a confirmed or suspected information security incident.
- Whether immediate containment is required.
- Whether personal data, regulated data, or contractual notification obligations may be involved.
- Whether evidence preservation is required.
- Whether additional technical investigation is necessary.

4.2. The triage owner shall assign an initial severity rating using the severity classification table in this procedure.

4.3. The triage owner shall prioritise actions based on:

- Potential impact to confidentiality, integrity, and availability.
- Criticality of affected assets or business services.
- Sensitivity and volume of information involved.
- Likelihood of ongoing compromise.
- Exposure to customers, regulators, suppliers, or public parties.
- Evidence of attacker persistence, lateral movement, or data exfiltration.
- Legal, regulatory, contractual, or safety implications.

4.4. If the event is assessed as not security-relevant, the triage owner shall document the rationale and reassign or close the record as an operational ticket, as appropriate.

4.5. If insufficient information exists, the triage owner shall gather additional facts while preserving evidence and avoiding unnecessary alteration of systems.

4.6. If the event meets incident decision criteria, the triage owner shall declare an information security incident and proceed to Step 5.

### 5. Declare and Classify the Incident

5.1. The Incident Commander or authorised Security Operations Lead shall formally declare an information security incident.

5.2. The incident declaration shall include:

| Declaration Element | Required Content |
|---|---|
| Incident ID | Unique incident reference. |
| Date/time declared | Date/time including time zone. |
| Declaring authority | Name and role. |
| Severity | SEV-1, SEV-2, SEV-3, or SEV-4. |
| Incident type | Malware, ransomware, data breach, unauthorised access, supplier incident, etc. |
| Affected assets | Known or suspected systems, accounts, data, locations, or services. |
| Initial business impact | Operational, financial, legal, regulatory, reputational, customer, or safety impact. |
| Response objectives | Immediate goals such as contain compromise, preserve evidence, restore service, notify stakeholders. |
| Initial response team | Assigned incident roles. |

5.3. The Incident Commander shall determine whether the incident requires activation of:

- Crisis management process.
- Business continuity plan.
- Disaster recovery plan.
- Privacy breach response process.
- Legal privilege protocol.
- External incident response retainer.
- Cyber insurance notification.
- Law enforcement contact.
- Customer or regulator notification process.

5.4. Severity shall be reassessed throughout the incident as facts change.

5.5. All severity changes shall be documented with date, time, decision-maker, rationale, and communication actions.

### 6. Escalate and Mobilise the Response Team

6.1. The Incident Commander shall notify required stakeholders according to severity.

| Severity | Required Internal Notification |
|---|---|
| SEV-1 Critical | Executive Sponsor, CISO, CIO/CTO, Legal, Privacy, Business Continuity, Communications, affected Business Owner, HR where relevant. |
| SEV-2 High | CISO or delegate, Legal/Privacy where data or regulatory impact may exist, affected System Owner, IT Operations Lead, Supplier Manager where relevant. |
| SEV-3 Medium | Security Operations Lead, affected System Owner, IT Operations as needed. |
| SEV-4 Low | Security Operations and relevant operational owner as needed. |

6.2. The Incident Commander shall establish an incident coordination channel appropriate to the severity, such as:

- Dedicated conference bridge.
- Secure messaging channel.
- War room.
- Incident ticket or case workspace.
- Out-of-band communication channel if primary communication systems are compromised.

6.3. The Incident Commander shall assign response roles and record them in the incident record.

6.4. The Incident Commander shall establish meeting cadence for active incidents.

| Severity | Suggested Cadence During Active Response |
|---|---|
| SEV-1 Critical | Every 30–60 minutes or continuously during crisis phase. |
| SEV-2 High | Every 2–4 hours during business hours, more frequently if required. |
| SEV-3 Medium | Daily or as agreed. |
| SEV-4 Low | As required. |

6.5. The Incident Commander shall ensure a decision log and action log are maintained from the point of declaration.

### 7. Preserve and Collect Evidence

7.1. Evidence shall be identified, collected, preserved, handled, transferred, analysed, and stored in a manner that maintains integrity, authenticity, completeness, and admissibility where legal or disciplinary action may result.

7.2. Evidence collection shall be coordinated with Legal before intrusive forensic actions where litigation, law enforcement, employment action, contractual dispute, regulatory investigation, or privilege considerations may apply.

7.3. Responders shall not alter or destroy potential evidence unless necessary to prevent material harm, and any such action shall be documented.

7.4. The following evidence may be collected as relevant:

| Evidence Type | Examples |
|---|---|
| System logs | Authentication logs, operating system logs, firewall logs, proxy logs, VPN logs, cloud audit logs, database logs, application logs. |
| Security alerts | SIEM alerts, EDR detections, IDS/IPS alerts, DLP alerts, email security alerts, vulnerability findings. |
| Endpoint evidence | Disk images, memory captures, process lists, persistence mechanisms, malware samples, registry keys, file metadata. |
| Network evidence | Packet captures, NetFlow, DNS logs, DHCP records, IP connection history. |
| Identity evidence | Account activity, MFA logs, privileged access logs, identity provider audit trails, password reset history. |
| Email evidence | Phishing email headers, message body, attachments, URLs, sender details, mail flow logs. |
| Cloud evidence | Access logs, API activity, configuration changes, storage access records, IAM changes. |
| Physical evidence | Devices, removable media, printed records, access badge records, CCTV references where lawful. |
| Communications | Incident emails, meeting notes, decision logs, supplier communications, customer communications. |

7.5. Evidence shall be recorded in an evidence inventory.

| Evidence ID | Description | Source | Collected By | Date/Time Collected | Hash / Integrity Check | Storage Location | Chain of Custody Required |
|---|---|---|---|---|---|---|---|
| [EVID-001] | [Firewall logs for affected IP range] | [Firewall/SIEM] | [Name] | [YYYY-MM-DD HH:MM TZ] | [SHA-256 hash / N/A] | [Secure evidence repository] | Yes |

7.6. Chain-of-custody records shall be maintained where evidence may be used for disciplinary, legal, regulatory, insurance, or law enforcement purposes.

| Transfer Date/Time | Evidence ID | Released By | Received By | Purpose of Transfer | Method of Transfer | Condition / Integrity Verified |
|---|---|---|---|---|---|---|
| [YYYY-MM-DD HH:MM TZ] | [EVID-001] | [Name] | [Name] | [Forensic analysis] | [Secure transfer / sealed media] | [Hash verified / seal intact] |

7.7. Evidence shall be stored in an approved secure location with access restricted to authorised personnel.

7.8. Copies shall be used for analysis wherever possible. Original evidence shall be preserved intact unless operational necessity requires otherwise.

7.9. Time sources, time zones, and clock synchronisation assumptions shall be documented when reconstructing timelines.

7.10. Evidence retention shall comply with legal, regulatory, contractual, and ISMS record retention requirements.

### 8. Investigate and Analyse the Incident

8.1. The response team shall investigate to determine:

- What happened.
- When it happened.
- How it was detected.
- How the incident occurred.
- Which assets, accounts, systems, networks, applications, and data were affected.
- Whether the incident is ongoing.
- Whether data was accessed, altered, destroyed, exfiltrated, encrypted, or disclosed.
- Whether personal data or regulated data was involved.
- Whether attacker persistence or lateral movement occurred.
- Whether other systems are affected.
- Which vulnerabilities, control failures, or process weaknesses contributed to the incident.
- What immediate and long-term remediation is required.

8.2. The investigation shall use factual, evidence-based analysis and avoid unsupported conclusions.

8.3. The Incident Commander shall maintain a current incident timeline.

| Date/Time | Event | Source of Information | Confidence Level | Notes |
|---|---|---|---|---|
| [YYYY-MM-DD HH:MM TZ] | [Suspicious login from unusual location] | [Identity provider logs] | High | [MFA challenge accepted] |

8.4. The response team shall identify indicators of compromise, including as relevant:

- IP addresses.
- Domains.
- URLs.
- File hashes.
- Email sender addresses.
- User agents.
- Process names.
- Registry keys.
- Persistence mechanisms.
- Command-line arguments.
- Authentication patterns.
- Cloud API calls.
- Data transfer patterns.

8.5. The response team shall search for related indicators across relevant systems to determine scope and potential spread.

8.6. Legal and Privacy shall assess whether personal data breach thresholds, contractual notification thresholds, or regulatory notification obligations may be met.

8.7. If a supplier is involved, the Supplier Manager shall obtain relevant information from the supplier, including:

- Incident description.
- Affected services and data.
- Timeline.
- Root cause or preliminary cause.
- Containment actions.
- Evidence of impact.
- Customer-specific impact assessment.
- Remediation plan.
- Notification status.
- Ongoing risks.

8.8. The Incident Commander shall ensure investigation activity does not unnecessarily disrupt critical services or compromise evidence.

### 9. Contain the Incident

9.1. The response team shall define containment objectives based on incident type, severity, affected assets, business impact, and evidence needs.

9.2. Containment actions may include:

| Scenario | Possible Containment Actions |
|---|---|
| Compromised account | Disable account, revoke sessions, reset credentials, rotate keys, enforce MFA, review delegated access. |
| Malware infection | Isolate endpoint, block indicators, quarantine files, disable persistence, restrict network access. |
| Ransomware | Disconnect affected systems, block lateral movement, disable shared drives, preserve ransom notes and samples, protect backups. |
| Phishing | Remove emails from mailboxes, block sender/domain/URL, reset affected credentials, warn targeted users. |
| Vulnerability exploitation | Block exploit traffic, apply temporary configuration change, disable exposed service, implement WAF rule, patch affected system. |
| Data leakage | Disable sharing link, revoke access, request deletion by unintended recipient, block exfiltration path, preserve audit logs. |
| Cloud compromise | Revoke access keys, disable compromised identity, isolate workloads, snapshot affected resources, review IAM changes. |
| Supplier incident | Confirm containment by supplier, suspend integration if necessary, rotate shared credentials, monitor service impact. |

9.3. Containment decisions that materially affect business operations shall be approved by the Incident Commander in consultation with the System Owner, unless urgent action is required to prevent material harm.

9.4. Emergency containment actions may be taken without prior approval where delay would materially increase risk. Such actions shall be documented and reported to the Incident Commander as soon as possible.

9.5. The response team shall continue monitoring after containment to confirm the incident is not spreading or recurring.

### 10. Eradicate the Cause

10.1. Once sufficient evidence has been collected and containment is in place, the response team shall remove the root cause and attacker capability where feasible.

10.2. Eradication actions may include:

- Removing malware and persistence mechanisms.
- Rebuilding compromised systems from trusted images.
- Applying security patches.
- Correcting insecure configurations.
- Rotating passwords, API keys, certificates, tokens, and secrets.
- Removing unauthorised accounts, access grants, rules, tasks, scripts, or backdoors.
- Disabling vulnerable services.
- Removing malicious email, files, or code.
- Blocking indicators of compromise.
- Updating detection rules.
- Addressing exploited vulnerabilities.
- Correcting supplier integration weaknesses.

10.3. For high-risk compromise, especially privileged account compromise, ransomware, or confirmed attacker persistence, systems shall be rebuilt from trusted sources rather than merely cleaned, unless a documented risk-based exception is approved.

10.4. The response team shall verify eradication through testing, log review, scanning, and monitoring.

10.5. All eradication actions shall be recorded in the incident action log.

### 11. Recover Services and Validate Security

11.1. The response team shall coordinate recovery with IT Operations, System Owners, and Business Continuity where applicable.

11.2. Recovery shall be performed in a controlled sequence that reduces risk of reinfection, recurrence, or data corruption.

11.3. Recovery actions may include:

- Restoring systems from clean backups.
- Rebuilding servers, endpoints, workloads, or containers.
- Restoring application services.
- Re-enabling accounts or access after validation.
- Reconnecting isolated systems.
- Validating data integrity.
- Testing business functionality.
- Confirming security controls are active.
- Monitoring for recurrence.

11.4. Before returning affected systems to production, the System Owner and Security Operations shall verify that:

| Validation Area | Required Check |
|---|---|
| Security configuration | Hardening, logging, access control, and monitoring restored. |
| Vulnerabilities | Known exploited vulnerabilities remediated or mitigated. |
| Malware / persistence | No known malicious artefacts or persistence remain. |
| Identity | Credentials, tokens, and privileged access reviewed and rotated where required. |
| Data integrity | Data restored or validated against trusted source where feasible. |
| Backup status | Current clean backup available after recovery. |
| Monitoring | Enhanced monitoring enabled for recurrence indicators. |
| Business functionality | System performs required business functions. |

11.5. The Incident Commander shall approve incident transition from active response to monitoring when containment, eradication, and recovery objectives have been met.

11.6. Enhanced monitoring shall continue for a period appropriate to incident severity and threat characteristics.

### 12. Manage Communications and Notifications

12.1. Incident communications shall be coordinated by the Incident Commander and approved by appropriate stakeholders before release.

12.2. Communications shall be accurate, timely, need-to-know, and consistent with legal, regulatory, contractual, and reputational considerations.

12.3. Unauthorised personnel shall not communicate incident details externally or broadly internally.

12.4. Communications may include:

| Audience | Communication Owner | Content Considerations |
|---|---|---|
| Executive management | Incident Commander / CISO | Severity, business impact, decisions required, response status, risk exposure. |
| Employees | Communications / HR / Security | Action required, awareness guidance, service impact, reporting instructions. |
| Customers | Communications / Legal / Business Owner | Service impact, data impact, mitigation actions, support channels, contractual obligations. |
| Regulators | Legal / Privacy | Required facts, timelines, affected data, containment, remediation, statutory requirements. |
| Suppliers | Supplier Manager | Required support, logs, containment actions, contractual obligations. |
| Cyber insurer | Legal / Finance / CISO | Incident facts, policy notification requirements, approved service providers. |
| Law enforcement | Legal / Executive Sponsor | Criminal activity, evidence status, risk considerations. |
| Media | Communications / Executive Sponsor | Approved public statement only. |

12.5. Where personal data may be involved, the Privacy function shall assess notification obligations using applicable privacy laws and regulatory guidance.

12.6. Where contractual obligations may be triggered, Legal and the relevant Business Owner shall assess notification requirements and deadlines.

12.7. The Communications Lead shall maintain a communications log.

| Date/Time | Audience | Sender | Method | Summary | Approval |
|---|---|---|---|---|---|
| [YYYY-MM-DD HH:MM TZ] | [Executive Team] | [Name] | [Email / briefing] | [Status update and decisions required] | [Approver] |

12.8. Public statements, customer notifications, regulatory notifications, and law enforcement communications shall be approved by Legal and the Executive Sponsor before release unless immediate notification is legally required.

### 13. Close the Incident

13.1. The Incident Commander may close an incident only when the following closure criteria are satisfied:

| Closure Criterion | Required Evidence |
|---|---|
| Incident contained | Evidence that compromise has stopped or exposure has been removed. |
| Root cause understood or reasonably assessed | Investigation summary or documented rationale where full root cause cannot be determined. |
| Eradication completed | Technical remediation records, system rebuilds, patching, credential rotation, or equivalent. |
| Recovery completed | Business service restored or accepted residual impact documented. |
| Evidence preserved | Evidence inventory and chain-of-custody completed where applicable. |
| Notifications completed | Required internal, external, legal, regulatory, contractual, or customer notifications completed or formally deemed not required. |
| Monitoring plan established | Enhanced monitoring completed or assigned. |
| Corrective actions raised | Remediation items entered into corrective action tracker. |
| Incident record complete | Timeline, decisions, actions, communications, and approvals documented. |

13.2. The Incident Commander shall document final incident classification, impact assessment, root cause or suspected root cause, response summary, and closure decision.

13.3. Closure shall be approved by the Incident Management Owner for SEV-1 and SEV-2 incidents.

13.4. SEV-3 and SEV-4 incidents may be closed by Security Operations Lead unless escalation criteria apply.

13.5. Closed incidents shall remain available for audit, trend analysis, lessons learned, legal review, and ISMS improvement.

### 14. Conduct Post-Incident Review and Lessons Learned

14.1. A post-incident review shall be conducted for all SEV-1 and SEV-2 incidents, and for SEV-3 incidents where the Incident Management Owner determines there is meaningful learning value.

14.2. Post-incident review shall occur within the following target timelines:

| Severity | Post-Incident Review Target |
|---|---:|
| SEV-1 Critical | Within 10 business days of closure |
| SEV-2 High | Within 15 business days of closure |
| SEV-3 Medium | Within 30 business days where required |
| SEV-4 Low | Trend review as part of periodic incident analysis |

14.3. The review shall include relevant stakeholders, including Security Operations, IT Operations, System Owner, Legal, Privacy, Business Continuity, Supplier Manager, and Communications where relevant.

14.4. The post-incident review shall assess:

- Incident timeline and detection point.
- Root cause and contributing factors.
- Effectiveness of detection, reporting, triage, escalation, containment, eradication, recovery, communication, and evidence handling.
- Whether response objectives were achieved.
- Whether legal, regulatory, contractual, and customer obligations were met.
- Impact to confidentiality, integrity, and availability.
- Adequacy of logging, monitoring, access controls, backups, vulnerability management, supplier controls, and user awareness.
- Opportunities to improve policies, procedures, standards, controls, training, tooling, contracts, and architecture.
- Whether risk assessments, risk treatment plans, or the Statement of Applicability require updates.

14.5. The post-incident review shall avoid blame and focus on factual analysis, control effectiveness, accountability for actions, and ISMS improvement.

14.6. Corrective actions shall be documented with owners and due dates.

| Action ID | Finding / Lesson | Corrective Action | Owner | Due Date | Priority | Status |
|---|---|---|---|---|---|---|
| [CA-001] | [MFA not enforced for admin portal] | [Enable MFA for all admin access] | [Name / Role] | [YYYY-MM-DD] | High | Open |

14.7. Corrective actions shall be tracked to completion through the ISMS corrective action process or approved risk treatment process.

14.8. Where corrective actions are not completed by the due date, the responsible owner shall provide rationale and revised target date. High-risk overdue actions shall be escalated to the Incident Management Owner and ISMS governance forum.

### 15. Analyse Trends and Improve the ISMS

15.1. The Incident Management Owner shall periodically review incident data to identify trends, recurring causes, control weaknesses, and improvement opportunities.

15.2. Trend analysis shall include, where data is available:

- Number of events and incidents by type.
- Number of incidents by severity.
- Mean time to detect.
- Mean time to triage.
- Mean time to contain.
- Mean time to recover.
- Repeated affected assets or business units.
- Repeated root causes.
- Supplier-related incident patterns.
- Phishing susceptibility trends.
- Control failures.
- Evidence handling issues.
- Notification or escalation delays.
- Corrective action completion rates.

15.3. Incident trends shall be reported to ISMS management review or an equivalent governance forum at planned intervals.

15.4. Outputs from incident trend analysis may result in:

- Risk assessment updates.
- Statement of Applicability updates.
- Security control improvements.
- Monitoring rule improvements.
- Additional training or awareness.
- Supplier contract or performance review.
- Architecture or configuration changes.
- Business continuity or disaster recovery improvements.
- Policy, procedure, or standard updates.
- Internal audit focus areas.

## Roles & RACI

| Activity | Incident Management Owner | Incident Commander | Security Operations | IT Operations | System Owner | Legal | Privacy | Communications | HR | Supplier Manager | Executive Sponsor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Maintain incident procedure and plan | A | C | R | C | C | C | C | C | C | C | I |
| Maintain reporting channels | A | C | R | R | C | I | I | I | I | C | I |
| Receive and record event reports | A | C | R | R | C | I | I | I | I | C | I |
| Initial triage and severity assignment | A | C | R | C | C | C | C | I | I | C | I |
| Declare incident | A | R | R | C | C | C | C | I | I | C | I |
| Appoint response roles | A | R | C | C | C | C | C | C | C | C | I |
| Conduct technical investigation | C | A | R | R | C | C | C | I | I | C | I |
| Collect and preserve evidence | C | A | R | R | C | C | C | I | C | C | I |
| Approve legal evidence strategy | I | C | C | I | I | A/R | C | I | C | I | I |
| Containment actions | C | A | R | R | C | C | C | I | I | C | I |
| Eradication and remediation | C | A | R | R | R | C | C | I | I | C | I |
| Service recovery | C | A | C | R | R | I | I | I | I | C | I |
| Privacy impact assessment | I | C | C | I | C | C | A/R | I | I | C | I |
| Regulatory or contractual notification assessment | I | C | C | I | C | A/R | R | C | I | C | I |
| Customer or public communications | I | C | I | I | C | A | C | R | C | C | A |
| Supplier coordination | C | C | C | C | C | C | C | I | I | A/R | I |
| Business escalation | A | R | C | C | C | C | C | C | C | C | A |
| Incident closure approval for SEV-1/SEV-2 | A/R | R | C | C | C | C | C | I | I | C | I |
| Post-incident review | A | R | R | C | C | C | C | C | C | C | I |
| Corrective action tracking | A | R | R | R | R | C | C | I | C | C | I |
| Incident metrics and trend reporting | A/R | C | R | C | C | I | I | I | I | C | I |

RACI legend:

| Term | Meaning |
|---|---|
| R | Responsible for performing the activity. |
| A | Accountable for ensuring the activity is completed and approved. |
| C | Consulted before or during the activity. |
| I | Informed of progress or outcome. |

## Records & Outputs

The following records shall be created and retained as evidence of effective incident management.

| Record / Output | Description | Owner | Minimum Retention |
|---|---|---|---|
| Incident Register | Central record of all reported information security events and incidents. | Security Operations | [Retention period] |
| Incident Report | Summary of incident facts, classification, timeline, impact, response, closure, and lessons learned. | Incident Commander | [Retention period] |
| Event Triage Record | Assessment of whether an event is an incident, including rationale and severity. | Security Operations | [Retention period] |
| Action Log | Record of response tasks, owners, timestamps, and status. | Incident Commander | [Retention period] |
| Decision Log | Record of key decisions, approvals, assumptions, and rationale. | Incident Commander | [Retention period] |
| Communications Log | Record of internal and external communications relating to the incident. | Communications / Incident Commander | [Retention period] |
| Evidence Inventory | Record of evidence collected, source, collector, timestamp, integrity details, and storage location. | Security Operations | [Retention period] |
| Chain-of-Custody Records | Record of evidence possession, transfer, purpose, and integrity verification. | Security Operations / Legal | [Retention period] |
| Technical Investigation Notes | Logs, findings, indicators of compromise, forensic notes, and analysis results. | Security Operations | [Retention period] |
| Impact Assessment | Assessment of business, data, legal, regulatory, customer, and operational impact. | Incident Commander / Legal / Privacy | [Retention period] |
| Notification Assessment | Determination of whether regulatory, customer, contractual, insurer, or law enforcement notification is required. | Legal / Privacy | [Retention period] |
| Post-Incident Review Report | Lessons learned, root cause analysis, effectiveness review, and improvement recommendations. | Incident Management Owner | [Retention period] |
| Corrective Action Tracker | Actions arising from incidents, owners, due dates, status, and closure evidence. | Incident Management Owner | [Retention period] |
| Metrics and Trend Reports | Aggregated incident statistics and trends for ISMS management review. | Incident Management Owner | [Retention period] |

Records shall be:

- Accurate, complete, and contemporaneous where practicable.
- Protected from unauthorised access, alteration, deletion, or disclosure.
- Classified according to sensitivity and legal requirements.
- Stored in approved repositories.
- Retained and disposed of according to the organisation’s information retention requirements.
- Available for internal audit, external audit, management review, legal review, regulatory review, and continual improvement activities where authorised.

Incident records containing sensitive security details, personal data, legal advice, forensic artefacts, or privileged communications shall be access restricted on a need-to-know basis.

## Exceptions & Escalation

### Exceptions

Exceptions to this procedure are permitted only where:

- Immediate action is required to prevent material harm and full procedural compliance would cause unacceptable delay.
- Legal, regulatory, or law enforcement requirements require a different approach.
- A supplier-controlled environment limits direct organisational action.
- Evidence collection is technically infeasible or would cause disproportionate business impact.
- A documented risk-based decision is approved by the appropriate authority.

All exceptions shall be documented in the incident record and include:

| Field | Required Content |
|---|---|
| Exception ID | Unique exception reference. |
| Incident ID | Related incident reference. |
| Procedure requirement not followed | Specific requirement or step. |
| Reason for exception | Business, legal, technical, operational, or emergency rationale. |
| Risk assessment | Potential impact of the exception. |
| Compensating controls | Alternative actions taken to reduce risk. |
| Approval | Name and role of approver. |
| Date/time approved | Date/time including time zone. |
| Review date | Date when exception will be reassessed, if applicable. |

### Escalation Triggers

The incident shall be escalated immediately to the Incident Management Owner and relevant executive stakeholders where any of the following occur:

- Incident is or may become SEV-1 Critical.
- Ransomware or destructive malware is suspected.
- Privileged account compromise is suspected.
- Personal data breach is suspected or confirmed.
- Sensitive customer, regulated, or confidential data may have been accessed, disclosed, altered, or exfiltrated.
- Business-critical systems are unavailable or at risk.
- A supplier incident materially affects organisational information or service delivery.
- Legal, regulatory, contractual, customer, insurer, or law enforcement notification may be required.
- Media attention, customer concern, or reputational impact is likely.
- Insider threat, employee misconduct, or disciplinary action may be involved.
- Evidence may be required for legal proceedings.
- Incident response requires expenditure, external specialist support, or management decisions outside delegated authority.
- Incident appears to involve nation-state, organised crime, or targeted attack activity.
- Containment or recovery actions could materially disrupt business operations.

### Escalation Path

| Escalation Level | Trigger | Escalated To | Target Timing |
|---|---|---|---:|
| Operational | SEV-3 or SEV-4 requiring system owner action | Security Operations Lead, IT Operations, System Owner | Same business day |
| Management | SEV-2 or significant business/data impact | Incident Management Owner, affected Business Owner, Legal/Privacy as applicable | Within 1 hour of classification |
| Executive | SEV-1, major disruption, data breach, regulatory exposure, public/customer impact | Executive Sponsor, CISO, CIO/CTO, Legal, Communications, Business Continuity | Immediately, target within 15 minutes |
| Crisis | Major enterprise impact or external crisis conditions | Crisis Management Team / Executive Committee | Immediately after executive escalation |

Where normal escalation channels are unavailable or compromised, responders shall use approved out-of-band communication methods.

## Review

This procedure shall be reviewed:

- At least annually.
- After any SEV-1 or significant SEV-2 incident.
- After incident response exercises where improvement opportunities are identified.
- After material changes to:
 - Threat landscape.
 - Regulatory obligations.
 - Business operations.
 - Technology architecture.
 - Supplier arrangements.
 - Logging, monitoring, or incident tooling.
 - ISMS scope or risk profile.
- Following relevant internal audit, external audit, management review, or corrective action findings.

The Incident Management Owner is responsible for coordinating the review and ensuring updates are approved, communicated, and implemented.

Review activities shall include:

| Review Area | Review Criteria |
|---|---|
| Control alignment | Continued alignment with ISO/IEC 27001:2022 A.5.24, A.5.25, A.5.26, A.5.27, and A.5.28. |
| Effectiveness | Whether incidents are detected, reported, triaged, contained, recovered, and closed within expected timeframes. |
| Lessons learned | Whether post-incident actions are completed and reduce recurrence. |
| Evidence handling | Whether evidence collection and chain-of-custody practices remain adequate. |
| Communications | Whether escalation and notification processes remain accurate and timely. |
| Roles and contacts | Whether response roles, contact lists, and supplier contacts are current. |
| Legal and regulatory obligations | Whether notification and retention requirements remain accurate. |
| Tooling and logs | Whether logging, monitoring, case management, and forensic capabilities remain fit for purpose. |
| Training and exercises | Whether personnel and responders remain competent and prepared. |

Document changes shall be controlled through the organisation’s document control process. Previous approved versions shall be retained according to ISMS document retention requirements.