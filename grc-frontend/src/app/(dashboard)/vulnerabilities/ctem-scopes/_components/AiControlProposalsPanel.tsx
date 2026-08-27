'use client';

/**
 * P5 — AI-suggested SPECIFIC control links, human-approved.
 *
 * The rule crosswalk links every open CVE to the GENERAL patch/vuln-mgmt
 * controls. This panel shows the AI's proposals for the SPECIFIC controls
 * (input validation, crypto config, hardening…) from the Unified Control
 * Library — as proposals. Nothing links until a person clicks Accept.
 * Every row shows the reason and what drove it, so approval is informed.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { vulnManagementApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Sparkles, Loader2, Check, X, RefreshCw } from 'lucide-react';

interface Proposal {
  id: number; status: 'proposed' | 'accepted' | 'rejected' | string;
  confidence: 'high' | 'medium' | 'low' | string; reason?: string | null; driven_by?: string | null;
  bucket?: string | null; prompt_version?: string; provenance?: 'model' | 'reused' | string;
  vulnerability: { id: number; vuln_id?: string; title?: string; cve_id?: string | null; cwe_id?: string | null; severity?: string; priority?: boolean };
  control: { id: number; code: string; name: string; domain?: string | null; kind?: string; framework?: string | null; satisfies?: string[] };
  decided_at?: string | null;
  run_id?: string | null;
}
interface RunSummary {
  run_id: string; findings_total: number; findings_inventory: number; findings_sent: number;
  proposals_created: number; proposals_updated: number; model_errors: number; invalid_ids_dropped: number;
  findings_reused?: number; proposals_reused?: number;
  started_at?: string | null; finished_at?: string | null; running?: boolean; prompt_version: string;
}

interface RunRow { run_id: string; started_at?: string | null; finished_at?: string | null; findings_sent: number; findings_total: number; error?: boolean }

const CONF: Record<string, string> = {
  high: 'bg-emerald-50 text-emerald-700', medium: 'bg-amber-50 text-amber-700', low: 'bg-slate-100 text-slate-600',
};

export function AiControlProposalsPanel({ scopeId }: { scopeId: number }) {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vulnerabilities:vulnerability_register:edit');
  const [tab, setTab] = useState<'proposed' | 'accepted' | 'rejected'>('proposed');
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // each mapping run is its own reviewable session — default to the latest
  const [runFilter, setRunFilter] = useState<string>('latest');

  const { data, isLoading } = useQuery({
    queryKey: ['ai-control-proposals', scopeId, tab, runFilter],
    queryFn: async () => (await vulnManagementApi.vulnerabilities.aiProposalsList({ status: tab, ctem_scope_id: scopeId,
      ...(runFilter !== 'latest' && runFilter !== 'all' ? { run_id: runFilter } : {}) })).data,
    // Generation runs in the background; poll every 3s while a run is open.
    refetchInterval: (q) => ((q.state.data as any)?.last_run?.running ? 3000 : false),
  });
  // PRIORITY ON TOP: prioritised vulnerabilities first, then by confidence
  const confRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const runs: RunRow[] = data?.runs || [];
  const latestRunId: string | null = data?.last_run?.run_id ?? null;
  const rawItems: Proposal[] = data?.items || [];
  const runScoped = runFilter === 'latest' && latestRunId
    ? rawItems.filter((i) => i.run_id === latestRunId)
    : rawItems;
  const items: Proposal[] = [...runScoped].sort((a: Proposal, b: Proposal) =>
    (Number(!!b.vulnerability?.priority) - Number(!!a.vulnerability?.priority))
    || ((confRank[a.confidence] ?? 3) - (confRank[b.confidence] ?? 3)));
  // tab badges follow the selected session: latest → the per-run tally, a picked
  // run → server-filtered counts, all → everything
  const counts: { proposed?: number; accepted?: number; rejected?: number } =
    (runFilter === 'latest' ? data?.last_run_counts : data?.counts) || {};
  const last: RunSummary | null = data?.last_run || null;
  const running = !!last?.running;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ai-control-proposals'] });
    qc.invalidateQueries({ queryKey: ['ctem-command-center', scopeId] });
    qc.invalidateQueries({ queryKey: ['ctem-portfolio'] });   // the redesign page reads this
  };
  const gen = useMutation({
    mutationFn: async () => (await vulnManagementApi.vulnerabilities.aiProposalsGenerate(scopeId)).data,
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Generation failed'),
  });
  const accept = useMutation({
    mutationFn: async (id: number) => (await vulnManagementApi.vulnerabilities.aiProposalAccept(id)).data,
    onSuccess: invalidate, onError: (e: any) => setError(e?.response?.data?.detail || 'Accept failed'),
  });
  const reject = useMutation({
    mutationFn: async (id: number) => (await vulnManagementApi.vulnerabilities.aiProposalReject(id)).data,
    onSuccess: invalidate, onError: (e: any) => setError(e?.response?.data?.detail || 'Reject failed'),
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-[11px] font-medium text-slate-700 flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 text-violet-600" /> Your decisions
            <span className="ml-1 font-normal text-slate-500">— Accept links a pick · Reject removes it (remembered; a group un-links together)</span>
          </p>
          {last && (
            <p className="mt-0.5 text-[10px] text-slate-500 flex items-center gap-1">
              {running && <Loader2 className="h-3 w-3 animate-spin text-violet-600" />}
              {running ? 'Running now' : `Last run${last.finished_at ? ` ${new Date(last.finished_at).toLocaleString()}` : ''}`}:
              {' '}{last.findings_sent} of {last.findings_total} vulnerabilities analysed
              {last.findings_inventory ? ` (${last.findings_inventory} already answered earlier — skipped)` : ''}, {last.proposals_created} new suggestion{last.proposals_created === 1 ? '' : 's'}
              {last.findings_reused ? ` · ${last.findings_reused} vulnerabilit${last.findings_reused === 1 ? 'y' : 'ies'} settled by reusing your earlier decisions (${last.proposals_reused ?? 0} link${(last.proposals_reused ?? 0) === 1 ? '' : 's'}, no model call)` : ''}
              {last.model_errors ? ` · ${last.model_errors} model error(s)` : ''}{last.invalid_ids_dropped ? ` · ${last.invalid_ids_dropped} invalid id(s) dropped` : ''} · {last.prompt_version}
            </p>
          )}
        </div>
        {canEdit && (
          <button onClick={() => gen.mutate()} disabled={gen.isPending || running}
            className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50">
            {(gen.isPending || running) ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {running ? 'Analysing in background…' : (last ? 'Re-run AI mapping' : 'Run AI mapping for this scope')}
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-[11px] text-rose-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-1 mb-2 text-[10.5px]">
        <select value={runFilter} onChange={(e) => setRunFilter(e.target.value)}
          title="Each mapping run is its own session — its accepts, rejects and queue are kept separately"
          className="mr-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10.5px] text-slate-600">
          <option value="latest">Latest run{latestRunId ? '' : ' (none yet)'}</option>
          <option value="all">All runs</option>
          {runs.filter((r) => r.run_id !== latestRunId).map((r) => (
            <option key={r.run_id} value={r.run_id}>
              {r.started_at ? new Date(r.started_at).toLocaleString() : r.run_id.slice(0, 8)} · {r.findings_sent}/{r.findings_total}{r.error ? ' · error' : ''}
            </option>
          ))}
        </select>
        {(['proposed', 'accepted', 'rejected'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={tab === t ? { backgroundColor: '#0f172a' } : undefined}
            className={`rounded-full px-2 py-0.5 ${tab === t ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {t === 'proposed' ? 'To review' : t === 'accepted' ? 'Accepted' : 'Rejected'}
            {counts[t] != null && <span className="ml-1 tabular-nums opacity-70">{counts[t]}</span>}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-[11px] text-slate-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-slate-400">
          {tab === 'proposed'
            ? (last ? 'Nothing waiting for review.' : 'No AI mapping has been run for this scope yet.')
            : `No ${tab} suggestions.`}
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-slate-100">
          <table className="w-full table-fixed text-[11px]">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left font-medium w-[21%]">Vulnerability</th>
                <th className="px-2 py-1 text-left font-medium w-[23%]">Suggested control</th>
                <th className="px-2 py-1 text-left font-medium">Why</th>
                <th className="px-2 py-1 text-left font-medium w-[56px]">Conf.</th>
                {tab === 'proposed' && canEdit && <th className="px-2 py-1 text-right font-medium w-[124px]">Decide</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(showAll ? items : items.slice(0, 10)).map((p) => (
                <tr key={p.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-2 py-1.5">
                    <Link href={`/vulnerabilities/${p.vulnerability.id}`} className="text-primary-600 hover:underline">
                      {p.vulnerability.vuln_id || `#${p.vulnerability.id}`}
                    </Link>
                    <div className="text-slate-600 line-clamp-2">{p.vulnerability.title}</div>
                    <div className="text-[10px] text-slate-400">
                      {p.vulnerability.priority && <span className="mr-1 rounded-full bg-rose-50 px-1.5 py-0 text-[9px] font-bold uppercase text-rose-600">priority</span>}
                      {p.vulnerability.cve_id || (p.vulnerability.cwe_id ? p.vulnerability.cwe_id : 'no CVE — from description')}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="font-mono text-slate-900">{p.control.code}</span>
                    {p.provenance === 'reused' && (
                      <span className="ml-1 rounded-full bg-sky-50 px-1.5 py-0 text-[9.5px] font-semibold text-sky-700" title="Applied from a human's earlier decision on the same weakness type — no new model call">reused</span>
                    )}
                    <div className="text-slate-700">{p.control.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <span className="rounded-full bg-slate-100 px-1.5 py-0 text-[9.5px] font-medium text-slate-500">{p.control.framework || p.control.domain}</span>
                      {(p.control.satisfies ?? []).map((t) => (
                        <span key={t} title="Same rule as written in this framework — links together with the control" className="rounded-full bg-violet-50 px-1.5 py-0 text-[9.5px] font-medium text-violet-700">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-slate-600 break-words">
                    {p.reason}
                    {p.driven_by && <div className="text-[10px] text-slate-400">driven by: {p.driven_by.replace(/_/g, ' ')}</div>}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded-full px-1.5 py-0 text-[10px] font-medium ${CONF[p.confidence] || CONF.low}`}>{p.confidence}</span>
                  </td>
                  {tab === 'proposed' && canEdit && (
                    <td className="px-2 py-1.5 text-right whitespace-nowrap w-[124px]">
                      <button onClick={() => accept.mutate(p.id)} disabled={accept.isPending}
                        className="inline-flex items-center gap-0.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50 mr-1">
                        <Check className="h-3 w-3" /> Accept
                      </button>
                      <button onClick={() => reject.mutate(p.id)} disabled={reject.isPending}
                        className="inline-flex items-center gap-0.5 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                        <X className="h-3 w-3" /> Reject
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 10 && (
            <button onClick={() => setShowAll((v) => !v)} className="w-full border-t border-slate-100 py-1.5 text-[11px] font-medium text-primary-700 hover:bg-slate-50">
              {showAll ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </div>
      )}
      <p className="mt-1.5 text-[10px] text-slate-500">
        Each control was linked automatically when you ran &ldquo;Map controls&rdquo; (tagged &ldquo;ai_auto&rdquo;); accepting a waiting suggestion tags it &ldquo;ai_suggested&rdquo; with your name on it. Reject removes a wrong link and is remembered — the pair is never suggested again. Every suggestion&apos;s full prompt and raw answer are stored for audit.
      </p>
    </div>
  );
}
