# GRC Platform — Product & UX Design Brief

*A complete brief for a redesign exploration. It maps **every module, screen, flow, feature, and the data each screen shows**, so a designer can explore new directions with full context. The module detail (Part B) was mapped directly from the live frontend — **182 screens across 31 modules**.*

---

## Part A — Platform overview

### What the platform is
A **multi-tenant enterprise GRC (Governance, Risk & Compliance) SaaS**. It carries an organisation end-to-end: pick frameworks → manage controls → collect and monitor evidence → run risk, third-party, asset, and vulnerability programs → produce audit-ready output. It is broad: alongside the SOC 2 / ISO / PCI / NIST / GDPR compliance core it ships full **Enterprise Risk Management** (register, KRIs, incidents, RCSA, appetite, analytics), **Third-Party Risk** (an 11-stage vendor lifecycle), **IT Asset** and **Vulnerability** management, **Governance & policy** management, **Business Continuity**, **work management** (tasks/issues/projects), and a cross-module **Report Builder**.

### Technology & rendering
- **Next.js 14 (App Router)**, **React 18**, **TypeScript**. Every module screen lives under the `(dashboard)` route group behind a shared **left sidebar + top bar** shell.
- Screens are **client-rendered** and pull live data with **TanStack Query** — notably with a *shared query cache*, so the same numbers appear identically on the home dashboard and inside each module.
- **Tailwind CSS** for styling, **Recharts** for charts, **lucide-react** for icons, **@xyflow/react** for the interactive graph/flow views (risk trajectory, framework journeys).

### Current design system
- **Teal primary** (`#1ed4b0`, a "charter" look), near-black text on teal for primary actions, **slate** neutrals.
- A consistent **semantic colour ramp** used everywhere: **emerald** = good / compliant / on-track, **amber** = partial / warning / in-progress, **rose/red** = at-risk / overdue / critical, **slate** = neutral / no-data. A parallel **severity ramp** (critical→low) reuses the same hues.
- **Shared component vocabulary:** a **RightSlidePanel** (drawer) for create/edit/detail, **DataTable**, **StatusBadge**, **ProgressRing / ScoreRing**, stat tiles, tab bars, and filter rows. Cards use a common `cw-card` style.
- A recurring **"workspace" pattern**: a module landing page offers a **view switcher** (e.g. Table / Board / Tree / Dashboard) over the same data, plus a right-slide **detail drawer** — used in Evidence, Governance documents, the vendor lifecycle, and the risk register.

### Multi-tenancy & access
- **Physical per-tenant isolation** (a database per tenant). **White-labeling** (logo/colours) per tenant.
- **RBAC** with `module:submodule:action` permission strings and wildcards; the **sidebar and every screen are permission-filtered**, so a user only sees the modules and actions their role grants. Admins see everything.

### Information architecture (the navigation)
The left sidebar groups the 31 modules into a compliance-lifecycle order. The top-level groups (each expands to module sub-navigation):

| Sidebar group | Modules inside |
|---|---|
| **Performance Overview** | Home dashboard |
| **My Work** | personal queue; My Runs (team activity) |
| **Governance** | documents/policies, committees, approvals, workflows, regulatory changes & feeds, gap analysis, KRIs, KPI report |
| **Risk** | ERM (register, assessments, AI assessment, analytics, appetite, dependencies, incidents, KRIs, mitigation actions, reviews, internal controls, RCSA), **Vendor / Third-Party Risk** |
| **Compliance** | frameworks, framework upload, evidence, assessments, regulatory, auditor portal, compliance plugins (CIS) |
| **Controls** | control library (list, assurance, compare, coverage, evidence, gaps, pipeline-lab, templates, review) |
| **Assets** | inventory, asset detail, criticality assessments (ISCA/IACA), risk posture |
| **Vulnerabilities** | register, dashboard, departments, SLA, exceptions, reports, NCA register |
| **Issues** | issue & incident management |
| **Reports** | cross-module Report Builder |
| **Critical Tasks** | tasks, IS projects |
| **Business Continuity** | plans, BIA, drills, findings |
| **Admin** | users, roles, teams, organisation, password policy, audit logs, agents, connectors, cloud connectors, discovery, integrations, access reviews |
| **Assistant** | ComplyChat (AI chatbot) |

Most modules also carry their own **tab bar** (sub-navigation) — e.g. ERM shows *Risk Register · Appetite · Mitigation Actions · Reviews · Dependencies*; RCSA shows *Dashboard · Campaigns · Assessments · Templates · Custom Templates · Findings · Approvals*; Vendor Risk shows *Dashboard · Vendors · Assessments · Findings · Monitoring · Questionnaires · Risk 360° · Exchange · Settings*.

### Cross-cutting UX patterns (worth keeping in mind for any redesign)
1. **Scorecard + drill-down.** The home dashboard is a launchpad of per-module **ScoreRings** (0–100) with a mini chart matched to the module; every card deep-links into its module, and the score is the *same* value the module's own page shows.
2. **Deep cross-module linking.** Records link across modules everywhere — a risk links to controls/assets/evidence/vulns/frameworks; a vendor finding promotes to the risk register and to issues; an access-review gap raises a task. Redesigns must preserve this traceability.
3. **Right-slide drawers over full-page forms** for create/edit/detail, keeping context.
4. **AI assist is pervasive** — most create flows (risk, KRI, incident, appetite, document, vendor) offer an "AI Assist" that drafts fields the user then accepts/edits; nothing AI-generated is applied without review.
5. **Dense, data-first tables** with filters, multi-select, and export (CSV/Excel/Word/PDF). The Report Builder generalises this into pivots and charts.
6. **Consistent empty / loading / error states** (skeletons, dashed empty-state explainers, retry).
7. **Regulator variants** — several modules carry a parallel "NCA" (Saudi regulator) register/template alongside the standard one.

### How to use this brief
Part B has one section per module (in sidebar order). Each covers **purpose → information architecture (its screens/tabs) → per-screen detail (the data it shows, the primary actions/flows, and notable features)**. When exploring redesigns, the two things to preserve are the **data density** (these are working operator tools, not marketing pages) and the **cross-module linkage**; the visual system, the information architecture, and the interaction patterns are all open to reinvention.

---

## Part B — Module-by-module design brief


# Home, Reporting, Workflow & AI Chat

This brief covers seven route areas: the **Home dashboard**, **My Work**, **My Runs**, **Compliance & Scans** (compliance-overview), **Reports**, **Workflow Engine**, and **ComplyChat**. These are the platform-wide / cross-cutting surfaces (as opposed to the individual GRC modules like ERM, Governance, Vulnerabilities, which each have their own routes). All are client-rendered React screens using TanStack Query for live data, Recharts for charts, and Tailwind. Colors follow a consistent GRC semantic ramp: emerald = good/compliant, amber = partial/warning, rose/red = at-risk/overdue, slate = neutral/no-data.

---

## Home Dashboard

**Purpose & IA.** The landing screen after login (`/dashboard`). It is a **module-aggregation launchpad**: one scorecard per major GRC module, a portfolio-level KPI strip, a "fix this first" list, and a live Cyber KPI panel. Every card is a link into its module. There is no sub-navigation on the live version — it's a single scroll.

Important redesign context: the file contains a **large amount of built-but-disabled UI** behind feature flags (`SHOW_LEGACY_TABS = false`, and several `false &&` blocks). The live screen today is just two stacked components (`MainModuleCards` + `CyberKpiPanel`). The disabled material — a 10-tab draggable "widget workspace" and an 8-panel executive board pack — is described at the end because a redesign may want to revive or formally retire it.

### Home — Module Aggregation Dashboard — `/dashboard`
- **Purpose.** Give an executive/operator a one-glance readiness picture across all modules and a fast route into any one of them.
- **What it shows (live):**
  - **Optional "My Work" call-out banner** (only if the user has framework/control/evidence permissions) — a primary-colored bar linking to `/my-work` ("Your assigned requirements across every framework, in one queue").
  - **Portfolio KPI strip (4 tiles):** *Overall Readiness* (avg % of scored modules, target 85), *Risk Posture* (Low / Moderate / Elevated, derived from the ERM risk score), *Open Items Past SLA* (count, red when >0), *Modules Visible* (e.g. "6 / 9", permission-filtered).
  - **Module scorecards (responsive grid, 1–3 cols).** Each module is one card with a colored top stripe, a circular **ScoreRing** (0–100 with band color), an icon + title, a band pill (e.g. "Strong"/"Weak"), an optional red "attention" note (e.g. "3 overdue tests", "2 critical incidents"), and a **module-matched mini chart**:
    - *Radar* — Governance, Assets (multi-dimension section scores).
    - *Horizontal bars* — Compliance, Assessments, Issues & Incidents, Control Testing & Assurance (lowest-scoring sections first, with an 85% reference line).
    - *Donut* — Frameworks (journeys by status), Third-Party Vendor Risk (by tier/status), Business Continuity (plans/drills by status) — count-based modules.
    - Modules without a score endpoint render a **fallback count card** (big number + "Count snapshot" / "No data yet" empty state).
  - **"Where to act first" priorities card** — a rose-striped card listing the 6 lowest-scoring sub-areas across all modules, each a row with module label, a mini progress bar, and % — each links to its module.
  - **Cyber Security KPIs panel** (`CyberKpiPanel`) — header with count summary ("N live KPIs across M domains · computed from real modules") and an "Open KPI Report" link (`/assessments/cs_kpi`); 3 summary tiles (*Live KPIs*, *On target*, *Below target*); then a grid of **rich KPI cards**, each showing domain tag, a "Live" badge, topic, current actual % vs target %, an inline sparkline/trend chart, on/below-target status, and numerator/denominator. Clicking a card opens a **KPI detail modal** (shared with the KPI Report page) explaining the logic. Loading = skeleton; no matching feeds = dashed empty-state explainer.
- **Primary actions & flows.** Read → drill in. Every card and priority row is a navigation link. No create/edit here.
- **Notable features.** Permission-filtered module visibility (admins see all); scores are shared-cache with each module's own scorecard page (same query keys, so numbers agree cross-screen); live KPI computation from real module data (vuln SLA, policy reviews, access certification) rather than static workbook values.
- **Empty/loading states.** "Loading module dashboard…" panel; per-card "No data yet — open the module to get started."

**Disabled/legacy material in this route (for redesign awareness):**
- A **tabbed widget workspace** (`SHOW_LEGACY_TABS`) with 10 tabs — Executive Overview, Governance, Risk, Compliance, Vulnerabilities, Assets, Frameworks, Issues, Critical Tasks, Evidence — each rendering a **drag/drop/resize/minimize/maximize grid of widgets** (summary tiles, distribution donuts, trend lines, radars, SLA queues, heatmaps). This is a full self-service dashboard builder that is currently switched off.
- An **8-panel executive "board pack"** (also disabled): (1) Board Reporting scorecards (Risk Profile, Controls, Compliance, Open Issues, Audit Readiness), (2) Compliance progress bars (Obligations/Attestations/Evidence/Training), (3) Enterprise Risk by-category bar chart, (4) GRC Overview 4-pillar scores, (5) Issue & Incident stat cards, (6) KPI/KRI monitoring, (7) a **5×5 Risk Exposure heatmap** (likelihood × impact), (8) Risk Trend mini line charts. Each panel carries a "Formula:" caption explaining its computation. Also built but disabled: cross-domain **chord diagram**, **GRC network-flow diagram**, **compliance orbit rings**, **internal-controls sunburst**, and a **COSO/ERM radar wheel**.

---

## My Work

**Purpose & IA.** A single personal queue (`/my-work`) that aggregates the logged-in user's assigned compliance requirements across every certification/framework journey. One screen, no tabs — a two-column layout (main queue + sidebar).

### My Work — Personal Queue — `/my-work`
- **Purpose.** Let a contributor see everything assigned to them, sorted by urgency, and jump straight to the control they need to action.
- **What it shows (the data):**
  - **Greeting header** ("Good morning, {firstName}") with a summary line: "N items in your queue across M frameworks · X overdue" (overdue in red).
  - **My queue (main column)** — an urgency-sorted list of assigned controls/requirements. Each row: a status dot (active=orange, done=emerald, else grey), the control **code** (mono), **title**, a red **"Critical"** pill if flagged, and a subline: "{Framework} · {status label} · {approved}/{required} evidence approved". A right-aligned **due-date chip** (rose "· overdue" when past due). Rows are ranked: overdue → critical → active → by due date; completed items sink to the bottom.
  - **Sidebar → "Your frameworks"** — per-framework progress: name, % complete, a tone-colored progress bar (emerald/amber/rose), and "{n} of your items · Phase X".
  - **Sidebar → "This week"** — 4 metrics: Items completed, Evidence approved, Awaiting reviewer, Due next 7 days.
- **Primary actions & flows.** Click a queue row → deep-links to `/frameworks/{journeyId}?tab=controls&req={controlId}` (the exact requirement). "Start a journey" button → `/compliance`. Framework rows link into the framework's controls tab.
- **Notable features.** Urgency ranking algorithm; permission-gated (needs framework/control/evidence access) — otherwise shows a lock empty-state ("My Work isn't available for your role").
- **Empty/loading states.** Spinner while resolving user + assignments; "Nothing is assigned to you right now."; "No assigned frameworks yet."

---

## My Runs & Team Activity

**Purpose & IA.** A tenant-facing activity dashboard (`/my-runs`) for **CIS compliance scans**. Single scrolling screen: KPI strip → activity panel (Mine/Teammates toggle) → recent runs table. Auto-refreshes (summary every 30s, runs every 15s).

### My Runs — Scan Activity — `/my-runs`
- **Purpose.** Show a user their coverage of the approved CIS rule catalogue and what teammates have scanned, plus a live feed of recent scan runs.
- **What it shows (the data):**
  - **Header strip** (indigo gradient): "My runs & team activity — Your coverage of the approved CIS catalogue plus what your teammates have run. Refreshes every 30s."
  - **KPI strip (4 cards):** *Approved rules* (total CIS library size), *Your pass rate* (%, tone-colored good/warn/bad, with "X of Y latest-runs passed"), *Your failed* (count, red if >0), *Recent runs* (total, "showing latest N").
  - **Activity panel** with a **Mine / Teammates** segmented toggle. Lists every tenant member as a row: avatar initial, name + email, a two-segment pass/fail bar, and "passed / total · % passing". Members who haven't scanned show a "not started" tag with an onboarding nudge.
  - **Recent runs table** — columns: *When* (relative time), *Status* (badge: passed/failed/error/running/skipped), *Rule* (rule id + shortened benchmark name), *Asset* (links to `/assets/{id}`), *Triggered by*, *Duration* (ms/s).
- **Primary actions & flows.** Toggle Mine↔Teammates; click an asset to open its detail page. (No create/edit — this is a monitoring view.)
- **Notable features.** Real-time polling; cross-namespace user identity matching by email; explicit cross-screen consistency invariants (pass rate == admin overview, total rules == rule library, runs == per-asset scan history).
- **Empty/loading states.** "Loading activity…" gate on the fast summary query; the runs table shows its own "Loading the last 200 runs…" spinner independently; empty states point users to `/assets` to trigger a scan or Administration → User Management to add colleagues.

---

## Compliance & Scans (Compliance Overview)

**Purpose & IA.** `/compliance-overview` is a **tabbed host** that consolidates four former sidebar entries into one "Compliance & Scans" area. It renders a top tab strip and mounts sibling pages beneath it (state-only routing, no URL change — inactive tabs don't fetch). Tabs: **Compliance Overview** (this file), **Compliance Rules** (mounts the rule-library page), **Scanners** (mounts the agents-admin page). (A "Risk Posture" tab exists in the codebase but is commented out of the current tab list.)

### Compliance Overview — Device Compliance Drill-Down — `/compliance-overview` (Overview tab)
- **Purpose.** Show every connected device grouped by category and let the user drill from category → device → the exact CIS rules applied.
- **What it shows (the data):**
  - **Executive summary hero (4 panels):** (1) **Overall compliance gauge** — radial % of security checks passed (neutral "—" when no scans); (2) **Check Results donut** — Passed/Failed/Errored split with counts + %; (3) **Scan Coverage** — "X of Y devices scanned" with a segmented bar (Scanned / Awaiting scan / Not mapped); (4) **Asset Risk** — avg risk score + a risk-band bar (Critical/High/Moderate/Low) with a "Highest risk: …" link to `/risk-posture`.
  - **Search box** — filter devices by name/host.
  - **L1 — Category card grid.** One card per device category (Windows, Linux, macOS, Network, Databases, Identity/AD, Cloud, Containers, VMware, Unclassified). Each card: icon, label, description, **device count**, a **circular pass-rate ring**, a health accent stripe, and "{scanned}/{total} scanned · N pass · N fail". Empty categories collapse into a "Not yet covered" chip strip with a "Connect a scanner →" link.
  - **L2 — Expanded category panel.** Assets grouped by **variant chip** (e.g. "Windows 11 · 25H2"); each asset is an expandable row.
  - **L3 — Asset detail (lazy-loaded).** Shows the **AI benchmark matcher** result: Stage 1 (OS-family filter) kept/skipped, Stage 2 (AI edition pick) with chosen benchmark, and "Will execute on this device: N CIS rules". Below, a **paged applicable-rules table** (Rule ID, Title, Severity badge) with "Load 50 more". Per-asset stats row: scanned / pass / fail / pass-rate / last-scan-ago, plus "Open" → `/assets/{id}`.
- **Primary actions & flows.** Click category card → expand (L2); click device → expand (L3, triggers match-preview fetch); "Load more" rules; open asset detail; "See full results with pass/fail →".
- **Notable features.** AI-powered CIS benchmark matching with a two-stage explainer; graceful warnings when OS metadata is too generic ("Stage 1 couldn't narrow the library" / "No OS profile detected") with remediation guidance (install agent / re-detect OS).
- **Empty/loading states.** "Loading device inventory…"; failure banner; "No devices connected yet" dashed card; "No scored assets yet" in the risk panel.

### Compliance Rules — (mounted rule library) — under `/compliance-overview` → Rules tab
- Renders the existing rule-library page (`/compliance-plugins/library`) as an embedded tab — the searchable/filterable CIS rule catalogue. (Owns its own screen; noted here as an IA relationship.)

### Scanners — (mounted agents admin) — under `/compliance-overview` → Scanners tab
- Renders the agents-admin page (`/admin/agents`) as an embedded tab — scanner/agent connection management. (Owns its own screen; noted here for IA.)

---

## Reports

**Purpose & IA.** `/reports` is a self-service reporting workspace with three modes via a segmented control: **Explore**, **Build**, **Trends**. A left rail (hidden in Trends) holds Saved Reports, Templates, and a Module → Dataset picker. Datasets are permission-gated (Reports can't become a side-door into a module the user can't open). A separate chrome-free **print route** produces PDFs.

Datasets available (8, each permission-gated): **Risk Register** (Risk Management), **Controls Library** (Controls), **Evidence Library** (Evidence), **Framework Journeys** (Compliance), **Governance Documents** (Governance), **Asset Inventory** (IT Assets), **Vendor Register** (Vendor Risk), **Vulnerability Register** (Vulnerabilities).

### Reports — Explore / Build / Trends Workspace — `/reports`
- **Purpose.** Let users slice any module's data as an interactive grid, compose saved pivot/chart reports, and view cross-module historical trends.
- **What it shows (the data):**
  - **Header:** title + mode-specific subtitle; the Explore/Build/Trends segmented toggle; a dataset `<select>` (mobile).
  - **Left rail:** *Saved reports* (with shared-icon and delete; "+" to create); *Templates* grouped by category (real editable builder specs); *Module → Dataset* list.
  - **Explore mode:** heading + description for the chosen dataset, then an **interactive data grid** (`ReportGrid`) — sortable/filterable columns, badge-toned status/severity/score cells, links into records. Each dataset defines its own columns (e.g. Risk Register: ID, Risk, Category, Register, Inherent, Residual, Appetite, Status, Closed; Evidence: ID, Evidence, Type, Status, Version, Uploaded).
  - **Build mode:** a **pivot/chart report builder** (`ReportBuilder`) — drag fields into Rows / Columns / Values, view as table or chart, filter, save, share, export.
  - **Trends mode:** a full-width cross-module **`TrendsView`** — historical trends, deltas, and targets across every module.
- **Primary actions & flows.** Pick dataset → explore; New report / open template → build → save/share; Export → PDF (opens the print route in a new tab); delete saved reports.
- **Notable features.** Permission-mirrored datasets; server-or-local saved-report storage (falls back to device-local with an amber warning); shared reports; templates by category; PDF export.
- **Empty/loading states.** "No reportable data" lock screen (no permitted datasets); "None yet — start from a template"; access-lock screen when a shared report references a dataset the user can't open; "Loading…".

### Reports — Executive PDF View — `/reports/print`
- **Purpose.** Render a built report as a clean, print-to-PDF executive document (real vector text, header repeated per page).
- **What it shows.** Title block (module eyebrow, report name, generated timestamp); a **provenance facts grid** (Dataset, Rows "X of Y", Grouped by, Pivoted by, Filters, Search); **KPI total cards** (per measure); an optional **chart** (`PivotChart`); a page break; then the **fully-expanded detail pivot table** (`PivotTable`) with repeating header and a running footer.
- **Primary actions & flows.** Auto-opens the browser print dialog once data + chart render; on-screen "Print / Save as PDF" button to re-trigger. Spec is passed via localStorage since it opens in a new tab.
- **Notable features.** Print-specific CSS hides dashboard chrome, unclips the scrolling table, repeats table headers per page; never auto-prints an errored/empty report.
- **Empty/loading states.** Spinner; "No report to print" guidance; dataset-load-error message.

---

## Workflow Engine

**Purpose & IA.** `/workflow-engine` is the automation studio — build, automate, and monitor GRC workflows. A single page header carries the app title, a **5-tab nav** (Builder, Workflows, Analytics, Approvals, Schedules & Webhooks), and a live **execution stat strip** (Total / Completed / Running / Failed / Waiting). Note: the current Builder uses a **guided fixed-shell builder**; a full free-form React-Flow drag-and-drop canvas (palette + canvas + config inspector + minimap + AI panel + version drawer + templates modal) exists in the file but is currently disabled (`false &&`) — key redesign context, as it represents the intended richer builder.

### Workflow Engine — Builder — `/workflow-engine` (Builder tab)
- **Purpose.** Create/edit an automation as a guided sequence.
- **What it shows / flow.** A **guided builder** shell modeling: **Start → Trigger(s) → Notification(s) → Escalation → End**. It remounts per selected workflow so "New Workflow" starts clean. (The disabled free-form version offers: a left **node palette** of platform-function nodes grouped by module/sub-module plus core nodes — Start, End, Email Notification, In-App Notification, Escalation; a center **React-Flow canvas** with drag-drop, snap-grid, minimap, zoom controls; a right **config inspector** for node/edge settings.)
- **Notable features.** **AI generation** — natural-language prompt → generated node/edge graph; **AI suggestions** and **optimization tips**; category-aware default workflow scaffolds (risk, incident, evidence, audit, policy/access); condition/approval/timer node types; escalation with multi-level day/hour waits; notification templates with runtime variables ({{workflow_name}}, {{action}}, {{resource_type}}). A feature flag (`WORKFLOW_CREATION_LOCKED`) can lock all editing behind a "contact support" banner.

### Workflow Engine — Workflows (list) — `/workflow-engine` (Workflows tab)
- **Purpose.** Manage saved workflow definitions and email delivery setup.
- **What it shows.** An **Email Notification Setup** card ("Active SMTP configs: N", Configure SMTP / Send Test Email buttons); a **Saved Workflows table** (Name, Trigger, Version "vN", Status pill Active/Inactive, Updated timestamp, Actions).
- **Primary actions & flows.** Open (→ Builder), Test (prompts for trigger event + JSON payload, simulates a run), Configure SMTP (modal: host/port/username/password/from-email/from-name/TLS), Send Test Email.
- **Empty/loading states.** "No workflows saved yet."

### Workflow Engine — Analytics — `/workflow-engine` (Analytics tab)
- **Purpose.** Monitor execution health and live instances.
- **What it shows.** Sub-tabs **Overview** and **Live**. Overview: stat cards (Total Executions, Completed, …), plus **bottlenecks** list. Live: auto-refreshing (30s) **live instance monitor** with status badges (running / completed / failed / waiting / waiting_approval / pending), durations, and timestamps.
- **Notable features.** Real-time monitoring with auto-refresh and "last refreshed" indicator.

### Workflow Engine — Approvals — `/workflow-engine` (Approvals tab)
- **Purpose.** Human-in-the-loop approval queue for workflows paused at approval nodes.
- **What it shows.** Filterable list (**Pending / Mine / All**) of approval requests: workflow name, step/node name, requester, requested/decided/due timestamps, overdue flagging, and any comment.
- **Primary actions & flows.** **Approve / Reject** each request with an optional comment (inline decision), which resumes the workflow instance.

### Workflow Engine — Schedules & Webhooks — `/workflow-engine` (Schedules tab)
- **Purpose.** Time-trigger and event-trigger workflows.
- **What it shows.** Sub-tabs **Schedules** and **Webhooks**. Schedules: list of cron/interval schedules (type, cron expression, next/last run, active toggle, owning workflow) with a create form offering **cron presets** (Daily 9AM, Every Monday, Monthly 1st, Quarterly, Annually). Webhooks: list of endpoints (name, event name, token, active, created, last-triggered) with create + copy-token + delete.
- **Primary actions & flows.** Create/toggle/delete schedules; create webhook (returns a copyable token), toggle/delete.

---

## ComplyChat

**Purpose & IA.** `/complychat` is an AI GRC assistant — a full chat UI with a collapsible left **conversation sidebar** and a main chat pane. Conversations persist in localStorage (v2 keys). It is a standalone, full-height screen.

### ComplyChat — AI Compliance Assistant — `/complychat`
- **Purpose.** Let users ask natural-language questions about their controls, evidence, frameworks, risks, and vulnerabilities and get sourced answers grounded in their tenant data.
- **What it shows (the data):**
  - **Conversation sidebar** (collapsible): "Conversations" header, new-chat "+", a list of saved conversations (title + message count, active highlight, hover-delete). Collapses to icon-only rail.
  - **Chat header:** sparkle icon, "ComplyChat AI — Your GRC Compliance Assistant", "New Chat" button.
  - **Empty state:** welcome hero + **4 suggested-prompt cards** — *Framework Progress*, *Evidence Gaps*, *Risk Summary*, *Open Vulnerabilities* (each with icon + description).
  - **Message stream:** user bubbles (right, primary color) and assistant bubbles (left, white) with bot/user avatars and timestamps. Assistant responses render **rich markdown** — styled tables, headings, lists, code, blockquotes. A **"Thinking…"** loader while awaiting.
  - **Per-answer affordances:** **"Load More Results"** (paginated answers, "showing X of N"); a collapsible **"View Sources (N)"** section — each source shows framework code, control code/name, entity type, a relevance-score %, and a snippet.
  - **Input area:** auto-growing textarea (Enter to send, Shift+Enter newline), **file attach** (paperclip) with pending-file chips and per-conversation uploaded-file chips, send button. Footer disclaimer: "ComplyChat can make mistakes… Chats stay here until you delete them."
- **Primary actions & flows.** Ask a question (or click a suggested prompt); attach files for analysis (uploaded per conversation, then summarized); load more results; expand sources; create/switch/delete conversations; collapse sidebar.
- **Notable features.** RAG-style **sourced answers** with relevance scoring; **file upload + document analysis**; **conversation history** (client-persisted, server-side delete on conversation removal); paginated long answers; last-10-message context window sent with each query; tenant-scoped requests.
- **Empty/loading states.** Welcome + suggested prompts when no messages; "Thinking…" loader bubble; graceful error bubble ("Something went wrong on our end. Please try again later.").

---

### Cross-cutting notes for the redesign
- **Consistency:** KPI tiles, score rings, status badges, and the semantic color ramp recur across every screen — a shared component/token set would unify Home, My Runs, Compliance Overview, and the (disabled) board pack.
- **Permission-gating is pervasive:** My Work, Reports, and Home module cards all filter/lock by permission and need first-class "you don't have access" and "no data yet" states.
- **A lot of ambitious dashboard UI is built but flag-disabled** (Home's widget workspace + 8-panel board pack + exotic charts, Workflow's free-form React-Flow canvas). The redesign should make an explicit decision to revive-and-polish or retire these, as they represent significant intended surface area.
- **Real-time + print** are both first-class: My Runs and Workflow Analytics poll live; Reports has a dedicated print-to-PDF route with careful paged-table CSS.

---

# Enterprise Risk — Register & Analytics

This brief documents every in-scope screen under `/erm` for the Risk Register, Risk Assessments, Advanced Analytics, and Risk Appetite areas. It is written for a redesign — each screen lists its purpose, information architecture, the concrete data shown, the primary flows, and any distinctive features. Note a recurring design pattern across this product: a "landing" route renders a **dashboard** overview, and the raw **list** is a sibling route reachable via a view-switcher or button. Slide-over right panels (`RightSlidePanel`) are the default for create/edit; AI assist ("Sparkles" buttons) recurs throughout.

---

## Enterprise Risk Register (`/erm/risks`)

**Purpose.** The central register of all enterprise risks — a single table backed by multiple "register types" (a general/standard register plus template-specific registers: UBL, NCA, PCI-DSS, ISO 27001, SOX, GDPR, NIST, SAMA CSF, Internal, Project-Based, Third-Party, Other). Risks flow in from many sources (manual entry, register imports, assessments, incidents, RCSA findings, framework gaps, UBL/NCA template uploads).

**Information architecture.** A `RiskViewSwitcher` dropdown toggles between two views of the same data: **Dashboard** (the default landing) and **List** (the flat register). The landing route `/erm/risks` renders the Dashboard verbatim; `/erm/risks/list` renders the register table. Individual risks open at `/erm/risks/[id]` (general detail with tabs); NCA-template risks have a dedicated detail at `/erm/risks/nca/[id]`. Register-type and score filters carry through via query params (e.g. `?register_type=…`, `?new=1`, `?upload=1`, `?edit=<id>`).

### Risk Register — Dashboard (`/erm/risks`, `/erm/risks/dashboard`)
- **Purpose.** Give the user a meaningful risk-portfolio overview (per-register breakdown, severity mix, provenance, assignee workload) before dropping into a flat list.
- **What it shows (data):**
  - **Header** with the view switcher; **Import** and **Add risk** buttons (link to `/erm/risks/list?upload=1` / `?new=1`).
  - **Two filter dropdowns** — Register type (each option shows count, e.g. "UBL Template · 42") and Source type (e.g. "RCSA finding · 8") — plus a **Reset filters** link. Filters drill the whole dashboard into a single register or source.
  - **KPI strip (7 tiles):** All risks / In register, Open, In treatment, Mitigated, Accepted, Closed, Assignees (unique owner count). Reactive to filters.
  - **Risk severity mix** — donut with center total ("total scored"), slices Critical/High/Medium/Low.
  - **Severity by register** — horizontal stacked bar (one row per register type, stacked by severity).
  - **Status mix by register type** — vertical stacked bar (Open/In treatment/Mitigated/Accepted/Closed) shown only when no single register is filtered.
  - **Register breakdown cards** (clickable to drill in): each card shows register name, risk count, avg residual score, contributor count, a 5-cell status pill row, and a "Top assignees" mini bar chart.
  - **Single-register detail** (when one register filtered): KPIs (Total, Contributors, Avg residual, Critical risks), a single horizontal status-mix stacked bar with legend, severity donut, category bar chart, top-assignees bar, and an "Open all N … risks →" link.
  - **Source provenance** — donut pie of risks by source, with a clickable legend list; drilling a source shows its status-mix bar and active/closed KPIs.
  - **Empty states** per chart ("No risks scored yet", "No risks tagged with a source yet"), plus a full-page loading spinner.
- **Primary actions & flows.** Filter/drill by register or source; click a register card to filter; jump to the list (filtered) or open Import/Add-risk flows.
- **Notable features.** Everything is reactive to two cross-cutting filters; drill-down navigation is via clicking cards/legend rather than separate pages.

### Risk Register — List (`/erm/risks/list`)
- **Purpose.** The working register: search, filter, triage, create, edit, import, and open individual risks; plus template-specific register views (notably NCA).
- **What it shows (data):**
  - **Risk Heatmap** panel at top: 5×5 likelihood×impact grid with an **Inherent / Residual** toggle; each cell colored by score band and labeled with the risk count; clicking a cell filters the list to that L×I combination (with a "Clear filter" button).
  - **Filter/search row:** free-text search; **Category**, **Register Type**, and **Score** (Critical ≥20 / High 12–19 / Medium 6–11 / Low <6) multi-select dropdowns. Category options adapt to register type (UBL registers expose ISMS/Process/Technology/Third-Party/Other only).
  - **Action buttons:** Import (upload .xlsx), Template (download blank register template), and Add Risk (label switches to "Add NCA Risk" when the NCA filter is active).
  - **Standard risk rows (card list):** each row shows compact title, one-line description, chips for category, sub-category, status, closure status (Closed / Pending Closure with lock icon), a colored **Source badge** (Manual / Register import / Assessment / Incident / RCSA / Framework gap / UBL register / NCA register, each with its own icon+color, plus a source reference), and an "N Actions" chip. Right side shows Inherent (Inh) and Residual (Res) score pills. Row expands to reveal Inherent (L/I/S), Residual (L/I/S), Treatment plan, and — for UBL risks — grouped UBL field sections (Risk Identification / Analysis / Treatment) rendered from `ubl_fields`.
  - **NCA register view** (when NCA filter active): a compact table with chevron-expandable detail rows. Columns: Risk ID, Description, Risk Area, Threat, Inherent Rating (badge), Treatment, Residual Rating (badge), Owner, Action (view/edit/delete). Expanding shows all ~23 NCA template fields.
  - **Empty states:** "No risks found matching your criteria"; NCA-specific "No NCA risks found. Add one or upload the NCA template."; page loader while fetching.
  - **Upload result banner:** success/error with created/skipped/error counts.
- **Primary actions & flows:**
  - **Create/Edit risk** via `RiskModal` slide-over — fields include Title (with **AI Assist**), Description, Register Type, Category, Sub-Category, Status, owner/business unit, Inherent & Residual Likelihood/Impact, Treatment plan, and **Link Assets**; UBL register types reveal template-specific field sections. AI Assist returns suggested description, likelihood/impact, and treatment options, each applicable to its field and savable "for the team" (`AiRecommendationSaver`).
  - **NCA quick-add / edit** uses a dedicated `NcaRiskQuickAddModal` covering every NCA column.
  - **Import**: right-slide upload panel with an optional Register Type selector; NCA templates are parsed client-side row-by-row (via XLSX) and POSTed to the NCA endpoint; standard/UBL go through the register-upload API. Legacy NCA rows are auto-"bridged" into the general register on demand.
  - **Delete** with confirm; row-level view/edit/delete; heatmap-cell filtering.
- **Notable features.** Client-side Excel parsing for NCA; multi-register data model with per-source color coding; inline AI risk drafting; download-template + bulk import.

### Risk Detail — general (`/erm/risks/[id]`)
- **Purpose.** Full view of one risk with scoring, treatment, and all its linkages.
- **Information architecture.** Six tabs: **Details**, **Treatment**, **Internal Controls**, **Assets**, **Evidence**, **Documents** (governance).
- **What it shows (data):**
  - **Header:** expandable long title (Show More/Less), category & status pills, and **Edit** (routes back to list with `?edit=`), **Update Treatment**, **Delete** buttons (permission-gated).
  - **4 stat tiles:** Inherent Risk Score (with L×I), Residual Risk Score (with L×I), Treatment Status (Not Started / In Progress / Completed), Owner / Due Date.
  - **Risk Score Comparison** card: inherent vs residual progress bars (/25) plus a computed **Risk Reduction %**.
  - **Details tab:** for NCA risks, a highlighted "NCA Template Fields" grid; otherwise Description, Important Dates (Created, Due, Review, Last Updated), and Risk Appetite.
  - **Treatment tab:** view/edit the treatment plan (textarea, save).
  - **Controls tab:** linked Internal Controls and Framework Controls (with mitigation effectiveness), each with an inline link-picker and unlink; empty state.
  - **Assets / Evidence / Documents tabs:** linked IT assets, evidence (with status chips), and governance documents/objectives (with impact level) — each with a searchable inline link-picker, count, unlink, and empty state.
  - **Delete confirmation modal.**
- **Primary actions & flows.** Edit risk (delegates to list modal), update treatment inline, link/unlink controls/assets/evidence/documents, delete.
- **Notable features.** Link-pickers combine internal + normalized + framework controls (and documents + objectives) in one searchable list; NCA-aware Details tab.

### NCA Risk Detail (`/erm/risks/nca/[id]`)
- **Purpose.** Dedicated workspace for a single NCA (Saudi cybersecurity) risk register entry, including its treatment lifecycle, mitigation actions, and AI recommendation.
- **What it shows (data):**
  - **Header:** risk identifier (mono), inline lifecycle-status dropdown (Open / In Treatment / Mitigated / Accepted / Closed) + status pill, title (description), risk area + threat line; **Generate/Regenerate AI** and **Edit Fields** (routes to NCA edit modal) buttons.
  - **Score grid:** Inherent L×I, Inherent Rating badge (with override), Residual L×I, Residual Rating badge.
  - **AI Recommendation panel:** parsed JSON rendering summary, Treatment Strategy, Residual Mitigation, and Monitoring lists.
  - **NCA Template Fields** read-only grid (~16 fields: identifier, area, owner, dates, cause, threat, analysis, treatment type/description/owner/deadline, residual description, following steps, last eval date, comment).
  - **Mitigation Actions** list: each action has title, status pill (Open/In Progress/On Hold/Completed), owner, due date, notes; inline add/edit/delete rows.
  - **Linked IT Assets** and **Linked Controls** — expandable multi-select "Manage" pickers with search, chips, and toggles.
  - Bottom toast for autosave ("Saving…" / "Saved").
- **Primary actions & flows.** Change lifecycle status inline; generate AI recommendation; add/edit/delete mitigation actions; link assets/controls; all writes autosave.
- **Notable features.** JSON-structured AI recommendation; inline autosaving; embedded mini task manager for mitigation actions.

---

## Risk Assessments (`/erm/risk-assessments`)

**Purpose.** Two parallel assessment workflows — **manual risk assessments** (a lifecycle over selected register risks) and **framework-driven assessments** (auto-generated questions per framework/methodology) — plus a standalone **AI Risk Assessment** register for AI/ML system risks.

**Information architecture.** The landing route renders a combined **Dashboard**. From there: **Manual assessments** list (`/list`), **Framework assessments** hub (`/framework`), and **AI Risk Assessment** tab (`/ai-risk-assessment`). Manual assessments open at `/[id]` with an **Analytics** sub-page at `/[id]/analytics`; framework assessments open at `/framework/[id]`. The old `/erm/ai-risk-assessment` path permanently redirects into `/erm/risk-assessments/ai-risk-assessment`.

### Assessments — Dashboard (`/erm/risk-assessments`, `/erm/risk-assessments/dashboard`)
- **Purpose.** Combined activity overview across both manual and framework assessments.
- **What it shows (data):**
  - **Header** with back-to-ERM, plus buttons: Manual assessments, Framework assessments, New framework assessment.
  - **Headline KPI strip (5):** All assessments (combined), Manual total, Framework total, Risks assessed (manual), Framework questions.
  - **Framework Assessments section:** KPIs (In progress, Completed, Archived, Avg questions/assessment) and charts — by-status bar, monthly throughput line, by-framework horizontal bar, top creators bar.
  - **Manual Risk Assessments section:** KPIs (Draft, In progress, Under review, Approved, Closed, Avg risks/assessment) and charts — by-status bar, monthly throughput line, assessment-type pie, methodology pie, and top-assessors-by-workload bar.
  - **Empty state** prompting to start a framework or manual assessment; loading spinner.
- **Primary actions & flows.** Navigate to either list; start a new framework assessment.
- **Notable features.** Dual-lifecycle color/label vocab kept consistent with the lists (manual: draft→in_progress→under_review→approved→closed; framework: in_progress→completed→archived).

### Manual Assessments — List (`/erm/risk-assessments/list`)
- **Purpose.** Browse, filter, create, and upload manual assessments (merged with framework assessments for a unified card grid).
- **What it shows (data):**
  - Back-to-dashboard, **Upload Risk Assessment** and **New Assessment** buttons.
  - **Status tabs:** All / Draft / In Progress / Under Review / Approved / Closed; plus a search box.
  - **Card grid** (manual + framework, sorted by date): title, description, **status** badge and **type** badge (framework cards show a "Framework" type), methodology, assessment period, lead assessor (or framework name), a footer with risks-assessed / questions count and created date, and a hover delete.
  - **Empty state** per filter; loading/error states.
- **Primary actions & flows.**
  - **New Assessment** slide-over: Name, Description, Assessment Type (Periodic/Annual/Ad Hoc/Triggered), Methodology (Qualitative/Quantitative/Semi-Quantitative), Scope, Period start/end, Notes.
  - **Upload** slide-over: drag/drop .xlsx, name, type, methodology, scope; shows expected columns; on success reports created/skipped/errored counts with a "View Assessment" CTA.
  - Click a card to open the manual or framework detail; delete (routes to correct API).
- **Notable features.** Excel import that creates an assessment + imported risks; unified list spanning two backend entity types.

### Manual Assessment Detail (`/erm/risk-assessments/[id]`)
- **Purpose.** Work through a manual assessment: manage its risks, score inherent/residual, decide treatment, link related items, and move it through its approval lifecycle.
- **What it shows (data):**
  - **Header:** name + status badge, description, methodology/period/lead meta; **Analytics** link; lifecycle action buttons that change by status — Start Assessment (draft→in_progress), Submit for Review, Approve / Send Back (under_review), Close (approved). Edit and Delete are permission- and status-gated.
  - **5 stat tiles:** Risks Assessed, then Critical/High/Medium/Low counts; plus Avg Inherent & Avg Residual score line.
  - **Assessed Risks list:** each risk card has title, category chip, computed rating badge, and inline editable selects for Inherent L/I (auto Inherent Score), Residual L/I (auto Residual Score), Treatment Decision (Accept/Mitigate/Transfer/Avoid), Control Effectiveness (Effective/Partially/Ineffective), Rationale, Notes — with a per-row **Save Scoring** button. A footer shows linked KRIs / Incidents / RCSA counts. Fields are read-only once the assessment leaves draft/in_progress.
  - **Expanded risk section:** tabbed KRIs / Incidents / RCSA linked-items lists with link/unlink.
  - **Empty state** ("No risks assessed yet").
- **Primary actions & flows.**
  - **Add Risks** slide-over: multi-select checklist of available register risks (with inherent/residual scores) → bulk add.
  - **AI Assist** per risk: suggests treatment decision, control effectiveness, rationale, and notes into the edit buffer.
  - **Link KRI / Incident / RCSA** modals (select item + notes/impact).
  - **Edit Assessment** slide-over (name, description, type, methodology, scope, period, notes).
  - Lifecycle transitions; remove risk; delete assessment.
- **Notable features.** Inline spreadsheet-like scoring with live score computation; AI-assisted treatment; cross-links to KRIs/incidents/RCSA findings; explicit review→approve→close workflow.

### Assessment Analytics (`/erm/risk-assessments/[id]/analytics`)
- **Purpose.** Visual breakdown of a single manual assessment's results.
- **What it shows (data):** back link; title + "Status · N risks assessed"; **4 KPIs** (Total risks, Avg inherent, Avg residual, Score reduction); four charts — **Risk rating distribution** (pie: critical/high/medium/low), **Treatment decisions** (pie: accept/mitigate/transfer/avoid), **Control effectiveness** (bar: effective/partially/ineffective/unrated), **Score band distribution** (bar). Each chart has an empty state.
- **Primary actions & flows.** Read-only; back to assessment.

### Framework Assessments — Hub (`/erm/risk-assessments/framework`)
- **Purpose.** Generate framework-specific assessment questions (per methodology), then manage saved assessments and questions assigned to the current user.
- **What it shows (data):**
  - **New Framework Assessment** card: Framework picker (searchable), Assessment Name, **Coverage** (Full coverage — one question per control, or Sample subset with a size selector 10–50), Description, and a **Methodology Preview** panel. The preview auto-detects the methodology for the chosen framework and shows its display name, description, phase chips, and reference standard — or an amber "AI-generated questions" notice when no methodology maps. A create button labeled by coverage ("Create & generate (full coverage)" / "(N sampled)").
  - **Tabs:** **Saved Assessments** (cards: name, framework, status badge, question count, delete, chevron) and **Assigned To Me** (assigned questions with framework/assessment context, status badge, question text, evidence count).
  - Empty states for both tabs.
- **Primary actions & flows.** Pick framework → preview methodology → create; creation immediately generates questions and routes to the workspace. Open or delete saved assessments; jump to assessments where you have assigned questions.
- **Notable features.** Methodology auto-detection with live preview; AI fallback for unmapped frameworks; full vs sampled coverage.

### Framework Assessment — Workspace (`/erm/risk-assessments/framework/[id]`)
- **Purpose.** Complete a framework assessment question-by-question: methodology fields, risk scoring, evidence, assignment, and promotion of accepted risks into the register.
- **What it shows (data):**
  - **Header:** name, framework + question count; a controls card with **Assessment Status** dropdown (In Progress/Completed/Archived), a **Regenerate** panel (coverage/sample-size, methodology-locked), and **Delete Assessment**.
  - **Question Workspace** card: notice when no methodology is mapped; **Add Manual Question** input.
  - **Per-question cards** (numbered): question text + assignee; a 3-up row of **Status** (Not Started/In Progress/Completed/Blocked), **Assignee** (searchable user picker), and **Evidence Upload**.
    - **Methodology card** (methodology-driven questions only): methodology + phase + clause-reference chips, **AI assist** (suggests values per methodology field + recommended 1–5 scores + assessor guidance + rationale, with Apply-each / Apply-all / Apply-suggested-scores and a re-run-with-context box), and the methodology's own fields (text/textarea/select) with a **Save methodology fields** button.
    - **Risk Rating section:** Inherent L/I (methodology-labeled scale selects) → auto Inherent Score; Residual L/I → auto Residual Score; **Accept Risk** checkbox + Acceptance Notes; a **Move to Risk Register** button (enabled only once risk accepted) or a "Moved to Risk Register #N / Open Register" indicator.
    - **Evidence** list per question (file name, uploader, date, remove).
- **Primary actions & flows.** Generate/regenerate questions; add manual question; set status/assignee; fill methodology fields (AI-assisted); score inherent/residual; accept and promote a question into the risk register; upload/remove evidence; change/delete the assessment.
- **Notable features.** Methodology-aware scales and field schemas; per-question AI suggestions with granular apply; question→register promotion; per-question evidence.

### AI Risk Assessment (`/erm/risk-assessments/ai-risk-assessment`)
- **Purpose.** A dedicated register for AI/ML system risks, aligned to an "AI Risk Assessment Template," with AI-assisted scoring and evidence.
- **What it shows (data):**
  - **Header:** Template download, Upload xlsx, New Entry.
  - **Import result banner** (imported/errors/file).
  - **4 KPI cards:** Total Entries, Open, High Residual, AI Suggestions Generated.
  - **Filters:** search + Category (Ethical/Fairness, Data Privacy, Operational, Regulatory Compliance, IP, Security, Explainability/Trust, Other) + Status (Open/In Progress/Closed/Accepted).
  - **Table:** ID, AI System, Risk Description, Category, Score (with L×I), Residual (tone-coded), Owner, Status (with link to bridged Risk if any), Actions (AI suggest, Bridge to register, Edit, Delete). Empty state prompts new entry/upload.
  - **Entry drawer** (all 13 template columns): Risk ID, Status, AI System/Use Case, Risk Description (required), Category, Residual Risk Level, Likelihood/Impact (1–5) with auto Risk Score, Existing Controls, Mitigation Plan, Risk Owner (tenant-user picker + free-text override), Target Review Date; plus an **AI Suggestions** section (generate/regenerate mitigation, controls, L/I, residual + rationale, and Accept Suggestions) and a **Supporting Evidence** uploader/list.
  - **Delete confirmation modal.**
- **Primary actions & flows.** Create/edit entry; AI-suggest and accept; **bridge** an entry into the main risk register; upload/download evidence; bulk import via template.
- **Notable features.** AI-generated mitigation/scoring with operator acceptance; evidence attachments (model cards, DPIAs, fairness scorecards); one-click bridging to the enterprise register.

---

## Advanced Risk Analytics (`/erm/analytics`)

**Purpose.** A suite of enterprise risk-intelligence tools. **Information architecture:** a hub page links to sub-tools; each sub-tool has its own route and a Back link. (Bow-Tie and Scenario are reachable from ERM overview/sidebar though not tiled on the hub.)

### Analytics Hub (`/erm/analytics`)
- **Purpose.** Launchpad for the analytics tools.
- **What it shows.** Title "Advanced Risk Analytics"; three module cards (Interactive Heat Maps, Risk Aggregation, Automated KRI Triggers) each with icon, description, and feature chips; a "Quick Access" strip of icon links.
- **Primary actions.** Navigate into a tool.

### Interactive Heat Map (`/erm/analytics/heatmap`)
- **Purpose.** Visualize risk distribution across likelihood×impact with drill-down.
- **What it shows (data):** Back link; filter bar with **Inherent/Residual** toggle and **Category** dropdown (+ Clear Filters when active). **5 summary tiles:** Total Risks, Critical (>16), High (9–16), Medium (4–9), Low (≤4). A **5×5 heat map** with named axes (Likelihood: Rare→Almost Certain; Impact: Insignificant→Catastrophic), score-band coloring, per-cell count + score, and a color legend. Loading state.
- **Primary actions & flows.** Toggle inherent/residual, filter category; **click a populated cell** to open a modal listing that cell's risks (title, category, owner, inherent/residual scores).
- **Notable features.** Labeled qualitative scales; cell drill-down modal.

### Risk Aggregation (`/erm/analytics/aggregation`)
- **Purpose.** Enterprise-wide aggregation of risk exposure and reduction effectiveness.
- **What it shows (data):** Back link. **4 enterprise KPI cards:** Total Risks, Total Inherent Score (+avg), Total Residual Score (+avg), Risk Reduction % (with bar). **Severity band tiles:** Critical/High/Medium/Low. **Tabs:** By Category / By Business Unit / By Status.
  - **By Category** table: Category, Count, Total/Avg Inherent, Total/Avg Residual, Reduction %, C/H/M/L counts — plus a stacked severity-by-category bar chart.
  - **By Business Unit** table: same columns per BU, plus per-BU horizontal severity distribution bars with legend.
  - **By Status** table: Status badge, Count, Avg Score, Total Score.
  - Empty states per tab; loading skeleton.
- **Primary actions & flows.** Switch aggregation dimension via tabs (read-only analysis).

### Automated KRI Triggers (`/erm/analytics/kri-triggers`)
- **Purpose.** Monitor Key Risk Indicators and surface threshold-breach alerts with recommended actions.
- **What it shows (data):** Back link; "N active alerts" header. **5 summary tiles:** Total KRIs Monitored, KRIs In Breach, KRIs Healthy (+health ratio bar), Critical Alerts, Warning Alerts. **Severity filter** (All/Critical/Warning). Alerts grouped into **Critical** and **Warning** sections as cards: severity chip, which threshold breached, KRI name, linked risk title, a **green/amber/red threshold track with a current-value marker** (current vs green/amber thresholds), triggered timestamp, owner, and a highlighted **Recommended Action**. Healthy empty state ("All KRIs within acceptable thresholds").
- **Primary actions & flows.** Filter by severity; read alerts and recommended actions (monitoring view, no edits here).
- **Notable features.** Visual threshold gauge per alert; framed as near real-time monitoring.

### Bow-Tie Analysis (`/erm/analytics/bowtie`)
- **Purpose.** Visualize a single risk's threats → preventive controls → risk event → mitigating controls → consequences, with an AI narrative.
- **What it shows (data):** Back link; a searchable **risk selector** (label shows category + residual score). Empty "No Risk Selected" state until chosen.
  - **Bow-tie diagram** (horizontal, scrollable): left **Threats** (title, category, likelihood chip) → **Preventive** controls (name, code, effectiveness %) → central **Risk Event** card (title, category, Inherent/Residual scores) → **Mitigating** controls → right **Consequences** (title, severity, impact, financial impact). Color legend beneath.
  - **Risk Details** card (description, category) and **Score Analysis** card (Inherent, Residual, Reduction points + %, a reduction bar, and counts of threats/preventive/mitigating/consequences).
  - **AI Analysis** panel: **Generate AI Narrative** button rendering a formatted plain-English write-up; idle/empty and error states.
- **Primary actions & flows.** Select a risk → view diagram/scores → generate AI narrative.
- **Notable features.** Distinctive bow-tie visualization; AI-generated narrative explanation.

### Scenario Analysis (`/erm/analytics/scenario`)
- **Purpose.** Model what-if scenarios (stress tests) to see how risk scores would shift.
- **What it shows (data):** Back link; **Inherent/Residual** toggle. A guided 2-step layout:
  - **Step 1 — Select Risks:** search + Select All/None, count, and a scrollable checklist (title, category, current score).
  - **Step 2 — Choose Approach:** **Preset Scenarios** (cards with icon, description, and L/I adjustment chips like "L +1, I +2") or **Custom Adjustments** (per-risk L/I 1–5 number inputs).
  - A scenario-name input + **Run Analysis** button.
  - **Results:** 6 KPI cards (Risks Analyzed, Total Original Score, Total Adjusted Score, Total Change [color-coded], Increased/Decreased, Unchanged); an **AI Explain Results** button (business-impact narrative, savable for the team via `AiRecommendationSaver`); and a results **table** (Risk, Category, Original → Adjusted score, Change, Change %, and Severity original→adjusted with transition arrow).
  - Error states for run/AI.
- **Primary actions & flows.** Pick risks → pick preset or custom adjustments → run → review results → AI-explain (and persist).
- **Notable features.** Preset vs custom stress models; AI explanation with team-sharing; saved AI explanations rehydrate on revisit.

---

## Risk Appetite (`/erm/appetite`)

### Risk Appetite Management (`/erm/appetite`)
- **Purpose.** Configure per-category risk appetite levels and tolerance thresholds, and monitor risks that breach tolerance.
- **Information architecture.** Single page: config **cards** at top, a **breach alerts** panel, and a **configuration table** at the bottom (the cards and table are two editing surfaces over the same configs).
- **What it shows (data):**
  - **Header** with save-success indicator, **New Config** button, and **Save Configuration** (batch save of table edits).
  - **First-run empty state:** "Seed Default Configurations" for all categories.
  - **Config cards** (one per category — Strategic, Operational, Financial, Compliance, Technology, Third Party, Project/Change): category header (color-coded), Appetite Level (Averse→Hungry, color-coded), Tolerance Threshold, **Risks Exceeding / total**, alerts on/off (bell), and description. Inline edit mode exposes Appetite Level, Tolerance Threshold, Max Acceptable Score, an alerts toggle, and description. Each card has an **AI Suggest Thresholds** action producing a suggestion panel (level, threshold, max score, rationale) that can be applied.
  - **Tolerance Breach Alerts** panel: count summary; per-breach row with risk title (links to the risk), category, Score vs Threshold, Days Over, and a **Remediate** link. When clear, an "All Risks Within Tolerance" success panel.
  - **Configuration table:** Category, Appetite Level (dropdown), Tolerance Threshold (input), Escalation Owner, Alerts Enabled (toggle) — edits accumulate for batch save.
  - **New Config** slide-over: Category, Appetite Level, Tolerance Threshold, Max Acceptable Score, Description, Enable Breach Alerts.
- **Primary actions & flows.** Seed defaults; create/edit/delete configs; AI-suggest and apply thresholds; batch-save table edits; jump from a breach to remediate the underlying risk.
- **Notable features.** AI-suggested appetite thresholds; two synchronized editing surfaces (cards + table); live breach monitoring tied to the risk register.

---

# Enterprise Risk — KRIs, Incidents, Reviews & Controls

This brief covers the operational (day-to-day) sub-modules of the ERM / Risk workspace. All of these routes live under `/erm/*`. A shared ERM layout renders a horizontal tab strip — **Risk Register · Appetite · Mitigation Actions · Reviews · Dependencies** — across most screens. Note three deliberate exceptions the designer must respect: **KRIs** have been relocated to the Governance area, **Incidents** now render "clean" (no ERM tab strip) as part of an *Issue & Incident Management* module, and **Internal Controls** have been fully merged into a unified Control Library (`/controls`) — their old ERM routes are now pure redirects. Visual language throughout: white cards with `rounded-xl` borders, slate text, colored pill badges (emerald/amber/orange/rose for status severity), a primary (lime/yellow-green `#0a0a0a`-on-primary) action button, right-sliding side panels for create/edit, and `Sparkles`/`Brain` iconography wherever AI assist appears.

---

## Key Risk Indicators (KRIs) — `/erm/kris`

**Purpose.** Define, monitor, and record measurements for the metrics that signal when a risk is trending toward breach.

**Information architecture.** This screen renders without the ERM tab strip (it has been moved under Governance). At the very top sits a **Register Type** selector that swaps the entire page between two distinct experiences: *Standard KRIs* (the platform's native card-based register) and *NCA KPI Report Template* (a regulator-specific tabular register for the Saudi NCA framework). These are effectively two sub-screens behind one dropdown.

### Screen: Standard KRIs (default view)
- **What it shows.** A responsive **grid of KRI cards** (1–3 columns). Above the grid, a header with alert count chips: "{n} Critical" (rose) and "{n} Warning" (amber), derived from a separate alerts query. Each **KRI card** shows: a colored status dot (green/amber/red/unknown), the KRI name, its measurement frequency, a large current value with unit, the last-measured date, a trend indicator (up/down arrow + delta vs. previous measurement), and a threshold legend row (green ≤ threshold, amber ≤ threshold, red > amber threshold). Each card has a "Record Measurement" button plus edit/delete icons (permission-gated).
- **Empty state.** Activity icon + "No KRIs defined" / "Create Key Risk Indicators to monitor risk metrics." Full-page spinner while loading.
- **Primary actions & flows.**
  - **Add / Edit KRI** — opens a right-slide panel. Fields: Risk (searchable single-select), Name, Description, Metric Type (percentage/count/currency/ratio/score), Unit, Green Threshold, Amber Threshold, Direction (higher/lower is better), Frequency (daily→annually).
  - **Record Measurement** — right-slide panel; enter a numeric value (+ unit) and optional notes. This is the core recurring task.
  - **Upload KRIs** — modal to bulk-import from an Excel file; returns a created/skipped/error summary.
- **Notable features.** **AI Suggest** inside the create/edit panel — prefills name, description, metric type, unit, thresholds, direction, and frequency from the selected risk, with a rationale note. It also **auto-triggers when the user changes the linked Risk**. Bulk Excel upload.

### Screen: NCA KPI Report Template (register-type = "nca")
- **What it shows.** Replaces the card grid with a **compliance-grade KPI table**. Four summary stat tiles: Total KPIs, Domains, On Track (green), Behind (rose). A toolbar with a search box and a **Domain filter** (20 NCA cybersecurity domains — Asset Management, Network Security, Vulnerability Management, etc.). The table columns: expand chevron, KPI ID, Domain, KPI (name), Type, Frequency, and a **"Latest T/A"** pill showing the most recent quarter's Target/Actual color-coded on-track vs. behind. Expanding a row reveals KPI description/definition/data source/reporting year/prior-year Q4 actual, plus a full **quarterly measurements table (Q1–Q4: Target / Actual / Notes)** and any AI analysis panel.
- **Primary actions & flows.**
  - **Add / Edit KPI** — large centered modal (max-w-4xl) grouped into "KPI Definition" (domain, owner from platform user picker, KPI name, description, definition/formula, type, frequency, data source, reporting year) and "Measurements" (prior-year Q4 baseline + four Q-rows of target/actual/notes).
  - **Delete** — confirmation modal.
- **Notable features.** **Upload NCA Excel** (parses both the "KPI" and "Measurement table" sheets of the official NCA workbook, auto-detecting header rows) and **Export** (regenerates a downloadable `NCA_KPI_Report.xlsx` in the same two-sheet template). Per-row **AI Analysis** (`Sparkles`) generates a stored recommendation (summary, trend analysis, recommended actions, target-adjustment advice) rendered in a purple AI panel. Owner links to platform users; each entry can link risks and controls.

---

## Risk Incidents — `/erm/incidents`

**Purpose.** Report, triage, and resolve risk events (incidents), with AI-assisted root-cause and impact analysis.

**Information architecture.** Renders clean (no ERM tab strip) as its own *Issue & Incident Management* module.

### Screen: Incidents list
- **What it shows.** A row of **four KPI stat tiles** sourced from an incident dashboard endpoint: Open Incidents (rose/AlertTriangle), Investigating (amber/Clock), Resolved this Month (emerald/CheckCircle), and **Total Financial Impact** in $K (orange/DollarSign). Below, a **filter bar** with Severity and Status single-selects, and a "Report Incident" primary button. The body is a **vertical list of incident cards**, each showing: title, 2-line description clamp, severity pill (low→critical), status pill (open/investigating/mitigating/resolved/closed), incident date, and a financial-impact chip. Each card has three icon actions: **AI Analysis** (`Sparkles`), Edit, Delete.
- **Empty state.** AlertCircle + "No incidents found."
- **Primary actions & flows.**
  - **Report / Edit Incident** — right-slide panel. Fields: Title, Related Risk (searchable), Incident Date, Severity, Status (edit only), Financial Impact ($), Description, Root Cause, Corrective Actions, Operational Impact. Includes an **AI Suggest** header block that prefills severity, root cause, corrective actions, and operational impact.
  - **AI Analysis** — a large right-slide panel (max-w-3xl). This is the standout flow.
- **Notable features — AI Analysis panel.** On demand, calls an AI endpoint and renders a rich report: **Root Cause Analysis** (primary cause, contributing-factors list, category + preventability chips); a **4-up impact-assessment grid** (Financial / Reputational / Regulatory / Operational, color-coded by level); **Related Risks** (with relevance badges + explanation); **Related Controls** (with framework tag + status recommendation); a **Recommended Actions** checklist; and **Similar Incidents** with a % match score. The panel also embeds an **AiRecommendationSaver** so the analysis can be persisted against the incident. Loading state is an animated pulsing `Sparkles` ("Analyzing incident with AI…").

---

## Risk Reviews — `/erm/reviews`

**Purpose.** Schedule and conduct periodic risk reviews, re-scoring inherent/residual risk and capturing findings/evidence.

**Information architecture.** Part of the ERM tab strip (Reviews tab).

### Screen: Reviews list
- **What it shows.** Three **colored KPI tiles**: Pending Reviews (amber), Overdue Reviews (rose), Completed This Month (emerald) — each from its own query. A Status filter (pending / in_review / completed / overdue) and a "Schedule Review" button. The body is a **list of review cards**; each card shows the risk title, a status pill, "{review_type} • {review_cycle}", the assigned reviewer (with user icon), and a right-aligned Due date. **Overdue cards turn rose-tinted** and show an "Overdue" flag. Cards contextually surface a **"Start Review"** (pending) or **"Complete Review"** (in_review) button, and render prior findings inline if present.
- **Empty state.** Calendar icon + "No reviews scheduled."
- **Primary actions & flows.**
  - **Schedule Review** — right-slide panel: Risk (searchable), Review Cycle (monthly→annual), Review Type (periodic/triggered/ad_hoc/audit), Assign To (searchable user picker), Due Date.
  - **Start → Complete Review** — a two-state right-slide panel (max-w-2xl). Opening it on a pending review auto-transitions the review to `in_review`. The form presents **Inherent Risk** (Likelihood 1–5, Impact 1–5) and **Residual Risk** (Likelihood, Impact) inputs pre-populated from the risk record, plus Findings and Recommendations textareas, and an **Attach Evidence** dropzone (file + name + description). On completion it writes back changed risk scores, uploads and links the evidence, and records new inherent/residual scores (likelihood × impact) plus findings/recommendations on the review. Inline error surface if completion fails.
- **Notable features.** The review completion is effectively a mini re-assessment wizard that mutates the underlying Risk record and attaches evidence in one submit.

---

## Mitigation Actions — `/erm/mitigation-actions`

**Purpose.** Track the treatment actions that reduce residual risk — assign owners, set due dates, link evidence, and record actual reduction achieved on completion.

**Information architecture.** Part of the ERM tab strip (Mitigation Actions tab). Note: data is assembled client-side by fanning out per-risk action queries and flattening them into one table.

### Screen: Mitigation Actions table
- **What it shows.** Four **stat tiles**: Total Actions, Open Actions, **Overdue Actions** (rose emphasis), Completed this Month. A toolbar: search box + three single-select filters — Status (open/in_progress/completed/overdue/cancelled), Priority (critical/high/medium/low), Type (mitigate/transfer/avoid/accept) — and an "Add Action" button. The core is a **table** with columns: Title (+ description subline), Risk (links to register), Type pill, Status pill, Priority pill, Owner, Due Date (rose + "(Overdue)" when late), **Expected Reduction (%)**, row actions, and an expand chevron. Row-level actions: **Complete** (checkmark), Edit, Delete.
- **Expandable row detail.** Clicking a row expands a **full-width 12-column detail panel**: left side = full Title / Description / Notes and a metadata strip (Risk, Owner, Expected reduction, Actual reduction); right side = a **Linked Evidence** manager — a searchable evidence dropdown + "Link" button, and a list of linked evidence with unlink (×) buttons. Evidence already linked is excluded from the picker.
- **Empty state.** ListTodo icon + "No mitigation actions found."
- **Primary actions & flows.**
  - **Create / Edit Action** — right-slide panel: Risk (locked on edit), Title, Description, Action Type, Priority, Status, Due Date, Assignee (searchable tenant users), Expected Residual Reduction (%), Notes.
  - **Complete Action** — small right-slide panel prompting for **Actual Residual Reduction Achieved (%)** (defaulting to the expected value), then marks complete.
- **Notable features.** **AI Suggest** (create only) returns a set of suggested mitigations as clickable cards (title, type + priority badges, description, expected reduction %); clicking one applies it to the form. Per-row evidence linking is a distinctive inline capability.

---

## Risk Dependencies — `/erm/dependencies`

**Purpose.** Map relationships between risks and run cascade analysis to understand how one risk propagates to others.

**Information architecture.** Part of the ERM tab strip (Dependencies tab).

### Screen: Dependencies list + cascade analysis
- **What it shows.** A header with a title/subtitle and a **"Select risk for cascade analysis"** searchable dropdown, plus an "Add Dependency" button. When a risk is selected, a **Cascade Analysis panel** (primary-tinted card) appears showing the risk title, a bold **Total Cascade Score**, and a **Direct Impacts** list (arrow rows: impacted risk title + type + strength). Below, a **list of dependency rows**, each rendered as a relationship: Source risk (labeled "Source") → a **colored directional arrow with the relationship type label** (Causes/Caused By/Related/Amplifies/Mitigates, color-coded) → Target risk (labeled "Target"), plus a **Strength "n/5"** readout and a delete button.
- **Empty state.** GitBranch icon + "No dependencies defined."
- **Primary actions & flows.**
  - **Add Dependency** — right-slide panel: Source Risk (searchable), Dependency Type, Target Risk (searchable), **Strength slider 1–5** (Weak↔Strong), optional Description. Validates that source ≠ target.
- **Notable features.** The relationship-graph metaphor (source→type→target) and the on-demand cascade scoring are the distinctive elements; consider a visual node/edge graph in redesign.

---

## Internal Controls — `/erm/internal-controls` and `/erm/internal-controls/[id]`

**Purpose (legacy).** These routes historically hosted internal/risk-sourced control management.

**Information architecture / status.** **Both the list and detail routes are now pure redirects to the unified Control Library at `/controls`.** They render nothing and immediately `router.replace('/controls')`. The designer should treat internal controls as fully absorbed into the Control Library workbench (worked there filtered by source = Internal / Risk) — no bespoke UI remains here. Flagged for completeness only.

---

## Framework Control Detail — `/erm/framework-controls/[id]`

**Purpose.** Show a single framework/compliance control and the **vulnerabilities that are its failing evidence** — the compliance half of the "every vuln points to a failing control, every control lists its evidence" loop.

**Information architecture.** A standalone detail page reached by clicking a framework chip or control code from a vulnerability's Controls tab. Reads a `?type=parsed|legacy` query param to target the right control model. Has its own "Back" affordance (no ERM tab strip).

### Screen: Framework control detail
- **What it shows.**
  - **Header:** framework short-code badge, mono control code, control name, framework name.
  - **Description card:** control Statement and Control Objective (shown when present).
  - **Vulnerability Evidence section** with an **"Include resolved" toggle** that switches the whole view between open-only and full-history.
  - **Summary strip — four tiles:** Open/Total count ("vulnerabilities linked"), **Actively Exploited** (CISA KEV count, turns rose when >0), **Max Priority** (composite 0–10, orange), and a **Severity Mix** cluster of colored count badges (critical/high/medium/low/info).
  - **Evidence table** columns: Title (links to the vuln, with a **KEV** badge + vuln_id subline), CVE (mono), Severity badge, **Priority** (composite, 2-decimal), CWE, **Source** (Auto — with `Sparkles` + originating CWE, vs. Manual), Status (resolved statuses in emerald, else neutral), and an external-link icon to open the vulnerability.
  - **Empty state:** Bug icon (emerald) with context-aware copy ("clean audit trail" vs. "not currently failing").
  - **Footer explainer** describing how rows arrive (Auto CWE-mapper vs. Manual linking).
- **Primary actions & flows.** Read-only/drill-down oriented: toggle resolved, click through to individual vulnerabilities. No create/edit here.
- **Notable features.** The bidirectional control↔vulnerability evidence linkage and the KEV/composite-priority risk signals are the defining data. All content comes from a single evidence endpoint.

---

## CWE → Control Overrides — `/erm/cwe-overrides`

**Purpose.** Let a tenant's compliance team customize the automatic CWE→framework-control mapping — add org-specific links or remove shipped defaults they disagree with.

**Information architecture.** Standalone admin/config-style page (no ERM tab strip), tied to the Vulnerability Management auto-mapper.

### Screen: CWE overrides manager
- **What it shows.**
  - **Intro header** explaining the default map (CWE Top 25 vs. PCI/ISO 27001/OWASP/NIST) and an "Add Override" button.
  - **"Your Overrides ({n})" card:** overrides **grouped by CWE-ID**, each group headed by a CWE badge (or "BASELINE" for the special `__vuln_mgmt__` / `__kev__` sentinel rule-sets) with a human label. Within each group a small table: **Action** (add = emerald / remove = rose badge), Framework prefix (mono), Control pattern (mono), Notes, and a delete (trash) button. Empty state: `Sparkles` + "No overrides yet — the auto-mapper is using the shipped defaults only."
  - **"Effective Resolution Preview" card:** a live what-if tool. Inputs: a CWE-ID text field, a "Vuln has a CVE" checkbox, and a "KEV-flagged" checkbox. Output is a **two-column diff**: left = Default identifiers (prefix/code, mono list), right = **Effective (after your overrides)** in a primary-highlighted card where newly added identifiers carry a green **"ADDED"** tag; footer notes how many overrides were applied.
- **Primary actions & flows.**
  - **Add Override** — centered modal: CWE-ID (accepts real CWEs or the `__vuln_mgmt__` / `__kev__` sentinels), an **Add / Remove toggle** (segmented buttons), Framework prefix (substring match), Control pattern (substring match), and a recommended Rationale/notes textarea. Inline error surface.
  - **Delete override** — immediate (trash icon), invalidates both the list and the preview.
- **Notable features.** The real-time defaults-vs-effective **preview diff** is the signature UX; changes take effect on the next vulnerability enrichment. This is a power-user/compliance-admin surface — dense, mono-typed, technical.

---

## ERM Reports & Analytics — `/erm/reports`

**Purpose.** Generate executive/board/department/audit risk reporting views and export an audit report.

**Information architecture.** A single page with **four internal tabs** (Executive / Board / Department / Audit Report) driven by underlined tab navigation; each tab renders a different pre-built report from its own query.

### Screen: Reports (tabbed)
- **Executive Report tab.** Four **KPI tiles** (Total Risks, Critical Risks [rose], Avg Risk Score, Appetite Breaches [orange]) from an executive-dashboard summary. Two side-by-side cards: **Top Risks** (title + score + up/down trend arrow, top 5) and **KRI Alerts** (name + value/status pill colored red/amber, top 5).
- **Board Report tab.** A **Risk Profile Summary** card with the reporting period and a 3-up count grid (Total / New [amber] / Closed [emerald] risks). A **Key Risk Changes** card listing risks with a previous-score → current-score transition (arrow, rose if worse / emerald if improved).
- **Department Report tab.** A **Risk by Category** card: per-category rows showing total count plus Avg Inherent and Avg Residual scores.
- **Audit Report tab.** An **Appetite Breaches** card listing each breaching risk (title, category, "+{n}% over appetite", days in breach) in rose-bordered rows, with a "No appetite breaches detected" fallback. Includes an **"Export Audit Report"** primary button that generates a named audit report artifact.
- **Loading/empty states.** Full-page spinner while the executive + board queries load; each list has its own "No risks available / No alerts" fallback text.
- **Primary actions & flows.** Switch report tab (drill into different lenses); **generate/export** the audit report.
- **Notable features.** This is a read-only reporting console aggregating multiple ERM endpoints (executive dashboard, board summary, category aggregation, appetite breaches, 90-day trends). The trends query is fetched but not yet heavily visualized — an obvious redesign opportunity for real charts (trend lines, category bars, heat distribution). No PDF/print today beyond the audit export.

---

### Cross-cutting notes for the redesign
- **Consistent create/edit pattern:** almost every module uses a **RightSlidePanel** for forms and a shared searchable **MultiSelectDropdown** for risk/user pickers — a redesign should standardize this panel system.
- **AI assist is pervasive** but inconsistent in presentation (inline "AI Suggest" prefill blocks on KRIs/Incidents/Mitigation Actions; a full analysis panel on Incidents; per-row generation on NCA KPIs and Framework-control auto-mapping). Unifying the AI affordance is a strong opportunity.
- **Permission-gating:** create/edit/delete buttons are conditionally shown via `usePermissions` (e.g. `erm:kris:create`, `erm:incidents:delete`, `erm:mitigation_actions:edit`) — the designer should account for reduced-capability states.
- **Status color system** is shared: emerald (good/completed), amber (warning/in-progress), orange (high), rose (critical/overdue), slate (neutral/closed). KEV/actively-exploited signals use rose emphasis in the vuln-linked screens.

---

# RCSA — Risk & Control Self-Assessment

**Purpose of the module.** RCSA is the workspace where a bank/enterprise runs periodic self-assessment cycles: risk teams build assessment templates, launch a *campaign* for a period (e.g. Q1 2026), assign each business unit its own *assessment*, business-unit assessors answer risk/control questions (with optional AI help and evidence uploads), reviewers approve or reject the submissions through a multi-tier workflow, and any weaknesses surface as *findings* that get remediated and linked back to the risk register and controls.

**Information architecture.** The module lives under `/erm/rcsa` and shares one persistent horizontal tab bar (sub-navigation) rendered by `layout.tsx` on every screen. Tabs, in order: **Dashboard** (`/erm/rcsa`), **Campaigns** (`/erm/rcsa/campaigns`), **Assessments** (`/erm/rcsa/assessments`), **Templates** (`/erm/rcsa/templates`), **Custom Templates** (`/erm/rcsa/custom-templates`), **Findings** (`/erm/rcsa/findings`), **Approvals** (`/erm/rcsa/approvals`). Each tab has a list screen and a detail screen; the module also nests two parallel template systems (structured "question" templates vs. uploaded Excel "custom" templates) and two review surfaces (the Approvals queue and an inline reviewer mode inside the assessment). Every create/edit interaction happens in a right-sliding panel/drawer rather than a full page. Actions are permission-gated (`risks:rcsa:create`, `:edit`, `:delete`, `erm:rcsa:*`).

---

### Dashboard — `/erm/rcsa`

**Purpose.** A program-health command center that summarizes campaign progress, the assessment pipeline, findings, and the reviewer's personal work queue in one scroll.

**IA note.** Landing screen for the module; nearly every tile/card deep-links into the other tabs. Header actions: **Templates**, **View Findings**, and a primary **New Campaign** (routes to Campaigns with the create panel pre-opened).

**What it shows (data).**
- **4 KPI stat tiles** (each a link, colored icon chip on a neutral card): Active Campaigns, Pending Assessments (amber, "awaiting response"), Open Findings (rose, "need remediation"), Completion Rate (emerald, %).
- **Assessment Workflow Pipeline** — a custom vertical-bar chart with one bar per stage: Not Started, In Progress, Submitted, Under Review, Approved, Rejected; count labels above bars plus a color-chip legend grid. Empty state: "No assessments yet."
- **Risk Severity Distribution** — a single horizontal proportional (stacked) bar splitting open findings into critical/high/medium/low, with a 4-cell count legend; "View All" link. Empty state: green "all clear" line.
- **RCSA Program Maturity** — a Recharts **radar chart** plotting 5 derived dimensions (Completion, Quality, Coverage, Findings Mgmt, Timeliness), each 0–100. Below it, a small Campaigns status breakdown list (Active/Closed/Draft counts with color dots).
- **Health Snapshot** — 4 mini metric tiles (Total Assessments, Approved Rate %, In Progress, Submitted) plus an "Avg Campaign Progress %" strip.
- **Business Unit Progress** — Recharts horizontal **bar chart**, completion % per BU (top 8, sorted), bars colored by threshold (≥80 green, ≥60 amber, else red). Count badge "N units." Empty state guidance to assign units.
- **Recent Campaigns** — compact card list (up to 6): name, status pill, thin progress bar + %, and "template · N units" subline; each row links to campaign detail.
- **Campaign Progress** — Recharts vertical **bar chart** of completion % across recent campaigns (angled x-labels).
- **All Campaigns table** — columns: Campaign (+units subline), Template, Period, Status pill, Progress (bar + %), and a view (eye) action.
- **My Assessments table** — columns: Assessment (campaign name), Business Unit, Due date, Status pill, and a contextual action (Continue vs. View). Empty state provided.
- **Pending Reviews table** — columns: Assessment, Business Unit, Submitted date, and a primary **Review** button (routes to assessment in review mode). Count badge in header; "all caught up" empty state.
- **Quick Actions** — 3 large link cards: New Campaign, New Template, View Findings.
- Skeleton loading state with placeholder tiles/cards.

**Primary actions & flows.** Drill into any campaign/assessment/finding; start "New Campaign"; jump into review of a submitted assessment; navigate to templates/findings.

**Notable features.** Radar-based maturity scoring (all derived client-side), pipeline visualization, and a dual personal-work surface (My Assessments + Pending Reviews) that makes the dashboard also function as a to-do list.

---

## Campaigns

**Purpose & IA.** Campaigns are the assessment cycles. The list is a card grid; the detail page is the operational cockpit for one campaign (assign units, monitor progress, remind, close, export). Create happens in a right-slide panel.

### Campaigns list — `/erm/rcsa/campaigns`

**Purpose.** Browse, filter, and manage all RCSA campaigns; create new ones.

**What it shows.** Search box + **Status** filter (Draft/Active/Closed) + **Period** filter (Q1–Q4 / Annual). A responsive **card grid**; each card shows: campaign name, status pill w/ icon, description (or "Using X template"), period + start–end date range, "N units assigned / M completed," a **progress bar + %** (green at 100%), and an amber "N pending assessments" line when relevant. Empty state card with a create CTA. Skeleton loader.

**Primary actions & flows.** Per card: **View** (→ detail); **Activate** (draft→active, confirm dialog); **Close** (active→closed, confirm); **Delete** (non-active, confirm). **New Campaign** opens a right panel form: Name, Description, Template (select from templates), Period (Q/Annual 2026), Start & End dates. Deep-link `?action=new` auto-opens the panel.

**Notable features.** Status-driven action affordances; opening via query param from the dashboard.

### Campaign detail — `/erm/rcsa/campaigns/[id]`

**Purpose.** Run a single campaign: see aggregate stats, manage per-BU assessments, chase and export.

**What it shows.**
- Header: name + status pill + description; contextual buttons (Activate for draft; Send Reminders + Close for active; Export Results always).
- **6 stat cards:** Template, Period, Duration (date range), Progress (bar + %), Avg Risk Score, Total Findings.
- **Assessment Progress table** (titled "N Business Units"): checkbox column (select-all), Business Unit, Assessor (name + email or "Not assigned"), Status pill w/ icon, Progress bar, Risk Score (color-coded by threshold), Control Score (color-coded), Findings count (amber if >0), Submitted date.
- **Status Summary** card: count per assessment status with icons.
- **Pending Actions** card: up to 5 not-started/in-progress assessments (BU + assessor + status), or an all-complete message.
- Skeleton + "Campaign Not Found" error states.

**Primary actions & flows.** Bulk-select assessments → **Send Reminder (N)**. **Assign Business Unit** opens a right panel: pick an unassigned BU (searchable dropdown) and optional Assessor. Activate/Close (confirm dialogs, activation warns it notifies assessors). **Export Results** downloads an `.xlsx` (client-side blob download). Send Reminders (whole campaign or selected).

**Notable features.** Bulk reminder ops; Excel export; live assign flow that filters out already-assigned units; email reminders.

---

## Assessments

**Purpose & IA.** The assessor's questionnaire. List (table) → detail (the fillable form, which doubles as the reviewer's read view). This is the most interaction-heavy screen in the module.

### Assessments list — `/erm/rcsa/assessments`

**Purpose.** Find and act on assigned assessments.

**What it shows.** Search + filters: **Campaign**, **Status** (Not Started / In Progress / Submitted / Under Review / Approved / Rejected), **Business Unit** (options derived from loaded rows), plus a **Clear filters** button when any is active. **Table** columns: Campaign, Business Unit (or italic "Unassigned"), Assessor, Status pill, Score (control→risk→AI-quality fallback, color-coded), Due Date (rose if overdue). Action column shows a state-specific control: **Start** (not_started), **Continue** (in_progress), **Revise** (rejected), else **View**. Empty and error states; page loader.

**Primary actions & flows.** Start an assessment (mutation), or navigate into detail to continue/view/revise.

### Assessment detail (fill + review) — `/erm/rcsa/assessments/[id]`

**Purpose.** Answer (or review) the questionnaire section by section, attach evidence, get AI help, then submit / approve / reject.

**What it shows.**
- Header: campaign name, business unit, due date, status pill. Action set depends on status: editable states (not_started/in_progress/rejected) show **Save Draft** + **Submit**; review states (submitted/under_review) show **Approve** + **Reject**.
- **Progress bar card:** "X of N questions answered (%)", plus a **List View / Step View** toggle. Step view adds a "Question i of N" counter with prev/next.
- **Questions**, grouped into collapsible **sections**. Four question types with distinct inputs:
  - *Risk rating* — Likelihood (1–5 Rare…Almost Certain) + Impact (1–5 Insignificant…Catastrophic), as button grids (step view) or dropdowns (list view).
  - *Control rating* — Effectiveness choice cards: Effective / Partially Effective / Ineffective / Not Applicable (color-coded).
  - *Yes/No* — two large toggle buttons / radios.
  - *Text* — free-text textarea.
  - Each question shows required asterisk, optional guidance/help text, and a per-question **Supporting Evidence** area (upload with type restrictions, file list w/ size, in-place **preview** via EvidencePreviewButton, remove).
- Validation banner + red row highlighting for empty required fields.

**Primary actions & flows.** Save draft; **Submit** (soft-gated — warns about empty required fields but lets the assessor submit their portion anyway). Step-view walks question-by-question, auto-saving on Next; final step shows **Submit Assessment**. **Reject** opens a right panel requiring a reason (shared with assessor). Approve uses an inline comment default. Evidence upload hits a dedicated multipart endpoint.

**Notable features.** **AI Assistant** per question (Sparkles button) — fetches a suggestion with a confidence %, a written rationale, and **recommended evidence to upload** (type + description + example filenames); "Accept Suggestion" writes the AI values into the response. Dual view modes (list vs. wizard/step). In-flow evidence preview. Read-only rendering for reviewers.

---

## Templates (structured/question-based)

**Purpose & IA.** The library of reusable questionnaires. Two sources: **System** (locked, clone-only) and **Custom** (editable/deletable). List is a card grid; detail is a question builder. Create/clone/upload use right panels.

### Templates list — `/erm/rcsa/templates`

**Purpose.** Browse, create, upload, clone, download, and delete templates.

**What it shows.** Search + **Source** filter (All / System / Custom). Success/error banner for uploads. **Card grid**; each card: name, source pill, description, framework type, question count, category pill (color per category). Skeleton loader.

**Primary actions & flows.** **View** (→ detail); **Clone** (right panel: new name + description); **Edit**/**Delete** (custom only, permissioned); **Download** (.xlsx blob). **Upload Template** panel: name, category dropdown, drag/drop Excel/CSV file zone. **New Template** panel: name, description, category, framework type.

**Notable features.** Excel/CSV import and export; system-vs-custom governance model; clone-to-customize.

### Template detail (question builder) — `/erm/rcsa/templates/[id]`

**Purpose.** Inspect a template's questions, or (custom + edit mode) author and reorder them.

**What it shows.** Header: name + source pill + description; unsaved-changes / saved / error status indicators. **4 stat cards:** Category, Framework Type, Questions count, Last Updated. **Questions list** — each row: sequence number, question text, type pill (Risk Rating/Control Rating/Yes-No/Text/Multiple Choice, color-coded), category/section, Required flag, option count. In read mode each question is **click-to-expand**, revealing risk category, control objective, guidance, multiple-choice options, a risk-rating 1–5 color scale, a control-effectiveness scale, and an "AI suggestions enabled" badge. Empty state ("No Questions Yet"). Error/skeleton states.

**Primary actions & flows.** Edit mode (`?edit=true`, custom only): **Add Question** / **Edit** open the QuestionModal right panel (question text, type as a 2-col picker with descriptions, dynamic multiple-choice option editor, category, guidance, required checkbox); **drag-and-drop reorder** (grip handle, resequences); **Delete** (confirm); **Save Changes** (disabled until dirty).

**Notable features.** Drag-to-reorder authoring; type-specific scale previews; AI-enablement per question.

---

## Custom Templates (Excel-native)

**Purpose & IA.** A parallel template system that ingests the bank's *own* RCSA Excel file, auto-detects its column structure (including two-row merged UBL-style headers), and then drives row CRUD, AI explanations, evidence, assignment, risk-register linkage, and re-export — all in the customer's exact layout. The list page has two tabs (**Templates**, **My Assignments**); the detail page is a matrix/grid with a per-row drawer.

### Custom Templates list — `/erm/rcsa/custom-templates`

**Purpose.** Upload/parse an Excel RCSA template and manage the resulting templates; also a personal cross-template work feed.

**What it shows.**
- **Upload card:** file picker (.xlsx/.xlsm), optional Name / Function area / Description; explanatory copy about column detection and seed-row import; upload button with rich error hints (401/403/413/422); success line.
- **Tab bar:** Templates | My Assignments (with a count badge).
- **Templates tab:** "Include deactivated" checkbox; **table** with Name (+ original filename, monospace), Function area, Columns count, Rows count, Sheet, Status pill (Active/Deactivated), and Actions: **Open** (matrix), **Original** (re-download source .xlsx), **Export** (current rows in same layout), **Deactivate** (soft-delete, confirm). Empty state.
- **My Assignments tab:** Refresh button; **table** of every row assigned to the current user across templates: Template (+ item #), Risk ID, Inherent (label/score), Residual (label/score), Evidence count, Updated timestamp, **Open** (deep-links to the row's drawer). Empty state.

**Primary actions & flows.** Upload & parse; deactivate; download original/export; jump into a specific assigned item.

**Notable features.** Schema auto-detection from real spreadsheets; layout-preserving re-export; soft-delete with retained rows; cross-template "assigned to me" feed.

### Custom Template detail (matrix) — `/erm/rcsa/custom-templates/[id]`

**Purpose.** Work the assessment as a spreadsheet-like matrix of items, each editable through a rich multi-tab drawer.

**What it shows.**
- Back link + **Original** / **Export current** buttons.
- **Header card:** name, description, chips for function area, sheet name, column count, row count; parser **warnings** list (amber) if any.
- **Assessment items table:** dynamically shows ~5–7 "primary" columns chosen heuristically (Risk ID, Process, Risk Description, Inherent Overall, Residual Overall, …) with group sublabels; cells are 2-line-clamped. Per-row status **chips**: assignee (first name), evidence count (paperclip), AI-explanation cached (Sparkles "AI"). Row actions: **Edit** (drawer), and either a **Risk #N** link (if promoted) or **Promote** (create a Risk Register entry). Empty state row.
- **Row drawer (modal):** for a new row it's a single form; for an existing row it has 4 tabs:
  - **Fields** — form auto-generated from the schema, grouped into fieldsets; input type inferred per column (yes/no select, number/score input, description/action → textarea, else text with sample-value placeholder).
  - **AI Explain** — generate/regenerate a plain-language summary of the item (cached, with generated timestamp and "from cache" note); "Analyze with AI" / "Re-analyze."
  - **Evidence** — attach via **Upload file** or **Pick from library** (searchable Evidence Library combobox); list of attached items with library-vs-uploaded badge, uploader, date, size, description, download and delete.
  - **Assign** — searchable **user combobox** to set the item's owner (with unassign), plus a "currently assigned to" summary and a note about needing `erm:rcsa:view`.
  - Footer: Delete item (existing), Close, Save.

**Primary actions & flows.** Add/edit/delete rows; assign owner; upload/link evidence; run AI explanation; **promote a row to a formal Risk**; export. Deep-link `?open=<rowId>` auto-opens a row's drawer (from My Assignments) and cleans the URL.

**Notable features.** Fully schema-driven dynamic form; AI row explanation; dual evidence sourcing (upload vs. central library) with debounced search; one-click promotion into the risk register; layout-faithful export.

---

## Findings

**Purpose & IA.** The remediation tracker for weaknesses surfaced by assessments. List is a table with inline linking/action modals; detail is a workflow + remediation workspace.

### Findings list — `/erm/rcsa/findings`

**Purpose.** Triage findings and connect them to risks, controls, and mitigation actions.

**What it shows.** Search + **Severity** filter (Critical/High/Medium/Low) + **Status** filter (Open/In Progress/Remediated/Closed). **Table** columns: Title (with severity-colored icon, plus small "Risk #N"/"Control #N" chips when linked), Severity pill, Status pill, Business Unit, Created date, Due Date (rose if overdue). Action icons per row: **View**, **Link to Risk** (target), **Link to Control** (shield), **Create Action** (plus, permissioned). Empty/error/loading states.

**Primary actions & flows.** **Link to Risk/Control** opens a right panel to enter an entity ID. **Create Mitigation Action** opens a panel: title, description, due date. Drill into detail.

**Notable features.** Cross-linking to the Risk and Internal-Controls modules directly from the row.

### Finding detail — `/erm/rcsa/findings/[id]`

**Purpose.** Advance a finding through remediation and manage its mitigations and links.

**What it shows.** Header: severity icon + title, business unit, created date, severity + status pills. **Status Workflow** stepper across Open → In Progress → Remediated → Closed (past = check, current = play + ring, next = clickable, future = disabled). Two-column body: left — **Description**, **AI Recommendation** card (when present), **Mitigation Actions** list (title, due date, status pill) with **Add Action**; right — **Details** (Assessment, Due Date w/ overdue coloring, Last Updated) and **Linked Items** (Linked Risk / Linked Control, each either an external-link chip to the target module or a "Link" affordance). Loading/error states.

**Primary actions & flows.** Advance status one step at a time (confirm dialog); add mitigation actions (right panel); link a risk/control (right panel with ID entry). Links navigate to `/erm/risks/[id]` and `/erm/internal-controls/[id]`.

**Notable features.** Guided single-step status workflow; AI remediation recommendation; deep cross-module linking.

---

## Approvals

**Purpose & IA.** The reviewer's queue for submitted assessments, with a multi-tier approval workflow. List is a queue of cards; detail is a full read-only review of responses plus a 4-way decision (approve/reject/return/delegate) and history.

### Approvals list — `/erm/rcsa/approvals`

**Purpose.** See everything awaiting review and act quickly.

**What it shows.** Search + **Campaign** filter. A stacked list of **cards**, each with: clock icon, campaign name, business unit, assessor, submitted date; right side shows **Approval Tier** (current of total), **Score %** (color-coded), optional **AI Quality %** (color-coded), and action icons **Review** (→ detail), **Approve**, **Reject**. Empty state ("All assessments have been reviewed"); error/loading states.

**Primary actions & flows.** Quick **Approve** / **Reject** open a right panel (ActionModal) with a comments box (comments required for reject). Or open the full review.

**Notable features.** Surfaces an AI quality score alongside the human score; tiered approval indicator.

### Approval review detail — `/erm/rcsa/approvals/[id]`

**Purpose.** Read the full submission and render a decision within the tiered workflow.

**What it shows.** Header: campaign name, business unit, assessor, submitted timestamp; decision buttons **Delegate**, **Return**, **Reject**, **Approve**. **4 stat cards:** Approval Tier (current/total), Assessment Score % (color-coded), **AI Quality Score %** (Sparkles), Questions Answered (X/N). **Approval History** timeline: each entry with action-colored icon (approved/rejected/returned/other), actor + timestamp, and italic comment. **Assessment Responses** grouped by collapsible section; each question shows its answer rendered per type — risk rating shows Likelihood × Impact with a computed **score badge** (color by ≥15/≥8), control rating shows the effectiveness label, yes/no shows colored Yes/No, text shows the prose.

**Primary actions & flows.** One shared ActionModal handles all four decisions: **Approve** (optional comment), **Reject** (comment required), **Return for changes** (comment required, sends back to assessor), **Delegate** (target user ID + optional comment). On success it returns to the approvals queue.

**Notable features.** Four-way review workflow (not just approve/reject) including delegation and return; response-level risk scoring shown to the reviewer; full audit history of prior approval actions.

---

**Cross-cutting patterns for the redesign to note:** consistent right-slide panels (`RightSlidePanel`) for all create/edit/decide flows; `MultiSelectDropdown` used as single-select filters throughout; soft-tone status/severity pills with a shared color language (emerald=good/approved, amber=in-progress/warning, rose=critical/rejected, primary/teal=active/closed); progress expressed as thin bars + %; Recharts for the dashboard's radar and bar charts (other visualizations are hand-built div bars); AI assistance appears in three distinct places (per-question suggestions, per-finding recommendation, per-custom-row explanation); and evidence handling spans per-question uploads, in-place preview, and a tenant-wide Evidence Library link picker.

---

# Vendor / Third-Party Risk (TPRA)

## Module: Vendor Risk (Third-Party Risk Management / TPRA)

**Purpose.** A complete third-party risk management workspace where a TPRM analyst onboards vendors, drives each vendor through an 11-stage assessment lifecycle, tracks findings to closure, monitors outside-in risk signals, and reports portfolio posture to leadership.

**Information architecture (module-level tabs).** A horizontal tab bar (WAI-ARIA tabs, keyboard-navigable, horizontally scrollable on mobile) spans every screen below, plus a demoted Settings gear pinned to the far right:
`Dashboard · Vendors · Assessments · Findings · Monitoring · Questionnaires · Risk 360° · Exchange` … `⚙ Settings`

The conceptual spine is the **11-stage TPRA lifecycle** (grouped into 3 phases): Onboarding diligence (01 Intake, 02 Tiering ⛨gate, 03 DD Planning, 04 Questionnaire & Evidence), Decision & contracting (05 Scoring, 06 Findings, 07 Contracting, 08 Approval ⛨gate), In-life management (09 Onboarding, 10 Monitoring, 11 Reassessment & Offboarding). Most top-level tabs are cross-portfolio "roll-up" views of data that is authored inside a single vendor's lifecycle. Stages 02 (Tiering) and 08 (Approval) are hard **gates** with exit criteria that block advancement. A stage rail visualizes progress as an 11-dot progress rail throughout the module.

---

### Program Dashboard — `/vendor-risk`
**Purpose.** Give a TPRM lead a 30-second read on whether the third-party portfolio is within risk appetite, and a jump-off to the most urgent work.

**IA.** Landing screen. Header carries a scope toggle — **Portfolio** vs **My queue** — and an "Add vendor" CTA. Everything below re-queries on scope change. Empty state (zero active vendors) replaces the whole page with an "No vendors yet → Add vendor" prompt.

**What it shows (data).**
- **Portfolio Verdict banner** (hero): a colored posture band — green "Within appetite" / amber "Approaching appetite" / red "Over appetite" / neutral "Appetite not set" — driven by portfolio residual vs the appetite line. Shows residual-vs-appetite headline, "points over the line / of headroom," points of risk removed by controls, plus three at-a-glance stats: tier mix, reviews (overdue / due ≤30d), top-2 highest-residual vendors.
- **KPI stat tiles (5):** Active vendors (+onboarded in 30d), Critical coverage % (critical vendors assessed, colored by ≥90%), Portfolio residual (with sparkline + "removed vs inherent"), Open critical findings (past-SLA count + closure rate %), Reviews due ≤30d (overdue + new signals count).
- **Charts row 1:** Vendor risk-tier **donut** (Critical/High/Medium/Low counts) with legend; **Inherent vs residual by tier grouped bar** (the gap = risk removed by controls); **Portfolio residual half-gauge** (radial, 0–100, big number center).
- **Portfolio risk trend** (composed area+line over 12 months): residual area vs inherent dashed line, with an orange dashed **appetite reference line**. Empty state: "No snapshot history yet."
- **Charts row 2:** Findings posture **donut** (Open/In-progress/Accepted/Remediated) + severity chip breakdown; Open findings **horizontal bar by risk domain** (top 8).
- **Live monitoring feed** (list, latest 8): severity dot, signal title, vendor · type · date, "new" badge; row click → vendor profile; footer link to Monitoring.
- **Highest-residual vendors** (ranked list): letter grade, name, residual progress bar, tier badge, score; row → vendor profile.

**Primary actions.** Toggle scope; add vendor (→ Vendors); drill into any vendor, signal, or the Monitoring tab. Loading = centered "Loading program dashboard…"; error = retry.

---

### Vendors (inventory) — `/vendor-risk/vendors`
**Purpose.** Manage the third-party inventory and intake new vendors into the lifecycle.

**IA.** List screen with search + Tier + Status filters (dropdowns), single "Add Vendor" primary CTA (permission-gated).

**What it shows (data).** A **table**: Name (link), Tier badge, Status badge, Risk Rating (badge or inherent score), **Lifecycle** (11-dot stage-progress rail + "NN · StageName"), Data Access, Contract End, Owner, Actions (view / delete). Empty state: "No vendors found." Loading = "Loading vendors…".

**Primary actions & flows.**
- **Add Vendor** opens a right-slide panel titled "Add Vendor · Intake & Scoping" (framed as Stage 01). Sectioned form: **Business context** (name*, description, type, industry, website, business owner), **Data & scope** (tier, draft data classification, data types, systems/services), **Contacts** (name/email/phone), **Commercials** (contract start/end, annual spend). A checkbox "**Start the TPRA lifecycle now**" (default on) initializes the 11-stage assessment on save. Handles 409 duplicate-vendor with a confirm-and-override.
- **Delete** opens an accessible confirm modal warning that related assessments, questionnaire responses, SLA records and incidents are removed.

---

### Vendor Profile & TPRA Lifecycle — `/vendor-risk/vendors/[id]`
**Purpose.** The single vendor's command center — run its 11-stage assessment lifecycle end-to-end and view its record, assessments, SLAs and incidents.

**IA.** Header (name, tier + status badges, risk/inherent/residual inline, Edit button). Sub-tabs: **Lifecycle** (default), **Overview**, **Assessments** (count), **SLA Tracking** (count), **Incidents** (count). Deep-linkable via `?stage=<key>&finding=<id>` which lands on Lifecycle, selects the stage, and opens a finding.

**Overview tab.** Two cards — Contact Information (contact, email, phone, website) and Contract & Details (start, end, value, data access, owner, type, industry) — plus Description, Services Provided chips, and Notes. Edit opens a right-slide form (name, description, tier, status, contact, owner, notes).

**Assessments tab.** Table of this vendor's assessments (Type, Status badge, Risk Score, Rating, Assessor, Due Date, "View Linked Questions"); row → assessment detail. "New Assessment" slide-panel (assessment type, due date, assign assessor).

**SLA Tracking tab.** Table: Metric, Target, Actual, Compliant (Met/Missed), Period, Recorded. Empty: "No SLA records."

**Incidents tab.** Table: Title, Severity badge, Status badge, Occurred, Resolved. "Record Incident" slide-panel (title*, severity, occurred-at, description).

#### Lifecycle tab — the 11-stage TPRA centerpiece
- **Summary bar:** a **progress ring** (% of 11 stages complete/skipped), assessment version pill (vNN), inherent-tier and residual-rating badges, current-stage label with a "gate" lock marker, plus **New reassessment** and **Activity** buttons.
- **Stage rail:** stages grouped under the three phase headers as chips; each chip shows stage number, label, and a status glyph (complete = check, skipped = skip-forward, gate = lock, in-progress = colored dot). Click selects a stage.
- **Active-stage workspace (StageWorkspace):** a compact command-center header — stage number, gate badge, status, **exit-met / exit-not-met** indicator, stage title, **Accountable owner** (resolved from the team roster), one-line objective, and the first blocker if the gate isn't passed. Actions: **Details**, **Skip** (tier-conditional), **Send back here**, **Advance** (disabled until exit criteria met). Below, **capability tiles** open right-slide drawers: **Checklist** (done/total), **Assign duties** (RACI team roster), **Evidence** (count), **Artifacts** (count), **Risk register** (residual/inherent badge).
  - *Details drawer:* full stage definition — objective, inputs, key activities, RACI (Responsible/Accountable/Consulted/Informed resolved to real people from the roster), artifacts produced, risk domains in play, and the exit-criteria gate (with live blockers).
  - *Assign duties drawer (Team Roster):* assign 9 canonical roles **once** for the whole assessment (Business Owner, TPRM Lead, TPRM Analyst, Security, Privacy, Legal, Procurement, Executive/Risk Committee, IT/Ops) — each carries across all stages.
  - *Evidence drawer:* upload a file or link from the central evidence library; attached list with type/status and unlink.
  - *Artifacts drawer (Artifact Documents):* per-vendor document store. Create-from-template chips (the stage's expected artifacts) or blank; markdown editor with edit/preview and "load from file"; preview, edit, **download (docx/pdf/md)**, "**Use as evidence**" (renders to PDF and links into the evidence pack), delete; status pills (draft/in-review/approved/archived).
  - *Risk register drawer:* inherent vs residual posture tiles; note that residual is mirrored into the ERM Risk Register on scoring; per-finding "**To register**" promote buttons.
- **Per-stage primary surfaces (rendered inline in the workspace):**
  - **01 Intake** (`IntakePanel`): editable vendor-scope form with a live gate helper — setting a **business owner** + a **data access level** above "None" satisfies the exit gate. Fields: owner, data access level, data types, systems/services, geographic locations, contract value, type/industry/website, contact, description.
  - **02 Tiering** (gate): "Compute tier" button runs the inherent-risk engine → tier + score; sets assessment depth & cadence.
  - **03 DD Planning** (`PlanningPanel`): assessment plan (questionnaire template, assigned reviewer, target date) with template-selected / reviewer-assigned gate chips; "**Send questionnaire**" issues the portal link to the vendor; plus an evidence-request list.
  - **04 Questionnaire & Evidence** (`QuestionnaireReviewPanel`): the vendor fills it in via the sent link; analyst **reviews** here. Per-issued-response card: status pill, answer count, respondent, sent/submitted dates, copy-link / open-portal, "Waiting on vendor" vs "Ready to review" banner, expandable answers, and analyst-attached-evidence fallback for offline vendors.
  - **05 Scoring**: "Run scoring" button scores responses into per-domain residual ratings (failed critical controls auto-raise blocking findings), followed by the **Domain Risk view** — per-domain residual bars across the ten domains with a coverage badge (scored/total) and an "only N of 10 scored" caveat; unscored domains hatched as "Not assessed."
  - **06 Findings** (`FindingsPanel`): filter by status/severity, show-removed toggle, "Add finding." Each finding card: severity + critical-control + domain + status badges, links to ERM Risk Register / shared Issue; inline status select; delete/restore; expand for **remediation tasks** (treatment type, due date, status), **risk acceptances** (rationale + expiry, revoke), and finding-scoped evidence. "**To register**" promotes a finding into the ERM register (routes to the risk edit).
  - **07 Contracting** (`ContractsPanel`): contracts (type = master/DPA/SLA/security addendum, status, renewal & expiry dates); expand for **control obligations** (obligation text, control ref, renewal, status). Create panels for both.
  - **08 Approval** (gate, `ApprovalPanel`): advisory engine **recommendation** banner (approve / approve-with-conditions / remediate-first / escalate-or-reject); "Record decision" form (decision, conditions one-per-line, rationale); append-only **decision history** with per-condition open/overdue/closed chips and Resolve.
  - **09 Onboarding**: guidance panel — provision least-privilege access, stand up monitoring (work the checklist tile).
  - **10 Monitoring** (`SignalsPanel`): record monitoring signals (type = security_rating/breach/adverse_media/financial/sla/cert_expiry, severity, title, detail, source). A **breach or any high/critical signal auto-opens a versioned reassessment** (surfaced via toast + "reassessment" badge). Acknowledge / delete rows.
  - **11 Reassessment & Offboarding** (`SignalsPanel` + `OffboardingPanel`): schedule next reassessment (cadence days + next date); **offboarding exit checklist** (add/toggle items, done count) — revoke access, confirm data return/destruction; data-destruction attestation via evidence panel.
- **Cross-cutting flows:** Advance / Send-back / Skip each open a **reason modal** (required rationale); send-back invalidates downstream stages but keeps history. **New reassessment** opens a fresh assessment version (reason recorded). **Activity** drawer shows the per-vendor tamper-evident audit timeline (action, entity, →value, reason, actor, timestamp).

---

### Assessments (lifecycle board) — `/vendor-risk/assessments`
**Purpose.** The analyst's in-flight work queue — one row per vendor showing where its active assessment sits in the lifecycle.

**IA.** Header with links to Vendors & Questionnaires and a "New Assessment" CTA. Filters: search, Tier, Stage (all 11), and an "**In lifecycle only**" toggle (default on — hides not-yet-started vendors).

**What it shows (data).** **Stat tiles (4):** In lifecycle, Awaiting onboarding, Open findings, High/Critical residual. **Table:** Vendor (+ vNN), Tier badge, **Lifecycle** (11-dot rail + "NN · Stage" or "Not started"), Residual badge, Findings (count + "N crit" pill), Next review date, Actions (Open → vendor lifecycle, or **Assess** to start it). Row click → vendor lifecycle. Empty states differentiate "no vendors" vs "no match."

**Primary actions.** "New Assessment" slide-panel: pick a vendor → creates its 11-stage TPRA lifecycle (intake begins immediately; tiering gate sets depth/cadence), then routes to that vendor. Inline "Assess" starts a lifecycle from a row.

---

### Assessment Detail — `/vendor-risk/assessments/[id]`
**Purpose.** Work a single assessment record: review questionnaire answers, score it, and approve.

**IA.** Header (type, status + rating badges, vendor link, template, ID). A **5-step status flow stepper** (Draft → In Progress → Submitted → Reviewed → Approved). Three tabs: **Overview**, **Questionnaire Responses**, **Scoring & Approval** (deep-linkable via `?tab=`).

**What it shows (data).**
- **Overview:** 4 info tiles (Inherent Score, Residual Score, Risk Rating, Status); **Gap analysis & residual risk** card with a "**Run AI gap analysis**" action (per-gap detail: gap, severity, control ref, residual-after-controls; heuristic fallback when no AI key) + linked-risk shortcut; Assessment Details (type, assessor, reviewer, due/created/completed + status-change dropdown); Linked Records (vendor, template, response count); editable **Findings** and **Recommendations** lists (add/remove/save).
- **Questionnaire Responses:** per response — header (respondent name/email, status, submitted date), progress summary (answered/total, evidence provided/required, progress bar), and questions grouped by category with typed answer rendering (yes/no pill, 1–5 **star rating**, multiple-choice chip, text) and evidence file rows with **preview**. Empty state can still show the linked template's questions.
- **Scoring & Approval:** three big score tiles (Inherent / Residual / Rating); "**Calculate Risk Score**" (weighted from submitted responses) with a success banner; "**Approve Assessment**" (optional rating override) — approving finalizes and pushes scores to the vendor.

---

### Findings & Remediation — `/vendor-risk/findings`
**Purpose.** A cross-portfolio risk register of every gap across all vendors, tracked to closure against SLA.

**IA.** Filter bar (Status, Severity, Domain selects + "Overdue only" toggle + total count). Server-paginated (25/page).

**What it shows (data).** **Table:** Severity badge, Finding title (+ "critical control" tag), Vendor, Domain, Status pill, **SLA due** (red "· overdue" when late). Row click → the vendor's lifecycle Findings stage with the finding deep-linked open (`?stage=findings&finding=<id>`). Empty state (green check) "No findings match these filters." Loading / error-retry states; pagination with page-of-pages.

**Primary actions.** Filter/paginate; drill into a finding at its source vendor (edited there, not here).

---

### Monitoring Signals — `/vendor-risk/monitoring`
**Purpose.** A portfolio feed of outside-in risk signals across all vendors, to triage and trigger reassessments.

**IA.** Filter bar: Severity, Type (security_rating/breach/adverse_media/financial/sla/cert_expiry), State (New/Acknowledged), "Triggered reassessment" toggle, **Sort** segmented control (Severity ↔ Recent), total count. Server-paginated (25/page). Note that signals are manually logged today with a hint to connect BitSight/SecurityScorecard/UpGuard.

**What it shows (data).** A **feed list** (not a table): severity dot, signal title (→ vendor), severity + type chips, "reassessment" badge, vendor · date · source, detail line, and a **new / acknowledged** state chip. Empty states differ for the reassessment filter.

**Primary actions.** **Acknowledge** a signal inline (permission-gated); open the vendor lifecycle to triage. Toasts on acknowledge.

---

### Questionnaires — `/vendor-risk/questionnaires`
**Purpose.** Build reusable questionnaire templates and issue private response links to vendors, then review submissions.

**IA.** Header links (Vendors, Assessments) + "Create Template." Search over templates. Two zones: **template cards grid** and a **Sent Questionnaires** tracking table.

**What it shows (data).**
- **Template cards:** category icon + name + category chip, description, stats (question count, "N evidence required"), first-3-question preview, and a "**Generate vendor link**" button. Preview (eye) and delete (permission-gated).
- **Sent Questionnaires table:** ID, Vendor (link), Template, Assessment (link), Status pill (pending/in-progress/submitted/expired), Questions (answered/total), Submitted timestamp, Actions (view Q&A / copy link / open link).

**Primary actions & flows.**
- **Create Template** (right-slide): name, category, description, and a **question builder** — add questions with type (text / yes-no / multiple-choice / rating), weight (1–5), required and **evidence-required** toggles, and per-question options for multiple choice. "**Load [Category] Defaults**" seeds curated Security/Privacy/Compliance/Operational/Financial question sets.
- **Generate vendor link** (right-slide): pick vendor (auto-fills respondent from primary contact), optionally link to an assessment, respondent name/email → **mints a private token link** (no email auto-sent) shown with copy button and expiry note.
- **Response detail** (right-slide): vendor, respondent, status, submitted; each question with its typed answer.
- **Notable:** the token links out to a **public vendor response portal** (`/vendor-risk/questionnaires/[token]`).

---

### Risk 360° — `/vendor-risk/risk-360`
**Purpose.** Connect TPRM to the enterprise Risk Register and show the ten-domain risk taxonomy with live findings concentration.

**IA.** Three stacked sections; no tabs.

**What it shows (data).**
- **Third-party risks in the Risk Register** (table): Risk title (expandable), Vendor (→ profile), Tier, Inherent, Residual (colored), Status, Updated, "Register →" link. Summary counts (Total / Open / Avg residual) + link to ERM Risk Register. Expanding a row reveals a **residual-by-domain breakdown** (ten domains, colored mini-bars + "% covered," "Not assessed" for unscored). Empty: "No third-party risks in the register yet."
- **Risk domains** (card grid, 10): each domain's color swatch, name, "N open" pill, purpose text, an open-findings concentration bar (relative to max), and expected-evidence chips (e.g. SOC 2, DPA, BC/DR).
- **Compliance framework coverage** (table, when present): Framework, Questions, Controls, Evidence-required, Domains — derived from the question→control mapping; summary of frameworks / mapped questions / templates.

**Primary actions.** Expand domain breakdowns; jump to a vendor or to the ERM register.

---

### Vendor Exchange — `/vendor-risk/exchange`
**Purpose.** "Complete once, reuse across buyers" — publish a completed assessment as a reusable snapshot, or import one to pre-fill an assessment.

**IA.** Two action cards (permission-gated) over a directory table.

**What it shows (data).**
- **Publish card:** select a vendor with an active assessment → snapshots its answers/evidence/validation into a shared record.
- **Import card:** target vendor + **share token** (intra-tenant) or a pasted **portable package JSON** (cross-tenant) → pre-fills the target's active assessment; note that the buyer re-scores with their own engine.
- **Published shared assessments table:** Vendor, Template, **Rating** badge (or "unscored"), Answers count, Evidence count, Validated date, Status (active/…), Actions — **copy share token**, **download portable package** (JSON file), **revoke**. Empty: "Nothing published yet."

**Primary actions.** Publish, import/pre-fill, copy token, export package, revoke — all toast-confirmed.

---

### TPRM Settings — `/vendor-risk/settings`
**Purpose.** Per-tenant configuration that the tiering & scoring engines actually read.

**IA.** Single scrollable config page (max-width), Save + "Reset to defaults" in the header; read-only banner when the user lacks `config:edit`.

**What it shows (data).** Three sections:
- **Inherent-risk factor weights:** one numeric % input per factor (labels from the backend), with a live **"Total N%"** badge (normalized to 100% on save).
- **Tier thresholds:** 0–100 threshold per tier with a validation guard requiring **Critical ≥ High ≥ Medium** (Save disabled + inline warning otherwise); "Low = below Medium."
- **Reassessment cadence:** days-per-tier inputs.

**Primary actions.** Edit values → Save (validates thresholds); Reset to defaults (rehydrates from server defaults). Note that questionnaire templates and integrations are managed elsewhere.

---

**Cross-module patterns for the redesign.** Right-slide panels (`RightSlidePanel`) are the standard create/edit/detail surface everywhere; tier/severity use a consistent soft-tone ramp (critical rose → high orange → medium amber → low emerald); the 11-dot stage rail + phase grouping is the recurring lifecycle motif; tables use hover-row → drill-down navigation; toasts confirm all mutations; permission gating (`vendor_risk:*` / `erm:risks:edit`) hides create/edit/delete affordances and can render read-only banners; loading uses a labeled `PageLoader`, errors offer retry, and empty states are first-class throughout.

---

# Governance & Documents

This brief documents every screen in the Governance module (`/governance/*`) plus the legacy top-level Document Library (`/documents`) of the GRC platform. It is written for a product designer: it describes what each screen is *for*, its information architecture, the concrete data it shows, and the flows a user runs.

## Module-level information architecture

Governance is a large, multi-area module. Its own in-page top nav (`layout.tsx`) is deliberately thin — only two tabs render on the shared Governance bar: **Documents** and **Policy Exceptions**. Everything else (Overview, Committees, Approvals, Workflows, Regulatory Changes, Regulatory Feeds, Attestations, Reviews, Mappings) is reached from the app's left sidebar ("Governance Oversight") and via deep cross-links between screens. There is **no standalone "gap-analysis" route** — gap analysis lives as a *tab inside a document's detail page* and again as a *tab inside a regulatory-change detail page*.

A recurring visual system runs across the module: a "score kit" (a `ScoreRing` performance dial + weighted "section" cards + formula breakdown modals), light single-hue status pills, `RightSlidePanel` slide-over drawers for create/edit forms, `MultiSelectDropdown` filter chips, `DataTable` registers with bulk-action bars, and Recharts area/pie/bar charts. AI assist ("Sparkles"/"Wand2" affordances) appears throughout — drafting, summarizing, gap analysis, charter generation, exception suggestions, feed analysis. The design language is being pushed toward a single teal "primary" brand with category tints (rose/amber/violet) used only as incidental attention markers.

---

## Governance Overview

**Purpose & IA.** The module landing scorecard — a real-time read on overall policy/framework/review/oversight health, with drill-downs into every sub-area. It is the hub that links out to Documents, Approvals, Reviews, Exceptions, Attestations, Committees, and even ERM KRIs.

### Governance Overview — `/governance`
- **Purpose.** Give an executive a one-glance posture on governance health and a prioritized "what needs attention" queue.
- **What it shows (data).**
  - **4 KPI stat tiles:** *Performance* (a `ScoreRing` dial with a letter-grade pill + "N weighted sections", clickable → breakdown modal); *Needs Attention* (amber count + top-3 attention items as links); *Documents* (total count, published count, "% live" progress bar); *Coverage* (% of documents mapped to controls/frameworks, progress bar).
  - **Module Sections grid** — one `SectionGraphCard` per governance area (documents, mappings, approvals, reviews, exceptions, attestations, committees, KRIs, KPI, projects), each scored by its own formulas with metric weight/target/formula tooltips.
  - **Governance Posture Radar** — a Recharts radar plotting each section's *current score vs. target* (two overlaid polygons), plus a per-metric list with % bars and "numerator/denominator · weight · target" captions.
  - **Content Throughput** — an area chart of *Created vs. Published* documents over the last 6 months, with three mini stat tiles (Created / Published / Live rate %).
  - **Attention queue items** (each a link): documents awaiting approval, overdue reviews, documents expiring in 30 days, exceptions pending/expiring, open gap findings, overdue attestations, overdue committee actions, breached (red) KRIs.
- **Primary actions & flows.** Click the Performance tile → **Performance Score modal** (weighted component breakdown with per-row weight/points bars and the literal weighted-sum formula; includes an "Adjust weights" **SectionWeightTuner** to re-tune section weights). Header quick-links to Attestations, Statements, and "Manage Documents". Every attention item deep-links to its screen.
- **Notable.** Fully backend-computed scoring (scores, weights, targets, formulas all server-side); loading state is a skeleton grid of stat cards.

---

## Documents

**Purpose & IA.** The heart of governance — a full document lifecycle workspace for policies, standards, procedures, guidelines, charters, and frameworks. The list screen (`/governance/documents`) is a three-mode **workspace** (Tree / Table / Board) with a left library tree and a right "Needs attention" rail. Each document opens a detail page (`/governance/documents/[id]`) with seven tabs. Creation flows (upload, AI draft, templates) are slide-over/modal wizards hosted on the list screen.

### Documents Workspace — `/governance/documents`
- **Purpose.** Find, triage, and act on the whole document register from one adaptive surface.
- **What it shows (data).**
  - **Toolbar (always one row):** search (title/code/owner/control), Type / Status / Owner filter dropdowns, a **view switcher** (Tree · Table · Board), and — when permitted — **Templates**, **AI Draft**, and **New Document** buttons.
  - **Left LibraryTree** (Tree view only): a "Library" quick-filter section (All documents · Recently updated · My documents, each with counts) and a "By Hierarchy" recursive, expandable tree of the policy hierarchy (doc-type tiles, child counts).
  - **Center — three interchangeable views:**
    - *Tree (WorkspaceList):* a breadcrumb + list of the scoped documents sorted by review date (overdue first).
    - *Table (RegisterTable):* a dense `DataTable` — columns **Title · Type (pill) · Lifecycle (status dots) · Owner (chip) · Frameworks (up to 3 pills) · Ver · Actions (⋯ menu)**; header shows "N shown · M total · updated Xm ago"; selectable rows with a dark bulk-action bar; CSV export.
    - *Board (LifecycleBoard):* a Kanban of five lifecycle columns (draft → in-review/pending → approved → published) with cards showing type pill, code+version, title, framework pills, owner avatar, and review-status; terminal (expired/archived) docs omitted; no drag-and-drop.
  - **Right AttentionRail** (Tree view only): "N reviews overdue" card (top 4 + days overdue), "N pending your approval" card (title, stage, Approve/Review buttons), "N attestation gaps" card (docs with coverage <90%, colored %), an "All clear" state, and a **Quick start** card (Draft with AI / Browse NCA-ISO templates).
- **Primary actions & flows.**
  - **Row/bulk actions:** open, edit (opens the pre-filled Document drawer), download (exports uploaded file or a PDF of the content), delete; **bulk** approve, publish, assign owner (slide-over user picker), set review date (slide-over date picker), archive.
  - **Create flows (slide-overs/modals):**
    - **New Document (upload):** drag-and-drop PDF/Word/Excel (≤50MB), title, description, doc type, classification, optional linked frameworks — backend auto-parses on create.
    - **AI Draft Document:** an async drafting job with live stage telemetry ("Drafting section 4 of 13"), routed to a generic, NCA-template, or reference-law endpoint; returns generated content + suggested title/sections + framework alignment + word count + est. review time, then flows into the create form.
    - **Templates (Recommended Docs modal):** browse pre-curated bank-grade Standard templates, Artifact templates, NCA templates, and reference laws; picking one opens the create form pre-filled with ready-to-edit WYSIWYG content (or seeds the AI Draft for law-grounded generation).
    - **Request Attestation / View / Parse policy** modals also hosted here.
- **Notable.** WYSIWYG `RichTextEditor`; async AI-draft job polling; "+ Draft" deep-links arriving from a referenced document auto-open a pre-filled AI Draft; extensive query-cache invalidation to keep register + tree in sync.

### Document Detail — `/governance/documents/[id]`
- **Purpose.** The single-document control center — read it, extract its clauses, map it, gap-assess it, route it for sign-off, discuss it, and audit its history.
- **IA.** Header (title, code, status pill, type pill) with lifecycle action buttons that change by status (**Submit for Review** on draft → **Open Approvals** on pending → **Publish** on approved), plus **Download** and **Edit Details** (inline edit form: title, classification, description, doc type). Seven tabs:
  1. **Document Viewer** — renders the document (uploaded file HTML or AI/markdown content) with reference-aware markdown; inline "+ Draft" buttons appear on referenced standards/policies to spin up a linked draft.
  2. **Statements** — parsed policy statements list; a **Parse Policy** action (background job with polling) extracts compliance statements; a "review required" state surfaces re-parse proposals.
  3. **Mappings** — embeds the Policy-Control Mappings surface scoped to this one document (framework clause coverage + linked internal controls; see Mappings screen).
  4. **Gap Analysis** — the compliance-gap engine (below).
  5. **Sign-off & Control** — production approval routing (below).
  6. **Discussion** — a `DocumentAnnotationPanel` for threaded document discussion/annotation.
  7. **Review History** — version history / review audit trail.
- **Gap Analysis tab data & flow.** A **Compare with Other Document** panel (AI side-by-side compare vs. another platform doc or reference template). A **Run Gap Analysis** panel (choose frameworks or "run all"; live per-framework progress cards showing "N/M clauses" and %). A **Compliance Summary** section. A **Gap Findings & Remediation Tracker** table with filters (Framework / Compliance status / Risk severity / Remediation status) and sortable columns: **Framework Clause · Policy Ref · Compliance (fully/partially/not-addressed/N-A) · Gap Description · Risk (critical/high/medium/low) · Recommendation · Owner · Target Date · Status (open/in-progress/closed/accepted-risk) · Evidence · Updated**; rows expand and support inline edit, **override** (with justification), **accept risk** (justification + expiry), and a two-step **Apply Fix** (AI generates a clause draft → user edits → appends/replaces into the document as a new version, gap stays "in progress" until reviewer+approver sign off). CSV export of findings. Polling keeps summary/findings live while runs are in flight.
- **Sign-off tab.** Assign **Prepared-by / Reviewers / Approvers** by user, role, or team (multi-select combining all three); send for review; each assignee's signature is routed to their Pending Approvals; status advances automatically.
- **Notable.** Heavy AI assist (draft, gap analysis, apply-fix, compare); scroll-position restoration when round-tripping to draft a referenced standard; NCA compare modal.

---

## Policy Exceptions

### Policy Exceptions — `/governance/exceptions`
- **Purpose.** Request, review, approve/reject/revoke, and risk-weight formal exceptions to policies.
- **IA.** Standalone screen (second tab on the Governance bar). Register + analytics + an AI discovery panel + slide-over drawers for create/view.
- **What it shows (data).**
  - **3 summary cards:** *Status Distribution* (Recharts donut + legend counts by status), *Open Exception Aging* (bar chart across 0–30 / 31–60 / 61–90 / 90+ / Overdue buckets), *Closure Timeliness* (big "% closed on time" figure + Open/Overdue/Resolved counts). Backed by an analytics endpoint (avg posture, aging buckets, by-status/by-priority).
  - **Exception Register** (`DataTable`, CSV export): **Title · Policy · Status (draft/pending/approved/rejected/expired/revoked pill) · Priority (low→critical pill) · Requested by (avatar chip) · Requested date · Expiry · ⋯ actions**.
  - **View drawer:** policy, requester, effective/expiry/created dates, approver, Justification, Potential Risks, Compensating Controls, rejection/approval notes, and a **Comments** thread.
- **Primary actions & flows.**
  - **New/Edit Exception drawer:** title, policy (policies only), justification, potential risks, compensating controls, **linked assets** (their CIA + criticality weight the risk posture), priority, effective/expiry dates; an **AI Assist** button auto-fills justification/risk/controls from the selected policy.
  - **Lifecycle actions** (row ⋯ menu, gated by status): submit for approval, approve (comments modal), reject (required reason modal), revoke (reason modal), delete.
  - **Move to Risk Register:** promotes an exception's potential risks into an ERM risk (carrying linked assets), then routes to `/erm/risks/[id]`.
- **Notable — "Find & generate exceptions" panel.** (1) Full-text **search across policy content and parsed clauses** with per-result "+ Exception" that pre-fills the create drawer; (2) **AI-suggested candidate exceptions** — pick a specific policy or scan "all policies"; each suggestion has a rationale + suggested priority + "Use" to pre-fill. Auto-growing textareas so AI-generated fields are fully visible.

---

## Committees (Board & Committee Management)

**Purpose & IA.** Manage boards/committees, their members, charters, meetings, and oversight actions. A master–detail dashboard (`/committees`) links to a per-committee detail (`/committees/[id]`, tabbed), an org-wide actions tracker (`/committees/actions`), and a per-meeting workspace (`/committees/meetings/[id]`).

### Committees Dashboard — `/governance/committees`
- **Purpose.** See where every committee stands right now at a glance.
- **What it shows (data).**
  - **KPI strip (6 tiles):** *Performance* ScoreRing + grade (→ breakdown modal); *Committees* (active/total + active charters); *Meetings* (upcoming + this quarter); *Actions Done* (% + completed/total bar); *Overdue* (count + still-open); *Attendance* (avg % bar + "quorum met in X/Y").
  - **Master list of committee tiles:** RAG health dot, name, type badge (Board/Risk/Audit/Compliance/IT Steering), member count, next meeting (with relative "in Nd / Nd overdue"), and action chips (overdue / open / done).
  - **Sticky Context Panel** (right): for the selected committee — its upcoming meetings + action items; when none selected — org-wide upcoming meetings + "Needs attention (overdue)" actions.
  - **Progress over time** area chart (Meetings held vs. Actions completed, last 6 months) and **Top performers** list (ranked by action completion %, with on-time counts).
- **Primary actions & flows.** **New Committee** slide-over (name, description, type, chair, secretary, meeting frequency). **New Meeting** slide-over — a one-screen guided flow: committee, title, date/time, type, location, quorum, virtual link, plus **inline agenda items** (add-and-Enter), with best-effort agenda persistence and retry-without-duplicate handling. Select a tile → context panel; open committee/meeting via links.
- **Notable.** Same performance-score system as the Governance overview; empty-module state with a "Create first committee" CTA.

### Committee Detail — `/governance/committees/[id]`
- **Purpose.** Run a single committee — its people, charters, meetings, and actions.
- **IA.** Header (name, type badge, description, Edit Committee) + a one-line snapshot (members · meetings · open actions · charters · chair · secretary · frequency). Four tabs: **Members · Charters · Meetings · Actions**.
- **What it shows / flows.**
  - **Members:** table (Name · Email · Role · Joined · remove), Add Member slide-over.
  - **Charters:** cards per charter (title, status pill, version, effective date, approver/creator; file attachment; structured collapsible sections when parsed). Actions: **Upload Charter** (PDF/DOCX/TXT → extracted), **AI Generate Charter** (framework-selection modal → AI drafts titled sections with framework references + summary; save as draft / copy), **Compare with AI** (scores an existing charter vs. frameworks → covered/partial/missing/exceeds sections, gaps by severity, strengths, recommendations, framework coverage buckets), edit, download (file or generated `.docx`), delete.
  - **Meetings:** master–detail — meeting list + inline selected-meeting detail (agenda + minutes); Schedule Meeting slide-over.
  - **Actions:** committee-scoped action list; create manual action.
- **Notable.** AI charter generation and gap comparison; docx generation from stored content.

### Oversight Actions — `/governance/committees/actions`
- **Purpose.** Track and manage action items across *all* committees in one place.
- **What it shows (data).** 4 KPI cards (Open / In Progress / Overdue / Completed). Filters: search, Status, Committee, "Overdue Only" checkbox. A list of action cards: title, status pill (with icon), action-type pill, description, committee, due date, assignee, source meeting; an inline **status dropdown** to advance each action.
- **Primary actions & flows.** **Add Manual Action** slide-over: committee (required), optional linked meeting (loaded per committee), title, action type (18 types: follow-up, policy approval, risk review, audit response, corrective/preventive, investigation, escalation, decision record, etc.), due date, description; an **AI Assistant** block to upload a reference file and **AI Reword** or **Generate Summary** for the description.
- **Notable.** Falls back to demo data if the API is unavailable.

### Meeting Detail — `/governance/committees/meetings/[id]`
- **Purpose.** Run a specific meeting — agenda, minutes, actions, and attachments.
- **What it shows (data).** Meeting metadata (type, scheduled date, location, virtual link, status, quorum required/present). **Agenda items** (number, title, description, presenter, time-allocated, type, status, outcome/decision, and links to a document / risk / regulatory change). **AI-suggested agenda items** (sourced from documents/risks/reg-changes). **Actions** raised from the meeting. **Minutes** (content, status, drafter, drafted-at) with AI-draft support. **Attachments**.
- **Notable.** AI agenda suggestions and minutes drafting; agenda items can be linked to governance documents, ERM risks, and regulatory changes.

---

## Approvals & Workflows

### My Approvals — `/governance/approvals`
- **Purpose.** A personal queue of governance actions and documents awaiting *this user's* approval/signature.
- **What it shows (data).** Header with a "N Pending" pill. A highlighted **"Documents awaiting your signature"** card (title, doc type · stage, "Review & sign →" deep-link to the doc's sign-off tab). Search + Status filter (pending/approved/rejected/all). A table: **Action (title + code) · Type · Submitted By · Date (recent flag) · Status pill · row actions** (view, delegate [disabled], reject, approve, open).
- **Primary actions & flows.** Row click → **Document Preview drawer** (action type, submitted by/at, status, description) with Approve/Reject/Delegate. **Approve/Reject modal** (comments; reason required to reject). **Delegate modal** (forward to another user ID + reason) — currently disabled for action reviews.

### Approval Workflows — `/governance/workflows`
- **Purpose.** Process pending document approvals *and* design the reusable approval workflow templates that drive them.
- **IA.** Two top tabs: **Approvals** and **Workflow Templates**.
- **What it shows (data).**
  - *Approvals tab:* 4 KPI cards (Pending my approval / Approved today / Rejected today / Overdue). Sub-tabs (Pending / Approved / Rejected / All) with a pending count badge. An **Overdue Approvals** group (red-bordered cards) above regular pending cards. Each **ApprovalCard**: document title + code, policy, uploaded-by, requested time, doc-type pill, due date (+ days overdue), current step name, Reject/Approve buttons. (Approved/Rejected show "history will appear here" empty states.)
  - *Templates tab:* list of template cards (name, description, doc-type pills, Default/Inactive badges, edit/delete) → a **template detail** view showing settings (Allow Skip / Require All Approvers / Auto-publish) and an ordered **Workflow Steps** list (sequence number, name, step-type pill [Review/Approval/Notification], approval-mode pill [Any/All/Sequential], timeout days, approver count) with move-up/down reordering, edit, delete.
- **Primary actions & flows.** Approve/Reject via a comments modal (reason required to reject). **New/Edit Template** slide-over (name, description, doc-types checkboxes, settings toggles). **Add/Edit Step** slide-over (name, step type, approval mode, timeout days, required toggle). **Seed Defaults** button to bootstrap standard templates. Reorder steps.

---

## Regulatory Change Management

### Regulatory Changes — `/governance/regulatory-changes`
- **Purpose.** Track incoming regulatory changes and their implementation status.
- **What it shows (data).** 4 stat tiles (Total Changes / Under Assessment / In Implementation / Gaps Identified). Filters: search, Source (OCC/Fed/EBA/PRA/SEC/FINRA/custom), Status, Priority. A table: **Change (title + reference number) · Source (with building icon) · Status (inline editable dropdown pill) · Priority pill · Effective Date · Gaps (count) · actions (view, delete)**. Empty state when none.
- **Primary actions & flows.** **New Change** slide-over (title, source, priority, regulatory body, reference number, publication/effective dates, description, impact summary). Inline status change from the table. View → detail; delete with confirm.

### Regulatory Change Detail — `/governance/regulatory-changes/[id]`
- **Purpose.** Manage one regulatory change through assessment, implementation, gap analysis, and closure.
- **IA.** Header (title, status pill, priority pill, source, reference) + Update Status. Four tabs: **Overview · Impact Assessments · Implementation Tasks · Gap Analysis**.
- **What it shows / flows.**
  - *Overview:* Description card, Impact Summary card, "Recent Assessments" preview, a **Details** sidebar (regulatory body, publication/effective dates, gaps identified, created), **Quick Actions** (add assessment/task, view gaps), and a **Closure** card — "Check Closure Readiness" shows completed/total tasks, lists incomplete tasks, and gates a **Close Regulatory Change** button (only enabled when ready).
  - *Impact Assessments:* list of assessments (impact-level pill, status, date, affected areas, compliance gaps, recommendations). Add Assessment slide-over.
  - *Implementation Tasks:* table (Task [type icon + title/desc] · Type pill · inline Status dropdown · Due Date · delete). Add Task slide-over (title, type, priority, due date, description).
  - *Gap Analysis:* "Run AI Analysis" → gap cards (severity pill, gap type, status, description, Current State vs. Required State, Remediation Plan).
- **Notable.** Toast-driven status update, closure-readiness gating, AI gap analysis.

### Regulatory Feeds — `/governance/regulatory-feeds`
- **Purpose.** Configure regulatory RSS/source feeds, poll them, and triage incoming items with AI into regulatory changes.
- **What it shows (data).** 4 stat tiles (Feed Sources / New Items / Analyzed / Processed). A collapsible **Feed Sources** table (Name · Regulator · Country · Category · Status · Last Polled · Items · poll/delete actions). A **Feed Items** table (expand caret · Title [+ external link, description] · Published · Source · Status pill · actions) with a status filter; expanding a row reveals full description and, when analyzed, a rich **AI Analysis** block: summary, priority pill, compliance gaps (chips), impacted frameworks (name + reason), impacted controls (id/name + action needed), implementation tasks (title, priority, description, suggested deadline days), recommendations.
- **Primary actions & flows.** **Add Custom Feed** slide-over (name, RSS URL, regulator, country, category, poll interval hours). **Add Default Feeds** (seed CBSL/Fed/ECB), **Poll All Feeds**, poll a single source, delete source. Per item: **Analyze with AI** (new → analyzed), **Convert to Regulatory Change** (analyzed → creates a change).
- **Notable.** Real background polling + per-item AI analysis; this is the intake funnel that feeds the Regulatory Changes register.

---

## Reviews

### Document Reviews — `/governance/reviews`
- **Purpose.** Track and complete scheduled document reviews; also a hub for governance action reviews and attestations.
- **IA.** A section switcher: **Document Reviews · Actions · Attestations** (Attestations and Actions re-render other modules inline). A "Calendar View" link.
- **What it shows (data — Document Reviews).** 4 KPI cards (Upcoming 30 days / Overdue / On Track / Due This Week). A "By type" strip (per doc-type totals + overdue/soon chips). Tabs Overdue / Upcoming / All (with counts). A list of document cards: type icon+label, title (Overdue badge), owner, code, Next Review, status ("N days overdue / left"), Last Reviewed, cycle months, and a **Complete Review** button (resets the cycle after a confirm).
- **Actions section.** 3 KPI cards (Pending Review / In Review / Approved) + status sub-tabs; a list of governance action-review cards (action description, review-status pill, action type, submitted by, action date, entity type).
- **Notable.** Complete-review mutation resets next review date; the same page hosts the Attestations dashboard inline.

### Review Calendar — `/governance/reviews/calendar`
- **Purpose.** A visual month calendar of upcoming document reviews.
- **What it shows (data).** 3 summary cards (Overdue / Due This Week / Upcoming 30 days). A full month grid (prev/next/today nav, weekday headers, today highlight) where each day cell shows up to 2 review chips (color-coded overdue=red / due-soon=amber / upcoming=green) + "N more". A color legend. A **selected-date panel** listing that day's reviews. Two side lists: **Overdue Reviews** and **Upcoming Reviews** (type icon, title, due date, days label, external-link to the document).
- **Primary actions & flows.** Navigate months; click a day → detail panel; click a review → open the document.

---

## Mappings

### Policy-Control Mappings — `/governance/mappings`
- **Purpose.** Link governance documents to controls and show framework-clause coverage. Also embeds inside the document detail "Mappings" tab (single-document mode).
- **What it shows (data).** Header with portfolio stats (Documents count, "Policies mapped X/Y (Z%)", Linked Controls for the selection). Two panels:
  - **Documents picker** (left): search + type filter, list of documents (type tile, title, code, status pill, select).
  - **Mappings panel** (right): a **Framework mappings** section — per-framework collapsible cards with a **coverage bar (%)**, "mapped/total covered", and "N gaps"; expanding lists that framework's clauses split into **Mapped** (clause ref, title, match %, statement count, link/unlink) and **Not mapped** (the gap clauses, with reference/title/domain). A **Mapping detail** slide-over shows a clause's "why it matched" rationale, full clause text, and the covering policy statements. A **Linked internal controls** list (control code, name, link-type pill, notes, unlink).
- **Primary actions & flows.** Select a document → view its framework coverage. **Link/Unlink** recommended framework clauses. **Link Control** slide-over (search internal ERM controls, link type [implements/supports/references/derives-from], notes; handles re-linking a control already tied to another document with a confirm). Toolbar with search + status view (all/mapped/gaps).
- **Notable.** Recommendations populate automatically after a document is parsed into statements, scoped to the document's in-scope + referenced frameworks; AI/derived match confidence shown as %.

---

## Attestations & Certifications

**Purpose & IA.** Run attestation/certification campaigns and let users complete their assigned attestations. Dashboard (`/attestations`) → All Campaigns list (`/attestations/campaigns`) → Campaign detail (`/attestations/campaigns/[id]`); a personal "My Attestations" (`/attestations/my`) and a per-attestation completion form (`/attestations/complete/[id]`). This module also renders inline inside the Reviews screen and is linked from the Governance overview.

### Attestations Dashboard — `/governance/attestations`
- **Purpose.** Overview of campaigns + the current user's own pending/completed attestations, with evidence linking.
- **What it shows (data).** 4 KPI cards (Total Campaigns / Pending Attestations / Overdue / Completion Rate %). **My Pending Attestations** (expandable rows: campaign, status pill, due date; expand → attestation text, type, "Complete Now"). **Completed Attestations** (bulk-selectable list with "Unlinked Only" filter, per-item "Link to Evidence", and a **Bulk Link to Evidence** action). **Recent Campaigns** table (Campaign · Type · Status pill · Duration · Progress bar+% · View Details).
- **Primary actions & flows.** New Campaign, View All Campaigns, My Attestations. Link individual or bulk completed attestations to the Evidence repository.

### My Attestations — `/governance/attestations/my`
- **Purpose.** A personal to-do of attestation requests.
- **What it shows (data).** 3 stat cards (Pending / Overdue / Completed this month). Tabs **Pending & Overdue** and **Completed History**. Pending items are cards (campaign, type, due/overdue date, "Complete Now"). History is a table (Campaign · Type · Completed date · Evidence attached?).

### Attestation Campaigns — `/governance/attestations/campaigns`
- **Purpose.** Manage the full set of attestation campaigns.
- **What it shows (data).** 4 KPI tiles (Total / Active / Draft / Pending Requests). Status filter + search. A grid of campaign cards (name, status pill, description/type, due date, completed/total, progress bar+%, "N pending"). Card actions: View, Activate (draft→active, confirm), Close (active→closed), Delete (draft only).
- **Primary actions & flows.** **Create New Campaign** slide-over: name, description, **attestation type** (SOX 302/404, policy sign-off, BCP awareness, training ack, annual cert), optional **linked governance document** (auto-fills the acknowledgment text), attestation text, start/due dates, **target audience** (All Users / By Role [role checklist] / Custom [user checklist]), and a "require evidence" toggle. (Opens automatically via `?action=new`.)

### Campaign Detail — `/governance/attestations/campaigns/[id]`
- **Purpose.** Operate a single campaign — statement, escalation, per-user requests, and reporting.
- **What it shows (data).** Header with status pill and Edit/Export/Activate/Close. 5 stat cards (Type · Due Date · Total Requests · Completed · Progress bar). **Attestation Statement** card (with linked-document reference and "evidence required" note). **Escalation Setup** — tiered escalation chains (tier → user/role, "escalate after N days overdue", add/delete tiers, reminder/auto-escalate timing summary). **Attestation Requests** table (checkbox · User [name/email] · Type · Status pill [pending/completed/overdue/escalated] · Completed · Evidence · row actions: send reminder, escalate) with a status filter and **bulk Send Reminder**. Bottom: **Status Summary** (counts per status) and **Pending Actions** (top pending users).
- **Primary actions & flows.** Activate/Close campaign; **Edit Campaign** slide-over (name, description, attestation text, due date, reminder-days-before, auto-escalate-days-after, enable escalation, require evidence); add/remove escalation tiers; send reminders (single/bulk); escalate a request; **Export CSV** audit report.

### Complete Attestation — `/governance/attestations/complete/[id]`
- **Purpose.** The user-facing sign-off form for one attestation.
- **What it shows (data).** Overdue banner if applicable. Optional **Referenced Document** card (link to read the policy). **Attestation Statement** card (type, the statement text, due date) with a required legally-binding **acknowledgment checkbox**. Conditional **Evidence Upload** (drag/click, PDF/DOC/PNG/JPG, shown only when the campaign requires evidence, with an optional evidence description). Optional **Comments** textarea. Submit / Cancel; "Already Completed" and "Not Found" guard states.
- **Notable.** No file-upload endpoint — evidence filename is recorded as a reference; formal evidence is linked via the Evidence module.

---

## Legacy top-level Document Library

### Document Library — `/documents`
- **Purpose.** A simpler, older documents list (separate from the richer Governance Documents workspace) — manage policies/procedures/standards/guidelines.
- **What it shows (data).** Header + "Upload Document". Search, Category filter (Policies/Procedures/Standards/Guidelines), Status filter (Draft/In Review/Approved/Archived). A table: **Document (icon + title + description) · Category (colored badge) · Versions (count → history) · Status badge (with icon) · download action**. Empty state prompting first upload.
- **Primary actions & flows.** **Upload modal** (title, description, category, file). **Version History modal** (per-version number, changes summary, timestamp, download). Download a document.
- **Notable.** This is a lighter, legacy surface; the governance-grade lifecycle, AI, mapping, gap analysis, and sign-off features all live under `/governance/documents` instead. A redesign should reconcile or retire this against the Governance workspace.

---

### Cross-cutting notes for the redesign
- **Two "documents" experiences coexist** (`/documents` legacy vs. `/governance/documents` full workspace) — a prime consolidation target.
- **"Gap analysis" is not a page** — it is a document-detail tab and a regulatory-change-detail tab; a redesign should decide whether it deserves a first-class destination.
- **AI assist is pervasive but inconsistent in presentation** (async job with stage telemetry on doc drafting; inline "Sparkles" buttons on exceptions/actions/charters; expandable AI analysis on feeds) — an opportunity to unify the AI affordance and progress patterns.
- **The scorecard/score-kit system** (ScoreRing, weighted section cards, formula modals, weight tuner) is shared by the Governance overview and Committees dashboard and should be treated as one reusable component family.
- **Slide-over drawers (`RightSlidePanel`) vs. centered modals are used inconsistently** for create/edit/approve flows across screens — worth standardizing.

---

# Compliance, Frameworks & Assessments

This brief covers seven route groups under the dashboard shell: **Compliance**, **Compliance Overview (device scans)**, **Frameworks**, **Framework Upload**, **Controls / Control Catalog**, **Assessments**, and the **Auditor Portal**. Together they form the "compliance spine" of the platform: bring a framework in (upload → parse → publish), turn its requirements into working controls, evidence and test those controls, run gap/maturity assessments, and expose a read-only review surface to auditors. Brand accent is teal (`#1ed4b0`); status semantics are consistent throughout (emerald = good/compliant/verified, amber = partial/in-progress, rose = non-compliant/overdue, slate = not started/N-A).

---

## Compliance

**Purpose.** The compliance workspace ties policy statements, framework controls, evidence, and gap/maturity assessments into one scored posture. **IA:** A module shell (`/compliance/layout.tsx`) prints the header "Compliance — Real-time posture across frameworks, controls, evidence, and the unified library" and wraps a small set of pages; the header is intentionally hidden on the Assessments sub-tree so that module owns the full canvas. The compliance sub-routes are: the roll-up **Overview**, **Policy Statements**, **Assessments** (list → detail → approvals). Note that "Controls", "Evidence", and "Control Library" are surfaced as quick-links out to sibling modules rather than living inside this folder.

### Compliance Overview — `/compliance`
- **Purpose.** A board-level, one-screen roll-up of compliance posture with fast jump-off to the four working pages.
- **What it shows.** A `ComplianceOverviewCards` cluster (board-level scored sections, each with its scoring formula one click away — this is a shared scorecard component). Beneath it, a "Go to a page" grid of four navigation cards: **Frameworks** (hint "upload · parse · publish"), **Controls** ("evidence · verification"), **Evidence** ("library · freshness · review"), **Control Library** ("normalize · harmonize"), each an icon tile in a blue chip.
- **Primary actions.** Read posture; click a card to drill into a module. No create/edit here.
- **Notable.** Purpose-built "no legacy widgets" board; the scoring cards are the anchor.

### Policy Statements — `/compliance/statements`
- **Purpose.** Assess each policy statement (extracted from governance documents) for compliance, attach evidence, and optionally convert statements into internal controls.
- **What it shows.** A filter bar (search; **Document**, **Status**, **Priority**, **Category** multi-select dropdowns) over a paginated table (20/page). **Columns:** select checkbox, Code (mono), Statement (summary text + assignee name with user icon), Document, Category, Priority pill, Status pill, Actions (eye/view). Status vocabulary: Compliant / Partially Compliant / Non-Compliant / Not Assessed / Not Applicable. Empty state: file icon + "No policy statements found"; loading = spinner row.
- **Primary actions & flows.** Row eye opens a **right-side detail drawer** showing statement text, document/category, an **Assigned To** picker (searchable user dropdown + Assign button), Compliance Status select, Findings textarea, Remediation Notes textarea, Next Assessment Date, a **Link Evidence** multi-select, a list of already-linked evidence (each with in-place **Preview** button and link to evidence detail), and a `StatementLinkagePanel` (cross-links). A permissions rule: once a statement is assigned, only the assignee or an admin can assess it — inputs disable and an amber "locked to another user" note appears. **Bulk op:** selecting rows reveals a "Convert to Controls (N)" button → modal to pick optional Category/Priority and create internal controls from the selected statements (must be from a single document).
- **Notable.** Assignee-gated editing, bulk statement→control conversion, inline evidence preview, success toast banner.

### Assessments (list) — `/compliance/assessments`
- **Purpose.** Portfolio board of all compliance/gap/maturity assessments with SLA-driven closure tracking; drill into any one to score its line items.
- **IA.** Renders the redesigned `ComplianceAssessmentsModule` (embedded). Three views: **Overview** (board) → **framework list / dedicated workspace** → **assessment detail**. A tab strip across the top switches assessment families: Overview, Internal Audit, Maturity Model, OWASP ASVS, OWASP Testing, Standard, NCA, PDPL, Digital Operations Maturity, DPIA/PIA, plus Cyber-Security templates (Mobile App Security, CSIR/CTI Maturity, Incident Management, IT Security Operations, KPI Report) and NCA sub-registers (Vulnerability Register, Audit Plan, Risk Management). Each tab shows a count badge.
- **What it shows — Overview board.** A "Portfolio overview" header ("N assessments · N points · every point scored on its own SLA timeline") with a "N need attention" pill. **Hero KPI tiles:** Assessments, Avg score (date-weighted roll-up), Closure %, Overdue points (+ due-soon), Total points. An **SLA / closure panel** (`SlaClosurePanel`) with an "as-of" time-travel scrubber and tunable SLA policy. Then **assessment cards** (filterable: All / Needs attention / In review / Completed; sortable: Compliance / Open gaps / Name). Each card: type eyebrow, name, an SLA posture pill (overdue / due-soon / on-track), a **ComplianceRing** score gauge, a **StatusMixBar** with per-status counts (Complied / Partial / In Progress / Not Complied), and a footer of Stats (item count, Overdue, Open gaps). Item noun adapts per type — "controls", "observations" (Internal Audit), or "points" (PDPL).
- **Primary actions & flows.** Upload a workbook (hidden file input, `.xlsx/.xls/.csv/.pdf`) → parse → new assessment appears; open a card → detail; per-type dedicated workspaces (NCA container, PDPL, ASVS, Maturity, KPI, DPIA, DCC tool) render their own tab bodies.
- **Notable.** Everything is SLA/date-scored; upload-and-parse ingestion; per-type terminology.

### Assessment Detail — `/compliance/assessments/[id]`
- **Purpose.** Score every control/requirement in one assessment, attach and route evidence, and generate AI evidence recommendations.
- **IA.** Back-link to Assessments; header (icon, name, "type • file", status badge, **Export Excel**). A tab bar: **Assessment**, **NCA**, **DCC**, **Audit Plan**, **Artifacts** — each self-fetching by assessment id.
- **What it shows (Assessment tab).** A **compliance summary**: a hero **readiness ring** (overall score % + plain-language verdict: On track / Developing / At risk / Not started), a **Status mix** bar with metric tiles (Complied / Partial / Not Complied / In Progress counts + colors), and per-domain coverage rows. Below, items are grouped into **domain accordions**; each row shows item number, control description, compliance-status pill (Complied/Partial/Not Complied/In Progress/N-A), priority, responsible party, timeline, gaps, proposed solution. A special "audit-master" format groups by domain prefix. XLSX-maturity assessments get a dedicated `XlsxMaturityViewer`.
- **Primary actions & flows.** Inline **edit** a row (status, responsible party via tenant-user picker, timeline date, remarks, gaps, proposed solution, priority). **Add item** drawer (pick existing domain — which reveals only that domain's used fields — or create a new domain). **Delete** item (confirm modal). A per-control **right side panel** (paperclip/sparkles buttons) with two tabs: **Evidence** (upload a file, or link existing library evidence via search, plus an approval workflow — approve/reject/return with comments and tiered approval history) and **AI** (generate AI evidence recommendation, shown as prioritized recommendation cards). Export to Excel. Error toast for AI failures.
- **Notable.** AI evidence recommendations, multi-tier evidence approval, per-format tab workspaces (NCA/DCC/Audit Plan/Artifacts), Excel round-trip (export + re-upload refresh).

### Pending Approvals — `/compliance/assessments/approvals`
- **Purpose.** One inbox for the reviewer to approve/reject/return evidence submissions (from both compliance assessments and the evidence library).
- **What it shows.** Header "Pending Approvals — Evidence submissions awaiting your review". A stacked list of approval cards; each: evidence name, status badge with tier ("Pending Review (Tier 1)"), and a 2×2 detail grid — **Assessment** (link), **Control/Requirement**, **File**, **Submitted** (submitter + datetime). Empty state = big green check "All Caught Up!".
- **Primary actions & flows.** Per card: **Approve** (immediate), **Reject** / **Return** (expands an inline comment box — rejection requires a reason — then Submit), and a **History** toggle showing a timeline of approval actions (submitted/approved/rejected/returned, performer, comments, timestamp). Actions gated by `compliance:assessments:edit`.
- **Notable.** Merges two sources (compliance + evidence-mgmt) into one queue; tiered approval history.

---

## Compliance Overview — Device Compliance & Scans (`/compliance-overview`)

- **Purpose.** A drill-down operations dashboard showing every connected device's CIS-benchmark compliance (this is the infrastructure-scan side of "compliance", distinct from framework compliance).
- **IA.** A top tab strip ("Compliance & Scans"): **Compliance Overview**, **Compliance Rules** (rule library), **Scanners** (agents admin) — mounted as sibling pages. The Overview tab is the focus.
- **What it shows.** A **device filter search**, then an **Executive Summary** hero (4 panels): (1) overall compliance **gauge** (pass-rate radial, neutral "—" when no scans), (2) **Check Results donut** (Passed/Failed/Errored with counts + %), (3) **Scan Coverage** (scanned-of-total devices + Scanned/Awaiting scan/Not mapped stacked bar), (4) **Asset Risk** glance (avg risk score, critical/high/moderate/low bands, top-3 riskiest assets link). Below, an **L1 category card grid** — device categories (Windows, Linux, macOS, Network, Databases, Identity/AD, Cloud, Containers, VMware, Unclassified), each card with icon, device count, a pass-rate ring, scanned/pass/fail counts, and a "Not yet covered" strip for empty categories. **L2:** clicking a card expands an asset list grouped by OS variant chip. **L3:** clicking an asset lazy-loads the exact **CIS rules applied** via a 2-stage AI matcher (Stage 1 OS filter → Stage 2 AI edition pick → "will execute N rules"), rendered as a paged rule table (Rule ID / Title / Severity) with "Load 50 more". Warns when OS metadata is too generic to match.
- **Primary actions & flows.** Filter → drill category → drill asset → inspect rules → "See full results" / open asset / connect a scanner.
- **Notable.** Three-level progressive drill-down, AI CIS-benchmark matching with per-asset "what will run" transparency, real-time-ish scan data.

---

## Frameworks

**Purpose.** Manage the framework library and the certification/compliance "journeys" run against each. **IA.** A shared `FrameworksTabs` bar (title "Compliance Frameworks") with two tabs — **Dashboard** (`/frameworks`) and **Manage Frameworks** (`/frameworks/manage`) — plus a persistent **Auditor Portal** link and a **Start-a-Journey** launcher in the leading slot. Journey detail (`/frameworks/[id]`) and framework overview (`/frameworks/overview/[id]`) sit under the Dashboard tab.

### Frameworks Dashboard — `/frameworks`
- **Purpose.** Live compliance posture across all active framework journeys, plus a launcher to start a new one.
- **What it shows.** A **Journey Picker** launcher (top-left). The `ComplianceDashboard` cluster: (1) **Posture Overview** — a completion **radial gauge** ("X% · N of M total"), Readiness/Compliant mini-bars, approved-evidence and open-gaps counts; a **Status donut** (controls by status with center total); a **Compliance Trend** area chart with a range selector (7/15/30/365 days + custom). (2) **Active Framework Journeys** — per-journey cards each with a mini radial gauge (readiness %), classification chip (Cert/Comp), overdue/urgent date badges, a status mini-bar and implemented/in-progress/not-started counts, linking to the journey. (3) **Domain Heat-map** — colored intensity tiles (coverage % per control domain, 5-step heat scale + legend). (4) **Recent Activity** — day-grouped timeline (evidence uploaded / marked implemented, approved/rejected chips, relative time). Hides entirely when there are no journeys. (5) **Framework Deep-Dive** — pick one journey to see three MiniGauges (Readiness, Completion, Evidence Coverage) with status chips and a link to full detail.
- **Notable.** Recharts-heavy executive dashboard; auto-refresh (60s); trend snapshots over time.

### Manage Frameworks — `/frameworks/manage`
- **Purpose.** The library management surface — watch uploads process, manage active journeys, and start journeys from available frameworks.
- **What it shows.** A search bar and three sections. **Processing Frameworks** (auto-refresh every 3s): cards with a pulsing sparkle, status pill (Uploaded / Text Extracted / Parsing / Classifying / Ready / Parsed / Published / Error), progress bar during AI parsing, controls-extracted count, a **Retry** parse action. **Active Certification Journeys**: cards with a readiness donut gauge, status pill, implemented/in-progress counts, target date, click-through to journey, delete (with confirm modal). **Available Frameworks**: cards with controls count chip, framework-type tag, classification badge (🏆 Certification / 📋 Compliance), and actions — **View Overview**, **Classify Framework** (AI), **View Controls**, **Start Journey**, **Generate Evidence Recommendations** (AI), Delete.
- **Primary actions & flows.** Retry parse, classify (AI), enhance/generate evidence recs (AI), start journey (→ journey detail), delete framework/journey (confirm modals with error surfacing).
- **Notable.** Live polling of processing state, AI classify + AI evidence-recommendation generation, destructive-action confirmation modals.

### Framework Overview — `/frameworks/overview/[id]`
- **Purpose.** A read-first "what is this framework" briefing before starting a program.
- **What it shows.** Header (award/file icon, name, version, classification badge + AI confidence %), **View Controls (N)** and **Start Certification Journey / Start Compliance Program** buttons. Optional collapsible **Classification Reasoning**. For **certification** frameworks: a 5-phase **Certification Lifecycle** strip (Preparation → Assessment → Remediation → Certification → Maintenance), **Required Artifacts** list, **Certification Details** (validity period, levels, total controls). For **compliance** frameworks: **Framework Purpose** callout, **Scope & Audience**, **Framework Objectives** checklist, **Adoption Approach** numbered steps, and a rose **Penalty for Non-Compliance** callout. Unclassified state prompts to go classify it.
- **Notable.** AI-extracted framework metadata; content adapts by classification.

### Certification Journey Detail — `/frameworks/[id]`
- **Purpose.** The full working surface for one framework program — implement controls, gather evidence, run gap analysis / SoA / risk treatment / internal audit, and follow a guided journey.
- **IA.** A large multi-tab page grouped as **Program** (Journey, or Overview fallback), **Work** (Requirements — badge with control count; Artifacts), and a **framework-specific group** (e.g. ISO 27001: Gap Analysis, Internal Audit, Risk Treatment, Scope Statement, Audit Procedure; PCI DSS: CDE scope; plus template-driven registers/documents that collapse into dropdowns). Summary cards collapse on scroll and show only on the Overview tab.
- **What it shows.** A **Journey** flow/map (guided stages with owners). **Overview**: control stats tiles (Total, Applicable, Not Applicable, Implemented, In Progress, Not Impl.), readiness/applicability gauges, status mix (Compliant / In Progress / Not Started). **Requirements (controls)**: category filter tabs (All / Organizational / People / Physical / Technological with counts for ISO), per-control status (Not Implemented / Partial / Implemented / Verified / N-A), applicability + review flows, evidence attachment, per-control document/artifact typing (policy, procedure, screenshot, audit log, risk assessment, access review, certificate, etc.). **Statement of Applicability (SoA)** sub-view: Applicable/Implemented rings, totals, export. Framework-specific templates render scope statements, gap-analysis and risk-treatment registers.
- **Primary actions & flows.** Set control applicability (with justification modal), mark implementation status, attach/generate evidence, complete journey stages, fill scope/gap/risk-treatment templates, export.
- **Notable.** Journey/guided-flow model, ISO-27001 and PCI-DSS specialized template tabs, SoA export, per-domain requirement browsing.

---

## Framework Upload

**Purpose.** The ingestion pipeline that turns a framework document into structured, publishable controls, then lets teams run gap assessments against it. **IA.** Its own layout with a 4-item nav: **Upload**, **Parsed Controls**, **Alignment**, **Assessment** (header "Upload, parse, and assess compliance frameworks").

### Upload — `/framework-upload`
- **Purpose.** Upload a PDF/DOCX framework, extract text, AI-parse controls, and publish into the main library.
- **What it shows.** A large **drag-and-drop dropzone** (PDF/DOCX) with selected-file preview; a metadata form (Framework Name*, Type — Regulatory/Industry Standard/Internal, Source Organization, Version, Description). Below, an **Uploaded Frameworks** list: each row shows name, status badge (Uploaded / Text Extracted / Parsing… / Parsed / Published / Failed), type tag, file name/type/size, upload date, controls-parsed count, and an expandable **Extracted Text Preview** (first 2000 chars, mono). Empty state = "No frameworks uploaded yet".
- **Primary actions & flows.** Upload → **Extract Text** → **Parse** (AI) → **Publish to Frameworks** modal (Short Code*, Regulator/Source, Jurisdiction, Region select, Mandatory checkbox, and a "what will be created" summary). Also View Controls, View in Frameworks, Delete (confirm).
- **Notable.** Staged pipeline with per-stage actions, text-preview transparency, publish wizard.

### Parsed Controls — `/framework-upload/controls`
- **Purpose.** Review, edit, and verify the AI-parsed controls for a framework, and generate AI evidence requirements.
- **What it shows.** Framework selector; **KPI tiles** (Total Controls, Verified, By Domain chips); an **AI Evidence Requirements** action strip (Generate + View Requirements). Filters (search; Domain, Category, Verified dropdowns). **Table columns:** Control ID (mono), Title, Domain (colored pill), Category, Mandatory (Yes/No), Priority pill, **AI Confidence** %, Verified check, Evidence count, Actions (View / Edit / Verify). View and Edit modals expose full control fields and expected evidence types.
- **Primary actions & flows.** View, edit (title/description/domain/category/priority/mandatory), verify a control, bulk-generate AI evidence requirements.
- **Notable.** AI-confidence scoring per control, verification workflow, AI evidence-requirement generation.

### Alignment — `/framework-upload/alignment`
- **Purpose.** Map parsed controls to the normalized/canonical control library (dedupe & harmonize), confirming or reclassifying each match.
- **What it shows.** Framework selector; **Analyze Alignment** and **Create New Controls (N)** actions. **KPI tiles:** Exact Matches, Partial Matches, New Controls, Confirmed, Completion %. Tabs (All / Exact / Partial / New with counts). A search + a list of alignment cards: parsed control ID, alignment-type badge (Exact/Partial/New), match-score %, Confirmed chip, title/domain, a **Matched Control** panel (code + name), and match reason. Empty state prompts "Analyze Alignment".
- **Primary actions & flows.** Run analysis (AI matching), **Confirm** an alignment (modal comparing both controls), **Edit** alignment (type + reason), create new normalized controls from unmatched ones.
- **Notable.** AI similarity scoring, human-in-the-loop confirmation, library normalization.

### Assessment (gap) — `/framework-upload/assessment`
- **Purpose.** Run a gap/compliance assessment against a parsed framework — score each control, attach evidence, and open remediations.
- **What it shows.** Assessment selector + **New Assessment** button. When selected: **6 KPI tiles** (Total Controls, Compliant, Partial, Non-Compliant, Not Assessed, Compliance Score %), a **progress bar** (assessed of total + gaps), and **3 charts** — Compliance Progress donut (Done vs Remaining), Evidence Upload Coverage donut, Evidence Review Status bar. Filters (search; Status, Domain). **Table columns:** Control (id + title), Domain, Status (icon pill), Owner, Gap, Evidence count, Remediation count, Actions (Update Status / Upload Evidence / Add Remediation).
- **Primary actions & flows.** Create assessment (framework + name + target date modal); per control: update compliance status (+ notes, gap description), upload evidence (dropzone + type + description), add remediation (title, description, priority, due date, owner, estimated effort).
- **Notable.** Full assess→evidence→remediate loop with its own charts; distinct from the newer `/compliance/assessments` (Excel-driven) module.

---

## Controls / Control Catalog

**Purpose.** The working control library — every control (from frameworks, internal/risk-authored, or normalized) organized by 20 canonical security domains, with assign/test/evidence/certify workflows. **IA.** A `ControlSurfaceTabs` strip ties together **Catalog** (`/controls`), **Overview** (`/controls/overview`), and the **Workbench** (`/controls/workbench`); **Configure Frameworks** (`/controls/configure-frameworks`) governs scope.

### Control Catalog — `/controls`
- **Purpose.** Browse and work controls by domain; the operator's home base for control assurance.
- **What it shows.** Header + **Configure frameworks** link (with scope count badge). A top **source toggle**: Framework controls vs Internal Controls (with counts). Four views: **By Domain** (hub), **By Framework**, **All Controls** (flat), **My Work** (with count). The **Domain Hub** opens with a **Posture Hero** — a conic donut over the whole estate (tested %), a grade pill (Strong/Fair/Needs work/Not started), effective/partial/ineffective/not-tested legend — beside a **Needs attention** panel (Tests overdue, Ineffective controls, Partially effective, Evidence to review, each a clickable jump). Then **domain cards** (icon + tint per domain, control count, framework count, source-mix chips, a **RAG effectiveness bar**, Assigned/Tested/Evidence stats, overdue flag). Domain detail groups controls by framework; a `KpiStrip` shows Controls / Assigned / Tested / Effective / Overdue / Evidence-pending.
- **Primary actions & flows.** Open any control → **Workbench Drawer** (assign, effectiveness & testing, AI test-procedure checklists with per-point evidence, evidence review, linked risks, workflow). **New internal control** (authored from the risk register). **Promote** framework controls to internal.
- **Notable.** 20-domain canonical taxonomy, design/operating effectiveness (D/O dots), AI test procedures, internal-vs-framework duality, "needs attention" triage.

### Controls Overview — `/controls/overview`
- **Purpose.** A control-program dashboard (no control list) rolling up coverage, status, evidence, and ownership per framework.
- **What it shows.** Header + **Open Workbench** link. A **6-KPI row** (Frameworks, Total controls, Implemented %, Verified %, Evidence coverage %, Assigned %). An **Assignments across frameworks** chip cloud (top owners + counts). **Per-framework dashboard cards** — each with coverage bars (Implemented / Verified / Evidence coverage), a 4-stage implementation **status distribution bar** (Not started / In progress / Implemented / Verified) with legend, and an assignment/owners summary (top owners as chips). Empty state = "No frameworks yet".
- **Notable.** Owner distribution surfacing, per-framework parallel-fetched status summaries.

### Configure Frameworks — `/controls/configure-frameworks`
- **Purpose.** Admin-only, tenant-wide setting to choose which frameworks feed the Control Catalog.
- **What it shows.** Back-link to Catalog. **Summary tiles** (Frameworks selected X of N, Controls in catalog, Coverage %). A searchable, checkbox **framework list** (each row: check state, name, controls-count chip) with Select all / Clear. A **change log** (who changed the selection, when, with +added/−removed chips and the new total). Non-admins see a read-only banner.
- **Primary actions & flows.** Toggle frameworks → **Save selection** (all-checked saves as canonical "all"); dirty-state gating; success confirmation.
- **Notable.** Auditable change log, admin-gated tenant scope.

### Controls Workbench — `/controls/workbench`
- **Purpose.** A split master/detail surface to search, inspect, and evidence individual framework controls without popups.
- **What it shows.** Header (framework name + control count) + Overview link. Filter bar (search; Framework, Domain, Sort field + asc/desc). **LEFT** = quick-filter chips (All / Gaps / Mine / In progress) over a scrollable, collapsible Framework→Domain tree of control rows (mono ref, priority badge, requirement snippet, evidence count, a status dot: verified/implemented/in-progress/pending), paginated. **RIGHT** = docked inspector for the selected control: **Implementation stage** pipeline (Not started → In progress → Implemented → Verified, clickable to set; Mark N/A), **Owner** picker + Manage evidence + Recommended evidence, the **Requirement** text, an **Evidence checklist**, plus Mapping/Activity and **AI recommendations** (test procedures with per-procedure done + evidence link, evidence requirements, addressed risks, "risks if not implemented" → **Promote to ERM Risk Register** flow). Prev/Next navigation across the filtered list.
- **Notable.** No-popup docked inspector, AI test-procedure/evidence recs auto-loaded per tenant, promote-control-gap-to-risk and close-linked-risk flows.

---

## Assessments (top-level)

**Purpose.** The same redesigned `ComplianceAssessmentsModule` as `/compliance/assessments`, promoted to a top-level section with a sidebar dropdown of assessment types. **IA:** `/assessments` opens the **Overview** board; `/assessments/[framework]` opens one type directly (the framework key becomes the initial active tab — e.g. `/assessments/pdpl`, `/assessments/nca`, `/assessments/digital_ops_maturity`).

### Assessments Overview — `/assessments`
- Identical board to the Compliance→Assessments Overview described above (portfolio KPIs, SLA/closure panel with time-travel, filterable/sortable scored assessment cards). Opened with `initialTab="overview"`.

### Assessment by Type — `/assessments/[framework]`
- Opens the module scoped to one assessment family/tab (e.g. Internal Audit, Maturity, OWASP ASVS/Testing, NCA, PDPL, DPIA, Mobile App Security, KPI Report, and NCA sub-registers). For a framework with data it lands straight on that assessment's **detail** view (readiness gauge/KPI cards, domain accordions with per-item score, per-domain closure roll-ups, Add item, Upload/Re-upload Excel, Export report); dedicated types (NCA/PDPL/ASVS/Maturity/DCC/KPI/DPIA) render their bespoke workspace.

---

## Auditor Portal

**Purpose.** A read-and-review surface for auditors to inspect a certification journey's posture, control scope, and evidence — and approve/reject evidence — without touching the operator's working views. **IA:** an index of journeys → a per-framework detail with a trimmed tab set; Internal Audit is a sibling entry.

### Auditor Portal Index — `/auditor-portal`
- **Purpose.** Pick a framework certification journey to review.
- **What it shows.** Header + search. A grid of journey cards (shield icon, resolved framework name, short-code + status). Empty state prompts to start a journey. Each card links to the detail.

### Auditor Portal Detail — `/auditor-portal/[frameworkId]`
- **Purpose.** Review one framework's audit posture, controls, and evidence; share a deep-link to the exact view.
- **IA.** Header (back, framework label, status), a **framework/journey switcher** dropdown, and a **Share** button (copies a `?tab=` deep-link). Three tabs: **Overview**, **Controls**, **Evidence** (other tabs — Documents, Risks, Assets, Vulnerabilities, Vendors, Exceptions, Audit Trail — exist on disk but are unwired).
- **What it shows — Overview.** A hero of **3 radial gauges** (Scope coverage, Evidence approval rate, Implementation complete) with a Journey status/progress chip. A **Controls scope breakdown** stacked bar (In scope / Out of scope / Pending review / Untouched). An **Evidence review pipeline** (Pending — pulsing / Approved / Rejected horizontal bars). **Linked artifacts tiles** (Documents, Risks, In-scope assets, Open vulns, Active vendors, Exceptions) as clickable navigators. An **Implementation status** chip row.
- **What it shows — Controls.** A searchable control list with applicability state (in_scope/out_of_scope/pending/untouched), implementation status, criticality/mandatory flags, evidence counts (total/pending/approved/rejected), and a detail view (full text, section, evidence requirements, per-evidence review status + AI confidence).
- **What it shows — Evidence.** Stats (Total/Pending/Approved/Rejected), a status filter (default "pending"), and evidence rows with **Approve / Reject** actions (permission-gated `auditor_portal:evidence_review:approve|reject`), review notes, and a **preview** panel. Reviews post to `/certifications/evidence/{id}/review`.
- **Notable.** Shareable per-tab URLs, gauge-led audit posture, permissioned evidence approval, framework switcher.

### Internal Audit — `/auditor-portal/internal-audit`
- **Purpose.** Internal-audit workspace (moved here from Assessments). Reuses `ComplianceAssessmentsModule` opened to the **internal_audit** tab — line items are termed **observations**, scored on their own SLA timelines with domain accordions, closure roll-ups, and Excel upload/export as in the assessment detail.

---

### Cross-cutting notes for the redesign
- **Recurring patterns to unify:** radial score gauges (Recharts `RadialBarChart`), status-mix stacked bars, status/priority pills, KPI tile rows, right-side detail drawers/panels, domain accordions, and confirm modals appear in nearly every screen — a shared component kit would pay off.
- **Consistent status vocabularies** differ subtly per module (compliance statements: compliant/partial/non/na; assessments: complied/partially_complied/not_complied/in_progress/na; controls: not_started/in_progress/implemented/verified/na; effectiveness: effective/partial/ineffective/not_tested) — worth rationalizing visually.
- **AI touchpoints** recur: framework parse/classify, evidence-requirement generation, evidence recommendations, alignment matching, test procedures, CIS benchmark matching — a consistent "AI assist" visual treatment (sparkles + purple) is already partly in place.
- **Two assessment engines coexist:** the older `/framework-upload/assessment` (per-control gap assessment with its own charts) and the newer SLA-scored `ComplianceAssessmentsModule` (Excel-driven, used by `/compliance/assessments`, `/assessments`, and internal audit) — a redesign should clarify or converge them.

---

# Control Library

## Control Library

**Purpose.** The Control Library is the tenant's "single source of truth" for compliance controls: it takes the raw controls from ~30 regulatory frameworks (ISO 27001, NIST CSF/800-53, PCI DSS, SAMA, HIPAA, GDPR, DORA, SOC 2, etc.), AI-normalizes them so identical requirements shared across frameworks collapse into one "unified control," and lets the user browse, filter, review, extend, compare, and measure coverage of that de-duplicated library. The recurring mental model throughout is **raw framework controls → deduplicated into unified controls (shared + unique) → grouped into control domains**.

**Information architecture.** The module lives inside a three-tab "control surface" switcher (`ControlSurfaceTabs`) that sits at the top of the primary screens:
- **Control Catalog** (`/controls`) — the working controls you assign/test/evidence (out of scope here).
- **Normalized Controls** (`/control-library`) — this module's home/list.
- **Assurance** (`/control-library/assurance`) — control-testing scorecard.

Only Assurance, Controls Overview, and Control Catalog are exposed in the left sidebar (under "Control Testing & Assurance"). The remaining screens — **domain detail, review, coverage, compare, gaps, evidence, templates, pipeline-lab** — are reached by in-page links or deep URLs and each carry their own "← back to Control Library" affordance. A redesign should consider promoting these analytics/utility screens into a coherent sub-navigation, because today they are effectively orphaned relative to the main nav.

Cross-cutting concept: **"Build your view"** — a framework-subset filter (a checklist dropdown of frameworks with per-framework counts) that appears on the list and the domain-detail screens. It re-scopes every count client-side (no server re-run) and is persisted in the URL (`?fw=…`) so views are shareable. There is also a **normalization "run/session" concept**: a master baseline (live library) plus disposable candidate/scoped sessions the user can switch to, promote, or delete.

---

### Unified Control Library (list) — `/control-library`

**Purpose.** The module landing page: browse the whole de-duplicated control library by domain, filter it to any subset of frameworks, and jump into a domain, review, or promotion.

**Information architecture.** Top control-surface tabs (Library active). Header links out to **Review Master List** (`/control-library/review`) and **Promote to Catalog** (`/controls?promote=1`). Domain cards drill into the **Control Domain Detail** (`/control-library/[id]`), carrying the framework filter through the URL.

**What it shows (data).**
- **Hero banner** (primary color): title "Unified Control Library," a live status pill (either "Active library · N unified controls" or, when filtered, "Filtered · X controls → Y unified · Z duplicates merged"), the "Build your view" framework picker, and a chip strip: **N domains · N unified controls · N frameworks**, plus an "AI-normalized" note.
- **5 stat tiles:** Control Domains, Unified Controls (with "from X framework controls · Y duplicates merged" subtext), Frameworks Covered, **Shared** (required by 2+ frameworks), **Unique** (required by one framework). All re-compute when a framework filter is active.
- **Reconciliation explainer card** (emerald, only when dedup > 0): a plain-English "Why N, not M?" with a visual equation — *framework controls − duplicates = unified controls*, then *unique + shared = unified*. This is a signature teaching element.
- **Toolbar:** search (name/code), Category filter, Domain filter (both multi-select, derived from real data), "Show empty groups" checkbox, and a **cards/table view toggle**.
- **Card view:** per-domain cards showing name, control count, "shared" vs "unique" pills, completion accent, and hover actions (view / edit / generate AI summary / delete).
- **Table view:** columns Code, Name (+description), Category, Domain, Controls (count), **Completion** (progress bar, 0–100% derived from metadata richness), Actions.
- **Pagination** (200/page, so each domain shows complete).
- **Empty state:** "No control groups found" with Create Group / Auto-Group CTAs. **Loading:** full-page loader. **Error:** retry.
- **Background/session banners:** a persistent **master-baseline build** progress bar (with Stop) and a persistent **"Building Unified View" auto-group** job banner (progress %, Stop, "safe to leave this page") that survive dialog-close/reload.

**Primary actions & flows.**
- **Build your view** (framework subset filter) — lazily pulls per-domain framework breakdown, then filters everything client-side; drives all counts and the reconciliation card.
- **Session management:** switch to a scoped/candidate run, **Delete session**, **Promote to baseline** (candidate → live).
- **Create / Edit control group** (modal form: code, name, description, category, domain with datalist autocomplete).
- **Generate AI Summary** per group; **Delete** (confirm).
- **Build Unified View** modal (framework checklist → dispatched background job with phased progress %, auto-closes on completion, shows unified/standalone/total result tiles).
- **AI Similarity Analysis** modal (framework checklist → analysis result tiles: controls analyzed, mappings created, groups created, status). *(Some build/populate actions are code-commented — the library is treated as seeded and locked, browsed rather than built.)*

**Notable features.** AI auto-grouping and AI summaries; URL-persisted shareable filter; background jobs with cancel; candidate-vs-baseline promotion workflow; the reconciliation/teaching UI.

---

### Control Domain Detail — `/control-library/[id]`

**Purpose.** Drill into one control domain to see how its controls normalize across frameworks, inspect each unified set's members/evidence/artifacts, and upload evidence once to satisfy all member frameworks.

**Information architecture.** Reached from the list (filter carried via `?fw=`). "← All control domains" back-link. Three in-page tabs; a right-slide detail panel for a selected set; framework-level templates were moved out to `/control-library/templates`.

**What it shows (data).**
- **Domain banner:** domain name, sentence summary (N controls from M frameworks; X normalized sets; Y unique), framework chips (first 8 + overflow), and a filter pill when scoped.
- **6 stat cards:** Controls grouped, Frameworks represented (e.g. "24/30"), Normalized sets, Standalone, Normalized evidence, Artifacts — all react to the framework filter.
- **Collapsible "Framework coverage in this domain"** (unfiltered only): explainer + a **"Not in this domain"** table (Framework | Covered in [count] | Domains where its controls live) — reframes absent frameworks as "not missing, covered elsewhere."
- **Tabs:**
  - **Normalized sets** (grid or table): each set = a shared requirement. Table columns: Normalized requirement, Frameworks (chips), # Frameworks, Evidence count, Artifacts count. Cards show member count, framework chips, and evidence/artifact counts.
  - **Standalone** (master-detail): left list of frameworks by count → right pane lists that framework's unique controls (code, title, evidence/artifact badges).
  - **By framework** (master-detail): each framework's controls in this domain, tagged "in set: …" (normalized) or "standalone," with normalized/standalone counts.
- **Toolbar:** "Build your view" framework filter (with a disabled "no controls of this type" section), search, grid/table toggle.

**Primary actions & flows.**
- Open a set → **right slide-over panel** with sub-tabs: **Frameworks** (one control per framework, original titles; under a filter, "your view" members highlighted and others collapsed under "Also normalized with…"), **Evidence** (recommended list), **Artifacts** (click to **download a generated Word .doc starter template**), **Upload evidence** (drag/drop; uploads once and auto-links to all member controls across frameworks; shows uploaded list + recommended evidence).

**Notable features.** One-upload-satisfies-many evidence linking; client-generated document templates; filter-aware "your view vs also-normalized" member display.

---

### Master List Review — `/control-library/review`

**Purpose.** Human QA of the AI-normalized library: approve correct unified controls or remove a member that doesn't belong, to drive the library toward 100% correctness.

**Information architecture.** Standalone screen, back-link to library. Status filter tabs.

**What it shows (data).**
- **Header progress tile:** approved percentage and "X / Y approved."
- **Filter tabs with counts:** All, Pending, Flagged, Approved.
- **Review cards** (one per unified control): code, status badge (approved/flagged/pending), name, "N controls · M frameworks," and a two-column grid of **member controls** (framework · code · title).
- **Empty/loading** states ("Loading…" / "Nothing here.").

**Primary actions & flows.** Per card: **Approve** (green) or **Flag** (amber); per member: **remove** (×) "this control does not belong here." All mutate and refresh the queue.

**Notable features.** Lightweight approval queue — a good candidate for bulk approve and keyboard-driven review in a redesign.

---

### Control Testing & Assurance — `/control-library/assurance`

**Purpose.** A weighted scorecard of the tenant's control-testing posture: are controls tested, operating effectively, and re-tested on time.

**Information architecture.** Control-surface tabs (Assurance active). The body is the reusable `ControlAssuranceOverviewCards` scorecard (same shape as other module overviews; feeds the main dashboard's assurance card). Section cards open a formula-detail modal; a weight-tuner modal adjusts section weighting.

**What it shows (data).**
- **Performance hero:** overall score ring + grade badge, "N controls under assurance · 3 weighted areas," and three mini section bars (Coverage / Effectiveness / Quality) each with an 85-target marker. "Adjust weights" button.
- **Posture Radar:** 3-axis radar (Coverage, Effectiveness, Quality) plotting score vs the dashed **85 target**.
- **Needs Attention list:** Controls not tested, Overdue control tests, Key controls not effective — each with a count (colored when > 0), total badge.
- **Three section formula-cards:** each with score, band label (weak/fair/strong), weight ("X% of assurance score"), and a **zoned column mini-chart** (per-metric bars over red/amber/green bands with the 85 reference line). Hover reveals "click for the N formulas."
- **Loading:** skeletons.

**Primary actions & flows.** Open a section → **Section detail modal** (metric formulas). Open **weight tuner** to re-weight sections and re-score. Attention items link back into the library/controls.

**Notable features.** Configurable weighted scoring with an explainable formula drill-down; consistent scorecard pattern shared across modules.

---

### Compliance Coverage Matrix — `/control-library/coverage`

**Purpose.** Show how well evidence covers controls across every framework and category, and quantify audit-effort savings from evidence reuse.

**Information architecture.** Standalone analytics screen, back-link to library, Export menu.

**What it shows (data).**
- **5 compact stat tiles + a coverage ring:** Overall Coverage % (with covered/total), Fully Covered (frameworks at 100%), Categories with Gaps, Evidence Items, and a `ProgressRing` of overall coverage.
- **Two charts:** a horizontal **bar chart** "Framework Coverage Comparison" (coverage % per framework, red/amber/green by threshold, "show more" beyond 5), and a **radar chart** "Coverage Distribution" with custom per-segment threshold coloring.
- **Framework Coverage Details:** expandable rows per framework (code, name, coverage ring, covered/total) → expanded **Coverage by Category** bars (category name, progress bar, %, covered/total).
- **Empty state** ("No coverage data yet"), **loading skeletons**, **error** card.

**Primary actions & flows.** **Export as CSV** (framework × category × coverage). Expand/collapse framework rows. Drill visually via charts.

**Notable features.** Framework de-duplication logic; bespoke recharts theming (segment-colored radar). Purely read/analytics.

---

### Framework Comparison (Crosswalk) — `/control-library/compare`

**Purpose.** Build a crosswalk between two frameworks — map each source requirement to the equivalent destination requirement(s), with evidence recommendations — via a fast keyword pass or an AI comparison.

**Information architecture.** Standalone screen, back-link, Export CSV. Two comparison **modes** (Quick/keyword vs AI) share one results table area; a "previously mapped pairs" list gives instant cached access before any comparison is triggered.

**What it shows (data).**
- **Selector card:** Source Framework and Destination Framework searchable dropdowns (mutually exclusive; show control counts), **Quick Compare** and **AI Compare** buttons.
- **3 stat tiles:** Available Frameworks, Source Controls, Mapped Controls.
- **AI mode results:** header with model used + progress ("X/Y controls processed"), a **progress bar** for queued/running (job runs in background, cached per pair), then a table: Source Ref, Source Requirement, Source Domain, **AI Mapped Destinations**, **Top Confidence %**, Evidence. Rows expand to show per-destination confidence, rationale, and evidence bullets. Empty state when nothing clears the 0.5 confidence threshold.
- **Keyword mode results:** table with Source Ref/Requirement/Domain, **Dest Ref(s)** with a **match-type badge** (Category / Domain / Keyword / Heuristic), Dest Requirement/Domain, Evidence, and a per-row **AI** button. Rows expand into Source Details / Mapped Requirements / Evidence Recommendations (+ inline AI mapping result if requested). Paginated (50/page).
- **Shared table toolbar:** search (clause/title/domain), sort field (Reference/Title/Domain/Matches) with asc/desc toggle, result counts.
- **Previously mapped pairs list** (pre-trigger): source → dest, match count / status badge, date; click reopens cached run.
- **Idle empty state:** large "Framework Crosswalk Comparison" explainer.

**Primary actions & flows.** Pick two frameworks → **Quick Compare** (instant keyword crosswalk) or **AI Compare** (Celery-backed background run, cached, Refresh to re-run). Per-row **AI map** in keyword mode. **Export CSV** of the crosswalk. Reopen cached runs.

**Notable features.** Dual keyword/AI engines; background job polling with per-pair caching; confidence scoring + rationale; CSV export.

---

### Evidence Suggestions & Reuse — `/control-library/evidence`

**Purpose.** Surface AI-recommended evidence types per control and show how much evidence is reused across frameworks (with the resulting audit-effort savings).

**Information architecture.** Standalone screen. Top-level "Bulk Generate" action; several analytics cards above an expandable recommendations table.

**What it shows (data).**
- **4 stat tiles:** Total Recommendations, Critical Priority (with pulsing indicator when > 0), Evidence Reuse Rate %, Audit Savings %.
- **Priority Summary card:** critical/high/medium/low bars with counts.
- **Evidence Types card:** clickable type chips with counts that filter the table.
- **Evidence Reuse Analytics:** 3 sub-stats (Total Evidence, Multi-Framework, Avg Controls/Evidence), a **Top Reused Evidence** table (Evidence Name, Controls Linked, Frameworks Covered), and an **audit-savings** callout (single-framework effort vs actual effort vs controls covered).
- **AI Recommendations table:** expandable rows — Control (code + name + framework), Evidence Type, **Priority badge**, **Confidence %**. Expanded row shows AI Reasoning, Description, and Sample evidence names. Search + priority filter + active type-filter chip. Paginated (20/page).
- **Empty/loading/error** states throughout.

**Primary actions & flows.** **Bulk Generate** modal: select control groups (checklist) → generate → progress (processing / complete "Generated N" / failed). Expand rows for reasoning. Filter by type/priority/search.

**Notable features.** AI reasoning + confidence transparency; reuse/savings analytics that quantify the value of normalization; bulk generation with progress.

---

### Gap Analysis — `/control-library/gaps`

**Purpose.** Find controls that lack evidence (or lack recommended evidence types) and close coverage gaps, framework by framework.

**Information architecture.** Standalone screen (amber-themed hero), Export menu, framework filter, two content tabs, and a full-screen framework drill-down modal.

**What it shows (data).**
- **Hero** with Export Report (JSON/CSV) dropdown.
- **3 stat tiles + coverage ring:** Without Evidence (with % covered), Critical Gaps, High Priority, and an evidence-coverage `ProgressRing`.
- **Framework Coverage table:** Framework (code + name + uploaded/legacy badge), Total Controls, With Evidence (green), Without Evidence (red), Coverage (ring), **Drill Down** action; rows are clickable.
- **Tabbed lists:** **Without Evidence** (Control Code, Name, Framework, Evidence=0, **Add Evidence** link → `/evidence?control=…`) with count badge; **Evidence Gaps** (per-control cards listing missing evidence types with priority severity badges and **Upload** links). Framework filter select (grouped uploaded vs legacy). "Showing 100 of N" truncation notices.
- **Empty states** are positive ("All Controls Have Evidence!"), **loading skeletons**.

**Primary actions & flows.** Click a framework row / Drill Down → **modal** with 4 stat tiles (Total, Unmapped, No Evidence, Low Coverage), a large coverage ring, and scrollable lists of **Unmapped Controls** (→ Map) and **Controls Without Evidence** (→ Add Evidence). **Export** JSON/CSV. Deep-links push users to the evidence/mapping flows.

**Notable features.** Uploaded-vs-legacy framework distinction; export; drill-down modal; action-oriented links that route to remediation.

---

### New-Framework Auto-Pipeline (Pipeline Lab) — `/control-library/pipeline-lab`

**Purpose.** A safe sandbox that automatically absorbs a newly added framework into the library — read → reconcile domains → normalize → build → evidence — and lets the user preview the result before keeping it; the live library is never touched until "Keep."

**Information architecture.** Standalone screen (violet-themed), back-link. State machine: **watching → running → done → error**. A manual seed-upload path plus an auto-detection watcher.

**What it shows (data).**
- **Upload card:** "Add a new framework seed (.json)" with ingest button.
- **Watching state:** "Library is up to date" (N frameworks live, spinner) OR "New framework detected — starting the pipeline…" with the pending framework(s) and control counts.
- **Running/Done timeline:** overall progress bar + message, then a **5-phase checklist** (Read, Domains, Normalize, Build, Evidence) each showing live per-phase numbers (e.g., controls/evidence/artifacts read; domains used + new; would-join vs standalone; candidate #; evidence merged; artifacts new/deduped) with done/active/todo states.
- **Done summary:** 4 stat tiles (Controls absorbed, Joined existing sets, New standalone, **New domains — want 0**, flagged red if > 0), evidence/artifact normalization strip, a domains-reconciled callout, and a **Mock (sandbox) library** comparison: live vs mock entry/domain counts, a **per-domain composition table** (Existing | +From framework | Total), a **visible pipeline list** (each framework control → joined set or standalone, with domain tag), and an **artifact normalization list** (NEW vs DEDUPED).
- **Error state** with message + "Back to watching."

**Primary actions & flows.** Upload seed → auto-detect → auto-run phased job (polled). On done: **Export to Excel**, **Keep — make it live** (promote candidate), or **Discard** (delete candidate + upload). Resume/attach to an already-running or finished job instead of duplicating.

**Notable features.** Real-time phased job with live metrics; candidate/sandbox isolation ("your live library is untouched"); side-by-side live-vs-mock diff; Excel export; auto-detection watcher — the most complex, distinctive screen in the module.

---

### Framework Templates — `/control-library/templates`

**Purpose.** Provide ready-structured artifact/document templates for each framework, organized by assessment stage, to download or turn into a working copy.

**Information architecture.** Standalone screen (amber gradient hero), back-link. Two-pane layout: a framework picker (left) and the artifact catalog (right). The catalog itself is the shared `ArtifactsTab` component keyed to the selected framework.

**What it shows (data).**
- **Hero** explaining "**Template** = download a file to fill in; **Create** = a working copy you can edit & track."
- **Left rail:** searchable framework list (alphabetical, first selected by default).
- **Right pane:** the selected framework's document/artifact catalog (via `ArtifactsTab`), grouped by assessment stage, with tenant users available for assignment inside the catalog.
- **Loading** ("Loading frameworks…") and **empty** ("Pick a framework…") states.

**Primary actions & flows.** Select/search a framework → browse its templates → **Template** (download a starter file) or **Create** (instantiate a tracked working copy, assignable to a user).

**Notable features.** Framework-scoped, stage-organized document library reusing the compliance ArtifactsTab; assignment of created documents to tenant users.

---

# Assets, Vulnerabilities, Security Posture & CIS

This brief documents every route screen in the four modules, in designer terms: purpose, information architecture, the concrete data shown, primary flows, and notable features. It is written for a redesign, so data and flow are described in detail.

A recurring pattern across all four modules is the **"Workspace" shell**: a KPI stat-tile strip, one or two distribution charts, a compact filter/action toolbar, and a data table below. Assets and Vulnerabilities share this pattern almost verbatim.

---

## Assets (IT Asset Inventory)

**Purpose.** Maintain the organization's inventory of applications, infrastructure, data stores, cloud resources and third-party systems, with CIA ratings, derived criticality, ownership, lifecycle, and links out to vulnerabilities, controls, evidence, CIS compliance and risk posture.

**Information architecture.** The module is a register (`/assets`) → asset detail (`/assets/[id]`). A separate sub-area, Criticality Assessments (`/assets/criticality-assessments`), carries its own tabbed workspace, an analytics page, and a print view. The asset detail page cross-links into Vulnerabilities, Risk Posture and CIS scans; criticality assessments deep-link back into the asset. Note: criticality is auto-derived (ISO 27005 style) from CIA + exposure inputs, not free-typed.

### Asset Register — `/assets`
- **Purpose.** Browse, filter, add, import and drill into the full asset inventory.
- **What it shows.**
  - An **Inventory Scorecard** banner at the very top (portfolio-level inventory health widget).
  - **KPI strip (5 tiles):** Total assets · Critical · Need CIA (assets missing C/I/A ratings) · CDE / PCI (cardholder-data-environment assets) · Stale > 30d (not observed in 30 days).
  - **Two charts:** a segmented "assets by criticality" mix donut (critical/high/medium/low), and a "Assets added over time" stacked-bar chart (last 6 months, stacked by criticality).
  - **Toolbar:** search (name/description/vendor) + four single-select facet dropdowns — Type, Criticality, Status, Lifecycle — plus Template / Import / Add Asset buttons on the right. (Additional client-side filters exist for data classification, stale-only, and discovery source.)
  - **Register table (DataTable):** columns Asset (letter-tile + name, with a red **CDE** chip) · Type (pill) · Owner · Criticality (pill) · CIA (mini meter of the three ratings) · Status (pill) · Lifecycle (dot indicator) · Last seen · row actions (⋯). Paginated at 15/page, sticky header, exportable, empty state "No assets match the current filters."
  - Loading = full-page loader; error = "Failed to load assets."
- **Primary actions & flows.**
  - **Add / Edit asset** opens a right-hand **slide-over drawer (780px)** — a dense form: name/description, asset-type picker (5 icon tiles), Primary Component + IP, **OS / Product picker** (drives CIS benchmark matching, sourced from the OS Knowledge Registry), sub-component chips + custom, vendor/location/network-segment combo-boxes, asset value, PCI-DSS/CDE toggle (reveals PCI attribute fields), **CIA rating selectors (1–5 each)**, data classification, internet-facing toggle, business-function picker, and a **live "system-calculated criticality" preview** (badge + score /10, recomputed via debounced API) with an override checkbox that requires a reason.
  - **Import** opens a CSV import modal; **Template** downloads the CSV template.
  - **Row actions menu:** View, Connect (launches the integration Connect Wizard pre-filled with host/platform), Edit, Delete (confirm).
  - **Bulk-connect:** row selection enables a "Connect selected" bulk bar (dark) that opens the Connect Wizard for multiple assets sharing one platform.
- **Notable features.** Live derived-criticality preview; OS-registry-driven benchmark matching; per-browser dismissible onboarding guidance card ("X of N assets connected"); bulk-connect; CSV import/template.

### Asset Detail — `/assets/[id]`
- **Purpose.** The single asset's authoritative context plus all its linked work (risks, vulns, controls, evidence, compliance, criticality).
- **Information architecture.** A **two-column layout**: a **pinned left "context rail"** that never scrolls away, and a **right work column** with a lightweight in-column section switcher (replaces a top tab strip). Sections: **Trajectory** (default) · Vulnerabilities · Risks · Controls · Evidence · Compliance · Criticality Assessments · Mapping Recommendations.
- **What it shows.**
  - **Header bar:** back arrow, asset icon, name + description, and type/status/criticality pills.
  - **Left context rail (stacked cards):** an actions card (Edit, Lifecycle, Assess Risk, Create Issue, "CIS scans" link, "Risk posture" link, Delete); identity card (icon, name, type, description, criticality/status/internet-facing/data-classification pills); **CIA Ratings** bars (C/I/A, 1–5); **Posture** stats (control coverage %, CIS composite %, risk score, derived criticality badge, last-assessed date); **Ownership** chain (primary/secondary/business owner, owning team, escalation contact); **Lifecycle & context** (lifecycle state pill, data classification, network segment, last observed / staleness indicator).
  - **Right column sections:**
    - **Trajectory** — an interactive node graph (Asset → Vulnerability → Risk); click a node to trace its sub-chain. Rendered as a canvas/flow map.
    - **Vulnerabilities / Risks / Controls / Evidence** — each lists the asset's linked records with link/unlink pickers; the Risks section also embeds a "Linked Issues" panel. Controls distinguishes internal, framework and normalized controls with coverage status.
    - **Compliance** — the CIS "room scan" Host-Applications panel + a ComplianceTab (benchmark matching, AI classification, scan sessions, IP-peer composite scoring).
    - **Criticality Assessments** — the asset's ISCA/IACA assessments.
    - **Mapping Recommendations** — AI-suggested control/framework mappings.
- **Primary actions & flows.** Edit (large centered modal with owners, lifecycle, CIA, classification, compliance scope, teams); **Lifecycle transition modal** (moves through a state machine; decommissioning auto-closes linked vulns; shows rejection reasons); Assess Risk (recomputes risk score); Delete (confirm); link/unlink controls, evidence, vulns; Create Issue.
- **Notable features.** Interactive trajectory graph; IP-peer composite CIS scoring; auto-linked vulnerability provenance badges; lifecycle FSM with cascade auto-close.

### Criticality Assessments — `/assets/criticality-assessments`
- **Purpose.** Score information systems and infrastructure assets against bank-provided criticality templates, with a multi-stage approval sign-off.
- **Information architecture.** Two tabs: **Information System (ISCA)** and **Infrastructure Assets (IACA)**. Header has an Analytics link and an "Import from Excel" button. Each tab is a table + a create/edit drawer; the drawer itself is tabbed (Fields · Comments · Evidence · Activity) when editing.
- **What it shows.**
  - **ISCA table:** Information System (name + address) · Linked Asset · Business Owner · Assessor · Total score (6–32) · Criticality band badge · actions (Edit/Delete). Empty and loading rows.
  - **IACA table:** Infrastructure Asset (name + make/model) · Linked Asset · Location · Custodian · Score (0.00–4.00, weighted) · Criticality band badge · actions.
  - **Drawer (create/edit):** a slide-over with sections — asset identity (name, linked IT-asset combobox that auto-fills fields, description, address, date), three **contact blocks** (Business/Service owner, Assessor; user-picker auto-fills name/designation/email/phone), **scoring criteria** (schema-driven selects per criterion, with weights), and comments. A sticky footer shows live **Total** + band badge. When editing, an **Approval Bar** and status pill appear; drawer content is locked while in review.
- **Primary actions & flows.** New ISCA/IACA item → drawer → save; **approval workflow** (draft → submitted → business-owner review → CISO review → approved/rejected/returned) via the ApprovalBar; per-item Comments, Evidence and Activity panels; **Bulk import from filled Excel template** (modal picks kind + file, reports imported count + row errors); **print** (footer action → dedicated print route). Deep-links: `?open=kind:id` opens a row's drawer, `?create=kind&asset=N` pre-fills a new item.
- **Notable features.** Bank-template-driven schema scoring; multi-tier approval with CISO gate; Excel round-trip; per-item evidence/comments/activity; asset-linkage auto-fill.

### Criticality Analytics — `/assets/criticality-assessments/analytics`
- **Purpose.** Portfolio view of assessment coverage, band mix and overdue approvals.
- **What it shows.** Back link + title. **4 KPI tiles:** Total assessments · Assets covered (X / N + coverage %) · Approved sign-offs · Overdue approvals (> 14 days in review). **Three chart cards:** Band distribution donut · By kind (ISCA vs IACA) donut · Approval-status mix (labeled progress bars). A **Top 10 by criticality** horizontal bar chart. An **Overdue approvals table** (Kind · Assessment · Current status · Days in review · Open→ deep-link back to the drawer).
- **Notable features.** SLA (14-day) overdue detection computed client-side; every chart has an empty state.

### Assessment Print View — `/assets/criticality-assessments/[kind]/[id]/print`
- **Purpose.** A chrome-free, print-to-PDF layout of a single ISCA/IACA assessment.
- **What it shows.** A document-style article: header (assessment type, name, total score, criticality band, status) then labeled sections — Identification, scoring criteria, contacts — with print CSS that hides sidebar/nav. Auto-opens the browser print dialog on load; a manual Print button is provided.
- **Notable features.** Native "Save as PDF" print styling; auto-print.

---

## Vulnerabilities

**Purpose.** A vulnerability register + remediation-management module: track findings by severity/status/SLA, assign to departments, enrich with real-world threat intelligence (CVSS/EPSS/KEV), manage exceptions, ingest scan reports, and run an approval/mitigation workflow per finding.

**Information architecture.** The main page (`/vulnerabilities`) is **tabbed**: Overview · Vulnerabilities · Departments · SLA Config. It also carries a **Standard ⇄ NCA Template** register-type switch. Several tabs also exist as **standalone routes** (`/vulnerabilities/dashboard`, `/departments`, `/sla`), plus dedicated routes for Exceptions, Reports, and detail pages (`/vulnerabilities/[id]`, `/vulnerabilities/nca/[id]`). The Overview tab embeds the standalone dashboard component verbatim.

### Vulnerability Register (main) — `/vulnerabilities`
- **Purpose.** The working register of vulnerabilities with KPIs, filtering, add/import, and bulk assignment.
- **What it shows (Vulnerabilities tab — VulnsWorkspace).**
  - **KPI strip (5 tiles):** Total · Open · Overdue · Critical · SLA compliance %.
  - **Three distribution donuts:** By severity · By status · By SLA (overdue vs on-track).
  - **Toolbar:** search (title/CVE) + Status + Severity facets + a "Show closed" checkbox (disabled when an explicit status filter is set) + **Standard/NCA register selector** + Template / Bulk Upload / Add buttons. A bulk-upload result toast appears under the toolbar.
  - **Standard register table:** Title · CVE · severity/status pills · owner · due date · actions (columns via a shared RegisterView). Row-select enables bulk-assign to a department.
  - **NCA register table:** an expandable-row table — Vuln ID · Title · CVE · Risk Level · Status · Owner · Due Date · Action(view). Expanding a row reveals the full NCA template field set (vendor link, threat analysis, threat/risk severities, likelihood, first-observation/resolution dates, comments).
- **Other tabs.** **Overview** = the full Security Overview dashboard (see next). **Departments** and **SLA Config** = the same content as their standalone routes below.
- **Primary actions & flows.**
  - **Add Vulnerability** = a right slide-over form with a **CVE auto-fill assistant**: typing a title (or CVE-ID / nickname like "Log4Shell") triggers a debounced lookup and an "Apply" banner that one-click fills CVSS/CVE/CWE/severity/description.
  - **Add NCA Entry** = an NCA-specific quick-add modal (NCA register mode).
  - **Bulk Upload** = a template chooser (Standard server-side CSV/Excel vs NCA workbook parsed client-side row-by-row) → hidden file input; reports created/skipped/error counts.
  - **Bulk assign** selected vulns to a department (modal).
  - Row click → detail page.
- **Notable features.** CVE/EPSS/KEV title auto-fill; NCA (Saudi) template register with expandable rows and legacy-bridge backfill; dual bulk-import paths; CSV template download.

### Security Overview (Dashboard) — `/vulnerabilities/dashboard` (also the "Overview" tab)
- **Purpose.** Executive, real-time vulnerability posture and threat intelligence.
- **What it shows.**
  - Header with refresh; **4 KPI cards:** Total · Critical/High · MTTR (days) · SLA Compliance % (with overdue count), each color-accented.
  - **Threat Intelligence & Real-World Risk section** (5 visuals): KEV-exposure donut (CISA actively-exploited) · Composite-priority bar (blends CVSS+EPSS+KEV+asset criticality) · EPSS exploit-likelihood horizontal bands · **Asset-criticality × severity stacked-bar matrix** · **Top 10 "Fix These First" table** (rank, vuln, CVE, priority, CVSS, EPSS, linked-asset count, KEV badge). Includes an enrichment-coverage readout and an empty/teaching state when nothing is enriched.
  - **Asset Risk Heatmap** — a treemap: rectangles sized by asset criticality, colored by total open-priority sum, KEV-affected assets outlined red, hover tooltip shows top vulns per asset.
  - **Trends & Historical Breakdown** — period chips (60d/90d/Quarter/2Q/1yr) + custom date range; discovered/resolved/status-change trends; and a **downloadable PDF/text report** for the selected window.
  - Additional derived charts: severity donut, status donut, aging bars, assignee donut, mitigation-coverage donut, department bar, SLA gauge, severity×status treemap.
- **Notable features.** Live 60s refresh; CVSS/EPSS/KEV enrichment analytics; treemap heatmap; PDF report export with custom date range.

### Departments — `/vulnerabilities/departments` (also a tab)
- **Purpose.** Manage the departments that own vulnerability remediation, their members and escalation paths.
- **What it shows.** Title + Create Department button; search; a **card grid** of departments (name, code chip, description, member count, vulnerability count, "View assigned vulnerabilities" expander showing up to 5 linked vulns with severity/priority pills). Empty state card.
- **Primary actions & flows.** Create/Edit department (modal); **Members modal** (add by user-id with role member/lead/head, escalation order, email-notification toggle; list with remove); **Escalation Paths modal** (ordered paths with target role, hour threshold, description). Per-card ⋯ menu (Edit, Members, Escalation Paths, Delete).
- **Notable features.** Escalation ordering + time thresholds; per-department vuln rollups.

### SLA Config — `/vulnerabilities/sla` (also a tab)
- **Purpose.** Configure remediation SLA timeframes per severity.
- **What it shows.** A table with a row per severity (critical→info): Severity pill · Remediation days · Notification days (before due) · Escalation days (after due) · inline edit actions. Unconfigured severities show "Not configured" + a "Set Default" link (defaults 7/30/90/180/365). Below: an **SLA Guidelines** explainer (three cards defining remediation/notification/escalation days).
- **Primary actions & flows.** Inline edit (pencil → number inputs → save/cancel); create defaults.

### Exceptions Queue — `/vulnerabilities/exceptions`
- **Purpose.** Review vulnerability risk-acceptance / exception requests through their lifecycle.
- **What it shows.** A card with a **state filter row** (all/requested/approved/denied/expired/revoked) and a count. A table: Vuln (ID link + title) · CVE · Severity · Priority (composite) · State badge · Requested date · Expires date · Justification (truncated). Empty state per state.
- **Primary actions & flows.** Filter by state; click a vuln to open its detail (where approve/deny/revoke happen). Read-only queue view.

### Vulnerability Reports — `/vulnerabilities/reports`
- **Purpose.** Upload and manage vulnerability scan report files.
- **What it shows.** Title + Upload Report button (xlsx/xls/csv). Table: Report (name + file name) · Uploaded date · Total · Critical / High / Medium / Low counts (colored pills) · actions (**AI Analyze** sparkle, Delete). Empty state; delete confirmation modal warns it also deletes imported vulns.
- **Notable features.** AI analysis of an uploaded report; upload cascades into the register + dashboard.

### Vulnerability Detail — `/vulnerabilities/[id]`
- **Purpose.** The full record for one finding: enrichment, remediation, links, workflow and exceptions.
- **Information architecture.** A long single-scroll page (not tabbed) of stacked section cards, with back nav and status/severity badges in the header. Many modals.
- **What it shows (sections).** Threat Intelligence panel (EPSS, percentile, KEV flag + date, NVD dates, exploit references, composite priority, **public-exploit / GitHub PoC** references, vendor **patch information**/PSIRT advisories); **Mitigations** (action list — title, type, status, priority, owner, target date, effort); **Linked assets** (with auto-linked provenance badges + link picker); **Controls** (framework/internal/normalized + CWE auto-mapping provenance); **Department** assignment; **Workflow** transitions + history timeline; **Vulnerability Chain** (prerequisites — add prerequisite flow); **AI Recommendation** (formatted remediation guidance, savable); **Exception** workflow (request/approve/deny/revoke with justification + compensating controls + expiry); Related Issues.
- **Primary actions & flows.** Change status modal; add/edit mitigations (detail modal with updates); assign department modal; execute workflow transition (with required comment/approval); add prerequisite; request/approve exception; create issue; sync patch info; generate/save AI recommendation.
- **Notable features.** Deep threat-intel enrichment (CVSS/EPSS/KEV/PoC/PSIRT); vulnerability-chain prerequisites; state-machine workflow with history; AI remediation; full exception lifecycle.

### NCA Vulnerability Detail — `/vulnerabilities/nca/[id]`
- **Purpose.** Detail/edit view for an NCA-template (Saudi) vulnerability entry.
- **What it shows.** NCA-specific fields: identifier, title/description, vendor link, CVE number + score, affected technology/assets, threat analysis, **threat severity / risk likelihood / risk severity** numeric scores → **Risk Level badge** (Critical→Very Low), owner, status (OPEN/IN PROGRESS/ON HOLD/RESOLVED), first-observation/due/resolution dates, comments. **Linked assets & controls**, a **mitigation-actions list** (inline-editable rows: title, owner picker, due date, status, notes), and an **AI Recommendation panel** (summary, remediation steps, patching guidance, compensating controls, verification steps).
- **Notable features.** NCA risk-scoring model; inline mitigation-action editor; structured AI recommendation JSON rendering.

---

## Compliance Plugins — CIS Hardening

**Purpose.** A CIS-benchmark hardening engine: a library of read-only CIS rules for Windows/Linux/Cisco/Oracle/cloud hosts, executed against connected assets to produce immutable pass/fail evidence that feeds control scoring and risk posture.

**Information architecture.** The main page (`/compliance-plugins`) is **tabbed**: Plugin Library · Assets · Recent Runs · Import CIS PDF · (Import JSON, advanced/hidden). Supporting routes: plugin detail (`/[id]`), Rule Library tree (`/library`), AI Pre-Classification (`/classify`), OS Knowledge Registry (`/os-registry`), CIS PDF Ingest (`/ingest`, also the Import tab), and per-asset coverage (`/asset/[id]`). Permission tiers gate actions: **Scanning Admins** can scan; **Tenant Admins** additionally import PDFs and approve/disable rules.

### CIS Benchmark Plugins (main) — `/compliance-plugins`
- **Purpose.** Browse the rule library, scan assets, and monitor team scan coverage.
- **What it shows.**
  - Header with a **Scan All** button (gated + confirmation modal listing rule count and target hosts).
  - A **pre-integration empty state** when no host connections exist (points to the Connect Wizard) while still letting the user browse rules read-only.
  - An **All-team / Mine** view toggle.
  - **KPI strip (5):** Total Rules (in current filter) · Critical · High · Pending Review · **Your Pass Rate** (passed / total approved rules).
  - **Per-user activity panel:** per-teammate coverage rows (avatar, name/email, pass/fail progress bar, passed/total, pass %). "Mine" shows only you; "All team" shows everyone else.
  - **Tabs:**
    - **Plugin Library** — severity chips + runner chips (Windows/Linux/Cisco/Oracle/AWS) + benchmark dropdown; a **Table or Cards** view toggle; each rule shows rule-id, title, benchmark, runner badge, severity badge, run stats (Passing/Failing/Needs review + run count, or "never scanned"), approved/pending status, and a "Run check" action. Bulk-select rows → Approve/Disable bar (Tenant Admin only). Empty state prompts a PDF upload.
    - **Assets** — lazy-loaded assets panel (per-asset scan overview).
    - **Recent Runs** — a runs table (When · Plugin · Asset · Triggered by · Status · Summary · Evidence Hash), scoped by Mine/All-team, auto-refreshing every 4s.
    - **Import CIS PDF** — the ingest workflow (see `/ingest`).
- **Primary actions & flows.** Run a single check (RunPluginModal picks asset/connection); Scan All (tenant-wide, progress modal driven by polling since the proxy times out on long scans); bulk approve/reject rules; import PDF.
- **Notable features.** Live scan-progress modal (poll-driven, idle-detection auto-close); per-user/team pass-rate coverage; evidence-hash immutability; permission-locked actions (🔒 tooltips).

### Plugin Detail — `/compliance-plugins/[id]`
- **Purpose.** Inspect one CIS rule and its run history.
- **What it shows.** Rule title/id, severity, benchmark, runner type, description/rationale/remediation, and result tables (run history). (Anchored from library links as `#plugin-{id}`.)

### Rule Library — `/compliance-plugins/library`
- **Purpose.** Browse the entire CIS catalogue as a deep hierarchy and see which assets each rule applies to.
- **What it shows.** Title + description; links to "My runs & team activity". **Two stat cards:** Total rules · Unique benchmarks. Filter input + "Include EOL OS" toggle + Expand/Collapse all. A **lazily-loaded tree**: Family → Product → Build (build/EOL badges) → Benchmark → Section → Subsection → Rule. Rule rows show rule-id, title, severity badge, "AI tagged"/"Manual" chips, and a **Run check** (or **Attest** for manual rules) button.
- **Primary actions & flows.** Expand nodes (sections/rules fetched lazily); click a rule to open the **AI Verdict drawer** — shows the AI's judgment of how many tenant assets the rule applies to (count, reasoning, confidence), the matching asset list, and per-asset Run (or Pass/Fail/N-A attest for manual rules) plus "Run on all".
- **Notable features.** 7-level lazy tree; AI applicability verdict per rule; manual-attestation path with Pass/Fail/N-A.

### AI Rule Pre-Classification — `/compliance-plugins/classify`
- **Purpose.** Trigger and watch the job that tags every CIS benchmark with the OS keys it applies to.
- **What it shows.** **4 stat cards:** Total rules · Already classified · Unique benchmarks · Last run. A "Run classification sweep" control (Run / Re-classify / Stop) with a **live progress bar** and a **live SSE ticker** streaming each benchmark as it's tagged (source badge: Regex vs AI vs Unknown, OS keys assigned, and AI reasoning). A summary card (regex/AI/unknown counts).
- **Notable features.** Server-sent-events live streaming of AI reasoning; two-stage (deterministic regex then gpt-4o-mini) classification.

### OS Knowledge Registry — `/compliance-plugins/os-registry`
- **Purpose.** The canonical ground-truth list of every OS family/product/build the system recognizes, mapped to rule and asset counts.
- **What it shows.** Title + description; Family filter + "Show end-of-life" toggle + entry count. A **grouped table** (parent OS rows with nested build rows): Display name · Normalized key · Family · Build · Support (Supported/EOL + year) · Plugins count · Assets count · Benchmark hint.
- **Notable features.** Parent/child OS grouping; live plugin + asset counts; EOL flagging.

### CIS PDF Ingest — `/compliance-plugins/ingest` (also the Import tab)
- **Purpose.** Upload CIS benchmark PDFs, watch extraction, and review/approve extracted rules.
- **What it shows.** A file uploader; an **ingest-jobs list** (filename, benchmark label, status, page count, rules extracted/inserted/updated/flagged/TOC-rejected, OCR pages, timestamps, error text) auto-refreshing every 5s. A **review queue** of extracted rules (rule-id, title, severity, runner, confidence score, level, audit steps, description, references, auto-generated-check flag) scoped to the selected job.
- **Primary actions & flows.** Upload PDF → auto-focus the new job's review queue; per-rule **expandable editor** (edit title/severity/runner/check-definition JSON/description) → Approve (with edits) or Reject; JSON validation with inline errors.
- **Notable features.** PDF parsing with OCR fallback; confidence-scored review queue; inline check-definition JSON editing before approval.

### Per-Asset Compliance Coverage — `/compliance-plugins/asset/[id]`
- **Purpose.** One asset's full CIS scan coverage and rule-by-rule results.
- **What it shows.** Back link + "Scan this asset" button. Asset header (OS family, name, host/IP chips, owner, status, criticality pill, CIA readout). **5 KPI cards:** Pass Rate % · Passed · Failed · Errored · Last Scan (+ never-run count). Filters: status chips (All/Passed/Failed/Errored/Never run) + severity chips + search. A **paginated rules table** (50/page): Rule ID · Title (+ failure summary) · Severity · Status · Last Run · Action(View). Empty states for "no rules in library" vs "no match".
- **Primary actions & flows.** Scan this asset (progress modal, poll-driven); filter/search/paginate; view a rule's run.
- **Notable features.** Poll-driven scan-progress modal; per-asset pass-rate rollup.

---

## Risk Posture

**Purpose.** A composite, per-asset risk score (0–100, higher = more risk) that blends five weighted dimensions — CIS compliance gap, vulnerabilities, CIA value, control-coverage gap, and linked risks — with a human-in-the-loop "effective vs scanner" triage lens for vulnerabilities.

**Information architecture.** A portfolio dashboard (`/risk-posture`) → per-asset breakdown (`/risk-posture/asset/[id]`). A tenant-wide **Tune Weights** panel (Tenant-Admin-only) adjusts how each dimension contributes. The asset page cross-links to CIS details, vulnerabilities, and asset control-linking.

### Risk Posture Dashboard — `/risk-posture`
- **Purpose.** See composite risk across all assets, filter by band, and drill in.
- **What it shows.**
  - Header (shield icon, title, "higher means more risk") + **Tune weights** button (locked for non-admins).
  - **Executive hero:** a **radial portfolio gauge** (average risk /100, colored by severity) with "X of N assets scored · Y unknown", beside a **band-distribution card** — a stacked distribution bar + four **clickable band cards** (Critical 75–100, High 50–74, Moderate 25–49, Low 0–24, each with count and score range) that filter the table, plus a highest-risk callout.
  - **Search + sort toolbar** (search name/host/type; showing X of N; clear filters).
  - **Asset table:** Asset (name link + criticality) · Host · **Risk Score** (number + band pill) · **Breakdown** (a 5-series stacked contribution bar: CIS/Vuln/CIA/Ctrl/Risk with a legend) · CIS pass-rate % · Vulns (active/total) · Risks (active/total) · Ctrl coverage % · Action(view). Sortable columns; "No data / Onboard to measure" states; rich empty state directing to IT Assets.
- **Primary actions & flows.** Click a band card to filter; sort; open an asset; open the **Tune Weights** panel (admin) to reweight dimensions tenant-wide.
- **Notable features.** Auto-refresh every 30s; inverted (risk) color scale; clickable band filtering; weight tuning gated to Tenant Admin.

### Asset Risk Breakdown — `/risk-posture/asset/[id]`
- **Purpose.** Explain one asset's composite score and let the operator adjust business-impact inputs and re-triage its vulnerabilities.
- **What it shows.**
  - Header: back arrow, asset identity (type, name, host/IP chips, owner, criticality), and a large **score /100 + band pill + data-quality %** (known dimensions X/5).
  - **IP Group composite** card (when the asset shares an IP): a formula explainer (60% host OS + 40% criticality-weighted app average, with penalties/weakest-link) and per-asset rows with CIS scores and "posture→" links.
  - A **"Business impact & scoring inputs"** card that opens a modal: customer-facing / internet-facing toggles (with multipliers), regulated-data-type select, operational-dependency radio (with plain-language meanings + multipliers), C/I/A sliders, and audit notes — beside a **live preview** panel (current vs after-your-changes score, delta, and per-vulnerability re-scoring). Unsaved-changes indicator + Save.
  - **Score breakdown** bar: the 5-dimension stacked contribution bar with a legend showing each dimension's weight % and points (dimmed when "no data").
  - **Per-vulnerability risk breakdown** card → opens a **Triage Lens** modal: a mode switch (**Scanner CVSS** / **Effective** / **Compare side-by-side**), an "Ignore EPSS+KEV" toggle, side-by-side ranked tables with **rerank arrows (Δ rank)**, a "why priority changed" callout, and detailed per-vuln cards showing the weighted formula (CVSS/EPSS/KEV/CIA/business-impact) and escalation reasoning.
  - **Four dimension panels:** CIS Benchmark (pass rate, passed/failed/never-scanned, link to CIS details), Vulnerabilities (active count, severity breakdown, severity-weighted points, link to vulns), CIA Criticality (C/I/A values or "missing"), Control Coverage (% + linked/target count, link to link controls).
- **Primary actions & flows.** Edit business-impact inputs with live preview → save (recomputes score); switch triage lens; toggle exploit-signal weighting; navigate to CIS/vulns/controls.
- **Notable features.** Live preview of score change before saving; per-vulnerability "effective vs scanner" reranking with explanations; IP-group composite scoring; transparent weighted-formula cards; escalation floor logic.

---

**Cross-cutting design notes for the redesign.**
- The **Workspace shell** (KPI strip → charts → toolbar → table) is duplicated across Assets and Vulnerabilities and is a strong candidate for a single shared, systematized component.
- **Slide-over drawers** (Add/Edit asset, Add vuln, assessment drawers) vs **centered modals** (edit asset, department, exception) are used inconsistently — worth unifying.
- **Detail pages diverge structurally:** Asset detail uses a pinned rail + in-column section switcher; Vulnerability detail is a long single scroll; Risk-posture asset uses cards-that-open-modals. A consistent detail-page pattern would help.
- **Permission-gated actions** appear throughout as 🔒 emoji + tooltips (CIS scanning, weight tuning, rule approval) — a systematized locked-state treatment is needed.
- **Poll-driven progress modals** (CIS Scan All / per-asset scan) exist because long scans outlive the proxy timeout — the redesign should treat long-running scan progress as a first-class pattern.
- Heavy use of **severity/criticality color ramps** (rose/orange/amber/emerald) and **stacked contribution bars** across modules — a shared data-viz palette and legend system is warranted.

---

# Evidence & Evidence Requirements

These two sibling areas cover the full lifecycle of compliance evidence: defining *what* evidence is needed (Evidence Requirements), *collecting and reviewing* it (Evidence workspace + detail), *measuring* how well controls are covered (Coverage), and *packaging* it for auditors (Audit Packages). They share one visual charter: single teal brand color (`primary-*`), category tints used only as status/type markers, hairline borders, no gradients, dense layouts.

---

## Evidence Management

**Purpose.** A central library where teams upload evidence files, let AI extract text (OCR) and score quality, map each item to controls/frameworks/risks/assets/incidents/policies, route items through a review→approval lifecycle, monitor coverage and freshness, and assemble finalized audit packages.

**Information architecture.** In the left sidebar this is one item — "Evidence Management" (`/evidence`). It fans out into four screens that are siblings under the `/evidence` path (reached via in-page links and the row/stat drill-downs, not a persistent tab bar):
- `/evidence` — the **Workspace** (default landing; has its own internal view-switcher: Workbench / Pipeline / Snapshot).
- `/evidence/[id]` — the **Detail record** (full single-item page).
- `/evidence/coverage` — the **Coverage Dashboard**.
- `/evidence/audit-packages` — the **Audit Package Builder**.

The workspace and detail preview reuse the exact same Quality-breakdown and OCR-content modals, so those overlays are identical wherever they appear. A note for the redesigner: the workspace code defines five views (Workbench, Register, Pipeline, Snapshot, Performance) but the live view-switcher only exposes **three** (Workbench, Pipeline, Snapshot). Register and Performance are built but not currently surfaced.

---

### Evidence Workspace — `/evidence`

**Purpose.** The home base where a user scans the whole evidence library, filters it, and drills into any item without losing context.

**Information architecture.** A persistent header of 4 stat cards + a toolbar (search, Status filter, Type filter, view-switcher segmented control, and an "Upload evidence" primary button). Below that, one of three interchangeable views renders over the *same* filtered dataset.

**What it shows (the data).**
- **Stat cards (4):** Total (count), Approved (as a %), Pending (count), Expiring (count within 30 days). Sourced from a summary endpoint with client-side fallback.
- **Filters:** free-text search (matches name, owner, uploader, source system); Status dropdown (Draft, Pending review, Approved, Rejected, Expired, Archived); Type dropdown (evidence types).
- **Workbench view (default):** a two-pane master–detail. LEFT = scrollable list of rows, each row = letter tile + name + "type · owner/department" meta + a status pill and expiry indicator (e.g. "12d left", "Expired 3d", color-toned). RIGHT = a sticky **DetailPreview** for the selected row containing: header (name, file · version · committee · owner, status pill, inline Approve button if pending); three tiles — **Quality score** (colored bar + %), **OCR** (status with spinner while processing), **Validity** (collection→expiry dates + expiry status); an **Applicable compliance frameworks** pill row (Linked vs Suggested, with counts); and a **Linked across modules** 6-cell stat grid (Controls, Frameworks, Risks, Assets, Incidents, Policies). Footer actions: Approve (if pending), Open file, Delete, "Full record →".
- **Pipeline view:** a horizontal kanban with 5 columns following the lifecycle — Draft, Pending review, Approved, Expired, Rejected — each with a count badge. Cards show letter tile, type, name, owner avatar, expiry, and a small "advance" affordance (Draft→Submit, Pending→Review).
- **Snapshot view (board/committee readout):** headline **Approval rate** big number + delta vs 6 months ago; a **donut** of status split (Approved/Pending/Draft/Expired/Rejected) with legend; a **6-month "Added vs Approved" line sparkline** (two thin lines, teal/slate); 3 action tiles (Approved this quarter, Pending review, Expiring soon); an **Expiring-soon watchlist**; a **Coverage-by-type** horizontal bar mini-chart (top 5 types); a full-width **Status-split segmented bar** with legend; and two clearly-labeled placeholder cards ("Top performers", "Coverage by committee") noted as pending backend data.
- **Loading/empty states:** "Loading evidence…" card; "No evidence to show" empty state per view. Rows auto-poll every 3s while any item is still OCR-processing so badges settle live.

**Primary actions & flows.**
- **Upload evidence** (primary CTA) opens a **modal**: drag-and-drop or click file zone (PDF/DOC/DOCX/XLS/XLSX/PNG/JPG; rejects .exe); fields for Name (required, auto-filled from filename), Description, Evidence Type, Owner (searchable user picker), Collection Date, **Validity Period** (presets 3mo/6mo/1yr/2yr or custom days), and **Source System / Linked Assets** (multi-select asset picker). On file drop it fires an **AI "quick assess"** that can auto-suggest the evidence type.
- Select a row → live preview swaps in place (no navigation). Approve inline, Open file (in-browser viewer), Delete (with a warning-confirm if the item is linked), or open the full record.
- Advance items through the pipeline; switch views without losing filters.

**Notable features.** AI quick-assessment on upload; live polling for OCR/assessment status; in-browser file viewer (image/PDF/xlsx/csv/markdown/text) instead of forcing navigation; the shared Quality & OCR modals; a "keep context" master-detail that is explicitly the headline UX pattern.

---

### Evidence Detail — `/evidence/[id]`

**Purpose.** The full single-item record where an owner/reviewer inspects one piece of evidence end-to-end: its file, AI quality assessment, control/framework mappings, cross-module links, lifecycle, and review decision.

**Information architecture.** A full-bleed workspace, not tabbed. Top bar (back button, type icon, name/description, type + status pills, and a cluster of action buttons). Below: a 4-tile context strip → a horizontal lifecycle timeline → a two-column body: LEFT (sticky) = "Links & coverage" panel; RIGHT (scrolling) = "AI quality assessment" + reviewer decision. A "Details" button opens basic-info/version-history in an overlay rather than a tab.

**What it shows (the data).**
- **Header actions (contextual):** Details, Edit, Delete, Submit for Review (draft only), OCR (if not yet completed), and a live "AI assessing…" chip.
- **Pending-review banner:** who submitted + when, with a link to Pending Approvals.
- **4 context tiles (clickable):** **Quality Score** (big %, colored progress bar, "meets/below 80% target" hint → opens quality breakdown); **Text Extraction (OCR)** (status pill + processed time → opens OCR content); **Validity Period** (collection→expiry, days remaining tone, click to edit); **Source File** (filename, type, version → opens file preview).
- **Lifecycle timeline:** horizontal stepper derived from the record — Uploaded → Text extracted → AI assessed (with %) → Submitted → Approval (always shown, "Awaiting · Pending" until approved). Green dot = done, hollow = pending.
- **Links & coverage panel (left):** header + a single "Link manually" entry point; **filter pills** per module (Controls, Policies, Assessments, Risks, Assets, Incidents) each showing linked count + a "+N" AI-suggestion badge; a **consolidated AI-suggestions feed** — all target types fanned out in parallel, each suggestion card shows a type badge, code, a colored "% match" chip, rationale, Dismiss and Link buttons, plus a "Link N strong matches" bulk action (≥80%). Detailed linked-records lists collapse below.
- **AI quality assessment (right):** content summary; a **Suggested clause mappings** table (columns: Framework, Control, Coverage type [full/partial/minimal/none, color-coded], Action = Link/Linked). Clicking a row opens a modal with the requirement text, "why this evidence matches" rationale, a confidence %, and a Link button. Quality breakdown modal shows Relevance / Adequacy / Confidence / Audit-readiness sub-bars + summary + assessed timestamp.
- **Reviewer decision panel** (visible to reviewers when pending): a note textarea + Approve / "Return for changes" buttons.
- **Details overlay:** Basic Information (description, source system, uploaded by/at, content summary), Review Comments (if any), and **Version History** list.

**Primary actions & flows.**
- **Edit** (modal: name, description, type, collection date, validity days, source system).
- **Submit for review** → routes to the approvals queue. **Reviewer** approves or returns with a note.
- **Process/re-process OCR**; **run/lock/unlock AI assessment** (assessment auto-runs once OCR completes; auto-populates the recommendation panels).
- **Link/unlink** to controls (framework→control pickers), risks, assets, incidents, and **policy statements** via a distinctive **two-stage modal** (pick a governance document → tick multiple statements, already-linked ones disabled). Bulk-link "strong matches."
- **Recommend-targets** panel: AI scans the tenant's governance documents, internal controls, and active compliance assessments and suggests where this evidence can be mapped/reused (each with a match % and deep link).
- **Delete** (force-confirm if linked). In-browser file preview.

**Notable features.** Heavy AI assist (auto-assess, clause mapping, cross-module link recommendations, recommend-targets); real-time polling (3s) while OCR runs; a novel document→statements two-stage linker; consolidated one-panel linking replacing per-section pickers; reused Quality/OCR modals shared with the workspace.

---

### Evidence Coverage Dashboard — `/evidence/coverage`

**Purpose.** A monitoring dashboard to see how completely controls are backed by evidence across frameworks, and to surface stale/expiring/low-quality items needing action.

**Information architecture.** Single scrolling dashboard with a framework filter in the header, a KPI row, a coverage heatmap, then paired action panels, and a legend.

**What it shows (the data).**
- **Header:** framework filter dropdown (All Frameworks + each framework).
- **5 stat tiles:** Total Controls, Controls with Evidence (+ coverage %), Controls without Evidence, **Stale Evidence** (with an animated ping dot when >0), Low Quality Evidence.
- **Coverage Heatmap:** per framework — code/name, a big coverage % (color-graded emerald/amber/orange/rose), "X / Y controls," a progress bar, and a wrap of up to 30 control chips (green = has evidence, rose = missing) with hover tooltips ("Has Evidence"/"Missing Evidence"), plus a "+N more."
- **Controls Without Evidence** table: Framework, Control (code + name), Action ("Add Evidence" → links to `/evidence`); shows first 10 of N.
- **Stale Evidence Alerts** list: name + "X days overdue"/"Marked as stale" with a per-item **Renew** button.
- **Expiring Soon** table (≤30 days): Evidence (name+type), Expiry (date + days remaining), Status pill (Critical ≤3d / Warning ≤7d / Expiring Soon).
- **Low Quality Evidence** cards (score <50%): a circular-gauge % ring, name, last-assessed date, and a "Review" link to the item.
- **Coverage Legend:** 80%+ Excellent / 50–79% Good / 20–49% Needs Improvement / <20% Critical.
- Per-panel loading spinners and cheerful empty states ("All controls have evidence!", "No stale evidence!").

**Primary actions & flows.** Filter by framework (re-scopes heatmap + orphan list); **Renew** stale evidence in one click (sets new collection date + 365-day validity); drill into a low-quality item to review; jump to upload from an orphan control.

**Notable features.** Control-level heatmap with hover tooltips; live "stale" pulse indicator; inline one-click renewal; SVG donut gauges for quality scores.

---

### Audit Package Builder — `/evidence/audit-packages`

**Purpose.** Assemble a curated, ordered set of approved evidence into a package that can be finalized (locked), exported as a ZIP for auditors, and legally held.

**Information architecture.** Master list (left, grows to full width when nothing selected) + a sticky **Package Details** side panel (right) on selection. Two modals: Create Package and an Add-Evidence selector.

**What it shows (the data).**
- **Header:** title + "Create Package" primary button.
- **Filter bar:** search (name/framework) + status dropdown (All / Draft / Finalized / Exported / Archived).
- **Packages table:** Name (+ description), Framework (pill), Audit Period (start–end w/ calendar icon), **Status** badge (Draft/Finalized[lock]/Exported[download]/Archived + a rose "Legal Hold" chip), Evidence count, and per-row **Actions** (View, Finalize [lock, draft only], Export ZIP [finalized/exported], toggle Legal Hold, Delete [draft & not-held]). Paginated (10/page).
- **Package Details panel:** name/description; grid of Framework, Status, Period Start/End, Created, Created By; an "Add Evidence" button (draft only); an **Evidence Items** list with up/down **reorder** controls and remove (draft only); and footer actions (Finalize / Export ZIP / Legal Hold toggle).
- **Empty state:** "No audit packages found" + "Create First Package."

**Primary actions & flows.**
- **Create Package** (modal: name, description, framework, audit period start/end).
- **Add Evidence** (modal): searches **approved-only** evidence, checkbox multi-select, already-added items disabled, "N selected" → Add Selected.
- **Reorder** evidence within a package (sequence up/down). **Finalize** locks it (guarded: needs ≥1 item, confirm dialog). **Export ZIP** triggers a download (finalized/exported only). **Legal Hold** toggle blocks deletion. **Delete** (draft, unheld only).
- Guardrails surfaced as toasts (can't delete non-draft/held, can't finalize empty, can't export non-finalized).

**Notable features.** Immutable finalize/lock workflow, ZIP export with auto-download, legal-hold compliance control, drag-style sequence ordering, access-log data model (present in the type; audit trail of who accessed the package).

---

## Evidence Requirements

**Purpose.** A review queue for **AI-generated evidence requirements** — for a chosen framework, the AI proposes what documentation each control needs, and compliance staff triage each proposal through submit → review → approve/reject.

**Information architecture.** One screen (`/evidence-requirements`), a separate top-level sidebar item ("Evidence Requirements"). It's framework-scoped: nothing shows until a framework is picked. Requirements are *generated* upstream via a "Generate Evidence Requirements" button on the Framework Controls page; this screen consumes and governs them.

### Evidence Requirements — `/evidence-requirements`

**What it shows (the data).**
- **Header:** title + "AI-generated evidence requirements for compliance controls."
- **Filter bar:** **Framework** selector (required; lists uploaded/parsed/published frameworks), plus Status (Draft/Submitted/Pending Review/Approved/Rejected), Priority (High/Medium/Low), and Evidence Type (Policy/Procedure/Configuration/Log/Report/Contract/Register/Attestation/Training/Screenshot) dropdowns, and a search box (by control ID or title).
- **4 stat cards** (once a framework is chosen): Total Requirements, Draft, Pending Review, Approved.
- **Requirements table** with expandable rows. Columns: Control (mono control ID + title), Evidence Title (+ a rose "Required" chip if mandatory), Type (colored category badge), Priority (color badge), Status (badge), Frequency, and Actions.
- **Expanded row detail:** a grid of Evidence Type, Collection Frequency, Retention Period, **AI Confidence** (% color-graded), Mandatory (Yes/No), Evidence Format; then Description, **Exact Requirements** (checklist), **Acceptance Criteria** (bulleted), Sample Evidence, Collection Guidance, a collapsible **AI Reasoning** section, a **Rejection Reason** callout (if rejected), and a footer of Created/Submitted/Approved dates.
- **States:** "Select a Framework" prompt (before choice); loading spinner; error state; and an empty state ("No Evidence Requirements") that tells the user to generate them on the Framework Controls page.

**Primary actions & flows.** A per-row **approval lifecycle** gated by edit permission: Draft → **Submit**; Submitted → **Review**; Pending Review → **Approve** (green) or **Reject** (opens a modal requiring a rejection reason). Approved/Rejected rows show a terminal status label. Filters and search narrow the list; clicking a row expands its full spec.

**Notable features.** AI-authored requirements with a visible **confidence score** and expandable **AI reasoning**; a mandatory/"Required" flag; structured acceptance criteria and collection/retention guidance per control; a lightweight multi-stage approval workflow with reason-tracked rejections.

---

# Work Management & Business Continuity

This brief covers four modules of the GRC SaaS platform: **Tasks** (Critical Task Management), **Issues** (Issue Management / CAPA), **IS Projects** (Information-Security Project Portfolio), and **BCM** (Business Continuity Management). Every route is documented in designer terms — purpose, information architecture, the actual data on screen, the primary flows, and anything distinctive. Colour language is consistent across modules: rose = critical/breached/overdue, orange/amber = high/at-risk, emerald = healthy/complete/on-track, and a teal "primary" brand accent for interactive/selected states.

---

## Tasks (Critical Task Management)

**Purpose.** A centralized register for tracking "critical tasks" — remediation and action items that originate from across the platform (audit findings, risks, controls, vulnerabilities, regulatory changes, committees, compliance frameworks) or are created manually — through an SLA-governed lifecycle to verified completion.

**Information architecture.** The module is a single route (`/tasks`) with a top tab bar of four tabs, all rendered inside one shell: **Task Board**, **My Tasks**, **SLA Configuration**, **Reports**. (`/tasks/my-tasks`, `/tasks/sla`, `/tasks/reports` also exist as standalone routes but are surfaced as tabs.) A task opens into its own full-page detail at `/tasks/[id]`. Lifecycle states: Open → In Progress → Under Review → Completed → Verified, with a Reopened path.

### Task Board — /tasks (default tab)
- **Purpose.** Browse, filter, triage, and create critical tasks across the org in either a table or a Kanban board.
- **What it shows.**
  - Header with a live count ("Centralized critical task management — N tasks").
  - A **view toggle** (Table / Kanban).
  - **Filter row:** free-text search, plus single-select dropdown filters for Source (Audit/Risk/Compliance/Vulnerability/Manual), Priority (Critical/High/Medium/Low), Status (6 states), Category (Remediation/Implementation/Review/Reporting/Other), and Owner (searchable user list). A "Clear" link appears when filters are active.
  - **Table view** columns: checkbox (row select), Title (with category + "via [source module]" subtext), Source, Priority (coloured pill), Status (coloured pill), Owner, Due Date, SLA (On Track / At Risk / Breached / Completed / No SLA, colour-coded). Sortable headers: Title, Priority, Status, Due Date.
  - **Kanban view:** six columns (one per status) with a top-border accent colour, per-column counts, and compact cards showing title, priority pill, SLA text, source, owner, and due date.
  - **Empty state:** target icon + "No tasks found / Create a new task to get started." **Loading:** centered spinner.
- **Primary actions & flows.**
  - **Bulk operations:** selecting rows reveals a "Bulk (N)" menu to set priority, set status (In Progress / Completed), or assign an owner.
  - **Create task** opens a right-side slide-over panel (780px) — see notable features.
  - **From Template:** modal listing task templates (System vs Custom badge, priority/category/SLA metadata) with one-click "Create Task."
  - **Drill-down:** clicking a task title/card navigates to the detail page.
- **Notable features.**
  - **AI Reprioritize:** button runs an AI pass and opens a modal of suggestions (current → suggested priority with justification); "Apply All Changes" writes them back.
  - **Create panel** is rich: a highlighted "Link Source" block letting the user attach any of Risk, Internal Control, Vulnerability, Regulatory Change, Committee, Compliance Framework, and (dependent) Framework Requirement, plus an **AI Generate** button that synthesizes title/description/category from the linked context. Also captures multi-owner assignment, reviewer, due date, **SLA Level** (auto-fills a day count from the SLA config), a Recurrence & Approval section (daily/weekly/monthly/quarterly + interval, "Requires Approval" checkbox), and evidence/notes.

### My Tasks — /tasks (My Tasks tab) / /tasks/my-tasks
- **Purpose.** A personal, priority-grouped worklist of tasks assigned to the current user.
- **What it shows.**
  - Subtitle "N active, M completed."
  - **Four stat tiles:** Total Active, Overdue (rose, count of SLA-breached), At Risk (amber), Completed (emerald).
  - A prominent **Overdue Tasks** callout list (rose) when any exist.
  - Tasks grouped into **priority sections** (Critical→Low), each a card list showing status pill, title, source·category, due date, SLA text, chevron.
  - **Recently Completed** section (up to 10, struck-through with completion date).
  - **Empty state:** "No tasks assigned to you."
- **Primary actions.** Read-only triage; every row links to the task detail.

### SLA Configuration — /tasks (SLA tab) / /tasks/sla
- **Purpose.** Define, per SLA level, the remediation deadline window (in days) that gets auto-applied when a task is created at that level.
- **What it shows.** A single table with rows for each SLA level (Critical, High, Medium, Low, Info — each a coloured pill with a dot), columns: SLA Level, Remediation (Days) with inline edit, Default (days), Actions. A "Customized" chip marks overridden values. Header has a "Reset to Defaults" button; an explainer card at the bottom.
- **Primary actions.** Inline edit a day value (Edit → number input → Save/Cancel), reset all to defaults. This is a tenant-level settings screen (persisted client-side config).

### Reports — /tasks (Reports tab) / /tasks/reports
- **Purpose.** Analytics and insight into critical-task throughput, SLA health, and workload.
- **What it shows.**
  - **Five KPI tiles:** Total Tasks, Overdue, Completion %, SLA Compliance %, Active.
  - **Tasks by Status** and **Tasks by Priority** — horizontal bar breakdowns (labelled % of total).
  - **Completion Rates by Source** — progress bars (completed/total, %).
  - **Overdue Aging Analysis** — rose bars by age bucket (or an "all clear" state).
  - **Created vs Completed Trend (12 months)** — a paired vertical bar chart with a legend.
  - **Owner Workload Distribution** — ranked bars of active tasks per owner.
  - **Tasks by Category** — a small stat-tile grid.
- **Notable features.** Two AI actions in the header — **Predict Escalations** (opens a panel of at-risk tasks with risk score %, confidence, predicted breach date, risk factors, recommended actions) and **Balance Workload** (opens a panel with current per-owner load, suggested task reassignments current→suggested owner with reason, and an "Apply Reassignments" action).

### Task Detail — /tasks/[id]
- **Purpose.** The full record and workspace for a single task — status changes, sub-tasks, collaboration, evidence, approvals, and audit history.
- **What it shows.**
  - **Header:** title, priority + status pills, "Task #ID · Source · Category · via [module] · Escalation Level N," and a chip linking back to a parent Issue when the task was promoted from a CAPA action.
  - **Four summary tiles:** SLA Status (with due date, colour-coded), Owner, Reviewer, Created (date + by whom).
  - **Status Transitions** bar: buttons for only the currently-valid next states plus an optional transition-comment field.
  - **Approval Workflow** panel (when required): approval status badge, request/approve/reject buttons with a comment field, and who approved/when.
  - **Recurrence** banner when recurring.
  - **Tabbed body:** Details / Sub-tasks (count) / Comments (count) / Evidence / History.
    - *Details:* description, a Task Information definition list (source, module, source entity, category, severity, SLA days, escalation level), a Linked Entities list (Risk/Control/Finding/Vulnerability), and completion timestamps.
    - *Sub-tasks:* add-a-subtask input; checkable rows with owner, due date, delete.
    - *Comments:* composer + threaded comments (author, timestamp).
    - *Evidence:* the evidence/notes free text.
    - *History:* an audit timeline (action, field changed, old→new values, user, timestamp).
- **Primary actions & flows.** Edit (opens a modal form covering all fields incl. linked risk/control/vulnerability pickers), Delete (confirm), state transitions, approvals, sub-task CRUD, commenting.
- **Notable features.** Two AI tools in the header — **Root Cause** (opens a panel: summary, root causes, remediation actions) and **AI Description** (panel: summary, detailed description, acceptance criteria, suggested sub-tasks, with "Apply Description to Task").

---

## Issues (Issue Management & CAPA)

**Purpose.** An enterprise issue log that captures problems from anywhere in the platform (vulns, risks, controls, assets, evidence, vendors, governance docs, policy statements, projects), computes severity from Impact × Urgency, drives them through a workflow to closure, and manages the CAPA (Corrective & Preventive Action) actions that resolve them.

**Information architecture.** A single hub route (`/issues`) with an inline **8-tab** pill navigation: **Overview** (scorecard), **Enterprise Log** (the issue table), **CAPA Actions** (cross-issue Kanban), **Contract Compliance** (the log pre-filtered to contract category), **Closure Tracker** (analytics dashboard), **Severity Matrix** (admin), **Classification Matrix** (admin), **Automation** (trigger toggles). A single global "+ New Issue" button lives in the hub header. Issues open into a full detail page at `/issues/[id]`. Workflow states: new → triage → in_progress → resolution → closure_review → closed (with cancelled and reopen paths).

### Overview tab (scorecard)
- **Purpose.** Executive posture view of the Issue & Incident domain, scored and weighted.
- **What it shows.** A **hero row** of three cards: a Performance card (score ring, grade, per-section mini-bars vs an 85 target, "Adjust weights" control), a **Posture Radar** (three axes: Issues, Incidents, CAPA — score vs 85 target), and a **Needs Attention** queue (open critical/high issues, SLA-breached issues, open critical/high incidents, overdue corrective actions, serious issues without a CAPA — each a count linking out). Below: **section formula cards** (Issues / Incidents / Corrective Actions), each with a score, band label, and a zone-column mini bar chart of its weighted metrics; clicking opens a metric-breakdown modal.
- **Notable features.** Per-tenant weight tuner modal; shared score-kit visuals reused from other modules.

### Enterprise Log tab (and Contract Compliance tab)
- **Purpose.** The filterable master table of all issues (Contract Compliance is the identical component pre-filtered to `category = contract`).
- **What it shows.** Filter bar: search (title/code/description), and dropdowns for severity, workflow state, issue type, category, plus an "SLA breached" toggle chip. **Table columns:** Code, Title, Severity (chip), State (chip), Type, Source (chip), Assignee, Target (closure date, with a "Nd over"/"breach" tag when breached). Footer "Showing N of M." Loading, error, and "no issues match" empty states.
- **Primary actions.** Filter/scan; rows link to issue detail.

### CAPA Actions tab
- **Purpose.** A cross-issue Kanban of every corrective/preventive action, grouped by status.
- **What it shows.** Six columns (Planned, In Progress, Blocked, Completed, Verified, Cancelled) with counts and accent colours. Cards show action-type tag (corrective/preventive/containment/verification, colour-toned), a link to the parent issue (#id), the action title, assignee, and due date (rose when overdue). Empty state prompts opening an issue's CAPA tab.
- **Primary actions.** Inline status advance per column: "Start" (planned→in progress), "Mark Complete" (in progress→completed), "Verify Effectiveness" (completed→verified).

### Closure Tracker tab
- **Purpose.** The analytics dashboard — "are we getting better?" — for issue closure and SLA quality.
- **What it shows.**
  - **Analytical lenses (IssueAnalytics)** rendered on top: **Trend — Opened vs Closed** (12-week composed bar+line with net line), **MTTR by Severity** (mean/median days bars), **Sources** (donut + legend with per-source critical counts), **Top Assignees** (severity-stacked horizontal bars), **SLA Quality** (% on-time per severity + a reopen-rate tile), and a **Severity × Age heatmap** (rows = severity, cols = age buckets, old+critical cells ringed).
  - **KPI strip:** Total, In Progress, Awaiting Closure, Closed (30d, with avg time-to-close), Critical Open, SLA Breached.
  - **Status Mix** donut, **Open by Age** bar chart, **By Severity** bars.
  - **SLA Breaches** feed (code, title, severity, days overdue) and **Recent Activity** feed.
  - **By Category** stat-tile grid (open count + "+N closed 30d").
  - Auto-refreshes; has an empty state and skeleton loader.

### Severity Matrix tab (admin)
- **Purpose.** Configure how Impact × Urgency maps to a computed severity and its SLA windows.
- **What it shows.** A 3×3 grid (Impact rows × Urgency columns, high/medium/low each). Each cell shows the severity chip, "Ack Xh · Resolve Yh," and a "Default" marker until overridden. Clicking a cell opens a modal to set severity + Ack/Resolve SLA hours.

### Classification Matrix tab (admin)
- **Purpose.** Route new issues to a default owner team/user and SLA based on Type × Severity.
- **What it shows.** A list/table of configured cells (Type, Severity chip, Team, User, Response SLA h, Escalation SLA h) plus an add/update form (type, severity, team ID, user ID, response & escalation hours). Empty state until cells added.

### Automation tab
- **Purpose.** Tenant-level switches for v2 event-driven auto-creation of issues.
- **What it shows.** A card with a master "All on (override)" toggle and four trigger rows, each with an icon, label, long description, on/off state chip, and a checkbox: KRI red-threshold breach, Mitigation action overdue, Governance doc review fast-forward, Evidence rejected on a control. A safety note about de-duplication. All default OFF.

### Issue Detail — /issues/[id]
- **Purpose.** The full issue record: properties, root cause, CAPA actions, linked items, comments, and audit activity.
- **What it shows.**
  - **Header:** code (ISS-N), severity/state/source chips, SLA-breached and severity-override badges, title, assignee/reporter/created/target-close meta, and a row of **valid next-state transition buttons** (plus "Approve Closure" in closure_review, "Reopen" when closed).
  - **Overview** (inline): Description card, Root Cause Analysis card, optional Closure Notes card, and a Properties panel (type, category, impact, urgency, owner, detected/due/resolved/closed dates, approved by).
  - **Four section cards** (open in a popup): CAPA Actions (count), Linked Items (aggregate count), Comments (count), Activity.
    - *CAPA popup:* add-action form (title, type, due date, assignee, description); action list with type tag, due status (overdue/due-soon colouring), assignee, a link chip to the mirrored Critical Task, a status badge, and a **Promote** button (promote CAPA → Critical Task). Clicking an action opens a detail/edit modal (status, type, due, assignee, description, plus an **effectiveness-verify** panel and delete).
    - *Linked Items popup:* six family tabs (Vulnerabilities, Risks, Assets, Controls, Evidence, Vendors) each with counts, a searchable "Link …" picker to attach more, and a list of linked rows.
    - *Comments popup:* composer + comment list.
    - *Activity popup:* a full audit log grouped by day, each entry with an action icon/tone, actor, human-readable verb, payload details (field diffs, state transitions, reasons, link names), and relative time.
  - **Closure modal:** required closure-notes textarea → "Approve Closure."
- **Notable features.** Deep cross-module linkage; CAPA→Task promotion with status sync; rich activity/audit trail.

---

## IS Projects (Information-Security Project Portfolio)

**Purpose.** Manage the portfolio of information-security projects — from portfolio-level health and budget analytics down to a single project's milestones, tasks, team, risks, budget, compliance mapping, lessons, and dependencies.

**Information architecture.** A hub route (`/is-projects`) with a top tab bar of three tabs: **Overview** (portfolio dashboard), **Projects** (the browsable list), **My Projects**. A project opens into a full detail page at `/is-projects/[id]` that itself has **11 tabs**. Project statuses: Planning / In Progress / On Hold / Completed / Cancelled; health: On Track / At Risk / Off Track.

### Overview tab (Portfolio Dashboard) — /is-projects (Overview) / /is-projects/dashboard
- **Purpose.** Executive overview of all IS projects: health, distribution, budget, milestones, and advanced portfolio analytics.
- **What it shows.**
  - **Four stat tiles:** Total Projects, On Track (emerald), At Risk (amber), Off Track (rose).
  - **Projects by Status** — donut + legend with counts and %.
  - **Projects by Category** — horizontal bar chart.
  - **Budget Utilization** — a big % with progress bar (colour thresholds) and Actual vs Estimated.
  - **Upcoming Milestones** and **Overdue Milestones** lists (name, project, date; overdue in rose) — clicking jumps to the project.
  - **Enhanced analytics (when available):**
    - **Project Health Trend** — a health score %, a stacked health bar (On/At/Off), and a stacked mini bar chart of health over time (daily snapshots).
    - **Budget Burn Rate** — per-project burn % progress bars (rose >100%, amber >80%).
    - **Resource Utilization Heatmap** — a member × project matrix of role-initial cells with a per-member load bar and a Low/Medium/High/Overloaded legend.
    - **Regulatory Alignment Matrix** — a project × framework matrix of status-coloured cells (Compliant/Partial/Gap/Mapped legend).

### Projects tab — /is-projects (Projects)
- **Purpose.** Browse, filter, and create projects in card or table view.
- **What it shows.**
  - Filter row: search + dropdowns for Status, Category, Priority, Health, Owner, and a **card/table view toggle**.
  - **Card view:** per-project card with name, category·department, health pill (dot), description, status + priority pills, a completion progress bar, and a footer of counts (milestones, tasks, team, open risks in amber) + target date.
  - **Table view** columns: Project, Category, Status, Health, Priority, Owner, Progress (bar + %), Target Date, chevron.
  - Loading, error, and "No projects yet" empty states.
- **Primary actions.** "New Project" opens a right-side slide-over (name, description, category, priority, owner & sponsor pickers, department, start/target dates, estimated budget, business justification). Cards/rows navigate to detail.

### My Projects tab — /is-projects (My Projects) / /is-projects/my-projects
- **Purpose.** The current user's projects, split by relationship.
- **What it shows.** Two sections — **Projects I Own** and **Projects I'm a Member Of** — each a grid of the same project cards (with an "Owner"/"Member" label chip). Empty state offers "Browse All Projects."

### Project Detail — /is-projects/[id]
- **Purpose.** The complete workspace for one project across its full lifecycle.
- **Information architecture.** Header (name, status/health/priority/category chips, Edit, Delete) over an **11-tab** bar: Overview, Milestones, Tasks, Team, Risks & Issues, Updates, Documents, Budget & Financials, Compliance Mapping, Lessons Learned, Dependencies.
- **What it shows, per tab.**
  - **Overview:** Project Summary, Business Justification, Linked GRC Entities (risks/controls/frameworks as tag chips), a Progress bar; sidebar cards for Key Details (owner, sponsor, department, start/target dates), Budget (estimated/actual/utilization + bar), Quick Stats (milestones/tasks/team/open risks), and an **AI Assistant** card.
  - **Milestones:** cards with name, status pill, description, target/actual dates, completion bar + inline % editor, status selector, deliverable chips, delete, and an **Evidence panel** per milestone (upload/list/delete files).
  - **Tasks:** a table (Task with dependency chips, Assignee, Status selector, Priority pill, Due Date, Progress slider, delete).
  - **Team:** member cards (name, email, role chip, responsibilities, joined date, remove).
  - **Risks & Issues:** a **Linked Platform Issues** panel (cross-module Issues linked to this project) above project-scoped risk cards (title, severity + status pills, type, description, mitigation, owner, identified date, status selector, delete).
  - **Updates:** status-update cards (author, date, health pill, and What Was Done / What's Planned / Blockers / Notes sections).
  - **Documents:** file/link rows (title, description, type, added-by, date) with download (uploaded files) or open-link, and delete.
  - **Budget & Financials:** four stat tiles (Estimated, Total Spent/Approved, Variance, Line Items), a "Budget vs Actual by Category" stacked-bar breakdown (approved vs pending), and a line-item table (Category, Description, Amount, Status, Approved By, edit/delete).
  - **Compliance Mapping:** an overall coverage stacked bar (Verified/Implemented/In Progress/Planned/Not Applicable) + per-framework breakdown, and mapping cards (framework chip, control id — name, coverage status, requirement, deliverable, notes).
  - **Lessons Learned:** cards (title, category chip, impact pill, description, author, date).
  - **Dependencies:** four stat tiles (Total, Blocked, High/Critical Impact, By Type), a directional **Dependency Map** (Depends On / Blocks / Related To columns), and dependency cards (type chip, name, direction, status, description, expected date, impact).
- **Primary actions & flows.** Each tab has add/edit/delete via modals (a shared modal form). Inline editing throughout (status selectors, sliders, % inputs). Header Edit modal covers all project fields incl. linked risks/controls/frameworks.
- **Notable features.** A prominent **AI Assistant** across tabs — Generate Plan (creates milestones + tasks + a timeline update), Assess Risks (creates risk rows), Draft Status Report (creates an update), Estimate Budget (creates line items), Suggest Team (adds member rows). AI results open in a modal with an **Apply** action that writes the generated entities into the project. Also: per-milestone evidence upload, document upload/download, and cross-module issue linkage.

---

## BCM (Business Continuity Management)

**Purpose.** Plan and test organizational resilience — maintain continuity plans with recovery objectives (RTO/RPO), run a Business Impact Analysis per critical process, schedule and score drills (and log real incident invocations), and route drill findings into the Issue/CAPA and Risk modules.

**Information architecture.** Not a tabbed hub but a set of linked routes: a **Dashboard** (`/bcm`), **Continuity Plans** list (`/bcm/plans`) → **Plan Detail** (`/bcm/plans/[id]`, which nests BIA processes and drills), and **Drills & Invocations** list (`/bcm/drills`) → **Drill Detail** (`/bcm/drills/[id]`). The dashboard and both list pages cross-link to each other and out to Issues and Risks. Plan lifecycle: draft → under_review → approved → retired. Drill lifecycle: scheduled → in_progress → completed → under_review → closed (with cancelled + an "overdue" effective status). A shared UI helper standardizes all badges, labels, and pickers.

### BCM Dashboard — /bcm
- **Purpose.** A single at-a-glance view of continuity posture and testing coverage, emphasizing BCM as the orchestration layer that links to other modules.
- **What it shows.**
  - **Four KPI tiles:** Active Plans (of total), Drill Coverage % (tested/active plans over 12 months), Overdue Drills (rose when >0), Open Findings (with BIA process count).
  - **Cross-module linkage** cards linking out: Open CAPAs (→ Issues), Risks Linked (→ Risk register), Incident Invocations (→ Drills).
  - **Recovery objective pass rate** — RTO met / RPO met progress bars across scored drill results.
  - **Open findings by severity** — critical/high/medium/low counts.
  - **Plans by status** — draft/under review/approved/retired counts.
  - Two lists: **Overdue drills** and **Recent activity** (title, type, plan, date, status badge).
  - Auto-refreshes; loading and error states.

### Continuity Plans — /bcm/plans
- **Purpose.** The register of all BCM plans.
- **What it shows.** Header with filtered/total count, search, and a Status filter. **Table columns:** Plan (title + business unit), Status badge, RTO, RPO, Cadence (Annual/Semi-Annual/Quarterly), BIA (count), Drills (count), Review Due, and actions (view, delete). Empty state prompts creating the first plan.
- **Primary actions.** "Add Plan" opens a modal: title, business unit/scope, testing cadence, description, RTO/RPO hours, owner picker, review-due date, and a **plan document reference** picker (links an existing governance document rather than re-uploading). Row → plan detail.

### Plan Detail — /bcm/plans/[id]
- **Purpose.** Manage one continuity plan, its Business Impact Analysis, and its drills.
- **What it shows.**
  - **Header:** "Continuity Plan · [business unit]", title, description, status badge, Edit, and a **status-transition** row ("Move to:" the other lifecycle states).
  - **Meta band:** RTO, RPO, Cadence, Owner, Review Due, Document.
  - **Business Impact Analysis** section: a grid of process cards (process name, criticality badge, RTO/RPO/MTPD, counts of assets/dependencies/strategies, a "⚠ Needs a recovery strategy" warning). Clicking a card opens a **BIA slide-over** with: Risk Register linkage (link existing or create a new risk from the process), Linked IT assets (multi-select), Dependencies (type/criticality/name, vendor BCP status, add/remove), and Recovery Strategies (type + description, proposed→approve/reject workflow, add/remove).
  - **Drills** section: a list of this plan's drills (title, type, scheduled date, finding count, status badge) linking to drill detail.
- **Primary actions & flows.** Add BIA process (modal: name, criticality, RTO/RPO/MTPD with a "RTO < MTPD" rule, linked assets); Schedule drill (modal); Edit plan; status transitions. Cross-links to Risk register and governance documents.

### Drills & Invocations — /bcm/drills
- **Purpose.** The register of all continuity drills and real incident invocations.
- **What it shows.** Header with count, search, and Status / Type / Source filters. **Table columns:** Drill (title + plan), Type (Tabletop/Simulation/Full Failover/Call Tree), Source (a rose "Incident" marker vs "Test"), Status badge, Scheduled date, Findings count, actions (view/delete). Empty state.
- **Primary actions.** "Schedule Drill" opens a modal that also logs invocations: plan picker, title, type, source (Scheduled Test / Incident-Triggered), a conditional **linked-incident** picker when incident-triggered, scheduled date, scenario. Row → drill detail.

### Drill Detail — /bcm/drills/[id]
- **Purpose.** Run and score a single drill/invocation and manage its findings.
- **What it shows.**
  - **Header:** source·type breadcrumb (linking to the plan), title, scenario, status badge, Edit, and a **status-transition** row. Incident-triggered drills get a rose siren icon; tests get a calendar icon.
  - **Meta band:** Scheduled, Started, Ended, Owner, and Findings count (or the linked Incident for invocations).
  - **Drill Result card:** RTO met? / RPO met? (Not assessed / Yes / No), Actual recovery hours, Actual data loss hours, a narrative summary, and who recorded it/when. Flagged "Required before closing."
  - **Findings card:** add-finding form (title, description, severity) with a note that High/Critical findings auto-open an Issue/CAPA. Each finding shows title, severity badge, description, a **Remediation** row (issue status badge + issue code link to Issues, or a "Create issue / CAPA" button) and a **Risk** row (linked risk link, or link/create-risk controls). Delete per finding.
- **Primary actions & flows.** Save/update drill result, add/delete findings, create issue/CAPA from a finding, link/create a risk from a finding, edit drill, advance status. Empty state when no findings.
- **Notable features.** This screen is the operational hub of cross-module orchestration — findings flow into Issues/CAPA (with auto-issue creation for severe findings) and into the Risk register, and incident invocations tie real events back into the same reporting as rehearsed drills.

---

# Administration, Access & Integrations

This brief documents every screen a designer will need to redesign the **Administration** area (and the closely-related **Integrations** and standalone **Users** routes) of a multi-tenant GRC (Governance, Risk & Compliance) SaaS. It is organized by module, with one detailed block per screen (each `page.tsx` route). All routes are relative to the dashboard shell.

---

## Administration — `/admin`

**Purpose.** The tenant admin's control center: company profile, people (users/roles/teams), security posture (password policy), the full connector/agent onboarding surface, identity federation, workflow engine, and the audit trail.

**Information architecture.** `/admin` is a single page with a **horizontal top tab bar** (horizontally scrollable on narrow screens). Each tab swaps in a self-contained screen component; there is no left sub-nav. The tab set, in order, with its icon:

1. **Company** (Building) → Company Profile
2. **User Management** (Users)
3. **Role Management** (Shield-check)
4. **Teams** (Users-round)
5. **Password Policy** (Lock)
6. **Integrations** (Bot) → renders the Scanner *Connections* screen inline
7. **Cloud Connectors** (Cloud)
8. **Connectors** (Plug) → external SaaS connectors
9. **Identity Providers** (Key) → renders an IdP card component
10. **Workflow Engine** (Git-pull-request) → renders the workflow module inline
11. **Audit Logs** (Scroll)

The bar deep-links via `?tab=<id>` (e.g. the sidebar "Administration" popover jumps straight to a tab); default landing is **Company**. Note several tabs are *hosts* for screens that also live at their own routes — e.g. Integrations tab embeds `/integrations/connections`. A few onboarding screens (Agents, Discover, Access Reviews, the Connect wizards) are **not** in this tab bar; they live at their own `/admin/*` routes and are reached from within other screens or the sidebar.

The tab bar is the module's primary wayfinding and a prime redesign target — 11 tabs is a lot, and it mixes "settings" (Company, Roles) with "operational tooling" (Cloud Connectors, Workflow). Consider grouping.

---

### Company Profile — `/admin` (Company tab) / `/admin/organization`

**Purpose.** View and edit the tenant's corporate identity and primary contact.

**What it shows.** A single white card, "Company Details," with an **Edit Profile** button top-right that flips the whole card between read-only and edit modes (each field renders as static text or an input/select). Fields are grouped:
- **Company block (2-col grid):** Company Name, Legal Entity, Industry (select: Banking, Insurance, Healthcare, Technology, Manufacturing, Retail, Government, Other), Company Size (select: 1-50 … 1000+), Geography, Regulatory Scope, Website.
- **Primary Contact (3-col):** Contact Name, Contact Email, Contact Phone.
- **Address** (full-width textarea).

Loading shows a page loader; there are green success and red error banners. Empty fields render as "-".

**Primary actions & flows.** Edit → inline-edit all fields → Save Changes / Cancel (Cancel reverts to last-loaded values). No wizard, no drawer.

**Notable.** Pure form screen; "editing" is a whole-card mode toggle, not per-field. Good candidate for a cleaner two-column "profile" layout with section headers and inline edit affordances.

---

### User Management — `/admin` (User Management tab) / `/admin/users`

**Purpose.** Create and manage individual user accounts and their role assignments.

**What it shows.** Title + subtitle, a **search box** (filters by name/username/email), and a **data table**. Columns:
- **User** (display name + `@username`)
- **Email**
- **Roles** (wrapped chips, one per assigned role)
- **Status** (Active = green pill / Inactive = red pill)
- **Last Login** (date or "Never")
- **Actions** (edit pencil, delete trash — each gated by permission)

Loading = page loader; errors show a dismissible red banner.

**Primary actions & flows.** **Create User** button (permission-gated) and row Edit open a **right-side drawer** (520px) over a dim scrim. The form: Username (create-only), Email, Password (create-only), Display Name, then a 2×2 grid of **Department / Group / Division / Designation**, and an **Assign Roles** checklist (each role as a checkbox row with name + description). Footer: Cancel / Create-Update. Delete uses a native `confirm()`.

**Notable.** Role assignment is a scrollable checkbox list inside the drawer. The org attributes (department/group/division/designation) are free-text.

---

### Role Management — `/admin` (Role Management tab) / `/admin/roles`

**Purpose.** Define roles and their granular permissions, and see who holds each role.

**What it shows.** Title + subtitle, search (name/description), and a table:
- **Role** (name; a grey "System" badge for system roles; description below)
- **Users** (a **clickable count** with a Users icon when > 0; plain grey "0" otherwise)
- **Permissions** (count)
- **Actions** (Edit pencil, or an **Eye** "view" icon for system roles which are read-only; Delete for non-system roles)

**Primary actions & flows.**
- **Create/Edit Role** opens a wide (800px) **right drawer**. Top: Role Name + Description. Below: a **Permissions Matrix** — an accordion of modules; each module row has a tri-state master checkbox (checked / indeterminate / unchecked) that selects all its permissions, and expands to show submodules with individual **action chips** (create/read/update/delete etc.) that toggle selected/unselected. Footer shows a live "N permission(s) selected" counter. System roles render the whole form disabled (view-only, "Close" instead of "Save").
- **View Members** — clicking the Users count opens a **centered modal** listing assigned users (name, email, "Inactive" badge, assignment date), with a member-count subtitle. Read-only.

**Notable.** The permission matrix is the centerpiece — a nested, tri-state checkbox tree. This is dense and a strong redesign focus (search within permissions, "diff from system role," etc. could help). Two different overlay patterns coexist here: a right **drawer** (edit) and a centered **modal** (members).

---

### Teams — `/admin` (Teams tab) / `/admin/teams`

**Purpose.** Maintain org teams (e.g. "Payments," "Identity") that assets and ownership chains point to.

**What it shows.** A card titled "Teams" with a **New Team** button, and a table: **Name** (+ description), **Lead** (user name or "—"), **Members** (count), **Status** (Active/Inactive pill), **Actions** (Members / Edit / Delete). Empty state: centered Users icon + copy explaining teams feed the asset "owning team" dropdown. Success/error banners at top.

**Primary actions & flows.**
- **Create/Edit** = a centered modal: Name, Description, **Lead** (dropdown of tenant users), and an **Active** checkbox (edit only).
- **Manage Members** = a larger centered modal (max 3xl): an "Add a member" row (user dropdown + role select: Lead/Member/Viewer + Add), then a member table (User, **Role-in-team** as an inline editable pill/select, Added date, Remove). Role colors: Lead = primary, Member = slate, Viewer = white.
- Delete uses `confirm()` and warns that assets pointing at the team have their team cleared.

**Notable.** Role-in-team is edited inline via a colored `<select>` pill — a nice pattern but visually subtle. Uses React Query with optimistic invalidation.

---

### Password Policy — `/admin` (Password Policy tab) / `/admin/password-policy`

**Purpose.** Configure password complexity, account lockout, and idle-session enforcement for the tenant.

**What it shows.** Two stacked cards, both driven by one edit mode (Edit Policy → Save/Cancel on the first card):
- **Card 1 — Password Complexity (2×2 grid):** Minimum Length (number, with NIST hint), **Character Requirements** (4 checkboxes: uppercase/lowercase/digit/special — in read mode shown as a list with green/grey status dots and strike-through for disabled), Disallow Reuse of Last N Passwords, Max Password Age (days).
- **Card 2 — Account Lockout & Session (2×2 grid):** Failed Attempts Before Lock, Lock Duration (minutes), Idle Session Timeout (minutes), and a **"Current configuration" info tile** summarizing lockout/idle settings + "Last updated" timestamp.

Every numeric field has min/max and an explanatory hint. Success/error banners.

**Notable.** Read mode uses status dots + strikethrough to communicate which complexity rules are on — a distinctive, scannable treatment worth preserving. The right-hand "current configuration" recap tile balances the grid.

---

### Audit Logs — `/admin` (Audit tab) / `/admin/audit-logs`

**Purpose.** Review a paginated, filterable trail of every user action across the whole platform.

**What it shows.** Title + a "N total records" counter. **Filter row:** three single-select dropdowns — **Action**, **Module**, **Date** (Today / Last 7 / 30 / 90 days / Year-to-date / Last 12 months) — plus a "Clear filters" link. Table columns:
- **Timestamp** (date over time)
- **User** (colored initials avatar + name)
- **Action** (colored badge: Create=green, Update=slate, Delete=red, Read=grey, *_Failed=amber)
- **Module** (friendly module + submodule, derived from the request URL path via an extensive label map — e.g. `/grc/erm/risks/5` → "Risks & ERM / Risks")
- **Activity** (human sentence, enriched with "— in <module>")
- **View Details** button

**Pagination** is rich: "X–Y of N rows · page P of T" with First / Prev / Next / Last jumps.

**Primary actions & flows.** **View Details** opens a **centered modal** with sections: **"What happened"** (an **AI-generated summary**, lazily fetched per row and cached, rendered as Markdown, with a "Generating readable summary…" spinner and graceful fallback), **Overview** (user, timestamp, IP), **Action Details** (action badge, module/sub-module, resource type, record id), **Request Info** (method, path, status code colored by 2xx/4xx, duration ms, user agent), and a **Request Payload** JSON block.

**Notable.** The **AI "What happened" summary** is the standout feature — plain-language narration of a raw audit event. Module/submodule are inferred from URL structure, so the mapping is UI-maintained. Heavy data density; the detail modal is effectively a mini record viewer.

---

### External Connectors — `/admin` (Connectors tab) / `/admin/connectors`

**Purpose.** Wire third-party SaaS systems (ITSM, SIEM, pen-test, collaboration, transcription) to push/pull GRC data.

**What it shows.** Header with a **dev-mode warning** when the encryption master key isn't set ("credentials stored unencrypted"). Providers are grouped into **category sections** with icon + description: **Ticketing** (ServiceNow etc.), **SIEM** (Splunk), **Pen-test**, **Collaboration** (MS Teams), **Transcription** (Fireflies). Each provider is a **card** showing: label, Beta/OAuth2 badges, description, a docs link, and — if connections exist — a list of them each with a **status dot** (connected/error/pending), plus per-connection **Test**, **Sync now**, and **Remove** icon buttons. Every card has a dashed "**Add … connection**" button.

**Primary actions & flows.** Add/Edit opens a **centered setup modal**: Connection Name + a **dynamically rendered field set** from provider metadata (text/password/url/textarea, required flags, credential fields marked "encrypted at rest" / "leave blank to keep existing"). On create it runs a connection test and reports the result; **OAuth2** providers then auto-open the vendor consent screen in a popup. React-Query mutations drive test/sync/delete with toasts.

**Notable.** Fully **metadata-driven forms** (fields come from a provider catalog), multi-connection-per-provider, OAuth2 popup consent, inline per-connection health actions.

---

### Cloud Connectors — `/admin` (Cloud Connectors tab) / `/admin/cloud-connectors`

**Purpose.** Connect cloud security-finding sources (AWS Inspector, Microsoft Defender, GCP SCC) and legacy scanners so their findings sync into the vulnerability register.

**What it shows.**
- Optional **dev-mode encryption warning** banner; success/error banners.
- **"Supported integrations" catalogue** card — a tile grid of platforms (AWS Inspector v2, Defender for Cloud, GCP SCC, plus legacy **Tenable Nessus** / **Rapid7 Nexpose** with a "Legacy" tag). Each tile: brand icon, label, one-line security note, and a status pill ("N connected" / "Add" / "Manage"). Clicking a cloud tile opens the add modal preset to that provider; legacy tiles deep-link to the Integrations tab.
- **"Configured cloud connectors"** card — **Sync All** + **Add Connector** buttons, then a list of connector rows. Each row: display name, provider tag, Disabled tag, description, **Last sync** (time + status pill), **Last health** (time + status pill), last error, and a metrics line ("Last run added N assets, M vulns…"). Row actions: **Health**, **Sync**, **Enable/Disable**, **Delete**. Empty state with cloud icon.
- **"Scanner connections (legacy)"** card — read-only rows for Nessus/Nexpose with a "Manage →" link.

**Primary actions & flows.** **Add Cloud Connector** is a **wide two-column modal**: left = a **per-provider setup guide** fetched from the backend (security summary, "we store / we never store" lists, numbered steps, and **copy-blocks** for values like the per-tenant External ID and recommended IAM policy); right = the form (Provider select, Display Name, Description, Sync interval hours, and a **Credentials JSON textarea** pre-filled from a provider template). Sync/health/delete via mutations, each surfacing result banners (e.g. "synced: N new + M updated assets").

**Notable.** The **two-pane "guide + form" modal** with copyable IAM/External-ID blocks is distinctive and a key redesign artifact. Credentials are entered as raw JSON — an obvious candidate for structured per-provider fields. Mixes a modern "cloud connector" framework with a legacy scanner table surfaced read-only for completeness.

---

### Identity Providers — `/admin` (Identity tab)

**Purpose.** Manage SSO/identity federation. This tab renders a shared **IdentityProvidersCard** component (also shown on the Integrations dashboard), not a standalone page route. Treat it as a card surface for connecting IdPs (e.g. Microsoft Entra). Design should keep it consistent with the connector cards.

### Workflow Engine — `/admin` (Workflow tab)

**Purpose.** Embeds the Workflow Engine module inline. Out of primary scope here (owned by its own module) but appears as an Admin tab; keep the tab styling consistent.

---

## Compliance Agents & Agentless Onboarding (Admin sub-routes)

These screens are the "get infrastructure connected so we can scan it" surface. They are reached from the sidebar and from cross-links, not the Admin tab bar. They share a strong onboarding/wizard character and a permission gate (`compliance:agents:manage` / `compliance:discover:execute`).

---

### Compliance Agents — `/admin/agents`

**Purpose.** Install/manage scan agents (endpoint + collector) and hand off to the agentless Connect Wizard.

**Information architecture.** Standalone full-width page. Top actions: **Open Connect Wizard →** (links to `/admin/integrations/connect`) and **🪄 Setup Wizard** (opens a modal). Both show a locked/🔒 state and a permission toast when the user lacks rights.

**What it shows.**
- **Endpoint agent packages** card — three columns **Windows / Linux / macOS**, each with OS support notes and a **Download installer** button (mints a reusable 72h fleet enrollment token and streams the per-OS installer), plus an "or connect agentless" link.
- **Collector agent** card — a Linux collector download (dials out through firewalls) beside a "when to use collector vs agentless" explainer.
- **Agentless targets** card — a single CTA to the Connect Wizard.
- **Agents table** — columns: Agent (name + version), Mode (collector/endpoint), Host, OS, **Status** (active/pending/**stale**/revoked pill — "stale" is derived client-side when no heartbeat for >5 min), **Last heartbeat** (relative "5m ago"), **Last results**, and a **Revoke** action. **Auto-refreshes every 5s.** Empty state with "Setup Wizard" / "Use Agentless instead" actions.

**Primary actions & flows.**
- **Setup Wizard** (modal) — a progressive 5-step flow: **Method** (agentless vs agent) → **Agent type** (endpoint vs collector) → **How many** (single / bulk / from discovery) → **Configure** → **Result** (install commands or CSV of enrollment tokens + install one-liners). It accepts a **prefill handoff** from the Discovery page (hostnames arrive via sessionStorage + `?bulkEnroll=1`, jumping straight to Configure).
- **Revoke** — custom modal (not `confirm()`) with an optional reason; kills the agent's push capability while keeping asset records.

**Notable.** Real-time polling, token-based installer downloads, a genuine multi-branch wizard, and the discovery→bulk-enroll handoff. Lots of emoji-in-UI (🪟🐧🍎📡) that a redesign may want to systematize into real icons.

---

### Bulk Host Discovery — `/admin/discover`

**Purpose.** Scan a network CIDR range for live hosts, then bulk-import the responders as assets with credentials.

**Information architecture.** Standalone page with a **3-step breadcrumb** (Discover hosts → Import as assets → Done) that reflects progress automatically.

**What it shows.**
- **Step 1 form:** CIDR range, Runner type (Windows WinRM 5986 / Linux SSH 22 / Cisco SSH / Oracle 1521), optional Port override, Probe timeout. "Start Discovery" (permission-gated). Note: max 4096 hosts/scan.
- **Discovery results table:** header "Probed N hosts in <cidr>, M responded on port P," a **Select all / Deselect** toggle, and a "⚡ Send N hostnames to Bulk Enroll" handoff button. Columns: checkbox, **IP**, **Hostname** ("no DNS" italic when absent), **Status** (reachable=green / unreachable=grey / error=red pill), **RTT** (ms). Reachable rows are pre-selected; unreachable rows are dimmed & disabled.
- **Zero-responder empty state** with "Adjust and retry."
- **Step 2 import form:** Username, Password, Asset name prefix, Asset type (Infrastructure/Application/Data/Cloud), Criticality (Low→Critical). One shared credential for all imported hosts.
- **Step 3 results:** three big stat numbers (**Assets created / Connections created / Skipped**), a list of created assets (name + host), and a skipped-with-reasons callout.

**Notable.** A clean linear wizard driven by real scan results; the "Send to Bulk Enroll" cross-flow into the Agents wizard is the key connective tissue. Toasts summarize each step.

---

### Connect Wizard (Agentless) — `/admin/integrations/connect`

**Purpose.** Onboard a single infrastructure target (server, DB, network device, cloud account) by platform, generating either an install one-liner or a manual-credentials connection with a live pre-flight check.

**Information architecture.** Standalone, centered, multi-step page. Gated behind `compliance:agents:manage` (full-screen 🔒 lock card otherwise). Deep-links accept `?platform`, `?hostname`, `?asset_id`, `?asset_ids` (bulk), `?label` — so the `/assets` list can open it pre-filled.

**What it shows.**
- **Platform picker** grouped into: **Hosts & servers** (Windows, Linux), **Network devices** (Cisco), **Databases** (Oracle, MSSQL, PostgreSQL, MySQL), **Identity** (Active Directory/LDAP → routes to AD Discovery), **Cloud accounts** (AWS, DigitalOcean, Azure, Kubernetes). Each group has an explanatory hint and each platform a large logo tile + subtitle. A "one device at a time" explainer and a link to bulk-onboard via the IT Assets list.
- **Manual Credentials form** (Windows/Linux/DigitalOcean): dark header strip ("Step 2 of 2", encrypted badge), Section 1 (Friendly label, Hostname/IP — port auto-selected & hidden), Section 2 (Username, Password with "Fernet-encrypted at rest"), a **live pre-flight notice** (runs a real `whoami` before saving), inline structured pre-flight error rendering (auth failed / unreachable / TLS / config), and a Connect button.
- **SQL DB form** — one component for all four engines with per-engine role-prep guidance, default ports, DB-name vs Oracle TNS-service/SID handling.
- **AWS form** and a **"coming soon" preview card** for platforms without a shipped form yet (with a link to create the connection manually).
- **Live status polling** every 3s once a token is issued; a **"Connected!"** success screen (detected OS, auto-redirect back to the originating asset's Compliance tab or the dashboard).

**Notable.** The most complex screen in scope: per-platform forms, credential pre-flight validation with actionable error hints, token issuance + status polling, install one-liner generation (`iwr … | iex`, `curl … | sudo bash`), and bulk mode. Heavy on trust/security cues (encryption badges, read-only service-account framing).

---

### Active Directory Discovery — `/admin/integrations/connect/ad-discover`

**Purpose.** Bind to AD with one service account, enumerate every domain-joined computer, and onboard selected hosts in bulk with a shared WinRM credential.

**What it shows.** Gated (🔒 card otherwise). A **"try with demo data"** banner (returns 8 realistic fake hosts). **Step 1** form: LDAP URL, Base DN, Bind DN, Password. **Step 2** results: "Discovered N computers" (with "truncated at 5000" note), a filter box, selected-count, Select-all-visible/Clear, and a scrollable table (checkbox, **CN**, **DNS hostname**, **OS** + version). **Step 3** (inline): a "reuse AD bind creds for WinRM" checkbox or separate WinRM user/password, then **Onboard N selected**. **Success screen:** three stat tiles (new asset rows / new connections / skipped), an "updated assets" note, and links to IT Assets / Risk Posture.

**Notable.** Credential-driven discovery (no CIDR scan), demo mode that writes real placeholder rows, and a compact 3-step-in-one-page layout. Consistent visual language with the CIDR Discover page but a different data source.

---

## Access Reviews — `/admin/access-reviews`

**Purpose.** Run periodic user-access certification campaigns end-to-end: connect identity sources, scope & sample a population, run rule-based checks, certify each user (approve/revoke/exception), and seal an auditable report.

**Information architecture.** A four-route module with its own visual system (larger type, mono numerics, a `--color-base` accent, custom pill/segment controls — visibly distinct from the rest of Admin):
- Landing `/admin/access-reviews` (KPIs, guided journey, reviews list)
- Review detail `/admin/access-reviews/[id]` (the 6-stage pipeline)
- Rule library `/admin/access-reviews/rules`
- Connect a source `/admin/access-reviews/connect`

The backbone concept is a **gated 6-stage pipeline**: **1 Sync population → 2 Draw sample → 3 Run checks → 4 Certify → 5 Report → 6 Close (seal)**, mapped from backend statuses draft/population_built/sampled/in_review/completed.

---

### Access Reviews — Landing — `/admin/access-reviews`

**Purpose.** Overview + entry point: see review health, know the next step, and open or start a review.

**What it shows.**
- Header with **Sources**, **Rule library**, and **New review** buttons (New disabled until a source exists).
- **Guided journey** strip — 3 steps (Connect a source / Create a review / Run & certify) with done/active states and a context-aware primary CTA ("Connect a source" → "Create a review" → "Continue certifying" / "Open latest review").
- **KPI row (4 tiles):** Active reviews, Awaiting decision (users to certify), Open exceptions (+ users flagged), Certified (% + "reviewed of sampled").
- **Reviews list** — rows with Review (name + `AR-<id>` + scope), Scope pill, a **6-segment pipeline-stage bar** with "Stage N · <label>", and Certified (`items_reviewed / sample_size` + a mini progress bar).
- Empty states differ depending on whether a source is connected yet.

**Primary actions & flows.** **New review** opens a **CreateReviewModal**: Review name, **Scope** segmented control (All users / Privileged only / Terminated only), **Sampling method** segmented (Random / Risk-weighted / Full population), and a **Sample size slider** (hidden/"all" when Full). Creating routes into the review detail.

**Notable.** The guided journey + single adaptive CTA is a deliberate "one obvious next action" pattern. Strong data-viz identity (segmented pipeline bars, mono KPI numerals).

---

### Access Review — Detail / Certify / Report — `/admin/access-reviews/[id]`

**Purpose.** Drive one review through its pipeline and certify each sampled user, culminating in a sealed report.

**What it shows.**
- Back link, review title, `AR-<id> · scope · sampling method`.
- **4 stat tiles:** Population (in scope), Sample (frozen snapshot / "not drawn"), Findings (across sample / "not run"), Certified (reviewed/sample).
- **Pipeline rail** — the 6 stages as a horizontal connected node rail (done = filled + check, current = ringed, locked = lock icon), with a `RefreshCw/BarChart3/ClipboardCheck/PenLine/FileText/Lock` icon per stage.
- **Gated current-stage action card** (stages 1–3, 6): a big-icon panel describing the stage with an advance button ("Sync population" / "Draw sample" / "Run checks" / "Seal & close").
- **Stage 4 — Certify block:** a context bar (progress "% certified" + a **filter segmented control** All / Flagged / Pending / Decided with counts + a user search), then a table: **User** (name + dept·title), **Risk** (colored score chip), **Findings** (severity pill count or "clean"), **AI suggestion** (Approve/Revoke/Exception chip), **Decision** (either a status pill or three quick-action buttons ✓ ✗ ⓘ). A footnote clarifies "Revoke records an instruction, not the remediation."
- **User side panel** (right drawer) per user: avatar, risk chip, flag chips (privileged/terminated/anomaly), profile fields (department, title, roles, MFA, account status, last sign-in, termination date), a **Findings** list (title + severity + detail + type), an **AI suggestion** block (assistive, with reasoning, "you decide"), the **decision buttons** (Approve/Revoke/Exception), a **justification textarea** (recorded as audit evidence), and an **Attach evidence** file input.
- **Stage 5/6 — Report block:** export buttons (**CSV / XLSX / PDF**), a **verdict banner** (colored by pass/exception/in-progress) with Population/Sample/Findings/Exceptions numerals, two **bar-chart panels** (Decisions breakdown; Findings by severity), an **AI summary** card, and either a green **"Sealed — read-only audit evidence"** state or a **"Seal & close this review"** action (irreversible).

**Primary actions & flows.** Advance stage → draw sample → run checks → certify every user (inline or via the side panel) → continue to report (gated on zero pending) → seal. Decisions and evidence uploads mutate per-item.

**Notable.** AI recommendations are **explicitly assistive/subordinate** to the human decision — a deliberate governance stance the redesign must preserve. Rich drawer, gated progression, and PDF/CSV/XLSX export of an audit-grade report.

---

### Rule Library — `/admin/access-reviews/rules`

**Purpose.** Browse and enable/disable the catalog of checks that fire during Stage 3 (Run checks).

**What it shows.** Back link, title. **3 KPI tiles:** Catalog (total rules), Runnable now (with connected data), Enabled (fire on next run). A **Regulation segmented filter** (All / SOX / PCI / GDPR / SAMA) + filtered count. Then rules **grouped by domain**, each domain a table of rule rows: rule id + status ("Runnable" / "Needs data feed" / "Needs connector"), name + **severity pill**, a "reads … · trips when …" plain-language description, **regulation tags**, and an **enable toggle** (disabled when the rule isn't runnable).

**Notable.** Rules are described in human terms ("reads / trips when") rather than code. The runnable/needs-connector states tie directly back to which sources are connected — a nice dependency cue.

---

### Connect a Source — `/admin/access-reviews/connect`

**Purpose.** Connect identity/access systems that feed the single shared user table for reviews — a **menu, not a sequence** (connect only what you have, any order).

**What it shows.** Back link, title. Three **tiers**, each a section with a "Tier N" badge, title/subtitle, and an "N/M connected" counter:
- **Tier 1 — Directories & login:** Microsoft Entra ID (SSO), Okta, Google Workspace, Active Directory/LDAP, Excel/CSV upload.
- **Tier 2 — IAM/IGA governance:** SailPoint, Saviynt, Oracle Identity, IBM Verify, One Identity, Ping, JumpCloud, CyberArk, BeyondTrust.
- **Tier 3 — Business apps:** Core Banking, SAP, Salesforce, Oracle EBS, ServiceNow, Databases.

Each vendor is a card (colored initials tile, name, subtitle) showing **Connected** (accent) or a **Connect** button.

**Primary actions & flows.** Connect opens a **right drawer**: SSO vendors get a "Connect with Microsoft →" handoff to the Identity Providers tab; upload vendors get a `.csv/.xlsx` file picker; form/IGA/app vendors get a dynamic field set (API base URL + per-vendor credential fields). Actions: **Connect & sync** and, for IGA/app, **Load sample data**. On success it reports "Pulled N users, M entitlements." Credentials are used for the sync only and not stored.

**Notable.** The tiered "richest source" framing (IGA > directory > app) and "all sources feed one table" model is a distinctive IA concept. Field sets for IGA/app vendors come from backend catalogs (metadata-driven).

---

## Integrations (Scanner) — `/integrations`

**Purpose.** The vulnerability-scanner integration surface: an analytics dashboard, scanner connection management, and the exception-approval workflow. (Note: the Admin "Integrations" tab embeds the Connections screen; this top-level module is broader.)

**Information architecture.** Three sibling routes: dashboard `/integrations`, `/integrations/connections`, `/integrations/exceptions`. The dashboard also embeds the **Identity Providers** and **Integration Platforms** cards, tying it to the connector ecosystem.

---

### Scanner Integration Dashboard — `/integrations`

**Purpose.** At-a-glance vulnerability posture from connected scanners, with remediation KPIs.

**What it shows.**
- Header actions: **Assign SLA Deadlines** and **Recalculate Scores** (batch mutations).
- Embedded **Identity Providers** card and **Integration Platforms** card.
- **Stat row (6 tiles):** Total Vulns, Open, Closed, Overdue, Assets, **SLA Rate %** (tile color adapts to the rate).
- **Charts:** a **Severity Distribution pie** (critical→info, sanctioned severity ramp) and a **30-day Vulnerability Trends line chart** (New vs Closed).
- **Three metric cards:** **Mean Time to Remediate** (overall days + per-severity avg/count), **SLA Compliance** (on-time/late/overdue/within-SLA), **Scanner Coverage** (% + total/scanner/assessed/stale-over-30-days).
- **Top Affected Assets** table (Asset, Critical, High, Total) with "View all → /assets".
- **Connection Status** list (name, assets·vulns·last-sync, colored status dot) with "Manage → /integrations/connections".

Loading spinner and an error state. Charts use Recharts.

**Notable.** The one genuinely chart-heavy screen in scope — pie + line + KPI tiles. A `connection_id` filter is wired through all queries (per-connection scoping). Follow the dataviz palette carefully on redesign.

---

### Scanner Connections — `/integrations/connections` (also the Admin "Integrations" tab)

**Purpose.** Add, test, sync, and inspect vulnerability-scanner connections (Nexpose / Nessus).

**What it shows.** An **Add Connection** button (permission-gated) and a list of **expandable connection rows**: Wi-Fi/off icon (active state), name, scanner-type pill (Tenable Nessus / Rapid7 Nexpose), console URL:port, a **status badge** (connected/error/deactivated/pending), an expand chevron, and a detail-panel toggle. Expanding a row reveals action buttons — **Test**, **Sync Now**, **History**, **Deactivate** (permission-gated) — inline test/sync result banners, last-sync summary, and a **last-sync stats grid** (new/updated/closed). Empty state with a Server icon + Add CTA.

**Primary actions & flows.**
- **Add Connection** = a **right slide-over**: Scanner Type (Nexpose/Nessus), Connection Name, Console URL, Console Port (defaults by type: 8834/3780), **Credential Env Prefix** (reads `PREFIX_*` env vars), optional Username/Password, and **Sync Schedule (cron)** (default `0 */4 * * *`).
- **Detail slide-over** (from the detail toggle): Configuration `<dl>`, Last Sync Stats grid, and a **Sync History table** (Type, Started, Duration, Status, New/Updated/Errors, last 20 runs).

**Notable.** Two slide-overs (add + detail), a cron field exposed directly to users, and credentials sourced from environment-variable prefixes rather than typed secrets — both worth reconsidering for usability. Deactivate (not delete) preserves data.

---

### Exception Requests — `/integrations/exceptions`

**Purpose.** Approve/reject/revoke vulnerability exception requests (false positive / risk accepted / deferred), with optional push back to the scanner.

**What it shows.** Header + a **status filter** dropdown (All / Pending / Approved / Rejected / Revoked / Withdrawn). **3 summary tiles:** Pending Review (amber), Approved (green), Rejected (red). Then a list of **exception cards**: a status pill, an exception-type tag, `#id`; a line with **Vulnerability ID** and **Reason** (labeled), the **justification** text, and a meta row (Requested date, Expires date, **Push status** — "Synced to Scanner" / "Local Only" / raw, colored — and a **Nexpose exception id** link when pushed). Reviewed items show "Reviewed <date> by User #N". Empty state with a Shield icon.

**Primary actions & flows.** For **pending** requests: a **Review Notes** input + **Approve** / **Reject** buttons, plus a **Withdraw Request** link (permission-gated). For **approved** requests (permission-gated): a **Revoke Reason** input + **Revoke** button.

**Notable.** This is the one true **approval workflow** screen — inline approve/reject/revoke with notes, and a two-way "push to scanner" status (the exception is mirrored into Nexpose). Actions are permission-gated (`integrations:exceptions:edit`).

---

## Users (standalone) — `/users`

**Purpose.** A **read-only** directory of tenant users (distinct from the editable Admin → User Management screen).

**What it shows.** Title + subtitle. **3 stat cards:** Total Users, Active Users, Inactive Users. A **search box** (name/email/role) + **status filter** (All/Active/Inactive). Then a table: **User** (initial-avatar + name + email), **Role** (shield icon + role name or "No Role"), **Department** (building icon + name or "No Department"), **Status** (Active/Inactive pill with icon), **Joined** (date). Loading spinner, a red error state ("Failed to load users"), and an empty state.

**Primary actions & flows.** View, search, filter only — **no create/edit/delete** here. It reads from a tenant-users endpoint.

**Notable.** Overlaps heavily with Admin → User Management but is view-only and uses a different data source/shape (`role_name`, `department_name`, `is_active`, `created_at`). A redesign should clarify why two "User Management" surfaces exist — this one reads like a lightweight directory, the Admin one is the editor. Uses the theme-token utility classes (`cw-card`, `cw-text-muted`, `cw-field`) rather than the raw slate palette seen elsewhere, so it's a good reference for the design-token direction.

---

### Cross-cutting notes for the redesign
- **Two overlay conventions coexist** — right **drawers/slide-overs** (users, roles edit, connections, access-review user panel, connect-source) and **centered modals** (teams, role members, audit detail, connectors, cloud connectors). Worth unifying.
- **Permission gating** is pervasive (`IfPermission`, `usePermissions`, 🔒 lock states, permission toasts). Locked/empty/loading states need first-class design, not afterthoughts.
- **Metadata-driven forms** appear repeatedly (external connectors, cloud connectors, IGA/app sources) — the redesign should define one reusable dynamic-form pattern.
- **AI as assist** shows up in Audit Logs ("What happened" summary) and Access Reviews (per-user suggestion + report summary), always positioned as supplementary/assistive.
- **Emoji-as-icons** are heavy in the agent/connect wizards; consider replacing with the lucide icon set used elsewhere.
- The **Access Reviews** module already uses a separate visual system (`--color-base` accent tokens, mono numerals, segmented controls) — it can serve as the reference for a refreshed, more expressive direction, or be reconciled with the slate-based rest of Admin.

---
