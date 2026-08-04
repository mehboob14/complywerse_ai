'use client';

// OWASP MASVS — Mobile Application Security dedicated dashboard. The MASVS
// checklist verifies a mobile app across two platforms (Android + iOS). Each
// platform has V1-V7 security requirements (Level 1 / Level 2) plus a V8
// Resilience set (R). Every requirement carries an MSTG-ID, a level set
// (L1/L2/R), a testing procedure and a Pass/Fail/N/A status. The natural scope
// dimension here is the PLATFORM, so this page toggles Android vs iOS and shows
// compliance, the MASVS level achieved, per-category bars and the requirements
// grouped by category with inline status + per-requirement evidence.
// Data comes from the shared /compliance/assessments endpoints
// (format = mobile_app_security).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Smartphone, Loader2, Upload, CheckCircle2, XCircle, MinusCircle, Clock,
  ChevronRight, Search, Server, Plus, X, Paperclip, FileText, ShieldCheck, Trash2,
} from 'lucide-react';
import apiClient, { assetsApi } from '@/lib/api';

const MASVS_FORMAT = 'mobile_app_security';

// The app shell (.platform-ui) forces raw `bg-slate-900`/`text-white` to the
// theme surface via an !important reset, which turns dark buttons white-on-white.
// Filled/primary elements must use the theme token instead — matching the rest
// of the app (e.g. Sidebar uses `var(--color-base, #14b8a6)`).
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

// Pull "Platform: Android | MASVS: L1,L2 | MSTG: MSTG-ARCH-1 | Testing: …" out
// of the remarks blob written by the backend parser.
function meta(remarks: string | null) {
  const r = remarks || '';
  const platform = /Platform:\s*([^|]+)/i.exec(r)?.[1]?.trim() || '';
  const levelsRaw = /MASVS:\s*([^|]+)/i.exec(r)?.[1]?.trim() || '';
  const levels = levelsRaw ? levelsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const mstg = /MSTG:\s*([^|]+)/i.exec(r)?.[1]?.trim() || '';
  const testing = /Testing:\s*([^|]+)/i.exec(r)?.[1]?.trim() || '';
  return { platform, levels, mstg, testing };
}

const STATUS = {
  complied: { label: 'Pass', color: '#059669', bg: '#ecfdf5', Icon: CheckCircle2 },
  not_complied: { label: 'Fail', color: '#dc2626', bg: '#fef2f2', Icon: XCircle },
  na: { label: 'N/A', color: '#64748b', bg: '#f1f5f9', Icon: MinusCircle },
  in_progress: { label: 'Not tested', color: '#b45309', bg: '#fffbeb', Icon: Clock },
} as const;
type StatusKey = keyof typeof STATUS;

// MASVS verification levels — L1 baseline, L2 defence-in-depth, R resilience.
const LEVEL_STYLE: Record<string, { bg: string; color: string }> = {
  L1: { bg: '#eff6ff', color: '#2563eb' },
  L2: { bg: '#f5f3ff', color: '#7c3aed' },
  R: { bg: '#fffbeb', color: '#b45309' },
};

// Per-requirement evidence: list + upload. Uploading marks the requirement Pass
// ("based on evidence it will pass") via the onUploaded callback.
function EvidencePanel({ assessmentId, itemId, onUploaded }: { assessmentId: number; itemId: number; onUploaded: () => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data: ev = [], isLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: ['masvs-ev', itemId],
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
      qc.invalidateQueries({ queryKey: ['masvs-ev', itemId] });
      qc.invalidateQueries({ queryKey: ['masvs-detail', assessmentId] });
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

export default function MobileAppSecurityTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [evOpen, setEvOpen] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | 'L1' | 'L2' | 'R'>('all');
  const [platform, setPlatform] = useState<string | null>(null);

  const { data: list = [], isLoading: listLoading } = useQuery<{ id: number }[]>({
    queryKey: ['masvs-assessments'],
    queryFn: async () => (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: MASVS_FORMAT } })).data?.assessments || [],
    staleTime: 30_000,
  });
  const activeId = list[0]?.id ?? null;

  const { data: detail, isLoading: detailLoading } = useQuery<Detail>({
    queryKey: ['masvs-detail', activeId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${activeId}`)).data,
    enabled: !!activeId,
    staleTime: 30_000,
  });

  // Platforms present in the workbook (Android / iOS). Default to the first.
  const platforms = useMemo(() => {
    const set = new Set<string>();
    for (const it of detail?.items || []) { const p = meta(it.remarks).platform; if (p) set.add(p); }
    return [...set].sort((a, b) => (a === 'Android' ? -1 : b === 'Android' ? 1 : a.localeCompare(b)));
  }, [detail]);
  useEffect(() => { if (!platform && platforms.length) setPlatform(platforms[0]); }, [platforms, platform]);
  const activePlatform = platform ?? platforms[0] ?? null;

  const setStatus = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) =>
      apiClient.put(`/compliance/assessments/items/${itemId}`, null, { params: { compliance_status: status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['masvs-detail', activeId] }),
  });

  // The mobile app under test IS an application asset — keep a lightweight link
  // so the audit is traceable from the IT-asset side (reverse view). One
  // assessment = one app, so this is a tag, not a per-asset results switch.
  const linkedIds: number[] = detail?.linked_asset_ids ?? [];
  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ['it-assets-list'],
    queryFn: async () => (await assetsApi.getAll({ limit: 500 })).data as Asset[],
    staleTime: 60_000,
  });
  const [addingAsset, setAddingAsset] = useState(false);
  const saveAssets = useMutation({
    mutationFn: async (ids: number[]) => apiClient.put(`/compliance/assessments/${activeId}/assets`, { asset_ids: ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['masvs-detail', activeId] }),
  });
  const addAsset = (id: number) => { saveAssets.mutate([...new Set([...linkedIds, id])]); setAddingAsset(false); };
  const removeAsset = (id: number) => saveAssets.mutate(linkedIds.filter((x) => x !== id));

  // Delete the whole assessment (destructive — confirm first). On success the
  // list query empties and the page falls back to the upload empty-state.
  const deleteAssessment = useMutation({
    mutationFn: async () => apiClient.delete(`/compliance/assessments/${activeId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['masvs-assessments'] });
      qc.invalidateQueries({ queryKey: ['masvs-detail', activeId] });
    },
  });
  const onDelete = () => {
    if (!activeId) return;
    if (!confirm(`Delete "${detail?.name || 'Mobile App Security'}" and all ${detail?.items?.length ?? 0} requirements (evidence and asset links included)? This cannot be undone.`)) return;
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
        fd.append('name', 'Mobile App Security');
        fd.append('assessment_type', 'cybersecurity');
        // Bind this upload button to its own template — the backend rejects any
        // other workbook so the wrong Excel can't land on this tab.
        fd.append('expected_format', MASVS_FORMAT);
        await apiClient.post('/compliance/assessments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      qc.invalidateQueries({ queryKey: ['masvs-assessments'] });
      qc.invalidateQueries({ queryKey: ['masvs-detail', activeId] });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || 'Upload failed. Make sure it is the OWASP MASVS Mobile App Security checklist workbook.');
    }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const { cats, overall, levels } = useMemo(() => {
    const items = (detail?.items || []).filter((it) => !activePlatform || meta(it.remarks).platform === activePlatform);
    const byCat = new Map<string, Item[]>();
    for (const it of items) {
      const k = it.area_domain || 'Uncategorized';
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k)!.push(it);
    }
    const cats = [...byCat.entries()].map(([name, its]) => {
      const total = its.length;
      const valid = its.filter((i) => i.compliance_status === 'complied').length;
      const na = its.filter((i) => i.compliance_status === 'na').length;
      const denom = Math.max(1, total - na);
      return { name, items: its, total, valid, na, pct: total ? Math.round((valid / denom) * 100) : 0 };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const total = items.length;
    const valid = items.filter((i) => i.compliance_status === 'complied').length;
    const failed = items.filter((i) => i.compliance_status === 'not_complied').length;
    const na = items.filter((i) => i.compliance_status === 'na').length;
    const tested = items.filter((i) => i.compliance_status !== 'in_progress').length;
    const pct = Math.round((valid / Math.max(1, total - na)) * 100);

    // MASVS-L1 / L2 / R coverage: for each level, the fraction of applicable
    // (non-N/A) requirements that Pass.
    const lv: Record<string, { total: number; valid: number }> = { L1: { total: 0, valid: 0 }, L2: { total: 0, valid: 0 }, R: { total: 0, valid: 0 } };
    for (const it of items) {
      if (it.compliance_status === 'na') continue;
      for (const L of meta(it.remarks).levels) {
        if (lv[L]) { lv[L].total++; if (it.compliance_status === 'complied') lv[L].valid++; }
      }
    }
    // Level achieved: L1 → L2 in order (each fully passed), R reported separately.
    let achieved = '';
    if (lv.L1.total > 0 && lv.L1.valid === lv.L1.total) achieved = 'L1';
    if (achieved === 'L1' && lv.L2.total > 0 && lv.L2.valid === lv.L2.total) achieved = 'L2';
    return { cats, overall: { total, valid, failed, na, tested, pct, achieved }, levels: lv };
  }, [detail, activePlatform]);

  if (listLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;

  const term = search.trim().toLowerCase();
  const scoreColor = (p: number) => (p >= 80 ? '#059669' : p >= 50 ? '#d97706' : '#dc2626');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={PRIMARY}><Smartphone className="h-6 w-6 text-white" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-gray-900">Mobile App Security</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">OWASP MASVS · Mobile Application Security</span>
            </div>
            <p className="text-[11px] text-gray-500">{detail?.source || detail?.file_name || 'Mobile app verification checklist · Android + iOS'}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploading ? 'Uploading…' : activeId ? 'Re-upload MASVS Excel' : 'Upload MASVS Excel'}
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
          <Smartphone className="mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No Mobile App Security checklist uploaded yet.</p>
          <p className="mt-1 max-w-md text-xs text-slate-400">Upload the OWASP MASVS Mobile Application Security checklist workbook — every category, requirement, MSTG-ID, level (L1/L2/R) and testing procedure is parsed into this dashboard for both Android and iOS.</p>
        </div>
      ) : detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : (
        <>
          {/* App under test (asset link) + platform toggle */}
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2">
                <Server className="h-4 w-4 text-slate-400" />
                <h4 className="text-[12.5px] font-bold uppercase tracking-wide text-slate-500">App under test</h4>
                <span className="text-[11px] text-slate-400">link the mobile app asset this assessment covers</span>
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

            {platforms.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-slate-400" />
                  <h4 className="text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Platform</h4>
                </div>
                <div className="flex items-center gap-1.5">
                  {platforms.map((p) => (
                    <button key={p} onClick={() => setPlatform(p)} style={activePlatform === p ? PRIMARY : undefined} className={`rounded-lg border px-3.5 py-1.5 text-[12.5px] font-semibold transition ${activePlatform === p ? 'border-transparent' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{p}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Overall KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Compliance{activePlatform ? ` · ${activePlatform}` : ''}</div>
              <div className="text-[26px] font-bold tabular-nums" style={{ color: scoreColor(overall.pct) }}>{overall.pct}%</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${overall.pct}%`, backgroundColor: scoreColor(overall.pct) }} /></div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">MASVS level achieved</div>
              <div className="text-[26px] font-bold tabular-nums text-slate-900">{overall.achieved ? `MASVS-${overall.achieved}` : '—'}</div>
              <div className="mt-1 flex gap-1">
                {(['L1', 'L2', 'R'] as const).map((L) => (
                  <span key={L} className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: levels[L].total > 0 && levels[L].valid === levels[L].total ? '#ecfdf5' : LEVEL_STYLE[L].bg, color: levels[L].total > 0 && levels[L].valid === levels[L].total ? '#059669' : LEVEL_STYLE[L].color }}>
                    {L} {levels[L].valid}/{levels[L].total}
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

          {/* Category compliance */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Compliance by category</h4>
            <div className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
              {cats.map((c) => (
                <button key={c.name} onClick={() => setOpenCat(c.name)} className="group flex items-center gap-3 text-left">
                  <span className="w-48 shrink-0 truncate text-[12.5px] font-medium text-slate-700 group-hover:text-slate-900">{c.name}</span>
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
              {(['all', 'L1', 'L2', 'R'] as const).map((L) => (
                <button key={L} onClick={() => setLevelFilter(L)} style={levelFilter === L ? PRIMARY : undefined} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${levelFilter === L ? 'border-transparent' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{L === 'all' ? 'All' : L}</button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {cats.map((c) => {
              const rows = c.items.filter((it) => {
                const m = meta(it.remarks);
                if (levelFilter !== 'all' && !m.levels.includes(levelFilter)) return false;
                if (term && !(`${it.item_number} ${it.control_description} ${m.mstg}`.toLowerCase().includes(term))) return false;
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
                        return (
                          <div key={it.id}>
                            <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                              <div className="flex w-28 shrink-0 flex-col gap-1">
                                <span className="font-mono text-[12px] font-semibold text-slate-500">{it.item_number}</span>
                                <div className="flex flex-wrap gap-1">
                                  {m.levels.map((L) => (
                                    <span key={L} className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: LEVEL_STYLE[L]?.bg ?? '#f1f5f9', color: LEVEL_STYLE[L]?.color ?? '#64748b' }}>{L}</span>
                                  ))}
                                </div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] leading-snug text-slate-800">{it.control_description}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-slate-400">
                                  {m.mstg && <span className="inline-flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 font-mono font-semibold text-slate-500"><ShieldCheck className="h-2.5 w-2.5" />{m.mstg}</span>}
                                  {it.subdomain_name && <span className="font-medium text-slate-500">{it.subdomain_name}</span>}
                                  {m.testing && <span className="truncate">Test: {m.testing}</span>}
                                </div>
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
