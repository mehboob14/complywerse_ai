'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, CheckCircle2, Copy } from 'lucide-react';
import { agentsApi } from '@/cyber-assurance/lib/api';
import { useToast } from '@/cyber-assurance/components/ui/ToastProvider';
import { usePermissions } from '@/cyber-assurance/hooks/usePermissions';

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
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  stale: 'bg-amber-50 text-amber-700 border-amber-200',
  revoked: 'bg-slate-100 text-slate-600 border-slate-300',
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
  // Custom revoke modal state — replaces browser prompt+confirm
  const [revokeTarget, setRevokeTarget] = useState<Agent | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const q = useQuery<{ items: Agent[] }>({
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

  const agents = q.data?.items ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-slate-900">Compliance Agents</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Install a lightweight agent on a host — it enrols, inventories the machine, and runs
          CIS benchmarks locally, then reports to ComplyVerse. Built for endpoints you can&apos;t reach
          over the network: roaming laptops, NAT&apos;d or firewalled boxes, and cloud VMs. Pick an OS or a cloud provider to install.
        </p>
      </div>

      {!permsLoading && !canManageAgents && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          You need the <code className="rounded bg-amber-100 px-1">compliance:agents:manage</code> permission to install or revoke agents.
        </div>
      )}

      {/* Agent installers — one self-contained binary per OS. It enrols,
          inventories the host, reports to ComplyVerse, and (on Linux) runs CIS
          benchmarks locally. One file works on any host of the same OS family. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {([
          { os: 'windows' as const, glyph: '🪟', title: 'Windows agent',
            meta: 'x64 · runs as LocalSystem',
            caps: ['Full hardware + software inventory', 'Auto-enrols, heartbeats & reports on schedule'],
            run: 'Run in Windows PowerShell as Administrator — not Command Prompt.',
            support: 'Windows 10 / 11 · Server 2016 – 2022' },
          { os: 'linux' as const, glyph: '🐧', title: 'Linux agent',
            meta: 'x64 · systemd service',
            caps: ['Full hardware + software inventory', 'Runs CIS benchmarks locally (OpenSCAP)', 'Auto-enrols, heartbeats & re-scans on schedule'],
            run: 'Run in a terminal as root (sudo).',
            support: 'Ubuntu 20/22/24 · Debian 11/12 · RHEL/Alma 8/9 · Amazon Linux' },
          { os: 'macos' as const, glyph: '💻', title: 'macOS agent',
            meta: 'Apple Silicon + Intel · LaunchDaemon',
            caps: ['Full hardware + software inventory', 'Auto-enrols, heartbeats & reports on schedule'],
            run: 'Run in Terminal as root (sudo).',
            support: 'macOS 12 Monterey and later' },
        ]).map((c) => (
          <div
            key={c.os}
            className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-primary-300 hover:shadow"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-50 text-2xl">{c.glyph}</div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">{c.title}</div>
                <div className="text-[11px] text-slate-500">{c.meta}</div>
              </div>
            </div>
            <ul className="mt-4 space-y-1.5 text-xs text-slate-600">
              {c.caps.map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-800">
              {c.run}
            </p>
            <div className="mt-auto pt-4">
              <InstallAgent
                os={c.os}
                canManage={canManageAgents}
                toast={toast}
              />
              <p className="mt-2 text-center text-[10px] text-slate-400">{c.support}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Cloud agents — the SAME collector, run on a cloud VM. Cloud hosts are
          Linux, so these install the Linux agent (os="linux"); the only thing
          that differs per provider is WHERE you run the one-liner. Labelled by
          provider via enrollName so each shows up as "aws agent" etc. */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Cloud</h2>
          <span className="text-xs text-slate-500">— run the agent on a cloud instance; it inventories that VM like any host.</span>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {([
            { key: 'aws', title: 'AWS', meta: 'EC2 · Amazon Linux / Ubuntu', enrollName: 'aws agent',
              hint: 'Run on an EC2 instance, or paste into the instance User data (runs at first boot).' },
            { key: 'azure', title: 'Microsoft Azure', meta: 'Azure VM · Linux', enrollName: 'azure agent',
              hint: 'Run on an Azure VM, or add it as a Custom Script Extension.' },
            { key: 'digitalocean', title: 'DigitalOcean', meta: 'Droplet · Linux', enrollName: 'digitalocean agent',
              hint: 'Run on your Droplet, or paste into the Droplet User data (cloud-init).' },
            { key: 'gcp', title: 'Google Cloud', meta: 'Compute Engine · Linux', enrollName: 'gcp agent',
              hint: 'Run on a Compute Engine VM, or set it as a startup-script.' },
          ]).map((c) => (
            <div
              key={c.key}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-primary-300 hover:shadow"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-50 text-2xl">☁️</div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{c.title}</div>
                  <div className="text-[11px] text-slate-500">{c.meta}</div>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-600">{c.hint}</p>
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-800">
                Run on the cloud VM as root (sudo).
              </p>
              <div className="mt-auto pt-4">
                <InstallAgent os="linux" enrollName={c.enrollName} canManage={canManageAgents} toast={toast} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Installed agents */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Installed agents
            {agents.length > 0 && (
              <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{agents.length}</span>
            )}
          </h2>
          <button
            onClick={() => q.refetch()}
            className="inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-primary-700"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
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
            <tbody className="divide-y divide-slate-100">
              {agents.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="mx-auto max-w-sm">
                      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-2xl">🤖</div>
                      <div className="text-sm font-medium text-slate-900">No agents installed yet</div>
                      <p className="mt-1 text-xs text-slate-500">
                        Download an installer above and run it on a host. It appears here within a
                        minute of enrolling, then inventories and scans on schedule.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              {agents.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{a.agent_name}</div>
                    {a.agent_version && (
                      <div className="text-[10px] text-slate-500">v{a.agent_version}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700 capitalize">{a.mode}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {a.hostname || <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700 capitalize">{a.os_family || '—'}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const eff = effectiveStatus(a);
                      const isStale = eff === 'stale' && a.status === 'active';
                      return (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase ${STATUS_COLORS[eff] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}
                          title={isStale ? 'Heartbeat not received in 5+ minutes' : undefined}
                        >
                          {eff}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{fmtAgo(a.last_heartbeat_at)}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{fmtAgo(a.last_result_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {a.status === 'revoked' ? (
                      <span className="text-xs text-slate-400">revoked</span>
                    ) : (
                      <button
                        onClick={() => { setRevokeTarget(a); setRevokeReason(''); }}
                        className="text-xs text-rose-600 hover:underline"
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
            <h3 className="text-lg font-semibold text-slate-900 mb-1">Revoke agent?</h3>
            <p className="text-sm text-slate-600 mb-4">
              <strong>{revokeTarget.agent_name}</strong>'s next heartbeat will be
              rejected and it will lose access to the backend. Asset records remain
              intact; only the agent's push capability is killed.
            </p>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Reason (optional)
            </label>
            <textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="e.g. Replaced by new build, host decommissioned…"
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => { setRevokeTarget(null); setRevokeReason(''); }}
                className="px-4 py-1.5 text-sm border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => revokeMut.mutate({ id: revokeTarget.id, reason: revokeReason })}
                disabled={revokeMut.isPending}
                className="px-4 py-1.5 text-sm bg-rose-600 text-white rounded-md hover:bg-rose-700 disabled:opacity-50"
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

// ─── InstallAgent ─────────────────────────────────────────────────────────
// Mints a one-time enrollment token and shows a COPY-PASTE install command the
// operator runs in an elevated terminal on the target host — the way real
// endpoint agents (Datadog/Wazuh/CrowdStrike) install. This avoids the dead-end
// of downloading a .ps1/.sh that the OS then asks "which app should open this?".
// The backend bakes the tenant (?tenant_slug) into the command so it works even
// though the target host has no browser session.
function InstallAgent({
  os, canManage, toast, enrollName,
}: {
  os: 'windows' | 'linux' | 'macos';
  canManage: boolean;
  toast: ReturnType<typeof useToast>;
  // Overrides the auto name ("linux agent"). Cloud cards pass "aws agent" etc.
  // so a cloud VM's agent is labelled by provider even though its OS is Linux.
  enrollName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [cmd, setCmd] = useState<string | null>(null);
  // Optional AD-domain lock: when set, the backend refuses enrollment of any PC
  // not joined to this domain — a leaked install command can't onboard an
  // outside/home machine (it reports WORKGROUP or a different domain).
  const [domain, setDomain] = useState('');
  // Where the agent phones home. Public = the host this console is on (testing,
  // reachable anywhere). Private = the production VPN/internal address the server
  // advertises via AVA_AGENT_PRIVATE_URL (agents on the client network, not the
  // public internet). Defaults to public until the cutover.
  const [reach, setReach] = useState<'public' | 'private'>('public');
  const runner = os === 'windows' ? 'an elevated PowerShell' : 'a terminal as root (sudo)';

  const copyText = async (text: string) => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch { /* insecure context or denied — fall through to execCommand */ }
    if (!ok) {
      // On plain HTTP the Clipboard API is unavailable; use the legacy path so
      // Copy still works until the app is behind HTTPS.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    toast.toast(ok
      ? { title: 'Command copied', message: `Paste it into ${runner} on the machine you want to add.`, type: 'success' }
      : { title: 'Press Ctrl/Cmd+C', message: 'The command is highlighted below — copy it.', type: 'info' });
  };

  const generate = async () => {
    if (!canManage) {
      toast.toast({
        title: 'Permission required',
        message: 'You need the "compliance:agents:manage" permission to install an agent.',
        type: 'warning',
      });
      return;
    }
    setBusy(true);
    try {
      // Mint a one-time token; the backend returns the full install command with
      // the cloud URL + tenant + token baked in (one command per OS family).
      const enr = await agentsApi.enroll({ agent_name: enrollName ?? `${os} agent`, os_family: os, allowed_domain: domain.trim() || undefined, reachability: reach });
      const data = enr.data as { commands?: Record<string, string> };
      const command = data.commands?.[os];
      if (!command) throw new Error('No install command returned by the server');
      setCmd(command);
      await copyText(command);
    } catch (e: unknown) {
      // Prefer the server's reason (e.g. "Private agent reachability is not configured").
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      const msg = detail || (e instanceof Error ? e.message : 'Unknown error');
      toast.toast({ title: 'Could not prepare installer', message: msg, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (!cmd) {
    return (
      <div className="space-y-1.5">
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="Lock to AD domain (e.g. bank.local) — optional"
          title="Only machines joined to this domain can enrol with this command. Leave blank to allow any machine."
          className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none"
        />
        {/* Reachability: the address baked into the install command the agent
            phones home to. Public for testing; Private for production (server
            must have AVA_AGENT_PRIVATE_URL set to the VPN/internal address). */}
        <div className="flex items-center gap-1 rounded-md border border-slate-200 p-0.5">
          {(['public', 'private'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReach(r)}
              title={r === 'public'
                ? 'Agent reaches the server on this console’s address — works from anywhere. Use for testing.'
                : 'Agent reaches the server on the production VPN / internal address (AVA_AGENT_PRIVATE_URL). Use in production.'}
              className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition ${
                reach === r ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {r === 'public' ? 'Public (testing)' : 'Private (production)'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {busy ? 'Preparing…' : 'Get install command'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-1 text-[11px] text-slate-600">
        <li><span className="font-semibold text-slate-800">1.</span> Copy the command below.</li>
        <li><span className="font-semibold text-slate-800">2.</span> On the machine you want to add, open {runner}.</li>
        <li><span className="font-semibold text-slate-800">3.</span> Paste it, press Enter — the agent installs, enrols &amp; reports.</li>
      </ol>
      <div className="flex items-stretch gap-1.5">
        <code
          onClick={(e) => {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(e.currentTarget);
            sel?.removeAllRanges();
            sel?.addRange(range);
          }}
          title="Click to select the whole command"
          className="flex-1 cursor-text select-all overflow-x-auto whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-2 font-mono text-[10px] leading-5 text-slate-100"
        >
          {cmd}
        </code>
        <button
          type="button"
          onClick={() => copyText(cmd)}
          title="Copy command"
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary-600 px-2.5 text-xs font-medium text-white transition hover:bg-primary-700"
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
      </div>
      <p className="text-[10px] text-slate-400">
        One-time token, expires in 24h. ·{' '}
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="underline-offset-2 hover:text-primary-700 hover:underline disabled:opacity-50"
        >
          {busy ? 'Regenerating…' : 'New command'}
        </button>
      </p>
    </div>
  );
}
