# SCF Crosswalk Audit — Accuracy, Loopholes, and Fixation Plan

Scope: SCF 2026.2 control plane (1,534 controls, 5,956 objectives), 35 shipped framework libraries (4,022 controls), 14,287 tenant-visible mapping rows (5,202 resolver + 9,085 AI), 239 declarative checks across 65 connectors, and the automation rollup that renders all of it. Seven automated hunts plus three independent human raters on a 4-control sample. Two claims were re-verified during this write-up; both are noted inline.

---

## 1. Accuracy now — with error bars

### The numbers

| | Rater A | Rater B | Rater C | Spread |
|---|---|---|---|---|
| **Overall defensible** | 167/268 = **62.3%** | 169/268 = **63.1%** | 169/268 = **63.1%** | **0.8 pp** |
| resolver | 76/105 = 72.4% | 77/105 = 73.3% | 78/105 = 74.3% | 1.9 pp |
| ai | 91/163 = 55.8% | 92/163 = 56.4% | 91/163 = 55.8% | 0.6 pp |
| CFG-02 (135 links) | 51.9% | 54.1% | 51.9% | 2.2 pp |
| TPM-05 (107) | 68.2% | 68.2% | 71.0% | 2.8 pp |
| VPM-07 (18) | 88.9% | 88.9% | 88.9% | 0 (unanimous) |
| GOV-10.1 (8) | 100% | 87.5% | 87.5% | 1 link |

804 independent judgements. Maximum disagreement on any control's defensible count is **3 links**. On the resolver/AI split the three raters land within 2 rows of each other on 105 and within 1 row on 163.

### Do the raters agree enough for the number to mean anything

Yes — and the *measurement method is not the finding this time*. Three things establish that:

1. **The defensible/indefensible line is stable; only severity grading is noisy.** B scored sound 104 / partial 65 / overreach 35 / wrong 64. C scored sound 101 / partial 68 / overreach 27 / wrong 72. The `sound` bucket differs by 3, but `wrong` differs by 8 and `overreach` by 8 — the noise sits entirely on the overreach/wrong boundary, which is *inside* the indefensible half and never crosses the line being reported.
2. **The metric survives the biggest available scoring-rule disagreement.** Rater B explicitly tested it: if a rater honours CFG-02's imported assessment objectives, ~22 links move partial→sound and **CFG-02's defensible rate is unchanged**. The three raters used materially different rules (A anchored on the AO list, B anchored on the control statement and capped foreign-AO matches at partial, C split password *settings* from authentication *mechanisms*) and still converged within 0.8 pp.
3. **Where they disagree, they disagree on the small, clean controls** (GOV-10.1: one link out of eight), not on the 242 links that carry the volume.

### The error bar that actually matters is the sample, not the raters

- **268 of 14,287 rows = 1.9% of the corpus; 4 of 1,534 controls = 0.26%.**
- **The sample is not random and is not representative.** CFG-02 is the single largest AI fan-in target in the database (80 rows). Sample density is 67 links/control against a corpus mean of 15.8 (14,287 / 903 mapped controls) — **4.2x**. High-fan-in controls are precisely where the pivot fan-out damage concentrates (Loophole L4), so the AI figure is probably pessimistic; VPM-07 and GOV-10.1 are small clean controls, so the resolver figure is probably optimistic.
- Naive binomial SE on 169/268 is 2.95 pp → 95% CI **57.3–68.9%**. But links cluster hard by (control, framework) group and there are only **four clusters**, so the design effect cannot be estimated from this sample at all. The real interval is wider than 57–69% and is not computable from what we have.

**Report it as: roughly 6 in 10 links defensible — 63% on a 1.9% sample, ±1 pp of rater noise and at least ±6 pp of sampling error, with the sample skewed toward the worst controls.** Do not publish a point estimate.

**To get a number worth defending:** 35–40 controls sampled proportional-to-rows, 2 raters, cluster-adjusted → ±3 pp. That is ~2,500 link judgements, about 9 rater-sittings at the observed pace of 268 links per rater per sitting.

### The raters bought information the hunts could not

Three findings came from human rating and appear in **zero** automated hunt, two of them found independently by two raters:

- **swift_cscf.json is renumbered from 3.2 onward** (A and C) — 71 of 212 rows display a different control's text.
- **Assessment-objective contamination on CFG-02** (B and C) — 27 of 35 AOs are foreign, and they make the bad pivot look legitimate.
- **Unpivoted AI outperforms the two-hop path** (A and C) — the counter-finding that redirects the roadmap.

The structural reason the hunts missed swift: **the file is internally self-consistent.** Its own `metadata.document_structure` repeats the bad numbering. No lint over a library can catch a library that is coherent and wrong; that requires the published standard's text or a human who knows it. Budget for the raters permanently.

---

## 2. Loophole inventory

Deduplicated across seven hunts and three raters, ranked by severity × counted blast radius. IDs are referenced by the fixation plan.

| # | Loophole | Mechanism (one line) | Blast radius (counted) | Sev | Fix |
|---|---|---|---|---|---|
| **L1** | Empty collection = silent pass | `_eval_check` builds an offender list; zero rows means zero offenders means unconditional `pass`, and `_CollectError` sets `collected[name]=[]` | **187 of 239 checks** (239 − 52 min_count); **31 of 65 connectors have no min_count at all** → fully green run on zero rows; 45 checks sit on `for_each` resources that swallow the error with no finding; error findings carry `res.get("controls")`, unset on **0 of 170** resources → invisible to every rollup | critical | code |
| **L2** | Connector-granularity binding | Plugin indexed under the UNION of `all_control_codes(provider)`; one shared SOC 2 code credits every check in the connector | 2,560 (control, plugin) pairs; **9,415 credited (control, check) pairs of which 5,160 (54.8%) name no code the control maps to** — 2.21x inflation; CC6.1 declared by 57 of 65 connectors → 1,596 of 2,677 incidences (59.6%); CRY-03 credited 61 plugins / 214 checks, ~10 topical | critical | code |
| **L3** | Run-level status smear | One failing finding fails the whole connector run; that single status is inherited by every SCF control in the connector's code union | **One GitHub 2FA finding on one personal account marks 39 SCF controls "Failing"** across 5 domains incl. CRY-09 key management and NET-06 segmentation; live distribution `{manual 1389, not_run 106, failed 39, passed 0}`; worst connector digitalocean = 6 codes → 103 controls | critical | code |
| **L4** | Hub-clause pivot fan-out | Hop 2 takes *all* SCF controls on an ISO 27002 clause, so broad clauses drag whole unrelated families onto narrow controls | **46 singleton off-domain edges = 1,080 of 8,768 pivot rows (12.3%)**; top-10 edges = 464 rows; CRY-01.2 has 49 requirements, **48 off-topic**; CFG-02 **40–42 of 79 AI links wrong**, identified independently by all three raters (8.3 Information Access Restriction / 8.5 Secure Authentication) | critical | data then code |
| **L5** | Right mapping, wrong text | Four libraries store text that is not the requirement the mapping intended | **swift_cscf 71/212 rows (33.5%), 15 of 31 codes** (verified below); **pci_dss 467/787 rows (59%) / 225 controls truncated at the colon**; **sama_csf 143/161 rows (89%) / 91 controls**; **nis2 69/127 rows (54%) / 26 controls** — ~750 rows total | critical | data |
| **L6** | parent-match ships as exact | Docstring, registry and architecture doc all say parent rows are excluded from conformance; **grep returns zero readers**; `scf_import.py:194` hardcodes `confidence=1.00` | **548 of 5,202 resolver rows (10.5%)**; 330 (framework, control) pairs; **34 controls whose entire framework story is prefix matching**; cobit 190/190 controls parent-only | critical | code + 1 data line |
| **L7** | Unbounded parent depth | `cand.startswith(norm + ".")` with no segment cap and no length floor | 8 of our codes each claim ≥10 SCF codes; sama `3` → 482 codes / 91 controls; **two sama codes account for 691 of 883 parent pairs (78%)** | high | code |
| **L8** | Known-broken libraries ship anyway | No `emit:false`; `startup_seed.ensure_local_framework_catalog` globs the whole directory | sama_csf **161 rows** despite the registry note "LIBRARY IS BROKEN"; **gcrf 75 fictional controls live, `is_active=true`** (`source_organization: "…(fictional)"`); csa_ccm **483 rows at confidence 1.0** over self-declared "synthetic paraphrase"; soc2 **5 fabricated TSC criteria** live | critical | data + ~5 lines |
| **L9** | Direction reversal | `build_scf_bridge.py` never reads `responsible_party`; the regulator's and the exchange operator's duties are credited to the tenant | **321 of 750 doh rows (43%)**; 122 controls; **21 controls whose only doh evidence is a DOH/ADHIE duty** — BCD-01, BCD-01.1, BCD-01.2, BCD-04 are in the audit sample | critical | code + data backfill |
| **L10** | Confidence carries no quality signal | The breadth discount encodes pivot fan-out, never relevance; the group chip is whichever row an unordered query returned first | **0.85 band 62% defensible vs the 0.30–0.43 band 55% — a 7 pp spread over a 0.55-wide range**; 1,029 of 2,618 groups span >1 value, 185 span >0.30; all 5,202 resolver rows pinned at 1.00 including the 548 parent rows | high | code |
| **L11** | False negatives in the UI | Provenance filter hides SCF rows; empty status defaults to the literal `"manual"`; copy asserts an attestation that is not modelled | **527 of the 631 "no crosswalk" controls are mapped by SCF** (2,914 links; 256 to a source we ship; 11 material); **1,389 controls (91%) show "Manual" / "evidenced manually"** with no attestation record, owner hardcoded "Unassigned"; 1,495 of 1,534 carry a status that is not a test result | high | code/copy |
| **L12** | 800-53 enhancements dropped | No enhancement→base normalizer; 518 of SCF's 810 codes are `AC-02(01)` form, our library is 148 base controls | **777 → 198 controls (579 lost)**; 840 of 1,117 published links discarded; **217 of the 631 "no crosswalk" controls (34%) are pure normalizer misses**, not genuine gaps | high | code (1 regex) |
| **L13** | NIST CSF resolves to zero | Library is CSF 1.1, SCF crosswalks CSF 2.0; `grc_scf_source.framework_slug` is NULL on `nist_csf_20`; nothing asserts a framework emits >0 rows | **250 controls / 611 published links dropped**; 46 library controls dead weight; framework silently absent from the picker because the list is built from rows that exist | high | data + normalizer + assertion |
| **L14** | First-wins requirement index | `idx.setdefault(cid, row)` on non-unique join keys — file order decides which requirement is cited | **106 library rows unreachable**; **125 mapping rows over 71 controls** render an arbitrary sibling and report `resolved: true` (sama 89 collisions, nis2 17) | high | code (6 lines) |
| **L15** | Clone sets | Hop 2 names a clause, not a control, so two controls sharing a clause set receive identical evidence forever | **62 sets covering 212 of 293 pivot-fed controls (72%)**; 5,472 of 8,768 rows (62%); 25 sets pair a programme control with its execution sub-controls — BCD-01/-01.1/-01.2/-04 carry the same 50 requirements | high | re-author (no data fix) |
| **L16** | Cap truncates by alphabet | `sort(key=(-confidence, requirement_code))` then `[:8]`; confidence is tie-heavy so the code *string* decides | **3,733 rows dropped (30% of the post-floor corpus)** across 401 truncated pairs, **340 of them cut mid-tier by string order**; 459 pairs sit at the cap; no truncation signal anywhere in the API | high | code |
| **L17** | Trivially-true check kinds | `present` hardcodes the literal `"pass"`; 51 of 52 `min_count` checks use `min=1` | **83 of 239 checks (34.7%)**, 3,071 of 9,415 credited pairs; **4 connectors (one_password, clickup, intercom, confluence) are entirely trivial** → unconditional `passed` whenever the token authenticates; `servicenow.admin_least_privilege` passes with up to 20 admins | high | code (1 line) + data |
| **L18** | A1.2 fans to 37 controls | Two backup checks assert A1.2; `sub_type` is gated on `linked` being non-empty | **17 Physical & Environmental controls marked "Automated" by DigitalOcean droplet backups** — incl. EMP Protection, Fire Suppression, Emergency Lighting, Water Damage Protection; plus 18 BCDR controls; 170 + 180 control-check pairs | high | data + code gate |
| **L19** | Assessment-objective contamination | AOs imported with the crosswalk carry another control family's objectives; the UI presents them as *this* control's testable objectives | **CFG-02 ships 35 AOs of which A09–A35 are access-control / wireless / logging / authentication**, absorbed via NIST 800-171r3 A.03.05.07 and A.03.01.03 — every wrong link L4 dumps on CFG-02 has a matching AO to point at. **Corpus count not measured** (measurable: scan objectives.json for foreign ODP tokens) | high | data, uncounted |
| **L20** | No error state end to end | `live_api_runner` never inspects `"error"`; `run_provider` turns 401/403 into `"fail"`; `_aggregate_status` ranks failed above error | All 65 connectors / 145 automated controls; **every expired token displays to an auditor as a failing control**, indistinguishable from a real failure | medium | code (3 lines) |
| **L21** | No expiry, no coverage | Latest run is authoritative forever; statuses appended only inside `if run:` | `SCFControl.conformity_cadence` **already populated (130 Annual / 10 Semi-Annual / 5 Quarterly) and already returned**, never used; run 1 was authoritative for 17 days; **a control bound to 58 plugins reads "passed" when 1 answered** — 67 controls are bound to ≥10 | medium | code |
| **L22** | No build-time gate on anything | `expected` baselines matched-code counts only and is `null` on the two entries flagged untrustworthy; no join-key uniqueness/shape gate; `scf_version` never checked against manifest.json | **0 of 5,202 resolver rows and 0 of 9,085 AI rows are guarded by any count or digest assertion**; the iso_27001 re-point below leaves `93 ok` on the tripwire; this absent gate is what let L5, L8, L13 and L23 all ship | medium | code |
| **L23** | iso_27001 double-binding | `scf_keys` includes `iso_27001_2022` (management clauses 4–10) whose bare numbers collide with Annex-A after `strip_prefix:A.` | **12 codes collide; 36 rows, 35 net-new, 33 controls wrongly attached at match_mode='exact'**; A.7.3 alone pulls 11 awareness controls (HRS-03.1 shows "A.7.3 / Securing Offices, Rooms and Facilities") | high | data (delete one array element) |
| **L24** | Non-obligations mapped | No obligation-verb check; citation stubs and commencement clauses pivot like controls | sbp_internet_banking 5(a)–(d) are bare circular citations → **42 rows / 26 controls confirmed**, rendered on BCD-01 as BCMS evidence; band of 114 short non-obligation requirements emits **687 rows (7.8%)** as the upper bound | medium | data + guard |
| **L25** | Denominators overstated everywhere | Headline counts the catalog, not the crosswalked subset | 903 of 1,534 crosswalked shown as "1534 controls / 31 frameworks"; **QTS 0/34, EMB 1/19, AAT 62/161**; 885 of 4,022 library rows unmapped and shown active; 145/1,534 automatable and 41/163 material controls have any check; **45 of 60 mapped SOC 2 codes have zero checks** | medium | code/copy |
| **L26** | STRM strength does not exist | Re-verified today: `mappings.csv.gz` header is `release_version, scf_id, source_slug, requirement_code, relationship, provenance` and **all 69,791 rows read `intersects-with`**; `build_scf_seed.py:248` hardcodes the literal | The one field that separates a `subset-of` from a weak intersect is absent from the entire pipeline. Estimated **~10 of 105 sampled resolver links** turn on it (800-171 r2 `3.1.1` on TPM-05, soc2 CC9.1 on TPM-05). **Cannot be recovered from the repo** | high | upstream re-extraction |
| **L27** | Breadth shown, depth hidden | `requirement_count` and `framework_count` are prominent; `ao_count` is never paired with them | **103 controls exceed 10 requirements per objective, 49 exceed 20, 87 pair ≥10 frameworks with ≤3 objectives**; worst BCD-01.2 = 68 requirements / 1 AO / 14 frameworks | medium | code (1 field) |
| **L28** | Minor, counted | 12-cap applied before counting (16 pairs / 11 controls; GOV-02 175 true vs 147 delivered; rail shows 12 of 22 with no overflow marker); `Hybrid`/`passed` filters return a blank table with no empty state; `partial` and `error` pills are pixel-identical; "Evidence" tab renders plugin runs; Overview panel blank on all 1,534 (`description: None` hardcoded in the list payload); 5,956 objectives never reach a screen; nis2 carries a dead `scf_key` contributing 0 rows | low | code |

**Two reconciliations between hunts, for the tickets:**
- Vacuous-pass count: the checks hunt says 143 (the four offender-list kinds); the rollup hunt says 187. **187 is correct** — `present` (32) and `max_count` (12) also pass on zero rows. 239 − 52 min_count = 187. Use 187.
- Cap: **401** pairs were *truncated*; **459** sit at exactly 8 (58 arrived there naturally).

---

## 3. The fixation plan

### (a) Ship-blockers — the product currently makes affirmatively false statements about a tenant's compliance state

**S1 — Empty collection is not a pass.** (L1, L17, L20)
Changes: `backend/grc/modules/compliance_plugins/runners/evidence_engine.py` — `_eval_check` returns `not_run`/`error` when `considered` is empty for the four offender kinds and for `present`; set a `_collect_failed` flag in the `except _CollectError` handler (~:279) so checks on a failed resource emit `error`; default `res["controls"]` to the union of its checks' controls. `live_api_runner.py:36-41` — add `elif "error" in statuses` ahead of the pass branch. `present` emits `"info"`, not `"pass"`.
Effect: **187 of 239 checks stop manufacturing green**; the 31 connectors with no `min_count` can no longer report `passed` on zero rows.
Effort: ~10 lines and one self-check.
Verify: extend the existing `__main__` self-check in evidence_engine.py with an empty-rows case per kind asserting `status != "pass"`; re-run the offline 403 repro and confirm `github.repos_not_public` / `default_branch_protected` / `members_all_have_2fa` no longer read pass.

**S2 — Bind checks, not connectors.** (L2, L18, L28-checks_count)
Changes: `backend/grc/modules/automation/router.py` `_plugins_by_control_code` (~:274) returns `(plugin, filtered_checks)` where `check["controls"] ∩ control's SOC 2 codes`; drop the plugin when the subset is empty. The data already exists on every check.
Effect: removes **5,160 of 9,415 credited pairs (54.8%)**; kills the CC6.1 junk-drawer (1,596 of 2,677 incidences); fixes `checks_count`, `sub_type` and the 39-control smear **in one place**, because `/library`, `/common-controls`, `/controls/{scf_id}` and `/collectors` all call this function.
Effort: half a day.
Verify: recompute the credited-pair count and assert it equals the **4,255** topically-bound pairs the checks hunt counted; assert CRY-03 drops from 214 credited checks to ≤15 and no longer lists `slack.users_mfa`.

**S3 — Status must name its own scope.** (L3, L21)
Changes: replace the four `statuses.append(run.status)` sites (router.py :630, :749, :815, :995) with a helper that walks `run.raw_output["findings"]`, keeps findings whose `control_codes` intersect the control's own codes, and aggregates those; append `not_run` for linked plugins with no run; add `not_run`/`stale` ranks to `_aggregate_status` and `ran/linked` counters to the payload.
Effect: the 39 controls stop showing "Failing" for one personal GitHub account's 2FA flag; "passed" can no longer mean "1 of 58 answered".
Effort: ~30 lines.
Verify: re-run `list_common_controls` on tenant 1link and assert the failed set shrinks from 39 controls to those actually carrying CC6.2.

**S4 — Suppress the hub clauses.** (L4)
Changes: add `suppress_edges: [[iso_clause, scf_id], …]` to `backend/grc/seed_data/scf/crosswalk_registry.json`, filter hop 2 in `tools/build_scf_bridge.py`. Seed it with the 10 highest-volume off-domain edges (464 rows), then the full 46 (1,080 rows), plus the rater-identified `8.3→CFG-02` and `8.5→CFG-02`.
Effect, measured on the rated sample: removing CFG-02's ~40 access-control passengers takes the sample from **169/268 (63%) to ~169/228 (74%)** and AI from **56% to ~74%**. Corpus-wide the equivalent is the 1,080 passenger rows (12.3% of the pivot corpus). **20 SCF controls lose their entire authored evidence — all 20 only ever had passenger rows, so no legitimate link is lost.** This fix removes wrong links; it does not add right ones. Coverage will drop and should.
Effort: one day including re-emit and re-seed.
Verify: re-rate CFG-02 alone (79 AI links → expect ~35) and confirm the wrong-subject clusters are gone (qcb 10.10.3/10.10.4/10.11.5/10.12.8, sabic 3.1/3.2/7.3, sbp_internet_banking 2.2.1(b)/(c), aramco 4.1/4.2).

**S5 — Stop shipping what the registry already says is broken.** (L8, L23, L24)
Changes, all small: delete `gcrf_global_cyber_resilience.json`; remove `scf_keys` from the `sama_csf` registry entry; delete `"iso_27001_2022"` from the iso_27001 entry's `scf_keys`; delete the four sbp_internet_banking 5(a)–(d) mappings; add `"emit": false` honoured in `scf_crosswalk.main()`; add an allowlist to `startup_seed.ensure_local_framework_catalog` (:152) so a file dropped in the directory cannot reach a tenant.
Effect: −161 sama rows (143 of them junk) / 91 controls; **−35 wrong iso_27001 rows / 33 controls**; −42 stub rows / 26 controls; −75 fictional controls out of the tenant catalog.
Effort: one afternoon.
Verify: resolver total moves 5,202 → ~5,006 and the diff contains no `match_mode='exact'` rows we intended to keep; `grc_uploaded_frameworks` no longer contains GCRF.

**S6 — Fix the four broken libraries.** (L5)
`swift_cscf.json` — **confirmed by inspection today.** Codes 1.1 through 3.1 match published CSCF v2024; **3.2 onward do not.** Our file: 3.2 Password Policy (real **4.1**), 3.3 MFA (real **4.2**), 4.1 Logging and Monitoring (real **6.4**), 4.2 Intrusion Detection (real **6.5A**), 5.1 Incident Response (real **7.1**), 5.2 Training (real **7.2**), 5.3 Penetration Testing (real **7.3A**), 5.4 Scenario-based Risk (real **7.4A**), 6.2 Token Management (real **5.2**), 7.1 Database Integrity (real **6.3**), 7.2 Malware Protection (real **6.1**), 7.3 Software Integrity (real **6.2**). Real 5.1 Logical Access Control and 5.3A Staff Screening are missing entirely; `metadata.document_structure` repeats the bad numbering. Half a day, 31 rows, published numbering is public. Fixes **71 rows / 33.5%** of swift.
`pci_dss.json` — re-extract 106 truncated requirements with their bullets; stop writing `description == full_text`. Two days. Fixes **467 rows / 225 controls**.
`sama_csf.json` — re-extract one row per numbered subdomain (3.1.1..3.4.x), no `N/A`, no prose ids. Two days. Removes 89 duplicates and 20 blanks.
`nis2.json` — one row per citable provision; delete the 13 "Derived from" rows. One day. Fixes **69 rows / 26 controls**.
Verify: add the lints in S-Q10 below and re-score VPM-07's `swift_cscf 7.3` link — it should flip wrong→sound for all three raters, since SCF's mapping was correct all along.

**S7 — Honest copy.** (L11, L25, L28)
Six strings in `soc2-controls/page.tsx`, `[code]/page.tsx`, `components/soc2/ui.tsx`: split the empty state into the 527 case ("SCF maps this control to N upstream sources we do not carry") and the 104 case ("No crosswalk in SCF 2026.2"), and delete "no framework you have selected" — there is no selector on that page; `"Manual"` → `"Not assessed"` and remove "evidenced manually" (1,389 control pages); header → "{crosswalked} of 1,534 crosswalked to 18 SCF-published + 13 authored"; prefix the status pill "Collector:"; `"Automated"` → `"Automated (inherited)"` until S2 lands; add the missing zero-row empty state.
Effect: the two largest false statements the product makes — on 1,389 and 527 control pages — stop being made.
Effort: one hour. Verify: read the strings.

### (b) Quality wins

| | Change | File | Effect | Effort |
|---|---|---|---|---|
| Q1 | Select `match_mode`, badge it, write `confidence 0.4` for parent rows | `router.py` list query, `scf_import.py:194` | 548 rows / 330 pairs stop reading as exact at 1.00 | ~5 lines |
| Q2 | One-segment bound on parent match; refuse codes <3 chars | `scf_crosswalk.py:139-142` | kills 691 of 883 parent pairs at source | ~5 lines |
| Q3 | `idx.setdefault` → list append; render every sibling | `router.py:889` | 106 hidden library rows surface; 125 rows / 71 controls stop citing an arbitrary sibling | 6 lines |
| Q4 | Enhancement→base normalizer (strip trailing `\(\d+\)`, tag `parent`) | `scf_crosswalk.py` | 800-53 goes 198 → up to 777 controls; **217 of the 631 "no crosswalk" controls recover** | 1 regex |
| Q5 | CSF 2.0 library + `framework_slug='nist_csf'` on `nist_csf_20` + zero-pad normalizer | seed data + tools | recovers 250 controls / 611 links from zero | 1 day |
| Q6 | `responsible_party` guard + `assessed_party` per registry entry | `build_scf_bridge.py` | doh 750 → ~429 rows; 21 controls stop citing a regulator's duty as the tenant's | 6 lines + data backfill |
| Q7 | Persist the pivot clause; badge direct rows `pivot='direct'` — **do not penalise them** | AI mapper + schema | makes "everything that pivoted through 8.5" a query instead of a re-run | 1 column |
| Q8 | Per-row confidence; show a range or drop the group chip; add `ORDER BY` | `router.py:934-941` | 1,029 of 2,618 groups stop displaying a number true of at most one row | ~10 lines |
| Q9 | Tie-break on pivot breadth (already on the row); carry a `truncated` count | `build_scf_bridge.py` + API | 340 of 401 truncated pairs stop being cut by alphabet; "showing 8 of 23" becomes possible | ~10 lines |
| Q10 | **Build gates** — join-key uniqueness/shape per library; `expected` becomes `{matched, rows, digest}` and `null` is a hard failure for any emitting entry; manifest version vs registry `scf_version`; every registry framework must emit >0 rows | `build_scf_seed.py`, `scf_crosswalk.py` | this absent gate is what let L5, L8, L13 and L23 all ship. Run it against today's tree: it must fail on sama, nis2 and nist_csf before the fixes and pass after | half a day |
| Q11 | 401/403 → `error` not `fail`; surface errors alongside failed | `live_api_catalog.py:366-369`, `router.py` | an expired token stops looking like a failing control on all 65 connectors | ~5 lines |
| Q12 | Max-age cutoff driven off `conformity_cadence`; `stale` rank | `router.py:212-229`, `_aggregate_status` | the cadence data is already populated and already returned — it just needs reading | ~10 lines |
| Q13 | Retune `min_count` mins (51 checks at 1); `servicenow` max 20 → single digit | `connector_checks.json` | 1,925 credited pairs become real assertions | data |
| Q14 | Push `description`/`control_question`/objectives into the list payload | `router.py` list branch, `[code]/page.tsx` | the Overview tab is blank on **all 1,534** controls and the 5,956 objectives never reach a screen | ~20 lines |
| Q15 | Publish the real denominators: crosswalked/total in the header, mapped/total per library on the tile (885 of 4,022 unmapped), `requirements_per_ao` on the detail (103 controls >10), true bucket size for the 12-cap (16 pairs / 11 controls disagree today) | router + frontend | turns 885 silent orphans into a tracked backlog | 1 day |

### (c) Later

- **Clone sets (L15).** 212 controls / 5,472 rows cannot be separated by any data edit — the authored artefact records a clause, not a control, so the discriminating information was never captured. Either re-author hop 1 to name `scf_ids` directly (the schema already has the field; 2 of 13 frameworks use it) or add a hop-2 disambiguation scoring the source text against `objectives.json`. Cheap interim: mark clone-set membership on the row so the UI says "shared with BCD-01.1, BCD-01.2, BCD-04".
- **Author checks against the 45 unused SOC 2 codes** and rebind `connector_checks.json` to SCF ids, which the comment at `router.py:717` already anticipates. Today 1,389 of 1,534 controls can never be automated and 122 of 163 material controls have no check.
- **sox / iso_45001.** Re-key sox to statutory citations (17 SCF codes to match, small file) or drop both. 165 library controls permanently dead.
- **ISO 27002:2022 clause text into the repo** (licence-gated, same gate as SCF text) so the 3,283 hop-1 choices become reviewable, plus a `dropped_clauses` field so a silent compiler drop stops looking like a deliberate refusal — 88 mappings ship in that ambiguous state today.

### What we CANNOT fix — needs a compliance reviewer or an upstream re-extraction

1. **STRM relationship strength is gone, one step upstream of this repo.** Verified today: `mappings.csv.gz` carries a `relationship` column in which all 69,791 rows read `intersects-with`, and `build_scf_seed.py:248` hardcodes that literal so the column could never carry anything else. SCF grades each cell (equal / subset-of / superset-of / intersects-with) and that grade is exactly what separates a rater's "sound" from "overreach". It was lost when the SCF workbook was converted. Nobody can restore it from the seed files — **it needs a re-extraction from the SCF 2026.2 source with the STRM column preserved.** Until then every resolver row carries confidence 1.00 whether SCF called it equivalence or a weak intersect. *(This resolves a conflict between hunts: the resolver hunt was right that nothing is being discarded at seed time, and Rater A was right that the field is dead — because the loss happened before the file this repo reads.)*
2. **SCF's own wrong-subject cells.** After removing our-side defects (swift mistexting, sama parent rows, the 800-171 r2/r3 version-skew pick), a residue of **~10 of 105 sampled resolver links (≈10%)** is SCF's published judgement, rendered faithfully, and still wrong: soc2 **CC9.1** (business-disruption and insurance) on TPM-05, nist_800_171 **3.3.3** (review logged events), iso_27001 **A.8.12** (DLP) and **A.8.3** on CFG-02, swift **5.2** (awareness training) on CFG-02. No normalizer touches these. They need a named reviewer maintaining a per-cell suppression list with reviewer and date on the row. **That residue is the ceiling: resolver defensibility cannot exceed ~90% without it.**
3. **Assessment-objective contamination (L19).** Deciding which AOs legitimately belong to a control is a standards judgement. We can measure the exposure cheaply — scan `objectives.json` for ODP tokens whose source family differs from the control's domain — but only a reviewer can prune CFG-02's A09–A35 back to configuration management. Until they do, L4's bad links have an on-screen justification and an assessor challenging "why is 3D Secure evidence of a hardening baseline?" wins.
4. **Direction of obligation on the 11 libraries with no `responsible_party` field.** The guard is 6 lines; deciding who owes each requirement is per-requirement reading. `ksa_pdp_transfer_to_scf.json` proves the standard was met once — 10 of 21 articles deliberately unmapped with explicit rationales ("a duty of SDAIA, not of a controller"). The other 12 frameworks need the same pass.

### One hunt recommendation to NOT implement

The pivot hunt proposes penalising the 374 direct one-hop AI rows (`score * 0.7`) because they have no intermediate artefact to review. **The rater evidence says the opposite.** Direct rows were the best data in the sample: GOV-10.1 (ndmo, no pivot) scored 7–8 of 8 across three raters, and ksa_pdp_transfer on TPM-05 (no pivot) scored 3 of 3. Badge them (`pivot='direct'`) so the empty column stops reading as "no pivot needed"; do not discount them. The finding inverts the roadmap: **direct SCF-id selection outperformed the two-hop path on every control where both appeared**, which is the strongest available argument for the L15 re-authoring.

---

## 4. What to tell a customer today

> This is a **crosswalk index, not an assessment.** It re-keys the Secure Controls Framework's own published mapping of 1,534 controls to 249 sources into the 35 framework libraries we ship, and — for 13 frameworks SCF does not map — adds machine-authored links routed through ISO 27002:2022. Three independent reviewers scoring 268 links across four controls found roughly **6 in 10 defensible** against the control's text (62–63% on the sample; SCF-derived links 72–74%, machine-authored links 56%), on a sample that is 1.9% of the corpus and deliberately weighted toward the highest-fan-in controls. **Use it to discover which of your obligations plausibly land on the same control and to organise evidence collection. Do not use it as evidence that a requirement is satisfied, and do not cite a link in an audit without reading the underlying requirement.** The "Automated" label and the pass/fail pill currently mean "a connector is bound to a SOC 2 criterion this control shares" — not that anything about this control was tested: 55% of the checks credited to a control name no criterion the control maps to, and a check reports pass when the connector collects nothing. 41% of the catalog shows no framework requirement, and for 527 of those controls that is our coverage gap, not an absence of obligation.

**Three sentences to stop saying immediately:**
- "1,534 controls crosswalked to 31 frameworks" — it is **903 of 1,534**, to 18 SCF-published plus 13 machine-authored.
- "This control is evidenced manually" — nothing is; there is no attestation record, and it appears on **1,389 control pages**.
- "No framework you have selected requires it" — false for **527 controls**, and there is no selector on that page.

---

## 5. What is genuinely sound

- **Catalog integrity.** 1,534 controls, 5,956 objectives, 249 sources, 810 ERL links, 163 material, all FKs resolved. `SCFControl.ao_count` matches `count(*)` on the objectives table for all 1,534 controls — zero mismatches, no control with zero objectives. Only **104** controls are true orphans with no mapping of any provenance.
- **The mapping judgement really is SCF's.** `resolve()` translates code formats and then looks the pair up in SCF's published index; it never invents an `scf_id`. Resolver rows are strictly a re-keying of the 69,791-row SCF crosswalk.
- **Symmetric normalization works.** Both sides run through `apply_normalizers` with the same steps, so the HIPAA `§ 164.306` / `§164.306` and GDPR `Article 5(1)(a)` / `Article 5.1(a)` gaps genuinely cancel, with **zero normalizer collisions on either side in all 19 mapped entries**. Where codes are real, they land: 8 of 19 libraries resolve 100% — iso_27001 93/93, pci_dss 205/205, nist_800_53 148/148, nist_800_171 110/110, cis 153/153, iso_42001 70/70, nist_airmf 72/72, cobit 40/40.
- **Determinism and no staleness.** 6,573 raw rows → 5,202 unique in `resolved.csv.gz` → exactly 5,202 in the DB with the same per-framework and per-mode split. Registry, seed and live DB agree.
- **Hop depth is genuinely capped at 2.** Every one of the 9,085 AI rows is either `pivot_via_slug='iso_27002_2022'` (8,711) or a direct authored row (374). No third hop exists; `subset-of` is never chained. All 3,283 authored clause references resolve to real pivot codes and the 3 non-control codes SCF carries for ISO 27002 are referenced by zero mappings.
- **The precision pass is real and correctly implemented.** 17,085 emitted → 12,480 after the 0.20 floor → 8,768 after the cap; the breadth discount is `min(1, 3/breadth)` applied per-clause; no shipped pair exceeds 8 across all 2,618 groups; 172 rows sit exactly at the floor and are not rounded up.
- **Every row is auditable.** `provenance`, `confidence`, `pivot_via_slug` and `requirement_code` are all on the row — the only reason this entire analysis was reproducible from the seed files. Most crosswalk pipelines discard the intermediate.
- **Requirement-text resolution is honest and complete.** Replaying `_requirement_index()` against all 14,287 rendered rows yields **zero unresolved codes**. The per-entry `join_field` override is doing real work — dora, nis2 and iso_42001 join on `original_reference`, and a naive `control_id` join would have shown 0% for all three. Codes with no library text are marked `resolved: false` rather than printed as if the code were the requirement.
- **The check bodies are real.** For the 143 offender-list kinds the predicate is genuinely falsifiable when rows exist (`slack.users_mfa` all_true on `has_2fa`; github repo visibility `none_match` public). `_op` guards TypeError, `skip_if_field_true` correctly excludes bots and service accounts, fan-out is capped, and the `__main__` self-check exercises four kinds and passes. Zero orphan check→resource references, zero plugins claiming coverage with no spec, zero dead SOC 2 assertions. **`min_count` is the correct shape the other 187 checks should copy** — it is the only kind that fails on empty input.
- **Plugin de-duplication and run selection are correct** in all four rollup paths: a `seen` set on plugin id means one plugin cannot vote twice, and `_latest_runs_by_plugin` is tenant-scoped and deterministic, so no cross-tenant evidence leaks.
- **Provenance is uniform within every group** — 0 of 5,673 (control, framework) groups mix resolver and ai rows, and no framework slug carries both. The group-level ProvenanceChip is telling the truth about provenance; only the confidence number inside it is unreliable.
- **The library corpus is otherwise clean.** Zero controls with text under 20 characters in all 35 files; zero placeholder tokens across 4,022 rows; effectively no cross-control verbatim duplication (worst file: 3 duplicate bodies out of 195); `control_id` unique in 34 of 35 files.
- **The intent to not overstate is already in the code.** The `>10 frameworks` banner says exactly the right sentence — "A high count is crosswalk breadth, not extra assurance". The ProvenanceChip tooltip says "Authored by us via {pivot}. Not an SCF-published mapping." `resolved: false` is surfaced. The Run-test button is correctly disabled with no checks. "Showing 0 of 1534" is numerically honest.
- **`crosswalk_registry.json` is unusually honest prose.** It already documents the SOC 2 fabrications, the CSA synthetic text, the COBIT parent overclaim, the SAMA breakage, the version skews, and decision D7 excluding GCRF. **The registry is right about nearly everything; nothing enforces it.** That is the single most repeated shape in this audit — the spec exists, the gate does not — and Q10 is the item that closes it permanently.
- **`ksa_pdp_transfer_to_scf.json` is a working demonstration of the correct authoring standard**, with 10 of 21 articles deliberately unmapped and explicit rationales naming the reason. The standard exists and was met once. Encode it in the compiler and it will be met thirteen times.