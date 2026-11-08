// The Risk Register's state in its address, on the kit's useAddressState: ?q=card&status=open,in_treatment&level=critical&owner=7&quick=mine&sort=level:desc&view=board&open=12.
// Every link that already exists keeps working: ?new=1 (Add a risk), ?upload=1 (Import), ?edit=<risk id> (the risk's form), ?register_type=<name> (the register facet), and the
// old pages /erm/risks/dashboard and /erm/risks/list forward here (the dashboard as ?view=insights). A value the page cannot be in is the default. Pure (no React).
import { flag, integer, listOf, oneOf, text, type ParamSpec } from '../../../../../lib/addressState.ts';
import { DEFAULT_SORT, QUICK_IDS, SORT_KEYS, type Basis, type QuickId, type Sort } from './riskModel.ts';
import { NO_FILTERS, type Filters } from './riskFacets.ts';

export const VIEWS = ['list', 'board', 'insights'] as const;
export type RegisterView = (typeof VIEWS)[number];

const sort = (): ParamSpec<Sort> => ({
  default: DEFAULT_SORT,
  read: ([first]) => {
    const [key, dir, ...rest] = (first ?? '').trim().split(':');
    return rest.length === 0 && (SORT_KEYS as readonly string[]).includes(key) && (dir === 'asc' || dir === 'desc') ? { key: key as Sort['key'], dir } : undefined;
  },
  write: (value) => (value.key === DEFAULT_SORT.key && value.dir === DEFAULT_SORT.dir ? [] : [`${value.key}:${value.dir}`]),
});

const cell = (): ParamSpec<{ l: number; i: number } | null> => ({
  default: null,
  read: ([first]) => {
    const m = /^([1-5])-([1-5])$/.exec((first ?? '').trim());
    return m ? { l: Number(m[1]), i: Number(m[2]) } : undefined;
  },
  write: (value) => (value ? [`${value.l}-${value.i}`] : []),
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
  level: listOf(),
  cat: listOf(),
  owner: listOf(),
  unit: listOf(),
  treat: listOf(),
  fw: listOf(),
  sla: listOf(),
  review: listOf(),
  reg: listOf(),
  quick: quick(),
  cell: cell(),
  basis: oneOf(['residual', 'inherent'] as const, 'residual'),
  sort: sort(),
  view: oneOf(VIEWS, 'list'),
  open: integer(0, { min: 1 }),
  // links from elsewhere (and from the old pages): read once, then taken out of the address
  new: flag(),
  upload: flag(),
  edit: integer(0, { min: 1 }),
  register_type: text(),
};

export interface RegisterAddress {
  q: string; status: string[]; level: string[]; cat: string[]; owner: string[]; unit: string[]; treat: string[]; fw: string[]; sla: string[]; review: string[]; reg: string[];
  quick: QuickId | null; cell: { l: number; i: number } | null; basis: Basis; sort: Sort; view: RegisterView; open: number; new: boolean; upload: boolean; edit: number; register_type: string;
}

export interface RegisterPage { filters: Filters; sort: Sort; view: RegisterView; openId: number | null; arrive: { create: boolean; upload: boolean; edit: number | null } }

/** What the address says. The old `register_type` link is the register facet. */
export function pageOf(a: RegisterAddress): RegisterPage {
  const reg = a.register_type.trim() && !a.reg.includes(a.register_type.trim()) ? [...a.reg, a.register_type.trim()] : a.reg;
  const filters: Filters = {
    ...NO_FILTERS, search: a.q, status: a.status, level: a.level, category: a.cat, owner: a.owner, unit: a.unit, treatment: a.treat, framework: a.fw, sla: a.sla, review: a.review, register: reg,
    quick: a.quick, cell: a.cell, basis: a.basis,
  };
  return { filters, sort: a.sort, view: a.view, openId: a.open || null, arrive: { create: a.new, upload: a.upload, edit: a.edit || null } };
}

/** The names a change of filters is about (a patch, so two changes in one event compose). */
export const filtersPatch = (f: Filters): Partial<RegisterAddress> => ({
  q: f.search, status: f.status, level: f.level, cat: f.category, owner: f.owner, unit: f.unit, treat: f.treatment, fw: f.framework, sla: f.sla, review: f.review, reg: f.register,
  quick: f.quick, cell: f.cell, basis: f.basis, register_type: '',
});
export const openPatch = (id: number | null): Partial<RegisterAddress> => ({ open: id ?? 0 });
/** The one-shot links are taken out of the address once the page has acted on them. */
export const arrivedPatch = (): Partial<RegisterAddress> => ({ new: false, upload: false, edit: 0 });
