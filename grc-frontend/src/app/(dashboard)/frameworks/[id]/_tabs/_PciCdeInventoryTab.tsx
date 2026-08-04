'use client';

/**
 * PciCdeInventoryTab — the PCI DSS "Cardholder Data Inventory" template tab.
 * Asset-backed: each row IS a real IT asset flagged as CDE (`cde_environment`).
 * Add / Edit reuse the SAME AssetModal as the IT Assets module (forceCde on),
 * so the form is identical field-for-field — every standard asset field plus
 * the PCI DSS attributes — and everything stays in sync with the Assets module.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { certificationsApi, assetsApi } from '@/lib/api';
import { AssetModal } from '@/app/(dashboard)/assets/page';
import { useToast } from '@/components/ui/ToastProvider';
import type { ITAsset } from '@/types';
import { Database, Plus, Pencil, Trash2, ExternalLink, Loader2, ShieldCheck, X } from 'lucide-react';

interface CdeSystem {
  id: number;
  name: string;
  asset_type?: string | null;
  location?: string | null;
  owner_name?: string | null;
  criticality?: string | null;
  status?: string | null;
  cde_environment?: boolean;
  pci_dss?: Record<string, string | null> | null;
}

const critTone: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700', medium: 'bg-amber-50 text-amber-700',
  high: 'bg-orange-50 text-orange-700', critical: 'bg-rose-50 text-rose-700',
};

export default function PciCdeInventoryTab({ frameworkName }: {
  journeyId?: number;
  frameworkName?: string;
  tenantUsers?: unknown;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<ITAsset | null>(null);
  const [loadingEdit, setLoadingEdit] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<CdeSystem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['cde-systems'],
    queryFn: async () => (await certificationsApi.getCDESystems()).data as { systems: CdeSystem[]; summary: unknown },
  });
  const systems = data?.systems || [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cde-systems'] });
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['cde-assets'] });
  };
  const errMsg = (e: unknown) => (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Please try again.';

  const createMut = useMutation({
    mutationFn: (payload: Parameters<typeof assetsApi.create>[0]) => assetsApi.create({ ...payload, cde_environment: true }),
    onSuccess: () => { toast({ type: 'success', title: 'CDE asset added', message: 'Synced with the Assets module.' }); refresh(); setModalOpen(false); },
    onError: (e: unknown) => toast({ type: 'error', title: 'Save failed', message: errMsg(e) }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof assetsApi.create>[0] }) => assetsApi.update(id, data as never),
    onSuccess: () => { toast({ type: 'success', title: 'CDE asset updated', message: 'Synced with the Assets module.' }); refresh(); setModalOpen(false); setEditingAsset(null); },
    onError: (e: unknown) => toast({ type: 'error', title: 'Save failed', message: errMsg(e) }),
  });
  const delMut = useMutation({
    mutationFn: (id: number) => assetsApi.delete(id),
    onSuccess: () => { toast({ type: 'success', title: 'Asset deleted', message: 'Removed from the Assets module too.' }); refresh(); setConfirmDel(null); },
    onError: (e: unknown) => toast({ type: 'error', title: 'Delete failed', message: errMsg(e) }),
  });

  const openAdd = () => { setEditingAsset(null); setModalOpen(true); };
  const openEdit = async (id: number) => {
    setLoadingEdit(id);
    try {
      const res = await assetsApi.getById(id);
      setEditingAsset(res.data);
      setModalOpen(true);
    } catch (e) {
      toast({ type: 'error', title: 'Could not open', message: errMsg(e) });
    } finally {
      setLoadingEdit(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" strokeWidth={1.75} />
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Cardholder Data Inventory</h3>
            <p className="text-xs text-slate-500">
              CDE assets in scope for {frameworkName || 'PCI DSS'}. Managed here or in{' '}
              <Link href="/assets" className="font-medium text-primary-600 hover:underline">Assets</Link> — they stay in sync.
            </p>
          </div>
        </div>
        <button onClick={openAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700">
          <Plus className="h-4 w-4" strokeWidth={2} /> Add CDE asset
        </button>
      </div>

      {/* Sync note */}
      <div className="flex items-start gap-2 rounded-lg border border-primary-100 bg-primary-50/50 px-3 py-2 text-xs text-slate-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" strokeWidth={1.9} />
        <p>Each row is a real IT asset flagged <span className="font-medium text-slate-800">CDE Environment</span>. Add / edit uses the same form as the Assets module — every asset field plus the PCI DSS attributes — so changes reflect in both places.</p>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading CDE assets…</div>
      ) : systems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center">
          <Database className="mb-2 h-7 w-7 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No CDE assets yet</p>
          <p className="mt-1 text-xs text-slate-500">Add the systems that store, process or transmit cardholder data.</p>
          <button onClick={openAdd} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"><Plus className="h-4 w-4" /> Add CDE asset</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2.5 font-medium">Asset / System</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Cardholder data</th>
                <th className="px-3 py-2.5 font-medium">Encrypted</th>
                <th className="px-3 py-2.5 font-medium">Retention</th>
                <th className="px-3 py-2.5 font-medium">Owner</th>
                <th className="px-3 py-2.5 font-medium">Criticality</th>
                <th className="px-3 py-2.5 font-medium">Assessment</th>
                <th className="px-3 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2.5 align-top">
                    <Link href={`/assets/${s.id}`} className="font-medium text-slate-800 hover:text-primary-600">{s.name}</Link>
                    {s.location && <div className="text-[11px] text-slate-400">{s.location}</div>}
                  </td>
                  <td className="px-3 py-2.5 align-top capitalize text-slate-600">{(s.asset_type || '').replace('_', ' ') || '—'}</td>
                  <td className="px-3 py-2.5 align-top text-slate-700">{s.pci_dss?.cardholder_data || '—'}</td>
                  <td className="px-3 py-2.5 align-top text-slate-700">{s.pci_dss?.encrypted || '—'}</td>
                  <td className="px-3 py-2.5 align-top text-slate-700">{s.pci_dss?.retention || '—'}</td>
                  <td className="px-3 py-2.5 align-top text-slate-700">{s.owner_name || '—'}</td>
                  <td className="px-3 py-2.5 align-top">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${critTone[s.criticality || 'medium'] || 'bg-slate-100 text-slate-600'}`}>{s.criticality || 'medium'}</span>
                  </td>
                  <td className="px-3 py-2.5 align-top text-slate-700">{s.pci_dss?.assessment || '—'}</td>
                  <td className="px-3 py-2.5 text-right align-top">
                    <div className="inline-flex items-center gap-1">
                      <Link href={`/assets/${s.id}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Open in Assets"><ExternalLink className="h-4 w-4" /></Link>
                      <button onClick={() => openEdit(s.id)} disabled={loadingEdit === s.id} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-primary-700 disabled:opacity-50" title="Edit">
                        {loadingEdit === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                      </button>
                      <button onClick={() => setConfirmDel(s)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="Delete"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / edit — the SAME AssetModal as the IT Assets module (CDE pre-set). */}
      {modalOpen && (
        <AssetModal
          initialData={editingAsset}
          isLoading={createMut.isPending || updateMut.isPending}
          forceCde
          onClose={() => { setModalOpen(false); setEditingAsset(null); }}
          onSave={(payload) => {
            if (editingAsset) updateMut.mutate({ id: editingAsset.id, data: payload });
            else createMut.mutate(payload);
          }}
        />
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmDel(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Delete CDE asset</h3>
              <button onClick={() => setConfirmDel(null)} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-sm text-slate-600">Delete <span className="font-medium text-slate-800">{confirmDel.name}</span>? This removes it from the CDE inventory <span className="font-medium">and the Assets module</span> — this can&apos;t be undone.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={() => delMut.mutate(confirmDel.id)} disabled={delMut.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                {delMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
