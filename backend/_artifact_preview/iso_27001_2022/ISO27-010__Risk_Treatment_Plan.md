<!-- iso_27001_2022 / ISO27-010 | type=Plan | mode=table | model=gpt-5.5 | 8373 chars -->

## Risk Treatment Plan (XLSX/DOCX template)

_Editable template — add your own rows. The example row(s) below are placeholders to replace._

| Treatment Plan ID | Linked Risk ID | Risk Description | Risk Owner | Treatment Option | Treatment Objective | Selected Control Reference(s) | Selected Control Description | Statement of Applicability Reference | Treatment Action(s) | Action Owner | Supporting Teams / Stakeholders | Resources / Budget Required | Target Start Date | Target Completion Date | Priority | Implementation Status | Progress / Current Position | Evidence Required | Evidence Location / Link | Residual Risk Rating Target | Residual Risk Rating After Treatment | Residual Risk Acceptance Required | Residual Risk Acceptance Owner | Approval Status | Approved By | Approval Date | Review Date | Dependencies / Constraints | Comments / Decisions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [EXAMPLE: RTP-001] | [EXAMPLE: RISK-014] | [EXAMPLE: Unauthorised access to customer data due to excessive privileged accounts] | [EXAMPLE: Head of IT Operations] | [EXAMPLE: Modify] | [EXAMPLE: Reduce likelihood of unauthorised privileged access] | [EXAMPLE: A.5.15, A.5.18, A.8.2] | [EXAMPLE: Implement quarterly privileged access reviews and enforce named administrative accounts] | [EXAMPLE: SoA row A.5.15 / A.5.18 / A.8.2] | [EXAMPLE: Configure privileged access review workflow; remove shared admin accounts; evidence first completed review] | [EXAMPLE: IAM Manager] | [EXAMPLE: IT Operations, Information Security, Application Owners] | [EXAMPLE: Existing IAM tool; 10 person-days] | [EXAMPLE: 2026-02-01] | [EXAMPLE: 2026-04-30] | [EXAMPLE: High] | [EXAMPLE: In Progress] | [EXAMPLE: Workflow design completed; awaiting application owner validation] | [EXAMPLE: Access review report, removed account list, IAM workflow configuration export] | [EXAMPLE: GRC/RTP/RTP-001/evidence] | [EXAMPLE: Medium] | [EXAMPLE: ] | [EXAMPLE: Yes] | [EXAMPLE: Head of IT Operations] | [EXAMPLE: Approved] | [EXAMPLE: CISO] | [EXAMPLE: 2026-01-25] | [EXAMPLE: 2026-03-15] | [EXAMPLE: Requires application owner availability and IAM workflow change window] | [EXAMPLE: Management approved phased implementation for critical systems first] |
| [EXAMPLE: RTP-002] | [EXAMPLE: RISK-021] | [EXAMPLE: Malware infection due to unmanaged endpoint protection on contractor laptops] | [EXAMPLE: Director of Technology] | [EXAMPLE: Modify] | [EXAMPLE: Improve prevention and detection of malware on non-corporate endpoints] | [EXAMPLE: A.8.1, A.8.7, A.8.16] | [EXAMPLE: Require managed endpoint protection and monitoring for contractor devices accessing corporate systems] | [EXAMPLE: SoA row A.8.1 / A.8.7 / A.8.16] | [EXAMPLE: Update contractor access standard; enforce endpoint compliance check before VPN access] | [EXAMPLE: Endpoint Security Lead] | [EXAMPLE: Procurement, Legal, IT Service Desk, Network Team] | [EXAMPLE: USD 8,000 annual licence uplift] | [EXAMPLE: 2026-03-01] | [EXAMPLE: 2026-05-31] | [EXAMPLE: Medium] | [EXAMPLE: Not Started] | [EXAMPLE: Pending procurement approval] | [EXAMPLE: Updated standard, VPN compliance rule, endpoint management report] | [EXAMPLE: Ticket SEC-4567 and GRC/RTP/RTP-002/evidence] | [EXAMPLE: Low] | [EXAMPLE: ] | [EXAMPLE: Yes] | [EXAMPLE: Director of Technology] | [EXAMPLE: Submitted] | [EXAMPLE: ] | [EXAMPLE: ] | [EXAMPLE: 2026-04-15] | [EXAMPLE: Dependent on licence procurement and contractor contract variation] | [EXAMPLE: Legal to confirm contract wording before enforcement] |

### Column Guidance

| Column | What to enter |
|---|---|
| Treatment Plan ID | Enter a unique identifier for this treatment plan item, e.g. RTP-001. Use a consistent sequential format. |
| Linked Risk ID | Enter the unique risk ID from the information security risk register that this treatment addresses, e.g. RISK-014. |
| Risk Description | Briefly describe the risk being treated, consistent with the approved risk register entry. |
| Risk Owner | Enter the named role or individual accountable for the risk, as recorded in the risk register. |
| Treatment Option | Select the approved risk treatment option: Modify, Retain, Avoid, or Share. |
| Treatment Objective | State the intended outcome of the treatment, e.g. reduce likelihood, reduce impact, meet legal obligation, or improve detection capability. |
| Selected Control Reference(s) | Enter the ISO/IEC 27001:2022 Annex A control reference(s) and/or organisation-specific control ID(s) selected to treat the risk, e.g. A.5.15, A.8.12, CTRL-AC-001. |
| Selected Control Description | Briefly describe the selected control(s) or control enhancement(s) to be implemented. |
| Statement of Applicability Reference | Enter the corresponding Statement of Applicability row, section, or control reference confirming inclusion and justification of the selected control. |
| Treatment Action(s) | Describe the specific action(s) required to implement the selected treatment, using clear, auditable task language. |
| Action Owner | Enter the named person or role responsible for completing the treatment action. |
| Supporting Teams / Stakeholders | List teams, suppliers, or stakeholders required to support implementation, e.g. IT Operations, HR, Legal, MSSP. |
| Resources / Budget Required | Record required resources, tools, effort, or budget. Include currency and amount where known, e.g. USD 15,000, 20 person-days, existing resources. |
| Target Start Date | Enter the planned start date in YYYY-MM-DD format. |
| Target Completion Date | Enter the planned completion date in YYYY-MM-DD format. |
| Priority | Select the treatment priority: Critical, High, Medium, or Low, aligned to risk rating and business urgency. |
| Implementation Status | Select the current status: Not Started, In Progress, Blocked, Implemented, Deferred, Cancelled, or Overdue. |
| Progress / Current Position | Summarise current progress, milestones completed, blockers, or next steps. Update at each review. |
| Evidence Required | Describe the evidence needed to demonstrate implementation and operating effectiveness, e.g. approved policy, configuration screenshot, access review report, test results. |
| Evidence Location / Link | Enter the repository path, ticket link, GRC record link, or document reference where implementation evidence is stored. |
| Residual Risk Rating Target | Enter the intended residual risk rating after treatment using the organisation’s approved risk scale, e.g. Low, Medium, High or numeric score. |
| Residual Risk Rating After Treatment | Enter the actual reassessed residual risk rating after implementation, using the same approved risk scale. Leave blank until reassessment is complete. |
| Residual Risk Acceptance Required | Enter Yes or No to indicate whether formal acceptance of remaining residual risk is required. |
| Residual Risk Acceptance Owner | Enter the named role or individual authorised to accept residual risk, typically the risk owner or senior management delegate. |
| Approval Status | Select the approval state for the treatment plan item: Draft, Submitted, Approved, Rejected, or Superseded. |
| Approved By | Enter the name and role of the person or committee approving the treatment plan item. Leave blank until approved. |
| Approval Date | Enter the approval date in YYYY-MM-DD format. Leave blank until approved. |
| Review Date | Enter the next scheduled review date in YYYY-MM-DD format, based on treatment timetable, risk review cycle, or material change. |
| Dependencies / Constraints | Record known dependencies, prerequisites, constraints, or external factors that may affect delivery, e.g. procurement lead time, supplier change window, regulatory deadline. |
| Comments / Decisions | Record material decisions, exceptions, deferrals, management comments, or rationale relevant to the treatment plan. |

### Maintenance

The Risk Manager or ISMS Manager owns this template, with treatment action updates made at least monthly and whenever risk assessments, treatment decisions, or implementation status changes. Source data should be drawn from the approved information security risk register, Statement of Applicability, GRC tool, project/action tracking system, and evidence repository.