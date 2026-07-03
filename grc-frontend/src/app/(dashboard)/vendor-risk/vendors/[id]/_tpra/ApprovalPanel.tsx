'use client';

// Approval Decision surface (stage 08 — hard gate). Shows the advisory engine
// recommendation, the append-only decision history, and records a new
// accountable go/no-go. RBAC: vendor_risk:approvals:approve.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gavel, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { Approval } from './types';
import { APPROVAL_DECISIONS, RECOMMENDATION_LABEL, fmtDate } from './constants';

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

const decisionStyle: Record<string, string> = {
  approve: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  approve_with_conditions: 'bg-amber-50 text-amber-700 border-amber-200',
  defer: 'bg-blue-50 text-blue-700 border-blue-200',
  reject: 'bg-red-50 text-red-700 border-red-200',
};

export default function ApprovalPanel({ assessmentId }: { assessmentId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('vendor_risk:approvals:approve') || hasPermission('erm:risks:edit');

  const [decision, setDecision] = useState('approve');
  const [conditions, setConditions] = useState('');
  const [rationale, setRationale] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-approvals', assessmentId],
    queryFn: async () => (await tpraApi.listApprovals(assessmentId)).data as { items: Approval[]; recommendation: string | null },
  });

  const createMut = useMutation({
    mutationFn: () => tpraApi.createApproval(assessmentId, {
      decision,
      conditions: conditions.split('\n').map((c) => c.trim()).filter(Boolean),
      rationale: rationale || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tpra-approvals', assessmentId] });
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      setConditions(''); setRationale('');
      toast({ type: 'success', title: 'Decision recorded' });
    },
    onError: (e) => toast({ type: 'error', title: 'Failed', message: errMsg(e, 'Try again.') }),
  });

  const approvals = data?.items || [];
  const rec = data?.recommendation;

  return (
    <div className="space-y-4">
      {rec && (
        <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
          <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600" />
          <div>
            <p className="text-xs font-semibold text-indigo-900">Advisory recommendation: {RECOMMENDATION_LABEL[rec] || rec}</p>
            <p className="text-[11px] text-indigo-700">Derived from residual tier + open critical findings. The recorded human decision is authoritative.</p>
          </div>
        </div>
      )}

      {canApprove && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Gavel className="h-4 w-4" /> Record decision</p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Decision</label>
              <select className={inputCls} value={decision} onChange={(e) => setDecision(e.target.value)}>
                {APPROVAL_DECISIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Conditions (one per line)</label>
              <textarea className={inputCls} rows={2} value={conditions} onChange={(e) => setConditions(e.target.value)}
                placeholder="e.g. MFA evidence within 30 days" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Rationale</label>
              <textarea className={inputCls} rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Record decision
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Decision history</p>
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : approvals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-xs text-gray-500">No decision recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {approvals.map((a) => (
              <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${decisionStyle[a.decision] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                    {a.decision.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[11px] text-gray-400">{fmtDate(a.created_at)}</span>
                </div>
                {a.rationale && <p className="mt-1.5 text-xs text-slate-700">{a.rationale}</p>}
                {a.conditions && a.conditions.length > 0 && (
                  <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-gray-600">
                    {a.conditions.map((c, i) => <li key={i}>{c}</li>)}
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
