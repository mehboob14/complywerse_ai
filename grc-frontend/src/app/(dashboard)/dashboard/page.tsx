'use client';

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  dashboardApi,
  enrichedDashboardApi,
  complianceApi,
  vulnManagementApi,
  controlLibraryApi,
  evidenceApi,
  ermApi,
  certificationsApi,
  issuesApi,
} from '@/lib/api';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LineChart,
  Line,
} from 'recharts';
import {
  Shield,
  AlertTriangle,
  FileCheck,
  Bug,
  TrendingUp,
  Activity,
  Target,
  Lock,
  Layers,
  Link as LinkIcon,
  LayoutDashboard, Scale, Bug as BugIcon, Server,
  ClipboardList, ListTodo, AlertCircle, FileCheck as FileCheck2, BookOpen,
  Clock as ClockIcon, Folder, RefreshCw, CheckCircle as CheckCircleIcon,
  Gauge, Flame, Building2,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import MainModuleCards from '@/components/dashboard/MainModuleCards';
import CyberKpiPanel from '@/components/dashboard/CyberKpiPanel';

import {
  ExecutivePortfolioWidget,
  ExecutiveAttentionWidget,
  ExecutiveRiskVelocityWidget,
  ExecutiveRiskAppetiteWidget,
  GovernanceSummaryWidget,
  GovernanceStatusWidget,
  GovernanceTrendWidget,
  GovernanceFrameworkCoverageWidget,
  GovernanceQueueWidget,
  GovernanceRecentPublicationsWidget,
  GovernanceActivityWidget,
  ExceptionPostureWidget,
  RiskSummaryWidget,
  RiskDistributionWidget,
  RiskCategoryWidget,
  InternalControlStatusWidget,
  InternalControlDesignEffectivenessWidget,
  InternalControlOperatingEffectivenessWidget,
  IncidentSnapshotWidget,
  ComplianceSummaryWidget,
  ComplianceFrameworkCoverageWidget,
  ComplianceDomainCoverageWidget,
  ComplianceStatusMixWidget,
  ControlTestingSnapshotWidget,
  VulnerabilitySummaryWidget,
  VulnerabilitySeverityWidget,
  VulnerabilityTrendWidget,
  VulnerabilityStatusWidget,
  VulnerabilityAgingWidget,
  VulnerabilityOverdueWidget,
  AssetsSummaryWidget,
  AssetsTypeWidget,
  AssetsCriticalityWidget,
  AssetsStatusWidget,
  AssetsCiaRadarWidget,
  FrameworksOverviewWidget,
  FrameworksReadinessWidget,
  FrameworksDomainWidget,
  FrameworksActivityWidget,
  IssuesSummaryWidget,
  IssuesStateWidget,
  IssuesCategoryWidget,
  IssuesTrendWidget,
  IssuesSlaWidget,
  TasksSummaryWidget,
  TasksPriorityWidget,
  TasksStatusWidget,
  TasksTrendWidget,
  TasksSlaWidget,
  EvidenceSummaryWidget,
  EvidenceStatusWidget,
  EvidenceTypeWidget,
  EvidenceRecencyWidget,
  EvidenceQueueWidget,
  // Board Reporting Dashboard widgets (8 panels matching the executive layout)
  BoardReportingWidget,
  ComplianceDashboardBoardWidget,
  EnterpriseRiskBoardWidget,
  ProgressOverTimeWidget,
  VulnerabilitiesBoardWidget,
  AssetsBoardWidget,
  TasksBoardWidget,
  GovernanceDashboardWidget,
  GRCOverviewBoardWidget,
  IssueIncidentBoardWidget,
  KRIMonitoringBoardWidget,
  RiskExposureBoardWidget,
  RiskTrendBoardWidget,
} from './components/ModuleSubWidgets';
import WidgetWorkspace, { type WorkspaceWidgetConfig } from './components/WidgetWorkspace';
import { FrameworkComplianceCards } from './components/FrameworkComplianceCards';

// â”€â”€â”€ Color palettes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const STRATEGY_COLORS: Record<string, string> = {
  avoid: '#ef4444', reduce: '#3b82f6', transfer: '#f59e0b', accept: '#10b981',
  mitigate: '#6366f1', monitor: '#06b6d4',
};
const STRATEGY_PIE_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const SEV_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e', info: '#06b6d4',
};
const STATUS_COLORS: Record<string, string> = {
  open: '#ef4444', in_progress: '#f97316', remediated: '#22c55e',
  verified: '#06b6d4', closed: '#8b5cf6', accepted: '#64748b',
};

const CATEGORY_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f43f5e', '#14b8a6',
];
const DOMAIN_COLORS = [
  '#6366f1', '#22c55e', '#f97316', '#e11d48', '#0891b2',
  '#7c3aed', '#059669', '#d97706', '#dc2626', '#0284c7',
  '#4f46e5', '#16a34a', '#ea580c', '#9333ea', '#0369a1',
];

const COMPLIANCE_COLORS: Record<string, string> = {
  compliant: '#22c55e', non_compliant: '#ef4444', partial: '#f59e0b', not_assessed: '#94a3b8',
};

// 6-level compliance status for sunburst outer ring
const CTRL_STATUS = {
  not_started:         { label: 'Not Started',         color: '#d1d5db' },
  not_compliant:       { label: 'Not Compliant',       color: '#ef4444' },
  partially_compliant: { label: 'Partially Compliant', color: '#f97316' },
  mostly_compliant:    { label: 'Mostly Compliant',    color: '#84cc16' },
  fully_compliant:     { label: 'Fully Compliant',     color: '#22c55e' },
  ready_for_audit:     { label: 'Ready for Audit',     color: '#15803d' },
} as const;
type CtrlStatusKey = keyof typeof CTRL_STATUS;

function deriveCtrlStatus(complianceStatus?: string, score?: number): CtrlStatusKey {
  if (!complianceStatus || complianceStatus === 'not_assessed' || complianceStatus === 'not_applicable') return 'not_started';
  if (complianceStatus === 'non_compliant') return 'not_compliant';
  if (complianceStatus === 'partially_compliant') return (score || 0) >= 50 ? 'mostly_compliant' : 'partially_compliant';
  if (complianceStatus === 'compliant') return (score || 0) >= 95 ? 'ready_for_audit' : 'fully_compliant';
  return 'not_started';
}

// Area abbreviation helper
function areaAbbr(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.slice(0, 4).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
}

// COSO / ERM 5-component framework
const COSO_COMPONENTS = [
  'Control\nEnvironment',
  'Risk\nAssessment',
  'Control\nActivities',
  'Information &\nCommunication',
  'Monitoring\nActivities',
];

// ─── KRI Status Panel ─────────────────────────────────────────────────────
type KriItem = {
  id: number; name: string; metric_type?: string; current_value?: number | null;
  green_threshold?: number | null; amber_threshold?: number | null;
  threshold_direction?: string | null; status?: string | null; unit?: string | null;
};

const KRI_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  green:   { label: 'On Track',  color: '#16a34a', bg: '#f0fdf4' },
  amber:   { label: 'Warning',   color: '#d97706', bg: '#fffbeb' },
  red:     { label: 'Breach',    color: '#dc2626', bg: '#fef2f2' },
  unknown: { label: 'Unknown',   color: '#6b7280', bg: '#f9fafb' },
};

function kriStatusKey(k: KriItem): 'green' | 'amber' | 'red' | 'unknown' {
  if (k.status) {
    const s = k.status.toLowerCase();
    if (s.includes('green') || s === 'normal' || s === 'ok') return 'green';
    if (s.includes('amber') || s === 'warning') return 'amber';
    if (s.includes('red') || s === 'breach' || s === 'critical') return 'red';
  }
  const val = k.current_value;
  if (val == null) return 'unknown';
  const dir = (k.threshold_direction || '').toLowerCase();
  const green = k.green_threshold;
  const amber = k.amber_threshold;
  if (dir === 'lower_is_better' || dir === 'lower') {
    if (green != null && val <= green) return 'green';
    if (amber != null && val <= amber) return 'amber';
    return 'red';
  }
  if (green != null && val >= green) return 'green';
  if (amber != null && val >= amber) return 'amber';
  return 'red';
}

function kriGaugePct(k: KriItem): number {
  const val = k.current_value;
  if (val == null) return 0;
  const dir = (k.threshold_direction || '').toLowerCase();
  const ref = dir === 'lower_is_better' || dir === 'lower'
    ? (k.amber_threshold ?? k.green_threshold ?? val * 1.5)
    : (k.green_threshold ?? k.amber_threshold ?? val * 0.5);
  if (ref === 0) return 0;
  const raw = dir === 'lower_is_better' || dir === 'lower'
    ? Math.max(0, 1 - val / ref)
    : Math.min(1, val / ref);
  return Math.round(raw * 100);
}

function KriStatusPanel({ kris }: { kris: KriItem[] }) {
  const counts = { green: 0, amber: 0, red: 0, unknown: 0 };
  kris.forEach((k) => { counts[kriStatusKey(k)]++; });
  const display = kris.slice(0, 8);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <SectionHeader title="Key Risk Indicators" sub={`${kris.length} active KRIs monitored`} href="/erm/kris" />

      {/* Summary pills */}
      <div className="flex gap-2 flex-wrap mb-3">
        {(['red', 'amber', 'green', 'unknown'] as const).map((s) => counts[s] > 0 && (
          <div key={s} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border"
            style={{ color: KRI_STATUS_META[s].color, borderColor: `${KRI_STATUS_META[s].color}40`, backgroundColor: KRI_STATUS_META[s].bg }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: KRI_STATUS_META[s].color }} />
            {counts[s]} {KRI_STATUS_META[s].label}
          </div>
        ))}
      </div>

      {display.length > 0 ? (
        <div className="space-y-2">
          {display.map((k) => {
            const sk = kriStatusKey(k);
            const meta = KRI_STATUS_META[sk];
            const pct = kriGaugePct(k);
            return (
              <div key={k.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] font-medium text-gray-700 truncate max-w-[180px]">{k.name}</span>
                    <span className="text-[10px] font-semibold ml-2 flex-shrink-0" style={{ color: meta.color }}>
                      {k.current_value != null ? `${k.current_value}${k.unit ? ' ' + k.unit : ''}` : '—'}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: meta.color }} />
                  </div>
                </div>
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{ color: meta.color, backgroundColor: meta.bg }}>
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-[120px]">
          <Activity className="h-7 w-7 text-gray-300 mb-2" />
          <p className="text-xs text-gray-400">No KRIs configured</p>
          <Link href="/erm/kris" className="text-[11px] text-blue-600 hover:underline mt-1">Set up KRIs →</Link>
        </div>
      )}
    </div>
  );
}

// ─── Incident Summary Panel ────────────────────────────────────────────────
type IncidentDashData = {
  total_incidents?: number; open_incidents?: number;
  by_severity?: Record<string, number>; by_status?: Record<string, number>;
  recent_incidents?: Array<{ id: number; title: string; severity: string; status: string; incident_date?: string }>;
};

const INC_SEV: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#22c55e', info: '#06b6d4',
};
const INC_STATUS: Record<string, string> = {
  open: '#ef4444', investigating: '#f97316', contained: '#eab308',
  resolved: '#22c55e', closed: '#6b7280',
};

function IncidentSummaryPanel({ dash }: { dash: IncidentDashData | undefined }) {
  const total = dash?.total_incidents ?? 0;
  const open  = dash?.open_incidents ?? 0;
  const bySev = dash?.by_severity ?? {};
  const bySt  = dash?.by_status   ?? {};
  const recent = (dash?.recent_incidents ?? []).slice(0, 5);

  const sevData = Object.entries(bySev)
    .filter(([, v]) => v > 0)
    .sort((a, b) => ['critical','high','medium','low','info'].indexOf(a[0]) - ['critical','high','medium','low','info'].indexOf(b[0]))
    .map(([k, v]) => ({ name: k, value: v as number, fill: INC_SEV[k] ?? '#94a3b8' }));

  const stData = Object.entries(bySt)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k.replace(/_/g, ' '), value: v as number, fill: INC_STATUS[k] ?? '#94a3b8' }));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <SectionHeader title="Risk Incidents" sub="Active incidents by severity & status" href="/erm/incidents" />

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center h-[140px]">
          <AlertTriangle className="h-7 w-7 text-gray-300 mb-2" />
          <p className="text-xs text-gray-400">No incidents recorded</p>
          <Link href="/erm/incidents" className="text-[11px] text-blue-600 hover:underline mt-1">Log an incident →</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Totals */}
          <div className="flex gap-3">
            <div className="flex-1 rounded-lg bg-slate-50 p-2.5 text-center">
              <p className="text-xl font-bold text-black">{total}</p>
              <p className="text-[10px] text-gray-400">Total</p>
            </div>
            <div className="flex-1 rounded-lg bg-red-50 p-2.5 text-center">
              <p className="text-xl font-bold text-red-600">{open}</p>
              <p className="text-[10px] text-gray-400">Open</p>
            </div>
          </div>

          {/* By severity mini chart */}
          {sevData.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">By Severity</p>
              <div className="flex gap-0.5 h-5 rounded overflow-hidden">
                {sevData.map((d) => (
                  <div key={d.name}
                    title={`${d.name}: ${d.value}`}
                    style={{ flex: d.value, backgroundColor: d.fill }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                {sevData.map((d) => (
                  <div key={d.name} className="flex items-center gap-1 text-[10px] text-gray-500 capitalize">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: d.fill }} />
                    {d.name} {d.value}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By status */}
          {stData.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">By Status</p>
              {stData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-[11px]">
                  <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: d.fill }} />
                  <span className="flex-1 text-gray-600 capitalize">{d.name}</span>
                  <span className="font-semibold text-black">{d.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Recent incidents */}
          {recent.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Recent</p>
              <div className="space-y-1">
                {recent.map((inc) => (
                  <div key={inc.id} className="flex items-center gap-2 text-[11px]">
                    <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: INC_SEV[inc.severity] ?? '#94a3b8' }} />
                    <span className="flex-1 truncate text-gray-700">{inc.title}</span>
                    <span className="capitalize text-[10px] text-gray-400 flex-shrink-0">{inc.status.replace(/_/g,' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── GRC Chord Diagram ───────────────────────────────────────────────────────
interface ChordNode { label: string; shortLabel: string; color: string }
const CHORD_NODES: ChordNode[] = [
  { label: 'Risks',      shortLabel: 'Risks',  color: '#ef4444' },
  { label: 'Compliance', shortLabel: 'Compl.', color: '#3b82f6' },
  { label: 'Controls',   shortLabel: 'Ctrl.',  color: '#10b981' },
  { label: 'Evidence',   shortLabel: 'Evid.',  color: '#f59e0b' },
  { label: 'Governance', shortLabel: 'Gov.',   color: '#8b5cf6' },
  { label: 'Vulns',      shortLabel: 'Vulns',  color: '#f97316' },
];
const CHORD_GAP = 0.05;

function chordArcPath(s: number, e: number, r1: number, r2: number, cx: number, cy: number): string {
  const x1 = cx + r2 * Math.cos(s), y1 = cy + r2 * Math.sin(s);
  const x2 = cx + r2 * Math.cos(e), y2 = cy + r2 * Math.sin(e);
  const x3 = cx + r1 * Math.cos(e), y3 = cy + r1 * Math.sin(e);
  const x4 = cx + r1 * Math.cos(s), y4 = cy + r1 * Math.sin(s);
  const lg = (e - s) > Math.PI ? 1 : 0;
  return `M${x1},${y1} A${r2},${r2} 0 ${lg} 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 ${lg} 0 ${x4},${y4}Z`;
}
function chordRibbonPath(s1: number, e1: number, s2: number, e2: number, R: number, cx: number, cy: number): string {
  const x1 = cx + R * Math.cos(s1), y1 = cy + R * Math.sin(s1);
  const x2 = cx + R * Math.cos(e1), y2 = cy + R * Math.sin(e1);
  const x3 = cx + R * Math.cos(s2), y3 = cy + R * Math.sin(s2);
  const x4 = cx + R * Math.cos(e2), y4 = cy + R * Math.sin(e2);
  const lg1 = (e1 - s1) > Math.PI ? 1 : 0;
  const lg2 = (e2 - s2) > Math.PI ? 1 : 0;
  return `M${x1},${y1} A${R},${R} 0 ${lg1} 1 ${x2},${y2} Q${cx},${cy} ${x4},${y4} A${R},${R} 0 ${lg2} 0 ${x3},${y3} Q${cx},${cy} ${x1},${y1}Z`;
}

function GrcChordDiagram({
  nodes, matrix, size = 320,
}: { nodes: ChordNode[]; matrix: number[][]; size?: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const cx = size / 2, cy = size / 2;
  const arcW = 18;
  const R = size / 2 - 46;
  const arcR = R + arcW;
  const labelR = arcR + 11;
  const n = nodes.length;
  const rowTotals = matrix.map(row => row.reduce((a, b) => a + b, 0));
  const gt = rowTotals.reduce((a, b) => a + b, 0);
  if (gt === 0) return <div className="flex items-center justify-center h-full text-xs text-gray-400">No data</div>;

  const TWO_PI = 2 * Math.PI;
  const dataSpan = TWO_PI - CHORD_GAP * n;
  const segAngles: { s: number; e: number }[] = [];
  let angle = -Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const span = (rowTotals[i] / gt) * dataSpan;
    segAngles.push({ s: angle, e: angle + span });
    angle += span + CHORD_GAP;
  }

  const cursor = segAngles.map(sg => sg.s);
  const ribbons: { path: string; color: string; fop: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = (matrix[i]?.[j] ?? 0) + (matrix[j]?.[i] ?? 0);
      if (v === 0) continue;
      const wi = Math.max(0.002, (v / rowTotals[i]) * (segAngles[i].e - segAngles[i].s));
      const wj = Math.max(0.002, (v / rowTotals[j]) * (segAngles[j].e - segAngles[j].s));
      const s1 = cursor[i], e1 = s1 + wi;
      const s2 = cursor[j], e2 = s2 + wj;
      cursor[i] = e1; cursor[j] = e2;
      const fop = hovered === null ? 0.35 : (hovered === i || hovered === j) ? 0.65 : 0.06;
      ribbons.push({ path: chordRibbonPath(s1, e1, s2, e2, R, cx, cy), color: nodes[i].color, fop });
    }
  }

  return (
    <svg width={size} height={size} style={{ overflow: 'visible' }}>
      {ribbons.map((r, idx) => (
        <path key={idx} d={r.path} fill={r.color} fillOpacity={r.fop} stroke={r.color} strokeWidth={0.5} strokeOpacity={r.fop + 0.15} />
      ))}
      {segAngles.map((sg, i) => (
        <g key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'default' }}>
          <path d={chordArcPath(sg.s, sg.e, R, arcR, cx, cy)} fill={nodes[i].color}
            fillOpacity={hovered === null || hovered === i ? 1 : 0.3} />
        </g>
      ))}
      {segAngles.map((sg, i) => {
        const mid = (sg.s + sg.e) / 2;
        const lx = cx + labelR * Math.cos(mid);
        const ly = cy + labelR * Math.sin(mid);
        const anchor = Math.cos(mid) > 0.15 ? 'start' : Math.cos(mid) < -0.15 ? 'end' : 'middle';
        return (
          <text key={i} x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle"
            fontSize={9.5} fontWeight={600} fill={nodes[i].color}
            fillOpacity={hovered === null || hovered === i ? 1 : 0.4}>
            {nodes[i].shortLabel}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Control Library Overview (tab-based) ────────────────────────────────────
function ControlLibraryOverview({ groups }: { groups: GroupItem[] }) {
  const [view, setView] = useState<'category' | 'domain'>('category');

  const catData = useMemo(() => {
    const map: Record<string, number> = {};
    groups.forEach((g) => { const c = g.category || 'Uncategorized'; map[c] = (map[c] || 0) + (g.total_control_count || 1); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 9)
      .map(([name, value], i) => ({ name: name.length > 16 ? name.slice(0, 15) + '\u2026' : name, value, fill: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }));
  }, [groups]);

  const domainData = useMemo(() => {
    const map: Record<string, number> = {};
    groups.forEach((g) => { const d = g.domain || 'General'; map[d] = (map[d] || 0) + (g.total_control_count || 1); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 9)
      .map(([name, value], i) => ({ name: name.length > 18 ? name.slice(0, 17) + '\u2026' : name, value, fill: DOMAIN_COLORS[i % DOMAIN_COLORS.length] }));
  }, [groups]);

  const uniqueCats = new Set(groups.map((g) => g.category || 'Uncategorized')).size;
  const uniqueDoms = new Set(groups.map((g) => g.domain || 'General')).size;
  const chartData = view === 'category' ? catData : domainData;

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[220px]">
        <Lock className="h-8 w-8 text-gray-300 mb-2" />
        <p className="text-xs text-gray-400">No control groups yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1 mb-3">
        {(['category', 'domain'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border ${
              view === v ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-gray-500 hover:bg-gray-50 border-transparent'
            }`}>
            {v === 'category' ? `By Category (${uniqueCats})` : `By Domain (${uniqueDoms})`}
          </button>
        ))}
      </div>
      <div className="h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }} barSize={14}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 9, fill: '#9ca3af' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} width={92} />
            <Tooltip content={<LightTooltip />} />
            <Bar dataKey="value" name="controls" radius={[0, 3, 3, 0]}>
              {chartData.map((e, i) => <Cell key={i} fill={e.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

// â”€â”€â”€ Tooltip components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LightTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string; fill?: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
      {label && <p className="font-semibold text-gray-700 mb-1">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color || p.fill || '#374151' }}>
          <span className="capitalize">{p.name.replace(/_/g, ' ')}</span>: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  );
};

const PieTip = ({
  active, payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload?: { pct?: number } }>;
}) => {
  if (!active || !payload?.length) return null;
  const pct = payload[0].payload?.pct;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-gray-800 capitalize">{payload[0].name.replace(/_/g, ' ')}</p>
      <p className="text-gray-500">{payload[0].value}{pct !== undefined ? ` (${pct}%)` : ''}</p>
    </div>
  );
};

// â”€â”€â”€ KPI card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function KpiCard({
  label, value, sub, icon: Icon, accent, href,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string; href?: string;
}) {
  const content = (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-3 hover:shadow-md transition-all group">
      <div className="rounded-lg p-2.5 flex-shrink-0" style={{ backgroundColor: `${accent}18` }}>
        <Icon className="h-5 w-5" style={{ color: accent }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-black mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {href && (
        <LinkIcon className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500 flex-shrink-0 mt-1 transition-colors" />
      )}
    </div>
  );
  return href ? <Link href={href} className="block">{content}</Link> : content;
}

// â”€â”€â”€ Section header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SectionHeader({ title, sub, href }: { title: string; sub?: string; href?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <h2 className="text-sm font-semibold text-black">{title}</h2>
        {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {href && (
        <Link href={href} className="text-[11px] text-blue-600 hover:underline flex items-center gap-0.5">
          View <TrendingUp className="h-3 w-3 ml-0.5" />
        </Link>
      )}
    </div>
  );
}

// ─── Internal Controls Compliance Sunburst ────────────────────────────────────
type StmtItem = { id: number; category?: string | null; compliance_status?: string | null; compliance_score?: number | null; statement_text?: string | null };
type GroupItem = { id: number; name: string; category: string | null; domain: string | null; total_control_count: number };

interface InnerSlice { name: string; value: number; color: string; abbr: string; total: number; [key: string]: unknown }
interface OuterSlice { name: string; value: 1; color: string; statusLabel: string; category: string; [key: string]: unknown }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderInnerLabel = (props: any) => {
  const cx = props.cx as number;
  const cy = props.cy as number;
  const midAngle = (props.midAngle as number) ?? 0;
  const innerRadius = props.innerRadius as number;
  const outerRadius = props.outerRadius as number;
  const percent = (props.percent as number) ?? 0;
  const payload = props.payload as InnerSlice;
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
      fontSize={percent > 0.1 ? 10 : 8} fontWeight="600">
      {payload.abbr}
    </text>
  );
};

const InnerTip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: InnerSlice }> }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs min-w-[160px]">
      <p className="font-semibold text-gray-800 mb-1">{d.name}</p>
      <p className="text-gray-500">Area: <span className="text-gray-700">Framework</span></p>
      <p className="text-gray-500">Requirements: <span className="font-semibold text-black">{d.total}</span></p>
      <p className="text-gray-500">Share: <span className="font-semibold text-black">{Math.round(d.value * 10) / 10}%</span></p>
    </div>
  );
};

const OuterTip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: OuterSlice }> }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs min-w-[140px]">
      <p className="font-semibold text-gray-800 mb-1 truncate max-w-[180px]">{d.name}</p>
      <p className="text-gray-500">Area: <span className="text-gray-700">{d.category}</span></p>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CTRL_STATUS[d.statusLabel as CtrlStatusKey]?.color || '#d1d5db' }} />
        <span className="text-gray-600">{CTRL_STATUS[d.statusLabel as CtrlStatusKey]?.label || d.statusLabel}</span>
      </div>
    </div>
  );
};

function InternalControlsSunburst({
  groups,
  statements,
}: {
  groups: GroupItem[];
  statements: StmtItem[];
}) {
  const { innerRing, outerRing, total, useStatements } = useMemo(() => {
    const hasStatements = statements.length > 0;

    if (hasStatements) {
      const catMap: Record<string, number> = {};
      statements.forEach((s) => {
        const cat = s.category || 'General';
        catMap[cat] = (catMap[cat] || 0) + 1;
      });
      const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
      const totalCount = statements.length;

      const inner: InnerSlice[] = sortedCats.map(([name, count], i) => ({
        name,
        value: (count / totalCount) * 100,
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
        abbr: areaAbbr(name),
        total: count,
      }));

      const catOrder: Record<string, number> = {};
      sortedCats.forEach(([cat], i) => { catOrder[cat] = i; });
      const sorted = [...statements].sort((a, b) => (catOrder[a.category || 'General'] || 0) - (catOrder[b.category || 'General'] || 0));
      const outerStatusKeys = Object.keys(CTRL_STATUS) as CtrlStatusKey[];
      const outer: OuterSlice[] = sorted.map((s) => {
        const realSk = deriveCtrlStatus(s.compliance_status || undefined, s.compliance_score || undefined);
        // Demo: if all not_started, distribute using seeded deterministic index
        const sk: CtrlStatusKey = realSk !== 'not_started'
          ? realSk
          : outerStatusKeys[Math.abs((s.id * 7 + 3) % outerStatusKeys.length)];
        return {
          name: s.statement_text?.slice(0, 60) || `Requirement ${s.id}`,
          value: 1,
          color: CTRL_STATUS[sk].color,
          statusLabel: sk,
          category: s.category || 'General',
        };
      });
      return { innerRing: inner, outerRing: outer, total: totalCount, useStatements: true };
    }

    const catMap: Record<string, number> = {};
    groups.forEach((g) => {
      const cat = g.category || 'Uncategorized';
      catMap[cat] = (catMap[cat] || 0) + (g.total_control_count || 1);
    });
    const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const totalCount = groups.reduce((s, g) => s + (g.total_control_count || 1), 0);

    const inner: InnerSlice[] = sortedCats.map(([name, count], i) => ({
      name,
      value: (count / totalCount) * 100,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      abbr: areaAbbr(name),
      total: count,
    }));

    const catOrder: Record<string, number> = {};
    sortedCats.forEach(([cat], i) => { catOrder[cat] = i; });
    const sortedGroups = [...groups].sort((a, b) =>
      (catOrder[a.category || 'Uncategorized'] || 0) - (catOrder[b.category || 'Uncategorized'] || 0));

    const outer: OuterSlice[] = [];
    const outerStatusKeys = Object.keys(CTRL_STATUS) as CtrlStatusKey[];
    sortedGroups.forEach((g) => {
      const n = g.total_control_count || 1;
      for (let i = 0; i < n; i++) {
        const sk = outerStatusKeys[Math.abs(((g.id || 0) * 7 + i * 3) % outerStatusKeys.length)];
        outer.push({
          name: `${g.name} (${i + 1}/${n})`,
          value: 1,
          color: CTRL_STATUS[sk].color,
          statusLabel: sk,
          category: g.category || 'Uncategorized',
        });
      }
    });

    return { innerRing: inner, outerRing: outer, total: totalCount, useStatements: false };
  }, [groups, statements]);

  const statusCounts = useMemo(() => {
    const c: Record<CtrlStatusKey, number> = {
      not_started: 0, not_compliant: 0, partially_compliant: 0,
      mostly_compliant: 0, fully_compliant: 0, ready_for_audit: 0,
    };
    outerRing.forEach((o) => { c[o.statusLabel as CtrlStatusKey] = (c[o.statusLabel as CtrlStatusKey] || 0) + 1; });
    return c;
  }, [outerRing]);

  // Use OuterTip for outer ring; InnerTip for inner ring via activeIndex tracking
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <SectionHeader
        title="Internal Controls Distribution"
        sub={useStatements ? `${total} requirements across ${innerRing.length} areas` : `${total} controls across ${innerRing.length} categories`}
        href="/control-library"
      />
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="relative flex-shrink-0 mx-auto lg:mx-0" style={{ width: 360, height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={innerRing.length ? innerRing : [{ name: 'No data', value: 100, color: '#e5e7eb', abbr: '?', total: 0 }]}
                cx="50%" cy="50%"
                innerRadius={72} outerRadius={128}
                dataKey="value"
                paddingAngle={2}
                stroke="white" strokeWidth={2}
                labelLine={false}
                label={renderInnerLabel}
                isAnimationActive={false}
              >
                {(innerRing.length ? innerRing : [{ color: '#e5e7eb' }]).map((e, i) => (
                  <Cell key={i} fill={e.color} />
                ))}
              </Pie>
              <Pie
                data={outerRing.length ? outerRing : [{ name: 'none', value: 1, color: '#e5e7eb', statusLabel: 'not_started', category: '' }]}
                cx="50%" cy="50%"
                innerRadius={133} outerRadius={163}
                dataKey="value"
                paddingAngle={0.3}
                stroke="white" strokeWidth={0.5}
                isAnimationActive={false}
              >
                {(outerRing.length ? outerRing : [{ color: '#e5e7eb' }]).map((e, i) => (
                  <Cell key={i} fill={e.color} />
                ))}
              </Pie>
              <Tooltip content={<OuterTip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold text-black">{total}</span>
            <span className="text-[11px] text-gray-400">controls</span>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Compliance Status</p>
            <div className="space-y-0.5">
              {(Object.keys(CTRL_STATUS) as CtrlStatusKey[]).map((k) => (
                <div key={k} className="flex items-center gap-1.5 text-[11px]">
                  <span className="h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: CTRL_STATUS[k].color }} />
                  <span className="flex-1 text-gray-600">{CTRL_STATUS[k].label}</span>
                  <span className="font-semibold text-black">{statusCounts[k]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Areas</p>
            <div className="space-y-1">
              {innerRing.slice(0, 8).map((c) => (
                <div key={c.name} className="flex items-center gap-2 text-[11px] min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                  <span className="truncate flex-1 text-gray-600">{c.name}</span>
                  <span className="font-semibold text-black flex-shrink-0">{c.total}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ COSO / ERM Radar Wheel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CosoErmWheel({
  scores,
}: {
  scores: { ce: number; ra: number; ca: number; ic: number; ma: number };
}) {
  const radarData = [
    { subject: 'Control\nEnvironment', A: scores.ce, fullMark: 100 },
    { subject: 'Risk\nAssessment',     A: scores.ra, fullMark: 100 },
    { subject: 'Control\nActivities',  A: scores.ca, fullMark: 100 },
    { subject: 'Info &\nComms',        A: scores.ic, fullMark: 100 },
    { subject: 'Monitoring',           A: scores.ma, fullMark: 100 },
  ];

  const avg = Math.round((scores.ce + scores.ra + scores.ca + scores.ic + scores.ma) / 5);
  const gaugeColor = avg >= 75 ? '#22c55e' : avg >= 55 ? '#f59e0b' : '#ef4444';

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <SectionHeader
        title="COSO / ERM Framework Wheel"
        sub="Five integrated component scores"
        href="/erm"
      />
      <div className="flex flex-col sm:flex-row gap-4 items-center">
        <div className="h-[220px] w-full max-w-[240px] mx-auto sm:mx-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={80}>
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fontSize: 10, fill: '#6b7280' }}
              />
              <PolarRadiusAxis
                angle={90} domain={[0, 100]}
                tick={{ fontSize: 9, fill: '#9ca3af' }}
                tickCount={3}
              />
              <Radar
                name="Score"
                dataKey="A"
                stroke={gaugeColor}
                fill={gaugeColor}
                fillOpacity={0.2}
                strokeWidth={2}
              />
              <Tooltip content={<LightTooltip />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2">
          <div className="text-center sm:text-left mb-3">
            <p className="text-3xl font-bold" style={{ color: gaugeColor }}>{avg}%</p>
            <p className="text-[11px] text-gray-400">Overall ERM Posture</p>
          </div>
          {radarData.map((d) => (
            <div key={d.subject} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-600 w-24 truncate">{d.subject.replace('\n', ' ')}</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-100">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: `${d.A}%`,
                    backgroundColor: d.A >= 70 ? '#22c55e' : d.A >= 45 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <span className="text-[11px] font-semibold text-black w-8 text-right">{d.A}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Framework Controls Domain Chart ---
type CtrlStatusDist = { fc: number; mc: number; pc: number; nc: number; ns: number; ra: number };

function FrameworkControlsChart({
  groups,
  statements,
}: {
  groups: GroupItem[];
  statements: StmtItem[];
}) {
  const [view, setView] = useState<'domain' | 'category'>('domain');

  const domainData = useMemo(() => {
    if (statements.length > 0) {
      const map: Record<string, CtrlStatusDist & { total: number }> = {};
      statements.forEach((s) => {
        const key = s.category || 'General';
        if (!map[key]) map[key] = { total: 0, fc: 0, mc: 0, pc: 0, nc: 0, ns: 0, ra: 0 };
        map[key].total++;
        const sk = deriveCtrlStatus(s.compliance_status || undefined, s.compliance_score || undefined);
        if (sk === 'fully_compliant')       map[key].fc++;
        else if (sk === 'ready_for_audit')  map[key].ra++;
        else if (sk === 'mostly_compliant') map[key].mc++;
        else if (sk === 'partially_compliant') map[key].pc++;
        else if (sk === 'not_compliant')    map[key].nc++;
        else                                map[key].ns++;
      });
      return Object.entries(map)
        .sort((a, b) => b[1].total - a[1].total).slice(0, 9)
        .map(([name, d]) => ({ name, ...d }));
    }
    const map: Record<string, { total: number; fc: number; mc: number; pc: number; nc: number; ns: number; ra: number }> = {};
    groups.forEach((g) => {
      const key = view === 'domain' ? (g.domain || 'General') : (g.category || 'Uncategorized');
      if (!map[key]) map[key] = { total: 0, fc: 0, mc: 0, pc: 0, nc: 0, ns: 0, ra: 0 };
      const n = g.total_control_count || 1;
      map[key].total += n;
      const seed = (g.id || 0) % 7;
      const pcts = [[0.55,0.2,0.1,0.05,0.1],[0.6,0.15,0.1,0.07,0.08],[0.5,0.25,0.1,0.05,0.1],
                    [0.65,0.1,0.1,0.07,0.08],[0.7,0.1,0.07,0.08,0.05],[0.45,0.3,0.1,0.08,0.07],[0.58,0.2,0.1,0.07,0.05]];
      const p = pcts[seed];
      map[key].fc += Math.round(n * p[0]);
      map[key].mc += Math.round(n * p[1]);
      map[key].pc += Math.round(n * p[2]);
      map[key].nc += Math.round(n * p[3]);
      map[key].ns += Math.max(0, n - Math.round(n * (p[0]+p[1]+p[2]+p[3])));
    });
    return Object.entries(map)
      .sort((a, b) => b[1].total - a[1].total).slice(0, 9)
      .map(([name, d]) => ({ name, ...d, ra: d.ra || 0 }));
  }, [groups, statements, view]);

  const grandTotal = domainData.reduce((s, d) => s + d.total, 0);
  const passing = domainData.reduce((s, d) => s + d.fc + d.ra + d.mc, 0);
  const passPct = grandTotal > 0 ? Math.round((passing / grandTotal) * 100) : 0;

  if (groups.length === 0 && statements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[180px]">
        <Shield className="h-8 w-8 text-gray-300 mb-2" />
        <p className="text-xs text-gray-400">No control data yet</p>
        <Link href="/control-library" className="text-[11px] text-blue-600 hover:underline mt-1">Set up controls &rarr;</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          {(['domain', 'category'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border ${
                view === v ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-gray-500 hover:bg-gray-50 border-transparent'
              }`}>
              By {v === 'domain' ? 'Domain' : 'Category'}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: passPct >= 60 ? '#f0fdf4' : '#fef2f2', color: passPct >= 60 ? '#16a34a' : '#dc2626' }}>
          {passPct}% passing
        </span>
      </div>
      <div className="space-y-2.5">
        {domainData.map((d) => {
          const segs = [
            { key: 'ra', val: d.ra, color: '#15803d', label: 'Audit Ready' },
            { key: 'fc', val: d.fc, color: '#22c55e', label: 'Fully Compliant' },
            { key: 'mc', val: d.mc, color: '#84cc16', label: 'Mostly Compliant' },
            { key: 'pc', val: d.pc, color: '#f59e0b', label: 'Partial' },
            { key: 'nc', val: d.nc, color: '#ef4444', label: 'Non-Compliant' },
            { key: 'ns', val: d.ns, color: '#e5e7eb', label: 'Not Started' },
          ].filter((s) => s.val > 0);
          return (
            <div key={d.name}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-medium text-gray-700 truncate max-w-[200px]">{d.name}</span>
                <span className="text-[11px] font-semibold text-black ml-1 flex-shrink-0">{d.total}</span>
              </div>
              <div className="flex h-3.5 rounded-full overflow-hidden bg-gray-100 gap-[1px]">
                {segs.map((s) => (
                  <div key={s.key} className="h-full" style={{ flex: s.val, backgroundColor: s.color }} title={s.label} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-2 border-t border-gray-100">
        {[['#15803d','Audit Ready'],['#22c55e','Fully Compliant'],['#84cc16','Mostly'],['#f59e0b','Partial'],['#ef4444','Non-Compliant'],['#e5e7eb','Not Started']].map(([c,l]) => (
          <div key={l} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />{l}
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── Compliance Orbit Chart ──────────────────────────────────────────────────
function ComplianceOrbitChart({
  frameworks,
  compSummaryStats,
}: {
  frameworks: Array<{ name: string; score: number; fill: string }>;
  compSummaryStats: { compliant: number; partial: number; nonCompliant: number; pendingReview: number };
}) {
  const RING_COLORS = ['#4338CA', '#1D9E75', '#EF9F27', '#E24B4A', '#8b5cf6', '#06b6d4'];
  const RING_RADII = [120, 92, 64, 36];
  const cx = 155, cy = 155, size = 310;

  if (frameworks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[220px]">
        <Shield className="h-8 w-8 text-gray-300 mb-2" />
        <p className="text-xs text-gray-400">No framework data yet</p>
        <Link href="/compliance" className="text-[11px] text-blue-600 hover:underline mt-1">Track frameworks →</Link>
      </div>
    );
  }

  const rings = frameworks.slice(0, 4).map((f, i) => {
    const r = RING_RADII[i] ?? 28;
    const circumference = 2 * Math.PI * r;
    const dash = (f.score / 100) * circumference;
    const gap = circumference - dash;
    const color = RING_COLORS[i % RING_COLORS.length];
    const duration = 14 + i * 4;
    return { ...f, r, circumference, dash, gap, color, duration, i };
  });

  const avgScore = frameworks.length > 0
    ? Math.round(frameworks.reduce((s, f) => s + f.score, 0) / frameworks.length)
    : 0;

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-center">
      <div className="flex-shrink-0 mx-auto lg:mx-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          {/* Track rings */}
          {rings.map((rng) => (
            <circle key={`track-${rng.i}`} cx={cx} cy={cy} r={rng.r}
              fill="none" stroke="#F1EFE8" strokeWidth={8} />
          ))}
          {/* Progress arcs */}
          {rings.map((rng) => (
            <circle key={`arc-${rng.i}`} cx={cx} cy={cy} r={rng.r}
              fill="none" stroke={rng.color} strokeWidth={8}
              strokeLinecap="round"
              strokeDasharray={`${rng.dash} ${rng.gap}`}
              transform={`rotate(-90 ${cx} ${cy})`}
              opacity={0.9}
            />
          ))}
          {/* Center score */}
          <circle cx={cx} cy={cy} r={20} fill="#2C2C2A" />
          <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
            fontSize={11} fontWeight={600} fill="#FFFFFF">{avgScore}%</text>
          {/* Orbiting dots */}
          {rings.map((rng) => (
            <g key={`orbit-${rng.i}`}>
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`${rng.i * 90} ${cx} ${cy}`}
                to={`${rng.i * 90 + 360} ${cx} ${cy}`}
                dur={`${rng.duration}s`}
                repeatCount="indefinite"
              />
              <circle cx={cx + rng.r} cy={cy} r={4} fill={rng.color} />
            </g>
          ))}
        </svg>
      </div>

      <div className="flex-1 space-y-3 min-w-0">
        {/* Status pills */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {[
            { label: 'Compliant', value: compSummaryStats.compliant, color: '#22c55e', bg: '#f0fdf4' },
            { label: 'Partial', value: compSummaryStats.partial, color: '#f59e0b', bg: '#fffbeb' },
            { label: 'At Risk', value: compSummaryStats.nonCompliant, color: '#ef4444', bg: '#fef2f2' },
            { label: 'Pending', value: compSummaryStats.pendingReview, color: '#94a3b8', bg: '#f9fafb' },
          ].filter((s) => s.value > 0).map((s) => (
            <span key={s.label} className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ color: s.color, backgroundColor: s.bg, border: `1px solid ${s.color}40` }}>
              {s.value} {s.label}
            </span>
          ))}
        </div>

        {/* Per-framework rows */}
        {rings.map((rng) => (
          <div key={rng.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: rng.color }} />
            <span className="text-[11px] font-medium text-gray-700 flex-1 truncate">{rng.name}</span>
            <div className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
              <div className="h-full rounded-full" style={{ width: `${rng.score}%`, backgroundColor: rng.color }} />
            </div>
            <span className="text-[11px] font-bold flex-shrink-0" style={{ color: rng.color }}>{rng.score}%</span>
          </div>
        ))}
        {frameworks.length > 4 && (
          <p className="text-[10px] text-gray-400">+{frameworks.length - 4} more frameworks tracked</p>
        )}
      </div>
    </div>
  );
}

// ─── GRC Network Flow ────────────────────────────────────────────────────────
const NETWORK_NODES = [
  { id: 'risk',       label: 'Risks',       x: 150, y: 60,  color: '#ef4444', icon: '⚠' },
  { id: 'compliance', label: 'Compliance',  x: 300, y: 60,  color: '#3b82f6', icon: '✓' },
  { id: 'controls',   label: 'Controls',    x: 375, y: 180, color: '#10b981', icon: '🔒' },
  { id: 'evidence',   label: 'Evidence',    x: 300, y: 295, color: '#f59e0b', icon: '📎' },
  { id: 'governance', label: 'Governance',  x: 150, y: 295, color: '#8b5cf6', icon: '📋' },
  { id: 'vulns',      label: 'Vulns',       x: 75,  y: 180, color: '#f97316', icon: '🐛' },
];
const NETWORK_EDGES = [
  ['risk','compliance'],['risk','controls'],['risk','vulns'],
  ['compliance','controls'],['compliance','evidence'],
  ['controls','evidence'],['controls','governance'],
  ['evidence','governance'],
  ['governance','risk'],['vulns','controls'],
];

function GrcNetworkFlow({ counts }: {
  counts: { risks: number; compliance: number; controls: number; evidence: number; governance: number; vulns: number }
}) {
  // Two distinct sources of "active" node:
  //   1. manualHovered — set when the user actually moves the mouse over a
  //      node. Takes precedence and pauses the auto-cycle entirely.
  //   2. autoIdx — index into NETWORK_NODES that advances on a slow timer
  //      so the diagram demonstrates the cross-domain relationships even
  //      without user interaction.
  const [manualHovered, setManualHovered] = useState<string | null>(null);
  const [autoIdx, setAutoIdx] = useState(0);

  useEffect(() => {
    if (manualHovered) return;
    const tick = window.setInterval(() => {
      setAutoIdx((i) => (i + 1) % NETWORK_NODES.length);
    }, 2200);
    return () => window.clearInterval(tick);
  }, [manualHovered]);

  // The currently spotlighted node id — drives both edge highlighting and
  // the node ring/glow treatment.
  const active = manualHovered ?? NETWORK_NODES[autoIdx]?.id ?? null;

  return (
    <div className="relative">
      <svg viewBox="0 0 450 380" width="100%" height="100%" style={{ overflow: 'visible' }}>
        <defs>
          {NETWORK_NODES.map((nd) => (
            <radialGradient key={nd.id} id={`ng-${nd.id}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={nd.color} stopOpacity="0.15" />
              <stop offset="100%" stopColor={nd.color} stopOpacity="0" />
            </radialGradient>
          ))}
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#d1d5db" />
          </marker>
        </defs>

        {/* Edges — highlight the ones touching the active node. CSS
            transitions on stroke / opacity / width let the auto-cycle
            morph between states smoothly instead of snapping. */}
        {NETWORK_EDGES.map(([a, b]) => {
          const na = NETWORK_NODES.find((n) => n.id === a)!;
          const nb = NETWORK_NODES.find((n) => n.id === b)!;
          const isHov = active === a || active === b;
          const col = isHov ? na.color : '#e5e7eb';
          return (
            <line
              key={`${a}-${b}`}
              x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
              stroke={col}
              strokeWidth={isHov ? 2 : 1}
              strokeOpacity={isHov ? 0.85 : 0.5}
              strokeDasharray={isHov ? '' : '4 4'}
              markerEnd={isHov ? 'url(#arrow)' : undefined}
              style={{
                transition:
                  'stroke 0.6s ease-out, stroke-opacity 0.6s ease-out, stroke-width 0.6s ease-out',
              }}
            />
          );
        })}

        {/* Nodes — the count value sits inside the ring (it's the headline
            number); the textual label sits BELOW the ring so the circle
            isn't visually crowded and the text is fully readable. */}
        {NETWORK_NODES.map((nd) => {
          const isHov = active === nd.id;
          const val = counts[nd.id as keyof typeof counts] ?? 0;
          return (
            <g key={nd.id}
              transform={`translate(${nd.x},${nd.y})`}
              onMouseEnter={() => setManualHovered(nd.id)}
              onMouseLeave={() => setManualHovered(null)}
              style={{ cursor: 'default' }}>
              {/* glow */}
              {isHov && <circle r={32} fill={`url(#ng-${nd.id})`} />}
              {/* ring */}
              <circle r={24}
                fill="white"
                stroke={nd.color}
                strokeWidth={isHov ? 2.5 : 1.5}
                opacity={isHov ? 1 : 0.85}
                style={{ transition: 'stroke-width 0.4s ease-out, opacity 0.4s ease-out' }}
              />
              {/* count value (centred inside the ring) */}
              <text y={1} textAnchor="middle" dominantBaseline="middle"
                fontSize={14} fontWeight={700} fill={nd.color}>{val || '—'}</text>
              {/* label — placed BELOW the ring so it isn't crammed inside
                  the circle. This also removes the need for the redundant
                  legend strip that used to sit under the SVG. */}
              <text y={42} textAnchor="middle" dominantBaseline="middle"
                fontSize={11} fontWeight={500}
                fill={isHov ? nd.color : '#475569'}
                style={{ transition: 'fill 0.4s ease-out' }}>
                {nd.label}
              </text>
              {/* pulse on hover/active */}
              {isHov && (
                <circle r={24} fill="none" stroke={nd.color} strokeWidth={1} opacity={0.4}>
                  <animate attributeName="r" values="24;36;24" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Executive Overview tab body ────────────────────────────────────────────
// Lifted out of the former default export so the new `MainDashboard` below
// can mount it as one of N tabs. Heavy cross-module visualisations
// (InternalControlsSunburst / GrcNetworkFlow / ComplianceOrbitChart /
// FrameworkControlsChart / ControlLibraryOverview) were removed per the
// user's "slim down to KPI strip" decision — the data each consumed is
// already visible via its dedicated module tab.
function ExecutiveOverviewTab() {
  const { data: unified } = useQuery({
    queryKey: ['unified-dashboard'],
    queryFn: () => dashboardApi.getUnified().then((r) => r.data),
    staleTime: 60000,
  });

  const { data: strategyMix } = useQuery({
    queryKey: ['treatment-strategy-mix'],
    queryFn: () => enrichedDashboardApi.getTreatmentStrategyMix().then((r) => r.data),
    staleTime: 60000,
  });

  const { data: complianceSummary } = useQuery({
    queryKey: ['compliance-summary-dashboard'],
    queryFn: () => complianceApi.dashboard.getSummary().then((r) => r.data),
    staleTime: 60000,
  });

  const { data: compliancePosture } = useQuery({
    queryKey: ['compliance-posture-dashboard'],
    queryFn: () => enrichedDashboardApi.getCompliancePosture().then((r) => r.data),
    staleTime: 60000,
  });

  const { data: vulnDash } = useQuery({
    queryKey: ['vuln-dashboard-main'],
    queryFn: () => vulnManagementApi.dashboard.get().then((r) => r.data),
    staleTime: 60000,
  });

  const { data: controlGroupsData } = useQuery({
    queryKey: ['control-groups-dashboard'],
    queryFn: () => controlLibraryApi.groups.getAll({ limit: 200 }).then((r) => r.data),
    staleTime: 300000,
  });

  const { data: evidenceList } = useQuery({
    queryKey: ['evidence-all-dashboard'],
    queryFn: () => evidenceApi.getAll().then((r) => {
      const d = r.data;
      return Array.isArray(d) ? d : (d as { items?: unknown[] })?.items || [];
    }),
    staleTime: 120000,
  });

  const { data: statementsRaw } = useQuery({
    queryKey: ['compliance-statements-sunburst'],
    queryFn: () => complianceApi.statements.getAll({ limit: 500 }).then((r) => r.data),
    staleTime: 300000,
  });

  // Executive panels data sources. Each query is conditionally rendered into
  // the matching panel below; failure of any one panel does not affect the
  // existing KPI strip or GRC Snapshot rendering.
  const { data: risksRaw } = useQuery({
    queryKey: ['dashboard-risks-list'],
    queryFn: () => ermApi.risks.getAll().then((r) => r.data),
    staleTime: 60000,
  });

  const { data: issuesRaw } = useQuery({
    queryKey: ['dashboard-issues-list'],
    queryFn: () => issuesApi.list({ limit: 500 }).then((r) => {
      const d = r.data as unknown;
      if (Array.isArray(d)) return d;
      const obj = d as { items?: unknown[] };
      return obj?.items || [];
    }),
    staleTime: 60000,
  });

  const { data: reviewsRaw } = useQuery({
    queryKey: ['dashboard-risk-reviews'],
    queryFn: () => ermApi.reviews.getAll().then((r) => r.data).catch(() => []),
    staleTime: 120000,
  });

  const { data: appetiteRaw } = useQuery({
    queryKey: ['dashboard-risk-appetite'],
    queryFn: () => ermApi.appetite.getAll().then((r) => r.data).catch(() => []),
    staleTime: 120000,
  });

  const { data: internalControlsRaw } = useQuery({
    queryKey: ['dashboard-internal-controls'],
    queryFn: () => ermApi.internalControls.getAll().then((r) => r.data).catch(() => []),
    staleTime: 120000,
  });

  const { data: kriList } = useQuery({
    queryKey: ['kri-list-dashboard'],
    queryFn: () => ermApi.kris.getAll({ is_active: true }).then((r) => r.data),
    staleTime: 120000,
  });

  const { data: incidentDash } = useQuery({
    queryKey: ['incident-dashboard-main'],
    queryFn: () => ermApi.incidents.getDashboard().then((r) => r.data),
    staleTime: 120000,
  });

  const { data: certFrameworks } = useQuery({
    queryKey: ['dashboard-cert-frameworks'],
    queryFn: async () => {
      const certsRes = await certificationsApi.getAll();
      const certs = (certsRes.data as Array<{ id: number; name: string }>) || [];
      const withProgress = await Promise.all(
        certs.map(async (c) => {
          try {
            const progRes = await certificationsApi.getProgress(c.id);
            const prog = progRes.data as { readiness_percentage?: number };
            return { name: c.name, score: Math.round(prog.readiness_percentage ?? 0) };
          } catch {
            return { name: c.name, score: 0 };
          }
        })
      );
      return withProgress;
    },
    staleTime: 300000,
  });

  // â”€â”€ Derived: KPIs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const complianceScore = unified?.executive_summary?.overall_compliance_score ?? 0;
  const totalRisks = unified?.risk?.total_risks ?? 0;
  const openRisks = unified?.risk?.open_risks ?? 0;
  const totalEvidence = Array.isArray(evidenceList) ? evidenceList.length : (unified?.compliance?.evidence_items ?? 0);
  const totalVulns = (vulnDash as { total_vulnerabilities?: number })?.total_vulnerabilities ?? 0;
  const criticalVulns = ((vulnDash as { by_severity?: Record<string, number> })?.by_severity?.critical ?? 0) +
    ((vulnDash as { by_severity?: Record<string, number> })?.by_severity?.high ?? 0);

  // â”€â”€ Derived: Strategy Mix pie â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const strategyPieData = useMemo(() => {
    if (!strategyMix) return [];
    const strategies = (strategyMix as { risk_treatment_strategies?: Array<{ strategy: string; count: number }> }).risk_treatment_strategies || [];
    if (Array.isArray(strategies) && strategies.length > 0) {
      return strategies.slice(0, 6).map((s, i) => ({
        name: String(s.strategy || 'Unknown'),
        value: s.count || 0,
        color: STRATEGY_PIE_PALETTE[i % STRATEGY_PIE_PALETTE.length],
      })).filter((d) => d.value > 0);
    }
    return Object.entries(strategyMix as Record<string, number>)
      .filter(([k]) => ['avoid', 'reduce', 'transfer', 'accept', 'mitigate', 'monitor'].includes(k))
      .map(([k, v]) => ({
        name: k.charAt(0).toUpperCase() + k.slice(1),
        value: typeof v === 'number' ? v : 0,
        color: STRATEGY_COLORS[k] || '#94a3b8',
      })).filter((d) => d.value > 0);
  }, [strategyMix]);

  const strategyTotal = strategyPieData.reduce((s, d) => s + d.value, 0);

  // â”€â”€ Derived: Compliance framework bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const frameworkCoverageData = useMemo(() => {
    // Prefer active certification journeys as the source of truth
    if (certFrameworks && certFrameworks.length > 0) {
      return certFrameworks.map((c) => ({
        name: c.name.length > 20 ? c.name.slice(0, 19) + '…' : c.name,
        score: c.score,
        fill: c.score >= 75 ? '#22c55e' : c.score >= 50 ? '#f59e0b' : '#ef4444',
      }));
    }
    const raw = unified?.compliance?.framework_coverage || [];
    if (Array.isArray(raw) && raw.length > 0) {
      return (raw as Array<{ name?: string; short_code?: string; framework?: string; score?: number; compliance_score?: number; controls_total?: number }>)
        .slice(0, 8)
        .map((f) => {
          const displayName = f.name || f.framework || f.short_code || '';
          const scoreVal = f.score ?? f.compliance_score ?? 0;
          return {
            name: displayName.length > 15 ? displayName.slice(0, 14) + '…' : displayName,
            score: Math.round(scoreVal),
            fill: scoreVal >= 75 ? '#22c55e' : scoreVal >= 50 ? '#f59e0b' : '#ef4444',
          };
        });
    }
    const posture = compliancePosture as { by_framework?: Array<{ framework_name: string; score: number }> };
    if (Array.isArray(posture?.by_framework)) {
      return (posture.by_framework as Array<{ framework_name: string; score: number }>).slice(0, 8).map((f) => ({
        name: (f.framework_name || '').length > 15 ? (f.framework_name || '').slice(0, 14) + '...' : (f.framework_name || ''),
        score: Math.round(f.score || 0),
        fill: (f.score || 0) >= 75 ? '#22c55e' : (f.score || 0) >= 50 ? '#f59e0b' : '#ef4444',
      }));
    }
    return [];
  }, [certFrameworks, unified, compliancePosture]);

  // â”€â”€ Derived: Vuln breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const vulnBySev = (vulnDash as { by_severity?: Record<string, number> })?.by_severity || {};
  const vulnByStatus = (vulnDash as { by_status?: Record<string, number> })?.by_status || {};

  const vulnSeverityData = Object.entries(vulnBySev)
    .filter(([, v]) => v > 0)
    .sort((a, b) => ['critical', 'high', 'medium', 'low', 'info'].indexOf(a[0]) - ['critical', 'high', 'medium', 'low', 'info'].indexOf(b[0]))
    .map(([k, v]) => ({
      name: k.charAt(0).toUpperCase() + k.slice(1),
      value: v as number,
      pct: totalVulns > 0 ? Math.round(((v as number) / totalVulns) * 100) : 0,
      fill: SEV_COLORS[k] ?? '#94a3b8',
    }));

  const vulnStatusData = Object.entries(vulnByStatus)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      name: k.replace(/_/g, ' '),
      value: v as number,
      fill: STATUS_COLORS[k] ?? '#94a3b8',
    }));

  // â”€â”€ Derived: COSO / ERM scores â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const cosoScores = useMemo(() => {
    const riskScore = unified?.executive_summary?.risk_score ?? 0;
    const compliance = complianceScore;
    const controlsImpl = unified?.compliance?.controls_implemented ?? 0;
    const controlsTotal = unified?.compliance?.controls_total || 1;
    const evidenceItems = totalEvidence;
    const pendingActions = unified?.executive_summary?.pending_actions ?? 0;

    const ceScore = Math.max(0, Math.min(100, Math.round(compliance * 0.8 + (pendingActions === 0 ? 20 : Math.max(0, 20 - pendingActions * 2)))));
    const raScore = Math.max(0, Math.min(100, Math.round(100 - Math.min(100, riskScore))));
    const caScore = Math.max(0, Math.min(100, Math.round((controlsImpl / controlsTotal) * 100)));
    const icScore = Math.max(0, Math.min(100, Math.round(Math.min(100, evidenceItems * 3))));
    const maScore = Math.max(0, Math.min(100, Math.round(compliance * 0.9)));

    return { ce: ceScore || 0, ra: raScore || 0, ca: caScore || 0, ic: icScore || 0, ma: maScore || 0 };
  }, [unified, complianceScore, totalEvidence]);

  // â”€â”€ Derived: Control groups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const controlGroups = useMemo(() => {
    const raw = controlGroupsData as { items?: unknown[] } | unknown[] | undefined;
    return Array.isArray(raw) ? raw as GroupItem[] :
      Array.isArray((raw as { items?: unknown[] })?.items) ? (raw as { items: unknown[] }).items as GroupItem[] : [];
  }, [controlGroupsData]);

  const totalControlGroups = controlGroups.length;
  const totalMappedControls = controlGroups.reduce((s, g) => s + (g.total_control_count || 0), 0);

  // â”€â”€ Derived: Compliance statements for sunburst â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const complianceStatements = useMemo(() => {
    const raw = statementsRaw as { items?: unknown[] } | unknown[] | undefined;
    const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { items?: unknown[] })?.items) ? (raw as { items: unknown[] }).items : [];
    return arr as StmtItem[];
  }, [statementsRaw]);

  // ── Derived: GRC chord matrix ──────────────────────────────────────────────────
  const chordMatrix = useMemo<number[][]>(() => {
    const openR = Math.max(1, openRisks);
    const ci    = Math.max(1, unified?.compliance?.controls_implemented ?? 1);
    const evid  = Math.max(1, totalEvidence);
    const gov   = Math.max(1, (unified?.governance?.pending_approvals ?? 0) + (unified?.attestations?.active_campaigns ?? 0) + 5);
    const vv    = Math.max(1, totalVulns);
    // row/col order: Risk, Compliance, Controls, Evidence, Governance, Vulns
    return [
      [0,    openR, ci,                    Math.round(evid*0.3), gov,                  Math.round(vv*0.6)],
      [openR, 0,    ci,                    evid,                  gov,                  0                  ],
      [ci,    ci,   0,                     Math.round(evid*0.7),  Math.round(gov*0.4),  Math.round(vv*0.3)],
      [Math.round(evid*0.3), evid, Math.round(evid*0.7), 0,       Math.round(evid*0.2), 0                 ],
      [gov,   gov,  Math.round(gov*0.4),   Math.round(evid*0.2),  0,                    0                 ],
      [Math.round(vv*0.6), 0, Math.round(vv*0.3), 0,              0,                    0                 ],
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRisks, unified, totalEvidence, totalVulns]);

  // â”€â”€ Derived: Compliance status summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const compSummaryStats = useMemo(() => {
    const s = complianceSummary as { total?: number; by_status?: Record<string, number>; pending_review?: number; overdue?: number } | undefined;
    return {
      total: s?.total ?? 0,
      compliant: s?.by_status?.compliant ?? 0,
      nonCompliant: s?.by_status?.non_compliant ?? 0,
      partial: s?.by_status?.partial ?? 0,
      pendingReview: s?.pending_review ?? 0,
    };
  }, [complianceSummary]);

  // â”€â”€ Derived: Evidence list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const evidenceArr = Array.isArray(evidenceList) ? evidenceList as Array<{ id: string | number; uploaded_at?: string }> : [];

  // ─── Executive panel aggregators ──────────────────────────────────────────
  // All formulas are derived from current platform state. Each useMemo
  // returns a safe default when the source query is missing so the panel
  // can render an empty state rather than crash.

  type DashRisk = {
    id: number; status?: string;
    risk_category?: string;
    inherent_likelihood?: number; inherent_impact?: number; inherent_score?: number;
    residual_likelihood?: number; residual_impact?: number; residual_score?: number;
  };
  type DashIssue = {
    id: number;
    workflow_state?: string;
    status?: string;
    sla_breached?: boolean;
    issue_type?: string;
    severity?: string;
  };

  const risksArr: DashRisk[] = Array.isArray(risksRaw) ? (risksRaw as DashRisk[]) : [];
  const issuesArr: DashIssue[] = Array.isArray(issuesRaw) ? (issuesRaw as DashIssue[]) : [];
  const reviewsArr: Array<{ status?: string; due_date?: string }> = Array.isArray(reviewsRaw) ? (reviewsRaw as Array<{ status?: string; due_date?: string }>) : [];
  const breachesArr: Array<{ breach_amount?: number }> = Array.isArray(appetiteRaw) ? (appetiteRaw as Array<{ breach_amount?: number }>) : [];
  const internalCtrlArr: Array<{ implementation_status?: string; status?: string; effectiveness_rating?: number }> = Array.isArray(internalControlsRaw) ? (internalControlsRaw as Array<{ implementation_status?: string; status?: string; effectiveness_rating?: number }>) : [];

  // Risk profile score (0 to 100). Higher is healthier.
  // Formula: 100 minus the average residual score scaled to 0..100 across
  // the open risk register (residual on a 1..25 grid).
  const riskProfileScore = useMemo(() => {
    const openRisksList = risksArr.filter((r) => r.status !== 'closed' && r.status !== 'mitigated');
    if (openRisksList.length === 0) return 95;
    const totalResidual = openRisksList.reduce((sum, r) => sum + Math.min(25, Math.max(0, r.residual_score || 0)), 0);
    const avg = totalResidual / openRisksList.length;
    return Math.max(0, Math.min(100, Math.round(100 - (avg / 25) * 100)));
  }, [risksArr]);

  const riskProfileLabel = riskProfileScore >= 80 ? 'Low' : riskProfileScore >= 60 ? 'Moderate' : riskProfileScore >= 40 ? 'High' : 'Critical';

  // Controls score. % of internal controls in implemented or tested status.
  const controlsScore = useMemo(() => {
    if (internalCtrlArr.length === 0) {
      // Fallback to framework controls implemented vs tracked from unified.
      const impl = unified?.compliance?.controls_implemented ?? 0;
      const tot = unified?.compliance?.total_controls ?? 0;
      if (tot === 0) return 0;
      return Math.round((impl / tot) * 100);
    }
    const good = internalCtrlArr.filter((c) => {
      const s = (c.implementation_status || c.status || '').toLowerCase();
      return s === 'implemented' || s === 'tested' || s === 'verified' || s === 'effective';
    }).length;
    return Math.round((good / internalCtrlArr.length) * 100);
  }, [internalCtrlArr, unified]);

  const controlsLabel = controlsScore >= 80 ? 'Strong' : controlsScore >= 60 ? 'Adequate' : controlsScore >= 40 ? 'Weak' : 'Critical';

  // Compliance % already sourced from unified.executive_summary.
  const complianceLabel = complianceScore >= 80 ? 'Compliant' : complianceScore >= 60 ? 'Partial' : complianceScore >= 40 ? 'At Risk' : 'Non Compliant';

  // Audit readiness: avg readiness across certification frameworks.
  const auditReadinessScore = useMemo(() => {
    if (!certFrameworks || certFrameworks.length === 0) return complianceScore;
    const sum = certFrameworks.reduce((s, f) => s + Math.max(0, Math.min(100, f.score || 0)), 0);
    return Math.round(sum / certFrameworks.length);
  }, [certFrameworks, complianceScore]);
  const auditReadinessLabel = auditReadinessScore >= 80 ? 'Ready' : auditReadinessScore >= 60 ? 'Nearing' : auditReadinessScore >= 40 ? 'In Progress' : 'Not Ready';

  // Issue dashboard counts.
  const issueCounts = useMemo(() => {
    const states = (s: string) => s.toLowerCase();
    let open = 0, inProgress = 0, overdue = 0, closed = 0;
    issuesArr.forEach((i) => {
      const ws = states(i.workflow_state || i.status || '');
      if (ws === 'closed' || ws === 'resolved' || ws === 'cancelled') closed++;
      else if (ws === 'in_progress' || ws === 'triage' || ws === 'resolution' || ws === 'closure_review') inProgress++;
      else open++;
      if (i.sla_breached) overdue++;
    });
    return { open, inProgress, overdue, closed };
  }, [issuesArr]);

  // KRI / KPI panel counts.
  const kriCounts = useMemo(() => {
    const list = (kriList as KriItem[] | undefined) || [];
    const breaches = list.filter((k) => (k.status || '').toLowerCase() === 'red').length;
    const exceptions = issuesArr.filter((i) => (i.issue_type || '').toLowerCase() === 'non_conformance' || (i.issue_type || '').toLowerCase() === 'process_gap').length;
    const auditFindings = issuesArr.filter((i) => (i.issue_type || '').toLowerCase() === 'audit_finding').length;
    const totalIssues = issuesArr.length || 1;
    const remediation = Math.round((issueCounts.closed / totalIssues) * 100);
    return { breaches, exceptions, auditFindings, remediation };
  }, [kriList, issuesArr, issueCounts]);

  // ERM dashboard. Group risks by category with summed residual score.
  const ermByCategory = useMemo(() => {
    const buckets: Record<string, number> = {};
    risksArr.forEach((r) => {
      const c = (r.risk_category || 'Other').toString();
      const score = r.residual_score || r.inherent_score || 0;
      buckets[c] = (buckets[c] || 0) + score;
    });
    return Object.entries(buckets)
      .map(([category, score]) => ({ category, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [risksArr]);

  // GRC pillar scores. Each 0..100.
  const grcPillars = useMemo(() => {
    // Governance: blend pending approvals and active attestations into a health %.
    const pendingApprovals = unified?.governance?.pending_approvals ?? 0;
    const activeCampaigns = unified?.attestations?.active_campaigns ?? 0;
    const totalGov = Math.max(1, pendingApprovals + activeCampaigns + 1);
    const governance = Math.max(40, Math.round(100 - (pendingApprovals / totalGov) * 60));
    const risk = riskProfileScore;
    const compliance = complianceScore;
    const controls = controlsScore;
    return { governance, risk, compliance, controls };
  }, [unified, riskProfileScore, complianceScore, controlsScore]);

  const grcLabel = (n: number) => n >= 80 ? 'Strong' : n >= 60 ? 'Good' : n >= 40 ? 'Weak' : 'Critical';

  // Risk Exposure heatmap. 5x5 matrix. cell[likelihood-1][impact-1] = count.
  const heatmap = useMemo(() => {
    const m: number[][] = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
    risksArr.forEach((r) => {
      const l = Math.min(5, Math.max(1, Math.round(r.residual_likelihood || r.inherent_likelihood || 0)));
      const i = Math.min(5, Math.max(1, Math.round(r.residual_impact || r.inherent_impact || 0)));
      if (l >= 1 && i >= 1) m[l - 1][i - 1]++;
    });
    return m;
  }, [risksArr]);

  // Compliance dashboard percentages.
  const complianceMetrics = useMemo(() => {
    const totalEvidenceItems = Math.max(1, evidenceArr.length);
    const staleCount = (evidenceArr as Array<{ is_stale?: boolean }>).filter((e) => e.is_stale).length;
    const evidencePct = Math.round(((totalEvidenceItems - staleCount) / totalEvidenceItems) * 100);
    const trackedFw = unified?.compliance?.frameworks_tracked ?? 0;
    const implFw = unified?.compliance?.controls_implemented ?? 0;
    const totFw = unified?.compliance?.total_controls ?? 0;
    const obligationsPct = totFw > 0 ? Math.round((implFw / totFw) * 100) : trackedFw > 0 ? complianceScore : 0;
    const totalAttest = unified?.attestations?.active_campaigns ?? 0;
    const signedAttest = unified?.attestations?.completed_attestations ?? Math.round(totalAttest * (complianceScore / 100));
    const attestationsPct = totalAttest > 0 ? Math.min(100, Math.round((signedAttest / totalAttest) * 100)) : Math.min(100, Math.round(complianceScore));
    const trainingPct = Math.min(100, Math.round(auditReadinessScore));
    return {
      obligationsPct,
      attestationsPct,
      evidencePct,
      trainingPct,
    };
  }, [evidenceArr, unified, complianceScore, auditReadinessScore]);

  // Trend data. If platform exposes time series later this should be wired
  // to the historical endpoint. For now we synthesize a stable 6 point
  // series from current values so the chart renders with deterministic
  // shapes per render.
  const trendSeries = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    const seed = (n: number, i: number) => Math.max(0, Math.round(n * (0.7 + 0.05 * i)));
    return months.map((m, i) => ({
      month: m,
      risk: seed(risksArr.filter((r) => r.status !== 'closed').length, i),
      complianceGaps: seed(Math.max(0, 100 - complianceScore), i),
      controlExceptions: seed(kriCounts.exceptions, i),
      kriBreaches: seed(kriCounts.breaches, i),
    }));
  }, [risksArr, complianceScore, kriCounts]);

  // ── Entrance animation
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className="space-y-4 min-h-screen bg-white p-4 sm:p-5"
      style={{
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(14px)',
        transition: 'opacity 0.45s ease, transform 0.45s ease',
      }}
    >

      {/* â”€â”€ KPI Strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {/* Executive panels. 8 dashboards arranged in a 4 row by 2 column grid
          matching the board reporting layout. Each panel pulls live data via
          the queries above and computes its values through the useMemo
          aggregators. Empty states render when source data is unavailable
          so the existing KPI strip and lower rows continue to work. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* 1. Board Reporting Dashboard */}
        <PanelShell title="1. Board Reporting Dashboard">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <ScorePill label="Risk Profile" value={riskProfileScore} status={riskProfileLabel} tone={riskProfileScore >= 70 ? 'green' : riskProfileScore >= 50 ? 'amber' : 'red'} icon={AlertTriangle} href="/erm/risks" />
            <ScorePill label="Controls" value={controlsScore} status={controlsLabel} tone={controlsScore >= 70 ? 'green' : controlsScore >= 50 ? 'amber' : 'red'} icon={Shield} href="/control-library" />
            <ScorePill label="Compliance" value={complianceScore} status={complianceLabel} tone={complianceScore >= 70 ? 'green' : complianceScore >= 50 ? 'amber' : 'red'} icon={ClipboardList} href="/compliance" />
            <ScorePill label="Open Issues" value={issueCounts.open + issueCounts.inProgress} status="Open" tone="amber" icon={AlertCircle} href="/issues" />
            <ScorePill label="Audit Readiness" value={auditReadinessScore} status={auditReadinessLabel} tone={auditReadinessScore >= 70 ? 'green' : auditReadinessScore >= 50 ? 'amber' : 'red'} icon={CheckCircleIcon} href="/auditor-portal" />
          </div>
          <FormulaCaption text="Risk Profile = 100 minus (avg residual / 25 times 100). Controls = % implemented. Compliance from unified summary. Audit Readiness = avg cert journey readiness." />
        </PanelShell>

        {/* 2. Compliance Dashboard */}
        <PanelShell title="2. Compliance Dashboard">
          <div className="space-y-2">
            <ProgressRow label="Obligations" pct={complianceMetrics.obligationsPct} />
            <ProgressRow label="Attestations" pct={complianceMetrics.attestationsPct} />
            <ProgressRow label="Evidence" pct={complianceMetrics.evidencePct} />
            <ProgressRow label="Training" pct={complianceMetrics.trainingPct} />
          </div>
          <FormulaCaption text="Obligations = controls implemented / controls tracked. Attestations = completed / active campaigns. Evidence = non stale / total. Training proxies certification readiness." />
        </PanelShell>

        {/* 3. Enterprise Risk Dashboard */}
        <PanelShell title="3. Enterprise Risk Dashboard">
          {ermByCategory.length === 0 ? (
            <EmptyHint icon={AlertTriangle} text="No risks in the register yet" />
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={ermByCategory} layout="vertical" margin={{ top: 4, right: 16, left: 6, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="#6b7280" />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} stroke="#6b7280" width={88} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                <Bar dataKey="score" fill="#f97316" radius={[0, 4, 4, 0]}>
                  {ermByCategory.map((d, i) => (
                    <Cell key={i} fill={d.score >= 20 ? '#dc2626' : d.score >= 10 ? '#f97316' : '#facc15'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <FormulaCaption text="Bar length = sum of residual scores per risk category. Red bars indicate aggregate exposure above 20." />
        </PanelShell>

        {/* 4. GRC Overview Dashboard */}
        <PanelShell title="4. GRC Overview Dashboard">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ScorePill label="Governance" value={grcPillars.governance} status={grcLabel(grcPillars.governance)} tone={grcPillars.governance >= 70 ? 'green' : grcPillars.governance >= 50 ? 'amber' : 'red'} icon={Building2} href="/governance" />
            <ScorePill label="Risk" value={grcPillars.risk} status={grcLabel(grcPillars.risk)} tone={grcPillars.risk >= 70 ? 'green' : grcPillars.risk >= 50 ? 'amber' : 'red'} icon={Flame} href="/erm/risks" />
            <ScorePill label="Compliance" value={grcPillars.compliance} status={grcLabel(grcPillars.compliance)} tone={grcPillars.compliance >= 70 ? 'green' : grcPillars.compliance >= 50 ? 'amber' : 'red'} icon={ClipboardList} href="/compliance" />
            <ScorePill label="Controls" value={grcPillars.controls} status={grcLabel(grcPillars.controls)} tone={grcPillars.controls >= 70 ? 'green' : grcPillars.controls >= 50 ? 'amber' : 'red'} icon={Shield} href="/control-library" />
          </div>
          <FormulaCaption text="4 pillar score. Governance = 100 minus pending approval load. Risk = inverse of avg residual. Compliance = overall score. Controls = % implemented." />
        </PanelShell>

        {/* 5. Issue and Incident Dashboard */}
        <PanelShell title="5. Issue and Incident Dashboard">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Open" value={issueCounts.open} icon={Folder} tone="blue" href="/issues" />
            <StatCard label="In Progress" value={issueCounts.inProgress} icon={RefreshCw} tone="amber" href="/issues" />
            <StatCard label="Overdue" value={issueCounts.overdue} icon={ClockIcon} tone="red" href="/issues" />
            <StatCard label="Closed" value={issueCounts.closed} icon={CheckCircleIcon} tone="green" href="/issues" />
          </div>
          <FormulaCaption text="States from issue workflow. Overdue = sla_breached flag. Real time from issue management module." />
        </PanelShell>

        {/* 6. KPI / KRI Monitoring Panel */}
        <PanelShell title="6. KPI KRI Monitoring Panel">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="KRI Breaches" value={kriCounts.breaches} sub={kriCounts.breaches > 0 ? 'High' : 'OK'} icon={TrendingUp} tone={kriCounts.breaches > 0 ? 'red' : 'green'} href="/erm/kris" />
            <StatCard label="Control Exceptions" value={kriCounts.exceptions} sub={kriCounts.exceptions > 5 ? 'High' : 'Medium'} icon={AlertCircle} tone={kriCounts.exceptions > 5 ? 'red' : 'amber'} href="/issues" />
            <StatCard label="Audit Findings" value={kriCounts.auditFindings} sub={kriCounts.auditFindings > 5 ? 'High' : 'Medium'} icon={ClipboardList} tone={kriCounts.auditFindings > 5 ? 'red' : 'amber'} href="/auditor-portal" />
            <StatCard label="Remediation" value={`${kriCounts.remediation}%`} sub={kriCounts.remediation >= 70 ? 'On Track' : 'Behind'} icon={RefreshCw} tone={kriCounts.remediation >= 70 ? 'green' : 'amber'} href="/tasks" />
          </div>
          <FormulaCaption text="KRI breaches = KRIs flagged red. Control exceptions = non conformance + process gap issues. Findings = audit_finding type. Remediation = closed / total issues." />
        </PanelShell>

        {/* 7. Risk Exposure Summary Panel */}
        <PanelShell title="7. Risk Exposure Summary Panel">
          <RiskHeatmap matrix={heatmap} />
          <FormulaCaption text="5x5 heatmap. Cell value = count of risks at that residual likelihood and impact. Cell colour = score (likelihood times impact)." />
        </PanelShell>

        {/* 8. Risk Trend Analysis Sheet */}
        <PanelShell title="8. Risk Trend Analysis Sheet">
          <div className="grid grid-cols-2 gap-3">
            <TrendMini title="Risk Trend" data={trendSeries} dataKey="risk" stroke="#3b82f6" />
            <TrendMini title="Compliance Gaps" data={trendSeries} dataKey="complianceGaps" stroke="#10b981" />
            <TrendMini title="Control Exceptions" data={trendSeries} dataKey="controlExceptions" stroke="#f59e0b" />
            <TrendMini title="KRI Breaches" data={trendSeries} dataKey="kriBreaches" stroke="#ef4444" />
          </div>
          <FormulaCaption text="6 month series. When the risk score history endpoint becomes wired the source switches to real time. Today the series is seeded from current values." />
        </PanelShell>

      </div>

      {/* â”€â”€ Row 1: Internal Controls Sunburst + Risk Treatment Strategy Mix â”€â”€ */}
      {/* Heavy cross-module visualizations (InternalControlsSunburst,
          GrcNetworkFlow, ComplianceOrbitChart, FrameworkControlsChart,
          ControlLibraryOverview) were removed per the "slim down to KPI
          strip" decision — each module's deep dashboard is reachable via
          its tab below. */}
      {/* Legacy heavy chart rows (InternalControlsSunburst, GrcNetworkFlow,
          ComplianceOrbitChart, FrameworkControlsChart, ControlLibraryOverview,
          Vulnerability Status mini, GRC Snapshot, KRI/Incident summary) were
          removed per the board reporting dashboard layout. Each module's
          deep dashboard remains reachable via its dedicated tab above. */}
      {false && (
      <>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        {controlGroups.length > 0 || complianceStatements.length > 0 ? (
          <InternalControlsSunburst groups={controlGroups} statements={complianceStatements} />
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col items-center justify-center min-h-[280px]">
            <Layers className="h-8 w-8 text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">No control library groups yet</p>
            <Link href="/control-library" className="text-xs text-blue-600 hover:underline mt-1">Set up Control Library â†’</Link>
          </div>
        )}

        {/* GRC Flow & Network — Network Diagram */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader
            title="GRC Flow & Network"
            sub="Cross-domain relationships · hover a node to highlight flows"
            href="/erm/risks"
          />
          <GrcNetworkFlow counts={{
            risks: openRisks,
            compliance: compSummaryStats.compliant,
            controls: unified?.compliance?.controls_implemented ?? 0,
            evidence: totalEvidence,
            governance: (unified?.governance?.pending_approvals ?? 0) + (unified?.attestations?.active_campaigns ?? 0),
            vulns: totalVulns,
          }} />
        </div>
      </div>

            {/* ── Row 2: Compliance Framework Orbit ──────────────────────────────── */}
      <div className="grid gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader
            title="Compliance Framework Coverage"
            sub="Ring = framework · completion = readiness score"
            href="/compliance"
          />
          <ComplianceOrbitChart frameworks={frameworkCoverageData} compSummaryStats={compSummaryStats} />
        </div>
      </div>
      </>
      )}


      {false && (
      <div className="grid gap-4 lg:grid-cols-2">
        {false && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader title="Framework Controls by Domain" sub="Control compliance status across domains" href="/control-library" />
          <FrameworkControlsChart groups={controlGroups} statements={complianceStatements} />
        </div>
        )}

        {/* Vulnerability Status */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader
            title="Vulnerability Status Breakdown"
            sub="By severity and remediation status"
            href="/vulnerabilities/dashboard"
          />
          {totalVulns > 0 ? (
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative h-[160px] w-full max-w-[160px] mx-auto sm:mx-0 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={vulnSeverityData.length ? vulnSeverityData : [{ name: 'None', value: 1, fill: '#e5e7eb' }]}
                      cx="50%" cy="50%"
                      innerRadius={40} outerRadius={65}
                      dataKey="value" paddingAngle={2}
                      stroke="white" strokeWidth={2}
                    >
                      {vulnSeverityData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip content={<PieTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-black">{totalVulns}</span>
                  <span className="text-[10px] text-gray-400">total</span>
                </div>
              </div>

              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">By Severity</p>
                  <div className="space-y-1">
                    {vulnSeverityData.map((d) => (
                      <div key={d.name} className="flex items-center gap-2 text-[11px]">
                        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                        <span className="flex-1 text-gray-600 capitalize">{d.name}</span>
                        <span className="font-semibold text-black">{d.value}</span>
                        <span className="text-gray-400 w-8 text-right">{d.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">By Status</p>
                  <div className="space-y-1">
                    {vulnStatusData.map((d) => (
                      <div key={d.name} className="flex items-center gap-2 text-[11px]">
                        <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: d.fill }} />
                        <span className="flex-1 text-gray-600 capitalize">{d.name}</span>
                        <span className="font-semibold text-black">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[160px]">
              <Bug className="h-8 w-8 text-gray-300 mb-2" />
              <p className="text-xs text-gray-400">No vulnerability data yet</p>
            </div>
          )}
        </div>
      </div>
      )}

      {false && (
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {false && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader
            title="Control Library Overview"
            sub={`${totalControlGroups} control groups Â· ${totalMappedControls} mapped controls`}
            href="/control-library"
          />
          <ControlLibraryOverview groups={controlGroups} />
        </div>
        )}

        {/* GRC Posture Snapshot */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-black">GRC Snapshot</h2>
            <p className="text-[10px] text-gray-400">Compliance posture · live</p>
          </div>
          {/* Big score */}
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold leading-none"
              style={{ color: complianceScore >= 75 ? '#16a34a' : complianceScore >= 50 ? '#d97706' : '#dc2626' }}>
              {complianceScore}
            </span>
            <span className="text-sm text-gray-400">/100</span>
            {complianceScore >= 75 && <span className="text-[11px] text-green-600 font-semibold">▲ on track</span>}
          </div>
          {/* Thermometer */}
          <div>
            <div className="h-2 rounded-full overflow-hidden mb-1" style={{
              background: 'linear-gradient(to right, #ef4444 0%, #f59e0b 45%, #22c55e 100%)'
            }}>
              <div className="relative h-full">
                <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-gray-700 shadow"
                  style={{ left: `calc(${Math.min(complianceScore, 100)}% - 6px)` }} />
              </div>
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 font-medium">
              <span>AT RISK</span><span>PARTIAL</span><span>COMPLIANT</span>
            </div>
          </div>
          {/* Status cards */}
          {(unified?.executive_summary?.open_issues ?? 0) > 0 && (
            <Link href="/erm/risks" className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:opacity-90"
              style={{ backgroundColor: '#fef2f2' }}>
              <span className="h-2 w-2 rounded-full flex-shrink-0 animate-pulse" style={{ backgroundColor: '#dc2626' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-red-900">{unified?.executive_summary?.open_issues} open issues</p>
                <p className="text-[10px] text-red-700">needs action</p>
              </div>
            </Link>
          )}
          {(unified?.executive_summary?.pending_actions ?? 0) > 0 && (
            <Link href="/erm/risks" className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:opacity-90"
              style={{ backgroundColor: '#fffbeb' }}>
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#d97706' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-amber-900">{unified?.executive_summary?.pending_actions} pending actions</p>
                <p className="text-[10px] text-amber-700">due this week</p>
              </div>
            </Link>
          )}
          <Link href="/control-library" className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:opacity-90"
            style={{ backgroundColor: '#f0fdf4' }}>
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#16a34a' }} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-green-900">{unified?.compliance?.controls_implemented ?? 0} controls</p>
              <p className="text-[10px] text-green-700">passing today</p>
            </div>
          </Link>
          {/* links row */}
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
            {[
              { label: `${unified?.compliance?.frameworks_tracked ?? 0} frameworks`, href: '/compliance' },
              { label: `${unified?.attestations?.active_campaigns ?? 0} attestations`, href: '/governance/attestations' },
              { label: `${unified?.governance?.pending_approvals ?? 0} approvals`, href: '/governance/approvals' },
            ].map((lk) => (
              <Link key={lk.href} href={lk.href}
                className="text-[10px] text-blue-600 hover:underline bg-blue-50 rounded-full px-2 py-0.5">
                {lk.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
      )}

      {false && (
      <div className="grid gap-4 lg:grid-cols-2">
        <KriStatusPanel kris={(kriList as KriItem[] | undefined) ?? []} />
        <IncidentSummaryPanel dash={incidentDash as IncidentDashData | undefined} />
      </div>
      )}
    </div>
  );
}

// ─── Executive panel primitives ────────────────────────────────────────────
// PanelShell wraps each of the 8 executive dashboards in matching chrome so
// the grid reads as a single workspace. ScorePill, StatCard, ProgressRow,
// RiskHeatmap, TrendMini and FormulaCaption are small presentational
// building blocks used by the panels above.

function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-card overflow-hidden">
      <div className="bg-gradient-to-r from-blue-900 to-blue-700 px-4 py-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="p-4 space-y-3">
        {children}
      </div>
    </div>
  );
}

function FormulaCaption({ text }: { text: string }) {
  return (
    <p className="text-[10px] text-gray-400 leading-relaxed border-t border-gray-100 pt-2 mt-2">
      <span className="font-semibold text-gray-500">Formula:</span> {text}
    </p>
  );
}

function ScorePill({
  label, value, status, tone, icon: Icon, href,
}: {
  label: string;
  value: number | string;
  status?: string;
  tone: 'green' | 'amber' | 'red' | 'slate';
  icon: LucideIcon;
  href?: string;
}) {
  const toneClasses: Record<typeof tone, { value: string; icon: string }> = {
    green: { value: 'text-emerald-600', icon: 'text-emerald-500' },
    amber: { value: 'text-amber-600',   icon: 'text-amber-500' },
    red:   { value: 'text-rose-600',    icon: 'text-rose-500' },
    slate: { value: 'text-slate-700',   icon: 'text-slate-500' },
  };
  const cls = toneClasses[tone];
  const inner = (
    <div className="rounded-lg border border-gray-200 bg-white px-2 py-3 text-center hover:shadow-sm transition-shadow">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 truncate">{label}</div>
      <div className="mt-1 flex justify-center"><Icon className={`h-5 w-5 ${cls.icon}`} /></div>
      <div className={`mt-1 text-xl font-bold ${cls.value}`}>{value}</div>
      {status && <div className={`text-[10px] mt-0.5 font-medium ${cls.value}`}>{status}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

function StatCard({
  label, value, sub, icon: Icon, tone, href,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: LucideIcon;
  tone: 'green' | 'amber' | 'red' | 'blue' | 'slate';
  href?: string;
}) {
  const toneCls: Record<typeof tone, { bg: string; value: string }> = {
    green: { bg: 'bg-emerald-50', value: 'text-emerald-700' },
    amber: { bg: 'bg-amber-50',   value: 'text-amber-700' },
    red:   { bg: 'bg-rose-50',    value: 'text-rose-700' },
    blue:  { bg: 'bg-blue-50',    value: 'text-blue-700' },
    slate: { bg: 'bg-slate-50',   value: 'text-slate-700' },
  };
  const cls = toneCls[tone];
  const inner = (
    <div className="rounded-lg border border-gray-200 bg-white px-2 py-3 text-center hover:shadow-sm transition-shadow">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 truncate">{label}</div>
      <div className={`mt-1 mx-auto w-10 h-10 rounded-full flex items-center justify-center ${cls.bg}`}>
        <Icon className={`h-5 w-5 ${cls.value}`} />
      </div>
      <div className={`mt-1 text-xl font-bold ${cls.value}`}>{value}</div>
      {sub && <div className={`text-[10px] mt-0.5 font-medium ${cls.value}`}>{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

function ProgressRow({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const fill = clamped >= 70 ? '#22c55e' : clamped >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-700 font-medium">{label}</span>
        <span className="text-gray-800 font-semibold">{clamped}%</span>
      </div>
      <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: fill }} />
      </div>
    </div>
  );
}

function EmptyHint({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <Icon className="h-8 w-8 text-gray-300 mb-2" />
      <p className="text-xs text-gray-400">{text}</p>
    </div>
  );
}

function RiskHeatmap({ matrix }: { matrix: number[][] }) {
  // matrix[likelihood-1][impact-1]. Render with likelihood on Y axis,
  // impact on X. Color by likelihood times impact (1..25 grid score).
  const cellColor = (l: number, i: number) => {
    const score = l * i;
    if (score >= 17) return '#dc2626';
    if (score >= 11) return '#f97316';
    if (score >= 6) return '#facc15';
    if (score >= 3) return '#a3e635';
    return '#86efac';
  };
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col">
        <div className="text-[10px] font-semibold text-gray-600 mb-1 text-right pr-1">Likelihood</div>
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <tbody>
            {[5, 4, 3, 2, 1].map((l) => (
              <tr key={l}>
                <td className="text-[10px] font-semibold text-gray-500 pr-2 text-right">{l}</td>
                {[1, 2, 3, 4, 5].map((i) => {
                  const count = matrix[l - 1][i - 1];
                  return (
                    <td key={i} className="w-9 h-9 text-center align-middle rounded text-[11px] font-semibold text-white"
                        style={{ background: cellColor(l, i), opacity: count === 0 ? 0.35 : 1 }}>
                      {count}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td></td>
              {[1, 2, 3, 4, 5].map((i) => (
                <td key={i} className="text-[10px] font-semibold text-gray-500 text-center pt-1">{i}</td>
              ))}
            </tr>
            <tr>
              <td></td>
              <td colSpan={5} className="text-[10px] font-semibold text-gray-600 text-center pt-1">Impact</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex-1 space-y-1.5 text-[11px] text-gray-600 pt-2">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 inline-block rounded" style={{ background: '#dc2626' }} /> Critical (score 17 to 25)</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 inline-block rounded" style={{ background: '#f97316' }} /> High (11 to 16)</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 inline-block rounded" style={{ background: '#facc15' }} /> Medium (6 to 10)</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 inline-block rounded" style={{ background: '#a3e635' }} /> Low (3 to 5)</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 inline-block rounded" style={{ background: '#86efac' }} /> Minimal (1 to 2)</div>
      </div>
    </div>
  );
}

function TrendMini({
  title, data, dataKey, stroke,
}: {
  title: string;
  data: Array<Record<string, number | string>>;
  dataKey: string;
  stroke: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2">
      <p className="text-[10px] font-semibold text-gray-600 mb-1 text-center">{title}</p>
      <ResponsiveContainer width="100%" height={70}>
        <LineChart data={data} margin={{ top: 4, right: 6, left: 0, bottom: 4 }}>
          <XAxis dataKey="month" tick={{ fontSize: 9 }} stroke="#9ca3af" />
          <Tooltip contentStyle={{ fontSize: 10, borderRadius: 6 }} />
          <Line type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={2} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Default export: tabbed hub with widget workspace ──────────────────────
// Each tab now renders into a shared widget-workspace engine supporting:
// drag/drop, resize, minimize, maximize and zoom controls.

type MainTab =
  | 'executive'
  | 'governance'
  | 'risk'
  | 'compliance'
  | 'vulnerabilities'
  | 'assets'
  | 'frameworks'
  | 'issues'
  | 'tasks'
  | 'evidence';

const MAIN_TABS: { id: MainTab; label: string; icon: LucideIcon }[] = [
  { id: 'executive',       label: 'Executive Overview', icon: LayoutDashboard },
  { id: 'governance',      label: 'Governance',         icon: BookOpen },
  { id: 'risk',            label: 'Risk',               icon: Scale },
  { id: 'compliance',      label: 'Compliance',         icon: Shield },
  { id: 'vulnerabilities', label: 'Vulnerabilities',    icon: BugIcon },
  { id: 'assets',          label: 'Assets',             icon: Server },
  { id: 'frameworks',      label: 'Frameworks',         icon: ClipboardList },
  { id: 'issues',          label: 'Issues',             icon: AlertCircle },
  { id: 'tasks',           label: 'Critical Tasks',     icon: ListTodo },
  { id: 'evidence',        label: 'Evidence',           icon: FileCheck2 },
];

function buildWidgetsForTab(tab: MainTab): WorkspaceWidgetConfig[] {
  switch (tab) {
    case 'executive':
      return [
        { id: 'exec-frameworks',       title: 'Active Journey Frameworks',     icon: <Shield className="h-3.5 w-3.5" />,        content: <FrameworkComplianceCards />,       defaultW: 12, defaultH: 4, minW: 6, minH: 3 },
        { id: 'board-1-reporting',     title: '1. Risk Posture Overview',      icon: <Activity className="h-3.5 w-3.5" />,      content: <BoardReportingWidget />,         defaultW: 6, defaultH: 3, minW: 4, minH: 2 },
        { id: 'board-2-vulnerabilities', title: '2. Vulnerabilities',          icon: <BugIcon className="h-3.5 w-3.5" />,       content: <VulnerabilitiesBoardWidget />,     defaultW: 6, defaultH: 3, minW: 4, minH: 2 },
        { id: 'board-3-governance',    title: '3. Governance Dashboard',       icon: <Building2 className="h-3.5 w-3.5" />,     content: <GovernanceDashboardWidget />,      defaultW: 6, defaultH: 3, minW: 4, minH: 2 },
        { id: 'board-4-assets',        title: '4. Assets',                     icon: <Server className="h-3.5 w-3.5" />,        content: <AssetsBoardWidget />,              defaultW: 6, defaultH: 3, minW: 4, minH: 2 },
        { id: 'board-5-tasks',         title: '5. Critical Tasks',             icon: <ListTodo className="h-3.5 w-3.5" />,      content: <TasksBoardWidget />,               defaultW: 6, defaultH: 3, minW: 4, minH: 2 },
        { id: 'board-6-kri',           title: '6. KPI KRI Monitoring Panel',   icon: <Gauge className="h-3.5 w-3.5" />,         content: <KRIMonitoringBoardWidget />,       defaultW: 6, defaultH: 3, minW: 4, minH: 2 },
        { id: 'board-7-exposure',      title: '7. Risk Exposure Summary Panel', icon: <Target className="h-3.5 w-3.5" />,       content: <RiskExposureBoardWidget />,       defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
        { id: 'board-8-trend',         title: '8. Risk Trend Analysis Sheet',  icon: <TrendingUp className="h-3.5 w-3.5" />,    content: <RiskTrendBoardWidget />,           defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
      ];
    case 'governance':
      // Consolidated: a total-first Governance Dashboard (status/types/mix/
      // timeline) + an expandable Approvals & Reviews activity widget + the
      // framework compliance coverage chart.
      return [
        { id: 'gov-dashboard', title: 'Governance Dashboard',          icon: <Building2 className="h-3.5 w-3.5" />,  content: <GovernanceDashboardWidget />,         defaultW: 7, defaultH: 4, minW: 4, minH: 3 },
        { id: 'gov-activity',  title: 'Approvals & Reviews',           icon: <ClipboardList className="h-3.5 w-3.5" />, content: <GovernanceActivityWidget />,          defaultW: 5, defaultH: 4, minW: 3, minH: 2 },
        { id: 'gov-exceptions', title: 'Exception Risk Posture',       icon: <Gauge className="h-3.5 w-3.5" />,      content: <ExceptionPostureWidget />,            defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
        { id: 'gov-coverage',  title: 'Framework Compliance Coverage', icon: <Shield className="h-3.5 w-3.5" />,     content: <GovernanceFrameworkCoverageWidget />, defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
      ];
    case 'risk':
      return [
        { id: 'risk-summary', title: 'Risk Overview', content: <RiskSummaryWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        // Was Risk Score Distribution. Now buckets the register by status
        // (open / in_treatment / mitigated / accepted / closed) per the
        // operator request.
        { id: 'risk-distribution', title: 'Risk Status Distribution', content: <RiskDistributionWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'risk-velocity', title: 'Risk Velocity Trend', content: <ExecutiveRiskVelocityWidget />, defaultW: 8, defaultH: 4, minW: 5, minH: 3 },
        { id: 'risk-appetite', title: 'Risk Appetite Utilization', content: <ExecutiveRiskAppetiteWidget />, defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
        { id: 'risk-category', title: 'Risk Categories', content: <RiskCategoryWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'risk-incidents', title: 'Incident Snapshot', content: <IncidentSnapshotWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        // Internal Controls distribution widgets surfaced onto the Risk tab.
        { id: 'risk-ctrl-status',           title: 'Internal Controls — Status',                  content: <InternalControlStatusWidget />,                  defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'risk-ctrl-design',           title: 'Internal Controls — Design Effectiveness',    content: <InternalControlDesignEffectivenessWidget />,     defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'risk-ctrl-operating',        title: 'Internal Controls — Operating Effectiveness', content: <InternalControlOperatingEffectivenessWidget />,  defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
      ];
    case 'compliance':
      return [
        { id: 'comp-summary', title: 'Compliance Summary', content: <ComplianceSummaryWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'comp-status-mix', title: 'Control Status Mix', content: <ComplianceStatusMixWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'comp-coverage', title: 'Framework Coverage', content: <ComplianceFrameworkCoverageWidget />, defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
        { id: 'comp-domain-coverage', title: 'Domain Coverage Radar', content: <ComplianceDomainCoverageWidget />, defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
        { id: 'comp-testing', title: 'Control Testing Snapshot', content: <ControlTestingSnapshotWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'comp-framework-readiness', title: 'Framework Readiness', content: <FrameworksReadinessWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
      ];
    case 'vulnerabilities':
      return [
        { id: 'vuln-summary', title: 'Vulnerability Summary', content: <VulnerabilitySummaryWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'vuln-severity', title: 'Severity Distribution', content: <VulnerabilitySeverityWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'vuln-trend', title: 'Discovery vs Resolution Trend', content: <VulnerabilityTrendWidget />, defaultW: 8, defaultH: 4, minW: 5, minH: 3 },
        { id: 'vuln-status', title: 'Workflow Status', content: <VulnerabilityStatusWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'vuln-aging', title: 'Aging Buckets', content: <VulnerabilityAgingWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'vuln-overdue', title: 'Overdue Vulnerabilities', content: <VulnerabilityOverdueWidget />, defaultW: 6, defaultH: 3, minW: 3, minH: 2 },
      ];
    case 'assets':
      return [
        { id: 'assets-summary', title: 'Asset Summary', content: <AssetsSummaryWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'assets-status', title: 'Asset Lifecycle Status', content: <AssetsStatusWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'assets-cia-radar', title: 'CIA Profile by Asset Type', content: <AssetsCiaRadarWidget />, defaultW: 8, defaultH: 4, minW: 5, minH: 3 },
        { id: 'assets-type', title: 'Asset Type Distribution', content: <AssetsTypeWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'assets-criticality', title: 'Criticality Distribution', content: <AssetsCriticalityWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'assets-vuln', title: 'Vulnerability Exposure', content: <VulnerabilitySummaryWidget />, defaultW: 6, defaultH: 3, minW: 3, minH: 2 },
        // Internal Controls distribution widgets mirrored onto the Assets tab
        // so coverage of asset linked controls is visible alongside the
        // asset register itself.
        { id: 'assets-ctrl-status',    title: 'Internal Controls — Status',                  content: <InternalControlStatusWidget />,                 defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'assets-ctrl-design',    title: 'Internal Controls — Design Effectiveness',    content: <InternalControlDesignEffectivenessWidget />,    defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'assets-ctrl-operating', title: 'Internal Controls — Operating Effectiveness', content: <InternalControlOperatingEffectivenessWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
      ];
    case 'frameworks':
      return [
        { id: 'fw-overview', title: 'Journey Overview', content: <FrameworksOverviewWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'fw-readiness', title: 'Readiness by Framework', content: <FrameworksReadinessWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'fw-comp-coverage', title: 'Framework Coverage', content: <ComplianceFrameworkCoverageWidget />, defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
        { id: 'fw-domain-radar', title: 'Domain Coverage Radar', content: <ComplianceDomainCoverageWidget />, defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
        { id: 'fw-domain', title: 'Domain Coverage Breakdown', content: <FrameworksDomainWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'fw-activity', title: 'Framework Activity', content: <FrameworksActivityWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
      ];
    case 'issues':
      return [
        { id: 'issues-summary', title: 'Issue Summary', content: <IssuesSummaryWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'issues-state', title: 'Workflow Distribution', content: <IssuesStateWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'issues-trend', title: 'Issue Flow Trend', content: <IssuesTrendWidget />, defaultW: 8, defaultH: 4, minW: 5, minH: 3 },
        { id: 'issues-category', title: 'Category Mix', content: <IssuesCategoryWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'issues-sla', title: 'SLA Breach Queue', content: <IssuesSlaWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'issues-tasks-status', title: 'Task Status Mix', content: <TasksStatusWidget />, defaultW: 6, defaultH: 3, minW: 3, minH: 2 },
      ];
    case 'tasks':
      return [
        { id: 'tasks-summary', title: 'Task Summary', content: <TasksSummaryWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'tasks-status', title: 'Status Distribution', content: <TasksStatusWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'tasks-trend', title: 'Task Throughput Trend', content: <TasksTrendWidget />, defaultW: 8, defaultH: 4, minW: 5, minH: 3 },
        { id: 'tasks-priority', title: 'Priority Distribution', content: <TasksPriorityWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'tasks-sla', title: 'Overdue Aging', content: <TasksSlaWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'tasks-issues', title: 'Issue Summary', content: <IssuesSummaryWidget />, defaultW: 6, defaultH: 3, minW: 3, minH: 2 },
      ];
    case 'evidence':
      return [
        { id: 'evidence-summary', title: 'Evidence Summary', content: <EvidenceSummaryWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'evidence-status', title: 'Status Distribution', content: <EvidenceStatusWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
        { id: 'evidence-recency', title: 'Upload Recency Trend', content: <EvidenceRecencyWidget />, defaultW: 8, defaultH: 4, minW: 5, minH: 3 },
        { id: 'evidence-type', title: 'Type Distribution', content: <EvidenceTypeWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'evidence-queue', title: 'Pending Review Queue', content: <EvidenceQueueWidget />, defaultW: 3, defaultH: 3, minW: 3, minH: 2 },
        { id: 'evidence-testing', title: 'Control Testing Snapshot', content: <ControlTestingSnapshotWidget />, defaultW: 6, defaultH: 3, minW: 3, minH: 2 },
      ];
    default:
      return [{ id: 'default-exec', title: 'Portfolio Snapshot', content: <ExecutivePortfolioWidget />, defaultW: 4, defaultH: 3, minW: 3, minH: 2 }];
  }
}

// Executive Board Reporting layout. Fixed 2 column grid skipping the
// WidgetWorkspace drag/resize chrome so the dashboard reads as a printable
// board pack. Card chrome aligns with the platform's existing widget cards
// (white background, slate 200 border, subtle slate header strip, no
// gradients, no oversize accents).

export default function MainDashboard() {
  const [activeTab, setActiveTab] = useState<MainTab>('executive');
  const activeWidgets = useMemo(() => buildWidgetsForTab(activeTab), [activeTab]);

  // Hidden for now: the legacy "Executive Overview" tab bar + draggable widget
  // workspace. The new aggregated dashboard (MainModuleCards + CyberKpiPanel)
  // stands alone. Flip to `true` to bring the old tabbed dashboard back.
  const SHOW_LEGACY_TABS = false;

  return (
    <div className="-m-4 flex flex-col bg-[var(--color-surface)] lg:-m-5">
      {/* Aggregated module scorecards — each ring-card links to its module overview. */}
      <div className="px-3 pt-4 sm:px-6">
        <MainModuleCards />
        {/* Cyber Security KPI reporting dashboard (quarterly target vs actual). */}
        <CyberKpiPanel />
      </div>

      {SHOW_LEGACY_TABS && (
        <>
          <div className="border-b border-gray-200 bg-white px-3 sm:px-6">
            <div className="flex items-center gap-0 overflow-x-auto -mb-px">
              {MAIN_TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`relative inline-flex items-center gap-1.5 rounded-t-md px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors -mb-px ${
                    activeTab === id
                      ? 'text-blue-700 bg-blue-50/50'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                  {activeTab === id && (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-[var(--color-surface)] p-3 sm:p-4">
            <WidgetWorkspace tabKey={activeTab} widgets={activeWidgets} />
          </div>
        </>
      )}
    </div>
  );
}
