'use client';

// One onboarding request: the requester answers and submits; the TPRM team picks
// it up (starting the lifecycle, tiered from the answers), sends it back or turns
// it down. Approval happens at the lifecycle's approval gate.

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, Loader2, RotateCcw, Send, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { vendorOnboardingApi, tpraApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import IntakeForm, { useIntake } from '../../_lib/intake/IntakeForm';
import { IntakePayload, STATUS_CLS, STATUS_LABEL, errText } from '../../_lib/intake/types';
import { URGENCY_WORD } from '../../_lib/intakeModel';
import { fmtDate } from '../../_lib/tprmShared';
import DuplicateBox from '../_components/DuplicateBox';
import ReasonDialog from '../_components/ReasonDialog';

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
  const { toast } = useToast();
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const { data, isLoading, isError } = useIntake(id);
  const [asking, setAsking] = useState<null | 'reject' | 'return' | 'reopen'>(null);
  const [error, setError] = useState<string | null>(null);

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
    qc.invalidateQueries({ queryKey: ['tprm-requests'] });
    qc.invalidateQueries({ queryKey: ['tprm-request-trail', id] });
    setError(null);
  };
  const act = useMutation({
    mutationFn: async (fn: () => Promise<{ data: IntakePayload }>) => {
      await flushRef.current?.();
      return (await fn()).data;
    },
    onSuccess: (payload) => refresh(payload),
    onError: (e) => setError(errText(e, 'That did not work')),
  });

  if (isLoading) return <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (isError || !data) return <p className="py-10 text-sm text-rose-700">This request could not be found.</p>;

  const status = data.intake_status || 'draft';
  const requester = data.requested_by ? data.people[String(data.requested_by)] : null;
  const busy = act.isPending;
  const button = 'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50';

  return (
    <div className="space-y-5">
      <div>
        <Link href="/vendor-risk/intake" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to intake
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-slate-900">{data.vendor.name}</h1>
              <span className={clsx('rounded-full border px-2.5 py-0.5 text-xs font-medium', STATUS_CLS[status])}>{STATUS_LABEL[status]}</span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {requester ? `Requested by ${requester}` : 'Requested'}
              {data.submitted_at ? ` · submitted ${fmtDate(data.submitted_at)}` : ''}
              {data.vendor.website ? ` · ${data.vendor.website}` : ''}
              {data.request?.department ? ` · ${data.request.department}` : ''}
              {data.request ? ` · ${URGENCY_WORD[data.request.urgency] ?? ''}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status === 'draft' && data.can_edit && (
              <button type="button" disabled={busy} className={clsx(button, 'bg-primary-600 text-white hover:bg-primary-700')}
                onClick={() => act.mutate(() => vendorOnboardingApi.submit(id))}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Submit for review{data.problems.length ? ` (${data.problems.length} to go)` : ''}
              </button>
            )}
            {status === 'submitted' && data.can_review && (
              <>
                <button type="button" disabled={busy} className={clsx(button, 'border border-slate-200 text-slate-700 hover:bg-slate-50')}
                  onClick={() => setAsking('return')}>
                  <RotateCcw className="h-4 w-4" /> Send back
                </button>
                <button type="button" disabled={busy} className={clsx(button, 'border border-rose-200 text-rose-700 hover:bg-rose-50')}
                  onClick={() => setAsking('reject')}>
                  <XCircle className="h-4 w-4" /> Decline
                </button>
                <button type="button" disabled={busy} className={clsx(button, 'bg-primary-600 text-white hover:bg-primary-700')}
                  onClick={() => act.mutate(() => vendorOnboardingApi.startReview(id), { onSuccess: () => toast({ type: 'success', title: `${data.vendor.name} added to the register` }) })}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve and create
                </button>
              </>
            )}
            {status === 'rejected' && data.can_edit && (
              <button type="button" disabled={busy} className={clsx(button, 'border border-slate-200 text-slate-700 hover:bg-slate-50')}
                onClick={() => setAsking('reopen')}>
                <RotateCcw className="h-4 w-4" /> Reopen with changes
              </button>
            )}
            {(status === 'in_review' || status === 'approved') && (
              <button type="button" className={clsx(button, 'bg-slate-900 text-white hover:bg-slate-800')}
                onClick={() => router.push(`/vendor-risk/vendors/${id}`)}>
                Open the vendor <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={clsx('flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm',
        status === 'rejected' ? 'border-rose-200 bg-rose-50 text-rose-800' : status === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-slate-200 bg-slate-50 text-slate-700')}>
        {status === 'approved' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0" />}
        <div>
          <p>{EXPLAIN[status]}</p>
          {lastDecision && (status === 'rejected' || status === 'draft') && (
            <p className="mt-1 text-xs">
              <span className="font-medium">{lastDecision.actor_name || 'The review team'}:</span> “{lastDecision.reason}”
            </p>
          )}
        </div>
      </div>
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700">{error}</p>}
      <DuplicateBox title="Already in the register" matches={data.duplicates ?? []}
        footnote={status === 'submitted' ? 'Approving creates a duplicate unless these are different organisations.' : undefined} />

      <IntakeForm vendorId={id} flushRef={flushRef} onSaved={() => qc.invalidateQueries({ queryKey: ['tprm-requests'] })} />

      <ReasonDialog
        open={asking !== null} busy={busy} error={error}
        title={asking === 'reject' ? 'Decline this request' : asking === 'return' ? 'Send it back to the requester' : 'Reopen the request'}
        description={asking === 'reject' ? 'The requester sees this reason.'
          : asking === 'return' ? 'Say what they need to change or add.' : 'Say what has changed since it was declined.'}
        confirmLabel={asking === 'reject' ? 'Decline request' : asking === 'return' ? 'Send back' : 'Reopen'}
        danger={asking === 'reject'}
        onClose={() => setAsking(null)}
        onConfirm={(reason) => act.mutate(
          () => (asking === 'reject' ? vendorOnboardingApi.reject(id, reason) : vendorOnboardingApi.sendBack(id, reason)),
          { onSuccess: () => setAsking(null) },
        )}
      />
    </div>
  );
}
