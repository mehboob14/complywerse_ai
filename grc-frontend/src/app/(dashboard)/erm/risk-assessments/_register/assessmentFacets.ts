// The Risk Assessments home's configuration of the facet explorer (components/records): which facets there are, what value(s) an assessment has in each, the options the rail lists, how
// the address's filters become the explorer's choice and rule, and the chips that say what is on. Pure (no React); assessmentFacets.test.ts holds the engine's answer to the plain filter.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../../components/records/facetEngine.ts';
import { NO_FRAMEWORK, NO_OWNER, QUICK_LABEL, STAGES, STAGE_LABEL, haystack, inQuick, searchTerms, stageOf, type AssessmentRow, type Filters, type RuleContext } from './assessmentModel.ts';

export type FacetKey = 'kind' | 'status' | 'owner' | 'framework';
export const RAIL_ORDER: readonly FacetKey[] = ['kind', 'status', 'owner', 'framework'];
export const FACET_TITLE: Record<FacetKey, string> = { kind: 'Kind', status: 'Stage', owner: 'Owner', framework: 'Framework' };
export const OPEN_AT_FIRST: readonly FacetKey[] = ['kind', 'status', 'owner'];
export const SEARCHABLE: readonly FacetKey[] = ['owner', 'framework'];
export const KIND_LABEL = { manual: 'Manual (risks from the register)', framework: 'Framework (questions)' } as const;

export function assessmentSpecs(): FacetSpec<AssessmentRow>[] {
  const owned: Record<FacetKey, FacetSpec<AssessmentRow>> = {
    kind: { key: 'kind', values: (r) => [r.kind] },
    status: { key: 'status', values: (r) => [stageOf(r.kind, r.status)] },
    owner: { key: 'owner', values: (r) => [r.owner_id == null ? NO_OWNER : String(r.owner_id)] },
    framework: { key: 'framework', values: (r) => [r.framework_name?.trim() || NO_FRAMEWORK] },
  };
  return RAIL_ORDER.map((k) => owned[k]);
}

export const indexAssessments = (rows: readonly AssessmentRow[]): FacetIndex<AssessmentRow> => indexRows(rows, assessmentSpecs(), (r) => haystack(r));

export function chosenOf(f: Filters): Chosen {
  return { kind: f.kind, status: f.status, owner: f.owner, framework: f.framework };
}

/** What every assessment must pass besides the facets: the search words and a quick view. */
export function ruleOf(f: Filters, ctx: RuleContext): Rule<AssessmentRow> {
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  return { terms: searchTerms(f.search), extra: quick ? (r) => inQuick(quick, r, ctx) : undefined };
}

export interface Option { value: string; label: string }

/** The options of every facet: only the values the rows have (an owner nobody has is not offered), the words the person reads. */
export function railOptions(rows: readonly AssessmentRow[]): Record<FacetKey, Option[]> {
  const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label);
  const owners = new Map<string, string>();
  const fws = new Set<string>();
  rows.forEach((r) => {
    if (r.owner_id != null) owners.set(String(r.owner_id), r.owner_name?.trim() || 'Someone no longer here');
    if (r.framework_name?.trim()) fws.add(r.framework_name.trim());
  });
  return {
    kind: [{ value: 'manual', label: KIND_LABEL.manual }, { value: 'framework', label: KIND_LABEL.framework }],
    status: STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] })),
    owner: Array.from(owners.entries()).map(([value, label]) => ({ value, label })).sort(byLabel).concat([{ value: NO_OWNER, label: 'No owner' }]),
    framework: Array.from(fws).map((label) => ({ value: label, label })).sort(byLabel).concat([{ value: NO_FRAMEWORK, label: 'No framework' }]),
  };
}

/** Options in the order the rail draws them: the ones with rows, plus any that is chosen (dimmed, count 0). */
export function orderedOptions(options: readonly Option[], chosen: readonly string[], count: (value: string) => number): Option[] {
  const have = options.filter((o) => count(o.value) > 0 || chosen.includes(o.value));
  return have.length ? have : options.slice();
}

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
