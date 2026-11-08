// The Statements register's state in its address, on the kit's useAddressState:
//   /compliance/statements?status=non_compliant&priority=critical,high&category=security&doc=12&assignee=7&quick=mine&q=password&sort=code:asc&open=420
// The page had no address state before (its filters were React state), so there is no older link to keep; a value the page cannot be in is the default. Pure (no React).
import { integer, listOf, sortOf, text, type ParamSpec } from '../../../../../lib/addressState.ts';
import { DEFAULT_SORT, QUICK_IDS, SORT_KEYS, type QuickId, type Sort } from './statementModel.ts';
import { NO_FILTERS, type Filters } from './statementFacets.ts';

const quick = (): ParamSpec<QuickId | null> => ({
  default: null,
  read: ([first]) => ((QUICK_IDS as readonly string[]).includes((first ?? '').trim()) ? ((first ?? '').trim() as QuickId) : undefined),
  write: (value) => (value && value !== 'all' ? [value] : []),
});

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const STATEMENTS_SCHEMA = {
  q: text(),
  status: listOf(),
  priority: listOf(),
  category: listOf(),
  doc: listOf(),
  assignee: listOf(),
  quick: quick(),
  sort: sortOf(SORT_KEYS, DEFAULT_SORT),
  open: integer(0, { min: 1 }),
};

export interface StatementsAddress {
  q: string; status: string[]; priority: string[]; category: string[]; doc: string[]; assignee: string[]; quick: QuickId | null; sort: Sort | null; open: number;
}
export interface StatementsPage { filters: Filters; sort: Sort; openId: number | null }

export function pageOf(a: StatementsAddress): StatementsPage {
  const filters: Filters = { ...NO_FILTERS, search: a.q, status: a.status, priority: a.priority, category: a.category, document: a.doc, assignee: a.assignee, quick: a.quick };
  return { filters, sort: a.sort ?? DEFAULT_SORT, openId: a.open || null };
}

/** The names a change of filters is about (a patch, so two changes in one event compose). */
export const filtersPatch = (f: Filters): Partial<StatementsAddress> => ({
  q: f.search, status: f.status, priority: f.priority, category: f.category, doc: f.document, assignee: f.assignee, quick: f.quick,
});
export const openPatch = (id: number | null): Partial<StatementsAddress> => ({ open: id ?? 0 });
