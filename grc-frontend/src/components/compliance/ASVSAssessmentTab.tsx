'use client';

// OWASP ASVS — dedicated dashboard. ASVS is a security verification checklist:
// 14 categories (Authentication, Architecture, …) × ~286 verification
// requirements, each tagged with an ASVS Level (1-3), CWE + NIST mappings, and a
// pass/fail (Valid) status. This page shows overall validity, the level
// achieved, per-category validity bars, and the requirements grouped by
// category with inline pass/fail editing. Data comes from the shared
// /compliance/assessments endpoints (format = asvs_checklist).

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Loader2, Upload, CheckCircle2, XCircle, MinusCircle, Clock,
  ChevronRight, Search, Server, Plus, X, Paperclip, FileText, Trash2,
} from 'lucide-react';
import apiClient, { assetsApi } from '@/lib/api';

const ASVS_FORMAT = 'asvs_checklist';

// The app shell (.platform-ui) forces raw `bg-slate-900`/`text-white` to the
// theme surface via an !important reset, turning dark buttons white-on-white.
// Filled/primary elements use the theme token instead (matches Sidebar).
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
  asset_status?: Record<string, string>;
}
interface Detail { id: number; name: string; source: string | null; file_name: string | null; items: Item[]; linked_asset_ids?: number[]; asset_levels?: Record<string, number>; }
interface Asset { id: number; name: string; asset_type?: string; ip_address?: string }

// Pull "ASVS Level: 1 | CWE: 285 | NIST: 5.1.1.2" out of the remarks blob.
function meta(remarks: string | null) {
  const r = remarks || '';
  const level = /ASVS Level:\s*([0-9]+)/i.exec(r)?.[1] || '';
  const cwe = /CWE:\s*([^|]+)/i.exec(r)?.[1]?.trim() || '';
  const nist = /NIST:\s*([^|]+)/i.exec(r)?.[1]?.trim() || '';
  return { level, cwe, nist };
}

const STATUS = {
  complied: { label: 'Pass', color: '#059669', bg: '#ecfdf5', Icon: CheckCircle2 },
  not_complied: { label: 'Fail', color: '#dc2626', bg: '#fef2f2', Icon: XCircle },
  na: { label: 'N/A', color: '#64748b', bg: '#f1f5f9', Icon: MinusCircle },
  in_progress: { label: 'Not tested', color: '#b45309', bg: '#fffbeb', Icon: Clock },
} as const;
type StatusKey = keyof typeof STATUS;
const statusMeta = (s: string) => STATUS[(s as StatusKey)] ?? STATUS.in_progress;

// Per-requirement evidence: list + upload. Uploading marks the requirement Pass
// ("based on evidence it will pass") via the onUploaded callback.
function EvidencePanel({ assessmentId, itemId, onUploaded }: { assessmentId: number; itemId: number; onUploaded: () => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data: ev = [], isLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: ['asvs-ev', itemId],
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
      qc.invalidateQueries({ queryKey: ['asvs-ev', itemId] });
      qc.invalidateQueries({ queryKey: ['asvs-detail', assessmentId] });
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
        <div className="py-1 text-[12px] text-slate-400">No evidence yet. Upload a file to back this requirement — it will be marked Pass.</div>
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

export default function ASVSAssessmentTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [evOpen, setEvOpen] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | '1' | '2' | '3'>('all');

  const { data: list = [], isLoading: listLoading } = useQuery<{ id: number }[]>({
    queryKey: ['asvs-assessments'],
    queryFn: async () => (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: ASVS_FORMAT } })).data?.assessments || [],
    staleTime: 30_000,
  });
  const activeId = list[0]?.id ?? null;

  const { data: detail, isLoading: detailLoading } = useQuery<Detail>({
    queryKey: ['asvs-detail', activeId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${activeId}`)).data,
    enabled: !!activeId,
    staleTime: 30_000,
  });

  const linkedIds: number[] = detail?.linked_asset_ids ?? [];
  // Which in-scope asset's results we're viewing/editing. Defaults to the first.
  const [selectedAsset, setSelectedAsset] = useState<number | null>(null);
  const activeAsset = selectedAsset ?? (linkedIds.length ? linkedIds[0] : null);
  // A requirement's status FOR THE ACTIVE ASSET (falls back to the global one
  // when the assessment has no assets in scope).
  const statusOf = (it: Item): string => (activeAsset != null ? (it.asset_status?.[String(activeAsset)] ?? 'in_progress') : it.compliance_status);

  // Per-asset target ASVS level (AI-suggested, user-overridable) + scope filter.
  const assetLevels: Record<string, number> = detail?.asset_levels ?? {};
  const targetLevel: number | null = activeAsset != null ? (assetLevels[String(activeAsset)] ?? null) : null;
  const [scopeMode, setScopeMode] = useState<'hide' | 'show'>('hide');
  const reqLevel = (it: Item) => Number(meta(it.remarks).level || 1);
  const inScope = (it: Item) => (targetLevel == null ? true : reqLevel(it) <= targetLevel);

  const setLevel = useMutation({
    mutationFn: async ({ asset, level }: { asset: number; level: number }) => apiClient.put(`/compliance/assessments/${activeId}/asset-level`, { asset_id: asset, level }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asvs-detail', activeId] }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) => {
      const params: Record<string, string | number> = { compliance_status: status };
      if (activeAsset != null) params.asset_id = activeAsset;
      return apiClient.put(`/compliance/assessments/items/${itemId}`, null, { params });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asvs-detail', activeId] }),
  });

  // IT Assets this ASVS verifies (scope). Fetch the inventory for the picker.
  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ['it-assets-list'],
    queryFn: async () => (await assetsApi.getAll({ limit: 500 })).data as Asset[],
    staleTime: 60_000,
  });
  const [addingAsset, setAddingAsset] = useState(false);
  const saveAssets = useMutation({
    mutationFn: async (ids: number[]) => apiClient.put(`/compliance/assessments/${activeId}/assets`, { asset_ids: ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asvs-detail', activeId] }),
  });
  const addAsset = (id: number) => { saveAssets.mutate([...new Set([...linkedIds, id])]); setAddingAsset(false); };
  const removeAsset = (id: number) => saveAssets.mutate(linkedIds.filter((x) => x !== id));

  // Delete the whole assessment (destructive — confirm first). On success the
  // list query empties and the page falls back to the upload empty-state.
  const deleteAssessment = useMutation({
    mutationFn: async () => apiClient.delete(`/compliance/assessments/${activeId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asvs-assessments'] });
      qc.invalidateQueries({ queryKey: ['asvs-detail', activeId] });
    },
  });
  const onDelete = () => {
    if (!activeId) return;
    if (!confirm(`Delete "${detail?.name || 'OWASP ASVS'}" and all ${detail?.items?.length ?? 0} requirements (evidence and asset links included)? This cannot be undone.`)) return;
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
        fd.append('name', 'OWASP ASVS');
        fd.append('assessment_type', 'gap_assessment');
        // Bind this upload button to its own template — the backend rejects any
        // other workbook so the wrong Excel can't land on this tab.
        fd.append('expected_format', ASVS_FORMAT);
        await apiClient.post('/compliance/assessments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      qc.invalidateQueries({ queryKey: ['asvs-assessments'] });
      qc.invalidateQueries({ queryKey: ['asvs-detail', activeId] });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || 'Upload failed. Make sure it is the ASVS checklist workbook.');
    }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const { cats, overall, levels } = useMemo(() => {
    const items = detail?.items || [];
    // Stats are computed over the IN-SCOPE requirements for the active asset's
    // target level (all of them when no level is set).
    const scoped = items.filter(inScope);
    const byCat = new Map<string, Item[]>();
    for (const it of items) {
      const k = it.area_domain || 'Uncategorized';
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k)!.push(it);
    }
    const cats = [...byCat.entries()].map(([name, its]) => {
      const sc = its.filter(inScope);
      const total = sc.length;
      const valid = sc.filter((i) => statusOf(i) === 'complied').length;
      const na = sc.filter((i) => statusOf(i) === 'na').length;
      const denom = Math.max(1, total - na);
      return { name, items: its, total, valid, na, pct: total ? Math.round((valid / denom) * 100) : 0 };
    }).sort((a, b) => b.total - a.total);

    const total = scoped.length;
    const valid = scoped.filter((i) => statusOf(i) === 'complied').length;
    const failed = scoped.filter((i) => statusOf(i) === 'not_complied').length;
    const na = scoped.filter((i) => statusOf(i) === 'na').length;
    const tested = scoped.filter((i) => statusOf(i) !== 'in_progress').length;
    const pct = Math.round((valid / Math.max(1, total - na)) * 100);

    // Level achieved: highest level L where every in-scope requirement is valid.
    const lv: Record<string, { total: number; valid: number }> = { '1': { total: 0, valid: 0 }, '2': { total: 0, valid: 0 }, '3': { total: 0, valid: 0 } };
    for (const it of scoped) {
      const l = meta(it.remarks).level;
      if (lv[l]) { lv[l].total++; if (statusOf(it) === 'complied') lv[l].valid++; }
    }
    let achieved = 0;
    for (const L of ['1', '2', '3']) {
      if (lv[L].total > 0 && lv[L].valid === lv[L].total) achieved = Number(L); else break;
    }
    return { cats, overall: { total, valid, failed, na, tested, pct, achieved }, levels: lv };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, activeAsset, targetLevel]);

  if (listLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;

  const term = search.trim().toLowerCase();
  const scoreColor = (p: number) => (p >= 80 ? '#059669' : p >= 50 ? '#d97706' : '#dc2626');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={PRIMARY}><Shield className="h-6 w-6 text-white" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-gray-900">OWASP ASVS</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Application Security Verification Standard</span>
            </div>
            <p className="text-[11px] text-gray-500">{detail?.source || detail?.file_name || 'Security verification checklist · 14 categories'}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploading ? 'Uploading…' : activeId ? 'Re-upload ASVS Excel' : 'Upload ASVS Excel'}
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
          <Shield className="mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No ASVS checklist uploaded yet.</p>
          <p className="mt-1 max-w-md text-xs text-slate-400">Upload the OWASP ASVS checklist workbook and each category, requirement, level, CWE and NIST mapping is parsed into this dashboard automatically.</p>
        </div>
      ) : detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : (
        <>
          {/* Assets in scope — the application(s)/system(s) this ASVS verifies */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <Server className="h-4 w-4 text-slate-400" />
              <h4 className="text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Assets in scope</h4>
              <span className="text-[11px] text-slate-400">click an asset to view / verify its own results</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {linkedIds.length === 0 && !addingAsset && <span className="text-[12px] text-slate-400">No assets linked yet.</span>}
              {linkedIds.map((id) => {
                const a = assets.find((x) => x.id === id);
                const on = activeAsset === id;
                return (
                  <span key={id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition" style={on ? { borderColor: '#0f766e', background: '#e7faf5', color: '#0f766e' } : { borderColor: '#e2e8f0', background: '#f8fafc', color: '#475569' }}>
                    <button onClick={() => setSelectedAsset(id)} title="View this asset's ASVS results" className="inline-flex items-center gap-1.5">
                      <Server className="h-3 w-3" style={{ color: on ? '#0f766e' : '#94a3b8' }} />
                      {a ? a.name : `Asset #${id}`}
                      {a?.asset_type && <span className="text-[10px] opacity-70">{a.asset_type}</span>}
                    </button>
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
                  <Plus className="h-3 w-3" /> Add asset
                </button>
              )}
              {saveAssets.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            </div>
          </div>

          {/* Per-asset target level + scope toggle */}
          {activeAsset != null && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
              <span className="text-[12.5px] font-semibold text-slate-700">Target ASVS level</span>
              {setLevel.isPending ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> saving…</span>
              ) : (
                <select value={targetLevel ?? ''} onChange={(e) => setLevel.mutate({ asset: activeAsset, level: Number(e.target.value) })} className="rounded-md border border-slate-200 px-2 py-1 text-[12px] font-semibold text-slate-800 outline-none focus:border-slate-400">
                  <option value="" disabled>Choose a level…</option>
                  <option value={1}>L1 · baseline</option>
                  <option value={2}>L2 · sensitive data</option>
                  <option value={3}>L3 · critical</option>
                </select>
              )}
              <span className="text-[11px] text-slate-400">{overall.total} of {detail?.items?.length ?? 0} rules apply</span>
              <div className="flex-1" />
              <span className="text-[11px] text-slate-400">Out of scope:</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setScopeMode('hide')} style={scopeMode === 'hide' ? PRIMARY : undefined} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${scopeMode === 'hide' ? 'border-transparent' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Hide</button>
                <button onClick={() => setScopeMode('show')} style={scopeMode === 'show' ? PRIMARY : undefined} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${scopeMode === 'show' ? 'border-transparent' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Show greyed</button>
              </div>
            </div>
          )}

          {/* Overall KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Validity</div>
              <div className="text-[26px] font-bold tabular-nums" style={{ color: scoreColor(overall.pct) }}>{overall.pct}%</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${overall.pct}%`, backgroundColor: scoreColor(overall.pct) }} /></div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">ASVS level achieved</div>
              <div className="text-[26px] font-bold tabular-nums text-slate-900">{overall.achieved > 0 ? `L${overall.achieved}` : '—'}</div>
              <div className="mt-1 flex gap-1">
                {(['1', '2', '3'] as const).map((L) => (
                  <span key={L} className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: overall.achieved >= Number(L) ? '#ecfdf5' : '#f1f5f9', color: overall.achieved >= Number(L) ? '#059669' : '#94a3b8' }}>
                    L{L} {levels[L].valid}/{levels[L].total}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Requirements</div>
              <div className="text-[26px] font-bold tabular-nums text-slate-900">{overall.total}</div>
              <div className="mt-1 text-[11px] text-slate-400">{overall.tested} tested · {cats.length} categories</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Pass / Fail</div>
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] font-bold tabular-nums text-emerald-600">{overall.valid}</span>
                <span className="text-slate-300">/</span>
                <span className="text-[22px] font-bold tabular-nums text-rose-600">{overall.failed}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{overall.na} N/A · {overall.total - overall.tested} not tested</div>
            </div>
          </div>

          {/* Category validity */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Validity by category</h4>
            <div className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
              {cats.map((c) => (
                <button key={c.name} onClick={() => setOpenCat(c.name)} className="group flex items-center gap-3 text-left">
                  <span className="w-40 shrink-0 truncate text-[12.5px] font-medium text-slate-700 group-hover:text-slate-900">{c.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${c.pct}%`, backgroundColor: scoreColor(c.pct) }} /></div>
                  <span className="w-10 shrink-0 text-right text-[12px] font-bold tabular-nums" style={{ color: scoreColor(c.pct) }}>{c.pct}%</span>
                  <span className="w-12 shrink-0 text-right text-[11px] text-slate-400">{c.valid}/{c.total}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Requirements, grouped by category */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-[260px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requirements…" className="w-full border-0 bg-transparent text-[13px] outline-none" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Level</span>
              {(['all', '1', '2', '3'] as const).map((L) => (
                <button key={L} onClick={() => setLevelFilter(L)} style={levelFilter === L ? PRIMARY : undefined} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${levelFilter === L ? 'border-transparent' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{L === 'all' ? 'All' : `L${L}`}</button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {cats.map((c) => {
              const rows = c.items.filter((it) => {
                if (scopeMode === 'hide' && !inScope(it)) return false;
                if (levelFilter !== 'all' && meta(it.remarks).level !== levelFilter) return false;
                if (term && !(`${it.item_number} ${it.control_description}`.toLowerCase().includes(term))) return false;
                return true;
              });
              if (rows.length === 0) return null;
              const open = openCat === c.name || term !== '' || levelFilter !== 'all';
              return (
                <div key={c.name} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <button onClick={() => setOpenCat(open && openCat === c.name ? null : c.name)} className="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span className="flex-1 text-left text-[14px] font-bold text-slate-800">{c.name}</span>
                    <span className="text-[11px] text-slate-400">{rows.length} requirements</span>
                    <span className="w-10 text-right text-[12px] font-bold tabular-nums" style={{ color: scoreColor(c.pct) }}>{c.pct}%</span>
                  </button>
                  {open && (
                    <div className="divide-y divide-slate-100 border-t border-slate-100">
                      {rows.map((it) => {
                        const m = meta(it.remarks);
                        const evc = it.evidence_count ?? 0;
                        const evActive = evOpen === it.id;
                        const oos = !inScope(it);
                        return (
                          <div key={it.id}>
                            <div className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start ${oos ? 'opacity-45' : ''}`}>
                              <div className="flex w-24 shrink-0 items-center gap-2">
                                <span className="font-mono text-[12px] font-semibold text-slate-500">{it.item_number}</span>
                                {m.level && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">L{m.level}</span>}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] leading-snug text-slate-800">{it.control_description}</p>
                                {it.subdomain_name && (
                                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-slate-400">
                                    <span className="font-medium text-slate-500">{it.subdomain_name}</span>
                                  </div>
                                )}
                              </div>
                              {oos ? (
                                <div className="flex shrink-0 items-center">
                                  <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-400">Out of scope · L{m.level} &gt; target</span>
                                </div>
                              ) : (
                              <div className="flex shrink-0 items-center gap-1">
                                <button onClick={() => setEvOpen(evActive ? null : it.id)} title="Evidence — attaching evidence marks this Pass"
                                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition"
                                  style={evActive || evc > 0 ? { borderColor: '#0f766e', color: '#0f766e', backgroundColor: '#e7faf5' } : { borderColor: '#e2e8f0', color: '#64748b' }}>
                                  <Paperclip className="h-3 w-3" /> {evc > 0 ? evc : 'Evidence'}
                                </button>
                                {(['complied', 'not_complied', 'na', 'in_progress'] as const).map((s) => {
                                  const meta2 = STATUS[s]; const on = statusOf(it) === s;
                                  return (
                                    <button key={s} title={meta2.label} disabled={setStatus.isPending}
                                      onClick={() => setStatus.mutate({ itemId: it.id, status: s })}
                                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition"
                                      style={on ? { backgroundColor: meta2.bg, color: meta2.color, borderColor: meta2.color } : { borderColor: '#e2e8f0', color: '#94a3b8' }}>
                                      <meta2.Icon className="h-3 w-3" /> {meta2.label}
                                    </button>
                                  );
                                })}
                              </div>
                              )}
                            </div>
                            {evActive && !oos && (
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
