'use client';

import { RefreshCw, Loader2, Zap, AlertTriangle, Filter, Maximize2, Info } from 'lucide-react';

export interface TrajectoryFilters {
  kevOnly: boolean;
  criticalOnly: boolean;
  riskBearingOnly: boolean;
  hideDirect: boolean;
}

interface Props {
  filters: TrajectoryFilters;
  setFilters: (f: TrajectoryFilters) => void;
  onRefresh: () => void;
  isFetching: boolean;
  onShowLegend: () => void;
  stats: {
    open_vulns: number;
    kev_count: number;
    vulns_with_risk_path: number;
    bridge_controls_total: number;
    risks_direct: number;
    risks_transitive: number;
    max_residual: number;
  };
}

function Chip({
  active, label, icon: Icon, onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ElementType;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors ${
        active
          ? 'border-blue-300 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

export function TrajectoryToolbar({
  filters, setFilters, onRefresh, isFetching, onShowLegend, stats,
}: Props) {
  const totalRisks = stats.risks_direct + stats.risks_transitive;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-3 pr-3 mr-1 border-r border-slate-200">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Snapshot</span>
          <span className="text-[10px] text-slate-600">
            <span className="font-semibold text-slate-900">{stats.open_vulns}</span> vulns
            {stats.kev_count > 0 && (
              <> · <span className="font-semibold text-rose-700">{stats.kev_count}</span> KEV</>
            )}
            {' · '}<span className="font-semibold text-slate-900">{stats.vulns_with_risk_path}</span> with risk path
            {' · '}<span className="font-semibold text-slate-900">{totalRisks}</span> risks
            {' '}(<span className="text-rose-700">{stats.risks_direct}</span>↑direct
            {' / '}<span className="text-blue-700">{stats.risks_transitive}</span>↑via ctrl)
            {stats.max_residual > 0 && (
              <> · max residual <span className="font-semibold text-rose-700 tabular-nums">{stats.max_residual}</span></>
            )}
          </span>
        </div>
        <Chip
          active={filters.kevOnly}
          label="KEV only"
          icon={Zap}
          onClick={() => setFilters({ ...filters, kevOnly: !filters.kevOnly })}
        />
        <Chip
          active={filters.criticalOnly}
          label="Critical only"
          icon={AlertTriangle}
          onClick={() => setFilters({ ...filters, criticalOnly: !filters.criticalOnly })}
        />
        <Chip
          active={filters.riskBearingOnly}
          label="Risk-bearing only"
          icon={Filter}
          onClick={() => setFilters({ ...filters, riskBearingOnly: !filters.riskBearingOnly })}
        />
        <Chip
          active={filters.hideDirect}
          label="Hide direct"
          icon={Maximize2}
          onClick={() => setFilters({ ...filters, hideDirect: !filters.hideDirect })}
        />
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onShowLegend}
          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
        >
          <Info className="h-3 w-3" />
          Legend
        </button>
        <button
          onClick={onRefresh}
          disabled={isFetching}
          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
      </div>
    </div>
  );
}
