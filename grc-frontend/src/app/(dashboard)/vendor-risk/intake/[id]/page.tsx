'use client';

// One onboarding request: the requester answers and submits; the TPRM team picks it up (starting the lifecycle, tiered from the answers), sends it back or turns it down. Approval of the
// supplier happens at the lifecycle's approval gate. The page head carries the name, where the request stands and the actions of the person who may take them; "Approve and create" asks first
// (what it starts, and what it may duplicate) and, as on the Intake list, goes to the supplier afterwards. What was typed is saved before any action is taken.
import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, RotateCcw, Send, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Notice, SkeletonRows, StatusPill, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { vendorOnboardingApi, tpraApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import IntakeForm, { useIntake } from '../../_lib/intake/IntakeForm';
import type { IntakePayload } from '../../_lib/intake/types';
import { approvalNote, decisionPill, urgencyPill } from '../../_lib/intakeModel';
import DuplicateBox from '../_components/DuplicateBox';
import ReasonDialog from '../_components/ReasonDialog';

type Asking = null | 'reject' | 'return' | 'reopen';

const EXPLAIN: Record<string, string> = {
  draft: 'Answer the questions, then submit. Your answers save as you type.',
  submitted: 'With the TPRM team. They can approve it, send it back to you with a note, or decline it.',
  in_review: 'Approved and created. The lifecycle has started from these answers; final approval happens at its approval gate.',
  approved: 'Approved. The supplier is now in the vendor register.',
  rejected: 'Declined. The requester can reopen it with changes.',
};

export default function RequestPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params?.id);
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const { data, isLoading, isError, error, refetch } = useIntake(id);
  const [asking, setAsking] = useState<Asking>(null);

  const { data: trail } = useQuery({
    queryKey: ['tprm-request-trail', id, data?.intake_status],
    queryFn: async () => ((await tpraApi.getVendorAudit(id, 40)).data?.items || []) as Array<{
      entity: string; to_value: string | null; reason: string | null; actor_name: string | null; created_at: string;
    }>,
    enabled: !!data,
  });
  const lastDecision = (trail || []).find((t) => t.entity === 'request' && t.reason);

  const refresh = (payload?: IntakePayload) => {
    if (payload) qc.setQueryData(['tprm-intake', id], payload);
    qc.invalidateQueries({ queryKey: ['tprm-request-trail', id] });
  };
  // what typed text is waiting is saved first; every action then reports (a confirmation, or the failure with its words and a Retry)
  const submit = useReportedMutation({
    mutationFn: async () => {
      await flushRef.current?.();
      return (await vendorOnboardingApi.submit(id)).data as IntakePayload;
    },
    success: 'Submitted for review',
    failure: 'Not submitted',
    invalidate: [['tprm-requests'], ['tprm-dashboard'], ['tprm-attention']],
    onSuccess: (payload) => refresh(payload),
  });
  const approve = useReportedMutation({
    mutationFn: async () => {
      await flushRef.current?.();
      await vendorOnboardingApi.startReview(id);
    },
    success: () => `${data?.vendor.name ?? 'The vendor'} added to the register`,
    failure: 'Not approved',
    invalidate: [['tprm-requests'], ['tprm-intake', id], ['tprm-dashboard'], ['tprm-attention'], ['vendors']],
    onSuccess: () => router.push(`/vendor-risk/vendors/${id}`),
  });
  const decide = useReportedMutation({
    mutationFn: async ({ how, reason }: { how: 'reject' | 'return' | 'reopen'; reason: string }) => {
      await flushRef.current?.();
      return (await (how === 'reject' ? vendorOnboardingApi.reject(id, reason) : vendorOnboardingApi.sendBack(id, reason))).data as IntakePayload;
    },
    success: (_, v) => (v.how === 'reject' ? 'Request declined' : v.how === 'return' ? 'Sent back to the requester' : 'Request reopened'),
    failure: 'That did not work',
    toast: 'success',                                  // a failure is said in the sheet that asked for the reason
    invalidate: [['tprm-requests'], ['tprm-dashboard'], ['tprm-attention']],
    onSuccess: (payload) => { refresh(payload); setAsking(null); },
  });

  if (isLoading) return <div className="flex flex-col gap-[16px]"><SkeletonRows rows={4} columns={3} label="Loading the request" /></div>;
  if (isError || !data) {
    return statusOf(error) === 404
      ? <EmptyState kind="firstUse" title="This request could not be found" description="It may have been removed, or it is not in your organisation." action={<Button href="/vendor-risk/intake" variant="primary">Back to intake</Button>} />
      : <ErrorState title="Couldn't load the request" message={errorMessage(error)} onRetry={canRetry(error) ? () => { void refetch(); } : undefined} />;
  }

  const status = data.intake_status || 'draft';
  const requester = data.requested_by ? data.people[String(data.requested_by)] : null;
  const busy = submit.isPending || approve.isPending || decide.isPending;
  const pill = decisionPill(status);
  const urgency = data.request ? urgencyPill(data.request.urgency) : null;
  const meta = [
    requester ? `Requested by ${requester}` : 'Requested',
    data.submitted_at ? `submitted ${formatDate(data.submitted_at)}` : null,
    data.vendor.website,
    data.request?.department,
  ].filter(Boolean).join(' · ');
  const askApprove = async () => {
    const yes = await confirm({
      title: `Approve ${data.vendor.name}?`,
      message: <div className="flex flex-col gap-[8px]">{approvalNote(data.vendor.name, data.duplicates ?? []).map((line) => <p key={line} className="text-ds-body text-ds-fg-body">{line}</p>)}</div>,
      confirmLabel: 'Approve and create',
    });
    if (yes) approve.mutate();
  };
  const doing = asking === 'reject' ? 'Decline this request' : asking === 'return' ? 'Send it back to the requester' : 'Reopen the request';

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={data.vendor.name}
        back={{ href: '/vendor-risk/intake', label: 'Back to intake' }}
        meta={meta}
        chips={(
          <>
            <StatusPill tone={pill.tone} label={pill.label} />
            {urgency && (status === 'draft' || status === 'submitted') && <StatusPill tone={urgency.tone} label={urgency.label} />}
          </>
        )}
        actions={(
          <>
            {status === 'draft' && data.can_edit && (
              <Button variant="primary" leftIcon={<Send aria-hidden />} loading={submit.isPending} disabled={busy}
                onClick={() => submit.mutate()}>
                Submit for review{data.problems.length ? ` (${data.problems.length} to go)` : ''}
              </Button>
            )}
            {status === 'submitted' && data.can_review && (
              <>
                <Button leftIcon={<RotateCcw aria-hidden />} disabled={busy} onClick={() => { decide.reset(); setAsking('return'); }}>Send back</Button>
                <Button variant="dangerOutline" leftIcon={<XCircle aria-hidden />} disabled={busy} onClick={() => { decide.reset(); setAsking('reject'); }}>Decline</Button>
                <Button variant="primary" leftIcon={<Check aria-hidden />} loading={approve.isPending} disabled={busy} onClick={() => { void askApprove(); }}>Approve and create</Button>
              </>
            )}
            {status === 'rejected' && data.can_edit && (
              <Button leftIcon={<RotateCcw aria-hidden />} disabled={busy} onClick={() => { decide.reset(); setAsking('reopen'); }}>Reopen with changes</Button>
            )}
            {(status === 'in_review' || status === 'approved') && <Button variant="primary" href={`/vendor-risk/vendors/${id}`}>Open the vendor</Button>}
          </>
        )}
      />

      <Notice tone={status === 'rejected' ? 'warning' : 'info'}>
        {EXPLAIN[status]}
        {lastDecision && (status === 'rejected' || status === 'draft') && (
          <span className="mt-[4px] block text-ds-label text-ds-fg-body"><span className="font-[600]">{lastDecision.actor_name || 'The review team'}:</span> “{lastDecision.reason}”</span>
        )}
      </Notice>
      <DuplicateBox title="Already in the register" matches={data.duplicates ?? []}
        footnote={status === 'submitted' ? 'Approving creates a duplicate unless these are different organisations.' : undefined} />

      <IntakeForm vendorId={id} flushRef={flushRef} onSaved={() => qc.invalidateQueries({ queryKey: ['tprm-requests'] })} />

      <ReasonDialog
        open={asking !== null} busy={decide.isPending} error={decide.isError ? errorMessage(decide.error, 'That did not work') : null}
        title={doing}
        description={asking === 'reject' ? 'The requester sees this reason.' : asking === 'return' ? 'Say what they need to change or add.' : 'Say what has changed since it was declined.'}
        confirmLabel={asking === 'reject' ? 'Decline request' : asking === 'return' ? 'Send back' : 'Reopen'}
        danger={asking === 'reject'}
        onClose={() => setAsking(null)}
        onConfirm={(reason) => asking && decide.mutate({ how: asking, reason })}
      />
      {confirmDialog}
    </div>
  );
}
