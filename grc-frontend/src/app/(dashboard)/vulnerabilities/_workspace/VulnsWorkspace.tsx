'use client';

/**
 * VulnsWorkspace — the shell for the Vulnerabilities tab register. A KPI strip
 * (Total / Open / Overdue / Critical / SLA-compliance from the vuln dashboard)
 * + a toolbar (search + Status/Severity facets + Show-closed + register-type
 * Standard⇄NCA selector + Register⇄Workbench view-switcher + Template/
 * Bulk-Upload/Add) over a shared, page-filtered data source. Register is default.
 *
 * It is purely presentational: ALL data, filter state + setters, permissions
 * and handlers arrive as props from VulnerabilitiesPage — nothing new is lifted
 * here. Mirrors assets/_workspace/AssetsWorkspace.
 */

import { useMemo } from 'react';
import {
  Bug, ShieldAlert, Clock, AlertOctagon, Gauge,
  Download, Upload, Plus, Search, Loader2,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { MultiSelectDropdown } from '@/components/ui';
import type { Vulnerability } from './lib';
import { slaFromVuln } from './lib';
import { RegisterView } from './RegisterView';

// ─── Compact distribution donuts ─────────────────────────────────────────────
const SEV_COLORS: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#10b981', info: '#94a3b8' };
const STATUS_COLORS: Record<string, string> = { open: '#f97316', in_progress: '#3b82f6', remediated: '#10b981', verified: '#059669', closed: '#94a3b8', accepted: '#64748b' };
const SLA_COLORS: Record<string, string> = { overdue: '#ef4444', 'on track': '#10b981' };

interface Slice { name: string; value: number; color: string; [k: string]: string | number }

function DonutCard({ title, data }: { title: string; data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card">
      <h3 className="mb-1.5 text-xs font-semibold text-slate-800">{title}</h3>
      {total === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">No data yet</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative h-20 w-20 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={22} outerRadius={38} paddingAngle={2} stroke="none">
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <RTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold text-slate-900">{total}</span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-0.5">
            {data.map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="truncate capitalize text-slate-600">{d.name}</span>
                </span>
                <span className="font-medium text-slate-800">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// The dashboard payload is read defensively — every field is optional here so
// the page's stricter DashboardData is structurally assignable.
interface VulnDashboard {
  total_vulnerabilities?: number;
  by_severity?: Record<string, number>;
  by_status?: Record<string, number>;
  overdue_count?: number;
  sla_compliance?: Record<string, { total: number; resolved: number; on_time: number; compliance_rate: number }>;
}

export interface VulnsWorkspaceProps {
  // Data
  vulns: Vulnerability[];           // full (unfiltered) list — for KPI fallbacks
  filteredVulns: Vulnerability[];   // already filtered + sorted by the page
  dashboard: VulnDashboard | undefined;
  loading?: boolean;

  // Register-type (Standard ⇄ NCA) — owned by the page.
  registerType: 'standard' | 'nca';
  setRegisterType: (v: 'standard' | 'nca') => void;
  /** The existing NCA register table (rendered by the page when registerType === 'nca'). */
  renderNcaRegister: () => React.ReactNode;

  // Filter state + setters (owned by the page)
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  severityFilter: string;
  setSeverityFilter: (v: string) => void;
  showClosed: boolean;
  setShowClosed: (v: boolean) => void;

  // Permissions
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;

  // Handlers
  onView: (vuln: Vulnerability) => void;
  onEdit?: (vuln: Vulnerability) => void;
  onAssign?: (vuln: Vulnerability) => void;
  onChangeStatus?: (vuln: Vulnerability) => void;
  onDelete?: (vuln: Vulnerability) => void;
  onBulkAssign?: (ids: number[]) => void;
  onOpenFull: (id: number) => void;
  onTemplate: () => void;
  onBulkUpload: () => void;
  onAdd: () => void;

  // Bulk-upload status (toast surfaced under the toolbar)
  bulkUploadState?: 'idle' | 'uploading' | 'done' | 'error';
  bulkUploadMsg?: string | null;
}

const STATUS_ITEMS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'remediated', label: 'Remediated' },
  { value: 'verified', label: 'Verified' },
  { value: 'closed', label: 'Closed' },
  { value: 'accepted', label: 'Risk Accepted' },
];
const SEVERITY_ITEMS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'info', label: 'Info' },
];

const OPEN_STATUSES = new Set(['open', 'in_progress']);

export function VulnsWorkspace({
  vulns,
  filteredVulns,
  dashboard,
  loading = false,
  registerType,
  setRegisterType,
  renderNcaRegister,
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  severityFilter,
  setSeverityFilter,
  showClosed,
  setShowClosed,
  canCreate,
  canEdit,
  canDelete,
  onView,
  onEdit,
  onAssign,
  onChangeStatus,
  onDelete,
  onBulkAssign,
  onOpenFull,
  onTemplate,
  onBulkUpload,
  onAdd,
  bulkUploadState = 'idle',
  bulkUploadMsg,
}: VulnsWorkspaceProps) {
  const rows = filteredVulns ?? [];
  const isNca = registerType === 'nca';

  // ─── Distribution data for the donut charts ────────────────────────────────
  const chartData = useMemo(() => {
    const all = vulns ?? [];
    const tally = (fn: (v: Vulnerability) => string) => {
      const m: Record<string, number> = {};
      all.forEach((v) => { const k = fn(v); m[k] = (m[k] || 0) + 1; });
      return m;
    };
    const sev = tally((v) => (v.severity || 'unknown').toLowerCase());
    const st = tally((v) => (v.status || 'unknown').toLowerCase());
    const severity: Slice[] = ['critical', 'high', 'medium', 'low', 'info'].filter((k) => sev[k]).map((k) => ({ name: k, value: sev[k], color: SEV_COLORS[k] }));
    const status: Slice[] = ['open', 'in_progress', 'remediated', 'verified', 'closed', 'accepted'].filter((k) => st[k]).map((k) => ({ name: k.replace('_', ' '), value: st[k], color: STATUS_COLORS[k] }));
    // SLA — overdue vs on-track across open vulns.
    let overdue = 0, onTrack = 0;
    all.forEach((v) => {
      if (!OPEN_STATUSES.has((v.status || '').toLowerCase())) return;
      if (slaFromVuln(v).overdue) overdue += 1; else onTrack += 1;
    });
    const sla: Slice[] = [
      { name: 'overdue', value: overdue, color: SLA_COLORS.overdue },
      { name: 'on track', value: onTrack, color: SLA_COLORS['on track'] },
    ].filter((s) => s.value > 0);
    return { severity, status, sla };
  }, [vulns]);

  // ─── KPIs — derived from dashboard first, else the full vuln list ──────────
  const kpis = useMemo(() => {
    const all = vulns ?? [];
    const total = dashboard?.total_vulnerabilities ?? all.length;

    const bySt = dashboard?.by_status ?? {};
    const open = (bySt.open ?? 0) + (bySt.in_progress ?? 0) ||
      all.filter((v) => OPEN_STATUSES.has((v.status || '').toLowerCase())).length;

    const critical = dashboard?.by_severity?.critical ??
      all.filter((v) => (v.severity || '').toLowerCase() === 'critical').length;

    const overdue = dashboard?.overdue_count ??
      all.filter((v) => slaFromVuln(v).overdue).length;

    // SLA compliance — on-time / total across all severity buckets.
    const compliance = dashboard?.sla_compliance ?? {};
    const entries = Object.values(compliance);
    let slaPct = 0;
    if (entries.length) {
      const totalInSla = entries.reduce((s, e) => s + e.total, 0);
      const onTime = entries.reduce((s, e) => s + e.on_time, 0);
      slaPct = totalInSla > 0 ? Math.round((onTime / totalInSla) * 100) : 0;
    }

    return { total, open, critical, overdue, slaPct };
  }, [dashboard, vulns]);

  const STATS = [
    { label: 'Total', value: kpis.total, icon: Bug, tint: 'bg-primary-50 text-primary-700', valueTone: 'text-slate-900' },
    { label: 'Open', value: kpis.open, icon: ShieldAlert, tint: 'bg-amber-50 text-amber-700', valueTone: kpis.open > 0 ? 'text-amber-700' : 'text-slate-900' },
    { label: 'Overdue', value: kpis.overdue, icon: Clock, tint: 'bg-rose-50 text-rose-700', valueTone: kpis.overdue > 0 ? 'text-rose-600' : 'text-slate-900' },
    { label: 'Critical', value: kpis.critical, icon: AlertOctagon, tint: 'bg-rose-50 text-rose-700', valueTone: kpis.critical > 0 ? 'text-rose-600' : 'text-slate-900' },
    {
      label: 'SLA compliance',
      value: `${kpis.slaPct}%`,
      icon: Gauge,
      tint: 'bg-emerald-50 text-emerald-700',
      valueTone: kpis.slaPct >= 80 ? 'text-emerald-700' : kpis.slaPct >= 50 ? 'text-amber-700' : 'text-rose-600',
    },
  ];

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

      {/* ─── Distribution donuts ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <DonutCard title="By severity" data={chartData.severity} />
        <DonutCard title="By status" data={chartData.status} />
        <DonutCard title="By SLA" data={chartData.sla} />
      </div>

      {/* ─── Toolbar (single compact row; scrolls on very narrow screens) ─────── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
        <div className="relative w-40 shrink-0 sm:w-52">
          <Search strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by title, CVE ID…"
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <MultiSelectDropdown
          title="Status" items={STATUS_ITEMS}
          selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
          onApply={(v) => setStatusFilter(v[0] || 'all')}
          multiSelect={false} autoApply placeholder="All" size="sm" className="shrink-0"
        />
        <MultiSelectDropdown
          title="Severity" items={SEVERITY_ITEMS}
          selectedValues={severityFilter !== 'all' ? [severityFilter] : []}
          onApply={(v) => setSeverityFilter(v[0] || 'all')}
          multiSelect={false} autoApply placeholder="All" size="sm" className="shrink-0"
        />
        <label
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm ${
            statusFilter !== 'all' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-50'
          }`}
          title={statusFilter !== 'all' ? 'Status filter is active — clear it to use this toggle' : 'Show closed / mitigated vulnerabilities'}
        >
          <input
            type="checkbox"
            checked={showClosed}
            disabled={statusFilter !== 'all'}
            onChange={(e) => setShowClosed(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="whitespace-nowrap text-slate-700">Show closed</span>
        </label>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Register-type selector (Standard ⇄ NCA) */}
          <select
            value={registerType}
            onChange={(e) => setRegisterType(e.target.value as 'standard' | 'nca')}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            title="Switch between the Standard register and the NCA Saudi template view"
          >
            <option value="standard">Standard</option>
            <option value="nca">NCA Template</option>
          </select>

          {/* Actions */}
          {canCreate && (
            <>
              <button
                onClick={onTemplate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                title="Download CSV template for bulk upload"
              >
                <Download strokeWidth={1.75} className="h-4 w-4" />
                <span className="hidden md:inline">Template</span>
              </button>
              <button
                onClick={onBulkUpload}
                disabled={bulkUploadState === 'uploading'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                title="Bulk import from CSV / Excel / NCA workbook"
              >
                {bulkUploadState === 'uploading'
                  ? <Loader2 strokeWidth={1.75} className="h-4 w-4 animate-spin" />
                  : <Upload strokeWidth={1.75} className="h-4 w-4" />}
                <span className="hidden md:inline">Bulk Upload</span>
              </button>
              <button
                onClick={onAdd}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-[color:var(--color-on-base,#0a0a0a)] shadow-sm hover:bg-primary-700"
                title={isNca ? 'Create from NCA template' : 'Add a new vulnerability'}
              >
                <Plus strokeWidth={1.75} className="h-4 w-4" />
                <span className="hidden sm:inline">{isNca ? 'Add NCA Entry' : 'Add Vulnerability'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bulk-upload result toast */}
      {bulkUploadMsg && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium ${
            bulkUploadState === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {bulkUploadMsg}
        </div>
      )}

      {/* ─── Section label ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">
          {isNca ? 'NCA Vulnerability Register' : 'Vulnerability Register'}
        </h2>
        <p className="text-sm text-slate-500">
          {rows.length} shown · {kpis.total} total
        </p>
      </div>

      {/* ─── Register ──────────────────────────────────────────────────────── */}
      {isNca ? (
        renderNcaRegister()
      ) : (
        <RegisterView
          rows={rows}
          loading={loading}
          canEdit={canEdit}
          canDelete={canDelete}
          canCreate={canCreate}
          onView={onView}
          onEdit={onEdit}
          onAssign={onAssign}
          onChangeStatus={onChangeStatus}
          onDelete={onDelete}
          onBulkAssign={onBulkAssign}
        />
      )}
    </div>
  );
}

export default VulnsWorkspace;
