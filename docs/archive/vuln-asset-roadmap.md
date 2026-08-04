# Vulnerability & Asset Management Modernization — Roadmap

> **Status legend:** ✅ shipped · 🚧 in progress · ⏭️ not started · 🧊 deferred (scoped but not active)

This document tracks the multi-phase enhancement of the Vulnerability + Asset
modules. It is the single source of truth for *what has been built* vs *what is
planned next*. Each phase has its own implementation notes that link back to
the files that actually changed in the repo.

The original plan came from a strategic review and is preserved here in its
entirety so the rationale isn't lost when individual phases land.

---

## Shipped baseline (Phases 1–4)

Already in the repo from earlier work. The roadmap below builds on top.

| Phase | Status | Notes |
|---|---|---|
| 1 — Vulnerability schema columns (EPSS, KEV, NVD, composite) | ✅ | `backend/grc/models.py` `Vulnerability` rows have `epss_score`, `epss_percentile`, `kev_flag`, `kev_date_added`, `nvd_published_at`, `nvd_last_modified_at`, `nvd_last_synced_at`, `exploit_references`, `composite_priority`. |
| 2 — Enrichment service (NVD / EPSS / KEV) | ✅ | `backend/grc/modules/vuln_management/enrichment/` — `nvd_client`, `epss_client`, `kev_cache`, `priority`, `enrichment_service`. Redis-cached NVD with 7-day TTL. |
| 3 — On-demand + bulk enrichment endpoints | ✅ | `POST /vuln-management/vulnerabilities/{id}/enrich` and `POST /vuln-management/vulnerabilities/enrich-all`. |
| 4 — Celery beat daily refresh + ingest hooks | ✅ | `grc.tasks.vulnerabilities.daily_refresh` + dispatch hooks in Nessus/Nexpose sync and NCA vuln bridge. New `celery-beat` service in `docker-compose.staging.yml`. |
| Frontend — KEV badge, EPSS chip, Priority column, Threat Intelligence panel, Enrich button | ✅ | `grc-frontend/src/app/(dashboard)/vulnerabilities/page.tsx` and `[id]/page.tsx`. |

---

## Foundational tracks (cut across all phases)

### Track A — Connector framework — ✅ SHIPPED 2026-05-12 (gap-close: unified surface)

**Gap-close addendum (2026-05-12):**
The platform now has a **unified discovery view** across both connector
tables. Cloud connectors (new framework: AWS / Azure / GCP) and legacy
scanner connections (Nessus / Nexpose, stored in `IntegrationConnection`)
were two separate code paths with separate admin pages. The unified
endpoint `GET /cloud-connectors/unified` returns both kinds in a single
normalised list, and the admin Cloud Connectors page now renders a
**Scanner connections (legacy)** section below the cloud-connector list
with `Legacy` chips and a Manage → link back to the Integrations tab.
The providers picker also advertises Nessus + Nexpose (with a
`framework: "legacy_scanner"` flag + manage hint) so admins see every
provider type in one place. Write paths are unchanged — Nessus/Nexpose
rows are still created via the existing scanner UI; no data migration.



A unified pattern for any external system that pushes data into the platform.
Foundation + AWS/Azure/GCP adapters all live now. Adding Red Hat (RHSA) or
Cisco PSIRT in the future is a single new file that subclasses
`CloudConnectorBase` and gets auto-registered.

**Shipped:**
- `CloudConnector` entity (`backend/grc/models.py`) per tenant with
  encrypted credentials blob, sync schedule, health/sync state, audit
  timestamps.
- Symmetric encryption helper (`backend/grc/services/connector_credentials.py`)
  using Fernet keyed off `CONNECTOR_MASTER_KEY` env var.
- Abstract `CloudConnectorBase` + provider registry in
  `backend/grc/modules/integrations/cloud/base.py`.
- Admin CRUD + sync + sync-all + health-check endpoints at
  `/cloud-connectors`.
- Sync orchestrator (`backend/grc/tasks/cloud_sync.py`):
  `sync_cloud_connector` (single), `bulk_sync_for_tenant` (per-tenant
  fan-out), `daily_cloud_connector_fan_out` (beat-scheduled every 6h,
  honors per-connector `sync_schedule_seconds` to skip fresh rows).
- Frontend admin page at `/admin → Cloud Connectors` with provider-aware
  credential template, health check / sync / disable / delete actions, and
  a banner that detects missing `CONNECTOR_MASTER_KEY`.

### Phase 4 (CPE / PURL matcher) — ✅ SHIPPED 2026-05-12 (gap-close pass)

The matcher promised in the original Phase 4 plan but never actually shipped.
Now it does.

**Shipped:**
- `SoftwareIdentifier` model ([models.py](backend/grc/models.py)) — per-asset
  CPE / PURL inventory with parsed `vendor` / `product` / `version` columns
  for cheap LIKE matching. Auto-created via `create_all`.
- `services/cpe_matcher.py` — CPE 2.3 parser, PURL parser, version-tuple
  comparator, NVD range checker (`versionStartIncluding`/`Excluding` +
  `versionEndIncluding`/`Excluding`), `match_cve_to_asset_ids()` entry point,
  `write_auto_links()` idempotent link creator. **9 smoke-test cases pass**
  (parse / version compare / range / wildcard match / range path / exact
  path / vulnerable=false skip / empty configs / cross-product rejection).
- NVD client (`enrichment/nvd_client.py`) now captures `affected_configurations`
  on every CVE pull (cached in Redis like the rest of NVD).
- Matcher auto-runs inside `enrich_vulnerability()` whenever NVD returns
  configs — every CPE-bearing inventory row in the tenant gets checked,
  matching assets get `VulnerabilityAssetLink(link_source="cpe_match",
  auto_linked=True)`.
- Standalone Celery task `run_cpe_matcher_for_vuln` for re-runs after
  software inventory changes.
- Asset detail page exposes CRUD endpoints: `GET/POST/DELETE
  /assets/{id}/software-identifiers` for managing the per-asset inventory.

### Track B — Common normalized data layer — ✅ SHIPPED 2026-05-12

**Gap-close addendum (2026-05-12):**
- `VulnerabilityAssetLink` rows now carry `link_source`
  ∈ `{manual, scanner, cpe_match, cloud_sync, nca_bridge}` and
  `auto_linked` boolean. Populated by every ingest path:
  Nessus/Nexpose sync, NCA UBL bridge, cloud sync (AWS/Azure/GCP),
  CPE matcher, manual link endpoint. Surfaced in the UI as:
  source chip + Auto badge on the asset detail's linked-vulns list AND
  the vuln detail's linked-assets table.
- New asset status `auto_closed_decommissioned` — set by
  `services/asset_lifecycle._auto_close_linked_vulns` when a linked asset
  enters `decommissioned`/`retired`. Included in all five closed-status
  constants (`_LIST_CLOSED_STATUSES` in the router, `RESOLVED_STATUSES`
  in the vuln dashboard, `_CLOSED_STATUSES` in the analytics router,
  `terminal` in both Celery refresh tasks). Stamps `resolved_at` and
  preserves the resolution note.

Every external source funnels through `backend/grc/services/normalized_assets.py`.

**Shipped:**
- `upsert_cloud_asset(...)` — provider-prefixed `cloud_resource_id` as the
  primary dedup key (`aws:ec2:us-east-1:i-0123abc`, `azure:/subscriptions/...`,
  `gcp:projects/.../instances/...`), with fallback to `(host_name, ip_address)`.
  Never merges across clouds.
- `upsert_cloud_vulnerability(...)` — matches by `(tenant_id, cve_id,
  affected_host)` then `(tenant_id, vuln_id)`, auto-generates the
  `VULN-NNNNN` sequence on fresh inserts, idempotently links to the asset
  via `VulnerabilityAssetLink`.
- **Source-of-truth rules enforced in code:**
  - Cloud sync overwrites `name` / `ip_address` / `vendor` / `location` /
    `asset_type` on every run.
  - Manual fields (`primary_owner_id`, `secondary_owner_id`, `owning_team`,
    `escalation_contact_id`, `business_owner_id`, `data_classification`,
    `business_function`, `compliance_scope`, `valuation`, `confidentiality_/
    integrity_/availability_rating`, `custodian`, `description`) are
    members of a `MANUAL_FIELDS` frozenset and never overwritten by sync.
  - `last_seen_at` + `last_seen_source` are always bumped (Phase 5.5).
  - `criticality_score` is recomputed on every upsert via
    `asset_criticality.recompute_for_asset()`.
- **Dedup keys** in priority order, all implemented:
  `cloud_resource_id` (strongest) → `(host_name, ip_address)` (fallback).

### Track C — Background job patterns — ✅ documentation in place

Standardize Celery queue layout and beat-schedule conventions before more
phases pile work onto the workers.

**Shipped:**
- `parsing` queue (existing).
- `celery-beat` container in `docker-compose.staging.yml`.
- 2026-05-12 — Queue inventory documented in `backend/grc/celery_app.py`:
  `default`, `parsing`, `maintenance`, plus the standardized targets
  `enrichment` (Phase 6 + 9), `sync` (Phase 7), `notification` (Phase 8).
  Existing `grc.tasks.vulnerabilities.*` stays on `parsing` until a future
  PR opts it into `enrichment` — no in-flight work was migrated.

**Future (when first Phase 6/7/8 task lands):**
- Spawn `celery-stg-celery-enrichment`, `celery-stg-celery-sync`, and
  `celery-stg-celery-notification` workers in `docker-compose.staging.yml`
  with `-Q <queue>`.
- Structured logging contract: every task logs `tenant_slug`, `task_name`,
  `duration_ms`, `outcome`, `error_class`.
- Per-task-class retry policy: network calls retry 2–3× with backoff;
  data-processing errors don't retry.

---

## Phase 5 — Asset Operational Context — ✅ SHIPPED 2026-05-12

**Goal:** make assets richer so prioritization, ownership, and lifecycle
automation actually work. Today `criticality` is a single text label and
there's no notion of internet-facing, data classification, owner chain, or
lifecycle. This phase is the prerequisite for both better composite priority
(Phase 5.4 feeds into the vuln priority formula) and the cloud sync work in
Phase 7 (which needs lifecycle + last-seen to handle drift).

| Sub-phase | Description | Status |
|---|---|---|
| 5.1 | Exposure metadata — `internet_facing`, `network_segment`, `data_classification`, `business_function`, `compliance_scope` | ✅ |
| 5.2 | Ownership chain — `primary_owner_id`, `secondary_owner_id`, `owning_team` (text), `escalation_contact_id`, `business_owner_id` | ✅ |
| 5.3 | Lifecycle state machine — `lifecycle_state`, `decommissioned_at`, `retirement_reason`, `replacement_asset_id` + state transition helper + auto-close hook | ✅ |
| 5.4 | Derived criticality score (0–10) — weighted from text criticality, data classification, internet-facing, business function. Integrates with composite priority. | ✅ |
| 5.5 | Last-seen tracking — `last_seen_at`, `last_seen_source` + stale flag (>30d) | ✅ |
| 5.6 | Frontend — Operational Context / Ownership / Lifecycle panels on asset detail + list filters (lifecycle, data classification, stale only) + lifecycle transition modal | ✅ |
| 5.7 | Permissions — gated through existing `assets:asset_inventory:edit`/`delete` until per-feature grants are introduced. Lifecycle button respects `canEdit`. | 🧊 deferred (gated on existing permission for now) |

**Where it lives:**

| Layer | File |
|---|---|
| Model | `backend/grc/models.py` — `ITAsset` (added 17 columns + 5 indexes + 5 relationships) |
| Migration | `backend/grc/modules/compliance/schema_migrations.py` — appended 17 idempotent entries |
| Services | `backend/grc/services/asset_criticality.py`, `backend/grc/services/asset_lifecycle.py` |
| Pydantic | `backend/grc/schemas.py` — extended `ITAssetBase`, `ITAssetCreate`, `ITAssetUpdate`, `ITAssetResponse`, `AssetDetailResponse` + new `LifecycleTransitionRequest` |
| Router | `backend/grc/routers/assets_router.py` — extended create/update/list/get/detail + new `POST /assets/{id}/lifecycle-transition` |
| Priority integration | `backend/grc/modules/vuln_management/enrichment/priority.py` (new numeric path), `enrichment_service.py` (new `_resolve_asset_criticality_score` helper) |
| Ingest hooks | `backend/grc/modules/integrations/services/sync_service.py` — bumps `last_seen_at` + `last_seen_source` on every Nessus/Nexpose sync, defaults `lifecycle_state` for new rows |
| Frontend types | `grc-frontend/src/types/index.ts` — extended `ITAsset` + `AssetDetail`, new `LifecycleState` and `DataClassification` literal types |
| Frontend API | `grc-frontend/src/lib/api.ts` — `getAll` takes filter params, new `transitionLifecycle` helper |
| Frontend list | `grc-frontend/src/app/(dashboard)/assets/page.tsx` — Lifecycle + Data Classification dropdowns + Stale-only toggle |
| Frontend detail | `grc-frontend/src/app/(dashboard)/assets/[id]/page.tsx` — 3 new Detail cards (Operational Context, Ownership Chain, Lifecycle & Threat Score), Lifecycle button + `LifecycleTransitionModal`, EditAssetModal fieldset for Phase 5 fields |

**Non-breaking guarantees verified:**
- Every new column is nullable with a sensible default. Existing assets keep
  working with zero backfill — the dashboard counts, coverage analysis, and
  legacy `status` column are untouched.
- Composite priority calculation falls back to the existing text
  `criticality` mapping when `criticality_score` is NULL — so vulns on
  un-enriched assets prioritize exactly as they do today. Verified by smoke
  test: numeric path produces 9.81 for Log4Shell, text path produces 9.83 —
  within bucket tolerance, no SLA shift.
- Migration uses the same idempotent `_COLUMN_ADDS` pattern that's been
  proven across every prior schema addition.
- Default list sort is unchanged (`created_at desc`). Filters are additive
  client-side; existing callers of `assetsApi.getAll()` work without args.
- The legacy `owner_id` is preserved alongside the new ownership chain.
  Reads in the UI prefer `primary_owner_name` if set, else fall back to the
  resolved `owner.display_name` — older assets render identically.

**Smoke-tested locally (2026-05-12):**
- AST parse: all 10 modified backend files compile.
- `asset_criticality.compute_criticality_score` produces 9.7 for
  critical/restricted/internet-facing/payments, 2.05 for low/public/internal,
  3.85 for medium-only baseline.
- `asset_lifecycle.is_valid_transition` matches the documented FSM for all
  8 sample edges (5 valid + 3 invalid).
- `compute_composite_priority` precedence: numeric `asset_criticality_score`
  wins over text `asset_criticality` when both are supplied.
- TypeScript: zero errors in `assets/`, `lib/api.ts`, `types/index.ts`
  (pre-existing unrelated errors in other modules remain).

---

## Phase 6 — Vendor Patch Intelligence (Microsoft first) — ✅ SHIPPED 2026-05-12

**Goal:** when a CVE affects a Microsoft product, automatically know which KB
article patches it. The remediation team's #1 question is "what do I install
to fix this?" — that information lives in MSRC.

**Shipped:**
- MSRC client targeting `https://api.msrc.microsoft.com/sug/v2.0/en-US/cve/<cve-id>`
  (no auth required). Defensive regex-based parser extracts `KB\d{6,8}`, `ADV…`
  advisory IDs, and remediation text — survives MSRC schema drift because it
  doesn't bind to specific JSON field paths.
- 5 new columns on `Vulnerability`: `patch_references` (JSON array of
  `{source, id, url, type}`), `vendor_advisory_ids` (JSON array of strings),
  `remediation_guidance` (TEXT), `psirt_synced_at` (TIMESTAMP), `psirt_source`
  (VARCHAR). Indexed on `psirt_source` + `psirt_synced_at` for the daily
  refresh sweep.
- Two new endpoints:
  - `POST /vuln-management/vulnerabilities/{id}/sync-patch-info` — on-demand
    sync for one vuln, returns the updated record.
  - `POST /vuln-management/vulnerabilities/sync-patch-info-all` — queues a
    bulk Celery job for the caller's tenant; returns `{queued, task_id}`.
- Three Celery tasks on the existing `parsing` queue:
  - `sync_msrc_vuln` — single row, dispatched by ingest hooks
    (`integrations/services/sync_service.py` and `routers/nca_vuln_router.py`)
    alongside the existing enrichment dispatch.
  - `bulk_sync_msrc` — walks every open CVE-bearing vuln; skips rows
    synced within `MIN_RESYNC_DAYS=7` unless `force=True`.
  - `daily_patch_intel_refresh` — beat-scheduled 24h fan-out.
- Vendor detection by negative-cache: every CVE is asked of MSRC; a 404 is
  cached as "not a Microsoft CVE" for 7 days so non-MSFT vulns aren't
  re-pounded. Simpler than CPE-vendor pre-filtering and resilient when
  Microsoft owns a CVE under a non-obvious product name (WSUS, Defender, Edge).
- Re-sync semantics: replaces this vuln's MSRC entries with the fresh data
  while preserving entries from other PSIRTs (forward-compatible with Red
  Hat / Cisco when those connectors land).
- Frontend — extended Threat Intelligence panel on the vuln detail page
  with a Patch Information section: KB articles as clickable blue badges,
  advisory IDs as amber pills, verbatim remediation text with a Copy button,
  last-PSIRT-sync timestamp. Sync button on the vuln detail page; **Sync
  Patch Info** button on the list page header for bulk backfill.

**Where it lives:**

| Layer | File |
|---|---|
| Model | `backend/grc/models.py` — 5 columns + 2 indexes on `Vulnerability` |
| Migration | `backend/grc/modules/compliance/schema_migrations.py` — appended 5 idempotent entries |
| MSRC client | `backend/grc/modules/vuln_management/patch_intel/msrc_client.py` (new) |
| Service | `backend/grc/modules/vuln_management/patch_intel/patch_intel_service.py` (new) |
| Package init | `backend/grc/modules/vuln_management/patch_intel/__init__.py` (new) |
| Schemas | `backend/grc/schemas.py` — 5 fields on `VulnerabilityResponse` |
| Router | `backend/grc/modules/vuln_management/routers/vulnerabilities.py` — `_build_vulnerability_response` + 2 new endpoints |
| Celery tasks | `backend/grc/tasks/patch_intel.py` (new) — 3 tasks |
| Celery config | `backend/grc/celery_app.py` — `include`, route, beat schedule |
| Ingest hooks | `backend/grc/modules/integrations/services/sync_service.py`, `backend/grc/routers/nca_vuln_router.py` |
| Frontend types | `grc-frontend/src/app/(dashboard)/vulnerabilities/[id]/page.tsx` — 5 fields on `VulnerabilityDetail` |
| Frontend API | `grc-frontend/src/lib/api.ts` — `syncPatchInfo` + `syncPatchInfoAll` helpers |
| Frontend detail | `grc-frontend/src/app/(dashboard)/vulnerabilities/[id]/page.tsx` — Patch Information section in `ThreatIntelPanel` + Re-sync button + Copy-remediation button |
| Frontend list | `grc-frontend/src/app/(dashboard)/vulnerabilities/page.tsx` — `Sync Patch Info` bulk button next to `Enrich All` |

**Non-breaking guarantees verified:**
- Every new column is nullable with a JSON `[]` default for the array columns.
  Existing vulns render exactly as before — the Patch Information section is
  hidden when nothing has synced.
- Existing `/enrich` endpoint is untouched; `sync-patch-info` is a separate
  endpoint and a separate mutation in the UI. Operators can refresh KB
  articles without re-pulling EPSS/KEV (and vice versa).
- Network failures, 5xx, parse errors, and broker outages are all logged and
  swallowed. The vuln row never gets corrupted by a bad MSRC response.
- Re-sync preserves refs from other PSIRTs (RHSA, Cisco PSIRT) — verified by
  unit test: a row with `[msrc:KB5005566, rhsa:RHSA-2021:5106]` re-synced
  against fresh MSRC data of `[msrc:KB99999]` becomes
  `[rhsa:RHSA-2021:5106, msrc:KB99999]`.

**Smoke-tested locally (2026-05-12):**
- AST parse: all 11 modified/new backend files compile.
- MSRC regex extractors: extracted `KB5009543`, `KB5005566`, MSRC update-guide
  URL, `ADV200005` from a representative response payload; empty input
  returns 0 refs.
- `patch_intel_service` merge logic: existing entries preserved + de-duped;
  resync preserves non-MSRC entries while replacing MSRC ones; advisory IDs
  merged without duplicates.
- TypeScript: zero errors in any of the 3 frontend files changed.

**Future-proofs:** the same `patch_references` schema works for Red Hat
(`source: 'rhsa'`) and Cisco (`source: 'cisco_psirt'`). Adding those is a
1-week effort once MSRC is the template.

---

## Phase 7 — Cloud Asset & Vulnerability Discovery — ✅ SHIPPED 2026-05-12

**Goal:** auto-populate assets, software identifiers, and vulns from AWS
Inspector, Azure Defender, GCP SCC.

**Shipped — three full adapters, lazy-imported SDKs:**
- **AWS Inspector v2** (`backend/grc/modules/integrations/cloud/aws_inspector.py`):
  STS cross-account assume-role with external ID. Per-region `describe_instances`
  + `describe_repositories` + `list_functions` for asset upsert, plus
  `inspector2:ListFindings` with paginated CVE-bearing findings, mapped to
  the right asset via ARN matching. Severity + CVSS extraction off
  `packageVulnerabilityDetails`. Lazy `import boto3` — clean health/sync
  error if the SDK isn't installed.
- **Microsoft Defender for Cloud** (`azure_defender.py`):
  service-principal client-credentials auth. Iterates
  `Microsoft.Security/assessments` at the subscription scope, then
  sub-assessments for CVE-bearing detail. Lazy `import azure.identity` +
  `azure.mgmt.security` + `azure.mgmt.resource`.
- **Google Cloud Security Command Center (Premium)** (`gcp_scc.py`):
  service-account JSON auth. Walks `list_sources` at the org, then
  `list_findings` filtered to `state="ACTIVE"`. Lazy `import
  google.cloud.securitycenter_v1`.
- All three adapters route through the Track B `upsert_cloud_asset` +
  `upsert_cloud_vulnerability` helpers so the dedup + manual-field
  preservation rules apply uniformly.

**Orchestrator + scheduling:**
- `POST /cloud-connectors/{id}/sync` — synchronous on-demand sync (admin
  page "Sync now" button uses this).
- `POST /cloud-connectors/sync-all` — queues `bulk_sync_for_tenant` Celery
  task.
- `daily_cloud_connector_fan_out` Celery beat task runs every 6 hours,
  fans out one `sync_cloud_connector.delay()` per active connector
  whose `last_sync_at` is older than its per-connector
  `sync_schedule_seconds` (default 6h).
- Each run stamps `last_sync_at`, `last_sync_status` (ok/partial/error),
  `last_sync_error`, and `health_metrics` (counts of new+updated assets +
  vulns) on the `CloudConnector` row.

**Frontend:**
- `/admin → Cloud Connectors` page. Provider-aware credential template
  (AWS / Azure / GCP), encryption-readiness banner, per-row Health Check /
  Sync / Disable / Delete actions, sync result summary (counts + errors),
  inline credential update via the PATCH endpoint.
- `/assets` list page — new **Source** filter (Cloud / AWS / Azure / GCP /
  Nessus / Nexpose / Manual). Lifecycle + Data Classification + Stale-only
  + Source all compose client-side; default sort + view unchanged.

**Verified by smoke test (2026-05-12):**
- All 3 adapter contracts (`provider`, `display_label`, `validate_credentials`,
  `health_check`, `sync`) present.
- 6 positive credential-validation cases pass.
- 6 negative cases produce the expected `ConnectorCredentialsInvalid` with
  a user-safe message.
- Health check without SDK installed returns `status="error"` cleanly —
  never raises, never persists.

**Deployment note:** boto3 / azure-identity / azure-mgmt-security /
google-cloud-securitycenter are NOT in `backend/requirements.txt` by
default. To turn on live cloud sync, install them in the worker image
and restart. The adapter framework + admin UI work today; only the live
SDK calls require the install.

---

## Phase 8 — Exception Workflow — ✅ SHIPPED 2026-05-12

**Goal:** formal, audited way to suppress vulns that can't or shouldn't be
remediated immediately. Auditors specifically look for "documented risk
acceptance with expiry".

**Shipped:**
- States `none → requested → approved | denied → expired | revoked` with
  all forward-edge transitions enforced server-side
  (`backend/grc/services/vuln_exception.py`). Separation of duties: the
  user who requested an exception cannot also approve or deny it —
  verified by smoke test.
- 12 new columns on `Vulnerability`: `exception_status`,
  `exception_requested_by_id`, `exception_requested_at`,
  `exception_justification`, `exception_compensating_controls` (JSON),
  `exception_approved_at`, `exception_expires_at`,
  `exception_denial_reason`, `exception_revoked_by_id`,
  `exception_revoked_at`, `exception_revocation_reason`,
  `exception_metadata` (JSON). The legacy `is_exception` /
  `exception_reason` / `exception_approved_by` / `exception_expiry` columns
  are kept in sync inside the FSM service, so existing dashboards and
  reports keep working unchanged.
- 4 endpoints on `/vuln-management/vulnerabilities/{id}/exception`:
  `request`, `approve`, `deny`, `revoke`. Mandatory justification on
  request, mandatory denial reason on deny. Each returns the full
  `VulnerabilityResponse` plus an `exception` summary so the UI refreshes
  without a follow-up GET.
- Daily Celery beat sweep
  (`backend/grc/tasks/exceptions.py:daily_exception_expiry_sweep`)
  transitions every approved-and-expired row to `expired` and syncs the
  legacy `is_exception` flag. Lives on the existing `parsing` queue;
  beat schedule registered in `celery_app.py`.
- Frontend — `ExceptionWorkflowPanel` on the vuln detail page
  (`grc-frontend/src/app/(dashboard)/vulnerabilities/[id]/page.tsx`).
  State-aware UI: shows `Request` when state is none/denied/expired,
  `Approve`/`Deny` when requested (disabled for the original requester),
  `Revoke` when approved. Read-only snapshot of justification +
  compensating controls + approval/denial/revocation history. Status
  pill colour-coded per state. The list page's existing `is_exception`
  column keeps working because the FSM service syncs the legacy field
  on every transition.

**Where it lives:**

| Layer | File |
|---|---|
| Model | `backend/grc/models.py` — 12 columns + 2 indexes on `Vulnerability` |
| Migration | `backend/grc/modules/compliance/schema_migrations.py` — 12 idempotent entries |
| Service | `backend/grc/services/vuln_exception.py` (new) — FSM + SoD + sweep helper |
| Schemas | `backend/grc/schemas.py` — 14 fields on `VulnerabilityResponse` + 4 body schemas |
| Router | `backend/grc/modules/vuln_management/routers/vulnerabilities.py` — 4 endpoints |
| Celery tasks | `backend/grc/tasks/exceptions.py` (new) — 2 tasks |
| Celery config | `backend/grc/celery_app.py` — `include`, route, daily beat |
| Frontend types | `grc-frontend/src/app/(dashboard)/vulnerabilities/[id]/page.tsx` — 12 fields on `VulnerabilityDetail` |
| Frontend API | `grc-frontend/src/lib/api.ts` — `exceptionRequest`/`Approve`/`Deny`/`Revoke` helpers |
| Frontend panel | `grc-frontend/src/app/(dashboard)/vulnerabilities/[id]/page.tsx` — `ExceptionWorkflowPanel` |

**Smoke-tested locally (2026-05-12):**
- AST parse: all 9 modified/new backend files compile.
- All 10 FSM transitions (5 valid, 5 invalid) match expected outcomes.
- Separation of duties: approve-by-requester rejected with clear message;
  deny-by-requester rejected; approve-by-different-actor succeeds and
  flips `is_exception` to True.
- Blank justification refused on request.
- Re-request after denial clears prior `exception_denial_reason`.
- Revoke from approved transitions to revoked; revoke from requested
  refused.
- TypeScript: zero errors in the 2 frontend files changed.

**Phase 8 extensions shipped same day:**
- **Bulk exception request** (`POST /vulnerabilities/exception/bulk-request`):
  takes `vulnerability_ids[]` + a single `justification`/`compensating_controls`/
  `expires_at`. Each row goes through the FSM individually (per-row history
  preserved); ineligible rows are skipped with a per-row error message.
  Returns `{requested, skipped, errors}`.
- **Exception queue list** (`GET /vulnerabilities/exception-queue?state=...`):
  cross-tenant view of every vuln currently in any exception state.
- **Exception queue page** (`grc-frontend/src/app/(dashboard)/vulnerabilities/
  exceptions/page.tsx`) — state-filter pills, table with priority + status
  + requested-at + expires-at + justification snippet. Linked from
  sidebar as **Vulnerability Mgmt → Exceptions**.

**Deferred (future PR):**
- Hard SLA integration (suppress breach alerts on approved exceptions —
  the legacy `is_exception` flag is already kept in sync, so existing
  SLA-driven filters already treat approved exceptions correctly).
- Per-feature permissions (`vulnerabilities:exception:approve` separation
  from `:edit`). Currently gated behind edit + the FSM enforces SoD,
  which is the auditor-relevant control.
- Exception list / approver dashboard widget — the per-vuln panel works
  today; a cross-tenant queue view comes when the dashboards rework lands.

---

## Phase 9 — Reporting, Analytics & Dashboards — ✅ SHIPPED 2026-05-12

**Goal:** turn the rich data into views compliance officers, security
leadership, and auditors actually use.

**Shipped — backend (`backend/grc/routers/search_router.py`):**
- **Power search** (`GET /search/power?q=…`) — cross-domain, tenant-scoped,
  with faceted filters: `severity`, `kev_only`, `min_priority` on the
  vuln slice; `asset_criticality`, `lifecycle_state`, `source` on the
  asset slice. SQL-injection-safe ILIKE pattern (escaped `%`/`_`).
  Results sorted by composite priority / criticality score.
- **Executive dashboard** (`GET /analytics/executive-dashboard`):
  open-total + by-severity, KEV exposure, overdue count, SLA performance
  %, cloud-vs-total asset coverage, asset-by-source breakdown, top 10
  affected assets by open-vuln count, 90-day weekly trend.
- **Analyst dashboard** (`GET /analytics/analyst-dashboard`): my-open
  (sorted by priority), due-this-week, pending exception approvals
  (filtered out the actor's own requests via SoD), 7-day ingest count,
  top 15 stale assets.
- **Exception-aging analytics** (`GET /analytics/exception-aging`):
  state counts, active aging buckets, expiring-within windows,
  expired-unactioned, pending request aging.
- **Patch correlation** (`GET /analytics/patch-correlation`):
  KB → finding count, top CVEs by finding count. Aggregates the Phase 6
  `patch_references` JSON column.
- **Vendor risk** (`GET /analytics/vendor-risk`): vuln count + critical/
  high/medium/low breakdown per vendor (joined via VulnerabilityAssetLink),
  plus CWE distribution.
- **4 compliance reports** with CSV + Excel export:
  `/reports/exceptions-active` (date-range filter),
  `/reports/remediation-timeline`,
  `/reports/asset-register`,
  `/reports/patch-evidence`.

**Shipped — frontend:**
- New `/vulnerabilities/analytics` page with 4 tabs (Executive / My Work /
  Patch Correlation / Vendor Risk). Includes KPI cards, severity bars,
  trend tables, aging mini-stats, top-affected-assets list, KB/CVE
  correlation tables, vendor risk matrix, CWE distribution. Bottom of
  the Vendor tab hosts the compliance Reports download panel (CSV/Excel
  per report).
- **Global search bar** in the Header component
  (`grc-frontend/src/components/layout/Header.tsx`). Debounced 250ms,
  cross-domain (vulns / assets / risks), routes straight to the detail
  page on click.
- New sidebar links: **Vulnerability Mgmt → Analytics** and **Vulnerability
  Mgmt → Exceptions** (Phase 8 queue page).
- Page titles registered in the Header title map.

**Where it lives:**

| Layer | File |
|---|---|
| Router | `backend/grc/routers/search_router.py` — 6 analytics endpoints + 4 report endpoints + faceted search |
| Frontend page | `grc-frontend/src/app/(dashboard)/vulnerabilities/analytics/page.tsx` — 4-tab analytics + reports panel |
| Frontend search bar | `grc-frontend/src/components/layout/Header.tsx` — `GlobalSearchBar` component |
| Frontend API | `grc-frontend/src/lib/api.ts` — `searchApi` + `reportsApi` |
| Navigation | `grc-frontend/src/components/layout/Sidebar.tsx` — Analytics + Exceptions links |

---

## Working agreements for every phase

These keep the changes safe and the user trust intact.

1. **Additive only.** New columns nullable with defaults. New endpoints.
   No existing function signature changes. No existing API contract changes.
2. **Idempotent migration.** Schema additions go through the
   `_COLUMN_ADDS` list in
   `backend/grc/modules/compliance/schema_migrations.py`. Existing tenants
   auto-heal on next backend startup or first request.
3. **Best-effort enrichment.** Any external HTTP call has its own try/except.
   Network failure or rate limit → empty result, never raises into the request
   path. Daily refresh catches anything that slipped.
4. **Sort defaults preserved.** CVSS-driven default sort, CVSS-driven SLA
   logic, both keep working unchanged. New signals (composite priority,
   criticality score) are opt-in extras.
5. **Permissions per-feature.** Every new admin-grade capability gets its
   own permission string so RBAC can lock it down.
6. **Audit log on every write.** Every state transition, every credential
   change, every bulk action writes to `grc_audit_log` with who/when/before/
   after.
7. **Documented separations of duty.** Where compliance requires it (e.g.
   exception request vs approval), enforced in code, not just by UI.

---

## Status snapshot

| Track / Phase | Status |
|---|---|
| Track A — Connector framework | 🧊 deferred |
| Track B — Normalized data layer | 🧊 deferred |
| Track C — Background job queues | 🚧 partial |
| Phase 5 — Asset Operational Context | 🚧 active this pass |
| Phase 6 — MSRC patch intelligence | ⏭️ |
| Phase 7 — Cloud asset discovery (AWS/Azure/GCP) | ⏭️ |
| Phase 8 — Exception workflow | ⏭️ |
| Phase 9 — Reporting / analytics | ⏭️ |
