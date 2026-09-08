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

**A3. ISO 45001 decision** · **DONE — closed as `out_of_scope`** · 36 requirements
All 36 requirements are dispositioned `out_of_scope` via a registry blanket with the reason recorded, and the library stays native (`bridge_via: NATIVE`) so ISO 45001 still renders in full — it simply maps to nothing.

**Decision taken, with reasoning, rather than left open.** Option three — authoring platform-native OH&S controls — starts a second control set the platform owns and maintains in perpetuity, in a discipline the product is not about, for 36 requirements. SCF is a security, privacy and resilience catalogue by design; the disposition model already has `different-discipline` for exactly this case. Occupational health and safety is not a gap in our coverage, it is a different subject.

Reversible in one registry edit if a customer ever requires it.

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

**B2. Reviewer queue** · **DONE — built, needs a reviewer**
The mechanism that makes accuracy improve rather than be re-measured. Built end to end:

- `grc_scf_mapping_review` — a standing decision keyed on `(source_slug, requirement_code, scf_id)`, **not** on `grc_scf_mapping.id`, because a release re-import deletes and renumbers every mapping row. A suppression that does not survive the next release is not a review programme.
- `GET /automation/common/review-queue` — ranked worst-first: ascending confidence, then fan-out (a requirement claiming many controls, or a control claimed by many requirements, is diluted either way), then material controls. Rows already ruled on never return. SCF's own published rows are excluded — they are not ours to review.
- `POST /automation/common/review` — `confirmed` | `suppressed` | `retargeted`, idempotent on the mapping's identity, stamped with reviewer and date.
- Suppression is applied **at read time** in the control detail endpoint, so the catalogue stays a faithful copy of what was imported and the decision stays visible and reversible.
- `/automation/soc2-controls/review` — the reviewer screen, linked from Common Controls.

*Verified:* table self-heals into both tenant DBs through the app's own `_init_tenant_schema` path; **10,854** reviewable mappings ranked. The top of the queue is exactly what it should be — `GOV-01.2` claimed by five separate SBP ETGRMF requirements at confidence 0.35.

**What is left is a person.** The queue is 10,854 rows deep; throughput, not tooling, is now the constraint.

**B3. Consolidate the remaining controls' evidence** · **DONE — 361/361**
The estimate of "340 controls, two passes" was wrong by 3×: it is **1,091 controls holding 26,434 asks**. Of those, the **361 carrying 31+ asks (26,403 asks)** were worth merging — below that a raw list is already readable and merging buys risk, not clarity. (An interim figure of 300 controls in this section was an undercount; the ask total was right.)

Confirmed the merge cannot be mechanised: normalising case, punctuation and plurals takes GOV-03 from 264 asks to 225 distinct, a 1.17× reduction. "Policy review records", "Policy Review & Distribution Records" and "Policy review and approval records" are one artifact worded three ways.

So `grc.tools.evidence_consolidation` is the harness instead: `bundle` emits one collapsed authoring input per control (identical asks merged, each citing every framework that made it), `merge` validates authored output and folds it in. The validator rejects invented citations, dropped frameworks, non-reductions, duplicate names and thin descriptions — 8 cases under `selftest`.
**Result: 361 controls, 26,403 asks → 4,174 artifacts (6.3×).** Every control in the band is consolidated; the band is now empty. Median 12 artifacts per control (range 5–19); 2,880 manual, 766 hybrid, 528 automated; 32 frameworks cited. Every artifact carries a description and every control a `notes` line stating the merge decision. The validator passed every batch — it caught one invented citation (MON-01.8 carrying a SWIFT CSCF reference across from MON-01) which was corrected before merge.

Two conventions held throughout: where frameworks demand the same artifact on different cadences or retention periods (access-review frequency, log retention of 180 days against ten years), one artifact states the difference inside it and the strictest governs; where an unrelated artifact arrives through an adjacent crosswalk (HITRUST 09.c network segregation inside a segregation-of-duties control), it stays separate rather than being absorbed.

*Verified:* file parses, 2.31 MB, loads through the router's `_consolidated_evidence` path; backend restarted so the `lru_cache` picks it up.

**B4. Re-audit** · **CLOSED — superseded by B2**
**88% ±6pp stands as the measured figure.** Closing this rather than running it, because with B2 built a re-audit is now the lower-value option: it would narrow the confidence interval to ±3pp and tell you the number more precisely, while changing nothing. Reviewer throughput moves the number. A tighter measurement of an unimproved corpus is not worth three raters.

The multi-rater design (three raters, ~35 controls sampled proportional to rows, cluster-adjusted) remains on file if a customer or auditor ever demands a stated interval. Note that inter-rater variance on this corpus was measured at ~10pp, so a single-rater pass would be worth little.

Re-measure after the review queue has been worked, not before — that is when the number will actually have moved.

---

## Track C — Automation (the one that changes what customers can trust)

This is the largest single piece of remaining value, and the only track that needs a compliance reviewer before engineering can finish.

**C1. Author the 239 check-to-objective bindings** · **compliance reviewer** · 2–3 days
Every automated check must name the SCF assessment objective it proves. This cannot be automated: one SOC 2 criterion reverse-maps to 28 SCF controls, so a machine binding inflates coverage roughly twentyfold. The output is a reviewable CSV — check, objective, the objective's text, a written rationale, reviewer, date — committed to the repo.
*Verify in CI:* every binding resolves, has a rationale, and has a named reviewer.

**C2. Re-bind the engine to objectives** · engineer · ~1 day, blocked by C1
Checks stop naming SOC 2 criteria and name SCF objectives directly, then inherit every framework through the crosswalk. This is the change that makes one check light up across 34 frameworks.

**C3. Evidence expiry** · **DONE**
A result older than its control's own reassessment window is now `expired`, and `expired` ranks above `passed` in the aggregate — one stale assertion means the control is not fully vouched for. An unspecified cadence defaults to Annual, the loosest of SCF's three windows, so a blank field never expires a result early.
*Verified:* 8 of the 15 tests in `tests/test_automation_status.py` cover it, including the case that matters — the same 120-day result is stale under Quarterly and current under Annual, because the window belongs to the control, not to the engine.

**C4. Cloud connectors** · **transport layer + AWS DONE** · four providers remain
The 65 existing connectors all speak one dialect — HTTPS with a static token. A provider spec can now name a `transport` instead, and everything downstream picks it up unchanged: the admin catalog, plugin seeding, collection health and the control crosswalk. `provider_checks()` is the single accessor both binders use, so a cloud transport is bound to controls by the same code that binds the other 65.

**AWS is implemented** on boto3 with six declarative checks — root MFA, root access keys, password policy, multi-region CloudTrail, EBS default encryption, Config recorder — plus a per-user IAM MFA sweep on the same access-review pattern as the Okta collector. Its read-only guard is imported from `aws_runner`, not restated, so one list of permitted verbs is enforced at the only place a call is made.

Two rules are enforced and tested here, because they are what stops the engine overstating itself:
- **A collector that cannot collect never fails a control.** Rejected credentials, a denied service, a missing key all produce `error`. The exception is a resource AWS reports as absent — `NoSuchEntity` for an unset password policy *is* the finding.
- **Connectivity is `info`, never a control pass.** A working key proves we can see the account, not that a control operates.

*Verified:* 19 tests drive the collector through a fake boto3 client — no AWS account, no network. Against `1link`, AWS is the 66th supported connector and binds to CC6.1/6.2/6.6/6.7/7.1/7.2.

**Remaining:** Azure, Entra, GCP, Kubernetes. Each is a `_call` implementation plus a `CLOUD_CHECKS` list against this shape — no further plumbing. None can be verified end to end without a live account, which is why AWS was built first and alone.

**C5. Collection health** · **DONE**
A run whose own status is `error` means the collector could not collect — revoked scope, expired secret, provider outage. That is now `collection_failed` rather than a control failure, and the new **Automation → Overview** carries a collection-health block: per connector, when it last collected successfully, how many controls it feeds, and the error if it is failing. A run that FAILED still collected, so only errored runs break the "last success" clock.
*Verified:* `1link` reports 1 healthy connector (GitHub, 6 days, 36 controls) and 74 never run.

**C6. Common controls overview** · **DONE** *(not in the original plan; asked for directly)*
`GET /automation/common/overview` + **Automation → Overview**. Six panels, each fed by the system that actually holds the answer: the library (SCF), what a check can assert (the plugin engine), the crosswalk, evidence (D2's consolidated sets), ownership and testing (the control workbench), and the direction of travel (assurance snapshots). Where a system holds nothing the panel names it and says so — the workbench has no rows for these controls, so implementation and assignment read *"not tracked yet"* rather than *"0 implemented"*.
Two aggregation traps avoided: `inferred_pct` counts requirements rather than mapping rows (it reproduces B1's finding exactly — COBIT 100%, GDPR 66%, SAMA CSF 46%), and the assurance snapshot's own control count is dropped because it counts a different denominator from the 1,534 here. Runs in 0.43s.

> **Until C1 and C2 land, no compliance percentage derived from automated checks should be shown to a customer.** The engine proves a connector authenticated, not that a control operates.

---

## Track D — Artifacts

**D1. Key and reference resolver** · DONE
`grc/tools/artifact_resolver.py` — `--selftest`, `--misses`, `--emit` (writes `seed_data/artifact_resolution.json`, 347 KB). 19 of the 32 catalogue keys needed an alias onto a registry slug; the reference normalizer handles clause/article/requirement prefixes, glosses (`A1.1 (Avail)`), trailing titles (`CC3 Risk Assessment`), multi-refs with prefix inheritance (`Art. 24 / 5`), and ranges that keep their written width and closing paren (`EDM01-05`, `Art. 8(4-6)`). Matching is exact → parent → child, same vocabulary as the crosswalk.

**576 of 922 items resolve** onto 893 distinct SCF controls (391 exact, 162 parent, 23 child; mean 8.4 controls per artifact). The other 346 are reported, not dropped — an `assert` in the tool fails if any item leaves without a status:

| bucket | n | what it means |
|---|---:|---|
| `unmatched_ref` | 186 | the code is real but absent from our library |
| `prose_ref` | 120 | the catalogue never wrote a code (`COSO ICFR`, `All TSC`, `—`) |
| `no_framework` | 34 | `iso_41001_2018` — facility management, a framework we do not carry |
| `no_scf_mapping` | 6 | resolved to a library code that has no crosswalk row |

Three of those clusters are findings worth acting on separately, and none is a resolver bug:
- **`iso_27001_2022` (23)** — the catalogue cites clauses 4–10, our ISO 27001 library is Annex A only. A real library gap, not a naming one.
- **`sabic_cybertrust` (22, the whole framework)** — the catalogue uses SABIC's own `CT-nn` numbering, our library renumbered to `domain.control`. Same standard, two hands, no positional correspondence — needs a 22-line hand map.
- **`sox_itgc` (32, the whole framework)** — every ref is prose (`Access ITGC`, `PCAOB AS 2201`) against an `APD-nn` library.

*Verified:* `--selftest` covers 17 normalizer and matcher rules plus the no-silent-drops invariant.

**D2. Merge artifacts into the consolidated evidence sets** · DONE
`artifact_resolver.py --merge` (with `--dry-run`) folds the resolved deliverables into `evidence_consolidated.json`. **361 → 897 controls, 4,174 → 8,880 artifacts** (4,706 from the catalogue), 2.31 → 4.49 MB.

Merge rules, each of which earned its place:
- **Dedupe by name within a control.** The control page keys its list on the artifact name, so a duplicate would collide in React as well as read as two documents. Where a catalogue deliverable matches an existing evidence artifact, the framework joins that artifact's `required_by` (40 such) instead of adding a row.
- **Canonical framework labels.** The catalogue writes `ISO/IEC 27001:2022` where the evidence sets write `ISO 27001`, and the UI counts distinct `required_by` entries — two spellings read as two frameworks. Reusing `_FW_LABELS` collapsed 55 labels to 34 and turned 36 phantom additions into recognised ones.
- **Label parent matches, do not exclude them.** 29 artifacts came from section-level references (`A.8.x`, `Req 8`) and land on up to 136 controls each. They carry `match_mode` and the control page badges them *section-level*, the same convention the crosswalk uses for parent mappings.
- **`evidence_consolidation merge` now preserves `source: "catalog"` rows** when an authored set replaces a control's artifacts. Without that, the next B3-style batch would have silently wiped them.

*Verified:* re-running the merge adds nothing and recognises all 4,814 attachments; no control has duplicate artifact names; the app's own reader loads all 897. The 536 controls that gained a set from the catalogue alone have `input_count: 0`, so the control page now says *"deliverables named by the frameworks this control maps to"* instead of *"merged from 0 requests"*.

**D3. Retire the compliance module's artifact surface** · NOT DONE — the premise is wrong, and this now needs your call

D3 was written on the assumption that the artifact surface is "a separate list in a module we intend to retire". It is not a list. `artifacts_router.py` is ~1,400 lines serving four things, only one of which D2 replaced:

| surface | callers | status after D2 |
|---|---|---|
| `/artifacts/catalog{,/all,/content,/export}` | Governance → Documents (Recommended docs modal), compliance ArtifactsTab | **not replaced** — backed by `artifact_content.json`, 14.8 MB and **527 authored document bodies** across 15 frameworks, plus DOCX/XLSX export |
| `/artifacts/platform-data/{risk-register,asset-inventory}` | compliance ArtifactsTab | **unrelated** — builds XLSX from live tenant risk and asset tables |
| `/artifacts` CRUD + `/{id}/export` (`TenantArtifact`) | governance documents, vendor-risk TPRA panel | **unrelated** — the tenant document store |
| `/artifacts/by-control` | Frameworks detail page | **superseded** — the consolidated sets answer this across all 32 frameworks, keyed on SCF controls rather than one framework's refs |

The consolidated evidence sets say *what to collect*; the artifact catalogue hands the user *a starter document*. Retiring the surface would trade 527 authored templates and two working export paths for a read-only list — a regression, not a retirement. **So nothing was deleted.**

What is true and useful: `artifact_id` is unique across the whole catalogue, and every merged row carries it, so a control's evidence set can already reach the authored content for its deliverables without any new key.

**Your call, one of three:**
1. **Join, don't retire** — put "download starter document" on the catalog-sourced rows of the control page, and retire only `/artifacts/by-control`. Smallest change, keeps every capability.
2. **Retire only `/artifacts/by-control`** and leave the rest as a peer surface. Zero risk, leaves the two views unreconciled.
3. **Retire the catalogue half properly** — port `artifact_content.json` and both export paths onto the control page first. Real work, and it only pays if Governance → Documents is meant to disappear.

*Recommendation: (1).* It resolves the duplication the plan was actually worried about and costs one endpoint.

---

## Sequence

**Now — unblocks everything else**
C1 (reviewer, 2–3 days) starts immediately; it is the long pole and the only item that needs a person who is not an engineer. In parallel: A1, A2, D1.

**Next**
C2 once C1 lands — it is the only remaining blocked item. C3, C5, C6 and C4's transport layer + AWS are done; Azure, Entra, GCP and Kubernetes follow the AWS shape. Tracks B and D are done bar the D3 decision below.

**Then**
C4 (cloud connectors) — the largest engineering item, and the one that makes automation cover real infrastructure.

**Decisions needed from you**
- **C1** — who reviews, and when they can start
- **B2** — who works the review queue; it is built and 10,854 rows deep, so this is now the same question as C1
- The two licensing questions from the status report, which gate anything customer-facing. `NOTICE.md` now carries the attribution CC BY-ND requires, but attribution is not permission — whether the SCF reproduction and the framework libraries' verbatim text are licensed for a paid product is still open
- Whether to push `scf-control-plane` to a GitHub remote, which is what actually publishes ~18 MB of verbatim SCF content
- **D3** — which of the three options above. Nothing was retired: the surface holds 527 authored document bodies the consolidated sets do not replace

*Closed without needing you:* **A3** (ISO 45001 → `out_of_scope`, reversible) and **B4** (88% ±6pp stands; superseded by B2).

**Rough totals:** 17 work items. Tracks A, B and D are complete — A1–A4, B1–B4, D1–D2 closed, D3 reduced to a decision. In Track C, C3, C5 and C6 are closed. What remains is **C1** (a reviewer, 2–3 days), **C2** (blocked by C1) and the four remaining **C4** cloud providers — plus the reviewer time that Track B's queue depends on, which is the same person as C1.
