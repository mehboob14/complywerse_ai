// How the application shell lays out at a window width, as pure decisions: `node --test src/components/layout/shellMode.test.ts` runs them;
// useShellMode.ts applies them to the page (matchMedia) and the rail, the top bar and the Work and context panel act on the result.
//   docked   >= 1440   the icon rail and the Work and context panel docked beside the page (the page keeps scrolling, nothing is covered)
//   rail     1024-1439 the icon rail; the panel is an overlay opened from the top bar (Ctrl .)
//   drawer   < 1024    no rail in the page; the menu is the off-canvas drawer, opened from the top bar, and the panel is a bottom sheet
// The numbers are Tailwind's `lg` (1024) and the 1440 the panel docks from: the shell's responsive classes (hidden lg:flex, lg:hidden, min-[1440px]:...)
// switch at the same widths as the mode does, so a first paint is right before any script has run.

export type ShellMode = 'docked' | 'rail' | 'drawer';
/** Where the Work and context panel sits in each mode. */
export type PanelPlacement = 'dock' | 'overlay' | 'sheet';

export const RAIL_MIN = 1024;
export const DOCK_MIN = 1440;
export const RAIL_QUERY = `(min-width: ${RAIL_MIN}px)`;
export const DOCK_QUERY = `(min-width: ${DOCK_MIN}px)`;

/** The rail's width in px (a fixed column: nothing the data holds can move it). The brief said 56, but a short name under each icon has to be read at 12px: in Poppins "Governance" and
 *  "Compliance" are 74px, "My action" 59px, "Overview" 56px; at 56px six of the twelve names were cut ("Gove...", "Com..."), so the column is the lab's labelled rail (option B): 88px. */
export const RAIL_WIDTH = 88;

export function shellModeFor(width: number): ShellMode {
  return width >= DOCK_MIN ? 'docked' : width >= RAIL_MIN ? 'rail' : 'drawer';
}

/** The same decision from the two media queries (what useShellMode reads). */
export function shellModeFromMatches(dockMatches: boolean, railMatches: boolean): ShellMode {
  return dockMatches ? 'docked' : railMatches ? 'rail' : 'drawer';
}

export function placementOf(mode: ShellMode): PanelPlacement {
  return mode === 'docked' ? 'dock' : mode === 'rail' ? 'overlay' : 'sheet';
}
