# Complyverse GRC — Design System Reference

> **Purpose.** This is a complete, copy-pasteable specification of the Complyverse GRC
> platform's UI/UX/CSS so another codebase (e.g. **Procureverse**) can reproduce the
> *exact* same look, feel, spacing, colors, and interaction behavior.
>
> **Stack it targets:** Next.js (App Router) + React 18 + **Tailwind CSS 3.4** +
> `lucide-react` icons + `clsx`. Font: **Poppins** (via `next/font`), mono: JetBrains Mono.
>
> **How the theming is layered (read this first):**
> 1. **`styles/tokens.css`** — CSS custom properties (`--color-*`, `--radius-*`, `--space-*`, `--sidebar-*`). This is the **source of truth** for brand color and semantic tokens.
> 2. **`tailwind.config.ts`** — a hardcoded Tailwind palette (`primary`, `surface`, `success`…) + font sizes, spacing, shadows, radii, animations.
> 3. **`app/globals.css`** — imports tokens, sets base element styles, and defines the **entire component class library** under `@layer components` (`.btn`, `.card`, `.badge`, `.table`, `.modal`, `.dropdown`, `.nav-link`…), plus a `platform-ui` variable-remap layer and per-module `*-light` theme overrides.
>
> To clone the design: copy these three files, then build UI with the documented component classes and the `lucide-react` icon conventions.

---

## 1. Brand & Design Tokens — `styles/tokens.css`

The **entire theme pivots on `--color-base` (teal/mint `#1ed4b0`)**. Everything "primary/brand" resolves to this. Drop this file in as-is and `@import` it at the top of `globals.css`.

```css
:root {
  /* ── Brand ─────────────────────────────────────────── */
  --color-base:          #1ed4b0;   /* brand teal — primary buttons, active nav, links, focus */
  --color-base-strong:   #17b898;   /* darker teal — hover/pressed on primary */
  --color-on-base:       #0A0A0A;   /* text/icon color that sits ON the teal (near-black) */

  /* ── Surfaces & text ───────────────────────────────── */
  --color-surface:       #FFFFFF;   /* cards, panels, nav background */
  --color-subtle:        #F1F3F5;   /* zebra rows, table headers, input fill, track */
  --color-border:        #DDE1E7;   /* all hairline borders */
  --color-text:          #1A1A1A;   /* primary text */
  --color-muted:         #6B7280;   /* secondary/label/help text */
  --color-text-inverse:  #FFFFFF;   /* text on colored/dark fills */

  /* ── Semantic (note: deep, desaturated — NOT bright) ── */
  --color-success:       #2D6A4F;   /* deep green */
  --color-warning:       #92570E;   /* amber/brown */
  --color-danger:        #9B1C1C;   /* deep red */

  /* ── Soft tints (icon badges, subtle fills) ────────── */
  --color-base-soft:          rgba(30, 212, 176, 0.10);
  --color-base-soft-strong:   rgba(30, 212, 176, 0.15);
  --color-warning-soft:       rgba(146, 87, 14, 0.10);
  --color-warning-soft-light: rgba(146, 87, 14, 0.08);
  --color-danger-soft:        rgba(155, 28, 28, 0.10);
  --color-danger-soft-light:  rgba(155, 28, 28, 0.03);
  --color-danger-border-soft: rgba(155, 28, 28, 0.30);
  --color-success-soft:       rgba(45, 106, 79, 0.10);

  --color-overlay:            rgba(10, 25, 35, 0.55);  /* modal backdrop */

  /* ── Document/workflow status colors (pills) ───────── */
  --color-status-draft:     #64748B;
  --color-status-review:    #EAB308;
  --color-status-approval:  #F59E0B;
  --color-status-approved:  #3B82F6;
  --color-status-published: #10B981;
  --color-status-expired:   #F43F5E;
  --color-status-archived:  #6B7280;

  /* ── Sidebar ───────────────────────────────────────── */
  --sidebar-bg:            #FFFFFF;
  --sidebar-text:          #111827;   /* top-level item text */
  --sidebar-text-subitem:  #1F2937;   /* sub-item text */
  --sidebar-text-section:  #6B7280;
  --sidebar-text-collapse: #6B7280;
  --sidebar-icon:          #4B5563;   /* default nav icon */
  --sidebar-hover-bg:      #E2E8F0;   /* hover fill + section divider lines */
  --sidebar-active-bg:     #1ed4b0;   /* active item fill = brand teal */
  --sidebar-active-border: #1ed4b0;

  /* ── Radii & spacing scale ─────────────────────────── */
  --radius-md: 6px;
  --radius-lg: 8px;
  --space-2:   8px;
  --space-4:   16px;
  --space-5:   20px;
  --space-6:   24px;
}
```

**Referenced-but-derived variables** (used in `globals.css`, resolve via fallback or the `platform-ui` layer — define them if you want pixel-parity): `--color-base-hover`, `--color-hover`, `--shadow-sm`, `--shadow-lg`, `--radius-sm`, `--space-3`, `--font-poppins`. Recommended values: `--color-base-hover: var(--color-base-strong)`, `--color-hover: var(--color-subtle)`, `--shadow-sm: 0 1px 3px rgba(0,0,0,.06)`, `--shadow-lg: var(--shadow-elevated)`, `--space-3: 12px`.

**Design intent to preserve:** brand is a single confident teal; semantic colors are **deep/desaturated** (not neon); surfaces are white on a light-slate app background; borders are hairline `#DDE1E7`; everything is rounded 6–8px.

---

## 2. Tailwind Theme — `tailwind.config.ts`

The Tailwind palette duplicates/extends the tokens so utility classes (`bg-primary-600`, `text-slate-500`) work. Copy the whole `theme.extend`.

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {                      // brand teal ramp (500/600 == --color-base)
          50:'#e8fcf8',100:'#cef8f0',200:'#9ef1e3',300:'#6de8d4',400:'#3ddfc2',
          500:'#1ed4b0',600:'#1ed4b0',700:'#17b898',800:'#109880',900:'#086e5b',
        },
        surface: {                      // neutral slate ramp (app chrome)
          50:'#f8fafc',100:'#f1f5f9',200:'#e2e8f0',300:'#cbd5e1',400:'#94a3b8',
          500:'#64748b',600:'#475569',700:'#334155',800:'#1e293b',900:'#0f172a',950:'#020617',
        },
        success: {50:'#f0fdf4',100:'#dcfce7',200:'#bbf7d0',300:'#86efac',400:'#4ade80',500:'#22c55e',600:'#16a34a',700:'#15803d'},
        warning: {50:'#fffbeb',100:'#fef3c7',200:'#fde68a',300:'#fcd34d',400:'#fbbf24',500:'#f59e0b',600:'#d97706',700:'#b45309'},
        danger:  {50:'#fef2f2',100:'#fee2e2',200:'#fecaca',300:'#fca5a5',400:'#f87171',500:'#ef4444',600:'#dc2626',700:'#b91c1c'},
        info:    {50:'#ecfeff',100:'#cffafe',200:'#a5f3fc',300:'#67e8f9',400:'#22d3ee',500:'#06b6d4',600:'#0891b2',700:'#0e7490'},
        severity: {                     // vulnerability/risk severity dots & badges
          critical:'#dc2626', high:'#f97316', medium:'#eab308', low:'#3b82f6', info:'#64748b',
        },
      },
      fontFamily: {
        sans: ['var(--font-poppins)', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],  // 10px — dense labels/badges
        xs:   ['0.75rem',  { lineHeight: '1rem' }],        // 12px
        sm:   ['0.875rem', { lineHeight: '1.25rem' }],     // 14px — default UI text
        base: ['1rem',     { lineHeight: '1.5rem' }],      // 16px
        lg:   ['1.125rem', { lineHeight: '1.75rem' }],
        xl:   ['1.25rem',  { lineHeight: '1.75rem' }],
        '2xl':['1.5rem',   { lineHeight: '2rem' }],
        '3xl':['1.875rem', { lineHeight: '2.25rem' }],
        '4xl':['2.25rem',  { lineHeight: '2.5rem' }],
        '5xl':['3rem',     { lineHeight: '1' }],
      },
      spacing: { '4.5':'1.125rem', '5.5':'1.375rem', '18':'4.5rem', '22':'5.5rem' },
      boxShadow: {
        'card':       '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -2px rgba(0,0,0,0.06)',
        'elevated':   '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.04)',
        'modal':      '0 25px 50px -12px rgba(0,0,0,0.15)',
        'sidebar':    '1px 0 3px 0 rgba(0,0,0,0.05)',
      },
      borderRadius: { '4xl': '2rem' },
      animation: {
        'fade-in':   'fadeIn 0.3s ease-out',
        'slide-up':  'slideUp 0.3s ease-out',
        'slide-down':'slideDown 0.3s ease-out',
        'scale-in':  'scaleIn 0.2s ease-out',
        'pulse-slow':'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        fadeIn:   { '0%':{opacity:'0'}, '100%':{opacity:'1'} },
        slideUp:  { '0%':{opacity:'0',transform:'translateY(10px)'},  '100%':{opacity:'1',transform:'translateY(0)'} },
        slideDown:{ '0%':{opacity:'0',transform:'translateY(-10px)'}, '100%':{opacity:'1',transform:'translateY(0)'} },
        scaleIn:  { '0%':{opacity:'0',transform:'scale(0.95)'},       '100%':{opacity:'1',transform:'scale(1)'} },
      },
    },
  },
  plugins: [],
}
export default config
```

---

## 3. Base Elements & Typography — top of `globals.css`

```css
@import '../../styles/tokens.css';   /* tokens FIRST */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 255 255 255;
    --foreground: 15 23 42;
    --sidebar-bg: 255 255 255;
    --card-bg: 255 255 255;
    --border-color: 226 232 240;
  }
  html { @apply bg-white text-slate-800; }
  body {
    @apply min-h-screen bg-slate-50 text-slate-800 antialiased;   /* app bg = slate-50 */
    font-family: var(--font-poppins), system-ui, -apple-system, sans-serif;
    line-height: 1.45;
  }
  h1 { @apply text-xl  font-semibold text-slate-900 tracking-tight; }
  h2 { @apply text-lg  font-semibold text-slate-800; }
  h3 { @apply text-base font-semibold text-slate-800; }
  h4 { @apply text-base font-medium   text-slate-700; }
}
```

**Type rules:** default UI text is **`text-sm` (14px)**; labels/help are **`text-xs`/`2xs`**; page titles use the `.page-title` class (28px). Body line-height 1.45. Font weight vocabulary: `font-normal` body, `font-medium` labels/buttons, `font-semibold` headings/emphasis.

---

## 4. Component Class Library — `globals.css @layer components`

These are the **canonical building blocks**. Reuse these class names verbatim; every module in the app is built from them.

### 4.1 Buttons

```css
.btn        { @apply inline-flex items-center justify-center gap-2 rounded-lg font-medium
              transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2
              focus:ring-offset-white disabled:opacity-50 disabled:pointer-events-none; }
.btn-primary   { @apply btn bg-primary-600 px-3.5 py-2 text-sm hover:bg-primary-700 focus:ring-primary-500;
                 color: var(--color-on-base); }              /* teal fill, near-black text */
.btn-secondary { @apply btn border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-700
                 hover:bg-slate-50 hover:border-slate-400 focus:ring-slate-400; }
.btn-ghost     { @apply btn px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:ring-slate-400; }
.btn-danger    { @apply btn bg-rose-600 px-3.5 py-2 text-sm text-white hover:bg-rose-700 focus:ring-rose-500; }
.btn-success   { @apply btn bg-emerald-600 px-3.5 py-2 text-sm text-white hover:bg-emerald-700 focus:ring-emerald-500; }
.btn-sm        { @apply px-2.5 py-1.5 text-xs; }
.btn-lg        { @apply px-6 py-3 text-base; }
```

### 4.2 Inputs, selects, labels

```css
.input       { @apply block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm
               text-slate-800 placeholder-slate-400 transition-colors
               focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20; }
.input-error { @apply border-rose-400 focus:border-rose-500 focus:ring-rose-500/20; }
.input-field { @apply block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm
               text-slate-900 placeholder-slate-400 transition-colors
               focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20; }
.label       { @apply mb-1 block text-[13px] font-medium text-slate-700; }
.select      { @apply input appearance-none pr-10           /* custom chevron via inline SVG bg */
               bg-[url("data:image/svg+xml,...chevron...")] bg-[length:1.5rem_1.5rem] bg-[right_0.5rem_center] bg-no-repeat; }
```
The `.select` chevron is a slate (`#94a3b8`) SVG set as `background-image` (see source for the exact data URI).

### 4.3 Cards & stat cards

```css
.card             { @apply rounded-xl border border-slate-200 bg-white p-5 shadow-card; }
.card-header      { @apply mb-3 flex items-center justify-between border-b border-slate-100 pb-3; }
.card-title       { @apply text-base font-semibold text-slate-800; }
.card-description  { @apply text-xs text-slate-500; }

.stat-card        { @apply rounded-xl border border-slate-200 bg-white p-4 shadow-card; }
.stat-value       { @apply text-[1.9rem] font-semibold leading-none text-slate-900; }
.stat-label       { @apply mt-1 text-[13px] font-medium text-slate-500; }
.stat-trend-up    { @apply text-emerald-600; }
.stat-trend-down  { @apply text-rose-600; }
```

### 4.4 Tables

```css
.table-container { @apply overflow-x-auto rounded-xl border border-slate-200 bg-white; }
.table           { @apply w-full text-[13px]; }
.table thead     { @apply bg-slate-50 border-b border-slate-200; }
.table th        { @apply px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500; }
.table td        { @apply border-b border-slate-100 px-3 py-2.5 text-slate-700; }
.table tbody tr  { @apply transition-colors hover:bg-slate-50; }
.table tbody tr:last-child td { @apply border-b-0; }
```
**Table idiom:** rounded-xl bordered container, slate-50 uppercase-tracked header, hairline row dividers, hover row highlight. (Module `*-light` themes add zebra striping on even rows — see §7.)

### 4.5 Badges (pills)

```css
.badge         { @apply inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium; }
.badge-primary { @apply badge bg-primary-50  text-primary-700; }
.badge-success { @apply badge bg-emerald-50  text-emerald-700; }
.badge-warning { @apply badge bg-amber-50    text-amber-700; }
.badge-danger  { @apply badge bg-rose-50     text-rose-700; }
.badge-info    { @apply badge bg-cyan-50     text-cyan-700; }
.badge-neutral { @apply badge bg-slate-100   text-slate-600; }
```

### 4.6 Tabs

```css
.tabs       { @apply flex gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200; }  /* segmented control */
.tab        { @apply rounded-md px-3 py-1.5 text-sm font-medium text-slate-500 transition-all hover:bg-white hover:text-slate-700; }
.tab-active { @apply bg-white text-primary-700 shadow-sm; }
```

### 4.7 Page header / empty state / alerts

```css
.page-header      { @apply mb-5; }
.page-title       { @apply text-[1.75rem] font-semibold leading-tight text-slate-900; }   /* 28px */
.page-description  { @apply mt-1 text-sm text-slate-500; }

.empty-state             { @apply flex flex-col items-center justify-center py-16 text-center; }
.empty-state-icon        { @apply w-16 h-16 flex items-center justify-center mb-4 text-slate-300; }
.empty-state-title       { @apply text-lg font-semibold text-slate-800 mb-2; }
.empty-state-description  { @apply text-slate-500 max-w-md; }

.alert         { @apply flex items-start gap-3 p-4 rounded-lg border; }
.alert-info    { @apply alert bg-blue-50    border-blue-200    text-blue-800; }
.alert-success { @apply alert bg-emerald-50 border-emerald-200 text-emerald-800; }
.alert-warning { @apply alert bg-amber-50   border-amber-200   text-amber-800; }
.alert-danger  { @apply alert bg-rose-50    border-rose-200    text-rose-800; }
```

### 4.8 Dropdown, tooltip, modal (see also §6 sidebar flyouts and §8 components)

```css
.tooltip       { @apply absolute z-50 px-2 py-1 text-xs font-medium text-white bg-slate-800 rounded shadow-lg; }

.dropdown      { @apply absolute z-50 mt-2 min-w-48 rounded-lg border border-slate-200 bg-white shadow-elevated; }
.dropdown-item { @apply flex items-center gap-2 px-4 py-2.5 text-sm text-slate-600
                 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer; }
.dropdown-item:first-child { @apply rounded-t-lg; }
.dropdown-item:last-child  { @apply rounded-b-lg; }

.modal-overlay { @apply fixed inset-0 bg-black/40 backdrop-blur-sm z-50; }               /* blurred scrim */
.modal         { @apply fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg
                 rounded-xl border border-slate-200 bg-white shadow-modal z-50; }
.modal-header  { @apply flex items-center justify-between p-6 border-b border-slate-200; }
.modal-body    { @apply p-6; }
.modal-footer  { @apply flex items-center justify-end gap-3 p-6 border-t border-slate-200; }
```

### 4.9 Progress, skeleton, divider, breadcrumb

```css
.progress-bar      { @apply h-2 rounded-full bg-slate-200 overflow-hidden; }
.progress-bar-fill { @apply h-full rounded-full transition-all duration-300; }   /* set width + bg inline */
.skeleton          { @apply animate-pulse bg-slate-200 rounded; }
.divider           { @apply border-t border-slate-200 my-6; }
.breadcrumb           { @apply flex items-center gap-2 text-sm text-slate-500; }
.breadcrumb-separator { @apply text-slate-300; }
.breadcrumb-current   { @apply text-slate-800 font-medium; }
```

---

## 5. Navigation classes (used by Sidebar) — `globals.css`

```css
.sidebar            { @apply bg-white border-r border-slate-200; }
.sidebar-header     { @apply h-16 flex items-center px-4 border-b border-slate-200; }
.sidebar-footer     { @apply p-4 border-t border-slate-200; }
.sidebar-toggle-btn { @apply flex items-center gap-2 w-full px-3 py-2 rounded-lg text-slate-500
                      hover:text-primary-600 hover:bg-slate-50 transition-colors; }

.nav-link          { @apply flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600
                     transition-all duration-150 hover:bg-slate-50 hover:text-slate-900; }
.nav-link-active   { @apply bg-primary-50 text-primary-700 border-l-2 border-primary-600 -ml-0.5 pl-[calc(0.75rem+2px)]; }
.nav-category-btn  { @apply flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700
                     transition-all duration-150 hover:bg-slate-50; }
.nav-category-active{ @apply text-slate-900; }
.nav-subitem       { @apply flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-500
                     transition-all duration-150 hover:bg-slate-50 hover:text-slate-700 border-l-2 border-slate-200; }
.nav-subitem-active{ @apply bg-primary-50/50 text-primary-700 border-primary-500; }
```
> Note: the shipped `Sidebar.tsx` uses **inline `var(--sidebar-*)` classes** (below) rather than these `.nav-*` classes, so the two must stay visually consistent. The active item uses the **teal `--sidebar-active-bg`**.

---

## 6. Sidebar — structure & behavior (`components/layout/Sidebar.tsx`)

A fixed left rail. **This is the primary chrome; replicate its behavior exactly.**

**Dimensions & shell**
- Expanded width **`w-60` (240px)**, collapsed **`w-[64px]`**; transitions `transition-all duration-300 ease-out`.
- `<aside class="flex flex-col bg-white border-r border-slate-200 shadow-sidebar …">`.
- Brand row height **`h-14` (56px)**, `border-b border-[var(--sidebar-hover-bg)]`. Brand wordmark: **"Complıverse"** with an animated dot over the "ı" (`.logo-dot`, teal `var(--color-base)`), plus a small `AI` suffix in teal at 70% opacity. Collapse toggle is a `h-7 w-7` rounded button with a `ChevronRight` that rotates 180° when expanded.
- Nav area: `flex-1 overflow-y-auto scrollbar-thin px-2.5 py-3 space-y-1`.

**Icons:** `lucide-react`, default nav icon props **`size={18} strokeWidth={1.75}`** (sub-items `size={16}`). Icon color `var(--sidebar-icon)`; **active icon uses `var(--color-base)` (teal)**.

**Top-level item (link)** — `NavItemLink`:
```
group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150
  active:   bg-[var(--sidebar-active-bg)] font-semibold text-[var(--color-text)]
  inactive: font-normal text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]
  collapsed: justify-center px-2   (icon only, name in title="")
```

**Collapsible group** — `NavGroupSection`:
- Header is a button: `group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px]`; group icon + `flex-1 text-left truncate` label + a `ChevronDown` that **rotates `-90°` when closed**.
- **Open/close animation uses the CSS grid `grid-rows-[0fr] → grid-rows-[1fr]` trick** with `transition-[grid-template-rows] duration-300 ease-out` and an inner `overflow-hidden` — smoothly expands without measuring content height.
- Sub-items live in a rail indented `ml-[1.6rem]` with a `border-l border-[var(--sidebar-hover-bg)] pl-2.5`, and each sub-link **staggers in**: `style={{ transitionDelay: isOpen ? `${min(idx,6)*30+60}ms` : '0ms' }}` with `translate-x-0 opacity-100` (open) / `-translate-x-1 opacity-0` (closed).
- Groups are **closed by default**; a group auto-opens only if it contains the active route (or `defaultOpen: true`).

**Collapsed group → hover flyout:** when the rail is collapsed, a group renders as an icon button; hovering shows a flyout to the right: `absolute left-full top-0 ml-2 … min-w-[210px] rounded-xl border border-slate-200 bg-white shadow-elevated p-1.5` listing the group's items.

**Administration popover** (pinned bottom, admins only): a `Settings` button that opens a `role="menu"` flyout anchored `left-full bottom-2 ml-2`, `min-w-[220px] max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl`. Each item deep-links to `/admin?tab=<id>`. Closes on outside-click + Escape.

**Permission gating (important UX):** the nav is filtered by the user's `permissions[]` + `allowed_modules[]` from `/auth/me`. Permission strings are `module:resource:action` (dots normalized to colons). Wildcards: `*:*:*` (admin bypass), `module:*:*`, `module:resource:*`. Items/groups with no surviving children are removed entirely. Admins bypass all checks.

**Nav information architecture** (top-level order): Dashboard · Governance (group) · Risk Management (group) · Compliance (group) · Auditor Portal · IT Assets (group) · Projects · Critical Tasks · **[bottom] Administration popover**. (Issues + ComplyChat live in the top Header, not the sidebar.)

---

## 7. Theme-override system (`platform-ui`, `*-light`, `compact-density`)

The app wraps content in utility classes that **remap raw Tailwind color utilities onto the token variables**, so pages authored with `bg-white`/`text-slate-700`/`bg-blue-600` automatically pick up the brand theme. Reproduce this if you want existing/legacy markup to re-skin automatically.

**`platform-ui`** (applied on the app shell): remaps, via `@layer components`/`utilities`, e.g.
```css
.platform-ui .bg-white, .platform-ui .bg-white\/50…   { background-color: var(--color-surface) !important; }
.platform-ui .bg-gray-50, .platform-ui .bg-slate-50…  { background-color: var(--color-subtle)  !important; }
.platform-ui .text-slate-700, .text-slate-900…        { color: var(--color-text)   !important; }
.platform-ui .text-slate-500, .text-slate-400…        { color: var(--color-muted)  !important; }
.platform-ui .border-slate-200, .border-gray-200…     { border-color: var(--color-border) !important; }
.platform-ui .bg-primary-600, .bg-blue-600, .bg-purple-600 { background: var(--color-base) !important; color: var(--color-on-base) !important; }
.platform-ui .text-primary-600, .text-blue-600, .text-purple-600 { color: var(--color-base) !important; }
.platform-ui .bg-gradient-to-r.from-purple-600.to-blue-600 { background-image: linear-gradient(90deg, var(--color-base), var(--color-base-hover)) !important; }
.platform-ui .focus\:border-blue-500:focus            { border-color: var(--color-base) !important; box-shadow: 0 0 0 1px var(--color-base) !important; }
```
i.e. **purple/blue/primary all collapse to the teal brand**; whites→surface, grays→subtle, slate text→text/muted, borders→border.

**`compact-density`** (density toggle on `platform-ui`): shrinks spacing/typography with `!important` overrides — e.g. `main .p-6 → 1.125rem`, `.gap-6 → 1.125rem`, `.text-2xl → 1.375rem`, `.text-sm → 0.8125rem`, table `th/td` vertical padding → `0.625rem`, big avatar `h-16 w-16 → 3rem`. Provide a normal and a compact mode.

**Per-module light themes** — a wrapper class per module forces a clean light treatment and fixes contrast. Apply the class on that module's page root:
- **`cw-dashboard` / `governance-light`** — dense dashboard type scale (h1 16px, body 11.5px), zebra tables (`tbody tr:nth-child(even) → --color-subtle`), pill `.status-badge` (20px radius, 2px×10px), tab styles (`.gov-tab`, `.gov-tab-active` with teal underline), form controls, and full modal→right-drawer behavior on `lg` (`.cw-modal-panel` becomes a 760px full-height right slide-over).
- **`assets-light`** — forces white surfaces + **blue-tinted borders (`#bfdbfe`)**, black text, removes shadows; overlays become `rgba(255,255,255,.88)` with blur.
- **`audit-light` / `audit-management`** — forces light; **hides lucide icons** (`svg.lucide { display:none }`), has a special animated **AI button** (`.audit-ai-button` — dark gradient, blue glow, sweeping shine `@keyframes audit-ai-sweep`), lifts buttons on hover (`translateY(-1px)`).
- **`dashboard-light`** — light + Recharts tooltip theming (white bg, `#e5e7eb` border, soft shadow).
- **`risk-workspace`** — compact risk module scale (h1 16px, tighter spacing/tables).

**`cw-*` semantic utility classes** (module-agnostic, token-driven): `.cw-card`, `.cw-btn-primary/-secondary/-success/-danger/-neutral`, `.cw-field` (labelled inputs w/ teal focus ring), `.cw-dropdown`, `.cw-overlay` + `.cw-modal-panel`, `.cw-tab`/`.cw-tab-active`, `.cw-status-*` (draft/review/approval/approved/published/expired/archived pills using `--color-status-*`), `.cw-progress-track` + `.cw-progress-fill-success/-warning/-danger`, `.cw-icon-badge-base/-warning/-danger/-success` (soft-tint icon chips), `.cw-text-muted/-success/-warning/-danger`.

---

## 8. Utilities: scrollbar, animations, reduced motion

```css
/* Thin brand scrollbar — used on the sidebar nav + scroll areas */
.scrollbar-thin { scrollbar-width: thin; scrollbar-color: theme('colors.slate.300') transparent; }
.scrollbar-thin::-webkit-scrollbar { width: 6px; }
.scrollbar-thin::-webkit-scrollbar-thumb { background-color: theme('colors.slate.300'); border-radius: 3px; }
.scrollbar-thin::-webkit-scrollbar-thumb:hover { background-color: theme('colors.slate.400'); }

/* Utility-layer entrance animations (distinct from the tailwind-config keyframes) */
.animate-fade-in  { animation: fadeIn 0.2s ease-out; }   /* fade + 4px rise */
.animate-slide-in { animation: slideIn 0.3s ease-out; }  /* fade + 8px slide-x */

/* Accessibility — honor reduced motion app-wide (keep 0.01ms so `end` events fire) */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important;
  }
}
```
Loader motifs also exist: `.logo-dot` (brand dot drop+bounce), `pageLoaderDot/Halo/Spin` (12-dot chasing page loader), `gap-progress` (indeterminate sweep bar).

---

## 9. App shell & Top navigation (Header)

### 9.0 Root shell wiring — `app/(dashboard)/layout.tsx`

The dashboard shell wraps everything in **`platform-ui compact-density cw-dashboard`** (theme + density + dashboard override, all on at once):

```jsx
<div className="platform-ui compact-density cw-dashboard flex h-screen overflow-hidden bg-[var(--color-subtle)]">
  <Sidebar />
  <div className="flex flex-1 flex-col overflow-hidden">
    <Header />
    <main className="flex-1 overflow-auto bg-[var(--color-subtle)] p-4 lg:p-5 scrollbar-thin">
      {children}
    </main>
  </div>
  <IdleLogout />
</div>
```
- App background is **`var(--color-subtle)` (`#F1F3F5`)**, content padding `p-4 lg:p-5`, scroll area uses `scrollbar-thin`.
- **Fonts** (`app/layout.tsx`): Poppins via `next/font` → `--font-poppins` (weights 300/400/500/600/700); JetBrains Mono → `--font-mono` (400/500/600). Body: `<body className="${poppins.variable} ${jetbrainsMono.variable} bg-slate-50 text-slate-800">`.
- Per-module `*-light` classes are applied by the individual module pages on their own root (e.g. a governance page wraps content in `governance-light`), layered on top of the shell's `platform-ui`.

### 9.1 Header — `components/layout/Header.tsx`

Top bar, **`h-12` (48px)**: `<header className="top-nav flex h-12 items-center justify-between px-4 lg:px-5">`. Left→right:

1. **Page title** — `text-sm font-semibold text-[var(--color-text)] truncate` + optional `text-[11px] text-[var(--color-muted)]` subtitle (hidden below `xl`). Title is derived from the route.
2. **ComplyChat quick-ask input** (hidden below `md`) — a pill input that **expands on focus** (`w-64 → focus:w-80`):
   `h-8 w-64 rounded-md border border-[var(--color-base)]/30 bg-[var(--color-base)]/5 pl-7 pr-8 text-xs … focus:w-80 focus:border-[var(--color-base)]/60 focus:bg-white focus:ring-1 focus:ring-[var(--color-base)]/30`, with a `Sparkles` (15px) left icon and `ChevronRight` (14px) submit.
3. **Issues** — `Link` to `/issues`, `AlertCircle` (18px), `rounded-md p-1.5 … hover:bg-[var(--color-subtle)]`.
4. **Pending approvals** — `ClipboardCheck` (18px) trigger with an **amber count badge** (`absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white`); dropdown `absolute right-0 z-50 mt-2 w-96 rounded-lg border border-gray-200 bg-white shadow-xl`, rows `hover:bg-amber-50/60`.
5. **Notifications** — bell (18px) with **red count badge** (`bg-red-500`); dropdown `w-80 … shadow-xl`; unread rows `bg-blue-50`; dot colors error `bg-red-500` / warning `bg-yellow-500` / success `bg-green-500` / default `bg-blue-500`.
6. **User menu** — trigger `flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 … hover:bg-[var(--color-subtle)]` with a **`h-7 w-7 rounded-full bg-blue-600 text-white text-sm font-bold` avatar** (initials) and a chevron that rotates 180° when open. Menu `absolute right-0 z-50 mt-2 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg`; items `px-3 py-2 text-sm hover:bg-[var(--color-subtle)]`; logout is `text-rose-600 hover:bg-rose-50`.

All popovers open on click, close on outside-click/Escape, anchored `right-0 mt-2`.

---

## 10. AI-action styling & data layer — `components/Providers.tsx`

A signature UX touch: **any button whose text/icon reads as an AI action is auto-tagged** (no per-button wiring) so AI actions can be styled distinctly platform-wide.

```js
const AI_TEXT_RE   = /\bAI\b|generate|suggest|draft|assess|analyz|processing|reasoning/i;
const BUSY_TEXT_RE = /generating|analyzing|assessing|drafting|processing|thinking|loading/i;

function applyGlobalAIUX(root = document) {
  root.querySelectorAll('button, a, [role="button"]').forEach((el) => {
    const text = (el.textContent || '').trim();
    const isAIAction =
      el.hasAttribute('data-ai-action') ||
      !!el.querySelector('.lucide-sparkles') ||
      AI_TEXT_RE.test(text);
    if (isAIAction) el.classList.add('grc-ai-action');           // ← tag

    const isBusy =
      !!el.querySelector('.lucide-loader-2.animate-spin') ||
      el.getAttribute('aria-busy') === 'true' ||
      (el.disabled && BUSY_TEXT_RE.test(text));
    if (isAIAction && isBusy) el.classList.add('is-generating'); // ← busy state
  });
}
```
- Runs on mount and via a **`MutationObserver`** (`childList, subtree, characterData, attributes` filtered to `class, disabled, aria-busy`), debounced with `requestAnimationFrame`.
- Style `.grc-ai-action` / `.is-generating` in your CSS to give AI buttons a distinct look (e.g. sparkle/gradient). The `audit-management` theme ships a fancy variant (`.audit-ai-button`, §7) as a reference.

**React Query defaults** (wrap the app in `QueryClientProvider`):
```js
new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } } });
```

---

## 11. Reusable React components (props & exact classes)

Every component is in `src/components/ui/`. Sizes are consistently `sm | md | lg`; color variants are `default/primary | success | warning | danger | info` (+ severity `critical/high/medium/low/info`). Icons are `lucide-react`.

### 11.1 StatCard
Wrapper: `rounded-xl border bg-white p-3.5 text-left transition-all duration-200` (+ `cursor-pointer active:scale-[0.98]` when clickable). Layout: `flex items-start gap-2.5` → icon (`size={18}`, colored per variant) + `{title: text-sm font-medium text-slate-600 truncate}`, value `text-xl font-bold text-black`, optional `TrendIndicator`, subtitle `text-xs text-slate-600`.
Props: `variant: 'default'|'success'|'warning'|'danger'|'info'`, `title`, `value`, `subtitle?`, `icon?: LucideIcon`, `trend?: {direction, value, inverted?}`. Variant icon colors: `text-primary-600 | text-success-600 | text-warning-600 | text-danger-600 | text-info-600`; all share `hover:shadow-card-hover hover:border-slate-300`.

### 11.2 DataTable
Container `overflow-hidden rounded-xl border border-slate-200 bg-white`. Toolbar `border-b border-slate-200 p-3` with a search (`rounded-lg border border-slate-300 … pl-9 focus:ring-1 focus:ring-primary-500`), **Columns** and **Export** buttons (`rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-600 hover:border-slate-400`). Head `<tr class="border-b border-slate-200 bg-slate-50">`, `th` = `px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500` with sort chevrons (active `text-primary-600`). Row `border-b border-slate-200 transition-colors` + `hover:bg-slate-50` (clickable) + selected `bg-primary-500/5`. Bulk bar `border-b border-primary-200 bg-primary-50 px-3 py-2.5`. Pagination footer `border-t border-slate-200 px-3 py-2.5` with page-size `<select>` + prev/next buttons (`disabled:opacity-50`). Supports `stickyHeader` (`sticky top-0 z-10`).

### 11.3 MultiSelectDropdown
Trigger is a **pill**: `inline-flex items-center gap-2 rounded-full border bg-white px-3 …` — sizes `sm:h-8 text-xs | md:h-10 text-sm | lg:h-11 text-sm`; when a filter is applied border→`border-primary-500` + a `bg-primary-100 text-primary-700` count chip; chevron rotates. Panel is **portaled** (`createPortal`), `fixed z-[9999] … rounded-xl border border-slate-200 bg-white shadow-xl animate-fade-in`, position computed (flips above when needed). Search row `border-b border-slate-200 p-3` (rounded-full input, appears when items > `searchThreshold=10` or `forceSearch`). Options list `max-h-64 overflow-auto p-2`; each row `flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50`, checkbox `h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500`, optional avatar `h-9 w-9 rounded-full bg-cyan-100 text-cyan-700`, selected label `font-medium text-primary-700` + trailing `Check text-primary-600`.
Props: `multiSelect=true`, `triggerVariant:'pill'|'input'`, `size`, `autoApply`, `forceSearch`, `searchThreshold=10`.

### 11.4 ComboBoxInput (autocomplete + custom entry)
Box `flex items-center gap-1 rounded border bg-white px-3 py-1.5 text-sm` (open→`border-blue-500`, else `border-slate-200`); shows a `Search` icon when open, a clear `X`, and a chevron that rotates. Panel `absolute left-0 right-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg`; group headers `sticky top-0 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500`; option `px-3 py-1.5 text-sm hover:bg-slate-50`, selected `bg-blue-50 text-blue-900` + `Check text-blue-600`. Custom-value row at the bottom (`border-t bg-slate-50`). Props: `value`, `onChange`, `allowCustom=true`, `displayLabelInsteadOfValue?`, `options:{value,label,group?,hint?}[]`.

### 11.5 RightSlidePanel (slide-over drawer)
`fixed inset-0 z-50 flex` → backdrop `absolute inset-0 bg-black/40 transition-opacity` + panel `relative ml-auto flex h-full flex-col bg-white shadow-2xl transition-transform duration-300` sliding `translate-x-full → translate-x-0`. Default width `w-full max-w-xl` (28rem). Header `flex items-start justify-between border-b border-gray-200 px-6 py-4` (title `text-lg font-semibold text-gray-900`, subtitle `text-sm text-gray-500`, close `rounded-lg p-1.5 text-gray-400 hover:bg-gray-100`). Body `flex-1 overflow-y-auto px-6 py-5`. Optional footer `border-t border-gray-200 px-6 py-4`. (Note: governance-light re-styles generic modals into this same right-drawer on `lg` — see §7.)

### 11.6 Toast + ToastProvider
Toast `pointer-events-auto w-80 rounded-lg border bg-white p-4 shadow-elevated transition-all duration-300`, slides `translate-x-full opacity-0 → translate-x-0 opacity-100`. Icon `size={20}`, title `text-sm font-medium`, message `text-sm text-slate-600`, dismiss `X size={16}`. Type styles (bg / border / icon): success `bg-success-500/10 border-success-500/30 text-success-400` (CheckCircle), error `danger` (AlertCircle), warning `warning` (AlertTriangle), info `info` (Info). Container `fixed top-4 right-4 z-50 flex flex-col gap-3 pointer-events-none`. Provider: `useToast()` → `toast({title,message?,type?,duration?})`, default `duration 5000ms`, `maxToasts 5`.

### 11.7 StatusBadge / SeverityBadge / MetricBadge
All: `inline-flex items-center rounded-full border font-medium` + size padding (`sm:px-1.5 py-0.5 text-xs | md:px-2 py-0.5 text-xs | lg:px-2.5 py-1 text-sm`), icon 10/12/14px.
- **StatusBadge** map (bg / text / border / icon): `open` red / `in_progress` yellow / `pending` amber / `resolved` blue / `closed` slate / `verified` green / `rejected` red / `draft` slate / `active` green / `inactive` slate / `accepted` **primary** / `overdue` red / `completed` green / `cancelled` slate. Pattern: `bg-{c}-50 text-{c}-600 border-{c}-200`.
- **SeverityBadge**: `critical bg-severity-critical/20 text-red-600 border-red-200` (AlertOctagon) · `high …/20 text-orange-600` (ShieldAlert) · `medium text-yellow-600` (AlertTriangle) · `low text-blue-600` (AlertCircle) · `info text-slate-600` (Info). Uses the `severity` Tailwind colors at 20% for the fill.
- **MetricBadge**: `inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium` (note: **rounded-md, not pill**) → `{label:} text-slate-600` + `{value} font-semibold`. Variants default/success/warning/danger/info/critical/high/medium/low.

### 11.8 PageHeader
`mb-4` → optional Breadcrumb (`mb-2.5`), then `flex items-start justify-between gap-3`: left = optional icon (`size={20}`, color `text-primary-600|emerald|amber|rose|cyan-600`) + `h1 text-xl font-semibold text-black tracking-tight` + subtitle `text-sm leading-snug text-slate-600 max-w-2xl`; right = `actions` in `flex items-center gap-2.5`. Optional `filters` row `mt-3 flex flex-wrap items-center gap-2`.

### 11.9 ProgressRing
SVG ring, `transform -rotate-90`; track circle `text-slate-200`, progress circle `strokeLinecap="round"` + `transition-[stroke-dashoffset] duration-1000 ease-out`. Center `%` label sizes by diameter (`<50→text-[11px]`, `<70→text-xs`, `<100→text-base`, else `text-xl`). Colors: `stroke-primary-500 text-primary-600` (+ success/warning/danger/info). Optional label `mt-1.5 text-[11px] font-medium text-slate-600`.

### 11.10 SearchInput
`relative inline-flex w-full items-center`; left `Search` icon `text-slate-400`; input `border border-slate-300 hover:border-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15`, `variant:'pill'→rounded-full | 'default'→rounded-lg`; sizes `sm:h-8 | md:h-10 | lg:h-11`; optional clear `X`.

### 11.11 FilterBar
`space-y-2.5` → row `flex flex-wrap items-center gap-2.5` with a flex-1 search (`min-w-64`, `rounded-lg border border-slate-300 … focus:ring-1 focus:ring-primary-500`) and one or more `<select>` filters (`appearance-none rounded-lg border border-slate-300 pl-3 pr-8` + absolute `ChevronDown`). Active-filter chips: `inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-0.5 text-xs text-primary-600` with an `X` remove and a "Clear all" text button.

### 11.12 TrendIndicator / Breadcrumb / PageLoader / ProgressRing
- **TrendIndicator**: up = `text-emerald-600`, down = `text-rose-600` (inverted flips), small arrow + delta.
- **Breadcrumb**: `flex items-center gap-2 text-sm text-slate-500`, separators `text-slate-300`, current `text-slate-800 font-medium`.
- **PageLoader**: 12-dot chasing ring (`pageLoaderDot/Halo/Spin` keyframes, §8) in brand teal — the standard full-area loading state.

---

## 12. Replication checklist for Procureverse

1. **Copy the three files:** `styles/tokens.css`, the `theme.extend` in `tailwind.config.ts`, and the `@layer base/components/utilities` blocks from `globals.css` (adjust the `@import` path to tokens).
2. **Fonts:** wire **Poppins** through `next/font` exposing `--font-poppins` (and a mono via `--font-mono`); the body must set `font-family: var(--font-poppins)`.
3. **App shell:** left `Sidebar` (`w-60` / `w-[64px]` collapsed, teal active state, grid-rows expand animation, collapsed flyouts, bottom admin popover) + top `Header` + `main` on `bg-slate-50`. Wrap the shell in `platform-ui` (and `compact-density` when the density toggle is on).
4. **Build screens from the component classes** in §4 (`.card`, `.stat-card`, `.table`, `.badge-*`, `.btn-*`, `.input`, `.tabs`, `.modal`, `.dropdown`) — do **not** invent new visual primitives.
5. **Brand = one teal** (`#1ed4b0`); semantic colors are the deep desaturated set; borders hairline `#DDE1E7`; radii 6–8px; default text 14px; shadows from the `card`/`elevated`/`modal` set.
6. **Icons:** `lucide-react`, `strokeWidth={1.75}`, `size` 16–18 in nav, matching the existing usage.
7. **Per-module theming:** if a screen needs the dense/clean treatment, wrap its root in the matching `*-light` class (e.g. `governance-light`, `dashboard-light`).

---

*Generated from the live Complyverse GRC frontend (`grc-frontend/`): `styles/tokens.css`, `tailwind.config.ts`, `src/app/globals.css`, `src/components/layout/{Sidebar,Header}.tsx`, `src/components/Providers.tsx`, and `src/components/ui/*`. Every value above is transcribed from source — hand this file to the Procureverse assistant as the single source of truth for the visual system.*
