# Architecture

Written for an LLM that needs to describe the system accurately without reading the code.
Technical claims here are safe to make publicly; anything not stated here should be
checked before publication.

## Stack

**Backend** — Python, FastAPI 0.131 with Pydantic 2.10 for request and response models,
SQLAlchemy 2.0 as the ORM, PostgreSQL for storage, Celery 5.4 with Redis for asynchronous
work, `psycopg2` as the driver. The application mounts under `/grc`.

**Frontend** — Next.js 14.2 on the App Router, React 18, TypeScript 5.4, Tailwind CSS 3.4
for styling, TanStack Query 5 for server state, Recharts for visualisation, Axios for
transport.

**AI** — the OpenAI SDK is a dependency, used for assistive features (document parsing,
drafting, the built-in assistant). It is not in the path of any compliance calculation.

## Multi-tenancy: a database per tenant

This is the architectural decision most worth describing, because it is unusual and it is
a genuine selling point for regulated buyers.

Most SaaS GRC platforms are single-database and multi-tenant, separating customers by a
`tenant_id` column on every table. This platform gives **each tenant its own PostgreSQL
database** (`grc_<slug>`), with a separate master catalogue database holding only the
tenant registry and the identities needed to route a request.

The request path:

1. A request arrives carrying a tenant context (subdomain or session).
2. The master catalogue resolves the tenant to a slug.
3. A per-tenant engine is opened against `grc_<slug>` — connection pools are cached per
   tenant, not per request.
4. Every operational table — controls, evidence, risks, findings, users' work — lives in
   that database and nowhere else.

**Why this matters to a regulated buyer.** Data residency and isolation are contractual
requirements in most of the regulation this platform serves. "Your data is in your own
database" is a materially stronger statement than "your data is filtered by a column", and
it is verifiable. It also makes per-tenant export, deletion and jurisdictional placement
tractable rather than a migration project.

**The trade-off, stated honestly.** Schema changes must be applied across every tenant
database, and cross-tenant analytics are harder. The platform handles the first with a
self-healing schema (below) rather than a migration tool.

## Schema management: self-healing, not migrated

The project has **no Alembic migration chain in the request path**, despite Alembic being
present as a dependency. Instead, on opening a tenant engine the platform runs SQLAlchemy's
`create_all` to add any missing tables, then applies an additive column-add pass for
columns that appeared since the database was created.

The constraint this imposes, and it is deliberate: **schema changes must be additive.**
Adding a table or a nullable column is safe and self-applying. Renaming or dropping is not,
and requires a deliberate migration.

For public writing: describe this as *"additive, self-healing schema — a new tenant
database is provisioned and brought current automatically"*. Do not describe it as
"migration-free" in a way that implies destructive changes are handled; they are not.

## Domain model

The data model is organised as numbered model modules under `backend/grc/models/`, more
than fifty of them, each owning one domain area — multi-tenancy, RBAC, identity provider
integration, audit trail, framework normalisation, evidence, enterprise risk, governance
documents, IT asset inventory, vulnerability management, vendor risk, business continuity,
workflow automation, and so on.

Three structures carry the weight:

**The framework library.** Each of the 34 frameworks ships as a JSON document under
`seed_data/frameworks/` holding its requirements with code, title, description, verbatim
text, domain and evidence asks. These seed `UploadedFramework` and
`ParsedFrameworkControl` rows per tenant.

**The SCF control catalogue.** Eleven tables holding the control set, its assessment
objectives, its evidence requests, its crosswalk to 249 external sources, and per-tenant
control state. Described fully in `04-CONTROL-PLANE.md`.

**The crosswalk.** `grc_scf_mapping` — currently **80,635 rows** — joining a control to a
framework requirement, each row carrying its provenance (`scf` published, `resolver`
deterministic, or `ai` authored), its match mode and a confidence score, so any single
mapping can be traced to how it was established.

## Compliance plugins: the evidence engine

Automated evidence collection is a plugin architecture rather than bespoke integrations.
A *runner* knows how to talk to a class of system; a *plugin* is a declarative check
definition executed by a runner.

- **`live_api` runner** — HTTP-based SaaS providers. 65 providers with 130 declarative
  checks. Adding a provider is a catalogue entry, not new code.
- **`aws_readonly` runner** — read-only AWS API calls for infrastructure benchmarks.

Checks are declarative: a definition names the endpoint, the shape of the response and the
condition that constitutes a pass. Results become findings with a status, and findings
attach to controls.

**State: `BUILT — NOT TRUSTWORTHY`.** The engine runs. The binding layer that decides which
control a given check proves is not yet sound. See `05-AUTOMATION-AND-INTEGRATIONS.md`
before writing anything about automation.

## Background work

Celery with Redis handles anything that must not block a request: connector collection
runs, scanner ingestion, report generation, scheduled jobs. Per-tenant job rate limiting is
configurable.

## Identity and access

Session-based authentication with per-tenant password and session policy, role-based access
control, and SSO through an identity-provider integration (Microsoft Entra ID among
others). A full audit trail model records privileged actions.

## Deployment shape

The application serves the API and the Next.js frontend separately in development
(backend on `:4000`, frontend on `:3000`), with tenants addressed by subdomain
(`<tenant>.localhost:3000` locally). PostgreSQL and Redis are external dependencies.

## What NOT to claim about the architecture

- Do not describe it as microservices. It is a modular monolith with async workers.
- Do not claim a specific cloud, region set or certification for the hosting — none is
  established in the codebase.
- Do not claim horizontal scale figures, uptime, or performance numbers. None are measured.
- Do not describe the AI features as "agentic" or as making compliance decisions. They are
  assistive and sit outside the compliance calculation path.
