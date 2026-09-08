# Positioning and Messaging

Source material for content generation. Everything here is grounded in a verified fact
elsewhere in this directory — follow the cross-references before using a claim.

## Core positioning

**One control set that answers thirty-four frameworks — including the regional regulation
most GRC platforms don't carry — so evidence is collected once and reported everywhere.**

Two halves, both load-bearing. The **unified control set** is the mechanism. The **regional
framework depth** is what makes it hard to copy and easy to differentiate.

## The four differentiators, strongest first

### 1. Regional regulatory depth

Most GRC platforms carry SOC 2, ISO 27001, PCI DSS and NIST. Few carry **SAMA CSF, QCB,
ADHICS, DoH ADHIE, NDMO, SBP ETGRMF, SBP Cloud, SBP Internet Banking, PISF 2026, Aramco
CCC, SABIC CyberTrust and the KSA personal-data transfer regulation** — with the
requirement text and codes intact and crosswalked to a common control set.

For a Saudi bank, a UAE hospital or a Pakistani financial institution, this is the
difference between a platform that covers half their obligation and one that covers it.
It is the single most defensible thing to lead with.

*Grounded in: `01-PLATFORM-OVERVIEW.md`, `03-MODULES.md`*

### 2. Every requirement accounted for, not just a coverage percentage

95.1% mapped, **99.7% explicitly accounted for**. The requirements without a control carry
a written reason — most bind the regulator or the exchange operator rather than the
customer, and no control the customer implements could ever satisfy them.

The story: *most platforms show you a percentage. This one shows you what the missing
percentage is, per requirement, in writing.*

The worked example lands well: DoH ADHIE reads 52% mapped and 100% accounted for, because
83 of its requirements bind the health-information-exchange operator, not the hospital.

*Grounded in: `04-CONTROL-PLANE.md`*

### 3. Mapping quality that was measured, including when it failed

88% defensible, three independent reviewers, 120 sampled links, zero wrong-subject links.

The credibility comes from the failure: an earlier mapping approach measured **41%** in a
blinded trial. It was found, thrown away, rebuilt and re-verified. A vendor that publishes
the number at which its own first attempt failed is making a much stronger claim about
rigour than one that publishes only the good number.

*Grounded in: `04-CONTROL-PLANE.md`*

### 4. Per-tenant database isolation

Each customer's data lives in its own PostgreSQL database, not behind a `tenant_id` column.
For a regulated buyer with data-residency obligations, "your data is in your own database"
is verifiable in a way that row-level filtering is not.

*Grounded in: `02-ARCHITECTURE.md`*

## Personas and the message for each

**CISO / Head of Technology Risk** — *buyer.* Measured on audit outcomes and their cost.
Lead with the unified control set and evidence collected once. The proof point is the
crosswalk: one control, traceable to every framework requirement it discharges.

**Head of Compliance** — *buyer.* Answers the regulator. Lead with regional framework depth
and the disposition model: no requirement silently unaccounted for, every gap explained in
writing.

**GRC / compliance analyst** — *user, and the strongest advocate.* Lives the duplication.
Lead with consolidated evidence: GOV-02 carried 539 near-identical evidence asks across its
frameworks; consolidated, it is a single set. Note this is `IN PROGRESS`.

**Internal audit** — control effectiveness, the audit plan, the finding register.

**External auditor** — the read-only auditor portal, and the fact that every mapping carries
its provenance so any link can be traced.

## Proof points, with their caveats

Use these verbatim. Each caveat is mandatory where noted.

| Claim | Caveat |
|---|---|
| 1,534 common controls across 34 domains | — |
| 34 framework libraries, 33 crosswalked | — |
| 95.1% requirement coverage | State as measured, not as a guarantee |
| 99.7% of requirements explicitly accounted for | The strongest single number — use it |
| 88% mapping quality, three independent reviewers | **Always ±6pp. Never round to 90%** |
| 5,956 assessment objectives | — |
| 80,635 crosswalk mappings | — |
| 65 SaaS connectors | Never attach a compliance claim — see `05` |
| Evidence consolidation 8.0× | **Must say `in progress`, 121 of 300 controls** |
| Per-tenant database isolation | — |

## Story angles that work

**"The same firewall rule, requested five times."** The duplication problem, concretely.
Then the unified control set as the answer.

**"52% covered, 100% accounted for."** The disposition model. Counter-intuitive, memorable,
and it demonstrates a kind of honesty a compliance buyer is starved of.

**"We measured our own mapping at 41% and threw it away."** Rigour, told as a failure.

**"Policy review records. Policy Review & Distribution Records. Policy review and approval
records."** Three names, one artifact — why evidence consolidation cannot be done with
string matching, and why it took authoring.

**"A check that collects nothing should not say pass."** The integrity fix that stopped 187
of 239 checks from being able to report success on empty data. A small story that says a
great deal about how the product treats truth.

**Regional launch angles.** Each regional framework is its own post for its own market —
SAMA CSF for Saudi banking, ADHICS for UAE healthcare, SBP for Pakistani financial services,
QCB for Qatar. These will outperform generic GRC content in those markets.

## Competitive framing

Do not name competitors. Frame against categories:

- **Against spreadsheet-based GRC** — the duplication and the inability to answer "where are
  we?" without a week of collation.
- **Against international-only platforms** — they cover the standards, not the regional
  regulation that actually binds the customer.
- **Against automation-first compliance tools** — a passing connector check is not an
  operating control. This platform's position is the honest one, and it is a genuine
  differentiator. See `05-AUTOMATION-AND-INTEGRATIONS.md` for the framing that sells it
  without overclaiming.

## Tone

Precise, plain, unhurried. The audience is professionally sceptical and has been sold
dashboards that meant nothing. Specific numbers with their error bars beat superlatives.
Name the limitation before the reader finds it.

Avoid: "revolutionary", "AI-powered compliance", "effortless", "one-click", "fully
automated", "guaranteed compliance", "audit-proof".

Prefer: what it does, for whom, with what measured result, and what it does not do yet.
