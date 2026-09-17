# Control Assurance on the Automation control page — plan

Written 2026-09-16. Every number was checked against the code or both tenant DBs that day.

**The ask.** Bring test procedures, sampling and design/operating effectiveness from the Controls catalog into Automation → Controls, as an **Assurance** tab on the control detail page:

- **Manual controls:** get test procedures, upload evidence against them, and mark effectiveness.
- **Automated controls:** use the evidence collectors already produce, and say plainly what still needs a manual upload.
- **Both:** find evidence already in the library and suggest it.

---

## 1. What already exists, and is reused

| Piece | State | Used for |
|---|---|---|
| **Control Workbench** (`models/_44_control_workbench.py`, `/control-library/workbench`) | Work item with design and operating effectiveness, key control, frequency and next test. Tests with tester, reviewer, period, sample size, exceptions and findings. Procedures with type and a checkbox. Per-step "sample" files with review. | The storage for everything the tab writes. **No second assurance model.** |
| **SCF → workbench join** | `NormalizedControl(source='scf', scf_id)`, verified 1:1 (1,534 of 1,534 controls, no duplicates, no gaps, both tenants). Then `ControlWorkItem(source_type='normalized', source_id=nc.id)`. Already read by `/automation/common/overview`. | Keys the tab's data to the SCF control. |
| **Assessment objectives** | 5,956 SCF objectives, 1–65 per control (mean 3.9), tagged by PPTDF. **Returned by the detail endpoint but never rendered.** SCF publishes no procedure or expected result for any of them. | "What must be proven." Rendered verbatim. |
| **Consolidated evidence sets** | 897 controls, 8,880 artifacts: 7,586 manual · 766 hybrid · 528 automated. `NOTICE.md` records this text as ours, not SCF's. | The evidence checklist, and the manual/automated split. |
| **Automated results** | `SCFCheckResult` rows carry `population_size`, `tested_size`, `truncated` and `expires_at`. Bound checks and their coverage state are already on the detail payload. | "Collected automatically" evidence, as a full-population test. |
| **Evidence library** | `grc_evidence` with OCR text and an AI summary, linked through `EvidenceControlMapping.normalized_control_id`. | Linking, and the text signals behind suggestions. |
| **`SCFControlState`** | `designation`, `last_assessed_at`, `linked_evidence_ids` and `coverage_num/den` are read by `/automation/assurance` and the SoA export. **Nothing writes them**, so those figures are structurally zero for every tenant. | The tab's review sign-off becomes their writer. |

Both tenants hold 0 workbench rows and 1 evidence row, so no data moves.

## 2. What does not exist

- **Sampling.** No population, no sample-size method, no selection, no per-item result. The catalog's "Sampling" tab is the evidence upload under another label.
- **Per-step results.** A procedure is a checkbox with no pass/exception outcome and no link to the objective it tests.
- **Artifact-level evidence.** Evidence links to a control, never to the artifact it satisfies ("Business Continuity Plan"), so nothing can say which required artifacts are still missing.
- **A matcher.** Nothing compares a required artifact to library evidence. Search is `ILIKE` on name only.
- **Independent review.** A tester can sign off their own test, an uploader can approve their own sample, and reviewed tests stay editable.

## 3. Hard constraint: SCF text never reaches a language model

SCF is CC BY-ND. GEN-FAQ-006 prohibits using AI on SCF content to generate procedures, policies, metrics, risks or threats. `NOTICE.md` asserts that no SCF prose is passed to a model anywhere in the codebase.

**That was false when this plan was written** (closed since, and the audit found more than six; see §10). Six paths send `NormalizedControl.name`, `statement` or `objective` (verbatim SCF text on `source='scf'` rows) to OpenAI, and none checks the source:

| Path | What it generates |
|---|---|
| `workbench.py:1491` `POST /items/{id}/ai-procedures` | **test procedures** — the path this feature would reuse |
| `groups.py:3050` `draft-document` | **a policy document** — the exact derivative GEN-FAQ-006 names |
| `groups.py:3002` `recommend-evidence` | evidence types |
| `evidence_recs.py:153` | evidence recommendations |
| `governance/statement_auto_map.py:113` | statement → control mapping |
| `services/ai_control_mapping.py:63` | vulnerability → control mapping, when no baseline run exists |

The reachable UI route: Library → Promote to Catalog lists SCF controls, then "Get AI Recommendation".

**Consequence for this build.** Procedures for SCF controls cannot be AI-generated from the control or its objectives. The options are in §7.

---

## 4. The Assurance tab

One tab. The order follows how an assessor works: what to prove → what proves it → how it was tested → the conclusion.

**4.1 Summary strip**
- Design and operating effectiveness, last tested, next due.
- Tester and reviewer, including whether the review was independent.
- Evidence readiness ("9 of 13 required artifacts satisfied").
- How the control is evidenced: automated, manual or hybrid.

**4.2 What must be proven**
- The SCF assessment objectives, verbatim, each with its PPTDF tag.
- Each objective shows what currently answers it:
  - an automated check (Technology objectives with a bound, connected check)
  - a test procedure
  - or **nothing yet**

**4.3 Evidence checklist**

Each required artifact in the control's consolidated set, grouped by collection method:

| Method | Shows |
|---|---|
| **Automated** | The connected checks' latest results, including population tested and expiry. If no source is connected: "Connect a source — or upload manually until you do." |
| **Manual** | Linked evidence, or **"Needs upload"**, with library suggestions offered inline. |
| **Hybrid** | Both of the above. |

Each artifact has one status:
- **Satisfied:** approved and fresh.
- **Pending review.**
- **Stale** or **expired.**
- **Missing.**

**4.4 Test procedures**
- Steps typed inquiry / observation / inspection / reperformance / walkthrough.
- Each step is linked to the objective(s) it tests.
- Each step records its expected result, then its actual result: pass, exception or N/A, with a note.
- Steps take attached samples and have inline suggestions.
- Steps can be added, edited, reordered and deleted by hand.

**4.5 Sampling and the test record**
- Each test declares:
  - the control's operating frequency
  - the population and period
  - the selection method: random with a recorded seed, systematic, or all items
- The sample size comes from the table in §5.
- Selection is **deterministic and reproducible** (the same population and seed give the same sample). The access-review module already uses this pattern.
- Each selected item gets its own result and evidence.
- Automated checks count as a full-population test: population N, tested N.

**4.6 Conclusion and sign-off**
- The tester concludes. The suggested rating follows exceptions against the tolerable limit, and a tester override needs a written rationale.
- The reviewer signs off. The test is then **locked**.
- Sign-off writes the work item's ratings **and** `SCFControlState.designation`, `last_assessed_at` and `linked_evidence_ids`. That is what makes `/automation/assurance` and the SoA real.

## 5. Sampling methodology

Industry-standard guidance for tests of controls, keyed to how often the control operates:

| Control operates | Sample size (lower risk → key / higher risk) |
|---|---|
| Annually | 1 |
| Quarterly | 2 |
| Monthly | 2 → 5 |
| Weekly | 5 → 15 |
| Daily | 20 → 40 |
| Many times a day | 25 → 60 |
| Automated (application control) | 1, relying on effective IT general controls; a bound check tests the whole population instead |

Rules:
- Key controls take the upper bound.
- **A population smaller than the table value is tested in full.**
- Tolerable exceptions default to 0. Any exception makes the suggested rating `partially_effective` or `ineffective`; the tester overrides with a written rationale.

## 6. Evidence suggestions

These are deterministic, explainable and use no model. Signals, strongest first:

1. **Same artifact, another control.** When evidence is linked to "Information Security Policy" on GOV-02, it is suggested wherever that artifact is required. Artifact names repeat heavily: "operations security policy" is required on 137 controls. This needs the artifact's key stored on the link, which is new.
2. **Linked to this control's framework controls,** through the SCF crosswalk graph. The query already exists (`groups.py` `control_coverage`).
3. **Text match.** The artifact's name and description (our text) are scored against evidence name, description, AI summary and extracted document text:
   - stopwords removed, and terms that appear everywhere weighted down
   - a bonus when the file type matches
   - a penalty for stale, expired or rejected evidence

Every suggestion states its reason: *"Linked as 'Information Security Policy' on GOV-02"*, *"Document text mentions 'quarterly access review'"*.

## 7. Decisions

1. **Test procedures for SCF controls.** Options, which can combine:
   - *(a)* One editable procedure scaffolded per assessment objective: objective quoted verbatim, type and sampling set by rule, no AI.
   - *(b)* AI assist that sees only our consolidated evidence text and the tenant's evidence names — never SCF text.
   - *(c)* Import NIST SP 800-53A assessment procedures (public domain) for the roughly 3,470 objectives that trace to 800-53A.
2. **Scope of the licence fix.** Close all six leaks now (this changes existing AI features for SCF controls), or only the testing path.
3. **Self sign-off.** Both tenants have one active user. Either allow it, labelled not independent and never counted as independent review, or block it.

## 8. Phases

| Phase | Delivers |
|---|---|
| **0 — Blockers** | SCF→LLM guard (scope per decision 2) · the OCR thread call that never runs from workbench and catalog uploads (`workbench.py:1640`, `groups.py:2979` omit `tenant_slug`), which starves the matcher of text · hand-made evidence links recorded as AI-made (`created_by_ai` defaults True) · recorder truncating status to 10 chars against a 20-char column |
| **1 — Read side** | The tab: summary, objectives, automated evidence, evidence checklist with artifact status · link, unlink and upload against an artifact · suggestions |
| **2 — Procedures** | Generation per decision 1 · manual CRUD · per-step expected and actual result · objective linkage · the "Regenerate" crash once samples are attached (FK with no cascade) |
| **3 — Sampling and conclusion** | Test record with population, frequency and selection · sample items with results · conclude · sign-off with lock and the independence rule · write-through to `SCFControlState` · the assurance scorecard counting only `status='active'` items, so tested catalog controls never appear |
| **4 — Later** | NIST 800-53A import (if chosen) · model rerank of suggestions · binding artifacts to specific checks |

**Data model changes are additive only** (`_COLUMN_ADDS` plus one new table):
- New table `grc_control_work_samples`, one row per selected population item.
- Test: population, period, frequency, selection method and seed, tolerable exceptions, conclusion rationale, lock timestamp.
- Procedure: objective id(s), expected result, result, result note, tested by / at.
- Evidence links: the artifact key, on `ControlWorkEvidence` and `EvidenceControlMapping`.

## 9. Recorded, not in scope

These are real, but off this path:
- The automation control page's History tab always renders empty (response shape mismatch).
- Custom-control detail pages crash on `related: []`.
- The workbench domain cache is shared across tenants.
- Name and description edits on framework controls are discarded.
- The catalog's Risks tab reads the wrong link table for normalized controls.
- Evidence staleness has no scheduled job.

---

## 10. Outcome (built 2026-09-16)

**Decisions taken:** procedures by all three routes (a + b + c) · close every licence leak, not only the testing path · self sign-off allowed, recorded as not independent.

**Phase 0 — blockers**
- **Licence guard** (`services/licence_guard.py`). The audit found far more than six paths: AI mapping, comparison, inheritance, baselines, regulatory feeds, risk treatment and bow-tie analysis also sent SCF text. Every AI feature now keeps SCF rows out of its corpus or withholds their wording, across 14 modules. Behind them, the OpenAI client shim refuses any prompt carrying SCF wording.
  - Measured: every single-control SCF prompt refused (1,534 of 1,534); no consolidated artifact (0 of 8,880) or framework-library text (0 of 11,727) refused.
- **AI evidence assessment** saved its parse-failure fallback as a real assessment (summary text, score 50). That text produced false library suggestions. It now returns 502 and saves nothing; the bad rows were cleared.
- OCR now runs for workbench and catalog uploads; hand-made links are recorded as human; the recorder's status cap matches its column.

**Phases 1–3 — the tab** (`modules/automation/assurance.py`, `evidence_match.py`, `testing_rules.py`)
- The tab's sections: summary · objectives · evidence checklist with artifact state · procedures · testing and sign-off · automated results.
- Suggestions are deterministic, strongest signal first: the same artifact linked on another control, then the crosswalk, then text. Two-letter terms count only in file names.
- Designation written on sign-off:

  | Latest reviewed tests | Designation |
  |---|---|
  | Any ineffective | deficient, whoever reviewed |
  | Design and operating effective, reviewed independently | satisfactory |
  | Design and operating effective, self-reviewed | not_assessed |
  | Anything else tested | partial |

- A signed-off test is locked (409 on edit). An exception needs a note; overriding the suggested result needs a rationale.

**Phase 4 — NIST SP 800-53A** (`tools/build_nist_53a.py` → `seed_data/nist/sp800_53a.json`, 1.7 MB)
- Built from NIST's OSCAL catalog, Rev 5.2.0.
- 4,490 of 4,490 SCF citations resolve. 3,470 of 5,956 SCF objectives now carry a procedure, across 787 controls.
- Each step shows, collapsed, what to examine, whom to interview and what to test.
- The seed test caught 63 statements with a parameter nested inside a selection left unrendered; fixed.
- **Kept strict on purpose:** 1,353 of 13,292 800-53A texts share wording with SCF objectives, so the guard would refuse them in a prompt. No feature sends NIST text to a model today. If one is added, subtract 800-53A text from the fingerprints, as framework libraries already are, and accept that SCF objectives copied from 800-53A are no longer caught.

**Not built:** model rerank of suggestions; binding artifacts to specific checks. The §9 items still stand.
