# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9

## Artifacts

### CompliverseAI GRC Platform (`artifacts/grc-frontend`)
- **Framework**: Vite + React (migrated from Next.js)
- **Routing**: wouter (replacing Next.js file-based routing)
- **Styling**: Tailwind CSS v4 + custom CSS variables
- **State management**: @tanstack/react-query
- **Port**: 20080 (via `PORT` env var)
- **Preview path**: `/`

The frontend is a full GRC (Governance, Risk, Compliance) platform with the following modules:
- Dashboard (overview with stats, GRC network diagram, compliance coverage)
- Compliance (frameworks, controls, evidence)
- Risk / ERM (risks, KRIs, RCSA, internal controls, IS projects)
- Governance (policies, documents, regulatory changes)
- Vendor Risk (vendors, assessments, questionnaires)
- Vulnerabilities (scanning, reporting, dashboard)
- Assets management
- Integrations

### API Server (`artifacts/api-server`)
- **Framework**: Express (TypeScript), port 8080 (via `PORT` env var)
- **Preview path**: `/api`
- Acts as a proxy layer forwarding all requests to the Python FastAPI backend at `http://127.0.0.1:5000/grc/*`
- Mounts all routes at `/api` — e.g., `/api/risks` → `http://127.0.0.1:5000/grc/risks`
- `BACKEND_URL` env var controls Python backend address (default: `http://127.0.0.1:5000`)

### GRC Python Backend (`GRC Python Backend` workflow)
- **Source**: `.migration-backup/backend/`
- **Entry**: `main.py` (FastAPI app)
- **Port**: 5000
- **Workflow command**: `cd .migration-backup/backend && python3 -m uvicorn main:app --host 0.0.0.0 --port 5000 --reload`
- **Database**: PostgreSQL (via `DATABASE_URL` secret)
- **Auth**: JWT via `SESSION_SECRET` secret, tenant-based multi-tenancy
- Mounts GRC app at `/grc/*` — frameworks, risks, compliance, governance, vulnerabilities, etc.

## API Request Flow

```
Browser → Replit proxy → /api/* → API Server (port 8080) → http://127.0.0.1:5000/grc/* → Python FastAPI
```

Frontend API client (`src/lib/api.ts`) defaults `VITE_API_BASE_URL` to `/api`, routing through the Replit path-based proxy to the Express API server, which then proxies to the Python backend.

## Authentication

The app uses a custom email/password authentication system backed by the Python FastAPI backend.

- **Login page**: `/login` — POSTs to `/api/auth/login` with `{ username, password }` and optional `X-Tenant-Slug` header
- **Auth guard**: `AuthGuard` component in `src/App.tsx` queries `/api/auth/me` and redirects unauthenticated users to `/login`
- **Session**: Primary mechanism is HttpOnly cookie sessions set by the Python backend. The API client also reads `token` from localStorage and attaches it as a `Bearer` header as a fallback (e.g. when cookies aren't available).
- **API client**: `src/lib/api.ts` — attaches `X-Tenant-Slug` header automatically; appends `Authorization: Bearer <token>` if a token exists in localStorage; redirects to `/login` on 401
- **Header**: Fetches current user from `/api/auth/me` via React Query; displays name, initials, email, and tenant name
- **Public routes**: `/login`, `/register`, `/vendor-risk/questionnaires/:token`

## Compliance Plugin Runners

Three runner types are registered in `grc/modules/compliance_plugins/runners/registry.py`:

- **`aws_readonly`** (`aws_runner.py`) — boto3-driven, AWS API verb-gated to `Get*/List*/Describe*` at seed time.
- **`linux_ssh`** (`ssh_runner.py`) — paramiko, deny-listed shell verbs (sudo/rm/mv/dd/systemctl-start/apt-install), write-redirects blocked except `/dev/null|stderr|stdout`.
- **`windows_winrm`** (`winrm_runner.py`) — pywinrm, PowerShell or CMD shell. Read-only deny list rejects every PowerShell approved-verb family that mutates state (`Set-/New-/Remove-/Stop-/Start-/Restart-/Disable-/Enable-/Add-/Remove-/Invoke-/Import-/Export-/...`) plus classic CMD writers (`del/copy/format/...`), `reg add|delete`, `sc create|delete|...`, `netsh ... set|add|delete`, `Out-File`, `Tee-Object`. The classic-CMD pattern uses `(?<![-\w])` lookbehind so PowerShell cmdlets like `Format-List`/`Move-Item` (already covered by the verb pattern) don't double-trip. Credentials in `services/credentials.py` accept either a full `WINRM_ENDPOINT` URL or `WINRM_HOST + WINRM_PORT + WINRM_SCHEME` (defaults: https/5986). Supported `expect.kind` values: `exit_zero`, `stdout_contains`, `stdout_not_contains`, `stdout_regex`, `stdout_not_regex`, `line_kv_equals` (parses both `Key : Value` PowerShell Format-List and `net accounts` colon-separated output), `secedit_field_equals` (parses INI from `secedit /export`). Tests live in `runners/tests/test_winrm_runner.py` (33 cases, all using mocked `winrm.Session` so they run on Linux CI).

PDF-extracted Windows rules now get best-effort PowerShell synthesis in `pdf_ingest/gen_check.py` for: `secedit`, `auditpol`, `Get-MpPreference`, `Get-ItemProperty HKLM:\…` registry reads, and `net accounts`. All synthesised checks remain `auto_generated=True` and `pending_review`, so a human reviewer must tighten `expect.field`/`expect.expected` before the plugin can execute.

### Plugin review queue editor (Phase 1B)

`POST /compliance-plugins/{id}/review` accepts an optional patch alongside `{decision: "approve"}`: `check_definition` (object), `runner_type`, `severity`, `title`, `description`, `rationale`, `remediation`. Patches re-run the same safety gates as the JSON importer — `_validate_readonly_at_seed_time` for AWS, `ssh_runner._is_command_safe` for `linux_ssh`, `winrm_runner._is_command_safe` for `windows_winrm`. Approving with edits also clears `auto_generated_check` so the library no longer flags the row.

Frontend (`compliance-plugins/ingest/page.tsx`) renders an inline expandable editor for each pending plugin: title / severity / runner / JSON `check_definition` textarea / description, with the original PDF audit-steps text visible as a `<details>` block for cross-reference. Backend rejection messages surface as a red bubble on the card.

The integrations connections page (`integrations/connections/page.tsx`) and the plugin definition page (`compliance-plugins/page.tsx`) now expose `linux_ssh`, `windows_winrm`, and `aws_readonly` connection types with per-type defaults (port, env-prefix hint, host placeholder). The compliance-plugins runner filter and connection picker include `windows_winrm`. The JSON-import sample template ships a WinRM `Get-MpPreference | Format-List` example.

## Workflow Engine Notes

- **Trigger Dispatcher** (`.migration-backup/backend/grc/modules/workflow_engine/services/trigger_dispatcher.py`):
  - Polls `grc_audit_logs` and derives event names from `resource_type` + `action` + path enrichment
  - Non-CRUD actions (e.g. `ai_generate_charter`, `publish`, `review`) also emit a generic `{module}.{entity}.trigger` event so workflow definitions using the "trigger" verb can catch them
  - `actor_source="workflow"` filter prevents re-triggering loops
- **Email notifications** (`action_handlers.py`): Only sends to explicitly configured recipients — no fallback to all tenant users

## Key Migration Notes

- `src/lib/navigation.ts` — shim for Next.js navigation hooks (useRouter, usePathname, useSearchParams, useParams)
- `src/App.tsx` — wouter routing for all dashboard routes
- `src/index.css` — Tailwind v4 @theme block with custom colors (primary, surface, success, warning, danger, info)
- `src/app/globals.css` — 2400+ line app styles (all @apply cross-class references expanded inline)
- API client at `src/lib/api.ts` using axios, reads `VITE_API_BASE_URL`
- Custom UI components in `src/components/ui/`
  - `CustomToast.tsx` — custom toast (renamed from Toast.tsx to avoid case clash with radix toast.tsx)
  - `CustomBreadcrumb.tsx` — custom breadcrumb (radix version at radix-breadcrumb.tsx)
- WorkflowBuilder uses `@xyflow/react` (reactflow v12 successor)

## Key Commands

- `pnpm --filter @workspace/grc-frontend run dev` — run frontend locally
- `pnpm --filter @workspace/grc-frontend exec tsc --noEmit` — typecheck frontend

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## GRC Workflow Catalog

The GRC platform ships with a curated workflow library seeded by `scripts/seed_workflows.py`. As of the v6 catalog seed (2026-05-06):

- **96 hand-curated workflows** (Compliance 28 / Risk 35 / VulnMgmt 14 / Governance 19) in tenant 1, all created **one-by-one** with description + post-insert strict validation.
- Per-workflow gate (in `_verify_one`): graph validates against `validate_graph()`, persisted `trigger_event` matches canvas-derived value, every non-start/non-terminal node has incoming+outgoing edges (no disconnects), first-after-Start `action_name` starts with `platform_action.` (i.e. is a ⚡ Platform Function), AND **palette fidelity** — every node's `node_type` is in `{start,end,action,condition,approval,timer,subworkflow}` and its key (`action_name` / `condition_kind` / `approval_type` / `timer_kind`) exists in the live `/workflow-engine/catalog/node-types` response.
- Seeder aborts on first failure — no silent batch errors. To re-run: `python3 scripts/seed_workflows.py`.

**Palette-faithful node helpers** (`scripts/seed_workflows.py`): the canonical drop-handler shape from `page.tsx::onDropCanvas` is mirrored 1:1.
- Notifications use real palette `actions`: `send_notification_email` and `send_in_app_alert`. There is **no** `notification.*` node_type — `make_notify("combined", …)` expands into TWO chained action nodes (email → in-app).
- `condition()` → `node_type:"condition"`, `config:{condition_kind, condition:{path,operator,value}}`
- `approval()` → `node_type:"approval"`, `config:{approval_type:"single", approver_user_ids, required_approvals, timeout_seconds, on_timeout}`
- `wait_node()` → `node_type:"timer"`, `config:{timer_kind:"wait_duration", wait_seconds}`

### Canvas rendering

- Workflow canvas uses **vertical top-down layout** computed by `layoutVertical()` in `artifacts/grc-frontend/src/app/(dashboard)/workflow-engine/page.tsx`. BFS depth from Start; siblings spread horizontally. Always overrides stored x/y so seeded graphs render vertically regardless of database positions.
- Condition node's True/False source handles both at `Position.Bottom` with `left: '30%'` / `left: '70%'` styles (`CustomNodes.tsx`). Hidden fallback `out` handle moved to `Position.Top` with `display: none` so it doesn't interfere with bottom-edge routing.
- `snapToGrid` removed; `nodeOrigin={[0.5, 0]}` enabled so node positions are top-center anchored — eliminates click-jitter.

### Earlier (v5) catalog notes — superseded

- **338 freshly-seeded workflow definitions** in `grc_workflow_definitions` (workflow tables truncated and reseeded from a clean slate) — all verified valid post-flight (persisted `trigger_event` strict-compared against the canvas-derived value).
- **0 templates** in `grc_workflow_engine_templates` — templates intentionally out of scope.
- v5 catalog composition:
  - **323 Pattern-B "platform-function" recipes** — one per ⚡-eligible node in the canvas's **Platform Functions (429)** palette module (i.e. every node whose `action_name` resolves through `inferTriggerEventFromActionName` — typically verbs `create / update / delete / trigger / upload / approve / reject / export`). Naming convention: `<Label> [<Module> · <Submodule>]: Notify`.
  - **15 named multi-step variants** — severity routing, approval gates, SLA waits on top resources, all also Pattern-B (system action node first-after-Start).
  - **0 Pattern-A recipes** — the dedicated "Triggers" palette module (`manual_trigger`, `schedule_recurring`, `webhook`, `evidence_uploaded`, `kri_breach`, `risk_score_exceeds_threshold`, etc.) is **intentionally not seeded** per the user's spec. Only Platform Function nodes carry the green ⚡ badge in this catalog.

### How to keep the catalog valid (anti-drift contract)

`scripts/workflow_validator.py` is a 1:1 Python mirror of the frontend canvas validator at `artifacts/grc-frontend/src/app/(dashboard)/workflow-engine/components/types.ts:666-971` (`PATH_TO_RESOURCE_FRONTEND`, `PRIMARY_TRIGGER_FRONTEND`, `inferTriggerEventFromActionName`, `getTriggerEventForFirstNode`, `validateWorkflowGraph`). **Do not edit this file unless `types.ts` changes too** — its docstring spells out the rule. The seeder generates its recipe list by walking `reachable_trigger_keys()` from this module, so:

- It is impossible to seed a recipe with an action_name modulePath the frontend doesn't recognise.
- Pre-flight runs every recipe through `validate_graph()` and aborts the run if any fail (zero HTTP calls happen until pre-flight is clean).
- Post-flight re-fetches every newly-created definition from the API and re-validates it end-to-end.

### Re-running the seeder

```bash
python3 scripts/seed_workflows.py   # idempotent — skips by name; pre-flight + post-flight gated
```

There is no separate "fix script" anymore — the backend re-derives `trigger_event` from the graph on the definitions endpoint, and the v3 seeder produces correct rows the first time.

### Adding new workflows

Edit `build_catalog()` in `scripts/seed_workflows.py`. Use the existing helpers (`crud_notify_recipe`, `crud_severity_recipe`, `crud_approval_recipe`, `crud_with_wait_recipe`, `dedicated_trigger_notify_recipe`) which all produce graphs whose first-node-after-Start passes the validator. Re-run the seeder; pre-flight will catch any drift and abort before posting.
