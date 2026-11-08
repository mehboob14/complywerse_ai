// The All tasks register's state in its address, on the kit's useAddressState: ?q=vpn&status=Open,In Progress&priority=High&owner=7&quick=overdue&sort=due_date:asc&view=board&group=owner&open=12.
// Every link that already exists keeps working: the old board's ?q= ?source= ?priority= ?status= ?category= ?owner= ?sort= ?page= ?size= and ?view=kanban (now the board) / ?view=table (now the
// list), and the `mine` flag the old address declared (it is the Mine quick view). A value the page cannot be in is the default. Pure (no React), tested in taskAddress.test.ts.
// `tab` and any other param of the page that holds the register are left alone by the address helpers.
import { flag, integer, listOf, oneOf, sortOf, text, type ParamSpec } from '../../../../lib/addressState.ts';
import { DEFAULT_SORT, GROUPS, NO_FILTERS, QUICK_IDS, SORT_KEYS, type Filters, type GroupBy, type QuickId, type Sort } from './taskFacets.ts';
import { DEFAULT_PAGE_SIZE, pageSizeOf } from '../tasksModel.ts';

export const VIEWS = ['list', 'board'] as const;
export type RegisterView = (typeof VIEWS)[number];

/** `list` / `board`, and the old words for them: `table` and `kanban`. Written as list (nothing) or board. */
const view = (): ParamSpec<RegisterView> => ({
  default: 'list',
  read: ([first]) => {
    const wanted = (first ?? '').trim().toLowerCase();
    return wanted === 'board' || wanted === 'kanban' ? 'board' : wanted === 'list' || wanted === 'table' ? 'list' : undefined;
  },
  write: (value) => (value === 'board' ? ['board'] : []),
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
  priority: listOf(),
  due: listOf(),
  sla: listOf(),
  kind: listOf(),
  source: listOf(),
  category: listOf(),
  owner: listOf(),
  reviewer: listOf(),
  by: listOf(),
  approval: listOf(),
  repeats: listOf(),
  linked: listOf(),
  quick: quick(),
  sort: sortOf(SORT_KEYS, DEFAULT_SORT),
  page: integer(1, { min: 1 }),
  size: integer(DEFAULT_PAGE_SIZE, { min: 1, max: 100 }),
  view: view(),
  group: oneOf(GROUPS, 'none'),
  open: integer(0, { min: 1 }),
  mine: flag(),
};

export interface RegisterAddress {
  q: string; status: string[]; priority: string[]; due: string[]; sla: string[]; kind: string[]; source: string[]; category: string[]; owner: string[]; reviewer: string[]; by: string[];
  approval: string[]; repeats: string[]; linked: string[]; quick: QuickId | null; sort: Sort | null; page: number; size: number; view: RegisterView; group: GroupBy; open: number; mine: boolean;
}

export interface RegisterPage { filters: Filters; sort: Sort; view: RegisterView; group: GroupBy; page: number; size: number; openId: number | null }

/** What the address says. The old `mine` flag is the Mine quick view; a sort cleared with `none` is the default order. */
export function pageOf(a: RegisterAddress): RegisterPage {
  const filters: Filters = {
    ...NO_FILTERS, search: a.q, status: a.status, priority: a.priority, due: a.due, sla: a.sla, kind: a.kind, source: a.source, category: a.category, owner: a.owner, reviewer: a.reviewer,
    creator: a.by, approval: a.approval, repeats: a.repeats, linked: a.linked, quick: a.quick ?? (a.mine ? 'mine' : null),
  };
  return { filters, sort: a.sort ?? DEFAULT_SORT, view: a.view, group: a.group, page: a.page, size: pageSizeOf(a.size), openId: a.open || null };
}

/** The names a change of filters is about (a patch, so two changes in one event compose); the page goes back to the first and the old `mine` flag is dropped (it is the quick view now). */
export const filtersPatch = (f: Filters): Partial<RegisterAddress> => ({
  q: f.search, status: f.status, priority: f.priority, due: f.due, sla: f.sla, kind: f.kind, source: f.source, category: f.category, owner: f.owner, reviewer: f.reviewer, by: f.creator,
  approval: f.approval, repeats: f.repeats, linked: f.linked, quick: f.quick, mine: false, page: 1,
});
export const openPatch = (id: number | null): Partial<RegisterAddress> => ({ open: id ?? 0 });
