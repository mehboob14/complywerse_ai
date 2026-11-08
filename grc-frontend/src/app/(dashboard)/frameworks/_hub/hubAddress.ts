// The Frameworks hub's state in its address, on the kit's useAddressState:
//   /frameworks?tab=library&state=ready,onboarding&kind=certification&q=iso&quick=ready&sort=name:asc&view=board&open=12
// `tab` is the register (Journeys is the plain address). `open` is the journey (Journeys) or the framework (Library) whose details are open: the old
// /frameworks/overview/<framework> address forwards to ?tab=library&open=<framework>. The filters of the other register in the same address are ignored. Pure (no React).
import { integer, listOf, oneOf, sortOf, text, type ParamSpec } from '../../../../lib/addressState.ts';
import { DEFAULT_SORT, QUICK_IDS, SORT_KEYS, sortFor, type QuickId, type Scope, type Sort } from './hubModel.ts';
import { NO_FILTERS, type Filters } from './hubFacets.ts';

export const TABS = ['journeys', 'library'] as const;
export const VIEWS = ['list', 'board'] as const;
export type View = (typeof VIEWS)[number];

const quick = (): ParamSpec<QuickId | null> => ({
  default: null,
  read: ([first]) => ((QUICK_IDS as readonly string[]).includes((first ?? '').trim()) ? ((first ?? '').trim() as QuickId) : undefined),
  write: (value) => (value && value !== 'all' ? [value] : []),
});

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const HUB_SCHEMA = {
  tab: oneOf(TABS, 'journeys'),
  q: text(),
  status: listOf(),
  state: listOf(),
  kind: listOf(),
  authority: listOf(),
  band: listOf(),
  due: listOf(),
  type: listOf(),
  quick: quick(),
  sort: sortOf(SORT_KEYS, null),
  view: oneOf(VIEWS, 'list'),
  open: integer(0, { min: 1 }),
};

export interface HubAddress {
  tab: Scope; q: string; status: string[]; state: string[]; kind: string[]; authority: string[]; band: string[]; due: string[]; type: string[];
  quick: QuickId | null; sort: Sort | null; view: View; open: number;
}
export interface HubPage { scope: Scope; filters: Filters; sort: Sort; view: View; openId: number | null }

export function pageOf(a: HubAddress): HubPage {
  const filters: Filters = { ...NO_FILTERS, search: a.q, status: a.status, state: a.state, kind: a.kind, authority: a.authority, band: a.band, due: a.due, type: a.type, quick: a.quick };
  return { scope: a.tab, filters, sort: sortFor(a.tab, a.sort), view: a.view, openId: a.open || null };
}

/** The names a change of filters is about (a patch, so two changes in one event compose). */
export const filtersPatch = (f: Filters): Partial<HubAddress> => ({
  q: f.search, status: f.status, state: f.state, kind: f.kind, authority: f.authority, band: f.band, due: f.due, type: f.type, quick: f.quick,
});
export const openPatch = (id: number | null): Partial<HubAddress> => ({ open: id ?? 0 });
/** DEFAULT_SORT is the plain address: a sort equal to the register's default is not written. */
export const sortPatch = (scope: Scope, sort: Sort): Partial<HubAddress> => ({ sort: sort.key === DEFAULT_SORT[scope].key && sort.dir === DEFAULT_SORT[scope].dir ? null : sort });

/** The address of a tab, with nothing else in it. */
export const tabHref = (tab: Scope): string => (tab === 'journeys' ? '/frameworks' : `/frameworks?tab=${tab}`);
/** The address that opens one library framework's details (what /frameworks/overview/<id> forwards to). */
export const libraryOpenHref = (frameworkId: number): string => `/frameworks?tab=library&open=${frameworkId}`;

export type StripKey = 'journeys' | 'library' | 'onboarding';
export interface StripItem { key: StripKey; label: string; href: string }
/** The strip under the heading, in order: Onboarding is a page of its own, the other two are registers of /frameworks. */
export const STRIP: readonly StripItem[] = [
  { key: 'journeys', label: 'Journeys', href: tabHref('journeys') },
  { key: 'library', label: 'Library', href: tabHref('library') },
  { key: 'onboarding', label: 'Onboarding', href: '/frameworks/onboarding' },
];
