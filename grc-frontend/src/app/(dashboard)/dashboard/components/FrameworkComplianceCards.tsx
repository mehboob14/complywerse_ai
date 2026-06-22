'use client';

// Executive-overview "Framework" section: a paginated carousel of per-framework
// compliance cards, each with a gradient semicircle gauge (red→amber→green),
// "X out of Y total", an eye (open) icon, a trend badge, and a bottom band bar.
// Header has "N-M of T" pagination + prev/next + an expand (zoom-out) control
// that opens a full grid of every framework.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Eye, ChevronLeft, ChevronRight, Maximize2, TrendingDown, TrendingUp, LayoutGrid, X } from 'lucide-react';
import { complianceApi } from '@/lib/api';
import { FrameworkLogo } from '@/components/FrameworkLogo';

type FwRow = {
  journey_id?: number;
  framework_id?: number;
  name?: string;
  framework_name?: string;
  short_code?: string;
  total?: number;
  implemented?: number;
  verified?: number;
  completion_pct?: number;
  readiness_pct?: number;
  trend_pct?: number;
};

const PER_PAGE = 4;

function bandColor(pct: number): string {
  if (pct >= 75) return '#22c55e';
  if (pct >= 40) return '#f59e0b';
  return '#ef4444';
}

// ─── Gradient semicircle gauge (custom SVG for the rainbow fill) ───────────
function SemiGauge({ pct, done, total }: { pct: number; done: number; total: number }) {
  const r = 48;
  const cx = 60;
  const cy = 56;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const arcLen = Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * arcLen;
  return (
    <div className="relative mx-auto" style={{ width: 120, height: 66 }}>
      <svg viewBox="0 0 120 66" width="120" height="66">
        <defs>
          <linearGradient id="fwgauge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="45%" stopColor="#f59e0b" />
            <stop offset="75%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        <path d={arc} fill="none" stroke="#eef2f7" strokeWidth="9" strokeLinecap="round" />
        <path d={arc} fill="none" stroke="url(#fwgauge)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${dash} ${arcLen}`} className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <span className="text-xl font-bold tabular-nums text-slate-800 leading-none">{pct}%</span>
        <span className="mt-0.5 text-[9px] text-slate-400">{done} out of {total} total</span>
      </div>
    </div>
  );
}

function FrameworkCard({ row }: { row: FwRow }) {
  const name = row.framework_name || row.name || 'Framework';
  const total = row.total ?? 0;
  const done = row.implemented ?? 0;
  const pct = Math.round(row.completion_pct ?? (total ? (done / total) * 100 : 0));
  const trend = Math.round(row.trend_pct ?? 0);
  const color = bandColor(pct);
  const href = row.journey_id ? `/frameworks/${row.journey_id}` : '/frameworks';

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FrameworkLogo name={name} size={24} />
          <span className="truncate text-sm font-semibold text-slate-800">{name}</span>
        </div>
        <Link href={href} title="Open framework" className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <Eye className="h-4 w-4" />
        </Link>
      </div>

      <div className="relative">
        <span className={`absolute right-0 top-0 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
          trend < 0 ? 'bg-rose-50 text-rose-600' : trend > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
        }`}>
          {trend < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : trend > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : null}
          {trend === 0 ? '0%' : `${Math.abs(trend)}%`}
        </span>
        <SemiGauge pct={pct} done={done} total={total} />
      </div>

      <div className="mt-3 h-1.5 w-full rounded-full" style={{ backgroundColor: color, opacity: 0.9 }} />
    </div>
  );
}

export function FrameworkComplianceCards() {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['exec-frameworks-aggregate'],
    queryFn: async () => (await complianceApi.dashboard.getFrameworksAggregate()).data,
    staleTime: 60_000,
  });

  const frameworks = useMemo<FwRow[]>(() => {
    const list = (data as { by_framework?: FwRow[] } | undefined)?.by_framework;
    return Array.isArray(list) ? list : [];
  }, [data]);

  const total = frameworks.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PER_PAGE;
  const visible = frameworks.slice(start, start + PER_PAGE);

  const Header = ({ inModal = false }: { inModal?: boolean }) => (
    <div className="flex items-center justify-between gap-2 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
          <LayoutGrid className="h-3.5 w-3.5 text-blue-600" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">Framework</h3>
      </div>
      {!inModal && total > 0 && (
        <div className="flex items-center gap-1.5 text-slate-500">
          <span className="text-xs tabular-nums">{start + 1}-{Math.min(total, start + PER_PAGE)} of {total}</span>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}
            className="rounded-md border border-slate-200 p-1 text-slate-500 enabled:hover:bg-slate-50 disabled:opacity-40" aria-label="Previous">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
            className="rounded-md border border-slate-200 p-1 text-slate-500 enabled:hover:bg-slate-50 disabled:opacity-40" aria-label="Next">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setExpanded(true)}
            className="ml-0.5 rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50" aria-label="Expand">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {inModal && (
        <button onClick={() => setExpanded(false)} className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const body = (cards: FwRow[], grid: string) => {
    if (isLoading) {
      return (
        <div className={`grid gap-3 ${grid}`}>
          {Array.from({ length: PER_PAGE }).map((_, i) => <div key={i} className="h-[160px] animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      );
    }
    if (total === 0) {
      return <div className="py-10 text-center text-xs text-slate-400">No active framework journeys yet.</div>;
    }
    return (
      <div className={`grid gap-3 ${grid} animate-[fadeSlide_0.35s_ease]`} key={safePage}>
        {cards.map((row, i) => <FrameworkCard key={(row.journey_id ?? i) + ':' + i} row={row} />)}
      </div>
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
      {/* keyframes for the "slide out from the right" page transition */}
      <style jsx global>{`
        @keyframes fadeSlide { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>
      <Header />
      <div className="px-4 pb-4 pt-1">
        {body(visible, 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4')}
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8" onClick={() => setExpanded(false)}>
          <div className="max-h-full w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <Header inModal />
            <div className="max-h-[80vh] overflow-y-auto px-4 pb-5 pt-1">
              {body(frameworks, 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
