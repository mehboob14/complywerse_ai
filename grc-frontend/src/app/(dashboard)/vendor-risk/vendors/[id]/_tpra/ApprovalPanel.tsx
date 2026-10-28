'use client';

// Approval Decision surface (stage 08 — hard gate). Shows the advisory engine
// recommendation, who may approve (segregation of duties, before anyone writes a
// rationale), the append-only decision history with the one the gate goes by,
// and records a new accountable go/no-go. Each condition is a Task Management
// task. RBAC: vendor_risk:approvals:approve.

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gavel, Sparkles, Loader2, CheckCircle2, Plus, X, Users, ExternalLink } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { Approval, ApprovalCondition } from './types';
import { APPROVAL_DECISIONS, RECOMMENDATION_LABEL, fmtDate } from './constants';

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

const decisionStyle: Record<string, string> = {
  approve: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  approve_with_conditions: 'bg-amber-50 text-amber-700 border-amber-200',
  defer: 'bg-slate-100 text-slate-700 border-slate-200',
  reject: 'bg-rose-50 text-rose-700 border-rose-200',
};

type Condition = ApprovalCondition & { task_id?: number | null };
type Decision = Omit<Approval, 'conditions'> & { conditions: Array<string | Condition>; in_force?: boolean };
type Approver = { user_id: number; name: string; eligible: boolean; reason: string | null };
type Draft = { text: string; owner_id: string; due_date: string };

export default function ApprovalPanel({ assessmentId }: { assessmentId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('vendor_risk:approvals:approve') || hasPermission('erm:risks:edit');

  const [decision, setDecision] = useState('approve');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [rationale, setRationale] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-approvals', assessmentId],
    queryFn: async () => (await tpraApi.listApprovals(assessmentId)).data as { items: Decision[]; recommendation: string | null },
  });
  const { data: who } = useQuery({
    queryKey: ['tpra-approvers', assessmentId],
    queryFn: async () => (await tpraApi.listApprovers(assessmentId)).data as { items: Approver[]; me: Approver | null },
  });
  const { data: directory } = useQuery({
    queryKey: ['tprm-config-directory'],
    queryFn: async () => (await tpraApi.configDirectory()).data as { people: Array<{ id: number; name: string }> },
  });
  const people = directory?.people || [];
  const nameOf = (id: number) => people.find((p) => p.id === id)?.name || `User ${id}`;

  const me = who?.me;
  const blocked = !!me && !me.eligible;            // may still defer or reject
  const approving = decision.startsWith('approve');

  const setDraft = (i: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const createMut = useMutation({
    mutationFn: () => tpraApi.createApproval(assessmentId, {
      decision,
      conditions: drafts.filter((d) => d.text.trim()).map((d) => ({
        text: d.text.trim(), owner_id: d.owner_id ? Number(d.owner_id) : null, due_date: d.due_date || null,
      })),
      rationale: rationale || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tpra-approvals', assessmentId] });
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      setDrafts([]); setRationale('');
      toast({ type: 'success', title: 'Decision recorded' });
    },
    onError: (e) => toast({ type: 'error', title: 'Failed', message: errMsg(e, 'Try again.') }),
  });

  const resolveMut = useMutation({
    mutationFn: ({ approvalId, conditionId }: { approvalId: number; conditionId: string }) =>
      tpraApi.resolveCondition(approvalId, conditionId, { status: 'closed' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tpra-approvals', assessmentId] });
      toast({ type: 'success', title: 'Condition resolved' });
    },
    onError: (e) => toast({ type: 'error', title: 'Failed', message: errMsg(e, 'Try again.') }),
  });

  const approvals = data?.items || [];
  const rec = data?.recommendation;
  const approvers = who?.items || [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {rec && (
        <div className="flex items-start gap-2 rounded-xl border border-primary-200 bg-primary-50/60 p-3">
          <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-600" strokeWidth={1.75} />
          <div>
            <p className="text-xs font-semibold text-slate-900">Advisory recommendation: {RECOMMENDATION_LABEL[rec] || rec}</p>
            <p className="text-[11px] text-slate-600">Derived from residual tier + open critical findings. The recorded human decision is authoritative.</p>
          </div>
        </div>
      )}

      {approvers.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <Users className="h-3.5 w-3.5" /> Approvers
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {approvers.map((p) => (
              <li key={p.user_id} title={p.reason ? `Can't approve: ${p.reason}` : 'Can approve'}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${p.eligible
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-[#d5dbe1] bg-[#eef1f4] text-[#5f6b76]'}`}>
                {p.name}
                {!p.eligible && <span className="text-[10px]">· {p.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canApprove && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Gavel className="h-4 w-4" /> Record decision</p>
          {blocked && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              You can&apos;t approve: {me?.reason}. You can still defer or reject.
            </p>
          )}
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Decision</label>
              <select className={inputCls} value={decision} onChange={(e) => setDecision(e.target.value)}>
                {APPROVAL_DECISIONS.map((d) => (
                  <option key={d.value} value={d.value} disabled={blocked && d.value.startsWith('approve')}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Conditions</label>
              <div className="space-y-2">
                {drafts.map((d, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_9.5rem_auto]">
                    <input className={inputCls} value={d.text} aria-label={`Condition ${i + 1}`}
                      placeholder="e.g. MFA evidence within 30 days" onChange={(e) => setDraft(i, { text: e.target.value })} />
                    <select className={inputCls} value={d.owner_id} aria-label={`Owner of condition ${i + 1}`}
                      onChange={(e) => setDraft(i, { owner_id: e.target.value })}>
                      <option value="">No owner</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input type="date" className={inputCls} value={d.due_date} aria-label={`Due date of condition ${i + 1}`}
                      onChange={(e) => setDraft(i, { due_date: e.target.value })} />
                    <button type="button" aria-label={`Remove condition ${i + 1}`}
                      onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-2 text-slate-500 hover:text-rose-600">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setDrafts((ds) => [...ds, { text: '', owner_id: '', due_date: '' }])}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:text-primary-800">
                  <Plus className="h-3.5 w-3.5" /> Add condition
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Rationale</label>
              <textarea className={inputCls} rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending || (blocked && approving)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50">
                {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Record decision
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Decision history</p>
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : approvals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500">No decision recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {approvals.map((a) => (
              <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${decisionStyle[a.decision] || 'bg-gray-100 text-gray-600 border-slate-200'}`}>
                      {a.decision.replace(/_/g, ' ')}
                    </span>
                    {a.in_force && (
                      <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700"
                        title="The decision the Approval gate goes by">In force</span>
                    )}
                  </span>
                  <span className="text-[11px] text-slate-400">{fmtDate(a.created_at)}</span>
                </div>
                {a.rationale && <p className="mt-1.5 text-xs text-slate-700">{a.rationale}</p>}
                {a.conditions && a.conditions.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {a.conditions.map((c, i) => {
                      const cond: Condition = typeof c === 'string'
                        ? { id: `c${i}`, text: c, status: 'open', due_date: null }
                        : c;
                      const overdue = cond.status !== 'closed' && !!cond.due_date && String(cond.due_date).slice(0, 10) < today;
                      return (
                        <li key={cond.id || i} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className={cond.status === 'closed' ? 'text-slate-400 line-through' : 'text-slate-700'}>{cond.text}</span>
                            {cond.status === 'closed' ? (
                              <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700">closed</span>
                            ) : overdue ? (
                              <span className="rounded-full bg-rose-50 px-1.5 text-[10px] font-medium text-rose-700">overdue</span>
                            ) : (
                              <span className="rounded-full bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700">open</span>
                            )}
                            {cond.owner_id ? <span className="text-[10px] text-slate-500">{nameOf(cond.owner_id)}</span> : null}
                            {cond.due_date && <span className="text-[10px] text-slate-500">due {fmtDate(cond.due_date)}</span>}
                            {cond.task_id ? (
                              <Link href={`/tasks/${cond.task_id}`}
                                className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary-700 hover:underline">
                                Task <ExternalLink className="h-2.5 w-2.5" />
                              </Link>
                            ) : null}
                          </span>
                          {canApprove && cond.status !== 'closed' && (
                            <button
                              onClick={() => resolveMut.mutate({ approvalId: a.id, conditionId: String(cond.id) })}
                              disabled={resolveMut.isPending}
                              className="flex-shrink-0 text-[10px] font-medium text-primary-700 hover:text-primary-800 disabled:opacity-50">
                              Resolve
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
