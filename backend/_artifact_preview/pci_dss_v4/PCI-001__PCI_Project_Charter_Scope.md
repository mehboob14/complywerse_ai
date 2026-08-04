<!-- pci_dss_v4 / PCI-001 | type=Plan | mode=markdown | model=gpt-5.5 | 41360 chars -->

| Metadata | Value |
|---|---|
| Document ID | PCI-PLAN-001 |
| Version | 1.0 |
| Owner | PCI Compliance Manager |
| Effective Date | [Effective Date] |
| Framework | PCI DSS v4.0.1 |
| Classification | Internal |

## Purpose & Objectives

This PCI Project Charter & Scope Plan establishes the authorised business justification, compliance scope, governance approach, and implementation plan for the organisation’s PCI DSS v4.0.1 compliance programme.

The purpose of this plan is to support PCI DSS Requirement 12.5.1 by ensuring that the organisation maintains a documented, current, and business-aligned understanding of its PCI DSS scope and related compliance responsibilities. This includes confirming the applicable merchant level, Self-Assessment Questionnaire type or assessment method, cardholder data environment boundaries, payment channels, in-scope people, processes, technologies, and third-party service provider dependencies.

This document serves as the formal charter for the PCI DSS v4.0.1 compliance project and provides the basis for planning, resourcing, executing, validating, and maintaining compliance activities.

The objectives of this plan are to:

1. Define the business justification for PCI DSS compliance based on the organisation’s acceptance, processing, storage, or transmission of account data.
2. Confirm the applicable PCI DSS assessment approach, including merchant level and SAQ type or Report on Compliance pathway.
3. Establish the scope of the Cardholder Data Environment, including systems, networks, applications, processes, facilities, people, and third-party service providers that may impact cardholder data security.
4. Support executive sponsorship and organisational accountability for PCI DSS v4.0.1 implementation and ongoing compliance.
5. Identify key assumptions, dependencies, resources, roles, milestones, and success criteria for the PCI DSS programme.
6. Provide a baseline scope statement to support PCI DSS gap assessment, remediation planning, control implementation, evidence collection, and assessment activities.
7. Ensure scope is reviewed and updated when business, technical, payment, or third-party changes may affect PCI DSS applicability.

This plan is intended for use by executive management, the PCI Compliance Manager, Information Security, IT Operations, Application Owners, Payment Operations, Legal, Procurement, Risk Management, Internal Audit, and relevant third-party service provider relationship owners.

## Scope

The scope of this PCI DSS v4.0.1 programme includes all organisational components that store, process, or transmit account data, or that could impact the security of the Cardholder Data Environment.

For this plan, “account data” includes cardholder data and sensitive authentication data as defined by PCI DSS v4.0.1. Cardholder data includes the Primary Account Number and, where present with the PAN, any of the following: cardholder name, expiration date, or service code. Sensitive authentication data includes full track data, card verification codes/values, PINs/PIN blocks, and related authentication data, and must not be stored after authorisation unless explicitly permitted by PCI DSS.

The organisation’s PCI DSS scope is determined using the following assessment factors:

| Scope Factor | Current Determination |
|---|---|
| Organisation type | Merchant |
| Business justification | The organisation accepts payment cards as a method of payment for goods and/or services through approved payment channels. PCI DSS compliance is required to protect account data, meet acquiring bank and payment brand obligations, reduce fraud and breach risk, and maintain the ability to process card payments. |
| Merchant level | [Merchant Level] |
| Annual transaction volume basis | [Annual Transaction Volume / Source] |
| Assessment method | [SAQ Type / ROC] |
| Acquiring bank or payment processor | [Acquirer / Processor Name] |
| Payment brands accepted | [Visa / Mastercard / American Express / Discover / JCB / Other] |
| PCI DSS version | PCI DSS v4.0.1 |
| Compliance validation period | [Assessment Year / Period] |
| Executive sponsor | [Executive Sponsor Name / Role] |
| Target validation date | [Target Validation Date] |

The PCI DSS scope includes, at minimum, the following payment channels and business processes:

| Payment Channel / Process | In Scope? | Description | PCI DSS Relevance |
|---|---:|---|---|
| E-commerce payments | [Yes/No] | Online payment acceptance through [website/platform] using [payment integration model] | May involve redirect, iframe, hosted payment page, API integration, JavaScript payment page scripts, or other mechanisms that can affect account data security. |
| Card-present retail payments | [Yes/No] | Face-to-face payments through payment terminals at [locations] | Includes payment terminals, point-of-sale connectivity, store networks, supporting applications, and terminal management processes. |
| Mail order / telephone order payments | [Yes/No] | Payments accepted through call centre, email, forms, or back-office processing | Includes personnel, call recording, CRM systems, payment entry portals, and procedures for handling account data. |
| Recurring / subscription billing | [Yes/No] | Stored token or recurring billing arrangements managed through [provider/system] | Includes token management, billing processes, and service provider dependencies. |
| Refunds and chargebacks | [Yes/No] | Handling of refunds, reversals, and disputes | Includes access to payment platforms, truncated PAN visibility, and operational workflows. |
| Settlement and reconciliation | [Yes/No] | Batch settlement, financial reconciliation, and reporting | Includes finance systems, reports, access controls, and data retention practices. |

The current scope includes the following categories of in-scope components:

| Scope Category | Included Components |
|---|---|
| Cardholder Data Environment | Systems, networks, applications, databases, endpoints, payment devices, and processes that store, process, or transmit account data. |
| Connected-to systems | Systems and network segments connected to or with direct access into the Cardholder Data Environment. |
| Security-impacting systems | Systems that can affect the security of the Cardholder Data Environment, including identity platforms, logging, vulnerability management, endpoint protection, configuration management, backup, monitoring, and administrative access systems. |
| Payment applications and integrations | Applications, payment pages, scripts, APIs, hosted payment integrations, payment gateways, point-of-sale applications, and middleware involved in payment acceptance. |
| People and roles | Employees, contractors, administrators, support staff, developers, finance users, payment operations staff, and third-party personnel with responsibilities affecting account data security. |
| Facilities | Locations where payment acceptance, support, administration, storage, or access to in-scope systems or account data occurs. |
| Service providers | Third parties that store, process, transmit, or could impact the security of account data on behalf of the organisation. |

The following are currently identified as in-scope systems and environments, subject to confirmation during scoping validation:

| System / Service | Type | Environment | PCI DSS Scope Rationale | Owner |
|---|---|---|---|---|
| [Payment Website / Application] | Application | Production | Used to initiate or facilitate payment transactions. | [Owner] |
| [Payment Gateway] | Third-party service | Production | Processes or transmits payment card transactions on behalf of the organisation. | [Owner] |
| [E-commerce Platform] | Application / SaaS | Production | Hosts payment journey or payment-related scripts and integrations. | [Owner] |
| [POS Terminals] | Payment devices | Production | Capture card-present payment data. | [Owner] |
| [Store / Branch Network] | Network | Production | Supports payment terminal connectivity. | [Owner] |
| [Call Centre Platform] | Application / SaaS | Production | May support telephone payment workflows or payment entry. | [Owner] |
| [Identity Provider] | Security-impacting system | Production | Provides authentication or administrative access to in-scope systems. | [Owner] |
| [Logging / SIEM Platform] | Security-impacting system | Production | Collects security logs from in-scope systems. | [Owner] |
| [Vulnerability Scanner] | Security-impacting system | Production | Performs vulnerability scanning of in-scope assets. | [Owner] |
| [Change Management Platform] | Governance system | Production | Supports approval and tracking of changes affecting PCI DSS scope. | [Owner] |

The following data-handling principles apply to the PCI DSS scope:

1. The organisation will not store sensitive authentication data after authorisation.
2. Storage of PAN will be avoided unless there is a documented business need approved by the PCI Compliance Manager and Information Security.
3. Where PAN is stored, displayed, or transmitted, PCI DSS requirements for protection, masking, rendering unreadable, and secure transmission will apply.
4. Tokenisation, hosted payment pages, redirect methods, and validated third-party service providers will be preferred to reduce scope where feasible.
5. Network segmentation, payment integration design, and process controls will be used to minimise systems and personnel in scope.
6. Scope reduction methods will be validated and documented; they will not be assumed effective without evidence.

The following items are considered out of scope only if validated through documented scoping analysis, network diagrams, data-flow diagrams, access reviews, and segmentation testing where applicable:

| Potentially Out-of-Scope Area | Basis for Exclusion | Validation Required |
|---|---|---|
| Corporate user network | No storage, processing, transmission, or connectivity impacting the CDE | Network segmentation evidence, firewall rules, access path review, segmentation testing where applicable. |
| General finance systems | No PAN storage or access to unmasked account data | Data discovery, report review, access review, and reconciliation workflow assessment. |
| Non-payment customer systems | No payment functionality or account data | Application review, data-flow confirmation, and integration review. |
| Development and test environments | No production account data and no connectivity affecting production CDE | Data sanitisation controls, environment separation, access review, and configuration review. |
| General office facilities | No payment acceptance or support of in-scope administration | Process walkthrough and facilities review. |

Any change to payment channels, payment processors, integrations, cardholder data storage, network connectivity, third-party providers, or administrative access paths may affect scope and must be assessed through the organisation’s change and PCI impact assessment processes.

## Assumptions & Dependencies

The following assumptions apply to this PCI DSS v4.0.1 implementation plan:

| Assumption | Impact if Invalid | Owner |
|---|---|---|
| The organisation is classified as a merchant for PCI DSS validation purposes. | Assessment approach and validation obligations may need revision. | PCI Compliance Manager |
| The merchant level and SAQ type or ROC pathway will be confirmed with the acquiring bank or payment brand requirements before formal validation. | Incorrect assessment method may result in rejected attestation. | Finance / Payment Operations |
| The organisation does not intentionally store sensitive authentication data after authorisation. | High-risk compliance gap requiring immediate remediation. | Information Security |
| Existing payment integrations can be documented through current data-flow diagrams and architecture records. | Additional discovery and workshops will be required. | IT Architecture |
| Third-party service providers will provide current PCI DSS Attestations of Compliance and responsibility matrices. | Service provider risk may delay compliance validation. | Procurement / Vendor Management |
| Required stakeholders will be available for scoping workshops, evidence collection, control implementation, and assessment interviews. | Timeline and assessment readiness may be affected. | Executive Sponsor |
| Network segmentation or scope reduction controls, where relied upon, can be technically validated. | Additional systems may be considered in scope. | Network Operations |
| No material payment channel or architecture change will occur during the validation period without PCI impact assessment. | Scope may require reassessment and evidence updates. | Change Advisory Board |

The PCI DSS programme depends on the following internal and external inputs:

| Dependency | Description | Required By | Responsible Party |
|---|---|---|---|
| Acquirer confirmation | Confirmation of merchant level, validation requirements, and required submission format. | Scope confirmation phase | Finance / Payment Operations |
| Transaction volume data | Annual transaction volumes by payment brand and channel. | Scope confirmation phase | Finance |
| Payment channel inventory | Complete list of payment acceptance methods and locations. | Scope confirmation phase | Payment Operations |
| Cardholder data-flow diagrams | Diagrams showing where account data is captured, transmitted, processed, stored, or redirected. | Scoping and assessment | IT Architecture / Application Owners |
| Network diagrams | Current diagrams showing CDE, connected systems, segmentation boundaries, wireless networks, and security controls. | Scoping and control validation | Network Operations |
| Asset inventory | Inventory of in-scope systems, applications, databases, endpoints, payment devices, and cloud services. | Control implementation | IT Operations |
| Service provider documentation | AOCs, contracts, responsibility matrices, and service descriptions for PCI-relevant third parties. | Third-party control validation | Vendor Management |
| Security control evidence | Evidence for access control, logging, vulnerability management, secure configuration, change management, incident response, and policy requirements. | Assessment readiness | Control Owners |
| Qualified assessor support | QSA, ISA, or internal PCI subject matter expertise, depending on assessment method and risk profile. | Gap assessment and validation | PCI Compliance Manager |
| Remediation capacity | Technical and process resources to address identified gaps. | Remediation phase | Executive Sponsor / IT Leadership |

Key dependencies must be tracked through the PCI project plan. Material blockers must be escalated to the Executive Sponsor when they threaten the target validation date or create unresolved compliance risk.

## Approach / Phases

The PCI DSS v4.0.1 implementation programme will be executed through structured phases. Each phase will produce defined outputs and decision points to ensure the scope remains accurate and the selected assessment method remains appropriate.

### Phase 1: Initiation and Charter Approval

The initiation phase establishes formal sponsorship, confirms the business justification, and authorises the PCI DSS project.

Key activities:

1. Appoint the Executive Sponsor, PCI Compliance Manager, project team, and control owners.
2. Confirm the organisation’s obligation to comply with PCI DSS due to payment card acceptance.
3. Obtain current transaction volume and payment brand/acquirer requirements.
4. Confirm merchant level and expected SAQ type or ROC pathway.
5. Approve this PCI Project Charter & Scope Plan.
6. Establish governance cadence, escalation paths, and reporting expectations.

Expected outputs:

- Approved PCI Project Charter & Scope Plan.
- Confirmed project governance structure.
- Initial merchant level and assessment method determination.
- Initial stakeholder and responsibility assignment.

### Phase 2: Scope Discovery and Validation

The scope discovery phase identifies all payment channels, data flows, systems, locations, personnel, and third parties that may be in scope for PCI DSS.

Key activities:

1. Conduct payment process walkthroughs with business owners.
2. Document cardholder data flows for each payment channel.
3. Identify whether account data is stored, processed, transmitted, displayed, logged, or reported.
4. Validate whether sensitive authentication data is present in any system or process after authorisation.
5. Identify all systems connected to or security-impacting the CDE.
6. Review network segmentation and scope reduction mechanisms.
7. Identify service providers that store, process, transmit, or could impact account data security.
8. Confirm payment page and script responsibilities for e-commerce environments, where applicable.
9. Validate whether the selected SAQ type remains appropriate based on actual scope.

Expected outputs:

- Approved PCI scope statement.
- Cardholder data-flow diagrams.
- Network diagrams showing CDE and segmentation boundaries.
- In-scope asset inventory.
- Payment channel inventory.
- Third-party service provider inventory.
- Confirmed assessment method.

### Phase 3: Gap Assessment

The gap assessment phase evaluates current controls against applicable PCI DSS v4.0.1 requirements for the confirmed scope and assessment method.

Key activities:

1. Map applicable PCI DSS requirements to control owners.
2. Review current policies, standards, procedures, configurations, and technical controls.
3. Conduct interviews and evidence reviews with control owners.
4. Assess security controls for in-scope systems and service provider dependencies.
5. Validate whether compensating controls or customised approaches are being used, if applicable.
6. Document gaps, risks, owners, remediation actions, and target dates.
7. Prioritise gaps that affect cardholder data protection, scope validity, and assessment readiness.

Expected outputs:

- PCI DSS v4.0.1 gap assessment results.
- Remediation action plan.
- Updated risk register entries.
- Evidence collection plan.
- Updated project timeline if required.

### Phase 4: Remediation and Control Implementation

The remediation phase addresses identified gaps and implements or improves PCI DSS controls.

Key activities:

1. Implement technical and process remediation actions.
2. Update policies, standards, procedures, and operating records.
3. Confirm secure configurations, access controls, logging, vulnerability management, change management, and incident response capabilities.
4. Obtain and review PCI DSS AOCs and responsibility matrices from service providers.
5. Validate that any scope reduction controls remain effective after remediation.
6. Track remediation progress through governance meetings.
7. Escalate overdue or high-risk remediation items.

Expected outputs:

- Completed remediation actions.
- Updated documentation and control evidence.
- Service provider compliance evidence.
- Updated scope artefacts, where remediation affected architecture or processes.
- Residual risk decisions, where applicable.

### Phase 5: Readiness Review and Evidence Collection

The readiness phase confirms that applicable PCI DSS requirements are operating effectively and that evidence is complete and current.

Key activities:

1. Perform internal readiness review against applicable SAQ or ROC requirements.
2. Confirm evidence completeness, currency, and traceability to control requirements.
3. Validate asset inventories, data-flow diagrams, and network diagrams.
4. Verify that in-scope personnel understand their PCI DSS responsibilities.
5. Confirm that service provider documentation is current and supports reliance on outsourced controls.
6. Conduct management review of open issues, residual risks, and assessment readiness.
7. Obtain approval to proceed to formal validation.

Expected outputs:

- Assessment readiness sign-off.
- Complete evidence repository.
- Updated control owner attestations.
- Management approval to proceed.
- Finalised scope package for assessor or SAQ signatory.

### Phase 6: Formal Validation and Attestation

The validation phase completes the required PCI DSS assessment and submission process.

Key activities:

1. Complete the applicable SAQ, Attestation of Compliance, or Report on Compliance process.
2. Support QSA or ISA assessment activities where applicable.
3. Resolve assessment questions or evidence gaps.
4. Obtain executive review and sign-off on attestation documents.
5. Submit required validation documentation to the acquiring bank, payment brand, or requesting entity.
6. Record assessment outcomes and any required remediation commitments.

Expected outputs:

- Completed SAQ and AOC or ROC and AOC, as applicable.
- Assessment evidence archive.
- Submission confirmation.
- Management sign-off.
- Lessons learned and continuous compliance backlog.

### Phase 7: Continuous Compliance and Scope Maintenance

The continuous compliance phase maintains PCI DSS scope and control effectiveness after formal validation.

Key activities:

1. Monitor changes that may affect PCI DSS scope.
2. Perform periodic scope reviews and update scope documentation.
3. Maintain asset inventories, data-flow diagrams, network diagrams, and service provider records.
4. Track recurring PCI DSS activities, including vulnerability scanning, access reviews, log reviews, awareness, risk assessment, and incident response testing.
5. Confirm that business-as-usual processes include PCI DSS control ownership and evidence retention.
6. Prepare for the next validation cycle.

Expected outputs:

- Updated scope documentation.
- Continuous compliance calendar.
- Periodic control evidence.
- Scope change assessments.
- Updated service provider compliance records.
- Annual reassessment plan.

## Milestones & Timeline

The following timeline is the baseline plan for implementing and validating PCI DSS v4.0.1 compliance. Dates must be adjusted based on the effective date of this plan, confirmed assessment method, remediation complexity, and acquiring bank requirements.

| Milestone | Key Deliverables | Target Date | Owner | Status |
|---|---|---:|---|---|
| Project initiation approved | Executive sponsor confirmed; project team assigned; charter approved. | [Date] | Executive Sponsor | Not Started |
| Merchant level and assessment method confirmed | Transaction volumes reviewed; acquirer confirmation obtained; SAQ type or ROC pathway confirmed. | [Date] | Finance / PCI Compliance Manager | Not Started |
| Payment channel inventory completed | All payment acceptance channels and locations documented. | [Date] | Payment Operations | Not Started |
| Scope discovery workshops completed | Business and technical walkthroughs completed for all payment channels. | [Date] | PCI Compliance Manager | Not Started |
| Cardholder data-flow diagrams completed | Data flows documented and approved for each payment channel. | [Date] | IT Architecture | Not Started |
| Network and segmentation diagrams completed | CDE boundaries, connected systems, segmentation controls, and security-impacting systems documented. | [Date] | Network Operations | Not Started |
| In-scope asset inventory baselined | Systems, applications, payment devices, databases, services, and administrative platforms identified. | [Date] | IT Operations | Not Started |
| Third-party PCI inventory completed | Service providers identified; AOCs and responsibility matrices requested. | [Date] | Vendor Management | Not Started |
| Scope statement approved | PCI DSS scope confirmed and signed off by PCI Compliance Manager and Executive Sponsor. | [Date] | PCI Compliance Manager | Not Started |
| PCI DSS gap assessment completed | Applicable requirements assessed; gaps documented and prioritised. | [Date] | Information Security | Not Started |
| Remediation plan approved | Remediation actions, owners, dates, and escalation criteria approved. | [Date] | Executive Sponsor | Not Started |
| High-risk remediation completed | Critical gaps affecting account data security, scope validity, or assessment readiness resolved. | [Date] | Control Owners | Not Started |
| Service provider evidence completed | Current AOCs, responsibility matrices, and contractual responsibilities obtained and reviewed. | [Date] | Vendor Management | Not Started |
| Internal readiness review completed | Evidence reviewed; open issues dispositioned; readiness sign-off obtained. | [Date] | PCI Compliance Manager | Not Started |
| Formal assessment completed | SAQ/AOC or ROC/AOC completed with required evidence and approvals. | [Date] | PCI Compliance Manager / Assessor | Not Started |
| Submission completed | Required validation documents submitted to acquirer or requesting entity. | [Date] | Finance / PCI Compliance Manager | Not Started |
| Continuous compliance plan activated | Recurring control activities scheduled; scope review triggers integrated into change processes. | [Date] | PCI Compliance Manager | Not Started |

Project status will be reported at least monthly to the Executive Sponsor and relevant governance forum until formal validation is complete. High-risk issues or scope changes must be escalated within five business days of identification.

## Roles & Responsibilities

PCI DSS compliance requires cross-functional ownership. The following roles are accountable for successful implementation, validation, and maintenance of the PCI DSS v4.0.1 programme.

| Role | Responsibilities |
|---|---|
| Executive Sponsor | Approves the PCI charter, scope, budget, priorities, and remediation decisions; resolves escalated blockers; accepts residual business risk where permitted by organisational risk governance. |
| PCI Compliance Manager | Owns the PCI DSS compliance programme; coordinates scoping, gap assessment, remediation tracking, evidence collection, assessment activities, and scope maintenance; ensures alignment with PCI DSS v4.0.1 Requirement 12.5.1. |
| Information Security | Provides security control expertise; supports risk assessment, vulnerability management, logging, incident response, security monitoring, policy development, and control validation. |
| Payment Operations | Owns payment acceptance processes; maintains inventory of payment channels and operational workflows; confirms business use of payment platforms and cardholder data handling practices. |
| Finance | Provides transaction volume data; liaises with acquirer or payment processor; supports validation submission and reconciliation process scoping. |
| IT Operations | Maintains in-scope infrastructure, endpoints, servers, databases, backups, and operational controls; supports evidence collection and remediation. |
| Network Operations | Maintains network diagrams, segmentation controls, firewall rules, wireless controls, and connectivity documentation affecting the CDE. |
| Application Owners | Own payment applications, e-commerce platforms, integrations, APIs, and supporting applications; support secure development, change management, access control, and evidence collection. |
| IT Architecture | Documents current-state and target-state payment architectures; maintains data-flow diagrams and validates scope boundaries. |
| Identity and Access Management | Supports user access provisioning, authentication controls, privileged access management, periodic access reviews, and access evidence. |
| Vendor Management / Procurement | Identifies PCI-relevant service providers; obtains AOCs, responsibility matrices, contractual assurances, and monitors ongoing third-party compliance. |
| Legal / Privacy | Supports contract review, regulatory alignment, breach notification considerations, and data retention obligations. |
| Internal Audit / Risk Management | Provides independent challenge, risk oversight, and assurance coordination where applicable. |
| Change Advisory Board | Ensures changes affecting payment systems, CDE connectivity, service providers, or account data flows include PCI DSS impact assessment before implementation. |
| Control Owners | Implement and operate assigned PCI DSS controls; maintain evidence; remediate gaps; attest to control operation when requested. |
| Qualified Security Assessor / Internal Security Assessor | Provides PCI DSS assessment guidance or performs formal assessment activities where required by the validation approach. |
| Service Provider Relationship Owners | Ensure service provider responsibilities are documented, current compliance evidence is obtained, and shared control gaps are escalated. |

The following RACI matrix applies to core PCI DSS project activities:

| Activity | Executive Sponsor | PCI Compliance Manager | Information Security | IT / App Owners | Payment Operations | Finance | Vendor Management |
|---|---|---|---|---|---|---|---|
| Approve PCI charter and scope | A | R | C | C | C | C | C |
| Confirm merchant level and assessment method | C | R | C | I | C | A/R | I |
| Document payment channels | I | C | C | C | A/R | C | I |
| Document cardholder data flows | I | A/R | C | R | C | I | C |
| Maintain in-scope asset inventory | I | A | C | R | C | I | C |
| Validate third-party service provider scope | I | A | C | C | C | I | R |
| Perform PCI DSS gap assessment | I | A/R | R | C | C | I | C |
| Execute remediation plan | A | C | C | R | R | C | C |
| Collect assessment evidence | I | A/R | R | R | R | C | R |
| Complete SAQ/AOC or support ROC | A | R | C | C | C | C | C |
| Submit validation documentation | I | C | I | I | C | A/R | I |
| Maintain continuous compliance | A | R | R | R | R | C | R |

RACI definitions:

- **R** = Responsible for performing the activity.
- **A** = Accountable for final decision or outcome.
- **C** = Consulted before or during the activity.
- **I** = Informed of progress or outcome.

## Resources

The organisation will allocate appropriate personnel, tools, budget, and supporting services to complete PCI DSS v4.0.1 implementation and validation.

### Personnel Resources

| Resource | Estimated Commitment | Purpose |
|---|---:|---|
| Executive Sponsor | 1–2 hours per month, plus escalation support | Governance, prioritisation, and approval. |
| PCI Compliance Manager | 0.4–1.0 FTE during implementation | Programme coordination, scoping, evidence management, and assessment readiness. |
| Information Security Lead | 0.2–0.5 FTE during assessment and remediation | Security control review, risk assessment, and remediation support. |
| IT Operations Representatives | As required by system scope | Infrastructure evidence, configuration remediation, logging, vulnerability management, and backup controls. |
| Network Engineer | As required during scoping and segmentation validation | Network diagrams, firewall review, segmentation evidence, and remediation. |
| Application Owners / Developers | As required by payment application scope | Application security, secure development, change evidence, and integration reviews. |
| Payment Operations SME | As required during payment workflow review | Payment process documentation and operational evidence. |
| Vendor Management Specialist | As required during third-party review | Service provider AOCs, responsibility matrices, contract evidence, and follow-up. |
| Finance Representative | As required during validation | Transaction volume confirmation, acquirer coordination, and submission support. |
| QSA / ISA Support | As needed based on assessment method | Assessment advice, readiness review, and formal validation support where required. |

### Tooling and Technical Resources

| Resource | Purpose |
|---|---|
| Asset inventory / CMDB | Identification and tracking of in-scope systems and ownership. |
| Network discovery and diagramming tools | Validation of connectivity, segmentation boundaries, and CDE architecture. |
| Vulnerability scanning platform | Internal and external vulnerability scanning of in-scope assets. |
| Approved Scanning Vendor service | External vulnerability scanning where applicable. |
| Configuration management tools | Secure configuration evidence and baseline compliance. |
| Logging / SIEM platform | Centralised security monitoring and log retention evidence. |
| Identity and access management tools | Access control, privileged access, authentication, and periodic review evidence. |
| Change management system | Evidence of approved changes and PCI impact assessment. |
| Ticketing / project management tool | Remediation tracking and accountability. |
| Document repository | Controlled storage of PCI DSS evidence, diagrams, policies, and assessment artefacts. |
| Data discovery tools | Identification of account data storage, logs, reports, and unintended PAN exposure. |
| Vendor risk management platform | Tracking of PCI-relevant service provider obligations and compliance status. |

### Budget Considerations

The following cost categories must be considered and approved as required:

| Budget Item | Description | Approval Owner |
|---|---|---|
| QSA / advisory services | External assessment, readiness review, or specialist PCI DSS support. | Executive Sponsor |
| Remediation engineering | Security tooling, configuration, network segmentation, application changes, or infrastructure improvements. | IT Leadership |
| Scanning and testing | ASV scans, penetration testing, segmentation testing, and application security testing. | Information Security |
| Training and awareness | PCI DSS role-based training for in-scope personnel. | PCI Compliance Manager |
| Payment architecture changes | Scope reduction initiatives, hosted payment integration changes, tokenisation, or service provider changes. | Executive Sponsor |
| Documentation and evidence management | Tools or services required to maintain audit-ready evidence. | PCI Compliance Manager |
| Third-party compliance reviews | Vendor assurance, legal review, or contract updates for PCI-relevant service providers. | Vendor Management / Legal |

Resources must be sufficient to ensure the organisation can complete scope validation, remediate compliance gaps, and maintain ongoing PCI DSS controls without relying solely on annual assessment activity.

## Success Metrics

The PCI DSS v4.0.1 implementation will be measured using outcome-based and control-readiness metrics. These metrics support management oversight and demonstrate whether PCI DSS scope is understood, documented, and maintained in accordance with Requirement 12.5.1.

| Metric | Target | Measurement Method | Reporting Frequency |
|---|---:|---|---|
| Merchant level and assessment method confirmed | 100% complete before gap assessment | Acquirer confirmation or documented validation basis | Once per assessment cycle |
| Payment channels documented | 100% of active payment channels | Approved payment channel inventory | Monthly during project; quarterly thereafter |
| Cardholder data-flow diagrams completed | 100% of in-scope payment channels | Approved diagrams reviewed by business and technical owners | Monthly during project; after material change |
| In-scope asset inventory completeness | 100% of identified CDE, connected-to, and security-impacting systems | Reconciliation against network diagrams, CMDB, and discovery outputs | Monthly during project; quarterly thereafter |
| Service provider PCI evidence obtained | 100% of PCI-relevant service providers | Current AOC and responsibility matrix on file | Monthly during project; at least annually thereafter |
| Scope approval completed | Formal approval before assessment validation | Signed scope statement or governance record | Once per assessment cycle; after scope change |
| High-risk PCI gaps remediated | 100% before formal validation or formally risk-managed where permitted | Remediation tracker and evidence review | Weekly or biweekly during remediation |
| Assessment evidence readiness | 100% of applicable requirements have current evidence | Evidence repository review against SAQ/ROC checklist | Prior to formal validation |
| Open critical scope issues | 0 at validation | Scope issue log and management review | Weekly during assessment readiness |
| PCI impact assessments for relevant changes | 100% of payment, CDE, or service provider changes | Change records with PCI impact field completed | Monthly |
| Validation submitted by target date | Completed by [Target Validation Date] | Submission confirmation from acquirer or requesting entity | Once per assessment cycle |
| Continuous compliance activities scheduled | 100% of recurring PCI tasks assigned and calendared | Compliance calendar and task tracker | Quarterly |

A successful outcome for this plan is achieved when:

1. The organisation has formally confirmed and documented its PCI DSS scope.
2. The merchant level and assessment method are approved and defensible.
3. All payment channels and account data flows are documented.
4. In-scope systems, people, processes, facilities, and service providers are identified.
5. Control ownership and remediation accountability are assigned.
6. Required PCI DSS validation documentation is completed and submitted by the agreed deadline.
7. Business-as-usual processes are established to maintain scope and compliance after validation.

## Review & Update Triggers

This PCI Project Charter & Scope Plan must be reviewed at least annually and whenever there is a material change that could affect PCI DSS scope, assessment method, business justification, merchant level, payment architecture, account data flows, or control responsibilities.

The PCI Compliance Manager is responsible for coordinating reviews and ensuring updates are approved by the appropriate governance authority.

The following events require review and, where applicable, update of this plan:

| Trigger | Required Action | Review Owner |
|---|---|---|
| Annual PCI DSS validation cycle begins | Confirm merchant level, assessment method, scope, roles, timeline, and resources. | PCI Compliance Manager |
| Change in transaction volume | Reassess merchant level and validation requirements. | Finance / PCI Compliance Manager |
| New payment channel introduced | Perform PCI impact assessment; update payment inventory, data flows, systems, and assessment method if needed. | Payment Operations |
| Change to payment processor, gateway, acquirer, or payment service provider | Review service provider responsibilities, AOC, contracts, data flows, and scope implications. | Vendor Management / Finance |
| E-commerce payment integration change | Review payment page architecture, scripts, redirects, iframe/API use, data flows, and applicable SAQ type. | Application Owner |
| New storage, display, processing, or transmission of PAN | Conduct immediate scope and risk assessment; update controls and documentation. | Information Security |
| Discovery of sensitive authentication data storage after authorisation | Escalate as high-risk issue; initiate remediation and incident/risk assessment as appropriate. | Information Security |
| Network architecture or segmentation change | Revalidate CDE boundaries, connected systems, diagrams, firewall rules, and segmentation testing needs. | Network Operations |
| New system connected to the CDE | Assess scope impact; update asset inventory, diagrams, and control ownership. | IT Operations |
| Cloud migration or hosting change | Review shared responsibility, service provider AOC, architecture, logging, access, encryption, and segmentation implications. | IT Architecture |
| Merger, acquisition, divestiture, or new business unit | Reassess payment channels, transaction volume, systems, service providers, and compliance obligations. | Executive Sponsor |
| New or changed service provider with PCI relevance | Obtain AOC and responsibility matrix; update third-party inventory and shared control mapping. | Vendor Management |
| Control failure or significant security incident | Review scope accuracy, control design, incident response outcomes, and remediation priorities. | Information Security |
| Material audit, assessment, or QSA finding | Update plan, scope documentation, remediation roadmap, and success metrics. | PCI Compliance Manager |
| Organisational restructuring affecting ownership | Update roles, responsibilities, escalation paths, and governance forums. | Executive Sponsor |
| PCI DSS or payment brand requirement change | Assess impact and update plan, scope, controls, and timeline. | PCI Compliance Manager |

At each review, the following artefacts must be checked for accuracy and alignment:

1. Merchant level and assessment method.
2. Business justification for PCI DSS applicability.
3. Payment channel inventory.
4. Cardholder data-flow diagrams.
5. Network diagrams and segmentation boundaries.
6. In-scope asset inventory.
7. Service provider inventory and compliance evidence.
8. Roles, responsibilities, and control ownership.
9. Timeline, milestones, and validation deadlines.
10. Remediation status and residual risks.
11. Continuous compliance activities and evidence retention requirements.

Updates to this plan must be version-controlled. Material scope changes must be approved by the Executive Sponsor and communicated to affected control owners, service provider relationship owners, and assessment stakeholders.