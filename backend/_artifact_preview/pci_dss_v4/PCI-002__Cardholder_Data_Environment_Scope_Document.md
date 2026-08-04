<!-- pci_dss_v4 / PCI-002 | type=Policy | mode=markdown | model=gpt-5.5 | 27648 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [POL-PCI-12.5.2-CDE-SCOPE] | 1.0 | [PCI DSS Compliance Owner] | [YYYY-MM-DD] | PCI DSS v4.0.1 | Requirement 12.5.2 | Internal / Confidential |

## Purpose

This Policy establishes mandatory requirements for documenting, validating, approving, and maintaining the organisation’s Cardholder Data Environment (CDE) scope in accordance with PCI DSS v4.0.1 Requirement 12.5.2.

The purpose of this Policy is to ensure that the organisation formally confirms, at least once every 12 months and upon significant changes, all system components, people, processes, technologies, facilities, networks, services, and third parties that are in scope for PCI DSS because they store, process, transmit, or can impact the security of cardholder data or sensitive authentication data.

## Scope

This Policy applies to all organisational entities, business units, personnel, contractors, service providers, systems, networks, applications, cloud environments, facilities, and processes that:

- Store, process, or transmit cardholder data or sensitive authentication data;
- Are connected to the CDE;
- Provide security services to the CDE;
- Segment or isolate the CDE from out-of-scope environments;
- Can impact the security of the CDE, including administrative, authentication, monitoring, logging, backup, vulnerability management, and change management systems;
- Support payment channels, payment applications, payment terminals, e-commerce services, call centres, payment gateways, or other payment-related business processes;
- Are operated by third parties on behalf of the organisation and are relevant to PCI DSS scope.

For the purposes of this Policy:

| Term | Definition |
|---|---|
| Cardholder Data Environment (CDE) | The people, processes, technologies, system components, and networks that store, process, or transmit cardholder data or sensitive authentication data. |
| In-Scope System Component | Any network device, server, application, workstation, cloud resource, container, virtual system, security tool, payment device, database, storage platform, or other technology component that is within or connected to the CDE, or that can impact CDE security. |
| Connected-to System | A system component with network, logical, administrative, data, or service connectivity to the CDE. |
| Security-Impacting System | A system component that may not store, process, or transmit cardholder data but can affect CDE security, including identity providers, logging platforms, vulnerability scanners, endpoint protection, jump hosts, hypervisors, orchestration platforms, and segmentation controls. |
| Significant Change | A change that could affect PCI DSS scope, CDE security, cardholder data flows, segmentation boundaries, payment channels, system architecture, third-party services, or the organisation’s ability to protect cardholder data. |
| Scope Confirmation | The formal process of validating and approving the accuracy and completeness of the PCI DSS scope, including in-scope components, people, processes, technologies, data flows, facilities, and service providers. |

## Policy Statements

1. The organisation shall maintain a documented PCI DSS scope that accurately identifies all CDE components, connected-to systems, security-impacting systems, people, processes, technologies, facilities, and third parties that are in scope for PCI DSS.

2. The organisation shall formally confirm PCI DSS scope at least once every 12 months.

3. The organisation shall formally confirm PCI DSS scope upon any significant change that could affect the CDE, payment processing environment, segmentation boundaries, cardholder data flows, or PCI DSS applicability.

4. The documented PCI DSS scope shall include, at minimum:
 - All payment channels, including card-present, card-not-present, e-commerce, mail order/telephone order, recurring billing, and any other applicable channels;
 - All locations where cardholder data is stored, processed, transmitted, displayed, printed, recorded, backed up, archived, or otherwise handled;
 - All data flows involving cardholder data and sensitive authentication data;
 - All system components within the CDE;
 - All systems connected to the CDE;
 - All systems that can impact the security of the CDE;
 - All segmentation controls used to isolate the CDE from out-of-scope networks or systems;
 - All personnel roles with access to the CDE or responsibility for CDE security;
 - All business processes that store, process, transmit, or can affect the security of cardholder data;
 - All third-party service providers that store, process, transmit, or can impact the security of cardholder data on behalf of the organisation;
 - All cloud, hosted, outsourced, managed, and software-as-a-service services relevant to PCI DSS scope.

5. The scope confirmation process shall validate that the organisation has identified all methods by which cardholder data enters, moves through, is stored within, and exits the organisation’s environment.

6. The scope confirmation process shall include review and validation of current cardholder data flow diagrams, network diagrams, system inventories, application inventories, asset inventories, data repositories, user access records, service provider records, and segmentation documentation.

7. The organisation shall maintain current diagrams that show cardholder data flows across systems and networks, including transmission to and from third parties, payment processors, gateways, acquiring banks, tokenisation providers, managed service providers, and cloud service providers.

8. The organisation shall maintain current network diagrams that identify the CDE, all connections into and out of the CDE, segmentation controls, wireless networks where applicable, internet connectivity, remote access paths, security devices, and connections to third-party environments.

9. The organisation shall identify and document all personnel and roles that have access to, administer, support, monitor, or otherwise affect the CDE, including employees, contractors, privileged users, developers, service desk personnel, system administrators, database administrators, network administrators, security personnel, business users, and third-party support personnel.

10. The organisation shall document the rationale for including or excluding system components, people, processes, facilities, and technologies from PCI DSS scope.

11. The organisation shall not designate a component, network, process, person, or third party as out of scope unless there is documented evidence that it does not store, process, transmit, or impact the security of cardholder data and is not connected to the CDE in a manner that brings it into scope.

12. The organisation shall evaluate all segmentation controls relied upon to reduce PCI DSS scope and shall ensure those controls are represented accurately in the scope documentation.

13. The organisation shall treat systems that provide identity, authentication, authorisation, logging, monitoring, vulnerability management, malware protection, time synchronisation, backup, configuration management, or administrative access for the CDE as in scope where they can impact CDE security.

14. The organisation shall include payment terminals, point-of-sale systems, payment applications, payment pages, payment scripts, call recording platforms, interactive voice response systems, payment middleware, APIs, databases, file transfer systems, and e-commerce infrastructure in the scope assessment where applicable.

15. The organisation shall include cloud services and virtualised environments in scope where they host, process, transmit, secure, administer, monitor, or support cardholder data or the CDE.

16. The organisation shall review whether cardholder data exists in unexpected locations during scope confirmation, including file shares, email systems, collaboration platforms, logs, reports, backups, screenshots, recordings, databases, object storage, development environments, test environments, analytics platforms, and endpoint devices.

17. The organisation shall confirm that sensitive authentication data is not stored after authorisation unless explicitly permitted by PCI DSS and supported by documented business, legal, and compliance justification.

18. The organisation shall ensure that development, test, staging, training, and support environments are evaluated for PCI DSS scope where they contain cardholder data, are connected to the CDE, or can impact CDE security.

19. The organisation shall confirm that all in-scope people are subject to applicable PCI DSS security requirements, including security awareness, acceptable use, access control, authentication, logging, incident response, and role-specific responsibilities.

20. The organisation shall confirm that all in-scope third-party service providers are identified, assigned ownership, and managed in accordance with PCI DSS service provider management requirements.

21. The organisation shall maintain a PCI DSS Scope Register as the authoritative record of in-scope components, people, processes, technologies, facilities, and third-party services.

22. The PCI DSS Scope Register shall include, at minimum, the following information for each in-scope system component:

| Required Field | Description |
|---|---|
| Asset or Component ID | Unique identifier from the asset inventory or configuration management system. |
| Component Name | System, application, service, device, or platform name. |
| Component Type | Server, database, application, network device, endpoint, cloud resource, security tool, payment device, storage, container, virtual host, or other type. |
| Environment | Production, disaster recovery, test, development, staging, support, or other environment. |
| Business Owner | Individual or function accountable for business use. |
| Technical Owner | Individual or function accountable for technical management. |
| Location / Hosting Model | Data centre, office, store, cloud region, managed service, SaaS, or third-party location. |
| PCI Scope Category | CDE, connected-to, security-impacting, segmentation control, or third-party service. |
| Cardholder Data Function | Stores, processes, transmits, secures, administers, monitors, backs up, or supports cardholder data. |
| Data Classification | Cardholder data, sensitive authentication data, tokenised data, truncated data, encrypted data, or no cardholder data. |
| Connectivity | Key network, logical, administrative, data, or service connections to or from the CDE. |
| Segmentation Dependency | Segmentation controls relied upon, if applicable. |
| In-Scope Rationale | Reason the component is in scope. |
| Last Validated Date | Date component scope status was last confirmed. |
| Validation Evidence | Reference to diagram, inventory, scan, configuration, interview, ticket, or assessment evidence. |

23. The PCI DSS Scope Register shall include, at minimum, the following information for in-scope personnel and roles:

| Required Field | Description |
|---|---|
| Role / Team | Role, group, team, or function name. |
| Organisation | Internal department or external service provider. |
| Access Type | Physical, logical, administrative, remote, application, database, network, monitoring, support, or emergency access. |
| CDE Responsibility | Operates, administers, supports, develops, monitors, secures, approves, or uses CDE components or processes. |
| Privilege Level | Standard user, privileged user, administrator, security administrator, developer, third-party support, or other. |
| Business Justification | Reason access or responsibility is required. |
| Applicable PCI DSS Obligations | Relevant security obligations, training, access reviews, logging, incident response, or contractual requirements. |
| Owner | Manager or service owner accountable for the role. |
| Last Validated Date | Date role or access category was last confirmed. |

24. The annual scope confirmation shall follow a documented validation plan approved by the PCI DSS Compliance Owner.

25. The annual scope confirmation shall include input from all relevant business and technical stakeholders, including payment operations, information security, infrastructure, network, application, cloud, database, end-user computing, legal, procurement, third-party management, facilities, and internal audit where applicable.

26. The annual scope confirmation shall include evidence-based validation and shall not rely solely on verbal confirmation or assumptions.

27. The organisation shall retain evidence supporting the annual scope confirmation, including completed scope questionnaires, meeting records, diagrams, inventory extracts, change records, access records, service provider lists, network configuration evidence, segmentation evidence, vulnerability scan scope, and approval records.

28. The annual scope confirmation shall result in a formal PCI DSS Scope Confirmation Record approved by accountable business and technical owners.

29. The PCI DSS Scope Confirmation Record shall include, at minimum:

| Required Field | Description |
|---|---|
| Confirmation Period | Period covered by the scope confirmation. |
| Confirmation Date | Date scope was formally confirmed. |
| Trigger | Annual review or significant change. |
| Scope Summary | Summary of CDE boundaries, payment channels, and major in-scope environments. |
| Components Confirmed | Summary or reference to in-scope system components. |
| People Confirmed | Summary or reference to in-scope roles and personnel categories. |
| Processes Confirmed | Summary or reference to in-scope payment and security processes. |
| Third Parties Confirmed | Summary or reference to in-scope service providers. |
| Data Flows Confirmed | Reference to current cardholder data flow diagrams. |
| Network Boundaries Confirmed | Reference to current network and segmentation diagrams. |
| Changes Identified | Summary of scope changes since the prior confirmation. |
| Issues or Gaps | Scope-related deficiencies requiring remediation. |
| Remediation Owner | Accountable owner for each issue or gap. |
| Approval | Sign-off by accountable owners. |
| Evidence References | Links or references to supporting documentation. |

30. Significant changes requiring scope confirmation shall include, but are not limited to:

| Significant Change Category | Examples |
|---|---|
| Payment Channel Change | New e-commerce site, new point-of-sale solution, new payment terminal type, new payment gateway, new call centre payment process, or new mobile payment method. |
| Architecture Change | New network segment, firewall redesign, routing change, new remote access path, new cloud architecture, new data centre, or major platform migration. |
| Data Flow Change | New cardholder data transmission, storage location, integration, interface, file transfer, API, reporting flow, backup flow, or third-party exchange. |
| Segmentation Change | New or modified firewall rules, VLAN changes, security group changes, microsegmentation changes, access control list changes, or zero trust policy changes affecting CDE isolation. |
| System Change | Deployment, replacement, decommissioning, or major modification of systems that store, process, transmit, secure, administer, monitor, or support cardholder data. |
| Third-Party Change | New service provider, changed service provider responsibility, outsourcing of payment functions, new managed service, or change to cloud service model. |
| Organisational Change | Merger, acquisition, divestiture, new location, new business unit, new operating model, or major staffing model change affecting payment processing. |
| Security Tooling Change | Change to identity provider, logging platform, SIEM, vulnerability scanner, endpoint protection, key management, backup, monitoring, or administrative access tooling. |
| Compliance Boundary Change | Decision to bring a system into scope, remove a system from scope, change the CDE boundary, or change scope-reduction strategy. |

31. Where a significant change occurs, the responsible change owner shall notify the PCI DSS Compliance Owner before implementation where practicable, and no later than [5 business days] after identification of the change.

32. PCI DSS scope impact assessment shall be a mandatory part of the change management process for changes affecting payment systems, CDE-connected environments, CDE security controls, third-party payment services, or cardholder data flows.

33. No system, service, process, or third-party integration that may affect PCI DSS scope shall be placed into production until PCI DSS scope impact has been assessed and documented.

34. When scope confirmation identifies previously unknown cardholder data, undocumented connections, unapproved storage, unapproved transmission, or unrecognised in-scope components, the organisation shall treat the finding as a compliance issue and initiate remediation according to risk and PCI DSS impact.

35. The organisation shall ensure that PCI DSS assessment activities, vulnerability scanning, penetration testing, segmentation testing, security control monitoring, and evidence collection are aligned to the confirmed PCI DSS scope.

36. The organisation shall preserve prior versions of PCI DSS scope documentation to demonstrate historical scope decisions and annual confirmation history.

37. PCI DSS scope documentation shall be protected from unauthorised modification and shall be accessible only to personnel with a legitimate business, security, audit, or compliance need.

38. The organisation shall ensure that scope documentation is sufficiently detailed to enable independent validation by internal audit, external assessors, acquiring banks, payment brands, or authorised regulators where applicable.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board / Executive Management | Provides oversight and accountability for PCI DSS compliance; ensures resources are available to maintain accurate PCI DSS scope and protect cardholder data. |
| PCI DSS Compliance Owner | Owns this Policy; coordinates annual and change-triggered PCI DSS scope confirmation; maintains the PCI DSS Scope Register; ensures scope evidence is retained; reports scope status and issues to management. |
| Chief Information Security Officer or Security Lead | Ensures CDE security-impacting systems and controls are identified; validates security control boundaries; ensures monitoring, vulnerability management, segmentation, access control, and incident response scope alignment. |
| Payment Process Owner | Identifies business processes that store, process, transmit, or handle cardholder data; validates payment channels, data flows, procedures, and personnel involved in payment activities. |
| System Owners | Confirm whether their systems store, process, transmit, connect to, or can impact the CDE; maintain accurate asset information; support evidence collection and remediation. |
| Application Owners | Validate payment application scope, integrations, data flows, APIs, stored data, logs, reports, development/test usage, and third-party dependencies. |
| Network Owner | Maintains accurate network diagrams; identifies CDE connectivity; validates segmentation controls, firewall rules, routing, remote access paths, wireless networks, and external connectivity. |
| Cloud / Infrastructure Owner | Identifies in-scope cloud services, virtual platforms, storage, containers, orchestration tools, administrative planes, identity integrations, and managed infrastructure services. |
| Database / Data Platform Owner | Identifies repositories containing cardholder data or sensitive authentication data; confirms storage, replication, backup, logging, reporting, and analytics scope. |
| Identity and Access Management Owner | Identifies roles and accounts with CDE access or security impact; supports validation of in-scope people, privileged access, remote access, and third-party access. |
| Third-Party Risk / Vendor Management Owner | Maintains the list of service providers relevant to PCI DSS; confirms third-party responsibilities, service descriptions, contracts, attestations, and scope impact. |
| Change Advisory Board / Change Manager | Ensures PCI DSS scope impact assessment is included in applicable change reviews and that significant changes trigger scope confirmation. |
| Internal Audit or Independent Assurance Function | Provides independent review of the scope confirmation process where applicable; validates adherence to this Policy; reports findings to management. |
| Business Unit Managers | Identify personnel and processes within their areas that interact with cardholder data or the CDE; ensure timely participation in scope reviews. |
| Employees, Contractors, and Third-Party Users | Comply with this Policy; promptly report any suspected unapproved handling, storage, transmission, or exposure of cardholder data. |

## Compliance, Monitoring & Enforcement

Compliance with this Policy is mandatory.

The PCI DSS Compliance Owner shall monitor adherence to this Policy through scheduled scope reviews, change management reviews, evidence sampling, stakeholder attestations, asset inventory reconciliation, access review alignment, service provider review, and review of diagrams and data flows.

At minimum, the following monitoring activities shall be performed:

| Monitoring Activity | Frequency | Responsible Role | Evidence |
|---|---:|---|---|
| Formal PCI DSS scope confirmation | At least annually | PCI DSS Compliance Owner | Approved PCI DSS Scope Confirmation Record |
| Scope impact review for significant changes | Per applicable change | Change Manager / PCI DSS Compliance Owner | Change ticket, scope impact assessment, approval record |
| Review of CDE system component inventory | At least annually and upon significant change | System Owners / PCI DSS Compliance Owner | PCI DSS Scope Register, asset inventory reconciliation |
| Review of in-scope personnel and roles | At least annually and upon significant change | IAM Owner / Business Owners | Role inventory, access review evidence |
| Review of cardholder data flow diagrams | At least annually and upon significant change | Payment Process Owner / Application Owners | Approved data flow diagrams |
| Review of network and segmentation diagrams | At least annually and upon significant change | Network Owner | Approved network diagrams and segmentation documentation |
| Review of in-scope third-party service providers | At least annually and upon onboarding or material service change | Third-Party Risk Owner | Service provider register, contracts, AOC or responsibility matrix |
| Reconciliation of vulnerability scan and penetration test scope to confirmed PCI DSS scope | At least annually and before assessment activities | Security Lead | Scan scope records, penetration test scope, segmentation test scope |
| Review of unexpected cardholder data locations | At least annually or as defined by data discovery programme | Security Lead / Data Owners | Data discovery results, remediation records |

Non-compliance with this Policy may result in one or more of the following actions:

- Mandatory remediation plan with assigned ownership and due dates;
- Escalation to executive management or the risk committee;
- Suspension or rejection of changes that have not completed PCI DSS scope impact assessment;
- Removal or restriction of access to the CDE;
- Increased monitoring, testing, or assurance activities;
- Contractual remedies for service providers;
- Disciplinary action in accordance with [HR Disciplinary Policy];
- Notification to acquiring banks, payment brands, regulators, or customers where required by contractual, legal, or regulatory obligations.

The organisation shall track scope-related issues to closure. Issues that may affect PCI DSS compliance or cardholder data security shall be risk assessed, prioritised, and remediated within approved timeframes.

## Exceptions

Exceptions to this Policy are not permitted where they would result in failure to identify, document, confirm, or maintain accurate PCI DSS scope as required by PCI DSS v4.0.1 Requirement 12.5.2.

Any requested exception to supporting requirements of this Policy shall:

- Be documented in the organisation’s exception management process;
- Include the business justification;
- Identify the affected systems, people, processes, technologies, facilities, third parties, and cardholder data flows;
- Include an assessment of PCI DSS compliance impact and cardholder data risk;
- Include compensating or alternative controls where applicable;
- Be reviewed by the PCI DSS Compliance Owner and Information Security;
- Be approved by [Authorised Risk Approver / Risk Committee];
- Have a defined expiry date not exceeding [12 months];
- Be reviewed before expiry, renewal, or closure.

Exceptions shall not be used to remove systems, people, processes, or third parties from PCI DSS scope without documented evidence that they do not store, process, transmit, connect to, or impact the security of cardholder data.

Approved exceptions shall be retained as PCI DSS evidence and shall be available for review by authorised assessors, auditors, and compliance stakeholders.

## Review & Maintenance

This Policy shall be reviewed at least annually and whenever there is a material change to PCI DSS requirements, payment processing activities, the CDE, organisational structure, technology architecture, service provider relationships, or applicable legal, regulatory, or contractual obligations.

The PCI DSS Compliance Owner shall ensure that this Policy remains aligned with PCI DSS v4.0.1 Requirement 12.5.2 and related PCI DSS requirements concerning scope, asset inventory, data flow diagrams, network diagrams, third-party service providers, change management, access control, vulnerability management, penetration testing, segmentation testing, and governance.

Policy review shall include, at minimum:

| Review Item | Requirement |
|---|---|
| Control alignment | Confirm continued alignment with PCI DSS v4.0.1 Requirement 12.5.2 and related requirements. |
| Annual scope confirmation evidence | Confirm that the most recent annual PCI DSS Scope Confirmation Record exists and is approved. |
| Significant change handling | Confirm that significant changes were assessed for PCI DSS scope impact. |
| Scope register completeness | Confirm that system components, people, processes, technologies, facilities, and third parties are accurately represented. |
| Diagram currency | Confirm that cardholder data flow diagrams and network diagrams are current and approved. |
| Role and responsibility accuracy | Confirm owners and stakeholders remain accurate. |
| Exception status | Confirm exceptions are current, approved, risk assessed, and not expired. |
| Audit and assessment feedback | Incorporate findings from internal audit, external assessment, penetration testing, segmentation testing, and compliance reviews. |

Policy changes shall be approved by [Policy Approval Authority] prior to publication. Superseded versions shall be retained according to the organisation’s document retention requirements and PCI DSS evidence retention needs.

The current approved version of this Policy shall be made available to all relevant personnel involved in payment processing, CDE administration, CDE security, third-party management, change management, and PCI DSS compliance.