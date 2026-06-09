'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';

type Platform =
  | 'windows' | 'linux'
  | 'cisco'
  | 'oracle' | 'mssql' | 'postgres' | 'mysql'
  | 'ad'
  | 'aws' | 'digitalocean' | 'azure' | 'k8s';
type ConnectMode = 'installer' | 'manual';

type IssueTokenResp = {
  token: string;
  nonce: string;
  expires_in: number;
  script_url: string;
};

type StatusResp = {
  state: 'pending' | 'ready';
  hostname?: string;
  os_name?: string;
  connection_id?: number;
  asset_id?: number;
};

const PLATFORMS: Array<{ id: Platform; label: string; logo: string; subtitle: string }> = [
  { id: 'windows',      label: 'Windows Server',          logo: '🪟', subtitle: 'WinRM over HTTPS — read-only audit account' },
  { id: 'linux',        label: 'Linux Server',            logo: '🐧', subtitle: 'SSH key-based access — read-only audit user' },
  { id: 'cisco',        label: 'Cisco / Network device',  logo: '📡', subtitle: 'SSH port 22 — read-only enable account on the router' },
  { id: 'oracle',       label: 'Oracle Database',         logo: '🔶', subtitle: 'TNS 1521 — read-only DB user for CIS Oracle audit' },
  { id: 'mssql',        label: 'Microsoft SQL Server',    logo: '🟦', subtitle: 'TDS 1433 — read-only login. CIS MSSQL Benchmark.' },
  { id: 'postgres',     label: 'PostgreSQL',              logo: '🐘', subtitle: 'libpq 5432 — read-only user. CIS PostgreSQL Benchmark.' },
  { id: 'mysql',        label: 'MySQL / MariaDB',         logo: '🐬', subtitle: 'MySQL 3306 — read-only user. CIS MySQL Benchmark.' },
  { id: 'ad',           label: 'Active Directory / LDAP', logo: '🗂️', subtitle: 'Bind once — bulk-discover every domain-joined computer + onboard with shared creds.' },
  { id: 'aws',          label: 'AWS Account',             logo: '☁️', subtitle: 'IAM read-only access key' },
  { id: 'digitalocean', label: 'DigitalOcean',            logo: '🌊', subtitle: 'Droplet IP + SSH credentials, or API token' },
  { id: 'azure',        label: 'Azure subscription',      logo: '🟦', subtitle: 'Service principal with Reader role + Entra ID.' },
  { id: 'k8s',          label: 'Kubernetes cluster',      logo: '☸️', subtitle: 'Any K8s 1.24+ — kubeconfig or server+token.' },
];

// Categorisation matches the package layout. Each group's hint explains
// when this scan path is the right choice versus the endpoint-agent
// alternative on /admin/agents.
const PLATFORM_GROUPS: Array<{ key: string; title: string; hint: string; ids: Platform[] }> = [
  {
    key: 'hosts',
    title: 'Hosts & servers',
    hint:
      "If you can install software on the box, the endpoint agent (see /admin/agents) is usually easier. Use these cards for hosts you can only reach by network — production servers behind NAT, or boxes the AD service account already has WinRM/SSH on.",
    ids: ['windows', 'linux'],
  },
  {
    key: 'network',
    title: 'Network devices',
    hint:
      "Cisco firewalls, switches, routers. No agent can run on these — SSH is the only scan path. Best paired with the collector agent on a Linux relay box (the bank's LAN reaches them, the public internet usually can't).",
    ids: ['cisco'],
  },
  {
    key: 'databases',
    title: 'Databases',
    hint:
      "Read-only audit user on each engine. Same pattern as the connect-wizard for hosts — one credential per engine type, but one credential row can scope to many DB instances.",
    ids: ['oracle', 'mssql', 'postgres', 'mysql'],
  },
  {
    key: 'identity',
    title: 'Identity',
    hint:
      "Active Directory / LDAP read-only bind. Used by the CIS AD benchmark and by other modules to enumerate group membership.",
    ids: ['ad'],
  },
  {
    key: 'cloud',
    title: 'Cloud accounts',
    hint:
      "Public-internet provider APIs, no on-prem reachability concern. Cloud agentless (this page) is the only sensible path — no agent goes on an AWS account.",
    ids: ['aws', 'digitalocean', 'azure', 'k8s'],
  },
];

// Default port per platform — used by the manual-creds form so the
// operator doesn't have to type the well-known value. Port input is
// hidden from the UI; the backend receives the correct port baked into
// winrm_endpoint / ssh_endpoint. Operators with a non-standard port
// edit the connection in /integrations/connections after creation.
const DEFAULT_PORTS: Record<Platform, string> = {
  windows: '5986',
  linux: '22',
  cisco: '22',
  oracle: '1521',
  mssql: '1433',
  postgres: '5432',
  mysql: '3306',
  ad: '636',
  aws: '443',
  digitalocean: '22',
  azure: '443',
  k8s: '443',
};

export default function ConnectWizardPage() {
  const router = useRouter();
  const navigate = (path: string) => router.push(path);
  // Spec: this wizard onboards new infrastructure — must be gated to
  // Tenant Admin / Scanning Admin (both with compliance:agents:manage).
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canConnect = hasPermission('compliance:agents:manage');

  if (!permsLoading && !canConnect) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="max-w-2xl mx-auto px-4 py-16">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-8 text-center">
            <div className="text-5xl mb-3">🔒</div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Connect Wizard is locked</h1>
            <p className="text-sm text-gray-600 mb-4">
              Onboarding new Windows / Linux / AWS targets is restricted to users with the
              {' '}<strong>compliance:agents:manage</strong> permission (Tenant Admin or
              Scanning Admin role). Ask your tenant admin to grant the right role.
            </p>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
            >
              ← Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
  const [picked, setPicked] = useState<Platform | null>(null);
  const [mode, setMode] = useState<ConnectMode>('manual'); // default to manual — enterprise reality
  const [issuing, setIssuing] = useState(false);
  const [tokenData, setTokenData] = useState<IssueTokenResp | null>(null);
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pre-fill state read from URL params. When the operator clicks
  // "Connect" on an asset row in /assets, we navigate here with
  // ?asset_id=N&hostname=H&platform=windows so the form opens with
  // hostname already typed in — the operator only enters username +
  // password. The /assets list page does the asset→platform translation
  // from os_family so the URL is self-contained.
  const [prefillHostname, setPrefillHostname] = useState<string>('');
  const [prefillAssetId, setPrefillAssetId] = useState<number | null>(null);
  // Bulk-connect — set when /assets sends `?asset_ids=1,2,3`. Holds the
  // list of asset rows we'll iterate handshake against after the
  // operator enters credentials once.
  const [bulkAssetIds, setBulkAssetIds] = useState<number[]>([]);

  // Read ?asset_id / ?hostname / ?platform / ?asset_ids from URL on mount
  // and auto-advance into the manual creds form. Safe: invalid platform
  // values are ignored, missing hostname falls through to the picker.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get('platform') as Platform | null;
    const host = sp.get('hostname');
    const aid = sp.get('asset_id');
    const aidsCsv = sp.get('asset_ids');
    if (host) setPrefillHostname(host);
    if (aid && !Number.isNaN(Number(aid))) setPrefillAssetId(Number(aid));
    if (aidsCsv) {
      const ids = aidsCsv.split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n) && n > 0);
      if (ids.length > 0) setBulkAssetIds(ids);
    }
    const valid = ['windows', 'linux', 'cisco', 'oracle', 'mssql', 'postgres',
                   'mysql', 'ad', 'aws', 'digitalocean', 'azure', 'k8s'] as const;
    if (p && (valid as readonly string[]).includes(p) && !picked) {
      // Defer to next tick so the empty-state UI doesn't flash first.
      void startWizard(p as Platform);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once we have a nonce, poll status every 3s
  useEffect(() => {
    if (!tokenData?.nonce) return;
    const tick = async () => {
      try {
        const r = await apiClient.get(`/connect-wizard/status/${tokenData.nonce}`);
        setStatus(r.data as StatusResp);
        if ((r.data as StatusResp).state === 'ready') {
          return true;
        }
      } catch (e) {
        // ignore transient
      }
      return false;
    };
    let stop = false;
    const loop = async () => {
      while (!stop) {
        const done = await tick();
        if (done) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    };
    loop();
    return () => { stop = true; };
  }, [tokenData?.nonce]);

  async function startWizard(p: Platform) {
    // AD / LDAP has its own credential-driven discovery flow (no per-host
    // token needed — the bind enumerates the whole domain). Route there
    // instead of the standard handshake path.
    if (p === 'ad') {
      router.push('/admin/integrations/connect/ad-discover');
      return;
    }
    setPicked(p);
    setError(null);
    setIssuing(true);
    try {
      const r = await apiClient.post('/connect-wizard/issue-token', { platform: p });
      setTokenData(r.data as IssueTokenResp);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to start wizard');
    } finally {
      setIssuing(false);
    }
  }

  const oneLiner = useMemo(() => {
    if (!tokenData) return '';
    // Build the backend URL the operator's target host will download from.
    // Priority: NEXT_PUBLIC_BACKEND_URL (the explicit deploy-time public URL,
    // set in .env / staging .env.production) → window origin (works in
    // single-port deployments where backend and frontend share a hostname).
    // The legacy ":5000" port swap was a dev-only convenience that broke
    // every deployment using a different backend port — drop it entirely.
    const envBackend = process.env.NEXT_PUBLIC_BACKEND_URL;
    const base = (envBackend && envBackend.replace(/\/$/, '')) || window.location.origin;
    // script_url already includes "/grc/connect-wizard/..." from backend
    const url = `${base}${tokenData.script_url}`;
    if (picked === 'windows') {
      return `iwr ${url} -UseBasicParsing | Select-Object -ExpandProperty Content | iex`;
    }
    if (picked === 'linux') {
      return `curl -fsSL ${url} | sudo bash`;
    }
    return url;
  }, [tokenData, picked]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(oneLiner);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {/* clipboard blocked */}
  };

  // Once ready, push them to dashboard after a short celebration
  useEffect(() => {
    if (status?.state === 'ready') {
      const t = setTimeout(() => navigate('/dashboard'), 4000);
      return () => clearTimeout(t);
    }
  }, [status?.state, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Connect your first server</h1>
          <p className="text-gray-600">
            Compliverse needs at least one connected server to scan against. Pick a platform — we&apos;ll generate a one-liner that sets up everything for you.
          </p>
        </div>

        {!tokenData && (
          <>
            {/* Quick-start callout — explain the one-device-at-a-time flow.
                Each connection authenticates with a username + password
                stored encrypted at rest. Operators with 100+ assets work
                through the IT Assets list one row at a time. */}
            <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">🔑</span>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-slate-900">One device at a time</h3>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                    Each connection pairs ONE credential (username + password) with ONE target host. Compliverse encrypts the password with your tenant's Fernet key and only uses it at scan time.
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    <strong>Got assets in IT Assets already?</strong>{' '}
                    Skip this picker — go to{' '}
                    <a href="/assets" className="underline font-semibold text-blue-700 hover:text-blue-800">
                      IT Assets
                    </a>{' '}
                    and click the <strong>Connect</strong> button on the asset row. The wizard opens with the hostname pre-filled — you only enter username + password.
                  </p>
                </div>
              </div>
            </div>

            {/* Grouped platform picker — match Hassan's reference layout. */}
            {PLATFORM_GROUPS.map((g) => {
              const lookup = new Map(PLATFORMS.map((p) => [p.id, p]));
              return (
                <div key={g.key} className="mb-6">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                      {g.title}
                    </h2>
                  </div>
                  <p className="mb-3 text-xs leading-relaxed text-slate-500">
                    {g.hint}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {g.ids.map((id) => {
                      const p = lookup.get(id);
                      if (!p) return null;
                      return (
                        <button
                          key={p.id}
                          onClick={() => startWizard(p.id)}
                          disabled={issuing}
                          className={`group p-6 rounded-xl border-2 transition-all text-left cursor-pointer ${
                            picked === p.id
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-md'
                          }`}
                        >
                          <div className="text-4xl mb-2">{p.logo}</div>
                          <div className="font-semibold text-gray-900 mb-1">{p.label}</div>
                          <div className="text-xs text-gray-600">{p.subtitle}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">
                {error}
              </div>
            )}

            <div className="text-center">
              <button
                onClick={() => navigate('/dashboard')}
                className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
              >
                Skip for now — I'll connect later
              </button>
            </div>
          </>
        )}

        {/* The installer-script mode (one-liner PowerShell that the IT team
            paste into the target Windows server) was removed per operator
            feedback. The Manual Credentials path covers every onboarding
            scenario without asking the customer to run arbitrary code, and
            the wizard's live pre-flight catches bad creds before save. */}

        {tokenData && status?.state !== 'ready' && picked === 'aws' && (
          <AwsForm token={tokenData.token} onCancel={() => { setTokenData(null); setPicked(null); setStatus(null); }} />
        )}

        {/* Bulk-connect form — entered from /assets when the operator
            ticks N rows and clicks "Connect N selected". Same backend
            handshake endpoint, just iterated per asset with progress. */}
        {tokenData && status?.state !== 'ready' && picked && bulkAssetIds.length > 0 && (picked === 'windows' || picked === 'linux' || picked === 'digitalocean') && (
          <BulkCredsForm
            platform={picked}
            token={tokenData.token}
            assetIds={bulkAssetIds}
            onCancel={() => { setTokenData(null); setPicked(null); setStatus(null); setBulkAssetIds([]); }}
          />
        )}

        {tokenData && status?.state !== 'ready' && picked && bulkAssetIds.length === 0 && (picked === 'windows' || picked === 'linux' || picked === 'digitalocean') && (
          <ManualCredsForm
            platform={picked}
            token={tokenData.token}
            initialHostname={prefillHostname}
            assetId={prefillAssetId}
            onCancel={() => { setTokenData(null); setPicked(null); setStatus(null); }}
          />
        )}

        {/* Platforms whose full credential schema isn't shipped yet show
            a preview card so the operator knows what to expect. Each one
            has a backend runner ready (extended_runners.py), they just
            need a per-platform form (TNS hostname, MSSQL instance, AD
            base DN, AWS access key, etc.). Track in the deferred Phase 2
            of the CIS Module Updated drop. */}
        {tokenData && status?.state !== 'ready' && picked && !['windows', 'linux', 'digitalocean'].includes(picked) && (
          <div className="bg-white rounded-xl shadow-md p-8 border border-amber-200 max-w-3xl mx-auto text-center">
            <div className="text-5xl mb-3">🚧</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {PLATFORMS.find(p => p.id === picked)?.label} wizard coming soon
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              The backend runner for this platform is ready. The per-platform credential form
              (e.g. {picked === 'oracle' ? 'TNS service name + DB user' :
                picked === 'mssql' ? 'MSSQL instance + login' :
                picked === 'postgres' ? 'database + connection URI' :
                picked === 'mysql' ? 'MySQL host + username' :
                picked === 'cisco' ? 'enable secret + SSH user' :
                picked === 'ad' ? 'bind DN + base DN' :
                picked === 'aws' ? 'access key + secret + region' :
                picked === 'azure' ? 'tenant_id + client_id + secret' :
                picked === 'k8s' ? 'kubeconfig file or server + token' :
                'platform-specific credentials'}) is in the next drop.
            </p>
            <p className="text-xs text-slate-500 mb-4">
              In the meantime, you can create the connection manually via the
              {' '}<a href="/integrations/connections" className="underline">Integrations → Connections</a> page —
              the same backend endpoint accepts a fully-specified payload.
            </p>
            <button
              onClick={() => { setTokenData(null); setPicked(null); setStatus(null); }}
              className="text-sm text-blue-600 hover:underline"
            >
              ← Pick a different platform
            </button>
          </div>
        )}

        {status?.state === 'ready' && (
          <div className="bg-white rounded-xl shadow-md p-8 border-2 border-green-300 text-center">
            <div className="text-5xl mb-3">✅</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Connected!</h2>
            <p className="text-gray-600 mb-4">
              <strong className="text-gray-900">{status.hostname}</strong> is now ready to scan.
            </p>
            {status.os_name && (
              <p className="text-sm text-gray-500 mb-4">Detected OS: {status.os_name}</p>
            )}
            <div className="text-xs text-gray-400">
              Taking you to your dashboard in a moment…
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              className="mt-5 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Go to dashboard now →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Manual credentials form ─────────────────────────────────────────────────
// Used when the customer's IT team has ALREADY provisioned a service account
// on the target machine. Customer just enters IP/hostname + creds and we
// store the connection. No installer needed.
//
// Works for Windows (WinRM 5986), Linux SSH (22), DigitalOcean droplets (22),
// routers/firewalls/appliances where running our script is impossible.
function ManualCredsForm({
  platform,
  token,
  onCancel,
  initialHostname = '',
  assetId = null,
}: {
  platform: 'windows' | 'linux' | 'digitalocean';
  token: string;
  onCancel: () => void;
  /** Pre-fill the hostname field. Used when the operator clicks
   *  "Connect" on an asset row — the asset's host_name is passed in
   *  via URL so they only enter username + password. */
  initialHostname?: string;
  /** Asset row to associate with the resulting connection. */
  assetId?: number | null;
}) {
  // Port is auto-selected based on platform (DEFAULT_PORTS lookup).
  // No longer exposed as a UI field — the operator should not have to
  // know that WinRM HTTPS is 5986 or SSH is 22. Custom ports for the
  // rare non-standard deployment are still supported via PUT on the
  // connection record after creation (/integrations/connections page).
  const port = DEFAULT_PORTS[platform];
  const userHint = platform === 'windows'
    ? 'Service account on the Windows server (e.g., compliverse_scanner)'
    : 'Linux user with read-only audit rights (e.g., compliverse_scanner)';
  const [hostname, setHostname] = useState(initialHostname);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const platformLabel = platform === 'windows' ? 'Windows Server' : platform === 'digitalocean' ? 'DigitalOcean Droplet' : 'Linux Server';
  const logo = platform === 'windows' ? '🪟' : platform === 'digitalocean' ? '🌊' : '🐧';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // The handshake endpoint signs with the tenant_token. We pass the
      // operator-provided host/user/password so the backend stores them
      // exactly as the IT team prepared.
      //
      // Trim every string before sending — pasting from a CSV / using Tab
      // to navigate fields can leave behind a trailing tab or whitespace
      // that Windows/Linux auth rejects as "credentials wrong". Backend
      // also strips defensively, but trimming here gives an immediate
      // signal to the operator (the form keeps the cleaned value too).
      const cleanHost = (hostname || '').trim();
      const cleanLabel = (label || '').trim();
      const cleanUser = (username || '').trim();
      const cleanPwd = (password || '').trim();
      const r = await apiClient.post('/connect-wizard/handshake', {
        tenant_token: token,
        hostname: cleanHost,
        display_label: cleanLabel || cleanHost,
        os_name: platformLabel,
        winrm_endpoint: platform === 'windows' ? `https://${cleanHost}:${port}/wsman` : null,
        ssh_endpoint: platform !== 'windows' ? `ssh://${cleanHost}:${port}` : null,
        service_account: cleanUser,
        agent_password: cleanPwd,
        // When the wizard was opened from an asset row's "Connect"
        // button, carry the asset_id so the backend can directly bind
        // the resulting connection to that asset row (instead of the
        // fallback host_name match, which breaks for IP-vs-FQDN typos).
        asset_id: assetId ?? undefined,
      });
      if (r.status >= 200 && r.status < 300) {
        setSuccess(true);
      }
    } catch (e: any) {
      // The wizard handshake returns a structured pre-flight error when
      // it can prove the credentials are bad. Render the hint so the
      // operator knows EXACTLY what to fix before retrying — no more
      // "saved as connected but every scan fails" surprise.
      const d = e?.response?.data?.detail;
      if (d && typeof d === 'object' && d.preflight_failed) {
        const code = d.code || 'unknown';
        const codeLabel: Record<string, string> = {
          auth_failed: 'Authentication rejected',
          network_unreachable: 'Cannot reach target host',
          ssl_error: 'TLS handshake failed',
          config_error: 'Configuration incomplete',
          unknown: 'Pre-flight error',
        };
        setError(
          `${codeLabel[code] || 'Pre-flight error'} — ${d.message}\n\nWhat to do: ${d.hint}`
        );
      } else if (typeof d === 'string') {
        setError(d);
      } else {
        setError(e?.message || 'Failed to register server');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="bg-white rounded-xl shadow-md p-8 border-2 border-green-300 text-center">
        <div className="text-5xl mb-3">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Connected!</h2>
        <p className="text-gray-600 mb-4">
          <strong className="text-gray-900">{hostname}</strong> is now ready to scan.
        </p>
        <button
          onClick={() => window.location.href = '/dashboard'}
          className="mt-3 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Go to dashboard →
        </button>
      </div>
    );
  }

  // Field input class shared across all rows for visual consistency.
  const inputCls =
    "block w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 " +
    "placeholder:text-slate-400 shadow-sm transition " +
    "focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";

  return (
    <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
      {/* Header strip — platform icon + breadcrumb */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-700 px-6 py-5 flex items-center gap-4 text-white">
        <div className="w-12 h-12 rounded-lg bg-white/10 backdrop-blur flex items-center justify-center text-2xl">
          {logo}
        </div>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wide text-slate-300 mb-0.5">Connect Wizard · Step 2 of 2</div>
          <h2 className="text-lg font-semibold leading-tight">{platformLabel} — Manual Credentials</h2>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          End-to-end encrypted
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-6">
        {assetId && initialHostname && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            <span className="text-base">🔗</span>
            <div>
              <span className="font-semibold">Connecting to asset #{assetId}</span> ·
              {' '}hostname pre-filled from your IT Assets entry.
              {' '}Just enter the username + password and click Connect.
            </div>
          </div>
        )}
        <p className="text-sm text-slate-600 mb-5 leading-relaxed">
          Your IT team has already provisioned a read-only service account on the target host.
          Paste its connection details below — we&apos;ll run a live pre-flight check before saving anything,
          so you&apos;ll know immediately if something is wrong.
        </p>

        <form onSubmit={submit} className="space-y-6">
          {/* Section 1 — Connection details */}
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">1</span>
              Connection details
            </legend>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">Friendly label</span>
                  <span className="text-xs text-slate-400">Shown in your asset list</span>
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Production Web Server · DC-01 · App-Tier-Node-3"
                  required
                  className={inputCls}
                />
              </div>

              <div>
                <div>
                  <label className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-slate-700">Hostname or IP address</span>
                    <span className="text-xs text-slate-400">FQDN preferred — we auto-probe the port</span>
                  </label>
                  <input
                    type="text"
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    placeholder={platform === 'windows' ? 'win-srv01.company.com   or   10.0.0.5' : 'host.company.com   or   203.0.113.42'}
                    required
                    className={inputCls + " font-mono"}
                  />
                </div>
              </div>
              {/* Port input intentionally removed — auto-selected via
                  DEFAULT_PORTS lookup. The "Advanced: custom port"
                  affordance moved to the post-creation edit page on
                  /integrations/connections (rare case, doesn't belong in
                  the first-onboard flow). */}
              <p className="text-xs text-slate-500 -mt-2 flex items-start gap-1.5">
                <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                We auto-probe the standard {platform === 'windows' ? 'WinRM HTTPS (5986)' : 'SSH (22)'} port.
                Edit the connection later on the Integrations page if your server uses a custom port.
              </p>
            </div>
          </fieldset>

          {/* Section 2 — Authentication */}
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">2</span>
              Authentication (read-only service account)
            </legend>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">Username</span>
                  <span className="text-xs text-slate-400">Service account name</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={platform === 'windows' ? 'compliverse_scanner' : 'audit_readonly'}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  className={inputCls + " font-mono"}
                />
                <p className="mt-1.5 text-xs text-slate-500">{userHint}</p>
              </div>

              <div>
                <label className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">Password</span>
                  <span className="text-xs text-emerald-700 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                    Fernet-encrypted at rest
                  </span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Paste the service-account password"
                  required
                  autoComplete="new-password"
                  className={inputCls + " font-mono tracking-wider"}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Encrypted with your tenant&apos;s per-tenant key. Never logged, never echoed back, only used at scan time.
                </p>
              </div>
            </div>
          </fieldset>

          {/* Live pre-flight notice */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-start gap-3">
            <svg className="w-5 h-5 text-slate-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <div className="text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-900">Live pre-flight check.</strong> When you click <em>Connect server</em>, we open a real
              {' '}{platform === 'windows' ? 'WinRM' : 'SSH'} session and run a single read-only <code className="px-1 py-0.5 bg-slate-200 rounded text-[10px]">whoami</code> against the target.
              If it fails (wrong password, host unreachable, port blocked), we tell you exactly what — <strong>no broken connection is saved.</strong>
            </div>
          </div>

          {/* Inline error */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 whitespace-pre-line">{error}</div>
          )}

          {/* Action bar */}
          <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 text-sm font-medium text-slate-700 rounded-md border border-slate-300 hover:bg-slate-50 transition"
            >
              ← Back to platform pick
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                    <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Running pre-flight…
                </>
              ) : (
                <>
                  Connect server
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── AWS credential form ─────────────────────────────────────────────────────
// AWS doesn't need an installer script — customer just needs to create an IAM
// user with ReadOnlyAccess policy, then paste the access key here. We POST
// directly to the handshake endpoint with those credentials.
function AwsForm({ token, onCancel }: { token: string; onCancel: () => void }) {
  const [accountName, setAccountName] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Trim every input — IAM access keys pasted from the AWS console
      // sometimes carry a trailing newline (single-line input that wraps
      // in the browser), and the backend pre-flight rejects them as
      // "auth_failed" with no clue what's wrong. Trim defensively.
      const cleanName = (accountName || '').trim();
      const cleanRegion = (region || '').trim() || 'us-east-1';
      const cleanAccessKey = (accessKey || '').trim();
      const cleanSecretKey = (secretKey || '').trim();
      const r = await apiClient.post('/connect-wizard/handshake', {
        tenant_token: token,
        hostname: cleanName || `aws-${cleanRegion}`,
        os_name: `AWS Account · ${cleanRegion}`,
        service_account: cleanAccessKey,
        agent_password: cleanSecretKey,
      });
      if (r.status >= 200 && r.status < 300) {
        setSuccess(true);
      }
    } catch (e: any) {
      // Same structured pre-flight error format as the WinRM/SSH form —
      // surface the hint so the operator knows exactly what to fix.
      const d = e?.response?.data?.detail;
      if (d && typeof d === 'object' && d.preflight_failed) {
        const code = d.code || 'unknown';
        const codeLabel: Record<string, string> = {
          auth_failed: 'AWS rejected credentials',
          network_unreachable: 'Cannot reach AWS STS',
          config_error: 'Configuration incomplete',
          unknown: 'Pre-flight error',
        };
        setError(`${codeLabel[code] || 'Pre-flight error'} — ${d.message}\n\nWhat to do: ${d.hint}`);
      } else if (typeof d === 'string') {
        setError(d);
      } else {
        setError(e?.message || 'Failed to register AWS account');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="bg-white rounded-xl shadow-md p-8 border-2 border-green-300 text-center">
        <div className="text-5xl mb-3">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">AWS Account Connected!</h2>
        <p className="text-gray-600 mb-4">Compliverse can now run read-only CIS AWS Foundations scans against this account.</p>
        <div className="text-xs text-gray-400">Reloading…</div>
        <button
          onClick={() => window.location.href = '/dashboard'}
          className="mt-5 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Go to dashboard →
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-3xl">☁️</span>
        <div>
          <h2 className="font-semibold text-gray-900">Connect AWS Account</h2>
          <p className="text-xs text-gray-600">
            Paste an IAM <strong>ReadOnlyAccess</strong> key. Compliverse never modifies your AWS — only reads config for scanning.
          </p>
        </div>
      </div>

      <details className="mb-4 text-xs text-gray-600 bg-blue-50 rounded-lg p-3 border border-blue-200">
        <summary className="cursor-pointer font-medium text-blue-900">
          How to create a read-only IAM key (2 minutes)
        </summary>
        <ol className="list-decimal ml-5 mt-2 space-y-1">
          <li>Sign in to AWS Console → IAM → Users → <strong>Create user</strong></li>
          <li>Username: <code className="bg-white px-1 rounded">compliverse-scanner</code></li>
          <li>Attach policies directly: <code className="bg-white px-1 rounded">ReadOnlyAccess</code> + <code className="bg-white px-1 rounded">SecurityAudit</code></li>
          <li>After creation → Security credentials → <strong>Create access key</strong> → Use case: "Application running outside AWS"</li>
          <li>Copy the Access Key ID and Secret Access Key, paste below</li>
        </ol>
      </details>

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Account label</label>
          <input
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Production AWS"
            required
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Region</label>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {['us-east-1','us-east-2','us-west-1','us-west-2','eu-west-1','eu-central-1','ap-south-1','ap-southeast-1','ap-northeast-1','me-south-1','me-central-1'].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Access Key ID</label>
          <input
            type="text"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            placeholder="AKIAIOSFODNN7EXAMPLE"
            required
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Secret Access Key</label>
          <input
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="••••••••••••••••••••••••••••••••••••••••"
            required
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[10px] text-gray-500">
            Encrypted at rest with your tenant's per-tenant key. Never logged or echoed back.
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700">{error}</div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-700 rounded-lg border border-gray-300 hover:bg-gray-50"
          >
            ← Back
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Registering…' : 'Connect AWS Account'}
          </button>
        </div>
      </form>
    </div>
  );
}


// ─── BulkCredsForm ─────────────────────────────────────────────────────
// Operator selected N assets on /assets and clicked "Connect N selected".
// They enter shared credentials ONCE; we iterate handshake per asset and
// show live progress. Failures don't abort the batch — each asset gets
// its own success/error row so the operator can fix problem hosts after.
function BulkCredsForm({
  platform,
  token,
  assetIds,
  onCancel,
}: {
  platform: 'windows' | 'linux' | 'digitalocean';
  token: string;
  assetIds: number[];
  onCancel: () => void;
}) {
  const port = DEFAULT_PORTS[platform];
  const platformLabel = platform === 'windows' ? 'Windows Server' : platform === 'digitalocean' ? 'DigitalOcean Droplet' : 'Linux Server';

  type AssetRow = { id: number; name: string; host_name: string | null };
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [running, setRunning] = useState(false);
  // Per-asset result: { id → 'pending'|'running'|'ok'|'error', error: msg }
  const [results, setResults] = useState<Record<number, { status: 'pending' | 'running' | 'ok' | 'error'; message?: string }>>(
    {}
  );

  // Fetch the asset rows so we can show name + host_name in the queue
  // and POST the right hostname per handshake.
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const r = await apiClient.get('/assets', { params: { limit: 5000 } });
        const list = (r.data?.assets ?? r.data ?? []) as Array<{ id: number; name: string; host_name: string | null }>;
        if (aborted) return;
        const picked = list.filter((a) => assetIds.includes(a.id));
        setAssets(picked);
        // Seed pending status for all selected
        const seed: Record<number, { status: 'pending' }> = {};
        picked.forEach((a) => { seed[a.id] = { status: 'pending' }; });
        setResults(seed);
      } finally {
        if (!aborted) setLoadingAssets(false);
      }
    })();
    return () => { aborted = true; };
  }, [assetIds]);

  async function runBulk(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setRunning(true);
    const cleanUser = username.trim();
    const cleanPwd = password.trim();
    for (const asset of assets) {
      if (!asset.host_name) {
        setResults((prev) => ({ ...prev, [asset.id]: { status: 'error', message: 'No host_name on this asset.' } }));
        continue;
      }
      setResults((prev) => ({ ...prev, [asset.id]: { status: 'running' } }));
      try {
        const cleanHost = asset.host_name.trim();
        await apiClient.post('/connect-wizard/handshake', {
          tenant_token: token,
          hostname: cleanHost,
          display_label: asset.name || cleanHost,
          os_name: platformLabel,
          winrm_endpoint: platform === 'windows' ? `https://${cleanHost}:${port}/wsman` : null,
          ssh_endpoint: platform !== 'windows' ? `ssh://${cleanHost}:${port}` : null,
          service_account: cleanUser,
          agent_password: cleanPwd,
          asset_id: asset.id,
        });
        setResults((prev) => ({ ...prev, [asset.id]: { status: 'ok' } }));
      } catch (e: any) {
        const d = e?.response?.data?.detail;
        const msg = (d && typeof d === 'object' ? d.message || d.hint : d) || e?.message || 'Handshake failed';
        setResults((prev) => ({ ...prev, [asset.id]: { status: 'error', message: String(msg) } }));
      }
    }
    setRunning(false);
  }

  const okCount = Object.values(results).filter((r) => r.status === 'ok').length;
  const errCount = Object.values(results).filter((r) => r.status === 'error').length;
  const doneCount = okCount + errCount;
  const total = assets.length;

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 max-w-3xl mx-auto">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Bulk connect · {total} {platformLabel.toLowerCase()}{total === 1 ? '' : 's'}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Same credentials applied to every selected asset. We POST handshake one host at a time and show pass / fail below.
        </p>
      </div>

      <div className="px-6 py-6">
        <form onSubmit={runBulk} className="space-y-4 mb-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Username (shared)</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={platform === 'windows' ? 'compliverse_scanner' : 'audit_readonly'}
                disabled={running}
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Password (shared)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                disabled={running}
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-50"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={running}
              className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              ← Cancel
            </button>
            <button
              type="submit"
              disabled={running || loadingAssets || !username || !password}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {running
                ? `Running… ${doneCount} of ${total}`
                : doneCount === total && total > 0
                ? 'Done — review below'
                : `Connect all ${total}`}
            </button>
          </div>
        </form>

        {/* Queue with live status */}
        {loadingAssets ? (
          <div className="text-sm text-slate-500">Loading selected assets…</div>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto rounded-md border border-slate-200 p-2 bg-slate-50">
            {assets.map((a) => {
              const r = results[a.id] || { status: 'pending' };
              const tone =
                r.status === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' :
                r.status === 'error' ? 'border-red-200 bg-red-50 text-red-800' :
                r.status === 'running' ? 'border-blue-200 bg-blue-50 text-blue-800' :
                'border-slate-200 bg-white text-slate-700';
              return (
                <div key={a.id} className={`rounded-md border px-3 py-1.5 text-xs ${tone}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{a.name}</div>
                      <div className="font-mono text-[10px] opacity-70 truncate">
                        {a.host_name || '(no host_name)'}
                      </div>
                    </div>
                    <div className="text-[11px] font-semibold whitespace-nowrap">
                      {r.status === 'pending' ? '…' :
                       r.status === 'running' ? '↻ running' :
                       r.status === 'ok' ? '✓ connected' :
                       '✗ failed'}
                    </div>
                  </div>
                  {r.status === 'error' && r.message && (
                    <div className="mt-1 text-[11px] italic opacity-80 break-words">{r.message}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {doneCount === total && total > 0 && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <strong>Done.</strong>{' '}
            {okCount} connected,{' '}
            {errCount > 0 ? <span className="text-red-700">{errCount} failed</span> : <span>0 failed</span>}.
            {errCount > 0 && ' Hover the ✗ rows for the per-asset error — fix on the target host then click Connect on each failed row individually from /assets.'}
          </div>
        )}
      </div>
    </div>
  );
}
