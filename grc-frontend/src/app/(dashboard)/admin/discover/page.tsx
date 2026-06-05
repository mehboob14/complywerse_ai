'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { onboardingApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import EmptyState from '@/components/common/EmptyState';
import { usePermissions } from '@/hooks/usePermissions';

type Step = 1 | 2 | 3;

function StepBreadcrumb({ current }: { current: Step }) {
  const steps: Array<{ n: Step; label: string }> = [
    { n: 1, label: 'Discover hosts' },
    { n: 2, label: 'Import as assets' },
    { n: 3, label: 'Done' },
  ];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {steps.map((s, i) => {
        const isActive = s.n === current;
        const isDone = s.n < current;
        return (
          <li key={s.n} className="flex items-center gap-2">
            <span
              className={`flex items-center justify-center w-6 h-6 rounded-full font-semibold ${
                isDone
                  ? 'bg-green-600 text-white'
                  : isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {isDone ? '✓' : s.n}
            </span>
            <span
              className={`font-medium ${
                isActive ? 'text-blue-700' : isDone ? 'text-green-700' : 'text-gray-500'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span className={`mx-1 ${isDone ? 'text-green-400' : 'text-gray-300'}`}>›</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

type HostResult = {
  ip: string;
  port: number;
  hostname?: string | null;
  status: 'reachable' | 'unreachable' | 'error';
  rtt_ms?: number | null;
  error?: string;
};

type DiscoverResp = {
  cidr: string;
  runner_type: string;
  port: number;
  scanned: number;
  reachable_count: number;
  hosts: HostResult[];
};

type ImportResp = {
  created_assets: Array<{ id: number; name: string; host: string }>;
  created_connections: Array<{ id: number; name: string }>;
  skipped: Array<{ host: string; reason: string }>;
};

const RUNNER_PORTS: Record<string, number> = {
  windows_winrm: 5986,
  linux_ssh: 22,
  netdev_ssh: 22,
  oracle_sql: 1521,
};

export default function DiscoverPage() {
  const router = useRouter();
  const toast = useToast();
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canDiscover = hasPermission('compliance:discover:execute');
  const canManageAgents = hasPermission('compliance:agents:manage');
  // Discovery form
  const [cidr, setCidr] = useState('10.0.0.0/29');
  const [runnerType, setRunnerType] = useState('windows_winrm');
  const [portOverride, setPortOverride] = useState('');
  const [timeout, setTimeout] = useState('1.0');

  // Discovery result
  const [discovery, setDiscovery] = useState<DiscoverResp | null>(null);
  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());

  // Import form (only shown after discovery)
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [assetType, setAssetType] = useState('infrastructure');
  const [criticality, setCriticality] = useState('medium');
  const [assetPrefix, setAssetPrefix] = useState('');
  const [importResult, setImportResult] = useState<ImportResp | null>(null);

  const discoverMut = useMutation({
    mutationFn: () =>
      onboardingApi.discover({
        cidr: cidr.trim(),
        runner_type: runnerType,
        port_override: portOverride ? Number(portOverride) : undefined,
        timeout_s: Number(timeout) || 1.0,
      }),
    onSuccess: (res) => {
      setDiscovery(res.data);
      const reachable = (res.data.hosts as HostResult[]).filter(h => h.status === 'reachable');
      setSelectedIps(new Set(reachable.map(h => h.ip)));
      setImportResult(null);
      toast.toast({
        title: `Discovery complete`,
        message: `${reachable.length} of ${res.data.scanned} hosts reachable on port ${res.data.port}.`,
        type: reachable.length > 0 ? 'success' : 'warning',
      });
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.toast({
        title: 'Discovery failed',
        message: err?.response?.data?.detail || 'Backend rejected the CIDR or runner type.',
        type: 'error',
      });
    },
  });

  const importMut = useMutation({
    mutationFn: () => {
      if (!discovery) throw new Error('No discovery to import from');
      const hosts = discovery.hosts
        .filter(h => selectedIps.has(h.ip))
        .map(h => ({ ip: h.ip, hostname: h.hostname || null }));
      return onboardingApi.bulkImport({
        runner_type: runnerType,
        asset_type: assetType,
        criticality,
        asset_name_prefix: assetPrefix,
        username, password,
        port: portOverride ? Number(portOverride) : RUNNER_PORTS[runnerType],
        hosts,
      });
    },
    onSuccess: (res) => {
      setImportResult(res.data);
      toast.toast({
        title: 'Bulk import complete',
        message: `${res.data.created_assets.length} created, ${res.data.skipped.length} skipped.`,
        type: 'success',
      });
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.toast({
        title: 'Import failed',
        message: err?.response?.data?.detail || 'Server rejected the import.',
        type: 'error',
      });
    },
  });

  const reachable = useMemo(
    () => discovery?.hosts.filter(h => h.status === 'reachable') ?? [],
    [discovery],
  );

  const toggleAll = () => {
    if (!discovery) return;
    if (selectedIps.size === reachable.length) {
      setSelectedIps(new Set());
    } else {
      setSelectedIps(new Set(reachable.map(h => h.ip)));
    }
  };

  const currentStep: Step = importResult ? 3 : discovery && reachable.length > 0 ? 2 : 1;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-semibold text-gray-900">Bulk Host Discovery</h1>
          <p className="text-sm text-gray-600 mt-1">
            Scan a CIDR range (e.g. <code className="bg-gray-100 px-1 rounded">10.0.0.0/24</code>)
            for live hosts on the runner's port, then bulk-import the responders
            as assets with credentials in one shot.
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
          <StepBreadcrumb current={currentStep} />
        </div>
      </div>

      {/* Discovery form */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">1. Discover hosts in a network range</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">CIDR range</label>
            <input
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
              placeholder="10.0.0.0/24"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Runner type</label>
            <select
              value={runnerType}
              onChange={(e) => setRunnerType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="windows_winrm">Windows (WinRM 5986)</option>
              <option value="linux_ssh">Linux (SSH 22)</option>
              <option value="netdev_ssh">Cisco / Network device (SSH 22)</option>
              <option value="oracle_sql">Oracle Database (TNS 1521)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Port override (optional)</label>
            <input
              value={portOverride}
              onChange={(e) => setPortOverride(e.target.value)}
              placeholder={`Default ${RUNNER_PORTS[runnerType] ?? '—'}`}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Probe timeout (s)</label>
            <input
              value={timeout}
              onChange={(e) => setTimeout(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Max 4096 hosts per scan. /24 takes ~10s, /22 ~30s.
          </p>
          <button
            onClick={() => {
              if (!canDiscover) {
                toast.toast({
                  title: 'Permission required',
                  message: 'Only Scanning Admins / Administrators can run CIDR discovery. Ask your tenant admin for "compliance:discover:execute".',
                  type: 'warning',
                });
                return;
              }
              discoverMut.mutate();
            }}
            disabled={permsLoading || discoverMut.isPending || !cidr.trim()}
            title={!canDiscover && !permsLoading ? "You don't have permission to run network discovery" : undefined}
            className={`px-4 py-2 text-white text-sm font-medium rounded-md disabled:opacity-50 ${
              canDiscover ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'
            }`}
          >
            {discoverMut.isPending ? 'Probing…' : canDiscover ? '🔍 Start Discovery' : '🔒 Start Discovery'}
          </button>
        </div>
        {discoverMut.isError && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {(discoverMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
              'Discovery failed.'}
          </div>
        )}
      </div>

      {/* Discovery results */}
      {discovery && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Probed {discovery.scanned} hosts in {discovery.cidr}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {discovery.reachable_count} responded on port {discovery.port} ·
                Select the ones you want to import as assets below
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <button onClick={toggleAll} className="text-blue-600 hover:underline">
                {selectedIps.size === reachable.length ? 'Deselect all' : 'Select all reachable'}
              </button>
              {(() => {
                const hostnames = discovery.hosts
                  .filter(h => h.status === 'reachable' && h.hostname && (selectedIps.size === 0 || selectedIps.has(h.ip)))
                  .map(h => h.hostname!);
                if (!hostnames.length) return null;
                return (
                  <button
                    onClick={() => {
                      if (!canManageAgents) {
                        toast.toast({ title: 'Permission required', message: 'compliance:agents:manage needed.', type: 'warning' });
                        return;
                      }
                      sessionStorage.setItem('compliverse.bulkEnroll.prefill', JSON.stringify({
                        hostnames,
                        mode: runnerType === 'windows_winrm' ? 'endpoint' : 'collector',
                        os_family: runnerType === 'windows_winrm' ? 'windows' : 'linux',
                      }));
                      router.push('/admin/agents?bulkEnroll=1');
                    }}
                    className="px-3 py-1 border border-indigo-600 text-indigo-700 hover:bg-indigo-50 rounded-md font-medium"
                    title={`Pre-fill Bulk Enroll modal with ${hostnames.length} hostname(s)`}
                  >
                    ⚡ Send {hostnames.length} hostname{hostnames.length === 1 ? '' : 's'} to Bulk Enroll
                  </button>
                );
              })()}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2 w-10"></th>
                  <th className="text-left px-3 py-2 w-32">IP</th>
                  <th className="text-left px-3 py-2">Hostname</th>
                  <th className="text-left px-3 py-2 w-24">Status</th>
                  <th className="text-right px-3 py-2 w-20">RTT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {discovery.hosts.map((h) => (
                  <tr key={h.ip} className={h.status === 'reachable' ? '' : 'opacity-60'}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={h.status !== 'reachable'}
                        checked={selectedIps.has(h.ip)}
                        onChange={(e) => {
                          const next = new Set(selectedIps);
                          if (e.target.checked) next.add(h.ip);
                          else next.delete(h.ip);
                          setSelectedIps(next);
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{h.ip}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {h.hostname || <span className="text-gray-400 italic">no DNS</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        h.status === 'reachable' ? 'bg-green-100 text-green-800'
                        : h.status === 'unreachable' ? 'bg-gray-200 text-gray-700'
                        : 'bg-red-100 text-red-800'
                      }`}>
                        {h.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-600">
                      {h.rtt_ms != null ? `${h.rtt_ms}ms` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state when discovery completes with zero responders */}
      {discovery && reachable.length === 0 && (
        <EmptyState
          icon={<span>🛰️</span>}
          title="No hosts responded on this port"
          description={`We probed ${discovery.scanned} address${
            discovery.scanned === 1 ? '' : 'es'
          } in ${discovery.cidr} on port ${discovery.port} but nothing answered. Try a different CIDR range, port, or check firewall rules.`}
          primaryAction={{
            label: 'Adjust and retry',
            onClick: () => {
              setDiscovery(null);
              setSelectedIps(new Set());
            },
          }}
        />
      )}

      {/* Import form */}
      {discovery && reachable.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">
            2. Import {selectedIps.size} selected host{selectedIps.size === 1 ? '' : 's'} as assets
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={runnerType === 'windows_winrm' ? 'DOMAIN\\administrator' : 'root'}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Asset name prefix</label>
              <input
                value={assetPrefix}
                onChange={(e) => setAssetPrefix(e.target.value)}
                placeholder="e.g. prod-"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Asset type</label>
              <select
                value={assetType}
                onChange={(e) => setAssetType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="infrastructure">Infrastructure</option>
                <option value="application">Application</option>
                <option value="data">Data</option>
                <option value="cloud">Cloud</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Criticality</label>
              <select
                value={criticality}
                onChange={(e) => setCriticality(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Same credentials are stored for every imported host. To use different
              credentials per host, import in batches.
            </p>
            <button
              onClick={() => importMut.mutate()}
              disabled={importMut.isPending || !username || !password || selectedIps.size === 0}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {importMut.isPending ? 'Importing…' : `📥 Import ${selectedIps.size} host${selectedIps.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {/* Import results */}
      {importResult && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">3. Import complete</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Assets created</div>
              <div className="mt-1 text-2xl font-semibold text-green-700">{importResult.created_assets.length}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Connections created</div>
              <div className="mt-1 text-2xl font-semibold text-blue-700">{importResult.created_connections.length}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Skipped</div>
              <div className="mt-1 text-2xl font-semibold text-gray-700">{importResult.skipped.length}</div>
            </div>
          </div>
          {importResult.created_assets.length > 0 && (
            <div className="mt-4 text-xs">
              <div className="font-medium text-gray-700 mb-1">Created assets:</div>
              <ul className="list-disc list-inside text-gray-600">
                {importResult.created_assets.map((a) => (
                  <li key={a.id}>
                    {a.name} <span className="font-mono text-gray-400">({a.host})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {importResult.skipped.length > 0 && (
            <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              <strong>Skipped:</strong>{' '}
              {importResult.skipped.map(s => `${s.host} (${s.reason})`).join('; ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
