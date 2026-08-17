# CRQM + CTEM — production build plan

Complyverse GRC platform. Written 2026-08-10, grounded in the actual codebase
(entities, patterns, and dependencies verified — not assumed).

## Open Items — the single ledger (doc-tracks-obligations)

At six phases this arc has outgrown memory-based tracking, so obligations live
HERE, one line each: an item enters when raised, and either LANDS (with where),
gets DECLINED (with why), or stays OPEN with its blocker. Nothing evaporates
between review rounds.

Owners: **A** = agent debt (blocks unqualified done); **B** = user (real-world
guarantees); **C** = user decision; **D** = inventory-gated connectors;
**E** = elective refinements.

| Item | Status | Where / blocker |
|---|---|---|
| A1 Auto-created plan shape + provenance | LANDED | `itsm_service._ensure_remediation_plan` stamps system approver + self-declared source; hermetic test asserts fields; counter-attribution nuance in Phase 5 doc. Reuse/dedup half also pinned: `test_push_reuses_existing_plan_no_second_plan` asserts a push onto a finding with an existing plan reuses it (no second plan). |
| A2 Prioritized-counter non-vacuity fixture | LANDED | `test_ctem_stage_counters.py`: out-of-scope `first_seen` asserted EXCLUDED + backfill split + absent-when-none. |
| A3 Enrich the 4 reachability gap-findings | DECLINED | The 4 (ids 273/127/131/134) are CVE-less Nessus info findings — no CVE/CWE to enrich FROM (enrichment is CVE→NVD→CWE). Their "unlikely" is genuine un-derivability, not a fixable gap. Real issue is E4 (engine defaulting). |
| A5 Crosswalk matcher: substring → hierarchical; real CSF rule | LANDED (`becf5ea`, 17 Aug) | Found by the user's "how do you get 50" challenge, not by review: `_control_matches` was a bare substring match — PCI `4.1` linked 1.4.1/9.4.1/11.4.1…, `3.4` linked 9.3.4, `7.1` linked 12.7.1; 16 of the scope's 38 PCI links were noise. CSF links (ID.RA-5, PR.AC-3) were accidents of the loose `NIST` prefix; the real CSF rule never fired (prefix mismatch). Fixed: hierarchical match (34-case self-check), CSF alias, CSF rule → ID.RA-1 + DE.CM-8. Re-map routed through the SOFT-retraction path (confirmed: evidence #128 on ID.RA-5 has `retracted_at`, row preserved; 6 live). **Coverage restated (correction, not supersession)**: build-time claim was 22/215 findings linked, 37 controls; the "60 controls" card was pre-fix and inflated; TRUE now: 23/205 findings linked → 33 parsed controls (+1 Unified Library) with links, 177 auto links. Known residual: PCI patterns are v3.2.1 numbering on a v4.0 upload (6.5.x/4.1.x/7.1.x meaning drift) — cured structurally by A6, not patched here. |
| A6 Reasoned, re-runnable control mapping (P1–P5) | OPEN — awaiting go | Plan of record: `docs/CTEM_VALIDATE_REASONING_PLAN.md`. Reason once per (weakness key × corpus version), store decision+rationale+provenance, apply deterministically, re-reason on change (completeness sweep weekly; re-ask only on version bump). Absorbs E4's engine half for no-CVE findings (the L1 described-weakness classifier) and the reach-view copy that was widened into E4 — ONE obligation, not two ledger rows. Reasoned links get their own marker `auto:reasoned:<decision_id>` + a new `link_basis` value flowing into evidence-summary; the `existing_auto` prune filter is widened deliberately, with tests. Retrieval = hybrid keyword (pgvector 0.8.0 is available on the server but NOT installed in the tenant DB; no infra change). |
| A4 Remaining rule dimensions in the harness | LANDED | Resolver supports exactly asset_ids / departments / asset_types / name_contains (no tag/subnet). All four + AND-narrowing already tested in `test_ctem_scope_membership.py`. |
| Verdict-engine concluded-vs-defaulted diagnostic | LANDED | Phase 4 doc: 11 genuinely severed + 4 enrichment-un-derivable. Structural distinction now shipped as E4 (`viability` field + three-lever copy). |
| CTEM command center (per-scope loop overview) | LANDED | Answered the visibility gap by GROWING `erm/ctem-scopes` — not a new module. Counter row → 5-stage loop strip (added the `prioritise` counter the API already returned); below it, 4 downstream cards from a new `ctem_scopes.command_center` aggregator that REUSES each stage's own service, scope-filtered via `scope_vulnerability_ids`: prioritise (`choke_points.coverage/rank` gained a `vulnerability_ids` filter), validate (control links → `tier_for_ref`), mobilise (`VulnTicketLink`), quantify (latest PORTFOLIO run — risks aren't scope-linked, so labelled portfolio, never a faked per-scope $). Read-only endpoint `GET /erm/ctem/scopes/{id}/command-center`. Tests: `test_ctem_command_center.py` (scope isolation on all four cards + coverage filter). |
| B1 ServiceNow PDI + two-stage live verification | IN PROGRESS — yours (17 Aug) | PDI `dev396862` provisioned by the user; connector #16 (`servicenow`, ticketing) saved via the connectors UI, status connected; `CONNECTOR_MASTER_KEY` set so creds are Fernet-encrypted at rest. Stage (1) test+save passed. Stage (2) push PROVEN live: VULN-284 (node-tar, rank #1) → `INC0010001` (link row #1, 09:56:45); Mobilise tile 0→1 on the command centre. REMAINING (yours): set INC0010001 to Resolved in the PDI → sync → plan `applied` (not verified) → Mobilise "0 open · 1 done"; then reopen → re-ticket check. |
| B2 Prod role-catalogue check | OPEN — yours | Empty catalogue fails closed = everyone-admin, so no gate bites. Needs prod inspection; empty → E7 becomes next build. Highest-leverage half-hour. |
| B3 Viewer-login UI hide check | OPEN — yours | ~2 min; API-403 proven 9/9. Creating the viewer role populates the catalogue (overlaps B2). |
| C1 no-push rule / private remote | OPEN — yours | 25+ commits, one working tree; bundle covers loss but not history/CI/2nd-machine. Decide consciously. |
| D1 Jira provider | OPEN | Cheapest connector (free Jira Cloud); only new layer on proven lifecycle. Prove standalone via `/connectors` before wiring lifecycle. |
| D2 EASM connector | OPEN | Needs a real estate + account; feeds asset register + chain generation (the 206-chainless lever). |
| D3 BAS connector | OPEN | Needs license/Caldera; feeds Phase 2 `tested-effective` tier. |
| E1 Workbench evidence panel | OPEN | Surface Phase 2 evidence rows inside the CT&A workbench control view. |
| E2 Scorecard blend | OPEN | Factor automated tiers into the assurance scorecard weights. |
| E3 ITSM closed-with-fix-code advance | OPEN | Resolved-only now (safe); close_code check could add legit closed-fix advances. |
| **E4 Verdict-engine: three states rendered as two** | LANDED | Third state named at the SOURCE: `verdict.derive_viability(verdict, entry_state)` → `viable` / `severed` / `undeterminable`, surfaced on the rollup (so the view payload, choke coverage + any narrator read ONE definition; re-derived in `apply_wall_to_rollup` on the clamp's "never disagree" rule). Data-gap `unlikely` (assumed_insufficient) is now `undeterminable`, distinct from a DERIVED dead-end (`severed`/`none`). Finding-level twin predicate `selection.is_undeterminable` sits beside the `assumed` flag it reads; `choke_points.coverage()` splits the unviable set into `findings_severed` vs `findings_undeterminable` by that same predicate (no drift). COPY on BOTH surfaces (router `coverage_note` + choke-points empty-state) now names three levers, not two, and stops framing enrichment as a lever for severed findings. Tests: `test_verdict_viability.py` (9) — load-bearing asserts no-CWE/vector→undeterminable, derived-block & local-only→severed, coverage split exhaustive. Full suite green. |
| E5 Portfolio correlation term | OPEN | Shared-factor extension; independence assumption stamped + on-card today. |
| E6 Approve-tier permission | OPEN | Activation/material-flag sit at edit level; no approve-level string platform-wide. |
| E7 Seed default roles on tenant creation | OPEN | Conditional on B2 outcome. |
| E8 Chain-generation coverage metric | OPEN | Promote "9 of 215 carry chains" to a tracked roadmap number. |
| E9 Remediation simulation (set-cover) | OPEN | Select findings → residual reachable assets; marginal insight without conditional rank numbers. |
| E10 Technique-leverage view | OPEN | Technique frequency × assurance tier as a control-side lens. |
| E11 Periodic status sync | OPEN | Manual-only by architecture; joins here if a scheduler ever lands. |
| E12 Rule-era link_basis cosmetic | OPEN | Accurate provenance on manually recreated links; revisit only if it confuses. |

## Ground rules for every phase

These come from how the codebase actually works:

- Schema changes are **additive only**: model columns + `_COLUMN_ADDS` in
  `backend/grc/modules/compliance/schema_migrations.py`, new tables via startup
  `safe_metadata_create_all`. No Alembic, ever.
- **No Celery dependency** — anything heavy runs inline or in a daemon thread
  (the same pattern as scanner sync/enrichment).
- Every decision-bearing write gets an **audit row**; assumptions and rationale
  are stored columns, not comments.
- The existing 1–5 qualitative scoring, dashboards, and reports are **never
  touched** — quantification sits beside them.
- A phase is done only when schema + API + UI + audit + tests all land and are
  verified against the dev tenant. No stubs left behind.

Verified starting facts:

- Risk register: `Risk` on `grc_risks` (`models/_11_enterprise_risk_management.py`)
  with `RiskControlLink`, `RiskAssetLink`, `RiskScoreHistory`,
  `LikelihoodImpactScale` (tenant-configurable 1–5 scales).
- `numpy` and `scipy` already in backend requirements — the simulation engine
  needs no new dependency.
- Frontend charts use `recharts` — right tool for loss-exceedance curves.
- ERM module has ~20 routers under `backend/grc/modules/erm/routers/` — a new
  `quantification.py` slots in cleanly.

---

## Phase 1 — CRQM core (the money engine)

### 1.1 Schema

New model file `models/_50_risk_quantification_models.py` (the chain already
ends at `_49_document_attestation_models`; imported explicitly from
`models/__init__.py` like the other tail files), plus `_COLUMN_ADDS` entries:

- `grc_risks` — additive scenario columns: `scenario_actor`, `scenario_method`,
  `scenario_effect` (JSON C/I/A flags), `scenario_statement` (the full
  sentence, e.g. "external ransomware operator encrypts plant systems via a
  compromised remote-access account"). Affected assets reuse the existing
  `RiskAssetLink` — no new column.
- `grc_risk_loss_models` (new) — versioned, one active per risk:
  - threat event frequency min / most-likely / max (attempts per year)
  - probability-of-success min / ml / max, with a `pos_basis` provenance field
    ("estimated" vs "derived from validated attack paths")
  - `loss_components` JSON — each `{label, primary|secondary, min, ml, max,
    probability, rationale}`. `probability` (default 1.0) is the per-incident
    occurrence chance of that component — FAIR's secondary-loss frequency. A
    $20M regulatory fine that materializes in ~15% of incidents is modelled as
    probability 0.15, not charged on every event; the engine applies a
    Bernoulli gate per component per event. Without this, ALEs are
    systematically inflated on exactly the components boards care about.
  - `currency` (ISO code) with tenant-default fallback — stored per model so
    run rows are money-unambiguous from day one.
  - confidence %, assumptions text, author, timestamps
  - Edits to an active model create a NEW version; old versions are immutable
    audit history. **Activation is transactional** (row-locked
    promote-and-archive) so two users activating concurrently cannot race
    into two active models.
- `grc_risk_simulation_runs` (new, immutable) — model ref, iterations, RNG
  seed, engine version, ALE mean/median, p5/p50/p90/p95/p99 as real columns
  (queryable), loss-exceedance curve points JSON (~50), per-component
  contributions JSON (tornado data), applied-controls scenario JSON (null =
  baseline), duration, who triggered, when. Seed + engine version stored so any
  run is exactly reproducible for audit.
- `grc_risk_control_links` — additive effect columns: frequency-reduction %
  min/ml/max, magnitude-reduction % min/ml/max, rationale, updated-by/at.

### 1.2 Simulation engine

`backend/grc/modules/erm/quantification/engine.py` — a pure function
`simulate(model, iterations, seed, control_effects) -> results`, numpy-based:

- Distributions: Beta-PERT over each min/ml/max triple; annual event count
  Poisson with sampled lambda; per-event success Bernoulli on sampled
  probability; annual loss = sum of per-event component samples. Control
  effects apply as sampled multipliers on frequency/magnitude.
- Default 10,000 iterations, hard cap 100,000. At numpy speed this is
  milliseconds — per-risk AND portfolio runs execute inline in the request
  (a joint run over ~30 models is still sub-second; no thread, no orphan).
- **Portfolio runs assume independence between scenarios** — sampled jointly
  per iteration, which is correct for portfolio percentiles only under that
  assumption. Independent sampling understates tail risk when risks are
  correlated (one ransomware campaign hitting three business units). The
  assumption is stamped on every portfolio run record and surfaced in the UI
  next to the curve; a shared-factor/common-event term is the designed
  extension point for a later phase. Never present the portfolio tail as
  correlation-aware.
- Run rows carry a status field; a lazy sweep fails-out any run stuck in
  "running" (process death mid-request), so no row can pretend to be in
  progress forever.
- Outputs: percentiles, ALE, downsampled loss-exceedance curve, tornado
  contributions.

### 1.3 API

`backend/grc/modules/erm/routers/quantification.py`, registered alongside the
existing ERM routers, same auth/tenant/permission pattern as `risks.py`:

- loss-model CRUD (drafts editable; activate promotes + archives predecessor)
- `POST .../simulate` (optional control-set and iteration overrides) → run record
- `POST .../control-comparison` — runs baseline + each candidate control set,
  returns the ROI table: cost vs expected-loss reduction per option
- portfolio simulate + history
- simulation history per risk; `AuditLog` rows on create/activate/simulate

### 1.4 CTEM interlock (suggestion-only in this phase)

A prefill service: when the risk's linked assets carry validated signals
(reachability verdicts, open KEV findings, scanner-verified closure history),
it proposes a probability-of-success range and stamps `pos_basis` with the
evidence trail. The user confirms — the model never silently self-updates.

### 1.5 Frontend

- Risk detail page → new "Quantification" tab, visible on every risk for
  discoverability; inside, a material-flag gate (an enable panel explaining
  the FAIR 10–30 scenario guidance) keeps quantification itself opt-in per
  risk. Contents: scenario builder (4 structured fields), loss-model editor
  (range rows, rationale required, min ≤ ml ≤ max validation), version
  history, run button, results — ALE cards, loss-exceedance curve (recharts),
  loss-drivers chart, control-comparison ROI table, with assumptions
  displayed beside every chart.
- ERM dashboard: portfolio loss curve card + top-risks-by-ALE list.
- Gate: `npx tsc --noEmit` clean on touched files.

### 1.6 Tests and acceptance

- Engine unit tests with fixed seeds: known inputs → ALE within tolerance;
  degenerate ranges (min=ml=max) → exact arithmetic; control-effect
  monotonicity (adding a control never increases loss); reproducibility
  (same seed → identical output).
- API tests: tenant isolation, draft/active lifecycle, immutability of runs.
- Acceptance: create scenario → build model → simulate → read curve → compare
  two control options → every number traceable to stored assumptions; existing
  risk screens/reports unchanged for non-quantified risks except the new
  Quantification tab (which shows only the enable panel until flagged).

---

## Phase 2 — Validation → control effectiveness (assurance layer)

- New table `grc_control_effectiveness_evidence`: polymorphic control ref
  (mirrors `VulnerabilityControlLink`'s four FKs), vulnerability, source type
  (`scanner_closure` / `retest`; `bas` later), pass/fail, tested-at, details
  JSON. **Bounded volume by construction**: identity is control × finding ×
  source, upserted in place — a noisy scanner closing 400 findings updates
  rows, never floods them.
- Producers wired into what already runs: the scanner closure engine (pass on
  verified close, fail on reopen) and the retest endpoint (pass / fail, with
  "partial" mapped to fail and the original preserved in details).
  Reachability snapshots are a documented extension, not a v1 producer — a
  verdict is context, not a defensible effectiveness claim.
- **No stored badge or rollup columns.** Staleness has no event — nothing
  fires at month 18 — so the tier is DERIVED AT READ TIME from the evidence
  facts (`services/control_assurance.derive_tier`, pure function, unit-tested
  precedence). A stored badge would need a sweeper and would lie between
  sweeps. Precedence semantics (auditors will challenge anything looser):
  - A recent fail dominates older passes.
  - Scanner-verified closures alone can only reach `remediation-verified` —
    they prove remediation happened, not that the control works. The full
    `tested-effective` badge requires a genuine effectiveness source (retest
    or BAS).
  - Staleness window: `tested-effective` decays to stale/attested-only after
    a configurable window (default 18 months) — an old pass must not wear a
    fresh badge.
- Surfaces: an Assurance tier column (badge + basis tooltip) on the
  vulnerability detail "Linked Controls" panel; `/control-library/assurance/
  evidence-summary` (tier distribution + **link coverage surfaced honestly**
  — dev tenant at build time: 22/215 findings linked, 37 controls with links
  out of 3,529 parsed — a roadmap number, not a hidden gap. **Correction
  17 Aug 2026 (A5)**: after the matcher fix and re-map, 23/205 findings
  linked → 33 parsed controls (+1 Unified Library); the interim "50/60
  controls" figures included substring-match noise and are withdrawn) and
  `/controls/{kind}/{id}/evidence` for the per-control panel.
- Named follow-ups, deliberately not implicit: an evidence panel inside the
  CT&A workbench's control view, and blending automated tiers into the
  existing assurance scorecard weights.
- Acceptance: a scanner-verified closure visibly upgrades its control to
  remediation-verified with a dated evidence row; a failed retest flags it; a
  pass older than the window shows as stale.

## Phase 3 — CTEM scopes and cycles

Three semantics settled BEFORE code (review front-load):

1. **Freeze semantics.** Rule-based membership churns, so "numbers freeze
   into the cycle row" means: on close, the cycle row stores the counts, the
   RULE DEFINITION as-of-close, and a membership hash (sorted member-asset
   ids). Full asset-list snapshots are the heavyweight alternative and are
   deliberately not v1. Drill-down is honestly limited to OPEN cycles — a
   closed cycle's counts are verifiable against the frozen rule + hash, not
   re-explorable, and the UI says so.
2. **Stage counters only from real tables** (as built —
   `services/ctem_scopes.compute_stage_counts`). v1 ships THREE honest
   counters, each a named table + timestamp:
   - discovered — `Vulnerability.first_detected` (falling back to
     `discovered_at`) in-window on member assets. first_detected specifically,
     so a RE-SCAN never re-discovers an existing finding.
   - validated — `ControlEffectivenessEvidence.tested_at` in-window
     (retracted rows excluded) — the Phase 2 evidence stream (retest /
     closure).
   - mobilized — `VulnRemediationPlan.created_at` in-window for member-asset
     findings.
   "Prioritized" was OMITTED at Phase 3 (no event table) — **now WIRED**, once
   Phase 4 gave it one: the event is "a finding first became a rankable choke
   point in-window", read from the durable `ChokePointFirstSeen` fact (never
   the replaceable snapshot), intersected with scope member findings. Reported
   decomposed — `prioritized_in_window` (real workflow) vs
   `prioritized_launch_backfill` (the one-time inaugural stamp) — so a cycle
   spanning launch never reads backfill as prioritization. Absent (not a fake
   zero) until a first choke-point snapshot exists.
3. **Cadence is advisory metadata only.** No scheduler exists in this
   architecture; cycles open and close by explicit human action, and the UI
   never implies one will open itself.

- New tables: `grc_ctem_scopes` (name, business owner, advisory cadence,
  membership criteria) + explicit/rule membership + `grc_ctem_cycles` (one
  row per run: stage counts, started/closed, frozen rule + membership hash
  on close).
- Scope filter parameter added to the vulnerability register, asset register,
  and dashboards (they already take filter params — this is one more).
- UI: Scopes page (list + detail with cycle history and a stage-progress
  card), scope selector on registers.
- Acceptance: define "payment platform" scope → every dashboard answers for
  that slice → close a cycle and the counts freeze with rule + hash.

## Phase 4 — Choke-point analysis

**Definition — re-settled after an empirical discovery** (assumption → check →
correction, per doc-tracks-code; the front-loaded decisions 1–2 below assumed
a shared-step graph the schema does not have):

- ASSUMED: a choke point is a convergence node many paths route through;
  "paths broken" = stored chains whose steps include the remediated node;
  ranking is MARGINAL because chains share steps.
- CHECKED (before writing the test): a `ReachabilitySnapshot` is one finding
  on one asset; steps are ATT&CK techniques. Each chain belongs to exactly ONE
  finding, so finding A's chains and B's are DISJOINT — "fixing A severs B's
  chain" never happens; the shared-step/marginal model describes a graph this
  data isn't. (Confirmed: vuln 300 spans 5 assets, 299 two, the rest one each.)
- RE-SETTLED (user decision): **a finding's score = the number of distinct
  VIABLE (asset) chains it participates in** — latest snapshot per (vuln,asset)
  with a viable verdict (likely/possible). One remediation severs all of them,
  so a widespread finding is the choke point. This is breadth/reach, NOT
  convergence — the view says so on its face rather than borrowing the vendor
  term unqualified.

1. **"Chain" is a STORED artifact, never an enumeration.** Score = count of a
   finding's stored viable chains — never paths enumerated through a graph
   (exponential, meaningless at estate scale).
2. **Summing rules, corrected for the real model.** Chains are DISJOINT per
   finding, so `total_viable_chains` across findings sums TRUE and is shown.
   What must NEVER be summed is ASSETS PROTECTED — assets overlap across
   findings, so a protection total double-counts; no per-finding "assets
   protected" total exists anywhere. The ranking still reshuffles as fixes land
   (correctness); the deterministic tie-break keeps identical recomputes
   byte-identical so only real change moves the list.
3. **Snapshot honesty: `computed_at` rendered on the view itself.** A list
   computed before the latest scan must show its age, like the CRQM run
   timestamps.
4. **`prioritized` counter: decide the EVENT or keep the seam.** Choke-point
   rank is a STATE; counters count events in windows. The only clean event is
   "finding first appears in a choke-point snapshot during the cycle window."
   Decide that explicitly when wiring, or leave the counter omitted one more
   phase — do NOT pour a state into an event counter.
5. **Explainability is the whole feature.** Every rank entry decomposes into
   the exact stored chains it claims to break — that is the entire difference
   between this and a black-box score. Acceptance is unchanged: click a choke
   point → see the precise paths.

Build-time decisions with a "before the table exists" deadline:

6. **Persist first-appearance separately from snapshot retention, or lose the
   `prioritized` event forever.** The settled event ("finding first appears in
   a choke-point snapshot during the cycle window") is only derivable if that
   fact survives recomputes. Decouple it: write a `first_in_snapshot_at` fact
   per finding (small side table or column) at snapshot-write time, FIRST
   WRITE WINS, never updated. Then `grc_choke_point_snapshots` rows can be
   replaced/pruned freely as a pure storage decision, and the prioritized
   counter is a trivial windowed query when wired. If this isn't in from day
   one, a replace-on-recompute snapshot table destroys the fact irrecoverably.
   - **Pin the predicate in code**: "appears in a snapshot" means "appears as
     a RANKABLE REMEDIATION" — has ≥1 chain step in the computed snapshot —
     named explicitly (e.g. `is_rankable_in_snapshot`), so the event can never
     drift between "in any chain" and "in the ranked list."
   - **Inaugural backfill (decided, not left to chance)**: the FIRST snapshot
     stamps the entire existing chained backlog at launch time, so any cycle
     whose window spans launch shows a one-time prioritized spike that is
     backfill, not workflow. DECISION: keep the stamp (the backlog's
     first-appearance is a real fact future logic needs uniformly) and surface
     the spike as a labelled launch artifact on the cycle card — do NOT
     silently exclude, which would make the backlog un-prioritizable in any
     legitimately-scoped future cycle. Cycles opened AFTER launch are
     unaffected (their window starts past the backfill stamp).
7. **Stable choke-point identity = the finding.** "Fix X" is a remediation of
   a FINDING that appears in chain steps, so the finding (vulnerability id) is
   the natural key — it gives click-through and the first-appearance fact a
   well-defined subject. Decide this before the snapshot schema, not after.
8. **Deterministic ranking under ties.** Order by count desc, THEN a stable
   key (finding id) — so identical recomputes produce byte-identical order and
   don't shuffle. Only real changes (fixes landing between syncs) reshuffle;
   that legitimate reshuffle must not be indistinguishable from tie-jitter.

**Verification strategy — analytic ground truth, not spot-check.** At this
scale the expected per-finding chain counts are HAND-COMPUTABLE: precompute
them with plain SQL over `grc_reachability_steps` and assert the service's
ranking equals that exactly (the analytic-truth pattern from the 39.3% curve
check — available precisely because the data is small, and categorically
stronger than eyeballing a plausible list). Real chains verify CORRECTNESS;
synthetic-but-realistic chains verify SCALE and TIE-BREAK only, marked and
cleaned up.

Dev-tenant chain inventory (run before building, per the Phase 2 lesson):
**15 reachability snapshots across 9 findings and 5 assets, 72 steps** — but
ALL 15 have verdict `unlikely`, so the real-data ranking is EMPTY (0 viable).
A real-data correctness check is therefore vacuous (empty==empty, the 0==0
trap one layer down); fixtures with viable chains are the only non-vacuous
proof, and real data is used only to confirm the honest empty state.

**Why all 15 are unlikely (the diagnostic, run for empty-state honesty):**
two distinct causes — 11 genuinely severed ("every way in blocked at the door"
= real posture) and 4 enrichment-gaps ("no CWE/CVSS recorded, assumed not
derived, unlikely until enriched" = fixable, not real severance). So the empty
state has THREE levers, surfaced precisely on the view: chain GENERATION
(findings with no chain), VIABILITY-by-severance, and VIABILITY-by-enrichment.
Chain-generation coverage gets its roadmap number the way link coverage did at
Phase 2.5.

**Operational finding — append-only tables and test writes** (the
unlink-retraction class, one layer on): the live verification injected a
synthetic viable chain, which drove the REAL `persist_snapshot` path and wrote
`first_seen` — a first-write-wins, never-updated fact. A blanket delete cleaned
it this time, but the correct rule is structural: `persist_snapshot` takes
`stamp_first_seen=False` so synthetic verification computes/persists a snapshot
WITHOUT ever touching the append-only fact table. Production paths (sync,
recompute endpoint) always stamp. General rule: any append-only fact table
whose write path a test exercises needs a no-write mode, not just cleanup.

- Aggregation service over data already stored (reachability steps, technique
  chains, asset links): rank single remediations by number of stored viable
  attack chains they interrupt.
- Computed on demand with a cached result table
  (`grc_choke_point_snapshots`, carrying `computed_at`), recomputed after each
  sync — same trigger point as enrichment.
- UI: "Choke points" view in the vulnerabilities module (ranked list: fix X →
  breaks N chains across M assets, no total) with its `computed_at` shown +
  a sort option on the register; feeds Phase 3's (still-omitted) prioritized
  counter once its event is decided.
- Acceptance: ranking is explainable — clicking a choke point lists the exact
  stored chains it breaks.

## Phase 5 — External connectors (EASM · BAS · ITSM)

**Operational discovery (read-before-build, like the CT&A router and CWE
mapper):** a complete `grc/modules/connectors/` module already exists —
mounted at `/connectors`, with a `TicketingAdapter` base (create_ticket /
fetch_statuses / two-way status sync), a self-registering provider registry,
full connector CRUD + OAuth, and WORKING ServiceNow + BMC Remedy adapters.
The Phase 5 plan's "build adapters fresh on IntegrationConnection" framing was
wrong; most of the ticketing machinery is already there. The real gap was the
WIRING: nothing in the vuln lifecycle called `create_ticket`, and no ticket
resolution rolled back onto a remediation plan. (No Jira provider exists —
that would be net-new on the same framework.)

### ITSM (ServiceNow) — built: wire the existing adapter into the vuln flow

Verified against a ServiceNow instance (user has one); credentials are
configured via the connectors UI, never through the vuln endpoints.

- `grc_vuln_ticket_links` — one live ticket per (vuln, connection). Idempotent
  by construction: a repeat push returns the existing link, never a duplicate
  incident.
- `services/itsm_service.py` — `push_finding` (build TicketRequest → the
  registry's `build_adapter` → create_ticket → link, same construction path as
  the connectors router) and `sync_ticket_statuses` (fetch_statuses → roll
  resolution onto the plan).
- **Safety boundary — the Phase 2 epistemology, third event family.** Each
  event advances exactly as far as what it PROVES: scanner closure → the fix
  landed; retest → the control worked; ITSM resolution → engineering did the
  work. So a resolved ServiceNow ticket advances the plan to `applied`, NEVER
  `verified` (verification stays the scanner/retest path). Advance-once
  (idempotent re-sync), audited.
- **Advance predicate is RESOLVED-ONLY.** ServiceNow `closed` conflates a real
  fix with won't-fix / not-reproducible / too-costly; advancing on it would
  record undone work as done. `resolved` is unambiguous. A ticket jumping
  straight to closed under-advances (safe), never over-advances. Closed-with-
  a-fix-resolution-code is an Open Item.
- **Push ensures a remediation plan exists** (creates a minimal `approved` one
  if none). The `mobilized` counter reads `VulnRemediationPlan`, so pushing IS
  mobilising and the counter can see it — a ticketed-but-planless finding
  would otherwise be invisible mobilisation. The auto-created plan is
  SELF-DECLARED and SYSTEM-ATTRIBUTED (title/summary name the connector; the
  `approved` status carries a system approver name + timestamp, never a blank
  approver that reads as a human decision). Counter nuance: pushing onto a
  finding that ALREADY has a plan reuses it, so the `mobilized` counter
  attributes that mobilisation to the earlier plan's creation date — correct
  (the finding was mobilised then), but stated so the date isn't misread.
- **Idempotency is partial, keyed on LIVE tickets** (partial unique index
  `WHERE resolved_at IS NULL`). One live ticket per (vuln, connection), but a
  resolved-then-reopened finding CAN re-ticket — reopens are first-class here,
  and an absolute constraint would forbid re-ticketing forever.
- Endpoints: `POST /vulnerabilities/{id}/push-to-itsm`, `POST /itsm/
  connections/{id}/sync-statuses`, `GET /vulnerabilities/{id}/itsm-tickets` —
  edit/view-gated. UI: an ITSM panel on the finding's Remediation tab (push +
  connector picker + ticket status "as of last sync", the computed_at honesty
  pattern since there is no scheduler).
- **8 hermetic tests** (fake adapter) lock idempotent push, applied-not-
  verified, closed-does-NOT-advance, plan-creation, and reopen-re-ticketing.

**Dormant-adapter finding (checked before relying on it):** the ServiceNow
adapter was bulk-added in ONE commit and never touched since; zero ticketing
connectors have ever been created; zero ticket audit rows. So it has NEVER run
live — its first live run is its first real test. The fake adapter proves the
WIRING conforms to the interface, not that the real adapter conforms to
ServiceNow's API. Two-stage live plan when a PDI exists: (1) exercise the
dormant adapter alone via the existing `/connectors` test + sync endpoints;
(2) then the full push → resolve → plan-applied loop.

### Still ahead (gated on a live instance each)

- **EASM** (outside-in discovery): exposed domains, certs, leaked credentials
  → feeds the identity resolver + asset register with `source_system`
  provenance; also raises the chain-generation coverage Phase 4 needs. Gated
  on an EASM account.
- **BAS** (breach and attack simulation): "did the control fire?" → Phase 2
  evidence rows at the `tested-effective` tier. Gated on a BAS license.
- **Jira** (ITSM alt): net-new provider on the connectors framework if a Jira
  instance is the target instead of ServiceNow.

---

## Sequencing and rough effort

| Phase | Depends on | Rough size |
|---|---|---|
| 1. CRQM core | nothing | ~2–3 weeks |
| 2. Control effectiveness | closure loop (shipped) | ~1–1.5 weeks |
| 3. Scopes and cycles | nothing | ~1–1.5 weeks |
| 4. Choke points | existing ATT&CK data | ~1.5–2 weeks |
| 5. Connectors | 2 (BAS), 3 (EASM value) | ~2–3 weeks each |

Phases 1–2 are independent of any external vendor and deliver the two
headline capabilities (money on risks, proof on controls). 3–4 make the
existing machinery navigable as CTEM. 5 is open-ended and per-vendor.

## Decided: material-flag gating

Additive `is_material` boolean on `grc_risks`, default false. The
Quantification tab is visible on every risk (discoverability drives
adoption); INSIDE it, an enable panel gates all quantification behind the
flag. The portfolio run covers active loss models (which flows from the flag
naturally). The gate lives in the **UI surfacing only — the API is not
hard-restricted**, so a tenant that wants broader coverage later costs
nothing. Matches FAIR's 10–30 well-formed-scenarios guidance and is fully
reversible.

## Operational findings (recorded, not silently fixed)

- **Consented bulk-accept carried matcher noise (assumed → checked → re-settled)**:
  ASSUMED — the Phase 2.5 round verified consent mechanics, counting
  reconciliation, retraction and provenance, and the user's bulk auto-map
  accept was taken as a correct projection. CHECKED (17 Aug, prompted by the
  user asking how "50 controls" were chosen) — ten links read against their
  control statements: `4.1`→9.4.1 physical media, `3.4`→9.3.4 visitor logs,
  `7.1`→12.7.1 staff screening; 16 of 38 PCI links and both CSF links were
  substring/prefix accidents, so the accepted projection contained noise the
  review never looked at — mechanical reconciliation is not semantic
  validation. RE-SETTLED — matcher made hierarchical, CSF rule made real,
  scope re-mapped through soft-retraction (evidence preserved, one row
  retracted), coverage restated in A5. Institutional fix: semantic checking
  (rationale-per-link + a battery on a WITHHELD holdout) is part of the
  definition of done in A6, not a role nobody holds.

- **RBAC catalogue is lazily populated**: Permission rows are created from the
  static matrix only when an admin saves a role (`admin_router.
  _get_or_create_permission`). An empty catalogue therefore fails CLOSED —
  non-admin users get 403 everywhere. The practical consequence is sharper
  than "safe": in any tenant without configured roles, every FUNCTIONING
  user must be an admin — everyone-is-admin by necessity rather than by
  bug. The production role-catalogue check therefore determines whether the
  platform's real posture matches its design, not optional hygiene; if prod
  catalogues are empty, "seed default roles on tenant creation" moves from
  roadmap to near-term. The UI-side hiding of decision buttons still needs
  one human check with a real viewer login.
- **Evidence follows links, both directions**: removing a vuln↔control link
  retracts the evidence that link produced, with a per-row audit entry. Two
  modes by WHO removed it: manual unlink HARD-deletes (a human asserted the
  link was wrong); rule-driven removal (auto-map stale pruning) SOFT-retracts
  (`retracted_at`, excluded from derivation) and REINSTATES on relink, since
  rules fluctuate and producers fire on events that never replay. Evidence
  rows carry `link_basis` (cwe_crosswalk / vuln_mgmt_rule / kev_rule /
  manual) so a KEV-rule-routed closure is visibly discountable.
  - **Stale pruning is provenance-gated**: the auto-mapper only prunes links
    IT created (`notes LIKE 'auto:cwe:%'`) — a manual link (the link row is
    itself a human's assertion) is never a pruning candidate. Soft-retraction
    protects the evidence; the provenance gate protects the human's statement.
  - **Uniform auto marker (design fact, not accident)**: all three rule
    families (CWE crosswalk, always-applicable vuln-mgmt, always-applicable
    KEV) write the SAME `auto:cwe:<cwe|vuln-mgmt>` note prefix — there is no
    `auto:cve:`/`auto:kev:`. So the `auto:cwe:%` prune filter covers every
    auto link, and no rule family sits outside the pruning path. Confirmed in
    the dev DB: 374/374 auto links carry `auto:cwe:`.
  - **Residue of the uniform marker**: because the link note no longer
    distinguishes family, "which rule created this link" is answerable ONLY
    through evidence rows' `link_basis` — so a link that has not yet produced
    any evidence has no visible family until it does. Acceptable (family only
    matters once evidence exists to discount), documented so it isn't
    discovered as a surprise.
  - **`link_basis` is EVIDENCE-TIME classification, not creation provenance**:
    it is computed against the rule sets CURRENT at the moment the evidence
    row is written, so the "via KEV rule" chip asserts "this link matches the
    KEV rule NOW," not "the KEV rule created this link." Creation-time family
    is unrecoverable under the uniform marker, so evidence-time is the only
    possible semantics — named here so the chip is never misread as creation
    provenance.
  - **One-resolver invariant is now STRUCTURAL**: both the register scope
    filter and the cycle counters call the single
    `services/ctem_scopes.scope_vulnerability_ids` — there is one function, not
    two agreeing implementations. Locked by a hermetic pytest suite
    (`test_ctem_scope_membership.py`) that checks every membership mode against
    independent ground truth, so a future refactor breaks a test rather than
    drifting silently.
  - **Known cosmetic**: evidence reinstated when a link is MANUALLY recreated
    still carries its rule-era `link_basis`, so the chip may read "via KEV
    rule" on a now-manual link. Acceptable provenance (that IS how the
    evidence originally arose), but it reads as a bug cold — documented so it
    isn't mistaken for one.
- **Evidence upsert + audit**: result transitions (pass→fail, fail→pass) on
  effectiveness evidence write an AuditLog row carrying the old result and
  old tested-at before the overwrite, so failure/recovery timelines survive
  the bounded-volume upsert. Same-result refreshes are deliberately not
  audited (that would re-create the per-sync flood the upsert prevents).

## Implementation notes from review

- One-active-model-per-risk is enforced transactionally (row lock around
  promote-and-archive), not by convention.
- Effort estimates assume one developer fluent in this codebase; Phase 1's
  frontend (scenario builder + three chart types + ROI table) is the part
  most likely to strain the 2–3 week window.
