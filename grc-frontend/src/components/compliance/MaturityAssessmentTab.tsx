'use client';

// Shared dashboard for the cyber-maturity tools (CSIR, CTI, IT Security
// Operations, Incident Management, Digital Operations). Each rates a hierarchy of questions /
// capabilities on a 1-5 CMMI maturity scale, grouped by domain (Phase / Stage /
// Security Function) and sub-heading. This page shows the overall maturity, the
// gap to target (where a target is defined), per-domain maturity bars, and every
// question with an inline 1-5 maturity selector + evidence. One component serves
// all four formats via the `format` prop. Data comes from the shared
// /compliance/assessments endpoints.

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Gauge, Loader2, Upload, ChevronRight, Search, Paperclip, FileText, Trash2, Target,
} from 'lucide-react';
import apiClient from '@/lib/api';

const PRIMARY: React.CSSProperties = { background: 'var(--color-base, #14b8a6)', color: '#fff' };

const META: Record<string, { title: string; subtitle: string }> = {
  csir_maturity: { title: 'CSIR Maturity', subtitle: 'Cyber Security Incident Response — High-level Maturity' },
  cti_maturity: { title: 'CTI Maturity', subtitle: 'Cyber Threat Intelligence — Maturity Assessment' },
  itsecops_maturity: { title: 'IT Security Operations Maturity', subtitle: 'Security Operations current vs target state (CMMI)' },
  incident_maturity: { title: 'Incident Management Maturity', subtitle: 'Cyber Security Incident Response — Detailed Maturity' },
  digital_ops_maturity: { title: 'Digital Operations Maturity', subtitle: 'Digital Operations current vs target state (CMMI)' },
};

// CMMI-style 1-5 maturity scale (CREST tools). Same scale for every question,
// so it is shown once as a legend and referenced on each score button.
const LEVELS = [
  { n: 1, label: 'Initial', desc: 'Ad-hoc and undocumented. Processes are reactive and unpredictable.' },
  { n: 2, label: 'Established', desc: 'Basic processes are defined, documented and repeatable.' },
  { n: 3, label: 'Business Enabling', desc: 'Processes are standardised and proactive across the organisation.' },
  { n: 4, label: 'Quantitatively Managed', desc: 'Processes are measured and controlled using metrics.' },
  { n: 5, label: 'Optimised', desc: 'Continuous improvement; processes are optimised and adaptive.' },
];
const levelColor = (n: number) => (n >= 5 ? '#059669' : n === 4 ? '#0d9488' : n === 3 ? '#0891b2' : n === 2 ? '#d97706' : '#dc2626');

interface Item {
  id: number;
  item_number: string;
  area_domain: string | null;
  subdomain_name: string | null;
  control_description: string | null;
  compliance_status: string;
  remarks: string | null;
  maturity_score: number | null;
  evidence_count?: number;
}
interface Detail { id: number; name: string; source: string | null; file_name: string | null; items: Item[]; }

function meta(remarks: string | null) {
  const r = remarks || '';
  const weight = /Weighting:\s*([^|]+)/i.exec(r)?.[1]?.trim() || '';
  const target = /Target:\s*([0-9]+)/i.exec(r)?.[1]?.trim() || '';
  const dim = /Dimension:\s*([^|]+)/i.exec(r)?.[1]?.trim() || '';
  return { weight, target: target ? Number(target) : null, dim };
}

const scoreColor = (v: number) => (v >= 4 ? '#059669' : v >= 3 ? '#0d9488' : v >= 2 ? '#d97706' : '#dc2626');

function EvidencePanel({ assessmentId, itemId }: { assessmentId: number; itemId: number }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data: ev = [], isLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: ['maturity-ev', itemId],
    queryFn: async () => {
      const r = await apiClient.get(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence`);
      return (r.data?.evidence || r.data || []) as Record<string, unknown>[];
    },
  });
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      await apiClient.post(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      qc.invalidateQueries({ queryKey: ['maturity-ev', itemId] });
      qc.invalidateQueries({ queryKey: ['maturity-detail', assessmentId] });
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
      {isLoading ? <div className="py-1 text-[12px] text-slate-400">Loading…</div>
        : list.length === 0 ? <div className="py-1 text-[12px] text-slate-400">No evidence yet.</div>
        : <ul className="space-y-1">{list.map((e, i) => {
            const name = (e.evidence_name || (e.evidence as Record<string, unknown>)?.name || e.file_name || `Evidence ${i + 1}`) as string;
            return <li key={(e.id as number) ?? i} className="flex items-center gap-2 text-[12px] text-slate-700"><FileText className="h-3.5 w-3.5 text-slate-400" /> <span className="truncate">{name}</span></li>;
          })}</ul>}
    </div>
  );
}

export default function MaturityAssessmentTab({ format }: { format: string }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [openDom, setOpenDom] = useState<string | null>(null);
  const [evOpen, setEvOpen] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const m = META[format] || { title: 'Cyber Maturity', subtitle: 'Maturity assessment' };

  const { data: list = [], isLoading: listLoading } = useQuery<{ id: number }[]>({
    queryKey: ['maturity-assessments', format],
    queryFn: async () => (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: format } })).data?.assessments || [],
    staleTime: 30_000,
  });
  const activeId = list[0]?.id ?? null;

  const { data: detail, isLoading: detailLoading } = useQuery<Detail>({
    queryKey: ['maturity-detail', activeId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${activeId}`)).data,
    enabled: !!activeId,
    staleTime: 30_000,
  });

  const setScore = useMutation({
    mutationFn: async ({ itemId, score }: { itemId: number; score: number }) =>
      apiClient.put(`/compliance/assessments/items/${itemId}`, null, { params: { maturity_score: score, compliance_status: score >= 1 ? 'complied' : 'in_progress' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maturity-detail', activeId] }),
  });

  const deleteAssessment = useMutation({
    mutationFn: async () => apiClient.delete(`/compliance/assessments/${activeId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['maturity-assessments', format] }); qc.invalidateQueries({ queryKey: ['maturity-detail', activeId] }); },
  });
  const onDelete = () => {
    if (!activeId) return;
    if (!confirm(`Delete "${detail?.name || m.title}" and all ${detail?.items?.length ?? 0} questions (evidence included)? This cannot be undone.`)) return;
    deleteAssessment.mutate();
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      if (activeId) await apiClient.post(`/compliance/assessments/${activeId}/reupload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      else { fd.append('name', m.title); fd.append('assessment_type', 'cybersecurity'); fd.append('expected_format', format); await apiClient.post('/compliance/assessments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
      qc.invalidateQueries({ queryKey: ['maturity-assessments', format] });
      qc.invalidateQueries({ queryKey: ['maturity-detail', activeId] });
    } catch (err) {
      const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(d || `Upload failed. Make sure it is the ${m.title} workbook.`);
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const { doms, overall, hasTarget } = useMemo(() => {
    const items = detail?.items || [];
    const byDom = new Map<string, Item[]>();
    for (const it of items) {
      const k = it.area_domain || 'General';
      if (!byDom.has(k)) byDom.set(k, []);
      byDom.get(k)!.push(it);
    }
    let hasTarget = false;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const doms = [...byDom.entries()].map(([name, its]) => {
      const scored = its.map((i) => i.maturity_score).filter((s): s is number => typeof s === 'number' && s >= 1);
      const targets = its.map((i) => meta(i.remarks).target).filter((t): t is number => typeof t === 'number');
      if (targets.length) hasTarget = true;
      return { name, items: its, answered: scored.length, total: its.length, avg: avg(scored), target: avg(targets) };
    });
    const allScored = items.map((i) => i.maturity_score).filter((s): s is number => typeof s === 'number' && s >= 1);
    const allTargets = items.map((i) => meta(i.remarks).target).filter((t): t is number => typeof t === 'number');
    return {
      doms,
      overall: { avg: avg(allScored), target: avg(allTargets), answered: allScored.length, total: items.length, domains: doms.length },
      hasTarget,
    };
  }, [detail]);

  if (listLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;
  const term = search.trim().toLowerCase();
  const answeredPct = overall.total ? Math.round((overall.answered / overall.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={PRIMARY}><Gauge className="h-6 w-6 text-white" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-gray-900">{m.title}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Maturity Assessment · 1–5 CMMI</span>
            </div>
            <p className="text-[11px] text-gray-500">{detail?.source || m.subtitle}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden" onChange={onUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploading ? 'Uploading…' : activeId ? 'Re-upload Excel' : 'Upload Excel'}
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
          <Gauge className="mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No {m.title} uploaded yet.</p>
          <p className="mt-1 max-w-md text-xs text-slate-400">Upload the maturity assessment workbook — every domain, question and maturity level is parsed into this dashboard.</p>
        </div>
      ) : detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Overall maturity</div>
              <div className="text-[26px] font-bold tabular-nums" style={{ color: scoreColor(overall.avg) }}>{overall.avg.toFixed(1)}<span className="text-[14px] text-slate-300"> / 5</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${(overall.avg / 5) * 100}%`, backgroundColor: scoreColor(overall.avg) }} /></div>
            </div>
            {hasTarget ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Target · gap</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[22px] font-bold tabular-nums text-slate-700">{overall.target.toFixed(1)}</span>
                  <span className="text-[13px] font-semibold" style={{ color: overall.target - overall.avg > 0.05 ? '#dc2626' : '#059669' }}>{overall.target - overall.avg > 0 ? '−' : '+'}{Math.abs(overall.target - overall.avg).toFixed(1)}</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">avg target vs current</div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Answered</div>
                <div className="text-[26px] font-bold tabular-nums text-slate-900">{answeredPct}%</div>
                <div className="mt-1 text-[11px] text-slate-400">{overall.answered} of {overall.total}</div>
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Questions</div>
              <div className="text-[26px] font-bold tabular-nums text-slate-900">{overall.total}</div>
              <div className="mt-1 text-[11px] text-slate-400">{overall.answered} answered · {overall.domains} domains</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Maturity band</div>
              <div className="text-[16px] font-bold text-slate-900">{overall.avg >= 1 ? `L${Math.round(overall.avg)} · ${LEVELS[Math.min(4, Math.max(0, Math.round(overall.avg) - 1))].label}` : '—'}</div>
              <div className="mt-1 text-[11px] text-slate-400">rounded overall level</div>
            </div>
          </div>

          {/* Maturity scale legend — what each 1–5 level means */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Maturity scale · what the 1–5 levels mean</h4>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {LEVELS.map((L) => (
                <div key={L.n} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md text-[12px] font-bold text-white" style={{ background: levelColor(L.n) }}>{L.n}</span>
                    <span className="text-[12px] font-bold" style={{ color: levelColor(L.n) }}>{L.label}</span>
                  </div>
                  <p className="mt-1 text-[10.5px] leading-snug text-slate-500">{L.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Domain maturity bars */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Maturity by domain</h4>
            <div className="space-y-2.5">
              {doms.map((d) => (
                <button key={d.name} onClick={() => setOpenDom(d.name)} className="group flex w-full items-center gap-3 text-left">
                  <span className="w-56 shrink-0 truncate text-[12.5px] font-medium text-slate-700 group-hover:text-slate-900">{d.name}</span>
                  <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${(d.avg / 5) * 100}%`, backgroundColor: scoreColor(d.avg) }} />
                    {d.target > 0 && <div className="absolute top-[-2px] h-[14px] w-[2px] bg-slate-800" style={{ left: `${(d.target / 5) * 100}%` }} title={`Target ${d.target.toFixed(1)}`} />}
                  </div>
                  <span className="w-10 shrink-0 text-right text-[12px] font-bold tabular-nums" style={{ color: scoreColor(d.avg) }}>{d.avg.toFixed(1)}</span>
                  <span className="w-14 shrink-0 text-right text-[11px] text-slate-400">{d.answered}/{d.total}</span>
                </button>
              ))}
            </div>
            {hasTarget && <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-slate-400"><span className="inline-block h-[10px] w-[2px] bg-slate-800" /> target maturity marker</div>}
          </div>

          <div className="flex h-9 w-[280px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions…" className="w-full border-0 bg-transparent text-[13px] outline-none" />
          </div>

          {/* Questions grouped by domain */}
          <div className="space-y-2.5">
            {doms.map((d) => {
              const rows = d.items.filter((it) => !term || `${it.item_number} ${it.control_description}`.toLowerCase().includes(term));
              if (rows.length === 0) return null;
              const open = openDom === d.name || term !== '';
              return (
                <div key={d.name} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <button onClick={() => setOpenDom(open && openDom === d.name ? null : d.name)} className="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span className="flex-1 text-left text-[14px] font-bold text-slate-800">{d.name}</span>
                    <span className="text-[11px] text-slate-400">{rows.length} questions</span>
                    <span className="w-10 text-right text-[12px] font-bold tabular-nums" style={{ color: scoreColor(d.avg) }}>{d.avg.toFixed(1)}</span>
                  </button>
                  {open && (
                    <div className="divide-y divide-slate-100 border-t border-slate-100">
                      {rows.map((it) => {
                        const mm = meta(it.remarks);
                        const evActive = evOpen === it.id;
                        const evc = it.evidence_count ?? 0;
                        const cur = it.maturity_score ?? 0;
                        return (
                          <div key={it.id}>
                            <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                              <div className="w-20 shrink-0"><span className="font-mono text-[11.5px] font-semibold text-slate-500">{it.item_number}</span></div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] leading-snug text-slate-800">{it.control_description}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-slate-400">
                                  {it.subdomain_name && <span className="font-medium text-slate-500">{it.subdomain_name}</span>}
                                  {mm.dim && <span className="rounded bg-slate-50 px-1.5 py-0.5 font-medium text-slate-500">{mm.dim}</span>}
                                  {mm.weight && <span>Weight {mm.weight}</span>}
                                  {mm.target != null && <span className="inline-flex items-center gap-0.5"><Target className="h-2.5 w-2.5" />target L{mm.target}</span>}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <div className="flex items-center gap-1">
                                  <button onClick={() => setEvOpen(evActive ? null : it.id)} title="Evidence"
                                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition"
                                    style={evActive || evc > 0 ? { borderColor: '#0f766e', color: '#0f766e', backgroundColor: '#e7faf5' } : { borderColor: '#e2e8f0', color: '#64748b' }}>
                                    <Paperclip className="h-3 w-3" /> {evc > 0 ? evc : 'Ev'}
                                  </button>
                                  {LEVELS.map((L) => {
                                    const on = cur === L.n;
                                    const isTarget = mm.target === L.n;
                                    return (
                                      <button key={L.n} title={`L${L.n} · ${L.label} — ${L.desc}`} disabled={setScore.isPending}
                                        onClick={() => setScore.mutate({ itemId: it.id, score: on ? 0 : L.n })}
                                        className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border text-[12px] font-bold transition"
                                        style={on ? { backgroundColor: levelColor(L.n), color: '#fff', borderColor: levelColor(L.n) } : isTarget ? { borderColor: '#0f172a', color: '#475569', borderStyle: 'dashed' } : { borderColor: '#e2e8f0', color: '#94a3b8' }}>
                                        {L.n}
                                        {isTarget && !on && <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] text-slate-800">▼</span>}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="text-[10.5px] leading-tight">
                                  {cur >= 1
                                    ? <span className="font-semibold" style={{ color: levelColor(cur) }}>L{cur} · {LEVELS[cur - 1].label}</span>
                                    : <span className="text-slate-400">Not assessed</span>}
                                  {mm.target != null && (
                                    <span className="text-slate-400"> · target L{mm.target}
                                      {cur >= 1 && mm.target > cur ? <span className="font-semibold text-rose-500"> · gap {mm.target - cur}</span>
                                        : cur >= 1 && cur >= mm.target ? <span className="font-semibold text-emerald-600"> · met</span> : null}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            {evActive && <EvidencePanel assessmentId={activeId!} itemId={it.id} />}
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
