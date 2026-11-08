// What the plan page and the drill page decide, apart from React so `node --test` pins it (recordModel.test.ts): the journey strip (where a plan or a drill stands on its way), the
// "what next" lines of the Overview tab (derived from the record's own figures, never invented), the order of a plan's processes, and the answer to "which process is open" for a
// phone that shows a list or a panel. The server's rules (Approved needs RTO and RPO; a drill is closed only with a result) are not re-implemented: they are named where they matter.
import { dueWords, plural, testedOf, windowOf, type Bia, type Drill, type Plan } from '../bcmModel.ts';
import { severity } from '../../../../lib/statuses/bcm.ts';

export type StepState = 'done' | 'current' | 'todo';
export interface Step { key: string; label: string; state: StepState }
export interface Journey { steps: Step[]; /** the record is off the way (retired, cancelled): the strip is drawn dimmed. Its status pill in the head says which. */ off: boolean }

const mark = (keys: readonly string[], labels: Record<string, string>, at: number): Step[] =>
  keys.map((key, i) => ({ key, label: labels[key], state: i < at ? 'done' : i === at ? 'current' : 'todo' }));

const PLAN_STEPS = ['draft', 'under_review', 'approved'] as const;
const PLAN_LABELS = { draft: 'Draft', under_review: 'Under review', approved: 'Approved' };
/** A plan on its way: Draft, Under review, Approved (a plan may move between them freely, so this says where it IS, not what must come next). A retired plan is off the way. */
export function planJourney(status: string): Journey {
  if (status === 'retired') return { steps: mark(PLAN_STEPS, PLAN_LABELS, -1), off: true };
  return { steps: mark(PLAN_STEPS, PLAN_LABELS, Math.max(0, PLAN_STEPS.indexOf(status as (typeof PLAN_STEPS)[number]))), off: false };
}

const DRILL_STEPS = ['scheduled', 'in_progress', 'completed', 'closed'] as const;
const DRILL_LABELS = { scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', closed: 'Closed' };
/** A drill on its way: Scheduled, In progress, Completed, Closed. Under review sits at Completed; an overdue drill is still at Scheduled; a cancelled one is off the way. */
export function drillJourney(status: string): Journey {
  if (status === 'cancelled') return { steps: mark(DRILL_STEPS, DRILL_LABELS, -1), off: true };
  const at = status === 'under_review' ? 2 : Math.max(0, DRILL_STEPS.indexOf(status as (typeof DRILL_STEPS)[number]));
  return { steps: mark(DRILL_STEPS, DRILL_LABELS, at), off: false };
}

export type Tab = 'overview' | 'bia' | 'drills' | 'result' | 'findings';
export interface NextStep { key: string; text: string; tone: 'danger' | 'warning' | 'neutral'; /** the tab that holds the work, or an action name the page knows */ go?: Tab | 'edit' | 'schedule' }

/** The day of a plan's latest drill (the scheduled day, else when it was made), from the drills the plan page holds. */
export function lastDrillAt(drills: ReadonlyArray<Pick<Drill, 'scheduled_date'> & { created_at?: string | null }>): string | null {
  let best: string | null = null;
  drills.forEach((d) => {
    const day = d.scheduled_date ?? d.created_at ?? null;
    if (day && (best === null || day > best)) best = day;
  });
  return best;
}

/** What a plan needs, most pressing first: from its own figures. The server's rule for Approved is named, not enforced here. */
export function planNextSteps(plan: Pick<Plan, 'status' | 'rto_hours' | 'rpo_hours' | 'next_review_due' | 'bia_records' | 'drills'>, now: number): NextStep[] {
  const out: NextStep[] = [];
  const retired = plan.status === 'retired';
  const bia = plan.bia_records ?? [];
  const drills = plan.drills ?? [];
  if (!retired && plan.status !== 'approved' && (plan.rto_hours == null || plan.rpo_hours == null)) {
    out.push({ key: 'objectives', text: 'Set the plan\'s RTO and RPO: a plan cannot be approved without them.', tone: 'warning', go: 'edit' });
  }
  if (!retired) {
    const w = windowOf(plan.next_review_due, now);
    if (w === 'overdue') out.push({ key: 'review', text: `${dueWords(plan.next_review_due, now, 'Review')}. Review the plan, then set its next review day.`, tone: 'danger', go: 'edit' });
    else if (w === 'soon') out.push({ key: 'review', text: `${dueWords(plan.next_review_due, now, 'Review')}.`, tone: 'warning', go: 'edit' });
  }
  if (!retired && bia.length === 0) out.push({ key: 'bia-none', text: 'No business impact analysis yet. Add the critical processes this plan protects.', tone: 'warning', go: 'bia' });
  const open = bia.filter((b) => !b.is_complete).length;
  if (!retired && open > 0) out.push({ key: 'bia-open', text: `${plural(open, 'process', 'processes')} ${open === 1 ? 'has' : 'have'} no recovery strategy.`, tone: 'warning', go: 'bia' });
  if (!retired) {
    const tested = testedOf(lastDrillAt(drills), now);
    if (tested === 'never') out.push({ key: 'never-tested', text: 'This plan has never been tested. Schedule a drill.', tone: 'danger', go: 'schedule' });
    else if (tested === 'lapsed') out.push({ key: 'not-tested', text: 'No drill in the last 12 months. Schedule one.', tone: 'warning', go: 'schedule' });
  }
  return out;
}

/** What a drill needs: from its own status, result and findings. Closing needs a result (the server's rule); it is named, not enforced here. */
export function drillNextSteps(drill: Pick<Drill, 'status' | 'effective_status' | 'scheduled_date' | 'has_result' | 'finding_count' | 'findings' | 'result'>, now: number): NextStep[] {
  const out: NextStep[] = [];
  const hasResult = drill.has_result || !!drill.result;
  if (drill.effective_status === 'overdue') out.push({ key: 'overdue', text: `${dueWords(drill.scheduled_date, now, 'Starts')}. Run it, or move its day.`, tone: 'danger', go: 'edit' });
  else if (drill.status === 'scheduled' && windowOf(drill.scheduled_date, now) === 'soon') out.push({ key: 'soon', text: `${dueWords(drill.scheduled_date, now, 'Starts')}.`, tone: 'neutral' });
  if (['in_progress', 'completed', 'under_review'].includes(drill.status) && !hasResult) out.push({ key: 'result', text: 'Record the result: whether the recovery objectives were met. A drill cannot be closed without one.', tone: 'warning', go: 'result' });
  const open = (drill.findings ?? []).filter((f) => f.is_open).length;
  if (open > 0) out.push({ key: 'findings-open', text: `${plural(open, 'finding')} ${open === 1 ? 'is' : 'are'} still open.`, tone: 'warning', go: 'findings' });
  if (drill.status === 'completed' && hasResult && open === 0) out.push({ key: 'close', text: 'The result is recorded. Close the drill when you are done.', tone: 'neutral' });
  return out;
}

/** A plan's processes in the order the master list shows them: the most critical first, then by name. */
export function orderedProcesses(bia: readonly Bia[]): Bia[] {
  const rank = (b: Bia) => { const i = severity.words.indexOf(b.criticality_rating); return i < 0 ? severity.words.length : i; };
  return bia.slice().sort((a, b) => rank(a) - rank(b) || a.process_name.localeCompare(b.process_name) || a.id - b.id);
}

/** The process the address asks for, if the plan has it; else none (the list). A number that is not one of the plan's processes is none, never an error. */
export function openProcess(bia: readonly Bia[], param: string | null | undefined): Bia | null {
  const id = Number(param);
  return Number.isInteger(id) && id > 0 ? bia.find((b) => b.id === id) ?? null : null;
}

/** What a phone shows of the master-detail: the list, or the open process with a way back. A wide screen shows both, with the first process open. */
export function masterDetail(narrow: boolean, bia: readonly Bia[], param: string | null | undefined): { list: boolean; panel: Bia | null } {
  const picked = openProcess(bia, param);
  if (narrow) return { list: picked === null, panel: picked };
  return { list: true, panel: picked ?? orderedProcesses(bia)[0] ?? null };
}
