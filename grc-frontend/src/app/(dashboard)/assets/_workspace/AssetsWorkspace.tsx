'use client';

/**
 * AssetsWorkspace — the shell for /assets. A KPI strip (Total / Critical /
 * Need-CIA / CDE-PCI / Stale>30d) + a toolbar (search + Type/Criticality/
 * Status/Lifecycle facets + a Register ⇄ Workbench view-switcher + Template/
 * Import/Add) over a shared, parent-filtered data source. Register is default.
 *
 * It is purely presentational: ALL data, filter state + setters, permissions
 * and handlers arrive as props from AssetsPage — nothing new is lifted here.
 * Mirrors evidence/_workspace/EvidenceWorkspace + governance DocumentsWorkspace.
 */

import { useMemo } from 'react';
import {
  Boxes, AlertTriangle, Clock, Lock, History,
  Download, Upload, Plus, Search,
} from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui';
import { SegmentedMixCard, StackedOverTimeCard, type MixSlice, type StackedRow } from '@/components/charts/MixCharts';
import type { ITAsset } from '@/types';
import { RegisterView } from './RegisterView';

// ─── Criticality mix + over-time colours ─────────────────────────────────────
const CRIT_COLORS: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#10b981' };
const CRIT_ORDER = ['critical', 'high', 'medium', 'low'];

// The dashboard payload is a loose record — read defensively.
type AssetDashboard = {
  total_assets?: number;
  by_criticality?: Record<string, number>;
  assets_needing_assessment?: number;
} & Record<string, unknown>;

export interface AssetsWorkspaceProps {
  // Data
  assets: ITAsset[];               // full (unfiltered) list — for KPI denominators
  filteredAssets: ITAsset[];       // already filtered by the page
  dashboard: AssetDashboard | undefined;
  loading?: boolean;

  // Filter state + setters (owned by the page)
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  criticalityFilter: string;
  setCriticalityFilter: (v: string) => void;
  lifecycleFilter: string;
  setLifecycleFilter: (v: string) => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;

  // Permissions
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;

  // Handlers
  onView: (asset: ITAsset) => void;
  onEdit: (asset: ITAsset) => void;
  onDelete: (asset: ITAsset) => void;
  onConnect: (asset: ITAsset) => void;
  onBulkConnect?: (ids: number[]) => void;
  onOpenFull: (id: number) => void;
  onTemplate: () => void;
  onImport: () => void;
  onAdd: () => void;
}

const TYPE_ITEMS = [
  { value: 'application', label: 'Application' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'data', label: 'Data' },
  { value: 'cloud', label: 'Cloud Resource' },
  { value: 'third_party', label: 'Third-Party System' },
];
const CRITICALITY_ITEMS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];
const STATUS_ITEMS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'decommissioned', label: 'Decommissioned' },
];
const LIFECYCLE_ITEMS = [
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'decommissioned', label: 'Decommissioned' },
  { value: 'retired', label: 'Retired' },
];

export function AssetsWorkspace({
  assets,
  filteredAssets,
  dashboard,
  loading = false,
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  criticalityFilter,
  setCriticalityFilter,
  lifecycleFilter,
  setLifecycleFilter,
  typeFilter,
  setTypeFilter,
  canCreate,
  canEdit,
  canDelete,
  onView,
  onEdit,
  onDelete,
  onConnect,
  onBulkConnect,
  onOpenFull,
  onTemplate,
  onImport,
  onAdd,
}: AssetsWorkspaceProps) {

  const rows = filteredAssets ?? [];

  // ─── KPIs — derived from dashboard first, else the full asset list ─────────
  const kpis = useMemo(() => {
    const all = assets ?? [];
    const total = dashboard?.total_assets ?? all.length;
    const critical = dashboard?.by_criticality?.critical ?? all.filter((a) => a.criticality === 'critical').length;
    const needCia = dashboard?.assets_needing_assessment ??
      all.filter((a) => !(a.confidentiality_rating || a.integrity_rating || a.availability_rating)).length;
    const cde = all.filter((a) => a.cde_environment).length;
    const stale = all.filter((a) => {
      if (!a.last_seen_at) return true;
      const ageDays = (Date.now() - new Date(a.last_seen_at).getTime()) / 86_400_000;
      return ageDays > 30;
    }).length;
    return { total, critical, needCia, cde, stale };
  }, [dashboard, assets]);

  const STATS = [
    { label: 'Total assets', value: kpis.total, icon: Boxes, tint: 'bg-primary-50 text-primary-700', valueTone: 'text-slate-900' },
    { label: 'Critical', value: kpis.critical, icon: AlertTriangle, tint: 'bg-rose-50 text-rose-700', valueTone: kpis.critical > 0 ? 'text-rose-600' : 'text-slate-900' },
    { label: 'Need CIA', value: kpis.needCia, icon: Clock, tint: 'bg-amber-50 text-amber-700', valueTone: kpis.needCia > 0 ? 'text-amber-700' : 'text-slate-900' },
    { label: 'CDE / PCI', value: kpis.cde, icon: Lock, tint: 'bg-rose-50 text-rose-700', valueTone: 'text-slate-900' },
    { label: 'Stale > 30d', value: kpis.stale, icon: History, tint: 'bg-slate-100 text-slate-500', valueTone: kpis.stale > 0 ? 'text-rose-600' : 'text-slate-900' },
  ];

  // ─── Criticality mix + monthly stacked mix ─────────────────────────────────
  const chartData = useMemo(() => {
    const all = assets ?? [];
    const critCount: Record<string, number> = {};
    all.forEach((a) => { const k = (a.criticality || '').toLowerCase(); if (k) critCount[k] = (critCount[k] || 0) + 1; });
    const dist: MixSlice[] = CRIT_ORDER.filter((k) => critCount[k]).map((k) => ({ name: k, value: critCount[k], color: CRIT_COLORS[k] }));
    // Monthly buckets, counted by criticality (for the stacked-over-time bars).
    const byMonth: Record<string, Record<string, number>> = {};
    all.forEach((a) => {
      if (!a.created_at) return;
      const d = new Date(a.created_at);
      if (Number.isNaN(d.getTime())) return;
      const k = (a.criticality || '').toLowerCase();
      if (!CRIT_ORDER.includes(k)) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = {};
      byMonth[key][k] = (byMonth[key][k] || 0) + 1;
    });
    const overTime: StackedRow[] = Object.keys(byMonth).sort().slice(-6).map((key) => {
      const [y, mo] = key.split('-');
      const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      const row: StackedRow = { label };
      CRIT_ORDER.forEach((k) => { row[k] = byMonth[key][k] || 0; });
      return row;
    });
    // Bottom-to-top stacking: low → critical (only categories that appear).
    const stackCats: MixSlice[] = ['low', 'medium', 'high', 'critical'].filter((k) => critCount[k]).map((k) => ({ name: k, value: 0, color: CRIT_COLORS[k] }));
    return { dist, overTime, stackCats };
  }, [assets]);

  return (
    <div className="assets-light space-y-4">
      {/* ─── KPI strip ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {STATS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-card">
              <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.tint}`}>
                <Icon strokeWidth={1.75} className="h-4 w-4" />
              </span>
              <div>
                <div className={`text-lg font-bold ${s.valueTone}`}>{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Charts: criticality mix + monthly stacked mix ─────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SegmentedMixCard totalLabel="assets by criticality" data={chartData.dist} />
        <StackedOverTimeCard title="Assets added over time" data={chartData.overTime} categories={chartData.stackCats} />
      </div>

      {/* ─── Toolbar (single compact row; scrolls on very narrow screens) ─────── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
        <div className="relative w-40 shrink-0 sm:w-52">
          <Search strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search assets…"
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <MultiSelectDropdown
          title="Type" items={TYPE_ITEMS}
          selectedValues={typeFilter !== 'all' ? [typeFilter] : []}
          onApply={(v) => setTypeFilter(v[0] || 'all')}
          multiSelect={false} autoApply placeholder="All" size="sm" className="shrink-0"
        />
        <MultiSelectDropdown
          title="Criticality" items={CRITICALITY_ITEMS}
          selectedValues={criticalityFilter !== 'all' ? [criticalityFilter] : []}
          onApply={(v) => setCriticalityFilter(v[0] || 'all')}
          multiSelect={false} autoApply placeholder="All" size="sm" className="shrink-0"
        />
        <MultiSelectDropdown
          title="Status" items={STATUS_ITEMS}
          selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
          onApply={(v) => setStatusFilter(v[0] || 'all')}
          multiSelect={false} autoApply placeholder="All" size="sm" className="shrink-0"
        />
        <MultiSelectDropdown
          title="Lifecycle" items={LIFECYCLE_ITEMS}
          selectedValues={lifecycleFilter !== 'all' ? [lifecycleFilter] : []}
          onApply={(v) => setLifecycleFilter(v[0] || 'all')}
          multiSelect={false} autoApply placeholder="All" size="sm" className="shrink-0"
        />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Actions */}
          <button
            onClick={onTemplate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            title="Download CSV template for bulk import"
          >
            <Download strokeWidth={1.75} className="h-4 w-4" />
            <span className="hidden md:inline">Template</span>
          </button>
          <button
            onClick={onImport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            title="Import assets from CSV"
          >
            <Upload strokeWidth={1.75} className="h-4 w-4" />
            <span className="hidden md:inline">Import</span>
          </button>
          {canCreate && (
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-[color:var(--color-on-base,#0a0a0a)] shadow-sm hover:bg-primary-700"
              title="Add a new asset"
            >
              <Plus strokeWidth={1.75} className="h-4 w-4" />
              <span className="hidden sm:inline">Add Asset</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── Section label ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Asset Register</h2>
        <p className="text-sm text-slate-500">
          {rows.length} shown · {kpis.total} total
        </p>
      </div>

      {/* ─── Register ──────────────────────────────────────────────────────── */}
      {(
        <RegisterView
          rows={rows}
          loading={loading}
          canEdit={canEdit}
          canDelete={canDelete}
          canCreate={canCreate}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
          onConnect={onConnect}
          onBulkConnect={onBulkConnect}
        />
      )}
    </div>
  );
}

export default AssetsWorkspace;
