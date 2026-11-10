'use client';

// The one button of a work-list row: take the expected next step of an issue or a corrective action, in the row. The calls, the words and the refreshed keys are the registers' own
// (a step taken here and in the register cannot disagree); approving a closure asks for its notes in the same dialog the register uses, and a failure is said with Retry and keeps the dialog open.
import { useState } from 'react';
import { useReportedMutation } from '@/components/ui/ds';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { issuesApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { codeOf, type IssueRow } from '@/lib/issues/issueDef';
import type { ActionRow } from '@/lib/issues/actionDef';
import type { ActionStep, IssueStep } from '@/lib/issues/words';
import { actionStatus, issueState } from '@/lib/statuses/issues';
import { StepDialog } from '../register/_register/StepDialog';
import type { WorkAct } from './overviewModel';

// the lists, the issue and its actions, the old Closure Tracker's key, and the module's score (a step moves it)
const STALE = [['issues'], ['issue-detail'], ['issue-activity'], ['issue-actions'], ['capa-actions'], ['issues-dashboard'], [...SCORECARD_QUERY_KEYS.issues]];

export function useWorkSteps() {
  const [asking, setAsking] = useState<{ issue: IssueRow; step: IssueStep } | null>(null);

  const moveIssue = useReportedMutation({
    mutationFn: async (v: { issue: IssueRow; step: IssueStep; text?: string }) => {
      if (v.step.kind === 'close') return (await issuesApi.close(v.issue.id, { closure_notes: v.text ?? '' })).data;
      if (v.step.kind === 'reopen') return (await issuesApi.reopen(v.issue.id, { reason: v.text ?? '' })).data;
      return (await issuesApi.transition(v.issue.id, { to_state: v.step.to })).data;
    },
    success: (_d, v) => (v.step.kind === 'close' ? 'Closure approved' : v.step.kind === 'reopen' ? 'Issue reopened' : `Moved to ${issueState.label(v.step.to)}`),
    failure: "Couldn't change the issue",
    invalidate: STALE,
    onSuccess: () => setAsking(null),
  });
  const moveAction = useReportedMutation({
    mutationFn: async (v: { action: ActionRow; step: ActionStep }) => (v.step.kind === 'verify'
      ? (await issuesApi.actions.verify(v.action.id, {})).data
      : (await issuesApi.actions.patch(v.action.id, { status: v.step.to })).data),
    success: (_d, v) => (v.step.kind === 'verify' ? 'Action verified' : `Marked ${actionStatus.label(v.step.to).toLowerCase()}`),
    failure: "Couldn't change the action",
    invalidate: STALE,
  });

  /** Runs what a row's button says. A link is the row's own anchor (nothing to run here). */
  const run = (act: WorkAct) => {
    if (act.type === 'issue-step') {
      if (act.step.kind === 'close' || act.step.kind === 'reopen') setAsking({ issue: act.issue, step: act.step });
      else moveIssue.mutate({ issue: act.issue, step: act.step });
    } else if (act.type === 'action-step') {
      moveAction.mutate({ action: act.action, step: act.step });
    }
  };

  /** Whether the row with this key has its step on the way (its button says so and does nothing). */
  const busy = (key: string): boolean =>
    (moveIssue.isPending && moveIssue.variables ? `issue-${moveIssue.variables.issue.id}` === key : false)
    || (moveAction.isPending && moveAction.variables ? `action-${moveAction.variables.action.id}` === key : false);

  const dialog = asking ? (
    <StepDialog
      step={asking.step}
      issueName={`${codeOf(asking.issue)} · ${truncate(asking.issue.title, 80).text}`}
      saving={moveIssue.isPending}
      onClose={() => setAsking(null)}
      onSubmit={(text) => moveIssue.mutate({ issue: asking.issue, step: asking.step, text })}
    />
  ) : null;

  return { run, busy, dialog };
}
