import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compliancePluginsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import ScanProgressModal from './_scan-progress-modal';

type AssetRow = {
  id: number;
  name: string;
  host_name?: string | null;
  ip_address?: string | null;
  asset_type?: string | null;
  criticality?: string | null;
  owner_name?: string | null;
  status?: string | null;
  os_family: string;
  runner_type?: string | null;
  connection_id?: number | null;
  has_connection: boolean;
  last_scan_at?: string | null;
  scanned_rules: number;
  passed: number;
  failed: number;
  errored: number;
  pass_rate: number;
};

type AssetGroup = {
  os_family: string;
  label: string;
  count: number;
  assets: AssetRow[];
};

type Overview = {
  groups: AssetGroup[];
  totals: {
    assets: number;
    scanned: number;
    unscanned: number;
    avg_pass_rate: number;
    total_rules: number;
  };
};

const FAMILY_ICONS: Record<string, string> = {
  windows_server: '🪟',
  windows_workstation: '💻',
  linux_server: '🐧',
  aws_account: '☁️',
  azure_account: '☁️',
  gcp_account: '☁️',
  vmware_host: '📦',
  network_device: '🔌',
  database: '🗄️',
  container: '🐳',
  unclassified: '❓',
};

const FAMILY_ACCENT: Record<string, string> = {
  windows_server: 'border-blue-200 bg-blue-50/50',
  windows_workstation: 'border-blue-200 bg-blue-50/30',
  linux_server: 'border-orange-200 bg-orange-50/50',
  aws_account: 'border-amber-200 bg-amber-50/50',
  azure_account: 'border-sky-200 bg-sky-50/50',
  gcp_account: 'border-emerald-200 bg-emerald-50/50',
  vmware_host: 'border-violet-200 bg-violet-50/50',
  network_device: 'border-pink-200 bg-pink-50/50',
  database: 'border-indigo-200 bg-indigo-50/50',
  container: 'border-cyan-200 bg-cyan-50/50',
  unclassified: 'border-gray-200 bg-gray-50',
};

const CRIT_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-green-100 text-green-800 border-green-200',
};

function fmtAgo(iso?: string | null): string {
  if (!iso) return 'never';
  // Backend returns naive UTC ("2026-05-15T10:59:32" without Z) — JS would
  // otherwise parse as local time and report 5h offset on PKT clocks.
  const utc = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const t = new Date(utc).getTime();
  const ms = Date.now() - t;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

type ScanProgress = {
  assetId: number;
  startedAtIso: string;
  completed: number;
  total: number;
};

export default function AssetsPanel() {
  const qc = useQueryClient();
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canScan = hasPermission('compliance:scan:execute');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  const q = useQuery<Overview>({
    queryKey: ['compliance-plugins.assets-overview'],
    queryFn: async () => (await compliancePluginsApi.assetsOverview()).data,
    refetchInterval: 15000,
  });

  // Poll runs while a scan is active. The modal stays open until polling
  // sees the scan finish (done >= total OR no new runs in ~45s) — not
  // when the HTTP request returns. The Express proxy gives up at 2 min on
  // a 7-min scan, so mutation-driven cleanup would close the modal early.
  useEffect(() => {
    if (!progress) return;
    let cancelled = false;
    let idleTicks = 0;
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await compliancePluginsApi.listRuns({
          asset_id: progress.assetId,
          limit: 2000,
        });
        const since = new Date(progress.startedAtIso).getTime();
        const done = (r.data.runs ?? []).filter((x: { started_at?: string | null; status?: string }) => {
          if (!x.started_at) return false;
          const startedRaw = x.started_at;
          const startedUtc = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(startedRaw)
            ? startedRaw
            : `${startedRaw}Z`;
          if (new Date(startedUtc).getTime() < since) return false;
          return x.status === 'passed' || x.status === 'failed' || x.status === 'error';
        }).length;
        setProgress((p) => {
          if (!p) return p;
          if (done >= p.total) {
            setTimeout(() => setProgress(null), 1500);
          }
          if (done === p.completed) {
            idleTicks += 1;
            if (idleTicks >= 15) setTimeout(() => setProgress(null), 1000);
          } else {
            idleTicks = 0;
          }
          return { ...p, completed: done };
        });
        qc.invalidateQueries({ queryKey: ['compliance-plugins.assets-overview'] });
      } catch {
        /* network blip — retry on next tick */
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [progress?.assetId, progress?.startedAtIso, qc]);

  const totalRules = q.data?.totals.total_rules ?? 424;

  const scanMut = useMutation({
    mutationFn: (assetId: number) =>
      compliancePluginsApi.scanAll({ asset_id: assetId }),
    onMutate: (id) => {
      setProgress({
        assetId: id,
        startedAtIso: new Date().toISOString(),
        completed: 0,
        total: totalRules,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-plugins.assets-overview'] });
    },
    // No onSettled cleanup — modal closes when polling detects completion.
  });

  const totals = q.data?.totals;
  const groups = q.data?.groups ?? [];

  // Asset name for the modal's "Currently scanning" line — looked up
  // from the overview groups so the modal labels the right host without
  // hitting the API again.
  const scanningAssetName = useMemo(() => {
    if (!progress) return null;
    for (const g of groups) {
      for (const a of g.assets) {
        if (a.id === progress.assetId) {
          return a.host_name ? `${a.name} (${a.host_name})` : a.name;
        }
      }
    }
    return `Asset #${progress.assetId}`;
  }, [progress?.assetId, groups]);

  return (
    <div className="space-y-6">
      <ScanProgressModal
        open={progress !== null}
        title="Scanning asset"
        completed={progress?.completed ?? 0}
        total={progress?.total ?? 0}
        currentAssetName={scanningAssetName}
        scope="asset"
      />
      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Total Assets</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {totals?.assets ?? '—'}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Scanned</div>
          <div className="mt-1 text-2xl font-semibold text-green-700">
            {totals?.scanned ?? '—'}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Unscanned</div>
          <div className="mt-1 text-2xl font-semibold text-amber-700">
            {totals?.unscanned ?? '—'}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Avg Pass Rate</div>
          <div className="mt-1 text-2xl font-semibold text-blue-700">
            {totals ? `${totals.avg_pass_rate}%` : '—'}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {totals ? `of ${totals.total_rules} rules` : ''}
          </div>
        </div>
      </div>

      {q.isLoading && (
        <div className="text-sm text-gray-500">Loading assets…</div>
      )}

      {!q.isLoading && groups.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center">
          <div className="text-4xl mb-3">📋</div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">
            No assets in this tenant yet
          </h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Add assets to your IT inventory first, then they'll appear here
            grouped by OS so you can run CIS benchmarks against each one.
          </p>
          <Link
            href="/assets"
            className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            Go to IT Assets →
          </Link>
        </div>
      )}

      {/* Groups */}
      {groups.map((g) => {
        const isCollapsed = collapsed[g.os_family] === true;
        return (
          <div
            key={g.os_family}
            className={`border rounded-lg shadow-sm ${FAMILY_ACCENT[g.os_family] ?? 'border-gray-200 bg-white'}`}
          >
            <button
              onClick={() =>
                setCollapsed((c) => ({ ...c, [g.os_family]: !isCollapsed }))
              }
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{FAMILY_ICONS[g.os_family] ?? '📦'}</span>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{g.label}</h3>
                  <p className="text-xs text-gray-600">
                    {g.count} asset{g.count === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <span className="text-gray-400 text-sm">
                {isCollapsed ? '▸ expand' : '▾ collapse'}
              </span>
            </button>

            {!isCollapsed && (
              <div className="overflow-x-auto border-t border-gray-200 bg-white rounded-b-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                    <tr>
                      <th className="text-left px-4 py-2">Asset</th>
                      <th className="text-left px-4 py-2">Host / IP</th>
                      <th className="text-left px-4 py-2">Criticality</th>
                      <th className="text-left px-4 py-2">Connection</th>
                      <th className="text-left px-4 py-2">Last Scan</th>
                      <th className="text-left px-4 py-2">Pass Rate</th>
                      <th className="text-right px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {g.assets.map((a) => (
                      <tr key={a.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link
                            href={`/compliance/plugins/asset/${a.id}`}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            {a.name}
                          </Link>
                          {a.owner_name && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              Owner: {a.owner_name}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">
                          {a.host_name || a.ip_address || (
                            <span className="text-gray-400 italic">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {a.criticality ? (
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                                CRIT_COLORS[a.criticality.toLowerCase()] ??
                                'bg-gray-100 text-gray-700 border-gray-200'
                              }`}
                            >
                              {a.criticality}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {a.has_connection ? (
                            <span className="text-green-700">
                              ✓ {a.runner_type ?? 'Connected'}
                            </span>
                          ) : (
                            <span className="text-amber-700">⚠ No connection</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {fmtAgo(a.last_scan_at)}
                        </td>
                        <td className="px-4 py-3">
                          {a.scanned_rules > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-gray-200 rounded-full h-1.5 w-20 overflow-hidden">
                                <div
                                  className={`h-full ${
                                    a.pass_rate >= 80
                                      ? 'bg-green-500'
                                      : a.pass_rate >= 50
                                      ? 'bg-yellow-500'
                                      : 'bg-red-500'
                                  }`}
                                  style={{ width: `${a.pass_rate}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-gray-700">
                                {a.pass_rate}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">never scanned</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/compliance/plugins/asset/${a.id}`}
                              className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                            >
                              View
                            </Link>
                            <button
                              onClick={() => {
                                if (!canScan) {
                                  alert(
                                    "🔒 Permission required\n\n" +
                                    "Only users with the scan permission can run CIS scans. " +
                                    "Ask your admin for the Scanning Admin role."
                                  );
                                  return;
                                }
                                scanMut.mutate(a.id);
                              }}
                              disabled={
                                permsLoading || progress !== null || !a.has_connection
                              }
                              className={`px-3 py-1 text-xs rounded text-white disabled:opacity-50 disabled:cursor-not-allowed ${
                                canScan
                                  ? 'bg-blue-600 hover:bg-blue-700'
                                  : 'bg-gray-400 cursor-not-allowed hover:bg-gray-400'
                              }`}
                              title={
                                !canScan && !permsLoading
                                  ? 'Your role cannot run scans — ask your admin for the Scanning Admin role'
                                  : a.has_connection
                                  ? 'Run all approved CIS rules against this asset'
                                  : 'Connect this asset first via the Connect Wizard'
                              }
                            >
                              {canScan ? 'Scan now' : '🔒 Scan now'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
