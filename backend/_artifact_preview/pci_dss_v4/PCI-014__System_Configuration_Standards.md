<!-- pci_dss_v4 / PCI-014 | type=Policy | mode=markdown | model=gpt-5.5 | 24617 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [POL-PCI-002.2] | 1.0 | [Information Security / PCI Compliance Owner] | [YYYY-MM-DD] | PCI DSS v4.0.1 | Requirement 2.2 | Internal |

## Purpose

The purpose of this Policy is to establish mandatory system configuration standards for all in-scope system components supporting or connected to the Cardholder Data Environment (CDE), in alignment with PCI DSS v4.0.1 Requirement 2.2.

This Policy ensures that all applicable system components are securely configured and hardened to reduce the attack surface, prevent insecure default configurations, support consistent secure deployment, and maintain compliance with PCI DSS requirements for system hardening.

## Scope

This Policy applies to all system components that are in scope for PCI DSS, including those within the CDE and those that can impact the security of the CDE.

In-scope system component types include, but are not limited to:

- Network devices, including firewalls, routers, switches, wireless controllers, load balancers, and VPN devices.
- Servers, including physical, virtual, and cloud-hosted systems.
- Operating systems, including Windows, Linux, Unix, and appliance-based operating systems.
- Databases and data stores.
- Applications and application servers.
- Containers, container orchestration platforms, and container hosts.
- Hypervisors and virtualization platforms.
- Cloud services, including infrastructure-as-a-service, platform-as-a-service, and managed service components.
- Security systems, including authentication servers, logging systems, vulnerability management tools, endpoint protection platforms, and intrusion detection or prevention systems.
- Payment applications, payment middleware, and supporting platforms.
- Workstations and administrative systems used to manage or access the CDE.
- Any system that stores, processes, transmits, secures, manages, or could affect the security of cardholder data or sensitive authentication data.

This Policy applies to:

- Employees, contractors, third parties, managed service providers, and administrators responsible for building, configuring, maintaining, or approving in-scope system components.
- New deployments, existing systems, cloud resources, system images, virtual machine templates, container images, configuration baselines, and infrastructure-as-code templates.
- Production, pre-production, test, development, disaster recovery, backup, and management environments where those environments are in scope for PCI DSS or connected to the CDE.

## Policy Statements

1. The organisation shall establish, implement, and maintain documented configuration standards for all in-scope system component types.

2. Configuration standards shall be specific to each applicable technology type, product family, platform, or service, as appropriate, and shall not rely solely on generic hardening guidance.

3. Configuration standards shall address all system component types used in or affecting the CDE, including network devices, servers, operating systems, databases, applications, cloud services, containers, virtualization platforms, security tools, and administrative endpoints.

4. Configuration standards shall be consistent with PCI DSS v4.0.1 requirements and shall support secure implementation of all applicable PCI DSS controls.

5. Configuration standards shall be based on one or more industry-accepted hardening sources, where available, such as:
 - Center for Internet Security Benchmarks.
 - Vendor hardening guides.
 - NIST secure configuration guidance.
 - DISA Security Technical Implementation Guides.
 - Cloud provider security baselines.
 - Payment application vendor security guidance.
 - Secure configuration recommendations from the relevant platform or technology provider.

6. Where no industry-accepted hardening source exists for a system component, the organisation shall define internal secure configuration requirements based on risk, vendor documentation, PCI DSS requirements, and security architecture principles.

7. Configuration standards shall include, at a minimum, requirements for secure baseline configuration, removal or disabling of unnecessary functions, removal or disabling of insecure services, secure protocol configuration, authentication controls, logging requirements, encryption settings, administrative access controls, default account handling, default password changes, patching prerequisites, and secure management interfaces.

8. Configuration standards shall require that vendor-supplied defaults are changed or removed before a system component is installed in production or connected to the CDE.

9. Configuration standards shall require that default passwords, sample accounts, unnecessary default accounts, default Simple Network Management Protocol community strings, insecure keys, sample files, and default configuration values that could affect security are changed, disabled, or removed before deployment.

10. Configuration standards shall require that only necessary services, protocols, daemons, ports, accounts, applications, and functions are enabled on in-scope system components.

11. Configuration standards shall require that any enabled insecure service, protocol, or daemon is formally justified, documented, risk assessed, and protected by compensating or supporting security controls before use.

12. Configuration standards shall require that secure alternatives are used instead of insecure protocols wherever technically feasible, including the use of SSH instead of Telnet, SFTP or FTPS instead of FTP, HTTPS instead of HTTP for administrative interfaces, and SNMPv3 instead of SNMPv1 or SNMPv2 where SNMP is required.

13. Configuration standards shall require that system components are configured to support secure administrative access, including encrypted management sessions, strong authentication, least privilege, session controls, and restrictions on administrative access paths.

14. Configuration standards shall require that unnecessary administrative interfaces are disabled or restricted and that management interfaces are not exposed to untrusted networks unless explicitly approved and protected.

15. Configuration standards shall require that security parameters are configured to prevent common misconfigurations, including insecure cryptographic settings, unnecessary open ports, excessive permissions, unrestricted network services, weak authentication mechanisms, and insecure remote access.

16. Configuration standards shall require that system components are configured to generate appropriate security logs and to forward logs to approved logging or security monitoring platforms where required by PCI DSS.

17. Configuration standards shall require that system clocks, time synchronization settings, and time sources are configured consistently to support accurate audit logging and security monitoring.

18. Configuration standards shall require that anti-malware, endpoint detection and response, file integrity monitoring, vulnerability scanning agents, configuration management agents, or other security tooling are installed and configured where applicable to the system component type.

19. Configuration standards shall require secure configuration of cloud resources, including identity and access management, network exposure, storage security, encryption, logging, monitoring, key management, and public access restrictions.

20. Configuration standards shall require secure configuration of containerized environments, including hardened container images, minimal base images, non-root execution where feasible, image provenance, vulnerability management, secrets handling, network segmentation, and orchestration platform security settings.

21. Configuration standards shall require secure configuration of virtualization platforms, including hypervisor management access controls, host hardening, secure virtual networking, administrative logging, and separation of duties between management and guest environments.

22. Configuration standards shall require that payment applications and supporting systems are configured according to vendor security guidance and applicable PCI DSS requirements.

23. Configuration standards shall require that system builds are performed from approved hardened baselines, build templates, golden images, configuration management tools, infrastructure-as-code templates, or documented implementation guides.

24. Configuration standards shall require that new, rebuilt, or significantly changed in-scope system components are validated against the applicable configuration standard before production implementation or connection to the CDE.

25. Configuration standards shall be incorporated into the organisation’s change management process so that configuration changes to in-scope components are reviewed, approved, tested, documented, and implemented securely.

26. Configuration standards shall be maintained under version control or equivalent document control to preserve approval history, update history, and traceability of changes.

27. Configuration standards shall include sufficient detail to allow consistent implementation and independent validation by system owners, administrators, security personnel, internal assessors, and external assessors.

28. Configuration standards shall identify the applicable system component type, platform or product scope, baseline source, required configuration settings, implementation requirements, validation method, owner, and review frequency.

29. Each configuration standard shall include, where applicable, the following minimum information:

| Required Element | Policy Requirement |
|---|---|
| Standard name | The standard shall clearly identify the system component type, platform, or technology covered. |
| Scope of applicability | The standard shall define where and when it applies, including CDE, connected-to-CDE, and security-impacting systems. |
| Baseline source | The standard shall identify the benchmark, vendor guide, internal baseline, or other source used. |
| Mandatory settings | The standard shall document required secure configuration settings or reference an approved technical baseline containing them. |
| Prohibited settings | The standard shall identify insecure or prohibited services, protocols, functions, accounts, or configurations where applicable. |
| Required security tooling | The standard shall define required monitoring, logging, endpoint, integrity, or vulnerability management components. |
| Validation method | The standard shall define how compliance is checked, including automated scanning, configuration review, build review, or manual inspection. |
| Owner | The standard shall identify the accountable technical or service owner. |
| Review frequency | The standard shall state the review cycle and triggers for out-of-cycle review. |
| Exception handling | The standard shall reference the approved exception process for deviations. |

30. Configuration standards shall be reviewed at least once every 12 months and whenever significant changes occur, including introduction of a new technology, major platform upgrade, material change to PCI DSS scope, identification of a significant vulnerability, change in vendor guidance, change in threat landscape, or audit finding.

31. Configuration standards shall be updated promptly when new or changed PCI DSS requirements, security vulnerabilities, vendor advisories, or industry hardening guidance require modification of secure configuration requirements.

32. The organisation shall maintain an inventory or register of approved configuration standards for in-scope system component types.

33. The approved configuration standards register shall identify, at a minimum:

| Field | Required Content |
|---|---|
| Standard ID | Unique identifier for the configuration standard. |
| Component type | Technology or system component type covered. |
| Platform/product | Specific operating system, device, application, service, or platform covered. |
| Owner | Accountable role or team responsible for the standard. |
| Baseline source | CIS, vendor, NIST, DISA, cloud provider, or internal baseline source. |
| Current version | Approved version of the standard. |
| Last review date | Date the standard was last reviewed. |
| Next review date | Scheduled next review date. |
| Approval authority | Role or governance body that approved the standard. |
| PCI applicability | PCI DSS scope category or applicability statement. |

34. The organisation shall not deploy, connect, or operate in-scope system components for which no applicable approved configuration standard exists, unless a documented and approved exception is in place.

35. The organisation shall ensure that configuration standards are accessible to personnel responsible for building, configuring, administering, reviewing, or assessing in-scope system components.

36. System owners and administrators shall implement applicable configuration standards consistently across all in-scope systems unless an approved exception exists.

37. Security configuration requirements shall be enforceable through technical controls where feasible, including configuration management platforms, endpoint management tools, cloud security posture management, infrastructure-as-code controls, policy-as-code, mobile device management, directory policies, or automated compliance tooling.

38. Configuration drift from approved hardened baselines shall be detected, reported, assessed, and remediated in accordance with the organisation’s vulnerability management, configuration management, and change management processes.

39. Any deviation from an approved configuration standard shall be documented as an exception, risk assessed, approved by authorised personnel, assigned an expiration date, and reviewed periodically until remediated or formally renewed.

40. Evidence of compliance with configuration standards shall be retained to support PCI DSS assessment activities, including baseline documents, approval records, build validation results, configuration scan outputs, exception records, change tickets, and review records.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Executive Management | Shall provide sponsorship and resources necessary to establish, implement, and maintain secure configuration standards for in-scope systems. |
| PCI Compliance Owner | Shall ensure this Policy and associated configuration standards align with PCI DSS v4.0.1 Requirement 2.2 and related PCI DSS obligations. |
| Information Security Team | Shall define security requirements, review hardening baselines, validate alignment with recognised guidance, monitor compliance, and report significant non-compliance. |
| System Owners | Shall ensure that systems under their ownership have applicable approved configuration standards and are implemented, maintained, and reviewed accordingly. |
| Technology Platform Owners | Shall develop and maintain platform-specific configuration standards for assigned technologies, including operating systems, databases, applications, network devices, cloud services, and infrastructure platforms. |
| Infrastructure and Operations Teams | Shall implement approved configuration standards during build, deployment, maintenance, and change activities. |
| Network Team | Shall maintain and apply secure configuration standards for firewalls, routers, switches, wireless devices, load balancers, VPN devices, and other network infrastructure in scope for PCI DSS. |
| Cloud Engineering Team | Shall define and enforce secure configuration standards for cloud services, accounts, subscriptions, projects, infrastructure-as-code, identity controls, logging, storage, and network configurations. |
| Application Owners and Development Teams | Shall ensure applications and application platforms are configured securely, unnecessary functions are disabled, vendor guidance is followed, and configuration requirements are included in deployment processes. |
| Database Administrators | Shall implement approved database configuration standards, including secure authentication, access control, logging, encryption, unnecessary feature removal, and default account handling. |
| Change Advisory Board or Change Authority | Shall ensure that changes to in-scope systems consider applicable configuration standards and that deviations are identified before approval. |
| Risk Management Function | Shall review and advise on risk associated with configuration exceptions, insecure protocols, unresolved deviations, and compensating controls. |
| Internal Audit or Compliance Assurance | Shall perform independent or periodic reviews of adherence to this Policy and associated configuration standards. |
| Third-Party Service Providers | Shall comply with organisation-approved configuration standards or equivalent PCI DSS-aligned standards where they manage, host, support, or secure in-scope system components. |

## Compliance, Monitoring & Enforcement

Compliance with this Policy is mandatory for all in-scope system components and personnel responsible for their design, deployment, management, support, or assessment.

The organisation shall monitor compliance using appropriate assurance methods, including:

- Review of approved configuration standards and baseline registers.
- Build and deployment validation.
- Configuration compliance scanning.
- Vulnerability scanning.
- Cloud security posture monitoring.
- Endpoint and server management reporting.
- Network device configuration review.
- Firewall and management interface review.
- Internal PCI DSS readiness assessments.
- Change management sampling.
- Exception register review.
- External assessor evidence requests and validation activities.

Minimum monitoring expectations are as follows:

| Activity | Minimum Frequency | Responsible Role |
|---|---:|---|
| Review of configuration standards register | Quarterly | PCI Compliance Owner / Information Security Team |
| Review of each approved configuration standard | At least annually | Standard Owner |
| Validation of new or rebuilt in-scope systems against applicable baseline | Before production deployment or CDE connection | System Owner / Operations Team |
| Configuration compliance scanning or technical validation | At least quarterly, where tooling supports automated validation | Information Security Team / Platform Owner |
| Review of configuration exceptions | At least quarterly and before expiration | Risk Management / Exception Approver |
| Review of configuration drift for critical CDE systems | At least monthly, where automated tooling is available | Platform Owner / Operations Team |
| Review of significant PCI-relevant configuration changes | Per approved change management process | Change Authority |

Non-compliance with this Policy shall be documented, risk assessed, and remediated within approved timelines based on risk and PCI DSS impact.

Examples of non-compliance include, but are not limited to:

- Operating an in-scope system without an approved applicable configuration standard.
- Deploying a system to the CDE without hardening validation.
- Retaining vendor default accounts, passwords, or insecure default settings.
- Enabling unnecessary services, protocols, daemons, ports, or functions.
- Using insecure protocols without documented justification and protective controls.
- Making unapproved configuration changes to hardened baselines.
- Failing to review or update configuration standards within required timeframes.
- Failing to remediate configuration drift or obtain an approved exception.
- Failing to retain evidence required to demonstrate PCI DSS compliance.

Enforcement actions may include:

- Rejection or rollback of deployment.
- Disconnection or isolation of non-compliant systems from the CDE.
- Emergency change or remediation requirements.
- Escalation to system owners, service owners, or executive management.
- Suspension of administrative access for repeated or serious violations.
- Vendor or service provider remediation actions under contractual terms.
- Formal risk acceptance only where permitted by governance and PCI DSS requirements.
- Disciplinary action in accordance with organisational policies for employees or contractors.

Security issues that present an immediate or material risk to the CDE shall be escalated through the incident response, vulnerability management, or emergency change processes as appropriate.

## Exceptions

Exceptions to this Policy or to an approved configuration standard shall be permitted only where there is a documented business or technical justification and the risk has been formally assessed and approved.

All exceptions shall:

1. Be documented in the approved exception register or governance, risk, and compliance system.
2. Identify the affected system component, configuration requirement, and reason for deviation.
3. Include a risk assessment describing the PCI DSS impact and security exposure.
4. Identify compensating or mitigating controls where applicable.
5. Be approved by the relevant system owner, Information Security, and an authorised risk approver.
6. Have a defined expiration date.
7. Include a remediation or migration plan unless the exception is formally risk accepted for a defined period.
8. Be reviewed at least quarterly and before renewal or expiration.
9. Be retained as evidence for PCI DSS assessment purposes.

Exception records shall contain, at a minimum:

| Field | Required Content |
|---|---|
| Exception ID | Unique identifier for the exception. |
| Requestor | Person or team requesting the exception. |
| System/component | Affected system, service, platform, or configuration item. |
| Configuration standard reference | Specific standard and requirement from which deviation is requested. |
| Business or technical justification | Explanation of why compliance is not currently achievable. |
| Risk rating | Assessed likelihood and impact of the deviation. |
| PCI DSS impact | Description of how the deviation affects PCI DSS compliance or CDE security. |
| Compensating or mitigating controls | Controls implemented to reduce risk during the exception period. |
| Approvals | Required approval roles and approval dates. |
| Expiration date | Date by which the exception must be remediated, renewed, or closed. |
| Remediation plan | Actions and target dates to achieve compliance. |
| Review history | Evidence of periodic review and continued need. |

Exceptions shall not be used to permanently bypass PCI DSS requirements or to avoid implementing secure configurations where technically feasible. Expired exceptions shall be treated as non-compliance unless renewed through the approved exception process.

## Review & Maintenance

This Policy shall be reviewed at least annually and whenever significant changes occur that may affect PCI DSS scope, system configuration requirements, hardening practices, technology architecture, regulatory obligations, or organisational risk.

Triggers for out-of-cycle review include:

- Changes to PCI DSS requirements or official PCI SSC guidance.
- Introduction of new in-scope technologies or system component types.
- Significant changes to the CDE or connected-to-CDE environments.
- Major cloud, infrastructure, application, database, or network architecture changes.
- Identification of material vulnerabilities or misconfiguration trends.
- Security incidents involving configuration weaknesses.
- Audit findings or assessor observations related to PCI DSS Requirement 2.2.
- Changes to vendor hardening guidance or industry security benchmarks.
- Significant changes to managed service provider responsibilities.

The Policy Owner shall coordinate review and maintenance activities, including:

- Confirming continued alignment with PCI DSS v4.0.1 Requirement 2.2.
- Validating that related standards, procedures, and baselines remain current.
- Ensuring that configuration standards exist for all in-scope system component types.
- Reviewing exception trends and recurring deviations.
- Confirming that monitoring and enforcement mechanisms remain effective.
- Obtaining approval for material changes through the organisation’s governance process.

Policy changes shall be documented in accordance with the organisation’s document control process. Superseded versions shall be retained according to record retention requirements and made available for audit when required.