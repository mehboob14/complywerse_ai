'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrationsApi, assetsApi } from '@/cyber-assurance/lib/api';
import {
  Loader2,
  Play,
  Square,
  Search,
  AlertCircle,
  ExternalLink,
  Plus,
  KeyRound,
  RotateCw,
  Check,
  Server,
  ChevronRight,
  X,
  Trash2,
} from 'lucide-react';

interface Conn {
  id: number;
  connection_name: string;
  integration_type: string;
  is_active: boolean;
}

interface ScanCredential {
  id: number;
  name: string;
  kind: string; // 'winrm' | 'ssh'
  username: string;
  applies_to_cidrs?: string[];
}

// An inventory asset, mapped to what the picker needs. Named — a real asset in
// the IT inventory, never a raw discovery observation (a swept host that isn't
// an asset yet can't own vulnerabilities, so it can't be a scan target here).
interface Asset {
  id: number;
  name: string;
  ip: string;
  os: string;
  type: string;
  crit: string;
  target: string;
}

const KIND_LABEL: Record<string, string> = { winrm: 'Windows', ssh: 'SSH' };
const UNKNOWN = /^(unknown|unidentified|n\/?a|none)$/i;

const SEV = [
  { key: 'critical', label: 'Critical', color: '#e11d48' },
  { key: 'high', label: 'High', color: '#f97316' },
  { key: 'medium', label: 'Medium', color: '#f59e0b' },
  { key: 'low', label: 'Low', color: '#eab308' },
  { key: 'info', label: 'Info', color: '#3b82f6' },
] as const;
type SevCounts = { critical: number; high: number; medium: number; low: number; info: number };

type RunStatus = 'creating' | 'running' | 'completed' | 'failed' | 'aborted' | 'stopped';

interface NessusHost {
  host: string;
  authenticated: boolean;
  critical: number; high: number; medium: number; low: number; info: number;
  total: number;
}
interface NessusDetail {
  policy: string;
  scanner: string;
  status: string;
  severity_base: string;
  start: number | null;
  end: number | null;
  host_count: number | null;
  severity: SevCounts;
  hosts: NessusHost[];
}

interface Run {
  id: number;
  connection_id: number;
  targets: string;
  scan_name: string;
  status: RunStatus;
  progress: number;
  hosts_total: number;
  hosts_done: number;
  vulns_new: number;
  vulns_total: number;
  vulns_closed?: number | null;
  vulns_reopened?: number | null;
  error?: string | null;
  created_at: string;
  finished_at?: string | null;
  nessus?: NessusDetail | null;
}

const ACTIVE: RunStatus[] = ['creating', 'running'];
const TERMINAL: RunStatus[] = ['completed', 'failed', 'aborted', 'stopped'];

function statusClasses(status: string) {
  return status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'running' || status === 'creating' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : status === 'stopped' || status === 'aborted' ? 'bg-slate-100 text-slate-500 border-slate-200'
    : 'bg-rose-50 text-rose-700 border-rose-200';
}
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusClasses(status)}`}>
      {status}
    </span>
  );
}
function Chip({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'emerald' | 'indigo' | 'rose' }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-700'
    : tone === 'indigo' ? 'bg-indigo-50 text-indigo-700'
    : tone === 'rose' ? 'bg-rose-50 text-rose-600'
    : 'bg-slate-100 text-slate-500';
  return <span className={`inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 whitespace-nowrap ${cls}`}>{children}</span>;
}

const critRank = (c: string) => ({ critical: 0, high: 1, medium: 2, low: 3 }[c] ?? 4);
const sevTotal = (c: SevCounts) => SEV.reduce((s, x) => s + (c[x.key] || 0), 0);
function fmtTime(epoch: number | null) {
  if (!epoch) return '—';
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtElapsed(start: number | null, end: number | null) {
  if (!start) return '—';
  const secs = (end || Math.floor(Date.now() / 1000)) - start;
  if (secs < 0) return '—';
  const m = Math.floor(secs / 60), s = secs % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Which saved logins reach an asset — kind by OS (winrm↔Windows, ssh↔Linux),
// and CIDR scope (blank = all hosts). This is the per-asset login the picker
// shows and Nessus reuses; mirrors the backend's discovery `_covered`.
function ipv4ToInt(ip: string): number | null {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}
function ipInCidr(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.trim().split('/');
  const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
  const a = ipv4ToInt(ip), b = ipv4ToInt(net);
  if (a === null || b === null || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

function ProgressRing({ pct, active, size = 68, stroke = 7 }: { pct: number; active: boolean; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct || 0));
  const off = circ - (clamped / 100) * circ;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-100" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={off}
          className={`transition-all duration-700 ${active ? 'stroke-amber-500' : clamped >= 100 ? 'stroke-emerald-500' : 'stroke-slate-300'}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-semibold text-slate-900 tabular-nums">{Math.round(clamped)}%</span>
      </div>
    </div>
  );
}

function SeverityBar({ counts }: { counts: SevCounts }) {
  const total = sevTotal(counts);
  if (!total) return <span className="text-xs text-slate-300">no findings</span>;
  return (
    <div className="flex h-5 w-full rounded overflow-hidden bg-slate-50 min-w-[120px]">
      {SEV.map((x) => {
        const n = counts[x.key] || 0;
        if (!n) return null;
        return (
          <div key={x.key} style={{ width: `${(n / total) * 100}%`, background: x.color }}
            title={`${x.label}: ${n}`}
            className="flex items-center justify-center text-[10px] font-semibold text-white tabular-nums">
            {(n / total) > 0.05 ? n : ''}
          </div>
        );
      })}
    </div>
  );
}

function SeverityDonut({ counts }: { counts: SevCounts }) {
  const total = sevTotal(counts);
  let acc = 0;
  const stops = total > 0
    ? SEV.filter((x) => (counts[x.key] || 0) > 0).map((x) => {
        const from = (acc / total) * 100; acc += counts[x.key] || 0; const to = (acc / total) * 100;
        return `${x.color} ${from}% ${to}%`;
      }).join(', ')
    : '#e2e8f0 0% 100%';
  return (
    <div className="relative shrink-0" style={{ width: 104, height: 104 }}>
      <div className="rounded-full w-full h-full" style={{ background: `conic-gradient(${stops})` }} />
      <div className="absolute rounded-full bg-white" style={{ inset: 16 }} />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-slate-900 tabular-nums">{total}</span>
        <span className="text-[10px] text-slate-400 uppercase tracking-wide">findings</span>
      </div>
    </div>
  );
}

// Flow 1 — Complyverse drives the Nessus on your machine. Assets come from the IT
// inventory (each with its saved login), chosen in a side panel; the live scan
// mirrors the Nessus view; history lives in its own tab, not a long scroll.
export default function HostedScanPage() {
  const queryClient = useQueryClient();
  const credInit = useRef(false);
  const [connId, setConnId] = useState<number | null>(null);
  const [scanName, setScanName] = useState('');
  const [manual, setManual] = useState('');
  const [picked, setPicked] = useState<Map<number, string>>(new Map()); // asset id → target
  const [creds, setCreds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [runId, setRunId] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState<'scan' | 'history'>('scan');

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [drawerOpen]);

  const { data: connData, isLoading: connLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: () => integrationsApi.listConnections(),
  });
  const conns: Conn[] = (connData?.data?.connections || []).filter((c: Conn) =>
    ['nessus', 'tenable'].includes(c.integration_type),
  );
  const activeEngines = conns.filter((c) => c.is_active);
  useEffect(() => {
    if (connId == null && activeEngines.length >= 1) setConnId(activeEngines[0].id);
  }, [connId, activeEngines]);

  const { data: credData, isLoading: credLoading, isError: credError } = useQuery({
    queryKey: ['scan-credentials', connId],
    queryFn: () => integrationsApi.getScanCredentials(connId as number),
    enabled: connId != null,
    retry: false,
  });
  const scanCreds: ScanCredential[] = credData?.data?.credentials || [];
  useEffect(() => {
    if (!credInit.current && scanCreds.length) {
      setCreds(new Set(scanCreds.map((c) => c.id)));
      credInit.current = true;
    }
  }, [scanCreds]);
  const toggleCred = (id: number) =>
    setCreds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const activeCreds = scanCreds.filter((c) => creds.has(c.id));

  // Saved logins that reach a given asset — the login shown on its row and
  // reused by Nessus when it's scanned.
  const coveringCreds = (a: Asset): ScanCredential[] => {
    const osl = a.os.toLowerCase();
    const wantKind = osl.startsWith('win') ? 'winrm'
      : /linux|ubuntu|debian|cent|rhel|unix|nix|fedora/.test(osl) ? 'ssh' : null;
    return scanCreds.filter((c) => {
      if (wantKind && c.kind !== wantKind) return false;
      const cidrs = c.applies_to_cidrs || [];
      if (!cidrs.length) return true;
      return a.ip ? cidrs.some((cd) => ipInCidr(a.ip, cd)) : false;
    });
  };

  // Named assets from the IT inventory — the only valid scan targets here.
  const { data: assetData, isError: assetError, isFetching: assetFetching } = useQuery({
    queryKey: ['inventory-assets'],
    queryFn: () => assetsApi.getAll({ limit: 500 }),
    retry: false,
  });
  const assets: Asset[] = useMemo(() => {
    const raw = (assetData?.data || []) as any[];
    return raw
      .map((a) => {
        const ip = (a.ip_address || '') as string;
        const host = (a.host_name || a.fqdn || '') as string;
        const rawOs = String(a.os_family || '').trim();
        return {
          id: a.id as number,
          name: (a.name || host || ip) as string,
          ip,
          os: UNKNOWN.test(rawOs) ? '' : rawOs,
          type: (a.asset_type || '') as string,
          crit: (a.criticality || '') as string,
          target: ip || host || (a.name as string),
        };
      })
      .filter((a) => !!a.target)
      .sort((a, b) => critRank(a.crit) - critRank(b.crit) || a.name.localeCompare(b.name));
  }, [assetData]);

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? assets.filter((a) =>
          a.name.toLowerCase().includes(q) || a.ip.toLowerCase().includes(q) ||
          a.os.toLowerCase().includes(q) || a.type.toLowerCase().includes(q))
      : assets;
  }, [assets, search]);

  const ipToAsset = useMemo(() => {
    const m: Record<string, number> = {};
    assets.forEach((a) => { if (a.ip) m[a.ip] = a.id; });
    return m;
  }, [assets]);

  const pickedTargets = useMemo(() => Array.from(picked.values()), [picked]);
  const targets = useMemo(
    () => [...pickedTargets, manual.trim()].filter(Boolean).join(', '),
    [pickedTargets, manual],
  );
  const selectedCount = picked.size + (manual.trim() ? 1 : 0);
  const summaryChips = [...pickedTargets, ...(manual.trim() ? [manual.trim()] : [])];

  const toggleAsset = (id: number, target: string) =>
    setPicked((prev) => {
      const next = new Map(prev);
      next.has(id) ? next.delete(id) : next.set(id, target);
      return next;
    });
  const allFilteredPicked = filteredAssets.length > 0 && filteredAssets.every((a) => picked.has(a.id));
  const toggleAllFiltered = () =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (allFilteredPicked) filteredAssets.forEach((a) => next.delete(a.id));
      else filteredAssets.forEach((a) => next.set(a.id, a.target));
      return next;
    });

  const { data: liveData, isFetching: liveFetching } = useQuery({
    queryKey: ['hosted-scan', runId],
    queryFn: () => integrationsApi.getHostedScan(runId as number),
    enabled: runId != null,
    refetchInterval: (query) => {
      const s = query.state.data?.data?.status as RunStatus | undefined;
      return s && TERMINAL.includes(s) ? false : 3000;
    },
  });
  const run: Run | undefined = liveData?.data;

  const { data: recentData } = useQuery({
    queryKey: ['hosted-scans', connId],
    queryFn: () => integrationsApi.listHostedScans(connId as number, { limit: 30 }),
    enabled: connId != null,
    refetchInterval: (query) => {
      const rs = (query.state.data?.data?.runs || []) as Run[];
      return rs.some((r) => ACTIVE.includes(r.status)) ? 5000 : false;
    },
  });
  const recent: Run[] = recentData?.data?.runs || [];
  // The clicked session first — so while its detail loads, the panel already shows
  // THAT scan, not a flash of the newest one — else newest active, else newest.
  const shownRunLite: Run | undefined =
    (runId != null ? recent.find((r) => r.id === runId) : undefined)
    || recent.find((r) => ACTIVE.includes(r.status)) || recent[0];
  useEffect(() => {
    if (runId == null && shownRunLite) setRunId(shownRunLite.id);
  }, [runId, shownRunLite]);
  const shownRun: Run | undefined = run || shownRunLite;
  const shownActive = !!shownRun && ACTIVE.includes(shownRun.status);
  const nessus = run?.nessus || null;

  const scan = useMutation({
    mutationFn: () =>
      integrationsApi.triggerHostedScan(connId as number, {
        targets,
        scan_name: scanName.trim() || undefined,
        credential_profile_ids: creds.size ? Array.from(creds) : undefined,
      }),
    onSuccess: (res) => {
      setRunId(res.data?.run_id ?? null);
      setDrawerOpen(false);
      setView('scan');
      queryClient.invalidateQueries({ queryKey: ['hosted-scans', connId] });
    },
    onError: (err: any) =>
      setStartError(err?.response?.data?.detail || 'Could not start the scan.'),
  });

  const stop = useMutation({
    mutationFn: (id: number) => integrationsApi.stopHostedScan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hosted-scans', connId] });
      queryClient.invalidateQueries({ queryKey: ['hosted-scan', runId] });
    },
  });

  // Delete a session from history. Drop it from the cached list before clearing
  // the selection, so the panel falls back to the next scan, not the deleted one.
  const del = useMutation({
    mutationFn: (id: number) => integrationsApi.deleteHostedScan(id),
    onSuccess: (_res, id) => {
      queryClient.setQueryData(['hosted-scans', connId], (old: any) =>
        old ? { ...old, data: { ...old.data, runs: (old.data?.runs || []).filter((r: Run) => r.id !== id) } } : old);
      queryClient.removeQueries({ queryKey: ['hosted-scan', id] });
      if (runId === id) setRunId(null);
      queryClient.invalidateQueries({ queryKey: ['hosted-scans', connId] });
    },
    onError: (err: any) =>
      setStartError(err?.response?.data?.detail || 'Could not delete the scan.'),
  });
  const confirmDelete = (r: Run) => {
    const name = r.scan_name || `Scan #${r.id}`;
    const msg = ACTIVE.includes(r.status)
      ? `Stop and delete "${name}"?\n\nIt is still running — it will be stopped on Nessus first. Findings already filed to assets stay.`
      : `Delete "${name}" from history?\n\nFindings already filed to assets stay.`;
    if (window.confirm(msg)) del.mutate(r.id);
  };

  // Open a past run's details in the Scan tab.
  const openRun = (id: number) => { setRunId(id); setView('scan'); };
  // Re-run a past scan's targets (prefill + open the picker).
  const rescan = (r: Run) => {
    setPicked(new Map());
    setManual(r.targets || '');
    setScanName(r.scan_name || '');
    setStartError(null);
    setDrawerOpen(true);
  };

  const canStart = connId != null && targets.length > 0 && !scan.isPending;

  return (
    // The page name lives in the white header bar (Header PAGE_TITLES), so there is
    // no title row here. Pinned to the viewport: the negative top margin eats most
    // of <main>'s padding (lifting the page to just under the header) and the
    // height adds it back, so title-less config/tabs stay fixed and only the
    // results area scrolls, and only if a scan has many hosts. The page never does.
    <div className="-mt-2 lg:-mt-3 h-[calc(100%+0.5rem)] lg:h-[calc(100%+0.75rem)] w-full max-w-6xl mx-auto flex flex-col gap-3 min-h-0">
      {/* Config — slim: engine, choose in the side panel, name, start */}
      <div className="shrink-0 bg-white rounded-xl border border-slate-200 p-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {connLoading ? (
            <span className="text-xs text-slate-400 inline-flex items-center gap-1.5 shrink-0"><Loader2 size={12} className="animate-spin" /> engine…</span>
          ) : activeEngines.length === 0 ? (
            <Link href="/cyber-assurance/scan-flows/connect" className="text-xs text-primary-600 font-medium shrink-0">Add a scan engine first →</Link>
          ) : activeEngines.length === 1 ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-xs text-emerald-700 shrink-0 self-start lg:self-auto">
              <Server size={12} /> Complyverse Engine <Check size={11} />
            </span>
          ) : (
            <select value={connId ?? ''} onChange={(e) => setConnId(e.target.value ? Number(e.target.value) : null)}
              className="px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 shrink-0">
              {activeEngines.map((c, i) => <option key={c.id} value={c.id}>Complyverse Engine #{i + 1}</option>)}
            </select>
          )}
          <button type="button" onClick={() => setDrawerOpen(true)}
            className="flex-1 flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-slate-200 hover:border-primary-300 hover:bg-primary-50/40 transition text-left">
            <span className="flex items-center gap-2.5 min-w-0">
              <Search size={16} className="text-primary-600 shrink-0" />
              <span className="text-sm font-medium text-slate-800">
                {selectedCount > 0 ? `${selectedCount} asset${selectedCount > 1 ? 's' : ''} selected` : 'Choose assets & logins'}
              </span>
            </span>
            <ChevronRight size={16} className="text-slate-400 shrink-0" />
          </button>
          <input value={scanName} onChange={(e) => setScanName(e.target.value)} placeholder="Scan name (optional)"
            className="lg:w-56 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          <button onClick={() => { setStartError(null); scan.mutate(); }} disabled={!canStart}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-[#0a0a0a] bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 shrink-0">
            {scan.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            Scan {selectedCount > 0 ? selectedCount : ''}
          </button>
        </div>

        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3 pt-3 border-t border-slate-100">
            <div className="flex flex-wrap gap-1.5">
              {summaryChips.slice(0, 12).map((t, i) => (
                <span key={`${t}-${i}`} className="text-xs font-mono rounded bg-slate-100 text-slate-600 px-1.5 py-0.5">{t}</span>
              ))}
              {summaryChips.length > 12 && <span className="text-xs text-slate-400 self-center">+{summaryChips.length - 12}</span>}
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs ml-auto">
              <KeyRound size={12} className={creds.size ? 'text-emerald-600' : 'text-slate-400'} />
              {creds.size
                ? <span className="text-emerald-600">Authenticated · {activeCreds.map((c) => `${KIND_LABEL[c.kind] || c.kind} · ${c.username}`).join(', ')}</span>
                : <span className="text-slate-400">Network-only</span>}
            </span>
          </div>
        )}

        {startError && (
          <div className="flex items-start gap-2 p-3 mt-3 rounded-lg text-sm bg-rose-50 text-rose-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0" /> {startError}
          </div>
        )}
      </div>

      {/* Tabs — Scan results vs History (its own view, not a long scroll) */}
      <div className="shrink-0 flex items-center gap-1 border-b border-slate-200">
        {([['scan', 'Live scan'], ['history', `History${recent.length ? ` (${recent.length})` : ''}`]] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setView(v)}
            className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition ${view === v ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
      {view === 'scan' ? (
        shownRun ? (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-100">
              <ProgressRing pct={shownRun.progress || (shownRun.status === 'completed' ? 100 : 0)} active={shownActive} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 truncate">{shownRun.scan_name || `Scan #${shownRun.id}`}</span>
                  <StatusBadge status={shownRun.status} />
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Hosts <span className="font-semibold text-slate-700 tabular-nums">{shownRun.status === 'completed' ? (nessus?.hosts.length ?? shownRun.hosts_total ?? 0) : (shownRun.hosts_done || 0)}/{shownRun.hosts_total || nessus?.host_count || 0}</span>
                  {shownActive && <span className="text-amber-600 ml-2">scanning…</span>}
                </div>
              </div>
              {shownActive ? (
                <button onClick={() => stop.mutate(shownRun.id)} disabled={stop.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 disabled:opacity-50 shrink-0">
                  <Square size={12} /> Stop
                </button>
              ) : shownRun.status === 'completed' ? (
                <Link href="/cyber-assurance/vulnerabilities" className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 shrink-0">
                  View findings <ExternalLink size={13} />
                </Link>
              ) : null}
              <button onClick={() => confirmDelete(shownRun)} disabled={del.isPending} title="Delete this scan"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-lg hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 disabled:opacity-50 shrink-0">
                {del.isPending && del.variables === shownRun.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
              </button>
            </div>

            {shownRun.error && (
              <div className="flex items-start gap-2 px-5 py-3 text-sm bg-rose-50 text-rose-700 border-b border-rose-100">
                <AlertCircle size={15} className="mt-0.5 shrink-0" /> {shownRun.error}
              </div>
            )}

            {/* Hosts table + scan details/donut, top-aligned so one host doesn't
                leave a stretched empty box below it. */}
            <div className="flex flex-col lg:flex-row items-start">
              <div className="w-full lg:flex-1 lg:border-r border-slate-100">
                <div className="px-5 py-3 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {nessus?.hosts?.length || shownRun.hosts_total || 0} Host{(nessus?.hosts?.length || 0) === 1 ? '' : 's'}
                </div>
                {nessus && nessus.hosts.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="font-medium px-5 py-2">Host</th>
                        <th className="font-medium px-2 py-2">Auth</th>
                        <th className="font-medium px-2 py-2 pr-5">Vulnerabilities</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {nessus.hosts.map((h, hi) => {
                        const aid = ipToAsset[h.host];
                        return (
                          <tr key={`${h.host}-${hi}`} className="hover:bg-slate-50/60">
                            <td className="px-5 py-2.5 font-mono text-slate-800 whitespace-nowrap">
                              {aid ? <Link href={`/cyber-assurance/assets/${aid}`} className="text-primary-700 hover:underline inline-flex items-center gap-1">{h.host}<ExternalLink size={11} /></Link> : h.host}
                            </td>
                            <td className="px-2 py-2.5">
                              {h.authenticated
                                ? <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium"><Check size={13} /> Yes</span>
                                : <span className="text-slate-400 text-xs">N/A</span>}
                            </td>
                            <td className="px-2 py-2.5 pr-5 w-1/2"><SeverityBar counts={h} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="px-5 py-10 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
                    <Loader2 size={18} className={shownActive ? 'animate-spin text-amber-500' : 'text-slate-300'} />
                    {shownActive ? 'Waiting for Nessus to report the first host…' : liveFetching ? 'Loading this scan…' : 'No host detail available for this scan.'}
                  </div>
                )}
              </div>

              <div className="w-full lg:w-80 shrink-0 p-4 space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Scan Details</h3>
                  <dl className="space-y-1.5 text-sm">
                    {[
                      ['Policy', nessus?.policy || 'Basic Network Scan'],
                      ['Status', nessus?.status || shownRun.status],
                      ['Severity Base', nessus?.severity_base || 'CVSS v3.0'],
                      ['Scanner', nessus?.scanner || 'Local Scanner'],
                      ['Start', fmtTime(nessus?.start ?? null)],
                      ['End', nessus?.end ? fmtTime(nessus.end) : (shownActive ? 'running…' : '—')],
                      ['Elapsed', fmtElapsed(nessus?.start ?? null, nessus?.end ?? null)],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex justify-between gap-3">
                        <dt className="text-slate-400">{k}</dt>
                        <dd className="text-slate-800 font-medium text-right truncate">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Vulnerabilities</h3>
                  <div className="flex items-center gap-4">
                    <SeverityDonut counts={nessus?.severity || { critical: 0, high: 0, medium: 0, low: 0, info: 0 }} />
                    <ul className="space-y-1 text-xs flex-1">
                      {SEV.map((x) => (
                        <li key={x.key} className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} />
                          <span className="text-slate-500">{x.label}</span>
                          <span className="text-slate-800 font-semibold tabular-nums ml-auto">{nessus?.severity?.[x.key] ?? 0}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
            Choose assets and press <span className="font-medium text-slate-600">Scan</span> — the live scan shows here, the Nessus way.
          </div>
        )
      ) : (
        /* History — its own view: every run as a row, click to open its details */
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {recent.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">No scans yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="font-medium px-5 py-2.5">Scan</th>
                  <th className="font-medium px-2 py-2.5">Targets</th>
                  <th className="font-medium px-2 py-2.5">Status</th>
                  <th className="font-medium px-2 py-2.5">When</th>
                  <th className="font-medium px-2 py-2.5">Findings</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recent.map((r) => (
                  <tr key={r.id} className={`hover:bg-slate-50/60 cursor-pointer ${runId === r.id ? 'bg-primary-50/40' : ''}`} onClick={() => openRun(r.id)}>
                    <td className="px-5 py-3 font-medium text-slate-800 whitespace-nowrap">{r.scan_name || `Scan #${r.id}`}</td>
                    <td className="px-2 py-3 font-mono text-xs text-slate-600 max-w-[220px] truncate" title={r.targets}>{r.targets}</td>
                    <td className="px-2 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-2 py-3 text-xs text-slate-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-2 py-3 text-xs whitespace-nowrap">
                      {r.status === 'completed' ? <span className="text-emerald-600">+{r.vulns_new || 0} new · {r.vulns_total || 0} total</span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {ACTIVE.includes(r.status) ? (
                        <button onClick={() => stop.mutate(r.id)} disabled={stop.isPending} title="Stop"
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"><Square size={14} /></button>
                      ) : (
                        <button onClick={() => rescan(r)} title="Re-scan (verify fixes)"
                          className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg"><RotateCw size={14} /></button>
                      )}
                      <button onClick={() => confirmDelete(r)} disabled={del.isPending} title="Delete this scan"
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg disabled:opacity-50">
                        {del.isPending && del.variables === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      </div>

      {/* ── Side panel: choose assets + logins ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-full max-w-xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Choose what to scan</h2>
                <p className="text-xs text-slate-400 mt-0.5">Assets from your IT inventory · each row shows the login Nessus reuses</p>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
                <X size={18} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {connId != null && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <KeyRound size={14} className={creds.size ? 'text-emerald-600' : 'text-slate-400'} />
                    <span className="text-sm font-medium text-slate-700">Saved logins</span>
                    <span className={`text-xs ml-1 ${creds.size ? 'text-emerald-600' : 'text-slate-400'}`}>{creds.size ? 'reused automatically' : 'network-only'}</span>
                  </div>
                  {credLoading ? (
                    <span className="text-xs text-slate-400">loading…</span>
                  ) : credError || scanCreds.length === 0 ? (
                    <span className="text-xs text-slate-400">none saved — <Link href="/cyber-assurance/scan-flows/connect" className="text-primary-600 font-medium">add one</Link> for an authenticated scan</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {scanCreds.map((c) => {
                        const on = creds.has(c.id);
                        return (
                          <button key={c.id} type="button" onClick={() => toggleCred(c.id)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition ${on ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                            {on ? <Check size={12} /> : <Plus size={12} />}
                            {KIND_LABEL[c.kind] || c.kind} · {c.username}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700">Assets <span className="text-xs font-normal text-slate-400">· from IT inventory</span></label>
                  <span className="text-xs text-slate-400">{picked.size} selected</span>
                </div>

                {assetError ? (
                  <div className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-lg p-3">Couldn&apos;t load assets.</div>
                ) : assets.length === 0 ? (
                  <div className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center gap-2">
                    {assetFetching ? <><Loader2 size={14} className="animate-spin" /> Loading…</> : 'No assets in inventory yet — type a target below.'}
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50">
                      <Search size={14} className="text-slate-400" />
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, IP, type…"
                        className="flex-1 bg-transparent text-sm focus:outline-none" />
                      <button type="button" onClick={toggleAllFiltered} className="text-xs font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap">
                        {allFilteredPicked ? 'Clear' : 'Select all'}
                      </button>
                    </div>
                    <div className="max-h-[46vh] overflow-y-auto divide-y divide-slate-50">
                      {filteredAssets.length === 0 ? (
                        <p className="text-sm text-slate-400 px-3 py-3">No assets match.</p>
                      ) : (
                        filteredAssets.map((a) => {
                          const cov = coveringCreds(a);
                          const first = cov[0];
                          return (
                            <label key={a.id} className="flex items-center gap-2.5 px-3 py-2.5 text-sm cursor-pointer hover:bg-slate-50">
                              <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggleAsset(a.id, a.target)}
                                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 shrink-0" />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium text-slate-800 truncate">{a.name}</span>
                                  {a.crit && <Chip tone={a.crit === 'critical' || a.crit === 'high' ? 'rose' : 'slate'}>{a.crit}</Chip>}
                                </span>
                                <span className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                                  {a.ip && <span className="font-mono">{a.ip}</span>}
                                  {a.type && <span>· {a.type}</span>}
                                </span>
                              </span>
                              {first ? (
                                <Chip tone="emerald"><KeyRound size={10} /> {KIND_LABEL[first.kind] || first.kind} · {first.username}{cov.length > 1 ? ` +${cov.length - 1}` : ''}</Chip>
                              ) : (
                                <span className="text-[11px] text-slate-300 shrink-0">no login</span>
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                <input value={manual} onChange={(e) => setManual(e.target.value)}
                  placeholder="…or type a target:  10.50.0.12   or   10.50.0.0/24"
                  className="w-full mt-2 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-slate-100 bg-slate-50/60">
              <span className="text-xs text-slate-500">{selectedCount} asset{selectedCount === 1 ? '' : 's'} · {creds.size ? 'authenticated' : 'network-only'}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setDrawerOpen(false)} className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Done</button>
                <button type="button" onClick={() => { setStartError(null); scan.mutate(); }} disabled={!canStart}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0a0a0a] bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50">
                  {scan.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  Scan {selectedCount > 0 ? selectedCount : ''}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
