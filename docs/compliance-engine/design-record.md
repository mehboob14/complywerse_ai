# Compliance test engine — design record

Produced 2026-09-09 by a 23-agent run: three independent designs, three adversarial
judges, per-domain authoring with a verification pass over every spec. Numbers below
were re-verified by hand against the code before this was written.

## Decision

**A test is data, not code: one JSON dialect where every test is `population (selector + optional join) → predicate → aggregation`, authored into the CompliancePlugin row that already exists, so a compliance engineer writes all 20 scenarios without touching Python — and the two things declarative genuinely cannot carry (payload parsing, human artifacts) get named escape hatches rather than an `eval` field.**

Two of three judges chose it. The third preferred the reuse-first design, which scored
highest on not duplicating existing schema and lowest on scenario coverage. The grafts
from the losing designs are recorded at the bottom and are not optional.

## Check spec

One test = one JSON object in `CompliancePlugin.check_definition`. Collection stays where it is: the 170 `resources` blocks in grc/seed_data/evidence/connector_checks.json are unchanged and become collection-only; `checks` moves out into these test objects, which address resources fully-qualified as `provider:resource` or `category:resource`.

```json
{
  "spec": 3,
  "id": "vpm.critical_remediation_sla",
  "title": "Critical vulnerabilities are remediated within the defined window",
  "scf": ["VPM-05"], "ao": ["VPM-05_A16"], "soc2": ["CC7.1"],
  "severity": "high", "method": "TEST", "cadence": "Quarterly",

  "population": {
    "from":  {"resource": "security:findings", "across": "all"},
    "where": {"and": [["severity", "in", ["critical"]], ["state", "ne", "resolved"]]},
    "empty": "not_applicable",
    "join":  null
  },

  "assert": {"all": ["date:first_seen", "within", "{{param:remediation_window}}"]},

  "params": {
    "remediation_window": {"_": "30d", "cis_controls": "15d", "pci_dss": "30d",
                           "sdp": {"ao": "VPM-05_A16"}}
  },

  "item_name": "title",
  "fail_msg": "Critical finding open longer than the remediation window"
}
```

**Grammar — three layers, each ~20 lines of engine.**

*Predicate* (a tree, evaluated per row):
- leaf `[field, op]` or `[field, op, value]`
- `{"and":[…]}` `{"or":[…]}` `{"not": node}`
- `{"exists": {"in": "<nested list field>", "where": node}}` — quantifier over a list attached to the row; inside it `{{row.x}}` refers back to the outer row.

*Ops*: the nine in `_op` (evidence_engine.py:170-198) plus `gte`, `lte`, `matches`; plus four temporal — `within`/`older_than` (a parsed timestamp vs now, duration strings `15d`, `90d`, `12mo`) and `before`/`after` (timestamp vs timestamp or `{{row.field}}`). Timestamps parse once at normalization via a new `date:` prefix beside the existing `!` / `len:` / `bool:` in `_resolve_field` (:58-69) — six lines there and four in `_op` make 34 already-collected timestamp fields live.

*Aggregation* — the eight required operators, all as `assert`:
| operator | spec |
|---|---|
| ALL | `{"all": <pred>}` |
| ANY / EXISTS | `{"any": <pred>}` |
| NONE | `{"none": <pred>}` |
| COUNT / THRESHOLD | `{"count": ["gte", 1]}` (replaces `min_count`/`max_count`) |
| THRESHOLD as proportion | `{"ratio": ["gte", 0.95, <pred>]}` |
| TEMPORAL | not an aggregation — an op inside the predicate |
| CORRELATION | not an aggregation — `population.join` |
| (inventory) | `"evidence_only": true` — emits `info` rows, never a verdict |

*Join* (correlation), on the population, at most one:
```json
"join": {"with": {"resource": "identity:users", "across": "all"}, "as": "idp",
         "on": {"left": "work_email", "right": "email", "normalize": "lower"},
         "mode": "left", "unmatched_left": "fail"}
```
Left rows keep `{"idp": {…}|null}`; the predicate addresses `idp.active`. `unmatched_left` ∈ `pass|fail|error` makes "no matching row" an authored verdict instead of a silent inner-join drop. Independently: both sides non-empty and matched == 0 → status `error`, `reason: "join_empty"` — the broken-join outcome the current vocabulary has no word for, recorded in `join_matched`/`join_unmatched_left`.

*Empty population*: `population.empty` ∈ `pass | fail | not_applicable | error`, **required, no default that guesses**. This is where scenario 2 and scenario 20 live, and it removes the `max_count` vacuous pass at evidence_engine.py:241-245 by making the author state what zero means. It borrows the idea already shipped in the sibling engine — `absent_is` in cloud_transport.py:259-263.

*Parameters*: `{{param:x}}` in any value position, resolved in the order the framework-linkage survey established — `SCFControlState.defined_parameters` (human override, widened from `{ao_id: v}` to `{ao_id: {"_": v, "pci_dss": v}}`, JSON column, no migration) → the framework requirement via `SCFMapping` filtered to `SCFScope.framework_slugs` → `SCFObjective.defined_parameters` selected by `rigor` vs `SCFScope.target_cmm` → the spec's own `_` default. The test is evaluated once per *distinct resolved value*, over one collection, writing one `SCFCheckResult` per value keyed by `param_key`.

*Nested collection*: `for_each` gains `"attach": "reviews"` — child rows nest on the parent row instead of flattening with a `_parent` label (evidence_engine.py:163-165). Absent = today's behaviour, so all 31 existing `for_each` resources are untouched. This one key is what makes `exists` over per-row children possible, and therefore scenarios 4, 15 and 19.

## Connector substitution — the "connect at least one" question

The category is not the unit of substitution — the test declares its own. `population.from.across` ∈ **`authoritative` | `all` | `any`**, and it replaces the inference at grc/modules/automation/router.py:449-453, which today flips a control to `covered` when ANY provider in ANY bound category is connected (which is how connecting Semgrep alone greens every CC8.1 control, and connecting Qovery greens incident response via `qovery.org_admin_contact`).

Resolution produces a **slice per contributing connection**, each with its own verdict and its own `SCFCheckResult` row; the test verdict is the roll-up over slices:

- **`authoritative`** — exactly one named provider (or one connection of it) is the source of truth. Not connected → `connect_one`, never `fail`. Connected with 0 rows → whatever `population.empty` says. Scenarios 1 (MFA is an IdP question, not the AND of 40 SaaS apps), 2, 9.
- **`all`** — every connected provider in the set that declares that resource contributes a slice, and **every non-NA slice must pass**. Verdict = worst non-NA slice; all slices NA → NOT_APPLICABLE. Scenarios 6 and 20 fall straight out of this. Coverage stops being a boolean: `{"satisfied_by": ["github"], "unproven": ["gitlab"], "not_connected": ["bitbucket"]}` — "connected but not yet proving anything" becomes a visible state, which it is not today.
- **`any`** — slices are genuine alternatives, verdict = best slice. This is the only mode where today's behaviour is correct, and per the connector-capability survey it is honest for exactly three cases: incident (pagerduty ≡ opsgenie for CC7.4), the SAST subset of security (semgrep ≡ snyk ≡ sonarcloud), and the `count ≥ 1` core of observability.

Two predicates decide which mode an author picks — same assertion AND same population. scm and mdm fail on population (GitLab says nothing about repos on GitHub; jamf and kandji are both Apple-only, so "connect one MDM" leaves every Windows endpoint untested) → `all`. hr, email, cloud, comms, productivity, ai fail on assertion (bamboohr and rippling share one control code and zero check semantics) → the test names its provider, `authoritative`. itsm/crm/data/payments have one member, so the category axis adds nothing.

Where "any one" is actively wrong and the model must say so: **MFA connectors are additive, not alternative.** CC6.1 is emitted by 52 providers across 14 categories, each over its own user population. Treating them as alternatives lets one connected IdP mask untested MFA in every SaaS app. Under this model an MFA-at-the-IdP test is `authoritative` on the IdP (scenario 1), and per-app MFA is a *separate* `all`-mode test over the SaaS estate — two tests, two verdicts, no pretending one implies the other.

A provider connected but returning zero rows is **NOT_APPLICABLE for that slice, never PASS and never FAIL** — that is scenario 20 exactly, and it is enforced by `population.empty` being mandatory rather than by the engine guessing.

## Migration

**No flag day. Three additive steps, each shippable alone.**

1. **Collection and assertion split, in place.** `grc/seed_data/evidence/connector_checks.json` keeps its 170 `resources` blocks verbatim — they are the collection layer and nothing about them changes (including the 31 `for_each` blocks; `attach` is opt-in). Only the 239 `checks` entries move.

2. **Lift the 239 checks mechanically.** A ~40-line one-shot script emits one v3 test per check: `population.from = "<provider>:<resource>"`, `across = "authoritative"` (correct by construction — every existing check names one provider), `where` = the old `skip_if_field_true` as `[[field,"falsy"]]`, and kind → assert:
   - `all_true` → `{"all":[f,"truthy"]}` (74) · `all_false` → `{"all":[f,"falsy"]}` (11)
   - `all_match` → `{"all":[f,op,v]}` (24) · `none_match` → `{"none":[f,op,v]}` (34)
   - `min_count` → `{"count":["gte",n]}` (52) · `max_count` → `{"count":["lte",n]}` (12)
   - `present` (32) → `"evidence_only": true` — **deliberately not liftable to a verdict.**
   `empty` cannot be derived and must not be guessed: the script writes `"empty": "REVIEW"` on all 239 and the engine treats `REVIEW` as ERROR with detail "empty-population behaviour unauthored". That is 239 one-word decisions by a compliance engineer, and it is the entire fix for the vacuous-pass class of bug. Ship it as a review queue, not as a default.

3. **Both control indexes live simultaneously.** Each lifted test keeps `soc2: ["CC6.1"]` exactly as the check carried it, so `_checks_for_control` (grc/modules/automation/router.py, matching on `controls`) and `_coverage_for` keep working with a one-line change to read `soc2` instead of `controls`. `scf`/`ao` start empty. Seeding a default SCF binding is free — `NormalizedControl.scf_id` is populated for all 1,534 rows and `PluginControlMapping.normalized_control_id` already joins to it — so every test gets a crosswalk-derived `scf` list tagged `binding_source:"crosswalk"`, which a human promotes to `"authored"` when they attach the real `ao_id`. Nothing is blocked on the SCF binding being finished, and the SOC 2 path never regresses.

**The current SOC 2-criterion binding.** It survives untouched as the `soc2` key. The 15 criteria named by any check today reach 145 controls and the path caps at 288; that number does not move on migration day and is not supposed to. What changes is that a test can now *also* name an `ao_id`, which is the only way the 5,956-objective denominator ever gets a numerator — `SCFCheckResult.ao_id` exists for exactly this and is never written.

**Runner coexistence.** `runner_type='evidence_v3'` is a new value in a column that already dispatches by string, alongside `live_api` and `aws_readonly`. `run_provider` (live_api_catalog.py:~346) keeps calling `run_connector_checks` for any provider with no v3 tests yet, so connectors migrate one at a time. When the last provider is lifted, `_eval_check`'s kind dispatch (evidence_engine.py:236-271) is deleted, not maintained in parallel.

**AWS is the forcing function for the second dialect.** `cloud_transport`/`aws_runner` speak a different vocabulary over raw boto3 dicts — `all_items_field_equals` is `all`, `no_items_match` is `none`, `field_gte` is `["f","gte",v]`, and `absent_is` is `population.empty` under another name. AWS becomes a *transport* that yields normalized rows into the same `provider:resource` namespace, and its 8 expectation kinds lift by the same table above. That also reconciles the double-counted AWS capability: the 10 `SOC2_QUANTITATIVE_v1` plugins and the 6 `CLOUD_CHECKS` overlap on 4 checks and bind by different mechanisms; lifting both into one namespace makes the duplicate visible and deletable — including the CC6.8 check asserting no security group is named `default`, which is true of no real AWS account.

**Numbers move, and that is correct.** Reported coverage falls on migration day: 32 `present` checks stop contributing PASS, `REVIEW` empties read as ERROR until authored, and `across:"all"` splits categories that today report covered on one connection. Announce the drop as a correction, because the alternative is the property the engine's own docstring at evidence_engine.py:213-220 warns about — coverage that rises when a connector is added and never falls when a control breaks.

## Known weaknesses of the chosen design

- This is a small expression language, and small expression languages grow. `exists` over a nested list plus `{{row.field}}` back-references plus and/or/not is already most of a query language; two more feature requests and it is a bad one. The line I would hold and write into the authoring docs: no arithmetic, no aggregation inside a predicate, at most one join per test. When someone needs a 95th-percentile patch age, the answer is a Python plugin, not a `percentile` op.
- There is no escape-hatch `expr` field and there should not be — an `eval()` in a JSON column is where this design dies. But that means the honest escape hatch is 'write a `runner_type='python'` plugin', and nothing in the design makes that pleasant. A Python plugin must write the same SCFCheckResult rows or it is a second-class citizen that silently skips the population/provenance discipline, and I have not specified that contract.
- Nothing validates a spec against a provider's actual payload. `_op` returns False for an unknown operator (evidence_engine.py:198) and swallows TypeError into False (:184-188), so a typo'd field name or a provider returning `"30"` where the spec expects 30 produces a confident FAIL, not an error. The single highest-value authoring tool is `dry-run this spec against the last collected rows` and it is not in the shortest diff. Without it, declarative authoring at scale produces confident wrong answers faster than the old way did.
- `across:"all"` unions populations across providers with no identity resolution. A person in both Okta and Google Workspace is two rows; a repo mirrored to GitHub and GitLab is two rows. Counts in `population_size` will be inflated and per-row findings duplicated. Deduplication needs a join key the design does not define.
- Join quality is a heuristic. Lowercased email for HRIS↔IdP is defensible; hostname for MDM↔EDR is asserted from general knowledge, not from reading the kandji/jamf/sentinelone field maps or a live payload. `join_matched`/`unmatched_left` make the damage visible rather than preventing it, and a `join_empty` ERROR will fire on real tenants for boring format reasons before it ever fires on a real control failure.
- The spec can express temporal and correlation tests before any connector can supply the data. 10 of 12 event-shaped resources discard their timestamps in the field map, no SCM connector collects PRs, reviews or merges, and no connector in any of the 16 categories supplies badge/physical-access data at all. Scenarios 4 and 15 are field-map work first; shipping the grammar without the field maps produces a lot of authorable tests that immediately report ERROR.
- Parameter fan-out multiplies result rows by distinct values (up to 4x on MON-10), and I deliberately refused a monotonicity rule — 'minimum password age 1 day' and 'not one of the last four passwords' are not orderable against a length or a window, so strictest-wins would silently pick wrong. Evaluating every distinct value is correct and more expensive, and PCI cannot use it yet anyway: 106 of 205 PCI requirement texts in the seed library are lead-ins ending in ':' with the numbers lost, so the parameter registry has to be hand-authored for half of PCI.
- None of it fires on its own. There is no scheduler for compliance plugins — `schedule_cron` and `PluginScheduleOverride` are stored, validated and displayed and read by no runner, Celery beat has no compliance job and the Dockerfile starts no worker or beat process. PASS→FAIL transitions, `expires_at` and `next_due_at` are all inert until something calls `execute_plugin` periodically. The runnable seam is one more `_check_*` beside the three in `poll_threshold_events` (workflow_engine/services/trigger_dispatcher.py:476-499), and its 'already ran today' state must be a persisted column, not the in-process memo the existing checks use, because uvicorn runs 2 workers and each has its own runtime thread.
- Migration day makes the numbers worse. 32 `present` checks stop contributing PASS, 239 `REVIEW` empties read as ERROR until a human authors them, and `across:"all"` splits categories that currently report covered on one connection. Every one of those is a correction, but a customer sees a coverage drop, and there is no story here for how that is communicated.
- `requires_artifact` is the weakest part. It names an ERL row and asserts an in-date linked evidence artifact exists, which is presence-checking a human process — the same inventory-as-pass pattern the design removes from `present`. It is better than pretending scenarios 7, 13 and 18 are automatable, but it is not a test, and it should probably emit a distinct status rather than PASS.
- Two SoAs will exist. `ClauseApplicability` already backs a Statement of Applicability the auditor portal renders, and `SCFControlState` mirrors its approval trail for the SCF scope. Which one the auditor portal reads is an open decision that this design assumes away.
- I have not measured how many of the 145 currently-reachable SOC 2 controls depend on a `present`-kind check as their only evidence. That number is the true size of the migration-day coverage drop and it should be computed before shipping step 2, not after.

## Grafts from the designs that lost

- From C — the migration shim. Replace B's `"empty": "REVIEW"` -> ERROR on 239 checks with C's `empty_means: "legacy"`, which reproduces today's exact per-kind behaviour on an empty set (max_count->pass, min_count->fail, offender kinds->not_run). Step 1 then changes zero behaviour and is verifiable against the existing DB-free self-check at the bottom of evidence_engine.py. Drain the 239 authoring decisions per check as each is touched, not as a release gate.
- From C — PARTIAL as a first-class coverage state with a named gap, driven by `authority: sole|partial` + a `covers` predicate. B's `across:"all"` still reports covered when jamf and kandji are both connected and both Apple-only, leaving a Windows fleet untested behind a green control. "Connected but not proving anything about this slice of the estate" is a state neither B nor A can currently name, and it is the single best idea in the batch.
- From C — the `kind` indirection itself, at least as a rename. B's `across` conflates the fan-out rule with the resource address (`okta:users` + `across:"authoritative"` is redundant; `okta:users` + `across:"all"` is undefined). Split them: address the population by kind, declare substitutability separately. C got this right and B did not.
- From A — `provider: "internal"` as a first-class row producer over local tables. Verified the columns exist: AccessReviewCampaign.status/closed_at/period_end/population_size/exceptions_found (_40_access_review_models.py:33,44,36,53,63) and Vendor.tier / VendorAssessment.inherent_tier (_35:15,137). This turns scenarios 7, 16 and 18 from `requires_artifact` presence-checks into real population tests, and generalises the `asset:inventory` special case B already invented for scenario 10.
- From A — the String(10) diagnosis is B's, but A's `sources`-vs-`connector` reasoning is the better version of B's `provenance`: keep the singular indexed `connector` column meaning the POPULATION provider so ix_scf_check_connector stays correct, and let the JSON column carry the rest. Adopt A's wording of the invariant explicitly, or the index quietly stops answering "which controls go dark when Okta is revoked".
- From A — drop `param_key`. No scenario in the 20 needs two thresholds resolved simultaneously on one control. SCFControlState.defined_parameters is already a JSON column with no readers, so the key space widens from {ao_id: v} to {ao_id: {"_": v, "pci_dss": v}} with zero migration on the day it is genuinely needed.
- From A — the two `_status_from_run` bugs, which B never mentions and which will make B's new statuses lie. (1) automation/router.py:399-400 returns collection_failed on a run-level error BEFORE filtering to the control's own findings at :404-407, violating that function's own docstring — one 403 on /orgs marks all four GitHub controls failed. (2) :415-419 tests membership of fail/error/pass and never not_run, so a not_run finding is outvoted by a passing sibling. Both are one line, both must land in the same pass as the NA branch.
- From A — Issue.source_id = SCFControlState.id (Integer, unique on tenant+scope+scf_id at _56:320-321). SCFCheckResult.id spawns a fresh issue every run and a text scf_id will not fit an Integer column. B says the same thing less explicitly; keep A's phrasing.
- From A — delete `qovery.org_admin_contact` (a PaaS org having an admin email satisfying CC7.3) rather than migrating it, and audit the bindings before quoting any coverage ceiling. B's mechanical 239-check lift would carry the mis-binding forward intact.
- From B, keep and do not trade away: `evidence_only: true` for the 32 `present` checks (they are inventory, not verdicts — A and C both leave them contributing PASS), and `for_each.attach` + `exists` + `{{row.*}}`, which is the only reason any of the three designs can express scenario 4.
- From D1: DROP param_key entirely. Framework-divergent thresholds are not in the 20 scenarios; when they arrive, widen SCFControlState.defined_parameters from {ao_id: v} to {ao_id: {"_": v, "pci_dss": v}} — already a JSON column with zero readers, so zero migration. Cuts D2's schema delta from 5 changes to 3.
- From D1: fold join_matched/join_unmatched_left into the `provenance` JSON D2 is already adding. Two Integer columns storing a fact the JSON already carries per side is the same value twice.
- From D1, the single most valuable graft: _scf_targets(check) → [(scf_id, ao_id)] as migration step ZERO. Resolve today's controls:["CC6.1"] through SCFSource('AICPA TSC 2017:2022 (used for SOC 2)') → SCFMapping → scf_id with ao_id=NULL (the whole-control claim the column already documents at _56:350). SCFCheckResult starts filling on day one with zero spec edits, before any of the 239 rewrites. D2's plan has no result-writing until step 2.
- From D1: expires_at = collected_at + _CADENCE_DAYS[SCFControl.conformity_cadence] computed PER RESULT, not per run — one connector run today stamps checks belonging to controls of three different cadences with one timestamp.
- From D1: keep the per-category substitutability audit verbatim as the authoring doc for choosing across-mode. Only 3 of 16 categories pass both predicates (same assertion AND same population); 4 categories have one member; the disjoint-assertion list (bamboohr vs rippling sharing a category and zero check semantics) is the load-bearing argument and D2 states it more thinly.
- From D1: require/each_connected/any_connected/named is clearer naming than across/all/any/authoritative. Cosmetic, but 'authoritative' reads as a quality claim rather than a cardinality rule.
- From D3, reduced to reporting only: authority sole|partial + a `covers` predicate, surfaced as the unproven/not_connected list on the coverage payload (which is already D2's satisfied_by/unproven/not_connected shape) — but it must NEVER gate a PASS, because its estate input is circular and `covers` is an unverified hand-authored claim. As a named gap ('Windows endpoints unproven — kandji covers platform=apple only') it is honest; as a verdict it is confidently wrong in both directions.
- From D3: a `num:` cast prefix in _resolve_field beside the existing !/len:/bool:. A provider returning "1.2" as a string makes gt raise TypeError, which _op swallows into False at evidence_engine.py:184-188 — a silent confident FAIL on a compliant tenant. Cheapest correctness fix in any of the three.
- From D1 and D3 both: make _op RAISE on an unknown operator instead of the bare `return False` at evidence_engine.py:198, which turns a typo into a confident FAIL today.
- From D3: error_on_zero_overlap as an explicit third join outcome (both sides non-empty, zero keys matched → ERROR/join_empty). D2 has this; D3 names it as a first-class join_quality value, which is the better authoring surface.
- From D1 and D3: fix the two live roll-up bugs in the same pass, one line each — automation/router.py:399-400 short-circuits the whole control to collection_failed BEFORE filtering to the control's own findings (violating its own docstring; one 403 on /orgs marks all four GitHub controls failed), and :1240's last_ok filter .status.in_(("passed","failed")) must include "not_run" or an inventory-only connector reads as permanently failing.
- From D1: SCFControlState.id as Issue.source_id, not SCFCheckResult.id — Issue.source_id is Integer (_12_governance.py:200) so a text scf_id cannot key it, and SCFCheckResult.id spawns a fresh issue every run. D2 says the same; keep D1's explicit reasoning in the doc.
- Keep D2's own best idea unchanged: `population.empty` mandatory with no default, and the migration writing "REVIEW" on all 239 lifted checks with the engine treating REVIEW as ERROR. 239 one-word decisions by a compliance engineer is the entire fix for the vacuous-pass class, and it is the only proposal that refuses to guess.
- From D2 — SCFCheckResult.status must widen String(10) → String(20). Verified at _56_scf_catalog_models.py:352. 'not_applicable' is 14 characters and D1 explicitly (and wrongly) calls this 'a comment change, not a schema change'. It truncates in MySQL and errors in Postgres.
- From D2 — `exists` over a nested child list, plus `"attach": "<name>"` on for_each so children nest on the parent row instead of flattening to a `_parent` label string (evidence_engine.py:160-166). D1's flat where-list only handles scenario 4 by assuming a pre-flattened merged_pulls row that carries approved_at/approver_login; `attach` + `exists` is the honest form and keeps the field map from having to pre-resolve reviewer identity. `attach` is opt-in, so all 31 existing for_each resources are untouched.
- From D2 — an explicit `ratio` aggregation for THRESHOLD. D1 mentions 'COUNT with cmp: {ratio_gte: 0.95}' in one clause of prose and never shows it; take D2's `{"ratio": ["gte", 0.95, <pred>]}` as the written form.
- From D2 — the `"empty": "REVIEW"` migration gate. Lift all 239 checks with empty-population behaviour UNAUTHORED and have the engine treat REVIEW as ERROR with detail 'empty-population behaviour unauthored'. D1 defaults empty_population to not_applicable, which silently guesses on 239 checks; REVIEW turns the vacuous-pass class of bug into a 239-item review queue. Ship it as a queue, not a default.
- From D2 — reuse grc/services/ctem_scopes.py resolve_scope_assets (with ITAsset.criticality/environment/tags) for estate-scoped populations. It is the repo's existing 'subset of the estate' resolver and D1 has no asset-scoping mechanism at all, which is scenarios 5, 10 and 16.
- From D2 — join_matched / join_unmatched_left as INTEGER COLUMNS on SCFCheckResult, not prose in `detail`. An unmatched device IS the finding (scenario 11), so join quality must be queryable by the roll-up. Same argument D2 makes for population_size.
- From D3 — a `num:` cast prefix in `_resolve_field`, beside the existing !/len:/bool:. Verified necessary: `_op`'s gt/lt wrap the comparison in try/except TypeError → `return False` (evidence_engine.py:184-196), so a provider returning "1.2" as a string produces a confident FAIL on a compliant tenant. D1 adds gte/lte and no cast. Also make the unknown-operator fall-through at :198 RAISE instead of `return False` — D1 says this and it should survive.
- From D3 — the coverage tri-state COVERED / PARTIAL / UNCOVERED with a named gap ('Windows endpoints untested — kandji covers platform=apple only'). D1's each_connected produces one result row per connected provider, which is correct, but gives no vocabulary for 'the estate is only partly reachable'. PARTIAL is the state that does not exist today and where most wrong answers live.
- From D3 — `authority: sole | partial` with a `covers` predicate as the JUSTIFICATION for each_connected, not just the assertion of it. D1 declares each_connected the default and argues it well in prose; `covers` is what makes PARTIAL computable rather than editorial. Carry D3's own caveat: covers is a hand-authored claim nothing verifies.
- From D3 — per-tenant scope binding via IntegrationConnection.provider_config JSON (_33_integrations_module...py:57), whose docstring already says it is for per-provider config outside the credential blob. 'Which of THIS GitHub connection's orgs are production' is a property of the connection. Cleaner than D1's implicit assumption that scope.where covers tenant variation, and it needs no column.
- NOT IN ANY DESIGN, and it is step 0 — a canonical field registry per resource kind. 225 of 276 normalized field names (81%) are used by exactly one provider; MFA has 13 spellings including one camelCase; google_workspace/microsoft_365/clerk users share zero field names. Every category- or kind-addressed check in all three designs silently resolves None against most providers. Until the registry exists, restrict category addressing to a whitelist of verified-normalized (kind, field) pairs and keep everything else provider-addressed.
- MISSING FROM D1 AND REQUIRED — a degenerate single-source shorthand. `"source": {"provider": X, "resource": Y}` with role/require inferred, alongside the full `sources` array. Measured: the array form costs 362 bytes / 15 leaf values against today's 222 / 8 on the commonest check shape (all_true is 74 of 239). Roughly 450 of 500 checks are single-source; without the shorthand every one of them copy-pastes a four-key wrapper it never varies.

## Alternative stances considered

- The schema is already there — SCFCheckResult, SCFControlState, SCFScope, SCFObjective.defined_parameters, SCFEvidenceRequest, Issue/from_event, PluginScheduleOverride are all designed for this and all unused — so the work is one writer, one widened finding dict, and one check-spec format that separates population from evidence; zero new tables, one new nullable column.
- Scope is not a filter you apply to a test — it is the thing the test is built on. A check declares a POPULATION KIND, never a provider; connectors register as population providers with a declared authority (`sole` | `partial` + a `covers` predicate) and a scope filter; and the three ways a population can be empty (couldn't look / looked and found nothing / nothing in scope) become three different 

## Completeness critique

# Completeness critique

## 1. Scenarios still not genuinely answered

**Answered in the wrong place (5 of 20).** The surveys reached for a connector DSL to solve controls whose evidence is already sitting in first-party tables nobody opened:

| # | Scenario | Where the data actually is |
|---|---|---|
| 12 | critical vulns in 15 days | `grc/models/_22_vulnerability_management_module.py:53` — `severity`, `discovered_at`, `due_date`, `resolved_at` on `grc_vulnerabilities`. This is a `WHERE`, not a temporal engine. |
| 16 | vendor assessment annually, critical only | `_35_vendor_risk_management_models.py:15` `tier`, `:44` `next_reassessment_date`. Two columns. |
| 18 | policy acknowledgement | `_19_policy_gap_analysis_models.py:151` `PolicyAttestation` — `status`, `due_date`, `completed_at`, `expires_at`, `recurrence_months`. |
| 7 | access review within 90 days | `AccessReviewCampaign` (`_40_access_review_models.py:20`) + the whole `grc/modules/access_review/` module. |
| 13 | P1 incident owner/timeline/RCA | `_11_enterprise_risk_management.py:282` `RiskIncident` + `IncidentAssetLink/VulnerabilityLink/RiskLink`. |

Three of the eight required aggregation operators (TEMPORAL, CORRELATION, EXISTS) already run in production code the surveys never read — see §3.

**Genuinely unreachable, and no survey said so plainly:**

- **4 (PR approved before merge, reviewer ≠ author)** — github's entire resource list is `orgs, org_detail, members_no_2fa, repos, default_branch_protection`. No PRs, no reviews, no commits, no authors. This is not an engine gap, it is a *collection* gap: there is no field map to fix.
- **15 (deploy ↔ approved ticket)** — same, plus it needs the cross-connector join that `run_connector_checks(provider, spec, creds, base, cdef)` (`evidence_engine.py:287`) structurally forbids.
- **14 (backups: configured / fresh / restore-tested)** — A1.1 has **5 checks total** across 65 connectors, A1.2 has **2**. "Restore-tested" has no source anywhere in the repo.
- **17 (TLS ≥ 1.2 across LBs and gateways)** — `CLOUD_CHECKS["aws"]` is six checks (root MFA, root keys, password policy, CloudTrail, EBS default encryption, Config recorder). No ELB, no listener policy. The only TLS assertions are each SaaS vendor's own front door (fastly, supabase, netlify). There is no population called "load balancers".
- **11 (population from MDM, evidence from EDR)** — needs two collectors in one check. Blocked by the same single-provider signature.
- **8 (365-day training, 30-day new-joiner grace)** — no training connector in *any* of the four collection frameworks, and no hire-date join. The "policy above raw data ⇒ NOT_APPLICABLE" half was asserted as a design requirement and never traced to a mechanism.
- **5 (public S3 × data classification)** — half-answered and nobody checked: the classification side *does* exist (`_14_it_asset_inventory.py:55` `data_classification`, indexed `:257`). The missing piece is a bucket→`ITAsset` link, not a classification model. Nobody looked.

**2, 3, 9, 10, 20 all fail on the same missing concept, which no survey named:** there is no notion of an **authoritative source**. Scenario 2 (IAM is the authority for IAM MFA), 9 (the IdP is the authority for password policy, not every app), 11 (MDM is the authority for the device population) are the same requirement. Today `_coverage_for` (`automation/router.py:425-457`) models providers as *interchangeable alternatives within a category* — the exact inverse of what 2/9/11 need. Deepening that function makes the problem worse.

**Scenario 20, checked against the code, is wrong in a way nobody caught.** github passes, gitlab collects zero repos → its checks return `not_run` (`evidence_engine.py:273-275`) → `_status_from_run` returns `not_run` (`router.py:415-421`) → `_aggregate_status(["passed","not_run"])` falls through `all(passed)` to `any(passed)` and returns **`"partial"`** (`router.py:255-259`). Not pass, not N/A — *partial*, forever, with no way to tell "gitlab has no repos" from "gitlab is half broken".

## 2. Claims asserted but unverified — three are wrong

**a) "No Alembic migration created `grc_scf_check_result`" (engine-limits, listed as an open gap).** Resolved, and the framing is wrong: **there is no Alembic in this repo at all.** `grc/db.py:189` `safe_metadata_create_all` creates every table off `Base.metadata`, and `grc/models/__init__.py:30` star-imports `_56_scf_catalog_models`. The tables **exist and are empty** in every tenant DB. This is not a schema decision to make — it is a missing writer. Stop designing tables.

**b) "Empty population produces a silent pass, and every `for_each` child is exposed."** Overstated. I replayed all 65 specs against a transport returning `(200, [])`:

```
connectors emitting a PASS on an all-empty API: 12 of 65   vacuous passes: 12
codes that can go green vacuously: ['CC6.1', 'CC6.3']
github.members_all_have_2fa · google_workspace.super_admin_count · vercel.team_owner_count
netlify.owner-count-limited · heroku.team_admin_count · grafana.org_admins_limited
linear.admin_least_privilege · monday.admin_count_bounded · zendesk.admin_count_limited
hubspot.limited_super_admins · openai.admin_api_key_sprawl · servicenow.admin_least_privilege
```

Every one is `kind: max_count`. The offender kinds already refuse (`evidence_engine.py:273-275`); `min_count` fails loudly. The bug is **one branch** — `evidence_engine.py:241-245` — and the fix is the rule three lines below it. The surveys turned a 12-row, two-code, two-line defect into a justification for a status-model redesign.

**c) "`not_run` is outvoted by a sibling pass at roll-up."** Half true, and the half nobody found is worse. Inside one run, yes: `router.py:415-421` tests `"pass" in statuses` and never tests `not_run`. Across plugins, no: `_aggregate_status` returns `"partial"` (`router.py:255-259`). **The same word means "ignore me" at one layer and "downgrade the control" at the next.** Any new status value you add will inherit this split unless one of the two functions dies.

**d) The gap the engine-limits survey explicitly declined to compute, computed:** across the 239 checks / 15 codes, `present`+`min_count` (kinds with no or trivial failure path) are **CC7.2: 15 of 23**, **CC6.1: 36 of 103**, **CC7.4: 4 of 7**, **CC7.1: 6 of 16**. "Monitoring is automated" is two-thirds "an object exists".

**e) The single most important unverified thing in all three surveys: how an SCF control gets a status at all.** `router.py:1202-1203`:

```python
if slug == "soc2":
    soc2_of[scf_id].append(code)
```

SCF control status is derived **only** through the SOC 2 crosswalk, from `SCFMapping` rows filtered `provenance.in_(("resolver","ai"))` (`router.py:1188-1191`) with **no `match_mode` filter** — the non-exact rows are counted as "inferred" elsewhere (`:1044-1049`) but are fully load-bearing here. So a green SCF control's provenance chain is: one connector check → a SOC 2 criterion string → an *AI-generated or parent-rollup* mapping row → the control. Nobody surveyed this, and it undercuts the licence position too (the memory index already flags an AI-generation prohibition on SCF-derived content). Also note `_checks_for_control` (`:335-343`, its own docstring admits the union problem) and `_check_index` (`:1124-1146`) bind checks to controls by **different rules** — two code paths, two answers for one control.

**f) Unsourced fields:** `SCFCheckResult.granted_scopes` / `credential_fingerprint` (`_56:344-346`) have no producer *and no source* — `IntegrationConnection` (`_33_integrations_module_vulnerability_scanner_integration.py:7-50`) stores `auth_method` and `encrypted_credentials`, no scopes column. Designing evidence provenance around a field nothing can populate is how the last four columns on that table ended up dead.

## 3. What every agent missed because they all read the same six files

All three surveys read `runners/*.py` + `connector_checks.json` + `objectives.json`. Nobody opened the other half of the product.

**`grc/modules/access_review/` — 2,384 lines that already implement three of the eight operators.** `checks.py:110-123` `ghost_account` (termination date + account still enabled) **is scenario 6**. `checks.py:126-142` `stale_account` with `STALE_DAYS = 90` and `item.last_sign_in < now - timedelta(days=90)` **is a working temporal check** — the claim "the engine has no clock" is true of `evidence_engine.py` and false of the platform. `checks.py:171-183` `no_approval` (a `UserRole` with neither `assigned_by` nor `source`) **is scenario 19**. `mfa_missing` at `:100-108` is scenario 1. Plus `sampling.py` (population sampling — the thing `population_size`/`tested_size` was designed for), and `rule_catalog.py` (418 lines of rule definitions).

**`access_review/iga.py:1-17` is the engine being proposed, already built:** "ONE engine and a small adapter per vendor describing auth / identities / map(raw)", all adapters landing in the same `GRCUser`/`Role`/`UserRole` model. That normalized identity model *is* the join table Family A needs — it already exists and the correlation survey proposed inventing it.

**There are two Okta collectors.** `access_review/okta.py:47` pages `/api/v1/users` by Link-header cursor to 50 pages; `live_api_catalog._okta_mfa_sweep` caps at 50 users and `evidence_engine._collect_one` implements only `style == "page"` (`:115`). The same tenant holds two Okta populations of different sizes, reconciled nowhere.

**There are four collection frameworks, not two.** `grc/modules/connectors/registry.py` + `providers/` is a third (15 adapters: `servicenow.py`, `zoom.py`, `office365.py`, `splunk.py`, `qradar.py`, `wazuh.py` …) — **`servicenow` and `zoom` also exist in `PROVIDER_API`**, so the same vendor is connectable twice with two credential records and two data shapes. `asset_discovery/services/platform_collectors/` is a fourth. The engine-limits survey warned that a new transport "means a third vocabulary". It is already the fifth.

**Orchestration exists and was treated as absent.** `grc/celery_app.py:175` `beat_schedule` (five daily/weekly sweeps incl. an exception-expiry sweep — the pattern scenario 7 needs), `grc/tasks/connectors.py:24` `run_connector_sync`, per-plugin `schedule_cron` with a tenant override at `compliance_plugins/router.py:111-123`. Scenario 7's "creates tasks" has a home; nobody looked for it.

## 4. The single biggest risk

**You are about to design a fifth assertion language and a second control plane, on top of four collection frameworks that already disagree, to produce verdicts whose provenance chain runs through AI-generated crosswalk rows.**

The concrete failure: an auditor asks why `IAC-06` is satisfactory. The honest answer today is "a GitHub `max_count` check saw zero rows and returned pass, which was credited to CC6.1, which an `ai`-provenance `SCFMapping` row associates with IAC-06." Nothing in the proposed model fixes that chain — it decorates it with `population_size` and a join operator. And none of it is *recordable*: `SCFCheckResult` still has no writer, so on the day you ship the correlation engine you still cannot answer "was this control operating on 12 March".

Secondary risk, underrated: fixing the vacuous passes and adding N/A **changes every tenant's coverage number downward**, with no `SCFCheckResult` history to explain the drop. Ship the recorder before the corrections, or the first correction is indistinguishable from a regression.

## 5. Build first — and the smallest slice that proves the model

**Order (do not reorder):**

1. **Two-line correctness fix + three keys.** `evidence_engine.py:241-245`: `max_count` over an empty, successfully-collected population returns `not_run`, same rule as `:273-275`. Then widen `_finding` (`live_api_catalog.py:115-116`) by `population_size`, `tested_size`, `truncated`. Everything downstream becomes writable; nothing downstream breaks. Hours.
2. **One producer.** Write `SCFCheckResult` rows from `live_api_runner.py:31` after `run_provider` — one row per finding, carrying `connector`, `check_id`, `scf_id`, `status`, the three population fields, `collected_at`, `expires_at`. Until one row exists in one tenant DB, every stage of the design is speculative. A day.
3. **Reconcile the two status layers** before adding a fifth value: `_status_from_run` (`router.py:415-421`) and `_aggregate_status` (`:241-260`) must agree on what `not_run` means. Adding `not_applicable` to a vocabulary that already contradicts itself doubles the contradiction.

**Smallest end-to-end proof: scenario 20.** It exercises exactly the four things in dispute — population count in a finding, empty-but-collected ⇒ N/A, ALL-across-connectors at control level, and a persisted row naming which connector saw how many repos — and it needs **no join, no clock, no new transport, no new connector**. Acceptance: github (3 repos, protected) + gitlab (0 repos) ⇒ control `passed`, with a `SCFCheckResult` row showing `gitlab / not_applicable / population_size=0`; flip gitlab to one unprotected repo ⇒ control `failed`. Today that pair silently returns `"partial"` and no one can say why.

**Second slice, proves TEMPORAL with zero connector work: scenario 12** over `grc_vulnerabilities` — `severity='critical' AND resolved_at - discovered_at > 15d`. It is a SQL query against a table that already has data, and it forces the ODP question into the open at the one place designed for it: `SCFControlState.defined_parameters` (`_56:303`, "answers keyed by ao_id") is where the 15 lives. If the threshold cannot flow from that column into an assertion, no amount of `_op` work on `evidence_engine.py:170-198` matters.

**Do not build yet:** the correlation/join engine, a new check DSL, any new table, and above all any deepening of the category-substitution model in `_coverage_for` — the connector survey already demonstrated it is wrong for scm, mdm, hr, email and security, and scenarios 2/9/11 need its opposite.

**Gaps in this critique:** I did not read the frontend, so I cannot say how `not_run` / `partial` / `info` render. I did not trace `run_service.py`'s persistence to confirm the full findings list survives into `raw_output` (`_status_from_run` reads `raw["findings"]`, so at least the key does). I did not verify whether `grc/modules/connectors/` and `compliance_plugins` share the same `IntegrationConnection` rows or keep separate ones — if they share, the duplicate-vendor problem is worse than I stated.
