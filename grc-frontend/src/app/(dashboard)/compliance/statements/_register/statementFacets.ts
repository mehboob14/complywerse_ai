// The Statements register's configuration of the facet explorer (components/records): which facets there are, what value(s) a statement has in each, the options the rail lists, how the
// address's filters become the explorer's choice and rule, and the chips that say what is on. Pure (no React), so `node --test` checks it and holds the engine's answer to the plain filter.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../../components/records/facetEngine.ts';
import { statementCompliance, statementPriority } from '../../../../../lib/statuses/complianceStatements.ts';
import {
  NONE, QUICK_LABEL, assigneeKey, categoryKey, categoryLabel, documentName, haystack, inQuick, priorityKey, searchTerms, type QuickId, type StatementRow, type Viewer,
} from './statementModel.ts';

export type FacetKey = 'status' | 'priority' | 'category' | 'document' | 'assignee';

export const RAIL_ORDER: readonly FacetKey[] = ['status', 'priority', 'category', 'document', 'assignee'];
export const FACET_TITLE: Record<FacetKey, string> = { status: 'Status', priority: 'Priority', category: 'Category', document: 'Document', assignee: 'Assigned to' };
export const OPEN_AT_FIRST: readonly FacetKey[] = ['status', 'priority'];
export const SEARCHABLE: readonly FacetKey[] = ['category', 'document', 'assignee'];

export interface Filters {
  search: string;
  status: string[];
  priority: string[];
  category: string[];
  document: string[];
  assignee: string[];
  quick: QuickId | null;
}
export const NO_FILTERS: Filters = { search: '', status: [], priority: [], category: [], document: [], assignee: [], quick: null };

export function filterCount(f: Filters): number {
  return RAIL_ORDER.reduce((n, k) => n + f[k].length, 0) + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0);
}
export const isFiltering = (f: Filters): boolean => filterCount(f) > 0;

export function statementSpecs(): FacetSpec<StatementRow>[] {
  const owned: Record<FacetKey, FacetSpec<StatementRow>> = {
    status: { key: 'status', values: (r) => [r.compliance_status || 'not_assessed'] },
    priority: { key: 'priority', values: (r) => [priorityKey(r)] },
    category: { key: 'category', values: (r) => [categoryKey(r)] },
    document: { key: 'document', values: (r) => [String(r.document_id)] },
    assignee: { key: 'assignee', values: (r) => [assigneeKey(r)] },
  };
  return RAIL_ORDER.map((k) => owned[k]);
}

export const indexStatements = (rows: readonly StatementRow[]): FacetIndex<StatementRow> => indexRows(rows, statementSpecs(), (r) => haystack(r));

export function chosenOf(f: Filters): Chosen {
  return { status: f.status, priority: f.priority, category: f.category, document: f.document, assignee: f.assignee };
}

/** What every statement must pass besides the facets: the search words and a quick view. */
export function ruleOf(f: Filters, viewer: Viewer): Rule<StatementRow> {
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  return { terms: searchTerms(f.search), extra: quick ? (r) => inQuick(quick, r, viewer) : undefined };
}

// ── the options of the rail ──────────────────────────────────────────────────────────────────────────────────────────────
export interface Option { value: string; label: string; title?: string }
const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label);

/** The options of every facet. Status and priority are the words the server knows; category, document and assignee are the ones the statements have. */
export function railOptions(rows: readonly StatementRow[]): Record<FacetKey, Option[]> {
  const categories = new Set<string>();
  const documents = new Map<string, string>();
  const people = new Map<string, string>();
  let noPriority = false;
  let noOne = false;
  rows.forEach((r) => {
    categories.add(categoryKey(r));
    documents.set(String(r.document_id), documentName(r));
    if (priorityKey(r) === NONE) noPriority = true;
    if (r.assigned_to_user_id == null) noOne = true;
    else people.set(String(r.assigned_to_user_id), (r.assignee_name ?? '').trim() || 'Someone no longer here');
  });
  const named = (m: Map<string, string>): Option[] => Array.from(m.entries()).map(([value, label]) => ({ value, label })).sort(byLabel);
  return {
    status: statementCompliance.words.map((v) => ({ value: v, label: statementCompliance.label(v) })),
    priority: statementPriority.words.map((v) => ({ value: v, label: statementPriority.label(v) })).concat(noPriority ? [{ value: NONE, label: 'No priority' }] : []),
    category: Array.from(categories).filter((c) => c !== NONE).map((v) => ({ value: v, label: categoryLabel(v) })).sort(byLabel).concat(categories.has(NONE) ? [{ value: NONE, label: categoryLabel(NONE) }] : []),
    document: named(documents),
    assignee: named(people).concat(noOne ? [{ value: NONE, label: 'Unassigned' }] : []),
  };
}

/** Options in the order the rail draws them: an option nobody has is dropped unless it is chosen (then it stays, dimmed, with a 0). */
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
