# Database changes ledger

A running record of every DB-affecting change Claude has made in dev that
needs to be replayed on the Ubuntu live server. The goal: you can run
the listed SQL / script against the live DB and reach exactly the same
schema + minimum required seed state, **without overwriting any
production data**.

Format for every entry:
- **What** — schema vs data change, the column / table affected
- **Why** — the bug it unblocks, in one sentence
- **How** — exact SQL or script to run, idempotent
- **Risk** — what could break if applied to a tenant that already has
  the change (most should be safe no-ops)
- **Auto-applied?** — yes if `ensure_compliance_columns()` /
  `schema_migrations.py` does it on next request; no if you must run
  manually

The newest entries go at the top. Old entries stay so the doc is a
linear history.

---

## (Pending / current session)

### Going forward

When Claude makes a change in this session that touches the DB, an
entry will land here BEFORE the change ships. If a fix is code-only
(no schema or row mutation), it's still noted under "Code-only" so
you know nothing extra needs to run on Ubuntu.

---

## 2026-07-05 — Controls workbench: standalone per-control ownership (NEW TABLE, auto-applied) + code-only UI

### What

**One new table — `grc_framework_control_ownership`.** Model
`FrameworkControlOwnership` in
[`backend/grc/models/_17_framework_upload_parsing_models.py`](backend/grc/models/_17_framework_upload_parsing_models.py).
One row per parsed framework control (per-tenant DB scopes it):

```sql
-- Auto-created by create_all; shown here for visibility only.
CREATE TABLE grc_framework_control_ownership (
    id                   SERIAL PRIMARY KEY,
    parsed_control_id    INTEGER NOT NULL UNIQUE
                             REFERENCES grc_parsed_framework_controls(id),
    status               VARCHAR(50) DEFAULT 'not_started',
        -- not_started | in_progress | implemented | verified | not_applicable
    assigned_user_ids    JSON DEFAULT '[]',   -- ordered GRCUser ids; first = primary owner
    implementation_date  TIMESTAMP,
    verified_date        TIMESTAMP,
    created_at           TIMESTAMP,
    updated_at           TIMESTAMP
);
```

**No changes to existing tables/columns.** Nothing added to
`schema_migrations._COLUMN_ADDS`.

Everything else in this session is **code-only** (no schema, no row
migration — noted so you know nothing extra runs on Ubuntu):

  * **New endpoint** `PATCH /controls/framework-control/{id}/ownership`
    ([`backend/grc/routers/controls_router.py`](backend/grc/routers/controls_router.py))
    — upserts owner + implementation stage directly on a control (no
    certification journey required); validates control tenant + active users.
  * **Status-summary merge** (same file, `get_framework_controls_status_summary`)
    — now overlays the new ownership rows over journey-derived status and
    returns `assigned_user_ids`. Reads the new table only.
  * **Controls redesign** (frontend): `/controls` workbench now defaults to
    PCI DSS, groups controls Framework→Domain (collapsible) with domain filter +
    sort; `/controls/overview` is a per-framework dashboard (coverage / status /
    evidence / owners) with no control list; owner picker + clickable stage
    pipeline; recommended-evidence popup fixed.
  * **AI recommendations auto-run + persist** (frontend): opening a control
    auto-loads its saved recommendation from the EXISTING per-tenant
    `/ai-recommendations` store, or generates + saves it once — no manual
    button/save. **Uses the existing `grc_ai_recommendations` store table; no
    new table.**
  * **Shared `AnimatedModal` now portals to `<body>`** (fixes nested-modal
    distortion) — every app modal. Governance nav trim, governance Documents
    default route, mappings full-UI + upper-cased control codes, main-dashboard
    legacy tabs hidden — all frontend-only.

### Also arriving in this deploy (from the merged `feat/pdpl-ndmo-assessment` dev branch — auto-applied)

If this server hasn't yet pulled the dev's post-2026-06-22 commits (access
reviews, SLA/SoD, KPI dashboards), they ship in the same `git pull`. Their DB
surface is **all auto-applied on restart** — verified against the pre-merge
base:

  * **7 new tables** (created by `create_all`): `grc_access_review_campaigns`,
    `grc_access_review_items`, `grc_access_review_findings`,
    `grc_access_review_escalations`, `grc_access_review_rule_config`,
    `grc_compliance_sla_policy`, `grc_sod_rules`.
  * **31 new `ADD COLUMN` entries** already registered in
    `schema_migrations._COLUMN_ADDS` (compliance +23, identity +26 lines) — so
    the new columns on existing tables are applied per-tenant by
    `ensure_compliance_columns()` on restart, same path as the 2026-06-22 entry.

Net for the whole deploy: **8 new tables + 31 new columns, 100% auto-applied**
on backend restart. No manual SQL for any of it.

### Why

Operators had no way to assign a control owner or set its implementation
stage from the Controls workbench — those were read-only because status/owner
only existed inside a certification journey (so a framework with no journey
showed every control "Unassigned" with no way to act). The new table stores
ownership standalone, so any control is assignable in place.

### How (on Ubuntu)

```bash
cd ~/grc-final/complywerse_ai && git pull
sudo systemctl restart grc-backend.service      # create_all makes the new table per-tenant
cd grc-frontend && npm run build && pm2 restart grc-frontend
```

The `grc_framework_control_ownership` table is created on the first request
that opens each tenant's engine after the restart — nothing manual. It is
also picked up by the orchestrator if you prefer:
`python -m scripts.apply_all_db_changes_ubuntu` (phase 1 opens each tenant
engine → `create_all` runs).

### Risk

Low. One new table, created only where missing (`create_all` checkfirst — a
no-op where it already exists). No existing table/column/row is touched; the
status-summary overlay is additive (falls back to journey status when no
ownership row exists). The endpoint only writes the new table.

### Auto-applied?

**Yes** — schema (the one table) is created by `create_all` on next tenant
access after the backend restart. No manual SQL, no seed, no backfill.

---

## 2026-06-22 — PDPL/NDMO assessment + Control Library normalization merge (NEW TABLES + columns, auto-applied)

### What

Merge of `feat/pdpl-ndmo-assessment` (control library normalization pipeline,
NDMO native control tree, PDPL/NDMO assessment toolkit). DB surface:

**New tables** — auto-created on existing tenant DBs by
`Base.metadata.create_all(checkfirst=True)` inside `ensure_compliance_columns()`:

  * `grc_normalization_runs` — one grouping/normalization session (owner baseline
    vs. per-user custom runs). Model `NormalizationRun`
    ([`_08_normalized_control_model.py`](backend/grc/models/_08_normalized_control_model.py)).
  * `grc_normalized_control_links` — NormalizedControl ↔ parsed/framework-control
    membership ("comply once → comply everywhere"). Model `NormalizedControlLink`.
  * `grc_compliance_snapshots` — point-in-time journey compliance snapshot
    (year/label/overall_pct/breakdown). Model `ComplianceSnapshot`
    ([`_16_certification_journey_models.py`](backend/grc/models/_16_certification_journey_models.py)).

**New columns on existing tables** — added by `schema_migrations._COLUMN_ADDS`
(idempotent `ALTER TABLE ... ADD COLUMN`):

  * `grc_normalized_controls`: `run_id`, `domain`, `source`, `common_group_id`,
    `recommended_evidence`, **`review_status`**, **`reviewed_by`**,
    **`reviewed_at`**.
  * `grc_common_control_groups`: `run_id`.
  * `grc_parsed_framework_controls`: `priority_level`, `dependencies`,
    `version_history`, `control_description`, `assessment_criteria`.
  * `grc_control_implementations`: `criteria_status`.
  * `grc_compliance_assessment_document_items`: `maturity_score`, `risk_rating`,
    `remediation_status`.

### Why

Control Library normalization (per-domain unified controls, isolated runs,
human review), the NDMO native control tree (priority tiers, dependencies,
version history, assessment criteria), and the PDPL assessment workflow
(maturity score, risk rating, remediation tracking) all read these
columns/tables; without them the corresponding pages 500.

**Gap closed in this session:** the merge added `review_status`,
`reviewed_by`, `reviewed_at` to the `NormalizedControl` model but the branch
only registered 5 of the 8 new `grc_normalized_controls` columns in
`_COLUMN_ADDS`. On an existing tenant DB the Control Library **review** page
would have crashed with `column ... does not exist`. The three missing entries
are now added so the startup self-heal covers them.

### How (Ubuntu)

```
git pull        # ships models + schema_migrations
# restart the backend service — ensure_compliance_columns() runs on startup
sudo systemctl restart <grc-backend-service>
```

Nothing manual: every column above is applied per-tenant by
`ensure_compliance_columns()` on boot, and as a request-time backstop by
`_ensure_for_engine()`. New tables are created the same pass.

Optional data (only if you want NDMO/PDPL seed content populated; **not**
required for schema):

```
cd backend
python -m grc.seed_frameworks            # NDMO + PDPL framework defs (idempotent)
python seed_normalization_baseline.py    # owner baseline normalization run
python _reseed_ndmo.py                   # NDMO control tree re-seed
python _seed_ndmo_artifact_catalog.py    # NDMO artifact catalog
# _backfill_*.py — one-time backfills for pre-existing NDMO rows only
```

### Risk

Low. All column adds are nullable (or have a safe default) and idempotent —
re-running skips columns that already exist. New tables are `create_all`
no-ops once present. Existing rows are untouched (defaults/NULL preserve
current behavior until a writer populates them).

### Auto-applied?

**Yes** — schema (tables + columns) on next backend restart via
`ensure_compliance_columns()`. Seed/backfill scripts above are optional and
manual.

---

## 2026-06-19 — Asset OS normalization on ingest + benchmark-OS mapping seed (DATA + code-only, manual script)

### What

Two coordinated changes so ingested/imported/manually-added IT assets resolve
to the correct CIS benchmark (the rule-applicability matcher keys off
`grc_it_assets.os_normalized` → `grc_benchmark_os_mappings`):

1. **Code-only — OS-string normalisation on every asset-entry path.**
   * New `normalize_os_string()` in
     [`os_detector.py`](backend/grc/modules/compliance_plugins/services/os_detector.py)
     — pure-string parser (reuses the existing `normalise_windows/linux/cisco`
     regexes) → `(os_family, os_normalized, os_build, os_edition)`. Also fixed
     two latent bugs in the shared Linux regexes (greedy version capture →
     wrong RHEL/Rocky major; this also improves the live `/etc/os-release` path).
   * **Nessus/Rapid7 sync** ([`sync_service.py`](backend/grc/modules/integrations/services/sync_service.py)
     `_map_asset_fields`) — the scanner's raw OS string was captured then
     **dropped**; now normalised into `os_family/os_version/os_normalized/
     os_build/os_edition` (create + update; never clobbers a known OS on a
     failed parse).
   * **Manual create** ([`assets_router.py`](backend/grc/routers/assets_router.py)
     `create_asset`) — derives `os_normalized` from the operator's
     `os_version`/`os_family` when not explicitly supplied (explicit value
     still wins).
   * **Bulk CSV/Excel import** — added an `operating_system` column to the
     template and normalise it per row.

2. **DATA — comprehensive `grc_benchmark_os_mappings` seed.** New script
   [`scripts/seed_benchmark_os_mappings.py`](backend/scripts/seed_benchmark_os_mappings.py)
   lays down 55 normaliser-aligned `os_pattern → benchmark` rows (Windows
   desktop/server, Ubuntu/Debian/RHEL-family/SUSE/Amazon, macOS, VMware ESXi,
   Cisco/Juniper/Forti/PaloAlto/Aruba/CheckPoint, AWS/Azure/k8s, Oracle DB).
   Executable benchmark preferred; RHEL/Rocky v9 → AlmaLinux 9 executable
   proxy; else newest non-archived manual benchmark. Tenant-global rows
   (`tenant_id IS NULL`).

### Why

Manual/Excel/scanner-ingested assets landed with `os_normalized = NULL` and the
fuzzy `os_keys` fallback mis-resolved (e.g. `windows-server-2019` → an
*archived Windows 11* benchmark; RHEL/Rocky/ESXi/macOS → nothing). Now every
asset-entry path produces a canonical key and that key maps to the correct,
current benchmark.

### How (Ubuntu)

```
git pull            # ships the code changes (auto-active on restart)
cd backend
python -m scripts.seed_benchmark_os_mappings --all-tenants     # idempotent
```

The seed is idempotent: it only fills missing `os_pattern` rows and leaves any
pre-existing active mapping (operator edits, the legacy 17) untouched.

### Risk

Low. Code paths only ADD OS fields (never overwrite a known OS with a failed
parse). The seed only inserts gap patterns; re-running is a no-op. Legacy
mismatched patterns (`oracle-linux-9`, `amazon-linux-2023`, `cisco-nx-os`,
`cisco-ios-xe-17`) are left in place but harmless — the new normaliser-aligned
patterns (`oraclelinux-9`, `amazonlinux-2023`, `cisco-nxos`, `cisco-ios-xe`)
supersede them.

### Auto-applied?

Code: yes (on restart). Mapping seed: **no — run the script once on Ubuntu.**

---

## 2026-06-19 — Framework compliance dashboard charts (NEW TABLE `grc_compliance_history`, auto-applied)

### What

New per-framework compliance dashboard on `/frameworks/[id]` (gauge, requirement
status donut, automated-controls assurance, maturity radar, compliance trend +
stat cards). Backed by:

  * **New table `grc_compliance_history`** — model `ComplianceHistory` in
    [`backend/grc/models/_16_certification_journey_models.py`](backend/grc/models/_16_certification_journey_models.py).
    One row per (journey_id, UTC day): completion_pct, readiness_pct,
    evidence_coverage_pct, total_controls, status_counts (JSON). Powers the
    "compliance trend over time" chart (there was no history before).
  * **New endpoint** `GET /certifications/{journey_id}/charts`
    ([`backend/grc/routers/certification_router.py`](backend/grc/routers/certification_router.py))
    — reuses the existing progress calc, derives automation
    (PluginControlMapping → ControlMapping → parsed_control + latest passing
    run), and **upserts today's posture snapshot** into the history table on
    each load (so the trend fills in over time — no cron job).
  * **Frontend**: `FrameworkChartsOverview.tsx` (recharts, light theme) wired
    into the framework detail Overview tab; `certificationsApi.getCharts()`.

### DB impact

**One new table, no changes to existing tables/columns.** It is created
automatically per-tenant by the existing `Base.metadata.create_all` self-heal
that runs on every tenant-engine init
([backend/grc/db.py](backend/grc/db.py) — "create any tables the model
registry knows about but this tenant DB hasn't been populated with yet").
`create_all` only creates MISSING tables, so this is a safe no-op where the
table already exists. The snapshot write is the only DATA write and it is
idempotent per (journey, day).

### How (on Ubuntu)

```bash
cd ~/grc-final/complywerse_ai && git pull
sudo systemctl restart grc-backend.service      # picks up the model + endpoint
cd grc-frontend && npm run build && pm2 restart grc-frontend
```

The `grc_compliance_history` table is created on the first request that opens
each tenant's engine after the restart — nothing to run manually.

### Risk

- Additive only — existing framework pages/queries untouched.
- Snapshot + trend reads are best-effort (wrapped in try/except + rollback) so
  a history hiccup can never break the charts response.
- Trend starts with a single point per journey and builds up daily.

### Auto-applied?

**Yes** — `create_all` makes the table on next tenant access after the backend
restart. No manual SQL.

---

## 2026-06-19 — Seed the full CIS Benchmark library (DATA seed + manual-attestation code, NO schema)

### What

A large **data seed** plus supporting **code** (no schema changes — uses
existing `grc_compliance_plugins` / `grc_os_versions` columns):

  1. **Importer** —
     [`backend/scripts/import_cis_benchmarks_json.py`](backend/scripts/import_cis_benchmarks_json.py)
     ingests the parsed CIS Benchmark JSON corpus (`CIS_Benchmarks/*.json`,
     497 PDFs / ~53k recommendations) into `grc_compliance_plugins` as
     GLOBAL rules (`tenant_id IS NULL`). Per the product decisions:
       - **CIS-only** categories (Cloud, Desktop, DevSecOps, Mobile, Network,
         Operating Systems, Server) — DISA STIG + Uncategorized excluded.
       - **Gap-fill**: for the Operating Systems category it SKIPS benchmarks
         that duplicate the existing executable library (Jaccard ≥ 0.85 on a
         normalised product+version signature), so the curated executable
         Windows/Linux rules are kept and only missing coverage is added.
       - ~**36.9k** new rules per tenant (345 benchmarks), `runner_type="manual"`,
         `check_definition={"manual": true, "source": "cis_benchmark_pdf"}`,
         `level` = CIS profile (L1/L2), audit/remediation/rationale as text.
       - Rebuilds `grc_os_versions` from every distinct `os_keys` array so the
         library tree groups **family → product → benchmark** for BOTH the new
         rules AND the pre-existing executable rules (which were previously
         orphaned under "Other" because `grc_os_versions` was empty).
  2. **Manual-attestation runner** —
     [`backend/grc/modules/compliance_plugins/runners/manual_runner.py`](backend/grc/modules/compliance_plugins/runners/manual_runner.py)
     (registered in `runners/registry.py`). The text-only CIS rules carry no
     executable check, so an operator records a Pass / Fail / N-A decision per
     asset; `run_service.execute_plugin()` injects that decision and the run
     flows through the SAME run-row / control-cascade / audit pipeline as
     automated checks. `PluginRunCreate` gained `manual_result` / `manual_note`;
     the `POST /compliance-plugins/{id}/runs` endpoint passes them through.
     Frontend: the library page shows Pass/Fail/N-A buttons (and an "Attest"
     affordance) for `runner_type="manual"` rules — same run UI otherwise.

### Why

The platform shipped only ~5.4k curated executable rules across 27 (mostly
Windows/Linux) benchmarks. Operators needed the broad CIS catalogue —
Cloud, Network, Mobile, Desktop, DevSecOps, Server, plus the OS coverage the
executable set lacks (RHEL, Rocky, SUSE, macOS, Solaris, AIX, Windows
Server/10, …) — visible and testable in every tenant with the existing UI.

### DB impact

**No schema.** No new tables/columns, no `ALTER`/`CREATE`. The importer only
INSERTs rows into the existing `grc_compliance_plugins` table (global,
`tenant_id IS NULL`) and rebuilds the derived `grc_os_versions` registry.
Idempotent on `(tenant_id, plugin_key)` — re-running inserts 0 new rules.
The `grc_os_versions` rebuild is delete-and-recreate of derived grouping data
(safe: only family/normalized_key/parent_key/display_name/build are used).

### How (on Ubuntu)

The `CIS_Benchmarks/` folder is gitignored (the 113 MB `Operating_Systems.json`
exceeds GitHub's 100 MB limit), so copy it to the server first, then run the
importer per existing tenant:

```bash
# 1. ship the corpus (from the dev box)
scp -r c:\Users\Admin\Documents\GRC-Tenant\CIS_Benchmarks \
    ubuntu-host:/opt/grc/app/CIS_Benchmarks

# 2. import into every existing tenant
cd /opt/grc/app/backend
source venv/bin/activate
export CIS_BENCHMARKS_DIR=/opt/grc/app/CIS_Benchmarks
python -m scripts.import_cis_benchmarks_json --all-tenants     # or --tenant <slug>
# preview first with --dry-run

# 3. restart backend so the new `manual` runner is registered
sudo systemctl restart grc-backend.service
# frontend rebuild for the Pass/Fail/N-A attestation UI
cd ../grc-frontend && npm run build && pm2 restart grc-frontend
```

New tenants created AFTER the canonical source (`CANONICAL_LIBRARY_SOURCE_SLUG`,
default `company`) has been seeded inherit the rules automatically via
`sync_global_plugins_from_source` at provisioning — no manual step. Run the
`--all-tenants` import once to catch up the tenants that already exist.

### Risk

- Idempotent — re-running skips rules already present (by `plugin_key`).
- Large data load: ~36.9k global rows **per tenant** (the OS corpus is the
  bulk). The library-tree / counts queries already scale to this on the
  existing 5.4k set; expect a one-time insert cost.
- Tenant-scoped data untouched (rules are global, `tenant_id IS NULL`).
- A `manual` rule "tested" without the backend restart (so the runner isn't
  registered) records a `status="error"` run, harmless and self-corrects once
  the backend is restarted.

### Auto-applied?

**No** — run the importer once per deployment (`--all-tenants`) after copying
the corpus, then restart backend + rebuild frontend. New tenants auto-inherit.

---

## 2026-06-18 — Workflow auto-trigger, Escalation node, Risk-Posture & audit fixes (code-only, NO schema)

**Summary:** Everything in this session is **code-only**. No new tables,
no new columns, no `ALTER` / `CREATE`, no one-shot SQL to run against any
tenant DB. Several changes alter DB read/write **behaviour** (audit rows
now land in the right table, the new Escalation node writes more
notification / audit rows, the Risk-Posture query was widened), so they
are recorded here for completeness. On Ubuntu the entire session applies
with: `git pull` → restart backend → (re)start the workflow worker → set
the three env vars below. Nothing runs against a tenant DB.

### New / changed env vars (set in `backend/.env` on Ubuntu)

```
# Run the workflow runtime as a SEPARATE worker process, not inside the API.
DISABLE_EMBEDDED_WORKFLOW_RUNTIME=1
# Cross-process event queue backend for the workflow engine. "redis" (default)
# is required when API and worker are separate processes; "memory" only works
# single-process.
WORKFLOW_QUEUE_BACKEND=redis     # uses REDIS_URL
# Account lockout is now OFF by default (failed logins give a clear error and
# never lock). Set to "true" only if you want the old lock-after-N behaviour.
AUTH_ACCOUNT_LOCKOUT_ENABLED=false
```

The worker is a new standalone process —
[`backend/workflow_worker.py`](backend/workflow_worker.py). Run it alongside
the API (e.g. its own systemd unit): `python workflow_worker.py`.

### Audit-log writes now land in the TENANT DB (the auto-trigger root fix)

- **What**: `write_audit_log` in
  [`backend/grc/audit_logger.py`](backend/grc/audit_logger.py) now (a) writes
  every generic CRUD audit row to the **per-tenant** `grc_audit_logs` (via
  `open_tenant_session(slug)`) instead of the master catalog, and (b) reads
  the tenant id from `request.state.tenant_id` (the middleware stores
  `request.state.tenant` as a dict, so the old `getattr(tenant, "id")`
  always returned `None`). Also accepts the JWT from an
  `Authorization: Bearer` header, not just the `grc_auth_token` cookie.
- **Why**: CRUD audits were silently failing — `write_audit_log` either
  targeted the master DB (which has no `grc_audit_logs`) or bailed at
  `if not tenant_id: return`. With no audit rows, the workflow dispatcher
  (which polls each tenant's `grc_audit_logs`) saw no platform events and
  **nothing auto-triggered**.
- **DB impact**: **No schema.** Behavioural: generic CRUD audit rows are
  now actually `INSERT`ed into each tenant's existing `grc_audit_logs`
  table. Existing rows untouched. Expect audit-row volume per tenant to
  rise to its intended level.
- **How**: `git pull` + restart backend (the write happens in the API
  middleware — restart the **API**, not just the worker).
- **Auto-applied?**: N/A — code only.

### Evidence-Management deletes map to `compliance.evidence` events

- **What**: Added `evidence-mgmt`/`evidence_mgmt` → `(compliance, evidence)`
  rows to `_CANONICAL_RESOURCE_MAP` in
  [`backend/grc/modules/workflow_engine/services/trigger_dispatcher.py`](backend/grc/modules/workflow_engine/services/trigger_dispatcher.py).
  Also: the dispatcher / runtime / timer service are now **tenant-aware**
  (iterate every tenant, poll each tenant's `grc_audit_logs` +
  `grc_workflow_engine_*` tables with a per-tenant watermark), and webhook
  notification is best-effort so a missing `grc_workflow_engine_webhooks`
  table can't roll back instance completion.
- **Why**: Users delete evidence at `DELETE /grc/evidence-mgmt/items/{id}`,
  which derived `evidence.delete`, never the `compliance.evidence.delete`
  that an evidence workflow listens for — so the workflow never fired.
- **DB impact**: **No schema.** Read-only change to event derivation; the
  tenant-aware polling reads per-tenant tables that already exist.
- **How**: `git pull` + restart the workflow worker.
- **Auto-applied?**: N/A — code only.

### Risk-Posture dashboard no longer hides unowned assets

- **What**: In
  [`backend/grc/modules/risk_posture/service.py`](backend/grc/modules/risk_posture/service.py)
  `compute_tenant_posture`, an owner-scoped caller now matches
  `owner_id == <viewer> OR owner_id IS NULL` instead of `owner_id == <viewer>`.
- **Why**: Assets are commonly created with `owner_id IS NULL`, and the
  tenant's `grc_user_roles` table is empty so every user is treated as
  owner-scoped — the dashboard filtered out every asset and showed nothing
  (no CIS, no anything), even though the scan data and scoring were correct.
- **DB impact**: **No schema, no row mutation.** Pure widening of a read
  query. (The 2026-06-09 `owner_id` backfill snippet is still the way to
  *assign* owners; this change makes unowned assets visible regardless.)
- **How**: `git pull` + restart backend.
- **Auto-applied?**: N/A — code only.

### Multi-level Escalation node (new) — uses existing tables only

- **What**: New "Escalation" workflow node. The standalone escalation
  executor in
  [`backend/grc/modules/workflow_engine/services/step_executor.py`](backend/grc/modules/workflow_engine/services/step_executor.py)
  was rewritten as a multi-level state machine: notify each level's users +
  roles over in-app **and** email, then wait the level's `wait_days` +
  `wait_hours` before escalating to the next level (using the same
  `waiting_timer` / `next_run_at` resume mechanism as the timer node).
- **DB impact**: **No schema.** It only writes to tables that already
  exist — `grc_workflow_engine_steps.output_payload` (existing JSON column,
  used to track the current level across resumes), `grc_workflow_audit_logs`
  and `grc_workflow_notifications`. The node's config (the
  `escalation_levels` array incl. `wait_days` / `wait_hours`) is stored in
  the workflow definition's existing JSON node-config — no column change.
  Existing saved workflows load unchanged.
- **How**: `git pull` + restart backend **and** the workflow worker (the
  per-level waits resume in the worker's timer loop).
- **Auto-applied?**: N/A — code only.

### rich_audit actor tagging (workflow loop-prevention)

- **What**: [`backend/grc/rich_audit.py`](backend/grc/rich_audit.py) gained
  `workflow_actor_context` / `actor_source` so workflow-initiated mutations
  are tagged. The dispatcher skips audit rows whose `changes.actor_source ==
  "workflow"` to prevent a workflow's own writes from re-triggering it.
- **DB impact**: **No schema.** `actor_source` / `actor_type` are stored
  inside the existing `changes` JSON column of `grc_audit_logs`.
- **How**: `git pull` + restart backend + worker.
- **Auto-applied?**: N/A — code only.

### Account lockout is opt-in

- **What**: [`backend/grc/services/password_policy.py`](backend/grc/services/password_policy.py)
  gates `is_account_locked` / `register_failed_login` behind
  `AUTH_ACCOUNT_LOCKOUT_ENABLED` (default **false**).
- **DB impact**: **None.** Reads the existing `grc_users` login-attempt
  fields; doesn't write or alter them when disabled.
- **How**: set the env var (see above) + restart backend.
- **Auto-applied?**: N/A — code only.

---

## 2026-06-09 — Asset auto-create: heartbeat + wizard now stamp owner_id (code-only)

### What

Two changes to the asset-auto-create logic so newly-discovered
hosts always show up on `/risk-posture`:

  * **Heartbeat** ([backend/grc/modules/agents/router.py](backend/grc/modules/agents/router.py))
      - Removed the `body.os_normalized` gate. A brand-new agent
        that hasn't completed OS detection yet now still creates
        its stub row on first heartbeat (OS fields refresh on the
        next heartbeat with data).
      - Stamps `owner_id = agent.created_by_user_id` (the operator
        who enrolled the agent) + `owner_name` for the convenience
        column.
      - Added an else-branch that auto-links the agent to a
        pre-existing host match (case-insensitive) instead of
        loop-creating duplicates.
  * **Connect Wizard handshake** ([backend/grc/routers/connect_wizard_router.py](backend/grc/routers/connect_wizard_router.py))
      - Hostname lookup changed from
        `ITAsset.host_name == body.hostname` to
        `func.lower(ITAsset.host_name) == hn.lower()` so
        `Win-SRV01.bank.local` matches `win-srv01.bank.local`
        from a previous wizard run / heartbeat / CMDB import.
      - Stamps `owner_id = user_id` (decoded from the wizard's
        signed JWT payload, i.e. the operator who started the
        wizard) + `owner_name`.

Bulk discover ([backend/grc/modules/onboarding/router.py](backend/grc/modules/onboarding/router.py)) was
already correct — both case-insensitive lookup AND `owner_id`
stamping were in place. No change.

### Why

Risk Posture's dashboard query is owner-scoped for non-admin
users — `WHERE owner_id = <viewer>`. Assets that landed in
`grc_it_assets` with `owner_id IS NULL` were silently filtered
out, so `/risk-posture` showed "0 assets" while `/assets`
showed the same row fine. The case-sensitive wizard match was a
secondary issue that produced duplicate rows when operators
typed hostnames in different cases.

### Live test (dev, on the `company` tenant)

```
=== Test 1: fresh agent heartbeat creates ITAsset with owner_id ===
  user mehboob id=1
  fake agent id=23 created_by_user_id=1
  asset created id=5 owner_id=1 owner_name='mehboob'

=== Test 2: Risk Posture owner-scoped query finds it ===
  PASS: dashboard query returned the host
```

### DB impact

**None.** Pure code change. No new tables, no new columns. The
`owner_id` / `owner_name` columns already existed on
`grc_it_assets` — we just weren't populating them on these two
paths.

### Existing assets

Assets created BEFORE this fix landed will still have
`owner_id IS NULL`. To backfill them so they show up in Risk
Posture for the operator who likely owns them:

```bash
cd ~/grc-final/complywerse_ai/backend
source venv/bin/activate
python <<'PYEOF'
from dotenv import load_dotenv; load_dotenv('.env')
from grc.db import open_tenant_session
from grc.models import GRCUser, ITAsset, Tenant, SessionLocal
from sqlalchemy import text

# Pick the canonical admin per tenant (the primary contact) and
# stamp them on any orphan-owner assets. Adjust slugs as needed.
master = SessionLocal()
for t in master.query(Tenant).all():
    if not t.slug or not t.primary_contact_email:
        continue
    sess = open_tenant_session(t.slug)
    admin = sess.query(GRCUser).filter(
        GRCUser.email == t.primary_contact_email
    ).first()
    if not admin:
        sess.close(); continue
    n = sess.execute(text(
        "UPDATE grc_it_assets SET owner_id = :uid, "
        "  owner_name = COALESCE(owner_name, :uname) "
        "WHERE owner_id IS NULL"
    ), {'uid': admin.id, 'uname': admin.display_name or admin.username}).rowcount
    sess.commit()
    print(f'{t.slug}: stamped {n} orphan-owner asset(s) to user {admin.email}')
    sess.close()
master.close()
PYEOF
```

Idempotent — re-running affects 0 rows once cleaned.

### How

```bash
cd ~/grc-final/complywerse_ai
git pull
sudo systemctl restart grc-backend.service
# (optional) run the orphan-owner backfill snippet above
```

### Auto-applied?

Code: **N/A — code only.** The optional backfill snippet is the
only DATA write, and it's only needed for assets that already
exist with NULL owner — new assets created via heartbeat / wizard
land correctly stamped.

---

## 2026-06-09 — Evidence preview call sites all wired through new endpoint (code-only)

### What

Followed up the new `/evidence/{id}/preview` endpoint by sweeping every
page that opens the `EvidenceViewer` and adding `evidence_id` to the
preview payload:

  * `/evidence/page.tsx` — both card-grid and list-row preview buttons
  * `/evidence/[id]/page.tsx` — detail page's full-screen previewer
  * `/frameworks/[id]/page.tsx` — framework requirements evidence
    preview
  * `/auditor-portal/[frameworkId]/_tabs/EvidenceTab.tsx` — auditor
    portal evidence review

### Why

The first round of the fix added the backend endpoint and updated the
`EvidencePreviewButton` component, but the standalone pages above
each call `EvidenceViewer` directly with their own preview payload
construction. Those still passed only `file_path` (server filesystem
path) — which the viewer tried to GET as a URL, producing 404s like
`/grc/C%3A/Users/Admin/Documents/.../evidence/14/<uuid>.jpg`.

Setting `evidence_id` on every call site routes them through
`/evidence/{id}/preview` instead. The `file_path` field is preserved
so legacy fallback callers (governance docs, agent installers) still
work.

### DB impact

None. Pure frontend wire-up.

### How (on Ubuntu)

```bash
cd ~/grc-final/complywerse_ai
git pull
# Frontend rebuild — depending on how you run the frontend
cd grc-frontend && npm run build && pm2 restart grc-frontend
# OR if you run dev mode: just hard-refresh, Next.js picks it up
```

### Auto-applied?

**N/A — code only.** Restart frontend after `git pull`.

---

## 2026-06-09 — Evidence preview / download endpoints (code-only)

### What

Two new backend routes in
[`backend/grc/routers/evidence_router.py`](backend/grc/routers/evidence_router.py):

  * `GET /evidence/{id}/preview`  — stream with
    `Content-Disposition: inline` for the EvidenceViewer modal
    (PDF in iframe, image in `<img>`, XLSX via the xlsx package,
    text in `<pre>`).
  * `GET /evidence/{id}/download` — same backend resolution but
    forces a save-as via `Content-Disposition: attachment`.

Both endpoints look up the Evidence row, tenant-check via
`validate_tenant_access`, resolve absolute path on disk (handles
relative AND absolute legacy storage paths), and stream with the
right MIME type — falling back to extension-based guess when
`evidence.file_type` is null.

### Why

The frontend's `EvidenceViewer` was trying to fetch
`evidence.file_path` directly as a URL — but `file_path` is a
SERVER FILESYSTEM PATH like
`backend/grc/uploads/evidence/1/<uuid>.pdf`, NOT a URL. The
backend never mounted that directory as static files. Every
"Couldn't load this file" / `Request failed with status code 404`
operators saw came from this.

### Frontend changes

  * `EvidenceFile` interface (in `EvidenceViewer.tsx`) gained an
    optional `evidence_id` field — set this and the viewer routes
    through the new preview endpoint instead of treating
    `file_path` as a URL.
  * `EvidencePreviewButton.tsx` now passes `evidence_id` into the
    viewer when it resolves an evidence row.
  * Legacy callers that pass `file_path` as a real URL (governance
    docs from `/governance/.../view-html`, agent installer file at
    `/grc/agent/install.exe`) still work via the legacy fallback
    in `resolveFileUrl()`.

### DB impact

None. Pure code change. No new tables, no new columns, no row
mutations. Existing `file_path` values continue to work — the
new endpoint just RESOLVES them properly instead of expecting
the frontend to use them as URLs.

### How (on Ubuntu)

```bash
cd ~/grc-final/complywerse_ai
git pull
sudo systemctl restart grc-backend.service
```

Hard-refresh the browser (Ctrl+Shift+R) and click the eye-icon
preview on any compliance evidence row. PDFs / images / text /
CSVs / XLSX all render inline. DOCX / PPTX fall through to the
existing "download to open" UX.

### Risk

  * Pre-existing GET `/evidence/{id}` (metadata) still works —
    the new routes have a different URL suffix, FastAPI routes
    them by exact match.
  * Tenant scoping enforced — operators can't read evidence from
    a tenant they aren't a member of.
  * Cache header `private, max-age=60` keeps repeated previews
    cheap without leaking the file content into shared caches.

### Auto-applied?

**N/A — code only.** `git pull` + restart backend.

---

## 2026-06-09 — One-shot orchestrator: apply EVERY DB change to all Ubuntu tenants

### Background

`DB_CHANGES.md` had grown to 6+ separate items needing to be applied
in the right order across every existing tenant + the canonical
source. Easy to skip one and end up with mixed-state tenants. This
orchestrator wraps them all up so a single command brings every
tenant into a uniform good state, idempotent + safe to re-run.

### What

[`backend/scripts/apply_all_db_changes_ubuntu.py`](backend/scripts/apply_all_db_changes_ubuntu.py)
runs four phases against every tenant in the master catalog:

1. **Phase 1 — Schema migrations**: calls `_ensure_for_engine()`
   per tenant, which runs every column-add in `_COLUMN_ADDS`
   (Risk Posture v2 cols, vuln effective-risk cols, criticality
   assessment cols, etc.) and `_COLUMN_TYPE_FIXUPS`
   (os_keys / target_builds → jsonb).
2. **Phase 2 — Data backfills**: `grc_vulnerabilities.is_exception`
   NULL → FALSE.
3. **Phase 3 — OS-version registry seed**: inserts the ~70 OS
   rows into `grc_os_versions` on every tenant. Uses
   `INSERT ... WHERE NOT EXISTS` so missing unique constraints
   don't break idempotency.
4. **Phase 4 — CIS library import + cross-tenant sync**: if
   `/tmp/cis_library.json` is present, imports it into the
   canonical source tenant (`CANONICAL_LIBRARY_SOURCE_SLUG` env
   var, falls back to first tenant). Then iterates every OTHER
   tenant and runs `sync_global_plugins_from_source` so they all
   inherit the 5,385-rule library.

### How

```bash
# On Ubuntu, after `git pull` of the latest code:
cd ~/grc-final/complywerse_ai/backend
source venv/bin/activate

# OPTIONAL prerequisite (only if you want phase 4 to import the library):
#   scp the JSON from dev to /tmp/cis_library.json BEFORE running.
#   If absent, phase 4 only does the cross-tenant sync.

# Optionally preview first
python -m scripts.apply_all_db_changes_ubuntu --dry-run

# Then for real
python -m scripts.apply_all_db_changes_ubuntu

# Restart backend so it picks up any code + .env changes
sudo systemctl restart grc-backend.service
sudo systemctl restart grc-worker-parsing.service
```

### Flags

- `--phase N` — run only phase N (1..4)
- `--skip-phase N` — skip phase N (repeatable)
- `--dry-run` — print what would happen, no writes

### Risk

- Every phase is idempotent — re-running on a fully-converged
  deploy prints `inserted=0` lines.
- Phases 1-3 don't touch any tenant-scoped data — only schema +
  global registry rows + a single backfill on a column that is
  documented as `default = False`.
- Phase 4 inserts only with `tenant_id IS NULL` (global rules);
  existing global plugins on the target are skipped via
  `plugin_key` uniqueness.
- A single phase failing on one tenant doesn't cascade — the
  next tenant is tried, and a clean error is logged. Re-run the
  script after fixing the underlying issue.

### Future tenants

When a NEW tenant is created via the UI after Ubuntu has been
brought up to state:

- Phase 1's logic runs automatically on first request per tenant
  (via `ensure_compliance_columns()` triggered by `get_db()`).
- Phase 3 runs automatically during `_seed_tenant_database` in
  `tenant_manager.py` via `seed_os_versions_and_backfill`.
- Phase 4 runs automatically during `_seed_tenant_database` via
  `sync_global_plugins_from_source` against
  `CANONICAL_LIBRARY_SOURCE_SLUG`.

No manual step needed for new tenants — they all inherit. The
orchestrator is only for catching up tenants that existed BEFORE
the relevant code landed.

### Auto-applied?

**No** — run this once on Ubuntu after `git pull`. After that, the
deployment is in a uniform state and the script does nothing on
re-run (every phase is no-op).

---

## 2026-06-09 — Seed `grc_os_versions` registry on Ubuntu (DATA seed)

### Background

The library-tree endpoint groups rules into **OS families** (Windows /
Linux / Cisco / Databases / Cloud / Container / macOS) by joining
plugin `os_keys` against the `grc_os_versions` registry. Without the
registry, every benchmark falls into **"Other / unclassified"** even
when its `os_keys` are correctly populated.

Symptom on Ubuntu after the CIS-library import: 5,421 rules visible,
ALL bucketed under "Other / unclassified" — because Ubuntu's
`grc_os_versions` table is empty on every tenant.

### What

Seeds ~50 OS rows (Windows 10/11, Server, Ubuntu, RHEL, Debian, Cisco
IOS/IOS-XE, Oracle/MSSQL/Postgres/MySQL, AWS/Azure/GCP, Kubernetes /
Docker, macOS) into every tenant's `grc_os_versions` table.
`INSERT ... ON CONFLICT (normalized_key) DO NOTHING` — idempotent.

### How

Option A (preferred): scp the canonical script from dev and run:

```powershell
# from Windows
scp c:\Users\Admin\Documents\GRC-Tenant\backend\scripts\seed_os_versions_and_backfill.py `
    mehboob@<host>:~/grc-final/complywerse_ai/backend/scripts/
```

```bash
# on Ubuntu
cd ~/grc-final/complywerse_ai/backend
source venv/bin/activate
python scripts/seed_os_versions_and_backfill.py
```

Option B: inline heredoc paste (no scp needed) — see the chat
transcript dated 2026-06-09 for the self-contained `OS_SEED` list.

### Risk

- Idempotent — re-running inserts 0 new rows on already-seeded tenants.
- Does NOT touch `grc_compliance_plugins`. `os_keys` were populated by
  the JSON import (the previous DB_CHANGES entry); this only adds the
  registry rows the bucket query needs.
- Tenant-scoped data untouched.

### Auto-applied?

**No** — run once on Ubuntu (will hit every tenant in the master
catalog in one pass). Also runs automatically on dev/Windows during
new-tenant provisioning via `seed_os_versions_and_backfill.py` if
ops wires it into deploy, but in dev that script isn't on the
provisioning hot-path — it's a one-shot deploy bootstrap.

---

## 2026-06-09 — Ship the 5,385-rule CIS library to Ubuntu (DATA migration)

### Background

The dev box's `company` tenant has 5,385 PDF-ingested CIS benchmark
rules (Windows 11, Ubuntu, AWS Foundations, etc.) with
`tenant_id IS NULL` — conceptually "global". Database-per-tenant
means they live ONLY in that one tenant's DB; they don't auto-
propagate to other tenants or other deployments.

On Ubuntu, every newly-provisioned tenant gets the 36 built-in
`PLUGIN_LIBRARY` rules, plus an auto-sync from
`CANONICAL_LIBRARY_SOURCE_SLUG` (default `company`). But Ubuntu has
no tenant with the full library yet → auto-sync is a no-op → new
tenants show "Total rules: 36, Unique benchmarks: 2".

### What

A **one-time data load** that takes the 5,385 global rules from dev
and inserts them into ONE Ubuntu tenant. After that, every new
Ubuntu tenant auto-inherits via the provisioning sync (because
`CANONICAL_LIBRARY_SOURCE_SLUG=company` was set in `.env.example`).

### How

**Step 1 — On dev (Windows), produce the export file:**

```powershell
cd c:\Users\Admin\Documents\GRC-Tenant\backend
python -m scripts.export_global_cis_library `
    --source company `
    --out c:\Users\Admin\Documents\GRC-Tenant\cis_library.json
```

Produces a ~19 MB JSON with 5,385 rows + their parent-child links.
(`cis_library.json` is gitignored — never committed.)

**Step 2 — Ship to Ubuntu:**

```bash
scp c:\Users\Admin\Documents\GRC-Tenant\cis_library.json \
    ubuntu-host:/tmp/cis_library.json
```

**Step 3 — On Ubuntu, import into the canonical tenant:**

```bash
cd /opt/grc/app/backend
source venv/bin/activate
python -m scripts.import_global_cis_library \
    --target company \
    --in /tmp/cis_library.json
```

(If you don't have a `company` tenant on Ubuntu, pick another slug
that has at least 1 user — say `liztek-1` — and ALSO set
`CANONICAL_LIBRARY_SOURCE_SLUG=liztek-1` in `backend/.env`.)

Output looks like:
```
Pass 1 done: inserted=5349 skipped(dup plugin_key)=36
Pass 2 done: 4xxx parent FKs resolved
Target tenant <slug> now has 5385 global rules total
```

**Step 4 — Backfill any other under-seeded tenant** that already exists:

```bash
python -m scripts.import_global_cis_library \
    --target <some-other-slug> --in /tmp/cis_library.json
```

Idempotent — re-running against an already-loaded tenant
prints `inserted=0 skipped(dup plugin_key)=5385`.

**Step 5 — Future tenants** created via the UI auto-inherit the
library from `CANONICAL_LIBRARY_SOURCE_SLUG` (default `company`).
No further manual step needed.

### Risk

- The export is read-only on dev.
- The import is idempotent (plugin_key uniqueness gates inserts);
  re-running is safe.
- Tenant-scoped rules (`tenant_id IS NOT NULL`) are NOT touched on
  either side.
- The two-pass FK fixup means `parent_plugin_id` links remain
  consistent on the target.

### Auto-applied?

**No** — run the import command once per target tenant. After that,
new tenants auto-sync via `_seed_tenant_database` at provisioning
time.

---

## 2026-06-09 — Control library: populate, auto-group worker, full-text grouping (no DB changes)

### Auto-grouping now dispatches via Celery parsing queue (was: in-process thread)

- **What**: Code-only. `auto_group_dispatch` in
  [`backend/grc/modules/control_library/routers/groups.py`](backend/grc/modules/control_library/routers/groups.py)
  now calls `ai_auto_group.apply_async(queue="parsing")` (the existing
  Celery task) instead of starting a daemon thread. Thread fallback
  remains for dev boxes without Redis / broker reachability.
- **Why**: The job ran in the API process. Auto-grouping a tenant's
  ~3k controls takes several minutes of AI calls — uvicorn's request
  thread shouldn't be holding state for that long, and a process
  restart killed the job mid-flight.
- **DB impact**: None. The task ultimately writes the same
  `CommonControlGroup` + `CommonControlGroupMapping` rows it did
  before — just from a different process.
- **How**: `git pull` + restart `grc-backend.service` AND the
  `grc-worker-parsing.service` worker. Verify with
  `celery -A grc.celery_app inspect registered` — should list
  `grc.tasks.control_library.ai_auto_group`.
- **Auto-applied?**: N/A — code change only.

### Auto-grouping prompt now sends FULL control text (was: 400-char truncation)

- **What**: Code-only. `_fetch_controls_for_grouping` in groups.py
  now uses `pc.full_text` (up to 8000 chars per control) instead of
  the previous `pc.description or pc.full_text[:400]`. Batch size
  reduced from 60 to 30 to keep within gpt-4o's 128k context window
  with the larger payloads.
- **Why**: AI was clustering on titles + 400-char snippets, missing
  the rationale/requirements/references that make controls actually
  comparable. Quality of groups improves.
- **DB impact**: None. Grouping output schema unchanged; just better
  groupings.
- **How**: `git pull` + restart backend + restart parsing worker.
- **Auto-applied?**: N/A — code change only.

### "Populate from Frameworks" returns a clear error when no groups exist

- **What**: Code-only. `populate-all-groups` endpoint now raises a
  400 with `{error: "no_groups_to_populate", message: "...", fix:
  "ai_auto_group"}` when there are zero groups in the tenant.
  Frontend mutation surfaces the message in a toast.
- **Why**: Previously the endpoint silently returned "Added 0
  controls" — operators reading the button label "Populate from
  Frameworks" thought it was broken when it was actually working
  exactly as designed (it only enriches EXISTING groups). Now it
  tells them to run AI Auto-Grouping first.
- **DB impact**: None.
- **How**: `git pull` + restart backend.
- **Auto-applied?**: N/A — code change only.

---

## 2026-06-09 — Code-only fixes (no DB changes)

### Governance exception self-approval bypass for tenant Administrators

- **What**: Code-only — new helper `_is_tenant_administrator()` in
  [`backend/grc/routers/policy_exception_router.py`](backend/grc/routers/policy_exception_router.py).
  No schema or data change.
- **Why**: Single-admin tenants (typical SaaS reality) couldn't
  approve any exception because the same user both raised and was
  asked to approve. Now the Administrator role / primary contact
  bypasses the separation-of-duties check; the audit log still
  records who approved.
- **How**: Pull the latest code (`git pull`) and restart
  `grc-backend.service`. Nothing to run against the DB.
- **Risk**: None. Existing rows aren't touched. Non-admin users still
  hit the separation-of-duties check.
- **Auto-applied?**: N/A — code change only.

### AI cross-framework compare accepts global frameworks

- **What**: Code-only — query in
  [`backend/grc/modules/control_library/routers/comparison.py`](backend/grc/modules/control_library/routers/comparison.py)
  now does `tenant_id IS NULL OR tenant_id IN user_tenants` (matched
  the sibling endpoints which already do this).
- **Why**: Newly-provisioned tenants get frameworks seeded with
  `tenant_id=NULL` (conceptually global). The dispatch endpoint was
  filtering only `tenant_id IN (...)`, silently dropping global rows,
  returning `404 "Source or destination framework not found"`.
- **How**: Code-only. `git pull` + restart backend.
- **Risk**: None. The two sibling endpoints (dropdown +
  single-control compare) already had this same OR clause — we're
  bringing the dispatch endpoint into line.
- **Auto-applied?**: N/A — code change only.

---

## 2026-06-08 — Risk Posture v2 + compliance plugin sync

### Risk Posture v2 business-impact columns on `grc_it_assets`

- **What**: 5 new columns added to `grc_it_assets`.
- **Why**: Risk Posture v2 needs per-asset business context for the
  effective-risk formula (customer-facing? internet-facing?
  regulated-data category? operational dependency? notes).
- **How**: Auto-applied via `ensure_compliance_columns()` on first
  request per uvicorn process per tenant DB. List of column adds in
  [`backend/grc/modules/compliance/schema_migrations.py`](backend/grc/modules/compliance/schema_migrations.py)
  `_COLUMN_ADDS`:
  ```sql
  -- Auto-runs; this is just for visibility
  ALTER TABLE grc_it_assets ADD COLUMN IF NOT EXISTS
      is_customer_facing BOOLEAN DEFAULT FALSE NOT NULL;
  ALTER TABLE grc_it_assets ADD COLUMN IF NOT EXISTS
      is_internet_facing BOOLEAN DEFAULT FALSE NOT NULL;
  ALTER TABLE grc_it_assets ADD COLUMN IF NOT EXISTS
      regulated_data_type VARCHAR(20) DEFAULT 'none' NOT NULL;
  ALTER TABLE grc_it_assets ADD COLUMN IF NOT EXISTS
      op_dep_business_impact VARCHAR(20) DEFAULT 'medium' NOT NULL;
  ALTER TABLE grc_it_assets ADD COLUMN IF NOT EXISTS
      business_impact_notes TEXT;
  ```
- **Risk**: None. Defaults are set; existing rows keep working.
- **Auto-applied?**: **Yes** — runs on first request per tenant
  after backend restart.

### Effective-risk columns on `grc_vulnerabilities`

- **What**: 3 new columns added to `grc_vulnerabilities`.
- **How**: Auto-applied (same path as above).
  ```sql
  ALTER TABLE grc_vulnerabilities ADD COLUMN IF NOT EXISTS
      effective_risk_score FLOAT;
  ALTER TABLE grc_vulnerabilities ADD COLUMN IF NOT EXISTS
      effective_risk_reason TEXT;
  ALTER TABLE grc_vulnerabilities ADD COLUMN IF NOT EXISTS
      effective_risk_computed_at TIMESTAMP;
  ```
- **Auto-applied?**: **Yes**.

### `grc_compliance_plugins.os_keys` and `target_builds` type fixup

- **What**: Convert columns from `JSON` to `JSONB` on any tenant DB
  where they ended up as plain JSON. The
  `jsonb_array_elements_text()` operator (used by the library-tree
  query) only accepts JSONB.
- **How**: Auto-applied. `_ensure_column_type()` helper in
  [`schema_migrations.py`](backend/grc/modules/compliance/schema_migrations.py)
  runs:
  ```sql
  -- If current type is JSON, convert in place (lossless):
  ALTER TABLE grc_compliance_plugins
      ALTER COLUMN os_keys TYPE jsonb USING os_keys::jsonb;
  ALTER TABLE grc_compliance_plugins
      ALTER COLUMN target_builds TYPE jsonb USING target_builds::jsonb;
  ```
- **Risk**: None — `json::jsonb` is a lossless conversion.
- **Auto-applied?**: **Yes** — runs on first request per tenant after
  backend restart.

### Compliance plugin library sync (provisioning)

- **What**: When a NEW tenant is created, copy all global compliance
  plugins (`tenant_id IS NULL`) from a canonical source tenant into
  the new tenant's DB. Without this, fresh tenants land with only
  the 36 built-in PLUGIN_LIBRARY rows and the
  `/compliance-plugins/library` page looks empty.
- **How**: Wired into `_seed_tenant_database` in
  [`backend/grc/tenant_manager.py`](backend/grc/tenant_manager.py).
  The source tenant is named by env var
  `CANONICAL_LIBRARY_SOURCE_SLUG` (defaults to `company`).
- **On Ubuntu**: Already happens for every new tenant; no manual
  step. To backfill an EXISTING under-seeded tenant, run:
  ```bash
  cd /opt/grc/app/backend
  python -c "
  from dotenv import load_dotenv; load_dotenv('.env')
  from grc.db import open_tenant_session
  from grc.modules.compliance_plugins.seed import sync_global_plugins_from_source
  target = open_tenant_session('<target-slug>')
  source = open_tenant_session('<source-slug-with-full-library>')
  print(sync_global_plugins_from_source(target, source), 'rows inserted')
  target.close(); source.close()
  "
  ```
- **Risk**: Idempotent. Re-running does nothing on already-synced
  tenants (insert count = 0). The two-pass FK fixup means parent
  links stay consistent.
- **Auto-applied?**: For new tenants, yes. For existing
  under-seeded tenants, manual.

### `grc_vulnerabilities.is_exception` NULL → FALSE backfill

- **What**: Data backfill — set `is_exception = FALSE` on every row
  where it was NULL (legacy / raw-INSERT rows).
- **Why**: Pydantic `VulnerabilityResponse` expected `bool`; NULL
  rows caused 500s on `/vulnerabilities`.
- **How**: One-shot SQL per tenant:
  ```sql
  UPDATE grc_vulnerabilities SET is_exception = FALSE
  WHERE is_exception IS NULL;
  ```
- **Risk**: None — `FALSE` is the documented default; the column
  doesn't drive any logic when it's already false.
- **Auto-applied?**: **No**. Run once per tenant on Ubuntu.

### `VulnerabilityResponse.is_exception` schema relaxed

- **What**: Code-only — Pydantic field made `Optional[bool] = False`
  in [`backend/grc/schemas/_05_vulnerability_management_schemas.py`](backend/grc/schemas/_05_vulnerability_management_schemas.py)
  so NULL rows coerce to False rather than 500.
- **Auto-applied?**: N/A — code change only.

---

## 2026-06-07 — Audit log de-duplication

### `compliance.plugin_runs` duplicate `create` emit removed

- **What**: Code-only — `write_rich_audit_log(action="create", ...)`
  call removed from
  [`backend/grc/modules/compliance_plugins/services/run_service.py`](backend/grc/modules/compliance_plugins/services/run_service.py).
- **Why**: Each plugin run was producing TWO audit rows (`create`
  + `execute`/`failed`), accounting for 40% of all audit log volume.
  Workflow engine subscriptions key on `execute`/`failed` — `create`
  was never used.
- **DB impact**: Existing duplicate rows STAY in the table (we don't
  retroactively delete history). Future scans produce 1 row per run.
- **How**: Code-only. `git pull` + restart backend.
- **Auto-applied?**: N/A — code change only.

---

## Reference: applying these changes on Ubuntu

1. `git pull` on `/opt/grc/app/backend` to get the latest code.
2. `sudo systemctl restart grc-backend.service` — this triggers
   `ensure_compliance_columns()` on next request per tenant, so all
   "Auto-applied? Yes" entries take effect automatically.
3. Run the SQL / scripts under "Auto-applied? No" entries against
   each tenant DB that needs them.
4. Restart workers if you redeployed worker code:
   `sudo systemctl restart grc-worker-parsing grc-worker-default grc-beat`

If a tenant was created BEFORE the schema migrations landed, the
self-heal at first request takes care of it. If you create a new
tenant via the UI AFTER a `git pull`, everything is included in the
provisioning flow.
