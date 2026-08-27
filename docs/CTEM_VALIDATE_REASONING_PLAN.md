# CTEM Validate — from a hand table to reasoned, re-runnable control mapping

Plan of record. Written 17 Aug 2026 after the crosswalk audit (commit `becf5ea`).
Status of each phase is tracked at the bottom. Ledger rows: A5 (matcher fix,
landed) and A6 (this plan) in `CRQM_CTEM_BUILD_PLAN.md`.

**Correction first, plan second.** The Phase 2.5 review verified consent
mechanics, counting reconciliation, retraction and provenance - nobody read
ten links against their control statements. The substring leak and the PCI
version drift lived in that unexamined layer; the user's "how do you get 50"
found them. Mechanical reconciliation is not semantic validation. This plan
makes semantic checking part of the definition of done (rationale per link,
battery on a WITHHELD holdout).

## 0. Why this exists

Validate answers two questions:

* **A. Which of the tenant's controls SHOULD stop this weakness?** (mapping)
* **B. Do those controls actually WORK?** (effectiveness — evidence-derived tiers)

B is sound: tiers are derived at read time from dated evidence (retests, scanner
closures) and never stored. **A is not production-grade.** Today it is a
25-row hand-written CWE→code table plus two always-applicable rule sets, matched
against uploaded frameworks by control *number*. Found live on the Desktop-estate
scope:

| Defect | Evidence |
|---|---|
| Coverage | Scope has 17 distinct CWEs; table knows 25 CWEs total; anything outside gets only generic patch-management controls. 177 no-CVE findings get nothing. |
| Meaning | Codes matched by number, never by statement. PCI v3.2.1 numbering in the table vs v4.0 upload: `6.5.x` now means change management, `4.1.x/7.1.x` are policy sub-reqs. |
| Explainability | No rationale, no confidence, no provenance on a link. |
| Mechanics (fixed) | Substring matching leaked `4.1` into `9.4.1`, `3.4` into `9.3.4`… — 16 of 38 PCI links were noise; CSF links were accidents. Fixed in `becf5ea` (hierarchical match; real CSF rule). |

## 1. The requirement (user's words, kept)

> Whenever validation happens it has to consider all vulnerabilities against all
> our controls, with reasoning, and find the technical controls linked to each
> vulnerability. Reasoning has to happen again and again.

Accepted, with one mechanical correction: not N findings × M controls LLM
judgments per run (201 × 3,500 ≈ 700k; a bank at 10k findings ≈ 35M — slow,
costly, non-deterministic, unauditable). Instead:

> **Reason once per (weakness type × control corpus version). Store the decision
> with rationale/confidence/provenance. Apply it deterministically to every finding
> with that weakness. Re-reason automatically on change, plus a scheduled full
> re-validation.**

Same coverage, ~3k judgments instead of 700k, stable answers, citeable "why".

## 2. Architecture

```
L0 Control corpus index   all controls the tenant has: ParsedFrameworkControl (+framework, version),
                          NormalizedControl (Unified Control Library), InternalControl.
                          → normalised text (code, title, statement, domain, framework, version)
                          → hybrid keyword index (embeddings optional later; see Retrieval note).
                          Rebuilt on upload/edit (corpus_version bump).

L1 Weakness key           per finding: CWE id (+ parents via cwe_hierarchy), CVE description, CVSS
                          vector, product/component, scanner plugin family, KEV/EPSS.
                          No-CVE findings: P5 classifier → described-weakness class or inventory.
                          key = CWE-id | described-weakness class. Findings collapse ~5:1.

L2 Reasoned mapping       per (weakness_key × corpus_version × prompt_version):
   (generalises P5)         1. retrieve top-K candidates from L0 (both general and specific)
                            2. LLM judgment, structured JSON per candidate:
                               applies (bool) · relation {preventive,detective,corrective,
                               compensating,governance} · confidence {high,medium,low} ·
                               rationale (one sentence citing control statement + weakness)
                            3. ids validated against the offered shortlist (never invented)
                          Stored: ControlMappingDecision(weakness_key, control_ref, corpus_version,
                          prompt_version, model, decision, relation, confidence, rationale,
                          provenance {published|reasoned|manual}, status {proposed|accepted|
                          rejected|auto}, decided_by, decided_at, prompt_inputs, raw_output).
                          PUBLISHED crosswalks (NIST CSF↔800-53 informative refs; CWE↔OWASP Top 10)
                          load as provenance=published, high-confidence priors.
                          The current 25 hand-written rows are NOT published: they enter as
                          provenance=legacy, confidence=medium, and are re-judged like everything
                          else (one of them produced the noise this plan exists to fix).

L3 Governance             review queue (generalised AI panel). Tenant policy at launch: auto-accept
                          ONLY published-backed decisions; every reasoned decision (any confidence)
                          goes to a human until P5's withheld-holdout battery clears ≥0.9, after which
                          widening is a recorded policy change. Rejections remembered.
                          Re-reasoning writes a NEW version and shows a diff; never silently flips
                          an accepted decision.

L4 Application            deterministic: for each finding, links = accepted decisions for its key.
                          Idempotent. Reasoned links carry their OWN marker `auto:reasoned:<decision_id>`
                          (not `auto:cwe:`), a new `link_basis=reasoned_mapping` on the evidence rows
                          they produce (so evidence-summary aggregation can show/discount them), and
                          the `existing_auto` prune filter - which carries a "do not widen" comment
                          for exactly this moment - is widened DELIBERATELY to `auto:cwe:% OR
                          auto:reasoned:%`, with tests proving manual links are still never pruned
                          and that reasoned-link removal soft-retracts + reinstates.

L5 Triggers               RE-ASK only on: new weakness key seen · corpus_version bump (framework
                          uploaded/updated, library edited) · prompt/model version bump.
                          Weekly "full re-validation" = COMPLETENESS SWEEP: ensure every key has a
                          decision under the current (corpus, prompt, model) versions and re-apply
                          L4 - NOT re-calling the LLM on already-decided keys (temperature 0 is not
                          serving-level determinism; naive re-asks flap proposals and cost for
                          nothing). Optional monthly random re-ask sample (~5% of keys) as drift
                          detection, diffed, never auto-applied.
                          Background job (P5 pattern: run row up-front, progress, resumable).

L6 Effectiveness          unchanged evidence-derived tiers; surfaced per relation type.

UI                        every crosswalk row: provenance chip + "why?" drawer (rationale,
                          confidence, decided by, versions). Validate tile counts by provenance.
```

Version drift disappears: the judgment reads the control *statement*, not the number.

Retrieval (L0): **hybrid keyword** (title/statement/domain/code tokens + the
existing concept expansion). pgvector 0.8.0 is available on the server but is
NOT installed in the tenant DB; installing an extension is not an additive
column, so it stays out under the no-infra-change rule. At ~3,500 controls
keyword retrieval is adequate; pgvector is an optional later upgrade, recorded.

Injection posture, plainly: control statements are tenant-uploaded text that
enters the prompt. Shortlist-id validation bounds invented ids; an inflated
`applies`/confidence remains the injection surface. That is why auto-accept
is published-backed only at launch (see decisions).

## 3. Prompt contract (L2) — to be battery-tested like P5 v1.4

Inputs: weakness key profile (MITRE CWE name/description, parents, 3 example
finding titles, CVE description if any, attack vector); candidate controls
(id, framework + version, code, title, statement, domain).
Rules: prefer specific over generic; a general vuln-mgmt control applies to any
CVE-bearing key (published prior); never invent ids; one rationale per applies=true;
`no_specific_control=true` allowed and stored.
Output: JSON array per candidate. Temperature 0. Model + prompt version stamped.

## 4. Phases

| # | Phase | Deliverable | Acceptance |
|---|---|---|---|
| P0 | Matcher fix | done (`becf5ea`) | 34-case self-check green; scope 49→32 rule controls |
| P1 | Corpus index + weakness keys | L0 build job over parsed frameworks + Unified Library + **internal controls (bank policy framework) from P1, not P2**; `corpus_version`; L1 key derivation (absorbs E4's engine half: described-weakness classes for no-CVE findings) | keys for 100% of scope findings; index rebuild < 2 min for 5k controls |
| P2 | Reasoning engine | `ControlMappingDecision` (+run) model; retrieval; judge; published priors import; generalise P5 accept/reject; deterministic apply | every real finding → ≥1 specific control or explicit "none"; ids 100% valid |
| P3 | Triggers + re-validation | change hooks; weekly job; diff on re-reason | change → new proposals within one job; no accepted link flipped silently |
| P4 | UI provenance | chip + why-drawer on crosswalk; Validate tile by provenance; audit export | auditor can answer "why is this control here?" from the screen |
| P5 | Battery test | precision vs a published-crosswalk holdout that is **WITHHELD from the priors during evaluation** (else ≥0.9 measures leakage, not judgment); coverage; reviewer acceptance rate | precision ≥ 0.9 on the withheld holdout; coverage ≥ 95% of real findings; internal controls included |

Estimated effort ~2 weeks. Depends on: OpenAI (existing), an embedding index
(pgvector or the existing retrieval), background job pattern (existing).

## 5. Decisions - recommended defaults (recorded; product owner may override)

1. **Auto-accept: published-backed only at launch.** Reasoned >=high routes to
   review until P5 shows >=0.9 on the WITHHELD holdout; widening is then a
   recorded policy change. Autonomy earned by measurement - and the only
   configuration in which a poisoned control statement cannot self-create links.
2. **Weekly = completeness sweep** (L5); full re-ask only on version change.
3. **Priors order:** NIST CSF<->800-53 informative references first (authoritative,
   public); CWE<->OWASP Top 10 second; the 25 legacy rows demoted (legacy/medium,
   re-judged); PCI DSS v4 appendix mappings only after a licence check.
4. **Internal controls join the corpus in P1.** Excluding the bank's own policy
   framework recreates the coverage gap this plan exists to close.

## 6. Reconciliation with the ledger

* E4 (verdict engine three states - LANDED) covered the engine; its remaining
  half for no-CVE findings - a described-weakness classifier - is L1 here, and
  the reach-view copy widened into E4 rides with it. One obligation (A6), not two.
* B1 (ServiceNow live verification) is in progress independently: PDI provisioned,
  connector connected, push proven (`INC0010001`); resolve->applied + reopen
  pending the user. B2 (prod role catalogue) untouched. Both are user-owned and
  decide whether the built loop bites in the world.

## Status

* P0 — done 17 Aug 2026 (`becf5ea`).
* **P1–P5 — LANDED 18 Aug 2026 in the ponytail form** (`/ponytail` ladder run
  over every layer; P5 was already 60% of this plan, so it was EXTENDED, not
  rebuilt). What landed vs what the plan drew:

| Layer | Plan drew | What shipped | Skipped, and when to add |
|---|---|---|---|
| L0 corpus index | new index table + embeddings + `corpus_version` | `build_candidates` now searches BOTH the Unified Control Library AND every uploaded framework visible to the tenant (own + shared, active), merged and ranked by the same concept scoring; candidates carry `kind` + `framework`; the model answers with a prompt-local id 1..N so the two id-spaces cannot collide | index table / pgvector / `corpus_version` — add when a tenant's corpus outgrows ILIKE-over-3.5k or keyword recall measurably misses (`# ponytail:` marked) |
| L1 weakness key | new derivation | `cwe_id` (+ `classify_finding` for no-CVE) — already existed | described-weakness CLASS keys for no-CVE findings — add when reuse across no-CVE findings is wanted (today each is judged individually) |
| L2 decisions | new `ControlMappingDecision` table | `AiControlProposal` already had reason/confidence/prompt_version/status/decided_by/prompt_inputs/raw_output; ADDED `parsed_framework_control_id` (nullable, unique per finding), `provenance` (`model`\|`reused`), `normalized_control_id` relaxed to nullable; run gained `findings_reused`/`proposals_reused` — all additive via `_COLUMN_ADDS` + `_ensure_column_nullable` | — |
| L2 published priors | load NIST CSF↔800-53 etc. | none loaded → auto-accept policy is published-only → NOTHING auto-accepts → every model proposal is human-reviewed | load when a licensed/authoritative crosswalk is procured; until then human review IS the policy |
| L3 governance | review queue, reject-remembered, never flip | existed; reject memory now spans the weakness key: a (CWE, control) a human rejected is never re-proposed for ANY finding of that CWE | — |
| **L4 apply-per-key** | the core idea | **built**: before calling the model for a finding, humans' ACCEPTED (CWE, control) pairs are applied as `provenance=reused` accepted proposals + links (decided_by = the original approver, no model call); a key with any human decision is not re-asked. Tests prove: no model call, original approver carried, reject-of-reused unwinds its link | — |
| L5 triggers | hooks + weekly sweep + drift sample | ONE hook: post-scanner-sync block (after enrichment, same non-fatal discipline as the choke recompute) sends findings that have no proposal yet through the mapper — "reasoning happens again and again" without a button; the run row records `ai_mapping` stats | weekly completeness sweep / monthly drift sample — add if a tenant reports stale keys; the button + idempotent re-run cover it today |
| L6 effectiveness | unchanged | unchanged | — |
| UI provenance | chip + why drawer | crosswalk rows carry `basis` (`rule`\|`ai`\|`reused`\|`manual`) + `reason` from the link notes; a "Why linked" column with a chip and hover reason; the proposals panel shows the control's framework and a `reused` badge; run line shows reused counts | drawer with versions/decided-by — add if the hover proves insufficient |
| Battery | precision on withheld holdout | `test_ai_control_mapping.py` gained the **12-uncovered-CWE** battery (real finding titles) — it CAUGHT two retrieval holes (CWE-441 had no concept row; CWE-1321 terms missed "Input Data Validation"), fixed in the concept table; `test_ai_control_proposals.py` gained the reason-once/apply-many properties. LIVE semantic pass 18 Aug over the 12 uncovered CWEs (23 proposals, 11 framework + 12 UCL): ~9/12 sound, CWE-289→MFA WRONG, 346/359 loose → prompt **v1.5** (auth-bypass rule + concept row); re-judged live: CWE-289 → Input Data Validation ✓ | a withheld PUBLISHED holdout precision number — add when priors are loaded (there is nothing to withhold yet) |

Coverage after: every one of the tenant's 18 CWEs reaches the model with valid
candidates from the whole corpus (was 6/18 hand-table only). Auto-accept: none.
Human queue: 23 model proposals + the earlier ones.
