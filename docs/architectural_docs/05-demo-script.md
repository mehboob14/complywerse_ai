# Demo Script — Narrating `04-client-demo.html`

> Open `04-client-demo.html` in your browser **before** the call. Share THAT browser tab.
> Nothing here is Liztek's — it's your own clean asset. Talk like a human, don't read this aloud.
> Total runtime ~10-12 min. Discovery questions come FIRST (see 01-pitch-playbook.md).

---

## Before you click anything (30 sec)

> "Before I show you screens — I can't put my employer's live system up, that's a
> confidentiality line I won't cross. What I'll do instead is walk you through exactly
> how I architect a platform like this, end to end, and then build yours fresh. Honestly
> you want someone who guards client systems that way — I'll guard yours the same."

Then share the browser tab. Land on **Overview**.

---

## Tab 1 — Overview (1 min)

> "This is one platform, eight modules, fully linked. The thing most GRC tools get wrong:
> they're six separate tools bolted together — risks in one place, evidence in another,
> assets somewhere else. The whole design here is that everything connects, so an auditor
> can trace a risk all the way back to the framework control in three clicks."

Point at the four numbers. Then: *"Let me show you the bones, then the part that matters most."*

---

## Tab 2 — Architecture (1.5 min)

> "Three tiers. Next.js front end, FastAPI backend in Python, Postgres underneath.
> FastAPI's async model matters because when we're polling 200 assets over SSH we don't
> want a thread per asset."

Point at the per-tenant DB box:
> "The one decision I'd flag early: **database-per-tenant**. Each customer org is a
> physically separate database. There's no shared table with a tenant-id column that a
> bug could leak through. For anything an auditor inspects, that's worth it — and on
> managed Postgres it costs the same as the cheaper approach."

If they ask "is this real or a prototype" → point at the **Hardened** card (RBAC, audit
diffs, SSO, encryption, backups).

---

## Tab 3 — Modules (1 min)

> "Eight modules. Each is useful on its own — but look at the 'Linked to' line under each.
> Risk links to assets, controls and frameworks. Assets link to vulnerabilities, controls,
> evidence. That cross-linking is the whole point, and it's what I'll show you next."

Don't linger. This is the setup for the money tab.

---

## Tab 4 — Traceability ★ (3-4 min — SPEND TIME HERE)

This is the differentiator. Make it interactive — let them watch you click.

> "Here's the scenario every regulated client lives through. The auditor says:
> *show me how you've mitigated this risk.* In most tools that's four tabs and ten minutes."

1. **Click "Privileged access leak"** (Risk, bottom-right).
   > "I click the risk. Instantly it shows what it's connected to — the internal control
   > that mitigates it, the asset it lives on, and the evidence."

2. **Click "DC-PRD-01"** (the Asset).
   > "Click the asset — now I see the vulnerability on it, the framework controls that
   > apply to it, and the same risk. Every record knows its neighbours."

3. **Click "A.8.2 Privileged access"** (the Control), then **"ISO 27001:2022"** (Framework).
   > "And it all traces back to the actual standard. Risk → asset → vulnerability →
   > control → evidence → framework. That's the green checkmark instead of an audit finding."

Close the tab:
> "That linking model is the hard part. It's not a feature you discover by prompting an
> AI — it's the decision the whole schema is built around."

---

## Tab 5 — Workflows (1 min)

> "One approval engine drives every sign-off — documents, risk treatment, vulnerability
> exceptions, evidence review. Configurable per tenant: timeouts, escalations, routing by
> severity. And every step writes to an immutable audit log with a before/after diff.
> That's table-stakes for an audit, and it's already built."

---

## Tab 6 — Connectors & AI (1 min)

> "Data gets in three ways — agentless probes, installed agents for boxes behind NAT, and
> cloud APIs. All of it normalizes into one asset model."

On AI, set the tone deliberately:
> "I'm careful with AI. It's used in exactly three places — natural-language Q&A, asset
> classification, and control-mapping suggestions. Two of those three are pure regex, no
> LLM cost. I don't add AI that doesn't pay for itself."

---

## Tab 7 — 1-Month MVP (2 min — the close)

> "So here's what I'd actually build for you in month one. Not all eight modules — a
> deliberately scoped v1 that's real and deployable: auth, two frameworks, controls,
> risk register, assets, evidence, one approval workflow, and a compliance dashboard.
> Week by week it looks like this."

Walk the four weeks quickly. Then point at the roadmap rows:
> "Everything in the v2/v3 column — multi-tenant, vulnerability scanning, connectors,
> the AI — is already proven in my codebase. It layers on once we've validated v1. So
> you get something live in four weeks, and a clear path to the full platform."

---

## Then close (from 01-pitch-playbook.md)

> "Based on what you told me earlier about [their answers], I'd adjust v1 to lead with
> [their priority]. I'll write this up and send it by end of day. Two asks from my side:
> lock the v1 feature list before we start so we don't scope-creep past four weeks, and
> give me one decision-maker I can ping on blockers. Sound reasonable?"

**Then stop talking. Let them respond.**

---

## Guardrails — do not break these on the call

- Do **not** name Liztek. Do **not** screen-share or log into its platform.
- If pushed "just show me what you built" → *"I can't put my employer's system on screen,
  but I'll walk you through how it's built and build yours fresh."* Then go to Tab 4.
- Use your real numbers (27+ frameworks, 99% extraction accuracy, SIEM integrations) —
  saying them is fine; showing their screen is not.
- On stack: be straight early — *"My GRC backend is Python/FastAPI, not Java."*
- On rate: anchor $22-25/hr, settle near $20, floor $18.
