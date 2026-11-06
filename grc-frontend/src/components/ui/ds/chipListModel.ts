// What a ChipList decides, apart from React so `node --test` can pin it (chipListModel.test.ts): the items it is given (strings or links), how many show as
// chips and how many are the "+N", whether the full list has a search box, how a search narrows it, and the names a screen reader gets. The component is
// ChipList.tsx.
import { moreCount } from '../../../lib/format.ts';
import { filterOptions } from './listboxModel.ts';

export interface ChipListItem {
  label: string;
  /** The item is a link to this address (in the chip and in the full list). */
  href?: string;
}

export type ChipListInput = string | ChipListItem;

/** Chips shown before the "+N": the first two (the rule for related records). */
export const SHOWN = 2;
/** The full list gets a search box from this many items. */
export const SEARCH_FROM = 8;

/** The items as the component draws them: a string is a label; a blank label is left out (an empty chip says nothing); an empty address is no address. */
export function chipItems(items: readonly ChipListInput[] | null | undefined): ChipListItem[] {
  const out: ChipListItem[] = [];
  (items ?? []).forEach((item) => {
    const label = String(typeof item === 'string' ? item : item?.label ?? '').trim();
    if (!label) return;
    const href = typeof item === 'string' ? '' : String(item?.href ?? '').trim();
    out.push(href ? { label, href } : { label });
  });
  return out;
}

/** The first `shown` as chips and how many are left for the "+N" (0: all of them fit, nothing is drawn after the chips). */
export function splitItems(items: readonly ChipListItem[], shown: number = SHOWN): { visible: ChipListItem[]; more: number } {
  const { shown: visible, more } = moreCount(items, shown);
  return { visible, more };
}

/** Whether the full list has a search box: from `from` items (default 8) a person looks for a name rather than reads down a list. */
export function searchable(total: number, from: number = SEARCH_FROM): boolean {
  return total >= from;
}

/** The items that match a search: every word of the query is in the label, any case, no accents (the same search as the kit's selects and the library).
 *  A blank query keeps all. */
export function filterItems<T extends ChipListItem>(items: readonly T[], query: string): T[] {
  const kept = filterOptions(items.map((item, i) => ({ value: String(i), label: item.label })), query);
  return kept.map((option) => items[Number(option.value)]);
}

/** The name of the "+N" button: "+3 more frameworks". It starts with the words on the button, so a person who says what they see can press it. */
export function moreName(more: number, label: string): string {
  const noun = label.trim();
  return `+${more} more${noun ? ` ${noun}` : ''}`;
}

/** The name of the full list: "All frameworks". */
export function dialogName(label: string): string {
  const noun = label.trim();
  return noun ? `All ${noun}` : 'All';
}

/** What the full list says about itself while a search narrows it ("3 of 12"); nothing while it shows everything. */
export function resultLine(shown: number, total: number): string {
  return shown === total ? '' : `${shown} of ${total}`;
}
