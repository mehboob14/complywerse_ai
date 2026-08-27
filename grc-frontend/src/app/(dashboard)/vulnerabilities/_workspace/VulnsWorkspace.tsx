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

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bug, AlertOctagon, Zap, Crosshair, Globe,
  Download, Upload, Plus, Search, Loader2, List, LayoutGrid,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { MultiSelectDropdown } from '@/components/ui';
import type { Vulnerability } from './lib';
import { RegisterView } from './RegisterView';
import { GroupedRegister } from './GroupedRegister';

// ─── Compact distribution donuts ─────────────────────────────────────────────
const SEV_COLORS: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#10b981', info: '#94a3b8' };

interface Slice { name: string; value: number; color: string; [k: string]: string | number }

function DonutCard({ title, data }: { title: string; data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3>
      {total === 0 ? (
        <p className="flex flex-1 items-center justify-center py-8 text-center text-sm text-slate-400">No data yet</p>
      ) : (
        <div className="flex flex-1 items-center gap-5">
          <div className="relative h-40 w-40 shrink-0 sm:h-44 sm:w-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="52%"
                  outerRadius="88%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums leading-none text-slate-900 sm:text-3xl">{total}</span>
              <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">total</span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-2.5">
            {data.map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="truncate capitalize text-slate-600">{d.name}</span>
                </span>
                <span className="text-base font-semibold tabular-nums text-slate-900">{d.value}</span>
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
  // Redesign aggregates (server-computed over the whole register).
  kev_count?: number;
  exploit_count?: number;
  no_exploit_count?: number;
  with_cve_count?: number;
  high_tactics_count?: number;
  high_tactics_with_exploit_count?: number;
  high_epss_count?: number;
  internet_exposed_count?: number;
  patch_count?: number;
  contextual_priority?: { urgent?: number; moderate?: number; low?: number };
}

export interface VulnsWorkspaceProps {
  // Data
  vulns: Vulnerability[];           // full (unfiltered) list — for KPI fallbacks
  filteredVulns: Vulnerability[];   // already filtered + sorted by the page
  dashboard: VulnDashboard | undefined;
  scoped?: boolean;   // a CTEM-scope filter is active — tally the band from the scoped rows

  /** Runtime domains (scanner plugin-family) for the "By domain" panel — fetched by
      the page (VulnsWorkspace is props-only) since the register's `vulns` is capped. */
  domains?: { family: string; total: number; worst_severity: string }[];
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
  /** Public-exploit filter: 'all' | 'yes' | 'no' */
  exploitFilter: string;
  setExploitFilter: (v: string) => void;
  /** ATT&CK high-tactics filter: 'all' | 'high' */
  tacticsFilter: string;
  setTacticsFilter: (v: string) => void;
  /** "By asset" filter: 'all' | '<assetId>'. Options supplied by the page. */
  assetFilter?: string;
  setAssetFilter?: (v: string) => void;
  assetItems?: { value: string; label: string }[];

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
  { value: 'false_positive', label: 'False Positive' },
  { value: 'auto_closed_fixed', label: 'Closed — Verified by Re-scan' },
];
const SEVERITY_ITEMS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'info', label: 'Info' },
];
const EXPLOIT_ITEMS = [
  { value: 'yes', label: 'Has public exploit' },
  { value: 'no', label: 'No public exploit' },
];
const TACTICS_ITEMS = [
  { value: 'high', label: 'High tactics (≥7)' },
];

export function VulnsWorkspace({
  scoped = false,
  vulns,
  filteredVulns,
  dashboard,
  domains = [],
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
  exploitFilter,
  setExploitFilter,
  tacticsFilter,
  setTacticsFilter,
  assetFilter = 'all',
  setAssetFilter,
  assetItems = [],
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
  // Register view mode: flat table ⇄ grouped-by-domain (scanner plugin family).
  const [grouped, setGrouped] = useState(false);

  // ─── Severity distribution (raw CVSS) for the donut ────────────────────────
  const chartData = useMemo(() => {
    const all = vulns ?? [];
    const tally = () => {
      const m: Record<string, number> = {};
      all.forEach((v) => { const k = (v.severity || 'unknown').toLowerCase(); m[k] = (m[k] || 0) + 1; });
      return m;
    };
    const hasDash = (m?: Record<string, number>) => !!m && Object.keys(m).length > 0;
    // When scoped, the tenant-wide `dashboard` aggregate disagrees with the scoped
    // list (it showed "205 Total" under a "(201)" banner) — tally the scoped rows
    // so the donut matches the tiles. Unscoped: prefer the server aggregate, fall
    // back to a tally of the loaded page until the dashboard payload arrives.
    const sev = scoped ? tally() : (hasDash(dashboard?.by_severity) ? dashboard!.by_severity! : tally());
    const severity: Slice[] = ['critical', 'high', 'medium', 'low', 'info'].filter((k) => sev[k]).map((k) => ({ name: k, value: sev[k], color: SEV_COLORS[k] }));
    return { severity };
  }, [vulns, dashboard, scoped]);

  // ─── Aggregates for the KPI strip, the raw→contextual panel and threat band ──
  const agg = useMemo(() => {
    // SCOPED (a CTEM scope filter is active): the tenant-wide `dashboard`
    // aggregate would disagree with the scoped list — it showed "205 Total"
    // over a "(201)" scoped banner on the same screen (caught by the UI
    // walkthrough 18 Aug). When scoped, tally the band from the scoped rows so
    // every tile describes the scope, not the tenant.
    if (scoped) {
      const rows = vulns ?? [];
      const sevOf = (v: Vulnerability) => (v.severity || '').toLowerCase();
      const cnt = (f: (v: Vulnerability) => boolean) => rows.filter(f).length;
      // "Urgent / moderate / low" MUST use the SAME rule as the server dashboard's
      // contextual_priority (backend routers/dashboard.py): composite_priority ×10
      // banded at 55 / 25. The old client rule (kev || epss≥0.1 || critical)
      // disagreed with the server, so a scoped SUBSET reported MORE urgent than the
      // whole tenant (3 vs 1 — impossible; caught 23 Aug). Same bands now, so
      // scoped ≤ unscoped always holds.
      const cp = (v: Vulnerability) => (v.composite_priority ?? 0);   // 0–10 scale
      const critical = cnt((v) => sevOf(v) === 'critical');
      const high = cnt((v) => sevOf(v) === 'high');
      const medium = cnt((v) => sevOf(v) === 'medium');
      const kev = cnt((v) => !!v.kev_flag);
      const exploit = cnt((v) => !!v.kev_flag || (v.epss_score ?? 0) > 0);
      return {
        total: rows.length, critical, high, medium,
        urgent: cnt((v) => cp(v) >= 5.5),
        moderate: cnt((v) => cp(v) >= 2.5 && cp(v) < 5.5),
        low: cnt((v) => cp(v) < 2.5),
        kev, exploit, noExploit: rows.length - exploit,
        withCve: cnt((v) => !!v.cve_id), highTactics: 0, highTacticsWithExploit: 0,
        highEpss: cnt((v) => (v.epss_score ?? 0) >= 0.1), internetExposed: 0, patch: 0,
      };
    }
    const d = dashboard ?? {};
    const sev = d.by_severity ?? {};
    const ctx = d.contextual_priority ?? {};
    const total = d.total_vulnerabilities ?? (vulns?.length ?? 0);
    const exploit = d.exploit_count ?? 0;
    // Prefer server aggregates; if an older backend omits the new fields,
    // derive the cheap ones so the threat band never looks "unlinked".
    const noExploit = typeof d.no_exploit_count === 'number'
      ? d.no_exploit_count
      : Math.max(0, total - exploit);
    const withCve = typeof d.with_cve_count === 'number'
      ? d.with_cve_count
      : (vulns ?? []).filter((v) => !!v.cve_id).length;
    return {
      total,
      critical: sev.critical ?? 0,
      high: sev.high ?? 0,
      medium: sev.medium ?? 0,
      urgent: ctx.urgent ?? 0,
      moderate: ctx.moderate ?? 0,
      low: ctx.low ?? 0,
      kev: d.kev_count ?? 0,
      exploit,
      noExploit,
      withCve,
      highTactics: d.high_tactics_count ?? 0,
      highTacticsWithExploit: d.high_tactics_with_exploit_count ?? 0,
      highEpss: d.high_epss_count ?? 0,
      internetExposed: d.internet_exposed_count ?? 0,
      patch: d.patch_count ?? 0,
    };
  }, [dashboard, vulns, scoped]);

  // ─── KPI strip — raw severity kept, exploitability/exposure added ──────────
  const STATS = [
    { label: 'Total findings', value: agg.total, icon: Bug, tint: 'bg-primary-50 text-primary-700', valueTone: 'text-slate-900' },
    { label: 'Critical (CVSS)', value: agg.critical, icon: AlertOctagon, tint: 'bg-rose-50 text-rose-700', valueTone: agg.critical > 0 ? 'text-rose-600' : 'text-slate-900' },
    { label: 'Urgent now', value: agg.urgent, icon: Zap, tint: 'bg-amber-50 text-amber-700', valueTone: agg.urgent > 0 ? 'text-amber-700' : 'text-emerald-700' },
    { label: 'Actively exploited', value: agg.kev, icon: Crosshair, tint: 'bg-rose-50 text-rose-700', valueTone: agg.kev > 0 ? 'text-rose-600' : 'text-slate-900' },
    { label: 'Internet-exposed', value: agg.internetExposed, icon: Globe, tint: 'bg-orange-50 text-orange-700', valueTone: agg.internetExposed > 0 ? 'text-orange-700' : 'text-slate-900' },
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

      {/* ─── Severity (raw) + the enrichment story + domains ──────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <DonutCard title="By severity (raw CVSS)" data={chartData.severity} />
        {/* THE headline: what looks urgent by CVSS vs what's actually urgent once
            exposure / public-exploit / EPSS are weighed in the contextual priority. */}
        <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Raw severity → Contextual priority</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Raw looks like</div>
              <div className="flex items-baseline gap-2 text-xs"><span className="w-16 flex-none text-rose-600">Critical</span><b className="tabular-nums text-slate-900">{agg.critical}</b></div>
              <div className="flex items-baseline gap-2 text-xs"><span className="w-16 flex-none text-orange-600">High</span><b className="tabular-nums text-slate-900">{agg.high}</b></div>
              <div className="flex items-baseline gap-2 text-xs"><span className="w-16 flex-none text-amber-600">Medium</span><b className="tabular-nums text-slate-900">{agg.medium}</b></div>
            </div>
            <div className="space-y-1">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Actually is</div>
              <div className="flex items-baseline gap-2 text-xs"><span className="w-16 flex-none text-rose-600">Urgent</span><b className="tabular-nums text-slate-900">{agg.urgent}</b></div>
              <div className="flex items-baseline gap-2 text-xs"><span className="w-16 flex-none text-amber-700">Moderate</span><b className="tabular-nums text-slate-900">{agg.moderate}</b></div>
              <div className="flex items-baseline gap-2 text-xs"><span className="w-16 flex-none text-emerald-700">Low</span><b className="tabular-nums text-slate-900">{agg.low}</b></div>
            </div>
          </div>
          <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-[11px] leading-snug text-slate-500">
            Contextual priority weighs exposure, public exploits and EPSS on top of CVSS — most &ldquo;urgent-looking&rdquo; findings turn out internal, unexploited and low-EPSS.
          </p>
        </div>
        {/* By domain — runtime scanner plugin-families, worst-severity first. */}
        <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">By domain</h3>
          {domains.length === 0 ? (
            <p className="text-xs text-slate-400">No domain data yet.</p>
          ) : (
            <div className="space-y-2">
              {(() => {
                const max = Math.max(...domains.map((d) => d.total), 1);
                return domains.slice(0, 6).map((d) => (
                  <div key={d.family} className="flex items-center gap-2 text-xs">
                    <span className="w-24 flex-none truncate text-slate-600" title={d.family}>{d.family || 'Uncategorized'}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, (d.total / max) * 100)}%`, background: SEV_COLORS[d.worst_severity] || SEV_COLORS.info }} />
                    </div>
                    <span className="w-8 flex-none text-right font-semibold tabular-nums text-slate-700">{d.total}</span>
                  </div>
                ));
              })()}
              <p className="pt-1 text-[11px] text-slate-400">Ordered worst-severity first.</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Threat band ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {[
          { label: 'In CISA KEV', value: agg.kev },
          { label: 'Public exploit', value: agg.exploit },
          { label: 'No public exploit', value: agg.noExploit },
          { label: 'With CVE', value: agg.withCve },
          { label: 'High tactics (≥7)', value: agg.highTactics },
          { label: 'High tactics + exploit', value: agg.highTacticsWithExploit },
          { label: 'High EPSS (≥10%)', value: agg.highEpss },
          { label: 'Patch available', value: agg.patch },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-card">
            <div className={`text-xl font-bold tabular-nums ${t.value > 0 ? 'text-slate-900' : 'text-emerald-700'}`}>{t.value}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{t.label}</div>
          </div>
        ))}
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
        {setAssetFilter && assetItems.length > 0 && (
          <MultiSelectDropdown
            title="Asset" items={assetItems}
            selectedValues={assetFilter !== 'all' ? [assetFilter] : []}
            onApply={(v) => setAssetFilter(v[0] || 'all')}
            multiSelect={false} autoApply placeholder="All" size="sm" className="shrink-0" forceSearch searchPlaceholder="Find asset…"
          />
        )}
        <MultiSelectDropdown
          title="Exploit" items={EXPLOIT_ITEMS}
          selectedValues={exploitFilter !== 'all' ? [exploitFilter] : []}
          onApply={(v) => setExploitFilter(v[0] || 'all')}
          multiSelect={false} autoApply placeholder="All" size="sm" className="shrink-0"
        />
        <MultiSelectDropdown
          title="Tactics" items={TACTICS_ITEMS}
          selectedValues={tacticsFilter !== 'all' ? [tacticsFilter] : []}
          onApply={(v) => setTacticsFilter(v[0] || 'all')}
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
          {/* CTEM Phase 4 — choke points: fix-one-break-many ranking */}
          <Link
            href="/vulnerabilities/choke-points"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            title="Findings ranked by how many viable attack chains their fix severs"
          >
            <Crosshair strokeWidth={1.75} className="h-4 w-4" />
            <span className="hidden md:inline">Choke points</span>
          </Link>

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">
          {isNca ? 'NCA Vulnerability Register' : 'Vulnerability Register'}
        </h2>
        <div className="flex items-center gap-3">
          {!isNca && (
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
              <button
                onClick={() => setGrouped(false)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors ${!grouped ? 'bg-primary-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                title="Flat list of all findings"
              >
                <List className="h-3.5 w-3.5" /> Flat
              </button>
              <button
                onClick={() => setGrouped(true)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors ${grouped ? 'bg-primary-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                title="Group findings by scanner domain (plugin family)"
              >
                <LayoutGrid className="h-3.5 w-3.5" /> By domain
              </button>
            </div>
          )}
          <p className="text-sm text-slate-500">
            {grouped && !isNca ? `${agg.total} total` : `${rows.length} shown · ${agg.total} total`}
          </p>
        </div>
      </div>

      {/* ─── Register ──────────────────────────────────────────────────────── */}
      {isNca ? (
        renderNcaRegister()
      ) : grouped ? (
        <GroupedRegister includeClosed={showClosed} onView={onView} />
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
