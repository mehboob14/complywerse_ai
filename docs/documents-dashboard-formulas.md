# Documents Dashboard — Formula Specification (v2, per-section)

**Scope:** Governance → Documents module. Each functional area (page) of the module is a
**section** with its own formulas computed from that area's own entities. Section scores
roll up into one module performance score. Nothing is aggregated "on the surface" — every
number is a ratio over that section's real rows.

**Backend source of truth:** `GET /governance/dashboard/documents-overview`
(`backend/grc/modules/governance/routers/dashboard.py`). Every metric returns
`numerator / denominator / weight / target / formula`; the frontend only renders.

**Scoring rules**
- *Achievement* metrics (coverage, completion): empty universe → `null`, excluded, and the
  section re-normalizes the remaining weights.
- *Health* metrics (`1 − bad/universe`): empty universe → `100` (no obligations = healthy).
- `section.score` = weighted mean of its non-null metrics.
- `performance.score` = weighted mean of non-null section scores. Grade: ≥85 excellent ·
  ≥70 good · ≥50 fair · <50 poor. Target per metric: 85.

---

## Table of Contents

1. [Section: Documents](#1-documents) — 18%
2. [Section: Mappings](#2-mappings) — 18%
3. [Section: Approvals & Sign-off](#3-approvals) — 14%
4. [Section: Reviews](#4-reviews) — 14%
5. [Section: Exceptions](#5-exceptions) — 9%
6. [Section: Attestations](#6-attestations) — 9%
7. [Section: Committees](#7-committees) — 9%
8. [Section: Regulatory](#8-regulatory) — 9%
9. [Attention Queue](#9-attention-queue)
10. [Module Performance Score](#10-performance)
11. [Roll-up plan](#11-roll-up)

---

## 1. Documents (weight 18%) <a name="1-documents"></a>
*Pages: Document Register, Document Detail. Tables: `grc_governance_documents`, `grc_policy_statements`.*

| Metric | Weight | Formula |
|---|---|---|
| Publishing | .20 | published documents ÷ active (non-archived) documents |
| Freshness | .20 | 1 − (published docs expired or review-overdue ÷ published docs) |
| Well-formed | .15 | docs with owner + classification + review cycle ÷ active docs |
| Has content | .15 | docs with an uploaded file or authored content ÷ active docs |
| Statements parsed | .15 | docs with parsed policy statements ÷ docs that have content |
| Gaps remediated | .15 | gap findings closed or risk-accepted ÷ all non-compliant gap findings |

## 2. Mappings (weight 18%) <a name="2-mappings"></a>
*Pages: Mappings, Detail→Controls tab, statement auto-map. Tables: `grc_document_control_links`,
`grc_document_risk_links`, `grc_document_regulatory_links`, `grc_document_asset_links`,
`grc_statement_control_mappings`; doc columns `framework_ids`, `applicable_framework_ids` (new).*

| Metric | Weight | Formula |
|---|---|---|
| Docs mapped | .45 | active docs linked to ≥1 control/risk/framework/asset ÷ active docs |
| Statements mapped | .35 | active statements with ≥1 control mapping ÷ active statements |
| Full-coverage maps | .20 | statement mappings with `coverage_type=full` ÷ all statement mappings |

## 3. Approvals & Sign-off (weight 14%) <a name="3-approvals"></a>
*Pages: My Approvals, Workflows, the new sign-off flow. Tables: `grc_document_approval_steps`,
`grc_document_signatures`, `grc_document_signoff_assignments` (new).*

| Metric | Weight | Formula |
|---|---|---|
| Queue health | .40 | 1 − (overdue pending steps ÷ pending steps) |
| Approval rate 90d | .30 | steps approved ÷ steps decided (last 90 days) |
| Signed-off published | .30 | published docs with a recorded approver signature ÷ published docs |

Info counts: avg decision days (mean `completed_at − requested_at`, 90d), signatures,
sign-off assignments, docs awaiting.

## 4. Reviews (weight 14%) <a name="4-reviews"></a>
*Pages: Reviews, Review Calendar. Tables: doc review columns, `grc_policy_review_history`.*

| Metric | Weight | Formula |
|---|---|---|
| Schedule coverage | .25 | approved/published docs **with** a next review date ÷ approved+published docs |
| Schedule health | .45 | 1 − (overdue reviews ÷ docs with a review schedule) |
| On-time reviews 12m | .30 | reviews completed on/before scheduled date ÷ completed reviews (12 months) |

Info counts: due 30/60/90 buckets, completed last 12 months.

## 5. Exceptions (weight 9%) <a name="5-exceptions"></a>
*Page: Exceptions. Table: `grc_policy_exceptions` (+ new `closed_at`, `promoted_risk_id`).*

| Metric | Weight | Formula |
|---|---|---|
| Containment | .60 | 1 − ((pending + expiring-30d) ÷ total exceptions) |
| Closed on time | .40 | exceptions closed on/before expiry ÷ closed exceptions with both dates |

Info counts: active, expired, promoted-to-risk.

## 6. Attestations (weight 9%) <a name="6-attestations"></a>
*Pages: Attestations, Campaigns, My. Tables: `grc_attestation_campaigns`, `grc_attestation_requests`.*

| Metric | Weight | Formula |
|---|---|---|
| Completion 12m | .50 | completed requests ÷ all requests (assigned last 12 months) |
| Overdue containment | .30 | 1 − (overdue open requests ÷ open requests) |
| Evidence linked | .20 | completed attestations linked to evidence ÷ completed attestations |

## 7. Committees (weight 9%) <a name="7-committees"></a>
*Pages: Committees, Meetings, Actions. Tables: `grc_governance_committees`,
`grc_committee_meetings`, `grc_meeting_minutes`, `grc_oversight_actions`.*

| Metric | Weight | Formula |
|---|---|---|
| Action health | .30 | 1 − (overdue oversight actions ÷ open oversight actions) |
| Actions completed | .20 | completed oversight actions ÷ all oversight actions |
| Meeting cadence | .20 | active committees that met in last 90 days ÷ active committees |
| Minutes recorded | .15 | completed meetings (180d) with minutes ÷ completed meetings (180d) |
| Quorum met | .15 | held meetings that reached quorum ÷ held meetings with quorum data |

**Committee page dashboard** (`GET /governance/committees/overview`) uses the same data with
its own headline formulas: actions `pct_done` = completed ÷ total; **avg attendance** =
mean(attendees ÷ committee members, capped 100%) over held meetings (falls back to the
quorum threshold as base when a committee has no member records — the old
`quorum_present ÷ quorum_required` average could exceed 100%); **quorum met rate** =
meetings reaching quorum ÷ held meetings with quorum data. Per-member "top performers":
completion = completed ÷ assigned, on-time = completed on/before due ÷ completed.

*(Still deferred: voting outcomes and charter validity — candidates for the committees
deep-dive.)*

## 8. Regulatory (weight 9%) <a name="8-regulatory"></a>
*Pages: Regulatory Changes, Regulatory Feeds. Tables: `grc_regulatory_changes`,
`grc_regulatory_impact_assessments`, `grc_regulatory_implementation_tasks`,
`grc_regulatory_feed_sources`, `grc_regulatory_feed_items`.*

| Metric | Weight | Formula |
|---|---|---|
| Changes resolved | .25 | changes completed or not-applicable / all regulatory changes |
| Changes assessed | .25 | applicable changes with >=1 impact assessment / applicable changes |
| Task health | .20 | 1 - (overdue implementation tasks / open implementation tasks) |
| Feed items triaged | .15 | feed items processed or ignored / all ingested feed items |
| Feeds polling | .15 | active sources successfully polled in last 7 days / active sources |

## 9. Attention Queue <a name="9-attention-queue"></a>
Absolute counts, each linking to the page that clears it:
```
total = docs awaiting approval + overdue reviews + docs expiring 30d
      + exception attention + open gap findings + overdue attestations
      + overdue oversight actions + overdue regulatory tasks
```

## 10. Module Performance Score <a name="10-performance"></a>
```
score = Documents×18% + Mappings×18% + Approvals×14% + Reviews×14%
      + Exceptions×9% + Attestations×9% + Committees×9% + Regulatory×9%
```
Sections with no data are excluded and weights re-normalize. This score is what the
Governance card on the future main dashboard will display.

## 11. Roll-up plan <a name="11-roll-up"></a>
1. **Documents module** (this doc) — ✅ implemented, per-section.
2. **Committees dashboard** — dedicated page: quorum, voting outcomes, attendance,
   charter lifecycle; its score replaces/augments the committees section here.
3. **Main dashboard** — module cards read each module's `performance.score` +
   attention counts; Overall Readiness = weighted blend of module scores. No metric is
   recomputed at the top level.

---

*Demo data:* `backend/seed_demo_governance_docs.py seed|cleanup` — tagged `DEMO-`/`[DEMO]`,
covers every section (documents, links, statements, sign-offs, reviews, exceptions,
attestations, committee with meetings/minutes/actions).
