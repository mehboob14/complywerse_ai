'use client';

// Cyber Security KPI Report — a proper reporting dashboard mirroring the Excel's
// "Dashboard" sheet. Each KPI (from the KPI + Measurement sheets) carries a
// topic, definition, Type / Frequency / Data-source, a prior-year baseline and
// four quarters of Target + Actual. This page renders, per KPI, a quarterly
// Target-vs-Actual trend chart (Prior → Q1–Q4) with a value strip, grouped by
// cybersecurity domain. Data comes from the shared /compliance/assessments
// endpoints (format = kpi_report). Percentages are the workbook's own decimals
// (0.636 → 63.6%); there is no derived formula beyond Actual vs Target.

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, Upload, ChevronRight, Search, Trash2, Repeat, Database } from 'lucide-react';
import apiClient from '@/lib/api';

const KPI_FORMAT = 'kpi_report';
const PRIMARY: React.CSSProperties = { background: 'var(--color-base, #14b8a6)', color: '#fff' };
const TEAL = 'var(--color-base, #14b8a6)';

interface Item { id: number; item_number: string; area_domain: string | null; control_description: string | null; remarks: string | null; }
interface Detail { id: number; name: string; source: string | null; file_name: string | null; items: Item[]; }

// Parse the enriched remarks blob:
// "Topic: … | Type: … | Freq: … | Source: … | Def: … | Prior: 63.6% | Q1: 30.2%/21.6% | Q2: …"
function parseKpi(remarks: string | null) {
  const r = remarks || '';
  const grab = (k: string) => new RegExp(`${k}:\\s*([^|]+)`, 'i').exec(r)?.[1]?.trim() || '';
  const num = (s: string) => { const n = parseFloat(String(s).replace('%', '')); return isNaN(n) ? null : n; };
  const isPct = /Type:\s*Percentage/i.test(r);
  const quarters = [1, 2, 3, 4].map((q) => {
    const m = new RegExp(`Q${q}:\\s*([^/|]+)/([^|]+)`, 'i').exec(r);
    const note = new RegExp(`Q${q}Note:\\s*([^|]+)`, 'i').exec(r)?.[1]?.trim() || '';
    return { q, target: m ? num(m[1]) : null, actual: m ? num(m[2]) : null, note };
  }).filter((x) => x.target != null || x.actual != null);
  return {
    topic: grab('Topic'), type: grab('Type'), freq: grab('Freq'), source: grab('Source'),
    def: grab('Def'), prior: num(grab('Prior')), isPct, quarters,
  };
}

// Compact quarterly Target-vs-Actual trend chart (Prior → Q1..Q4).
function TrendChart({ prior, quarters, isPct }: { prior: number | null; quarters: { q: number; target: number | null; actual: number | null }[]; isPct: boolean }) {
  const W = 320, H = 96, padX = 30, padY = 14;
  const xs = [padX, ...quarters.map((_, i) => padX + ((W - padX - 12) * (i + 1)) / quarters.length)];
  const allVals = [prior, ...quarters.flatMap((q) => [q.target, q.actual])].filter((v): v is number => v != null);
  const max = isPct ? 100 : Math.max(1, ...allVals) * 1.1;
  const y = (v: number) => H - padY - ((v / max) * (H - 2 * padY));
  const pt = (i: number, v: number | null) => (v == null ? null : `${xs[i].toFixed(1)},${y(v).toFixed(1)}`);
  const actualPts = [prior != null ? pt(0, prior) : null, ...quarters.map((q, i) => pt(i + 1, q.actual))].filter(Boolean).join(' ');
  const targetPts = quarters.map((q, i) => pt(i + 1, q.target)).filter(Boolean).join(' ');
  const labels = ['Prior', ...quarters.map((q) => `Q${q.q}`)];
  const fmt = (v: number | null) => (v == null ? '' : isPct ? `${v}%` : `${v}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none">
      {/* horizontal gridlines */}
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={padX} x2={W - 12} y1={y(max * g)} y2={y(max * g)} stroke="#f1f5f9" strokeWidth="1" />)}
      {/* target line (dashed) */}
      {targetPts && <polyline points={targetPts} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />}
      {quarters.map((q, i) => q.target != null && <circle key={`t${i}`} cx={xs[i + 1]} cy={y(q.target)} r="2.5" fill="#94a3b8" />)}
      {/* actual line (teal) */}
      {actualPts && <polyline points={actualPts} fill="none" stroke={TEAL} strokeWidth="2" />}
      {prior != null && <circle cx={xs[0]} cy={y(prior)} r="3" fill={TEAL} />}
      {quarters.map((q, i) => q.actual != null && <circle key={`a${i}`} cx={xs[i + 1]} cy={y(q.actual)} r="3" fill={TEAL} />)}
      {/* value labels on actual */}
      {prior != null && <text x={xs[0]} y={y(prior) - 6} fontSize="8" fill="#64748b" textAnchor="middle">{fmt(prior)}</text>}
      {quarters.map((q, i) => q.actual != null && <text key={`av${i}`} x={xs[i + 1]} y={y(q.actual) - 6} fontSize="8" fill={TEAL} textAnchor="middle">{fmt(q.actual)}</text>)}
      {/* x labels */}
      {labels.map((l, i) => <text key={l} x={xs[i]} y={H - 2} fontSize="8" fill="#94a3b8" textAnchor="middle">{l}</text>)}
    </svg>
  );
}

export default function KpiReportTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [openDom, setOpenDom] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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

  const { doms, total, cadence } = useMemo(() => {
    const items = detail?.items || [];
    const byDom = new Map<string, Item[]>();
    for (const it of items) { const k = it.area_domain || 'General'; if (!byDom.has(k)) byDom.set(k, []); byDom.get(k)!.push(it); }
    const doms = [...byDom.entries()].map(([name, its]) => ({ name, items: its })).sort((a, b) => a.name.localeCompare(b.name));
    const freqs = new Set(items.map((i) => parseKpi(i.remarks).freq).filter(Boolean));
    return { doms, total: items.length, cadence: freqs.size === 1 ? [...freqs][0] : freqs.size > 1 ? 'Mixed' : 'Quarterly' };
  }, [detail]);

  if (listLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;
  const term = search.trim().toLowerCase();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={PRIMARY}><Activity className="h-6 w-6 text-white" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-gray-900">Cyber Security KPI Report</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Quarterly target vs actual · reporting dashboard</span>
            </div>
            <p className="text-[11px] text-gray-500">{detail?.source || 'Key Performance Indicators by cybersecurity domain'}</p>
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
          <p className="mt-1 max-w-md text-xs text-slate-400">Upload the Key Performance Indicator report workbook — every KPI, its domain, type, cadence, data source and quarterly target vs actual is parsed into this dashboard.</p>
        </div>
      ) : detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">KPIs tracked</div>
              <div className="text-[26px] font-bold tabular-nums text-slate-900">{total}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Domains</div>
              <div className="text-[26px] font-bold tabular-nums text-slate-900">{doms.length}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Reporting cadence</div>
              <div className="text-[16px] font-bold text-slate-900">{cadence}</div>
              <div className="mt-1 flex items-center gap-3 text-[10.5px] text-slate-400">
                <span className="inline-flex items-center gap-1"><span className="inline-block h-[2px] w-4" style={{ background: TEAL }} /> actual</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block h-[2px] w-4 border-t border-dashed border-slate-400" /> target</span>
              </div>
            </div>
          </div>

          <div className="flex h-9 w-[280px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search KPIs…" className="w-full border-0 bg-transparent text-[13px] outline-none" />
          </div>

          <div className="space-y-2.5">
            {doms.map((d) => {
              const rows = d.items.filter((it) => !term || `${d.name} ${it.control_description} ${parseKpi(it.remarks).def}`.toLowerCase().includes(term));
              if (rows.length === 0) return null;
              const open = openDom === d.name || term !== '';
              return (
                <div key={d.name} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <button onClick={() => setOpenDom(open && openDom === d.name ? null : d.name)} className="flex w-full items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span className="flex-1 text-left text-[14px] font-bold text-slate-800">{d.name}</span>
                    <span className="text-[11px] text-slate-400">{rows.length} KPI{rows.length > 1 ? 's' : ''}</span>
                  </button>
                  {open && (
                    <div className="divide-y divide-slate-100 border-t border-slate-100">
                      {rows.map((it) => {
                        const k = parseKpi(it.remarks);
                        return (
                          <div key={it.id} className="px-4 py-3">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <p className="text-[13px] font-semibold leading-snug text-slate-800">{k.topic || it.control_description}</p>
                              {k.type && <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{k.type}</span>}
                              {k.freq && <span className="inline-flex items-center gap-1 text-[10.5px] text-slate-400"><Repeat className="h-3 w-3" />{k.freq}</span>}
                              {k.source && <span className="inline-flex items-center gap-1 text-[10.5px] text-slate-400"><Database className="h-3 w-3" />{k.source}</span>}
                            </div>
                            {k.def && k.def !== k.topic && <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{k.def}</p>}
                            {k.quarters.length > 0 && (
                              <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                                <div className="rounded-lg border border-slate-100 bg-slate-50/40 px-2 pt-1">
                                  <TrendChart prior={k.prior} quarters={k.quarters} isPct={k.isPct} />
                                </div>
                                <div className="grid grid-cols-4 gap-1.5">
                                  {k.quarters.map(({ q, target, actual }) => {
                                    const variance = target != null && actual != null ? Math.round((actual - target) * 10) / 10 : null;
                                    const unit = k.isPct ? '%' : '';
                                    return (
                                      <div key={q} className="rounded-lg border border-slate-100 bg-white px-2 py-1.5 text-center">
                                        <div className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">Q{q}</div>
                                        <div className="mt-0.5 text-[12px] font-bold tabular-nums" style={{ color: TEAL }}>{actual != null ? `${actual}${unit}` : '—'}</div>
                                        <div className="text-[9px] text-slate-400">vs {target != null ? `${target}${unit}` : '—'}</div>
                                        {variance != null && <div className="text-[9.5px] font-semibold tabular-nums" style={{ color: variance >= 0 ? '#0d9488' : '#e11d48' }}>{variance >= 0 ? '+' : ''}{variance}{unit ? 'pp' : ''}</div>}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
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
