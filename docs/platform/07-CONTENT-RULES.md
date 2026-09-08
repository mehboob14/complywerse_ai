# Content Rules — Read Before Publishing

This file overrides every other file in this directory and anything inferred from the
codebase. It exists because several attractive, obvious-seeming claims about this product
are currently false, legally exposed, or both — and because an automated agent posting to
LinkedIn cannot take a claim back.

---

## 1. Hard prohibitions

Never publish any of the following, in any channel, in any phrasing.

### Compliance percentages derived from automated checks

The evidence engine currently proves that a connector authenticated, not that a control
operates. See `05-AUTOMATION-AND-INTEGRATIONS.md`.

Prohibited: *"X% compliant automatically"* · *"continuous compliance monitoring"* ·
*"always audit-ready"* · *"real-time compliance posture"* · *"automated compliance
evidence"* · any screenshot or mock-up showing an automated compliance score.

### Reproduction of licensed framework or control text

**SCF content.** The Secure Controls Framework is published under **CC BY-ND 4.0**. Control
text may be rendered verbatim inside the product under review, but must not be reproduced
in marketing material, and **must never be paraphrased, rewritten or used as input to
generate derivative content** — the licence explicitly prohibits using AI to generate
policies, standards, procedures, metrics, risks or threats from SCF content.

> **For an LLM content agent this is the sharpest constraint in this file: do not read SCF
> control text and write marketing copy derived from it.** Describe the platform's use of
> SCF at the level of structure and counts — never at the level of control content.

**Framework requirement text.** The shipped libraries carry verbatim requirement text from
ISO 27001, PCI DSS, CIS Controls and HITRUST. ISO grants no redistribution right, PCI
requires written permission, CIS is licensed non-commercial. **Do not quote requirement text
in any public material.** Cite the identifier and link to the source instead.

### Trademarked terms

**"Common Controls Framework" is an SCF trademark.** Do not use it as a product descriptor.
Say "common control set", "unified control library" or "the control plane".

Framework names (ISO, PCI DSS, SAMA, SOC 2 and the rest) are the marks of their owners. Use
them factually to describe coverage. Never imply endorsement, partnership, certification or
accreditation by any framework body or regulator.

### Claims about customers, scale or outcomes

No customer names, logos, quotes, case studies, counts, sector references or outcome claims
without written approval. No adoption, revenue, uptime, performance or scale figures — none
are established.

### Regulatory guarantees

Never state or imply that using the platform makes an organisation compliant, will pass an
audit, or satisfies a regulator. The platform supports a compliance programme; it does not
confer compliance.

Prohibited: *"guaranteed compliance"* · *"audit-proof"* · *"regulator-approved"* ·
*"ensures compliance with SAMA/ISO/PCI"*.

Note that the sign-in tagline in the product currently reads *"The GRC platform your
regulators trust."* **Do not reuse that line in marketing** — it implies regulator
endorsement the product does not have.

---

## 2. Claims requiring a mandatory caveat

| Claim | Required caveat |
|---|---|
| 88% mapping quality | Always **±6pp**, three independent reviewers, 120 sampled links. Never round to 90% |
| 95.1% requirement coverage | State as measured on a date, not as a guarantee |
| Evidence consolidation, 8.0× | Must be labelled **in progress — 121 of 300 controls** |
| COBIT coverage | Must state it is **100% inferred by rollup**, not code-matched |
| GDPR / SAMA CSF coverage | 66% and 50% respectively are inferred by rollup |
| Any connector capability | Must not carry an attached compliance claim |
| Any AI feature | Must be described as **assistive** — it does not compute or assert compliance |

---

## 3. Status discipline

Never promote a capability above its status in `03-MODULES.md`.

- `SHIPPED` → present tense. "The platform does X."
- `IN PROGRESS` → "We're building X" / "X, in progress". Never present tense.
- `BUILT — NOT TRUSTWORTHY` → describe the **problem being solved**, never the capability
  as working. The honest framing in `05-AUTOMATION-AND-INTEGRATIONS.md` is approved copy.
- `PLANNED` → roadmap language only, and only if the post is explicitly about roadmap.

**Specifically: cloud infrastructure connectors (AWS, Azure, Entra, GCP, Kubernetes) do not
exist.** Do not imply cloud posture management. This is the easiest mistake to make from
the codebase, because AWS runner code exists.

---

## 4. Brand

The codebase contains **`ComplyVerse`**, **`Complyverse`** and **`CompliverseAI`**. The
correct form is **not settled**.

**Do not choose one.** Escalate to a human and hold the content until the brand, legal
entity name and domain are confirmed. Publishing under an inconsistent name is expensive to
undo across social platforms.

---

## 5. Open decisions that gate customer-facing content

Two licensing questions are unresolved and both bear on published material:

1. **Whether serving a tenant-filtered subset of unmodified SCF text in a paid product
   counts as permitted reproduction under CC BY-ND.** If not, commercial licensing starts at
   a meaningful annual figure. Until this is answered in writing, do not publish material
   that showcases SCF control content.

2. **The verbatim ISO / PCI DSS / CIS / HITRUST requirement text in the shipped framework
   libraries.** This predates the current work and is independent of SCF.

A signal worth heeding: an automated attempt to repair truncated PCI DSS requirement text
was **blocked by a content filter**. Treat that as confirmation, not an obstacle.

**Until both are closed, marketing may describe the platform's structure, counts,
architecture and method — but must not reproduce framework or control content.**

---

## 6. Channel notes

**LinkedIn** — the primary channel. Audience is CISOs, heads of compliance and GRC
practitioners. Specific, technical, unhurried. A single concrete number with its caveat
outperforms three adjectives. Regional posts should be written for their market.

**Instagram** — visual. Safe subjects: the framework coverage map, the disposition model as
a diagram, the duplication problem illustrated. **No screenshots containing framework
requirement text, SCF control text, or any customer or tenant data.** Screenshots must come
from a purpose-built demo tenant, never from `complyverse` or `1link`.

**Blog / long form** — the place for the measurement stories: the 41% blinded trial, the
disposition model, why evidence consolidation cannot be done with string matching.

---

## 7. Escalate to a human before publishing

- Anything naming a customer, regulator or framework body
- Anything quoting framework or control text
- Anything with a compliance percentage attached to automation
- Anything using the brand name in a new form
- Anything about pricing, funding, roadmap dates or headcount
- Any comparison to a named competitor
- Any claim not traceable to a fact in this directory

---

## 8. The default

**If a claim cannot be traced to a specific statement in these files, do not make it.**

Generating a plausible-sounding capability from directory names, table names or model files
is the single most likely failure mode for an agent with repository access. The code shows
what someone started building. These documents show what is true.
