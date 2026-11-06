// The rules of My Work (the SCF "my work" inbox page), moved out of the page apart from React so `node --test` can pin them (workModel.test.ts): which controls of which framework are the
// person's, how the journey items are ranked (done last, overdue first, critical first, in progress first, then by due date), how a framework's progress is read, and the "This week" counts.
// They are the page's own rules, moved unchanged; the test compares them with frozen copies of the old code on the same data.
import type { ScfMyWorkItem } from '../../../lib/api.ts';

export interface Journey { id: number; framework_name?: string; name?: string; target_date?: string | null; current_phase?: number; status?: string; progress?: Record<string, unknown> }
export interface Ctrl {
  id: number; control_code?: string; control_name?: string; title?: string; status?: string;
  is_critical?: boolean; assigned_user_ids?: number[]; assigned_to_user_id?: number | null;
  approved_evidence_count?: number; required_evidence_count?: number; evidence_count?: number; verified_date?: string | null;
}
/** One framework (journey): the controls of it that are the person's, how many it has, and whether its controls could not be read at all. */
export interface Per { journey: Journey; mine: Ctrl[]; total: number; failed?: boolean }

export const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', in_review: 'In review',
  implemented: 'Implemented', verified: 'Verified', not_applicable: 'N/A',
};
export const DONE = ['verified', 'implemented', 'not_applicable'];
export const DAY = 86400000;
export const isDone = (status: string | undefined): boolean => DONE.indexOf(status || '') >= 0;

/** The controls of a framework that are the person's: they are in its assigned list, or its single assignee. */
export const mineOf = (controls: Ctrl[], userId: number): Ctrl[] => controls.filter((c) => (c.assigned_user_ids || []).includes(userId) || c.assigned_to_user_id === userId);

export const scfCode = (item: ScfMyWorkItem): string => String(item.scf_id || item.control_id || '');
export const scfTitle = (item: ScfMyWorkItem): string => String(item.title || item.name || scfCode(item) || '(untitled)');

export interface WorkItem {
  journeyId: number; frameworkName: string; controlId: number; code: string; title: string; status: string; isCritical: boolean;
  approved: number; required: number; due: number | null; overdue: boolean; done: boolean; active: boolean;
}

/** Every control of the person's, ranked: done last, then overdue first, critical first, in review or in progress first, then the earliest due. */
export function workItems(per: Per[], now: number): WorkItem[] {
  const out: WorkItem[] = [];
  per.forEach(({ journey, mine }) => {
    const due = journey.target_date ? new Date(journey.target_date).getTime() : null;
    mine.forEach((c) => {
      const done = isDone(c.status);
      out.push({
        journeyId: journey.id,
        frameworkName: journey.framework_name || journey.name || 'Framework',
        controlId: c.id,
        code: c.control_code || '',
        title: c.control_name || c.title || '(untitled)',
        status: c.status || 'not_started',
        isCritical: !!c.is_critical,
        approved: c.approved_evidence_count || 0,
        required: c.required_evidence_count || c.evidence_count || 0,
        due, done,
        overdue: !!due && due < now && !done,
        active: c.status === 'in_review' || c.status === 'in_progress',
      });
    });
  });
  const rank = (i: WorkItem) => (i.done ? 4000 : 0) + (i.overdue ? 0 : 1000) + (i.isCritical ? 0 : 100) + (i.active ? 0 : 10);
  out.sort((a, b) => rank(a) - rank(b) || (a.due || Infinity) - (b.due || Infinity));
  return out;
}

export interface FrameworkRow { id: number; name: string; pct: number; myCount: number; phase?: number; status?: string }

/** The frameworks the person has controls in, with their progress: the journey's own percentage (compliance, readiness or plain), else the share of the person's controls that are done. */
export function frameworksOf(per: Per[]): FrameworkRow[] {
  return per.map(({ journey, mine }) => {
    const prog = (journey.progress || {}) as Record<string, number>;
    const pct = Math.round(
      (prog.compliance_percentage ?? prog.readiness_percentage ?? prog.percentage ??
        (mine.length ? (100 * mine.filter((m) => isDone(m.status)).length) / mine.length : 0)) as number,
    );
    return { id: journey.id, name: journey.framework_name || journey.name || 'Framework', pct, myCount: mine.length, phase: journey.current_phase, status: journey.status };
  }).filter((f) => f.myCount > 0);
}

export interface Week { completed: number; evidenceApproved: number; awaitingReviewer: number; dueNext7: number }

/** "This week": controls verified in the last seven days, evidence approved on the person's controls, controls waiting for a reviewer, items due in the next seven days. */
export function weekOf(per: Per[], items: WorkItem[], now: number): Week {
  const all = per.flatMap((p) => p.mine);
  return {
    completed: all.filter((c) => c.verified_date && (now - new Date(c.verified_date).getTime()) < 7 * DAY).length,
    evidenceApproved: all.reduce((s, c) => s + (c.approved_evidence_count || 0), 0),
    awaitingReviewer: all.filter((c) => c.status === 'in_review').length,
    dueNext7: items.filter((i) => !i.done && i.due != null && i.due - now < 7 * DAY && i.due - now > -DAY).length,
  };
}

/** A control-plane item is overdue when its next due moment has passed (the page's rule: `next_due_at` against now). */
export const scfOverdue = (item: ScfMyWorkItem, now: number): boolean => (item.next_due_at ? new Date(String(item.next_due_at)).getTime() < now : false);

/** What a framework that failed to load is called in the notice that says so. */
export const failedNames = (per: Per[]): string[] => per.filter((p) => p.failed).map((p) => p.journey.framework_name || p.journey.name || `Framework ${p.journey.id}`);
