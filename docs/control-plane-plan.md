## The two "100%" targets, honestly

You asked for 100% requirement coverage and 100% mappings. One of those is reachable and worth doing. The other is not, and chasing it would make the product worse. Here is the distinction, because it shapes the whole plan.

### 100% coverage — reachable, by changing what "covered" means

Today 235 requirements have no control. But **142 of them were examined and refused with a written reason, and 97 of those bind somebody else entirely** — the regulator, the health-information-exchange operator, a certification body. For example:

> *DoH ADHIE 4.1.1.1 — "Obligation binds DOH as the sector regulator to author and oversee ADHIE policy instruments, not the assessed organisation."*

A control cannot satisfy that requirement because our customer is not the actor. Forcing a mapping produces a link an assessor rejects on sight, and DoH ADHIE's 52% coverage is almost entirely this.

**The fix is a disposition model, not more mapping.** Every requirement gets an explicit state:

| Disposition | Meaning | Count today |
|---|---|---|
| `mapped` | A control answers it | 3,597 |
| `other_party` | Binds the regulator/operator/certifier, not the assessed entity | ~97 |
| `out_of_scope` | Outside the control catalogue's domain by design | ~52 |
| `pending` | Genuinely not yet done | ~86 |

That reaches **100% dispositioned**, which is what an auditor actually wants: no requirement silently unaccounted for. The reasons already exist as written text — this makes them first-class data instead of a gap in a report. **We would still state mapped coverage separately and honestly.**

### 100% mapping accuracy — not reachable without human review

Measured accuracy is 88%. The ceiling without a human in the loop is roughly **90%**, and the reason is upstream of us: after removing every defect on our side, an audit found **~10% of SCF's own published crosswalk cells are wrong-subject** — SCF's expert judgement, rendered faithfully, and still wrong for a given control. No normalizer touches those.

Getting beyond 90% requires a named reviewer confirming or suppressing cells one at a time. That is a real, fundable activity — but it is a review programme, not a code change, and it never "completes"; it converges.

---

## Track A — Coverage

**A1. Replace the NIST CSF library with v2.0** · **DONE**
Rebuilt from NIST's own CSF 2.0 Reference Tool export (public domain) via `grc.tools.build_nist_csf_library`. 46 v1.1 controls replaced by the full **106 subcategories** across 22 categories and 6 functions, with NIST's implementation examples carried verbatim into `assessment_criteria`.
*Verified:* 106/106 exact matches against `nist_csf_20`, zero parent/child rollups, 465 crosswalk rows. Our parse and SCF's independent reading of CSF 2.0 agree on all 106 codes with no residue on either side. **Coverage 93.9% → 95.1%.**

**A2. Disposition model** · **DONE**
`grc.tools.build_scf_dispositions` classifies every refusal rationale with 16 ordered, literal rules and emits `dispositions.json`; no rule is broad enough to sweep up the remainder, so anything unrecognised surfaces as `unclassified` rather than being quietly binned. Served by `GET /automation/common/coverage` and a new **Requirement coverage** page linked from Common Controls, showing each unmapped requirement with its disposition, the rule that classified it, and the written reason.
*Verified:* **zero unclassified**. DoH ADHIE now reads "101 mapped · 83 bind the regulator or exchange operator · 11 out of scope · 0 pending" instead of a bare 52%. **99.7% dispositioned** — 33 of 34 frameworks fully accounted for.

**A3. ISO 45001 decision** · **interim applied, still your call** · 36 requirements
Marked `out_of_scope` wholesale via a registry blanket, with the reason recorded — occupational health and safety, outside the security/privacy catalogue by design. That was option two of three and is reversible in one registry edit. Option three, authoring platform-native OH&S controls, remains open but starts a second control set we would own and maintain.

**A4. The remaining `pending`** · **DONE — 100% dispositioned**
Was 11, all SAMA CSF sections 3.3.12 and 3.3.13 (payment-systems and electronic-banking security standards), which SCF's SAMA crosswalk skips entirely — it jumps `3.3.11` to `3.3.14`. SAMA CSF resolves through that published crosswalk and so had no direct file, which is why its refusals had no rationale and sat at `pending`.

`crosswalks/direct/sama_csf.json` now carries all 11: **6 mapped, 5 refused with written rationale.**

- **3.3.12.1 / 3.3.13.1** payment-systems and e-banking standards → GOV-02 (+CPL-02, WEB-01), confidence 0.60 — SCF is technology-agnostic, so these are the general mechanism, not a like-for-like counterpart
- **3.3.12.2 / 3.3.13.3** measure effectiveness → GOV-05, 0.85
- **3.3.13.2** monitor compliance → CPL-02, 0.60
- **3.3.13.9** avoid man-in-the-middle → CRY-03 + NET-09 + WEB-10, 0.85

The five refusals are one coherent finding, not five separate gaps: **SCF 2026.2 has no consumer-channel controls.** Brand protection incl. social media (3.3.13.4), publishing to official app stores (.5), take-down of impersonating apps and sites (.6), client-side sandboxing on the customer's device (.7) and non-caching of delivered content (.8) all concern protecting the bank's *customers* on public platforms. SCF is an enterprise catalogue and stops at the organisation's own estate — IRO-16 is post-incident reputation repair, NET-20.1 is email sender authentication, NET-03.6 isolates components inside our own environment, IAC-10.10 covers cached authenticators not cached pages. All five are dispositioned `out_of_scope` / `no-scf-mechanism`, the existing convention for "the catalogue has nothing that does this".

*Verified:* dispositions **3,892 of 3,892 (100%)**, pending 0, mapped 3,703 → 3,709; the 10 new rows carry `provenance=ai` at 0.60/0.85 so they stay distinguishable from resolver rows; imported to both tenants (80,635 → 80,645 mappings).

---

## Track B — Mapping accuracy

**B1. Make `match_mode` mean something** · **DONE**
The real figure was **435 rows across 115 codes**, not 548. The importer now grades resolver rows off their match mode — exact 1.00, parent/child 0.60 — instead of stamping every one at 1.00, and `match_mode` is carried onto each requirement in the API, badged per row and summarised per framework group. The resolver's own docstring claimed these rows "never enter a conformance numerator", which was never true; corrected.
*Verified:* COBIT's `BAI09` renders as `parent` at 0.60 and badges "1/1 inferred"; code-identity matches stay at 1.00.
**Finding worth acting on:** the coverage page now shows what share of each framework's mapped requirements were inferred rather than matched on the code. **COBIT is 100% inferred** — its "100% coverage" rests entirely on parent rollup — with **GDPR at 66%** and **SAMA CSF at 50%**. Overall only 3.1% of mapped requirements are inferred, so the aggregate is sound, but those three frameworks are making a weaker claim than the percentage suggests and should head the B2 review queue.

**B2. Reviewer queue** · engineer builds, compliance reviews · ~3 days to build
The only path past ~90%. A screen that walks a reviewer through mappings ranked by risk (low confidence, high fan-out, material controls first), letting them confirm, suppress or re-target, with reviewer and date stamped on the row. Suppressions persist across SCF releases.
*This is the mechanism that makes accuracy improve over time instead of being re-measured.*

**B3. Consolidate the remaining controls' evidence** · **DONE — 361/361**
The estimate of "340 controls, two passes" was wrong by 3×: it is **1,091 controls holding 26,434 asks**. Of those, the **361 carrying 31+ asks (26,403 asks)** were worth merging — below that a raw list is already readable and merging buys risk, not clarity. (An interim figure of 300 controls in this section was an undercount; the ask total was right.)

Confirmed the merge cannot be mechanised: normalising case, punctuation and plurals takes GOV-03 from 264 asks to 225 distinct, a 1.17× reduction. "Policy review records", "Policy Review & Distribution Records" and "Policy review and approval records" are one artifact worded three ways.

So `grc.tools.evidence_consolidation` is the harness instead: `bundle` emits one collapsed authoring input per control (identical asks merged, each citing every framework that made it), `merge` validates authored output and folds it in. The validator rejects invented citations, dropped frameworks, non-reductions, duplicate names and thin descriptions — 8 cases under `selftest`.
**Result: 361 controls, 26,403 asks → 4,174 artifacts (6.3×).** Every control in the band is consolidated; the band is now empty. Median 12 artifacts per control (range 5–19); 2,880 manual, 766 hybrid, 528 automated; 32 frameworks cited. Every artifact carries a description and every control a `notes` line stating the merge decision. The validator passed every batch — it caught one invented citation (MON-01.8 carrying a SWIFT CSCF reference across from MON-01) which was corrected before merge.

Two conventions held throughout: where frameworks demand the same artifact on different cadences or retention periods (access-review frequency, log retention of 180 days against ten years), one artifact states the difference inside it and the strictest governs; where an unrelated artifact arrives through an adjacent crosswalk (HITRUST 09.c network segregation inside a segregation-of-duties control), it stays separate rather than being absorbed.

*Verified:* file parses, 2.31 MB, loads through the router's `_consolidated_evidence` path; backend restarted so the `lru_cache` picks it up.

**B4. Re-audit** · **blocked on a choice**
Three raters, ~35 controls sampled proportional to rows, cluster-adjusted; gets the accuracy figure to ±3pp instead of the current ±6pp. The multi-rater design needs parallel agents, which this session will not spawn unasked — and a single-rater pass is worth little here, since inter-rater variance on this corpus was already measured at ~10pp. Either authorise the multi-agent run or treat 88% ±6pp as the standing figure.

---

## Track C — Automation (the one that changes what customers can trust)

This is the largest single piece of remaining value, and the only track that needs a compliance reviewer before engineering can finish.

**C1. Author the 239 check-to-objective bindings** · **compliance reviewer** · 2–3 days
Every automated check must name the SCF assessment objective it proves. This cannot be automated: one SOC 2 criterion reverse-maps to 28 SCF controls, so a machine binding inflates coverage roughly twentyfold. The output is a reviewable CSV — check, objective, the objective's text, a written rationale, reviewer, date — committed to the repo.
*Verify in CI:* every binding resolves, has a rationale, and has a named reviewer.

**C2. Re-bind the engine to objectives** · engineer · ~1 day, blocked by C1
Checks stop naming SOC 2 criteria and name SCF objectives directly, then inherit every framework through the crosswalk. This is the change that makes one check light up across 34 frameworks.

**C3. Evidence expiry** · engineer · ~half a day
SCF publishes a reassessment cadence per control (Annual / Semi-Annual / Quarterly). It is already imported and already returned by the API, and nothing reads it. Without it, a check that passed 400 days ago on a since-revoked token still reads green.

**C4. Cloud connectors** · engineer · ~1 week
AWS, Azure, Entra, GCP and Kubernetes need SDK/OAuth transports rather than static tokens. This is the bulk of real customer infrastructure and today none of it is collectable.

**C5. Collection health** · engineer · ~half a day
A revoked scope or expired secret currently looks like a failing control. Surface it separately — "this connector has not collected successfully in 90 days" — so a broken collector never reads as a broken control.

> **Until C1 and C2 land, no compliance percentage derived from automated checks should be shown to a customer.** The engine proves a connector authenticated, not that a control operates.

---

## Track D — Artifacts

**D1. Key and reference resolver** · engineer · ~1 day
922 catalogue items across 32 framework keys, none instantiated for any tenant, so there is no migration risk. Two mismatches to bridge: the artifact keys use a different vocabulary from our framework slugs (`iso_27001_2022` vs `iso_27001`, `qatar_cb` vs `qcb_technology_risks`), and control references are prose (`Cl. 5.1`) rather than bare codes. A registry plus a normalizer resolves item → requirement → control.
*Verify:* every catalogue item resolves to a control or is reported as unresolved — no silent drops.

**D2. Merge artifacts into the consolidated evidence sets** · engineer · ~1 day
Once resolved, the 922 artifacts become named, requestable items inside the evidence sets already built, instead of a separate list in a module we intend to retire.

**D3. Retire the compliance module's artifact surface** · after D2

---

## Sequence

**Now — unblocks everything else**
C1 (reviewer, 2–3 days) starts immediately; it is the long pole and the only item that needs a person who is not an engineer. In parallel: A1, A2, D1.

**Next**
C2 and C3 once C1 lands. B1 and B3 are done. D2 after D1.

**Then**
C4 (cloud connectors) — the largest engineering item, and the one that makes automation cover real infrastructure. B2 (reviewer queue) once there is appetite for a standing review programme.

**Decisions needed from you**
- **A3** — what to do with ISO 45001
- **C1** — who reviews, and when they can start
- **B2** — whether accuracy beyond 90% is worth a standing review programme
- The two licensing questions from the status report, which gate anything customer-facing

**Rough totals:** 16 work items — ~19 engineering days, of which B2 (3) is decision-gated — plus 3 reviewer-days that block the most valuable third of it.
