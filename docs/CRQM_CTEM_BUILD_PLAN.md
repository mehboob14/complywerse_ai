# CRQM + CTEM — production build plan

Complyverse GRC platform. Written 2026-08-10, grounded in the actual codebase
(entities, patterns, and dependencies verified — not assumed).

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
  out of 3,529 parsed — a roadmap number, not a hidden gap) and
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
   "Prioritized" has no event table until Phase 4's choke points land and is
   OMITTED rather than faked.
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

Five decisions settled BEFORE code (review front-load):

1. **"Path" is a STORED artifact, never an enumeration.** Count existing
   reachability chains and technique chains (bounded, explainable, already
   persisted) — NOT simple paths enumerated through an exposure→technique→
   asset graph, which is exponential and yields astronomical, meaningless
   counts on a modest estate. A choke point's "paths broken" = the count of
   stored chains whose steps include the remediated node.
2. **Ranking is MARGINAL, not additive.** Chains share steps, so fixing #1
   and #2 does NOT break the sum of their counts. No totals row, no summing
   affordance anywhere — the same law as scope overlap. The ranking reshuffles
   after each sync as fixes land; that is correctness, not instability, and
   the UI should frame it that way.
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

Each is an adapter on the existing `IntegrationConnection` framework (the
`category` field already supports new connector families), built one at a
time, verified against a live instance like the Nessus two-way sync was:

- **EASM** (outside-in discovery): exposed domains, certs, leaked credentials,
  forgotten dev environments → feeds the identity resolver and asset register
  with `source_system` provenance; aggregated exposure classes with
  drill-through to the source tool.
- **BAS** (breach and attack simulation): "did the control fire?" results →
  Phase 2 evidence rows.
- **ITSM** (ServiceNow/Jira): bidirectional remediation sync — push validated
  exposures as tickets, pull status into remediation plans; SLA rollup stays
  in Complyverse.

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
