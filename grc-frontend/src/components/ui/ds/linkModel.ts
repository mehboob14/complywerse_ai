// The classes of a link that is part of text or of a card, as plain strings so they can be tested (linkModel.test.ts). The pages of the first wave each wrote
// the same four: a title link, a link in a sentence, a muted link and a label link, all with the same trick: vertical padding that brings a line of text up to a
// 24px target (44px on a phone) and a negative margin of the same size that cancels it, so nothing in the layout moves. Kit rules apply: tokens and arbitrary
// values only (the platform CSS repaints the named utilities inside the shell). The components are TitleLink and CardLink in Links.tsx.

/** Which colours a link has: `title` is the record's name (dark, the brand colour on hover), `text` is a link inside a sentence or a card line (the brand
 *  colour), `muted` is a link in a quiet line (grey until hovered). */
export type LinkTone = 'title' | 'text' | 'muted';

/** The size of the line the link sits in: `body` is a 13px/20px line, `label` a 12px/16px line. The padding that makes the target depends on it. */
export type LinkSize = 'body' | 'label';

const BASE = 'rounded-ds-control underline-offset-[2px] focus-visible:outline-none focus-visible:shadow-ds-ring';

// 20px line + 2px above and below = 24px; on a phone 12px each = 44px. A 16px line: 4px = 24px, 14px = 44px. The margin cancels the padding exactly.
const TARGET: Record<LinkSize, string> = {
  body: 'py-[2px] -my-[2px] max-md:py-[12px] max-md:-my-[12px]',
  label: 'py-[4px] -my-[4px] max-md:py-[14px] max-md:-my-[14px]',
};

const TONE: Record<LinkTone, string> = {
  title: 'font-medium text-ds-fg hover:text-ds-primary-text hover:underline',
  text: 'font-medium text-ds-primary-text hover:underline',
  muted: 'text-ds-fg-muted hover:text-ds-primary-text hover:underline',
};

/** The classes of a link in text: its colours, its ring, and the padding that makes it a 24px target (44px on a phone) without moving anything. For a link
 *  that is a block of its own (a title) use TitleLink; for one inside a sentence or a 12px line put these on the `<Link>`. */
export function linkClasses({ tone = 'title', size = 'body' }: { tone?: LinkTone; size?: LinkSize } = {}): string {
  return [BASE, TARGET[size], TONE[tone]].join(' ');
}

/** The classes of a card that is one link: the box of a card, a hover that says it is pressable, the ring on the card itself. */
export const CARD_LINK = 'block min-w-0 rounded-ds-card border border-ds-border bg-ds-surface text-left hover:border-ds-border-strong focus-visible:outline-none focus-visible:shadow-ds-ring';

/** The padding inside a card link, when it has any (a card whose content brings its own edge-to-edge parts turns it off). */
export const CARD_LINK_PADDING = 'p-[16px]';
