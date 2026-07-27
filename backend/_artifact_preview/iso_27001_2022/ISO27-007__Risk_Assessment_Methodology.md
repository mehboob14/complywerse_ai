<!-- iso_27001_2022 / ISO27-007 | type=Procedure | mode=markdown | model=gpt-5.5 | 33776 chars -->

| Document ID | Version | Owner | Effective Date | Framework | Control Reference | Classification |
|---|---:|---|---|---|---|---|
| [ISMS-PRO-RA-001] | 1.0 | [Risk Management Owner / ISMS Manager] | [YYYY-MM-DD] | ISO/IEC 27001:2022 | — Information Security Risk Assessment | Internal |

## Purpose

This procedure defines the organisation’s methodology for conducting information security risk assessments in accordance with ISO/IEC 27001:2022.

The purpose of this procedure is to ensure that information security risks are identified, analysed, evaluated, prioritised, documented, and consistently assessed using defined criteria. This procedure supports the establishment, implementation, maintenance, and continual improvement of the Information Security Management System (ISMS).

This procedure specifically defines:

- The criteria for information security risk acceptance.
- The criteria for performing information security risk assessments.
- A consistent and repeatable method for identifying information security risks.
- A consistent method for analysing likelihood and consequences.
- A defined method for determining risk levels.
- A defined method for evaluating whether risks are acceptable or require treatment.
- Requirements for producing comparable, valid, and reproducible results.
- Required records and approvals for risk assessment activities.

This procedure does not define risk treatment selection or implementation activities in detail. Risk treatment is addressed under the organisation’s risk treatment procedure aligned to ISO/IEC 27001:2022.

## Scope

This procedure applies to all information security risk assessments conducted within the scope of the organisation’s ISMS.

The procedure applies to:

- Information assets, business processes, systems, applications, infrastructure, cloud services, facilities, networks, data repositories, and third-party services included within the ISMS scope.
- Risks affecting the confidentiality, integrity, and availability of information.
- Risks arising from people, processes, technology, physical environments, suppliers, legal/regulatory obligations, and organisational changes.
- Initial, periodic, event-driven, and project-related information security risk assessments.
- Risk assessments supporting ISMS planning, operational risk management, supplier evaluation, change management, project delivery, incident response, audit findings, and management review.

This procedure shall be used when:

- Establishing the ISMS risk baseline.
- Conducting scheduled risk reassessments.
- Assessing significant changes to systems, processes, services, facilities, suppliers, or organisational structure.
- Introducing new technologies, applications, integrations, or data processing activities.
- Responding to material incidents, vulnerabilities, audit findings, threat intelligence, or regulatory changes.
- Determining whether identified information security risks are acceptable or require treatment.

Out of scope:

- Enterprise risk management activities unrelated to information security, unless they affect information assets within the ISMS scope.
- Health and safety, financial, environmental, or operational risk assessments where information security is not a risk factor.
- Detailed risk treatment planning, which is governed by the risk treatment process.

## Prerequisites & Inputs

Before conducting an information security risk assessment, the Risk Assessment Lead shall confirm that the following prerequisites and inputs are available, current, and sufficiently complete.

| Input / Prerequisite | Description | Required Source / Owner |
|---|---|---|
| ISMS Scope Statement | Defines organisational boundaries, locations, functions, systems, and interfaces included in the ISMS. | ISMS Manager |
| Information Asset Inventory | Register of information assets, systems, data sets, applications, infrastructure, and owners. | Asset Owners / IT |
| Business Process Inventory | List of key processes and their supporting information assets. | Process Owners |
| Data Classification Records | Classification of information by confidentiality, integrity, availability, privacy, and business sensitivity. | Data Owners |
| Legal, Regulatory, and Contractual Requirements | Applicable laws, regulations, standards, customer obligations, and contractual security requirements. | Legal / Compliance |
| Previous Risk Assessments | Prior assessed risks, ratings, decisions, and treatment status. | Risk Owner / ISMS Manager |
| Statement of Applicability | Applicability and status of ISO/IEC 27001:2022 Annex A controls, where available. | ISMS Manager |
| Internal and External Issues | Context affecting the ISMS, including business, technology, threat, regulatory, and supplier factors. | Senior Management / ISMS Manager |
| Interested Party Requirements | Security expectations and requirements of customers, regulators, partners, employees, and other stakeholders. | Compliance / Business Owners |
| Threat and Vulnerability Information | Vulnerability scan results, penetration test reports, threat intelligence, advisories, incidents, and audit findings. | Security Operations / IT |
| Incident and Event Records | Relevant security incidents, near misses, lessons learned, and recurring control failures. | Incident Manager |
| Supplier and Third-Party Information | Supplier services, access, dependencies, assurance reports, and contractual obligations. | Supplier Manager |
| Business Impact Information | Impact tolerances, criticality, recovery objectives, and operational dependencies. | Business Continuity Owner / Process Owners |
| Risk Register Template | Approved template or system used to record assessment results. | Risk Management Owner |

The Risk Assessment Lead shall not proceed with formal scoring where critical inputs are missing or materially unreliable. Where incomplete information cannot be resolved in time, assumptions shall be recorded in the risk register and reviewed with the relevant risk owner.

## Step-by-Step Procedure (numbered)

1. **Initiate the risk assessment**

 1.1. The ISMS Manager or Risk Management Owner shall initiate the risk assessment according to one or more of the following triggers:

 - Scheduled periodic assessment.
 - New or changed system, process, supplier, location, or technology.
 - Material change in business context, threat environment, legal obligations, or customer requirements.
 - Significant security incident or near miss.
 - Audit finding, control failure, or management review action.
 - New vulnerability, exploit, or threat intelligence relevant to the organisation.
 - Inclusion of a new asset or process within the ISMS scope.

 1.2. The Risk Assessment Lead shall define and document the assessment objective, scope, participants, assessment date, and expected outputs.

 1.3. The Risk Assessment Lead shall confirm whether the assessment is:

 | Assessment Type | Description | Typical Use |
 |---|---|---|
 | Baseline Assessment | Full risk assessment across ISMS scope. | Initial ISMS implementation or major scope revision. |
 | Periodic Assessment | Recurring reassessment of existing risks and risk environment. | Annual or scheduled ISMS cycle. |
 | Change-Driven Assessment | Focused assessment of a specific change. | New system, supplier, process, integration, or infrastructure change. |
 | Incident-Driven Assessment | Assessment arising from an incident or control failure. | Post-incident review or recurring event trend. |
 | Project Assessment | Assessment supporting a project or delivery lifecycle. | New application, migration, acquisition, or transformation project. |

2. **Confirm assessment boundaries and context**

 2.1. The Risk Assessment Lead shall confirm the boundaries of the assessment, including:

 - Business processes in scope.
 - Information assets in scope.
 - Systems and applications in scope.
 - Locations, facilities, and hosting environments in scope.
 - Internal teams and external suppliers involved.
 - Data types and classifications processed, stored, or transmitted.
 - Interfaces, dependencies, and interconnections.
 - Applicable legal, regulatory, contractual, and stakeholder requirements.

 2.2. The Risk Assessment Lead shall verify that the assessment aligns with the current ISMS scope and organisational context.

 2.3. Any exclusions from the assessment shall be documented with justification and approved by the ISMS Manager.

3. **Identify information assets and risk owners**

 3.1. The Risk Assessment Lead shall identify the assets, processes, services, and information flows subject to assessment.

 3.2. For each item assessed, an accountable risk owner shall be assigned. The risk owner shall have sufficient authority to accept or request treatment of the risk.

 3.3. Where ownership is unclear, the matter shall be escalated to the ISMS Manager and relevant senior management representative for assignment.

 3.4. At minimum, the following asset and ownership information shall be recorded:

 | Field | Requirement |
 |---|---|
 | Asset / Process Name | Clear name of the information asset, service, system, or process. |
 | Description | Brief description of business purpose and information handled. |
 | Asset Owner | Person or role accountable for the asset. |
 | Risk Owner | Person or role accountable for risk decisions. |
 | Business Criticality | Critical, High, Medium, or Low based on business impact. |
 | Information Classification | Public, Internal, Confidential, Restricted, or organisation-approved equivalent. |
 | Location / Hosting | Physical, cloud, SaaS, on-premises, or hybrid environment. |
 | Dependencies | Key upstream/downstream services, suppliers, and integrations. |

4. **Identify risks**

 4.1. The Risk Assessment Lead shall identify information security risks by considering threats, vulnerabilities, existing controls, business impacts, and relevant scenarios.

 4.2. Risks shall be expressed as risk scenarios that clearly describe:

 - A threat or source of risk.
 - A vulnerability, weakness, exposure, or circumstance that could be exploited or triggered.
 - The information asset, process, or service affected.
 - The potential impact to confidentiality, integrity, and/or availability.

 4.3. Risk statements shall be written in a clear cause-event-impact format, such as:

 > If [threat/source] exploits or triggers [vulnerability/condition], then [asset/process] may suffer [confidentiality, integrity, and/or availability impact], resulting in [business consequence].

 4.4. The Risk Assessment Lead shall consider, as applicable:

 | Risk Source | Examples to Consider |
 |---|---|
 | External Threats | Cybercriminals, nation-state actors, competitors, hacktivists, malware, phishing, ransomware. |
 | Internal Threats | Human error, privilege misuse, malicious insiders, inadequate training, segregation of duties failures. |
 | Technical Vulnerabilities | Unpatched systems, insecure configuration, weak authentication, unsupported software, poor logging. |
 | Process Weaknesses | Inadequate change control, poor access reviews, missing approvals, undocumented procedures. |
 | Physical and Environmental Threats | Fire, flood, theft, power loss, unauthorised facility access, equipment failure. |
 | Supplier Risks | Vendor outage, inadequate supplier security, subcontractor exposure, contractual non-compliance. |
 | Legal and Regulatory Risks | Privacy breaches, data residency failures, non-compliance with contractual security obligations. |
 | Business Continuity Risks | Single points of failure, inadequate backups, recovery delays, lack of tested continuity arrangements. |
 | Emerging Risks | New exploits, technology changes, geopolitical events, cloud service changes, AI-related threats. |

 4.5. Identified risks shall be recorded in the risk register, including reference to the affected asset, risk owner, existing controls, and supporting evidence.

5. **Identify existing controls**

 5.1. For each identified risk, the Risk Assessment Lead shall identify existing controls that reduce likelihood or impact.

 5.2. Existing controls may include administrative, technical, physical, contractual, preventive, detective, corrective, or compensating controls.

 5.3. The Risk Assessment Lead shall consider controls from relevant sources, including:

 - ISO/IEC 27001:2022 Annex A.
 - Internal policies and procedures.
 - Technical security configurations.
 - Monitoring and detection capabilities.
 - Supplier contractual controls.
 - Business continuity and disaster recovery arrangements.
 - Legal, regulatory, and customer-required controls.

 5.4. Controls shall be recorded as implemented, partially implemented, planned, ineffective, or not present.

 5.5. Control effectiveness shall be considered during likelihood and impact assessment. Control presence alone shall not be treated as evidence of effectiveness unless supported by operational evidence, testing, monitoring, audit results, or management attestation.

6. **Analyse consequence / impact**

 6.1. The Risk Assessment Lead, in consultation with the risk owner and relevant subject matter experts, shall assess the potential consequence if the risk materialises.

 6.2. Impact shall be assessed using the following five-point scale.

 | Score | Impact Rating | Description | Indicative Criteria |
 |---:|---|---|---|
 | 1 | Insignificant | Minimal effect on information security or business operations. | No material confidentiality, integrity, or availability impact; minor inconvenience; no customer, legal, or financial impact. |
 | 2 | Minor | Limited impact affecting a small number of users, records, or processes. | Short disruption; limited internal data exposure; minor rework; no reportable breach; low financial or reputational effect. |
 | 3 | Moderate | Noticeable business impact requiring management attention. | Material service degradation; sensitive data exposure limited in scope; missed internal targets; possible customer concern; moderate financial impact. |
 | 4 | Major | Significant impact on business operations, customers, legal obligations, or reputation. | Extended outage of important service; significant confidential data compromise; regulatory notification likely; contractual breach; high financial loss. |
 | 5 | Severe | Critical or organisation-wide impact threatening strategic objectives or legal standing. | Major breach of restricted data; prolonged outage of critical services; significant regulatory enforcement; severe reputational damage; existential or strategic impact. |

 6.3. Where impact differs across confidentiality, integrity, and availability, the highest relevant impact score shall be used for the overall risk rating.

 6.4. The rationale for the selected impact score shall be documented.

7. **Analyse likelihood**

 7.1. The Risk Assessment Lead shall assess the likelihood of the risk scenario occurring, considering threats, vulnerabilities, exposure, existing controls, historical events, and known threat activity.

 7.2. Likelihood shall be assessed using the following five-point scale.

 | Score | Likelihood Rating | Description | Indicative Criteria |
 |---:|---|---|---|
 | 1 | Rare | May occur only in exceptional circumstances. | No known incidents; low exposure; strong, tested controls; threat capability or motivation is low. |
 | 2 | Unlikely | Could occur, but is not expected under normal conditions. | Few known examples; limited exposure; controls generally effective; exploitation requires unusual conditions. |
 | 3 | Possible | Might occur at some time. | Known vulnerabilities or threat activity exist; controls partially effective; similar incidents have occurred internally or externally. |
 | 4 | Likely | Will probably occur in many circumstances. | Repeated attempts or events; significant exposure; control gaps exist; exploitation is practical or common. |
 | 5 | Almost Certain | Expected to occur frequently or imminently. | Active exploitation, recurring incidents, severe unmitigated vulnerability, or absence of key controls. |

 7.3. The rationale for the selected likelihood score shall be documented.

 7.4. Where reliable quantitative data exists, it may be used to support likelihood scoring; however, the final likelihood score shall remain mapped to this methodology to maintain comparability.

8. **Determine inherent risk rating**

 8.1. Inherent risk shall be assessed before considering the effect of existing controls, where practical and useful for decision-making.

 8.2. Inherent risk shall be calculated as:

 > Inherent Risk Score = Inherent Likelihood × Inherent Impact

 8.3. The inherent risk rating shall be determined using the risk matrix below.

9. **Determine residual risk rating**

 9.1. Residual risk shall be assessed after considering the design and operating effectiveness of existing controls.

 9.2. Residual risk shall be calculated as:

 > Residual Risk Score = Residual Likelihood × Residual Impact

 9.3. The residual risk rating shall be determined using the following matrix.

 | Impact ↓ / Likelihood → | 1 Rare | 2 Unlikely | 3 Possible | 4 Likely | 5 Almost Certain |
 |---|---:|---:|---:|---:|---:|
 | 5 Severe | 5 Medium | 10 High | 15 High | 20 Critical | 25 Critical |
 | 4 Major | 4 Low | 8 Medium | 12 High | 16 High | 20 Critical |
 | 3 Moderate | 3 Low | 6 Medium | 9 Medium | 12 High | 15 High |
 | 2 Minor | 2 Low | 4 Low | 6 Medium | 8 Medium | 10 High |
 | 1 Insignificant | 1 Low | 2 Low | 3 Low | 4 Low | 5 Medium |

 9.4. Risk score ranges shall be classified as follows.

 | Score Range | Risk Rating | Meaning |
 |---:|---|---|
 | 1–4 | Low | Risk is generally acceptable but shall be monitored. |
 | 5–9 | Medium | Risk may be acceptable with risk owner approval and monitoring, or may require treatment. |
 | 10–16 | High | Risk normally requires treatment and management oversight. |
 | 17–25 | Critical | Risk requires urgent treatment planning and senior management attention. |

 9.5. The Risk Assessment Lead shall ensure that likelihood, impact, score, rating, and rationale are documented for each risk.

10. **Evaluate risks against acceptance criteria**

 10.1. The risk owner shall evaluate each residual risk against the organisation’s risk acceptance criteria.

 10.2. Risk acceptance criteria shall be applied as follows.

 | Residual Risk Rating | Acceptance Criteria | Required Decision Authority |
 |---|---|---|
 | Low | Acceptable if within normal operating conditions and no legal, regulatory, contractual, or policy breach exists. | Risk Owner |
 | Medium | May be accepted where treatment is not proportionate or additional controls are planned through normal improvement activities. Rationale required. | Risk Owner with ISMS Manager review |
 | High | Not normally acceptable without a documented risk treatment plan. Temporary acceptance requires business justification, target treatment date, and senior management approval. | Senior Management / Risk Committee |
 | Critical | Not acceptable for ongoing operation unless formally authorised as an emergency exception. Immediate action and executive escalation required. | Executive Management / [Risk Committee] |

 10.3. A risk shall not be accepted solely because treatment is inconvenient, unfunded, or assigned to a third party.

 10.4. A risk shall not be accepted where acceptance would knowingly breach applicable legal, regulatory, contractual, or mandatory policy requirements, unless formally approved by authorised executive management after legal review.

 10.5. The risk owner shall select one of the following risk decisions:

 | Risk Decision | Description |
 |---|---|
 | Treat | Modify the risk by implementing or improving controls. |
 | Accept | Retain the risk because it meets acceptance criteria or is justified and approved. |
 | Avoid | Stop or change the activity giving rise to the risk. |
 | Transfer / Share | Transfer or share part of the risk through insurance, contract, outsourcing, or other mechanism. |

 10.6. Risks requiring treatment shall be transferred to the risk treatment process under ISO/IEC 27001:2022.

11. **Validate consistency and reproducibility**

 11.1. The ISMS Manager shall review risk assessment results to confirm that:

 - The methodology has been applied consistently.
 - Ratings are reasonable and supported by documented rationale.
 - Similar risks have been scored comparably.
 - Assumptions, exclusions, and evidence gaps are documented.
 - Risk owners and decision authorities are correctly assigned.
 - Risks requiring treatment are clearly identified.
 - Acceptance decisions meet defined criteria.

 11.2. Where inconsistencies are identified, the Risk Assessment Lead shall revisit the assessment with relevant stakeholders and update the risk register.

 11.3. The ISMS Manager shall ensure the methodology produces valid, comparable, and reproducible results, as required by ISO/IEC 27001:2022.

12. **Record and approve results**

 12.1. The Risk Assessment Lead shall record all assessed risks in the approved risk register or risk management system.

 12.2. Each risk record shall include, at minimum:

 - Unique risk ID.
 - Assessment date.
 - Risk statement.
 - Asset, process, or service affected.
 - Risk owner.
 - Relevant threat/source.
 - Relevant vulnerability/condition.
 - Potential impact to confidentiality, integrity, and/or availability.
 - Existing controls.
 - Inherent likelihood, impact, score, and rating.
 - Residual likelihood, impact, score, and rating.
 - Risk decision.
 - Acceptance rationale or treatment requirement.
 - Approval authority and approval date.
 - Review date.
 - Links to supporting evidence.

 12.3. The risk owner shall approve the accuracy of the risk description, rating, and decision.

 12.4. The ISMS Manager shall approve that the assessment methodology has been followed.

 12.5. High and Critical risks shall be reported to senior management or the [Risk Committee] according to the escalation requirements in this procedure.

13. **Communicate assessment outcomes**

 13.1. The ISMS Manager shall communicate relevant risk assessment outcomes to appropriate stakeholders.

 13.2. Communication shall be proportionate to the risk level and may include:

 - Risk owners and control owners.
 - Process and asset owners.
 - Project managers.
 - IT and security operations teams.
 - Supplier managers.
 - Legal, compliance, privacy, or business continuity stakeholders.
 - Senior management and [Risk Committee].

 13.3. Risk information shall be shared according to its classification and need-to-know requirements.

14. **Trigger risk treatment where required**

 14.1. For risks requiring treatment, the Risk Assessment Lead shall ensure that the risk is transferred to the risk treatment process.

 14.2. The risk owner shall ensure that treatment actions are defined, assigned, prioritised, and tracked.

 14.3. The Risk Assessment Lead shall ensure that treatment requirements remain linked to the originating risk record.

 14.4. The Statement of Applicability shall be updated where risk assessment results affect the applicability, implementation status, or justification of Annex A controls.

15. **Schedule reassessment**

 15.1. Each risk shall be assigned a review date based on its residual risk rating and business context.

 | Residual Risk Rating | Minimum Review Frequency |
 |---|---|
 | Critical | Monthly until reduced or formally accepted by executive management |
 | High | Quarterly |
 | Medium | At least every 6 months |
 | Low | At least annually |

 15.2. Risks shall also be reassessed when there is a material change affecting likelihood, impact, controls, legal obligations, or business context.

 15.3. The ISMS Manager shall maintain oversight of reassessment schedules and overdue reviews.

## Roles & RACI

| Activity | Executive Management | ISMS Manager | Risk Assessment Lead | Risk Owner | Asset / Process Owner | Control Owner | Security / IT SME | Legal / Compliance |
|---|---|---|---|---|---|---|---|---|
| Approve risk assessment methodology | A | R | C | C | C | C | C | C |
| Initiate risk assessment | C | A/R | R | C | C | C | C | C |
| Define assessment scope and context | C | A | R | C | R | C | C | C |
| Identify assets and business processes | I | C | R | C | A/R | C | C | C |
| Assign risk owners | C | A/R | R | C | C | I | I | C |
| Identify risk scenarios | I | C | R | A/R | R | C | C | C |
| Identify existing controls | I | C | R | C | C | A/R | R | C |
| Assess likelihood and impact | I | C | R | A/R | C | C | C | C |
| Determine inherent and residual risk ratings | I | A | R | R | C | C | C | C |
| Evaluate risk against acceptance criteria | C | C | C | A/R | C | C | C | C |
| Approve Low risk acceptance | I | I | C | A/R | C | I | I | I |
| Approve Medium risk acceptance | I | A/R | C | R | C | I | I | C |
| Approve High temporary acceptance | A/R | C | C | R | C | C | C | C |
| Approve Critical exception acceptance | A/R | C | C | R | C | C | C | C |
| Validate consistency of methodology application | I | A/R | R | C | C | C | C | C |
| Maintain risk register | I | A | R | C | C | C | C | I |
| Report High and Critical risks | A | R | C | C | I | I | C | C |
| Trigger risk treatment process | I | A | R | R | C | C | C | C |
| Review methodology effectiveness | C | A/R | R | C | C | C | C | C |

RACI key:

- **R** = Responsible for performing the activity.
- **A** = Accountable for the outcome and final decision.
- **C** = Consulted before or during the activity.
- **I** = Informed of the outcome.

## Records & Outputs

The following records shall be created and retained as evidence of implementation of this procedure.

| Record / Output | Description | Owner | Minimum Retention |
|---|---|---|---|
| Risk Assessment Plan / Scope | Defines assessment objective, boundary, participants, timing, and trigger. | Risk Assessment Lead | [Retention Period] |
| Risk Register | Authoritative record of identified, analysed, evaluated, accepted, and treatment-required risks. | ISMS Manager | [Retention Period] |
| Risk Scoring Rationale | Evidence and reasoning supporting likelihood, impact, and rating decisions. | Risk Assessment Lead | [Retention Period] |
| Asset and Process Mapping | Record of assets, processes, owners, classifications, and dependencies assessed. | Asset / Process Owners | [Retention Period] |
| Existing Control Assessment | Record of relevant controls and their implementation/effectiveness status. | Control Owners | [Retention Period] |
| Risk Acceptance Records | Documented acceptance decisions, rationale, approval authority, and review date. | Risk Owner | [Retention Period] |
| Risk Escalation Records | Evidence of escalation for High and Critical risks. | ISMS Manager | [Retention Period] |
| Risk Treatment Handover | Linkage between assessed risks and risk treatment actions. | Risk Assessment Lead | [Retention Period] |
| Updated Statement of Applicability Inputs | Changes affecting Annex A control applicability or implementation status. | ISMS Manager | [Retention Period] |
| Management Reporting | Reports or dashboards showing risk profile, trends, and escalated risks. | ISMS Manager | [Retention Period] |
| Review and Approval Evidence | Sign-off records confirming risk owner and ISMS Manager approval. | ISMS Manager | [Retention Period] |

Risk register entries shall include the following minimum data fields.

| Field | Required | Description |
|---|---|---|
| Risk ID | Yes | Unique identifier for traceability. |
| Assessment Date | Yes | Date the risk was assessed or reassessed. |
| Assessment Type | Yes | Baseline, periodic, change-driven, incident-driven, or project assessment. |
| Risk Statement | Yes | Cause-event-impact description of the risk. |
| Asset / Process / Service | Yes | Item affected by the risk. |
| Asset Owner | Yes | Owner of the affected asset or process. |
| Risk Owner | Yes | Accountable person or role for risk decision. |
| CIA Impact Area | Yes | Confidentiality, integrity, availability, or combination. |
| Threat / Source | Yes | Threat actor, event, condition, or source of risk. |
| Vulnerability / Condition | Yes | Weakness, exposure, dependency, or failure condition. |
| Existing Controls | Yes | Controls currently in place. |
| Control Effectiveness | Yes | Implemented, partially implemented, ineffective, planned, or not present. |
| Inherent Likelihood | Yes | Score from 1 to 5. |
| Inherent Impact | Yes | Score from 1 to 5. |
| Inherent Score / Rating | Yes | Calculated score and rating. |
| Residual Likelihood | Yes | Score from 1 to 5. |
| Residual Impact | Yes | Score from 1 to 5. |
| Residual Score / Rating | Yes | Calculated score and rating. |
| Risk Decision | Yes | Treat, accept, avoid, or transfer/share. |
| Acceptance Rationale | Conditional | Required where risk is accepted. |
| Treatment Reference | Conditional | Required where risk is treated. |
| Approval Authority | Yes | Person or body approving the risk decision. |
| Approval Date | Yes | Date of approval. |
| Next Review Date | Yes | Scheduled reassessment date. |
| Supporting Evidence | Yes | Links to reports, tickets, assessments, scans, or other evidence. |
| Status | Yes | Open, under treatment, accepted, closed, superseded, or under review. |

## Exceptions & Escalation

Exceptions to this procedure are permitted only where justified, documented, risk-assessed, and approved by the appropriate authority.

Examples of exceptions include:

- Use of an alternative risk assessment method for a specific regulatory, customer, or project requirement.
- Temporary inability to complete full scoring due to unavailable evidence.
- Emergency operation of a service with an unassessed or partially assessed risk.
- Temporary acceptance of a High or Critical risk pending treatment.
- Deviation from minimum risk review frequency.

Exception requests shall include:

| Exception Field | Requirement |
|---|---|
| Exception ID | Unique reference number. |
| Requestor | Person or role requesting the exception. |
| Description | Clear description of the requested deviation. |
| Business Justification | Reason the standard procedure cannot be followed. |
| Affected Assets / Processes | Systems, services, processes, or data affected. |
| Related Risks | Risk IDs or risk scenarios affected. |
| Compensating Controls | Controls used to reduce risk during the exception period. |
| Residual Risk Rating | Current residual risk rating under this methodology. |
| Requested Duration | Start and end date; open-ended exceptions are not permitted. |
| Approval Authority | Required approver based on residual risk level. |
| Review Date | Date for reassessment before expiry. |

Escalation shall be performed as follows.

| Condition | Escalation Requirement | Timeframe |
|---|---|---|
| Critical residual risk identified | Escalate to Executive Management and [Risk Committee]. | Within 1 business day |
| High residual risk identified | Escalate to senior management or [Risk Committee]. | Within 5 business days |
| Risk owner not assigned | Escalate to ISMS Manager and relevant business executive. | Within 5 business days |
| Risk acceptance exceeds authority | Escalate to the appropriate approval authority. | Before acceptance |
| Risk indicates potential legal, regulatory, or contractual breach | Escalate to Legal / Compliance and ISMS Manager. | Within 2 business days |
| Risk assessment reveals active exploitation or incident | Escalate under the incident management procedure. | Immediately |
| Risk treatment overdue for High or Critical risk | Escalate to ISMS Manager and senior management. | Within 5 business days of overdue status |
| Dispute over rating or acceptance decision | Escalate to ISMS Manager; unresolved disputes go to [Risk Committee]. | Within 10 business days |

Critical risks shall not remain untreated or unapproved beyond the agreed emergency timeframe. If treatment cannot be completed by the agreed date, executive management shall review and approve the next decision, which may include service suspension, additional compensating controls, risk avoidance, or formal time-bound acceptance.

## Review

This procedure shall be reviewed at least annually and whenever any of the following occur:

- Significant change to the ISMS scope.
- Material change to the organisation’s business, technology, regulatory, or threat context.
- Significant security incident or recurring control failure.
- Internal audit, external audit, certification audit, or management review finding indicating the methodology is ineffective.
- Material change to ISO/IEC 27001, applicable legal requirements, or customer contractual obligations.
- Evidence that risk assessment results are inconsistent, not reproducible, or not useful for decision-making.
- Significant change to risk appetite or acceptance criteria.

The ISMS Manager shall coordinate the review and ensure that the following are assessed:

- Continued alignment with ISO/IEC 27001:2022.
- Suitability of likelihood, impact, and rating scales.
- Appropriateness of risk acceptance criteria.
- Consistency and comparability of prior assessments.
- Adequacy of roles, responsibilities, and approval authorities.
- Effectiveness of records and evidence produced.
- Integration with risk treatment, Statement of Applicability, management review, internal audit, and continual improvement processes.

Changes to this procedure shall be approved by the procedure owner and communicated to affected stakeholders before implementation. Where scoring criteria or risk acceptance thresholds materially change, existing risks shall be reviewed to determine whether reassessment is required.