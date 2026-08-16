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

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ctemScopesApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Crosshair, Plus, Play, Square, Loader2, AlertTriangle, Lock, ExternalLink,
  ShieldCheck, Ticket, Coins,
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

// The CTEM loop, left to right. Scope = the assets in the slice; the middle
// three are the cycle's own counters; prioritised shows "—" when the scope has
// no choke-point history yet (the backend omits it — an honest seam, not a 0).
function Counters({ c }: { c: { member_assets: number; discovered: number; prioritized?: number; validated: number; mobilized: number } }) {
  const stages: [string, string, number | undefined][] = [
    ['1', 'Scope', c.member_assets],
    ['2', 'Discover', c.discovered],
    ['3', 'Prioritise', c.prioritized],
    ['4', 'Validate', c.validated],
    ['5', 'Mobilise', c.mobilized],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {stages.map(([n, label, v]) => (
        <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2 text-center">
          <p className="text-[9px] font-medium text-slate-400 mb-0.5 uppercase tracking-wide">{n} · {label}</p>
          <p className="text-base font-bold text-slate-900 tabular-nums">{v === undefined ? '—' : v}</p>
        </div>
      ))}
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
                <div className="mt-3">
                  <p className="text-[11px] font-medium text-emerald-700 mb-1 flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> Open cycle — live counts
                  </p>
                  <Counters c={s.live_counts} />
                  <CommandCenter scopeId={s.id} />
                </div>
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
      {latest.counts && <Counters c={latest.counts} />}
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

// The four downstream cards of the loop, pulled per-scope from the command-center
// endpoint. Each links to the screen that owns the detail. The cost card is
// portfolio-wide by necessity — risk quantification isn't scope-linked — and says so.
function CommandCenter({ scopeId }: { scopeId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ctem-command-center', scopeId],
    queryFn: async () => (await ctemScopesApi.commandCenter(scopeId)).data,
  });
  if (isLoading) return <p className="mt-2 text-[11px] text-slate-400">Loading command center…</p>;
  if (!data) return null;
  const p = data.prioritise?.coverage || {};
  const tiers = data.validate?.tiers || {};
  const m = data.mobilise || {};
  const q = data.quantify;

  const row = (label: string, val: number | undefined) => (
    <div className="flex justify-between"><span>{label}</span><span className="tabular-nums">{val ?? 0}</span></div>
  );

  return (
    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1 mb-1"><Crosshair className="h-3 w-3" /> What to fix first</p>
        <p className="text-xl font-bold text-slate-900 tabular-nums">{p.findings_ranked ?? 0}</p>
        <p className="text-[10px] text-slate-400 mb-2">viable now · {p.total_viable_chains ?? 0} chain(s)</p>
        <div className="space-y-0.5 text-[10px] text-slate-500">
          {row('No chain yet', p.findings_chainless)}
          {row('Blocked (safe)', p.findings_severed)}
          {row("Can't tell yet", p.findings_undeterminable)}
        </div>
        <Link href="/vulnerabilities/choke-points" className="mt-2 inline-block text-[11px] text-primary-600 hover:underline">Choke points →</Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1 mb-1"><ShieldCheck className="h-3 w-3" /> Controls working?</p>
        <p className="text-xl font-bold text-slate-900 tabular-nums">{data.validate?.controls ?? 0}</p>
        <p className="text-[10px] text-slate-400 mb-2">cover these findings</p>
        <div className="space-y-0.5 text-[10px] text-slate-500">
          {row('Tested effective', tiers.tested_effective)}
          {row('Tested — failed', tiers.tested_failed)}
          {row('Attested only', tiers.attested_only)}
        </div>
        <Link href="/control-library/assurance" className="mt-2 inline-block text-[11px] text-primary-600 hover:underline">Assurance →</Link>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1 mb-1"><Ticket className="h-3 w-3" /> Fixes in flight</p>
        <p className="text-xl font-bold text-slate-900 tabular-nums">{m.tickets ?? 0}</p>
        <p className="text-[10px] text-slate-400 mb-2">ticketed to ITSM</p>
        <div className="space-y-0.5 text-[10px] text-slate-500">
          {row('Open', m.open)}
          {row('Resolved', m.resolved)}
          {row('Plan marked done', m.plans_applied)}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1 mb-1"><Coins className="h-3 w-3" /> Cost <span className="text-slate-300">· portfolio</span></p>
        {q ? (
          <>
            <p className="text-xl font-bold text-slate-900 tabular-nums">{money(q.ale, q.currency)}</p>
            <p className="text-[10px] text-slate-400 mb-1">likely / yr · worst {money(q.p95, q.currency)}</p>
            <p className="text-[10px] text-amber-600">All risks — not scope-filtered.</p>
          </>
        ) : (
          <p className="text-[11px] text-slate-400 mt-1">No simulation run yet.</p>
        )}
        <Link href="/erm/risks/list" className="mt-2 inline-block text-[11px] text-primary-600 hover:underline">Quantify →</Link>
      </div>
    </div>
  );
}
