// What the Regulatory Changes screens decide, apart from React so `node --test` pins it (regulatoryModel.test.ts): which statuses are open and which are finished, the one reading of "late",
// how a due day is said, the regulators the circular form offers, what a row needs attention for, the steps of a change's journey, the rule for closing it, and the obligation filters.
// Nothing here changes what a status means or what the server allows: the close rule is the server's (a change closes when it has tasks and every one is done).
import type { Analysis, ChangeRow, Obligation, RegLink, Task } from './types.ts';

// ── statuses ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The statuses of a change still being worked on (the same three the server's Overview counts). */
export const OPEN_STATUSES = ['identified', 'under_assessment', 'implementation'] as const;
export const isOpen = (status: string | null | undefined): boolean => (OPEN_STATUSES as readonly string[]).includes(String(status));
/** Completed is what the status field wrote before; Closed is what Close writes. Both are a change that is over. */
export const isFinished = (status: string | null | undefined): boolean => status === 'completed' || status === 'closed';

/** Where a change sits on the board: the two finished words are one column. */
export const BUCKETS = ['identified', 'under_assessment', 'implementation', 'done', 'not_applicable'] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABEL: Record<Bucket, string> = {
  identified: 'Identified', under_assessment: 'Under assessment', implementation: 'Implementation', done: 'Completed', not_applicable: 'Not applicable',
};
export function bucketOf(status: string | null | undefined): Bucket {
  if (isFinished(status)) return 'done';
  return (BUCKETS as readonly string[]).includes(String(status)) ? (status as Bucket) : 'identified';
}

/** The statuses a person can move a change to from the menu. Completed is not one: a change is completed by Close, which checks the tasks (the server's PUT would take it without that check). */
export const MOVES = ['identified', 'under_assessment', 'implementation', 'not_applicable'] as const;

// ── days ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

/** The calendar day a stored value stands for, as a number of days: the written date, whatever zone the viewer is in (an effective or due date is a DAY although it arrives as a DateTime). null: no date. */
export function dayNumber(value: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : Math.round(t / DAY);
}
export const todayNumber = (today: Date): number => Math.round(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / DAY);

/** Whole days from today to a date: negative once it has passed. */
export function daysUntil(value: string | null | undefined, today: Date): number | null {
  const d = dayNumber(value);
  return d == null ? null : d - todayNumber(today);
}

/** "today", "in 5 days", "3 days late". `late` is true from the day after. */
export function dueWords(value: string | null | undefined, today: Date): { text: string; late: boolean } | null {
  const d = daysUntil(value, today);
  if (d == null) return null;
  if (d < 0) return { text: `${-d} ${d === -1 ? 'day' : 'days'} late`, late: true };
  return { text: d === 0 ? 'today' : `in ${d} ${d === 1 ? 'day' : 'days'}`, late: false };
}

/** Late = not completed and the due DAY has passed: the one reading, the server counts it the same way (a task due today is not late, a completed one never is). */
export const isTaskLate = (t: Pick<Task, 'status' | 'due_date'>, today: Date): boolean => t.status !== 'completed' && (daysUntil(t.due_date, today) ?? 0) < 0;

/** How far away an effective date is, as the register's facet reads it. */
export type Effective = 'past' | 'soon' | 'later' | 'none';
export const EFFECTIVE_SOON_DAYS = 30;
export function effectiveOf(value: string | null | undefined, today: Date): Effective {
  const d = daysUntil(value, today);
  if (d == null) return 'none';
  return d < 0 ? 'past' : d <= EFFECTIVE_SOON_DAYS ? 'soon' : 'later';
}
export const EFFECTIVE_LABEL: Record<Effective, string> = { past: 'In force', soon: 'Within 30 days', later: 'Later', none: 'No date' };

/** The priorities of a change, an obligation and a task, most urgent first (the platform's scale; the words are lib/status.ts `priority`). */
export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

// ── regulators ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The sources the server accepts for a circular (REGULATORY_CHANGE_SOURCES): the circular form offers them, nothing here is invented. */
export const REGULATORS = [
  { value: 'SBP', label: 'SBP Circular', name: 'State Bank of Pakistan' },
  { value: 'SAMA', label: 'SAMA Circular', name: 'Saudi Central Bank' },
  { value: 'QCB', label: 'QCB Circular', name: 'Qatar Central Bank' },
  { value: 'MAS', label: 'MAS Notice', name: 'Monetary Authority of Singapore' },
  { value: 'NCA', label: 'NCA Circular', name: 'National Cybersecurity Authority' },
  { value: 'OCC', label: 'OCC Bulletin', name: 'US Comptroller of the Currency' },
  { value: 'Fed', label: 'Fed Guidance', name: 'US Federal Reserve' },
  { value: 'EBA', label: 'EBA Guideline', name: 'European Banking Authority' },
  { value: 'PRA', label: 'PRA Statement', name: 'UK Prudential Regulation Authority' },
  { value: 'SEC', label: 'SEC Release', name: 'US Securities & Exchange Commission' },
  { value: 'FINRA', label: 'FINRA Notice', name: 'Financial Industry Regulatory Authority' },
  { value: 'custom', label: 'Other Circular', name: 'Custom / other regulator' },
] as const;
/** The regulator's full name, else the code as stored, else a dash. */
export const regulatorName = (source: string | null | undefined): string => REGULATORS.find((r) => r.value === source)?.name || source || '—';
/** The short name a list shows ("SBP", "Other"). */
export const regulatorCode = (source: string | null | undefined): string => (source === 'custom' ? 'Other' : source || '—');

// ── a row ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const isReading = (c: Pick<ChangeRow, 'analysis'>): boolean => c.analysis?.status === 'queued' || c.analysis?.status === 'running';

export interface TaskShare { done: number; total: number; pct: number }
export function taskShare(c: Pick<ChangeRow, 'task_count' | 'completed_task_count'>): TaskShare {
  const total = c.task_count ?? 0;
  const done = c.completed_task_count ?? 0;
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}

export interface Attention { key: 'reading' | 'late' | 'check' | 'suggestions' | 'no_tasks'; label: string; tone: 'danger' | 'warning' | 'progress' | 'neutral' }

/** What a change in progress waits for, most urgent first. A finished change waits for nothing. */
export function attentionOf(c: ChangeRow): Attention[] {
  if (!isOpen(c.status)) return [];
  const out: Attention[] = [];
  const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;
  if (isReading(c)) out.push({ key: 'reading', label: 'AI is reading', tone: 'progress' });
  if ((c.late_task_count ?? 0) > 0) out.push({ key: 'late', label: `${plural(c.late_task_count ?? 0, 'task', 'tasks')} late`, tone: 'danger' });
  if ((c.to_check_count ?? 0) > 0) out.push({ key: 'check', label: `${c.to_check_count} to check`, tone: 'warning' });
  if ((c.suggestion_count ?? 0) > 0) out.push({ key: 'suggestions', label: plural(c.suggestion_count ?? 0, 'suggestion', 'suggestions'), tone: 'warning' });
  if ((c.task_count ?? 0) === 0 && !isReading(c) && c.status !== 'identified') out.push({ key: 'no_tasks', label: 'No tasks yet', tone: 'neutral' });
  return out;
}

// ── closing ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type CloseState =
  | { kind: 'finished' }
  | { kind: 'wrong_status'; reason: string }
  | { kind: 'no_tasks' }
  | { kind: 'open_tasks'; open: number; total: number }
  | { kind: 'ready'; total: number };

/** Whether a change can be closed, in the server's own terms (POST /close): only under assessment or in implementation, with at least one task and every task completed. A change with no tasks is not dead-ended: it is told to add one. */
export function closeState(c: Pick<ChangeRow, 'status'>, tasks: ReadonlyArray<Pick<Task, 'status'>>): CloseState {
  if (isFinished(c.status)) return { kind: 'finished' };
  if (c.status === 'identified') return { kind: 'wrong_status', reason: 'Start the assessment first: move it to Under assessment, then it can be closed.' };
  if (c.status === 'not_applicable') return { kind: 'wrong_status', reason: 'A change marked Not applicable is not closed. Move it to Under assessment or Implementation to work on it.' };
  if (tasks.length === 0) return { kind: 'no_tasks' };
  const open = tasks.filter((t) => t.status !== 'completed').length;
  return open > 0 ? { kind: 'open_tasks', open, total: tasks.length } : { kind: 'ready', total: tasks.length };
}

// ── obligations ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Only what the AI read needs checking against the circular; a person's own entry does not. */
export const toCheckOf = (o: Pick<Obligation, 'source' | 'verified'>): boolean => o.source === 'ai' && !o.verified;
export const ownersOf = (o: Pick<Obligation, 'owner_ids' | 'owner_id'>): number[] => (o.owner_ids?.length ? o.owner_ids : o.owner_id ? [o.owner_id] : []);
export const assigneesOf = (t: Pick<Task, 'assignee_ids' | 'assigned_to'>): number[] => (t.assignee_ids?.length ? t.assignee_ids : t.assigned_to ? [t.assigned_to] : []);

export type ControlState = 'met' | 'review' | 'none';
export function controlStateOf(links: ReadonlyArray<Pick<RegLink, 'status'>> | undefined): { confirmed: number; proposed: number; state: ControlState } {
  const confirmed = (links ?? []).filter((l) => l.status === 'confirmed').length;
  const proposed = (links ?? []).filter((l) => l.status === 'proposed').length;
  return { confirmed, proposed, state: confirmed ? 'met' : proposed ? 'review' : 'none' };
}
export const CONTROL_LABEL: Record<ControlState, string> = { met: 'Met by a control', review: 'Suggestions to review', none: 'No control yet' };

export function linksByObligation(links: readonly RegLink[]): Map<number, RegLink[]> {
  const out = new Map<number, RegLink[]>();
  links.forEach((l) => { if (l.obligation_id) out.set(l.obligation_id, (out.get(l.obligation_id) ?? []).concat(l)); });
  return out;
}

/** Item numbers: the circular's own order, 1 to N, so a number stays with its row while filters narrow the list. */
export const numberOf = (all: readonly Obligation[]): Map<number, number> => new Map(all.map((o, i) => [o.id, i + 1]));

export interface ObligationFilters { q: string; compliance: string; type: string; control: string; owner: string; check: boolean }
export const NO_OBLIGATION_FILTERS: ObligationFilters = { q: '', compliance: '', type: '', control: '', owner: '', check: false };
export const obligationFiltering = (f: ObligationFilters): boolean => !!(f.q.trim() || f.compliance || f.type || f.control || f.owner || f.check);

export function filterObligations(all: readonly Obligation[], f: ObligationFilters, links: ReadonlyMap<number, RegLink[]>, numbers: ReadonlyMap<number, number>): Obligation[] {
  const q = f.q.trim().toLowerCase();
  return all.filter((o) => (!f.compliance || o.compliance_status === f.compliance)
    && (!f.type || o.obligation_type === f.type)
    && (!f.control || controlStateOf(links.get(o.id)).state === f.control)
    && (!f.owner || (f.owner === 'none' ? ownersOf(o).length === 0 : ownersOf(o).includes(Number(f.owner))))
    && (!f.check || toCheckOf(o))
    && (!q || String(numbers.get(o.id)) === q || [o.summary, o.quote || '', o.ref || '', ...(o.owners || []).map((w) => w.display_name)].some((s) => s.toLowerCase().includes(q))));
}

/** The numbers of the Overview tab and the journey, counted from the full lists of one change. */
export interface ChangeFigures {
  total: number; compliant: number; notAssessed: number; toCheck: number; met: number; suggestions: number; withoutControl: number; withoutOwner: number;
  tasks: number; tasksDone: number; late: number; unassigned: number; gaps: number; assessments: number;
}
export function figuresOf(
  obligations: readonly Obligation[], links: readonly RegLink[], tasks: readonly Task[], change: Pick<ChangeRow, 'gap_count' | 'assessment_count'>, today: Date,
): ChangeFigures {
  const by = linksByObligation(links);
  const states = obligations.map((o) => controlStateOf(by.get(o.id)).state);
  const open = tasks.filter((t) => t.status !== 'completed');
  return {
    total: obligations.length,
    compliant: obligations.filter((o) => o.compliance_status === 'compliant').length,
    notAssessed: obligations.filter((o) => o.compliance_status === 'not_assessed').length,
    toCheck: obligations.filter(toCheckOf).length,
    met: states.filter((s) => s === 'met').length,
    suggestions: links.filter((l) => l.status === 'proposed').length,
    withoutControl: states.filter((s) => s === 'none').length,
    withoutOwner: obligations.filter((o) => ownersOf(o).length === 0).length,
    tasks: tasks.length,
    tasksDone: tasks.length - open.length,
    late: open.filter((t) => isTaskLate(t, today)).length,
    unassigned: open.filter((t) => assigneesOf(t).length === 0).length,
    gaps: change.gap_count ?? 0,
    assessments: change.assessment_count ?? 0,
  };
}

// ── the journey ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type JourneyKey = 'read' | 'check' | 'map' | 'assign' | 'track' | 'close';
export type JourneyState = 'done' | 'current' | 'todo' | 'failed';
export interface JourneyStep { key: JourneyKey; label: string; state: JourneyState; note: string; tab: 'overview' | 'obligations' | 'tasks' }

/** Where a change stands, as six steps read left to right. It adds no rule: each step is a count of what the screens already show, and the first one that is not done is the current one.
 *  A change entered by hand has no reading, so it starts at Check. */
export function journeyOf(change: Pick<ChangeRow, 'status' | 'analysis'>, f: ChangeFigures): JourneyStep[] {
  const analysis: Analysis | null | undefined = change.analysis;
  const finished = isFinished(change.status);
  const steps: JourneyStep[] = [];
  if (analysis) {
    const reading = analysis.status === 'queued' || analysis.status === 'running';
    steps.push({
      key: 'read', label: 'Read', tab: 'overview',
      state: analysis.status === 'failed' ? 'failed' : reading ? 'current' : 'done',
      note: analysis.status === 'failed' ? 'Did not finish' : reading ? 'The AI is reading' : `${f.total} found`,
    });
  }
  const noObligations = f.total === 0;
  steps.push({ key: 'check', label: 'Check', tab: 'obligations', state: finished || (!noObligations && f.toCheck === 0) ? 'done' : 'todo', note: noObligations ? 'No obligations yet' : f.toCheck ? `${f.toCheck} to check` : 'All checked' });
  steps.push({
    key: 'map', label: 'Map controls', tab: 'obligations', state: finished || (!noObligations && f.met === f.total) ? 'done' : 'todo',
    note: noObligations ? '—' : f.met === f.total ? 'All met' : `${f.total - f.met} not met${f.suggestions ? `, ${f.suggestions} suggested` : ''}`,
  });
  steps.push({ key: 'assign', label: 'Assign', tab: 'obligations', state: finished || (!noObligations && f.withoutOwner === 0 && f.unassigned === 0) ? 'done' : 'todo', note: noObligations ? '—' : f.withoutOwner + f.unassigned === 0 ? 'Everyone named' : `${f.withoutOwner} without an owner${f.unassigned ? `, ${f.unassigned} tasks unassigned` : ''}` });
  steps.push({ key: 'track', label: 'Track', tab: 'tasks', state: finished || (f.tasks > 0 && f.tasksDone === f.tasks) ? 'done' : 'todo', note: f.tasks === 0 ? 'No tasks yet' : `${f.tasksDone} of ${f.tasks} done${f.late ? `, ${f.late} late` : ''}` });
  steps.push({ key: 'close', label: 'Close', tab: 'overview', state: finished ? 'done' : 'todo', note: finished ? 'Closed' : f.tasks > 0 && f.tasksDone === f.tasks ? 'Ready' : 'When every task is done' });
  const firstOpen = steps.findIndex((s) => s.state !== 'done' && s.state !== 'failed');
  return steps.map((s, i) => (i === firstOpen && s.state === 'todo' ? { ...s, state: 'current' as const } : s));
}
