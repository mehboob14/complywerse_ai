# Compliverse — Integration Guide for Main GRC Merge

> **Audience:** the engineer integrating Hassan's CIS / Agents / Risk Posture / Plugin Automation work into the main GRC branch. Assumes the main GRC is on the same baseline (FastAPI backend + Vite/React frontend + Postgres 18).

This document is the complete delta of what was added or changed. Apply in the listed order — every step is independent enough to commit on its own, so you can pause and review between phases.

---

## 1. High-level summary

Hassan's branch adds five product modules and one cross-cutting feature on top of the shared baseline:

| Module                | Surface area                                               |
|-----------------------|------------------------------------------------------------|
| **CIS Agents**        | Backend agent enroll/heartbeat/jobs API + on-device Python agent + Windows / Linux packaging + GPO templates |
| **Plugin Automation** | CIS plugin library + 5 runners (Windows / Linux / Cisco / Oracle / AWS) + PDF ingestion pipeline |
| **Risk Posture**      | Per-asset composite score + per-tenant tunable weights      |
| **Bulk Discovery**    | CIDR network scan + bulk-import as assets with creds        |
| **Setup Wizard**      | Single 5-step guided agent-enrollment UX                    |
| **Connect Wizard**    | Agentless onboarding for direct cloud → target connectivity |

All work is additive: no existing route changes its contract, no existing table changes its semantics. Six new modules, six new tables, ~25 new endpoints, ~12 new frontend pages.

---

## 2. New files (purely additive — copy/paste into main GRC)

### Backend Python — `.migration-backup/backend/`

#### Agent module (`grc/modules/agents/`)
| File          | Purpose                                                                 |
|---------------|--------------------------------------------------------------------------|
| `__init__.py` | Exports `agents_router` and `agent_downloads_router`                   |
| `router.py`   | All agent endpoints: enroll, heartbeat, fetch-creds, fetch-jobs, results, revoke, bulk-enroll |
| `security.py` | One-time + long-lived token generation, SHA-256 hashing, lookup helpers |
| `downloads.py`| Public download endpoints: `/agent/install.exe`, `/install.deb`, `/install.ps1?token=`, `/install.sh?token=`, `/deploy-gpo.ps1` |

#### Risk Posture module (`grc/modules/risk_posture/`)
| File          | Purpose                                                              |
|---------------|----------------------------------------------------------------------|
| `__init__.py` | Exports `risk_posture_router`                                         |
| `router.py`   | `/risk-posture/dashboard`, `/asset/{id}`, `GET/PUT /weights`         |
| `service.py`  | Composite score formula, dimension renormalization, `resolve_weights_for_tenant()` |

#### Onboarding / Bulk Discovery (`grc/modules/onboarding/`)
| File          | Purpose                                                              |
|---------------|----------------------------------------------------------------------|
| `__init__.py` | Exports `onboarding_router`                                           |
| `router.py`   | `POST /onboarding/discover`, `POST /onboarding/import`                |
| `service.py`  | CIDR probe with `ThreadPoolExecutor`, reverse DNS, port mapping per runner |

#### Connect Wizard (`grc/routers/connect_wizard_router.py`)
Single-file router for the agentless first-connection flow. Wires Windows / Linux / Cisco / Oracle / AWS one-liner generators.

#### Compliance Plugins additions (`grc/modules/compliance_plugins/`)
Existing module — these are NEW files we added inside it:
- `runners/oracle_runner.py` — Oracle SQL*Net runner via cx_Oracle / oracledb
- `runners/winrm_runner.py` — Windows WinRM runner via pywinrm
- `services/preflight.py` — pre-scan port + auth check
- `services/credentials.py` — unified credential resolver across runner types

#### Bank-side agent — `backend/agent/complyverse_agent/`
The Python package the bank installs locally. NEW directory:
| File              | Purpose                                                    |
|-------------------|------------------------------------------------------------|
| `__init__.py`     | Version 1.0.0                                              |
| `__main__.py`     | CLI entrypoint (`enroll`, `run`, `cred set`, `status`, `revoke`) |
| `config.py`       | Per-OS state dirs                                          |
| `vault.py`        | DPAPI (Windows) / Fernet (Linux) encrypted vault           |
| `transport.py`    | stdlib `urllib` HTTP client (no pinned deps in agent)      |
| `enroll.py`       | One-time token → API token swap                            |
| `jobs.py`         | `tick()` heartbeat loop + fetch-creds + fetch-jobs + push-results |
| `collector_ssh.py`| paramiko SSH executor (Cisco / Linux)                      |
| `local_windows.py`| `secedit`, registry, `user_rights_check` evaluators        |
| `tray_ui.py`      | Tkinter UI for `Scenario A` (local cred entry)             |

#### Agent packaging — `backend/agent/packaging/`
| Path                                | Purpose                                                |
|-------------------------------------|---------------------------------------------------------|
| `windows/install.nsi`               | NSIS source for `ComplyverseAgent-Setup-1.0.0.exe`     |
| `windows/install_demo.nsi`          | Demo / dev variant                                      |
| `windows/build.ps1`                 | Build helper                                            |
| `linux/debian/control`              | dpkg control file                                       |
| `linux/debian/postinst`             | post-install script (systemd setup)                     |
| `linux/debian/prerm`                | pre-remove script                                       |
| `linux/rpm/complyverse-agent.spec`  | RPM spec                                                |
| `linux/complyverse-agent.service`   | systemd unit                                            |
| `deploy_templates/gpo/Deploy-ComplyverseAgent.ps1` | AD GPO mass deploy script              |
| `deploy_templates/ansible/install_complyverse_agent.yml` | Ansible playbook                  |

### Frontend TypeScript — `artifacts/grc-frontend/src/`

| File                                                       | Purpose                                       |
|------------------------------------------------------------|------------------------------------------------|
| `app/(dashboard)/admin/agents/_setup-wizard.tsx`           | The 5-step Setup Wizard component             |
| `app/(dashboard)/admin/discover/page.tsx`                  | Bulk Host Discovery page                       |
| `app/(dashboard)/risk-posture/page.tsx`                    | Risk Posture dashboard                         |
| `app/(dashboard)/risk-posture/_weights-panel.tsx`          | Tune Weights modal                             |
| `app/(dashboard)/risk-posture/asset/[id]/page.tsx`         | Per-asset score detail                         |
| `app/(dashboard)/compliance-plugins/_assets-panel.tsx`     | Assets tab in Plugin Automation               |
| `app/(dashboard)/compliance-plugins/_scan-progress-modal.tsx`| Live scan progress modal                     |
| `app/(dashboard)/compliance-plugins/asset/[id]/page.tsx`   | Per-asset plugin run history                  |
| `pages/ConnectWizard.tsx`                                  | Agentless onboarding entrypoint                |
| `components/common/EmptyState.tsx`                         | Shared empty-state component (used widely)     |

### Docs / scripts

| File                                          | Purpose                                                 |
|-----------------------------------------------|---------------------------------------------------------|
| `docs/BANK_AGENTLESS_SETUP_GUIDE.md`          | Customer-facing setup guide                              |
| `screenshots/walkthrough/system-tour.md`      | Full system tour with code references                   |
| `screenshots/walkthrough/collector-vs-endpoint.md`| Mode disambiguation guide                            |
| `screenshots/walkthrough/enrollments-sample.csv` | Sample bulk-enroll CSV                                |
| `scripts/audit_workflow_health.py`            | Workflow audit helper                                   |
| `scripts/test_all_workflows.py`               | Workflow test harness                                   |

---

## 3. Modified files (existing-file edits — apply diffs carefully)

These existing files were touched to wire up the new modules. Each change is minimal and isolated to the listed concern:

### `.migration-backup/backend/grc/main.py`
- Imports: add `agents_router`, `agent_downloads_router`, `risk_posture_router`, `onboarding_router`, `connect_wizard_router`
- Mount: `app.include_router(...)` for each of the above
- Audit-log middleware now also captures `4xx/5xx` JSON response bodies for the AI-summary feature (response-body iterator re-attached after read)

### `.migration-backup/backend/grc/models.py`
- New ORM classes (declared in this file — search for them):
  - `ITAsset`
  - `IntegrationConnection`
  - `ComplianceAgent`
  - `CompliancePlugin`
  - `CompliancePluginRun`
  - `TenantRiskWeights`
- Imports added: `Numeric` (from `sqlalchemy`)

### `.migration-backup/backend/grc/routers/auth_router.py`
- Critical fix at the fallback path (~line 880-895): `is_admin` was incorrectly hardcoded `True` for users without tenant context — changed to `False, [], []` (empty perms + modules) to stop UI leaking admin-only buttons.
- Added 3 new tenant permissions: `compliance:scan:execute`, `compliance:agents:manage`, `compliance:discover:execute`
- Added preset role: `Scanning Admin` (mapped to the 3 permissions)

### `.migration-backup/backend/grc/audit_logger.py`
- Captures `request_payload` for non-GET methods (with size cap)
- Captures error body on `4xx/5xx` JSON responses

### `.migration-backup/backend/grc/modules/compliance_plugins/router.py`
- Wires up the new runners (oracle_sql, netdev_ssh aliases) into the plugin dispatcher
- Adds bulk-approve route

### `.migration-backup/backend/grc/modules/compliance_plugins/runners/registry.py`
- Registers: `@register('aws_readonly')`, `@register('linux_ssh')`, `@register('netdev_ssh')` (alias on `ssh_runner`), `@register('oracle_sql')`, `@register('windows_winrm')`

### `.migration-backup/backend/grc/modules/compliance_plugins/runners/ssh_runner.py`
- Decorator stack: `@register('linux_ssh') @register('netdev_ssh')` so Cisco and Linux share the paramiko logic
- Allowlist of safe SSH commands for `netdev_ssh`

### `.migration-backup/backend/grc/modules/compliance_plugins/services/credentials.py`
- Unified resolver: `if integration_type in ("linux_ssh", "netdev_ssh"): ...`
- Adds oracle_sql credential shape
- Removed `vmware_vcenter` (not in scope)

### `.migration-backup/backend/grc/modules/compliance_plugins/services/run_service.py`
- Per-asset run filtering, last-24h dedup, evidence hash computation
- Cascade to Risk Posture on success

### `.migration-backup/backend/grc/modules/compliance_plugins/pdf_ingest/*.py`
- Parser robustness improvements (classify.py, extract_pages.py, gen_check.py, parse_fields.py, parse_rules.py, pipeline.py)
- These are background-quality improvements, not new features

### Frontend
- `artifacts/grc-frontend/src/lib/api.ts`: new helpers under `agentsApi`, `riskPostureApi`, `onboardingApi`
- `artifacts/grc-frontend/src/components/layout/Sidebar.tsx`: new menu entries (Agents, Bulk Discovery, Risk Posture, Plugin Automation)
- `artifacts/grc-frontend/src/App.tsx`: new route registrations
- `artifacts/grc-frontend/src/app/(dashboard)/dashboard/page.tsx`: KPI cards for the new modules
- `artifacts/grc-frontend/src/app/(dashboard)/admin/agents/page.tsx`: replaced legacy "+ Install" modal with Setup Wizard import
- `artifacts/grc-frontend/src/app/(dashboard)/compliance-plugins/page.tsx`: tab structure (Library / Assets / Recent Runs)
- `artifacts/grc-frontend/src/app/(dashboard)/integrations/connections/page.tsx`: respect new runner types
- `artifacts/grc-frontend/vite.config.ts`: `/grc` proxy added alongside `/api` so frontend can fetch agent installers from cloud directly
- `artifacts/api-server/src/routes/proxy.ts`: passes through `/agent/*` paths

### Express proxy
No new files, but `proxy.ts` is the file you'd need to ensure passes `Authorization: Bearer agt_*` through unchanged for agent endpoints.

---

## 4. Database changes

Six new tables, all in the `public` schema. Existing tenant schemas are untouched.

| Table                              | Purpose                                                      |
|------------------------------------|--------------------------------------------------------------|
| `grc_it_assets`                    | Scan targets — Cisco router, Linux server, etc.              |
| `grc_integration_connections`      | Credentials per target, Fernet-encrypted, runner-type tagged |
| `grc_compliance_agents`            | Agent records (mode, hostname, status, tokens hashed)        |
| `grc_compliance_plugins`           | CIS plugin library (rule + check_definition + framework links) |
| `grc_compliance_plugin_runs`       | Immutable run history — pass/fail per (plugin, asset)        |
| `grc_tenant_risk_weights`          | Per-tenant risk-score weight overrides (CHECK sum=100% ±1)   |

Plus seed data:
- 5,300+ CIS plugins across 5 runner types (`grc_compliance_plugins`)
- Banking-default risk weights preset (insert on tenant creation)

**Migration approach:** either Alembic auto-generate, or just `create_all()` against the new model classes. There are no destructive migrations.

---

## 5. New API endpoints (under `/grc` prefix)

### Agent lifecycle
- `POST /agents` — create single agent (one-time token returned)
- `POST /agents/bulk-enroll` — create N agents at once
- `GET /agents` — list agents in tenant
- `POST /agents/{id}/revoke` — revoke agent (admin only)
- `POST /agents/enroll` — agent calls this with one-time token to get long-lived api_token
- `POST /agents/heartbeat` — periodic heartbeat (bearer auth)
- `GET /agents/jobs` — agent fetches eligible CIS plugins
- `GET /agents/fetch-creds` — collector agents fetch encrypted creds
- `POST /agents/results` — agent pushes scan results

### Agent downloads (public, mounted at `/agent` not `/grc/agents`)
- `GET /agent/install.exe` — Windows installer binary
- `GET /agent/install.deb` — Linux .deb package
- `GET /agent/install.ps1?token=enroll_xxx` — PowerShell wrapper
- `GET /agent/install.sh?token=enroll_xxx` — Bash wrapper
- `GET /agent/deploy-gpo.ps1` — GPO mass-deploy script with backend URL pre-patched

### Risk Posture
- `GET /risk-posture/dashboard` — all assets with composite scores
- `GET /risk-posture/asset/{id}` — single asset detailed breakdown
- `GET /risk-posture/weights` — current weights + presets
- `PUT /risk-posture/weights` — update weights (validates sum=100% ±0.5)

### Onboarding (Bulk Discovery)
- `POST /onboarding/discover` — CIDR + runner_type → reachable host list
- `POST /onboarding/import` — convert reachable hosts into assets + connections

### Connect Wizard
- Endpoints under `/connect-wizard/` for the agentless flow (Windows / Linux / AWS / etc.)

---

## 6. New frontend routes

| Route                                      | Page                                       |
|--------------------------------------------|---------------------------------------------|
| `/admin/agents`                            | Compliance Agents list + Setup Wizard       |
| `/admin/discover`                          | Bulk Host Discovery                         |
| `/admin/integrations/connect`              | Connect Wizard (first-time onboarding)      |
| `/risk-posture`                            | Risk Posture dashboard                      |
| `/risk-posture/asset/[id]`                 | Per-asset risk detail                       |
| `/compliance/plugins`                      | Plugin Automation library                   |
| `/compliance/plugins/[id]`                 | Single plugin detail + scan history         |
| `/compliance/plugins/asset/[id]`           | Per-asset plugin runs                       |
| `/compliance/plugins/ingest`               | Upload CIS Benchmark PDF                    |

Sidebar entries (`Sidebar.tsx`) need: **Agents**, **Bulk Discovery**, **Risk Posture**, **Plugin Automation** under existing Compliance / Risk groupings.

---

## 7. Dependencies added

### Python (`.migration-backup/backend/requirements.txt`)
```
paramiko>=3.4        # SSH for Cisco / Linux
cryptography>=42     # Fernet for cred vault
pywinrm>=0.4         # Windows WinRM runner
boto3>=1.34          # AWS readonly runner
oracledb>=2.0        # Oracle SQL runner (use instead of cx_Oracle)
bcrypt>=4.1
PyJWT>=2.8
```

### Node / pnpm (frontend has no new top-level deps — reuses React Query + Wouter)

### Agent (independent, in `backend/agent/`)
```
paramiko>=3.4
cryptography>=42
pywin32 (Windows only)
```

---

## 8. Environment variables

Add to `.env`:

```
# Used by agent install commands when generating download URLs.
# Defaults to whatever Host header the request arrives on, so this is
# only needed when behind a load balancer / proxy that doesn't set
# X-Forwarded-Host.
COMPLYVERSE_BACKEND_URL=https://your-tenant.compliverse.app

# Override path to pre-built agent binaries (defaults to repo-relative).
COMPLYVERSE_AGENT_EXE_PATH=/abs/path/to/ComplyverseAgent-Setup-1.0.0.exe
COMPLYVERSE_AGENT_DEB_PATH=/abs/path/to/complyverse-agent_1.0.0_all.deb
COMPLYVERSE_AGENT_GPO_PATH=/abs/path/to/Deploy-ComplyverseAgent.ps1
```

`SESSION_SECRET` is already set in the baseline — the Fernet vault for `IntegrationConnection.password` uses it as the master key. **Do not rotate it** without re-encrypting every existing connection row.

---

## 9. Step-by-step integration order

Each step is a self-contained commit. Stop and run tests between steps.

### Phase 1 — Schema
1. Copy `grc/models.py` ORM additions (6 new classes). Generate Alembic migration or run `create_all()`. Verify 6 new tables in `public` schema.
2. Add the 3 new RBAC permissions and `Scanning Admin` preset role in `grc/routers/auth_router.py`.

### Phase 2 — Backend modules (additive routers)
3. Drop in `grc/modules/agents/`. Register in `grc/main.py`:
   ```python
   from .modules.agents import agent_downloads_router, agents_router
   app.include_router(agents_router)
   app.include_router(agent_downloads_router)
   ```
4. Drop in `grc/modules/risk_posture/`. Register `risk_posture_router`.
5. Drop in `grc/modules/onboarding/`. Register `onboarding_router`.
6. Drop in `grc/routers/connect_wizard_router.py`. Register.
7. Add new runners in `grc/modules/compliance_plugins/runners/`. Update `registry.py` decorators.
8. Apply `services/credentials.py` resolver changes (runner_type alias handling).

### Phase 3 — Agent codebase
9. Copy `backend/agent/complyverse_agent/` package as-is.
10. Copy `backend/agent/packaging/` as-is.
11. Build the .exe (run `packaging/windows/build.ps1`) and .deb (`packaging/linux/build.sh`). Or copy the pre-built binaries from the bundle.

### Phase 4 — Frontend
12. Copy `src/components/common/EmptyState.tsx` (shared component, referenced by many pages).
13. Copy `src/lib/api.ts` additions (`agentsApi`, `riskPostureApi`, `onboardingApi`). These are pure additions — no existing exports change.
14. Copy `src/app/(dashboard)/admin/agents/_setup-wizard.tsx` and updated `page.tsx`.
15. Copy `src/app/(dashboard)/admin/discover/page.tsx`.
16. Copy `src/app/(dashboard)/risk-posture/` directory.
17. Copy `src/app/(dashboard)/compliance-plugins/` additions.
18. Update `src/components/layout/Sidebar.tsx` to add the new menu entries.
19. Update `src/App.tsx` route registrations.
20. Update `vite.config.ts` to add the `/grc` proxy block (lets frontend hit `/grc/agent/deploy-gpo.ps1` directly without bouncing through Express).

### Phase 5 — Configuration
21. Update `.env.example` with the four `COMPLYVERSE_*` variables.
22. Update Express proxy `proxy.ts` if `/agent/*` paths need passthrough.

### Phase 6 — Seed data
23. Run the CIS plugin seeder (`grc/modules/compliance_plugins/seed.py`) or restore from the provided DB dump — pick one.

---

## 10. Verification checklist (post-integration)

Tick these off in order. Each one is a smoke check that the previous phase didn't break anything:

- [ ] **Schema:** `\dt grc_*` in psql shows the 6 new tables.
- [ ] **Backend boots:** `uvicorn main:app --port 5000` starts cleanly. No import errors.
- [ ] **API discoverable:** `GET /grc/openapi.json` lists all new endpoints (count should jump by ~25).
- [ ] **Auth still works:** existing login flow unchanged.
- [ ] **RBAC:** new permissions visible in `/auth/me` for users with `Scanning Admin` role.
- [ ] **Agent enroll:** create a single agent via `POST /grc/agents`, then `POST /grc/agents/enroll` with the returned token. `api_token` returned.
- [ ] **Heartbeat:** `POST /grc/agents/heartbeat` with `Authorization: Bearer <api_token>` returns 200.
- [ ] **Bulk Enroll:** `POST /grc/agents/bulk-enroll` with 3 hostnames returns 3 tokens.
- [ ] **Risk Posture:** `GET /grc/risk-posture/dashboard` returns assets list (empty for fresh tenant). `GET /grc/risk-posture/weights` returns the Banking default preset.
- [ ] **Discovery:** `POST /grc/onboarding/discover` with `127.0.0.0/30` + `linux_ssh` runs and returns a probe summary.
- [ ] **Frontend boots:** `pnpm --filter @workspace/grc-frontend run dev` serves on port 20080.
- [ ] **Sidebar:** Agents / Bulk Discovery / Risk Posture / Plugin Automation entries visible.
- [ ] **Setup Wizard:** Open `/admin/agents` → click Setup Wizard → walk through all 5 steps for both `Endpoint` and `Collector`.
- [ ] **Send to Bulk Enroll:** In `/admin/discover`, after a probe, the cross-page handoff opens the Setup Wizard on Step 4 with hostnames pre-filled.
- [ ] **Risk Posture UI:** Tune Weights modal opens, sum total updates live, save persists to `grc_tenant_risk_weights`.
- [ ] **Plugin Library:** `/compliance/plugins` shows ~5,300 plugins post-seed, filterable by severity + runner type.
- [ ] **Tenant isolation:** log in as a user from a different tenant — they cannot see Hassan's agents / assets / scores.
- [ ] **Token security:** check `grc_compliance_agents.enrollment_token_hash` and `api_token_hash` — both should be 64-char hex (SHA-256).
- [ ] **Cred encryption:** `grc_integration_connections.password` should start with `enc:v1:gAAAAA...` (versioned Fernet envelope).
- [ ] **Audit log:** every action against the new endpoints writes a row in `grc_audit_logs`.

---

## 11. Known issues (open before integration)

These are open in Hassan's branch; flag them so they get fixed during integration rather than rediscovered later:

1. **`POST /grc/agents/bulk-enroll` returns HTTP 500 on duplicate hostnames** instead of a clean 409 with a per-hostname conflict map. Wrap the `db.commit()` in `try/except IntegrityError`.
2. **`request_path` audit column** mentioned in old docs doesn't exist — the audit log is action-keyed (`action`, `resource_type`, `resource_id`). Any code that queries by URL path needs to be updated.
3. **PDF ingest pipeline** for plugins occasionally emits `_audit_excerpt` with raw UTF-8 byte sequences (`â€¢` for `•`). Cosmetic only.
4. **Self-signed code-signing cert** for the Windows agent — needs an EV cert from DigiCert / Sectigo before any real bank rollout.
5. **No mTLS** between agent and cloud — bearer tokens only. Acceptable for v1, plan for v2.
6. **No SBOM file** in the agent build — add Syft / Snyk to CI before any external customer ships.

---

## 12. Open questions / decisions for the integrating engineer

These are points where Hassan made a choice that may or may not match the main GRC's convention:

1. **Audit log table strategy.** The agent module writes to `grc_audit_logs` (shared) but plugin runs write to `grc_compliance_plugin_runs` (dedicated). If main GRC has its own audit conventions, decide whether the new endpoints should write through the existing logger or keep their dedicated table.
2. **Permission naming.** New perms use the `compliance:` namespace (`compliance:scan:execute`, etc.). If main GRC uses a different convention (e.g. dotted vs colon-separated), normalize.
3. **Per-tenant schema vs public.** All 6 new tables are in `public` schema with a `tenant_id` column. Existing tenant-isolated tables live under `tenant_<slug>` schemas. Keep new tables in `public` (simpler) or move to per-tenant schemas (consistent with the rest)?
4. **Frontend routing.** Hassan uses `wouter` via `@/lib/navigation`. If main GRC migrated to Next.js's App Router by now, the imports need swapping (`from '@/lib/navigation'` → `from 'next/navigation'`).
5. **`_setup-wizard.tsx` as a leaf component** under `app/(dashboard)/admin/agents/`. If main GRC's routing convention treats files starting with `_` as ignored route segments (Next.js convention), this works as-is. Otherwise, move to `src/components/agents/SetupWizard.tsx`.

---

## 13. Contact

For anything that doesn't make sense, ping Hassan ([@hasanshahidd](https://github.com/hasanshahidd)). The complete code lives at:

- **GitHub (public, code only):** https://github.com/hasanshahidd/GRC-CIS
- **Internal bundle (with .env + DB dump):** `compliverse-internal-bundle.zip` on Drive — ask for the share link.

End of integration guide.
