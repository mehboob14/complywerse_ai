# TPRM Revamp — Build Plan (Phase 0 discovery + gap + schema diff)

> Status: **DRAFT — awaiting sign-off before any feature code.**
> Goal: grow the existing Vendor Risk / TPRA module into a full production TPRM platform —
> executive dashboard, vendor inventory, 11-stage lifecycle, questionnaire library,
> findings & remediation register, and continuous monitoring with risk tracked over time.
> **This is a gap-fill on top of a substantial existing foundation, not a rewrite.**

---

## 1. Discovery — what already exists (built earlier this conversation)

**Backend** — `backend/grc/modules/vendor_risk/tpra/`
- **13 models** (`backend/grc/models/_41_tpra_lifecycle_models.py`): `TPRAStageInstance`,
  `TPRAQuestion`, `TPRAQuestionResponse`, `TPRAFinding`, `TPRARemediation`,
  `TPRARiskAcceptance`, `TPRAContract`, `TPRAControlObligation`, `TPRAApproval`,
  `TPRAMonitoringSignal`, `TPRAAuditLog`, `TPRATieringConfig`, `TPRARiskDomain` (10 domains).
  The **versioned Assessment** reuses the existing `grc_vendor_assessments` (added
  version/lifecycle/tier columns). `Vendor` already has `reassessment_cadence_days` +
  `next_reassessment_date`.
- **Engines**: `engine_tiering` (configurable weights/thresholds → tier),
  `engine_scoring` (per-domain posture + residual + `residual_rating`, capped reduction,
  failed-critical-control → blocking finding), `engine_gates` (exit-criteria evaluator +
  blockers), `engine_monitoring` (signal → reassessment).
- **API**: 38 routes in `tpra/api.py` — lifecycle (init/advance/send-back/skip/gate),
  findings/remediation/acceptance CRUD, contracts/obligations, approvals, signals,
  run-tiering, run-scoring, reassess, and a **vendor `/board`**.
- **RBAC** (`tpra/rbac.py`, `vendor_risk:*` permission strings), **built-in templates**
  (`builtin_templates.py`: SIG Lite/Core, CAIQ, NIST CSF, ISO 27001, HECVAT, Privacy/DPA,
  Financial), **seed**, **teardown**, **service**, **stages**, **bootstrap**.
- **Tests**: pytest suite green (67) covering engines + per-stage CRUD + transitions + RBAC.

**Frontend** — `grc-frontend/src/app/(dashboard)/vendor-risk/`
- Pages: `page.tsx` (**legacy** dashboard), `vendors/page.tsx` (register),
  `vendors/[id]/page.tsx` (detail → **Lifecycle tab** renders the new `_tpra/` orchestrator),
  `assessments/` (list + detail), `questionnaires/page.tsx`.
- `_tpra/` components: `TpraLifecycle` (11-stage rail + gates + per-stage panels),
  `FindingsPanel`, `ContractsPanel`, `ApprovalPanel`, `SignalsPanel`, `DomainRiskView`.
- Stack: Next.js App Router, React Query, Tailwind, lucide-react, **recharts ^3.6.0**,
  `@/components/ui` primitives. Nav: legacy 3-tab layout (Vendor Risk / Assessments /
  Questionnaires).

**Infra**: per-tenant Postgres; no Alembic (additive `create_all` + `_COLUMN_ADDS`,
teardown script for down); Celery worker (parsing queue) + beat available; tsc baseline
**67 errors** (must hold).

---

## 2. Gap map — spec vs. existing

| Target capability | Today | Action |
|---|---|---|
| 11-stage lifecycle, gates, versioned reassessment, send-back, audit | ✅ exists | reuse |
| Tiering / residual scoring / gate engines (configurable, capped, critical-control) | ✅ exists | reuse + add A–F |
| Findings/remediation/acceptance, contracts, approvals, signals (per vendor) | ✅ exists | reuse |
| Built-in framework templates | ✅ exists (8) | add **library UI** + versioning |
| 10 risk domains + per-vendor radar | ✅ (`DomainRiskView`) | reuse in profile |
| **RiskSnapshot time-series** | ❌ **missing** | **new model + engine + endpoints** |
| **Executive dashboard** (KPIs + 7–8 live charts, role-aware) | ❌ legacy only | **new backend agg + recharts UI** |
| **A–F rating** from residual | ❌ (tier rating only) | small engine addition |
| **Cadence + snapshot engine** (review-due, write snapshots, signal→task) | ⚠️ partial | extend `engine_monitoring` + beat job |
| **Findings cross-portfolio register** screen | ❌ (per-assessment only) | new list endpoint + screen |
| **Monitoring feed** (portfolio) screen + triage + MTTD | ❌ (per-vendor `SignalsPanel`) | new endpoint + screen |
| **Vendor inventory revamp** (live inherent scoring on add, profile drawer/radar) | ⚠️ basic | enhance |
| **Left-nav IA** (Dashboard/Vendors/Assessments/Questionnaires/Findings/Monitoring/Risk360) | ⚠️ 3 tabs | restructure layout |
| Seed with **months of RiskSnapshots** + realistic data | ⚠️ no snapshots | extend seed |
| Tests for cadence/snapshot; keep existing green | partial | add |

---

## 3. Schema diff (additive; nothing dropped)

**New table — `grc_tpra_risk_snapshots` (RiskSnapshot):**
- `id`, `tenant_id`
- `scope` ('portfolio' | 'vendor'), `vendor_id` (nullable), `assessment_id` (nullable)
- `inherent_score` (Float), `residual_score` (Float), `rating_grade` (String — A–F),
  `residual_rating` (String — critical/high/medium/low)
- `open_findings` (Int), `critical_findings` (Int), `domain_scores` (JSON, vendor scope)
- `captured_at` (DateTime, idx), `source` ('score' | 'finding_close' | 'schedule' | 'seed')
- `created_at`

**New columns (via `_COLUMN_ADDS`):**
- `grc_vendor_assessments.rating_grade` (VARCHAR) — A–F snapshot of residual at score time.
- (Cadence fields already exist on `grc_vendors`.)

**No drops.** New table auto-creates via `create_all`; `teardown.py` extended to drop it
(reversible). Existing vendors/answers/assessments untouched and forward-compatible.

---

## 4. Engines / logic additions

- **A–F rating**: pure mapping from overall residual band (configurable thresholds, stored
  in `TPRATieringConfig`). Added to `engine_scoring` output + written to snapshots.
- **Snapshot writer**: `engine_snapshots.write_snapshot(scope, vendor_id?, source)` —
  called after `run-scoring`, on finding close, and by a scheduled job. Portfolio snapshot
  aggregates current vendor residuals + finding counts.
- **Cadence**: `engine_monitoring` extended — next-review by tier; a threshold-breaching
  signal raises a reassessment task early; "reviews due / overdue" derived from
  `next_reassessment_date`.
- **Dashboard aggregation**: read-only service computing the KPIs/series from live tables
  (no precompute beyond snapshots).

## 5. New API (read-mostly; RBAC-enforced, paginated)

- `GET /vendor-risk/tpra/dashboard` — KPI cards + chart datasets (tier dist, inherent-vs-
  residual by tier, findings posture/severity, findings-by-domain, top-residual vendors,
  reviews-due), role-aware (exec = portfolio, analyst = assigned queue).
- `GET /vendor-risk/tpra/risk-trend?scope=&vendor_id=&months=` — RiskSnapshot series +
  appetite threshold.
- `GET /vendor-risk/tpra/findings` — cross-portfolio findings register (filter/sort/page;
  SLA + overdue + closure-velocity fields).
- `GET /vendor-risk/tpra/monitoring/feed` — portfolio signal feed (+ triage, MTTD).
- Snapshot write hooks on existing `run-scoring` / finding-close.

## 6. Build phases (each: shippable, tested, holds tsc 67 + pytest green)

1. **Snapshots + rating + cadence engine** (model, `_COLUMN_ADDS`, `engine_snapshots`,
   A–F, write hooks) + **unit tests** + extend `teardown`.
2. **Seed** extended: realistic vendors across tiers, templates w/ questions across 10
   domains, findings, signals, **8–12 months of RiskSnapshots** so the dashboard is alive.
3. **Dashboard + trend API** (backend agg) + **integration tests**.
4. **Findings register API + Monitoring feed API** (cross-portfolio).
5. **Frontend IA**: left-nav shell (Dashboard / Vendors / Assessments / Questionnaires /
   Findings / Monitoring / Risk 360°).
6. **Dashboard UI** (recharts: KPI cards + sparklines, tier donut, inherent-vs-residual
   bars, risk-trend area + appetite line, findings posture, findings-by-domain, monitoring
   feed, top-residual vendors), role-aware.
7. **Vendor inventory revamp** (live inherent scoring on add, profile drawer + radar) +
   **Findings register screen** + **Monitoring feed screen** + **Questionnaire library UI**.
8. **Polish**: empty/loading/error/permission states, a11y (labels not colour-only,
   reduced-motion), responsiveness, audit views.

## 7. Decisions — LOCKED (2026-06-29)

- **A. IA / nav → EXTEND THE CURRENT TAB BAR.** Add Dashboard / Findings / Monitoring (and
  Risk 360°) tabs to the existing `/vendor-risk` tabbed layout; do not switch to a left-nav app.
- **B. Snapshot cadence → EVENT + DAILY SCHEDULE.** Write a RiskSnapshot on every score/
  re-score and finding-close, plus a daily portfolio snapshot via the existing Celery beat.
- **C. Rating scale → ADD A–F ALONGSIDE TIER.** Derive an A–F grade from residual
  (configurable thresholds in `TPRATieringConfig`), keep Critical/High/Medium/Low too.
- **D. UX reference → USER WILL PROVIDE `Sentinel-TPRM.html`.** Backend phases (1–4) proceed
  now (HTML-independent); the UI phases (5–8) replicate the demo's screens/interactions on
  the real stack once the file is provided.
- **E. Sequencing**: phased, verified each phase (tsc 67 + pytest green), no regression.

### Build order given the above
Start **Phase 1 (snapshots + A–F + cadence engine + tests)** now — pure backend, cannot
conflict with the forthcoming HTML. Then Phase 2 seed, Phase 3–4 dashboard/findings/
monitoring APIs (data shapes come from the written spec). UI phases begin when the HTML lands.

Reused defaults (no decision unless you object): **recharts** for charts; existing
**`vendor_risk:*` RBAC**; existing **evidence file storage**; existing **workflow/notification**
mechanism; tiering/scoring thresholds in **`TPRATieringConfig`** (configurable).
