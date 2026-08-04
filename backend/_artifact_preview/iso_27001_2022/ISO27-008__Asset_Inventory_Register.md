<!-- iso_27001_2022 / ISO27-008 | type=Register | mode=table | model=gpt-5.5 | 10397 chars -->

## Asset Inventory / Register (XLSX template)

_Editable template — add your own rows. The example row(s) below are placeholders to replace._

| Asset ID | Asset Name | Asset Description | Asset Type | Information Asset Category | Business Process / Service Supported | Asset Owner | Asset Owner Department | Asset Custodian / Administrator | Users / User Groups | Physical or Logical Location | System / Repository / Platform | Supplier / Third Party | Hosting Model | Information Classification | Personal Data Present | Special Category / Sensitive Personal Data Present | Regulated / Contractual Data Present | Legal / Regulatory / Contractual Requirements | Confidentiality Requirement | Integrity Requirement | Availability Requirement | Business Criticality | Retention Requirement | Backup Requirement | Recovery Requirement | Access Control Reference | Related Risk Assessment Reference | Related Controls / Policies | Lifecycle Status | Date Added to Register | Last Reviewed Date | Next Review Due Date | Disposal / Decommission Date | Disposal Method / Evidence Reference | Comments |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [EXAMPLE: IA-0001] | [EXAMPLE: Customer CRM Database] | [EXAMPLE: Central database containing customer contact details, sales history, and support interactions] | [EXAMPLE: Database] | [EXAMPLE: Customer Data] | [EXAMPLE: Sales and Customer Support] | [EXAMPLE: Head of Sales - Jane Smith] | [EXAMPLE: Sales] | [EXAMPLE: CRM Administration Team] | [EXAMPLE: Sales Users; Support Users; CRM Admins] | [EXAMPLE: EU cloud region] | [EXAMPLE: Salesforce Production Tenant] | [EXAMPLE: Salesforce] | [EXAMPLE: SaaS] | [EXAMPLE: Confidential] | [EXAMPLE: Yes] | [EXAMPLE: No] | [EXAMPLE: Yes] | [EXAMPLE: GDPR; customer contracts; data processing agreement] | [EXAMPLE: High] | [EXAMPLE: High] | [EXAMPLE: High] | [EXAMPLE: Critical] | [EXAMPLE: 7 years after customer relationship ends] | [EXAMPLE: Vendor-managed daily backup] | [EXAMPLE: RTO 8h / RPO 24h] | [EXAMPLE: CRM-RBAC-Matrix-v1.2] | [EXAMPLE: RISK-CRM-001; DPIA-2025-003] | [EXAMPLE: Access Control Policy; Classification Policy; Backup Policy; A.5.9; A.5.12; A.5.15] | [EXAMPLE: Active] | [EXAMPLE: 2025-01-15] | [EXAMPLE: 2025-06-30] | [EXAMPLE: 2025-12-30] | [EXAMPLE: N/A] | [EXAMPLE: N/A] | [EXAMPLE: Annual owner review required due to customer personal data] |
| [EXAMPLE: IA-0002] | [EXAMPLE: Board Meeting Minutes Archive] | [EXAMPLE: Repository of approved board papers, meeting minutes, resolutions, and strategic documents] | [EXAMPLE: Information] | [EXAMPLE: Legal Records] | [EXAMPLE: Corporate Governance] | [EXAMPLE: Company Secretary - Alex Chen] | [EXAMPLE: Legal] | [EXAMPLE: Records Management Team] | [EXAMPLE: Board Members; Legal Team] | [EXAMPLE: SharePoint Legal Site] | [EXAMPLE: Microsoft 365 SharePoint] | [EXAMPLE: Microsoft] | [EXAMPLE: SaaS] | [EXAMPLE: Restricted] | [EXAMPLE: Yes] | [EXAMPLE: No] | [EXAMPLE: Yes] | [EXAMPLE: Companies Act; legal hold requirements; NDA obligations] | [EXAMPLE: Very High] | [EXAMPLE: High] | [EXAMPLE: Medium] | [EXAMPLE: High] | [EXAMPLE: Permanent or as defined by corporate records retention schedule] | [EXAMPLE: Microsoft 365 retention and backup configuration] | [EXAMPLE: RTO 24h / RPO 24h] | [EXAMPLE: M365-LEGAL-SITE-PERMISSIONS] | [EXAMPLE: RISK-LEGAL-004] | [EXAMPLE: Records Retention Policy; Access Control Policy; A.5.9; A.5.33; A.8.3] | [EXAMPLE: Active] | [EXAMPLE: 2025-02-01] | [EXAMPLE: 2025-07-01] | [EXAMPLE: 2026-01-01] | [EXAMPLE: N/A] | [EXAMPLE: N/A] | [EXAMPLE: Access limited to board-approved roles] |

### Column Guidance

| Column | What to enter |
|---|---|
| Asset ID | Enter a unique, persistent identifier for the asset; use the organisation’s naming convention, e.g. IA-0001, APP-0042, DB-0105. |
| Asset Name | Enter the commonly used name of the information asset, system, repository, dataset, application, or service. |
| Asset Description | Briefly describe what the asset is and the information it contains or processes. |
| Asset Type | Select one allowed value: Information, Application, Database, IT Service, Physical Document, Removable Media, Cloud Service, Endpoint, Server, Network Device, Backup, Cryptographic Material, Other. |
| Information Asset Category | Classify the kind of information held or processed; examples include Customer Data, Employee Data, Financial Data, Intellectual Property, Operational Data, Legal Records, Security Logs, Credentials, Public Information. |
| Business Process / Service Supported | Enter the business process, service, department activity, or operational function that depends on this asset. |
| Asset Owner | Enter the named individual or role accountable for the asset and its protection; use job title plus name where possible. |
| Asset Owner Department | Enter the department, function, or business unit responsible for ownership of the asset. |
| Asset Custodian / Administrator | Enter the team, role, or individual responsible for day-to-day operation, administration, maintenance, or technical control of the asset. |
| Users / User Groups | Enter the authorised user population or access groups, e.g. Finance Team, HR Managers, All Employees, Privileged Administrators. |
| Physical or Logical Location | Enter where the asset resides physically or logically, e.g. data centre location, cloud region, office, SharePoint site, SaaS tenant, archive room. |
| System / Repository / Platform | Enter the system, database, file share, application, SaaS platform, storage location, or repository where the asset is held or processed. |
| Supplier / Third Party | Enter the supplier, service provider, processor, or third party involved in hosting, support, processing, or storage; enter N/A if none. |
| Hosting Model | Select one allowed value: On-Premises, Private Cloud, Public Cloud, Hybrid, SaaS, PaaS, IaaS, Third-Party Hosted, Physical Only, N/A. |
| Information Classification | Enter the approved organisational classification label for the asset, e.g. Public, Internal, Confidential, Restricted; use only labels defined in the information classification policy. |
| Personal Data Present | Select Yes, No, or Unknown to indicate whether the asset contains or processes personal data. |
| Special Category / Sensitive Personal Data Present | Select Yes, No, or Unknown to indicate whether the asset contains sensitive personal data such as health, biometric, financial, criminal offence, children’s data, or other legally sensitive categories. |
| Regulated / Contractual Data Present | Select Yes, No, or Unknown to indicate whether the asset contains information subject to regulatory, legal, contractual, client, or industry-specific obligations. |
| Legal / Regulatory / Contractual Requirements | Enter applicable requirements such as GDPR, HIPAA, PCI DSS, SOX, employment law, client contract, NDA, data processing agreement, or N/A. |
| Confidentiality Requirement | Select one allowed value: Low, Medium, High, Very High, based on the impact of unauthorised disclosure. |
| Integrity Requirement | Select one allowed value: Low, Medium, High, Very High, based on the impact of unauthorised modification, corruption, or incompleteness. |
| Availability Requirement | Select one allowed value: Low, Medium, High, Very High, based on the impact of the asset being unavailable. |
| Business Criticality | Select one allowed value: Low, Medium, High, Critical, based on the asset’s importance to business operations and service delivery. |
| Retention Requirement | Enter the required retention period and trigger, e.g. 7 years after contract end, duration of employment plus 6 years, 90 days rolling, permanent, or as per retention schedule reference. |
| Backup Requirement | Enter the backup requirement for the asset, e.g. Not Required, Daily, Weekly, Real-Time Replication, Monthly Archive, or reference the backup policy/schedule. |
| Recovery Requirement | Enter recovery expectations where applicable, including RTO and RPO in hours, e.g. RTO 4h / RPO 1h; enter N/A if not applicable. |
| Access Control Reference | Enter the reference to the access control mechanism, group, role matrix, IAM policy, ticket, or access review record governing access to this asset. |
| Related Risk Assessment Reference | Enter the risk assessment, DPIA, supplier risk assessment, system risk ID, or information security risk register reference associated with this asset; enter N/A if not yet assessed. |
| Related Controls / Policies | Enter relevant policy or control references applicable to this asset, e.g. Access Control Policy, Classification Policy, Backup Policy, A.5.12, A.5.15, A.8.3. |
| Lifecycle Status | Select one allowed value: Planned, Active, Under Review, Retiring, Decommissioned, Archived. |
| Date Added to Register | Enter the date the asset was first recorded in this register using YYYY-MM-DD format. |
| Last Reviewed Date | Enter the date the asset record was last formally reviewed by the asset owner using YYYY-MM-DD format. |
| Next Review Due Date | Enter the next scheduled review date using YYYY-MM-DD format, based on the review cadence and asset criticality. |
| Disposal / Decommission Date | Enter the date the asset was disposed of, decommissioned, destroyed, transferred, or archived using YYYY-MM-DD format; enter N/A for active assets. |
| Disposal Method / Evidence Reference | For disposed or decommissioned assets, enter the disposal method and evidence reference, e.g. secure deletion certificate, destruction certificate, change ticket; enter N/A if not applicable. |
| Comments | Enter any additional relevant notes needed to understand ownership, classification, exceptions, dependencies, or follow-up actions. |

### Maintenance

The Information Asset Register is owned by the Information Security Manager or ISMS Manager, with each asset owner accountable for the accuracy of their assigned records. It should be updated whenever assets are created, changed, reclassified, transferred, archived, or disposed of, and formally reviewed at least annually using inputs from CMDB, IAM, data discovery tools, records management systems, cloud/SaaS inventories, procurement records, and business owner attestations.