# GRC Platform — UI/UX Design Reference

A complete, build-ready reference of the platform's design system, components, dashboards, and key module screens. Use it to recreate the same **professional UI/UX in another project with a different brand colour**.

> **Stack:** Next.js (App Router) · React 18 · TypeScript · Tailwind CSS · lucide-react (icons) · Recharts (charts) · @tanstack/react-query (data).
> **Font:** Poppins (`--font-poppins`), monospace for codes/IPs/CVEs.

---

## 0. How to re-brand (read this first)

The whole platform themes off **two** colour layers. To change the brand colour you touch only these:

1. **CSS design tokens** — `grc-frontend/styles/tokens.css`. A single `:root` block of CSS variables. Every `.cw-*` class and the `.platform-ui` override layer reads `var(--color-*)`. Change `--color-base` (+ its `-strong`, `-soft`, `sidebar-active-*`) and the brand re-skins instantly.
2. **Tailwind theme** — `grc-frontend/tailwind.config.ts` → `theme.extend.colors.primary` (50–900 ramp). This backs every `bg-primary-600 / text-primary-600 / ring-primary-500` utility.

Keep these **semantic** (do not rebrand): `severity.*`, `success/warning/danger/info`, and the status-lifecycle colours — they carry meaning (red = critical, green = pass), not brand.

```
Current brand = teal/mint  #1ed4b0
→ set tokens.css  --color-base / --color-base-strong / --sidebar-active-bg
→ set tailwind    primary.500 / primary.600 (and the ramp)
```

---

## 1. Design Tokens

### 1.1 Brand & surface (CSS variables — `styles/tokens.css`)

```css
:root {
  /* Brand */
  --color-base:        #1ed4b0;   /* primary action / active state */
  --color-base-strong: #17b898;   /* hover / pressed */
  --color-on-base:     #0A0A0A;   /* text on brand fills */
  --color-base-soft:        rgba(30,212,176,0.10);
  --color-base-soft-strong: rgba(30,212,176,0.15);

  /* Surfaces & text */
  --color-surface: #FFFFFF;       /* cards, panels */
  --color-subtle:  #F1F3F5;       /* zebra rows, inputs, tracks */
  --color-border:  #DDE1E7;
  --color-text:    #1A1A1A;
  --color-muted:   #6B7280;
  --color-text-inverse: #FFFFFF;
  --color-overlay: rgba(10,25,35,0.55);   /* modal scrim */

  /* Semantic (accessible, muted) */
  --color-success: #2D6A4F;
  --color-warning: #92570E;
  --color-danger:  #9B1C1C;
  --color-success-soft: rgba(45,106,79,0.1);
  --color-warning-soft: rgba(146,87,14,0.1);
  --color-danger-soft:  rgba(155,28,28,0.1);

  /* Document lifecycle status */
  --color-status-draft:     #64748B;
  --color-status-review:    #EAB308;
  --color-status-approval:  #F59E0B;
  --color-status-approved:  #3B82F6;
  --color-status-published: #10B981;
  --color-status-expired:   #F43F5E;
  --color-status-archived:  #6B7280;

  /* Sidebar */
  --sidebar-bg: #FFFFFF;  --sidebar-icon: #4B5563;
  --sidebar-hover-bg: #E2E8F0;  --sidebar-active-bg: #1ed4b0;  --sidebar-active-border: #1ed4b0;

  /* Geometry */
  --radius-md: 6px;  --radius-lg: 8px;
  --space-2: 8px;  --space-4: 16px;  --space-5: 20px;  --space-6: 24px;
}
```

### 1.2 Tailwind palette (`tailwind.config.ts`)

```ts
colors: {
  primary: { 50:'#e8fcf8',100:'#cef8f0',200:'#9ef1e3',300:'#6de8d4',400:'#3ddfc2',
             500:'#1ed4b0',600:'#1ed4b0',700:'#17b898',800:'#109880',900:'#086e5b' },
  surface: { 50:'#f8fafc' … 900:'#0f172a',950:'#020617' },   // = slate ramp
  success: { 50:'#f0fdf4' … 500:'#22c55e',600:'#16a34a',700:'#15803d' },
  warning: { 50:'#fffbeb' … 500:'#f59e0b',600:'#d97706',700:'#b45309' },
  danger:  { 50:'#fef2f2' … 500:'#ef4444',600:'#dc2626',700:'#b91c1c' },
  info:    { 50:'#ecfeff' … 500:'#06b6d4',600:'#0891b2',700:'#0e7490' },
  severity:{ critical:'#dc2626', high:'#f97316', medium:'#eab308', low:'#3b82f6', info:'#64748b' },
}
```

### 1.3 Typography

| Token | Size / line-height | Use |
|---|---|---|
| `text-2xs` | 0.625rem / 0.875rem | micro-labels, pills |
| `text-xs` | 0.75rem / 1rem | helper text, table cells, badges |
| `text-sm` | 0.875rem / 1.25rem | body, inputs, buttons |
| `text-base` | 1rem / 1.5rem | section body |
| `text-lg` | 1.125rem | card titles |
| `text-xl` | 1.25rem | page H1 |
| `text-2xl`–`5xl` | 1.5–3rem | hero stats |

Headings (global): `h1` = `text-xl font-semibold text-slate-900 tracking-tight`; `h2` = `text-lg font-semibold`; `h3` = `text-base font-semibold`. Body line-height `1.45`, antialiased, bg `slate-50`.

### 1.4 Spacing, radius, shadow, motion

- **Spacing scale:** Tailwind default + custom `4.5 (1.125rem)`, `5.5`, `18 (4.5rem)`, `22`. Page padding `p-4 sm:p-5`; card padding `p-4`; section gutter `space-y-4`/`space-y-6`; grid gap `gap-3`/`gap-4`.
- **Radius:** inputs/buttons `rounded-lg` (8px) · cards `rounded-xl` (12px) · pills/badges `rounded-full` · modal `rounded-2xl`. Token equivalents `--radius-md 6px / --radius-lg 8px`.
- **Shadows:** `card` (0 1px 3px), `card-hover`, `elevated`, `modal` (0 25px 50px -12px), `sidebar`.
- **Animations (keyframes in config):** `fade-in`, `slide-up`, `slide-down`, `scale-in`, `pulse-slow`, `spin-slow`. Loader uses bespoke `pageLoaderDot/Halo/Spin` keyframes (12-dot wave).

### 1.5 Theming architecture (important)

Pages opt into a **theme scope class** on their root wrapper, which forces a clean light theme and remaps utility classes to tokens:

| Scope class | Applied on | Effect |
|---|---|---|
| `.platform-ui` | app shell | Remaps `bg-white/bg-slate-* → --color-surface`, `text-slate-* → --color-text/--color-muted`, `bg-blue-600/bg-primary-600 → --color-base`, etc. **This is what makes a single token swap re-skin everything.** |
| `.cw-dashboard`, `.governance-light` | dashboards/governance | Tightened density + token-mapped tables, badges, tabs. |
| `.assets-light` | Assets module | Forces white surfaces, blue-tinted borders (`#bfdbfe`), black text. |
| `.audit-light`, `.dashboard-light` | Audit / dashboard | Force-light overrides for dark-authored markup. |
| `.compact-density` | density toggle | Shrinks paddings/gaps/font-sizes platform-wide. |

Reusable token-backed classes: `.cw-card`, `.cw-btn-primary/secondary/success/danger/neutral`, `.cw-field` (inputs), `.cw-label`, `.cw-tab/.cw-tab-active`, `.cw-modal-panel`, `.cw-overlay`, `.cw-status-*` (lifecycle pills), `.cw-icon-badge-{base,success,warning,danger}`, `.cw-progress-track/-fill-*`.

---

## 2. Core Components (`grc-frontend/src/components/ui/`)

Exported from `components/ui/index.ts`: `StatCard, TrendIndicator, ProgressRing, MetricBadge, FilterBar, SeverityBadge, StatusBadge, DataCard, Breadcrumb, PageHeader, DataTable, Toast, ToastProvider, RightSlidePanel, MultiSelectDropdown, SearchInput, InlineLinkPicker, PermissionGuard, PageLoader, ComboBoxInput`.

### 2.1 Buttons

```jsx
/* Primary */   className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
/* Secondary */ className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
/* Token form */.cw-btn-primary  // bg var(--color-base), min-h 2.5rem, gap .5rem, radius md
```
> Under `.platform-ui`, `bg-blue-600`/`bg-primary-600` auto-map to the brand token — so you can author with either.

### 2.2 Inputs (standard pattern, repeated everywhere)

```jsx
className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900
           placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
/* label */ className="block text-sm font-medium text-gray-800 mb-1"
/* required */ <span className="text-red-500">*</span>
```
Connector/wizard variant: `…px-3 py-2.5 shadow-sm focus:border-blue-600 focus:ring-2 focus:ring-blue-100`.

### 2.3 Card

```jsx
<div className="rounded-xl border border-gray-200 bg-white p-4">…</div>
/* hover-interactive */ + "hover:shadow-md transition-all"
```

### 2.4 StatCard (KPI)

```jsx
<StatCard title="Risk Exposure" value="128" subtitle="42 open" icon={AlertTriangle}
          variant="danger" trend={{ direction:'up', value:5 }} onClick={…} />
```
Renders: `rounded-xl border bg-white p-3.5` · icon chip (`text-primary-600`) · value `text-xl font-bold text-black` · title `text-sm font-medium text-slate-600` · trend pill. Variants: `default | success | danger | warning | info` (drive border + glow + icon colour).

### 2.5 Badges

```jsx
/* generic pill */  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {bg} {text}"
/* StatusBadge */   <StatusBadge status="open" size="md" />   // maps status→{bg,text,border,icon}
/* SeverityBadge */ <SeverityBadge severity="critical" />
```
StatusBadge config (excerpt): `open` red-50/600/200, `in_progress` yellow-50/600/200, `verified` green-50/600/200. Sizes `sm: px-1.5 py-0.5 text-xs` → `lg: px-2.5 py-1 text-sm`.

### 2.6 RightSlidePanel (the standard create/edit drawer)

```jsx
<RightSlidePanel isOpen={open} onClose={close} title="New Risk" subtitle="…"
                 width="w-full max-w-[780px]" footer={<Actions/>}>
  …form…
</RightSlidePanel>
```
Structure: scrim `absolute inset-0 bg-black/40` · panel `relative ml-auto h-full flex flex-col bg-white shadow-2xl transition-transform duration-300` toggling `translate-x-0` / `translate-x-full` · header `border-b px-6 py-4` (title `text-lg font-semibold`) · body `flex-1 overflow-y-auto px-6 py-5` · footer `border-t px-6 py-4`. (Under `.governance-light` it becomes a full-height right drawer ≤760px on desktop.)

### 2.7 SearchInput

```jsx
<SearchInput value={q} onChange={setQ} variant="pill" size="md" placeholder="Search risks…" />
```
Leading `Search` icon, clearable `X`, `rounded-full` (pill) or `rounded-lg` (square); focus `border-primary-500 ring-2 ring-primary-500/15`.

### 2.8 MultiSelectDropdown (filters + pickers)

```jsx
<MultiSelectDropdown title="Status" items={[{value,label,subLabel}]} selectedValues={sel}
   onApply={setSel} multiSelect={false} size="md" triggerVariant="pill" />
```
Pill trigger `rounded-full border` (active → `border-primary-500` + count chip `bg-primary-100 text-primary-700`); portal dropdown `z-[9999] rounded-xl border bg-white shadow-xl` with optional search, checkbox rows `rounded-lg px-2 py-2 hover:bg-slate-50`, avatar initials, `Check` on selected.

### 2.9 PageLoader

12 dots arranged in a circle, staggered `pageLoaderDot` wave + breathing halo + slow spin. Props `size`, `label`, `inline`.

### 2.10 Page header / filters row (layout idiom)

```jsx
<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
  <div>
    <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Risk Register</h1>
    <p className="text-xs sm:text-sm text-gray-600 mt-0.5">…</p>
  </div>
  <button className="btn-primary …"><Plus className="h-4 w-4"/> New</button>
</div>

<div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
  <SearchInput … className="flex-1 min-w-[180px]"/>
  <MultiSelectDropdown title="Status" …/>
  <MultiSelectDropdown title="Priority" …/>
</div>
```

---

## 3. Dashboards

**File:** `app/(dashboard)/dashboard/page.tsx` + `dashboard/components/` (`ModuleSubWidgets.tsx`, `FrameworkComplianceCards.tsx`). Charts = **Recharts**.

### 3.1 Structure
Single-scroll executive view (not tabbed) inside `space-y-4 min-h-screen bg-white p-4 sm:p-5`:
1. **KPI strip** — `grid grid-cols-2 sm:grid-cols-5 gap-3` of stat cards.
2. **Executive panels** — `grid grid-cols-1 lg:grid-cols-2 gap-4` (Risk Posture clock, Compliance, Audit Readiness, etc.).
3. **Framework compliance cards** — `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3`, paginated/expandable.
4. **Module sub-widgets** — expandable donut widgets (Vulnerabilities, Assets, Governance, Tasks): collapsed = KPI, expanded = donut + status breakdown.
- **Customisation:** `WidgetWorkspace` lets users hide/reorder cards (per-tab visibility state).

### 3.2 Widget catalogue

| Widget | Renders with | Represents |
|---|---|---|
| **Stat/KPI card** | custom JSX | one metric + trend (e.g. "Compliance 87% ▲5") |
| **Donut / sunburst** | Recharts `PieChart` (2 nested `Pie`) | distribution (severity, status, asset type); centre label = total |
| **Gauge / speedometer** | Recharts `PieChart` half-ring or SVG | score 0–100 (Risk Posture, SLA %), colour by band |
| **Radar** | Recharts `RadarChart` | multi-dim profile (COSO components, CIA by type) |
| **Bar** | Recharts `BarChart` (`layout="vertical"`, `barSize 14`) | category counts |
| **Line/Trend** | Recharts `LineChart` | time-series (risk/compliance over time) |
| **Progress bar** | `h-1.5 rounded-full bg-gray-100` + inner fill | single % |
| **Data table** | `DataTable` | issues / tasks / evidence lists |
| **Expandable widget** | custom state | collapsed KPI → expanded breakdown |

### 3.3 Representative chart code

```jsx
/* Donut (nested rings) */
<ResponsiveContainer width="100%" height="100%">
  <PieChart>
    <Pie data={ring} cx="50%" cy="50%" innerRadius={72} outerRadius={128}
         dataKey="value" paddingAngle={2} stroke="white" strokeWidth={2} labelLine={false}>
      {ring.map((e,i)=><Cell key={i} fill={e.color}/>)}
    </Pie>
    <Tooltip/>
  </PieChart>
</ResponsiveContainer>

/* Radar */
<RadarChart data={radarData} outerRadius={80}>
  <PolarGrid stroke="#e5e7eb"/>
  <PolarAngleAxis dataKey="subject" tick={{fontSize:10, fill:'#6b7280'}}/>
  <Radar dataKey="A" stroke={accent} fill={accent} fillOpacity={0.2} strokeWidth={2}/>
</RadarChart>
```

### 3.4 Section header + chart colours
```jsx
<div className="flex items-center justify-between mb-3">
  <div><h2 className="text-sm font-semibold text-black">{title}</h2>
       <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p></div>
  <Link className="text-[11px] text-blue-600 hover:underline">View</Link>
</div>
```
Chart palette: success `#22c55e`, warning `#f59e0b`, critical `#ef4444`, info `#06b6d4`, primary `#3b82f6`. Severity donut: critical `#ef4444`, high `#f97316`, medium `#eab308`, low `#3b82f6`, info `#94a3b8`.

---

## 4. Module — Risk Register

**Page:** `app/(dashboard)/erm/risks/list/page.tsx` · **Model:** `grc_risks`. Modal = `RightSlidePanel max-w-[780px]`. List = card-based collapsible rows + 5×5 heatmap panel.

### 4.1 Form fields

| Field | Label | Input | Options / notes |
|---|---|---|---|
| `title` | Risk Title | text | required |
| `description` | Risk Description | textarea | |
| `register_type` | Risk Register Type | select | Template, NCA Template, PCI-DSS, ISO 27001, SOX, GDPR, NIST, SAMA CSF, Internal, Project-Based, Third-Party, Other |
| `risk_category` | Risk Category | select (required) | Strategic, Operational, Financial, Compliance, Technology, Third Party, Project/Change, Internal *(UBL set: Technology, Third Party, ISMS, Process, Other)* |
| `risk_sub_category` | Sub-Category | datalist | dynamic per category |
| `business_owner_id` | Business Owner | user-select | from `/admin/users` |
| `affected_department_ids` | Affected Departments | multiselect | from Teams |
| `team_id` | Owning Team | select | from `/admin/teams` |
| `status` | Status | select | open, in_treatment, mitigated, accepted, closed |
| `inherent_likelihood/impact` | Inherent L / I | number 1–5 | default 3 |
| `residual_likelihood/impact` | Residual L / I | number 1–5 | default 2 |
| `treatment_plan` | Treatment Plan | textarea | |
| `root_cause` | Root Cause | textarea | AI-assist "Save to field" |
| `recommendations` | Recommended Actions | textarea | AI-assist "Save to field" |
| `linked_assets` | Linked Assets | searchable multiselect | links to IT Assets |

**UBL Template** adds 3 sections (Risk Identification / Analysis / Treatment) with fields like Source, Location (select), Asset Criticality, Externally Exposed (Yes/No), Vulnerability Count (number), Recommended Controls, Mitigation Option (Mitigate/Transfer/Accept/Avoid), Implementation Status, etc. **NCA Template** uses a compact table + per-row detail with risk_cause, threat, risk_analysis, inherent/residual ratings, treatment, following_steps.

### 4.2 List columns & badges
Card header: **Title** (→ `/risks/{id}`) · **Category** pill · **Sub-category** pill · **Status** pill · **Source** pill (manual/assessment/incident/rcsa/framework_gap/ubl_import/nca_import, each its own colour+icon) · **Inherent/Residual score** pills. Expand → Inherent (L/I/S), Residual (L/I/S), treatment, UBL/NCA field grid.

**Status colours:** open `red`, in_treatment `yellow`, mitigated `green`, accepted `blue`, closed `slate`.
**Score pill bands:** 0–5 green · 6–11 yellow · 12–19 orange · 20+ red.
**Heatmap:** 5×5 (Likelihood Y 5→1, Impact X 1→5), cell colour green→yellow→orange→red by L×I; click cell to filter.

### 4.3 Backend columns (`grc_risks`)
`id, tenant_id, business_unit_id, title, description, category, risk_category, risk_sub_category, register_type, ubl_fields(JSON), template_fields(JSON), owner_id, business_owner_id, affected_department_ids(JSON), due_date, review_date, inherent_likelihood/impact/score, residual_likelihood/impact/score, risk_appetite, status, treatment_plan, root_cause, recommendations, closure_status, closed_at, closed_by, closure_notes, source_type, source_assessment_id, source_incident_id, source_rcsa_finding_id, source_reference, created_at, updated_at`.

---

## 5. Module — Vulnerabilities

**Page:** `app/(dashboard)/vulnerabilities/page.tsx` · **Model:** `grc_vulnerabilities`. List = card/row list + optional dashboard tab. CVE auto-fill banner pre-fills from NVD on blur.

### 5.1 Form fields
`title` (text, required; CVE lookup on blur), `description` (textarea), `severity` (select: critical/high/medium/low/info), `cve_id` (text, CVE-YYYY-XXXXX), `cwe_id` (text), `cvss_score` (number 0–10), `affected_component` (text), `affected_host` (text), `due_date` (date). NCA template view adds vendor_link, affected_technology, threat_analysis, threat_severity, risk_likelihood/severity, owner, status, dates, comments.

### 5.2 List columns & badges
**Title** (→ detail) · **Severity** pill · **Status** pill · CVE id (mono) · affected component · due date · assignee. Enrichment badges when present: **EPSS** percentile, **KEV** "Known Exploited" (red), **public exploit count**, composite priority.

**Severity colours:** critical `red-50/600`, high `orange-50/600`, medium `yellow-50/600`, low `blue-50/600`, info `slate-50/600`.
**Status colours:** open `red`, in_progress `yellow`, remediated `blue`, verified `green`, closed `slate`, accepted `primary`, false_positive `slate`.

**Dashboard tab:** Severity **donut** (critical `#ef4444`, high `#f97316`, medium `#eab308`, low `#3b82f6`, info `#94a3b8`) · Remediation-status **bar** · SLA **gauge** (≥80 green / 50–80 amber / <50 red) + MTTR.

### 5.3 Backend columns (`grc_vulnerabilities`) — key set
`id, tenant_id, report_id, vuln_id, title, description, severity, cvss_score, cvss_vector, cve_id, cwe_id, affected_component, affected_host, affected_port, affected_url, evidence, reproduction_steps, recommendation, ai_recommendation, ai_impact_assessment, status, resolution_notes, discovered_at, due_date, resolved_at, assigned_to, verified_by, verified_at, template_type, template_fields(JSON)`.
Threat-intel: `epss_score, epss_percentile, kev_flag, kev_date_added, nvd_*_at, exploit_references(JSON), composite_priority, public_exploit_count, public_exploit_refs(JSON)`.
Risk-posture v2: `effective_risk_score, effective_risk_reason, effective_risk_computed_at`. Vendor patch: `patch_references(JSON), vendor_advisory_ids(JSON), remediation_guidance, psirt_source`. Exception workflow: `exception_status (none/requested/approved/denied/expired/revoked), exception_requested_by_id, …_justification, …_compensating_controls(JSON), …_approved_at, …_expires_at, …`.

---

## 6. Module — IT Assets

**Page:** `app/(dashboard)/assets/page.tsx` (wrapper class **`assets-light`**) · **Model:** `grc_it_assets`. Modal = `RightSlidePanel w-[780px]`. List = card-based collapsible + 3 chart cards.

### 6.1 Form fields
- **Identity:** `name` (text, required), `description` (text).
- **Asset type** (button grid): application, infrastructure, data, cloud, third_party (each icon).
- **Component** (select, options per type) + `ip_address` (text). **OS/Product picker** (from `/compliance-plugins/os-registry`, scannable first). **Sub-components** (suggested pills + custom add → removable blue pills).
- **Vendor / Location / Network segment** — `ComboBoxInput` (searchable, free-text allowed). **Asset Value (USD)** — number with `$` prefix.
- **CIA ratings** — three 1–5 button scales: Confidentiality (blue), Integrity (green), Availability (yellow) — "highest drives criticality".
- **Data Classification** (select: public/internal/confidential/restricted) · **Internet-Facing** (toggle) · **CDE Environment** (toggle) · **Business Function** (combo).
- **Derived Criticality** live preview (score 0–10 + bucket, 250ms debounce) with optional **manual override** (toggle + reason + select).
- Edit mode adds **Status** (active/inactive/decommissioned).

### 6.2 List columns & badges
Row: type **icon** + **Name** (→ `/assets/{id}`) · description · **Type** pill (application blue, infrastructure purple, data green, cloud amber, third_party pink @22% opacity) · **Status** pill · **Criticality** pill. Expand → CIA bars, owners, vendor, location, network segment, valuation, OS profile, compliance scope, last-seen + source, lifecycle state. Multi-select checkboxes → **Bulk Connect** (deep-links Connect Wizard with `?asset_ids=`).

**Status:** active `green`, inactive `yellow`, decommissioned `slate`. **Criticality:** critical `red`, high `orange`, medium `yellow`, low `green`.
**Charts (3 donut/radar cards):** By Asset Type (donut, centre=total) · By Criticality (donut) · CIA Profile by Type (radar: C blue / I green / A yellow).

### 6.3 Backend columns (`grc_it_assets`) — key set
`id, tenant_id, name, description, asset_type, owner_id, owner_name, custodian, host_name, ip_address, criticality, confidentiality_rating, integrity_rating, availability_rating, valuation, vendor, location, status, cde_environment`.
Exposure: `internet_facing, network_segment, data_classification, business_function, compliance_scope(JSON)`. Ownership: `primary_owner_id, secondary_owner_id, owning_team_id, escalation_contact_id, business_owner_id`. Lifecycle: `lifecycle_state (planned/active/maintenance/decommissioned/retired), decommissioned_at, retirement_reason, replacement_asset_id`. Criticality: `criticality_score, criticality_manual_override, criticality_override_reason`. Telemetry: `last_seen_at, last_seen_source`. OS/CIS: `os_family, os_version, os_normalized, os_build, os_edition, detected_software_json(JSON), asset_role, parent_asset_id`. Risk-posture: `is_customer_facing, is_internet_facing, regulated_data_type, op_dep_business_impact, business_impact_notes`.

---

## 7. Administration → Report Connectors

**Files:** `app/(dashboard)/admin/connectors/page.tsx` (provider list + setup modal) · `app/(dashboard)/admin/integrations/connect/page.tsx` (Connect Wizard).

### 7.1 Provider catalogue page
Connectors are **provider cards** grouped by category (Ticketing, SIEM, Pen-test, Collaboration, Transcription — e.g. ServiceNow, Splunk, MS Teams, Fireflies). Each card lists existing connections with a status dot + test/sync/delete, and a dashed "Add … connection" button.

```jsx
<div className="rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-300 transition-colors">
  <div className="flex items-start justify-between gap-2">
    <div>
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-900">{provider.label}</h4>
        {provider.beta && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 uppercase">Beta</span>}
        {provider.auth_method==='oauth2' && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">OAuth2</span>}
      </div>
      <p className="text-xs text-gray-500 mt-1 leading-relaxed">{provider.description}</p>
    </div>
    {provider.docs_url && <a className="text-gray-400 hover:text-gray-600"><ExternalLink className="h-3.5 w-3.5"/></a>}
  </div>

  {/* existing connections */}
  <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
    {connections.map(c => (
      <div key={c.id} className="flex items-center gap-2 text-xs">
        <StatusDot status={c.status}/>           {/* connected=green error=red else amber */}
        <button className="flex-1 text-left text-gray-700 hover:text-blue-600 truncate">{c.connection_name}</button>
        <button title="Test"><BookOpenCheck className="h-3 w-3 text-gray-400 hover:text-blue-600"/></button>
        <button title="Sync"><RefreshCw     className="h-3 w-3 text-gray-400 hover:text-blue-600"/></button>
        <button title="Remove"><Trash2       className="h-3 w-3 text-gray-400 hover:text-red-600"/></button>
      </div>
    ))}
  </div>

  <button className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed
                     border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600">
    <Plus className="h-3.5 w-3.5"/> Add {provider.label} connection
  </button>
</div>
```

```jsx
function StatusDot({status}) {
  const c = status==='connected' ? 'bg-green-500' : status==='error' ? 'bg-red-500' : 'bg-amber-400';
  return <span className={`h-1.5 w-1.5 rounded-full ${c} shrink-0`} />;
}
```

### 7.2 Setup modal (centered)
`fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4` → panel `w-full max-w-2xl max-h-[90vh] rounded-xl bg-white shadow-2xl flex flex-col`. Header `border-b px-5 py-4` (title `text-base font-semibold`). Body `flex-1 overflow-y-auto px-5 py-4 space-y-4`: a **Connection name** input then dynamic per-provider fields (label `text-xs font-medium text-gray-700 mb-1`, input `rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500`; credentials marked "(encrypted at rest)" / "(leave blank to keep existing)"). OAuth2 banner `rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800`. Footer `border-t px-5 py-3 flex justify-end gap-2` (Cancel secondary + "Create connector" primary with spinner → `Creating + testing…`).

### 7.3 Connect Wizard (2-step, cloud/host onboarding)
- **Step 1 — Platform picker:** categories (Hosts, Network, Databases, Identity, Cloud); cards `p-6 rounded-xl border-2` — selected `border-blue-500 bg-blue-50`, else `border-gray-200 hover:border-blue-300 hover:shadow-md`; emoji logo `text-4xl`, label `font-semibold`, subtitle `text-xs text-gray-600`.
- **Step 2 — Credentials:** dark gradient header band `bg-gradient-to-r from-slate-900 to-slate-700 text-white` with "Step 2 of 2" eyebrow + "End-to-end encrypted" pill (pulsing emerald dot). Numbered **fieldsets** (`legend` with a `w-5 h-5 rounded bg-blue-100 text-blue-700` step chip). Inputs use the shadow/blue-ring variant. Pre-flight notice `rounded-lg bg-slate-50 border p-3`. Action bar: "← Back" secondary + full-width "Connect server" primary.
- **Success screen:** `rounded-xl border-2 border-green-300 p-8 text-center` with ✅, "Connected!", detected OS, and a "Back to this asset →" button.

---

## 8. Consolidated colour-meaning reference

| Meaning | Colour | Tailwind / hex |
|---|---|---|
| **Brand / primary / active** | teal-mint | `primary-600` `#1ed4b0` (→ rebrand) |
| Severity critical / status critical / open | red | `#dc2626` / `red-500 #ef4444` |
| Severity high | orange | `#f97316` |
| Severity medium / in-review | yellow/amber | `#eab308` / `#f59e0b` |
| Severity low / approved | blue | `#3b82f6` |
| Severity info / neutral / archived | slate | `#64748b` |
| Success / pass / verified / published | green | `#22c55e` / `#10B981` |
| Warning / partial | amber | `#f59e0b` |
| Danger / fail / expired | red/rose | `#ef4444` / `#F43F5E` |
| Info | cyan | `#06b6d4` |
| Risk accepted / treatment | purple/violet | `#8b5cf6` |

**Status-dot (connectors):** connected = `green-500`, error = `red-500`, pending = `amber-400`.

---

## 9. Re-brand checklist (for the new project)

1. **Pick the new brand colour** → set `tokens.css` `--color-base`, `--color-base-strong`, `--color-base-soft*`, `--sidebar-active-bg/-border`.
2. **Mirror it in Tailwind** `theme.extend.colors.primary` (50–900 ramp; 500/600 = brand).
3. Keep `severity.*`, `success/warning/danger/info`, and status-lifecycle colours unchanged (they're semantic).
4. Keep the **token architecture**: author components with `bg-white / text-slate-* / bg-primary-600` and wrap pages in `.platform-ui` so the override layer maps them to tokens — one swap re-skins all.
5. Reuse the **geometry**: inputs/buttons `rounded-lg`, cards `rounded-xl`, pills `rounded-full`; padding `p-4`; page `p-4 sm:p-5 space-y-4`; grids `grid-cols-1 lg:grid-cols-2 gap-4` (panels) / `… lg:grid-cols-4 gap-3` (cards).
6. Reuse the **component idioms** in §2 (RightSlidePanel drawer, StatCard, StatusBadge, MultiSelectDropdown, SearchInput, standard input/button class strings).
7. Reuse **Recharts** widget patterns (§3) with the semantic palette.
8. Font: swap Poppins for the new brand font via `--font-poppins`.

---

*Generated as a portable UI/UX spec. All class strings and field lists are taken verbatim from the live codebase; swap only the brand tokens to retheme.*
