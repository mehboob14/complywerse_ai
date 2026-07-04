# UI Revamp — Change Log (for undo/rollback)

**Branch:** `ui-revamp` (all revamp work lives here; `main` is untouched).
**How to undo everything at once:** `git checkout main` — the app returns to its pre-revamp state instantly. To keep the branch but drop it from what ships, simply don't merge `ui-revamp`.
**How to undo one module:** each module is its own commit (see table). Revert a single commit with `git revert <sha>` (safe, creates an inverse commit) or inspect it with `git show <sha>`.
**Safety rules honored:** presentation-layer only by default (no changes to event handlers, API calls, state, data flow, or validation unless explicitly flagged + approved); data & API contracts intact; no DB/schema changes; backend never restarted by me.

---

## Legend
- **Scope** — `docs` (planning/spec, no app code) · `mockup` (throwaway HTML in /mockups, no app code) · `ui` (presentation-layer app code) · `fn` (functional change — only when audit-flagged AND approved).
- **Revert** — the exact command to undo just that entry.

---

## Phase 1 — Audit (no app code changed)

| # | Date | Scope | Files | What | Revert |
|---|------|-------|-------|------|--------|
| 1.1 | 2026-07-02 | docs | `UI-REVAMP-AUDIT-PHASE-1.md` (new) | Full Phase-1 audit of Governance · Risk · Compliance. No app code touched. | `git rm UI-REVAMP-AUDIT-PHASE-1.md` (or delete file) |

## Phase 2 — Design System (foundations; no app code changed yet)

| # | Date | Scope | Files | What | Revert |
|---|------|-------|-------|------|--------|
| 2.1 | 2026-07-04 | docs | `UI-REVAMP-CHANGES.md` (new) | This change log. | delete file |
| 2.2 | 2026-07-04 | docs | `DESIGN-SYSTEM.md` (new) | Authoritative design-system spec — real tokens (teal `#1ed4b0`, near-black-on-teal), semantic/neutral scales, component inventory + charter-clean flags + 13 gaps to build, pattern library w/ exemplar refs, 15-row DO/DON'T, Snapshot Test. | delete file |
| 2.3 | 2026-07-04 | mockup | `mockups/design-system.html` (new) | Visual living style guide (throwaway) — color ramps, type scale, buttons, chips, snapshot strip/board, register table, master-detail, DO/DON'T, empty state. | delete file |

> Phase 2 defines the system only. **No application code is modified in Phase 2.** Token/component/config changes are proposed here and applied per-module in Phase 3, each as its own revertible commit.

## Phase 3 — Module-by-module revamp

*(entries added per module as work proceeds — each row = one git commit)*

| # | Date | Scope | Module | Files | What | Commit / Revert |
|---|------|-------|--------|-------|------|-----------------|
| — | — | — | — | — | *(none yet — awaiting Phase 2 approval)* | — |

---

## Notes on pre-existing uncommitted work (NOT mine)
At branch creation, the working tree already contained uncommitted changes from prior sessions (documents workspace, controls, `api.ts`, some backend files, `RowActionsMenu.tsx`). **I do not commit these** — my commits use explicit file paths so your in-progress work is never swept in. If you want them preserved separately, commit them on `main` or a branch of your choosing before merging `ui-revamp`.
