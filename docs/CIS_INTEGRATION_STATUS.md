# CIS_Updated_integration — Merge Status

Snapshot of what was integrated from
`CIS_Updated_integration/CIS_Version_1/` into the main GRC codebase and
what still needs doing. Follow this file when resuming the merge in a
later session.

## Baseline before merge
- Routes: **1596**
- Tables: **268**
- tsc errors: **84**

## After backend session (Phases 1-6)
- Routes: **1622** (+26)
- Tables: **269** (+1: `grc_benchmark_os_mappings`)
- ORM mappers: resolve cleanly via `configure_mappers()`
- compileall: exit 0
- tsc errors: **84** (unchanged — frontend not yet touched)

## After frontend session 1 (admin/agents + lib/api.ts partial)
- Routes: 1622 (no backend change)
- Tables: 269 (no backend change)
- tsc errors: **84** (baseline held)
- New frontend surface: `/admin/agents` now ships the **Endpoint
  agent packages** (3-card Win/Linux/macOS download grid), **Collector
  agent** card with when-to-use guidance, and **Agentless Targets** CTA
  pointing to the Connect Wizard. Powered by the new `InstallerButtons`
  component (mints a 72h fleet token, streams the .cmd/.sh/.command
  binary from the Phase 3 backend endpoints).
- `lib/api.ts` now exports `agentsCisApi`, `connectWizardApi`, plus 18
  new wrapper methods on `compliancePluginsApi`.

## After runtime-debug session (live walkthrough fixes)

Operator walked through the full CIS flow (Plugin Library → Connect
Wizard → Scan-all) and we fixed every blocker that surfaced. Backend
routes still 1622, tables now 269 (BenchmarkOsMapping table). State of
the previously-broken bits:

### ✅ Plugin Library
- 501 pending-review plugins bulk-approved across all 12 tenant DBs
  (Windows Server 2012 v2.0.0 was the biggest hidden block at 281 rules
  per tenant). Library now shows the full 5,385 rules.
- `Total Rules` KPI fixed in `compliance-plugins/page.tsx` — was reading
  `plugins.length` (capped at 500 by the backend); now reads
  `pluginsQ.data?.total` (the unbounded count).
- Benchmark filter now bumps the API `limit` to 5000 when active, so a
  filter like "Windows 11 Enterprise" (548 rules) returns ALL rules
  instead of truncating to the first 500 alphabetically.

### ✅ Per-user summary endpoint
- Added missing `is_leaked` column to `CompliancePluginRun` (+ idempotent
  migration). Was crashing with `AttributeError` because the merged router
  filters on it; column got applied to all 12 tenant DBs.
- Removed dead `grc.tenant_models` import in `per_user_summary` —
  package was authored for a schema-per-tenant Postgres layout we
  don't use; the injected `db` session is already tenant-scoped.

### ✅ Connect Wizard handshake
- JWT TTL bumped from 15 min → 60 min so the operator has headroom to
  configure WinRM on the target during first onboarding.
- Added `logger = logging.getLogger(__name__)` plus a debug-log shim
  around the handshake's 400 responses so the preflight `code` /
  `stage` / `checks_run` payload is visible in the server console (no
  DevTools needed).
- `connect_wizard_router.py` was lazy-importing two services that
  weren't shipped in the CIS package — both stubbed below.

### ✅ Scan-all
- Parallel worker session was bound to `grc.models.SessionLocal` —
  that's the **master** catalog DB, which doesn't have
  `grc_compliance_plugin_runs`. Workers now use
  `sessionmaker(bind=db.get_bind())` so each thread runs against the
  same tenant DB the request was opened on.
- Tenant-engine connection pool bumped from default (5+10=15) to
  20+20=40 in `db.py:get_tenant_engine`. Under the 10-worker default
  concurrency, the previous pool was saturated within seconds and every
  request (including frontend polls) timed out with
  `QueuePool limit reached`. `pool_timeout` cut from 30s → 10s so any
  future exhaustion fails fast.

### ✅ Strict matcher (real implementation, not a stub)
- New module `compliance_plugins/services/strict_matcher.py` with the
  full longest-pattern-wins logic the router expects:
  `pick_benchmark_for_os(db, tenant_id, os_normalized)` and
  `applicable_plugins_for_asset(db, tenant_id, os_normalized)`.
- Per-tenant DB architecture means seed plugin rows carry
  `tenant_id=NULL` (system-wide); the matcher filters
  `tenant_id == tenant_id OR tenant_id IS NULL` so the 5,385 seeded
  rules actually resolve. Without this, every match returned 0 plugins.

### ✅ BenchmarkOsMapping seed
- Auto-created `grc_benchmark_os_mappings` table on 10 tenant DBs that
  hadn't been touched by the app post-merge.
- Seeded 17 mapping rows per tenant: 15 specific patterns (`windows-11`,
  `windows-server-2012`, `ubuntu-22.04`, `cisco-ios-xe-17`, …) at
  priority 50, plus 2 family fallbacks (`windows` → Win 11 Enterprise,
  `linux` → Ubuntu 22.04 LTS) at priority 200. Longest-pattern-wins
  means specific entries beat fallbacks automatically.

### ✅ `os_detector` stub upgrade
- Original stub returned `(family, None, None, None, None)` — left
  `os_normalized=NULL` on the just-created asset, which never matched
  any mapping. Upgraded to return `(family, None, family, None, None)`
  so the asset gets `os_normalized='windows'` (or `'linux'`) and the
  family-fallback mapping picks it up. Operators can override with a
  more specific value (e.g. `windows-11`, `windows-server-2019`) via
  the asset edit page.

### ✅ Service / pdf_ingest stubs (prophylactic — would have crashed next)

Six other lazy imports in `compliance_plugins/router.py` would have
crashed the moment specific endpoints were hit. All stubbed now with
sensible defaults so the routes register cleanly and don't 500:

| Module | Function(s) | Stub behaviour |
|---|---|---|
| `services/scope.py` | `resolve_assets`, `preview_scope` | Honours `scope_mode` if the column exists on `IntegrationConnection`, else `tenant_all` (every asset in scope). Forward-compat with the eventual real columns. |
| `services/benchmark_matcher.py` | `benchmark_target_keys`, `BENCHMARK_PATTERNS`, `EXTRA_AI_OS_KEYS` | Empty patterns / empty iterator — callers fall back to the strict-matcher result. |
| `services/ai_benchmark_router.py` | `classify_benchmark_with_ai` | Returns `([], "ai disabled")`. |
| `services/ai_os_normaliser.py` | `normalise_os_string` | Deterministic regex ruleset for common Windows / Linux / Cisco strings (no AI). Good enough that `/normalise-os` works without an OpenAI key. |
| `services/ai_mapping_suggester.py` | `suggest_for_all_unmapped`, `suggest_for_unmapped_os` | Cheats via `pick_benchmark_for_os` (the static mapping table). Returns the same shape the AI version would. |
| `pdf_ingest/benchmark_supersession.py` | `detect_superseded_siblings`, `promote_to_supersede` | Detection is a no-op (pipeline.py's caller is try/except-wrapped). Promote returns a "not implemented" result dict the operator can surface as a clear message. |

### ✅ `credentials_for` alias
- `agents/router.py` (CIS-merged) imports `credentials_for` from
  `services.credentials`, but the package's `credentials.py` only
  exports `resolve_credentials_for_connection`. Added a
  `credentials_for = resolve_credentials_for_connection` alias at the
  end of our `credentials.py` so the collector-agent `/jobs` endpoint
  works without rename churn.

---

## ✅ Completed this session (Phases 1-6, backend only)

### Phase 1 — pure file copies (no runtime change)
- Copied `CIS_Updated_integration/.../backend/agent/**` → `backend/agent/**`
  (21 files; the bank-side endpoint/collector agent shipped as installers
  via `agents/downloads.py`, not imported by the FastAPI app at runtime)
- Copied 3 pytest test files into
  `backend/grc/modules/compliance_plugins/{runners,pdf_ingest}/tests/`
  + one synthesized `__init__.py` (missing from the package)

### Phase 2a — small additive replacements
- `backend/grc/modules/compliance_plugins/runners/aws_runner.py` —
  replaced our 24-line stub with the package's 233-line boto3
  implementation
- `backend/grc/modules/compliance_plugins/pdf_ingest/pipeline.py` —
  added the `detect_superseded_siblings` block (try/except-wrapped so
  the missing `benchmark_supersession` module fails-safe)

### Phase 2b — IntegrationConnection extension
- Added `credentials_extra_json` column to `IntegrationConnection`
  ([`models/_33_…integrations….py`](../backend/grc/models/_33_integrations_module_vulnerability_scanner_integration.py))
- Added idempotent migration entry
  ([`compliance/schema_migrations.py`](../backend/grc/modules/compliance/schema_migrations.py))
- Replaced `services/credentials.py` with the package version that adds
  WinRM port auto-detect + 6 extended-integration cred handlers (MSSQL,
  Postgres, MySQL, LDAP, Azure, K8s)

### Phase 3 — agents/router.py (+8 endpoints; +7 columns)
- New endpoints registered (verified `1596 → 1604`):
  - `GET /agents/installer.cmd` (Windows one-click installer download)
  - `GET /agents/installer.sh` (Linux)
  - `GET /agents/installer.command` (macOS)
  - `GET /agents/installer.{msi,deb,rpm,pkg}` (placeholder responses)
  - `POST /agents/scan-now-push/{asset_id}` (skip the 30s tick)
- New `ComplianceAgent` columns:
  - `kind` (single | template | spawned), `enrollment_max_uses`,
    `enrollment_uses`, `enrollment_expires_at`, `spawned_from_agent_id`,
    `pending_scan_at`, `pending_scan_user_id`
- Stubbed `require_tenant_admin` as alias for the existing
  `compliance:agents:manage` permission gate — same effective behaviour
  (Admins bypass via wildcard); Phase 9 auth merge will swap this for
  the real Administrator-only gate

### Phase 4 — compliance_plugins/router.py (+18 endpoints; +1 model)
- 18 new endpoints registered (verified `1604 → 1622`): benchmark-mappings
  CRUD, library-tree, OS registry, connections scope-preview, classify-
  stream, normalise-os, re-detect-os, promote, scope-preview
- Added new model `BenchmarkOsMapping`
  ([`models/_37_…tenant_artifacts.py`](../backend/grc/models/_37_artifact_catalog_tenant_artifacts.py))
- Stubbed `require_tenant_admin` + `require_platform_admin` to compliance
  permission (same pattern as Phase 3)

### Phase 5 — audit_logger.py (+273 lines)
- Full overwrite — adds richer helper functions (`_extract_sub_action`,
  `_extract_resource_id_from_payload`, `_humanize_action`,
  `_humanize_resource`, `_build_summary`) and a `write_rich_audit_log`
  shim that delegates to `grc.rich_audit`
- Extended our `grc/rich_audit.py` `write_rich_audit_log` signature with
  `before`/`after`/`actor_type`/`actor_workflow_id` (backward-compatible —
  defaulted to None; merged into `snapshot` payload) so the new
  audit_logger shim's expanded passthrough doesn't TypeError

### Phase 6 — connect_wizard_router.py (+382 lines)
- Full overwrite — internal logic enrichment, no new endpoints (the 5
  routes are the same: `/issue-token`, `/status/{nonce}`, `/windows/{token}`,
  `/linux/{token}`, `/handshake`)
- Added 5 new OS-profile columns to `ITAsset`:
  - `os_family`, `os_version`, `os_normalized` (indexed), `os_build`,
    `os_edition`
  - Required by the handshake endpoint when probing creds; columns are
    forward-ready even though the runtime probe (`os_detector` service)
    isn't shipped yet
- Idempotent migration entries appended

---

## ⚠️ Known-broken-at-runtime endpoints

The CIS package ships with lazy imports to modules that **aren't in
the handoff** (the README acknowledges this). The app boots cleanly
(imports are deferred to handler execution), but calling these will
ImportError at runtime:

| Endpoint(s) | Missing module |
|---|---|
| `compliance_plugins/router.py` lines 673, 967 — anything using `strict_matcher` | `compliance_plugins/services/strict_matcher.py` |
| `compliance_plugins/router.py` line 1064-1065 — and `connect_wizard_router.py` handshake — anything that runs OS detection | `compliance_plugins/services/os_detector.py` |
| `runners/registry.py` would-be import | `runners/extended_runners.py` (MSSQL/Postgres/MySQL/LDAP/Azure/K8s runners) — *not imported by us; we removed the dangling line via the pipeline.py fix* |
| `pdf_ingest/pipeline.py` sibling-detect | `pdf_ingest/benchmark_supersession.py` — *try/except wrapped, fails silently* |

To stop the runtime errors, either (a) implement the missing modules,
or (b) wrap the lazy imports in try/except blocks that return clean
501s.

---

## 📋 Remaining work (Phases 7-12)

### Phase 7 — additional models
Skim `CIS_Updated_integration/.../models.py` for any class not yet in
our `models/_NN_*.py` split sections. Known so far we added
`BenchmarkOsMapping`. Likely candidates the package also defines:
- `CisIngestJob` extensions, plugin-mapping tables, scan-history rows.

Use:
```bash
grep -nE '^class [A-Z]' CIS_Updated_integration/CIS_Version_1/files/.migration-backup/backend/grc/models.py \
  | awk -F: '{print $3}' | sort > /tmp/pkg-classes
grep -rnoE '^class [A-Z][A-Za-z0-9_]*' backend/grc/models/_*.py \
  | awk -F: '{print $3}' | sort > /tmp/cur-classes
comm -23 /tmp/pkg-classes /tmp/cur-classes
```

Add each missing class to the best-fit `models/_NN_*.py` section per
ARCHITECTURE.md §5.

### Phase 8 — additional schemas
Same approach against `package/schemas.py` vs. our `schemas/_NN_*.py`
package. Append missing Pydantic classes to the best-fit section.

### Phase 9 — careful 3-way merges (our codebase is ahead)
These files in the package are **smaller** than ours; a blind overwrite
would regress real platform work added on top. Cherry-pick CIS-specific
additions only:

| File | Our lines | Pkg lines | Notes |
|---|---|---|---|
| `routers/auth_router.py` | 776 | **1579** | Pkg adds `require_tenant_admin`, `require_platform_admin`, fleet-token sub-flows, agent-token auth. Highest risk merge — touches core auth. |
| `routers/assets_router.py` | **2573** | 1688 | Pkg adds per-asset CIS scan history endpoint + linked-vulns coverage analysis. Cherry-pick those. |
| `modules/vuln_management/routers/vulnerabilities.py` | **1557** | 536 | Pkg has the older minimal vuln registry; ours has the newer SLA/exception/composite-priority work. Verify pkg has no CIS-specific additions; if not, skip. |
| `seed_frameworks.py` | **2415** | 2298 | Pkg may have 1-2 extra seed entries; diff and cherry-pick. |

### Phase 10 — frontend deltas

#### ✅ Done (frontend session 1)

- **`Sidebar.tsx`** — diff'd against package: the only "new" nav items
  the package would add (`Compliance Overview` → `/compliance-overview`,
  `Compliance Rules` → `/compliance/plugins/library`) point at pages
  that **don't exist in the package's artifacts**. All other shape
  differences are cosmetic (our "Compliance Agents" = pkg's "Agents";
  our "IT Assets" = pkg's "Inventory"; items the pkg shows that we
  commented out were deliberate hides). **No Sidebar change applied.**
- **`admin/agents/page.tsx`** — added the **InstallerButtons** component
  (mints fleet tokens, streams per-OS installer downloads via the
  `/agents/installer.{cmd,sh,command}` endpoints from backend Phase 3)
  plus the **Endpoint agent packages** (3-card Windows/Linux/macOS grid),
  **Collector agent** (2-card grid with when-to-use guidance), and
  **AgentlessTargetsSection** (single CTA pointing operators to the
  Connect Wizard). Preserved our `'use client'` directive, `'force-
  dynamic'` pragma, and `SetupWizard` integration. tsc baseline 84 held.
- **`lib/api.ts`** — appended 18 new wrapper methods on
  `compliancePluginsApi` for the Phase 4 backend endpoints (benchmark-
  mappings CRUD, library-tree navigation, OS registry, match-preview,
  classify-stream, normalise-os, connection scope-preview + persistence,
  asset OS re-detection, benchmark promote). Also added new exports
  `agentsCisApi` (installer download + scan-now-push wrappers) and
  `connectWizardApi` (issue-token, status, windows/linux script, handshake).

#### ⏭️ Deferred (frontend session 2 — needs focused review)

Each of these has changes scattered across reorganized state hooks; a
blind overwrite would regress our codebase. Apply via careful side-by-
side diff:

| File | Our lines | Pkg lines | Notes |
|---|---|---|---|
| `compliance-plugins/page.tsx` | 1769 | **1868** | Pkg adds `import-json` tab, `windows_winrm` runner type label, `table`/`cards` view mode toggle, `runScope: 'all'\|'mine'` filter, refined scan-all progress tracking. Internal feature refinements scattered through a 1800-line file. |
| `dashboard/page.tsx` | 1744 | **1785** | Adds general KRI / control-status helper functions (`deriveCtrlStatus`, `areaAbbr`, `kriStatusKey`, `kriGaugePct`). NOT CIS-specific — general dashboard refinements. |
| `integrations/connections/page.tsx` | 561 | **685** | Adds `TYPE_LABEL` / `TYPE_BADGE` constants (would include labels for the new MSSQL/Postgres/Azure/K8s/Cisco/AD connection types) + `StatusBadge` component + reorganized state hooks. CIS-relevant. |
| `assets/[id]/page.tsx` | **2542** | 2260 | Our codebase is ahead (Criticality Assessments tab + more). Cherry-pick CIS-specific additions only (per-asset CIS scan history, linked-vulns coverage). |
| `compliance-plugins/_assets-panel.tsx` | 417 | **434** | +17 lines |
| `compliance-plugins/asset/[id]/page.tsx` | 530 | **545** | +15 lines |
| `register/page.tsx` | **730** | 701 | Ours ahead; check for CIS-specific bits. |

#### ⏭️ Vite-only files (DO NOT copy)
- `src/App.tsx` — React Router setup; we use Next.js App Router
- `vite.config.ts` — bundler config; we use Next.js build
- `api-server/src/routes/proxy.ts` — Express dev proxy; Next handles via `next.config.js` rewrites
- `_scan-progress-modal.tsx` (pkg version) — package REMOVED `'use client'`; ours needs it
- `EmptyState.tsx` (pkg version) — package swapped `next/link` for `wouter`; ours needs `next/link`

#### ⏭️ Connect Wizard translation (substantial, deferred)
- `src/pages/ConnectWizard.tsx` (Vite/wouter, 1363 lines) — we have a
  Next.js equivalent at `/admin/integrations/connect/page.tsx` (748
  lines, 4 platforms). The package supports **12 platforms** (adds
  Cisco, Oracle, MSSQL, Postgres, MySQL, AD, Azure, K8s) and ships 4
  new helper components (`ConnectedSuccessWithScope`,
  `PreflightDiagnosticBlock`, `AzureForm`, `KubernetesForm`). The bulk
  of the +615 lines is per-platform credential forms with bespoke
  validation + handshake logic.
  - **Recommended approach**: extend the existing
    `/admin/integrations/connect/page.tsx`'s `PLATFORMS` array with the 8
    new platform metadata entries; add the 4 helper components from the
    package one at a time; extend `ManualCredsForm` with per-platform
    field schemas. Don't translate the standalone Vite file verbatim.
  - **Backend ready**: Phase 4 + Phase 2b backend merges (the
    `credentials_extra_json` column + extended-integration handlers in
    `services/credentials.py`) already accept the new platforms' cred
    shapes. The frontend is the missing piece.

### Phase 11 — DB dump restore (operator-driven; do NOT auto-run)
The dump under
`CIS_Updated_integration/CIS_Version_1/files/db-dump/` is a Postgres
snapshot with 5,385 pre-seeded CIS plugins. Per the package README, the
Fernet-encrypted integration credentials in the dump were encrypted
with the original `SESSION_SECRET` and **will be unreadable in this
environment**. Restore is destructive — it overwrites tenant data.

If you need the seeded CIS rules:
1. Reassemble the chunked dump (Bash / WSL):
   ```bash
   cd CIS_Updated_integration/CIS_Version_1/files/db-dump
   cat compliverse.sql.gz.part-* | gunzip > compliverse.sql
   ```
2. Restore against a **fresh DB** (NOT your existing tenant DB):
   ```bash
   createdb -h 127.0.0.1 -p 5432 -U postgres compliverse_cis
   psql   -h 127.0.0.1 -p 5432 -U postgres -d compliverse_cis -f compliverse.sql
   ```
3. Cherry-pick what you want into your live tenants via SQL `INSERT … SELECT`.
4. Alternative: run `compliance_plugins/seed.py` against your existing
   DBs — it's idempotent and seeds the standard plugin set (the
   package's pre-loaded extras aren't included).

### Phase 12 — final verification
After Phase 7-10 land, re-run the smoke harness (`docs/ARCHITECTURE.md`
§13): routes should be > 1622, tables > 269, `configure_mappers()`
clean, `tsc --noEmit` count must stay at **84**.

---

## Decisions made this session (won't change)

1. **Stub aliases for `require_tenant_admin` / `require_platform_admin`** —
   instead of porting the package's auth-tightening (which would need
   the Phase 9 auth merge to land first), we aliased these to existing
   compliance permissions. Net effect: Scanning-Admin keeps access to
   destructive admin operations (revoke agent, promote benchmark) for
   now. Tighten in Phase 9.

2. **Keep `rich_audit.py` as the canonical impl** — `audit_logger.py`'s
   new `write_rich_audit_log` is a shim that delegates to
   `rich_audit.py`. Extended `rich_audit.py` to accept the wider
   signature backward-compatibly.

3. **Forward-ready ITAsset OS columns** — added `os_family / os_version /
   os_normalized / os_build / os_edition` even though the `os_detector`
   service that populates them isn't shipped. Schema is ready when
   someone implements / pastes in the missing service module.

4. **No DB dump restore** — explicitly deferred. See Phase 11.

---

## Files touched this session

### Backend
- New: `backend/agent/**` (21 files)
- New: `backend/grc/modules/compliance_plugins/runners/tests/{__init__.py,test_winrm_runner.py}`
- New: `backend/grc/modules/compliance_plugins/pdf_ingest/tests/{__init__.py,test_parse_and_classify.py,test_pipeline_e2e.py}`
- Overwritten: `backend/grc/modules/compliance_plugins/runners/aws_runner.py`
- Overwritten: `backend/grc/modules/compliance_plugins/pdf_ingest/pipeline.py`
- Overwritten: `backend/grc/modules/compliance_plugins/services/credentials.py`
- Overwritten: `backend/grc/modules/agents/router.py` (+ in-file stub of `require_tenant_admin`)
- Overwritten: `backend/grc/modules/compliance_plugins/router.py` (+ in-file stubs of `require_tenant_admin` & `require_platform_admin`)
- Overwritten: `backend/grc/audit_logger.py`
- Overwritten: `backend/grc/routers/connect_wizard_router.py`
- Modified: `backend/grc/rich_audit.py` (extended signature)
- Modified: `backend/grc/models/_33_integrations_module_vulnerability_scanner_integration.py` (+1 column)
- Modified: `backend/grc/models/_14_it_asset_inventory.py` (+5 columns)
- Modified: `backend/grc/models/_37_artifact_catalog_tenant_artifacts.py` (+7 columns on ComplianceAgent, +1 new model `BenchmarkOsMapping`)
- Modified: `backend/grc/modules/compliance/schema_migrations.py` (idempotent migrations for all new columns)

### Frontend
- Nothing touched this session (Phase 10 deferred).
