// The Changes register's state in its address, on the kit's useAddressState: ?tab=changes&q=cyber&status=under_assessment,implementation&prio=high&reg=SBP&owner=7&eff=soon&work=late
// &quick=mine&sort=effective:asc&view=board&open=12. A link opens the same view. The Overview's counters and the old links land here: ?work=late, ?status=..., ?add=circular. A value the page
// cannot be in is the default. Pure (no React).
import { flag, integer, listOf, oneOf, text, type ParamSpec } from '../../../../../lib/addressState.ts';
import { DEFAULT_SORT, NO_FILTERS, QUICK_IDS, SORT_KEYS, type Filters, type QuickId, type Sort } from './changeFacets.ts';

export const VIEWS = ['list', 'board'] as const;
export type RegisterView = (typeof VIEWS)[number];
export const ADD_MODES = ['circular', 'manual'] as const;
export type AddMode = (typeof ADD_MODES)[number];

const sort = (): ParamSpec<Sort> => ({
  default: DEFAULT_SORT,
  read: ([first]) => {
    const [key, dir, ...rest] = (first ?? '').trim().split(':');
    return rest.length === 0 && (SORT_KEYS as readonly string[]).includes(key) && (dir === 'asc' || dir === 'desc') ? { key: key as Sort['key'], dir } : undefined;
  },
  write: (value) => (value.key === DEFAULT_SORT.key && value.dir === DEFAULT_SORT.dir ? [] : [`${value.key}:${value.dir}`]),
});

const quick = (): ParamSpec<QuickId | null> => ({
  default: null,
  read: ([first]) => ((QUICK_IDS as readonly string[]).includes((first ?? '').trim()) ? ((first ?? '').trim() as QuickId) : undefined),
  write: (value) => (value && value !== 'all' ? [value] : []),
});

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const REGISTER_SCHEMA = {
  q: text(),
  status: listOf(),
  prio: listOf(),
  reg: listOf(),
  owner: listOf(),
  eff: listOf(),
  work: listOf(),
  quick: quick(),
  sort: sort(),
  view: oneOf(VIEWS, 'list'),
  open: integer(0, { min: 1 }),
  // a link that opens the upload panel (read once, then taken out of the address)
  add: oneOf(['', ...ADD_MODES] as const, ''),
  // kept so an old address with it is not lost; it only means "this tab"
  new: flag(),
};

export interface RegisterAddress {
  q: string; status: string[]; prio: string[]; reg: string[]; owner: string[]; eff: string[]; work: string[]; quick: QuickId | null; sort: Sort; view: RegisterView; open: number;
  add: '' | AddMode; new: boolean;
}

export interface RegisterPage { filters: Filters; sort: Sort; view: RegisterView; openId: number | null; add: AddMode | null }

export function pageOf(a: RegisterAddress): RegisterPage {
  const filters: Filters = { ...NO_FILTERS, search: a.q, status: a.status, priority: a.prio, regulator: a.reg, owner: a.owner, effective: a.eff, work: a.work, quick: a.quick };
  return { filters, sort: a.sort, view: a.view, openId: a.open || null, add: a.add || null };
}

/** The names a change of filters is about (a patch, so two changes in one event compose). */
export const filtersPatch = (f: Filters): Partial<RegisterAddress> => ({
  q: f.search, status: f.status, prio: f.priority, reg: f.regulator, owner: f.owner, eff: f.effective, work: f.work, quick: f.quick,
});
export const openPatch = (id: number | null): Partial<RegisterAddress> => ({ open: id ?? 0 });
export const addedPatch = (): Partial<RegisterAddress> => ({ add: '' });
