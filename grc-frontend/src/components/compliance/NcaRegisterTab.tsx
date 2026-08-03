'use client';

// NCA register dashboards — Vulnerability Register, Cybersecurity Audit Plan and
// Cybersecurity Risk Register. One component driven by a `kind` prop. Each row's
// full column set is preserved (parsed from the JSON in `remarks`). The
// dashboard surfaces: KPIs, a rating distribution, inherent + residual
// Likelihood×Impact heat-maps (for the risk-scored registers), and an expandable
// card per entry showing the key fields and every column. Blank template rows
// are dropped by the parser, so only real entries appear.

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bug, ClipboardCheck, AlertTriangle, Loader2, Upload, Trash2, ChevronRight, Search, Shield, ArrowRight, User, CalendarClock } from 'lucide-react';
import apiClient from '@/lib/api';

const PRIMARY: React.CSSProperties = { background: 'var(--color-base, #14b8a6)', color: '#fff' };
type Kind = 'vuln' | 'audit' | 'risk';

interface KindCfg {
  format: string; title: string; sub: string; Icon: typeof Bug; noun: string;
  sev: string[]; like: string[]; imp: string[];
  res: null | { sev: string[]; like: string[]; imp: string[] };
  chips: string[]; inline: string[];
}
const CONF: Record<Kind, KindCfg> = {
  vuln: { format: 'nca_vuln_register', title: 'NCA Vulnerability Register', sub: 'Vulnerabilities · CVE · risk level', Icon: Bug, noun: 'vulnerabilities',
    sev: ['risk level'], like: ['risk likelihood'], imp: ['risk severity'], res: null,
    chips: ['cve number', 'status'], inline: ['affected assets', 'owner', 'due date'] },
  audit: { format: 'nca_audit_register', title: 'NCA Cybersecurity Audit Plan', sub: 'Audits & reviews · scope · schedule', Icon: ClipboardCheck, noun: 'audits',
    sev: [], like: [], imp: [], res: null,
    chips: ['type of audit'], inline: ['lead auditor', 'team responsible', 'audit start', 'audit end'] },
  risk: { format: 'nca_risk_register', title: 'NCA Cybersecurity Risk Register', sub: 'Risks · inherent / residual · treatment', Icon: AlertTriangle, noun: 'risks',
    sev: ['inherent', 'rating'], like: ['inherent', 'likelihood'], imp: ['inherent', 'magnitude'],
    res: { sev: ['resid', 'rating'], like: ['resid', 'likelihood'], imp: ['resid', 'magnitude'] },
    chips: ['type of treatment'], inline: ['risk owner', 'threat', 'deadline for action'] },
};

interface Item { id: number; item_number: string; area_domain: string | null; control_description: string | null; compliance_status: string; priority: string | null; remarks: string | null; }
interface Detail { id: number; name: string; source: string | null; items: Item[]; }

const parseRow = (r: string | null): Record<string, string> => { try { return JSON.parse(r || '{}'); } catch { return {}; } };
// Find the value whose column header contains ALL of the given needle words.
const pick = (d: Record<string, string>, needles: string[]): string => {
  const k = Object.keys(d).find((x) => needles.every((n) => x.toLowerCase().includes(n.toLowerCase())));
  return k ? d[k] : '';
};
const num = (s: string) => { const n = parseInt(String(s).replace(/[^\d]/g, ''), 10); return isNaN(n) ? 0 : n; };

const BANDS = ['Critical', 'High', 'Medium', 'Low', 'Very Low'] as const;
function bandOf(v: string): typeof BANDS[number] | '' {
  const t = (v || '').toLowerCase();
  if (t.includes('critical')) return 'Critical';
  if (t.includes('very low')) return 'Very Low';
  if (t.includes('high')) return 'High';
  if (t.includes('medium')) return 'Medium';
  if (t.includes('low')) return 'Low';
  return '';
}
const BAND_COLOR: Record<string, string> = { Critical: '#dc2626', High: '#ea580c', Medium: '#d97706', Low: '#059669', 'Very Low': '#0d9488' };
function cellBand(score: number) { if (score >= 15) return '#dc2626'; if (score >= 10) return '#ea580c'; if (score >= 5) return '#d97706'; if (score >= 1) return '#059669'; return '#e2e8f0'; }

function Heatmap({ pts, label }: { pts: { l: number; i: number; id: string }[]; label: string }) {
  const cell = (L: number, I: number) => pts.filter((p) => p.l === L && p.i === I);
  return (
    <div className="inline-block">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="flex">
        <div className="flex flex-col justify-between pr-1 text-[9px] font-semibold text-slate-400" style={{ height: 120 }}>{[5, 4, 3, 2, 1].map((L) => <span key={L} className="flex h-6 items-center">{L}</span>)}</div>
        <div>
          <div className="grid grid-cols-5 gap-0.5">
            {[5, 4, 3, 2, 1].map((L) => [1, 2, 3, 4, 5].map((I) => { const here = cell(L, I); const bc = cellBand(L * I); return (
              <div key={`${L}-${I}`} className="flex h-6 w-8 items-center justify-center rounded text-[10px] font-bold" style={{ background: `${bc}18`, color: bc, border: `1px solid ${bc}33` }}>
                {here.length > 0 ? <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: bc }} title={here.map((h) => h.id).join(', ')}>{here.length}</span> : ''}
              </div>); }))}
          </div>
          <div className="mt-0.5 grid grid-cols-5 gap-0.5 text-center text-[9px] font-semibold text-slate-400">{[1, 2, 3, 4, 5].map((I) => <span key={I}>{I}</span>)}</div>
        </div>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[8.5px] text-slate-400"><span>← Likelihood</span><span>Impact →</span></div>
    </div>
  );
}

export default function NcaRegisterTab({ kind }: { kind: Kind }) {
  const qc = useQueryClient();
  const cfg = CONF[kind];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: list = [], isLoading: listLoading } = useQuery<{ id: number }[]>({
    queryKey: ['nca-reg', cfg.format],
    queryFn: async () => (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: cfg.format } })).data?.assessments || [],
    staleTime: 30_000,
  });
  const activeId = list[0]?.id ?? null;
  const { data: detail, isLoading: detailLoading } = useQuery<Detail>({
    queryKey: ['nca-reg-detail', activeId], queryFn: async () => (await apiClient.get(`/compliance/assessments/${activeId}`)).data, enabled: !!activeId, staleTime: 30_000,
  });

  const deleteAssessment = useMutation({ mutationFn: async () => apiClient.delete(`/compliance/assessments/${activeId}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['nca-reg', cfg.format] }); qc.invalidateQueries({ queryKey: ['nca-reg-detail', activeId] }); } });
  const onDelete = () => { if (!activeId) return; if (!confirm(`Delete "${detail?.name || cfg.title}" and all ${detail?.items?.length ?? 0} entries? This cannot be undone.`)) return; deleteAssessment.mutate(); };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; setUploading(true);
    try { const fd = new FormData(); fd.append('file', file);
      if (activeId) await apiClient.post(`/compliance/assessments/${activeId}/reupload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      else { fd.append('name', cfg.title); fd.append('assessment_type', 'cybersecurity'); fd.append('expected_format', cfg.format); await apiClient.post('/compliance/assessments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
      qc.invalidateQueries({ queryKey: ['nca-reg', cfg.format] }); qc.invalidateQueries({ queryKey: ['nca-reg-detail', activeId] });
    } catch (err) { const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail; alert(d || `Upload failed. Make sure it is the ${cfg.title} workbook.`); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const model = useMemo(() => {
    const items = detail?.items || [];
    const entries = items.map((it) => {
      const d = parseRow(it.remarks);
      const sev = cfg.sev.length ? pick(d, cfg.sev) : '';
      const l = cfg.like.length ? num(pick(d, cfg.like)) : 0;
      const i = cfg.imp.length ? num(pick(d, cfg.imp)) : 0;
      const res = cfg.res ? { sev: pick(d, cfg.res.sev), l: num(pick(d, cfg.res.like)), i: num(pick(d, cfg.res.imp)) } : null;
      return { it, d, sev, l, i, res };
    });
    const open = items.filter((x) => x.compliance_status === 'in_progress').length;
    const resolved = items.filter((x) => x.compliance_status === 'complied').length;
    const critHigh = entries.filter((e) => /critical|high/i.test(e.sev)).length;
    const inhHeat = entries.filter((e) => e.l >= 1 && e.i >= 1).map((e) => ({ l: e.l, i: e.i, id: e.it.item_number }));
    const resHeat = cfg.res ? entries.filter((e) => e.res && e.res.l >= 1 && e.res.i >= 1).map((e) => ({ l: e.res!.l, i: e.res!.i, id: e.it.item_number })) : [];
    // Rating distribution (inherent).
    const dist: Record<string, number> = {};
    for (const e of entries) { const b = bandOf(e.sev); if (b) dist[b] = (dist[b] || 0) + 1; }
    return { entries, kpis: { total: items.length, open, resolved, critHigh }, inhHeat, resHeat, dist };
  }, [detail, cfg]);

  if (listLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>;
  const term = search.trim().toLowerCase();
  const shown = model.entries.filter((e) => !term || `${e.it.item_number} ${e.it.control_description} ${Object.values(e.d).join(' ')}`.toLowerCase().includes(term));
  const distTotal = Object.values(model.dist).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={PRIMARY}><cfg.Icon className="h-6 w-6 text-white" /></div>
          <div>
            <div className="flex items-center gap-2"><h3 className="text-[15px] font-bold text-gray-900">{cfg.title}</h3><span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"><Shield className="h-3 w-3" /> NCA register</span></div>
            <p className="text-[11px] text-gray-500">{cfg.sub}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={PRIMARY} className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60">{uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploading ? 'Uploading…' : activeId ? 'Re-upload Excel' : 'Upload Excel'}</button>
          {activeId && <button onClick={onDelete} disabled={deleteAssessment.isPending} title="Delete this assessment" className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">{deleteAssessment.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete</button>}
        </div>
      </div>

      {!activeId ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-20 text-center">
          <cfg.Icon className="mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No {cfg.title} uploaded yet.</p>
          <p className="mt-1 max-w-md text-xs text-slate-400">Upload the NCA register workbook — every {cfg.noun} row and all its columns are parsed into this dashboard.</p>
        </div>
      ) : detailLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : model.entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <cfg.Icon className="mb-3 h-9 w-9 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">The register is empty.</p>
          <p className="mt-1 max-w-md text-xs text-slate-400">This NCA template has no filled {cfg.noun} yet — add rows in the Excel and re-upload.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">{kind === 'audit' ? 'Audits & reviews' : 'Entries'}</div><div className="text-[26px] font-bold tabular-nums text-slate-900">{model.kpis.total}</div></div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Open</div><div className="text-[26px] font-bold tabular-nums text-amber-600">{model.kpis.open}</div></div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">{kind === 'audit' ? 'Completed' : 'Resolved / done'}</div><div className="text-[26px] font-bold tabular-nums text-emerald-600">{model.kpis.resolved}</div></div>
            {cfg.sev.length ? <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Critical / High</div><div className="text-[26px] font-bold tabular-nums text-rose-600">{model.kpis.critHigh}</div><div className="mt-1 text-[11px] text-slate-400">inherent rating</div></div>
              : <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Register</div><div className="text-[16px] font-bold text-slate-900">NCA template</div></div>}
          </div>

          {/* Risk exposure: rating distribution + Likelihood×Severity heat-map. For the
              vulnerability register these sit side by side in one row, so the compact
              matrix reads as part of a paired risk panel (full colour bar + heat-map)
              rather than a lonely half-empty grid. Other registers keep them stacked. */}
          {(() => {
            // Inherent risk rating as a per-band breakdown (one labelled row + a
            // proportional bar + count/% each) so the card is data-rich and fills its
            // height, matching the heat-map card beside it rather than leaving a gap.
            const bar = cfg.sev.length > 0 && distTotal > 0 ? (
              <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
                <h4 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Inherent risk rating</h4>
                <div className="flex flex-1 flex-col justify-center gap-2.5">
                  {BANDS.map((b) => {
                    const n = model.dist[b] || 0;
                    const pct = distTotal ? Math.round((n / distTotal) * 100) : 0;
                    return (
                      <div key={b} className="flex items-center gap-3">
                        <span className="flex w-[76px] shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-600"><span className="h-2.5 w-2.5 shrink-0 rounded" style={{ background: BAND_COLOR[b] }} />{b}</span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: BAND_COLOR[b] }} /></div>
                        <span className="w-16 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-500">{n} <span className="text-slate-300">·</span> {pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null;
            const heat = model.inhHeat.length > 0 ? (
              <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
                <h4 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Likelihood × {kind === 'vuln' ? 'Severity' : 'Impact'} heat-map</h4>
                <div className="flex flex-1 flex-wrap items-center justify-center gap-8">
                  <Heatmap pts={model.inhHeat} label={cfg.res ? 'Inherent' : 'Risk exposure'} />
                  {cfg.res && model.resHeat.length > 0 && <div className="flex items-center gap-8"><ArrowRight className="h-5 w-5 text-slate-300" /><Heatmap pts={model.resHeat} label="Residual (after treatment)" /></div>}
                </div>
              </div>
            ) : null;
            if (!bar && !heat) return null;
            // Vuln: pair them in one equal-width, equal-height row (grid stretches both).
            if (kind === 'vuln' && bar && heat) return <div className="grid gap-4 lg:grid-cols-2">{bar}{heat}</div>;
            return <>{bar}{heat}</>;
          })()}

          <div className="flex h-9 w-[280px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${cfg.noun}…`} className="w-full border-0 bg-transparent text-[13px] outline-none" /></div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="divide-y divide-slate-100">
              {shown.map(({ it, d, sev, l, i, res }) => {
                const open = expanded === it.id;
                const sb = bandOf(sev); const rb = res ? bandOf(res.sev) : '';
                return (
                  <div key={it.id}>
                    <button onClick={() => setExpanded(open ? null : it.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
                      <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                      <span className="mt-px font-mono text-[11.5px] font-semibold text-slate-500">{it.item_number}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium leading-snug text-slate-800">{it.control_description}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-slate-400">
                          {pick(d, [cfg.inline[0]]) && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{pick(d, [cfg.inline[0]])}</span>}
                          {cfg.inline.slice(1).map((cn) => { const v = pick(d, [cn]); return v ? <span key={cn}>{/deadline|due|end/i.test(cn) ? <CalendarClock className="mr-0.5 inline h-3 w-3" /> : null}{v.length > 44 ? v.slice(0, 44) + '…' : v}</span> : null; })}
                          {(l >= 1 && i >= 1) && <span className="font-medium text-slate-500">L{l}×I{i}{res && res.l >= 1 ? ` → L${res.l}×I${res.i}` : ''}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {sev && <span className="inline-flex items-center gap-1 text-[11px] font-semibold"><span className="rounded px-1.5 py-0.5" style={{ background: `${BAND_COLOR[sb] || '#64748b'}1a`, color: BAND_COLOR[sb] || '#64748b' }}>{sev}</span>{res && res.sev && <><ArrowRight className="h-3 w-3 text-slate-300" /><span className="rounded px-1.5 py-0.5" style={{ background: `${BAND_COLOR[rb] || '#64748b'}1a`, color: BAND_COLOR[rb] || '#64748b' }}>{res.sev}</span></>}</span>}
                        {pick(d, cfg.chips) && <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[9.5px] font-medium text-slate-500">{pick(d, cfg.chips)}</span>}
                      </div>
                    </button>
                    {open && (
                      <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                        <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">{Object.entries(d).map(([k, v]) => <div key={k} className="text-[11.5px]"><span className="font-semibold text-slate-500">{k}:</span> <span className="text-slate-700">{v}</span></div>)}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
