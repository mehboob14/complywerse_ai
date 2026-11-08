// The Evidence Library's configuration of the facet explorer (components/records): which facets there are, what value(s) a file has in each, the options the rail lists, how the
// address's filters become the explorer's choice and rule, and the chips that say what is on. Pure (no React), so `node --test` checks it (libraryFacets.test.ts) and holds the
// engine's answer to the plain filter below it.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../components/records/facetEngine.ts';
import { evidenceStatus, freshnessState, maturityLevel } from '../../../../lib/statuses/evidence.ts';
import { ownerOf, typeLabel } from '../_workspace/evidenceModel.ts';
import {
  FRESHNESS, NONE, OTHER_TYPE, QUICK_LABEL, freshnessOf, haystack, inQuick, maturityOfRow, ownerKey, searchTerms, type LibraryRow, type QuickId, type Viewer,
} from './libraryModel.ts';

export type FacetKey = 'status' | 'type' | 'owner' | 'framework' | 'freshness' | 'maturity';

/** The facets in the order the rail lists them. */
export const RAIL_ORDER: readonly FacetKey[] = ['status', 'type', 'owner', 'framework', 'freshness', 'maturity'];
export const FACET_TITLE: Record<FacetKey, string> = { status: 'Status', type: 'Type', owner: 'Owner', framework: 'Framework', freshness: 'Freshness', maturity: 'Maturity' };
/** Open with the rail; the others are one press away. */
export const OPEN_AT_FIRST: readonly FacetKey[] = ['status', 'freshness', 'type'];
export const SEARCHABLE: readonly FacetKey[] = ['type', 'owner', 'framework'];

/** The statuses a file can be in, in the order the rail lists them. */
export const STATUS_OPTIONS = ['draft', 'pending_review', 'approved', 'rejected', 'expired', 'archived'] as const;
export const MATURITY_OPTIONS = ['strong', 'fair', 'weak', 'poor', 'unrated'] as const;

export interface Filters {
  search: string;
  status: string[];
  type: string[];
  owner: string[];
  framework: string[];
  freshness: string[];
  maturity: string[];
  quick: QuickId | null;
}

export const NO_FILTERS: Filters = { search: '', status: [], type: [], owner: [], framework: [], freshness: [], maturity: [], quick: null };

/** What filters are on (a search, a facet value, a quick view). */
export function filterCount(f: Filters): number {
  const lists = RAIL_ORDER.reduce((n, k) => n + f[k].length, 0);
  return lists + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0);
}
export const isFiltering = (f: Filters): boolean => filterCount(f) > 0;

export function librarySpecs(now: number): FacetSpec<LibraryRow>[] {
  const owned: Record<FacetKey, FacetSpec<LibraryRow>> = {
    // an archived file stays out of the list until Archived is chosen, as in the Documents library
    status: { key: 'status', values: (r) => [r.status], passesUnchosen: (r) => r.status !== 'archived' },
    type: { key: 'type', values: (r) => [r.evidence_type || OTHER_TYPE] },
    owner: { key: 'owner', values: (r) => [ownerKey(r)] },
    framework: { key: 'framework', values: (r) => (r.frameworks && r.frameworks.length ? r.frameworks : [NONE]) },
    freshness: { key: 'freshness', values: (r) => [freshnessOf(r, now)] },
    maturity: { key: 'maturity', values: (r) => [maturityOfRow(r)] },
  };
  return RAIL_ORDER.map((k) => owned[k]);
}

export const indexLibrary = (rows: readonly LibraryRow[], now: number): FacetIndex<LibraryRow> => indexRows(rows, librarySpecs(now), (r) => haystack(r));

export function chosenOf(f: Filters): Chosen {
  return { status: f.status, type: f.type, owner: f.owner, framework: f.framework, freshness: f.freshness, maturity: f.maturity };
}

/** What every file must pass besides the facets: the search words and a quick view. */
export function ruleOf(f: Filters, viewer: Viewer): Rule<LibraryRow> {
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  return { terms: searchTerms(f.search), extra: quick ? (r) => inQuick(quick, r, viewer) : undefined };
}

// ── the options of the rail ──────────────────────────────────────────────────────────────────────────────────────────────
export interface Option { value: string; label: string; title?: string }

const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label);

/** The options of every facet. Types, owners and frameworks are the ones the files have (a type nobody uses is not offered). */
export function railOptions(rows: readonly LibraryRow[]): Record<FacetKey, Option[]> {
  const types = new Set<string>();
  const owners = new Map<string, string>();
  const frameworks = new Set<string>();
  rows.forEach((r) => {
    types.add(r.evidence_type || OTHER_TYPE);
    const key = ownerKey(r);
    if (key !== NONE && !owners.get(key)) owners.set(key, ownerOf(r) ?? 'Someone no longer here');
    (r.frameworks ?? []).forEach((f) => frameworks.add(f));
  });
  return {
    status: STATUS_OPTIONS.map((v) => ({ value: v, label: evidenceStatus.label(v) })),
    type: Array.from(types).map((v) => ({ value: v, label: typeLabel(v === OTHER_TYPE ? null : v) })).sort(byLabel),
    owner: Array.from(owners.entries()).map(([value, label]) => ({ value, label })).sort(byLabel).concat([{ value: NONE, label: 'Unassigned' }]),
    framework: Array.from(frameworks).map((v) => ({ value: v, label: v })).sort(byLabel).concat([{ value: NONE, label: 'No framework' }]),
    freshness: FRESHNESS.map((v) => ({ value: v, label: freshnessState.label(v) })),
    maturity: MATURITY_OPTIONS.map((v) => ({ value: v, label: maturityLevel.label(v) })),
  };
}

/** Options in the order the rail draws them: the ones chosen stay where they are; an option nobody has is dropped unless it is chosen (then it stays, dimmed, with a 0). */
export function orderedOptions(options: readonly Option[], chosen: readonly string[], count: (value: string) => number): Option[] {
  const have = options.filter((o) => count(o.value) > 0 || chosen.includes(o.value));
  return have.length ? have : options.slice();
}

// ── chips ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Chip { key: string; label: string; group: FacetKey | 'search' | 'quick'; value?: string }

export function filterChips(f: Filters, options: Record<FacetKey, Option[]>): Chip[] {
  const chips: Chip[] = [];
  if (f.search.trim()) chips.push({ key: 'search', group: 'search', label: `Search: ${f.search.trim()}` });
  if (f.quick && f.quick !== 'all') chips.push({ key: 'quick', group: 'quick', label: QUICK_LABEL[f.quick] });
  RAIL_ORDER.forEach((g) => f[g].forEach((v) => {
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
