// The Control Catalog's state in its address, on the kit's useAddressState: ?mode=internal&view=all&framework=12&q=access&source=framework&progress=in_progress&effectiveness=ineffective&due=overdue&page=2,
// ?view=domain&domain=Identity+and+access for an open domain, ?promote=1 for the Add-from-Library sheet. The links that already existed keep working: /controls?mode=internal (the Risk Management
// redirect), /controls?promote=1 (the Control Library's "Promote to Catalog") and /controls?framework=<id> (the Frameworks pages' "View requirements": it opens All controls for that framework, the
// one reader of that name was the retired Workbench page). A value the page cannot be in is the default. Pure (no React).
import { flag, integer, oneOf, text, type AddressState, type ParamSpec } from '../../../../lib/addressState.ts';
import {
  EFFECTIVENESS, MODES, NO_LIST_FILTERS, PROGRESS, SOURCES, VIEWS, attentionFilter,
  type AttentionKey, type CatalogMode, type CatalogView, type ListFilters, type SourceFilter,
} from './catalogModel.ts';

/** One of `options`, or '' (no filter): a word the page does not offer is no filter. Written as the word. */
const wordOr = (options: readonly string[]): ParamSpec<string> => ({
  default: '',
  read: ([first]) => options.find((o) => o === (first ?? '').trim().toLowerCase()),
  write: (value) => (value ? [value] : []),
});

/** Defined once, outside any component (useAddressState reads the address again for a new schema). */
export const CATALOG_SCHEMA = {
  mode: oneOf(MODES, 'framework'),
  view: oneOf(VIEWS, 'domain'),
  domain: text(),
  framework: text(),
  q: text(),
  source: oneOf(SOURCES, 'all'),
  progress: wordOr(PROGRESS),
  effectiveness: wordOr(EFFECTIVENESS),
  due: wordOr(['overdue', 'scheduled']),
  page: integer(1, { min: 1, max: 10000 }),
  promote: flag(),
};

export type CatalogAddress = AddressState<typeof CATALOG_SCHEMA>;

export interface CatalogPage {
  mode: CatalogMode;
  view: CatalogView;
  /** the domain that is open in the By domain view ('' = the hub) */
  openDomain: string;
  /** the filters of the All controls view */
  filters: ListFilters;
  page: number;
  promote: boolean;
}

const digits = (v: string): string => (/^\d{1,9}$/.test(v.trim()) ? String(Number(v.trim())) : '');

/** What the address says. A framework in the address means "that framework's controls": it opens All controls, unless the address names another view itself. */
export function pageOf(a: CatalogAddress): CatalogPage {
  const framework = digits(a.framework);
  const view: CatalogView = a.view === 'domain' && framework ? 'all' : a.view;
  const filters: ListFilters = view === 'all'
    ? { source: a.source, q: a.q, framework, domain: a.domain, progress: a.progress, effectiveness: a.effectiveness, due: a.due }
    : NO_LIST_FILTERS;
  return { mode: a.mode, view, openDomain: view === 'domain' ? a.domain : '', filters, page: a.page, promote: a.promote };
}

/** Everything the filters of a view hold, cleared (a tab starts clean, as the page's views always did). */
const CLEAN = { domain: '', framework: '', q: '', source: 'all' as SourceFilter, progress: '', effectiveness: '', due: '', page: 1 };

/** Picking a tab. */
export const viewPatch = (view: CatalogView): Partial<CatalogAddress> => ({ ...CLEAN, view });

/** Picking Framework or Internal controls (the source switch): back to the hub of that source. */
export const modePatch = (mode: CatalogMode): Partial<CatalogAddress> => ({ ...CLEAN, mode, view: 'domain' });

/** A click on a "needs attention" row: All controls with the filter that finds those controls. */
export function attentionPatch(key: AttentionKey): Partial<CatalogAddress> {
  const f = attentionFilter(key);
  return { ...CLEAN, view: 'all', effectiveness: f.effectiveness ?? '', due: f.due ?? '' };
}

/** A change to the filters of the All controls view: the list starts again from page 1. */
export function filterPatch(next: Partial<ListFilters>): Partial<CatalogAddress> {
  const patch: Partial<CatalogAddress> = { page: 1 };
  if (next.source !== undefined) patch.source = next.source;
  if (next.q !== undefined) patch.q = next.q;
  if (next.framework !== undefined) patch.framework = next.framework;
  if (next.domain !== undefined) patch.domain = next.domain;
  if (next.progress !== undefined) patch.progress = next.progress;
  if (next.effectiveness !== undefined) patch.effectiveness = next.effectiveness;
  if (next.due !== undefined) patch.due = next.due;
  return patch;
}

/** The address of a domain in the hub, and back to the hub. */
export const openDomainPatch = (domain: string): Partial<CatalogAddress> => ({ ...CLEAN, view: 'domain', domain });
