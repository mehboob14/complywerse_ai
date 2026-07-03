# Documents Dashboard — Formula Specification

**Scope:** Governance → Documents module. This document is the single reference for how the
Documents Overview dashboard (`/governance`) is calculated: what each page in the module
carries, what values it produces, and which formula each value feeds.

**Backend source of truth:** `GET /governance/dashboard/documents-overview`
(`backend/grc/modules/governance/routers/dashboard.py`). Every score in the payload is
returned with its `numerator`, `denominator`, `weight`, `target`, and `formula` string —
the frontend renders these values and never computes its own math.

---

## Table of Contents

1. [Module map — pages and what they carry](#1-module-map)
2. [Value inventory — what each page produces](#2-value-inventory)
3. [Formula catalog](#3-formula-catalog)
   - 3.1 Publishing Rate
   - 3.2 Mapping Coverage
   - 3.3 Approval Health / Approval Rate / Avg Decision Time
   - 3.4 Review Health / On-Time Review Rate
   - 3.5 Exception Health
   - 3.6 Freshness
   - 3.7 Attention Queue
   - 3.8 Documents Performance Score (composite)
4. [Lineage — how values flow into the Overview page](#4-lineage)
5. [Values not yet in a formula (candidates)](#5-candidates)
6. [Roll-up plan (committees → main dashboard)](#6-roll-up-plan)

---

## 1. Module map

Every page under Governance that creates or changes the data the dashboard measures.

| # | Page | Route | What it carries | Mutations that move dashboard numbers |
|---|------|-------|-----------------|----------------------------------------|
| 1 | **Overview (the dashboard)** | `/governance` | Consumes everything below; renders the formulas | none (read-only) |
| 2 | **Document Register** | `/governance/documents` | The portfolio: title, code, type, status, owner, version, classification, effective/expiry dates, review cycle | Create / edit / delete / upload / publish / AI-draft — changes `status`, `doc_type`, `expiry_date`, `next_review_date` |
| 3 | **Document Detail** | `/governance/documents/[id]` | One document: viewer, statements, control links, gap findings, review history | Parse statements, run gap analysis, accept-risk / fix findings, submit for review, publish — changes `status`, gap `remediation_status`, version |
| 4 | **My Approvals** | `/governance/approvals` | Items awaiting the current user's sign-off | Approve / reject / delegate — changes `DocumentApprovalStep.status`, `completed_at` |
| 5 | **Workflows** | `/governance/workflows` | Approval templates + all pending/overdue steps | Approve / reject steps; template edits set `due_date` behaviour (timeout_days) |
| 6 | **Reviews** | `/governance/reviews` | Review schedule: next_review_date, last_reviewed_at, cycle, overdue/upcoming | Complete review — writes `PolicyReviewHistory` row, resets `next_review_date` |
| 7 | **Review Calendar** | `/governance/reviews/calendar` | Same review data by month/day | none (navigation view) |
| 8 | **Mappings** | `/governance/mappings` | Document ↔ control links (plus risk/regulatory/asset links per doc) | Link / unlink control — adds or removes `DocumentControlLink` rows |
| 9 | **Exceptions** | `/governance/exceptions` | Policy exceptions: status, priority, justification, expiry | Create / submit / approve / reject / revoke — changes `PolicyException.status`, `expiry_date` |
| 10 | **Attestations** | `/governance/attestations` (+ campaigns, my) | Campaigns, pending/overdue attestations, completion rate | Complete attestation, link to evidence — changes attestation status |

Backing tables (all tenant-scoped): `grc_governance_documents`, `grc_document_approval_steps`,
`grc_policy_review_history`, `grc_document_control_links`, `grc_document_risk_links`,
`grc_document_regulatory_links`, `grc_document_asset_links`, `grc_policy_exceptions`,
`grc_policy_gap_findings`.

---

## 2. Value inventory

The raw values each page produces, and the formula(s) that consume them.

| Value | Produced by (page) | Stored in (table.column) | Consumed by formula |
|-------|--------------------|--------------------------|---------------------|
| Document status (draft → published → expired/archived) | Register, Detail, Approvals | `governance_documents.status` | 3.1 Publishing, 3.6 Freshness, 3.4 Review universe |
| Document type / classification | Register | `.doc_type`, `.classification` | Portfolio Mix donut (counts only) |
| Expiry date | Register | `.expiry_date` | 3.6 Freshness, 3.7 Attention (expiring 30d) |
| Next review date + cycle | Register, Reviews | `.next_review_date`, `.review_cycle_months` | 3.4 Review Health, 3.7 Attention |
| Control links | Mappings, Detail (Controls tab) | `document_control_links` | 3.2 Mapping Coverage |
| Risk links | Mappings | `document_risk_links` | 3.2 Mapping Coverage |
| Framework links / framework_ids | Mappings, Register (create) | `document_regulatory_links`, `.framework_ids` | 3.2 Mapping Coverage |
| Asset links | Mappings | `document_asset_links` | 3.2 Mapping Coverage |
| Approval step status / due date / timestamps | Approvals, Workflows | `document_approval_steps.status,.due_date,.requested_at,.completed_at` | 3.3 all approval metrics, 3.7 Attention |
| Review completion events | Reviews (Complete Review) | `policy_review_history.review_status,.scheduled_date,.completed_at` | 3.4 On-Time Review Rate |
| Exception status / expiry | Exceptions | `policy_exceptions.status,.expiry_date` | 3.5 Exception Health, 3.7 Attention |
| Gap findings (open) | Detail (Gap Analysis tab) | `policy_gap_findings.remediation_status` | 3.7 Attention (open gaps) |
| Attestation completion rate | Attestations | attestation campaign tables | shown on Overview (Health Snapshot ring); **not yet** in composite — see §5 |

---

## 3. Formula catalog

All ratios are percentages rounded to 1 decimal. "Active documents" = status ≠ `archived`.
Health-style metrics with an empty universe (no obligations) = **100** by definition;
achievement-style metrics with an empty universe = **0**.

### 3.1 Publishing Rate
```
publishing_rate = published_documents / active_documents × 100
```
Says how much of the governed portfolio is actually live. Weight in composite: **0.20**.

### 3.2 Mapping Coverage
```
mapping_coverage = documents_with_≥1_link / active_documents × 100
link = control link ∪ risk link ∪ framework link (incl. framework_ids) ∪ asset link
```
A document that governs nothing it can be traced to is uncovered. Weight: **0.20**.
Per-type detail (controls/risks/frameworks/assets → link count + distinct docs) feeds the
**Document Linkage** card.

### 3.3 Approvals
```
approval_health   = (1 − overdue_pending_steps / pending_steps) × 100      (100 if no pending)
approval_rate     = approved_steps / decided_steps × 100                    (window: last 90 days)
avg_decision_days = mean(completed_at − requested_at)                       (window: last 90 days)
```
`overdue` = pending step whose `due_date` < now. Health weight: **0.15**. Rate and cycle time
feed the **Workflow Performance** card.

### 3.4 Reviews
```
review_health       = (1 − overdue_reviews / scheduled_documents) × 100     (100 if none scheduled)
on_time_review_rate = reviews_completed_on_or_before_schedule / completed_reviews × 100   (window: 12 months)
```
`scheduled_documents` = approved/published docs with a `next_review_date`.
Health weight: **0.20**. Due-in-30/60/90 buckets feed Workflow Performance + Attention Queue.

### 3.5 Exception Health
```
exception_attention = pending_approval + approved_expiring_within_30d
exception_health    = (1 − exception_attention / total_exceptions) × 100    (100 if none)
```
Weight: **0.10**.

### 3.6 Freshness
```
stale     = published docs that are expired (expiry_date < now) OR review-overdue
freshness = (1 − stale / published_documents) × 100                          (100 if none published)
```
Weight: **0.15**.

### 3.7 Attention Queue (absolute counts, not a ratio)
```
attention_total = documents_awaiting_approval + overdue_reviews
                + documents_expiring_30d + exception_attention + open_gap_findings
```
Each addend is one segment of the Attention Queue donut and links to the page that clears it
(Approvals, Reviews, Register, Exceptions, Detail→Gap Analysis).

### 3.8 Documents Performance Score (composite)
```
score = 0.20·publishing + 0.20·mapping_coverage + 0.20·review_health
      + 0.15·approval_health + 0.15·freshness + 0.10·exception_health

grade: ≥85 excellent · ≥70 good · ≥50 fair · <50 poor
target per component: 85 (returned by the backend, shown on the radar)
```
This score is what the **Governance card on the future main dashboard** will display.

---

## 4. Lineage

How a user action travels to the Overview page:

```
Register/Detail (publish doc)      → documents.status            → 3.1 Publishing  ┐
Mappings (link control/risk/…)     → document_*_links            → 3.2 Coverage    │
Approvals/Workflows (approve step) → approval_steps.status/dates → 3.3 Approvals   ├─ 3.8 Performance Score
Reviews (complete review)          → review_history + next_review→ 3.4 Reviews     │      │
Exceptions (approve/expire)        → policy_exceptions.status    → 3.5 Exceptions  │      ▼
Register (expiry passes)           → documents.expiry_date       → 3.6 Freshness   ┘  Overview page:
Detail (gap analysis run)          → gap_findings (open)         → 3.7 Attention ───► KPIs · donuts · radar
                                                                                      linkage · workflow cards
```

Overview widget → formula mapping:

| Overview widget | Data used |
|---|---|
| KPI row (Documents / Published / Pending Flow / Coverage) | totals, 3.1, pending steps, 3.2 |
| Document Status donut | `by_status` counts |
| Portfolio Mix donut | `by_type` counts |
| Attention Queue donut | 3.7 (five segments) |
| Governance Posture Radar | the six components of 3.8 (score vs target) |
| Health Snapshot rings | 3.1, 3.2, attestation completion, 3.8 score+grade |
| Document Linkage card | 3.2 per-type detail |
| Workflow Performance card | 3.3 + 3.4 detail (rate, cycle days, on-time, due buckets) |

---

## 5. Values not yet in a formula (candidates)

Present in the module but not yet feeding the composite — candidates for a later iteration:

- **Attestation completion rate** — shown on the Overview ring but not weighted into 3.8.
- **Gap remediation progress** (`closed / total findings`) — endpoint exists (`/remediation-progress`).
- **Policy statement count / parsed coverage** — % of documents with parsed statements.
- **Version churn** (versions per doc per year) — signal of stability vs. thrash.
- **Owner load** (`/owner-statistics`) — docs per owner, unassigned count.
- **Regulatory change assessments** — belongs to the regulatory module's own step.

## 6. Roll-up plan

1. **Documents** (this document) — ✅ implemented.
2. **Committees** — same pattern: one overview endpoint with formulas over meetings held vs
   scheduled, quorum rate, open/overdue oversight actions, charter validity, attendance/votes.
3. **Main dashboard** — each module card shows its module's composite score (Governance card
   = 3.8 score + attention counts); "Overall Readiness" = weighted blend of module scores.
   Modules are never recomputed at the main-dashboard level — they expose one endpoint each.
