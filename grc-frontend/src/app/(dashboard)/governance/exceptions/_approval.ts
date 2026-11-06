// What the Policy exceptions page says about an exception's approval, as plain functions (no React, no @/ imports) so `node --test` runs _approval.test.ts
// against them: which step it is at and who it waits for, how each step stands, who decided what, and what the person asked now may do. The server
// decides all of it (modules/governance/exception_approvals.py: the steps, who is asked, `my_step`); this only says it. An exception no rule applied to
// has no `approval` and none of this is shown: it is decided as it always was.
import { EMPTY, formatDate, formatDateTime } from '../../../../lib/format.ts';
import { slotText } from '../../../../lib/exceptionRules.ts';
import { exceptionStatus } from '../../../../lib/status.ts';
import type { Tone } from '../../../../lib/status.ts';
import type { ApprovalDecision, ApprovalHistory, ApprovalRound, ApprovalStep, ExceptionApproval, Implementation, ImplementationState, MyStep, RunStatus } from './_types.ts';

/** Whether the exception waits under an approval rule now: its rule's steps decide it, and only the people asked at the open step. */
export const isRuled = (e: { approval?: { status: string } | null }): boolean => e.approval?.status === 'open';

// ─── The run ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const RUN_WORD: Record<RunStatus, string> = { open: 'In approval', approved: 'Approved', rejected: 'Rejected', changes_requested: 'Changes asked for', withdrawn: 'Withdrawn' };
const RUN_TONE: Record<RunStatus, Tone> = { open: 'pending', approved: 'success', rejected: 'danger', changes_requested: 'warning', withdrawn: 'neutral' };

/** How a round of the approval stands, in the page's words. A word the server starts sending is said readably, never hidden. */
export const runWord = (status: string): string => RUN_WORD[status as RunStatus] ?? (status ? status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : EMPTY);
export const runTone = (status: string): Tone => RUN_TONE[status as RunStatus] ?? 'neutral';

/** How a step stands while the run is `run`: done, the one asked now (or overdue), or later; once the run is over, where it ended is said instead of "now". */
export function stepWord(step: Pick<ApprovalStep, 'state' | 'overdue'>, run: string): { label: string; tone: Tone } {
  if (step.state === 'done') return { label: 'Done', tone: 'success' };
  if (step.state === 'active') {
    if (run === 'open') return step.overdue ? { label: 'Overdue', tone: 'danger' } : { label: 'Now', tone: 'pending' };
    if (run === 'rejected') return { label: 'Rejected', tone: 'danger' };
    if (run === 'changes_requested') return { label: 'Changes asked', tone: 'warning' };
    return { label: run === 'approved' ? 'Done' : 'Withdrawn', tone: run === 'approved' ? 'success' : 'neutral' };
  }
  return { label: run === 'open' ? 'Later' : 'Not reached', tone: 'neutral' };
}

/** "1 of 2": how many have answered of how many the step needs; '' when it is not known (no one is asked). */
export const progressText = (p: { required: number; answered: number }): string => (p.required > 0 ? `${p.answered} of ${p.required}` : '');

/** When the step asked now has to be done: "Due 14 Nov 2026"; '' for a step with no days, or one that is not the one asked now. */
export const dueText = (step: Pick<ApprovalStep, 'state' | 'due_at'>): string => (step.state === 'active' && step.due_at ? `Due ${formatDate(step.due_at)}` : '');

/** Who it waits for: "Waiting for Rev1, Rev2" (three names, then "and N more"), "Nobody can act" when everyone asked is gone; '' once the run is over. */
export function waitingLine(a: Pick<ExceptionApproval, 'status' | 'stalled' | 'asked'>, max = 3): string {
  if (a.status !== 'open') return '';
  if (a.stalled || a.asked.length === 0) return 'Nobody can act';
  const names = a.asked.map((p) => p.name);
  return `Waiting for ${names.slice(0, max).join(', ')}${names.length > max ? ` and ${names.length - max} more` : ''}`;
}

/** "Step 2 of 3 · Approval": where it is; '' when there is no open step. */
export function stepLine(a: Pick<ExceptionApproval, 'status' | 'current_step' | 'steps'>): string {
  const at = a.status === 'open' ? a.steps.find((s) => s.position === a.current_step) : undefined;
  return at ? `Step ${at.position} of ${a.steps.length} · ${at.name}` : '';
}

/** The two small lines under a status in the list: "Step 2 of 3 · Approval" and who it waits for; for a draft sent back, "Changes asked for". Null for any other. */
export function statusDetail(e: { status: string; approval?: ExceptionApproval | null }): { step: string; waiting: string } | null {
  const a = e.approval;
  if (!a) return null;
  if (e.status === 'pending_approval' && a.status === 'open') return { step: stepLine(a), waiting: waitingLine(a) };
  if (e.status === 'draft' && a.status === 'changes_requested') return { step: runWord(a.status), waiting: '' };
  return null;
}

/** The people a step asks, one chip each: a person is their name, a role or an owner says who would answer; answered ones say who did. */
export function slotChips(step: Pick<ApprovalStep, 'slots'>, max = 3): Array<{ text: string; answered: boolean }> {
  return step.slots.map((s) => ({ text: slotText(s.label, s.answered ? s.by : s.people, max), answered: s.answered }));
}

// ─── Who decided what ────────────────────────────────────────────────────────────────────────────────────────────────────

const DECISION_WORD: Record<string, { label: string; tone: Tone }> = {
  approve: { label: 'Approved', tone: 'success' },
  reject: { label: 'Rejected', tone: 'danger' },
  changes: { label: 'Asked for changes', tone: 'warning' },
};

export interface DecisionRow { key: string; who: string; word: string; tone: Tone; step: string; comment: string; when: string; at: string | null }

/** The decisions of a round as rows, in the order they were made: who, what, at which step, with what comment, when (on the viewer's clock). */
export function decisionRows(decisions: readonly Pick<ApprovalDecision, 'step_position' | 'step_name' | 'user_name' | 'decision' | 'comment' | 'decided_at'>[]): DecisionRow[] {
  return decisions.map((d, i) => {
    const word = DECISION_WORD[d.decision] ?? { label: d.decision, tone: 'neutral' as Tone };
    return {
      key: `${i}-${d.step_position}`, who: d.user_name || EMPTY, word: word.label, tone: word.tone, step: `Step ${d.step_position} · ${d.step_name}`,
      comment: (d.comment ?? '').trim(), when: formatDateTime(d.decided_at), at: d.decided_at,
    };
  });
}

/** The rounds before the one on show, newest first; the page asks the server for them only when they are opened. */
export const earlierRounds = (h: ApprovalHistory | undefined, currentRound: number): ApprovalRound[] =>
  (h?.rounds ?? []).filter((r) => r.round !== currentRound).sort((a, b) => b.round - a.round);

/** "Rule X · started 3 Nov 2026 by Rita": what a round was run under and when. */
export const roundMeta = (r: Pick<ApprovalRound, 'rule_name' | 'started_at' | 'started_by'>): string =>
  [r.rule_name, r.started_at ? `started ${formatDate(r.started_at)}${r.started_by ? ` by ${r.started_by}` : ''}` : ''].filter(Boolean).join(' · ');

// ─── What the person asked now may do ────────────────────────────────────────────────────────────────────────────────────

export type DecisionOption = 'approve' | 'changes' | 'reject';

/** What the open step lets the person asked do, in the order of the buttons: approve always, ask for changes and reject where the step allows them. Nothing for anyone else. */
export const decisionOptions = (my: Pick<MyStep, 'can_reject' | 'can_ask_changes'> | null | undefined): DecisionOption[] =>
  my ? ['approve', ...(my.can_ask_changes ? ['changes' as const] : []), ...(my.can_reject ? ['reject' as const] : [])] : [];

// ─── The assessment an approval needs ────────────────────────────────────────────────────────────────────────────────────────────

/** Why Approve waits: said beside the button (a disabled button says nothing by itself). The server answers 400 with its own sentence if it is pressed anyway. */
export const APPROVE_HINT = 'Record a potential risk, or none identified, to approve.';

/**
 * Whether the person asked cannot approve yet: under a rule an approval needs their own assessment at the open step (at least one potential risk, or "none
 * identified"). Reject and Ask for changes need only their comment. Nobody asked, or a server that sends no assessment, blocks nothing.
 */
export const approveBlocked = (my: { assessment?: { recorded: boolean } | null } | null | undefined): boolean => Boolean(my?.assessment && !my.assessment.recorded);

/** The same for an exception as the page holds it: only a run that is open asks anyone. */
export const approveBlockedFor = (e: { approval?: { status: string; my_step: { assessment?: { recorded: boolean } | null } | null } | null }): boolean =>
  e.approval?.status === 'open' && approveBlocked(e.approval.my_step);

// ─── The implementation, after the last approval ─────────────────────────────────────────────────────────────────────────────────

const IMPLEMENTATION_WORD: Record<ImplementationState, string> = { waiting: 'Waiting for compensating controls', in_progress: 'In progress', done: 'Implemented', cancelled: 'Cancelled' };
const IMPLEMENTATION_TONE: Record<ImplementationState, Tone> = { waiting: 'pending', in_progress: 'progress', done: 'success', cancelled: 'neutral' };

/** How the implementation stands, in words; a word nobody registered is said readably, never hidden. */
export const implementationWord = (state: string): string =>
  IMPLEMENTATION_WORD[state as ImplementationState] ?? (state ? state.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : EMPTY);
export const implementationTone = (state: string): Tone => IMPLEMENTATION_TONE[state as ImplementationState] ?? 'neutral';
/** Open: it still waits for the people asked (nothing recorded yet, or some). */
export const implementationOpen = (impl: Pick<Implementation, 'state'> | null | undefined): boolean => impl?.state === 'waiting' || impl?.state === 'in_progress';

/** The line in the details header: "Approved · Waiting for compensating controls"; just the status without an implementation. */
export const statusLine = (status: string, impl: Pick<Implementation, 'state'> | null | undefined): string =>
  impl ? `${exceptionStatus.label(status)} · ${implementationWord(impl.state)}` : exceptionStatus.label(status);

/** Who the implementation waits for: "Waiting for Chen, Bina" (three names, then "and N more"), "Nobody can act" when everyone asked is gone; '' once it is over. */
export function implementerLine(impl: Pick<Implementation, 'state' | 'stalled' | 'asked'>, max = 3): string {
  if (!implementationOpen(impl)) return '';
  if (impl.stalled || impl.asked.length === 0) return 'Nobody can act';
  const names = impl.asked.map((p) => p.name);
  return `Waiting for ${names.slice(0, max).join(', ')}${names.length > max ? ` and ${names.length - max} more` : ''}`;
}

/** "Due 14 Nov 2026", or "Overdue since 14 Nov 2026" once the days are up; '' when no days were set or it is over. */
export function implementationDue(impl: Pick<Implementation, 'state' | 'due_at' | 'overdue'>): string {
  if (!implementationOpen(impl) || !impl.due_at) return '';
  return `${impl.overdue ? 'Overdue since' : 'Due'} ${formatDate(impl.due_at)}`;
}

/** "Implemented by Chen · 4 Nov 2026" once it is done; '' otherwise. */
export function implementedLine(impl: Pick<Implementation, 'state' | 'completed_by_name' | 'completed_at'>): string {
  if (impl.state !== 'done') return '';
  return ['Implemented', impl.completed_by_name ? `by ${impl.completed_by_name}` : '', impl.completed_at ? `· ${formatDate(impl.completed_at)}` : ''].filter(Boolean).join(' ');
}
