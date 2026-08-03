# Session Work Log

Living log of work in this conversation. Updated as tasks land.
Last updated: 2026-05-15.

---

## Active workstreams

| # | Workstream | Status |
|---|---|---|
| 1 | AI document drafting overhaul (UBL feedback → bank-grade output) | DONE |
| 2 | AI drafting moved to async/background execution | DONE |
| 3 | External connectors framework (11 providers under admin) | DONE |
| 4 | Modal UX redesign for AI drafting | DONE |
| 5 | Framework-assessment risks: filter dropdown + Auditor Portal visibility | DONE |
| 6 | Auditor Portal: governance exceptions for published frameworks + control detail modal + auto-approve | DONE |
| 7 | IT Assets: ISO 27005 auto-calculated criticality + bulk-template field parity | DONE |

---

## 1. AI document drafting overhaul

**Trigger:** UBL bank feedback — AI-drafted policies were "very basic and not detailed". Reference: Allied Bank Information Security Policy v4.0 (governance committees, approval chains, numbered 4.1–4.39 clauses with concrete thresholds, regulatory citations like `[PCI DSS v3.2, clause 8.1.6]` and `(SBP ETG&RMF 2.9 (e))`, annexures, revision history, definitions).

**Principles enforced:**
1. Zero hardcoded organisation/committee/role names — everything flows from tenant company profile (`Tenant.name`, `legal_entity`, `regulatory_scope`, `geography`, `primary_contact_*`).
2. Zero static citation library — citations come from the tenant's active `CertificationJourney` rows. Each tenant's citation pool **is** their started frameworks.

**Files created:**

- `backend/grc/modules/governance/ai_drafting/__init__.py`
- `backend/grc/modules/governance/ai_drafting/tenant_context.py` — assembles `TenantContextBundle` (org, committees, roles, BUs, PasswordPolicy thresholds).
- `backend/grc/modules/governance/ai_drafting/framework_index.py` — buckets `ParsedFrameworkControl` rows from tenant journeys into topic taxonomy (governance, access_control, password_policy, incident_management, etc.). Redis-cached 1h per `(tenant_id, journey_set)`.
- `backend/grc/modules/governance/ai_drafting/scaffolds.py` — `DocScaffold` for Policy / Standard / Procedure / Guideline. Each has `mandatory_sections`, `approval_matrix` (committee types resolved against tenant's actual committees), `annexures`, `prompt_voice` (system message), per-section `expansion_focus`.
- `backend/grc/modules/governance/ai_drafting/exemplars.py` — 6 bank-grade few-shot snippets keyed by topic; injected as tone references in section calls.
- `backend/grc/modules/governance/ai_drafting/qa.py` — `_BANNED_SUBSTRINGS` (e.g. `[insert ...]`, `your organization`, `as an ai`), citation validator against tenant's active framework codes, min word / min clause checks, `regeneration_hint()` for the targeted retry pass.
- `backend/grc/modules/governance/ai_drafting/pipeline.py` — 4-stage orchestrator:
  - **Stage A — outline** (one short LLM call, decides topic per open-topic section)
  - **Stage B — section expansion** (parallel `ThreadPoolExecutor`, one focused call per section, ~8–13 calls total)
  - **Stage C — metadata/annexures** (deterministic; no LLM — Document Description table, Approval Signoff matrix, Revision History from `TenantContextBundle`)
  - **Stage D — QA** (validates each section; failing ones regenerate with a corrective hint)

**Files modified:**

- `backend/grc/modules/governance/routers/documents.py:2473` — `POST /governance/documents/ai-draft` delegates to `run_drafting_pipeline()`.
- `backend/grc/routers/nca_templates_router.py:400` — `POST /governance/nca-templates/{id}/ai-draft` uses the same pipeline, passes template text as parent context.

---

## 2. AI drafting moved to async/background execution

**Trigger:** Sync endpoint was timing out at the proxy on long drafts (30–90 s for 8–13 GPT-4o calls).

**Architecture:**
- Job state in Redis under `ai_draft_job:<job_id>` (1h TTL).
- `dispatch_in_thread(slug, job_id, payload)` spawns a daemon thread that opens its own tenant session via `open_tenant_session(slug)` and runs `_execute_drafting()`. Returns immediately.
- Pipeline accepts `progress_callback` and emits stage transitions (`context` → `outline` → `expand_sections` (with `sections_completed`/`sections_total`/`last_section`) → `qa` → `done`).
- `GET /governance/documents/ai-draft-jobs/{job_id}` polling endpoint reads Redis, tenant-scoped.
- Celery task `ai_drafting.generate_draft` retained as a thin wrapper around `_execute_drafting` for production with worker isolation — not required.

**Why threading instead of Celery as default:** Celery `.delay()` was succeeding (broker accepted) but no worker was consuming the `parsing` queue → job stuck on `queued` forever. In-process thread eliminates the broker+worker dependency. Pipeline already parallelises section calls via `ThreadPoolExecutor` so running it in a thread is straightforward.

**Files:**
- `backend/grc/tasks/ai_drafting.py` — `create_job` / `get_job` / `dispatch_in_thread` / `_execute_drafting` / `generate_draft` (Celery wrapper).
- `backend/grc/modules/governance/ai_drafting/pipeline.py` — `progress_callback` parameter + `_emit()` hooks at each stage transition.
- `backend/grc/celery_app.py` — task module registered + routed to `parsing` queue.
- `backend/grc/modules/governance/routers/documents.py` — endpoint dispatches in-thread, returns `{job_id, poll_url}`.
- `backend/grc/routers/nca_templates_router.py` — same async path.

**Frontend:**
- `grc-frontend/src/app/(dashboard)/governance/documents/page.tsx`:
  - `aiDraftMutation` now reads `{job_id}` from response and starts a 2s polling loop via `useEffect`.
  - Job state (`stage`, `sections_completed`, `sections_total`, `last_section`, `elapsed_ms`) flows into modal.
  - On `completed`, polls stop and `aiDraftResult` is set from `payload.result`.
  - On `failed` or 404, polls stop and a toast surfaces the error.

---

## 3. External connectors framework

**Scope agreed:** Full scaffolding + 1 working exemplar per category. Beta stubs for the rest with real auth shapes wired.

**Categories + providers:**

| Category | Working exemplar | Beta stubs |
|---|---|---|
| Ticketing | ServiceNow | BMC Helix Remedy |
| SIEM | Splunk | Wazuh, IBM QRadar |
| Pen-test | Metasploit (msfrpc) | Core Impact |
| Collaboration | MS Teams | Zoom, Office 365 |
| Transcription | Fireflies.ai | — |

**Foundation:**
- `IntegrationConnection` extended with `category`, `encrypted_credentials` (Fernet via `services/connector_credentials.py`), `oauth_tokens`, `provider_config` JSON. Migration in `schema_migrations.py` (`_COLUMN_ADDS`) — idempotent; also relaxes NOT NULL on `credential_env_prefix` for non-scanner providers.
- `backend/grc/modules/connectors/base.py` — 5 category adapter base classes: `TicketingAdapter`, `SiemAdapter`, `PenTestAdapter`, `CollabAdapter`, `TranscribeAdapter`. Each declares its own `run_sync()` shape; all share `test_connection()`.
- `backend/grc/modules/connectors/registry.py` — `ProviderMeta` + `register()` + `build_adapter()`. Provider modules self-register on import.
- 11 provider modules under `backend/grc/modules/connectors/providers/`.
- `backend/grc/modules/connectors/router.py` — CRUD endpoints + OAuth round-trip:
  - `GET /connectors/providers` — catalogue
  - `GET /connectors` — list
  - `POST /connectors` — create + auto-test
  - `PATCH /connectors/{id}` — update (merges credentials so partial updates work)
  - `DELETE /connectors/{id}`
  - `POST /connectors/{id}/test`
  - `POST /connectors/{id}/sync` — dispatches to Celery, inline fallback
  - `GET /connectors/oauth/start` + `GET /connectors/oauth/callback` — Microsoft / Zoom token exchange
- `backend/grc/modules/connectors/sync_runner.py` — `run_inline_sync()` dispatches based on category. Ticketing branch pushes vulns above CVSS threshold + pending exceptions, persists external IDs on `Vulnerability.template_fields["connector_tickets"]` and `PolicyException.metadata_info["connector_tickets"]` so we don't double-push. Status sync pulls back, normalised to `{new, in_progress, on_hold, resolved, closed, cancelled}`.
- `backend/grc/tasks/connectors.py` — `run_connector_sync` (per-connector) + `sync_all_active` (beat fan-out across tenants).
- `backend/grc/celery_app.py` — task module included; hourly `connectors-hourly-sync` beat schedule on `parsing` queue.

**Frontend:**
- `grc-frontend/src/app/(dashboard)/admin/page.tsx` — new "Connectors" tab.
- `grc-frontend/src/app/(dashboard)/admin/connectors/page.tsx` — category-grouped grid (Ticketing, SIEM, Pen-test, Collab, Transcribe); per-card add/test/sync/remove; setup modal with credentials vs config field split; OAuth popup round-trip after save for OAuth2 providers; dev-mode banner when `CONNECTOR_MASTER_KEY` is unset.
- `grc-frontend/src/lib/api.ts` — `connectorsApi` client + types (`ConnectorProviderMeta`, `ConnectorRow`, `ConnectorProviderField`).
- `grc-frontend/src/app/(dashboard)/admin/page.tsx` — Connectors tab wired into the admin nav.

**Next-step requirements (when client provides):**
1. Set `CONNECTOR_MASTER_KEY` env var (Fernet key — generate via `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`) so creds encrypt instead of dev-mode base64.
2. Set `PUBLIC_API_BASE_URL` so OAuth `redirect_uri` resolves correctly.
3. Register Azure AD apps for MS Teams + Office 365; Zoom marketplace app — deliver client IDs + secrets per tenant.
4. For ServiceNow / Splunk / Metasploit / Fireflies: just create the connector with the vendor credentials and click Test.

---

## 4. Modal UX redesign for AI drafting

**Issues with the original modal:**
- Fake timer-based progress that advanced regardless of actual backend state.
- Title field at the bottom; document type and frameworks crammed at top with no hierarchy.
- Loading spinner blocked the whole form.

**Redesign in `AIDraftPolicyModal`:**

- **Step 1 — What are you drafting?** Title (first, autofocused, prominent) + Document Type + Description.
- **Step 2 — Anchor it (optional)** Frameworks (with inline chip display), reference template, parent document grouped visually.
- Form dims while drafting runs so user understands the form is locked but work is progressing.
- `DraftingStageProgress` rewritten to consume real `jobState` from the polling loop:
  - Shows actual stage from the pipeline (`context` / `outline` / `expand_sections` / `qa` / `done`).
  - Real sections-completed progress bar (`4 / 13 sections`) during Stage B.
  - Currently drafting section name.
  - Elapsed seconds counter (monotonic, not estimated).
  - Heading: "Running on a background worker — you can close this and it'll keep going."

---

## Smoke tests passed

- AST parse + import on all new backend modules.
- Provider registry confirms 11 providers across 5 categories.
- `IntegrationConnection` has the 4 new columns.
- `main.py` + `celery_app.py` import clean.
- Frontend `tsc` produces zero new errors in modified files (the two pre-existing `DocumentHierarchyItem` errors in `governance/documents/page.tsx` are unchanged).

---

## 5. Framework-assessment risks — Risk Register filter + Auditor Portal visibility

**Bug 1.** Risks accepted from a SWIFT (or any) Framework Risk Assessment landed in the Risk Register but the "type" filter dropdown showed `"Framework Assessment #<id>"` instead of the framework name. Risks from frameworks like NCA/Aramco (created via different paths) were tagged correctly with `register_type = "NCA Template"` etc., which is why those worked.

**Bug 2.** `GET /auditor-portal/{id}?tab=risks` for SWIFT returned empty even though the risks existed in the Risk Register. The endpoint filtered `Risk.register_type == ctx.framework_short_code` and the `Framework Assessment #N` tag never matches a framework short_code.

**Root cause:** `backend/grc/modules/erm/routers/framework_risk_assessments.py:1334` hardcoded `register_type_value = f"Framework Assessment #{assessment.id}"` regardless of which framework the assessment came from.

**Fix — three coordinated changes:**

1. **Writer fix** — [framework_risk_assessments.py:1316](backend/grc/modules/erm/routers/framework_risk_assessments.py#L1316) `move_framework_question_to_risk_register()`:
   - Derive `register_type_value` from the framework in preference order: published `Framework.short_code` → `Framework.name` → `UploadedFramework.name` → legacy `"Framework Assessment #<id>"` fallback (only when none of the above resolve).
   - Also populate `Risk.source_type='assessment'` and `Risk.source_reference=f"framework_assessment:{assessment.id}"` for provenance tracking — gives the auditor portal a robust fallback even if `register_type` is edited downstream.

2. **Auditor portal reader fix** — [auditor_portal/routers/artifacts.py:101](backend/grc/modules/auditor_portal/routers/artifacts.py#L101) `list_risks()`:
   - Now OR-matches risks against any of:
     - `register_type == framework.short_code`
     - `register_type == framework.name`
     - `register_type == "Framework Assessment #<id>"` for each assessment under this framework (legacy coverage)
     - `source_reference == "framework_assessment:<id>"` for each assessment under this framework (provenance fallback)
   - Catches both new (correctly tagged) and pre-fix legacy rows without requiring data migration.

3. **One-shot backfill** — [schema_migrations.py](backend/grc/modules/compliance/schema_migrations.py) `_backfill_framework_assessment_register_type()`:
   - Walks all rows whose `register_type LIKE 'Framework Assessment #%'`, parses the assessment id, looks up the framework's `short_code`/`name`/uploaded framework name, and rewrites `register_type` to that value.
   - Also fills `source_type` and `source_reference` if NULL (uses `COALESCE` so existing values aren't overwritten).
   - Idempotent — already-migrated rows have non-legacy `register_type` values and are skipped on subsequent runs.
   - Wired into `_ensure_for_engine()` so it runs once per tenant DB on first request, same memoisation pattern as the column-add migrations.

**Result:**
- New framework-assessment risks tag themselves correctly on write.
- Existing legacy risks get rewritten on the next request that touches the tenant DB.
- Both bugs disappear without breaking the existing NCA/Aramco/UBL flows (which weren't using this code path).

**Files touched:**
- `backend/grc/modules/erm/routers/framework_risk_assessments.py`
- `backend/grc/modules/auditor_portal/routers/artifacts.py`
- `backend/grc/modules/compliance/schema_migrations.py`

---

## 6. Auditor Portal — governance exceptions, control detail, auto-approve

**Issue 1.** The Exceptions tab on the auditor portal didn't show policy exceptions for SWIFT (or any other published `Framework`). NCA/Aramco worked because they were uploaded as `UploadedFramework` rows. Root cause: `exceptions_section.py:72` gated the policy-exception lookup on `if ctx.framework:` (UploadedFramework only) — `ctx.published_framework` was ignored.

**Issue 2.** No auto-approve action on the Controls tab — auditors had to use the regular Applicability flow (request decision in one screen, then approve it in another) for every routine in-scope control.

**Issue 3.** Clicking a control row in the auditor portal did nothing — couldn't see the full framework requirement text.

**Issue 4.** Evidence on the Controls tab was shown only as counts (e.g. "3 / 1 pending / 0 rejected") — no way to see the actual files attached.

### Backend

**`exceptions_section.py`** ([file](backend/grc/modules/auditor_portal/routers/exceptions_section.py)):
- Replaced single-source `if ctx.framework:` gate with a `candidate_framework_ids` set that includes **both** `ctx.framework.id` (UploadedFramework) and `ctx.published_framework.id` (published Framework). Documents whose `framework_ids` JSON contains any candidate are now matched.
- Backwards-compatible — existing UploadedFramework matches still work.

**`controls.py`** ([file](backend/grc/modules/auditor_portal/routers/controls.py)):
- **List endpoint** extended with `description` (truncated to 300 chars), `section_number`, `parent_section`, and a derived `can_auto_approve` boolean (true when no applicability decision exists AND the control isn't critical).
- **New `GET /{framework_id}/controls/{control_id}`** detail endpoint — returns `full_text`, `description`, `evidence_requirements`, the applicability + implementation rollup, and every linked `ImplementationEvidence` row (filename, status, uploader, timestamp, file size).
- **New `POST /{framework_id}/controls/{control_id}/auto-approve`** — one-call action that creates a `ClauseApplicability` with `is_applicable=True`, `status='approved'`, requester = reviewer = current user, propagates `is_applicable=True` to every `ControlImplementation` row across the tenant's journeys, and writes a `applicability_auto_approved` audit log entry. Guard rails:
  - 400 when control is `is_critical` (those always need a manual decision).
  - 409 when an applicability record already exists (caller should use the existing review flow).

### Frontend

**`ControlsTab.tsx`** ([file](grc-frontend/src/app/(dashboard)/auditor-portal/[frameworkId]/_tabs/ControlsTab.tsx)):
- Row click opens a new `ControlDetailModal` that lazy-loads from `/controls/{id}` and shows: the full framework requirement, applicability + implementation rollup, evidence list (with uploader / timestamp / status / link out), and expected evidence types.
- New `autoApproveMutation` wired to the auto-approve endpoint. List-row action column now renders one of:
  - Approve / Reject when applicability is `pending`,
  - "Auto-approve" (blue, sparkle icon) when no decision yet and `can_auto_approve` is true,
  - "Manual review required" hint when the control is critical,
  - The current state label (in scope / out of scope / reviewed) when already decided.
- Same auto-approve / approve / reject buttons available at the bottom of the detail modal.

**`EvidenceTab.tsx`** — already displayed `control.control_id` and `control.title` per evidence row (no change needed).

### Files touched

- `backend/grc/modules/auditor_portal/routers/exceptions_section.py`
- `backend/grc/modules/auditor_portal/routers/controls.py`
- `grc-frontend/src/app/(dashboard)/auditor-portal/[frameworkId]/_tabs/ControlsTab.tsx`

### Smoke-tested

- AST parse + import on both backend files; new routes registered under `/controls`, `/controls/{id}`, `/controls/{id}/auto-approve`.
- `main.py` imports clean.
- TypeScript surfaces zero new errors in `ControlsTab.tsx`.

---

## 7. IT Assets — auto-calculated criticality + bulk-template parity

**Issue 1.** The "Add Asset" form forced the user to pick `low/medium/high/critical` manually, so two people scoring the same asset could land on different buckets. The user wanted an ISO 27005-style auto-calculation from objective inputs (CIA ratings + exposure metadata).

**Issue 2.** The bulk-import CSV template carried 12 fields; the manual form rendered ~15. Several model columns existed on neither surface (`data_classification`, `internet_facing`, `business_function`, `network_segment`, `compliance_scope`, `lifecycle_state`, ownership fields). Imported assets also skipped the criticality calculation entirely (its hook was only wired into `POST /assets` and `PUT /assets/{id}`).

### Backend

**[services/asset_criticality.py](backend/grc/services/asset_criticality.py)** — rewritten:
- ISO 27005 formula: base = `_CIA_RATING_TO_BASE[max(C, I, A)]` (0–10 scaled from the 1–5 input). Boost +2.5 for internet-facing, +1.5 for restricted (or +1.0 for confidential) data class, +1.5 for high-impact business function. Clamp to [0, 10].
- Bucket thresholds: `>=8.5 critical`, `>=6.5 high`, `>=4.0 medium`, else `low`.
- No-CIA-input fallback to 5.0 (medium) so missing data never silently classifies as low.
- New structured `BUSINESS_FUNCTION_CATEGORIES` (26 entries grouped: Identity & Access, Financial Operations, Regulated Data, Security Operations, Customer-Facing, Internal Operations, Infrastructure, Other). Each carries a `high_impact: bool` flag. Legacy free-text business_function values still match via keyword fallback for back-compat.
- `recompute_for_asset(asset)` now sets BOTH `criticality_score` (always system-derived) AND `criticality` text bucket. Respects `criticality_manual_override=True` to preserve user-chosen bucket.

**[models.py](backend/grc/models.py)** + **[schema_migrations.py](backend/grc/modules/compliance/schema_migrations.py)**:
- Added `criticality_manual_override` BOOLEAN DEFAULT FALSE and `criticality_override_reason` TEXT to `grc_it_assets`. Idempotent ALTER via `_COLUMN_ADDS`.

**[schemas.py](backend/grc/schemas.py)** — `ITAssetBase`/`ITAssetCreate`/`ITAssetUpdate`/`ITAssetResponse` updated:
- `criticality` is now `Optional[str]` (was `str = "medium"`); empty value means "let the system derive it".
- Added `criticality_manual_override` and `criticality_override_reason` on all four schemas.

**[routers/assets_router.py](backend/grc/routers/assets_router.py)**:
- New `GET /assets/criticality/business-functions` — serves the 26-entry catalogue grouped.
- New `POST /assets/criticality/preview` — pure-compute endpoint. Frontend posts inputs, receives `{score, bucket}` with no DB writes. Powers the live preview as the user fills the form.
- `POST /assets` (create) — validates override (bucket valid + reason supplied), passes the override flag into the ITAsset row, then `recompute_for_asset` sets both score and bucket (override path keeps the user's bucket; non-override path overwrites with the derived bucket).
- `PUT /assets/{id}` (update) — recompute trigger now fires on any change to CIA ratings OR exposure metadata OR the override flag. Clearing the override flag wipes the reason and re-derives the bucket.
- **Bulk template** (`ASSET_TEMPLATE_COLUMNS`) — extended from 12 → 24 columns. Adds `host_name`, `ip_address`, `data_classification`, `internet_facing`, `business_function`, `network_segment`, `compliance_scope`, `owner_name`, `owning_team`, `lifecycle_state`, plus `criticality` + `criticality_override_reason` as explicit override columns with "LEAVE BLANK to let the system calculate" hint.
- **Bulk importer** (`/import/upload`) — ingests all new columns, validates enums (`data_classification`, `lifecycle_state`, override bucket), parses `compliance_scope` from comma-separated string, validates the override pair (bucket + reason required together), then calls `recompute_for_asset(asset)` on every row so bulk-imported assets carry both `criticality_score` AND `criticality` derived from the same formula as manual creation.

### Frontend

**[assets/page.tsx](grc-frontend/src/app/(dashboard)/assets/page.tsx) `AssetModal`** — reworked:
- Removed the manual `criticality` dropdown from the main field grid.
- Added a **Data Classification** select (`public/internal/confidential/restricted`).
- Added an **Internet-Facing** toggle (amber when on, slate when off).
- Added a **Business Function** dropdown — populated from the new `/assets/criticality/business-functions` catalogue, grouped with `<optgroup>` headers, high-impact entries marked with a `⬆ boosts criticality` suffix.
- Added a **Network Segment** text input.
- Added a **System-calculated criticality** card that lives-previews the derived bucket (colour-coded pill: rose/orange/amber/slate) and the 0–10 score. Updates within 250ms of any input change via the `/preview` endpoint.
- Added an **Override toggle** inside the card. When ticked, reveals a bucket dropdown (seeded with the derived bucket so it isn't empty) and a mandatory reason text field. The form blocks submit with an inline alert if the reason is missing.

### Smoke tests passed

Backend assertions:
- `max(CIA)=5` → score 10.0 → bucket `critical`.
- `max(CIA)=3` → score 6.0 → bucket `medium`.
- `max(CIA)=3` + restricted + internet-facing + payment_processing → would score 11.5, capped at 10.0 → `critical`.
- No CIA inputs → falls back to 5.0 → `medium` (not `low`).
- Catalogue returns 26 categories; `payment_processing` correctly flagged `high_impact: true`.
- `recompute_for_asset` keeps the user's bucket when `criticality_manual_override=True`; rewrites it when False.

Frontend: TypeScript surfaces zero new errors in `assets/page.tsx`.

### Files touched

- `backend/grc/services/asset_criticality.py` (rewritten)
- `backend/grc/models.py` (2 new columns)
- `backend/grc/modules/compliance/schema_migrations.py` (2 idempotent ALTERs)
- `backend/grc/schemas.py` (override fields on all 4 ITAsset schemas)
- `backend/grc/routers/assets_router.py` (catalogue endpoint, preview endpoint, create/update override path, bulk template, bulk importer)
- `grc-frontend/src/app/(dashboard)/assets/page.tsx` (AssetModal form: 4 new inputs + live preview + override toggle)

---

## Notes for the next session

- Re-tune AI-drafting composite weights or per-section `min_words` after looking at real drafts produced for UBL.
- Add tenant-scoped admin UI for `CONNECTOR_MASTER_KEY` rotation when prod is wired.
- When real vendor instances arrive, promote beta-stub connectors (BMC, Wazuh, QRadar, Core Impact, Zoom, O365) out of beta by removing the `beta=True` flag in their `META` blocks.
- Consider adding a per-section "regenerate this one section" button on the AI-draft result view so users can iterate cheaply without redrafting the whole document.
