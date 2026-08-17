# CTEM / CRQM audit — 17 Aug 2026

Independent verification pass against the claimed state in
`docs/CRQM_CTEM_BUILD_PLAN.md` (the Open Items ledger) and
`docs/CTEM_VALIDATE_REASONING_PLAN.md`. **Audit only — nothing was changed.**

**Method.** Full backend test suite run once; ledger LANDED items verified in
code (file:line) by two parallel read-only passes; Part 2/3 checks and all
Part 4 data queries run directly against the dev tenant DB
(`grc_complyverse`, tenant `complyverse`, id 1). Facts, not the doc's word.

## Bottom line

The ledger is **substantially accurate**: every LANDED item exists and its
tests pass. **7 divergences** found; two are real correctness holes the
ledger's wording hides (fail-open scope filter; scope filter defeats the
closed-status toggle). No LANDED claim was found to be fabricated.

**Full suite: 435 tests — 432 passed, 3 skipped, 0 failed, 0 xfail, 0 xpass.**
The 3 skips are `pytest.importorskip` guards for cloud SDKs not installed
locally (`azure.mgmt.security`, `google.cloud.securitycenter_v1`, `boto3`) —
`tests/test_asset_inventory.py:198/210/227`. No test files deleted in the last
60 commits; no `skip`/`xfail` marks in source beyond those three importorskips.

---

## Part 1 — ledger LANDED items vs reality

### Phase 1 — CRQM   (all TRUE; engine tests 13/13)
| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1a | `RiskLossModel` + `RiskSimulationRun` models | TRUE | `models/_50_risk_quantification_models.py:23` (`grc_risk_loss_models`), `:89` (`grc_risk_simulation_runs`); columns `scope:108 status:112 seed:121 engine_version:122 currency:123 ale_mean:127 ale_median:128 p5/p50/p90/p95/p99:129-133`, plus `lec_points`, `component_contributions`, `assumptions_snapshot` |
| 1b | Monte-Carlo engine, deterministic | TRUE | `modules/erm/quantification/engine.py:28 ENGINE_VERSION="crqm-1.0.0"`, `simulate():138`, `simulate_portfolio():179`, Beta-PERT `_pert():35`, `rng=np.random.default_rng(seed):154`; drawn seed echoed + persisted (`service.py:323`) so every stored run reproduces |
| 1c | `/erm/quantification/*` routes | TRUE | `modules/erm/routers/quantification.py:39 prefix="/quantification"` under `/erm`; 15 routes incl. loss-models, `/activate`, `/simulate`, `/portfolio/simulate`, `/runs/{id}`, `/summary` |
| 1d | Quantification tab | TRUE | `erm/risks/[id]/page.tsx:394` tab entry, `:526` renders `_components/QuantificationTab.tsx` |
| 1e | Activation auto-baseline run | TRUE | `service.py:182-191` `activate_model` → `run_risk_simulation(trigger="activation")` in try/except; promote/archive row-locked `with_for_update():170` |
| 1f | Portfolio independence caveat | TRUE | stamped in JSON (`service.py:304-306 assumptions_snapshot={"independence":PORTFOLIO_INDEPENDENCE_NOTE}`), surfaced `summary:396`, UI `QuantificationCard.tsx:153` |
| 1g | Engine unit tests | **13/13 pass** | `tests/test_crqm_engine.py` — reproducibility, seed divergence, version stamp, degenerate ranges, monotonicity, LEC shape, portfolio stamp |

### Phase 2 — Control effectiveness   (all TRUE; tier tests 10/10)
| # | Item | Verdict | Evidence |
|---|---|---|---|
| 2a | `grc_control_effectiveness_evidence` table | TRUE | `models/_51_control_effectiveness_models.py:27`; cols `source_type:44 result:45 tested_at:46 details:49 retracted_at:59`, 4 polymorphic control FKs `:37-40`, upsert unique `:74-76`. **`link_basis` is a `details` JSON key, not a column** (`control_assurance.py:198`) |
| 2b | `derive_tier` compute-on-read, no stored badge | TRUE | `control_assurance.py:54-117` — no Session, no I/O; grep `assurance_tier` in models → 0 hits. Minor impurity: reads `os.environ` when `window_days=None` (`:39-43`) |
| 2c | Precedence: newest-fail / closures-cap / 18-mo stale | TRUE (nuance) | newest fail `:73-81`; closures cap at `remediation_verified` `:95-99,110-111`; `STALENESS_DAYS_DEFAULT=548:36`, stale `:84-86`. **Nuance:** newest *fail dominates at any age* — no staleness decay applied to fails |
| 2d | Tier tests | **10/10 pass** | `tests/test_control_assurance_tiers.py` incl. 548-vs-549 boundary, stale-genuine+fresh-closure→remediation_verified |

### Phase 2.5 — Link coverage   (all TRUE)
| # | Item | Verdict | Evidence |
|---|---|---|---|
| 2.5a | Bulk suggest/accept endpoints | TRUE | `routers/control_links.py:797 GET /control-links/bulk-automap-preview` (zero-write; splits `controls_receiving_links` vs `controls_newly_evidence_eligible`), `:886 POST /control-links/bulk-automap` (perm-gated, one summarized AuditLog) |
| 2.5b | Soft-on-rule / hard-on-manual | TRUE | `control_assurance.retract_link_evidence:316-320` soft sets `retracted_at`, hard `db.delete`; auto-map stale prune uses soft (`cwe_resolver.py:579-590`); manual unlink hard (`control_links.py:530-543`) |
| 2.5c | Provenance gate `auto:cwe:%` | TRUE | `cwe_resolver.py:71 AUTO_LINK_NOTES_PREFIX="auto:cwe:"`, prune filter `:522`, comment `:512-518` "PROVENANCE GATE (load-bearing) … Do not widen this query." |
| 2.5d | Reinstate on relink | TRUE | `reinstate_link_evidence:330-383`, called at `cwe_resolver.py:562-568 reason="auto_link_recreated"` |

### Phase 3 — Scopes & cycles   (TRUE with 2 caveats; tests 17/17)
- **3a shared resolver — TRUE.** `scope_vulnerability_ids` (`services/ctem_scopes.py:97-105`) = `resolve_scope_assets:32` + `_vuln_ids_for_assets:78`.
- **3b both call sites, same composition — TRUE.** Register: `routers/vulnerabilities.py:302-309` imports and calls `scope_vulnerability_ids`. Counters/CC/portfolio/freeze use the inner `_vuln_ids_for_assets` after `resolve_scope_assets` (`ctem_scopes.py:136,245,295,218`). Closed-status exclusion shared via `_LIST_CLOSED_STATUSES` import (`:85`). **→ Divergences #1, #2 below.**
- **3c freeze payload — TRUE.** `ctem_scopes.py:228-231` stores `counts`, `membership_rule_frozen`, `membership_hash`; hash = `sha256(sorted asset ids)` (`:70-76`), algo `"sha256:sorted-asset-ids-v1"`. DB confirms cycle #3 closed carries all three.
- **3d tests — 17/17** (`test_ctem_scope_membership` + `test_ctem_stage_counters` + `test_ctem_command_center`).

### Phase 4 — Choke points   (TRUE; tests 39/39)
- **4a ranking = finding × viable chains — TRUE.** `services/choke_points.py:84-104` latest snapshot per (vuln,asset), skip non-`VIABLE_VERDICTS`, `count=len(chains)`, sort `(-chain_count, vuln_id)`; `ALGORITHM_VERSION="chokepoint-1.0.0:finding-x-viable-chains"`. No shared-step graph. **→ Divergence #5.**
- **4b snapshots self-contained — TRUE.** `ChokePointEntry.chains` JSON holds `[{asset_id,snapshot_id,verdict}]` (`models/_53_choke_point_models.py:52-58`); `ReachabilitySnapshot` owns `ReachabilityStep` children (`_22_…:439-500`). No mutable rollup table. **`viability` derived at read time, never a stored column.**
- **4c first_seen first-write-wins + no-stamp flag — TRUE.** `choke_points.py:220-236` add-only-when-null; `persist_snapshot(stamp_first_seen=True):177` with `if not stamp_first_seen: continue:217`; DB backstop `UniqueConstraint uq_choke_first_seen`.
- **4d tests — 39/39** (`test_choke_point_first_seen` 4, `test_choke_points` 7, `test_reachability_batch` 3, `test_reachability_history` 16, `test_verdict_viability` 9).

### Phase 5 — ITSM   (TRUE; tests 9/9)
- **5a partial unique index — TRUE.** `models/_54_itsm_ticket_link_models.py:62-65 Index("uq_vuln_ticket_link_live", tenant_id, vulnerability_id, connection_id, unique=True, postgresql_where="resolved_at IS NULL")`. **DB-confirmed** present. (Keys on `tenant_id` too.)
- **5b applied-not-verified — TRUE.** `itsm_service.py:32 _ADVANCE_STATUSES=("resolved",)`; `:188-201` sets `plan.status="applied"` gated on `plan.status in ("recommended","approved")` & `plan_advanced_at is None`; `closed` excluded; `"verified"` never written.
- **5c push creates a plan — TRUE.** `_ensure_remediation_plan:64-102` creates `status="approved"`, `source="itsm"`, `approved_by_name="ITSM push · {conn}"`.
- **5d idempotent push — TRUE.** `itsm_service.py:110-122` queries live link (`resolved_at IS NULL`); returns existing `external_ticket_id`, `created:False`, no adapter call.
- **5e tests — 9/9** (`test_itsm_mobilisation.py`).

**Live proof (B1, 17 Aug):** connection #16 (`servicenow`, ticketing, connected,
`https://dev396862.service-now.com`); VULN-284 pushed → `INC0010001`
(`grc_vuln_ticket_links` #1, 09:56:45); Mobilise tile 0→1. Remaining user-side:
Resolve INC0010001 → sync → plan `applied` → reopen re-ticket.

---

## Part 2 — Validate reasoning layer

- **P0 matcher fix — TRUE.** Hierarchical `_control_matches` (`cwe_resolver.py:175`);
  self-check PASS — 0 substring leaks (`4.1`↛`9.4.1`, `3.4`↛`9.3.4`,
  `7.1`↛`12.7.1`, `A.8.8`↛`AA.8.8`), keeps `4.1→4.1.1`, `RA-5→RA-5(1)`,
  `DE.CM→DE.CM-8`, `ID.RA→ID.RA-1`.
- **L0 / L1 / L2 NOT built.** grep `ControlMappingDecision|corpus_version|weakness_key|auto:reasoned` → nothing. Only P0 done, exactly as claimed.
- **Current mapping = 100% deterministic.** 25-CWE hand table
  (`cwe_control_map.py`, `grep -c "CWE-…:" = 25`) + 2 rule sets
  (`ALWAYS_APPLICABLE_VULN_MGMT:40`, `ALWAYS_APPLICABLE_ACTIVE_EXPLOITATION:60`).
- **Any LLM control-mapping today?** Yes but opt-in and barely used: the P5
  human-approved proposal path (`services/ai_control_mapping.py`,
  `ai_control_proposals.py`) — nothing links without a human Accept
  (`accept_proposal` is the only writer of the link). DB: **1** `ai_suggested%`
  link accepted. The *automatic* crosswalk uses **no LLM**.

---

## Part 3 — known-open items

| Item | Expected | Verdict |
|---|---|---|
| 4 gap findings 127/131/134/273 | un-keyable, DECLINED | **TRUE** — all: no CVE, no CWE, no vector, 0 links |
| Prioritized non-vacuity test | exists | **TRUE** — `test_ctem_stage_counters.py:69 test_prioritized_excludes_out_of_scope_finding` |
| E4 "still just documented" | (your premise) | **FALSE — E4 is BUILT.** `verdict.derive_viability():63`, viable/severed/undeterminable, ledger LANDED, `test_verdict_viability.py` 9 tests. What's *unbuilt* is the newer L1/L2 reasoning — don't conflate. |
| 2 human residuals (role catalogue, viewer UI) | untouched by code | **TRUE** — admin/rbac/role code untouched since 10 Aug; no `seed_default_roles` anywhere |

---

## Part 4 — data reality (dev tenant, live)

| Metric | Ledger/plan | **Actual** | Query basis |
|---|---|---|---|
| Controls with ≥1 linked finding | "~60" | **34** (33 parsed + 1 UCL); 23 findings linked; 178 links | `grc_vulnerability_control_links` |
| Distinct weakness keys (CWE) | "~40" | **18** all / **17** open | `grc_vulnerabilities.cwe_id` |
| Findings no CVE **and** no CWE | "177" | **182** of 205 (201 open) | 20 have CVE, 23 have CWE, 3 CWE-without-CVE |
| Reachability: viable vs unlikely | "starving at 0 viable" | **NOT starving** — 221 snapshots: 3 likely + 4 possible = **7 viable**, 214 unlikely; **6 findings dangerous** | `grc_reachability_snapshots.verdict` |
| CWE source: scanner vs enrichment | — | **20 via CVE→NVD enrichment; 3 scanner-native** (Nessus CWE xref → CWE-327 for TLS 1.0/1.1 findings, `nessus_transformer.py:334`); 0 CVE-bearing findings lack CWE | `nvd_last_synced_at`, `source` |

**CWE list (18):** CWE-20, 22, 94, 122, 129, 200, 289, 327, 346, 347, 359, 400,
428, 441, 862, 918, 1287, 1321.

**Coverage gap (the L2 business-case number).** Of the 18 CWEs in the finding
set, only **6 are in the 25-row hand table** (CWE-22, 94, 200, 327, 862, 918);
**12 are outside** it (CWE-20, 122, 129, 289, 346, 347, 359, 400, 428, 441,
1287, 1321). So **findings carrying two-thirds of the distinct weakness types
get only the generic vuln-mgmt/KEV controls — no specific control mapping
today.** That is the measured case for building L0/L1/L2 (or, as an interim,
hand-adding those 12 rows). Decision deferred to the product owner.

Interpretation: "~60 controls" was pre-matcher-fix inflation (already corrected
in ledger A5 → 33+1). "~40 keys" assumed described-weakness classes would ~2×
the 18 real CWEs; raw CWE count is 18. Phase 4 is no longer starving — viable
chains exist (6 dangerous findings).

---

## The 7 divergences (ranked)

| # | Sev | Divergence | Evidence | Why it matters |
|---|---|---|---|---|
| 1 | 🔴 | Scope filter **fails OPEN** | `vulnerabilities.py:316-320` whole block in `except Exception … "non-fatal"` | A resolver error returns the **unfiltered whole-tenant register**, not an error. Directly contradicts ledger "cannot drift apart"; a scoped view could silently leak every finding. |
| 2 | 🟠 | Scope filter **defeats `include_closed`** | `scope_vulnerability_ids` hardcodes open-only (`ctem_scopes.py:97`) | `ctem_scope_id` + `closed_only=true` returns 0 rows silently; the register's closed toggle is overridden with no signal. |
| 3 | 🟠 | A5 soft/hard retraction split has **no regression test** | grep `tests/` for `retract_link_evidence`/`reinstate` → none | The invariant rests on live inspection (evidence #128); it can silently invert with no failing test. |
| 4 | 🟡 | CRQM **API tests claimed but absent** | only `test_crqm_engine.py` (13); no tenant-isolation/lifecycle/immutability tests | ledger §1.6 overclaims test coverage. |
| 5 | 🟡 | E4 "ONE definition" **not fully DRY** | `choke_points.py:32 VIABLE_VERDICTS` duplicates `derive_viability`'s first branch | same result today; ranking predicate and coverage split can drift if either changes. |
| 6 | 🟡 | `viability` **derived, never persisted** | no column on `grc_reachability_snapshots` | fine in practice; ledger wording implies a stored field. |
| 7 | ⚪ | Wording/robustness nits | `link_basis` is a `details` JSON key not a column; freeze writes `discovered_total` inside swallow-all try/except (`ctem_scopes.py:215-226`) | doc phrasing; a mid-freeze failure commits a partially-populated freeze. |

## Recommended fix order (not done — awaiting confirmation)

1. **#1 fail-open** — narrow the `except` to expected errors and surface a 4xx/5xx
   instead of returning the unfiltered register. Highest priority: silent
   correctness/leakage hole.
2. **#2 closed toggle** — either honour `include_closed` inside the scope path or
   document the override explicitly at the API.
3. **#3 retraction test** — one `test_link_retraction.py` pinning soft-keeps-row /
   hard-deletes / reinstate-on-relink, so A5's invariant can't invert unseen.
4. **#5 DRY predicate** — have `choke_points` import `derive_viability` rather than
   its own `VIABLE_VERDICTS`.
5. **#4 / #6 / #7** — doc corrections + optional CRQM API tests.

---

## Resolution (17 Aug 2026, same day — after audit sign-off)

The two leak-class bugs and their siblings were fixed in priority order. Full
suite after fixes: **438 passed, 3 skipped, 0 failed** (+6 tests vs the audit's
432).

| # | Sev | Status | What changed |
|---|---|---|---|
| 1 | 🔴 | **FIXED** | Scope filter no longer fails open. Resolver error → HTTP 500 ("refusing to return unscoped findings"); 404 for missing scope preserved. `vulnerabilities.py:296-322`. |
| 2 | 🟠 | **FIXED** | `include_closed` threaded through `_vuln_ids_for_assets`/`scope_vulnerability_ids` (default open-only; register passes True). `ctem_scope_id` + `closed_only` now works. Test `test_include_closed_toggle`. |
| 3 | 🟠 | **FIXED** | `tests/test_link_retraction.py` (5 tests) pins the soft/hard/reinstate invariant that lived only in live inspection. |
| 5 | 🟡 | **FIXED** | `choke_points.VIABLE_VERDICTS` deleted; ranking uses `verdict.is_viable_verdict()` (defined through `derive_viability`) — one definition. |
| 4 | 🟡 | **CORRECTED** | Ledger §1.6 CRQM-API-tests claim marked NOT BUILT (left visible as a tracked gap). |
| 6 | 🟡 | **CORRECTED** | `viability` is derived, not a stored column — noted in ledger operational findings. |
| 7 | ⚪ | **CORRECTED** | `link_basis` is a `details` JSON key not a column; freeze partial-commit noted. |

Ledger rows **A7** (fixes #1/#2) and **A8** (fixes #3/#5) added.
**Not changed:** the two human residuals (prod role-catalogue, viewer UI) —
still user-owned. The L2/reasoning build remains OPEN, now with a measured
coverage gap (12/18 CWEs outside the hand table) to justify the go/no-go.

*Audit generated 17 Aug 2026. Resolution applied same day; every fix has a
runnable test.*
