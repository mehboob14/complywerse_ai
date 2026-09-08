'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrationsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Server,
  Plus,
  Loader2,
  CheckCircle,
  XCircle,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
  Clock,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
} from 'lucide-react';

interface Connection {
  id: number;
  connection_name: string;
  integration_type: string;
  console_url: string;
  console_port: number;
  auth_method: string;
  credential_env_prefix: string;
  username?: string | null;
  has_password?: boolean;
  sync_schedule: string;
  is_active: boolean;
  status: string;
  auto_link_assets?: boolean;
  // Push GRC decisions (false positives, exceptions) to the scanner via its
  // API. Default OFF — opt-in per connection because it modifies the scanner.
  scanner_writeback?: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_stats: Record<string, unknown> | null;
  consecutive_failures: number;
  created_at: string;
}

interface SyncHistoryRecord {
  id: number;
  sync_type: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  status: string;
  assets_new: number;
  assets_updated: number;
  vulns_new: number;
  vulns_updated: number;
  vulns_closed: number;
  vulns_reopened?: number;
  errors_count: number;
}

// last_sync_stats is one level of scalar counters plus optional nested stat
// groups (e.g. ai_mapping: {findings_sent, ...}). React can't render an object
// as a child, so flatten nested groups into "group · stat" tiles and stringify
// anything unexpected instead of crashing the page.
function flattenSyncStats(stats: Record<string, unknown>): Array<[string, string | number]> {
  return Object.entries(stats).flatMap(([key, val]): Array<[string, string | number]> => {
    if (val !== null && typeof val === 'object') {
      return Object.entries(val as Record<string, unknown>).map(([k, v]): [string, string | number] => [
        `${key} ${k}`,
        v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : (v as string | number),
      ]);
    }
    return [[key, val === null || val === undefined ? '—' : (val as string | number)]];
  });
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'connected'   ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    status === 'error'       ? 'bg-rose-50 text-rose-700 border-rose-200' :
    status === 'deactivated' ? 'bg-slate-100 text-slate-500 border-slate-200' :
    'bg-amber-50 text-amber-700 border-amber-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}

export default function ConnectionsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('integrations:connections:create');
  const canDelete = hasPermission('integrations:connections:delete');

  const [showCreate, setShowCreate] = useState(false);
  const [selectedType, setSelectedType] = useState('nexpose');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [detailConn, setDetailConn] = useState<Connection | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; success?: boolean; message?: string } | null>(null);
  const [syncResult, setSyncResult] = useState<{ id: number; data?: any } | null>(null);
  // The connection whose sync is running in the background. Sync now returns
  // immediately and does the work in a server-side worker (so a slow scan can't
  // trip the proxy gateway timeout and be mis-reported as "failed"); we poll the
  // connections list until this one's last_sync_at advances past the baseline we
  // captured when the sync started.
  const [syncingId, setSyncingId] = useState<number | null>(null);
  // How credentials are supplied: 'form' = paste the keys here (Production,
  // fully UI, stored encrypted); 'env' = read PREFIX_* from server env vars
  // (Dev / desk-test path — needs shell access to set them).
  const [credMode, setCredMode] = useState<'form' | 'env'>('form');
  const syncBaselineRef = useRef<Record<number, string | null>>({});

  const { data: connectionsData, isLoading, isError } = useQuery({
    queryKey: ['connections'],
    queryFn: () => integrationsApi.listConnections(),
    // While a background sync is in flight, refetch so we notice it landing.
    refetchInterval: syncingId != null ? 2500 : false,
  });
  const connections: Connection[] = connectionsData?.data?.connections || [];

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['sync-history', detailConn?.id],
    queryFn: () => integrationsApi.getSyncHistory(detailConn!.id, { limit: 20 }),
    enabled: !!detailConn,
  });
  const history: SyncHistoryRecord[] = historyData?.data?.records || [];

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => integrationsApi.createConnection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      setShowCreate(false);
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => integrationsApi.testConnection(id),
    onSuccess: (res, id) => setTestResult({ id, success: res.data.success, message: res.data.message }),
    onError: (_, id) => setTestResult({ id, success: false, message: 'Test failed' }),
  });

  const syncMutation = useMutation({
    mutationFn: (id: number) => integrationsApi.triggerSync(id),
    onMutate: (id: number) => {
      // Remember where last_sync_at stood, so completion detection knows a NEW
      // sync result (success OR failure) has landed once it advances.
      const c = connections.find((x) => x.id === id);
      syncBaselineRef.current[id] = c?.last_sync_at ?? null;
      setSyncResult(null);
    },
    onSuccess: (res, id) => {
      if (res.data?.status === 'running') {
        // Async path — the sync runs server-side; poll until it lands.
        setSyncingId(id);
      } else {
        // Synchronous fallback path returned the finished result directly.
        setSyncResult({ id, data: res.data });
        queryClient.invalidateQueries({ queryKey: ['connections'] });
      }
    },
    onError: (err: any, id) => {
      const detail = err?.response?.data?.detail;
      setSyncResult({ id, data: { status: 'failed', error: detail || 'Could not start sync' } });
    },
  });

  // Watch for a running background sync to finish: when the polled connection's
  // last_sync_at moves past the baseline captured at start, show the real result
  // (drawn from the backend's own recorded stats) and stop polling.
  useEffect(() => {
    if (syncingId == null) return;
    const c = connections.find((x) => x.id === syncingId);
    if (!c) return;
    const baseline = syncBaselineRef.current[syncingId] ?? null;
    if (c.last_sync_at && c.last_sync_at !== baseline) {
      setSyncResult({
        id: syncingId,
        data: {
          status: c.last_sync_status === 'success' ? 'completed' : 'failed',
          ...(c.last_sync_stats || {}),
        },
      });
      setSyncingId(null);
    }
  }, [connections, syncingId]);

  // Safety net: never poll forever. If a background sync hasn't reported back in
  // 5 minutes, stop and tell the operator to refresh rather than spinning.
  useEffect(() => {
    if (syncingId == null) return;
    const t = setTimeout(() => {
      setSyncResult({
        id: syncingId,
        data: { status: 'failed', error: 'Still running after 5 min — refresh to check the latest status.' },
      });
      setSyncingId(null);
    }, 5 * 60 * 1000);
    return () => clearTimeout(t);
  }, [syncingId]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => integrationsApi.deleteConnection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  });

  // Two-way sync toggle: push GRC decisions (false positives, exceptions)
  // back to the scanner. Persisted in the connection's provider_config.
  const writebackMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      integrationsApi.updateConnection(id, { scanner_writeback: enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  });

  // Hard delete — permanently removes the connection and frees its name. Findings
  // already synced are preserved server-side; only the connection + its logs go.
  const purgeMutation = useMutation({
    mutationFn: (id: number) => integrationsApi.deleteConnection(id, true),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  });

  const toggleExpand = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const integrationType = (form.get('integration_type') as string) || 'nexpose';
    createMutation.mutate({
      connection_name: form.get('connection_name') as string,
      integration_type: integrationType,
      console_url: form.get('console_url') as string,
      console_port: parseInt(form.get('console_port') as string) || (integrationType === 'nessus' ? 8834 : 3780),
      credential_env_prefix: (form.get('credential_env_prefix') as string) || undefined,
      access_key: (form.get('access_key') as string) || undefined,
      secret_key: (form.get('secret_key') as string) || undefined,
      api_key: (form.get('api_key') as string) || undefined,
      username: (form.get('username') as string) || undefined,
      password: (form.get('password') as string) || undefined,
      sync_schedule: (form.get('sync_schedule') as string) || '0 */4 * * *',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <XCircle size={32} className="text-rose-400 mb-2" strokeWidth={1.75} />
        <p className="text-sm">Failed to load connections. Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">

      {/* Action bar */}
      <div className="flex justify-end">
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0a0a0a] bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus size={16} /> Add Connection
          </button>
        )}
      </div>

      {/* Add Connection slide-over */}
      {showCreate && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowCreate(false)} />
      )}
      <div className={`fixed inset-y-0 right-0 z-50 flex w-[520px] flex-col bg-white shadow-2xl transform transition-transform duration-300 ${showCreate ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
          <h2 className="text-lg font-semibold text-slate-900">Add Connection</h2>
          <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleCreate} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Scanner Type</label>
              <select
                name="integration_type"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="nexpose">Rapid7 Nexpose / InsightVM</option>
                <option value="nessus">Tenable Nessus</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Connection Name</label>
              <input
                name="connection_name"
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={selectedType === 'nessus' ? 'Production Nessus' : 'Production Nexpose'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Console URL</label>
              <input
                name="console_url"
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={selectedType === 'nessus' ? 'https://nessus.company.com' : 'https://nexpose.company.com'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Console Port</label>
              <input
                name="console_port"
                type="number"
                defaultValue={selectedType === 'nessus' ? 8834 : 3780}
                key={selectedType}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Credentials</label>
              {/* Toggle: paste the keys here (Production) vs read them from
                  server env vars (Dev / desk-test). */}
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 mb-2">
                <button
                  type="button"
                  onClick={() => setCredMode('form')}
                  className={'px-3 py-1 text-xs font-semibold rounded-md ' + (credMode === 'form' ? 'bg-primary-600 text-[#0a0a0a]' : 'text-slate-500')}
                >
                  Enter keys (Production)
                </button>
                <button
                  type="button"
                  onClick={() => setCredMode('env')}
                  className={'px-3 py-1 text-xs font-semibold rounded-md ' + (credMode === 'env' ? 'bg-slate-700 text-white' : 'text-slate-500')}
                >
                  Env vars (Dev)
                </button>
              </div>

              {credMode === 'form' ? (
                <div className="space-y-2">
                  <input
                    name="access_key"
                    required
                    type="password"
                    autoComplete="off"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Access Key"
                  />
                  <input
                    name="secret_key"
                    required
                    type="password"
                    autoComplete="off"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Secret Key"
                  />
                  <p className="text-xs text-slate-400">
                    Pasted here and stored <b>encrypted</b> — no server access needed. For Tenable.io: Console URL <span className="font-mono">https://cloud.tenable.com</span>, keys from Settings → My Account → API Keys.
                  </p>
                </div>
              ) : (
                <div>
                  <input
                    name="credential_env_prefix"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder={selectedType === 'nessus' ? 'NESSUS_PROD' : 'NEXPOSE_PROD'}
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Dev only — reads <span className="font-mono">PREFIX_ACCESS_KEY</span> / <span className="font-mono">PREFIX_SECRET_KEY</span> from server env vars (needs shell access).
                  </p>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Username (optional)</label>
              <input
                name="username"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={selectedType === 'nessus' ? 'nessus-user' : 'scanner-user'}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password (optional)</label>
              <input
                name="password"
                type="password"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Enter scanner password"
                autoComplete="new-password"
              />
              <p className="text-xs text-slate-400 mt-1">Use this when API keys are unavailable or restricted.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Sync Schedule (cron)</label>
              <input
                name="sync_schedule"
                defaultValue="0 */4 * * *"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            {createMutation.isError && (
              <p className="text-sm text-rose-600">Failed to create connection. Check if name is unique.</p>
            )}
          </div>
          <div className="flex-shrink-0 flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="inline-flex items-center gap-2 px-6 py-2 text-sm font-medium text-[#0a0a0a] bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {createMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add Connection
            </button>
          </div>
        </form>
      </div>

      {/* Detail panel slide-over */}
      {detailConn && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setDetailConn(null)} />
      )}
      <div className={`fixed inset-y-0 right-0 z-50 flex w-[480px] flex-col bg-white shadow-2xl transform transition-transform duration-300 ${detailConn ? 'translate-x-0' : 'translate-x-full'}`}>
        {detailConn && (
          <>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                {detailConn.is_active
                  ? <Wifi size={18} className="text-primary-600" />
                  : <WifiOff size={18} className="text-slate-400" />}
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{detailConn.connection_name}</h2>
                  <StatusBadge status={detailConn.status} />
                </div>
              </div>
              <button onClick={() => setDetailConn(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Config */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Configuration</h3>
                <dl className="space-y-2">
                  {([
                    ['Scanner Type', detailConn.integration_type === 'nessus' ? 'Tenable Nessus' : 'Rapid7 Nexpose'],
                    ['Console URL', `${detailConn.console_url}:${detailConn.console_port}`],
                    ['Credential Prefix', detailConn.credential_env_prefix],
                    ['Auth Method', detailConn.auth_method || '—'],
                    ['Username', detailConn.username || '—'],
                    ['Sync Schedule', detailConn.sync_schedule],
                    ['Created', new Date(detailConn.created_at).toLocaleString()],
                    ['Consecutive Failures', String(detailConn.consecutive_failures || 0)],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 text-sm">
                      <dt className="text-slate-500 shrink-0 w-36">{k}</dt>
                      <dd className="text-slate-900 font-medium text-right break-all">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Last sync stats */}
              {detailConn.last_sync_stats && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Last Sync Stats</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {flattenSyncStats(detailConn.last_sync_stats).map(([key, val]) => (
                      <div key={key} className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-center">
                        <div className="text-base font-bold text-slate-800">{val}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{key.replace(/_/g, ' ')}</div>
                      </div>
                    ))}
                  </div>
                  {detailConn.last_sync_at && (
                    <p className="text-xs text-slate-400 mt-2">
                      Last synced {new Date(detailConn.last_sync_at).toLocaleString()} ·{' '}
                      <span className={detailConn.last_sync_status === 'success' ? 'text-emerald-600' : 'text-rose-500'}>
                        {detailConn.last_sync_status}
                      </span>
                    </p>
                  )}
                </div>
              )}

              {/* Sync History */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Sync History</h3>
                {historyLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 size={20} className="animate-spin text-slate-400" />
                  </div>
                ) : history.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-500">
                          <th className="text-left py-2 font-medium">Type</th>
                          <th className="text-left py-2 font-medium">Started</th>
                          <th className="text-left py-2 font-medium">Dur</th>
                          <th className="text-center py-2 font-medium">Status</th>
                          <th className="text-right py-2 font-medium">New</th>
                          <th className="text-right py-2 font-medium">Upd</th>
                          <th className="text-right py-2 font-medium">Err</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h) => (
                          <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50">
                            <td className="py-2 capitalize">{h.sync_type}</td>
                            <td className="py-2 text-slate-500">{new Date(h.started_at).toLocaleString()}</td>
                            <td className="py-2 text-slate-500">{h.duration_ms ? `${(h.duration_ms / 1000).toFixed(1)}s` : '—'}</td>
                            <td className="py-2 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${h.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                {h.status}
                              </span>
                            </td>
                            <td className="py-2 text-right text-emerald-600">+{h.assets_new + h.vulns_new}</td>
                            <td className="py-2 text-right text-slate-600">{h.assets_updated + h.vulns_updated}</td>
                            <td className="py-2 text-right text-rose-600">{h.errors_count || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No sync history yet.</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Connection rows */}
      <div className="space-y-2">
        {connections.map((conn) => {
          const isExpanded = expandedIds.has(conn.id);
          return (
            <div key={conn.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">

              {/* Collapsed row header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-shrink-0">
                  {conn.is_active
                    ? <Wifi size={18} className="text-primary-600" />
                    : <WifiOff size={18} className="text-slate-400" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 text-sm">{conn.connection_name}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                      conn.integration_type === 'nessus' ? 'bg-primary-50 text-primary-700' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {conn.integration_type === 'nessus' ? 'Tenable Nessus' : 'Rapid7 Nexpose'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{conn.console_url}:{conn.console_port}</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <StatusBadge status={conn.status} />

                  <button
                    onClick={() => toggleExpand(conn.id)}
                    className="flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                    title={isExpanded ? 'Collapse' : 'Expand actions & stats'}
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  <button
                    onClick={() => setDetailConn(conn)}
                    className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-primary-50 hover:text-primary-600 transition-colors"
                    title="View connection details"
                  >
                    <ChevronLeft size={14} />
                  </button>
                </div>
              </div>

              {/* Expanded section */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-4 py-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => testMutation.mutate(conn.id)}
                      disabled={testMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100"
                    >
                      {testMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                      Test
                    </button>
                    <button
                      onClick={() => syncMutation.mutate(conn.id)}
                      disabled={syncMutation.isPending || syncingId != null || !conn.is_active}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
                    >
                      {(syncingId === conn.id || (syncMutation.isPending && syncMutation.variables === conn.id))
                        ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      {syncingId === conn.id ? 'Syncing…' : 'Sync Now'}
                    </button>
                    <button
                      onClick={() => setDetailConn(conn)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100"
                    >
                      <Clock size={13} /> History
                    </button>
                    {canDelete && (
                      <>
                        <button
                          onClick={() => {
                            if (confirm('Deactivate this connection? It stops syncing but is kept and can be re-activated later. Data is preserved.')) {
                              deleteMutation.mutate(conn.id);
                            }
                          }}
                          disabled={!conn.is_active}
                          title="Pause syncing (reversible)"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50"
                        >
                          <WifiOff size={13} /> Deactivate
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Permanently DELETE "${conn.connection_name}"? This removes the connection and frees its name. Findings already synced are kept. This cannot be undone.`)) {
                              purgeMutation.mutate(conn.id);
                            }
                          }}
                          disabled={purgeMutation.isPending}
                          title="Permanently remove this connection"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 disabled:opacity-50"
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </>
                    )}

                    {conn.last_sync_at && (
                      <span className="text-xs text-slate-400 ml-auto">
                        Last sync: {new Date(conn.last_sync_at).toLocaleString()} ·{' '}
                        {conn.last_sync_status === 'success'
                          ? <span className="text-emerald-600">success</span>
                          : <span className="text-rose-500">{conn.last_sync_status}</span>}
                      </span>
                    )}
                  </div>

                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!conn.scanner_writeback}
                      disabled={writebackMutation.isPending}
                      onChange={(e) => writebackMutation.mutate({ id: conn.id, enabled: e.target.checked })}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-xs leading-relaxed">
                      <span className="font-medium text-slate-800">Push decisions to scanner (two-way sync)</span>
                      <span className="block text-slate-500 mt-0.5">
                        When a finding is marked false positive or granted an exception in ComplyVerse, mirror that
                        decision in the scanner (e.g. a host-scoped Nessus plugin rule). Actions the scanner&apos;s API
                        can&apos;t represent are recorded as skipped with the reason. Auto-close on verified re-scan is
                        always on and doesn&apos;t modify the scanner.
                      </span>
                    </span>
                  </label>

                  {testResult?.id === conn.id && (
                    <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {testResult.success ? <CheckCircle size={15} /> : <XCircle size={15} />}
                      {testResult.message}
                    </div>
                  )}

                  {syncingId === conn.id && (
                    <div className="flex items-center gap-2 p-3 rounded-lg text-sm bg-blue-50 text-blue-700">
                      <Loader2 size={15} className="animate-spin" />
                      Syncing in the background — pulling findings from the scanner. This can take a minute; the page updates automatically when it&apos;s done.
                    </div>
                  )}

                  {syncResult?.id === conn.id && syncingId !== conn.id && (
                    <div className={`p-3 rounded-lg text-sm ${syncResult.data?.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {syncResult.data?.status === 'completed' ? (
                        <>Sync complete · Assets: +{syncResult.data?.assets_new || 0} new, {syncResult.data?.assets_updated || 0} updated · Vulns: +{syncResult.data?.vulns_new || 0} new, {syncResult.data?.vulns_updated || 0} updated, {syncResult.data?.vulns_closed || 0} closed
                        {syncResult.data?.vulns_reopened > 0 ? `, ${syncResult.data.vulns_reopened} reopened` : ''}
                        {syncResult.data?.errors_count > 0 ? ` · ${syncResult.data.errors_count} errors` : ''}</>
                      ) : (
                        <>Sync failed{syncResult.data?.error ? ` · ${syncResult.data.error}` : ''}</>
                      )}
                    </div>
                  )}

                  {conn.last_sync_stats && (
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {flattenSyncStats(conn.last_sync_stats).map(([key, val]) => (
                        <div key={key} className="text-center p-2 bg-slate-50 rounded-lg border border-slate-100">
                          <div className="text-sm font-bold text-slate-800">{val}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{key.replace(/_/g, ' ')}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {connections.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <Server size={40} className="text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-700 mb-1">No Connections</h3>
            <p className="text-sm text-slate-500 mb-4">Add a vulnerability scanner connection to start syncing data</p>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0a0a0a] bg-primary-600 rounded-lg hover:bg-primary-700"
            >
              <Plus size={16} /> Add Connection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
