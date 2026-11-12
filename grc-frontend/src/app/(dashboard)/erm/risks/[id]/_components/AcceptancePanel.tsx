'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { ermApi } from '@/lib/api';
import { errorText } from '@/components/settings/CustomFields';
import {
  acceptanceBadge, acceptanceExpiryRange, responseLabel, type AcceptanceBadge, type RiskRecordFields,
} from '../../_components/riskRecord';

const TONE: Record<AcceptanceBadge['tone'], string> = {
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  orange: 'border-orange-200 bg-orange-50 text-orange-700',
  rose: 'border-rose-200 bg-rose-50 text-rose-700',
};

const INPUT = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

type AcceptanceRisk = RiskRecordFields & {
  id: number;
  status?: string;
  acceptance_requested_by_name?: string | null;
  accepted_by_name?: string | null;
};

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/**
 * The risk's response and its acceptance: ask for it (reason, expiry within 12 months), and a second person with the
 * treatment right approves or refuses. The server refuses the person who asked (maker-checker), and says so.
 */
export default function AcceptancePanel({ risk, canRequest, canDecide }: { risk: AcceptanceRisk; canRequest: boolean; canDecide: boolean }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const range = acceptanceExpiryRange();
  const badge = acceptanceBadge(risk.acceptance_state, risk.acceptance_expires_at);
  const state = risk.acceptance_state || 'none';

  const settle = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', risk.id] });
      queryClient.invalidateQueries({ queryKey: ['risk-history', risk.id] });
      setAsking(false); setReason(''); setExpiresAt(''); setNote(''); setError(null);
    },
    onError: (e: unknown) => setError(errorText(e, 'Could not save the acceptance.')),
  };
  const request = useMutation({ mutationFn: () => ermApi.risks.requestAcceptance(risk.id, { reason: reason.trim(), expires_at: expiresAt }), ...settle });
  const approve = useMutation({ mutationFn: () => ermApi.risks.approveAcceptance(risk.id, note.trim() || undefined), ...settle });
  const reject = useMutation({ mutationFn: () => ermApi.risks.rejectAcceptance(risk.id, note.trim()), ...settle });
  const busy = request.isPending || approve.isPending || reject.isPending;

  return (
    <div className="cw-card rounded-xl p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} /> Response &amp; acceptance
      </div>
      <div className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-xs text-slate-500">Response</span>
        <span className="text-sm font-medium text-slate-800">{responseLabel(risk.response) || <span className="font-normal text-slate-400">Not chosen</span>}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
        <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', TONE[badge.tone])}>{badge.label}</span>
        {badge.detail && <span className="text-xs text-slate-500">{badge.detail}</span>}
      </div>

      {state !== 'none' && (
        <dl className="mt-1 space-y-1 rounded-lg border border-slate-100 bg-slate-50/50 p-2.5 text-xs">
          <div><dt className="inline text-slate-500">Reason: </dt><dd className="inline whitespace-pre-wrap text-slate-800">{risk.acceptance_reason || '—'}</dd></div>
          <div><dt className="inline text-slate-500">Asked by: </dt><dd className="inline text-slate-800">{risk.acceptance_requested_by_name || '—'} on {when(risk.acceptance_requested_at)}</dd></div>
          {risk.accepted_by && state !== 'requested' && (
            <div><dt className="inline text-slate-500">Approved by: </dt><dd className="inline text-slate-800">{risk.accepted_by_name || '—'} on {when(risk.accepted_at)}</dd></div>
          )}
          <div><dt className="inline text-slate-500">Until: </dt><dd className="inline text-slate-800">{when(risk.acceptance_expires_at)}</dd></div>
        </dl>
      )}
      {state === 'none' && risk.status === 'accepted' && (
        <p className="mt-1 text-xs text-amber-700">Marked accepted with no approval on record. Request acceptance to record an approver and an expiry.</p>
      )}
      {state === 'none' && risk.acceptance_status === 'rejected' && (
        <p className="mt-1 text-xs text-slate-500">The last acceptance request was refused; the History tab says why.</p>
      )}

      {state === 'requested' && canDecide && (
        <div className="mt-3 space-y-2">
          <label htmlFor="acceptance-note" className="block text-xs font-medium text-slate-700">Decision note (required to refuse)</label>
          <textarea id="acceptance-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={INPUT}
            placeholder="Why you approve or refuse accepting this risk" />
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy || !note.trim()} onClick={() => reject.mutate()}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
              <XCircle className="h-3.5 w-3.5" strokeWidth={1.75} /> Refuse
            </button>
            <button type="button" disabled={busy} onClick={() => approve.mutate()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary-500 px-2.5 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
              {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />} Approve acceptance
            </button>
          </div>
        </div>
      )}

      {state !== 'requested' && canRequest && !asking && (
        <button type="button" onClick={() => setAsking(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
          {state === 'none' ? 'Request acceptance' : 'Request a new acceptance'}
        </button>
      )}
      {asking && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); request.mutate(); }}>
          <label htmlFor="acceptance-reason" className="block text-xs font-medium text-slate-700">Why accept this risk</label>
          <textarea id="acceptance-reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT}
            placeholder="E.g. the cost of a control exceeds the expected loss; within appetite" />
          <label htmlFor="acceptance-expiry" className="block text-xs font-medium text-slate-700">Acceptance expires on (at most 12 months)</label>
          <input id="acceptance-expiry" type="date" required min={range.min} max={range.max} value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)} className={INPUT} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAsking(false); setError(null); }}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary-500 px-2.5 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
              {request.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send for approval
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
    </div>
  );
}
