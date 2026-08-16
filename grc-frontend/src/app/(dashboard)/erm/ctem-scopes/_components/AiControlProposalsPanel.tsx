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
  bucket?: string | null; prompt_version?: string;
  vulnerability: { id: number; vuln_id?: string; title?: string; cve_id?: string | null; cwe_id?: string | null; severity?: string };
  control: { id: number; code: string; name: string; domain?: string | null };
  decided_at?: string | null;
}
interface RunSummary {
  run_id: string; findings_total: number; findings_inventory: number; findings_sent: number;
  proposals_created: number; proposals_updated: number; model_errors: number; invalid_ids_dropped: number;
  started_at?: string | null; finished_at?: string | null; running?: boolean; prompt_version: string;
}

const CONF: Record<string, string> = {
  high: 'bg-emerald-50 text-emerald-700', medium: 'bg-amber-50 text-amber-700', low: 'bg-slate-100 text-slate-600',
};

export function AiControlProposalsPanel({ scopeId }: { scopeId: number }) {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vulnerabilities:vulnerability_register:edit');
  const [tab, setTab] = useState<'proposed' | 'accepted' | 'rejected'>('proposed');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['ai-control-proposals', scopeId, tab],
    queryFn: async () => (await vulnManagementApi.vulnerabilities.aiProposalsList({ status: tab, ctem_scope_id: scopeId })).data,
    // Generation runs in the background; poll every 3s while a run is open.
    refetchInterval: (q) => ((q.state.data as any)?.last_run?.running ? 3000 : false),
  });
  const items: Proposal[] = data?.items || [];
  const last: RunSummary | null = data?.last_run || null;
  const running = !!last?.running;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ai-control-proposals'] });
    qc.invalidateQueries({ queryKey: ['ctem-command-center', scopeId] });
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
            <Sparkles className="h-3.5 w-3.5 text-violet-600" /> AI-suggested specific controls
            <span className="ml-1 font-normal text-slate-500">— from your Unified Control Library. Suggestions only: nothing links until you accept.</span>
          </p>
          {last && (
            <p className="mt-0.5 text-[10px] text-slate-500 flex items-center gap-1">
              {running && <Loader2 className="h-3 w-3 animate-spin text-violet-600" />}
              {running ? 'Running now' : `Last run${last.finished_at ? ` ${new Date(last.finished_at).toLocaleString()}` : ''}`}:
              {' '}{last.findings_sent} of {last.findings_total - last.findings_inventory} findings analysed,
              {' '}{last.findings_inventory} skipped as informational, {last.proposals_created} new suggestion{last.proposals_created === 1 ? '' : 's'}
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

      <div className="flex gap-1 mb-2 text-[10.5px]">
        {(['proposed', 'accepted', 'rejected'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-2 py-0.5 ${tab === t ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {t === 'proposed' ? 'To review' : t === 'accepted' ? 'Accepted' : 'Rejected'}
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
        <div className="max-h-72 overflow-y-auto overflow-x-hidden rounded border border-slate-100">
          <table className="w-full table-fixed text-[11px]">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left font-medium w-[26%]">Finding</th>
                <th className="px-2 py-1 text-left font-medium w-[28%]">Suggested control</th>
                <th className="px-2 py-1 text-left font-medium">Why</th>
                <th className="px-2 py-1 text-left font-medium w-[64px]">Conf.</th>
                {tab === 'proposed' && canEdit && <th className="px-2 py-1 text-right font-medium w-[128px]">Decide</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((p) => (
                <tr key={p.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-2 py-1.5">
                    <Link href={`/vulnerabilities/${p.vulnerability.id}`} className="text-primary-600 hover:underline">
                      {p.vulnerability.vuln_id || `#${p.vulnerability.id}`}
                    </Link>
                    <div className="text-slate-600 line-clamp-2">{p.vulnerability.title}</div>
                    <div className="text-[10px] text-slate-400">{p.vulnerability.cve_id || (p.vulnerability.cwe_id ? p.vulnerability.cwe_id : 'no CVE — from description')}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="font-mono text-slate-900">{p.control.code}</span>
                    <div className="text-slate-700">{p.control.name}</div>
                    {p.control.domain && <div className="text-[10px] text-slate-400">{p.control.domain}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-slate-600 break-words">
                    {p.reason}
                    {p.driven_by && <div className="text-[10px] text-slate-400">driven by: {p.driven_by.replace(/_/g, ' ')}</div>}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded-full px-1.5 py-0 text-[10px] font-medium ${CONF[p.confidence] || CONF.low}`}>{p.confidence}</span>
                  </td>
                  {tab === 'proposed' && canEdit && (
                    <td className="px-2 py-1.5 text-right whitespace-nowrap w-[128px]">
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
        </div>
      )}
      <p className="mt-1.5 text-[10px] text-slate-500">
        Accept creates a control link tagged &ldquo;ai_suggested&rdquo; with your name on it. Reject is remembered — the pair is never suggested again. Every suggestion&apos;s full prompt and raw answer are stored for audit.
      </p>
    </div>
  );
}
