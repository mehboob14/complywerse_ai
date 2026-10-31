// Where a note goes beside the thing that opened it (the +M list of a PersonStack). Pure, so `node --test` runs popoverSpot.test.ts against
// it; the note is drawn fixed to the window (a portal), so no card, table or dialog body clips it.

export interface Box { left: number; right: number; top: number; bottom: number }

export interface Spot {
  left: number;
  width: number;
  /** under the anchor: the distance from the top of the window */
  top?: number;
  /** above the anchor: the distance from the bottom of the window */
  bottom?: number;
  /** the room on that side, so a long list scrolls instead of leaving the window */
  maxHeight: number;
}

/** A note up to `width` wide (less on a narrow window) lined up with the anchor's left edge and kept on screen. Under the anchor when `need`
 *  px fit there or there is more room below than above; else above it. */
export function popoverSpot(anchor: Box, view: { width: number; height: number }, { width = 256, need = 96, gap = 6, margin = 8 } = {}): Spot {
  const w = Math.max(0, Math.min(width, view.width - 2 * margin));
  const left = Math.max(margin, Math.min(anchor.left, view.width - w - margin));
  const below = view.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  return below >= need || below >= above
    ? { left, width: w, top: anchor.bottom + gap, maxHeight: Math.max(0, below) }
    : { left, width: w, bottom: view.height - anchor.top + gap, maxHeight: Math.max(0, above) };
}
