<!-- iso_27001_2022 / ISO27-031 | type=Record/Log | mode=table | model=gpt-5.5 | 9110 chars -->

## Access Review Records (XLSX template)

_Editable template — add your own rows. The example row(s) below are placeholders to replace._

| Review ID | Review Period | Review Date | System / Application / Repository | System Owner | Access Reviewer | User Full Name | User ID / Account Name | User Email | Department / Business Unit | Line Manager | Employment Status | Account Type | Access Role / Group / Permission | Privilege Level | Access Purpose / Business Justification | Access Source | Last Login Date | Access Granted Date | Previous Review Decision | Reviewer Decision | Decision Rationale | Remediation Required | Remediation Action | Remediation Owner | Remediation Due Date | Remediation Completion Date | Remediation Ticket / Change Reference | Post-Remediation Status | Exception Approved | Exception Reference | Evidence Location | Reviewer Sign-off Date | Approver | Approver Sign-off Date | Comments |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [EXAMPLE: AR-2025-Q1-FINAPP] | [EXAMPLE: 2025-01-01 to 2025-03-31] | [EXAMPLE: 2025-04-05] | [EXAMPLE: Finance Application] | [EXAMPLE: Finance Systems Owner] | [EXAMPLE: Jane Smith, Finance Systems Owner] | [EXAMPLE: Alex Brown] | [EXAMPLE: abrown] | [EXAMPLE: alex.brown@example.com] | [EXAMPLE: Finance] | [EXAMPLE: Priya Patel] | [EXAMPLE: Active] | [EXAMPLE: Named User] | [EXAMPLE: AP_APPROVER] | [EXAMPLE: Elevated] | [EXAMPLE: Required to approve supplier invoices up to assigned authority limit] | [EXAMPLE: Finance Application access export] | [EXAMPLE: 2025-03-28] | [EXAMPLE: 2024-06-14] | [EXAMPLE: Retain] | [EXAMPLE: Retain] | [EXAMPLE: User remains in Finance AP role and access matches job responsibilities] | [EXAMPLE: No] | [EXAMPLE: N/A] | [EXAMPLE: N/A] | [EXAMPLE: N/A] | [EXAMPLE: N/A] | [EXAMPLE: N/A] | [EXAMPLE: Not Required] | [EXAMPLE: N/A] | [EXAMPLE: N/A] | [EXAMPLE: GRC/AccessReviews/2025/Q1/FinanceApp/export-and-signoff.pdf] | [EXAMPLE: 2025-04-06] | [EXAMPLE: Mark Green, Head of Finance] | [EXAMPLE: 2025-04-07] | [EXAMPLE: No issues identified] |
| [EXAMPLE: AR-2025-Q1-CRM] | [EXAMPLE: 2025-01-01 to 2025-03-31] | [EXAMPLE: 2025-04-08] | [EXAMPLE: CRM Platform] | [EXAMPLE: Sales Operations Manager] | [EXAMPLE: Sam Wilson, Sales Operations Manager] | [EXAMPLE: Taylor Lee] | [EXAMPLE: tlee] | [EXAMPLE: taylor.lee@example.com] | [EXAMPLE: Sales] | [EXAMPLE: Morgan White] | [EXAMPLE: Transferred] | [EXAMPLE: Named User] | [EXAMPLE: SALES_ADMIN] | [EXAMPLE: Administrative] | [EXAMPLE: Previously required for regional sales operations administration] | [EXAMPLE: Entra ID group export and CRM role report] | [EXAMPLE: 2025-02-12] | [EXAMPLE: 2023-11-03] | [EXAMPLE: Retain] | [EXAMPLE: Modify] | [EXAMPLE: User transferred to Marketing and no longer requires Sales Admin access] | [EXAMPLE: Yes] | [EXAMPLE: Remove SALES_ADMIN role and assign standard CRM user role if still required] | [EXAMPLE: IAM Team] | [EXAMPLE: 2025-04-15] | [EXAMPLE: Pending] | [EXAMPLE: CHG-123456] | [EXAMPLE: Pending] | [EXAMPLE: N/A] | [EXAMPLE: N/A] | [EXAMPLE: GRC/AccessReviews/2025/Q1/CRM/review-record.xlsx] | [EXAMPLE: 2025-04-08] | [EXAMPLE: Riley Scott, CRM Service Owner] | [EXAMPLE: Pending] | [EXAMPLE: Follow up required after IAM change completion] |

### Column Guidance

| Column | What to enter |
|---|---|
| Review ID | Enter a unique identifier for this access review cycle or review record, e.g. AR-YYYY-Q#-SYSTEM or AR-YYYY-MM-###. |
| Review Period | Enter the period covered by the review in YYYY-MM-DD to YYYY-MM-DD format. |
| Review Date | Enter the date the access review was performed in YYYY-MM-DD format. |
| System / Application / Repository | Enter the exact name of the system, application, database, cloud platform, file share, code repository, or other access-controlled asset being reviewed. |
| System Owner | Enter the accountable business or technical owner of the system, using full name and/or role title. |
| Access Reviewer | Enter the person performing the review, normally the system owner, data owner, application owner, or delegated manager; use full name and role. |
| User Full Name | Enter the full legal or HR-recorded name of the individual whose access is being reviewed. |
| User ID / Account Name | Enter the unique account identifier as shown in the source system, directory, IAM platform, or application. |
| User Email | Enter the user's corporate email address, or N/A for non-person accounts. |
| Department / Business Unit | Enter the user's current department, team, or business unit according to HR or identity records. |
| Line Manager | Enter the user's current line manager according to HR records; use full name. |
| Employment Status | Enter one allowed value: Active, Leaver, Suspended, Contractor Active, Contractor Ended, Transferred, Unknown. |
| Account Type | Enter one allowed value: Named User, Privileged Admin, Service Account, Shared Account, Break-glass, Third-party, System Account. |
| Access Role / Group / Permission | Enter the specific role, group, permission set, profile, entitlement, access level, or membership being reviewed exactly as named in the source system. |
| Privilege Level | Enter one allowed value: Standard, Elevated, Privileged, Administrative, Read-only, Service, Unknown. |
| Access Purpose / Business Justification | Enter the business reason the access is required, tied to job role, responsibility, support need, or approved service operation. |
| Access Source | Enter where the access record was obtained from, e.g. Active Directory, Entra ID, Okta, SAP, AWS IAM, GitHub, application export, database query. |
| Last Login Date | Enter the most recent successful login or use date in YYYY-MM-DD format; enter Never if no login is recorded, or Unknown if the source does not provide it. |
| Access Granted Date | Enter the date the access was originally granted in YYYY-MM-DD format; enter Unknown if not available. |
| Previous Review Decision | Enter the outcome from the prior review for this same access, if available; allowed values: Retain, Remove, Modify, Exception, Not Previously Reviewed, Unknown. |
| Reviewer Decision | Enter the review decision using one allowed value: Retain, Remove, Modify, Suspend, Investigate, Exception Required. |
| Decision Rationale | Enter a concise explanation supporting the reviewer decision, including why access remains appropriate or why change/removal is required. |
| Remediation Required | Enter Yes or No to indicate whether any access change, removal, suspension, or investigation is required. |
| Remediation Action | If remediation is required, enter the specific action to be taken, e.g. remove group membership, downgrade role, disable account, confirm with manager; otherwise enter N/A. |
| Remediation Owner | Enter the person or team responsible for completing the remediation action, e.g. IAM Team, Service Desk, System Administrator, Application Owner. |
| Remediation Due Date | Enter the target completion date for remediation in YYYY-MM-DD format; enter N/A if no remediation is required. |
| Remediation Completion Date | Enter the actual date remediation was completed in YYYY-MM-DD format; enter N/A if no remediation is required or Pending if not yet complete. |
| Remediation Ticket / Change Reference | Enter the ticket, change, request, or workflow reference used to evidence the remediation; enter N/A if no remediation is required. |
| Post-Remediation Status | Enter one allowed value: Not Required, Pending, Completed, Overdue, Failed, Risk Accepted. |
| Exception Approved | Enter Yes, No, or N/A to indicate whether an exception to normal access policy was formally approved. |
| Exception Reference | If an exception exists, enter the risk acceptance, exception, or approval reference; otherwise enter N/A. |
| Evidence Location | Enter the controlled location or link where evidence is stored, such as review export, signed approval, ticket, screenshot, IAM report, or GRC record. |
| Reviewer Sign-off Date | Enter the date the reviewer completed and signed off the review in YYYY-MM-DD format. |
| Approver | Enter the person providing final approval or oversight of the access review, if required by procedure; use full name and role, or N/A. |
| Approver Sign-off Date | Enter the final approval date in YYYY-MM-DD format; enter N/A if not required. |
| Comments | Enter any additional relevant notes, constraints, anomalies, or follow-up information; do not include unnecessary personal data. |

### Maintenance

This template is owned by the Information Security Manager or IAM/GRC process owner, with review input from system owners and business data owners. It is updated at least annually and whenever access review procedures, systems, roles, or IAM sources change; records should be drawn from authoritative IAM directories, HR records, application entitlement exports, privileged access management tools, and service desk/change management systems.