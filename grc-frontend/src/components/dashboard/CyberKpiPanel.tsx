'use client';

/**
 * Cyber Security KPI panel for the MAIN dashboard. Mirrors the Excel KPI Report's
 * "Dashboard" sheet: each KPI carries a prior-year baseline and four quarters of
 * Target + Actual, grouped by cybersecurity domain. This is a REPORTING view, not
 * a scored module, so it summarises latest-quarter attainment (Actual vs Target,
 * direction-aware) rather than a 0-100 score. Parse logic + the click-through
 * detail/logic modal are shared with the full KPI Report page (see kpiShared).
 *
 * Data: the same live endpoints the full KPI Report page uses —
 *   GET /compliance/assessments?assessment_format=kpi_report   (find the report)
 *   GET /compliance/assessments/{id}                           (items = KPIs)
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { Activity, ArrowRight, Target, Info } from 'lucide-react';
import { KPI_FORMAT, GOOD, BAD, TEAL, type Kpi, parseKpi, pct, Spark, KpiDetailModal } from '@/components/dashboard/kpiShared';

function KpiCell({ k, onOpen }: { k: Kpi; onOpen: () => void }) {
  const a = k.latest?.actual ?? null;
  const t = k.latest?.target ?? null;
  const tone = k.onTarget == null ? '#94a3b8' : k.onTarget ? GOOD : BAD;
  return (
    <button type="button" onClick={onOpen}
      className="group rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">{k.domain}</p>
          <p className="line-clamp-2 text-[11.5px] font-medium leading-tight text-slate-700" title={k.topic}>{k.topic}</p>
        </div>
        <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: `${tone}14`, color: tone }}>
          {k.onTarget == null ? 'n/a' : k.onTarget ? 'On target' : 'Below'}
        </span>
      </div>
      <Spark prior={k.prior} quarters={k.quarters} />
      <div className="mt-1 flex items-center justify-between text-[10.5px]">
        <span className="font-bold tabular-nums" style={{ color: tone }}>{pct(a)} <span className="font-normal text-slate-400">actual</span></span>
        <span className="flex items-center gap-1 text-slate-500"><Target className="h-3 w-3" />{pct(t)} target</span>
      </div>
      <p className="mt-1.5 text-[9px] font-medium text-slate-300 group-hover:text-teal-500">Click for detail &amp; logic →</p>
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
    queryKey: ['main-kpi-report'],
    queryFn: async () => {
      const list = (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: KPI_FORMAT } })).data;
      const arr = list?.assessments || list || [];
      if (!Array.isArray(arr) || !arr.length) return null;
      const detail = (await apiClient.get(`/compliance/assessments/${arr[0].id}`)).data;
      return { id: arr[0].id, name: detail?.name || 'Cyber Security KPI Report', items: detail?.items || [] };
    },
    staleTime: 60_000,
  });

  if (isLoading) return <div className="skeleton mb-6 h-64 rounded-2xl" />;
  if (!data || !data.items.length) return null;

  const kpis = data.items.map(parseKpi);
  const rated = kpis.filter((k) => k.onTarget != null);
  const onT = rated.filter((k) => k.onTarget).length;
  const offT = rated.length - onT;
  const latestActuals = kpis.map((k) => k.latest?.actual).filter((v): v is number => v != null);
  const avgActual = latestActuals.length ? Math.round(latestActuals.reduce((a, b) => a + b, 0) / latestActuals.length) : null;
  const domains = new Set(kpis.map((k) => k.domain)).size;
  const latestQ = Math.max(0, ...kpis.map((k) => k.latest?.q ?? 0));

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${TEAL}14` }}>
            <Activity className="h-4 w-4" style={{ color: TEAL }} />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Cyber Security KPIs</h3>
            <p className="text-[11px] text-slate-400">Quarterly target vs actual · {kpis.length} KPIs across {domains} domains{latestQ ? ` · latest Q${latestQ}` : ''}</p>
          </div>
        </div>
        <Link href="/assessments/cs_kpi" className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800">
          Open KPI Report <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 px-5 py-3.5 sm:grid-cols-4">
        <Tile label={`On target (Q${latestQ})`} value={`${onT}`} tone={GOOD} />
        <Tile label="Below target" value={`${offT}`} tone={offT > 0 ? BAD : GOOD} />
        <Tile label="Avg actual" value={avgActual == null ? '—' : `${avgActual}%`} tone={TEAL} />
        <Tile label="KPIs · domains" value={`${kpis.length} · ${domains}`} />
      </div>

      <div className="grid grid-cols-1 gap-2.5 px-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k, i) => <KpiCell key={i} k={k} onOpen={() => setSel(k)} />)}
      </div>

      {/* inline logic note so the numbers aren't unexplained */}
      <div className="mx-5 mb-5 mt-3 flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2.5">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
        <p className="text-[10.5px] leading-4 text-slate-500">
          <b className="text-slate-600">On target</b> = KPIs whose latest-quarter actual meets its target — direction-aware
          (a KPI that counts a bad outcome, e.g. “% not monitored”, is on target when actual stays <b>at or below</b> target).
          {' '}<b className="text-slate-600">Avg actual</b> = mean of the latest-quarter actuals. Values come from the source KPI
          workbook. <b className="text-slate-600">Click any KPI</b> for its full quarterly table and the exact logic.
        </p>
      </div>

      <KpiDetailModal k={sel} onClose={() => setSel(null)} />
    </div>
  );
}
