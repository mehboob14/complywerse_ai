# GRC-Tenant — Design Reference

A flat, copy-pasteable reference for the visual language used across the
platform. Sourced from the Assets / Criticality Assessments / Issues
modules — those are the most-iterated, "done" surfaces. New screens
should mirror these patterns.

Tailwind utility-first. No design tokens file; the strings below ARE the
tokens — search-and-replace if a colour shifts.

---

## 1. Colour palette

### Neutrals (the bulk of the UI)

| Use | Class | Notes |
|---|---|---|
| Page background | `bg-slate-50` | Light grey, never pure white |
| Card background | `bg-white` | Always white inside cards |
| Card border | `border-slate-200` | One-pixel border, no shadow ladder |
| Subtle border | `border-slate-100` | Inside-card dividers, tab strips |
| Primary text | `text-slate-900` | Default body copy |
| Secondary text | `text-slate-700` | Subheads, field values |
| Muted text | `text-slate-500` | Hints, timestamps, labels |
| Disabled text | `text-slate-400` | Inactive icons, placeholders |

### Primary (action + selection)

| Use | Class |
|---|---|
| Primary button bg | `bg-blue-600 hover:bg-blue-700` |
| Primary button text | `text-white` |
| Selection tint bg | `bg-blue-50` |
| Selection text | `text-blue-700` / `text-blue-800` |
| Selection border | `border-blue-200` |
| Focus ring | `focus:border-blue-500 focus:ring-1 focus:ring-blue-500` |
| Active chip icon | `text-blue-600` |

### Status tones

Always **bg-tone-50 / text-tone-700 / border-tone-200** for pills.

| Status | Tone |
|---|---|
| Success / Approved / Active | `emerald` (bg-emerald-50 text-emerald-700 border-emerald-200) |
| Warning / Pending / In-review | `amber` |
| Danger / Rejected / Overdue | `rose` |
| Info / Linked / From-library | `indigo` |
| Neutral / Draft / Inactive | `slate` (bg-slate-100 text-slate-600 border-slate-200) |

### Criticality bands

Used by ISCA / IACA / asset criticality, applied to chips, donut slices,
band weighting bars.

| Band | Hex | Tailwind chip |
|---|---|---|
| Mission-Critical | `#f43f5e` (rose-500) | `bg-rose-50 text-rose-700 border-rose-200` |
| High             | `#fb923c` (orange-400) | `bg-orange-50 text-orange-700 border-orange-200` |
| Moderate         | `#facc15` (yellow-400) | `bg-yellow-50 text-yellow-700 border-yellow-200` |
| Low              | `#34d399` (emerald-400) | `bg-emerald-50 text-emerald-700 border-emerald-200` |

### Severity (issues / vulns)

| Severity | Pill |
|---|---|
| Critical | `bg-red-50 text-red-600` |
| High     | `bg-orange-50 text-orange-600` |
| Medium   | `bg-yellow-50 text-yellow-600` |
| Low      | `bg-blue-50 text-blue-600` |
| Info     | `bg-slate-50 text-slate-600` |

---

## 2. Right-side slide-out drawer

Used for: **create / edit Asset**, **create / edit Criticality
Assessment**, **edit RCSA assessment item**.

Center modals (`fixed inset-0 flex items-center justify-center`) are
**only** for sub-flows (Bulk Import, Artifact details, simple confirms)
that open *over* a drawer. Main create / edit always uses the right slide.

### Shell

```tsx
<>
  {/* Light backdrop — visual cue only, does NOT dismiss on click
      (mid-edit data loss is more annoying than the dim). */}
  <div className="fixed inset-0 z-40 bg-black/30" aria-hidden="true" />
  <div className="fixed inset-y-0 right-0 z-50 flex w-full sm:w-[780px] flex-col bg-white shadow-2xl border-l border-slate-200">
    {/* Header */}
    <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-sm font-semibold text-slate-900 truncate">{title}</h2>
        {/* headerExtra slot — status pill etc. */}
      </div>
      <button onClick={onClose} className="text-slate-500 hover:text-slate-900 shrink-0">
        <X className="h-5 w-5" />
      </button>
    </div>

    {/* Body — independent scroll region */}
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
      {children}
    </div>

    {/* Footer */}
    <div className="flex-shrink-0 flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
      <div className="min-w-0">{/* footerExtra: Promote/Export/Print buttons */}</div>
      <div className="flex items-center gap-2 shrink-0">
        <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          <Save className="h-4 w-4" />
          Save
        </button>
      </div>
    </div>
  </div>
</>
```

**Width**: `w-full sm:w-[780px]` — full screen on mobile, 780px on tablet+

**Dismissal**:
- Esc key (wire a `useEffect` keydown listener)
- Cancel / X button
- **Not** the backdrop

---

## 3. Searchable combobox (the most reused pattern)

References:
- Single-select: `AssetPicker` in `/assets/criticality-assessments/page.tsx`
- Multi-select: `EntityMultiCombobox` in `/issues/_components/EntityMultiCombobox.tsx`

### Anatomy

1. **Trigger button** — white pill that shows the current selection (or
   placeholder), with leading icon, optional clear (×), trailing chevron
2. **Popover panel** — anchored under the trigger via
   `absolute left-0 right-0 top-full mt-1 z-30`
3. **Search input** — top of the panel, auto-focused on open,
   `Esc` closes
4. **Scrollable list** — `max-h-72 overflow-y-auto py-1`
5. **Empty state** — small centered grey text
6. **Footer** (multi-select only) — `N selected of M` + Done button

### Trigger button styling

```tsx
className={`w-full flex items-center gap-2 rounded-md border bg-white text-slate-900 px-2.5 py-1.5 text-xs transition-colors ${
  open
    ? 'border-blue-500 ring-1 ring-blue-500'
    : 'border-slate-300 hover:border-slate-400'
}`}
```

### Selected pill (multi-select)

```tsx
<span className="inline-flex items-center gap-1 rounded bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 max-w-[180px]">
  <span className="truncate">{label}</span>
  <button className="h-3 w-3 rounded text-blue-600 hover:bg-blue-100">
    <X className="h-2.5 w-2.5" />
  </button>
</span>
```

### Row in the list

```tsx
className={`w-full flex items-start gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
  isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
}`}
```

### Behaviours (every combobox should do these)

- Outside-click closes the panel (mousedown listener on `document`)
- Esc closes
- Search input auto-focuses on open via `requestAnimationFrame`
- Lazy query — `enabled: open || value.length > 0` keeps a form with N
  pickers from firing N list calls on mount
- The currently-selected item's label survives a search filter that
  would normally hide it (lazy-fetch by id with 5-minute stale time)

---

## 4. Form fields

Single class string used everywhere — `bg-white text-slate-900` is
**not optional**, native `<select>` browsers render off-white otherwise.

### Input / Select / Textarea

```html
<input className="block w-full text-sm rounded-md border border-gray-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
```

For larger / more emphasized fields (Asset modal):

```html
<input className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" />
```

### Field label

```tsx
<label className="block text-xs font-medium text-slate-600 mb-0.5">
  Field name <span className="text-rose-600">*</span>
</label>
```

Tiny / drawer labels:

```tsx
<label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
  Label
</label>
```

### Field hint (right of label)

```tsx
<span className="ml-1 text-[10px] text-gray-400 font-normal">(optional)</span>
```

---

## 5. Buttons

### Primary

```html
<button className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
  <Save className="h-4 w-4" />
  Save
</button>
```

### Secondary (cancel)

```html
<button className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
  Cancel
</button>
```

### Tertiary / link

```html
<button className="text-xs text-blue-600 hover:underline">
  Open →
</button>
```

### Danger (delete)

```html
<button className="text-[11px] text-rose-600 hover:text-rose-700 px-2 py-1 border border-rose-200 rounded">
  <Trash2 className="h-3 w-3" />
</button>
```

### Success / upload

```html
<button className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
  <Upload className="h-3.5 w-3.5" />
  Upload
</button>
```

### Mini toolbar button (in tables / lists)

```html
<button className="text-[11px] text-slate-600 hover:text-slate-900 px-2 py-1 border border-slate-300 rounded">
  <Download className="h-3 w-3" />
</button>
```

---

## 6. Status pills / chips

Generic shape: `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border`

| Variant | Classes |
|---|---|
| Approved | `bg-emerald-50 text-emerald-700 border-emerald-200` |
| Submitted (in review) | `bg-blue-50 text-blue-700 border-blue-200` |
| Business-owner review | `bg-amber-50 text-amber-700 border-amber-200` |
| CISO review | `bg-violet-50 text-violet-700 border-violet-200` |
| Rejected | `bg-rose-50 text-rose-700 border-rose-200` |
| Returned | `bg-orange-50 text-orange-700 border-orange-200` |
| Draft / Inactive | `bg-slate-100 text-slate-600 border-slate-200` |

**Count chip** (next to a tab label):

```tsx
<span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
  {count}
</span>
```

**Tiny "From library" / lineage badge:**

```tsx
<span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wide font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1 py-0.5">
  <Link2 className="h-2.5 w-2.5" />
  Library
</span>
```

---

## 7. Cards

### Standard panel

```html
<section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
    Title
  </h3>
  {/* content */}
</section>
```

### Clickable / KPI tile

```html
<Link className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm transition">
  ...
</Link>
```

### Inline notice / info card

Tinted; matches the section's intent.

```tsx
<div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 text-xs text-blue-800">
  Inline help / explanation.
</div>
```

Tints:
- Info → `border-blue-100 bg-blue-50/40 text-blue-800`
- Success → `border-emerald-200 bg-emerald-50/40 text-emerald-800`
- Warning → `border-amber-200 bg-amber-50 text-amber-800`
- Danger → `border-rose-200 bg-rose-50 text-rose-700`
- Highlight → `border-violet-200 bg-violet-50/40 text-violet-800`
- Linked → `border-indigo-200 bg-indigo-50/40 text-indigo-800`

---

## 8. Tab navigation

Used on: drawer body, page-level tabs (`/admin/audit-logs`,
`/assets/[id]`, `/risks/rcsa/custom-templates`).

### Page-level

```tsx
<div className="rounded-lg border border-gray-200 bg-white px-3">
  <nav className="flex gap-1">
    <button
      className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      <Icon className="h-4 w-4" />
      Label
    </button>
  </nav>
</div>
```

### Drawer-level (compact)

Same shape; smaller padding (`py-1.5`) and `text-xs`.

---

## 9. Tables

```html
<div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
  <table className="min-w-full text-sm">
    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
      <tr>
        <th className="px-4 py-2">Name</th>
        ...
      </tr>
    </thead>
    <tbody className="divide-y divide-slate-100">
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <div className="font-medium text-slate-900">Primary</div>
          <div className="text-[11px] text-slate-500">Secondary / id</div>
        </td>
        ...
      </tr>
    </tbody>
  </table>
</div>
```

Empty state inside a table area:

```tsx
<div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
  <Icon className="mx-auto h-10 w-10 text-slate-300" />
  <p className="mt-3 text-sm font-medium text-slate-700">Empty headline</p>
  <p className="mt-1 text-xs text-slate-500">Helpful next-step copy.</p>
</div>
```

---

## 10. Icons

**Library**: `lucide-react`. Never mix icon libraries.

**Sizes** (in roughly this order of frequency):

| Use | Class |
|---|---|
| Inline chip / button | `h-3 w-3` |
| Inline label | `h-3.5 w-3.5` |
| Standard control | `h-4 w-4` |
| Card header | `h-5 w-5` |
| Empty-state hero | `h-10 w-10` |

**Tones** — pair the icon colour with the surrounding intent:

- `text-slate-400` — inactive / placeholder
- `text-slate-500` — secondary
- `text-blue-600` — active / selected / link
- `text-emerald-600` — success / file attached
- `text-rose-600` — danger
- `text-indigo-600` — library / lineage
- `text-amber-600` — warning

---

## 11. Spacing rhythm

Internal spacing in any vertical stack: `space-y-2` (tight) /
`space-y-3` (default) / `space-y-4` (between sections) / `space-y-5`
(drawer body, biggest breath).

Card padding: `p-3` (compact list cards), `p-4` (default), `p-5`
(drawer body / hero cards), `p-8` (empty states).

Horizontal page padding: `px-3 sm:px-4 pt-3` on the page root.

---

## 12. Typography scale

| Use | Class |
|---|---|
| Page title | `text-lg font-semibold text-slate-900` |
| Section title | `text-sm font-semibold text-slate-900` |
| Subhead (uppercase) | `text-xs font-semibold uppercase tracking-wide text-slate-600` |
| Body | `text-sm text-slate-700` |
| Small / meta | `text-xs text-slate-500` |
| Tiny / chip text | `text-[10px]` or `text-[11px]` |

Numbers / IDs / file paths: add `font-mono`.

---

## 13. Rounding scale

- Pills / chips: `rounded-full` or `rounded`
- Form fields: `rounded-md`
- Buttons: `rounded-md` (compact) / `rounded-lg` (default)
- Cards: `rounded-xl`
- Drawers / modals: `rounded-2xl` (when centred) / square (slide-out)

---

## 14. Anti-patterns (don't)

- Don't use centred modals for **create / edit** flows. Use the
  right-side drawer.
- Don't use raw `<select>` for anything with > 10 options or where the
  user might want to type to find an item. Use the combobox.
- Don't omit `bg-white text-slate-900` on form controls — native UA
  colours leak through.
- Don't use `appearance-none` on `<select>` without supplying your own
  chevron — you lose the dropdown arrow.
- Don't add `bg-black/50` or darker on a slide-out drawer backdrop.
  `bg-black/30` is the cap.
- Don't mix icon libraries. Lucide only.
- Don't introduce a new colour ramp. Reach for `slate / blue / emerald /
  amber / rose / indigo / violet / orange / yellow` only.
- Don't hand-roll a popover with `position: fixed`. Use
  `absolute left-0 right-0 top-full mt-1 z-30` anchored to a
  `relative` wrapper.

---

## 15. Canonical references

When in doubt, copy from these files:

| Surface | File |
|---|---|
| Right-side drawer shell | `grc-frontend/src/app/(dashboard)/assets/criticality-assessments/page.tsx` (Drawer function) |
| Asset modal (older but well-trodden) | `grc-frontend/src/app/(dashboard)/assets/page.tsx` (AssetModal) |
| Single-select combobox | `grc-frontend/src/app/(dashboard)/assets/criticality-assessments/page.tsx` (AssetPicker) |
| Multi-select combobox | `grc-frontend/src/app/(dashboard)/issues/_components/EntityMultiCombobox.tsx` |
| User combobox + Evidence-library combobox | `grc-frontend/src/app/(dashboard)/risks/rcsa/custom-templates/[id]/page.tsx` (UserCombobox, EvidenceLibraryCombobox) |
| Status pills + approval bar | `grc-frontend/src/app/(dashboard)/assets/criticality-assessments/_components/ApprovalBar.tsx` |
| Day-grouped audit feed | `grc-frontend/src/app/(dashboard)/assets/criticality-assessments/_components/ActivityPanel.tsx` |
| Comments thread | `grc-frontend/src/app/(dashboard)/assets/criticality-assessments/_components/CommentsPanel.tsx` |
| Evidence list / upload card | `grc-frontend/src/app/(dashboard)/assets/criticality-assessments/_components/EvidencePanel.tsx` |
| Tab strip (page level) | `grc-frontend/src/app/(dashboard)/risks/rcsa/custom-templates/page.tsx` |
| Coverage widget (clickable KPI) | `grc-frontend/src/components/assets/CriticalityCoverageWidget.tsx` |
| KPI tiles + donut charts | `grc-frontend/src/app/(dashboard)/assets/criticality-assessments/analytics/page.tsx` |
| Print view (chrome-free) | `grc-frontend/src/app/(dashboard)/assets/criticality-assessments/[kind]/[id]/print/page.tsx` |
