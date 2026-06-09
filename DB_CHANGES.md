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
