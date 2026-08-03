<!-- iso_27001_2022 / ISO27-035 | type=Register | mode=table | model=gpt-5.5 | 13617 chars -->

## Incident Log / Register (XLSX template)

_Editable template — add your own rows. The example row(s) below are placeholders to replace._

| Incident ID | Linked Event ID(s) | Date/Time Detected | Date/Time Reported | Reported By | Reporting Channel | Incident Title | Event/Incident Description | Affected Information Asset(s) | Affected System(s)/Service(s) | Affected Business Process | Location/Environment | Incident Category | Suspected Root Cause | Threat Actor Type | Confidentiality Impact | Integrity Impact | Availability Impact | Personal Data Involved | Sensitive/Regulated Data Involved | Initial Severity | Business Impact Summary | Incident Status | Incident Owner | Response Team Members | Escalation Required | Escalated To | Date/Time Escalated | Response Procedure/Playbook Used | Containment Actions Taken | Date/Time Contained | Eradication Actions Taken | Recovery Actions Taken | Date/Time Service Restored | External Notification Required | External Parties Notified | Date/Time External Notification Sent | Legal/Regulatory Requirement Reference | Customer/Stakeholder Communication Required | Communication Summary | Evidence Collected | Evidence Storage Location | Chain of Custody Reference | Forensic Analysis Required | Forensic Analysis Summary | Lessons Learned Required | Lessons Learned Summary | Corrective/Improvement Actions | Linked Risk ID(s) | Linked Problem/Change/Ticket ID(s) | Final Severity | Closure Date | Closed By | Closure Approval | Record Retention Period | Last Updated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [EXAMPLE: INC-2025-0001] | [EXAMPLE: SIEM-908771, EDR-44521] | [EXAMPLE: 2025-03-14 09:22 UTC] | [EXAMPLE: 2025-03-14 09:35 UTC] | [EXAMPLE: SOC Analyst] | [EXAMPLE: SIEM Alert] | [EXAMPLE: Suspicious privileged login from unusual location] | [EXAMPLE: Multiple failed logins followed by successful privileged login from unfamiliar IP address.] | [EXAMPLE: IAM-PRD-001] | [EXAMPLE: Corporate identity provider] | [EXAMPLE: User access management] | [EXAMPLE: Production / Cloud] | [EXAMPLE: Unauthorized Access] | [EXAMPLE: Compromised credentials suspected] | [EXAMPLE: External] | [EXAMPLE: Medium] | [EXAMPLE: Low] | [EXAMPLE: None] | [EXAMPLE: Unknown] | [EXAMPLE: Yes - privileged account metadata] | [EXAMPLE: High] | [EXAMPLE: Potential unauthorized access to administrative console; no confirmed data export at initial assessment.] | [EXAMPLE: Containment in Progress] | [EXAMPLE: Security Incident Manager] | [EXAMPLE: SOC Lead, IAM Administrator, Legal Counsel] | [EXAMPLE: Yes] | [EXAMPLE: CISO] | [EXAMPLE: 2025-03-14 10:00 UTC] | [EXAMPLE: IRP-01 v2.1; Unauthorized Access Playbook v1.0] | [EXAMPLE: Account disabled, active sessions revoked, suspicious IP blocked.] | [EXAMPLE: 2025-03-14 10:15 UTC] | [EXAMPLE: Password reset, MFA re-registered, access review completed.] | [EXAMPLE: Administrative access restored after validation.] | [EXAMPLE: 2025-03-14 13:40 UTC] | [EXAMPLE: Under Review] | [EXAMPLE: N/A] | [EXAMPLE: N/A] | [EXAMPLE: GDPR Article 33 assessment pending] | [EXAMPLE: Under Review] | [EXAMPLE: Internal update sent to CISO and IAM owner at 2025-03-14 10:05 UTC.] | [EXAMPLE: SIEM logs, IAM audit logs, EDR telemetry, screenshots of alert.] | [EXAMPLE: Evidence vault case EV-2025-0314-01] | [EXAMPLE: CoC-2025-0007] | [EXAMPLE: Yes] | [EXAMPLE: Pending] | [EXAMPLE: Yes] | [EXAMPLE: Pending post-incident review] | [EXAMPLE: Review conditional access policy; ACTION-2025-044 assigned to IAM Manager due 2025-04-01.] | [EXAMPLE: RISK-2025-012] | [EXAMPLE: CHG-55321, TKT-88109] | [EXAMPLE: High] | [EXAMPLE: 2025-03-21] | [EXAMPLE: Security Incident Manager] | [EXAMPLE: CISO approval recorded in ticket TKT-88109] | [EXAMPLE: 6 years] | [EXAMPLE: 2025-03-21 16:30 UTC] |

### Column Guidance

| Column | What to enter |
|---|---|
| Incident ID | Enter the unique incident reference assigned by the organisation, using the defined format such as INC-YYYY-0001. |
| Linked Event ID(s) | Enter any related security event, alert, SIEM, EDR, helpdesk, or monitoring IDs; use comma-separated values if more than one, or 'N/A'. |
| Date/Time Detected | Enter the date and time the event or incident was first detected in ISO 8601 format: YYYY-MM-DD HH:MM, including timezone if used. |
| Date/Time Reported | Enter the date and time the event or incident was reported to the security/incident response function in format YYYY-MM-DD HH:MM. |
| Reported By | Enter the name, role, team, supplier, customer, or automated system that reported the event or incident. |
| Reporting Channel | Enter the channel used to report the incident, such as SIEM Alert, EDR Alert, Helpdesk Ticket, Email, Phone, User Report, Supplier Notification, Customer Notification, or Other. |
| Incident Title | Enter a short descriptive title that clearly identifies the incident, such as 'Phishing email with credential harvesting link'. |
| Event/Incident Description | Enter a factual summary of what happened, including observed indicators, timeline known so far, and how the issue was identified. |
| Affected Information Asset(s) | Enter the information asset name or asset register ID affected, such as database, document repository, endpoint asset ID, application, or data set. |
| Affected System(s)/Service(s) | Enter the system, application, infrastructure component, cloud service, network segment, or business service affected. |
| Affected Business Process | Enter the business process impacted, such as payroll, customer onboarding, order fulfilment, finance reporting, or 'N/A'. |
| Location/Environment | Enter the physical or logical environment affected, such as Production, Test, Development, Corporate Network, Cloud, Data Centre, Remote User, or Office Location. |
| Incident Category | Select the best-fit category: Malware, Phishing, Unauthorized Access, Data Loss/Leakage, Denial of Service, Vulnerability Exploitation, Misconfiguration, Insider Threat, Physical Security, Third-Party Incident, Policy Violation, or Other. |
| Suspected Root Cause | Enter the suspected cause at the time of assessment, such as compromised credentials, unpatched vulnerability, user error, malicious email, misconfiguration, supplier failure, unknown, or 'To be determined'. |
| Threat Actor Type | Enter the suspected actor type: External, Internal, Third Party/Supplier, Automated/Bot, Nation State, Criminal, Hacktivist, Unknown, or N/A. |
| Confidentiality Impact | Enter the assessed impact to confidentiality: None, Low, Medium, High, or Unknown. |
| Integrity Impact | Enter the assessed impact to integrity: None, Low, Medium, High, or Unknown. |
| Availability Impact | Enter the assessed impact to availability: None, Low, Medium, High, or Unknown. |
| Personal Data Involved | Enter Yes, No, or Unknown; if Yes, include type of personal data and approximate number of data subjects in the description or communication fields. |
| Sensitive/Regulated Data Involved | Enter Yes, No, or Unknown; if Yes, specify the data type such as financial, health, payment card, credentials, confidential business data, export-controlled, or regulated records. |
| Initial Severity | Enter the initial severity rating using the organisation's incident classification scheme, such as Critical, High, Medium, Low, or Informational. |
| Business Impact Summary | Enter a concise summary of operational, financial, legal, regulatory, contractual, customer, safety, or reputational impact known at assessment. |
| Incident Status | Enter the current lifecycle status: New, Under Assessment, Incident Confirmed, Containment in Progress, Contained, Eradication in Progress, Recovery in Progress, Monitoring, Closed, or False Positive. |
| Incident Owner | Enter the accountable person or role managing the incident response, such as Security Incident Manager, SOC Lead, IT Operations Manager, or named owner. |
| Response Team Members | Enter the names or roles involved in response, including security, IT, legal, privacy, communications, HR, business owner, supplier, or other relevant participants. |
| Escalation Required | Enter Yes or No based on the incident response plan escalation criteria. |
| Escalated To | Enter the role, team, committee, or management level escalated to, such as CISO, DPO, Legal Counsel, Crisis Management Team, Executive Management, or N/A. |
| Date/Time Escalated | Enter the date and time escalation occurred in format YYYY-MM-DD HH:MM, or 'N/A' if not escalated. |
| Response Procedure/Playbook Used | Enter the approved incident response plan, procedure, or playbook reference used, including version if applicable, such as IRP-01 v2.1 or Phishing Playbook v1.4. |
| Containment Actions Taken | Enter actions taken to limit impact, such as account disabled, host isolated, firewall rule applied, malicious domain blocked, email removed, or service suspended. |
| Date/Time Contained | Enter the date and time containment was achieved in format YYYY-MM-DD HH:MM, or 'N/A' if not yet contained. |
| Eradication Actions Taken | Enter actions taken to remove the cause, such as malware removed, credentials reset, vulnerability patched, unauthorized access revoked, or misconfiguration corrected. |
| Recovery Actions Taken | Enter actions taken to restore normal operations, such as system rebuilt, backup restored, service validated, monitoring increased, or user access restored. |
| Date/Time Service Restored | Enter the date and time affected service or process was restored in format YYYY-MM-DD HH:MM, or 'N/A' if not applicable. |
| External Notification Required | Enter Yes, No, or Under Review based on legal, regulatory, contractual, customer, insurer, law enforcement, or supervisory authority obligations. |
| External Parties Notified | Enter external parties notified, such as regulator, customer, supplier, insurer, law enforcement, CERT, processor/controller, or 'N/A'. |
| Date/Time External Notification Sent | Enter the date and time external notification was sent in format YYYY-MM-DD HH:MM, or 'N/A'. |
| Legal/Regulatory Requirement Reference | Enter applicable legal, regulatory, contractual, or policy reference, such as GDPR Article 33, contractual SLA clause, sector regulation, or 'N/A'. |
| Customer/Stakeholder Communication Required | Enter Yes, No, or Under Review based on communication criteria in the incident response or communications plan. |
| Communication Summary | Enter a brief record of internal and external communications made, including audience, date/time, method, and message summary. |
| Evidence Collected | Enter a list of evidence gathered, such as logs, screenshots, email headers, disk images, memory captures, alerts, access records, or configuration exports. |
| Evidence Storage Location | Enter the secure repository path, case management link, evidence vault reference, or forensic storage location where evidence is retained. |
| Chain of Custody Reference | Enter the chain of custody form/reference number for evidence handling, or 'N/A' if not required. |
| Forensic Analysis Required | Enter Yes or No based on severity, legal/regulatory need, evidence preservation requirements, or incident response procedure. |
| Forensic Analysis Summary | Enter a concise summary of forensic findings or 'Pending'/'N/A' if not completed or not required. |
| Lessons Learned Required | Enter Yes or No according to incident severity and the organisation's post-incident review criteria. |
| Lessons Learned Summary | Enter key findings from post-incident review, including what worked, what failed, and control gaps identified, or 'Pending'/'N/A'. |
| Corrective/Improvement Actions | Enter agreed remediation and improvement actions, owners, due dates, and action tracker IDs where available. |
| Linked Risk ID(s) | Enter related risk register IDs that were created or updated because of the incident, or 'N/A'. |
| Linked Problem/Change/Ticket ID(s) | Enter related service desk, problem management, change management, vulnerability, or remediation ticket IDs, comma-separated if multiple. |
| Final Severity | Enter the final confirmed severity after investigation: Critical, High, Medium, Low, Informational, or False Positive. |
| Closure Date | Enter the date the incident was formally closed in format YYYY-MM-DD, or leave blank until closure. |
| Closed By | Enter the name and role of the person closing the incident record, or leave blank until closure. |
| Closure Approval | Enter the approver name/role or approval record confirming containment, recovery, evidence retention, communications, and lessons learned are complete. |
| Record Retention Period | Enter the required retention period for the incident record and evidence, such as 3 years, 6 years, 7 years, or as defined by legal/regulatory requirement. |
| Last Updated | Enter the most recent update date/time for this register row in format YYYY-MM-DD HH:MM. |

### Maintenance

The Incident Log/Register is owned by the Security Incident Manager or SOC Manager, with oversight from the CISO and input from IT, Legal, Privacy, Communications, and business owners as required. It is updated in real time during incident handling and reviewed at least monthly, drawing from the incident management platform, SIEM/SOAR, EDR, service desk, evidence repository, and post-incident review records.