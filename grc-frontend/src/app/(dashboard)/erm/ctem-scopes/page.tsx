'use client';

/**
 * CTEM Phase 3 — Scopes & cycles.
 *
 * A scope is a named, business-owned slice of the attack surface; a cycle is
 * one human-driven run of the loop over it. Semantics on the surface:
 *  - cadence is advisory only (the UI never implies a cycle self-opens);
 *  - the loop shown left-to-right as five stages (scope → discover →
 *    prioritise → validate → mobilise); `prioritised` shows "—" when the
 *    scope has no choke-point history yet (an honest seam, not a fake 0);
 *  - closing freezes counts + rule + membership hash, and a closed cycle
 *    shows those frozen numbers, not a re-explorable drill-down.
 */

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ctemScopesApi, vulnManagementApi } from '@/lib/api';
import { AiControlProposalsPanel } from './_components/AiControlProposalsPanel';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Crosshair, Plus, Play, Square, Loader2, AlertTriangle, Lock, ExternalLink,
  Coins,
} from 'lucide-react';

interface Cycle {
  id: number;
  status: 'open' | 'closed' | string;
  opened_at?: string | null;
  closed_at?: string | null;
  counts?: { member_assets: number; discovered: number; prioritized?: number; validated: number; mobilized: number } | null;
  membership_hash?: string | null;
  hash_algorithm?: string | null;
  drilldown_available?: boolean;
}
interface Scope {
  id: number;
  name: string;
  description?: string | null;
  cadence?: string | null;
  membership_rule: Record<string, unknown>;
  open_cycle_id?: number | null;
  cycle_count: number;
  member_assets?: number;
  live_counts?: { member_assets: number; discovered: number; prioritized?: number; validated: number; mobilized: number };
}

// The CTEM loop, left to right. Each box links to the page the number comes
// from, so a reviewer can see the source (and the sidebar "CTEM Scopes" tab
// brings them straight back). `src` names the destination on the box itself so
// "where does this come from?" is answered without clicking.
type Counts = { member_assets: number; discovered: number; prioritized?: number; validated: number; mobilized: number };
const LOOP_STAGES: Array<{ n: string; label: string; get: (c: Counts) => number | undefined; href: (id: number) => string; src: string }> = [
  { n: '1', label: 'Scope', get: (c) => c.member_assets, href: () => '/assets', src: 'Assets' },
  { n: '2', label: 'Discover', get: (c) => c.discovered, href: (id) => `/erm/risks/list?ctem_scope_id=${id}`, src: 'Findings' },
  { n: '3', label: 'Prioritise', get: (c) => c.prioritized, href: () => '/vulnerabilities/choke-points', src: 'Choke points' },
  { n: '4', label: 'Validate', get: (c) => c.validated, href: () => '/control-library/assurance', src: 'Assurance' },
  { n: '5', label: 'Mobilise', get: (c) => c.mobilized, href: () => '/vulnerabilities', src: 'Register' },
];

function Counters({ c, scopeId }: { c: Counts; scopeId: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {LOOP_STAGES.map((s) => {
        const v = s.get(c);
        return (
          <Link key={s.label} href={s.href(scopeId)}
            className="group rounded-lg border border-slate-200 bg-slate-50/60 p-2 text-center hover:border-primary-300 hover:bg-primary-50/50 transition-colors">
            <p className="text-[9px] font-medium text-slate-400 mb-0.5 uppercase tracking-wide group-hover:text-primary-600">{s.n} · {s.label}</p>
            <p className="text-base font-bold text-slate-900 tabular-nums">{v === undefined ? '—' : v}</p>
            <p className="text-[8px] text-slate-400 group-hover:text-primary-600">{s.src} →</p>
          </Link>
        );
      })}
    </div>
  );
}

export default function CtemScopesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('risks:risk_register:edit');
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', cadence: 'quarterly', name_contains: '', departments: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['ctem-scopes'],
    queryFn: async () => (await ctemScopesApi.list()).data,
  });
  const scopes: Scope[] = data?.scopes || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['ctem-scopes'] });

  const createMutation = useMutation({
    mutationFn: () => ctemScopesApi.create({
      name: form.name,
      description: form.description || null,
      cadence: form.cadence || null,
      membership_rule: {
        name_contains: form.name_contains || null,
        departments: form.departments ? form.departments.split(',').map((s) => s.trim()).filter(Boolean) : null,
      },
    }),
    onSuccess: () => { setShowCreate(false); setForm({ name: '', description: '', cadence: 'quarterly', name_contains: '', departments: '' }); setError(null); invalidate(); },
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
            CTEM Scopes &amp; Cycles
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl mt-0.5">
            A scope is a named, owned slice of the attack surface. Run the loop over it as
            explicit cycles — open and close by hand (cadence is a reminder, nothing opens
            itself). Closing freezes the counts with the membership rule and a hash.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" /> New scope
          </button>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {showCreate && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Customer payment platform"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cadence (advisory only)</label>
              <input value={form.cadence} onChange={(e) => setForm((f) => ({ ...f, cadence: e.target.value }))}
                placeholder="monthly / quarterly"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Membership: asset name contains</label>
              <input value={form.name_contains} onChange={(e) => setForm((f) => ({ ...f, name_contains: e.target.value }))}
                placeholder="e.g. payment, web01"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Membership: departments (comma-separated)</label>
              <input value={form.departments} onChange={(e) => setForm((f) => ({ ...f, departments: e.target.value }))}
                placeholder="e.g. Payments, Platform"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name}
              className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50">
              {createMutation.isPending ? 'Creating…' : 'Create scope'}
            </button>
            <button onClick={() => setShowCreate(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 justify-center text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading scopes…
        </div>
      ) : scopes.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-8 text-center text-sm text-slate-500">
          No scopes yet. Create one to run the CTEM loop over a bounded, owned slice.
        </div>
      ) : (
        <div className="space-y-3">
          {scopes.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900">{s.name}</h2>
                  <p className="text-xs text-slate-500">
                    {s.member_assets ?? 0} member asset(s)
                    {s.cadence && ` · cadence: ${s.cadence} (advisory)`}
                    {` · ${s.cycle_count} cycle(s)`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/erm/risks/list?ctem_scope_id=${s.id}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> View findings
                  </Link>
                  {canEdit && !s.open_cycle_id && (
                    <button onClick={() => openMutation.mutate(s.id)} disabled={openMutation.isPending}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      <Play className="h-3.5 w-3.5" /> Open cycle
                    </button>
                  )}
                  {canEdit && s.open_cycle_id && (
                    <button onClick={() => closeMutation.mutate(s.open_cycle_id!)} disabled={closeMutation.isPending}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      <Square className="h-3.5 w-3.5" /> Close cycle
                    </button>
                  )}
                </div>
              </div>

              {s.open_cycle_id && s.live_counts && (
                <CommandCenter scope={s} />
              )}
              {!s.open_cycle_id && s.cycle_count > 0 && (
                <ScopeCycleHistory scopeId={s.id} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeCycleHistory({ scopeId }: { scopeId: number }) {
  const { data } = useQuery({
    queryKey: ['ctem-scope-detail', scopeId],
    queryFn: async () => (await ctemScopesApi.get(scopeId)).data,
  });
  const cycles: Cycle[] = data?.scope?.cycles || [];
  const closed = cycles.filter((c) => c.status === 'closed');
  if (closed.length === 0) return null;
  const latest = closed[0];
  return (
    <div className="mt-3">
      <p className="text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1">
        <Lock className="h-3 w-3" /> Last closed cycle — frozen{latest.closed_at ? ` ${new Date(latest.closed_at).toLocaleDateString()}` : ''}
      </p>
      {latest.counts && <Counters c={latest.counts} scopeId={scopeId} />}
      <p className="mt-1 text-[10px] text-slate-400 font-mono break-all">
        membership {latest.hash_algorithm}: {latest.membership_hash?.slice(0, 16)}… — counts verifiable against this hash, not re-explorable.
      </p>
    </div>
  );
}

function money(v?: number | null, ccy?: string | null) {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: ccy || 'USD', notation: 'compact', maximumFractionDigits: 1,
  }).format(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// The command center — ONE self-explaining view of the CTEM loop for a scope.
//
// Reads live from /command-center. Design rules (from the review that rebuilt
// this): (1) ONE clock — the big numbers are the STATE NOW ("balance"); change
// since the cycle opened is a small "+N this cycle" tag, never a second row of
// zeros; (2) the machines are NAMED and clickable, never a faceless count;
// (3) the cycle's lifecycle is visible (what open/close mean); (4) every link
// lands on THIS scope's data, not a generic page; (5) "what to fix first" is
// explained (what each bucket means, and what unlocks it).
// ─────────────────────────────────────────────────────────────────────────────
type Machine = { id: number; name: string; host_name?: string | null; asset_type?: string | null };
type ControlItem = { id: number; kind: string; code: string; title: string; framework: string; tier: string; findings_covered: number };
const TIER_LABEL: Record<string, string> = {
  tested_effective: 'tested ✓', tested_failed: 'tested ✗', remediation_verified: 'fix verified',
  stale: 'stale test', attested_only: 'only claimed',
};

function Delta({ n }: { n?: number }) {
  // "+N this cycle" — the ACTIVITY tag. 0 renders quietly so it never reads
  // as a contradiction with a non-zero balance.
  const v = n ?? 0;
  return (
    <span className={`text-[10px] tabular-nums ${v > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
      {v > 0 ? `+${v}` : '0'} this cycle
    </span>
  );
}

function Stat({ label, value, sub, delta, href, hrefLabel }: {
  label: string; value: number | string; sub?: string; delta?: number; href: string; hrefLabel: string;
}) {
  return (
    <Link href={href} className="group rounded-lg border border-slate-200 bg-white p-3 hover:border-primary-300 hover:bg-primary-50/40 transition-colors block">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-bold text-slate-900 tabular-nums leading-none">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-500">{sub}</p>}
      <div className="mt-1.5 flex items-center justify-between">
        {delta !== undefined ? <Delta n={delta} /> : <span />}
        <span className="text-[10px] text-primary-600 group-hover:underline">{hrefLabel} →</span>
      </div>
    </Link>
  );
}

function CommandCenter({ scope }: { scope: Scope }) {
  const scopeId = scope.id;
  const live = scope.live_counts;
  const { data, isLoading } = useQuery({
    queryKey: ['ctem-command-center', scopeId],
    queryFn: async () => (await ctemScopesApi.commandCenter(scopeId)).data,
  });
  const { data: detail } = useQuery({
    queryKey: ['ctem-scope-detail', scopeId],
    queryFn: async () => (await ctemScopesApi.get(scopeId)).data,
  });
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCompute = hasPermission('vulnerabilities:vulnerability_register:edit');
  // Run the attack-path engine over this scope's (finding × machine) pairs —
  // the SAME engine as the Exploit Test tab, batched. Fills "not calculated yet".
  const computePaths = useMutation({
    mutationFn: async () => (await vulnManagementApi.vulnerabilities.computeAttackPaths(scopeId)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ctem-command-center', scopeId] });
      queryClient.invalidateQueries({ queryKey: ['ctem-scopes'] });
      queryClient.invalidateQueries({ queryKey: ['choke-points'] });
    },
  });
  if (isLoading) return <p className="mt-3 text-[11px] text-slate-400">Loading command center…</p>;
  if (!data) return null;

  const machines: Machine[] = data.machines || [];
  const p = data.prioritise?.coverage || {};
  const tiers = data.validate?.tiers || {};
  const m = data.mobilise || {};
  const q = data.quantify;
  const cycles: Cycle[] = detail?.scope?.cycles || [];
  const openCycle = cycles.find((c) => c.status === 'open');
  const cycleNo = cycles.length; // cycles are newest-first; the open one is #N
  const openedAt = openCycle?.opened_at ? new Date(openCycle.opened_at) : null;
  const days = openedAt ? Math.max(0, Math.floor((Date.now() - openedAt.getTime()) / 86400000)) : 0;
  const findingsHref = `/vulnerabilities?ctem_scope_id=${scopeId}&ctem_scope_name=${encodeURIComponent(scope.name)}`;
  const totalFindings = data.scope_findings ?? 0;
  const tested = (tiers.tested_effective ?? 0) + (tiers.tested_failed ?? 0);
  const chains = p.total_viable_chains ?? 0;
  const controlItems: ControlItem[] = data.validate?.items || [];
  const byFramework: Record<string, number> = data.validate?.by_framework || {};
  const analysable = data.prioritise?.analysable || { real_vulnerabilities: 0, informational: 0 };

  // The 5-stage loop with the CURRENT state of each stage — the flow the whole
  // program is built on. Restored after a redesign dropped it (visibility loss).
  const loop: Array<{ n: string; label: string; value: number; href: string }> = [
    { n: '1', label: 'Scope', value: machines.length, href: '/assets' },
    { n: '2', label: 'Discover', value: totalFindings, href: findingsHref },
    { n: '3', label: 'Prioritise', value: p.findings_ranked ?? 0, href: '/vulnerabilities/choke-points' },
    { n: '4', label: 'Validate', value: tested, href: '/control-library/assurance' },
    { n: '5', label: 'Mobilise', value: m.tickets ?? 0, href: findingsHref },
  ];

  return (
    <div className="mt-3 space-y-3">
      {/* ── the loop — the flow, with each stage's current state ───────────── */}
      <div className="flex items-stretch gap-1 overflow-x-auto">
        {loop.map((st, i) => (
          <Fragment key={st.label}>
            <Link href={st.href}
              className="group flex-1 min-w-[96px] rounded-lg border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-center hover:border-primary-300 hover:bg-primary-50/50 transition-colors">
              <p className="text-[9px] font-medium uppercase tracking-wide text-slate-400 group-hover:text-primary-600">{st.n} · {st.label}</p>
              <p className="text-base font-bold text-slate-900 tabular-nums leading-tight">{st.value}</p>
            </Link>
            {i < loop.length - 1 && <span className="self-center text-slate-300 text-sm">›</span>}
          </Fragment>
        ))}
      </div>

      {/* ── the machines — named, not counted ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-500">Watching {machines.length} machine{machines.length === 1 ? '' : 's'}:</span>
        {machines.map((a) => (
          <Link key={a.id} href={`/assets/${a.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700 hover:border-primary-300 hover:text-primary-700">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />{a.name}
          </Link>
        ))}
        {machines.length === 0 && <span className="text-slate-400">no machine matches this scope&apos;s rule yet</span>}
      </div>

      {/* ── the cycle strip — lifecycle made visible ───────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-semibold text-emerald-800">Cycle #{cycleNo || 1} · OPEN</span>
          {openedAt && <span className="text-emerald-700">· started {openedAt.toLocaleDateString()} · {days} day{days === 1 ? '' : 's'} running</span>}
        </div>
        <p className="text-[11px] text-emerald-800/80">
          A cycle is one round of the loop. <span className="font-medium">Close</span> freezes today&apos;s numbers as a permanent record, so the next round can be compared against it.
        </p>
      </div>

      {/* ── ONE clock: the state now, with "+N this cycle" tags ────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat label="Findings on these machines" value={totalFindings}
          sub="weaknesses the scanner found" delta={live?.discovered}
          href={findingsHref} hrefLabel="See these findings" />
        <Stat label="Dangerous right now" value={p.findings_ranked ?? 0}
          sub={`with a reachable attack path (${chains} chain${chains === 1 ? '' : 's'})`}
          delta={live?.prioritized}
          href="/vulnerabilities/choke-points" hrefLabel="Choke points" />
        <Stat label="Controls covering them" value={data.validate?.controls ?? 0}
          sub={`${tested} tested · ${tiers.attested_only ?? 0} only claimed`}
          delta={live?.validated}
          href="/control-library/assurance" hrefLabel="Assurance" />
        <Stat label="Fixes ticketed" value={m.tickets ?? 0}
          sub={m.tickets ? `${m.open ?? 0} open · ${m.resolved ?? 0} resolved` : 'none — connect ServiceNow to push'}
          delta={live?.mobilized}
          href={findingsHref} hrefLabel="Push from a finding" />
      </div>

      {/* ── what to fix first — explained, not just counted ────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-medium text-slate-700 flex items-center gap-1 mb-1"><Crosshair className="h-3.5 w-3.5 text-primary-600" /> What to fix first — where the {totalFindings} findings stand</p>
          {/* HONEST split: the engine can only reason about findings that carry a
              CVE / CWE / vector. Nessus "info" items (banners, detections) carry
              none — say so, instead of implying N analyses. */}
          <p className="mb-2 text-[10.5px] text-slate-500">
            <span className="font-medium text-slate-700">{analysable.real_vulnerabilities} real vulnerabilities</span> (have a CVE / weakness type the engine can reason about)
            {' · '}<span className="font-medium text-slate-700">{analysable.informational} informational</span> (scanner notes with no CVE — can only ever be &ldquo;can&apos;t tell&rdquo;).
          </p>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-start gap-2">
              <span className="w-10 shrink-0 text-right font-bold tabular-nums text-slate-900">{p.findings_chainless ?? 0}</span>
              <span className="text-slate-600 flex-1"><span className="font-medium text-slate-800">path not calculated yet</span> — the attack-path engine hasn&apos;t run on these.
                {canCompute && (p.findings_chainless ?? 0) > 0 && (
                  <button onClick={() => computePaths.mutate()} disabled={computePaths.isPending}
                    className="ml-2 inline-flex items-center gap-1 rounded-md bg-primary-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                    {computePaths.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {computePaths.isPending ? 'Calculating…' : 'Calculate attack paths now'}
                  </button>
                )}
                {computePaths.isSuccess && computePaths.data && (
                  <span className="ml-2 text-emerald-700">done — {computePaths.data.snapshots_written} path(s) computed.</span>
                )}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-10 shrink-0 text-right font-bold tabular-nums text-emerald-700">{p.findings_severed ?? 0}</span>
              <span className="text-slate-600"><span className="font-medium text-slate-800">checked — blocked</span>. Every way in is shut on this machine. Safe for now; not a priority.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-10 shrink-0 text-right font-bold tabular-nums text-amber-700">{p.findings_undeterminable ?? 0}</span>
              <span className="text-slate-600"><span className="font-medium text-slate-800">can&apos;t tell</span> — no CVE/CWE data to reason from. Not safe, not dangerous: unknown.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-10 shrink-0 text-right font-bold tabular-nums text-rose-700">{p.findings_ranked ?? 0}</span>
              <span className="text-slate-600"><span className="font-medium text-slate-800">dangerous</span> — a real, reachable attack path. These are the ones to fix first, ranked by how many attacks one fix breaks.</span>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Link href="/vulnerabilities/choke-points" className="text-[11px] font-medium text-primary-600 hover:underline">Open the ranked list →</Link>
            <Link href={findingsHref} className="text-[11px] text-slate-500 hover:underline">All {totalFindings} findings →</Link>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-medium text-slate-700 flex items-center gap-1 mb-1"><Coins className="h-3.5 w-3.5 text-emerald-600" /> What it could cost</p>
          {!q ? (
            <p className="text-[11px] text-slate-400 mt-1">No simulation run yet.</p>
          ) : q.demo_only ? (
            // HARD RULE: never show a number computed from sample data as real.
            <>
              <p className="text-base font-semibold text-slate-700 leading-tight">Not quantified yet</p>
              <p className="mt-1 text-[11px] text-slate-500">
                The only simulation on file was run on <span className="font-medium">{q.risks_demo} sample risks</span> (marked [DEMO]) — no real risks are in the register, so there is no real cost figure to show.
              </p>
              <p className="mt-1.5 text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-1">Add your real risks and re-run the portfolio to get a genuine number.</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{money(q.ale, q.currency)}</p>
              <p className="mt-1 text-[11px] text-slate-500">likely loss per year · worst case {money(q.p95, q.currency)}</p>
              <p className="mt-1.5 text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-1">For ALL your risks, not just these machines — risks aren&apos;t tied to a scope yet.</p>
            </>
          )}
          <Link href="/erm/risks" className="mt-2 inline-block text-[11px] text-primary-600 hover:underline">See the FAIR panel on the Risk dashboard →</Link>
        </div>
      </div>

      {/* ── the controls, LISTED by framework — the crosswalk made visible ─── */}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <p className="text-[11px] font-medium text-slate-700">
            The {controlItems.length} controls these findings fall under
            <span className="ml-1 font-normal text-slate-500">— matched from each finding&apos;s weakness type (CWE) to your uploaded frameworks by exact control code. Not AI, not keyword guessing.</span>
          </p>
          <p className="text-[10px] text-slate-500">
            {Object.entries(byFramework).map(([fw, n]) => `${fw}: ${n}`).join(' · ')}
          </p>
        </div>
        {controlItems.length === 0 ? (
          <p className="text-[11px] text-slate-400">No controls linked yet — run the CWE auto-map on the register.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded border border-slate-100">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Framework</th>
                  <th className="px-2 py-1 text-left font-medium">Control</th>
                  <th className="px-2 py-1 text-right font-medium">Findings</th>
                  <th className="px-2 py-1 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {controlItems.map((c) => (
                  <tr key={`${c.kind}-${c.id}`} className="hover:bg-slate-50/70">
                    <td className="px-2 py-1 text-slate-500 whitespace-nowrap">{c.framework}</td>
                    <td className="px-2 py-1 text-slate-800"><span className="font-mono text-slate-900">{c.code}</span> <span className="text-slate-600">{c.title}</span></td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-700">{c.findings_covered}</td>
                    <td className="px-2 py-1">
                      <span className={`rounded-full px-1.5 py-0 text-[10px] font-medium ${
                        c.tier === 'tested_effective' ? 'bg-emerald-50 text-emerald-700'
                        : c.tier === 'tested_failed' ? 'bg-rose-50 text-rose-700'
                        : c.tier === 'remediation_verified' ? 'bg-sky-50 text-sky-700'
                        : 'bg-slate-100 text-slate-600'}`}>
                        {TIER_LABEL[c.tier] || c.tier}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1.5 text-[10px] text-slate-500">
          &ldquo;Only claimed&rdquo; becomes &ldquo;tested&rdquo; when real evidence lands: a re-scan that no longer sees the finding, or a retest recorded on the finding.
        </p>
      </div>

      {/* ── P5: AI-suggested SPECIFIC controls, human-approved ─────────────── */}
      <AiControlProposalsPanel scopeId={scopeId} />
    </div>
  );
}
