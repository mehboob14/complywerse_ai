// What a Menu decides, apart from React so `node --test` can pin it (menuModel.test.ts): which item an arrow key moves to (disabled items are
// skipped) and where the menu is drawn so it stays inside the window. The component is components/ui/ds/Menu.tsx.

/** Anything with a `disabled` flag: the menu's items. */
export interface Entry { disabled?: boolean }

/** The nearest enabled item from position `from` going `step` (1 down, -1 up), wrapping round the ends. `from` may be -1 (before the first) or
 *  `items.length` (after the last) to start from an end. -1 when no item is enabled. */
export function nextIndex(items: readonly Entry[], from: number, step: 1 | -1): number {
  const n = items.length;
  for (let i = 1; i <= n; i++) {
    const at = (((from + step * i) % n) + n) % n;
    if (!items[at].disabled) return at;
  }
  return -1;
}

/** Where a key moves focus in an open menu whose focus is on item `from` (-1: on none of them): ArrowDown / ArrowUp step with a wrap, Home / End
 *  go to the first / last enabled item. null for any other key; -1 when nothing can take focus. */
export function indexForKey(items: readonly Entry[], from: number, key: string): number | null {
  switch (key) {
    case 'ArrowDown': return nextIndex(items, from, 1);
    case 'ArrowUp': return nextIndex(items, from < 0 ? items.length : from, -1);
    case 'Home': return nextIndex(items, -1, 1);
    case 'End': return nextIndex(items, items.length, -1);
    default: return null;
  }
}

/** A box in viewport pixels (what getBoundingClientRect gives). */
export interface Box { top: number; left: number; right: number; bottom: number }
export interface Placement { top: number; left: number; /** the room on the chosen side; the menu scrolls inside it when it is taller */ maxHeight: number }

/** Where a menu of `menu` size is drawn (position: fixed) next to `anchor` inside a window of `view` size: under the anchor, or over it when
 *  there is more room there, lined up with the anchor's right edge (`align: 'end'`) or left edge, and kept `margin` from every window edge.
 *  A menu taller than the room on either side gets the larger room as `maxHeight`. */
export function placeMenu(
  anchor: Box,
  menu: { width: number; height: number },
  view: { width: number; height: number },
  align: 'start' | 'end' = 'end',
  gap: number = 4,
  margin: number = 8,
): Placement {
  const wanted = align === 'end' ? anchor.right - menu.width : anchor.left;
  const left = Math.max(margin, Math.min(wanted, view.width - menu.width - margin));
  const below = view.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const under = menu.height <= below || below >= above;
  const room = Math.max(0, under ? below : above);
  return { left, top: under ? anchor.bottom + gap : anchor.top - gap - Math.min(menu.height, room), maxHeight: room };
}
