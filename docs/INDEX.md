# Documentation Index

Central index of project documentation. Start with [SETUP.md](SETUP.md) to run the app locally.

## Setup & operations
- [SETUP.md](SETUP.md) — Local setup: prerequisites, backend/frontend install, env vars, running, multi-tenant notes, default credentials.

## Architecture & data
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) — Full database schema reference (tables, columns, relationships).
- [../.github/copilot-instructions.md](../.github/copilot-instructions.md) — Architecture conventions, critical files, multi-tenant patterns, router-ordering gotchas (also used as AI-assistant context).

## Product
- [COMPLYVERSE_GRC_PRODUCT_MASTER_CAPABILITIES.md](COMPLYVERSE_GRC_PRODUCT_MASTER_CAPABILITIES.md) — Product feature matrix (modules × submodules × actions).

## Frontend / design
- [DESIGN_REFERENCE.md](DESIGN_REFERENCE.md) — Tailwind design tokens, component patterns, white-theme conventions.

## Module-internal docs (kept next to their code)
- `backend/docs/JOB_RUNTIME.md` — Background-job status tracking and async patterns.
- `backend/grc/modules/workflow_engine/WORKFLOW_RUNTIME_FLOW.md` — Workflow engine execution model.
- `backend/grc/modules/workflow_engine/INTEGRATION_GUIDE.md` — Workflow engine integration patterns.
- `backend/grc/modules/chatbot/complychat/complychat/SCHEMA_DOMAIN_ORGANIZATION.md` — ComplyChat schema-domain organization.
- `backend/grc/seed_data/frameworks/README.md` — Framework seed-data format.

## Archive (historical, not maintained)
- [archive/session-work-log.md](archive/session-work-log.md) — Past session work log (Mar–May 2026).
- [archive/vuln-asset-roadmap.md](archive/vuln-asset-roadmap.md) — Vuln/asset planning doc.
- [archive/UI_UX_COMPACT_REFERENCE.md](archive/UI_UX_COMPACT_REFERENCE.md) — Older, superseded by DESIGN_REFERENCE.md.
