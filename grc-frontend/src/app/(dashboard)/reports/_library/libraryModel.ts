// The Reports library's configuration of the facet explorer (components/records): what a saved report is as a row, which facets it has, the quick views, the options of the rail, the chips,
// the search and the order. Pure (no React, no requests) so `node --test` holds it (libraryModel.test.ts). The page owns the data and the actions; this owns what a filter MEANS.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../components/records/facetEngine.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import type { SyncState } from './syncModel.ts';

/** What the library needs of a saved report (a ReportSpec has more). */
export interface SavedItem {
  id: string;
  name: string;
  description?: string;
  dataset: string;
  shared?: boolean;
  mine?: boolean;
  updatedAt?: string | null;
  measures?: readonly unknown[];
}

/** What the page knows about the module a report reads. */
export interface DatasetFacts { label: string; module: string; openable: boolean }
/** A report whose module no longer exists in the platform: said in words, never as a key. */
export const GONE: DatasetFacts = { label: 'A module that is no longer available', module: 'Not available', openable: false };

export type Visibility = 'private' | 'shared' | 'shared_with_me';

export interface LibraryRow {
  /** the explorer's number for the row: its place in the loaded list */
  id: number;
  slug: string;
  name: string;
  description: string;
  datasetKey: string;
  dataset: string;
  module: string;
  mine: boolean;
  visibility: Visibility;
  updatedAt: string | null;
  sync: SyncState;
  /** the person may open the module the report reads */
  openable: boolean;
  /** a report with a summary (measures): a file of the rows is not what it shows */
  summary: boolean;
}

export function toRows(items: readonly SavedItem[], factsOf: (datasetKey: string) => DatasetFacts | undefined, stateOf: (slug: string) => SyncState): LibraryRow[] {
  return items.map((s, i) => {
    const facts = factsOf(s.dataset) ?? GONE;
    const mine = s.mine !== false;
    return {
      id: i + 1,
      slug: s.id,
      name: (s.name || '').trim() || 'Untitled report',
      description: (s.description || '').trim(),
      datasetKey: s.dataset,
      dataset: facts.label,
      module: facts.module,
      mine,
      visibility: !mine ? 'shared_with_me' : s.shared ? 'shared' : 'private',
      updatedAt: s.updatedAt ?? null,
      sync: stateOf(s.id),
      openable: facts.openable,
      summary: (s.measures?.length ?? 0) > 0,
    };
  });
}

// ── facets ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type FacetKey = 'module' | 'owner' | 'sharing' | 'updated';
export const RAIL_ORDER: readonly FacetKey[] = ['module', 'owner', 'sharing', 'updated'];
export const FACET_TITLE: Record<FacetKey, string> = { module: 'Module', owner: 'Owner', sharing: 'Sharing', updated: 'Updated' };
export const OPEN_AT_FIRST: readonly FacetKey[] = ['module', 'owner'];
export const SEARCHABLE: readonly FacetKey[] = ['module'];

export type Band = 'today' | 'week' | 'month' | 'older';
export const BANDS: readonly Band[] = ['today', 'week', 'month', 'older'];
export const BAND_LABEL: Record<Band, string> = { today: 'Last 24 hours', week: 'Last 7 days', month: 'Last 30 days', older: 'Older' };
const DAY = 86_400_000;

/** How long ago a report was last saved. No date is the oldest. */
export function updatedBand(iso: string | null | undefined, now: Date): Band {
  const at = parseUtc(iso);
  if (!at) return 'older';
  const age = now.getTime() - at.getTime();
  return age < DAY ? 'today' : age < 7 * DAY ? 'week' : age < 30 * DAY ? 'month' : 'older';
}

export const QUICK_IDS = ['all', 'mine', 'shared', 'attention'] as const;
export type QuickId = (typeof QUICK_IDS)[number];
export const QUICK_LABEL: Record<QuickId, string> = { all: 'All', mine: 'Mine', shared: 'Shared with me', attention: 'Not saved yet' };

export interface Filters {
  search: string;
  module: string[];
  owner: string[];
  sharing: string[];
  updated: string[];
  quick: QuickId | null;
}
export const NO_FILTERS: Filters = { search: '', module: [], owner: [], sharing: [], updated: [], quick: null };

export function filterCount(f: Filters): number {
  return RAIL_ORDER.reduce((n, k) => n + f[k].length, 0) + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0);
}

export function inQuick(id: QuickId, r: LibraryRow): boolean {
  switch (id) {
    case 'mine': return r.mine;
    case 'shared': return !r.mine;
    case 'attention': return r.sync !== 'synced';
    default: return true;
  }
}

export function librarySpecs(now: Date): FacetSpec<LibraryRow>[] {
  const owned: Record<FacetKey, FacetSpec<LibraryRow>> = {
    module: { key: 'module', values: (r) => [r.module] },
    owner: { key: 'owner', values: (r) => [r.mine ? 'mine' : 'others'] },
    sharing: { key: 'sharing', values: (r) => [r.visibility === 'private' ? 'private' : 'shared'] },
    updated: { key: 'updated', values: (r) => [updatedBand(r.updatedAt, now)] },
  };
  return RAIL_ORDER.map((k) => owned[k]);
}

const fold = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
export const searchTerms = (q: string): string[] => fold(q).split(/\s+/).filter(Boolean);
export const haystack = (r: LibraryRow): string => fold([r.name, r.description, r.dataset, r.module].join(' \n '));

export const indexLibrary = (rows: readonly LibraryRow[], now: Date): FacetIndex<LibraryRow> => indexRows(rows, librarySpecs(now), haystack);
export const chosenOf = (f: Filters): Chosen => ({ module: f.module, owner: f.owner, sharing: f.sharing, updated: f.updated });

export function ruleOf(f: Filters): Rule<LibraryRow> {
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  return { terms: searchTerms(f.search), extra: quick ? (r) => inQuick(quick, r) : undefined };
}

// ── the rail's options, the chips ────────────────────────────────────────────────────────────────────────────────────────

export interface Option { value: string; label: string }

export function railOptions(rows: readonly LibraryRow[]): Record<FacetKey, Option[]> {
  const modules = Array.from(new Set(rows.map((r) => r.module))).sort((a, b) => a.localeCompare(b)).map((m) => ({ value: m, label: m }));
  return {
    module: modules,
    owner: [{ value: 'mine', label: 'Mine' }, { value: 'others', label: 'Shared with me' }],
    sharing: [{ value: 'private', label: 'Only you' }, { value: 'shared', label: 'Shared' }],
    updated: BANDS.map((b) => ({ value: b, label: BAND_LABEL[b] })),
  };
}

/** Options the rail draws: the ones with reports, and any that is chosen (dimmed, count 0). With none to show, all of them. */
export function orderedOptions(options: readonly Option[], chosen: readonly string[], count: (value: string) => number): Option[] {
  const have = options.filter((o) => count(o.value) > 0 || chosen.includes(o.value));
  return have.length ? have : options.slice();
}

export interface Chip { key: string; label: string; group: FacetKey | 'search' | 'quick'; value?: string }

export function filterChips(f: Filters, options: Record<FacetKey, Option[]>): Chip[] {
  const chips: Chip[] = [];
  if (f.search.trim()) chips.push({ key: 'search', group: 'search', label: `Search: ${f.search.trim()}` });
  if (f.quick && f.quick !== 'all') chips.push({ key: 'quick', group: 'quick', label: QUICK_LABEL[f.quick] });
  RAIL_ORDER.forEach((g) => f[g].forEach((v) => {
    chips.push({ key: `${g}:${v}`, group: g, value: v, label: `${FACET_TITLE[g]}: ${options[g].find((x) => x.value === v)?.label ?? v}` });
  }));
  return chips;
}

export function removeChip(f: Filters, chip: Chip): Filters {
  if (chip.group === 'search') return { ...f, search: '' };
  if (chip.group === 'quick') return { ...f, quick: null };
  return { ...f, [chip.group]: f[chip.group].filter((v) => v !== chip.value) } as Filters;
}

// ── the order ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SORT_KEYS = ['updated', 'name', 'module'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'updated', dir: 'desc' };
export const SORT_LABEL: Record<SortKey, string> = { updated: 'Last saved', name: 'Name', module: 'Module' };
const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = { updated: 'desc', name: 'asc', module: 'asc' };

export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/** Sorted copy. A report never saved with a date goes last whichever way the dates run; ties keep the name's order. */
export function sortRows(rows: readonly LibraryRow[], sort: Sort): LibraryRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const byName = (a: LibraryRow, b: LibraryRow) => a.name.localeCompare(b.name) || a.id - b.id;
  const by = (a: LibraryRow, b: LibraryRow): number => {
    if (sort.key === 'name') return sign * a.name.localeCompare(b.name);
    if (sort.key === 'module') return sign * (a.module.localeCompare(b.module) || a.dataset.localeCompare(b.dataset));
    const x = parseUtc(a.updatedAt)?.getTime();
    const y = parseUtc(b.updatedAt)?.getTime();
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
    return sign * (x - y);
  };
  return rows.slice().sort((a, b) => by(a, b) || byName(a, b));
}
