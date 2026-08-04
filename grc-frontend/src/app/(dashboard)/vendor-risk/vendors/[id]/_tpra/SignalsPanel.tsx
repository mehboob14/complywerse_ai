'use client';

// Continuous Monitoring surface (stages 10–11). Capture monitoring signals; a
// qualifying signal (breach, or high/critical severity) auto-spawns a versioned
// reassessment server-side — we surface that. RBAC: vendor_risk:monitoring:*.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Radio, Loader2, RefreshCw, BellRing } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { MonitoringSignal } from './types';
import { SIGNAL_TYPES, SEVERITIES, severityBadge, fmtDate } from './constants';
import { useUnsavedGuard } from './useUnsavedGuard';

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function SignalsPanel({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:monitoring:edit') || hasPermission('erm:risks:edit');
  const canCreate = hasPermission('vendor_risk:monitoring:create') || canEdit;
  const canDelete = hasPermission('vendor_risk:monitoring:delete') || canEdit;

  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-signals', vendorId],
    queryFn: async () => (await tpraApi.listSignals(vendorId)).data as { items: MonitoringSignal[] },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tpra-signals', vendorId] });
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
  };

  const createMut = useMutation({
    mutationFn: (p: Record<string, unknown>) => tpraApi.createSignal(vendorId, p),
    onSuccess: (res) => {
      invalidate();
      setShowCreate(false);
      const triggered = (res.data as { triggered_reassessment_id?: number | null })?.triggered_reassessment_id;
      if (triggered) {
        toast({ type: 'warning', title: 'Reassessment triggered', message: `Signal opened reassessment #${triggered}.` });
      } else {
        toast({ type: 'success', title: 'Signal recorded' });
      }
    },
    onError: (e) => toast({ type: 'error', title: 'Failed', message: errMsg(e, 'Try again.') }),
  });
  const ackMut = useMutation({
    mutationFn: ({ id, row_version }: { id: number; row_version: number }) => tpraApi.updateSignal(id, { acknowledged: true, row_version }),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({ mutationFn: (id: number) => tpraApi.deleteSignal(id), onSuccess: invalidate });

  const signals = data?.items || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        {canCreate && (
          <button onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
            <Plus className="h-3.5 w-3.5" /> Record signal
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : signals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <Radio className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">No monitoring signals</p>
          <p className="text-xs text-gray-500">Record security-rating, breach, financial, SLA or cert-expiry signals to keep the rating fresh.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {signals.map((s) => (
            <div key={s.id} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${severityBadge(s.severity)}`}>{s.severity}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{s.signal_type.replace(/_/g, ' ')}</span>
                  {s.triggered_reassessment && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      <RefreshCw className="h-3 w-3" /> reassessment
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900">{s.title || s.signal_type}</p>
                {s.detail && <p className="mt-0.5 text-xs text-gray-500">{s.detail}</p>}
                <p className="mt-0.5 text-[11px] text-gray-400">{fmtDate(s.occurred_at)}{s.source ? ` · ${s.source}` : ''}</p>
              </div>
              <div className="flex items-center gap-1">
                {canEdit && !s.acknowledged && (
                  <button onClick={() => ackMut.mutate({ id: s.id, row_version: s.row_version })} aria-label="Acknowledge"
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600" title="Acknowledge">
                    <BellRing className="h-3.5 w-3.5" />
                  </button>
                )}
                {canDelete && (
                  <button onClick={() => deleteMut.mutate(s.id)} aria-label="Delete signal" className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateSignalPanel open={showCreate} onClose={() => setShowCreate(false)} onSubmit={(p) => createMut.mutate(p)} busy={createMut.isPending} />
    </div>
  );
}

function CreateSignalPanel({
  open, onClose, onSubmit, busy,
}: { open: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [form, setForm] = useState({ signal_type: 'security_rating', severity: 'medium', title: '', detail: '', source: '' });
  useUnsavedGuard(open && (!!form.title || !!form.detail));
  return (
    <RightSlidePanel isOpen={open} onClose={onClose} title="Record monitoring signal" width="w-full max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button form="tpra-signal-form" type="submit" disabled={busy}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Record signal'}
          </button>
        </div>
      }>
      <form id="tpra-signal-form" onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...form, source: form.source || undefined, detail: form.detail || undefined });
      }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Type</label>
            <select className={inputCls} value={form.signal_type} onChange={(e) => setForm({ ...form, signal_type: e.target.value })}>
              {SIGNAL_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Severity</label>
            <select className={inputCls} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Title</label>
          <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Detail</label>
          <textarea className={inputCls} rows={2} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Source</label>
          <input className={inputCls} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. SecurityScorecard" />
        </div>
        <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-700">
          A breach signal — or any high/critical severity — automatically opens a new reassessment version.
        </p>
      </form>
    </RightSlidePanel>
  );
}
