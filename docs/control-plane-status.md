## Where we are

We have replaced a three-framework control library with a **single control set of 1,534 controls that answers 34 frameworks at once**. A customer subject to ISO 27001, PCI DSS, SAMA and QCB simultaneously now sees one control, once — not the same obligation restated four times.

**93.9% of every requirement across every framework we ship is now represented by a control** (3,597 of 3,832), up from 80% when this work started. **Twenty frameworks are at 100%.**

The mapping quality is measured, not asserted: three independent reviewers scoring 120 sampled links found **88% defensible**, with **zero** wrong-subject-matter links. An earlier approach measured 41% on the same rubric; we found that, replaced it, and re-verified.

**What is not ready:** the automated evidence collection is not trustworthy yet, and there are two licensing questions that need a decision before this is customer-facing. Both are detailed below.

---

## The control set

| | |
|---|---|
| Common controls | **1,534** across 34 domains |
| Controls answering at least one framework | **1,154** |
| Material controls (highest weight) | 163 |
| Assessment objectives | 5,956 |
| Evidence requests | 316, linked to controls 810 times |

**Source of truth: the Secure Controls Framework (SCF) 2026.2.** SCF is an industry control catalogue that publishes its own crosswalk to 249 external sources. We ingest it verbatim — we do not rewrite it. That crosswalk is the backbone: when SCF states that a control satisfies an ISO clause, that is SCF's published expert judgement, not ours.

**380 controls answer no framework we ship.** They are legitimately in the catalogue (Quantum Security, most of the AI domain) but no customer obligation currently requires them. They are visible and marked, not hidden.

---

## Framework coverage

Every requirement in every framework, and whether a control answers it.

**At 100%** — SOC 2 · ISO 27001 · ISO 42001 · ISO 22301 · PCI DSS · NIST 800-53 · NIST 800-171 · NIST AI RMF · CIS Controls · CSA CCM · COBIT · HIPAA · MAS TRM · SWIFT CSCF · HITRUST · ADHICS · SBP Cloud · SL CSF · Aramco CCC · SABIC CyberTrust

**90–99%** — PISF 2026 (99) · QCB (99) · SBP ETGRMF (97) · DORA (96) · SOX ITGC (96) · NDMO (93) · GDPR (93) · SBP Internet Banking (92)

**Below 90%** — SAMA CSF (85) · NIS2 (83) · KSA PDP Transfer (81) · **DoH ADHIE (52)** · **NIST CSF (0)** · **ISO 45001 (0)**

### Why the last 6% is not a to-do list

Of 235 uncovered requirements, **142 were explicitly examined and judged unmappable, with a written reason each**. They are obligations that bind somebody else — a regulator's duty, an exchange operator's duty, a licensing formality. DoH ADHIE sits at 52% for exactly this reason: half its content governs the health information exchange operator, not the organisation being assessed. Mapping those would manufacture coverage that fails on first inspection.

Two are genuine gaps with a known fix:

- **NIST CSF (46 requirements)** — our library is v1.1; SCF crosswalks v2.0, which renumbered everything. Needs a library replacement, roughly a day. This is the only remaining item that moves the number.
- **ISO 45001 (36)** — occupational health and safety. Outside SCF's scope by design.

**Realistic ceiling is ~95%.** We would rather report 94% honestly than 100% with 142 links an assessor would reject.

---

## How the mappings were built, and how good they are

Every mapping carries its origin, so any row can be traced.

| Origin | Rows | What it means |
|---|---|---|
| SCF-published | 69,791 | SCF's own crosswalk to its 249 upstream sources |
| Resolved | 5,521 | Our framework libraries matched onto SCF's crosswalk by code. Deterministic, no AI |
| Authored | 4,858 | Frameworks SCF does not cover — we mapped them ourselves |

The authored set is where quality risk lives, and it is where we spent the most effort.

**We initially routed those mappings through an intermediate ISO 27002 clause.** A blinded trial — 150 mappings shuffled, origin hidden, three independent reviewers — measured that approach at **41% defensible**, against **88%** for mapping directly onto the target control. All three reviewers independently found the same 45-point gap. We re-authored all 1,356 affected requirements directly and re-verified the result at **86.7%**, with zero wrong-subject links across 360 judgements.

That single change matters more than any other quality work in this phase: it roughly doubled the accuracy of our own contribution while halving its volume.

---

## Implementation guidance

**Every one of the 1,534 controls now carries implementation guidance**, surfaced on the control page:

- A maturity ladder describing what the control looks like at each of six levels, with Level 3 ("Well Defined") shown as the target for a compliance obligation
- Implementation options scaled to organisation size, from micro-business to enterprise
- Reassessment cadence and the control's nature (process, technology, people, data, facility)

This is SCF's published guidance, reproduced verbatim. We do not paraphrase it — see the licensing note.

---

## Recommended evidence

Each control shows what to collect, split by **how** it is obtained: automated (a connector proves it), manual (a person produces it), or hybrid.

The raw picture was unusable. Because every framework states its own evidence ask in its own words, one control could accumulate hundreds of near-identical requests — **GOV-02 listed 450**. Removing exact duplicates barely helped: 95% of the phrasings are unique.

So we consolidated by meaning. For the 61 heaviest controls:

| | |
|---|---|
| Raw evidence requests | 9,016 |
| Consolidated artifacts | **890** |
| Reduction | **10.1×** |
| Split | 583 manual · 258 hybrid · 49 automated |

Each consolidated artifact carries one description covering what every framework collectively demands — including where they disagree (some require board approval, others accept senior management) — and cites every framework that asks for it. GOV-02's "Information Security Policy" merges 40 separate requests across 20 frameworks into one thing to collect.

**340 controls still hold their un-consolidated lists.** They display correctly and are labelled as not yet consolidated. Roughly two more passes at the same ratio.

---

## Artifacts, checks and automation — the honest part

### Artifacts: not yet migrated

The compliance module holds **922 artifact catalogue items** across 32 framework keys. **None are instantiated for any tenant**, so no customer data is at stake. Migration is a resolver, not an authoring exercise: the artifact keys use a different vocabulary from our framework slugs and their control references are prose-formatted. Roughly a day, and it is planned but not started.

### Automated checks: built, not trustworthy

We have **65 connectors and 239 automated checks**, and the collection engine works. But the layer that decides *which control a check proves* is not sound yet, and we know precisely why:

- Checks are bound at **connector** level rather than per check, so a storage-backup check and a firewall check are treated as interchangeable evidence
- Each SOC 2 criterion is then inherited by every control mapping to it — one criterion reaches 37 controls

We fixed the worst of this — checks now attach only where they name a criterion the control actually maps to, a control's status is computed only from its own findings, and a check that collected nothing now reports "not assessed" instead of "pass". That last one alone stopped 187 of 239 checks from being able to report success on empty data.

**But the binding still needs re-doing properly**, and that work needs a compliance reviewer to author 239 check-to-objective bindings — it is a judgement task, not a coding task. Until then:

> **Do not publish a compliance percentage from automated checks.** The engine currently proves that a connector authenticated, not that a control operates.

---

## Two decisions needed

**1. SCF licensing.** SCF is published under CC BY-ND 4.0. Its own guidebook explicitly names "a GRC platform that includes SCF content" as intended use, which is encouraging. Two things need confirming in writing:

- Whether serving a tenant-filtered subset of unmodified SCF text in a paid product counts as permitted reproduction. If not, commercial licensing starts at $25k/year.
- The licence **explicitly prohibits using AI to generate derivative content from SCF text.** We comply today — SCF prose is rendered verbatim and never fed to a model for generation — but this constrains future AI features that would otherwise draw on control text.

**2. Our existing framework libraries carry a larger, live exposure.** They ship the verbatim requirement text of ISO 27001, PCI DSS, CIS and HITRUST. ISO grants no redistribution right; PCI requires written permission; CIS is licensed non-commercial. This predates the current work and is independent of SCF. The fix is the same discipline SCF itself uses: publish the identifier, link to the source, do not reproduce the prose.

A related signal: an automated attempt to repair PCI DSS's truncated requirement text was **blocked by a content filter**. We are treating that as confirmation rather than an obstacle to route around.

---

## Known defects

| Defect | Impact | Status |
|---|---|---|
| PCI DSS text truncated on 102 of 205 requirements | Requirement text ends mid-sentence | Open — likely resolved by linking out rather than reproducing |
| NIST CSF library is v1.1, SCF maps v2.0 | 46 requirements uncovered | Fix known, ~1 day |
| SWIFT CSCF carried the wrong control titles | Wrong text shown to users | **Fixed** — 29/31 → 32/32 |
| SAMA library had 170 rows collapsing to 81 ids, 20 literally "N/A" | Unusable | **Fixed** — re-keyed to 71, coverage 0% → 85% |
| GCRF library was self-declared fictional content | Shipping invented controls | **Removed** |

---

## What comes next

1. **NIST CSF 2.0 library** — the last item that moves coverage, ~1 day
2. **Consolidate the remaining 340 controls' evidence** — two passes
3. **Migrate the 922 artifacts** — resolver, ~1 day
4. **Re-bind the 239 checks** — needs a compliance reviewer; this is what makes automation trustworthy
5. **Close the licensing questions** — before anything is customer-facing

Items 1–3 are engineering. Item 4 needs a person with compliance judgement. Item 5 needs a decision.
