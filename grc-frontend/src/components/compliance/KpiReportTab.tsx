'use client';

// Cyber Security KPI Report — the MANAGE & DRILL surface for the KPI assessment.
// The at-a-glance visual story lives on the MAIN dashboard (CyberKpiPanel); this
// page owns what the dashboard can't: (re)uploading the quarterly workbook, a
// searchable list of every KPI, and drill-in to any KPI's full quarterly table +
// logic (shared modal). Data: /compliance/assessments (format = kpi_report).

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, Upload, Search, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { KPI_FORMAT, GOOD, BAD, TEAL, type Kpi, parseKpi, KpiRow, KpiDetailModal } from '@/components/dashboard/kpiShared';

const PRIMARY: React.CSSProperties = { background: 'var(--color-base, #14b8a6)', color: '#fff' };

interface Item { id: number; item_number: string; area_domain: string | null; control_description: string | null; remarks: string | null; }
interface Detail { id: number; name: string; source: string | null; file_name: string | null; items: Item[]; }

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-[24px] font-bold tabular-nums" style={{ color: tone ?? '#0f172a' }}>{value}</div>
    </div>
  );
}

export default function KpiReportTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Kpi | null>(null);

  const { data: list = [], isLoading: listLoading } = useQuery<{ id: number }[]>({
    queryKey: ['kpi-assessments'],
    queryFn: async () => (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: KPI_FORMAT } })).data?.assessments || [],
    staleTime: 30_000,
  });
  const activeId = list[0]?.id ?? null;

  const { data: detail, isLoading: detailLoading } = useQuery<Detail>({
    queryKey: ['kpi-detail', activeId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${activeId}`)).data,
    enabled: !!activeId,
    staleTime: 30_000,
  });

  const deleteAssessment = useMutation({
    mutationFn: async () => apiClient.delete(`/compliance/assessments/${activeId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kpi-assessments'] }); qc.invalidateQueries({ queryKey: ['kpi-detail', activeId] }); },
  });
  const onDelete = () => {
    if (!activeId) return;
    if (!confirm(`Delete "${detail?.name || 'KPI Report'}" and all ${detail?.items?.length ?? 0} KPIs? This cannot be undone.`)) return;
    deleteAssessment.mutate();
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      if (activeId) await apiClient.post(`/compliance/assessments/${activeId}/reupload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      else { fd.append('name', 'Cyber Security KPI Report'); fd.append('assessment_type', 'cybersecurity'); fd.append('expected_format', KPI_FORMAT); await apiClient.post('/compliance/assessments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
      qc.invalidateQueries({ queryKey: ['kpi-assessments'] });
      qc.invalidateQueries({ queryKey: ['kpi-detail', activeId] });
    } catch (err) {
      const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(d || 'Upload failed. Make sure it is the Cyber Security KPI Report workbook.');
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const { kpis, domains, onT, offT, cadence } = useMemo(() => {
    const parsed: Kpi[] = (detail?.items || []).map(parseKpi);
    // problem KPIs first (below target), then on-target, then n/a; then by domain.
    const rank = (k: Kpi) => (k.onTarget === false ? 0 : k.onTarget === true ? 1 : 2);
    parsed.sort((a, b) => rank(a) - rank(b) || a.domain.localeCompare(b.domain));
    const rated = parsed.filter((k) => k.onTarget != null);
    const freqs = new Set(parsed.map((k) => k.freq).filter(Boolean));
    return {
      kpis: parsed,
      domains: new Set(parsed.map((k) => k.domain)).size,
      onT: rated.filter((k) => k.onTarget).length,
      offT: rated.filter((k) => !k.onTarget).length,
      cadence: freqs.size === 1 ? [...freqs][0] : freqs.size > 1 ? 'Mixed' : 'Quarterly',
    };
  }, [detail]);

  if (listLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;
  const term = search.trim().toLowerCase();
  const shown = kpis.filter((k) => !term || `${k.domain} ${k.topic} ${k.def}`.toLowerCase().includes(term));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={PRIMARY}><Activity className="h-6 w-6 text-white" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-gray-900">Cyber Security KPI Report</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Manage & drill · {cadence}</span>
            </div>
            <p className="text-[11px] text-gray-500">Upload the quarterly workbook and drill into any KPI. The summary lives on the main dashboard.</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploading ? 'Uploading…' : activeId ? 'Re-upload KPI Excel' : 'Upload KPI Excel'}
          </button>
          {activeId && (
            <button onClick={onDelete} disabled={deleteAssessment.isPending} title="Delete this assessment"
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
              {deleteAssessment.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
            </button>
          )}
        </div>
      </div>

      {!activeId ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-20 text-center">
          <Activity className="mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No KPI Report uploaded yet.</p>
          <p className="mt-1 max-w-md text-xs text-slate-400">Upload the Key Performance Indicator report workbook — every KPI, its domain, type, cadence, data source and quarterly target vs actual is parsed and tracked here.</p>
        </div>
      ) : detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="KPIs tracked" value={`${kpis.length}`} />
            <Stat label="Domains" value={`${domains}`} />
            <Stat label="On target" value={`${onT}`} tone={GOOD} />
            <Stat label="Below target" value={`${offT}`} tone={offT > 0 ? BAD : GOOD} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex h-9 w-[280px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search KPIs…" className="w-full border-0 bg-transparent text-[13px] outline-none" />
            </div>
            <div className="flex items-center gap-3 text-[10.5px] text-slate-400">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-[2px] w-4" style={{ background: TEAL }} /> actual</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-[2px] w-4 border-t border-dashed border-slate-400" /> target</span>
              <span className="text-slate-300">·</span>
              <span>click a KPI for detail &amp; logic</span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {shown.length === 0 ? (
              <div className="py-12 text-center text-[13px] text-slate-400">No KPIs match “{search}”.</div>
            ) : (
              shown.map((k, i) => <KpiRow key={i} k={k} onOpen={() => setSel(k)} />)
            )}
          </div>
        </>
      )}

      <KpiDetailModal k={sel} onClose={() => setSel(null)} />
    </div>
  );
}
