'use client';

import { useState } from 'react';
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

const TYPE_LABEL: Record<string, string> = {
  nexpose: 'Rapid7 Nexpose',
  nessus: 'Tenable Nessus',
  linux_ssh: 'Linux SSH',
  windows_winrm: 'Windows WinRM',
  aws_readonly: 'AWS read-only',
};
const TYPE_BADGE: Record<string, string> = {
  nexpose: 'bg-indigo-50 text-indigo-700',
  nessus: 'bg-teal-50 text-teal-700',
  linux_ssh: 'bg-emerald-50 text-emerald-700',
  windows_winrm: 'bg-sky-50 text-sky-700',
  aws_readonly: 'bg-amber-50 text-amber-700',
};
const labelFor = (t: string) => TYPE_LABEL[t] ?? t;
const badgeFor = (t: string) => TYPE_BADGE[t] ?? 'bg-slate-100 text-slate-700';

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
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('integrations:connections:create');
  const canDelete = hasPermission('integrations:connections:delete');

  const [showCreate, setShowCreate] = useState(false);
  const [selectedType, setSelectedType] = useState('nexpose');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [detailConn, setDetailConn] = useState<Connection | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; success?: boolean; message?: string; code?: string; identity?: string } | null>(null);
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
    onSuccess: (res, id) => setTestResult({
      id,
      success: res.data.success,
      message: res.data.message,
      code: res.data.code,
      identity: res.data.identity,
    }),
    onError: (err: any, id) => setTestResult({
      id,
      success: false,
      message: err?.response?.data?.detail || err?.message || 'Test failed',
    }),
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

  const TYPE_DEFAULTS: Record<
    string,
    {
      label: string;
      port: number;
      placeholderHost: string;
      placeholderPrefix: string;
      envHint: string;
      needsConsole: boolean;
    }
  > = {
    nexpose: {
      label: 'Rapid7 Nexpose / InsightVM',
      port: 3780,
      placeholderHost: 'https://nexpose.company.com',
      placeholderPrefix: 'NEXPOSE_PROD',
      envHint: 'System will read PREFIX_USERNAME, PREFIX_PASSWORD, PREFIX_API_KEY from env vars.',
      needsConsole: true,
    },
    nessus: {
      label: 'Tenable Nessus',
      port: 8834,
      placeholderHost: 'https://nessus.company.com',
      placeholderPrefix: 'NESSUS_PROD',
      envHint: 'System will read PREFIX_ACCESS_KEY, PREFIX_SECRET_KEY from env vars.',
      needsConsole: true,
    },
    linux_ssh: {
      label: 'Linux SSH (compliance plugins)',
      port: 22,
      placeholderHost: '10.0.0.42',
      placeholderPrefix: 'LINUX_PROD',
      envHint:
        'System reads PREFIX_SSH_USERNAME and either PREFIX_SSH_PASSWORD or PREFIX_SSH_PRIVATE_KEY (PEM).',
      needsConsole: true,
    },
    windows_winrm: {
      label: 'Windows WinRM (compliance plugins)',
      port: 5986,
      placeholderHost: 'https://win-srv.company.com',
      placeholderPrefix: 'WIN_PROD',
      envHint:
        'System reads PREFIX_WINRM_USERNAME and PREFIX_WINRM_PASSWORD. Optional: PREFIX_WINRM_TRANSPORT (ntlm/kerberos/credssp), PREFIX_WINRM_ENDPOINT (full URL override).',
      needsConsole: true,
    },
    aws_readonly: {
      label: 'AWS read-only (compliance plugins)',
      port: 0,
      placeholderHost: 'us-east-1',
      placeholderPrefix: 'AWS_PROD',
      envHint:
        'System reads PREFIX_AWS_ACCESS_KEY_ID, PREFIX_AWS_SECRET_ACCESS_KEY (and optional PREFIX_AWS_SESSION_TOKEN). Console URL field holds the AWS region.',
      needsConsole: true,
    },
  };

  const typeMeta = TYPE_DEFAULTS[selectedType] ?? TYPE_DEFAULTS.nexpose;

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const integrationType = (form.get('integration_type') as string) || 'nexpose';
    const meta = TYPE_DEFAULTS[integrationType] ?? TYPE_DEFAULTS.nexpose;
    // Trim every string before posting — Tab-navigation between fields
    // and paste-from-cell are common sources of trailing whitespace that
    // breaks NTLM / SSH auth with a confusing "credentials wrong" error
    // even when the visible value looks correct.
    const trim = (k: string) => ((form.get(k) as string) || '').trim();
    createMutation.mutate({
      connection_name: trim('connection_name'),
      integration_type: integrationType,
      console_url: trim('console_url'),
      console_port: parseInt(form.get('console_port') as string) || meta.port,
      credential_env_prefix: trim('credential_env_prefix'),
      username: trim('username') || undefined,
      password: trim('password') || undefined,
      sync_schedule: trim('sync_schedule') || '0 */4 * * *',
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
      <div className="flex justify-end gap-2">
        {canCreate && (
          <>
            <a
              href="/admin/integrations/connect"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
              title="Guided Connect Wizard — recommended for first-time setup"
            >
              <Wifi size={16} /> Connect Wizard
            </a>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} /> Add Connection
            </button>
          </>
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
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <optgroup label="Vulnerability scanners">
                  <option value="nexpose">Rapid7 Nexpose / InsightVM</option>
                  <option value="nessus">Tenable Nessus</option>
                </optgroup>
                <optgroup label="Compliance plugin runners">
                  <option value="linux_ssh">Linux SSH</option>
                  <option value="windows_winrm">Windows WinRM</option>
                  <option value="aws_readonly">AWS read-only</option>
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Connection Name</label>
              <input
                name="connection_name"
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={`Production ${typeMeta.label}`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {selectedType === 'aws_readonly' ? 'AWS Region' : 'Console URL / Host'}
              </label>
              <input
                name="console_url"
                required
                key={`url-${selectedType}`}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={typeMeta.placeholderHost}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {selectedType === 'aws_readonly' ? 'Port (unused for AWS)' : 'Console Port'}
              </label>
              <input
                name="console_port"
                type="number"
                defaultValue={typeMeta.port}
                key={`port-${selectedType}`}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Credential Env Prefix</label>
              <input
                name="credential_env_prefix"
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={typeMeta.placeholderPrefix}
              />
              <p className="text-xs text-slate-400 mt-1">{typeMeta.envHint}</p>
            </div>
            {selectedType !== 'aws_readonly' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Username (optional, overrides env var)
                  </label>
                  <input
                    name="username"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={
                      selectedType === 'windows_winrm'
                        ? 'DOMAIN\\svc-grc'
                        : selectedType === 'linux_ssh'
                        ? 'grc-readonly'
                        : selectedType === 'nessus'
                        ? 'nessus-user'
                        : 'scanner-user'
                    }
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Password (optional, overrides env var)
                  </label>
                  <input
                    name="password"
                    type="password"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Stored encrypted at rest"
                    autoComplete="new-password"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Leave blank to load credentials from the env vars listed above.
                  </p>
                </div>
              </>
            )}
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
                    ['Scanner Type', labelFor(detailConn.integration_type)],
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
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${badgeFor(conn.integration_type)}`}>
                      {labelFor(conn.integration_type)}
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
                    {canDelete && (
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
                    )}

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
