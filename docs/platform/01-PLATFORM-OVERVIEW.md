# Platform Overview

## What it is

A multi-tenant governance, risk and compliance (GRC) platform. An organisation subject to
several regulatory frameworks at once uses it to run one control set, collect evidence
once, and report compliance against every framework it is bound by.

The working name in the codebase is **Complyverse** (also written `ComplyVerse` and
`CompliverseAI` — the brand is not settled; see `07-CONTENT-RULES.md`). The tagline in the
sign-in screen is *"The GRC platform your regulators trust."*

## The problem it addresses

A regulated organisation in the Gulf or South Asia is rarely subject to one framework. A
bank in Saudi Arabia may carry SAMA CSF, ISO 27001, PCI DSS, NDMO data-management
standards and the KSA personal-data transfer regulation simultaneously. A healthcare
provider in Abu Dhabi carries ADHICS, DoH ADHIE policy and HIPAA-equivalent obligations.

Conventionally, each framework is run as its own programme: its own control list, its own
evidence requests, its own auditor, its own spreadsheet. The same firewall ruleset gets
requested five times in five different words. Staff answer the same question repeatedly and
the organisation cannot tell how much of its total obligation is actually covered.

**The platform's answer is a single control set that answers every framework at once.** One
control, implemented once, evidenced once, satisfying the corresponding requirement in each
framework the organisation is bound by — with the mapping between them traceable back to a
published source.

## How it works, end to end

1. **Adopt the control set.** The platform ships a canonical library of **1,534 common
   controls** across 34 domains, sourced from the Secure Controls Framework (SCF) 2026.2.

2. **Select the frameworks in scope.** 34 framework libraries ship with the platform,
   from international standards (ISO 27001, PCI DSS, SOC 2, NIST 800-53) to regional
   regulation (SAMA CSF, QCB, ADHICS, NDMO, SBP, PISF).

3. **See the crosswalk.** Each control shows every framework requirement it discharges —
   the requirement's own code, its verbatim text, and how the mapping was established.
   **95.1% of every requirement across every framework shipped is mapped to a control**,
   and **99.7% is explicitly accounted for** (see `04-CONTROL-PLANE.md` for what the
   remainder is).

4. **Collect evidence once.** Each control carries a consolidated evidence set: one list of
   artifacts to produce, each citing every framework that asks for it. Where a connector
   can collect the evidence, it does.

5. **Report per framework.** Because the crosswalk is bidirectional, framework-level
   compliance is derived from control-level state rather than maintained separately.

## Who it is for

**Primary buyer** — the CISO, Head of Compliance or Head of Technology Risk at a regulated
organisation carrying three or more frameworks. They are measured on audit outcomes and on
the cost of achieving them.

**Primary user** — the compliance analyst or GRC manager who assembles evidence, chases
owners and answers auditors. Their pain is duplicated effort and the inability to answer
"where are we?" without a week of collation.

**Secondary users** — internal audit (assessing control effectiveness), risk management
(the register and its treatment plans), the external auditor (a read-only portal), and
control owners across IT and the business who are asked for evidence.

## Sector and geography

The framework libraries reveal the intended market clearly. Alongside the international
standards, the platform ships:

- **Saudi Arabia** — SAMA CSF, NDMO data management, KSA personal-data transfer regulation,
  Aramco CCC, SABIC CyberTrust
- **UAE** — ADHICS, DoH ADHIE policy
- **Qatar** — QCB technology risk
- **Pakistan** — SBP ETGRMF, SBP Cloud, SBP Internet Banking, PISF 2026
- **Singapore** — MAS TRM
- **Sri Lanka** — SL CSF
- **EU** — GDPR, NIS2, DORA

That mix — heavy regional financial-services and healthcare regulation layered over
international standards — is the distinguishing characteristic of the product and the
strongest thing to lead with. Most GRC platforms carry SOC 2 and ISO 27001. Few carry SAMA
CSF, QCB, ADHICS and SBP with the requirement text intact.

## What state the product is in

Honest summary, because a content agent will otherwise infer from directory names:

- **The control plane is real and measured.** 1,534 controls, 34 frameworks, 95.1% mapped
  coverage, mapping quality independently reviewed at 88% defensible. `SHIPPED`
- **The compliance, governance, risk and evidence modules are built and in use.** `SHIPPED`
- **Automated evidence collection is built but not yet trustworthy.** The engine connects
  to 65 SaaS providers and runs checks, but the layer deciding which control a check proves
  is not sound. **`BUILT — NOT TRUSTWORTHY`** — see `05-AUTOMATION-AND-INTEGRATIONS.md`.
- **Cloud infrastructure connectors (AWS, Azure, Entra, GCP, Kubernetes) are not
  collectable yet.** `PLANNED`
- **Two licensing questions are open** and gate anything customer-facing that reproduces
  framework or control text. See `07-CONTENT-RULES.md`.

## The one-sentence version

*One control set that answers thirty-four frameworks — including the regional regulation
most GRC platforms don't carry — so evidence is collected once and reported everywhere.*
