# Third-Party Content Notice

This repository redistributes third-party material. This file records the
attribution that redistribution requires. It records attribution only — it does
not resolve whether each redistribution is permitted. Those questions are open
and are tracked in [docs/control-plane-status.md](docs/control-plane-status.md);
they gate anything customer-facing.

---

## Secure Controls Framework (SCF)

**Attribution:** Secure Controls Framework Council, LLC — <https://securecontrolsframework.com>
**Licence:** Creative Commons Attribution-NoDerivatives 4.0 International (CC BY-ND 4.0)
**Version redistributed:** SCF 2026.2 (generated 2026-07-08)

Redistributed under `backend/grc/seed_data/scf/`:

| File | Content |
|---|---|
| `controls.json` | 1,534 controls across 34 domains |
| `objectives.json` | 5,956 assessment objectives |
| `cmm_levels.json` | Capability maturity criteria per control |
| `domains.json`, `sources.json` | 34 domains; 249 crosswalk sources |
| `erl.json` | Evidence request list artifacts and links |
| `mappings.csv.gz` | 69,791 published crosswalk mapping rows |

SCF text is reproduced **verbatim and unmodified**. It is rendered to users as
published and is never paraphrased or rewritten.

**No-derivatives compliance.** SCF's guidebook (GEN-FAQ-006) explicitly prohibits
using artificial intelligence to leverage SCF content to generate policies,
standards, procedures, metrics, risks, threats or other derivative content. No
SCF prose is passed to a language model for generation anywhere in this codebase.

Material in this repository that *references* SCF — the crosswalk registry,
requirement dispositions, resolver output and consolidated evidence sets — cites
SCF control identifiers and carries our own text. `evidence_consolidated.json` in
particular is derived from our own framework libraries' evidence requirements,
not from SCF prose.

**Open question, not settled by this notice:** whether converting the published
workbook into the JSON form above, and serving a tenant-filtered subset of it in
a paid product, is permitted reproduction under CC BY-ND or requires a commercial
licence. See the status document.

---

## Framework requirement libraries

`backend/grc/seed_data/frameworks/` contains 34 libraries that reproduce the
verbatim requirement text of their source standards, including ISO 27001,
ISO 22301, ISO 42001, PCI DSS, CIS Critical Security Controls and HITRUST CSF.

**These carry a live and unresolved redistribution exposure.** ISO grants no
redistribution right; PCI DSS requires written permission; CIS is licensed for
non-commercial use. This predates the SCF work and is independent of it. The
remedy under consideration is the discipline SCF itself follows: publish the
identifier, link to the source, and do not reproduce the prose.

Each library carries its source attribution in its own `framework` metadata block.

---

## NIST publications

Material derived from NIST publications — including the NIST CSF 2.0 library
built from NIST's Cybersecurity Framework Reference Tool export, and libraries
referencing NIST SP 800-53 and SP 800-171 — is a work of the United States
Government and is not subject to copyright protection in the United States
(17 U.S.C. § 105). It is reproduced verbatim.

---

*Regenerate the inventory above if the seed data changes. Adding a redistributed
source without adding it here leaves the attribution incomplete.*
