<!-- pci_dss_v4 / PCI-003 | type=Form/Template | mode=markdown | model=gpt-5.5 | 26867 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [PCI-FRM-CHD-FLOW-001] | 1.0 | [CDE Owner / PCI Compliance Owner] | [YYYY-MM-DD] | PCI DSS v4.0.1 | Requirement 1.2.4 | Confidential |

## Purpose

This form/template is used to document and maintain an accurate Cardholder Data and Sensitive Authentication Data flow diagram for the organisation’s Cardholder Data Environment (CDE), in support of PCI DSS v4.0.1 Requirement 1.2.4.

PCI DSS Requirement 1.2.4 requires that an accurate network diagram and data-flow diagram are maintained and reviewed at least once every 12 months and whenever significant changes occur. This template specifically captures the flow of cardholder data (CHD) and sensitive authentication data (SAD), including where it enters, traverses, is processed, is transmitted, is stored, and exits the environment.

The completed template is intended to demonstrate that the organisation has:

- Identified all CHD/SAD flows across systems, networks, applications, third parties, and supporting infrastructure.
- Documented inbound, internal, outbound, and administrative/supporting data flows relevant to the CDE.
- Identified whether CHD/SAD is stored, processed, transmitted, or only transiently present.
- Mapped each flow to relevant system components, network segments, security controls, encryption mechanisms, and trust boundaries.
- Reviewed the diagram and supporting data-flow inventory at least annually and after significant changes.
- Retained auditable evidence of review, approval, and change history.

## Instructions

1. Complete this template for each in-scope cardholder data flow or set of closely related flows.
2. Attach or reference the current approved Cardholder Data Flow Diagram showing:
 - All locations where CHD/SAD enters the environment.
 - All systems, applications, databases, APIs, queues, file transfers, terminals, payment channels, and service providers involved.
 - All storage locations for CHD.
 - Any SAD presence, including whether SAD is transient and removed after authorization.
 - All network segments, trust boundaries, security zones, and third-party connections.
 - All outbound flows, including payment processors, gateways, acquirers, fraud platforms, tokenization providers, settlement platforms, reporting platforms, and support tools.
3. Use this form to support and validate the diagram. The diagram and this form should be consistent with:
 - The PCI DSS scope definition.
 - The current network diagram.
 - Asset inventory.
 - Application inventory.
 - Data retention standards.
 - Firewall/router rule documentation.
 - Third-party service provider inventory.
 - Change management records.
4. Complete one row per unique data flow in the “Data Flow Inventory” section of the form fields. A unique flow is defined by a distinct source, destination, system path, protocol, data element set, or business process.
5. Identify the data elements present in each flow, including whether the flow includes:
 - Primary Account Number (PAN).
 - Cardholder name.
 - Expiration date.
 - Service code.
 - Full track data.
 - Card verification code/value.
 - PIN or PIN block.
 - Tokens.
 - Truncated, masked, or hashed PAN.
6. Sensitive Authentication Data must not be stored after authorization, even if encrypted, unless explicitly permitted by PCI DSS for issuers and issuer processors. Any presence of SAD must be clearly marked as transient, with removal controls documented.
7. Confirm whether CHD is encrypted during transmission across open, public, or untrusted networks and whether strong cryptography is used.
8. Confirm whether CHD is stored, tokenized, truncated, rendered unreadable, or otherwise protected.
9. Ensure that all diagrams and supporting information are reviewed:
 - At least once every 12 months.
 - After significant changes, including but not limited to new payment channels, new applications, changes to segmentation, new service providers, changes to payment processors, new data storage locations, or changes to firewall/security architecture.
10. This form must be completed by the CDE/process owner and reviewed by PCI compliance, network/security architecture, application/data owners, and other stakeholders as defined in the Approval / Routing section.
11. Do not include live PAN, SAD, credentials, encryption keys, or customer records in this form or in any attached diagram.
12. Store the completed form and associated diagram in the approved PCI evidence repository with access restricted to personnel with a business need to know.

## Form Fields

| Field | Type | Required | Guidance |
|---|---|---:|---|
| Form Identifier | Text | Yes | Unique identifier for this completed data-flow record, for example `[CDFD-YYYY-###]`. |
| Diagram Name | Text | Yes | Name of the associated cardholder data flow diagram. |
| Diagram Version | Text | Yes | Current approved version of the diagram. |
| Diagram Location / Link | URL / Repository Path | Yes | Link or controlled repository path to the approved diagram. Do not link to uncontrolled local files. |
| Business Process Name | Text | Yes | Name of the payment or CHD-related process, such as e-commerce authorization, call centre payment, recurring billing, chargeback handling, settlement, reconciliation, or refund processing. |
| Business Process Owner | Name / Role | Yes | Owner accountable for the business process and accuracy of the documented flow. |
| Technical Owner | Name / Role | Yes | Owner accountable for supporting systems, integrations, and technical accuracy of the flow. |
| PCI Scope Category | Selection | Yes | Indicate whether the flow is `In CDE`, `Connected-to CDE`, `Security-Impacting`, `Out of Scope via Segmentation`, or `Service Provider Managed`. |
| Flow ID | Text | Yes | Unique identifier for each documented flow, for example `FLOW-001`. Must be reflected on the diagram. |
| Flow Description | Text | Yes | Brief description of what the flow represents and why it exists. |
| Payment Channel | Selection | Yes | Examples: `E-commerce`, `Retail POS`, `MOTO`, `Call Centre`, `Mobile App`, `Back Office`, `Batch File`, `API`, `Recurring Billing`, `Third Party Hosted Payment Page`. |
| Flow Direction | Selection | Yes | Indicate `Inbound`, `Internal`, `Outbound`, `Bidirectional`, or `Administrative/Support`. |
| Source Entity / System | Text | Yes | System, application, user group, device type, network, third party, or endpoint where the flow originates. |
| Source Owner | Name / Role / Third Party | Yes | Owner of the source system or entity. |
| Source Network Segment / Zone | Text | Yes | Network segment, VLAN, subnet, cloud VPC/VNet, security zone, or hosting location. |
| Destination Entity / System | Text | Yes | System, application, database, API, queue, processor, service provider, or endpoint receiving the flow. |
| Destination Owner | Name / Role / Third Party | Yes | Owner of the destination system or entity. |
| Destination Network Segment / Zone | Text | Yes | Network segment, VLAN, subnet, cloud VPC/VNet, security zone, or hosting location. |
| Intermediary Components | Text | Conditional | List proxies, load balancers, WAFs, API gateways, firewalls, message queues, file transfer servers, middleware, tokenization services, or logging platforms that handle or route the flow. Required where applicable. |
| Trust Boundary Crossed | Yes/No | Yes | Indicate whether the flow crosses a trust boundary, such as internet to DMZ, DMZ to CDE, corporate to CDE, cloud to on-premises, or organisation to third party. |
| Trust Boundary Description | Text | Conditional | Required if a trust boundary is crossed. Describe boundary and security controls protecting it. |
| CHD Present | Yes/No | Yes | Indicate whether cardholder data is present in this flow. |
| SAD Present | Yes/No | Yes | Indicate whether sensitive authentication data is present. SAD includes full track data, card verification code/value, and PIN/PIN block. |
| PAN Present | Yes/No | Yes | Indicate whether full PAN is present. If only tokens or truncated PAN are used, select `No` and document details in Data Elements. |
| Data Elements Included | Multi-select / Text | Yes | Identify actual data elements: PAN, cardholder name, expiration date, service code, full track data, CAV2/CVC2/CVV2/CID, PIN/PIN block, token, truncated PAN, masked PAN, hashed PAN, transaction ID, authorization code. |
| SAD Handling Description | Text | Conditional | Required if SAD is present. Explain when and why SAD is present, whether it is transient, and how it is securely deleted or prevented from storage after authorization. |
| Storage Occurs | Yes/No | Yes | Indicate whether CHD is stored at any point in this flow, including databases, files, logs, reports, caches, queues, backups, object storage, or temporary locations. |
| Storage Location(s) | Text | Conditional | Required if storage occurs. Identify application, database, file store, queue, archive, backup, or third-party storage location. |
| Storage Duration / Retention | Text | Conditional | Required if storage occurs. State retention period and reference applicable data retention requirement or standard. |
| CHD Rendered Unreadable at Rest | Selection | Conditional | Required if storage occurs. Indicate method: `Strong cryptography`, `Truncation`, `Tokenization`, `Hashing`, `Other`, or `Not Applicable`. |
| Transmission Protocol | Text | Yes | Identify protocol and port, such as HTTPS/TLS 1.2+, SFTP/SSH, VPN/IPsec, MQ TLS, database TLS, private connectivity, or processor-specific protocol. |
| Transmission Protection | Text | Yes | Describe encryption or protection mechanism for CHD in transit, including strong cryptography and certificate/key management where relevant. |
| Open/Public/Untrusted Network Used | Yes/No | Yes | Indicate whether the flow traverses the internet, wireless network, public cloud shared services, corporate network, third-party network, or other untrusted network. |
| Authentication Method | Text | Conditional | Required for system-to-system, administrative, API, file transfer, or third-party flows. Include mutual TLS, API keys, certificates, OAuth, SSO, service accounts, VPN authentication, or other method. |
| Authorization / Access Control | Text | Yes | Describe how access to the flow, data, or system is restricted to authorised users, services, or components. |
| Segmentation Control Reference | Text | Conditional | Required where segmentation is relied upon to limit PCI DSS scope. Reference firewall rules, security groups, ACLs, routing controls, or segmentation validation evidence. |
| Firewall / Security Rule Reference | Text | Conditional | Reference applicable firewall, router ACL, cloud security group, WAF, proxy, or API gateway rule IDs supporting the flow. Required where network controls permit the flow. |
| Logging / Monitoring Coverage | Text | Yes | Identify logging and monitoring for this flow, including application logs, firewall logs, IDS/IPS, SIEM use cases, file transfer logs, API gateway logs, or payment platform logs. |
| Logging CHD/SAD Risk Reviewed | Yes/No | Yes | Confirm that logs do not capture SAD and do not expose full PAN unless explicitly justified and protected. |
| Third Party / Service Provider Involved | Yes/No | Yes | Indicate whether any third party stores, processes, transmits, routes, secures, or can impact CHD/SAD for this flow. |
| Third Party Name | Text | Conditional | Required if a third party is involved. Use provider name, such as payment gateway, processor, acquirer, hosting provider, call recording provider, tokenization provider, fraud service, or managed service provider. |
| Third Party Role | Text | Conditional | Required if a third party is involved. Describe the service provider’s role in the CHD/SAD flow. |
| Third Party PCI Responsibility Reference | Text | Conditional | Reference service provider PCI DSS AOC, responsibility matrix, contract clause, or vendor record. |
| Associated Applications | Text | Yes | List applications involved in or supporting the flow. |
| Associated System Components | Text | Yes | List servers, databases, APIs, queues, endpoints, network devices, containers, cloud services, storage services, or security tools. |
| Associated Data Stores | Text | Conditional | List all databases, file shares, storage buckets, queues, archives, or backup repositories touched by the flow. Required where any storage, caching, queuing, reporting, or backup occurs. |
| Tokenization Used | Yes/No | Yes | Indicate whether a tokenization solution replaces PAN in the flow. |
| Tokenization Provider / System | Text | Conditional | Required if tokenization is used. Identify internal or external tokenization provider/system. |
| Masking / Truncation Used | Yes/No | Yes | Indicate whether PAN is masked or truncated in displays, reports, logs, or downstream systems. |
| Downstream Use of CHD | Text | Yes | Describe any downstream business use such as authorization, settlement, refund, reconciliation, chargeback, fraud analysis, reporting, recurring payment, or customer support. |
| Related Change Record(s) | Text | Conditional | Reference change tickets if this flow is new, modified, retired, or reviewed due to a significant change. |
| Significant Change Trigger | Selection | Yes | Indicate `Annual Review`, `New Flow`, `Modified Flow`, `Retired Flow`, `New Third Party`, `Architecture Change`, `Segmentation Change`, `Application Change`, `Processor Change`, `Cloud/Hosting Change`, or `Other`. |
| Diagram Updated | Yes/No | Yes | Confirm the attached or referenced diagram has been updated to reflect this flow accurately. |
| Network Diagram Consistency Confirmed | Yes/No | Yes | Confirm consistency with the current network diagram required under PCI DSS v4.0.1 Requirement 1.2.4. |
| PCI Scope Inventory Consistency Confirmed | Yes/No | Yes | Confirm consistency with the PCI system component inventory and CDE scope documentation. |
| Data Discovery / Validation Method | Text | Yes | Describe how the flow was validated, such as architecture review, interviews, packet capture, DLP scan, database discovery, application review, firewall review, code review, log review, or vendor documentation. |
| Validation Evidence Reference | Text | Yes | Reference evidence supporting the flow, such as screenshots, architecture documents, configuration exports, firewall rules, data discovery results, change tickets, or service provider documentation. |
| Exceptions / Gaps Identified | Text | No | Document any discrepancies, missing controls, unapproved flows, undocumented storage, unexpected CHD/SAD presence, or remediation needs. |
| Remediation Owner | Name / Role | Conditional | Required if exceptions or gaps are identified. |
| Remediation Due Date | Date | Conditional | Required if exceptions or gaps are identified. |
| Current Flow Status | Selection | Yes | Indicate `Approved`, `Approved with Remediation`, `Pending Review`, `Rejected`, `Retired`, or `Superseded`. |
| Last Review Date | Date | Yes | Date the flow and diagram were last reviewed. |
| Next Review Due Date | Date | Yes | Must be no later than 12 months from the last review date, unless an earlier review is required by organisational policy. |
| Prepared By | Name / Role | Yes | Individual completing the template. |
| Prepared Date | Date | Yes | Date the form was prepared or updated. |
| Reviewer Comments | Text | No | Comments from technical, security, compliance, or business reviewers. |
| Final Approval Date | Date | Conditional | Required once approved. |
| Approved Version / Baseline | Text | Conditional | Approved diagram and form baseline version. |

### Data Flow Inventory

Complete the table below for each CHD/SAD flow represented in the diagram.

| Flow ID | Business Process | Source | Destination | Intermediary Components | CHD/SAD Data Elements | Storage? | Protocol / Protection | Trust Boundary | Third Party | Diagram Ref |
|---|---|---|---|---|---|---|---|---|---|---|
| FLOW-001 | [E-commerce authorization] | [Customer browser] | [Payment gateway hosted page] | [WAF / CDN] | [PAN, expiry, CVV entered directly to gateway] | No | HTTPS/TLS 1.2+ | Internet to third party | [Payment Gateway] | [Diagram node/connector ID] |
| FLOW-002 | [Authorization response] | [Payment gateway] | [E-commerce application] | [API gateway] | [Token, masked PAN, auth code] | Yes | HTTPS/TLS 1.2+ with API authentication | Third party to CDE/connected system | [Payment Gateway] | [Diagram node/connector ID] |
| FLOW-003 | [Settlement batch] | [Payment platform] | [Acquirer / processor] | [Managed file transfer service] | [Token, transaction ID, amount, masked PAN] | Yes | SFTP/SSH or mutually authenticated TLS | CDE to third party | [Processor] | [Diagram node/connector ID] |
| FLOW-004 | [Customer support lookup] | [Support application] | [Token vault / payment platform] | [Internal API] | [Token, masked PAN] | Yes | HTTPS/TLS 1.2+ | Corporate to restricted zone | No | [Diagram node/connector ID] |

### CHD/SAD Data Element Matrix

Use this table to document the specific data elements present in each flow and whether they are stored, transmitted, processed, or only transient.

| Flow ID | PAN | Cardholder Name | Expiration Date | Service Code | Full Track Data | CAV2/CVC2/CVV2/CID | PIN/PIN Block | Token | Masked/Truncated PAN | Stored? | Transient Only? | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| FLOW-001 | Yes | Conditional | Yes | No | No | Yes | No | No | No | No | Yes | CVV is entered directly to payment gateway and not stored by the organisation. |
| FLOW-002 | No | Conditional | Conditional | No | No | No | No | Yes | Yes | Yes | No | Token and masked PAN retained for order management and refunds. |
| FLOW-003 | No | No | No | No | No | No | No | Yes | Yes | Yes | No | Settlement file contains tokenized transaction references only. |
| FLOW-004 | No | Conditional | No | No | No | No | No | Yes | Yes | Yes | No | Support users see masked PAN only where role-authorised. |

### Storage Location Register

Complete this section for any flow where CHD, tokenized CHD, masked PAN, truncated PAN, or payment-related data is stored.

| Storage ID | Flow ID | System / Repository | Data Stored | CHD Stored? | SAD Stored? | Protection Method | Retention Period | Backup Included? | Owner |
|---|---|---|---|---:|---:|---|---|---:|---|
| STORE-001 | FLOW-002 | [Order Management Database] | [Token, masked PAN, auth code, transaction ID] | No | No | Role-based access, database encryption, logging | [Retention period] | Yes | [Application Owner] |
| STORE-002 | FLOW-003 | [Settlement File Archive] | [Settlement file, token, transaction ID, masked PAN] | No | No | Encrypted storage, restricted access, managed file transfer logs | [Retention period] | Yes | [Finance Systems Owner] |
| STORE-003 | [FLOW-ID] | [System / repository] | [Data elements] | [Yes/No] | No | [Protection method] | [Retention period] | [Yes/No] | [Owner] |

### Trust Boundary and Control Mapping

Document the security boundaries crossed by each CHD/SAD flow and the controls that permit or protect the flow.

| Boundary ID | Flow ID | Boundary Description | Source Zone | Destination Zone | Control Type | Control Reference / Rule ID | Validation Evidence |
|---|---|---|---|---|---|---|---|
| BND-001 | FLOW-001 | Internet user traffic to hosted payment gateway | Internet | Third-party payment environment | TLS, WAF/CDN, gateway controls | [Provider control reference] | [Gateway AOC / architecture document] |
| BND-002 | FLOW-002 | Payment gateway API to application environment | Third-party network | [Application security zone] | Firewall rule, API authentication, TLS | [FW-Rule-ID / API policy] | [Firewall export / API config evidence] |
| BND-003 | FLOW-004 | Corporate support network to restricted payment services | Corporate network | Restricted payment services zone | Segmentation firewall, RBAC, monitoring | [FW-Rule-ID / IAM group] | [Segmentation test / access review] |

### Annual and Change-Driven Review Log

The cardholder data flow diagram and this supporting form must be reviewed at least annually and whenever significant changes occur.

| Review Date | Review Type | Scope of Review | Reviewer(s) | Changes Identified | Diagram Updated? | Outcome | Next Review Due |
|---|---|---|---|---|---:|---|---|
| [YYYY-MM-DD] | Annual Review | Full CHD/SAD flow review | [Names/Roles] | [None / Summary] | [Yes/No] | [Approved / Remediation Required] | [YYYY-MM-DD] |
| [YYYY-MM-DD] | Significant Change | [New payment channel / new processor / segmentation change] | [Names/Roles] | [Summary] | [Yes/No] | [Approved / Pending Remediation] | [YYYY-MM-DD] |

## Approval / Routing

The completed Cardholder Data Flow Diagram template must be routed for review and approval as follows.

| Role / Function | Responsibility | Required Approval? | Evidence of Review |
|---|---|---:|---|
| Business Process Owner | Confirms the payment process description, business purpose, data usage, retention need, and downstream use of CHD/payment data. | Yes | Signature, workflow approval, or documented review comment. |
| Technical / Application Owner | Confirms systems, applications, APIs, databases, queues, interfaces, and application-level handling of CHD/SAD. | Yes | Signature, workflow approval, architecture review, or application inventory update. |
| Network / Security Architect | Confirms network paths, segmentation, trust boundaries, firewalls, security groups, routing, remote connectivity, and consistency with network diagrams. | Yes | Architecture review record, firewall rule validation, or segmentation evidence. |
| PCI Compliance Owner | Confirms alignment with PCI DSS v4.0.1 Requirement 1.2.4 and that the diagram is reviewed at least annually and after significant changes. | Yes | Compliance approval, evidence repository entry, or control review record. |
| Information Security / GRC | Reviews completeness, control mapping, evidence references, retention, and audit readiness. | Yes | GRC review record or control attestation. |
| Data Protection / Privacy Representative | Reviews privacy, retention, minimisation, and lawful business use where personal data is included. | Conditional | Privacy review record where required. |
| Third-Party / Vendor Management | Confirms service provider involvement, PCI DSS responsibility documentation, AOC status, and contractual coverage. | Conditional | Vendor record, AOC, responsibility matrix, or contract reference. |
| Change Advisory Board / Change Manager | Confirms change records are linked where the diagram is updated due to significant change. | Conditional | Change ticket approval or CAB record. |

### Approval Record

| Approval Role | Name | Decision | Date | Comments |
|---|---|---|---|---|
| Business Process Owner | [Name] | [Approved / Rejected / Approved with Conditions] | [YYYY-MM-DD] | [Comments] |
| Technical / Application Owner | [Name] | [Approved / Rejected / Approved with Conditions] | [YYYY-MM-DD] | [Comments] |
| Network / Security Architect | [Name] | [Approved / Rejected / Approved with Conditions] | [YYYY-MM-DD] | [Comments] |
| PCI Compliance Owner | [Name] | [Approved / Rejected / Approved with Conditions] | [YYYY-MM-DD] | [Comments] |
| Information Security / GRC | [Name] | [Approved / Rejected / Approved with Conditions] | [YYYY-MM-DD] | [Comments] |

A completed form is not considered approved until all required approvers have either approved the record or formally documented conditional approval with assigned remediation actions and due dates.

## Records & Retention

The completed form, approved diagram, review evidence, supporting validation evidence, and approval records must be retained as PCI DSS evidence.

| Record Type | Retention Requirement | Storage Location | Access Restrictions | Minimum Evidence Content |
|---|---|---|---|---|
| Approved Cardholder Data Flow Diagram | Retain current approved version and prior versions for at least [retention period] or as required by the PCI evidence retention standard. | [PCI evidence repository / GRC system] | Restricted to PCI, security, architecture, audit, and approved CDE stakeholders. | Diagram version, approval date, systems, flows, zones, trust boundaries, third parties, and CHD/SAD paths. |
| Completed Cardholder Data Flow Diagram Form | Retain current approved version and prior versions for at least [retention period]. | [PCI evidence repository / GRC system] | Restricted to authorised personnel with business need to know. | Completed form fields, data-flow inventory, storage register, review log, approvals, and evidence references. |
| Annual Review Evidence | Retain for at least [retention period] and make available for PCI DSS assessment. | [PCI evidence repository / GRC system] | Restricted to PCI compliance, security, and audit personnel. | Review date, reviewers, review scope, findings, diagram update status, approval outcome, next review due date. |
| Significant Change Review Evidence | Retain with associated change record and PCI evidence for at least [retention period]. | [Change management system / PCI evidence repository] | Restricted based on change and PCI evidence classification. | Change ticket, impact assessment, updated diagram, updated flow records, approvals, and implementation date. |
| Supporting Validation Evidence | Retain for at least [retention period] or until superseded by updated validation evidence. | [PCI evidence repository / GRC system] | Restricted due to infrastructure and security-sensitive content. | Firewall exports, architecture documents, service provider documentation, application review evidence, data discovery results, log review evidence, or segmentation validation. |
| Service Provider Evidence | Retain for at least [retention period] and refresh according to vendor management and PCI DSS requirements. | [Vendor management system / PCI evidence repository] | Restricted to vendor management, PCI compliance, and security personnel. | AOC, responsibility matrix, contract reference, service description, and evidence of service provider role in CHD/SAD flows. |

Records must be protected from unauthorised modification or deletion. Access must be granted only to personnel with a legitimate business need, as the diagram and flow details may disclose sensitive security architecture, CHD processing paths, third-party integrations, and segmentation controls.

Superseded versions must be clearly marked as retired or replaced, with the effective dates and replacement version identified. The current approved version must be readily available for PCI DSS assessments, internal control testing, architecture reviews, and change impact assessments.