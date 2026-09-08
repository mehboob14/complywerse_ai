# Automation control library — data provenance

Powers **Automation → Common Controls** (`/automation/common/controls`) and the
per-framework endpoints (`/automation/{framework}/controls|criteria`).

## Files

| File | Role |
|------|------|
| `common/controls.json` | **Served artifact.** One unified control library (Probo mitigations); each control carries `requirements.{soc2,iso27001,gdpr}[{code,name,text}]`, `frameworks[]`, `category`, `soc2_criteria[]` (used to link the shared automated checks). |
| `soc2/`, `iso27001/`, `gdpr/` | Per-framework `control_templates` + `requirements` + `template_requirements` (+ `crosswalk`). Requirements are the source of `name` (title) and, where present, full text. |
| `gap_requirement_texts.json` | **Verified gap-fill full text** for ISO/IEC 27001:2022 management clauses 4–10 and GDPR Art. 29, keyed `{framework: {code: text}}`. Highest-priority `text` source. |

## Where requirement `text` (full original text) comes from

Resolution order per requirement (see the build step): `gap_requirement_texts.json`
→ richer compliance-framework seed (`seed_data/frameworks/iso_27001.json` Annex A,
`gdpr.json`, with GDPR parent-article fallback) → SOC 2 TSC wording (already full) →
title fallback.

### The gap-fill (ISO clauses 4–10 + GDPR Art. 29)

Probo's framework files carry only **titles** for the ISO management clauses (4–10)
and our seeds don't include them (Annex A only). Those clauses are the harmonized
**Annex SL** structure shared verbatim-in-intent across every ISO management-system
standard. We therefore sourced them from our own compliance module: the same clause
in **ISO 22301:2019 / ISO 45001:2018 / ISO 42001:2023** (parsed frameworks already in
the tenant DB), then re-scoped the wording to information security and adversarially
verified each (coverage / correct-scope / no-hallucination) before writing it to
`gap_requirement_texts.json`. GDPR Art. 29 was drafted from the regulation and verified
against our other GDPR article texts. Result: ISO 125/125 and GDPR 193/193 mapped
requirements now show full original text.

## Regenerate

1. Clone Probo: `git clone --depth 1 https://github.com/getprobo/probo`
2. Rebuild per-framework seeds (ISO from `standards`; GDPR control↔article mappings
   are AI-generated — Probo maps none) and then `common/controls.json`, which folds in
   `gap_requirement_texts.json`. Build scripts are kept with the change that introduced
   this data; `gap_requirement_texts.json` is hand-maintained and should be preserved
   across rebuilds.
