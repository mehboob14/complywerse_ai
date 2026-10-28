'use client';

// Stage 11 — Reassessment & Offboarding. Two real actions on top of the monitoring
// signals: schedule the next reassessment (cadence + next date) and work the
// offboarding exit checklist (revoke access, confirm data return/destruction, close
// obligations). Starting offboarding stops the supplier's portal links and expires
// its unanswered questionnaires; completing it, with every step done, archives the
// supplier. Data-destruction attestations attach via the reused EvidencePanel.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Loader2, CalendarClock, CheckSquare, Square, Plus, LogOut } from 'lucide-react';
import apiClient, { vendorRiskApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import EvidencePanel from './EvidencePanel';
import { engagementsApi, engagementsKey, type Engagement } from '../../../_lib/engagementsApi';

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelCls = 'mb-1 block text-xs font-medium text-gray-700';

interface OffboardItem { item: string; done: boolean; at?: string | null; by?: number | null }
interface Offboarding { items: OffboardItem[]; started?: boolean; archived_at?: string | null }

function errMsg(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: string | { message?: string } } } })?.response?.data?.detail;
  return (typeof detail === 'string' ? detail : detail?.message) || fallback;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function OffboardingPanel({ vendorId, assessmentId, engagement = null }: {
  vendorId: number; assessmentId: number;
  /** An engagement's review is its own; it is ended from the Engagements tab, not offboarded. */
  engagement?: Engagement | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  // Completing archives the supplier: what the server checks (vendors:delete, or its erm:risks:edit fallback).
  const canArchive = hasPermission('vendor_risk:vendors:delete') || hasPermission('erm:risks:edit');

  const [cadence, setCadence] = useState<number | ''>('');
  const [nextDate, setNextDate] = useState('');
  const [newItem, setNewItem] = useState('');
  const [confirming, setConfirming] = useState<'start' | 'complete' | null>(null);
  const [reason, setReason] = useState('');

  const { data: offboarding } = useQuery({
    queryKey: ['tpra-offboarding', vendorId],
    queryFn: async () => (await vendorRiskApi.getOffboarding(vendorId)).data as Offboarding,
  });
  const items = offboarding?.items || [];
  const started = !!offboarding?.started;
  const archived = !!offboarding?.archived_at;
  const refreshSupplier = () => ['tpra-offboarding', 'vendor', 'tpra-lifecycle', 'vendors']
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const scheduleMut = useMutation({
    mutationFn: async () => {
      if (engagement?.id) {
        await engagementsApi.update(engagement.id, {
          ...(cadence === '' ? {} : { reassessment_cadence_days: Number(cadence) }),
          ...(nextDate ? { next_reassessment_date: nextDate } : {}),
        });
        return;
      }
      await vendorRiskApi.scheduleReassessment(vendorId, {
        cadence_days: cadence === '' ? undefined : Number(cadence),
        next_date: nextDate || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      qc.invalidateQueries({ queryKey: engagementsKey(vendorId) });
      toast({ type: 'success', title: 'Reassessment scheduled' });
    },
    onError: (e) => toast({ type: 'error', title: 'Could not schedule', message: errMsg(e, 'Try again.') }),
  });

  const saveMut = useMutation({
    mutationFn: (next: OffboardItem[]) => vendorRiskApi.updateOffboarding(vendorId, next.map((i) => ({ item: i.item, done: i.done }))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tpra-offboarding', vendorId] }),
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });

  const startMut = useMutation({
    mutationFn: async () => (await apiClient.post(`/vendor-risk/vendors/${vendorId}/offboarding/start`,
      { reason: reason.trim() || undefined })).data as { links_revoked: number; questionnaires_expired: number[] },
    onSuccess: (r) => {
      refreshSupplier();
      setConfirming(null);
      setReason('');
      toast({ type: 'success', title: 'Offboarding started',
        message: `${plural(r.links_revoked, 'portal link')} stopped · ${plural(r.questionnaires_expired.length, 'questionnaire')} expired` });
    },
    onError: (e) => toast({ type: 'error', title: 'Not started', message: errMsg(e, 'Try again.') }),
  });
  const completeMut = useMutation({
    mutationFn: () => apiClient.post(`/vendor-risk/vendors/${vendorId}/offboarding/complete`),
    onSuccess: () => { refreshSupplier(); setConfirming(null); toast({ type: 'success', title: 'Supplier archived' }); },
    onError: (e) => toast({ type: 'error', title: 'Not completed', message: errMsg(e, 'Try again.') }),
  });

  const toggle = (idx: number) => saveMut.mutate(items.map((it, i) => (i === idx ? { ...it, done: !it.done } : it)));
  const addItem = () => {
    const t = newItem.trim();
    if (!t) return;
    setNewItem('');
    saveMut.mutate([...items, { item: t, done: false }]);
  };

  const doneCount = items.filter((i) => i.done).length;
  const allDone = items.length > 0 && doneCount === items.length;

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
              onChange={(e) => setCadence(e.target.value ? Number(e.target.value) : '')}
              placeholder={engagement ? String(engagement.reassessment_cadence_days ?? '') : 'Tier default'} />
          </div>
          <div>
            <label className={labelCls}>Next review date</label>
            <input type="date" className={inputCls} value={nextDate} disabled={!canEdit}
              onChange={(e) => setNextDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            {canEdit && (
              <button onClick={() => scheduleMut.mutate()}
                disabled={scheduleMut.isPending || (!!engagement && cadence === '' && !nextDate)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {scheduleMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} Schedule
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Offboarding exit checklist: the supplier's, so not on an engagement */}
      {!engagement && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <LogOut className="h-4 w-4 text-primary-600" /> Offboarding checklist
              <span className="font-normal text-gray-400">{doneCount}/{items.length} done</span>
              {started && !archived && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Offboarding</span>
              )}
              {archived && (
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">Archived</span>
              )}
            </p>
            {!archived && confirming === null && (
              !started ? (canEdit && (
                <button type="button" onClick={() => setConfirming('start')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <LogOut className="h-3.5 w-3.5" /> Start offboarding
                </button>
              )) : (canArchive && (
                <button type="button" onClick={() => setConfirming('complete')} disabled={!allDone}
                  title={allDone ? undefined : 'Tick every step first'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40">
                  <Archive className="h-3.5 w-3.5" /> Complete
                </button>
              ))
            )}
          </div>
          {confirming === 'start' && (
            <div className="mb-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-xs text-amber-900">The supplier is marked offboarded, its portal links stop working and its unanswered questionnaires expire.</p>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (optional)" aria-label="Why"
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirming(null)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="button" onClick={() => startMut.mutate()} disabled={startMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                  {startMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Start offboarding
                </button>
              </div>
            </div>
          )}
          {confirming === 'complete' && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-700">The supplier is archived. Restore brings it back.</p>
              <span className="flex gap-2">
                <button type="button" onClick={() => setConfirming(null)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="button" onClick={() => completeMut.mutate()} disabled={completeMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                  {completeMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Archive
                </button>
              </span>
            </div>
          )}
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
      )}

      {/* Data-return / destruction attestations */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Data-return / destruction attestation</p>
        <EvidencePanel assessmentId={assessmentId} title="Offboarding evidence" />
      </div>
    </div>
  );
}
