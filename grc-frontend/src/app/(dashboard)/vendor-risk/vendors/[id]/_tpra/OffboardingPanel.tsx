'use client';

// Stage 11 — Reassessment & Offboarding. Two real actions on top of the monitoring
// signals: schedule the next reassessment (cadence + next date) and work the
// offboarding exit checklist (revoke access, confirm data return/destruction, close
// obligations). Data-destruction attestations attach via the reused EvidencePanel.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, CalendarClock, CheckSquare, Square, Plus, LogOut } from 'lucide-react';
import { vendorRiskApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import EvidencePanel from './EvidencePanel';

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelCls = 'mb-1 block text-xs font-medium text-gray-700';

interface OffboardItem { item: string; done: boolean; at?: string | null; by?: number | null }

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function OffboardingPanel({ vendorId, assessmentId }: { vendorId: number; assessmentId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');

  const [cadence, setCadence] = useState<number | ''>('');
  const [nextDate, setNextDate] = useState('');
  const [newItem, setNewItem] = useState('');

  const { data: offboarding } = useQuery({
    queryKey: ['tpra-offboarding', vendorId],
    queryFn: async () => (await vendorRiskApi.getOffboarding(vendorId)).data as { items: OffboardItem[] },
  });
  const items = offboarding?.items || [];

  const scheduleMut = useMutation({
    mutationFn: () => vendorRiskApi.scheduleReassessment(vendorId, {
      cadence_days: cadence === '' ? undefined : Number(cadence),
      next_date: nextDate || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] }); toast({ type: 'success', title: 'Reassessment scheduled' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not schedule', message: errMsg(e, 'Try again.') }),
  });

  const saveMut = useMutation({
    mutationFn: (next: OffboardItem[]) => vendorRiskApi.updateOffboarding(vendorId, next.map((i) => ({ item: i.item, done: i.done }))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tpra-offboarding', vendorId] }),
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });

  const toggle = (idx: number) => saveMut.mutate(items.map((it, i) => (i === idx ? { ...it, done: !it.done } : it)));
  const addItem = () => {
    const t = newItem.trim();
    if (!t) return;
    setNewItem('');
    saveMut.mutate([...items, { item: t, done: false }]);
  };

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="space-y-4">
      {/* Schedule the next reassessment */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <CalendarClock className="h-4 w-4 text-primary-600" /> Schedule reassessment
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Cadence (days)</label>
            <input type="number" className={inputCls} value={cadence} disabled={!canEdit}
              onChange={(e) => setCadence(e.target.value ? Number(e.target.value) : '')} placeholder="Tier default" />
          </div>
          <div>
            <label className={labelCls}>Next review date</label>
            <input type="date" className={inputCls} value={nextDate} disabled={!canEdit}
              onChange={(e) => setNextDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            {canEdit && (
              <button onClick={() => scheduleMut.mutate()} disabled={scheduleMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {scheduleMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} Schedule
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Offboarding exit checklist */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <LogOut className="h-4 w-4 text-primary-600" /> Offboarding checklist
          <span className="font-normal text-gray-400">{doneCount}/{items.length} done</span>
        </p>
        <div className="space-y-1">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5">
              <button type="button" onClick={() => canEdit && toggle(i)} disabled={!canEdit}
                aria-label={it.done ? 'Mark not done' : 'Mark done'} className={canEdit ? 'hover:opacity-80' : 'cursor-default'}>
                {it.done ? <CheckSquare className="h-4 w-4 text-emerald-600" /> : <Square className="h-4 w-4 text-gray-400" />}
              </button>
              <span className={`flex-1 text-xs ${it.done ? 'text-gray-400 line-through' : 'text-slate-700'}`}>{it.item}</span>
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="mt-2 flex items-center gap-2">
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
              placeholder="Add an offboarding step…"
              className="flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            <button type="button" onClick={addItem} disabled={!newItem.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-40">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        )}
      </div>

      {/* Data-return / destruction attestations */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Data-return / destruction attestation</p>
        <EvidencePanel assessmentId={assessmentId} title="Offboarding evidence" />
      </div>
    </div>
  );
}
