// What the Regulatory Overview decides, apart from React so `node --test` pins it (overviewModel.test.ts): the counters (the server's numbers, each opening the records it counts in the
// register), the person's own work built from /my-work and grouped by urgency, the posture's figures, and the breakdowns of the complete register. A number is never made up: a request that
// failed is a state of its own, not 0.
import { priority, type Tone } from '../../../../../lib/status.ts';
import { changeStatus } from '../../../../../lib/statuses/regulatory.ts';
import { daysUntil, dueWords, isOpen, regulatorName, todayNumber, dayNumber } from '../_lib/regulatoryModel.ts';
import type { ChangeRow, MyWorkPayload, OverviewPayload } from '../_lib/types.ts';

const LEAF = '/governance/regulatory-changes';
export const FEED_HREF = '/governance/regulatory-feeds';

/** An address in the register: the Changes tab with these filters on. */
export function registerHref(filters: Record<string, string | string[]> = {}): string {
  const q = new URLSearchParams({ tab: 'changes' });
  Object.entries(filters).forEach(([k, v]) => { const text = Array.isArray(v) ? v.join(',') : v; if (text) q.set(k, text); });
  return `${LEAF}?${q.toString()}`;
}
export const changeHref = (id: number, tab?: string, extra: Record<string, string | number> = {}): string => {
  const q = new URLSearchParams();
  if (tab) q.set('tab', tab);
  Object.entries(extra).forEach(([k, v]) => q.set(k, String(v)));
  const s = q.toString();
  return `${LEAF}/${id}${s ? `?${s}` : ''}`;
};

// ── the counters ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CounterDef {
  key: string;
  label: string;
  href: string;
  tone: Tone;
  /** the number in the server's answer; undefined: not in it */
  pick: (o: OverviewPayload, w: MyWorkPayload | undefined) => number | undefined;
}

/** What needs attention across the module, in the order of urgency; each opens the records it counts. The numbers are the server's, over every change being worked on. */
export const COUNTERS: readonly CounterDef[] = [
  { key: 'feed', label: 'Feed items to triage', href: FEED_HREF, tone: 'pending', pick: (o) => o.feed?.new },
  { key: 'late', label: 'Tasks late', href: registerHref({ work: 'late' }), tone: 'danger', pick: (o) => o.tasks?.late },
  { key: 'check', label: 'Obligations to check', href: registerHref({ work: 'tocheck' }), tone: 'warning', pick: (o) => o.obligations?.to_check },
  { key: 'suggestions', label: 'Control suggestions to confirm', href: registerHref({ work: 'suggestions' }), tone: 'warning', pick: (o) => o.obligations?.suggestions },
  { key: 'soon', label: 'Take effect in 30 days', href: registerHref({ quick: 'soon' }), tone: 'warning', pick: (o) => o.changes?.effective_soon },
  { key: 'in_force', label: 'In force, not closed', href: registerHref({ quick: 'open', eff: 'past' }), tone: 'danger', pick: (o) => o.changes?.in_force },
];
/** The person's own: changes assigned to them. */
export const MINE: Omit<CounterDef, 'pick'> = { key: 'mine', label: 'Assigned to me', href: registerHref({ quick: 'mine' }), tone: 'neutral' };

export type CounterState = 'ready' | 'loading' | 'error' | 'none';
export interface CounterView { state: CounterState; value?: number }

/** One counter: a missing number in an answer that arrived is "not recorded" (a dash), never 0. */
export function counterFrom(value: number | undefined, loading: boolean, failed: boolean): CounterView {
  if (failed) return { state: 'error' };
  if (loading) return { state: 'loading' };
  return typeof value === 'number' ? { state: 'ready', value } : { state: 'none' };
}

/** The sum the band says it counts ("12 need attention"): the counters that are about work, not the person's own. */
export function attentionTotal(o: OverviewPayload | undefined): number | null {
  if (!o) return null;
  return [o.feed?.new, o.tasks?.late, o.obligations?.to_check, o.obligations?.suggestions, o.changes?.effective_soon, o.changes?.in_force].reduce<number>((n, v) => n + (typeof v === 'number' ? v : 0), 0);
}

// ── the person's work ────────────────────────────────────────────────────────────────────────────────────────────────────

export type WorkKind = 'task' | 'obligation' | 'change' | 'feed';
export const WORK_KIND: Record<WorkKind, { label: string; tone: Tone }> = {
  task: { label: 'Task', tone: 'progress' }, obligation: { label: 'Obligation', tone: 'warning' }, change: { label: 'Change', tone: 'pending' }, feed: { label: 'Feed', tone: 'pending' },
};

export interface WorkItem {
  key: string;
  kind: WorkKind;
  title: string;
  context: string;
  href: string;
  action: { label: string; href: string };
  /** the server's date (a day); null: no date */
  due: string | null;
  overdue: boolean;
}

/** Everything that waits for the person, most urgent first: overdue (oldest day first), this week, then the rest. */
export function buildWork(w: MyWorkPayload | undefined, today: Date): WorkItem[] {
  if (!w) return [];
  const items: WorkItem[] = [];
  w.tasks.forEach((t) => {
    const href = changeHref(t.change_id, 'tasks');
    items.push({ key: `task-${t.id}`, kind: 'task', title: t.title, context: `${t.change_title} · ${t.status === 'in_progress' ? 'In progress' : t.status === 'blocked' ? 'Blocked' : 'Not started'}`, href, action: { label: 'Open', href }, due: t.due_date, overdue: t.late });
  });
  w.obligations.forEach((o) => {
    const href = changeHref(o.change_id, 'obligations', { obl: o.id });
    const late = (daysUntil(o.deadline, today) ?? 0) < 0;
    items.push({ key: `obligation-${o.id}`, kind: 'obligation', title: o.summary, context: [o.change_title, o.ref ? `Clause ${o.ref}` : '', 'Not assessed'].filter(Boolean).join(' · '), href, action: { label: 'Assess', href }, due: o.deadline, overdue: late });
  });
  w.changes.forEach((c) => {
    const href = changeHref(c.id);
    const eff = dueWords(c.effective_date, today);
    items.push({
      key: `change-${c.id}`, kind: 'change', title: c.title,
      context: [regulatorName(c.source), changeStatus.label(c.status), eff ? (eff.late ? 'In force' : `Takes effect ${eff.text}`) : ''].filter(Boolean).join(' · '),
      href, action: { label: 'Open', href }, due: c.effective_date, overdue: false,
    });
  });
  if (w.feed_new > 0) {
    items.push({ key: 'feed', kind: 'feed', title: `${w.feed_new} new ${w.feed_new === 1 ? 'item' : 'items'} in the feeds you watch`, context: 'Read, analyse or mark not relevant', href: FEED_HREF, action: { label: 'Triage', href: FEED_HREF }, due: null, overdue: false });
  }
  const rank: Record<Urgency, number> = { overdue: 0, week: 1, todo: 2 };
  return items.map((it, i) => ({ it, i, u: urgencyOf(it, today) }))
    .sort((a, b) => rank[a.u] - rank[b.u] || (a.it.due && b.it.due ? (dayNumber(a.it.due) ?? 0) - (dayNumber(b.it.due) ?? 0) : a.it.due ? -1 : b.it.due ? 1 : 0) || a.i - b.i)
    .map((x) => x.it);
}

export type Urgency = 'overdue' | 'week' | 'todo';
export const URGENCY_LABEL: Record<Urgency, string> = { overdue: 'Overdue', week: 'This week', todo: 'To do' };
export function urgencyOf(item: Pick<WorkItem, 'due' | 'overdue'>, today: Date): Urgency {
  if (item.overdue) return 'overdue';
  const d = daysUntil(item.due, today);
  return d != null && d <= 7 ? 'week' : 'todo';
}

/** The first `limit` items with a header where the urgency changes. */
export function groupWork(items: readonly WorkItem[], today: Date, limit: number): Array<{ group: Urgency; items: WorkItem[] }> {
  const out: Array<{ group: Urgency; items: WorkItem[] }> = [];
  items.slice(0, limit).forEach((it) => {
    const g = urgencyOf(it, today);
    const last = out[out.length - 1];
    if (last && last.group === g) last.items.push(it);
    else out.push({ group: g, items: [it] });
  });
  return out;
}

// ── the posture ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Slice { key: string; label: string; count: number; tone: Tone; href: string }

const COMPLIANCE_ORDER = ['compliant', 'partially_compliant', 'non_compliant', 'not_assessed', 'not_applicable'] as const;
const COMPLIANCE_TONE: Record<string, Tone> = { compliant: 'success', partially_compliant: 'warning', non_compliant: 'danger', not_assessed: 'neutral', not_applicable: 'neutral' };
const COMPLIANCE_LABEL: Record<string, string> = {
  compliant: 'Compliant', partially_compliant: 'Partially compliant', non_compliant: 'Non-compliant', not_assessed: 'Not assessed', not_applicable: 'Not applicable',
};

/** How the obligations of the changes in progress stand, in the order a person reads them; a word with none is left out. */
export function complianceSlices(o: OverviewPayload | undefined): Slice[] {
  const by = o?.obligations?.by_compliance ?? {};
  return COMPLIANCE_ORDER.filter((k) => (by[k] ?? 0) > 0).map((k) => ({ key: k, label: COMPLIANCE_LABEL[k], count: by[k], tone: COMPLIANCE_TONE[k], href: registerHref({ quick: 'open' }) }));
}

/** Obligations met by a confirmed control, of all obligations being worked on; null while there are none. */
export function metShare(o: OverviewPayload | undefined): { met: number; total: number; pct: number } | null {
  const total = o?.obligations?.total ?? 0;
  if (!o || total === 0) return null;
  return { met: o.obligations.met, total, pct: Math.round((o.obligations.met / total) * 100) };
}

/** The changes in progress by stage, in the order of the pipeline. */
export function stageSlices(o: OverviewPayload | undefined): Slice[] {
  const by = o?.changes?.by_status ?? {};
  return (['identified', 'under_assessment', 'implementation'] as const).map((k) => ({ key: k, label: changeStatus.label(k), count: by[k] ?? 0, tone: changeStatus.tone(k), href: registerHref({ status: k }) }));
}

// ── the breakdowns of the complete register ──────────────────────────────────────────────────────────────────────────────

export interface RegulatorSlice { key: string; label: string; total: number; late: number; href: string }

/** Changes in progress by regulator, the one with most late tasks and then most changes first. */
export function byRegulator(rows: readonly ChangeRow[]): RegulatorSlice[] {
  const m = new Map<string, RegulatorSlice>();
  rows.filter((r) => isOpen(r.status)).forEach((r) => {
    const cur = m.get(r.source) ?? { key: r.source, label: regulatorName(r.source), total: 0, late: 0, href: registerHref({ quick: 'open', reg: r.source }) };
    cur.total += 1;
    cur.late += r.late_task_count ?? 0;
    m.set(r.source, cur);
  });
  return Array.from(m.values()).sort((a, b) => b.late - a.late || b.total - a.total || a.label.localeCompare(b.label));
}

/** Changes in progress that have an effective date: the ones already in force first (oldest first), then the next to take effect. */
export function takesEffect(rows: readonly ChangeRow[], today: Date, n = 6): ChangeRow[] {
  const t = todayNumber(today);
  return rows.filter((r) => isOpen(r.status) && dayNumber(r.effective_date) != null)
    .sort((a, b) => {
      const x = (dayNumber(a.effective_date) as number) - t;
      const y = (dayNumber(b.effective_date) as number) - t;
      return (x < 0 ? 0 : 1) - (y < 0 ? 0 : 1) || x - y || a.id - b.id;
    }).slice(0, n);
}

/** The critical and high priority changes in progress, critical first, then the soonest to take effect. */
export function topPriority(rows: readonly ChangeRow[], n = 6): ChangeRow[] {
  const rank = (p: string) => priority.words.indexOf(p);
  return rows.filter((r) => isOpen(r.status) && (r.priority === 'critical' || r.priority === 'high'))
    .sort((a, b) => rank(a.priority) - rank(b.priority) || (a.effective_date ? 0 : 1) - (b.effective_date ? 0 : 1) || (a.effective_date || '').localeCompare(b.effective_date || '') || b.id - a.id).slice(0, n);
}
