# CHANGES — IT-Assets module update

Every change in this round, grouped by the four focus areas. For each file the
**live path** (under `project/`) and the **quickref copy** are both given.

Legend:  **NEW** = file added this round · **MOD** = existing file modified.

---

## 1 · IT Assets

### `_host-applications-panel.tsx` — **NEW** (928 lines)
Live: `project/artifacts/grc-frontend/src/app/(dashboard)/assets/[id]/_host-applications-panel.tsx`
Quickref: `updated-pages-quickref/1-it-assets/_host-applications-panel.tsx`

The "room-and-chair" panel shown on an asset's **Compliance** tab. It groups all
assets that share a host (same IP) and shows the composite CIS posture.

- **IP-group composite score** — host OS contributes 60%, applications the
  remaining 40% weighted by criticality. Header card shows OS-host score, blended
  effective score, and the **weakest link**.
- **Configure weights** editor — per-app composite weights are editable and
  persisted (wired to the new backend composite-weight endpoints).
- **CO-LOCATED ASSETS list** — rewritten into one clean single-line row per app
  after several rounds of "this is messy" feedback. Each row shows:
  - app name + `this asset` / `host OS` markers,
  - a **clickable criticality badge** (`CritBadge`) → popover with an
    **auto-generated justification** (per app category) and the composite weight,
  - the **real benchmark name** (e.g. `CIS_Microsoft_SQL_Server_2022_Benchmark…`),
    truncated, **clickable** → deep-links to that asset's compliance page,
  - rule count, and a score bar **or** an amber **"Not scanned"** pill,
  - context actions: **View** / **Scan now** / **Set up scan** / **Agentless only**.
- **`AgentlessNote`** — click-to-reveal popover explaining *why* an app is
  agentless-only, generated from the app category (MSSQL, Oracle, Tomcat, IIS,
  nginx, …) so it works for any future app type, not a hardcoded list.
- **`CRIT_REASON` / `AGENTLESS_REASON` maps + `appCategory()`** — map an app by
  name/`os_normalized` to a category, then to its criticality justification and
  agentless explanation. Falls back to a generic description for unknown apps.
- **Removed** the old "Agent-detected applications" box and the duplicated
  "HOW EACH APP AFFECTS THIS SCORE" / "CO-LOCATED ASSETS" sections — merged into
  the single list above.

### `assets/[id]/page.tsx` — **MOD** (+200)
Live: `project/artifacts/grc-frontend/src/app/(dashboard)/assets/[id]/page.tsx`
Quickref: `updated-pages-quickref/1-it-assets/asset-detail.page.tsx`
- Mounts `HostApplicationsPanel` on the **Compliance** tab.
- CIS-compliance header card (group-effective %, host %, weakest link, "Full
  risk posture →" link); CIA ratings, control-coverage, valuation tiles.

### `assets/page.tsx` — **MOD** (+176)
Live: `project/artifacts/grc-frontend/src/app/(dashboard)/assets/page.tsx`
Quickref: `updated-pages-quickref/1-it-assets/asset-list.page.tsx`
- Asset inventory list updates (grouping/columns/filters) feeding the detail page.

### `assets_router.py` — **MOD** (+804)
Live: `project/.migration-backup/backend/grc/routers/assets_router.py`
Quickref: `updated-pages-quickref/1-it-assets/assets_router.py`
- **`GET /assets/{id}/ip-peers`** — returns the IP group: each member with
  `name, asset_type, os_normalized, criticality, benchmark_name,
  benchmark_available, rule_count, score, is_host_os, is_self`, plus the
  `composite` (with `app_contributions`: `asset_id, name, score, weight,
  criticality, os_normalized`) and the scoring `formula`.
- **Composite-weight endpoints** — `GET / PUT / DELETE /assets/composite-weights`
  to read, override, and reset per-app weights used by the panel.
- `app_contributions` now carries `os_normalized` so the UI can categorise apps.

---

## 2 · CIS / Compliance Plugins

### `compliance_plugins/router.py` — **MOD** (+219)
Live: `project/.migration-backup/backend/grc/modules/compliance_plugins/router.py`
Quickref: `updated-pages-quickref/2-cis-compliance/compliance_plugins_router.py`
- Endpoints behind the per-asset CIS dashboard and benchmark selection.

### `services/agentless_inventory.py` — **NEW**
Quickref: `updated-pages-quickref/2-cis-compliance/agentless_inventory.py`
- Agentless WinRM/SSH inventory: connect to a host, enumerate installed
  software, and surface candidate apps to promote to child assets.

### `services/os_detector.py` — **NEW**
Quickref: `updated-pages-quickref/2-cis-compliance/os_detector.py`
- Detects/normalises a host's OS so the right CIS benchmark family is chosen.

### `services/benchmark_matcher.py` — **NEW**
Quickref: `updated-pages-quickref/2-cis-compliance/benchmark_matcher.py`
- Matches a detected app/OS to the correct uploaded CIS benchmark
  (`benchmark_name`), driving the "real benchmark name" shown in the panel.

### Other CIS service files — **NEW**
(All under `project/.migration-backup/backend/grc/modules/compliance_plugins/services/`)
- `ai_os_normaliser.py`, `ai_benchmark_router.py`, `ai_mapping_suggester.py`,
  `software_normaliser.py`, `strict_matcher.py`, `scope.py` — AI-assisted and
  rule-based helpers for OS normalisation, benchmark routing, and scoping.

### `services/credentials.py` — **MOD** (+71) · `services/run_service.py` — **MOD** (+25)
- Credential handling for scans and run orchestration / result write-back.

### `pdf_ingest/pipeline.py` — **MOD** (+191) · `pdf_ingest/gen_check.py` — **MOD** (+25)
- Benchmark PDF ingestion → generated check rules.

### Frontend CIS pages — **MOD**
- `compliance-plugins/_assets-panel.tsx` (+29) — quickref `2-cis-compliance/_assets-panel.tsx`
- `compliance-plugins/asset/[id]/page.tsx` (+28) — quickref `2-cis-compliance/cis-asset-dashboard.page.tsx`
- `compliance-plugins/library/page.tsx` (+29) — quickref `2-cis-compliance/cis-library.page.tsx`

---

## 3 · Risk Posture

### `risk-posture/asset/[id]/page.tsx` — **MOD** (+1030)
Live: `project/artifacts/grc-frontend/src/app/(dashboard)/risk-posture/asset/[id]/page.tsx`
Quickref: `updated-pages-quickref/3-risk-posture/risk-posture-asset.page.tsx`
- The per-asset risk page — the biggest single change in this round. Business
  context, effective-risk breakdown, and the roll-up of CIS scan scores into the
  asset's posture. Updates on-demand when navigated to after a scan.

### `risk-posture/page.tsx` — **MOD** (+74)
Quickref: `updated-pages-quickref/3-risk-posture/risk-posture-list.page.tsx`
- Risk-posture list/overview.

### `risk_posture/service.py` — **MOD** (+262) · `risk_posture/router.py` — **MOD** (+202)
Quickref: `3-risk-posture/risk_posture_service.py`, `risk_posture_router.py`
- `GET /risk-posture/asset/{id}` computes effective risk on demand from the
  group's scan scores (no caching → always fresh after a scan).

### `risk_posture/effective_risk.py` — **NEW** · `risk_posture/external_feeds.py` — **NEW**
Quickref: `3-risk-posture/effective_risk.py`
- Effective-risk computation and external threat-feed inputs.

---

## 4 · Agents / Connect Wizard

### `ConnectWizard.tsx` — **MOD** (+110)
Live: `project/artifacts/grc-frontend/src/pages/ConnectWizard.tsx`
Quickref: `updated-pages-quickref/4-agents-connect/ConnectWizard.tsx`
- **Back-navigation fix** — all wizard navigations use `navigate(path,
  { replace: true })` so wizard steps don't pile up in history; pressing Back no
  longer jumps straight to the dashboard. `ConnectedSuccessWithScope` updated to
  accept and pass the `{ replace }` option.

### `ConnectMethodPicker.tsx`
Quickref: `updated-pages-quickref/4-agents-connect/ConnectMethodPicker.tsx`
- Step-0 agent-vs-agentless chooser for OS-level assets (app assets skip
  straight to agentless). Included for context.

### `connect_wizard_router.py` — **MOD** (+488)
Quickref: `updated-pages-quickref/4-agents-connect/connect_wizard_router.py`
- Backend for the Connect Wizard: credential capture, preflight, scope, and
  kicking off the first scan.

### `agents/router.py` — **MOD** (+120) · `agents/security.py` — **MOD** (+7)
Quickref: `updated-pages-quickref/4-agents-connect/agents_router.py`
- Agent enrollment, heartbeat, and the promote-detected-software flow. The
  promote path returns `{ created, skipped: [{reason:'already promoted', …}] }`
  so the UI can warn on duplicates instead of failing silently.

### Agent software inventory — **NEW**
Quickref: `4-agents-connect/agent_inventory_windows.py`, `agent_inventory_linux.py`
- Agent-side scanners that enumerate installed software on Windows/Linux during
  an OS scan, feeding the detect-and-promote flow.

---

## 5 · Shared (used across the areas above)

- `lib/api.ts` — **MOD** (+22) — added `getCompositeWeights`,
  `updateCompositeWeights`, `resetCompositeWeights` plus the ip-peers typing.
  Quickref: `5-shared/api.ts`
- `types/index.ts` — **MOD** — shared types for the above.
  Quickref: `5-shared/types-index.ts`
- `grc/models.py`, `grc/schemas.py` — **MOD** — asset / plugin / risk model and
  schema additions backing the new endpoints (live under `project/` only).

---

## Out of scope (changed in the repo but NOT part of this IT-Assets round)

These were touched in other work and are present in `project/` only so the app
builds; they are **not** part of this handoff's focus and aren't documented here:
`workflow-engine/*`, `chatbot/complychat/*`, `audit_ai_summary.py`,
`AppLandingPage.tsx`, `Sidebar.tsx`, top-level `App.tsx` / `layout.tsx`.
