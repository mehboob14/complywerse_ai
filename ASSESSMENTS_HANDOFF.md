# ComplyVerse — Compliance Assessments: Handoff / Continuation Prompt

You are continuing work on the **ComplyVerse GRC platform**. This document is the full brief: what the product is, the stack, what's been built, what's broken, what to build next, and the exact UI target (the Asset Inventory table) we are matching. Read it fully before changing code.

---

## 1. Product & goal

ComplyVerse is a multi-tenant GRC (Governance, Risk, Compliance) platform. We are working on the **Compliance Assessments** module: users upload assessment workbooks (Excel/CSV/PDF from banks, regulators, auditors), the system parses them into **assessments → domains → items (controls)**, and users score each item, attach evidence, get AI help, and track remediation.

The current mission: **make the Assessments UI high quality and consistent with the Asset Inventory pages.** The user has repeatedly said the assessment screens look "messy/poor" and wants a **proper columns/rows table** for items (like the Asset Inventory), clean dashboards, and a polished Overview.

---

## 2. Stack & environment

- **Backend:** FastAPI, SQLAlchemy. Multi-tenant **database-per-tenant** (`grc_{slug}`, master DB `grc_master`). Models are the source of truth — **no Alembic**; idempotent self-heal migrations add columns via `_COLUMN_ADDS` tuples in `backend/grc/modules/compliance/schema_migrations.py` (and `modules/identity/schema_migrations.py`).
- **Frontend:** Next.js App Router, React Query (`@tanstack/react-query`), axios (`@/lib/api`), recharts, Tailwind. Uses a system side drawer `@/components/ui/RightSlidePanel` ({ isOpen, onClose, title, subtitle?, children, width?, footer? }).
- **Ports / wiring:** Backend on **4000**, served under a **`/grc`** prefix. Frontend on **3000**; `next.config` rewrites `/api/:path*` → `${BACKEND_URL}/grc/:path*`. Postgres on **5433**.
- **Tenant:** `complyverse`. **Login:** `POST /grc/auth/login` with JSON `{username, password}` (NOT form-encoded) + header `X-Tenant-Slug: complyverse`. Admin: `admin@complyverse.io` / `Admin@12345`.
- **Run backend (it is flaky — crashes between sessions):** start detached with env `DISABLE_EMBEDDED_WORKFLOW_RUNTIME=1` and `DISABLE_COMPLYCHAT_EMBED_WORKER=1`, working dir `backend`, `python main.py`.
- **Repo:** github.com/mehboob14/complywerse_ai. Local root: `c:\Users\HP\OneDrive\Desktop\GRC 1\complywerse_ai`.

### Critical gotchas (these wasted hours)
- **Backend dies often.** If any tab shows an endless spinner / "error", the backend is almost always down → restart it (detached, with the DISABLE flags). It is NOT a frontend bug.
- **Frontend serves STALE content** after a dev-server crash/HMR break — you'll edit code, verify it's in the file, but the browser still shows the old UI. Fix: kill node on 3000, `rm -rf grc-frontend/.next`, restart `npm run dev`, then **hard-refresh** the browser.
- **JSX:** adjacent sibling elements inside `{cond && ( … )}` MUST be wrapped in a `<>…</>` fragment, or SWC throws `Unexpected token 'div'. Expected jsx identifier` pointing at the component's main `return` (misleading location).
- **TSX parsing:** avoid fancy inline type annotations like `(f: (typeof X)[number]) => …`; keep types plain (`string`) to avoid parser desync.
- Verify compiles with `GET http://localhost:3000/compliance/assessments` and `…/assessments/6` (must return 200).

---

## 3. Key files

| Purpose | Path |
|---|---|
| Assessments list + Overview + tabs + upload modal | `grc-frontend/src/app/(dashboard)/compliance/assessments/page.tsx` |
| Assessment **detail** (dashboard + domains + items table + Add Item) | `grc-frontend/src/app/(dashboard)/compliance/assessments/[id]/page.tsx` |
| PDPL dedicated tab (its own dashboard) | `grc-frontend/src/components/compliance/PDPLAssessmentTab.tsx` |
| NCA dedicated tab | `grc-frontend/src/components/compliance/NcaTab.tsx` |
| Artifacts (per-framework templates) | `grc-frontend/src/components/compliance/ArtifactsTab.tsx` |
| Backend router (parse/CRUD/AI/evidence) | `backend/grc/routers/compliance_assessments_router.py` |
| Item model | `backend/grc/models/_30_compliance_assessment_documents_models.py` |
| Migrations | `backend/grc/modules/compliance/schema_migrations.py` |
| **UI TARGET — Asset Inventory list** | `grc-frontend/src/app/(dashboard)/assets/page.tsx` |
| **UI TARGET — Asset detail** | `grc-frontend/src/app/(dashboard)/assets/[id]/page.tsx` |

---

## 4. Data model

- `ComplianceAssessmentDocument` (the assessment): `name, assessment_type, assessment_format, status, overall_score, total_items, complied_count, partially_complied_count, not_complied_count, in_progress_count, na_count, source, assessor, due_date, created_at`.
- `ComplianceAssessmentDocumentItem` (a row/control): `item_number, area_domain, control_description, compliance_status (complied|partially_complied|not_complied|in_progress|na), gaps_identified, proposed_solution, responsible_party, timeline, priority, evidence_reference, remarks, maturity_score, risk_rating, remediation_status`.
- `assessment_format` values: `standard, xlsx_maturity, asvs_checklist, owasp_v4_testing_checklist, ubl_audit_master_tracking` (= "Internal Audit"), `nca_container`, `pdpl_assessment_toolkit`, `cis_*`, `nca_*_pdf`.
- **Domains** = distinct `area_domain` values. For Internal Audit (`ubl_audit_master_tracking`), domains group via `getAuditMasterDomainGroup()` (prefix before `" - "`).
- **There is NO per-domain field schema.** All items share the same columns. "Each domain's fields" is currently **inferred** from which optional columns that domain's existing rows actually populate (`domainFieldUsage` in the detail page).
- Key endpoints: `GET /compliance/assessments` (list; **excludes** `nca_container` + `pdpl_assessment_toolkit` unless `assessment_format=` passed), `GET /compliance/assessments/{id}` (returns `items_by_domain: Record<domain, item[]>` + `items[]`), `PUT /compliance/assessments/items/{id}`, `POST /compliance/assessments/{id}/items`, `POST …/items/{id}/ai-assess?gap=` (PDPL), `POST …/items/{id}/ai-recommendation` (generic), `…/items/{id}/evidence` (+ `/link`, `/upload`).

---

## 5. THE UI TARGET — Asset Inventory pattern (replicate this)

Study `assets/page.tsx` + `assets/[id]/page.tsx`. The canonical ComplyVerse layout we must match:

1. **Top KPI dashboard:** 2–3 metric cards (donut/ring/radar) summarizing the list.
2. **Filter + action bar:** left = `SearchInput`; middle = single-select `MultiSelectDropdown` filters; right = Download / Import / **+ Add** buttons.
3. **Flat data `<table>` with real columns**, using **`table-fixed` + `<colgroup>`** for precise, uniform widths. Columns are compact; long text is truncated. Responsive columns hidden at md/lg. Row = icon + primary name + small description, badges (type/criticality/status), action icon buttons, and a **chevron to expand inline** a label/value detail grid.
4. **Row click → detail page:** header (back + name + badges + actions) → 4 KPI cards → **horizontal tab bar** (Details, Controls, Evidence, Vulnerabilities, Risks, …) → tab content. Create/Edit via modal/drawer with `ComboBoxInput`.

**The user wants the assessment *items* rendered exactly like the inventory table:** compact uniform rows, aligned columns, expand-in-place for detail. Reuse `table-fixed` + `colgroup` so columns don't drift and the Control column doesn't dominate.

---

## 6. What has been DONE (this is already in the code)

- **PDPL Assessment** (`PDPLAssessmentTab.tsx`): full dashboard (hero ring, KPIs, clickable "Compliance by domain", maturity radar + numbered legend, status mix, risk spread, "Fix these first" / "Quick wins"), Controls tab, Remediation Plan, Artifacts. Per-control **side panel** with tabs **Guidance → Evidence → Artifacts → Assess → Remediation**. AI drafts remediation **from the user's typed gap** (`ai-assess?gap=`). Per-control **linked artifacts** come from the toolkit's "Evidence to Request" column (verified 47/47). Source-document downloads (law PDF + toolkit xlsx) in header.
- **Generic assessment evidence/AI** moved into the system `RightSlidePanel` (AI Suggestions / Evidence tabs).
- **NDMO** framework support (priority_level P1/P2/P3 + dependencies; controls page native tree). Pushed in PR #1.
- **Tabs:** "All Assessments" tab **removed**. Header = Overview · per-format tabs · NCA · PDPL. **All supported templates now always show** as tabs (merge `FORMAT_TAB_META` keys with uploaded formats), each with its own Upload button.
- **Overview = per-assessment cards** (one card per assessment, **including NCA + PDPL** fetched via explicit `assessment_format` queries; deduped). Each card: compliance ring + status legend + assessed% + gaps + controls. NCA→NCA tab, PDPL→PDPL tab, others→detail. **No aggregation** is the user's rule.
- **Detail page:**
  - Removed the left domain **sidebar** (user hated it). Domains are **collapsible sections** + a **filter bar** (search + Status + Priority).
  - **Items converted to a `<table>`** (header: Item# · Control · Responsible · Timeline · Status · Priority · Actions, with a chevron expand). Expand row shows the editable **Control Information** grid (Responsible, Timeline, Remarks, Gaps, Proposed Solution, Area/Domain, Priority) + full control text. Evidence/AI open the side panel via row buttons.
  - **Top dashboard redesigned** PDPL-style: **hero ring** (overall %) + readiness badge + verdict + status-mix bar + Complied/Partial/Not Complied/In Progress chips, plus a single **"Domain breakdown"** list. Removed the old redundant "Status Coverage" donuts + duplicate "Category Coverage".
  - **Add Item** form: Area/Domain is a **dropdown of existing domains** (+ "New domain"); selecting a domain renders **only that domain's inferred fields**. A **"+ New Domain"** button opens the form in new-domain mode.

---

## 7. What is BROKEN / TO DO (priority order)

1. **Overview must have NO aggregation (user repeated this emphatically).** A "summary hero strip" (overall ring + KPI tiles across all assessments) was added near the top of the Overview in `page.tsx` (around the `{/* ── Summary hero across all assessments ── */}` block / `overviewSummary` memo). **REMOVE that hero block** and the `overviewSummary` memo; keep only the per-assessment cards. Then **polish the card colors/visuals** (the user finds them "too poor").
2. **Items table → make it truly inventory-grade.** Apply `table-fixed` + `<colgroup>` with explicit widths so columns are uniform and the Control column doesn't push the others into a big gap; compact row height (clamp control to 2 lines — already started); badges for status/priority; align with `assets/page.tsx` styling. This is the user's #1 ask ("I want column/rows kind of table here, like the asset inventory").
3. **PDPL dashboard empty space:** there is an empty gap under a card (maturity radar / compliance-by-domain card). Tighten the card so content fills it.
4. **Polish all assessment pages** to high UI quality, consistent with Asset Inventory (spacing, typography, badges, hover states).
5. **(Larger, optional) True per-domain custom columns:** today fields are inferred. If the user wants domains to have genuinely different, user-defined columns (a column that exists on one domain but not others), that needs a backend addition (store per-domain column definitions + row values as flexible JSON) + UI to define columns. Confirm scope before building.

---

## 8. How to work (process the user expects)
- Make a change → verify it compiles (HTTP 200 on the route) → check `grc-frontend/_fe_dev.err.log` for syntax errors → tell the user to hard-refresh.
- If the user says "nothing changed / still old", suspect **stale dev server** (clear `.next`, restart) or **backend down** (restart) before assuming your edit failed.
- The user iterates fast and visually; prefer small verified passes over giant edits. Confirm scope on ambiguous/large UX changes, but don't re-litigate settled decisions (no-aggregation Overview; inventory-style item table; domains-first detail).

Begin by (1) removing the Overview aggregation hero, then (2) upgrading the items `<table>` to the `table-fixed`+`colgroup` inventory pattern.
