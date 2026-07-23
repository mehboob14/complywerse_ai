# TPRA (Third-Party Risk Assessment) Productionization — Build Plan

> Status: **APPROVED — building in phases.** Decisions locked (§8). Phase 1 ✅ complete.
> Scope: extend & refactor the existing Vendor Risk module (under ERM) into a production
> 11-stage TPRA lifecycle with per-stage CRUD, gates, tier right-sizing, RBAC, scoring,
> versioned assessments, and an audit trail — **without breaking existing functionality.**

---

## 1. What exists today (discovery result)

**Backend** (`backend/grc/modules/vendor_risk/`, models in `backend/grc/models/_35_vendor_risk_management_models.py`)

- **7 tables:** `grc_vendors`, `grc_vendor_assessments`, `grc_vendor_questionnaire_templates`,
  `grc_vendor_questionnaire_responses`, `grc_vendor_questionnaire_evidence`,
  `grc_vendor_sla_records`, `grc_vendor_incidents`.
- **6 routers / ~28 endpoints** mounted at `/vendor-risk`: `vendors`, `assessments`,
  `questionnaires` (incl. token-based external/no-auth flow), `monitoring` (SLA + incidents),
  `lifecycle` (8-stage), `ai_analysis` (tier/gap/remediation/score/summary — GPT-4o).
- **8-stage lifecycle** stored as a **mutable blob on the Vendor row**:
  `vendor.lifecycle_stage` (string) + `vendor.lifecycle_history` (JSON), plus JSON blobs for
  `remediation_actions`, `offboarding_checklist`, `gap_analysis` (on assessment).
  Stages: intake → tiering → due_diligence → rating → remediation → contracting → monitoring → offboarding.
- **Engines:** tier cadence map (`TIER_CADENCE_DAYS`), AI tier recommendation, AI gap analysis,
  weighted scoring on `assessments/{id}/score`, gate-ish approve on `assessments/{id}/approve`
  (creates a Risk Register entry — `linked_risk_id`).
- **Linkages:** Assessment approve → Risk Register (`category=third_party`); critical incident →
  auto-creates an Issue; vendor → contract Governance Document (loose FK).

**Frontend** (`grc-frontend/src/app/(dashboard)/vendor-risk/`)

- 8 pages: dashboard, vendor register + detail (`_TpraLifecyclePanel.tsx`), assessments list/detail,
  questionnaires (internal mgmt + external token response).
- `vendorRiskApi` (28 methods) in `src/lib/api.ts`. Nav entry under **Risk Management →
  Vendor Risk** (`/vendor-risk`, permission `erm:risks:*`).
- Conventions: React Query, Tailwind, lucide-react, `RightSlidePanel`, `DataTable`,
  `MultiSelectDropdown`, `usePermissions()`.

**Infra realities (constrain the plan):**

- **No Alembic, no reversible migrations.** Schema evolves additively:
  `Base.metadata.create_all(checkfirst=True)` for new tables + append-only `_COLUMN_ADDS` list
  (`backend/grc/modules/compliance/schema_migrations.py`) for new columns. **Down-migrations do
  not exist in this repo.**
- **Per-tenant physical DB.** Control/data tables have no `tenant_id` semantics beyond the vendor
  tables which DO carry `tenant_id` (vendor tables are tenant-scoped by column).
- **No backend test harness** (no pytest config, no `tests/`). Tests would be net-new infra.
- **No feature-flag framework.** "Behind a flag" = additive parallel code paths, not a toggle system.
- **RBAC primitives exist:** `Role`, `Permission`, `RolePermission`, `UserRole`; `require_auth`,
  `get_user_tenants`. Permission strings like `vendor_risk:vendors:create` already referenced in UI.

---

## 2. Target vs. existing — gap map

| Target capability | Today | Action |
|---|---|---|
| **11 stages** (gates on 02 & 08) | 8 stages, 1 implicit gate | Re-map 8→11; split due_diligence→(03 planning,04 q&e), rating→(05 scoring,06 findings); add explicit 08 Approval gate, 09 Onboarding; merge 11 reassess+offboard |
| **Versioned assessments** (no history loss on reassessment) | single mutable vendor blob | **Refactor**: lifecycle state moves onto a versioned Assessment + per-stage instance rows |
| **LifecycleStageInstance** rows (status, gate decision, exit result, assigned roles) | none (blob) | New table `grc_tpra_stage_instances` |
| **Normalized Findings / Remediation / RiskAcceptance** | JSON arrays | New tables (soft-delete) |
| **Approval record** (decision, conditions, approver, rationale; append-only) | inline on assessment approve | New table `grc_tpra_approvals` |
| **Contract / ControlObligation** with renewal dates | loose `contract_document_id` | New tables |
| **MonitoringSignal** (typed, severity, triggers reassessment) | SLA + incidents only | New table `grc_tpra_monitoring_signals` |
| **10 Risk Domains** | free-form findings | Seeded domain set (constant + optional table) |
| **Configurable tiering weights/thresholds** | magic numbers | Config table/settings row |
| **Append-only audit log** for every mutation/transition/gate | partial (lifecycle_history blob) | New table `grc_tpra_audit_log` |
| **Per-stage CRUD** (list/paginate/filter/sort, detail, create, edit, soft-delete+restore) | partial, varies | Uniform CRUD per artifact, server-validated |
| **RBAC by RACI** (7 roles, server-enforced + UI-mirrored) | tenant-scoping only | Permission map + named roles + checks |
| **Optimistic concurrency** | none | `version`/`updated_at` checks on edits |
| **Reversible migrations + reversible** | additive only | Document as additive + teardown script (see Decision B) |
| **Tests** (engine unit + CRUD/permission integration) | none | Stand up pytest harness (see Decision C) |
| **Seed script** (vendors, templates, questions, mid-lifecycle demo) | none (zero-trust) | Opt-in seed script |

---

## 3. Stage re-map (8 → 11)

| New # | Target stage | Gate | From existing |
|---|---|:--:|---|
| 01 | Intake & Scoping | | `intake` |
| 02 | Inherent Risk Tiering | ⬢ | `tiering` |
| 03 | Due Diligence Planning | | split from `due_diligence` |
| 04 | Questionnaire & Evidence | | split from `due_diligence` (reuses existing questionnaire engine) |
| 05 | Risk Analysis & Scoring | | split from `rating` (reuses existing scoring) |
| 06 | Findings & Remediation | | split from `rating` + `remediation` |
| 07 | Contracting & Controls | | `contracting` |
| 08 | Approval Decision | ⬢ | promoted from `assessments/approve` |
| 09 | Onboarding & Enablement | | new (was folded into `contracting` go-live) |
| 10 | Continuous Monitoring | | `monitoring` |
| 11 | Reassessment & Offboarding | | `monitoring` reassess + `offboarding` |

Stages are **data-driven** (a `STAGES` definition table/constant drives UI + gate logic), never
hard-coded into the UI. Stage status ∈ {not_started, in_progress, blocked, complete, skipped}.
Skips allowed only where tier rules permit; reason + actor recorded.

---

## 4. Proposed data-model diff (additive; nothing dropped)

**Refactor (additive columns on existing tables — via `_COLUMN_ADDS`):**

- `grc_vendor_assessments` → becomes the **versioned Assessment**. Add:
  `version_no INT`, `supersedes_id INT`, `lifecycle_status VARCHAR`, `inherent_tier VARCHAR`,
  `residual_rating VARCHAR`, `current_stage VARCHAR`, `version INT` (optimistic-concurrency), `deleted_at TIMESTAMP`.
- `grc_vendors` → keep `lifecycle_stage`/`lifecycle_history` for back-compat (read-through), add
  `active_assessment_id INT`, `deleted_at TIMESTAMP`.

**New tables (auto-create via `create_all`):**

- `grc_tpra_stage_instances` — (assessment_id, stage_key, status, started_at, completed_at,
  assigned_roles JSON, exit_criteria_result JSON, gate_decision JSON, skipped_reason, skipped_by, version).
- `grc_tpra_findings` — (assessment_id, domain, severity, description, source_response_id, status,
  is_critical_control_fail, created_by, version, deleted_at).
- `grc_tpra_remediations` — (finding_id, owner_id, plan, due_date, status, version, deleted_at).
- `grc_tpra_risk_acceptances` — (finding_id, rationale, accepted_by, expiry, version, deleted_at).
- `grc_tpra_contracts` — (vendor_id, assessment_id, type[dpa/sla/addendum/master], terms,
  effective/renewal/expiry dates, version, deleted_at).
- `grc_tpra_control_obligations` — (contract_id, obligation, control_ref, renewal_date, status, version, deleted_at).
- `grc_tpra_approvals` — (assessment_id, decision, conditions JSON, approver_id, rationale, created_at) **append-only**.
- `grc_tpra_monitoring_signals` — (vendor_id, type, severity, source, occurred_at, triggered_reassessment, note).
- `grc_tpra_audit_log` — (entity, entity_id, action, actor_id, from_value, to_value, reason, at) **append-only**.
- `grc_tpra_tiering_config` — (key, weights JSON, thresholds JSON) configurable engine inputs.
- `grc_risk_domains` — seeded 10 domains (Cybersecurity, Data Privacy, Operational Resilience,
  Financial Viability, Compliance & Regulatory, Reputational, Geographic/Geopolitical,
  Fourth-Party/Concentration, ESG & Sustainability, Legal & Contractual).

**Questionnaire questions/responses:** see Decision A — normalize into rows vs. keep current JSON.

---

## 5. Engines (business logic, configurable)

1. **Inherent tiering (02 gate):** weighted score from data sensitivity, business criticality,
   system access, regulatory scope, fourth-party reliance → tier. Weights/thresholds in
   `grc_tpra_tiering_config`. Tier drives depth, suggested templates, reviewer requirements, cadence.
2. **Scoring (05):** Yes=1/Partial=0.5/No=0 (N-A excluded), `critical_control` weighted higher;
   `residual = inherent × (1 − reduction×control_effectiveness)`, reduction capped (70%).
   Any failed critical control → forced blocking finding regardless of headline score.
3. **Decision recommendation (08):** advisory recommendation from residual tier + open critical
   findings; recorded human decision is authoritative.
4. **Gate evaluator:** reusable `evaluate_gate(stage_instance) → {passed, blockers[]}`; blockers
   surfaced in UI.
5. **Cadence / reassessment triggers:** next-review by tier; monitoring signal over threshold
   creates a reassessment task and can reopen the lifecycle into a **new assessment version**.

---

## 6. RBAC (RACI → permissions)

Roles: Business Owner, TPRM Analyst, TPRM Lead, Security/Privacy/Legal Reviewer,
Approver/Risk Committee, Vendor Contact (external, token — reuse existing no-auth flow), Admin.
Permission strings `vendor_risk:<resource>:<action>` enforced **server-side** (authoritative) and
mirrored in UI (hide/disable). Gate-approve, send-back, risk-acceptance, and offboard are
restricted actions. See Decision D for whether named roles are seeded as system roles.

---

## 7. Phased delivery (each phase: shippable, verified, no regression)

- **Phase 1 — Data model + migrations + seed.** New tables/columns; back-compat read-through from
  vendor blob; seed script (opt-in) with templates, 10-domain questions, a mid-lifecycle demo vendor.
- **Phase 2 — Engines + tests.** Tiering, scoring, gate evaluator, recommendation, cadence — with
  unit tests (boundary tiers, failed critical control) on a new pytest harness.
- **Phase 3 — API + RBAC.** Per-stage CRUD (list/detail/create/edit/soft-delete+restore),
  transitions, gate decisions, send-back/reopen, optimistic concurrency, audit logging, server RBAC.
- **Phase 4 — Lifecycle UI.** 11-stage rail/board with gate markers (02, 08), stage panels with
  per-stage CRUD surfaces, blocker display, vendor register, residual domain view, template library.
  Production states (loading/empty/error/permission-denied/unsaved-guard), a11y + responsive.
- **Phase 5 — Monitoring / reassessment loop.** Signals, triggers, versioned reopen without history loss.
- **Phase 6 — Polish.** Accessibility, structured logging on transitions/gates, edge states.

**Verification each phase:** backend `py -3 -m py_compile` + import check (`SESSION_SECRET=… py -3 -c`);
frontend `npx tsc --noEmit` must hold the **67-error baseline**; new pytest suite green.

---

## 8. Decisions — LOCKED (2026-06-27)

- **A. Architecture depth → FULL NORMALIZED.** Versioned Assessment + stage-instance rows + all
  new normalized tables AND normalize questionnaire questions & responses into rows (per-question
  CRUD). Existing JSON questionnaire/external-token flow is migrated forward (responses backfilled
  into rows; old JSON columns retained for back-compat, never dropped).
- **B. Migrations → ADDITIVE + TEARDOWN SCRIPT.** Repo norm: `create_all` + `_COLUMN_ADDS`; plus a
  documented idempotent teardown script for the new TPRA tables. No Alembic.
- **C. Tests → PYTEST: ENGINES + KEY INTEGRATION.** New pytest harness. Unit-test tiering/scoring/
  gate (boundary tiers, failed critical control); integration-test per-stage CRUD + transitions + RBAC.
- **D. RBAC → PERMISSION STRINGS ONLY.** Define & enforce `vendor_risk:<resource>:<action>` strings
  server-side, mirror in UI; do **not** seed named system roles — admins grant to their own roles.

### Full-normalized addendum (questionnaire)

- New `grc_tpra_questions` (template_id, domain, weight, critical_control, type, order, deleted_at)
  and `grc_tpra_question_responses` (assessment_id, question_id, answer[Yes/Partial/No/N-A], note,
  version, deleted_at). Existing `grc_vendor_questionnaire_responses.responses` JSON is backfilled
  into rows by the migration; the JSON column is retained (read-through) and kept in sync so the
  external token flow keeps working during transition.

Nothing in Phases 1–6 hard-deletes data or removes existing endpoints; the current `/vendor-risk`
pages keep working throughout (old blob fields retained, read-through during transition).

---

## 9. Progress log

### Phase 1 — Data model + migrations + seed ✅ (2026-06-27)

- **New models** (`backend/grc/models/_41_tpra_lifecycle_models.py`, chained into the package via
  `__init__.py`): 13 tables — `grc_tpra_stage_instances`, `grc_tpra_questions`,
  `grc_tpra_question_responses`, `grc_tpra_findings`, `grc_tpra_remediations`,
  `grc_tpra_risk_acceptances`, `grc_tpra_contracts`, `grc_tpra_control_obligations`,
  `grc_tpra_approvals`, `grc_tpra_monitoring_signals`, `grc_tpra_audit_log`,
  `grc_tpra_tiering_config`, `grc_risk_domains`. All carry `deleted_at` (soft-delete) and/or
  `row_version` (optimistic concurrency) where they hold history.
- **Additive columns** on `grc_vendors` (`active_assessment_id`, `deleted_at`) and
  `grc_vendor_assessments` (`version_no`, `supersedes_id`, `lifecycle_status`, `current_stage`,
  `inherent_tier`, `residual_rating`, `domain_scores`, `row_version`, `deleted_at`) — added to the
  models (fresh tenants) AND registered in `schema_migrations._COLUMN_ADDS` (existing tenants).
  Legacy JSON blobs retained for back-compat. New tables auto-create via `create_all`.
- **TPRA subpackage** (`backend/grc/modules/vendor_risk/tpra/`):
  `stages.py` (pure 11-stage helpers, gates, tier skip-rules, cadence, reviewers),
  `bootstrap.py` (idempotent per-tenant domains + default tiering config; engine fallback),
  `builtin_templates.py` (8 templates / 65 domain-tagged questions: SIG Lite, SIG Core, CAIQ,
  NIST CSF, ISO 27001 Annex A, HECVAT, Privacy & DPA, Financial Viability),
  `seed.py`, `teardown.py`.
- **Verified:** mappers configure cleanly; 13 tables registered; legacy columns + all 31 existing
  vendor-risk routes intact (no regression). Frontend untouched (tsc baseline unaffected).

**Seed / rollback commands (opt-in, per tenant):**
```
SESSION_SECRET=… py -3 -m grc.modules.vendor_risk.tpra.seed --slug <slug> --demo
SESSION_SECRET=… py -3 -m grc.modules.vendor_risk.tpra.teardown --slug <slug> --demo-only
SESSION_SECRET=… py -3 -m grc.modules.vendor_risk.tpra.teardown --slug <slug> --drop-tables [--drop-columns]
```

### Phase 2 — Engines + tests ✅ (2026-06-27)

- **Engines** (pure, config-aware, in `tpra/`): `engine_tiering.py` (weighted 0..100 inherent score
  → tier, profile-fallback factors), `engine_scoring.py` (Yes/Partial/No/N-A → per-domain posture;
  `residual = inherent × (1 − 0.70 × posture)`; failed critical control forces a blocking finding
  and floors the rating at High), `engine_gates.py` (per-stage exit criteria + blockers, hard gates
  on tiering/approval, advisory `recommend_decision`), `engine_monitoring.py` (reassessment triggers
  + tier cadence).
- **Test harness** (the repo's first): `backend/pytest.ini`, `backend/conftest.py` (sets a dummy
  SESSION_SECRET + sys.path). `tests/test_tpra_engines.py` (43) + `tests/test_tpra_monitoring.py` (8).
  **51 passing.** Covers threshold boundaries (75/50/25 cut-offs), N-A exclusion, critical-control
  failure blocking, gate pass/block, and decision recommendations.

### Phase 3 — API + RBAC for per-stage CRUD + transitions ✅ (2026-06-27)

- **Service** (`tpra/service.py`): stage instantiation, gate-context builder + evaluator,
  advance/send-back/skip, gate decisions, `run_tiering`/`run_scoring` (auto-creates blocking
  critical findings, idempotent), `create_reassessment_version` (supersede prior, new version +
  stages, no history loss), append-only audit on every mutation.
- **RBAC** (`tpra/rbac.py`, Decision D): reads auth-only; writes require `vendor_risk:<resource>:<action>`
  with `erm:risks:edit` fallback (no access regression); Administrator + primary-contact bypass.
  Added the `vendor_risk` module (31 perms) to `grc/permissions.py` so admins can grant them.
- **API** (`tpra/api.py`, mounted at `/vendor-risk/tpra`): **37 routes** — lifecycle (stages, get,
  init, advance, send-back, skip, gate-decision, run-tiering, run-scoring, reassess, version list),
  findings + remediations + risk-acceptances CRUD (soft-delete + restore), contracts + control
  obligations CRUD, append-only approvals (with advisory recommendation), monitoring signals CRUD
  (auto-triggers a reassessment version on a qualifying signal). Optimistic concurrency
  (`row_version`/409) on edits; pagination/filter/sort on findings list.
- **Tests:** `tests/test_tpra_lifecycle_integration.py` (16) — SQLite-backed, exercises stage
  instantiation, gate blocking, tiering, scoring auto-findings, findings gate
  (remediation/acceptance unblock), send-back invalidation, versioned reassessment, skip rules,
  audit logging, RBAC deny/admin. **Full suite: 67 passing.**
- **Verified:** full app builds (1747 routes, 273 tables); 37 TPRA routes mounted; legacy
  `/vendor-risk` routes intact; no regression.

### Phase 4 — Lifecycle UI + stage panels ✅ (2026-06-28)

- **API client** (`grc-frontend/src/lib/api.ts`): new `tpraApi` (37 methods) for the
  `/vendor-risk/tpra/*` endpoints, grouped (lifecycle, findings/remediation/acceptance,
  contracts/obligations, approvals, signals).
- **Component set** (`vendor-risk/vendors/[id]/_tpra/`): `types.ts`, `constants.ts` (stage
  metadata: objective/activities/accountable roles per stage + badge helpers),
  `TpraLifecycle.tsx` (orchestrator: completion ring, phase-grouped **stage rail** with gate
  markers on 02/08 + status chips, active **stage panel** showing objective/activities/roles/
  exit-criteria + **blocker display**, advance/send-back/skip/run-tiering/run-scoring/reassess),
  `FindingsPanel.tsx` (findings CRUD incl. status edit + soft-delete/**restore** + remediation +
  risk-acceptance), `ContractsPanel.tsx` (contracts + obligations CRUD), `ApprovalPanel.tsx`
  (advisory recommendation + append-only decision history + record decision), `SignalsPanel.tsx`
  (monitoring signals; surfaces auto-triggered reassessment), `DomainRiskView.tsx` (10-domain
  residual breakdown).
- **Wiring:** vendor detail page Lifecycle tab now renders `<TpraLifecycle/>` (legacy
  `_TpraLifecyclePanel.tsx` retained on disk, unimported, for rollback).
- **States:** loading / empty-with-CTA / error-with-retry / permission-gated actions throughout.
  RBAC mirrors the server (`vendor_risk:*` with `erm:risks:edit` fallback).
- **Verified:** `npx tsc --noEmit` holds the **67-error baseline**; zero errors in new code.

### Phase 5 — Monitoring/reassessment loop ✅ — engine + API done in Phase 3 (signal → versioned
reassess); SignalsPanel surfaces it in the UI (toast on auto-trigger). Cadence sweep (scheduled job)
left as a follow-up hook.

### UX rebuild — Assessments workspace + surfacing ✅ (2026-06-28)

The new lifecycle was buried (vendor detail → non-default Lifecycle tab); the `/vendor-risk/assessments`
page was still the legacy flat per-type list. Reworked so the lifecycle is the spine:

- **Backend**: new `GET /vendor-risk/tpra/board` — vendor-centric summary (tier, current stage,
  residual, open/critical finding counts, next review) for the active assessment, in two grouped
  queries (no N+1). +1 integration test (suite now **68**).
- **Assessments page rebuilt** (`vendor-risk/assessments/page.tsx`) into the TPRA workspace: one row
  per vendor with a compact 11-dot **stage rail**, tier + residual badges, open-findings (critical
  highlighted), next-review, and row → the vendor's Lifecycle tab. Stat cards (in-lifecycle / awaiting
  onboarding / open findings / high-residual), tier+stage+search filters, and a **“Start lifecycle”**
  onboarding panel (pick vendor → `initLifecycle` → open lifecycle).
- **Shared** `vendor-risk/_lib/lifecycleShared.tsx` (`StageProgress` mini rail + stage constants/helpers),
  reused by the workspace and the register.
- **Vendor detail** now defaults to the **Lifecycle** tab; **vendor register** gained a Lifecycle column.
- Verified: tsc **67** baseline held, backend **68** tests, no regression.

### Phase 6 — Polish, states, accessibility ✅ (2026-06-28)

- **Reduced-motion**: app-wide `@media (prefers-reduced-motion: reduce)` guard added to
  `globals.css` (was absent) — neutralises animations/transitions for users who request it.
- **Unsaved-changes guard**: `useUnsavedGuard` hook (`beforeunload`) wired into every TPRA create
  form (findings, remediation, acceptance, contract, obligation, signal, send-back/skip reasons).
- **a11y**: keyboard-accessible stage rail (buttons + `aria-current="step"`), `aria-label`s on icon
  buttons and unlabelled selects, `role="img"` + `aria-label` on domain residual bars; RightSlidePanel
  already handles Escape/scroll-lock/`aria-modal`.
- **CRUD completeness**: added inline finding status edit + the soft-delete **restore** UX
  (“Show removed” toggle; `deleted_at` surfaced on the serializer).
- **Verified:** frontend tsc baseline 67; backend `py_compile` + **67 pytest** green; 37 TPRA routes
  intact. Vendor register + template library already satisfied by existing `/vendor-risk/vendors`
  and `/vendor-risk/questionnaires` pages (tier/status/residual indicators present).
