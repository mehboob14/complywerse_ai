'use client';

/**
 * Finding detail — redesigned to the handoff mock ("Vulnerabilities.mock.html").
 * Shell (header + sticky rail + tabs) + Analysis + Exploit-Test, wired to the REAL
 * backend: getById + the per-asset exploitability engine (verdict + ATT&CK chain).
 *
 * The mock's A–H "scenarios" are NOT a switcher — they are the states the real
 * `exploitability(id, assetId)` engine returns. This screen renders whatever it
 * returns; there is no scenario picker. Analysis' score is the 7-signal composite
 * (matches backend priority.py); the reachability verdict/chain is the engine's.
 * Remediation / History / Notes reuse the existing real panels.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert, ShieldCheck, Biohazard, Shield, Lock, ChevronRight, Clock, Crosshair } from 'lucide-react';
import { vulnManagementApi, assetsApi, entityExtrasApi } from '@/lib/api';
import { exploitMaturity } from '../_components/RiskAnalysisPanel';
import RemediationPlanCard from '../_components/RemediationPlanCard';
import { shortenVulnTitle } from '../../_workspace/lib';
import { NotesPanel } from '@/components/shared/EntityExtras';
import { CreateIssueButton } from '@/components/issue-management/CreateIssueButton';

// ── mock palette ──
const AC = '#17B898', ACS = '#12A085', BORDER = '#E8ECEE', BORDER2 = '#F0F3F5', INK = '#0F1F2B', SEC = '#3A4653', MUTED = '#8A95A1', FAINT = '#AEB8C2';
const MONO = 'ui-monospace,Consolas,monospace';
const SEVMETA: Record<string, { c: string; bg: string; label: string }> = {
  critical: { c: '#C2453F', bg: '#FBEAEA', label: 'Critical' }, high: { c: '#C0682F', bg: '#FCEEE2', label: 'High' },
  medium: { c: '#9A6410', bg: '#FBF2DF', label: 'Medium' }, low: { c: '#1F7A54', bg: '#E7F5EE', label: 'Low' }, info: { c: '#6B7787', bg: '#EEF1F3', label: 'Info' },
};
const TONE = {
  red: { fg: '#B23A3A', bar: '#C2453F', bg: '#FBEAEA', soft: '#FDF3F3', Icon: Biohazard, verb: 'Likely exploitable' },
  amber: { fg: '#9A6410', bar: '#E0AF33', bg: '#FBF2DF', soft: '#FEFBF4', Icon: ShieldAlert, verb: 'Possibly exploitable' },
  green: { fg: '#1F7A54', bar: '#17B898', bg: '#E7F5EE', soft: '#F3FBF8', Icon: ShieldCheck, verb: 'Unlikely exploitable' },
  neutral: { fg: '#6B7787', bar: '#AEB8C2', bg: '#EEF1F3', soft: '#F7F9FA', Icon: Shield, verb: 'Undeterminable' },
} as const;
type ToneKey = keyof typeof TONE;
const verdictTone = (v?: string): ToneKey => (v === 'likely' ? 'red' : v === 'possible' ? 'amber' : v === 'unlikely' ? 'green' : 'neutral');
const normSev = (s?: string) => { const k = (s || '').toLowerCase(); return (k in SEVMETA ? k : 'info'); };

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)' };
const btn: React.CSSProperties = { border: `1px solid #E4E8EC`, background: '#fff', color: SEC, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' };
const pill = (c: string, bg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, color: c, background: bg });

// CVSS 3.x vector → per-metric label + factor (the "Before" card breakdown).
const CVSS_META: Record<string, Record<string, [string, string]>> = {
  AV: { N: ['Network', '×0.85'], A: ['Adjacent', '×0.62'], L: ['Local', '×0.55'], P: ['Physical', '×0.20'] },
  AC: { L: ['Low', '×0.77'], H: ['High', '×0.44'] },
  PR: { N: ['None', '×0.85'], L: ['Low', '×0.62'], H: ['High', '×0.27'] },
  UI: { N: ['None', '×0.85'], R: ['Required', '×0.62'] },
  S: { U: ['Unchanged', 'rule'], C: ['Changed', 'rule'] },
  C: { H: ['High', '×0.56'], L: ['Low', '×0.22'], N: ['None', '×0.00'] },
  I: { H: ['High', '×0.56'], L: ['Low', '×0.22'], N: ['None', '×0.00'] },
  A: { H: ['High', '×0.56'], L: ['Low', '×0.22'], N: ['None', '×0.00'] },
};
const CVSS_LABEL: Record<string, string> = { AV: 'Attack vector', AC: 'Attack complexity', PR: 'Privileges required', UI: 'User interaction', S: 'Scope', C: 'Confidentiality impact', I: 'Integrity impact', A: 'Availability impact' };
function parseCvss(vector: string): { label: string; value: string; mult: string }[] {
  if (!vector) return [];
  const parts: Record<string, string> = {};
  vector.split('/').forEach((p) => { const [k, val] = p.split(':'); if (k && val) parts[k] = val; });
  return ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'].filter((k) => parts[k] && CVSS_META[k]?.[parts[k]]).map((k) => ({ label: CVSS_LABEL[k], value: CVSS_META[k][parts[k]][0], mult: CVSS_META[k][parts[k]][1] }));
}
const sumPts = (rows: any[]) => rows.reduce((s, r) => s + r.pts, 0);

// ── 7-signal composite score (mirrors backend priority.py / handoff score.ts), from real fields ──
function computeScore(v: any, asset: any) {
  const cvss = v?.cvss_score ?? null;
  const epss = v?.epss_score ?? null;
  const vector = v?.cvss_vector || v?.nvd_cvss_vector || '';
  const hasExp = (v?.public_exploit_count ?? 0) > 0 || (v?.exploitdb_count ?? 0) > 0;
  const sevPts = cvss != null ? Math.round((cvss / 10) * 20) : 0;
  const epssPts = epss != null ? +(epss * 20).toFixed(1) : 0;
  const matPts = (v?.exploitdb_verified_count ?? 0) > 0 ? 15 : hasExp ? 6 : 0;
  const kevPts = v?.kev_flag ? 15 : 0;
  const avPts = /AV:N/.test(vector) ? 10 : 0;
  const exposurePts = asset?.internet_facing ? 10 : 0;
  const crit = asset?.criticality;
  const critPts = crit === 'critical' || crit === 'high' ? 10 : crit == null ? 5 : 3;
  const groups = [
    { key: 'severity', label: 'Severity — the flaw itself', c: '#6A54C9', rows: [
      { label: 'CVSS severity', evidence: cvss != null ? `CVSS ${cvss} / 10` : 'no CVSS stored', pts: sevPts, max: 20 },
    ] },
    { key: 'exploit', label: "Exploitability — likelihood it's used", c: '#C0682F', rows: [
      { label: 'Exploit probability', evidence: epss != null ? `EPSS ${(epss * 100).toFixed(1)}%` : 'not enriched', pts: epssPts, max: 20 },
      { label: 'Exploit maturity', evidence: exploitMaturity(v)?.label || (hasExp ? 'public exploit' : 'none'), pts: matPts, max: 15 },
      { label: 'Known exploited', evidence: v?.kev_flag ? 'on CISA KEV' : 'not in KEV', pts: kevPts, max: 15 },
    ] },
    { key: 'context', label: 'Context & reachability — on this host', c: '#2E63A8', rows: [
      { label: 'Attack vector (reachability)', evidence: /AV:N/.test(vector) ? 'network' : vector ? 'not network' : 'no vector', pts: avPts, max: 10 },
      { label: 'Internet exposure', evidence: asset?.internet_facing ? 'exposed' : asset ? 'internal only' : 'unknown', pts: exposurePts, max: 10 },
      { label: 'Asset criticality', evidence: crit ?? 'assumed medium', pts: critPts, max: 10 },
    ] },
  ];
  const contextual = Math.round(groups.flatMap((g) => g.rows).reduce((s, r) => s + r.pts, 0));
  const raw = cvss != null ? Math.round(cvss * 10) : null;
  const known = [asset?.internet_facing != null && !!asset, true, true, epss != null].filter(Boolean).length;
  return { raw, contextual, delta: raw != null ? raw - contextual : 0, groups, known };
}

export default function FindingDetail({ vulnId }: { vulnId: number }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'an' | 'rm' | 'ex' | 'hi' | 'no'>('an');

  const { data: v, isLoading } = useQuery({
    queryKey: ['vulnerability', vulnId],
    queryFn: async () => (await vulnManagementApi.vulnerabilities.getById(vulnId)).data as any,
  });
  const { data: assetLinks } = useQuery({
    queryKey: ['vuln-assets', vulnId],
    queryFn: async () => (await vulnManagementApi.assetLinks.list(vulnId)).data as any[],
  });
  const primaryAssetId: number | undefined = (assetLinks || [])[0]?.asset_id;
  const { data: riskAsset } = useQuery({
    queryKey: ['vuln-risk-asset', primaryAssetId],
    queryFn: async () => (await assetsApi.getDetail(primaryAssetId as number)).data as any,
    enabled: !!primaryAssetId,
  });
  const { data: reach } = useQuery({
    queryKey: ['exploitability', vulnId, primaryAssetId],
    queryFn: async () => (await vulnManagementApi.vulnerabilities.exploitability(vulnId, primaryAssetId as number)).data as any,
    enabled: !!primaryAssetId,
  });

  const { data: deptAssignments } = useQuery({
    queryKey: ['vuln-departments', vulnId],
    queryFn: async () => (await vulnManagementApi.departments.getVulnerabilityDepartments(vulnId)).data as any[],
  });

  const statusMut = useMutation({
    mutationFn: (status: string) => vulnManagementApi.vulnerabilities.changeStatus(vulnId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vulnerability', vulnId] }),
  });
  // Cycle the working statuses (the mock's "Change status" button); Accept risk is separate.
  const STATUS_CYCLE = ['open', 'in_progress', 'remediated', 'verified'];
  const cycleStatus = () => statusMut.mutate(STATUS_CYCLE[(STATUS_CYCLE.indexOf(v?.status || 'open') + 1) % STATUS_CYCLE.length]);

  if (isLoading || !v) {
    return <div className="inv2" style={{ margin: '-16px', minHeight: '100vh', background: '#F4F6F7', display: 'grid', placeItems: 'center' }}><span style={{ color: MUTED, fontSize: 13 }}>Loading finding…</span></div>;
  }

  const sev = normSev(v.severity); const sm = SEVMETA[sev];
  const status = (v.status || 'open').replace(/_/g, ' ');
  const score = computeScore(v, riskAsset);
  const vTone = TONE[verdictTone(reach?.verdict?.verdict)];

  const TABS: [typeof tab, string, boolean?][] = [['an', 'Analysis'], ['rm', 'Remediation'], ['ex', 'Exploit Test', true], ['hi', 'History'], ['no', 'Notes']];

  return (
    <div className="inv2" style={{ margin: '-16px', background: '#F4F6F7', minHeight: '100vh', padding: '10px 22px 40px', fontSize: 13.5, color: INK }}>
      <Link href="/vulnerabilities" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED, marginBottom: 8 }}><ArrowLeft size={14} />Back to register</Link>

      {/* header */}
      <div style={{ ...card, padding: '11px 16px', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: MUTED }}>VULN-{v.id}{v.cve_id ? ` · ${v.cve_id}` : ''}</div>
            <h1 style={{ fontSize: 16.5, letterSpacing: '-.02em', margin: '2px 0 0' }} title={v.title}>{shortenVulnTitle(v.title)}</h1>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
              <span style={pill(sm.c, sm.bg)}>{sm.label}</span>
              {v.cvss_score != null && <span style={pill(SEC, '#EEF1F3')}>CVSS {v.cvss_score}</span>}
              {v.kev_flag && <span style={pill('#C2453F', '#FBEAEA')}>KEV · exploited</span>}
              {v.epss_score != null && <span style={pill(SEC, '#EEF1F3')}>EPSS {(v.epss_score * 100).toFixed(1)}%</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...pill('#B23A3A', '#fff'), border: '1px solid #F3D3DA', textTransform: 'capitalize' }}>{status}</span>
            <button style={{ ...btn, background: AC, borderColor: AC, color: '#06342B', fontWeight: 600 }} onClick={() => setTab('rm')}>Start remediation</button>
            <button style={btn} onClick={() => statusMut.mutate('accepted')} disabled={statusMut.isPending}>Accept risk</button>
            <button style={btn} onClick={cycleStatus} disabled={statusMut.isPending}>Change status</button>
            <CreateIssueButton sourceType="vulnerability" sourceId={v.id} presetFields={{ title: `VULN-${v.id} — ${v.title}`, description: v.description || undefined, category: 'security' }} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 292px', gap: 14, alignItems: 'start' }}>
        {/* main */}
        <div style={{ minWidth: 0 }}>
          <div style={{ ...card, display: 'flex', gap: 2, padding: '0 8px', overflowX: 'auto', marginBottom: 10 }}>
            {TABS.map(([k, label, flag]) => (
              <button key={k} onClick={() => setTab(k)} style={{ flex: 'none', height: 36, padding: '0 12px', border: 0, background: 'none', fontSize: 12.5, fontWeight: tab === k ? 600 : 500, color: tab === k ? ACS : '#6B7787', borderBottom: tab === k ? `2px solid ${AC}` : '2px solid transparent', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: -1, cursor: 'pointer' }}>
                {label}{flag && <span style={{ ...pill('#12A085', '#E4F8F2'), fontSize: 9 }}>MITRE</span>}
              </button>
            ))}
          </div>

          {tab === 'an' && <Analysis v={v} asset={riskAsset} reach={reach} score={score} vTone={vTone} hasAsset={!!primaryAssetId} onExploit={() => setTab('ex')} />}
          {tab === 'ex' && <ExploitTest reach={reach} vTone={vTone} hasAsset={!!primaryAssetId} v={v} score={score} />}
          {tab === 'rm' && <div style={card}><RemediationPlanCard vulnId={vulnId} hasOwner={!!v.assigned_to} /></div>}
          {tab === 'hi' && <HistoryTimeline vulnId={vulnId} />}
          {tab === 'no' && <div style={card}><NotesPanel entityType="vulnerability" entityId={vulnId} /></div>}
        </div>

        {/* rail */}
        <aside style={{ position: 'sticky', top: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <RailCard title="Identity">
            <Row k="CWE" v={v.cwe_id || '—'} mono />
            <Row k="Severity" v={sm.label} />
            <Row k="CVSS vector" v={v.cvss_vector || v.nvd_cvss_vector || '—'} mono />
          </RailCard>
          <RailCard title="Timeline">
            <Row k="First seen" v={fmt(v.first_detected || v.created_at)} />
            <Row k="Last seen" v={fmt(v.last_seen)} />
            <Row k="Source" v={v.source || v.report_name || 'Scan'} />
          </RailCard>
          <RailCard title="Affected asset">
            {primaryAssetId ? (
              <>
                <b style={{ fontSize: 13, fontWeight: 600 }}>{riskAsset?.name || `Asset #${primaryAssetId}`}</b>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{riskAsset?.criticality ? `Criticality ${riskAsset.criticality}` : 'Criticality not set'}{riskAsset?.internet_facing ? ' · internet-facing' : ''}</div>
                <Link href={`/assets/${primaryAssetId}`} style={{ ...btn, textDecoration: 'none', width: '100%', justifyContent: 'center', marginTop: 10 }}>View asset details →</Link>
              </>
            ) : <div style={{ fontSize: 12, color: MUTED }}>No asset linked — link one to compute reachability.</div>}
          </RailCard>
          <RailCard title="Department assignments">
            {(deptAssignments?.length ?? 0) > 0
              ? deptAssignments!.map((d: any, i: number) => <Row key={d.id ?? d.department_id ?? i} k={d.department_name || d.name || 'Department'} v={d.priority || d.sla_override_days ? `${d.priority || ''}${d.sla_override_days ? ` · ${d.sla_override_days}d` : ''}`.trim() || 'assigned' : 'assigned'} />)
              : <div style={{ fontSize: 11.5, color: MUTED }}>No departments assigned — assign this finding to route remediation.</div>}
          </RailCard>
        </aside>
      </div>
    </div>
  );
}

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={card}><div style={{ padding: '11px 14px', borderBottom: `1px solid ${BORDER2}` }}><h4 style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>{title}</h4></div><div style={{ padding: '8px 14px 12px' }}>{children}</div></section>;
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, padding: '5px 0', borderBottom: `1px solid #F4F6F7` }}><span style={{ color: MUTED }}>{k}</span><b style={{ fontWeight: 600, textAlign: 'right', fontFamily: mono ? MONO : undefined, wordBreak: 'break-all' }}>{v}</b></div>;
}
function SrcBlock({ title, c, rows }: { title: string; c: string; rows: [string, string][] }) {
  return (
    <div style={{ border: `1px solid ${BORDER2}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', background: '#FAFBFC', borderBottom: `1px solid ${BORDER2}` }}><span style={{ width: 7, height: 7, borderRadius: 2, background: c, flex: 'none' }} /><b style={{ fontSize: 11.5, fontWeight: 600 }}>{title}</b></div>
      <div style={{ padding: '4px 12px 8px' }}>{rows.map(([k, val]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, padding: '4px 0' }}><span style={{ color: MUTED }}>{k}</span><b style={{ fontWeight: 600, textAlign: 'right', fontFamily: MONO, wordBreak: 'break-all' }}>{val}</b></div>)}</div>
    </div>
  );
}

// ── History tab — compact journalled timeline (mock: one short "Change history" card) ──
function HistoryTimeline({ vulnId }: { vulnId: number }) {
  const { data } = useQuery({
    queryKey: ['entity-history', 'vulnerability', vulnId],
    queryFn: async () => (await entityExtrasApi.history('vulnerability', vulnId)).data as any[],
  });
  const items = Array.isArray(data) ? data : [];
  return (
    <section style={{ ...card, padding: '15px 18px' }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Change history</div>
      {items.length === 0 ? (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: '#F7F9FA', padding: 18, textAlign: 'center', color: MUTED, fontSize: 12.5, marginTop: 10 }}>
          No changes recorded yet. Edits from here on are journalled and appear in this timeline.
        </div>
      ) : (
        <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
          {items.map((h, i) => (
            <li key={h.id ?? i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: i ? '1px solid #F4F6F7' : 'none' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: AC, flex: 'none', marginTop: 5 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: SEC, lineHeight: 1.45 }}><b style={{ fontWeight: 600, textTransform: 'capitalize' }}>{(h.action || 'updated').replace(/_/g, ' ')}</b>{h.detail ? ` — ${h.detail}` : ''}</div>
                <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1 }}>{h.actor_name || 'System'}{h.created_at ? ` · ${new Date(h.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ── Analysis tab ──
function Analysis({ v, asset, reach, score, vTone, hasAsset, onExploit }: any) {
  const [open, setOpen] = useState<Record<string, boolean>>({ severity: true, exploit: true, context: true });
  const vector = v.cvss_vector || v.nvd_cvss_vector || '';
  const factors = parseCvss(vector);
  const grp = score.groups;
  const signals = grp.flatMap((x: any) => x.rows); // the 7 exploitability signals, flat
  const sums = { sev: sumPts(grp[0].rows), exp: sumPts(grp[1].rows), reach: grp[2].rows[0]?.pts || 0, ctx: (grp[2].rows[1]?.pts || 0) + (grp[2].rows[2]?.pts || 0) };
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Before → After */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Before — CVSS alone */}
        <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px 6px' }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: '#EEEBFA', color: '#6A54C9', display: 'grid', placeItems: 'center', flex: 'none' }}><Clock size={17} /></span>
            <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 15 }}>Before</b><div style={{ fontSize: 11, color: MUTED }}>CVSS alone · the flaw in the abstract</div></div>
            <b className="num" style={{ fontSize: 30, fontWeight: 600, color: '#8A95A1' }}>{score.raw ?? '—'}</b>
          </div>
          <div style={{ padding: '0 16px 10px' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', color: FAINT, margin: '8px 0 4px' }}>CVSS VECTOR FACTORS</div>
            {factors.length ? factors.map((f) => (
              <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid #F7F9FA' }}>
                <span style={{ fontSize: 12, color: SEC }}>{f.label}</span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}><b style={{ fontSize: 12, fontWeight: 600, color: '#C2453F' }}>{f.value}</b><code style={{ fontFamily: MONO, fontSize: 10.5, color: FAINT, minWidth: 34, textAlign: 'right' }}>{f.mult}</code></span>
              </div>
            )) : <div style={{ fontSize: 11.5, color: MUTED }}>No CVSS vector stored for this finding.</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BORDER2}` }}>
              <code style={{ fontFamily: MONO, fontSize: 10, color: MUTED, wordBreak: 'break-all', flex: 1 }}>{vector || '—'}</code>
              <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: 'nowrap' }}>Total <b style={{ color: INK }}>{score.raw ?? '—'}</b> / 100</span>
            </div>
          </div>
        </section>
        {/* After — scored on this host */}
        <section style={{ ...card, padding: 0, overflow: 'hidden', border: '1px solid #CFF2E7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px 6px' }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: '#E4F8F2', color: '#12A085', display: 'grid', placeItems: 'center', flex: 'none' }}><Crosshair size={17} /></span>
            <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 15 }}>After</b><div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>scored on this host · {asset?.name || '—'}</div></div>
            {score.raw != null && score.delta !== 0 && <span style={{ ...pill('#1F7A54', '#E7F5EE'), fontSize: 10.5 }}>↓{score.delta}</span>}
            <b className="num" style={{ fontSize: 30, fontWeight: 600 }}>{score.contextual}</b>
          </div>
          <div style={{ padding: '0 16px 10px' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', color: FAINT, margin: '8px 0 4px' }}>EXPLOITABILITY SIGNALS</div>
            {signals.map((r: any) => { const raise = r.pts > 0; return (
              <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0,1fr) 66px 44px', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F7F9FA' }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: raise ? '#FCEEE2' : '#E7F5EE', color: raise ? '#C0682F' : '#1F7A54', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, flex: 'none' }}>{raise ? '↑' : '✓'}</span>
                <span style={{ minWidth: 0 }}><b style={{ fontSize: 12, fontWeight: 600 }}>{r.label}</b><code style={{ display: 'block', fontFamily: MONO, fontSize: 10, color: MUTED, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(r.evidence)}</code></span>
                <span style={{ height: 6, background: '#EEF1F3', borderRadius: 999, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${(r.pts / r.max) * 100}%`, background: raise ? '#C0682F' : '#AEB8C2' }} /></span>
                <span className="num" style={{ fontSize: 11, color: SEC, textAlign: 'right' }}>{r.pts}/{r.max}</span>
              </div>
            ); })}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BORDER2}`, fontSize: 11, color: MUTED, flexWrap: 'wrap' }}>
              <span>Severity <b style={{ color: INK }}>{Math.round(sums.sev)}</b> · Exploitability <b style={{ color: INK }}>{r1(sums.exp)}</b> · Reachability <b style={{ color: INK }}>{Math.round(sums.reach)}</b> · Context <b style={{ color: INK }}>{Math.round(sums.ctx)}</b></span>
              <span style={{ whiteSpace: 'nowrap' }}>Total <b style={{ color: INK }}>{score.contextual}</b> / 100</span>
            </div>
          </div>
        </section>
      </div>
      <p style={{ fontSize: 11, color: MUTED }}>{score.known} of 5 signals known · unknown signals are excluded from the score, not counted as zero — the number isn&apos;t artificially low.</p>

      {/* score groups */}
      {score.groups.map((g: any) => {
        const gp = g.rows.reduce((s: number, r: any) => s + r.pts, 0);
        return (
          <section key={g.key} style={card}>
            <button onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '12px 16px', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: g.c, flex: 'none' }} />
              <b style={{ fontSize: 12.5, flex: 1 }}>{g.label}</b>
              <span style={{ fontSize: 13, fontWeight: 700, color: g.c }}>+{Math.round(gp)}</span>
              <ChevronRight size={14} style={{ color: FAINT, transform: open[g.key] ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
            </button>
            {open[g.key] && (
              <div style={{ padding: '0 16px 12px' }}>
                {g.rows.map((r: any) => (
                  <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px 44px', gap: 12, alignItems: 'center', padding: '7px 0', borderTop: `1px solid ${BORDER2}` }}>
                    <span style={{ minWidth: 0 }}><b style={{ fontSize: 12, fontWeight: 600 }}>{r.label}</b><code style={{ display: 'block', fontFamily: MONO, fontSize: 10.5, color: MUTED, textTransform: 'capitalize' }}>{String(r.evidence)}</code></span>
                    <span style={{ height: 7, background: '#EEF1F3', borderRadius: 999, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${(r.pts / r.max) * 100}%`, background: g.c }} /></span>
                    <span className="num" style={{ fontSize: 11.5, color: SEC, textAlign: 'right' }}>{r.pts}/{r.max}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <button onClick={onExploit} style={{ ...card, padding: '12px 16px', textAlign: 'left', cursor: 'pointer', fontSize: 12, color: SEC }}>
        Why is exposure scored {asset?.internet_facing ? 'up' : '0'}? See the reachability verdict on <b style={{ color: ACS }}>Exploit Test →</b>
      </button>

      {/* Data by source — provenance; the one place raw source values live */}
      <details style={card}>
        <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '12px 16px', fontSize: 12.5, fontWeight: 600 }}>Data by source — every value, grouped by its authority</summary>
        <div style={{ padding: '0 16px 14px', display: 'grid', gap: 10 }}>
          <SrcBlock title="Scanner" c="#2E63A8" rows={[['CVSS', v.cvss_score != null ? `${v.cvss_score} / 10` : '—'], ['Affected', v.affected_component || v.plugin_family || '—'], ['First detected', fmt(v.first_detected || v.created_at)]]} />
          <SrcBlock title="NVD" c="#6A54C9" rows={[['CVE', v.cve_id || '—'], ['CVSS vector', v.cvss_vector || v.nvd_cvss_vector || '—'], ['Published', fmt(v.nvd_published_at)]]} />
          <SrcBlock title="EPSS · FIRST.org" c="#9A6410" rows={[['Probability', v.epss_score != null ? `${(v.epss_score * 100).toFixed(1)}%` : 'not enriched'], ['Percentile', v.epss_percentile != null ? `${Math.round(v.epss_percentile * 100)}th` : '—']]} />
          <SrcBlock title="CISA KEV" c="#C2453F" rows={[['Listed', v.kev_flag ? 'Yes' : 'No'], ['Date added', fmt(v.kev_date_added)]]} />
          <SrcBlock title="Exploit intel" c="#C0682F" rows={[['Exploit-DB', String(v.exploitdb_count ?? 0)], ['Public exploits', String(v.public_exploit_count ?? 0)], ['Maturity', exploitMaturity(v)?.label || '—']]} />
        </div>
      </details>
    </div>
  );
}

// ── Exploit-Test tab (real engine: verdict + ATT&CK spine) ──
function ExploitTest({ reach: d, vTone, hasAsset, v, score }: any) {
  const [sub, setSub] = useState<'reach' | 'decided' | 'chain' | 'proof'>('reach');
  if (!hasAsset) {
    return <div style={{ ...card, borderLeft: '4px solid #E0AF33', background: '#FEFBF4', padding: '18px' }}><b style={{ fontSize: 14, color: '#9A6410' }}>Exploitability can&apos;t be assessed yet</b><p style={{ fontSize: 12.5, color: '#7A6427', marginTop: 6, lineHeight: 1.55 }}>This finding isn&apos;t linked to any asset, so reachability can&apos;t be derived. Link an affected asset and the attack-path assessment populates from live data.</p></div>;
  }
  if (!d) {
    return <div style={{ ...card, padding: 24, color: MUTED, fontSize: 13 }}>Computing the attack path…</div>;
  }
  const VIcon = vTone.Icon;
  const chain: any[] = d.chain || [];
  const spine: any[] = d.tactic_spine || [];
  const byTactic: Record<string, any[]> = {};
  for (const c of chain) (byTactic[c.tactic] ||= []).push(c);
  const stageStatus = (s: any) => s.status || (byTactic[s.shortname]?.length ? 'reached' : 'not_applicable');
  // GATED kill-chain, drawn as the attacker's REAL steps in order — only the stages that
  // actually have a technique, numbered consecutively (1,2,3…). Empty tactics are NOT drawn:
  // a "no technique here" filler row between two real steps reads as a gap/jump. Skipped
  // tactics simply aren't shown. Gating is preserved: the break is the first unreachable
  // mapped stage (e.g. Initial Access blocked when the host isn't internet-facing); from there
  // the chain is severed and every later step is locked with its reason.
  const visible = spine.filter((s) => stageStatus(s) !== 'not_applicable');
  const omitted = spine.filter((s) => stageStatus(s) === 'not_applicable');
  const mappedCount = visible.length;
  const breakIdx = visible.findIndex((s) => stageStatus(s) === 'unreachable');   // first stage the attacker can't reach
  const severed = breakIdx >= 0;
  const reached = visible.filter((s) => stageStatus(s) === 'reached').length;
  const STAT: Record<string, { c: string; label: string }> = { likely: { c: '#C2453F', label: 'LIKELY' }, possible: { c: '#E0AF33', label: 'POSSIBLE' }, blocked: { c: '#AEB8C2', label: 'BLOCKED' }, severed: { c: '#AEB8C2', label: 'SEVERED' } };
  const sig = d.signals || {}; const evi = d.evidence || {};
  const proofCount = (v?.public_exploit_count ?? 0) + (v?.exploitdb_count ?? 0);
  const exploitRefs: any[] = Array.isArray(v?.public_exploit_refs) ? v.public_exploit_refs : [];
  const avWord = ({ N: 'Network', A: 'Adjacent', L: 'Local', P: 'Physical' } as any)[sig.cvss_av] || sig.cvss_av || 'unknown';
  const mapSrc = d.mapping_generic ? 'CVSS vector (generic — no CWE)' : (chain[0]?.mapping_source || 'CAPEC / ATT&CK').replace(/_/g, ' ');
  // No CWE ⇒ the chain is the coarse CVSS-vector backbone (identical for every finding of
  // the same shape), NOT a finding-specific path. Say so plainly so a generic/informational
  // result never reads as a bespoke analysis — the "why does every finding look the same" fix.
  const isInfo = normSev(v?.severity) === 'info';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* sub-tabs — the mock's Reachability / How it decided / Chain / Proof */}
      <div style={{ display: 'inline-flex', background: '#EAEEF1', borderRadius: 10, padding: 3, gap: 2, flexWrap: 'wrap', alignSelf: 'flex-start' }}>
        {([['reach', 'Reachability'], ['decided', 'How it decided'], ['chain', `Chain${chain.length ? ` · ${chain.length}` : ''}`], ['proof', `Proof${proofCount ? ` · ${proofCount}` : ''}`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)} style={{ height: 30, padding: '0 13px', border: 0, borderRadius: 8, background: sub === k ? '#fff' : 'none', color: sub === k ? ACS : '#6B7787', fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: sub === k ? '0 1px 2px rgba(16,24,40,.06)' : 'none' }}>{label}</button>
        ))}
      </div>

      {sub === 'reach' && (<>
      {/* No-CWE honesty banner — the chain below is a generic baseline, not a per-finding path */}
      {d.mapping_generic && (
        <section style={{ ...card, borderLeft: '4px solid #E0AF33', background: '#FEFBF4', padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={16} color="#9A6410" />
            <b style={{ fontSize: 13.5, color: '#9A6410' }}>{isInfo ? 'Informational finding — not a specific vulnerability' : 'Generic baseline — no weakness class mapped'}</b>
          </div>
          <p style={{ fontSize: 12.5, color: '#7A6427', marginTop: 6, lineHeight: 1.55 }}>
            {isInfo
              ? 'This is an informational scanner result (a detected service, protocol, or software fact), not an exploitable weakness. It carries no CWE, so there is no finding-specific attack path — every informational result shows this same baseline.'
              : <>No CWE is recorded for this finding, so the chain below is <b>not derived from this specific flaw</b> — it&apos;s the generic baseline for {sig.cvss_av ? <>any <b>{String(avWord).toLowerCase()}-reachable</b> finding</> : 'a finding with no weakness data'}. That is why it reads the same across findings of this shape. Findings <b>with</b> a mapped CWE (CVE-classed vulnerabilities) show a technique path specific to their weakness here.</>}
          </p>
        </section>
      )}
      {/* verdict hero */}
      <section style={{ ...card, borderLeft: `4px solid ${vTone.bar}`, background: vTone.soft, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, background: '#fff', display: 'grid', placeItems: 'center', color: vTone.fg, flex: 'none' }}><VIcon size={21} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><b style={{ fontSize: 19, color: vTone.fg }}>{vTone.verb}</b>{d.verdict?.viability && <span style={{ ...pill(vTone.fg, '#fff'), border: `1px solid ${vTone.bar}` }}>{String(d.verdict.viability).toUpperCase()}</span>}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>assessed on <b style={{ color: SEC }}>{d.asset?.name || 'the affected asset'}</b>{d.attack_version ? ` · ATT&CK v${d.attack_version}` : ''}</div>
          </div>
          {score?.contextual != null && <div style={{ textAlign: 'right' }}><b className="num" style={{ fontSize: 24, color: vTone.fg }}>{score.contextual}</b>{score.raw != null && score.delta !== 0 && <span style={{ fontSize: 11, color: MUTED, marginLeft: 6 }}>↓{score.delta} vs raw {score.raw}</span>}</div>}
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap', fontSize: 11, color: MUTED }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>signal {d.verdict?.signal_pct ?? 0}%<span style={{ width: 96, height: 6, background: '#EEF1F3', borderRadius: 999, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${d.verdict?.signal_pct ?? 0}%`, background: vTone.bar }} /></span></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>data {d.verdict?.data_completeness ?? 0}%<span style={{ width: 96, height: 6, background: '#EEF1F3', borderRadius: 999, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${d.verdict?.data_completeness ?? 0}%`, background: '#8A95A1' }} /></span></span>
        </div>
        <p style={{ fontSize: 12.5, color: SEC, marginTop: 10, lineHeight: 1.55 }}>{d.verdict?.verdict_reason}</p>
      </section>

      {/* attack chain spine */}
      <section style={{ ...card, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>Attack path — the chain</b>
          <span style={{ fontSize: 11.5, color: FAINT }}>MITRE ATT&amp;CK · the stages in play</span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: MUTED }}><b style={{ color: SEC }}>{reached} of {mappedCount}</b> reached{severed && visible[breakIdx] && <> · <b style={{ color: '#C2453F' }}>stops at {visible[breakIdx].name}</b></>}</span>
        </div>
        {chain.length === 0 ? (
          <div style={{ border: `1px solid ${BORDER}`, background: '#FAFBFC', borderRadius: 10, padding: 16, fontSize: 12.5, color: SEC, lineHeight: 1.55 }}>No ATT&amp;CK techniques mapped for this finding — a data condition, not a verdict. It does <b>not</b> mean the finding is unexploitable.</div>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {visible.map((st: any, i: number) => {
              const techs = byTactic[st.shortname] || [];
              const stStatus = stageStatus(st);                    // reached | unreachable | not_applicable
              const empty = stStatus === 'not_applicable';
              const isBreak = severed && i === breakIdx;           // the door that's shut — the gate
              const beyond = severed && i > breakIdx;              // severed, downstream of the break
              const unreachable = stStatus === 'unreachable' || (empty && beyond);
              const reachedStage = stStatus === 'reached';
              const dashed = empty && !unreachable;                // a reachable stage the flaw simply doesn't touch
              const last = i === visible.length - 1;
              const circleBg = isBreak ? '#C2453F' : reachedStage ? AC : unreachable ? '#EEF1F3' : dashed ? '#F4F6F8' : '#CFD6DC';
              return (
                <li key={st.shortname} style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
                    <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: dashed ? '#B9C2CC' : (unreachable && !isBreak) ? '#8A95A1' : '#fff', background: circleBg, border: dashed ? '1px dashed #D4DBE1' : 'none' }}>{unreachable && !isBreak ? <Lock size={11} color="#8A95A1" /> : i + 1}</span>
                    {!last && <span style={{ width: 2, flex: 1, minHeight: empty ? 10 : 16, margin: '4px 0', background: reachedStage ? '#9FE3D2' : '#E4E8EC', borderRadius: 2 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : empty ? 8 : 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', color: reachedStage ? SEC : FAINT }}>{st.name}</span>
                      {isBreak && <span style={{ ...pill('#C2453F', '#FBEAEA'), fontSize: 9 }}>STOPS HERE</span>}
                      {beyond && !empty && <span style={{ ...pill('#8A95A1', '#EEF1F3'), fontSize: 9 }}><Lock size={9} />unreachable</span>}
                    </div>
                    {empty ? (
                      <div style={{ fontSize: 11, color: FAINT, marginTop: 2, fontStyle: 'italic' }}>{unreachable ? 'unreachable — the chain is severed before this stage' : 'no ATT&CK technique at this stage'}</div>
                    ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 7 }}>
                      {techs.map((c: any) => { const stt = STAT[c.status] || STAT.blocked; return (
                        <div key={c.technique_id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${BORDER}`, borderRadius: 9, padding: '6px 10px', background: unreachable ? '#FAFBFC' : '#fff' }} title={c.why || ''}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: stt.c, flex: 'none' }} />
                          <code style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>{c.technique_id}</code>
                          <span style={{ fontSize: 12, fontWeight: 500, color: unreachable ? FAINT : '#1F2A33', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', color: stt.c }}>{stt.label}</span>
                        </div>
                      ); })}
                    </div>
                    )}
                    {isBreak && (st.reason) && <p style={{ fontSize: 12, color: '#B23A3A', background: '#FDF3F3', border: '1px solid #F3D3DA', borderRadius: 9, padding: '7px 10px', marginTop: 8, lineHeight: 1.5 }}><b>Chain stops here.</b> {st.reason}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {omitted.length > 0 && chain.length > 0 && <p style={{ fontSize: 11, color: FAINT, marginTop: 10, borderTop: `1px solid ${BORDER2}`, paddingTop: 10 }}><b style={{ color: MUTED }}>{omitted.length} ATT&amp;CK {omitted.length === 1 ? 'stage' : 'stages'} omitted</b> ({omitted.map((s: any) => s.name).join(', ')}) — no technique this finding&apos;s weakness maps to there.</p>}
        <p style={{ fontSize: 11, color: MUTED, marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Shield size={12} /> Nothing was executed — this reads stored evidence only. BLOCKED shows only on a known disqualifying fact; missing data stays POSSIBLE.</p>
      </section>
      </>)}

      {sub === 'decided' && (
        <section style={{ ...card, padding: '12px 16px' }}>
          <b style={{ fontSize: 14 }}>How it decided</b>
          <div style={{ fontSize: 11.5, color: FAINT, marginBottom: 14 }}>classify → map → judge this host → verdict · read from stored evidence, nothing executed</div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              ['Classified the weakness', `${v?.cwe_id || 'no CWE'}${v?.cve_id ? ` · ${v.cve_id}` : ''} — the flaw class that decides which techniques could apply.`],
              ['Mapped to ATT&CK', `${chain.length} technique${chain.length === 1 ? '' : 's'} via ${mapSrc}, dropped onto the kill-chain spine in tactic order.`],
              ['Judged on this host', `exposure ${sig.internet_exposed == null ? 'unknown' : sig.internet_exposed ? 'internet-facing' : 'internal only'} · attack vector ${avWord} · KEV ${evi.kev ? 'listed' : 'not listed'} · public exploit ${proofCount > 0 ? 'exists' : 'none found'}.`],
              ['Verdict', `${vTone.verb} — ${d.verdict?.verdict_reason || 'rolled up from the reachable stages.'}`],
            ].map(([t, body], i) => (
              <li key={t} style={{ display: 'flex', gap: 12 }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#E4F8F2', color: '#12A085', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flex: 'none' }}>{i + 1}</span>
                <div><b style={{ fontSize: 12.5 }}>{t}</b><p style={{ fontSize: 12, color: SEC, marginTop: 2, lineHeight: 1.5 }}>{body}</p></div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {sub === 'chain' && (
        <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '13px 16px', borderBottom: `1px solid ${BORDER2}` }}><b style={{ fontSize: 13.5 }}>Attack chain — all mapped techniques</b></div>
          {chain.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: MUTED }}>No techniques mapped for this finding.</div> : (
            <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
              <thead><tr>{['Technique', 'Name', 'Tactic', 'Status'].map((h) => <th key={h} style={{ textAlign: 'left', fontSize: 9.5, letterSpacing: '.05em', textTransform: 'uppercase', color: FAINT, fontWeight: 600, padding: '9px 14px', borderBottom: `1px solid ${BORDER}` }}>{h}</th>)}</tr></thead>
              <tbody>{chain.map((c: any) => { const stt = STAT[c.status] || STAT.blocked; return (
                <tr key={c.technique_id}><td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER2}`, fontFamily: MONO, fontSize: 11.5, color: MUTED }}>{c.technique_id}</td><td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER2}`, fontSize: 12.5 }}>{c.name}</td><td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER2}`, fontSize: 11.5, color: SEC }}>{c.tactic_name || c.tactic || '—'}</td><td style={{ padding: '9px 14px', borderBottom: `1px solid ${BORDER2}` }}><span style={{ fontSize: 9.5, fontWeight: 700, color: stt.c }}>{stt.label}</span></td></tr>
              ); })}</tbody>
            </table></div>
          )}
        </section>
      )}

      {sub === 'proof' && (
        <section style={{ ...card, padding: '12px 16px' }}>
          <b style={{ fontSize: 14 }}>Proof &amp; evidence</b>
          <div style={{ fontSize: 11.5, color: FAINT, marginBottom: 12 }}>what backs the verdict — recorded, not executed</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
            {[
              ['CISA KEV', evi.kev ? 'Listed — exploited in the wild' : 'Not listed', !!evi.kev],
              ['Public exploit', proofCount > 0 ? `${proofCount} reference${proofCount === 1 ? '' : 's'}` : 'None found', proofCount > 0],
              ['Exploit-DB', String(v?.exploitdb_count ?? 0), (v?.exploitdb_count ?? 0) > 0],
              ['EPSS', v?.epss_score != null ? `${(v.epss_score * 100).toFixed(1)}%` : 'n/a', (v?.epss_score ?? 0) >= 0.1],
            ].map(([t, val, hot]) => (
              <div key={t as string} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 12px' }}><div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: MUTED }}>{t as string}</div><div style={{ fontSize: 13, fontWeight: 600, color: hot ? '#B23A3A' : INK, marginTop: 3 }}>{val as string}</div></div>
            ))}
          </div>
          {exploitRefs.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: FAINT, marginBottom: 6 }}>Public exploit references</div>
              {exploitRefs.slice(0, 6).map((r: any, i: number) => (
                <a key={i} href={r.url} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 12, color: ACS, padding: '4px 0', borderBottom: '1px solid #F7F9FA', textDecoration: 'none' }}>{r.full_name || r.url}{r.stars != null ? ` · ★${r.stars}` : ''}</a>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11, color: MUTED, marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Shield size={12} /> Nothing was executed — this is stored evidence only.</p>
        </section>
      )}
    </div>
  );
}
