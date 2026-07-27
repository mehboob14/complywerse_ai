<!-- iso_27001_2022 / ISO27-022 | type=Policy | mode=markdown | model=gpt-5.5 | 33243 chars -->

| Metadata | Details |
|---|---|
| Document ID | [ISMS-POL-SD-001] |
| Version | 1.0 |
| Owner | [Head of Engineering / CISO] |
| Effective Date | [YYYY-MM-DD] |
| Framework | ISO/IEC 27001:2022 |
| Classification | Internal |

## Purpose

The purpose of this Secure Development Policy is to establish mandatory requirements for the secure design, development, testing, deployment, maintenance, and retirement of information systems and software within the organisation.

This policy supports the implementation of ISO/IEC 27001:2022 Annex A controls A.8.25 to A.8.32 by ensuring that security is embedded throughout the system development life cycle, including secure development practices, application security requirements, secure architecture and engineering principles, secure coding, security testing, outsourced development, separation of development, test and production environments, change control, and protection of test information.

## Scope

This policy applies to:

- All employees, contractors, consultants, temporary workers, service providers, and third parties involved in the development, acquisition, configuration, integration, testing, deployment, support, or maintenance of software, systems, applications, infrastructure-as-code, scripts, APIs, databases, and digital services for or on behalf of the organisation.
- All internally developed, externally developed, open-source, commercial off-the-shelf, low-code/no-code, cloud-hosted, and supplier-managed software and systems that process, store, transmit, or provide access to organisational information.
- All phases of the system development life cycle, including concept, requirements definition, architecture and design, development, configuration, build, testing, deployment, operation, maintenance, enhancement, and decommissioning.
- All development, test, staging, integration, quality assurance, user acceptance, pre-production, production, and disaster recovery environments.

This policy applies regardless of hosting model, including on-premises, cloud, hybrid, SaaS, PaaS, IaaS, containerised, serverless, and managed service environments.

## Policy Statements

1. **Secure Development Life Cycle**

 1.1. The organisation shall define, document, implement, and maintain a secure development life cycle for all systems and software development activities.

 1.2. Security shall be integrated into each phase of the development life cycle, including planning, requirements, design, development, testing, release, operation, and retirement.

 1.3. Projects and product teams shall identify and document information security requirements before development or significant modification begins.

 1.4. Security requirements shall be based on business requirements, legal and regulatory obligations, contractual commitments, information classification, threat landscape, privacy requirements, risk assessment results, and applicable security standards.

 1.5. The secure development life cycle shall include, at minimum:

 | SDLC Phase | Mandatory Security Activities |
 |---|---|
 | Initiation and planning | Security classification, risk assessment, stakeholder identification, regulatory and contractual requirement identification |
 | Requirements | Definition of security, privacy, logging, availability, resilience, authentication, authorisation, cryptography, and data protection requirements |
 | Architecture and design | Secure architecture review, threat modelling, trust boundary identification, security design approval |
 | Development and configuration | Secure coding, peer review, dependency management, secrets management, static analysis where applicable |
 | Testing | Security testing, vulnerability scanning, penetration testing where risk requires, abuse case testing, verification of security requirements |
 | Release and deployment | Security approval, change control, release integrity checks, segregation of duties, rollback planning |
 | Operation and maintenance | Vulnerability management, patching, monitoring, secure change management, periodic review |
 | Retirement | Secure data migration, archival, deletion, access revocation, decommissioning validation |

 1.6. Security acceptance criteria shall be defined for releases and shall be met before deployment to production, unless a formally approved exception exists.

 1.7. Development teams shall maintain evidence of secure development activities, including risk assessments, architecture reviews, code reviews, test results, vulnerability remediation records, release approvals, and exception decisions.

2. **Application Security Requirements**

 2.1. Application security requirements shall be identified, documented, approved, and traceable for all new systems, major changes, and integrations.

 2.2. Application security requirements shall include, as applicable:

 - Authentication and identity management requirements.
 - Authorisation and access control requirements.
 - Session management requirements.
 - Input validation and output encoding requirements.
 - Protection against injection, cross-site scripting, cross-site request forgery, insecure deserialisation, server-side request forgery, and other common application vulnerabilities.
 - Secure API design and access control requirements.
 - Cryptographic protection requirements for data at rest and in transit.
 - Secrets management requirements.
 - Logging, monitoring, and audit trail requirements.
 - Error handling and exception management requirements.
 - Data minimisation, privacy, retention, and secure deletion requirements.
 - Availability, resilience, backup, and recovery requirements.
 - Secure configuration and hardening requirements.
 - Protection against automated abuse, fraud, and misuse where applicable.

 2.3. Security requirements shall be aligned to recognised secure development references, such as OWASP Application Security Verification Standard, OWASP Top 10, CWE Top 25, CIS Benchmarks, NIST Secure Software Development Framework, vendor security guidance, or equivalent standards approved by the Information Security function.

 2.4. Security requirements shall be reviewed and updated when there are material changes to architecture, data sensitivity, business process, threat exposure, legal obligations, or technology stack.

 2.5. User stories, backlog items, epics, technical specifications, or equivalent work items shall include security acceptance criteria where security is relevant to the feature or change.

3. **Secure Architecture and Engineering Principles**

 3.1. Systems shall be designed and engineered using secure architecture principles appropriate to risk, data sensitivity, and business criticality.

 3.2. Secure architecture and engineering principles shall include, at minimum:

 - Defence in depth.
 - Least privilege.
 - Secure by default configuration.
 - Fail securely.
 - Segregation of duties.
 - Separation of environments.
 - Minimisation of attack surface.
 - Zero trust principles where applicable.
 - Strong identity and access management.
 - Explicit trust boundaries.
 - Secure logging and monitoring.
 - Resilience and recoverability.
 - Privacy by design and data minimisation.
 - Use of approved cryptographic mechanisms.
 - Protection of secrets, credentials, keys, and tokens.
 - Secure integration between systems and services.

 3.3. Security architecture reviews shall be performed for new systems, major system changes, internet-facing services, systems processing confidential or restricted information, and systems supporting critical business processes.

 3.4. Threat modelling shall be performed for systems or changes that introduce significant risk, including internet-facing applications, privileged administrative functions, sensitive data processing, new trust boundaries, payment processing, authentication services, or externally exposed APIs.

 3.5. Architecture and design decisions affecting security shall be documented, reviewed, and approved by authorised roles before implementation.

 3.6. The use of cryptography shall comply with the organisation’s cryptographic standards and shall use approved algorithms, protocols, libraries, key lengths, and key management practices.

 3.7. Security controls shall not be removed, bypassed, disabled, or weakened without formal risk acceptance and approval.

4. **Secure Coding**

 4.1. Developers shall follow secure coding standards appropriate to the programming languages, frameworks, platforms, and technologies in use.

 4.2. Secure coding standards shall address, as applicable:

 - Input validation and sanitisation.
 - Output encoding.
 - Authentication and authorisation checks.
 - Session and token handling.
 - Secure error handling.
 - Secure logging without exposure of sensitive data.
 - Protection against injection vulnerabilities.
 - Safe file handling.
 - Secure use of memory and type safety controls.
 - Secure API development.
 - Secure dependency and package management.
 - Secure handling of secrets and credentials.
 - Secure use of cryptographic functions.
 - Race conditions and concurrency risks.
 - Business logic abuse prevention.
 - Secure configuration of frameworks and libraries.

 4.3. Source code shall be stored only in approved source code management repositories with access control, authentication, audit logging, and backup capabilities.

 4.4. Code changes shall be traceable to approved work items, defects, incidents, or change requests.

 4.5. Code shall be peer reviewed prior to merge into protected branches or release branches.

 4.6. Code review shall include consideration of security impacts, adherence to secure coding standards, handling of sensitive information, authentication and authorisation logic, dependency changes, and potential introduction of vulnerabilities.

 4.7. Direct commits to protected branches shall be restricted to authorised maintainers and shall require compensating controls, such as pull request review, automated checks, or documented emergency change approval.

 4.8. Secrets, credentials, private keys, API tokens, certificates, passwords, and other sensitive authentication materials shall not be embedded in source code, configuration files, container images, logs, tickets, documentation, or repositories unless stored using approved secrets management mechanisms.

 4.9. Automated secret scanning shall be implemented for repositories where technically feasible.

 4.10. Discovered secrets in code repositories or build artefacts shall be revoked, rotated, and removed promptly in accordance with incident response and secrets management requirements.

 4.11. Third-party and open-source components shall be selected, approved, tracked, and maintained in accordance with the organisation’s supplier, vulnerability, and software asset management requirements.

 4.12. Development teams shall monitor dependencies for known vulnerabilities and shall remediate or mitigate identified vulnerabilities according to the organisation’s vulnerability remediation timelines.

5. **Security Testing in Development and Acceptance**

 5.1. Security testing shall be planned and performed as part of development, integration, acceptance, and release activities.

 5.2. Security testing shall verify that defined application security requirements have been implemented effectively.

 5.3. Security testing methods shall be selected based on risk, system criticality, exposure, data sensitivity, and change significance, and may include:

 - Static application security testing.
 - Dynamic application security testing.
 - Interactive application security testing.
 - Software composition analysis.
 - Container image scanning.
 - Infrastructure-as-code scanning.
 - API security testing.
 - Configuration and hardening review.
 - Manual secure code review.
 - Threat model validation.
 - Penetration testing.
 - Fuzz testing.
 - Abuse case and misuse case testing.

 5.4. The following minimum security testing expectations shall apply:

 | System or Change Type | Minimum Security Testing Requirement |
 |---|---|
 | Internet-facing applications or APIs | SAST or secure code review, dependency scanning, DAST/API security testing, vulnerability assessment before go-live |
 | Systems processing confidential or restricted information | Security requirements testing, access control testing, logging review, dependency scanning |
 | Major architectural change | Threat model review, architecture security review, targeted security testing |
 | Critical or high-risk systems | Penetration testing or equivalent independent security assessment before initial production release and periodically thereafter |
 | Infrastructure-as-code or containerised workloads | IaC scanning, container image scanning, configuration review |
 | Emergency changes | Post-implementation security review within an approved timeframe |

 5.5. Security testing tools shall be configured, maintained, and reviewed to ensure relevant coverage for the technologies in use.

 5.6. Security defects shall be recorded, risk-rated, tracked to closure, and verified after remediation.

 5.7. Vulnerabilities classified as critical or high shall not be released to production unless remediated or formally risk accepted by authorised management and the Information Security function.

 5.8. Test results, remediation evidence, and release security approvals shall be retained as auditable records.

 5.9. Independent security testing shall be performed where required by risk assessment, regulatory obligation, customer commitment, or material system exposure.

6. **Acceptance Testing and Production Release**

 6.1. New systems and significant changes shall complete acceptance testing before production deployment.

 6.2. Acceptance testing shall confirm that business, functional, security, privacy, operational, resilience, and compliance requirements have been met.

 6.3. Production releases shall be subject to approved change management controls.

 6.4. Release packages, build artefacts, container images, and deployment scripts shall be protected from unauthorised modification.

 6.5. Production deployments shall be performed using approved deployment mechanisms and authorised personnel or service accounts.

 6.6. Build and deployment pipelines shall implement appropriate access controls, logging, segregation of duties, integrity checks, and approval gates based on risk.

 6.7. Rollback or recovery plans shall be defined for production releases where failure could materially affect confidentiality, integrity, availability, or business operations.

 6.8. Production release approval shall include confirmation that security testing, vulnerability remediation, change approval, and operational readiness requirements have been satisfied.

7. **Outsourced Development and Supplier Code**

 7.1. Outsourced development shall be governed through formal agreements that define information security requirements, ownership of deliverables, intellectual property rights, confidentiality, secure development obligations, security testing expectations, vulnerability remediation responsibilities, audit rights, and termination requirements.

 7.2. Suppliers developing, configuring, integrating, or maintaining code for the organisation shall comply with this policy or equivalent secure development requirements approved by the organisation.

 7.3. Supplier-developed code shall be subject to the organisation’s security review, code review, testing, acceptance, and change management requirements before production use.

 7.4. Contracts with development suppliers shall require timely notification of vulnerabilities, security incidents, unauthorised access, malicious code, unsupported components, or material security weaknesses affecting delivered software or services.

 7.5. Suppliers shall provide evidence of secure development practices upon request, which may include secure coding standards, developer training records, security test results, vulnerability remediation records, software bills of materials, penetration test summaries, or independent assurance reports.

 7.6. The organisation shall retain the right to assess supplier development practices where required by risk, contractual obligation, regulatory requirement, or customer commitment.

 7.7. Supplier-provided software, libraries, updates, patches, and code packages shall be obtained only from trusted sources and shall be validated for authenticity and integrity where feasible.

 7.8. Open-source and third-party components shall be assessed for licensing, support status, known vulnerabilities, maintenance activity, provenance, and operational risk before use in production systems.

 7.9. Supplier access to development, test, staging, or production environments shall be authorised, time-bound, monitored, and removed when no longer required.

8. **Separation of Development, Test, and Production Environments**

 8.1. Development, test, staging, and production environments shall be separated to reduce the risk of unauthorised access, unauthorised change, data leakage, service disruption, and accidental modification of production systems.

 8.2. Production data and production systems shall not be used in development or testing unless explicitly approved and protected in accordance with this policy.

 8.3. Access rights shall be assigned separately for development, test, staging, and production environments based on least privilege and job role.

 8.4. Developers shall not have standing privileged access to production environments unless approved based on business need and protected by compensating controls such as privileged access management, monitoring, just-in-time access, segregation of duties, and management approval.

 8.5. Test, development, and staging environments shall not be assumed to have lower security requirements where they process sensitive information, connect to production services, or can affect production integrity.

 8.6. Changes shall be promoted between environments using approved deployment methods and shall not bypass required testing, review, or approval gates.

 8.7. Environment configurations shall be managed to prevent accidental connection of test systems to production data sources, production message queues, production APIs, payment gateways, live customer communications, or external integrations unless formally approved.

 8.8. Monitoring and logging shall be implemented for non-production environments where required by risk, data sensitivity, or regulatory obligation.

 8.9. Access to build systems, deployment systems, package registries, and release artefact repositories shall be controlled and monitored because compromise of these systems may affect production integrity.

9. **Change Management for Systems and Software**

 9.1. Changes to systems, applications, infrastructure, configuration, code, databases, APIs, integrations, pipelines, and security controls shall be managed through approved change management processes.

 9.2. Changes shall be assessed for information security impact before implementation.

 9.3. Change records shall include, as applicable:

 | Change Record Element | Requirement |
 |---|---|
 | Description | Clear description of the proposed change |
 | Business justification | Reason for change and expected outcome |
 | Risk assessment | Security, privacy, operational, and compliance impact |
 | Testing evidence | Functional, regression, security, and acceptance test results |
 | Implementation plan | Deployment steps, timing, dependencies, and responsible parties |
 | Backout plan | Rollback or recovery approach |
 | Approval | Authorised business, technical, change, and security approvals where required |
 | Post-implementation review | Confirmation that the change achieved expected outcomes and did not introduce unacceptable risk |

 9.4. Emergency changes shall be permitted only where necessary to restore service, address urgent security risk, meet critical business needs, or prevent significant impact.

 9.5. Emergency changes shall be documented, reviewed, and retrospectively approved within [defined number] business days.

 9.6. Unauthorised changes to production systems, source code, release artefacts, build pipelines, or security controls shall be treated as security events and investigated.

 9.7. Changes to production systems shall be logged and attributable to an authorised individual, service account, or automated process.

10. **Protection of Test Information**

 10.1. Test data shall be selected, generated, protected, retained, and disposed of in accordance with information classification, privacy, legal, contractual, and business requirements.

 10.2. Production data shall not be copied to development, test, staging, training, troubleshooting, demonstration, or supplier environments unless there is a documented business need, risk assessment, approval, and appropriate protection.

 10.3. Where production data is required for testing, sensitive data shall be masked, anonymised, pseudonymised, tokenised, synthesised, or otherwise protected wherever feasible before use outside production.

 10.4. Test data containing personal data, confidential information, regulated information, authentication credentials, cryptographic keys, payment information, health information, or other sensitive information shall be subject to access controls, encryption, logging, retention limits, and secure disposal.

 10.5. Test data shall not include live credentials, real payment instruments, active customer contact channels, production encryption keys, production secrets, or live authentication tokens unless formally approved and protected by compensating controls.

 10.6. Test environments containing sensitive information shall be protected to a level commensurate with the sensitivity of that information.

 10.7. Test data shall be retained only for the period necessary to complete testing or meet documented business or compliance requirements.

 10.8. Test data shall be securely deleted when no longer required.

 10.9. Data masking, anonymisation, pseudonymisation, or synthetic data generation methods shall be validated to ensure that re-identification risk is appropriately reduced.

 10.10. Suppliers shall not receive production or sensitive test data unless authorised by contract, approved by the data owner, and protected by appropriate technical and organisational controls.

11. **Protection Against Malicious and Unauthorised Code**

 11.1. Development, build, and release processes shall include controls to reduce the risk of malicious code, unauthorised functionality, backdoors, tampering, and supply chain compromise.

 11.2. Source code repositories shall enforce access control, authentication, branch protection, logging, and review requirements appropriate to risk.

 11.3. Build dependencies, packages, container images, and third-party libraries shall be obtained from approved or trusted sources.

 11.4. Package registries, artefact repositories, container registries, and build systems shall be protected from unauthorised access and modification.

 11.5. Build and release artefacts shall be traceable to source code versions, build processes, approvals, and deployment records.

 11.6. Software integrity controls, such as code signing, checksum validation, signed commits, signed artefacts, trusted build pipelines, or provenance attestation, shall be used where required by risk or regulatory obligation.

 11.7. Development teams shall not introduce hidden, undocumented, unauthorised, or malicious functionality into software.

 11.8. Debug functionality, test accounts, sample data, default passwords, administrative backdoors, and verbose diagnostic features shall be removed or disabled before production release unless formally approved and secured.

12. **Developer Competence and Security Awareness**

 12.1. Personnel involved in system and software development shall receive secure development training appropriate to their role, technologies, and responsibilities.

 12.2. Developers shall be trained on applicable secure coding standards, common vulnerability classes, secure use of frameworks, secrets management, dependency risks, and organisational development security requirements.

 12.3. Personnel responsible for architecture, design, testing, DevOps, platform engineering, or release management shall receive training appropriate to their security responsibilities.

 12.4. Secure development guidance shall be made available to development teams and shall be reviewed periodically for continued relevance.

13. **Documentation and Records**

 13.1. Development teams shall maintain documentation sufficient to support secure operation, maintenance, auditability, and future modification of systems.

 13.2. Required records shall be retained in accordance with the organisation’s records retention requirements and shall include, as applicable:

 - Security requirements.
 - Threat models.
 - Architecture and design reviews.
 - Risk assessments.
 - Secure code review evidence.
 - Security test results.
 - Vulnerability remediation records.
 - Change approvals.
 - Release approvals.
 - Test data approvals.
 - Supplier assurance evidence.
 - Exception and risk acceptance records.

 13.3. Security documentation shall be protected from unauthorised disclosure where it contains sensitive architecture, vulnerability, credential, or operational information.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board / Executive Management | Provide oversight and support for secure development governance; ensure adequate resources are available to implement this policy. |
| Chief Information Security Officer / Information Security Manager | Own or co-own secure development security requirements; define security standards; review high-risk designs and exceptions; monitor compliance with this policy. |
| Head of Engineering / Technology Leadership | Ensure secure development practices are implemented within engineering teams; assign accountability; ensure developers have appropriate tools, training, and time to remediate security issues. |
| Product Owners / Business System Owners | Define business and security requirements; approve risk-based decisions; ensure systems meet business, compliance, and security expectations before release. |
| Solution Architects / Security Architects | Apply secure architecture principles; conduct or support architecture reviews and threat modelling; document security design decisions. |
| Developers / Engineers | Follow secure coding standards; protect credentials and data; participate in code reviews; remediate vulnerabilities; maintain secure development evidence. |
| DevOps / Platform / Release Engineers | Secure build and deployment pipelines; protect artefacts and registries; implement environment separation; ensure deployment controls and logging are effective. |
| Quality Assurance / Test Teams | Include security acceptance criteria in testing; protect test data; record security-related defects; verify remediation. |
| Change Advisory Board / Change Manager | Ensure changes are assessed, approved, documented, tested, and reviewed in accordance with change management requirements. |
| Data Owners | Approve use of production or sensitive data in non-production environments; ensure data protection requirements are met. |
| Procurement / Vendor Management | Ensure supplier development contracts include required security clauses; obtain supplier assurance evidence; coordinate supplier risk assessments. |
| Suppliers / Third-Party Developers | Comply with contractual secure development requirements; protect organisational information; provide security evidence; remediate vulnerabilities in delivered code or services. |
| Internal Audit / Compliance Function | Periodically assess adherence to this policy and report findings to management. |

## Compliance, Monitoring & Enforcement

Compliance with this policy shall be monitored through governance, technical controls, assurance activities, and management review.

The organisation shall implement appropriate monitoring and compliance activities, including:

| Compliance Activity | Minimum Frequency | Responsible Role |
|---|---:|---|
| Review of secure development standards and guidance | At least annually | Information Security / Engineering Leadership |
| Sampling of development project evidence | At least annually or per audit plan | Information Security / Compliance |
| Review of high-risk architecture and threat models | Per applicable project or major change | Security Architecture |
| Review of code repository access and branch protections | At least semi-annually | Engineering / Platform Owners |
| Review of privileged access to production and deployment systems | At least quarterly | System Owners / IAM / Information Security |
| Vulnerability and dependency scanning | Continuous or per build where feasible | Engineering / DevOps |
| Security testing before major production release | Per release risk profile | Engineering / Information Security |
| Supplier secure development assurance review | At onboarding and periodically based on risk | Vendor Management / Information Security |
| Test data usage review | At least annually or upon major change | Data Owners / Information Security |
| Emergency change review | Within [defined number] business days after implementation | Change Manager |

Non-compliance with this policy may result in one or more of the following actions:

- Required remediation within defined timelines.
- Suspension or delay of production release.
- Revocation or restriction of system, repository, or environment access.
- Mandatory security training or coaching.
- Formal risk acceptance by authorised management.
- Supplier corrective action or contractual remedies.
- Disciplinary action in accordance with organisational policies.
- Security incident investigation where unauthorised activity, data exposure, or malicious code is suspected.

Vulnerabilities and security defects shall be remediated according to risk-based timelines approved by the organisation. Unless otherwise defined in the Vulnerability Management Policy or applicable standard, the following default targets shall apply:

| Severity | Remediation Target |
|---|---:|
| Critical | [7 calendar days] |
| High | [30 calendar days] |
| Medium | [90 calendar days] |
| Low | [180 calendar days] |

Failure to remediate within required timelines shall require documented justification, compensating controls where applicable, and formal risk acceptance.

## Exceptions

Exceptions to this policy shall be permitted only where there is a documented business justification and the associated information security risk has been assessed and approved.

Exception requests shall include:

| Exception Information | Requirement |
|---|---|
| Requestor | Name, role, and business unit of the person requesting the exception |
| Policy requirement | Specific requirement for which exception is requested |
| Business justification | Reason compliance is not feasible or appropriate |
| Affected systems/data | Systems, applications, environments, repositories, data types, and users affected |
| Risk assessment | Security, privacy, legal, operational, and compliance risks |
| Compensating controls | Controls that reduce risk during the exception period |
| Duration | Start date and expiry date of the exception |
| Approval | Approval by system owner, risk owner, and Information Security |
| Review requirement | Frequency or trigger for reassessment |

Exceptions shall be:

- Time-bound and not open-ended.
- Approved before non-compliant activity occurs, unless associated with an emergency response.
- Recorded in the organisation’s risk register, exception register, or equivalent system of record.
- Reviewed before expiry.
- Revoked if the risk materially changes or compensating controls are ineffective.

Expired exceptions shall be treated as non-compliance unless renewed through the formal exception process.

## Review & Maintenance

This policy shall be reviewed at least annually and whenever significant changes occur that may affect secure development requirements, including:

- Changes to ISO/IEC 27001:2022 requirements or applicable certification scope.
- Material changes to laws, regulations, contractual obligations, or customer requirements.
- Introduction of new development platforms, cloud services, architectures, programming languages, frameworks, or deployment models.
- Significant security incidents, vulnerabilities, audit findings, or lessons learned.
- Changes to organisational structure, risk appetite, supplier arrangements, or technology strategy.
- Changes in threat landscape affecting software supply chain, application security, or development environments.

The policy owner shall ensure that this policy remains accurate, approved, communicated, and aligned with the organisation’s ISMS, risk management process, secure development standards, and related policies.

Changes to this policy shall be version controlled and approved in accordance with the organisation’s document control requirements.