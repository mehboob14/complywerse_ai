import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Router as RouterIcon,
  Cloud,
  Waves,
  Database,
  TerminalSquare,
  ServerCog,
  Plus,
  Boxes,
  Users as UsersIcon,
  CloudCog,
  Container,
} from 'lucide-react';
import { agentsApi, apiClient } from '@/lib/api';
import EmptyState from '@/components/common/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';

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

/**
 * One installer-download button per OS card. Used to expose Single + Fleet
 * as a pair; collapsed to a single button per Hassan's feedback ("keep one
 * installer per OS, OS-fence enforces it"). The button defaults to fleet
 * semantics (reusable token, 72h TTL) so the same file can install on N
 * hosts of the SAME OS family. The installer + agent enforce OS family
 * — running the .sh on a Mac OR enrolling a Win box with a Linux token
 * is refused with a clear message.
 */
function InstallerButtons({
  endpoint, label, hint, toast, extraParams,
}: {
  endpoint: 'installer.cmd' | 'installer.sh' | 'installer.command';
  label: string;
  hint: string;
  toast: { toast: (args: { title: string; message?: string; type?: string }) => void };
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
    } catch (e: any) {
      toast.toast({ title: 'Download failed', message: e?.message || 'Unknown error', type: 'error' });
      return null;
    }
  };

  // Single button per OS. Mints a fleet token (unlimited uses, 72h TTL)
  // so the same file can install on N hosts of the SAME OS family. The
  // installer + agent both refuse if the host OS doesn't match the
  // installer's intended family — Windows .cmd won't enrol on Linux
  // and vice versa.
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
  const { hasPermission, isAdmin, isLoading: permsLoading } = usePermissions();
  const canManageAgents = hasPermission('compliance:agents:manage');
  // Revoking an agent kills its API token mid-flight — destructive, so
  // restrict to Administrator. Scanning Admin can create agents but not
  // delete them. Defence-in-depth: backend will 403 if bypassed.
  const canRevoke = isAdmin;
  // Custom revoke modal state — replaces browser prompt+confirm
  const [revokeTarget, setRevokeTarget] = useState<Agent | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

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
          <h1 className="text-2xl font-semibold text-gray-900">Onboard a host</h1>
          <p className="text-sm text-gray-600 mt-1">
            Two ways to bring an asset under Compliverse — pick whichever fits your environment.
          </p>
        </div>
        <Link
          href="/admin/connections"
          className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
          title="Agentless credentials & scope (one cred → many assets)"
        >
          <Plus className="h-3.5 w-3.5" /> Manage agentless connections
        </Link>
      </div>

      {/* Quick "which one should I use?" guide */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border-2 border-blue-200 bg-blue-50/50 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">OPTION A</span>
            <h3 className="text-sm font-semibold text-gray-900">Install an agent on the host</h3>
          </div>
          <p className="mt-2 text-xs text-gray-700">
            Best for: Windows/Linux/macOS endpoints, laptops, servers behind NAT, anywhere the host can dial out HTTPS to Compliverse but you can't reach IN.
          </p>
          <ol className="mt-2 list-inside list-decimal space-y-0.5 text-[11px] text-gray-700">
            <li>Download the installer for the OS (cards below).</li>
            <li>Generate an enrollment token via "+ Enroll agent" (each install needs one).</li>
            <li>Run installer on the host (manual, or via GPO/Intune/Jamf for mass push).</li>
            <li>Agent auto-starts as a service, dials home, registers — appears in Agents table.</li>
          </ol>
        </div>
        <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/50 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">OPTION B</span>
            <h3 className="text-sm font-semibold text-gray-900">Connect agentless (credentials)</h3>
          </div>
          <p className="mt-2 text-xs text-gray-700">
            Best for: network devices, AWS/Azure accounts, databases, hosts where you can't install software but have SSH/WinRM/API access. <strong>One cred can scan many hosts</strong> via scope.
          </p>
          <ol className="mt-2 list-inside list-decimal space-y-0.5 text-[11px] text-gray-700">
            <li>Pick the target class below (Cisco / Linux / Win / AWS / Oracle DB / DigitalOcean).</li>
            <li>Connect Wizard → enter creds → it test-dials, stores Fernet-encrypted.</li>
            <li>Wizard ends with scope step: all-of-tenant (default) or specific assets.</li>
            <li>Asset rows auto-created. Scan runs use stored cred on-demand.</li>
          </ol>
        </div>
      </div>

      {/* ─── AGENT PACKAGE DOWNLOADS ───────────────────────────────────
          Hassan's feedback (#4-9 on the gap list): the wizard had the
          downloads buried in step 5; product owners and IT teams want
          to see — and grab — the platform packages up front the way
          every commercial endpoint-agent product does (CrowdStrike,
          SentinelOne, Wazuh). Three big cards, each one click to
          download, plus the canonical deploy command for that platform's
          fleet tool (GPO / Intune / Ansible / Jamf). This is intentionally
          parallel to the Setup Wizard, not replacing it — the wizard
          stays for the *enrollment-token* generation path; this panel
          gives you the *installer binary* on its own when you already
          have your fleet management story sorted.
      */}
      {/* Endpoint agents — for OS installs on individual hosts.
          Cisco, AWS, Oracle DB etc do NOT get a native agent — they
          go through the "Collector & Agentless targets" panel below. */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Endpoint agent packages</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            For Windows / Linux / macOS hosts where you install the agent
            directly. Each PC runs its own copy; the agent dials out to
            Compliverse, no inbound firewall rule needed.
          </p>
        </div>
        <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-200">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🪟</span>
              <span className="font-semibold text-sm text-gray-900">Windows</span>
              {/* Honest label: we serve a self-elevating .cmd that
                  downloads setup.ps1 + agent.py. The earlier "MSI · x64"
                  tag was aspirational and caused operators to expect a
                  signed MSI — when they tried alternate /agents/installer.msi
                  URLs they got a 429-byte 404 JSON renamed .msi. A real
                  notarised MSI is on the roadmap; until then the .cmd is
                  the one supported path. */}
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
              {/* Honest: only the .sh bootstrap is wired today. Native
                  .deb + .rpm packaging is on the roadmap. */}
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
              {/* Honest: ships as a double-clickable .command. Signed
                  .pkg with launchd plist is on the roadmap. */}
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
                      description="Download a package above and run it on the target host. The agent dials Compliverse back automatically. For agentless onboarding (Cisco, AWS, Linux, etc.), use the Collector targets section."
                    />
                  </td>
                </tr>
              )}
              {agents.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {/* Identity priority (per Hassan: "agent will show by
                        name after enrollment, all have a name"):
                          1. hostname    — set after first heartbeat,
                                           operator-friendly (BLOCK-C-HOST)
                          2. agent_name  — installer placeholder, e.g.
                                           "installer-20260605-142431"
                          3. "Agent #N"  — last-resort if neither populated
                        Whichever isn't the primary becomes a small caption
                        below so the operator can still cross-reference. */}
                    {(() => {
                      const primary = a.hostname || a.agent_name || `Agent #${a.id}`;
                      const secondary = a.hostname && a.agent_name && a.hostname !== a.agent_name
                        ? a.agent_name
                        : null;
                      return (
                        <>
                          <div className="font-medium text-gray-900">{primary}</div>
                          {secondary && (
                            <div className="text-[10px] text-gray-500" title={`Installer batch: ${secondary}`}>
                              {secondary.length > 32 ? secondary.slice(0, 32) + '…' : secondary}
                            </div>
                          )}
                          {a.agent_version && (
                            <div className="text-[10px] text-gray-400">v{a.agent_version}</div>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700 capitalize">{a.mode}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {/* If hostname is already the primary identity above we
                        still show it here for explicit row-level scanning. */}
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
                        onClick={() => {
                          if (!canRevoke) {
                            alert(
                              "🔒 Permission required\n\n" +
                              "Only the Tenant Administrator can revoke an agent — it kills " +
                              "the agent's API token and stops any scans it was running. " +
                              "Ask your admin if this agent needs to go."
                            );
                            return;
                          }
                          setRevokeTarget(a);
                          setRevokeReason('');
                        }}
                        title={canRevoke ? 'Revoke this agent token (destructive)' : 'Tenant Administrator only'}
                        className={`text-xs ${
                          canRevoke ? 'text-red-600 hover:underline' : 'text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {canRevoke ? 'Revoke' : '🔒 Revoke'}
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

// ─── Agentless target tile ───────────────────────────────────────────────
// Card grid for the "no native agent" device classes. Each tile shows
// icon, name, protocol pill, one-line description, and the action buttons
// applicable to that class (single-add always, bulk only for scalable ones).

type AgentlessTile = {
  key: string;
  name: string;
  protocol: string;
  description: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  connectPath: string;
};

const AGENTLESS_TILES: AgentlessTile[] = [
  {
    key: 'cisco',
    name: 'Cisco network device',
    protocol: 'SSH',
    description: 'IOS / IOS-XE / NX-OS / ASA / Firepower. Collector runs read-only show commands.',
    icon: RouterIcon,
    iconBg: 'bg-sky-50',
    iconColor: 'text-sky-600',
    connectPath: '/admin/integrations/connect?platform=cisco',
  },
  {
    key: 'linux',
    name: 'Linux server',
    protocol: 'SSH',
    description: 'Read-only audit account over SSH. One service account password works for the entire fleet.',
    icon: TerminalSquare,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    connectPath: '/admin/integrations/connect?platform=linux',
  },
  {
    key: 'windows',
    name: 'Windows server',
    protocol: 'WinRM',
    description: 'Domain-joined hosts via AD service account. GPO grants audit rights on all targets.',
    icon: ServerCog,
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    connectPath: '/admin/integrations/connect?platform=windows',
  },
  {
    key: 'aws',
    name: 'AWS account',
    protocol: 'IAM role',
    description: 'Cross-account read-only IAM role. Collector calls AWS APIs per account.',
    icon: Cloud,
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-600',
    connectPath: '/admin/integrations/connect?platform=aws',
  },
  {
    key: 'digitalocean',
    name: 'DigitalOcean project',
    protocol: 'API token',
    description: 'Read-scoped PAT. Collector enumerates droplets, snapshots, firewall rules.',
    icon: Waves,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    connectPath: '/admin/integrations/connect?platform=digitalocean',
  },
  {
    key: 'oracle',
    name: 'Oracle Database',
    protocol: 'TNS',
    description: 'Oracle DB 19c / 23ai. Read-only DB user with SELECT_CATALOG_ROLE.',
    icon: Database,
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-600',
    connectPath: '/admin/integrations/connect?platform=oracle',
  },
  {
    key: 'mssql',
    name: 'Microsoft SQL Server',
    protocol: 'TDS',
    description: 'SQL Server 2017+ via pymssql. Read-only login. CIS MSSQL Benchmark (sa, TDE, audit, login policy).',
    icon: Database,
    iconBg: 'bg-cyan-50',
    iconColor: 'text-cyan-600',
    connectPath: '/admin/integrations/connect?platform=mssql',
  },
  {
    key: 'postgres',
    name: 'PostgreSQL',
    protocol: 'libpq',
    description: 'Postgres 12+ via psycopg2. Read-only user. CIS PostgreSQL Benchmark.',
    icon: Database,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-700',
    connectPath: '/admin/integrations/connect?platform=postgres',
  },
  {
    key: 'mysql',
    name: 'MySQL / MariaDB',
    protocol: 'MySQL',
    description: 'MySQL 5.7+ / MariaDB via PyMySQL. Read-only user. CIS MySQL Benchmark.',
    icon: Database,
    iconBg: 'bg-yellow-50',
    iconColor: 'text-yellow-700',
    connectPath: '/admin/integrations/connect?platform=mysql',
  },
  {
    key: 'ad',
    name: 'Active Directory / LDAP',
    protocol: 'LDAP',
    description: 'Domain controller via ldap3. Read-only bind. CIS AD Domain Services Benchmark (password policy, privileged groups, GPO).',
    icon: UsersIcon,
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-600',
    connectPath: '/admin/integrations/connect?platform=ad',
  },
  {
    key: 'azure',
    name: 'Azure subscription',
    protocol: 'OAuth + Mgmt API',
    description: 'Service principal with Reader role. CIS Azure Foundations Benchmark + Entra ID controls.',
    icon: CloudCog,
    iconBg: 'bg-sky-50',
    iconColor: 'text-sky-700',
    connectPath: '/admin/integrations/connect?platform=azure',
  },
  {
    key: 'k8s',
    name: 'Kubernetes cluster',
    protocol: 'kubeconfig',
    description: 'Any K8s 1.24+ cluster (EKS / AKS / GKE / vanilla). Read-only RBAC. CIS Kubernetes Benchmark.',
    icon: Container,
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-700',
    connectPath: '/admin/integrations/connect?platform=k8s',
  },
];

function AgentlessTargetsSection() {
  // Per Hassan: this used to render all 12 agentless cards as tiles. The
  // exact same 12 cards (with better grouping + 1-line guidance per
  // category) live on /admin/integrations/connect. Two pages, one logic
  // = a duplicate. Replaced with a single CTA that hands the operator
  // off to the grouped wizard so there's only one source of truth.
  //
  // The AGENTLESS_TILES array above is intentionally kept so the tile
  // labels + connectPath URLs remain greppable for future refactors,
  // but no UI surface on this page consumes it anymore.
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Agentless targets</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Network devices, cloud accounts, databases — anything you can't or
          don't want to install software on. Each integration is set up in
          the Connect Wizard.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 p-5 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <p className="text-sm text-gray-700">
            The Connect Wizard groups the 12 supported integrations by
            category (hosts · network devices · databases · identity · cloud)
            with a one-line "best for" hint per group, so you know which
            credential type fits your scenario before clicking through.
          </p>
          <p className="mt-1.5 text-[11px] text-gray-500">
            We removed the duplicate tile grid that used to live here — one
            source of truth, not two pages of the same logic.
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
