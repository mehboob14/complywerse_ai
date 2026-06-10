'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import apiClient, { agentsApi } from '@/lib/api';
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
          <Link
            href="/admin/integrations/connect"
            title={!canManageAgents && !permsLoading
              ? "You don't have permission to open the Connect Wizard"
              : 'Open the agentless Connect Wizard (Windows / Linux / Cloud)'}
            aria-disabled={!canManageAgents}
            onClick={(e) => {
              if (!canManageAgents) {
                e.preventDefault();
                toast.toast({
                  title: 'Permission required',
                  message: 'Only Scanning Admins / Administrators can open the Connect Wizard. Ask your tenant admin for "compliance:agents:manage".',
                  type: 'warning',
                });
              }
            }}
            className={`px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap border ${
              canManageAgents
                ? 'border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
                : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
            }`}
          >
            {canManageAgents ? '🔌 Open Connect Wizard →' : '🔒 Open Connect Wizard'}
          </Link>
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

      {/* ─── ENDPOINT AGENT PACKAGES ─────────────────────────────────────
          Surfaces the per-OS installer endpoints from the CIS Phase 3
          backend merge. The Setup Wizard above still handles the
          enrollment-token generation flow; these cards give operators
          the installer binary directly when they already have their own
          fleet-management tool (GPO / Intune / Ansible / Jamf). Cisco /
          AWS / Oracle DB etc don't get a native agent — they use the
          Agentless Connect Wizard surfaced below. */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Endpoint agent packages</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            For Windows / Linux / macOS hosts where you install the agent
            directly. Each host runs its own copy; the agent dials out to
            Compliverse, no inbound firewall rule needed.
          </p>
        </div>
        <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-200">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🪟</span>
              <span className="font-semibold text-sm text-gray-900">Windows</span>
              <span
                className="ml-auto text-[10px] text-gray-500"
                title="Self-elevating .cmd wrapper that downloads setup.ps1 + agent.py. Notarised MSI is on the roadmap."
              >
                .cmd · x64
              </span>
            </div>
            <div className="text-xs text-gray-600 mb-3">
              Win 10 / 11 + Server 2016/19/22. Runs as
              <code className="bg-gray-100 px-1 rounded mx-0.5">LocalSystem</code>.
            </div>
            <InstallerButtons
              endpoint="installer.cmd"
              label="Download Windows installer"
              hint="One file. Runs on any Windows host. Will refuse to enrol on Linux/Mac."
              toast={toast}
            />
            <Link href="/admin/integrations/connect?platform=windows" className="mt-1.5 block text-center text-[10px] text-gray-500 hover:text-blue-700 hover:underline">
              or connect agentless (WinRM)
            </Link>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🐧</span>
              <span className="font-semibold text-sm text-gray-900">Linux</span>
              <span
                className="ml-auto text-[10px] text-gray-500"
                title="Self-elevating .sh bootstrap that installs as systemd. Native .deb + .rpm packages are on the roadmap."
              >
                .sh bootstrap
              </span>
            </div>
            <div className="text-xs text-gray-600 mb-3">
              Ubuntu 20/22/24 · Debian 11/12 · RHEL 8/9 · AlmaLinux · Amazon Linux. Installs as
              <code className="bg-gray-100 px-1 rounded mx-0.5">systemd</code> service.
            </div>
            <InstallerButtons
              endpoint="installer.sh"
              label="Download Linux installer"
              hint="One file. Runs on any Linux host. Will refuse to enrol on Windows/Mac."
              toast={toast}
            />
            <Link href="/admin/integrations/connect?platform=linux" className="mt-1.5 block text-center text-[10px] text-gray-500 hover:text-blue-700 hover:underline">
              or connect agentless (SSH)
            </Link>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🍎</span>
              <span className="font-semibold text-sm text-gray-900">macOS</span>
              <span
                className="ml-auto text-[10px] text-gray-500"
                title="Double-clickable .command bootstrap (Terminal opens, asks for sudo). Signed .pkg is on the roadmap."
              >
                .command
              </span>
            </div>
            <div className="text-xs text-gray-600 mb-3">
              macOS 12 Monterey or later. Notarised PKG installs as a launch daemon.
            </div>
            <InstallerButtons
              endpoint="installer.command"
              label="Download macOS installer"
              hint="One file. Runs on any Mac. Will refuse to enrol on Windows/Linux."
              toast={toast}
            />
            <p className="mt-1.5 text-center text-[10px] text-gray-400">macOS uses agent-only onboarding</p>
          </div>
        </div>
      </div>

      {/* ─── COLLECTOR AGENT (Linux, reaches OUT to remote targets) ─────── */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Collector agent</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            One Linux box inside the bank LAN. Reaches OUT to remote targets — Cisco / Oracle / MSSQL / Postgres / MySQL / AD / Azure / K8s.
            Pulls credentials from your Connect Wizard connections, executes locally, posts results back.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-4 p-4">
          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">📡</span>
              <span className="font-semibold text-sm text-gray-900">Collector agent (Linux)</span>
              <span className="ml-auto text-[10px] text-gray-500">SSH / SQL / LDAP drivers preinstalled</span>
            </div>
            <div className="text-xs text-gray-600 mb-3">
              Same agent binary as endpoint, runs in <code className="bg-gray-100 px-1 rounded">mode=collector</code>. Installer also
              pip-installs <code className="bg-gray-100 px-1 rounded">paramiko</code>, <code className="bg-gray-100 px-1 rounded">pymssql</code>,
              <code className="bg-gray-100 px-1 rounded">psycopg2</code>, <code className="bg-gray-100 px-1 rounded">pymysql</code>,
              <code className="bg-gray-100 px-1 rounded">oracledb</code>, <code className="bg-gray-100 px-1 rounded">ldap3</code> so the box
              can execute every remote-target runner.
            </div>
            <InstallerButtons
              endpoint="installer.sh"
              label="Download collector installer"
              hint="One file. Use on one Linux box per LAN segment. Refuses non-Linux."
              toast={toast}
              extraParams={{ collector: 1 }}
            />
          </div>
          <div className="p-4 border border-gray-200 rounded-lg bg-blue-50/40">
            <div className="text-xs font-semibold text-blue-800 mb-2">When to use a collector vs server-side agentless?</div>
            <ul className="text-[11px] text-gray-700 space-y-1.5 list-disc list-inside">
              <li><strong>Use the collector</strong> when the bank's firewall blocks inbound from Compliverse — collector dials OUT, then dials IN to the targets it can already reach.</li>
              <li><strong>Use agentless</strong> when Compliverse can reach the targets directly (cloud-hosted backend + targets with public IPs / VPN).</li>
              <li>Both paths reuse the same Connect Wizard credentials. Switching is a one-line config change.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ─── AGENTLESS TARGETS ─────────────────────────────────────────── */}
      <AgentlessTargetsSection />

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

// ─── InstallerButtons ────────────────────────────────────────────────────
// Mints a fleet enrollment token (unlimited uses, 72h TTL) and streams the
// per-OS installer file as a download. One file works on any host of the
// SAME OS family — the installer + agent both refuse to enrol on a
// mismatched OS. Powered by the CIS Phase 3 backend endpoints
// (/agents/installer.cmd | .sh | .command). Revocable any time via the
// Agents table below.
function InstallerButtons({
  endpoint, label, hint, toast, extraParams,
}: {
  endpoint: 'installer.cmd' | 'installer.sh' | 'installer.command';
  label: string;
  hint: string;
  toast: ReturnType<typeof useToast>;
  extraParams?: Record<string, string | number>;
}) {
  const download = async (params: Record<string, string | number>) => {
    if (extraParams) params = { ...extraParams, ...params };
    try {
      const resp = await apiClient.get(`/agents/${endpoint}`, {
        params,
        responseType: 'blob',
      });
      const blob = new Blob([resp.data], { type: 'application/octet-stream' });
      const cd = String(resp.headers['content-disposition'] || '');
      const m = cd.match(/filename="?([^";]+)"?/);
      const filename = m ? m[1] : `ComplyverseAgent.${endpoint.split('.').pop()}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return filename;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      toast.toast({ title: 'Download failed', message: msg, type: 'error' });
      return null;
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const filename = await download({ fleet: 1, expires_hours: 72 });
          if (filename) {
            toast.toast({
              title: 'Installer ready',
              message: `${filename} — share with any number of hosts. Reusable for 72h, revocable any time.`,
              type: 'success',
            });
          }
        }}
        className="block w-full text-center px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700"
      >
        📥 {label}
      </button>
      <div className="mt-1 text-center text-[10px] text-gray-500">{hint}</div>
    </>
  );
}

// ─── AgentlessTargetsSection ─────────────────────────────────────────────
// Single CTA card pointing operators to the Connect Wizard for non-agent
// device classes (Cisco / AWS / Azure / DBs / AD / K8s). The package's
// earlier version rendered a 12-tile grid; current shape is a single CTA
// because the grouped tile UI already lives at /admin/integrations/connect
// (one source of truth, not two pages of the same logic).
function AgentlessTargetsSection() {
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Agentless targets</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Network devices, cloud accounts, databases — anything you can&apos;t or
          don&apos;t want to install software on. Each integration is set up in
          the Connect Wizard.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 p-5 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <p className="text-sm text-gray-700">
            The Connect Wizard groups the 12 supported integrations by
            category (hosts · network devices · databases · identity · cloud)
            with a one-line &ldquo;best for&rdquo; hint per group, so you know which
            credential type fits your scenario before clicking through.
          </p>
        </div>
        <Link
          href="/admin/integrations/connect"
          className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          <Plus className="h-3.5 w-3.5" />
          Open Connect Wizard
        </Link>
      </div>
    </section>
  );
}
