'use client';

/**
 * Cyber Security KPI panel for the MAIN dashboard. The KPI list comes from the
 * uploaded workbook (the catalog); the ACTUAL values are computed LIVE from real
 * modules where the platform owns the data (policy reviews, vulnerability SLA,
 * access certification) and overlaid. KPIs with no in-platform source are flagged
 * "external" with no number — nothing static, nothing fabricated. Detail/logic
 * modal is shared with the KPI Report page (kpiShared).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { Activity, ArrowRight, Target } from 'lucide-react';
import { KPI_FORMAT, GOOD, BAD, TEAL, type Kpi, type LiveMetric, buildKpis, pct, toneOf, RichTrend, KpiDetailModal } from '@/components/dashboard/kpiShared';

// Full inline KPI card — the rich trend chart + period cards shown right on the
// card (not just in the popup). `wide` spans both columns to fill an odd row.
function KpiRichCard({ k, onOpen, span }: { k: Kpi; onOpen: () => void; span: number }) {
  const tone = toneOf(k);
  const colClass = span === 3 ? 'lg:col-span-3' : span === 2 ? 'lg:col-span-2' : '';
  const tw = span === 3 ? 1060 : span === 2 ? 700 : 440;
  return (
    <button type="button" onClick={onOpen}
      className={`group flex flex-col rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:border-slate-300 hover:shadow-sm ${colClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">{k.domain}</span>
            <span className="rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase" style={{ backgroundColor: `${TEAL}14`, color: TEAL }}>Live</span>
          </div>
          <p className="truncate text-[12px] font-medium text-slate-700" title={k.topic}>{k.topic}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-[19px] font-bold leading-none tabular-nums" style={{ color: tone }}>{pct(k.actual)}</div>
          <div className="mt-0.5 flex items-center justify-end gap-0.5 text-[9.5px] text-slate-400"><Target className="h-2.5 w-2.5" />{pct(k.target)}</div>
        </div>
      </div>
      <div className="mt-1.5"><RichTrend history={k.history} target={k.target} width={tw} height={span >= 2 ? 74 : 66} /></div>
      <div className="mt-1 flex items-center justify-between text-[9.5px]">
        <span className="font-medium" style={{ color: k.onTarget ? GOOD : BAD }}>{k.onTarget ? 'On target' : 'Below target'} · live</span>
        {k.numerator != null && k.denominator != null && <span className="tabular-nums text-slate-400">{k.numerator}/{k.denominator} · click for detail</span>}
      </div>
    </button>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 text-center">
      <div className="text-[19px] font-bold leading-none tabular-nums" style={{ color: tone ?? '#334155' }}>{value}</div>
      <div className="mt-1 text-[9.5px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

export default function CyberKpiPanel() {
  const [sel, setSel] = useState<Kpi | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['main-kpi-live'],
    queryFn: async () => {
      const list = (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: KPI_FORMAT } })).data;
      const arr = list?.assessments || list || [];
      if (!Array.isArray(arr) || !arr.length) return null;
      const [detail, live] = await Promise.all([
        apiClient.get(`/compliance/assessments/${arr[0].id}`).then((r) => r.data),
        apiClient.get('/compliance/assessments/kpi-live').then((r) => r.data).catch(() => ({ metrics: {} })),
      ]);
      return { items: detail?.items || [], metrics: (live?.metrics || {}) as Record<string, LiveMetric> };
    },
    staleTime: 60_000,
  });

  if (isLoading) return <div className="skeleton mb-6 h-64 rounded-2xl" />;
  if (!data || !data.items.length) return null;

  const kpis = buildKpis(data.items, data.metrics);
  const liveKpis = kpis.filter((k) => k.live);
  const extKpis = kpis.filter((k) => !k.live);
  const onT = liveKpis.filter((k) => k.onTarget).length;
  const offT = liveKpis.filter((k) => k.onTarget === false).length;
  const ext = extKpis.length;
  const domains = new Set(kpis.map((k) => k.domain)).size;

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${TEAL}14` }}>
            <Activity className="h-4 w-4" style={{ color: TEAL }} />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Cyber Security KPIs</h3>
            <p className="text-[11px] text-slate-400">{kpis.length} KPIs across {domains} domains · {liveKpis.length} computed live from real modules</p>
          </div>
        </div>
        <Link href="/assessments/cs_kpi" className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800">
          Open KPI Report <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 px-5 py-3.5 sm:grid-cols-4">
        <Tile label="Live KPIs" value={`${liveKpis.length}`} tone={TEAL} />
        <Tile label="On target" value={`${onT}`} tone={GOOD} />
        <Tile label="Below target" value={`${offT}`} tone={offT > 0 ? BAD : GOOD} />
        <Tile label="External (no feed)" value={`${ext}`} />
      </div>

      {/* Live KPIs as compact rich cards; the last card(s) widen to fill the row (no gaps). */}
      <div className="grid grid-cols-1 gap-2.5 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
        {liveKpis.map((k, i) => {
          const rem = liveKpis.length % 3;
          const span = i === liveKpis.length - 1 ? (rem === 1 ? 3 : rem === 2 ? 2 : 1) : 1;
          return <KpiRichCard key={i} k={k} onOpen={() => setSel(k)} span={span} />;
        })}
      </div>

      <KpiDetailModal k={sel} onClose={() => setSel(null)} />
    </div>
  );
}
