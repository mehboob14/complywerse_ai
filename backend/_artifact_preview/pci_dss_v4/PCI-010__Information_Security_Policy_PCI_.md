<!-- pci_dss_v4 / PCI-010 | type=Policy | mode=markdown | model=gpt-5.5 | 23667 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [PCI-POL-001] | 1.0 | [CISO / Information Security Officer] | [YYYY-MM-DD] | PCI DSS v4.0.1 | Requirement 12.1.1 | Internal |

## Purpose

This Information Security Policy establishes the organisation’s mandatory information security requirements for protecting account data and the Cardholder Data Environment (CDE) in accordance with PCI DSS v4.0.1 Requirement 12.1.1.

The purpose of this Policy is to ensure that information security responsibilities, governance expectations, and control requirements are formally defined, communicated, maintained, and reviewed at least annually. This Policy supports the protection of cardholder data, sensitive authentication data, systems that store, process, or transmit account data, and systems that could impact the security of the CDE.

This Policy provides executive-level direction for the organisation’s PCI DSS security program and serves as the authoritative foundation for related standards, procedures, baselines, and operational controls.

## Scope

This Policy applies to:

- All organisational personnel, including employees, contractors, temporary workers, interns, consultants, service providers, and third parties who access, manage, support, or influence the security of the CDE.
- All business units, departments, locations, and functions that store, process, transmit, secure, administer, or support account data.
- All systems, networks, applications, endpoints, cloud services, databases, security tools, physical facilities, and supporting infrastructure that are:
 - Within the CDE;
 - Connected to the CDE;
 - Providing security services to the CDE;
 - Capable of impacting the security of the CDE; or
 - Used to store, process, or transmit account data.
- All forms of account data, including:
 - Cardholder data, including primary account number (PAN), cardholder name, expiration date, and service code;
 - Sensitive authentication data, including full track data, card verification codes/values, PINs, PIN blocks, and equivalent authentication data, whether stored, processed, or transmitted electronically, physically, or verbally.

This Policy applies throughout the full lifecycle of applicable systems and data, including acquisition, design, development, configuration, operation, maintenance, monitoring, transfer, retention, disposal, and decommissioning.

Where legal, regulatory, contractual, or card brand requirements impose stricter obligations than this Policy, the stricter requirement shall apply.

## Policy Statements

1. The organisation shall establish, publish, maintain, and implement a comprehensive information security policy that governs the protection of account data and the CDE in alignment with PCI DSS v4.0.1.

2. The information security policy shall be approved by senior management and shall define mandatory information security expectations for personnel, systems, processes, and third parties within scope of PCI DSS.

3. The information security policy shall be reviewed at least once every 12 months and updated as needed to reflect changes to business objectives, legal and regulatory obligations, PCI DSS requirements, threat landscape, risk assessments, technologies, processes, and the CDE.

4. The organisation shall maintain documented evidence of annual policy review, approval, communication, and revision history sufficient to demonstrate compliance with PCI DSS Requirement 12.1.1.

5. The information security policy shall apply to all personnel with responsibilities for storing, processing, transmitting, securing, administering, or otherwise impacting account data or the CDE.

6. Personnel shall be required to comply with this Policy and all supporting PCI DSS standards, procedures, secure configuration requirements, acceptable use rules, and operational security controls.

7. The organisation shall ensure that security roles and responsibilities for PCI DSS are defined, assigned, communicated, and acknowledged by personnel and relevant third parties.

8. The organisation shall maintain an accurate understanding of its CDE, including in-scope system components, network connections, data flows, payment channels, service providers, and business processes that store, process, transmit, or can impact account data.

9. Account data shall be protected from unauthorised access, disclosure, alteration, destruction, or misuse using security controls appropriate to the sensitivity of the data and the risk to the organisation.

10. Storage of cardholder data shall be limited to data that is necessary for a legitimate business, legal, or regulatory purpose.

11. Sensitive authentication data shall not be stored after authorisation, even if encrypted, unless expressly permitted by PCI DSS for issuers or companies that support issuing services and subject to applicable controls.

12. The organisation shall implement and maintain security controls to protect account data during storage, processing, and transmission across open, public, private, wireless, cloud, and third-party networks.

13. The organisation shall maintain secure network architectures for the CDE, including appropriate segmentation, boundary controls, traffic restrictions, firewall and router configurations, and protections against unauthorised network access.

14. The organisation shall configure system components securely and shall maintain hardening standards consistent with industry-recognised practices and PCI DSS requirements.

15. Vendor-supplied defaults, insecure configurations, unnecessary services, sample accounts, default passwords, and other insecure settings shall be removed or changed before systems are connected to or used within the CDE.

16. The organisation shall identify, assess, prioritise, remediate, and track vulnerabilities affecting in-scope systems, applications, and services.

17. Security patches and updates shall be evaluated and applied in accordance with risk, criticality, and PCI DSS requirements.

18. Anti-malware or equivalent protections shall be implemented, maintained, monitored, and updated where malware threats are applicable to in-scope systems.

19. Access to account data, the CDE, and in-scope systems shall be restricted based on business need to know and least privilege.

20. User access shall be uniquely assigned, authenticated, authorised, reviewed, modified, and revoked in accordance with defined access control requirements.

21. Shared, generic, or group accounts shall not be used unless explicitly permitted by PCI DSS and subject to compensating controls, accountability mechanisms, and approval.

22. Multi-factor authentication shall be implemented where required by PCI DSS, including for access into the CDE and for administrative access, in accordance with applicable standards.

23. Physical access to account data and systems within the CDE shall be controlled, monitored, and restricted to authorised personnel only.

24. Media containing account data shall be physically and logically protected throughout its lifecycle, including creation, handling, storage, transport, retention, reuse, and destruction.

25. The organisation shall implement logging and monitoring controls to detect, investigate, and respond to suspicious or unauthorised activity affecting account data or the CDE.

26. Audit logs for in-scope systems shall be protected from unauthorised modification and retained in accordance with PCI DSS and organisational retention requirements.

27. Security events, alerts, and anomalies affecting the CDE shall be reviewed and escalated in accordance with defined monitoring and incident response processes.

28. Security testing shall be performed on in-scope systems and environments in accordance with PCI DSS requirements, including vulnerability scanning, penetration testing, segmentation testing, and other required assessments.

29. The organisation shall ensure secure development and change management practices are applied to applications, systems, infrastructure, and services that store, process, transmit, or can impact the security of account data.

30. Changes to the CDE shall be authorised, tested, documented, assessed for security impact, and implemented in a controlled manner.

31. The organisation shall maintain an incident response capability that addresses suspected or confirmed compromise of account data, CDE systems, payment channels, or supporting security controls.

32. Personnel shall report suspected security incidents, policy violations, unauthorised access, loss of media, or exposure of account data immediately through approved reporting channels.

33. The organisation shall perform security awareness training for personnel upon hire and at least annually thereafter, including PCI DSS responsibilities and protection of account data.

34. Personnel with specialised security, administrative, development, or operational responsibilities for the CDE shall receive role-appropriate training sufficient to perform those responsibilities securely.

35. Third-party service providers that store, process, transmit, secure, manage, or could impact account data shall be subject to due diligence, contractual security obligations, ongoing monitoring, and PCI DSS responsibility management.

36. The organisation shall maintain written agreements with applicable service providers that include acknowledgement of responsibility for the security of account data that the service provider stores, processes, transmits, or otherwise impacts.

37. The organisation shall maintain and review a matrix of PCI DSS responsibilities between the organisation and applicable service providers.

38. The organisation shall ensure that information security risks affecting account data and the CDE are identified, assessed, documented, treated, and escalated in accordance with the organisation’s risk management process.

39. Policies, standards, and procedures supporting PCI DSS shall be accessible to relevant personnel and communicated in a manner that supports consistent understanding and implementation.

40. The organisation shall prohibit intentional actions that bypass, disable, weaken, or circumvent security controls protecting account data or the CDE without documented authorisation and approved risk acceptance.

41. Security requirements shall be incorporated into procurement, onboarding, architecture, project management, system implementation, outsourcing, cloud adoption, and technology lifecycle processes where account data or the CDE may be impacted.

42. The organisation shall retain records necessary to demonstrate implementation and maintenance of this Policy and related PCI DSS controls.

43. The organisation shall maintain supporting standards, procedures, and operational documentation aligned to this Policy, including but not limited to the following:

| Supporting Document / Control Area | Minimum Requirement |
|---|---|
| PCI DSS Scope and CDE Inventory | Defines in-scope systems, data flows, locations, applications, payment channels, and service providers |
| Access Control Standard | Establishes authentication, authorisation, least privilege, account lifecycle, and review requirements |
| Secure Configuration Standard | Defines hardening baselines and configuration expectations for in-scope system components |
| Data Protection and Retention Standard | Defines account data storage, masking, encryption, retention, and disposal requirements |
| Vulnerability and Patch Management Procedure | Defines identification, prioritisation, remediation, verification, and escalation processes |
| Logging and Monitoring Standard | Defines log generation, review, retention, alerting, and protection requirements |
| Incident Response Plan | Defines roles, escalation, investigation, containment, notification, and recovery requirements |
| Third-Party Service Provider Management Procedure | Defines PCI DSS due diligence, responsibility assignment, monitoring, and contractual requirements |
| Security Awareness and Training Standard | Defines awareness, role-based training, acknowledgement, and frequency requirements |
| Change Management Procedure | Defines authorisation, testing, security impact analysis, approval, and rollback requirements |

44. The organisation shall ensure that this Policy is communicated to all relevant personnel and that personnel acknowledge their responsibility to comply where required by organisational process.

45. Non-compliance with this Policy shall be documented, assessed for risk, remediated in a timely manner, and escalated where appropriate.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board of Directors / Executive Leadership | Provide oversight and support for the PCI DSS security program; approve strategic security direction; ensure adequate resources are available to protect account data and the CDE. |
| Senior Management | Approve this Policy; ensure organisational functions comply with PCI DSS requirements; support enforcement of security requirements; accept residual risk where formally authorised. |
| [CISO / Information Security Officer] | Own and maintain this Policy; ensure alignment with PCI DSS v4.0.1; coordinate annual review; oversee implementation of the security program; report material risks and compliance status to management. |
| PCI Compliance Owner | Coordinate PCI DSS compliance activities; maintain PCI DSS control documentation; support assessments; track remediation; coordinate evidence collection for Requirement 12.1.1 and related requirements. |
| Information Security Team | Define security standards and procedures; monitor security controls; perform risk assessments; support vulnerability management, logging, incident response, awareness, and assurance activities. |
| System Owners | Ensure systems under their responsibility comply with this Policy and supporting PCI DSS requirements; maintain asset and data flow information; ensure remediation of identified control gaps. |
| Business Process Owners | Identify business processes involving account data; ensure handling of account data complies with this Policy; support scoping, training, data minimisation, and control implementation. |
| IT Operations | Implement and maintain secure configurations, patching, access controls, backups, monitoring, and operational processes for in-scope systems. |
| Application Owners and Development Teams | Ensure applications that store, process, transmit, or affect account data are developed, tested, changed, and maintained securely in accordance with PCI DSS requirements. |
| Network and Infrastructure Teams | Maintain secure network architecture, segmentation, firewall rules, remote access controls, and infrastructure security for the CDE and connected environments. |
| Human Resources | Support personnel onboarding, policy acknowledgement, role changes, disciplinary processes, and termination activities relevant to security responsibilities. |
| Legal / Procurement / Vendor Management | Ensure contracts with service providers include applicable PCI DSS obligations; support third-party due diligence, responsibility matrices, and compliance monitoring. |
| Third-Party Service Providers | Comply with applicable contractual, legal, regulatory, and PCI DSS responsibilities; protect account data; notify the organisation of security incidents; provide compliance evidence as required. |
| All Personnel | Comply with this Policy and supporting requirements; complete assigned training; protect account data; report suspected incidents, weaknesses, or policy violations promptly. |

## Compliance, Monitoring & Enforcement

Compliance with this Policy shall be monitored through governance, risk, compliance, technical assurance, operational oversight, and management review activities.

The organisation shall maintain evidence demonstrating that this Policy is implemented, maintained, communicated, and reviewed at least annually in accordance with PCI DSS v4.0.1 Requirement 12.1.1.

Minimum compliance and monitoring activities shall include:

| Activity | Minimum Frequency | Responsible Role | Evidence |
|---|---:|---|---|
| Formal review of this Policy | At least annually | [CISO / Information Security Officer] | Review record, version history, approval evidence |
| Senior management approval of this Policy | At initial issue and after material changes | Senior Management | Signed approval, meeting minutes, workflow approval |
| Policy communication to relevant personnel | Upon issue and following material updates | Information Security / HR | Communication records, intranet publication, email notice |
| Personnel acknowledgement where required | Upon hire and at least annually or following material changes | HR / Information Security | Acknowledgement records, LMS reports |
| PCI DSS scope review | At least annually and upon significant change | PCI Compliance Owner / System Owners | Scope document, CDE inventory, data flow diagrams |
| Review of supporting PCI DSS standards and procedures | At least annually or as required by control area | Control Owners | Updated documents, approval records |
| Assessment of compliance with PCI DSS requirements | At least annually and as required | PCI Compliance Owner | ROC, SAQ, gap assessment, remediation plan |
| Monitoring of remediation actions | Ongoing until closure | Control Owners / PCI Compliance Owner | Risk register, issue tracker, remediation evidence |
| Third-party PCI DSS compliance review | At least annually | Vendor Management / PCI Compliance Owner | AOC, responsibility matrix, contract review |
| Reporting of material PCI DSS risks and policy non-compliance | As identified and periodically | [CISO / Information Security Officer] | Risk reports, management meeting minutes |

The organisation shall enforce this Policy through appropriate administrative, technical, contractual, and disciplinary measures.

Violations of this Policy may result in one or more of the following actions, depending on severity, intent, impact, and applicable legal or contractual obligations:

- Mandatory retraining or awareness activity;
- Revocation or restriction of access privileges;
- Formal corrective action or disciplinary action, up to and including termination of employment;
- Contractual remedies, including suspension or termination of supplier access or services;
- Risk acceptance review and management escalation;
- Legal, regulatory, card brand, or law enforcement notification where required;
- Remediation actions to restore compliance and reduce risk.

Suspected or confirmed compromise of account data, unauthorised access to the CDE, or material failure of PCI DSS controls shall be handled in accordance with the organisation’s incident response process.

## Exceptions

Exceptions to this Policy shall be permitted only where there is a documented business justification, a documented risk assessment, approval by authorised management, and defined compensating or mitigating controls where applicable.

Exceptions shall not be used to avoid PCI DSS requirements unless the exception is formally assessed, documented, and managed in accordance with PCI DSS and organisational risk management requirements.

All exceptions shall:

- Be documented before implementation unless emergency conditions require immediate action;
- Identify the specific policy statement, standard, or control requirement affected;
- Include the business reason for the exception;
- Include the risk assessment and potential impact to account data and the CDE;
- Define compensating or mitigating controls;
- Specify an owner responsible for managing the exception;
- Specify an expiry date or review date;
- Be approved by appropriate authority based on risk;
- Be reviewed periodically until closed;
- Be retained as compliance evidence.

The following minimum exception information shall be recorded:

| Field | Requirement |
|---|---|
| Exception ID | Unique identifier for tracking and auditability |
| Requestor | Individual or business owner requesting the exception |
| Affected System / Process | In-scope asset, process, location, service provider, or control area |
| PCI DSS Requirement Impacted | Applicable PCI DSS requirement or related internal control |
| Policy Statement Impacted | Specific clause or requirement within this Policy or supporting document |
| Business Justification | Reason the exception is necessary |
| Risk Rating | Assessed likelihood and impact to account data and the CDE |
| Mitigating / Compensating Controls | Controls implemented to reduce risk |
| Exception Owner | Individual accountable for managing the exception |
| Approval Authority | Management or governance body approving the exception |
| Approval Date | Date of approval |
| Expiry / Review Date | Date by which the exception must be reviewed or closed |
| Closure Evidence | Evidence that exception has expired, been remediated, or been incorporated into approved design |

High-risk exceptions, exceptions affecting account data protection, or exceptions that may impact PCI DSS compliance shall be escalated to [CISO / Information Security Officer], PCI Compliance Owner, and appropriate senior management for approval.

Expired exceptions shall be treated as non-compliance unless formally renewed through the exception process.

## Review & Maintenance

This Policy shall be reviewed at least annually and whenever significant changes occur that may affect the security of account data, the CDE, PCI DSS scope, business processes, technologies, legal obligations, risk profile, or control environment.

Significant changes that may trigger an out-of-cycle review include, but are not limited to:

- Introduction of new payment channels, payment applications, or payment service providers;
- Material changes to the CDE, network segmentation, cloud architecture, or hosting model;
- Acquisition, merger, divestiture, or significant organisational restructuring;
- Material change in PCI DSS requirements, card brand rules, laws, or regulatory obligations;
- Security incident involving account data or CDE systems;
- Material audit finding, assessment result, or control failure;
- Significant outsourcing, insourcing, or change to service provider responsibilities;
- Deployment of new technologies that store, process, transmit, secure, or can impact account data.

The [CISO / Information Security Officer] shall be responsible for coordinating Policy review and maintenance. Reviews shall consider:

- Continued alignment with PCI DSS v4.0.1 and applicable future versions;
- Changes in organisational scope and CDE boundaries;
- Results of PCI DSS assessments, internal audits, external audits, vulnerability assessments, penetration tests, and risk assessments;
- Changes in threats, vulnerabilities, business processes, and technology architecture;
- Feedback from control owners, system owners, business owners, and relevant stakeholders;
- Effectiveness of supporting standards, procedures, and control evidence.

Policy review and approval shall be documented using a revision history and approval record.

| Version | Date | Summary of Change | Author / Owner | Approved By |
|---:|---|---|---|---|
| 1.0 | [YYYY-MM-DD] | Initial issue for PCI DSS v4.0.1 Requirement 12.1.1 | [CISO / Information Security Officer] | [Approver Name / Role] |

Superseded versions of this Policy shall be retained in accordance with the organisation’s document retention requirements and made available for audit and compliance purposes where required.