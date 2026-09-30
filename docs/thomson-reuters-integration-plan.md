# Thomson Reuters / LSEG Integration — Build Plan

> Status: **DRAFT — awaiting sign-off before any feature code.**
> Scope: integrate three external data products into ComplyVerse:
>
> 1. **World-Check One** (LSEG — formerly Thomson Reuters) → TPRM sanctions / PEP / adverse-media
>    screening of vendors **and their key people**, with ongoing screening.
> 2. **Thomson Reuters CLEAR** → TPRM **due-diligence enrichment** (public records, liens,
>    judgments, bankruptcies, Risk Inform flags).
> 3. **Thomson Reuters Regulatory Intelligence (TRRI)** → Governance → **Regulatory Changes**
>    (currently RSS-only).
>
> Everything is built **inside ComplyVerse** (no separate TPRM product), additively, without
> breaking the existing TPRA lifecycle, and **fully usable today via a simulated (mock)
> provider** — real credentials plug in later per tenant.

---

## 0. Decisions captured (2026-09-30 Q&A)

| # | Question | Decision |
|---|---|---|
| Q1 | Which products | World-Check One **+** CLEAR **+** Regulatory Intelligence |
| Q2 | "plus ComplyVerse" | TR data also feeds Governance → Regulatory Changes; everything lives in ComplyVerse only |
| Q3 | API access today | **None yet** → build against the published spec with a built-in **simulated provider**; real creds later |
| Q4 | Whose credentials | **Per-tenant** — each tenant enters its own keys; stored encrypted |
| Q5 | Who is screened | **Vendor organisation + key people** (directors, UBOs, key contacts) |
| Q6 | What a match does | ✅ Analyst resolution workflow (synced back to WC1) · ✅ Findings + blocking · ✅ Ongoing-screening → monitoring signals · ❌ *not selected:* "unresolved matches block the Approval gate" |
| Q7 | CLEAR's role | **Due-diligence enrichment** (not a second screening source) |
| Q8 | Delivery | **This plan first**, sign-off, then phased build |

Consequence of Q6: approval is blocked **only through findings** (a confirmed sanctions hit →
critical blocking finding, which the existing gate engine already enforces). An unresolved
*potential* match on its own never blocks a gate — it is surfaced as a work-queue item instead.

---

## 1. Ownership & naming (important for contracts and UI labels)

| Product | Owner today | Notes |
|---|---|---|
| World-Check One | **LSEG** ("LSEG Risk Intelligence") | TR bought World-Check in 2011; it moved to Refinitiv (2018) and to LSEG (Jan 2021). Contract, keys and docs come from LSEG (developers.lseg.com), not Thomson Reuters. |
| CLEAR | Thomson Reuters | Strongest coverage is **US** persons/businesses. US permissible-purpose rules (GLBA / DPPA) apply to every search. |
| Regulatory Intelligence | Thomson Reuters | Excluded from the 2018 Refinitiv sale; still TR. |

UI copy will say "World-Check One (LSEG)" rather than "Thomson Reuters World-Check".

---

## 2. Discovery — seams that already exist (we plug into these, not around them)

**TPRM / TPRA** (`backend/grc/modules/vendor_risk/tpra/`)
- `monitoring_connectors.py` — `MonitoringConnector` base, `SignalDraft`, empty `CONNECTORS`
  registry, `run_connectors()`; explicitly documented as the seam for live feeds. Row-ingestion +
  `external_id` dedup is a stated TODO.
- Celery: `grc.tasks.tprm.poll_monitoring_connectors_sweep` is **already on beat every 6h**
  (`celery_app.py`, `tprm-monitoring-connector-poll`) and fans out per tenant. Currently a no-op.
- Signal → reassessment logic lives **inline in the route** `POST /vendor-risk/tpra/vendors/{id}/signals`
  (`api.py`): `should_trigger_reassessment` + in-flight debounce + `service.create_reassessment_version`.
  Connectors need the same path → it must move into a service function (Phase 0).
- Findings: `TPRAFinding` (domain, severity, `is_critical_control_fail`, `linked_issue_id`,
  `linked_risk_id`). `service.count_open_critical` feeds the `findings` and `approval` gates
  (`engine_gates.py`); `service.enforce_critical_invariant` **suspends an already-onboarded vendor**
  with an open critical; `service.ensure_finding_issue` mirrors findings into Issues.
- Audit: `service.write_audit(...)` → append-only `grc_tpra_audit_log`.
- Additive schema: new tables via `create_all`; new columns via `tpra/schema_migrations._TPRA_ADDS`
  (`ADD COLUMN IF NOT EXISTS`, self-healing) and `modules/compliance/schema_migrations._COLUMN_ADDS`.
- RBAC: `vendor_risk:<resource>:<action>` strings (`grc/permissions.py`), enforced by
  `tpra/rbac.require_write` with `erm:risks:edit` fallback.

**Credentials**
- `IntegrationConnection` (`grc_integration_connections`) already models "any external connector":
  `category`, `integration_type`, `encrypted_credentials`, `oauth_tokens`, `provider_config`,
  `status`, `last_success_at`, `last_error`, `consecutive_failures`. Unique per `(tenant, connection_name)`.
- `services/connector_credentials.py` — Fernet with `CONNECTOR_MASTER_KEY` (dev-mode fallback is
  base64 with a `dev::` sentinel + a "no encryption configured" signal for the UI).

**Governance → Regulatory feeds** (`modules/governance/routers/regulatory_feeds.py`)
- `RegulatoryFeedSource.source_type ∈ {rss, atom, api}` but **every source — including `api` — is
  polled by `poll_rss_feed()`** (feedparser). There is no real API path.
- **No scheduled polling**: only manual `POST /sources/{id}/poll` and `POST /poll-all`, even though
  sources carry `poll_interval_hours`.
- Downstream flow is good and reused as-is: `RegulatoryFeedItem` (guid-deduped) → AI analysis
  (`/items/{id}/analyze`) → convert to `RegulatoryChange` → impact assessment → implementation tasks.
- (Side note, out of scope: the file registers `POST /sources` twice — lines ~380 and ~1079.)

**Frontend** (`grc-frontend/src/app/(dashboard)/`)
- `vendor-risk/` tabbed layout (Dashboard / Vendors / Assessments / Findings / Monitoring /
  Questionnaires / Risk 360° / Exchange + Settings gear). Vendor detail tabs: Lifecycle /
  Overview / Assessments / SLA / Incidents. Monitoring page states "Manually-logged signals for now".
- `vendor-risk/settings/page.tsx` — tiering/cadence config (`tpraApi.getConfig/saveConfig`).
- `governance/regulatory-feeds/page.tsx`, `governance/regulatory-changes/`.
- Conventions: React Query, Tailwind, lucide-react, `usePermissions()`, `useToast`, `tpraApi` in
  `src/lib/api.ts`.

**Network reality:** this dev environment's egress policy blocks LSEG/TR hosts, and no customer
credentials exist yet. All automated tests run against the simulated provider + recorded
fixtures; live validation happens in the customer's environment (Phase 7).

---

## 3. External API facts (from public sources — ✅ verified-by-source / ⚠️ must confirm with licensed docs)

Public docs could not be opened directly from this environment; the facts below come from vendor
pages via search extracts and open-source client code. **Every ⚠️ item is confirmed against the
licensed docs before live cut-over (Phase 7).** The adapters isolate these details so a correction
is a one-file change.

### 3.1 World-Check One (LSEG)
- ✅ Versions **v2** and **v3**; LSEG recommends **v3 for new customers**, v2 "still supported".
- ✅ v2 gateway `https://api-worldcheck.refinitiv.com/v2` (pilot vs production distinguished by
  credentials). ⚠️ Newer host `https://api.risk.lseg.com/screening/v2|v3`. Old
  `*.thomsonreuters.com` pilot host no longer resolves. → **base URL is per-connection config.**
- ✅ v2 auth: HTTP-Signature HMAC-SHA256 —
  `Authorization: Signature keyId="<key>",algorithm="hmac-sha256",headers="(request-target) host date content-type content-length",signature="<b64>"`;
  string-to-sign = lowercase `name: value` lines joined by `\n`, **body appended for POST/PUT**;
  GET signs `(request-target) host date`; `Date` in RFC-1123 GMT. ⚠️ OAuth 2.0 also offered (token
  URL unverified) — likely the v3 route.
- ✅ v2 endpoints: `GET /groups`, `GET /groups/{id}/resolutionToolkit`, `POST /cases/screeningRequest`
  (create + sync screen), `POST /cases/{caseSystemId}/screeningRequest`, `GET /cases/{id}/results`,
  `PUT /cases/{id}/results/resolution`, `PUT|DELETE /cases/{id}/ongoingScreening`,
  `POST /cases/ongoingScreeningUpdates`, `GET /reference/profile/{profileId}`,
  `…/mediacheck/results` (paginated). ⚠️ v3 paths/schemas.
- ✅ Entity types INDIVIDUAL / ORGANISATION / VESSEL; provider types WATCHLIST / CLIENT_WATCHLIST /
  MEDIA_CHECK / PASSPORT_CHECK; `matchStrength` WEAK / MEDIUM / STRONG / EXACT; secondary fields
  SFCT_1 gender, SFCT_2 DOB, SFCT_3 country location, SFCT_4 place of birth, SFCT_5 nationality,
  SFCT_6 registered country.
- ✅ Resolution = `statusId` / `riskId` / `reasonId` **defined per group by the resolution toolkit**
  (not fixed enums) → we fetch and cache the toolkit per connection and map it.
- ⚠️ Rate limits: community reports ~1 req/s and 5,000/day with HTTP 429 — we design for it
  (client-side token bucket + backoff) regardless.

### 3.2 CLEAR ("CLEAR System-to-System", S2S)
- ✅ REST-style, **XML** requests (`PersonSearchRequestV3`, `PermissiblePurpose` with GLB/DPPA),
  **search → retrieve report** flow (`ReportId`, `SectionResults`); beta host `s2s.beta.thomsonreuters.com`.
- ✅ Auth observed with **client certificates** issued to the account. ⚠️ Whether basic auth is also
  required; production host; business search/report schemas; Risk Inform/Adverse Media endpoints.
- ✅ Risk Inform flag families: criminal/arrest, sanctions, lawsuits, liens & judgments (amount
  thresholds), bankruptcy, multiple SSNs, death indicators, news, web analytics, real-time
  incarceration; score = sum of admin-configurable per-flag scores.
- ✅ S2S cannot create alerts (Batch Alerts is the route) → **CLEAR is on-demand enrichment only**
  in this plan (matches Q7); no CLEAR monitoring.

### 3.3 Regulatory Intelligence
- ✅ REST API documented on developerportal.thomsonreuters.com; example
  `GET https://api.thomsonreuters.com/regulatory-intelligence/v1/documents/{id}`;
  **OAuth 2.0 client-credentials** (API key + secret → bearer token, ≤60 min).
- ✅ Alternative bulk channel: **XML feeds to customer SFTP** (unified schema, taxonomy management).
- ⚠️ Search/list/changes endpoints, token URL, metadata field names (jurisdiction, regulator, topic,
  doc type, dates).

---

## 4. Architecture

```
                 ┌──────────────── ComplyVerse (per-tenant DB) ─────────────────┐
 TPRM Settings ─▶│ IntegrationConnection (category=screening|enrichment|regcontent)│
 Gov. Feeds UI  │   encrypted_credentials · provider_config{mode: mock|live, …}    │
                 │                  │                                               │
                 │        grc/integrations_tr/  (NEW shared package)               │
                 │   http.py  – signed client, retries, 429 token-bucket, timeouts  │
                 │   registry.py – get_provider(connection) → live | simulated     │
                 │   wc1/ (hmac auth, client, mapper, simulated)                   │
                 │   clear/ (cert auth, xml client, mapper, simulated)             │
                 │   trri/ (oauth client, mapper, simulated)                       │
                 │        │                  │                     │              │
                 │  TPRM screening      TPRM enrichment      Regulatory feeds     │
                 │  (cases/matches →    (CLEAR report →      (TRRI docs →         │
                 │   findings/signals)   domain red flags)    RegulatoryFeedItem)  │
                 └──────────────────────────────────────────────────────────────┘
 Celery beat: tprm-monitoring-connector-poll (exists, 6h) · regulatory-feed-poll (NEW, hourly tick,
              honours poll_interval_hours)
```

Principles
- **One provider interface, two implementations** (live + simulated). Business logic never knows
  which is active; the simulated provider returns deterministic, realistic data and every record
  it produces is stamped `simulated=true` and badged **SIMULATED** in the UI (never mistakable for
  real screening evidence in an audit).
- **Credentials only via `IntegrationConnection`** + `connector_credentials` (Fernet). Secrets are
  write-only in the API (never returned), never logged; a "Test connection" endpoint validates them.
  Production without `CONNECTOR_MASTER_KEY` → saving *live* credentials is refused (mock allowed).
- **Raw provider payloads are stored** (JSON) next to normalised fields for audit/regulator
  evidence, with the adapter version that parsed them.
- **Idempotent + deduped** ingest keyed by provider ids (`caseSystemId`, `resultId`, doc id).
- **Everything audited** in `grc_tpra_audit_log` (screen, resolve, sync, finding-create, enrich).

---

## 5. Schema diff (additive; nothing dropped)

**New tables** (TPRM, `backend/grc/models/_57_tr_integration_models.py`):

- `grc_tpra_vendor_people` — key people per vendor: `vendor_id`, `full_name`, `role`
  (director | ubo | key_contact | signatory | other), `ownership_pct`, `date_of_birth` (nullable),
  `nationality`, `country_location`, `gender` (nullable), `include_in_screening` (bool),
  `deleted_at`, `row_version`. *PII: only what screening needs; DOB optional (improves precision).*
- `grc_tpra_screening_subjects` — one per screened party (vendor org or person) per provider:
  `vendor_id`, `person_id` (nullable → org), `connection_id`, `provider` ('wc1'),
  `entity_type` (ORGANISATION|INDIVIDUAL), `submitted_name`, `secondary_fields` (JSON),
  `external_case_id` (caseSystemId), `ongoing_screening` (bool), `last_screened_at`,
  `status` (not_screened | screening | clear | potential_matches | confirmed_hit | error),
  `simulated` (bool), `last_error`.
- `grc_tpra_screening_matches` — one per provider result: `subject_id`, `vendor_id`,
  `external_result_id` (unique per subject), `reference_id` (profile id), `matched_name`,
  `match_strength`, `provider_type` (WATCHLIST | MEDIA_CHECK | …), `categories` (JSON, e.g.
  ["SANCTIONS","PEP"]), `countries` (JSON), `hit_class` (sanctions | pep | adverse_media |
  law_enforcement | other — our normalisation), `resolution_status` (unresolved | positive |
  possible | false | unspecified), `risk_level`, `reason`, `remark`, `resolved_by`, `resolved_at`,
  `sync_status` (not_required | pending | synced | failed), `sync_error`, `linked_finding_id`,
  `first_seen_via` (screen | ongoing), `raw` (JSON), `simulated`, `row_version`.
- `grc_tpra_enrichment_reports` — CLEAR reports: `vendor_id`, `person_id` (nullable),
  `connection_id`, `provider` ('clear'), `external_report_id`, `permissible_purpose`,
  `risk_score`, `flags` (JSON list of `{family, label, severity, domain, detail, source_ref}`),
  `summary` (JSON: registration, officers, addresses…), `raw` (JSON/XML text),
  `requested_by`, `fetched_at`, `simulated`.
- `grc_tr_provider_cache` — per-connection cached reference data (WC1 groups, resolution toolkit):
  `connection_id`, `key`, `value` (JSON), `fetched_at`.

**New columns**
- `grc_tpra_monitoring_signals`: `external_id` VARCHAR (+ index; dedup key — the TODO in
  `monitoring_connectors.py`), `source_ref` JSON (e.g. `{match_id, subject_id}`), `simulated` BOOLEAN
  → via `tpra/schema_migrations._TPRA_ADDS`.
- `grc_regulatory_feed_sources`: `connection_id` INTEGER, `provider_query` JSON (jurisdictions,
  regulators, topics, doc types) → via `_COLUMN_ADDS`.
- `grc_regulatory_feed_items`: `external_metadata` JSON (jurisdiction, regulator, topic, doc type,
  effective date as provided) → via `_COLUMN_ADDS`.

**Enum extensions (no DDL; string columns)**
- Signal types: + `sanctions`, `pep`, `adverse_media` (exists), `law_enforcement`.
- `RegulatoryFeedSource.source_type`: + `tr_regulatory_intelligence`.
- `IntegrationConnection.category`: + `screening`, `enrichment`, `regulatory_content`;
  `integration_type`: `lseg_world_check_one`, `tr_clear`, `tr_regulatory_intelligence`.

Teardown: extend `tpra/teardown.py` to drop the new tables/columns (reversible, as per repo norm).

---

## 6. Behaviour (engines & rules)

### 6.1 Screening (World-Check One)
1. **Who**: the vendor org (ORGANISATION, SFCT_6 = registered country) + every
   `vendor_people` row with `include_in_screening` (INDIVIDUAL, SFCT_1/2/3/5 when known).
2. **When**: on demand ("Screen now" on the vendor Screening tab or per person); **auto** when the
   lifecycle enters `dd_planning` (configurable toggle); re-screen whenever a name/secondary field
   changes.
3. **How**: `POST /cases/screeningRequest` (sync) → store case id + results; enable ongoing
   screening per subject (`PUT /cases/{id}/ongoingScreening`) when the tenant setting says so
   (default: on for high/critical tier vendors, off otherwise — configurable).
4. **Normalise** each result → `hit_class` from provider categories (sanctions / PEP /
   adverse media / law enforcement / other).

### 6.2 Analyst resolution (Q6 ✅)
- Queue of `unresolved` matches (vendor tab + portfolio "Screening" work queue). Analyst chooses
  status **Positive / Possible / False / Unspecified**, risk, reason (options come from the
  group's cached **resolution toolkit** in live mode; a default toolkit in simulated mode) +
  mandatory remark for Positive/False.
- **Sync back** to WC1 via `PUT /cases/{id}/results/resolution`: attempted immediately; on failure
  `sync_status=failed` and retried by the 6-hourly sweep; visible badge + retry button. The local
  decision is authoritative for ComplyVerse gates either way.
- Re-resolution allowed (full history in audit log).

### 6.3 Findings + blocking (Q6 ✅) — mapping table (configurable in Settings)

| Resolved **Positive** hit class | Finding severity | Domain | Critical-control fail (blocking) |
|---|---|---|---|
| Sanctions | **critical** | compliance | **yes** → blocks `findings` + `approval` gates; suspends an already-onboarded vendor (existing `enforce_critical_invariant`) |
| Law enforcement | high | compliance | no |
| PEP | high | compliance | no (PEP is a risk factor, not a prohibition) |
| Adverse media | medium (high if match strength STRONG/EXACT) | reputational | no |
| Possible (any class) | no finding; stays in queue flagged "needs EDD" | — | no |

- Finding created once per match (`linked_finding_id`), attached to the vendor's **active
  assessment** (created via `ensure_active_assessment` if needed), mirrored to Issues by the
  existing `ensure_finding_issue`.
- If a match is later re-resolved to False, the finding is closed with an audit reason (not deleted).
- Unresolved matches **do not** block any gate (Q6 ❌ gate option) — the approval panel shows an
  informational "N unresolved screening matches" notice only.

### 6.4 Ongoing screening → signals (Q6 ✅)
- `WorldCheckOneConnector(MonitoringConnector)` registered in `CONNECTORS`; `is_configured()` is
  **per tenant** (active connection exists). *Change:* `run_connectors` gets the tenant's
  connection instead of relying on env.
- `poll()` → `POST /cases/ongoingScreeningUpdates` since last cursor → fetch new/changed results
  for affected cases → upsert matches (`first_seen_via=ongoing`) → emit `SignalDraft` per **new**
  match: type from hit class (`sanctions`/`pep`/`adverse_media`/`law_enforcement`), severity
  (sanctions = critical, law enforcement/PEP = high, adverse media = medium/high by strength),
  `external_id = wc1:<caseSystemId>:<resultId>`.
- **Ingest refactor (Phase 0):** move the route's signal logic into
  `service.ingest_signal(db, vendor, draft, actor_id=None)` (dedup by `external_id`, create row,
  `should_trigger_reassessment`, in-flight debounce, audit). The existing route and connectors both
  call it → identical behaviour. `ALWAYS_TRIGGER_TYPES` gains `sanctions`.
- Monitoring page copy changes from "Manually-logged signals for now" to show connected feeds
  (per `any_connector_configured()`, made tenant-aware).

### 6.5 CLEAR enrichment (Q7)
- "Run CLEAR report" on the vendor (org) and optionally a key person; **permissible purpose is
  mandatory** (dropdown of GLB/DPPA purposes, stored on the report) — required by US law for CLEAR.
- Flow: business/person search → pick candidate (analyst confirms the right entity when >1) →
  retrieve report → normalise to `flags` with domain mapping:
  liens / judgments / bankruptcy → **financial**; lawsuits → **legal**; criminal / arrest /
  sanctions → **compliance**; news → **reputational**; registration/address anomalies →
  **operational**.
- Flags are **advisory by default**: shown on the vendor Screening tab and in the Intake / DD
  Planning stage panels; the analyst clicks "Raise finding" to promote one (prefilled severity/
  domain). *(See open decision B for auto-creation.)*
- Reports are immutable snapshots; re-running creates a new one (history kept).

### 6.6 Regulatory Intelligence → Regulatory Changes
- New source type `tr_regulatory_intelligence` on `RegulatoryFeedSource`, linked to a TRRI
  `IntegrationConnection`, with `provider_query` (jurisdictions, regulators, topics, doc types).
- Poll dispatch fixed: `poll_feed_source()` routes by `source_type` (`rss|atom` → existing
  `poll_rss_feed`, `tr_regulatory_intelligence` → TRRI provider); `api` keeps today's behaviour.
- TRRI documents → `RegulatoryFeedItem` (guid = TRRI document id; title, summary, link, published
  date, `external_metadata`) → **existing** AI analysis + "convert to Regulatory Change" flow unchanged.
- **New Celery beat** `regulatory-feed-poll` (hourly tick; polls sources whose
  `poll_interval_hours` has elapsed) — benefits RSS feeds too, which today are manual-only.

---

## 7. API (new routes; RBAC-enforced, paginated)

**Connections** (TPRM Settings & Governance Feeds share one router: `/integrations/tr`)
- `GET /integrations/tr/connections` · `POST` · `PUT /{id}` · `DELETE /{id}` (soft deactivate)
- `POST /integrations/tr/connections/{id}/test` → auth check (e.g. WC1 `GET /groups`), stores `status`.
- `GET /integrations/tr/connections/{id}/wc1/groups` (live group picker) — secrets never returned.

**TPRM screening** (`/vendor-risk/tpra/...`)
- Key people: `GET|POST /vendors/{id}/people`, `PUT|DELETE /people/{pid}`, `POST /people/{pid}/restore`
- `POST /vendors/{id}/screening/run` (all subjects or `subject_ids`) · `GET /vendors/{id}/screening`
  (subjects + match summary)
- `GET /screening/matches` (portfolio queue: filter vendor / status / hit class / strength)
- `GET /screening/matches/{mid}` (+ provider profile via `/reference/profile`, cached)
- `PUT /screening/matches/{mid}/resolution` (status, risk, reason, remark, `row_version`)
- `POST /screening/matches/{mid}/sync` (retry push to WC1)
- `PUT /vendors/{id}/screening/ongoing` (toggle per subject/vendor)

**CLEAR**
- `POST /vendors/{id}/enrichment/clear/search` → candidates · `POST .../clear/report` (candidate
  id, permissible purpose) · `GET /vendors/{id}/enrichment` · `POST /enrichment/{rid}/flags/{idx}/finding`

**Governance**
- Existing `/governance/regulatory-feeds/sources` accepts the new source type + `connection_id` +
  `provider_query`; existing poll endpoints dispatch by type.

**Permissions** (added to the `vendor_risk` module in `grc/permissions.py`):
`vendor_risk:screening:view|run|resolve`, `vendor_risk:enrichment:view|run`,
`vendor_risk:integrations:manage`; Governance uses existing governance feed permissions +
`governance:integrations:manage`. Same `erm:risks:edit` fallback pattern as today.

---

## 8. UI

- **TPRM → Settings**: new **"Data providers"** section — World-Check One and CLEAR cards: mode
  (Simulated / Live), base URL, credentials (write-only fields; CLEAR accepts cert + key upload),
  WC1 group picker, ongoing-screening default by tier, auto-screen-at-DD toggle, hit-class →
  finding mapping table, **Test connection**, health (last success / last error / encryption status).
- **Vendor detail → new "Screening" tab**: Key people table (add/edit/remove, include toggle) ·
  "Screen now" · subject list with status chips · match list (strength, class, categories,
  countries) → **resolution drawer** (toolkit-driven options, remark, sync badge, profile details) ·
  CLEAR report card (score, flags by domain, "Raise finding", history) · SIMULATED badges.
- **Lifecycle panels**: Intake & DD Planning show a screening/enrichment summary + shortcuts;
  Approval panel shows the informational unresolved-matches notice.
- **Vendor-risk tabs**: new **"Screening"** portfolio work queue (unresolved matches across vendors,
  sync failures). Monitoring page: new signal-type filters + connected-feed banner.
- **Governance → Regulatory Feeds**: "Add source → Thomson Reuters Regulatory Intelligence"
  (connection picker, jurisdictions/regulators/topics), per-item TRRI metadata chips.
- Production states throughout (loading / empty / error / permission-denied), a11y conventions as
  in the TPRA phases.

---

## 9. Simulated provider (the "mock") — how it behaves

- Deterministic: same input → same output (hash of normalised name), so demos and tests are stable.
- Built-in fixture persona set (clearly fictitious names), e.g. a name containing a sanctions
  fixture token returns an EXACT sanctions match; PEP and adverse-media fixtures likewise; all
  other names return 0–2 WEAK/MEDIUM adverse-media noise hits so the resolve workflow is exercisable.
- Simulates ongoing-screening updates (new match appears on the next poll for flagged fixtures),
  429 / timeout / auth-failure modes (for resilience tests), CLEAR reports with each flag family,
  and a TRRI document stream across a few jurisdictions.
- Payload **shapes mirror the documented provider schemas** (§3) so swapping to live exercises the
  same mappers.

---

## 10. Security, privacy & compliance notes

- Credentials: Fernet via `connector_credentials` (`CONNECTOR_MASTER_KEY` required for live mode);
  CLEAR client cert/key stored encrypted; secrets never returned or logged; test-connection
  results logged without payloads.
- PII (key people, DOB): minimum fields, tenant-scoped, soft-delete, access behind
  `vendor_risk:screening:view`. Raw provider payloads contain PII too → same permission.
- CLEAR permissible purpose captured per request (GLBA/DPPA) and shown in the audit trail.
- Provider ToS: stored WC1/CLEAR content is used only inside the licensing tenant (no cross-tenant
  reuse via the Exchange feature — exchange packages exclude screening data).
- Outbound: live mode needs egress to the provider hosts from the backend + Celery workers.

---

## 11. Phases (each shippable, tested; existing pytest suite green, tsc baseline held)

| Phase | Content | Tests |
|---|---|---|
| **0 Foundation** | `grc/integrations_tr/` package (HTTP client, 429 token bucket/backoff, registry, simulated base); connections router + test-connection; `service.ingest_signal` refactor (route uses it — no behaviour change); `external_id` dedup; tenant-aware connector registry | unit: client retry/backoff, credential round-trip, ingest dedup; regression: existing signal route tests |
| **1 WC1 screening + resolution** | models, HMAC signer, WC1 client + mapper + simulated provider, key people CRUD, screen/resolve/sync APIs, resolution toolkit cache, finding mapping (§6.3) | HMAC string-to-sign against published example vectors; mapper fixtures; sanctions-positive → critical finding → approval gate blocked; false → finding closed; sync-failure retry; RBAC |
| **2 Ongoing screening** | `WorldCheckOneConnector.poll`, OGS enable/disable, signals, reassessment trigger | poll → signal → reassessment; dedup on repeated polls; in-flight debounce |
| **3 TPRM UI** | Settings "Data providers", vendor Screening tab + resolution drawer, portfolio queue, lifecycle/monitoring touches | tsc baseline; manual walkthrough in simulated mode |
| **4 CLEAR enrichment** | cert-auth XML client + mapper + simulated, search→report flow, flags, raise-finding, UI card | XML mapper fixtures per flag family; permissible-purpose required |
| **5 Regulatory Intelligence** | TRRI OAuth client + mapper + simulated, source type, dispatch fix, beat task, UI | token refresh; guid dedup; dispatch by type; beat interval logic; RSS unchanged |
| **6 Hardening** | audit views, health surfacing, rate-limit dashboards, docs (`docs/SETUP.md` env + onboarding), teardown | end-to-end simulated scenario |
| **7 Live cut-over** *(needs your credentials/docs)* | confirm every ⚠️ in §3, adjust adapters, pilot-tenant validation | contract tests against provider sandbox |

---

## 12. Open decisions for sign-off

- **A. World-Check One API version.** v2 (HMAC; best public documentation) now with v3 behind the
  same interface later, **or** target v3 first (LSEG's recommendation for new customers, but its
  schemas are not publicly verifiable yet). *Recommendation:* ask LSEG which version your contract
  provisions; until then build v2 + keep the auth/transport layer pluggable (OAuth ready).
- **B. CLEAR flags → findings.** Advisory with one-click "Raise finding" (**recommended**), or
  auto-create findings for high-severity flags (e.g. bankruptcy, sanctions)?
- **C. TRRI channel.** REST API polling (**recommended**, fits the existing feed model) or the
  SFTP XML feed (bulk, needs an SFTP drop + parser)?
- **D. Auto-screen trigger.** Auto-screen when a vendor enters DD Planning (**recommended**, on by
  default) — or manual only?
- **E. Ongoing-screening default.** On for high/critical-tier vendors only (**recommended**; WC1
  ongoing screening is usually licensed per record) — or all vendors?
- **F. Key-people fields.** Capture DOB and nationality (better precision, more PII) — **recommended**
  optional fields — or name + role + country only?
- **G. Sanctions positive on an already-onboarded vendor.** Reuse existing TPRM-002 behaviour
  (auto-**suspend** vendor until the critical finding is remediated/accepted) — **recommended** —
  or notify only?

Once A–G are confirmed, Phase 0 starts.
