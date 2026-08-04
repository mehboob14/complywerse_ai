'use client';

// CriticalityCoverageWidget
// ─────────────────────────────────────────────────────────────────────────
// Drop-in card for /assets that shows assessment coverage at a glance:
// "N of M assets have a criticality assessment" with a horizontal
// stacked bar splitting the band distribution + an unassessed segment.

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { criticalityApi, type CriticalityCoverage } from '@/lib/api';

const BAND_COLORS: Record<string, string> = {
  mission_critical: '#f43f5e',
  high: '#fb923c',
  moderate: '#facc15',
  low: '#34d399',
};
const BAND_LABEL: Record<string, string> = {
  mission_critical: 'Mission-Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
};

export function CriticalityCoverageWidget() {
  const { data, isLoading } = useQuery<CriticalityCoverage>({
    queryKey: ['criticality.coverage'],
    queryFn: async () => (await criticalityApi.coverage()).data,
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-4 h-32 animate-pulse" />;
  }
  if (!data) return null;

  const totalAssessments = Object.values(data.by_band).reduce((s, n) => s + n, 0);
  const coveragePct = data.total_assets > 0
    ? Math.round((data.assessed_assets / data.total_assets) * 100)
    : 0;

  // Build segments — bands sized by their count, then a grey unassessed
  // remainder so the bar totals to data.total_assets.
  const segments: Array<{ key: string; count: number; color: string }> = [];
  ['mission_critical', 'high', 'moderate', 'low'].forEach((band) => {
    const n = data.by_band[band] ?? 0;
    if (n > 0) segments.push({ key: band, count: n, color: BAND_COLORS[band] });
  });
  if (data.unassessed_assets > 0) {
    segments.push({ key: 'unassessed', count: data.unassessed_assets, color: '#e2e8f0' });
  }
  const denominator = Math.max(1, totalAssessments + data.unassessed_assets);

  return (
    <Link
      href="/assets/criticality-assessments"
      className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-900">Criticality Coverage</p>
            <p className="text-[11px] text-slate-500">
              {data.assessed_assets} of {data.total_assets} assets assessed ({coveragePct}%)
            </p>
          </div>
        </div>
        <span className="text-[10px] font-medium text-slate-500 uppercase">{totalAssessments} items</span>
      </div>

      {/* Stacked bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 flex">
        {segments.map((s) => (
          <div
            key={s.key}
            style={{ width: `${(s.count / denominator) * 100}%`, backgroundColor: s.color }}
            title={`${s.key === 'unassessed' ? 'Unassessed' : BAND_LABEL[s.key]}: ${s.count}`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
        {['mission_critical', 'high', 'moderate', 'low'].map((band) => {
          const n = data.by_band[band] ?? 0;
          if (n === 0) return null;
          return (
            <span key={band} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: BAND_COLORS[band] }} />
              {BAND_LABEL[band]} · <span className="font-semibold text-slate-700">{n}</span>
            </span>
          );
        })}
        {data.unassessed_assets > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-slate-200" />
            Unassessed · <span className="font-semibold text-slate-700">{data.unassessed_assets}</span>
          </span>
        )}
      </div>
    </Link>
  );
}
