'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { ShieldCheck, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { SECTION_ROOT, TabLoader, TabError, TabEmpty, StatusPill } from './shared';

interface ControlException {
  applicability_id: number;
  control_id: number;
  control_reference?: string | null;
  control_title?: string | null;
  is_applicable: boolean;
  status: string;
  justification?: string | null;
  review_comment?: string | null;
  requested_at?: string;
  reviewed_at?: string;
}

interface PolicyExceptionRow {
  id: number;
  title: string;
  description?: string;
  justification?: string;
  risk_assessment?: string;
  status: string;
  priority?: string;
  document_id?: number;
  effective_date?: string;
  expiry_date?: string;
  is_expired?: boolean;
}

type Active = { type: 'applicability' | 'policy_exception'; id: number; label: string; action: 'approved' | 'rejected' } | null;

export default function ExceptionsTab({ frameworkId }: { frameworkId: string }) {
  const qc = useQueryClient();
  const [active, setActive] = useState<Active>(null);
  const [remarks, setRemarks] = useState('');

  const { data, isLoading, error } = useQuery<{
    control_exceptions: ControlException[];
    policy_exceptions: PolicyExceptionRow[];
    total: number;
  }>({
    queryKey: ['auditor-exceptions', frameworkId],
    queryFn: async () => {
      const res = await apiClient.get(`${SECTION_ROOT}/${frameworkId}/exceptions`);
      return res.data;
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (payload: { artifact_type: 'applicability' | 'policy_exception'; artifact_id: number; action: 'approved' | 'rejected'; remarks: string }) => {
      const res = await apiClient.post(`${SECTION_ROOT}/reviews`, payload);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auditor-exceptions', frameworkId] });
      qc.invalidateQueries({ queryKey: ['auditor-overview', frameworkId] });
      qc.invalidateQueries({ queryKey: ['auditor-audit-trail', frameworkId] });
      setActive(null);
      setRemarks('');
    },
  });

  if (isLoading) return <TabLoader />;
  if (error) return <TabError />;
  const ce = data?.control_exceptions || [];
  const pe = data?.policy_exceptions || [];
  if (ce.length === 0 && pe.length === 0) {
    return <TabEmpty title="No active exceptions" hint="When a control is marked Not Applicable or a policy exception is filed, it will appear here." />;
  }

  return (
    <div className="space-y-6">
      {ce.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-600" />
            Control N/A decisions ({ce.length})
          </h3>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left">Control</th>
                  <th className="px-4 py-2 text-left">Justification</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ce.map((c) => (
                  <tr key={c.applicability_id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-2 align-top">
                      <span className="font-mono text-xs text-slate-700">{c.control_reference}</span>
                      <p className="text-slate-900 line-clamp-1">{c.control_title}</p>
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-slate-600 max-w-md">
                      <p className="line-clamp-3">{c.justification || '—'}</p>
                    </td>
                    <td className="px-4 py-2 align-top"><StatusPill value={c.status} /></td>
                    <td className="px-4 py-2 align-top text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => { setActive({ type: 'applicability', id: c.applicability_id, label: c.control_title || '', action: 'approved' }); setRemarks(c.review_comment || ''); }}
                          className="rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-xs font-medium"
                        >Approve</button>
                        <button
                          onClick={() => { setActive({ type: 'applicability', id: c.applicability_id, label: c.control_title || '', action: 'rejected' }); setRemarks(c.review_comment || ''); }}
                          className="rounded-md bg-rose-600 hover:bg-rose-700 text-white px-2 py-1 text-xs font-medium"
                        >Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pe.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            Policy exceptions ({pe.length})
          </h3>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left">Title</th>
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Expiry</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pe.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-2 align-top text-slate-900">{p.title}</td>
                    <td className="px-4 py-2 align-top text-xs text-slate-600 max-w-md">
                      <p className="line-clamp-3">{p.description || p.justification || '—'}</p>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <StatusPill value={p.status} />
                      {p.is_expired && <span className="ml-1 text-[10px] text-rose-600 font-semibold">EXPIRED</span>}
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-slate-600">
                      {p.expiry_date ? new Date(p.expiry_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2 align-top text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => { setActive({ type: 'policy_exception', id: p.id, label: p.title, action: 'approved' }); setRemarks(''); }}
                          className="rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-xs font-medium"
                        >Approve</button>
                        <button
                          onClick={() => { setActive({ type: 'policy_exception', id: p.id, label: p.title, action: 'rejected' }); setRemarks(''); }}
                          className="rounded-md bg-rose-600 hover:bg-rose-700 text-white px-2 py-1 text-xs font-medium"
                        >Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">
              {active.action === 'approved' ? 'Approve' : 'Reject'} {active.type === 'applicability' ? 'control N/A' : 'policy exception'}
            </h3>
            <p className="text-sm text-slate-600 mt-1">{active.label}</p>
            <label className="block text-sm font-medium text-slate-700 mt-4">Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setActive(null); setRemarks(''); }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={reviewMutation.isPending}
              >Cancel</button>
              <button
                onClick={() => active && reviewMutation.mutate({
                  artifact_type: active.type,
                  artifact_id: active.id,
                  action: active.action,
                  remarks,
                })}
                disabled={reviewMutation.isPending}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white inline-flex items-center gap-2 ${
                  active.action === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                } disabled:opacity-50`}
              >
                {reviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : active.action === 'approved' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
