<!-- iso_27001_2022 / ISO27-018 | type=Policy | mode=markdown | model=gpt-5.5 | 24795 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [POL-CRY-001] | 1.0 | [Information Security Manager] | [YYYY-MM-DD] | ISO/IEC 27001:2022 | Annex A.8.24 — Use of Cryptography | Internal |

## Purpose

The purpose of this Cryptography Policy is to establish mandatory requirements for the appropriate and effective use of cryptography and cryptographic key management to protect the confidentiality, integrity, authenticity, and non-repudiation of information assets.

This Policy supports the organisation’s implementation of ISO/IEC 27001:2022 Annex A.8.24 by ensuring cryptographic controls are selected, implemented, operated, and managed in a controlled manner based on business requirements, legal and regulatory obligations, risk assessment outcomes, and recognised industry standards.

## Scope

This Policy applies to:

- All employees, contractors, consultants, third parties, and service providers who design, develop, administer, operate, or use systems processing organisation information.
- All information assets owned, managed, processed, stored, transmitted, or otherwise handled by or on behalf of the organisation.
- All systems, applications, databases, networks, endpoints, mobile devices, removable media, cloud services, backup media, APIs, and communications channels where cryptographic protection is required.
- All cryptographic technologies, including encryption, hashing, digital signatures, message authentication codes, key exchange mechanisms, certificates, tokens, secrets, and cryptographic modules.
- All cryptographic keys and secrets throughout their lifecycle, including generation, distribution, storage, use, rotation, backup, archival, revocation, destruction, and recovery.

This Policy applies to information in all forms, including electronic data, system credentials, authentication secrets, cryptographic keys, certificates, backups, logs, and data transmitted between internal systems, external parties, and cloud services.

## Policy Statements

1. The organisation shall use cryptography to protect information assets where required by risk assessment, legal, regulatory, contractual, business, or information classification requirements.

2. The organisation shall ensure that cryptographic controls are selected and implemented in alignment with the organisation’s information classification scheme, risk treatment plans, and applicable security architecture standards.

3. The organisation shall use cryptographic algorithms, protocols, key lengths, and configurations that are recognised as secure by authoritative standards bodies or industry best practice, such as NIST, ENISA, ISO/IEC, or equivalent recognised authorities.

4. The organisation shall prohibit the use of deprecated, weak, obsolete, or insecure cryptographic algorithms and protocols, including but not limited to MD5, SHA-1 for digital signatures, DES, 3DES, RC4, SSL, TLS 1.0, TLS 1.1, and unauthorised proprietary cryptographic mechanisms.

5. The organisation shall use approved cryptographic controls to protect confidential or sensitive information at rest, including data stored in databases, file repositories, cloud storage, endpoints, mobile devices, removable media, and backup media.

6. The organisation shall use approved cryptographic controls to protect confidential or sensitive information in transit over untrusted or public networks, including internet communications, wireless networks, remote access connections, APIs, email gateways, file transfers, and inter-system integrations.

7. The organisation shall ensure that administrative access, privileged access, remote access, and service-to-service communications use secure cryptographic protocols and strong authentication mechanisms.

8. The organisation shall implement encryption for removable media and portable devices that store organisation information unless explicitly prohibited by operational constraints and approved through the exception process.

9. The organisation shall ensure that cryptographic controls used for integrity, authentication, and non-repudiation, including hashing, digital signatures, message authentication codes, and certificates, are appropriate to the risk and business requirement.

10. The organisation shall maintain an approved cryptographic standards register defining permitted algorithms, protocols, cipher suites, key lengths, certificate requirements, and usage restrictions.

11. The organisation shall ensure cryptographic keys are managed throughout their full lifecycle in accordance with documented key management requirements.

12. The organisation shall generate cryptographic keys using approved random number generation methods and trusted cryptographic libraries, services, hardware security modules, or key management platforms.

13. The organisation shall prohibit manual generation or ad hoc creation of cryptographic keys unless specifically approved by the Information Security function and implemented using an approved secure method.

14. The organisation shall ensure cryptographic keys are unique to their intended purpose and are not reused across incompatible systems, environments, applications, tenants, or trust boundaries.

15. The organisation shall ensure cryptographic keys are stored securely using approved mechanisms such as hardware security modules, cloud key management services, secrets management platforms, trusted platform modules, encrypted key stores, or equivalent protected facilities.

16. The organisation shall ensure private keys, symmetric keys, secrets, and certificate signing keys are protected against unauthorised access, disclosure, modification, substitution, export, and destruction.

17. The organisation shall restrict access to cryptographic keys and key management systems to authorised personnel and service accounts based on least privilege, role-based access, and segregation of duties.

18. The organisation shall ensure access to cryptographic key management systems is authenticated, authorised, logged, and monitored.

19. The organisation shall not store cryptographic keys in source code repositories, scripts, configuration files, container images, build artifacts, plaintext documentation, tickets, collaboration tools, or other unauthorised locations.

20. The organisation shall not transmit cryptographic keys or secrets using insecure channels, including unencrypted email, messaging platforms, or unauthorised file-sharing services.

21. The organisation shall rotate cryptographic keys and certificates at defined intervals, upon suspected compromise, upon personnel or supplier change where relevant, and when required by legal, regulatory, contractual, or technical requirements.

22. The organisation shall revoke, disable, or destroy cryptographic keys and certificates when they are no longer required, have expired, are suspected of compromise, or are associated with decommissioned systems or terminated services.

23. The organisation shall maintain records of key ownership, purpose, system association, creation date, expiry date, rotation schedule, custodians, and status for critical cryptographic keys and certificates.

24. The organisation shall ensure key backup and recovery mechanisms are implemented where loss of keys could result in loss of access to business-critical information or services.

25. The organisation shall ensure key backup copies receive equivalent or stronger protection than operational keys.

26. The organisation shall ensure escrow, recovery, or emergency access to keys is implemented only where authorised, documented, access-controlled, and aligned with legal, regulatory, and contractual obligations.

27. The organisation shall ensure cryptographic controls are implemented in a manner that supports required logging, monitoring, forensic investigation, lawful access, eDiscovery, and business continuity requirements.

28. The organisation shall ensure cryptographic products, libraries, and services are configured securely and kept current with vendor-supported versions and security patches.

29. The organisation shall ensure cryptographic implementations in internally developed software are reviewed through secure design, secure coding, and security testing activities before production release.

30. The organisation shall prohibit the development or deployment of custom cryptographic algorithms or unauthorised modifications to approved cryptographic mechanisms.

31. The organisation shall ensure certificates issued by public or private certificate authorities are managed through an approved certificate lifecycle process, including issuance, validation, renewal, revocation, and expiry monitoring.

32. The organisation shall ensure certificate expiry is monitored to prevent service disruption or degraded security due to expired, invalid, or misconfigured certificates.

33. The organisation shall ensure cryptographic controls used in cloud services are configured in accordance with the organisation’s cloud security requirements, including appropriate key ownership, key custody, tenant separation, and access logging.

34. The organisation shall ensure customer-managed keys, bring-your-own-key, or hold-your-own-key arrangements are assessed and approved where required by business, regulatory, or contractual obligations.

35. The organisation shall ensure cryptographic requirements are included in supplier, outsourcing, and third-party service arrangements where suppliers process, store, transmit, or protect organisation information.

36. The organisation shall ensure third-party cryptographic services provide appropriate assurance, including documented security controls, compliance attestations, access controls, key protection measures, and incident notification obligations.

37. The organisation shall comply with all applicable laws and regulations governing the import, export, use, disclosure, and retention of cryptographic technology and encrypted information.

38. The organisation shall ensure cryptographic controls do not conflict with applicable legal, regulatory, contractual, or operational requirements, including lawful monitoring, audit logging, data retention, and incident investigation.

39. The organisation shall ensure cryptographic requirements are considered during system acquisition, development, architecture design, cloud onboarding, data classification, supplier selection, and change management.

40. The organisation shall ensure changes to cryptographic algorithms, protocols, keys, certificates, libraries, or configurations are managed through approved change management processes.

41. The organisation shall ensure cryptographic failures, key compromise, certificate misuse, unauthorised key access, or suspected weaknesses are reported and managed as information security incidents.

42. The organisation shall ensure cryptographic controls are tested and validated periodically to confirm effectiveness, correct configuration, and alignment with this Policy.

43. The organisation shall define and maintain minimum cryptographic requirements as follows unless superseded by approved cryptographic standards or stronger regulatory requirements:

| Cryptographic Use Case | Minimum Requirement | Mandatory Condition |
|---|---|---|
| Data in transit over untrusted networks | TLS 1.2 minimum; TLS 1.3 preferred | Weak protocols and cipher suites shall be disabled |
| Administrative remote access | Encrypted protocol with strong authentication | Plaintext protocols shall be prohibited |
| Data at rest on endpoints | Full disk encryption or equivalent | Required for laptops and portable devices |
| Removable media | Approved media encryption | Required before storing organisation information |
| Password storage | Salted, adaptive one-way hashing | Reversible encryption of passwords shall be prohibited unless approved for a specific technical requirement |
| Digital signatures | Approved asymmetric algorithms and trusted certificates | Required where authenticity or non-repudiation is mandated |
| Backups containing sensitive information | Encryption before storage or transfer | Required for offsite, cloud, or removable backup storage |
| Cryptographic key storage | Approved key management or secrets management platform | Plaintext key storage shall be prohibited |
| Public certificates | Validated certificate authority issuance | Self-signed certificates shall not be used for public-facing production services unless approved by exception |
| APIs and service integrations | Encrypted transport and approved authentication | Shared secrets shall be stored in approved secrets management systems |

44. The organisation shall define key rotation and certificate renewal requirements appropriate to risk, system criticality, algorithm strength, regulatory obligations, and operational dependency.

| Key or Certificate Type | Maximum Validity / Rotation Interval | Additional Requirement |
|---|---:|---|
| Public TLS certificates | 398 days or less, or current industry requirement | Renewal monitoring required before expiry |
| Internal TLS certificates | [Defined period, e.g., 12–24 months] | Must be inventoried and monitored |
| Symmetric data encryption keys | [Defined period, e.g., annually] or upon compromise | Rotation plan required for critical systems |
| Key encryption keys | [Defined period, e.g., annually] or upon compromise | Access strictly restricted |
| Signing keys | Based on risk and certificate authority requirements | Strong protection required |
| API secrets and tokens | [Defined period, e.g., 90–180 days] or upon compromise | Stored only in approved secrets management systems |
| Privileged service account secrets | [Defined period, e.g., 90 days] or upon role/system change | Rotation must be auditable |
| Backup encryption keys | Based on retention and recovery requirements | Recovery testing required |

45. The organisation shall classify cryptographic keys and secrets as sensitive security information and protect them at least at the same classification level as the information or systems they protect.

46. The organisation shall ensure loss, corruption, or destruction of cryptographic keys does not compromise required availability of critical business information unless such loss is an approved and documented security design outcome.

47. The organisation shall ensure personnel with cryptographic administration responsibilities receive appropriate training on secure key handling, approved tools, legal obligations, and incident reporting.

48. The organisation shall ensure cryptographic requirements are documented, traceable, and auditable for systems where cryptography is used to meet security, privacy, legal, regulatory, or contractual obligations.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board / Executive Management | Provide oversight and support for the use of cryptographic controls as part of the organisation’s information security and risk management programme. |
| Information Security Manager | Own this Policy; define cryptographic requirements; approve cryptographic standards; monitor compliance; review exceptions; report significant cryptographic risks. |
| Chief Information Officer / IT Leadership | Ensure cryptographic controls are implemented across technology services, infrastructure, applications, and operations in accordance with this Policy. |
| Enterprise / Security Architects | Define secure cryptographic architecture patterns; ensure cryptography is incorporated into system designs; review proposed cryptographic implementations. |
| System Owners | Identify systems requiring cryptographic protection; ensure keys and certificates are managed; ensure compliance with approved standards and lifecycle requirements. |
| Data Owners | Define protection requirements for information based on classification, legal, regulatory, contractual, and business needs. |
| IT Operations / Infrastructure Teams | Implement and maintain encryption, certificate management, key storage, protocol hardening, backup encryption, endpoint encryption, and related operational controls. |
| Application Development Teams | Use approved cryptographic libraries and protocols; avoid custom cryptography; protect secrets; implement secure coding practices for cryptographic functions. |
| Cloud Platform Teams | Configure cloud encryption, key management, secrets management, logging, and access controls in accordance with approved cloud security requirements. |
| Identity and Access Management Team | Ensure privileged access to key management systems and secrets stores is controlled, reviewed, and monitored. |
| Procurement / Vendor Management | Ensure supplier agreements include applicable cryptographic protection, key management, compliance, and incident notification requirements. |
| Legal / Compliance | Advise on legal, regulatory, contractual, import/export, data retention, lawful access, and jurisdictional requirements relating to cryptography. |
| Internal Audit | Independently assess compliance with this Policy and the effectiveness of cryptographic controls as part of the audit programme. |
| Users | Use only approved tools and services for encrypted storage and transmission; protect credentials, tokens, and secrets; report suspected cryptographic incidents. |
| Third Parties / Service Providers | Comply with contractual cryptographic requirements and protect organisation information and keys in accordance with this Policy and agreed security obligations. |

## Compliance, Monitoring & Enforcement

Compliance with this Policy shall be mandatory for all in-scope personnel, systems, services, and third parties.

The organisation shall monitor compliance through a combination of technical controls, management review, assurance activities, and audit processes, including:

- Periodic review of cryptographic standards, protocols, and algorithms.
- Vulnerability scanning and configuration assessment for weak encryption, deprecated protocols, and insecure cipher suites.
- Review of endpoint, server, database, cloud, and backup encryption status.
- Monitoring of certificate inventory, expiry, renewal, revocation, and misconfiguration.
- Access review of key management systems, certificate authorities, and secrets management platforms.
- Review of key rotation, revocation, backup, and destruction records.
- Secure configuration reviews for systems using cryptography.
- Cloud security posture assessments for encryption and key management settings.
- Source code and CI/CD pipeline reviews for embedded secrets or insecure cryptographic implementation.
- Supplier assurance reviews where third parties provide cryptographic processing, encryption, key custody, or certificate services.
- Incident analysis for cryptographic failures, key compromise, unauthorised key access, or certificate misuse.
- Internal and external audits against ISO/IEC 27001:2022 and related control requirements.

Minimum compliance evidence shall include, where applicable:

| Evidence Type | Description | Minimum Review Frequency |
|---|---|---:|
| Cryptographic Standards Register | Approved algorithms, protocols, key lengths, certificate requirements, and prohibited mechanisms | Annually or upon material change |
| Key and Certificate Inventory | Record of critical keys, certificates, owners, expiry dates, rotation schedules, and status | Quarterly |
| Encryption Configuration Records | Evidence of encryption for endpoints, databases, storage, backups, and cloud services | Quarterly |
| Certificate Expiry Reports | Report of certificates approaching expiry or requiring renewal | Monthly |
| Key Management Access Reviews | Review of privileged access to key management and secrets management platforms | Quarterly |
| Key Rotation Records | Evidence of key and secret rotation according to defined requirements | Quarterly |
| Vulnerability and Configuration Scan Results | Identification of weak protocols, cipher suites, libraries, or misconfigurations | At least quarterly |
| Supplier Assurance Evidence | Evidence of third-party cryptographic controls and key protection | Annually or contract renewal |
| Exception Register | Approved deviations from this Policy, including compensating controls and expiry dates | Monthly |
| Incident Records | Records of cryptographic incidents, investigations, and remediation actions | As incidents occur |

Non-compliance with this Policy shall be addressed through the organisation’s risk management, incident management, supplier management, or disciplinary processes, as appropriate.

Where non-compliance creates unacceptable risk, the organisation shall require timely remediation, which may include disabling insecure protocols, rotating or revoking keys, replacing certificates, removing embedded secrets, blocking insecure services, restricting access, or suspending affected systems or supplier services.

Intentional misuse, unauthorised disclosure, unauthorised export, unauthorised destruction, or negligent handling of cryptographic keys or protected information may result in disciplinary action up to and including termination of employment or contract, legal action, and notification to relevant authorities where required.

## Exceptions

Exceptions to this Policy shall be permitted only where there is a documented business, technical, legal, or operational justification and where the associated risk has been assessed and formally accepted by authorised management.

All exceptions shall be submitted using the organisation’s exception management process and shall include, at minimum:

| Exception Requirement | Description |
|---|---|
| Requestor | Name and role of the individual requesting the exception |
| Affected System or Service | System, application, platform, supplier, or process impacted |
| Policy Requirement | Specific Policy statement or cryptographic standard from which exception is requested |
| Business Justification | Reason the requirement cannot currently be met |
| Risk Assessment | Security, privacy, legal, regulatory, contractual, and operational risk impact |
| Compensating Controls | Controls implemented to reduce risk during the exception period |
| Remediation Plan | Actions required to achieve compliance |
| Exception Owner | Accountable owner responsible for remediation |
| Expiry Date | Date by which the exception must be remediated or renewed |
| Approvals | Required approvals from Information Security, Risk Owner, System Owner, and other relevant authorities |

Exceptions shall:

- Be approved before implementation or continued operation of the non-compliant condition.
- Be time-bound and assigned an expiry date.
- Include compensating controls proportionate to the risk.
- Be recorded in the exception register.
- Be reviewed at least monthly until closure.
- Not be granted for prohibited cryptographic mechanisms where legal, regulatory, or unacceptable security risk exists unless approved by executive risk acceptance.
- Be revoked if the risk increases, compensating controls fail, or remediation milestones are not met.

Emergency exceptions may be granted to maintain critical business operations, provided that they are documented retrospectively within [defined timeframe, e.g., 5 business days], reviewed by the Information Security Manager, and assigned a remediation plan.

## Review & Maintenance

This Policy shall be reviewed at least annually and whenever significant changes occur that may affect cryptographic requirements, including:

- Changes to ISO/IEC 27001:2022 requirements or related standards.
- Changes to applicable legal, regulatory, contractual, or industry requirements.
- Discovery of weaknesses in approved algorithms, protocols, libraries, certificates, or cryptographic products.
- Publication of new industry guidance affecting cryptographic strength or implementation.
- Significant changes to the organisation’s technology environment, cloud services, architecture, or threat landscape.
- Introduction of new systems, products, suppliers, or services requiring cryptographic protection.
- Cryptographic incidents, key compromise, certificate failures, or material audit findings.
- Changes to business continuity, disaster recovery, monitoring, or lawful access requirements.

The Information Security Manager shall be responsible for coordinating the review and maintenance of this Policy. Updates shall be approved in accordance with the organisation’s governance process and communicated to relevant stakeholders.

Policy changes shall be version-controlled and retained in accordance with the organisation’s document management and records retention requirements.