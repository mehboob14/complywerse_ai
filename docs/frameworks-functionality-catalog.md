# Frameworks (Compliance) — Full Functionality Catalog (A to Z)

Exploration record, 4 July 2026 — input for the Frameworks dashboard formula proposal.
Nothing built yet; this is the "what exists" inventory, same process as governance and ERM.

## 1. Pages and what happens on them

| # | Page | Purpose | Key activities (mutations) |
|---|------|---------|----------------------------|
| 1 | `/frameworks` | Compliance posture hub: framework library, certification journey cards w/ readiness % | start journey, search/filter |
| 2 | `/frameworks/[id]` | Certification journey deep-dive: control mastery, evidence, applicability, phases, artifacts, snapshots | update control status (implemented/partial/not_implemented/verified), confirm criteria checkboxes, mark applicable/not-applicable (+audit log), assign owners, upload evidence, review evidence (approve/reject), notes/gaps, create snapshot, generate phases (AI), enhance controls (AI), create artifacts |
| 3 | `/frameworks/manage` | Ops surface: parsing pipeline monitor (3s polling), journeys, library | delete framework/journey, retry parse, enhance, classify, start journey |
| 4 | `/frameworks/overview/[id]` | Pre-journey reconnaissance: classification (certification vs compliance) + reasoning + lifecycle phases | create journey |
| 5 | `/framework-upload` | Bootstrap: drag-drop file → extract text → AI parse → publish | upload, extract-text, parse, publish (short_code/regulator/jurisdiction), delete |
| 6 | `/framework-upload/alignment` | Map parsed controls → normalized library (exact/partial/new, match score 0–1) | analyze alignment (ML), confirm, edit, create-new-controls (materialize into library) |
| 7 | `/framework-upload/assessment` | Gap analysis per framework: item statuses, evidence, remediation | create assessment, set item compliance_status, upload evidence, create remediation |
| 8 | `/framework-upload/controls` | Curate parsed controls: verify, edit, evidence requirements | edit control, verify (is_verified), generate evidence requirements (AI) |

## 2. Lifecycles (the status machines everything hangs on)

- **UploadedFramework.upload_status**: uploaded → text_extracted → parsing/classifying → parsed/classified → **published** (or failed)
- **ControlImplementation.status** (journey): not_implemented → in_progress → partial → implemented → **verified**
- **AssessmentItem.compliance_status**: not_assessed → compliant | partially_compliant | non_compliant | not_applicable
- **Evidence review** (two flavors): ImplementationEvidence.review_status pending→approved/rejected; AssessmentEvidence.review_status pending→accepted/rejected/ai_assessed
- **ClauseApplicability.status**: pending → approved/rejected (with is_applicable boolean + audit log)
- **ControlEvidenceRequirement.status**: draft → submitted → pending_review → approved/rejected
- **FrameworkControlAlignment**: alignment_type exact/partial/new · match_score 0–1 · is_confirmed
- **AssessmentRemediation.status**: open → in_progress → completed/deferred
- **FrameworkAssessment.status**: not_started → in_progress → completed/archived (overall_compliance_score computed on demand — NOT auto-updated)

## 3. Backing tables (countables)

grc_uploaded_frameworks · grc_parsed_framework_controls (is_verified, is_critical, is_mandatory,
priority P1-P3, ai_confidence, dependencies) · grc_clause_applicability · grc_control_evidence_mappings ·
grc_control_evidence_requirements · grc_framework_control_alignments · grc_framework_assessments ·
grc_assessment_items (compliance_status, compliance_score 0–1, gap_description) · grc_assessment_evidence ·
grc_assessment_remediations · grc_evidence_control_mappings · plus seeded catalog (grc_frameworks/domains/
objectives/controls/sub_controls) and journey tables (CertificationJourney, ControlImplementation,
ImplementationEvidence, ComplianceSnapshot, JourneyPhase, ApplicabilityAuditLog, TenantArtifact).

## 4. Existing stats endpoints (real, reusable)

- `GET /framework-upload/assessment/{id}/dashboard` — compliance breakdown, per-domain items,
  gap_count, progress %, remediation stats, evidence stats (with/without evidence, review split)
- `GET /framework-upload/publish/{id}/status` — publish readiness
- `GET /framework-upload/alignment-summary/{fwId}` — exact/partial/new/confirmed splits
- `GET /compliance/dashboard/*` — statements summary/trends/overdue/by-document/frameworks-aggregate
- `GET /certifications/{id}/progress|gaps|snapshots|critical-controls` — journey metrics

## 5. Flagged client-side math (to replace at build time)

- Journey completion % and evidence coverage % computed in the browser on /frameworks/[id]
  (implemented/total, with_evidence/total) — must move server-side per product convention.

## 6. Natural section candidates for the formula proposal (draft, NOT final)

1. **Pipeline** — frameworks published ÷ uploaded; parse failure health; classification coverage
2. **Control curation** — parsed controls verified ÷ parsed; evidence requirements approved ÷ raised; critical controls verified
3. **Alignment** — confirmed alignments ÷ analyzed; exact-match share; new-controls materialized
4. **Applicability** — decisions approved ÷ requested; applicable share per framework
5. **Journeys (certification)** — controls implemented/verified ÷ applicable; evidence coverage; evidence review rate; snapshot cadence
6. **Assessments (compliance)** — coverage (assessed ÷ applicable); compliance score (compliant + 0.5×partial ÷ applicable); gap density; evidence review; remediation completion/timeliness

## 6b. Evidence & controls — formula-grade facts (deep dive)

The precise row-level facts that let evidence/control formulas use exact numerators/denominators.

**Two separate evidence systems — never conflate them:**
- **Journey evidence** = `ImplementationEvidence` (per file upload to a `ControlImplementation`;
  `review_status` default `pending` → `approved`/`rejected` sets `reviewed_by` + `reviewed_at`).
  No `evidence_type` column — type is matched via `ControlEvidenceMapping` on the parsed control.
- **Assessment evidence** = `AssessmentEvidence` (per assessment item; `review_status`
  pending/accepted/rejected/**ai_assessed** — the last set by the async OCR+AI task, not a human).
  `linked_evidence_id` (nullable) points at the central `grc_evidence` repo when populated.

**Evidence coverage per control (exact):**
- numerator = `ImplementationEvidence` rows with `review_status='approved'` for the control
- denominator = `ControlEvidenceRequirement` rows with `is_mandatory=true` for that (control, framework)
- coverage capped at 1.0; controls with no mandatory requirement have denominator 0 → excluded.

**Applicability already adjusts denominators (don't double-count):** when
`ClauseApplicability.is_applicable=false` (approved) / `ControlImplementation.is_applicable=false`,
the control is filtered out of "total/applicable controls" in the cert progress query
(cert_router ~line 1175). Formulas over journeys must use the applicable set as denominator to match.

**Criteria drive status automatically:** `criteria_status` JSON `{"0":true,...}`; when all criteria
met → status auto-set `implemented`, any unmet → `in_progress`. So "criteria completion" and
"implemented" are near-redundant — pick one per section, not both.

**"Verified" is NOT gated on evidence approval** — a control can be `verified` with zero approved
evidence (manual PATCH sets `verified_date`+`verified_by`, no check). This is a genuine
**data-integrity metric candidate**: verified controls that lack ≥1 approved evidence = weak/unsound
verification. Worth a formula precisely because the app doesn't enforce it.

**`overall_compliance_score` is stale by design** (only refreshed by on-demand `/calculate-score`).
The Assessments section must compute the score from `AssessmentItem.compliance_status` directly:
compliant=1.0, partially_compliant=0.5, else 0, over applicable (non `not_applicable`) items.

**Requirement workflow has two distinct gates:** `ControlEvidenceRequirement` goes
draft→submitted→pending_review→approved/rejected, and `reviewer_id` ≠ `approver_id` (two roles) —
so "requirements satisfied" = approved ÷ raised, and review-vs-approval are separable throughput metrics.

**Still client-side (replace at build):** the `EvidenceCell` in the Controls tab renders
approved/pending/rejected proportions from backend-provided counts (fine), but journey completion %
and evidence coverage % on `/frameworks/[id]` are computed in the browser (flagged §5).

## 7. Countable activities (34) — see agents' full tables

Upload/extract/parse/classify/publish/delete framework · start/delete journey · control status
updates · criteria confirms · applicability decisions (+log) · owner assignment · evidence
upload/review/delete (journey + assessment) · notes/gaps · snapshots · phase generation · AI
enhance · alignment analyze/confirm/edit/materialize · assessment create/item updates ·
remediation create/update · parsed-control edit/verify · evidence-requirement generate/approve ·
artifact create · retry parse.
