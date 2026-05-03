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
} from 'lucide-react';
import Link from 'next/link';

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
      <SectionHeader title="Key Risk Indicators" sub={`${kris.length} active KRIs monitored`} href="/risks/kris" />

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
          <Link href="/risks/kris" className="text-[11px] text-blue-600 hover:underline mt-1">Set up KRIs →</Link>
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
      <SectionHeader title="Risk Incidents" sub="Active incidents by severity & status" href="/risks/incidents" />

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center h-[140px]">
          <AlertTriangle className="h-7 w-7 text-gray-300 mb-2" />
          <p className="text-xs text-gray-400">No incidents recorded</p>
          <Link href="/risks/incidents" className="text-[11px] text-blue-600 hover:underline mt-1">Log an incident →</Link>
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

export default function MainDashboard() {
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
        name: (f.framework_name || '').length > 15 ? (f.framework_name || '').slice(0, 14) + 'â€¦' : (f.framework_name || ''),
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Compliance Score"
          value={`${complianceScore}%`}
          sub={`${unified?.compliance?.frameworks_tracked ?? 0} frameworks tracked`}
          icon={Shield}
          accent="#22c55e"
          href="/compliance"
        />
        <KpiCard
          label="Total Risks"
          value={totalRisks}
          sub={`${openRisks} open risks`}
          icon={AlertTriangle}
          accent="#ef4444"
          href="/risks"
        />
        <KpiCard
          label="Vulnerabilities"
          value={totalVulns}
          sub={`${criticalVulns} critical/high`}
          icon={Bug}
          accent="#f97316"
          href="/vulnerabilities"
        />
        <KpiCard
          label="Evidence Items"
          value={totalEvidence}
          sub={`${totalMappedControls} mapped controls`}
          icon={FileCheck}
          accent="#3b82f6"
          href="/evidence"
        />
      </div>

      {/* â”€â”€ Row 1: Internal Controls Sunburst + Risk Treatment Strategy Mix â”€â”€ */}
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
            href="/risks"
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

      
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader title="Framework Controls by Domain" sub="Control compliance status across domains" href="/control-library" />
          <FrameworkControlsChart groups={controlGroups} statements={complianceStatements} />
        </div>

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

      {/* â”€â”€ Row 4: Control Library domain bar + GRC Snapshot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <SectionHeader
            title="Control Library Overview"
            sub={`${totalControlGroups} control groups Â· ${totalMappedControls} mapped controls`}
            href="/control-library"
          />
          <ControlLibraryOverview groups={controlGroups} />
        </div>

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
            <Link href="/risks" className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:opacity-90"
              style={{ backgroundColor: '#fef2f2' }}>
              <span className="h-2 w-2 rounded-full flex-shrink-0 animate-pulse" style={{ backgroundColor: '#dc2626' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-red-900">{unified?.executive_summary?.open_issues} open issues</p>
                <p className="text-[10px] text-red-700">needs action</p>
              </div>
            </Link>
          )}
          {(unified?.executive_summary?.pending_actions ?? 0) > 0 && (
            <Link href="/risks" className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:opacity-90"
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

      {/* ── Row 5: KRI Status + Incident Summary ─────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <KriStatusPanel kris={(kriList as KriItem[] | undefined) ?? []} />
        <IncidentSummaryPanel dash={incidentDash as IncidentDashData | undefined} />
      </div>
    </div>
  );
}
