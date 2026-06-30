<!-- iso_27001_2022 / ISO27-032 | type=Record/Log | model=gpt-4o | 4164 chars -->

| Document ID      | Version | Owner                | Effective Date | Framework         | Control Reference | Classification       |
|------------------|---------|----------------------|----------------|-------------------|-------------------|----------------------|
| CM-LOG-001       | 1.0     | [Change Manager]     | [YYYY-MM-DD]   | ISO/IEC 27001:2022| A.8.32            | Internal Use Only    |

## Purpose
The purpose of this document is to maintain a comprehensive record of all change management activities within the organization, specifically focusing on the approval and rejection of change tickets. This record supports compliance with ISO/IEC 27001:2022 control A.8.32, ensuring that changes to information systems are controlled and documented.

## Scope
This record applies to all change management activities affecting the organization’s information systems, including hardware, software, and network configurations. It covers changes initiated by internal staff, contractors, and third-party service providers.

## Captured Fields

| Field             | Description                                                                                   |
|-------------------|-----------------------------------------------------------------------------------------------|
| Change ID         | Unique identifier for each change request.                                                    |
| Requestor         | Name and role of the individual who submitted the change request.                             |
| Date Submitted    | Date when the change request was submitted.                                                   |
| Change Description| Brief description of the change requested.                                                    |
| Impact Assessment | Summary of the potential impact of the change on systems and operations.                      |
| Approval Status   | Status of the change request (e.g., Approved, Rejected, Pending).                             |
| Approver          | Name and role of the individual who approved or rejected the change.                          |
| Approval Date     | Date when the change was approved or rejected.                                                |
| Implementation Date| Date when the change was implemented, if approved.                                           |
| Comments          | Additional notes or comments related to the change request.                                   |

## Sample Entries

| Change ID | Requestor       | Date Submitted | Change Description            | Impact Assessment  | Approval Status | Approver           | Approval Date | Implementation Date | Comments               |
|-----------|-----------------|----------------|-------------------------------|--------------------|-----------------|--------------------|---------------|---------------------|------------------------|
| 2023-001  | [John Doe]      | 2023-10-01     | Update firewall rules         | Moderate           | Approved        | [Jane Smith]       | 2023-10-02    | 2023-10-05          | Implemented successfully. |
| 2023-002  | [Alice Brown]   | 2023-10-03     | Upgrade database server       | High               | Rejected        | [Mark Johnson]     | 2023-10-04    | N/A                 | Insufficient testing.  |
| 2023-003  | [Bob White]     | 2023-10-05     | Patch operating system        | Low                | Approved        | [Jane Smith]       | 2023-10-06    | 2023-10-07          | No issues encountered. |

## Retention & Access
Change management records shall be retained for a minimum of five years to comply with regulatory and audit requirements. Access to these records is restricted to authorized personnel only, including the Change Manager, IT Security Manager, and auditors. Records are stored securely in the organization's change management system.

## Review
This document and the associated change management records shall be reviewed annually by the Change Manager to ensure accuracy, completeness, and compliance with ISO/IEC 27001:2022. Any updates or amendments to this document must be approved by the Information Security Steering Committee.