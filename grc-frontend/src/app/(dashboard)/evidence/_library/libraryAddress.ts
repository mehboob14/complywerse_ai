// The Evidence page's state in its address, on the kit's useAddressState:
//   /evidence?view=board&status=pending_review&evidence_type=policy&owner=7&fw=ISO%2027001&fresh=lapsed&maturity=poor&quick=waiting&q=firewall&sort=expiry:asc&open=42
//   /evidence?view=insights        the Insights tab         /evidence?section=settings        the Settings tab
//   /evidence?control=41 | ?control_id=77 | ?control=IAC-01&kind=common      the files linked to one control (controlScope.ts)
// Every address that already existed keeps working: ?status= (and `stale` in it, which is now the Lapsed freshness), ?evidence_type=, ?q=, ?open=, ?section=settings, and the five
// old views: workbench and register are the list, pipeline is the board, snapshot and performance are Insights. A value the page cannot be in is the default. Pure (no React).
import { integer, listOf, oneOf, sortOf, text, type ParamSpec } from '../../../../lib/addressState.ts';
import { DEFAULT_SORT, QUICK_IDS, SORT_KEYS, type QuickId, type Sort } from './libraryModel.ts';
import { NO_FILTERS, type Filters } from './libraryFacets.ts';
import { scopeOf, type ControlScope } from './controlScope.ts';

export const VIEWS = ['list', 'board', 'insights'] as const;
export type LibraryView = (typeof VIEWS)[number];

/** The names an old address used for a view, and the view each one is now. */
export const OLD_VIEWS: Readonly<Record<string, LibraryView>> = { workbench: 'list', register: 'list', pipeline: 'board', snapshot: 'insights', performance: 'insights' };

const view = (): ParamSpec<LibraryView> => ({
  default: 'list',
  read: ([first]) => {
    const wanted = (first ?? '').trim().toLowerCase();
    return (VIEWS as readonly string[]).includes(wanted) ? (wanted as LibraryView) : OLD_VIEWS[wanted];
  },
  write: (value) => (value === 'list' ? [] : [value]),
});

const quick = (): ParamSpec<QuickId | null> => ({
  default: null,
  read: ([first]) => ((QUICK_IDS as readonly string[]).includes((first ?? '').trim()) ? ((first ?? '').trim() as QuickId) : undefined),
  write: (value) => (value && value !== 'all' ? [value] : []),
});

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const LIBRARY_SCHEMA = {
  q: text(),
  status: listOf(),
  evidence_type: listOf(),
  owner: listOf(),
  fw: listOf(),
  fresh: listOf(),
  maturity: listOf(),
  quick: quick(),
  sort: sortOf(SORT_KEYS, DEFAULT_SORT),
  view: view(),
  open: integer(0, { min: 1 }),
  /** Records (the Library and Insights) or Settings (the shared module-settings panel) */
  section: oneOf(['records', 'settings'] as const, 'records'),
  /** "Evidence for this control": the control, its alias and what kind it is (controlScope.ts) */
  control: text(),
  control_id: text(),
  kind: text(),
};

export interface LibraryAddress {
  q: string; status: string[]; evidence_type: string[]; owner: string[]; fw: string[]; fresh: string[]; maturity: string[]; quick: QuickId | null;
  sort: Sort | null; view: LibraryView; open: number; section: 'records' | 'settings'; control: string; control_id: string; kind: string;
}

export interface LibraryPage { filters: Filters; sort: Sort; view: LibraryView; openId: number | null; section: 'records' | 'settings'; control: ControlScope | null }

/** What the address says. `stale` in ?status= is the Lapsed freshness; a status word the page does not know is dropped by the engine (it matches no file). */
export function pageOf(a: LibraryAddress): LibraryPage {
  const stale = a.status.includes('stale');
  const status = a.status.filter((s) => s !== 'stale');
  const fresh = stale && !a.fresh.includes('lapsed') ? [...a.fresh, 'lapsed'] : a.fresh;
  const filters: Filters = { ...NO_FILTERS, search: a.q, status, type: a.evidence_type, owner: a.owner, framework: a.fw, freshness: fresh, maturity: a.maturity, quick: a.quick };
  return { filters, sort: a.sort ?? DEFAULT_SORT, view: a.view, openId: a.open || null, section: a.section, control: scopeOf(a) };
}

/** The names a change of filters is about (a patch, so two changes in one event compose). */
export const filtersPatch = (f: Filters): Partial<LibraryAddress> => ({
  q: f.search, status: f.status, evidence_type: f.type, owner: f.owner, fw: f.framework, fresh: f.freshness, maturity: f.maturity, quick: f.quick,
});
export const openPatch = (id: number | null): Partial<LibraryAddress> => ({ open: id ?? 0 });
