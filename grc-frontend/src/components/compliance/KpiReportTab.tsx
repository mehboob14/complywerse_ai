'use client';

// Cyber Security KPI Report — MANAGE & DRILL surface. The KPI list comes from the
// uploaded workbook; ACTUAL values are computed LIVE from real modules where the
// platform owns the data, overlaid via /compliance/assessments/kpi-live. KPIs with
// no in-platform feed are flagged external (no fabricated number). This page owns
// upload/refresh + a searchable list; the summary lives on the main dashboard.

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, Upload, Search, Trash2, Plus } from 'lucide-react';
import apiClient from '@/lib/api';
import { AnimatedModal } from '@/components/ui';
import { KPI_FORMAT, GOOD, BAD, TEAL, type Kpi, type LiveMetric, buildKpis, KpiRow, KpiDetailModal } from '@/components/dashboard/kpiShared';

const PRIMARY: React.CSSProperties = { background: 'var(--color-base, #14b8a6)', color: '#fff' };
const FIELD = 'w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none';
const FLABEL = 'mb-0.5 block text-xs font-medium text-slate-600';

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
  const { data: liveMetrics = {} } = useQuery<Record<string, LiveMetric>>({
    queryKey: ['kpi-live'],
    queryFn: async () => (await apiClient.get('/compliance/assessments/kpi-live')).data?.metrics || {},
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

  // ── Manual "Add KPI" (single KPI row appended to the active report) ──────────
  const emptyKpi = { item_number: '', area_domain: '', control_description: '', definition: '', source: '' };
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyKpi);
  const setA = (k: keyof typeof emptyKpi, v: string) => setAddForm((s) => ({ ...s, [k]: v }));
  const addKpi = useMutation({
    mutationFn: async () => {
      const remarks = [
        addForm.definition.trim() ? `Def: ${addForm.definition.trim()}` : '',
        addForm.source.trim() ? `Source: ${addForm.source.trim()}` : '',
      ].filter(Boolean).join(' | ');
      return apiClient.post(`/compliance/assessments/${activeId}/items`, {
        item_number: addForm.item_number.trim() || undefined,
        area_domain: addForm.area_domain.trim() || undefined,
        control_description: addForm.control_description.trim(),
        remarks: remarks || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kpi-detail', activeId] });
      qc.invalidateQueries({ queryKey: ['kpi-assessments'] });
      setAddForm(emptyKpi);
      setAddOpen(false);
    },
  });

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

  const { kpis, domains, live, onT, offT, ext } = useMemo(() => {
    const built: Kpi[] = buildKpis(detail?.items || [], liveMetrics);
    // live-below first (problems), then live-on-target, then external; by domain.
    const rank = (k: Kpi) => (!k.live ? 2 : k.onTarget === false ? 0 : 1);
    built.sort((a, b) => rank(a) - rank(b) || a.domain.localeCompare(b.domain));
    const liveKpis = built.filter((k) => k.live);
    return {
      kpis: built,
      domains: new Set(built.map((k) => k.domain)).size,
      live: liveKpis.length,
      onT: liveKpis.filter((k) => k.onTarget).length,
      offT: liveKpis.filter((k) => k.onTarget === false).length,
      ext: built.length - liveKpis.length,
    };
  }, [detail, liveMetrics]);

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
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Manage &amp; drill · {live} live · {ext} external</span>
            </div>
            <p className="text-[11px] text-gray-500">Actuals are computed live from real modules where the platform owns the data; the rest are flagged external.</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onUpload} />
          {activeId && (
            <button onClick={() => setAddOpen(true)} title="Add a KPI manually"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Plus className="h-3.5 w-3.5" /> Add KPI
            </button>
          )}
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
          <p className="mt-1 max-w-md text-xs text-slate-400">Upload the KPI report workbook to define the KPI set. Where a KPI maps to a real module, its value is computed live; the rest are flagged external.</p>
        </div>
      ) : detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Live KPIs" value={`${live}`} tone={TEAL} />
            <Stat label="On target" value={`${onT}`} tone={GOOD} />
            <Stat label="Below target" value={`${offT}`} tone={offT > 0 ? BAD : GOOD} />
            <Stat label="External (no feed)" value={`${ext}`} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex h-9 w-[280px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search KPIs…" className="w-full border-0 bg-transparent text-[13px] outline-none" />
            </div>
            <p className="text-[10.5px] text-slate-400">Live = computed from a real module · External = no in-platform feed · click a KPI for detail</p>
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

      <AnimatedModal isOpen={addOpen} onClose={() => setAddOpen(false)} title="Add KPI" subtitle="Manually append a KPI to this report" size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddOpen(false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancel</button>
            <button disabled={!addForm.control_description.trim() || addKpi.isPending} onClick={() => addKpi.mutate()} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {addKpi.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add KPI
            </button>
          </div>
        }
      >
        <div className="space-y-3 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={FLABEL}>Domain</label><input className={FIELD} value={addForm.area_domain} onChange={(e) => setA('area_domain', e.target.value)} placeholder="e.g. Vulnerability Management" /></div>
            <div><label className={FLABEL}>KPI number</label><input className={FIELD} value={addForm.item_number} onChange={(e) => setA('item_number', e.target.value)} placeholder="auto" /></div>
          </div>
          <div><label className={FLABEL}>KPI name *</label><input className={FIELD} value={addForm.control_description} onChange={(e) => setA('control_description', e.target.value)} placeholder="e.g. Critical patches applied within SLA" /></div>
          <div><label className={FLABEL}>Definition</label><textarea rows={2} className={FIELD} value={addForm.definition} onChange={(e) => setA('definition', e.target.value)} placeholder="How the KPI is measured…" /></div>
          <div><label className={FLABEL}>External source</label><input className={FIELD} value={addForm.source} onChange={(e) => setA('source', e.target.value)} placeholder="e.g. Nessus, SIEM (optional)" /></div>
          <p className="text-[11px] text-slate-400">Live actuals are computed only for KPIs mapped to a real module; manual KPIs show as external.</p>
          {addKpi.isError && <p className="text-xs text-rose-600">{(addKpi.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not add KPI.'}</p>}
        </div>
      </AnimatedModal>
    </div>
  );
}
