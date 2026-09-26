'use client';

// SBP (State Bank of Pakistan) offsite IT-asset inventory — the 52-field
// regulatory return, per asset. Auto-derived fields (OS, IP, subnet, DMZ, EDR,
// VA counts, obsolescence) are read-only; stored + reason fields are editable.
// Backend: grc/modules/sbp_inventory  (GET/PATCH /sbp-inventory/asset/{id}).
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Download, CheckCircle2, Sparkles } from 'lucide-react';
import apiClient from '@/cyber-assurance/lib/api';

type Field = {
  key: string; letter: string; label: string; group: string;
  src: string; editable: boolean; value: any; auto_value: any; overridden: boolean;
};

const isYesNo = (label: string) => /yes\s*\/\s*no/i.test(label);
const ynOptions = (label: string) => /not applicable|n\/a/i.test(label)
  ? ['', 'Yes', 'No', 'Not Applicable'] : ['', 'Yes', 'No'];

export default function SbpInventoryPanel({ assetId }: { assetId: number }) {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['sbp-asset', assetId],
    queryFn: async () => (await apiClient.get(`/sbp-inventory/asset/${assetId}`)).data as
      { asset_id: number; asset_name: string; fields: Field[] },
  });

  const save = useMutation({
    mutationFn: async () => (await apiClient.patch(`/sbp-inventory/asset/${assetId}`, edits)).data,
    onSuccess: () => {
      setEdits({}); setSaved(true); setTimeout(() => setSaved(false), 2500);
      qc.invalidateQueries({ queryKey: ['sbp-asset', assetId] });
    },
  });

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await apiClient.get('/sbp-inventory/export.xlsx', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'SBP_Asset_Inventory.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  const groups = useMemo(() => {
    const g: Record<string, Field[]> = {};
    (data?.fields || []).forEach((f) => { (g[f.group] ||= []).push(f); });
    return g;
  }, [data]);

  if (isLoading) return <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading SBP inventory…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">Could not load the SBP inventory for this asset.</div>;

  const dirty = Object.keys(edits).length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-black">SBP Offsite IT Asset Inventory</h3>
          <p className="mt-0.5 text-xs text-gray-500">State Bank of Pakistan 52-field return. <Sparkles size={11} className="mb-0.5 inline text-blue-600" /> auto-filled fields come from Ava's scans; the rest are yours to complete.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportXlsx} disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download size={15} />} Export full inventory
          </button>
          <button onClick={() => save.mutate()} disabled={!dirty || save.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {saved ? 'Saved' : `Save${dirty ? ` (${Object.keys(edits).length})` : ''}`}
          </button>
        </div>
      </div>

      {Object.entries(groups).map(([group, fields]) => (
        <div key={group} className="overflow-hidden rounded-lg border border-gray-200">
          <div className="border-b border-gray-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600">{group}</div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {fields.map((f) => {
                const val = edits[f.key] ?? (f.value ?? '');
                return (
                  <tr key={f.key}>
                    <td className="w-1/2 px-4 py-2 align-top text-gray-700">
                      <span className="text-gray-400 mr-1">{f.letter}</span>{f.label}
                    </td>
                    <td className="px-4 py-2 align-top">
                      {f.editable ? (
                        isYesNo(f.label) ? (
                          <select value={val} onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
                            className="w-full max-w-xs rounded-md border border-gray-300 px-2 py-1 text-sm">
                            {ynOptions(f.label).map((o) => <option key={o} value={o}>{o || '—'}</option>)}
                          </select>
                        ) : (
                          <input value={val} onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
                            placeholder={f.auto_value ? String(f.auto_value) : '—'}
                            className="w-full max-w-md rounded-md border border-gray-300 px-2 py-1 text-sm" />
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-black">
                          {f.value !== '' && f.value != null ? String(f.value) : <span className="text-gray-300">—</span>}
                          <span title="Auto-filled by Ava" className="rounded bg-blue-50 px-1 py-0.5 text-[9px] font-semibold uppercase text-blue-600">auto</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
