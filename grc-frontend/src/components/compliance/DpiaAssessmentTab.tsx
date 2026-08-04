'use client';

// DPIA / PIA — Data Protection / Privacy Impact Assessment. A risk-assessment
// workbook rather than a checklist: a Screening section (threshold Yes/No), an
// Assessment narrative, and a Risk Register where each risk is scored
// Likelihood × Impact with an inherent and a residual rating. This dashboard
// shows the screening verdict, risk KPIs, a 5×5 Likelihood×Impact heat-map
// (inherent vs residual), and the risk register. Risk band: score = L×I →
// 1-4 Low, 5-9 Medium, 10-14 High, 15-25 Critical.

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Loader2, Upload, Trash2, CheckCircle2, XCircle, ChevronRight, AlertTriangle } from 'lucide-react';
import apiClient from '@/lib/api';

const DPIA_FORMAT = 'dpia_pia';
const PRIMARY: React.CSSProperties = { background: 'var(--color-base, #14b8a6)', color: '#fff' };

interface Item { id: number; item_number: string; area_domain: string | null; subdomain_name: string | null; control_description: string | null; compliance_status: string; remarks: string | null; }
interface Detail { id: number; name: string; source: string | null; items: Item[]; }

const section = (r: string | null) => /Section:\s*(\w+)/i.exec(r || '')?.[1]?.toLowerCase() || '';
const field = (r: string | null, k: string) => new RegExp(`${k}:\\s*([^|]+)`, 'i').exec(r || '')?.[1]?.trim() || '';

function band(score: number) {
  if (score >= 15) return { label: 'Critical', color: '#dc2626', bg: '#fef2f2' };
  if (score >= 10) return { label: 'High', color: '#ea580c', bg: '#fff7ed' };
  if (score >= 5) return { label: 'Medium', color: '#d97706', bg: '#fffbeb' };
  if (score >= 1) return { label: 'Low', color: '#059669', bg: '#ecfdf5' };
  return { label: '—', color: '#94a3b8', bg: '#f8fafc' };
}

interface Risk { id: string; category: string; desc: string; subjects: string; l: number; i: number; score: number; rating: string; resL: number; resI: number; resScore: number; resRating: string; owner: string; framework: string; status: string; target: string; controls: string; }
function toRisk(it: Item): Risk {
  const r = it.remarks;
  const n = (k: string) => { const v = parseInt(field(r, k), 10); return isNaN(v) ? 0 : v; };
  const l = n('L'), i = n('I'), resL = n('ResL'), resI = n('ResI');
  return {
    id: it.item_number, category: it.area_domain || 'Uncategorised', desc: it.control_description || '', subjects: field(r, 'Subjects'),
    l, i, score: Number(field(r, 'Inherent')) || l * i, rating: field(r, 'InherentRating'),
    resL, resI, resScore: Number(field(r, 'Residual')) || resL * resI, resRating: field(r, 'ResidualRating'),
    owner: field(r, 'Owner'), framework: field(r, 'Framework'), status: field(r, 'Status'), target: field(r, 'Target'), controls: field(r, 'Controls'),
  };
}

// 5×5 Likelihood (rows, 5 top → 1 bottom) × Impact (cols, 1 → 5) heat-map.
function Heatmap({ risks, mode }: { risks: Risk[]; mode: 'inherent' | 'residual' }) {
  const cell = (L: number, I: number) => risks.filter((r) => (mode === 'inherent' ? r.l === L && r.i === I : r.resL === L && r.resI === I));
  return (
    <div className="inline-block">
      <div className="flex">
        <div className="flex flex-col justify-between pr-1 text-[9px] font-semibold text-slate-400" style={{ height: 140 }}>
          {[5, 4, 3, 2, 1].map((L) => <span key={L} className="flex h-7 items-center">{L}</span>)}
        </div>
        <div>
          <div className="grid grid-cols-5 gap-0.5">
            {[5, 4, 3, 2, 1].map((L) => [1, 2, 3, 4, 5].map((I) => {
              const b = band(L * I); const here = cell(L, I);
              return (
                <div key={`${L}-${I}`} className="flex h-7 w-9 items-center justify-center rounded text-[11px] font-bold" style={{ background: b.bg, color: b.color, border: `1px solid ${b.color}22` }}>
                  {here.length > 0 ? <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: b.color }} title={here.map((r) => r.id).join(', ')}>{here.length}</span> : ''}
                </div>
              );
            }))}
          </div>
          <div className="mt-0.5 grid grid-cols-5 gap-0.5 text-center text-[9px] font-semibold text-slate-400">
            {[1, 2, 3, 4, 5].map((I) => <span key={I}>{I}</span>)}
          </div>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[9px] text-slate-400"><span>← Likelihood</span><span>Impact →</span></div>
    </div>
  );
}

export default function DpiaAssessmentTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<'inherent' | 'residual'>('inherent');
  const [showAssess, setShowAssess] = useState(false);

  const { data: list = [], isLoading: listLoading } = useQuery<{ id: number }[]>({
    queryKey: ['dpia-assessments'],
    queryFn: async () => (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: DPIA_FORMAT } })).data?.assessments || [],
    staleTime: 30_000,
  });
  const activeId = list[0]?.id ?? null;
  const { data: detail, isLoading: detailLoading } = useQuery<Detail>({
    queryKey: ['dpia-detail', activeId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${activeId}`)).data,
    enabled: !!activeId, staleTime: 30_000,
  });

  const deleteAssessment = useMutation({
    mutationFn: async () => apiClient.delete(`/compliance/assessments/${activeId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dpia-assessments'] }); qc.invalidateQueries({ queryKey: ['dpia-detail', activeId] }); },
  });
  const onDelete = () => {
    if (!activeId) return;
    if (!confirm(`Delete "${detail?.name || 'DPIA / PIA'}" and all its screening, risks and fields? This cannot be undone.`)) return;
    deleteAssessment.mutate();
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      if (activeId) await apiClient.post(`/compliance/assessments/${activeId}/reupload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      else { fd.append('name', 'DPIA / PIA Assessment'); fd.append('assessment_type', 'privacy'); fd.append('expected_format', DPIA_FORMAT); await apiClient.post('/compliance/assessments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
      qc.invalidateQueries({ queryKey: ['dpia-assessments'] }); qc.invalidateQueries({ queryKey: ['dpia-detail', activeId] });
    } catch (err) {
      const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(d || 'Upload failed. Make sure it is the DPIA / PIA assessment workbook.');
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  // In-app editing: persist a change to one item's remarks (screening answer,
  // risk rating, …) via the existing item-update endpoint, then refetch so the
  // verdict / heat-map / score recompute. The Excel upload path is unchanged.
  const saveItem = useMutation({
    mutationFn: async ({ itemId, remarks }: { itemId: number; remarks: string }) =>
      apiClient.put(`/compliance/assessments/items/${itemId}`, null, { params: { remarks } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dpia-detail', activeId] }),
  });
  // Set or replace a "Key: value" field inside the pipe-delimited remarks string.
  const withField = (remarks: string | null, key: string, value: string) => {
    const r = remarks || 'Section: screening';
    const re = new RegExp(`${key}:\\s*[^|]*`, 'i');
    return re.test(r) ? r.replace(re, `${key}: ${value} `) : `${r.trim()} | ${key}: ${value}`;
  };
  const setAnswer = (it: Item, value: 'Yes' | 'No') =>
    saveItem.mutate({ itemId: it.id, remarks: withField(it.remarks, 'Answer', value) });

  const { screening, risks, assessFields, kpis, screenVerdict } = useMemo(() => {
    const items = detail?.items || [];
    const screening = items.filter((i) => section(i.remarks) === 'screening');
    const risks = items.filter((i) => section(i.remarks) === 'risk').map(toRisk);
    const assessFields = items.filter((i) => section(i.remarks) === 'assessment');
    const yes = screening.filter((s) => /yes/i.test(field(s.remarks, 'Answer'))).length;
    const answered = screening.filter((s) => field(s.remarks, 'Answer')).length;
    const crit = risks.filter((r) => r.score >= 15).length;
    const high = risks.filter((r) => r.score >= 10 && r.score < 15).length;
    const avgInh = risks.length ? risks.reduce((a, r) => a + r.score, 0) / risks.length : 0;
    const avgRes = risks.length ? risks.reduce((a, r) => a + (r.resScore || r.score), 0) / risks.length : 0;
    return {
      screening, risks, assessFields,
      kpis: { total: risks.length, critHigh: crit + high, crit, high, avgInh, avgRes },
      screenVerdict: { yes, answered, total: screening.length, required: yes > 0 },
    };
  }, [detail]);

  if (listLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={PRIMARY}><ShieldAlert className="h-6 w-6 text-white" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-gray-900">DPIA / PIA</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Data Protection / Privacy Impact Assessment</span>
            </div>
            <p className="text-[11px] text-gray-500">{detail?.source || 'Screening · risk register · sign-off · Risk = Likelihood × Impact'}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploading ? 'Uploading…' : activeId ? 'Re-upload DPIA Excel' : 'Upload DPIA Excel'}
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
          <ShieldAlert className="mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No DPIA / PIA uploaded yet.</p>
          <p className="mt-1 max-w-md text-xs text-slate-400">Upload the DPIA / PIA workbook — the screening questions, risk register (Likelihood × Impact) and assessment fields are parsed into this dashboard.</p>
        </div>
      ) : detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : (
        <>
          {/* Screening verdict */}
          {screening.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h4 className="text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Screening</h4>
                <span className="text-[11px] text-slate-400">one or more “Yes” normally means a full DPIA is required</span>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                  style={screenVerdict.answered === 0 ? { background: '#f1f5f9', color: '#64748b' } : screenVerdict.required ? { background: '#fef2f2', color: '#dc2626' } : { background: '#ecfdf5', color: '#059669' }}>
                  {screenVerdict.answered === 0 ? 'Not screened yet' : screenVerdict.required ? <><AlertTriangle className="h-3.5 w-3.5" /> DPIA required ({screenVerdict.yes} Yes)</> : <><CheckCircle2 className="h-3.5 w-3.5" /> DPIA may not be required</>}
                </span>
              </div>
              <ul className="space-y-1.5">
                {screening.map((s) => {
                  const ans = field(s.remarks, 'Answer');
                  const yes = /yes/i.test(ans);
                  return (
                    <li key={s.id} className="flex items-start gap-2 text-[12.5px] text-slate-700">
                      <span className="mt-0.5">{ans ? (yes ? <XCircle className="h-3.5 w-3.5 text-rose-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />) : <span className="inline-block h-3.5 w-3.5 rounded-full border border-slate-300" />}</span>
                      <span className="flex-1">{s.control_description}</span>
                      <span className="ml-auto flex shrink-0 gap-1">
                        {(['Yes', 'No'] as const).map((v) => {
                          const active = ans.toLowerCase() === v.toLowerCase();
                          const isYes = v === 'Yes';
                          return (
                            <button key={v} onClick={() => setAnswer(s, v)} disabled={saveItem.isPending}
                              className="rounded px-2 py-0.5 text-[10px] font-bold transition-colors hover:opacity-80 disabled:opacity-50"
                              style={active
                                ? (isYes ? { background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' } : { background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' })
                                : { background: '#fff', color: '#94a3b8', border: '1px solid #e2e8f0' }}>
                              {v}
                            </button>
                          );
                        })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Risk KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Risks logged</div>
              <div className="text-[26px] font-bold tabular-nums text-slate-900">{kpis.total}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Critical / High</div>
              <div className="flex items-baseline gap-2"><span className="text-[22px] font-bold tabular-nums text-rose-600">{kpis.crit}</span><span className="text-slate-300">/</span><span className="text-[22px] font-bold tabular-nums text-orange-600">{kpis.high}</span></div>
              <div className="mt-1 text-[11px] text-slate-400">inherent band</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Avg inherent</div>
              <div className="text-[26px] font-bold tabular-nums" style={{ color: band(kpis.avgInh).color }}>{kpis.avgInh.toFixed(1)}</div>
              <div className="mt-1 text-[11px] text-slate-400">score /25 · {band(kpis.avgInh).label}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Avg residual</div>
              <div className="flex items-baseline gap-2">
                <span className="text-[26px] font-bold tabular-nums" style={{ color: band(kpis.avgRes).color }}>{kpis.avgRes.toFixed(1)}</span>
                {kpis.avgInh > kpis.avgRes && <span className="text-[12px] font-semibold text-emerald-600">↓{(kpis.avgInh - kpis.avgRes).toFixed(1)}</span>}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">after controls · {band(kpis.avgRes).label}</div>
            </div>
          </div>

          {/* Heatmap + register */}
          {risks.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)]">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Risk heat-map</h4>
                  <div className="ml-auto flex items-center gap-1">
                    {(['inherent', 'residual'] as const).map((mo) => (
                      <button key={mo} onClick={() => setMode(mo)} style={mode === mo ? PRIMARY : undefined} className={`rounded-md border px-2 py-1 text-[10.5px] font-semibold capitalize ${mode === mo ? 'border-transparent' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{mo}</button>
                    ))}
                  </div>
                </div>
                <Heatmap risks={risks} mode={mode} />
                <div className="mt-2 flex flex-wrap gap-2 text-[9.5px]">
                  {['Low', 'Medium', 'High', 'Critical'].map((b) => { const bb = band(b === 'Low' ? 1 : b === 'Medium' ? 5 : b === 'High' ? 10 : 15); return <span key={b} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded" style={{ background: bb.color }} />{b}</span>; })}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-4 py-2.5 text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Risk register</div>
                <div className="divide-y divide-slate-100">
                  {risks.map((r) => {
                    const ib = band(r.score); const rb = band(r.resScore);
                    return (
                      <div key={r.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11.5px] font-semibold text-slate-500">{r.id}</span>
                          <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{r.category}</span>
                          <span className="ml-auto inline-flex items-center gap-1 text-[11px]">
                            <span className="rounded px-1.5 py-0.5 font-bold" style={{ background: ib.bg, color: ib.color }}>{r.score} {ib.label}</span>
                            {r.resScore > 0 && <><span className="text-slate-300">→</span><span className="rounded px-1.5 py-0.5 font-bold" style={{ background: rb.bg, color: rb.color }}>{r.resScore} {rb.label}</span></>}
                          </span>
                        </div>
                        <p className="mt-1 text-[13px] leading-snug text-slate-800">{r.desc}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-slate-400">
                          {r.subjects && <span>Subjects: {r.subjects}</span>}
                          <span>L{r.l}×I{r.i}{r.resScore > 0 ? ` → L${r.resL}×I${r.resI}` : ''}</span>
                          {r.owner && <span>Owner: {r.owner}</span>}
                          {r.framework && <span className="rounded bg-slate-50 px-1.5 py-0.5 font-medium text-slate-500">{r.framework}</span>}
                          {r.status && <span className="font-medium text-slate-500">{r.status}</span>}
                          {r.target && <span>Target {r.target}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Assessment narrative fields (collapsible) */}
          {assessFields.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <button onClick={() => setShowAssess((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${showAssess ? 'rotate-90' : ''}`} />
                <span className="flex-1 text-left text-[13px] font-bold text-slate-700">Assessment record</span>
                <span className="text-[11px] text-slate-400">{assessFields.length} fields</span>
              </button>
              {showAssess && (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {assessFields.map((a) => (
                    <div key={a.id} className="px-4 py-2">
                      <p className="text-[12.5px] font-semibold text-slate-700">{a.control_description}{a.subdomain_name && <span className="ml-2 text-[10px] font-normal text-slate-400">{a.subdomain_name}</span>}</p>
                      {field(a.remarks, 'Guidance') && <p className="text-[11px] text-slate-400">{field(a.remarks, 'Guidance')}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
