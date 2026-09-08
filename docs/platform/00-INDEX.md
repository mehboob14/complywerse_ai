# Platform Knowledge Base — Index

This directory is the source of truth an LLM should read before writing anything public
about this product. It exists because the codebase alone is a poor briefing: it shows what
was built, not what is true, shipped, defensible or safe to say.

## Who this is for

An automated content agent connected to this repository over MCP, generating marketing
material (LinkedIn, Instagram, blog, launch copy) about the platform. Also useful to any
human writing about it.

## Read in this order

| File | What it answers |
|---|---|
| `01-PLATFORM-OVERVIEW.md` | What the product is, who buys it, what problem it solves |
| `02-ARCHITECTURE.md` | How it is built — stack, multi-tenancy, data model, request path |
| `03-MODULES.md` | What ships, module by module |
| `04-CONTROL-PLANE.md` | The SCF control plane — the core technical differentiator |
| `05-AUTOMATION-AND-INTEGRATIONS.md` | Connectors, evidence collection, automated checks |
| `06-POSITIONING.md` | Value propositions, personas, differentiators, proof points |
| `07-CONTENT-RULES.md` | **Read before publishing anything.** Claims that are prohibited, legally risky, or not yet true |

## Three rules that override everything else

1. **`07-CONTENT-RULES.md` wins.** If any other file here, or anything you infer from the
   code, suggests a claim that file prohibits, do not make the claim. That file exists
   because several attractive claims about this product are currently false or legally
   exposed.

2. **Status labels are load-bearing.** Every capability in these docs carries one of:
   **`SHIPPED`** (built, verified, safe to describe in the present tense),
   **`BUILT — NOT TRUSTWORTHY`** (exists in code, does not yet produce reliable output,
   must not be described as working), **`IN PROGRESS`**, or **`PLANNED`**. Never promote a
   capability up this ladder. "We're building X" is honest; "X does Y" when X is
   `BUILT — NOT TRUSTWORTHY` is not.

3. **Numbers come from here, not from the code.** Counts in this repository change between
   commits and several tables hold seed data that looks like production data. Every figure
   in these files was measured against the live database and is dated. If you need a number
   that is not here, say something qualitative instead of computing one.

## What the codebase will mislead you about

- **Seed data looks like customer data.** `backend/grc/seed_data/` holds framework
  libraries and demo content. Row counts from a running instance are not adoption metrics.
- **Module directories imply completeness.** A directory under `backend/grc/modules/`
  means work started, not that a feature is finished or reachable from the UI.
- **The brand name is unsettled.** The codebase contains `ComplyVerse`, `Complyverse` and
  `CompliverseAI`. Do not pick one yourself — see `07-CONTENT-RULES.md`.
- **Test and demo tenants exist.** `complyverse` and `1link` are development tenants.

## Currency

Measured **8 September 2026** against the `1link` development tenant and the repository at
that date. Figures older than a quarter should be re-verified before use in a campaign.
