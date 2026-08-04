<!-- pci_dss_v4 / PCI-015 | type=Policy | mode=markdown | model=gpt-5.5 | 25908 chars -->

| Metadata | Value |
|---|---|
| Document ID | [POL-PCI-DATA-RET-DISP] |
| Version | 1.0 |
| Owner | [Information Security / PCI DSS Compliance Owner] |
| Effective Date | [YYYY-MM-DD] |
| Framework | PCI DSS v4.0.1 |
| Classification | Internal |

## Purpose

This Policy establishes mandatory requirements for the retention, storage, masking, truncation, and secure disposal of payment card data in accordance with PCI DSS v4.0.1 Requirements 3.2 and 3.3.

The purpose of this Policy is to ensure that:

- Cardholder data is retained only where there is a defined, documented, and legitimate business or legal need.
- Sensitive authentication data is not retained after authorization, except where explicitly permitted by PCI DSS for issuers or companies supporting issuing services.
- Stored Primary Account Number data is rendered unreadable wherever it is stored.
- Data that is no longer required is securely deleted, destroyed, or otherwise rendered unrecoverable.
- Retention and disposal practices reduce the risk of unauthorized disclosure, misuse, or compromise of payment card data.

## Scope

This Policy applies to all employees, contractors, service providers, business units, processes, applications, databases, systems, endpoints, storage locations, logs, backups, archives, reports, and paper records that store, process, transmit, access, display, or dispose of payment card data within or connected to the Cardholder Data Environment.

This Policy applies to all forms of payment card data, including:

| Data Element | Description | Policy Applicability |
|---|---|---|
| Primary Account Number | The full payment card number, whether stored electronically, displayed, printed, logged, exported, or otherwise retained. | In scope |
| Cardholder Name | Name associated with the payment card, when stored with PAN. | In scope when associated with PAN |
| Expiration Date | Card expiration date, when stored with PAN. | In scope when associated with PAN |
| Service Code | Three- or four-digit value in the magnetic stripe or chip data indicating acceptance requirements and limitations. | In scope when stored with PAN |
| Full Track Data | Full magnetic-stripe equivalent data from the stripe or chip. | Sensitive authentication data; retention prohibited after authorization unless explicitly permitted |
| Card Verification Code/Value | CAV2, CVC2, CVV2, CID, or equivalent value printed on the card or generated for card-not-present transactions. | Sensitive authentication data; retention prohibited after authorization |
| PIN and PIN Block | Personal Identification Number or encrypted PIN block. | Sensitive authentication data; retention prohibited after authorization unless explicitly permitted for issuers or issuer processors |

This Policy applies to payment card data in all storage and processing contexts, including but not limited to:

- Production applications and databases.
- Test, development, staging, analytics, and reporting environments.
- File shares, object storage, data lakes, exports, spreadsheets, and end-user computing tools.
- System, application, database, web server, security, network, and transaction logs.
- Message queues, middleware, temporary files, cache, debug output, crash dumps, and memory dumps.
- Backups, snapshots, replicas, archives, and disaster recovery media.
- Printed receipts, paper forms, mail, fax records, call recordings, and manually retained documentation.
- Data held by third-party service providers acting on behalf of the organisation.

This Policy applies to all personnel and third parties who design, operate, support, administer, monitor, or use systems or processes that may handle payment card data.

## Policy Statements

1. The organisation shall retain cardholder data only where retention is required for a documented legal, regulatory, contractual, operational, dispute-resolution, fraud-management, chargeback, or legitimate business purpose.

2. The organisation shall not retain cardholder data by default or for convenience, and all retention of cardholder data shall be justified, documented, approved, and periodically reviewed.

3. The organisation shall maintain a formal Cardholder Data Retention Schedule that identifies each approved storage location, data element retained, business justification, retention period, disposal method, system owner, and review frequency.

4. The organisation shall ensure that the amount and type of cardholder data retained is limited to the minimum necessary to meet the documented business or legal purpose.

5. The organisation shall not store Sensitive Authentication Data after authorization, even if encrypted, unless the organisation is an issuer or supports issuing services and has a documented, PCI DSS-permitted business justification.

6. The organisation shall prohibit post-authorization storage of the following Sensitive Authentication Data:
 - Full track data or equivalent data from the magnetic stripe or chip.
 - Card verification codes or values used to verify card-not-present transactions, including CAV2, CVC2, CVV2, CID, or equivalent values.
 - PINs and PIN blocks, except where explicitly permitted for issuers or entities supporting issuing services.

7. The organisation shall ensure that any Sensitive Authentication Data collected or processed prior to authorization is securely deleted, overwritten, truncated, or otherwise rendered unrecoverable immediately after completion of the authorization process.

8. The organisation shall ensure that systems, applications, databases, logs, temporary files, transaction records, debugging tools, and monitoring tools do not capture or retain Sensitive Authentication Data after authorization.

9. The organisation shall ensure that payment applications and payment-processing workflows are designed and configured to prevent retention of prohibited Sensitive Authentication Data after authorization.

10. The organisation shall ensure that Primary Account Number data is rendered unreadable anywhere it is stored, including portable digital media, removable media, backups, logs, and data repositories.

11. The organisation shall use one or more PCI DSS-accepted methods to render stored PAN unreadable, including:
 - Strong one-way hashes of the entire PAN based on strong cryptography.
 - Truncation, where only a limited number of digits are retained.
 - Index tokens and securely stored pads.
 - Strong cryptography with associated key-management processes.
 - Other PCI DSS-accepted methods formally approved by the PCI DSS Compliance Owner.

12. The organisation shall not store full PAN in clear text in any system, file, log, report, database, message, email, document, ticket, or paper record.

13. The organisation shall ensure that the first six and last four digits are the maximum number of PAN digits displayed unless a legitimate business need exists for a specific role to view more digits.

14. The organisation shall ensure that roles permitted to view more than the first six and last four digits of PAN are documented, approved, limited to the minimum number of personnel, and reviewed at least every six months.

15. The organisation shall mask PAN when displayed in applications, administrative interfaces, logs, support tools, reports, dashboards, exports, receipts, emails, or printed material, except where display of additional digits is specifically authorized and required for a legitimate business need.

16. The organisation shall prohibit the use of full PAN, Sensitive Authentication Data, or unprotected cardholder data in test, development, training, quality assurance, or demonstration environments unless formally approved, strongly protected, and demonstrably required for a specific PCI DSS-compliant purpose.

17. The organisation shall ensure that cardholder data in non-production environments is tokenized, masked, truncated, anonymized, or otherwise rendered unreadable wherever feasible.

18. The organisation shall prohibit storage of payment card data in unauthorized locations, including personal drives, local desktops, removable media, unmanaged cloud storage, collaboration platforms, chat tools, email inboxes, screenshots, and support tickets.

19. The organisation shall implement controls to identify and prevent unauthorized storage of PAN and Sensitive Authentication Data, including data discovery scans, logging reviews, application design reviews, and secure configuration reviews.

20. The organisation shall conduct data discovery activities at a defined frequency to identify stored PAN and Sensitive Authentication Data in the Cardholder Data Environment and any connected or supporting systems.

21. The organisation shall securely delete, destroy, or render unrecoverable cardholder data that exceeds its approved retention period or no longer has a documented business or legal purpose.

22. The organisation shall perform secure disposal using methods appropriate to the media type, data format, and risk, including cryptographic erasure, secure overwrite, database purge, token deactivation, physical destruction, shredding, pulping, degaussing, or certified destruction.

23. The organisation shall ensure that paper records containing PAN are securely stored prior to disposal and destroyed using cross-cut shredding, pulping, incineration, or an equivalent method that prevents reconstruction.

24. The organisation shall ensure that electronic media containing cardholder data is sanitized or destroyed in accordance with approved secure media disposal standards before reuse, release, return, repair, resale, recycling, or disposal.

25. The organisation shall ensure that backups, archives, snapshots, and disaster recovery copies containing cardholder data are subject to approved retention periods and are securely destroyed or rendered unrecoverable when no longer required.

26. The organisation shall ensure that where individual cardholder data records cannot be selectively deleted from immutable backups, compensating retention controls are implemented, including restricted access, encryption, documented expiration, and destruction at the end of the backup lifecycle.

27. The organisation shall maintain evidence of secure disposal for cardholder data and media, including deletion logs, destruction certificates, service provider attestations, change records, or system-generated audit logs.

28. The organisation shall ensure that third-party service providers that store, process, transmit, or dispose of cardholder data on behalf of the organisation comply with this Policy and PCI DSS v4.0.1 Requirements 3.2 and 3.3.

29. The organisation shall require third-party service providers to confirm, upon request, the retention period, storage locations, protection method, and secure disposal status of cardholder data handled on behalf of the organisation.

30. The organisation shall include data retention and secure disposal requirements in contracts, service agreements, data processing agreements, and security schedules with applicable third-party service providers.

31. The organisation shall ensure that changes to payment applications, data flows, storage repositories, logs, reports, integrations, or third-party services are reviewed for potential impact on cardholder data retention, masking, and disposal requirements.

32. The organisation shall maintain documentation sufficient to demonstrate PCI DSS compliance, including retention schedules, data-flow diagrams, data inventories, access approvals, masking configurations, data discovery results, disposal records, and exception records.

33. The organisation shall classify stored PAN and associated cardholder data at a minimum as confidential payment data and protect it in accordance with the organisation’s information classification and handling requirements.

34. The organisation shall ensure that personnel with responsibilities for payment card data retention, masking, storage, and disposal receive appropriate awareness or role-based training.

35. The organisation shall investigate and remediate any unauthorized retention, display, logging, transmission, or storage of PAN or Sensitive Authentication Data as a security incident or compliance issue.

36. The organisation shall require immediate escalation to the PCI DSS Compliance Owner and Information Security function if Sensitive Authentication Data is discovered after authorization.

37. The organisation shall ensure that retained cardholder data is traceable to a defined system owner and business owner accountable for retention justification, protection, and timely disposal.

38. The organisation shall ensure that retention periods are not extended without documented approval from the business owner, Legal, Privacy, and the PCI DSS Compliance Owner.

39. The organisation shall ensure that retention and disposal controls are incorporated into system acquisition, application development, data architecture, payment channel design, and service onboarding activities.

40. The organisation shall ensure that all approved retention and disposal practices align with applicable laws, payment brand requirements, contractual obligations, and PCI DSS v4.0.1.

The organisation shall maintain the Cardholder Data Retention Schedule using the following minimum structure:

| Data Store / Process | Data Elements Retained | Business / Legal Justification | Maximum Retention Period | Protection Method | Disposal Method | Owner | Review Frequency |
|---|---|---|---|---|---|---|---|
| Payment transaction database | Tokenized PAN, last four digits, authorization code | Transaction reconciliation, chargebacks, customer support | [X months/years] | Tokenization and access control | Automated purge and database deletion | [System Owner] | Quarterly |
| Chargeback case management system | Masked PAN, transaction references | Dispute handling and evidence management | [X months/years] | PAN masking and role-based access | Case purge and secure deletion | [Business Owner] | Quarterly |
| Payment gateway logs | Masked PAN only | Operational troubleshooting and security monitoring | [X days/months] | Masking and log access restriction | Log rotation and secure deletion | [Platform Owner] | Monthly |
| Backup repository | Encrypted database backups containing protected CHD | Recovery and continuity | [X days/months] | Strong encryption and restricted access | Backup expiration and cryptographic erasure | [Infrastructure Owner] | Quarterly |
| Paper receipts / forms | Truncated PAN only | Customer service or legal evidence | [X days/months] | Locked storage | Cross-cut shredding or certified destruction | [Business Owner] | Monthly |

Approved disposal methods shall be selected based on media type and sensitivity:

| Media / Data Type | Minimum Approved Disposal Method | Evidence Required |
|---|---|---|
| Database records containing PAN | Secure deletion, purge job, cryptographic erasure, or token deactivation | Deletion logs, change ticket, or database job report |
| Flat files, exports, spreadsheets, reports | Secure deletion and verified removal from storage locations | Deletion record and scan validation |
| Logs containing masked PAN | Automated retention expiry and secure deletion | Log retention configuration and deletion logs |
| Backups containing protected CHD | Lifecycle expiration, secure media destruction, or cryptographic erasure | Backup system report or destruction certificate |
| Paper records containing PAN | Cross-cut shredding, pulping, incineration, or certified destruction | Destruction log or vendor certificate |
| Removable media | Secure overwrite, cryptographic erasure, degaussing, or physical destruction | Media disposal record |
| Failed drives or storage devices | Physical destruction or certified secure destruction | Chain-of-custody record and destruction certificate |
| Cloud storage objects | Secure deletion, lifecycle deletion, or cryptographic erasure where supported | Cloud audit log or lifecycle policy evidence |

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board / Executive Management | Provide governance support for PCI DSS compliance and ensure adequate resources are available to implement this Policy. |
| PCI DSS Compliance Owner | Own this Policy; interpret PCI DSS Requirements 3.2 and 3.3; approve retention and masking standards; review exceptions; coordinate evidence for PCI DSS assessments. |
| Information Security | Define technical protection requirements for PAN and Sensitive Authentication Data; support data discovery; assess control effectiveness; investigate unauthorized storage or exposure. |
| Data Protection / Privacy Function | Advise on privacy, data minimization, legal basis, and applicable personal data retention obligations involving cardholder data. |
| Legal | Advise on statutory, regulatory, contractual, litigation hold, and payment-brand retention obligations. |
| Business Owners | Justify and approve business retention needs; ensure retained cardholder data is necessary, accurate, protected, and disposed of when no longer required. |
| System Owners | Maintain inventories of cardholder data stores; implement masking, retention, deletion, and disposal controls; provide evidence of compliance. |
| Application Owners | Ensure applications do not store Sensitive Authentication Data after authorization; implement PAN masking, truncation, tokenization, encryption, and deletion requirements. |
| Infrastructure / Cloud Operations | Manage secure storage, backup retention, media sanitization, cryptographic erasure, and secure destruction of infrastructure containing cardholder data. |
| Database Administrators | Implement database retention, purge, masking, access restriction, and secure deletion controls for stored PAN. |
| Logging / Monitoring Teams | Ensure logs do not capture full PAN or Sensitive Authentication Data and that log retention aligns with approved schedules. |
| Procurement / Vendor Management | Ensure third-party service provider contracts include PCI DSS data retention, protection, and disposal obligations. |
| Third-Party Service Providers | Retain, protect, and dispose of cardholder data only as contractually authorized and in accordance with PCI DSS and this Policy. |
| Employees and Contractors | Handle payment card data only as authorized; avoid unauthorized storage; report suspected retention, exposure, or disposal issues immediately. |
| Internal Audit / Compliance Monitoring | Independently review adherence to this Policy and report findings to management. |

## Compliance, Monitoring & Enforcement

Compliance with this Policy is mandatory for all in-scope personnel, systems, processes, and service providers.

The organisation shall monitor compliance through a combination of automated controls, manual reviews, management attestations, and independent assessments. Monitoring activities shall include, at minimum:

| Monitoring Activity | Minimum Frequency | Responsible Role | Evidence |
|---|---:|---|---|
| Review of Cardholder Data Retention Schedule | Quarterly | PCI DSS Compliance Owner / Business Owners | Approved retention schedule |
| PAN and Sensitive Authentication Data discovery scans | At least quarterly and after significant changes | Information Security / System Owners | Scan reports and remediation records |
| Review of systems and logs for prohibited Sensitive Authentication Data | At least quarterly | Information Security / Application Owners | Review results and issue tickets |
| Review of PAN masking and display controls | At least annually and after relevant changes | Application Owners / PCI DSS Compliance Owner | Access reviews and configuration evidence |
| Review of roles permitted to view more than first six and last four PAN digits | At least every six months | Business Owners / Access Control Owner | Approved access review records |
| Review of data purge and deletion jobs | Monthly or according to retention schedule | System Owners / Database Administrators | Job logs and exception reports |
| Review of backup retention and destruction | Quarterly | Infrastructure / Cloud Operations | Backup reports and deletion evidence |
| Review of paper record destruction | Monthly where paper CHD is used | Business Owners | Destruction logs or certificates |
| Review of third-party retention and disposal attestations | At least annually | Vendor Management / PCI DSS Compliance Owner | Attestations, AOC, contract evidence |
| Internal compliance assessment against PCI DSS Requirements 3.2 and 3.3 | At least annually | Internal Audit / Compliance | Assessment report and remediation plan |

Non-compliance with this Policy may result in one or more of the following actions:

- Mandatory remediation within defined timelines.
- Removal or restriction of system access.
- Suspension of processing activity or affected payment channel.
- Formal risk acceptance or exception review where applicable.
- Disciplinary action, up to and including termination of employment or contract.
- Contractual remedies for third-party service provider non-compliance.
- Security incident investigation and notification escalation where required.
- Reporting to executive management, acquiring bank, payment brands, regulators, or other parties where legally or contractually required.

Unauthorized retention of Sensitive Authentication Data after authorization shall be treated as a high-priority compliance and security issue requiring immediate containment, investigation, secure deletion, root-cause analysis, and corrective action.

Any discovery of full PAN in unauthorized locations shall be remediated promptly by securely deleting, masking, tokenizing, encrypting, or otherwise rendering the data unreadable, and by addressing the underlying process or technical control failure.

## Exceptions

Exceptions to this Policy shall be permitted only where there is a documented business, legal, regulatory, or technical reason and where the exception does not violate PCI DSS requirements.

Exceptions shall not be approved for:

- Storage of Sensitive Authentication Data after authorization unless explicitly permitted under PCI DSS for issuers or entities supporting issuing services.
- Clear-text storage of full PAN.
- Retention of cardholder data without a documented business or legal justification.
- Unrestricted display of full PAN.
- Disposal methods that leave cardholder data recoverable without approved compensating controls.

All exception requests shall be documented and approved before implementation, except where emergency action is required to protect the organisation, customers, or payment systems.

Exception requests shall include, at minimum:

| Required Information | Description |
|---|---|
| Exception ID | Unique identifier assigned to the exception request. |
| Requestor | Individual or team requesting the exception. |
| System / Process | Affected system, data store, application, or business process. |
| PCI DSS Requirement Impact | Relevant PCI DSS v4.0.1 requirement, including Requirement 3.2 and/or 3.3. |
| Data Elements Involved | PAN, cardholder data, or Sensitive Authentication Data involved. |
| Business / Legal Justification | Reason the exception is required. |
| Risk Assessment | Security and compliance risks introduced by the exception. |
| Compensating Controls | Controls used to reduce risk during the exception period. |
| Duration | Start date and expiration date. |
| Approvals | Business Owner, Information Security, Legal/Privacy where applicable, and PCI DSS Compliance Owner. |
| Remediation Plan | Actions and target date to return to compliance. |

Approved exceptions shall:

- Be time-bound and expire automatically unless formally renewed.
- Be reviewed at least quarterly.
- Include documented compensating controls.
- Be tracked in the organisation’s risk or compliance register.
- Be made available as evidence during PCI DSS assessments.
- Be revoked immediately if they create unacceptable risk or cause PCI DSS non-compliance.

## Review & Maintenance

This Policy shall be reviewed at least annually and whenever any of the following occur:

- A significant change to payment processing, payment channels, cardholder data flows, or the Cardholder Data Environment.
- A change to PCI DSS, payment brand rules, acquiring bank requirements, or applicable legal and regulatory obligations.
- Introduction of a new system, application, third-party service provider, storage location, reporting process, or data analytics use case involving cardholder data.
- Discovery of unauthorized storage of PAN or Sensitive Authentication Data.
- A security incident involving payment card data.
- Audit, assessment, penetration test, data discovery, or compliance monitoring findings that indicate the Policy requires revision.
- Changes to retention requirements, legal holds, contractual obligations, or disposal technologies.

The PCI DSS Compliance Owner shall coordinate review and maintenance of this Policy with Information Security, Legal, Privacy, Business Owners, System Owners, and other relevant stakeholders.

The review shall verify that:

- Retention requirements remain justified and current.
- Approved retention periods are still necessary and proportionate.
- PAN protection methods remain effective and aligned with PCI DSS v4.0.1.
- Sensitive Authentication Data is not retained after authorization.
- Disposal methods remain appropriate and verifiable.
- Monitoring activities and evidence are sufficient for PCI DSS assessment.
- Third-party service provider obligations remain current and enforceable.
- Exceptions remain valid, approved, and time-bound.

All changes to this Policy shall be version-controlled, approved by the Policy Owner, communicated to relevant personnel, and retained as part of the organisation’s governance records.