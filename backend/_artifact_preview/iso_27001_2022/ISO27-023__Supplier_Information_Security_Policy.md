<!-- iso_27001_2022 / ISO27-023 | type=Policy | mode=markdown | model=gpt-5.5 | 32557 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [ISMS-POL-SUP-001] | 1.0 | [Information Security Manager] | [YYYY-MM-DD] | ISO/IEC 27001:2022 | A.5.19, A.5.20, A.5.21, A.5.22 | Internal |

## Purpose

The purpose of this Supplier Information Security Policy is to establish mandatory requirements for identifying, assessing, managing, monitoring, and terminating supplier relationships where suppliers access, process, store, transmit, host, support, or otherwise handle the organisation’s information assets.

This policy supports the organisation’s implementation of ISO/IEC 27001:2022 by ensuring that information security risks arising from supplier relationships are identified and treated throughout the supplier lifecycle, including supplier selection, contracting, service delivery, monitoring, changes, and exit.

## Scope

This policy applies to:

- All suppliers, vendors, contractors, consultants, service providers, outsourced service providers, managed service providers, cloud service providers, software providers, hosting providers, professional services firms, and other third parties that access, process, store, transmit, host, support, or manage organisation information or information systems.
- All employees, contractors, and business units that procure, sponsor, manage, approve, or oversee supplier relationships.
- All information assets owned, managed, processed, or protected by the organisation, including information classified as Public, Internal, Confidential, or Restricted.
- All supplier-provided products and services that may affect the confidentiality, integrity, availability, privacy, or resilience of organisation information or information systems.
- All stages of the supplier lifecycle, including planning, due diligence, procurement, contracting, onboarding, service delivery, monitoring, change management, renewal, termination, and offboarding.

This policy includes requirements for:

- ISO/IEC 27001:2022 Annex A control A.5.19 — information security in supplier relationships.
- ISO/IEC 27001:2022 Annex A control A.5.20 — addressing information security within supplier agreements.
- ISO/IEC 27001:2022 Annex A control A.5.21 — managing information security in the ICT supply chain.
- ISO/IEC 27001:2022 Annex A control A.5.22 — monitoring, review, and change management of supplier services.

## Policy Statements

1. **Supplier Information Security Governance**

 1.1. The organisation shall manage supplier information security risks through a defined supplier lifecycle covering selection, due diligence, contracting, onboarding, ongoing monitoring, change management, termination, and offboarding.

 1.2. The organisation shall maintain documented criteria for determining whether a supplier is in scope for information security assessment based on the supplier’s access to information, systems, facilities, personnel, services, or business processes.

 1.3. The organisation shall ensure that supplier information security requirements are proportionate to the nature of the service, the sensitivity of information involved, regulatory obligations, business criticality, and the supplier’s level of access.

 1.4. Supplier relationships shall not commence until required information security due diligence, risk assessment, approvals, and contractual requirements have been completed, unless an approved exception has been granted in accordance with this policy.

 1.5. The organisation shall maintain an inventory of in-scope suppliers, including supplier owner, service description, information handled, system access, risk rating, contract status, assessment status, and review frequency.

2. **Supplier Classification and Risk Assessment**

 2.1. All in-scope suppliers shall be classified according to information security risk before contract award, onboarding, or access provisioning.

 2.2. Supplier risk classification shall consider, at minimum:

 - Type and classification of information accessed, processed, stored, or transmitted.
 - Volume of information handled.
 - Connectivity to organisation networks, applications, cloud environments, or data repositories.
 - Privileged, administrative, or remote access requirements.
 - Use of subcontractors or fourth parties.
 - Geographic location of service delivery and data processing.
 - Criticality of the service to business operations.
 - Impact of service failure, compromise, data loss, or unauthorised disclosure.
 - Regulatory, contractual, privacy, sector-specific, or customer obligations.
 - Supplier’s information security maturity and assurance evidence.

 2.3. Supplier risk ratings shall be assigned using the following minimum model:

 | Supplier Risk Rating | Criteria | Minimum Assessment Requirement | Review Frequency |
 |---|---|---|---|
 | Critical | Supplier supports essential business services, has privileged access, hosts or processes Restricted information, or compromise could cause severe operational, legal, regulatory, financial, or reputational impact. | Full security due diligence, contractual security review, executive or risk owner approval, and assurance evidence review. | At least annually |
 | High | Supplier processes Confidential information, has system integration, remote access, or significant operational dependency. | Security questionnaire, evidence review, contractual security review, and risk owner approval. | At least annually |
 | Medium | Supplier processes Internal information or provides a service with limited system access or moderate business impact. | Risk-based questionnaire and contractual security clauses. | At least every two years |
 | Low | Supplier has no access to Confidential or Restricted information, no system connectivity, and limited operational impact. | Basic screening and standard contractual security terms where applicable. | At renewal or material change |

 2.4. Supplier risk assessments shall be documented and retained as ISMS records.

 2.5. Where supplier risk exceeds the organisation’s risk appetite, the supplier shall not be approved unless risk treatment actions are defined, approved, assigned, and tracked to completion.

3. **Supplier Due Diligence**

 3.1. The organisation shall perform appropriate information security due diligence before engaging or materially changing the scope of an in-scope supplier relationship.

 3.2. Due diligence for Critical and High risk suppliers shall include review of relevant assurance evidence, which may include:

 - ISO/IEC 27001 certification.
 - SOC 2 Type II report.
 - Independent penetration test summary or vulnerability assessment summary.
 - Security policy summaries.
 - Data protection and privacy documentation.
 - Business continuity and disaster recovery evidence.
 - Incident management process evidence.
 - Secure development practices, where applicable.
 - Cloud security architecture or shared responsibility documentation, where applicable.
 - Subprocessor or subcontractor list, where applicable.

 3.3. Supplier due diligence shall evaluate whether the supplier maintains controls appropriate to the organisation’s requirements, including access control, encryption, logging and monitoring, vulnerability management, malware protection, backup and recovery, incident response, personnel security, physical security, secure development, data segregation, and change management.

 3.4. Suppliers shall be required to provide accurate, current, and complete information during due diligence. Misrepresentation of information security posture shall be grounds for rejection, suspension, termination, or other contractual remedies.

 3.5. Where deficiencies are identified during due diligence, the organisation shall document the risk, required remediation, accountable owner, due date, and approval decision.

4. **Information Security Requirements in Supplier Agreements**

 4.1. Supplier agreements shall include information security requirements appropriate to the supplier risk rating, service type, information classification, and legal or regulatory obligations.

 4.2. The organisation shall ensure that supplier agreements define, where applicable:

 - Permitted use of organisation information.
 - Information classification and handling requirements.
 - Confidentiality and non-disclosure obligations.
 - Access control requirements, including least privilege and unique user identification.
 - Authentication requirements, including multi-factor authentication where appropriate.
 - Requirements for protection of credentials and privileged access.
 - Data encryption requirements for information in transit and at rest.
 - Secure transfer mechanisms for organisation information.
 - Logging, monitoring, and audit trail requirements.
 - Vulnerability management, patching, and secure configuration requirements.
 - Malware protection requirements.
 - Secure development and application security requirements.
 - Data retention, return, deletion, and destruction requirements.
 - Backup, resilience, business continuity, and disaster recovery requirements.
 - Incident notification, investigation, cooperation, and evidence preservation requirements.
 - Regulatory, privacy, and data protection obligations.
 - Right to audit, review, or receive independent assurance evidence.
 - Restrictions and approval requirements for subcontractors and subprocessors.
 - Geographic restrictions for data processing, where applicable.
 - Change notification and approval requirements.
 - Service levels and availability commitments, where applicable.
 - Termination assistance and secure offboarding obligations.
 - Consequences of non-compliance, including remediation, suspension, indemnity, or termination rights.

 4.3. Supplier agreements involving personal data shall include applicable data processing terms and privacy requirements consistent with relevant data protection laws and organisational privacy obligations.

 4.4. Supplier agreements involving cloud, hosting, managed service, software-as-a-service, infrastructure-as-a-service, platform-as-a-service, software development, systems integration, or outsourced ICT services shall include ICT supply chain security requirements.

 4.5. Supplier agreements shall require suppliers to notify the organisation without undue delay and within contractual notification timelines of actual or suspected information security incidents affecting organisation information, systems, services, or obligations.

 4.6. The following minimum incident notification timelines shall apply unless stricter legal, regulatory, contractual, or customer requirements apply:

 | Incident Type | Supplier Notification Requirement |
 |---|---:|
 | Confirmed unauthorised access to organisation information | Within 24 hours of confirmation |
 | Suspected compromise involving organisation information or systems | Within 24 hours of identification |
 | Loss, theft, or unauthorised disclosure of organisation information | Within 24 hours of discovery |
 | Material service outage affecting critical business service | Within 4 hours of identification |
 | Malware, ransomware, or destructive attack affecting organisation service | Within 12 hours of identification |
 | Regulatory, law enforcement, or third-party request involving organisation information | Before disclosure, unless legally prohibited |

 4.7. Supplier agreements shall prohibit suppliers from using organisation information for purposes other than the authorised delivery of contracted services.

 4.8. Supplier agreements shall require organisation information to be returned, securely deleted, destroyed, or transferred at contract expiry, termination, or upon request, subject to legal retention obligations.

 4.9. Supplier agreements shall require suppliers to provide evidence of secure deletion or destruction when requested by the organisation.

 4.10. Supplier agreements shall be reviewed by appropriate stakeholders, including Legal, Procurement, Information Security, Privacy, and the business owner, based on the nature and risk of the supplier relationship.

5. **ICT Supply Chain Security**

 5.1. The organisation shall identify and manage information security risks associated with the ICT supply chain, including risks arising from cloud providers, managed service providers, software suppliers, technology vendors, telecommunications providers, hosting providers, system integrators, support providers, and subcontracted technology services.

 5.2. ICT suppliers shall be subject to enhanced due diligence where they provide or manage:

 - Administrative or privileged access to organisation systems.
 - Software, firmware, or code deployed into organisation environments.
 - Network connectivity or remote access.
 - Identity, authentication, logging, security monitoring, or backup services.
 - Critical infrastructure, hosting, cloud, or platform services.
 - Security services, including managed detection and response, security operations, vulnerability management, or incident response.
 - Services supporting regulated, customer-facing, or mission-critical business processes.

 5.3. ICT supplier risk assessments shall consider supply chain threats including compromise of supplier environments, malicious code insertion, unauthorised software modification, dependency vulnerabilities, counterfeit or unsupported components, insecure remote access, inadequate tenant segregation, and concentration risk.

 5.4. The organisation shall require ICT suppliers to implement secure development, secure configuration, vulnerability management, change control, malware protection, identity and access management, logging, incident response, and continuity controls appropriate to the services provided.

 5.5. Suppliers providing software, code, APIs, integrations, or managed technology components shall provide, upon request and where risk-appropriate, evidence of secure development practices, vulnerability remediation processes, penetration testing, software composition analysis, code signing, secure build pipelines, or software bill of materials.

 5.6. The organisation shall require ICT suppliers to notify the organisation of material vulnerabilities, security patches, end-of-life conditions, unsupported components, significant architectural changes, or security-relevant changes affecting supplied products or services.

 5.7. The organisation shall assess risks associated with supplier concentration and dependency, including single points of failure and lack of viable alternatives, for Critical ICT suppliers.

 5.8. ICT suppliers shall not be granted persistent privileged or remote access unless such access is justified, approved, controlled, monitored, and subject to periodic review.

6. **Subcontractors and Fourth-Party Suppliers**

 6.1. Suppliers shall not subcontract services that involve organisation information, systems, or critical service delivery without prior contractual authorisation or written approval where required.

 6.2. Supplier agreements shall require suppliers to impose information security obligations on approved subcontractors that are no less protective than those required by the organisation.

 6.3. Suppliers shall remain accountable for the acts, omissions, and information security performance of their subcontractors.

 6.4. Critical and High risk suppliers shall maintain and provide an up-to-date list of subcontractors or subprocessors that access or process organisation information, where applicable.

 6.5. The organisation shall assess material subcontractor changes where they may alter information security risk, regulatory obligations, data location, service resilience, or control effectiveness.

7. **Supplier Access Management**

 7.1. Supplier access to organisation information systems, facilities, networks, applications, repositories, cloud services, or data shall be authorised before access is granted.

 7.2. Supplier access shall be limited to the minimum necessary access required to perform contracted services.

 7.3. Supplier access shall use unique user accounts unless formally approved technical or operational constraints require an alternative compensating control.

 7.4. Shared supplier accounts shall not be used unless formally approved by Information Security and compensating controls, such as credential vaulting, session recording, and access logging, are implemented.

 7.5. Supplier privileged access shall be approved by the system owner and Information Security, time-bound where feasible, logged, monitored, and reviewed periodically.

 7.6. Remote access by suppliers shall use organisation-approved secure remote access methods and shall not bypass organisation security monitoring, authentication, or access control mechanisms.

 7.7. Supplier access shall be reviewed at a frequency proportionate to risk and removed promptly when no longer required, upon role change, contract termination, or supplier offboarding.

8. **Supplier Onboarding**

 8.1. Supplier onboarding shall not be completed until required security assessment, contractual controls, approvals, and access prerequisites are satisfied.

 8.2. Business owners shall ensure suppliers receive applicable information security requirements before access to organisation information or systems is granted.

 8.3. Suppliers shall acknowledge applicable security requirements, acceptable use obligations, confidentiality obligations, and incident reporting channels before accessing organisation information or systems.

 8.4. Supplier onboarding records shall be retained and shall include assessment outcome, risk rating, approvals, contractual security requirements, access authorisations, and any open risk treatment actions.

9. **Monitoring and Review of Supplier Services**

 9.1. The organisation shall monitor supplier compliance with information security requirements throughout the supplier relationship.

 9.2. Monitoring activities shall be risk-based and may include:

 - Review of updated assurance reports and certifications.
 - Review of service performance and availability.
 - Review of security incidents and near misses.
 - Review of vulnerability, patching, or remediation performance.
 - Access reviews.
 - Audit or assessment of supplier controls.
 - Review of subcontractor changes.
 - Review of regulatory or legal compliance status.
 - Review of security-related service level agreements.
 - Review of material changes to services, systems, locations, or control environments.

 9.3. Critical and High risk suppliers shall be reviewed at least annually against applicable information security requirements.

 9.4. The organisation shall require suppliers to remediate identified information security deficiencies within agreed timelines based on risk severity.

 9.5. Supplier monitoring results, identified issues, remediation plans, and risk acceptance decisions shall be documented and retained as ISMS records.

 9.6. Where supplier performance or control effectiveness falls below agreed requirements, the organisation shall take appropriate action, including escalation, remediation plans, enhanced monitoring, suspension of access, contractual remedies, or termination.

10. **Supplier Service Changes**

 10.1. The organisation shall assess information security risks arising from material changes to supplier services before approval or implementation where feasible.

 10.2. Suppliers shall be required to notify the organisation of material changes that may affect the confidentiality, integrity, availability, privacy, resilience, or compliance of organisation information or services.

 10.3. Material supplier changes shall include, but are not limited to:

 - Changes to hosting location or data processing location.
 - Changes to subcontractors or subprocessors.
 - Changes to system architecture or security controls.
 - Changes to authentication, access management, encryption, logging, or monitoring.
 - Changes to service scope or supported business process.
 - Changes to disaster recovery, backup, or business continuity capabilities.
 - Significant personnel or operational changes affecting service delivery.
 - Merger, acquisition, insolvency, or ownership change affecting the supplier.
 - End-of-life, end-of-support, or major version changes to supplied technology.
 - Changes that affect regulatory, contractual, customer, or privacy obligations.

 10.4. Material changes shall be reviewed by the business owner and Information Security and, where applicable, Legal, Privacy, Procurement, IT, and risk owners.

 10.5. The organisation shall update supplier risk assessments, contractual requirements, access permissions, monitoring plans, and risk treatment plans following material supplier changes where required.

11. **Supplier Incident Management**

 11.1. Suppliers shall report actual or suspected information security incidents affecting organisation information, systems, services, users, or contractual obligations in accordance with the applicable agreement and the organisation’s incident reporting requirements.

 11.2. Supplier incident notifications shall include, where known:

 - Date and time of incident identification.
 - Description of the incident.
 - Information, systems, services, or locations affected.
 - Known or suspected cause.
 - Known or suspected impact.
 - Data subjects, customers, or stakeholders affected, where applicable.
 - Containment and remediation actions taken.
 - Support required from the organisation.
 - Contact details for the supplier incident coordinator.

 11.3. Suppliers shall cooperate with organisation-led or jointly managed incident investigation, containment, remediation, regulatory notification, customer notification, litigation hold, evidence preservation, and post-incident review activities.

 11.4. Suppliers shall not make external notifications or public statements referencing the organisation or organisation information without prior approval unless legally required.

 11.5. Supplier incidents shall be reviewed to determine whether supplier risk rating, contractual requirements, monitoring frequency, access privileges, or continuation of service must be changed.

12. **Supplier Offboarding and Termination**

 12.1. Supplier offboarding shall be planned and controlled to protect organisation information and maintain business continuity.

 12.2. Upon termination, expiry, service transition, or when supplier access is no longer required, the organisation shall ensure that:

 - Supplier system, application, network, physical, and remote access is revoked.
 - Organisation information is returned, transferred, securely deleted, or destroyed as required.
 - Supplier-held organisation assets are returned or securely disposed of.
 - Confidentiality obligations continue after termination.
 - Transition assistance is provided where contractually required.
 - Open incidents, vulnerabilities, or remediation actions are addressed or formally transferred.
 - Evidence of deletion, destruction, transfer, or return is obtained where required.
 - Records required for legal, regulatory, audit, or contractual purposes are retained.

 12.3. Supplier offboarding shall include verification that access has been removed from relevant systems and that no unauthorised copies of organisation information remain under supplier control, except where retention is legally required.

 12.4. Suppliers shall not retain organisation information after termination unless explicitly authorised by contract, legal requirement, or written approval from the organisation.

13. **Records and Evidence**

 13.1. The organisation shall retain supplier information security records sufficient to demonstrate compliance with this policy and ISO/IEC 27001:2022 requirements.

 13.2. Supplier information security records shall include, as applicable:

 | Record Type | Minimum Content | Retention Requirement |
 |---|---|---|
 | Supplier inventory entry | Supplier name, owner, service, risk rating, information handled, review date | Duration of relationship plus [retention period] |
 | Supplier risk assessment | Risk criteria, assessment outcome, approval, treatment actions | Duration of relationship plus [retention period] |
 | Due diligence evidence | Questionnaires, certifications, assurance reports, assessment notes | Duration of relationship plus [retention period] |
 | Contract security review | Required clauses, deviations, approvals | Duration of contract plus [retention period] |
 | Access authorisation | Access request, approval, scope, review evidence | Duration of access plus [retention period] |
 | Monitoring review | Review date, findings, remediation actions, approvals | Duration of relationship plus [retention period] |
 | Change review | Description of change, risk assessment, approval, actions | Duration of relationship plus [retention period] |
 | Incident record | Notification, investigation, impact, remediation, lessons learned | In accordance with incident record retention requirements |
 | Offboarding record | Access removal, data return/deletion, asset return, closure approval | Duration of relationship plus [retention period] |

 13.3. Supplier information security records shall be protected from unauthorised access, alteration, deletion, or disclosure.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board / Executive Management | Provide oversight of supplier risk management for material and critical supplier relationships; approve risk appetite and significant supplier risk acceptance where required. |
| Information Security Manager | Own this policy; define supplier security requirements; review supplier risk assessments; advise on security clauses; monitor compliance; escalate significant supplier security risks. |
| Procurement | Ensure supplier security requirements are integrated into sourcing, procurement, and supplier onboarding processes; coordinate supplier due diligence and contract workflow. |
| Legal | Review and approve contractual terms relating to confidentiality, liability, data protection, audit rights, incident notification, subcontracting, termination, and remedies. |
| Privacy / Data Protection Officer | Assess supplier privacy and data protection risks; ensure data processing agreements and privacy obligations are addressed where personal data is involved. |
| Business Owner / Supplier Owner | Identify supplier need; classify supplier service; ensure required assessments are completed; manage supplier performance; review access; monitor supplier obligations; initiate offboarding. |
| System Owner / Application Owner | Approve supplier access to systems; ensure access is technically controlled, logged, reviewed, and removed when no longer required. |
| Risk Owner | Accept, reject, or require treatment of supplier information security risks in accordance with the organisation’s risk management process. |
| IT Operations | Implement technical access controls, remote access controls, logging, monitoring, and access removal for supplier accounts and integrations. |
| Supplier | Comply with contractual and organisational information security requirements; protect organisation information; report incidents; cooperate with assessments, audits, remediation, and offboarding. |
| Internal Audit / Assurance Function | Independently review supplier information security governance, control design, operating effectiveness, and compliance with this policy as part of the audit programme. |

## Compliance, Monitoring & Enforcement

Compliance with this policy is mandatory for all personnel involved in supplier selection, procurement, contracting, management, monitoring, and termination.

The organisation shall monitor compliance with this policy through risk-based assurance activities, including:

- Supplier inventory reviews.
- Review of supplier risk assessments.
- Contract security clause sampling.
- Supplier assurance evidence reviews.
- Supplier access reviews.
- Review of supplier incident records.
- Review of supplier change records.
- Review of supplier offboarding evidence.
- Internal audits of supplier management processes.
- Management review of significant supplier risks and exceptions.

The following minimum monitoring activities shall be performed:

| Monitoring Activity | Frequency | Responsible Role | Evidence |
|---|---:|---|---|
| Review of Critical supplier risk status | At least annually | Supplier Owner / Information Security Manager | Updated supplier assessment and risk record |
| Review of High risk supplier risk status | At least annually | Supplier Owner / Information Security Manager | Updated supplier assessment and risk record |
| Review of Medium risk supplier risk status | At least every two years | Supplier Owner | Updated supplier assessment or attestation |
| Supplier access review for privileged access | At least quarterly | System Owner | Access review record |
| Supplier access review for non-privileged access | At least semi-annually | System Owner | Access review record |
| Review of supplier security incidents | As incidents occur and during periodic review | Information Security Manager | Incident record and post-incident review |
| Review of contract security deviations | At least annually | Legal / Information Security Manager | Deviation register |
| Supplier inventory validation | At least annually | Procurement / Information Security Manager | Supplier inventory report |

Non-compliance with this policy may result in:

- Suspension or removal of supplier access.
- Requirement for remediation plans and enhanced monitoring.
- Escalation to management, Legal, Procurement, or the risk owner.
- Delay or rejection of supplier onboarding or renewal.
- Contractual remedies, including service credits, indemnities, or termination.
- Disciplinary action for employees or contractors who fail to comply with this policy.
- Reporting to regulators, customers, or other authorities where required by law or contract.

Material supplier information security risks, incidents, unresolved deficiencies, or repeated non-compliance shall be escalated to the appropriate governance body, such as [Information Security Steering Committee] or [Risk Committee].

## Exceptions

Exceptions to this policy shall be permitted only where there is a documented business justification and the resulting information security risk has been assessed, approved, and time-bound.

All exception requests shall include:

- Supplier name and service description.
- Policy requirement for which exception is requested.
- Business justification.
- Information and systems affected.
- Risk assessment and potential impact.
- Compensating controls.
- Exception duration.
- Remediation plan and target completion date.
- Approval from the appropriate risk owner and Information Security Manager.

Exceptions shall not be used to bypass legal, regulatory, contractual, or customer obligations.

Exceptions involving Critical or High risk suppliers, Restricted information, privileged access, personal data at scale, or critical business services shall require approval by the relevant executive risk owner or governance body.

Approved exceptions shall be recorded in the exception register and reviewed at least quarterly until closed. Expired exceptions shall not remain valid unless renewed through the formal exception process.

## Review & Maintenance

This policy shall be reviewed at least annually and whenever significant changes occur that may affect supplier information security requirements, including:

- Changes to ISO/IEC 27001:2022 requirements or applicable legal, regulatory, contractual, or customer obligations.
- Significant supplier incidents or control failures.
- Material changes to the organisation’s risk appetite or supplier risk profile.
- Introduction of new supplier service models, cloud services, outsourced services, or ICT supply chain dependencies.
- Audit findings or management review decisions requiring policy updates.
- Material organisational, technology, or business process changes.

The Information Security Manager shall be responsible for coordinating policy review and maintenance. Updates shall be approved by [Approving Authority] before publication.

The current approved version of this policy shall be made available to relevant personnel and stakeholders. Superseded versions shall be retained in accordance with the organisation’s document retention requirements.