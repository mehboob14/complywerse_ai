/**
 * /compliance-overview — drill-down dashboard.
 *
 * Drill levels:
 *   L1: Category card grid (Windows, Linux, Network, DBs, …)
 *   L2: Card expanded → assets grouped by variant chip
 *   L3: Asset expanded → CIS rules applied (lazy-fetched)
 *
 * Data sources — all live queries, no mock data:
 *   GET /compliance-plugins/assets-overview                    (L1 + L2)
 *   GET /integrations/connections                              (L1 supplement)
 *   GET /compliance-plugins/match-preview?asset_id=<id>        (L3, on demand)
 */
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis,
  PieChart, Pie, Cell, Tooltip,
} from 'recharts';
import { apiClient } from '@/lib/api';
import '../assets/inventory-redesign.css';
import { useTabParam } from '@/lib/useTabParam';
import {
  Cloud, Database, Server, RouterIcon as RouterI, Users as UsersIcon,
  Container, CloudCog, Search, ChevronDown, ChevronRight, ExternalLink,
  Loader2, ShieldCheck, AlertTriangle, AlertCircle, CheckCircle2,
  BarChart3, BookOpen, Gauge, Cpu, ShieldAlert, Activity,
  type LucideIcon,
} from 'lucide-react';
// Consolidated "Compliance & Scans" host — Overview owns the URL, the
// other three pages mount as siblings underneath the tab strip. All four
// underlying routes (/compliance-overview, /compliance-plugins/library,
// /risk-posture, /admin/agents) still resolve standalone so deep-links
// from elsewhere in the app are unaffected.
import RuleLibraryPage from '../compliance-plugins/library/page';
import RiskPosturePage from '../risk-posture/page';

type AssetRow = {
  id: number;
  name: string;
  host_name?: string | null;
  ip_address?: string | null;
  asset_type?: string | null;
  asset_role?: string | null;
  parent_asset_id?: number | null;
  criticality?: string | null;
  os_family?: string | null;
  os_normalized?: string | null;
  os_version?: string | null;
  runner_type?: string | null;
  connection_id?: number | null;
  has_connection?: boolean;
  last_scan_at?: string | null;
  scanned_rules?: number;
  passed?: number;
  failed?: number;
  errored?: number;
  pass_rate?: number;
  // Strict-matcher resolution (added by assets-overview backend) — the
  // benchmark the asset is being scanned against + how many rules apply.
  // matched_benchmark is the full label, e.g.
  // "CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1". null when
  // no mapping covers the asset's os_normalized.
  matched_benchmark?: string | null;
  applicable_rules?: number;
};

type AssetsOverviewGroup = {
  os_family: string;
  label: string;
  count: number;
  assets: AssetRow[];
};

type AssetsOverviewResp = {
  groups: AssetsOverviewGroup[];
  totals?: { assets?: number; scanned?: number; unscanned?: number; avg_pass_rate?: number; total_rules?: number };
};

type Connection = {
  id: number;
  integration_type: string;
  connection_name: string;
  console_url?: string | null;
  status?: string | null;
};

// ─── Category definitions (visual tokens) ───────────────────────────────
const CATEGORIES: Array<{
  key: string;
  label: string;
  short: string;
  description: string;
  icon: any;
  // Tailwind ring + bg + text classes — chosen so every card looks
  // distinct without screaming. Lift on hover, ring when selected.
  cardTone: { bgFrom: string; bgTo: string; ring: string; iconBg: string; iconColor: string; numText: string };
  matchOs?: string[];
  matchRunner?: string[];
}> = [
  { key: 'windows',  label: 'Windows hosts',  short: 'Windows', description: 'Workstations + servers · WinRM or agent',
    icon: Server, cardTone: { bgFrom: 'from-blue-50',    bgTo: 'to-white', ring: 'ring-blue-300',    iconBg: 'bg-blue-100',    iconColor: 'text-blue-700',    numText: 'text-blue-900' },
    matchOs: ['windows','windows_server','windows_workstation'], matchRunner: ['windows_winrm'] },
  { key: 'linux',    label: 'Linux hosts',    short: 'Linux',   description: 'Ubuntu · Debian · RHEL · Amazon — SSH or agent',
    icon: Server, cardTone: { bgFrom: 'from-amber-50',   bgTo: 'to-white', ring: 'ring-amber-300',   iconBg: 'bg-amber-100',   iconColor: 'text-amber-700',   numText: 'text-amber-900' },
    matchOs: ['linux','linux_server','linux_workstation'], matchRunner: ['linux_ssh'] },
  { key: 'macos',    label: 'macOS hosts',    short: 'macOS',   description: 'Endpoint agent only',
    icon: Server, cardTone: { bgFrom: 'from-slate-50',   bgTo: 'to-white', ring: 'ring-slate-300',   iconBg: 'bg-slate-100',   iconColor: 'text-slate-700',   numText: 'text-slate-900' },
    matchOs: ['macos','macos_workstation'] },
  { key: 'network',  label: 'Network devices', short: 'Network', description: 'Cisco IOS · NX-OS · ASA · Firepower',
    icon: RouterI, cardTone: { bgFrom: 'from-sky-50',    bgTo: 'to-white', ring: 'ring-sky-300',     iconBg: 'bg-sky-100',     iconColor: 'text-sky-700',     numText: 'text-sky-900' },
    matchOs: ['network_device'], matchRunner: ['netdev_ssh'] },
  { key: 'databases', label: 'Databases',      short: 'DBs',     description: 'Oracle · MSSQL · PostgreSQL · MySQL',
    icon: Database, cardTone: { bgFrom: 'from-rose-50',   bgTo: 'to-white', ring: 'ring-rose-300',    iconBg: 'bg-rose-100',    iconColor: 'text-rose-700',    numText: 'text-rose-900' },
    matchOs: ['database'], matchRunner: ['oracle_sql','mssql_sql','postgres_sql','mysql_sql'] },
  { key: 'identity',  label: 'Identity / AD',  short: 'AD',      description: 'Active Directory · LDAP',
    icon: UsersIcon, cardTone: { bgFrom: 'from-purple-50', bgTo: 'to-white', ring: 'ring-purple-300',  iconBg: 'bg-purple-100',  iconColor: 'text-purple-700',  numText: 'text-purple-900' },
    matchRunner: ['ldap_query'] },
  { key: 'cloud',     label: 'Cloud accounts', short: 'Cloud',   description: 'AWS · Azure · GCP · DigitalOcean',
    icon: Cloud, cardTone: { bgFrom: 'from-orange-50', bgTo: 'to-white', ring: 'ring-orange-300',  iconBg: 'bg-orange-100',  iconColor: 'text-orange-700',  numText: 'text-orange-900' },
    matchOs: ['aws_account','azure_account','gcp_account'], matchRunner: ['aws_readonly','azure_readonly','gcp_readonly'] },
  { key: 'containers', label: 'Containers',    short: 'K8s',     description: 'Kubernetes · Docker',
    icon: Container, cardTone: { bgFrom: 'from-indigo-50', bgTo: 'to-white', ring: 'ring-indigo-300', iconBg: 'bg-indigo-100',  iconColor: 'text-indigo-700',  numText: 'text-indigo-900' },
    matchOs: ['container'], matchRunner: ['k8s_api'] },
  { key: 'vmware',    label: 'VMware hosts',   short: 'VMware',  description: 'ESXi · vCenter · vSphere',
    icon: CloudCog, cardTone: { bgFrom: 'from-emerald-50', bgTo: 'to-white', ring: 'ring-emerald-300', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-700', numText: 'text-emerald-900' },
    matchOs: ['vmware_host'] },
  // Unclassified — catches assets whose os_family doesn't fit any other
  // category (no OS profile yet, or an OS family Compliverse hasn't
  // categorised). Previously these landed in `out['other']` which never
  // got rendered, so the DEVICES KPI sum (e.g. 21) didn't match the
  // visible card total. Without a category they were also invisible to
  // the operator. Now they get their own card so the math agrees and
  // the operator has a clear "X assets need OS classification" surface.
  { key: 'other', label: 'Unclassified', short: 'Unclassified', description: 'Assets with no OS profile or no Compliverse category yet — fix via "Re-detect OS" on each',
    icon: Server, cardTone: { bgFrom: 'from-zinc-50', bgTo: 'to-white', ring: 'ring-zinc-300', iconBg: 'bg-zinc-100', iconColor: 'text-zinc-700', numText: 'text-zinc-900' },
    matchOs: ['unclassified','unknown'] },
];

const RUNNER_TO_BENCHMARK_SHORT: Record<string, string> = {
  windows_winrm: 'CIS Windows',
  linux_ssh:     'CIS Linux',
  netdev_ssh:    'CIS Cisco',
  oracle_sql:    'CIS Oracle DB',
  mssql_sql:     'CIS MSSQL',
  postgres_sql:  'CIS PostgreSQL',
  mysql_sql:     'CIS MySQL',
  ldap_query:    'CIS AD',
  azure_readonly:'CIS Azure',
  aws_readonly:  'CIS AWS',
  k8s_api:       'CIS Kubernetes',
};

/** Defense-in-depth: if an older backend still classifies apps via host WinRM,
 *  map application software keys to the Databases / etc. category ourselves. */
function categoryKeyFromSoftware(a: AssetRow): string | null {
  const role = (a.asset_role || '').toLowerCase();
  const isApp = role === 'application'
    || a.parent_asset_id != null
    || (a.asset_type || '').toLowerCase() === 'application';
  if (!isApp) return null;
  const k = (a.os_normalized || '').toLowerCase();
  if (!k) return null;
  if (k.startsWith('postgres') || k.startsWith('postgresql')
    || k.startsWith('mssql') || k.startsWith('sql-server')
    || k.startsWith('mysql') || k.startsWith('mariadb')
    || k.startsWith('oracle')) return 'databases';
  if (k.startsWith('docker') || k.startsWith('kubernetes') || k.startsWith('k8s')) return 'containers';
  if (k.startsWith('iis')) return 'windows';
  if (k.startsWith('nginx') || k.startsWith('apache') || k.startsWith('tomcat')) return 'linux';
  return null;
}

function fmtAgo(iso?: string | null): string {
  if (!iso) return 'never scanned';
  const utc = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.now() - new Date(utc).getTime();
  if (Number.isNaN(ms)) return 'unknown';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function passColor(rate?: number | null): string {
  if (rate === undefined || rate === null || rate === 0) return 'text-slate-500';
  if (rate >= 80) return 'text-emerald-700';
  if (rate >= 50) return 'text-amber-700';
  return 'text-rose-700';
}

function passBg(rate?: number | null): string {
  if (rate === undefined || rate === null || rate === 0) return 'bg-slate-200';
  if (rate >= 80) return 'bg-emerald-500';
  if (rate >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

// Squeeze a CIS benchmark label to a tight one-liner for the asset row:
//   CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1 → "Win 11 Enterprise v5.0.1"
//   CIS_Ubuntu_Linux_22.04_LTS_Benchmark_v3.0.0          → "Ubuntu Linux 22.04 LTS v3.0.0"
// Falls back to a sane substring of the raw label if the regex doesn't
// match — never throws.
function prettifyBenchmark(raw: string): string {
  if (!raw) return '—';
  // Strip the literal CIS_ prefix and _Benchmark suffix; tighten Microsoft.
  const stripped = raw
    .replace(/^CIS_/, '')
    .replace(/_Benchmark_/, '_')
    .replace(/_Microsoft_Windows_(\d+)/, 'Win $1')
    .replace(/_/g, ' ');
  return stripped.length > 60 ? stripped.slice(0, 60) + '…' : stripped;
}


// Prettify the variant key for display: "windows-11-25H2" → "Windows 11 · 25H2"
function prettyVariant(v: string): string {
  if (!v || v === 'unknown') return 'Variant unknown';
  return v
    .replace(/^windows-(\d+)-(\w+)$/, 'Windows $1 · $2')
    .replace(/^windows-(\d+)$/, 'Windows $1')
    .replace(/^ubuntu-(.+)$/, 'Ubuntu $1')
    .replace(/^debian-(.+)$/, 'Debian $1')
    .replace(/^rhel-(.+)$/, 'RHEL $1')
    .replace(/^macos-(.+)$/, 'macOS $1')
    .replace(/^windows_winrm$/, 'Windows (no build detected)')
    .replace(/^linux_ssh$/, 'Linux (no distro detected)');
}

// ─── Default export: tabbed host ────────────────────────────────────────────
// The four sidebar entries (Compliance Overview / Compliance Rules / Risk
// Posture / Scanners) collapsed into a single "Compliance & Scans" entry.
// This page now mounts them as four sibling tabs. State-only routing (no
// URL sync) matches the pattern we used for the Vulnerabilities Overview
// move — conditional mount means inactive tabs incur no fetch cost.

type ComplianceScansTab = 'overview' | 'rules' | 'risk-posture';

const COMPLIANCE_TABS: { id: ComplianceScansTab; label: string; icon: LucideIcon }[] = [
  { id: 'overview',      label: 'Compliance Overview', icon: BarChart3 },
  { id: 'rules',         label: 'Compliance Rules',    icon: BookOpen },
];

export default function ComplianceOverviewPage() {
  const [activeTab, setActiveTab] = useTabParam<ComplianceScansTab>('overview', ['overview', 'rules']);

  return (
    <div className="-m-4 lg:-m-5">
      <div className="border-b border-slate-200 bg-white px-3 sm:px-6">
        <div className="flex items-center gap-0 overflow-x-auto -mb-px">
          {COMPLIANCE_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`relative inline-flex items-center gap-1.5 rounded-t-md px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors -mb-px ${
                activeTab === id
                  ? 'text-primary-700 bg-primary-50'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon size={14} strokeWidth={1.75} />
              {label}
              {activeTab === id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-600" />
              )}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && <OverviewTabContent />}
      {activeTab === 'rules' && <RuleLibraryPage />}
    </div>
  );
}

// ─── Overview tab body (the original /compliance-overview page) ─────────────
// ─── Executive summary hero — the attention-catching "first view" ──────────
// Four at-a-glance panels anyone can read in two seconds: an overall
// compliance gauge, the pass/fail/error split, scan coverage, and a glance at
// asset risk. Built to read top-to-bottom for execs, not just operators.
type OverviewTotals = {
  assets: number; scanned: number; passed: number; failed: number; errored: number;
  passRate: number; assetsActuallyScanned: number; assetsWithBenchmark: number;
};

function scoreHex(pct: number): string {
  if (pct >= 80) return '#0E5A46';  // emerald-600
  if (pct >= 50) return '#C79A2A';  // amber-500
  return '#A33B1F';                 // rose-600
}

// Sanctioned severity ramp: critical=rose, high=orange, medium/moderate=amber, low=emerald.
// Keys must match the backend's RISK_BANDS. They were renamed away from the
// criticality vocabulary (critical/high/moderate/low) so the two scales stop
// colliding; this copy has to move with them or every band reads 0.
const RISK_BANDS: Array<{ key: string; label: string; color: string }> = [
  { key: 'severe',    label: 'Severe',    color: '#A33B1F' },  // rose-600
  { key: 'elevated',  label: 'Elevated',  color: '#C2542E' },  // orange-500
  { key: 'watch',     label: 'Watch',     color: '#C79A2A' },  // amber-500
  { key: 'contained', label: 'Contained', color: '#0E5A46' },  // emerald-500
];

// ── Design SVG ring (Redesign kit): track + arc, % or N/S centred ──────────
function ringHex(pct: number): string {
  if (pct >= 85) return '#7CB342';   // green
  if (pct >= 55) return '#E2B33C';   // amber
  return '#C25450';                  // rose
}
function Ring({ pct, size, fs, color }: { pct: number | null; size: number; fs?: number; color?: string }) {
  const C = 327; // 2·π·52
  const off = pct === null ? C : C * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const stroke = color || (pct === null ? '#EEF1F4' : ringHex(pct));
  return (
    <div style={{ width: size, height: size, position: 'relative', flex: 'none' }}>
      <svg viewBox="0 0 120 120" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r="52" fill="none" stroke="#EEF1F4" strokeWidth="12" />
        {pct !== null && (
          <circle cx="60" cy="60" r="52" fill="none" stroke={stroke} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.3,.8,.3,1)' }} />
        )}
      </svg>
      <div className="num" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: fs || 11, fontWeight: 600, color: pct === null ? '#AEB8C2' : '#0F1F2B' }}>
        {pct === null ? 'N/S' : `${pct}%`}
      </div>
    </div>
  );
}

// Legend swatch + label + count; and a stacked proportional bar.
function Lg({ c, label, value }: { c: string; label: string; value: number | string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <i style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />{label}{' '}
      <b className="num" style={{ color: '#0F1F2B' }}>{typeof value === 'number' ? value.toLocaleString() : value}</b>
    </span>
  );
}
function Bar({ segs, h }: { segs: Array<{ w: number; c: string }>; h?: number }) {
  const tot = segs.reduce((a, x) => a + x.w, 0) || 1;
  return (
    <div style={{ display: 'flex', height: h || 9, borderRadius: 999, overflow: 'hidden', margin: '8px 0 10px', background: '#EEF1F4' }}>
      {segs.map((x, i) => x.w > 0 && <i key={i} style={{ width: `${(x.w / tot) * 100}%`, background: x.c, display: 'block' }} />)}
    </div>
  );
}

const CIS_CARD: React.CSSProperties = { background: '#fff', border: '1px solid #E8ECEE', borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.04)', padding: '13px 15px' };
const CIS_LBL: React.CSSProperties = { fontSize: 11, color: '#7A8590', fontWeight: 500 };

function ExecutiveSummary({ totals }: { totals: OverviewTotals }) {
  const riskQ = useQuery({
    queryKey: ['compliance-overview.risk-posture'],
    queryFn: async () => (await apiClient.get('/risk-posture/dashboard')).data as {
      summary?: { by_band?: Record<string, number>; avg_score?: number; asset_count?: number; scored_count?: number };
      assets?: Array<{ id: number; name: string; score: number | null; band?: { label: string } }>;
    },
    staleTime: 60_000,
  });

  const hasScans = totals.scanned > 0;
  const passRate = totals.passRate;
  const awaiting = Math.max(0, totals.assetsWithBenchmark - totals.assetsActuallyScanned);
  const unmapped = Math.max(0, totals.assets - totals.assetsWithBenchmark);
  const bands = riskQ.data?.summary?.by_band || {};
  const avgRisk = Math.round(riskQ.data?.summary?.avg_score ?? 0);
  const RB = [
    { key: 'severe', label: 'Severe', c: '#9B1C1C' },
    { key: 'elevated', label: 'Elevated', c: '#C25450' },
    { key: 'watch', label: 'Watch', c: '#E2B33C' },
    { key: 'contained', label: 'Contained', c: '#2D6A4F' },
  ];
  const riskTotal = RB.reduce((a, b) => a + (bands[b.key] || 0), 0);

  return (
    <section className="cisKpi">
      {/* Compliant */}
      <div style={CIS_CARD}>
        <div style={CIS_LBL}>Compliant</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
          <Ring pct={hasScans ? passRate : null} size={60} fs={15} />
          <div style={{ fontSize: 11, color: '#9BA6B2', lineHeight: 1.5 }}>
            <b className="num" style={{ color: '#0F1F2B', fontSize: 13 }}>{totals.passed.toLocaleString()}</b> of {totals.scanned.toLocaleString()}<br />security checks passed
          </div>
        </div>
      </div>
      {/* Check results */}
      <div style={CIS_CARD}>
        <div style={CIS_LBL}>Check results</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '8px 0 6px' }}>
          <b className="num" style={{ fontSize: 19, fontWeight: 600 }}>{totals.scanned.toLocaleString()}</b>
          <span style={{ fontSize: 10.5, color: '#9BA6B2' }}>checks run</span>
        </div>
        <Bar segs={[{ w: totals.passed, c: '#2D6A4F' }, { w: totals.failed, c: '#C25450' }, { w: totals.errored, c: '#AEB6BF' }]} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 10.5, color: '#7A8590' }}>
          <Lg c="#2D6A4F" label="Passed" value={totals.passed} />
          <Lg c="#C25450" label="Failed" value={totals.failed} />
          <Lg c="#AEB6BF" label="Errored" value={totals.errored} />
        </div>
      </div>
      {/* Scan coverage */}
      <div style={CIS_CARD}>
        <div style={CIS_LBL}>Scan coverage</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '8px 0 6px' }}>
          <b className="num" style={{ fontSize: 19, fontWeight: 600 }}>{totals.assetsActuallyScanned}</b>
          <span style={{ fontSize: 10.5, color: '#9BA6B2' }}>of {totals.assets} devices scanned</span>
        </div>
        <Bar segs={[{ w: totals.assetsActuallyScanned, c: '#17B898' }, { w: awaiting, c: '#E2B33C' }, { w: unmapped, c: '#AEB6BF' }]} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 10.5, color: '#7A8590' }}>
          <Lg c="#17B898" label="Scanned" value={totals.assetsActuallyScanned} />
          <Lg c="#E2B33C" label="Awaiting" value={awaiting} />
          <Lg c="#AEB6BF" label="Not mapped" value={unmapped} />
        </div>
      </div>
      {/* Asset risk */}
      <div style={CIS_CARD}>
        <div style={CIS_LBL}>Asset risk</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '8px 0 6px' }}>
          <b className="num" style={{ fontSize: 19, fontWeight: 600 }}>{riskTotal > 0 ? avgRisk : '—'}</b>
          <span style={{ fontSize: 10.5, color: '#9BA6B2' }}>avg risk · {riskTotal || totals.assets} assets</span>
        </div>
        <Bar segs={RB.map((b) => ({ w: bands[b.key] || 0, c: b.c }))} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 14px', fontSize: 10.5, color: '#7A8590' }}>
          {RB.map((b) => <Lg key={b.key} c={b.c} label={b.label} value={bands[b.key] || 0} />)}
        </div>
      </div>
    </section>
  );
}

export function OverviewTabContent() {
  const overviewQ = useQuery({
    queryKey: ['compliance-overview.assets'],
    queryFn: async () => (await apiClient.get('/compliance-plugins/assets-overview')).data as AssetsOverviewResp,
  });

  const connectionsQ = useQuery({
    queryKey: ['compliance-overview.connections'],
    queryFn: async () => (await apiClient.get('/integrations/connections')).data as { connections?: Connection[] } | Connection[],
  });

  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [expandedAsset, setExpandedAsset] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const buckets = useMemo(() => {
    const out: Record<string, AssetRow[]> = {};
    CATEGORIES.forEach((c) => { out[c.key] = []; });
    out['other'] = [];
    const groups: AssetsOverviewGroup[] = Array.isArray(overviewQ.data?.groups) ? overviewQ.data!.groups : [];
    groups.forEach((group) => {
      const groupOs = (group.os_family || '').toLowerCase();
      (group.assets || []).forEach((a) => {
        const fromSw = categoryKeyFromSoftware(a);
        if (fromSw && out[fromSw]) { out[fromSw].push(a); return; }
        const fam = (a.os_family || groupOs || '').toLowerCase();
        const rt = (a.runner_type || '').toLowerCase();
        let placed = false;
        for (const c of CATEGORIES) {
          if (c.matchOs?.includes(fam) || c.matchRunner?.includes(rt)) { out[c.key].push(a); placed = true; break; }
        }
        if (!placed) out['other'].push(a);
      });
    });
    return out;
  }, [overviewQ.data, connectionsQ.data]);

  const totals = useMemo(() => {
    let assets = 0, scanned = 0, passed = 0, failed = 0, errored = 0;
    let assetsActuallyScanned = 0, assetsWithBenchmark = 0;
    Object.values(buckets).forEach((rows) => {
      rows.forEach((a) => {
        assets += 1;
        if (a.matched_benchmark) assetsWithBenchmark += 1;
        if ((a.scanned_rules || 0) > 0) assetsActuallyScanned += 1;
        scanned += a.scanned_rules || 0;
        passed += a.passed || 0;
        failed += a.failed || 0;
        errored += a.errored || 0;
      });
    });
    const passRate = scanned > 0 ? Math.round((passed / scanned) * 100) : 0;
    return { assets, scanned, passed, failed, errored, passRate, assetsActuallyScanned, assetsWithBenchmark };
  }, [buckets]);

  const isLoading = overviewQ.isLoading || connectionsQ.isLoading;
  const error = overviewQ.error || connectionsQ.error;

  const activeCats = CATEGORIES.filter((c) => (buckets[c.key] || []).length > 0);
  const emptyCats = CATEGORIES.filter((c) => (buckets[c.key] || []).length === 0);

  return (
    <div className="inv2" style={{ background: '#F4F6F7', padding: '20px 22px', minHeight: 'calc(100vh - 46px)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 17, letterSpacing: '-.02em' }}>Compliance Overview</h2>
          <p style={{ fontSize: 12, color: '#7A8590', marginTop: 3, maxWidth: 640 }}>Every connected device, grouped by category. Click a card to drill into its devices, then a device to see the exact CIS rules applied.</p>
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: '#9BA6B2' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter devices by name or host…"
            style={{ width: 260, height: 36, border: '1px solid #E8ECEE', borderRadius: 11, background: '#fff', padding: '0 12px 0 34px', fontSize: 12.5, color: '#3A4653' }} />
        </div>
      </div>

      <ExecutiveSummary totals={totals} />

      {error && (
        <div style={{ border: '1px solid #F1C9C7', background: '#FBEAEA', borderRadius: 12, padding: '12px 14px', fontSize: 12, color: '#B23A3A', marginBottom: 14 }}>
          Failed to load: {String((error as any)?.message || error)}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 2px 11px' }}>
        <h3 style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '.06em', color: '#8A95A1' }}>Compliance by device category</h3>
        <span style={{ fontSize: 11, color: '#9BA6B2' }}>{activeCats.length} of {CATEGORIES.length} categories in use</span>
      </div>

      {isLoading ? (
        <div style={{ border: '1px solid #E8ECEE', background: '#fff', borderRadius: 14, padding: 22, textAlign: 'center', fontSize: 12.5, color: '#7A8590' }}>Loading device inventory…</div>
      ) : activeCats.length === 0 ? (
        <div style={{ border: '1px dashed #D6DCE1', background: '#fff', borderRadius: 14, padding: 30, textAlign: 'center' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#3A4653' }}>No devices connected yet</p>
          <p style={{ fontSize: 11.5, color: '#9BA6B2', marginTop: 4 }}>Connect a scanner to start monitoring compliance across your estate.</p>
        </div>
      ) : (
        <section className="cisCats">
          {activeCats.map((cat) => {
            const rows = buckets[cat.key] || [];
            const Icon = cat.icon;
            const scanned = rows.reduce((a, r) => a + (r.scanned_rules || 0), 0);
            const passed = rows.reduce((a, r) => a + (r.passed || 0), 0);
            const failed = rows.reduce((a, r) => a + (r.failed || 0), 0);
            const scannedDevices = rows.filter((r) => (r.scanned_rules || 0) > 0).length;
            const passRate = scanned > 0 ? Math.round((passed / scanned) * 100) : null;
            const dim = passRate === null;
            const accent = dim ? '#E8ECEE' : ringHex(passRate);
            const isOpen = expandedCat === cat.key;
            return (
              <button key={cat.key} type="button"
                onClick={() => { setExpandedCat(isOpen ? null : cat.key); setExpandedAsset(null); }}
                style={{ background: '#fff', border: '1px solid ' + (isOpen ? '#17B898' : '#E8ECEE'), borderRadius: 14, boxShadow: isOpen ? '0 6px 18px rgba(16,24,40,.09)' : '0 1px 2px rgba(16,24,40,.04)', padding: '12px 14px', position: 'relative', overflow: 'hidden', cursor: 'pointer', textAlign: 'left', opacity: dim ? 0.72 : 1 }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: '#F1F4F6', color: '#5B6673', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon size={15} strokeWidth={1.7} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 12.5, display: 'block' }}>{cat.label}</b>
                    <span style={{ fontSize: 10, color: '#9BA6B2', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.description}</span>
                  </div>
                  <Ring pct={dim ? null : passRate} size={48} fs={10.5} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '12px 0 4px' }}>
                  <b className="num" style={{ fontSize: 18, fontWeight: 600 }}>{rows.length}</b>
                  <span style={{ fontSize: 10.5, color: '#9BA6B2' }}>{rows.length === 1 ? 'device' : 'devices'}</span>
                </div>
                <div style={{ fontSize: 10.5, color: '#7A8590' }}>
                  {dim ? 'Not scanned yet' : (
                    <>{scannedDevices}/{rows.length} scanned · <b style={{ color: '#1F7A54' }}>{passed.toLocaleString()} pass</b>{failed > 0 && <> · <b style={{ color: '#B23A3A' }}>{failed.toLocaleString()} fail</b></>}</>
                  )}
                </div>
              </button>
            );
          })}
        </section>
      )}

      {emptyCats.length > 0 && (
        <div style={{ display: 'flex', gap: 10, background: '#E9F1FB', border: '1px solid #CFE0F2', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
          <AlertCircle size={16} style={{ color: '#2E63A8', flex: 'none', marginTop: 1 }} />
          <div style={{ fontSize: 11.5, color: '#2E5484' }}>
            <b>Not yet covered:</b> {emptyCats.map((c) => c.label).join(', ')} {emptyCats.length === 1 ? 'has' : 'have'} no connected devices.{' '}
            <Link href="/admin/agents" style={{ fontWeight: 600, color: '#2E63A8' }}>Connect a scanner →</Link>
          </div>
        </div>
      )}

      {expandedCat && (() => {
        const cat = CATEGORIES.find((c) => c.key === expandedCat);
        let rows = buckets[expandedCat] || [];
        if (!cat || rows.length === 0) return null;
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          rows = rows.filter((a) => (a.name || '').toLowerCase().includes(q) || (a.host_name || '').toLowerCase().includes(q));
        }
        const scannedDevices = rows.filter((r) => (r.scanned_rules || 0) > 0).length;
        return (
          <section style={{ background: '#fff', border: '1px solid #E8ECEE', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '15px 18px', borderBottom: '1px solid #F0F3F5' }}>
              <div>
                <h3 style={{ fontSize: 14 }}>{cat.label}</h3>
                <span style={{ fontSize: 11, color: '#8A95A1' }}>{cat.description} · {rows.length} {rows.length === 1 ? 'device' : 'devices'}{search.trim() ? ' (filtered)' : ''} · {scannedDevices} scanned</span>
              </div>
              <button type="button" onClick={() => { setExpandedCat(null); setExpandedAsset(null); }}
                style={{ height: 30, padding: '0 12px', border: '1px solid #E4E8EC', background: '#fff', borderRadius: 9, fontSize: 11.5, fontWeight: 500, color: '#3A4653', cursor: 'pointer' }}>Close</button>
            </div>
            <div style={{ padding: '14px 18px' }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#AEB8C2', marginBottom: 8 }}>Devices — click one to see its applied CIS rules</div>
              {rows.length === 0 ? (
                <div style={{ fontSize: 12, color: '#8A95A1', padding: '10px 0' }}>No devices match the current filter.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {rows.map((a) => (
                    <AssetExpand key={a.id} asset={a} expanded={expandedAsset === a.id} onToggle={() => setExpandedAsset(expandedAsset === a.id ? null : a.id)} />
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 18px', borderTop: '1px solid #F0F3F5', fontSize: 10.5, color: '#8A95A1', flexWrap: 'wrap' }}>
              <span>Matched by the two-stage AI matcher — never auto-applied; an operator confirms mappings.</span>
            </div>
          </section>
        );
      })()}
    </div>
  );
}

// ── per-device row: collapsed summary, expands to the AI-matcher stages + rules
function sevStyle(sev?: string): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    critical: ['#FBEAEA', '#B23A3A'], high: ['#FBF2DF', '#9A6410'],
    medium: ['#FBF6E5', '#8A6D1B'], low: ['#E7F5EE', '#1F7A54'],
  };
  const [bg, fg] = map[sev || ''] || ['#EEF1F3', '#5B6673'];
  return { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 600, background: bg, color: fg };
}

function AssetExpand({ asset, expanded, onToggle }: { asset: AssetRow; expanded: boolean; onToggle: () => void }) {
  const benchmarkShort = asset.matched_benchmark
    ? prettifyBenchmark(asset.matched_benchmark)
    : (RUNNER_TO_BENCHMARK_SHORT[asset.runner_type || ''] || '—');
  const isSynthetic = asset.id < 0;
  const hasOsProfile = !!(asset.os_normalized || asset.os_family);
  const [ruleLimit, setRuleLimit] = useState(25);

  const matchQ = useQuery({
    queryKey: ['compliance-overview.match', asset.id],
    queryFn: async () => (await apiClient.get(`/compliance-plugins/match-preview?asset_id=${asset.id}`)).data as any,
    enabled: expanded && !isSynthetic && hasOsProfile,
    staleTime: 60_000,
  });

  const pickedBenchmark: string | null = useMemo(() => {
    const r = matchQ.data;
    if (!r) return null;
    return (
      r.stage2_ai?.ai_picked_benchmark ||
      (Array.isArray(r.stage2_ai?.ai_picked_set) ? r.stage2_ai.ai_picked_set[0] : null) ||
      r.applicable?.examples?.[0]?.benchmark || null
    );
  }, [matchQ.data]);

  const fullRulesQ = useQuery({
    queryKey: ['compliance-overview.rules', asset.id, pickedBenchmark, ruleLimit],
    queryFn: async () => (await apiClient.get(`/compliance-plugins`, {
      params: { benchmark: pickedBenchmark, limit: ruleLimit },
    })).data as { plugins: Array<{ id: number; rule_id: string; title: string; severity: string; benchmark: string }>; total: number; returned: number; limit: number },
    enabled: expanded && !!pickedBenchmark,
    staleTime: 30_000,
  });

  const crit = asset.criticality;
  const critC: [string, string] = crit === 'critical' ? ['#FBEAEA', '#B23A3A'] : crit === 'high' ? ['#FBF2DF', '#9A6410'] : crit === 'medium' ? ['#FBF6E5', '#8A6D1B'] : ['#EEF1F3', '#5B6673'];
  const rate = asset.pass_rate ?? 0;
  const rateC = rate >= 80 ? '#1F7A54' : rate >= 50 ? '#9A6410' : '#B23A3A';
  const stageLbl: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#AEB8C2', display: 'block' };
  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 14px', borderBottom: '1px solid #E8ECEE', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8A95A1', fontWeight: 600, position: 'sticky', top: 0, background: '#FAFBFC' };
  const td: React.CSSProperties = { padding: '8px 14px' };
  const note: React.CSSProperties = { border: '1px solid #EAD9AE', background: '#FBF7EC', borderRadius: 10, padding: '11px 13px', fontSize: 11.5, color: '#7A6427', marginTop: 10 };

  return (
    <div style={{ border: '1px solid ' + (expanded ? '#17B898' : '#E8ECEE'), borderRadius: 11, background: expanded ? '#F4FBF9' : '#fff', overflow: 'hidden' }}>
      <button type="button" onClick={onToggle} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', border: 0, background: 'none', cursor: 'pointer' }}>
        {expanded ? <ChevronDown size={15} style={{ color: '#12A085', flex: 'none' }} /> : <ChevronRight size={15} style={{ color: '#9BA6B2', flex: 'none' }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#0F1F2B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.name}</span>
            {crit && <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700, borderRadius: 5, padding: '2px 6px', background: critC[0], color: critC[1] }}>{crit}</span>}
          </div>
          <div style={{ fontSize: 10.5, color: '#8A95A1', display: 'flex', alignItems: 'center', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
            <span className="mono">{asset.host_name || asset.ip_address || '—'}</span>
            {asset.matched_benchmark ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#E4F8F2', color: '#0A5A4B', borderRadius: 5, padding: '2px 7px', fontWeight: 600 }} title={asset.matched_benchmark}>
                {benchmarkShort}{typeof asset.applicable_rules === 'number' && asset.applicable_rules > 0 && <span className="mono" style={{ opacity: .8 }}>· {asset.applicable_rules} rules</span>}
              </span>
            ) : asset.runner_type ? (
              <span style={{ background: '#EEF1F3', color: '#5B6673', borderRadius: 5, padding: '2px 7px', fontWeight: 600 }}>{benchmarkShort}</span>
            ) : (
              <span style={{ background: '#FBF2DF', color: '#9A6410', borderRadius: 5, padding: '2px 7px', fontWeight: 600 }}>no benchmark mapped</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11 }}>
          <span style={{ textAlign: 'center' }}><div className="num" style={{ fontWeight: 600, color: '#0F1F2B' }}>{asset.scanned_rules ?? 0}</div><div style={{ fontSize: 9.5, color: '#9BA6B2' }}>scanned</div></span>
          <span style={{ textAlign: 'center' }}><div className="num" style={{ fontWeight: 600, color: '#1F7A54' }}>{asset.passed ?? 0}</div><div style={{ fontSize: 9.5, color: '#9BA6B2' }}>pass</div></span>
          <span style={{ textAlign: 'center' }}><div className="num" style={{ fontWeight: 600, color: '#B23A3A' }}>{asset.failed ?? 0}</div><div style={{ fontSize: 9.5, color: '#9BA6B2' }}>fail</div></span>
          <div style={{ textAlign: 'center', minWidth: 54 }}><div className="num" style={{ fontWeight: 600, color: rateC }}>{rate}%</div><div style={{ fontSize: 9.5, color: '#9BA6B2' }}>{fmtAgo(asset.last_scan_at)}</div></div>
          {!isSynthetic && (
            <Link href={`/assets/${asset.id}`} onClick={(e) => e.stopPropagation()} style={{ color: '#12A085', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>Open <ExternalLink size={12} /></Link>
          )}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '2px 14px 14px', borderTop: '1px solid #EEF1F3' }}>
          {isSynthetic && (
            <div style={{ fontSize: 11.5, color: '#7A8590', fontStyle: 'italic', padding: '10px 0' }}>
              Connection-only entry — no asset row yet. Once an agent or first scan attaches to this connection, rules will appear here.
            </div>
          )}

          {!isSynthetic && !hasOsProfile && (
            <div style={note}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>No OS profile detected for this asset</div>
              Without an OS family / version, the AI matcher can’t narrow the CIS library to a specific benchmark. Install an agent{asset.host_name ? <> on <code>{asset.host_name}</code></> : null} or run “Re-detect OS” — the first heartbeat populates OS data and rules appear here.
            </div>
          )}

          {!isSynthetic && hasOsProfile && matchQ.isLoading && (
            <div style={{ fontSize: 11.5, color: '#8A95A1', display: 'flex', alignItems: 'center', gap: 6, padding: '12px 0' }}>
              <Loader2 size={13} className="animate-spin" /> Resolving applicable rules via the AI matcher…
            </div>
          )}
          {!isSynthetic && hasOsProfile && matchQ.error && (
            <div style={{ fontSize: 11.5, color: '#B23A3A', padding: '12px 0' }}>Could not load rules. (Check that the asset has an OS profile.)</div>
          )}

          {!isSynthetic && hasOsProfile && matchQ.data && (() => {
            const r = matchQ.data;
            const total = r.applicable?.count ?? r.stage2_ai?.kept ?? 0;
            const stage1Kept = r.stage1_regex?.kept;
            const stage1Skipped = r.stage1_regex?.skipped;
            const stage2Kept = r.stage2_ai?.kept;
            const libraryTotal = r.total_plugins ?? 0;
            const stage1NarrowingFailed = stage1Kept !== undefined && libraryTotal > 0 && stage1Kept >= libraryTotal * 0.95;

            if (stage1NarrowingFailed) {
              return (
                <div style={note}>
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>OS metadata too generic — Stage 1 couldn’t narrow the rule library</div>
                  This asset has <code>os_family={asset.os_family || 'unknown'}</code>{asset.os_version ? <> · <code>os_version={asset.os_version}</code></> : null}, but no normalized build. Install a Compliverse agent on <code>{asset.host_name || 'this host'}</code> or run “Re-detect OS” so the matcher can pick a specific benchmark instead of queuing all {libraryTotal.toLocaleString()} rules.
                </div>
              );
            }

            return (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10.5, color: '#8A95A1', marginBottom: 10 }}>AI matcher · <b style={{ color: '#0F1F2B' }}>{asset.name}</b></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(200px,100%),1fr))', gap: 10, marginBottom: 14 }}>
                  <div style={{ background: '#F7F9FA', borderRadius: 11, padding: '11px 13px' }}>
                    <span style={stageLbl}>Stage 1 · OS family filter</span>
                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 5 }}>{stage1Kept ?? '—'} kept{stage1Skipped !== undefined ? ` · ${stage1Skipped} skipped` : ''}</div>
                  </div>
                  <div style={{ background: '#F7F9FA', borderRadius: 11, padding: '11px 13px' }}>
                    <span style={stageLbl}>Stage 2 · AI edition pick</span>
                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pickedBenchmark || ''}>{stage2Kept ?? '—'} kept{pickedBenchmark ? ` · ${pickedBenchmark}` : ''}</div>
                  </div>
                  <div style={{ background: '#E4F8F2', borderRadius: 11, padding: '11px 13px' }}>
                    <span style={{ ...stageLbl, color: '#0A5A4B' }}>Will execute on this device</span>
                    <div style={{ fontSize: 15, fontWeight: 700, marginTop: 5, color: '#0A5A4B' }}>{total} <span style={{ fontSize: 10.5, fontWeight: 500 }}>CIS rules</span></div>
                  </div>
                </div>

                {pickedBenchmark && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7, gap: 8 }}>
                      <span style={stageLbl}>Applicable CIS rules{fullRulesQ.data ? ` · showing ${fullRulesQ.data.returned} of ${fullRulesQ.data.total}` : ''}</span>
                      <Link href={`/assets/${asset.id}`} style={{ fontSize: 11, color: '#12A085', fontWeight: 600 }}>See full pass/fail →</Link>
                    </div>
                    {fullRulesQ.isLoading && (
                      <div style={{ fontSize: 11.5, color: '#8A95A1', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0' }}><Loader2 size={13} className="animate-spin" /> Loading {ruleLimit} rules…</div>
                    )}
                    {fullRulesQ.error && <div style={{ fontSize: 11.5, color: '#B23A3A', padding: '6px 0' }}>Failed to load rule list.</div>}
                    {fullRulesQ.data && (
                      <>
                        <div style={{ overflowX: 'auto', border: '1px solid #E8ECEE', borderRadius: 11, maxHeight: 384, overflowY: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 460 }}>
                            <thead><tr><th style={th}>Rule ID</th><th style={th}>Title</th><th style={th}>Severity</th></tr></thead>
                            <tbody>
                              {fullRulesQ.data.plugins.map((p) => (
                                <tr key={p.id} style={{ borderTop: '1px solid #F0F3F5' }}>
                                  <td style={{ ...td, fontFamily: 'ui-monospace,Consolas,monospace', color: '#3A4653' }}>{p.rule_id}</td>
                                  <td style={{ ...td, color: '#3A4653' }}>{p.title}</td>
                                  <td style={td}><span style={sevStyle(p.severity)}>{p.severity || '—'}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {fullRulesQ.data.returned < fullRulesQ.data.total && (
                          <div style={{ textAlign: 'center', padding: '8px 0 0' }}>
                            <button type="button" onClick={() => setRuleLimit(ruleLimit + 50)} style={{ fontSize: 11, color: '#12A085', fontWeight: 600, background: 'none', border: 0, cursor: 'pointer' }}>Load 50 more ({fullRulesQ.data.total - fullRulesQ.data.returned} remaining)</button>
                          </div>
                        )}
                      </>
                    )}
                    <div style={{ fontSize: 10, color: '#AEB8C2', marginTop: 8 }}>Matched by the two-stage AI matcher — never auto-applied; an operator confirms mappings.{libraryTotal > 0 ? ` Library holds ${libraryTotal.toLocaleString()} CIS rules.` : ''}</div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
