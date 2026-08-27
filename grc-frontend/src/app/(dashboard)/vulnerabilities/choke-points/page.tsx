'use client';

/**
 * CTEM Phase 4 — Choke points.
 *
 * Findings ranked by how many VIABLE attack chains their remediation severs
 * (a CVE on many assets is the choke point). Every rank decomposes to the
 * exact chains it breaks — explainability is the whole feature, the
 * difference from a black-box score. The view carries computed_at (a stale
 * list must show its age) and coverage honesty (a short list is
 * coverage-limited, not broken), and NEVER sums chain counts across findings.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { vulnManagementApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Crosshair, RefreshCw, Loader2, ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react';

interface Chain { asset_id: number; snapshot_id: number; verdict: string }
interface Entry {
  vulnerability_id: number; vuln_id?: string; title?: string; severity?: string;
  chain_count: number; rank: number; chains: Chain[];
}

const SEV: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700', high: 'bg-orange-50 text-orange-700',
  medium: 'bg-amber-50 text-amber-700', low: 'bg-emerald-50 text-emerald-700',
  info: 'bg-slate-50 text-slate-600',
};

export default function ChokePointsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vulnerabilities:vulnerability_register:edit');
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['choke-points'],
    queryFn: async () => (await vulnManagementApi.vulnerabilities.chokePoints()).data,
  });

  const recompute = useMutation({
    mutationFn: async () => (await vulnManagementApi.vulnerabilities.recomputeChokePoints()).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['choke-points'] }),
  });

  const snapshot = data?.snapshot;
  const entries: Entry[] = snapshot?.entries || [];
  const cov = data?.coverage;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
            Choke points
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl mt-0.5">
            Findings ranked by the reach of a single fix: how many <em>viable</em> attack chains
            (a latest verdict of likely or possible) their remediation severs at once — widest
            reach first. Not a convergence node in the classic sense; this schema stores one
            chain per finding-on-asset, so a widespread finding is the lever. Click a row for the
            exact chains it breaks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/vulnerabilities" className="text-xs text-slate-500 hover:text-slate-800">
            ← Register
          </Link>
          {canEdit && (
            <button
              onClick={() => recompute.mutate()}
              disabled={recompute.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {recompute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recompute
            </button>
          )}
        </div>
      </div>

      {/* computed_at + coverage honesty */}
      {snapshot?.computed_at && (
        <p className="text-[11px] text-slate-400">
          Computed {new Date(snapshot.computed_at).toLocaleString()}
          {snapshot.algorithm_version ? ` · ${snapshot.algorithm_version}` : ''}
        </p>
      )}
      {cov && (
        <p className="flex items-start gap-1.5 rounded-md border border-slate-200 bg-slate-50/60 p-2.5 text-xs text-slate-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.75} />
          {data.coverage_note}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 justify-center text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-8 text-center text-sm text-slate-500">
          No ranked choke points — no finding currently has a <em>viable</em> stored attack chain.
          {cov && (
            <span className="block mt-2 text-xs text-slate-400 text-left max-w-xl mx-auto space-y-1">
              <span className="block">
                Three levers move this list, and they are not one:
              </span>
              <span className="block">
                • <strong className="text-slate-500">{cov.findings_chainless}</strong> of {cov.total_findings} findings
                carry no attack chain at all <span className="text-slate-400">(generation)</span>.
              </span>
              <span className="block">
                • <strong className="text-slate-500">{cov.findings_severed}</strong> carry a chain we derived as
                <em> severed</em> — every way in is blocked on the asset. Real posture; enrichment won&apos;t revive it.
              </span>
              <span className="block">
                • <strong className="text-slate-500">{cov.findings_undeterminable}</strong> carry a chain we
                <em> can&apos;t derive</em> — no CWE or CVSS recorded to reason from. A data gap, not a conclusion;
                only enrichable when the finding has a CVE to enrich from.
              </span>
            </span>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {entries.map((e) => (
            <div key={e.vulnerability_id}>
              <button
                onClick={() => setExpanded(expanded === e.vulnerability_id ? null : e.vulnerability_id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <span className="w-7 text-center text-sm font-bold text-slate-400 tabular-nums">#{e.rank}</span>
                {expanded === e.vulnerability_id
                  ? <ChevronDown className="h-4 w-4 text-slate-400" />
                  : <ChevronRight className="h-4 w-4 text-slate-400" />}
                <span className="flex-1 min-w-0">
                  <Link
                    href={`/vulnerabilities/${e.vulnerability_id}`}
                    onClick={(ev) => ev.stopPropagation()}
                    className="text-sm text-slate-800 hover:text-primary-600 truncate block"
                  >
                    {e.title || e.vuln_id || `Finding ${e.vulnerability_id}`}
                  </Link>
                </span>
                {e.severity && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${SEV[e.severity] || SEV.info}`}>
                    {e.severity}
                  </span>
                )}
                <span className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">
                  breaks {e.chain_count} chain{e.chain_count === 1 ? '' : 's'}
                </span>
              </button>
              {expanded === e.vulnerability_id && (
                <div className="bg-slate-50/50 px-4 py-3 pl-14">
                  <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                    Fixing this finding severs these {e.chains.length} viable chain(s):
                  </p>
                  <ul className="space-y-1">
                    {e.chains.map((ch) => (
                      <li key={ch.snapshot_id} className="text-xs text-slate-600 flex items-center gap-2">
                        <span className="inline-flex rounded-full bg-white border border-slate-200 px-1.5 py-0 text-[10px] font-mono">
                          asset {ch.asset_id}
                        </span>
                        <span className={`inline-flex rounded-full px-1.5 py-0 text-[10px] font-semibold ${
                          ch.verdict === 'likely' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {ch.verdict}
                        </span>
                        <span className="text-slate-400">snapshot #{ch.snapshot_id}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
