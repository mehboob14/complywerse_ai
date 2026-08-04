'use client';

export const dynamic = 'force-dynamic';

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compliancePluginsApi, assetsApi, integrationsApi, apiClient } from '@/lib/api';
import ScanProgressModal from './_scan-progress-modal';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/ToastProvider';
import { useTabParam } from '@/lib/useTabParam';

const CisIngestPage = lazy(() => import('./ingest/page'));
const AssetsPanel = lazy(() => import('./_assets-panel'));

type Plugin = {
  id: number;
  plugin_key: string;
  benchmark: string;
  rule_id: string;
  title: string;
  description?: string | null;
  rationale?: string | null;
  remediation?: string | null;
  severity: string;
  runner_type: string;
  enabled: boolean;
  is_builtin: boolean;
  source_url?: string | null;
  stats?: { passed: number; failed: number; error: number; total: number };
};

type UserRef = {
  id: number;
  name: string;
  email?: string | null;
  username?: string | null;
  initial: string;
};

type Run = {
  id: number;
  plugin_id: number;
  plugin_key?: string | null;
  plugin_title?: string | null;
  asset_id?: number | null;
  asset_name?: string | null;
  connection_id?: number | null;
  connection_name?: string | null;
  status: string;
  result_summary?: string | null;
  evidence_hash?: string | null;
  duration_ms?: number | null;
  triggered_by: string;
  triggered_by_user?: UserRef | null;
  triggered_by_user_id?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
};

const SEV_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
};

// Cywift-style left-border stripe per severity — visible at a glance.
const SEV_STRIPE: Record<string, string> = {
  critical: 'border-l-4 border-l-red-500',
  high: 'border-l-4 border-l-orange-500',
  medium: 'border-l-4 border-l-yellow-500',
  low: 'border-l-4 border-l-green-500',
};

// Runner-type badge colours (Cywift-style platform indicators).
const RUNNER_COLORS: Record<string, string> = {
  windows_winrm: 'bg-blue-50 text-blue-700 border-blue-200',
  linux_ssh: 'bg-orange-50 text-orange-700 border-orange-200',
  aws_readonly: 'bg-amber-50 text-amber-800 border-amber-200',
  azure_readonly: 'bg-sky-50 text-sky-700 border-sky-200',
  gcp_readonly: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  manual: 'bg-gray-50 text-gray-700 border-gray-200',
};

const RUNNER_SHORT: Record<string, string> = {
  windows_winrm: 'Windows',
  linux_ssh: 'Linux',
  netdev_ssh: 'Cisco',
  oracle_sql: 'Oracle',
  aws_readonly: 'AWS',
  azure_readonly: 'Azure',
  gcp_readonly: 'GCP',
  manual: 'Manual',
};

const STATUS_COLORS: Record<string, string> = {
  passed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-gray-200 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  skipped: 'bg-yellow-100 text-yellow-800',
  pending: 'bg-gray-100 text-gray-700',
};

export default function CompliancePluginsPage() {
  const qc = useQueryClient();
  const { hasPermission, isAdmin, isLoading: permsLoading } = usePermissions();
  // Spec: Disable a CIS rule + Import CIS PDF are Tenant Admin only — even
  // Scanning Admins can't do these. Locked with 🔒 + tooltip everywhere else.
  const canManageRules = isAdmin;
  const toast = useToast();
  const canScan = hasPermission('compliance:scan:execute');
  // Confirmation modal state — gate Scan All behind explicit consent so
  // an accidental click doesn't kick off 2475 plugin runs across the tenant.
  const [scanAllConfirm, setScanAllConfirm] = useState(false);
  const [tab, setTab] = useTabParam<'library' | 'assets' | 'runs' | 'import' | 'import-json'>('library', ['library', 'assets', 'runs', 'import', 'import-json']);
  // Advanced features hidden by default — power users toggle with ?advanced=1
  const [showAdvanced] = useState<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).get('advanced') === '1';
    } catch { return false; }
  });
  const [benchmark, setBenchmark] = useState<string>('');
  const [runner, setRunner] = useState<string>('');
  const [severity, setSeverity] = useState<string>('');
  const [selected, setSelected] = useState<Plugin | null>(null);
  // Phase 4.2 — bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Phase 4.3 — view mode toggle
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  // Phase 6.x — expanded runs (Read more toggle)
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set());
  const [hashCopied, setHashCopied] = useState<number | null>(null);
  // Runs activity filter — "all team" vs "only my actions"
  const [runScope, setRunScope] = useState<'all' | 'mine'>('all');

  // Current user — used to filter "Mine" runs and to mark "(you)" tag.
  // /auth/me returns { authenticated, user: {...} } so we unwrap.
  const meQ = useQuery({
    queryKey: ['auth.me'],
    queryFn: async () => {
      const r = await apiClient.get('/auth/me');
      const data = r.data as { authenticated?: boolean; user?: { id: number; email?: string; full_name?: string; display_name?: string; username?: string } };
      return data.user || null;
    },
    staleTime: 60 * 1000,
  });

  const pluginsQ = useQuery({
    queryKey: ['compliance-plugins', benchmark, runner, severity],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (benchmark) params.benchmark = benchmark;
      if (runner) params.runner_type = runner;
      if (severity) params.severity = severity;
      // When the operator narrows by benchmark/runner/severity, bump the
      // API cap so we actually see every rule that matches the filter.
      // Default backend limit is 500 — Windows 11 Enterprise has 548
      // rules, so without this the filter would cut off the last 48
      // (sorted alphabetically by rule_id) and look broken.
      const hasFilter = Boolean(benchmark || runner || severity);
      if (hasFilter) params.limit = '5000';
      const r = await compliancePluginsApi.list(params);
      return r.data as {
        plugins: Plugin[];
        total: number;
        returned?: number;
        limit?: number;
        available_runner_types: string[];
      };
    },
  });

  const benchmarksQ = useQuery({
    queryKey: ['compliance-plugins.benchmarks'],
    queryFn: async () => (await compliancePluginsApi.benchmarks()).data as { benchmarks: { benchmark: string; runner_type: string; rule_count: number }[] },
  });

  const runsQ = useQuery({
    queryKey: ['compliance-plugins.runs'],
    // Use a large limit so "Mine" KPI math reflects ALL the user's runs,
    // not just the most recent 100. Backend caps at 500 per request, so
    // this is the largest "no-pagination" page we can ask for.
    queryFn: async () => (await compliancePluginsApi.listRuns({ limit: 2000 })).data as { runs: Run[]; total: number },
    enabled: true,
    refetchInterval: tab === 'runs' ? 4000 : false,
  });

  const assetsQ = useQuery({
    queryKey: ['compliance-plugins.assets'],
    queryFn: async () => (await assetsApi.getAll()).data as unknown as { assets?: { id: number; name: string }[] } | { id: number; name: string }[],
  });

  const connectionsQ = useQuery({
    queryKey: ['compliance-plugins.connections'],
    queryFn: async () => (await integrationsApi.listConnections()).data as { connections?: { id: number; connection_name: string; integration_type: string; console_url?: string }[] } | { id: number; connection_name: string; integration_type: string; console_url?: string }[],
  });

  // Per-user activity breakdown. Backend computes "latest run per (user,
  // plugin)" and counts how many distinct rules passed/failed/errored
  // for each team member. Powers the breakdown panel below the KPI strip.
  const perUserQ = useQuery({
    queryKey: ['compliance-plugins.per-user'],
    queryFn: async () => (await compliancePluginsApi.perUserSummary()).data as {
      total_rules: number;
      your_user_id: number | null;
      your_user_email: string | null;
      users: Array<{
        user: { id: number; username: string; email: string | null; display_name: string };
        passed: number;
        failed: number;
        errored: number;
        scanned: number;
        pass_pct: number;
      }>;
    },
    refetchInterval: 10000,
  });

  // The library is built exclusively by uploading CIS benchmark PDFs
  // through the Import CIS PDF tab — there's no "default catalog" to
  // re-seed. We dropped the Re-seed button on the page header so the
  // workflow is unambiguous: empty library → upload a PDF.

  // Live progress for the global Scan All button — poll tenant runs and
  // count those started since the scan kicked off. Also surfaces which
  // host is currently being scanned so the modal can label it.
  const [scanAllProgress, setScanAllProgress] = useState<{
    startedAtIso: string;
    completed: number;
    total: number;
    currentAsset?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!scanAllProgress) return;
    let cancelled = false;
    let idleTicks = 0;
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await compliancePluginsApi.listRuns({ limit: 5000 });
        const since = new Date(scanAllProgress.startedAtIso).getTime();
        const fresh = (r.data.runs ?? []).filter((x: { started_at?: string | null; status?: string }) => {
          if (!x.started_at) return false;
          const raw = x.started_at;
          const utc = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
          return new Date(utc).getTime() >= since;
        });
        const done = fresh.filter((x: { status?: string }) =>
          x.status === 'passed' || x.status === 'failed' || x.status === 'error'
        ).length;
        const latest = fresh[0] as { asset_name?: string | null; status?: string } | undefined;
        const currentAsset = latest?.asset_name ?? null;
        setScanAllProgress((p) => {
          if (!p) return p;
          // Auto-close once we've reached the expected total — the modal is
          // driven by polling, NOT by the HTTP request. The Express proxy
          // hangs up at 2 min on long scans; without this we'd leave the
          // modal open forever (or close prematurely on mutation error).
          if (done >= p.total) {
            setTimeout(() => setScanAllProgress(null), 1500);
          }
          // Detect a stuck scan: if no new runs in ~45s, declare done.
          if (done === p.completed) {
            idleTicks += 1;
            if (idleTicks >= 15) {
              setTimeout(() => setScanAllProgress(null), 1000);
            }
          } else {
            idleTicks = 0;
          }
          return { ...p, completed: done, currentAsset };
        });
        qc.invalidateQueries({ queryKey: ['compliance-plugins.assets-overview'] });
      } catch {
        /* tick again next interval */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scanAllProgress?.startedAtIso, qc]);

  const scanAllM = useMutation({
    mutationFn: () => compliancePluginsApi.scanAll(),
    onMutate: () => {
      const total = plugins.length || 424;
      setScanAllProgress({
        startedAtIso: new Date().toISOString(),
        completed: 0,
        total,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-plugins'] });
      qc.invalidateQueries({ queryKey: ['compliance-plugins.runs'] });
    },
    // Bad-state cleanup: the backend rejects scan-all with 403 (no
    // perm), 409 (a scan is already in flight), or 400 (no scan-eligible
    // plugin). Surface the message AND close the progress modal so the
    // user isn't stuck waiting on the idle-timeout (45s).
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { detail?: string } }; message?: string };
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || e?.message || 'Failed to start scan';
      setScanAllProgress(null);
      toast.toast({
        title: status === 409 ? 'Scan already running' : 'Scan failed to start',
        message: detail,
        type: status === 409 ? 'warning' : 'error',
      });
    },
    // NOTE: no onSettled cleanup. The modal lives independently of the
    // HTTP request lifecycle — the proxy can timeout at 2 min while the
    // backend continues for 7-10 min on a 424-rule scan. Polling closes
    // the modal when the scan actually finishes (done >= total or idle).
  });

  const executeM = useMutation({
    mutationFn: ({ pluginId, asset_id, connection_id }: { pluginId: number; asset_id?: number; connection_id?: number }) =>
      compliancePluginsApi.execute(pluginId, { asset_id, connection_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-plugins.runs'] });
      setTab('runs');
    },
  });

  const bulkReviewM = useMutation({
    mutationFn: ({ ids, decision }: { ids: number[]; decision: 'approve' | 'reject' }) =>
      compliancePluginsApi.reviewBulk(ids, decision),
    onSuccess: () => {
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ['compliance-plugins'] });
    },
  });

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const all = new Set(prev);
      const visibleIds = (pluginsQ.data?.plugins ?? []).map((p) => p.id);
      const allVisibleSelected = visibleIds.every((id) => all.has(id));
      if (allVisibleSelected) {
        visibleIds.forEach((id) => all.delete(id));
      } else {
        visibleIds.forEach((id) => all.add(id));
      }
      return all;
    });
  };

  const plugins = pluginsQ.data?.plugins ?? [];
  const benchmarks = benchmarksQ.data?.benchmarks ?? [];

  // Cywift-style aggregate KPIs computed from the current filter view.
  // When runScope === 'mine', the pass-rate KPI is derived from THIS user's
  // own runs (filtered by email match against runs feed) rather than from
  // the all-tenant aggregated stats stored on each plugin row.
  const kpi = useMemo(() => {
    // `Total Rules` reflects every rule that matches the *current filter*,
    // not the truncated page slice. Server returns the full count in
    // `total` even when it caps the rows it actually ships back; using
    // plugins.length here used to show "500" when the real number is 5,385
    // (or 548 for the Windows 11 benchmark filter).
    const total = pluginsQ.data?.total ?? plugins.length;
    const critical = plugins.filter((p) => p.severity === 'critical').length;
    const high = plugins.filter((p) => p.severity === 'high').length;
    const enabled = plugins.filter((p) => p.enabled).length;
    // ───────────────────────────────────────────────────────────────
    // Pass-rate semantics: "latest run per plugin" snapshot.
    //
    // Why: a single rule may have been scanned 5 times — once with broken
    // credentials (error), once with a buggy check_definition (false fail),
    // and three times with the current code (real pass/fail). Counting
    // ALL of those scans as separate datapoints dilutes the truth. The
    // operator wants to know "how many CIS controls are currently passing
    // on my machine right now", which is exactly "latest result per rule".
    // ───────────────────────────────────────────────────────────────
    // KPI Pass Rate is ALWAYS your personal pass rate — the "View"
    // toggle (All team / Mine) drives only the Teammates breakdown
    // panel below, not the top-line KPI card. This stops the confusing
    // "team" label that looked identical to "mine" whenever you were
    // the only scanner.
    let totalRuns = 0, passed = 0, failed = 0;
    const allRuns: Run[] = runsQ.data?.runs ?? [];
    const myEmail = (meQ.data?.email || '').toLowerCase();
    const myId = meQ.data?.id;
    const pool = allRuns.filter((r) => {
      if (myEmail && r.triggered_by_user?.email && r.triggered_by_user.email.toLowerCase() === myEmail) return true;
      if (myId != null && r.triggered_by_user_id === myId) return true;
      if (myId != null && r.triggered_by_user?.id === myId) return true;
      return false;
    });
    // Latest run per plugin_id (the runs feed is already sorted DESC by started_at,
    // so the first occurrence of a plugin_id is its newest run).
    const seen = new Set<number>();
    const latestPerPlugin: Run[] = [];
    for (const r of pool) {
      if (!seen.has(r.plugin_id)) {
        seen.add(r.plugin_id);
        latestPerPlugin.push(r);
      }
    }
    totalRuns = latestPerPlugin.length;
    passed = latestPerPlugin.filter((r) => r.status === 'passed').length;
    failed = latestPerPlugin.filter((r) => r.status === 'failed').length;
    // Denominator = total approved rules in the library (NOT the count of
    // rules scanned so far). This way the KPI reads "60 / 424 — 14%" and
    // stays comparable across users / over time, instead of moving with
    // however many rules each user has personally scanned.
    const passRateDenominator = total;  // total approved rules in current filter
    const passRate = passRateDenominator > 0 ? Math.round((passed / passRateDenominator) * 100) : null;

    // Pending review count for the new "Pending Review" KPI card
    // (replaces the old "Approved" card which always equalled Total
    // since the library only returns approved rules anyway).
    // The plugins[] list already filters approved-only server-side, so
    // we don't see pending rows in it. We expose total_pending separately
    // via the runs endpoint or a dedicated count — for now show the
    // delta between "all rules ingested" (visible in ingest jobs) and
    // the approved library. Approximate as 0 unless surfaced.
    const pendingTotal = (pluginsQ.data as { pending_total?: number } | undefined)?.pending_total ?? 0;
    return { total, critical, high, enabled, totalRuns, passed, failed, passRate, passRateDenominator, pendingTotal };
  }, [plugins, pluginsQ.data, runScope, runsQ.data, meQ.data]);
  const assets = useMemo<Array<{ id: number; name: string }>>(() => {
    const a = assetsQ.data;
    if (Array.isArray(a)) return a;
    return a?.assets ?? [];
  }, [assetsQ.data]);
  const connections = useMemo<Array<{ id: number; connection_name: string; integration_type: string; console_url?: string }>>(() => {
    const c = connectionsQ.data;
    const arr = Array.isArray(c) ? c : (c?.connections ?? []);
    return arr.filter((x) =>
      x.integration_type === 'aws_readonly' ||
      x.integration_type === 'linux_ssh' ||
      x.integration_type === 'windows_winrm',
    );
  }, [connectionsQ.data]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <ScanProgressModal
        open={scanAllProgress !== null}
        title="Scanning all assets"
        completed={scanAllProgress?.completed ?? 0}
        total={scanAllProgress?.total ?? 0}
        currentAssetName={scanAllProgress?.currentAsset ?? undefined}
        scope="tenant"
      />
      {scanAllConfirm && (
        <ScanAllConfirmModal
          ruleCount={plugins.length}
          hostList={connections.map((c) => c.console_url || c.connection_name || `conn#${c.id}`)}
          onCancel={() => setScanAllConfirm(false)}
          onConfirm={() => {
            setScanAllConfirm(false);
            scanAllM.mutate();
          }}
        />
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">CIS Benchmark Plugins</h1>
          <p className="text-sm text-gray-600 mt-1">
            Read-only compliance checks for AWS, Linux, and Windows hosts. Each run produces immutable evidence and cascades into your control scoring.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (!canScan) {
                toast.toast({
                  title: 'Permission required',
                  message: 'Only Scanning Admins / Administrators can trigger CIS scans. Ask your tenant admin for the "compliance:scan:execute" permission.',
                  type: 'warning',
                });
                return;
              }
              setScanAllConfirm(true);
            }}
            disabled={permsLoading || scanAllM.isPending || scanAllProgress !== null || connections.length === 0}
            title={
              !canScan && !permsLoading
                ? 'You don\'t have permission to run scans. Ask your tenant admin to grant the Scanning Admin role.'
                : connections.length === 0
                ? 'No connections yet. Open Admin → Connect Wizard (/admin/integrations/connect) to add the first one.'
                : 'Run every approved plugin against connected assets'
            }
            className={`px-3 py-2 text-sm rounded-md text-white disabled:opacity-50 disabled:cursor-not-allowed ${
              canScan ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'
            }`}
            data-testid="scan-all"
          >
            {canScan ? 'Scan All' : '🔒 Scan All'}
          </button>
        </div>
      </div>

      {/* Pre-integration empty state — shown when the tenant has 0
          eligible connections. The CIS rule library is already loaded
          (972 rules), but nothing can be executed against a host until
          at least one Windows/Linux/AWS connection exists. We keep the
          rule list visible below so the operator can BROWSE what they're
          about to enable, but block destructive actions and surface the
          Connect Wizard as the next step. */}
      {!connectionsQ.isLoading && connections.length === 0 && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-700 text-base font-semibold">
              !
            </span>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-amber-900">
              No assets connected yet
            </h3>
            <p className="text-sm text-amber-800 mt-1">
              Your CIS rule library is loaded and ready to run, but there is no host
              (Windows / Linux / AWS) connected to this tenant. Launch the Connect Wizard
              from <strong>Administration → Integrations</strong> to onboard your first
              asset; checks will start running automatically after the wizard finishes.
              Until then you can browse the {pluginsQ.data?.total ?? (Array.isArray(plugins) ? plugins.length : 0)}{' '}
              rules below in read-only mode.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="/admin/integrations/connect"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700"
              >
                Open Connect Wizard
              </a>
              <a
                href="/admin"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-white border border-amber-300 rounded-md hover:bg-amber-100"
              >
                Go to Administration
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Activity scope toggle — applies to KPI Pass Rate + Recent Runs */}
      <div className="flex items-center justify-end gap-2 mb-3">
        <span className="text-xs text-gray-500">View:</span>
        <div className="inline-flex items-center bg-white border border-gray-300 rounded-lg p-0.5"
             title="This toggle filters the Teammates panel below. The KPI cards always show your own data.">
          <button
            onClick={() => setRunScope('all')}
            className={`px-3 py-1 text-xs font-medium rounded ${runScope === 'all' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
            title="Show every teammate except you in the panel below"
          >
            👥 All team
          </button>
          <button
            onClick={() => setRunScope('mine')}
            className={`px-3 py-1 text-xs font-medium rounded ${runScope === 'mine' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
            title="Show only yourself in the panel below"
          >
            👤 Mine
          </button>
        </div>
      </div>

      {/* Cywift-style KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Rules</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{kpi.total}</div>
          <div className="text-xs text-gray-400 mt-1">in current filter</div>
        </div>
        <div className="bg-white border-l-4 border-l-red-500 border-y border-r border-gray-200 rounded-lg p-3 shadow-sm">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Critical</div>
          <div className="text-2xl font-semibold text-red-600 mt-1">{kpi.critical}</div>
          <div className="text-xs text-gray-400 mt-1">highest priority</div>
        </div>
        <div className="bg-white border-l-4 border-l-orange-500 border-y border-r border-gray-200 rounded-lg p-3 shadow-sm">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">High</div>
          <div className="text-2xl font-semibold text-orange-600 mt-1">{kpi.high}</div>
          <div className="text-xs text-gray-400 mt-1">important</div>
        </div>
        <div className="bg-white border-l-4 border-l-amber-500 border-y border-r border-gray-200 rounded-lg p-3 shadow-sm">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Pending Review</div>
          <div className="text-2xl font-semibold text-amber-600 mt-1">{kpi.pendingTotal}</div>
          <div className="text-xs text-gray-400 mt-1" title="Rules extracted from PDFs that are below the auto-approval confidence threshold and waiting for your review on the Import CIS PDF page.">
            {kpi.pendingTotal > 0 ? 'awaiting your review' : 'all caught up'}
          </div>
        </div>
        <div className="bg-white border-l-4 border-l-blue-500 border-y border-r border-gray-200 rounded-lg p-3 shadow-sm">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Your Pass Rate
          </div>
          <div className="text-2xl font-semibold text-blue-700 mt-1">
            {kpi.passRate !== null ? `${kpi.passRate}%` : '—'}
          </div>
          <div className="text-xs text-gray-400 mt-1" title="Numerator = distinct rules whose latest run-by-you passed. Denominator = total approved rules. The All-team / Mine toggle drives only the Teammates panel below; this card always reflects your own coverage.">
            {kpi.passRateDenominator > 0 ? `${kpi.passed} / ${kpi.passRateDenominator}` : 'no scans yet'}
          </div>
        </div>
      </div>

      {/* Per-user activity breakdown.
          Filter semantics:
            • Mine     → only your own row.
            • All team → everyone EXCEPT you (so the operator sees what
                         the rest of their team is doing — your own
                         numbers already drive the top-level Pass Rate
                         KPI when "Mine" is selected). */}
      {perUserQ.data && (() => {
        const yourEmail = (perUserQ.data.your_user_email || '').toLowerCase();
        const matchesYou = (row: typeof perUserQ.data.users[number]) => {
          const re = (row.user.email || '').toLowerCase();
          return (yourEmail && re && yourEmail === re) || row.user.id === perUserQ.data!.your_user_id;
        };
        const visibleRows = runScope === 'mine'
          ? perUserQ.data.users.filter(matchesYou)
          : perUserQ.data.users.filter((r) => !matchesYou(r));
        const scannedCount = visibleRows.filter((r) => r.scanned > 0).length;
        return (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {runScope === 'mine' ? 'Your activity' : 'Teammates'}
                </h3>
                <p className="text-xs text-gray-500">
                  {runScope === 'mine'
                    ? `Your coverage against the ${perUserQ.data.total_rules} approved rules. Latest result per rule.`
                    : `Coverage by everyone else in your tenant. ${perUserQ.data.total_rules} approved rules total.`}
                </p>
              </div>
              <div className="text-xs text-gray-400">
                {runScope === 'mine'
                  ? (visibleRows.length === 0 ? 'you are not in the tenant roster' : '')
                  : `${scannedCount} of ${visibleRows.length} scanned`}
              </div>
            </div>
            {visibleRows.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">
                {runScope === 'mine'
                  ? 'No activity recorded for you yet.'
                  : 'No other team members yet. When colleagues are added under Administration → Users they will appear here automatically.'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {visibleRows.map((row) => {
              const isYou = matchesYou(row);
              const initial = (row.user.display_name || row.user.username || '?').charAt(0).toUpperCase();
              const total = perUserQ.data!.total_rules || 0;
              const passBarPct = total > 0 ? (row.passed / total) * 100 : 0;
              const failBarPct = total > 0 ? (row.failed / total) * 100 : 0;
              return (
                <div key={row.user.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {row.user.display_name || row.user.username}
                      </span>
                      {isYou && <span className="text-[10px] uppercase tracking-wide text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">you</span>}
                      <span className="text-xs text-gray-500 truncate">{row.user.email}</span>
                    </div>
                    <div className="mt-1 flex h-2 rounded-full overflow-hidden bg-gray-100">
                      <div className="bg-green-500" style={{ width: `${passBarPct}%` }} title={`${row.passed} passed`} />
                      <div className="bg-red-400" style={{ width: `${failBarPct}%` }} title={`${row.failed} failed`} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <div className="text-sm font-semibold tabular-nums text-gray-900">
                      {row.passed} <span className="text-gray-400 font-normal">/</span> {total}
                    </div>
                    <div className="text-xs text-gray-500 tabular-nums">{row.pass_pct}% passing</div>
                  </div>
                </div>
              );
                })}
              </div>
            )}
          </div>
        );
      })()}

      <div className="flex gap-2 mb-4 border-b border-gray-200">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'library' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600'}`}
          onClick={() => setTab('library')}
          data-testid="tab-library"
        >
          Plugin Library ({pluginsQ.data?.total ?? plugins.length})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'assets' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600'}`}
          onClick={() => setTab('assets')}
          data-testid="tab-assets"
        >
          Assets
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'runs' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600'}`}
          onClick={() => setTab('runs')}
          data-testid="tab-runs"
        >
          Recent Runs
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'import' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600'} ${
            !canManageRules && !permsLoading ? 'opacity-60' : ''
          }`}
          onClick={() => {
            if (!canManageRules) {
              toast.toast({
                title: 'Permission required',
                message: 'Only Tenant Admins can import new CIS Benchmark PDFs. Ask your tenant admin.',
                type: 'warning',
              });
              return;
            }
            setTab('import');
          }}
          data-testid="tab-import"
          title={canManageRules ? 'Upload a CIS Benchmark PDF' : 'Tenant Admin only — Scanning Admins cannot import new benchmarks'}
        >
          {canManageRules || permsLoading ? '' : '🔒 '}Import CIS PDF
        </button>
        {showAdvanced && (
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'import-json' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600'}`}
            onClick={() => setTab('import-json')}
            data-testid="tab-import-json"
            title="Advanced: bulk-import custom plugin rules via JSON. Most customers don't need this."
          >
            Import JSON <span className="ml-1 text-xs text-gray-400">(adv)</span>
          </button>
        )}
      </div>

      {tab === 'import' && (
        <Suspense fallback={<p className="text-sm text-gray-500">Loading importer…</p>}>
          <CisIngestPage />
        </Suspense>
      )}

      {tab === 'assets' && (
        <Suspense fallback={<p className="text-sm text-gray-500">Loading assets…</p>}>
          <AssetsPanel />
        </Suspense>
      )}

      {tab === 'import-json' && (
        <JsonImportPanel
          onImported={() => {
            qc.invalidateQueries({ queryKey: ['compliance-plugins'] });
            qc.invalidateQueries({ queryKey: ['compliance-plugins.benchmarks'] });
          }}
        />
      )}

      {tab === 'library' && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-4">
              {/* Severity filter chips */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-1">Severity</span>
                {[
                  { v: '', l: 'All', color: 'bg-gray-100 text-gray-700 hover:bg-gray-200' },
                  { v: 'critical', l: 'Critical', color: 'bg-red-100 text-red-800 hover:bg-red-200' },
                  { v: 'high', l: 'High', color: 'bg-orange-100 text-orange-800 hover:bg-orange-200' },
                  { v: 'medium', l: 'Medium', color: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' },
                  { v: 'low', l: 'Low', color: 'bg-green-100 text-green-800 hover:bg-green-200' },
                ].map((c) => (
                  <button
                    key={c.v || 'all'}
                    onClick={() => setSeverity(c.v)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      severity === c.v ? `${c.color} ring-2 ring-offset-1 ring-current` : `${c.color} opacity-60`
                    }`}
                  >
                    {c.l}
                  </button>
                ))}
              </div>

              <div className="h-6 w-px bg-gray-200" />

              {/* Runner filter chips */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-1">Runner</span>
                {[
                  { v: '', l: 'All' },
                  { v: 'windows_winrm', l: 'Windows' },
                  { v: 'linux_ssh', l: 'Linux' },
                  { v: 'netdev_ssh', l: 'Cisco' },
                  { v: 'oracle_sql', l: 'Oracle' },
                  { v: 'aws_readonly', l: 'AWS' },
                ].map((c) => (
                  <button
                    key={c.v || 'all'}
                    onClick={() => setRunner(c.v)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      runner === c.v
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {c.l}
                  </button>
                ))}
              </div>

              {/* Benchmark dropdown — too many to chip */}
              <select
                className="ml-auto border border-gray-300 rounded-md px-2 py-1 text-xs bg-white"
                value={benchmark}
                onChange={(e) => setBenchmark(e.target.value)}
              >
                <option value="">All benchmarks ({benchmarks.reduce((s, b) => s + b.rule_count, 0)})</option>
                {benchmarks.map((b) => (
                  <option key={b.benchmark} value={b.benchmark}>
                    {b.benchmark.replace('CIS_Microsoft_Windows_', 'Win ').replace('_Benchmark_', ' ')} ({b.rule_count})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Bulk action bar + view toggle */}
          <div className="flex items-center justify-between mb-3">
            <div>
              {selectedIds.size > 0 ? (
                <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 text-sm">
                  <span className="font-medium text-blue-900">{selectedIds.size} selected</span>
                  <button
                    onClick={() => {
                      if (!canManageRules) {
                        toast.toast({
                          title: 'Permission required',
                          message: 'Only Tenant Admins can approve / disable CIS rules. Ask your tenant admin.',
                          type: 'warning',
                        });
                        return;
                      }
                      bulkReviewM.mutate({ ids: Array.from(selectedIds), decision: 'approve' });
                    }}
                    disabled={bulkReviewM.isPending || permsLoading}
                    className={`px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50 ${
                      canManageRules ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-400 text-white cursor-not-allowed'
                    }`}
                    title={canManageRules ? '' : 'Tenant Admin only — Scanning Admins cannot enable/disable rules'}
                  >
                    {canManageRules ? '' : '🔒 '}
                    {bulkReviewM.isPending ? 'Working…' : `Approve ${selectedIds.size}`}
                  </button>
                  <button
                    onClick={() => {
                      if (!canManageRules) {
                        toast.toast({
                          title: 'Permission required',
                          message: 'Only Tenant Admins can disable CIS rules. Ask your tenant admin.',
                          type: 'warning',
                        });
                        return;
                      }
                      bulkReviewM.mutate({ ids: Array.from(selectedIds), decision: 'reject' });
                    }}
                    disabled={bulkReviewM.isPending || permsLoading}
                    className={`px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50 ${
                      canManageRules ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-gray-400 text-white cursor-not-allowed'
                    }`}
                    title={canManageRules ? '' : 'Tenant Admin only — Scanning Admins cannot enable/disable rules'}
                  >
                    {canManageRules ? '' : '🔒 '}Disable {selectedIds.size}
                  </button>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="px-2.5 py-1 rounded text-xs text-gray-700 hover:bg-gray-100"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-500">Showing {plugins.length} plugin(s). Select rows to bulk-approve.</p>
              )}
            </div>
            <div className="inline-flex items-center bg-white border border-gray-300 rounded-md p-0.5">
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1 text-xs rounded ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Table
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1 text-xs rounded ${viewMode === 'cards' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Cards
              </button>
            </div>
          </div>

          {pluginsQ.isLoading ? (
            <p className="text-sm text-gray-500">Loading plugins…</p>
          ) : plugins.length === 0 ? (
            <div className="border border-dashed border-gray-300 rounded p-8 text-center">
              <p className="text-gray-700 mb-3">
                Your CIS rule library is empty.
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Upload a CIS Benchmark PDF (Windows 11, Server 2022, Linux,
                AWS, etc.) and the parser will extract every rule into your
                library automatically.
              </p>
              <button
                onClick={() => setTab('import')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Upload CIS PDF
              </button>
            </div>
          ) : viewMode === 'cards' ? (
            /* Phase 4.3 — Cywift-style card grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {plugins.slice(0, 60).map((p) => (
                <div
                  key={p.id}
                  className={`bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow ${SEV_STRIPE[p.severity] || 'border-l-4 border-l-gray-200'}`}
                >
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="mt-1"
                      />
                      <span className="font-mono text-xs text-gray-500">{p.rule_id}</span>
                      <span className={`ml-auto inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${SEV_COLORS[p.severity]}`}>
                        {p.severity}
                      </span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${RUNNER_COLORS[p.runner_type]}`}>
                        {RUNNER_SHORT[p.runner_type] || p.runner_type}
                      </span>
                    </div>
                    <Link
                      href={`/compliance-plugins#plugin-${p.id}`}
                      className="block text-sm font-medium text-gray-900 hover:text-blue-600 line-clamp-2 min-h-[2.5rem]"
                    >
                      {p.title}
                    </Link>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      {p.stats && p.stats.total > 0 ? (
                        (() => {
                          const lastStatus = p.stats.passed > 0 && p.stats.failed === 0 && p.stats.error === 0
                            ? 'passing' : (p.stats.failed > 0 ? 'failing' : 'error');
                          const styles = {
                            passing: 'bg-green-50 text-green-700 border-green-200',
                            failing: 'bg-red-50 text-red-700 border-red-200',
                            error:   'bg-gray-100 text-gray-600 border-gray-200',
                          }[lastStatus];
                          const label = lastStatus === 'passing' ? 'Passing'
                            : lastStatus === 'failing' ? 'Failing' : 'Needs review';
                          return (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium border ${styles}`}
                                  title={`${p.stats.passed} passed · ${p.stats.failed} failed · ${p.stats.error} error · ${p.stats.total} total runs`}>
                              {label}
                              <span className="ml-1 text-[10px] opacity-70">{p.stats.total}</span>
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-gray-400">never scanned</span>
                      )}
                      <div className="flex items-center gap-1">
                        {p.enabled ? (
                          <span className="text-green-700 text-xs">● approved</span>
                        ) : (
                          <span className="text-yellow-600 text-xs">● pending</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex gap-1">
                      <button
                        onClick={() => setSelected(p)}
                        className="flex-1 px-2 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
                      >
                        Scan
                      </button>
                      <Link
                        href={`/compliance-plugins#plugin-${p.id}`}
                        className="flex-1 px-2 py-1 text-xs font-medium rounded bg-gray-50 text-gray-700 hover:bg-gray-100 text-center"
                      >
                        Detail
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
              {plugins.length > 60 && (
                <div className="md:col-span-2 lg:col-span-3 text-center text-xs text-gray-500 py-3">
                  Showing first 60 of {plugins.length}. Use filters to narrow down.
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto border border-gray-200 rounded-md">
              {/* Constrain row heights + give each column an explicit
                  width so the long Benchmark string doesn't wrap into a
                  5-line tower and the Action column stays inside the
                  viewport. The wrapper above is overflow-x-auto so the
                  table can still scroll horizontally on narrow screens. */}
              <table className="min-w-full divide-y divide-gray-200 table-fixed">
                <colgroup>
                  <col style={{ width: '36px' }} />
                  <col style={{ width: '90px' }} />
                  <col />
                  <col style={{ width: '180px' }} />
                  <col style={{ width: '110px' }} />
                  <col style={{ width: '110px' }} />
                  <col style={{ width: '150px' }} />
                  <col style={{ width: '120px' }} />
                </colgroup>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={plugins.length > 0 && plugins.every((p) => selectedIds.has(p.id))}
                        onChange={toggleSelectAllVisible}
                      />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Rule</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Title</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Benchmark</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Runner</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Severity</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Runs</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {plugins.map((p) => (
                    <tr
                      key={p.id}
                      className={`hover:bg-gray-50 ${SEV_STRIPE[p.severity] || 'border-l-4 border-l-gray-200'} ${selectedIds.has(p.id) ? 'bg-blue-50/50' : ''}`}
                    >
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          data-testid={`select-${p.id}`}
                        />
                      </td>
                      <td className="px-3 py-2 text-sm font-mono text-gray-700">{p.rule_id}</td>
                      <td className="px-3 py-2 text-sm text-gray-900">
                        <Link
                          href={`/compliance-plugins#plugin-${p.id}`}
                          className="text-left hover:underline text-blue-600"
                          data-testid={`plugin-${p.id}`}
                        >
                          {p.title}
                        </Link>
                        {p.enabled && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                            approved
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 align-top" title={p.benchmark}>
                        <div className="truncate">
                          {p.benchmark.replace('CIS_Microsoft_Windows_', '').replace('_Benchmark_', ' ')}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${RUNNER_COLORS[p.runner_type] || 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                          {RUNNER_SHORT[p.runner_type] || p.runner_type}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${SEV_COLORS[p.severity] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                          {p.severity}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs" data-testid={`stats-${p.id}`}>
                        {p.stats && p.stats.total > 0 ? (
                          (() => {
                            const passRate = p.stats.total > 0 ? Math.round((p.stats.passed / p.stats.total) * 100) : 0;
                            const lastStatus = p.stats.passed > 0 && p.stats.failed === 0 && p.stats.error === 0
                              ? 'passing' : (p.stats.failed > 0 ? 'failing' : 'error');
                            const styles = {
                              passing: 'bg-green-50 text-green-700 border-green-200',
                              failing: 'bg-red-50 text-red-700 border-red-200',
                              error:   'bg-gray-100 text-gray-600 border-gray-200',
                            }[lastStatus];
                            const label = lastStatus === 'passing' ? 'Passing' :
                              lastStatus === 'failing' ? 'Failing' : 'Needs review';
                            return (
                              <div className="flex items-center gap-1.5" title={`${p.stats.passed} passed · ${p.stats.failed} failed · ${p.stats.error} error · ${p.stats.total} total runs`}>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium border ${styles}`}>
                                  {label}
                                </span>
                                <span className="text-gray-400 text-[10px] whitespace-nowrap">{p.stats.total} run{p.stats.total !== 1 ? 's' : ''}</span>
                              </div>
                            );
                          })()
                        ) : (
                          <span className="text-gray-400 text-xs">never scanned</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setSelected(p)}
                          className="text-sm text-blue-600 hover:underline"
                          data-testid={`run-${p.id}`}
                        >
                          Run check
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'runs' && (() => {
        const allRuns: Run[] = runsQ.data?.runs ?? [];
        // Match by email (stable across public-schema and tenant-schema user IDs).
        // Falls back to ID if email isn't available either side.
        const myEmail = (meQ.data?.email || '').toLowerCase();
        const myId = meQ.data?.id;
        const isMine = (r: Run) => {
          if (myEmail && r.triggered_by_user?.email && r.triggered_by_user.email.toLowerCase() === myEmail) return true;
          if (myId != null && r.triggered_by_user_id != null && r.triggered_by_user_id === myId) return true;
          if (myId != null && r.triggered_by_user?.id === myId) return true;
          return false;
        };
        // Filter semantics — same as the Teammates panel:
        //   Mine     → only runs you personally triggered
        //   All team → only runs OTHER teammates triggered (excludes you)
        // This makes the toggle do one consistent thing across the panel
        // AND the runs feed: "view yourself" vs "view your colleagues".
        const minRuns = allRuns.filter(isMine);
        const teamRuns = allRuns.filter((r) => !isMine(r));
        const visibleRuns = runScope === 'mine' ? minRuns : teamRuns;
        return (
        <div>
          <div className="text-xs text-gray-500 mb-2 px-1">
            {runScope === 'mine'
              ? `Showing ${minRuns.length} scan${minRuns.length === 1 ? '' : 's'} you personally triggered. Switch to "All team" above to see colleagues' runs.`
              : (teamRuns.length === 0
                  ? 'No teammates have triggered any scans yet. Your own runs are hidden in this view — switch to "Mine" to see them.'
                  : `Showing ${teamRuns.length} scan${teamRuns.length === 1 ? '' : 's'} triggered by your teammates (your own runs are hidden in this view).`)}
          </div>

        <div className="overflow-x-auto border border-gray-200 rounded-md">
          {runsQ.isLoading ? (
            <p className="p-6 text-sm text-gray-500">Loading runs…</p>
          ) : visibleRuns.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">
              {runScope === 'mine'
                ? 'You haven\'t triggered any scans yet. Pick a rule in the Plugin Library and click "Run check".'
                : 'No plugin runs yet. Execute a plugin from the Library tab.'}
            </p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">When</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Plugin</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Asset</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Triggered by</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Summary</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Evidence Hash</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {visibleRuns.map((r) => {
                  // Friendly summary — strip the technical regex/registry-path tail
                  // and keep the first plain-language sentence. Falls back to the
                  // raw summary when nothing pretty is extractable.
                  const rawSummary = r.result_summary || r.error_message || '';
                  let prettySummary = rawSummary;
                  // 1) Drop the trailing diagnostic tail in ANY of these forms:
                  //    "(regex 'X': False)" | "(contains 'X': True)"
                  //    "(line_kv_equals field=X expected=Y actual=Z)"
                  //    "(secedit field 'X' not found)"
                  //    "(Unknown expect kind: X)"
                  //    "(stdout_regex pattern 'X': False)"
                  // Repeatedly strip trailing diagnostic parentheticals until
                  // none remain (runner sometimes appends multiple).
                  for (let i = 0; i < 4; i++) {
                    const before = prettySummary;
                    prettySummary = prettySummary
                      // "(regex 'pattern': True|False)"
                      .replace(/\s*\(\s*regex\s+'[^']*'\s*:\s*(?:True|False)\s*\)\s*$/gi, '')
                      // "(contains 'X': True|False)"
                      .replace(/\s*\(\s*contains\s+'[^']*'\s*:\s*(?:True|False)\s*\)\s*$/gi, '')
                      // "(secedit field 'X' not found / matches Y)"
                      .replace(/\s*\(\s*secedit\s+field[^)]*\)\s*$/gi, '')
                      // "(line_kv_equals field=X expected=Y actual=Z)"
                      .replace(/\s*\(\s*line_kv[^)]*\)\s*$/gi, '')
                      // "(stdout_regex pattern 'X': False)"
                      .replace(/\s*\(\s*stdout_[a-z]+[^)]*\)\s*$/gi, '')
                      // "(Unknown expect kind: X)"
                      .replace(/\s*\(\s*Unknown expect[^)]*\)\s*$/gi, '')
                      // generic: any trailing "(...: True/False)"
                      .replace(/\s*\([^()]*:\s*(?:True|False)\s*\)\s*$/g, '')
                      .trim();
                    if (prettySummary === before) break;
                  }
                  // 2) If it still leads with "Registry HKLM:\\..." (older runs),
                  //    rewrite to a generic line.
                  if (/^Registry HKLM:/i.test(prettySummary)) {
                    if (r.status === 'passed') prettySummary = 'Setting is correctly configured.';
                    else prettySummary = 'Required policy is missing or set to the wrong value.';
                  }
                  // 3) Take only the first sentence.
                  let firstSentence = prettySummary.split(/(?<=[.!?])\s/)[0];
                  // 4) Special case: errors caused by REPLACE-ME placeholder
                  //    are NOT real errors — they're the safety tripwire firing
                  //    on un-reviewed rules. Re-label for the human reader.
                  const isPlaceholderTripwire =
                    r.status === 'error' &&
                    /Command rejected by Windows read-only safety filter/i.test(rawSummary);
                  if (isPlaceholderTripwire) {
                    firstSentence = 'Needs reviewer — auto-extraction couldn\'t produce a runnable check; please supply the PowerShell command.';
                  }
                  return (
                  <tr key={r.id} data-testid={`run-row-${r.id}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {r.started_at ? new Date(r.started_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-900 max-w-xs">
                      <div className="font-medium truncate" title={r.plugin_title || r.plugin_key || ''}>
                        {r.plugin_title || r.plugin_key}
                      </div>
                      {r.plugin_key && r.plugin_title && (
                        <div className="text-[10px] font-mono text-gray-400 truncate">{r.plugin_key.split('__').pop()}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">{r.asset_name || (r.asset_id ? `#${r.asset_id}` : '—')}</td>
                    <td className="px-3 py-2 text-xs">
                      <UserChip user={r.triggered_by_user} triggerType={r.triggered_by} currentUserId={meQ.data?.id} currentUserEmail={meQ.data?.email} />
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-700'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 max-w-md">
                      {expandedRuns.has(r.id) ? (
                        <div>
                          {/* Expanded view shows the CLEANED full summary
                              (no regex/contains/secedit-field tails) plus
                              the friendly tripwire label when applicable. */}
                          <div className="whitespace-pre-wrap text-gray-800">
                            {isPlaceholderTripwire ? firstSentence : prettySummary || '—'}
                          </div>
                          <button
                            onClick={() => setExpandedRuns((prev) => { const n = new Set(prev); n.delete(r.id); return n; })}
                            className="mt-1 text-blue-600 text-xs hover:underline"
                          >
                            Show less
                          </button>
                        </div>
                      ) : (
                        <div>
                          {/* Show full clean summary — no clipping. CIS sentences
                              are short (1-2 lines) so wrapping is fine. */}
                          <div className="text-gray-800 whitespace-normal break-words">
                            {prettySummary || '—'}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-500">
                      {r.evidence_hash ? (
                        <button
                          onClick={() => {
                            navigator.clipboard?.writeText(r.evidence_hash!);
                            setHashCopied(r.id);
                            setTimeout(() => setHashCopied((c) => (c === r.id ? null : c)), 1500);
                          }}
                          title={`${r.evidence_hash}\n\nSHA-256 fingerprint of the full scan evidence (raw stdout, command, expected, timestamp, asset, connection). Click to copy. Used for tamper-proof audit chain of custody (SOC 2 / ISO 27001 evidence integrity requirement).`}
                          className="text-gray-500 hover:text-blue-600 hover:underline cursor-pointer"
                        >
                          {hashCopied === r.id ? '✓ copied' : r.evidence_hash.slice(0, 12) + '…'}
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        </div>
        );
      })()}

      {selected && (
        <RunDialog
          plugin={selected}
          assets={assets}
          connections={connections}
          isExecuting={executeM.isPending}
          onClose={() => setSelected(null)}
          onExecute={(asset_id, connection_id) => {
            executeM.mutate(
              { pluginId: selected.id, asset_id, connection_id },
              { onSuccess: () => setSelected(null) },
            );
          }}
        />
      )}
    </div>
  );
}

const SAMPLE_JSON_TEMPLATE = JSON.stringify(
  {
    plugins: [
      {
        plugin_key: 'CUSTOM__org__example_rule_1',
        benchmark: 'CUSTOM_ORG_BASELINE_v1',
        rule_id: '1.1',
        title: 'Ensure example IAM read works',
        description: 'Sanity check — list IAM users.',
        rationale: 'Verifies AWS connectivity.',
        remediation: 'N/A.',
        severity: 'low',
        runner_type: 'aws_readonly',
        check_definition: {
          service: 'iam',
          operation: 'list_users',
          expect: { kind: 'list_nonempty', path: 'Users' },
          pass_message: 'IAM users enumerated.',
          fail_message: 'Could not list IAM users.',
        },
        source_url: 'https://example.com/baseline',
        control_mappings: [
          { framework_control_id: 1, weight: 1.0 },
        ],
      },
      {
        plugin_key: 'CUSTOM__org__example_rule_2',
        benchmark: 'CUSTOM_ORG_BASELINE_v1',
        rule_id: '2.1',
        title: 'Ensure /etc/hostname exists',
        severity: 'low',
        runner_type: 'linux_ssh',
        check_definition: {
          command: 'cat /etc/hostname',
          expect: { kind: 'stdout_regex', value: '.+' },
          pass_message: 'hostname file readable.',
          fail_message: 'hostname file missing.',
        },
      },
      {
        plugin_key: 'CUSTOM__org__example_rule_3',
        benchmark: 'CUSTOM_ORG_BASELINE_v1',
        rule_id: '3.1',
        title: 'Ensure Windows Defender real-time protection is on',
        severity: 'high',
        runner_type: 'windows_winrm',
        check_definition: {
          shell: 'powershell',
          command: 'Get-MpPreference | Format-List DisableRealtimeMonitoring',
          expect: {
            kind: 'line_kv_equals',
            field: 'DisableRealtimeMonitoring',
            expected: 'False',
          },
          pass_message: 'Real-time monitoring enabled.',
          fail_message: 'Real-time monitoring disabled.',
        },
      },
    ],
    auto_approve: false,
  },
  null,
  2,
);

type ImportResult = {
  inserted: { plugin_key: string; id: number }[];
  updated: { plugin_key: string; id: number }[];
  errors: { index: number; plugin_key?: string; error: string }[];
  summary: {
    received: number;
    inserted: number;
    updated: number;
    errors: number;
    auto_approved: boolean;
  };
};

// ─── UserChip — render avatar + name for a UserRef ─────────────────────────
// Used in the runs table "Triggered by" column. Falls back to the trigger
// type label (manual / scheduled / scan_all / workflow) if no user is
// attributed.
const _avatarPalette = [
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-green-100 text-green-700',
  'bg-amber-100 text-amber-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
  'bg-indigo-100 text-indigo-700',
];
function _colorFor(id: number) {
  return _avatarPalette[id % _avatarPalette.length];
}
function UserChip({ user, triggerType, currentUserId, currentUserEmail }: { user?: UserRef | null; triggerType?: string; currentUserId?: number; currentUserEmail?: string }) {
  if (!user) {
    // No user attribution — show the trigger type as a faded chip so the
    // operator can tell why ("scheduled" / "workflow" / "scan_all").
    const label = (triggerType || 'system')
      .replace(/_/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase());
    return (
      <span className="inline-flex items-center gap-1 text-gray-500">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium">
          ⚙
        </span>
        <span className="text-xs">{label}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`${user.name}${user.email ? ` · ${user.email}` : ''}\nTrigger: ${triggerType || 'manual'}`}
    >
      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold ${_colorFor(user.id)}`}>
        {user.initial}
      </span>
      <span className="text-xs text-gray-800 truncate max-w-[120px]">
        {user.name}{(
          (currentUserId != null && currentUserId === user.id) ||
          (currentUserEmail && user.email && currentUserEmail.toLowerCase() === user.email.toLowerCase())
        ) && <span className="text-blue-600 ml-0.5">(you)</span>}
      </span>
    </span>
  );
}

function JsonImportPanel({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState<string>(SAMPLE_JSON_TEMPLATE);
  const [autoApprove, setAutoApprove] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const importM = useMutation({
    mutationFn: async () => {
      setParseError(null);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON: ${(e as Error).message}`);
      }
      const plugins = Array.isArray(parsed)
        ? parsed
        : (parsed as { plugins?: unknown[] })?.plugins;
      if (!Array.isArray(plugins)) {
        throw new Error('JSON must be an array of plugin objects, or an object with a "plugins" array.');
      }
      const r = await compliancePluginsApi.importJson(plugins, autoApprove);
      return r.data as ImportResult;
    },
    onSuccess: (data) => {
      setResult(data);
      onImported();
    },
    onError: (e: Error) => {
      setParseError(e.message);
      setResult(null);
    },
  });

  const onFile = async (f: File | null) => {
    if (!f) return;
    const txt = await f.text();
    setText(txt);
    setParseError(null);
    setResult(null);
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-900">
        <p className="font-medium mb-1">Custom plugin JSON import</p>
        <p className="text-blue-800">
          Paste or upload a JSON file describing one or more plugin definitions. Imported plugins are
          tenant-scoped (visible only to your organisation) and land in the <strong>Pending Review</strong>
          queue unless you tick <em>Auto-approve</em>. AWS checks must use a read-only verb
          (<code>get_*, list_*, describe_*, head_*</code>); SSH commands are run through the same safety
          filter as the built-in catalog.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="text-sm"
            data-testid="json-file-input"
          />
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(e) => setAutoApprove(e.target.checked)}
            data-testid="auto-approve"
          />
          Auto-approve (skip review queue)
        </label>
        <button
          onClick={() => setText(SAMPLE_JSON_TEMPLATE)}
          className="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
          type="button"
        >
          Reset to sample
        </button>
        <button
          onClick={() => importM.mutate()}
          disabled={importM.isPending || !text.trim()}
          className="ml-auto px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          data-testid="json-import-submit"
        >
          {importM.isPending ? 'Importing…' : 'Import plugins'}
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full h-96 font-mono text-xs border border-gray-300 rounded p-3"
        spellCheck={false}
        data-testid="json-textarea"
      />

      {parseError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800" data-testid="json-error">
          {parseError}
        </div>
      )}

      {result && (
        <div className="border border-gray-200 rounded p-4 space-y-2 text-sm" data-testid="json-result">
          <p className="font-medium text-gray-900">
            Received {result.summary.received} · Inserted {result.summary.inserted} · Updated{' '}
            {result.summary.updated} · Errors {result.summary.errors}
            {result.summary.auto_approved ? ' · Auto-approved' : ' · Pending review'}
          </p>
          {(result.inserted.length > 0 || result.updated.length > 0) && (
            <div className="text-xs text-gray-700">
              {result.inserted.map((p) => (
                <div key={`i-${p.id}`}>✓ inserted <code>{p.plugin_key}</code> (id {p.id})</div>
              ))}
              {result.updated.map((p) => (
                <div key={`u-${p.id}`}>↻ updated <code>{p.plugin_key}</code> (id {p.id})</div>
              ))}
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="text-xs text-red-700">
              {result.errors.map((e, i) => (
                <div key={i}>✗ #{e.index} {e.plugin_key ? <code>{e.plugin_key}</code> : ''}: {e.error}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunDialog({
  plugin,
  assets,
  connections,
  isExecuting,
  onClose,
  onExecute,
}: {
  plugin: Plugin;
  assets: { id: number; name: string }[];
  connections: { id: number; connection_name: string; integration_type: string; console_url?: string }[];
  isExecuting: boolean;
  onClose: () => void;
  onExecute: (asset_id?: number, connection_id?: number) => void;
}) {
  const [assetId, setAssetId] = useState<string>('');
  const [connectionId, setConnectionId] = useState<string>('');
  const compatible = connections.filter((c) => c.integration_type === plugin.runner_type);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200 flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 font-mono">{plugin.plugin_key}</p>
            <h2 className="text-lg font-semibold text-gray-900 mt-0.5">{plugin.title}</h2>
            <p className="text-xs text-gray-500 mt-1">{plugin.benchmark} · {plugin.runner_type} · severity {plugin.severity}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          {plugin.description && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Description</p>
              <p className="text-gray-800">{plugin.description}</p>
            </div>
          )}
          {plugin.remediation && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Remediation</p>
              <p className="text-gray-800">{plugin.remediation}</p>
            </div>
          )}

          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-medium text-gray-500 uppercase mb-2">Execute against</p>

            <label className="block text-xs text-gray-700 mb-1">Connection ({plugin.runner_type} only)</label>
            <select
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm mb-3"
              data-testid="select-connection"
            >
              <option value="">— Select connection —</option>
              {compatible.map((c) => (
                <option key={c.id} value={c.id}>{c.connection_name} ({c.integration_type})</option>
              ))}
            </select>
            {compatible.length === 0 && (
              <p className="text-xs text-amber-700 mb-3">
                No <code>{plugin.runner_type}</code> connection found. Add one under Integrations → Connections to run live checks.
              </p>
            )}

            <label className="block text-xs text-gray-700 mb-1">Asset (optional — for control cascade)</label>
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              data-testid="select-asset"
            >
              <option value="">— None —</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => onExecute(assetId ? Number(assetId) : undefined, connectionId ? Number(connectionId) : undefined)}
            disabled={isExecuting}
            data-testid="btn-execute"
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
          >
            {isExecuting ? 'Running…' : 'Run check'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScanAllConfirmModal({
  ruleCount,
  hostList,
  onCancel,
  onConfirm,
}: {
  ruleCount: number;
  hostList: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Rough estimate: 0.5s per rule per host. WinRM/SSH connection setup
  // dominates for small N; per-rule cost dominates as N grows. Floor at 1m
  // so we don't show "0 mins" for trivially small runs.
  const totalChecks = ruleCount * Math.max(hostList.length, 1);
  const estMinutes = Math.max(1, Math.round((totalChecks * 0.5) / 60));
  const visibleHosts = hostList.slice(0, 4);
  const overflow = hostList.length - visibleHosts.length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-xl flex-shrink-0">
            ⚠
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900">Run scan on every connected host?</h2>
            <p className="text-sm text-gray-600 mt-1">
              This kicks off a live scan against the tenant's infrastructure.
              Make sure your IT / InfoSec team is OK with the load.
            </p>
          </div>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Approved rules</span>
            <span className="font-semibold text-gray-900">{ruleCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Target hosts</span>
            <span className="font-semibold text-gray-900">{hostList.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Total checks</span>
            <span className="font-semibold text-gray-900">{totalChecks.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Estimated time</span>
            <span className="font-semibold text-gray-900">~{estMinutes} min</span>
          </div>
        </div>

        {hostList.length > 0 && (
          <div className="text-xs text-gray-600 mb-4">
            <div className="font-medium text-gray-700 mb-1">Hosts in scope:</div>
            <ul className="list-disc list-inside space-y-0.5">
              {visibleHosts.map((h) => (
                <li key={h} className="font-mono text-[11px] truncate">{h}</li>
              ))}
              {overflow > 0 && <li className="text-gray-500 italic">+ {overflow} more</li>}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-gray-500 mb-4">
          Every run is recorded as immutable evidence and shows up in your tenant's audit trail.
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            Yes, scan {hostList.length} host{hostList.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
