# Handoff — Asset Discovery → Compliance pipeline (continue this work)

You are picking up a large, in-progress effort on the ComplyVerse GRC platform.
Read this whole document first, then **ask me a series of clarifying questions
before writing any code** — several tasks have design choices I need to confirm.
Work in small, verifiable steps and prove each fix against the live database, the
way described under "Working method" at the end.

---

## 0. Environment / how to run

- Repo root: `C:\Users\HP\OneDrive\Desktop\GRC 1\complywerse_ai`
  - Backend: `backend/` — FastAPI, Python 3.11. App package `grc/`.
  - Frontend: `grc-frontend/` — Next.js (app router), TypeScript.
- **Backend** must serve under `/grc`: run `grc_dev_server:application` on port **4000**
  (a thin launcher that mounts `grc.main.app` at `/grc` — `--root-path` does NOT
  work in this Starlette build). Load `backend/.env` first (needs `SESSION_SECRET`,
  DB URLs). Start detached so it survives; logs to a file you can tail.
  ```
  python -m uvicorn grc_dev_server:application --host 127.0.0.1 --port 4000 --env-file .env
  ```
- **Frontend**: `cd grc-frontend && npm run dev` (port 3000, auto-reloads).
- **DB**: Postgres on **5433**. Tenant DB URL template in `backend/.env`
  (`TENANT_DB_URL_TEMPLATE`, slug `complyverse`, tenant_id 1). Connect with
  psycopg2 for verification scripts.
- **Do NOT run `next build` locally** — validate the frontend with `npx tsc --noEmit`.
- The backend does NOT auto-reload — restart it after backend `.py` edits.
- The frontend proxies `/api/* → http://127.0.0.1:4000/grc/*`; any endpoint that
  can take >30s must be async + poll (the proxy cuts ~30s requests).

---

## 1. What the pipeline is (context)

An asset-discovery → inventory → compliance flow, built and debugged over a long
session. The intended, now-implemented model:

```
DISCOVER    Campaign sweeps a CIDR → DiscoveryObservation rows (resolution='unclaimed').
            A sweep NEVER creates inventory. Probes ports 445,22,3389,5985,5986.

CONNECT     "+ Add connection → Agentless → Windows/Linux" saves a CredentialProfile.
            "Try it on N devices" (connect-all-discovered) tries the login, transport-matched
            (winrm→windows, ssh→linux). Per-device pre-check skips hosts whose WinRM/SSH
            port is closed (avoids a 65s timeout). Outcomes are DISTINCT:
            connected / rejected (auth) / unreachable (service off) / no_login / unknown_type.

PROMOTE     Only on a SUCCESSFUL authenticated collect does an ITAsset get created
            (promote_observation). The collect (deep_collect.collect_host) also:
              - profiles OS (family/version/normalized/build/edition)
              - collects hardware (cpu/ram/disk/manufacturer/model/serial)
              - collects installed software → detected_software_json (each entry:
                name, version, publisher, software_key, benchmark_available, promoted_asset_id, attributes)
              - computes security_posture (AV/EDR)
              - deep-profiles recognised products via software_profiler (PostgreSQL/MSSQL/IIS/NGINX/MySQL)
              - registers an IntegrationConnection so CIS can run off the same credential
              - infers internet_facing from the IP class
              - sets network_segment from the campaign scope

COMPLIANCE  CIS benchmark scan. Benchmark chosen by strict_matcher.applicable_plugins_for_asset,
            which excludes TODO-stub rules AND expect:{"kind":"any"} auto-pass placeholders,
            picks the current (non-ARCHIVE, non-junk) benchmark, ranked deterministically.
            Runners: windows_winrm, linux_ssh, netdev_ssh, postgres_sql, mssql_sql, mysql_sql,
            oracle_sql, aws_readonly, azure_readonly, k8s_api, ldap_query, manual.
```

Key files:
- Discovery: `backend/grc/modules/asset_discovery/router.py`,
  `.../services/deep_collect.py`, `.../services/resolver.py`, `.../services/executor.py`
- Compliance: `backend/grc/modules/compliance_plugins/router.py`,
  `.../services/strict_matcher.py`, `.../services/software_normaliser.py`,
  `.../services/software_profiler.py`, `.../runners/*` (extended_runners.py has the DB runners)
- Assets: `backend/grc/routers/assets_router.py`, `backend/grc/models/_14_it_asset_inventory.py`,
  `backend/grc/schemas/_00_base.py`, `backend/grc/services/asset_criticality.py`
- Inventory scoring: `backend/grc/modules/it_assets/scoring.py`
- Frontend: `grc-frontend/src/app/(dashboard)/asset-discovery/page.tsx`,
  `.../assets/[id]/page.tsx`, `.../assets/[id]/_host-applications-panel.tsx`,
  `.../assets/_workspace/RegisterView.tsx`,
  `grc-frontend/src/components/dashboard/InventoryScorecard.tsx`,
  `.../admin/integrations/connect/page.tsx`

---

## 2. TASK A — make ALL ~70 CIS PostgreSQL rules real (highest priority)

**Problem.** The CIS PostgreSQL 18 benchmark (`CIS_PostgreSQL_18_Benchmark_v1.0.0`,
72 rows / 70 enabled) was ingested from a PDF. The parser extracted each rule's
`title`, `description`, `rationale`, `remediation`, and crucially the audit
procedure in prose (`audit_steps_text`, and `_audit_excerpt` inside
`check_definition`), but did NOT compile the audit prose into an executable check.
66 of 70 landed as `check_definition = {"expect":{"kind":"any"}}` — an auto-pass
placeholder ("reviewer must tighten") — and a handful as garbage shell `grep`
fragments. So the benchmark would report ~91% compliant while checking nothing.

**Already done (partial):** 12 rules authored as real `postgres_sql` SQL checks
(3.1.3, 3.1.7, 3.1.16/17/18, 3.1.20/21/23, 3.2, 4.8, 5.2, 6.8). Garbage greps
reverted to excluded. See these as the pattern to follow.

**Your job: author the remaining ~58 into REAL, runnable checks** so the whole
benchmark is genuine. For each rule:

1. Read its `audit_steps_text` / `_audit_excerpt` (the CIS audit procedure is
   already there — you are compiling it, not researching from scratch).
2. Classify and author:
   - **DB-config rules** (pg_settings values, e.g. section 3.1 logging, 5.x
     connection, 6.x TLS/runtime params) → `postgres_sql` runner, `{sql, expect}`.
     Runner supports `expect.kind`: `row_count_zero|nonzero`,
     `first_value_equals|contains|regex` (see `_evaluate_sql_row` in
     `runners/extended_runners.py`). Use `SELECT setting FROM pg_settings WHERE name=...`.
   - **Catalog/permission rules** (roles, RLS, extensions, DML/function grants,
     accounts-with-passwords, connection limits) → `postgres_sql` SQL against
     `pg_roles`, `pg_extension`, `information_schema`, `pg_hba_file_rules`, etc.
   - **OS-level rules** (systemd enabled, file-permission masks, PGPASSWORD in
     profiles, command history) → these assume PostgreSQL-on-Linux and do NOT
     apply to a Windows-hosted instance. Mark them so they are **not-applicable**
     when the host is Windows, and run via `linux_ssh` (against the host) when the
     host is Linux. Do NOT leave them as silent auto-pass.
   - **Genuinely manual rules** (e.g. "understand attack vectors", policy items)
     → use the `manual` runner with an explicit attestation state, NOT auto-pass.
     A manual rule must read as "requires attestation", never as "passed".
3. Preserve `pass_message` / `fail_message` so results are legible.
4. Set `review_status='approved'`, `auto_generated_check=false`, tag authored rows
   (e.g. `"_authored":"cis-pg18"`) so they're auditable.

**Important library-wide note:** this same hollow-benchmark problem exists across
ALL the AI-ingested benchmarks (every Cisco/FortiGate/F5 network benchmark, all
AWS/Azure/GCP/Alibaba/GitHub cloud benchmarks, and the other DB benchmarks —
MySQL/MSSQL/Oracle/MongoDB) — they are ~100% `expect:any`. The Windows/Linux OS
benchmarks are genuinely authored and verified. **Ask me** whether to (a) do only
PostgreSQL now, or (b) build a repeatable audit-prose→check compiler and apply it
across the DB benchmarks. Do not silently attempt all 35k rules.

**Verification:** after authoring, run each SQL against the live PostgreSQL on
`127.0.0.1:5433` (ask me for a read-only DB credential — the server requires auth,
it is not trust-open) and confirm each check returns a sane pass/fail, not an error.

---

## 3. TASK B — redesign promotion: click software → set up scan → THEN it becomes an asset

**Current (wrong) behaviour.** In `_host-applications-panel.tsx`, each detected
software row has a **Promote** button that calls `POST /assets/{id}/promote-software`,
which **immediately creates a child ITAsset**. So the asset exists before any
scan credential is provided, and it lands in inventory as a shell.

**Desired behaviour** (mirror the discovery gate — a thing becomes an asset only
after a credential proves it can be scanned):

1. The software list is a suggestion surface. Clicking a **row** (no "Promote"
   button) opens a **sidebar or popup** for that software.
2. The panel states: *"We have a CIS benchmark for this software (N rules). Set it
   up to bring it into inventory and scan it."* Show the benchmark name + real
   rule count (from `strict_matcher`, i.e. after excluding any/TODO).
3. A **"Set up (agentless)"** action opens the credential form for that product —
   for PostgreSQL that is the existing SqlDbForm in
   `admin/integrations/connect/page.tsx` (host/port/database/user/password).
   Reuse it; do not rebuild it.
4. On save, validate the credential (test-connect). **Only on success** do we:
   create the child ITAsset (`parent_asset_id`=host, `asset_role='application'`,
   inherit location/business context, run `software_profiler` for its attributes,
   register the DB IntegrationConnection), mark the software entry
   `promoted_asset_id`, and add it to IT Asset Inventory as a proper asset.
5. If the operator cancels or the credential fails, **no asset is created** — the
   software stays a suggestion.

So the flow becomes: **detected software → (click) → "benchmark available, set up"
→ enter agentless credentials → validated → becomes a scannable asset in inventory.**
Promotion without a working scan credential should no longer create inventory.

Design choices to confirm with me before building:
- Should software with **no** benchmark be clickable at all (offer "track anyway"
  for licence/lifecycle), or only benchmarked software?
- Sidebar vs modal.
- Should the child asset be created at credential-save, or only after the FIRST
  successful scan? (I lean: at successful credential validation.)

---

## 4. Model enrichment expectation (from the user, applies to both tasks)

When a host is scanned, its software is already collected AND deep-profiled
(`software_profiler` writes `attributes` per software entry — for PostgreSQL:
service name/state/account, install path, listen port). When that software becomes
an asset, its model must be populated from what was ALREADY collected on the host
scan (no second manual entry). The application asset page must render its OWN
properties, not the host's hardware. This is largely built (`app_attributes_json`,
application-shaped layout in `assets/[id]/page.tsx`); verify it holds for every
product you author, and that OS-only fields (OS family/edition/build, CPU/RAM/disk,
manufacturer/model/serial) stay hidden on application assets.

---

## 5. Other outstanding items (fix opportunistically or ask about priority)

1. **macOS misclassified as Windows.** Port-based classification tags a MacBook
   (SMB 445) as Windows (see the discovered-devices list; e.g. MACBOOKAIR-2E1F).
   Classify macOS separately (hostname hint + ports 22/548) and route it to the
   SSH/agent path; 9 CIS macOS benchmarks exist.
2. **Compliance overview buckets applications under "Windows hosts"** because it
   groups by `os_family` (the app inherits the host's for scan routing). Bucket by
   `asset_role`/benchmark family instead so a PostgreSQL asset shows under Databases.
3. **Parent/child score aggregation is NOT built.** Once app benchmarks are real,
   roll a child's score into the parent. Recommended: parent keeps its own OS score
   AND shows an "effective" score folding in children, worst-case-leaning by
   criticality so a critical child can't be averaged into looking healthy. Show both;
   never a single blended number that hides "OS fine, DB not".
4. **Scan button in the compliance-overview category drill-down**, and **"Open" →
   `/assets/{id}?tab=compliance`** (currently goes to the overview tab).
5. **Edit modal writes `0` for unselected C/I/A** (should be null). Backend already
   treats 0 as unrated, but the modal should stop writing 0.
6. **Duplicate exposure columns**: `internet_facing` (criticality + asset page) and
   `is_internet_facing` (risk posture). Written together at promotion now, but an AI
   risk-posture proposal can still set only one. Collapse to one column.
7. **`status` column keeps a default of `active`** (operational flag, several queries
   filter on it — auditor_portal). `lifecycle_state` default was removed. Decide
   whether `status` should also become explicit.
8. **"Agentless only" badge** logic on the host-applications panel is questionable
   for DBs (a DB on a Windows host could take an agent). Review.
9. The **Nessus/integration sync no longer creates shell assets** (fixed) — it
   matches an existing asset or leaves vulns unlinked. Keep this invariant.

---

## 6. Invariants established this session — DO NOT regress

- A network sweep never creates an ITAsset. Assets are born only from a successful
  authenticated collect (or explicit operator action with a working credential).
- No fabricated defaults presented as data: criticality/CIA/valuation/status/
  lifecycle are null-until-set; scoring reports **n/a** (drops from weighting) for
  unmeasured universes, never 100 ("nothing bad") or 0 ("failed") when nothing was
  measured. `empty=None` is the rule.
- A compliance check never infers a PASS from a command that errored or returned
  nothing (`no_evidence → error`, in winrm_runner and ssh_runner). error ≠ failed.
- Scans exclude `expect:{"kind":"any"}` auto-pass placeholders and `TODO` stubs, in
  BOTH `strict_matcher` and `_do_scan_all`, and in rule-count queries.
- Inventory scoring counts only vulnerabilities/CIS runs linked to CURRENT assets
  (not orphaned/tenant-wide rows).
- Asset delete detaches evidence (CIS runs, observations, criticality items) and
  purges pure link rows across ~23 FK tables; children are detached, not cascaded;
  failures surface as 409, never a silent 500.
- Benchmark selection is deterministic and never picks ARCHIVE/junk over a current
  version (`_rank_benchmarks` in software_normaliser).
- Runner types match protocol (postgres→postgres_sql, mssql→mssql_sql, cisco→
  netdev_ssh, etc.) — ~2,523 rows were repaired; don't reintroduce mismatches.

---

## 7. Working method (the user insists on this)

- **Ask before assuming.** Confirm the design choices flagged above first.
- **No demo/mock/placeholder data as a deliverable.** Everything must be real and
  wired to the backend. The user has repeatedly rejected fabricated values.
- **Verify against reality, not the surface.** Read the actual `check_definition`,
  run the actual SQL, query the live DB — do not trust a rule count or a UI number.
  When you claim a check works, prove it against the live PostgreSQL / host.
- Restart the backend after `.py` edits; `tsc --noEmit` after `.tsx` edits.
- Make expert (senior GRC / security-engineering) decisions and explain trade-offs;
  don't hide a judgement call inside a default.
