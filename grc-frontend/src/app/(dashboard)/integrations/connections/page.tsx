'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrationsApi } from '@/lib/api';
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
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_stats: Record<string, number> | null;
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
  errors_count: number;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'connected'   ? 'bg-green-50 text-green-700 border-green-200' :
    status === 'error'       ? 'bg-red-50 text-red-700 border-red-200' :
    status === 'deactivated' ? 'bg-slate-100 text-slate-500 border-slate-200' :
    'bg-yellow-50 text-yellow-700 border-yellow-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}

export default function ConnectionsPage() {
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [selectedType, setSelectedType] = useState('nexpose');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [detailConn, setDetailConn] = useState<Connection | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; success?: boolean; message?: string } | null>(null);
  const [syncResult, setSyncResult] = useState<{ id: number; data?: any } | null>(null);

  const { data: connectionsData, isLoading, isError } = useQuery({
    queryKey: ['connections'],
    queryFn: () => integrationsApi.listConnections(),
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
    onSuccess: (res, id) => {
      setSyncResult({ id, data: res.data });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: (_, id) => setSyncResult({ id, data: { status: 'failed', error: 'Sync failed' } }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => integrationsApi.deleteConnection(id),
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
      credential_env_prefix: form.get('credential_env_prefix') as string,
      username: (form.get('username') as string) || undefined,
      password: (form.get('password') as string) || undefined,
      sync_schedule: (form.get('sync_schedule') as string) || '0 */4 * * *',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <XCircle size={32} className="text-red-400 mb-2" />
        <p className="text-sm">Failed to load connections. Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">

      {/* Action bar */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> Add Connection
        </button>
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
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={selectedType === 'nessus' ? 'Production Nessus' : 'Production Nexpose'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Console URL</label>
              <input
                name="console_url"
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Credential Env Prefix</label>
              <input
                name="credential_env_prefix"
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={selectedType === 'nessus' ? 'NESSUS_PROD' : 'NEXPOSE_PROD'}
              />
              <p className="text-xs text-slate-400 mt-1">
                {selectedType === 'nessus'
                  ? 'System will read PREFIX_ACCESS_KEY, PREFIX_SECRET_KEY from env vars'
                  : 'System will read PREFIX_USERNAME, PREFIX_PASSWORD, PREFIX_API_KEY from env vars'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Username (optional)</label>
              <input
                name="username"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={selectedType === 'nessus' ? 'nessus-user' : 'scanner-user'}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password (optional)</label>
              <input
                name="password"
                type="password"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {createMutation.isError && (
              <p className="text-sm text-red-600">Failed to create connection. Check if name is unique.</p>
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
              className="inline-flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
                  ? <Wifi size={18} className="text-blue-600" />
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
                    {Object.entries(detailConn.last_sync_stats).map(([key, val]) => (
                      <div key={key} className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-center">
                        <div className="text-base font-bold text-slate-800">{val}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{key.replace(/_/g, ' ')}</div>
                      </div>
                    ))}
                  </div>
                  {detailConn.last_sync_at && (
                    <p className="text-xs text-slate-400 mt-2">
                      Last synced {new Date(detailConn.last_sync_at).toLocaleString()} ·{' '}
                      <span className={detailConn.last_sync_status === 'success' ? 'text-green-600' : 'text-red-500'}>
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
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${h.status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                {h.status}
                              </span>
                            </td>
                            <td className="py-2 text-right text-green-600">+{h.assets_new + h.vulns_new}</td>
                            <td className="py-2 text-right text-blue-600">{h.assets_updated + h.vulns_updated}</td>
                            <td className="py-2 text-right text-red-600">{h.errors_count || 0}</td>
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
                    ? <Wifi size={18} className="text-blue-600" />
                    : <WifiOff size={18} className="text-slate-400" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 text-sm">{conn.connection_name}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                      conn.integration_type === 'nessus' ? 'bg-teal-50 text-teal-700' : 'bg-indigo-50 text-indigo-700'
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
                    className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors"
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
                      disabled={syncMutation.isPending || !conn.is_active}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {syncMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      Sync Now
                    </button>
                    <button
                      onClick={() => setDetailConn(conn)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100"
                    >
                      <Clock size={13} /> History
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Deactivate this connection? Data will be preserved.')) {
                          deleteMutation.mutate(conn.id);
                        }
                      }}
                      disabled={!conn.is_active}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
                    >
                      <Trash2 size={13} /> Deactivate
                    </button>

                    {conn.last_sync_at && (
                      <span className="text-xs text-slate-400 ml-auto">
                        Last sync: {new Date(conn.last_sync_at).toLocaleString()} ·{' '}
                        {conn.last_sync_status === 'success'
                          ? <span className="text-green-600">success</span>
                          : <span className="text-red-500">{conn.last_sync_status}</span>}
                      </span>
                    )}
                  </div>

                  {testResult?.id === conn.id && (
                    <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {testResult.success ? <CheckCircle size={15} /> : <XCircle size={15} />}
                      {testResult.message}
                    </div>
                  )}

                  {syncResult?.id === conn.id && (
                    <div className={`p-3 rounded-lg text-sm ${syncResult.data?.status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
                      Sync {syncResult.data?.status} · Assets: +{syncResult.data?.assets_new || 0} new, {syncResult.data?.assets_updated || 0} updated · Vulns: +{syncResult.data?.vulns_new || 0} new, {syncResult.data?.vulns_updated || 0} updated, {syncResult.data?.vulns_closed || 0} closed
                      {syncResult.data?.errors_count > 0 && ` · ${syncResult.data.errors_count} errors`}
                    </div>
                  )}

                  {conn.last_sync_stats && (
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {Object.entries(conn.last_sync_stats).map(([key, val]) => (
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
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              <Plus size={16} /> Add Connection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
