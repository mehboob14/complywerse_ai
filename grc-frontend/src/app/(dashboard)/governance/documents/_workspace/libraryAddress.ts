// The library's state in its address, on the kit's useAddressState: the SAME grammar as libraryModel.fromParams / toParams (q type status owner dept fw review att cls mine
// expiry attn waiting sort open|id view), so every link that exists (the Overview's, the review calendar's `?id=`, a saved view's query) opens the same view, and the page
// also follows the address when it changes under it (a link clicked from inside the page, Back). The kit's schema reads a little more than the old code did (a repeated
// name, a sort written in capitals) and never less; libraryAddress.test.ts holds the two readings together. Pure (no React).
import { flag, integer, listOf, text, type ParamSpec } from '../../../../../lib/addressState.ts';
import {
  ATTENTION_KINDS, ATTESTATION_BUCKETS, DEFAULT_SORT, EXPIRY_PARAM, GROUP_KEYS, NO_FILTERS, REVIEW_BUCKETS, SORT_KEYS, layoutOf, nextStatuses,
  type AttentionKind, type Filters, type GroupKey, type LibraryState, type LibraryViewId, type SortKey,
} from './libraryModel.ts';

const statusList = (): ParamSpec<string[]> => {
  const base = listOf();
  return { ...base, read: (values) => nextStatuses([], base.read(values) ?? []) };               // 'archived' stands alone, as fromParams reads it
};
const expiry = (): ParamSpec<boolean> => ({ default: false, read: ([first]) => (first ?? '').trim() === EXPIRY_PARAM, write: (on) => (on ? [EXPIRY_PARAM] : []) });
const attention = (): ParamSpec<AttentionKind | null> => ({
  default: null,
  read: ([first]) => ((ATTENTION_KINDS as readonly string[]).includes((first ?? '').trim()) ? ((first ?? '').trim() as AttentionKind) : undefined),   // a kind this page does not know is ignored
  write: (kind) => (kind ? [kind] : []),
});
const layout = (): ParamSpec<LibraryViewId | null> => ({
  default: null,
  read: ([first]) => layoutOf((first ?? '').trim()) ?? undefined,                    // an old ?view=board opens the list (libraryModel.layoutOf)
  write: (view) => (view ? [view] : []),
});
const grouping = (): ParamSpec<GroupKey | null> => ({
  default: null,
  read: ([first]) => ((GROUP_KEYS as readonly string[]).includes((first ?? '').trim()) ? ((first ?? '').trim() as GroupKey) : undefined),
  write: (key) => (key ? [key] : []),
});
const sort = (): ParamSpec<{ key: SortKey; dir: 'asc' | 'desc' }> => ({
  default: DEFAULT_SORT,
  read: ([first]) => {
    const [key, dir, ...rest] = (first ?? '').trim().split(':');
    return rest.length === 0 && (SORT_KEYS as string[]).includes(key) && (dir === 'asc' || dir === 'desc') ? { key: key as SortKey, dir } : undefined;
  },
  write: (value) => (value.key === DEFAULT_SORT.key && value.dir === DEFAULT_SORT.dir ? [] : [`${value.key}:${value.dir}`]),
});

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const LIBRARY_SCHEMA = {
  q: text(),
  type: listOf(),
  status: statusList(),
  owner: listOf(),
  dept: listOf(),
  fw: listOf(),
  review: listOf(REVIEW_BUCKETS),
  att: listOf(ATTESTATION_BUCKETS),
  cls: listOf(),
  mine: flag(),
  expiry: expiry(),
  attn: attention(),
  waiting: flag(),
  sort: sort(),
  open: integer(0, { min: 1 }),
  id: integer(0, { min: 1 }),                      // the review calendar's older link: read as `open`, never written
  view: layout(),
  group: grouping(),
};

export type LibraryAddress = {
  q: string; type: string[]; status: string[]; owner: string[]; dept: string[]; fw: string[]; review: string[]; att: string[]; cls: string[];
  mine: boolean; expiry: boolean; attn: AttentionKind | null; waiting: boolean; sort: { key: SortKey; dir: 'asc' | 'desc' }; open: number; id: number; view: LibraryViewId | null; group: GroupKey | null;
};

export interface LibraryPage { state: LibraryState; openId: number | null; view: LibraryViewId | null; group: GroupKey | null }

/** What the address says. */
export function pageOf(a: LibraryAddress): LibraryPage {
  const filters: Filters = {
    ...NO_FILTERS, search: a.q, types: a.type, statuses: a.status, owners: a.owner, departments: a.dept, frameworks: a.fw,
    review: a.review as Filters['review'], attestation: a.att as Filters['attestation'], classifications: a.cls, mine: a.mine, expiring: a.expiry, attention: a.attn, waiting: a.waiting,
  };
  return { state: { filters, sort: a.sort }, openId: a.open || a.id || null, view: a.view, group: a.group };
}

/** The address of a page (every name of the schema, so a name that is not set is taken out of the address). */
export function addressOf(page: LibraryPage): LibraryAddress {
  const f = page.state.filters;
  return {
    q: f.search, type: f.types, status: f.statuses, owner: f.owners, dept: f.departments, fw: f.frameworks, review: f.review, att: f.attestation, cls: f.classifications,
    mine: f.mine, expiry: f.expiring, attn: f.attention, waiting: f.waiting, sort: page.state.sort, open: page.openId ?? 0, id: 0, view: page.view, group: page.group,
  };
}

// ── patches: only the names a change is about, so two changes in one event (a view applied, then the details closed) compose ──────────────────────────────────────────────
export const filtersPatch = (f: Filters): Partial<LibraryAddress> => ({
  q: f.search, type: f.types, status: f.statuses, owner: f.owners, dept: f.departments, fw: f.frameworks, review: f.review, att: f.attestation, cls: f.classifications,
  mine: f.mine, expiry: f.expiring, attn: f.attention, waiting: f.waiting,
});
export const statePatch = (s: LibraryState): Partial<LibraryAddress> => ({ ...filtersPatch(s.filters), sort: s.sort });
export const openPatch = (id: number | null): Partial<LibraryAddress> => ({ open: id ?? 0, id: 0 });
export const viewPatch = (view: LibraryViewId | null): Partial<LibraryAddress> => ({ view });
export const groupPatch = (group: GroupKey | null): Partial<LibraryAddress> => ({ group });
