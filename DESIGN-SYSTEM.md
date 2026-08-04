# GRC Platform — Design System (Phase 2)

**Purpose.** The single source of truth for the revamp. Every module in Phase 3 is built from these tokens, components, and patterns and checked against the DO/DON'T list. It is *grounded in your actual codebase* — the values below are read from `tailwind.config.ts`, `styles/tokens.css`, and `globals.css`, and the patterns are lifted from the four charter-clean reference modules (Committees, Documents workspace, Controls, Evidence). Nothing here is invented.

**Golden rule.** One brand color (teal), flat (no gradients), light (no dark-theme residue), semantic colors only where they carry meaning, and every core surface passes the **Snapshot Test**.

---

## 1. Foundations — Design Tokens

### 1.1 Brand color (teal) — the only vivid color in the app
| Token | Hex | Use |
|---|---|---|
| `primary-50` | `#e8fcf8` | active nav/tab surface, soft brand wash, badge-primary bg, letter tiles |
| `primary-100` | `#cef8f0` | brand pill borders (`border-primary-100`) |
| `primary-400` | `#3ddfc2` | progress-bar fill (secondary) |
| **`primary-500`** | **`#1ed4b0`** | **the brand** (== 600), focus ring base, dots |
| **`primary-600`** | **`#1ed4b0`** | **primary button bg, active borders, brand icon** |
| `primary-700` | `#17b898` | **hover** step for primary button, active tab/nav text (`text-primary-700`) |
| `primary-800/900` | `#109880` / `#086e5b` | rare deep accents |

> ⚠️ **Load-bearing fact:** the primary button uses **near-black text `#0A0A0A`** (`--color-on-base`) on teal — **not white**. White-on-teal is a documented bug (control-library/evidence). Text on any teal fill = `--color-on-base`, never `text-white`.
> The ramp has a deliberate flat spot: 500 == 600 == `#1ed4b0`; hover always steps to `primary-700`.
> **Sanctioned brand tints (allowed):** `bg-primary-50`, `bg-primary-50/50`, `text-primary-700`, `border-primary-600/500/100`, `focus:ring-primary-500/20`, `ring-primary-500` (selection). Nothing else may be teal-tinted.

### 1.2 Semantic palette (meaning only — never decoration)
Use the **single-hue light pill** pattern everywhere: `bg-{tone}-50 text-{tone}-700 border-{tone}-200`.

| Meaning | Hue | Pill classes | Standard usage |
|---|---|---|---|
| success / approved / compliant / on-track | **emerald** | `bg-emerald-50 text-emerald-700` | passed, published, done, positive trend |
| warning / **in-progress** / attention / medium | **amber** | `bg-amber-50 text-amber-700` | **in-progress is ALWAYS amber** (never blue/purple) |
| danger / overdue / failed / non-compliant / critical | **rose** | `bg-rose-50 text-rose-700` | delete, error, overdue, required-field |
| neutral / draft / archived | **slate** | `bg-slate-100 text-slate-600` | draft, inactive, categorical default |
| info (sparingly) | **cyan** | `bg-cyan-50 text-cyan-700` | pure informational notice only |

Deep/muted text tokens exist for AA contrast (`--color-success #2D6A4F`, `--color-warning #92570E`, `--color-danger #9B1C1C`). Use `-700` classes for pill text; use the muted tokens where CSS vars drive `.cw-*`.

**Severity scale (the ONE sanctioned red→amber→green):** `critical #dc2626 · high #f97316 · medium #eab308 · low #3b82f6 · info #64748b` — **only** for risk/vuln severity heatmaps & criticality bands. Never as a decorative health gauge.

**Retired forever:** blue/indigo/violet/purple/cyan/fuchsia/lime/pink as *brand or AI or accepted* colors. AI = teal `.grc-ai-action`. "Accepted" = teal. In-progress = amber. Categorical coding = slate + one teal accent (or the deterministic hashed avatar tints, which are a sanctioned per-person *marker*, not brand meaning).

### 1.3 Neutrals (the light theme)
| Role | Class / value |
|---|---|
| Page background | `bg-slate-50` (`#f8fafc`) |
| Card / surface | `bg-white` (`#ffffff`) |
| Subtle surface (thead, field bg, stripes) | `bg-slate-50` / `--color-subtle #F1F3F5` |
| Hairline border (cards/tables/modals) | `border-slate-200` (`#e2e8f0`) |
| Inside-card divider | `border-slate-100` (`#f1f5f9`) |
| Heading text | `text-slate-900` (`#0f172a`) |
| Body text | `text-slate-800` (`#1e293b`) |
| Muted / labels / captions | `text-slate-500` (`#64748b`) |
| Placeholder / faint | `text-slate-400` (`#94a3b8`) |

**Banned:** `divide-slate-700`, `bg-gray-800` surfaces (except the tooltip bubble itself), `bg-*-500/20` + `text-*-400` chips, blue-tinted default borders.

### 1.4 Typography
- **Font:** Poppins (`--font-poppins`, sans). **Mono:** JetBrains Mono (`--font-mono`) for codes/IDs/CVEs.
- **Default UI text:** `text-sm` (14px). **Labels/help:** `text-xs`/`text-2xs`. **Page H1:** `.page-title` (28px, semibold) or `text-xl font-semibold text-slate-900`. **Section headers:** `text-lg font-semibold`. **KPI value:** `text-xl`–`text-2xl font-bold text-slate-900` (hero `text-3xl/4xl`).
- **Weights:** body normal, labels/buttons medium (500), headings semibold (600). Bold (700) only for KPI values/hero numbers.

### 1.5 Spacing, radii, shadows, motion
- **Page:** `p-4 lg:p-5` on `bg-slate-50`. **Cards:** `p-4` (drawer body `p-5`, empty states `py-8/py-10`). **Stacks:** `space-y-2` tight · `space-y-3` default · `space-y-4` between sections. **Grids:** panels `grid-cols-1 lg:grid-cols-2 gap-4`; KPI tiles `grid-cols-2 lg:grid-cols-4/5 gap-3`.
- **Radii:** inputs/buttons `rounded-lg` · cards/tables/modals `rounded-xl` · pills/dots `rounded-full`. (Tokens: `--radius-md 6px`, `--radius-lg 8px`; one custom `rounded-4xl 32px`.)
- **Shadows:** `shadow-card` (resting) · `shadow-card-hover` · `shadow-elevated` (dropdowns) · `shadow-modal` · `shadow-2xl` (AnimatedModal panel).
- **Motion:** only `fade-in` / `slide-up/down` / `scale-in` / the `grid-rows` expand trick / the 12-dot `PageLoader`, all **150–300ms**. Must honor `prefers-reduced-motion` (durations → 0.01ms). No shine/glow AI animations.

### 1.6 Icons
lucide-react **only**, always visible, `strokeWidth={1.75}`. Sizes: nav 18 (sub-items 16) · inline chip `h-3 w-3` · standard control `h-4 w-4` · card header `h-5 w-5` · empty-state hero `h-10 w-10`. Icon color follows intent; active icon = teal.

### 1.7 ⚠️ Known token debt (fix in the Phase-3 foundation commit, additive only)
- **Dangling CSS vars** referenced but never defined (silently resolve to nothing): `--color-hover`, `--color-base-hover`, `--shadow-sm`, `--shadow-lg`, `--space-3`, `--color-primary`. Hover backgrounds and `platform-ui` shadows currently break because of these.
- **Two token systems coexist:** the Tailwind config scale (consumed by `@apply` classes: `.card`, `.btn-*`, `.badge-*`) and the CSS-var layer in `tokens.css` (consumed by `.cw-*`/`*-light` classes). Their semantic *text* values diverge (config `danger.600 #dc2626` vs `--color-danger #9B1C1C`). **Rule going forward:** author new UI with the Tailwind `@apply` primitives + semantic `-50/-700` classes; reserve `.cw-*` for existing workspace surfaces already on it.

---

## 2. Component Library

### 2.1 Existing & charter-clean — **reuse these, do not re-invent**
| Component | File | What it gives you |
|---|---|---|
| `DataTable<T>` | `components/ui/DataTable.tsx` | sortable/searchable/selectable table + bulk-action bar + CSV export + pagination + skeleton + empty. The register workhorse. (`bulkBarVariant: 'light'|'dark'`) |
| `DataCard` | `components/ui/DataCard.tsx` | titled panel with loading/empty/error/content states |
| `StatCard` | `components/ui/StatCard.tsx` | KPI tile (icon tint only — borders stay slate) |
| `TrendIndicator` | `components/ui/TrendIndicator.tsx` | up/down/neutral delta chip (supports `inverted`) |
| `ProgressRing` | `components/ui/ProgressRing.tsx` | SVG completion gauge |
| `StatusBadge` | `components/ui/StatusBadge.tsx` | 14-status pill (semantic; `accepted` = teal) |
| `FilterBar` | `components/ui/FilterBar.tsx` | search + selects + active-filter chips |
| `PageHeader` / `Breadcrumb` | `components/ui/…` | standard title block + auto breadcrumb |
| `SearchInput` / `MultiSelectDropdown` / `ComboBoxInput` | `components/ui/…` | search + portal filter/user pickers |
| `AnimatedModal` | `components/ui/AnimatedModal.tsx` | **the popup engine** — CSS enter/exit, Esc/backdrop close, scroll-locked, header/body/footer slots. Reuse platform-wide. |
| `RightSlidePanel` | `components/ui/RightSlidePanel.tsx` | right slide-over drawer (create/edit/detail) |
| `PageLoader` | `components/ui/PageLoader.tsx` | brand 12-dot loader |
| `PermissionGuard` / `IfPermission` | `components/ui/PermissionGuard.tsx` | RBAC gate / conditional render |

### 2.2 Exists but **off-charter — reskin during Phase 3**
`MetricBadge`, `SeverityBadge` (verify tones), `InlineLinkPicker` (default `bg-blue-600` trigger → teal), `RightSlidePanel` (audit for stray tints), `Toast`/`ToastContainer` (text-white/`*-400` residue), `EmptyState` (`components/common/EmptyState.tsx` — blue→purple gradient icon + `bg-blue-600` buttons), `charts/index.tsx` (dark-theme leftovers, raw `#3b82f6`, gradients, purple `KPICard` variant), `Abbr`.

### 2.3 Gaps — **build in the Phase-3 foundation commit (additive, non-breaking)**
Ordered by leverage:
1. **`Button` / `IconButton`** — *the biggest gap.* No shared button exists; every page hand-rolls classes. One `Button({variant: primary|secondary|ghost|danger|success, size: sm|md|lg, loading, icon})` replaces hundreds of inline variants and locks in near-black-on-teal.
2. **`ConfirmDialog` + `useConfirm()`** — replace `window.confirm()` at **9 sites** (control-library, vendor-risk/vendors, erm/risks/list, governance/mappings, governance/documents, frameworks/[id], compliance-plugins/ingest). Built on `AnimatedModal`, `danger` variant, optional undo.
3. **Re-enable Toast** — `ToastProvider` is **hard-disabled** (`suppressToasts = true`); flip it on, reskin to charter. Unlocks real success/error feedback app-wide (replaces `alert()`).
4. **`FormField` + `TextInput` + `Textarea` + `Select`** — no reusable labeled inputs / styled single-select exist (only native `<select>` or heavy MultiSelect).
5. **`RagDot`** — 2×2 status dot (green/amber/rose/slate) for dense rows/headers; lighter than a full pill.
6. **`SnapshotStrip` / `KpiStrip`** — a horizontal KPI band primitive (the pattern every dashboard hand-composes).
7. **`Tabs` / `TabList`** — shared tab bar (compliance/risks/vulnerabilities each reimplement one).
8. **`Skeleton`**, **`Tooltip`**, **`Pagination`**, bare **`Card`/`Panel`**, **charter-clean `EmptyState`**, **reskinned chart set**.

---

## 3. Pattern Library (the reusable recipes)

Copy these from the exemplar `file:line`. They already encode the charter — don't redesign, replicate.

### 3.1 Layout & snapshot
- **Snapshot / Context Rail (sticky master-detail)** — 2/3 master + 1/3 sticky rail that flips between scoped view and org-wide "needs attention." `grid grid-cols-1 lg:grid-cols-3`, rail in `lg:sticky lg:top-4`. → *committees/page.tsx:337*, *documents/_workspace/AttentionRail.tsx:242*
- **Master-detail workbench (no page hop)** — 12-col split, master `col-span-5` scrolls, detail `col-span-7` `lg:sticky lg:top-4`, selection swaps detail in place. → *evidence/_workspace/WorkbenchView.tsx:35*
- **D1 pinned-context / scrolling-work split** — full record page: left context (`col-span-5`, sticky) pinned, right work column (`col-span-7`) scrolls; summary tiles are buttons that open focused overlays. → *evidence/[id]/page.tsx:1004*
- **KPI Tile Strip** — `grid grid-cols-2 lg:grid-cols-5 gap-4` of `.stat-card`; tone data-driven (overdue flips rose only when >0); denominator in the sub-line. → *committees/page.tsx:302*
- **Control-health snapshot strip** — endpoint-derived KPI tiles + stacked mini-bar; **guarded degradation** (missing endpoint → em-dash, not wrong numbers). → *controls/page.tsx:956*
- **Snapshot board (donut + trend + tiles + segmented bar)** — one-glance board readout, pure-SVG donut (`stroke-dasharray` arcs, no chart lib), labeled placeholders for missing data. → *evidence/_workspace/SnapshotView.tsx:113*
- **Empty & Loading states** — module-empty (centered card + icon + one-line + single CTA) vs inline filter-empty; skeletons shaped to the real layout; omit empty sections rather than render them. → *committees/page.tsx:646*

### 3.2 Registers, lists, boards
- **Dense sortable register** — thin "N shown · M total · updated Xm" header over `DataTable<T>`; cells from shared lib primitives; `selectable bulkBarVariant="dark" exportable searchable={false} stickyHeader onRowClick`. → *documents/_workspace/RegisterTable.tsx:156*
- **Register cell primitives** — one `lib.tsx` source of truth: `TypePill`, `LifecycleDots`, `OwnerChip` (initials avatar), `FrameworkPills`, `StatusDot`, `ReviewStatus`. Import, don't re-style. → *documents/_workspace/lib.tsx:124* · *evidence/_workspace/lib.tsx:104*
- **Selectable master-list row** — full-width `<button>`, letter tile + `min-w-0 flex-1 truncate` middle + trailing status; selected = `bg-primary-50`. → *evidence/_workspace/EvidenceRow.tsx:31*
- **Inline-expand register** — row toggles a detail panel *above* the table (`border-primary-100 bg-primary-50`), lazy-loads on expand. → *evidence/_workspace/RegisterView.tsx:139*
- **Lifecycle / pipeline kanban** — fixed-width columns per stage, RAG dot header + count, dashed "None" placeholder, optional inline advance button. → *documents/_workspace/LifecycleBoard.tsx:108* · *evidence/_workspace/PipelineView.tsx:105*
- **Portaled Row Actions menu (⋯)** — `createPortal` fixed menu computed from trigger rect (flips/clamps), closes on outside-click/Esc/scroll; data-driven `RowAction[]` with `hidden`/`variant`. → *documents/_workspace/RowActionsMenu.tsx:77*
- **Master list item tile** — richer-than-a-row tile: RAG dot + name + type pills + meta + count-pill footer; selected = `ring-2 ring-inset ring-primary-500`; 1px-gutter grid reads as hairline rows. → *committees/page.tsx:406*
- **Left library / hierarchy tree** — LIBRARY shortcuts + recursive expandable tree; active row `bg-primary-50 text-primary-700`. → *documents/_workspace/LibraryTree.tsx:162*

### 3.3 Chrome, chips, popups
- **Single-row responsive filter toolbar** — `flex items-center gap-2 overflow-x-auto`, flexing search left, `shrink-0` filters, `ml-auto` action cluster; labels collapse to icons at breakpoints; **never wraps**. → *documents/_workspace/DocumentsWorkspace.tsx:263*
- **Segmented view switcher** — pill group over `bg-slate-100`; active = raised white chip (`bg-white text-primary-700 shadow-sm`); icon-only below `sm`; driven by a `VIEWS` array. → *evidence/_workspace/EvidenceWorkspace.tsx:152*
- **AnimatedModal popup** — the two-flag `render`/`show` mount machine so exit animates; scrim `bg-slate-900/50`, panel `scale-95→100 opacity`, sticky header/footer, `min-h-0 flex-1 overflow-y-auto` body. → *components/ui/AnimatedModal.tsx:37*
- **Tile-grid detail body** — inside the popup: `grid md:grid-cols-2 gap-4` of `rounded-xl border border-slate-200 bg-white p-4` tiles, uppercase `text-[11px] text-slate-400` labels, `<dl>` `flex justify-between` rows, long tiles cap `max-h-72 overflow-y-auto`. → *controls/page.tsx:1714*
- **Right slide-over form panel** — create/edit/bulk in `RightSlidePanel`; footer submits body form by `form={id}`; `Field(label,required)` wrapper; rose error banner; pending-aware disabled submit. → *committees/page.tsx:682*
- **Semantic status/type chips** — always route through a central tone map (`STATUS_PILL`/`IMPL_STATUS_META`), light `bg-{c}-50 text-{c}-700` pair; `StatusDot` = borderless dot+text for inline. → *evidence/_workspace/lib.tsx:104*
- **RAG health dot** — `h-2 w-2 rounded-full` + `title`, tone from an if/else ladder (inactive→overdue→open→ok: `bg-slate-300 | bg-rose-500 | bg-amber-500 | bg-emerald-500`). → *committees/page.tsx:411* · *documents/_workspace/AttentionRail.tsx:34*
- **Deterministic initials avatar / letter tile** — record letter in teal square; person initials in a round tile tinted by `hash(name) % AVATAR_TINTS` (sanctioned marker). → *evidence/_workspace/lib.tsx:150*
- **Framework tag pill + cross-module Stat grid** — brand-tinted framework pill w/ Linked/Suggested sub-label; compact `grid-cols-3 sm:grid-cols-6` count cells for relationship fan-out. → *evidence/_workspace/lib.tsx:257*

### 3.4 The architectural spine
- **Shared-source workspace scaffold** — fetch the dataset **once** (`limit:1000`) + summary, keep search/filter/selection in the parent, derive `items` via one `useMemo`, hand the same array to whichever view is active. Views are pure presentational children → switching never refetches, filters apply uniformly, views can't disagree. A shared `run()` wrapper does try/toast/invalidate. → *evidence/_workspace/EvidenceWorkspace.tsx:41*

---

## 4. DO / DON'T (the checklist every module is graded against)

| # | DON'T (anti-pattern found in audit) | DO (on-charter replacement) |
|---|---|---|
| 1 | Blue as brand: `border-blue-600`, `bg-blue-600`, `text-blue-600`, `focus:ring-blue-500` | Teal: `.tab-active`/`border-primary-600 text-primary-700`, `.btn-primary`, `text-primary-700`, `focus:ring-primary-500` |
| 2 | Gradients: `from-purple-600 to-blue-600` AI buttons, `from-*-50 to-*-50` panels, gradient stat chips/heroes | Flat fills. AI = `.grc-ai-action` (Sparkles + solid teal). Panels = `.card` + `bg-primary-50`. Solid soft-tint icon chips |
| 3 | Dark-theme chips `bg-*-500/20 text-*-400`, `divide-slate-700`, `bg-gray-800` | `bg-{tone}-50 text-{tone}-700 border-{tone}-200`; `border-slate-100/200`; `bg-white` |
| 4 | White/light text on white or teal (unreadable) | `text-slate-900/700/500`; on teal use `--color-on-base` (near-black). Contrast-check every pair |
| 5 | Purple/indigo = AI or "accepted"/escalated | AI = teal; accepted = teal; in-progress = amber; escalated = amber/rose by severity. No purple anywhere |
| 6 | `window.confirm` / `window.alert`; un-awaited `forEach` bulk ops | `ConfirmDialog`/`useConfirm` + `useToast`; `Promise.all` fan-out |
| 7 | Monster single-form modals; different modal per row type | One `RightSlidePanel` per object: compact core + accordion/stepper; same drawer for all row variants |
| 8 | Card-list registers hiding owner/due/residual until expanded; 3 row treatments in one list | One dense sortable `DataTable` with Owner/Residual/Status/Due/Last-review visible; one row treatment |
| 9 | Tab sprawl (8 tabs + nested), unreachable declared tabs, surfaces reachable from one hidden link, `overflow-x-auto` hiding tabs | ~4 top tabs; fold secondaries into filters/row-actions/sections; real `layout.tsx` tab bar; wire or delete dead tabs; tabs wrap |
| 10 | Silent mock data on API error; cosmetic gates (evidence never uploaded); dead buttons | Error/empty state (or explicit "sample data" banner); wire the real request; remove/implement every dead control |
| 11 | Scroll-and-forget: charts→analytics→filters→table stacked; non-sticky filters; 10-section overviews; dead `{false && …}` blocks | KPI strip + table side-by-side; sticky filters; trim overview to KPIs+heatmap+top-10+KRIs+one trend; delete dead blocks |
| 12 | Rainbow coding (17-color type maps), off-brand chart hues, decorative green→red gauges | Slate + one teal accent for categorical; semantic emerald/amber/rose for meaning; red→amber→green only for severity heatmaps |
| 13 | Parallel duplicate apps (`/risks/*`≈`/erm/*`), unreconciled numbers (33/66 vs 34/67 vs 50/80) | `/erm/*` canonical, delete duplicates; one authoritative coverage figure/banding |
| 14 | Blanket accents (all cards `border-l-emerald`); mislabeled metrics ("Completion" = metadata) | Color each accent by its metric's meaning; label metrics for what they measure |
| 15 | Hand-rolled off-grid cards (`bg-white/50 border-gray-300/50`); hidden/mixed icons | Build from `.card`/`.stat-card`/`.table`/`.badge-*`/`.btn-*`; lucide only, always visible |

---

## 5. The Snapshot Test (gate for every core surface)
A board member must answer these in **one glance**, without expanding rows or drilling in:
1. **Status now** — overall health (KPI strip / RAG).
2. **Direction** — progress/posture over time (a trend, even a sparkline).
3. **Who** — owners / top & bottom performers.
4. **Flow** — done / pending / **overdue** counts.
5. **When** — key/next dates (due, review, expiry).

If a surface can't answer all five above the fold, it isn't done. Reference bar: **Committees**, **Documents workspace**, revamped **Controls**, **Evidence Snapshot**.

---

*End of Design System. This is the contract for Phase 3. Each module revamp: mockup → your approval → implement from these tokens/components/patterns → grade against §4 + §5 → commit → log in [UI-REVAMP-CHANGES.md](UI-REVAMP-CHANGES.md) → stop for your test.*
