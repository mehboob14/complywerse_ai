'use client';

// The decision at the gate (stage 08 — hard gate). What stands now: the decision the gate goes by, its conditions (owner, due date,
// status, a task each) with Mark met and Waive, and earlier decisions of this review. "Record decision" opens the dialog: who can
// decide (eligible with a tick, excluded with a cross and why), the four decisions, the rationale and the conditions. An approving
// decision waits on the stage's other checks and on the person being allowed to approve; defer and reject never do.
// RBAC: vendor_risk:approvals:approve.

import { useState } from 'react';
import { ErrorState } from '@/components/ui/ds';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePeople } from '../../../_lib/portfolioApi';
import { Check, ExternalLink, Gavel, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { clsx } from 'clsx';
import { BTN, BTN_DANGER, BTN_PRIMARY } from '../_record/btn';
import { Dialog, StatusPill } from '../_record/recordUi';
import { TONE } from '@/lib/status';
import { fmt } from '../../../_ui/fmt';
import { statusPill } from '@/lib/status';
import { vendorDecision } from '@/lib/statuses/vendor';
import { tpraApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText, lifecycleApi } from '../../../_lib/lifecycleApi';
import {
  DECISIONS, approvalNote, conditionState, decisionAvailable, decisionWord, firstDecision, type Check as StageCheck, type ConditionState,
} from '../../../_lib/lifecycleLogic';
import type { Approval, ApprovalCondition } from './types';
import { RECOMMENDATION_LABEL } from './constants';
import { ReasonDialog } from './StageDialogs';

const FIELD = 'w-full rounded-ds-card border border-ds-border-strong bg-ds-surface px-3 py-2 text-[14px] text-ds-fg placeholder:text-ds-fg-muted focus-visible:border-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-strong';
const SMALL = `${BTN} !h-8 !px-2.5 !text-[13px]`;

type Condition = ApprovalCondition & { task_id?: number | null; waived?: boolean; waived_reason?: string | null };
type Decision = Omit<Approval, 'conditions'> & { conditions: Array<string | Condition>; in_force?: boolean };
type Approver = { user_id: number; name: string; eligible: boolean; reason: string | null; designated?: boolean };
type Draft = { text: string; owner_id: string; due_date: string };

const STATE_TONE: Record<ConditionState, 'warning' | 'success' | 'danger' | 'neutral'> = { open: 'warning', met: 'success', overdue: 'danger', waived: 'neutral' };
const STATE_WORD: Record<ConditionState, string> = { open: 'Open', met: 'Met', overdue: 'Overdue', waived: 'Waived' };

const asCondition = (c: string | Condition, i: number): Condition => (typeof c === 'string' ? { id: `c${i}`, text: c, status: 'open', due_date: null } : c);

export default function ApprovalPanel({ assessmentId, checks, stageStatus }: {
  assessmentId: number;
  /** the stage's checks: the ones other than the decision hold an approving decision back */
  checks?: StageCheck[] | null;
  stageStatus?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('vendor_risk:approvals:approve') || hasPermission('erm:risks:edit');

  const [recording, setRecording] = useState(false);
  const [waiving, setWaiving] = useState<{ approvalId: number; conditionId: string } | null>(null);
  const [decision, setDecision] = useState('approve');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [rationale, setRationale] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tpra-approvals', assessmentId],
    queryFn: async () => (await tpraApi.listApprovals(assessmentId)).data as { items: Decision[]; recommendation: string | null },
  });
  const { data: who } = useQuery({
    queryKey: ['tpra-approvers', assessmentId],
    queryFn: async () => (await tpraApi.listApprovers(assessmentId)).data as { items: Approver[]; me: Approver | null },
  });
  const people = usePeople();
  const nameOf = (id?: number | null) => (id ? people.find((p) => p.id === id)?.name || 'A former user' : null);

  const blocking = (checks ?? []).filter((c) => c.met === false && c.key !== 'decision').length;
  const me = who?.me;
  const excluded = !!me && !me.eligible;                    // may still defer or reject
  const approvers = who?.items || [];
  const today = new Date().toISOString().slice(0, 10);

  const decisions = data?.items || [];
  const inForce = decisions.find((d) => d.in_force) ?? null;
  const earlier = decisions.filter((d) => d !== inForce);
  const rec = data?.recommendation;

  const open = () => {
    setDecision(firstDecision(excluded, blocking));
    setDrafts([]);
    setRationale('');
    setRecording(true);
  };
  const setDraft = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const made = drafts.filter((d) => d.text.trim());

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tpra-approvals', assessmentId] });
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
  };
  const createMut = useMutation({
    mutationFn: () => tpraApi.createApproval(assessmentId, {
      decision,
      conditions: made.map((d) => ({ text: d.text.trim(), owner_id: d.owner_id ? Number(d.owner_id) : null, due_date: d.due_date || null })),
      rationale: rationale.trim() || undefined,
    }),
    onSuccess: () => { refresh(); setRecording(false); toast({ type: 'success', title: 'Decision recorded' }); },
    onError: (e) => toast({ type: 'error', title: 'Not recorded', message: apiErrorText(e, 'Try again.') }),
  });
  const meetMut = useMutation({
    mutationFn: ({ approvalId, conditionId }: { approvalId: number; conditionId: string }) => lifecycleApi.meet(approvalId, conditionId),
    onSuccess: () => { refresh(); toast({ type: 'success', title: 'Condition met' }); },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: apiErrorText(e, 'Try again.') }),
  });
  const waiveMut = useMutation({
    mutationFn: ({ reason }: { reason: string }) => lifecycleApi.waive(waiving!.approvalId, waiving!.conditionId, reason),
    onSuccess: () => { refresh(); setWaiving(null); toast({ type: 'success', title: 'Condition waived' }); },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: apiErrorText(e, 'Try again.') }),
  });

  const conditions = (d: Decision) => (
    <ul className="mt-2 space-y-1.5">
      {d.conditions.map(asCondition).map((c, i) => {
        const state = conditionState(c, today);
        const owner = nameOf(c.owner_id);
        return (
          <li key={c.id || i} className="flex flex-wrap items-center justify-between gap-2 rounded-ds-card border border-ds-border bg-ds-surface-subtle px-3 py-2">
            <div className="min-w-0">
              <p className={clsx('text-[13px] leading-5', state === 'met' || state === 'waived' ? 'text-ds-fg-muted line-through' : 'text-ds-fg')}>{c.text}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-[12px] leading-4 text-ds-fg-muted">
                <StatusPill tone={STATE_TONE[state]} variant="inline">{STATE_WORD[state]}</StatusPill>
                <span>{owner ?? 'No owner'}</span>
                {c.due_date && <span>due {fmt.date(c.due_date)}</span>}
                {c.waived && c.waived_reason && <span>{c.waived_reason}</span>}
                {c.task_id ? (
                  <Link href={`/tasks/${c.task_id}`} className="inline-flex items-center gap-0.5 font-medium text-ds-primary-text hover:underline">Task <ExternalLink aria-hidden className="h-3 w-3" /></Link>
                ) : null}
              </p>
            </div>
            {canApprove && c.status !== 'closed' && (
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" className={SMALL} disabled={meetMut.isPending} onClick={() => meetMut.mutate({ approvalId: d.id, conditionId: String(c.id) })}>Mark met</button>
                <button type="button" className={SMALL} onClick={() => setWaiving({ approvalId: d.id, conditionId: String(c.id) })}>Waive</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-[16px]">
      {/* The decision the gate goes by */}
      <section className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]" aria-label="Decision">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-[15px] font-[600] text-ds-fg"><Gavel aria-hidden className="h-4 w-4" /> Decision</h4>
          {canApprove && (
            <button type="button" className={inForce ? BTN : BTN_PRIMARY} onClick={open}>{inForce ? 'Record a new decision' : 'Record decision'}</button>
          )}
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 py-3 text-[13px] text-ds-fg-muted"><Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : isError ? (
          <ErrorState compact title="Couldn’t load the decisions" onRetry={() => { void refetch(); }} />
        ) : inForce ? (
          <div className="mt-2">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <StatusPill tone={statusPill(vendorDecision, inForce.decision).tone}>{decisionWord(inForce.decision)}</StatusPill>
              <span className="text-[12px] text-ds-fg-muted">{[nameOf(inForce.approver_id), fmt.date(inForce.created_at)].filter(Boolean).join(' · ')}</span>
            </div>
            {inForce.rationale && <p className="mt-1.5 text-[13px] leading-5 text-ds-fg-body">{inForce.rationale}</p>}
            {inForce.conditions.length > 0 && conditions(inForce)}
          </div>
        ) : (
          <p className="mt-1 text-[13px] leading-5 text-ds-fg-muted">{approvalNote(stageStatus, blocking, canApprove)}</p>
        )}
        {rec && (
          <p className="mt-3 flex items-center gap-1.5 text-[12px] leading-4 text-ds-fg-muted">
            <Sparkles aria-hidden className="h-3.5 w-3.5 text-ds-primary-text" strokeWidth={1.75} /> Advisory: {RECOMMENDATION_LABEL[rec] || rec}
          </p>
        )}
      </section>

      {earlier.length > 0 && (
        <section aria-label="Earlier in this review">
          <h4 className="mb-1.5 text-[13px] font-[600] text-ds-fg-muted">Earlier in this review</h4>
          <ul className="space-y-1.5">
            {earlier.map((d) => (
              <li key={d.id} className="rounded-ds-card border border-ds-border bg-ds-surface px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <StatusPill tone={statusPill(vendorDecision, d.decision).tone}>{decisionWord(d.decision)}</StatusPill>
                  <span className="text-[12px] text-ds-fg-muted">{[nameOf(d.approver_id), fmt.date(d.created_at)].filter(Boolean).join(' · ')}</span>
                </div>
                {d.rationale && <p className="mt-1 text-[13px] leading-5 text-ds-fg-muted">{d.rationale}</p>}
                {d.conditions.length > 0 && conditions(d)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={recording} onClose={() => setRecording(false)} size={720} title="Record decision"
        footer={<>
          <button type="button" className={BTN} onClick={() => setRecording(false)}>Cancel</button>
          <button type="button" className={decision === 'reject' ? BTN_DANGER : BTN_PRIMARY}
            disabled={createMut.isPending || !decisionAvailable(decision, excluded, blocking) || (decision === 'approve_with_conditions' && made.length === 0)}
            onClick={() => createMut.mutate()}>
            {createMut.isPending ? 'Saving…' : DECISIONS.find((d) => d.value === decision)?.label}
          </button>
        </>}
      >
        <div className="space-y-[16px]">
          {/* Who can decide */}
          <div>
            <h5 className="mb-1.5 text-[13px] font-[600] text-ds-fg-body">Who can decide</h5>
            {approvers.length === 0 || approvers.every((p) => !p.eligible) ? (
              <p className="text-[13px] leading-5" style={{ color: TONE.warning.text }}>Nobody eligible. Assign an approver who did not run the assessment.</p>
            ) : null}
            {approvers.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {approvers.map((p) => (
                  <li key={p.user_id} title={p.reason ? `Cannot approve: ${p.reason}` : 'Can approve'}
                    className={clsx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px]',
                      p.eligible ? 'border-ds-border-strong bg-ds-success-soft text-ds-success' : 'border-ds-border bg-ds-surface-hover text-ds-fg-muted')}>
                    {p.eligible ? <Check aria-hidden className="h-3 w-3" strokeWidth={3} /> : <X aria-hidden className="h-3 w-3" strokeWidth={3} />}
                    {p.name}
                    {p.designated && p.eligible && <span className="rounded bg-ds-surface px-1 text-[12px] font-[600] text-ds-primary-text">Designated</span>}
                    {!p.eligible && p.reason && <span className="text-[12px]">· {p.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
            {excluded && (
              <p className="mt-2 rounded-ds-card px-3 py-2 text-[13px] leading-5" style={{ background: TONE.warning.tint, color: TONE.warning.text }}>
                You cannot approve this one ({me?.reason}). You can still defer or reject.
              </p>
            )}
          </div>

          {/* The four decisions */}
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-[600] text-ds-fg-body">Decision</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {DECISIONS.map((d) => {
                const available = decisionAvailable(d.value, excluded, blocking);
                return (
                  <label key={d.value} title={available ? undefined : (excluded ? 'You cannot approve this one.' : 'Unavailable until the stage checks clear.')}
                    className={clsx('flex cursor-pointer items-start gap-2 rounded-ds-card border px-3 py-2',
                      decision === d.value ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border bg-ds-surface', !available && 'cursor-not-allowed opacity-50')}>
                    <input type="radio" name="decision" className="mt-1" checked={decision === d.value} disabled={!available}
                      onChange={() => setDecision(d.value)} />
                    <span>
                      <span className="block text-[14px] font-medium text-ds-fg">{d.label}</span>
                      <span className="block text-[12px] leading-4 text-ds-fg-muted">{available ? d.note : (excluded ? 'You cannot approve this one.' : 'Unavailable until the stage checks clear.')}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label className="mb-1 block text-[13px] font-medium text-ds-fg-body" htmlFor="decision-why">Rationale</label>
            <textarea id="decision-why" rows={3} maxLength={8000} className={FIELD} value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </div>

          {decision === 'approve_with_conditions' && (
            <div>
              <h5 className="mb-1.5 text-[13px] font-[600] text-ds-fg-body">Conditions</h5>
              <div className="space-y-2">
                {drafts.map((d, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_9.5rem_auto]">
                    <input className={FIELD} value={d.text} aria-label={`Condition ${i + 1}`} placeholder="e.g. MFA evidence within 30 days"
                      onChange={(e) => setDraft(i, { text: e.target.value })} />
                    <select className={FIELD} value={d.owner_id} aria-label={`Owner of condition ${i + 1}`} onChange={(e) => setDraft(i, { owner_id: e.target.value })}>
                      <option value="">No owner</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input type="date" className={FIELD} value={d.due_date} aria-label={`Due date of condition ${i + 1}`}
                      onChange={(e) => setDraft(i, { due_date: e.target.value })} />
                    <button type="button" aria-label={`Remove condition ${i + 1}`} onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
                      className="inline-flex items-center justify-center rounded-ds-card border border-ds-border-strong px-2 text-ds-fg-muted hover:text-ds-danger">
                      <X aria-hidden className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setDrafts((ds) => [...ds, { text: '', owner_id: '', due_date: '' }])}
                  className="inline-flex items-center gap-1 rounded-ds-control px-1 py-0.5 text-[13px] font-medium text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary">
                  <Plus aria-hidden className="h-3.5 w-3.5" /> Add condition
                </button>
              </div>
            </div>
          )}
        </div>
      </Dialog>

      <ReasonDialog open={!!waiving} onClose={() => setWaiving(null)} busy={waiveMut.isPending} title="Waive condition"
        description="Closed without being met. The reason stays on the record." cta="Waive"
        onSubmit={(reason) => waiveMut.mutate({ reason })} />
    </div>
  );
}
