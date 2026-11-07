// The Risk Register's configuration of the facet explorer (components/records): which facets there are, what value(s) a risk has in each, the options the rail lists, how the
// address's filters become the explorer's choice and rule, and the chips that say what is on. Pure (no React), so `node --test` checks it (riskFacets.test.ts) and holds the engine's
// answer to the plain filter below it.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../../components/records/facetEngine.ts';
import { riskLevel, riskSla, riskTreatment } from '../../../../../lib/statuses/risk.ts';
import {
  BANDS, BUCKET_LABEL, NO_FRAMEWORK, NO_OWNER, NO_UNIT, QUICK_LABEL, STATUS_BUCKETS, cellOf, categoryKey, categoryLabel, haystack, inQuick, levelOf, peopleOf, reviewOf, searchTerms, statusBucket,
  treatmentOf, type Basis, type QuickId, type RiskRow, type RuleContext,
} from './riskModel.ts';

export type FacetKey = 'status' | 'level' | 'category' | 'owner' | 'unit' | 'treatment' | 'framework' | 'sla' | 'review' | 'register';

/** The facets in the order the rail lists them. */
export const RAIL_ORDER: readonly FacetKey[] = ['status', 'level', 'category', 'owner', 'unit', 'treatment', 'framework', 'sla', 'review', 'register'];
export const FACET_TITLE: Record<FacetKey, string> = {
  status: 'Status', level: 'Level', category: 'Category', owner: 'Owner', unit: 'Business unit', treatment: 'Treatment', framework: 'Framework', sla: 'SLA', review: 'Review', register: 'Register',
};
/** Open with the rail; the others are one press away. */
export const OPEN_AT_FIRST: readonly FacetKey[] = ['status', 'level', 'category', 'owner'];
export const SEARCHABLE: readonly FacetKey[] = ['owner', 'unit', 'framework', 'category'];

export interface Filters {
  search: string;
  status: string[];
  level: string[];
  category: string[];
  owner: string[];
  unit: string[];
  treatment: string[];
  framework: string[];
  sla: string[];
  review: string[];
  register: string[];
  quick: QuickId | null;
  cell: { l: number; i: number } | null;
  basis: Basis;
}

export const NO_FILTERS: Filters = {
  search: '', status: [], level: [], category: [], owner: [], unit: [], treatment: [], framework: [], sla: [], review: [], register: [], quick: null, cell: null, basis: 'residual',
};

export const NO_REGISTER = 'none';

/** What filters are on (a search, a facet value, a quick view, a matrix cell). The basis alone is no filter. */
export function filterCount(f: Filters): number {
  const lists = (['status', 'level', 'category', 'owner', 'unit', 'treatment', 'framework', 'sla', 'review', 'register'] as const).reduce((n, k) => n + f[k].length, 0);
  return lists + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0) + (f.cell ? 1 : 0);
}
export const isFiltering = (f: Filters): boolean => filterCount(f) > 0;

export interface FacetContext extends RuleContext {
  /** the earliest open-review date of each risk */
  reviews: ReadonlyMap<number, string>;
}

export function riskSpecs(ctx: FacetContext): FacetSpec<RiskRow>[] {
  const owned: Record<FacetKey, FacetSpec<RiskRow>> = {
    status: { key: 'status', values: (r) => [statusBucket(r.status)] },
    level: { key: 'level', values: (r) => [levelOf(r)] },
    category: { key: 'category', values: (r) => [categoryKey(r)] },
    owner: { key: 'owner', values: (r) => { const p = peopleOf(r); return p.length ? p.map(String) : [NO_OWNER]; } },
    unit: { key: 'unit', values: (r) => [r.business_unit_id == null ? NO_UNIT : String(r.business_unit_id)] },
    treatment: { key: 'treatment', values: (r) => [treatmentOf(r)] },
    framework: { key: 'framework', values: (r) => (r.framework_ids && r.framework_ids.length ? r.framework_ids.map(String) : [NO_FRAMEWORK]) },
    sla: { key: 'sla', values: (r) => [r.sla?.state || 'no_due_date'] },
    review: { key: 'review', values: (r) => [reviewOf(r, ctx.reviews, ctx.now).state] },
    register: { key: 'register', values: (r) => [r.register_type?.trim() || NO_REGISTER] },
  };
  return RAIL_ORDER.map((k) => owned[k]);
}

export const indexRisks = (rows: readonly RiskRow[], ctx: FacetContext): FacetIndex<RiskRow> =>
  indexRows(rows, riskSpecs(ctx), (r) => haystack(r));

export function chosenOf(f: Filters): Chosen {
  return { status: f.status, level: f.level, category: f.category, owner: f.owner, unit: f.unit, treatment: f.treatment, framework: f.framework, sla: f.sla, review: f.review, register: f.register };
}

/** What every risk must pass besides the facets: the search words, a quick view, a cell of the matrix. */
export function ruleOf(f: Filters, ctx: RuleContext): Rule<RiskRow> {
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  const cell = f.cell;
  return {
    terms: searchTerms(f.search),
    extra: quick || cell
      ? (r) => {
          if (quick && !inQuick(quick, r, ctx)) return false;
          if (cell) {
            const c = cellOf(r, f.basis);
            if (!c || c.l !== cell.l || c.i !== cell.i) return false;
          }
          return true;
        }
      : undefined,
  };
}

// ── the options of the rail ──────────────────────────────────────────────────────────────────────────────────────────────

export interface Option { value: string; label: string; title?: string }

export interface RailLookups {
  rows: readonly RiskRow[];
  people: readonly { id: number; display_name?: string | null; email?: string | null }[];
  frameworks: Readonly<Record<string, { name: string }>>;
  units: Readonly<Record<string, string>>;
}

const personName = (id: number, rows: readonly RiskRow[], people: RailLookups['people']): string => {
  const p = people.find((x) => x.id === id);
  if (p?.display_name) return p.display_name;
  for (const r of rows) {
    if (r.owner_id === id && r.owner_name) return r.owner_name;
    if (r.business_owner_id === id && r.business_owner_name) return r.business_owner_name;
  }
  return p?.email || 'Someone no longer here';
};

/** The options of every facet. The ones with values in the rows only (a category nobody uses is not offered), the words the person reads. */
export function railOptions(l: RailLookups): Record<FacetKey, Option[]> {
  const present = (pick: (r: RiskRow) => string[]): Set<string> => { const s = new Set<string>(); l.rows.forEach((r) => pick(r).forEach((v) => s.add(v))); return s; };
  const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label);

  const people = present((r) => peopleOf(r).map(String));
  const owners: Option[] = Array.from(people).map((v) => ({ value: v, label: personName(Number(v), l.rows, l.people) })).sort(byLabel);
  const units: Option[] = Array.from(present((r) => (r.business_unit_id == null ? [] : [String(r.business_unit_id)])))
    .map((v) => ({ value: v, label: l.units[v] || l.rows.find((r) => String(r.business_unit_id) === v)?.business_unit_name || 'A unit no longer here' })).sort(byLabel);
  const fws: Option[] = Array.from(present((r) => (r.framework_ids ?? []).map(String))).map((v) => ({ value: v, label: l.frameworks[v]?.name || 'A framework no longer here' })).sort(byLabel);
  const cats: Option[] = Array.from(present((r) => [categoryKey(r)])).map((v) => ({ value: v, label: categoryLabel(v) })).sort(byLabel);
  const regs: Option[] = Array.from(present((r) => [r.register_type?.trim() || NO_REGISTER])).map((v) => ({ value: v, label: v === NO_REGISTER ? 'No register type' : v })).sort(byLabel);
  return {
    status: STATUS_BUCKETS.map((v) => ({ value: v, label: BUCKET_LABEL[v] })),
    level: BANDS.map((v) => ({ value: v, label: riskLevel.label(v) })),
    category: cats,
    owner: owners.concat([{ value: NO_OWNER, label: 'No owner' }]),
    unit: units.concat([{ value: NO_UNIT, label: 'No unit' }]),
    treatment: (['not_started', 'in_progress', 'completed'] as const).map((v) => ({ value: v, label: riskTreatment.label(v) })),
    framework: fws.concat([{ value: NO_FRAMEWORK, label: 'No framework' }]),
    sla: (['breached', 'due_soon', 'on_track', 'paused', 'no_due_date', 'closed'] as const).map((v) => ({ value: v, label: riskSla.label(v) })),
    review: [
      { value: 'overdue', label: 'Overdue' }, { value: 'soon', label: 'Due in 30 days' }, { value: 'later', label: 'Later' }, { value: 'none', label: 'Not scheduled' },
    ],
    register: regs,
  };
}

/** Options in the order the rail draws them: the ones chosen stay where they are; an option nobody has is kept (dimmed, count 0) while it is chosen. */
export function orderedOptions(options: readonly Option[], chosen: readonly string[], count: (value: string) => number): Option[] {
  const have = options.filter((o) => count(o.value) > 0 || chosen.includes(o.value));
  return have.length ? have : options.slice();
}

// ── chips ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Chip { key: string; label: string; group: FacetKey | 'search' | 'quick' | 'cell'; value?: string }

export function filterChips(f: Filters, options: Record<FacetKey, Option[]>): Chip[] {
  const chips: Chip[] = [];
  if (f.search.trim()) chips.push({ key: 'search', group: 'search', label: `Search: ${f.search.trim()}` });
  if (f.quick && f.quick !== 'all') chips.push({ key: 'quick', group: 'quick', label: QUICK_LABEL[f.quick] });
  if (f.cell) chips.push({ key: 'cell', group: 'cell', label: `${f.basis === 'inherent' ? 'Inherent' : 'Residual'}: likelihood ${f.cell.l}, impact ${f.cell.i}` });
  RAIL_ORDER.forEach((g) => f[g].forEach((v) => {
    const o = options[g].find((x) => x.value === v);
    chips.push({ key: `${g}:${v}`, group: g, value: v, label: `${FACET_TITLE[g]}: ${o?.label ?? v}` });
  }));
  return chips;
}

export function removeChip(f: Filters, chip: Chip): Filters {
  if (chip.group === 'search') return { ...f, search: '' };
  if (chip.group === 'quick') return { ...f, quick: null };
  if (chip.group === 'cell') return { ...f, cell: null };
  return { ...f, [chip.group]: f[chip.group].filter((v) => v !== chip.value) } as Filters;
}
