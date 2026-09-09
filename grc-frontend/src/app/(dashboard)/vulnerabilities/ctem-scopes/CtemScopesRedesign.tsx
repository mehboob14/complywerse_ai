'use client';

/**
 * CTEM Scopes & Cycles — redesign, re-skinned to CTEM-Scopes.mock.html.
 *
 * PRESENTATION rebuild only. Every data hook, mutation and gated-loop rule is
 * the same wiring as before (ctemScopesApi.portfolio() → ['ctem-portfolio'],
 * plus the per-scope findings / fixed / users / ai-run / sla queries). The
 * reusable panels — AiControlProposalsPanel, MobiliseControlCell — and the
 * assign modal are reused verbatim.
 *
 * Two screens: a program HOME (KPI strip + trends + scope cards, worst-first)
 * and a scope JOURNEY (command bar + the 5 stages as a vertical accordion).
 * Styling mirrors the mock (Poppins + mint) and VulnsWorkspace's inline-hex
 * palette — no external stylesheet needed on the vulnerabilities route.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ctemScopesApi, vulnManagementApi, apiClient } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { AiControlProposalsPanel } from './_components/AiControlProposalsPanel';
import { MobiliseControlCell } from './_components/MobiliseControlCell';
import {
  Crosshair, Plus, ExternalLink, Square, Play, RefreshCw, ArrowRight,
  ShieldCheck, Server, Search, Send, Loader2, AlertTriangle, Trash2,
  Calendar, Table2, X, PlayCircle, CreditCard, Lock, Users,
} from 'lucide-react';

/* ────────────────────────────── types ────────────────────────────── */

type Tier = 'tested' | 'failed' | 'verified' | 'claimed';
type Risk = 'crit' | 'high' | 'med' | 'low';
type Sev = 'critical' | 'high' | 'medium' | 'low';

interface Machine { id: number; name: string; type: string; findings: number; risk: Risk | null }
interface Framework { name: string; controls: number; tested: number }
interface Finding {
  id: number; rank: number; title: string; meta: string; breaks: string; owner: string | null; sla: string | null; sev: Sev;
  kev?: boolean; epss?: number | null;
  taskStatus?: string | null; taskApprovalId?: number | null; taskApproverId?: number | null; taskAssigneeId?: number | null;
}
interface ControlItem { fw: string; code: string; title: string; findings: number; tier: Tier; control_id?: number; kind?: string; basis?: 'rule' | 'ai' | 'ai_auto' | 'ai_family' | 'reused' | 'manual' | string; reason?: string; covered_ids?: number[]; family_of?: number | null; priority_covered?: number; standards?: string[] }

interface Scope {
  id: number; name: string; owner: string | null;
  cadence: string; membership: string;
  cycleOpen: boolean; cycleId?: number | null; cycleNo: number; cycleDay?: number | null; lastClosed?: string | null;
  cycleHistory?: { no: number; opened: string | null; closed: string | null; closedBy: string; findings: number | null; dangerous: number | null; mobilised: number | null; hash: string }[];
  cycleDueAt?: string | null; cycleOverdue?: boolean;
  assets: number; findings: number; dangerous: number; dangerousOwnerless?: number; dangerousIds?: number[]; chains: number;
  controls: number; tested: number; failed: number; verified?: number; claimed: number;
  pipeline?: { analysed: number; informational: number; linked: number; patch_only: number; no_specific: number; low_awaiting_review: number; unmapped?: number;
    priority?: { total: number; linked: number; patch_only: number; awaiting: number; unanswered: number };
    priority_ids?: number[];
    linked_ids?: number[] };
  stageProgress?: { discover?: string; prioritise?: string; validate?: string; dispatch?: string } | null;
  fixes: number; fixesOpen: number; tasks?: number; closedVerified?: number;
  ale: number | null; aleMin: number | null; p95: number | null; aleAfter: number | null;
  fair?: { risks_linked: number; risks_quantified: number; currency?: string | null } | null;
  buckets: { ranked: number; undeterminable: number; chainless: number; severed: number };
  analysable?: { real_vulnerabilities: number; informational: number } | null;
  frameworks: Framework[]; machines: Machine[]; top: Finding[];
  tFind: number[]; tDang: number[];
  prevFind: number | null; prevDang: number | null; prevMob: number | null;
  cw: ControlItem[];
}
interface Portfolio { scopes: Scope[]; quantify?: { demo_only?: boolean; ale?: number | null; p95?: number | null; currency?: string | null } | null }

/* ───────────── palette (mock + VulnsWorkspace, kept literal) ───────────── */

const AC = '#17B898', ACS = '#12A085', ACSOFT = '#E4F8F2';
const MUTED = '#8A95A1', FAINT = '#AEB8C2', BORDER = '#E8ECEE', BORDER2 = '#F0F3F5', INK = '#0F1F2B', SEC = '#3A4653';
const RED = '#B23A3A', REDD = '#C2453F', REDBG = '#FBEAEA';
const AMBER = '#9A6410', AMBERBG = '#FBF2DF', AMBERLINE = '#EAD9AE';
const GREEN = '#1F7A54', GREENBG = '#E7F5EE', BLUE = '#2E63A8', VIOLET = '#6A54C9', VIOLETBG = '#EEEBFA';

const MONO: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const CARD: React.CSSProperties = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)' };
const STRIP: React.CSSProperties = { display: 'flex', gap: 16, flexWrap: 'wrap', background: '#F7F9FA', border: `1px solid ${BORDER}`, borderRadius: 11, padding: '9px 14px' };
const SK: React.CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: FAINT, fontWeight: 700 };
const SV: React.CSSProperties = { fontSize: 17, fontWeight: 700, ...MONO };
const TH: React.CSSProperties = { textAlign: 'left', fontSize: 9.5, letterSpacing: '.05em', textTransform: 'uppercase', color: FAINT, fontWeight: 600, padding: '10px 12px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' };
const TD: React.CSSProperties = { padding: '11px 12px', borderBottom: `1px solid ${BORDER2}`, verticalAlign: 'middle', fontSize: 12.5 };
const SEP = <div style={{ width: 1, background: '#E4E8EC' }} />;
const ARROW = <div style={{ alignSelf: 'center', color: '#CBD5E1', flex: 'none' }}>→</div>;

const SEV: Record<string, { bg: string; c: string }> = {
  critical: { bg: '#FBEAEA', c: '#B23A3A' }, high: { bg: '#FCEEE2', c: '#C0682F' },
  medium: { bg: '#FBF2DF', c: '#9A6410' }, low: { bg: '#E9F1FB', c: '#2E63A8' }, info: { bg: '#EEF1F3', c: '#6B7787' },
};
const STAGES = [
  { n: 1, label: 'Scope', c: '#2E63A8' },
  { n: 2, label: 'Discover', c: '#12A085' },
  { n: 3, label: 'Prioritise', c: '#C2453F' },
  { n: 4, label: 'Validate', c: '#6A54C9' },
  { n: 5, label: 'Mobilise', c: '#12A085' },
];

/* ───────────────────────── small UI atoms ───────────────────────── */

function Pill({ bg, c, children }: { bg: string; c: string; children: React.ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: bg, color: c, whiteSpace: 'nowrap' }}>{children}</span>;
}
function SevBadge({ sev }: { sev: string }) {
  const s = SEV[sev] || SEV.info;
  return <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', padding: '1px 7px', borderRadius: 5, background: s.bg, color: s.c }}>{sev === 'info' ? 'info' : sev}</span>;
}
function Kev() {
  return <span style={{ background: '#FBEAEA', color: '#C2453F', fontWeight: 700, fontSize: 9, padding: '1px 6px', borderRadius: 5 }}>actively exploited</span>;
}
function Btn({ green, sm, onClick, disabled, title, style, children }: { green?: boolean; sm?: boolean; onClick?: () => void; disabled?: boolean; title?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  // One border property only — mixing the `border` shorthand with a `borderColor`
  // override across rerenders trips React's conflicting-style warning.
  const base: React.CSSProperties = { border: `1px solid ${green ? AC : '#E4E8EC'}`, background: '#fff', color: SEC, borderRadius: 9, padding: sm ? '5px 10px' : '7px 12px', fontSize: sm ? 11.5 : 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap' };
  const g: React.CSSProperties = green ? { background: AC, color: '#06342B', fontWeight: 600 } : {};
  return <button type="button" title={title} disabled={disabled} onClick={onClick} style={{ ...base, ...g, ...style }}>{children}</button>;
}
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
// Show the RESOLVED asset count for a named-list scope (a stored rule can name
// more asset ids than currently resolve in inventory) so the card can't claim
// "3 named assets" when only 2 exist. Non-named rules keep their descriptor.
const membText = (sc: { membership: string; assets: number }) =>
  /named asset/i.test(sc.membership || '') ? `${sc.assets} named asset${sc.assets === 1 ? '' : 's'}` : sc.membership;
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const riskColor = (r: Risk | null) => (r === 'crit' ? '#be123c' : r === 'high' ? '#f97316' : r === 'med' ? '#eab308' : r === 'low' ? '#10b981' : '#cbd5e1');

/** polyline + area path for a sparkline scaled to [w,h]. */
function spark(vals: number[], w: number, h: number, pad: number) {
  const max = Math.max(...vals), min = Math.min(...vals), range = max - min || 1, n = vals.length;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (n - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `M ${pts[0][0]},${h} ` + pts.map((p) => `L ${p[0]},${p[1]}`).join(' ') + ` L ${pts[n - 1][0]},${h} Z`;
  return { line, area, pts };
}

const Card = ({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`} {...props} />
);

/* ───────────────────────────── page ─────────────────────────────── */

export default function CtemScopesRedesign() {
  const qc = useQueryClient();
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('risks:risk_register:edit');

  // Navigation: 'home' = program (scope cards); 'scope' = journey.
  const [screen, setScreen] = useState<'home' | 'scope'>('home');
  const [selId, setSelId] = useState<number | null>(null);
  const [showAllCw, setShowAllCw] = useState(false);
  const [showAllRanked, setShowAllRanked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [form, setForm] = useState({ name: '', cadence: 'quarterly', asset_ids: [] as number[] });
  const [assigning, setAssigning] = useState<Finding | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [approverId, setApproverId] = useState('');
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [mobFilter, setMobFilter] = useState<'all' | 'unassigned' | 'inprogress' | 'fixed'>('all');
  const [mobGroup, setMobGroup] = useState<'status' | 'owner'>('status');
  // Validate sub-tabs: coverage / review queue / by control / decisions audit.
  const [valTab, setValTab] = useState<'coverage' | 'review' | 'control' | 'decisions'>('coverage');
  // Discover asset filter (machine name, or 'all').
  const [discAsset, setDiscAsset] = useState<string>('all');
  // "By control" evidence popup.
  const [ctrlPopup, setCtrlPopup] = useState<{ id: number; code: string; name: string; coveredIds: number[]; findings: number } | null>(null);
  const [peek, setPeek] = useState<any | null>(null);
  // Which stage's accordion body is open. null → resolves to the first
  // stage that isn't done yet, so opening a scope lands on the live work.
  const [activeStageRaw, setActiveStage] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => setToast(m);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  // ONE call for the whole portfolio — every scope's command-center numbers.
  const { data, isLoading, isError, error: loadError, refetch } = useQuery<Portfolio>({
    queryKey: ['ctem-portfolio'],
    queryFn: async () => (await ctemScopesApi.portfolio()).data,
  });
  const SCOPES: Scope[] = data?.scopes ?? [];

  // ── Validate progress poll — the AI mapping run is a backend thread ────────
  const pollScopeId = selId ?? (data?.scopes?.[0]?.id ?? null);
  const pollScope = (data?.scopes ?? []).find((x) => x.id === pollScopeId);
  const needRunPoll = !!pollScope && pollScope.stageProgress != null && !pollScope.stageProgress?.validate;
  const { data: aiRunData } = useQuery({
    queryKey: ['ai-run', pollScopeId],
    queryFn: async () => (await vulnManagementApi.vulnerabilities.aiProposalsList({ status: 'proposed', ctem_scope_id: pollScopeId! })).data,
    enabled: needRunPoll && pollScopeId != null,
    refetchInterval: (q) => ((q.state.data as any)?.last_run?.running ? 2500 : (needRunPoll ? 6000 : false)),
  });
  const aiRun = (aiRunData as any)?.last_run ?? null;
  const mappingRunning = !!aiRun?.running;
  useEffect(() => {
    if (aiRun && !aiRun.running) { qc.invalidateQueries({ queryKey: ['ctem-portfolio'] }); qc.invalidateQueries({ queryKey: ['ctem.scope-findings'] }); setActiveStage(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRun?.running]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ctem-portfolio'] });
    qc.invalidateQueries({ queryKey: ['ctem-scopes'] });
    qc.invalidateQueries({ queryKey: ['ctem-command-center'] });
    qc.invalidateQueries({ queryKey: ['ctem.scope-findings'] });
  };
  const createMutation = useMutation({
    mutationFn: () => {
      const names = (form.asset_ids || [])
        .map((id) => (scopeAssets ?? []).find((a) => a.id === id)?.name)
        .filter(Boolean) as string[];
      const autoName = names.length === 1 ? names[0]
        : names.length > 1 ? `${names[0]} +${names.length - 1} more`
        : 'New scope';
      return ctemScopesApi.create({
        name: form.name.trim() || autoName, cadence: form.cadence || null,
        membership_rule: { asset_ids: form.asset_ids && form.asset_ids.length ? form.asset_ids : null },
      });
    },
    onSuccess: () => { setShowCreate(false); setForm({ name: '', cadence: 'quarterly', asset_ids: [] as number[] }); setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to create scope'),
  });
  const openMutation = useMutation({
    mutationFn: (scopeId: number) => ctemScopesApi.openCycle(scopeId),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to open cycle'),
  });
  const closeMutation = useMutation({
    mutationFn: (cycleId: number) => ctemScopesApi.closeCycle(cycleId),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to close cycle'),
  });
  // Gated loop: stamp a stage done on the OPEN cycle (discover | prioritise | dispatch).
  const completeStage = useMutation({
    mutationFn: async (args: { scopeId: number; stage: 'discover' | 'prioritise' | 'dispatch' }) =>
      (await ctemScopesApi.completeStage(args.scopeId, args.stage)).data,
    onSuccess: () => { setError(null); setActiveStage(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not advance the stage'),
  });
  // Re-run the attack-path engine over the scope. Inside an open cycle this IS
  // the Prioritise stage's work — success stamps it.
  const computePaths = useMutation({
    mutationFn: async (scopeId: number) => (await vulnManagementApi.vulnerabilities.computeAttackPaths(scopeId, false)).data,
    onSuccess: async (_d, scopeId) => {
      setError(null);
      const inOpenCycle = (data?.scopes ?? []).find((x) => x.id === scopeId)?.stageProgress != null;
      if (inOpenCycle) {
        try { await ctemScopesApi.completeStage(scopeId, 'prioritise'); setActiveStage(null); }
        catch (e: any) { setError(e?.response?.data?.detail || 'Prioritise ran, but the stage could not be stamped'); }
      }
      invalidate(); qc.invalidateQueries({ queryKey: ['choke-points'] });
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Attack-path calculation failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: (scopeId: number) => ctemScopesApi.remove(scopeId),
    onSuccess: (_d, scopeId) => { setError(null); if (selId === scopeId) { setSelId(null); setScreen('home'); } invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to delete scope'),
  });

  const { data: currentUser } = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => (await apiClient.get('/auth/me')).data as { id: number },
    staleTime: 5 * 60 * 1000,
  });
  const { data: scopeAssets } = useQuery({
    queryKey: ['ctem.scope-assets'],
    queryFn: async () => (await apiClient.get<Array<{ id: number; name: string; host_name?: string | null; internet_facing?: boolean | null; department?: string | null }>>('/assets', { params: { limit: 1000 } })).data,
    staleTime: 5 * 60 * 1000,
  });
  const sPeekId = (SCOPES.find((x) => x.id === selId) ?? SCOPES[0])?.id ?? null;
  const { data: scopeFindings } = useQuery({
    queryKey: ['ctem.scope-findings', sPeekId],
    enabled: sPeekId != null,
    staleTime: 30_000,
    queryFn: async () => (await vulnManagementApi.vulnerabilities.getAll({
      ctem_scope_id: sPeekId as number, limit: 500, template_type: '_general',
    } as any)).data as any[],
  });
  const { data: scopeFixed } = useQuery({
    queryKey: ['ctem.scope-fixed', sPeekId],
    enabled: sPeekId != null,
    staleTime: 30_000,
    queryFn: async () => (await vulnManagementApi.vulnerabilities.getAll({
      ctem_scope_id: sPeekId as number, status: 'auto_closed_fixed', limit: 200,
    } as any)).data as any[],
  });
  // Per-severity SLA defaults (tenant config) for the Mobilise tracker + new-scope strip.
  const { data: slaData } = useQuery({
    queryKey: ['vuln.sla'],
    queryFn: async () => (await vulnManagementApi.sla.get()).data as any,
    staleTime: 10 * 60 * 1000,
  });
  const slaBySev: Record<string, string> = { critical: '7d', high: '30d', medium: '90d', low: '180d' };
  const slaList = Array.isArray(slaData) ? slaData : (slaData?.items ?? slaData?.slas ?? []);
  if (Array.isArray(slaList)) slaList.forEach((r: any) => { const sv = String(r?.severity ?? '').toLowerCase(); const d = r?.sla_days ?? r?.days ?? r?.remediation_days; if (sv && d != null) slaBySev[sv] = `${d}d`; });

  const { data: tenantUsers } = useQuery({
    queryKey: ['vuln.tenant-users'],
    queryFn: async () => (await apiClient.get<Array<{ id: number; display_name: string; email: string }>>('/assets/tenant-users')).data,
    staleTime: 5 * 60 * 1000,
  });
  // Decisions audit — the accepted/rejected AI control proposals for this scope.
  const { data: valDecisions } = useQuery({
    queryKey: ['ctem.val-decisions', sPeekId],
    enabled: sPeekId != null && valTab === 'decisions',
    queryFn: async () => {
      const [a, r] = await Promise.all([
        vulnManagementApi.vulnerabilities.aiProposalsList({ status: 'accepted', ctem_scope_id: sPeekId! }),
        vulnManagementApi.vulnerabilities.aiProposalsList({ status: 'rejected', ctem_scope_id: sPeekId! }),
      ]);
      return { accepted: ((a.data as any)?.items || []) as any[], rejected: ((r.data as any)?.items || []) as any[] };
    },
  });
  // "By control" findings popup — the real reverse lookup for a framework control.
  const { data: ctrlEvidence, isLoading: ctrlLoading } = useQuery({
    queryKey: ['ctem.ctrl-evidence', ctrlPopup?.id],
    enabled: !!ctrlPopup && (ctrlPopup?.id ?? 0) > 0,
    queryFn: async () => (await vulnManagementApi.controlLinks.listEvidenceForControl(ctrlPopup!.id)).data as any,
  });

  const mobiliseMutation = useMutation({
    mutationFn: (body: { scopeId: number; vulnerability_id: number; assignee_user_id: number; approver_user_id?: number }) =>
      ctemScopesApi.mobilise(body.scopeId, {
        vulnerability_id: body.vulnerability_id,
        assignee_user_id: body.assignee_user_id,
        approver_user_id: body.approver_user_id,
      }),
    onSuccess: () => { setError(null); setAssigning(null); setAssigneeId(''); setApproverId(''); qc.invalidateQueries({ queryKey: ['ctem.scope-findings'] }); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to assign this fix'),
  });
  const mapControls = useMutation({
    mutationFn: async () => { await vulnManagementApi.vulnerabilities.aiProposalsGenerate(s!.id); },
    onSuccess: () => { setError(null); invalidate(); qc.invalidateQueries({ queryKey: ['ai-control-proposals'] }); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Control mapping failed'),
  });

  // ── Portfolio roll-up (home KPI strip + trends) ────────────────────────────
  const portfolio = useMemo(() => {
    const sum = (f: (s: Scope) => number) => SCOPES.reduce((a, s) => a + f(s), 0);
    // Coverage = share of REAL vulns that have an addressing control LINKED (claimed) — the
    // same linked/analysed the Validate stage shows. NOT tested/controls: that was proven-
    // effectiveness (0 until a re-scan), which mislabelled this "% of real vulns with a control".
    const linkedReal = sum((s) => s.pipeline?.linked ?? 0);
    const realVulns = sum((s) => s.pipeline?.analysed ?? s.analysable?.real_vulnerabilities ?? 0);
    const worst = [...SCOPES].sort((a, b) => (b.dangerous - a.dangerous) || (b.findings - a.findings))[0];
    // real findings-per-cycle series from the worst scope's frozen history (+ live point)
    const hist = [...(worst?.cycleHistory ?? [])].filter((h) => h.findings != null).sort((a, b) => a.no - b.no).map((h) => h.findings as number);
    const series = worst?.cycleOpen && worst.findings != null ? [...hist, worst.findings] : hist;
    return {
      scopes: SCOPES.length,
      openCycles: SCOPES.filter((s) => s.cycleOpen).length,
      overdue: SCOPES.filter((s) => s.cycleOpen && s.cycleOverdue).length,
      findings: sum((s) => s.findings), dangerous: sum((s) => s.dangerous),
      mobilised: sum((s) => s.tasks ?? 0), fixed: sum((s) => s.closedVerified ?? 0),
      coverage: realVulns ? Math.round((linkedReal / realVulns) * 100) : 0,
      worst, series,
    };
  }, [SCOPES]);

  const s: Scope | undefined = SCOPES.find((x) => x.id === selId) ?? SCOPES[0];

  if (isLoading) {
    return <div className="flex items-center gap-2 py-16 justify-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading exposure program…</div>;
  }
  if (isError) {
    const status = (loadError as any)?.response?.status;
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
        <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-rose-600" />
        <p className="text-[13.5px] font-semibold text-slate-900">Couldn&apos;t load the exposure program</p>
        <p className="mt-1 text-[12px] text-slate-600">
          {status === 401 || status === 403 ? 'Your session has expired or you lack permission — sign in again and reload.' : `The server returned an error${status ? ` (${status})` : ''}.`}
        </p>
        <button onClick={() => refetch()} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50">Retry</button>
      </div>
    );
  }
  if (!s) {
    return (
      <div className="space-y-4">
        {error && <p className="flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}</p>}
        <EmptyState onCreate={() => setShowCreate(true)} onTemplate={(preset) => { setForm((prev) => ({ ...prev, ...preset })); setShowCreate(true); }} canEdit={canEdit} />
        {showCreate && (
          <Modal onClose={() => setShowCreate(false)}>
            <CreateScopeForm form={form} setForm={setForm} assets={scopeAssets ?? []} sla={slaBySev} onSubmit={() => createMutation.mutate()} onCancel={() => setShowCreate(false)} pending={createMutation.isPending} />
          </Modal>
        )}
      </div>
    );
  }

  const findingsHref = `/vulnerabilities?ctem_scope_id=${s.id}&ctem_scope_name=${encodeURIComponent(s.name)}`;

  // ── Gated loop ────────────────────────────────────────────────────────────
  const sp = s.stageProgress ?? null;
  const gated = sp !== null;
  const g = {
    discover: !gated || !!sp?.discover,
    prioritise: !gated || !!sp?.prioritise,
    validate: !gated || !!sp?.validate,
    dispatch: !gated || !!sp?.dispatch,
  };
  const stageDone: Record<number, boolean> = {
    1: s.assets > 0,
    2: gated ? !!sp?.discover : s.findings > 0,
    3: gated ? !!sp?.prioritise : (s.buckets?.chainless ?? 0) === 0,
    4: gated ? !!sp?.validate : s.controls > 0,
    5: (s.tasks ?? 0) > 0 || s.fixes > 0,
  };
  const firstIncomplete = [1, 2, 3, 4, 5].find((n) => !stageDone[n]) ?? 5;
  const activeStage = activeStageRaw ?? firstIncomplete;
  const stageReachable = (n: number) => [1, 2, 3, 4].slice(0, n - 1).every((k) => stageDone[k]);

  // derived, per-scope numbers for the stat lines
  const findingsArr = scopeFindings ?? [];
  const real = s.analysable?.real_vulnerabilities ?? findingsArr.filter((v: any) => v.severity !== 'info').length;
  const info = s.analysable?.informational ?? findingsArr.filter((v: any) => v.severity === 'info').length;
  const awaiting = s.pipeline?.low_awaiting_review ?? 0;
  const assetByName = new Map((scopeAssets ?? []).map((a) => [a.name, a]));
  const exposedCount = s.machines.filter((m) => assetByName.get(m.name)?.internet_facing).length;

  const stageStat = (n: number): string => {
    if (n === 1) return `${s.assets} machine${s.assets === 1 ? '' : 's'}${scopeAssets ? ` · ${exposedCount} internet-facing` : ''}`;
    if (n === 2) return g.discover ? `${s.findings} findings · ${real} real / ${info} informational` : 'not run this cycle';
    if (n === 3) return g.prioritise ? `${real} prioritised · ${s.dangerous} confirmed reachable` : 'runs after Discover';
    if (n === 4) return g.validate ? `${s.controls} controls mapped${awaiting ? ` · ${awaiting} awaiting review` : ''}` : 'runs after Prioritise';
    return g.dispatch ? 'owners on the hook until re-scan' : 'unlocks when Validate dispatches';
  };
  const curStageLabel = (sc: Scope): string | null => {
    const p = sc.stageProgress; if (!p) return null;
    if (!p.discover) return 'Discover';
    if (!p.prioritise) return 'Prioritise';
    if (!p.validate || !p.dispatch) return 'Validate';
    return 'Mobilise';
  };

  const enterScope = (id: number, start = false) => {
    setSelId(id); setScreen('scope'); setActiveStage(null); setValTab('coverage'); setMobFilter('all'); setDiscAsset('all');
    if (start) openMutation.mutate(id);
  };

  /* ─────────────────── program home ─────────────────── */
  const kpiCell = (label: string, val: React.ReactNode, color?: string) => (
    <div style={{ flex: '1 1 90px', minWidth: 90 }}>
      <div style={SK}>{label}</div>
      <div style={{ ...SV, ...(color ? { color } : {}) }}>{val}</div>
    </div>
  );
  const hbar = (label: string, sub: string, val: React.ReactNode, pct: number, col: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <span style={{ width: 150, flex: 'none', fontSize: 11, color: SEC, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}{sub ? <span style={{ color: FAINT }}> · {sub}</span> : null}</span>
      <span style={{ flex: 1, height: 8, borderRadius: 999, background: '#F0F3F5', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: col, borderRadius: 999 }} /></span>
      <b style={{ width: 40, textAlign: 'right', fontSize: 12, ...MONO }}>{val}</b>
    </div>
  );
  const trends = () => {
    // Real labeled series: the worst scope's frozen findings per closed cycle + the live point.
    const w = portfolio.worst;
    const fmtShort = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
    const histPts = [...(w?.cycleHistory ?? [])]
      .filter((h) => h.findings != null)
      .sort((a, b) => a.no - b.no)
      .map((h) => ({ no: h.no, v: h.findings as number, sub: fmtShort(h.closed) || 'closed' }));
    const pts = w?.cycleOpen && w.findings != null ? [...histPts, { no: w.cycleNo, v: w.findings, sub: 'live' }] : histPts;
    const n = pts.length;
    const vmax = n ? Math.max(...pts.map((p) => p.v)) : 0;
    const vmin = n ? Math.min(...pts.map((p) => p.v)) : 0;
    const range = vmax - vmin || 1;
    const X = (i: number) => (n === 1 ? 160 : 22 + (i / (n - 1)) * (320 - 44));
    const Y = (v: number) => 32 + (1 - (v - vmin) / range) * 58;
    const line = pts.map((p, i) => `${X(i)},${Y(p.v)}`).join(' ');
    const area = n >= 2 ? `M ${X(0)},104 ` + pts.map((p, i) => `L ${X(i)},${Y(p.v)}`).join(' ') + ` L ${X(n - 1)},104 Z` : '';
    const chartCard = (title: string, sub: string, body: React.ReactNode) => (
      <div style={{ ...CARD, padding: '11px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}><b style={{ fontSize: 13, flex: 'none' }}>{title}</b><span style={{ fontSize: 10.5, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span></div>
        <div style={{ marginTop: 9 }}>{body}</div>
      </div>
    );
    return (
      <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10, alignItems: 'stretch' }}>
        {chartCard('Findings on scope', w ? `${w.name.length > 22 ? w.name.slice(0, 22) + '…' : w.name} · per cycle` : 'per cycle',
          n >= 2 ? (
            <svg viewBox="0 0 320 118" style={{ width: '100%', height: 108, display: 'block' }}>
              <line x1="8" y1="46" x2="312" y2="46" stroke={BORDER2} strokeWidth="1" />
              <line x1="8" y1="75" x2="312" y2="75" stroke={BORDER2} strokeWidth="1" />
              <line x1="8" y1="104" x2="312" y2="104" stroke={BORDER2} strokeWidth="1" />
              {area && <path d={area} fill={BLUE} opacity=".07" />}
              <polyline points={line} fill="none" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {pts.map((p, i) => (
                <g key={i}>
                  <circle cx={X(i)} cy={Y(p.v)} r={i === n - 1 ? 4.5 : 3.5} fill={BLUE} stroke="#fff" strokeWidth={i === n - 1 ? 2 : 1.5} />
                  <text x={X(i)} y={Y(p.v) - 9} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={BLUE}>{p.v}</text>
                  <text x={X(i)} y={116} textAnchor="middle" fontSize="9" fill="#9BA6B2">Cycle {p.no} · {p.sub}</text>
                </g>
              ))}
            </svg>
          ) : n === 1 ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}><b style={{ fontSize: 24, ...MONO, color: BLUE }}>{pts[0].v}</b><span style={{ fontSize: 11, color: MUTED }}>findings · Cycle {pts[0].no} live</span></div>
              <div style={{ fontSize: 10.5, color: FAINT, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BORDER2}` }}>The trend line builds as you close cycles — each close freezes a point.</div>
            </>
          ) : <div style={{ fontSize: 11.5, color: MUTED, padding: '8px 4px' }}>No cycles yet — open one and the trend starts here.</div>)}
        {chartCard('Fixed ✓ by re-scan', 'the only thing that moves the score',
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}><b style={{ fontSize: 24, ...MONO, color: GREEN }}>{portfolio.fixed}</b><span style={{ fontSize: 11, color: MUTED }}>re-scan-verified closures · Cycle {w?.cycleNo ?? 1} live</span></div>
            <div style={{ fontSize: 10.5, color: FAINT, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BORDER2}` }}>Closed cycles will add rows here — per-cycle fixed counts aren&apos;t frozen in the snapshot yet.</div>
          </>)}
        {chartCard('Control coverage', 'share of real vulns with an addressing control',
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}><b style={{ fontSize: 24, ...MONO, color: VIOLET }}>{portfolio.coverage}%</b><span style={{ fontSize: 11, color: MUTED }}>of real vulns · Cycle {w?.cycleNo ?? 1} live</span></div>
            <div style={{ marginTop: 7 }}>{hbar('Coverage', 'across all scopes', `${portfolio.coverage}%`, portfolio.coverage, VIOLET)}</div>
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BORDER2}` }}>Coverage is <b>claimed</b> until a re-scan proves the control effective — per-cycle history isn&apos;t frozen yet.</div>
          </>)}
        {chartCard('Discovery mix', w ? 'worst scope · real vs informational' : 'real vs informational',
          w ? (
            <>
              {hbar('Total findings', 'on this scope', w.findings, 100, BLUE)}
              {hbar('Real vulnerabilities', 'actionable', w.analysable?.real_vulnerabilities ?? 0, w.findings ? ((w.analysable?.real_vulnerabilities ?? 0) / w.findings) * 100 : 0, REDD)}
              {hbar('Informational', 'excluded from action', w.analysable?.informational ?? 0, w.findings ? ((w.analysable?.informational ?? 0) / w.findings) * 100 : 0, '#8A95A1')}
              <div style={{ fontSize: 10.5, color: FAINT, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BORDER2}` }}>Only real vulnerabilities move through Prioritise → Validate → Mobilise.</div>
            </>
          ) : <div style={{ fontSize: 11.5, color: MUTED, padding: '14px 4px' }}>Opens with your first scope.</div>)}
      </div>
      <div style={{ fontSize: 10.5, color: FAINT, margin: '8px 4px 0' }}>Feeds the Performance Overview cyber KPIs — assets free of open critical/high vulns, vulnerabilities within remediation SLA.</div>
      </>
    );
  };
  const scopeCard = (sc: Scope) => {
    const open = sc.cycleOpen;
    const cur = curStageLabel(sc);
    const fixed = sc.closedVerified ?? 0;
    const num = (label: string, val: React.ReactNode, color?: string) => (
      <div><div style={{ ...SK, ...(color ? { color } : {}) }}>{label}</div><div style={{ fontSize: 15, fontWeight: 700, ...MONO, ...(color ? { color } : {}) }}>{val}</div></div>
    );
    return (
      <div key={sc.id} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '11px 14px', marginBottom: 10 }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: ACSOFT, color: ACS, display: 'grid', placeItems: 'center', flex: 'none' }}><Crosshair className="h-[18px] w-[18px]" /></span>
        <div style={{ minWidth: 0, flex: '1 1 210px' }}>
          <b style={{ fontSize: 13.5 }}>{sc.name}</b> <span style={{ color: MUTED, fontSize: 11.5 }}>{membText(sc)} · owner {sc.owner ?? 'Unassigned'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {open ? (
              <>
                <Pill bg={ACSOFT} c={ACS}>● Cycle #{sc.cycleNo} · Open{sc.cycleDay != null ? ` · day ${sc.cycleDay}` : ''}</Pill>
                {sc.cycleOverdue
                  ? <Pill bg={REDBG} c={RED}>Overdue</Pill>
                  : sc.cycleDueAt ? <span style={{ fontSize: 10.5, color: AMBER, fontWeight: 600 }}>due {fmtDate(sc.cycleDueAt)}</span> : null}
                {cur && <span style={{ fontSize: 10.5, color: FAINT }}>at <b style={{ color: SEC }}>{cur}</b></span>}
              </>
            ) : (
              <>
                <Pill bg="#EEF1F3" c="#475569">■ No cycle running</Pill>
                <span style={{ fontSize: 10.5, color: FAINT }}>last closed {fmtDate(sc.lastClosed)} · {(sc.cycleHistory?.length ?? 0)} in history</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', flex: 'none' }}>
          {num('Findings', sc.findings)}
          {num('Dangerous', sc.dangerous, REDD)}
          {num('Fixed ✓', fixed, GREEN)}
        </div>
        <div style={{ marginLeft: 'auto', flex: 'none', display: 'flex', gap: 7 }}>
          {open
            ? <Btn sm onClick={() => enterScope(sc.id)}>Open →</Btn>
            : <>
                <Btn sm onClick={() => enterScope(sc.id)}>History →</Btn>
                {canEdit && <Btn green sm onClick={() => enterScope(sc.id, true)}>▶ Start Cycle #{sc.cycleNo + 1}</Btn>}
              </>}
        </div>
      </div>
    );
  };
  const homeScreen = () => {
    const worstFirst = [...SCOPES].sort((a, b) =>
      (Number(!!(b.cycleOpen && b.cycleOverdue)) - Number(!!(a.cycleOpen && a.cycleOverdue)))
      || (b.dangerous - a.dangerous) || (b.findings - a.findings));
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', maxWidth: 1060, width: '100%', margin: '0 auto', padding: '4px 18px 0' }}>
        {/* pinned header — title + KPI strip stay put; only Trends/Scopes below scroll */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: 22, letterSpacing: '-.025em', fontWeight: 600 }}>Exposure program</h1>
              <p style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>Owned slices of the attack surface, each worked as open→close cycles.</p>
            </div>
            {canEdit && <Btn green onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New scope</Btn>}
          </div>
          <div style={{ ...STRIP, marginBottom: 6, alignItems: 'stretch', background: '#fff', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
            {kpiCell('Scopes', portfolio.scopes)}{SEP}
            {kpiCell('Open cycles', portfolio.openCycles, ACS)}{SEP}
            {kpiCell('Overdue', portfolio.overdue, portfolio.overdue ? RED : GREEN)}{SEP}
            {kpiCell('Findings', portfolio.findings)}{ARROW}
            {kpiCell('Dangerous', portfolio.dangerous, REDD)}{ARROW}
            {kpiCell('Mobilised', portfolio.mobilised, BLUE)}{ARROW}
            {kpiCell('Fixed ✓', portfolio.fixed, GREEN)}
          </div>
          <div style={{ fontSize: 10.5, color: FAINT, margin: '0 4px 10px' }}>Findings → dangerous → mobilised → fixed ✓ across all scopes · only a re-scan closure moves the score.</div>
        </div>
        {/* scrolling content */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '2px 2px 6px' }}><b style={{ fontSize: 14 }}>Trends</b><span style={{ fontSize: 11.5, color: MUTED }}>across closed cycles · progress is provable period over period</span></div>
          {trends()}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 2px 6px' }}><b style={{ fontSize: 14 }}>Scopes</b><span style={{ fontSize: 11.5, color: MUTED }}>each runs its own cycles, in parallel · worst first</span></div>
          {worstFirst.map(scopeCard)}
        </div>
      </div>
    );
  };

  /* ─────────────────── scope journey ─────────────────── */
  const commandBar = () => {
    const chip = s.cycleOpen
      ? <Pill bg={ACSOFT} c={ACS}>● Cycle #{s.cycleNo} · Open{s.cycleDay != null ? ` · day ${s.cycleDay}` : ''}</Pill>
      : <Pill bg="#EEF1F3" c="#475569">■ No cycle running</Pill>;
    return (
      <div style={{ ...CARD, padding: 0, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '11px 14px' }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, background: ACSOFT, color: ACS, display: 'grid', placeItems: 'center', flex: 'none' }}><Crosshair className="h-5 w-5" /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{s.name} <span style={{ color: MUTED, fontWeight: 500, fontSize: 12.5 }}>{membText(s)}</span></div>
            <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {chip}
              {s.cycleOpen && s.cycleDueAt && (
                <Pill bg={s.cycleOverdue ? REDBG : '#F7F9FA'} c={s.cycleOverdue ? RED : SEC}>
                  {s.cycleOverdue ? `Overdue — was due ${fmtDate(s.cycleDueAt)}` : `Cycle ends ${fmtDate(s.cycleDueAt)}`}
                </Pill>
              )}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn sm onClick={() => setShowHistory(true)}>History <b style={MONO}>{s.cycleHistory?.length ?? 0}</b></Btn>
            <Link href={findingsHref} style={{ textDecoration: 'none' }}><Btn sm><ExternalLink className="h-3.5 w-3.5" /> View findings</Btn></Link>
            {canEdit && (s.cycleOpen
              ? <Btn sm disabled={closeMutation.isPending || !s.cycleId} title="Close this cycle — freezes today's numbers as a permanent record." onClick={() => s.cycleId && closeMutation.mutate(s.cycleId)}>{closeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} Close &amp; save</Btn>
              : <Btn green sm disabled={openMutation.isPending} onClick={() => openMutation.mutate(s.id)}>{openMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} ▶ Start Cycle #{s.cycleNo + 1}</Btn>)}
            {canEdit && (
              <Btn sm title="Delete this scope. A scope with closed (frozen) cycles can't be deleted." disabled={deleteMutation.isPending} style={{ color: REDD }}
                onClick={() => { if (window.confirm(`Delete scope “${s.name}”? This removes the scope and any open cycle. Findings and assets are not touched.`)) deleteMutation.mutate(s.id); }}>
                {deleteMutation.isPending && deleteMutation.variables === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
              </Btn>
            )}
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${BORDER2}`, padding: '9px 18px', display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: MUTED, alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 18, height: 18, borderRadius: 999, background: s.owner ? ACSOFT : '#EEF1F3', color: s.owner ? ACS : FAINT, fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{s.owner ? initials(s.owner) : '?'}</span>
            Owner <b style={{ color: s.owner ? SEC : RED }}>{s.owner ?? 'Unassigned'}</b>
          </span>
          <span style={{ color: '#D2D8DE' }}>·</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Calendar className="h-3.5 w-3.5" /> {s.cadence} cadence</span>
          <span style={{ color: '#D2D8DE' }}>·</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Table2 className="h-3.5 w-3.5" /> {membText(s)}</span>
        </div>
      </div>
    );
  };

  const closedState = () => (
    <>
      <div style={{ ...CARD, padding: '38px 24px', textAlign: 'center', marginBottom: 10 }}>
        <span style={{ width: 54, height: 54, borderRadius: 15, background: '#EEF1F3', color: '#94A3B8', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}><Crosshair className="h-[26px] w-[26px]" /></span>
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>No cycle is running on this scope</h3>
        <p style={{ fontSize: 12, color: MUTED, maxWidth: 440, margin: '8px auto 18px', lineHeight: 1.55 }}>The last cycle is frozen in history below. Start a new cycle to re-scan, re-prioritise and measure deltas against it.</p>
        {canEdit && <div style={{ display: 'inline-flex' }}><Btn green onClick={() => openMutation.mutate(s.id)} disabled={openMutation.isPending}>{openMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} ▶ Start Cycle #{s.cycleNo + 1}</Btn></div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 2px 10px' }}><b style={{ fontSize: 14 }}>Cycle history</b><span style={{ fontSize: 11.5, color: MUTED }}>frozen snapshots · deltas compare cycle over cycle</span></div>
      {historyTable()}
    </>
  );

  const historyTable = () => {
    const h = s.cycleHistory ?? [];
    if (h.length === 0) return <div style={{ border: '1px dashed #D8DFE4', borderRadius: 11, background: '#FAFBFC', padding: 22, textAlign: 'center', color: MUTED, fontSize: 12 }}>No closed cycles yet — closing a cycle freezes its snapshot here.</div>;
    return (
      <div style={{ ...CARD, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Cycle', 'Window', 'Findings', 'Dangerous', 'Mobilised', 'Fixed ✓', 'Coverage', 'Membership hash'].map((c) => <th key={c} style={TH}>{c}</th>)}</tr></thead>
            <tbody>
              {h.map((c) => (
                <tr key={c.no}>
                  <td style={TD}><b>Cycle #{c.no}</b></td>
                  <td style={{ ...TD, color: MUTED }}>{fmtDate(c.opened)} → {fmtDate(c.closed)}</td>
                  <td style={{ ...TD, ...MONO }}>{c.findings ?? '—'}</td>
                  <td style={{ ...TD, ...MONO, color: REDD }}>{c.dangerous ?? '—'}</td>
                  <td style={{ ...TD, ...MONO, color: BLUE }}>{c.mobilised ?? '—'}</td>
                  <td style={{ ...TD, ...MONO, color: GREEN }} title="Per-cycle fixed isn't frozen in the snapshot">—</td>
                  <td style={{ ...TD, ...MONO }} title="Per-cycle coverage isn't frozen in the snapshot">—</td>
                  <td style={{ ...TD, ...MONO, fontSize: 10, color: FAINT }} title="SHA-256 of the sorted member-asset ids">{c.hash || '—'}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const sectionDesc = (desc: React.ReactNode, actions?: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
      <p style={{ fontSize: 12, color: MUTED, maxWidth: 620, lineHeight: 1.55 }}>{desc}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 'none' }}>{actions}</div>
    </div>
  );

  /* ── stage bodies ── */
  const renderScope = () => (
    <>
      {sectionDesc(<>A scope is a fixed set of assets. Every stage below counts findings on <b>these machines only</b>; membership freezes into each closed cycle.</>,
        <><Btn sm onClick={() => notify('Edit scope assets — searchable multi-select (coming soon).')}>＋ Edit assets</Btn><Link href="/assets" style={{ textDecoration: 'none' }}><Btn sm>Open in Inventory →</Btn></Link></>)}
      <div style={{ ...STRIP, marginBottom: 12 }}>
        <div><div style={SK}>Machines</div><div style={SV}>{s.machines.length}</div></div>{SEP}
        <div><div style={SK}>Findings on scope</div><div style={SV}>{s.findings}</div></div>{SEP}
        <div><div style={SK}>Internet-exposed</div><div style={{ ...SV, color: exposedCount ? RED : SEC }}>{scopeAssets ? `${exposedCount} of ${s.machines.length}` : '—'}</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(250px,100%),1fr))', gap: 10 }}>
        {s.machines.map((m) => {
          const exp = assetByName.get(m.name)?.internet_facing;
          return (
            <Link key={m.id} href={`/assets/${m.id}`} style={{ textDecoration: 'none', color: 'inherit', border: `1px solid ${BORDER}`, borderRadius: 11, padding: '10px 13px', display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: riskColor(m.risk), marginTop: 5, flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div><div style={{ fontSize: 10.5, color: MUTED }}>{m.type}</div></div>
                {exp ? <Pill bg={REDBG} c={RED}>Internet-facing</Pill> : scopeAssets ? <Pill bg="#EEF1F3" c="#6B7787">Internal</Pill> : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 }}><b style={{ fontSize: 20, ...MONO }}>{m.findings}</b><span style={{ fontSize: 10.5, color: MUTED }}>findings</span></div>
            </Link>
          );
        })}
      </div>
    </>
  );

  const gateBlank = (n: number, action: React.ReactNode) => {
    const prev = ['', 'Scope', 'Discover', 'Prioritise', 'Validate'][n - 1];
    return (
      <div style={{ textAlign: 'center', padding: '30px 12px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>This stage hasn&apos;t run in cycle #{s.cycleNo} yet.</div>
        <div style={{ color: MUTED, maxWidth: 420, margin: '6px auto 15px', fontSize: 11.5 }}>It can run only once <b>{prev}</b> is done — one stage at a time.</div>
        {action}
      </div>
    );
  };

  const renderDiscover = () => {
    if (gated && !g.discover) return gateBlank(2, canEdit ? <div style={{ display: 'inline-flex' }}><Btn green disabled={completeStage.isPending || !stageReachable(2)} onClick={() => completeStage.mutate({ scopeId: s.id, stage: 'discover' })}>{completeStage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} ▶ Run discovery for this cycle</Btn></div> : null);
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const sorted = [...findingsArr].sort((a: any, b: any) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || (Number(b.cvss_score ?? 0) - Number(a.cvss_score ?? 0)));
    const rows = discAsset === 'all' ? sorted : sorted.filter((v: any) => (v.linked_assets ?? []).includes(discAsset));
    const machineNames = Array.from(new Set(s.machines.map((m) => m.name)));
    return (
      <>
        {sectionDesc(<>Everything the scanner sees on the scoped machines, <b>as-is and unscored</b> — ranking happens in Prioritise.</>,
          <><Btn sm disabled={!stageReachable(2)} onClick={() => stageReachable(2) && completeStage.mutate({ scopeId: s.id, stage: 'discover' })}>↻ Re-run discovery</Btn><Link href={findingsHref} style={{ textDecoration: 'none' }}><Btn sm>Open in register →</Btn></Link></>)}
        <div style={{ ...STRIP, marginBottom: 12 }}>
          <div><div style={SK}>Total findings</div><div style={SV}>{s.findings}</div></div>{SEP}
          <div><div style={SK}>Real vulnerabilities</div><div style={{ ...SV, color: GREEN }}>{real}</div><div style={{ fontSize: 10, color: FAINT }}>carry a CVE → proceed</div></div>{SEP}
          <div><div style={SK}>Informational</div><div style={{ ...SV, color: MUTED }}>{info}</div><div style={{ fontSize: 10, color: FAINT }}>nothing to fix · excluded</div></div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: MUTED }}>Asset</span>
            <select value={discAsset} onChange={(e) => setDiscAsset(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 9, padding: '6px 10px', fontSize: 11.5, background: '#fff', cursor: 'pointer' }}>
              <option value="all">All assets ({s.findings})</option>
              {machineNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div style={{ overflowX: 'auto', border: `1px solid ${BORDER}`, borderRadius: 11 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Finding', 'Machine', 'Type', 'Severity', 'CVSS', 'KEV', 'First seen'].map((c) => <th key={c} style={TH}>{c}</th>)}</tr></thead>
            <tbody>
              {!scopeFindings && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: FAINT }}>Loading scanner results…</td></tr>}
              {rows.map((v: any) => {
                const isInfo = v.severity === 'info';
                const hasScore = !isInfo && v.cvss_score != null && Number(v.cvss_score) > 0;
                return (
                  <tr key={v.id} onClick={() => router.push(`/vulnerabilities/${v.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...TD, fontWeight: 500 }}>{v.title}</td>
                    <td style={{ ...TD, ...MONO, color: MUTED }}>{(v.linked_assets ?? [])[0] ?? '—'}{(v.linked_assets ?? []).length > 1 ? ` +${v.linked_assets.length - 1}` : ''}</td>
                    <td style={{ ...TD, fontSize: 10, color: isInfo ? MUTED : GREEN, fontWeight: 600 }}>{isInfo ? 'Info' : 'Real'}</td>
                    <td style={TD}><SevBadge sev={v.severity} /></td>
                    <td style={{ ...TD, ...MONO }}>{hasScore ? Number(v.cvss_score).toFixed(1) : '—'}</td>
                    <td style={TD}>{v.kev_flag ? <span style={{ background: '#FBEAEA', color: '#C2453F', fontWeight: 700, fontSize: 9, padding: '1px 6px', borderRadius: 5 }}>KEV</span> : <span style={{ color: FAINT }}>—</span>}</td>
                    <td style={{ ...TD, color: MUTED }}>{fmtDate(v.first_detected_at ?? v.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10.5, color: FAINT, marginTop: 9 }}>Same rows as the vulnerabilities register, filtered to this scope. Click a row to open the finding.</div>
      </>
    );
  };

  const renderPrioritise = () => {
    if (gated && !g.prioritise) return gateBlank(3, canEdit ? <div style={{ display: 'inline-flex' }}><Btn green disabled={computePaths.isPending || !stageReachable(3)} onClick={() => computePaths.mutate(s.id)}>{computePaths.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />} {computePaths.isPending ? 'Analysing attack paths…' : '▶ Run prioritisation'}</Btn></div> : null);
    const sevRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const ranked = [...findingsArr].filter((v: any) => v.severity !== 'info').sort((a: any, b: any) =>
      ((b.composite_priority ?? -1) - (a.composite_priority ?? -1))
      || (Number(!!b.kev_flag) - Number(!!a.kev_flag))
      || ((b.epss_score ?? 0) - (a.epss_score ?? 0))
      || ((b.cvss_score ?? 0) - (a.cvss_score ?? 0))
      || ((sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0)));
    const dangerSet = new Set(s.dangerousIds ?? []);
    return (
      <>
        {sectionDesc(<>The reachability engine scores each <b>real</b> vulnerability /100 <b>on this host</b> — severity (abstract), raw CVSS and /100 (here) are different things. Informational excluded.</>,
          canEdit ? <Btn sm disabled={computePaths.isPending} onClick={() => computePaths.mutate(s.id)}>{computePaths.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} ↻ Recalculate attack paths</Btn> : null)}
        <div style={{ ...STRIP, marginBottom: 12 }}>
          <div><div style={{ ...SK, color: REDD }}>Confirmed reachable</div><div style={{ ...SV, color: REDD }}>{s.buckets.ranked}</div><div style={{ fontSize: 10, color: FAINT }}>fix first</div></div>{SEP}
          <div><div style={SK}>Can&apos;t tell yet</div><div style={{ ...SV, color: AMBER }}>{s.buckets.undeterminable}</div></div>{SEP}
          <div><div style={SK}>Not calculated</div><div style={{ ...SV, color: '#6B7787' }}>{s.buckets.chainless}</div></div>{SEP}
          <div><div style={SK}>Blocked / severed</div><div style={{ ...SV, color: GREEN }}>{s.buckets.severed}</div></div>
        </div>
        {!scopeFindings ? <p style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, color: FAINT }}>Loading…</p>
          : ranked.length === 0 ? <p style={{ borderRadius: 10, background: '#F7F9FA', padding: 12, fontSize: 11.5, color: MUTED }}>Only informational notes in this scope — nothing carries a CVE/CVSS to rank.</p>
          : (showAllRanked ? ranked : ranked.slice(0, 12)).map((v: any, i: number) => {
            const score = v.composite_priority != null ? Math.round(Number(v.composite_priority) * 10) : null;
            const reachable = dangerSet.has(v.id);
            return (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 13, borderBottom: `1px solid ${BORDER2}`, padding: '11px 4px' }}>
                <div style={{ width: 20, flex: 'none', textAlign: 'center', fontWeight: 700, color: FAINT, fontSize: 12, ...MONO }}>{i + 1}</div>
                <Link href={`/vulnerabilities/${v.id}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>{v.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 3, fontSize: 10.5, color: FAINT }}>
                    <SevBadge sev={v.severity} />
                    <span>CVSS {v.cvss_score != null ? Number(v.cvss_score).toFixed(1) : '—'}</span>
                    {v.epss_score != null && <span style={{ color: AMBER }}>EPSS {Math.round(Number(v.epss_score) * 100)}%</span>}
                    {(v.linked_assets ?? [])[0] && <span>{v.linked_assets[0]}</span>}
                    {v.kev_flag && <Kev />}
                    {reachable && <span style={{ color: RED, fontWeight: 600 }}>✓ confirmed reachable</span>}
                  </div>
                </Link>
                <div style={{ flex: 'none', textAlign: 'right' }}>
                  <span style={{ fontSize: 16, fontWeight: 700, ...MONO, color: score != null && score >= 80 ? REDD : score != null && score >= 50 ? AMBER : GREEN }}>{score ?? '—'}</span>
                  <span style={{ fontSize: 9, color: FAINT }}>/100 on host</span>
                </div>
              </div>
            );
          })}
        {ranked.length > 12 && <button onClick={() => setShowAllRanked((x) => !x)} style={{ marginTop: 9, fontSize: 12, fontWeight: 500, color: ACS, background: 'none', border: 0, cursor: 'pointer' }}>{showAllRanked ? 'Show fewer' : `Show all ${ranked.length}`}</button>}
        <div style={{ fontSize: 10.5, color: FAINT, marginTop: 9 }}>Ranked by contextual /100 on host · only reachable + prioritised findings proceed to Validate.</div>
      </>
    );
  };

  const renderValidate = () => {
    if (gated && !g.validate) {
      return (
        <div style={{ textAlign: 'center', padding: '16px 12px' }}>
          {mappingRunning || mapControls.isPending ? (
            <>
              <p style={{ fontSize: 13.5, fontWeight: 600 }}><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" style={{ color: VIOLET }} /> AI validation is running…</p>
              <p style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>Runs on the server — leave this page and come back; nothing is lost. Mobilise unlocks when it finishes.</p>
              <div style={{ maxWidth: 460, margin: '14px auto 0' }}>
                <div style={{ height: 10, borderRadius: 999, background: '#EAEEF1', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 999, background: VIOLET, width: `${Math.max(6, Math.round(((aiRun?.findings_sent ?? 0) / Math.max(1, aiRun?.findings_total ?? 1)) * 100))}%`, transition: 'width .7s' }} /></div>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Validation hasn&apos;t run in cycle #{s.cycleNo} yet.</div>
              <div style={{ color: MUTED, maxWidth: 460, margin: '6px auto 15px', fontSize: 11.5 }}>The AI reads each vulnerability against your locked control library — sure picks auto-link (reversible), weak ones wait for review. It auto-stamps this stage when the run finishes.</div>
              {canEdit && <div style={{ display: 'inline-flex' }}><Btn green disabled={mapControls.isPending || !stageReachable(4)} onClick={() => mapControls.mutate()}><ShieldCheck className="h-4 w-4" /> ▶ Run AI validation</Btn></div>}
            </>
          )}
        </div>
      );
    }
    const p = s.pipeline;
    const analysed = p?.analysed ?? real;
    const linked = p?.linked ?? 0;
    const proven = s.tested + (s.verified ?? 0);
    const covPct = analysed > 0 ? Math.round((linked / analysed) * 100) : 0;
    const tabDef: [typeof valTab, string, number | null][] = [
      ['coverage', 'Coverage', null], ['review', 'Review queue', awaiting || null], ['control', 'By control', s.cw.length || null], ['decisions', 'Decisions', null],
    ];
    const chips = (codes: string[]) => codes.map((c) => <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: VIOLETBG, color: VIOLET, borderRadius: 7, padding: '2px 8px', fontSize: 10.5, fontWeight: 600, margin: '2px 4px 0 0' }}>{c}</span>);
    return (
      <>
        {sectionDesc(<>The AI links each real vulnerability to the control(s) that <b>address</b> it — the fix to implement. A link never closes a finding or lowers its score; only a re-scan does.</>,
          <>{canEdit && <Btn sm disabled={mapControls.isPending || mappingRunning} onClick={() => mapControls.mutate()}>{(mapControls.isPending || mappingRunning) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} ↻ Re-run mapping</Btn>}
            {gated && (sp?.dispatch ? <Pill bg={GREENBG} c={GREEN}>✓ Dispatched</Pill>
              : canEdit ? <Btn green sm disabled={completeStage.isPending} title="Hand the linked vulnerabilities to Mobilise" onClick={() => completeStage.mutate({ scopeId: s.id, stage: 'dispatch' })}>{completeStage.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Dispatch to Mobilise →</Btn> : null)}
          </>)}
        <div style={{ ...STRIP, marginBottom: 12, alignItems: 'center' }}>
          <div><div style={SK}>Covered</div><div style={{ ...SV, color: GREEN }}>{linked}</div></div>{SEP}
          <div><div style={SK}>Awaiting review</div><div style={{ ...SV, color: AMBER }}>{awaiting}</div></div>{SEP}
          <div><div style={SK}>Proven effective</div><div style={SV}>{proven}<span style={{ fontSize: 11, color: FAINT }}> of {s.controls}</span></div><div style={{ fontSize: 10, color: FAINT }}>re-scan verified · rest claimed</div></div>
          <div style={{ flex: 1, minWidth: 130, display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'flex-end' }}>
            <span style={{ flex: '0 1 150px', height: 9, borderRadius: 99, background: '#EAEEF1', overflow: 'hidden', display: 'flex' }}><i style={{ width: `${covPct}%`, background: AC }} /><i style={{ flex: 1, background: '#E0AF33' }} /></span>
            <b style={{ fontSize: 12, ...MONO }}>{covPct}%</b>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10 }}>
          {tabDef.map(([id, label, n]) => {
            const on = valTab === id;
            return (
              <button key={id} onClick={() => setValTab(id)} style={{ border: `1px solid ${on ? AC : BORDER}`, background: on ? ACSOFT : '#fff', color: on ? '#0A5A4B' : SEC, borderRadius: 999, padding: '6px 13px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {label}{n ? <span style={{ ...MONO, background: on ? '#fff' : '#EEF1F3', color: id === 'review' ? AMBER : '#6B7787', borderRadius: 99, padding: '0 6px', fontSize: 10 }}>{n}</span> : null}
              </button>
            );
          })}
        </div>
        {valTab === 'review' ? <AiControlProposalsPanel scopeId={s.id} />
          : valTab === 'control' ? renderByControl()
          : valTab === 'decisions' ? renderDecisions()
          : /* coverage */ (() => {
            const covered = findingsArr.filter((v: any) => v.severity !== 'info' && Array.isArray(v.linked_control_codes) && v.linked_control_codes.length > 0);
            if (!scopeFindings) return <p style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, color: FAINT }}>Loading…</p>;
            if (covered.length === 0) return <div style={{ border: '1px solid #BFE9DD', background: '#F0FDF4', borderRadius: 11, padding: 16, textAlign: 'center', fontSize: 12, color: '#065F46' }}>No control links yet — run the mapping, then covered findings and their controls show here.</div>;
            return <>{covered.map((v: any) => (
              <div key={v.id} onClick={() => setPeek(v)} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, borderBottom: `1px solid ${BORDER2}`, padding: '11px 4px', flexWrap: 'wrap', cursor: 'pointer' }}>
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>{v.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 3, fontSize: 10.5, color: FAINT }}><SevBadge sev={v.severity} /><span style={MONO}>{v.composite_priority != null ? `${Math.round(Number(v.composite_priority) * 10)}/100` : '—'}</span>{(v.linked_assets ?? [])[0] && <span>{v.linked_assets[0]}</span>}{v.kev_flag && <Kev />}</div>
                </div>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}><div style={{ fontSize: 9.5, color: FAINT, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Addressed by</div><div>{chips(v.linked_control_codes)}</div></div>
                <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}><Pill bg={GREENBG} c={GREEN}>auto-linked</Pill></div>
              </div>
            ))}
              <div style={{ fontSize: 10.5, color: FAINT, marginTop: 9 }}>A link is the fix to implement — it never closes a finding or lowers its score. Reject a wrong link from the finding&apos;s control popup on Mobilise.</div>
            </>;
          })()}
      </>
    );
  };

  const renderByControl = () => {
    const children = new Map<number, ControlItem[]>();
    s.cw.forEach((c) => { if (c.kind === 'parsed_framework_control' && c.family_of) children.set(c.family_of, [...(children.get(c.family_of) ?? []), c]); });
    const rows = s.cw.filter((c) => !(c.kind === 'parsed_framework_control' && c.family_of));
    if (rows.length === 0) return <div style={{ border: '1px dashed #D8DFE4', borderRadius: 11, background: '#FAFBFC', padding: 18, textAlign: 'center', color: MUTED, fontSize: 12 }}>No controls mapped yet — run the AI mapping to populate this.</div>;
    const shown = showAllCw ? rows : rows.slice(0, 8);
    const basisLabel: Record<string, string> = { ai: 'AI · accepted', ai_auto: 'AI · auto-linked', ai_family: 'AI · via group', reused: 'reused decision', manual: 'manual' };
    return (
      <>
        <div style={{ overflowX: 'auto', border: `1px solid ${BORDER}`, borderRadius: 11 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Control', 'Satisfies these standards', 'Addresses', 'Why linked'].map((c) => <th key={c} style={TH}>{c}</th>)}</tr></thead>
            <tbody>
              {shown.map((c) => {
                const covered = Array.isArray(c.covered_ids) ? c.covered_ids : [];
                const ok = c.basis === 'ai' || c.basis === 'ai_auto' || c.basis === 'ai_family' || c.basis === 'reused';
                return (
                  <tr key={`${c.kind}-${c.control_id ?? c.code}`}>
                    <td style={TD}><b style={MONO}>{c.code}</b><div style={{ color: MUTED, fontSize: 10.5 }}>{c.title}</div></td>
                    <td style={TD}>{(c.standards ?? [c.fw]).filter(Boolean).map((t) => <span key={t} style={{ display: 'inline-block', border: `1px solid #E4E8EC`, background: '#F7F9FA', borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 600, color: '#5B6673', margin: '2px 3px 0 0' }}>{t}</span>)}</td>
                    <td style={TD}><Btn sm disabled={c.findings === 0} onClick={() => setCtrlPopup({ id: c.control_id ?? 0, code: c.code, name: c.title, coveredIds: covered, findings: c.findings })}><b style={MONO}>{c.findings}</b> findings</Btn></td>
                    <td style={TD}><Pill bg={ok ? VIOLETBG : AMBERBG} c={ok ? VIOLET : AMBER}>{basisLabel[c.basis as string] ?? 'crosswalk rule'}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > 8 && <button onClick={() => setShowAllCw((v) => !v)} style={{ marginTop: 9, fontSize: 12, fontWeight: 500, color: ACS, background: 'none', border: 0, cursor: 'pointer' }}>{showAllCw ? 'Show fewer' : `Show all ${rows.length} controls`}</button>}
        <div style={{ fontSize: 10.5, color: FAINT, marginTop: 9 }}>Click a finding count to see exactly which vulnerabilities a control addresses. None are test-verified until a re-scan proves the control effective.</div>
      </>
    );
  };

  const renderDecisions = () => {
    if (!valDecisions) return <p style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, color: FAINT }}>Loading decisions…</p>;
    const items = [
      ...valDecisions.accepted.map((x: any) => ({ ...x, _d: 'accepted' as const })),
      ...valDecisions.rejected.map((x: any) => ({ ...x, _d: 'rejected' as const })),
    ].sort((a: any, b: any) => new Date(b.decided_at ?? 0).getTime() - new Date(a.decided_at ?? 0).getTime());
    if (items.length === 0) return <div style={{ border: '1px dashed #D8DFE4', borderRadius: 11, background: '#FAFBFC', padding: 18, textAlign: 'center', color: MUTED, fontSize: 12 }}>No overrides yet — every AI mapping stands as proposed. Each accept/reject lands here for the audit trail.</div>;
    return <>{items.map((x: any) => (
      <div key={`${x._d}-${x.id}`} style={{ display: 'flex', alignItems: 'center', gap: 11, borderBottom: `1px solid ${BORDER2}`, padding: '10px 4px' }}>
        <Pill bg={x._d === 'accepted' ? GREENBG : REDBG} c={x._d === 'accepted' ? GREEN : RED}>{x._d === 'accepted' ? '✓ Accepted' : '✗ Rejected'}</Pill>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 12 }}>{x.vulnerability?.title || x.vulnerability?.vuln_id || `#${x.vulnerability?.id}`}</b>
          <div style={{ fontSize: 10.5, color: FAINT }}>{x.control?.code}{x.control?.name ? ` · ${x.control.name}` : ''} · {x.decided_at ? new Date(x.decided_at).toLocaleString() : 'recently'}</div>
        </div>
      </div>
    ))}</>;
  };

  const workRow = (v: any) => {
    const st: 'unassigned' | 'inprogress' = v.assigned_to || v.assignee_name ? 'inprogress' : 'unassigned';
    const un = st === 'unassigned';
    const controls: string[] = Array.isArray(v.linked_control_codes) ? v.linked_control_codes : [];
    const score = v.composite_priority != null ? Math.round(Number(v.composite_priority) * 10) : null;
    return (
      <div key={v.id} style={{ border: `1px solid ${un ? AMBERLINE : BORDER}`, background: un ? '#FFFDF5' : '#fff', borderRadius: 11, padding: '11px 13px', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <Link href={`/vulnerabilities/${v.id}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontWeight: 600, fontSize: 12.5 }}>{v.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4, color: FAINT, fontSize: 10.5 }}><SevBadge sev={v.severity} />{(v.linked_assets ?? [])[0] && <span>{v.linked_assets[0]}</span>}{score != null && <span style={MONO}>{score}/100</span>}{v.kev_flag && <Kev />}</div>
          </Link>
          <Pill bg={un ? AMBERBG : '#E9F1FB'} c={un ? AMBER : BLUE}>{un ? 'Needs owner' : 'In progress'}</Pill>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 9, paddingTop: 8, borderTop: `1px solid ${un ? '#F1E9D2' : BORDER2}` }}>
          <span style={{ flex: 'none' }}><MobiliseControlCell vulnId={v.id} count={controls.length} canEdit={canEdit} onChanged={() => qc.invalidateQueries({ queryKey: ['ctem.scope-findings'] })} /></span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: SEC }}>{v.assignee_name
            ? <><span style={{ width: 18, height: 18, borderRadius: 999, background: '#E2E8F0', color: '#475569', fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: -3, marginRight: 5 }}>{initials(String(v.assignee_name))}</span>{v.assignee_name}</>
            : <span style={{ color: AMBER }}>No owner yet</span>}</span>
          {canEdit && <Btn green={un} sm style={{ flex: 'none' }} onClick={() => { setAssigning({ id: v.id, title: v.title } as any); setAssigneeId(''); setApproverId(''); setAssigneeQuery(''); }}>{un ? '✉ Assign' : 'Reassign'}</Btn>}
        </div>
        {v.assignee_name && (
          <div style={{ marginTop: 9, background: '#F7F9FA', border: '1px solid #EDF0F3', borderRadius: 9, padding: '9px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 10.5, color: SEC }}>
              <span style={{ ...MONO, background: '#EEF1F3', borderRadius: 5, padding: '1px 7px' }}>{v.task_id ? `WF-${v.task_id}` : 'workflow task created'}</span>
              <span>notified in-app + email{v.assigned_at ? ` · ${fmtDate(v.assigned_at)}` : ''}</span>
              <span style={{ color: FAINT }}>·</span>
              <span>SLA <b>{slaBySev[v.severity] ?? '—'}</b> ({v.severity})</span>
              <span style={{ marginLeft: 'auto' }}><Btn sm onClick={() => notify('Reminder sent — in-app + email nudge to the owner.')}>Nudge</Btn></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 10, fontWeight: 600 }}>
              <span style={{ color: GREEN }}>✓ Assigned</span><span style={{ flex: 1, height: 2, background: '#BFE9DD', borderRadius: 2 }} />
              <span style={{ color: AMBER }}>Fix applied — claimed</span><span style={{ flex: 1, height: 2, background: '#EAEEF1', borderRadius: 2 }} />
              <span style={{ color: MUTED }}>Re-scan verifies · pending</span>
            </div>
            <div style={{ fontSize: 9.5, color: FAINT, marginTop: 5 }}>The owner&apos;s &ldquo;done&rdquo; is only a claim — the finding closes when the next Nessus re-scan no longer sees it.</div>
          </div>
        )}
      </div>
    );
  };

  const renderMobilise = () => {
    if (gated && !sp?.dispatch) {
      return (
        <div style={{ textAlign: 'center', padding: '30px 12px' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Nothing dispatched yet.</div>
          <div style={{ color: MUTED, maxWidth: 420, margin: '6px auto 15px', fontSize: 11.5 }}>Mobilise receives its work list when Validate presses <b>Dispatch to Mobilise</b>.</div>
          {stageReachable(5) && canEdit && <div style={{ display: 'inline-flex' }}><Btn green onClick={() => setActiveStage(4)}>Go to Validate →</Btn></div>}
        </div>
      );
    }
    const linkedSet = new Set(s.pipeline?.linked_ids ?? []);
    const workItems = [...findingsArr].filter((v: any) => (linkedSet.size > 0 ? linkedSet.has(v.id) : v.severity !== 'info'));
    const statusOf = (v: any): 'unassigned' | 'inprogress' => (v.assigned_to || v.assignee_name ? 'inprogress' : 'unassigned');
    const needsOwner = workItems.filter((v: any) => statusOf(v) === 'unassigned').length;
    const inProgress = workItems.length - needsOwner;
    const fixedReal = scopeFixed ? scopeFixed.filter((v: any) => v.severity !== 'info') : [];
    // Reconcile the Mobilise "Fixed ✓" badge with the scope card / KPI strip,
    // which both use closedVerified. The live scopeFixed list may show fewer
    // (it drops informational + is current-cycle) — a note covers the gap.
    const fixedCount = s.closedVerified ?? (scopeFixed ? fixedReal.length : 0);
    const head = sectionDesc(<>One owner per fix. Assign creates a workflow task + email with the fix package. Nobody closes by hand — a <b>Nessus re-scan</b> that no longer sees the finding is the only proof.</>);
    const tabBtn = (id: typeof mobFilter, label: string, n: number, tone?: [string, string, string]) => {
      const on = mobFilter === id;
      const st = tone && on ? { background: tone[0], color: tone[1], border: `1px solid ${tone[2]}` } : { background: on ? INK : '#EEF1F3', color: on ? '#fff' : '#6B7787', border: '1px solid transparent' };
      return <button key={id} onClick={() => setMobFilter(id)} style={{ borderRadius: 999, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', ...st }}>{label} <b style={MONO}>{n}</b></button>;
    };
    const tabs = (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {tabBtn('all', 'All', workItems.length)}
          {tabBtn('unassigned', 'Needs owner', needsOwner, [AMBERBG, AMBER, AMBERLINE])}
          {tabBtn('inprogress', 'In progress', inProgress, ['#E9F1FB', BLUE, '#AECBEC'])}
          {tabBtn('fixed', 'Fixed ✓', fixedCount, [GREENBG, GREEN, '#BFE9DD'])}
        </div>
        <div style={{ display: 'inline-flex', background: '#EEF1F3', border: `1px solid ${BORDER}`, borderRadius: 999, padding: 2 }}>
          {(['status', 'owner'] as const).map((gk) => <button key={gk} onClick={() => setMobGroup(gk)} style={{ border: 0, background: mobGroup === gk ? '#fff' : 'transparent', borderRadius: 999, padding: '4px 11px', fontSize: 11, fontWeight: 600, color: mobGroup === gk ? INK : '#6B7787', cursor: 'pointer', boxShadow: mobGroup === gk ? '0 1px 3px rgba(2,6,23,.1)' : 'none' }}>{gk === 'status' ? 'By status' : 'By owner'}</button>)}
        </div>
      </div>
    );
    if (!scopeFindings) return <>{head}{tabs}<p style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, color: FAINT }}>Loading…</p></>;
    if (workItems.length === 0 && mobFilter !== 'fixed') return <>{head}{tabs}<p style={{ borderRadius: 10, background: '#F7F9FA', padding: 12, fontSize: 11.5, color: MUTED }}>No real vulnerabilities to assign — only informational notes, which have nothing to fix.</p></>;

    if (mobFilter === 'fixed') {
      return <>{head}{tabs}
        {!scopeFixed ? <p style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, color: FAINT }}>Loading…</p>
          : fixedReal.length === 0 ? <div style={{ border: `1px solid ${BORDER}`, borderRadius: 11, background: '#F7F9FA', padding: '9px 12px', fontSize: 11.5, color: '#475569' }}>Nothing closed yet. When a Nessus re-scan no longer sees a finding it lands here automatically — no one closes it by hand.</div>
          : <>{fixedReal.map((v: any) => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 11, border: '1px solid #BFE9DD', background: '#F7FDF9', borderRadius: 11, padding: '11px 13px', marginBottom: 8 }}>
              <Pill bg={GREENBG} c={GREEN}>✓ Scanner-verified</Pill>
              <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 12.5 }}>{v.title}</b><div style={{ fontSize: 10.5, color: FAINT }}>{v.assignee_name ? `fixed by ${v.assignee_name} · ` : ''}re-scan no longer detects it · closed {fmtDate(v.updated_at ?? v.resolved_at)}</div></div>
              <span style={{ fontSize: 11, ...MONO, color: GREEN, textDecoration: 'line-through' }}>{v.composite_priority != null ? `${Math.round(Number(v.composite_priority) * 10)}/100` : ''}</span>
            </div>
          ))}
            {fixedReal.length < fixedCount && <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>{fixedCount - fixedReal.length} more verified closure{fixedCount - fixedReal.length === 1 ? '' : 's'} counted for this scope (informational, or from an earlier cycle) — not itemised in the current cycle above.</div>}
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 11, background: '#F7F9FA', padding: '9px 12px', fontSize: 11.5, color: '#475569', marginTop: 4 }}>Closed automatically when a re-scan no longer sees the finding — never hand-closed. Each closure is what moves the exposure score.</div>
          </>}
      </>;
    }

    const filtered = workItems.filter((v: any) => (mobFilter === 'all' ? true : statusOf(v) === mobFilter))
      .sort((a: any, b: any) => { const r: Record<string, number> = { unassigned: 0, inprogress: 1 }; return (r[statusOf(a)] - r[statusOf(b)]) || ((b.composite_priority ?? -1) - (a.composite_priority ?? -1)); });
    const gh = (txt: string, danger?: boolean) => <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: danger ? RED : '#94A3B8', margin: '14px 2px 8px' }}>{txt}</div>;
    let body: React.ReactNode;
    if (filtered.length === 0) body = <p style={{ borderRadius: 10, background: '#F7F9FA', padding: 12, fontSize: 11.5, color: MUTED }}>{mobFilter === 'unassigned' ? 'Every finding here already has an owner.' : mobFilter === 'inprogress' ? 'Nothing assigned yet — start with the “Needs owner” list.' : 'Nothing in this bucket.'}</p>;
    else if (mobGroup === 'owner') {
      const grp: Record<string, any[]> = {};
      filtered.forEach((v: any) => { const k = v.assignee_name || ' Needs owner'; (grp[k] = grp[k] || []).push(v); });
      body = Object.keys(grp).sort((a, b) => (a === ' Needs owner' ? -1 : b === ' Needs owner' ? 1 : a.localeCompare(b))).map((k) => (
        <div key={k}>{gh(`${k === ' Needs owner' ? '⚠ Needs owner' : k} (${grp[k].length})`, k === ' Needs owner')}{grp[k].map(workRow)}</div>
      ));
    } else {
      const dangerSet = new Set(s.dangerousIds ?? []);
      const priSet = new Set(s.pipeline?.priority_ids ?? []);
      const dang = filtered.filter((v: any) => dangerSet.has(v.id));
      const prio = filtered.filter((v: any) => !dangerSet.has(v.id) && priSet.has(v.id));
      const other = filtered.filter((v: any) => !dangerSet.has(v.id) && !priSet.has(v.id));
      body = <>
        {dang.length > 0 && <>{gh(`🔥 Dangerous — confirmed reachable (${dang.length})`, true)}{dang.map(workRow)}</>}
        {prio.length > 0 && <>{gh(`Prioritised (${prio.length})`)}{prio.map(workRow)}</>}
        {other.length > 0 && <>{gh(`Other linked fixes — hardening & configuration (${other.length})`)}{other.map(workRow)}</>}
      </>;
    }
    return <>{head}{tabs}{body}</>;
  };

  const stageBody = (n: number): React.ReactNode => {
    if (n === 1) return renderScope();
    if (n === 2) return renderDiscover();
    if (n === 3) return renderPrioritise();
    if (n === 4) return renderValidate();
    return renderMobilise();
  };

  const accordion = () => (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {STAGES.map((st, i) => {
        const done = stageDone[st.n];
        const reachable = stageReachable(st.n);
        const locked = (gated && !done && !reachable) || (gated && st.n === 5 && !sp?.dispatch);
        const isCurrent = st.n === firstIncomplete;
        const open = st.n === activeStage && !locked;
        const last = i === STAGES.length - 1;
        const disc = done
          ? <span style={{ width: 26, height: 26, borderRadius: 999, border: `2px solid ${st.c}`, color: st.c, background: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800 }}>✓</span>
          : locked
          ? <span style={{ width: 26, height: 26, borderRadius: 999, background: '#EEF1F3', color: FAINT, display: 'grid', placeItems: 'center', fontSize: 10 }}>🔒</span>
          : <span style={{ width: 26, height: 26, borderRadius: 999, background: st.c, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800 }}>{st.n}</span>;
        const tag = open ? null
          : done ? <span style={{ color: FAINT, fontSize: 14 }}>›</span>
          : locked ? <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.05em', color: FAINT }}>LOCKED</span>
          : isCurrent ? <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.06em', color: '#fff', background: INK, borderRadius: 5, padding: '2px 7px' }}>CURRENT</span>
          : <span style={{ color: FAINT, fontSize: 14 }}>›</span>;
        return (
          <div key={st.n} style={{ display: 'flex', gap: 14, ...(open ? { flex: 1, minHeight: 0 } : {}) }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none', width: 26, paddingTop: 14 }}>{disc}{!last && <span style={{ flex: 1, width: 2, background: done ? st.c : '#E4E8EC', marginTop: 4, borderRadius: 2 }} />}</div>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 14, ...(open ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : {}) }}>
              <div style={{ ...CARD, overflow: 'hidden', ...(open ? { border: `1px solid ${st.c}`, boxShadow: '0 4px 14px rgba(2,6,23,.06)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } : {}), ...(locked ? { opacity: 0.65 } : {}) }}>
                <div onClick={() => { if (!locked) setActiveStage(st.n); }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 13px', cursor: locked ? 'default' : 'pointer' }}>
                  <b style={{ fontSize: 13, color: locked ? FAINT : INK, flex: 'none' }}>{st.label}</b>
                  <span style={{ fontSize: 11.5, color: locked ? FAINT : MUTED, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stageStat(st.n)}</span>
                  {tag}
                </div>
                {open && <div style={{ borderTop: `1px solid ${BORDER2}`, padding: '12px 14px', flex: 1, minHeight: 0, overflowY: 'auto' }}>{stageBody(st.n)}</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const journeyScreen = () => (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', maxWidth: 1060, width: '100%', margin: '0 auto', padding: '4px 18px 0' }}>
      <div style={{ marginBottom: 10, flexShrink: 0 }}><Btn sm onClick={() => { setScreen('home'); setSelId(null); }}>← All scopes</Btn></div>
      <div style={{ flexShrink: 0 }}>{commandBar()}</div>
      {s.cycleOpen
        ? <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{accordion()}</div>
        : <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingBottom: 12 }}>{closedState()}</div>}
    </div>
  );

  /* ─────────────────── root ─────────────────── */
  return (
    <div style={{ fontFamily: "var(--font-poppins, 'Poppins', system-ui, -apple-system, 'Segoe UI', sans-serif)", color: INK, fontSize: 13.5, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: INK, color: '#fff', padding: '10px 16px', borderRadius: 10, fontSize: 12, zIndex: 80, boxShadow: '0 8px 24px rgba(2,6,23,.3)', maxWidth: '80vw' }}>{toast}</div>}
      {error && <p className="flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700" style={{ marginBottom: 12 }}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}</p>}

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <CreateScopeForm form={form} setForm={setForm} assets={scopeAssets ?? []} sla={slaBySev} onSubmit={() => createMutation.mutate()} onCancel={() => setShowCreate(false)} pending={createMutation.isPending} />
        </Modal>
      )}
      {showHistory && (
        <Modal onClose={() => setShowHistory(false)}>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}><h4 style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>Cycle history</h4><Btn sm onClick={() => setShowHistory(false)}>Close</Btn></div>
            <p style={{ fontSize: 11.5, color: MUTED, margin: '0 0 12px' }}>Each closed cycle is an immutable snapshot — progress is provable period over period.</p>
            <div style={{ maxHeight: 320, overflow: 'auto' }}>{historyTable()}</div>
          </div>
        </Modal>
      )}

      {/* assign modal — reused verbatim */}
      {assigning && (
        <Modal onClose={() => setAssigning(null)}>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <p className="text-[13px] font-semibold text-slate-900">Assign this fix</p>
            <p className="text-[12px] text-slate-500">
              <b className="text-slate-800">{assigning.title}</b> — pick the one person who owns fixing this on the host.
              They get an in-app (and email) notify and stay on the hook until a Nessus re-scan shows the weak spot is gone.
              That re-scan is the proof of fixed — not this assignment.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Who owns this fix</label>
              {(() => {
                const sel = (tenantUsers ?? []).find((u) => String(u.id) === assigneeId);
                if (sel) return (
                  <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate font-medium text-emerald-900">{sel.display_name || sel.email}{sel.display_name && <span className="ml-1 font-normal text-emerald-700">· {sel.email}</span>}</span>
                    <button type="button" onClick={() => { setAssigneeId(''); setAssigneeQuery(''); }} className="ml-2 shrink-0 text-xs font-medium text-emerald-700 hover:underline">change</button>
                  </div>
                );
                const q = assigneeQuery.trim().toLowerCase();
                const realUsers = (tenantUsers ?? []).filter((u) => !String(u.email || '').toLowerCase().endsWith('.sample'));
                const matches = realUsers.filter((u) => !q || (u.display_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)).slice(0, 8);
                return (
                  <>
                    <input autoFocus value={assigneeQuery} onChange={(e) => setAssigneeQuery(e.target.value)} placeholder="Type a name or the person’s email…" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
                    <div className="mt-1 max-h-44 overflow-auto rounded-lg border border-slate-100">
                      {matches.length === 0
                        ? <p className="px-3 py-2 text-[12px] text-slate-400">No platform user matches “{assigneeQuery}”. A fix must be owned by a platform user — that account&apos;s email gets the task notification, and the Nessus re-scan closes it against them. Add the person in user management first, then assign.</p>
                        : matches.map((u) => (
                          <button key={u.id} type="button" onClick={() => setAssigneeId(String(u.id))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50">
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">{String(u.display_name || u.email || '?').slice(0, 2).toUpperCase()}</span>
                            <span className="min-w-0"><span className="block truncate text-[13px] font-medium text-slate-800">{u.display_name || u.email}</span>{u.display_name && <span className="block truncate text-[11px] text-slate-400">{u.email}</span>}</span>
                          </button>
                        ))}
                    </div>
                  </>
                );
              })()}
            </div>
            <details className="text-[12px] text-slate-500">
              <summary className="cursor-pointer select-none hover:text-slate-700">Needs a go-ahead first? Add an approver (optional)</summary>
              <div className="mt-2">
                <select value={approverId} onChange={(e) => setApproverId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
                  <option value="">No approval needed</option>
                  {(tenantUsers ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.display_name ? `${u.display_name} — ${u.email}` : u.email}</option>
                  ))}
                </select>
              </div>
            </details>
            <div className="flex items-center gap-2">
              <button
                onClick={() => assigneeId && mobiliseMutation.mutate({
                  scopeId: s.id, vulnerability_id: assigning.id,
                  assignee_user_id: Number(assigneeId),
                  approver_user_id: approverId ? Number(approverId) : undefined,
                })}
                disabled={mobiliseMutation.isPending || !assigneeId}
                className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                {mobiliseMutation.isPending ? 'Assigning…' : 'Assign & notify'}
              </button>
              <button onClick={() => setAssigning(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* By-control findings popup */}
      {ctrlPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }} onClick={(e) => { if (e.target === e.currentTarget) setCtrlPopup(null); }}>
          <div style={{ ...CARD, width: 500, maxWidth: '100%', padding: 20, boxShadow: '0 20px 50px rgba(2,6,23,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1 }}><h4 style={{ fontSize: 14.5, fontWeight: 600 }}>{ctrlPopup.code}</h4><div style={{ fontSize: 11.5, color: MUTED }}>{ctrlPopup.name} · addresses {ctrlPopup.findings} finding{ctrlPopup.findings === 1 ? '' : 's'}</div></div>
              <Btn sm onClick={() => setCtrlPopup(null)}><X className="h-3.5 w-3.5" /></Btn>
            </div>
            <div style={{ fontSize: 10.5, color: FAINT, margin: '6px 0 8px' }}>A link is the fix to implement — it does <b>not</b> close these findings.</div>
            {(() => {
              const evItems = (ctrlEvidence as any)?.items ?? [];
              const list: any[] = evItems.length ? evItems : ctrlPopup.coveredIds.map((id) => (scopeFindings ?? []).find((v: any) => v.id === id)).filter(Boolean);
              if (ctrlLoading && !list.length) return <p style={{ padding: '12px 0', fontSize: 12, color: FAINT }}>Loading findings…</p>;
              if (!list.length) return <div style={{ border: '1px dashed #D8DFE4', borderRadius: 10, background: '#FAFBFC', padding: 14, textAlign: 'center', color: MUTED, fontSize: 11.5 }}>This control addresses {ctrlPopup.findings} findings across the scope.</div>;
              return list.map((it: any, i: number) => {
                const v = it.vulnerability ?? it;
                const sev = v.severity ?? 'low';
                return (
                  <div key={v.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${BORDER2}`, padding: '9px 2px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{v.title ?? v.vuln_id ?? `Finding #${v.id}`}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 2, fontSize: 10.5, color: FAINT }}><SevBadge sev={sev} />{v.composite_priority != null && <span style={MONO}>{Math.round(Number(v.composite_priority) * 10)}/100</span>}{(v.linked_assets ?? [])[0] && <span>{v.linked_assets[0]}</span>}</div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* finding-detail popup — click a finding row anywhere in a stage */}
      {peek && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }} onClick={(e) => { if (e.target === e.currentTarget) setPeek(null); }}>
          <div style={{ ...CARD, width: 520, maxWidth: '100%', padding: 20, boxShadow: '0 20px 50px rgba(2,6,23,.3)', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h4 style={{ fontSize: 14.5, fontWeight: 600 }}>{peek.title ?? `Finding #${peek.id}`}</h4>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 5, fontSize: 10.5, color: FAINT, alignItems: 'center' }}>
                  <SevBadge sev={peek.severity ?? 'low'} />
                  {peek.cve_id && <span style={MONO}>{peek.cve_id}</span>}
                  {peek.composite_priority != null && <span style={MONO}>{Math.round(Number(peek.composite_priority) * 10)}/100 on host</span>}
                  {peek.kev_flag && <Kev />}
                  {(peek.linked_assets ?? [])[0] && <span>{peek.linked_assets[0]}</span>}
                </div>
              </div>
              <Btn sm onClick={() => setPeek(null)}><X className="h-3.5 w-3.5" /></Btn>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 12, fontSize: 12 }}>
              <div><div style={SK}>CVSS</div><div style={{ fontWeight: 600 }}>{peek.cvss_score ?? '—'}</div></div>
              <div><div style={SK}>EPSS</div><div style={{ fontWeight: 600 }}>{peek.epss_score != null ? `${(Number(peek.epss_score) * 100).toFixed(1)}%` : '—'}</div></div>
              <div><div style={SK}>Priority · host</div><div style={{ fontWeight: 600 }}>{peek.composite_priority != null ? `${Math.round(Number(peek.composite_priority) * 10)}/100` : '—'}</div></div>
              <div><div style={SK}>Status</div><div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{String(peek.status ?? 'open').replace(/_/g, ' ')}</div></div>
            </div>
            {Array.isArray(peek.linked_control_codes) && peek.linked_control_codes.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={SK}>Addressed by</div>
                <div style={{ marginTop: 4 }}>{peek.linked_control_codes.map((c: string) => <span key={c} style={{ display: 'inline-flex', background: VIOLETBG, color: VIOLET, borderRadius: 7, padding: '2px 8px', fontSize: 10.5, fontWeight: 600, margin: '2px 4px 0 0' }}>{c}</span>)}</div>
                <div style={{ fontSize: 10, color: FAINT, marginTop: 6 }}>A control link is the fix to implement — it does <b>not</b> close this finding or lower its score. Only a Nessus re-scan closes it.</div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <a href={`/vulnerabilities/${peek.id}`} style={{ fontSize: 11.5, fontWeight: 600, color: ACS, textDecoration: 'none' }}>Open full finding →</a>
            </div>
          </div>
        </div>
      )}

      {SCOPES.length === 0 ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}><EmptyState onCreate={() => setShowCreate(true)} onTemplate={(preset) => { setForm((prev) => ({ ...prev, ...preset })); setShowCreate(true); }} canEdit={canEdit} /></div>
      ) : screen === 'scope' ? journeyScreen() : homeScreen()}
    </div>
  );
}

/* ─────────────────────── sub-components ─────────────────────── */

/** Minimal modal: backdrop click closes. Fixed overlay, no portal needed. */
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="fixed inset-0" style={{ background: 'rgba(15,23,42,0.45)' }} onClick={onClose} />
      <div className="relative w-full max-w-2xl">{children}</div>
    </div>
  );
}

type ScopeAsset = { id: number; name: string; host_name?: string | null; internet_facing?: boolean | null; department?: string | null };

function CreateScopeForm({ form, setForm, assets, sla, onSubmit, onCancel, pending }: {
  form: { name: string; cadence: string; asset_ids: number[] };
  assets: ScopeAsset[]; sla?: Record<string, string>;
  setForm: (f: any) => void; onSubmit: () => void; onCancel: () => void; pending: boolean;
}) {
  const [assetQuery, setAssetQuery] = useState('');
  const picked = new Set(form.asset_ids || []);
  const toggle = (id: number) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setForm({ ...form, asset_ids: Array.from(next) });
  };
  const q = assetQuery.trim().toLowerCase();
  const hits = q
    ? assets.filter((a) => `${a.name} ${a.host_name ?? ''}`.toLowerCase().includes(q)).slice(0, 10)
    : assets.slice(0, 10);
  const slaMap = sla ?? { critical: '7d', high: '30d', medium: '90d', low: '180d' };

  // Mock layout: vertical stack, uppercase section labels, cadence → live deadline
  // preview line, SLA strip, assets as bordered row cards, footer Cancel + Create.
  const CAD_DAYS: Record<string, number> = { weekly: 7, monthly: 30, quarterly: 91 };
  const days = CAD_DAYS[form.cadence];
  const due = days ? new Date(Date.now() + days * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const LBL: React.CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: FAINT, fontWeight: 700, display: 'block', marginBottom: 6 };
  const LBL2: React.CSSProperties = { fontWeight: 500, textTransform: 'none', letterSpacing: 0 };
  const INP: React.CSSProperties = { width: '100%', height: 40, border: '1px solid #E4E8EC', borderRadius: 10, background: '#fff', padding: '0 12px', fontSize: 12.5, color: SEC };
  const cannot = pending || picked.size === 0;

  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, padding: '20px 22px', boxShadow: '0 20px 50px rgba(2,6,23,.3)' }}>
      <b style={{ fontSize: 15 }}>New scope</b>
      <p style={{ fontSize: 11.5, color: MUTED, margin: '4px 0 14px' }}>Pick the assets this scope owns — its first cycle opens on create. Name is optional (derived from the assets if blank).</p>

      <label style={LBL}>Name <span style={LBL2}>(optional)</span></label>
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Payment servers" style={{ ...INP, marginBottom: 13 }} />

      <label style={LBL}>Cadence — the cycle deadline</label>
      <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })} style={{ ...INP, cursor: 'pointer' }}>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="quarterly">Quarterly</option>
        <option value="">No cadence — run ad hoc</option>
      </select>
      <p style={{ fontSize: 11.5, color: AMBER, margin: '7px 0 13px' }}>
        {due
          ? <>Cycle #1 due <b>{due}</b> — a visible deadline, never an auto-close; a human closes the cycle.</>
          : <>No cadence — cycles run ad hoc; a human opens and closes each one.</>}
      </p>

      <div style={{ border: `1px solid ${BORDER}`, background: '#F7F9FA', borderRadius: 11, padding: '9px 12px', marginBottom: 10 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: FAINT, fontWeight: 700 }}>Finding SLAs — tenant defaults apply</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 5, fontSize: 11.5, color: SEC }}>
          {(['critical', 'high', 'medium', 'low'] as const).map((sv) => (
            <span key={sv} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', padding: '1px 6px', borderRadius: 5, background: SEV[sv].bg, color: SEV[sv].c }}>{sv}</span> {slaMap[sv] ?? '—'}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 9.5, color: FAINT, marginTop: 4 }}>Each assigned fix inherits its severity&apos;s SLA · editable in SLA Config.</div>
      </div>

      <label style={LBL}>Assets <span style={LBL2}>(pick at least 1)</span></label>
      {assets.length > 6 && (
        <input value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} placeholder="Type to search…" style={{ ...INP, height: 34, marginBottom: 8 }} />
      )}
      <div style={{ maxHeight: 230, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7, paddingRight: 2 }}>
        {hits.length === 0 && <div style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, color: FAINT }}>No asset matches &ldquo;{assetQuery}&rdquo;.</div>}
        {hits.map((a) => (
          <button type="button" key={a.id} onClick={() => toggle(a.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: `1px solid ${picked.has(a.id) ? AC : '#E4E8EC'}`, background: picked.has(a.id) ? '#F7FBFA' : '#fff', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" readOnly checked={picked.has(a.id)} style={{ width: 15, height: 15, accentColor: AC, pointerEvents: 'none' }} />
            <b style={{ color: INK }}>{a.name}</b>
            {a.host_name && a.host_name !== a.name && <span style={{ fontSize: 11, color: FAINT }}>· {a.host_name}</span>}
            {a.internet_facing && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: REDD, background: REDBG, borderRadius: 5, padding: '1px 7px' }}>internet-facing</span>}
          </button>
        ))}
      </div>
      {picked.size === 0 && <p style={{ fontSize: 11, color: FAINT, margin: '8px 0 0' }}>Nothing selected yet — a scope needs at least one asset to work on.</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDER2}` }}>
        <button onClick={onCancel} style={{ border: '1px solid #E4E8EC', background: '#fff', color: SEC, borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        <button onClick={onSubmit} disabled={cannot} title={picked.size === 0 ? 'Select at least one asset first' : ''}
          style={{ border: 0, background: AC, color: '#06342B', borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: cannot ? 'not-allowed' : 'pointer', opacity: cannot ? 0.5 : 1 }}>
          {pending ? 'Creating…' : 'Create scope & open Cycle #1'}
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onCreate, onTemplate, canEdit }: { onCreate: () => void; onTemplate?: (preset: Record<string, unknown>) => void; canEdit: boolean }) {
  const steps = [
    { n: 1, label: 'Scope', icon: <Server className="h-[18px] w-[18px] text-slate-600" />, sub: 'Bound the assets you care about', bg: 'bg-slate-100' },
    { n: 2, label: 'Discover', icon: <Search className="h-[18px] w-[18px] text-slate-600" />, sub: 'Pull in scanner findings', bg: 'bg-slate-100' },
    { n: 3, label: 'Prioritise', icon: <Crosshair className="h-[18px] w-[18px] text-rose-700" />, sub: 'Rank by reachable attack path', bg: 'bg-rose-50' },
    { n: 4, label: 'Validate', icon: <ShieldCheck className="h-[18px] w-[18px] text-slate-600" />, sub: 'Check the controls that cover them', bg: 'bg-slate-100' },
    { n: 5, label: 'Mobilise', icon: <Send className="h-[18px] w-[18px] text-emerald-700" />, sub: 'Assign a fix to a person in the platform', bg: 'bg-emerald-50' },
  ];
  const templates = [
    { icon: <CreditCard className="h-4 w-4 text-primary-700" />, title: 'Internet-facing tier', sub: 'Public web, edge and WAF assets', preset: { name: 'Internet-facing tier', internet_facing: true } },
    { icon: <Lock className="h-4 w-4 text-primary-700" />, title: 'Payment platform', sub: 'PCI-scoped assets and services', preset: { name: 'Payment platform' } },
    { icon: <Users className="h-4 w-4 text-primary-700" />, title: 'Identity plane', sub: 'IdP, MFA and directory sync', preset: { name: 'Identity plane' } },
  ];
  return (
    <div className="mx-auto w-full max-w-[1520px] space-y-4">
      <Card className="relative overflow-hidden p-10 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_0%,rgba(23,184,152,0.07),transparent_60%)]" />
        <div className="relative">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-[18px] bg-primary-50">
            <Crosshair className="h-[30px] w-[30px] text-primary-700" strokeWidth={1.75} />
          </div>
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">Run your first exposure cycle</h2>
          <p className="mx-auto mt-2.5 max-w-lg text-[13.5px] leading-relaxed text-slate-500">
            A scope is a named, owned slice of your attack surface. Create one, then run the CTEM loop over it as an
            explicit cycle — you open and close each round by hand.
          </p>
          <div className="mx-auto mt-7 flex max-w-3xl items-stretch justify-center">
            {steps.map((st, i) => (
              <div key={st.label} className="contents">
                <div className="flex-1">
                  <div className={`mb-2.5 inline-flex h-[38px] w-[38px] items-center justify-center rounded-xl ${st.bg}`}>{st.icon}</div>
                  <p className="text-[12px] font-semibold text-slate-900">{st.n} · {st.label}</p>
                  <p className="mx-1.5 mt-1 text-[10.5px] leading-snug text-slate-400">{st.sub}</p>
                </div>
                {i < steps.length - 1 && <div className="flex items-start pt-[19px] text-slate-300"><ArrowRight className="h-4 w-4" /></div>}
              </div>
            ))}
          </div>
          <div className="mt-7 flex items-center justify-center gap-3">
            <button onClick={onCreate} disabled={!canEdit} className="inline-flex items-center gap-1.5 rounded-[10px] bg-primary-600 px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              <Plus className="h-4 w-4" strokeWidth={2.2} /> Create your first scope
            </button>
            <a href="#" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-600 hover:text-slate-800">
              <PlayCircle className="h-[15px] w-[15px]" /> Watch 2-min overview
            </a>
          </div>
        </div>
      </Card>
      <div>
        <p className="mb-2.5 pl-0.5 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Or start from a template</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {templates.map((t) => (
            <button key={t.title} onClick={() => onTemplate?.(t.preset)} disabled={!canEdit} className="rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50">
              <div className="mb-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50">{t.icon}</div>
              <p className="text-[13px] font-semibold text-slate-900">{t.title}</p>
              <p className="mt-1 text-[11.5px] leading-snug text-slate-500">{t.sub}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
