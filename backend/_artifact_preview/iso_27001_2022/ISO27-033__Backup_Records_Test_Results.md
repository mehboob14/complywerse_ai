<!-- iso_27001_2022 / ISO27-033 | type=Record/Log | model=gpt-4o | 3966 chars -->

| Document ID      | Version | Owner          | Effective Date | Framework         | Control Reference | Classification |
|------------------|---------|----------------|----------------|-------------------|-------------------|----------------|
| BR-LOG-001       | 1.0     | [Owner Name]   | [Effective Date] | ISO/IEC 27001:2022 | A.8.13            | Confidential   |

## Purpose

The purpose of this document is to maintain a comprehensive record of all backup activities and restore test results in compliance with ISO/IEC 27001:2022, Control A.8.13. This ensures that data backups are performed regularly and can be restored effectively, safeguarding the integrity and availability of information.

## Scope

This record/log applies to all backup operations and restore tests conducted on information systems within [Organization Name]. It encompasses all data types and storage media used for backups, ensuring alignment with the organization's information security management system (ISMS).

## Captured Fields

| Field                  | Description                                                                 |
|------------------------|-----------------------------------------------------------------------------|
| Date                   | The date when the backup or test was performed.                             |
| Time                   | The time when the backup or test was initiated.                             |
| Backup Type            | The type of backup performed (e.g., full, incremental, differential).       |
| System/Database Name   | The name of the system or database being backed up.                         |
| Backup Method          | The method used for backup (e.g., automated, manual).                       |
| Storage Location       | The physical or cloud location where the backup is stored.                  |
| Test Type              | The type of restore test conducted (e.g., full restore, partial restore).   |
| Test Result            | The outcome of the restore test (e.g., successful, failed).                 |
| Issues Identified      | Any issues encountered during the backup or restore test.                   |
| Action Taken           | Actions taken to resolve any issues identified.                             |
| Responsible Personnel  | The individual responsible for the backup or restore test.                  |
| Comments               | Additional comments or observations.                                        |

## Sample Entries

| Date       | Time   | Backup Type | System/Database Name | Backup Method | Storage Location | Test Type     | Test Result | Issues Identified | Action Taken | Responsible Personnel | Comments             |
|------------|--------|-------------|----------------------|---------------|------------------|---------------|-------------|-------------------|--------------|----------------------|----------------------|
| 2023-10-01 | 02:00  | Full        | FinanceDB            | Automated     | Cloud Storage A  | Full Restore  | Successful  | None              | N/A          | [John Doe]           | Monthly backup       |
| 2023-10-15 | 02:00  | Incremental | HRSystem             | Automated     | On-Premise B     | Partial Restore | Failed     | Corrupt File      | Re-run backup| [Jane Smith]         | Weekly backup check  |

## Retention & Access

Backup records and test results shall be retained for a minimum of [X years] in accordance with the organization's data retention policy and legal requirements. Access to these records is restricted to authorized personnel only, as defined by [Organization Name]'s access control policy.

## Review

This document and its associated records shall be reviewed annually or following any significant changes to backup processes or systems. The review will be conducted by the [ISMS Manager] and any findings will be documented and addressed in accordance with the continuous improvement process of the ISMS.