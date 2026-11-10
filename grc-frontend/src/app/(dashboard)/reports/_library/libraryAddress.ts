// The library's state in its address, on the kit's useAddressState: /reports?q=risk&mod=Risk%20Management&owner=mine&share=shared&upd=week&quick=attention&sort=name:asc. A link opens the same view.
// Also the links the library makes to the builder and the forward of the old addresses (/reports?edit=ID, ?mode=new, a dashboard's drill-through). Pure (no React).
import { listOf, oneOf, text, type ParamSpec } from '../../../../lib/addressState.ts';
import { DEFAULT_SORT, NO_FILTERS, QUICK_IDS, SORT_KEYS, type Filters, type QuickId, type Sort } from './libraryModel.ts';

const sort = (): ParamSpec<Sort> => ({
  default: DEFAULT_SORT,
  read: ([first]) => {
    const [key, dir, ...rest] = (first ?? '').trim().split(':');
    return rest.length === 0 && (SORT_KEYS as readonly string[]).includes(key) && (dir === 'asc' || dir === 'desc') ? { key: key as Sort['key'], dir } : undefined;
  },
  write: (value) => (value.key === DEFAULT_SORT.key && value.dir === DEFAULT_SORT.dir ? [] : [`${value.key}:${value.dir}`]),
});

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const LIBRARY_SCHEMA = {
  q: text(),
  mod: listOf(),
  owner: listOf(['mine', 'others']),
  share: listOf(['private', 'shared']),
  upd: listOf(['today', 'week', 'month', 'older']),
  quick: oneOf(['', ...QUICK_IDS] as const, ''),
  sort: sort(),
};

export interface LibraryAddress { q: string; mod: string[]; owner: string[]; share: string[]; upd: string[]; quick: '' | QuickId; sort: Sort }

export function filtersOf(a: LibraryAddress): Filters {
  return { ...NO_FILTERS, search: a.q, module: a.mod, owner: a.owner, sharing: a.share, updated: a.upd, quick: a.quick && a.quick !== 'all' ? a.quick : null };
}

/** The names a change of filters is about (a patch, so two changes in one event compose). */
export const filtersPatch = (f: Filters): Partial<LibraryAddress> => ({ q: f.search, mod: f.module, owner: f.owner, share: f.sharing, upd: f.updated, quick: f.quick ?? '' });

// ── links to the builder ─────────────────────────────────────────────────────────────────────────────────────────────────

export const BUILDER = '/reports/builder';
/** A saved report in the builder: it has an address of its own. */
export const builderHref = (slug: string): string => `${BUILDER}?id=${encodeURIComponent(slug)}`;
/** A new report on one module. */
export const newReportHref = (datasetKey: string): string => `${BUILDER}?dataset=${encodeURIComponent(datasetKey)}`;
/** A saved report narrowed to one category (a dashboard chart's click). */
export function drillHref(slug: string, narrow?: { col: string; value: string }): string {
  const q = new URLSearchParams({ id: slug });
  if (narrow) { q.set('drillCol', narrow.col); q.set('drillValue', narrow.value); }
  return `${BUILDER}?${q.toString()}`;
}

/** Where an old address of the library page (the page used to host the builder) goes: ?edit=ID (+ the drill) to the saved report, ?mode=new|build to the builder; null for an address that is the library. */
export function legacyTarget(search: string): string | null {
  const p = new URLSearchParams(search);
  const edit = p.get('edit');
  if (edit) {
    const q = new URLSearchParams({ id: edit });
    const col = p.get('drillCol');
    const value = p.get('drillValue');
    if (col && value !== null) { q.set('drillCol', col); q.set('drillValue', value); }
    return `${BUILDER}?${q.toString()}`;
  }
  const mode = p.get('mode');
  return mode === 'new' || mode === 'build' ? `${BUILDER}?mode=new` : null;
}
