// The rules the three Business Continuity registers (Plans, Drills, Findings) share, apart from React so `node --test` pins them (registerModel.test.ts): what a register IS (its facets,
// its quick views, its sorts, its board, its export), how a register's state lives in the address (?status=a,b&owner=7&quick=overdue&sort=scheduled:asc&view=board&open=12), how the
// filters become the explorer's choice and rule (components/records/facetEngine), the chips that say what is on, the order of the rows, the board and the CSV. A register is
// configuration (one RegisterDef each: plans.ts, drills.ts, findings.ts); the screen that draws any of them is BcmRegister.tsx.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../components/records/facetEngine.ts';
import { groupBoard, type BoardColumn, type BoardColumnDef } from '../../../../components/records/explorerModel.ts';
import { flag, integer, listOf, oneOf, sortOf, text, type ParamSpec, type Schema } from '../../../../lib/addressState.ts';
import { formatCount } from '../../../../lib/format.ts';

/** The value of a record that has none, in a facet that offers "none" (no owner, no unit). */
export const NONE = 'none';

export interface Option { value: string; label: string; title?: string }
/** What a facet or a quick view may need besides the row: who is looking and what time it is. */
export interface Ctx { me: number | null; now: number }
export interface Sort { key: string; dir: 'asc' | 'desc' }

export interface FacetDef<R> {
  /** names the facet in the address (?status=a,b) and in the counts: not q, quick, sort, view, open or new */
  key: string;
  title: string;
  /** the option values this row counts under ([] when it has none and the facet offers no "none") */
  values: (row: R, ctx: Ctx) => readonly string[];
  /** the options the rail lists, from the rows there are */
  options: (rows: readonly R[], ctx: Ctx) => Option[];
  searchable?: boolean;
  /** options shown before "Show N more" */
  limit?: number;
  /** open when the page opens; the others are one press away */
  open?: boolean;
}

export interface QuickDef<R> {
  id: string;
  label: string;
  test: (row: R, ctx: Ctx) => boolean;
  /** a word under the chip when the view cannot be exact for this person */
  note?: (ctx: Ctx) => string | undefined;
}

export interface SortDef<R> {
  key: string;
  label: string;
  /** the value the column sorts by; null goes last whichever way it runs */
  value: (row: R, ctx: Ctx) => string | number | null;
  /** the direction a new column starts in (default asc) */
  firstDir?: 'asc' | 'desc';
}

export interface RegisterDef<R extends { id: number }> {
  noun: { one: string; other: string };
  /** names the explorer region and the exported file: "plans" */
  slug: string;
  facets: readonly FacetDef<R>[];
  /** all of them, "All" first; `shown` are chips, the rest are in a "More views" menu */
  quick: readonly QuickDef<R>[];
  shown: readonly string[];
  haystack: (row: R) => string;
  sorts: readonly SortDef<R>[];
  defaultSort: Sort;
  /** rows that tie, and rows with no value, fall back to this */
  tiebreak: (a: R, b: R) => number;
  csvHead: readonly string[];
  csvRow: (row: R, ctx: Ctx) => ReadonlyArray<string | number>;
  /** a read-only board: columns by a rule; `note` says what is left off it */
  board?: { label: string; columns: readonly BoardColumnDef<R>[]; note?: (rows: readonly R[]) => string | undefined };
}

// ── the address ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const RESERVED = ['q', 'quick', 'sort', 'view', 'open', 'new'] as const;
export const VIEWS = ['list', 'board'] as const;
export type View = (typeof VIEWS)[number];

const quickParam = (ids: readonly string[]): ParamSpec<string | null> => ({
  default: null,
  read: ([first]) => { const wanted = (first ?? '').trim().toLowerCase(); return ids.includes(wanted) ? wanted : undefined; },
  write: (value) => (value && value !== 'all' ? [value] : []),
});

/** The schema of a register's address. Define it once outside the component (useAddressState reads the address again for a new schema). */
export function schemaFor<R extends { id: number }>(def: RegisterDef<R>, extra: Schema = {}): Schema {
  const taken = def.facets.map((f) => f.key).filter((k) => (RESERVED as readonly string[]).includes(k));
  if (taken.length) throw new Error(`a facet cannot be called ${taken.join(', ')}`);
  const schema: Schema = {
    q: text(),
    quick: quickParam(def.quick.map((q) => q.id)),
    sort: sortOf(def.sorts.map((s) => s.key), def.defaultSort),
    view: oneOf<View>(def.board ? VIEWS : ['list'], 'list'),
    open: integer(0, { min: 1 }),
    new: flag(),
  };
  def.facets.forEach((f) => { schema[f.key] = listOf(); });
  return { ...schema, ...extra };
}

export interface Filters { search: string; quick: string | null; chosen: Record<string, string[]> }
export const noFilters = <R extends { id: number }>(def: RegisterDef<R>): Filters => ({ search: '', quick: null, chosen: Object.fromEntries(def.facets.map((f) => [f.key, [] as string[]])) });

/** What the address says as filters. */
export function filtersOf<R extends { id: number }>(def: RegisterDef<R>, address: Record<string, unknown>): Filters {
  const chosen: Record<string, string[]> = {};
  def.facets.forEach((f) => { chosen[f.key] = Array.isArray(address[f.key]) ? (address[f.key] as string[]) : []; });
  return { search: String(address.q ?? ''), quick: (address.quick as string | null) ?? null, chosen };
}
/** The names a change of filters is about (a patch, so two changes in one event compose). */
export function patchOf<R extends { id: number }>(def: RegisterDef<R>, f: Filters): Record<string, unknown> {
  const patch: Record<string, unknown> = { q: f.search, quick: f.quick && f.quick !== 'all' ? f.quick : null };
  def.facets.forEach((facet) => { patch[facet.key] = f.chosen[facet.key] ?? []; });
  return patch;
}

/** How many filters are on (a search, a facet value, a quick view other than All). */
export function filterCount(f: Filters): number {
  return Object.values(f.chosen).reduce((n, list) => n + list.length, 0) + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0);
}
export const isFiltering = (f: Filters): boolean => filterCount(f) > 0;

// ── the facet engine over a register ────────────────────────────────────────────────────────────────────────────────────
export function specsOf<R extends { id: number }>(def: RegisterDef<R>, ctx: Ctx): FacetSpec<R>[] {
  return def.facets.map((f) => ({ key: f.key, values: (row: R) => f.values(row, ctx) }));
}
export const indexOf = <R extends { id: number }>(def: RegisterDef<R>, rows: readonly R[], ctx: Ctx): FacetIndex<R> => indexRows(rows, specsOf(def, ctx), def.haystack);

export const searchTerms = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);
export const chosenOf = (f: Filters): Chosen => f.chosen;
export function ruleOf<R extends { id: number }>(def: RegisterDef<R>, f: Filters, ctx: Ctx): Rule<R> {
  const quick = f.quick && f.quick !== 'all' ? def.quick.find((q) => q.id === f.quick) : undefined;
  return { terms: searchTerms(f.search), extra: quick ? (row: R) => quick.test(row, ctx) : undefined };
}

/** The rows that pass every filter, by the plain rule (the engine's answer is held to this in the tests). */
export function plainFilter<R extends { id: number }>(def: RegisterDef<R>, rows: readonly R[], f: Filters, ctx: Ctx): R[] {
  const terms = searchTerms(f.search);
  const quick = f.quick && f.quick !== 'all' ? def.quick.find((q) => q.id === f.quick) : undefined;
  return rows.filter((row) => {
    if (terms.some((t) => !def.haystack(row).includes(t))) return false;
    if (quick && !quick.test(row, ctx)) return false;
    return def.facets.every((facet) => {
      const picked = f.chosen[facet.key] ?? [];
      return picked.length === 0 || facet.values(row, ctx).some((v) => picked.includes(v));
    });
  });
}

/** The options of every facet. */
export function optionsOf<R extends { id: number }>(def: RegisterDef<R>, rows: readonly R[], ctx: Ctx): Record<string, Option[]> {
  return Object.fromEntries(def.facets.map((f) => [f.key, f.options(rows, ctx)]));
}
/** Options in the order the rail draws them: one nobody has is dropped unless it is chosen (then it stays, with a 0). If none has a record, all are kept. */
export function orderedOptions(options: readonly Option[], chosen: readonly string[], count: (value: string) => number): Option[] {
  const have = options.filter((o) => count(o.value) > 0 || chosen.includes(o.value));
  return have.length ? have : options.slice();
}

/** How many rows each quick view would show. */
export function quickCounts<R extends { id: number }>(def: RegisterDef<R>, rows: readonly R[], ctx: Ctx): Record<string, number> {
  const out: Record<string, number> = {};
  def.quick.forEach((q) => { out[q.id] = rows.reduce((n, r) => n + (q.test(r, ctx) ? 1 : 0), 0); });
  return out;
}

// ── chips ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Chip { key: string; label: string; group: string; value?: string }
export function chipsOf<R extends { id: number }>(def: RegisterDef<R>, f: Filters, options: Record<string, Option[]>): Chip[] {
  const chips: Chip[] = [];
  if (f.search.trim()) chips.push({ key: 'search', group: 'search', label: `Search: ${f.search.trim()}` });
  const quick = f.quick && f.quick !== 'all' ? def.quick.find((q) => q.id === f.quick) : undefined;
  if (quick) chips.push({ key: 'quick', group: 'quick', label: quick.label });
  def.facets.forEach((facet) => (f.chosen[facet.key] ?? []).forEach((v) => {
    const o = (options[facet.key] ?? []).find((x) => x.value === v);
    chips.push({ key: `${facet.key}:${v}`, group: facet.key, value: v, label: `${facet.title}: ${o?.label ?? v}` });
  }));
  return chips;
}
export function removeChip(f: Filters, chip: Chip): Filters {
  if (chip.group === 'search') return { ...f, search: '' };
  if (chip.group === 'quick') return { ...f, quick: null };
  return { ...f, chosen: { ...f.chosen, [chip.group]: (f.chosen[chip.group] ?? []).filter((v) => v !== chip.value) } };
}

// ── the order of the rows ───────────────────────────────────────────────────────────────────────────────────────────────
/** The next order when a header is pressed: a new column starts in its first direction, the same column turns round, and a second turn goes back to the default. */
export function nextSort<R extends { id: number }>(def: RegisterDef<R>, current: Sort, key: string): Sort {
  const first = def.sorts.find((s) => s.key === key)?.firstDir ?? 'asc';
  if (current.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
  return def.defaultSort;
}
/** The rows in the order asked for. A row without the value goes last whichever way the column runs; ties fall back to the register's own order. */
export function sortRows<R extends { id: number }>(def: RegisterDef<R>, rows: readonly R[], sort: Sort, ctx: Ctx): R[] {
  const by = def.sorts.find((s) => s.key === sort.key) ?? def.sorts.find((s) => s.key === def.defaultSort.key);
  if (!by) return rows.slice();
  const sign = sort.dir === 'asc' ? 1 : -1;
  const keyed = rows.map((row) => ({ row, value: by.value(row, ctx) }));
  keyed.sort((a, b) => {
    const x = a.value;
    const y = b.value;
    if (x === null && y === null) return def.tiebreak(a.row, b.row);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x === y) return def.tiebreak(a.row, b.row);
    return (x < y ? -1 : 1) * sign;
  });
  return keyed.map((k) => k.row);
}
/** The options of a facet over people: each person the rows name once, by name, then "Unassigned" when some row has nobody. */
export function peopleOptions<R>(rows: readonly R[], idOf: (row: R) => number | null | undefined, nameOf: (row: R) => string | null | undefined, noneLabel = 'Unassigned'): Option[] {
  const names = new Map<string, string>();
  let none = false;
  rows.forEach((row) => {
    const id = idOf(row);
    if (id == null) { none = true; return; }
    if (!names.has(String(id))) names.set(String(id), nameOf(row) || 'Someone no longer here');
  });
  const options = Array.from(names.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  return none ? options.concat([{ value: NONE, label: noneLabel }]) : options;
}
export const ownerValue = (id: number | null | undefined): string => (id == null ? NONE : String(id));

/** "ZZ" sorts after "aa" when compared as text: fold the case. */
export const textKey = (s: string | null | undefined): string | null => { const t = (s ?? '').trim().toLowerCase(); return t === '' ? null : t; };

// ── the board ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function boardOf<R extends { id: number }>(def: RegisterDef<R>, rows: readonly R[]): BoardColumn<R>[] {
  return def.board ? groupBoard(rows, def.board.columns) : [];
}

// ── the export ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One CSV cell: quoted when it needs it, and a leading = + - @ made harmless, as spreadsheets run those as formulas. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s) && typeof value !== 'number') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function csvOf<R extends { id: number }>(def: RegisterDef<R>, rows: readonly R[], ctx: Ctx): string {
  return [def.csvHead, ...rows.map((r) => def.csvRow(r, ctx))].map((line) => line.map(csvCell).join(',')).join('\r\n');
}
/** Today as the day a file name carries ("2026-11-08"). */
export const todayText = (): string => new Date().toISOString().slice(0, 10);
/** "bcm-plans-2026-11-08-42-plans.csv" */
export function exportName<R extends { id: number }>(def: RegisterDef<R>, day: string, count: number, selectionOnly: boolean): string {
  return `bcm-${def.slug}-${day}-${selectionOnly ? 'selected-' : ''}${count}-${count === 1 ? def.noun.one : def.noun.other}.csv`;
}

// ── the count line ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** "42 plans" / "42 plans (showing 5,000)": the server's true total, and how many were sent when it cut the list. */
export function countLine(noun: { one: string; other: string }, total: number | undefined, loaded: number, cut: boolean): string {
  const n = total ?? loaded;
  return `${formatCount(n)} ${n === 1 ? noun.one : noun.other}${cut ? ` (showing ${formatCount(loaded)})` : ''}`;
}
