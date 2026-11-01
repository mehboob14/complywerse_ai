'use client';

/**
 * Finding detail — redesigned to the handoff mock ("Vulnerabilities.mock.html").
 * Shell (header + sticky rail + tabs) + Analysis + Exploit-Test.
 *
 * Exploitability is SYNCED to the pentest-AI engine — NOT the vuln-management CVSS
 * heuristic: the verdict is the finding's persisted pentest `exploit_status`
 * (collapsed by the one canonical mapping → exploit_verdict), and the MITRE
 * techniques/tactics + attack-path chain + narrative come from the SAME read-only
 * pentest intel endpoint the pentest run's "Attack path" modal calls
 * (POST /pentest/exploit-intel/{asset_id}). So this surface and the pentest run
 * show one truth for the same finding. A finding the pentest engine never
 * classified shows an honest "not assessed" state, never a fabricated verdict.
 * Analysis' numeric score stays the 7-signal priority composite; its verdict chip
 * is the same pentest verdict as the Exploit Test tab. Remediation / History /
 * Notes reuse the existing real panels; the Exception tab drives the real
 * exception FSM (services/vuln_exception.py).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert, ShieldCheck, Biohazard, Shield, ChevronRight, Clock, Crosshair, Globe, Network, FileText, ListOrdered, Bug } from 'lucide-react';
import apiClient, { vulnManagementApi, assetsApi, entityExtrasApi } from '@/cyber-assurance/lib/api';
import { exploitMaturity } from '../_components/RiskAnalysisPanel';
import RemediationPlanCard from '../_components/RemediationPlanCard';
import ItsmPanel from '../_components/ItsmPanel';
import HelpDeskLinkCard from '../_components/HelpDeskLinkCard';
import { shortenVulnTitle, assessmentType } from '../../_workspace/lib';
import { NotesPanel } from '@/cyber-assurance/components/shared/EntityExtras';
import { AuditFindingTags } from '@/components/audit-register/AuditFindingTags';
import { CustomValuesEditor, hasCustomFields, useModuleSettings } from '@/components/settings/CustomFields';
import { KillChainList, exploitVerdict, EXPLOIT_VERDICT_LABEL, classLabel, type ExploitVerdictKey } from '../../../pentest/_evidence';

// ── mock palette ──
const AC = '#005B96', ACS = '#014A81', BORDER = '#E8ECEE', BORDER2 = '#F0F3F5', INK = '#0F1F2B', SEC = '#3A4653', MUTED = '#8A95A1', FAINT = '#AEB8C2';
const MONO = 'ui-monospace,Consolas,monospace';
const SEVMETA: Record<string, { c: string; bg: string; label: string }> = {
  critical: { c: '#C2453F', bg: '#FBEAEA', label: 'Critical' }, high: { c: '#C0682F', bg: '#FCEEE2', label: 'High' },
  medium: { c: '#9A6410', bg: '#FBF2DF', label: 'Medium' }, low: { c: '#1F7A54', bg: '#E7F5EE', label: 'Low' }, info: { c: '#6B7787', bg: '#EEF1F3', label: 'Info' },
};
// Verdict tone keyed by the SINGLE pentest-AI verdict (pentest/_evidence
// exploitVerdict) — not the old CVSS likely/possible/unlikely. One tone map, so
// the Analysis and Exploit Test tabs render the identical verdict + colour.
const TONE: Record<ExploitVerdictKey, { fg: string; bar: string; bg: string; soft: string; Icon: any; verb: string }> = {
  'exploitable': { fg: '#B23A3A', bar: '#C2453F', bg: '#FBEAEA', soft: '#FDF3F3', Icon: Biohazard, verb: EXPLOIT_VERDICT_LABEL['exploitable'] },
  'likely': { fg: '#9A6410', bar: '#E0AF33', bg: '#FBF2DF', soft: '#FEFBF4', Icon: ShieldAlert, verb: EXPLOIT_VERDICT_LABEL['likely'] },
  'not-exploitable': { fg: '#1F7A54', bar: '#1F7A54', bg: '#E7F5EE', soft: '#F3FBF8', Icon: ShieldCheck, verb: EXPLOIT_VERDICT_LABEL['not-exploitable'] },
  'not-assessed': { fg: '#6B7787', bar: '#AEB8C2', bg: '#EEF1F3', soft: '#F7F9FA', Icon: Shield, verb: EXPLOIT_VERDICT_LABEL['not-assessed'] },
};
// The finding's canonical verdict key: prefer the backend-computed exploit_verdict,
// fall back to mapping exploit_status locally (older cached rows / defensive).
const verdictKeyOf = (v: any): ExploitVerdictKey =>
  ((v?.exploit_verdict as ExploitVerdictKey) || exploitVerdict(v?.exploit_status));
const normSev = (s?: string) => { const k = (s || '').toLowerCase(); return (k in SEVMETA ? k : 'info'); };

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)' };
const btn: React.CSSProperties = { border: `1px solid #E4E8EC`, background: '#fff', color: SEC, borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' };
const pill = (c: string, bg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, color: c, background: bg });

// CVSS 3.x vector → per-metric label + factor (the "Before" card breakdown).
const CVSS_META: Record<string, Record<string, [string, string]>> = {
  AV: { N: ['Network', '×0.85'], A: ['Adjacent', '×0.62'], L: ['Local', '×0.55'], P: ['Physical', '×0.20'] },
  AC: { L: ['Low', '×0.77'], M: ['Medium', '×0.61'], H: ['High', '×0.44'] }, // M is CVSS v2
  Au: { N: ['None', '×0.70'], S: ['Single', '×0.56'], M: ['Multiple', '×0.45'] }, // CVSS v2 Authentication
  PR: { N: ['None', '×0.85'], L: ['Low', '×0.62'], H: ['High', '×0.27'] },
  UI: { N: ['None', '×0.85'], R: ['Required', '×0.62'] },
  S: { U: ['Unchanged', 'rule'], C: ['Changed', 'rule'] },
  C: { H: ['High', '×0.56'], L: ['Low', '×0.22'], N: ['None', '×0.00'], C: ['Complete', '×0.66'], P: ['Partial', '×0.28'] },
  I: { H: ['High', '×0.56'], L: ['Low', '×0.22'], N: ['None', '×0.00'], C: ['Complete', '×0.66'], P: ['Partial', '×0.28'] },
  A: { H: ['High', '×0.56'], L: ['Low', '×0.22'], N: ['None', '×0.00'], C: ['Complete', '×0.66'], P: ['Partial', '×0.28'] },
};
const CVSS_LABEL: Record<string, string> = { AV: 'Attack vector', AC: 'Attack complexity', Au: 'Authentication', PR: 'Privileges required', UI: 'User interaction', S: 'Scope', C: 'Confidentiality impact', I: 'Integrity impact', A: 'Availability impact' };
function parseCvss(vector: string): { label: string; value: string; mult: string }[] {
  if (!vector) return [];
  const parts: Record<string, string> = {};
  vector.split('/').forEach((p) => { const [k, val] = p.split(':'); if (k && val) parts[k] = val; });
  return ['AV', 'AC', 'Au', 'PR', 'UI', 'S', 'C', 'I', 'A'].filter((k) => parts[k] && CVSS_META[k]?.[parts[k]]).map((k) => ({ label: CVSS_LABEL[k], value: CVSS_META[k][parts[k]][0], mult: CVSS_META[k][parts[k]][1] }));
}
const sumPts = (rows: any[]) => rows.reduce((s, r) => s + r.pts, 0);

// ── 7-signal composite score (mirrors backend priority.py / handoff score.ts), from real fields ──
function computeScore(v: any, asset: any) {
  const cvss = v?.cvss_score ?? null;
  // Before needs a severity floor when no numeric CVSS is stored (pentest / non-CVE
  // findings), else "Before" renders blank. Band midpoints per CVSS v3.1 severity.
  const SEV_CVSS: Record<string, number> = { critical: 9.5, high: 8, medium: 5.5, low: 2, info: 0 };
  const cvssEff = cvss ?? SEV_CVSS[normSev(v?.severity)];
  const epss = v?.epss_score ?? null;
  const vector = v?.cvss_vector || v?.nvd_cvss_vector || '';
  const hasExp = (v?.public_exploit_count ?? 0) > 0 || (v?.exploitdb_count ?? 0) > 0;
  const sevPts = Math.round((cvssEff / 10) * 20);
  const epssPts = epss != null ? +(epss * 20).toFixed(1) : 0;
  const matPts = (v?.exploitdb_verified_count ?? 0) > 0 ? 15 : hasExp ? 6 : 0;
  const kevPts = v?.kev_flag ? 15 : 0;
  const avPts = /AV:N/.test(vector) ? 10 : 0;
  const exposurePts = asset?.internet_facing ? 10 : 0;
  const crit = asset?.criticality;
  const critPts = crit === 'critical' || crit === 'high' ? 10 : crit == null ? 5 : 3;
  const groups = [
    { key: 'severity', label: 'Severity — the flaw itself', c: '#6A54C9', rows: [
      { label: 'CVSS severity', evidence: cvss != null ? `CVSS ${cvss} / 10` : `est. ${cvssEff}/10 · ${SEVMETA[normSev(v?.severity)].label} severity (no CVSS)`, pts: sevPts, max: 20 },
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
  const raw = Math.round(cvssEff * 10);
  const known = [asset?.internet_facing != null && !!asset, true, true, epss != null].filter(Boolean).length;
  return { raw, contextual, delta: raw - contextual, rawEstimated: cvss == null, groups, known };
}

export default function FindingDetail({ vulnId }: { vulnId: number }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'an' | 'rm' | 'ex' | 'hi' | 'no' | 'xc'>('an');

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
  // SOURCE OF TRUTH: the pentest-AI attack-path intel — the SAME read-only endpoint
  // the pentest "Attack path" modal calls (POST /pentest/exploit-intel/{asset_id}).
  // It returns the MITRE kill_chain + techniques/tactics + narrative + the finding's
  // exploit_status/exploit_verdict. The vuln-management CVSS exploitability engine is
  // no longer consulted here, so this surface and the pentest run show one truth.
  const intel = useQuery({
    queryKey: ['pentest', 'exploit-intel', primaryAssetId, vulnId],
    queryFn: async () => (await apiClient.post(`/pentest/exploit-intel/${primaryAssetId}`,
      { finding: { id: vulnId, finding_id: vulnId, title: v?.title, cve_id: v?.cve_id, severity: v?.severity } })).data as any,
    enabled: !!primaryAssetId && !!v,
    staleTime: 5 * 60 * 1000,   // backend caches per tenant/asset/finding — don't re-ask on every open
    retry: false,
  });

  const { data: deptAssignments } = useQuery({
    queryKey: ['vuln-departments', vulnId],
    queryFn: async () => (await vulnManagementApi.departments.getVulnerabilityDepartments(vulnId)).data as any[],
  });
  // Assign-owner control — the redesign dropped it; without an owner the plan can't
  // be Approved. Reuses the tenant-users list + the existing assign mutation.
  const { data: tenantUsers } = useQuery({
    queryKey: ['vuln-tenant-users'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data as any[],
  });
  const [assignPick, setAssignPick] = useState('');
  const assignMut = useMutation({
    mutationFn: (userId: number) => vulnManagementApi.vulnerabilities.assign(vulnId, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vulnerability', vulnId] }); setAssignPick(''); },
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
  // The one canonical verdict (pentest exploit_status), shared by both tabs.
  const verdictKey = verdictKeyOf(v);
  const vTone = TONE[verdictKey];

  const TABS: [typeof tab, string, boolean?][] = [['an', 'Analysis'], ['rm', 'Remediation'], ['ex', 'Exploit Test', true], ['hi', 'History'], ['no', 'Notes'], ['xc', 'Exception']];

  return (
    <div className="inv2" style={{ margin: '-16px', background: '#F4F6F7', minHeight: '100vh', padding: '10px 22px 40px', fontSize: 13.5, color: INK }}>
      <Link href="/cyber-assurance/vulnerabilities?tab=vulnerabilities" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED, marginBottom: 8 }}><ArrowLeft size={14} />Back to register</Link>

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
              {v.scan_mode === 'surface' && <span style={pill(MUTED, '#EEF1F3')}>Surface / Unauthenticated</span>}
              {v.scan_mode === 'credentialed' && <span style={pill(AC, '#EFF5FA')}>Authenticated</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...pill('#B23A3A', '#fff'), border: '1px solid #F3D3DA', textTransform: 'capitalize' }}>{status}</span>
            <button style={{ ...btn, background: AC, borderColor: AC, color: '#06342B', fontWeight: 600 }} onClick={() => setTab('rm')}>Start remediation</button>
            <button style={btn} onClick={() => statusMut.mutate('accepted')} disabled={statusMut.isPending}>Accept risk</button>
            <button style={btn} onClick={cycleStatus} disabled={statusMut.isPending}>Change status</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 292px', gap: 14, alignItems: 'start' }}>
        {/* main */}
        <div style={{ minWidth: 0 }}>
          <div style={{ ...card, display: 'flex', gap: 2, padding: '0 8px', overflowX: 'auto', marginBottom: 10 }}>
            {TABS.map(([k, label, flag]) => (
              <button key={k} onClick={() => setTab(k)} style={{ flex: 'none', height: 36, padding: '0 12px', border: 0, background: 'none', fontSize: 12.5, fontWeight: tab === k ? 600 : 500, color: tab === k ? ACS : '#6B7787', borderBottom: tab === k ? `2px solid ${AC}` : '2px solid transparent', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: -1, cursor: 'pointer' }}>
                {label}{flag && <span style={{ ...pill('#014A81', '#EFF5FA'), fontSize: 9 }}>MITRE</span>}
              </button>
            ))}
          </div>

          {tab === 'an' && <Analysis v={v} asset={riskAsset} score={score} vTone={vTone} verdictKey={verdictKey} hasAsset={!!primaryAssetId} onExploit={() => setTab('ex')} />}
          {tab === 'ex' && <ExploitTest intel={intel} vTone={vTone} verdictKey={verdictKey} hasAsset={!!primaryAssetId} v={v} score={score} />}
          {tab === 'rm' && <><div style={card}><RemediationPlanCard vulnId={vulnId} hasOwner={!!v.assigned_to} /></div><div style={{ marginTop: 12 }}><ItsmPanel vulnId={vulnId} /></div></>}
          {tab === 'hi' && <HistoryTimeline vulnId={vulnId} />}
          {tab === 'no' && <div style={card}><NotesPanel entityType="vulnerability" entityId={vulnId} /></div>}
          {tab === 'xc' && <ExceptionPanel vulnId={vulnId} v={v} onChanged={() => qc.invalidateQueries({ queryKey: ['vulnerability', vulnId] })} />}
        </div>

        {/* rail */}
        <aside style={{ position: 'sticky', top: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AuditFindingTags kind="vulnerability" recordId={vulnId} />
          {/* Affected assets FIRST — opening a finding should show, at a glance
              (top-right), exactly which assets this vulnerability hits and how
              exposed they are. Blast radius + per-asset context, all real. */}
          <AffectedAssets links={assetLinks} vulnId={vulnId} />
          {/* ponytail: renders every linked asset inline; a finding on 20+ hosts
              makes a tall sticky rail. Cap + "+N more" only if that ever happens. */}
          {/* Assignment near the top — the department(s) it's routed to plus the individual owner. */}
          <RailCard title="Assignment">
            {v.assigned_to && v.assignee_name && <Row k="Owner" v={v.assignee_name} />}
            {(deptAssignments?.length ?? 0) > 0
              ? deptAssignments!.map((d: any, i: number) => <Row key={d.id ?? d.department_id ?? i} k={d.department_name || d.name || 'Department'} v={d.priority || d.sla_override_days ? `${d.priority || ''}${d.sla_override_days ? ` · ${d.sla_override_days}d` : ''}`.trim() || 'assigned' : 'assigned'} />)
              : !(v.assigned_to && v.assignee_name) && <div style={{ fontSize: 11.5, color: MUTED }}>No one assigned — assign this finding to route remediation.</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <select value={assignPick} onChange={(e) => setAssignPick(e.target.value)}
                style={{ minWidth: 0, flex: 1, border: '1px solid #DDE3E8', borderRadius: 8, padding: '6px 8px', fontSize: 12.5, color: INK, background: '#fff' }}>
                <option value="">{v.assigned_to ? 'Reassign to…' : 'Assign to member…'}</option>
                {(tenantUsers ?? []).map((u: any) => (
                  <option key={u.id} value={u.id}>{u.display_name || u.username || u.email}</option>
                ))}
              </select>
              <button disabled={!assignPick || assignMut.isPending}
                onClick={() => assignPick && assignMut.mutate(Number(assignPick))}
                style={{ flex: 'none', border: 0, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: '#06342B', background: AC, cursor: assignPick ? 'pointer' : 'default', opacity: assignPick && !assignMut.isPending ? 1 : 0.5 }}>
                {assignMut.isPending ? '…' : 'Assign'}
              </button>
            </div>
            {assignMut.isError && <div style={{ fontSize: 11, color: '#C2453F', marginTop: 6 }}>Could not assign — check your permissions.</div>}
          </RailCard>
          {/* Reverse of "Create Help Desk ticket": surface the linked ticket + live
              status here in the always-visible rail (renders nothing until linked). */}
          <HelpDeskLinkCard vulnId={vulnId} />
          <RailCard title="Identity">
            <Row k="CWE" v={v.cwe_id || '—'} mono />
            <Row k="Severity" v={sm.label} />
            <Row k="CVSS vector" v={v.cvss_vector || v.nvd_cvss_vector || '—'} mono />
          </RailCard>
          <RailCard title="Timeline">
            <Row k="First seen" v={fmt(v.first_detected || v.created_at)} />
            <Row k="Last seen" v={fmt(v.last_seen)} />
            {/* Assessment TYPE, not the raw engine/tool name (e.g. "ai-pentest:hexstrike"). */}
            <Row k="Source" v={assessmentType(v.source || v.report_name)} />
          </RailCard>
          <CustomFieldsRail vulnId={vulnId} values={v.custom_values} />
        </aside>
      </div>
    </div>
  );
}

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
/** The tenant's own fields on this finding — hidden when they have none. */
function CustomFieldsRail({ vulnId, values }: { vulnId: number; values?: Record<string, unknown> | null }) {
  const qc = useQueryClient();
  const { data: settings } = useModuleSettings('vulnerabilities');
  if (!hasCustomFields(settings, values)) return null;
  return (
    <RailCard title="Custom fields">
      <CustomValuesEditor moduleKey="vulnerabilities" values={values}
        onSave={async (next) => {
          await vulnManagementApi.vulnerabilities.update(vulnId, { custom_values: next });
          await qc.invalidateQueries({ queryKey: ['vulnerability', vulnId] });
        }} />
    </RailCard>
  );
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={card}><div style={{ padding: '11px 14px', borderBottom: `1px solid ${BORDER2}` }}><h4 style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>{title}</h4></div><div style={{ padding: '8px 14px 12px' }}>{children}</div></section>;
}

// ── Affected assets — the blast radius: every asset this finding hits, each with
// the context (IP, type/OS, criticality, internet exposure, that host's OTHER
// open findings) that answers "what does this vulnerability actually touch, and
// how exposed is it". Every value is read from the linked assets (the enriched
// /assets link payload); nothing is fabricated. Honest empty state when unlinked.
function critMeta(c?: string) {
  const k = (c || '').toLowerCase();
  return SEVMETA[k] || { c: MUTED, bg: '#EEF1F3', label: c || 'Unrated' };
}
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function AffectedAssets({ links, vulnId }: { links?: any[]; vulnId: number }) {
  const list = Array.isArray(links) ? links : [];
  // Link an inventory asset to this finding — the register's "Not yet linked" state had no way
  // to attach one (so a manually-added vuln could never be linked). Reuses the existing
  // POST /vulnerabilities/{id}/assets; the dropdown excludes already-linked assets.
  const qc = useQueryClient();
  const [pick, setPick] = useState('');
  const { data: invAssets } = useQuery({
    queryKey: ['inv-assets-for-link'],
    queryFn: async () => (await assetsApi.getAll()).data as any[],
  });
  const linkedIds = new Set(list.map((l) => l?.asset_id));
  const options = (Array.isArray(invAssets) ? invAssets : []).filter((a) => !linkedIds.has(a.id));
  const linkMut = useMutation({
    mutationFn: (assetId: number) => vulnManagementApi.assetLinks.create(vulnId, { asset_id: assetId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vuln-assets', vulnId] });
      qc.invalidateQueries({ queryKey: ['vulnerability', vulnId] });
      qc.invalidateQueries({ queryKey: ['vulnerabilities'] });
      setPick('');
    },
    onError: (e: any) => window.alert(e?.response?.data?.detail || 'Failed to link the asset.'),
  });
  const n = list.length;
  const exposed = list.filter((l) => l?.asset_internet_facing).length;
  const critical = list.filter((l) => ['critical', 'high'].includes((l?.asset_criticality || '').toLowerCase())).length;
  // Blast-radius line — the one sentence that makes the asset relationship unmissable.
  const blast = n === 0 ? '' : [
    `Affects ${n} asset${n === 1 ? '' : 's'}`,
    exposed ? `${exposed} internet-exposed` : '',
    critical ? `${critical} critical/high` : '',
  ].filter(Boolean).join(' · ');

  return (
    <section style={card}>
      <div style={{ padding: '11px 14px', borderBottom: `1px solid ${BORDER2}` }}>
        <h4 style={{ fontSize: 12, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
          Affected asset{n === 1 ? '' : 's'}
          {n > 1 && <span style={{ ...pill(ACS, '#EFF5FA'), fontSize: 10 }}>{n}</span>}
        </h4>
        {blast && <p style={{ fontSize: 11.5, color: SEC, margin: '6px 0 0', lineHeight: 1.45 }}>{blast}.</p>}
      </div>
      <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {n === 0 ? (
          <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
            <b style={{ color: SEC, fontWeight: 600 }}>Not yet linked to an asset.</b><br />
            Link an affected asset to compute reachability and show its blast radius.
          </div>
        ) : list.map((l) => {
          const cm = critMeta(l?.asset_criticality);
          const typeOs = [cap(l?.asset_type), l?.asset_os].filter(Boolean).join(' · ');
          const opens = Number(l?.asset_open_findings) || 0;
          const label = l?.asset_name || `Asset #${l?.asset_id ?? '—'}`;
          return (
            <div key={l?.asset_id ?? l?.id} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 11px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <b style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>{label}</b>
                <span style={{ ...pill(cm.c, cm.bg), flex: 'none', textTransform: 'capitalize' }}>{cm.label}</span>
              </div>
              {typeOs && <div style={{ fontSize: 11, color: MUTED, marginTop: 3, wordBreak: 'break-word' }}>{typeOs}</div>}
              {(l?.asset_ip || l?.asset_internet_facing) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 5 }}>
                  {l?.asset_ip && <code style={{ fontFamily: MONO, fontSize: 11, color: SEC }}>{l.asset_ip}</code>}
                  {l?.asset_internet_facing && <span style={{ ...pill('#C0682F', '#FCEEE2'), fontSize: 10 }}><Globe size={10} />Internet-exposed</span>}
                </div>
              )}
              {opens > 0 && <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>{opens} other open finding{opens === 1 ? '' : 's'} on this host</div>}
              {l?.asset_id != null && <Link href={`/cyber-assurance/assets/${l.asset_id}`} style={{ ...btn, textDecoration: 'none', width: '100%', justifyContent: 'center', marginTop: 9, padding: '6px 10px' }}>View asset details →</Link>}
            </div>
          );
        })}
        {options.length > 0 && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: n === 0 ? 2 : 4 }}>
            <select value={pick} onChange={(e) => setPick(e.target.value)}
              style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '7px 9px', borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', fontFamily: 'inherit' }}>
              <option value="">Link an asset…</option>
              {options.map((a) => <option key={a.id} value={a.id}>{a.name || a.hostname || a.ip_address || `Asset #${a.id}`}</option>)}
            </select>
            <button onClick={() => pick && linkMut.mutate(Number(pick))} disabled={!pick}
              style={{ ...btn, flex: 'none', padding: '7px 12px', cursor: pick ? 'pointer' : 'not-allowed', opacity: pick ? 1 : 0.5 }}>
              Link
            </button>
          </div>
        )}
      </div>
    </section>
  );
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
function Analysis({ v, asset, score, vTone, verdictKey, hasAsset, onExploit }: any) {
  const [open, setOpen] = useState<Record<string, boolean>>({ severity: true, exploit: true, context: true });
  const vector = v.cvss_vector || v.nvd_cvss_vector || '';
  const factors = parseCvss(vector);
  // The Before card must always itemize its parameters (owner). If the vector
  // doesn't parse (none stored, or a format we don't map), fall back to the CVSS
  // base score + severity band so the card is never a bare total.
  const beforeFactors = factors.length ? factors : [
    { label: 'CVSS base score', value: `${(score.raw / 10).toFixed(1)} / 10`, mult: score.rawEstimated ? 'est.' : 'stored' },
    { label: 'Severity', value: SEVMETA[normSev(v.severity)].label, mult: '' },
  ];
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
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', color: FAINT, margin: '8px 0 4px' }}>{factors.length ? 'CVSS VECTOR FACTORS' : 'CVSS BASE'}</div>
            {beforeFactors.map((f) => (
              <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid #F7F9FA' }}>
                <span style={{ fontSize: 12, color: SEC }}>{f.label}</span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}><b style={{ fontSize: 12, fontWeight: 600, color: '#C2453F' }}>{f.value}</b><code style={{ fontFamily: MONO, fontSize: 10.5, color: FAINT, minWidth: 34, textAlign: 'right' }}>{f.mult}</code></span>
              </div>
            ))}
            {!factors.length && <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>No CVSS vector stored — Before estimated from the {SEVMETA[normSev(v.severity)].label} severity band.</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BORDER2}` }}>
              <code style={{ fontFamily: MONO, fontSize: 10, color: MUTED, wordBreak: 'break-all', flex: 1 }}>{vector || '—'}</code>
              <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: 'nowrap' }}>Total <b style={{ color: INK }}>{score.raw ?? '—'}</b> / 100</span>
            </div>
          </div>
        </section>
        {/* After — scored on this host */}
        <section style={{ ...card, padding: 0, overflow: 'hidden', border: '1px solid #CFF2E7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px 6px' }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: '#EFF5FA', color: '#014A81', display: 'grid', placeItems: 'center', flex: 'none' }}><Crosshair size={17} /></span>
            <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 15 }}>After</b><div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>scored on this host · {asset?.name || '—'}</div></div>
            {score.delta > 0 && <span style={{ ...pill('#1F7A54', '#E7F5EE'), fontSize: 10.5 }}>↓{score.delta}</span>}
            {score.delta < 0 && <span style={{ ...pill('#B23A3A', '#FBEAEA'), fontSize: 10.5 }}>↑{-score.delta}</span>}
            <b className="num" style={{ fontSize: 30, fontWeight: 600 }}>{score.contextual}</b>
          </div>
          {/* Pentest-AI exploitability verdict — the SAME verdict the Exploit Test tab
              shows (one source), so the enriched view never contradicts it. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 16px 8px' }}>
            <span style={pill(vTone.fg, vTone.bg)}><vTone.Icon size={12} />{vTone.verb}</span>
            <span style={{ fontSize: 10.5, color: MUTED }}>from the pentest engine · see <b style={{ color: ACS }}>Exploit Test</b></span>
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

// ── Exploit-Test tab — SYNCED to the pentest-AI engine (verdict + MITRE kill chain) ──
// Verdict comes from the finding's persisted pentest exploit_status (verdictKey); the
// MITRE techniques/tactics + attack-path chain + narrative come from the SAME read-only
// pentest intel endpoint the "Attack path" modal on the pentest run calls. No CVSS
// heuristic here — this tab and the pentest run show one truth for the same finding.
function ExploitTest({ intel, vTone, verdictKey, hasAsset, v, score }: any) {
  if (!hasAsset) {
    return <div style={{ ...card, borderLeft: '4px solid #E0AF33', background: '#FEFBF4', padding: '18px' }}><b style={{ fontSize: 14, color: '#9A6410' }}>Attack path can&apos;t be assessed yet</b><p style={{ fontSize: 12.5, color: '#7A6427', marginTop: 6, lineHeight: 1.55 }}>This finding isn&apos;t linked to any asset, so the pentest engine can&apos;t map its attack path on a host. Link an affected asset and the attack path populates from the pentest intel.</p></div>;
  }
  const VIcon = vTone.Icon;
  const d = intel?.data;
  const loading = intel?.isLoading;
  const isErr = intel?.isError;
  const kc: any[] = Array.isArray(d?.kill_chain) ? d.kill_chain : [];
  const steps: any[] = Array.isArray(d?.steps) ? d.steps : [];
  const cands: any[] = (Array.isArray(d?.candidates) ? d.candidates : []).filter((c: string) => c && c !== d?.tool);
  const noTool = d?.status === 'no-tool' || (d != null && d.tool == null);
  const notAssessed = verdictKey === 'not-assessed';
  const clsLabel = classLabel(v?.exploit_class);
  const proofCount = (v?.public_exploit_count ?? 0) + (v?.exploitdb_count ?? 0);
  const exploitRefs: any[] = Array.isArray(v?.public_exploit_refs) ? v.public_exploit_refs : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* verdict hero — from the pentest exploit_status (one source, shared with Analysis) */}
      <section style={{ ...card, borderLeft: `4px solid ${vTone.bar}`, background: vTone.soft, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, background: '#fff', display: 'grid', placeItems: 'center', color: vTone.fg, flex: 'none' }}><VIcon size={21} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 19, color: vTone.fg }}>{vTone.verb}</b>
              {clsLabel && <span style={{ ...pill(vTone.fg, '#fff'), border: `1px solid ${vTone.bar}`, textTransform: 'capitalize' }}>{clsLabel}</span>}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>pentest exploitability verdict · assessed on <b style={{ color: SEC }}>{d?.asset?.name || 'the affected asset'}</b></div>
          </div>
          {score?.contextual != null && <div style={{ textAlign: 'right' }}><b className="num" style={{ fontSize: 24, color: vTone.fg }}>{score.contextual}</b>{score.delta !== 0 && <span style={{ fontSize: 11, color: MUTED, marginLeft: 6 }}>{score.delta > 0 ? '↓' : '↑'}{Math.abs(score.delta)} vs raw {score.raw}</span>}</div>}
        </div>
        {notAssessed && (
          <p style={{ fontSize: 12.5, color: SEC, marginTop: 10, lineHeight: 1.55 }}>
            This finding has <b>not been assessed by the pentest engine</b> yet (no exploit classification recorded). The attack path below is the engine&apos;s read-only intel for how the weakness <i>would</i> be exploited; it is not a verdict for this host. Run a pentest to classify its exploitability.
          </p>
        )}
      </section>

      {/* attack path — the pentest-AI kill chain (same as the pentest run's Attack-path modal) */}
      <section style={{ ...card, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <Network size={15} color="#C2453F" />
          <b style={{ fontSize: 14 }}>Attack path</b>
          <span style={{ fontSize: 11.5, color: FAINT }}>MITRE ATT&amp;CK · AI-planned tactics &amp; techniques — read-only, nothing executed</span>
        </div>
        {loading ? (
          <div style={{ padding: 16, fontSize: 12.5, color: MUTED }}>The AI is mapping the attack path…</div>
        ) : isErr ? (
          <div style={{ border: `1px solid ${BORDER}`, background: '#FAFBFC', borderRadius: 10, padding: 16, fontSize: 12.5, color: SEC }}>Could not load the attack path — retry shortly. This is a system error, not a result.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* tool decision */}
            <div style={{ border: `1px solid ${BORDER}`, background: '#FAFBFC', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: MUTED, marginBottom: 6 }}><Bug size={12} />Tool decision</div>
              {noTool ? (
                <p style={{ fontSize: 12.5, color: SEC, lineHeight: 1.5 }}>{d?.detail || d?.needs || 'No auto-exploit tool is wired for this finding — it is proven by the scan, not auto-fired. The attack path below is how it would be exploited.'}</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ color: MUTED }}>chosen</span>
                  <code style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: '#014A81', background: '#EFF5FA', borderRadius: 5, padding: '2px 7px' }}>{d?.tool}</code>
                  {d?.technique && <span style={{ ...pill('#B23A3A', '#FBEAEA'), fontSize: 11 }}>{d.technique}</span>}
                  {d?.attack_id && <code style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 5, padding: '1px 5px' }}>{d.attack_id}</code>}
                  {cands.length > 0 && <span style={{ color: FAINT }}>· also considered: {cands.join(', ')}</span>}
                </div>
              )}
              {d?.why && <p style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>{d.why}</p>}
            </div>
            {/* the MITRE kill chain — the shared pentest renderer, so it is byte-identical to the run's Attack-path modal */}
            {kc.length > 0 ? <KillChainList steps={kc} /> : <div style={{ fontSize: 12.5, color: MUTED }}>No attack-path techniques returned for this finding.</div>}
            {d?.attack_narrative && (
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: MUTED, marginBottom: 6 }}><FileText size={12} />How the AI would exploit this</div>
                <p style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, color: SEC }}>{d.attack_narrative}</p>
              </div>
            )}
            {steps.length > 0 && (
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: MUTED, marginBottom: 6 }}><ListOrdered size={12} />Steps</div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: SEC }}>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </div>
            )}
          </div>
        )}
        <p style={{ fontSize: 11, color: MUTED, marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Shield size={12} /> Read-only attack-path intelligence — nothing is executed against any host here.</p>
      </section>

      {/* supporting public-exploit evidence (does not set the verdict — the pentest engine does) */}
      <section style={{ ...card, padding: '12px 16px' }}>
        <b style={{ fontSize: 14 }}>Public-exploit evidence</b>
        <div style={{ fontSize: 11.5, color: FAINT, marginBottom: 12 }}>supporting signals — the verdict above comes from the pentest engine, not these counts</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
          {[
            ['CISA KEV', v?.kev_flag ? 'Listed — exploited in the wild' : 'Not listed', !!v?.kev_flag],
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
      </section>
    </div>
  );
}


// ── Exception tab ──
// The finding's risk-exception lifecycle, backed by the real FSM
// (services/vuln_exception.py): none/denied/expired → request; requested →
// approve | deny; approved → revoke; revoked is terminal. Separation of duties
// (a requester can't approve/deny their own) is enforced server-side — its 400
// reason is shown as-is.
const EXC_META: Record<string, { label: string; c: string; bg: string }> = {
  none: { label: 'No exception', c: '#6B7787', bg: '#EEF1F3' },
  requested: { label: 'Requested · awaiting review', c: '#9A6410', bg: '#FBF2DF' },
  approved: { label: 'Approved', c: '#1F7A54', bg: '#E7F5EE' },
  denied: { label: 'Denied', c: '#B23A3A', bg: '#FBEAEA' },
  expired: { label: 'Expired', c: '#C0682F', bg: '#FCEEE2' },
  revoked: { label: 'Revoked', c: '#6B7787', bg: '#EEF1F3' },
};

function ExceptionPanel({ vulnId, v, onChanged }: { vulnId: number; v: any; onChanged: () => void }) {
  const state: string = v?.exception_status || 'none';
  const meta = EXC_META[state] || EXC_META.none;
  const [justification, setJustification] = useState('');
  const [controls, setControls] = useState('');
  const [expires, setExpires] = useState('');
  const [comment, setComment] = useState('');
  const [denyReason, setDenyReason] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const done = () => {
    setErr(null); setJustification(''); setControls(''); setExpires('');
    setComment(''); setDenyReason(''); setRevokeReason('');
    onChanged();
  };
  const fail = (e: any) => setErr(e?.response?.data?.detail || 'Action failed.');
  // <input type="date"> yields YYYY-MM-DD; the API takes a datetime (end of that day).
  const iso = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : undefined);

  const request = useMutation({
    mutationFn: () => {
      const ctrls = controls.split('\n').map((s) => s.trim()).filter(Boolean);
      return vulnManagementApi.vulnerabilities.exceptionRequest(vulnId, {
        justification: justification.trim(),
        compensating_controls: ctrls.length ? ctrls : undefined,
        expires_at: iso(expires),
      });
    },
    onSuccess: done, onError: fail,
  });
  const approve = useMutation({
    mutationFn: () => vulnManagementApi.vulnerabilities.exceptionApprove(vulnId, { comment: comment.trim() || undefined, expires_at: iso(expires) }),
    onSuccess: done, onError: fail,
  });
  const deny = useMutation({
    mutationFn: () => vulnManagementApi.vulnerabilities.exceptionDeny(vulnId, { denial_reason: denyReason.trim() }),
    onSuccess: done, onError: fail,
  });
  const revoke = useMutation({
    mutationFn: () => vulnManagementApi.vulnerabilities.exceptionRevoke(vulnId, { reason: revokeReason.trim() || undefined }),
    onSuccess: done, onError: fail,
  });
  const busy = request.isPending || approve.isPending || deny.isPending || revoke.isPending;

  const field: React.CSSProperties = { width: '100%', border: '1px solid #E4E8EC', borderRadius: 9, padding: '8px 10px', fontSize: 12.5, color: INK, background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' };
  const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 600, color: SEC, marginBottom: 5 };
  const fmtD = (d?: string) => (d ? new Date(d).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
  const controlsOnRecord: string[] = Array.isArray(v?.exception_compensating_controls) ? v.exception_compensating_controls : [];

  return (
    <div style={{ ...card, padding: '16px 18px' }}>
      {/* current state */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: FAINT, marginBottom: 6 }}>Risk exception</div>
          <span style={pill(meta.c, meta.bg)}>{meta.label}</span>
        </div>
        {state !== 'none' && (
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '3px 14px', fontSize: 12, margin: 0 }}>
            <dt style={{ color: MUTED }}>Requested</dt><dd style={{ margin: 0, color: INK }}>{fmtD(v.exception_requested_at)}</dd>
            {v.exception_approved_at && <><dt style={{ color: MUTED }}>Approved</dt><dd style={{ margin: 0, color: INK }}>{fmtD(v.exception_approved_at)}</dd></>}
            <dt style={{ color: MUTED }}>Expires</dt><dd style={{ margin: 0, color: INK }}>{fmtD(v.exception_expires_at)}</dd>
            {v.exception_revoked_at && <><dt style={{ color: MUTED }}>Revoked</dt><dd style={{ margin: 0, color: INK }}>{fmtD(v.exception_revoked_at)}</dd></>}
          </dl>
        )}
      </div>

      {/* what's on record */}
      {state !== 'none' && (v.exception_justification || controlsOnRecord.length > 0 || v.exception_denial_reason) && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BORDER2}`, display: 'grid', gap: 10 }}>
          {v.exception_justification && (
            <div><div style={lbl}>Justification</div><p style={{ margin: 0, fontSize: 12.5, color: SEC, whiteSpace: 'pre-wrap' }}>{v.exception_justification}</p></div>
          )}
          {controlsOnRecord.length > 0 && (
            <div><div style={lbl}>Compensating controls</div><ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: SEC }}>{controlsOnRecord.map((c) => <li key={c}>{c}</li>)}</ul></div>
          )}
          {v.exception_denial_reason && (
            <div><div style={lbl}>Denial reason</div><p style={{ margin: 0, fontSize: 12.5, color: '#B23A3A', whiteSpace: 'pre-wrap' }}>{v.exception_denial_reason}</p></div>
          )}
        </div>
      )}

      {/* actions — only the transitions the FSM allows from this state */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BORDER2}` }}>
        {(state === 'none' || state === 'denied' || state === 'expired') && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{state === 'none' ? 'Request an exception' : 'Request again'}</div>
            <div><label style={lbl}>Justification *</label><textarea rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Why this risk is accepted for now" style={field} /></div>
            <div><label style={lbl}>Compensating controls <span style={{ color: FAINT, fontWeight: 400 }}>(one per line)</span></label><textarea rows={2} value={controls} onChange={(e) => setControls(e.target.value)} placeholder={'Network segmentation\nEDR monitoring'} style={field} /></div>
            <div style={{ maxWidth: 220 }}><label style={lbl}>Expires</label><input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} style={field} /></div>
            <div><button style={{ ...btn, background: AC, borderColor: AC, color: '#fff', fontWeight: 600 }} disabled={busy || !justification.trim()} onClick={() => request.mutate()}>Submit request</button></div>
          </div>
        )}

        {state === 'requested' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>Approve</div>
              <div><label style={lbl}>Comment</label><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional" style={field} /></div>
              <div><label style={lbl}>Expires</label><input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} style={field} /></div>
              <div><button style={{ ...btn, background: '#1F7A54', borderColor: '#1F7A54', color: '#fff', fontWeight: 600 }} disabled={busy} onClick={() => approve.mutate()}>Approve</button></div>
            </div>
            <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>Deny</div>
              <div><label style={lbl}>Reason *</label><textarea rows={3} value={denyReason} onChange={(e) => setDenyReason(e.target.value)} placeholder="Required to deny" style={field} /></div>
              <div><button style={{ ...btn, color: '#B23A3A', borderColor: '#F3D3DA' }} disabled={busy || !denyReason.trim()} onClick={() => deny.mutate()}>Deny</button></div>
            </div>
          </div>
        )}

        {state === 'approved' && (
          <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
            <div><label style={lbl}>Revoke reason</label><input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Optional" style={field} /></div>
            <div><button style={{ ...btn, color: '#B23A3A', borderColor: '#F3D3DA' }} disabled={busy} onClick={() => revoke.mutate()}>Revoke exception</button></div>
          </div>
        )}

        {state === 'revoked' && <p style={{ margin: 0, fontSize: 12.5, color: MUTED }}>Revoked — no further actions.</p>}

        {err && <div style={{ marginTop: 10, fontSize: 12.5, color: '#B23A3A', background: '#FBEAEA', borderRadius: 9, padding: '8px 10px' }}>{err}</div>}
      </div>
    </div>
  );
}
