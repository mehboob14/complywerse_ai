'use client';

// The approval of an exception that goes through a rule (Governance > Settings > Exception approvals), in its details drawer: the rule, the steps as a
// stepper with where each stands and who it asks, who the exception waits for (said in a live region, so a decision is heard), who decided what in this
// round and, opened on request, the rounds before it; and, for the person asked now, what the open step lets them do (Approve, Ask for changes, Reject: only
// what `my_step` allows) and Withdraw for whoever the server lets. The dialogs for the decisions and the question for Withdraw are the page's (the callbacks).
// Words and rules: _approval.ts. An exception no rule applied to has no `approval`, and none of this is drawn: it is decided as it always was.
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Check, ChevronDown, ChevronRight, Clock, MessageSquare, Undo2, XCircle } from 'lucide-react';
import { policyExceptionApi } from '@/lib/api';
import { kindName } from '@/lib/exceptionRules';
import type { Tone } from '@/lib/status';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, SkeletonLines, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import {
  APPROVE_HINT, approveBlocked, decisionOptions, decisionRows, dueText, earlierRounds, progressText, roundMeta, runTone, runWord, slotChips, stepWord, waitingLine,
  type DecisionRow,
} from './_approval';
import type { DecisionKind } from './_Decision';
import type { ApprovalHistory, ExceptionApproval, ExceptionItem } from './_types';

const MARKER = 'grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full border text-ds-label';
const MARKER_TONE: Record<Tone, string> = {
  success: 'border-ds-border bg-ds-success-soft text-ds-success',
  pending: 'border-ds-primary bg-ds-primary text-ds-on-primary',
  danger: 'border-ds-danger-border bg-ds-danger-soft text-ds-danger',
  warning: 'border-ds-border bg-ds-warning-soft text-ds-warning',
  progress: 'border-ds-border bg-ds-info-soft text-ds-info',
  neutral: 'border-ds-border-strong bg-ds-surface text-ds-fg-muted',
};
const CHIP = 'inline-flex max-w-full items-center gap-[4px] rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-body';
const CAPTION = 'text-ds-label text-ds-fg-muted';

/** Who decided what, one row each: the person, what they did, at which step, their comment and when. */
function DecisionList({ rows, label }: { rows: DecisionRow[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-[8px]">
      {rows.map((r) => (
        <li key={r.key} className="rounded-ds-card bg-ds-surface-subtle p-[10px]">
          <div className="flex flex-wrap items-center justify-between gap-x-[8px] gap-y-[2px]">
            <span className="flex min-w-0 flex-wrap items-center gap-[6px]">
              <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.who}</span>
              <StatusPill size="sm" tone={r.tone} label={r.word} />
              <span className={CAPTION}>{r.step}</span>
            </span>
            <time className={CAPTION} dateTime={r.at ?? undefined}>{r.when}</time>
          </div>
          {r.comment && <p className="mt-[4px] whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{r.comment}</p>}
        </li>
      ))}
    </ul>
  );
}

/** The rounds before this one, asked of the server only when they are opened (each time an exception was sent back, withdrawn or rejected and then submitted again). */
function EarlierRounds({ id, round }: { id: number; round: number }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const history = useQuery({
    queryKey: ['policy-exceptions', 'approval', id],
    queryFn: async () => (await policyExceptionApi.getApproval(id)).data as ApprovalHistory,
    enabled: open,
    retry: (n, e) => n < 2 && canRetry(e),
  });
  const rounds = earlierRounds(history.data, round);
  return (
    <div>
      <Button variant="link" size="sm" aria-expanded={open} aria-controls={panel} leftIcon={open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />} onClick={() => setOpen(!open)}>
        {open ? 'Hide earlier rounds' : `Earlier rounds (${round - 1})`}
      </Button>
      <div id={panel} hidden={!open} className="mt-[8px]">
        {history.isLoading ? <SkeletonLines lines={2} label="Loading the earlier rounds" />
          : history.isError ? <ErrorState compact title="Couldn't load the earlier rounds" message={errorMessage(history.error)} onRetry={canRetry(history.error) ? () => { void history.refetch(); } : undefined} />
          : (
            <ol className="flex flex-col gap-[12px]">
              {rounds.map((r) => (
                <li key={r.round} className="flex flex-col gap-[6px]">
                  <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                    <span className="text-ds-body font-[600] text-ds-fg">{`Round ${r.round}`}</span>
                    <StatusPill size="sm" tone={runTone(r.status)} label={runWord(r.status)} />
                    <span className={clsx(CAPTION, '[overflow-wrap:anywhere]')}>{roundMeta(r)}</span>
                  </div>
                  {r.decisions.length > 0 ? <DecisionList rows={decisionRows(r.decisions)} label={`Decisions of round ${r.round}`} /> : <span className={CAPTION}>No decisions</span>}
                </li>
              ))}
            </ol>
          )}
      </div>
    </div>
  );
}

export function ApprovalPanel({ exception: e, approval: a, onDecide, onWithdraw, withdrawing }: {
  exception: ExceptionItem;
  approval: ExceptionApproval;
  /** opens the page's dialog for the decision */
  onDecide: (kind: Exclude<DecisionKind, 'revoke'>) => void;
  /** asks the page's question, then takes the exception back to a draft */
  onWithdraw: () => void;
  withdrawing: boolean;
}) {
  const headingId = useId();
  const gateId = useId();
  const live = a.status === 'open';
  const options = live && e.can_decide ? decisionOptions(a.my_step) : [];
  // under a rule an approval needs the person's own assessment at this step: Approve waits for it (the server refuses it too); Ask for changes and Reject do not
  const gated = options.includes('approve') && approveBlocked(a.my_step);
  const waiting = waitingLine(a);
  const rows = decisionRows(a.decisions);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]">
      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
        <h3 id={headingId} className="!text-ds-section !text-ds-fg">Approval</h3>
        <StatusPill size="sm" tone={runTone(a.status)} label={runWord(a.status)} />
        <span className={clsx(CAPTION, 'min-w-0 [overflow-wrap:anywhere]')}>{`Rule: ${a.rule.name}${a.round > 1 ? ` · Round ${a.round}` : ''}`}</span>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {waiting && (
          <p className={clsx('flex items-center gap-[6px] text-ds-body', a.stalled ? 'text-ds-danger' : 'text-ds-fg')}>
            <Clock aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{waiting}</span>
            {a.stalled && (
              <InfoTip label="About nobody can act"
                text="Everyone asked at this step is gone or not active. Withdraw it, ask an administrator to change the rule or the owners, and submit it again." />
            )}
          </p>
        )}
      </div>

      <ol aria-label="Approval steps" className="flex flex-col gap-[12px]">
        {a.steps.map((s) => {
          const word = stepWord(s, a.status);
          const progress = progressText(s.progress);
          const due = dueText(s);
          const chips = slotChips(s);
          return (
            <li key={s.position} aria-current={live && s.state === 'active' ? 'step' : undefined} className="flex items-start gap-[12px]">
              <span aria-hidden className={clsx(MARKER, MARKER_TONE[word.tone])}>
                {s.state === 'done' ? <Check className="h-[14px] w-[14px]" strokeWidth={2.5} /> : s.position}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                  <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{s.name}</span>
                  {s.name !== kindName(s.kind) && <span className={CAPTION}>{kindName(s.kind)}</span>}
                  <StatusPill size="sm" tone={word.tone} label={word.label} />
                  {progress && <span className={CAPTION}><span className="sr-only">Answered </span>{progress}</span>}
                  {due && <span className={clsx('text-ds-label', s.overdue ? 'text-ds-danger' : 'text-ds-fg-muted')}>{due}</span>}
                </div>
                {chips.length > 0 && (
                  <ul aria-label={`Asked at ${s.name}`} className="mt-[4px] flex flex-wrap gap-[4px]">
                    {chips.map((c, i) => (
                      <li key={i} className={CHIP}>
                        {c.answered && <Check aria-hidden strokeWidth={2.5} className="h-[12px] w-[12px] shrink-0 text-ds-success" />}
                        <span className="min-w-0 [overflow-wrap:anywhere]">{c.answered && <span className="sr-only">Approved: </span>}{c.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {rows.length > 0 && (
        <div className="flex flex-col gap-[4px]">
          <span className={CAPTION}>Decisions</span>
          <DecisionList rows={rows} label="Decisions of this round" />
        </div>
      )}

      {a.round > 1 && <EarlierRounds id={e.id} round={a.round} />}

      {(options.length > 0 || (live && e.can_withdraw)) && (
        <div role="group" aria-label="What you can do" className="flex flex-wrap items-center gap-[8px] border-t border-ds-border pt-[12px]">
          {options.length > 0 && a.my_step && <span className="mr-auto min-w-0 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{`Your turn · ${a.my_step.name}`}</span>}
          {options.includes('approve') && <Button variant="primary" leftIcon={<Check aria-hidden />} disabled={gated} aria-describedby={gated ? gateId : undefined} onClick={() => onDecide('approve')}>Approve</Button>}
          {options.includes('changes') && <Button leftIcon={<MessageSquare aria-hidden />} onClick={() => onDecide('changes')}>Ask for changes</Button>}
          {options.includes('reject') && <Button variant="dangerOutline" leftIcon={<XCircle aria-hidden />} onClick={() => onDecide('reject')}>Reject</Button>}
          {live && e.can_withdraw && <Button leftIcon={<Undo2 aria-hidden />} loading={withdrawing} onClick={onWithdraw}>Withdraw</Button>}
          {gated && <p id={gateId} className="w-full text-ds-label text-ds-fg-muted">{APPROVE_HINT}</p>}
        </div>
      )}
    </section>
  );
}
