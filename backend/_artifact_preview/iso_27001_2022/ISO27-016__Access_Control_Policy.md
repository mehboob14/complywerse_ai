<!-- iso_27001_2022 / ISO27-016 | type=Policy | mode=markdown | model=gpt-5.5 | 22473 chars -->

| Field | Value |
|---|---|
| Document ID | [ISMS-POL-AC-001] |
| Version | 1.0 |
| Owner | [Information Security Manager] |
| Effective Date | [YYYY-MM-DD] |
| Framework | ISO/IEC 27001:2022 |
| Classification | Internal |

## Purpose

The purpose of this Access Control Policy is to establish mandatory requirements for controlling logical and physical access to information, information processing facilities, applications, systems, networks, premises, and other assets within the organisation’s Information Security Management System (ISMS).

This Policy supports ISO/IEC 27001:2022 Annex A.5.15 by ensuring that access to information and associated assets is granted, modified, monitored, and revoked in accordance with business requirements, information security requirements, the principle of least privilege, and applicable legal, regulatory, contractual, and organisational obligations.

## Scope

This Policy applies to:

- All employees, contractors, consultants, temporary workers, interns, third-party service providers, and any other users who access organisational information or assets.
- All logical access to information systems, applications, databases, cloud services, networks, end-user devices, administrative tools, and information repositories.
- All physical access to offices, secure areas, data centres, server rooms, communications rooms, records storage areas, and other restricted facilities.
- All access lifecycle activities, including request, approval, provisioning, authentication, authorisation, modification, review, suspension, and revocation.
- All information assets owned, managed, hosted, processed, transmitted, or stored by or on behalf of the organisation.

This Policy applies regardless of whether access is performed from organisational premises, remote locations, third-party locations, mobile devices, or cloud-hosted environments.

## Policy Statements

1. The organisation shall define, approve, implement, and maintain access control rules based on business requirements, information classification, risk assessment outcomes, legal and regulatory obligations, contractual requirements, and the need to protect confidentiality, integrity, and availability of information.

2. Access to information and associated assets shall be granted only where there is a legitimate business need and shall be limited to the minimum level of access required to perform authorised duties.

3. Access control requirements shall apply to both logical and physical access, including access to systems, applications, networks, databases, facilities, secure areas, paper records, removable media, and supporting infrastructure.

4. Access rights shall be assigned according to the principles of least privilege, need-to-know, need-to-use, and segregation of duties.

5. Access shall not be granted until an authorised access request has been submitted, reviewed, approved, and recorded in accordance with the organisation’s access management process.

6. Access approvals shall be provided by an appropriate accountable authority, such as the asset owner, system owner, data owner, line manager, or designated approver.

7. The organisation shall maintain documented access control rules for major systems, applications, information repositories, networks, and physical areas, including criteria for access eligibility, approval requirements, privileged access, and review frequency.

8. Access control rules shall be aligned with the organisation’s information classification scheme so that more restrictive controls are applied to information with higher sensitivity, criticality, or regulatory impact.

9. Default access rights shall be restrictive and shall not permit unnecessary access to systems, data, applications, services, physical locations, or administrative functions.

10. User access shall be uniquely assigned to individuals wherever practicable to support accountability, traceability, and auditability.

11. Shared or generic accounts shall be prohibited unless formally justified, risk assessed, approved by the relevant system owner and Information Security function, and subject to compensating controls such as restricted use, strong authentication, logging, and periodic review.

12. Privileged access rights shall be strictly controlled, assigned only to authorised personnel, and used only for approved administrative or operational purposes.

13. Privileged access shall be separated from standard user access wherever technically feasible, including the use of separate privileged accounts for administrative activities.

14. Access to administrative interfaces, security tools, directory services, cloud management consoles, network devices, and other high-risk functions shall require enhanced authentication and monitoring.

15. Multi-factor authentication shall be required for remote access, privileged access, cloud administration, access to critical systems, and any other access scenario identified as high risk by the organisation.

16. Authentication mechanisms shall be appropriate to the sensitivity of the information or asset being accessed and shall include controls such as password complexity, credential protection, session management, account lockout, and secure recovery processes.

17. Passwords, passphrases, cryptographic keys, tokens, biometric templates, and other authentication secrets shall be protected from unauthorised disclosure, compromise, reuse, and insecure storage.

18. Access rights shall be provisioned, changed, suspended, and removed in a timely manner following joiner, mover, leaver, role change, contract change, disciplinary, or other employment or engagement events.

19. Access rights for new users shall be based on approved role requirements and shall not be copied from other users unless the access has been reviewed and approved as appropriate for the receiving user’s role.

20. Access rights shall be modified promptly when users change roles, teams, responsibilities, locations, employment status, or contractual obligations.

21. Access rights shall be revoked or disabled promptly when no longer required, including upon termination of employment, end of contract, transfer of responsibility, completion of temporary assignment, or withdrawal of business need.

22. Access for leavers shall be disabled no later than the user’s final working day or immediately where there is heightened risk, involuntary termination, suspected misconduct, or a security concern.

23. Emergency access shall be granted only where necessary to protect business operations, safety, legal obligations, or security, and shall be time-bound, approved, logged, monitored, and reviewed after use.

24. Temporary access shall have a defined expiry date or review date and shall be removed automatically or manually when no longer required.

25. Third-party access shall be granted only under approved contractual, security, confidentiality, and access control arrangements and shall be limited to the services, systems, information, and time periods required.

26. Remote access shall be authorised, authenticated, encrypted, monitored, and limited to approved users, devices, networks, and services.

27. Access from unmanaged, personal, or third-party devices shall be prohibited unless explicitly authorised and protected by approved security controls, such as device compliance checks, endpoint protection, encryption, and conditional access.

28. Physical access to organisational premises and secure areas shall be restricted to authorised individuals based on business need and risk.

29. Secure areas containing sensitive information, critical systems, communications infrastructure, or regulated records shall have enhanced physical access controls appropriate to their risk, such as access cards, locks, visitor controls, CCTV, alarms, guards, or access logs.

30. Visitors shall be authorised, identified, registered, escorted where required, and granted only the physical access necessary for the approved visit purpose.

31. Physical access credentials, including keys, access cards, badges, and biometric permissions, shall be issued, tracked, protected, returned, disabled, or revoked when no longer required.

32. Access logs for critical logical and physical access points shall be generated, protected from unauthorised modification, retained in accordance with organisational retention requirements, and reviewed where required by risk or compliance obligations.

33. Access to sensitive, critical, or regulated information shall be monitored to detect unauthorised, excessive, unusual, or inappropriate access.

34. Access rights shall be reviewed periodically to confirm that access remains appropriate, authorised, and aligned with job responsibilities and business needs.

35. The minimum access review frequencies shall be as follows unless a stricter requirement is defined by law, regulation, contract, or risk assessment:

| Access Type | Minimum Review Frequency | Reviewer |
|---|---:|---|
| Privileged system, application, database, cloud, and network access | Quarterly | System Owner and Information Security |
| Access to critical systems and high-sensitivity information | Quarterly | Asset Owner or Data Owner |
| Standard user access to business applications | At least annually | System Owner or Line Manager |
| Third-party and supplier access | Quarterly or at contract milestone | Supplier Owner and System Owner |
| Physical access to secure areas | At least annually | Facilities Owner and Information Security |
| Emergency or break-glass access | After each use and quarterly | System Owner and Information Security |

36. Access review outcomes shall be documented, including reviewed access, reviewer, review date, decisions, removals, changes, exceptions, and follow-up actions.

37. Identified inappropriate, excessive, dormant, orphaned, unauthorised, or unused access shall be removed or remediated within defined timeframes based on risk.

38. The following target timeframes shall apply unless otherwise defined in approved procedures or contractual obligations:

| Event or Condition | Required Access Control Action | Target Timeframe |
|---|---|---:|
| Standard new joiner | Provision approved access | By start date or within 2 business days of approval |
| Role change or internal transfer | Modify access to match new role | Within 5 business days |
| Voluntary leaver | Disable logical access and recover physical credentials | By final working day |
| Involuntary leaver or high-risk termination | Disable access | Immediately upon notification |
| Expired contractor or supplier access | Disable or revalidate access | On or before expiry date |
| Privileged access no longer required | Remove privileged rights | Within 1 business day of identification |
| Unauthorised access detected | Suspend or remove access pending investigation | Immediately |
| Dormant account identified | Disable or validate continued need | Within 10 business days |
| Failed access review remediation | Escalate to control owner | Within 5 business days of missed due date |

39. Access control decisions shall consider segregation of duties to prevent conflicts that could enable fraud, unauthorised changes, inappropriate approvals, or uncontrolled access to sensitive functions.

40. Where segregation of duties cannot be fully achieved due to operational constraints, compensating controls shall be implemented, documented, approved, and periodically reviewed.

41. Access to source code repositories, development environments, production environments, change management tools, backup systems, security monitoring platforms, and cryptographic key management systems shall be controlled according to risk and limited to authorised roles.

42. Access between development, test, staging, and production environments shall be controlled to prevent unauthorised changes, data exposure, or inappropriate use of production information.

43. Service accounts, application accounts, system accounts, and machine identities shall be authorised, documented, assigned an owner, protected using strong credential management, and reviewed periodically.

44. Service accounts shall not be used for interactive login unless explicitly approved, technically required, and subject to monitoring and compensating controls.

45. Access control mechanisms shall be configured to enforce approved access rules and shall not be bypassed, disabled, or weakened without formal authorisation.

46. Access to audit logs, security logs, access control configuration, and identity management systems shall be restricted to authorised personnel and protected from unauthorised alteration or deletion.

47. Users shall be informed of their access control responsibilities, including protecting credentials, using access only for authorised purposes, reporting suspected compromise, and complying with this Policy.

48. Users shall not share accounts, passwords, tokens, access cards, keys, badges, or other credentials with any other person.

49. Users shall not attempt to access information, systems, physical areas, or services for which they have not been authorised.

50. Managers shall ensure that access requests for their personnel are accurate, necessary, and aligned with job responsibilities.

51. Asset owners and system owners shall ensure that access permissions for their assets are defined, approved, maintained, reviewed, and revoked in accordance with this Policy.

52. The organisation shall maintain records sufficient to demonstrate effective access control governance, including access requests, approvals, provisioning actions, access reviews, revocations, exceptions, emergency access use, and monitoring activities.

53. Access control requirements shall be incorporated into supplier agreements, outsourcing arrangements, cloud service arrangements, and other third-party engagements where third parties access organisational information or assets.

54. Access control records shall be retained in accordance with the organisation’s information retention requirements and shall be available for audit, investigation, and compliance purposes.

55. Access control practices shall be tested, monitored, or audited periodically to verify operating effectiveness and alignment with the ISMS.

56. Non-compliance with this Policy shall be recorded, assessed, escalated, and remediated in accordance with the organisation’s compliance, disciplinary, incident management, or supplier management processes.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board / Senior Management | Provide oversight and support for effective access control governance; ensure appropriate resources and accountability are assigned. |
| Information Security Manager | Own this Policy; define access control requirements; advise on risk-based controls; monitor compliance; review exceptions; support audits and investigations. |
| ISMS Manager | Ensure this Policy is integrated into the ISMS; coordinate control assurance, evidence collection, management review inputs, and continual improvement activities. |
| Asset Owners / Data Owners | Define access requirements for assets and information; approve access based on business need; classify information; review access rights; ensure inappropriate access is removed. |
| System Owners / Application Owners | Implement and maintain access controls for systems and applications; ensure access is provisioned and revoked correctly; support access reviews and audit evidence requests. |
| Line Managers | Request and validate access for personnel; ensure access aligns with role requirements; notify relevant teams promptly of joiner, mover, leaver, and role change events. |
| Human Resources | Notify IT, Facilities, and relevant managers of employment lifecycle events; support timely access changes for joiners, movers, and leavers. |
| IT Operations / Identity and Access Management Team | Administer access provisioning, modification, suspension, and revocation; maintain access records; configure identity platforms; support access reviews and remediation. |
| Facilities / Physical Security | Manage physical access controls, visitor access, badges, keys, secure areas, physical access logs, and physical access reviews. |
| Supplier Owners / Contract Managers | Ensure third-party access is authorised, contractually controlled, periodically reviewed, and revoked when no longer required. |
| Users | Use access only for authorised business purposes; protect credentials and access devices; comply with this Policy; report suspected unauthorised access or credential compromise. |
| Internal Audit / Compliance Function | Independently assess compliance with access control requirements and report findings to management where applicable. |

## Compliance, Monitoring & Enforcement

Compliance with this Policy shall be monitored through a combination of management oversight, access reviews, technical monitoring, control testing, security logging, physical access checks, internal audits, supplier assurance activities, and ISMS performance evaluation.

The organisation shall maintain appropriate evidence to demonstrate implementation and operating effectiveness of access control requirements. Evidence may include:

- Approved access requests and access change records.
- Access review records and remediation tracking.
- Privileged access assignments and approvals.
- Emergency access logs and post-use reviews.
- Joiner, mover, and leaver access records.
- Physical access logs, badge records, visitor logs, and secure area access lists.
- Identity and access management configuration records.
- Authentication and authorisation logs.
- Supplier access approvals and reviews.
- Exception approvals and compensating control records.
- Audit results, corrective actions, and management review outputs.

The following monitoring activities shall be performed at minimum:

| Monitoring Activity | Minimum Frequency | Responsible Role |
|---|---:|---|
| Review of privileged access rights | Quarterly | Information Security and System Owners |
| Review of access to critical systems | Quarterly | System Owners and Asset Owners |
| Review of standard user access | Annually | Line Managers and System Owners |
| Review of third-party access | Quarterly | Supplier Owners and System Owners |
| Review of physical access to secure areas | Annually | Facilities and Information Security |
| Review of emergency access use | After each use | Information Security and System Owner |
| Monitoring of failed, suspicious, or anomalous access attempts | Ongoing, where supported | IT Operations / Security Operations |
| Verification of leaver access removal | At least monthly sample-based check | HR, IT Operations, and Information Security |
| Access control internal audit or control testing | At planned ISMS audit intervals | Internal Audit / ISMS Manager |

Non-compliance with this Policy may result in one or more of the following actions:

- Immediate suspension or revocation of access.
- Mandatory remediation or corrective action.
- Security incident investigation.
- Escalation to line management, Human Resources, Legal, or Senior Management.
- Disciplinary action up to and including termination of employment.
- Contractual remedies, service suspension, or termination for suppliers or third parties.
- Reporting to regulators, customers, or other external parties where required by law, regulation, or contract.

Any suspected unauthorised access, credential compromise, inappropriate privilege use, physical access breach, or failure of access controls shall be reported and handled in accordance with the organisation’s information security incident management process.

## Exceptions

Exceptions to this Policy shall be permitted only where there is a documented business justification, risk assessment, approval by appropriate authority, and implementation of compensating controls where required.

All exceptions shall:

- Be formally requested using the organisation’s exception management process.
- Identify the specific Policy requirement for which the exception is requested.
- Include the business reason, affected assets, affected users, access type, risk assessment, proposed compensating controls, and requested duration.
- Be reviewed by the Information Security Manager or delegated authority.
- Be approved by the relevant risk owner, asset owner, and any additional required approver based on risk.
- Be time-bound and subject to periodic review.
- Be recorded in the ISMS exception register.
- Be revoked when no longer required or when the approved expiry date is reached.

Permanent exceptions shall not be permitted unless approved through formal risk acceptance by senior management and reviewed at least annually.

| Exception Risk Level | Maximum Approval Period | Minimum Approver |
|---|---:|---|
| Low | 12 months | Asset Owner and Information Security Manager |
| Medium | 6 months | Risk Owner and Information Security Manager |
| High | 3 months | Senior Management and Information Security Manager |
| Critical | Not normally permitted | Executive approval required if unavoidable |

## Review & Maintenance

This Policy shall be reviewed at least annually or sooner if any of the following occur:

- Significant change to business operations, technology, facilities, or organisational structure.
- Introduction of new systems, applications, cloud services, identity platforms, or physical access control technologies.
- Significant access control failure, security incident, audit finding, or compliance issue.
- Change to applicable legal, regulatory, contractual, or ISO/IEC 27001 requirements.
- Change in risk profile, information classification requirements, or threat environment.
- Management direction or ISMS continual improvement requirement.

The Information Security Manager shall be responsible for coordinating review and maintenance of this Policy. Updates shall be reviewed with relevant stakeholders, approved in accordance with the organisation’s document control requirements, communicated to affected personnel, and retained as controlled ISMS documentation.

Version history shall be maintained to evidence review, approval, and changes.

| Version | Date | Description of Change | Author | Approver |
|---|---|---|---|---|
| 1.0 | [YYYY-MM-DD] | Initial issue | [Information Security Manager] | [Approver Name / Role] |