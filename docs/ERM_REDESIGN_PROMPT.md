# Prompt: Risk Management redesign, with a competitor automation study

> Written 2026-11-11 after reading every Risk Management page and router. The "Known
> defects" in section 3 come from reading the code; nothing was run or tested. Phase 1 confirms them before anything
> relies on them.

---

## 1. Role

Act as a senior operational and enterprise risk practitioner (15+ years in a bank's CRO
office) who is also a product designer. You know COSO ERM 2017, ISO 31000:2018, the Basel
Committee's Principles for the Sound Management of Operational Risk (PSMOR) and its
loss-event taxonomy, the Three Lines Model, and outsourcing rules (EBA outsourcing
guidelines, SBP outsourcing framework, SAMA, CBUAE). Judge every screen as the person who
has to use it every day and defend it to an examiner.

## 2. Goal and the hard gate

1. **Study** how the leading ERM vendors automate risk work. This study is internal; competitors are never named in customer-facing material.
2. **Redesign** the business process flow of every Risk Management module so each reads as
   one clear journey: what to do first, what happens next, who acts, who approves, and
   where it ends.
3. **Design** the risk dashboards a bank needs.

Phases 0–3 are read-only and end with templates. **Make no code changes, migrations or
commits until I approve the templates.** Phase 4 implements only what I approve.

## 3. What is already known

Every module below was read page by page and router by router. Use these findings as
your starting evidence. Re-check each one before you build on it, because the code may
have moved. FE = `grc-frontend/src/app/(dashboard)/`, BE = `backend/grc/modules/erm/`.

### 3.1 Problems across the whole area

- **Permissions.** The `/erm` router checks only `erm:risks:view` (`BE router.py:31-35`).
  Create, approve and delete endpoints check nothing more. The UI checks names that are
  not in the catalog (`risks:rcsa:*`, `erm:risk_assessments:*`), so non-admins lose
  buttons. Admins skip permission checks, so testing as admin hides this.
- **No maker-checker (an approver who is not the person who did the work) anywhere:**
  - Risk status is free text.
  - "Accept risk" is a label with no approver, rationale or expiry.
  - Reviews have no sign-off.
  - RCSA approvers are not enforced.
  - Control approvals and test reviews allow self-approval.
  - Issue closure can be bypassed.
- **Scoring bands disagree.** Each place uses its own cut-offs:

  | Where | Bands |
  |---|---|
  | Analytics | 4 / 9 / 16 |
  | Heatmap page | 5 / 10 / 17 |
  | Reports | 6 / 12 / 20 |
  | Risk Assessments | 6 / 13 / 21 |

  Two other sources write into the same 1–25 score columns on different scales:
  - 1LINK's 3×3 scores, which are then banded on the 5×5 bands.
  - Vendor scores (0–100), so nearly every vendor risk shows as critical.

  Appetite breach rules also differ in four places. The same risk therefore counts
  differently on every screen.
- **Two risk APIs.** The list page uses `/erm/risks`; the detail page uses the legacy
  `/risks`. A third set, `/advanced-erm`, is unused.
- **Pages users can't find:**
  - Reports (`/erm/reports`): no link at all.
  - Framework Controls and NCA detail: orphaned.
  - Heatmap, Aggregation and KRI Triggers: reachable only from the Analytics hub.
  - The Overview hides its own tab strip.
  - Mitigation Actions, Appetite, Reviews and Dependencies: not in the sidebar.
  - KRIs: under Governance.
  - Incidents: under Issue & Incident Management.

### 3.2 Problems in each module

**Risk Register** (`FE erm/risks/*`, `BE routers/risks.py`)
- **Score edits are lost.** `RiskUpdate` (`backend/grc/schemas/_00_base.py`) has no
  likelihood, impact or score fields, so editing scores in the list form does nothing.
  Only `/assess` writes them, and no page calls it.
- **The list stops at 100 risks** (`risks.py:1023`), with no paging, while the dashboards count all risks.
  Unscored risks are counted as "Low".
- **The form is missing fields.** It has only Business Owner: no risk owner, due or
  review date, target risk or treatment strategy. The Treatment tab is free text, does
  not list the risk's mitigation actions, and sets a `mitigating` status that is not in
  the list.
- **Delete is permanent.** `/aging` is never reached because `/{risk_id}` is declared first.

**Risk Library**: one shipped library (UAE IA), read-only. Adding a risk to the register
lets the user set any status, including accepted or closed.

**Risk Assessments** (`FE erm/risk-assessments/*`, `BE risk_assessments.py`, `framework_risk_assessments.py`)
- Approval never updates the register. Four paths push into the register one-off, each
  mapping fields differently: Excel upload (no duplicate check), Framework "Move", the
  AI bridge, and Custom promote.
- The "AI Risk Assessment" page is a register of risks *in* AI systems, which its name
  doesn't make clear.
- Its template download probably fails with a 422: `/{entry_id}` is declared before `/template`.

**RCSA** (`FE erm/rcsa/*`, `BE rcsa.py`, `rcsa_custom.py`)
- **Answers are probably saved blank.** The page sends `likelihood / impact /
  effectiveness`; `RCSAResponseSave` expects `likelihood_rating / impact_rating /
  control_effectiveness / response_value` (`schemas/_10_rcsa_*.py:251-258`). Confirm
  with one live save.
- **The approvals list is always empty**: it calls a route that doesn't exist,
  `/assessments/pending-approvals`. The approval detail page reads fields the API never
  returns, and approval workflows have no setup screen.
- **Findings are broken end to end:** they can't be created in the UI, the link
  endpoints return 422 (the UI sends a body; the backend expects query parameters), and
  the detail page gets a 405.
- **"Send Reminders" and "Export" have no backend.** Campaign periods are hard-coded to
  2026, and the status filters are ignored (`status` vs `status_filter`).
- **Templates aren't versioned**, so editing one changes assessments already in progress.
  RCSA questions don't link to register risks or controls, so RCSA can never move
  residual risk.

**Analytics** (`FE erm/analytics/*`, `BE advanced_analytics.py`)
- **Scenario Analysis** only re-multiplies likelihood × impact: no loss amounts, nothing
  saved. Its presets ignore their own `categories_affected`, and it crashes on risks with
  no score.
- **Bow-Tie** splits controls into preventive and mitigating by alternating position,
  hard-codes "effective", and has template-sentence consequences. Nothing can be edited.
- **Heatmap** duplicates the Overview heatmap through a different endpoint.
  **Aggregation** sums ordinal scores, and `risk_trend` is always empty.
- **KRI Triggers** reads stored values only. It has no acknowledge, assign or raise-issue
  action.

**Risk Appetite** (`FE erm/appetite`, `BE appetite.py`)
- One qualitative setting per category: no appetite statements, quantitative limits,
  versions, or board approval.
- Saving silently overwrites, and delete is permanent.
- `alert_enabled` and the escalation owner do nothing, and the escalation owner can't be
  set in the UI.
- Seeding hard-codes `tenant_id` 1.

**KRIs** (`FE erm/kris`, `BE kris.py`, `kris_workflow.py`)
- **The maker-checker workflow (`/erm/kri-workflow/*`) has no UI.** Both measurement
  screens auto-approve, and the approve endpoint doesn't check who the reviewer is.
- **Red breaches create an Issue only via `/measure`,** and only when the
  `kri_red_breach` flag is on (default off). Amber does nothing.
- **Uploaded KRIs are saved without `tenant_id`** (`kris.py:833-846`), so they vanish
  from the list.
- **The trend chart never shows.** KPIs appear in the KRI list and are converted to KRIs
  when edited.
- **The form is missing fields:** owner, data provider, target and due date.

**Reviews** (`FE erm/reviews`, `BE reviews.py`)
- **"Complete" overwrites the risk's scores directly, with no approval.** The page sends
  `completed`, but the backend stamps completion and history only for
  `approved`/`rejected`.
- "Start" reassigns the review to whoever clicks it.
- The next review is never scheduled. The client calls a `/complete` route that doesn't exist.

**Reports** (`FE erm/reports`, `BE reports.py`)
- No link in the app opens it, and exports are JSON only.
- The board recommendations are hard-coded, and `avg_residual` divides by the wrong count.

**Mitigation Actions** (`FE erm/mitigation-actions`, `BE mitigation_actions.py`)
- **New actions vanish from tracking.** A duplicate route (`risks.py:2963-2985`)
  intercepts creation and saves them as `pending`, which no open or overdue count
  includes.
- **The actual reduction is never saved** (the client sends a JSON body; the backend reads a query parameter).
- **The Owner column is always blank.** Completing an action needs no evidence and no
  verifier, and residual risk never moves.

**Internal Controls / Framework Controls / Dependencies**
- **Internal Controls** pages just redirect to `/controls`. Control–risk links live in
  four tables, so a link made in the Catalog doesn't show on the risk page. Control
  effectiveness never changes residual likelihood × impact.
- **Dependencies** doesn't match its API (`strength` vs `impact_factor`, and the cascade
  field names). It is gated on a permission that doesn't exist.

**Incidents** (`FE erm/incidents`, `BE incidents.py`)
- **Not usable as loss events:**
  - no Basel level-1 event types
  - no business line
  - no gross loss, recoveries or net loss
  - no currency (the screen shows $)
  - no near-miss flag or boundary events
  - the discovery date can't be entered
- **The Investigating and Resolved tiles always show 0.** Incidents can't link to
  controls, KRIs or Issues.

**Issues & CAPA** (`FE issues/*`, `backend/grc/modules/issue_management`)
- **Closure can skip approval.** A plain "closed" transition skips approval, closure
  notes, the approver and `closed_at`. There is no segregation of duties, and closing
  doesn't require the CAPA (corrective) actions to be complete.
- **Mitigation actions and CAPA actions are two separate trackers with no link between them.**
- The classification matrix is saved but never read. Three automation flags exist but
  nothing triggers them.

**Executive dashboard / Risk posture** (`backend/grc/modules/exec_dashboard`, `risk_posture`)
- "Executive" shows vulnerabilities only. Risk posture scores assets and treats missing
  data as values, so an asset nobody has assessed shows as "elevated".
- **There is no board-level ERM dashboard in the sidebar.** The Overview's
  `/erm/dashboard/sections-overview` (formulas in
  `docs/risk-dashboard-formulas-proposal.md`) is the nearest thing.

**Third-Party Vendor Risk** (`FE vendor-risk/*`, `backend/grc/modules/vendor_risk`)
- **The process can be bypassed.** "Add vendor", import and the edit form can make a vendor active or change its rating without intake or approval.
- **Bank outsourcing steps are missing:**
  - materiality / critical-or-important assessment
  - exit plan
  - sub-outsourcing approval
  - regulator notification
  - committee approval (one approver, even for critical vendors)
- **It doesn't feed ERM properly.** Vendor incidents never reach ERM incidents.
  Concentration uses a local appetite of 45, not ERM's appetite settings.

### 3.3 Automation that already exists

Every gap you raise must be measured against these:
- **Workflow engine** (`backend/grc/modules/workflow_engine`), with triggers such as
  `appetite_breach_detected` and `mitigation_action_overdue`.
- **Issue automation:** automation flags, and an issue auto-create helper.
- **AI suggest:** endpoints for risks, incidents, mitigation, scenario explanation and the bow-tie narrative.
- **Quantification:** the FAIR Monte Carlo engine (`BE quantification/`).
- **Vendor monitoring:** signals and the vendor lifecycle exit checks.
- **Connectors:** 65 SaaS connectors. Read `docs/platform/05-AUTOMATION-AND-INTEGRATIONS.md`
  for what they can and cannot honestly claim.

## 4. Scope: every module, nothing left out

| Module | Route(s) | Where it is today |
|---|---|---|
| Overview | `/erm` | Risk Management sidebar |
| Risk Library | `/erm/risk-library` | sidebar |
| Risk Register (list, dashboard, detail, NCA detail) | `/erm/risks`, `/erm/risks/list`, `/erm/risks/[id]`, `/erm/risks/nca/[id]` | Operational Risk |
| Risk Assessments (manual, framework, AI-systems register) | `/erm/risk-assessments/*` | Operational Risk |
| RCSA (hub, campaigns, assessments, approvals, findings, templates, custom templates) | `/erm/rcsa/*` | Operational Risk |
| Scenario Analysis | `/erm/analytics/scenario` | Operational Risk |
| Bow-Tie | `/erm/analytics/bowtie` | Operational Risk |
| Advanced Analytics (heatmap, aggregation, KRI triggers) | `/erm/analytics/*` | Operational Risk |
| Risk Appetite | `/erm/appetite` | tab strip only |
| Mitigation Actions | `/erm/mitigation-actions` | tab strip only |
| Reviews | `/erm/reviews` | tab strip only |
| Dependencies | `/erm/dependencies` | tab strip only |
| Reports | `/erm/reports` | unreachable |
| Internal / Framework Controls | `/erm/internal-controls`, `/erm/framework-controls/[id]` | redirect / orphan |
| KRIs, KPI Report | `/erm/kris`, `/governance/kpi-report` | Governance |
| Incidents / loss events | `/erm/incidents` | Issue & Incident Management |
| Issues & CAPA | `/issues` | Issue & Incident Management |
| Third-Party Vendor Risk | `/vendor-risk/*` | its own menu |
| Executive dashboard, Risk posture | `/cyber-assurance/dashboard`, `/cyber-assurance/risk-posture` | Cybersecurity Assurance |

Backend: every router in `backend/grc/modules/erm/routers/`, plus `quantification/`,
`services/`, `issue_management`, `vendor_risk`, `exec_dashboard`, `risk_posture` and
`workflow_engine`. If you find a risk page, route or endpoint that isn't listed, add it.

## 5. Skills: load each before the phase that needs it

| Phase | Skills / agents |
|---|---|
| 0–1 Read and confirm | `Explore` and `ecc:code-explorer` agents · `bank-module-review` · `ecc:click-path-audit` · `ecc:browser-qa` (one live save and one approval per defect you rely on) |
| 2 Competitor study | `anthropic-skills:deep-research` · `ecc:competitive-platform-analysis` · `ecc:competitive-report-structure` · `ecc:market-research` · `ecc:exa-search` · the `WebSearch` tool (mode "extended") and `web-fetch` agents · `ecc:product-capability` |
| 3 Templates | `bank-module-review` · `ui-ux-pro-max` · `frontend-design` · `design-system` (reuse `docs/DESIGN_REFERENCE.md`; no new visual language) · `dataviz` and `ecc:dashboard-builder` · `ecc:accessibility` (WCAG 2.2 AA) · `artifact-design` and `artifact-diagramming` · `stop-slop` on every label and line of copy |
| 4 Build (after approval) | `ecc:planner` · `ecc:api-design` · `ecc:database-migrations` · `ecc:tdd-workflow` · `ecc:fastapi-patterns` · `ecc:react-patterns` · reviewer agents `ecc:fastapi-reviewer`, `ecc:python-reviewer`, `ecc:react-reviewer`, `ecc:typescript-reviewer`, `ecc:database-reviewer`, `ecc:security-reviewer` · `ecc:e2e-testing` · `ecc:module-regression` · `ecc:verification-loop` |

## 6. Phase 0: read the existing docs first

- `docs/PLATFORM-DESIGN-BRIEF.md` (the ERM and vendor-risk parts)
- `docs/erm-dashboard-design-brief.md` and `docs/risk-dashboard-formulas-proposal.md`
- `docs/DESIGN_REFERENCE.md`
- `docs/1LINK_ERM_DEMO_COVERAGE.md`
- `docs/tpra-plan.md` and `docs/tprm-revamp-plan.md`
- `docs/platform/05-AUTOMATION-AND-INTEGRATIONS.md` and `docs/platform/06-POSITIONING.md`

Build on these; don't redo what they already settle.

## 7. Phase 1: confirm and fill gaps (read-only)

1. For each defect in section 3 that a template will depend on, confirm it in the code and,
   where it matters, with one live action in the running app. Mark each as confirmed,
   already fixed, or wrong.
2. For each module, record:
   - users by line of defence
   - entry points
   - the statuses and transitions the backend enforces
   - approvals
   - data in and out
   - permissions
   - today's click count for the main tasks
3. Cite file:line for every "how it works today" claim.

## 8. Phase 2: competitor study of ERM automation (internal only)

**Vendors.** Start with ServiceNow IRM, Archer, MetricStream, IBM OpenPages, SAP GRC (Risk
Management / Process Control), AuditBoard, LogicGate Risk Cloud, Riskonnect, SAI360,
Protecht, Diligent, OneTrust, Navex IRM, Camms, Resolver and CURA. Add any vendor active
in Gulf or Pakistani banking that research turns up.

**What to compare.** For each area, record what each vendor automates, how (rules,
no-code workflow, connectors, AI) and who still has to act:
1. Risk identification: library suggestions, AI-drafted risks, regulation → risk mapping
2. Assessment and RCSA: campaign scheduling, assignment, reminders, escalation, pre-filled answers, challenge and approval routing
3. KRIs: automated data feeds and connectors, threshold breaches → notification, issue and escalation, maker-checker on manual values
4. Appetite: limit monitoring, breach escalation to owner and committee, board reporting
5. Loss events: intake (form, email, ticketing, general-ledger reconciliation), Basel classification, recoveries, linking to risks and controls
6. Controls: continuous control monitoring, test scheduling, effectiveness → residual risk
7. Treatment and issues: SLA timers, overdue escalation, closure verification, risk-acceptance expiry and re-approval
8. Scenarios and quantification: FAIR / Monte Carlo, capital or stress inputs
9. Third-party risk: monitoring feeds, reassessment triggers, concentration → appetite
10. Reporting: board and committee packs generated automatically, narrative generation, scheduled distribution
11. Integrations and the workflow engine: what is configurable without code

**Output:**
- A vendor × area matrix (Yes / Partial / No), each cell citing a public source with its
  date. Mark which claims are documented features and which are marketing.
- For each area, where this platform stands: built and wired, built but not wired, or
  missing. Use section 3.3 and cite file:line.
- A ranked list of automations to adopt, scored on value to a bank, regulatory weight
  and build size.

**Rules:**
- Use public sources only, and never reproduce paywalled analyst content.
- Do not name competitors in any customer-facing copy (`06-POSITIONING.md:122`).
- Do not propose any claim of automated compliance (`05-AUTOMATION-AND-INTEGRATIONS.md:70`).

## 9. Phase 3: templates, then STOP

**One template per module**, every one with the same sections:
1. Who uses it (by line of defence) and the job they are doing
2. Current flow as a diagram, with its problems and file:line evidence
3. Proposed flow as a diagram, including:
   - the steps, and the owner and status at each step
   - maker-checker and approval gates
   - hand-offs to other modules
   - the automation at each step, tagged with where the idea came from in Phase 2
4. Screen outline for list, detail, create/edit and review:
   - what shows first, and the primary action
   - the empty state
   - plain-language labels
5. The regulatory anchor (COSO, ISO 31000, Basel PSMOR or outsourcing guideline) the flow meets
6. Size of change: UI only, backend, or migration; and which defects in section 3 it fixes

**Cross-cutting templates:**
- **Lifecycle and navigation:**
  - The end-to-end lifecycle (Identify → Assess → Treat → Monitor → Report) with every
    module placed on it.
  - A proposed sidebar. Decide: lifecycle or tool order? Where do KRIs, Incidents,
    Issues, Vendor Risk and Reports go? Are risk types other than Operational needed?
  - What gets merged: Risk Assessments vs RCSA; Templates vs Custom Templates;
    mitigation actions vs CAPA; the two heatmaps; the two risk APIs.
- **One scoring model.** Use one scale and one band definition everywhere, using the
  tenant's scales from `routers/scales.py`, and map 1LINK 3×3 and vendor 0–100 scores
  onto it. Add target risk. Set how control effectiveness and completed actions move
  residual risk.
- **Dashboards**, one each for:
  - the Board / CRO
  - the 2nd-line risk manager
  - the 1st-line risk owner
  - internal audit
  - vendor risk

  For each, list the questions it answers. Then, for every KPI or KRI, give its source
  field and formula, the chart, the filters and the drill-down target. Only include
  metrics the data can back; flag any that need new data. Extend
  `/erm/dashboard/sections-overview` rather than starting again.
- **Automation map:** every trigger → action → owner → escalation, marked as existing
  engine trigger or new.
- **Competitor summary**, carried over from Phase 2 (internal).
- **Glossary:** every risk term shown in the UI, with one plain definition each.

Publish all templates as one artifact page and give me the link. **Then stop and wait for
my approval.**

## 10. Phase 4: build (only what I approve, in the order I approve)

1. **Fix the data-loss and broken-flow defects first, each in its own small change with a test:**
   - score edits dropped
   - RCSA answers saved blank
   - mitigation actions created as `pending`
   - uploaded KRIs losing `tenant_id`
   - actual reduction never saved
   - endpoints that don't exist or don't match
2. **Then backend permissions and maker-checker.**
3. **Then the redesign, module by module.** Write tests first and make the smallest change.
   Reuse existing components. Keep old URLs working by redirecting them. Run the reviewer
   agents, then verify in the browser preview as a non-admin user, not as admin.
4. **Leave the branch's other uncommitted work alone.**

## 11. Rules

- Evidence over assumption: every "current" claim cites file:line.
- Never invent data or metrics the backend can't produce.
- Plain language for 1st-line users. Keep precise risk terms for risk teams, backed by
  the glossary and tooltips.
- Test every permission and approval flow as a non-admin user.
