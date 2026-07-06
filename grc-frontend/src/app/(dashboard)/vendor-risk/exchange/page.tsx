'use client';

// Vendor Exchange — "complete once, reuse across buyers". Publish a completed
// assessment as a reusable shared snapshot; reuse it intra-tenant by token or
// export/import a portable package across tenants. The buyer always re-scores with
// their own governed engine.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Share2, Download, Copy, Trash2, Loader2, CheckCircle2, Info, PackageOpen } from 'lucide-react';
import { tpraApi, vendorRiskApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';

interface Vendor { id: number; name: string; active_assessment_id?: number | null; status?: string }
interface Shared {
  id: number; vendor_id: number | null; vendor_name: string | null; template_name: string | null;
  residual_rating: string | null; response_count: number; evidence_count: number;
  share_token: string; status: string; validated_at: string | null; expires_at: string | null;
}

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const primaryBtn = 'inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50';

const ratingCls: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function errMsg(e: unknown, fallback = 'Try again.'): string {
  return (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
    || (e as { message?: string })?.message || fallback;
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}

export default function ExchangePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');

  const { data: sharedData, isLoading } = useQuery({
    queryKey: ['tpra-shared'],
    queryFn: async () => (await tpraApi.listShared()).data as { items: Shared[] },
  });
  const { data: vendorData } = useQuery({
    queryKey: ['tpra-exchange-vendors'],
    queryFn: async () => (await vendorRiskApi.getVendors()).data as { items?: Vendor[] } | Vendor[],
  });

  const vendors: Vendor[] = Array.isArray(vendorData) ? vendorData : (vendorData?.items || []);
  const shared = sharedData?.items || [];
  const publishable = vendors.filter((v) => v.active_assessment_id);

  const [publishVendorId, setPublishVendorId] = useState<number | ''>('');
  const [importVendorId, setImportVendorId] = useState<number | ''>('');
  const [importToken, setImportToken] = useState('');
  const [importPackage, setImportPackage] = useState('');

  const publishVendor = vendors.find((v) => v.id === publishVendorId);
  const importVendor = vendors.find((v) => v.id === importVendorId);

  const publishMut = useMutation({
    mutationFn: () => {
      if (!publishVendor?.active_assessment_id) throw new Error('This vendor has no active assessment to publish.');
      return tpraApi.publishShared(publishVendor.active_assessment_id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpra-shared'] }); setPublishVendorId(''); toast({ type: 'success', title: 'Published to exchange' }); },
    onError: (e) => toast({ type: 'error', title: 'Publish failed', message: errMsg(e) }),
  });

  const importMut = useMutation({
    mutationFn: () => {
      if (!importVendor?.active_assessment_id) throw new Error('Pick a vendor with an active assessment to import into.');
      const payload: { share_token?: string; package?: Record<string, unknown> } = {};
      if (importToken.trim()) payload.share_token = importToken.trim();
      else if (importPackage.trim()) {
        try { payload.package = JSON.parse(importPackage); }
        catch { throw new Error('Package is not valid JSON.'); }
      } else throw new Error('Paste a share token or a package to import.');
      return tpraApi.importShared(importVendor.active_assessment_id, payload);
    },
    onSuccess: (r) => {
      const d = (r as { data: { responses: number; note: string } }).data;
      toast({ type: 'success', title: `Imported ${d.responses} answers`, message: d.note });
      setImportToken(''); setImportPackage('');
    },
    onError: (e) => toast({ type: 'error', title: 'Import failed', message: errMsg(e) }),
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => tpraApi.revokeShared(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpra-shared'] }); toast({ type: 'success', title: 'Shared assessment revoked' }); },
    onError: (e) => toast({ type: 'error', title: 'Revoke failed', message: errMsg(e) }),
  });

  const copyToken = (t: string) => { navigator.clipboard?.writeText(t); toast({ type: 'success', title: 'Share token copied' }); };

  const downloadPackage = async (s: Shared) => {
    try {
      const pkg = (await tpraApi.sharedPackage(s.share_token)).data;
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url;
      el.download = `shared-assessment-${(s.vendor_name || String(s.id)).replace(/\s+/g, '-')}.json`;
      el.click();
      URL.revokeObjectURL(url);
      toast({ type: 'success', title: 'Package downloaded' });
    } catch { toast({ type: 'error', title: 'Download failed' }); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Share2 className="h-5 w-5 text-primary-600" strokeWidth={1.75} /> Vendor Exchange
        </h1>
        <p className="text-sm text-slate-500">Reuse a completed, validated assessment across engagements — publish once, share by token, or export a portable package. Imported answers are re-scored with your own engine.</p>
      </div>

      {canEdit && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Publish */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Share2 className="h-4 w-4 text-primary-600" strokeWidth={1.75} /> Publish a shared assessment</p>
            <p className="mb-3 text-xs text-slate-500">Snapshot a vendor&apos;s active assessment (its answers, evidence count &amp; validation) into a reusable shared record.</p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label htmlFor="pub-vendor" className="mb-1 block text-xs font-medium text-slate-700">Vendor</label>
                <select id="pub-vendor" className={inputCls} value={publishVendorId} onChange={(e) => setPublishVendorId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Select a vendor with an active assessment…</option>
                  {publishable.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <button onClick={() => publishMut.mutate()} disabled={!publishVendorId || publishMut.isPending} className={primaryBtn}>
                {publishMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Publish
              </button>
            </div>
            {publishable.length === 0 && <p className="mt-2 text-xs text-slate-400">No vendors have an active assessment to publish yet.</p>}
          </div>

          {/* Import */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><PackageOpen className="h-4 w-4 text-primary-600" strokeWidth={1.75} /> Import into an assessment</p>
            <div className="space-y-2">
              <div>
                <label htmlFor="imp-vendor" className="mb-1 block text-xs font-medium text-slate-700">Target vendor</label>
                <select id="imp-vendor" className={inputCls} value={importVendorId} onChange={(e) => setImportVendorId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Select the vendor to pre-fill…</option>
                  {publishable.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="imp-token" className="mb-1 block text-xs font-medium text-slate-700">Share token (intra-tenant)</label>
                <input id="imp-token" className={inputCls} value={importToken} onChange={(e) => setImportToken(e.target.value)} placeholder="Paste a share token" />
              </div>
              <div>
                <label htmlFor="imp-pkg" className="mb-1 block text-xs font-medium text-slate-700">…or a portable package (cross-tenant)</label>
                <textarea id="imp-pkg" className={inputCls} rows={2} value={importPackage} onChange={(e) => setImportPackage(e.target.value)} placeholder='Paste the exported package JSON' />
              </div>
              <div className="flex justify-end">
                <button onClick={() => importMut.mutate()} disabled={!importVendorId || importMut.isPending} className={primaryBtn}>
                  {importMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Import &amp; pre-fill
                </button>
              </div>
              <p className="flex items-start gap-1.5 text-[11px] text-slate-500"><Info className="mt-0.5 h-3 w-3 flex-shrink-0" /> Answers are pre-filled onto the vendor&apos;s active assessment; run scoring there to compute your own residual.</p>
            </div>
          </div>
        </div>
      )}

      {/* Directory */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Published shared assessments</p>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : shared.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">Nothing published yet. Publish a completed assessment above to reuse it later.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-semibold">Vendor</th>
                  <th className="px-3 py-2 font-semibold">Template</th>
                  <th className="px-3 py-2 font-semibold">Rating</th>
                  <th className="px-3 py-2 font-semibold">Answers</th>
                  <th className="px-3 py-2 font-semibold">Evidence</th>
                  <th className="px-3 py-2 font-semibold">Validated</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shared.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-900">{s.vendor_name || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{s.template_name || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${ratingCls[(s.residual_rating || '').toLowerCase()] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        {s.residual_rating || 'unscored'}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{s.response_count}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{s.evidence_count}</td>
                    <td className="px-3 py-2 text-slate-500">{fmtDate(s.validated_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${s.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{s.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => copyToken(s.share_token)} aria-label={`Copy share token for ${s.vendor_name || 'assessment'}`} title="Copy share token" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary-700"><Copy className="h-4 w-4" strokeWidth={1.75} /></button>
                        <button onClick={() => downloadPackage(s)} aria-label={`Download portable package for ${s.vendor_name || 'assessment'}`} title="Download package" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary-700"><Download className="h-4 w-4" strokeWidth={1.75} /></button>
                        {canEdit && s.status === 'active' && (
                          <button onClick={() => revokeMut.mutate(s.id)} disabled={revokeMut.isPending} aria-label={`Revoke shared assessment for ${s.vendor_name || 'assessment'}`} title="Revoke" className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"><Trash2 className="h-4 w-4" strokeWidth={1.75} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
