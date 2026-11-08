// What the three monitoring registers (KRIs, incidents, mitigation actions) have in common, apart from React so `node --test` pins it (registerModel.test.ts): the page's state
// in its address, the facets with live counts, the quick chips with theirs, the sort and the page. WHAT the facets, chips, columns and board are is each register's own
// definition (RegisterDef); the engine is components/records/facetEngine.ts, the same one the Documents library uses.
import { integer, listOf, oneOf, sortOf, text, type ParamSpec, type Schema } from '../../../../lib/addressState.ts';
import { countMatching, evaluate, indexRows, type Chosen, type Evaluated, type FacetIndex, type FacetSpec } from '../../../../components/records/facetEngine.ts';
import type { BoardColumnDef } from '../../../../components/records/explorerModel.ts';

export interface FacetDef<R> {
  /** names the facet in the address (?status=red,amber) and in the counts; not one of q, quick, view, sort, page, id */
  key: string;
  label: string;
  values: (row: R) => string[];
  /** the options to offer, in the order to draw them (every value a record can have, so a filter can always reach it) */
  options: (rows: readonly R[]) => Array<{ value: string; label: string }>;
  searchable?: boolean;
  limit?: number;
  defaultOpen?: boolean;
}

export interface QuickDef<R> {
  key: string;
  label: string;
  /** what the chip keeps; `now` is the same instant for every row */
  test: (row: R, now: Date) => boolean;
  /** a tooltip that says what the chip counts */
  title?: string;
}

export interface SortDef<R> {
  key: string;
  label: string;
  value: (row: R) => string | number | null;
  /** the direction a first press gives */
  firstDir: 'asc' | 'desc';
}

export interface RegisterDef<R> {
  key: string;
  noun: { one: string; other: string };
  idOf: (row: R) => number;
  /** the words a search looks in */
  text: (row: R) => string;
  facets: FacetDef<R>[];
  quick: QuickDef<R>[];
  sorts: SortDef<R>[];
  defaultSort: { key: string; dir: 'asc' | 'desc' };
  board?: { label: string; columns: BoardColumnDef<R>[] };
  pageSize?: number;
}

export const RESERVED = ['q', 'quick', 'view', 'sort', 'page', 'id'] as const;
export const VIEWS = ['list', 'board'] as const;
export type RegisterView = (typeof VIEWS)[number];
export const PAGE_SIZES = [25, 50, 100] as const;

export interface RegisterState {
  q: string;
  quick: string;
  view: RegisterView;
  sort: { key: string; dir: 'asc' | 'desc' };
  page: number;
  id: number;
  chosen: Record<string, string[]>;
}

/** The address schema of a register. Built once per register, outside any component (the hook reads the address again for a new schema). */
export function buildSchema<R>(def: RegisterDef<R>): Schema {
  def.facets.forEach((f) => { if ((RESERVED as readonly string[]).includes(f.key)) throw new Error(`${def.key}: the facet "${f.key}" is a name the address already uses`); });
  const schema: Record<string, ParamSpec<any>> = {
    q: text(),
    quick: oneOf(['all'].concat(def.quick.map((c) => c.key)), 'all'),
    view: oneOf(VIEWS, 'list'),
    sort: sortOf(def.sorts.map((s) => s.key), def.defaultSort),
    page: integer(1, { min: 1 }),
    id: integer(0, { min: 1 }),
  };
  def.facets.forEach((f) => { schema[f.key] = listOf(); });
  return schema;
}

/** The state an address stands for. */
export function stateOf<R>(def: RegisterDef<R>, address: Record<string, any>): RegisterState {
  const chosen: Record<string, string[]> = {};
  def.facets.forEach((f) => { chosen[f.key] = (address[f.key] as string[]) ?? []; });
  return {
    q: address.q as string, quick: address.quick as string, view: address.view as RegisterView, sort: address.sort as RegisterState['sort'],
    page: address.page as number, id: address.id as number, chosen,
  };
}

/** The address patch for a change of state (every facet that changed). */
export const patchOf = (patch: Partial<Omit<RegisterState, 'chosen'>> & { chosen?: Record<string, string[]> }): Record<string, unknown> => {
  const { chosen, ...rest } = patch;
  return { ...rest, ...(chosen ?? {}) };
};

const fold = (s: string): string => s.toLowerCase();
export const termsOf = (q: string): string[] => fold(q).split(/\s+/).filter(Boolean);

export function indexRegister<R>(def: RegisterDef<R>, rows: readonly R[]): FacetIndex<R> {
  const specs: FacetSpec<R>[] = def.facets.map((f) => ({ key: f.key, values: f.values }));
  return indexRows(rows, specs, (r) => fold(def.text(r)));
}

export interface Evaluation<R> {
  result: Evaluated<R>;
  /** the number each quick chip would show with the other filters as they are */
  quickCounts: Record<string, number>;
}

export function evaluateRegister<R>(def: RegisterDef<R>, index: FacetIndex<R>, state: RegisterState, now: Date): Evaluation<R> {
  const terms = termsOf(state.q);
  const quick = def.quick.find((c) => c.key === state.quick);
  const result = evaluate(index, state.chosen as Chosen, { terms, extra: quick ? (row) => quick.test(row, now) : undefined });
  const quickCounts: Record<string, number> = { all: countMatching(index, state.chosen as Chosen, { terms }) };
  def.quick.forEach((c) => { quickCounts[c.key] = countMatching(index, state.chosen as Chosen, { terms, extra: (row) => c.test(row, now) }); });
  return { result, quickCounts };
}

/** How many filters are on: facet values chosen, plus a quick chip, plus a search. */
export function filterCount<R>(state: RegisterState): number {
  return Object.values(state.chosen).reduce((n, v) => n + v.length, 0) + (state.quick !== 'all' ? 1 : 0) + (state.q.trim() ? 1 : 0);
}

export const isFiltering = <R>(state: RegisterState): boolean => filterCount<R>(state) > 0;

// ── sort ──
const compare = (a: string | number | null, b: string | number | null, dir: 'asc' | 'desc'): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;                                                       // a record with no value is last either way
  if (b === null) return -1;
  const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? c : -c;
};

/** The rows in the order asked for; ties by id so the order never moves. */
export function sortRows<R>(def: RegisterDef<R>, rows: readonly R[], sort: { key: string; dir: 'asc' | 'desc' }): R[] {
  const by = def.sorts.find((s) => s.key === sort.key) ?? def.sorts.find((s) => s.key === def.defaultSort.key);
  if (!by) return rows.slice();
  return rows.slice().sort((x, y) => compare(by.value(x), by.value(y), sort.dir) || def.idOf(x) - def.idOf(y));
}

/** A header was pressed: the same key flips its direction, another key starts in its first direction. */
export function nextSort<R>(def: RegisterDef<R>, current: { key: string; dir: 'asc' | 'desc' }, key: string): { key: string; dir: 'asc' | 'desc' } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: def.sorts.find((s) => s.key === key)?.firstDir ?? 'asc' };
}

// ── page ──
export const pageCount = (total: number, size: number): number => Math.max(1, Math.ceil(total / size));
export const clampPage = (page: number, total: number, size: number): number => Math.min(Math.max(1, page), pageCount(total, size));
export const pageSlice = <T>(rows: readonly T[], page: number, size: number): T[] => rows.slice((page - 1) * size, page * size);

/** The state that goes with one set of matches: a new search, filter or order starts again on page 1 and drops the ticks. */
export const matchKey = (ids: readonly number[], sort: { key: string; dir: string }): string => `${ids.length}:${ids.reduce((h, id) => (h * 31 + id) >>> 0, 7)}|${sort.key}:${sort.dir}`;

/** The chips of the filters that are on, for "AppliedFilters": one for each chosen value, the quick chip and the search. */
export function appliedChips<R>(def: RegisterDef<R>, state: RegisterState, optionsOf: (facet: string) => Array<{ value: string; label: string }>): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  if (state.quick !== 'all') out.push({ key: 'quick', label: def.quick.find((c) => c.key === state.quick)?.label ?? state.quick });
  def.facets.forEach((f) => {
    const options = optionsOf(f.key);
    (state.chosen[f.key] ?? []).forEach((v) => out.push({ key: `${f.key}:${v}`, label: `${f.label}: ${options.find((o) => o.value === v)?.label ?? v}` }));
  });
  if (state.q.trim()) out.push({ key: 'q', label: `Search: ${state.q.trim()}` });
  return out;
}

/** The state after one applied chip is taken off (the inverse of appliedChips). */
export function withoutChip(state: RegisterState, key: string): Partial<RegisterState> {
  if (key === 'quick') return { quick: 'all' };
  if (key === 'q') return { q: '' };
  const [facet, ...rest] = key.split(':');
  const value = rest.join(':');
  return { chosen: { ...state.chosen, [facet]: (state.chosen[facet] ?? []).filter((v) => v !== value) } };
}
