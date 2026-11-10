// The report workspace's rules as pure functions (builderModel.test.ts): how a saved report is opened, what a sort click does, what a filter chip says, what the gap shortcuts toggle, how fields
// picked in the Add fields sheet are merged into the report, when changing module must ask first, whether the report has unsaved changes, and the key figures above the table.
// ReportWorkspace and the rail only draw and call these. Nothing here fetches; the formulas of the key figures are the ones the old builder used (audit 5.1), moved here unchanged.
import { formatCount } from '../../../../../lib/format.ts';
import { emptySpec, type ColumnDef, type FilterRule, type FilterRules, type ReportSpec, type Row, type SortSpec } from '../../_reports/types.ts';
import { EMPTY_TOKEN, decodeMultiValue, encodeMultiValue, isCountColumn } from '../../_reports/filter-utils.ts';
import { isActiveCondition } from '../../_reports/grid-utils.ts';

/** "Risk Management · Risk Register"; the module alone when the register carries its name ("Critical Tasks · Critical Tasks" reads as a stutter). */
export const moduleLine = (module: string, label: string): string => (module === label ? module : `${module} · ${label}`);

/* ── opening a report ───────────────────────────────────────────────────────────────────────────────────── */

/** The state the workspace starts from: a saved report (or a blank one on a module) with every list the builder reads present. The body view always opens as the table (it was never saved). */
export function workingSpec(initial: ReportSpec | null | undefined, datasetKey: string): ReportSpec {
  const base = initial ?? emptySpec(datasetKey);
  return {
    ...base,
    view: 'table',
    description: base.description ?? '',
    visibleColumns: Array.isArray(base.visibleColumns) ? base.visibleColumns : [],
    columnWidths: base.columnWidths ?? {},
    columnAlign: base.columnAlign ?? {},
    pinnedColumns: base.pinnedColumns ?? [],
    sorts: base.sorts ?? [],
    rows: base.rows ?? [],
    measures: Array.isArray(base.measures) ? base.measures : [],
    rules: base.rules ?? { logic: 'AND', conditions: [] },
    search: base.search ?? '',
  };
}

/** The part of a report that Save writes: what makes two states of the workspace the same report. The body view, the time of the last save and who owns it are not part of it. */
export function savedShape(spec: ReportSpec): string {
  return JSON.stringify([
    spec.name.trim(), (spec.description ?? '').trim(), spec.dataset, spec.visibleColumns ?? [], spec.rules, spec.search, spec.sorts ?? [], spec.rows ?? [], spec.col, spec.measures,
    spec.measureIdx, spec.calcColumns ?? [], !!spec.shared, spec.columnWidths ?? {}, spec.columnAlign ?? {}, spec.pinnedColumns ?? [], spec.showLegend, spec.showLabels,
  ]);
}

/** Whether the workspace holds changes that were not saved. A new report counts as changed once it has a column, a rule, a summary or a name. */
export function hasUnsaved(current: ReportSpec, saved: ReportSpec | null): boolean {
  if (saved) return savedShape(current) !== savedShape(saved);
  return (current.visibleColumns?.length ?? 0) > 0 || current.rules.conditions.some(isActiveCondition) || current.search.trim() !== '' || current.measures.length > 0 || current.name.trim() !== '';
}

/** Changing module throws away columns, filters and the summary: ask first when there is anything to lose. */
export function switchNeedsConfirm(spec: ReportSpec, fromKey: string | null, toKey: string): boolean {
  if (!fromKey || fromKey === toKey) return false;
  return (spec.visibleColumns?.length ?? 0) > 0 || spec.rules.conditions.some(isActiveCondition) || spec.search.trim() !== '' || spec.measures.length > 0;
}

/* ── sort ────────────────────────────────────────────────────────────────────────────────────────────────── */

/** What clicking a column header does: a plain click goes ascending, descending, off; with Shift the column joins (or leaves) the sort. */
export function toggleSort(current: readonly SortSpec[], key: string, additive: boolean): SortSpec[] {
  const existing = current.find((s) => s.key === key);
  if (!additive) {
    if (!existing) return [{ key, dir: 'asc' }];
    if (existing.dir === 'asc') return [{ key, dir: 'desc' }];
    return [];
  }
  if (!existing) return [...current, { key, dir: 'asc' }];
  if (existing.dir === 'asc') return current.map((s) => (s.key === key ? { ...s, dir: 'desc' as const } : s));
  return current.filter((s) => s.key !== key);
}

/** The one sort the rail's Sort choice holds: "key:dir" or '' for none. */
export const sortChoice = (sorts: readonly SortSpec[] | undefined): string => (sorts?.[0] ? `${sorts[0].key}:${sorts[0].dir}` : '');
export function sortFromChoice(value: string): SortSpec[] {
  if (!value) return [];
  const at = value.lastIndexOf(':');
  const dir = value.slice(at + 1);
  return at > 0 && (dir === 'asc' || dir === 'desc') ? [{ key: value.slice(0, at), dir }] : [];
}

/* ── filters ─────────────────────────────────────────────────────────────────────────────────────────────── */

const OP_WORDS: Record<string, string> = {
  contains: 'contains', notcontains: 'does not contain', eq: 'is', neq: 'is not', starts: 'starts with', empty: 'is empty', notempty: 'is not empty',
  gt: 'greater than', gte: 'greater or equal', lt: 'less than', lte: 'less or equal', on: 'on', before: 'before', after: 'after',
  linked: 'is linked to any', notlinked: 'is not linked to any', in: 'is any of', notin: 'is none of',
};
export const opLabel = (op: string): string => OP_WORDS[op] || op;

/** "Linked: Evidence" is read as "Evidence". */
export const gapModuleLabel = (label: string): string => label.replace(/^Linked:\s*/i, '');

const NO_VALUE_OPS = ['empty', 'notempty', 'linked', 'notlinked'];

/** What a filter chip says. A link check reads as a sentence ("No Evidence linked"), a pick list shows the first three values and "+N", a count of zero reads "= 0". */
export function conditionText(c: FilterRule, col: ColumnDef | undefined): string {
  const label = col?.label || c.col;
  if (col?.type === 'linkage') return `${c.op === 'notlinked' ? 'No' : 'Has'} ${gapModuleLabel(col.label)} linked`;
  if (c.op === 'in' || c.op === 'notin') {
    const parts = decodeMultiValue(c.value).map((p) => (p === EMPTY_TOKEN ? '(none)' : p));
    return `${label} ${opLabel(c.op)} ${parts.slice(0, 3).join(', ')}${parts.length > 3 ? ` +${parts.length - 3}` : ''}`;
  }
  if (isCountColumn(col) && c.op === 'eq' && c.value === '0') return `${label} = 0`;
  return `${label} ${opLabel(c.op)}${!NO_VALUE_OPS.includes(c.op) && c.value ? ` ${c.value}` : ''}`;
}

/** A gap shortcut: "nothing linked in X" (`gap`) or "X count is 0" (`zero`), added when absent and removed when present. The other conditions that are filled in are kept. */
export function toggleShortcut(rules: FilterRules, kind: 'gap' | 'zero', colKey: string): FilterRules {
  const existing = rules.conditions.find((c) => c.col === colKey && (kind === 'gap' ? c.op === 'notlinked' : c.op === 'eq' && c.value === '0'));
  const conditions = existing
    ? rules.conditions.filter((c) => c.id !== existing.id)
    : [...rules.conditions.filter(isActiveCondition), kind === 'gap' ? { id: `gap_${colKey}`, col: colKey, op: 'notlinked', value: '' } : { id: `cnt0_${colKey}`, col: colKey, op: 'eq', value: '0' }];
  return { ...rules, conditions };
}

export const withoutCondition = (rules: FilterRules, id: string): FilterRules => ({ ...rules, conditions: rules.conditions.filter((c) => c.id !== id) });

/* ── adding fields ───────────────────────────────────────────────────────────────────────────────────────── */

export type Picks = Record<string, string[]>;
type XmodParts = { dataset: string; field: string } | null;

/** The fields of the report as "module -> fields" picks (the Add fields sheet opens with them ticked): this module's own columns, and other modules' fields through `parseXmod`. */
export function picksFromVisible(visibleKeys: readonly string[], datasetKey: string, ownKeys: ReadonlySet<string>, parseXmod: (key: string) => XmodParts): Picks {
  const picks: Picks = {};
  for (const k of visibleKeys) {
    const x = parseXmod(k);
    if (x) { picks[x.dataset] = [...(picks[x.dataset] || []), x.field]; continue; }
    if (ownKeys.has(k)) picks[datasetKey] = [...(picks[datasetKey] || []), k];
  }
  return picks;
}

const pickedKey = (modKey: string, colKey: string, datasetKey: string, xmod: (m: string, c: string) => string): string => (modKey === datasetKey ? colKey : xmod(modKey, colKey));

/** How many of the ticked fields are NOT on the report yet ("Add 2 fields": the sheet opens with the current ones ticked, so the raw count would read as "Add 12"). */
export function newFieldCount(picks: Picks, visibleKeys: readonly string[], datasetKey: string, xmod: (m: string, c: string) => string): number {
  const current = new Set(visibleKeys);
  let n = 0;
  Object.keys(picks).forEach((mod) => picks[mod].forEach((c) => { if (!current.has(pickedKey(mod, c, datasetKey, xmod))) n += 1; }));
  return n;
}

/**
 * The columns after Apply in the Add fields sheet. It MERGES, it does not replace: a column the sheet cannot show (a linked aggregate or a server-catalog field, which come from the Links tab) is carried
 * through, every column that stays keeps its position (a reorder is not lost), and newly ticked fields are appended in the order of the picks.
 */
export function mergeAddedFields(visibleKeys: readonly string[], picks: Picks, datasetKey: string, ownKeys: ReadonlySet<string>, parseXmod: (key: string) => XmodParts, xmod: (m: string, c: string) => string): string[] {
  const picked = new Set<string>();
  Object.keys(picks).forEach((mod) => picks[mod].forEach((c) => picked.add(pickedKey(mod, c, datasetKey, xmod))));
  const unrepresentable = (k: string) => !parseXmod(k) && !ownKeys.has(k);
  const kept = visibleKeys.filter((k) => picked.has(k) || unrepresentable(k));
  const added = Array.from(picked).filter((k) => !visibleKeys.includes(k));
  return [...kept, ...added];
}

export function togglePick(picks: Picks, moduleKey: string, colKey: string): Picks {
  const cur = new Set(picks[moduleKey] || []);
  if (cur.has(colKey)) cur.delete(colKey); else cur.add(colKey);
  const next = { ...picks, [moduleKey]: Array.from(cur) };
  if (next[moduleKey].length === 0) delete next[moduleKey];
  return next;
}

/* ── the key figures above the table ─────────────────────────────────────────────────────────────────────── */

export type FactTone = 'default' | 'success' | 'warning' | 'danger';
export interface Fact { label: string; value: string; tone: FactTone }

export interface FactsInput {
  datasetKey: string;
  /** every row the report loaded, before the filters the browser applies */
  rows: readonly Row[];
  /** the rows that match */
  matching: readonly Row[];
  /** set in summary mode: the groups, the rows they summarise (null when the server did the summing: it does not say), and the first calculation's grand total */
  summary: { groups: number; sourceRows: number | null; grand: { label: string; value: unknown } | null } | null;
}

const yes = (v: unknown): boolean => String(v ?? '').toLowerCase() === 'yes' || v === true;
const grandText = (g: unknown): string => (typeof g === 'number' ? (Number.isInteger(g) ? formatCount(g) : g.toFixed(1)) : String(g));

/** At most four figures: the rows and the rows that match, then what matters for the module (a figure is left out when it is zero). In summary mode: the groups, the source rows and the first total. */
export function keyFacts({ datasetKey, rows, matching, summary }: FactsInput, now: Date = new Date()): Fact[] {
  if (summary) {
    const facts: Fact[] = [{ label: 'Summary groups', value: formatCount(summary.groups), tone: 'default' }];
    if (summary.sourceRows !== null) facts.unshift({ label: 'Source rows', value: formatCount(summary.sourceRows), tone: 'default' });
    if (summary.grand && summary.grand.value != null) facts.push({ label: summary.grand.label, value: grandText(summary.grand.value), tone: 'success' });
    return facts.slice(0, 4);
  }
  if (rows.length === 0) return [];
  const total = rows.length;
  const filtered = matching.length;
  const facts: Fact[] = [
    { label: 'Total rows', value: formatCount(total), tone: 'default' },
    { label: 'Matching filters', value: formatCount(filtered), tone: filtered < total ? 'warning' : 'default' },
  ];
  const add = (label: string, n: number, tone: FactTone) => { if (n > 0) facts.push({ label, value: formatCount(n), tone }); };
  if (datasetKey === 'risks') {
    add('High residual (≥15)', rows.filter((r) => Number(r.residual_score) >= 15).length, 'danger');
    add('Open risks', rows.filter((r) => String(r.closure_status ?? '').toLowerCase() === 'open').length, 'warning');
  } else if (datasetKey === 'controls' || datasetKey === 'internal_controls') {
    add('No owner', rows.filter((r) => !r.control_owner && !r.owner_name).length, 'danger');
  } else if (datasetKey === 'evidence') {
    add('Stale', rows.filter((r) => yes(r.is_stale)).length, 'danger');
    add('Unlinked', rows.filter((r) => Number(r.control_mappings_count ?? 0) === 0).length, 'warning');
  } else if (datasetKey === 'issues') {
    add('SLA breached', rows.filter((r) => yes(r.sla_breached)).length, 'danger');
    add('Unassigned', rows.filter((r) => !r.assignee && !r.assignee_name).length, 'warning');
  } else if (datasetKey === 'tasks') {
    add('Overdue', rows.filter((r) => r.due_date && new Date(String(r.due_date)) < now && String(r.status ?? '').toLowerCase() !== 'done').length, 'danger');
  } else if (datasetKey === 'vulnerabilities') {
    add('KEV flagged', rows.filter((r) => yes(r.kev_flag)).length, 'danger');
    add('Critical/High', rows.filter((r) => /(crit|high)/i.test(String(r.severity ?? ''))).length, 'danger');
  } else if (datasetKey === 'vendors') {
    add('High-risk', rows.filter((r) => /(crit|high)/i.test(String(r.tier ?? r.risk_rating ?? ''))).length, 'danger');
  } else if (datasetKey === 'regulatory_changes') {
    add('Unaddressed', rows.filter((r) => Number(r.task_count ?? 0) === 0 && Number(r.gap_count ?? 0) === 0).length, 'warning');
  } else if (datasetKey === 'exceptions') {
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    add('Expiring soon', rows.filter((r) => {
      if (!r.expires_at) return false;
      const exp = new Date(String(r.expires_at));
      return exp <= in30 && exp >= now;
    }).length, 'warning');
  }
  return facts.slice(0, 4);
}

/* ── opening a report from a dashboard's click ───────────────────────────────────────────────────────────── */

/**
 * A dashboard chart's click opens the report narrowed to the category that was clicked: one more condition on a COPY of the report, visible, removable and never saved unless the person saves.
 * The filter list is one flat AND/OR list, so it cannot say "(A or B) and category": narrowing a report that combines with OR would silently turn it into a different, smaller set. Such a report
 * opens as saved and `refused` is true (the page says so).
 */
export function drillNarrow(found: ReportSpec, col: string | null, value: string | null, stamp: string = Date.now().toString(36)): { spec: ReportSpec; refused: boolean } {
  if (!col || value == null) return { spec: found, refused: false };
  const canNarrow = found.rules.logic === 'AND' || found.rules.conditions.filter(isActiveCondition).length <= 1;
  if (!canNarrow) return { spec: found, refused: true };
  return {
    refused: false,
    spec: {
      ...found,
      rules: {
        ...found.rules,
        logic: 'AND',
        // the pivot labels a blank group "—"; the filter spells blank as EMPTY_TOKEN
        conditions: [...found.rules.conditions, { id: `drill_${stamp}`, col, op: 'in', value: encodeMultiValue([value === '—' ? EMPTY_TOKEN : value]) }],
      },
    },
  };
}
