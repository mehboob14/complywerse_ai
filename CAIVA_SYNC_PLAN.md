# Cybersecurity Assurance sync — plan and report

Branch: `feat/cyber-assurance-caiva-sync` on mehboob14/complywerse_ai. Nothing here was
deployed: no production server or database was touched.

## 1. Base branch

Base = **`scf-control-plane` with `main` merged in**.

- `scf-control-plane` is what Mehboob's team runs (both prod boxes) and is 404 commits
  ahead of `main` (vendor risk, governance, departments, audit, permission guards...).
- `main` has 16 commits `scf-control-plane` lacks: the Sep-28 pentest mirror series and
  the SBP removal (`cca92c98`). `git merge-tree` showed they merge cleanly.
- So this branch = scf-control-plane + main + the sync. A later merge into
  scf-control-plane is a fast-forward or near-trivial; merging into `main` brings
  scf-control-plane with it (that reconcile was already owed).

## 2. What the payload is

The cyber product (source repo hasanshahidd/AVA) was last mirrored into ComplyVerse at
its commit **`fb83599`** (Sep 28, "exploit poll survives multi-worker job store" =
ComplyVerse `be222d01`). The payload is `fb83599..d4ee03d` (origin/main, Nov 1):
638 commits, 568 files.

Method: a **three-way merge per file** — base = product@`fb83599`, theirs =
product@`d4ee03d`, ours = ComplyVerse now. Only the product's own changes are applied,
as hunks, so every ComplyVerse-side edit survives. For the frontend, base and theirs are
first put through the Sep-17 clone recipe (path → `cyber-assurance` namespace, `@/x` →
`@/cyber-assurance/x`, navigation links → `/cyber-assurance/...`, never API paths) and
the rebrand; the recipe reproduces 178 of the 217 files ComplyVerse already has
byte-for-byte, the rest are real ComplyVerse edits.

## 3. File map

| Area | Port | Adapt / note | Skip |
|---|---|---|---|
| Frontend namespace | 104 new files, 29 fast-forwards, 12 clean merges, 14 hand-resolved | see §4 | `SbpInventoryPanel` |
| Sidebar (`components/layout/navAccess.ts`) | Owner's layout: after Issue & Incident Management → **IT Asset** (Discovery, Inventory, Licenses, Risk Posture, Connectors) → **Cybersecurity** (Vulnerabilities, Advisories, AI Pentest) → **Help Desk** (Agent Console / Service Desk Admin / End-user Portal) → **Reports** (+ Cyber Reports) → Auditor Portal | Scanning lives inside Vulnerabilities (`/cyber-assurance/scan-flows` still resolves) | the product's Performance dashboard (ComplyVerse has its own; the route still works) |
| Backend `grc/` | 116 new files (help desk 38, pentest 20, advisories 17, connectors 6, license mgmt 6, report scheduler 6, estate overview 3, ...), 36 fast-forwards, 21 clean merges, 13 hand-resolved | see §4 | `modules/sbp_inventory/*` |
| Endpoint agent | Go source in `agent/`, API `routers/agents_router.py` | mounted at **`/endpoint-agents`** (ComplyVerse's native collector owns `/agents`; both use `grc_compliance_agents`) | — |
| Tooling | 16 pentest lane Dockerfiles, pentest-engine router/config, `backend/run-worker.sh`, `backend/scripts` (backfill, enrich sweep, benchmark-mapping reconcile), `deploy/systemd/README.md` | `run-worker.sh` no longer hard-codes `/root/AVA` | — |
| Product-only scaffolding | — | — | tenant seed, root `backend/main.py` `/grc` mount, `.env`, `_deferred_stage5_attack_pipeline/`, Frappe `helpdesk-sidecar/`, product planning docs (`docs/`, `*.md` at root) |
| ERM | — | not touched (ComplyVerse's is the full module) | product's ERM slice |
| PCI | per-asset PCI scope toggle + dashboard lens come with the inventory/dashboard pages | — | the big SCF-requirements PCI module (it is not in the product either) |

## 4. Decisions made while merging

- **Admin page** (`/cyber-assurance/admin`): the product's single *Connectors* tab
  replaces Integrations / Cloud / Connectors / Evidence collectors / Identity; old
  `?tab=` links land on Connectors. Mehboob's org **Departments** tab stays (Teams
  folded into it); the product's help-desk Departments page was not brought over that
  page — help desk departments stay in Help Desk settings.
- **Assets page**: product's Overview landing + row-actions menu, plus Mehboob's
  Settings view (custom fields) as a menu item.
- **Finding detail**: product's Affected assets + Assignment + Help Desk link cards,
  plus ComplyVerse's audit tags and custom-fields card.
- **Pentest page**: the product replaced the 2,785-line page with the run hub; taken,
  with ComplyVerse's `PermissionGuard` kept.
- **Risk posture workspace**: product's rebuilt page; its apex/subdomain roll-up
  supersedes ComplyVerse's earlier subdomain-nesting tweak.
- **Connectors page**: union — product's EDR / Identity categories, bundled logos and
  cloud providers + ComplyVerse's security-rating / SaaS-discovery / web-gateway
  categories; internal providers (help desk engine) are hidden from customers.
- **Auth** (`require_permission`): ComplyVerse's `has_tenant_permission` kept; the
  product's idle-session enforcement added in front of it.
- **Compliance runs**: product's `_finalize_run()` refactor (reused by agent results)
  + Mehboob's per-control `record_check_results` moved inside it.
- **Reporting**: product's tenant-scope on the grand-total query added to
  ComplyVerse's filter call (data isolation fix).
- **Audit log**: the product's `audit_capture` field-diff listener was **not** ported —
  ComplyVerse's `audit_changes` already records old → new; both would double-capture.
  The product's audit-noise filters (password-policy polls, help desk / admin
  resource ids, login actor) were kept.
- **Permissions**: `helpdesk` and `pentest` modules added to the Roles matrix
  (the pentest gates fail open until a tenant grants any `pentest:*`).
- **Router wiring** (`grc/main.py`, ComplyVerse's file kept): estate overview,
  licenses, report schedules, advisories, help desk, endpoint agents; help desk boot
  heal on startup.

## 5. Branding

No CAIVA / Ava / Kaiva text visible to users. Rules: CAIVA / CAIVA.IO / AVA → ComplyVerse,
Ava → Complyverse (the spelling the namespace already used), "… Assist" → ComplyChat,
`ava_scanner` placeholders → `complyverse_scanner`, DNS proof
`ava-site-verification` → `complyverse-site-verification`, CMDB CI codes `AVA-…` → `CV-…`,
Discovery explainer sentences, scanner-side scan names ("ComplyVerse pentest <host>").

Endpoint agent (installer scripts customers run, Go binary, services):
`complyverse-agent` binary / `/opt/complyverse-agent` / `/etc/complyverse-agent`,
Windows service `ComplyVerseAgent`, macOS `io.complyverse.agent`, env
`COMPLYVERSE_URL / _ENROLL / _TENANT / _ONCE`, API `/api/endpoint-agents/*`.

Left as internal identifiers (not visible): pentest lane image names (`ava-web-scan`, ...),
the env names the backend injects into those containers (`AVA_SMB_USER`, ...), server env
knobs (`AVA_EXPLOIT_SCOPE`, `AVA_REDIS_URL`, ...), Celery task names, the CMDB data key
`attributes.ava`, localStorage keys.

## 6. Database

ComplyVerse creates tables with `create_all` per tenant and never adds columns.
`backend/scripts/migrate_cyber_assurance_sync.py` is the one migration:

- loops every tenant in `grc_master.grc_tenants` (falls back to `grc_%` databases),
  never touches `grc_master`;
- creates the new tables when missing, `ADD COLUMN IF NOT EXISTS` for each missing
  model column (nullable, with the model's scalar default), widens VARCHAR → longer /
  TEXT where the model asks; reports anything else; never drops or narrows;
- `--dry-run` prints the plan, `--tenant <slug>` limits it.

```
cd backend
python scripts/migrate_cyber_assurance_sync.py --dry-run
python scripts/migrate_cyber_assurance_sync.py
```

Run it after pulling the branch and before (or right after) restarting the backend.

Local DB (`grc_complyverse`, the one tenant in the local registry; backed up first to a
pg_dump outside the repo):

- cyber scope, run 1: **76 tables created** (help desk `grc_hd_*`, license entitlements +
  assignments, pentest runs / run assets / run findings, scheduled reports), **13 column changes** — `grc_it_assets.credential_profile_id`,
  `grc_compliance_agents.allowed_domain`, `grc_pentest_exploit_results.run_id /
  exploit_status / kill_chain / attack_narrative`, `grc_pentest_scan_jobs.run_id`,
  `custom_values` on assets / vulnerabilities / audit plan entries, and widenings
  `grc_asset_security_compliance_selections.control_id → VARCHAR(512)`,
  `grc_vulnerabilities.cvss_vector / nvd_cvss_vector → VARCHAR(255)`; 0 failures.
- run 2: 0 tables, 0 changes (idempotent).
- `--all-tables` on the local DB found 58 more tables / 180 columns from
  scf-control-plane's own modules (governance, controls, access reviews, vendor risk,
  KRIs...) that this local DB had never received; applied (0 failures), then re-run → 0.
  **Prod tenants may be in the same state** — run `--all-tables --dry-run` there first.

Seed libraries: the local tenant already holds the CIS library (31,553 rules) and 155
benchmark-OS mappings. Help Desk seeds itself (statuses, priorities, SLA, roles,
departments) through `itsm_seed.run_boot_heal()` on startup. Advisories have no seed
(bulletins are uploaded or synced). `backend/scripts/reconcile_benchmark_mappings.py`
(the product's Win10-gets-Win11 fix) is included; run it `--dry-run` per tenant.

## 7. Security

- **The postcss malware loader is back on every ComplyVerse branch.** `main` got it
  again in `be222d01` (Sep 28, the commit after the fix) and `scf-control-plane` in
  Mehboob's `df4fab45` (Oct 29), which also rewrote the `.migration-backup` copy —
  the pattern of the self-propagating loader running on that machine. This branch
  strips both copies (`d6cbaddf`) and re-strips after merging `main` (the merge took
  main's infected copy because our side matched the merge base).
- `grc-frontend/scripts/guard-postcss.js` runs before `dev`, `build` and `start` and
  aborts if postcss.config.js is not exactly the clean config, or if postcss /
  next.config.js / tailwind.config.ts / the .migration-backup copy contain loader
  markers, a line over 1,500 chars or a 200+ whitespace run. Verified: passes on this
  tree (every build/start log shows "4 config file(s) clean"), fails on the real
  infected file from `origin/scf-control-plane`, on a padded `global.o=` copy, on a
  modified postcss and on a `_$_xxxx` marker.
- **Pre-commit gate** (the product's `d32cd49`, one detection source): `guard-postcss.js
  --staged` + `.githooks/pre-commit` block committing an infected `*.config.{js,mjs,cjs,ts}`.
  Enable per clone: `git config core.hooksPath .githooks`. Verified: the hook exits 1 on a
  staged copy of the real infected file (unstaged and deleted afterwards).
- **Pentest RBAC** (the product's `0cc4db1`, `f18f877`, `e616ce7`):
  - scan / exploit gates are fail-closed (they used to allow any signed-in user until a
    tenant granted a pentest permission); `/runs/{id}/classify` is gated too;
  - every `/pentest` endpoint, reads included, needs `pentest:workspace:view` (ComplyVerse
    had gated reads on the vulnerability register's view right);
  - `DELETE /pentest/runs/{id}` needs `pentest:exploit:execute`;
  - Administrator and the primary contact always pass; the five `pentest:*` permissions
    are in Admin → Roles (rows are created on first grant). Sidebar entry + page guard use
    `pentest:workspace:view`.
  - Verified locally: admin 200 on `/pentest/runs` + `/pentest/fleet`; user with no role
    403 on both; user with only `pentest:workspace:view` 200 on GET `/runs`, 403 on DELETE
    (admin 404 — gate passed, run absent; the temporary role was removed).
- No `node -e` beacon or connection to the C2 IP on this PC at the time of the check.

- **Estate overview** (the product's `216a6ae`): `/estate-overview` needs
  `assets:asset_inventory:view` (it was open). The other half of that commit (exec
  dashboard) was already closed in ComplyVerse on the vulnerability register's view right;
  kept, because that is who can open the cyber pages here.
- **Admin** (the product's `76cc40e`): nothing to port — ComplyVerse's own
  `PUT /admin/password-policy` and `GET /admin/roles/{id}/members` already check
  `admin:settings:edit` / `admin:roles:view` in the handler (admin router not touched).
- Audit redaction gained the product's SNMP-community / passwd / access_key substrings.

## 8. Verification (all local, nothing deployed)

- **Backend**: `grc.main` imports cleanly (2,995 routes; the only duplicate routes are 5
  that already exist on scf-control-plane). Logged in as a local Administrator, 19 cyber
  endpoints return 200 (advisories, licenses, report schedules, estate overview, endpoint
  agents, help desk tickets + dashboard data, pentest runs/fleet, connectors, exec
  dashboard, risk posture, vuln dashboard, assets, reporting datasets, admin permissions).
  A user with no role gets 403 on pentest and help desk.
- **Tests**: 630 tests in 48 test files ported from the product pass; advisories' own 19
  pass; nav tests 5/5. 22 product test files were left out (they need the product's
  SQLite fixtures, assert its exact connector list, or test the fail-open gate this branch
  closed) + 2 that test the dropped Frappe help desk.
- **Frontend**: `npm run build` succeeds (guard first). `tsc` reports 115 errors across the
  app, almost all in ComplyVerse's own non-cyber pages and present before this branch (the
  build sets `ignoreBuildErrors`); in the cyber namespace they are upstream typing noise
  (Map/Set iteration without downlevelIteration, recharts formatter types) except one real
  one I fixed (missing `Crosshair` import).
- **Browser** (production build, `complyverse.localhost:3000`, signed in as the local
  admin): Performance dashboard, IT Asset Inventory (Overview + register), Discovery, CIS
  benchmark, Vulnerability Register, Risk Posture, AI Pentest hub, Licenses, Help Desk
  dashboard + tickets, Advisories, Cyber Reports all render with no failed API calls.
  One bug found and fixed on the way (help desk dashboard cards sent `?type=`, the API
  wanted `dashboard_type` → 422; upstream has the same bug).
- **Branding**: added lines in the diff contain no visible CAIVA / Ava / Kaiva text; the
  remaining `ava` matches are internal identifiers listed in §5.

## 9. Salvaged from the old OneDrive clone (`Desktop\GRC 1\complywerse_ai`)

Read-only inspection of its never-pushed commits and stashes:

- taken: `b7ce69c1` (roll back the session when a seed script fails) and `a22ba312`
  (dry-run-by-default cleanup script for vulnerability rows orphaned by old imports).
- not needed: `cee63d73` (an older local pentest port — superseded by main and by this
  sync; it also carried SBP), `ed10d2ab` (planning docs + HTML mockups), `e5de1747` (a
  merge), stash 0 (superseded: ComplyVerse already has `connection_matcher`), stash 1
  (tsbuildinfo), stash 2 (labelled DISCARD), stashes 3–4 (June PDPL WIP on files since
  rewritten).

The folder can be deleted once this branch is on GitHub.

## 10. Known gaps

- The Go endpoint agent is ported as source; binaries are built at deploy time into
  `AVA_AGENT_DIST` (default `/root/ComplyVerse/agent-dist`, files
  `complyverse-agent-{linux,windows.exe,...}`). No Go toolchain here, so not compiled.
- Pentest lanes need their Docker images built on the target box
  (`external-tools/lane-images`) and the Celery worker (`backend/run-worker.sh`) for
  batch runs; single-asset runs work in-process.
- The local dev mount (`grc_dev_server`) doesn't fire the app's startup hooks, so locally
  the help desk boot heal was run once by hand; on a server running `grc.main:app`
  directly it runs on startup.
- `/advisories` is sign-in-only (same as upstream) — no permission gate yet.
- ComplyVerse's own pages that reuse the namespace's `AssetModal` (native assets page,
  PCI/HIPAA inventory tabs) now get a type mismatch on `AssetType` (the product added
  values). Runtime is fine (same backend); typing only.
- `vulnerabilities/dashboard` sub-page calls a `getDiscoveryTrend` API method that
  doesn't exist upstream either.

## 11. Needs a decision (Mehboob / owner)

1. **The malware loader is on every remote branch, including `main` and
   `scf-control-plane`** (re-injected Oct 29 by `df4fab45`). This branch is clean, but
   anyone who builds main / scf-control-plane runs it, and the commit pattern says the
   machine that made `df4fab45` is infected. Owner/Mehboob: clean those branches, check
   that machine and both prod boxes (look for `node -e` processes), rotate secrets.
2. Pentest is now **fail-closed on `pentest:workspace:view`**: non-admin users who saw AI
   Pentest via the vulnerability register's right need the new permission granted in
   Admin → Roles.
3. Run the migration with `--all-tables --dry-run` on each prod tenant before deciding
   whether to apply the non-cyber catch-up too.
4. Merge target: this branch already contains `main`; merging it into
   `scf-control-plane` should be clean.

## 12. Summary for the owner (plain language)

ComplyVerse now has everything the cyber product built since late September: the new
asset inventory and discovery, CIS dashboards, the vulnerability register with scanning
and advisories, the new AI pentest (runs, gates, exploit evidence), endpoint agents, the
unified connectors page with real vendor logos, license management, the native help
desk, and the cyber report builder. They sit in the sidebar the way you asked (IT Asset,
Cybersecurity, Help Desk, Reports), branded ComplyVerse everywhere. The database script
adds the new tables and columns safely and can be run twice without harm. Everything was
built and clicked through on this PC only; nothing was deployed. Before anyone builds
`main` or `scf-control-plane`, that malware file must be cleaned there too.
