<!-- pci_dss_v4 / PCI-011 | type=Policy | mode=markdown | model=gpt-5.5 | 24704 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [AUP-PCI-001] | 1.0 | [Information Security Officer] | [Effective Date] | PCI DSS v4.0.1 | Requirement 12.2.1 | Internal |

## Purpose

The purpose of this Acceptable Use Policy is to define mandatory requirements for the acceptable use of technologies that may affect the security of cardholder data, sensitive authentication data, the Cardholder Data Environment (CDE), connected-to/security-impacting systems, and payment-related business processes.

This policy supports PCI DSS v4.0.1 Requirement 12.2.1, which requires acceptable use policies for end-user technologies to be defined, documented, and implemented, including explicit requirements for acceptable uses of those technologies.

## Scope

This policy applies to all workforce members, contractors, consultants, temporary staff, third-party service providers, and any other users who access, administer, support, process, store, transmit, or can otherwise impact:

- Cardholder data.
- Sensitive authentication data.
- The Cardholder Data Environment.
- Systems connected to or capable of impacting the security of the CDE.
- Payment applications, payment terminals, payment gateways, and related administrative interfaces.
- Network, cloud, endpoint, collaboration, removable media, mobile, remote access, authentication, monitoring, and administrative technologies used in or affecting PCI DSS scope.

This policy applies to organisation-owned, leased, managed, hosted, cloud-based, and approved personally owned technologies when used to access organisational resources or payment-related environments.

For the purposes of this policy, “critical technologies” include, but are not limited to:

| Technology Category | Examples |
|---|---|
| End-user computing devices | Laptops, desktops, thin clients, virtual desktops, tablets |
| Mobile and portable devices | Smartphones, tablets, handheld scanners, point-of-sale mobile devices |
| Removable and portable storage | USB drives, external hard drives, memory cards, optical media |
| Network and remote access technologies | VPN, ZTNA, jump hosts, wireless networks, bastion hosts |
| Authentication technologies | Password managers, multi-factor authentication tokens, smart cards, certificates |
| Administrative and privileged access tools | PAM tools, command-line tools, RDP/SSH, hypervisor consoles, cloud admin portals |
| Payment technologies | POS systems, payment terminals, payment applications, payment middleware |
| Collaboration and messaging platforms | Email, chat, file sharing, ticketing systems, document repositories |
| Cloud and SaaS services | IaaS, PaaS, SaaS, storage buckets, serverless platforms |
| Security technologies | SIEM, EDR, DLP, vulnerability scanners, logging platforms |
| Development and automation tools | Source repositories, CI/CD platforms, scripts, infrastructure-as-code tools |

## Policy Statements

1. The organisation shall define, document, communicate, and enforce acceptable use requirements for all technologies that store, process, transmit, provide access to, or can impact the security of cardholder data or the CDE.

2. Users shall use organisational technologies only for authorised business purposes, approved payment operations, security administration, support activities, or limited personal use where explicitly permitted by [Organisation Name] and where such use does not introduce security, compliance, legal, operational, or reputational risk.

3. Users shall not store, process, transmit, copy, print, photograph, screen-capture, or otherwise record cardholder data unless there is a documented business need, management approval, and the activity is performed using approved systems and secure methods.

4. Users shall not store sensitive authentication data after authorisation, including full track data, card verification codes or values, PINs, PIN blocks, or equivalent authentication data, except where explicitly permitted by PCI DSS and approved by the [Information Security Officer].

5. Users shall access cardholder data and CDE systems only through approved, authenticated, authorised, and monitored access methods.

6. Users shall not bypass, disable, alter, remove, or interfere with security controls, including endpoint protection, logging agents, encryption, device management, multi-factor authentication, network segmentation, firewalls, DLP, configuration baselines, or vulnerability management tools.

7. Users shall not connect unauthorised devices, systems, applications, peripherals, payment terminals, wireless access points, storage media, network equipment, or cloud services to organisational networks or systems, including those in or connected to the CDE.

8. Users shall not install, use, or execute unauthorised software, scripts, browser extensions, agents, tools, containers, virtual machines, remote access utilities, packet capture tools, cryptocurrency miners, or administrative utilities on systems in scope for PCI DSS or connected-to/security-impacting systems.

9. Users shall use only approved and managed endpoints to access the CDE, payment systems, administrative consoles, cloud management interfaces, or systems that can impact the CDE.

10. Users shall ensure that assigned devices are physically protected from theft, loss, tampering, unauthorised viewing, and unauthorised use, including when working remotely, travelling, or operating in public or shared spaces.

11. Users shall lock screens or log out when devices are unattended and shall not leave authenticated sessions to CDE systems, payment applications, administrative tools, or cardholder data repositories unattended.

12. Users shall not share user accounts, passwords, authentication factors, certificates, tokens, session cookies, privileged credentials, API keys, service account credentials, or any other authentication secrets.

13. Users shall authenticate using unique user IDs and approved authentication methods, including multi-factor authentication where required for CDE access, remote access, administrative access, cloud administration, or other PCI DSS-relevant access paths.

14. Users shall protect passwords, passphrases, authentication tokens, and other secrets from disclosure, reuse, unauthorised storage, or transmission through insecure channels.

15. Users shall use only organisation-approved password managers or privileged access management tools for storing credentials, keys, tokens, and other secrets.

16. Users shall not transmit cardholder data using unapproved channels, including personal email, consumer messaging applications, unapproved file-sharing platforms, removable media, chat tools, screenshots, or unsecured cloud storage.

17. Users shall not send unprotected primary account numbers or other cardholder data over end-user messaging technologies unless the transmission method has been approved by the [Information Security Officer] and the data is protected in accordance with PCI DSS requirements.

18. Users shall not copy cardholder data from approved payment systems into spreadsheets, documents, databases, ticketing systems, logs, emails, chat messages, notes, screenshots, test environments, or local files unless expressly authorised, documented, and protected using approved controls.

19. Users shall not use live cardholder data or sensitive authentication data for development, testing, training, troubleshooting, demonstrations, or non-production activities unless explicitly permitted under PCI DSS, formally approved, and protected by controls equivalent to production.

20. Users shall not introduce unauthorised wireless networks, personal hotspots, tethered connections, rogue access points, or consumer-grade network equipment into facilities or networks that host or connect to CDE systems.

21. Users shall use wireless networks only when authorised, securely configured, monitored, and approved for the applicable business purpose and PCI DSS scope.

22. Users shall use remote access technologies only when approved by [Organisation Name], configured with strong authentication, protected by multi-factor authentication where required, and used from secure devices and networks.

23. Users shall not use split tunnelling, remote desktop forwarding, unauthorised proxy services, anonymising services, VPN bypass tools, or other mechanisms to circumvent organisational security monitoring or network controls.

24. Users shall not access CDE systems or cardholder data from public, shared, kiosk, unmanaged, jailbroken, rooted, or otherwise non-compliant devices.

25. Users shall report lost, stolen, compromised, malfunctioning, or suspected-tampered devices, removable media, authentication tokens, payment terminals, or credentials immediately in accordance with the incident reporting process.

26. Users shall not connect removable media to CDE or connected-to/security-impacting systems unless there is an approved business need, the media is authorised, scanned for malware, encrypted where required, and tracked in accordance with organisational requirements.

27. Users shall not store cardholder data on removable media unless explicitly authorised, encrypted using approved cryptography, access-controlled, inventoried, and subject to secure handling and disposal requirements.

28. Users shall protect hardcopy materials containing cardholder data from unauthorised access, copying, scanning, photographing, removal, or disposal, and shall use approved secure disposal methods.

29. Users shall not photograph, video-record, print, photocopy, or otherwise reproduce cardholder data, payment terminal screens, payment application screens, or authentication secrets unless specifically authorised for a documented business purpose.

30. Users shall not discuss, display, or expose cardholder data or CDE-sensitive information in public areas, shared workspaces, video calls, collaboration tools, or any location where unauthorised persons may observe or overhear the information.

31. Users shall ensure that payment terminals, POS devices, and other payment acceptance technologies are used only for approved payment processing activities and are not repurposed, modified, relocated, or connected to unauthorised networks or peripherals.

32. Users shall not attempt to tamper with, repair, reconfigure, jailbreak, root, unlock, or modify payment terminals, POS systems, endpoint security tools, logging tools, or other PCI DSS-relevant technologies unless authorised as part of assigned job duties.

33. Users shall follow approved procedures for identifying, reporting, and escalating suspected payment terminal tampering, substitution, unexpected behaviour, or unauthorised changes.

34. Users shall not access, attempt to access, scan, probe, test, exploit, intercept, monitor, or modify systems, applications, networks, logs, data, or accounts unless specifically authorised as part of assigned job duties and approved security testing or administrative activity.

35. Users performing administrative or privileged activities shall use dedicated administrative accounts and approved administrative workstations, jump hosts, PAM solutions, or equivalent approved control mechanisms where required.

36. Users shall not use privileged accounts for email, web browsing, general productivity, or non-administrative tasks.

37. Users shall not export, download, synchronise, replicate, or transfer CDE data, configuration files, logs containing cardholder data, encryption keys, security events, or system images to unapproved repositories, storage services, personal devices, or external parties.

38. Users shall use approved secure file transfer, encryption, access control, and retention methods when transmitting or exchanging PCI DSS-relevant information with authorised third parties.

39. Users shall not use personal email accounts, personal cloud storage, consumer messaging applications, or unapproved AI, transcription, translation, analytics, or productivity tools to process, upload, summarise, analyse, transmit, or store cardholder data or CDE-sensitive information.

40. Users shall not input cardholder data, sensitive authentication data, authentication secrets, system configurations, vulnerability information, incident details, or other PCI DSS-sensitive information into public or unapproved artificial intelligence or machine learning services.

41. Users shall comply with organisational data classification, retention, disposal, encryption, access control, logging, and incident reporting requirements when using technologies that may affect PCI DSS scope.

42. Users shall immediately report suspected phishing, malware, credential compromise, unauthorised access, suspicious payment activity, security alerts, system misconfigurations, policy violations, or potential PCI DSS control failures to [Security Operations / Service Desk Contact].

43. Users shall not intentionally introduce malware, unauthorised code, exploits, backdoors, unauthorised services, weak configurations, or insecure integrations into organisational environments.

44. Users shall not disable automatic updates, patching, time synchronisation, logging, backups, endpoint detection, disk encryption, device compliance checks, certificate validation, or other security mechanisms required by organisational standards.

45. Users shall maintain separation between business use and personal use of technologies and shall not conduct personal, commercial, illegal, offensive, fraudulent, or high-risk activities using organisational systems.

46. Users shall not use organisational technologies to access, create, store, transmit, or distribute material that is unlawful, discriminatory, harassing, abusive, obscene, defamatory, malicious, or inconsistent with organisational values and legal obligations.

47. Users shall not perform activities that may impair availability, performance, integrity, or security of payment systems, CDE systems, or connected-to/security-impacting systems, including unauthorised bulk transfers, denial-of-service activity, excessive scanning, or unapproved load testing.

48. Users shall complete required security awareness, acceptable use, PCI DSS, and role-specific training before being granted access to CDE systems or technologies that can impact CDE security, and at least annually thereafter.

49. Managers shall ensure that users under their supervision understand and comply with this policy before being granted access to technologies in scope for PCI DSS.

50. The organisation shall make this policy available to all applicable users and shall require acknowledgement of this policy at onboarding, upon material change, and at least annually.

51. The organisation shall maintain records of user acknowledgement, training completion, approved exceptions, enforcement actions, and other evidence necessary to demonstrate implementation of acceptable use requirements.

52. The organisation shall review and update this policy when there are significant changes to technologies, threats, payment processes, PCI DSS scope, legal or regulatory obligations, or organisational risk, and at least once every 12 months.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board / Executive Management | Approves organisational direction for information security and supports enforcement of acceptable use requirements for PCI DSS-relevant technologies. |
| [Information Security Officer] | Owns this policy; ensures it aligns with PCI DSS v4.0.1; defines acceptable use requirements for critical technologies; reviews exceptions; monitors compliance; supports audits and assessments. |
| PCI DSS Compliance Owner | Ensures this policy supports PCI DSS Requirement 12.2.1 and maintains evidence of implementation for assessments, internal reviews, and external audits. |
| IT Operations | Implements technical controls that support acceptable use, including endpoint management, device configuration, access restrictions, logging, patching, encryption, approved software controls, and remote access controls. |
| Security Operations | Monitors for unacceptable use, investigates alerts and incidents, manages security event escalation, and supports enforcement actions. |
| System and Application Owners | Ensure systems under their responsibility are used only for approved purposes and configured to prevent or detect prohibited use. |
| Payment Operations / Merchant Operations | Ensures payment technologies, payment terminals, and payment-related processes are used only as approved and that suspected tampering or misuse is reported promptly. |
| Managers | Ensure personnel understand this policy, complete required training, use technologies appropriately, and report suspected non-compliance. |
| Users | Comply with this policy, protect assigned technologies and credentials, use only approved systems and methods, and promptly report suspected security incidents or policy violations. |
| Third-Party Service Providers | Comply with contractual acceptable use, PCI DSS, access, confidentiality, and security requirements when accessing or supporting organisational systems or payment environments. |
| Human Resources / People Function | Supports policy acknowledgement, disciplinary processes, onboarding and offboarding requirements, and workforce communications. |
| Internal Audit / Compliance | Performs independent reviews of policy adherence and validates that evidence supports PCI DSS compliance objectives. |

## Compliance, Monitoring & Enforcement

Compliance with this policy is mandatory. The organisation shall monitor, verify, and enforce acceptable use requirements through administrative, technical, and physical controls appropriate to the risk and PCI DSS scope.

Monitoring activities may include, but are not limited to:

| Monitoring Area | Examples of Evidence / Monitoring Activity | Minimum Frequency |
|---|---|---:|
| Policy acknowledgement | Signed or electronic acknowledgements for applicable users | Onboarding and annually |
| Security awareness completion | Training records covering acceptable use and PCI DSS responsibilities | Onboarding and annually |
| Endpoint compliance | Device management status, encryption, patching, EDR status, approved software inventory | Continuous or at least monthly |
| Remote access use | VPN/ZTNA logs, MFA events, privileged session logs | Continuous monitoring with periodic review |
| Privileged access use | PAM logs, admin account activity, jump host logs | Continuous monitoring with periodic review |
| Data movement | DLP alerts, file transfer logs, cloud storage activity, removable media use | Continuous where deployed |
| Cardholder data handling | CHD discovery scans, approved storage reviews, ticketing/email monitoring where authorised | Periodic and risk-based |
| Payment terminal use | Device inventory, inspection records, incident reports | In accordance with payment device procedures |
| Unauthorised software or services | Software inventory, EDR alerts, vulnerability scans, cloud/SaaS discovery | Continuous or at least monthly |
| Security incidents and violations | Incident tickets, investigation records, disciplinary actions, corrective actions | As events occur |

The organisation reserves the right, subject to applicable law and organisational procedures, to monitor, inspect, log, review, preserve, and disclose activity on organisational systems, networks, devices, applications, cloud services, and data stores, including activity involving cardholder data or the CDE.

Violations of this policy may result in one or more of the following actions:

- Removal or suspension of system, network, application, remote, privileged, or physical access.
- Device quarantine, reimaging, confiscation, or forensic examination.
- Mandatory retraining or management counselling.
- Formal disciplinary action, up to and including termination of employment or contract.
- Contractual remedies for third parties, including suspension or termination of services.
- Legal, regulatory, payment brand, acquiring bank, or law enforcement notification where required.
- Corrective and preventive actions, including control enhancements and risk treatment.

Suspected or confirmed violations involving cardholder data, sensitive authentication data, payment systems, CDE systems, authentication secrets, or security control bypass shall be treated as security incidents and handled in accordance with the organisation’s incident response process.

## Exceptions

Exceptions to this policy are not permitted unless formally approved in advance by the [Information Security Officer] and documented through the organisation’s risk exception process.

Exception requests shall include:

| Required Information | Description |
|---|---|
| Requestor | Name, role, department, and contact details of the person requesting the exception |
| Business justification | Specific business need requiring deviation from this policy |
| Scope | Users, systems, data, locations, third parties, and technologies affected |
| PCI DSS impact | Assessment of impact to PCI DSS scope, cardholder data, sensitive authentication data, and CDE security |
| Risk assessment | Identified threats, vulnerabilities, likelihood, impact, and residual risk |
| Compensating or mitigating controls | Controls that reduce risk during the exception period |
| Duration | Start date, expiry date, and required review date |
| Approvals | Required management, information security, compliance, and risk approvals |
| Remediation plan | Actions and timeline to return to compliance |

Exceptions shall:

1. Be limited to the minimum scope and duration necessary.
2. Not permit storage of sensitive authentication data after authorisation unless explicitly allowed by PCI DSS.
3. Not permit uncontrolled or unprotected storage, transmission, or processing of cardholder data.
4. Not materially weaken segmentation, authentication, logging, encryption, vulnerability management, or access control requirements for the CDE unless an approved risk treatment and compensating controls are documented.
5. Be reviewed before expiry and revoked when no longer required.
6. Be retained as evidence for PCI DSS assessment and internal audit purposes.

Emergency deviations required to protect life, safety, critical business operations, or active incident response shall be documented retrospectively as soon as practicable and submitted for formal review within [5 business days].

## Review & Maintenance

The [Information Security Officer] shall review this policy at least once every 12 months and upon significant changes that may affect acceptable use requirements or PCI DSS scope, including:

- Changes to PCI DSS requirements, payment brand rules, acquirer requirements, laws, or regulations.
- Introduction of new payment channels, payment applications, payment terminals, or payment service providers.
- Significant changes to the CDE, network architecture, cloud environments, remote access methods, endpoint platforms, or third-party connectivity.
- Identification of new threats, vulnerabilities, incidents, audit findings, or control weaknesses.
- Material changes to workforce models, remote work practices, outsourcing arrangements, or business processes.
- Changes to technologies used to store, process, transmit, access, administer, monitor, or secure cardholder data.

Review and maintenance activities shall include:

| Activity | Owner | Minimum Frequency | Evidence |
|---|---|---:|---|
| Policy content review | [Information Security Officer] | Annually | Review record, version history |
| PCI DSS alignment review | PCI DSS Compliance Owner | Annually and upon PCI DSS change | Control mapping, assessment notes |
| Stakeholder review | IT, Security Operations, Payment Operations, HR, Legal/Privacy as applicable | Annually | Review comments, approvals |
| User communication | [Information Security Officer] / HR | On update and annually | Communication records |
| User acknowledgement | HR / Compliance | Onboarding, annual, and material change | Acknowledgement records |
| Exception review | [Information Security Officer] | At expiry and at least quarterly for active exceptions | Exception register |
| Enforcement trend review | Security Operations / Compliance | At least quarterly | Metrics, incident summaries, corrective actions |

Policy updates shall be version-controlled, approved by the designated owner or governance body, communicated to applicable users, and retained in accordance with organisational document retention requirements.