// What AreaTiles decides, apart from React so `node --test` can pin it (areaModel.test.ts): one tile per area from a value that is a score of 0 to 100 (or "not
// scored"), the words of its status colour, the accessible name, how many tiles a card shows before "See all", and which tones the legend names. Nothing here
// knows a module: an area is a label, a number, a tone and an address.
import { formatCount } from '../../../lib/format.ts';

export type AreaTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface AreaTileItem {
  key: string;
  label: string;
  /** a score from 0 to 100 (the ring's fill); null: not scored, drawn as a grey ring and "Not scored", never as 0 */
  value: number | null;
  /** the figure as the tile says it ("72", "72%", "5 of 8"); default the rounded value */
  display?: string;
  tone: AreaTone;
  /** where the tile opens that area's records */
  href?: string;
  /** a fact in the tooltip and the accessible name, not drawn on the tile: "3 overdue" */
  note?: string;
}

/** The word each status colour carries (a colour never stands alone). A page with better words for its measure passes its own. */
export const AREA_WORDS: Record<AreaTone, string> = { good: 'On track', warn: 'Watch', bad: 'Off track', neutral: 'Not scored' };

export const AREA_MAX = 12;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export interface Tile {
  key: string;
  label: string;
  /** the ring's fill, 0 to 100 */
  fill: number;
  /** has a score (a score of 0 is scored: its ring is empty but still carries its colour as a dot) */
  scored: boolean;
  figure: string;
  tone: AreaTone;
  word: string;
  /** the figure in words for a screen reader and the tooltip: "72 out of 100" */
  figureName: string;
  /** the tooltip: "Cyber Security: 72 out of 100, Watch · 3 overdue" */
  title: string;
  /** the link's accessible name: "Open Cyber Security: 72 out of 100, Watch" (its visible words are inside it) */
  linkName: string;
  href?: string;
}

/** One item as a tile. A value that is not a number is "Not scored" and neutral whatever tone the page gave it: a ring never says "good" about nothing. */
export function tileOf(item: AreaTileItem, words: Partial<Record<AreaTone, string>> = {}): Tile {
  const scored = finite(item.value);
  const tone: AreaTone = scored ? item.tone : 'neutral';
  const word = (scored ? words[tone] ?? AREA_WORDS[tone] : words.neutral ?? AREA_WORDS.neutral);
  const rounded = scored ? Math.round(item.value as number) : null;
  const figure = scored ? item.display ?? formatCount(rounded as number) : '—';
  const figureName = scored ? item.display ?? `${formatCount(rounded as number)} out of 100` : 'not scored';
  const note = item.note ? ` · ${item.note}` : '';
  return {
    key: item.key, label: item.label, tone, word, figure, figureName, scored,
    fill: scored ? Math.max(0, Math.min(100, item.value as number)) : 0,
    title: `${item.label}: ${figureName}, ${word}${note}`,
    linkName: `Open ${item.label}: ${figureName}, ${word}${note}`,
    href: item.href,
  };
}

/** The first `max` tiles and how many are left for "See all N" (the true total, never a cut list pretending to be whole). */
export function tilesOf(items: readonly AreaTileItem[], max = AREA_MAX, words: Partial<Record<AreaTone, string>> = {}): { shown: Tile[]; total: number; hidden: number } {
  const keep = Math.max(1, Math.floor(max));
  return { shown: items.slice(0, keep).map((i) => tileOf(i, words)), total: items.length, hidden: Math.max(0, items.length - keep) };
}

const ORDER: readonly AreaTone[] = ['good', 'warn', 'bad', 'neutral'];

/** The tones that appear among the shown tiles, in the fixed order, each with its word: the legend names only what is drawn. */
export function legendOf(tiles: readonly Pick<Tile, 'tone' | 'word'>[]): Array<{ tone: AreaTone; word: string }> {
  return ORDER.filter((t) => tiles.some((x) => x.tone === t)).map((t) => ({ tone: t, word: tiles.find((x) => x.tone === t)!.word }));
}

/** "See all 17": the link under a cut grid; "" when nothing is hidden. */
export const moreText = (total: number, hidden: number, moreLabel?: string): string => (hidden > 0 ? moreLabel ?? `See all ${formatCount(total)}` : '');

/** About how tall a grid of `count` tiles is (px), for a card's skeleton: 52px a tile, 8px between, `perRow` tiles across (default 4 on a wide card, 2 on a phone). */
export function areaTilesHeight(count: number, perRow = 4): number {
  const rows = Math.max(1, Math.ceil(Math.max(0, count) / Math.max(1, perRow)));
  return rows * 52 + (rows - 1) * 8;
}
