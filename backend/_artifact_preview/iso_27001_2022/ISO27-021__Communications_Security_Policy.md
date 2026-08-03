<!-- iso_27001_2022 / ISO27-021 | type=Policy | mode=markdown | model=gpt-5.5 | 28469 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [POL-ISMS-COMSEC-001] | 1.0 | [Information Security Manager] | [YYYY-MM-DD] | ISO/IEC 27001:2022 | Annex A.8.20, A.8.21, A.8.22, A.8.23 | Internal |

## Purpose

This Communications Security Policy establishes mandatory requirements for protecting information in networks and supporting communications services across [Organisation Name]. It supports the implementation and operation of the Information Security Management System (ISMS) in accordance with ISO/IEC 27001:2022.

The purpose of this Policy is to ensure that:

- Networks are designed, implemented, operated and monitored securely.
- Network services are protected and managed in accordance with business and security requirements.
- Networks, systems, users and services are appropriately segregated to reduce the risk of unauthorised access, compromise and lateral movement.
- Information transferred across internal and external networks is protected against unauthorised access, interception, modification, misrouting and loss.
- Access to malicious, inappropriate or unauthorised web content is controlled through web filtering and related security controls.

## Scope

This Policy applies to:

- All employees, contractors, consultants, temporary staff, suppliers and third parties who access or manage [Organisation Name] information, networks, systems or communications services.
- All networks and communications environments owned, operated, managed or used by [Organisation Name], including:
 - Corporate local area networks.
 - Wide area networks.
 - Wireless networks.
 - Remote access networks.
 - Cloud networks and virtual private clouds.
 - Internet connectivity and perimeter services.
 - Data centre and hosting networks.
 - Operational technology, IoT and specialist networks where applicable.
 - Third-party managed network services.
- All information transfer mechanisms, including email, file transfer, application programming interfaces, messaging platforms, collaboration platforms, secure portals, remote access channels and network-to-network integrations.
- All web access from organisation-managed devices, networks or accounts, including access through on-premises, cloud-based or hybrid web security controls.

This Policy applies to production, development, test, disaster recovery and administrative network environments unless explicitly excluded through an approved exception.

## Policy Statements

1. **General Communications Security Requirements**

 1.1. [Organisation Name] shall establish, implement and maintain network security controls appropriate to the confidentiality, integrity and availability requirements of information processed, stored or transmitted across its networks.

 1.2. Network and communications security requirements shall be determined using risk assessment, business requirements, legal and regulatory obligations, contractual obligations and the classification of information being transmitted.

 1.3. Network architecture, connectivity and security controls shall be documented, approved and maintained for all in-scope network environments.

 1.4. Network security controls shall be designed to prevent, detect and respond to unauthorised access, misuse, service disruption, malware propagation, data leakage and unauthorised communication paths.

 1.5. Communications security controls shall follow the principles of least privilege, defence in depth, secure by design, need-to-know access and separation of duties.

 1.6. All network and communications services shall be subject to change management prior to implementation, modification or decommissioning.

 1.7. Security requirements for networks and communications services shall be incorporated into procurement, design, implementation, outsourcing and supplier management activities.

2. **Network Security Management**

 2.1. Network devices, including routers, switches, firewalls, wireless controllers, load balancers, gateways, proxies, VPN concentrators and network security appliances, shall be configured securely in accordance with approved security standards and vendor hardening guidance.

 2.2. Default vendor credentials, unnecessary services, insecure management protocols and unused ports shall be disabled or removed before network devices are connected to production networks.

 2.3. Administrative access to network devices shall be restricted to authorised personnel and shall require strong authentication, including multi-factor authentication where technically feasible and risk-appropriate.

 2.4. Privileged network administration shall be performed through approved secure management channels and shall not be conducted over unencrypted protocols.

 2.5. Network device configurations shall be backed up securely, protected from unauthorised access and retained in accordance with operational and recovery requirements.

 2.6. Network device configuration changes shall be logged, traceable to an authorised individual or service account, and reviewed in accordance with change management requirements.

 2.7. Network devices and network security appliances shall be maintained at supported versions and patched in accordance with the organisation’s vulnerability and patch management requirements.

 2.8. Network time synchronisation shall be implemented using approved time sources to support accurate logging, monitoring and incident investigation.

 2.9. Network availability and capacity shall be monitored to identify degradation, failure, abnormal behaviour and potential security events.

 2.10. Network diagrams shall be maintained to show key communication paths, security boundaries, external connections, trust zones, remote access points, Internet gateways and connections to third parties or cloud environments.

 2.11. Network access shall be controlled and limited to authorised devices, users, services and systems based on business need and risk.

 2.12. Unauthorised network devices, rogue wireless access points, unauthorised modems, unauthorised network bridges and unauthorised remote access mechanisms shall be prohibited.

3. **Security of Network Services**

 3.1. Network services shall be approved before use and shall be managed to ensure they meet security, availability, resilience and performance requirements.

 3.2. Network services provided internally or by external suppliers shall be covered by documented service requirements, including security controls, service levels, monitoring expectations and incident reporting obligations.

 3.3. The security features, service levels and management requirements of network services shall be identified and included in agreements with network service providers.

 3.4. Network services shall be configured to permit only approved protocols, ports, destinations and communication flows required for legitimate business purposes.

 3.5. Insecure or obsolete network protocols shall be prohibited unless explicitly approved through the exception process and protected by compensating controls.

 3.6. Remote access services shall use approved secure technologies, strong authentication, encryption and access controls appropriate to the sensitivity of accessible systems and information.

 3.7. Third-party network access shall be restricted to authorised services and systems, time-bound where practicable, monitored, and subject to contractual security requirements.

 3.8. Internet-facing services shall be protected by appropriate perimeter controls, which may include firewalls, web application firewalls, denial-of-service protection, intrusion detection or prevention, secure gateways and continuous monitoring.

 3.9. Network services supporting critical business processes shall be designed with resilience, redundancy or recovery capabilities commensurate with business impact and risk appetite.

 3.10. Network service logs shall be collected, protected and reviewed in accordance with logging, monitoring and incident response requirements.

4. **Network Segregation**

 4.1. Networks shall be segregated into logical or physical zones based on business function, trust level, information classification, user group, system criticality, regulatory requirement and risk exposure.

 4.2. Segregation controls shall be used to restrict communication between network zones to authorised and documented traffic only.

 4.3. Segregation shall be enforced using appropriate mechanisms, which may include firewalls, virtual local area networks, software-defined networking controls, access control lists, micro-segmentation, identity-based access controls, cloud security groups or equivalent technologies.

 4.4. Production environments shall be segregated from development, test, training and laboratory environments unless a documented and approved business requirement exists.

 4.5. Administrative networks and privileged access pathways shall be segregated from standard user networks and general-purpose Internet access where technically feasible.

 4.6. Guest, public and unmanaged device networks shall be segregated from corporate networks and shall not provide direct access to internal systems unless explicitly authorised and controlled.

 4.7. Wireless networks shall be segregated according to user type and risk, including separate controls for corporate, guest, third-party and unmanaged device access.

 4.8. Critical systems, high-value assets and systems processing sensitive or regulated information shall be placed in protected network zones with enhanced access control, monitoring and logging.

 4.9. Cloud networks shall be segregated using approved cloud-native or third-party controls and shall follow the same principles of zoning, least privilege and controlled connectivity as on-premises networks.

 4.10. Network segmentation rules shall be reviewed periodically and when significant changes occur to confirm continued business need and appropriateness.

 4.11. Exceptions to required segregation shall be risk assessed, formally approved and supported by compensating controls.

5. **Information Transfer Security**

 5.1. Information transferred over internal networks, external networks, public networks or third-party networks shall be protected according to its classification, sensitivity and business impact.

 5.2. Confidential, restricted, regulated or otherwise sensitive information shall be transferred only through approved secure transfer methods.

 5.3. Approved transfer methods shall provide appropriate protection against unauthorised disclosure, modification, loss, misdelivery, interception and repudiation.

 5.4. Sensitive information shall not be transferred using unauthorised personal email accounts, consumer file-sharing services, unapproved messaging platforms, removable media or unmanaged transfer mechanisms.

 5.5. Encryption shall be used for the transfer of sensitive information over untrusted or public networks unless an approved exception is in place.

 5.6. Information transfer arrangements with external parties shall be documented and shall define authorised transfer methods, security controls, responsibilities, retention requirements, incident reporting requirements and permitted recipients.

 5.7. Automated system-to-system transfers, including APIs, batch transfers, replication and integrations, shall be authenticated, authorised, logged and protected against unauthorised access or tampering.

 5.8. File transfer services shall enforce access controls, secure authentication, encryption in transit, malware scanning where applicable, logging and retention controls.

 5.9. Email-based transfer of sensitive information shall use approved security controls such as encryption, secure mail gateways, data loss prevention, recipient verification or secure portal delivery.

 5.10. Users shall verify recipient details before transferring sensitive information externally.

 5.11. Misrouted, unauthorised or suspected compromised information transfers shall be reported immediately through the information security incident reporting process.

 5.12. The following minimum transfer requirements shall apply unless stricter requirements are defined by law, contract or data classification standards:

 | Information Type | Minimum Approved Transfer Method | Minimum Security Requirements |
 |---|---|---|
 | Public information | Approved business communication channels | Recipient validation where appropriate |
 | Internal information | Corporate email, approved collaboration platform or approved file transfer service | Organisation-managed account, access control and logging |
 | Confidential information | Secure file transfer service, encrypted email, secure portal or approved encrypted collaboration platform | Encryption in transit, access control, recipient validation and audit logging |
 | Restricted or regulated information | Approved secure transfer service or secure system-to-system integration | Encryption in transit, strong authentication, least privilege access, logging, retention control and contractual safeguards where externally transferred |
 | Credentials, secrets or cryptographic material | Approved secrets management or privileged access management solution | Encryption, access restriction, audit logging and prohibition on plain-text transfer |

6. **Web Filtering and Internet Access Control**

 6.1. Web access from organisation-managed networks, accounts and devices shall be routed through approved web filtering, secure web gateway, DNS filtering, endpoint security, browser isolation or equivalent controls where technically feasible.

 6.2. Web filtering controls shall be configured to reduce exposure to malicious, fraudulent, unauthorised or inappropriate web content.

 6.3. The organisation shall block or restrict access to websites and Internet services that present unacceptable security, legal, regulatory or business risk.

 6.4. Web filtering shall include controls for known malicious domains, phishing sites, malware distribution sites, command-and-control infrastructure, anonymisation services, unauthorised file-sharing services and other prohibited categories.

 6.5. Access to newly registered domains, uncategorised sites, high-risk geographies or high-risk web categories shall be restricted or monitored based on risk and business need.

 6.6. Users shall not attempt to bypass web filtering, proxy, DNS, endpoint, remote access or monitoring controls.

 6.7. Privileged users and administrators shall not use privileged workstations or administrative sessions for general web browsing unless explicitly authorised and controlled.

 6.8. Web filtering exceptions shall be time-bound, justified by business need, risk assessed and approved in accordance with this Policy.

 6.9. Web access logs shall be collected and monitored in accordance with legal, privacy, employment and security monitoring requirements.

 6.10. Where encrypted web traffic inspection is used, it shall be implemented in accordance with applicable laws, privacy requirements, technical feasibility and documented risk decisions.

 6.11. The following baseline web access categories shall apply unless varied through approved exception or documented risk decision:

 | Web Category | Default Access Position | Rationale |
 |---|---|---|
 | Malware, phishing and command-and-control | Block | Prevent compromise and data loss |
 | Illegal content | Block | Legal and regulatory compliance |
 | Credential harvesting and fraud | Block | Protect users and authentication assets |
 | Unauthorised anonymisers, proxies and circumvention tools | Block | Prevent bypass of security controls |
 | Unauthorised file sharing and software download sites | Block or restrict | Reduce malware, data leakage and licence risk |
 | Newly registered or uncategorised domains | Restrict or monitor | Elevated phishing and malware risk |
 | Business-relevant cloud and collaboration services | Allow where approved | Support authorised business activity |
 | Personal webmail and personal storage | Restrict based on risk | Reduce data leakage and malware exposure |
 | Adult, gambling or hate/extremist content | Block unless legally required otherwise | Workplace, legal and reputational risk |

7. **Wireless Communications Security**

 7.1. Wireless networks shall be authorised, documented and protected using approved authentication and encryption standards.

 7.2. Corporate wireless access shall require unique user or device authentication and shall not rely solely on shared passwords where stronger authentication is technically feasible.

 7.3. Guest wireless access shall be segregated from internal corporate networks and shall provide no direct access to internal systems unless separately authorised and controlled.

 7.4. Wireless encryption protocols that are obsolete or insecure shall be prohibited.

 7.5. Wireless coverage, access points and security configurations shall be reviewed periodically to identify unauthorised or misconfigured wireless services.

8. **External Connections and Third-Party Communications**

 8.1. External network connections, including third-party links, supplier access, cloud connectivity, partner integrations and remote administration channels, shall be authorised, documented and risk assessed before implementation.

 8.2. External connections shall be limited to approved business purposes and shall be protected using appropriate authentication, encryption, network segregation and monitoring controls.

 8.3. External connections shall be reviewed periodically to confirm continued business need, ownership and security appropriateness.

 8.4. Third parties shall not create, modify or extend network connectivity without prior written authorisation from [Organisation Name].

 8.5. Contracts or agreements for third-party communications services shall include applicable security requirements, service levels, incident notification requirements, right to audit or assurance provisions, and termination or decommissioning requirements.

9. **Logging, Monitoring and Detection**

 9.1. Security-relevant network and communications events shall be logged to support monitoring, investigation, forensic analysis and compliance.

 9.2. Logs shall be protected against unauthorised access, modification and deletion.

 9.3. Network security events shall be monitored for indicators of compromise, unauthorised access, policy violation, data exfiltration, malware activity and unusual traffic patterns.

 9.4. Alerts from network security controls shall be triaged and escalated in accordance with the incident management process.

 9.5. Monitoring shall be proportionate, lawful and aligned with privacy, employment and regulatory requirements.

10. **Minimum Technical Control Baseline**

 10.1. The following minimum communications security controls shall be implemented unless a documented risk assessment and approved exception justify an alternative:

 | Control Area | Minimum Requirement | Typical Control Examples |
 |---|---|---|
 | Network perimeter | Restrict inbound and outbound traffic to authorised flows | Firewalls, gateways, cloud security groups |
 | Network administration | Secure, restricted administrative access | MFA, bastion hosts, privileged access management, encrypted management protocols |
 | Network segregation | Separate networks by trust, function and sensitivity | VLANs, firewalls, micro-segmentation, cloud network segmentation |
 | Internet access | Filter and monitor web access | Secure web gateway, DNS filtering, proxy, endpoint web control |
 | Remote access | Authenticate and encrypt remote connections | VPN, zero trust network access, MFA |
 | Information transfer | Protect sensitive data in transit | TLS, SFTP, secure portals, encrypted email |
 | External connectivity | Authorise and monitor third-party connections | Site-to-site VPN, private links, supplier access controls |
 | Logging and monitoring | Collect and review security events | SIEM, network detection and response, firewall logs |
 | Wireless access | Secure and segregate wireless networks | WPA3/WPA2-Enterprise, NAC, separate guest networks |

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board / Executive Management | Provide oversight and support for communications security objectives, risk treatment and required investment. |
| Senior Management | Ensure communications security requirements are implemented within their business areas and that personnel comply with this Policy. |
| Information Security Manager | Own this Policy, define communications security requirements, advise on risk treatment, monitor compliance and report material risks. |
| Network / Infrastructure Team | Design, implement, maintain and monitor secure network infrastructure, network services, segregation controls, web filtering and communications security technologies. |
| Cloud / Platform Team | Implement secure cloud networking, segmentation, connectivity, logging and transfer controls in cloud and platform environments. |
| IT Operations | Operate approved communications services, manage changes, maintain availability and ensure secure configuration of supporting services. |
| System Owners | Define business requirements for network access, information transfer and external connectivity; approve access based on business need. |
| Data Owners | Define protection requirements for information transfers based on classification, sensitivity and legal or contractual obligations. |
| Procurement / Supplier Management | Ensure contracts for network and communications services include applicable security requirements and supplier assurance obligations. |
| Legal / Privacy Function | Advise on lawful monitoring, privacy considerations, cross-border transfers and regulatory requirements affecting communications security. |
| Users | Use only approved communications services, protect information during transfer, comply with web filtering controls and report suspected incidents. |
| Third Parties | Comply with agreed communications security requirements, use only authorised connection methods and report incidents within agreed timeframes. |
| Internal Audit / Compliance | Independently assess compliance with this Policy and related ISO/IEC 27001:2022 control requirements. |

## Compliance, Monitoring & Enforcement

Compliance with this Policy is mandatory.

[Organisation Name] shall monitor compliance through a combination of technical monitoring, management review, assurance activities and audit. Monitoring activities shall be risk-based and proportionate to the sensitivity and criticality of networks, services and information.

The following compliance and monitoring activities shall be performed:

| Activity | Minimum Frequency | Responsible Role | Evidence |
|---|---:|---|---|
| Review of network architecture and security boundaries | At least annually and after significant change | Network / Infrastructure Team | Network diagrams, architecture review records |
| Firewall and network access rule review | At least quarterly for critical environments; at least annually for other environments | Network / Infrastructure Team / System Owners | Rule review records, approval evidence |
| External connection review | At least annually | Information Security Manager / Network Team | Connection inventory, business owner attestation |
| Web filtering policy review | At least annually and after material threat changes | Information Security Manager / IT Operations | Filtering configuration, category review records |
| Network device configuration compliance review | At least annually or via continuous compliance tooling | Network / Infrastructure Team | Configuration baseline reports |
| Review of privileged network administration access | At least quarterly | IT Operations / Information Security Manager | Access review evidence |
| Vulnerability review of network devices and services | In accordance with vulnerability management requirements | IT Operations / Security Operations | Vulnerability scan reports, remediation records |
| Monitoring of network security events | Continuous where supported | Security Operations / IT Operations | SIEM alerts, incident tickets, investigation records |
| Testing of critical network resilience or recovery controls | At least annually where applicable | Infrastructure Team / Business Continuity Lead | Test plans, results, remediation actions |
| Review of information transfer arrangements with external parties | At least annually or upon contract change | Data Owners / Supplier Management | Transfer register, agreements, risk assessments |

Non-compliance with this Policy may result in one or more of the following actions:

- Immediate suspension or restriction of network, web or communications access.
- Revocation of privileged access.
- Mandatory remediation within defined timeframes.
- Formal risk acceptance by an authorised risk owner.
- Supplier corrective action or contractual remedies.
- Disciplinary action in accordance with [Organisation Name] HR policies.
- Reporting to regulatory, contractual or legal authorities where required.

Security incidents, suspected policy violations or unauthorised communications activity shall be reported through the approved incident reporting process immediately or as soon as practicable.

## Exceptions

Exceptions to this Policy shall be permitted only where there is a documented business requirement and the associated risk has been assessed, approved and recorded.

All exceptions shall:

1. Be requested using the approved exception process.
2. Identify the specific Policy requirement for which exception is requested.
3. Include business justification.
4. Include risk assessment and impact analysis.
5. Define compensating controls.
6. Specify an expiry date or review date.
7. Be approved by the appropriate risk owner and the Information Security Manager.
8. Be recorded in the exceptions register.
9. Be reviewed at least by the expiry date or upon material change.

Standing or indefinite exceptions shall not be permitted unless explicitly approved by [Executive Risk Committee or equivalent] and reviewed at least annually.

The following minimum approval levels shall apply:

| Exception Type | Example | Minimum Approval |
|---|---|---|
| Low-risk, time-bound operational exception | Temporary access to a restricted website for business research | Information Security Manager |
| Network rule or segmentation exception | Temporary firewall rule between controlled internal zones | System Owner and Information Security Manager |
| External connectivity exception | New third-party connection or deviation from approved connection standard | Business Owner, Information Security Manager and Network Owner |
| Sensitive information transfer exception | Use of non-standard transfer mechanism for confidential data | Data Owner, Information Security Manager and Legal / Privacy where applicable |
| High-risk or long-term exception | Use of insecure protocol, unsupported network device or permanent segmentation bypass | Senior Risk Owner / [Executive Risk Committee] |

Expired exceptions shall be remediated, renewed through reassessment or escalated as policy non-compliance.

## Review & Maintenance

This Policy shall be reviewed at least annually and whenever significant changes occur that may affect communications security requirements, including:

- Changes to ISO/IEC 27001:2022 requirements or related control guidance.
- Material changes to network architecture, cloud environments or communications services.
- Introduction of new remote access, web access, network service or information transfer technologies.
- Significant security incidents involving networks, web access, external connectivity or information transfer.
- Changes to legal, regulatory, contractual or privacy obligations.
- Results from audits, risk assessments, vulnerability assessments or management reviews.
- Changes in threat landscape affecting network security, web filtering or communications protection.

The Information Security Manager shall coordinate the review and update of this Policy. Updates shall be approved in accordance with the ISMS document control process.

Previous versions of this Policy shall be retained in accordance with [Organisation Name] document retention requirements.