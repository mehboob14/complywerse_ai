# Risk Management Dashboard — Formula Spec (v3 — Register + Assessments IMPLEMENTED)

**Implementation status (2026-07-03):** `GET /erm/dashboard/sections-overview`
(`backend/grc/modules/erm/routers/dashboard.py`) serves the first two sections —
**Risk Register** and **Risk Assessments** — rendered as graphical section cards with
detail popups on the ERM overview (`/erm`). Remaining sections plug into the same
endpoint step by step; the module score re-normalizes over sections present.
Demo data: `backend/seed_demo_erm.py seed|cleanup` ([DEMO]-tagged).

Implemented formulas (deeper than the original proposal — every page activity counts):
- **Register** (w .18): exposure containment (1 − high/critical residual ÷ scored, .25) ·
  risk reduction ((Σinh−Σres)÷Σinh, .20) · fully scored (.15) · ownership (.10) ·
  linked to context (assets/controls/evidence, .15) · treatment defined (plan or
  in_treatment/mitigated/accepted status, .15)
- **Assessments** (w .14): assessments completed (manual approved/closed + framework
  completed ÷ all, .25) · question progress (.20) · register coverage 12m (.20) ·
  evidence-backed answers (completed framework questions with evidence ÷ completed, .15) ·
  AI entries reviewed (1 − overdue target_review_date ÷ open entries, .20)
- Attention queue: critical open risks + unscored active risks + blocked questions +
  overdue AI reviews.

---

# Original proposal (v2) — remaining sections below still to implement

**Status: PROPOSAL — nothing implemented yet.** Same per-section model as the Governance/
Documents dashboard: every ERM page is a section with formulas over its own tables; section
scores roll into one module performance score that the main dashboard's Risk card will
consume. Score bands used throughout: residual/inherent score = likelihood (1–5) × impact
(1–5), range 1–25; **critical ≥ 20, high ≥ 12, medium ≥ 6, low < 6** (existing backend bands).

---

## 1. Module map — pages and what they carry

| # | Page(s) | Carries | Mutations that would move formulas |
|---|---------|---------|-------------------------------------|
| 1 | **ERM Home** `/erm` | consumes everything (heatmap, KRI, top risks, posture) | none — rendering only |
| 2 | **Risk Register** `/erm/risks/*` | risks: status (open/in_treatment/mitigated/accepted/closed), inherent & residual L×I scores, category, owner, source, links to assets/controls/evidence | create/edit/close risk, score it, link asset, treatment plan |
| 3 | **Risk Assessments** `/erm/risk-assessments/*` (manual + framework + AI) | assessments (draft→in_progress→under_review→approved→closed), assessed risks w/ scores + treatment decisions, framework questions (not_started→completed) + evidence | create/assess/approve; answer questions |
| 4 | **RCSA** `/erm/rcsa` | templates, campaigns (draft/active/closed), assessments (not_started→submitted→approved), responses + evidence, findings (open→remediated) | run campaigns, submit/approve, remediate findings |
| 5 | **KRIs** `/erm/kris` | indicators: thresholds, current status (green/amber/red), frequency, measurements, linked risks | create KRI, record measurement |
| 6 | **Appetite** `/erm/appetite` | per-category appetite level, max acceptable score, tolerance, breaches | set/adjust thresholds |
| 7 | **Mitigation Actions** `/erm/mitigation-actions` | actions: type, status (open/in_progress/completed/overdue), priority, due date, evidence links, expected residual reduction | create/complete actions, link evidence |
| 8 | **Reviews** `/erm/reviews` | scheduled risk reviews: status, due date, before/after scores | schedule/complete/skip reviews |
| 9 | **Incidents** `/erm/incidents` | incidents: severity, status (open/investigating/…/resolved/closed), linked risks/controls, impacts | report, link to risk, resolve |
| 10 | **Internal Controls** `/erm/internal-controls/*` | controls: status, design/operating effectiveness, key-control flag, tests, risk links | create control, record test, link risk |
| 11 | **Analytics** `/erm/analytics/*` (heatmap, bowtie, scenario, aggregation, kri-triggers) | visualizations over the above | none — consumers |
| 12 | **Dependencies** `/erm/dependencies` | risk↔risk edges (causes/aggravates/mitigates), cascade score | map dependencies |
| 13 | **Reports** `/erm/reports` | generated reports over the above | none — consumer |

Pages 1, 11, 13 produce no formulas (they consume). Page 12 is proposed as an info/candidate
metric only (see §4).

---

## 2. Proposed sections and formulas

Rules identical to governance: achievement metric = (n/d)×100, empty → null + weight
renormalize; health metric = (1 − n/d)×100, empty → 100. "Active risks" = status ≠ closed.

### 2.1 Risk Register — weight .20
*Tables: grc_risks, risk_asset/control/evidence_links*

| Metric | w | Formula |
|---|---|---|
| Exposure containment | .30 | 1 − (active risks with residual ≥ 12 (high+critical) ÷ scored active risks) |
| Risk reduction | .25 | (Σ inherent − Σ residual) ÷ Σ inherent, over risks with both scores |
| Scoring completeness | .20 | risks with inherent AND residual scores ÷ active risks |
| Ownership | .10 | risks with an owner ÷ active risks |
| Linkage | .15 | risks linked to ≥1 control/asset/evidence ÷ active risks |

### 2.2 Risk Assessments — weight .15
*Tables: grc_risk_assessments, grc_risk_assessment_risks, grc_framework_risk_assessments, grc_framework_risk_questions*

| Metric | w | Formula |
|---|---|---|
| Assessment completion | .35 | (manual approved/closed + framework completed) ÷ all assessments |
| Question progress | .30 | framework questions completed ÷ all framework questions |
| Register coverage 12m | .35 | distinct risks assessed in last 12 months ÷ active risks |

### 2.3 RCSA — weight .10
*Tables: grc_rcsa_campaigns, grc_rcsa_assessments, grc_rcsa_findings*

| Metric | w | Formula |
|---|---|---|
| Submission rate | .35 | assessments submitted/approved ÷ assessments in active+closed campaigns |
| Approval progress | .25 | assessments approved ÷ assessments submitted |
| Findings remediation | .40 | findings remediated/closed/accepted ÷ all findings |

### 2.4 KRIs — weight .10
*Tables: grc_risk_kris, grc_risk_kri_measurements*

| Metric | w | Formula |
|---|---|---|
| Signal health | .40 | 1 − (red KRIs ÷ active KRIs) |
| Measurement freshness | .35 | KRIs measured within their frequency window ÷ active KRIs |
| High-risk coverage | .25 | active risks with residual ≥ 12 having ≥1 KRI ÷ active risks with residual ≥ 12 |

(Frequency window: daily=2d, weekly=10d, monthly=35d, quarterly=100d, annually=380d.)

### 2.5 Appetite — weight .10
*Tables: grc_risk_appetite_config + grc_risks*

| Metric | w | Formula |
|---|---|---|
| Appetite compliance | .60 | 1 − (risks exceeding their category's max acceptable score ÷ scored risks in configured categories) |
| Config coverage | .40 | risk categories with an appetite config ÷ categories present in the register |

### 2.6 Mitigation Actions — weight .10
*Tables: grc_risk_mitigation_actions (+ action evidence)*

| Metric | w | Formula |
|---|---|---|
| Timeliness | .40 | 1 − (overdue actions ÷ open actions) |
| Completion | .35 | completed actions ÷ all actions |
| Evidence-backed | .25 | completed actions with linked evidence ÷ completed actions |

(Replaces the page's current client-side array math — the one improvised stat found in ERM.)

### 2.7 Reviews — weight .10
*Tables: grc_risk_reviews*

| Metric | w | Formula |
|---|---|---|
| Schedule health | .40 | 1 − (overdue reviews ÷ open scheduled reviews) |
| Review currency | .35 | risks reviewed in last 12 months ÷ active risks |
| On-time completion | .25 | reviews completed on/before due date ÷ completed reviews (12m) |

### 2.8 Incidents — weight .05
*Tables: grc_risk_incidents*

| Metric | w | Formula |
|---|---|---|
| Resolution rate 12m | .40 | incidents resolved/closed ÷ incidents opened in last 12 months |
| Critical containment | .35 | 1 − (open critical/high incidents ÷ open incidents) |
| Risk linkage | .25 | incidents linked to ≥1 risk ÷ all incidents (the learning loop) |

### 2.9 Internal Controls — weight .10
*Tables: grc_internal_controls, grc_internal_control_tests, grc_internal_control_risk_links*

| Metric | w | Formula |
|---|---|---|
| Activation | .25 | active controls ÷ all controls |
| Test coverage | .25 | active controls with ≥1 recorded test ÷ active controls |
| Effectiveness | .30 | tested controls with design AND operating = effective ÷ tested controls |
| Risk linkage | .20 | active controls linked to ≥1 risk ÷ active controls |

---

### 2.10 AI Risk Assessment — folded into Assessments section (v2)
*Explored: `grc_ai_risk_assessment_entries` (AIRiskAssessmentEntry) — status (Open/In Progress/Closed),
likelihood/impact (1–5), risk_score (1–25, auto L×I), residual_risk_level (High/Med/Low),
target_review_date, ai_suggestion_accepted, risk_owner_user_id, bridged_risk_id, source
(manual/template_upload/api).*

Added metric to §2.2 Assessments:
| Metric | w | Formula |
|---|---|---|
| AI entry review health | — | 1 − (AI entries past target_review_date and not Closed ÷ open AI entries) |
(§2.2 weights rebalance when implemented: completion .30, question progress .25, register coverage .25, AI review health .20.)

### 2.11 Vendor Risk (TPRA) — NEW section, weight .08 (v2)
*Explored: grc_vendors (tier, status, lifecycle_stage 11-stage TPRA, next_reassessment_date,
inherent/residual 0–100 scores), grc_vendor_assessments (status, current_stage,
lifecycle_status active/superseded, due_date, completed_at), grc_tpra_findings (severity,
status open/in_remediation/accepted/closed, is_critical_control_fail),
grc_tpra_remediations (status, due_date), grc_tpra_risk_snapshots (time-series),
grc_tpra_monitoring_signals, grc_tpra_approvals. Ratings: critical ≥80, high ≥60 (0–100 scale).*

| Metric | w | Formula |
|---|---|---|
| Reassessment currency | .30 | 1 − (active vendors past next_reassessment_date ÷ active vendors with a date) |
| Assessment completion | .25 | current assessments completed/approved ÷ current (non-superseded) assessments |
| Findings closure | .25 | TPRA findings closed/accepted ÷ all TPRA findings |
| Remediation timeliness | .20 | 1 − (overdue remediations ÷ open remediations) |

**v2 weights (sum 1.00):** Register .18 · Assessments .14 · RCSA .09 · KRIs .09 · Appetite .09
· Mitigation .10 · Reviews .09 · Incidents .05 · Controls .09 · **Vendor Risk .08**

## 3. Module performance score (proposed)

```
P = Register(.18) + Assessments(.14) + RCSA(.09) + KRIs(.09) + Appetite(.09)
  + Mitigation(.10) + Reviews(.09) + Incidents(.05) + Controls(.09) + VendorRisk(.08)
```
Same grade bands (≥85 excellent · ≥70 good · ≥50 fair · <50 poor).
This P is what the main dashboard's **Risk card** will show (the reference screenshot's
"Risk 59% · 46 risks tracked · 3 critical").

**Attention queue (counts):** overdue mitigation actions + overdue reviews + red KRIs +
appetite breaches + open critical/high incidents + open RCSA findings + overdue control tests.

---

## 4. Deliberately NOT scored (info / candidates — say if you want any promoted)

- **Dependencies mapped** — risks with ≥1 dependency edge ÷ active risks (bow-tie/cascade completeness).
- **Score history trend** — direction of avg residual over 90 days (chart, not a ratio).
- **RCSA AI quality score** — avg ai_quality_score of submitted assessments.
- **Incident financial impact totals** — sum, not a health ratio.
- **Scenario/heatmap/aggregation usage** — analytics consumers, nothing to score.
- **Expected vs actual residual reduction** on completed mitigation actions — good future
  metric, but actual_residual_reduction is sparsely populated today.

## 5. Open questions for you before building

1. Do the section weights look right? (Register heaviest at .20; Incidents lightest at .05.)
2. Exposure containment uses **residual ≥ 12** (high+critical) as "bad" — or should only critical (≥20) count?
3. Should **accepted** risks count as "contained" (current proposal: yes — acceptance is a decision) ?
4. Anything from §4 you want scored from day one?
