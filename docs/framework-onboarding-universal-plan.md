# Universal framework onboarding: audit, gaps, architecture and plan

Written 2026-11-11 on branch `claude/quirky-bardeen-ee8491`, after the brief "Complete Universal Framework Onboarding Across Our GRC Platform" and the "existing compliance as a lightweight discovery step" pattern. Sections 1, 4 and 8 are generated from the catalog and the engine, so they match what is built. Nothing here is applied to the main checkout or pushed.

## 0. Where it stands

Done in this round (commit `7716096f`): the **"What exists" section**: one question for every framework (Yes / No / In progress / Not sure), then, after a Yes, a list of items whose kind comes from that framework's own list (ISO: external certification, internal audit results, Statement of Applicability, risk assessment, previous audit; SOC 2: Type I or Type II report, readiness or gap assessment; PCI DSS: ROC, AOC, SAQ, ASV scan attestation; SWIFT: external assessment, independent attestation, self-assessment, previous attestation; the other frameworks their own). Only the kind is needed; dates, issuer, version assessed, period, whether it covers the scope being set up and up to five documents are optional. Stored in a table of its own, apart from the compliance work, with a verification status (declared, document attached, reviewed, verified). The ~45 per-framework "exists + upload" questions added earlier were folded into it.

Not done, and why each needs its own piece of work (section 7): framework version management, the transition from an approved onboarding into an initialised compliance programme, reading the uploaded documents (extract, match, carry forward), configurable questions for custom and uploaded frameworks, and checking every question against the issuing body (needs the source texts).

## 1. Framework coverage audit (generated)

`V/S/U` = own questions whose source is verified / secondary / unverified. Version, region and assessment route come from the journey flow the platform already holds; the catalog itself carries no version yet.

| Framework | Slug | Family | Version | Region | How it is assessed | Library | Required (own, in all) | Own questions | Kinds of existing work | V/S/U |
|---|---|---|---|---|---|---|---|---|---|---|
| CSA CCM and STAR | `csa_ccm_v4` | Attestations and assurance reports | 4.0 | International | Self-assessment (STAR L1 CAIQ) + 3rd-party audit (STAR L2... | yes | 7 | 5 | 4 (S) | 1/4/0 |
| HITRUST CSF | `hitrust_csf` | Attestations and assurance reports | 11.4.0 | International | Validated assessment + certification via MyCSF (e1 1-yr,... | yes | 6 | 3 | 4 (S) | 1/2/0 |
| SOC 2 | `soc2` | Attestations and assurance reports | 2017/2022 | United States | Type II attestation over a period (design + operating... | yes | 8 | 5 | 5 (S) | 0/5/0 |
| SOX IT general controls | `sox` | Attestations and assurance reports | 2024 | United States | Management assessment of ICFR + independent external... | yes | 7 | 4 | 4 (S) | 1/3/0 |
| CIS Controls v8 | `cis_controls` | Control and governance frameworks | 8.0 | International | Self-assessment (IG1/IG2/IG3; CSAT scoring; optional... | yes | 6 | 4 | 4 (S) | 1/3/0 |
| COBIT 2019 | `cobit` | Control and governance frameworks | 2019 | International | Maturity/capability assessment (CMMI-based scale) | yes | 5 | 2 | 4 (S) | 0/2/0 |
| NIST AI RMF | `nist_airmf` | Control and governance frameworks | 1.0 | United States | Voluntary self-assessment vs the 4 Functions & AI RMF... | yes | 5 | 4 | 5 (S) | 0/4/0 |
| NIST CSF 2.0 | `nist_csf` | Control and governance frameworks | 1.1 | United States | Self-assessment vs Current/Target Profile; no formal cert... | yes | 5 | 4 | 5 (S) | 2/2/0 |
| NIST SP 800-171 | `nist_800_171` | Control and governance frameworks | Rev 2 | United States | DoD self-assessment scored in SPRS; CMMC L2 via C3PAO (or... | yes | 7 | 6 | 5 (S) | 3/2/1 |
| NIST SP 800-53 Rev 5 | `nist_800_53` | Control and governance frameworks | Rev 5 | United States | RMF authorization (ATO) via independent assessment (SP... | yes | 6 | 5 | 5 (S) | 2/3/0 |
| DORA (EU 2022/2554) | `dora` | EU digital and cyber resilience | EU 2022/2554 | European Union | Supervisory oversight; RTS/ITS conformance; Register of... | yes | 8 | 5 | 5 (S) | 0/5/0 |
| NIS2 Directive (EU 2022/2555) | `nis2` | EU digital and cyber resilience | EU 2022/2555 | European Union | Regulatory compliance / supervision (ex-ante essential,... | yes | 9 | 9 | 5 (S) | 5/3/1 |
| ADHICS | `adhics` | Gulf regulators | 0.9 | United Arab Emirates | Compliance assessment (gap -> implement -> self-assess)... | yes | 7 | 5 | 4 (U) | 0/1/4 |
| DoH ADHIE Policy (Malaffi) | `doh_adhie_policy` | Gulf regulators | 1.1 | United Arab Emirates | HIE onboarding & participation compliance (agreement,... | yes | 7 | 4 | 3 (U) | 2/1/1 |
| NCA Cloud Cybersecurity Controls | `nca_ccc` | Gulf regulators | n/a | n/a | n/a | catalog only | 8 | 4 | 5 (U) | 1/1/2 |
| NCA Data Cybersecurity Controls | `nca_dcc` | Gulf regulators | n/a | n/a | n/a | catalog only | 8 | 3 | 5 (U) | 0/1/2 |
| NCA Essential Cybersecurity Controls | `nca_ecc` | Gulf regulators | n/a | n/a | n/a | catalog only | 7 | 3 | 5 (U) | 0/1/2 |
| NCA Operational Technology Controls | `nca_otcc` | Gulf regulators | n/a | n/a | n/a | catalog only | 8 | 4 | 5 (U) | 2/1/1 |
| NCA Telework Cybersecurity Controls | `nca_tcc` | Gulf regulators | n/a | n/a | n/a | catalog only | 8 | 3 | 5 (U) | 1/1/1 |
| QCB Technology Risks | `qcb_technology_risks` | Gulf regulators | Jan 2018 | Qatar | Regulatory examination / supervisory compliance... | yes | 6 | 3 | 4 (U) | 1/1/1 |
| SAMA Cyber Security Framework | `sama_csf` | Gulf regulators | 2023 | Saudi Arabia | Maturity self-assessment (levels 0-5) + regulator review;... | yes | 6 | 5 | 5 (U) | 3/0/2 |
| UAE Information Assurance Standard | `uae_ia` | Gulf regulators | 2.1 | United Arab Emirates | Risk-based applicability; entity self-assessment and... | not in canonical catalog | 8 | 5 | 5 (U) | 0/2/3 |
| ISO 22301:2019 | `iso_22301` | Management system standards | 2019 | International | Accredited 3rd-party certification (Stage 1 + Stage 2) | yes | 5 | 3 | 6 (S) | 0/3/0 |
| ISO 45001:2018 | `iso_45001` | Management system standards | 2018 | International | Accredited 3rd-party certification (Stage 1 + Stage 2) | yes | 5 | 4 | 5 (S) | 0/4/0 |
| ISO/IEC 27001:2022 | `iso_27001` | Management system standards | 2022 | International | Accredited 3rd-party certification (Stage 1 + Stage 2) | yes | 5 | 3 | 5 (S) | 0/3/0 |
| ISO/IEC 42001:2023 | `iso_42001` | Management system standards | 2023 | International | Accredited 3rd-party certification (Stage 1 + Stage 2),... | yes | 6 | 5 | 6 (S) | 0/5/0 |
| PCI DSS v4.0.1 | `pci_dss` | Payments and financial messaging | 4.0.1 | United States (global... | Report on Compliance (RoC) by QSA (L1) or SAQ (self); plus... | yes | 7 | 9 | 5 (S) | 9/0/0 |
| SWIFT CSCF | `swift_cscf` | Payments and financial messaging | 2024 | International | Annual attestation + mandatory independent assessment,... | yes | 6 | 6 | 4 (S) | 0/6/0 |
| GDPR | `gdpr` | Privacy and data protection | 2016/679 | European Union | Regulatory compliance / DPA enforcement... | yes | 8 | 10 | 5 (S) | 2/8/0 |
| HIPAA Security and Privacy Rules | `hipaa` | Privacy and data protection | 2024 | United States | Regulatory obligation; self-assessment with OCR... | yes | 7 | 3 | 4 (S) | 1/2/0 |
| KSA NDMO data standards | `ndmo` | Privacy and data protection | 1.5 | Saudi Arabia | Compliance & maturity assessment vs 15 domains + PDP;... | yes | 7 | 3 | 4 (U) | 0/0/3 |
| KSA Personal Data Protection Law | `ksa_pdpl` | Privacy and data protection | n/a | n/a | n/a | catalog only | 7 | 5 | 4 (U) | 0/5/0 |
| KSA personal data transfer rules | `ksa_pdp_transfer` | Privacy and data protection | 2.0 | Saudi Arabia | Regulatory compliance / cross-border Transfer Risk... | yes | 7 | 3 | 3 (U) | 0/2/1 |
| MAS TRM Guidelines | `mas_trm` | South and South-East Asia regulators | 2021 | Singapore | Supervisory guidelines (examinable): FI self-assessment +... | yes | 7 | 3 | 4 (U) | 2/0/1 |
| PISF 2026 | `pisf_2026` | South and South-East Asia regulators | n/a | n/a | n/a | yes | 8 | 4 | 4 (U) | 0/3/1 |
| SBP Cloud Framework | `sbp_cloud` | South and South-East Asia regulators | 2023 | Pakistan | Regulatory framework: risk-based cloud governance; SBP... | yes | 7 | 5 | 4 (U) | 3/0/2 |
| SBP ETGRMF | `sbp_etgrmf` | South and South-East Asia regulators | 2022 | Pakistan | Regulatory framework: FI gap analysis + board-approved... | yes | 6 | 3 | 4 (U) | 1/0/2 |
| SBP Internet Banking | `sbp_internet_banking` | South and South-East Asia regulators | 2023 | Pakistan | Regulatory directive: CEO-approved plan with monthly... | yes | 7 | 3 | 4 (U) | 2/0/1 |
| Sri Lanka CBSL standard | `sl_csf` | South and South-East Asia regulators | 1.0 | Sri Lanka | Mandatory baseline: FI self-assessment/gap analysis +... | yes | 7 | 3 | 4 (U) | 2/0/1 |
| SABIC CyberTrust | `sabic_cybertrust` | Supplier certification | 1.0 | Saudi Arabia | Supplier self-assessment validated by audit firm; 100%... | yes | 7 | 5 | 4 (U) | 1/0/4 |
| Saudi Aramco CCC | `aramco_ccc` | Supplier certification | 2024 | Saudi Arabia | CCC/CCC+ certification via Aramco-Authorized Audit Firm | yes | 9 | 6 | 4 (U) | 4/0/2 |
| Global Cyber Resilience Framework | `gcrf` | Custom and other frameworks | 1.0 | International | Resilience maturity assessment + certification... | not in canonical catalog | 5 | 0 | 5 (S) | 0/0/0 |

42 frameworks. Not every framework follows the same model: the question sets differ by family (certification standard, attestation, regulatory framework, privacy law, supplier certification, governance framework), and the common five steps are the only part they share.

## 2. The brief against what is built

Status: **Done**, **Partly**, **Not built**.

| Brief | Status | Where it lives or what is missing |
|---|---|---|
| Universal foundation for every framework | Done | Five common steps (`common.json`): objective, applicability, scope, existing work, ownership. Entity, countries and owner are prefilled from the tenant and the organisation profile. |
| Compliance objective, legal entity, countries | Done | Objective (certification, regulatory, customer, internal), legal entity, countries. |
| Regulatory or contractual obligation | Partly | Free text "Required by" shown for the regulatory and customer objectives; no structured obligation record. |
| Framework applicability, voluntary versus mandatory | Partly | Framework-specific applicability questions and "Applies to"; a voluntary choice exists where a framework needs it (SAMA, NIS2, NCA). No single recorded decision "applies / does not apply / voluntary" with its justification. |
| Organisation-wide versus selected scope, scope document | Done | "Applies to", "Scope defined" with an optional scope document, scope statement (AI draft), exclusions with reasons. |
| Departments, systems, locations, third parties | Done | Picked from the department tree, the asset inventory and the organisation profile; asked only for selected-parts scope (third parties unless none declared). |
| Business processes | Partly | A table (process, owner) in the scope step; no pick from a process register (the platform has none wired to onboarding). |
| Cloud and hosting environments | Partly | Hosting ticks for selected-parts scope; cloud questions for SBP, NCA CCC and MAS. No whole-organisation cloud question (by design: not asked where it is not relevant). |
| Existing compliance work, previous assessments, evidence, policies, previous GRC system | Done | "What exists" (new): status, framework-specific kinds, dates, issuer, scope coverage, documents, verification status. Policies, risk register, evidence repository and open actions as ticks; previous system when migrating. |
| Program owner, coordinator, approver, control teams, assessor, target date | Done | Ownership and objective steps; owner and approver checked to be different people (advised). |
| Reuse of organisational data, no repeated questions | Partly | Prefill from tenant and profile; picks from the inventory. The profile's processes and locations feed only picks; nothing is prefilled from an earlier framework's onboarding. |
| Framework-specific onboarding for every framework | Done | All frameworks in section 1 have their own applicability, configuration and conditional questions. Source status per question is kept (V/S/U); most are secondary or unverified. |
| Catalog audit fields (version, jurisdiction, entity types, required documents, certification requirements, validation, sources) | Partly | Section 1 and the coverage file hold family, region, assessment route, questions, sources. Not in the catalog data: framework version, intended entity types as metadata, required documents as metadata. |
| Dynamic engine: field types | Done | Text, long text, dropdown, multi-select, yes/no, date, number, country(ies), organisation entity, department, asset, vendor, user (person), table, document upload, existing-work list. |
| Dynamic engine: conditional questions and uploads, required/optional/advisory, framework-specific validation | Done | `when` rules (eq, ne, in, includes), gate checks (filled, equals, any_filled, distinct, table rule ...), required/advised/optional levels. |
| Dynamic engine: framework-version-specific questions | Done (first slice) | A framework entry may name its versions (`versions`) and a `when` may read `fw.version`: the answered version, else the one the library row holds. Real use: NIST SP 800-171 (Rev 2 held by the library, Rev 3 an answer option, unverified) and NCA ECC (ECC-2:2024 and ECC-1:2018, unverified). See `docs/framework-version-management.md`. |
| Separate applicability, scope, requirement, control, implementation, compliance | Partly | Onboarding stores the initial applicability and scope context only. Nothing writes a requirement, control or compliance status (tested). Requirement and control applicability belong to compliance execution, which is not wired. |
| Exclusions justified and approved | Done | Exclusions need a reason; the whole onboarding is approved (one approver; four-eyes not built). No per-exclusion approval. |
| A claim of existing compliance never marks controls compliant | Done | Items are claims kept in their own table; a test checks that nothing else is started or changed. |
| Compliance execution after onboarding (load controls, assignments, evidence collection, workflows, dashboards, reassessment) | Not built | Approval lets the journey start (the gate); the journey is started by the existing Frameworks flow. The answers (owner, teams, scope systems, existing evidence) are not passed into it. |
| Framework version management | Done (first slice) | A baseline is taken at approval (library version, control fingerprint, shape of the questions, version in use); a changed library version, a successor row, changed controls or changed questions mark the onboarding "needs review" listing exactly the stale answers, stale applicability decisions, new questions, changed controls and the programs affected; the program owner is notified once per change; banner on the onboarding and the register; review outcomes (still correct, reopen to change, start for the new version) are events. Nothing is rewritten. Not built: moving compliance work onto a successor, notifying journey stage owners. Design: `docs/framework-version-management.md`. |
| Frameworks missing from the library or the canonical catalog | Partly | Listed in section 1 (NCA ECC/CCC/DCC/OTCC/TCC and KSA PDPL are catalog only; UAE IA and GCRF are not in the canonical catalog). No action beyond listing. |
| Custom and uploaded frameworks configurable beyond the common five steps | Not built | They get the common five steps with the general kinds of existing work. There is no way to add questions for a custom framework. |
| Accuracy and source verification | Partly | V/S/U preserved on every question; one independent review. Nothing was checked against the issuing bodies' own texts; the gaps are listed in the coverage file. |
| Desktop and mobile | Done | Checked at 375 px for ISO 27001, PCI DSS and the new section: no horizontal overflow. |
| Persistence, draft handling, completion, activation | Done | Over HTTP for ISO 27001, SOC 2, PCI DSS and a custom framework (draft, autosave, submit, approve, lock, reopen, underway, the journey gate). Other frameworks are exercised through the engine only (section 8). |
| Existing-compliance pattern: upload documents | Done | Multiple files, optional, per item, kept in Evidence; can be added later. |
| Existing-compliance pattern: does it cover the same scope | Partly | A per-item answer (Yes completely / Partially / No / Not sure) plus a note; not prefilled from a document and not tied to specific entities or systems. |
| Existing-compliance pattern: after upload, extract version, type, issuer, dates, scope; match findings and evidence to requirements; carry forward | Not built | Documents are stored and listed only. Nothing reads them. |

## 3. Missing onboarding requirements

- **A recorded applicability decision per framework**: applies, does not apply, or voluntary, with a reason. Today it is spread across the framework's own questions.
- **Framework version** on the onboarding (the version being onboarded) and in the catalog, so a question can depend on it and a version change can be detected. Built (first slice): the baseline records the version, and the catalog names versions only where it knows them.
- **Requirement-level applicability**: which requirements and controls are in or out, with justification. Belongs to compliance execution.
- **Where the answers go next**: owner, control teams, scope systems and existing evidence are collected but not handed to the journey or the control assignments.
- **Per-framework required documents** as metadata (what the framework or its assessor expects to see) rather than only free uploads.
- **Questions for custom and uploaded frameworks**.
- **Version data to check**: checked against the library files on 2026-11-12: 33 of 34 journey-flow versions agree with the library row's `version` once wording is dropped ("v4.0.1" and "4.0.1"). The one contradiction is NIST CSF: library 2.0, flow 1.1; the flow's phases were not reread, so the number was not edited. The SCF edition behind four crosswalks differs from the library edition (CIS 8.1 against 8.0, SWIFT 2025 against 2024, SAMA 2017 against 2023, NIST 800-171 R3 in SCF against Rev 2 in the library). ADHICS 0.9 and the HIPAA and SOX "2024" are what the library files say; whether they are what the issuing bodies call them is unverified.
- **Authoritative verification** of the Gulf, Asia, supplier and KSA question sets (sources are listed per framework in the coverage file).

## 4. Question audit (generated)

Own questions across all frameworks: 53 verified, 89 secondary, 39 unverified. The per-question list with its mark is in `fw-onboarding-coverage-and-gaps.md` (shared notes folder), regenerated from the catalog.

## 5. Common onboarding improvements

- Done: existing work is one section; per-framework existence questions removed in favour of it; scope document question; common prefill.
- Recommended next: record the applicability decision; carry the owner, teams and scope into the journey; offer the existing items as evidence candidates when assessments begin.

## 6. Data model and architecture

Existing (additive tables, no column anywhere else): `grc_fw_org_profile`, `grc_framework_onboardings` (answers JSON, frozen snapshot, state machine), `grc_framework_onboarding_events`, and now `grc_fw_existing_compliance`.

```
grc_fw_existing_compliance: id, tenant_id, onboarding_id, assessment_type (the framework's own kind), framework_version, assessment_date, valid_until,
  period_start, period_end, assessor_or_issuer, scope_coverage, scope_note, evidence_ids[] (Evidence rows), verification_status
  (declared | evidence_received | reviewed | verified), verified_by/at, note, created_by/at, updated_at
```

Three things stay apart: the claim (a row here), the evidence (Evidence rows) and the compliance status (written only by the platform's own assessments).

Recommended, not built:
- **Version management** (built, first slice: `grc_fw_version_baseline`, `modules/framework_onboarding/versioning.py`; design `docs/framework-version-management.md`): a baseline per settled onboarding instead of a change record, a computed `needs_review` that lists the stale answers and decisions and notifies the program owner; historical onboardings and assessments are never rewritten.
- **Compliance initialisation**: on approval, an idempotent hand-off that creates or updates the journey, proposes control owners from the control teams, scopes the controls to the picked systems and registers the existing evidence as candidates; every step an event, never a status.
- **Document analysis**: a background job per uploaded document that proposes the version, type, issuer, dates and scope as suggestions the person confirms (through the AI guard, never SCF text), and matches findings and evidence to requirements as candidates with the source and date carried forward; nothing becomes a control status.
- **Custom framework questions**: tenant-level question sets stored as data in the same catalog shape and merged after the common steps, authored in a settings page.

## 7. Implementation plan

| Phase | What | Status |
|---|---|---|
| 1 | Common five steps, framework-specific questions for every framework, gate, "already underway" | Done |
| 2 | "What exists": per-framework kinds, items, documents, verification status, approval snapshot | Done (this round) |
| 3 | Framework version management | Built (first slice, 2026-11-12, branch `claude/competent-lehmann-398b30`, not applied) |
| 4 | Compliance initialisation from an approved onboarding | Proposed as its own piece of work |
| 5 | Reading uploaded documents: extraction, matching, carry forward | Proposed as its own piece of work |
| 6 | Configurable questions for custom and uploaded frameworks | Proposed as its own piece of work |
| 7 | Verification of every question set against the issuing bodies | Needs the source texts from the product owner |

## 8. Tests and framework-by-framework results

Automated on the final tree: 243 backend tests (onboarding catalog, engine and API, AI registry, audit coverage, workflow catalogue, UAE IA, assessment scoping, departments) and 4,845 frontend node tests passed; the catalog validator reports 0 errors; `tsc` reports the 31 errors that existed before, none in onboarding. Browser (PostgreSQL scratch stack): the "What exists" section for PCI DSS (the framework's own kinds, an item with a document and dates saved and survived a reload, review refused for a user who may not approve, 375 px without overflow).

Each framework below was filled with sample answers for every required and advised question (including every conditional one) and evaluated by the engine; "open" is the number of required items still open afterwards (must be 0). Over HTTP (draft, autosave, submit, approve, lock, journey gate) only ISO 27001, SOC 2, PCI DSS and a custom framework were exercised.

| Framework | Steps | Required | Conditional questions | Required open after filling | Kinds of existing work | Result |
|---|---|---|---|---|---|---|
| CSA CCM and STAR | 6 | 7 | 12 | 0 | 4 | pass |
| HITRUST CSF | 6 | 6 | 12 | 0 | 4 | pass |
| SOC 2 | 6 | 8 | 12 | 0 | 5 | pass |
| SOX IT general controls | 6 | 7 | 11 | 0 | 4 | pass |
| CIS Controls v8 | 7 | 6 | 11 | 0 | 4 | pass |
| COBIT 2019 | 6 | 5 | 11 | 0 | 4 | pass |
| NIST AI RMF | 6 | 5 | 11 | 0 | 5 | pass |
| NIST CSF 2.0 | 7 | 5 | 11 | 0 | 5 | pass |
| NIST SP 800-171 | 7 | 7 | 12 | 0 | 5 | pass |
| NIST SP 800-53 Rev 5 | 7 | 6 | 12 | 0 | 5 | pass |
| DORA (EU 2022/2554) | 7 | 8 | 11 | 0 | 5 | pass |
| NIS2 Directive (EU 2022/2555) | 7 | 9 | 12 | 0 | 5 | pass |
| ADHICS | 7 | 7 | 11 | 0 | 4 | pass |
| DoH ADHIE Policy (Malaffi) | 7 | 7 | 14 | 0 | 3 | pass |
| NCA Cloud Cybersecurity Controls | 6 | 8 | 13 | 0 | 5 | pass |
| NCA Data Cybersecurity Controls | 6 | 8 | 12 | 0 | 5 | pass |
| NCA Essential Cybersecurity Controls | 6 | 7 | 12 | 0 | 5 | pass |
| NCA Operational Technology Controls | 6 | 8 | 13 | 0 | 5 | pass |
| NCA Telework Cybersecurity Controls | 6 | 8 | 12 | 0 | 5 | pass |
| QCB Technology Risks | 7 | 6 | 11 | 0 | 4 | pass |
| SAMA Cyber Security Framework | 7 | 6 | 11 | 0 | 5 | pass |
| UAE Information Assurance Standard | 7 | 8 | 11 | 0 | 5 | pass |
| ISO 22301:2019 | 6 | 5 | 13 | 0 | 6 | pass |
| ISO 45001:2018 | 7 | 5 | 13 | 0 | 5 | pass |
| ISO/IEC 27001:2022 | 6 | 5 | 13 | 0 | 5 | pass |
| ISO/IEC 42001:2023 | 7 | 6 | 13 | 0 | 6 | pass |
| PCI DSS v4.0.1 | 6 | 7 | 14 | 0 | 5 | pass |
| SWIFT CSCF | 6 | 6 | 11 | 0 | 4 | pass |
| GDPR | 7 | 8 | 15 | 0 | 5 | pass |
| HIPAA Security and Privacy Rules | 7 | 7 | 11 | 0 | 4 | pass |
| KSA NDMO data standards | 7 | 7 | 11 | 0 | 4 | pass |
| KSA Personal Data Protection Law | 7 | 7 | 11 | 0 | 4 | pass |
| KSA personal data transfer rules | 7 | 7 | 12 | 0 | 3 | pass |
| MAS TRM Guidelines | 7 | 7 | 11 | 0 | 4 | pass |
| PISF 2026 | 6 | 8 | 11 | 0 | 4 | pass |
| SBP Cloud Framework | 7 | 7 | 14 | 0 | 4 | pass |
| SBP ETGRMF | 7 | 6 | 11 | 0 | 4 | pass |
| SBP Internet Banking | 7 | 7 | 12 | 0 | 4 | pass |
| Sri Lanka CBSL standard | 7 | 7 | 11 | 0 | 4 | pass |
| SABIC CyberTrust | 7 | 7 | 11 | 0 | 4 | pass |
| Saudi Aramco CCC | 7 | 9 | 12 | 0 | 4 | pass |
| Global Cyber Resilience Framework | 5 | 5 | 11 | 0 | 5 | pass |

## 9. Documentation

`docs/framework-onboarding-plan.md` (the original research and plan, with the build record), this file, and in the shared notes folder `fw-onboarding-pack-lines-quirky.md` (the project-pack lines, sections 1 to 11), `fw-onboarding-coverage-and-gaps.md` and `fw-onboarding-questions-by-framework.md` (generated).

