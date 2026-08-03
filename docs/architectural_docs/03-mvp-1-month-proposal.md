# GRC Tool — 1-Month MVP Proposal

> Use this as the spine of your written Upwork response and the closing
> section of the call. Adjust the feature list once you've heard their
> answers to the discovery questions in `01-pitch-playbook.md`.

---

## What "MVP" means here

A working, deployable GRC tool that one organization can use to track risks,
compliance, evidence, and assets — in production, with multiple users, an
audit trail, and approval workflows. Not a prototype. Not a demo.

It will NOT yet include: vulnerability scanning, agent-based connectors,
cloud connectors, AI features, multi-tenant support. Those are the v2 / v3
build-outs once v1 is validated.

---

## V1 feature scope (deliverable in 4 weeks)

### 1. Authentication & authorization
- Email + password login (JWT)
- 3 roles out of the box: **Administrator · Risk/Compliance Manager · Auditor (read-only)**
- Password policy (complexity + expiry + lockout)
- Per-action permission gating
- Audit log of every login + every write action

### 2. Frameworks library (read-only registry)
- 2 frameworks pre-seeded in v1: **ISO 27001:2022** + **NIST CSF 2.0**
  - (~93 + 108 controls = ~200 control rows shipped)
- Browseable hierarchy: Framework → Domain → Objective → Control
- Search across controls

> If they're regulated by something specific (PCI DSS, HIPAA, GDPR, NCA),
> we swap one or both. I have JSON seed files ready for 18+ frameworks.

### 3. Internal Controls library
- CRUD on the org's own controls
- Map each internal control to one or more framework controls (many-to-many)
- Status: implemented / partial / not implemented
- Effectiveness rating + last-tested date

### 4. Risk register
- CRUD on risks (title, description, category, owner, status)
- **Inherent vs Residual** scoring (likelihood × impact, 5×5 matrix)
- Treatment strategy: Accept / Reduce / Transfer / Avoid
- Link risks to internal controls (so a risk's residual score reflects mitigating controls)
- Link risks to assets
- Risk heatmap dashboard + risk-by-category breakdown

### 5. Asset inventory
- CRUD on IT assets (name, host, IP, owner, criticality, asset type, OS family)
- Tagging by business function (Payments / HR / Customer Data / etc.)
- Data classification field (Public / Internal / Confidential / Restricted)
- Link assets to controls and to risks
- Filter + search

### 6. Evidence library
- Upload files (PDF, DOCX, XLSX, images — 50 MB cap per file)
- Link evidence to internal controls and to framework controls
- Tag with status (Draft / Approved / Expired) and expiry date
- Reminder banner for evidence expiring within 30 days

### 7. Approval workflow (one workflow, not the full engine)
- Submit an internal control for review
- Two-step approval: Reviewer → Approver
- Status states: Draft → Submitted → Approved / Returned
- Email notification on each state change

### 8. Compliance dashboard
- Compliance score per framework (% of framework controls with a mapped internal control that's at least "partial")
- Top-10 unmapped controls list
- Risks-without-controls list
- Evidence-expiring-soon list

### 9. Audit log
- Every CRUD action recorded: who, when, what, before/after diff
- Filterable by user, by entity type, by date range
- CSV export

### 10. Admin panel
- User management (create, deactivate, role-change)
- View audit log
- Configure password policy

---

## What's deliberately OUT of v1

| Feature | Why deferred |
|---|---|
| Multi-tenant (database-per-tenant) | v1 ships as single-tenant. Multi-tenancy adds 1-2 weeks. Easy to layer on once we know who the customers are. |
| Vulnerability management | Requires scanner integrations. v2 work. |
| Connectors (cloud / agent / agentless) | Each connector is ~1-2 weeks. v2 / v3. |
| Workflow engine (configurable) | v1 has ONE hardcoded approval workflow. Configurable engine is a separate build. |
| AI features (ComplyChat / auto-classification / mapping recommendations) | Layered on after v1 stabilizes. |
| Governance documents module | Significant scope. Best handled as v2. |
| SSO (SAML / OIDC) | Default to email+password. SSO can be added in 3-4 days when needed. |
| Mobile responsive polish | Functional on tablet/mobile, but desktop-first for v1. |

These can all be agreed up-front as v2 / v3 roadmap so the client sees the long-term value, not just the 4-week deliverable.

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | **FastAPI** (Python 3.11) + **SQLAlchemy 2.x** + **Pydantic v2** |
| Database | **Postgres 15+** |
| Frontend | **Next.js 15** (App Router) + **React 19** |
| UI | **Tailwind CSS** + **Lucide icons** + **Recharts** for visualizations |
| State / data | **TanStack Query** for server state |
| Auth | **JWT** (HS256) + **bcrypt** password hashing |
| File storage | **Local filesystem** in v1 (easy to swap to S3 / Azure Blob later) |
| Email | **SMTP** with template support (Resend / SendGrid / SES — your pick) |
| Deployment | **Docker + docker-compose** for local + staging; **AWS / Azure / GCP managed Postgres + container service** for prod |
| CI/CD | **GitHub Actions** for build/test, optional automated deploy |

---

## 4-week timeline

```
WEEK 1 — Foundation
─────────────────────────────────────────────────────────────────
Mon-Tue   Project setup, Docker, Postgres, FastAPI scaffold,
          Next.js scaffold, design tokens
Wed-Thu   Auth (JWT, login, password policy), user CRUD, RBAC
Fri       Audit log infra, framework seed loader

DELIVERABLE: Login works, admin can create users, frameworks visible

WEEK 2 — Risk + Assets
─────────────────────────────────────────────────────────────────
Mon-Tue   Internal Controls library CRUD + mapping to framework controls
Wed-Thu   Risk register CRUD + heatmap + linking to controls + assets
Fri       Asset inventory CRUD + tagging + filters

DELIVERABLE: Manager can map controls to a framework, register
             risks, list assets, and see a heatmap

WEEK 3 — Evidence + Workflow + Dashboard
─────────────────────────────────────────────────────────────────
Mon-Tue   Evidence library: upload, link, expiry reminders
Wed-Thu   Approval workflow + email notifications
Fri       Compliance dashboard (scores, unmapped, expiring lists)

DELIVERABLE: Full happy-path: upload evidence, link to control,
             submit for approval, see compliance score on dashboard

WEEK 4 — Polish + Deploy + Handover
─────────────────────────────────────────────────────────────────
Mon       Cross-cutting polish (loading states, error pages, empty states)
Tue       Audit log UI + CSV export
Wed       Staging deploy on client cloud, smoke test with real data
Thu       UAT with client, fix list
Fri       Production deploy, handover docs, training session

DELIVERABLE: Live in client environment, 2-3 stakeholders trained
```

---

## What I'll deliver alongside the code

- **Source repository** (private, your choice of GitHub / GitLab / Bitbucket)
- **Architecture document** with deployment diagrams
- **API documentation** (auto-generated OpenAPI / Swagger)
- **Database schema** documentation + ER diagram
- **Runbook**: how to deploy, restore from backup, add a new framework, add a new user role
- **Training session** (2 hours, recorded) for the operational stakeholders
- **30 days of post-launch support** (bug fixes + minor tweaks) included in the fixed fee

---

## Pricing structure (recommended approach)

> Don't share this section verbatim; use it to set the conversation.

- **Fixed fee** for the 4-week v1 build — gives the client cost certainty
- **Hourly or retainer** for the v2 / v3 expansion (vulns, connectors, AI)
- Suggested range to discuss internally: **$8,000–$15,000** for the v1 fixed fee depending on:
  - Whether they want SSO included (+$1,500)
  - Whether they want a 2nd framework swapped in (+$500)
  - Whether they want their visual design / branding applied (+$1,500)
  - Whether deployment is on a cloud they manage vs cloud you set up (+$1,000)

Anchor high, leave room to negotiate down. A "simple GRC tool in a month" sounds easy to a non-engineer — make sure the price reflects the actual engineering depth.

---

## V2 + V3 roadmap (sell the long-term)

Lay this out at the end of the call so they see the multi-month engagement opportunity, not a one-and-done.

### V2 (months 2-3)
- Multi-tenant support (database-per-tenant)
- Vulnerability register (CRUD, KEV/EPSS enrichment, SLA tracking)
- Governance documents module (policies, attestations)
- Configurable workflow engine
- SSO integration
- One cloud connector (your pick of AWS / Azure / GCP)

### V3 (months 4-6)
- Agent-based scanning (Windows + Linux endpoints)
- Agentless Connect Wizard (WinRM / SSH / Database probes)
- Additional cloud connectors
- ComplyChat AI assistant
- Control-mapping recommendations engine
- Custom framework import (Excel / JSON)
- External system connectors (ServiceNow, Splunk, Jira)
- Reporting / Excel exports per framework

---

## Why pick me over a junior + Cursor

(Don't say this on the call. But have the answer ready if you're asked
why you over a cheaper bid.)

> "I've built this exact system already. A junior with AI tooling can get you
> to 70% in a month — but it's the last 30% that decides whether your auditor
> signs off or writes a finding. The multi-tenant isolation, the audit log
> diff format, the approval workflow edge cases, the framework seed loader,
> the linking model that holds the modules together — these aren't features
> you discover by prompting; they're decisions you make once you've seen what
> breaks in production. That's what you'd be paying for."
