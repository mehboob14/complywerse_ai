'use client';

/**
 * CRQM dashboard card — portfolio loss headline + top risks by ALE.
 *
 * Renders nothing at all when no loss models exist, so tenants that haven't
 * adopted quantification see an unchanged dashboard. The independence caveat
 * renders ON the card — this is the surface that gets screenshotted into
 * board decks, so the assumption must travel with the number. Per-risk ALEs
 * are each risk's latest baseline run of its ACTIVE model (activation
 * auto-runs keep these fresh); the portfolio p95 comes from the joint run,
 * never from summing per-risk percentiles (means add; tails don't).
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { AlertTriangle, Banknote, Loader2, Play } from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

interface SummaryRisk {
  risk_id: number;
  title: string;
  model_version: number;
  currency: string;
  ale_mean: number | null;
  p95: number | null;
  run_created_at: string | null;
}

function fmtMoney(v: number | null | undefined, currency = 'USD'): string {
  if (v === null || v === undefined) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, maximumFractionDigits: 0,
      notation: v >= 1_000_000 ? 'compact' : 'standard',
    }).format(v);
  } catch {
    return `${currency} ${Math.round(v).toLocaleString()}`;
  }
}

export default function QuantificationCard() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('risks:risk_register:edit');

  const [error, setError] = useState<string | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['crqm-summary'],
    queryFn: async () => (await ermApi.quantification.getSummary()).data,
  });

  const portfolioMutation = useMutation({
    mutationFn: () => ermApi.quantification.simulatePortfolio({ iterations: 10000 }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['crqm-summary'] });
    },
    onError: (e: any) =>
      setError(e?.response?.data?.detail || 'Portfolio simulation failed'),
  });

  const risks: SummaryRisk[] = summary?.risks || [];
  if (risks.length === 0) return null;

  const portfolio = summary?.portfolio;
  const currency = portfolio?.currency || risks[0]?.currency || 'USD';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Banknote className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />
          Quantified cyber risk (FAIR)
        </h2>
        {canEdit && (
          <button
            onClick={() => portfolioMutation.mutate()}
            disabled={portfolioMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {portfolioMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Play className="h-3.5 w-3.5" />}
            {portfolio ? 'Re-run portfolio' : 'Run portfolio simulation'}
          </button>
        )}
      </div>

      {error && (
        <p className="mb-3 flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          {portfolio ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['Expected annual loss', portfolio.ale_mean],
                  ['Bad year (p95)', portfolio.p95],
                  ['Extreme year (p99)', portfolio.p99],
                ].map(([label, v]) => (
                  <div key={label as string} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 text-center">
                    <p className="text-base font-bold text-slate-900 tabular-nums">
                      {fmtMoney(v as number, currency)}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
              {(portfolio.lec_points || []).length > 0 && (
                <div className="h-36 mt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={portfolio.lec_points} margin={{ top: 5, right: 8, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="loss" type="number" domain={['dataMin', 'dataMax']}
                        tickFormatter={(v) => fmtMoney(v, currency)} tick={{ fontSize: 10 }} />
                      <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`}
                        domain={[0, 'dataMax']} tick={{ fontSize: 10 }} width={36} />
                      <Tooltip
                        formatter={(value) => [`${(Number(value) * 100).toFixed(1)}%`, 'P(loss exceeds)']}
                        labelFormatter={(v) => fmtMoney(Number(v), currency)}
                      />
                      <Area type="monotone" dataKey="prob" stroke="#059669" fill="#059669" fillOpacity={0.12} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              {portfolio.created_at && (
                <p className="mt-1 text-[10px] text-slate-400">
                  Portfolio run {new Date(portfolio.created_at).toLocaleString()}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500">
              No portfolio run yet — run one to see the combined loss picture across all
              active loss models.
            </p>
          )}
          <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-[11px] leading-snug text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            {summary?.independence_note ||
              'Portfolio percentiles assume independence between scenarios; correlated risks make real tail risk higher than shown.'}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-600 mb-1.5">Top risks by expected annual loss</p>
          <ul className="divide-y divide-slate-100">
            {risks.slice(0, 5).map((r) => (
              <li key={r.risk_id} className="flex items-center justify-between gap-2 py-1.5">
                <Link
                  href={`/erm/risks/${r.risk_id}`}
                  className="min-w-0 truncate text-sm text-slate-700 hover:text-primary-600"
                >
                  {r.title}
                </Link>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                  {fmtMoney(r.ale_mean, r.currency)}
                  <span className="ml-2 font-normal text-[10px] text-slate-400">
                    p95 {fmtMoney(r.p95, r.currency)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {risks.length > 5 && (
            <p className="mt-1 text-[10px] text-slate-400">+ {risks.length - 5} more quantified risk(s)</p>
          )}
        </div>
      </div>
    </div>
  );
}
