// How the application shell lays out at a window width, as pure decisions: `node --test src/components/layout/shellMode.test.ts` runs them;
// useShellMode.ts applies them to the page (matchMedia) and Sidebar.tsx / Header.tsx act on the result.
//   full       >= 1280  the 240px sidebar (or the 64px rail, when the person collapsed it)
//   rail       1024-1279 a 64px icon rail; the full menu is the off-canvas drawer, opened from a button on the rail
//   offcanvas  < 1024   no sidebar in the page; the menu is the off-canvas drawer, opened from the top bar
// The numbers are Tailwind's `lg` and `xl`: the shell's responsive classes (hidden lg:flex, xl:w-60, lg:hidden ...) switch at the same widths,
// so the first paint is right before any script has run.

export type ShellMode = 'full' | 'rail' | 'offcanvas';

export const RAIL_MIN = 1024;
export const FULL_MIN = 1280;
export const RAIL_QUERY = `(min-width: ${RAIL_MIN}px)`;
export const FULL_QUERY = `(min-width: ${FULL_MIN}px)`;

export function shellModeFor(width: number): ShellMode {
  return width >= FULL_MIN ? 'full' : width >= RAIL_MIN ? 'rail' : 'offcanvas';
}

/** The same decision from the two media queries (what useShellMode reads). */
export function shellModeFromMatches(fullMatches: boolean, railMatches: boolean): ShellMode {
  return fullMatches ? 'full' : railMatches ? 'rail' : 'offcanvas';
}

// ---- the one thing the shell remembers: the collapsed sidebar, per browser ----

export const COLLAPSED_KEY = 'cw-sidebar-collapsed';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const browserStore = (): Store => window.localStorage;

/** True when the person collapsed the sidebar here before. Storage can be missing or throw (private window, blocked site data): then it is not collapsed. */
export function readCollapsed(store?: Store): boolean {
  try { return (store ?? browserStore()).getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

export function writeCollapsed(collapsed: boolean, store?: Store): void {
  try {
    const s = store ?? browserStore();
    if (collapsed) s.setItem(COLLAPSED_KEY, '1'); else s.removeItem(COLLAPSED_KEY);
  } catch { /* not remembered; the sidebar still collapses for this visit */ }
}
