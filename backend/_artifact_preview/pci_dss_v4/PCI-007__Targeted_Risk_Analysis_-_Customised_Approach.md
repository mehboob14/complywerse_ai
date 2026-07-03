<!-- pci_dss_v4 / PCI-007 | type=Report | mode=markdown | model=gpt-5.5 | 36867 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [DOC-ID-TRA-CUST-APPROACH] | 1.0 | [Risk & Compliance Owner] | [Effective Date] | PCI DSS v4.0.1 | Requirement 12.3.2 | Confidential |

## Purpose

This report documents the Targeted Risk Analysis (“TRA”) performed for each PCI DSS v4.0.1 requirement that [Organisation Name] intends to meet using the **Customized Approach**.

PCI DSS v4.0.1 Requirement 12.3.2 requires that a targeted risk analysis be performed for **each PCI DSS requirement met using the Customized Approach**, to demonstrate that the customized control:

- Meets the **Customized Approach Objective** for the applicable PCI DSS requirement.
- Provides a level of security equivalent to or greater than the defined approach.
- Is appropriate for the organisation’s cardholder data environment (“CDE”), threats, risks, technologies, and business processes.
- Is formally documented, reviewed, and supported by evidence.

This report is intended to support internal governance, management approval, and external assessment activities, including validation by the Qualified Security Assessor (“QSA”) or Internal Security Assessor (“ISA”), where applicable.

## Reporting Period & Scope

### Reporting Period

| Item | Detail |
|---|---|
| Reporting Period Covered | [Start Date] to [End Date] |
| TRA Completion Date | [TRA Completion Date] |
| Next Scheduled Review | [Next Review Date] |
| Review Frequency | At least annually and upon significant change to the customized control, technology, process, threat environment, or CDE scope |
| Assessment Context | PCI DSS v4.0.1 Customized Approach validation |

### Scope

This report covers all PCI DSS v4.0.1 requirements for which [Organisation Name] has elected to use the Customized Approach instead of the Defined Approach.

The scope includes:

- In-scope CDE systems, applications, networks, cloud services, and security technologies supporting payment processing.
- Connected-to and security-impacting systems where they influence the effectiveness of the customized control.
- Business processes, operational procedures, monitoring activities, and compensating or alternative control mechanisms associated with the customized approach.
- Evidence that demonstrates the customized control meets the applicable PCI DSS Customized Approach Objective.

### In-Scope Customized Approach Controls

| TRA ID | PCI DSS Requirement | Customized Approach Objective Summary | Business / Technical Area | Status |
|---|---|---|---|---|
| TRA-CA-001 | [PCI DSS Requirement Number] | [Customized Approach Objective Summary] | [System / Process / Control Area] | [Draft / Approved / Pending Remediation] |
| TRA-CA-002 | [PCI DSS Requirement Number] | [Customized Approach Objective Summary] | [System / Process / Control Area] | [Draft / Approved / Pending Remediation] |
| TRA-CA-003 | [PCI DSS Requirement Number] | [Customized Approach Objective Summary] | [System / Process / Control Area] | [Draft / Approved / Pending Remediation] |

### Out of Scope

The following are excluded from this report:

- PCI DSS requirements implemented using the Defined Approach only.
- General enterprise risk assessments not tied to a specific customized-approach PCI DSS requirement.
- Business continuity, financial, privacy, or operational risk analyses unless they directly affect the customized PCI DSS control objective.
- Third-party environments outside [Organisation Name]’s PCI DSS responsibility unless the customized control relies on third-party implementation or evidence.

## Executive Summary

[Organisation Name] performed a Targeted Risk Analysis in accordance with PCI DSS v4.0.1 Requirement 12.3.2 for each PCI DSS requirement implemented using the Customized Approach.

The analysis assessed whether each customized control adequately addresses the specific risk that the corresponding PCI DSS requirement is intended to mitigate and whether the control achieves the stated Customized Approach Objective. The review considered threat scenarios, affected assets, control design, implementation evidence, operating effectiveness, residual risk, and management acceptance.

### Summary Conclusion

Based on the analysis performed, the customized controls reviewed in this report are assessed as follows:

| Overall Result | Count | Description |
|---|---:|---|
| Meets Objective | [Number] | Customized control is suitably designed, implemented, evidenced, and assessed as meeting the PCI DSS Customized Approach Objective. |
| Meets Objective with Actions | [Number] | Customized control is substantially effective but requires minor remediation or evidence enhancement before final assessment reliance. |
| Does Not Yet Meet Objective | [Number] | Customized control has design, implementation, evidence, or operating effectiveness gaps that must be remediated before it can be relied upon. |
| Pending Assessment | [Number] | TRA is incomplete or awaiting validation evidence, owner approval, or QSA/ISA review. |

### Key Findings

The TRA identified the following key findings:

1. **Customized controls must be explicitly mapped to the PCI DSS Customized Approach Objective.** 
 For each customized control, the analysis confirmed whether the control directly addresses the security outcome intended by PCI DSS, rather than merely replacing a prescribed activity with an undocumented alternative.

2. **Evidence quality is critical for assessor reliance.** 
 Customized Approach validation requires more than a control description. Evidence must demonstrate both control design and operating effectiveness, including configuration records, monitoring outputs, logs, workflow records, exception handling, and review approvals.

3. **Residual risk must be formally evaluated and approved.** 
 Where the customized control does not mirror the Defined Approach, management must understand and approve any residual risk after considering likelihood, impact, and mitigating controls.

4. **Ongoing monitoring and change triggers are required.** 
 Customized controls must remain effective as technologies, threats, payment flows, and business processes change. Significant changes must trigger re-performance or update of the TRA.

### Management Decision

| Decision Area | Outcome |
|---|---|
| Use of Customized Approach Approved | [Yes / No / Conditional] |
| Residual Risk Accepted | [Yes / No / Conditional] |
| Remediation Required | [Yes / No] |
| QSA/ISA Review Required | Yes |
| Executive Risk Acceptance Required | [Yes / No] |

## Methodology

### PCI DSS Requirement Basis

This report was prepared to satisfy PCI DSS v4.0.1 Requirement 12.3.2, which requires targeted risk analysis for each PCI DSS requirement met using the Customized Approach.

The TRA considers the following PCI DSS Customized Approach expectations:

- The customized control must meet the **Customized Approach Objective** stated in PCI DSS v4.0.1.
- The organisation must document how the customized control sufficiently mitigates the risk addressed by the requirement.
- The analysis must be specific to the individual customized control and environment.
- The analysis must support assessor validation through documented rationale and evidence.
- The TRA must be reviewed at least annually and when significant changes occur.

### Assessment Inputs

The following inputs were reviewed:

| Input Category | Examples Reviewed |
|---|---|
| PCI DSS Requirement Details | Applicable PCI DSS v4.0.1 requirement text, Defined Approach, Customized Approach Objective, testing procedures, guidance. |
| Control Design Documentation | Control descriptions, architecture diagrams, process flows, standard operating procedures, security standards. |
| Technical Evidence | System configurations, access control settings, monitoring rules, vulnerability data, logging outputs, automated control records. |
| Operational Evidence | Tickets, review records, approvals, exception logs, incident records, change records, control execution evidence. |
| CDE Scope Information | Network diagrams, data-flow diagrams, asset inventories, segmentation records, service provider responsibilities. |
| Threat and Risk Inputs | Prior risk assessments, vulnerability assessments, penetration test outputs, incident history, threat intelligence, audit findings. |
| Stakeholder Interviews | Control owners, system administrators, security operations, compliance, business process owners, third-party managers. |

### Risk Analysis Criteria

The analysis applied a structured likelihood and impact model.

#### Likelihood Rating

| Rating | Definition |
|---|---|
| Low | The threat scenario is unlikely due to strong preventive controls, limited exposure, low threat capability, or absence of known exploitation paths. |
| Medium | The threat scenario is plausible due to moderate exposure, partial control dependency, common attack techniques, or known operational complexity. |
| High | The threat scenario is likely due to high exposure, active threat activity, control weaknesses, known vulnerabilities, or frequent process exceptions. |

#### Impact Rating

| Rating | Definition |
|---|---|
| Low | Limited effect on the CDE; no expected compromise of cardholder data or sensitive authentication data; minimal operational disruption. |
| Medium | Potential degradation of PCI DSS control effectiveness; possible unauthorized access path or limited exposure of account data. |
| High | Potential compromise of cardholder data or sensitive authentication data, material CDE impact, regulatory exposure, or significant business disruption. |

#### Residual Risk Rating

| Residual Risk | Criteria |
|---|---|
| Low | Customized control is well-designed, consistently operating, evidenced, monitored, and residual exposure is minimal. |
| Medium | Customized control is generally effective but has moderate dependency, manual components, evidence gaps, or improvement actions. |
| High | Customized control has material design or operating gaps and cannot currently be relied upon to meet the objective. |

### TRA Evaluation Steps

Each customized control was evaluated using the following steps:

| Step | Activity | Output |
|---:|---|---|
| 1 | Confirm PCI DSS requirement and Customized Approach Objective. | Validated requirement mapping. |
| 2 | Identify assets, systems, processes, data flows, and responsible owners. | Scope definition for the customized control. |
| 3 | Document the customized control design and rationale for not using the Defined Approach. | Control design narrative. |
| 4 | Identify threats and failure scenarios relevant to the requirement objective. | Threat scenario register. |
| 5 | Assess inherent likelihood and impact before customized control operation. | Inherent risk rating. |
| 6 | Evaluate preventive, detective, and corrective control components. | Control effectiveness assessment. |
| 7 | Review implementation and operating evidence. | Evidence sufficiency conclusion. |
| 8 | Determine residual risk and whether the PCI DSS objective is met. | TRA conclusion. |
| 9 | Document remediation actions, risk acceptance, and approval. | Action plan and management sign-off. |

### Assessment Roles

| Role | Responsibility |
|---|---|
| Control Owner | Provides control description, implementation evidence, operational context, and remediation commitments. |
| Risk & Compliance Owner | Leads TRA process, documents analysis, ensures consistency with PCI DSS v4.0.1 Requirement 12.3.2. |
| Security Architecture / Engineering | Validates technical control design and security equivalence. |
| Security Operations | Provides monitoring, alerting, incident, and operational evidence. |
| Business Owner | Confirms business process dependency and operational feasibility. |
| QSA / ISA | Reviews and validates the Customized Approach and supporting TRA as part of PCI DSS assessment activities. |
| Senior Management / Risk Committee | Reviews and approves residual risk acceptance where required. |

## Detailed Findings / Results

### Results Summary

| TRA ID | PCI DSS Requirement | Customized Control Name | Objective Met? | Residual Risk | Evidence Sufficiency | Action Required |
|---|---|---|---|---|---|---|
| TRA-CA-001 | [Requirement Number] | [Control Name] | [Yes / Partial / No] | [Low / Medium / High] | [Sufficient / Partial / Insufficient] | [Yes / No] |
| TRA-CA-002 | [Requirement Number] | [Control Name] | [Yes / Partial / No] | [Low / Medium / High] | [Sufficient / Partial / Insufficient] | [Yes / No] |
| TRA-CA-003 | [Requirement Number] | [Control Name] | [Yes / Partial / No] | [Low / Medium / High] | [Sufficient / Partial / Insufficient] | [Yes / No] |

---

### TRA-CA-001 — [PCI DSS Requirement Number]: [Requirement Title]

#### Requirement and Objective

| Field | Detail |
|---|---|
| PCI DSS Requirement | [Requirement Number] |
| Requirement Area | [PCI DSS Requirement Area] |
| Customized Approach Objective | [Exact or summarized PCI DSS Customized Approach Objective] |
| Defined Approach Not Used Because | [Business, technology, architectural, or operational reason] |
| Control Owner | [Control Owner / Team] |
| Systems / Processes in Scope | [Systems, applications, networks, processes] |
| Related CDE Assets | [Asset IDs / asset groups] |

#### Customized Control Description

[Describe the customized control in precise terms. Include what the control does, how it is enforced, where it operates, how frequently it operates, whether it is automated or manual, and how exceptions are handled.]

The customized control consists of the following components:

| Component Type | Description |
|---|---|
| Preventive Control | [Preventive mechanism, e.g., technical enforcement, access restriction, configuration baseline, network restriction.] |
| Detective Control | [Monitoring, alerting, logging, review, reconciliation, exception reporting.] |
| Corrective Control | [Incident response, remediation workflow, revocation, configuration rollback, escalation.] |
| Governance Control | [Policy, standard, approval, risk acceptance, periodic review.] |
| Evidence Source | [Evidence repository, system report, ticketing system, SIEM, GRC platform.] |

#### Threat and Failure Scenarios

| Scenario ID | Threat / Failure Scenario | Potential Effect on PCI DSS Objective | Inherent Likelihood | Inherent Impact |
|---|---|---|---|---|
| S-001 | [Threat scenario, e.g., control bypass due to misconfiguration] | [Impact to objective] | [Low / Medium / High] | [Low / Medium / High] |
| S-002 | [Threat scenario, e.g., unauthorized access due to process exception] | [Impact to objective] | [Low / Medium / High] | [Low / Medium / High] |
| S-003 | [Threat scenario, e.g., failure to detect control degradation] | [Impact to objective] | [Low / Medium / High] | [Low / Medium / High] |

#### Control Effectiveness Assessment

| Assessment Area | Result | Comments |
|---|---|---|
| Alignment to Customized Approach Objective | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Design Adequacy | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Implementation Completeness | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Operating Effectiveness | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Monitoring and Alerting | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Exception Handling | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Evidence Availability | [Sufficient / Partial / Insufficient] | [Rationale] |

#### Evidence Reviewed

| Evidence ID | Evidence Description | Source | Period Covered | Result |
|---|---|---|---|---|
| E-001 | [Configuration export / screenshot / report] | [System / Repository] | [Date / Period] | [Accepted / Gap Identified] |
| E-002 | [Monitoring or alert evidence] | [SIEM / Tool] | [Date / Period] | [Accepted / Gap Identified] |
| E-003 | [Review or approval record] | [Ticket / GRC Platform] | [Date / Period] | [Accepted / Gap Identified] |
| E-004 | [Exception or incident record] | [Ticketing System] | [Date / Period] | [Accepted / Gap Identified] |

#### Residual Risk Determination

| Risk Element | Rating | Rationale |
|---|---|---|
| Residual Likelihood | [Low / Medium / High] | [Rationale after considering customized control] |
| Residual Impact | [Low / Medium / High] | [Rationale after considering customized control] |
| Overall Residual Risk | [Low / Medium / High] | [Overall conclusion] |
| Risk Acceptance Required | [Yes / No] | [Reason] |

#### Finding

**Finding:** [Meets Objective / Meets Objective with Actions / Does Not Yet Meet Objective]

[Provide concise but complete finding narrative. State whether the customized control meets the PCI DSS Customized Approach Objective, what evidence supports the conclusion, and what gaps or conditions remain.]

#### Required Actions

| Action ID | Required Action | Owner | Due Date | Priority | Status |
|---|---|---|---|---|---|
| A-001 | [Action required] | [Owner] | [Due Date] | [High / Medium / Low] | [Open / In Progress / Complete] |
| A-002 | [Action required] | [Owner] | [Due Date] | [High / Medium / Low] | [Open / In Progress / Complete] |

#### Approval

| Approval Role | Name / Title | Decision | Date |
|---|---|---|---|
| Control Owner | [Name / Title] | [Approved / Conditionally Approved / Not Approved] | [Date] |
| Risk & Compliance Owner | [Name / Title] | [Approved / Conditionally Approved / Not Approved] | [Date] |
| Senior Risk Approver, if required | [Name / Title] | [Approved / Conditionally Approved / Not Approved] | [Date] |

---

### TRA-CA-002 — [PCI DSS Requirement Number]: [Requirement Title]

#### Requirement and Objective

| Field | Detail |
|---|---|
| PCI DSS Requirement | [Requirement Number] |
| Requirement Area | [PCI DSS Requirement Area] |
| Customized Approach Objective | [Exact or summarized PCI DSS Customized Approach Objective] |
| Defined Approach Not Used Because | [Business, technology, architectural, or operational reason] |
| Control Owner | [Control Owner / Team] |
| Systems / Processes in Scope | [Systems, applications, networks, processes] |
| Related CDE Assets | [Asset IDs / asset groups] |

#### Customized Control Description

[Describe the customized control and how it achieves the PCI DSS Customized Approach Objective.]

| Component Type | Description |
|---|---|
| Preventive Control | [Description] |
| Detective Control | [Description] |
| Corrective Control | [Description] |
| Governance Control | [Description] |
| Evidence Source | [Description] |

#### Threat and Failure Scenarios

| Scenario ID | Threat / Failure Scenario | Potential Effect on PCI DSS Objective | Inherent Likelihood | Inherent Impact |
|---|---|---|---|---|
| S-001 | [Threat scenario] | [Impact to objective] | [Low / Medium / High] | [Low / Medium / High] |
| S-002 | [Threat scenario] | [Impact to objective] | [Low / Medium / High] | [Low / Medium / High] |
| S-003 | [Threat scenario] | [Impact to objective] | [Low / Medium / High] | [Low / Medium / High] |

#### Control Effectiveness Assessment

| Assessment Area | Result | Comments |
|---|---|---|
| Alignment to Customized Approach Objective | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Design Adequacy | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Implementation Completeness | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Operating Effectiveness | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Monitoring and Alerting | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Exception Handling | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Evidence Availability | [Sufficient / Partial / Insufficient] | [Rationale] |

#### Evidence Reviewed

| Evidence ID | Evidence Description | Source | Period Covered | Result |
|---|---|---|---|---|
| E-001 | [Evidence description] | [Source] | [Date / Period] | [Accepted / Gap Identified] |
| E-002 | [Evidence description] | [Source] | [Date / Period] | [Accepted / Gap Identified] |
| E-003 | [Evidence description] | [Source] | [Date / Period] | [Accepted / Gap Identified] |

#### Residual Risk Determination

| Risk Element | Rating | Rationale |
|---|---|---|
| Residual Likelihood | [Low / Medium / High] | [Rationale] |
| Residual Impact | [Low / Medium / High] | [Rationale] |
| Overall Residual Risk | [Low / Medium / High] | [Overall conclusion] |
| Risk Acceptance Required | [Yes / No] | [Reason] |

#### Finding

**Finding:** [Meets Objective / Meets Objective with Actions / Does Not Yet Meet Objective]

[Provide finding narrative.]

#### Required Actions

| Action ID | Required Action | Owner | Due Date | Priority | Status |
|---|---|---|---|---|---|
| A-001 | [Action required] | [Owner] | [Due Date] | [High / Medium / Low] | [Open / In Progress / Complete] |
| A-002 | [Action required] | [Owner] | [Due Date] | [High / Medium / Low] | [Open / In Progress / Complete] |

#### Approval

| Approval Role | Name / Title | Decision | Date |
|---|---|---|---|
| Control Owner | [Name / Title] | [Approved / Conditionally Approved / Not Approved] | [Date] |
| Risk & Compliance Owner | [Name / Title] | [Approved / Conditionally Approved / Not Approved] | [Date] |
| Senior Risk Approver, if required | [Name / Title] | [Approved / Conditionally Approved / Not Approved] | [Date] |

---

### TRA-CA-003 — [PCI DSS Requirement Number]: [Requirement Title]

#### Requirement and Objective

| Field | Detail |
|---|---|
| PCI DSS Requirement | [Requirement Number] |
| Requirement Area | [PCI DSS Requirement Area] |
| Customized Approach Objective | [Exact or summarized PCI DSS Customized Approach Objective] |
| Defined Approach Not Used Because | [Business, technology, architectural, or operational reason] |
| Control Owner | [Control Owner / Team] |
| Systems / Processes in Scope | [Systems, applications, networks, processes] |
| Related CDE Assets | [Asset IDs / asset groups] |

#### Customized Control Description

[Describe the customized control and how it achieves the PCI DSS Customized Approach Objective.]

| Component Type | Description |
|---|---|
| Preventive Control | [Description] |
| Detective Control | [Description] |
| Corrective Control | [Description] |
| Governance Control | [Description] |
| Evidence Source | [Description] |

#### Threat and Failure Scenarios

| Scenario ID | Threat / Failure Scenario | Potential Effect on PCI DSS Objective | Inherent Likelihood | Inherent Impact |
|---|---|---|---|---|
| S-001 | [Threat scenario] | [Impact to objective] | [Low / Medium / High] | [Low / Medium / High] |
| S-002 | [Threat scenario] | [Impact to objective] | [Low / Medium / High] | [Low / Medium / High] |
| S-003 | [Threat scenario] | [Impact to objective] | [Low / Medium / High] | [Low / Medium / High] |

#### Control Effectiveness Assessment

| Assessment Area | Result | Comments |
|---|---|---|
| Alignment to Customized Approach Objective | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Design Adequacy | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Implementation Completeness | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Operating Effectiveness | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Monitoring and Alerting | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Exception Handling | [Effective / Partially Effective / Ineffective] | [Rationale] |
| Evidence Availability | [Sufficient / Partial / Insufficient] | [Rationale] |

#### Evidence Reviewed

| Evidence ID | Evidence Description | Source | Period Covered | Result |
|---|---|---|---|---|
| E-001 | [Evidence description] | [Source] | [Date / Period] | [Accepted / Gap Identified] |
| E-002 | [Evidence description] | [Source] | [Date / Period] | [Accepted / Gap Identified] |
| E-003 | [Evidence description] | [Source] | [Date / Period] | [Accepted / Gap Identified] |

#### Residual Risk Determination

| Risk Element | Rating | Rationale |
|---|---|---|
| Residual Likelihood | [Low / Medium / High] | [Rationale] |
| Residual Impact | [Low / Medium / High] | [Rationale] |
| Overall Residual Risk | [Low / Medium / High] | [Overall conclusion] |
| Risk Acceptance Required | [Yes / No] | [Reason] |

#### Finding

**Finding:** [Meets Objective / Meets Objective with Actions / Does Not Yet Meet Objective]

[Provide finding narrative.]

#### Required Actions

| Action ID | Required Action | Owner | Due Date | Priority | Status |
|---|---|---|---|---|---|
| A-001 | [Action required] | [Owner] | [Due Date] | [High / Medium / Low] | [Open / In Progress / Complete] |
| A-002 | [Action required] | [Owner] | [Due Date] | [High / Medium / Low] | [Open / In Progress / Complete] |

#### Approval

| Approval Role | Name / Title | Decision | Date |
|---|---|---|---|
| Control Owner | [Name / Title] | [Approved / Conditionally Approved / Not Approved] | [Date] |
| Risk & Compliance Owner | [Name / Title] | [Approved / Conditionally Approved / Not Approved] | [Date] |
| Senior Risk Approver, if required | [Name / Title] | [Approved / Conditionally Approved / Not Approved] | [Date] |

## Analysis

### Alignment with PCI DSS v4.0.1 Requirement 12.3.2

The TRA process applied in this report is aligned to PCI DSS v4.0.1 Requirement 12.3.2 because it is:

- **Requirement-specific:** Each TRA is performed against an individual PCI DSS requirement implemented using the Customized Approach.
- **Objective-based:** Each analysis evaluates the control against the PCI DSS Customized Approach Objective, not merely against internal policy preference.
- **Risk-based:** Threat scenarios, likelihood, impact, control strength, and residual risk are documented for each customized control.
- **Evidence-driven:** Conclusions are supported by control design and operating evidence.
- **Governed:** Results require control owner and risk owner approval, with senior management involvement where residual risk is material.
- **Repeatable:** The methodology supports annual review and reassessment upon significant change.

### Common Themes Identified

| Theme | Observation | PCI DSS Relevance | Risk Implication |
|---|---|---|---|
| Objective Traceability | Customized controls must maintain explicit traceability to the PCI DSS Customized Approach Objective. | Supports assessor validation that the security outcome is met. | Weak traceability may result in assessor rejection of the customized approach. |
| Evidence Sufficiency | Some customized controls require stronger operating evidence over the assessment period. | PCI DSS validation requires evidence that controls are implemented and operating effectively. | Insufficient evidence may result in inability to demonstrate compliance. |
| Change Management Dependency | Customized controls may rely on specific configurations, automation, or architecture assumptions. | Significant changes can invalidate prior TRA conclusions. | Changes without TRA review may introduce unassessed CDE exposure. |
| Monitoring and Alerting | Detective controls are critical where the customized design differs materially from the Defined Approach. | Monitoring supports timely identification of control failure. | Weak monitoring can increase residual likelihood of control bypass. |
| Ownership and Accountability | Each customized control requires named ownership and approval. | PCI DSS Requirement 12 emphasizes governance and assigned responsibilities. | Unclear ownership may lead to inconsistent operation or delayed remediation. |

### Residual Risk Profile

| Residual Risk Level | Number of Controls | Management Attention Required |
|---|---:|---|
| Low | [Number] | Continue operation and monitoring; review at least annually. |
| Medium | [Number] | Complete improvement actions; management acceptance required where applicable. |
| High | [Number] | Do not rely on the customized control for PCI DSS validation until remediated or formally risk accepted with assessor agreement where appropriate. |

### Evidence Sufficiency Analysis

| Evidence Rating | Count | Interpretation |
|---|---:|---|
| Sufficient | [Number] | Evidence supports control design and operating effectiveness for the reviewed period. |
| Partial | [Number] | Evidence supports some aspects of the control but requires enhancement, additional sampling, or longer operating history. |
| Insufficient | [Number] | Evidence does not currently support reliance on the customized control. |

### Conditions Requiring TRA Reassessment

A TRA must be updated or re-performed when any of the following occur:

| Trigger | Examples |
|---|---|
| Significant CDE Change | New payment application, network redesign, cloud migration, segmentation change, new processor connection. |
| Customized Control Change | Change in control logic, tooling, automation, enforcement point, review frequency, or approval workflow. |
| Threat Environment Change | New attack technique, active exploitation relevant to the control, major vulnerability affecting the control technology. |
| Control Failure | Incident, monitoring failure, exception trend, audit finding, or inability to produce required evidence. |
| Business Process Change | New payment channel, outsourcing arrangement, new service provider responsibility, change in operational workflow. |
| Annual Review Cycle | Scheduled periodic review required to maintain PCI DSS governance and evidence currency. |

## Recommendations & Actions

### Recommendations

1. **Maintain one approved TRA record for each customized-approach PCI DSS requirement.** 
 Each record should include requirement mapping, customized objective, control description, threat scenarios, evidence, residual risk, and approval.

2. **Strengthen evidence retention for customized controls.** 
 Evidence should be retained in a central repository and include both design evidence and operating evidence covering the assessment period.

3. **Integrate TRA review into change management.** 
 Change requests affecting CDE architecture, control enforcement, security tools, payment flows, or third-party dependencies should include a PCI DSS Customized Approach impact assessment.

4. **Require control owner attestation before PCI DSS assessment.** 
 Each control owner should confirm that the customized control remains implemented, effective, monitored, and supported by evidence.

5. **Track remediation actions to closure.** 
 Any action marked as required in this report must be tracked through the risk, compliance, or issue management process until independently verified as complete.

6. **Engage QSA/ISA early for customized approach validation.** 
 Customized Approach controls should be reviewed with the assessor before final assessment testing to reduce the risk of late-stage rejection or evidence gaps.

7. **Define acceptable residual risk thresholds.** 
 Medium or high residual risks should require documented management acceptance, with high-risk items escalated to the appropriate governance body.

### Consolidated Action Plan

| Action ID | Related TRA ID | Action Description | Owner | Target Date | Priority | Success Criteria | Status |
|---|---|---|---|---|---|---|---|
| CAP-001 | TRA-CA-001 | [Action description] | [Owner] | [Target Date] | [High / Medium / Low] | [Measurable completion criteria] | [Open / In Progress / Complete] |
| CAP-002 | TRA-CA-002 | [Action description] | [Owner] | [Target Date] | [High / Medium / Low] | [Measurable completion criteria] | [Open / In Progress / Complete] |
| CAP-003 | TRA-CA-003 | [Action description] | [Owner] | [Target Date] | [High / Medium / Low] | [Measurable completion criteria] | [Open / In Progress / Complete] |
| CAP-004 | All | Establish centralized evidence repository for Customized Approach TRA records. | [Risk & Compliance Owner] | [Target Date] | Medium | Repository contains approved TRA, evidence index, approval records, and review schedule. | [Open / In Progress / Complete] |
| CAP-005 | All | Add TRA reassessment trigger to CDE change management workflow. | [Change Management Owner] | [Target Date] | Medium | Change template includes PCI DSS Customized Approach impact question and approval routing. | [Open / In Progress / Complete] |

### Management Acceptance Criteria

A customized control may be accepted for PCI DSS assessment reliance only when all of the following criteria are met:

| Criterion | Required Condition |
|---|---|
| Requirement Mapping | PCI DSS requirement and Customized Approach Objective are clearly identified. |
| Control Design | Customized control is documented in sufficient detail for assessor understanding and testing. |
| Risk Analysis | Threat scenarios, likelihood, impact, and residual risk are documented. |
| Evidence | Evidence demonstrates implementation and operating effectiveness. |
| Ownership | Control owner and risk owner are assigned and have approved the TRA. |
| Residual Risk | Residual risk is low or formally accepted by authorized management. |
| Monitoring | Ongoing monitoring or review is defined and operating. |
| Review Cycle | Annual and significant-change review requirements are defined. |
| Assessor Readiness | Evidence package is prepared for QSA/ISA review. |

### Required Approvals

| Approval Area | Approver | Approval Requirement |
|---|---|---|
| TRA Methodology | [Risk & Compliance Owner] | Confirms methodology satisfies PCI DSS v4.0.1 Requirement 12.3.2. |
| Individual Customized Control | [Control Owner] | Confirms control description, operation, and evidence are accurate. |
| Residual Risk Acceptance | [Senior Risk Owner / Risk Committee] | Required for medium or high residual risk, or where required by internal risk policy. |
| PCI DSS Assessment Use | [PCI DSS Program Owner] | Confirms TRA package may be provided to QSA/ISA. |
| External Validation | [QSA / ISA] | Reviews customized control and supporting TRA during assessment activities. |

## Distribution & Confidentiality

### Distribution

This report is distributed on a need-to-know basis to personnel responsible for PCI DSS governance, risk management, control operation, assessment readiness, and executive oversight.

| Recipient / Group | Purpose |
|---|---|
| [PCI DSS Program Owner] | Overall PCI DSS compliance oversight and assessment readiness. |
| [Risk & Compliance Team] | TRA management, documentation, issue tracking, and evidence coordination. |
| [Information Security Leadership] | Review of control design, residual risk, and remediation priorities. |
| [Control Owners] | Validation of control operation and completion of required actions. |
| [Internal Audit, if applicable] | Independent review and assurance planning. |
| [Executive Risk Committee, if applicable] | Approval of material residual risk and remediation funding. |
| [QSA / ISA] | PCI DSS Customized Approach validation and assessment testing. |

### Confidentiality Requirements

This report is classified as **Confidential** because it contains sensitive information regarding:

- PCI DSS control design and implementation.
- CDE systems, processes, and security dependencies.
- Identified control gaps, residual risks, and remediation actions.
- Evidence sources and operational security details.
- Information that could assist an attacker in bypassing or weakening payment security controls.

Recipients must:

- Store this report only in approved repositories.
- Not distribute the report outside authorized recipients without approval from [Risk & Compliance Owner].
- Protect extracted content, evidence attachments, and working papers at the same classification level.
- Ensure external sharing with assessors, service providers, or regulators is performed through approved secure channels.
- Retain the report and supporting evidence in accordance with [Organisation Name]’s PCI DSS evidence retention and records management requirements.

### Record Retention

| Record Type | Minimum Retention |
|---|---|
| Approved TRA Report | [Retention Period] |
| Supporting Evidence | [Retention Period] |
| Approval Records | [Retention Period] |
| Remediation Tracking Records | [Retention Period] |
| Prior Versions / Superseded TRA Records | [Retention Period] |

### Document Review

| Review Event | Requirement |
|---|---|
| Annual Review | Required at least once every 12 months. |
| Significant Change | Required when customized control design, CDE scope, technology, process, or threat profile changes materially. |
| Control Failure | Required after a material control failure, incident, audit finding, or evidence deficiency. |
| PCI DSS Assessment Preparation | Required before providing the TRA package to the QSA/ISA for assessment reliance. |