<!-- iso_27001_2022 / ISO27-009 | type=Register | mode=table | model=gpt-5.5 | 8146 chars -->

## Risk Register (XLSX template)

_Editable template — add your own rows. The example row(s) below are placeholders to replace._

| Risk ID | Date Identified | Risk Title | Risk Description | Information Asset / Process | Asset / Process Owner | Threat / Event | Vulnerability / Weakness | Information Security Objective Affected | CIA Impact Area | Business Consequence | Existing Controls | Control References | Inherent Likelihood | Inherent Impact | Inherent Risk Score | Inherent Risk Rating | Risk Evaluation Decision | Risk Owner | Risk Treatment Option | Treatment Plan / Actions | Planned Treatment Controls | Treatment Owner | Target Completion Date | Residual Likelihood | Residual Impact | Residual Risk Score | Residual Risk Rating | Residual Risk Acceptance Decision | Residual Risk Accepted By | Acceptance Date | Review Frequency | Next Review Date | Status | Last Updated | Evidence / Link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [EXAMPLE: RISK-001] | [EXAMPLE: 2026-01-15] | [EXAMPLE: Unauthorised access to customer database] | [EXAMPLE: Weak privileged access controls could allow unauthorised access to customer personal data, causing confidentiality breach and regulatory impact.] | [EXAMPLE: Customer Database] | [EXAMPLE: Head of Customer Platforms] | [EXAMPLE: Compromised administrator account] | [EXAMPLE: Privileged access reviews not performed regularly] | [EXAMPLE: Protect customer information from unauthorised disclosure] | [EXAMPLE: Confidentiality] | [EXAMPLE: Regulatory breach, customer notification, reputational damage] | [EXAMPLE: MFA enabled; role-based access control configured] | [EXAMPLE: A.5.15; A.5.18; A.8.2] | [EXAMPLE: 4] | [EXAMPLE: 5] | [EXAMPLE: 20] | [EXAMPLE: Critical] | [EXAMPLE: Treatment Required] | [EXAMPLE: Chief Information Officer] | [EXAMPLE: Modify] | [EXAMPLE: Implement quarterly privileged access reviews and remove unused administrator accounts.] | [EXAMPLE: A.5.18; A.8.2; A.8.3] | [EXAMPLE: Identity and Access Manager] | [EXAMPLE: 2026-03-31] | [EXAMPLE: 2] | [EXAMPLE: 5] | [EXAMPLE: 10] | [EXAMPLE: Medium] | [EXAMPLE: Pending Approval] | [EXAMPLE: Information Security Steering Committee] | [EXAMPLE: 2026-04-10] | [EXAMPLE: Quarterly] | [EXAMPLE: 2026-06-30] | [EXAMPLE: Treatment In Progress] | [EXAMPLE: 2026-02-01] | [EXAMPLE: IAM ticket IAM-12345; access review evidence folder link] |

### Column Guidance

| Column | What to enter |
|---|---|
| Risk ID | Enter a unique identifier for the risk using the organisation's numbering format, e.g. RISK-001; do not reuse IDs. |
| Date Identified | Enter the date the risk was first identified in YYYY-MM-DD format. |
| Risk Title | Enter a short, specific title summarising the risk scenario. |
| Risk Description | Describe the risk scenario clearly, including cause, event, and potential effect on information security. |
| Information Asset / Process | Enter the affected information asset, system, service, supplier, business process, or information set. |
| Asset / Process Owner | Enter the accountable owner of the affected asset or process, using role or named individual according to organisational practice. |
| Threat / Event | Enter the threat or event that could exploit the weakness, e.g. phishing, ransomware, accidental disclosure, supplier outage, unauthorised access. |
| Vulnerability / Weakness | Enter the vulnerability, weakness, absence of control, exposure, or condition that makes the risk possible. |
| Information Security Objective Affected | Enter the relevant information security objective, policy objective, legal/regulatory obligation, or ISMS objective affected by this risk. |
| CIA Impact Area | Enter one or more affected areas using allowed values: Confidentiality, Integrity, Availability; separate multiple values with semicolons. |
| Business Consequence | Describe the potential business consequence, such as financial loss, operational disruption, legal/regulatory breach, reputational damage, contractual breach, or safety impact. |
| Existing Controls | List controls already implemented that reduce the likelihood or impact of the risk; enter 'None' if no relevant controls exist. |
| Control References | Enter references to applicable controls, policies, procedures, or ISO/IEC 27001:2022 Annex A controls, e.g. A.5.15, A.8.12, ISMS-POL-01. |
| Inherent Likelihood | Enter the likelihood before additional treatment using the approved risk criteria scale, e.g. 1-5 where 1 = Rare and 5 = Almost Certain. |
| Inherent Impact | Enter the impact before additional treatment using the approved risk criteria scale, e.g. 1-5 where 1 = Insignificant and 5 = Severe. |
| Inherent Risk Score | Enter the calculated inherent risk score using the organisation's approved method, typically Likelihood x Impact. |
| Inherent Risk Rating | Enter the rating derived from the approved risk criteria using allowed values: Low, Medium, High, Critical. |
| Risk Evaluation Decision | Record the evaluation against risk acceptance criteria using allowed values: Acceptable, Treatment Required, Escalate, Monitor. |
| Risk Owner | Enter the person or role accountable for managing and deciding on the risk. |
| Risk Treatment Option | Enter the selected treatment option using allowed values: Modify, Retain, Avoid, Share. |
| Treatment Plan / Actions | Describe the specific actions to treat the risk, including what will be changed, implemented, stopped, transferred, or accepted. |
| Planned Treatment Controls | List new or changed controls planned to treat the risk, including ISO/IEC 27001:2022 Annex A references where applicable. |
| Treatment Owner | Enter the person or role responsible for implementing the treatment actions. |
| Target Completion Date | Enter the planned completion date for the treatment in YYYY-MM-DD format. |
| Residual Likelihood | Enter the expected or reassessed likelihood after treatment using the approved risk criteria scale, e.g. 1-5. |
| Residual Impact | Enter the expected or reassessed impact after treatment using the approved risk criteria scale, e.g. 1-5. |
| Residual Risk Score | Enter the calculated residual risk score using the organisation's approved method, typically Residual Likelihood x Residual Impact. |
| Residual Risk Rating | Enter the residual rating derived from the approved risk criteria using allowed values: Low, Medium, High, Critical. |
| Residual Risk Acceptance Decision | Record whether the residual risk is accepted against the risk acceptance criteria using allowed values: Accepted, Not Accepted, Pending Approval, Further Treatment Required. |
| Residual Risk Accepted By | Enter the authorised person or governance body accepting the residual risk; leave blank until formally accepted. |
| Acceptance Date | Enter the date residual risk acceptance was approved in YYYY-MM-DD format; leave blank if not accepted. |
| Review Frequency | Enter how often the risk must be reviewed using allowed values: Monthly, Quarterly, Semi-Annually, Annually, Event-Driven. |
| Next Review Date | Enter the next scheduled review date in YYYY-MM-DD format. |
| Status | Enter the current lifecycle status using allowed values: Draft, Open, Treatment In Progress, Awaiting Acceptance, Accepted, Closed, Retired. |
| Last Updated | Enter the date this risk entry was last updated in YYYY-MM-DD format. |
| Evidence / Link | Enter a link or reference to supporting evidence, such as assessment notes, control evidence, tickets, treatment plans, approvals, or meeting minutes. |

### Maintenance

The Risk Register template is owned by the Information Security Manager or ISMS Manager, with risk entries maintained by assigned Risk Owners and reviewed at least quarterly and whenever significant changes, incidents, audit findings, or new threats arise. It draws from the organisation's risk assessment methodology, asset inventory, incident records, vulnerability management outputs, audit findings, supplier assessments, and ISMS governance records.