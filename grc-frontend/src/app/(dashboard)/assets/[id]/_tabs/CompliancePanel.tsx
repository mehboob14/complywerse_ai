'use client';

/*
 * CompliancePanel — asset-detail "Compliance" tab, restyled to the delivered
 * design language (see ../_overview-design.tsx, rendered by the Overview tab).
 *
 * PRESENTATION ONLY. This is a drop-in replacement for the local `ComplianceTab`
 * that lived inside ../page.tsx. Every data source and capability is preserved
 * verbatim:
 *   - queries:   ['assets', id, 'ip-peers']  (selfIpPeersQ, drives the connect CTA)
 *                ['compliance-plugins','match-preview', id]  (previewQuery)
 *                ['compliance-plugins','runs', id]  (runsQuery, limit 3000)
 *   - mutations: reDetectMut (reDetectAssetOs)  ·  scanMutation (scanAll + /runs poll)
 *   - context:   useRoomScan()  (peer selection folded into counts + Scan-now)
 *   - actions:   Re-detect OS · Scan now (+peers) · NoMappingCallout AI suggest
 *   - blocks:    browser/connect CTAs, AI Classification, Matched benchmark,
 *                Benchmark resolution trace, Applicable rules, live scan progress,
 *                ScanSessions (filter chips + expandable run tables), toast.
 *   - every GuideMarker keeps its exact id + number.
 *
 * Nothing here fetches or mutates differently from the original — only the markup
 * and classNames changed. The parent must still render this INSIDE a
 * <RoomScanProvider> (as ../page.tsx does today) so useRoomScan resolves the real
 * selection rather than the no-op fallback.
 *
 * The Overview design's primitives (Cell / Stat / CARD) are NOT exported from
 * _overview-design.tsx, so the load-bearing tokens are replicated locally, 1:1
 * with that file's values, so this tab reads as one system with Overview.
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu, Play, ChevronDown, ChevronRight, Zap, Loader2, Network, ClipboardList } from 'lucide-react';
import { apiClient, assetsApi, compliancePluginsApi } from '@/lib/api';
import { GuideMarker } from '@/components/guide';
import { useRoomScan } from '../_room-scan-context';

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ── design tokens, replicated verbatim from _overview-design.tsx ── */
const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";
const SHADOW = 'shadow-[0_1px_2px_rgba(18,45,36,0.05),0_12px_26px_-18px_rgba(18,45,36,0.22)]';
const CARD = `bg-white border border-[#e6e9e3] rounded-2xl overflow-hidden ${SHADOW}`;
const TH = 'text-left sticky top-0 bg-[#f4f7f3] text-[#5c6b62] font-bold text-[10px] tracking-[0.04em] uppercase px-3 py-2 border-b border-[#e4e7e0]';
const TD = 'px-3 py-2 border-b border-[#f2f4ef] align-top';

// Label-over-value field, matching the Overview design's `Cell`. Empty values
// render as an italic muted placeholder, exactly like Overview.
function Cell({ label, value, mono, wide, empty: emptyText }: { label: React.ReactNode; value?: React.ReactNode; mono?: boolean; wide?: boolean; empty?: string }) {
  const empty = value === '—' || value === '' || value == null;
  const v = empty ? (emptyText ?? 'Not set') : value;
  return (
    <div className={'min-w-0' + (wide ? ' sm:col-span-2' : '')}>
      <div className="text-[10px] font-bold tracking-[0.05em] uppercase text-[#8a948b] mb-0.5">{label}</div>
      <div
        className={(mono ? MONO + ' text-[12px]' : 'text-[13px]') + ' break-words leading-snug'}
        style={{ color: empty ? '#97a19a' : '#1a2b24', fontStyle: empty ? 'italic' : undefined, overflowWrap: 'anywhere' }}
      >
        {v}
      </div>
    </div>
  );
}

// Numeric tile — centered big number over a tiny uppercase label, in a subtle
// box. Mirrors the Overview design's `Stat` / provenance tiles. `accent` picks
// the number colour so the resolution strip can echo library / matched / scan.
function Tile({ num, label, sub, accent = '#0d5c48' }: { num: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div className="flex-1 min-w-0 bg-[#f4f7f3] border border-[#e6e9e3] rounded-xl px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[#8a948b]">{label}</div>
      <div className={'text-[22px] font-extrabold leading-none mt-1.5 ' + MONO} style={{ color: accent }}>{num}</div>
      {sub != null && <div className="text-[11px] text-[#8a948b] mt-1.5 leading-snug">{sub}</div>}
    </div>
  );
}

// Warn / info callout in the delivered dot-callout style (see Overview's
// "needs elevated access" note). `tone` selects the palette; content is passed
// through untouched so every CTA / link / GuideMarker survives.
function Callout({ tone, children }: { tone: 'warn' | 'info' | 'error' | 'success'; children: React.ReactNode }) {
  const map: Record<string, { border: string; bg: string; dot: string }> = {
    warn: { border: '#f0dcae', bg: '#fdf7ea', dot: '#d9a441' },
    info: { border: '#c3ead2', bg: '#f0f7f3', dot: '#0f9d78' },
    error: { border: '#f3cfcb', bg: '#fdf1f0', dot: '#b42318' },
    success: { border: '#c3ead2', bg: '#e7f6ee', dot: '#0f7a5c' },
  };
  const c = map[tone];
  return (
    <div className="flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5" style={{ borderColor: c.border, background: c.bg }}>
      <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: c.dot }} />
      <div className="min-w-0 flex-1 text-[12px] leading-snug text-[#5c6b62]">{children}</div>
    </div>
  );
}

// Section-card header: title + optional caption on the left, optional right slot.
function CardHead({ icon, title, caption, right }: { icon?: React.ReactNode; title: React.ReactNode; caption?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#eceee8]">
      <div className="flex gap-2.5 min-w-0">
        {icon && <span className="shrink-0 mt-px" style={{ color: '#0d5c48' }}>{icon}</span>}
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold tracking-[-0.01em] flex items-center gap-1.5 text-[#1a2b24]">{title}</div>
          {caption != null && <div className="text-[11.5px] text-[#aab2a8] mt-px">{caption}</div>}
        </div>
      </div>
      {right != null && <div className="shrink-0">{right}</div>}
    </div>
  );
}

// Rounded-pill badge in the delivered palette. Reused for Strict / Soft match
// and the agentless-style tags.
function Pill({ tone, children, title }: { tone: 'ok' | 'warn' | 'neutral'; children: React.ReactNode; title?: string }) {
  const map: Record<string, string> = {
    ok: 'text-[#0f7a5c] bg-[#e7f6ee] border-[#c3ead2]',
    warn: 'text-[#a86a12] bg-[#fdf3e3] border-[#f0dcae]',
    neutral: 'text-[#5c6b62] bg-[#f0f2ee] border-[#e0e4dc]',
  };
  return (
    <span title={title} className={'inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.03em] uppercase px-2.5 py-[3px] rounded-full border ' + map[tone]}>
      {children}
    </span>
  );
}

// Sample-rule list — mono rule id + title, optional benchmark line. Mirrors the
// original ExampleList capability, restyled.
function ExampleList({ items, emptyText }: { items?: Array<any>; emptyText: string }) {
  if (!items || items.length === 0) return <div className="text-[12px] italic text-[#97a19a]">{emptyText}</div>;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((it: any, i: number) => (
        <li key={i} className="text-[12.5px] text-[#1a2b24] leading-snug">
          <span className={MONO + ' text-[11px] text-[#8a948b]'}>{it.rule_id}</span>{' '}
          <span>{it.title}</span>
          {it.benchmark && <div className={'mt-0.5 truncate text-[10.5px] text-[#aab2a8] ' + MONO}>{it.benchmark}</div>}
        </li>
      ))}
    </ul>
  );
}

export default function CompliancePanel({ asset }: { asset: any }) {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // Room-scan selection from the shared context (filled by HostApplicationsPanel
  // as the user ticks peer checkboxes).
  const roomScan = useRoomScan();

  // ip-peers — already cached by HostApplicationsPanel (same key), a free read
  // used to know whether THIS asset has an integration yet.
  const selfIpPeersQ = useQuery({
    queryKey: ['assets', asset.id, 'ip-peers'],
    queryFn: () => assetsApi.getIPPeers(asset.id).then((r: any) => r.data),
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
  const lastRun = runs[0];
  const formatTime = (iso?: string | null) => {
    if (!iso) return '-';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  // Each run = ONE CIS check. Status badge restyled to the delivered palette.
  const passFailBadge = (run: any) => {
    const status = (run.status || '').toLowerCase();
    const base = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.03em] border';
    if (status === 'running' || status === 'pending') {
      return <span className={base + ' text-[#a86a12] bg-[#fdf3e3] border-[#f0dcae]'}><Loader2 className="h-3 w-3 animate-spin" />Running</span>;
    }
    if (status === 'passed') {
      return <span className={base + ' text-[#0f7a5c] bg-[#e7f6ee] border-[#c3ead2]'}>✓ Passed</span>;
    }
    if (status === 'failed') {
      return <span className={base + ' text-[#b42318] bg-[#fdeceb] border-[#f3cfcb]'}>✗ Failed</span>;
    }
    if (status === 'error') {
      return <span className={base + ' text-[#a86a12] bg-[#fdf3e3] border-[#f0dcae]'}>⚠ Error</span>;
    }
    return <span className={base + ' text-[#5c6b62] bg-[#f0f2ee] border-[#e0e4dc]'}>{status || 'unknown'}</span>;
  };

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
  const criticality = asset.criticality || null;

  const wrap = "font-['Public_Sans',system-ui,sans-serif] text-[#1a2b24] [font-feature-settings:'ss01'] flex flex-col gap-4";

  if (previewQuery.isLoading) {
    return (
      <div className={wrap}>
        <div className="flex items-center gap-2 p-6 text-[13px] text-[#8a948b]">
          <Loader2 className="h-4 w-4 animate-spin" /> Running AI rule classification…
        </div>
      </div>
    );
  }

  if (previewQuery.isError) {
    return (
      <div className={wrap}>
        <Callout tone="error">
          <span className="text-[#b42318] font-semibold">Couldn&apos;t load the rule classification. Try refreshing.</span>
        </Callout>
      </div>
    );
  }

  return (
    <div className={wrap}>
      {/* ── "Connect this asset" CTA — browser variant (scans run through host) ── */}
      {selfIpPeersQ.data && !selfIsConnected && isBrowserAsset && (() => {
        const peers: any[] = selfIpPeersQ.data?.group ?? [];
        const hostInGroup = peers.find((g: any) => g.is_host_os && !g.is_self);
        return (
          <div className={CARD + ' border-l-[3px] border-l-[#d9a441]'}>
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#fdf3e3] text-[#a86a12]">
                  <Network className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-bold text-[#1a2b24] flex items-center gap-1.5">
                    Browser asset — scans run through the host (no separate wizard form)
                    <GuideMarker id="asset.compColocated" n={3} />
                  </h3>
                  <p className="mt-1 text-[12px] text-[#5c6b62] leading-relaxed">
                    A browser has no credentials to enter, so it doesn&apos;t get its own Connect Wizard form.
                    CIS browser benchmarks (Edge / Firefox / Chrome) read browser settings via the parent host&apos;s
                    connection — WinRM-reads registry / GPO on Windows, SSH-reads preferences files on Linux.
                  </p>
                  <div className="mt-3 rounded-lg border border-[#eceee8] bg-[#fafbf8] px-3.5 py-3 text-[12px]">
                    <p className="font-semibold text-[#1a2b24] mb-1.5">How to scan this browser (3 steps):</p>
                    <ol className="flex flex-col gap-1 text-[#5c6b62] list-decimal pl-4">
                      <li>Open the <strong>host asset</strong> at IP <code className={MONO + ' text-[#1a2b24]'}>{asset.ip_address || '—'}</code> (the Windows / Linux machine where this browser is installed).</li>
                      <li>If the host isn&apos;t connected yet, run the <strong>wizard from there</strong> (Windows or Linux platform).</li>
                      <li>On the host&apos;s Compliance tab, this browser will appear in the <strong>Co-located assets</strong> list. Tick it, click <strong>Scan now</strong> — the {(asset as any).os_normalized?.startsWith?.('firefox') ? '90 Firefox' : (asset as any).os_normalized?.startsWith?.('edge') ? '60 Edge' : (asset as any).os_normalized?.startsWith?.('chrome') ? '80 Chrome' : 'browser'} rules fold in and the score writes back to this asset page.</li>
                    </ol>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {hostInGroup ? (
                      <Link
                        href={`/assets/${hostInGroup.id}?tab=compliance`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d5c48] px-3.5 py-2 text-[12.5px] font-semibold text-white border border-[#0d5c48]"
                      >
                        <Network className="h-3.5 w-3.5" />
                        Go to host: {hostInGroup.name}
                      </Link>
                    ) : asset.ip_address ? (
                      <Link
                        href={`/assets?ip_address=${encodeURIComponent(asset.ip_address)}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#dfe3db] bg-white px-3.5 py-2 text-[12.5px] font-medium text-[#1a2b24]"
                        title="Find the host asset that shares this IP"
                      >
                        Find host at IP {asset.ip_address}
                      </Link>
                    ) : (
                      <span className="text-[11.5px] text-[#a86a12]">
                        Set this browser&apos;s <strong>IP address</strong> (via Edit) to the host&apos;s IP so the room-scan can group them.
                      </span>
                    )}
                    <Link
                      href="/admin/integrations/connect"
                      className="text-[11.5px] text-[#5c6b62] hover:text-[#1a2b24] underline"
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
        <div className={CARD + ' border-l-[3px] border-l-[#0d5c48]'}>
          <div className="px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f2ec] text-[#0d5c48]">
                <Network className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[14px] font-bold text-[#1a2b24]">This asset isn&apos;t connected yet</h3>
                <p className="mt-1 text-[12px] text-[#5c6b62] leading-relaxed">
                  Manually-added assets need an integration before they can be scanned.
                  Connect via the wizard to pick <strong>Agent</strong> (script the host runs once, then scans itself) or
                  {' '}<strong>Agentless</strong> (your backend reaches out over WinRM / SSH / DB protocol with stored credentials).
                  {' '}{wizPlatformForSelf
                    ? <>Detected platform: <code className={MONO + ' text-[#1a2b24]'}>{wizPlatformForSelf}</code> — wizard will jump straight to its credential form.</>
                    : <>OS isn&apos;t set on this asset, so the wizard will start at the platform picker.</>}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href={connectWizardHref}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d5c48] px-3.5 py-2 text-[12.5px] font-semibold text-white border border-[#0d5c48]"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Connect this asset
                  </Link>
                  {asset.host_name && (
                    <span className="text-[11.5px] text-[#8a948b]">
                      will pre-fill hostname <code className={MONO + ' text-[#1a2b24]'}>{asset.host_name}</code>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Classification + Matched benchmark ── */}
      <div className="grid gap-4 md:grid-cols-2 items-stretch">
        {/* AI Classification */}
        <div className={CARD}>
          <CardHead
            icon={<Cpu className="h-[18px] w-[18px]" strokeWidth={2} />}
            title="AI Classification"
            caption={preview.asset?.os_knowledge?.display_name || 'OS profile received from your asset feed'}
            right={
              <button
                onClick={() => reDetectMut.mutate()}
                disabled={reDetectMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#dfe3db] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#1a2b24] hover:bg-[#f9faf8] disabled:opacity-60 whitespace-nowrap"
                title="Re-probe this asset's OS via its stored connection"
              >
                {reDetectMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Cpu className="h-3 w-3" />}
                Re-detect OS
              </button>
            }
          />
          <div className="px-5 py-[18px]">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-5 gap-y-3.5">
              <Cell label="Family" value={preview.asset?.os_knowledge?.family || osFamily} empty="unknown" />
              <Cell label="Product" value={preview.asset?.os_knowledge?.product} empty="-" />
              <Cell label="Build" value={preview.asset?.os_knowledge?.build} empty="family-level" />
              <Cell label="Criticality" value={criticality ? <span className="capitalize">{criticality}</span> : null} empty="-" />
              <Cell label="Version string" value={osVersion} empty="unknown" wide />
              <Cell label="Normalized key" value={osNormalized} mono empty="unknown" wide />
              {preview.asset?.os_knowledge?.eol_year && (
                <div className="min-w-0 sm:col-span-2">
                  <div className="text-[10px] font-bold tracking-[0.05em] uppercase text-[#8a948b] mb-0.5">Support window</div>
                  <div className="text-[13px] font-medium" style={{ color: preview.asset.os_knowledge.is_supported ? '#0f7a5c' : '#b42318' }}>
                    {preview.asset.os_knowledge.is_supported ? 'Supported' : 'End-of-life'} · EOL {preview.asset.os_knowledge.eol_year}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Matched benchmark */}
        <div className={CARD}>
          <CardHead
            icon={<ClipboardList className="h-[18px] w-[18px]" strokeWidth={2} />}
            title={<span className="flex items-center gap-1.5">Matched benchmark <GuideMarker id="asset.compBenchmark" n={1} /></span>}
            caption={`Of ${total.toLocaleString()} CIS rules in the library`}
          />
          <div className="px-5 py-[18px]">
            <div className="flex items-baseline gap-2">
              <span className={'text-[34px] font-extrabold leading-none text-[#0d5c48] ' + MONO}>
                {(applicable.count ?? 0) + roomScan.selectedPeerRuleSum}
              </span>
              <span className="text-[12px] text-[#5c6b62]">
                {roomScan.selectedPeerIds.length > 0
                  ? <>apply to this scan <span className="font-medium text-[#0f7a5c]">({applicable.count ?? 0} this asset + {roomScan.selectedPeerRuleSum} from {roomScan.selectedPeerIds.length} ticked peer{roomScan.selectedPeerIds.length === 1 ? '' : 's'})</span></>
                  : 'apply to this asset'}
              </span>
            </div>
            {stage2.primary_benchmark ? (
              <div className="mt-3 rounded-lg border border-[#eceee8] bg-[#fafbf8] px-3 py-2.5">
                <div className="text-[10px] font-bold tracking-[0.05em] uppercase text-[#8a948b]">Primary benchmark</div>
                <div className="mt-0.5 text-[13px] font-medium text-[#1a2b24]">{stage2.primary_benchmark}</div>
              </div>
            ) : !osNormalized ? (
              <div className="mt-3">
                <Callout tone="warn">
                  <div className="font-semibold text-[#7a5a12]">No OS classified for this asset yet.</div>
                  <div className="mt-1 text-[#7a5a12]">Pick any of the below to populate:</div>
                  <ul className="mt-1 list-disc pl-4 flex flex-col gap-0.5 text-[#7a5a12]">
                    <li>Click <strong>Re-detect OS</strong> above (needs an active credential for this host).</li>
                    <li>Onboard via <Link href="/admin/integrations/connect" className="underline">Connect Wizard</Link> — handshake stamps the OS automatically.</li>
                    <li>Open <strong>Edit</strong> on this asset and set the OS family / version manually.</li>
                  </ul>
                </Callout>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Benchmark resolution trace ── */}
      {(() => {
        const mm = preview.matcher_mapping || {};
        const mode = preview.matcher_mode || '';
        const isStrict = mode === 'strict_single_stage';
        const benchmark = mm.benchmark_name || stage2.primary_benchmark || null;
        const pattern = mm.os_pattern || null;
        const scope = mm.scope || null;
        const mappingId = mm.mapping_id || null;
        const mappingSource = mm.source || null;
        const isSoftMatch = mappingSource === 'soft';
        const peerExtra = roomScan.selectedPeerRuleSum;
        const peerCount = roomScan.selectedPeerIds.length;
        const baseCandidates = stage1.kept ?? 0;
        const candidates = baseCandidates + peerExtra;
        const skipped = stage1.skipped ?? 0;
        const baseApplicableN = applicable.count ?? 0;
        const applicableN = baseApplicableN + peerExtra;

        return (
          <div className={CARD}>
            <CardHead
              icon={<Cpu className="h-[18px] w-[18px]" strokeWidth={2} />}
              title="Benchmark resolution"
              caption={isStrict
                ? 'Strict single-stage match: asset OS → operator-confirmed mapping → benchmark. No family-walk, no AI guess.'
                : 'Mode: ' + (mode || 'unknown')}
              right={
                isStrict && !isSoftMatch ? <Pill tone="ok">Strict</Pill>
                  : isSoftMatch ? <Pill tone="warn" title="No operator-owned OS→benchmark mapping exists for this OS. The library family-walk picked the closest benchmark so scans can still run. Add a mapping in admin → mappings to make this explicit.">Soft match</Pill>
                    : undefined
              }
            />
            <div className="px-5 py-[18px]">
              {/* Mapping chain */}
              {benchmark ? (
                <div className="rounded-xl border border-[#eceee8] bg-[#fafbf8] p-3.5">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className={'rounded-md border border-[#dfe3db] bg-white px-2 py-1 text-[#1a2b24] ' + MONO}>
                      {osNormalized || '—'}
                    </span>
                    <span className="text-[#aab2a8]">{isSoftMatch ? 'family-walk to' : 'matches pattern'}</span>
                    <span className={'rounded-md border border-[#dfe3db] bg-white px-2 py-1 text-[#1a2b24] ' + MONO}>
                      {pattern || '—'}
                    </span>
                    <span className="text-[#aab2a8]">→</span>
                    <span className="rounded-md border border-[#c3ead2] bg-white px-2 py-1 font-medium text-[#0d5c48]">
                      {benchmark}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#8a948b]">
                    {scope && (
                      <span><span className="text-[#aab2a8]">scope</span>{' '}<span className="font-medium text-[#5c6b62]">{scope}</span></span>
                    )}
                    {mappingId && (
                      <span><span className="text-[#aab2a8]">mapping_id</span>{' '}<span className={'text-[#5c6b62] ' + MONO}>#{mappingId}</span></span>
                    )}
                    <span><span className="text-[#aab2a8]">archived benchmarks</span>{' '}<span className="font-medium text-[#5c6b62]">never picked</span></span>
                  </div>
                </div>
              ) : (
                <NoMappingCallout osNormalized={osNormalized} assetId={asset.id} />
              )}

              {/* Numbers strip */}
              <div className="mt-3.5 flex flex-col sm:flex-row gap-2.5">
                <Tile
                  accent="#1a2b24"
                  num={total.toLocaleString()}
                  label="Library total"
                  sub="approved CIS plugins"
                />
                <Tile
                  accent="#0d5c48"
                  num={candidates.toLocaleString()}
                  label="From matched benchmark"
                  sub={peerCount > 0
                    ? <>{baseCandidates.toLocaleString()} this asset + <span className="font-medium text-[#0f7a5c]">{peerExtra.toLocaleString()} from {peerCount} ticked peer{peerCount === 1 ? '' : 's'}</span></>
                    : <>{skipped.toLocaleString()} from other benchmarks skipped</>}
                />
                <Tile
                  accent="#0f7a5c"
                  num={applicableN.toLocaleString()}
                  label="Applicable to scan"
                  sub={<>
                    {total > 0 ? `${Math.round((applicableN / total) * 100)}% of library` : '—'}
                    {peerCount > 0 && <span className="ml-1 text-[#0f7a5c]">(incl. {peerExtra.toLocaleString()} peer rule{peerExtra === 1 ? '' : 's'})</span>}
                  </>}
                />
              </div>

              {/* Sample rules from the matched benchmark */}
              {Array.isArray(stage1.examples_kept) && stage1.examples_kept.length > 0 && (
                <div className="mt-4 border-t border-[#eceee8] pt-3.5">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.05em] text-[#8a948b]">
                    Sample rules from this benchmark
                    {peerCount > 0 && (
                      <span className="rounded-full bg-[#e7f6ee] px-2 py-0.5 text-[10px] font-medium normal-case text-[#0f7a5c] border border-[#c3ead2]">
                        + {peerExtra.toLocaleString()} more rules from {peerCount} ticked peer{peerCount === 1 ? '' : 's'} (not shown)
                      </span>
                    )}
                  </div>
                  <ExampleList items={stage1.examples_kept} emptyText="—" />
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Applicable rules ── */}
      <div className={CARD}>
        <CardHead
          title={<span className="flex items-center gap-1.5">Applicable rules <GuideMarker id="asset.compFormula" n={2} /></span>}
          caption="Sample of what will appear when scan results arrive via the asset API"
          right={<span className="text-[12px] font-semibold text-[#5c6b62]">{applicable.count ?? 0} total</span>}
        />
        <div className="px-5 py-[18px]">
          <ExampleList items={applicable.examples} emptyText="No applicable rules until OS data lands." />
        </div>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <Callout tone={toast.kind === 'success' ? 'success' : 'error'}>
          <div className="flex items-start justify-between gap-3">
            <span style={{ color: toast.kind === 'success' ? '#0f7a5c' : '#b42318' }}>{toast.message}</span>
            <button onClick={() => setToast(null)} className="shrink-0 text-[11px] underline text-[#5c6b62]">dismiss</button>
          </div>
        </Callout>
      )}

      {/* ── Compliance scan controls ── */}
      <div className={CARD}>
        <CardHead
          icon={<Play className="h-[18px] w-[18px]" strokeWidth={2} />}
          title="Compliance scan"
          caption={
            <>
              {(applicable.count ?? 0) + roomScan.selectedPeerRuleSum} applicable rules
              {roomScan.selectedPeerIds.length > 0 && (
                <span className="ml-1 text-[#0f7a5c]">
                  ({applicable.count ?? 0} this asset + {roomScan.selectedPeerRuleSum} from {roomScan.selectedPeerIds.length} peer{roomScan.selectedPeerIds.length === 1 ? '' : 's'})
                </span>
              )}
              {'. '}Last scan: {formatTime(lastRun?.started_at || lastRun?.created_at)}.
              {' '}Scans also run automatically — agent every 30s when installed, or via your scheduled cron.
            </>
          }
          right={
            <button
              type="button"
              onClick={() => scanMutation.mutate()}
              disabled={
                ((applicable.count ?? 0) + roomScan.selectedPeerRuleSum) === 0 ||
                scanMutation.isPending ||
                scanProgress.running
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#e7f1ec] px-3.5 py-2 text-[12.5px] font-semibold text-[#0d5c48] border border-[#bcd8cc] transition-colors hover:bg-[#d8e9e0] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              title={
                ((applicable.count ?? 0) + roomScan.selectedPeerRuleSum) === 0
                  ? 'No applicable rules. Classify the OS first (Re-detect OS or Edit the asset).'
                  : scanProgress.running || scanMutation.isPending
                    ? 'A scan is already running.'
                    : roomScan.selectedPeerIds.length > 0
                      ? `Scan ${applicable.count ?? 0} rules for this asset + ${roomScan.selectedPeerRuleSum} from ${roomScan.selectedPeerIds.length} ticked peer(s). Results fan out to each.`
                      : `Scan ${applicable.count ?? 0} rules now`
              }
            >
              {scanMutation.isPending || scanProgress.running ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning…</>
              ) : roomScan.selectedPeerIds.length > 0 ? (
                <><Play className="h-3.5 w-3.5" /> Scan now (+{roomScan.selectedPeerIds.length} peer{roomScan.selectedPeerIds.length === 1 ? '' : 's'})</>
              ) : (
                <><Play className="h-3.5 w-3.5" /> Scan now</>
              )}
            </button>
          }
        />

        {/* Live progress bar */}
        {scanProgress.running && scanProgress.total > 0 && (() => {
          const shown = Math.min(scanProgress.done, scanProgress.total);
          const pct = Math.min(100, Math.round((shown / scanProgress.total) * 100));
          return (
            <div className="px-5 py-4 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11.5px] text-[#5c6b62]">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin text-[#0d5c48]" />
                  Scanning <strong>{shown}</strong> of <strong>{scanProgress.total}</strong> rules…
                </span>
                <span className={'text-[#8a948b] ' + MONO}>
                  {pct}%
                  {scanProgress.startedAt && (
                    <span className="ml-2 text-[#aab2a8]">
                      {Math.round((Date.now() - scanProgress.startedAt) / 1000)}s elapsed
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#eef1ec]">
                <div className="h-full rounded-full bg-[#0f9d78] transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[10.5px] text-[#8a948b]">
                Backend opens a WinRM/SSH session per rule and stores each result. You can leave this tab — runs continue server-side.
              </p>
            </div>
          );
        })()}
      </div>

      {/* ── Scan sessions ── */}
      <ScanSessions
        runs={runs}
        isLoading={runsQuery.isLoading}
        passFailBadge={passFailBadge}
        pluginLabel={pluginLabel}
        fmtDuration={fmtDuration}
        formatTime={formatTime}
      />
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
        <div className="text-[12px] font-semibold text-[#7a5a12]">OS not classified</div>
        <p className="mt-1 text-[12px] text-[#7a5a12]">
          This asset has no normalized OS key, so the strict matcher can&apos;t resolve a benchmark. Use{' '}
          <strong>Re-detect OS</strong> on the AI Classification panel above (requires a stored connection), or open the asset Edit
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
          <div className="text-[12px] font-semibold text-[#7a5a12]">
            No benchmark mapped for <span className={MONO}>{osNormalized}</span>
          </div>
          <p className="mt-1 text-[12px] text-[#7a5a12]">
            The strict matcher needs an <code className={MONO}>os_pattern → benchmark_name</code> row covering this OS. Add one in
            admin, or have AI suggest one from the ingested benchmark library.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={fetchSuggestion}
            disabled={loading}
            className="rounded-lg border border-[#f0dcae] bg-white px-3 py-1.5 text-[12px] font-medium text-[#7a5a12] hover:bg-[#fdf3e3] disabled:opacity-50 whitespace-nowrap"
          >
            {loading ? 'Asking AI…' : 'Suggest mapping (AI)'}
          </button>
          <Link
            href="/compliance-plugins/os-registry"
            className="rounded-lg border border-[#dfe3db] bg-white px-3 py-1.5 text-[12px] font-medium text-[#1a2b24] hover:bg-[#f9faf8] whitespace-nowrap"
          >
            Add manually
          </Link>
        </div>
      </div>

      {err && (
        <div className="mt-2 rounded-md border border-[#f3cfcb] bg-[#fdeceb] px-2 py-1 text-[11px] text-[#b42318]">
          {err}
        </div>
      )}

      {suggestion && (
        <div className="mt-3 rounded-lg border border-[#f0dcae] bg-white p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#8a948b]">
            AI suggestion · confidence <span className="font-semibold text-[#5c6b62]">{suggestion.confidence || '?'}</span>
          </div>
          {suggestion.benchmark_name ? (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                <span className={'rounded-md border border-[#dfe3db] bg-[#fafbf8] px-2 py-1 text-[#1a2b24] ' + MONO}>
                  {osNormalized}
                </span>
                <span className="text-[#aab2a8]">→</span>
                <span className="rounded-md border border-[#c3ead2] bg-[#e7f6ee] px-2 py-1 font-medium text-[#0d5c48]">
                  {suggestion.benchmark_name}
                </span>
              </div>
              {suggestion.reasoning && (
                <p className="mt-1.5 text-[11px] italic text-[#5c6b62]">{suggestion.reasoning}</p>
              )}
              <p className="mt-2 text-[11px] text-[#8a948b]">
                Review and accept this mapping in{' '}
                <Link href="/compliance-plugins/os-registry" className="text-[#0d5c48] underline">admin → mappings</Link>
                . Per anti-hallucination policy, AI never auto-applies — an operator must confirm.
              </p>
            </>
          ) : (
            <p className="mt-1 text-[12px] text-[#5c6b62]">
              AI couldn&apos;t pick a benchmark with confidence. Most likely the required benchmark PDF hasn&apos;t been ingested yet —
              upload it via{' '}
              <Link href="/compliance-plugins/ingest" className="text-[#0d5c48] underline">Rules library → Ingest</Link>{' '}
              and the suggester will pick it up next time.
            </p>
          )}
        </div>
      )}
    </Callout>
  );
}

function ScanSessions({
  runs, isLoading, passFailBadge, pluginLabel, fmtDuration, formatTime,
}: {
  runs: any[];
  isLoading: boolean;
  passFailBadge: (r: any) => React.ReactNode;
  pluginLabel: (r: any) => string;
  fmtDuration: (r: any) => string;
  formatTime: (iso?: string | null) => string;
}) {
  const [openSessions, setOpenSessions] = useState<Set<string>>(new Set([]));
  const [hasInteracted, setHasInteracted] = useState(false);
  const [filter, setFilter] = useState<'all' | 'failed' | 'error' | 'passed' | 'running'>('all');

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

  const firstId = sessions[0]?.id;

  const toggle = (id: string) => {
    setOpenSessions(prev => {
      const startingSet = hasInteracted
        ? prev
        : (firstId ? new Set<string>([firstId]) : new Set<string>());
      const next = new Set(startingSet);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setHasInteracted(true);
  };

  if (isLoading) {
    return (
      <div className={CARD + ' px-5 py-4 text-[12px] text-[#8a948b]'}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading runs...
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div className={CARD + ' px-6 py-8 text-center text-[12px] text-[#8a948b]'}>
        No scans yet. Results will appear here on the next agent tick or scheduled scan.
      </div>
    );
  }

  // Auto-open the first session on initial render only.
  const effectiveOpen = !hasInteracted && firstId ? new Set([firstId]) : openSessions;

  return (
    <div className="flex flex-col gap-3">
      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
          <div>
            <h3 className="text-[15px] font-extrabold tracking-[-0.01em] text-[#1a2b24] flex items-center gap-1.5">
              Scan sessions
              <GuideMarker id="asset.compScanFrequency" n={4} />
              <GuideMarker id="asset.compFeedsHardeningGap" n={5} />
            </h3>
            <p className="text-[11.5px] text-[#aab2a8] mt-px">Each session = one Scan-all invocation. Click to expand and see individual rule outcomes.</p>
          </div>
          <div className="flex items-center gap-1.5">
            {(['all', 'failed', 'error', 'passed', 'running'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={'rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold capitalize ' + (filter === f ? 'border-[#0d5c48] bg-[#e7f6ee] text-[#0d5c48]' : 'border-[#dfe3db] bg-white text-[#5c6b62] hover:bg-[#f9faf8]')}
              >{f}</button>
            ))}
          </div>
        </div>
      </div>

      {sessions.map((session: any) => {
        const isOpen = effectiveOpen.has(session.id);
        const totals = session.runs.reduce(
          (a: any, r: any) => {
            const s = (r.status || '').toLowerCase();
            a.total += 1;
            if (s === 'passed') a.passed += 1;
            else if (s === 'failed') a.failed += 1;
            else if (s === 'error') a.error += 1;
            else if (s === 'running' || s === 'pending') a.running += 1;
            else a.other += 1;
            return a;
          },
          { total: 0, passed: 0, failed: 0, error: 0, running: 0, other: 0 },
        );
        const span = Math.max(0, session.endedAt ? (session.startedAt - session.endedAt) : 0);
        const spanSec = Math.round(span / 1000);
        const passRate = totals.total ? Math.round((totals.passed / totals.total) * 100) : 0;
        const filteredRuns = session.runs.filter((r: any) => filter === 'all' ? true : (r.status || '').toLowerCase() === filter);

        return (
          <div key={session.id} className={CARD}>
            <button
              onClick={() => toggle(session.id)}
              className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-[#f9faf8]"
            >
              {isOpen ? <ChevronDown className="h-4 w-4 text-[#8a948b]" /> : <ChevronRight className="h-4 w-4 text-[#8a948b]" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13.5px] font-bold text-[#1a2b24]">
                    Scan at {formatTime(new Date(session.startedAt).toISOString())}
                  </span>
                  <span className="text-[10.5px] text-[#8a948b]">{totals.total} rules · {spanSec}s elapsed</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded-full bg-[#e7f6ee] border border-[#c3ead2] px-1.5 py-0.5 font-bold text-[#0f7a5c]">PASS {totals.passed}</span>
                  <span className="rounded-full bg-[#fdeceb] border border-[#f3cfcb] px-1.5 py-0.5 font-bold text-[#b42318]">FAIL {totals.failed}</span>
                  {totals.error > 0 && <span className="rounded-full bg-[#fdf3e3] border border-[#f0dcae] px-1.5 py-0.5 font-bold text-[#a86a12]">ERR {totals.error}</span>}
                  {totals.running > 0 && <span className="rounded-full bg-[#fdf3e3] border border-[#f0dcae] px-1.5 py-0.5 font-bold text-[#a86a12]">RUN {totals.running}</span>}
                  <span className={'ml-auto text-[#5c6b62] ' + MONO}>Pass rate: <strong>{passRate}%</strong></span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#eef1ec]">
                  <div className="h-full bg-[#0f9d78]" style={{ width: passRate + '%' }} />
                </div>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-[#eceee8]">
                {filteredRuns.length === 0 ? (
                  <div className="px-5 py-3 text-center text-[11px] text-[#8a948b]">
                    No runs match filter <strong>{filter}</strong>.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr>
                          <th className={TH}>Rule</th>
                          <th className={TH + ' w-32'}>Started</th>
                          <th className={TH + ' w-24'}>Result</th>
                          <th className={TH + ' w-16'}>Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRuns.slice(0, 100).map((run: any) => (
                          <tr key={run.id} className="hover:bg-[#f9faf8]">
                            <td className={TD + ' text-[#1a2b24]'}>
                              <div className="font-semibold leading-snug">{pluginLabel(run)}</div>
                              {run.result_summary && (
                                <div className="mt-0.5 text-[10.5px] text-[#8a948b] line-clamp-2">{run.result_summary}</div>
                              )}
                            </td>
                            <td className={TD + ' text-[10.5px] text-[#8a948b]'}>{formatTime(run.started_at || run.created_at)}</td>
                            <td className={TD}>{passFailBadge(run)}</td>
                            <td className={TD + ' text-[11px] text-[#5c6b62]'}>{fmtDuration(run)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {filteredRuns.length > 100 && (
                  <div className="border-t border-[#eceee8] bg-[#fafbf8] px-3 py-1.5 text-[10.5px] text-[#8a948b]">
                    Showing first 100 of {filteredRuns.length} runs.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
