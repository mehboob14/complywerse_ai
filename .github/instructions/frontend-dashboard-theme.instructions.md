---
description: "Use when editing Next.js dashboard pages or shared app UI in grc-frontend. Enforces the ComplyVerse February 2026 light theme for dashboard work: white surfaces, black or slate text, light borders, blue active states, and explicit handling of any exceptions."
name: "Frontend Dashboard Theme"
applyTo:
  - "grc-frontend/src/app/(dashboard)/**/*.tsx"
  - "grc-frontend/src/components/**/*.tsx"
---

# Frontend Dashboard Theme

- Use white or very light surfaces for dashboard UI: `bg-white` for cards and panels, `bg-slate-50` for secondary sections and page backgrounds.
- Use dark text on light backgrounds: `text-black` or `text-slate-900` for headings, `text-slate-700` or `text-slate-600` for supporting text.
- Use light borders only: `border-slate-200` for containers and dividers, `border-slate-300` for inputs and interactive controls.
- Keep active and emphasis states blue: `text-blue-600`, `border-blue-600`, or equivalent existing primary token usage.
- Use soft semantic status colors with tinted backgrounds such as `bg-red-50 text-red-600 border-red-200` and `bg-green-50 text-green-600 border-green-200`.
- Preserve the shared component style established by the UI layer before inventing page-specific variants.
- If you touch an older dark-themed dashboard page, convert the edited area to the light theme instead of extending the dark styling unless there is a clear, intentional exception.
- If an exception is necessary, keep it local to that page or feature and do not spread the exception into shared dashboard components.

## Avoid

- Do not introduce `bg-slate-900`, `bg-slate-800`, `bg-slate-700`, or similar dark dashboard surfaces.
- Do not use `text-white` on cards, tables, forms, or page backgrounds.
- Do not use heavy shadows or glassmorphism when the surrounding UI is flat and light.

## Reference Pattern

```tsx
<section className="rounded-lg border border-slate-200 bg-white p-6">
  <h1 className="text-2xl font-semibold text-slate-900">Internal Controls</h1>
  <p className="mt-2 text-sm text-slate-600">
    Manage controls and monitor status.
  </p>
  <button className="mt-4 rounded-md border border-slate-300 bg-slate-50 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">
    Filter Controls
  </button>
</section>
```
