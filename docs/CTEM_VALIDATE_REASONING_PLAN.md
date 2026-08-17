# CTEM Validate — from a hand table to reasoned, re-runnable control mapping

Plan of record. Written 17 Aug 2026 after the crosswalk audit (commit `becf5ea`).
Status of each phase is tracked at the bottom.

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
                          → embeddings + keyword index. Rebuilt on upload/edit (corpus_version bump).

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
                          Published crosswalks (NIST CSF↔800-53, CWE↔OWASP, current 25 rows) are
                          loaded as provenance=published, high-confidence priors.

L3 Governance             review queue (generalised AI panel). Tenant policy: auto-accept when
                          published-backed or ≥high confidence; else human. Rejections remembered.
                          Re-reasoning writes a NEW version and shows a diff; never silently flips
                          an accepted decision.

L4 Application            deterministic: for each finding, links = accepted decisions for its key.
                          Idempotent; auto links prunable, human links never touched (existing rule).

L5 Triggers               new weakness key seen · framework uploaded/updated · library edited ·
                          prompt/model version bump · scheduled full re-validation (weekly).
                          Background job (P5 pattern: run row up-front, progress, resumable).

L6 Effectiveness          unchanged evidence-derived tiers; surfaced per relation type.

UI                        every crosswalk row: provenance chip + "why?" drawer (rationale,
                          confidence, decided by, versions). Validate tile counts by provenance.
```

Version drift disappears: the judgment reads the control *statement*, not the number.

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
| P1 | Corpus index + weakness keys | L0 build job, `corpus_version`; L1 key derivation; per-tenant key list | keys for 100% of scope findings; index rebuild < 2 min for 5k controls |
| P2 | Reasoning engine | `ControlMappingDecision` (+run) model; retrieval; judge; published priors import; generalise P5 accept/reject; deterministic apply | every real finding → ≥1 specific control or explicit "none"; ids 100% valid |
| P3 | Triggers + re-validation | change hooks; weekly job; diff on re-reason | change → new proposals within one job; no accepted link flipped silently |
| P4 | UI provenance | chip + why-drawer on crosswalk; Validate tile by provenance; audit export | auditor can answer "why is this control here?" from the screen |
| P5 | Battery test | precision vs published-crosswalk holdout; coverage; reviewer acceptance rate | precision ≥ 0.9 on holdout; coverage ≥ 95% of real findings |

Estimated effort ~2 weeks. Depends on: OpenAI (existing), an embedding index
(pgvector or the existing retrieval), background job pattern (existing).

## 5. Open decisions for the product owner

1. Auto-accept policy default: published-backed only, or also ≥high reasoned?
2. Scheduled full re-validation cadence (weekly proposed).
3. Which published crosswalks to load first (NIST CSF↔800-53 informative refs;
   CWE↔OWASP Top 10; PCI DSS v4 Appendix mappings if licensed).
4. Whether internal controls (bank policy framework) join the corpus in P1 or P2.

## Status

* P0 — done 17 Aug 2026.
* P1–P5 — not started; awaiting go.
