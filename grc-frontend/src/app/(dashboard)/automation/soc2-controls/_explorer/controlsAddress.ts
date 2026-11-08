// The Controls explorer's state in its address, on the kit's useAddressState: ?q=access&status=failed,expired&fw=soc2&domain=Identity&owner=7&quick=mine&sort=status:asc&view=board&scope=all.
// The links that already exist keep working: ?configure=scope (opens the scope dialog), ?source=custom|scf (the origin facet) and the old pages' forwards. A value the page cannot be in is the
// default. Pure (no React).
import { listOf, oneOf, text, type ParamSpec } from '../../../../../lib/addressState.ts';
import { DEFAULT_SORT, QUICK_IDS, SORT_KEYS, type QuickId, type Sort } from './controlsModel.ts';
import { NO_FILTERS, type Filters } from './controlsFacets.ts';

export const VIEWS = ['list', 'domain', 'board'] as const;
export type ExplorerView = (typeof VIEWS)[number];
export const SCOPES = ['in_scope', 'all'] as const;
export type ScopeMode = (typeof SCOPES)[number];

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
export const EXPLORER_SCHEMA = {
  q: text(),
  status: listOf(),
  fw: listOf(),
  domain: listOf(),
  type: listOf(),
  owner: listOf(),
  origin: listOf(),
  quick: quick(),
  sort: sort(),
  view: oneOf(VIEWS, 'list'),
  scope: oneOf(SCOPES, 'in_scope'),
  // links from elsewhere: read once, then taken out of the address
  configure: text(),
  source: text(),
};

export interface ExplorerAddress {
  q: string; status: string[]; fw: string[]; domain: string[]; type: string[]; owner: string[]; origin: string[];
  quick: QuickId | null; sort: Sort; view: ExplorerView; scope: ScopeMode; configure: string; source: string;
}

export interface ExplorerPage { filters: Filters; sort: Sort; view: ExplorerView; scope: ScopeMode; arrive: { configureScope: boolean } }

/** What the address says. The old `?source=custom|scf` link is the origin facet. */
export function pageOf(a: ExplorerAddress): ExplorerPage {
  const src = a.source === 'custom' || a.source === 'scf' ? a.source : '';
  const origin = src && !a.origin.includes(src) ? [...a.origin, src] : a.origin;
  const filters: Filters = { ...NO_FILTERS, search: a.q, status: a.status, framework: a.fw, domain: a.domain, type: a.type, owner: a.owner, origin, quick: a.quick };
  return { filters, sort: a.sort, view: a.view, scope: a.scope, arrive: { configureScope: a.configure === 'scope' } };
}

/** The names a change of filters is about (a patch, so two changes in one event compose). */
export const filtersPatch = (f: Filters): Partial<ExplorerAddress> => ({
  q: f.search, status: f.status, fw: f.framework, domain: f.domain, type: f.type, owner: f.owner, origin: f.origin, quick: f.quick, source: '',
});
/** The one-shot links are taken out of the address once the page has acted on them. */
export const arrivedPatch = (): Partial<ExplorerAddress> => ({ configure: '', source: '' });

/** The address of the explorer for a quick view or a filter, as another page links to it (the Overview's counters, a control's domain). */
export function explorerHref(params: { quick?: QuickId; status?: string[]; domain?: string; scope?: ScopeMode; owner?: string }): string {
  const q = new URLSearchParams();
  if (params.quick && params.quick !== 'all') q.set('quick', params.quick);
  if (params.status?.length) q.set('status', params.status.join(','));
  if (params.domain) q.set('domain', params.domain);
  if (params.owner) q.set('owner', params.owner);
  if (params.scope === 'all') q.set('scope', 'all');
  const s = q.toString();
  return s ? `/automation/soc2-controls?${s}` : '/automation/soc2-controls';
}
