/**
 * The Change log's filters, split and grouping (documents/[id]/_ChainTab.tsx). Who, when, where a change came from, what kind of
 * entry and a search narrow the log; it shows Changes (versions and what each changed), Activity (reviews, approvals, statements,
 * other steps) or Everything, newest first and grouped by day; the filters are kept in the URL and handed to "Export filtered".
 * The backend applies the same rules to the export (governance/change_chain.py `filter_chain`). Pure, so it is tested with
 * node --test (changeLog.test.ts).
 */
import type { ChainEvent, ChainItem, ChainSource, ChainVersion } from './documentChain';
import { parseUtc } from './serverTime.ts';
import { matches } from './studio/text.ts';

export type Split = 'changes' | 'activity' | 'all';
export type What = 'text' | 'review' | 'statement' | 'other';
export type When = 'any' | 'today' | '7d' | '30d' | '90d' | 'custom';
export type Layout = 'timeline' | 'table';

export interface LogFilters {
  split: Split;
  layout: Layout;
  /** person keys (`personIndex`): a user's id, or the name of someone known only by name */
  people: string[];
  when: When;
  /** the custom span's first and last day (YYYY-MM-DD, the viewer's days) */
  from: string;
  to: string;
  /** where the changes came from (SOURCES) */
  sources: string[];
  what: What[];
  q: string;
}

type Chain = { versions: ChainVersion[]; events: ChainEvent[] };

export const NO_FILTERS: LogFilters = { split: 'all', layout: 'timeline', people: [], when: 'any', from: '', to: '', sources: [], what: [], q: '' };

/** Where a change can come from, in the order the Source filter offers them (named by documentChain's ORIGIN_LABEL). */
export const SOURCES = ['ai', 'manual', 'statement', 'revert', 'restore', 'file', 'import', 'signoff', 'initial'];
export const WHAT_LABEL: Record<What, string> = { text: 'Changes to the text', review: 'Reviews & approvals', statement: 'Statements', other: 'Other activity' };
export const WHEN_LABEL: Record<When, string> = { any: 'Any time', today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', custom: 'Custom dates' };
export const WHATS = Object.keys(WHAT_LABEL) as What[];
export const WHENS = Object.keys(WHEN_LABEL) as When[];
const OTHER_EVENTS = new Set(['created', 'archived', 'restored', 'status_changed', 'version_rollback', 'owner_assigned']);

/** What an event is to the filters: a change to a statement; other activity (created, archived, restored from the archive, a status
 *  set by hand, an earlier version restored, a new owner); else a step of the review and approval trail (a status set to approved
 *  or published by hand is an approval). */
export function eventGroup(e: Pick<ChainEvent, 'kind' | 'to'>): What {
  if (e.kind.startsWith('statement')) return 'statement';
  if (OTHER_EVENTS.has(e.kind) && !(e.kind === 'status_changed' && (e.to === 'approved' || e.to === 'published'))) return 'other';
  return 'review';
}

/** How a version was made, as a source ("restore" for a restored one). */
export const versionSource = (v: Pick<ChainVersion, 'origin' | 'restored_from'>): string => (v.restored_from ? 'restore' : v.origin);

/** The filters as they apply to the split: no source for activity, no "what" for changes (they are all the text), the custom span
 *  only when chosen, the search trimmed. The log, its chips and the export read these. */
export function effective(f: LogFilters): LogFilters {
  return {
    ...f,
    sources: f.split === 'activity' ? [] : f.sources,
    what: f.split === 'changes' ? [] : f.split === 'activity' ? f.what.filter((w) => w !== 'text') : f.what,
    from: f.when === 'custom' ? f.from : '',
    to: f.when === 'custom' ? f.to : '',
    q: f.q.trim(),
  };
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayOf = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const SPAN_DAYS: Partial<Record<When, number>> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };

/** The time a date filter covers, in the viewer's days: from the start of its first day up to (not including) the start of the day
 *  after its last. "Last 7 days" is today and the six days before it. Nulls: no limit on that side. */
export function dateRange(f: Pick<LogFilters, 'when' | 'from' | 'to'>, now: Date): { start: Date | null; end: Date | null } {
  const days = SPAN_DAYS[f.when];
  if (days) return { start: addDays(startOfDay(now), 1 - days), end: null };
  if (f.when !== 'custom') return { start: null, end: null };
  let a = dayOf(f.from);
  let b = dayOf(f.to);
  if (a && b && a > b) [a, b] = [b, a];
  return { start: a, end: b ? addDays(b, 1) : null };
}

/** Whether a filter narrows the log (the split aside). */
export function filtersOn(f: LogFilters, now: Date): boolean {
  const e = effective(f);
  const span = dateRange(e, now);
  return !!(e.people.length || span.start || span.end || e.sources.length || e.what.length || e.q);
}

export interface Person { key: string; name: string; count: number }

/** The people in the log, each once: a person is their user id; someone known only by name (an older change) is the id that name
 *  has elsewhere in the log. `count`: the entries they are in (versions they made or changed, steps they took). */
export function personIndex(c: Chain): { keyOf: (name: string | null | undefined, id: number | null | undefined) => string; people: Person[] } {
  type Who = [string | null | undefined, number | null | undefined];
  const entries: Who[][] = [
    ...c.versions.map((v): Who[] => [[v.by, v.by_id], ...v.items.map((i): Who => [i.by, i.by_id])]),
    ...c.events.map((e): Who[] => [[e.actor, e.actor_id]]),
  ];
  const ids = new Map<string, number>();
  for (const entry of entries) for (const [name, id] of entry) if (name && id != null && !ids.has(name)) ids.set(name, id);
  const keyOf = (name: string | null | undefined, id: number | null | undefined) => (id != null ? String(id) : String(ids.get(name ?? '') ?? name ?? ''));
  const found = new Map<string, Person>();
  const list: Person[] = [];
  for (const entry of entries) {
    const counted: string[] = [];
    for (const [name, id] of entry) {
      const key = keyOf(name, id);
      if (!key || counted.includes(key)) continue;
      counted.push(key);
      let p = found.get(key);
      if (!p) {
        p = { key, name: '', count: 0 };
        found.set(key, p);
        list.push(p);
      }
      if (!p.name && name) p.name = name;
      p.count += 1;
    }
  }
  return { keyOf, people: list.filter((p) => p.name).sort((a, b) => a.name.localeCompare(b.name)) };
}

export interface VersionEntry {
  type: 'version';
  key: string;
  at: string | null;
  version: ChainVersion;
  /** the first version of the document (the original) */
  first: boolean;
  /** its changes that pass the filters (all of them when no filter applies to changes) */
  items: ChainItem[];
  /** how many of its changes the filters leave out */
  hidden: number;
}
export interface EventEntry { type: 'event'; key: string; at: string | null; event: ChainEvent; group: What }
export type LogEntry = VersionEntry | EventEntry;

const sourceWords = (s: ChainSource) => `${s.ref ?? ''} ${s.title ?? ''} ${s.locator ?? ''} ${s.quote ?? ''}`;
const newestFirst = (a: { at: string | null }, b: { at: string | null }) => ((a.at ?? '') < (b.at ?? '') ? 1 : (a.at ?? '') > (b.at ?? '') ? -1 : 0);

/** The log, newest first, with the filters applied, and how many entries the split holds without them. People, the source and the
 *  search narrow the changes of each version (a search that finds the version itself - its number, author, summary - keeps all its
 *  changes); a version stays when one of its changes is left or when it matches by itself. Activity has no source, so a source never
 *  removes an event. `label` names an event, for the search. */
export function buildLog(c: Chain, f: LogFilters, now: Date, label: (kind: string) => string = (k) => k.replace(/_/g, ' ')): { entries: LogEntry[]; total: number } {
  const e = effective(f);
  const { start, end } = dateRange(e, now);
  const { keyOf } = personIndex(c);
  const people = new Set(e.people);
  const sources = new Set(e.sources);
  const what = new Set(e.what);
  const inTime = (at: string | null) => {
    if (!start && !end) return true;
    const t = parseUtc(at);
    return !!t && (!start || t >= start) && (!end || t < end);
  };
  const who = (name: string | null | undefined, id: number | null | undefined) => !people.size || people.has(keyOf(name, id));
  const out: LogEntry[] = [];
  let total = 0;
  if (f.split !== 'activity') {
    total += c.versions.length;
    if (!what.size || what.has('text')) {
      for (const v of [...c.versions].reverse()) {                 // newest first: at the same time, a version comes before an event
        if (!inTime(v.at)) continue;
        const whole = matches(e.q, `v${v.number}`, v.by, v.summary, v.reason, v.file_name, v.origin_label, v.stage_label);
        const items = v.items.filter((it) => who(it.by, it.by_id) && (!sources.size || sources.has(it.origin))
          && (whole || matches(e.q, it.section, it.before_text, it.after_text, it.request, it.reason, it.by, ...(it.sources ?? []).map(sourceWords))));
        const itself = whole && who(v.by, v.by_id) && (!sources.size || sources.has(versionSource(v)));
        if (items.length || itself) {
          out.push({ type: 'version', key: `v${v.id}`, at: v.at, version: v, first: v.id === c.versions[0].id, items, hidden: v.items.length - items.length });
        }
      }
    }
  }
  if (f.split !== 'changes') {
    total += c.events.length;
    for (let i = c.events.length - 1; i >= 0; i -= 1) {
      const ev = c.events[i];
      const group = eventGroup(ev);
      if ((what.size && !what.has(group)) || !inTime(ev.at) || !who(ev.actor, ev.actor_id)) continue;
      if (!matches(e.q, label(ev.kind), ev.actor, ev.detail, ev.before, ev.after)) continue;
      out.push({ type: 'event', key: `e${i}`, at: ev.at, event: ev, group });
    }
  }
  return { entries: out.sort(newestFirst), total };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A day as the log names it: "19 Oct 2026"; a YYYY-MM-DD string is that day where the viewer is. */
export function dayName(d: Date | string): string {
  const day = typeof d === 'string' ? dayOf(d) : d;
  return day ? `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}` : '';
}

/** The viewer's day of a time: "Today", "Yesterday", else "19 Oct 2026". */
export function dayLabel(d: Date, now: Date): string {
  const k = dayKey(d);
  if (k === dayKey(now)) return 'Today';
  if (k === dayKey(addDays(startOfDay(now), -1))) return 'Yesterday';
  return dayName(d);
}

export interface DayGroup<T> { key: string; label: string; entries: T[] }

/** Entries grouped by the viewer's day, in the order they come (newest first from `buildLog`); those without a time under
 *  "Date not recorded". */
export function groupByDay<T extends { at: string | null }>(entries: T[], now: Date): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const byKey = new Map<string, DayGroup<T>>();
  for (const e of entries) {
    const d = parseUtc(e.at);
    const key = d ? dayKey(d) : 'none';
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: d ? dayLabel(d, now) : 'Date not recorded', entries: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.entries.push(e);
  }
  return groups;
}

/** How many changes (and versions with no change listed, such as the original) came from each source present, in the filter's order. */
export function sourceCounts(c: Chain): Array<{ key: string; changes: number; versions: number }> {
  const n = new Map<string, { key: string; changes: number; versions: number }>();
  const add = (key: string, change: boolean) => {
    const row = n.get(key) ?? { key, changes: 0, versions: 0 };
    if (change) row.changes += 1; else row.versions += 1;
    n.set(key, row);
  };
  for (const v of c.versions) {
    if (v.items.length) for (const it of v.items) add(it.origin, true);
    else add(versionSource(v), false);
  }
  return SOURCES.filter((s) => n.has(s)).map((s) => n.get(s) as { key: string; changes: number; versions: number });
}

/** How many entries of each kind the log holds. */
export function whatCounts(c: Chain): Record<What, number> {
  const out: Record<What, number> = { text: c.versions.length, review: 0, statement: 0, other: 0 };
  for (const e of c.events) out[eventGroup(e)] += 1;
  return out;
}

export type SortKey = 'when' | 'who' | 'what' | 'source' | 'version';
export interface TableRow {
  key: string;
  entry: LogEntry;
  /** a change of a version; null for a version shown by itself and for an event */
  item: ChainItem | null;
  at: string | null;
  who: string;
  what: string;
  source: string;
  version: string;
}

/** The version a document was at a moment: the newest one made at or before it. */
export function versionAt(versions: Array<Pick<ChainVersion, 'number' | 'at'>>, at: string | null): string {
  let n = '';
  for (const v of versions) if (at && v.at && v.at <= at) n = v.number;
  return n;
}

/** The log as table rows: one per change of each version (a version with none shown is a row of its own), one per event. `labels`
 *  name a change's kind, an event and a source, so the columns sort by what they show. */
export function tableRows(c: Chain, entries: LogEntry[], labels: { kind: (status: string) => string; event: (kind: string) => string; source: (key: string) => string }): TableRow[] {
  const rows: TableRow[] = [];
  for (const en of entries) {
    if (en.type === 'event') {
      const ev = en.event;
      rows.push({ key: en.key, entry: en, item: null, at: ev.at, who: ev.actor ?? '', what: labels.event(ev.kind), source: '', version: versionAt(c.versions, ev.at) });
      continue;
    }
    const v = en.version;
    if (!en.items.length) rows.push({ key: en.key, entry: en, item: null, at: v.at, who: v.by, what: 'Version', source: labels.source(versionSource(v)), version: v.number });
    for (const it of en.items) {
      rows.push({ key: `${en.key}.${it.n}`, entry: en, item: it, at: it.at || v.at, who: it.by || v.by, what: labels.kind(it.status), source: labels.source(it.origin), version: v.number });
    }
  }
  return rows;
}

const byVersion = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
};

/** The rows sorted by a column (versions as numbers: 1.10 after 1.9); ties newest first. */
export function sortRows(rows: TableRow[], by: SortKey, dir: 'asc' | 'desc'): TableRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const cmp = (a: TableRow, b: TableRow) => (by === 'when' ? -newestFirst(a, b) : by === 'version' ? byVersion(a.version, b.version) : a[by].localeCompare(b[by]));
  return [...rows].sort((a, b) => sign * cmp(a, b) || newestFirst(a, b));
}

// the URL's names for the filters: ?tab=versions&log=activity&who=3&when=30d&source=ai&what=review&q=…
const Q = { split: 'log', layout: 'as', people: 'who', when: 'when', from: 'from', to: 'to', sources: 'source', what: 'what', q: 'q' } as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filters a link carries; anything unknown is left out. */
export function readQuery(p: Pick<URLSearchParams, 'get' | 'getAll'>): LogFilters {
  const one = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
    const v = p.get(k) ?? '';
    return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  };
  const day = (k: string) => (DAY.test(p.get(k) ?? '') ? (p.get(k) as string) : '');
  return {
    split: one<Split>(Q.split, ['changes', 'activity', 'all'], 'all'),
    layout: one<Layout>(Q.layout, ['timeline', 'table'], 'timeline'),
    people: p.getAll(Q.people).filter(Boolean),
    when: one<When>(Q.when, WHENS, 'any'),
    from: day(Q.from),
    to: day(Q.to),
    sources: p.getAll(Q.sources).filter((s) => SOURCES.includes(s)),
    what: p.getAll(Q.what).filter((w): w is What => (WHATS as string[]).includes(w)),
    q: (p.get(Q.q) ?? '').slice(0, 200),
  };
}

/** `params` with the filters written in (defaults left out, so a plain link stays plain) and every other parameter kept. */
export function writeQuery(params: URLSearchParams, f: LogFilters): URLSearchParams {
  const out = new URLSearchParams(params);
  Object.values(Q).forEach((k) => out.delete(k));
  if (f.split !== 'all') out.set(Q.split, f.split);
  if (f.layout !== 'timeline') out.set(Q.layout, f.layout);
  f.people.forEach((x) => out.append(Q.people, x));
  if (f.when !== 'any') out.set(Q.when, f.when);
  if (f.when === 'custom' && f.from) out.set(Q.from, f.from);
  if (f.when === 'custom' && f.to) out.set(Q.to, f.to);
  f.sources.forEach((x) => out.append(Q.sources, x));
  f.what.forEach((x) => out.append(Q.what, x));
  if (f.q.trim()) out.set(Q.q, f.q.trim());
  return out;
}

const utc = (d: Date) => d.toISOString().slice(0, 19);

/** The filters as the export's query parameters ("Export filtered"): what the log shows, its span as UTC times. */
export function exportParams(f: LogFilters, now: Date): Array<[string, string]> {
  const e = effective(f);
  const { start, end } = dateRange(e, now);
  const kinds: What[] = f.split === 'changes' ? ['text'] : f.split === 'activity' ? (e.what.length ? e.what : ['review', 'statement', 'other']) : e.what;
  const out: Array<[string, string]> = e.people.map((p): [string, string] => ['people', p]);
  if (start) out.push(['date_from', utc(start)]);
  if (end) out.push(['date_to', utc(end)]);
  e.sources.forEach((s) => out.push(['sources', s]));
  kinds.forEach((k) => out.push(['kinds', k]));
  if (e.q) out.push(['search', e.q]);
  return out;
}
