'use client';

// The outsourcing steps beside the lifecycle (EBA/GL/2019/02, SBP outsourcing framework): materiality, the exit plan, sub-outsourcing
// and the regulator's notice, one line each, with where to set it. Materiality is the second line's call at tiering; the rest applies
// only to a critical or important scope and holds the gates (contracting, approval, onboarding). The words are outsourcingModel's.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Scale, X } from 'lucide-react';
import { BTN, BTN_PRIMARY, Dialog, StatusPill } from '@/app/(dashboard)/vendor-risk/_ui';
import { tpraApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '../../../_lib/lifecycleApi';
import {
  EXIT_STATUSES, MIN_REASON, exitPlanReady, materialityChanges, noticeReady, outsourcingRows, reasonReady, type Outsourcing,
  type RailKey,
} from '../../../_lib/outsourcingModel';

const FIELD = 'w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 py-2 text-[14px] text-[#1f2933] placeholder:text-[#8a95a1] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#99d5cf]';
const LABEL = 'mb-1 block text-[13px] font-medium text-[#26323d]';
const SMALL = `${BTN} !h-8 !px-2.5 !text-[13px]`;

export const outsourcingKey = (vendorId: number, engagementId: number | null) => ['tpra-outsourcing', vendorId, engagementId ?? 0];

export function useOutsourcing(vendorId: number, engagementId: number | null) {
  return useQuery({
    queryKey: outsourcingKey(vendorId, engagementId),
    queryFn: async () => (await tpraApi.getOutsourcing(vendorId, engagementId)).data as Outsourcing,
  });
}

export default function OutsourcingPanel({ vendorId, engagementId, open, onOpen, onChanged }: {
  vendorId: number;
  engagementId: number | null;
  /** the line whose form is open (a stage check's fix can open one) */
  open: RailKey | null;
  onOpen: (key: RailKey | null) => void;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const fallback = hasPermission('erm:risks:edit');
  const may: Record<RailKey, boolean> = {
    materiality: fallback || hasPermission('vendor_risk:assessments:edit'),
    exit_plan: fallback || hasPermission('vendor_risk:contracts:edit'),
    sub_outsourcing: hasPermission('vendor_risk:approvals:approve'),
    regulator: fallback || hasPermission('vendor_risk:lifecycle:advance'),
  };
  const { data, isLoading } = useOutsourcing(vendorId, engagementId);

  const [ci, setCi] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState({ status: 'draft', summary: '', link: '' });
  const [notice, setNotice] = useState<{ required: boolean | null; sent_on: string; reference: string }>({ required: null, sent_on: '', reference: '' });
  const today = new Date().toISOString().slice(0, 10);

  // Each form opens on what is saved.
  useEffect(() => {
    if (!open || !data) return;
    setCi(data.critical_important);
    setReason(data.materiality?.reason ?? '');
    setPlan({ status: data.exit_plan?.status ?? 'draft', summary: data.exit_plan?.summary ?? '', link: data.exit_plan?.link ?? '' });
    setNotice({ required: data.regulator?.required ?? null, sent_on: data.regulator?.sent_on ?? '', reference: data.regulator?.reference ?? '' });
  }, [open, data]);

  const done = (title: string) => () => {
    qc.invalidateQueries({ queryKey: ['tpra-outsourcing', vendorId] });
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle', vendorId] });
    onChanged?.();
    toast({ type: 'success', title });
  };
  const failed = (e: unknown) => toast({ type: 'error', title: 'Not saved', message: apiErrorText(e, 'Try again.') });
  const save = useMutation({
    mutationFn: async () => {
      if (open === 'materiality') return tpraApi.setMateriality(vendorId, { critical_important: !!ci, reason: reason.trim() }, engagementId);
      if (open === 'exit_plan') {
        return tpraApi.setExitPlan(vendorId, { status: plan.status, summary: plan.summary.trim() || null, link: plan.link.trim() || null }, engagementId);
      }
      return tpraApi.setRegulatorNotice(vendorId, {
        required: !!notice.required, sent_on: notice.required ? notice.sent_on || null : null,
        reference: notice.required ? notice.reference.trim() || null : null,
      }, engagementId);
    },
    onSuccess: (res) => {
      // a changed materiality on an approved scope sends it back to approval; the approvers are told by the server
      done((res?.data as Outsourcing | undefined)?.approval_reopened ? 'Saved. The approval is reopened for a new decision' : 'Saved')();
      onOpen(null);
    },
    onError: failed,
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: 'approve' | 'reject' }) => tpraApi.decideSubOutsourcer(id, { decision }),
    onSuccess: (_r, v) => done(v.decision === 'approve' ? 'Sub-outsourcer approved' : 'Sub-outsourcer rejected')(),
    onError: failed,
  });

  if (isLoading || !data) {
    return <div className="flex items-center gap-2 rounded-xl border border-[#d5dbe1] bg-[#fff] p-4 text-[13px] text-[#64707e]"><Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading outsourcing…</div>;
  }
  const rows = outsourcingRows(data);
  const ready = open === 'materiality' ? ci !== null && reasonReady(reason)
    : open === 'exit_plan' ? exitPlanReady(plan.status, plan.summary, plan.link)
      : open === 'regulator' ? noticeReady(notice.required, notice.sent_on, today) : false;

  return (
    <section className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-4" aria-label="Outsourcing">
      <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-[#1f2933]"><Scale aria-hidden className="h-4 w-4" /> Outsourcing</h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-2 rounded-lg border border-[#e1e6eb] bg-[#f6f8fa] px-3 py-2">
            <div className="min-w-0">
              <p className="text-[12px] leading-4 text-[#64707e]">{r.label}</p>
              <StatusPill tone={r.tone} variant="inline">{r.value}</StatusPill>
            </div>
            {(r.key === 'materiality' || data.critical_important === true) && (
              <button type="button" className={SMALL} onClick={() => onOpen(r.key)}>{r.key === 'sub_outsourcing' ? 'Review' : 'Set'}</button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={!!open && open !== 'sub_outsourcing'} onClose={() => onOpen(null)} size={600}
        title={open === 'materiality' ? 'Materiality' : open === 'exit_plan' ? 'Exit plan' : 'Regulator notice'}
        description={open === 'materiality' ? 'Does this support a critical or important function? The second line decides; whoever decides cannot approve it.'
          : open === 'exit_plan' ? 'How the bank leaves this provider without disruption. In place means approved or tested, with a summary or a link.'
            : 'Whether the regulator must be notified of this outsourcing before it goes live, and when it was.'}
        footer={<>
          <button type="button" className={BTN} onClick={() => onOpen(null)}>Cancel</button>
          {open && may[open] && (
            <button type="button" className={BTN_PRIMARY} disabled={!ready || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </>}
      >
        {open === 'materiality' && (
          <div className="space-y-3">
            <fieldset className="flex flex-wrap gap-4">
              <legend className={LABEL}>Supports a critical or important function?</legend>
              {[true, false].map((v) => (
                <label key={String(v)} className="inline-flex items-center gap-1.5 text-[14px] text-[#1f2933]">
                  <input type="radio" name="ci" checked={ci === v} onChange={() => setCi(v)} /> {v ? 'Yes' : 'No'}
                </label>
              ))}
            </fieldset>
            <div>
              <label className={LABEL} htmlFor="ci-why">Reason</label>
              <textarea id="ci-why" rows={3} maxLength={2000} className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={`At least ${MIN_REASON} characters`} />
            </div>
            {materialityChanges(data.critical_important, ci) && (
              <p role="note" className="rounded-lg border border-[#f2d9a6] bg-[#fdf6e7] px-3 py-2 text-[13px] text-[#7a4b00]">
                If this is already approved, saving a new answer sends it back to the Approval stage and asks the approvers to decide again.
              </p>
            )}
          </div>
        )}
        {open === 'exit_plan' && (
          <div className="space-y-3">
            <div>
              <label className={LABEL} htmlFor="exit-status">Status</label>
              <select id="exit-status" className={FIELD} value={plan.status} onChange={(e) => setPlan({ ...plan, status: e.target.value })}>
                {EXIT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="exit-summary">Summary</label>
              <textarea id="exit-summary" rows={3} maxLength={4000} className={FIELD} value={plan.summary} onChange={(e) => setPlan({ ...plan, summary: e.target.value })} />
            </div>
            <div>
              <label className={LABEL} htmlFor="exit-link">Link to the plan</label>
              <input id="exit-link" className={FIELD} value={plan.link} placeholder="https://" onChange={(e) => setPlan({ ...plan, link: e.target.value })} />
            </div>
          </div>
        )}
        {open === 'regulator' && (
          <div className="space-y-3">
            <fieldset className="flex flex-wrap gap-4">
              <legend className={LABEL}>Must the regulator be notified?</legend>
              {[true, false].map((v) => (
                <label key={String(v)} className="inline-flex items-center gap-1.5 text-[14px] text-[#1f2933]">
                  <input type="radio" name="notice" checked={notice.required === v} onChange={() => setNotice({ ...notice, required: v })} /> {v ? 'Yes' : 'No'}
                </label>
              ))}
            </fieldset>
            {notice.required && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL} htmlFor="notice-date">Date sent</label>
                  <input id="notice-date" type="date" max={today} className={FIELD} value={notice.sent_on} onChange={(e) => setNotice({ ...notice, sent_on: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="notice-ref">Reference</label>
                  <input id="notice-ref" maxLength={120} className={FIELD} value={notice.reference} onChange={(e) => setNotice({ ...notice, reference: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>

      <Dialog open={open === 'sub_outsourcing'} onClose={() => onOpen(null)} size={600} title="Sub-outsourcing"
        description="Each sub-outsourcer of a critical or important service is approved by someone other than who added it. Add them under Dependencies."
        footer={<button type="button" className={BTN} onClick={() => onOpen(null)}>Close</button>}>
        {(data.sub_outsourcers ?? []).length === 0 ? (
          <p className="text-[13px] text-[#586472]">None listed.</p>
        ) : (
          <ul className="space-y-1.5">
            {(data.sub_outsourcers ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e1e6eb] bg-[#f6f8fa] px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[#1f2933]">{s.name}</p>
                  <p className="text-[12px] text-[#64707e]">{[s.service, s.location].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                {s.approval_status === 'pending' && may.sub_outsourcing ? (
                  <div className="flex items-center gap-1.5">
                    <button type="button" className={SMALL} disabled={decide.isPending} onClick={() => decide.mutate({ id: s.id, decision: 'approve' })}>
                      <Check aria-hidden className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button type="button" className={SMALL} disabled={decide.isPending} onClick={() => decide.mutate({ id: s.id, decision: 'reject' })}>
                      <X aria-hidden className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                ) : (
                  <StatusPill tone={s.approval_status === 'approved' ? 'success' : s.approval_status === 'rejected' ? 'danger' : s.approval_status ? 'warning' : 'neutral'}
                    variant="inline">{s.approval_status ? s.approval_status[0].toUpperCase() + s.approval_status.slice(1) : 'Not needed'}</StatusPill>
                )}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </section>
  );
}
