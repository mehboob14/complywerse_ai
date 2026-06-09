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
import { apiClient } from '@/lib/api';
import {
  Cloud, Database, Server, RouterIcon as RouterI, Users as UsersIcon,
  Container, CloudCog, Search, ChevronDown, ChevronRight, ExternalLink,
  Loader2, ShieldCheck, AlertTriangle, AlertCircle, CheckCircle2,
} from 'lucide-react';

type AssetRow = {
  id: number;
  name: string;
  host_name?: string | null;
  ip_address?: string | null;
  asset_type?: string | null;
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
  return 'text-red-700';
}

function passBg(rate?: number | null): string {
  if (rate === undefined || rate === null || rate === 0) return 'bg-slate-200';
  if (rate >= 80) return 'bg-emerald-500';
  if (rate >= 50) return 'bg-amber-500';
  return 'bg-red-500';
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

export default function ComplianceOverviewPage() {
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

  // ─── Bucket assets into categories ──────────────────────────────────
  const buckets = useMemo(() => {
    const out: Record<string, AssetRow[]> = {};
    CATEGORIES.forEach(c => { out[c.key] = []; });
    out['other'] = [];
    const groups: AssetsOverviewGroup[] = Array.isArray(overviewQ.data?.groups) ? overviewQ.data!.groups : [];
    const rawConnections = (connectionsQ.data as any)?.connections ?? (Array.isArray(connectionsQ.data) ? connectionsQ.data : []);
    const connections: Connection[] = Array.isArray(rawConnections) ? rawConnections : [];
    const seenHosts = new Set<string>();
    groups.forEach(group => {
      const groupOs = (group.os_family || '').toLowerCase();
      (group.assets || []).forEach(a => {
        const fam = (a.os_family || groupOs || '').toLowerCase();
        const rt  = (a.runner_type || '').toLowerCase();
        let placed = false;
        for (const c of CATEGORIES) {
          if (c.matchOs?.includes(fam) || c.matchRunner?.includes(rt)) {
            out[c.key].push(a); placed = true; break;
          }
        }
        if (!placed) out['other'].push(a);
        if (a.host_name) seenHosts.add(a.host_name.toLowerCase().trim());
      });
    });
    connections.forEach(conn => {
      const host = (conn.console_url || '').toLowerCase().trim();
      if (!host || seenHosts.has(host)) return;
      const cat = CATEGORIES.find(c => c.matchRunner?.includes(conn.integration_type));
      if (!cat) return;
      out[cat.key].push({
        id: -conn.id, name: conn.connection_name || host, host_name: conn.console_url,
        runner_type: conn.integration_type, connection_id: conn.id, has_connection: true,
      });
    });
    return out;
  }, [overviewQ.data, connectionsQ.data]);

  const totals = useMemo(() => {
    let assets = 0, scanned = 0, passed = 0, failed = 0, errored = 0;
    let assetsActuallyScanned = 0;
    let assetsWithBenchmark = 0;
    Object.values(buckets).forEach(rows => {
      rows.forEach(a => {
        assets += 1;
        if (a.matched_benchmark) assetsWithBenchmark += 1;
        if ((a.scanned_rules || 0) > 0) assetsActuallyScanned += 1;
        scanned += a.scanned_rules || 0;
        passed  += a.passed  || 0;
        failed  += a.failed  || 0;
        errored += a.errored || 0;
      });
    });
    const passRate = scanned > 0 ? Math.round((passed / scanned) * 100) : 0;
    return { assets, scanned, passed, failed, errored, passRate, assetsActuallyScanned, assetsWithBenchmark };
  }, [buckets]);

  const isLoading = overviewQ.isLoading || connectionsQ.isLoading;
  const error = overviewQ.error || connectionsQ.error;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 bg-slate-50/60 min-h-screen">
      {/* ─── Page header ─────────────────────────────────────────────── */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Compliance Overview</h1>
          <p className="mt-1 text-sm text-slate-600">
            Every connected device, grouped by category. <strong>Click a card</strong> to drill into the devices,
            then <strong>click a device</strong> to see the exact CIS rules applied.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter devices by name or host…"
            className="w-72 rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </header>

      {/* ─── Top metrics ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricTile icon={<ShieldCheck className="h-4 w-4" />} label="Devices"        value={totals.assets} />
        <MetricTile icon={<Search className="h-4 w-4" />}      label="Rules scanned"  value={totals.scanned} />
        <MetricTile icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label="Passed"   value={totals.passed}  valueClass="text-emerald-700" />
        <MetricTile icon={<AlertTriangle className="h-4 w-4 text-red-600" />}    label="Failed"   value={totals.failed}  valueClass="text-red-700" />
        <MetricTile icon={<AlertCircle  className="h-4 w-4 text-slate-500" />}   label="Errored"  value={totals.errored} valueClass="text-slate-700" />
      </div>

      {/* tenant-wide pass-rate progress */}
      {totals.scanned > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tenant pass rate</span>
            <span className={'text-sm font-semibold ' + passColor(totals.passRate)}>{totals.passRate}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={'h-full rounded-full ' + passBg(totals.passRate)} style={{ width: `${totals.passRate}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {/* Honest framing: the "across N devices" denominator was
                misleading — it counted the whole inventory while only a
                fraction had actually been scanned. Now we surface the
                real scanned/mapped/total split so the operator knows
                what coverage they have. */}
            {totals.passed.toLocaleString()} of {totals.scanned.toLocaleString()} rule runs passed.{' '}
            <span className="text-slate-400">·</span>{' '}
            {totals.assetsActuallyScanned} of {totals.assets} device{totals.assets === 1 ? '' : 's'} actually scanned
            {totals.assetsWithBenchmark > totals.assetsActuallyScanned && (
              <>
                {' '}<span className="text-slate-400">·</span>{' '}
                {totals.assetsWithBenchmark - totals.assetsActuallyScanned} more {(totals.assetsWithBenchmark - totals.assetsActuallyScanned) === 1 ? 'has' : 'have'} a benchmark mapped but {(totals.assetsWithBenchmark - totals.assetsActuallyScanned) === 1 ? 'is' : 'are'} awaiting first scan
              </>
            )}
            {totals.assets > totals.assetsWithBenchmark && (
              <>
                {' '}<span className="text-slate-400">·</span>{' '}
                {totals.assets - totals.assetsWithBenchmark} {(totals.assets - totals.assetsWithBenchmark) === 1 ? 'has' : 'have'} no benchmark mapped yet
              </>
            )}
            .
          </div>
        </div>
      )}

      {isLoading && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Loading device inventory…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load: {String((error as any)?.message || error)}
        </div>
      )}

      {/* ─── L1: category card grid ─────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Device categories</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {CATEGORIES.map(cat => {
            const rows = buckets[cat.key] || [];
            const isEmpty = rows.length === 0;
            // Empty categories were previously hidden via `return null`,
            // which collapsed the grid to whatever happened to have devices.
            // Operators now see every supported category so the panel is a
            // stable map of "where do my assets land" — empty cards display
            // a muted "0 devices" prompt instead of disappearing.
            const Icon = cat.icon;
            const scanned = rows.reduce((a, r) => a + (r.scanned_rules || 0), 0);
            const passed  = rows.reduce((a, r) => a + (r.passed  || 0), 0);
            const failed  = rows.reduce((a, r) => a + (r.failed  || 0), 0);
            const passRate = scanned > 0 ? Math.round((passed / scanned) * 100) : null;
            const isOpen = expandedCat === cat.key && !isEmpty;
            return (
              <button
                key={cat.key}
                onClick={() => {
                  if (isEmpty) return;
                  setExpandedCat(isOpen ? null : cat.key);
                  setExpandedAsset(null);
                }}
                disabled={isEmpty}
                className={
                  `group relative text-left rounded-xl border bg-gradient-to-br ${cat.cardTone.bgFrom} ${cat.cardTone.bgTo} p-4 transition-all ` +
                  (isEmpty
                    ? 'border-slate-200 opacity-70 cursor-default'
                    : isOpen
                    ? `border-transparent ring-2 ${cat.cardTone.ring} shadow-md`
                    : 'border-slate-200 hover:border-slate-300 hover:shadow-sm hover:-translate-y-0.5')
                }
              >
                <div className="flex items-start gap-3">
                  <div className={`h-11 w-11 rounded-lg flex items-center justify-center flex-shrink-0 ${cat.cardTone.iconBg} ${cat.cardTone.iconColor}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900 truncate">{cat.label}</h3>
                      <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-slate-700' : ''}`} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-1">{cat.description}</p>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className={`text-3xl font-bold leading-none ${isEmpty ? 'text-slate-400' : cat.cardTone.numText}`}>{rows.length}</span>
                      <span className="text-[11px] text-slate-500">{rows.length === 1 ? 'device' : 'devices'}</span>
                    </div>
                    {isEmpty && (
                      <div className="mt-2.5 text-[10px] text-slate-400 italic">No assets in this category</div>
                    )}
                    {!isEmpty && passRate !== null && (
                      <div className="mt-2.5">
                        <div className="flex items-center justify-between mb-1 text-[10px]">
                          <span className="text-slate-500">Pass rate</span>
                          <span className={'font-semibold ' + passColor(passRate)}>{passRate}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-white/70 overflow-hidden">
                          <div className={'h-full rounded-full transition-all ' + passBg(passRate)} style={{ width: `${passRate}%` }} />
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500 flex gap-2">
                          <span className="text-emerald-700">{passed.toLocaleString()} pass</span>
                          {failed > 0 && <span className="text-red-700">{failed.toLocaleString()} fail</span>}
                        </div>
                      </div>
                    )}
                    {!isEmpty && passRate === null && (
                      <div className="mt-2.5 text-[10px] text-slate-400 italic">Not scanned yet</div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ─── L2: expanded category panel (asset list grouped by variant) ── */}
      {expandedCat && (() => {
        const cat = CATEGORIES.find(c => c.key === expandedCat);
        let rows = buckets[expandedCat] || [];
        if (!cat || rows.length === 0) return null;
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          rows = rows.filter(a => (a.name || '').toLowerCase().includes(q) || (a.host_name || '').toLowerCase().includes(q));
        }
        const Icon = cat.icon;
        const variants: Record<string, AssetRow[]> = {};
        rows.forEach(a => {
          const v = a.os_normalized || a.os_version || a.runner_type || 'unknown';
          (variants[v] = variants[v] || []).push(a);
        });
        const sortedVariants = Object.keys(variants).sort((a, b) => variants[b].length - variants[a].length);

        return (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className={`px-5 py-4 border-b border-slate-200 flex items-center gap-3 bg-gradient-to-r ${cat.cardTone.bgFrom} to-white`}>
              <div className={`h-11 w-11 rounded-lg flex items-center justify-center ${cat.cardTone.iconBg} ${cat.cardTone.iconColor}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-slate-900">{cat.label}</h2>
                <p className="text-xs text-slate-500">{cat.description} · {rows.length} {rows.length === 1 ? 'device' : 'devices'} shown{search.trim() ? ` (filtered)` : ''}</p>
              </div>
              <button onClick={() => { setExpandedCat(null); setExpandedAsset(null); }}
                      className="text-xs text-slate-500 hover:text-slate-700 hover:bg-white px-2 py-1 rounded">
                Close
              </button>
            </header>

            {sortedVariants.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-500">No devices match the current filter.</div>
            )}

            {sortedVariants.map(variant => (
              <div key={variant} className="border-b border-slate-100 last:border-b-0">
                <div className="px-5 py-2.5 bg-slate-50 flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Variant</span>
                  <code className="text-xs bg-white px-2 py-0.5 rounded border border-slate-200 font-mono text-slate-800">{prettyVariant(variant)}</code>
                  <span className="text-[11px] text-slate-500 ml-auto">{variants[variant].length} {variants[variant].length === 1 ? 'device' : 'devices'}</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {variants[variant].map(a => (
                    <AssetExpand
                      key={a.id}
                      asset={a}
                      expanded={expandedAsset === a.id}
                      onToggle={() => setExpandedAsset(expandedAsset === a.id ? null : a.id)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })()}

      {!isLoading && !error && totals.assets === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">
            No devices onboarded yet. Add one via <Link href="/admin/agents" className="text-blue-700 hover:underline">Agents</Link>.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── L3: per-asset expanded row ─────────────────────────────────────────
function AssetExpand({ asset, expanded, onToggle }: {
  asset: AssetRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Prefer the strict-matcher's actual resolved benchmark (now returned
  // by the backend per asset). Fall back to the runner_type→short-label
  // map only when the asset hasn't been routed yet (no os_normalized /
  // no mapping covers it). This is what makes the asset card show
  // "v5.0.1 · 538 rules" instead of the generic "Win CIS".
  const benchmarkShort = asset.matched_benchmark
    ? prettifyBenchmark(asset.matched_benchmark)
    : (RUNNER_TO_BENCHMARK_SHORT[asset.runner_type || ''] || '—');
  const benchmark = benchmarkShort;
  const isSynthetic = asset.id < 0;
  // We always CALL match-preview (it's cheap) and then decide based on the
  // response whether the result is useful. If Stage 1 didn't narrow at all
  // (kept ≈ total library), the asset's OS metadata isn't sufficient and
  // we show a warning instead of the misleading "4855 will execute".
  const hasOsProfile = !!(asset.os_normalized || asset.os_family);

  const [ruleLimit, setRuleLimit] = useState(25);

  const matchQ = useQuery({
    queryKey: ['compliance-overview.match', asset.id],
    queryFn: async () => (await apiClient.get(`/compliance-plugins/match-preview?asset_id=${asset.id}`)).data as any,
    enabled: expanded && !isSynthetic && hasOsProfile,
    staleTime: 60_000,
  });

  // L3b — full applicable rule list, paged through /compliance-plugins?benchmark=…
  // Only fires once Stage 2 picked a benchmark.
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

  return (
    <li className="bg-white">
      <button
        type="button"
        onClick={onToggle}
        className={'w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors ' + (expanded ? 'bg-blue-50/40' : '')}
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-blue-700 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 truncate">{asset.name}</span>
            {asset.criticality && (
              <span className={
                'text-[10px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5 ' +
                (asset.criticality === 'critical' ? 'bg-red-100 text-red-700' :
                 asset.criticality === 'high'     ? 'bg-orange-100 text-orange-700' :
                 asset.criticality === 'medium'   ? 'bg-amber-100 text-amber-700' :
                                                    'bg-slate-100 text-slate-600')
              }>
                {asset.criticality}
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="font-mono">{asset.host_name || asset.ip_address || '—'}</span>
            {/* Benchmark badge — uses the strict-matcher's actual resolution
                when available, with the applicable rule count next to it
                so the operator sees what "scanned/passed/failed" is out
                of. No badge means the asset has no benchmark mapping yet. */}
            {asset.matched_benchmark ? (
              <span
                className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200 rounded px-1.5 py-0.5 font-medium"
                title={asset.matched_benchmark}
              >
                {benchmarkShort}
                {typeof asset.applicable_rules === 'number' && asset.applicable_rules > 0 && (
                  <span className="text-[10px] text-indigo-600 font-mono">
                    · {asset.applicable_rules} rules
                  </span>
                )}
              </span>
            ) : asset.runner_type ? (
              <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 font-medium">
                {benchmark}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 ring-1 ring-amber-200 rounded px-1.5 py-0.5 font-medium">
                no benchmark mapped
              </span>
            )}
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-5 text-xs">
          <span className="text-center"><div className="font-semibold text-slate-900">{asset.scanned_rules ?? 0}</div><div className="text-[10px] text-slate-500">scanned</div></span>
          <span className="text-center"><div className="font-semibold text-emerald-700">{asset.passed ?? 0}</div><div className="text-[10px] text-slate-500">pass</div></span>
          <span className="text-center"><div className="font-semibold text-red-700">{asset.failed ?? 0}</div><div className="text-[10px] text-slate-500">fail</div></span>
          <div className="text-center min-w-[60px]">
            <div className={'font-semibold ' + passColor(asset.pass_rate)}>{asset.pass_rate ?? 0}%</div>
            <div className="text-[10px] text-slate-500">{fmtAgo(asset.last_scan_at)}</div>
          </div>
          {!isSynthetic && (
            <Link href={`/assets/${asset.id}`} onClick={(e) => e.stopPropagation()}
                  className="text-blue-700 hover:bg-blue-50 rounded px-2 py-1 flex items-center gap-1 font-medium">
              Open <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </button>

      {/* L3 expanded — rules applied */}
      {expanded && (
        <div className="px-5 pb-4 pt-2 border-t border-slate-100 bg-slate-50/50">
          {isSynthetic && (
            <div className="text-xs text-slate-600 py-2 italic">
              Connection-only entry — no asset row yet. Once an agent or first scan attaches to this connection, rules will appear here.
            </div>
          )}

          {!isSynthetic && !hasOsProfile && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 my-2">
              <div className="font-semibold mb-1">No OS profile detected for this asset</div>
              <p className="text-amber-800">
                Without an OS family / version, the AI matcher can't narrow the CIS library to a specific benchmark.
                {asset.host_name ? (
                  <> Install an agent on <code className="bg-white px-1 rounded">{asset.host_name}</code> OR open the Connect Wizard for it — the first heartbeat will populate OS data and rules will appear here. </>
                ) : (
                  <> Onboard the asset via the Connect Wizard so its OS family + version is recorded. </>
                )}
              </p>
            </div>
          )}

          {!isSynthetic && hasOsProfile && matchQ.isLoading && (
            <div className="text-xs text-slate-500 py-3 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Resolving applicable rules via the AI matcher…
            </div>
          )}
          {!isSynthetic && hasOsProfile && matchQ.error && (
            <div className="text-xs text-red-700 py-3">Could not load rules. (Check that the asset has an OS profile.)</div>
          )}
          {!isSynthetic && hasOsProfile && matchQ.data && (() => {
            const r = matchQ.data;
            const total = r.applicable?.count ?? r.stage2_ai?.kept ?? 0;
            const stage1Kept = r.stage1_regex?.kept;
            const stage1Skipped = r.stage1_regex?.skipped;
            const stage2Kept = r.stage2_ai?.kept;
            const libraryTotal = r.total_plugins ?? 4855;

            // Sanity check — if Stage 1 didn't filter ANYTHING out, the asset's
            // OS metadata isn't precise enough for the matcher. Surface a
            // clear warning instead of showing a meaningless "4855 will execute".
            const stage1NarrowingFailed = stage1Kept !== undefined && stage1Kept >= libraryTotal * 0.95;
            if (stage1NarrowingFailed) {
              return (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="font-semibold mb-1">OS metadata too generic — Stage 1 couldn't narrow the rule library</div>
                  <p className="text-amber-800 mb-2">
                    This asset has <code className="bg-white px-1 rounded">os_family={asset.os_family || 'unknown'}</code>
                    {asset.os_version ? <> · <code className="bg-white px-1 rounded">os_version={asset.os_version}</code></> : null}
                    , but no normalized build (e.g. <code className="bg-white px-1 rounded">windows-11-25H2</code>). Without it the matcher can't pick a specific CIS benchmark — it would otherwise queue all {libraryTotal.toLocaleString()} library rules.
                  </p>
                  <p className="text-amber-800">
                    Fix: install a Compliverse agent on <code className="bg-white px-1 rounded">{asset.host_name || 'this host'}</code> (it auto-detects the build via registry / <code>/etc/os-release</code> / <code>sw_vers</code> on first heartbeat), OR run "Re-detect OS" from the asset detail page.
                  </p>
                </div>
              );
            }

            return (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Stage 1 · OS family filter</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900">{stage1Kept ?? '—'} kept</div>
                    {stage1Skipped !== undefined && <div className="text-[10px] text-slate-500">{stage1Skipped} skipped</div>}
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Stage 2 · AI edition pick</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900">{stage2Kept ?? '—'} kept</div>
                    <div className="text-[10px] text-slate-500 truncate" title={pickedBenchmark || ''}>{pickedBenchmark || '—'}</div>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-blue-700">Will execute on this device</div>
                    <div className="mt-0.5 text-xl font-bold text-blue-900">{total}</div>
                    <div className="text-[10px] text-blue-700">CIS rules</div>
                  </div>
                </div>

                {/* Full applicable rule list (paged, not just 5 samples) */}
                {pickedBenchmark && (
                  <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Applicable CIS rules</span>
                        {fullRulesQ.data && (
                          <span className="ml-2 text-[10px] text-slate-500">
                            Showing {fullRulesQ.data.returned} of {fullRulesQ.data.total}
                          </span>
                        )}
                      </div>
                      <Link href={`/assets/${asset.id}`} className="text-[11px] text-blue-700 hover:underline font-medium">
                        See full results with pass/fail →
                      </Link>
                    </div>

                    {fullRulesQ.isLoading && (
                      <div className="px-3 py-3 text-xs text-slate-500 flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading {ruleLimit} rules from <code className="font-mono">{pickedBenchmark}</code>…
                      </div>
                    )}
                    {fullRulesQ.error && (
                      <div className="px-3 py-3 text-xs text-red-700">Failed to load rule list.</div>
                    )}
                    {fullRulesQ.data && (
                      <>
                        <div className="max-h-96 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 text-[10px] uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-200">
                              <tr>
                                <th className="text-left px-3 py-1.5 w-24 font-medium">Rule ID</th>
                                <th className="text-left px-3 py-1.5 font-medium">Title</th>
                                <th className="text-left px-3 py-1.5 w-20 font-medium">Severity</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {fullRulesQ.data.plugins.map((p) => (
                                <tr key={p.id} className="hover:bg-slate-50">
                                  <td className="px-3 py-1.5 font-mono text-slate-700">{p.rule_id}</td>
                                  <td className="px-3 py-1.5 text-slate-700">{p.title}</td>
                                  <td className="px-3 py-1.5">
                                    <span className={
                                      'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ' +
                                      (p.severity === 'critical' ? 'bg-red-100 text-red-700' :
                                       p.severity === 'high'     ? 'bg-orange-100 text-orange-700' :
                                       p.severity === 'medium'   ? 'bg-amber-100 text-amber-700' :
                                       p.severity === 'low'      ? 'bg-emerald-100 text-emerald-700' :
                                                                    'bg-slate-100 text-slate-600')
                                    }>
                                      {p.severity || '—'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {fullRulesQ.data.returned < fullRulesQ.data.total && (
                          <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-center">
                            <button
                              onClick={() => setRuleLimit(ruleLimit + 50)}
                              className="text-[11px] text-blue-700 hover:underline font-medium"
                            >
                              Load 50 more ({fullRulesQ.data.total - fullRulesQ.data.returned} remaining)
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </li>
  );
}

function MetricTile({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: number; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tracking-tight ${valueClass || 'text-slate-900'}`}>{value.toLocaleString()}</div>
    </div>
  );
}
