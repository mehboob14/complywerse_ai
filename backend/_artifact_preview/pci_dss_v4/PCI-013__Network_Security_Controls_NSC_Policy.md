<!-- pci_dss_v4 / PCI-013 | type=Policy | mode=markdown | model=gpt-5.5 | 27809 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [POL-PCI-001] | 1.0 | [Information Security / Network Security Owner] | [YYYY-MM-DD] | PCI DSS v4.0.1 | Requirement 1 — Install and Maintain Network Security Controls | Internal |

## Purpose

This policy establishes mandatory requirements for the design, implementation, configuration, management, review, and monitoring of Network Security Controls (NSCs) protecting the Cardholder Data Environment (CDE) and connected-to or security-impacting networks.

The purpose of this policy is to ensure that firewalls, routers, cloud security groups, virtual firewalls, host-based firewalls, network access control lists, segmentation controls, and equivalent technologies are configured and maintained to restrict network traffic to only that which is necessary and secure, in accordance with PCI DSS v4.0.1 Requirement 1.

This policy supports the organisation’s obligation to:

- Protect system components and cardholder data from unauthorised network access.
- Enforce secure network boundaries between trusted and untrusted networks.
- Maintain accurate network diagrams and data-flow diagrams.
- Ensure NSC rules are documented, justified, reviewed, and approved.
- Prevent direct public access between the Internet and system components in the CDE unless explicitly authorised and securely controlled.
- Protect wireless networks and other untrusted networks from unauthorised access to the CDE.
- Maintain secure configurations for NSCs throughout their lifecycle.

## Scope

This policy applies to all personnel, contractors, service providers, systems, networks, facilities, and technologies that store, process, transmit, secure, administer, monitor, or can otherwise impact cardholder data or the CDE.

This policy applies to all NSCs used to protect or segment the CDE, including but not limited to:

- Network firewalls.
- Web application firewalls where used as network-layer or traffic-filtering controls.
- Routers with access control lists.
- Switch access control lists.
- Cloud firewalls, security groups, network security groups, and route tables.
- Virtual firewalls and software-defined networking controls.
- Host-based firewalls used to restrict inbound or outbound traffic.
- Intrusion prevention systems where configured to block traffic.
- Network segmentation controls used to isolate the CDE from other networks.
- Remote access gateways and VPN concentrators.
- Wireless network security controls where wireless networks exist within, connected to, or adjacent to the CDE.

This policy applies to all environments that are in scope for PCI DSS, including:

- Production CDE.
- Connected-to systems.
- Security-impacting systems.
- Management networks supporting the CDE.
- Administrative access paths to CDE systems.
- Development, test, and staging environments where they connect to or can impact the production CDE.
- Cloud, hosted, on-premises, co-located, and hybrid infrastructure supporting payment operations.

This policy applies to all network traffic into, out of, and within the CDE, including traffic between internal network zones, Internet-facing systems, third-party connections, wireless networks, administrative networks, and service provider environments.

## Policy Statements

1. The organisation shall implement and maintain NSCs between all trusted and untrusted networks, including the Internet, wireless networks, third-party networks, public cloud environments, and any network not under the organisation’s direct control.

2. The organisation shall implement and maintain NSCs to restrict inbound and outbound network traffic between the CDE and all other networks to only traffic that is necessary, documented, authorised, and secure.

3. The organisation shall define, document, approve, and maintain configuration standards for all NSCs used to protect the CDE.

4. NSC configuration standards shall address, at minimum:
 - Permitted and prohibited services, protocols, and ports.
 - Business justification for each allowed rule.
 - Source and destination networks, hosts, and services.
 - Direction of traffic flow.
 - Security features and restrictions required for the rule.
 - Rule ownership.
 - Rule expiry date where temporary access is approved.
 - Change approval requirements.
 - Logging and monitoring requirements.
 - Default deny configuration.
 - Segmentation requirements.
 - Administrative access controls.
 - Secure management protocols.
 - Vendor hardening requirements.

5. The organisation shall maintain current network diagrams that identify all connections between the CDE and other networks, including wireless networks, Internet connections, third-party connections, cloud networks, and management networks.

6. Network diagrams shall identify all NSCs protecting the CDE and shall be updated whenever significant changes are made to network architecture, segmentation, routing, firewall placement, cloud networking, or third-party connectivity.

7. The organisation shall maintain current data-flow diagrams showing all flows of account data across systems and networks, including flows into, within, and out of the CDE.

8. Data-flow diagrams shall identify where cardholder data is stored, processed, transmitted, received, or otherwise traverses network boundaries.

9. All NSC rule sets protecting the CDE shall be configured according to a default-deny principle, allowing only explicitly authorised traffic.

10. The organisation shall prohibit “any-any”, unrestricted, overly broad, or undocumented NSC rules within or affecting the CDE unless formally approved as a time-bound exception under this policy.

11. The organisation shall not permit inbound traffic from untrusted networks to system components in the CDE unless the traffic is explicitly authorised, documented, necessary for a business function, and restricted to specific sources, destinations, ports, and protocols.

12. The organisation shall not permit direct public access between the Internet and any system component in the CDE except where explicitly required, documented, approved, and protected by appropriate NSCs and security controls.

13. The organisation shall implement a demilitarised zone or equivalent network architecture to restrict inbound public traffic to authorised systems only.

14. The organisation shall ensure that Internet-facing systems are separated from internal CDE systems by NSCs that restrict traffic to only required and authorised services.

15. The organisation shall prohibit direct inbound Internet traffic to internal CDE systems unless specifically approved by the [CISO / Head of Information Security] and supported by documented business and security justification.

16. The organisation shall ensure that outbound traffic from the CDE to untrusted networks is explicitly authorised and restricted to required destinations, services, ports, and protocols.

17. The organisation shall prohibit direct outbound traffic from CDE systems to the Internet unless such traffic is documented, justified, authorised, and monitored.

18. The organisation shall ensure that NSC rules do not allow insecure services, protocols, or ports into or out of the CDE unless specifically justified and secured using compensating security controls.

19. Where insecure services, protocols, or ports are required for a legitimate business purpose, the organisation shall document the business need, associated risks, protective controls, approval, and review frequency.

20. The organisation shall implement anti-spoofing or equivalent controls on NSCs to detect and block forged source IP addresses, including traffic claiming to originate from internal addresses but entering from untrusted networks.

21. The organisation shall ensure that private and internal IP addresses are not routed from untrusted networks into the CDE unless explicitly required and securely controlled for approved private connectivity.

22. The organisation shall restrict traffic between wireless networks and the CDE using NSCs, regardless of whether the wireless network is considered trusted, untrusted, corporate, guest, or third-party-managed.

23. The organisation shall prohibit wireless network access to the CDE unless explicitly authorised, documented, segmented, secured, and monitored.

24. The organisation shall ensure that all connectivity between third-party or service provider networks and the CDE is protected by NSCs and restricted to necessary, documented, and approved traffic.

25. The organisation shall ensure that third-party connectivity to the CDE is subject to formal approval, defined technical restrictions, monitoring, and periodic review.

26. The organisation shall maintain an inventory of NSCs in scope for PCI DSS Requirement 1.

27. The NSC inventory shall identify, at minimum:

| Required Field | Description |
|---|---|
| Asset ID | Unique identifier for the NSC |
| Device / Service Name | Hostname or service name |
| Technology Type | Firewall, router ACL, cloud security group, host firewall, virtual firewall, or equivalent |
| Location / Environment | Data centre, cloud account, VPC/VNet, branch, or hosted environment |
| CDE Relevance | CDE, connected-to, segmentation, Internet edge, third-party access, wireless boundary, or management boundary |
| Owner | Responsible technical owner |
| Administrator Group | Group authorised to manage the NSC |
| Management Interface | Approved management method and network path |
| Logging Destination | SIEM, log platform, or monitoring system |
| Configuration Standard | Applicable baseline or hardening standard |
| Review Frequency | Required rule set review interval |
| Last Review Date | Date of most recent completed review |

28. The organisation shall ensure that all NSC configuration changes are performed through an approved change management process prior to implementation, except where emergency change procedures apply.

29. Each NSC change request shall include, at minimum:

| Required Field | Description |
|---|---|
| Change ID | Unique change record identifier |
| Requestor | Individual requesting the change |
| Business Owner | Owner of the business service requiring the rule |
| Technical Owner | Owner responsible for implementation |
| Source | Source IP address, subnet, host, zone, or service |
| Destination | Destination IP address, subnet, host, zone, or service |
| Port / Protocol | Required port, protocol, and service |
| Direction | Inbound, outbound, or internal |
| Business Justification | Specific business purpose for the rule |
| Security Justification | Explanation of why the access is secure and necessary |
| CDE Impact | Whether the rule affects the CDE or segmentation |
| Duration | Permanent or temporary, including expiry date |
| Logging Requirement | Required logging or alerting |
| Risk Assessment | Security risk and mitigation |
| Testing Evidence | Validation that the change works as intended and does not expose unauthorised access |
| Approval | Required authoriser before implementation |
| Implementation Date | Date and time of implementation |
| Backout Plan | Method to reverse the change if required |

30. The organisation shall ensure that emergency NSC changes are documented, reviewed, tested, and formally approved after implementation within [X business days].

31. The organisation shall ensure that temporary NSC rules include an expiry date and are removed or revalidated before expiry.

32. Temporary NSC rules affecting the CDE shall not exceed [90 days] unless formally re-approved by the [CISO / Head of Information Security] or authorised delegate.

33. NSC administrators shall remove obsolete, unused, expired, duplicate, shadowed, or unauthorised rules when identified.

34. NSC rule sets that protect the CDE shall be reviewed at least once every six months and whenever significant network or application changes occur.

35. NSC rule reviews shall verify, at minimum:
 - Continued business need.
 - Accuracy of source and destination definitions.
 - Appropriateness of ports and protocols.
 - Presence of business justification.
 - Rule ownership.
 - Temporary rule expiry.
 - Removal of unused, obsolete, duplicate, or overly permissive rules.
 - Compliance with default-deny principles.
 - Continued effectiveness of CDE segmentation.
 - Compliance with approved configuration standards.

36. Results of NSC rule reviews shall be documented, retained, and tracked to remediation.

37. The organisation shall define and implement formal procedures for managing NSC rules and configurations that support this policy.

38. The organisation shall ensure that NSCs protecting the CDE are configured to restrict administrative access to authorised personnel only.

39. Administrative access to NSCs shall use secure protocols, strong authentication, role-based access control, and individual user accounts.

40. The organisation shall prohibit shared administrative accounts for NSC management unless technically unavoidable and formally approved with compensating monitoring and accountability controls.

41. NSC administrative interfaces shall not be accessible directly from the Internet unless explicitly approved, strongly authenticated, restricted by source, encrypted, monitored, and protected by additional security controls.

42. The organisation shall ensure that NSC administrative access is logged and monitored.

43. The organisation shall configure NSCs to generate logs for traffic allowed or denied where required to support PCI DSS monitoring, incident response, security investigations, and rule validation.

44. NSC logs shall be forwarded to the organisation’s approved central logging or security monitoring platform where technically feasible.

45. The organisation shall protect NSC configurations from unauthorised access, modification, or disclosure.

46. The organisation shall back up NSC configurations after approved changes and at a frequency sufficient to support recovery.

47. NSC configuration backups shall be protected from unauthorised access and retained in accordance with the organisation’s retention requirements.

48. The organisation shall ensure that NSC devices and management platforms are securely configured according to vendor hardening guidance, industry best practice, and approved internal standards.

49. The organisation shall change all vendor default passwords, community strings, keys, and insecure default settings before any NSC is placed into service.

50. The organisation shall disable or remove unnecessary services, protocols, interfaces, management accounts, and features on NSCs protecting the CDE.

51. The organisation shall keep NSC software, firmware, and management platforms updated in accordance with the organisation’s vulnerability and patch management policies.

52. The organisation shall ensure that segmentation controls used to reduce PCI DSS scope are implemented using NSCs or equivalent controls that isolate the CDE from out-of-scope networks.

53. Segmentation controls shall be validated through testing at least once every 12 months and after any significant change to network architecture, NSC rules, routing, cloud networking, or CDE boundaries.

54. Segmentation testing shall verify that out-of-scope networks cannot access the CDE except through explicitly authorised and controlled paths.

55. The organisation shall ensure that any cloud-native NSC configurations protecting the CDE, including security groups, network security groups, network ACLs, route tables, load balancer security policies, and virtual firewall policies, comply with this policy.

56. The organisation shall ensure that infrastructure-as-code or automated deployment pipelines used to configure NSCs are subject to access control, peer review, change approval, version control, and security testing.

57. The organisation shall ensure that NSC rules deployed through automation are traceable to approved business requirements and change records.

58. The organisation shall ensure that NSCs are deployed in a manner that prevents bypass of security controls, including unauthorised alternate network paths, direct routes, unmanaged remote access, or misconfigured cloud peering.

59. The organisation shall prohibit unauthorised modems, cellular gateways, remote access devices, split tunnels, rogue wireless access points, unmanaged VPNs, or other network paths that bypass approved NSCs protecting the CDE.

60. The organisation shall review network architecture and NSC placement whenever significant business, application, infrastructure, cloud, or third-party connectivity changes occur.

61. The organisation shall ensure that NSC configuration documentation, rule review evidence, change approvals, diagrams, inventories, and segmentation test results are retained as PCI DSS evidence for at least [one year] or longer where required by legal, regulatory, contractual, or organisational retention requirements.

62. The organisation shall ensure that personnel responsible for designing, approving, implementing, or reviewing NSCs are competent and understand their responsibilities under PCI DSS Requirement 1.

63. The organisation shall ensure that NSC responsibilities are formally assigned and communicated to relevant personnel.

64. The organisation shall ensure that service providers managing NSCs or network connectivity affecting the CDE comply with this policy and provide evidence of control operation upon request.

65. The organisation shall ensure that NSC-related security incidents, misconfigurations, unauthorised changes, unauthorised access attempts, and suspected segmentation failures are reported and handled through the organisation’s incident response process.

## Roles & Responsibilities

| Role | Responsibilities |
|---|---|
| Board / Executive Management | Provides oversight and ensures adequate resources are available to implement and maintain NSCs protecting the CDE. |
| [CISO / Head of Information Security] | Owns this policy; approves high-risk NSC exceptions; ensures PCI DSS Requirement 1 obligations are met; escalates significant non-compliance. |
| PCI DSS Compliance Owner | Maintains alignment between this policy and PCI DSS v4.0.1 Requirement 1; coordinates evidence collection for assessments; tracks remediation of compliance gaps. |
| Network Security Owner | Owns NSC architecture, standards, implementation, operational controls, and rule review processes for CDE-related networks. |
| Network Engineering Team | Implements approved NSC changes; maintains NSC configurations; performs rule reviews; updates network diagrams; removes unauthorised or obsolete rules. |
| Cloud Infrastructure Team | Implements and maintains cloud-native NSCs such as security groups, network ACLs, route tables, virtual firewalls, and cloud segmentation controls affecting the CDE. |
| System Owners | Identify business requirements for network access; validate continued need for NSC rules; approve business justification for access to their systems. |
| Application Owners | Define required application traffic flows; validate data-flow diagrams; confirm that permitted traffic remains necessary and secure. |
| Change Advisory Board / Change Authority | Reviews and approves NSC changes according to risk, impact, PCI DSS relevance, and change management requirements. |
| Security Operations Team | Monitors NSC logs and alerts; investigates suspicious traffic; escalates potential NSC misconfigurations or unauthorised access attempts. |
| Vulnerability Management Team | Identifies vulnerabilities in NSCs and management platforms; tracks patching and remediation; validates secure configuration where applicable. |
| Internal Audit / Compliance Assurance | Performs independent reviews of policy compliance, evidence quality, rule review completion, and remediation effectiveness. |
| Service Providers | Comply with this policy where managing or impacting NSCs, CDE connectivity, segmentation, or network security services; provide evidence of compliance as required. |
| All Personnel | Must not create, request, bypass, or use unauthorised network connections to the CDE; must report suspected NSC violations or unauthorised connectivity. |

## Compliance, Monitoring & Enforcement

Compliance with this policy is mandatory for all in-scope environments, systems, personnel, and service providers.

The organisation shall monitor compliance with this policy through a combination of technical controls, operational reviews, security monitoring, management oversight, and PCI DSS assurance activities.

The following monitoring and assurance activities shall be performed:

| Activity | Minimum Frequency | Responsible Role | Evidence |
|---|---:|---|---|
| Review NSC rule sets protecting the CDE | At least every 6 months | Network Security Owner | Completed rule review records, remediation tickets |
| Review network diagrams | At least every 12 months and after significant change | Network Engineering Team | Approved current network diagrams |
| Review data-flow diagrams | At least every 12 months and after significant change | Application Owners / PCI DSS Compliance Owner | Approved current data-flow diagrams |
| Validate CDE segmentation effectiveness | At least every 12 months and after significant change | Security Testing Team / Qualified Assessor | Segmentation test report |
| Review temporary NSC rules | Monthly or prior to expiry | Network Engineering Team | Temporary rule register, removal evidence |
| Review emergency NSC changes | Within [X business days] of implementation | Change Authority | Emergency change record and approval |
| Review NSC administrator access | At least every 6 months | Network Security Owner / IAM Owner | Access review evidence |
| Monitor NSC logs and alerts | Continuous, where supported | Security Operations Team | SIEM alerts, log review records |
| Review NSC configuration compliance | At least annually and after significant change | Network Security Owner | Baseline assessment or configuration review |
| Review third-party network access to CDE | At least every 6 months | Third-Party Risk Owner / Network Security Owner | Access review, contract or attestation evidence |
| Validate NSC inventory accuracy | At least every 12 months | Asset Owner / Network Security Owner | Updated NSC inventory |

Non-compliance with this policy may result in one or more of the following actions:

- Immediate removal or disabling of unauthorised NSC rules or network connectivity.
- Suspension of administrative access to NSCs.
- Mandatory remediation plans with defined owners and due dates.
- Escalation to the [CISO / Head of Information Security].
- Escalation to executive management for material or repeated non-compliance.
- Disciplinary action in accordance with [HR Disciplinary Policy].
- Contractual remedies for service provider non-compliance.
- Risk acceptance or exception processing where remediation cannot be completed within required timeframes.

The organisation shall treat the following as high-priority security events:

- Unauthorised changes to NSC configurations.
- Unapproved inbound access from untrusted networks to CDE systems.
- Unapproved outbound Internet access from CDE systems.
- Failure of segmentation controls protecting the CDE.
- Discovery of uncontrolled or undocumented third-party connectivity.
- NSC rules that expose cardholder data systems to unnecessary or insecure access.
- Direct Internet access to internal CDE systems without approval.
- Administrative access to NSCs from unauthorised networks or accounts.
- Evidence that NSC logging, monitoring, or enforcement has been disabled or bypassed.

All identified non-compliance shall be documented, assigned an owner, risk-rated, remediated within approved timelines, and retained as compliance evidence.

## Exceptions

Exceptions to this policy shall be permitted only where there is a documented business need, a completed risk assessment, defined compensating controls, and formal approval by the authorised exception approver.

Exceptions shall not be used to bypass PCI DSS requirements where a PCI DSS-compliant control is technically and operationally feasible.

Requests for exceptions shall include, at minimum:

| Required Field | Description |
|---|---|
| Exception ID | Unique exception reference |
| Requestor | Individual requesting the exception |
| Business Owner | Accountable business owner |
| System / Network Affected | NSC, system, application, segment, or data flow affected |
| PCI DSS Requirement Impact | Specific PCI DSS Requirement 1 impact |
| Description of Exception | Clear statement of the requested deviation |
| Business Justification | Reason the exception is required |
| Risk Assessment | Security and compliance risks introduced |
| Compensating Controls | Controls used to reduce risk |
| Duration | Start date and expiry date |
| Remediation Plan | Actions required to remove the exception |
| Approval | Required approval authority |
| Review Frequency | Frequency for reassessing the exception |
| Evidence Location | Link or reference to supporting documentation |

All exceptions shall be:

- Time-bound.
- Risk-assessed before approval.
- Approved by the [CISO / Head of Information Security] or authorised delegate.
- Reviewed at least quarterly where they affect the CDE.
- Recorded in the organisation’s exception register.
- Supported by compensating controls where risk is not otherwise acceptable.
- Removed when no longer required.

Exceptions involving any of the following shall require explicit approval by the [CISO / Head of Information Security]:

- Any-any rules affecting the CDE.
- Direct Internet connectivity to CDE systems.
- Insecure services, protocols, or ports into or out of the CDE.
- Unrestricted third-party connectivity.
- Administrative NSC access from untrusted networks.
- Temporary rules required beyond the approved maximum duration.
- Segmentation control weaknesses or failures.
- Any rule or architecture that materially increases PCI DSS scope or cardholder data risk.

Expired exceptions shall be treated as policy violations unless renewed through the formal exception process before expiry.

## Review & Maintenance

This policy shall be reviewed at least annually and whenever significant changes occur that could affect PCI DSS Requirement 1 or the organisation’s NSC control environment.

Policy review shall consider, at minimum:

- Changes to PCI DSS requirements, guidance, or assessment expectations.
- Changes to the CDE scope.
- Changes to network architecture.
- Significant NSC technology changes.
- Cloud migration or major cloud networking changes.
- New or changed third-party connectivity.
- Significant security incidents involving NSCs or network access.
- Results of PCI DSS assessments.
- Results of segmentation testing.
- Findings from internal audits or external audits.
- Repeated NSC rule review findings.
- Changes to legal, regulatory, contractual, or acquiring bank requirements.

The [Information Security / Network Security Owner] shall maintain this policy and coordinate updates with relevant stakeholders, including Network Engineering, Cloud Infrastructure, Security Operations, PCI DSS Compliance, Legal, Risk Management, Internal Audit, and affected business owners.

Policy changes shall be approved by the [CISO / Head of Information Security] or authorised governance body before publication.

The current approved version of this policy shall be stored in [policy repository / GRC system] and made available to all relevant personnel.

Superseded versions shall be retained in accordance with the organisation’s document retention requirements.