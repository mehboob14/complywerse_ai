// The Controls explorer's configuration of the facet explorer (components/records): which facets there are, what value(s) a control has in each, the options the rail lists, how the
// address's filters become the explorer's choice and rule, and the chips that say what is on. Pure (no React), so `node --test` checks it (controlsFacets.test.ts) and holds the
// engine's answer to the plain filter below it.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../../components/records/facetEngine.ts';
import { CONTROL_STATUS_ORDER, controlStatus } from '../../../../../lib/statuses/controls.ts';
import {
  LATE_OWNER, NO_VALUE, QUICK_LABEL, frameworksOf, haystack, inQuick, searchTerms, type ControlRow, type Ctx, type QuickId, type Row,
} from './controlsModel.ts';

export type FacetKey = 'status' | 'framework' | 'domain' | 'type' | 'owner' | 'origin';

/** The facets in the order the rail lists them. */
export const RAIL_ORDER: readonly FacetKey[] = ['status', 'framework', 'domain', 'type', 'owner', 'origin'];
export const FACET_TITLE: Record<FacetKey, string> = { status: 'Status', framework: 'Framework', domain: 'Domain', type: 'Type', owner: 'Owner', origin: 'Origin' };
/** Open with the rail; the others are one press away. */
export const OPEN_AT_FIRST: readonly FacetKey[] = ['status', 'framework', 'owner'];
export const SEARCHABLE: readonly FacetKey[] = ['framework', 'domain', 'owner'];

export interface Filters {
  search: string;
  status: string[];
  framework: string[];
  domain: string[];
  type: string[];
  owner: string[];
  origin: string[];
  quick: QuickId | null;
}

export const NO_FILTERS: Filters = { search: '', status: [], framework: [], domain: [], type: [], owner: [], origin: [], quick: null };

/** What filters are on (a search, a facet value, a quick view). */
export function filterCount(f: Filters): number {
  const lists = RAIL_ORDER.reduce((n, k) => n + f[k].length, 0);
  return lists + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0);
}
export const isFiltering = (f: Filters): boolean => filterCount(f) > 0;

export function controlSpecs(): FacetSpec<Row>[] {
  const owned: Record<FacetKey, FacetSpec<Row>> = {
    status: { key: 'status', values: (r) => [r.overall_status || 'not_run'] },
    framework: { key: 'framework', values: (r) => { const f = frameworksOf(r); return f.length ? f : [NO_VALUE]; } },
    domain: { key: 'domain', values: (r) => [r.category || NO_VALUE] },
    type: { key: 'type', values: (r) => [r.sub_type || NO_VALUE] },
    owner: { key: 'owner', values: (r) => [r.owner_user_id != null ? String(r.owner_user_id) : NO_VALUE, ...(r.ownership_status === 'overdue' ? [LATE_OWNER] : [])] },
    origin: { key: 'origin', values: (r) => [r.custom ? 'custom' : 'scf'] },
  };
  return RAIL_ORDER.map((k) => owned[k]);
}

export const indexControls = (rows: readonly Row[]): FacetIndex<Row> => indexRows(rows, controlSpecs(), (r) => haystack(r));

export function chosenOf(f: Filters): Chosen {
  return { status: f.status, framework: f.framework, domain: f.domain, type: f.type, owner: f.owner, origin: f.origin };
}

/** What every control must pass besides the facets: the search words and the quick view. */
export function ruleOf(f: Filters, ctx: Ctx): Rule<Row> {
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  return { terms: searchTerms(f.search), extra: quick ? (r) => inQuick(quick, r, ctx) : undefined };
}

// ── the options of the rail ──────────────────────────────────────────────────────────────────────────────────────────────

export interface Option { value: string; label: string; title?: string }

export interface RailLookups {
  rows: readonly ControlRow[];
  /** framework key -> the name the organisation sees */
  frameworks: Readonly<Record<string, string>>;
}

const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });

/** The options of every facet: the values the controls have (a framework or a domain nobody uses is not offered), in the words the person reads. */
export function railOptions(l: RailLookups): Record<FacetKey, Option[]> {
  const present = (pick: (r: ControlRow) => string[]): Set<string> => { const s = new Set<string>(); l.rows.forEach((r) => pick(r).forEach((v) => s.add(v))); return s; };
  const owners = new Map<string, string>();
  l.rows.forEach((r) => { if (r.owner_user_id != null) owners.set(String(r.owner_user_id), r.owner_name || 'Someone no longer here'); });
  const types = Array.from(present((r) => (r.sub_type ? [r.sub_type] : []))).map((v) => ({ value: v, label: v }));
  const orderedTypes = ['Automated', 'Hybrid', 'Manual'];
  types.sort((a, b) => (orderedTypes.indexOf(a.value) + 1 || 99) - (orderedTypes.indexOf(b.value) + 1 || 99) || a.label.localeCompare(b.label));
  return {
    status: CONTROL_STATUS_ORDER.map((v) => ({ value: v, label: controlStatus.label(v) })),
    framework: Array.from(present((r) => frameworksOf(r))).map((v) => ({ value: v, label: l.frameworks[v] || v })).sort(byLabel).concat([{ value: NO_VALUE, label: 'No framework' }]),
    domain: Array.from(present((r) => (r.category ? [r.category] : []))).map((v) => ({ value: v, label: v })).sort(byLabel).concat([{ value: NO_VALUE, label: 'No domain' }]),
    type: types.concat([{ value: NO_VALUE, label: 'No type' }]),
    owner: Array.from(owners.entries()).map(([value, label]) => ({ value, label })).sort(byLabel)
      .concat([{ value: NO_VALUE, label: 'No owner' }, { value: LATE_OWNER, label: 'Owner’s date has passed' }]),
    origin: [{ value: 'scf', label: 'SCF' }, { value: 'custom', label: 'Custom' }],
  };
}

/** Options in the order the rail draws them: an option nobody has is dropped, unless it is chosen (it stays, dimmed, with a count of 0). */
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

/** The plain filter the engine is held to by a test: the same answer by the long way. */
export function plainFilter(rows: readonly Row[], f: Filters, ctx: Ctx): Row[] {
  const terms = searchTerms(f.search);
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  const specs = controlSpecs();
  const chosen = chosenOf(f);
  return rows.filter((r) => {
    if (terms.some((t) => !haystack(r).includes(t))) return false;
    if (quick && !inQuick(quick, r, ctx)) return false;
    return specs.every((s) => { const want = chosen[s.key]; return !want || want.length === 0 || s.values(r).some((v) => want.includes(v)); });
  });
}
