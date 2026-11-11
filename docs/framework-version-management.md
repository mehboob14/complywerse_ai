# Framework version management for onboarding: design

Written 2026-11-12 on branch `claude/competent-lehmann-398b30` (onboarding merged from `claude/quirky-bardeen-ee8491` @ `dcbef95b`). Plan sections 2, 3, 6 and 7 of `docs/framework-onboarding-universal-plan.md` call this phase "not built". Not applied to the main checkout, not pushed.

The rule that shapes everything: **a version change flags and asks. It never rewrites an approved snapshot, an answer, an assessment or evidence.** Onboarding stays a separate stage from compliance work: nothing here writes a control status.

## 1. What the code holds today (read, not assumed)

| Where | What it holds | Note |
|---|---|---|
| `UploadedFramework.version` (String 50) and `.name`, `.effective_date` | The framework library row. Seeded from `seed_data/frameworks/<file>.json` `metadata.version`. | The authority for "which version does the library hold". |
| `seed_frameworks.seed_framework_from_json(force=True)` | Deactivates every row of the same name (`is_active = False`) and creates a **new** row. | So a new library version is a **successor row**; journeys and onboardings stay on the old row. Today the register lists active rows only, so the approved onboarding of the replaced row silently drops out of the register. |
| `crosswalk_registry.json` | `scf_version` ("2026.2") and per slug the SCF source edition (`scf_keys`). | About the crosswalk, not the library. Editions differ in four places: CIS `cis_csc_81` (library v8.0), SWIFT `swift_cscf_2025` (library v2024), SAMA `sama_csf_2017` (library 2023), NIST 800-171 `r2` (SCF also carries R3: registry decision D2). |
| `frameworkFlows.ts` `version` per journey flow | Display text on the journey. | Agrees with the library after stripping `v` and wording ("v4.0.1" and "4.0.1", "Regulation (EU) 2022/2554" and "EU 2022/2554") for 33 of 34 frameworks. **One real contradiction: NIST CSF, library 2.0 (rebuilt from the CSF 2.0 Reference Tool, label "NIST CSF 2.0") and flow 1.1.** The flow's phases may be written for 1.1; changing the number alone would misstate them, so it is reported, not edited. |
| `FrameworkOnboarding.catalog_version` | The one number "the shipped catalog" had at creation and at approval (a max over the JSON files, `1` everywhere). | Too coarse to say which framework's questions changed, and it says nothing of what changed. |
| `snapshot` JSON | Answers, picked organisation rows, existing items, `catalog_version`, `approved_at`. | Frozen. It does not record the framework version or the shape of the questions. |
| Catalog answers that already name a version | `basis.revision` (NIST 800-171: Rev 2, Rev 3, Contract does not say), `regime.ecc_version` (NCA ECC: ECC-2:2024, ECC-1:2018, Not sure), `sabic_standard`. | The organisation's declared version. For catalog-only frameworks (NCA) the library holds nothing, so this answer is the only version there is. |
| Notifications | `send_workflow_notification` (in-app bell row with a link, optional email), used by governance, ownership and TPRM. | Reused as is. |

## 2. What counts as a version change

An approved (`complete`) or `underway` onboarding is compared with a **baseline** taken when it was approved. Any of these makes it **needs review**:

1. **Library version.** The row's `version` string differs from the baseline, or an active row of the same framework (same slug) that is newer exists (a successor), or the row was deactivated.
2. **Controls.** The control texts of the row (or of its successor) differ from the baseline fingerprint: controls added, removed or reworded.
3. **Shipped questions.** The questions this framework asks changed: a field removed or added, an option list changed, a field type changed, a `when` rewritten, a gate check changed, or the effective version key changed so that version-specific questions appear or disappear.
4. **Declared against held.** The organisation answered a version (for example Rev 2) and the library now holds a different one (Rev 3): the answer is not wrong, but it needs a decision.

A draft or ready onboarding is not tracked: it is answered against the current questions anyway.

## 3. Data (additive only)

One new table, `grc_fw_version_baseline` (`models/_95_framework_onboarding.py`, self-creates; no column added anywhere else, nothing dropped):

```
id, tenant_id, onboarding_id (unique), framework_id (the row it was taken against), framework_name,
library_version (the string), version_key (the effective key, may be null), declared_answer (the answer text, may be null),
catalog_version, signature JSON, controls JSON {control_id: short hash}, controls_count, taken_at, taken_by,
source (approval | first_check | review), history JSON [{taken_at, source, library_version, version_key}],
notified_change_id, notified_at
```

- **Taken at approval** (`approve()`), so a new approval starts a new baseline. **Taken at first check** for onboardings approved before this existed or marked underway: honest about what it is (`source = first_check`, shown as "tracked since"): changes before it cannot be listed.
- **Moved on review** (outcome "still correct"): the old values go to `history`; the approved snapshot, the answers and the events are untouched.
- `signature` is the compact shape of the questions at the baseline: per `step.field` the label, type, level, options, `when`, `min_rows`, column keys; per gate check its key, level, `when` and check. That is what makes "which answers are stale" exact instead of "the catalog changed".

## 4. Detection

- `versioning.status(db, ob, deep)` is **pure reading**: baseline against now. A GET never writes (the onboarding rule).
- `versioning.check(db, tenant_id)` is the writer, idempotent: takes missing baselines, and for each onboarding that needs review and has not been notified for this exact change (`change_id`, a hash of the change) notifies the program owner and records the event `version_change`. It runs (a) at first connect of each tenant database after the legacy backfill (a deploy or a library re-seed restarts the backend), and (b) from `POST /compliance/framework-onboarding/version-check` (button "Check for changes" on the register).
- Register rows use the cheap form (version string, successor, catalog signature, control count and last update); the onboarding view uses the deep form (control by control).

## 5. What "needs review" lists (exactly)

- **Answers now stale**, each with its reason: the field was removed, its type changed, a chosen option is no longer offered (the option is named), or it is no longer asked because its `when` no longer holds (the new condition is written in words).
- **Applicability decisions now stale**: a decision is an answer that another question's `when` or a gate check reads, or any field of the common Applicability step. It is stale when it is itself stale in the above sense, or when the same answer now asks different questions (the dependents that appear or disappear are listed). The declared-against-held case (point 4) is a decision.
- **New questions**: asked now, not before, unanswered (required ones first).
- **Controls**: added, removed, changed (reference and title, first 30).
- **Impact** (reading only): the journeys on the row with their status; how many of their controls are in the changed or removed set, by implementation status; how many evidence files are attached to those; what is kept (compliance snapshots, history) and that none of it was changed.

## 6. Who is told

The program owner: the person answered at Ownership > Owner, plus the coordinator and the approver when they are platform users; if none is a platform user (all named externally, or none), the person who approved and the person who started it. One in-app notification (`warning`, link to `/frameworks/onboarding/{id}`; email follows the organisation's setting) per distinct change; the event row records who was told, or that nobody could be.

## 7. Review: what a person decides

`POST /compliance/framework-onboarding/{id}/version-review` `{outcome, note}`. Every outcome is an event on the onboarding (`version_reviewed`), kept with who and why.

| Outcome | Effect | Who |
|---|---|---|
| `confirmed` "Still correct" | Baseline moves to now; the flag clears; the old baseline goes to `history`. Note of at least 10 characters. Answers and snapshot untouched. | the approve right |
| `changes_needed` "Reopen to change" | The onboarding is reopened exactly as an ordinary reopen (draft, answers editable); the flag stays until it is approved again, which takes a new baseline. | the override right (the reopen right) |
| `start_new_version` "Start for the new version" | Only when a successor row exists. A **new draft onboarding on the successor row**: answers carried where the field still exists with the same type and the answer is still a valid option, the rest listed as not carried. The old onboarding stays approved and is marked superseded; both get an event. | the edit right |

## 8. Questions that apply to a framework version

- A catalog framework entry may carry `versions`: `{"answer": "basis.revision", "list": [{key, label, library: [strings the library holds], answer: "text of the option", confidence}]}`. Only versions the library holds or the catalog already names as answer options are listed; nothing is added from memory.
- `when` may read the virtual field `fw.version`: the effective version key, which is the key of the answered version when the entry names an answer field and it is answered, else the key matched to the library row's `version`, else nothing (no version-specific question is asked). The validator checks every value against the entry's keys and refuses `fw.version` on a framework without a `versions` block.
- Real use: NIST SP 800-171, library Rev 2 (verified: the library says so), Rev 3 as answer only (unverified): one Rev 3 question about organisation-defined parameters, source marked unverified. NCA ECC: edition from the existing "ECC version" answer (both options unverified, as the catalog says); for ECC-1:2018 one plan question "Move to ECC-2:2024". No requirement text is invented: the questions ask about the organisation's plan or decision, and say where the claim came from.

## 9. Screens

- Onboarding workspace: a banner under the heading when needs review (what changed in one line, "Review changes"), the review dialog (changes in plain words, stale answers by step with a jump to the field, decisions, new questions, controls, impact, the outcomes and the note), "Tracked since" when the baseline came from a first check, and a notice on a superseded onboarding that links to its successor.
- Register: a pill "Needs review" or "Superseded" next to the state, a count chip, the "Check for changes" button; a replaced row stays listed (it was dropping out).
- Words follow rule U1: no ids, hashes or version-key codes on screen; versions as the library writes them.

## 10. Not built, and not verified

- Re-assessment of controls, evidence refresh or a migration of control implementations onto a successor row: a version change here only lists them; moving compliance work is the next stage (plan phase 4).
- Notifying journey stage owners (only the onboarding's program owners are told).
- Verifying that a library's `version` string is what the issuing body calls it (needs the source texts); the questions added for Rev 3 and ECC are marked unverified.
- Re-approval replaces `snapshot` (the existing approval code): the earlier approval survives only as events and the baseline `history`.
- The control comparison is by the library's own control ids and text; a successor that renumbers every control shows as all removed and all added.

## 11. Build record (2026-11-12, branch `claude/competent-lehmann-398b30`, not applied, not pushed)

- **Built**: sections 2 to 9 as designed. One difference from the text above: the register row keeps `version` (the library row's version text, as before) and carries the new dict as `review`; the onboarding view has `version` (the status) and `framework_version` (the text). The words say "a later entry" (never "a newer version") unless the library deactivated the old row, because the server cannot know that a later entry is a higher version. A first check measures against how things stand now, so an old condition is not reported as a change.
- **Checked**: 28 new backend tests (`tests/test_framework_version_management.py`: exactness of stale answers and decisions for a removed option, a removed question, a changed kind, a `when` that no longer holds; baseline at approval; owner notified once; first check; confirm, reopen and start-for-later-entry as events with the rights each needs; impact on journeys, implementations and evidence with nothing changed; a GET never writes; the `fw.version` validator; the library, flow and catalog versions agree except the one recorded NIST CSF contradiction); the onboarding, AI registry, audit coverage, workflow catalogue, UAE IA, assessment scoping and departments suites together: 291 passed. Frontend: 9 new node tests for `versionModel`, 1 for the register; the onboarding folders, `uxContent`, the kit and the layout tests: 531 passed; `tsc` at the 31-error baseline.
- **Browser** (whole app on a PostgreSQL scratch stack, own databases and ports, torn down afterwards): the register (pill, "Needs review" filter, "Check for changes", last checked), the banner and review dialog for a replaced library row with changed controls and a journey with evidence (4 of 93 controls on changed ones, 2 evidence files kept), the declared-against-held decision for NIST SP 800-171 (answer Rev 2, library Rev 3), start for the later entry (all five required answers carried, the earlier onboarding marked superseded and unchanged), the refusal of "Reopen to change" for a person without the reopen right, and, with the shipped catalog temporarily edited (reverted, never committed), an approved onboarding whose answer was no longer among the choices and whose question was removed (listed as stale answers and decisions, with a note under the field). Desktop and 375 px: no horizontal overflow; the start-up check ran after each backend restart and told nobody twice.
- **Not checked**: axe on the new dialog; the whole backend and frontend suites; a real mail server (the in-app notification was written; email is skipped when none is set up); two workers racing the start-up check (the claim is one conditional UPDATE, tested only in sequence).
