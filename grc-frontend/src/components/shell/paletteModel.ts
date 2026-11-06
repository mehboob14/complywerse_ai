// What the command palette lists, in which order, and how a match is drawn, as pure decisions (`node --test src/components/shell/paletteModel.test.ts`).
// The palette gets its raw material already limited to what the person may open (pages: searchRoutes with the shell's `allow`; records: the server's own filters; actions: the
// rights they need), and this file orders it: with nothing typed, the queue, what is pinned, what was opened last and a few actions; with a query, the queue items that match,
// pages and records (the group whose best match is better first: typing a document's name puts it above the pages that merely contain a word of it) and the actions.
import { fold } from '../../lib/navRegistry.ts';
import type { Shortcut } from './pinnedRecent.ts';

export type PaletteGroupName = 'Needs my action' | 'Pinned' | 'Recent' | 'Pages' | 'Records' | 'Actions';
export type PaletteIcon = 'page' | 'file' | 'users' | 'calendar' | 'pin' | 'clock' | 'plus' | 'sparkles' | 'check' | 'help' | 'inbox' | 'queue';
export type ActionId = 'new-document' | 'ai-draft' | 'pin-page' | 'mark-read' | 'guide' | 'ask';

export interface PaletteOption {
  id: string;
  group: PaletteGroupName;
  label: string;
  sub?: string;
  icon: PaletteIcon;
  /** a path of this app: Enter opens it */
  href?: string;
  /** or Enter runs this */
  action?: ActionId;
}

export interface PendingHit { key: string; title: string; sub: string; href: string }
export interface PageHit { path: string; label: string; sub: string }
export interface RecordHit { id: string; label: string; sub: string; href: string; kind: 'document' | 'committee' | 'meeting' }
export interface ActionDef { id: ActionId; label: string; sub: string; icon: PaletteIcon }

/** A source of records as the palette last knew it. */
export interface RecordSource { status: 'idle' | 'loading' | 'ready' | 'failed'; hits: RecordHit[]; total?: number }
export type RecordSourceName = 'documents' | 'committees' | 'meetings';

export interface PaletteInput {
  query: string;
  pages: readonly PageHit[];
  records: Readonly<Record<RecordSourceName, RecordSource>>;
  pending: readonly PendingHit[];
  acknowledgements: number;
  pins: readonly Shortcut[];
  recent: readonly Shortcut[];
  actions: readonly ActionDef[];
}

export interface PaletteNotice { source: RecordSourceName; text: string }
export interface PaletteView {
  groups: Array<{ name: PaletteGroupName; options: PaletteOption[]; note?: string }>;
  /** every option in screen order: the keyboard walks this */
  options: PaletteOption[];
  notices: PaletteNotice[];
  /** a record source is still being asked */
  searching: boolean;
  /** how many documents match, when more than are listed */
  documentsTotal: number;
}

export const LIMITS = { pending: 3, pins: 4, recent: 5, emptyActions: 4, pages: 6, records: 6, queuePending: 2, actions: 3 } as const;
const SOURCE_TEXT: Record<RecordSourceName, string> = { documents: 'Documents', committees: 'Committees', meetings: 'Meetings' };

// built from a string: the source is compiled for ES5, which rejects a Unicode property escape in a literal (lib/navRegistry.ts does the same)
const SEPARATORS = new RegExp('[^\\p{L}\\p{N}]+', 'gu');

/** How well a label matches: 0 it is the query, 1 starts with it, 2 a word starts with it, 3 it is inside, 4 not at all (the server matched something else, a code or a description). */
export function matchTier(label: string, query: string): number {
  const text = ` ${fold(label).replace(SEPARATORS, ' ').trim()} `;
  const q = fold(query).replace(SEPARATORS, ' ').trim();
  if (!q) return 4;
  if (text === ` ${q} `) return 0;
  if (text.indexOf(` ${q}`) === 0) return 1;
  if (text.indexOf(` ${q}`) > 0) return 2;
  return text.indexOf(q) >= 0 ? 3 : 4;
}

const wordsMatch = (text: string, query: string): boolean => {
  const hay = fold(text);
  return fold(query).split(/\s+/).filter(Boolean).every((word) => hay.indexOf(word) >= 0);
};

/** A label cut in the parts that match the query and the parts that do not, for drawing the match (the screen reader reads the label whole). A query that folds to a
 *  different length than its text (accents, Arabic vowel signs) is located character by character, so the marked part is exactly what matched. */
export function highlightParts(label: string, query: string): Array<{ text: string; hit: boolean }> {
  const q = fold(query).trim();
  if (!q) return [{ text: label, hit: false }];
  const chars = Array.from(label);
  const sizes = chars.map((c) => fold(c).length);
  let folded = '';
  chars.forEach((c) => { folded += fold(c); });
  const at = folded.indexOf(q);
  if (at < 0) return [{ text: label, hit: false }];
  let from = -1, to = -1, run = 0;
  chars.forEach((_, i) => {
    if (from < 0 && run + sizes[i] > at) from = i;
    if (to < 0 && run >= at + q.length) to = i;
    run += sizes[i];
  });
  if (from < 0) return [{ text: label, hit: false }];
  if (to < 0) to = chars.length;
  const parts = [chars.slice(0, from).join(''), chars.slice(from, to).join(''), chars.slice(to).join('')];
  return [{ text: parts[0], hit: false }, { text: parts[1], hit: true }, { text: parts[2], hit: false }].filter((p) => p.text);
}

/** Where a key moves the highlighted option among `count`: Down and Up wrap, Home and End go to the ends; null for any other key. */
export function moveOption(count: number, active: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown': return active < 0 ? 0 : (active + 1) % count;
    case 'ArrowUp': return active < 0 ? count - 1 : (active - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

export function paletteView(input: PaletteInput): PaletteView {
  const q = input.query.replace(/\s+/g, ' ').trim();
  const groups: PaletteView['groups'] = [];
  let n = 0;
  const add = (name: PaletteGroupName, list: Array<Omit<PaletteOption, 'id' | 'group'>>, note?: string) => {
    if (list.length === 0 && !note) return;
    groups.push({ name, note, options: list.map((o) => ({ ...o, id: `po-${n++}`, group: name })) });
  };
  const queue = (list: readonly PendingHit[]) => list.map<Omit<PaletteOption, 'id' | 'group'>>((p) => ({ label: p.title, sub: p.sub, icon: 'queue', href: p.href }));
  const ackOption = (): Array<Omit<PaletteOption, 'id' | 'group'>> => (input.acknowledgements > 0
    ? [{ label: `To acknowledge: ${input.acknowledgements.toLocaleString('en-US')}`, sub: 'Review all', icon: 'inbox', href: '/needs-my-action?section=ack' }] : []);
  const action = (a: ActionDef): Omit<PaletteOption, 'id' | 'group'> => ({ label: a.label, sub: a.sub, icon: a.icon, action: a.id });

  const notices: PaletteNotice[] = [];
  let searching = false;
  (['documents', 'committees', 'meetings'] as const).forEach((name) => {
    const source = input.records[name];
    if (!q) return;
    if (source.status === 'loading') searching = true;
    if (source.status === 'failed') notices.push({ source: name, text: `${SOURCE_TEXT[name]} could not be searched.` });
  });

  if (!q) {
    add('Needs my action', queue(input.pending.slice(0, LIMITS.pending)).concat(ackOption()));
    add('Pinned', input.pins.slice(0, LIMITS.pins).map((s) => ({ label: s.label, sub: s.sub ?? 'Pinned', icon: 'pin' as const, href: s.href })));
    add('Recent', input.recent.slice(0, LIMITS.recent).map((s) => ({ label: s.label, sub: s.sub, icon: 'clock' as const, href: s.href })));
    add('Actions', input.actions.filter((a) => a.id !== 'ask').slice(0, LIMITS.emptyActions).map(action));
    return { groups, options: groups.flatMap((g) => g.options), notices, searching: false, documentsTotal: 0 };
  }

  add('Needs my action', queue(input.pending.filter((p) => wordsMatch(p.title, q)).slice(0, LIMITS.queuePending)));

  const pages = input.pages.slice(0, LIMITS.pages).map<Omit<PaletteOption, 'id' | 'group'>>((p) => ({ label: p.label, sub: p.sub, icon: 'page', href: p.path }));
  const iconOf = { document: 'file', committee: 'users', meeting: 'calendar' } as const;
  const found = (['documents', 'committees', 'meetings'] as const).flatMap((name) => input.records[name].hits.slice(0, name === 'documents' ? 3 : 2));
  const records = found
    .map((r, i) => ({ r, i, tier: matchTier(r.label, q) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .slice(0, LIMITS.records)
    .map<Omit<PaletteOption, 'id' | 'group'>>(({ r }) => ({ label: r.label, sub: r.sub, icon: iconOf[r.kind], href: r.href }));
  const bestPage = Math.min(4, ...input.pages.slice(0, LIMITS.pages).map((p) => matchTier(p.label, q)));
  const bestRecord = Math.min(5, ...found.map((r) => matchTier(r.label, q)));
  const documentsTotal = input.records.documents.status === 'ready' ? (input.records.documents.total ?? input.records.documents.hits.length) : 0;
  const recordsNote = searching && records.length === 0 ? 'Searching…' : undefined;
  if (bestRecord < bestPage) { add('Records', records, recordsNote); add('Pages', pages); } else { add('Pages', pages); add('Records', records, recordsNote); }

  const rest = input.actions.filter((a) => a.id === 'ask' || wordsMatch(`${a.label} ${a.sub}`, q));
  const asks = rest.filter((a) => a.id === 'ask').map((a) => ({ ...action(a), label: `${a.label}: “${q}”` }));
  add('Actions', rest.filter((a) => a.id !== 'ask').slice(0, LIMITS.actions).map(action).concat(asks));

  return { groups, options: groups.flatMap((g) => g.options), notices, searching, documentsTotal };
}
