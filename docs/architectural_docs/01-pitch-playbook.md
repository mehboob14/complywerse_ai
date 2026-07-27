# Pitch Playbook — Discovery Call

> Use this on YOUR screen during the call. Don't share it. It's a cheat-sheet,
> not a script — talk like a human, not a teleprompter.

---

## Opening (60-90 seconds)

> "Hey, thanks for jumping on. Before we dive in — just so you know where I'm
> coming from: I spent the last [N] months building a multi-tenant GRC
> platform for a client based in the Gulf. It went into production with their
> compliance team using it daily — they needed coverage across the Saudi NCA
> framework, ISO 27001, and SAMA cyber-resilience controls, plus their own
> internal policies. So when I read your post I knew this is what I've been
> working on. Before I walk you through what I built, can I ask you a couple of
> quick questions so I tailor what I show you to your situation?"

**Why this opens well**
- Establishes proof-of-work in the first 20 seconds
- Names a specific region + frameworks (NCA, SAMA, ISO 27001) — signals real implementation
- Avoids screen-share confidentiality by leading with the customer story
- Ends with "let me ask you" — flips the dynamic so you're discovering, not pitching

---

## Questions to ask FIRST (do this before walking through architecture)

Take ~5 minutes here. The more they talk, the more they sell themselves on you.

1. **Regulatory scope** — "What frameworks or regulators are you needing to comply with? NIST? ISO 27001? PCI? Industry-specific?"
2. **Industry + size** — "What's the org? Banking, healthcare, fintech? Roughly how many users will be in the system?"
3. **Multi-tenant or single?** — "Is this for one organization, or are you planning to offer it to multiple customers later?"
4. **Existing systems** — "Do you already use anything for vulnerabilities (Qualys / Tenable), ticketing (Jira / ServiceNow), or asset inventory? Anything we'd need to integrate with?"
5. **Hosting** — "Cloud — AWS / Azure / GCP — or on-prem?"
6. **The 'why now'** — "Is this driven by an audit, a regulator visit, or strategic? Helps me prioritize."
7. **What does v1 success look like?** — "If we ship in 4 weeks and it does ONE thing well, what's the one thing?"

Take notes. Their answers shape the entire pitch that follows.

---

## The Architecture Walk (10-15 minutes)

Use the diagrams in **02-architecture-walkthrough.md** alongside this. Don't read it; tell the story.

### Story arc

1. **The problem I solved for my client** — "They had spreadsheets for risks, SharePoint for evidence, an asset list in a Word doc, and three different scanners feeding nothing. Auditors couldn't trace 'this risk → these controls → this evidence' in one place. So everything I built was organized around making that traceability the first-class citizen."

2. **High-level architecture** — "Backend is FastAPI on Python 3.11, frontend is Next.js with React Server Components, database is Postgres. The big architectural decision was **database-per-tenant** — every customer org gets their own database, sharing a registry. Stronger isolation than schema-per-tenant, simpler than full deployment-per-tenant. The auditor never sees another customer's data, even by accident."

3. **The modules** (one sentence per module — see Modules section below)

4. **The differentiator: platform linkage** — "Most GRC tools are six tools in a trench coat. Assets here, risks there, evidence somewhere else. I wired everything together — click a risk, you see every asset and control it touches. Click an asset, you see every framework control that should apply, every vulnerability on it, every linked piece of evidence. That cross-linking is what auditors and CISOs actually need."

5. **Workflows + audit trail** — "There's a workflow engine for approvals, sign-offs, escalations. Every action is audit-logged with user + timestamp + before/after diff. That's table-stakes for a regulated industry."

6. **The connector story** — "We need to ingest from the real world: agentless scans (WinRM / SSH), endpoint agents for boxes behind NAT, cloud connectors (AWS Inspector, Azure Defender, GCP SCC), and external systems (ServiceNow tickets, Splunk events). All of it normalizes into the asset/vuln model."

7. **AI layer** — "Three places we use AI: a chat interface (ComplyChat) for natural-language Q&A across the whole platform, an asset auto-classifier that tags OS / criticality from probe data, and a regex-driven control-mapping recommender that suggests which framework controls apply to each asset (no LLM cost on the hot path — pure pattern matching, deterministic)."

---

## Modules — one-line each (for rapid-fire)

| Module | One-line description |
|---|---|
| **Governance** | Document lifecycle, policies, attestations, multi-tier approval workflows, full audit trail. |
| **Risk** | ERM with risk register, KRIs, incidents, COSO wheel, treatment-strategy tracking, heatmaps. |
| **Compliance** | 18+ frameworks pre-seeded (NIST, ISO, PCI, CIS, SOC 2, HIPAA, GDPR, DORA, NCA, ADHICS, MAS-TRM…), control mapping, evidence library with OCR. |
| **Assets** | IT inventory with criticality assessments, OS profiling via scanners, lifecycle state machine, derived criticality scoring. |
| **Vulnerabilities** | Register with KEV/EPSS enrichment, SLA tracking, exception workflows, patch correlation, NCA Saudi template. |
| **Connectors** | Agentless (WinRM/SSH), endpoint agents, cloud (AWS/Azure/GCP), external (ServiceNow / Splunk / Teams). |
| **Workflows** | Configurable approval chains, sign-off tiers, trigger dispatchers, escalations — tenant-customizable. |
| **AI** | ComplyChat (NL Q&A), AI asset classification, evidence quick-assess, regex-based mapping recommendations. |

---

## Objections — anticipate these

### "Can you screen-share what you built?"
> "I can't show the client's live tenant — confidentiality clause. What I CAN do is walk you through the architecture diagrams, show you anonymized screenshots if you want them after the call, or build you a small proof-of-concept on a sample dataset before you commit. Which would help most?"

### "Why should we trust you'll deliver in a month?"
> "I'm not promising the full platform in a month — I'm proposing a deliberately-scoped v1 that covers Risk Register + Compliance Framework + Evidence + Asset Inventory + an Approval Workflow. That's the minimum viable GRC. The other modules — vulnerability scanning, agent connectors, AI features — they're proven in my codebase, but they layer in over v2 and v3 once we've validated the foundation. I'll send you the week-by-week breakdown."

### "Why FastAPI / Next.js? Why not Django?"
> "FastAPI's async model handles connector ingest cleanly — when we're polling 200 assets via SSH, we don't want a worker thread per asset. Next.js gives us a fast UI with server components for the heavy dashboards and client components where we need interactivity. Postgres + SQLAlchemy is boring and battle-tested. Boring is good for compliance software."

### "Will it work on-prem?"
> "Yes — the whole thing runs in Docker today. We can deploy on AWS / Azure / GCP managed services, or on-prem on Kubernetes / Docker Swarm. The only external dependency is Postgres."

### "Database-per-tenant — won't that get expensive?"
> "On managed Postgres (RDS / Cloud SQL) it's one instance with N databases — same cost as schema-per-tenant. The trade-off is operational: backups and migrations run per-tenant. The benefit is hard isolation — there's no JOIN-with-bug that leaks Tenant A's data to Tenant B. For regulated customers that pays for itself the first time an auditor asks."

### "What about pricing?"
> "Let me send a proposal after this call once I understand the scope. For the v1 build I'd quote a fixed-fee — gives you cost certainty. Long-term engagement we can do hourly or retainer, whichever fits your model."

### "Can you do this solo, or do you need a team?"
> "Solo for v1 in a month is realistic — I've already built this once. For long-term, depending on scope we can either keep it lean (me + you / your stakeholder) or I can bring in a frontend specialist if you want UI polish at speed. I'll recommend honestly based on what we discover."

---

## Closing (last 5 minutes)

> "Based on what you've told me, here's how I'd approach the first month:
> [reference 03-mvp-1-month-proposal.md and adapt to their answers]
>
> I'll write this up properly and send it over by EOD. Couple of things from
> my side: I'd want to lock the v1 feature list before we start so we don't
> scope-creep our way past the 4 weeks. And I'd want one decision-maker on
> your side I can ping when blockers come up. Sound reasonable?"

**Then SHUT UP.** Let them respond. Don't fill the silence.

---

## After the call — same day

- Send a written summary email recapping what you discussed (shows you listened).
- Send the v1 proposal (the `03-mvp-1-month-proposal.md` content, adapted).
- Offer 1-2 next-step options: "Want to do a 30-min architecture deep-dive next week, or should I send a fixed-fee proposal now?"
- Don't push too hard. Confidence is quieter than urgency.
