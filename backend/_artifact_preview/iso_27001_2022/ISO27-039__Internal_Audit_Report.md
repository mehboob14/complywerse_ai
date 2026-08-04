<!-- iso_27001_2022 / ISO27-039 | type=Report | mode=markdown | model=gpt-5.5 | 40704 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| ISMS-RPT-IA-001 | 1.0 | Internal Audit Function / ISMS Manager | [Effective Date] | ISO/IEC 27001:2022 | — Internal Audit | Confidential |

## Purpose

This Internal Audit Report documents the results of the internal audit performed to assess whether the organisation’s Information Security Management System (ISMS):

1. Conforms to:
 - The organisation’s own requirements for its ISMS;
 - The requirements of ISO/IEC 27001:2022, including — Internal Audit;
 - Applicable policies, procedures, risk treatment plans, and Statement of Applicability requirements.
2. Is effectively implemented and maintained.
3. Provides reliable evidence of continual improvement and management oversight.
4. Identifies nonconformities, opportunities for improvement, and corrective actions requiring management attention.

This report is intended to support management review, corrective action planning, certification readiness, and ongoing ISMS performance evaluation.

## Reporting Period & Scope

### Reporting Period

| Item | Details |
|---|---|
| Audit reporting period | [Start Date] to [End Date] |
| Audit fieldwork dates | [Audit Fieldwork Dates] |
| Report issue date | [Report Issue Date] |
| Audit cycle / programme reference | ISMS Internal Audit Programme [Year] |
| Previous internal audit report reference | [Previous Report Reference, if applicable] |

### Audit Scope

The audit covered selected ISMS processes, controls, and evidence relevant to ISO/IEC 27001:2022 implementation and operation.

| Scope Area | Included in Audit | Notes |
|---|---:|---|
| ISMS governance and context | Yes | Review of ISMS scope, interested parties, internal/external issues, and leadership responsibilities |
| Risk assessment and risk treatment | Yes | Review of risk methodology, risk register, treatment plans, and risk acceptance |
| Statement of Applicability | Yes | Review of control applicability, justification, implementation status, and linkage to risks |
| Information security policies and procedures | Yes | Review of approval, communication, currency, and operational alignment |
| Internal audit programme and execution | Yes | Specific review against ISO/IEC 27001:2022 |
| Management review | Yes | Review of agenda coverage, inputs, outputs, decisions, and actions |
| Corrective action and continual improvement | Yes | Review of nonconformity handling, root cause analysis, action closure, and effectiveness review |
| Selected Annex A controls | Yes | Sampling of implemented controls based on risk and SoA coverage |
| In-scope departments/functions | Yes | [Departments / Functions] |
| In-scope locations | Yes | [Locations / Remote Operations] |
| In-scope systems/services | Yes | [Systems / Services / Platforms] |
| Outsourced processes relevant to ISMS | Partial | Reviewed through contract, supplier assurance, and monitoring evidence |

### Exclusions and Limitations

| Exclusion / Limitation | Rationale | Impact |
|---|---|---|
| [Excluded location/system/process, if any] | [Reason] | [Impact on audit conclusion] |
| Sampling-based evidence review | Internal audit is conducted using representative samples | Findings reflect evidence sampled and may not identify all issues |
| Reliance on staff interviews | Interviews were used to corroborate documented evidence | Interview evidence was validated where possible against records |

## Executive Summary

The internal audit found that the organisation has established an ISMS aligned in structure with ISO/IEC 27001:2022 and has implemented key governance components, including an ISMS scope, risk assessment process, Statement of Applicability, security policies, and management review arrangements.

However, the audit identified weaknesses in the maturity and consistency of internal audit planning, evidence retention, corrective action tracking, and linkage between audit results, risk treatment, and management review. These issues affect the organisation’s ability to fully demonstrate conformity with ISO/IEC 27001:2022 and related continual improvement requirements.

### Overall Audit Conclusion

| Conclusion Area | Assessment |
|---|---|
| ISMS conformity to ISO/IEC 27001:2022 | Partially conforming |
| ISMS implementation effectiveness | Generally implemented, with control and evidence gaps |
| internal audit conformity | Partially conforming |
| Certification readiness impact | Moderate impact; corrective action required before external audit |
| Overall opinion | The ISMS is operational but requires targeted corrective action to improve audit programme discipline, objective evidence, and closure effectiveness |

### Summary of Findings

| Finding ID | Finding Type | Severity | Area | Summary |
|---|---|---:|---|---|
| IA-2022-01 | Nonconformity | Major | Internal audit programme | The internal audit programme does not fully demonstrate planned intervals, scope coverage, audit criteria, impartiality, and risk-based prioritisation required by |
| IA-2022-02 | Nonconformity | Minor | Audit evidence and reporting | Audit records do not consistently evidence audit criteria, sampled evidence, conclusions, and traceability to ISO/IEC 27001:2022 requirements |
| IA-2022-03 | Nonconformity | Minor | Corrective action | Corrective actions from prior audits are not consistently tracked through root cause, owner assignment, due date, closure evidence, and effectiveness review |
| IA-2022-04 | Observation | Medium | Management review linkage | Internal audit results are presented to management, but trend analysis and decision outputs are limited |
| IA-2022-05 | Opportunity for Improvement | Low | Auditor competence | Auditor competence criteria exist informally but are not fully documented or periodically reviewed |
| IA-2022-06 | Positive Practice | N/A | ISMS documentation | The ISMS maintains a structured document set with version control, ownership, and access restrictions |

### Severity Definitions

| Severity | Definition |
|---|---|
| Major Nonconformity | Absence, breakdown, or systemic failure of a required ISMS process, or a condition that significantly affects the organisation’s ability to meet ISO/IEC 27001:2022 requirements |
| Minor Nonconformity | Isolated or limited failure to meet a requirement where the ISMS process is substantially established but not consistently implemented or evidenced |
| Observation | A condition that is currently conforming or not clearly nonconforming but could develop into a nonconformity if not addressed |
| Opportunity for Improvement | A recommendation to improve effectiveness, efficiency, maturity, or auditability, without indicating nonconformity |
| Positive Practice | Evidence of effective implementation, maturity, or good practice that supports ISMS objectives |

## Methodology

### Audit Approach

The audit was conducted using a risk-based and evidence-based approach aligned with ISO/IEC 27001:2022. The audit assessed whether internal audit processes are planned, implemented, documented, and maintained to provide objective assurance regarding ISMS conformity and effectiveness.

The audit included:

- Review of documented ISMS requirements, policies, procedures, and records;
- Interviews with process owners and relevant personnel;
- Sampling of audit records, risk records, control evidence, corrective actions, and management review outputs;
- Walkthroughs of selected ISMS processes;
- Verification of audit programme planning and execution;
- Evaluation of conformity against ISO/IEC 27001:2022 clauses and selected Annex A controls;
- Assessment of previous audit findings and closure effectiveness.

### Audit Criteria

The following criteria were used to evaluate conformity:

| Criteria Source | Criteria Applied |
|---|---|
| ISO/IEC 27001:2022 | through 10, with specific emphasis on |
| ISO/IEC 27001:2022 | Requirement to conduct internal audits at planned intervals to determine ISMS conformity and effective implementation/maintenance |
| ISO/IEC 27001:2022 | Requirement to plan, establish, implement, and maintain audit programme(s), define audit criteria and scope, select auditors objectively and impartially, report results to relevant management, and retain documented information |
| Organisation ISMS policies | [Information Security Policy], [Risk Management Procedure], [Internal Audit Procedure], [Corrective Action Procedure] |
| Statement of Applicability | Control applicability, justification, implementation status, and control ownership |
| Risk treatment plan | Risk treatment actions, residual risk acceptance, and control implementation evidence |
| Legal, regulatory, and contractual requirements | [Applicable Requirements Register] |

### Audit Team

| Role | Name / Function | Independence Confirmation |
|---|---|---|
| Lead Internal Auditor | [Name / Function] | Confirmed not responsible for audited activities |
| Supporting Auditor | [Name / Function] | Confirmed not responsible for audited activities |
| Technical Subject Matter Expert | [Name / Function] | Provided technical advice only; no audit decision authority |
| Auditee Representative | [Name / Function] | Coordinated evidence and interviews |

### Interviewed Personnel

| Function / Role | Interview Date | Topics Covered |
|---|---|---|
| ISMS Manager | [Date] | ISMS governance, audit programme, corrective actions, management review |
| Risk Owner(s) | [Date] | Risk assessment, treatment plans, control ownership |
| IT Operations Lead | [Date] | Asset management, access control, operational controls |
| HR Representative | [Date] | Security awareness, onboarding/offboarding, competence |
| Supplier Manager | [Date] | Supplier security, monitoring, contractual controls |
| Senior Management Representative | [Date] | Leadership commitment, ISMS objectives, management review decisions |

### Evidence Reviewed

| Evidence Category | Examples Reviewed |
|---|---|
| ISMS governance documents | ISMS scope, information security policy, ISMS objectives, interested parties register |
| Risk documentation | Risk assessment methodology, risk register, risk treatment plan, risk acceptance records |
| Statement of Applicability | Current SoA, control justifications, implementation status, control owner mapping |
| Internal audit records | Audit programme, audit plan, audit checklist, audit working papers, audit reports |
| Corrective action records | Nonconformity register, root cause analysis, corrective action plans, closure evidence |
| Management review records | Management review agenda, minutes, action logs, decisions, resource allocation |
| Operational control evidence | Access reviews, backup logs, vulnerability reports, incident records, supplier reviews |
| Competence and awareness records | Training completion logs, role competence records, awareness communications |

### Sampling

The audit used judgmental sampling based on ISMS risk, previous audit results, materiality, and process criticality.

| Sample Area | Sample Size / Period | Basis for Selection |
|---|---|---|
| Internal audit records | [Number] audits from current audit cycle | relevance and certification readiness |
| Corrective actions | [Number] open and closed actions | Prior audit findings and closure quality |
| Risk treatment items | [Number] risks and treatments | High and medium residual risks |
| Annex A controls | [Number] controls | Applicability, risk linkage, and operational importance |
| Access reviews | [Number] user access review records | Identity and access management risk |
| Supplier reviews | [Number] suppliers | Criticality and outsourced ISMS dependencies |

## Detailed Findings / Results (with structure)

### IA-2022-01 — Internal Audit Programme Does Not Fully Demonstrate Requirements

| Field | Detail |
|---|---|
| Finding ID | IA-2022-01 |
| Finding Type | Nonconformity |
| Severity | Major |
| ISO/IEC 27001:2022 Reference | and |
| Process / Area | Internal audit programme |
| Owner | ISMS Manager / Internal Audit Function |
| Status | Open |

#### Requirement

ISO/IEC 27001:2022 requires the organisation to conduct internal audits at planned intervals to determine whether the ISMS conforms to the organisation’s own requirements and ISO/IEC 27001 requirements, and is effectively implemented and maintained. further requires the organisation to plan, establish, implement, and maintain audit programme(s), including frequency, methods, responsibilities, planning requirements, and reporting. The programme must consider the importance of the processes concerned and results of previous audits. The organisation must define audit criteria and scope for each audit, select auditors to ensure objectivity and impartiality, report audit results to relevant management, and retain documented information.

#### Evidence Reviewed

| Evidence | Result |
|---|---|
| Internal Audit Programme [Year] | Exists but does not define complete coverage of ISMS processes across the audit cycle |
| Internal Audit Plan for [Audit Name] | Includes audit dates and participants but does not consistently define audit criteria and scope boundaries |
| Prior audit reports | Previous results are available but not demonstrably used to prioritise current audit activities |
| Auditor assignment records | Auditors identified, but independence and impartiality are not consistently documented |
| ISMS scope and SoA | Not fully mapped to the audit programme to demonstrate coverage of applicable ISMS requirements and controls |

#### Finding Statement

The internal audit programme is established but does not fully demonstrate that audits are planned at intervals based on the importance of ISMS processes, changes affecting the organisation, and results of previous audits. The audit programme also lacks sufficient documented linkage between audit scope, audit criteria, auditor impartiality, ISMS process coverage, and Annex A control coverage.

#### Objective Evidence

- The Internal Audit Programme [Year] lists audit activities but does not include a complete audit cycle map showing when all relevant ISO/IEC 27001:2022 clauses and applicable Annex A controls will be audited.
- The audit programme does not document a risk-based rationale for audit frequency.
- Previous audit findings were not referenced in the current audit planning records.
- Auditor independence declarations were not available for all assigned auditors.
- Some audit plans reviewed did not define explicit audit criteria, such as specific ISO/IEC 27001 clauses, internal policies, or procedures being tested.

#### Impact / Risk

Failure to maintain a complete and risk-based internal audit programme may result in:

- Insufficient assurance that the ISMS conforms to ISO/IEC 27001:2022;
- Critical ISMS processes or controls not being audited within appropriate intervals;
- Reduced ability to identify systemic control weaknesses;
- Challenge from certification auditors regarding conformity;
- Weak linkage between internal audit, management review, corrective action, and continual improvement.

#### Root Cause Assessment

Preliminary root cause indicates that the internal audit programme was developed as a calendar of audit events rather than as a structured audit programme that defines frequency, methods, responsibilities, scope, criteria, risk basis, and reporting requirements.

#### Required Corrective Action

| Action | Owner | Due Date | Evidence Required |
|---|---|---:|---|
| Revise the Internal Audit Programme to include frequency, methods, responsibilities, planning requirements, reporting, and full ISMS coverage | ISMS Manager | [Date] | Approved Internal Audit Programme |
| Map the audit programme to ISO/IEC 27001:2022 clauses, applicable Annex A controls, ISMS processes, and prior audit results | Internal Audit Lead | [Date] | Audit coverage matrix |
| Define documented audit criteria and scope for each planned audit | Internal Audit Lead | [Date] | Updated audit plans |
| Implement auditor independence and impartiality declarations | Internal Audit Function | [Date] | Signed declarations or equivalent records |
| Review updated programme with relevant management | ISMS Manager | [Date] | Meeting minutes / approval record |

---

### IA-2022-02 — Audit Records Do Not Consistently Evidence Criteria, Sampling, and Conclusions

| Field | Detail |
|---|---|
| Finding ID | IA-2022-02 |
| Finding Type | Nonconformity |
| Severity | Minor |
| ISO/IEC 27001:2022 Reference | |
| Process / Area | Internal audit execution and reporting |
| Owner | Internal Audit Lead |
| Status | Open |

#### Requirement

ISO/IEC 27001:2022 requires the organisation to retain documented information as evidence of the implementation of the audit programme and audit results. Audit records should be sufficient to demonstrate that audits were performed objectively against defined criteria and that conclusions are supported by evidence.

#### Evidence Reviewed

| Evidence | Result |
|---|---|
| Audit checklists | Available for some audits but not consistently completed |
| Audit working papers | Limited evidence of sampling rationale and test results |
| Audit reports | Findings reported, but traceability to specific criteria is inconsistent |
| Interview notes | Maintained informally in some cases |
| Evidence logs | Not used consistently |

#### Finding Statement

Audit records do not consistently demonstrate the audit criteria applied, evidence sampled, test results, and basis for audit conclusions. While audit reports exist, the supporting working papers are not always sufficiently detailed to enable independent verification of how conclusions were reached.

#### Objective Evidence

- Two sampled audit files did not identify the specific ISO/IEC 27001:2022 clauses or internal procedures assessed.
- Evidence logs were not consistently maintained to show the records reviewed.
- Some audit conclusions were stated as “satisfactory” without documented test steps or supporting evidence.
- Sampling rationale was not documented for selected operational control testing.

#### Impact / Risk

Insufficient audit evidence may:

- Reduce the reliability and repeatability of audit conclusions;
- Limit the organisation’s ability to defend audit results during external assessment;
- Impair trend analysis and continual improvement;
- Create ambiguity over whether findings are isolated or systemic.

#### Root Cause Assessment

Audit execution templates do not require auditors to document criteria, sample details, test results, and evidence references in a consistent format.

#### Required Corrective Action

| Action | Owner | Due Date | Evidence Required |
|---|---|---:|---|
| Update internal audit templates to include audit criteria, scope, samples, evidence references, test results, and conclusions | Internal Audit Lead | [Date] | Approved audit template |
| Train auditors on evidence recording expectations | Internal Audit Lead | [Date] | Training record |
| Retrospectively update current-cycle audit files where evidence is available | Assigned Auditors | [Date] | Updated audit files |
| Perform quality review of audit files before report issuance | Internal Audit Lead | [Date] | Audit file review checklist |

---

### IA-2022-03 — Corrective Actions from Prior Audits Are Not Consistently Tracked to Effective Closure

| Field | Detail |
|---|---|
| Finding ID | IA-2022-03 |
| Finding Type | Nonconformity |
| Severity | Minor |
| ISO/IEC 27001:2022 Reference |, |
| Process / Area | Corrective action and continual improvement |
| Owner | ISMS Manager / Process Owners |
| Status | Open |

#### Requirement

ISO/IEC 27001:2022 requires internal audit results to be reported to relevant management and retained as documented information. Where nonconformities are identified, requires the organisation to react to the nonconformity, evaluate the need for action to eliminate causes, implement actions, review effectiveness, and update the ISMS where necessary.

#### Evidence Reviewed

| Evidence | Result |
|---|---|
| Prior internal audit reports | Findings identified |
| Corrective action register | Maintained, but fields incomplete |
| Root cause analysis records | Inconsistent |
| Closure evidence | Available for some actions only |
| Effectiveness review records | Not consistently documented |

#### Finding Statement

Corrective actions arising from prior internal audit findings are not consistently managed through documented root cause analysis, owner assignment, target date, closure evidence, and effectiveness review.

#### Objective Evidence

- Three sampled corrective actions did not include documented root cause analysis.
- Two closed actions lacked evidence demonstrating implementation.
- Effectiveness reviews were not documented for several completed actions.
- One overdue action did not show escalation or revised management-approved due date.

#### Impact / Risk

Weak corrective action management may result in:

- Recurrence of nonconformities;
- Inability to demonstrate effective response to audit findings;
- Reduced ISMS continual improvement;
- Increased likelihood of repeated findings during certification audit.

#### Root Cause Assessment

The corrective action process exists but is not consistently enforced. The corrective action register does not mandate all fields required to demonstrate full lifecycle management and effectiveness review.

#### Required Corrective Action

| Action | Owner | Due Date | Evidence Required |
|---|---|---:|---|
| Update corrective action register to require root cause, containment, corrective action, owner, due date, closure evidence, and effectiveness review | ISMS Manager | [Date] | Updated corrective action register |
| Review all open and recently closed audit actions for completeness | ISMS Manager | [Date] | Corrective action review record |
| Escalate overdue actions to relevant management | ISMS Manager | [Date] | Escalation record |
| Define effectiveness review criteria and timing | Internal Audit Lead | [Date] | Corrective action procedure update |
| Report corrective action status to management review | ISMS Manager | [Date] | Management review input pack |

---

### IA-2022-04 — Limited Trend Analysis of Internal Audit Results in Management Review

| Field | Detail |
|---|---|
| Finding ID | IA-2022-04 |
| Finding Type | Observation |
| Severity | Medium |
| ISO/IEC 27001:2022 Reference |, |
| Process / Area | Management review |
| Owner | Senior Management / ISMS Manager |
| Status | Open |

#### Requirement

ISO/IEC 27001:2022 requires internal audit results to be reported to relevant management. Management review under should consider ISMS performance, including audit results, nonconformities, corrective actions, changes in external and internal issues, and opportunities for continual improvement.

#### Evidence Reviewed

| Evidence | Result |
|---|---|
| Management review minutes | Internal audit results included |
| Audit summary reports | Presented at high level |
| Corrective action status | Included but limited trend analysis |
| Management decisions | Some decisions recorded, but not always linked to audit results |

#### Observation Statement

Internal audit results are reported to management; however, reporting is primarily status-based and does not consistently include trend analysis, recurring themes, systemic issues, aging of findings, or effectiveness of corrective actions.

#### Impact / Risk

Limited management analysis may reduce the ability of leadership to:

- Identify systemic ISMS weaknesses;
- Allocate resources based on audit risk;
- Prioritise recurring control failures;
- Demonstrate effective oversight of continual improvement.

#### Recommended Improvement

| Recommendation | Owner | Target Date | Evidence |
|---|---|---:|---|
| Add audit trend analysis to management review inputs | ISMS Manager | [Date] | Updated management review pack |
| Report findings by severity, clause/control area, business process, age, and recurrence | Internal Audit Lead | [Date] | Audit dashboard |
| Record management decisions and resource commitments linked to audit results | Senior Management | [Date] | Management review minutes |

---

### IA-2022-05 — Auditor Competence Criteria Are Not Fully Documented

| Field | Detail |
|---|---|
| Finding ID | IA-2022-05 |
| Finding Type | Opportunity for Improvement |
| Severity | Low |
| ISO/IEC 27001:2022 Reference |, |
| Process / Area | Auditor competence and independence |
| Owner | Internal Audit Function / HR |
| Status | Open |

#### Requirement

ISO/IEC 27001:2022 requires the organisation to determine necessary competence for persons doing work under its control that affects information security performance. also requires auditors to be selected and audits conducted to ensure objectivity and impartiality.

#### Current Practice

Auditors are selected based on experience and availability. Informal consideration is given to audit experience, information security knowledge, and independence from the audited process.

#### Improvement Opportunity

The organisation would benefit from formally defining internal auditor competence criteria, including:

- Knowledge of ISO/IEC 27001:2022 requirements;
- Understanding of the organisation’s ISMS scope and risk context;
- Audit principles and evidence evaluation skills;
- Technical competence relevant to audited controls;
- Independence and conflict-of-interest requirements;
- Continuing competence expectations.

#### Recommended Improvement

| Recommendation | Owner | Target Date | Evidence |
|---|---|---:|---|
| Define internal ISMS auditor competence criteria | Internal Audit Lead / HR | [Date] | Competence matrix |
| Maintain auditor training and qualification records | HR / ISMS Manager | [Date] | Training records |
| Review auditor competence annually as part of audit programme planning | Internal Audit Lead | [Date] | Annual auditor competence review |

---

### IA-2022-06 — Positive Practice: Structured ISMS Documentation and Version Control

| Field | Detail |
|---|---|
| Finding ID | IA-2022-06 |
| Finding Type | Positive Practice |
| Severity | N/A |
| ISO/IEC 27001:2022 Reference | |
| Process / Area | Documented information |
| Owner | ISMS Manager |
| Status | Not applicable |

#### Positive Practice Statement

The organisation maintains a structured ISMS documentation set with assigned document owners, version numbers, classification markings, and controlled access. This supports effective auditability and provides a strong foundation for maintaining required documented information under ISO/IEC 27001:2022.

#### Evidence Reviewed

| Evidence | Result |
|---|---|
| ISMS document register | Maintained and current |
| Document templates | Include owner, version, approval, and classification fields |
| Access permissions | Restricted to authorised personnel |
| Policy approval records | Available for sampled policies |

#### Benefit

This practice improves consistency, accountability, and traceability across ISMS documentation and supports evidence readiness for internal and external audits.

## Analysis

### Conformity Assessment

| ISO/IEC 27001:2022 Requirement | Assessment | Supporting Result |
|---|---|---|
| Internal audits are conducted at planned intervals | Partially conforming | Audit activities are scheduled, but the programme lacks full documented coverage and risk-based frequency rationale |
| Audits determine whether the ISMS conforms to organisational requirements | Partially conforming | Some internal requirements are audited, but criteria are not consistently documented |
| Audits determine whether the ISMS conforms to ISO/IEC 27001:2022 | Partially conforming | ISO clauses are not consistently mapped in audit plans and working papers |
| Audits determine whether the ISMS is effectively implemented and maintained | Partially conforming | Effectiveness is considered, but evidence and test results are inconsistently recorded |
| Audit programme considers importance of processes | Partially conforming | No documented rationale demonstrating prioritisation by process importance |
| Audit programme considers results of previous audits | Partially conforming | Prior findings exist but are not demonstrably used in audit planning |
| Audit criteria and scope are defined for each audit | Partially conforming | Some audit plans lack explicit criteria and scope boundaries |
| Auditors are selected to ensure objectivity and impartiality | Partially conforming | Independence is considered but not consistently documented |
| Audit results are reported to relevant management | Conforming with improvement needed | Results are reported, but management analysis could be strengthened |
| Documented information is retained as evidence of audit programme and results | Partially conforming | Reports exist, but working papers and evidence traceability are inconsistent |

### Thematic Analysis

The findings indicate that the ISMS internal audit process is operational but not yet fully mature. The primary weakness is not the absence of internal audit activity, but insufficient programme-level discipline and evidence quality.

Key themes include:

1. **Audit programme maturity**
 - The audit schedule exists, but it does not yet function as a complete audit programme that clearly demonstrates risk-based prioritisation, full ISMS coverage, methods, responsibilities, and reporting arrangements.

2. **Traceability of audit evidence**
 - Audit conclusions are documented, but supporting evidence is not consistently traceable to criteria, sampled records, and test results.

3. **Corrective action lifecycle**
 - Findings are captured, but corrective actions are not consistently supported by root cause analysis, closure evidence, and effectiveness review.

4. **Management oversight**
 - Internal audit results reach management, but trend-based reporting and decision tracking require strengthening to better support management review and continual improvement.

5. **Certification readiness**
 - Identified issues are remediable within a reasonable timeframe; however, unresolved weaknesses may be material during certification or surveillance audit.

### Risk Implications

| Risk Area | Implication |
|---|---|
| Certification risk | External auditors may raise nonconformities if internal audit programme evidence remains incomplete |
| Operational assurance risk | Critical ISMS processes may not receive proportionate audit attention |
| Continual improvement risk | Weak corrective action effectiveness review may allow recurring nonconformities |
| Governance risk | Management may lack sufficient insight into systemic audit trends |
| Evidence risk | Inconsistent records may prevent demonstration of conformity despite actual control operation |

### Overall Maturity Assessment

| Capability Area | Maturity Rating | Rationale |
|---|---:|---|
| Audit programme planning | Developing | Schedule exists but lacks full risk-based and coverage-based design |
| Audit execution | Developing | Audits are performed, but evidence documentation is inconsistent |
| Auditor independence | Developing | Considered informally but not consistently evidenced |
| Audit reporting | Established | Reports are produced and communicated |
| Corrective action management | Developing | Register exists but lifecycle controls are inconsistent |
| Management review integration | Established with improvement needed | Results are reviewed but trend analysis is limited |
| Document control | Established | Documented information is well structured and controlled |

## Recommendations & Actions

### Corrective Action Plan

| Finding ID | Required Action Summary | Owner | Priority | Due Date | Status |
|---|---|---|---:|---:|---|
| IA-2022-01 | Revise and approve a complete risk-based ISMS internal audit programme | ISMS Manager | High | [Date] | Open |
| IA-2022-01 | Create audit coverage matrix mapped to ISO/IEC 27001:2022 clauses, ISMS processes, SoA controls, and prior findings | Internal Audit Lead | High | [Date] | Open |
| IA-2022-01 | Implement auditor independence declarations for each audit | Internal Audit Function | Medium | [Date] | Open |
| IA-2022-02 | Update audit working paper templates to require criteria, samples, evidence, tests, and conclusions | Internal Audit Lead | High | [Date] | Open |
| IA-2022-02 | Conduct audit file quality review before final report issuance | Internal Audit Lead | Medium | [Date] | Open |
| IA-2022-03 | Update corrective action register and procedure to require full lifecycle tracking | ISMS Manager | High | [Date] | Open |
| IA-2022-03 | Review all open and recently closed audit actions for completeness and effectiveness | ISMS Manager | High | [Date] | Open |
| IA-2022-04 | Add audit trend analysis to management review reporting | ISMS Manager | Medium | [Date] | Open |
| IA-2022-05 | Define and maintain internal auditor competence criteria and records | Internal Audit Lead / HR | Low | [Date] | Open |

### Recommended Internal Audit Programme Enhancements

The internal audit programme should be revised to include the following minimum elements to support ISO/IEC 27001:2022 conformity:

| Programme Element | Required Content |
|---|---|
| Audit objectives | Assurance over ISMS conformity, effectiveness, implementation, and maintenance |
| Audit frequency | Defined intervals based on risk, process importance, change, prior results, and certification cycle |
| Audit methods | Interviews, document review, sampling, walkthroughs, observation, technical evidence review |
| Responsibilities | Audit programme owner, lead auditor, auditors, auditees, management reviewers |
| Audit scope | Processes, locations, systems, services, clauses, and controls included |
| Audit criteria | ISO/IEC 27001:2022 clauses, internal ISMS requirements, SoA, policies, procedures, legal/contractual obligations |
| Auditor impartiality | Independence confirmation and conflict-of-interest declaration |
| Reporting | Report recipients, timelines, severity model, management escalation |
| Records | Programme, plans, checklists, working papers, evidence logs, findings, reports, corrective actions |
| Follow-up | Corrective action verification, closure evidence, and effectiveness review |

### Suggested Audit Coverage Matrix

| ISMS Area | ISO/IEC 27001:2022 Reference | Audit Frequency | Priority Basis | Next Planned Audit |
|---|---|---:|---|---:|
| ISMS context and scope |–4.4 | Annual | Foundation of ISMS applicability | [Date] |
| Leadership and policy |–5.3 | Annual | Governance and accountability | [Date] |
| Risk assessment and treatment |–6.1.3 | Semi-annual | Core ISMS process and high assurance dependency | [Date] |
| ISMS objectives | | Annual | Performance and continual improvement | [Date] |
| Competence and awareness |–7.3 | Annual | Human factor risk | [Date] |
| Documented information | | Annual | Evidence and auditability | [Date] |
| Operational planning and control | | Annual | Control implementation | [Date] |
| Risk assessment updates | | Semi-annual | Change and threat landscape | [Date] |
| Risk treatment implementation | | Semi-annual | Residual risk management | [Date] |
| Monitoring and measurement | | Annual | ISMS performance evidence | [Date] |
| Internal audit | | Annual | Required assurance process | [Date] |
| Management review | | Annual | Leadership oversight | [Date] |
| Nonconformity and corrective action | | Quarterly | Finding closure and recurrence prevention | [Date] |
| Continual improvement | | Annual | ISMS maturity | [Date] |
| Selected Annex A controls | Annex A | Risk-based | Based on SoA, risk treatment, and prior findings | [Date] |

### Management Action Tracking

| Action Ref | Action Description | Assigned Owner | Due Date | Success Criteria | Verification Method |
|---|---|---|---:|---|---|
| ACT-001 | Approve revised internal audit programme | ISMS Manager | [Date] | Programme includes all required elements | Document review |
| ACT-002 | Establish audit coverage matrix | Internal Audit Lead | [Date] | Matrix maps clauses, controls, scope areas, and audit cycle | Document review |
| ACT-003 | Implement enhanced audit working papers | Internal Audit Lead | [Date] | Audit files show criteria, samples, evidence, tests, conclusions | Sample file review |
| ACT-004 | Complete corrective action register remediation | ISMS Manager | [Date] | All open actions include owner, due date, root cause, status, evidence | Register review |
| ACT-005 | Conduct effectiveness review of closed prior findings | Internal Audit Lead | [Date] | Closed findings verified as effective or reopened | Effectiveness review record |
| ACT-006 | Present audit trend dashboard to management review | ISMS Manager | [Date] | Management review records include trends, decisions, and actions | Minutes review |
| ACT-007 | Define auditor competence and independence process | HR / Internal Audit Lead | [Date] | Competence criteria and independence records maintained | Record review |

### Follow-Up Audit Requirements

A follow-up audit should be conducted to verify implementation and effectiveness of corrective actions related to IA-2022-01, IA-2022-02, and IA-2022-03.

| Follow-Up Item | Planned Verification Date | Verification Criteria |
|---|---:|---|
| Revised audit programme implemented | [Date] | Approved programme meets requirements |
| Audit records improved | [Date] | Sampled audit file demonstrates complete evidence traceability |
| Corrective action process effective | [Date] | Sampled actions include root cause, closure evidence, and effectiveness review |
| Management review integration strengthened | [Date] | Audit trends and management decisions documented |
| Auditor competence documented | [Date] | Auditor competence and impartiality records available |

### Acceptance Criteria for Closure

Findings should not be closed until objective evidence demonstrates that:

- Corrective actions have been implemented as planned;
- Root causes have been addressed, not only symptoms;
- Required documented information has been updated and approved;
- Relevant personnel have been informed or trained where applicable;
- Effectiveness has been reviewed after a suitable period of operation;
- Residual risk has been considered and accepted where relevant;
- Management has been informed of closure status.

## Distribution & Confidentiality

### Distribution List

| Recipient / Role | Purpose of Distribution |
|---|---|
| Senior Management | Oversight, resource allocation, and management review input |
| ISMS Manager | Corrective action coordination and ISMS maintenance |
| Internal Audit Function | Audit programme improvement and follow-up planning |
| Process Owners | Remediation of assigned findings |
| Risk Owners | Consideration of risk treatment and residual risk implications |
| Compliance / Governance Function | Evidence retention and certification readiness |
| External Certification Auditor | Provided upon request during certification or surveillance audit, subject to approval |

### Confidentiality Classification

This report is classified as **Confidential**. It contains information regarding ISMS weaknesses, audit findings, control performance, and corrective action priorities. Unauthorised disclosure may increase organisational risk or compromise the integrity of security improvement activities.

### Handling Requirements

| Requirement | Instruction |
|---|---|
| Access | Restricted to authorised personnel with a legitimate governance, risk, compliance, audit, or management need |
| Storage | Store in the approved document repository: [Repository / Location] |
| Transmission | Transmit using approved secure communication channels only |
| External sharing | Requires approval from [Authorising Role] |
| Retention period | Retain in accordance with the ISMS documented information retention requirements, minimum [Retention Period] |
| Disposal | Dispose securely in accordance with information classification and records management requirements |

### Report Approval

| Role | Name | Signature / Approval Method | Date |
|---|---|---|---:|
| Lead Internal Auditor | [Name] | [Signature / Electronic Approval] | [Date] |
| ISMS Manager | [Name] | [Signature / Electronic Approval] | [Date] |
| Senior Management Representative | [Name] | [Signature / Electronic Approval] | [Date] |

### Change History

| Version | Date | Description of Change | Author / Owner |
|---:|---:|---|---|
| 1.0 | [Date] | Initial issue of Internal Audit Report | Internal Audit Function |