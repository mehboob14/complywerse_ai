// The Frameworks hub's configuration of the facet explorer (components/records): which facets each register has, what value(s) a row has in each, the options the rail lists, how the
// address's filters become the explorer's choice and rule, and the chips that say what is on. Pure (no React), so `node --test` checks it and holds the engine's answer to the plain filter.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../components/records/facetEngine.ts';
import { readinessBand } from '../../../../lib/journeyModel.ts';
import { readinessBandWords } from '../../../../lib/statuses/frameworkJourney.ts';
import { frameworkState, targetWords } from '../../../../lib/statuses/frameworkHub.ts';
import {
  KIND_LABEL, NONE, QUICK_LABEL, haystack, inQuick, searchTerms, typeLabel, type HubRow, type Kind, type QuickId, type Scope,
} from './hubModel.ts';

export type FacetKey = 'status' | 'state' | 'kind' | 'authority' | 'band' | 'due' | 'type';

/** The facets of each register, in the order the rail draws them. */
export const RAIL: Record<Scope, readonly FacetKey[]> = {
  journeys: ['status', 'kind', 'authority', 'band', 'due'],
  library: ['state', 'kind', 'authority', 'type'],
};
export const FACET_TITLE: Record<FacetKey, string> = { status: 'Status', state: 'State', kind: 'Kind', authority: 'Authority', band: 'Readiness', due: 'Target date', type: 'Type' };
export const OPEN_AT_FIRST: Record<Scope, readonly FacetKey[]> = { journeys: ['status', 'due'], library: ['state', 'kind'] };
export const SEARCHABLE: readonly FacetKey[] = ['authority', 'type'];

export interface Filters {
  search: string;
  status: string[];
  state: string[];
  kind: string[];
  authority: string[];
  band: string[];
  due: string[];
  type: string[];
  quick: QuickId | null;
}
export const NO_FILTERS: Filters = { search: '', status: [], state: [], kind: [], authority: [], band: [], due: [], type: [], quick: null };
const ALL_FACETS: readonly FacetKey[] = ['status', 'state', 'kind', 'authority', 'band', 'due', 'type'];

/** How many filters are on in a register (a facet of the other register in the address is not one here). */
export function filterCount(f: Filters, scope: Scope): number {
  return RAIL[scope].reduce((n, k) => n + f[k].length, 0) + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0);
}
export const isFiltering = (f: Filters, scope: Scope): boolean => filterCount(f, scope) > 0;

// ── what a row has in each facet ─────────────────────────────────────────────────────────────────────────────────────────
export const authorityKey = (r: Pick<HubRow, 'authority'>): string => r.authority ?? NONE;
/** The readiness band of a journey's figures; a row with no journey, or whose payload had no figures, is `none` ("No figures"). */
export const bandKey = (r: Pick<HubRow, 'numbers'>): string => (r.numbers ? readinessBand(r.numbers.readyPct) : NONE);

export function hubSpecs(): FacetSpec<HubRow>[] {
  const all: Record<FacetKey, FacetSpec<HubRow>> = {
    status: { key: 'status', values: (r) => [r.state] },
    state: { key: 'state', values: (r) => [r.state] },
    kind: { key: 'kind', values: (r) => [r.kind] },
    authority: { key: 'authority', values: (r) => [authorityKey(r)] },
    band: { key: 'band', values: (r) => [bandKey(r)] },
    due: { key: 'due', values: (r) => [r.target.state] },
    type: { key: 'type', values: (r) => [r.typeKey] },
  };
  return ALL_FACETS.map((k) => all[k]);
}

export const indexHub = (rows: readonly HubRow[]): FacetIndex<HubRow> => indexRows(rows, hubSpecs(), (r) => haystack(r));

/** The values chosen, for the facets this register has. */
export function chosenOf(f: Filters, scope: Scope): Chosen {
  const out: Record<string, readonly string[]> = {};
  RAIL[scope].forEach((k) => { out[k] = f[k]; });
  return out;
}

/** What every row must pass besides the facets: the search words and a quick view. */
export function ruleOf(f: Filters): Rule<HubRow> {
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  return { terms: searchTerms(f.search), extra: quick ? (r) => inQuick(quick, r) : undefined };
}

// ── the options of the rail ──────────────────────────────────────────────────────────────────────────────────────────────
export interface Option { value: string; label: string; title?: string }
const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label);
const KIND_ORDER: Kind[] = ['certification', 'compliance', 'other'];
const BAND_ORDER = ['strong', 'building', 'early', 'start'];
const DUE_ORDER = ['overdue', 'soon', 'later', 'none', 'done'];
const JOURNEY_STATES = ['in_progress', 'not_started', 'on_hold', 'completed', 'cancelled'];
const LIBRARY_STATES = ['idle', 'onboarding', 'ready', 'in_progress', 'not_started', 'on_hold', 'completed', 'cancelled', 'unknown'];

/** The options of every facet of a register: words the platform knows are listed in their order, authorities and types are the ones the rows have. */
export function railOptions(rows: readonly HubRow[], scope: Scope): Record<FacetKey, Option[]> {
  const authorities = new Set<string>();
  const types = new Set<string>();
  let noAuthority = false;
  rows.forEach((r) => { if (r.authority) authorities.add(r.authority); else noAuthority = true; types.add(r.typeKey); });
  const states = (scope === 'journeys' ? JOURNEY_STATES : LIBRARY_STATES).map((v) => ({ value: v, label: frameworkState.label(v) }));
  return {
    status: states,
    state: states,
    kind: KIND_ORDER.map((v) => ({ value: v, label: KIND_LABEL[v] })),
    authority: Array.from(authorities).map((v) => ({ value: v, label: v })).sort(byLabel).concat(noAuthority ? [{ value: NONE, label: 'Not recorded' }] : []),
    band: BAND_ORDER.map((v) => ({ value: v, label: readinessBandWords.label(v) })).concat([{ value: NONE, label: 'No figures' }]),
    due: DUE_ORDER.map((v) => ({ value: v, label: targetWords.label(v) })),
    type: Array.from(types).map((v) => ({ value: v, label: typeLabel(v) })).sort(byLabel),
  };
}

/** Options in the order the rail draws them: an option nobody has is dropped unless it is chosen (then it stays, dimmed, with a 0). */
export function orderedOptions(options: readonly Option[], chosen: readonly string[], count: (value: string) => number): Option[] {
  const have = options.filter((o) => count(o.value) > 0 || chosen.includes(o.value));
  return have.length ? have : options.slice();
}

// ── chips ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Chip { key: string; label: string; group: FacetKey | 'search' | 'quick'; value?: string }

export function filterChips(f: Filters, scope: Scope, options: Record<FacetKey, Option[]>): Chip[] {
  const chips: Chip[] = [];
  if (f.search.trim()) chips.push({ key: 'search', group: 'search', label: `Search: ${f.search.trim()}` });
  if (f.quick && f.quick !== 'all') chips.push({ key: 'quick', group: 'quick', label: QUICK_LABEL[f.quick] });
  RAIL[scope].forEach((g) => f[g].forEach((v) => {
    const o = options[g].find((x) => x.value === v);
    chips.push({ key: `${g}:${v}`, group: g, value: v, label: `${FACET_TITLE[g]}: ${o?.label ?? v}` });
  }));
  return chips;
}

export function removeChip(f: Filters, chip: Chip): Filters {
  if (chip.group === 'search') return { ...f, search: '' };
  if (chip.group === 'quick') return { ...f, quick: null };
  return { ...f, [chip.group]: f[chip.group].filter((v) => v !== chip.value) } as Filters;
}
