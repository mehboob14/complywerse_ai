// The Changes register's configuration of the facet explorer (components/records): which facets a change has, what value(s) it holds in each, the quick views, the options the rail lists,
// the chips, the search and the order. Pure (no React) so `node --test` holds it (changeFacets.test.ts), and held to the plain filter by a test.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../../components/records/facetEngine.ts';
import { priority } from '../../../../../lib/status.ts';
import { changeStatus } from '../../../../../lib/statuses/regulatory.ts';
import { BUCKETS, BUCKET_LABEL, EFFECTIVE_LABEL, bucketOf, effectiveOf, isOpen, isReading, regulatorName, type Effective } from '../_lib/regulatoryModel.ts';
import type { ChangeRow, Person } from '../_lib/types.ts';

export type FacetKey = 'status' | 'priority' | 'regulator' | 'owner' | 'effective' | 'work';
export const RAIL_ORDER: readonly FacetKey[] = ['status', 'priority', 'regulator', 'owner', 'effective', 'work'];
export const FACET_TITLE: Record<FacetKey, string> = { status: 'Status', priority: 'Priority', regulator: 'Regulator', owner: 'Owner', effective: 'Takes effect', work: 'Needs' };
export const OPEN_AT_FIRST: readonly FacetKey[] = ['status', 'priority', 'regulator', 'work'];
export const SEARCHABLE: readonly FacetKey[] = ['owner'];
export const NO_OWNER = 'none';
export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

export const QUICK_IDS = ['all', 'open', 'mine', 'soon', 'late', 'reading'] as const;
export type QuickId = (typeof QUICK_IDS)[number];
export const QUICK_LABEL: Record<QuickId, string> = {
  all: 'All', open: 'In progress', mine: 'Assigned to me', soon: 'Takes effect in 30 days', late: 'Tasks late', reading: 'AI reading',
};

/** The values of the work facet: what a change waits for. */
export const WORK_IDS = ['late', 'tocheck', 'suggestions', 'unmet', 'no_tasks', 'reading'] as const;
export type WorkId = (typeof WORK_IDS)[number];
export const WORK_LABEL: Record<WorkId, string> = {
  late: 'Tasks late', tocheck: 'Obligations to check', suggestions: 'Control suggestions to confirm', unmet: 'Not all met by a control', no_tasks: 'No tasks yet', reading: 'AI is reading',
};

export interface Filters {
  search: string;
  status: string[];
  priority: string[];
  regulator: string[];
  owner: string[];
  effective: string[];
  work: string[];
  quick: QuickId | null;
}
export const NO_FILTERS: Filters = { search: '', status: [], priority: [], regulator: [], owner: [], effective: [], work: [], quick: null };

/** What filters are on (a search, a facet value, a quick view). */
export function filterCount(f: Filters): number {
  return RAIL_ORDER.reduce((n, k) => n + f[k].length, 0) + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0);
}
export const isFiltering = (f: Filters): boolean => filterCount(f) > 0;

export interface RuleContext { me: number | null; today: Date }

export function workOf(c: ChangeRow): WorkId[] {
  const out: WorkId[] = [];
  if (isOpen(c.status)) {
    if ((c.late_task_count ?? 0) > 0) out.push('late');
    if ((c.to_check_count ?? 0) > 0) out.push('tocheck');
    if ((c.suggestion_count ?? 0) > 0) out.push('suggestions');
    if ((c.obligation_count ?? 0) > (c.met_count ?? 0)) out.push('unmet');
    if ((c.task_count ?? 0) === 0 && c.status !== 'identified' && !isReading(c)) out.push('no_tasks');
    if (isReading(c)) out.push('reading');
  }
  return out;
}

export function inQuick(id: QuickId, c: ChangeRow, ctx: RuleContext): boolean {
  switch (id) {
    case 'all': return true;
    case 'open': return isOpen(c.status);
    case 'mine': return ctx.me != null && c.assigned_to === ctx.me;
    case 'soon': return isOpen(c.status) && effectiveOf(c.effective_date, ctx.today) === 'soon';
    case 'late': return (c.late_task_count ?? 0) > 0 && isOpen(c.status);
    case 'reading': return isReading(c);
    default: return true;
  }
}

export function changeSpecs(ctx: RuleContext): FacetSpec<ChangeRow>[] {
  const owned: Record<FacetKey, FacetSpec<ChangeRow>> = {
    status: { key: 'status', values: (c) => [bucketOf(c.status)] },
    priority: { key: 'priority', values: (c) => [c.priority] },
    regulator: { key: 'regulator', values: (c) => [c.source] },
    owner: { key: 'owner', values: (c) => [c.assigned_to ? String(c.assigned_to) : NO_OWNER] },
    effective: { key: 'effective', values: (c) => [effectiveOf(c.effective_date, ctx.today)] },
    work: { key: 'work', values: (c) => workOf(c) },
  };
  return RAIL_ORDER.map((k) => owned[k]);
}

const fold = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
export const searchTerms = (q: string): string[] => fold(q).split(/\s+/).filter(Boolean);
export const haystack = (c: ChangeRow): string =>
  fold([c.title, c.reference_number || '', c.source, regulatorName(c.source), c.assignee_name || '', c.description || ''].join(' \n '));

export const indexChanges = (rows: readonly ChangeRow[], ctx: RuleContext): FacetIndex<ChangeRow> => indexRows(rows, changeSpecs(ctx), haystack);

export const chosenOf = (f: Filters): Chosen => ({ status: f.status, priority: f.priority, regulator: f.regulator, owner: f.owner, effective: f.effective, work: f.work });

/** What every change must pass besides the facets: the search words and the quick view. */
export function ruleOf(f: Filters, ctx: RuleContext): Rule<ChangeRow> {
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  return { terms: searchTerms(f.search), extra: quick ? (c) => inQuick(quick, c, ctx) : undefined };
}

// ── the options of the rail ──────────────────────────────────────────────────────────────────────────────────────────────

export interface Option { value: string; label: string }

export interface RailLookups { rows: readonly ChangeRow[]; people: readonly Person[] }

export function railOptions(l: RailLookups): Record<FacetKey, Option[]> {
  const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label);
  const sources = Array.from(new Set(l.rows.map((r) => r.source)));
  const owners = Array.from(new Set(l.rows.map((r) => r.assigned_to).filter((x): x is number => !!x))).map((id) => ({
    value: String(id), label: l.people.find((p) => p.id === id)?.display_name || l.rows.find((r) => r.assigned_to === id)?.assignee_name || 'Someone no longer here',
  })).sort(byLabel);
  return {
    status: BUCKETS.map((b) => ({ value: b, label: BUCKET_LABEL[b] })),
    priority: PRIORITIES.map((p) => ({ value: p, label: priority.label(p) })),
    regulator: sources.map((s) => ({ value: s, label: regulatorName(s) })).sort(byLabel),
    owner: owners.concat([{ value: NO_OWNER, label: 'Unassigned' }]),
    effective: (['past', 'soon', 'later', 'none'] as Effective[]).map((e) => ({ value: e, label: EFFECTIVE_LABEL[e] })),
    work: WORK_IDS.map((w) => ({ value: w, label: WORK_LABEL[w] })),
  };
}

/** Options the rail draws: the ones with records, and any that is chosen (dimmed, count 0). */
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
    chips.push({ key: `${g}:${v}`, group: g, value: v, label: `${FACET_TITLE[g]}: ${options[g].find((x) => x.value === v)?.label ?? v}` });
  }));
  return chips;
}

export function removeChip(f: Filters, chip: Chip): Filters {
  if (chip.group === 'search') return { ...f, search: '' };
  if (chip.group === 'quick') return { ...f, quick: null };
  return { ...f, [chip.group]: f[chip.group].filter((v) => v !== chip.value) } as Filters;
}

// ── the order ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SORT_KEYS = ['created', 'effective', 'title', 'priority', 'status'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'created', dir: 'desc' };
export const SORT_LABEL: Record<SortKey, string> = { created: 'Newest', effective: 'Takes effect', title: 'Title', priority: 'Priority', status: 'Status' };
/** The direction a column starts in when it is first pressed. */
const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = { created: 'desc', effective: 'asc', title: 'asc', priority: 'asc', status: 'asc' };

export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_RANK = (s: string): number => (BUCKETS as readonly string[]).indexOf(bucketOf(s));

/** Sorted copy. A change with no effective date goes last whichever way the dates run; ties keep the newest first. */
export function sortChanges(rows: readonly ChangeRow[], sort: Sort): ChangeRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const newest = (a: ChangeRow, b: ChangeRow) => (b.created_at || '').localeCompare(a.created_at || '') || b.id - a.id;
  const by = (a: ChangeRow, b: ChangeRow): number => {
    switch (sort.key) {
      case 'created': return sign * ((a.created_at || '').localeCompare(b.created_at || '') || a.id - b.id);
      case 'effective': {
        const x = (a.effective_date || '').slice(0, 10);
        const y = (b.effective_date || '').slice(0, 10);
        if (!x || !y) return x === y ? 0 : x ? -1 : 1;
        return sign * x.localeCompare(y);
      }
      case 'title': return sign * a.title.localeCompare(b.title);
      case 'priority': return sign * ((PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
      case 'status': return sign * (STATUS_RANK(a.status) - STATUS_RANK(b.status));
      default: return 0;
    }
  };
  return rows.slice().sort((a, b) => by(a, b) || newest(a, b));
}

// ── export ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const cell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The changes as a CSV a person can open in a spreadsheet (what the list shows, in words). */
export function toCsv(rows: readonly ChangeRow[]): string {
  const head = ['Title', 'Regulator', 'Reference', 'Status', 'Priority', 'Takes effect', 'Owner', 'Obligations', 'Met by a control', 'Tasks', 'Tasks done', 'Tasks late'];
  const lines = rows.map((c) => [
    c.title, regulatorName(c.source), c.reference_number ?? '', changeStatus.label(c.status), priority.label(c.priority), (c.effective_date || '').slice(0, 10), c.assignee_name ?? '',
    c.obligation_count ?? '', c.met_count ?? '', c.task_count ?? 0, c.completed_task_count ?? 0, c.late_task_count ?? 0,
  ].map(cell).join(','));
  return `\uFEFF${[head.join(',')].concat(lines).join('\r\n')}\r\n`;
}

export const exportName = (isoDay: string, n: number): string => `regulatory-changes-${isoDay}-${n}.csv`;
