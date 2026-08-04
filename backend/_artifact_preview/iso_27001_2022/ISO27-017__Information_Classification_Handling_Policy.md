<!-- iso_27001_2022 / ISO27-017 | type=Policy | mode=markdown | model=gpt-5.5 | 31764 chars -->

| Metadata | Value |
|---|---|
| Document ID | [ISMS-POL-CLASS-001] |
| Version | 1.0 |
| Owner | Information Security Manager |
| Effective Date | [Effective Date] |
| Framework | ISO/IEC 27001:2022 |
| Classification | Internal |

## Purpose

This Information Classification & Handling Policy establishes mandatory requirements for classifying, labelling, handling, storing, transmitting, sharing, retaining, and disposing of information based on its value, sensitivity, legal and regulatory requirements, and business criticality.

This policy supports the organisation’s Information Security Management System (ISMS) and implements the requirements of ISO/IEC 27001:2022 Annex A controls:

- **A.5.12 — Classification of information:** Information shall be classified according to the information security needs of the organisation based on confidentiality, integrity, availability, and relevant stakeholder requirements.
- **A.5.13 — Labelling of information:** Appropriate procedures for information labelling shall be developed and implemented in accordance with the information classification scheme adopted by the organisation.

The objectives of this policy are to:

- Ensure information receives protection appropriate to its classification.
- Provide a consistent classification scheme across the organisation.
- Define minimum handling rules for each classification level.
- Reduce the likelihood of unauthorised disclosure, modification, loss, destruction, or misuse of information.
- Support legal, regulatory, contractual, privacy, and business requirements.
- Enable employees, contractors, and third parties to identify and handle information correctly.

## Scope

This policy applies to:

- All employees, contractors, temporary staff, consultants, suppliers, service providers, and other third parties who access, process, store, transmit, or manage organisational information.
- All information owned, created, collected, processed, stored, transmitted, or disposed of by or on behalf of the organisation.
- Information in all formats, including electronic, paper, verbal, visual, audio, system-generated, and machine-readable information.
- All information systems, applications, databases, collaboration platforms, file repositories, endpoints, mobile devices, removable media, cloud services, backups, and physical records used to process organisational information.
- Information shared internally or externally, including with customers, regulators, suppliers, partners, auditors, and other authorised stakeholders.

This policy applies throughout the information lifecycle, including creation, collection, classification, labelling, use, access, storage, transfer, sharing, archival, retention, and secure disposal.

## Policy Statements

1. **General Classification Requirements**

 1.1. The organisation shall maintain and apply a formal information classification scheme based on the sensitivity, criticality, legal obligations, regulatory requirements, contractual commitments, business value, and potential impact of unauthorised disclosure, alteration, destruction, or unavailability of information.

 1.2. All organisational information shall be classified using one of the approved classification levels defined in this policy.

 1.3. Information classification shall be determined by the information owner, or by a delegated custodian acting under the authority of the information owner.

 1.4. Classification decisions shall consider confidentiality, integrity, availability, privacy, commercial sensitivity, intellectual property value, regulatory obligations, and the need-to-know principle.

 1.5. Information shall be protected according to its classification level, regardless of format, location, system, or storage medium.

 1.6. Where information contains multiple data types or records with different classification levels, the highest applicable classification shall apply unless approved compensating controls are documented.

 1.7. Information received from external parties shall be classified and handled in accordance with contractual, legal, regulatory, or source-owner requirements. Where no classification is provided, the recipient shall assign an appropriate organisational classification.

 1.8. Classification shall be reviewed when information changes in sensitivity, purpose, legal status, business value, audience, or lifecycle stage.

2. **Approved Information Classification Scheme**

 2.1. The organisation shall use the following classification scheme.

 | Classification | Definition | Examples | Potential Impact if Compromised |
 |---|---|---|---|
 | Public | Information approved for public release and whose disclosure is not expected to cause harm to the organisation, customers, employees, partners, or stakeholders. | Published website content, approved press releases, public marketing materials, published job adverts, public policies. | Minimal impact; reputational impact possible if inaccurate, outdated, or unauthorised. |
 | Internal | Information intended for use within the organisation and authorised third parties where disclosure outside authorised channels may cause limited business impact. | Internal procedures, internal announcements, standard operating documentation, internal meeting notes, non-sensitive project information. | Limited operational, reputational, or commercial impact. |
 | Confidential | Sensitive information requiring protection against unauthorised access or disclosure due to business, legal, regulatory, contractual, privacy, or security requirements. | Customer records, employee records, contracts, financial data, security designs, supplier pricing, non-public business plans, audit reports, vulnerability information. | Moderate to significant legal, regulatory, financial, operational, privacy, contractual, or reputational impact. |
 | Restricted | Highly sensitive information requiring the strongest controls due to severe impact if compromised, including regulated, critical, privileged, or high-risk information. | Authentication secrets, encryption keys, privileged access credentials, merger and acquisition data, board-sensitive information, special category personal data, incident response details, critical infrastructure designs, highly sensitive customer data. | Severe legal, regulatory, financial, operational, safety, privacy, contractual, or reputational impact. |

 2.2. The default classification for newly created internal business information shall be **Internal** unless a higher or lower classification is determined by the information owner.

 2.3. Personal data shall be classified at least as **Confidential**, unless it has been formally anonymised or explicitly approved for public release.

 2.4. Special category personal data, privileged credentials, cryptographic keys, and information that could materially compromise security controls shall be classified as **Restricted**.

 2.5. Information classified by a customer, regulator, government body, or contractual counterparty shall not be downgraded without written authorisation from the originating party or an approved internal legal and risk assessment.

3. **Information Labelling Requirements**

 3.1. Information shall be labelled according to its classification where labelling is practical and supports correct handling.

 3.2. Labels shall be clear, visible, consistent, and applied in a manner appropriate to the format and medium of the information.

 3.3. Electronic documents containing Internal, Confidential, or Restricted information shall include the classification label in the document header, footer, cover page, metadata, file name, document management system, or other approved location.

 3.4. Emails containing Confidential or Restricted information shall include the classification label in the subject line, header, footer, or automated data protection label where supported by the email platform.

 3.5. Physical records containing Confidential or Restricted information shall be marked on the cover page, folder, envelope, or storage container.

 3.6. System records, databases, dashboards, exports, reports, tickets, logs, and datasets shall be labelled through system metadata, data catalogues, access control groups, repository tags, or other approved technical means where direct document labelling is not practical.

 3.7. Removable media containing organisational information shall be labelled with the highest classification of information stored on the media, unless labelling would increase security risk. Where external labelling is not appropriate, the classification shall be documented in the inventory or media register.

 3.8. Verbal discussions, presentations, meetings, and screen sharing involving Confidential or Restricted information shall begin with a statement of classification and audience restrictions where practical.

 3.9. Public information shall only be labelled as Public after approval for external release by the authorised information owner or communications authority.

 3.10. Labelling shall not replace access control, encryption, monitoring, contractual safeguards, or other required security controls.

4. **Minimum Handling Requirements by Classification**

 4.1. Information shall be handled in accordance with the minimum requirements below.

 | Handling Area | Public | Internal | Confidential | Restricted |
 |---|---|---|---|---|
 | Access | Open to the public once approved for release. | Available to employees and authorised third parties with a business need. | Limited to authorised individuals with a defined business need. | Strictly limited to named authorised individuals or tightly controlled roles. |
 | Authentication | Not required for public access. | Organisational authentication required unless otherwise approved. | Strong authentication required; multi-factor authentication shall be used where supported. | Multi-factor authentication shall be required; privileged access controls shall apply where relevant. |
 | Storage | Approved public platforms or repositories. | Approved organisational systems. | Approved systems with access controls and logging. | Approved restricted repositories with strong access controls, logging, and encryption. |
 | Transmission | Public channels permitted after approval. | Approved organisational channels. | Encrypted transmission or approved secure channels required outside trusted internal networks. | End-to-end encrypted or formally approved secure transmission required. |
 | External Sharing | Permitted after authorised publication. | Permitted only with authorised business purpose. | Requires information owner approval and appropriate contractual or legal safeguards. | Requires explicit information owner approval, risk assessment, and approved secure method. |
 | Printing | Permitted where appropriate. | Permitted for business use. | Minimise printing; secure printer release required where available. | Avoid printing unless explicitly required; secure handling and storage mandatory. |
 | Physical Storage | No special requirement. | Office storage appropriate to business use. | Locked storage when unattended. | Locked cabinet, safe, secure room, or access-controlled location. |
 | Disposal | Normal disposal permitted unless integrity concerns exist. | Approved disposal or recycling. | Secure deletion or confidential shredding required. | Certified secure destruction, cryptographic erasure, or approved sanitisation required. |
 | Monitoring | Standard operational monitoring. | Standard security monitoring. | Access and transfer monitoring where supported. | Enhanced logging, monitoring, and periodic access review required. |

 4.2. The controls in the table above are minimum requirements. Information owners may require stronger controls based on risk, contractual terms, regulatory obligations, or business criticality.

 4.3. Information shall not be copied, moved, exported, downloaded, synchronised, printed, or transmitted to unauthorised systems, personal accounts, unmanaged devices, or unapproved cloud services.

 4.4. Confidential and Restricted information shall not be stored on removable media unless there is a documented business requirement, approval from the information owner, and appropriate protection such as encryption.

 4.5. Restricted information shall not be stored, processed, or transmitted using systems that have not been approved for such use by Information Security.

 4.6. Screens displaying Confidential or Restricted information shall be protected from unauthorised viewing, including through screen locking, privacy controls, and appropriate physical positioning.

 4.7. Users shall clear desks, meeting rooms, printers, and shared workspaces of Confidential and Restricted information when unattended.

5. **Access Control and Need-to-Know Requirements**

 5.1. Access to information shall be granted based on the principles of least privilege and need-to-know.

 5.2. Access permissions shall be aligned to the classification of the information and the user’s role, responsibilities, employment status, contractual obligations, and approved business need.

 5.3. Access to Confidential and Restricted information shall be authorised by the information owner or delegated approver before access is granted.

 5.4. Access to Restricted information shall be periodically reviewed at a frequency appropriate to risk and at least quarterly unless a shorter interval is required by law, regulation, contract, or internal standard.

 5.5. Access to Confidential information shall be periodically reviewed at least annually unless higher risk requires more frequent review.

 5.6. Access shall be revoked or modified promptly when no longer required, including upon role change, termination, contract expiry, or project completion.

6. **External Sharing and Third-Party Handling**

 6.1. Information shall only be shared externally where there is a legitimate business purpose, appropriate authorisation, and suitable legal, contractual, and security safeguards.

 6.2. External parties receiving Internal, Confidential, or Restricted information shall be subject to appropriate obligations, which may include non-disclosure agreements, data processing agreements, contractual confidentiality clauses, security requirements, audit rights, and incident notification obligations.

 6.3. Confidential and Restricted information shared externally shall be transmitted using approved secure methods appropriate to the classification level.

 6.4. Restricted information shall not be shared externally without explicit approval from the information owner and, where applicable, Legal, Privacy, Information Security, or Risk Management.

 6.5. External recipients shall be informed of the classification and required handling expectations before or at the time information is shared.

 6.6. The organisation shall maintain records of external sharing of Restricted information where practical and proportionate to the risk.

7. **Creation, Collection, and Aggregation**

 7.1. Information shall be classified at the time of creation, collection, receipt, or entry into an organisational system.

 7.2. Information collection shall be limited to what is necessary for legitimate business, legal, regulatory, or contractual purposes.

 7.3. Aggregated information shall be classified based on the sensitivity of the combined dataset, which may be higher than the classification of individual data elements.

 7.4. Reports, dashboards, extracts, and exports generated from systems shall inherit the classification of the most sensitive source data unless an approved assessment supports a different classification.

 7.5. Test, development, analytics, and training datasets containing Confidential or Restricted information shall be protected to the same classification level unless the information has been anonymised, masked, tokenised, or otherwise protected through approved methods.

8. **Storage and Approved Systems**

 8.1. Organisational information shall be stored only in approved repositories, systems, applications, devices, or physical locations that provide controls appropriate to the classification level.

 8.2. Confidential and Restricted information shall not be stored in personal email accounts, personal cloud storage, consumer messaging applications, unmanaged devices, or unapproved collaboration tools.

 8.3. Systems storing Confidential or Restricted information shall implement access controls, logging, backup, retention, and recovery measures appropriate to the information classification and risk.

 8.4. Restricted information shall be encrypted at rest where technically feasible and required by risk, regulation, contract, or security standard.

 8.5. Backups shall protect information at a level appropriate to the highest classification of information contained within the backup set.

9. **Transmission and Communication**

 9.1. Information shall be transmitted using methods approved for its classification level.

 9.2. Confidential information transmitted outside trusted organisational environments shall be encrypted or sent through an approved secure channel.

 9.3. Restricted information shall be transmitted only through approved secure channels that provide strong authentication, encryption, recipient validation, and logging where available.

 9.4. Users shall verify recipients before sending Confidential or Restricted information by email, file transfer, messaging platform, or other communication method.

 9.5. Auto-forwarding of organisational email or data to personal accounts or unauthorised external systems shall be prohibited.

 9.6. Confidential or Restricted information shall not be discussed in public places or where unauthorised persons may overhear.

10. **Retention, Archival, and Disposal**

 10.1. Information shall be retained and disposed of in accordance with the organisation’s retention schedule, legal and regulatory requirements, contractual obligations, litigation holds, and business needs.

 10.2. Classification labels and handling requirements shall remain applicable throughout the retention period, including during archival.

 10.3. Confidential and Restricted paper records shall be disposed of using approved confidential waste or shredding services.

 10.4. Electronic Confidential and Restricted information shall be disposed of using approved secure deletion, cryptographic erasure, media sanitisation, or destruction methods appropriate to the media type and classification.

 10.5. Disposal of Restricted information shall be evidenced where required by law, regulation, contract, or internal risk assessment.

 10.6. Information subject to legal hold, investigation, audit, or regulatory request shall not be destroyed until formally released by Legal or another authorised function.

11. **Reclassification and Declassification**

 11.1. Information owners shall review and update classifications where information sensitivity, legal status, business value, or risk changes.

 11.2. Information shall only be downgraded or declassified with approval from the information owner or authorised delegate.

 11.3. Public release of organisational information shall require approval by the information owner and applicable communications, legal, regulatory, or business authority.

 11.4. Declassification decisions shall consider residual sensitivity, aggregation risk, privacy requirements, intellectual property, contractual obligations, regulatory restrictions, and timing.

 11.5. Reclassification or declassification of Confidential or Restricted information shall be recorded where required by risk, legal, regulatory, contractual, or audit requirements.

12. **Training and Awareness**

 12.1. Personnel shall receive information classification and handling awareness appropriate to their role and access to information.

 12.2. Personnel with access to Confidential or Restricted information shall receive guidance on classification, labelling, secure sharing, storage, transmission, retention, and disposal requirements.

 12.3. Information Security shall make guidance available to support users in applying classification labels and handling requirements consistently.

 12.4. Failure to complete required training may result in suspension of access to Confidential or Restricted information.

13. **Technology and Automation**

 13.1. The organisation shall implement technical capabilities to support classification, labelling, access control, encryption, monitoring, and data loss prevention where appropriate and proportionate to risk.

 13.2. Automated labelling, metadata tagging, sensitivity labels, rights management, and data loss prevention controls shall be used where approved and technically feasible for Confidential and Restricted information.

 13.3. Users shall not remove, bypass, alter, or disable classification labels, data protection controls, encryption, or rights management settings unless authorised.

 13.4. Systems that automatically classify or label information shall be configured in accordance with this policy and reviewed periodically for accuracy and effectiveness.

14. **Minimum Labelling Format**

 14.1. The following standard classification labels shall be used.

 | Classification | Standard Label | Example Document Marking | Example Email Subject Marking |
 |---|---|---|---|
 | Public | `PUBLIC` | `Classification: PUBLIC` | `[PUBLIC] Product Launch Announcement` |
 | Internal | `INTERNAL` | `Classification: INTERNAL` | `[INTERNAL] Team Update` |
 | Confidential | `CONFIDENTIAL` | `Classification: CONFIDENTIAL` | `[CONFIDENTIAL] Customer Contract Review` |
 | Restricted | `RESTRICTED` | `Classification: RESTRICTED` | `[RESTRICTED] Security Incident Evidence` |

 14.2. Where automated classification labels are available, users shall apply the equivalent approved system label.

 14.3. Where templates, systems, or tools provide mandatory classification fields, users shall complete them accurately.

 14.4. Labels shall reflect the highest classification of the information contained in the item.

15. **Classification Decision Criteria**

 15.1. Information owners shall use the following criteria when assigning classification.

 | Criterion | Public | Internal | Confidential | Restricted |
 |---|---|---|---|---|
 | Authorised audience | General public | Workforce and approved third parties | Specific authorised roles or parties | Named individuals or tightly restricted groups |
 | Legal or regulatory obligations | None or already approved for release | Limited internal obligations | Legal, privacy, regulatory, contractual, or confidentiality obligations apply | Significant legal, privacy, regulatory, contractual, or security obligations apply |
 | Commercial sensitivity | None | Low | Moderate to high | Very high or strategic |
 | Privacy sensitivity | No personal data or approved for public release | Limited low-risk personal data where approved | Personal data or sensitive employee/customer information | Special category, high-risk, or large-scale sensitive personal data |
 | Security sensitivity | No security sensitivity | General internal security information | Security designs, audit findings, vulnerability information | Secrets, keys, credentials, exploit details, critical security architecture |
 | Impact of unauthorised disclosure | Minimal | Limited | Moderate to significant | Severe |

 15.2. Where classification is uncertain, users shall apply the higher classification and seek guidance from the information owner or Information Security.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board / Executive Management | Approves the organisation’s overall risk appetite for information protection; supports enforcement of classification and handling requirements; ensures adequate resources are available for implementation. |
| Information Security Manager | Owns and maintains this policy; defines classification and handling standards; supports implementation of ISO/IEC 27001:2022 A.5.12 and A.5.13; monitors compliance; provides guidance and awareness. |
| Information Owners | Classify information under their ownership; approve access, sharing, reclassification, and declassification; define handling requirements where stronger controls are needed; ensure periodic review of classification and access. |
| Data Protection Officer / Privacy Lead | Advises on classification and handling of personal data; ensures alignment with applicable privacy laws and regulatory obligations; supports privacy impact assessments and breach response. |
| Legal / Compliance | Advises on contractual, regulatory, litigation hold, disclosure, and retention requirements; supports approval of external sharing and public release where required. |
| IT / System Owners | Implement technical controls to support classification, labelling, access control, encryption, retention, monitoring, backup, and disposal requirements; ensure systems are approved for the classification of information processed. |
| Records Management | Maintains retention schedules; supports secure archival and disposal requirements; ensures classification requirements are reflected in records handling practices. |
| Line Managers | Ensure personnel understand and follow classification and handling requirements; request, review, and remove access based on business need; support disciplinary action where appropriate. |
| Employees, Contractors, and Users | Classify, label, handle, store, transmit, share, and dispose of information in accordance with this policy; protect information from unauthorised access or disclosure; report suspected misclassification or information security incidents. |
| Third Parties / Suppliers | Handle organisational information in accordance with contractual obligations, classification labels, and agreed security requirements; report incidents or unauthorised disclosures promptly. |
| Internal Audit / Assurance | Performs independent reviews of compliance with this policy and the effectiveness of classification and labelling controls. |

## Compliance, Monitoring & Enforcement

The organisation shall monitor compliance with this policy through a combination of management oversight, technical controls, assurance activities, user awareness, access reviews, and audit procedures.

Compliance activities may include:

| Activity | Frequency | Responsible Role | Evidence |
|---|---:|---|---|
| Review of classification and labelling practices | At least annually | Information Security Manager | Review records, sample results, remediation actions |
| Access review for Restricted information | At least quarterly | Information Owners / System Owners | Access review attestations |
| Access review for Confidential information | At least annually | Information Owners / System Owners | Access review attestations |
| Data loss prevention and security monitoring review | Ongoing | Information Security / Security Operations | Alerts, investigations, tuning records |
| Supplier handling compliance review | Based on supplier risk tier | Procurement / Third-Party Risk / Information Security | Supplier assessments, contracts, audit reports |
| Secure disposal evidence review | As required by classification and retention requirements | Records Management / IT | Destruction certificates, sanitisation records |
| Policy training completion monitoring | At onboarding and periodically thereafter | HR / Information Security | Training completion records |
| Internal audit or assurance review | Per audit plan | Internal Audit / Assurance | Audit reports, findings, management actions |

All users shall comply with this policy and associated standards, procedures, contractual obligations, and legal requirements. Suspected or actual unauthorised access, disclosure, loss, misclassification, mishandling, or improper disposal of information shall be reported promptly through the approved incident reporting channel, such as [Incident Reporting Channel].

Non-compliance with this policy may result in:

- Removal or restriction of access privileges.
- Mandatory retraining.
- Management escalation.
- Disciplinary action up to and including termination of employment or contract.
- Contractual remedies for suppliers or third parties.
- Civil, regulatory, or criminal consequences where applicable.

The organisation shall investigate suspected breaches of this policy in accordance with the information security incident management process and applicable HR, legal, privacy, and contractual requirements.

## Exceptions

Exceptions to this policy shall be permitted only where there is a documented business justification, risk assessment, and approval by authorised stakeholders.

1. Exception requests shall identify:
 - The specific policy requirement for which an exception is requested.
 - The information classification and data types affected.
 - The business justification.
 - The scope, users, systems, locations, or third parties affected.
 - The risk assessment and potential impact.
 - Compensating controls.
 - The requested duration.
 - The accountable owner.

2. Exceptions involving Confidential information shall require approval from the Information Security Manager and the relevant information owner.

3. Exceptions involving Restricted information shall require approval from the Information Security Manager, relevant information owner, and an appropriate senior risk owner. Legal, Privacy, Compliance, or Executive Management approval shall also be obtained where required by risk, law, regulation, or contract.

4. Exceptions shall be time-bound and shall not exceed [Maximum Exception Period] without reapproval.

5. Approved exceptions shall be recorded in the exceptions register and reviewed periodically until closure.

6. Expired exceptions shall be remediated, renewed through formal approval, or escalated to management.

| Exception Field | Required Information |
|---|---|
| Exception ID | [Exception ID] |
| Requestor | [Name / Role] |
| Policy Requirement | [Requirement Reference] |
| Classification Affected | Public / Internal / Confidential / Restricted |
| Business Justification | [Justification] |
| Risk Summary | [Risk Summary] |
| Compensating Controls | [Controls] |
| Approval Authority | [Approver] |
| Start Date | [Date] |
| Expiry Date | [Date] |
| Review Frequency | [Frequency] |
| Status | Requested / Approved / Rejected / Expired / Closed |

## Review & Maintenance

This policy shall be reviewed at least annually and whenever significant changes occur that may affect information classification or handling requirements, including changes to:

- Legal, regulatory, contractual, or privacy obligations.
- ISO/IEC 27001:2022 requirements or ISMS scope.
- Business processes, information assets, or data flows.
- Technology platforms, collaboration tools, cloud services, or storage locations.
- Threat landscape, security incidents, audit findings, or risk assessments.
- Organisational structure, roles, or responsibilities.

The Information Security Manager shall coordinate policy review and maintenance with relevant stakeholders, including Information Owners, IT, Legal, Privacy, Compliance, Records Management, HR, and Internal Audit as appropriate.

Material changes to this policy shall be approved through the organisation’s governance process before publication. The current approved version shall be made available to all relevant personnel and third parties where applicable.

| Version | Date | Summary of Changes | Author | Approver |
|---|---|---|---|---|
| 1.0 | [Date] | Initial version aligned to ISO/IEC 27001:2022 A.5.12 and A.5.13. | Information Security Manager | [Approver] |