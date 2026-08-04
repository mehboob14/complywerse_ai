# GRC Platform — UI/UX Revamp · Phase 1 Audit

**Scope of this phase:** Governance · Risk Management (ERM + Risk) · Compliance.
**Method:** Read-only senior-designer audit of every sub-module, judged against the SME charter (single teal `#1ed4b0` = `primary-*`, no gradients, hairline slate borders, minimalist, minimal clicks, self-explanatory, no scroll-and-forget, responsive) and the **Snapshot Test** — *can a board member see status / progress-over-time / who's performing / done-pending-overdue / key dates in one glance?*
**No code was changed.** Modules not in scope (Dashboard, IT Assets, Auditor Portal detail, Projects, Critical Tasks, Administration) are inventoried for the next audit pass.

**Severity key:** `Critical` = broken/unreadable/unsafe · `High` = clear charter/UX failure or broken flow · `Medium` = notable friction · `Low` = polish.

---

## 0. Executive summary — the systemic problems

Five issues recur across nearly every un-revamped module and dwarf the per-page nits:

1. **[High · platform-wide] Off-brand palette + gradients.** The app was built before the teal charter. Blue / purple / indigo / violet / cyan are used as the **brand/primary** color (active tabs `border-blue-600`, CTAs `bg-blue-600`, links `text-blue-600`, AI = purple), and there are **real gradients** (AI buttons `from-purple-600 to-blue-600`, stat-card icon chips, hero banners). A global palette sweep to `primary-*` (teal) + slate + deep semantic (emerald/amber/rose), with all gradients removed, resolves the bulk of the High findings. *Keep red→green only for risk-severity heatmaps and document that exception.*

2. **[High · platform-wide] Dark-theme residue on a light UI.** Many pages predate the light theme: `*-500/20` translucent chips with `text-*-400` labels (pale/low-contrast), `divide-slate-700` dividers, `bg-gray-800` surfaces — and, in two pages, **white text on white backgrounds** (`evidence/audit-packages`, `control-library/evidence`) that is literally unreadable. These are effectively functional breaks.

3. **[Critical · Risk] Two parallel risk applications.** The entire `/risks/*` tree (register, "Advanced ERM", RCSA, AI-assessment aliases) duplicates `/erm/*` — ~5,000 lines of divergent, live, competing UI. This is the single largest structural liability in the platform.

4. **[High · IA] Competing / hidden surfaces.** *Controls* vs *Control Library*, *Evidence* vs *Control-Library › Evidence*, and five hidden Control-Library sub-tabs (coverage/gaps/compare/evidence/review — no tab bar, one link each) confuse users about "which page do I use?" These need IA decisions, not just restyling.

5. **[High · charter] The Snapshot Test fails on the core work surfaces.** The **Risk Register** (card list, no owner/due/residual until you expand each card), **Assessments/Incidents/KRIs** (no owner/SLA/overdue at a glance), and several **Approvals** queues fail the one-glance test. Committees (Governance) and the Evidence Snapshot view are the reference standards to bring the rest up to.

**Reference standards already in the codebase (bring everything to this bar):** Governance **Committees**, the Governance **Documents** workspace, Compliance **Controls** (recently revamped), the Evidence **Workspace + Snapshot + D1 detail**, and Control-Library **Review** — all charter-clean, teal-only, master-detail, snapshot-legible.

**Also surfaced — real functional bugs (not cosmetics), fix regardless of the revamp:**
- `governance/attestations` serves **silent hardcoded mock data on API error** (a board user could sign fake attestations) and the **evidence-upload in attestation completion is never sent** (the required-evidence gate is cosmetic).
- `evidence/audit-packages` renders **white-on-white unreadable** content.
- `control-library/evidence` row **"Link" button does nothing**; `evidence/coverage` **"Add Evidence" button does nothing**; `regulatory-feeds` **edit button has no handler**.
- Compliance **assessment detail** imports 4 tabs (Artifacts/DCC/Audit-Plan/NCA) that are **unreachable** (no tab bar renders); assessment status is **read-only**.
- TPRA vendor lifecycle **unsaved-work guard is unwired** (edits lost silently); tiering/scoring engines run with **no pre-conditions**.

---

## 1. GOVERNANCE

**Cross-cutting (Governance):** blue active tabs in `layout.tsx`; every un-revamped page carries `*-500/20` dark chips + its own duplicated off-brand `DOCUMENT_TYPES` color map; two competing modal patterns (RightSlidePanel vs centered dialogs); `window.confirm`/`alert()` used throughout.

### Overview / landing (`/governance`)
- **Purpose:** Executive governance posture dashboard.
- **Works:** genuinely snapshot-oriented (KPIs + donuts + radar + trend); good empty/skeleton states.
- `[High]` Palette explosion — ~10 hardcoded off-brand hues in charts/KPI accents (`#2563eb`, violet/cyan/indigo, `border-l-*` in 5 colors) → recolor to teal + semantic + slate.
- `[Medium]` Too many bespoke chart archetypes (donut/radar/rings/lollipop/sunburst/bow-tie/gauge) for a board audience — "rich, not minimal" → consolidate to 3–4 reused types.

### Documents (`/governance` — REVAMPED, reference standard)
- **Works:** on-brand workspace (Tree/Table/Board), attention rail anti-scroll pattern.
- `[Critical]` Residual gradient in AI-draft flow (`documents/page.tsx:2198` `from-purple-50 to-blue-50`) + `docTypeColors` map hardcodes blue/purple/indigo → teal/slate.
- `[Medium]` Snapshot only in tree view; table/board show no at-a-glance status panel. Tree is desktop-only with no mobile affordance.

### Committees (`/governance/committees` — REVAMPED, **best-in-class reference**)
- **Works:** semantic-only palette, RAG dots, sticky context panel, side-by-side progress + performers — **passes the Snapshot Test fully.**
- `[Low]` `audit_committee` badge still `bg-blue-50` → slate. Context panel caps top-5/top-8 with no "view all."

### Mappings (`/governance/mappings`)
- **Purpose:** link documents → controls with AI-recommended controls.
- **Works:** two-pane doc→controls master-detail; AI recommendations with one-click link/unlink; re-link safety confirm.
- `[High]` Dark-theme chip tokens (`text-purple-400 bg-purple-500/20`, etc.) + indigo-themed AI section → semantic light chips + teal AI.
- `[Medium]` Snapshot partial-fail: `coverageSummary.docsWithMappings` is hardcoded to 0 — no "% policies mapped" KPI. Hand-rolled `bg-white/50 border-gray-300/50` cards instead of `.card`.
- `[Medium · functional]` unlink/relink use `window.confirm`.

### Exceptions (`/governance/exceptions`)
- **Purpose:** policy-exception lifecycle (request → AI-assist → approve/reject/revoke → promote-to-risk) + posture analytics.
- **Works:** functionally the richest module (asset-weighted posture, aging, promote-to-risk, threaded comments, AutoGrow textareas).
- `[Critical]` Gradient AI-assist panel (`from-blue-50 to-indigo-50`) + heavy blue.
- `[High]` Indigo-themed AI/discover section throughout → teal.
- `[Medium]` Scroll-and-forget: charts → analytics → filters → discover → table all stacked; the actual table is below the fold with its context scrolled away → compact KPI strip + table side-by-side.
- `[Medium]` Inconsistent modals (RightSlidePanel + centered dialogs). `[Medium · functional]` create form has no expiry>effective date validation.

### Reviews (`/governance/reviews` + `/reviews/calendar`)
- **Purpose:** document-review scheduling + a governance-action queue + calendar.
- **Works:** KPI cards; overdue rows flagged; one-click "Complete Review."
- `[High · functional]` **Broken IA:** defaults to the "Actions" sub-view (not document reviews); the two top toggle buttons **both target `'actions'`** (one is dead); the **Completed tab is hardcoded to 0 / always empty**.
- `[High]` Blue active tabs; `bg-primary-600 text-black`. `[Medium]` Dark `/20` chips; type-breakdown block stacked far below the list (scroll-and-forget). Calendar: off-brand type colors incl. `text-cyan-700`.
- `[Medium · functional]` "Complete Review" has no confirm and no undo.

### Attestations (`/governance/attestations` + my / campaigns / campaigns[id] / complete[id])
- **Purpose:** attestation campaigns, personal queue, campaign detail, single-attestation completion.
- **Works:** clean KPI strip; expand-to-complete; bulk link-to-evidence.
- `[Critical · functional]` **Silent hardcoded mock data on API error** across main / campaigns / `complete[id]` — a board user could sign fabricated 2025 demo attestations. → remove or gate behind an explicit "sample data" banner.
- `[High · functional]` **`complete[id]` never uploads the selected evidence file** — only comments are posted; the required-evidence gate is cosmetic. → wire multipart upload.
- `[High · functional]` reminder/escalate/export use `alert()`; bulk reminders fire in an un-awaited `forEach`. → toasts + `Promise.all`.
- `[High]` Snapshot fails on all four pages (status/pending-actions buried at the bottom); `escalated` = `bg-purple-*`, `closed`/links = blue.

### Regulatory Changes (`/governance/regulatory-changes`)
- **Works:** 4-stat header, filters, clean table, gap flagging.
- `[High]` Gradient stat icons (`from-yellow-500/20`, `from-purple-500/20`…) + `/20 text-*-400` status/priority tokens; all 4 stat cards get `border-l-emerald-500` regardless of meaning.
- `[Medium]` `divide-slate-700` (dark divider, invisible on white). `[Medium · functional]` **Delete has no confirmation.** `updateStatusMutation` defined but never wired (dead).

### Regulatory Feeds (`/governance/regulatory-feeds`)
- **Works:** solid feed → poll → AI-analyze → convert flow; good empty states.
- `[High]` Gradient stat icons + `/20 text-*-400` tokens.
- `[Medium · functional]` per-source **Edit button has no `onClick`** (dead control); `pollSourceMutation.isPending` disables **all** poll buttons at once (should scope to the active row); fragment-as-table-row React key smell.

---

## 2. RISK MANAGEMENT (ERM + Risk)

**Three module-wide problems:** (1) two parallel risk apps `/risks/*` ≈ `/erm/*`; (2) charter palette violated on nearly every page (blue/purple/indigo brand + gradients on AI buttons); (3) the register itself fails the snapshot test.

### ERM Overview (`/erm`)
- **Works:** strong snapshot density (KPIs + interactive 5×5 heatmap + speedometer + top-10 with inherent→residual). **Passes the Snapshot Test** (the one page that does), but bloated.
- `[High]` Off-brand category hex (`strategic:#6366f1`…), blue "residual" dots, blue/violet signal tiles.
- `[High]` Scroll-and-forget: ~10 full-width stacked sections that partly re-express the same severity mix → cut to KPIs + heatmap + top-10 + KRIs + one trend; move the rest to Analytics.
- `[Medium]` Two large `{false && (...)}` dead blocks ship commented gradient code. **No posture-over-time trend** (sees *now*, not *direction*). KPI cards use `window.location.href` (full reload).

### Risk Register — dashboard (`/erm/risks` → dashboard)
- **Works:** useful drill-down (click register/source to cross-filter); donut-with-center; per-register workload bars.
- `[High]` Off-brand KPI accents (blue/amber/emerald/**purple/indigo**), blue CTAs/links, indigo chart series. View-switcher active state `bg-blue-50 text-blue-700`.

### Risk Register — flat list (`/erm/risks/list`) — **the core board artifact**
- `[High · snapshot FAIL]` **Wrong primitive:** risks render as **stacked full-width cards**; collapsed rows show no owner, no due date, no review date — you must expand each card to see L/I/S. → rebuild as a dense **sortable `.table`** (Owner / Residual / Status / Due / Last-review columns).
- `[High]` Three different row treatments (general cards, NCA table, UBL expansions) — inconsistent, training-heavy.
- `[High · functional]` `RiskModal` is a **single monster form** (title…root-cause…AI…assets + ~26 conditional UBL fields, no steps) → split into compact core + optional accordion / stepper. NCA rows open a *different* modal than standard rows.
- `[Medium]` 16 off-brand palette hits; no column sorting; filters not persisted; no bulk actions; `window.confirm` delete.

### Risk detail (`/risks/[id]`)
- **Works:** best snapshot in the register area (inherent/residual, owner, due date, reduction %). **Passes.**
- `[Medium]` Blue active tab + off-brand category badges; Edit bounces to `/erm/risks?edit={id}` (opens modal at the register root, not in place).

### `/risks` (legacy register) + `/risks/advanced` (duplicates)
- `[Critical]` Near-complete duplicates of `/erm/*`; also blue tabs + `/20` KRI badges. → **delete after consolidating nav.**

### Risk Assessments (`/erm/risk-assessments/*`)
- `[High]` Confusing manual-vs-framework split with 3+ entry points and inconsistent labels; "back to dashboard" on primary pages.
- `[High]` **Gradient AI button** on detail (`from-purple-600 to-blue-600`); blue/violet accents throughout.
- `[Critical]` `/erm/ai-risk-assessment` is a 7-line **redirect alias** (dead). `[Medium]` snapshot partial-fail (no % complete, no reviewer/approver chain, no aging).

### RCSA (`/risks/rcsa/*` — duplicated at `/erm/rcsa`)
- `[High]` **Duplicate route.** Hub itself is strong (program KPIs, pipeline, maturity radar, BU progress — **snapshot passes**) but blue CTAs + emerald/blue/purple health figures. Assessments/findings/templates carry recurring blue/purple accents; step-mode AI loads off-screen.

### Internal Controls (`/erm/internal-controls/*`)
- **Works:** 4-card metric dashboard with donuts; teal buttons; evidence linking. **Snapshot mostly passes.**
- `[High]` Detail active tab `border-blue-600`; submit/workflow buttons blue; `bg-purple-500/20` "key control" badge; violet donut fill.
- `[Medium]` Filter row not sticky (scroll-and-forget); owner not in list; **no effectiveness-trend over time**; test entry is modal-only (no inline quick-add).

### Advanced Analytics (`/erm/analytics/*`)
- `[Medium]` Overlaps ERM Overview (heatmap/KRI/category duplication). Hub icon backgrounds are **gradients**; bow-tie AI button is a **purple→blue gradient**.
- `[High]` Heatmap + Scenario snapshot-fail (distribution only, no status/trend/owner/gauge). Aggregation uses off-brand category colors + blue tab. KRI-triggers: no "acknowledge alert," no trend.

### Incidents (`/erm/incidents`) & KRIs (`/erm/kris`) *(nav-hidden but live)*
- Incidents: `[Medium]` **gradient AI-modal header** (`from-purple-500/20 to-blue-500/20`); snapshot omits reporter/owner/target-close; AI has no timeout/error path.
- KRIs: `[Medium]` threshold direction not shown (ambiguous legend); no measurement-history/trend on card; no frequency enforcement; snapshot omits owner/linked-risk/next-due.

### Vendor Risk / TPRA (`/vendor-risk/*`) — most productionized, but critical gaps
- **Works:** 11-stage lifecycle, monitoring, findings, risk-360; program dashboard + assessments board **pass the snapshot.**
- `[Critical · functional]` **TPRA unsaved-work guard is unwired** — edits in stage panels are lost silently on navigation.
- `[Critical · functional]` tiering/scoring engines run with **no pre-condition checks** (scoring with 0 responses → cryptic error).
- `[Critical]` Lifecycle rail + StageProgress active dot is `bg-blue-500`; vendor detail active tab `border-blue-600`; `_lib` domain colors hardcoded blue/purple hex.
- `[High]` Duplicate-vendor uses `window.confirm`; monitoring "new" badge blue; status badges mix blue/purple (standardize in-progress = amber); assessments-tab count shows but data gated on active tab (empty tab looks broken).
- `[Medium]` Filters not URL-persisted; no mobile card fallback for the 9-col table; risk-360 `grid-cols-5` unreadable on mobile.

---

## 3. COMPLIANCE

**IA is the headline issue here** (see §4). Palette: heavy **blue-as-brand + purple-for-AI + gradients**, and two **white-on-white** regressions.

### Frameworks — list (`/frameworks`)
- **Purpose:** compliance-posture dashboard (hero gauge, status donut, per-framework cards, domain heat-map, activity timeline) + single-framework deep-dive; journey launcher.
- **Works:** genuinely tiled + snapshot-oriented (`lg:grid-cols-2/3` with *capped* scroll areas so tiles stay side-by-side); mostly charter-clean (only ~6 residual gradients); trend-over-time present. **A good reference for the rest of Compliance.**
- `[Medium · functional]` Two overlapping "pick one framework" surfaces (per-framework cards + a separate deep-dive selector) — unclear which drives what → merge into one selection model (click card → populates deep-dive).
- `[Low]` Journey picker hides in the tab bar's `leadingAction` slot (a board user won't look there) → top-right primary button. A few residual gradients in the journey picker/tabs.

### Frameworks — detail / journey (`/frameworks/[id]`, ~4,819 lines) — **worst offender in Compliance**
- **Purpose:** certification-journey workhorse — overview KPIs, phases, CDE scope, requirements "spine," per-requirement evidence/assignment/applicability, artifacts, history.
- **Works:** requirements spine + `?req=<id>` URL mirroring (shareable, back-safe deep links); summary cards auto-collapse on scroll; history snapshots give progress-over-time.
- `[High · IA] Tab sprawl** — up to **8 top tabs** (Overview / Phases / CDE Scope / Requirements / Assigned-to-Me / Applicability / Artifacts / History) **plus** nested sub-tab state machines **plus** a full-screen requirement modal → collapse to ~4 (Overview, Requirements, Evidence/Artifacts, History); fold "Assigned to Me" into a Requirements filter, Applicability into a requirement-row action, CDE/Phases into contextual sections.
- `[High] Charter/palette** — **blue-as-brand throughout (~132 off-brand/gradient occurrences in this one file):** active tab `border-blue-600 text-blue-600`, blue KPI icons/bars, blue focus rings; **purple** Compliance-Artifacts section; a **17-color** evidence-type map (blue/purple/cyan/indigo/pink/fuchsia/lime/violet) → global blue→`primary-*`, retire multi-hue chips for slate + single teal.
- `[High] Snapshot: FAIL** — landing is a 4-KPI prose row; who's-performing + done/pending/overdue are buried in the Requirements tab and per-row modals → promote a compact status strip (compliant / in-review / to-start / overdue + owner load) to the top of Overview.
- `[Medium]` 8-tab bar relies on horizontal `overflow-x-auto` (hides tabs on tablet); mixed button systems.
- `[Medium · functional]` in-progress justification silently discarded on tab switch (warn on dirty-close); `[Low · functional]` a heavy AI "auto-generate phases" mutation fires as a side-effect on load without explicit intent.

### Controls (`/controls` — REVAMPED, reference standard)
- **Works:** zero gradient/off-brand violations; teal + semantic; animated tile popup; control-health snapshot. Aligned.

### Assessments (`/compliance/assessments` + `[id]` + `approvals`)
- **Works:** Overview tab is dashboard-grade (health gauge, status donut, side-by-side) — **snapshot passes on Overview**; data-driven format tabs; slide-over upload.
- `[Critical · functional]` **Assessment detail imports 4 tabs (NCA / Artifacts / DCC / Audit-Plan) that are unreachable** — no tab bar renders, `setActiveTab` never called. Dead features.
- `[High · functional]` **Assessment status is read-only** (no draft→in_progress→completed control). `[High · functional]` Large blocks of **dead computed charts** (monthly trend / Sankey / timeline / sunburst never rendered) — this is exactly the "progress over time" the snapshot wants, computed but hidden.
- `[High]` Blue-as-brand everywhere + **red→amber→green gradient** on the health gauge + purple AI accents; **Approvals uses dark `*-500/20 text-*-400` chips**.
- `[High]` **Approvals snapshot FAIL** (no pending count / aging / per-reviewer) and it's **not discoverable from the Assessments module** (only via the global header bell). Client-side search over a server-paginated list (misleading). Redundant per-row Eye "view" duplicates the row click.

### Evidence (`/evidence` — REVAMPED workspace + D1 detail, aligned) + legacy sub-pages
- **Works:** the 5-view workspace + Snapshot + split D1 detail are charter-clean references.
- `[Medium]` View sprawl (5 views; Performance overlaps Snapshot and has 2 permanently "not yet tracked" columns) → fold to 4.
- `[Critical]` **`evidence/audit-packages` renders white-on-white** (`text-white` titles/cells on white) — unreadable; plus blue accents, `/20` tints, `alert()`/`confirm()`, an alert-box "download URL."
- `[High]` **`evidence/coverage` (legacy)** — gradients on all 5 stat cards, raw green/yellow/red, `bg-gray-800` tooltip, dark `/20` chips; **"Add Evidence" button is dead**; orphaned from the workspace nav.

### Control Library (`/control-library` + `[id]` + coverage/gaps/compare/evidence/review)
- **Purpose:** AI-normalized, de-duplicated "Unified Control Library."
- `[High]` Index: gradients everywhere (hero, banners, every stat tile/icon), off-brand KPI accents, **8 admin actions exposed at once** (Baseline/Populate/Create-Group/session mgmt), and heavy jargon ("Unified/Normalized/Promote/Populate") that fails "zero-training." "Completion" ring is **metadata completeness, mislabeled as compliance posture** (snapshot partial-fail).
- `[High]` `[id]`: declares 2 tabs but renders 4 tab bodies (Similarity/Evidence unreachable); rainbow control-type coding; framework/parsed model conflation (latent correctness trap).
- `[Critical]` **`control-library/evidence`:** white text on teal (illegible), a `bg-gray-800` surface inside a white modal, gradient KPI chips, **row "Link" action does nothing**, invalid `<tr>`-in-fragment JSX, client-only type filter over server pagination.
- `[High]` `gaps` + `coverage`: blue-as-brand, mismatched split tab indicators, **~150 lines of dead `{false && …}` chart code**, references to removed tabs, three different coverage-threshold bandings (33/66 vs 34/67 vs 50/80) — **not reconciled**.
- `[Medium]` `review` is the **most on-charter surface** (teal/slate/semantic only) but is only reachable from one header button — **hidden**.
- `[High · IA]` The five sub-tabs are **not a tab bar** (no `layout.tsx`), not in the sidebar, each reachable from exactly one link — five substantial analytics surfaces effectively hidden (scroll-and-forget at the IA level).

---

## 4. IA decisions I need from you (before Phase 3)

These are structure decisions, not restyles — I want your call:

1. **`/risks/*` vs `/erm/*` duplication [Critical].** Recommend: make `/erm/*` canonical, redirect/delete the `/risks` register, `/risks/advanced`, the `/erm/rcsa`↔`/risks/rcsa` duplicate, and the `ai-risk-assessment` alias (~5,000 lines removed). Confirm?
2. **Controls vs Control Library [High].** Genuinely different objects — `/controls` = per-framework raw catalog (`FrameworkControl` rows); `/control-library` = AI-normalized de-duplicated families (`ControlGroup`) — but they sit back-to-back in the Compliance nav, both show "Evidence Coverage %," and the **smoking gun: both are gated on the identical permission `controls:control_library:*`** (`Sidebar.tsx:133` & `:137`). A board user cannot predict which to open. Recommend: **merge into one "Controls" destination with a Catalog ⇄ Unified toggle** (or at minimum rename "Framework Controls" vs "Unified Library" + split the permissions + de-dupe the shared KPIs). Confirm the merge-vs-rename direction?
3. **Control-Library sub-tabs [High].** Recommend: add a real `control-library/layout.tsx` tab bar (Coverage / Gaps / Compare / Review), **fold `control-library/evidence` into the global `/evidence` module** (or rename unmistakably), and reconcile the three coverage numbers into one authoritative figure. Confirm?
4. **Whole-of-Compliance IA [High] — the group is incoherent.** Six siblings (Frameworks, Controls, Assessments, Evidence, Control Library) with heavy overlap: three surfaces onto "controls/requirements" (Controls, Control Library, Frameworks→Requirements) and **five** evidence surfaces (top-level Evidence + evidence inside Frameworks, Assessments, Control Library, Auditor Portal), with approvals on yet another page. Proposed target: **four coherent surfaces** — *Frameworks* (posture + journeys; Requirements/Applicability/Artifacts as sections not tabs), *Controls* (single merged catalog+unified), *Assessments* (with inline approvals), *Evidence* (one library, all approvals). Endorse this target so Phase 3 has a north star?
5. **Evidence view count.** Fold Performance into Snapshot (5→4 views)? Retire the legacy `evidence/coverage` + `audit-packages` pages into the workspace, or revamp them in place?
6. **ERM Overview vs Advanced Analytics.** Trim the Overview to one screen and move the redundant charts into Analytics? Confirm.

---

## 5. Proposed revamp order (Phase 3)

Ordered by user-visible risk × leverage, honoring your Governance → Risk → Compliance sequence:

1. **Global foundations (Phase 2 design system)** — the palette sweep + shared components (stat tile, status chip, `.table`, master-detail, snapshot strip, in-app confirm/toast) so every module revamp reuses them.
2. **Governance:** Reviews (fix broken toggle + empty tab) → Attestations (kill mock data + wire evidence upload) → Exceptions → Mappings → Regulatory Changes/Feeds. *(Documents + Committees already done — spot-fix residuals.)*
3. **Risk:** consolidate the IA first (decision #1) → rebuild the **Risk Register as a table** → ERM Overview trim + palette → Internal Controls → Risk Assessments → RCSA → Analytics → Incidents/KRIs → Vendor/TPRA (wire the unsaved-guard + engine pre-conditions).
4. **Compliance:** resolve IA (decisions #2–3) → **Frameworks** (biggest offender) → Assessments (unhide dead tabs, make status editable, render the trend) → Control Library (de-jargon + tab bar) → retire/relocate legacy Evidence sub-pages.

**Highest-leverage quick wins to do first (small, high-impact, low-risk):** the palette/gradient sweep (Phase 2), the white-on-white fixes (`audit-packages`, `control-library/evidence`), the attestation mock-data + evidence-upload bugs, the dead buttons (coverage/evidence "Add"/"Link", regulatory-feeds edit), and replacing `alert()`/`confirm()` with the app's toast/modal.

---

*End of Phase 1 audit. Awaiting your review + the §4 IA decisions before proceeding to Phase 2 (Design System).*
