import { useEffect, useMemo, useState } from 'react';
import { Link, useRoute } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compliancePluginsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import ScanProgressModal from '../../_scan-progress-modal';

type RuleRow = {
  plugin_id: number;
  rule_id: string;
  title: string;
  severity: string;
  benchmark: string;
  runner_type: string;
  status: 'passed' | 'failed' | 'error' | 'running' | 'never_run';
  result_summary?: string | null;
  started_at?: string | null;
  run_id?: number | null;
};

type AssetMeta = {
  id: number;
  name: string;
  host_name?: string | null;
  ip_address?: string | null;
  asset_type?: string | null;
  criticality?: string | null;
  owner_name?: string | null;
  confidentiality_rating?: number | null;
  integrity_rating?: number | null;
  availability_rating?: number | null;
  status?: string | null;
  os_family: string;
  os_family_label: string;
};

type Coverage = {
  asset: AssetMeta;
  totals: {
    total_rules: number;
    passed: number;
    failed: number;
    error: number;
    running?: number;
    never_run: number;
    pass_rate: number;
    last_scan_at?: string | null;
  };
  rules: RuleRow[];
};

const STATUS_COLORS: Record<string, string> = {
  passed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-gray-200 text-gray-700',
  running: 'bg-blue-100 text-blue-800',
  never_run: 'bg-gray-100 text-gray-500',
};

const SEV_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
};

const CRIT_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-green-100 text-green-800 border-green-200',
};

function fmtAgo(iso?: string | null): string {
  if (!iso) return 'never';
  // Backend returns naive UTC — append Z so we don't interpret as local.
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

export default function ComplianceAssetDashboardPage() {
  const [, params] = useRoute<{ id: string }>('/compliance/plugins/asset/:id');
  const assetId = params ? Number(params.id) : 0;
  const qc = useQueryClient();
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canScan = hasPermission('compliance:scan:execute');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [searchQ, setSearchQ] = useState('');
  // Pagination — 424 rules in one DOM is sluggish, especially with
  // failed-summary text wrapping. Default 50 per page.
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const q = useQuery<Coverage>({
    queryKey: ['compliance-plugins.per-asset-coverage', assetId],
    queryFn: async () => (await compliancePluginsApi.perAssetCoverage(assetId)).data,
    enabled: assetId > 0,
    refetchInterval: 10000,
  });

  const [progress, setProgress] = useState<{
    startedAtIso: string;
    completed: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    if (!progress) return;
    let cancelled = false;
    let idleTicks = 0;
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await compliancePluginsApi.listRuns({
          asset_id: assetId,
          limit: 2000,
        });
        const since = new Date(progress.startedAtIso).getTime();
        const done = (r.data.runs ?? []).filter((x: { started_at?: string | null; status?: string }) => {
          if (!x.started_at) return false;
          const raw = x.started_at;
          const utc = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
          if (new Date(utc).getTime() < since) return false;
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
        qc.invalidateQueries({ queryKey: ['compliance-plugins.per-asset-coverage', assetId] });
      } catch {
        /* network blip — next tick */
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [progress?.startedAtIso, assetId, qc]);

  const scanMut = useMutation({
    mutationFn: () => compliancePluginsApi.scanAll({ asset_id: assetId }),
    onMutate: () => {
      setProgress({
        startedAtIso: new Date().toISOString(),
        completed: 0,
        total: q.data?.totals.total_rules ?? 424,
      });
    },
    // No onSettled cleanup — modal closes when polling sees completion,
    // not when the HTTP request resolves (proxy times out at 2 min).
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-plugins.per-asset-coverage', assetId] });
      qc.invalidateQueries({ queryKey: ['compliance-plugins.assets-overview'] });
    },
  });

  const filtered = useMemo(() => {
    const rules = q.data?.rules ?? [];
    return rules.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (severityFilter && r.severity !== severityFilter) return false;
      if (searchQ) {
        const hay = `${r.rule_id} ${r.title}`.toLowerCase();
        if (!hay.includes(searchQ.toLowerCase())) return false;
      }
      return true;
    });
  }, [q.data, statusFilter, severityFilter, searchQ]);

  // Reset to page 0 whenever filters change so the user doesn't land
  // on an empty page after narrowing the dataset.
  useEffect(() => { setPage(0); }, [statusFilter, severityFilter, searchQ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );

  if (!assetId) {
    return <div className="p-6 text-sm text-gray-500">Invalid asset id.</div>;
  }

  if (q.isLoading) {
    return <div className="p-6 text-sm text-gray-500">Loading asset coverage…</div>;
  }

  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <Link href="/compliance/plugins" className="text-sm text-blue-600 hover:underline">
          ← Back to CIS Benchmark
        </Link>
        <div className="mt-4 text-sm text-red-600">
          Failed to load asset. It may have been deleted or you don't have access.
        </div>
      </div>
    );
  }

  const { asset, totals } = q.data;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <ScanProgressModal
        open={progress !== null}
        title="Scanning asset"
        completed={progress?.completed ?? 0}
        total={progress?.total ?? 0}
        currentAssetName={
          asset.host_name ? `${asset.name} (${asset.host_name})` : asset.name
        }
        scope="asset"
      />
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/compliance/plugins"
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to CIS Benchmark
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
            scanMut.mutate();
          }}
          disabled={permsLoading || scanMut.isPending || progress !== null}
          title={canScan
            ? 'Run every approved CIS rule against this single host'
            : 'Your role cannot run scans — ask your admin for the Scanning Admin role'}
          className={`px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 ${
            canScan
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-400 text-white cursor-not-allowed hover:bg-gray-400'
          }`}
        >
          {canScan ? '▶ Scan this asset' : '🔒 Scan this asset'}
        </button>
      </div>

      {/* Asset header */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
              {asset.os_family_label}
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">{asset.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
              {asset.host_name && (
                <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                  {asset.host_name}
                </span>
              )}
              {asset.ip_address && (
                <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                  {asset.ip_address}
                </span>
              )}
              {asset.owner_name && <span>Owner: {asset.owner_name}</span>}
              {asset.status && (
                <span className="text-xs text-gray-500">Status: {asset.status}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {asset.criticality && (
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                  CRIT_COLORS[asset.criticality.toLowerCase()] ??
                  'bg-gray-100 text-gray-700'
                }`}
              >
                {asset.criticality} criticality
              </span>
            )}
            <div className="text-xs text-gray-500">
              CIA:{' '}
              {[
                asset.confidentiality_rating,
                asset.integrity_rating,
                asset.availability_rating,
              ]
                .map((v) => (v == null ? '–' : v))
                .join(' / ')}
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Pass Rate</div>
          <div className="mt-1 text-2xl font-semibold text-blue-700">
            {totals.pass_rate}%
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            of {totals.total_rules} rules
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Passed</div>
          <div className="mt-1 text-2xl font-semibold text-green-700">
            {totals.passed}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Failed</div>
          <div className="mt-1 text-2xl font-semibold text-red-700">
            {totals.failed}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Errored</div>
          <div className="mt-1 text-2xl font-semibold text-gray-700">
            {totals.error}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Last Scan</div>
          <div className="mt-1 text-sm font-medium text-gray-900">
            {fmtAgo(totals.last_scan_at)}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {totals.never_run} never run
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-1">
              Status
            </span>
            {[
              { v: '', l: 'All' },
              { v: 'passed', l: 'Passed' },
              { v: 'failed', l: 'Failed' },
              { v: 'error', l: 'Errored' },
              { v: 'never_run', l: 'Never run' },
            ].map((c) => (
              <button
                key={c.v || 'all'}
                onClick={() => setStatusFilter(c.v)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                  statusFilter === c.v
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {c.l}
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-gray-200" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-1">
              Severity
            </span>
            {[
              { v: '', l: 'All' },
              { v: 'critical', l: 'Critical' },
              { v: 'high', l: 'High' },
              { v: 'medium', l: 'Medium' },
              { v: 'low', l: 'Low' },
            ].map((c) => (
              <button
                key={c.v || 'all'}
                onClick={() => setSeverityFilter(c.v)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                  severityFilter === c.v
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {c.l}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search rule…"
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md w-64"
          />
        </div>
      </div>

      {/* Rules table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th className="text-left px-4 py-2 w-32">Rule ID</th>
                <th className="text-left px-4 py-2">Title</th>
                <th className="text-left px-4 py-2 w-24">Severity</th>
                <th className="text-left px-4 py-2 w-24">Status</th>
                <th className="text-left px-4 py-2 w-32">Last Run</th>
                <th className="text-right px-4 py-2 w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    {q.data.rules.length === 0
                      ? 'No approved CIS rules in the library yet. Upload a CIS PDF to get started.'
                      : 'No rules match the current filters.'}
                  </td>
                </tr>
              )}
              {paged.map((r) => (
                <tr key={r.plugin_id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    {r.rule_id}
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-gray-900">{r.title}</div>
                    {r.result_summary && r.status === 'failed' && (
                      <div className="text-xs text-red-600 mt-0.5 line-clamp-1">
                        {r.result_summary}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                        SEV_COLORS[r.severity] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                      }`}
                    >
                      {r.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {r.status === 'never_run' ? 'never run' : r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {fmtAgo(r.started_at)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.run_id ? (
                      <Link
                        href={`/compliance/plugins/${r.plugin_id}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        View
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination footer */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
            <div>
              Showing{' '}
              <strong className="text-gray-900">{page * PAGE_SIZE + 1}</strong>
              –
              <strong className="text-gray-900">{Math.min((page + 1) * PAGE_SIZE, filtered.length)}</strong>
              {' '}of <strong className="text-gray-900">{filtered.length}</strong> rules
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="px-2 py-1 border border-gray-300 rounded disabled:opacity-30 hover:bg-white"
              >
                « First
              </button>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 border border-gray-300 rounded disabled:opacity-30 hover:bg-white"
              >
                ‹ Prev
              </button>
              <span className="px-2">
                Page <strong>{page + 1}</strong> / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 border border-gray-300 rounded disabled:opacity-30 hover:bg-white"
              >
                Next ›
              </button>
              <button
                onClick={() => setPage(totalPages - 1)}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 border border-gray-300 rounded disabled:opacity-30 hover:bg-white"
              >
                Last »
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
