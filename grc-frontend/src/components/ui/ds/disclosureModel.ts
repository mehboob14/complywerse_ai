// What a Disclosure and an AccordionRow decide, apart from React so `node --test` can pin it (disclosureModel.test.ts): who holds the open state (the page
// when it passes `open`, the component when it does not), what a press on the header does, the ids that tie the button to its panel, how a number beside a
// facet group's name is drawn, and when a long title is repeated in full inside the open row. The components are Disclosure.tsx.
import { formatCount } from '../../../lib/format.ts';

/** Who holds the open state: the page when it gives `open` (controlled), else the component (uncontrolled, starting from `defaultOpen`). */
export function isOpen({ open, inner }: { open: boolean | undefined; inner: boolean }): boolean {
  return open === undefined ? inner : open;
}

/** What a press on the header does: the state it asks for, and whether the component keeps it itself (uncontrolled) or leaves it to the page (controlled,
 *  which is told through `onOpenChange` either way). */
export function pressedState({ open, inner }: { open: boolean | undefined; inner: boolean }): { next: boolean; keep: boolean } {
  return { next: !isOpen({ open, inner }), keep: open === undefined };
}

/** The ids that tie the header button to its panel (`aria-controls`, `aria-labelledby`). `base` is unique per instance (React's useId). */
export function disclosureIds(base: string): { button: string; panel: string } {
  return { button: `${base}-header`, panel: `${base}-panel` };
}

/** The number beside a facet group's name: how many are chosen in it ("2"), the true number with its separator ("1,247"); nothing when none is (0, missing). */
export function groupCount(count: number | null | undefined): string {
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? formatCount(count) : '';
}

/** A title longer than this is cut at two lines in the row's header, so the open row says it again in full (the whole value must be one press away). */
export const LONG_TITLE = 80;

export function repeatsTitle(title: string, max: number = LONG_TITLE): boolean {
  return title.trim().length > max;
}

/** The heading level of the header: 2 to 6, else 3 (a row of a list sits under the page's own h2). */
export function headingLevel(level: number | undefined): 2 | 3 | 4 | 5 | 6 {
  return level === 2 || level === 3 || level === 4 || level === 5 || level === 6 ? level : 3;
}
