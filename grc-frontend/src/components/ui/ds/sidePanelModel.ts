// What a SidePanel decides, apart from React so `node --test` can pin it (sidePanelModel.test.ts): which of its three modes it is in at a window width,
// how wide it is, and where focus goes when it closes. The components are SidePanel.tsx and Sheet.tsx; usePanelMode.ts applies the width rule to the window.
//   docked   >= the dock width (default 1440)  a column beside the content: the content shrinks, nothing is covered, nothing is trapped
//   overlay  640 up to the dock width          over the content with a scrim, a focus trap and a locked page scroll
//   sheet    < 640                             a bottom sheet over the page, with the same scrim, trap and lock

export type PanelMode = 'docked' | 'overlay' | 'sheet';
export type PanelWidth = 'sm' | 'md' | 'lg';

/** Below this window width the panel is a bottom sheet (a phone). */
export const SHEET_BELOW = 640;
/** The default window width from which the panel docks. */
export const DOCK_FROM = 1440;
/** The width of the docked column and of the overlay, in px. The sheet is as wide as the window. */
export const PANEL_WIDTH: Readonly<Record<PanelWidth, number>> = { sm: 360, md: 480, lg: 640 };

/** The window width from which a panel docks. `Infinity` is "never"; a number that is not one, or one under 640 (where the panel is a sheet), is clamped
 *  so the three bands never overlap: a panel is never docked on a phone. */
export function dockWidth(dockFrom: number = DOCK_FROM): number {
  if (typeof dockFrom !== 'number' || Number.isNaN(dockFrom)) return DOCK_FROM;
  return Math.max(dockFrom, SHEET_BELOW);
}

/** The mode at a window width: a sheet under 640, docked from the dock width up, an overlay in between. */
export function panelModeFor(width: number, dockFrom: number = DOCK_FROM): PanelMode {
  if (width < SHEET_BELOW) return 'sheet';
  return width >= dockWidth(dockFrom) ? 'docked' : 'overlay';
}

/** The two media queries the mode follows: `dock` (null when the panel never docks) and `overlay`. */
export function panelQueries(dockFrom: number = DOCK_FROM): { dock: string | null; overlay: string } {
  const from = dockWidth(dockFrom);
  return { dock: Number.isFinite(from) ? `(min-width: ${from}px)` : null, overlay: `(min-width: ${SHEET_BELOW}px)` };
}

/** The same decision from the two queries (what usePanelMode reads). */
export function panelModeFromMatches(dock: boolean, overlay: boolean): PanelMode {
  return dock ? 'docked' : overlay ? 'overlay' : 'sheet';
}

/** Whether a panel's Escape handler takes this key press. Overlay and sheet always (they are the top layer; `overlayTakesEscape` has already ruled out
 *  a list, a menu or a dialog drawn over them). A docked column only when the page asked for it (`escapeClosesDocked`) and focus is inside it: a press
 *  anywhere else in the page is not the panel's. */
export function panelTakesEscape({ mode, escapeClosesDocked, focusInside }: { mode: PanelMode; escapeClosesDocked: boolean; focusInside: boolean }): boolean {
  return mode === 'docked' ? escapeClosesDocked && focusInside : true;
}

/** What `restoreFocus` names: an element, a ref to one, or a function that finds one when the panel closes (a row that has been drawn again since). */
export type FocusTarget = { current: HTMLElement | null } | (() => HTMLElement | null);

export function resolveFocusTarget(target: FocusTarget | undefined | null): HTMLElement | null {
  if (!target) return null;
  return typeof target === 'function' ? target() : target.current;
}

/** Where focus goes when the panel has closed. Only when focus is lost (on nothing or on <body>: the element that had it left the page with the panel);
 *  if the person (or the page) moved it somewhere on purpose it stays. The named target wins over the element that opened the panel; either must still
 *  be in the page. */
export function focusAfterClose({ lost, named, opener }: { lost: boolean; named: HTMLElement | null; opener: HTMLElement | null }): HTMLElement | null {
  if (!lost) return null;
  if (named && named.isConnected) return named;
  return opener && opener.isConnected ? opener : null;
}
