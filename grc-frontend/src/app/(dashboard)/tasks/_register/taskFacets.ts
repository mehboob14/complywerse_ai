// The All tasks register's configuration of the facet explorer (components/records): which facets there are, what value(s) a task has in each, the quick views and the number each shows, the
// options the rail lists, how the filters become the explorer's choice and rule, the search words, the sort and the grouping, and the chips that say what is on. Pure (no React), so
// `node --test` checks it (taskFacets.test.ts) and holds the engine's answer to the plain filter below it.
// "Overdue", "mine" and "to approve" come from taskRecord.ts, the model every Task Management screen shares, so a number here is the number on My work.
import { indexRows, type Chosen, type FacetIndex, type FacetSpec, type Rule } from '../../../../components/records/facetEngine.ts';
import { norm } from '../../../../lib/status.ts';
import { taskPriority, taskSla, taskStatus } from '../../../../lib/statuses/tasks.ts';
import {
  DUE_BUCKETS, DUE_LABEL, KINDS, KIND_LABEL, dueBucket, dueMoment, isDoneStatus, isMyWork, kindOf, nextStep, peopleOf, type DueBucket, type RegisterTask,
} from '../taskRecord.ts';
import { PRIORITIES, STATUSES } from '../tasksModel.ts';

export type FacetKey = 'status' | 'priority' | 'due' | 'sla' | 'kind' | 'source' | 'category' | 'owner' | 'reviewer' | 'creator' | 'approval' | 'repeats' | 'linked';

/** The facets in the order the rail lists them. */
export const RAIL_ORDER: readonly FacetKey[] = ['status', 'priority', 'due', 'sla', 'kind', 'source', 'category', 'owner', 'reviewer', 'creator', 'approval', 'repeats', 'linked'];
export const FACET_TITLE: Record<FacetKey, string> = {
  status: 'Status', priority: 'Priority', due: 'Due', sla: 'SLA', kind: 'Kind', source: 'Source', category: 'Category', owner: 'Owner', reviewer: 'Reviewer', creator: 'Created by',
  approval: 'Approval', repeats: 'Repeats', linked: 'Linked record',
};
/** Open with the rail; the others are one press away. */
export const OPEN_AT_FIRST: readonly FacetKey[] = ['status', 'priority', 'due', 'owner'];
export const SEARCHABLE: readonly FacetKey[] = ['owner', 'reviewer', 'creator', 'source', 'category'];

/** the value of "nobody" / "nothing" in a facet */
export const NONE = 'none';

export interface Filters {
  search: string;
  status: string[];
  priority: string[];
  due: string[];
  sla: string[];
  kind: string[];
  source: string[];
  category: string[];
  owner: string[];
  reviewer: string[];
  creator: string[];
  approval: string[];
  repeats: string[];
  linked: string[];
  quick: QuickId | null;
}

export const NO_FILTERS: Filters = {
  search: '', status: [], priority: [], due: [], sla: [], kind: [], source: [], category: [], owner: [], reviewer: [], creator: [], approval: [], repeats: [], linked: [], quick: null,
};

/** What filters are on (a search, a facet value, a quick view). */
export function filterCount(f: Filters): number {
  return RAIL_ORDER.reduce((n, k) => n + f[k].length, 0) + (f.search.trim() ? 1 : 0) + (f.quick && f.quick !== 'all' ? 1 : 0);
}
export const isFiltering = (f: Filters): boolean => filterCount(f) > 0;

// ── values ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A status as the server names it: the workflow's own spelling when it is one of them (so an old `?status=In Progress` link and the server's filter agree), else the word as written. */
export const statusValue = (status: string): string => STATUSES.filter((s) => norm(s) === norm(status))[0] ?? (status || NONE);
export const priorityValue = (priority: string): string => PRIORITIES.filter((p) => norm(p) === norm(priority))[0] ?? (priority || NONE);

export const APPROVAL_ORDER = ['not_needed', 'not_requested', 'pending', 'approved', 'rejected'] as const;
export const APPROVAL_LABEL: Record<(typeof APPROVAL_ORDER)[number], string> = {
  not_needed: 'Not needed', not_requested: 'Not asked yet', pending: 'Waiting for a decision', approved: 'Approved', rejected: 'Not approved',
};
export function approvalValue(t: Pick<RegisterTask, 'approval_required' | 'approval_status'>): string {
  if (!t.approval_required) return 'not_needed';
  return t.approval_status ? norm(t.approval_status) : 'not_requested';
}

const SLA_ORDER = ['on_track', 'at_risk', 'breached', 'completed', 'no_sla'];

export type QuickId = 'all' | 'mine' | 'overdue' | 'week' | 'approve' | 'created' | 'unassigned' | 'documents';
export const QUICK_IDS: readonly QuickId[] = ['all', 'mine', 'overdue', 'week', 'approve', 'created', 'unassigned', 'documents'];
export const QUICK_LABEL: Record<QuickId, string> = {
  all: 'All', mine: 'Mine', overdue: 'Overdue', week: 'Due this week', approve: 'To approve', created: 'Created by me', unassigned: 'Unassigned', documents: 'Document requests',
};

export interface RuleContext { me: number | null; now: Date }

/** The quick views, each on the same rules as My work: Mine is the open tasks you are on or review (My Tasks' rule), Overdue the server's Breached, To approve the tasks whose next step for you is
 *  Approve. Overdue and Due this week are open tasks by nature (a done task has no due state). */
export function inQuick(id: QuickId, t: RegisterTask, ctx: RuleContext): boolean {
  switch (id) {
    case 'all': return true;
    case 'mine': return !isDoneStatus(t.status) && isMyWork(t, ctx.me);
    case 'overdue': return dueBucket(t, ctx.now) === 'overdue';
    case 'week': { const b = dueBucket(t, ctx.now); return b === 'today' || b === 'week'; }
    case 'approve': return nextStep(t, ctx.me)?.id === 'approve';
    case 'created': return ctx.me != null && t.created_by_id === ctx.me;
    case 'unassigned': return !isDoneStatus(t.status) && peopleOf(t).length === 0;
    case 'documents': return kindOf(t) === 'document';
  }
}

export interface FacetContext extends RuleContext {}

export function taskSpecs(ctx: FacetContext): FacetSpec<RegisterTask>[] {
  const person = (id: number | null) => (id ? String(id) : NONE);
  const owned: Record<FacetKey, FacetSpec<RegisterTask>> = {
    status: { key: 'status', values: (t) => [statusValue(t.status)] },
    priority: { key: 'priority', values: (t) => [priorityValue(t.priority)] },
    due: { key: 'due', values: (t) => [dueBucket(t, ctx.now)] },
    sla: { key: 'sla', values: (t) => [norm(t.sla_status) || 'no_sla'] },
    kind: { key: 'kind', values: (t) => [kindOf(t)] },
    source: { key: 'source', values: (t) => [t.source || NONE] },
    category: { key: 'category', values: (t) => [t.category || NONE] },
    owner: { key: 'owner', values: (t) => { const p = peopleOf(t); return p.length ? p.map(String) : [NONE]; } },
    reviewer: { key: 'reviewer', values: (t) => [person(t.reviewer_id)] },
    creator: { key: 'creator', values: (t) => [person(t.created_by_id)] },
    approval: { key: 'approval', values: (t) => [approvalValue(t)] },
    repeats: { key: 'repeats', values: (t) => [t.recurrence_pattern ? 'repeats' : 'once'] },
    linked: { key: 'linked', values: (t) => [(t.links && t.links.length) || t.source_label ? 'linked' : NONE] },
  };
  return RAIL_ORDER.map((k) => owned[k]);
}

// ── search ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const fold = (s: string): string => s.toLowerCase();
export const searchTerms = (search: string): string[] => fold(search).split(/\s+/).filter(Boolean);

/** What the search looks in: the title, the category, the source and its label, the kind, the status and priority words and everyone on the task, the reviewer and who made it. */
export function haystack(t: RegisterTask): string {
  const people = [t.assigned_owner, ...(t.assignees ?? []), t.reviewer, t.created_by].map((p) => p?.display_name || '').join(' ');
  return fold(`${t.title} ${t.category} ${t.source} ${t.source_label ?? ''} ${KIND_LABEL[kindOf(t)]} ${t.status} ${t.priority} ${people}`);
}

export const indexTasks = (rows: readonly RegisterTask[], ctx: FacetContext): FacetIndex<RegisterTask> => indexRows(rows, taskSpecs(ctx), haystack);

export function chosenOf(f: Filters): Chosen {
  return { status: f.status, priority: f.priority, due: f.due, sla: f.sla, kind: f.kind, source: f.source, category: f.category, owner: f.owner, reviewer: f.reviewer, creator: f.creator, approval: f.approval, repeats: f.repeats, linked: f.linked };
}

/** What every task must pass besides the facets: the search words and a quick view. */
export function ruleOf(f: Filters, ctx: RuleContext): Rule<RegisterTask> {
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  return { terms: searchTerms(f.search), extra: quick ? (t) => inQuick(quick, t, ctx) : undefined };
}

// ── the options of the rail ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Option { value: string; label: string; title?: string }

/** Every person a row names, by id (an id nobody names reads "Someone no longer here"). */
export function peopleNames(rows: readonly RegisterTask[], extra: readonly { id: number; display_name?: string | null }[] = []): Map<number, string> {
  const names = new Map<number, string>();
  const note = (p: { id: number; display_name?: string | null } | null | undefined) => { if (p && p.display_name && !names.has(p.id)) names.set(p.id, p.display_name); };
  rows.forEach((t) => { note(t.assigned_owner); (t.assignees ?? []).forEach(note); note(t.reviewer); note(t.created_by); });
  extra.forEach(note);
  return names;
}

const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
const GONE = 'Someone no longer here';

/** The options of every facet. Words the workflow lists come first in its order, then any other word the tasks hold; people and sources are the ones present. */
export function railOptions(rows: readonly RegisterTask[], names: ReadonlyMap<number, string>, ctx: FacetContext): Record<FacetKey, Option[]> {
  const present = (pick: (t: RegisterTask) => string[]): Set<string> => { const s = new Set<string>(); rows.forEach((t) => pick(t).forEach((v) => s.add(v))); return s; };
  const known = (list: readonly string[], seen: Set<string>, label: (v: string) => string): Option[] => {
    const head = list.map((v) => ({ value: v, label: label(v) }));
    const rest = Array.from(seen).filter((v) => list.indexOf(v) < 0).sort().map((v) => ({ value: v, label: label(v) }));
    return head.concat(rest);
  };
  const people = (pick: (t: RegisterTask) => string[], none: string): Option[] => {
    const seen = present(pick);
    seen.delete(NONE);
    const list: Option[] = Array.from(seen).map((v) => ({ value: v, label: names.get(Number(v)) ?? GONE })).sort(byLabel);
    return list.concat([{ value: NONE, label: none }]);
  };
  const words = (pick: (t: RegisterTask) => string): Option[] => Array.from(present((t) => [pick(t)])).filter((v) => v !== NONE).sort().map((v) => ({ value: v, label: v })).concat([{ value: NONE, label: 'Not set' }]);
  const status = present((t) => [statusValue(t.status)]);
  const priority = present((t) => [priorityValue(t.priority)]);
  return {
    status: known(STATUSES, status, (v) => taskStatus.label(v)),
    priority: known(PRIORITIES, priority, (v) => taskPriority.label(v)),
    due: DUE_BUCKETS.map((v) => ({ value: v, label: DUE_LABEL[v as DueBucket] })),
    sla: SLA_ORDER.map((v) => ({ value: v, label: taskSla.label(v) })),
    kind: KINDS.map((v) => ({ value: v, label: KIND_LABEL[v] })),
    source: words((t) => t.source || NONE),
    category: words((t) => t.category || NONE),
    owner: people((t) => { const p = peopleOf(t); return p.length ? p.map(String) : [NONE]; }, 'Unassigned'),
    reviewer: people((t) => [t.reviewer_id ? String(t.reviewer_id) : NONE], 'No reviewer'),
    creator: people((t) => [t.created_by_id ? String(t.created_by_id) : NONE], 'Not recorded'),
    approval: APPROVAL_ORDER.map((v) => ({ value: v, label: APPROVAL_LABEL[v] })),
    repeats: [{ value: 'repeats', label: 'Repeats' }, { value: 'once', label: 'One-off' }],
    linked: [{ value: 'linked', label: 'Has a source or a linked record' }, { value: NONE, label: 'Nothing linked' }],
  };
}

/** Options in the order the rail draws them: an option nobody has is left out unless it is chosen (then it stays, dimmed, count 0). */
export function orderedOptions(options: readonly Option[], chosen: readonly string[], count: (value: string) => number): Option[] {
  const have = options.filter((o) => count(o.value) > 0 || chosen.indexOf(o.value) >= 0);
  return have.length ? have : options.slice();
}

// ── chips ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Chip { key: string; label: string; group: FacetKey | 'search' | 'quick'; value?: string }

export function filterChips(f: Filters, options: Record<FacetKey, Option[]>): Chip[] {
  const chips: Chip[] = [];
  if (f.search.trim()) chips.push({ key: 'search', group: 'search', label: `Search: ${f.search.trim()}` });
  if (f.quick && f.quick !== 'all') chips.push({ key: 'quick', group: 'quick', label: QUICK_LABEL[f.quick] });
  RAIL_ORDER.forEach((g) => f[g].forEach((v) => {
    const o = options[g].filter((x) => x.value === v)[0];
    chips.push({ key: `${g}:${v}`, group: g, value: v, label: `${FACET_TITLE[g]}: ${o?.label ?? v}` });
  }));
  return chips;
}

export function removeChip(f: Filters, chip: Chip): Filters {
  if (chip.group === 'search') return { ...f, search: '' };
  if (chip.group === 'quick') return { ...f, quick: null };
  return { ...f, [chip.group]: f[chip.group].filter((v) => v !== chip.value) } as Filters;
}

// ── sort and group ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The columns the register sorts by: the server's own names (an old `?sort=due_date:asc` link keeps working) and the owner. */
export const SORT_KEYS = ['created_at', 'updated_at', 'title', 'priority', 'status', 'due_date', 'source', 'category', 'owner'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'created_at', dir: 'desc' };
export const SORT_LABEL: Record<SortKey, string> = {
  created_at: 'Created', updated_at: 'Last changed', title: 'Title', priority: 'Priority', status: 'Status', due_date: 'Due date', source: 'Source', category: 'Category', owner: 'Owner',
};
/** the direction a column starts in: what answers its question first (the newest, the most severe, the soonest due) */
const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = { created_at: 'desc', updated_at: 'desc', title: 'asc', priority: 'asc', status: 'asc', due_date: 'asc', source: 'asc', category: 'asc', owner: 'asc' };

/** The sort a press on column `key` asks for: another column starts in its own first direction, the same column reverses. */
export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
}

const rankOf = (list: readonly string[], word: string): number => { const i = list.map(norm).indexOf(norm(word)); return i < 0 ? list.length : i; };

/** Sorted copy of the tasks. Priority runs Critical to Low and status follows the workflow (the server sorted both alphabetically); a task with no due date or no owner sorts last in either direction;
 *  equal values keep a stable order (the newer task first, by id). */
export function sortTasks(rows: readonly RegisterTask[], sort: Sort, names: ReadonlyMap<number, string>): RegisterTask[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (t: RegisterTask): string | number | null => {
    switch (sort.key) {
      case 'title': return t.title.toLowerCase();
      case 'priority': return rankOf(PRIORITIES, t.priority);
      case 'status': return rankOf(STATUSES, t.status);
      case 'due_date': return dueMoment(t.due_date)?.getTime() ?? null;
      case 'created_at': return dueMoment(t.created_at)?.getTime() ?? null;
      case 'updated_at': return dueMoment(t.updated_at)?.getTime() ?? null;
      case 'source': return (t.source || '').toLowerCase() || null;
      case 'category': return (t.category || '').toLowerCase() || null;
      case 'owner': { const first = peopleOf(t)[0]; return first == null ? null : (names.get(first) ?? '').toLowerCase(); }
    }
  };
  return rows.map((t) => ({ t, v: value(t) })).sort((a, b) => {
    if (a.v == null || b.v == null) { if (a.v !== b.v) return a.v == null ? 1 : -1; return b.t.id - a.t.id; }
    const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
    return c !== 0 ? sign * c : b.t.id - a.t.id;
  }).map((x) => x.t);
}

export type GroupBy = 'none' | 'owner' | 'due';
export const GROUPS: readonly GroupBy[] = ['none', 'owner', 'due'];
export const GROUP_LABEL: Record<GroupBy, string> = { none: 'No grouping', owner: 'Owner', due: 'Due' };

/** The group a task is in: the first person on it (a task with nobody is "Unassigned") or its due bucket. */
export function groupOf(t: RegisterTask, by: GroupBy, names: ReadonlyMap<number, string>, now: Date): { key: string; label: string } {
  if (by === 'owner') {
    const first = peopleOf(t)[0];
    return first == null ? { key: NONE, label: 'Unassigned' } : { key: String(first), label: names.get(first) ?? GONE };
  }
  const bucket = dueBucket(t, now);
  return { key: bucket, label: DUE_LABEL[bucket] };
}

/** The tasks (already sorted) in the order of their groups: people by name with Unassigned last, due buckets from Overdue to Done; inside a group the sort is kept. */
export function groupTasks(rows: readonly RegisterTask[], by: GroupBy, names: ReadonlyMap<number, string>, now: Date): RegisterTask[] {
  if (by === 'none') return rows.slice();
  const rank = (t: RegisterTask): [number, string] => {
    const g = groupOf(t, by, names, now);
    if (by === 'due') return [DUE_BUCKETS.indexOf(g.key as DueBucket), ''];
    return [g.key === NONE ? 1 : 0, g.label.toLowerCase()];
  };
  return rows.map((t, i) => ({ t, i, r: rank(t) })).sort((a, b) => a.r[0] - b.r[0] || a.r[1].localeCompare(b.r[1]) || a.i - b.i).map((x) => x.t);
}
