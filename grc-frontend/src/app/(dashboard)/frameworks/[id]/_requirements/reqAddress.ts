// The Requirements tab's state in its address, on the kit's useAddressState:
//   /frameworks/12?tab=controls&q=access&status=not_started,in_progress&evidence=none&section=0,2&owner=7,none&quick=mine&view=board&sort=status:asc
// `tab` (the open tab), `req` (the requirement open in the drawer) and `item` belong to the journey page and are left alone by this schema. The tab had no address state before except
// `?req=`, so there is no older link to keep; a value the page cannot be in is the default. Pure (no React).
import { listOf, oneOf, sortOf, text, type ParamSpec } from '../../../../../lib/addressState.ts';
import { DEFAULT_SORT, QUICK_IDS, SORT_KEYS, type QuickId, type Sort } from './reqModel.ts';
import { NO_FILTERS, type Filters } from './reqFacets.ts';

const quick = (): ParamSpec<QuickId | null> => ({
  default: null,
  read: ([first]) => ((QUICK_IDS as readonly string[]).includes((first ?? '').trim()) ? ((first ?? '').trim() as QuickId) : undefined),
  write: (value) => (value && value !== 'all' ? [value] : []),
});

export const VIEWS = ['list', 'board'] as const;
export type ViewKey = (typeof VIEWS)[number];

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const REQ_SCHEMA = {
  q: text(),
  status: listOf(),
  evidence: listOf(),
  section: listOf(),
  owner: listOf(),
  priority: listOf(),
  critical: listOf(),
  category: listOf(),
  scope: listOf(),
  quick: quick(),
  view: oneOf<ViewKey>(VIEWS, 'list'),
  sort: sortOf(SORT_KEYS, DEFAULT_SORT),
};

export interface ReqAddress {
  q: string; status: string[]; evidence: string[]; section: string[]; owner: string[]; priority: string[]; critical: string[]; category: string[]; scope: string[];
  quick: QuickId | null; view: ViewKey; sort: Sort | null;
}
export interface ReqPage { filters: Filters; view: ViewKey; sort: Sort }

export function pageOf(a: ReqAddress): ReqPage {
  const filters: Filters = {
    ...NO_FILTERS, search: a.q, status: a.status, evidence: a.evidence, section: a.section, owner: a.owner, priority: a.priority, critical: a.critical, category: a.category, scope: a.scope, quick: a.quick,
  };
  return { filters, view: a.view, sort: a.sort ?? DEFAULT_SORT };
}

/** The names a change of filters is about (a patch, so two changes in one event compose). */
export const filtersPatch = (f: Filters): Partial<ReqAddress> => ({
  q: f.search, status: f.status, evidence: f.evidence, section: f.section, owner: f.owner, priority: f.priority, critical: f.critical, category: f.category, scope: f.scope, quick: f.quick,
});
