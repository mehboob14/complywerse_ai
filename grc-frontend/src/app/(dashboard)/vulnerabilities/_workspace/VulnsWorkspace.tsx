'use client';

/**
 * VulnsWorkspace — Vulnerability Register, redesigned to the handoff mock
 * ("Vulnerabilities.mock.html") 1:1: a contextual-priority ribbon, a triage-view
 * rail, a Register / Insights toggle, and a clean findings table.
 *
 * Still purely presentational — ALL data, filter state + setters, permissions
 * and handlers arrive as props from VulnerabilitiesPage. The triage rail applies
 * a LOCAL view filter on top of the page's already-filtered `filteredVulns`;
 * search stays wired to the page. Priority · Ctx is the real `composite_priority`
 * (0–10) ×10 — the same number the server dashboard bands at 55 / 25.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Download, Plus, Upload, Crosshair, Loader2, Building2, Clock, BarChart3, Target } from 'lucide-react';
import { shortenVulnTitle, type Vulnerability } from './lib';
import CtemScopesRedesign from '../ctem-scopes/CtemScopesRedesign';

// ── mock palette (kept literal so the register reads exactly like the mock) ──
const AC = '#17B898', ACS = '#12A085', ACSOFT = '#E4F8F2';
const MUTED = '#8A95A1', FAINT = '#AEB8C2', BORDER = '#E8ECEE', BORDER2 = '#F0F3F5', INK = '#0F1F2B', SEC = '#3A4653';
const SEV = {
  critical: { pillC: '#C2453F', pillBg: '#FBEAEA', label: 'Critical', dot: '#C2453F' },
  high: { pillC: '#C0682F', pillBg: '#FCEEE2', label: 'High', dot: '#DB7B45' },
  medium: { pillC: '#9A6410', pillBg: '#FBF2DF', label: 'Medium', dot: '#E0AF33' },
  low: { pillC: '#1F7A54', pillBg: '#E7F5EE', label: 'Low', dot: '#17B898' },
  info: { pillC: '#6B7787', pillBg: '#EEF1F3', label: 'Info', dot: '#AEB8C2' },
} as const;
type SevKey = keyof typeof SEV;
const MONO = 'ui-monospace,Consolas,monospace';

const normSev = (s?: string): SevKey => {
  const k = (s || '').toLowerCase();
  return (k in SEV ? k : k === 'informational' ? 'info' : 'info') as SevKey;
};
const hasExploit = (v: Vulnerability) => (v.public_exploit_count ?? 0) > 0 || (v.exploitdb_count ?? 0) > 0 || !!v.kev_flag;
const ctxScore = (v: Vulnerability) => Math.round((v.composite_priority ?? 0) * 10); // 0–100
const band = (score: number) => (score >= 55 ? 'urgent' : score >= 25 ? 'moderate' : 'low');
const BAND_META = { urgent: { c: '#C2453F', label: 'Urgent' }, moderate: { c: '#9A6410', label: 'Mod' }, low: { c: '#1F7A54', label: 'Low' } } as const;
const isUnassigned = (v: Vulnerability) => !v.assigned_to && !(v as any).assignee_name;
const isExposed = (v: Vulnerability) => !!(v as any).internet_facing || !!(v as any).internet_exposed;
const domainOf = (v: Vulnerability) => v.plugin_family || (v as any).affected_component || 'General';
const OPEN_ISH = new Set(['open', 'in_progress', 'remediated', 'verified']);
const dueLabel = (v: Vulnerability) => {
  if (!v.due_date) return null;
  const d = Math.ceil((new Date(v.due_date).getTime() - Date.now()) / 864e5);
  return d < 0 ? { t: `${-d}d overdue`, c: '#B23A3A' } : { t: `due ${d}d`, c: d <= 7 ? '#B23A3A' : SEC };
};

interface VulnDashboard {
  total_vulnerabilities?: number; by_severity?: Record<string, number>; by_status?: Record<string, number>;
  overdue_count?: number; sla_compliance?: Record<string, { total: number; resolved: number; on_time: number; compliance_rate: number }>;
  kev_count?: number; exploit_count?: number; no_exploit_count?: number; with_cve_count?: number;
  high_tactics_count?: number; high_tactics_with_exploit_count?: number; high_epss_count?: number;
  internet_exposed_count?: number; patch_count?: number; mttr_days?: number;
  contextual_priority?: { urgent?: number; moderate?: number; low?: number };
}

export interface VulnsWorkspaceProps {
  vulns: Vulnerability[]; filteredVulns: Vulnerability[]; dashboard: VulnDashboard | undefined; scoped?: boolean;
  domains?: { family: string; total: number; worst_severity: string }[]; loading?: boolean;
  registerType: 'standard' | 'nca'; setRegisterType: (v: 'standard' | 'nca') => void; renderNcaRegister: () => React.ReactNode;
  searchTerm: string; setSearchTerm: (v: string) => void;
  statusFilter: string; setStatusFilter: (v: string) => void;
  severityFilter: string; setSeverityFilter: (v: string) => void;
  showClosed: boolean; setShowClosed: (v: boolean) => void;
  exploitFilter: string; setExploitFilter: (v: string) => void;
  tacticsFilter: string; setTacticsFilter: (v: string) => void;
  assetFilter?: string; setAssetFilter?: (v: string) => void; assetItems?: { value: string; label: string }[];
  canCreate: boolean; canEdit: boolean; canDelete: boolean;
  onView: (vuln: Vulnerability) => void; onEdit?: (vuln: Vulnerability) => void; onAssign?: (vuln: Vulnerability) => void;
  onChangeStatus?: (vuln: Vulnerability) => void; onDelete?: (vuln: Vulnerability) => void;
  onBulkAssign?: (ids: number[]) => void; onOpenFull: (id: number) => void;
  onTemplate: () => void; onBulkUpload: () => void; onAdd: () => void;
  bulkUploadState?: 'idle' | 'uploading' | 'done' | 'error'; bulkUploadMsg?: string | null;
}

type TriageView = 'all' | 'kev' | 'exploit' | 'cve' | 'epss' | 'exposed' | 'unassigned' | `sev-${SevKey}` | `dom-${string}`;

const th: React.CSSProperties = { textAlign: 'left', fontSize: 9.5, letterSpacing: '.05em', textTransform: 'uppercase', color: FAINT, fontWeight: 600, padding: '10px 12px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#FAFBFC', zIndex: 1 };
const td: React.CSSProperties = { padding: '11px 12px', borderBottom: `1px solid ${BORDER2}`, verticalAlign: 'middle', whiteSpace: 'nowrap', fontSize: 12.5 };
const cap: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT, padding: '2px 6px 6px' };
const railBtn = (active: boolean): React.CSSProperties => ({ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, padding: '5px 10px', border: 0, borderRadius: 10, background: active ? ACSOFT : 'none', color: active ? '#0A5A4B' : SEC, fontSize: 12.5, fontWeight: active ? 600 : 500, textAlign: 'left', width: '100%', cursor: 'pointer' });
const btn: React.CSSProperties = { border: `1px solid #E4E8EC`, background: '#fff', color: SEC, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' };
const btnGreen: React.CSSProperties = { ...btn, background: AC, borderColor: AC, color: '#06342B', fontWeight: 600 };
const pill = (c: string, bg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap', color: c, background: bg });

const SevPill = ({ s }: { s?: string }) => { const m = SEV[normSev(s)]; return <span style={pill(m.pillC, m.pillBg)}>{m.label}</span>; };

export function VulnsWorkspace(props: VulnsWorkspaceProps) {
  const {
    vulns, filteredVulns, dashboard, domains = [], loading = false,
    registerType, setRegisterType, renderNcaRegister,
    searchTerm, setSearchTerm, canCreate, onView, onOpenFull, onTemplate, onBulkUpload, onAdd,
    bulkUploadState = 'idle', bulkUploadMsg,
  } = props;

  const [view, setView] = useState<TriageView>('all');
  const [pane, setPane] = useState<'reg' | 'ins' | 'ctem'>('reg');
  const [sort, setSort] = useState<'ctx' | 'cvss' | 'epss'>('ctx');
  const isNca = registerType === 'nca';

  const all = vulns ?? [];
  const count = (f: (v: Vulnerability) => boolean) => all.filter(f).length;

  // Contextual-priority band tally (real composite_priority) — prefer server, else derive.
  const agg = useMemo(() => {
    const d = dashboard ?? {};
    const ctx = d.contextual_priority ?? {};
    const derive = () => ({ urgent: count((v) => ctxScore(v) >= 55), moderate: count((v) => ctxScore(v) >= 25 && ctxScore(v) < 55), low: count((v) => ctxScore(v) < 25) });
    const dv = (ctx.urgent == null) ? derive() : { urgent: ctx.urgent ?? 0, moderate: ctx.moderate ?? 0, low: ctx.low ?? 0 };
    return {
      total: d.total_vulnerabilities ?? all.length,
      kev: d.kev_count ?? count((v) => !!v.kev_flag),
      mttr: d.mttr_days,
      slaRate: d.sla_compliance ? Math.round((Object.values(d.sla_compliance).reduce((s, x) => s + (x.compliance_rate || 0), 0) / Math.max(1, Object.values(d.sla_compliance).length))) : null,
      ...dv,
    };
  }, [dashboard, all]);

  // Triage rail (counts from the full list).
  // Rail counts are the TRUE totals from the server dashboard (same source as the ribbon's
  // "Actively exploited"), so they never under-count the fetched page; client tally is only a
  // fallback when an aggregate is absent.
  const dcount = (agg: number | undefined, f: (v: Vulnerability) => boolean) => (agg != null ? agg : count(f));
  const RAIL: { key: TriageView; label: string; n: number; dot?: string; sw?: string }[] = [
    { key: 'all', label: 'All findings', n: dashboard?.total_vulnerabilities ?? all.length },
    { key: 'kev', label: 'Fix first · KEV', n: dcount(dashboard?.kev_count, (v) => !!v.kev_flag), dot: '#C2453F' },
    { key: 'exploit', label: 'Public exploit', n: dcount(dashboard?.exploit_count, hasExploit), dot: '#DB7B45' },
    { key: 'cve', label: 'With CVE', n: dcount(dashboard?.with_cve_count, (v) => !!v.cve_id), dot: '#2E63A8' },
    { key: 'epss', label: 'High EPSS', n: dcount(dashboard?.high_epss_count, (v) => (v.epss_score ?? 0) >= 0.1), dot: '#9A6410' },
    { key: 'exposed', label: 'Internet-exposed', n: dcount(dashboard?.internet_exposed_count, isExposed), dot: '#6A54C9' },
    { key: 'unassigned', label: 'Unassigned', n: count(isUnassigned), dot: '#8A95A1' },
  ];
  const SEV_RAIL: { key: TriageView; label: string; n: number; sw: string }[] = (['critical', 'high', 'medium', 'info'] as SevKey[]).map((k) => ({ key: `sev-${k}` as TriageView, label: SEV[k].label, n: count((v) => normSev(v.severity) === k), sw: SEV[k].dot }));
  const DOM_RAIL = (domains ?? []).slice(0, 6).map((d) => ({ key: `dom-${d.family}` as TriageView, label: d.family || 'General', n: d.total, sw: SEV[normSev(d.worst_severity)].dot }));

  const matches = (v: Vulnerability): boolean => {
    if (view === 'all' || view === 'unassigned') return view === 'all' ? true : isUnassigned(v);
    if (view === 'kev') return !!v.kev_flag;
    if (view === 'exploit') return hasExploit(v);
    if (view === 'cve') return !!v.cve_id;
    if (view === 'epss') return (v.epss_score ?? 0) >= 0.1;
    if (view === 'exposed') return isExposed(v);
    if (view.startsWith('sev-')) return normSev(v.severity) === view.slice(4);
    if (view.startsWith('dom-')) return domainOf(v) === view.slice(4);
    return true;
  };
  const rows = useMemo(() => {
    const r = (filteredVulns ?? []).filter(matches);
    const s = [...r];
    if (sort === 'ctx') s.sort((a, b) => ctxScore(b) - ctxScore(a));
    else if (sort === 'cvss') s.sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0));
    else if (sort === 'epss') s.sort((a, b) => (b.epss_score ?? 0) - (a.epss_score ?? 0));
    return s;
  }, [filteredVulns, view, sort]);

  const railLabel: Record<string, string> = { all: 'All findings', kev: 'Fix first · KEV', exploit: 'Public exploit', cve: 'With CVE', epss: 'High EPSS', exposed: 'Internet-exposed', unassigned: 'Unassigned' };
  const title = railLabel[view] || (view.startsWith('sev-') ? SEV[view.slice(4) as SevKey].label : view.startsWith('dom-') ? view.slice(4) : 'Findings');

  // ── severity donut (raw CVSS bands) for Insights ──
  const sevCounts = (['critical', 'high', 'medium', 'low', 'info'] as SevKey[]).map((k) => ({ k, n: count((v) => normSev(v.severity) === k) }));
  const sevTotal = sevCounts.reduce((s, x) => s + x.n, 0) || 1;
  let acc = 0;
  const arcs = sevCounts.filter((x) => x.n).map((x) => { const len = (x.n / sevTotal) * 100; const a = { k: x.k, len, off: -acc }; acc += len; return a; });
  const top10 = [...all].sort((a, b) => ctxScore(b) - ctxScore(a)).slice(0, 10);

  return (
    <div className="inv2" style={{ background: '#F4F6F7', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden', padding: '10px 10px 0', fontSize: 13.5, color: INK }}>
      {/* header — hidden on the CTEM pane (mock: CTEM carries its own header) */}
      {pane !== 'ctem' && (
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 19, letterSpacing: '-.025em', margin: 0 }}>{isNca ? 'NCA Vulnerability Register' : 'Vulnerability Register'}</h1>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: AC }} />{agg.total} findings · triage by real-world priority, not raw CVSS
          </div>
        </div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <select value={registerType} onChange={(e) => setRegisterType(e.target.value as 'standard' | 'nca')} style={{ ...btn, cursor: 'pointer' }} title="Switch register">
            <option value="standard">Standard</option><option value="nca">NCA Template</option>
          </select>
          <Link href="/vulnerabilities/choke-points" style={{ ...btn, textDecoration: 'none' }}><Crosshair size={15} />Choke points</Link>
          {canCreate && <button style={btn} onClick={onTemplate}><Download size={15} />Template</button>}
          {canCreate && <button style={btn} onClick={onBulkUpload} disabled={bulkUploadState === 'uploading'}>{bulkUploadState === 'uploading' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}Bulk Upload</button>}
          {canCreate && <button style={btnGreen} onClick={onAdd}><Plus size={15} />{isNca ? 'Add NCA Entry' : 'Add Vulnerability'}</button>}
        </div>
      </div>
      )}

      {pane !== 'ctem' && bulkUploadMsg && <div style={{ marginBottom: 12, borderRadius: 9, padding: '9px 14px', fontSize: 12.5, fontWeight: 500, background: bulkUploadState === 'error' ? '#FBEAEA' : '#E7F5EE', color: bulkUploadState === 'error' ? '#B23A3A' : '#1F7A54' }}>{bulkUploadMsg}</div>}

      {isNca ? (
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, flex: 1, minHeight: 0, overflow: 'auto' }}>{renderNcaRegister()}</div>
      ) : (
        <>
          {pane === 'ctem' ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {/* mock: the CTEM view carries its own two-option toggle */}
              <div style={{ display: 'inline-flex', alignSelf: 'flex-start', flexShrink: 0, background: '#EAEEF1', borderRadius: 11, padding: 3, gap: 2, margin: '2px 0 8px' }}>
                <button onClick={() => setPane('reg')} style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 9, background: 'none', color: '#6B7787', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Vulnerability Register</button>
                <button style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 9, background: '#fff', color: ACS, fontSize: 12.5, fontWeight: 600, cursor: 'default', boxShadow: '0 1px 2px rgba(16,24,40,.06)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Target size={14} /> CTEM Scopes</button>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}><CtemScopesRedesign /></div>
            </div>
          ) : (
          <>
          {/* contextual-priority ribbon */}
          <section style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)', display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 10, flexShrink: 0 }}>
            <div style={{ padding: '10px 16px', flex: 1, minWidth: 320 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}><span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>Contextual priority</span><span style={{ fontSize: 10.5, color: FAINT }}>raw severity ≠ real priority</span></div>
              <div style={{ display: 'flex', height: 9, borderRadius: 999, overflow: 'hidden', background: '#EAEEF1' }}>
                {[['urgent', agg.urgent, '#C2453F'], ['moderate', agg.moderate, '#E0AF33'], ['low', agg.low, '#17B898']].map(([k, n, c]) => <i key={k as string} style={{ width: `${(Number(n) / Math.max(1, agg.total)) * 100}%`, background: c as string }} />)}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#C2453F' }} />Urgent <b className="num" style={{ color: INK }}>{agg.urgent}</b></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#E0AF33' }} />Moderate <b className="num" style={{ color: INK }}>{agg.moderate}</b></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#17B898' }} />Low <b className="num" style={{ color: INK }}>{agg.low}</b></span>
                <span style={{ color: FAINT, fontSize: 11 }}>most &ldquo;critical-looking&rdquo; findings are internal, unexploited, low-EPSS</span>
              </div>
            </div>
            <div style={{ width: 1, background: BORDER2, margin: '10px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '10px 18px', flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11.5, color: MUTED }}>Total findings</div><b className="num" style={{ fontSize: 17, fontWeight: 600 }}>{agg.total}</b></div>
              <div><div style={{ fontSize: 11.5, color: MUTED }}>Actively exploited</div><b className="num" style={{ fontSize: 17, fontWeight: 600, color: agg.kev > 0 ? '#B23A3A' : INK }}>{agg.kev}</b></div>
              <div><div style={{ fontSize: 11.5, color: MUTED }}>MTTR</div><b className="num" style={{ fontSize: 17, fontWeight: 600 }}>{agg.mttr != null ? `${agg.mttr}d` : '—'}</b></div>
              <div><div style={{ fontSize: 11.5, color: MUTED }}>SLA</div><b className="num" style={{ fontSize: 17, fontWeight: 600, color: agg.slaRate != null && agg.slaRate < 80 ? '#B23A3A' : INK }}>{agg.slaRate != null ? `${agg.slaRate}%` : '—'}</b></div>
            </div>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: '224px minmax(0,1fr)', gap: 14, alignItems: 'stretch', position: 'sticky', top: 0, height: '100%', flexShrink: 0, overflow: 'hidden' }}>
            {/* triage rail */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 3, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.04)', padding: '9px 9px', minHeight: 0, overflowY: 'auto' }}>
              <div style={cap}>Triage views</div>
              {RAIL.map((r) => (
                <button key={r.key} onClick={() => { setView(r.key); setPane('reg'); }} style={railBtn(view === r.key)}>
                  <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: '0 3px 3px 0', background: AC, opacity: view === r.key ? 1 : 0 }} />
                  {r.dot && <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.dot, flex: 'none' }} />}
                  {r.label}<span className="num" style={{ marginLeft: 'auto', fontSize: 11.5, color: '#9BA6B2' }}>{r.n}</span>
                </button>
              ))}
              <div style={{ ...cap, paddingTop: 14 }}>By severity</div>
              {SEV_RAIL.map((r) => (
                <button key={r.key} onClick={() => { setView(r.key); setPane('reg'); }} style={railBtn(view === r.key)}>
                  <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: '0 3px 3px 0', background: AC, opacity: view === r.key ? 1 : 0 }} />
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: r.sw, flex: 'none' }} />{r.label}<span className="num" style={{ marginLeft: 'auto', fontSize: 11.5, color: '#9BA6B2' }}>{r.n}</span>
                </button>
              ))}
              {DOM_RAIL.length > 0 && <div style={{ ...cap, paddingTop: 14 }}>By domain</div>}
              {DOM_RAIL.map((r) => (
                <button key={r.key} onClick={() => { setView(r.key); setPane('reg'); }} style={railBtn(view === r.key)}>
                  <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: '0 3px 3px 0', background: AC, opacity: view === r.key ? 1 : 0 }} />
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: r.sw, flex: 'none' }} />{r.label}<span className="num" style={{ marginLeft: 'auto', fontSize: 11.5, color: '#9BA6B2' }}>{r.n}</span>
                </button>
              ))}
              {/* Overview / Departments / SLA — the mock keeps these in the rail; they
                  open the existing standalone management views. */}
              <div style={{ height: 1, background: '#F0F3F5', margin: '10px 4px 6px' }} />
              <Link href="/vulnerabilities/dashboard" style={{ ...railBtn(false), textDecoration: 'none' }}><BarChart3 size={15} color="#5B6673" />Overview</Link>
              <Link href="/vulnerabilities/departments" style={{ ...railBtn(false), textDecoration: 'none' }}><Building2 size={15} color="#5B6673" />Departments</Link>
              <Link href="/vulnerabilities/sla" style={{ ...railBtn(false), textDecoration: 'none' }}><Clock size={15} color="#5B6673" />SLA config</Link>
            </aside>

            {/* main */}
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap', flexShrink: 0 }}>
                <div style={{ display: 'inline-flex', background: '#EAEEF1', borderRadius: 11, padding: 3, gap: 2 }}>
                  {(['reg', 'ins', 'ctem'] as const).map((k) => (
                    <button key={k} onClick={() => setPane(k)} style={{ height: 32, padding: '0 14px', border: 0, borderRadius: 9, background: pane === k ? '#fff' : 'none', color: pane === k ? ACS : '#6B7787', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', boxShadow: pane === k ? '0 1px 2px rgba(16,24,40,.06)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{k === 'ctem' && <Target size={14} />}{k === 'reg' ? 'Register' : k === 'ins' ? 'Insights' : 'CTEM Scopes'}</button>
                  ))}
                </div>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <Search size={16} style={{ position: 'absolute', left: 11, top: 10, color: FAINT }} />
                  <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search by title, CVE ID…" style={{ width: '100%', height: 34, border: `1px solid #E4E8EC`, borderRadius: 9, padding: '0 12px 0 34px', fontSize: 12.5, color: SEC, background: '#fff' }} />
                </div>
                <select value={sort} onChange={(e) => setSort(e.target.value as any)} style={{ ...btn, height: 34, cursor: 'pointer' }}>
                  <option value="ctx">Sort: Contextual priority</option><option value="cvss">Sort: CVSS</option><option value="epss">Sort: EPSS</option>
                </select>
              </div>

              {pane === 'reg' ? (
                <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 16px', borderBottom: `1px solid ${BORDER2}`, flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: 13.5, margin: 0 }}>{title}</h3>
                    <span style={{ fontSize: 11.5, color: MUTED }}><b className="num" style={{ color: SEC }}>{rows.length}</b> shown · {agg.total} total</span>
                  </div>
                  <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1020 }}>
                      <thead><tr>{['ID', 'Title', 'CVE', 'Severity', 'CVSS', 'EPSS', 'Exploit', 'Priority · Ctx', 'Status', 'SLA / Due', 'Owner'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {loading ? (
                          <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: '#9BA6B2', padding: 28 }}>Loading…</td></tr>
                        ) : rows.length === 0 ? (
                          <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: '#9BA6B2', padding: 28 }}>No findings match this view.</td></tr>
                        ) : rows.map((v) => {
                          const sev = normSev(v.severity); const sm = SEV[sev];
                          const sc = ctxScore(v); const bm = BAND_META[band(sc)];
                          const exp = hasExploit(v); const due = dueLabel(v);
                          const owner = (v as any).assignee_name as string | undefined;
                          return (
                            <tr key={v.id} onClick={() => onView(v)} style={{ cursor: 'pointer' }} className="vrow">
                              <td style={{ ...td, fontFamily: MONO }}>VULN-{v.id}</td>
                              <td style={{ ...td, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.title}>{shortenVulnTitle(v.title)}{v.kev_flag && <span style={{ ...pill('#C2453F', '#FBEAEA'), fontSize: 9, marginLeft: 6 }}>KEV</span>}</td>
                              <td style={{ ...td, fontFamily: MONO, color: v.cve_id ? SEC : FAINT }}>{v.cve_id || '—'}</td>
                              <td style={td}><SevPill s={v.severity} /></td>
                              <td style={{ ...td, fontFamily: MONO, color: sm.pillC }}>{v.cvss_score ?? '—'}</td>
                              <td style={{ ...td, fontFamily: MONO, color: FAINT }}>{v.epss_score != null ? `${(v.epss_score * 100).toFixed(1)}%` : '—'}</td>
                              <td style={{ ...td, color: exp ? '#C0682F' : FAINT }}>{exp ? 'Public' : 'None'}</td>
                              <td style={{ ...td, fontFamily: MONO, color: bm.c, fontWeight: 600 }}>{sc} · {bm.label}</td>
                              <td style={td}><span style={{ ...pill('#B23A3A', '#fff'), border: '1px solid #F3D3DA', textTransform: 'capitalize' }}>{(v.status || 'open').replace(/_/g, ' ')}</span></td>
                              <td style={td}>{due ? <b style={{ fontWeight: 600, color: due.c }}>{due.t}</b> : <span style={{ color: FAINT }}>—</span>}</td>
                              <td style={{ ...td, color: owner ? SEC : FAINT }}>{owner || 'Unassigned'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: '7px 16px', fontSize: 11, color: MUTED }}>Row → full finding detail · <b>Priority·Contextual</b> = composite of exposure, exploit, EPSS &amp; asset criticality on top of CVSS.</div>
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}><Insights sevCounts={sevCounts} sevTotal={sevTotal} arcs={arcs} domains={domains} all={all} agg={agg} top10={top10} onView={onView} /></div>
              )}
            </div>
          </div>
          </>
          )}
        </>
      )}
      <style>{`.inv2 .vrow:hover{background:#F7FBFA}`}</style>
    </div>
  );
}

// ── Insights pane ──
function Insights({ sevCounts, sevTotal, arcs, domains, all, agg, top10, onView }: any) {
  const epssBuckets = [
    { label: '≥ 50%', n: all.filter((v: Vulnerability) => (v.epss_score ?? 0) >= 0.5).length, c: '#C2453F' },
    { label: '10–50%', n: all.filter((v: Vulnerability) => (v.epss_score ?? 0) >= 0.1 && (v.epss_score ?? 0) < 0.5).length, c: '#E0AF33' },
    { label: '1–10%', n: all.filter((v: Vulnerability) => (v.epss_score ?? 0) >= 0.01 && (v.epss_score ?? 0) < 0.1).length, c: '#17B898' },
    { label: '< 1%', n: all.filter((v: Vulnerability) => (v.epss_score ?? 0) < 0.01).length, c: '#AEB8C2' },
  ];
  const epssMax = Math.max(...epssBuckets.map((b) => b.n), 1);
  const domMax = Math.max(...(domains ?? []).map((d: any) => d.total), 1);
  const signals = [
    { label: 'In CISA KEV', n: agg.kev }, { label: 'Public exploit', n: all.filter(hasExploit).length },
    { label: 'With CVE', n: all.filter((v: Vulnerability) => !!v.cve_id).length }, { label: 'High EPSS (≥10%)', n: all.filter((v: Vulnerability) => (v.epss_score ?? 0) >= 0.1).length },
  ];
  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)', padding: '16px 18px' };
  return (
    <div>
      <div style={{ ...card, marginBottom: 12, background: 'linear-gradient(120deg,#EAFAF4,#fff 60%)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}><b style={{ fontSize: 14 }}>Raw severity ≠ real priority</b><span style={{ fontSize: 11.5, color: MUTED }}>of {agg.total} findings, only {agg.urgent} {agg.urgent === 1 ? 'is' : 'are'} truly urgent once exposure, exploit and EPSS are weighed</span></div>
        <div style={{ display: 'flex', height: 12, borderRadius: 99, overflow: 'hidden', background: '#EAEEF1', margin: '12px 0 9px' }}>
          {[['urgent', agg.urgent, '#C2453F'], ['moderate', agg.moderate, '#E0AF33'], ['low', agg.low, '#17B898']].map(([k, n, c]) => <i key={k as string} style={{ width: `${(Number(n) / Math.max(1, agg.total)) * 100}%`, background: c as string }} />)}
        </div>
      </div>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 12 }}>
        <div style={card}>
          <h3 style={{ fontSize: 13.5, margin: 0 }}>By severity <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 400 }}>raw CVSS</span></h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
            <svg width="104" height="104" viewBox="0 0 42 42">
              <circle cx="21" cy="21" r="15.9" fill="none" stroke="#EEF1F3" strokeWidth="6" />
              {arcs.map((a: any) => <circle key={a.k} cx="21" cy="21" r="15.9" fill="none" stroke={SEV[a.k as SevKey].dot} strokeWidth="6" strokeDasharray={`${a.len} ${100 - a.len}`} strokeDashoffset={a.off} />)}
              <text x="21" y="20.5" textAnchor="middle" fontSize="8" fontWeight="800" fill={INK}>{sevTotal}</text>
              <text x="21" y="26" textAnchor="middle" fontSize="2.8" letterSpacing=".08em" fill={FAINT}>TOTAL</text>
            </svg>
            <div style={{ flex: 1, fontSize: 12 }}>
              {sevCounts.map((s: any) => <div key={s.k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #F4F6F7' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: SEV[s.k as SevKey].dot, flex: 'none' }} />{SEV[s.k as SevKey].label}<b className="num" style={{ marginLeft: 'auto' }}>{s.n}</b></div>)}
            </div>
          </div>
        </div>
        <div style={card}>
          <h3 style={{ fontSize: 13.5, margin: 0 }}>By domain</h3>
          <div style={{ marginTop: 12, fontSize: 12 }}>
            {(domains ?? []).length === 0 ? <p style={{ color: FAINT, fontSize: 11 }}>No domain data yet.</p> : (domains ?? []).slice(0, 8).map((d: any) => (
              <div key={d.family} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}><span style={{ width: 120, color: SEC, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.family}>{d.family || 'General'}</span><span style={{ flex: 1, height: 8, background: '#F0F3F5', borderRadius: 4, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${(d.total / domMax) * 100}%`, background: SEV[normSev(d.worst_severity)].dot }} /></span><b className="num" style={{ width: 30, textAlign: 'right' }}>{d.total}</b></div>
            ))}
          </div>
        </div>
        <div style={card}>
          <h3 style={{ fontSize: 13.5, margin: 0 }}>Exploit likelihood <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 400 }}>EPSS</span></h3>
          <div style={{ marginTop: 14, fontSize: 11 }}>
            {epssBuckets.map((b) => <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}><span style={{ width: 60, color: SEC }}>{b.label}</span><span style={{ flex: 1, height: 8, background: '#F0F3F5', borderRadius: 4, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${(b.n / epssMax) * 100}%`, background: b.c }} /></span><b className="num" style={{ width: 30, textAlign: 'right' }}>{b.n}</b></div>)}
          </div>
        </div>
      </section>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: FAINT, margin: '18px 2px 8px' }}>Threat signals</div>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(118px,1fr))', gap: 10 }}>
        {signals.map((s) => <div key={s.label} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px', textAlign: 'center' }}><div className="num" style={{ fontSize: 20, fontWeight: 700, color: s.n > 0 ? INK : '#1F7A54' }}>{s.n}</div><div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{s.label}</div></div>)}
      </section>
      <div style={{ ...card, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}><h3 style={{ fontSize: 13.5, margin: 0 }}>Top 10 — fix these first</h3><span style={{ fontSize: 11, color: MUTED }}>ranked by composite priority · KEV = actively exploited</span></div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
            <thead><tr>{['#', 'Vuln', 'CVE', 'Priority', 'CVSS', 'EPSS'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {top10.map((v: Vulnerability, i: number) => { const sc = ctxScore(v); const bm = BAND_META[band(sc)]; return (
                <tr key={v.id} onClick={() => onView(v)} style={{ cursor: 'pointer' }} className="vrow">
                  <td style={{ ...td, fontFamily: MONO, color: FAINT }}>{i + 1}</td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 240 }}>{v.title}{v.kev_flag && <span style={{ ...pill('#C2453F', '#FBEAEA'), fontSize: 9, marginLeft: 6 }}>KEV</span>}</td>
                  <td style={{ ...td, fontFamily: MONO, color: v.cve_id ? SEC : FAINT }}>{v.cve_id || '—'}</td>
                  <td style={{ ...td, fontFamily: MONO, color: bm.c, fontWeight: 600 }}>{sc} · {bm.label}</td>
                  <td style={{ ...td, fontFamily: MONO }}>{v.cvss_score ?? '—'}</td>
                  <td style={{ ...td, fontFamily: MONO, color: FAINT }}>{v.epss_score != null ? `${(v.epss_score * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default VulnsWorkspace;
