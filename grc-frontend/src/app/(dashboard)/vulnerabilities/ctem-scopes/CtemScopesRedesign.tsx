'use client';

/**
 * CTEM Scopes & Cycles — redesign (drop-in for src/app/(dashboard)/erm/ctem-scopes/page.tsx)
 *
 * Stack: React + TypeScript + Tailwind + lucide-react (matches the app).
 * Colours use the app's Tailwind theme: `primary` (#1ed4b0 / 700 #17b898) + slate/emerald/rose/amber/sky.
 *
 * This file ships with MOCK data (SCOPES / CW below) so it renders standalone.
 * To wire it to the backend, delete the mock arrays and feed real data into the
 * same shapes via react-query, e.g.:
 *
 *   const { data } = useQuery({ queryKey: ['ctem-scopes'], queryFn: () => ctemScopesApi.list().then(r => r.data) });
 *   const scopes: Scope[] = data?.scopes ?? [];
 *   // per-scope command-center numbers come from ctemScopesApi.commandCenter(id)
 *
 * Hover guidance uses native `title` attributes — swap for your Tooltip component if you have one.
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
  Crosshair, Plus, ExternalLink, Square, Play, RefreshCw, ArrowRight, Coins,
  ShieldCheck, Server, BarChart3, Calendar, Table2, Search, Send, CreditCard,
  Lock, Users, PlayCircle, Loader2, AlertTriangle, Trash2,
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
  // deliverable #4 — the AI Validate pass's per-finding coverage (honest, additive)
  pipeline?: { analysed: number; informational: number; linked: number; patch_only: number; no_specific: number; low_awaiting_review: number; unmapped?: number;
    priority?: { total: number; linked: number; patch_only: number; awaiting: number; unanswered: number };
    priority_ids?: number[];
    linked_ids?: number[] };
  // Gated loop: the OPEN cycle's stage stamps ({} = fresh cycle, nothing run yet;
  // null = no open cycle → history view). Set server-side; validate stamps when
  // the AI mapping run finishes.
  stageProgress?: { discover?: string; prioritise?: string; validate?: string; dispatch?: string } | null;
  fixes: number; fixesOpen: number; tasks?: number; closedVerified?: number;
  // per-scope FAIR has NO real source (risks aren't scope-linked) → null, rendered honestly
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

/* ───────────────────────────── mock data ─────────────────────────── */

// (mock data removed — this component is wired to /erm/ctem/scopes/portfolio)

/* ─────────────────────────── helpers ─────────────────────────── */

const money = (v: number | null | undefined, ccy?: string | null) =>
  v == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy || 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);

const riskColor = (r: Risk | null) => (r === 'crit' ? '#be123c' : r === 'high' ? '#f97316' : r === 'med' ? '#eab308' : r === 'low' ? '#10b981' : '#cbd5e1');

const sevStyle = (sev: Sev): { label: string; className: string } => ({
  critical: { label: 'Critical', className: 'bg-rose-50 text-rose-800' },
  high: { label: 'High', className: 'bg-orange-50 text-orange-700' },
  medium: { label: 'Medium', className: 'bg-amber-50 text-amber-700' },
  low: { label: 'Low', className: 'bg-blue-50 text-blue-700' },
}[sev]);

const tierStyle = (t: Tier): { label: string; className: string } => ({
  tested: { label: 'effective ✓', className: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'failed ✗', className: 'bg-rose-50 text-rose-700' },
  verified: { label: 'fix verified', className: 'bg-sky-50 text-sky-700' },
  claimed: { label: 'claimed', className: 'bg-slate-100 text-slate-600' },
}[t]);

/** Build a polyline + area path for a sparkline scaled to [w,h]. */
function spark(vals: number[], w: number, h: number, pad: number) {
  const max = Math.max(...vals), min = Math.min(...vals), range = max - min || 1, n = vals.length;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (n - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `M ${pts[0][0]},${h} ` + pts.map((p) => `L ${p[0]},${p[1]}`).join(' ') + ` L ${pts[n - 1][0]},${h} Z`;
  return { line, area };
}

/** Two series on one shared scale (findings + dangerous). Series may be
 *  different lengths (a freeze may lack one total) — each is RIGHT-aligned to
 *  the live point; a 1-point series draws a dot, never a faked line. */
function sparkPair(a: number[], b: number[], w: number, h: number, pad: number) {
  const all = [...a, ...b], max = Math.max(...all), min = Math.min(...all), range = max - min || 1;
  const n = Math.max(2, a.length, b.length);          // x-slots; ≥2 so the axis has width
  const map = (vals: number[]) => vals.map((v, i) => {
    const slot = n - vals.length + i;                  // right-align
    const x = pad + (slot / (n - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const pa = map(a), pb = map(b);
  const line = (p: readonly (readonly [number, number])[]) => p.length > 1 ? p.map((q) => q.join(',')).join(' ') : '';
  const area = (p: readonly (readonly [number, number])[]) => p.length > 1
    ? `M ${p[0][0]},${h} ` + p.map((q) => `L ${q[0]},${q[1]}`).join(' ') + ` L ${p[p.length - 1][0]},${h} Z` : '';
  const dot = (p: readonly (readonly [number, number])[]) => p.length === 1 ? { cx: p[0][0], cy: p[0][1] } : null;
  return { aLine: line(pa), aArea: area(pa), bLine: line(pb), aDot: dot(pa), bDot: dot(pb) };
}

function delta(cur: number, prev: number | null | undefined, goodDown: boolean) {
  if (prev == null) return { text: '—', color: 'text-slate-400' };   // no comparable freeze yet — honest
  const d = cur - prev;
  const text = d > 0 ? `+${d}` : `${d}`;
  let color = 'text-slate-500';
  if (d !== 0) color = (goodDown ? d < 0 : d > 0) ? 'text-emerald-600' : 'text-rose-600';
  return { text, color };
}

/* ───────────────────────── small UI atoms ───────────────────────── */

const Card = ({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`} {...props} />
);

const SectionTitle = ({ icon, children, className = '' }: { icon: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <p className={`flex items-center gap-2 text-[13px] font-semibold text-slate-900 ${className}`}>{icon}{children}</p>
);

/* ───────────────────────────── page ─────────────────────────────── */

export default function CtemScopesRedesign() {
  const qc = useQueryClient();
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('risks:risk_register:edit');
  const [selId, setSelId] = useState<number | null>(null);
  const [showAllCw, setShowAllCw] = useState(false);
  // Validate results are ONE page-worth at a time: the result table OR the decisions panel
  const [valView, setValView] = useState<'result' | 'decisions'>('result');
  const [showAllRanked, setShowAllRanked] = useState(false);
  const [expandedCw, setExpandedCw] = useState<string | null>(null);   // which control row is drilled-down
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', cadence: 'quarterly', asset_ids: [] as number[] });
  const [assigning, setAssigning] = useState<Finding | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [approverId, setApproverId] = useState('');
  const [assigneeQuery, setAssigneeQuery] = useState('');   // searchable picker in the assign modal
  // Mobilise board: which slice of work the operator is looking at.
  const [mobFilter, setMobFilter] = useState<'all' | 'unassigned' | 'inprogress' | 'fixed'>('all');
  const [mobGroup, setMobGroup] = useState<'status' | 'owner'>('status');
  // Guided stepper: which of the 5 stages the operator is standing on. null =
  // "auto" → resolves to the first stage that isn't done yet (see activeStage
  // below), so opening a scope lands you where the work actually is. Clicking a
  // stage node pins it. Reset to auto whenever the selected scope changes.
  const [activeStageRaw, setActiveStage] = useState<number | null>(null);

  // ONE call for the whole portfolio — every scope's command-center numbers.
  const { data, isLoading, isError, error: loadError, refetch } = useQuery<Portfolio>({
    queryKey: ['ctem-portfolio'],
    queryFn: async () => (await ctemScopesApi.portfolio()).data,
  });
  const SCOPES: Scope[] = data?.scopes ?? [];
  const quantify = data?.quantify ?? null;

  // ── Validate progress poll ─────────────────────────────────────────────────
  // While the open cycle hasn't stamped Validate, poll the AI mapping run so the
  // stage can show a LIVE progress bar. The run itself is a backend thread —
  // navigating away never kills it; coming back resumes the bar from the run row.
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
    // a run just finished → the backend stamped Validate; pull the fresh stamps
    if (aiRun && !aiRun.running) { qc.invalidateQueries({ queryKey: ['ctem-portfolio'] }); setActiveStage(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRun?.running]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ctem-portfolio'] });
    qc.invalidateQueries({ queryKey: ['ctem-scopes'] });
    qc.invalidateQueries({ queryKey: ['ctem-command-center'] });
  };
  const createMutation = useMutation({
    mutationFn: () => {
      // Name is optional — if the user didn't type one, derive it from the
      // assets they picked ("DESKTOP-CE3EFJB" or "DESKTOP-CE3EFJB +2 more").
      const names = (form.asset_ids || [])
        .map((id) => (scopeAssets ?? []).find((a) => a.id === id)?.name)
        .filter(Boolean) as string[];
      const autoName = names.length === 1 ? names[0]
        : names.length > 1 ? `${names[0]} +${names.length - 1} more`
        : 'New scope';
      return ctemScopesApi.create({
        name: form.name.trim() || autoName, cadence: form.cadence || null,
        membership_rule: {
          asset_ids: form.asset_ids && form.asset_ids.length ? form.asset_ids : null,
        },
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
  // Gated loop: stamp a stage done on the OPEN cycle (discover | prioritise).
  const completeStage = useMutation({
    mutationFn: async (args: { scopeId: number; stage: 'discover' | 'prioritise' | 'dispatch' }) =>
      (await ctemScopesApi.completeStage(args.scopeId, args.stage)).data,
    onSuccess: () => { setError(null); setActiveStage(null); invalidate(); },   // auto-advance to the next stage
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not advance the stage'),
  });
  // Re-run the attack-path engine over the scope (fills "not calculated", refreshes the ranking).
  // Under the gated loop this IS the Prioritise stage's work — success stamps it.
  const computePaths = useMutation({
    mutationFn: async (scopeId: number) => (await vulnManagementApi.vulnerabilities.computeAttackPaths(scopeId, false)).data,   // full recompute, not only-missing
    onSuccess: async (_d, scopeId) => {
      setError(null);
      // stamp the stage only when running inside an open (gated) cycle — a
      // history-view recalc is just a recalc
      const inOpenCycle = (data?.scopes ?? []).find((x) => x.id === scopeId)?.stageProgress != null;
      if (inOpenCycle) {
        try {
          await ctemScopesApi.completeStage(scopeId, 'prioritise');
          setActiveStage(null);                     // auto-advance: lands on Validate
        } catch (e: any) {
          // ladder refusals must be VISIBLE, not swallowed (e.g. Discover not run yet)
          setError(e?.response?.data?.detail || 'Prioritise ran, but the stage could not be stamped');
        }
      }
      invalidate(); qc.invalidateQueries({ queryKey: ['choke-points'] });
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Attack-path calculation failed'),
  });
  // Remove a scope. Backend refuses (409) if it owns a closed/frozen cycle — that
  // error surfaces in the banner rather than silently destroying audit history.
  const deleteMutation = useMutation({
    mutationFn: (scopeId: number) => ctemScopesApi.remove(scopeId),
    onSuccess: (_d, scopeId) => { setError(null); if (selId === scopeId) setSelId(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to delete scope'),
  });

  const { data: currentUser } = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => (await apiClient.get('/auth/me')).data as { id: number },
    staleTime: 5 * 60 * 1000,
  });
  const currentUserId = currentUser?.id ?? null;
  const { data: scopeAssets } = useQuery({
    queryKey: ['ctem.scope-assets'],
    queryFn: async () => (await apiClient.get<Array<{ id: number; name: string; host_name?: string | null; internet_facing?: boolean | null; department?: string | null }>>('/assets', { params: { limit: 1000 } })).data,
    staleTime: 5 * 60 * 1000,
  });
  // The scope's actual findings — the Discover table and the automatic risk
  // ranking on Prioritise. Same endpoint + scope filter the register uses, so
  // the rows here are identical to the vulnerabilities tab.
  const sPeekId = (SCOPES.find((x) => x.id === selId) ?? SCOPES[0])?.id ?? null;
  const { data: scopeFindings } = useQuery({
    queryKey: ['ctem.scope-findings', sPeekId],
    enabled: sPeekId != null,
    staleTime: 30_000,
    queryFn: async () => (await vulnManagementApi.vulnerabilities.getAll({
      ctem_scope_id: sPeekId as number, limit: 500, template_type: '_general',
    } as any)).data as any[],
  });
  // The CLOSED side of the loop — findings a Nessus re-scan verified gone
  // (status auto_closed_fixed). Open-only scopeFindings drops these, so the
  // Mobilise board's "Fixed" tab needs them fetched separately.
  const { data: scopeFixed } = useQuery({
    queryKey: ['ctem.scope-fixed', sPeekId],
    enabled: sPeekId != null,
    staleTime: 30_000,
    queryFn: async () => (await vulnManagementApi.vulnerabilities.getAll({
      ctem_scope_id: sPeekId as number, status: 'auto_closed_fixed', limit: 200,
    } as any)).data as any[],
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ['vuln.tenant-users'],
    queryFn: async () => (await apiClient.get<Array<{ id: number; display_name: string; email: string }>>('/assets/tenant-users')).data,
    staleTime: 5 * 60 * 1000,
  });
  const mobiliseMutation = useMutation({
    mutationFn: (body: { scopeId: number; vulnerability_id: number; assignee_user_id: number; approver_user_id?: number }) =>
      ctemScopesApi.mobilise(body.scopeId, {
        vulnerability_id: body.vulnerability_id,
        assignee_user_id: body.assignee_user_id,
        approver_user_id: body.approver_user_id,
      }),
    onSuccess: () => { setError(null); setAssigning(null); setAssigneeId(''); setApproverId(''); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to assign this fix'),
  });
  // Validate-stage action: run the AI context mapper over THIS scope's findings
  // (background; the panel below polls it). The CWE rule crosswalk is GONE — the
  // AI reads every finding against the locked Unified Control Library; sure picks
  // auto-link (reversible), weak ones wait in the review panel. A finding with a
  // stored answer is skipped, so re-runs only pay for what's new.
  const mapControls = useMutation({
    mutationFn: async () => {
      await vulnManagementApi.vulnerabilities.aiProposalsGenerate(s!.id);
    },
    onSuccess: () => { setError(null); invalidate(); qc.invalidateQueries({ queryKey: ['ai-control-proposals'] }); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Control mapping failed'),
  });
  const decideMutation = useMutation({
    mutationFn: (body: { scopeId: number; approvalId: number; decision: 'approve' | 'reject' }) =>
      ctemScopesApi.decideMobilise(body.scopeId, body.approvalId, { decision: body.decision }),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to record the decision'),
  });

  const portfolio = useMemo(() => {
    const sum = (f: (s: Scope) => number) => SCOPES.reduce((a, s) => a + f(s), 0);
    // effective = genuine retest (tested) + Nessus re-scan closure (verified);
    // both prove the fix, so both count toward coverage — matching the per-scope panel.
    const controls = sum((s) => s.controls), tested = sum((s) => s.tested) + sum((s) => s.verified ?? 0);
    // trend across scopes: align on the LAST N points each scope has (real, may be short)
    const n = Math.max(1, ...SCOPES.map((s) => s.tFind.length));
    const series = Array.from({ length: n }, (_, i) => SCOPES.reduce((a, s) => {
      const off = s.tFind.length - n + i; return a + (off >= 0 ? s.tFind[off] : 0);
    }, 0));
    const pf = spark(series.length > 1 ? series : [series[0] ?? 0, series[0] ?? 0], 220, 30, 3);
    return {
      scopes: SCOPES.length,
      openCycles: SCOPES.filter((s) => s.cycleOpen).length,
      assets: sum((s) => s.assets),
      findings: sum((s) => s.findings),
      dangerous: sum((s) => s.dangerous),
      // FAIR is portfolio-only, and honest about [DEMO]-only inputs
      exposure: quantify && !quantify.demo_only ? money(quantify.ale, quantify.currency) : null,
      worst: quantify && !quantify.demo_only ? money(quantify.p95, quantify.currency) : null,
      coverage: controls ? Math.round((tested / controls) * 100) : 0,
      spark: pf,
    };
  }, [SCOPES, quantify]);

  const s: Scope | undefined = SCOPES.find((x) => x.id === selId) ?? SCOPES[0];
  const view: 'program' | 'empty' = SCOPES.length === 0 && !isLoading ? 'empty' : 'program';

  if (isLoading) {
    return <div className="flex items-center gap-2 py-16 justify-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading exposure program…</div>;
  }
  if (isError) {
    // A failed load is NOT "no scopes" — never show the create-your-first-scope state on an error.
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
            <CreateScopeForm form={form} setForm={setForm} assets={scopeAssets ?? []} onSubmit={() => createMutation.mutate()} onCancel={() => setShowCreate(false)} pending={createMutation.isPending} />
          </Modal>
        )}
      </div>
    );
  }

  const covTotal = Math.max(1, s.tested + s.failed + (s.verified ?? 0) + s.claimed);
  // "Effective" = a fix PROVEN to work: a genuine retest (tested_effective) OR a
  // Nessus re-scan that no longer sees the finding (remediation_verified). The
  // bar/percentage must count both — omitting re-scan closures (the normal path
  // here) is what made this read "0% effective" after the loop was actually done.
  const effective = s.tested + (s.verified ?? 0);
  const effectivePct = Math.round((effective / covTotal) * 100);
  const pair = sparkPair(s.tFind, s.tDang, 240, 56, 6);
  const dF = delta(s.findings, s.prevFind, false);
  const dD = delta(s.dangerous, s.prevDang, true);
  const dM = delta(s.fixes, s.prevMob, false);
  const fb = s.findings || 1;
  const alePos = s.ale != null && s.aleMin != null && s.p95 != null ? Math.max(6, Math.min(94, Math.round(((s.ale - s.aleMin) / Math.max(1, s.p95 - s.aleMin)) * 100))) : 50;
  const findingsHref = `/vulnerabilities?ctem_scope_id=${s.id}&ctem_scope_name=${encodeURIComponent(s.name)}`;

  // ── Gated loop ────────────────────────────────────────────────────────────
  // With an OPEN cycle, a stage's numbers show — and the next stage unlocks —
  // only after the stage was RUN in THIS cycle (server-stamped on the cycle
  // row; Validate stamps automatically when its AI mapping run finishes, so
  // navigating away can never lose it). No open cycle → history view: last
  // cycle's numbers show, all actions locked behind "open a cycle".
  const sp = s.stageProgress ?? null;
  const gated = sp !== null;
  const g = {
    discover: !gated || !!sp?.discover,
    prioritise: !gated || !!sp?.prioritise,
    validate: !gated || !!sp?.validate,
    dispatch: !gated || !!sp?.dispatch,
  };

  const stages = [
    { n: 1, label: 'Scope', value: s.assets, sub: 'machines this scope owns', accent: 'plain' as const, c: '#0ea5e9' },
    { n: 2, label: 'Discover', value: g.discover ? s.findings : '—', sub: g.discover ? `open findings on those ${s.assets}` : 'not run this cycle — open the stage and run it', accent: 'plain' as const, c: '#14b8a6' },
    { n: 3, label: 'Prioritise', value: g.prioritise ? (s.analysable ? s.analysable.real_vulnerabilities : s.dangerous) : '—', sub: g.prioritise ? `ranked automatically · ${s.dangerous} confirmed reachable` : 'runs after Discover', accent: 'rose' as const, c: '#f43f5e' },
    { n: 4, label: 'Validate', value: g.validate ? s.controls : '—', sub: g.validate ? `controls cover them${(s.tested + (s.verified ?? 0)) > 0 ? ` · ${s.tested + (s.verified ?? 0)} proven by re-scan` : ''}${s.failed > 0 ? ` · ${s.failed} failed` : ''}` : 'runs after Prioritise', accent: 'plain' as const, c: '#8b5cf6' },
    { n: 5, label: 'Mobilise', value: g.dispatch ? s.fixes : '—', sub: g.dispatch ? `${s.tasks ?? 0} assigned to a person in the platform` : g.validate ? 'press “Dispatch to Mobilise” on Validate' : 'unlocks after Validate + Dispatch', accent: 'emerald' as const, c: '#10b981' },
  ];
  // what happens on each arrow (the hand-off between stages)
  const convs = ['scanner runs on them', 'attack-path engine checks each', 'AI reads each vulnerability vs the control library', 'assign in-platform (or ITSM)'];

  // ── Guided-stepper gating ──────────────────────────────────────────────────
  // "Done" = the per-cycle stamp when a cycle is open (the honest signal the
  // owner asked for); the old live-count proxies survive only for the
  // no-open-cycle history view.
  const stageDone: Record<number, boolean> = {
    1: s.assets > 0,
    2: gated ? !!sp?.discover : s.findings > 0,
    3: gated ? !!sp?.prioritise : (s.buckets?.chainless ?? 0) === 0,
    4: gated ? !!sp?.validate : s.controls > 0,
    5: (s.tasks ?? 0) > 0 || s.fixes > 0,
  };
  const firstIncomplete = [1, 2, 3, 4, 5].find((n) => !stageDone[n]) ?? 5;
  const activeStage = activeStageRaw ?? firstIncomplete;
  // An action is allowed only once every earlier stage is done. Viewing is
  // always allowed (any node is clickable); only the stage's ACTION is gated.
  const stageReachable = (n: number) => [1, 2, 3, 4].slice(0, n - 1).every((k) => stageDone[k]);
  const stageState = (n: number): 'done' | 'current' | 'upcoming' =>
    stageDone[n] ? 'done' : n === activeStage ? 'current' : 'upcoming';

  return (
    <div className="space-y-4">
      {error && (
        <p className="flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <CreateScopeForm form={form} setForm={setForm} assets={scopeAssets ?? []} onSubmit={() => createMutation.mutate()} onCancel={() => setShowCreate(false)} pending={createMutation.isPending} />
        </Modal>
      )}
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
                // real people only — the IGA sample-seed users (*.sample) are demo
                // identities and must never own a fix
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
                {mobiliseMutation.isPending ? 'Assigning…' : 'Assign'}
              </button>
              <button onClick={() => setAssigning(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {view === 'program' ? (
        <div className="mx-auto w-full max-w-[1520px] space-y-4">
          {/* ── header ── */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[19px] font-semibold tracking-tight text-slate-900">Exposure program</h1>
              <p className="mt-1 max-w-2xl text-[13px] text-slate-500">
Each scope is an owned slice of your attack surface — run its loop as a cycle you open and close.
              </p>
            </div>
            {canEdit && (
              <button onClick={() => setShowCreate((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-primary-700">
                <Plus className="h-4 w-4" strokeWidth={2.2} /> New scope
              </button>
            )}
          </div>

          {/* ── portfolio KPI band — only when there is more than one scope to roll up ── */}
          {SCOPES.length > 1 && (
          <Card className="flex items-stretch divide-x divide-slate-100 overflow-hidden">
            <KpiCell label="Scopes" value={portfolio.scopes} sub={`${portfolio.openCycles} cycles open`} title="Named slices of the attack surface you run the loop over." />
            <KpiCell label="Attack surface" value={portfolio.assets} sub="assets monitored" title="Distinct assets matching at least one scope's membership rule." />
            <div className="flex flex-[1.3] flex-col justify-between p-[14px_18px]" title="Total findings across all scopes, last 5 cycles.">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Open findings</p>
                <p className="mt-1 text-[26px] font-bold leading-none tabular-nums text-slate-900">{portfolio.findings}</p>
              </div>
              <svg viewBox="0 0 220 34" preserveAspectRatio="none" className="mt-1.5 h-[26px] w-full">
                <path d={portfolio.spark.area} fill="rgba(30,212,176,0.14)" />
                <polyline points={portfolio.spark.line} fill="none" stroke="#1ed4b0" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <KpiCell label="Dangerous now" value={portfolio.dangerous} sub="reachable attack paths" valueClass="text-rose-700" title="Findings with a confirmed, reachable attack path." />
            <KpiCell label="Annual exposure" value={portfolio.exposure ?? <span className="text-[15px] font-semibold text-slate-400">not quantified</span>} sub={portfolio.exposure ? `worst case ${portfolio.worst}` : (quantify?.demo_only ? 'only [DEMO] risks on file' : 'no real risks quantified')} title="Portfolio FAIR run. Shown only when computed from real risks." />
            <div className="flex-[1.05] p-[14px_18px]" title="Share of mapped controls tested and effective, across all scopes.">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Control coverage</p>
              <p className="mt-1 text-[26px] font-bold leading-none tabular-nums text-slate-900">{portfolio.coverage}%</p>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-primary-600 to-primary-700" style={{ width: `${portfolio.coverage}%` }} />
              </div>
            </div>
          </Card>
          )}

          {/* ── scope switcher — only when there is more than one scope to switch between ── */}
          {SCOPES.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            {SCOPES.map((sc) => {
              const active = sc.id === s.id;
              const dot = sc.dangerous >= 10 ? '#be123c' : sc.dangerous >= 5 ? '#f59e0b' : '#10b981';
              return (
                <button key={sc.id} onClick={() => { setSelId(sc.id); setActiveStage(null); }}
                  className={`inline-flex items-center gap-2.5 rounded-xl border bg-white px-3 py-2 text-left transition ${
                    active ? 'border-primary-600 ring-[3px] ring-primary-600/10' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <span className="text-[13px] font-semibold text-slate-900">{sc.name}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    sc.cycleOpen ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'
                  }`}>{sc.cycleOpen ? `#${sc.cycleNo} open` : 'idle'}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
                    <b className="font-semibold tabular-nums text-slate-700">{sc.dangerous}</b> dangerous
                    <span className="text-slate-300">·</span>
                    <b className="font-semibold tabular-nums text-slate-700">{sc.findings}</b> findings
                  </span>
                </button>
              );
            })}
          </div>
          )}

          {/* ── command centre (full width) ── */}
          <div className="space-y-3.5">
              {/* detail header */}
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3.5">
                  <div className="min-w-0 flex-[1_1_320px]">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="text-lg font-semibold tracking-tight text-slate-900">{s.name}</h2>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold ${
                        s.cycleOpen ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'
                      }`}>
                        {s.cycleOpen ? `Cycle #${s.cycleNo} · Open` : 'No open cycle'}
                      </span>
                      {s.cycleOpen && s.cycleDueAt && (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${
                          s.cycleOverdue ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-600'
                        }`} title="The cadence deadline: an open cycle must be closed within its cadence window.">
                          {s.cycleOverdue
                            ? `Overdue — was due ${new Date(s.cycleDueAt).toLocaleDateString()} · close & save it`
                            : `Cycle ends ${new Date(s.cycleDueAt).toLocaleDateString()}`}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12px] text-slate-600">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={s.owner ? 'Business owner' : 'No business owner set on this scope yet'}>
                        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${s.owner ? 'bg-primary-50 text-primary-800' : 'bg-slate-100 text-slate-400'}`}>
                          {s.owner ? s.owner.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '?'}
                        </span>
                        {s.owner ?? <span className="text-slate-400">owner unassigned</span>}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-slate-500"><Calendar className="h-3.5 w-3.5" /> {s.cadence} cadence</span>
                      <span className="inline-flex items-center gap-1.5 text-slate-500"><Table2 className="h-3.5 w-3.5" /> {s.membership}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link href={findingsHref} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-[7px] text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-50">
                      <ExternalLink className="h-3.5 w-3.5" /> View findings
                    </Link>
                    {canEdit && (s.cycleOpen ? (
                      <button onClick={() => s.cycleId && closeMutation.mutate(s.cycleId)} disabled={closeMutation.isPending || !s.cycleId}
                        title="Close this cycle — freezes today's numbers as a permanent, tamper-proof record."
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-[7px] text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                        {closeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} Close &amp; save
                      </button>
                    ) : (
                      <button onClick={() => openMutation.mutate(s.id)} disabled={openMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-[7px] text-[12.5px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                        {openMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Open cycle
                      </button>
                    ))}
                    {canEdit && (
                      <button
                        onClick={() => { if (window.confirm(`Delete scope “${s.name}”? This removes the scope and any open cycle. Findings and assets are not touched.`)) deleteMutation.mutate(s.id); }}
                        disabled={deleteMutation.isPending}
                        title="Delete this scope. A scope with closed (frozen) cycles can't be deleted — its audit history is immutable."
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-[7px] text-[12.5px] font-medium text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50">
                        {deleteMutation.isPending && deleteMutation.variables === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
                      </button>
                    )}
                  </div>
                </div>
                {/* cycle guide — plain words: what this is, what to do now, and why */}
                <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
                    {s.cycleOpen && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />}
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: s.cycleOpen ? '#10b981' : '#94a3b8' }} />
                  </span>
                  <div className="min-w-0">
                    {s.cycleOpen ? (
                      <>
                        <p className="text-[12.5px] font-semibold text-slate-800">Cycle #{s.cycleNo} is open · day {s.cycleDay ?? 0} — the loop below is measuring live.</p>
                      </>
                    ) : s.cycleNo > 0 ? (
                      <>
                        <p className="text-[12.5px] font-semibold text-slate-800">No cycle open — last one (#{s.cycleNo}) closed {s.lastClosed ?? ''} and is saved.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-[12.5px] font-semibold text-slate-800">No cycle has been run on this scope yet.</p>
                      </>
                    )}
                  </div>
                </div>
              </Card>

              {/* ── the CTEM loop, as a guided stepper ── */}
              <Card className="p-4">
                <div className="mb-3 flex items-start gap-2">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" />
                  <div>
                    <p className="text-[13px] font-semibold text-slate-900">The CTEM loop — one stage at a time</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">Run each stage in order — a stage unlocks the next.</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50/70 to-white p-3">
                  <div className="flex items-stretch">
    {stages.map((st, i) => {
                      const state = stageState(st.n);
                      const isActive = st.n === activeStage;
                      // Gated loop: a locked stage is NOT clickable — you cannot even
                      // open Mobilise until Validate has completed in this cycle.
                      const locked = (gated && !stageDone[st.n] && !stageReachable(st.n))
                        || (gated && st.n === 5 && !sp?.dispatch);   // Mobilise opens only on explicit dispatch
                      return (
                        <div key={st.label} className="contents">
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => !locked && setActiveStage(st.n)}
                            title={locked ? `${st.label} — locked until the previous stage is run in this cycle` : state === 'upcoming' ? `${st.label} — view only until the earlier stages are done` : st.sub}
                            className={`block min-w-0 flex-1 rounded-xl border bg-white p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md 2xl:p-3 ${
                              isActive ? 'ring-2 ring-offset-1' : ''
                            } ${state === 'upcoming' ? 'opacity-55' : ''}`}
                            style={{ borderTop: `3px solid ${st.c}`, ...(isActive ? { boxShadow: `0 0 0 2px ${st.c}55` } : {}) }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className="inline-flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm"
                                style={{ backgroundColor: state === 'done' ? '#10b981' : state === 'upcoming' ? '#cbd5e1' : st.c }}
                              >
                                {state === 'done' ? '✓' : st.n}
                              </span>
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{st.label}</span>
                              {isActive && <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-slate-400">you are here</span>}
                            </div>
                            <p className={`mt-1.5 text-[22px] font-bold leading-none tabular-nums 2xl:text-[28px] ${
                              st.accent === 'rose' ? 'text-rose-700' : st.accent === 'emerald' ? 'text-emerald-700' : 'text-slate-900'
                            }`}>{st.value}</p>
                            <p className="mt-1 text-[10.5px] leading-tight text-slate-500 2xl:text-[11px]">{st.sub}</p>
                          </button>
                          {i < stages.length - 1 && (
                            <div className="flex w-[64px] shrink-0 flex-col items-center justify-center gap-1 px-1 2xl:w-[84px]">
                              <ArrowRight className={`h-4 w-4 ${stageDone[st.n] ? 'text-emerald-500' : 'text-slate-300'}`} />
                              <span className="text-center text-[9.5px] leading-tight text-slate-400">{convs[i]}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>

              {/* STAGE 2 DISCOVER — the findings your scan already produced */}
              {activeStage === 2 && (
              <Card className="p-4">
                <SectionTitle icon={<Search className="h-[15px] w-[15px] text-primary-700" />} className="mb-3">Discover — scanner results on this scope</SectionTitle>
                {gated && !g.discover ? (
                  <div className="py-8 text-center">
                    <p className="text-[13px] font-semibold text-slate-900">Discovery hasn&apos;t been run for this cycle yet.</p>
                    <p className="mx-auto mt-1 max-w-xl text-[12px] text-slate-500">
                      Your scanner sync keeps importing results in the background. Running Discover pulls the current
                      picture into THIS cycle — nothing shows on this loop until you do.
                    </p>
                    {canEdit && (
                      <button onClick={() => completeStage.mutate({ scopeId: s.id, stage: 'discover' })}
                        disabled={completeStage.isPending}
                        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                        {completeStage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Run discovery for this cycle
                      </button>
                    )}
                  </div>
                ) : s.findings > 0 ? (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[30px] font-bold leading-none tabular-nums text-slate-900">{s.findings}</span>
                        <span className="text-[12px] text-slate-500">open scanner results across {s.assets} machine{s.assets === 1 ? '' : 's'} — imported by your scanner sync</span>
                      </div>
                      <Link href={findingsHref} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary-700 hover:underline">
                        Open in the full register <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                    <div className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-slate-100">
                      <table className="w-full text-[12px]">
                        <thead className="sticky top-0 bg-slate-50">
                          <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                            <th className="px-3 py-2 text-left font-semibold">Result</th>
                            <th className="px-3 py-2 text-left font-semibold">Machine</th>
                            <th className="px-3 py-2 text-left font-semibold">Severity</th>
                            <th className="px-3 py-2 text-right font-semibold">CVSS</th>
                            <th className="px-3 py-2 text-right font-semibold">EPSS</th>
                            <th className="px-3 py-2 text-left font-semibold">KEV</th>
                            <th className="px-3 py-2 text-left font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // real vulnerabilities on top, info noise last (was dumping
                            // 180 info rows above the 24 that matter)
                            const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
                            return [...(scopeFindings ?? [])].sort((a: any, b: any) =>
                              (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)
                              || (Number(b.cvss_score ?? 0) - Number(a.cvss_score ?? 0)));
                          })().map((v: any) => {
                            const sv = sevStyle((['critical','high','medium','low'].includes(v.severity) ? v.severity : 'low') as Sev);
                            // Info findings aren't CVEs — they carry no CVSS/EPSS/KEV. Show "—"
                            // (not applicable), never a fake "0.0".
                            const hasScore = v.severity !== 'info' && v.cvss_score != null && Number(v.cvss_score) > 0;
                            return (
                              <tr key={v.id} onClick={() => router.push(`/vulnerabilities/${v.id}`)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                                <td className="max-w-[360px] truncate px-3 py-1.5 font-medium text-slate-800" title={v.title}>{v.title}</td>
                                <td className="px-3 py-1.5 text-slate-500">
                                  {(v.linked_assets ?? []).length > 0
                                    ? <span className="inline-flex items-center gap-1" title={(v.linked_assets ?? []).join(', ')}><Server className="h-3 w-3 text-slate-400" />{v.linked_assets[0]}{v.linked_assets.length > 1 ? ` +${v.linked_assets.length - 1}` : ''}</span>
                                    : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${v.severity === 'info' ? 'bg-slate-100 text-slate-500' : sv.className}`}>{v.severity === 'info' ? 'Info' : sv.label}</span></td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600" title={v.severity === 'info' ? 'Informational finding — not a CVE, so no CVSS score' : undefined}>{hasScore ? Number(v.cvss_score).toFixed(1) : '—'}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{v.epss_score != null ? `${Math.round(Number(v.epss_score) * 100)}%` : '—'}</td>
                                <td className="px-3 py-1.5">{v.kev_flag ? <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">KEV</span> : <span className="text-slate-300">—</span>}</td>
                                <td className="px-3 py-1.5 text-slate-500">{v.status}</td>
                              </tr>
                            );
                          })}
                          {!scopeFindings && (
                            <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Loading scanner results…</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">Same rows as the vulnerabilities register, filtered to this scope. Click a row to open the finding. Next: Prioritise ranks these by risk.</p>
                  </>
                ) : (
                  <p className="max-w-2xl text-[12px] leading-relaxed text-slate-500">
                    No scanner results on this scope&apos;s machines yet. Discovery comes from the scanner — run a <b>Nessus scan</b> against these hosts and <b>Sync</b> the connection, then they appear here.
                  </p>
                )}
              </Card>
              )}

              {/* STAGE 3 — the AUTOMATIC risk ranking. Prioritisation already
                  happened the moment findings were enriched: severity, CVSS,
                  EPSS (probability of exploitation) and CISA-KEV are on every
                  row. This list is that ranking — it exists with no button.
                  The reachability engine below is a REFINEMENT on top. */}
              {activeStage === 3 && gated && !g.prioritise && (
              <Card className="p-4">
                <div className="py-8 text-center">
                  <p className="text-[13px] font-semibold text-slate-900">Prioritisation hasn&apos;t been run for this cycle yet.</p>
                  <p className="mx-auto mt-1 max-w-xl text-[12px] text-slate-500">
                    The attack-path engine tests every finding × machine pair in this scope and ranks
                    what an attacker could actually reach. Nothing shows until you run it.
                  </p>
                  {canEdit && (
                    <button onClick={() => computePaths.mutate(s.id)} disabled={computePaths.isPending}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                      {computePaths.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
                      {computePaths.isPending ? 'Analysing attack paths…' : 'Run prioritisation'}
                    </button>
                  )}
                </div>
              </Card>
              )}
              {activeStage === 3 && (!gated || g.prioritise) && (
              <Card className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <SectionTitle icon={<Crosshair className="h-[15px] w-[15px] text-rose-700" />}>Ranked by risk on your hosts — automatic</SectionTitle>
                  <span className="text-[11px] text-slate-400">the same contextual score each finding’s Risk analysis shows (/100)</span>
                </div>
                {(() => {
                  const sevRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
                  // Primary key: composite_priority — the stored 7-signal contextual
                  // score (CVSS/EPSS/maturity/KEV/vector/exposure/asset), the SAME
                  // number the finding page's Risk analysis shows as N/100. Ranking
                  // by abstract CVSS alone floated a blocked internal CVSS-10 above an
                  // actively-exploited 8.8 — the contradiction the owner caught.
                  const ranked = [...(scopeFindings ?? [])]
                    .filter((v: any) => v.severity !== 'info')
                    .sort((a: any, b: any) =>
                      ((b.composite_priority ?? -1) - (a.composite_priority ?? -1))
                      || (Number(!!b.kev_flag) - Number(!!a.kev_flag))
                      || ((b.epss_score ?? 0) - (a.epss_score ?? 0))
                      || ((b.cvss_score ?? 0) - (a.cvss_score ?? 0))
                      || ((sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0)));
                  if (!scopeFindings) return <p className="py-4 text-center text-[12px] text-slate-400">Loading…</p>;
                  if (ranked.length === 0) return <p className="rounded-lg bg-slate-50 p-3 text-[11.5px] text-slate-500">Only informational notes in this scope — nothing carries a CVE/CVSS to rank. The desktop scope is where the rankable vulnerabilities live.</p>;
                  return (
                    <div className="space-y-0.5">
                      {(showAllRanked ? ranked : ranked.slice(0, 12)).map((v: any, i: number) => {
                        const sv = sevStyle((['critical','high','medium','low'].includes(v.severity) ? v.severity : 'low') as Sev);
                        const controls: string[] = Array.isArray(v.linked_control_codes) ? v.linked_control_codes : [];
                        return (
                          <div key={v.id} className="flex items-center gap-3 rounded-lg border border-transparent p-2 transition hover:border-slate-200 hover:bg-slate-50">
                            <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-bold tabular-nums text-slate-500">{i + 1}</span>
                            <Link href={`/vulnerabilities/${v.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12.5px] font-medium text-slate-900" title={v.title}>{v.title}</p>
                                <p className="mt-px text-[11px] text-slate-400">
                                  CVSS {v.cvss_score != null ? Number(v.cvss_score).toFixed(1) : '—'}
                                  {v.epss_score != null && <span className="ml-1.5 text-amber-700">EPSS {Math.round(Number(v.epss_score) * 100)}%</span>}
                                  {v.kev_flag && <span className="ml-1.5 rounded bg-rose-50 px-1 py-0 font-semibold text-rose-700">actively exploited</span>}
                                  {controls.length > 0 && (
                                    <span className="ml-1.5 rounded bg-primary-50 px-1 py-0 font-semibold text-primary-700" title="The control that ADDRESSES this finding (the fix to implement). It does not close the finding — only a Nessus re-scan that no longer sees it does.">fix: {controls[0]}{controls.length > 1 ? ` +${controls.length - 1}` : ''}</span>
                                  )}
                                </p>
                              </div>
                            </Link>
                            {v.composite_priority != null && (
                              <span className="shrink-0 text-right" title="Contextual risk on this host — the same score the finding's Risk analysis shows. Severity alone can say 'Critical' while the host context says the flaw is hard to reach here.">
                                <span className="block text-[14px] font-bold leading-none tabular-nums text-slate-900">{Math.round(Number(v.composite_priority) * 10)}<span className="text-[10px] font-semibold text-slate-400">/100</span></span>
                                <span className="text-[9px] uppercase tracking-wide text-slate-400">on this host</span>
                              </span>
                            )}
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sv.className}`} title="Abstract severity of the flaw itself — before host context.">{sv.label}</span>
                          </div>
                        );
                      })}
                      {ranked.length > 12 && (
                        <button type="button" onClick={() => setShowAllRanked((x) => !x)} className="mt-1 text-[12px] font-medium text-primary-700 hover:underline">
                          {showAllRanked ? 'Show fewer' : `Show all ${ranked.length} vulnerabilities`}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </Card>
              )}

              {/* STAGE 5 MOBILISE — a WORK BOARD, not a risk list. Prioritise (stage 3)
                  answers "what is dangerous"; this answers "who is fixing what, and how
                  far along". Ordered by workflow status (needs-owner first), not by rank. */}
              {activeStage === 5 && (
              <Card className="p-4">
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-[11.5px] leading-snug text-emerald-800">
                  <Send className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span><b>Mobilise</b> — hand each real vulnerability to one owner. <b>Assign</b> creates a workflow task and emails them the finding, its fix control, and the recommended fix. Nobody closes a finding by hand — a <b>Nessus re-scan</b> that no longer sees it is the only proof.</span>
                </div>
                {gated && !sp?.dispatch ? (
                  <div className="py-8 text-center">
                    <p className="text-[13px] font-semibold text-slate-900">Nothing has been dispatched to Mobilise yet.</p>
                    <p className="mx-auto mt-1 max-w-xl text-[12px] text-slate-500">
                      Mobilise receives its work list ONLY when you press <b>Dispatch to Mobilise</b> on the
                      Validate stage — the linked vulnerabilities arrive here, priority first, nothing stale.
                    </p>
                  </div>
                ) : (() => {
                  // the work list = EXACTLY the vulnerabilities Validate linked to controls
                  // (falls back to the old severity guess only in history view)
                  const linkedSet = new Set(s.pipeline?.linked_ids ?? []);
                  const workItems = [...(scopeFindings ?? [])].filter((v: any) =>
                    linkedSet.size > 0 ? linkedSet.has(v.id) : v.severity !== 'info');
                  const statusOf = (v: any): 'unassigned' | 'inprogress' => (v.assigned_to ? 'inprogress' : 'unassigned');
                  const needsOwner = workItems.filter((v: any) => statusOf(v) === 'unassigned').length;
                  const inProgress = workItems.length - needsOwner;
                  // "Fixed & verified" counts REAL remediations only. An informational
                  // finding that a re-scan stopped reporting is not a fix — it's volatile
                  // data (e.g. DNS cache) that varies between scans; counting it would
                  // inflate the real number. Shown separately as "no longer reported".
                  const fixed = scopeFixed ? scopeFixed.filter((v: any) => v.severity !== 'info').length : (s.closedVerified ?? 0);
                  if (!scopeFindings) return <p className="py-4 text-center text-[12px] text-slate-400">Loading…</p>;
                  if (workItems.length === 0) return <p className="rounded-lg bg-slate-50 p-3 text-[11.5px] text-slate-500">No real vulnerabilities to assign in this scope — only informational notes, which describe the machine and have nothing to fix.</p>;
                  const filtered = workItems
                    .filter((v: any) => mobFilter === 'all' ? true : statusOf(v) === mobFilter)
                    .sort((a: any, b: any) => {
                      const rank: Record<string, number> = { unassigned: 0, inprogress: 1 };
                      return (rank[statusOf(a)] - rank[statusOf(b)]) || ((b.composite_priority ?? -1) - (a.composite_priority ?? -1));
                    });
                  const Tab = ({ id, label, n, tone }: { id: 'all' | 'unassigned' | 'inprogress'; label: string; n: number; tone: string }) => (
                    <button type="button" onClick={() => setMobFilter(id)}
                      className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition ${mobFilter === id ? 'ring-1 ' + tone : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                      {label} <span className="tabular-nums font-bold">{n}</span>
                    </button>
                  );
                  const renderWorkRow = (v: any) => {
                    const st = statusOf(v);
                    const sv = sevStyle((['critical', 'high', 'medium', 'low'].includes(v.severity) ? v.severity : 'low') as Sev);
                    const controls: string[] = Array.isArray(v.linked_control_codes) ? v.linked_control_codes : [];
                    let age: { t: string; c: string } | null = null;
                    if (v.due_date) {
                      const d = Math.ceil((new Date(v.due_date).getTime() - Date.now()) / 86400000);
                      age = d < 0 ? { t: `overdue ${Math.abs(d)}d`, c: 'text-rose-600' } : { t: `${d}d left`, c: d <= 7 ? 'text-amber-600' : 'text-slate-400' };
                    }
                    return (
                      <div key={v.id} className={`flex items-center gap-3 rounded-lg border p-2.5 transition ${st === 'unassigned' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'} hover:border-slate-300`}>
                        <span className={`w-[86px] shrink-0 rounded-md px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wide ${st === 'unassigned' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>
                          {st === 'unassigned' ? 'Needs owner' : 'In progress'}
                        </span>
                        <Link href={`/vulnerabilities/${v.id}`} className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium text-slate-900" title={v.title}>{v.title}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                            <span className={`rounded-full px-1.5 py-0 text-[10px] font-semibold ${sv.className}`}>{sv.label}</span>
                            {(v.linked_assets ?? []).length > 0 && <span className="inline-flex items-center gap-0.5 text-slate-500" title={(v.linked_assets ?? []).join(', ')}><Server className="h-3 w-3" />{v.linked_assets[0]}{v.linked_assets.length > 1 ? ` +${v.linked_assets.length - 1}` : ''}</span>}
                            {v.composite_priority != null && <span title="Contextual risk on this host (/100).">{Math.round(Number(v.composite_priority) * 10)}/100</span>}
                            {v.kev_flag && <span className="rounded bg-rose-50 px-1 font-semibold text-rose-700">actively exploited</span>}
                          </p>
                        </Link>
                        <div className="shrink-0">
                          <MobiliseControlCell vulnId={v.id} count={controls.length} canEdit={canEdit} onChanged={() => qc.invalidateQueries({ queryKey: ['ctem.scope-findings'] })} />
                        </div>
                        <div className="hidden w-[132px] shrink-0 text-right sm:block">
                          {v.assignee_name
                            ? <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-700" title="Owner of this fix"><span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600">{String(v.assignee_name).slice(0, 2).toUpperCase()}</span><span className="truncate">{v.assignee_name}</span></span>
                            : <span className="text-[11px] text-amber-600">no owner yet</span>}
                          {age && <span className={`block text-[10px] ${age.c}`}>{age.t}</span>}
                        </div>
                        {canEdit && (
                          <button type="button"
                            title={st === 'unassigned' ? 'Assign this fix to one person — workflow task + email.' : 'Reassign to a different owner.'}
                            onClick={() => { setAssigning({ id: v.id, title: v.title } as any); setAssigneeId(''); setApproverId(''); setAssigneeQuery(''); }}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium ${st === 'unassigned' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            <Send className="h-3 w-3" /> {st === 'unassigned' ? 'Assign' : 'Reassign'}
                          </button>
                        )}
                      </div>
                    );
                  };
                  const byOwner = (() => {
                    const g: Record<string, any[]> = {};
                    filtered.forEach((v: any) => { const k = v.assignee_name || ' Unassigned'; (g[k] = g[k] || []).push(v); });
                    return Object.entries(g).sort((a, b) => a[0] === ' Unassigned' ? 1 : b[0] === ' Unassigned' ? -1 : a[0].localeCompare(b[0]));
                  })();
                  return (
                    <>
                      {/* the workflow pipeline as filter tabs — what makes this a board */}
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Tab id="all" label="All" n={workItems.length} tone="bg-slate-900 text-white ring-slate-900" />
                        <Tab id="unassigned" label="Needs owner" n={needsOwner} tone="bg-amber-50 text-amber-800 ring-amber-300" />
                        <Tab id="inprogress" label="In progress" n={inProgress} tone="bg-sky-50 text-sky-800 ring-sky-300" />
                        <div className="ml-auto flex items-center gap-2">
                          <div className="flex rounded-full border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-medium">
                            <button type="button" onClick={() => setMobGroup('status')} className={`rounded-full px-2.5 py-0.5 ${mobGroup === 'status' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>By status</button>
                            <button type="button" onClick={() => setMobGroup('owner')} className={`rounded-full px-2.5 py-0.5 ${mobGroup === 'owner' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>By owner</button>
                          </div>
                          <button type="button" onClick={() => setMobFilter('fixed')}
                            title="Closed automatically when a Nessus re-scan no longer saw the finding (SCANNER_VERIFIED) — never hand-closed. Click to see which ones."
                            className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition ${mobFilter === 'fixed' ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                            Fixed &amp; verified <span className="tabular-nums font-bold">{fixed}</span>
                          </button>
                        </div>
                      </div>
                      {mobFilter === 'fixed' ? (
                        !scopeFixed ? <p className="py-4 text-center text-[12px] text-slate-400">Loading…</p>
                        : scopeFixed.length === 0 ? (
                          <p className="rounded-lg bg-emerald-50/50 p-3 text-[11.5px] text-emerald-800">Nothing closed yet. When the owner fixes a host and the next Nessus re-scan no longer sees the finding, it lands here automatically — no one closes it by hand.</p>
                        ) : (() => {
                          const realFixed = scopeFixed.filter((v: any) => v.severity !== 'info');
                          const infoClosed = scopeFixed.filter((v: any) => v.severity === 'info');
                          const fixRow = (v: any) => {
                            const controls: string[] = Array.isArray(v.linked_control_codes) ? v.linked_control_codes : [];
                            return (
                              <div key={v.id} className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5">
                                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /></span>
                                <Link href={`/vulnerabilities/${v.id}`} className="min-w-0 flex-1">
                                  <p className="truncate text-[12.5px] font-medium text-slate-900" title={v.title}>{v.title}</p>
                                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                                    <span className="rounded-full bg-emerald-100 px-1.5 py-0 text-[10px] font-semibold text-emerald-700">verified fix · re-scan</span>
                                    {v.assignee_name && <span>fixed by {v.assignee_name}</span>}
                                    {controls.length > 0 && <span className="rounded bg-primary-50 px-1 font-semibold text-primary-700">fix: {controls[0]}{controls.length > 1 ? ` +${controls.length - 1}` : ''}</span>}
                                  </p>
                                </Link>
                              </div>
                            );
                          };
                          return (
                            <div className="space-y-3">
                              {realFixed.length > 0 && <div className="space-y-1">{realFixed.map(fixRow)}</div>}
                              {infoClosed.length > 0 && (
                                <div>
                                  <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">No longer reported · {infoClosed.length}</p>
                                  <p className="mb-1.5 text-[10.5px] text-slate-400">Informational items the last re-scan didn&apos;t report — volatile data (DNS cache, listeners…), not a remediation. Kept for the record, not counted as fixes.</p>
                                  <div className="space-y-1">
                                    {infoClosed.map((v: any) => (
                                      <div key={v.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
                                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold">i</span>
                                        <Link href={`/vulnerabilities/${v.id}`} className="min-w-0 flex-1">
                                          <p className="truncate text-[12.5px] font-medium text-slate-700" title={v.title}>{v.title}</p>
                                          <p className="mt-0.5 text-[11px] text-slate-400"><span className="rounded-full bg-slate-200 px-1.5 py-0 text-[10px] font-semibold text-slate-500">no longer reported</span></p>
                                        </Link>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      ) : filtered.length === 0 ? (
                        <p className="rounded-lg bg-slate-50 p-3 text-[11.5px] text-slate-500">
                          {mobFilter === 'unassigned' ? 'Every finding here already has an owner.' : mobFilter === 'inprogress' ? 'Nothing assigned yet — start with the “Needs owner” list.' : 'Nothing to show.'}
                        </p>
                      ) : mobGroup === 'owner' ? (
                        <div className="space-y-4">
                          {byOwner.map(([name, items]) => {
                            const overdue = items.filter((v: any) => v.due_date && new Date(v.due_date).getTime() < Date.now()).length;
                            return (
                              <div key={name}>
                                <div className="mb-1.5 flex items-center gap-2">
                                  {name === ' Unassigned'
                                    ? <span className="text-[12.5px] font-semibold text-amber-700">Unassigned</span>
                                    : <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600">{String(name).slice(0, 2).toUpperCase()}</span>{name}</span>}
                                  <span className="text-[11px] text-slate-400">{items.length} task{items.length > 1 ? 's' : ''}</span>
                                  {overdue > 0 && <span className="rounded bg-rose-50 px-1.5 py-0 text-[10px] font-semibold text-rose-700">{overdue} overdue</span>}
                                </div>
                                <div className="space-y-1">{items.map(renderWorkRow)}</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        (() => {
                          // SAME order as Validate: reachable first, then prioritised, then the rest.
                          const dangerSet = new Set(s.dangerousIds ?? []);
                          const priSet = new Set(s.pipeline?.priority_ids ?? []);
                          const sec1 = filtered.filter((v: any) => dangerSet.has(v.id));
                          const sec2 = filtered.filter((v: any) => !dangerSet.has(v.id) && priSet.has(v.id));
                          const sec3 = filtered.filter((v: any) => !dangerSet.has(v.id) && !priSet.has(v.id));
                          const Section = ({ title, tone, items }: { title: string; tone: string; items: any[] }) =>
                            items.length === 0 ? null : (
                              <div>
                                <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-wide ${tone}`}>{title} <span className="tabular-nums">({items.length})</span></p>
                                <div className="space-y-1">{items.map(renderWorkRow)}</div>
                              </div>
                            );
                          return (
                            <div className="space-y-4">
                              <Section title="⚡ Dangerous — confirmed reachable, fix first" tone="text-rose-700" items={sec1} />
                              <Section title="Prioritised vulnerabilities" tone="text-amber-700" items={sec2} />
                              <Section title="Other linked fixes (hardening & configuration)" tone="text-slate-500" items={sec3} />
                            </div>
                          );
                        })()
                      )}
                    </>
                  );
                })()}
              </Card>
              )}

              {/* STAGE 3 PRIORITISE — reachability refinement + financial exposure. */}
              {activeStage === 3 && (!gated || g.prioritise) && (
              <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                <Card className="p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <SectionTitle icon={<Crosshair className="h-[15px] w-[15px] text-rose-700" />}>Reachability check — which are actually attackable</SectionTitle>
                    <div className="flex items-center gap-3">
                      {canEdit && activeStage === 3 && (
                        <button onClick={() => computePaths.mutate(s.id)} disabled={computePaths.isPending}
                          title="Re-run the attack-path engine over every (finding x machine) pair in this scope - the same engine as the Exploit Test tab, batched."
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                          {computePaths.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          {computePaths.isPending ? 'Calculating…' : 'Recalculate attack paths'}
                        </button>
                      )}
                      <Link href="/vulnerabilities/choke-points" className="text-[12px] font-medium text-primary-700 hover:underline">Ranked list →</Link>
                    </div>
                  </div>
                  {computePaths.isSuccess && computePaths.data && computePaths.variables === s.id && (
                    <p className="mb-2 text-[11px] text-emerald-700">
                      Done — {computePaths.data.evaluated ?? 0} of {computePaths.data.pairs ?? 0} finding×machine pairs re-run through the engine:
                      {' '}{computePaths.data.snapshots_written ?? 0} verdict(s) changed, {computePaths.data.unchanged ?? 0} unchanged. Numbers below are refreshed.
                    </p>
                  )}
                  <div className="mb-1.5 flex h-2 overflow-hidden rounded-full bg-slate-100" title={`How this scope's ${s.findings} findings split by attack-path status.`}>
                    <div style={{ width: `${(s.buckets.ranked / fb) * 100}%`, background: '#be123c' }} />
                    <div style={{ width: `${(s.buckets.undeterminable / fb) * 100}%`, background: '#f59e0b' }} />
                    <div style={{ width: `${(s.buckets.chainless / fb) * 100}%`, background: '#cbd5e1' }} />
                    <div style={{ width: `${(s.buckets.severed / fb) * 100}%`, background: '#10b981' }} />
                  </div>
                  {s.analysable && (
                    <p className="mb-2 text-[10.5px] text-slate-500">
                      <b className="font-semibold text-slate-700">{s.analysable.real_vulnerabilities}</b> real vulnerabilities (CVE / weakness type the engine can reason about) ·{' '}
                      <b className="font-semibold text-slate-700">{s.analysable.informational}</b> informational (scanner notes with no CVE — can only ever be &ldquo;can&apos;t tell&rdquo;).
                    </p>
                  )}
                  <div className="mb-3.5 flex flex-wrap gap-x-4 gap-y-2.5 text-[11px] text-slate-500">
                    <Legend color="#be123c" value={s.buckets.ranked} label="dangerous" />
                    <Legend color="#f59e0b" value={s.buckets.undeterminable} label="can't tell" />
                    <Legend color="#cbd5e1" value={s.buckets.chainless} label="not calculated" />
                    <Legend color="#10b981" value={s.buckets.severed} label="blocked" />
                  </div>
                  {(() => { const ownerless = s.dangerousOwnerless ?? s.top.filter((f) => !f.owner).length; return ownerless > 0 ? (
                    <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-amber-800">
                      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                      <span><b>{ownerless} of these have no owner.</b> Assign a fix on the row below — pick the one person who owns it until a Nessus re-scan shows it gone.</span>
                    </p>
                  ) : null; })()}
                  <div className="space-y-0.5">
                    {s.top.length === 0 && (
                      <p className="rounded-lg bg-slate-50 p-3 text-[11.5px] text-slate-500">
                        No finding in this scope has a reachable attack path right now.
                        {s.buckets.chainless > 0 && ' Attack paths have not been calculated for ' + s.buckets.chainless + ' yet — run “Calculate attack paths” on the choke-points page.'}
                      </p>
                    )}
                    {s.top.map((f) => {
                      const sv = sevStyle((['critical','high','medium','low'].includes(f.sev) ? f.sev : 'low') as Sev);
                      const overdue = /overdue/.test(f.sla || '');
                      const pending = f.taskStatus === 'running' && f.taskApprovalId;
                      const iAmApprover = pending && currentUserId != null && Number(f.taskApproverId) === currentUserId;
                      return (
                        <div key={f.id} className="flex items-center gap-3 rounded-lg border border-transparent p-2 transition hover:border-slate-200 hover:bg-slate-50">
                          <Link href={`/vulnerabilities/${f.id}`} title={f.title} className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-bold tabular-nums text-slate-500">{f.rank}</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12.5px] font-medium text-slate-900">{f.title}</p>
                              <p className="mt-px truncate text-[11px] text-slate-400">
                                {f.meta} · breaks {f.breaks}
                                {f.kev && <span className="ml-1.5 rounded bg-rose-50 px-1 py-0 font-semibold text-rose-700" title="On CISA KEV — actively exploited in the wild. This is why it ranks above vulnerabilities that break the same number of paths.">actively exploited</span>}
                                {!f.kev && f.epss != null && f.epss >= 0.1 && <span className="ml-1.5 text-amber-700" title="EPSS — probability of exploitation in the next 30 days. Higher EPSS breaks ties above lower.">EPSS {Math.round(f.epss * 100)}%</span>}
                                {f.owner && <span className="ml-1.5">· {f.owner}</span>}
                                {pending && <span className="ml-1.5 font-semibold text-amber-700">waiting approval</span>}
                                {f.taskStatus === 'completed' && <span className="ml-1.5 font-semibold text-emerald-700">assigned</span>}
                              </p>
                            </div>
                          </Link>
                          <span className={`shrink-0 text-[10.5px] font-medium ${overdue ? 'text-rose-600' : 'text-slate-500'}`}>{f.sla ?? 'no SLA'}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sv.className}`}>{sv.label}</span>
                          {iAmApprover && f.taskApprovalId && (
                            <span className="flex shrink-0 gap-1">
                              <button type="button" disabled={decideMutation.isPending}
                                onClick={() => decideMutation.mutate({ scopeId: s.id, approvalId: f.taskApprovalId!, decision: 'approve' })}
                                className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Approve</button>
                              <button type="button" disabled={decideMutation.isPending}
                                onClick={() => decideMutation.mutate({ scopeId: s.id, approvalId: f.taskApprovalId!, decision: 'reject' })}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Reject</button>
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {s.dangerous > s.top.length && (
                      <Link href="/vulnerabilities/choke-points" className="block px-2 pt-1 text-[11px] font-medium text-primary-700 hover:underline">
                        Showing top {s.top.length} of {s.dangerous} dangerous — see the full ranked list →
                      </Link>
                    )}
                  </div>
                </Card>

                {activeStage === 3 && (
                <Card className="flex flex-col p-4">
                  <SectionTitle icon={<Coins className="h-[15px] w-[15px] text-emerald-600" />} className="mb-3">Financial exposure</SectionTitle>
                  {s.ale == null ? (
                    <div className="flex flex-1 flex-col gap-3">
                      <div className="rounded-xl bg-amber-50 p-3">
                        <p className="text-[13px] font-semibold text-slate-800">Not quantified yet — no invented number</p>
                        <p className="mt-1 text-[11.5px] leading-snug text-slate-600">
                          A dollar figure needs a real risk, tied to this scope&apos;s machines, with loss estimates and a FAIR run.
                          {quantify?.demo_only && ' The only risks on file are [DEMO] samples, which are excluded.'}
                        </p>
                      </div>
                      {/* live checklist — ticks come from real state */}
                      <div>
                        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">To quantify this scope</p>
                        <ol className="mt-1.5 space-y-1 text-[11.5px] text-slate-600">
                          <li className="flex items-start gap-1.5"><span className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${(s.fair?.risks_linked ?? 0) > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />1. Create a real risk in the register and link it to {s.machines[0]?.name ?? 'a machine in this scope'} <span className="text-slate-400">({s.fair?.risks_linked ?? 0} linked)</span></li>
                          <li className="flex items-start gap-1.5"><span className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${(s.fair?.risks_quantified ?? 0) > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />2. Give it loss estimates and run its FAIR simulation <span className="text-slate-400">({s.fair?.risks_quantified ?? 0} run)</span></li>
                          <li className="flex items-start gap-1.5"><span className="mt-[3px] h-2 w-2 shrink-0 rounded-full bg-slate-300" />3. The annualised loss appears here, summed across linked risks</li>
                        </ol>
                      </div>
                    </div>
                  ) : (<>
                  <p className="text-[32px] font-bold leading-none tabular-nums text-slate-900">{money(s.ale)}</p>
                  <p className="mt-1.5 text-[11.5px] text-slate-500">annualised loss (ALE)</p>
                  <div className="mt-4">
                    <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-200 via-amber-200 to-rose-200">
                      <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${alePos}%`, backgroundColor: '#0f172a' }} title="Most likely annual loss on the range from best to worst case." />
                    </div>
                    <div className="mt-1.5 flex justify-between">
                      <span className="text-[10.5px] text-slate-500">min {money(s.aleMin)}</span>
                      <span className="text-[10.5px] font-medium text-rose-700">P95 {money(s.p95)}</span>
                    </div>
                  </div>
                  </>)}
                  <div className="mt-auto border-t border-slate-100 pt-3.5">
                    {s.aleAfter != null && <p className="text-[11px] text-slate-500">If the {s.dangerous} dangerous findings are fixed, modelled loss drops to <b className="text-emerald-700">{money(s.aleAfter)}</b>.</p>}
                    <Link href={s.ale == null ? '/erm/risks/list' : '/erm/risks'} className="mt-2 inline-block text-[12px] font-medium text-primary-700 hover:underline">{s.ale == null ? 'Open the risk register →' : 'Open the risk dashboard →'}</Link>
                  </div>
                </Card>
                )}
              </div>
              )}

              {/* STAGE 1 SCOPE · STAGE 4 VALIDATE · STAGE 5 MOBILISE — each card gated to its stage */}
              <div className="space-y-3.5">
                {/* VALIDATE — three honest states for the cycle:
                    ① not run: a BLANK stage with one button (nothing pre-filled);
                    ② running: a LIVE progress bar fed by the backend run row — the
                       run is a server thread, so leaving this page changes nothing;
                    ③ done (stamped server-side when the run finishes): the results
                       below unlock, and so does Mobilise. */}
                {activeStage === 4 && gated && !g.validate && (
                  <Card className="p-4">
                    {mappingRunning || mapControls.isPending ? (
                      (() => {
                        // the honest funnel: in-scope → already answered (skipped) → analysing
                        const inScope = aiRun?.findings_in_scope ?? aiRun?.findings_total ?? 0;
                        const skipped = aiRun?.findings_skipped_existing ?? 0;
                        const total = aiRun?.findings_total ?? 0;          // to analyse THIS run
                        const done = Math.min(total, (aiRun?.findings_sent ?? 0) + (aiRun?.findings_reused ?? 0));
                        const pct = total > 0 ? Math.max(4, Math.round((done / total) * 100)) : 8;
                        const live = (aiRunData as any)?.last_run_counts ?? {};   // THIS run only, not history
                        return (
                          <div className="py-6">
                            <p className="text-[13px] font-semibold text-slate-900">
                              <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin text-violet-600" />
                              AI validation is running…
                            </p>
                            <p className="mt-1 text-[12px] text-slate-500">
                              Runs on the server — leave this page and come back; nothing is lost.
                            </p>
                            {/* the live pipeline — what is happening to each finding, step by step */}
                            <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
                              {[
                                { t: '1 · Read the vulnerability', d: 'CVE, weakness, scanner text' },
                                { t: '2 · Scan library', d: 'all 2,332 controls, full text' },
                                { t: '3 · Judge matches', d: 'context, not keywords' },
                                { t: '4 · Write answer', d: 'link · review · nothing-to-fix' },
                              ].map((st, i) => (
                                <Fragment key={st.t}>
                                  {i > 0 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-violet-300" />}
                                  <span className="animate-pulse rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5" style={{ animationDelay: `${i * 250}ms` }}>
                                    <b className="block text-violet-800">{st.t}</b>
                                    <span className="text-violet-500">{st.d}</span>
                                  </span>
                                </Fragment>
                              ))}
                            </div>
                            {/* the funnel itself — why the bar's total is what it is */}
                            <p className="mt-3 text-[11px] tabular-nums text-slate-600">
                              <b>{inScope}</b> scanner results in scope
                              {skipped > 0 && <> → <b className="text-sky-700">{skipped}</b> already answered in earlier runs (skipped, free)</>}
                              {' '}→ <b className="text-violet-700">{total}</b> to analyse this run
                            </p>
                            <div className="mt-2 max-w-xl">
                              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-700 transition-all duration-700" style={{ width: `${pct}%` }} />
                              </div>
                              <p className="mt-1.5 text-[11px] tabular-nums text-slate-600">
                                {total > 0 ? <><b>{done}</b> of <b>{total}</b> analysed</> : 'starting — loading your control library…'}
                              </p>
                              {/* live outcome tally — every finding lands in exactly one of these */}
                              <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] tabular-nums">
                                <span className="text-emerald-700">✓ {live.accepted ?? 0} linked to controls</span>
                                <span className="text-amber-700">⏳ {live.proposed ?? 0} waiting for your review</span>
                                <span className="text-slate-500">○ {live.no_control ?? 0} nothing to fix (info / patch-only)</span>
                                {aiRun?.findings_reused ? <span className="text-sky-700">↩ {aiRun.findings_reused} settled by your earlier decisions</span> : null}
                                {aiRun?.model_errors ? <span className="text-rose-700">⚠ {aiRun.model_errors} error(s)</span> : null}
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="py-8 text-center">
                        <p className="text-[13px] font-semibold text-slate-900">Validation hasn&apos;t been run for this cycle yet.</p>
                        <p className="mx-auto mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-500">
                          The AI reads each vulnerability (CVE, CWE, description, asset context) against every control in your
                          locked Unified Control Library. A group pick links every framework&apos;s original control in one
                          shot; sure picks link automatically (reversible), weak ones wait for your review, and informational notes
                          with nothing to fix get an honest &ldquo;patch-only / informational&rdquo; answer. Vulnerabilities already
                          answered in earlier cycles are skipped — re-runs only pay for what&apos;s new.
                        </p>
                        {canEdit && (
                          <button onClick={() => mapControls.mutate()} disabled={mapControls.isPending}
                            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                            <ShieldCheck className="h-4 w-4" /> Run AI validation
                          </button>
                        )}
                        <p className="mt-2 text-[11px] text-slate-400">Mobilise stays locked until this completes.</p>
                      </div>
                    )}
                  </Card>
                )}
                {activeStage === 4 && (!gated || g.validate) && canEdit && (
                  <Card className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-slate-900">✓ Validation complete — {s.controls} control{s.controls === 1 ? '' : 's'} linked to this scope&apos;s findings</p>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">The AI mapped them; coverage and the per-control breakdown are below, and Mobilise is unlocked. Re-run only if the findings changed — already-answered findings are skipped.</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button onClick={() => mapControls.mutate()} disabled={mapControls.isPending || mappingRunning}
                          title="Re-run AI mapping (only new vulnerabilities are analysed)"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                          {(mapControls.isPending || mappingRunning) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                          {(mapControls.isPending || mappingRunning) ? 'Mapping…' : 'Re-run mapping'}
                        </button>
                        {gated && (sp?.dispatch ? (
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3.5 py-2 text-[12.5px] font-semibold text-emerald-700">
                            <Send className="h-3.5 w-3.5" /> Dispatched to Mobilise ✓
                          </span>
                        ) : (
                          <button onClick={() => completeStage.mutate({ scopeId: s.id, stage: 'dispatch' })}
                            disabled={completeStage.isPending}
                            title="Hand the linked vulnerabilities to Mobilise — it stays locked until you do this"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                            {completeStage.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            Dispatch to Mobilise →
                          </button>
                        ))}
                      </div>
                    </div>
                  </Card>
                )}

                {/* cycle history — one frozen record per closed cycle */}
                {activeStage === 5 && (
                <Card className="p-4">
                  <SectionTitle icon={<BarChart3 className="h-[15px] w-[15px] text-primary-700" />} className="mb-3">Cycle history</SectionTitle>
                  {(s.cycleHistory ?? []).length === 0 ? (
                    <p className="rounded-lg bg-slate-50 p-3 text-[11.5px] text-slate-500">
                      No closed cycles yet. When you <b>Close &amp; save</b> the open cycle, its numbers freeze into a hash-verified record here — one row per cycle, so you can prove progress quarter over quarter.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-100">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                            <th className="px-3 py-2 text-left font-semibold">Cycle</th>
                            <th className="px-3 py-2 text-left font-semibold">Opened</th>
                            <th className="px-3 py-2 text-left font-semibold">Closed</th>
                            <th className="px-3 py-2 text-left font-semibold">Closed by</th>
                            <th className="px-3 py-2 text-right font-semibold">Findings</th>
                            <th className="px-3 py-2 text-right font-semibold">Dangerous</th>
                            <th className="px-3 py-2 text-right font-semibold">Mobilised</th>
                            <th className="px-3 py-2 text-left font-semibold">Membership hash</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(s.cycleHistory ?? []).map((h) => (
                            <tr key={h.no} className="border-t border-slate-100">
                              <td className="px-3 py-2 font-semibold text-slate-700">#{h.no}</td>
                              <td className="px-3 py-2 text-slate-500">{h.opened ?? '—'}</td>
                              <td className="px-3 py-2 text-slate-500">{h.closed ?? '—'}</td>
                              <td className="px-3 py-2 text-slate-600">{h.closedBy}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-900">{h.findings ?? '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-rose-700">{h.dangerous ?? '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{h.mobilised ?? '—'}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-slate-400" title="SHA-256 of the sorted member-asset ids — proves the exact machines this cycle covered">{h.hash || '—'}…</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
                )}

                {/* cycle progress + trend — MOBILISE / end-of-round review */}
                {activeStage === 5 && (
                <Card className="p-4">
                  <SectionTitle icon={<BarChart3 className="h-[15px] w-[15px] text-primary-700" />} className="mb-3">Trend across cycles</SectionTitle>
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Findings over cycles</p>
                    <svg viewBox="0 0 240 56" preserveAspectRatio="none" className="h-11 w-full">
                      {pair.aArea && <path d={pair.aArea} fill="rgba(30,212,176,0.12)" />}
                      {pair.aLine && <polyline points={pair.aLine} fill="none" stroke="#1ed4b0" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
                      {pair.aDot && <circle cx={pair.aDot.cx} cy={pair.aDot.cy} r={3} fill="#1ed4b0" />}
                      {pair.bLine && <polyline points={pair.bLine} fill="none" stroke="#e11d48" strokeWidth={2} strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" />}
                      {pair.bDot && <circle cx={pair.bDot.cx} cy={pair.bDot.cy} r={3} fill="#e11d48" />}
                    </svg>
                    <div className="mt-1.5 flex gap-3.5">
                      <LineKey color="#1ed4b0" label="findings" />
                      <LineKey color="#e11d48" label="dangerous" />
                    </div>
                  </div>
                  <div className="mt-3.5 border-t border-slate-100 pt-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">vs. last cycle</p>
                    <div className="flex gap-2">
                      <DeltaCell text={dF.text} color={dF.color} label="findings" />
                      <DeltaCell text={dD.text} color={dD.color} label="dangerous" />
                      <DeltaCell text={dM.text} color={dM.color} label="mobilised" />
                    </div>
                  </div>
                </Card>
                )}

                {/* machines — SCOPE */}
                {activeStage === 1 && (
                <Card className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionTitle icon={<Server className="h-[15px] w-[15px] text-primary-700" />}>Machines in scope</SectionTitle>
                    <span className="text-[11px] tabular-nums text-slate-400">{s.machines.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {s.machines.map((m) => (
                      <Link key={m.id} href={`/assets/${m.id}`} className="flex items-center gap-2.5 rounded-lg border border-transparent p-2 transition hover:border-slate-200 hover:bg-slate-50">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: riskColor(m.risk) }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium text-slate-900" title={m.name}>{m.name}</p>
                          <p className="mt-px text-[10.5px] text-slate-400">{m.type}</p>
                        </div>
                        <span className="shrink-0 text-right">
                          <span className="block text-[13px] font-bold leading-none tabular-nums text-slate-900">{m.findings}</span>
                          <span className="text-[9.5px] text-slate-400">findings</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                  <Link href="/assets" className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-primary-700 hover:underline">
                    Asset inventory <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Card>
                )}
              </div>

              {/* Result vs Decisions — a toggle, not a stack (owner: keep the page clean) */}
              {activeStage === 4 && (!gated || g.validate) && (
                <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-0.5 text-[12px] font-medium w-fit">
                  <button type="button" onClick={() => setValView('result')}
                    className={`rounded-full px-3.5 py-1 ${valView === 'result' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    The result
                  </button>
                  <button type="button" onClick={() => setValView('decisions')}
                    className={`rounded-full px-3.5 py-1 ${valView === 'decisions' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    Your decisions
                  </button>
                </div>
              )}
              {activeStage === 4 && (!gated || g.validate) && valView === 'result' && (
              <Card className="p-4">
                {/* the coverage story — no repeated numbers, vulnerabilities called
                    vulnerabilities, and the PRIORITY line the owner asked for */}
                {s.pipeline && (s.pipeline.analysed + s.pipeline.informational) > 0 && (() => {
                  const p = s.pipeline!;
                  const scanned = p.analysed + p.informational + (p.unmapped ?? 0);
                  const allCovered = p.linked >= p.analysed && p.patch_only + p.no_specific + p.low_awaiting_review === 0 && (p.unmapped ?? 0) === 0;
                  return (
                  <div className="mb-3 space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px]">
                    <p className="text-slate-600">
                      <b className="tabular-nums text-slate-800">{scanned}</b> scanner findings →{' '}
                      <b className="tabular-nums">{p.informational}</b> informational (nothing to fix) ·{' '}
                      <b className="tabular-nums text-slate-800">{p.analysed}</b> real vulnerabilities
                    </p>
                    <p>
                      {allCovered ? (
                        <span className="font-medium text-emerald-700">✓ Every one of the {p.analysed} vulnerabilities is covered by a control.</span>
                      ) : (
                        <>
                          <span className="text-emerald-700"><b className="tabular-nums">{p.linked}</b> covered by a control</span>
                          {p.patch_only > 0 && <span className="text-slate-600"> · <b className="tabular-nums">{p.patch_only}</b> patch-only</span>}
                          {p.no_specific > 0 && <span className="text-slate-600"> · <b className="tabular-nums">{p.no_specific}</b> no specific control</span>}
                          {p.low_awaiting_review > 0 && <span className="text-amber-700"> · <b className="tabular-nums">{p.low_awaiting_review}</b> awaiting your review</span>}
                          {(p.unmapped ?? 0) > 0 && <span className="text-slate-400"> · <b className="tabular-nums">{p.unmapped}</b> not yet mapped</span>}
                        </>
                      )}
                    </p>
                    {p.priority && p.priority.total > 0 && (
                      <p className="border-t border-slate-200/70 pt-1.5 text-rose-700">
                        <b className="tabular-nums">{p.priority.total}</b> prioritised vulnerabilities:{' '}
                        {p.priority.linked === p.priority.total
                          ? <b>all {p.priority.total} covered ✓</b>
                          : <>
                              <b className="tabular-nums">{p.priority.linked}</b> covered
                              {p.priority.patch_only > 0 && <> · <b className="tabular-nums">{p.priority.patch_only}</b> patch-only</>}
                              {p.priority.awaiting > 0 && <> · <b className="tabular-nums">{p.priority.awaiting}</b> awaiting review</>}
                              {p.priority.unanswered > 0 && <> · <b className="tabular-nums">{p.priority.unanswered}</b> UNANSWERED</>}
                            </>}
                        <span className="text-slate-400"> — controls that close them are listed first below</span>
                      </p>
                    )}
                  </div>
                  );
                })()}
                {(() => {
                  // ONE row per control — the framework originals fold into their
                  // group lead as tags (kills the "same control x 5 frameworks" rows)
                  const children = new Map<number, ControlItem[]>();
                  s.cw.forEach((c) => {
                    if (c.kind === 'parsed_framework_control' && c.family_of) {
                      children.set(c.family_of, [...(children.get(c.family_of) ?? []), c]);
                    }
                  });
                  const rows = s.cw.filter((c) => !(c.kind === 'parsed_framework_control' && c.family_of));
                  const anyTested = rows.some((c) => c.tier !== 'claimed');
                  const shown = showAllCw ? rows : rows.slice(0, 8);
                  const findingById = new Map((scopeFindings ?? []).map((v: any) => [v.id, v]));
                  return (<>
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="px-3 py-2 text-left font-semibold">Control</th>
                        <th className="px-3 py-2 text-left font-semibold">Satisfies these standards</th>
                        <th className="px-3 py-2 text-right font-semibold">Vulnerabilities closed</th>
                        <th className="px-3 py-2 text-left font-semibold">Why linked</th>
                        {anyTested && <th className="px-3 py-2 text-left font-semibold">Assurance</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((c) => {
                        const ts = tierStyle(c.tier);
                        const kids = c.kind === 'normalized_control' && c.control_id ? (children.get(c.control_id) ?? []) : [];
                        const href = c.kind === 'parsed_framework_control' && c.control_id ? `/erm/framework-controls/${c.control_id}`
                          : c.kind === 'normalized_control' ? '/control-library' : null;
                        const rowKey = `${c.kind}-${c.control_id ?? c.code}`;
                        const covered = Array.isArray(c.covered_ids) ? c.covered_ids : [];
                        const isOpen = expandedCw === rowKey;
                        return (
                          <Fragment key={rowKey}>
                          <tr className="border-t border-slate-100 align-top hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-700">
                              {href ? <Link href={href} className="font-mono font-medium text-primary-700 hover:underline">{c.code}</Link>
                                    : <span className="font-mono font-medium text-slate-900">{c.code}</span>}
                              &nbsp;&nbsp;{c.title}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {/* the ACTUAL standards this control consolidates — never our
                                    internal library name in their place */}
                                {(c.standards ?? []).length > 0 ? (
                                  (c.standards ?? []).map((t) => (
                                    <span key={t} title="This control is the SAME rule as written in this framework"
                                      className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">{t}</span>
                                  ))
                                ) : (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{c.fw}</span>
                                )}
                                {(c.standards ?? []).length > 0 && c.kind === 'normalized_control' && (
                                  <span className="rounded-full px-1.5 py-0.5 text-[9.5px] text-slate-400" title="Consolidated in your Unified Control Library">via Unified Library</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button type="button" onClick={() => setExpandedCw(isOpen ? null : rowKey)}
                                title="Show the vulnerabilities this control closes" disabled={covered.length === 0}
                                className={`inline-flex items-center gap-1 font-semibold tabular-nums ${covered.length ? 'text-primary-700 hover:underline' : 'text-slate-900 cursor-default'}`}>
                                {c.findings}{covered.length > 0 && <span className={`text-[9px] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>}
                              </button>
                              {(c.priority_covered ?? 0) > 0 && (
                                <p className="mt-0.5 whitespace-nowrap text-[9.5px] font-semibold text-rose-600" title="Of the SAME fixed set of prioritised vulnerabilities — one vulnerability is often closed by several controls, so these red counts overlap across rows and must never be added up.">{c.priority_covered} of the {s.pipeline?.priority?.total ?? 0} prioritised</p>
                              )}
                            </td>
                            <td className="px-3 py-2" title={c.reason || undefined}>
                              <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                c.basis === 'ai' || c.basis === 'ai_auto' || c.basis === 'ai_family' ? 'bg-violet-50 text-violet-700'
                                : c.basis === 'reused' ? 'bg-sky-50 text-sky-700'
                                : c.basis === 'manual' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                {c.basis === 'ai' ? 'AI · accepted' : c.basis === 'ai_auto' ? 'AI · auto-linked' : c.basis === 'ai_family' ? 'AI · via group' : c.basis === 'reused' ? 'reused decision' : c.basis === 'manual' ? 'manual' : 'crosswalk rule'}
                              </span>
                            </td>
                            {anyTested && <td className="px-3 py-2"><span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ${ts.className}`}>{ts.label}</span></td>}
                          </tr>
                          {isOpen && (
                            <tr className="border-t border-slate-100 bg-slate-50/60">
                              <td colSpan={anyTested ? 5 : 4} className="px-3 py-2">
                                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Vulnerabilities this control closes ({covered.length})</p>
                                <div className="flex flex-col gap-1">
                                  {covered.map((vid) => { const v: any = findingById.get(vid); return (
                                    <Link key={vid} href={`/vulnerabilities/${vid}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-white">
                                      {v ? <>
                                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${sevStyle((['critical','high','medium','low'].includes(v.severity) ? v.severity : 'low') as Sev).className}`}>{v.severity === 'info' ? 'Info' : sevStyle(v.severity as Sev).label}</span>
                                        <span className="truncate text-slate-700">{v.title}</span>
                                      </> : <span className="text-slate-400">Finding #{vid}</span>}
                                    </Link>
                                  ); })}
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[10.5px] text-slate-400">
                  <b className="text-slate-600">{rows.length}</b> controls close the <b className="text-emerald-700">{s.pipeline?.linked ?? 0} covered vulnerabilities</b> — different units, so the numbers differ by design. <b className="text-rose-600">Red counts overlap</b> (one vulnerability, several controls) — never add them. None test-verified yet — a control turns effective when a re-scan proves it.
                </p>

                {rows.length > 8 && (
                  <button onClick={() => setShowAllCw((v) => !v)} className="mt-1 text-[12px] font-medium text-primary-700 hover:underline">
                    {showAllCw ? 'Show fewer' : `Show all ${rows.length} controls`}
                  </button>
                )}
                  </>);
                })()}
              </Card>
              )}

              {/* AI-suggested SPECIFIC controls — VALIDATE action (Run/Re-run AI mapping lives inside) */}
              {activeStage === 4 && (!gated || g.validate) && valView === 'decisions' && <AiControlProposalsPanel scopeId={s.id} />}

              {/* Per-stage guidance + advance */}
              <StageFooter
                stage={activeStage}
                done={stageDone[activeStage]}
                reachable={stageReachable(activeStage)}
                onNext={() => {
                  const nx = Math.min(5, activeStage + 1);
                  // gated loop: Next never jumps into a locked stage; Mobilise
                  // additionally requires the explicit dispatch stamp
                  if (gated && nx === 5 && !sp?.dispatch) return;
                  if (!gated || stageDone[nx] || stageReachable(nx)) setActiveStage(nx);
                }}
                findingsHref={findingsHref}
              />
          </div>
        </div>
      ) : (
        <EmptyState onCreate={() => setShowCreate(true)} onTemplate={(preset) => { setForm((prev) => ({ ...prev, ...preset })); setShowCreate(true); }} canEdit={canEdit} />
      )}
    </div>
  );
}

/* ─────────────────────── sub-components ─────────────────────── */

/** Minimal modal: backdrop click / Esc closes. Fixed overlay, no portal needed. */
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="fixed inset-0" style={{ background: 'rgba(15,23,42,0.45)' }} onClick={onClose} />
      <div className="relative w-full max-w-2xl">{children}</div>
    </div>
  );
}

function KpiCell({ label, value, sub, valueClass = 'text-slate-900', title }: { label: string; value: React.ReactNode; sub: string; valueClass?: string; title?: string }) {
  return (
    <div className="flex-1 p-[14px_18px]" title={title}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-[26px] font-bold leading-none tabular-nums ${valueClass}`}>{value}</p>
      <p className="mt-1.5 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

const Legend = ({ color, value, label }: { color: string; value: number; label: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
    <b className="tabular-nums text-slate-900">{value}</b> {label}
  </span>
);

const LineKey = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5 text-[10.5px] text-slate-500">
    <span className="h-0.5 w-3" style={{ background: color }} /> {label}
  </span>
);

const DeltaCell = ({ text, color, label }: { text: string; color: string; label: string }) => (
  <div className="flex-1 rounded-lg border border-slate-100 bg-slate-50 py-1.5 text-center">
    <p className={`text-[14px] font-bold tabular-nums ${color}`}>{text}</p>
    <p className="mt-0.5 text-[9.5px] text-slate-400">{label}</p>
  </div>
);

type ScopeAsset = { id: number; name: string; host_name?: string | null; internet_facing?: boolean | null; department?: string | null };

function CreateScopeForm({ form, setForm, assets, onSubmit, onCancel, pending }: {
  form: { name: string; cadence: string; asset_ids: number[] };
  assets: ScopeAsset[];
  setForm: (f: any) => void; onSubmit: () => void; onCancel: () => void; pending: boolean;
}) {
  const [assetQuery, setAssetQuery] = useState('');
  const picked = new Set(form.asset_ids || []);
  const toggle = (id: number) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setForm({ ...form, asset_ids: [...next] });
  };
  const q = assetQuery.trim().toLowerCase();
  const hits = q
    ? assets.filter((a) => `${a.name} ${a.host_name ?? ''}`.toLowerCase().includes(q)).slice(0, 10)
    : assets.slice(0, 10);  // empty search shows the first assets so the list isn't blank

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <p className="text-[13px] font-semibold text-slate-900">New scope</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Name <span className="font-normal text-slate-400">— optional, auto-named from your picks if blank</span></label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Auto: named after the assets you select" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Cadence — deadline for each cycle</label>
          <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
            <option value="weekly">Weekly — cycle must close in 7 days</option>
            <option value="monthly">Monthly — cycle must close in 30 days</option>
            <option value="quarterly">Quarterly — cycle must close in 91 days</option>
            <option value="">No cadence (run ad hoc)</option>
          </select>
        </div>
      </div>

      {/* Membership — pick the assets. Multi-select; each stays as a chip. */}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Assets in this scope <span className="font-normal text-slate-400">— search and select as many as you want</span></label>
        <input value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} placeholder="Type to search, e.g. desktop, liztek…" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        <div className="mt-1 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white">
          {hits.length === 0 && <div className="px-3 py-3 text-center text-[12px] text-slate-400">No asset matches “{assetQuery}”.</div>}
          {hits.map((a) => (
            <button type="button" key={a.id} onClick={() => toggle(a.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-slate-50">
              <input type="checkbox" readOnly checked={picked.has(a.id)} className="h-3.5 w-3.5 rounded border-slate-300" />
              <span className="font-medium text-slate-800">{a.name}</span>
              {a.internet_facing && <span className="rounded bg-rose-50 px-1 text-[10px] font-semibold text-rose-600">internet-facing</span>}
              {a.host_name && a.host_name !== a.name && <span className="text-[11px] text-slate-400">{a.host_name}</span>}
            </button>
          ))}
        </div>
        {picked.size > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600">{picked.size} selected:</span>
            {[...picked].map((id) => { const a = assets.find((x) => x.id === id); return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                {a?.name ?? `#${id}`}
                <button type="button" onClick={() => toggle(id)} className="text-primary-400 hover:text-primary-700">×</button>
              </span>
            ); })}
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] text-slate-400">Nothing selected yet — a scope needs at least one asset to work on.</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={onSubmit} disabled={pending || picked.size === 0} title={picked.size === 0 ? 'Select at least one asset first' : ''} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {pending ? 'Creating…' : 'Create scope'}
        </button>
        <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
      </div>
    </div>
  );
}

// Per-stage footer: what to do here + the arrow that advances to the next
// stage. The action for each stage lives on its own screen above; this just
// narrates and moves you along, so the loop reads as a sequence.
function StageFooter({ stage, done, reachable, onNext, findingsHref }: {
  stage: number; done: boolean; reachable: boolean; onNext: () => void; findingsHref: string;
}) {
  const NEXT = ['Discover', 'Prioritise', 'Validate', 'Mobilise'];
  const guide: Record<number, string> = {
    1: 'These are the machines this scope owns. When it looks right, move on to Discover.',
    2: 'Findings come from your scanner sync — nothing to run here. Move on to Prioritise to rank the dangerous ones.',
    3: done ? 'Attack paths are computed. Move on to Validate.' : 'Click “Recalculate attack paths” above to rank which findings are actually reachable.',
    4: done ? 'Controls are mapped — each Mobilise assignment now carries its fix. Validation itself is the evidence ladder above: a control is only proven when a re-scan or retest lands.' : 'Click “Map controls now” above — it attaches the fixing control to each finding, so Mobilise can hand a person the finding AND its fix (runs now, ~1–2 min).',
    5: done ? 'Fixes are assigned. When a Nessus re-scan confirms them gone, close the cycle to save the record.' : 'Assign each dangerous finding to one owner. A Nessus re-scan is what finally verifies the fix.',
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="min-w-0 flex-1 text-[12px] text-slate-600">
        <span className={`mr-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${done ? 'bg-emerald-100 text-emerald-700' : reachable ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-500'}`}>
          {done ? 'stage done' : reachable ? 'do this now' : 'view only'}
        </span>
        {guide[stage]}
      </p>
      {stage < 5 && (
        <button type="button" onClick={onNext}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-primary-700">
          Next: {NEXT[stage - 1]} <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
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
  // Each template prefills the create form. Only the internet-facing rule is an
  // automatic membership rule today; the other two prefill a name and leave the
  // operator to set membership (name_contains / departments) by hand.
  const templates = [
    { icon: <CreditCard className="h-4 w-4 text-primary-700" />, title: 'Internet-facing tier', sub: 'Public web, edge and WAF assets', preset: { name: 'Internet-facing tier', internet_facing: true } },
    { icon: <Lock className="h-4 w-4 text-primary-700" />, title: 'Payment platform', sub: 'PCI-scoped assets and services', preset: { name: 'Payment platform' } },
    { icon: <Users className="h-4 w-4 text-primary-700" />, title: 'Identity plane', sub: 'IdP, MFA and directory sync', preset: { name: 'Identity plane' } },
  ];
  return (
    <div className="mx-auto w-full max-w-[1520px] space-y-4">
      <Card className="relative overflow-hidden p-10 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_0%,rgba(30,212,176,0.07),transparent_60%)]" />
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
