<!-- pci_dss_v4 / PCI-004 | type=Form/Template | mode=markdown | model=gpt-5.5 | 23560 chars -->

| Metadata | Value |
|---|---|
| Document ID | [Document ID] |
| Version | 1.0 |
| Owner | [Network Security Owner / Team] |
| Effective Date | [Effective Date] |
| Framework | PCI DSS v4.0.1 |
| Classification | Internal Confidential |

## Purpose

This template is used to create, maintain, review, and approve network diagrams required by PCI DSS v4.0.1 Requirement 1.2.3.

The completed Network Diagram must accurately document all network connections between the Cardholder Data Environment, or CDE, and other networks, including but not limited to:

- Connections into and out of the CDE.
- Connections to third-party service providers.
- Connections to cloud environments.
- Connections to corporate, administrative, user, guest, development, testing, and production networks.
- Wireless networks, including internal, guest, corporate, point-of-sale, warehouse, and third-party managed wireless.
- Internet, remote access, VPN, SD-WAN, MPLS, private circuit, and direct-connect links.
- Network security controls that enforce segmentation and restrict traffic to and from the CDE.
- Systems and network zones that store, process, or transmit cardholder data or sensitive authentication data.

The completed diagram must clearly define the CDE boundary and show how network segmentation and security controls isolate the CDE from untrusted or non-CDE networks.

This form supports evidence collection for PCI DSS v4.0.1 Requirement 1.2.3 and should be retained as part of the organisation’s PCI DSS compliance documentation.

## Instructions

1. Complete this template for each network diagram covering the CDE or any network connected to the CDE.
2. Attach or reference the current approved network diagram in an accessible format, such as PDF, Visio, Lucidchart, draw.io, SVG, or other controlled document format.
3. Ensure the diagram is current and reflects the production environment as implemented, not only as designed.
4. Include all connections between the CDE and other networks, including wireless networks and third-party connections.
5. Clearly mark the CDE boundary using labels, shading, zones, trust levels, or equivalent visual notation.
6. Identify all network security controls that restrict traffic into and out of the CDE, such as firewalls, cloud security groups, network ACLs, routers with ACLs, microsegmentation controls, WAFs, VPN gateways, SD-WAN security policies, or zero trust network access controls.
7. Identify wireless networks and show whether they are connected to, segmented from, or prohibited from accessing the CDE.
8. Include cardholder data flows where applicable, or cross-reference the associated PCI DSS data-flow diagram if maintained separately.
9. Record diagram review and approval details in this template.
10. Update the diagram and this form whenever significant network changes occur, including changes to segmentation, wireless configuration, third-party connectivity, firewall architecture, CDE scope, cloud networking, payment systems, remote access paths, or cardholder data flows.
11. At minimum, review the diagram at the organisation’s defined periodic review interval and before each PCI DSS assessment.
12. Do not include sensitive authentication data, full PAN values, encryption keys, secrets, passwords, or firewall rule details beyond what is necessary to demonstrate connectivity and boundaries.
13. Store the completed template and diagram in the approved compliance evidence repository.

## Form Fields

| Field | Type | Required | Guidance |
|---|---:|:---:|---|
| Diagram Title | Text | Yes | Enter the formal title of the network diagram, such as “PCI CDE Network Diagram – Production”. |
| Diagram ID / Reference Number | Text | Yes | Provide a unique identifier for the diagram to support version control and audit traceability. |
| Diagram Version | Text | Yes | Enter the current version number of the diagram. This should match the attached or referenced diagram file. |
| Diagram Owner | Name / Role | Yes | Identify the accountable owner responsible for diagram accuracy, typically Network Security, Infrastructure, Cloud Network Engineering, or PCI Compliance. |
| Business Area / Environment | Text | Yes | Specify the covered environment, such as production, corporate, retail stores, call centre, e-commerce, cloud, data centre, or hybrid environment. |
| Diagram File Name / Link | Link / File Reference | Yes | Provide the location of the approved diagram in the document repository. The link must be accessible to authorised reviewers and assessors. |
| Diagram Format | Selection | Yes | Indicate the format, such as PDF, Visio, Lucidchart, draw.io, SVG, PNG, or architecture repository record. |
| Date Created | Date | Yes | Enter the date the diagram was originally created. |
| Last Updated Date | Date | Yes | Enter the most recent date the diagram was updated to reflect network changes. |
| Last Reviewed Date | Date | Yes | Enter the most recent date the diagram was reviewed for PCI DSS accuracy. |
| Next Scheduled Review Date | Date | Yes | Enter the next planned review date in line with the organisation’s PCI DSS evidence review cycle. |
| Prepared By | Name / Role | Yes | Identify the person who prepared or updated the diagram. |
| Reviewed By | Name / Role | Yes | Identify the technical reviewer who validated accuracy of connections, boundaries, and security controls. |
| Approved By | Name / Role | Yes | Identify the authorised approver, such as the Network Security Manager, CISO delegate, or PCI Compliance Owner. |
| PCI DSS Scope Covered | Multi-line Text | Yes | Describe the CDE scope represented by the diagram, including in-scope network segments, payment channels, systems, facilities, cloud accounts, or environments. |
| CDE Boundary Clearly Identified | Yes / No | Yes | Confirm whether the diagram visually and explicitly identifies the CDE boundary. The boundary should distinguish CDE components from connected-to or security-impacting systems. |
| CDE Boundary Description | Multi-line Text | Yes | Describe how the CDE boundary is represented, such as labelled zones, colour coding, subnet groupings, firewall zones, cloud VPCs/VNETs, security groups, or segmentation domains. |
| CDE Network Segments / Subnets | Table / Multi-line Text | Yes | List all CDE network segments, VLANs, subnets, cloud subnets, security zones, or equivalent network constructs. Include production and management segments where applicable. |
| Connected Non-CDE Networks | Table / Multi-line Text | Yes | List all networks connected to the CDE, including corporate LAN, user networks, management networks, DMZs, guest networks, development/test networks, third-party networks, cloud networks, and remote access networks. |
| Internet Connections Shown | Yes / No / N/A | Yes | Confirm that all internet ingress and egress paths connected to or affecting the CDE are shown, including proxies, NAT gateways, internet gateways, load balancers, and perimeter firewalls. |
| Wireless Networks Included | Yes / No / N/A | Yes | Confirm that all wireless networks in or connected to CDE locations are included, including corporate Wi-Fi, guest Wi-Fi, POS Wi-Fi, warehouse Wi-Fi, handheld scanner Wi-Fi, and third-party managed wireless. |
| Wireless Network Details | Table / Multi-line Text | Conditional | Required if wireless exists in facilities, cloud-managed networks, retail locations, or locations connected to the CDE. Include SSID, purpose, segmentation method, authentication method, and CDE connectivity status. |
| Third-Party Connections Included | Yes / No / N/A | Yes | Confirm that all third-party connections to the CDE or connected networks are shown, including payment processors, managed service providers, support vendors, logistics providers, call centre providers, and cloud providers. |
| Third-Party Connection Details | Table / Multi-line Text | Conditional | Required where third-party connections exist. Include provider, business purpose, connection type, source/destination, security controls, and whether the provider is in PCI DSS scope. |
| Remote Access Paths Included | Yes / No / N/A | Yes | Confirm that remote access paths into CDE or connected networks are shown, such as VPN, ZTNA, bastion hosts, jump servers, privileged access workstations, or vendor remote support. |
| Cloud Network Connectivity Included | Yes / No / N/A | Yes | Confirm that cloud network elements are included where applicable, such as VPCs/VNETs, subnets, route tables, peering, transit gateways, private endpoints, VPNs, direct-connect circuits, firewalls, and security groups. |
| Data Centre / Facility Connectivity Included | Yes / No / N/A | Yes | Confirm that data centre, co-location, branch, retail, office, and warehouse connectivity to the CDE is represented where applicable. |
| Network Security Controls Shown | Yes / No | Yes | Confirm that security controls enforcing traffic restrictions to and from the CDE are shown, including firewalls, ACLs, security groups, IDS/IPS, WAF, segmentation gateways, and VPN concentrators. |
| Segmentation Controls Description | Multi-line Text | Yes | Describe the technical controls that separate the CDE from non-CDE networks, including firewall zones, VLANs, VRFs, cloud security groups, microsegmentation, NAC, routing controls, or physical separation. |
| Traffic Direction Indicated | Yes / No | Yes | Confirm the diagram indicates direction of major traffic flows to and from the CDE where relevant. Direction may be shown using arrows, labels, or flow references. |
| Cardholder Data Flows Referenced | Yes / No / N/A | Yes | Confirm whether the network diagram shows cardholder data flows directly or references the separate PCI DSS data-flow diagram. |
| Associated Data-Flow Diagram Reference | Link / Document Reference | Conditional | Required if data flows are maintained separately. Provide the document ID, title, version, and link. |
| Payment Channels Represented | Multi-select / Text | Yes | Identify payment channels represented, such as e-commerce, point-of-sale, mail order/telephone order, recurring billing, mobile payment, call centre, kiosk, or payment gateway integration. |
| In-Scope System Categories Shown | Multi-line Text | Yes | Confirm system categories shown on the diagram, such as payment applications, POS devices, databases, web servers, API gateways, jump hosts, domain services supporting the CDE, logging platforms, vulnerability scanners, and management systems. |
| Security-Impacting Systems Shown | Multi-line Text | Yes | Identify connected-to or security-impacting systems that can affect CDE security, such as identity providers, DNS, NTP, logging/SIEM, patch management, endpoint management, monitoring, backup, configuration management, and administrative systems. |
| Out-of-Scope Networks Identified | Yes / No / N/A | Yes | Confirm that out-of-scope networks are labelled as such and show the segmentation controls preventing access to the CDE. |
| Network Trust Zones Labelled | Yes / No | Yes | Confirm the diagram labels trust zones, such as CDE, DMZ, corporate, guest, management, internet, third-party, cloud, and out-of-scope zones. |
| Connection Types Identified | Multi-line Text | Yes | List connection types shown, such as Ethernet, Wi-Fi, VPN, MPLS, SD-WAN, IPSec tunnel, TLS API connection, private circuit, cloud peering, direct connect, transit gateway, or vendor remote support. |
| IP Addressing / Subnet Details Included | Yes / No / Partial | Yes | Confirm whether the diagram includes sufficient network addressing detail for assessor validation. Full host-level addressing is not required unless necessary for clarity. |
| Change Reference / Ticket Number | Text | Conditional | Required if this version was updated due to a change. Provide the approved change record, project ID, firewall change ticket, or architecture decision reference. |
| Reason for Update | Multi-line Text | Conditional | Required if the diagram was updated. Describe what changed, such as new firewall zone, subnet migration, wireless change, new cloud VPC, new third-party tunnel, or CDE scope revision. |
| Validation Method | Multi-select | Yes | Identify how diagram accuracy was validated, such as firewall configuration review, cloud network configuration review, router/switch review, wireless controller review, CMDB comparison, network scan, change ticket review, or engineering walkthrough. |
| Validation Evidence Reference | Link / Document Reference | Conditional | Provide links to supporting evidence used to validate accuracy where applicable, such as firewall exports, cloud architecture review, network inventory, wireless SSID list, or change approval. |
| Exceptions / Gaps Identified | Yes / No | Yes | Indicate whether any missing, outdated, uncertain, or inaccurate elements were identified during review. |
| Exception / Gap Details | Multi-line Text | Conditional | Required if exceptions or gaps exist. Describe the issue, affected network area, risk, owner, remediation action, and target date. |
| Diagram Completeness Attestation | Checkbox | Yes | Preparer must confirm: “I attest that this diagram has been prepared or updated to accurately reflect all known CDE connections, including wireless and third-party connections, as of the review date.” |
| Reviewer Validation Attestation | Checkbox | Yes | Reviewer must confirm: “I have reviewed the diagram against available network, wireless, cloud, and security control records and consider it accurate for PCI DSS Requirement 1.2.3.” |
| Approval Status | Selection | Yes | Select Draft, Under Review, Approved, Approved with Exceptions, Superseded, or Retired. |
| Approval Date | Date | Conditional | Required when Approval Status is Approved or Approved with Exceptions. |
| Comments / Notes | Multi-line Text | No | Record additional context useful for PCI DSS assessment, such as diagram limitations, related diagrams, review observations, or planned architecture changes. |

### CDE Network Segment Register

Use this table to document the CDE network segments represented in the diagram.

| Segment / Zone Name | Environment | VLAN / Subnet / Cloud Network | Location / Platform | Primary Purpose | Stores, Processes, or Transmits CHD? | Segmentation Control | Diagram Reference |
|---|---|---|---|---|---|---|---|
| [CDE Segment Name] | Production | [VLAN/Subnet/VPC/VNET] | [Data Centre/Cloud/Facility] | [Purpose] | Yes / No | [Firewall/Security Group/ACL/etc.] | [Page/Layer/Reference] |
| [CDE Segment Name] | Production | [VLAN/Subnet/VPC/VNET] | [Data Centre/Cloud/Facility] | [Purpose] | Yes / No | [Firewall/Security Group/ACL/etc.] | [Page/Layer/Reference] |

### Connected Network Register

Use this table to document all networks connected to the CDE or to security-impacting CDE systems.

| Connected Network | Network Type | Connection to CDE | Direction of Connectivity | Business Purpose | Security Control Enforcing Access | PCI DSS Scope Status | Diagram Reference |
|---|---|---|---|---|---|---|---|
| [Network Name] | Corporate / DMZ / Cloud / Third Party / Wireless / Remote Access / Other | Direct / Indirect | Inbound / Outbound / Bidirectional | [Purpose] | [Control] | In Scope / Connected-to / Security-Impacting / Out of Scope | [Reference] |
| [Network Name] | Corporate / DMZ / Cloud / Third Party / Wireless / Remote Access / Other | Direct / Indirect | Inbound / Outbound / Bidirectional | [Purpose] | [Control] | In Scope / Connected-to / Security-Impacting / Out of Scope | [Reference] |

### Wireless Network Register

Use this table to document all wireless networks in facilities or environments connected to, adjacent to, or capable of impacting the CDE.

| SSID / Wireless Network | Location(s) | Purpose | Authentication / Encryption | Network Segment | CDE Connectivity | Segmentation Method | Managed By | Diagram Reference |
|---|---|---|---|---|---|---|---|---|
| [SSID] | [Location] | Corporate / Guest / POS / Warehouse / Vendor / Other | [WPA2/WPA3/802.1X/etc.] | [VLAN/Subnet] | None / Direct / Indirect / Prohibited | [Firewall/ACL/NAC/etc.] | [Team/Provider] | [Reference] |
| [SSID] | [Location] | Corporate / Guest / POS / Warehouse / Vendor / Other | [WPA2/WPA3/802.1X/etc.] | [VLAN/Subnet] | None / Direct / Indirect / Prohibited | [Firewall/ACL/NAC/etc.] | [Team/Provider] | [Reference] |

### Third-Party Connection Register

Use this table to document third-party connections shown on the network diagram.

| Third Party | Service Provided | Connection Type | Source Network | Destination Network / System | Direction | Security Control | PCI DSS Relevance | Diagram Reference |
|---|---|---|---|---|---|---|---|---|
| [Third Party Name] | [Service] | VPN / Private Link / API / Remote Access / MPLS / Other | [Source] | [Destination] | Inbound / Outbound / Bidirectional | [Firewall/VPN/MFA/ACL/etc.] | In Scope / Service Provider / Connected-to / Security-Impacting | [Reference] |
| [Third Party Name] | [Service] | VPN / Private Link / API / Remote Access / MPLS / Other | [Source] | [Destination] | Inbound / Outbound / Bidirectional | [Firewall/VPN/MFA/ACL/etc.] | In Scope / Service Provider / Connected-to / Security-Impacting | [Reference] |

### Diagram Review Checklist

Complete this checklist before routing the diagram for approval.

| Review Item | Status | Reviewer Notes |
|---|---|---|
| CDE boundary is clearly marked and labelled. | Pass / Fail / N/A | [Notes] |
| All connections into and out of the CDE are shown. | Pass / Fail / N/A | [Notes] |
| Wireless networks are included or explicitly marked not applicable. | Pass / Fail / N/A | [Notes] |
| Third-party connections are included or explicitly marked not applicable. | Pass / Fail / N/A | [Notes] |
| Internet ingress and egress paths are represented. | Pass / Fail / N/A | [Notes] |
| Remote access paths to the CDE or connected networks are represented. | Pass / Fail / N/A | [Notes] |
| Cloud connectivity, if applicable, is represented accurately. | Pass / Fail / N/A | [Notes] |
| Network security controls enforcing CDE segmentation are shown. | Pass / Fail / N/A | [Notes] |
| Out-of-scope networks are labelled and segmentation controls are identifiable. | Pass / Fail / N/A | [Notes] |
| Major traffic direction or connectivity relationship is clear. | Pass / Fail / N/A | [Notes] |
| Diagram aligns with current network, firewall, wireless, and cloud configurations. | Pass / Fail / N/A | [Notes] |
| Diagram aligns with associated PCI DSS data-flow diagram or references it. | Pass / Fail / N/A | [Notes] |
| Diagram has a version number, owner, date, and approval status. | Pass / Fail / N/A | [Notes] |
| No prohibited sensitive data, secrets, passwords, or full PAN values are included. | Pass / Fail / N/A | [Notes] |

## Approval / Routing

The completed Network Diagram template and associated diagram must be routed for review and approval before being accepted as PCI DSS evidence.

| Role | Responsibility | Approval Required |
|---|---|---:|
| Diagram Preparer | Creates or updates the diagram and completes this template using current network, wireless, cloud, third-party, and security control information. | No |
| Network Security Reviewer | Validates that CDE connections, segmentation controls, ingress and egress points, and network security control locations are accurately represented. | Yes |
| Wireless / Network Infrastructure Reviewer | Validates wireless networks, switching, routing, VLANs, WAN, SD-WAN, and physical or site connectivity where applicable. | Conditional |
| Cloud Network Reviewer | Validates cloud network architecture, routing, security groups, cloud firewalls, VPC/VNET peering, private links, and connectivity where applicable. | Conditional |
| PCI Compliance Owner | Confirms the diagram meets PCI DSS evidence expectations for Requirement 1.2.3 and aligns with PCI DSS scope documentation. | Yes |
| Change Manager / CAB Representative | Confirms major network changes have appropriate change references where the diagram was updated due to a controlled change. | Conditional |
| Information Security Approver | Provides final approval or approval with documented exceptions. | Yes |

### Approval Record

| Approval Stage | Name / Role | Decision | Date | Comments |
|---|---|---|---|---|
| Prepared By | [Name / Role] | Submitted | [Date] | [Comments] |
| Technical Review | [Name / Role] | Approved / Rejected / Approved with Exceptions | [Date] | [Comments] |
| PCI Compliance Review | [Name / Role] | Approved / Rejected / Approved with Exceptions | [Date] | [Comments] |
| Final Approval | [Name / Role] | Approved / Rejected / Approved with Exceptions | [Date] | [Comments] |

A diagram approved with exceptions may be used as interim evidence only when:

- The exceptions are documented in this template.
- The exceptions do not obscure the CDE boundary or omit material CDE connections.
- A remediation owner and target completion date are assigned.
- The PCI Compliance Owner accepts the residual evidence limitation.
- The final approved diagram is completed before the PCI DSS assessment evidence submission deadline, unless otherwise accepted by the assessor.

## Records & Retention

The completed Network Diagram template, approved diagram file, review checklist, approval record, and supporting validation evidence must be retained in the organisation’s PCI DSS evidence repository.

| Record | Retention Requirement | Storage Location | Access Restrictions |
|---|---|---|---|
| Completed Network Diagram Template | Retain for at least one PCI DSS assessment cycle or longer if required by organisational policy. | [Compliance Evidence Repository] | Restricted to authorised PCI, Information Security, Network, Audit, and Assessor personnel. |
| Approved Network Diagram File | Retain current approved version and prior versions sufficient to demonstrate change history and assessment-period coverage. | [Architecture / Diagram Repository] | Restricted to authorised personnel due to sensitive network architecture information. |
| Approval Record | Retain with the corresponding diagram version. | [Compliance Evidence Repository] | Restricted to authorised PCI, Information Security, Network, Audit, and Assessor personnel. |
| Validation Evidence | Retain with or cross-reference from the diagram review record. | [Evidence Repository / Change System / Configuration Repository] | Restricted based on sensitivity of firewall, cloud, wireless, and network configuration details. |
| Exception / Gap Records | Retain until closure and for the associated PCI DSS assessment cycle. | [Risk / Issue Tracking System] | Restricted to authorised risk, security, compliance, and remediation owners. |
| Superseded Diagram Versions | Retain according to document control requirements and PCI DSS evidence needs. | [Controlled Document Repository] | Restricted to authorised personnel. |

Network diagrams and related templates are classified as Internal Confidential because they describe CDE boundaries, connectivity, network segmentation, security controls, third-party connections, and potential attack paths. Distribution must be limited to personnel with a business need, authorised service providers, internal audit, and PCI DSS assessors under appropriate confidentiality arrangements.

Records must not be stored in unmanaged personal drives, email archives, chat channels, or uncontrolled collaboration spaces. Superseded versions must be clearly marked as superseded or archived to prevent accidental use as current PCI DSS evidence.