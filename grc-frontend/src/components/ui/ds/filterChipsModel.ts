// What a row of FilterChips decides, apart from React so `node --test` can pin it (filterChipsModel.test.ts): which chips stay in the row and which go
// to the "+N more" menu, how a count reads (the true number, "1,247", never "99+"), what a chip says as one string, which chip the Tab key lands on and
// where an arrow key moves. The component is FilterChips.tsx.
import { formatCount } from '../../../lib/format.ts';
import { nextTab, reachableKeys } from '../../../lib/tabsModel.ts';

export type FlagTone = 'info' | 'warning' | 'danger' | 'success';

/** A mark on a chip: a dot (no `text`) or a small badge with `text` (an overdue count). It always has `label`, the words for a screen reader and the tooltip:
 *  a flag is never colour alone. */
export interface ChipFlag { tone: FlagTone; text?: string | number; label: string }

/** The part of a chip these rules read. */
export interface ChipLike { key: string; label: string; count?: number | null; active?: boolean; flag?: ChipFlag; disabled?: boolean; hidden?: boolean }

/** The count as the chip draws it: the true number with its separator ("1,247"); '' when there is none (missing, or not a number). 0 is a count. */
export function countText(count: number | null | undefined): string {
  return typeof count === 'number' && Number.isFinite(count) ? formatCount(Math.max(0, count)) : '';
}

/** What a chip says as one string ("Overdue, 12, 3 overdue actions"): its tooltip when its label is cut, and what the tests compare. */
export function chipText(chip: ChipLike): string {
  const count = countText(chip.count);
  return [chip.label.trim(), count, chip.flag?.label.trim() ?? ''].filter(Boolean).join(', ');
}

/** The chips that stay in the row and the ones that go to the "+N more" menu. With no `maxVisible` all stay. A cut that would leave a single chip in the
 *  menu is not made ("+1 more" saves nothing: the chip would have taken the same room). A hidden chip is in neither. */
export function splitChips<T extends ChipLike>(chips: readonly T[], maxVisible?: number): { row: T[]; more: T[] } {
  const shown = chips.filter((c) => !c.hidden);
  if (maxVisible == null || !Number.isFinite(maxVisible)) return { row: shown, more: [] };
  const keep = Math.max(1, Math.floor(maxVisible));
  if (shown.length <= keep + 1) return { row: shown, more: [] };
  return { row: shown.slice(0, keep), more: shown.slice(keep) };
}

/** The words on the "+N more" trigger: "+3 more", and "+3 more · 1 on" when a chip in the menu is on (the person must not lose sight of a filter that is
 *  applied because it does not fit in the row). */
export function moreText(more: readonly ChipLike[]): { text: string; on: number } {
  const on = more.filter((c) => c.active).length;
  return { on, text: `+${more.length} more${on > 0 ? ` · ${on} on` : ''}` };
}

/** The items of the "+N more" menu: the label (with the flag's words in brackets, so nothing a chip said is lost), the count at its end, a check when it is on. */
export function moreItems<T extends ChipLike>(more: readonly T[]): Array<{ key: string; label: string; checked: boolean; trailing?: string; disabled?: boolean }> {
  return more.map((c) => {
    const count = countText(c.count);
    return { key: c.key, label: c.flag ? `${c.label.trim()} (${c.flag.label.trim()})` : c.label.trim(), checked: !!c.active, trailing: count || undefined, disabled: c.disabled };
  });
}

/** The one chip the Tab key lands on (a roving tab stop): the one that last had focus, else the first one that is on, else the first that can be reached. */
export function chipStop(chips: readonly ChipLike[], focused: string | null): string | null {
  const reachable = reachableKeys(chips);
  if (focused !== null && reachable.indexOf(focused) >= 0) return focused;
  const on = chips.find((c) => c.active && reachable.indexOf(c.key) >= 0);
  return on ? on.key : reachable.length > 0 ? reachable[0] : null;
}

/** Where an arrow key moves from chip `current`: ArrowRight and ArrowLeft step with a wrap, Home and End jump; a disabled chip is skipped; any other key is
 *  null. The rule of the kit's Tabs, without opening anything: a chip is toggled by Enter or Space, never by an arrow. */
export function nextChip(chips: readonly ChipLike[], current: string, key: string): string | null {
  return nextTab(reachableKeys(chips), current, key);
}
