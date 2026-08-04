'use client';

// OWASP Testing — dedicated dashboard for the OWASP Web Security Testing Guide
// (Testing Guide v4). It's a penetration-testing checklist: ~89 OTG-coded tests
// grouped into 11 WSTG categories (Information Gathering, Authentication, Data
// Validation, …), each with a recommended tool set and a result (Pass = secure,
// Fail = issue found, N/A, or not-yet-tested). This page shows test coverage,
// issues found, per-category progress, and the tests grouped by category with
// inline result editing + per-test evidence. Data comes from the shared
// /compliance/assessments endpoints (format = owasp_v4_testing_checklist).

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bug, Loader2, Upload, CheckCircle2, XCircle, MinusCircle, Clock,
  ChevronRight, Search, Server, Plus, X, Paperclip, FileText, Wrench, Trash2,
} from 'lucide-react';
import apiClient, { assetsApi } from '@/lib/api';

const OWASP_FORMAT = 'owasp_v4_testing_checklist';

// The app shell (.platform-ui) forces raw `bg-slate-900`/`text-white` to the
// theme surface via an !important reset. Filled/primary elements use the theme
// token instead (matches Sidebar + the other assessment dashboards).
const PRIMARY: React.CSSProperties = { background: 'var(--color-base, #14b8a6)', color: '#fff' };

interface Item {
  id: number;
  item_number: string;
  area_domain: string | null;
  subdomain_name: string | null;
  control_description: string | null;
  compliance_status: string;
  evidence_reference: string | null;
  remarks: string | null;
  priority: string | null;
  evidence_count?: number;
}
interface Detail { id: number; name: string; source: string | null; file_name: string | null; items: Item[]; linked_asset_ids?: number[]; }
interface Asset { id: number; name: string; asset_type?: string; ip_address?: string }

// Pull "Tools: … | Note: … | Desc: …" out of the remarks blob (Desc is last and
// may contain '|', so match it to end-of-string).
function meta(remarks: string | null) {
  const r = remarks || '';
  const tools = /Tools:\s*([^|]+?)(?:\s*\|\s*(?:Note|Desc):|$)/i.exec(r)?.[1]?.trim() || '';
  const note = /Note:\s*([^|]+?)(?:\s*\|\s*Desc:|$)/i.exec(r)?.[1]?.trim() || '';
  const desc = /Desc:\s*([\s\S]*)$/i.exec(r)?.[1]?.trim() || '';
  return { tools, note, desc };
}

const STATUS = {
  complied: { label: 'Pass', color: '#059669', bg: '#ecfdf5', Icon: CheckCircle2 },
  not_complied: { label: 'Issue', color: '#dc2626', bg: '#fef2f2', Icon: XCircle },
  na: { label: 'N/A', color: '#64748b', bg: '#f1f5f9', Icon: MinusCircle },
  in_progress: { label: 'Not tested', color: '#b45309', bg: '#fffbeb', Icon: Clock },
} as const;
type StatusKey = keyof typeof STATUS;

// Per-test evidence: list + upload. Uploading marks the test Pass ("based on
// evidence it will pass") via the onUploaded callback.
function EvidencePanel({ assessmentId, itemId, onUploaded }: { assessmentId: number; itemId: number; onUploaded: () => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data: ev = [], isLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: ['owasp-ev', itemId],
    queryFn: async () => {
      const r = await apiClient.get(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence`);
      return (r.data?.evidence || r.data || []) as Record<string, unknown>[];
    },
  });
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      await apiClient.post(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      qc.invalidateQueries({ queryKey: ['owasp-ev', itemId] });
      qc.invalidateQueries({ queryKey: ['owasp-detail', assessmentId] });
      onUploaded();
    } catch { alert('Evidence upload failed.'); }
    finally { setUploading(false); if (ref.current) ref.current.value = ''; }
  };
  const list = Array.isArray(ev) ? ev : [];
  return (
    <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Evidence</span>
        <input ref={ref} type="file" className="hidden" onChange={onFile} />
        <button onClick={() => ref.current?.click()} disabled={uploading} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold hover:opacity-90 disabled:opacity-60">
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload evidence
        </button>
      </div>
      {isLoading ? (
        <div className="py-1 text-[12px] text-slate-400">Loading…</div>
      ) : list.length === 0 ? (
        <div className="py-1 text-[12px] text-slate-400">No evidence yet. Attach a screenshot, request/response or scan output to back this test.</div>
      ) : (
        <ul className="space-y-1">
          {list.map((e, i) => {
            const name = (e.evidence_name || (e.evidence as Record<string, unknown>)?.name || e.file_name || e.evidence_file_name || `Evidence ${i + 1}`) as string;
            return (
              <li key={(e.id as number) ?? i} className="flex items-center gap-2 text-[12px] text-slate-700">
                <FileText className="h-3.5 w-3.5 text-slate-400" /> <span className="truncate">{name}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function OwaspTestingTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [evOpen, setEvOpen] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'issues' | 'untested'>('all');

  const { data: list = [], isLoading: listLoading } = useQuery<{ id: number }[]>({
    queryKey: ['owasp-assessments'],
    queryFn: async () => (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: OWASP_FORMAT } })).data?.assessments || [],
    staleTime: 30_000,
  });
  const activeId = list[0]?.id ?? null;

  const { data: detail, isLoading: detailLoading } = useQuery<Detail>({
    queryKey: ['owasp-detail', activeId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${activeId}`)).data,
    enabled: !!activeId,
    staleTime: 30_000,
  });

  const setStatus = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) =>
      apiClient.put(`/compliance/assessments/items/${itemId}`, null, { params: { compliance_status: status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owasp-detail', activeId] }),
  });

  // Target application under test — OWASP testing verifies a web app, which is an
  // application asset. Lightweight link (reverse view lives on the asset page).
  const linkedIds: number[] = detail?.linked_asset_ids ?? [];
  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ['it-assets-list'],
    queryFn: async () => (await assetsApi.getAll({ limit: 500 })).data as Asset[],
    staleTime: 60_000,
  });
  const [addingAsset, setAddingAsset] = useState(false);
  const saveAssets = useMutation({
    mutationFn: async (ids: number[]) => apiClient.put(`/compliance/assessments/${activeId}/assets`, { asset_ids: ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owasp-detail', activeId] }),
  });
  const addAsset = (id: number) => { saveAssets.mutate([...new Set([...linkedIds, id])]); setAddingAsset(false); };
  const removeAsset = (id: number) => saveAssets.mutate(linkedIds.filter((x) => x !== id));

  const deleteAssessment = useMutation({
    mutationFn: async () => apiClient.delete(`/compliance/assessments/${activeId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owasp-assessments'] });
      qc.invalidateQueries({ queryKey: ['owasp-detail', activeId] });
    },
  });
  const onDelete = () => {
    if (!activeId) return;
    if (!confirm(`Delete "${detail?.name || 'OWASP Testing'}" and all ${detail?.items?.length ?? 0} tests (evidence and asset links included)? This cannot be undone.`)) return;
    deleteAssessment.mutate();
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (activeId) {
        await apiClient.post(`/compliance/assessments/${activeId}/reupload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        fd.append('name', 'OWASP Testing');
        fd.append('assessment_type', 'cybersecurity');
        fd.append('expected_format', OWASP_FORMAT);
        await apiClient.post('/compliance/assessments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      qc.invalidateQueries({ queryKey: ['owasp-assessments'] });
      qc.invalidateQueries({ queryKey: ['owasp-detail', activeId] });
    } catch (err) {
      const detailMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detailMsg || 'Upload failed. Make sure it is the OWASP Testing Guide v4 checklist workbook.');
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const { cats, overall } = useMemo(() => {
    const items = detail?.items || [];
    const byCat = new Map<string, Item[]>();
    for (const it of items) {
      const k = it.area_domain || 'Uncategorized';
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k)!.push(it);
    }
    const cats = [...byCat.entries()].map(([name, its]) => {
      const total = its.length;
      const passed = its.filter((i) => i.compliance_status === 'complied').length;
      const issues = its.filter((i) => i.compliance_status === 'not_complied').length;
      const tested = its.filter((i) => i.compliance_status !== 'in_progress').length;
      return { name, items: its, total, passed, issues, tested, pct: total ? Math.round((tested / total) * 100) : 0 };
    });

    const total = items.length;
    const passed = items.filter((i) => i.compliance_status === 'complied').length;
    const issues = items.filter((i) => i.compliance_status === 'not_complied').length;
    const na = items.filter((i) => i.compliance_status === 'na').length;
    const tested = items.filter((i) => i.compliance_status !== 'in_progress').length;
    const coverage = total ? Math.round((tested / total) * 100) : 0;
    return { cats, overall: { total, passed, issues, na, tested, coverage } };
  }, [detail]);

  if (listLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;

  const term = search.trim().toLowerCase();
  const covColor = (p: number) => (p >= 80 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={PRIMARY}><Bug className="h-6 w-6 text-white" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-gray-900">OWASP Testing</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">OWASP Web Security Testing Guide v4</span>
            </div>
            <p className="text-[11px] text-gray-500">{detail?.source || detail?.file_name || 'Penetration-testing checklist · 11 categories'}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploading ? 'Uploading…' : activeId ? 'Re-upload OWASP Excel' : 'Upload OWASP Excel'}
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
          <Bug className="mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No OWASP Testing checklist uploaded yet.</p>
          <p className="mt-1 max-w-md text-xs text-slate-400">Upload the OWASP Testing Guide v4 checklist workbook — every OTG test, category, recommended tool set and result is parsed into this dashboard automatically.</p>
        </div>
      ) : detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : (
        <>
          {/* Target application (asset link) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <Server className="h-4 w-4 text-slate-400" />
              <h4 className="text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Target application</h4>
              <span className="text-[11px] text-slate-400">link the web app asset this engagement covers</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {linkedIds.length === 0 && !addingAsset && <span className="text-[12px] text-slate-400">No app linked yet.</span>}
              {linkedIds.map((id) => {
                const a = assets.find((x) => x.id === id);
                return (
                  <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-medium text-slate-600">
                    <Server className="h-3 w-3 text-slate-400" />
                    {a ? a.name : `Asset #${id}`}
                    {a?.asset_type && <span className="text-[10px] opacity-70">{a.asset_type}</span>}
                    <button onClick={() => removeAsset(id)} title="Remove" className="opacity-60 hover:text-rose-500 hover:opacity-100"><X className="h-3 w-3" /></button>
                  </span>
                );
              })}
              {addingAsset ? (
                <select autoFocus onChange={(e) => e.target.value && addAsset(Number(e.target.value))} defaultValue="" className="rounded-md border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-slate-400">
                  <option value="" disabled>Select an asset…</option>
                  {assets.filter((a) => !linkedIds.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}{a.asset_type ? ` · ${a.asset_type}` : ''}</option>)}
                </select>
              ) : (
                <button onClick={() => setAddingAsset(true)} disabled={saveAssets.isPending} className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-500 hover:border-slate-400 hover:bg-slate-50">
                  <Plus className="h-3 w-3" /> Link app
                </button>
              )}
              {saveAssets.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            </div>
          </div>

          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Test coverage</div>
              <div className="text-[26px] font-bold tabular-nums" style={{ color: covColor(overall.coverage) }}>{overall.coverage}%</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${overall.coverage}%`, backgroundColor: covColor(overall.coverage) }} /></div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Issues found</div>
              <div className="text-[26px] font-bold tabular-nums text-rose-600">{overall.issues}</div>
              <div className="mt-1 text-[11px] text-slate-400">across {cats.filter((c) => c.issues > 0).length} categories</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Passed / tested</div>
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] font-bold tabular-nums text-emerald-600">{overall.passed}</span>
                <span className="text-slate-300">/</span>
                <span className="text-[22px] font-bold tabular-nums text-slate-700">{overall.tested}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{overall.na} N/A</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Tests</div>
              <div className="text-[26px] font-bold tabular-nums text-slate-900">{overall.total}</div>
              <div className="mt-1 text-[11px] text-slate-400">{overall.total - overall.tested} not tested · {cats.length} categories</div>
            </div>
          </div>

          {/* Category coverage */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Coverage by category</h4>
            <div className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
              {cats.map((c) => (
                <button key={c.name} onClick={() => setOpenCat(c.name)} className="group flex items-center gap-3 text-left">
                  <span className="w-52 shrink-0 truncate text-[12.5px] font-medium text-slate-700 group-hover:text-slate-900">{c.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${c.pct}%`, backgroundColor: covColor(c.pct) }} /></div>
                  <span className="w-10 shrink-0 text-right text-[12px] font-bold tabular-nums" style={{ color: covColor(c.pct) }}>{c.pct}%</span>
                  {c.issues > 0 && <span className="w-14 shrink-0 text-right text-[11px] font-semibold text-rose-600">{c.issues} issue{c.issues > 1 ? 's' : ''}</span>}
                  {c.issues === 0 && <span className="w-14 shrink-0 text-right text-[11px] text-slate-400">{c.tested}/{c.total}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Tests, grouped by category */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-[260px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tests…" className="w-full border-0 bg-transparent text-[13px] outline-none" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Show</span>
              {(['all', 'issues', 'untested'] as const).map((f) => (
                <button key={f} onClick={() => setStatusFilter(f)} style={statusFilter === f ? PRIMARY : undefined} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${statusFilter === f ? 'border-transparent' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{f === 'all' ? 'All' : f === 'issues' ? 'Issues' : 'Not tested'}</button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {cats.map((c) => {
              const rows = c.items.filter((it) => {
                if (statusFilter === 'issues' && it.compliance_status !== 'not_complied') return false;
                if (statusFilter === 'untested' && it.compliance_status !== 'in_progress') return false;
                if (term && !(`${it.item_number} ${it.control_description} ${meta(it.remarks).desc}`.toLowerCase().includes(term))) return false;
                return true;
              });
              if (rows.length === 0) return null;
              const open = openCat === c.name || term !== '' || statusFilter !== 'all';
              return (
                <div key={c.name} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <button onClick={() => setOpenCat(open && openCat === c.name ? null : c.name)} className="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span className="flex-1 text-left text-[14px] font-bold text-slate-800">{c.name}</span>
                    {c.issues > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">{c.issues} issue{c.issues > 1 ? 's' : ''}</span>}
                    <span className="text-[11px] text-slate-400">{rows.length} tests</span>
                    <span className="w-10 text-right text-[12px] font-bold tabular-nums" style={{ color: covColor(c.pct) }}>{c.pct}%</span>
                  </button>
                  {open && (
                    <div className="divide-y divide-slate-100 border-t border-slate-100">
                      {rows.map((it) => {
                        const m = meta(it.remarks);
                        const evc = it.evidence_count ?? 0;
                        const evActive = evOpen === it.id;
                        const tools = m.tools ? m.tools.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6) : [];
                        return (
                          <div key={it.id}>
                            <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                              <div className="w-28 shrink-0">
                                <span className="font-mono text-[11.5px] font-semibold text-slate-500">{it.item_number}</span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium leading-snug text-slate-800">{it.control_description}</p>
                                {m.desc && <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{m.desc}</p>}
                                {tools.length > 0 && (
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <Wrench className="h-3 w-3 text-slate-300" />
                                    {tools.map((t) => (
                                      <span key={t} className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{t}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button onClick={() => setEvOpen(evActive ? null : it.id)} title="Evidence — attaching evidence marks this Pass"
                                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition"
                                  style={evActive || evc > 0 ? { borderColor: '#0f766e', color: '#0f766e', backgroundColor: '#e7faf5' } : { borderColor: '#e2e8f0', color: '#64748b' }}>
                                  <Paperclip className="h-3 w-3" /> {evc > 0 ? evc : 'Evidence'}
                                </button>
                                {(['complied', 'not_complied', 'na', 'in_progress'] as const).map((s) => {
                                  const sm = STATUS[s as StatusKey]; const on = it.compliance_status === s;
                                  return (
                                    <button key={s} title={sm.label} disabled={setStatus.isPending}
                                      onClick={() => setStatus.mutate({ itemId: it.id, status: s })}
                                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition"
                                      style={on ? { backgroundColor: sm.bg, color: sm.color, borderColor: sm.color } : { borderColor: '#e2e8f0', color: '#94a3b8' }}>
                                      <sm.Icon className="h-3 w-3" /> {sm.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            {evActive && (
                              <EvidencePanel
                                assessmentId={activeId!}
                                itemId={it.id}
                                onUploaded={() => setStatus.mutate({ itemId: it.id, status: 'complied' })}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
