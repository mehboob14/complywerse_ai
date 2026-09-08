'use client';

/*
 * CompliancePanel — asset-detail "Compliance" tab.
 *
 * Layout is a 1:1 transplant of the owner's mock
 * (Redesign project kickoff/Asset Record.dc.html, the `data-panel="comp"`
 * block): header card with score ring + benchmark line + Scan button, a
 * four-way sub-tab pill bar (Host group · Benchmark match · Scan sessions ·
 * Activity), and the compact card/row sizes, paddings, pills and mint-teal
 * tokens from that file. Content-only — the page shell owns the rail /
 * top bar / asset tab bar, so the root stays a plain flex column.
 *
 * Every real data source and behavior is preserved — only the arrangement
 * changed. Where each query lands:
 *   ['assets', id, 'ip-peers']                  → Host group tab (IP group,
 *       host row, software-with-benchmark rows, no-benchmark <details>),
 *       Benchmark match tab (classified software, include-in-scope rows),
 *       plus the connect CTAs.
 *   ['compliance-plugins','match-preview', id]  → header benchmark + rule
 *       counts, Benchmark match tab (AI Classification KVs, matched
 *       benchmark + mapping chain, rule funnel, sample rule preview).
 *   ['compliance-plugins','runs', id]           → header score ring /
 *       pass·fail line, Scan sessions tab, Activity tab.
 *   reDetectMut  → "↺ Re-detect OS" in AI Classification.
 *   scanMutation → header "Scan now"/"Rescan" + the host-row button, live
 *       progress under the header and in the running-session row.
 *   useRoomScan  → the "include in scan scope" checkboxes (same shared
 *       selection HostApplicationsPanel writes), folded into the scan payload.
 *   Every GuideMarker keeps its exact id + number.
 *
 * Nothing the backend doesn't return is faked: runs carry no per-rule
 * benchmark, so a session shows the asset's own host-OS group only (peer
 * runs live on their own asset pages, as the scan toast says).
 *
 * Must render inside a <RoomScanProvider> (../page.tsx does today).
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Network, Zap } from 'lucide-react';
import { apiClient, assetsApi, compliancePluginsApi } from '@/lib/api';
import { GuideMarker } from '@/components/guide';
import { useRoomScan } from '../_room-scan-context';
import { softwareKeyToSqlPlatform } from '@/components/integrations/SqlDbForm';

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ── design tokens, verbatim from the mock's :root ──
   --ac #17B898 · --ac-strong #12A085 · --ac-soft #E4F8F2 · --blue #2E63A8 /
   #E9F1FB · --violet #6A54C9 / #EEEBFA · --red #B23A3A / #FBEAEA ·
   --amber #9A6410 / #FBF2DF · --green #1F7A54 / #E7F5EE · --muted #8A95A1 ·
   --faint #AEB8C2 · --border #E8ECEE · --border2 #F0F3F5 */
const MONO = "font-['ui-monospace','Cascadia_Code',Consolas,monospace] [font-variant-numeric:tabular-nums]";
const CARD = 'bg-white border border-[#E8ECEE] rounded-[15px] shadow-[0_1px_2px_rgba(16,24,40,0.04)]';
const SECLABEL = 'text-[9.5px] font-bold uppercase tracking-[0.05em] text-[#8A95A1]';
const BTN_AC = 'border border-[#17B898] bg-[#17B898] text-[#06342B] font-semibold hover:bg-[#12A085] disabled:opacity-50 disabled:cursor-not-allowed';

// mock's svg.ic / svg.ic.sm
function Ic({ size = 16, children, style }: { size?: number; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', ...style }}>
      {children}
    </svg>
  );
}
const IcHost = <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M7 20h10M12 16v4" /></>;
const IcGroup = <><rect x="9" y="2" width="6" height="5" rx="1" /><rect x="2" y="17" width="6" height="5" rx="1" /><rect x="16" y="17" width="6" height="5" rx="1" /><path d="M12 7v5M5 17v-3h14v3" /></>;
const IcPkg = <><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>;
const IcClock = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;

// Dot-callout — used by the toast and the no-mapping states.
function Callout({ tone, children }: { tone: 'warn' | 'info' | 'error' | 'success'; children: React.ReactNode }) {
  const map: Record<string, { border: string; bg: string; dot: string }> = {
    warn: { border: '#EAD9AE', bg: '#FEFBF4', dot: '#D8A93B' },
    info: { border: '#BFE9DD', bg: '#E4F8F2', dot: '#12A085' },
    error: { border: '#F1D3D0', bg: '#FBEAEA', dot: '#B23A3A' },
    success: { border: '#CFE9DC', bg: '#E7F5EE', dot: '#1F7A54' },
  };
  const c = map[tone];
  return (
    <div className="flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5" style={{ borderColor: c.border, background: c.bg }}>
      <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: c.dot }} />
      <div className="min-w-0 flex-1 text-[12px] leading-snug text-[#3A4653]">{children}</div>
    </div>
  );
}

// mock pill: border-radius 999px, 3px 11px, 10.5px/600
function Pill({ tone, children, title, sm }: { tone: 'ok' | 'warn' | 'neutral' | 'ac' | 'blue' | 'red'; children: React.ReactNode; title?: string; sm?: boolean }) {
  const map: Record<string, string> = {
    ok: 'text-[#1F7A54] bg-[#E7F5EE]',
    warn: 'text-[#9A6410] bg-[#FBF2DF]',
    red: 'text-[#B23A3A] bg-[#FBEAEA]',
    neutral: 'text-[#6B7787] bg-[#F1F4F6]',
    ac: 'text-[#12A085] bg-[#E4F8F2]',
    blue: 'text-[#2E63A8] bg-[#E9F1FB]',
  };
  return (
    <span title={title} className={'inline-flex items-center gap-1 rounded-full font-semibold shrink-0 whitespace-nowrap ' + (sm ? 'text-[9px] px-2 py-px' : 'text-[10.5px] px-[11px] py-[3px]') + ' ' + map[tone]}>
      {children}
    </span>
  );
}

// mock mono chip
function Mchip({ ac, children, title }: { ac?: boolean; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={'inline-flex items-center rounded-lg border px-2 py-0.5 text-[9.5px] font-semibold max-w-[240px] truncate ' + MONO + ' ' + (ac ? 'bg-[#E4F8F2] text-[#12A085] border-[#BFE9DD]' : 'bg-[#F1F4F6] text-[#3A4653] border-[#E4E8EC]')}>
      {children}
    </span>
  );
}

// mock .kv
function KV({ k, children }: { k: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2.5 text-[12px] py-1.5 border-b border-[#F4F6F7] last:border-b-0">
      <span className="text-[#8A95A1] shrink-0">{k}</span>
      <b className="font-semibold text-right min-w-0 [overflow-wrap:anywhere]">{children}</b>
    </div>
  );
}

// mock header ring — r=52 in a 120 viewBox, rendered at 66px, rotated -90°.
function ScoreRing({ pct }: { pct: number | null }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  const stroke = pct == null ? '#C8CFD8' : pct >= 75 ? '#1F7A54' : '#9A6410';
  return (
    <div style={{ width: 66, height: 66, position: 'relative', flex: 'none' }}>
      <svg viewBox="0 0 120 120" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="#EEF1F4" strokeWidth="12" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={stroke} strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={pct == null ? c : c * (1 - v / 100)} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <b className={MONO} style={{ fontSize: 17, fontWeight: 600, color: pct == null ? '#AEB8C2' : '#0F1F2B' }}>{pct == null ? '—' : `${pct}%`}</b>
      </div>
    </div>
  );
}

// mock's slim per-benchmark bar
function MiniBar({ pct, w = 70 }: { pct: number; w?: number }) {
  return (
    <span style={{ width: w, height: 6, borderRadius: 999, background: '#EEF1F4', overflow: 'hidden', display: 'inline-block', flex: 'none' }}>
      <i style={{ display: 'block', height: '100%', width: `${pct}%`, background: pct >= 75 ? '#7CB342' : '#E0AF33', borderRadius: 999 }} />
    </span>
  );
}

// "CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1" → title + mono version
function splitBenchmark(name: string | null): { title: string; version: string | null } {
  if (!name) return { title: '—', version: null };
  const m = name.match(/^(.*?)[_ ]([vV][\d][\w.]*)$/);
  const title = (m ? m[1] : name).replace(/_/g, ' ').trim();
  return { title, version: m ? m[2] : null };
}

// Backend timestamps are naive UTC (no zone). Without a 'Z', new Date() reads
// them as LOCAL time, shifting by the browser's offset (a 40-min-old scan then
// showed "5h ago" at UTC+5). Force UTC.
const parseTs = (v?: string | number | null): Date => {
  if (v == null) return new Date(NaN);
  if (typeof v === 'number') return new Date(v);
  const s = String(v);
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  return new Date(hasTz ? s : s.replace(' ', 'T') + 'Z');
};

const relTime = (ms: number): string => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (!isFinite(s) || s < 0) return 'just now';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const totalsOf = (rs: any[]) =>
  rs.reduce(
    (a: any, r: any) => {
      const s = (r.status || '').toLowerCase();
      a.total += 1;
      if (s === 'passed') a.passed += 1;
      else if (s === 'failed') a.failed += 1;
      else if (s === 'error') a.error += 1;
      else if (s === 'running' || s === 'pending') a.running += 1;
      return a;
    },
    { total: 0, passed: 0, failed: 0, error: 0, running: 0 },
  );

export default function CompliancePanel({ asset }: { asset: any }) {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [cTab, setCTab] = useState<'grp' | 'bench' | 'sess' | 'act'>('grp');
  const [noBenchOpen, setNoBenchOpen] = useState(false);
  const [openSessions, setOpenSessions] = useState<Set<string>>(new Set());
  const [hasInteracted, setHasInteracted] = useState(false);

  // Room-scan selection from the shared context (filled by HostApplicationsPanel
  // as the user ticks peer checkboxes).
  const roomScan = useRoomScan();

  // ip-peers — already cached by HostApplicationsPanel (same key), a free read
  // used to know whether THIS asset has an integration yet.
  const selfIpPeersQ = useQuery({
    queryKey: ['assets', asset.id, 'ip-peers'],
    queryFn: () => assetsApi.getIPPeers(asset.id).then((r: any) => r.data),
  });
  // The host's OWN installed software, enriched with the CIS-benchmark match —
  // so software the AI already recognised (e.g. PostgreSQL → CIS benchmark) is
  // shown here even before it's "set up" as a scannable sub-asset.
  const detectedSwQ = useQuery({
    queryKey: ['asset-detected-software', asset.id],
    queryFn: async () => (await assetsApi.getDetectedSoftware(asset.id)).data as any,
  });
  const selfPeerEntry = (selfIpPeersQ.data?.group ?? []).find((g: any) => g.is_self);
  const selfIsConnected: boolean = selfPeerEntry?.is_connected ?? false;

  const isBrowserAsset = (() => {
    const k = (asset.os_normalized || '').toLowerCase();
    if (k.startsWith('firefox') || k.startsWith('edge') || k.startsWith('chrome')) return true;
    const v = ((asset as any).vendor as string | undefined || '').toLowerCase();
    return v === 'mozilla' || v === 'google' || v === 'microsoft edge';
  })();

  const wizPlatformForSelf = (() => {
    if (isBrowserAsset) return null;  // no wizard for browsers — scanned via host
    const k = (asset.os_normalized || '').toLowerCase();
    if (k) {
      if (k.startsWith('windows')) return 'windows';
      if (['ubuntu', 'linux', 'debian', 'centos', 'rhel', 'amazon-linux', 'rocky', 'almalinux', 'oraclelinux'].some(p => k.startsWith(p))) return 'linux';
      if (k.startsWith('postgresql') || k.startsWith('postgres')) return 'postgres';
      if (k.startsWith('mysql') || k.startsWith('mariadb')) return 'mysql';
      if (k.startsWith('mssql') || k.startsWith('sql-server')) return 'mssql';
      if (k.startsWith('oracle-db') || k.startsWith('oracle')) return 'oracle';
      if (k.startsWith('iis')) return 'windows';
      if (k.startsWith('tomcat') || k.startsWith('apache') || k.startsWith('nginx')) return 'linux';
    }
    const v = ((asset as any).vendor as string | undefined || '').toLowerCase();
    if (v) {
      if (v === 'postgresql') return 'postgres';
      if (v === 'mysql') return 'mysql';
      if (v === 'oracle') return 'oracle';
      if (v === 'microsoft' && (asset.asset_type === 'application')) return 'mssql';
      if (v === 'iis') return 'windows';
      if (v === 'apache' || v === 'nginx' || v === 'tomcat') return 'linux';
      if (v === 'red hat') return 'linux';
      if (v === 'aws') return 'aws';
    }
    return null;
  })();
  const connectWizardHref = (() => {
    const params = new URLSearchParams();
    params.set('asset_id', String(asset.id));
    const hostCandidate = (
      asset.host_name
      || ((asset as any).ip_address as string | undefined)
      || ''
    ).trim();
    if (hostCandidate) params.set('hostname', hostCandidate);
    const labelCandidate = (asset.name || hostCandidate || '').trim();
    if (labelCandidate) params.set('label', labelCandidate);
    if (wizPlatformForSelf) params.set('platform', wizPlatformForSelf);
    return `/admin/integrations/connect?${params.toString()}`;
  })();

  // Set-up link for a detected-but-not-set-up benchmarked software (e.g. Postgres):
  // opens the connect wizard pre-filled for that DB platform, bound to THIS host.
  const softwareSetupHref = (s: any) => {
    const params = new URLSearchParams();
    params.set('asset_id', String(asset.id));
    const host = (asset.host_name || (asset as any).ip_address || '').trim();
    if (host) params.set('hostname', host);
    params.set('label', s.name || s.software_key || 'software');
    const plat = softwareKeyToSqlPlatform(s.software_key || '');
    if (plat) params.set('platform', plat);
    return `/admin/integrations/connect?${params.toString()}`;
  };

  const previewQuery = useQuery({
    queryKey: ['compliance-plugins', 'match-preview', asset.id],
    queryFn: () => compliancePluginsApi.matchPreview(asset.id).then((r: any) => r.data),
  });

  const reDetectMut = useMutation({
    mutationFn: () => compliancePluginsApi.reDetectAssetOs(asset.id).then((r: any) => r.data),
    onSuccess: (data: any) => {
      const changed = data?.any_changed;
      const a = data?.after || {};
      setToast({
        kind: 'success',
        message: changed
          ? `OS refreshed. Normalized: ${a.os_normalized || 'unknown'}${a.os_build ? ' (' + a.os_build + ')' : ''}${a.os_edition ? ' ' + a.os_edition : ''}`
          : `OS already up to date: ${a.os_normalized || 'unknown'}`,
      });
      queryClient.invalidateQueries({ queryKey: ['compliance-plugins', 'match-preview', asset.id] });
      queryClient.invalidateQueries({ queryKey: ['assets', asset.id] });
    },
    onError: (e: any) => setToast({ kind: 'error', message: e?.response?.data?.detail || e?.message || 'Re-detect failed' }),
  });

  const runsQuery = useQuery({
    queryKey: ['compliance-plugins', 'runs', asset.id],
    queryFn: () => compliancePluginsApi.listRuns({ asset_id: asset.id, limit: 3000 }).then((r: any) => r.data),
  });

  const [scanProgress, setScanProgress] = useState<{
    running: boolean;
    startedAt?: number;
    done: number;
    total: number;
  }>({ running: false, done: 0, total: 0 });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const startedAt = Date.now();
      let baselineMaxId = 0;
      try {
        const pre = await compliancePluginsApi.listRuns({ limit: 1 });
        const preList = Array.isArray(pre.data) ? pre.data : (pre.data?.runs || []);
        baselineMaxId = preList[0]?.id ?? 0;
      } catch { /* first-ever scan — baseline stays 0 */ }

      apiClient.post(`/agents/scan-now-push/${asset.id}`).catch(() => {});

      const ticked = roomScan.selectedPeerIds;
      const breakdown: Array<{ id: number; name: string; ruleCount: number }> = [
        { id: asset.id, name: asset.name, ruleCount: applicable.count ?? 0 },
        ...ticked.map(id => ({
          id,
          name: roomScan.peerName(id) ?? `Asset ${id}`,
          ruleCount: roomScan.peerRuleCount(id),
        })),
      ].filter(item => item.ruleCount > 0);
      const resp = await compliancePluginsApi.scanAll({
        asset_id: asset.id,
        include_peer_asset_ids: ticked,
      });
      const scanData = resp.data || {};
      const projectedTotal = scanData.total ?? scanData.executed ?? ((applicable.count ?? 0) + roomScan.selectedPeerRuleSum);
      setScanProgress({ running: true, startedAt, done: 0, total: projectedTotal });

      const POLL_INTERVAL_MS = 2000;
      const STALL_TIMEOUT_MS = 5 * 60 * 1000;
      const HARD_TIMEOUT_MS = 30 * 60 * 1000;
      let lastDone = 0;
      let lastChangeAt = Date.now();
      const startTime = Date.now();

      const attribIds = new Set<number>([asset.id, ...ticked]);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        let done = 0;
        try {
          const r = await compliancePluginsApi.listRuns({ limit: 5000 });
          const list = Array.isArray(r.data) ? r.data : (r.data?.runs || []);
          done = list.filter((run: any) =>
            (run.id ?? 0) > baselineMaxId && attribIds.has(run.asset_id)
          ).length;
        } catch { /* transient — keep polling */ }

        setScanProgress((prev) => prev.running ? { ...prev, done } : prev);

        if (done > lastDone) {
          lastDone = done;
          lastChangeAt = Date.now();
        }
        if (projectedTotal > 0 && done >= projectedTotal) break;     // complete
        if (Date.now() - lastChangeAt > STALL_TIMEOUT_MS) break;     // stalled
        if (Date.now() - startTime > HARD_TIMEOUT_MS) break;         // hard cap
      }

      setScanProgress((prev) => ({ ...prev, running: false }));
      return { executed: lastDone, projectedTotal, breakdown };
    },
    onSuccess: (data: any) => {
      const executed = data?.executed ?? 0;
      const projected = data?.projectedTotal ?? 0;
      const bd: Array<{ id: number; name: string; ruleCount: number }> = data?.breakdown ?? [];
      const isRoomScan = bd.length > 1;
      const breakdownLine = isRoomScan
        ? bd.map(b => `${b.name} (${b.ruleCount})`).join(' + ')
        : '';
      const headline = projected && executed >= projected
        ? `Scan complete. ${executed} of ${projected} rule(s) finished.`
        : `Scan finished. ${executed} run(s) created${projected ? ` (${projected} projected)` : ''}.`;
      setToast({
        kind: 'success',
        message: isRoomScan
          ? `${headline} Fanned to ${bd.length} assets: ${breakdownLine}. Each asset's runs are visible on its own page.`
          : headline,
      });
      queryClient.invalidateQueries({ queryKey: ['compliance-plugins', 'runs', asset.id] });
      queryClient.invalidateQueries({ queryKey: ['compliance-plugins', 'match-preview', asset.id] });
      queryClient.invalidateQueries({ queryKey: ['assets', asset.id, 'ip-peers'] });
      roomScan.clearSelection();
    },
    onError: (e: any) => {
      setScanProgress((prev) => ({ ...prev, running: false }));
      setToast({ kind: 'error', message: e?.response?.data?.detail || e?.message || 'Scan failed' });
    },
  });

  const runs = Array.isArray(runsQuery.data) ? runsQuery.data : (runsQuery.data?.runs || []);
  // Newest run by timestamp — the runs array isn't guaranteed newest-first,
  // so runs[0] could be an old run (showed a stale "last scan Xh ago").
  const lastRun = runs.length
    ? runs.reduce((m: any, r: any) =>
        new Date(r?.started_at || r?.created_at || 0).getTime() >
        new Date(m?.started_at || m?.created_at || 0).getTime() ? r : m)
    : undefined;
  const formatTime = (iso?: string | null) => {
    if (!iso) return '-';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  // Latest known status per rule (runs are returned id-desc, so the first
  // occurrence of a plugin_id is its most recent run) — real rollup for the
  // header score ring, not a fabricated number.
  const latestByPlugin = useMemo(() => {
    const seen = new Set<number>();
    const out: any[] = [];
    for (const r of runs) {
      if (r.plugin_id != null && !seen.has(r.plugin_id)) {
        seen.add(r.plugin_id);
        out.push(r);
      }
    }
    return out;
  }, [runs]);
  const scanStats = useMemo(() => {
    // Scope to the asset's APPLICABLE rules (the scanner's eligible set) so the
    // card counts the same rules the risk posture does — not stale runs left on
    // non-applicable / manual rules by old broken scans. Falls back to all runs
    // until the applicable list loads.
    const applicableIds = new Set<number>(((previewQuery.data as any)?.applicable?.plugin_ids as number[]) || []);
    const rows = applicableIds.size ? latestByPlugin.filter((r) => applicableIds.has(r.plugin_id)) : latestByPlugin;
    const passed = rows.filter((r) => (r.status || '').toLowerCase() === 'passed').length;
    const failed = rows.filter((r) => (r.status || '').toLowerCase() === 'failed').length;
    const errored = rows.filter((r) => (r.status || '').toLowerCase() === 'error').length;
    const scanned = rows.length;
    // CIS score = passed / evaluated (passed+failed). Not-applicable (skipped)
    // and errored rules drop out of the denominator — same basis as the risk
    // posture, so the % is identical on both pages.
    const evaluated = passed + failed;
    const passRate = evaluated ? Math.round((passed / evaluated) * 100) : 0;
    return { passed, failed, errored, scanned, passRate };
  }, [latestByPlugin, previewQuery.data]);

  // One session per Scan-all invocation — runs within 5 min of each other.
  const sessions = useMemo(() => {
    if (!runs || runs.length === 0) return [];
    const sorted = [...runs].sort((a, b) => {
      const ta = new Date(a.started_at || a.created_at || 0).getTime() || (a.id ?? 0);
      const tb = new Date(b.started_at || b.created_at || 0).getTime() || (b.id ?? 0);
      return tb - ta;
    });
    const GAP_MS = 5 * 60 * 1000;
    const groups: { id: string; runs: any[]; startedAt: number; endedAt: number }[] = [];
    let current: typeof groups[0] | null = null;
    let prevT = 0;
    for (const r of sorted) {
      const t = new Date(r.started_at || r.created_at || 0).getTime();
      if (!current || (prevT - t) > GAP_MS) {
        current = { id: 's-' + r.id, runs: [r], startedAt: t, endedAt: t };
        groups.push(current);
      } else {
        current.runs.push(r);
        current.endedAt = Math.min(current.endedAt, t);
        current.startedAt = Math.max(current.startedAt, t);
      }
      prevT = t;
    }
    return groups;
  }, [runs]);

  const pluginLabel = (run: any): string => {
    if (run.plugin_title) return run.plugin_title;
    if (run.plugin_name) return run.plugin_name;
    if (run.plugin?.title) return run.plugin.title;
    if (run.plugin_key) return run.plugin_key;
    return `#${run.plugin_id}`;
  };

  const fmtDuration = (run: any): string => {
    const ms = run.duration_ms ?? (run.duration_seconds ? run.duration_seconds * 1000 : null);
    if (ms == null) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const preview = previewQuery.data || {};
  const stage1 = preview.stage1_regex || {};
  const stage2 = preview.stage2_ai || {};
  const applicable = preview.applicable || {};
  const total = preview.total_plugins ?? 0;

  const osFamily = asset.os_family || preview.asset?.os_family || null;
  const osVersion = asset.os_version || preview.asset?.os_version || null;
  const osNormalized = asset.os_normalized || preview.asset?.os_normalized || null;
  const osk = preview.asset?.os_knowledge || null;

  // Benchmark resolution chain.
  const mm = preview.matcher_mapping || {};
  const mode = preview.matcher_mode || '';
  const isStrict = mode === 'strict_single_stage';
  const benchmark = mm.benchmark_name || stage2.primary_benchmark || null;
  const pattern = mm.os_pattern || null;
  const scope = mm.scope || null;
  const mappingId = mm.mapping_id || null;
  const isSoftMatch = mm.source === 'soft';
  const peerExtra = roomScan.selectedPeerRuleSum;
  const peerCount = roomScan.selectedPeerIds.length;

  // IP group, split the way the mock's Host group tab shows it.
  const group: any[] = selfIpPeersQ.data?.group ?? [];
  const groupIp: string | null = selfIpPeersQ.data?.ip_address ?? asset.ip_address ?? null;
  const selfRow = selfPeerEntry;
  const peers = group.filter((g: any) => !g.is_self);
  const swWithBench = peers.filter((g: any) => g.benchmark_available);
  const swNoBench = peers.filter((g: any) => !g.benchmark_available);
  // Host's own detected software (not yet promoted to a sub-asset). hostBench =
  // recognised AND has a CIS benchmark with runnable rules (e.g. PostgreSQL);
  // hostRecognized = recognised but no benchmark in the library (e.g. Redis).
  const hostSw: any[] = detectedSwQ.data?.inventory ?? [];
  const hostBench = hostSw.filter((s: any) => s.benchmark_available && !s.promoted_asset_id);
  const hostRecognized = hostSw.filter((s: any) => !s.benchmark_available);
  const hostBenchRuleSum = hostBench.reduce((s: number, x: any) => s + (x.rule_count || 0), 0);
  const swRuleSum = swWithBench.reduce((s: number, g: any) => s + (g.rule_count ?? 0), 0);

  const ruleCount = applicable.count ?? 0;
  const applyTotal = ruleCount + peerExtra;
  const scored = scanStats.scanned > 0;
  const headScore = scored ? scanStats.passRate : null;
  const bench = splitBenchmark(benchmark);
  const canScan = applyTotal > 0 && !scanMutation.isPending && !scanProgress.running;
  const scanTitle = applyTotal === 0
    ? 'No applicable rules. Classify the OS first (Re-detect OS or Edit the asset).'
    : (scanProgress.running || scanMutation.isPending)
      ? 'A scan is already running.'
      : peerCount > 0
        ? `Scan ${ruleCount} rules for this asset + ${peerExtra} from ${peerCount} ticked peer(s). Results fan out to each.`
        : `Scan ${ruleCount} rules now`;

  const progressPct = scanProgress.total > 0
    ? Math.min(100, Math.round((Math.min(scanProgress.done, scanProgress.total) / scanProgress.total) * 100))
    : 0;

  const firstSessionId = sessions[0]?.id;
  const effectiveOpen = !hasInteracted && firstSessionId ? new Set([firstSessionId]) : openSessions;
  const toggleSession = (id: string) => {
    setOpenSessions(prev => {
      const start = hasInteracted ? prev : (firstSessionId ? new Set<string>([firstSessionId]) : new Set<string>());
      const next = new Set(start);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setHasInteracted(true);
  };

  const wrap = "font-['Poppins',system-ui,sans-serif] text-[#0F1F2B] text-[13.5px] leading-[1.5] flex flex-col gap-3.5";

  if (previewQuery.isLoading) {
    return (
      <div className={wrap}>
        <div className="flex items-center gap-2 p-6 text-[13px] text-[#8A95A1]">
          <Loader2 className="h-4 w-4 animate-spin" /> Running AI rule classification…
        </div>
      </div>
    );
  }

  if (previewQuery.isError) {
    return (
      <div className={wrap}>
        <Callout tone="error">
          <span className="text-[#B23A3A] font-semibold">Couldn&apos;t load the rule classification. Try refreshing.</span>
        </Callout>
      </div>
    );
  }

  const scanBtn = (label: string, small?: boolean) => (
    <button
      type="button"
      onClick={() => scanMutation.mutate()}
      disabled={!canScan}
      title={scanTitle}
      className={(small
        ? 'h-[31px] px-3 rounded-[9px] text-[11px] '
        : 'h-[34px] px-[15px] rounded-[10px] text-[12px] ') + 'inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap ' + BTN_AC}
    >
      {(scanMutation.isPending || scanProgress.running)
        ? <><Loader2 className="h-3 w-3 animate-spin" />Scanning…</>
        : peerCount > 0 ? `${label} (+${peerCount})` : label}
    </button>
  );

  return (
    <div className={wrap}>
      {/* ── "Connect this asset" CTA — browser variant (scans run through host) ── */}
      {selfIpPeersQ.data && !selfIsConnected && isBrowserAsset && (() => {
        const hostInGroup = peers.find((g: any) => g.is_host_os);
        return (
          <div className={CARD + ' border-l-[3px] border-l-[#D8A93B] overflow-hidden'}>
            <div className="px-4 py-3.5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#FBF2DF] text-[#9A6410]">
                  <Network className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[13.5px] font-semibold text-[#0F1F2B] flex items-center gap-1.5">
                    Browser asset — scans run through the host (no separate wizard form)
                    <GuideMarker id="asset.compColocated" n={3} />
                  </h3>
                  <p className="mt-1 text-[12px] text-[#3A4653] leading-relaxed">
                    A browser has no credentials to enter, so it doesn&apos;t get its own Connect Wizard form.
                    CIS browser benchmarks (Edge / Firefox / Chrome) read browser settings via the parent host&apos;s
                    connection — WinRM-reads registry / GPO on Windows, SSH-reads preferences files on Linux.
                  </p>
                  <div className="mt-3 rounded-[10px] border border-[#E8ECEE] bg-[#FAFBFC] px-3.5 py-3 text-[12px]">
                    <p className="font-semibold text-[#0F1F2B] mb-1.5">How to scan this browser (3 steps):</p>
                    <ol className="flex flex-col gap-1 text-[#3A4653] list-decimal pl-4">
                      <li>Open the <strong>host asset</strong> at IP <code className={MONO + ' text-[#0F1F2B]'}>{asset.ip_address || '—'}</code> (the Windows / Linux machine where this browser is installed).</li>
                      <li>If the host isn&apos;t connected yet, run the <strong>wizard from there</strong> (Windows or Linux platform).</li>
                      <li>On the host&apos;s Compliance tab, this browser will appear in the <strong>Co-located assets</strong> list. Tick it, click <strong>Scan now</strong> — the {(asset as any).os_normalized?.startsWith?.('firefox') ? '90 Firefox' : (asset as any).os_normalized?.startsWith?.('edge') ? '60 Edge' : (asset as any).os_normalized?.startsWith?.('chrome') ? '80 Chrome' : 'browser'} rules fold in and the score writes back to this asset page.</li>
                    </ol>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {hostInGroup ? (
                      <Link
                        href={`/assets/${hostInGroup.id}?tab=compliance`}
                        className="inline-flex items-center gap-1.5 h-[33px] rounded-[9px] bg-[#17B898] px-3.5 text-[12.5px] font-semibold text-[#06342B] border border-[#17B898] hover:bg-[#12A085]"
                      >
                        <Network className="h-3.5 w-3.5" />
                        Go to host: {hostInGroup.name}
                      </Link>
                    ) : asset.ip_address ? (
                      <Link
                        href={`/assets?ip_address=${encodeURIComponent(asset.ip_address)}`}
                        className="inline-flex items-center gap-1.5 h-[33px] rounded-[9px] border border-[#E8ECEE] bg-white px-3.5 text-[12.5px] font-medium text-[#0F1F2B] hover:bg-[#FAFBFC]"
                        title="Find the host asset that shares this IP"
                      >
                        Find host at IP {asset.ip_address}
                      </Link>
                    ) : (
                      <span className="text-[11.5px] text-[#9A6410]">
                        Set this browser&apos;s <strong>IP address</strong> (via Edit) to the host&apos;s IP so the room-scan can group them.
                      </span>
                    )}
                    <Link
                      href="/admin/integrations/connect"
                      className="text-[11.5px] text-[#3A4653] hover:text-[#0F1F2B] underline"
                      title="Open the Connect Wizard fresh — you'll connect the HOST, not this browser"
                    >
                      Open wizard (to connect the host)
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── "Connect this asset" CTA — non-browser variant ── */}
      {selfIpPeersQ.data && !selfIsConnected && !isBrowserAsset && (
        <div className={CARD + ' border-l-[3px] border-l-[#17B898] overflow-hidden'}>
          <div className="px-4 py-3.5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#E4F8F2] text-[#12A085]">
                <Network className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[13.5px] font-semibold text-[#0F1F2B]">This asset isn&apos;t connected yet</h3>
                <p className="mt-1 text-[12px] text-[#3A4653] leading-relaxed">
                  Manually-added assets need an integration before they can be scanned.
                  Connect via the wizard to pick <strong>Agent</strong> (script the host runs once, then scans itself) or
                  {' '}<strong>Agentless</strong> (your backend reaches out over WinRM / SSH / DB protocol with stored credentials).
                  {' '}{wizPlatformForSelf
                    ? <>Detected platform: <code className={MONO + ' text-[#0F1F2B]'}>{wizPlatformForSelf}</code> — wizard will jump straight to its credential form.</>
                    : <>OS isn&apos;t set on this asset, so the wizard will start at the platform picker.</>}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href={connectWizardHref}
                    className="inline-flex items-center gap-1.5 h-[33px] rounded-[9px] bg-[#17B898] px-3.5 text-[12.5px] font-semibold text-[#06342B] border border-[#17B898] hover:bg-[#12A085]"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Connect this asset
                  </Link>
                  {asset.host_name && (
                    <span className="text-[11.5px] text-[#8A95A1]">
                      will pre-fill hostname <code className={MONO + ' text-[#0F1F2B]'}>{asset.host_name}</code>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <Callout tone={toast.kind === 'success' ? 'success' : 'error'}>
          <div className="flex items-start justify-between gap-3">
            <span style={{ color: toast.kind === 'success' ? '#1F7A54' : '#B23A3A' }}>{toast.message}</span>
            <button onClick={() => setToast(null)} className="shrink-0 text-[11px] underline text-[#3A4653]">dismiss</button>
          </div>
        </Callout>
      )}

      {/* ══ HEADER CARD ══ */}
      <article className={CARD}>
        <div className="flex items-center gap-4 px-[18px] py-3.5 flex-wrap">
          <ScoreRing pct={headScore} />
          <div className="flex-1 min-w-[260px]">
            <b className="text-[12.5px] font-semibold">
              {bench.title}{' '}
              {bench.version && <span className={MONO + ' font-medium text-[#8A95A1]'}>{bench.version}</span>}
            </b>
            <div className="text-[11px] text-[#8A95A1] mt-0.5">
              {scored ? (
                <>
                  <b className={'text-[#1F7A54] font-semibold ' + MONO}>{scanStats.passed}</b> pass ·{' '}
                  <b className={'text-[#B23A3A] font-semibold ' + MONO}>{scanStats.failed}</b> fail{scanStats.errored > 0 && <> · <b className={'text-[#9A6410] font-semibold ' + MONO}>{scanStats.errored}</b> error</>} ·{' '}
                  <span className={MONO}>{ruleCount.toLocaleString()}</span> rules · last scan {lastRun ? relTime(parseTs(lastRun.started_at || lastRun.created_at).getTime()) : '—'}
                </>
              ) : (
                <>
                  <span className={MONO}>{ruleCount.toLocaleString()}</span> rules · <b className="text-[#9A6410] font-semibold">Not scanned</b> · agent scans every 30s when installed, or via scheduled cron
                </>
              )}
            </div>
          </div>
          {benchmark && (isStrict && !isSoftMatch ? (
            <Pill tone="ok" title="Strict: the normalized OS matched an operator-confirmed os_pattern → benchmark mapping. AI never auto-applies a mapping; archived benchmarks are never picked.">Strict match</Pill>
          ) : isSoftMatch ? (
            <Pill tone="warn" title="No operator-owned OS→benchmark mapping exists for this OS. The library family-walk picked the closest benchmark so scans can still run. Add a mapping in admin → mappings to make this explicit.">Soft match</Pill>
          ) : null)}
          {osk?.eol_year && <Pill tone="neutral">EOL {osk.eol_year}</Pill>}
          {scanBtn(scored ? 'Rescan' : 'Scan now')}
        </div>
        {scanProgress.running && scanProgress.total > 0 && (
          <div className="px-[18px] pb-[15px]">
            <div className="flex justify-between text-[11.5px] mb-[7px]">
              <span>Scanning <b className={MONO}>{Math.min(scanProgress.done, scanProgress.total)}</b> of <b className={MONO}>{scanProgress.total}</b> rules…</span>
              <span className={MONO}>{progressPct}%{scanProgress.startedAt ? ` · ${Math.round((Date.now() - scanProgress.startedAt) / 1000)}s` : ''}</span>
            </div>
            <div className="h-[9px] rounded-full bg-[#EAEEF1] overflow-hidden">
              <i className="block h-full rounded-full" style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg,#17B898,#12A085)' }} />
            </div>
            <div className="text-[10px] text-[#AEB8C2] mt-1.5">Runs continue server-side — you can leave this tab.</div>
          </div>
        )}
      </article>

      {/* ══ SUB-TAB PILL BAR ══ */}
      <div className="inline-flex w-fit bg-[#EAEEF1] rounded-[11px] p-[3px] gap-0.5">
        {([
          ['grp', 'Host group', null],
          ['bench', 'Benchmark match', null],
          ['sess', 'Scan sessions', sessions.length],
          ['act', 'Activity', sessions.length],
        ] as const).map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => setCTab(key as any)}
            className={'h-8 px-3.5 rounded-[9px] text-[12px] font-semibold inline-flex items-center gap-1.5 ' + (cTab === key ? 'bg-white text-[#12A085] shadow-[0_1px_2px_rgba(16,24,40,0.06)]' : 'text-[#6B7787] hover:text-[#3A4653]')}
          >
            {label}
            {n != null && <span className="text-[9.5px] font-bold bg-[#EEF1F3] text-[#6B7787] rounded-full px-1.5 py-px">{n}</span>}
          </button>
        ))}
      </div>

      {/* ══ HOST GROUP ══ */}
      {cTab === 'grp' && (
        <article className={CARD}>
          <div className="flex items-center gap-3 px-[18px] py-[15px] border-b border-[#F0F3F5] flex-wrap">
            <span className="w-9 h-9 rounded-[10px] bg-[#E9F1FB] text-[#2E63A8] grid place-items-center shrink-0"><Ic>{IcGroup}</Ic></span>
            <div className="flex-1 min-w-0">
              <h3 className="text-[14px] font-semibold">IP Group: <span className={MONO}>{groupIp || 'not set'}</span></h3>
              <span className="block text-[11px] text-[#8A95A1] mt-px">
                {peers.length === 0
                  ? 'This asset is standalone — no co-located assets at this IP'
                  : `${peers.length} co-located asset${peers.length === 1 ? '' : 's'} share this IP`}
              </span>
            </div>
            <Pill tone="ac">1 host + {swWithBench.length + hostBench.length} software benchmark{(swWithBench.length + hostBench.length) === 1 ? '' : 's'}</Pill>
          </div>

          {/* host row */}
          <div className="flex items-center gap-[13px] px-[18px] py-3.5">
            <span className="w-[34px] h-[34px] rounded-[10px] bg-[#E9F1FB] text-[#2E63A8] grid place-items-center shrink-0"><Ic>{IcHost}</Ic></span>
            <div className="flex-1 min-w-0">
              <b className="text-[12.5px] font-semibold">{asset.name}</b>{' '}
              <Pill tone="blue" sm>this asset</Pill>{' '}
              <Pill tone="neutral" sm>host OS</Pill>
              <span className={'block text-[10.5px] text-[#8A95A1] truncate ' + MONO}>
                {[osNormalized || 'os unknown', benchmark || 'no benchmark', `${ruleCount.toLocaleString()} rules`].join(' · ')}
              </span>
            </div>
            {scored
              ? <Pill tone={scanStats.passRate >= 75 ? 'ok' : 'warn'}>{scanStats.passRate}%</Pill>
              : <Pill tone="warn">Not scanned</Pill>}
            {scanBtn(scored ? 'Rescan' : 'Set up scan', true)}
          </div>

          {/* software with benchmarks */}
          <div className="px-[18px] pt-3 pb-1 border-t border-[#F0F3F5]">
            <div className={SECLABEL}>Agent-detected software with CIS benchmarks</div>
          </div>
          {swWithBench.length === 0 && hostBench.length === 0 ? (
            <div className="px-[18px] py-3 text-[11px] text-[#8A95A1] border-b border-[#F0F3F5]">No software with a CIS benchmark detected on this host.</div>
          ) : (
            <>
              {/* Already set up as co-located sub-assets (own score) */}
              {swWithBench.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 px-[18px] py-[11px] border-b border-[#F0F3F5]">
                  <span className="w-[30px] h-[30px] rounded-[9px] bg-[#EEEBFA] text-[#6A54C9] grid place-items-center shrink-0"><Ic size={14}>{IcPkg}</Ic></span>
                  <div className="flex-1 min-w-0">
                    <Link href={`/assets/${s.id}?tab=compliance`} className="text-[12px] font-semibold text-[#0F1F2B] hover:text-[#12A085]">{s.name}</Link>{' '}
                    <Pill tone="ok" sm>✓ CIS ready</Pill>
                    <span className={'block text-[10px] text-[#8A95A1] truncate ' + MONO}>
                      {[s.os_normalized || 'unclassified', s.benchmark_name, `${(s.rule_count ?? 0).toLocaleString()} rules`].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  {s.never_scanned || s.score == null
                    ? <Pill tone="warn">Not scanned</Pill>
                    : <Pill tone={s.score >= 75 ? 'ok' : 'warn'}>{Math.round(s.score)}%</Pill>}
                </div>
              ))}
              {/* Host's own detected software with a benchmark, not yet set up */}
              {hostBench.map((s: any, i: number) => (
                <div key={'hb' + (s.software_key || s.name || i)} className="flex items-center gap-3 px-[18px] py-[11px] border-b border-[#F0F3F5]">
                  <span className="w-[30px] h-[30px] rounded-[9px] bg-[#EEEBFA] text-[#6A54C9] grid place-items-center shrink-0"><Ic size={14}>{IcPkg}</Ic></span>
                  <div className="flex-1 min-w-0">
                    <b className="text-[12px] font-semibold text-[#0F1F2B]">{s.name}</b>{' '}
                    <Pill tone="ok" sm>✓ CIS ready</Pill>
                    <span className={'block text-[10px] text-[#8A95A1] truncate ' + MONO}>
                      {[s.software_key || 'classified', s.benchmark_name, `${(s.rule_count ?? 0).toLocaleString()} rules`].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <Link href={softwareSetupHref(s)} className="shrink-0 inline-flex items-center gap-1 rounded-[8px] bg-[#12A085] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0d8a72]" title="Set up a read-only credential for this software so its CIS rules can scan.">Set up scan →</Link>
                </div>
              ))}
            </>
          )}

          {/* software with no benchmark */}
          {swNoBench.length > 0 && (
            <div className="border-t border-[#F0F3F5]">
              <button type="button" onClick={() => setNoBenchOpen(v => !v)} className="flex w-full items-center gap-2.5 px-[18px] py-3 text-[12.5px] font-semibold text-[#3A4653] hover:bg-[#F7FBFA]">
                <span className="text-[#9BA6B2] transition-transform" style={{ transform: noBenchOpen ? 'rotate(90deg)' : 'none' }}><Ic size={14}><path d="M9 6l6 6-6 6" /></Ic></span>
                <span className="flex-1 text-left">Detected software with no CIS benchmark</span>
                <span className="text-[10px] font-semibold text-[#AEB8C2]">{swNoBench.length}</span>
              </button>
              {noBenchOpen && (
                <div className="px-[18px] pt-1 pb-3 flex flex-col gap-1.5">
                  {swNoBench.map((s: any) => (
                    <div key={s.id} className="flex justify-between items-center gap-2.5 text-[11.5px] px-3 py-[7px] bg-[#F7F9FA] rounded-[9px]">
                      <b className="font-semibold truncate">{s.name}</b>
                      <span className={MONO + ' text-[10px] text-[#AEB8C2] shrink-0'}>{s.os_normalized || 'unclassified'} · no benchmark</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </article>
      )}

      {/* ══ BENCHMARK MATCH ══ */}
      {cTab === 'bench' && (
        <>
          <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))' }}>
            {/* AI Classification */}
            <article className={CARD}>
              <div className="flex items-center gap-2.5 px-4 py-[13px] border-b border-[#F0F3F5]">
                <h4 className="flex-1 text-[13px] font-semibold">AI Classification</h4>
                <button
                  type="button"
                  onClick={() => reDetectMut.mutate()}
                  disabled={reDetectMut.isPending}
                  title="Re-probe this asset's OS via its stored connection"
                  className="h-[29px] px-[11px] border border-[#E4E8EC] bg-white rounded-[9px] text-[11px] font-semibold text-[#3A4653] hover:bg-[#FAFBFC] disabled:opacity-60 whitespace-nowrap inline-flex items-center gap-1.5"
                >
                  {reDetectMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : '↺'} Re-detect OS
                </button>
              </div>
              <div className="px-4 pt-1 pb-1.5">
                <KV k="Detected OS">{osk?.display_name || osVersion || '—'}</KV>
                <KV k="Family">{osk?.family || osFamily || '—'}</KV>
                <KV k="Product">{osk?.product || '—'}</KV>
                <KV k="Build">{asset.os_build || osk?.build || '—'}</KV>
                <KV k="Version string">{osVersion || '—'}</KV>
                <KV k="Normalized key"><span className={MONO}>{osNormalized || '—'}</span></KV>
              </div>
              {osk?.eol_year && (
                <div className="mx-4 mt-1.5 mb-2.5 rounded-[10px] px-[13px] py-[9px] flex justify-between text-[11.5px]" style={{ background: osk.is_supported ? '#E7F5EE' : '#FBEAEA' }}>
                  <span className="text-[#8A95A1]">Support window</span>
                  <b className="font-semibold" style={{ color: osk.is_supported ? '#1F7A54' : '#B23A3A' }}>
                    {osk.is_supported ? 'Supported' : 'End-of-life'} · EOL {osk.eol_year}
                  </b>
                </div>
              )}
              <div className="px-4 pt-2 pb-[3px] border-t border-[#F0F3F5]"><div className={SECLABEL}>Detected software · classified</div></div>
              <div className="px-4 pt-1.5 pb-3 flex flex-col gap-1.5">
                {hostBench.length === 0 && hostRecognized.length === 0 && peers.length === 0 ? (
                  <div className="text-[10.5px] text-[#AEB8C2] px-0.5">No software detected on this host yet — run an inventory / agent scan.</div>
                ) : (
                  <>
                    {/* Host's own installed software the AI matched to a CIS benchmark */}
                    {hostBench.map((s: any, i: number) => (
                      <div key={'hb' + (s.software_key || s.name || i)} className="flex items-center gap-2 text-[11.5px] px-[11px] py-[7px] bg-[#F7F9FA] rounded-[9px]">
                        <b className="font-semibold flex-1 min-w-0 truncate">{s.name}</b>
                        <Mchip>{s.software_key || 'classified'}</Mchip>
                        <Pill tone="ok" sm>benchmark available</Pill>
                      </div>
                    ))}
                    {/* Software already set up as a co-located sub-asset */}
                    {swWithBench.map((s: any) => (
                      <div key={s.id} className="flex items-center gap-2 text-[11.5px] px-[11px] py-[7px] bg-[#F7F9FA] rounded-[9px]">
                        <b className="font-semibold flex-1 min-w-0 truncate">{s.name}</b>
                        <Mchip>{s.os_normalized || 'unclassified'}</Mchip>
                        <Pill tone="ok" sm>set up</Pill>
                      </div>
                    ))}
                    {(hostRecognized.length + swNoBench.length) > 0 && (
                      <div className="mt-0.5 rounded-[9px] bg-[#F7F9FA] px-[11px] py-2">
                        <button type="button" onClick={() => setNoBenchOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-[11px] text-[#8A95A1] text-left">
                          <span className="text-[#9BA6B2] transition-transform shrink-0" style={{ transform: noBenchOpen ? 'rotate(90deg)' : 'none' }}>›</span>
                          <span><b className="font-semibold text-[#3A4653]">{hostRecognized.length + swNoBench.length}</b> more apps classified · <b>no CIS benchmark</b> in the library</span>
                        </button>
                        {noBenchOpen && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {[...hostRecognized, ...swNoBench].map((s: any, i: number) => (
                              <span key={'nb' + i} className="text-[10px] text-[#8A95A1] bg-white border border-[#E8ECEE] rounded px-1.5 py-0.5">{s.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </article>

            {/* Matched benchmarks */}
            <article className={CARD}>
              <div className="flex items-center gap-2.5 px-4 py-[13px] border-b border-[#F0F3F5]">
                <h4 className="flex-1 text-[13px] font-semibold flex items-center gap-1.5">
                  Matched benchmarks <GuideMarker id="asset.compBenchmark" n={1} />
                </h4>
                {benchmark && <Pill tone={isSoftMatch ? 'warn' : 'ok'}>{isSoftMatch ? 'Soft' : 'Strict'}</Pill>}
              </div>
              {benchmark ? (
                <div className="px-4 pt-3.5 pb-3">
                  <div className="text-[10.5px] text-[#8A95A1]">Of <b className={'text-[#0F1F2B] font-semibold ' + MONO}>{total.toLocaleString()}</b> CIS rules in the library</div>
                  <div className="flex items-baseline gap-2 mt-1 mb-2.5">
                    <b className={'text-[30px] font-semibold text-[#12A085] leading-none ' + MONO}>{ruleCount.toLocaleString()}</b>
                    <span className="text-[11.5px] text-[#8A95A1]">
                      apply to this asset · {peerCount > 0 ? `host OS + ${peerCount} software (+${peerExtra.toLocaleString()} rules)` : 'host OS only'}
                    </span>
                  </div>
                  <div className={SECLABEL + ' mb-1.5'}>Host OS · primary benchmark</div>
                  <div className={'bg-[#E4F8F2] border border-[#BFE9DD] rounded-[10px] px-[13px] py-[9px] text-[11px] font-semibold text-[#0A5A4B] flex items-center gap-2 ' + MONO}>
                    <span className="flex-1 min-w-0 break-all">{benchmark}</span>
                    <span className="shrink-0">{ruleCount.toLocaleString()} rules</span>
                  </div>
                  <div className="flex items-center gap-[7px] flex-wrap mt-[9px] text-[10.5px] text-[#8A95A1]">
                    <Mchip>{osNormalized || '—'}</Mchip>
                    <span>{isSoftMatch ? 'family-walk to' : 'matches pattern'}</span>
                    <Mchip>{pattern || '—'}</Mchip>
                    <span>→</span>
                    <Mchip ac title={benchmark}>{benchmark}</Mchip>
                  </div>
                  <div className="text-[10px] text-[#AEB8C2] mt-[7px] leading-relaxed">
                    {scope && <>scope <b className="text-[#3A4653] font-semibold">{scope}</b> · </>}
                    {mappingId && <>mapping_id <b className={'text-[#3A4653] font-semibold ' + MONO}>#{mappingId}</b> · </>}
                    {isStrict ? 'single-stage strict match — no family-walk, no AI guess' : `mode: ${mode || 'unknown'}`} · archived benchmarks never picked
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3.5"><NoMappingCallout osNormalized={osNormalized} assetId={asset.id} /></div>
              )}

              <div className="px-4 pt-2.5 pb-1 border-t border-[#F0F3F5]"><div className={SECLABEL}>Software benchmarks · include in scan scope</div></div>
              <div className="px-4 pt-1.5 pb-2.5 flex flex-col gap-1.5">
                {swWithBench.length === 0 && hostBench.length === 0 ? (
                  <div className="text-[10.5px] text-[#AEB8C2] px-0.5">No software benchmark to fold into this scan.</div>
                ) : (
                  <>
                    {swWithBench.map((s: any) => (
                      <label key={s.id} className="flex items-center gap-2.5 border border-[#E8ECEE] rounded-[10px] px-3 py-2 text-[11.5px] cursor-pointer hover:border-[#17B898]">
                        <input
                          type="checkbox"
                          checked={roomScan.isSelected(s.id)}
                          onChange={() => roomScan.togglePeer(s.id)}
                          style={{ accentColor: '#12A085', width: 15, height: 15 }}
                        />
                        <b className="font-semibold flex-1 min-w-0 truncate">{s.name}</b>
                        <Mchip ac title={s.benchmark_name}>{s.benchmark_name}</Mchip>
                        <span className="text-[10.5px] text-[#8A95A1] shrink-0"><b className={'text-[#0F1F2B] font-semibold ' + MONO}>{(s.rule_count ?? 0).toLocaleString()}</b> rules</span>
                      </label>
                    ))}
                    {/* Detected benchmarked software not yet set up — recognised + rules
                        exist, but scanning a DB benchmark needs a validated credential. */}
                    {hostBench.map((s: any, i: number) => (
                      <div key={'hbs' + (s.software_key || s.name || i)} className="flex items-center gap-2.5 border border-dashed border-[#E4E8EC] rounded-[10px] px-3 py-2 text-[11.5px] bg-[#FCFCFD]">
                        <b className="font-semibold flex-1 min-w-0 truncate">{s.name}</b>
                        <Mchip ac title={s.benchmark_name}>{s.benchmark_name}</Mchip>
                        <span className="text-[10.5px] text-[#8A95A1] shrink-0"><b className={'text-[#0F1F2B] font-semibold ' + MONO}>{(s.rule_count ?? 0).toLocaleString()}</b> rules</span>
                        <Link href={softwareSetupHref(s)} className="shrink-0 inline-flex items-center gap-1 rounded-[8px] bg-[#12A085] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0d8a72]" title="Set up a read-only credential for this software so its CIS rules can scan.">Set up scan →</Link>
                      </div>
                    ))}
                  </>
                )}
              </div>
              <div className="px-4 pt-2 pb-3 text-[10px] text-[#AEB8C2]">
                Included software scans run with the host scan; each score blends into the asset&apos;s aggregated CIS score.
              </div>
            </article>
          </div>

          {/* Rule funnel */}
          <article className={CARD}>
            <div className="flex items-center gap-2.5 px-4 py-[13px] border-b border-[#F0F3F5]">
              <h4 className="flex-1 text-[13px] font-semibold flex items-center gap-1.5">
                Rule funnel <GuideMarker id="asset.compFormula" n={2} />
              </h4>
              <span className="text-[10px] text-[#AEB8C2]">Library → matched benchmarks → applicable to scan</span>
            </div>
            <div className="grid gap-3 px-4 py-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
              <div className="bg-[#F7F9FA] rounded-[11px] px-[15px] py-[13px]">
                <b className={'text-[21px] font-semibold ' + MONO}>{total.toLocaleString()}</b>
                <span className="block text-[11px] text-[#3A4653] font-semibold mt-0.5">Library total</span>
                <small className="text-[10px] text-[#AEB8C2]">approved CIS plugins</small>
              </div>
              <div className="bg-[#F7F9FA] rounded-[11px] px-[15px] py-[13px]">
                <b className={'text-[21px] font-semibold text-[#0d5c48] ' + MONO}>
                  {ruleCount.toLocaleString()}
                  {swRuleSum > 0 && <span className="text-[12px] text-[#8A95A1] font-medium"> + {swRuleSum.toLocaleString()} software</span>}
                </b>
                <span className="block text-[11px] text-[#3A4653] font-semibold mt-0.5">From matched benchmarks</span>
                <small className="text-[10px] text-[#AEB8C2]">{(stage1.skipped ?? 0).toLocaleString()} from other benchmarks skipped</small>
              </div>
              <div className="bg-[#E4F8F2] rounded-[11px] px-[15px] py-[13px]">
                <b className={'text-[21px] font-semibold text-[#12A085] ' + MONO}>{applyTotal.toLocaleString()}</b>
                <span className="block text-[11px] text-[#0A5A4B] font-semibold mt-0.5">Applicable to scan</span>
                <small className="text-[10px] text-[#4A8577]">{total ? Math.round((applyTotal / total) * 100) : 0}% of library</small>
                {hostBenchRuleSum > 0 && <small className="block text-[10px] text-[#8A5A0C] mt-1">+{hostBenchRuleSum.toLocaleString()} from detected software — set up to include</small>}
              </div>
            </div>
            <div className="px-4 pt-0.5 pb-1"><div className={SECLABEL}>Preview — sample rules that will run</div></div>
            <div className="px-4 pt-2 pb-3 flex flex-col gap-1.5">
              {(!Array.isArray(applicable.examples) || applicable.examples.length === 0) ? (
                <div className="text-[11px] italic text-[#AEB8C2] px-0.5">No applicable rules until OS data lands.</div>
              ) : (
                <>
                  {applicable.examples.map((it: any, i: number) => (
                    <div key={i} className="flex items-center gap-2.5 border border-[#E8ECEE] rounded-[9px] px-3 py-2 text-[11.5px]">
                      <span className={MONO + ' bg-[#F1F4F6] rounded-md px-2 py-px text-[10px] font-semibold shrink-0'}>{it.rule_id}</span>
                      <span className="flex-1 min-w-0">{it.title}</span>
                    </div>
                  ))}
                  <div className="text-[10px] text-[#AEB8C2] px-0.5 pt-0.5">
                    {applicable.examples.length} of {ruleCount.toLocaleString()} · all from <span className={MONO}>{benchmark}</span> · full outcomes appear per scan session
                  </div>
                </>
              )}
            </div>
          </article>
        </>
      )}

      {/* ══ SCAN SESSIONS ══ */}
      {cTab === 'sess' && (
        <article className={CARD}>
          <div className="px-[18px] py-[15px] border-b border-[#F0F3F5]">
            <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
              Scan sessions
              <GuideMarker id="asset.compScanFrequency" n={4} />
              <GuideMarker id="asset.compFeedsHardeningGap" n={5} />
            </h3>
            <span className="block text-[11px] text-[#8A95A1] mt-0.5">One session per scan · expand for rule outcomes · {ruleCount.toLocaleString()} applicable rules</span>
          </div>

          {scanProgress.running && (
            <div className="px-[18px] py-3.5 border-b border-[#F0F3F5]">
              <div className="flex items-center gap-2.5 text-[12px]">
                <span className="w-[9px] h-[9px] rounded-full bg-[#17B898] animate-pulse shrink-0" />
                <b className="font-semibold">Scan in progress</b>
                <span className="text-[#8A95A1]"><b className={MONO}>{Math.min(scanProgress.done, scanProgress.total)}</b> of <span className={MONO}>{scanProgress.total}</span> rules</span>
                <span className="ml-auto"><Pill tone="ac">running</Pill></span>
              </div>
              <div className="h-[7px] rounded-full bg-[#EAEEF1] overflow-hidden mt-2.5">
                <i className="block h-full rounded-full bg-[#17B898]" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}

          {runsQuery.isLoading ? (
            <div className="px-[18px] py-6 text-[12px] text-[#8A95A1] flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading runs…</div>
          ) : sessions.length === 0 ? (
            <div className="px-5 py-[34px] text-center">
              <div className="w-11 h-11 rounded-xl bg-[#F1F4F6] text-[#AEB8C2] grid place-items-center mx-auto mb-2.5"><Ic size={18}>{IcClock}</Ic></div>
              <b className="text-[12.5px] font-semibold">No scans yet</b>
              <p className="text-[11.5px] text-[#8A95A1] mt-1">Results will appear here on the next agent tick or scheduled scan — or run one now.</p>
            </div>
          ) : sessions.map((session: any) => {
            const isOpen = effectiveOpen.has(session.id);
            const t = totalsOf(session.runs);
            const spanSec = Math.round(Math.max(0, session.startedAt - session.endedAt) / 1000);
            const rate = t.total ? Math.round((t.passed / t.total) * 100) : 0;
            const shown = session.runs.slice(0, 100);
            return (
              <div key={session.id} className="border-t border-[#F0F3F5] first:border-t-0">
                <button type="button" onClick={() => toggleSession(session.id)} className="flex w-full items-center gap-2.5 px-4 py-3 text-[12.5px] font-semibold text-[#3A4653] hover:bg-[#F7FBFA] text-left">
                  <span className="text-[#9BA6B2] transition-transform shrink-0" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}><Ic size={14}><path d="M9 6l6 6-6 6" /></Ic></span>
                  <span className="flex-1 min-w-0 truncate">Scan at {formatTime(new Date(session.startedAt).toISOString())}</span>
                  <span className="text-[10px] text-[#AEB8C2] shrink-0">{t.total.toLocaleString()} rules · {spanSec}s</span>
                  <span className="ml-2 shrink-0"><Pill tone="ok">PASS {t.passed}</Pill></span>
                  <span className="ml-1.5 shrink-0"><Pill tone="red">FAIL {t.failed}</Pill></span>
                  {t.error > 0 && <span className="ml-1.5 shrink-0"><Pill tone="warn">ERR {t.error}</Pill></span>}
                  <b className={'text-[10.5px] font-semibold ml-2 shrink-0 ' + MONO}>Pass rate: {rate}%</b>
                </button>
                <div className="mx-4 mb-2.5 h-[7px] rounded-full bg-[#FBEAEA] overflow-hidden">
                  <i className="block h-full" style={{ width: `${rate}%`, background: rate >= 75 ? '#7CB342' : '#E0AF33' }} />
                </div>

                {isOpen && (
                  <>
                    <div className="flex items-center gap-2.5 px-4 py-2.5 bg-[#FAFBFC] border-t border-[#E8ECEE] flex-wrap">
                      <b className="text-[11.5px] font-semibold">Host OS — {asset.name}</b>
                      <span className={MONO + ' text-[9.5px] text-[#8A95A1] truncate max-w-[280px]'}>{benchmark || 'benchmark unresolved'}</span>
                      <span className="text-[9.5px] text-[#AEB8C2]">asset&apos;s own rules · agentless</span>
                      <span className={'ml-auto text-[10px] font-semibold text-[#1F7A54] ' + MONO}>{t.passed} pass</span>
                      <span className={'text-[10px] font-semibold text-[#B23A3A] ' + MONO}>{t.failed} fail</span>
                      <MiniBar pct={rate} />
                      <b className={'text-[10.5px] font-semibold ' + MONO}>{rate}%</b>
                    </div>
                    {shown.map((run: any) => {
                      const rt = new Date(run.started_at || run.created_at || 0).getTime();
                      const off = Math.max(0, Math.round((rt - session.endedAt) / 1000));
                      const st = (run.status || '').toLowerCase();
                      return (
                        <div key={run.id} className="grid gap-2.5 items-center px-3.5 py-[9px] border-t border-[#F0F3F5] text-[11.5px]" style={{ gridTemplateColumns: 'minmax(0,1fr) 70px 90px 50px' }}>
                          <div className="min-w-0">
                            <b className="font-semibold leading-snug">{pluginLabel(run)}</b>
                            {run.result_summary && <span className="block text-[10px] text-[#8A95A1] line-clamp-2">{run.result_summary}</span>}
                          </div>
                          <span className={MONO + ' text-[10.5px] text-[#8A95A1]'}>+{off}s</span>
                          <span>
                            {st === 'passed' ? <Pill tone="ok">✓ Passed</Pill>
                              : st === 'failed' ? <Pill tone="red">✕ Failed</Pill>
                                : st === 'error' ? <Pill tone="warn">⚠ Error</Pill>
                                  : st === 'running' || st === 'pending' ? <Pill tone="ac"><Loader2 className="h-2.5 w-2.5 animate-spin" />Running</Pill>
                                    : <Pill tone="neutral">{st || 'unknown'}</Pill>}
                          </span>
                          <span className={MONO + ' text-[10.5px] text-right'}>{fmtDuration(run)}</span>
                        </div>
                      );
                    })}
                    <div className="px-4 py-2.5 border-t border-[#F0F3F5] text-[11px] text-[#8A95A1]">
                      {session.runs.length > shown.length && <>Showing first {shown.length} of {session.runs.length.toLocaleString()} · </>}
                      Sample outcomes per benchmark shown · full results arrive via the asset API
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </article>
      )}

      {/* ══ ACTIVITY ══ */}
      {cTab === 'act' && (
        <article className={CARD}>
          <div className="flex items-center justify-between gap-3 px-[18px] py-[15px] border-b border-[#F0F3F5]">
            <div>
              <h3 className="text-[14px] font-semibold">Activity</h3>
              <span className="block text-[11px] text-[#8A95A1] mt-0.5">What has actually happened to this asset that the platform recorded.</span>
            </div>
            <Pill tone="neutral">{sessions.length} event{sessions.length === 1 ? '' : 's'}</Pill>
          </div>
          {sessions.length === 0 ? (
            <div className="px-5 py-[30px] text-center">
              <b className="text-[12.5px] font-semibold">No recorded activity for this asset</b>
              <p className="text-[11.5px] text-[#8A95A1] mt-1">Scan runs appear here once a CIS scan has been run against it.</p>
            </div>
          ) : sessions.map((session: any) => {
            const t = totalsOf(session.runs);
            const running = t.running > 0;
            return (
              <div key={session.id} className="flex items-center gap-[11px] px-[18px] py-[13px] border-b border-[#F0F3F5] last:border-b-0">
                <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: running ? '#D8A93B' : '#0E5A46' }} />
                <div className="flex-1 min-w-0">
                  <b className="text-[12px] font-semibold">Compliance scan — {running ? 'running' : 'completed'}</b>
                  <small className="block text-[10.5px] text-[#8A95A1] truncate">
                    {[benchmark, `${t.passed} passed`, `${t.failed} failed`, t.error ? `${t.error} errored` : null].filter(Boolean).join(' · ')}
                  </small>
                </div>
                <span className="text-[10.5px] text-[#AEB8C2] shrink-0">{relTime(session.startedAt)}</span>
              </div>
            );
          })}
          <div className="px-[18px] py-[11px] border-t border-[#F0F3F5] text-[10.5px] text-[#AEB8C2]">
            Scan activity only — field edits, ownership changes and lifecycle moves are not logged against the asset, so they cannot appear here yet.
          </div>
        </article>
      )}
    </div>
  );
}

function NoMappingCallout({ osNormalized, assetId }: { osNormalized: string | null; assetId: number }) {
  const [suggestion, setSuggestion] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchSuggestion = async () => {
    setLoading(true);
    setErr(null);
    try {
      const { compliancePluginsApi } = await import('@/lib/api');
      const r = await compliancePluginsApi.suggestMappingForAsset(assetId);
      setSuggestion(r.data || null);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Suggestion failed');
    } finally {
      setLoading(false);
    }
  };

  // Case 1 — OS itself is unknown.
  if (!osNormalized) {
    return (
      <Callout tone="warn">
        <div className="text-[12px] font-semibold" style={{ color: '#7A6427' }}>OS not classified</div>
        <p className="mt-1 text-[12px]" style={{ color: '#7A6427' }}>
          This asset has no normalized OS key, so the strict matcher can&apos;t resolve a benchmark. Use{' '}
          <strong>Re-detect OS</strong> on the AI Classification panel, or open the asset Edit
          dialog and set <code className={MONO}>os_version</code> + <code className={MONO}>os_normalized</code> manually.
        </p>
      </Callout>
    );
  }

  // Case 2 — OS known but no mapping row covers it.
  return (
    <Callout tone="warn">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold" style={{ color: '#7A6427' }}>
            No benchmark mapped for <span className={MONO}>{osNormalized}</span>
          </div>
          <p className="mt-1 text-[12px]" style={{ color: '#7A6427' }}>
            The strict matcher needs an <code className={MONO}>os_pattern → benchmark_name</code> row covering this OS. Add one in
            admin, or have AI suggest one from the ingested benchmark library.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={fetchSuggestion}
            disabled={loading}
            className="h-[32px] rounded-[9px] border border-[#EAD9AE] bg-white px-3 text-[12px] font-medium hover:bg-[#FBF2DF] disabled:opacity-50 whitespace-nowrap"
            style={{ color: '#7A6427' }}
          >
            {loading ? 'Asking AI…' : 'Suggest mapping (AI)'}
          </button>
          <Link
            href="/compliance-plugins/os-registry"
            className="h-[32px] inline-flex items-center rounded-[9px] border border-[#E8ECEE] bg-white px-3 text-[12px] font-medium text-[#0F1F2B] hover:bg-[#FAFBFC] whitespace-nowrap"
          >
            Add manually
          </Link>
        </div>
      </div>

      {err && (
        <div className="mt-2 rounded-md border border-[#F1D3D0] bg-[#FBEAEA] px-2 py-1 text-[11px] text-[#B23A3A]">
          {err}
        </div>
      )}

      {suggestion && (
        <div className="mt-3 rounded-[10px] border border-[#EAD9AE] bg-white p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#8A95A1]">
            AI suggestion · confidence <span className="font-semibold text-[#3A4653]">{suggestion.confidence || '?'}</span>
          </div>
          {suggestion.benchmark_name ? (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                <Mchip>{osNormalized}</Mchip>
                <span className="text-[#AEB8C2]">→</span>
                <Mchip ac>{suggestion.benchmark_name}</Mchip>
              </div>
              {suggestion.reasoning && (
                <p className="mt-1.5 text-[11px] italic text-[#3A4653]">{suggestion.reasoning}</p>
              )}
              <p className="mt-2 text-[11px] text-[#8A95A1]">
                Review and accept this mapping in{' '}
                <Link href="/compliance-plugins/os-registry" className="text-[#12A085] underline">admin → mappings</Link>
                . Per anti-hallucination policy, AI never auto-applies — an operator must confirm.
              </p>
            </>
          ) : (
            <p className="mt-1 text-[12px] text-[#3A4653]">
              AI couldn&apos;t pick a benchmark with confidence. Most likely the required benchmark PDF hasn&apos;t been ingested yet —
              upload it via{' '}
              <Link href="/compliance-plugins/ingest" className="text-[#12A085] underline">Rules library → Ingest</Link>{' '}
              and the suggester will pick it up next time.
            </p>
          )}
        </div>
      )}
    </Callout>
  );
}
