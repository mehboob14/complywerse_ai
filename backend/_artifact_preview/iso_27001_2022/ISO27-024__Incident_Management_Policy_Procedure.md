<!-- iso_27001_2022 / ISO27-024 | type=Procedure | model=gpt-4o | 4456 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|-------------|---------|-------|----------------|-----------|-------------------|----------------|
| IM-001      | 1.0     | [Owner Name] | [Effective Date] | ISO/IEC 27001:2022 | A.5.24-A.5.28 | Internal Use Only |

## Purpose

The purpose of this procedure is to establish a systematic approach for the detection, reporting, response, and learning from information security incidents in compliance with ISO/IEC 27001:2022 controls A.5.24 to A.5.28. This procedure aims to minimize the impact of incidents on the organization and prevent recurrence.

## Scope

This procedure applies to all employees, contractors, and third-party users of [Organization Name]'s information systems and assets. It covers all types of information security incidents, including but not limited to data breaches, malware infections, unauthorized access, and denial of service attacks.

## Prerequisites & Inputs

- Access to the Incident Management System (IMS)
- Incident reporting forms
- Awareness of the Information Security Policy
- Training on incident detection and response
- List of critical assets and their owners

## Step-by-Step Procedure

1. **Incident Detection**
   - Monitor systems and networks using [specific monitoring tools].
   - Identify potential security events through alerts, logs, or user reports.

2. **Incident Reporting**
   - Immediately report identified incidents to the Information Security Team via [reporting channel].
   - Complete the Incident Reporting Form with details such as date, time, nature of the incident, and affected assets.

3. **Incident Assessment**
   - The Information Security Team assesses the incident to determine its impact and urgency.
   - Classify the incident based on severity levels (Critical, High, Medium, Low).

4. **Incident Response**
   - Initiate response actions based on the classification:
     - **Critical/High**: Immediate containment, eradication, and recovery actions.
     - **Medium/Low**: Scheduled response actions within [specified timeframe].
   - Document all actions taken in the Incident Log.

5. **Communication**
   - Notify affected stakeholders, including asset owners and management, about the incident status and response actions.
   - Communicate with external parties if required, following legal and regulatory requirements.

6. **Lessons Learned**
   - Conduct a post-incident review to identify root causes and improvement opportunities.
   - Update policies, procedures, and controls based on findings.

7. **Closure**
   - Ensure all response actions are completed and documented.
   - Obtain approval for incident closure from the Information Security Manager.

## Roles & RACI

| Role                      | Responsible | Accountable | Consulted | Informed |
|---------------------------|-------------|-------------|-----------|----------|
| Information Security Team | X           |             |           |          |
| Incident Manager          |             | X           |           |          |
| IT Support                | X           |             |           |          |
| Asset Owners              |             |             | X         | X        |
| Senior Management         |             |             |           | X        |

## Records & Outputs

- **Incident Reporting Form**: Captures initial incident details.
- **Incident Log**: Documents all actions taken during the incident response.
- **Post-Incident Review Report**: Summarizes lessons learned and recommended improvements.

### Example Incident Log

| Incident ID | Date       | Description             | Severity | Actions Taken       | Status  |
|-------------|------------|-------------------------|----------|---------------------|---------|
| INC-2023-01 | 2023-01-15 | Unauthorized access     | High     | Account disabled    | Closed  |
| INC-2023-02 | 2023-02-10 | Malware infection       | Medium   | System scanned      | Closed  |

## Exceptions & Escalation

Exceptions to this procedure must be approved by the Information Security Manager. Escalation of incidents should follow the defined escalation matrix based on severity and impact.

## Review

This procedure will be reviewed annually or following a significant incident to ensure its effectiveness and alignment with organizational goals and regulatory requirements. The next scheduled review date is [Review Date].