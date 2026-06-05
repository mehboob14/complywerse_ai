'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '@/lib/api';
import EmptyState from '@/components/common/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import SetupWizard from './_setup-wizard';

type Agent = {
  id: number;
  agent_name: string;
  mode: 'collector' | 'endpoint';
  os_family?: string | null;
  hostname?: string | null;
  ip_address?: string | null;
  asset_id?: number | null;
  status: 'pending' | 'active' | 'stale' | 'revoked';
  agent_version?: string | null;
  last_heartbeat_at?: string | null;
  last_result_at?: string | null;
  enrolled_at?: string | null;
  created_at?: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  stale: 'bg-orange-100 text-orange-800 border-orange-200',
  revoked: 'bg-gray-200 text-gray-700 border-gray-300',
};

function fmtAgo(iso?: string | null): string {
  if (!iso) return 'never';
  const utc = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.now() - new Date(utc).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes without heartbeat → stale

/** Derive effective status — active agents that haven't pinged in >5min
 * are visually flagged as stale even if backend still says 'active'. */
function effectiveStatus(a: { status: string; last_heartbeat_at?: string | null }): string {
  if (a.status !== 'active') return a.status;
  if (!a.last_heartbeat_at) return 'pending';
  const utc = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(a.last_heartbeat_at)
    ? a.last_heartbeat_at : `${a.last_heartbeat_at}Z`;
  const ms = Date.now() - new Date(utc).getTime();
  return ms > STALE_THRESHOLD_MS ? 'stale' : 'active';
}

export default function AgentsAdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canManageAgents = hasPermission('compliance:agents:manage');
  // Wizard launch state — the Setup Wizard handles both single + bulk + discovery
  // handoff in one progressive flow, so the page only tracks open/closed +
  // any prefilled hostnames coming from /admin/discover.
  const [showWizard, setShowWizard] = useState(false);
  const [wizardPrefill, setWizardPrefill] = useState<{
    hostnames: string[];
    mode?: 'collector' | 'endpoint';
    osFamily?: string;
  } | null>(null);
  // Custom revoke modal state — replaces browser prompt+confirm
  const [revokeTarget, setRevokeTarget] = useState<Agent | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  // Pick up prefill from Discovery's "Send to Bulk Enroll" handoff: sessionStorage
  // + ?bulkEnroll=1 query param. We forward both into the wizard so the user
  // lands directly on the Configure step with hostnames already loaded.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('bulkEnroll') !== '1') return;
    const raw = sessionStorage.getItem('compliverse.bulkEnroll.prefill');
    if (!raw) return;
    try {
      const prefill = JSON.parse(raw) as { hostnames?: string[]; mode?: string; os_family?: string };
      if (prefill.hostnames?.length) {
        setWizardPrefill({
          hostnames: prefill.hostnames,
          mode: prefill.mode === 'collector' || prefill.mode === 'endpoint' ? prefill.mode : 'endpoint',
          osFamily: prefill.os_family,
        });
        setShowWizard(true);
      }
    } catch {
      // Swallow malformed prefill — user can still launch the wizard manually
    } finally {
      sessionStorage.removeItem('compliverse.bulkEnroll.prefill');
      const url = new URL(window.location.href);
      url.searchParams.delete('bulkEnroll');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const q = useQuery<{ agents: Agent[] }>({
    queryKey: ['agents'],
    queryFn: async () => (await agentsApi.list()).data,
    refetchInterval: 5000,
  });

  const revokeMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      agentsApi.revoke(id, reason),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      const target = agents.find(a => a.id === vars.id);
      toast.toast({ title: 'Agent revoked', message: target ? `${target.agent_name} can no longer push results.` : undefined, type: 'success' });
      setRevokeTarget(null);
      setRevokeReason('');
    },
    onError: () => toast.toast({ title: 'Revoke failed', type: 'error' }),
  });

  const agents = q.data?.agents ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-semibold text-gray-900">Compliance Agents</h1>
          <p className="text-sm text-gray-600 mt-1">
            Collector or per-endpoint agents that push CIS scan results back
            to Compliverse. Use this when WinRM/SSH is blocked or when
            you want results pushed instead of pulled.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => {
              if (!canManageAgents) {
                toast.toast({
                  title: 'Permission required',
                  message: 'Only Scanning Admins / Administrators can enroll agents. Ask your tenant admin for "compliance:agents:manage".',
                  type: 'warning',
                });
                return;
              }
              setWizardPrefill(null);
              setShowWizard(true);
            }}
            disabled={permsLoading}
            title={!canManageAgents && !permsLoading ? "You don't have permission to install agents" : 'Start the guided agent setup'}
            className={`px-4 py-2 text-white text-sm font-medium rounded-md whitespace-nowrap disabled:opacity-50 ${
              canManageAgents ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'
            }`}
          >
            {canManageAgents ? '🪄 Setup Wizard' : '🔒 Setup Wizard'}
          </button>
        </div>
      </div>

      <SetupWizard
        open={showWizard}
        onClose={() => { setShowWizard(false); setWizardPrefill(null); }}
        discoveryPrefill={wizardPrefill}
      />

      {/* Agents table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th className="text-left px-4 py-2.5">Agent</th>
                <th className="text-left px-4 py-2.5 w-32">Mode</th>
                <th className="text-left px-4 py-2.5 w-32">Host</th>
                <th className="text-left px-4 py-2.5 w-24">OS</th>
                <th className="text-left px-4 py-2.5 w-28">Status</th>
                <th className="text-left px-4 py-2.5 w-32">Last heartbeat</th>
                <th className="text-left px-4 py-2.5 w-32">Last results</th>
                <th className="text-right px-4 py-2.5 w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agents.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-2">
                    <EmptyState
                      icon="🤖"
                      title="No agents installed yet"
                      description="Install a collector agent to push CIS scan results back to Compliverse — useful when WinRM/SSH inbound is blocked or for endpoints behind NAT."
                      primaryAction={{ label: '🪄 Setup Wizard', onClick: () => { setWizardPrefill(null); setShowWizard(true); } }}
                      secondaryAction={{ label: 'Use Agentless instead', href: '/admin/discover' }}
                    />
                  </td>
                </tr>
              )}
              {agents.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{a.agent_name}</div>
                    {a.agent_version && (
                      <div className="text-[10px] text-gray-500">v{a.agent_version}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700 capitalize">{a.mode}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {a.hostname || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700 capitalize">{a.os_family || '—'}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const eff = effectiveStatus(a);
                      const isStale = eff === 'stale' && a.status === 'active';
                      return (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase ${STATUS_COLORS[eff] ?? 'bg-gray-100'}`}
                          title={isStale ? 'Heartbeat not received in 5+ minutes' : undefined}
                        >
                          {eff}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{fmtAgo(a.last_heartbeat_at)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{fmtAgo(a.last_result_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {a.status === 'revoked' ? (
                      <span className="text-xs text-gray-400">revoked</span>
                    ) : (
                      <button
                        onClick={() => { setRevokeTarget(a); setRevokeReason(''); }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom revoke modal — replaces browser confirm() */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Revoke agent?</h3>
            <p className="text-sm text-gray-600 mb-4">
              <strong>{revokeTarget.agent_name}</strong>'s next heartbeat will be
              rejected and it will lose access to the backend. Asset records remain
              intact; only the agent's push capability is killed.
            </p>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Reason (optional)
            </label>
            <textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="e.g. Replaced by new build, host decommissioned…"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => { setRevokeTarget(null); setRevokeReason(''); }}
                className="px-4 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => revokeMut.mutate({ id: revokeTarget.id, reason: revokeReason })}
                disabled={revokeMut.isPending}
                className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {revokeMut.isPending ? 'Revoking…' : 'Revoke agent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
