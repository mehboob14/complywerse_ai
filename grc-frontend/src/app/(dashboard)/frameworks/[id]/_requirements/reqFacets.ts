// The Requirements tab's configuration of the facet explorer (components/records): which facets there are, what value(s) a requirement has in each, the options the rail lists, how
// the address's filters become the explorer's choice and rule, and the chips that say what is on. Pure (no React), so `node --test` checks it and holds the engine's answer to the
// plain filter (reqModel.test.ts / reqFacets.test.ts).
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../../components/records/facetEngine.ts';
import { evidenceState, requirementScope } from '../../../../../lib/statuses/frameworkRequirements.ts';
import { requirementState } from '../../../../../lib/statuses/frameworkJourney.ts';
import { NONE, QUICK_LABEL, inQuick, searchTerms, type QuickId, type ReqRow, type Viewer } from './reqModel.ts';

export type FacetKey = 'status' | 'evidence' | 'section' | 'owner' | 'priority' | 'critical' | 'category' | 'scope';

export const RAIL_ORDER: readonly FacetKey[] = ['status', 'evidence', 'section', 'owner', 'priority', 'critical', 'category', 'scope'];
export const FACET_TITLE: Record<FacetKey, string> = {
  status: 'Status', evidence: 'Evidence', section: 'Section', owner: 'Owner', priority: 'Priority', critical: 'Critical', category: 'Category', scope: 'Scope',
};
export const OPEN_AT_FIRST: readonly FacetKey[] = ['status', 'evidence'];
export const SEARCHABLE: readonly FacetKey[] = ['section', 'owner'];

export interface Filters {
  search: string;
  status: string[];
  evidence: string[];
  section: string[];
  owner: string[];
  priority: string[];
  critical: string[];
  category: string[];
  scope: string[];
  quick: QuickId | null;
}
export const NO_FILTERS: Filters = { search: '', status: [], evidence: [], section: [], owner: [], priority: [], critical: [], category: [], scope: [], quick: null };

export function filterCount(f: Filters): number {
  return RAIL_ORDER.reduce((n, k) => n + f[k].length, 0) + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0);
}
export const isFiltering = (f: Filters): boolean => filterCount(f) > 0;

/** The values a requirement has in each facet. A requirement out of scope is left out of every list and count until the Scope facet asks for it (it still counts nowhere else). */
export function reqSpecs(): FacetSpec<ReqRow>[] {
  const owned: Record<FacetKey, FacetSpec<ReqRow>> = {
    status: { key: 'status', values: (r) => [r.status] },
    evidence: { key: 'evidence', values: (r) => [r.evidenceKey] },
    section: { key: 'section', values: (r) => [r.sectionKey] },
    owner: { key: 'owner', values: (r) => (r.ownerIds.length ? r.ownerIds.map(String) : [NONE]) },
    priority: { key: 'priority', values: (r) => [r.tier ?? NONE] },
    critical: { key: 'critical', values: (r) => [r.critical ? 'critical' : 'standard'] },
    category: { key: 'category', values: (r) => [r.category] },
    scope: { key: 'scope', values: (r) => [r.inScope ? 'in' : 'out'], passesUnchosen: (r) => r.inScope },
  };
  return RAIL_ORDER.map((k) => owned[k]);
}

export const indexReqs = (rows: readonly ReqRow[]): FacetIndex<ReqRow> => indexRows(rows, reqSpecs(), (r) => r.text);

export function chosenOf(f: Filters): Chosen {
  return { status: f.status, evidence: f.evidence, section: f.section, owner: f.owner, priority: f.priority, critical: f.critical, category: f.category, scope: f.scope };
}

/** What every requirement must pass besides the facets: the search words and a quick view. */
export function ruleOf(f: Filters, viewer: Viewer): Rule<ReqRow> {
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  return { terms: searchTerms(f.search), extra: quick ? (r) => inQuick(quick, r, viewer) : undefined };
}

// ── the options of the rail ──────────────────────────────────────────────────────────────────────────────────────────────
export interface Option { value: string; label: string; title?: string }
const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label);
const EVIDENCE_ORDER = ['none', 'review', 'rejected', 'partial', 'complete', 'not_asked'];

/** The options of every facet. Status and evidence are the words the model knows; section, owner and priority are the ones the requirements have. */
export function railOptions(rows: readonly ReqRow[]): Record<FacetKey, Option[]> {
  const sections = new Map<string, { label: string; rank: number }>();
  const people = new Map<string, string>();
  const tiers = new Set<string>();
  const categories = new Set<string>();
  let noOwner = false;
  let noTier = false;
  let anyNa = false;
  rows.forEach((r) => {
    sections.set(r.sectionKey, { label: r.section, rank: r.sectionRank });
    r.ownerRefs.forEach((o) => people.set(String(o.id), o.name));
    if (r.ownerIds.length === 0) noOwner = true;
    if (r.tier) tiers.add(r.tier); else noTier = true;
    categories.add(r.category);
    if (r.status === 'not_applicable') anyNa = true;
  });
  const statuses = requirementState.words.filter((w) => w !== 'not_applicable' || anyNa);
  return {
    status: statuses.map((v) => ({ value: v, label: requirementState.label(v) })),
    evidence: EVIDENCE_ORDER.map((v) => ({ value: v, label: evidenceState.label(v) })),
    section: Array.from(sections.entries()).sort((a, b) => a[1].rank - b[1].rank).map(([value, s]) => ({ value, label: s.label })),
    owner: Array.from(people.entries()).map(([value, label]) => ({ value, label })).sort(byLabel).concat(noOwner ? [{ value: NONE, label: 'Unassigned' }] : []),
    priority: Array.from(tiers).sort().map((v) => ({ value: v, label: v })).concat(noTier ? [{ value: NONE, label: 'No priority' }] : []),
    critical: [{ value: 'critical', label: 'Critical' }, { value: 'standard', label: 'Not critical' }],
    category: ['Organizational', 'People', 'Physical', 'Technological', 'Other'].filter((c) => categories.has(c as never)).map((v) => ({ value: v, label: v })),
    scope: [{ value: 'in', label: requirementScope.label('in_scope') }, { value: 'out', label: requirementScope.label('out_of_scope') }],
  };
}

/** Options in the order the rail draws them: an option nobody has is dropped unless it is chosen (then it stays, dimmed, with a 0). */
export function orderedOptions(options: readonly Option[], chosen: readonly string[], count: (value: string) => number): Option[] {
  const have = options.filter((o) => count(o.value) > 0 || chosen.includes(o.value));
  return have.length ? have : options.slice();
}

/** A facet with one option to choose from filters nothing, so the rail does not list it (unless something is chosen in it). */
export const facetWorthShowing = (optionCount: number, chosenCount: number): boolean => optionCount >= 2 || chosenCount > 0;

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
