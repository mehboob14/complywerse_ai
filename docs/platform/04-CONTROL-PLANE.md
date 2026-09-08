# The Control Plane

The strongest technical story the product has, and the one most likely to be described
carelessly. Everything here is measured, and the measurements include the unflattering
ones — use them, because the unflattering numbers are what make the flattering ones
credible.

## The idea

A single canonical control set answers every framework at once. A customer subject to ISO
27001, PCI DSS, SAMA CSF and QCB simultaneously sees one control, once — not the same
obligation restated four times in four programmes.

## What ships

| | Measured 8 Sep 2026 |
|---|---|
| Common controls | **1,534** across 34 domains |
| Assessment objectives | 5,956 |
| Material controls (highest weight) | 163 |
| Framework libraries shipped | 34 |
| Frameworks reaching the control set | 33 |
| Crosswalk mapping rows | 80,635 |
| Distinct crosswalk sources | 282 |

## Source of truth

The control catalogue is the **Secure Controls Framework (SCF) 2026.2**, an industry
control catalogue that publishes its own crosswalk to 249 external sources. The platform
ingests it **verbatim** — control text is rendered as published, never paraphrased or
rewritten.

This is a deliberate, defensible position: when the platform states that a control
satisfies an ISO clause, that is SCF's published expert judgement, not the vendor's
opinion. It is also a licensing constraint — see `07-CONTENT-RULES.md`, which you must read
before writing about SCF.

## Coverage

**95.1% of every requirement across every framework shipped is mapped to a control** —
3,703 of 3,892.

But mapped coverage alone understates the picture, and the disposition model is the more
interesting story:

| Disposition | Meaning | Count |
|---|---|---|
| `mapped` | A control answers it | 3,703 |
| `other_party` | Binds the regulator, exchange operator or certifier — not the assessed organisation | 98 |
| `out_of_scope` | Outside the control catalogue's domain by design | 80 |
| `pending` | Genuinely not yet assessed | 11 |

**99.7% of all requirements are explicitly accounted for.** Thirty-three of the thirty-four
frameworks have nothing unexplained.

### Why this is the interesting part

Of the requirements with no control, most are not gaps. They bind **somebody else**. A
worked example from the platform's own data:

> *DoH ADHIE 4.1.1.1 — "Obligation binds DOH as the sector regulator to author and oversee
> ADHIE policy instruments, not the assessed organisation, so no SCF control applies."*

No control the customer implements can satisfy that requirement, because the customer is
not the actor. DoH ADHIE reads 52% mapped — and 100% accounted for, once the 83
requirements that bind the regulator or the exchange operator are labelled as such.

Forcing those into a mapping would manufacture coverage that an assessor rejects on sight.
The product's position is that **every requirement is accounted for, and mapped coverage is
reported separately and honestly** — which is what an auditor actually wants.

This is a genuinely strong marketing story: *most platforms show you a percentage; this one
shows you what the missing percentage is, in writing, per requirement.*

## Mapping quality

Every mapping carries its provenance, so any row can be traced.

| Origin | Rows | What it means |
|---|---|---|
| SCF-published | 69,791 | SCF's own crosswalk to its 249 upstream sources |
| Resolved | 5,986 | Our framework libraries matched onto SCF's crosswalk by code. Deterministic, no AI |
| Authored | 4,858 | Frameworks SCF does not cover — mapped by us |

**Measured quality: 88% defensible**, from three independent reviewers scoring 120 sampled
links, with **zero wrong-subject-matter links** in the sample.

That number is measured, not asserted, and the measurement history is itself the proof of
rigour: an earlier approach that routed mappings through an intermediate ISO 27002 clause
measured **41%** on the same rubric in a blinded trial — 150 mappings shuffled, origin
hidden, three reviewers, all three independently finding the same 45-point gap. The
approach was replaced, 1,356 requirements were re-authored directly, and the result was
re-verified at 86.7% with zero wrong-subject links across 360 judgements.

**Use this story.** "We measured our own mapping approach, found it was 41% defensible,
threw it away and rebuilt it" is far more credible than any accuracy claim on its own.

### The honest caveats

- **88% carries ±6pp sampling error.** Do not round it to 90%.
- **The ceiling without human review is roughly 90%**, because after removing every defect
  on our side an audit found ~10% of SCF's *own published* crosswalk cells are wrong-subject
  for a given control. Going beyond that needs a named reviewer working cell by cell.
- **3.1% of mapped requirements were matched by rollup, not on the code itself.** Concentrated
  in three frameworks: **COBIT is 100% inferred** (its "100% coverage" rests entirely on
  parent rollup), **GDPR 66%**, **SAMA CSF 50%**. The platform surfaces this per framework
  rather than hiding it. Never claim COBIT coverage without this qualification.

## Implementation guidance

**All 1,534 controls carry implementation guidance**, surfaced on the control page:

- A maturity ladder describing the control at each of six levels, with Level 3
  ("Well Defined") shown as the target for a compliance obligation
- Implementation options scaled from micro-business to enterprise
- Reassessment cadence and the control's nature — process, technology, people, data, facility

This is SCF's published guidance, reproduced verbatim, never paraphrased.

## Recommended evidence

Each control shows what to collect, split by **how** it is obtained — automated (a connector
proves it), manual (a person produces it) or hybrid.

The raw picture was unusable: because every framework states its evidence ask in its own
words, one control could accumulate hundreds of near-identical requests. **GOV-02 listed
539.** Removing exact duplicates barely helped — normalising case, punctuation and plurals
takes GOV-03 from 264 asks to 225 distinct, a 1.17× reduction. The duplication is semantic,
not lexical: *"Policy review records"*, *"Policy Review & Distribution Records"* and
*"Policy review and approval records"* are one artifact worded three ways.

So the merge is authored, not mechanised. Current state:

| | |
|---|---|
| Controls consolidated | **121** of the 300 carrying 31+ asks |
| Raw evidence asks merged | 14,648 |
| Consolidated artifacts | **1,840** |
| Reduction | **8.0×** |

Each artifact carries one description covering what every framework collectively demands —
**including where they disagree**. IAC-17's access review cites PCI DSS at six-monthly, SOC
2 at quarterly, QCB semi-annual and ADHICS annual, and states that the evidence must satisfy
the shortest. MON-10's log retention spans QCB's 180 days to SBP Internet Banking's ten
years.

**Status: `IN PROGRESS`.** The remaining controls display their un-consolidated lists and
are labelled as not yet consolidated. Describe the capability as in progress.

## Known defects, stated plainly

A content agent must not describe these as solved:

| Defect | Status |
|---|---|
| PCI DSS requirement text truncated on 102 of 205 requirements | Open |
| COBIT coverage entirely inferred rather than code-matched | Open, surfaced in-product |
| 11 SAMA CSF requirements not yet assessed | Open |
| SWIFT CSCF carried wrong control titles | **Fixed** — 29/31 → 32/32 |
| SAMA library had 170 rows collapsing to 81 ids, 20 literally "N/A" | **Fixed** — re-keyed to 71, coverage 0% → 85% |
| A shipped framework library was self-declared synthetic content | **Removed** |

The last three are worth telling as a quality story: the platform found and fixed defects in
its own shipped data rather than waiting for a customer to.
