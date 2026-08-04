<!-- iso_27001_2022 / ISO27-033 | type=Record/Log | mode=table | model=gpt-5.5 | 10969 chars -->

## Backup Records & Test Results (XLSX/PDF template)

_Editable template — add your own rows. The example row(s) below are placeholders to replace._

| Record ID | Control Reference | Backup Policy / Procedure Reference | Business Service / System | Data Set / Asset Name | Asset Owner | Backup Type | Backup Scope | Backup Frequency | Scheduled Backup Date/Time | Actual Backup Start Date/Time | Actual Backup End Date/Time | Backup Status | Backup Job ID | Backup Tool / Platform | Backup Storage Location | Storage Media / Repository | Retention Period | Encryption Applied | Encryption Method / Key Reference | Integrity Verification Performed | Integrity Verification Result | Backup Size | Backup Operator / Automation Account | Exception / Failure Description | Corrective Action Taken | Corrective Action Owner | Corrective Action Due Date | Corrective Action Status | Restore Test Required | Restore Test Date | Restore Test Scope | Restore Test Environment | Restore Test Performed By | Recovery Point Objective (RPO) | Recovery Time Objective (RTO) | Actual Recovery Point Achieved | Actual Restore Duration | Restore Test Result | Restored Data Validation Performed | Restored Data Validation Result | Issues Identified During Restore Test | Lessons Learned / Improvement Actions | Evidence Reference / Link | Reviewed By | Review Date | Review Outcome | Comments |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [EXAMPLE: BAK-2025-001] | [EXAMPLE: A.8.13] | [EXAMPLE: Backup and Restore Procedure v1.2] | [EXAMPLE: Finance ERP] | [EXAMPLE: ERP production database] | [EXAMPLE: Head of Finance Systems] | [EXAMPLE: Full] | [EXAMPLE: Full production database including transaction and configuration tables] | [EXAMPLE: Daily] | [EXAMPLE: 2025-02-03 22:00 UTC] | [EXAMPLE: 2025-02-03 22:01 UTC] | [EXAMPLE: 2025-02-03 22:48 UTC] | [EXAMPLE: Successful] | [EXAMPLE: JOB-784512] | [EXAMPLE: Enterprise Backup Platform] | [EXAMPLE: Cloud backup vault - UK region] | [EXAMPLE: Immutable Storage] | [EXAMPLE: 90 days] | [EXAMPLE: Yes] | [EXAMPLE: AES-256 using KMS key alias backup-prod] | [EXAMPLE: Yes] | [EXAMPLE: Passed] | [EXAMPLE: 185 GB] | [EXAMPLE: svc-backup-prod] | [EXAMPLE: None] | [EXAMPLE: None] | [EXAMPLE: Not Applicable] | [EXAMPLE: Not Applicable] | [EXAMPLE: Not Required] | [EXAMPLE: Yes] | [EXAMPLE: 2025-02-10] | [EXAMPLE: Database restored to test environment and sample records validated] | [EXAMPLE: Isolated DR test environment] | [EXAMPLE: Infrastructure Operations Team] | [EXAMPLE: 24 hours] | [EXAMPLE: 4 hours] | [EXAMPLE: 22 hours] | [EXAMPLE: 1h 20m] | [EXAMPLE: Passed] | [EXAMPLE: Yes] | [EXAMPLE: Passed] | [EXAMPLE: None] | [EXAMPLE: None] | [EXAMPLE: Evidence repository link REF-2025-BAK-001] | [EXAMPLE: IT Operations Manager] | [EXAMPLE: 2025-02-11] | [EXAMPLE: Accepted] | [EXAMPLE: None] |

### Column Guidance

| Column | What to enter |
|---|---|
| Record ID | Enter a unique identifier for this backup or restore-test record, using a consistent format such as BAK-YYYY-NNN or REST-YYYY-NNN. |
| Backup Policy / Procedure Reference | Enter the approved internal backup policy, standard, runbook, or procedure reference that this record follows, including document ID and version where available. |
| Business Service / System | Enter the name of the business service, application, server, database, SaaS platform, or infrastructure component being backed up or tested. |
| Data Set / Asset Name | Enter the specific data set, database, file share, VM, container volume, configuration set, or information asset covered by the backup. |
| Asset Owner | Enter the accountable business or technical owner of the system or data, using name and role or team mailbox. |
| Backup Type | Enter one allowed value: Full, Incremental, Differential, Snapshot, Image, Replication, Configuration Export, SaaS Export, Other. |
| Backup Scope | Describe exactly what is included and excluded in the backup, such as full database, selected tables, VM image, user files, application configuration, or tenant export. |
| Backup Frequency | Enter the scheduled frequency using an allowed value such as Hourly, Daily, Weekly, Monthly, On Change, Continuous, Ad hoc, Other. |
| Scheduled Backup Date/Time | Enter the planned backup execution date and time in ISO 8601 format, YYYY-MM-DD HH:MM, including time zone where relevant. |
| Actual Backup Start Date/Time | Enter the actual backup start date and time in ISO 8601 format, YYYY-MM-DD HH:MM, including time zone where relevant. |
| Actual Backup End Date/Time | Enter the actual backup completion date and time in ISO 8601 format, YYYY-MM-DD HH:MM, including time zone where relevant. |
| Backup Status | Enter one allowed value: Successful, Successful with Warnings, Failed, Missed, Cancelled, In Progress, Not Applicable. |
| Backup Job ID | Enter the unique job, task, run, or transaction ID generated by the backup platform or script. |
| Backup Tool / Platform | Enter the name of the backup software, cloud service, script, native platform feature, or managed service used to perform the backup. |
| Backup Storage Location | Enter the logical or physical backup destination, such as cloud region, data centre, backup vault, object storage bucket, offsite location, or repository name; do not include secrets. |
| Storage Media / Repository | Enter the media or repository type, such as Disk, Tape, Immutable Storage, Object Storage, Snapshot Repository, Cloud Backup Vault, SaaS Backup Repository. |
| Retention Period | Enter the required retention period for the backup, using a clear duration such as 30 days, 90 days, 7 years, or Until contract termination. |
| Encryption Applied | Enter Yes or No to confirm whether backup data is encrypted at rest and/or in transit as required. |
| Encryption Method / Key Reference | Enter the encryption method and non-sensitive key reference, such as AES-256, KMS key alias, HSM-backed key ID, or backup platform managed encryption; do not record key material. |
| Integrity Verification Performed | Enter Yes or No to confirm whether backup integrity verification was performed, such as checksum, catalogue verification, automated validation, or test mount. |
| Integrity Verification Result | Enter one allowed value: Passed, Failed, Warning, Not Performed, Not Applicable. |
| Backup Size | Enter the backup size with unit, such as MB, GB, or TB, using a numeric value plus unit. |
| Backup Operator / Automation Account | Enter the person, team, service account, automation job, or managed service responsible for executing the backup. |
| Exception / Failure Description | If the backup status is not fully successful, describe the exception, warning, missed job, or failure cause; enter None if not applicable. |
| Corrective Action Taken | Describe the remediation action taken for any backup failure, warning, missed job, or restore issue; enter None if not applicable. |
| Corrective Action Owner | Enter the person or team responsible for completing corrective action; enter Not Applicable if no action is required. |
| Corrective Action Due Date | Enter the due date for corrective action in YYYY-MM-DD format; enter Not Applicable if no action is required. |
| Corrective Action Status | Enter one allowed value: Not Required, Open, In Progress, Completed, Overdue, Risk Accepted. |
| Restore Test Required | Enter Yes or No to indicate whether this backup is subject to restore testing under the backup policy or test schedule. |
| Restore Test Date | Enter the date the restore test was performed in YYYY-MM-DD format; enter Not Performed if no restore test was performed for this record. |
| Restore Test Scope | Describe what was restored during the test, such as full system, selected files, database restore, table-level restore, configuration restore, or sample transaction data. |
| Restore Test Environment | Enter where the restore was tested, such as DR environment, test environment, isolated sandbox, staging tenant, or production-approved restore location. |
| Restore Test Performed By | Enter the person, team, service provider, or automation account that performed the restore test. |
| Recovery Point Objective (RPO) | Enter the approved maximum tolerable data loss for the service or data set, using a duration such as 15 minutes, 4 hours, 24 hours, or Not Defined. |
| Recovery Time Objective (RTO) | Enter the approved maximum tolerable restoration time for the service or data set, using a duration such as 1 hour, 8 hours, 24 hours, or Not Defined. |
| Actual Recovery Point Achieved | Enter the actual age of the restored data relative to the failure scenario, using a duration such as 10 minutes, 2 hours, or 1 day. |
| Actual Restore Duration | Enter the elapsed time to complete the restore test, using a duration such as 00:45, 2h 15m, or 1 business day. |
| Restore Test Result | Enter one allowed value: Passed, Passed with Issues, Failed, Not Performed, Not Applicable. |
| Restored Data Validation Performed | Enter Yes or No to confirm whether restored data was validated for usability, completeness, and readability. |
| Restored Data Validation Result | Enter one allowed value: Passed, Failed, Partial, Not Performed, Not Applicable. |
| Issues Identified During Restore Test | Describe any restore failure, missing data, corruption, access issue, excessive duration, configuration gap, or dependency issue; enter None if no issues were identified. |
| Lessons Learned / Improvement Actions | Record any improvement actions arising from the backup or restore test, such as procedure updates, scheduling changes, capacity changes, or monitoring enhancements; enter None if not applicable. |
| Evidence Reference / Link | Enter the location or reference for supporting evidence, such as backup job report, monitoring alert, ticket number, restore test screenshot, checksum report, or audit evidence repository link. |
| Reviewed By | Enter the name and role of the person who reviewed the backup record or restore test result. |
| Review Date | Enter the date of review in YYYY-MM-DD format. |
| Review Outcome | Enter one allowed value: Accepted, Accepted with Actions, Rejected, Further Investigation Required. |
| Comments | Enter any additional relevant notes that support the backup record or restore test result; enter None if not applicable. |

### Maintenance

The IT Operations Manager or Backup Service Owner owns this template and ensures entries are updated after each scheduled backup, backup exception, and restore test, with formal review at least monthly. Source data should be drawn from the backup platform, monitoring tools, service desk tickets, restore test reports, asset inventory, and approved backup/restore procedures.