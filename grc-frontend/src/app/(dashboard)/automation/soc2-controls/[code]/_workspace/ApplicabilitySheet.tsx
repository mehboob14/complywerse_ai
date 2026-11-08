'use client';

// Whether this control applies to the organisation: ask for it to be marked applicable or not applicable (with the reason a reviewer reads), or rule on a request somebody else made. The server
// holds the rule: both calls need the right to manage frameworks and the reviewer cannot be the person who asked; the sheet shows what it will refuse and why before a click.
import { useEffect, useState } from 'react';
import { Button, FormField, Notice, SegmentedControl, Sheet, StatusPill, Textarea, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { applicabilityRequest } from '@/lib/statuses/controls';
import { Body, Pair, Small } from './parts';
import { REASON_MAX, applicabilityView, decisionBody, decisionProblem, requestBody, requestProblem } from './applicabilityModel';
import { requestApplicability, reviewApplicability } from './workspaceApi';
import { useWorkspace } from './workspaceContext';

export function ApplicabilitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { code, d, rights, me, refresh } = useWorkspace();
  const view = applicabilityView(d.applicability, me, { frameworks: rights.frameworks });
  const scopeId = d.scope_id ?? null;
  const [makeApplicable, setMakeApplicable] = useState<boolean>(view.state === 'not_applicable');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [shownProblem, setShownProblem] = useState<string | null>(null);
  useEffect(() => { if (open) { setMakeApplicable(view.state === 'not_applicable'); setReason(''); setComment(''); setShownProblem(null); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const ask = useReportedMutation({
    mutationFn: () => requestApplicability(scopeId as number, code, requestBody({ makeApplicable, reason })),
    success: { title: 'Request sent', message: 'A reviewer with the right to manage frameworks has to decide it before it changes anything.' },
    failure: "Couldn't send the request",
    toast: 'success',
    onSuccess: () => { void refresh(); onClose(); },
  });
  const rule = useReportedMutation({
    mutationFn: (approve: boolean) => reviewApplicability(scopeId as number, code, decisionBody(approve, comment)),
    success: (_d, approve) => ({ title: approve ? 'Request approved' : 'Request refused', message: approve ? 'The change applies now, and the tests follow it.' : 'The person who asked can see why.' }),
    failure: "Couldn't record the decision",
    toast: 'success',
    onSuccess: () => { void refresh(); onClose(); },
  });

  const dirty = open && (reason.trim() !== '' || comment.trim() !== '');
  const wanting = makeApplicable ? 'applicable' : 'not applicable';
  const send = () => {
    const problem = requestProblem({ makeApplicable, reason });
    setShownProblem(problem);
    if (!problem) ask.mutate();
  };
  const decide = (approve: boolean) => {
    const problem = decisionProblem(approve, comment);
    setShownProblem(problem);
    if (!problem) rule.mutate(approve);
  };
  const error = shownProblem ?? (ask.isError ? errorMessage(ask.error) : rule.isError ? errorMessage(rule.error) : null);

  return (
    <Sheet open={open} onClose={onClose} title="Does this control apply?" subtitle={d.title} width="md" dirty={dirty}>
      <div className="flex flex-col gap-[16px]">
        <div className="flex flex-col gap-[4px]">
          <Body>{view.headline}</Body>
          {view.because && !view.pending && <Small>{view.because}</Small>}
        </div>

        {view.pending && (
          <section aria-label="The request" className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill {...statusPill(applicabilityRequest, 'pending_review')} />
              <Small>{`Asked by ${view.pending.by}${view.pending.at ? ` on ${formatDateTime(view.pending.at)}` : ''}`}</Small>
            </div>
            <div className="mt-[8px] grid gap-[8px]">
              <Pair label="Asked for">{view.pending.asked === 'not_applicable' ? 'Mark it not applicable' : 'Mark it applicable'}</Pair>
              <Pair label="Why">{view.pending.reason ?? 'No reason was given.'}</Pair>
            </div>
          </section>
        )}
        {view.ruled && !view.pending && (
          <section aria-label="The last decision" className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill {...statusPill(applicabilityRequest, view.ruled.approved ? 'approved' : 'rejected')} />
              <Small>{`${view.ruled.by}${view.ruled.at ? `, ${formatDateTime(view.ruled.at)}` : ''}`}</Small>
            </div>
            {view.ruled.comment && <Body className="mt-[6px]">{view.ruled.comment}</Body>}
          </section>
        )}

        {error && <Notice tone="danger" title="Check this first">{error}</Notice>}
        {view.blocked && <Notice tone="info">{view.blocked}</Notice>}
        {!scopeId && <Notice tone="warning" title="Your scope is not set up">Choose your frameworks first; whether a control applies is decided within a scope.</Notice>}

        {view.canDecide && scopeId && (
          <FormField label="Your comment" hint="Shown to the person who asked. Needed when you refuse.">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={REASON_MAX} rows={3} />
          </FormField>
        )}
        {view.canDecide && scopeId && (
          <div className="flex flex-wrap gap-[8px]">
            <Button variant="primary" loading={rule.isPending && rule.variables === true} disabled={rule.isPending} onClick={() => decide(true)}>Approve</Button>
            <Button loading={rule.isPending && rule.variables === false} disabled={rule.isPending} onClick={() => decide(false)}>Refuse</Button>
          </div>
        )}

        {view.canRequest && scopeId && (
          <>
            <FormField label="What should change?">
              <SegmentedControl
                label="What should change"
                name="ws-applicability"
                options={[{ value: 'no', label: 'Does not apply' }, { value: 'yes', label: 'Applies' }]}
                value={makeApplicable ? 'yes' : 'no'}
                onChange={(v) => setMakeApplicable(v === 'yes')}
              />
            </FormField>
            <FormField label="Why" required={!makeApplicable} optional={makeApplicable} hint={`A reviewer reads this before ${makeApplicable ? 'marking the control applicable' : 'marking the control not applicable'}.`}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={4} />
            </FormField>
            <div>
              <Button variant="primary" loading={ask.isPending} onClick={send}>{`Ask to mark it ${wanting}`}</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
