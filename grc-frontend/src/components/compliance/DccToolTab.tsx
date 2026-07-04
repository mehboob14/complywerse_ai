'use client';

// NCA DCC-1:2022 — Data Cybersecurity Controls Assessment & Compliance Tool
// (bilingual Arabic/English). Hierarchical controls (domain → subdomain →
// control), each an Essential or Sub control with a bilingual requirement and a
// 5-state compliance status (Implemented / Partially / Not Implemented / Not
// Applicable / Not assessed). This dashboard shows the compliance %, an
// essential/sub split, per-domain progress and the controls with inline status
// editing + evidence. Data comes from the shared /compliance/assessments
// endpoints (format = nca_dcc_tool).

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Loader2, Upload, Trash2, ChevronRight, Search, CheckCircle2, XCircle, MinusCircle, Clock, CircleDashed, Paperclip, FileText } from 'lucide-react';
import apiClient from '@/lib/api';

const DCC_FORMAT = 'nca_dcc_tool';
const PRIMARY: React.CSSProperties = { background: 'var(--color-base, #14b8a6)', color: '#fff' };

interface Item { id: number; item_number: string; area_domain: string | null; subdomain_name: string | null; control_description: string | null; compliance_status: string; priority: string | null; remarks: string | null; evidence_count?: number; }
interface Detail { id: number; name: string; source: string | null; items: Item[]; }

const STATUS = {
  complied: { label: 'Implemented', color: '#059669', bg: '#ecfdf5', Icon: CheckCircle2 },
  partially_complied: { label: 'Partially', color: '#d97706', bg: '#fffbeb', Icon: MinusCircle },
  not_complied: { label: 'Not implemented', color: '#dc2626', bg: '#fef2f2', Icon: XCircle },
  na: { label: 'N/A', color: '#64748b', bg: '#f1f5f9', Icon: MinusCircle },
  in_progress: { label: 'Not assessed', color: '#94a3b8', bg: '#f8fafc', Icon: CircleDashed },
} as const;
type StatusKey = keyof typeof STATUS;
const order: StatusKey[] = ['complied', 'partially_complied', 'not_complied', 'na', 'in_progress'];

function EvidencePanel({ assessmentId, itemId, onUploaded }: { assessmentId: number; itemId: number; onUploaded: () => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data: ev = [], isLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: ['dcc-ev', itemId],
    queryFn: async () => { const r = await apiClient.get(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence`); return (r.data?.evidence || r.data || []) as Record<string, unknown>[]; },
  });
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return; setUploading(true);
    try { const fd = new FormData(); fd.append('file', f); fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      await apiClient.post(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      qc.invalidateQueries({ queryKey: ['dcc-ev', itemId] }); qc.invalidateQueries({ queryKey: ['dcc-detail', assessmentId] }); onUploaded();
    } catch { alert('Evidence upload failed.'); } finally { setUploading(false); if (ref.current) ref.current.value = ''; }
  };
  const list = Array.isArray(ev) ? ev : [];
  return (
    <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Evidence</span>
        <input ref={ref} type="file" className="hidden" onChange={onFile} />
        <button onClick={() => ref.current?.click()} disabled={uploading} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold hover:opacity-90 disabled:opacity-60">{uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload evidence</button>
      </div>
      {isLoading ? <div className="py-1 text-[12px] text-slate-400">Loading…</div> : list.length === 0 ? <div className="py-1 text-[12px] text-slate-400">No evidence yet.</div>
        : <ul className="space-y-1">{list.map((e, i) => { const name = (e.evidence_name || e.file_name || `Evidence ${i + 1}`) as string; return <li key={(e.id as number) ?? i} className="flex items-center gap-2 text-[12px] text-slate-700"><FileText className="h-3.5 w-3.5 text-slate-400" /> <span className="truncate">{name}</span></li>; })}</ul>}
    </div>
  );
}

export default function DccToolTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [openDom, setOpenDom] = useState<string | null>(null);
  const [evOpen, setEvOpen] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'high' | 'medium'>('all');

  const { data: list = [], isLoading: listLoading } = useQuery<{ id: number }[]>({
    queryKey: ['dcc-assessments'],
    queryFn: async () => (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: DCC_FORMAT } })).data?.assessments || [],
    staleTime: 30_000,
  });
  const activeId = list[0]?.id ?? null;
  const { data: detail, isLoading: detailLoading } = useQuery<Detail>({
    queryKey: ['dcc-detail', activeId], queryFn: async () => (await apiClient.get(`/compliance/assessments/${activeId}`)).data, enabled: !!activeId, staleTime: 30_000,
  });

  const setStatus = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) => apiClient.put(`/compliance/assessments/items/${itemId}`, null, { params: { compliance_status: status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dcc-detail', activeId] }),
  });
  const deleteAssessment = useMutation({
    mutationFn: async () => apiClient.delete(`/compliance/assessments/${activeId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dcc-assessments'] }); qc.invalidateQueries({ queryKey: ['dcc-detail', activeId] }); },
  });
  const onDelete = () => { if (!activeId) return; if (!confirm(`Delete "${detail?.name || 'NCA DCC'}" and all ${detail?.items?.length ?? 0} controls? This cannot be undone.`)) return; deleteAssessment.mutate(); };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; setUploading(true);
    try { const fd = new FormData(); fd.append('file', file);
      if (activeId) await apiClient.post(`/compliance/assessments/${activeId}/reupload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      else { fd.append('name', 'NCA DCC-1:2022 Assessment'); fd.append('assessment_type', 'gap_assessment'); fd.append('expected_format', DCC_FORMAT); await apiClient.post('/compliance/assessments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
      qc.invalidateQueries({ queryKey: ['dcc-assessments'] }); qc.invalidateQueries({ queryKey: ['dcc-detail', activeId] });
    } catch (err) { const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail; alert(d || 'Upload failed. Make sure it is the NCA DCC-1:2022 Assessment & Compliance Tool workbook.'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const { doms, overall } = useMemo(() => {
    const items = detail?.items || [];
    const byDom = new Map<string, Item[]>();
    for (const it of items) { const k = it.area_domain || 'DCC'; if (!byDom.has(k)) byDom.set(k, []); byDom.get(k)!.push(it); }
    const doms = [...byDom.entries()].map(([name, its]) => {
      const na = its.filter((i) => i.compliance_status === 'na').length;
      const impl = its.filter((i) => i.compliance_status === 'complied').length;
      const part = its.filter((i) => i.compliance_status === 'partially_complied').length;
      const denom = Math.max(1, its.length - na);
      return { name, items: its, total: its.length, impl, pct: Math.round(((impl + part * 0.5) / denom) * 100) };
    });
    const na = items.filter((i) => i.compliance_status === 'na').length;
    const impl = items.filter((i) => i.compliance_status === 'complied').length;
    const part = items.filter((i) => i.compliance_status === 'partially_complied').length;
    const assessed = items.filter((i) => i.compliance_status !== 'in_progress').length;
    const essential = items.filter((i) => i.priority === 'high').length;
    const pct = Math.round(((impl + part * 0.5) / Math.max(1, items.length - na)) * 100);
    return { doms, overall: { total: items.length, impl, assessed, essential, sub: items.length - essential, pct } };
  }, [detail]);

  if (listLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;
  const term = search.trim().toLowerCase();
  const col = (p: number) => (p >= 80 ? '#059669' : p >= 50 ? '#d97706' : '#dc2626');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={PRIMARY}><ShieldCheck className="h-6 w-6 text-white" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-gray-900">NCA DCC-1:2022</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Data Cybersecurity Controls · Assessment &amp; Compliance</span>
            </div>
            <p className="text-[11px] text-gray-500">{detail?.source || 'Saudi NCA · bilingual controls compliance'}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60">{uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploading ? 'Uploading…' : activeId ? 'Re-upload DCC Excel' : 'Upload DCC Excel'}</button>
          {activeId && <button onClick={onDelete} disabled={deleteAssessment.isPending} title="Delete this assessment" className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">{deleteAssessment.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete</button>}
        </div>
      </div>

      {!activeId ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-20 text-center">
          <ShieldCheck className="mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No NCA DCC-1:2022 assessment uploaded yet.</p>
          <p className="mt-1 max-w-md text-xs text-slate-400">Upload the DCC Assessment &amp; Compliance Tool workbook — every bilingual control, its domain, subdomain and type is parsed into this dashboard.</p>
        </div>
      ) : detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Compliance</div>
              <div className="text-[26px] font-bold tabular-nums" style={{ color: col(overall.pct) }}>{overall.pct}%</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${overall.pct}%`, backgroundColor: col(overall.pct) }} /></div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Controls</div><div className="text-[26px] font-bold tabular-nums text-slate-900">{overall.total}</div><div className="mt-1 text-[11px] text-slate-400">{overall.assessed} assessed · {doms.length} domains</div></div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Essential / Sub</div><div className="flex items-baseline gap-2"><span className="text-[22px] font-bold tabular-nums text-slate-900">{overall.essential}</span><span className="text-slate-300">/</span><span className="text-[22px] font-bold tabular-nums text-slate-500">{overall.sub}</span></div></div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Implemented</div><div className="text-[26px] font-bold tabular-nums text-emerald-600">{overall.impl}</div></div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Compliance by domain</h4>
            <div className="space-y-2.5">
              {doms.map((d) => (
                <button key={d.name} onClick={() => setOpenDom(d.name)} className="group flex w-full items-center gap-3 text-left">
                  <span dir="auto" className="w-72 shrink-0 truncate text-[12.5px] font-medium text-slate-700 group-hover:text-slate-900">{d.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${d.pct}%`, backgroundColor: col(d.pct) }} /></div>
                  <span className="w-10 shrink-0 text-right text-[12px] font-bold tabular-nums" style={{ color: col(d.pct) }}>{d.pct}%</span>
                  <span className="w-12 shrink-0 text-right text-[11px] text-slate-400">{d.impl}/{d.total}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-[260px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search controls…" className="w-full border-0 bg-transparent text-[13px] outline-none" /></div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Type</span>
              {([['all', 'All'], ['high', 'Essential'], ['medium', 'Sub']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setTypeFilter(v)} style={typeFilter === v ? PRIMARY : undefined} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${typeFilter === v ? 'border-transparent' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {doms.map((d) => {
              const rows = d.items.filter((it) => { if (typeFilter !== 'all' && it.priority !== typeFilter) return false; if (term && !(`${it.item_number} ${it.control_description}`.toLowerCase().includes(term))) return false; return true; });
              if (rows.length === 0) return null;
              const open = openDom === d.name || term !== '' || typeFilter !== 'all';
              return (
                <div key={d.name} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <button onClick={() => setOpenDom(open && openDom === d.name ? null : d.name)} className="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span dir="auto" className="flex-1 text-left text-[14px] font-bold text-slate-800">{d.name}</span>
                    <span className="text-[11px] text-slate-400">{rows.length} controls</span>
                    <span className="w-10 text-right text-[12px] font-bold tabular-nums" style={{ color: col(d.pct) }}>{d.pct}%</span>
                  </button>
                  {open && (
                    <div className="divide-y divide-slate-100 border-t border-slate-100">
                      {rows.map((it) => {
                        const evActive = evOpen === it.id; const evc = it.evidence_count ?? 0;
                        return (
                          <div key={it.id}>
                            <div className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-start">
                              <div className="flex w-24 shrink-0 flex-col gap-1">
                                <span className="font-mono text-[12px] font-semibold text-slate-500">{it.item_number}</span>
                                {it.priority && <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={it.priority === 'high' ? { background: '#eef2ff', color: '#4338ca' } : { background: '#f1f5f9', color: '#64748b' }}>{it.priority === 'high' ? 'Essential' : 'Sub'}</span>}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p dir="auto" className="text-[13px] leading-relaxed text-slate-800">{it.control_description}</p>
                                {it.subdomain_name && <p dir="auto" className="mt-0.5 text-[10.5px] font-medium text-slate-400">{it.subdomain_name}</p>}
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center gap-1">
                                <button onClick={() => setEvOpen(evActive ? null : it.id)} title="Evidence" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition" style={evActive || evc > 0 ? { borderColor: '#0f766e', color: '#0f766e', backgroundColor: '#e7faf5' } : { borderColor: '#e2e8f0', color: '#64748b' }}><Paperclip className="h-3 w-3" /> {evc > 0 ? evc : 'Ev'}</button>
                                {order.map((s) => { const sm = STATUS[s]; const on = it.compliance_status === s; return (
                                  <button key={s} title={sm.label} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ itemId: it.id, status: s })} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition" style={on ? { backgroundColor: sm.bg, color: sm.color, borderColor: sm.color } : { borderColor: '#e2e8f0', color: '#94a3b8' }}><sm.Icon className="h-3 w-3" /> {sm.label}</button>
                                ); })}
                              </div>
                            </div>
                            {evActive && <EvidencePanel assessmentId={activeId!} itemId={it.id} onUploaded={() => setStatus.mutate({ itemId: it.id, status: 'complied' })} />}
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
