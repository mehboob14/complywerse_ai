import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { apiClient, compliancePluginsApi } from '@/lib/api';

type Platform =
  | 'windows' | 'linux' | 'aws' | 'digitalocean' | 'cisco' | 'oracle'
  | 'mssql' | 'postgres' | 'mysql' | 'mongodb' | 'ad' | 'azure' | 'k8s';
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
  {
    id: 'windows',
    label: 'Windows Server',
    logo: '🪟',
    subtitle: 'WinRM over HTTPS — read-only audit account',
  },
  {
    id: 'linux',
    label: 'Linux Server',
    logo: '🐧',
    subtitle: 'SSH key-based access — read-only audit user',
  },
  {
    id: 'aws',
    label: 'AWS Account',
    logo: '☁️',
    subtitle: 'IAM read-only access key',
  },
  {
    id: 'digitalocean',
    label: 'DigitalOcean',
    logo: '🌊',
    subtitle: 'Droplet IP + SSH credentials, or API token',
  },
  {
    id: 'cisco',
    label: 'Cisco / Network device',
    logo: '📡',
    subtitle: 'SSH port 22 — read-only enable account on the router',
  },
  {
    id: 'oracle',
    label: 'Oracle Database',
    logo: '🔶',
    subtitle: 'TNS 1521 — read-only DB user for CIS Oracle audit',
  },
  {
    id: 'mssql',
    label: 'Microsoft SQL Server',
    logo: '🟦',
    subtitle: 'TDS 1433 — read-only login. CIS MSSQL Benchmark.',
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    logo: '🐘',
    subtitle: 'libpq 5432 — read-only user. CIS PostgreSQL Benchmark.',
  },
  {
    id: 'mysql',
    label: 'MySQL / MariaDB',
    logo: '🐬',
    subtitle: 'MySQL 3306 — read-only user. CIS MySQL Benchmark.',
  },
  {
    id: 'mongodb',
    label: 'MongoDB',
    logo: '🍃',
    subtitle: 'MongoDB 27017 — read-only user. CIS MongoDB Benchmark.',
  },
  {
    id: 'ad',
    label: 'Active Directory / LDAP',
    logo: '🗂️',
    subtitle: 'LDAP 389 / LDAPS 636 — read-only bind DN.',
  },
  {
    id: 'azure',
    label: 'Azure subscription',
    logo: '🟦',
    subtitle: 'Service principal with Reader role + Entra ID.',
  },
  {
    id: 'k8s',
    label: 'Kubernetes cluster',
    logo: '☸️',
    subtitle: 'Any K8s 1.24+ — kubeconfig or server+token.',
  },
];

export default function ConnectWizardPage() {
  const [, navigate] = useLocation();
  const [picked, setPicked] = useState<Platform | null>(null);
  const [mode, setMode] = useState<ConnectMode>('manual'); // default to manual — enterprise reality
  const [issuing, setIssuing] = useState(false);
  const [tokenData, setTokenData] = useState<IssueTokenResp | null>(null);
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When launched from an app-asset's "Connect" button, this carries the
  // existing asset ID so the wizard links the new credential to it directly
  // instead of auto-creating a new asset, and redirects back after success.
  const [targetAssetId, setTargetAssetId] = useState<number | null>(null);

  // Auto-skip the platform picker when ?platform= is in the URL — this is
  // how the Agents page's "Connect" buttons (and any deep links) launch
  // straight into the manual-creds form for a specific class. Avoids the
  // duplicate "pick a platform" step the operator already made elsewhere.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const p = params.get('platform');
    const aid = params.get('asset_id');
    if (aid) setTargetAssetId(Number(aid));
    if (!p || picked) return;
    const valid = ['windows', 'linux', 'aws', 'digitalocean', 'cisco', 'oracle',
                   'mssql', 'postgres', 'mysql', 'mongodb', 'ad', 'azure', 'k8s'] as const;
    if ((valid as readonly string[]).includes(p)) {
      startWizard(p as Platform);
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
    const base = window.location.origin.replace(/:\d+$/, ':5000');
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

  // Once ready, navigate away — use replace so Back doesn't loop back into the wizard
  useEffect(() => {
    if (status?.state === 'ready') {
      const dest = targetAssetId ? `/assets/${targetAssetId}` : '/dashboard';
      const t = setTimeout(() => navigate(dest, { replace: true }), 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [status?.state, navigate, targetAssetId]);

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
            {/* ─── Guided picker — grouped by what you're trying to scan ──
                Previously this was a flat 3-column grid of 12 cards with
                no hint about which card belongs to which scenario. Per
                Hassan: an operator looking at the page can't tell whether
                their Cisco device wants the network section or the
                collector agent on /admin/agents. The grouping below
                makes the answer obvious without leaving the page.

                We keep the existing card visual + onClick handler — just
                wrap the cards in titled groups with a one-line "best for"
                hint per group. No new routes, no new components, no
                behavior change beyond layout. */}
            {(() => {
              const groups: Array<{
                key: string;
                title: string;
                hint: string;
                ids: Platform[];
              }> = [
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
                  ids: ['oracle', 'mssql', 'postgres', 'mysql', 'mongodb'],
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
              const lookup = new Map(PLATFORMS.map((p) => [p.id, p]));
              return groups.map((g) => (
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
              ));
            })()}

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">
                {error}
              </div>
            )}

            <div className="text-center">
              <button
                onClick={() => navigate('/dashboard', { replace: true })}
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

        {tokenData && status?.state !== 'ready' && (
          picked === 'windows' || picked === 'linux' || picked === 'digitalocean' ||
          picked === 'cisco'   || picked === 'oracle' ||
          picked === 'mssql'   || picked === 'postgres' || picked === 'mysql' ||
          picked === 'mongodb' || picked === 'ad'
        ) && (
          <ManualCredsForm
            platform={picked}
            token={tokenData.token}
            targetAssetId={targetAssetId}
            onCancel={() => { setTokenData(null); setPicked(null); setStatus(null); }}
            onSuccess={(assetId) => {
              if (assetId) {
                navigate(`/assets/${assetId}`, { replace: true });
              } else {
                navigate('/dashboard', { replace: true });
              }
            }}
          />
        )}

        {tokenData && status?.state !== 'ready' && picked === 'azure' && (
          <AzureForm
            token={tokenData.token}
            onCancel={() => { setTokenData(null); setPicked(null); setStatus(null); }}
          />
        )}

        {tokenData && status?.state !== 'ready' && picked === 'k8s' && (
          <KubernetesForm
            token={tokenData.token}
            onCancel={() => { setTokenData(null); setPicked(null); setStatus(null); }}
          />
        )}

        {status?.state === 'ready' && (
          <ConnectedSuccessWithScope status={status} navigate={navigate} />
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
  targetAssetId,
  onCancel,
  onSuccess,
}: {
  platform:
    | 'windows' | 'linux' | 'digitalocean' | 'cisco' | 'oracle'
    | 'mssql' | 'postgres' | 'mysql' | 'mongodb' | 'ad';
  token: string;
  targetAssetId?: number | null;
  onCancel: () => void;
  onSuccess?: (assetId: number | null) => void;
}) {
  // Per-platform default ports: WinRM 5986, SSH 22, Oracle TNS 1521,
  // SQL Server 1433, Postgres 5432, MySQL 3306, MongoDB 27017, LDAP 389.
  const defaultPort =
    platform === 'windows'  ? '5986' :
    platform === 'oracle'   ? '1521' :
    platform === 'mssql'    ? '1433' :
    platform === 'postgres' ? '5432' :
    platform === 'mysql'    ? '3306' :
    platform === 'mongodb'  ? '27017' :
    platform === 'ad'       ? '389'  :
    '22';
  // Optional extra-field config for the new platforms — most have a
  // "database name" or "bind DN" that doesn't exist for SSH/WinRM/Oracle.
  const extraField =
    platform === 'mssql'    ? { label: 'Database', placeholder: 'master',          field: 'database_name' as const } :
    platform === 'postgres' ? { label: 'Database', placeholder: 'postgres',        field: 'database_name' as const } :
    platform === 'mysql'    ? { label: 'Database', placeholder: 'information_schema', field: 'database_name' as const } :
    platform === 'mongodb'  ? { label: 'Database', placeholder: 'admin',           field: 'database_name' as const } :
    platform === 'ad'       ? { label: 'Bind DN',  placeholder: 'CN=svc-compliverse,OU=Service Accounts,DC=bank,DC=local', field: 'ldap_bind_dn' as const } :
    null;
  // Inline hint shown under the port field — explains why this is the
  // default for the chosen platform so the operator doesn't second-guess it.
  const portHint =
    platform === 'windows'  ? 'Default WinRM-HTTPS port. Change only if your estate uses a non-standard port.' :
    platform === 'oracle'   ? 'Default Oracle TNS Listener port. Change to match your DB listener.' :
    platform === 'cisco'    ? 'Default SSH port for Cisco IOS/NX-OS. Adjust if you front it with a jump host.' :
    platform === 'mssql'    ? 'Default SQL Server TDS port.' :
    platform === 'postgres' ? 'Default PostgreSQL port.' :
    platform === 'mysql'    ? 'Default MySQL port.' :
    platform === 'mongodb'  ? 'Default MongoDB port.' :
    platform === 'ad'       ? 'Default LDAP port. Use 636 for LDAPS.' :
    'Default SSH port. Change only if you front the host with a jump port.';
  const userHint =
    platform === 'windows'  ? 'Service account on the Windows server (e.g., compliverse_scanner)' :
    platform === 'cisco'    ? "Cisco read-only enable account (e.g., 'svc-compliverse'). Privilege level 5 or higher with `show` commands allowed." :
    platform === 'oracle'   ? "DB user with SELECT on AUDIT views (e.g., 'compliverse_audit'). NO grant of DBA needed." :
    platform === 'mssql'    ? "Read-only login (e.g., 'compliverse_audit') with VIEW SERVER STATE." :
    platform === 'postgres' ? "Read-only user (e.g., 'compliverse_audit') with pg_read_all_settings + pg_read_all_stats." :
    platform === 'mysql'    ? "Read-only user with SELECT on information_schema + mysql.user (e.g., 'compliverse_audit')." :
    platform === 'mongodb'  ? "Read-only user with the 'readAnyDatabase' built-in role (e.g., 'compliverse_audit')." :
    platform === 'ad'       ? "AD service account (sAMAccountName) used to bind. The Bind DN below is the full DN." :
    'Linux user with read-only audit rights (e.g., compliverse_scanner)';
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState(defaultPort);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<PreflightDiagnostic | null>(null);
  const [success, setSuccess] = useState(false);

  const platformLabel =
    platform === 'windows'      ? 'Windows Server' :
    platform === 'digitalocean' ? 'DigitalOcean Droplet' :
    platform === 'cisco'        ? 'Cisco / Network device' :
    platform === 'oracle'       ? 'Oracle Database' :
    platform === 'mssql'        ? 'Microsoft SQL Server' :
    platform === 'postgres'     ? 'PostgreSQL' :
    platform === 'mysql'        ? 'MySQL / MariaDB' :
    platform === 'mongodb'      ? 'MongoDB' :
    platform === 'ad'           ? 'Active Directory / LDAP' :
    'Linux Server';
  const logo =
    platform === 'windows'      ? '🪟' :
    platform === 'digitalocean' ? '🌊' :
    platform === 'cisco'        ? '📡' :
    platform === 'oracle'       ? '🔶' :
    platform === 'mssql'        ? '🟦' :
    platform === 'postgres'     ? '🐘' :
    platform === 'mysql'        ? '🐬' :
    platform === 'mongodb'      ? '🍃' :
    platform === 'ad'           ? '🗂️' :
    '🐧';

  // Extra optional field (database name OR bind DN) for the new platforms.
  const [extraValue, setExtraValue] = useState('');

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
      // Endpoint shape per platform — backend handshake distinguishes
      // by which *_endpoint field is non-null.
      //   Windows  → winrm_endpoint (HTTPS wsman)
      //   Linux/DO/Cisco → ssh_endpoint (paramiko target)
      //   Oracle   → sql_endpoint (TNS connect string)
      // Only send port in the endpoint if the user explicitly TYPED a
      // custom one (not the platform default). Otherwise omit so backend
      // auto-probes both candidates (5986 → 5985 for WinRM, 22 → 2222 for SSH).
      const customPort = port && port.trim() !== '' && port.trim() !== defaultPort;
      const portFrag = customPort ? `:${port.trim()}` : '';
      const cleanExtra = (extraValue || '').trim();
      const r = await apiClient.post('/connect-wizard/handshake', {
        tenant_token: token,
        hostname: cleanHost,
        display_label: cleanLabel || cleanHost,
        os_name: platformLabel,
        winrm_endpoint: platform === 'windows' ? `https://${cleanHost}${portFrag}/wsman` : null,
        ssh_endpoint: (platform === 'linux' || platform === 'digitalocean' || platform === 'cisco') ? `ssh://${cleanHost}${portFrag}` : null,
        sql_endpoint: platform === 'oracle' ? `oracle://${cleanHost}${portFrag}/orcl` : null,
        service_account: cleanUser,
        agent_password: cleanPwd,
        // Extra structured fields for the newly-added platforms.
        // Backend reads only the ones relevant to its `platform` value.
        database_name: (platform === 'mssql' || platform === 'postgres' || platform === 'mysql' || platform === 'mongodb') ? (cleanExtra || null) : null,
        db_port: (platform === 'mssql' || platform === 'postgres' || platform === 'mysql' || platform === 'mongodb')
          ? (port && port !== defaultPort ? Number(port) : null)
          : null,
        ldap_bind_dn: platform === 'ad' ? (cleanExtra || null) : null,
        ldap_use_ssl: platform === 'ad' ? (port === '636') : null,
        // Pass target_asset_id when connecting from an app-asset page so
        // the backend links this credential to the existing asset directly.
        target_asset_id: targetAssetId ?? null,
      });
      if (r.status >= 200 && r.status < 300) {
        setSuccess(true);
        if (onSuccess) {
          onSuccess(targetAssetId ?? null);
        }
      }
    } catch (e: any) {
      // The wizard handshake returns a structured pre-flight error when
      // it can prove the credentials are bad. Render the hint so the
      // operator knows EXACTLY what to fix before retrying — no more
      // "saved as connected but every scan fails" surprise.
      const d = e?.response?.data?.detail;
      if (d && typeof d === 'object' && d.preflight_failed) {
        // Save the full structured diagnostic — the renderer below will
        // show: exact checks that ran, exact error, and copy-paste fix
        // commands targeted at the SPECIFIC failure cause.
        setDiagnostic(d as PreflightDiagnostic);
        setError(null);
      } else if (typeof d === 'string') {
        setError(d);
        setDiagnostic(null);
      } else {
        setError(e?.message || 'Failed to register server');
        setDiagnostic(null);
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
        {targetAssetId ? (
          <button
            onClick={() => navigate(`/assets/${targetAssetId}`, { replace: true })}
            className="mt-3 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
          >
            View app asset &amp; scan →
          </button>
        ) : (
          <button
            onClick={() => navigate('/dashboard', { replace: true })}
            className="mt-3 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Go to dashboard →
          </button>
        )}
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
                <label className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">Hostname or IP address</span>
                  <span className="text-xs text-slate-400">FQDN or IP — we auto-probe the port</span>
                </label>
                <input
                  type="text"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder={
                    platform === 'windows' ? 'win-srv01.company.com   or   10.0.0.5' :
                    platform === 'cisco'   ? 'edge-router-01.lan   or   10.0.0.5' :
                    platform === 'oracle'  ? 'prod-oracle-01.db.local   or   10.0.0.20' :
                    'host.company.com   or   203.0.113.42'
                  }
                  required
                  className={inputCls + " font-mono"}
                />
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
                  Advanced: custom port (auto-probe handles defaults)
                </summary>
                <div className="mt-2 max-w-[160px]">
                  <label className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-slate-700">Port</span>
                    <span className="text-[10px] text-slate-400">
                      {platform === 'windows'  ? 'auto: 5986 → 5985' :
                       platform === 'oracle'   ? 'TNS' :
                       platform === 'mssql'    ? 'TDS' :
                       platform === 'postgres' ? 'libpq' :
                       platform === 'mysql'    ? 'MySQL' :
                       platform === 'mongodb'  ? 'MongoDB wire' :
                       platform === 'ad'       ? 'LDAP/LDAPS' :
                       'SSH'}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder={platform === 'windows' ? 'auto' : ''}
                    className={inputCls + " font-mono text-center"}
                  />
                  <p className="mt-1 text-[10px] text-slate-500">{portHint}</p>
                </div>
              </details>
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

              {extraField && (
                <div className="md:col-span-2">
                  <label className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-slate-700">{extraField.label}</span>
                    <span className="text-[10px] text-slate-400">
                      {platform === 'ad' ? 'Full distinguished name' : 'Default DB name if blank'}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={extraValue}
                    onChange={(e) => setExtraValue(e.target.value)}
                    placeholder={extraField.placeholder}
                    className={inputCls + (platform === 'ad' ? ' font-mono text-xs' : '')}
                  />
                </div>
              )}
            </div>
          </fieldset>

          {/* Live pre-flight notice */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-start gap-3">
            <svg className="w-5 h-5 text-slate-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <div className="text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-900">Live pre-flight check.</strong> When you click <em>Connect server</em>, we open a real{' '}
              {platform === 'windows' ? 'WinRM' :
               platform === 'mssql' || platform === 'postgres' || platform === 'mysql' || platform === 'mongodb' || platform === 'oracle' ? 'database' :
               platform === 'ad' ? 'LDAP' : 'SSH'}{' '}
              session and run a single read-only <code className="px-1 py-0.5 bg-slate-200 rounded text-[10px]">whoami</code> against the target.
              If it fails (wrong password, host unreachable, port blocked), we tell you exactly what — <strong>no broken connection is saved.</strong>
            </div>
          </div>

          {/* Inline error — structured diagnostic when backend returned one */}
          {diagnostic && (
            <PreflightDiagnosticBlock
              diag={diagnostic}
              onDismiss={() => setDiagnostic(null)}
            />
          )}
          {error && !diagnostic && (
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
          onClick={() => window.location.replace('/dashboard')}
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

// ─── Connected success + scope picker ─────────────────────────────────
// After a successful agentless handshake we land here. Hassan wants
// the operator to immediately decide scope: does this credential apply
// to the whole tenant (default), only the host we just connected, or
// a custom asset list / CIDR? Skip = keep tenant_all default.
function ConnectedSuccessWithScope({
  status,
  navigate,
}: {
  status: StatusResp;
  navigate: (path: string, opts?: { replace?: boolean }) => void;
}) {
  const [mode, setMode] = useState<'tenant_all' | 'asset_list'>('tenant_all');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveAndGo = async () => {
    if (!status.connection_id) { navigate('/dashboard', { replace: true }); return; }
    setSaving(true);
    try {
      const scope_value = mode === 'asset_list' && status.asset_id
        ? { asset_ids: [status.asset_id] }
        : {};
      await compliancePluginsApi.setConnectionScope(status.connection_id, {
        scope_mode: mode, scope_value,
      });
      setSaved(true);
      setTimeout(() => navigate('/admin/connections', { replace: true }), 800);
    } catch {
      // even if scope save fails, the connection is still saved
      navigate('/dashboard', { replace: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md p-8 border-2 border-green-300">
      <div className="text-center">
        <div className="text-5xl mb-3">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Connected!</h2>
        <p className="text-gray-600 mb-1">
          <strong className="text-gray-900">{status.hostname}</strong> is now ready to scan.
        </p>
        {status.os_name && (
          <p className="text-sm text-gray-500 mb-4">Detected OS: {status.os_name}</p>
        )}
      </div>

      <div className="mt-4 border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">One more thing — credential scope</h3>
        <p className="text-xs text-gray-600 mb-3">
          Where should this credential apply? Default is the whole tenant
          (any matching host). Pick "Just this host" if it's for a single device.
          You can always change this later under Connections.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode('tenant_all')}
            className={`rounded-md border px-3 py-2 text-left text-xs ${
              mode === 'tenant_all' ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="font-medium text-gray-900">All matching assets</div>
            <div className="text-[10px] text-gray-500">Cred works on every host of this type in the tenant</div>
          </button>
          <button
            onClick={() => setMode('asset_list')}
            className={`rounded-md border px-3 py-2 text-left text-xs ${
              mode === 'asset_list' ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="font-medium text-gray-900">Just this host</div>
            <div className="text-[10px] text-gray-500">Limit to {status.hostname} only</div>
          </button>
        </div>
      </div>

      {saved && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          Scope saved. Taking you to Connections to verify…
        </div>
      )}

      <div className="mt-4 flex justify-between gap-2">
        <button
          onClick={() => navigate('/dashboard', { replace: true })}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Skip (use default)
        </button>
        <button
          onClick={saveAndGo}
          disabled={saving}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save scope and continue →'}
        </button>
      </div>
    </div>
  );
}

// ─── Structured pre-flight diagnostic renderer ───────────────────────
// Replaces the old "Cannot reach target — generic hint" with: exact
// stage that failed, what was checked, copy-paste commands for the
// target host's admin. Driven by backend's `detail` payload.
type PreflightDiagnostic = {
  preflight_failed: true;
  code: string;
  stage?: 'icmp' | 'tcp' | 'protocol' | string;
  message: string;
  exact_error?: string;
  checks_run?: string[];
  fix_steps?: Array<{ title: string; code: string; explain: string }>;
  hint?: string;
};

function PreflightDiagnosticBlock({
  diag, onDismiss,
}: { diag: PreflightDiagnostic; onDismiss: () => void }) {
  const codeLabel: Record<string, string> = {
    host_unreachable: 'Host does not respond',
    winrm_ports_closed: 'WinRM ports are closed on target',
    ssh_unreachable: 'SSH unreachable',
    oracle_unreachable: 'Oracle listener unreachable',
    auth_failed: 'Authentication rejected by target',
    tls_error: 'TLS handshake failed',
    ssh_handshake_failed: 'SSH handshake failed',
  };
  const label = codeLabel[diag.code] || diag.code;

  const copy = async (s: string) => {
    try { await navigator.clipboard.writeText(s); } catch {}
  };

  return (
    <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 space-y-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Pre-flight failed · stage: {diag.stage || 'unknown'}
          </div>
          <div className="mt-0.5 text-base font-semibold text-red-900">{label}</div>
        </div>
        <button onClick={onDismiss} className="text-xs text-red-700 underline">dismiss</button>
      </div>

      <div className="text-xs text-red-900 leading-relaxed">{diag.message}</div>

      {diag.exact_error && diag.exact_error !== diag.message && (
        <div className="rounded-md bg-white border border-red-200 p-2">
          <div className="text-[10px] font-semibold uppercase text-red-700">Exact error</div>
          <code className="text-[11px] text-red-900 break-words">{diag.exact_error}</code>
        </div>
      )}

      {diag.checks_run && diag.checks_run.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase text-red-700 mb-1">Checks run</div>
          <ul className="space-y-0.5 text-[11px] text-red-900 font-mono">
            {diag.checks_run.map((c, i) => (<li key={i}>• {c}</li>))}
          </ul>
        </div>
      )}

      {diag.fix_steps && diag.fix_steps.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase text-red-700">How to fix on the target host</div>
          {diag.fix_steps.map((step, i) => (
            <div key={i} className="rounded-md bg-white border border-red-200 p-2 space-y-1">
              <div className="text-xs font-semibold text-gray-900">{i + 1}. {step.title}</div>
              {step.code && (
                <div className="relative">
                  <pre className="overflow-x-auto rounded bg-gray-900 text-emerald-300 p-2 text-[11px] font-mono whitespace-pre-wrap break-all">{step.code}</pre>
                  <button
                    onClick={() => copy(step.code)}
                    className="absolute top-1 right-1 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-white hover:bg-gray-600"
                    title="Copy to clipboard"
                  >Copy</button>
                </div>
              )}
              <p className="text-[11px] text-gray-700">{step.explain}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Azure subscription form ─────────────────────────────────────────────
// Service principal model (Reader role on subscription). No host/port —
// authentication is via Microsoft Entra ID OAuth2 client-credentials.
function AzureForm({ token, onCancel }: { token: string; onCancel: () => void }) {
  const [subscriptionId, setSubscriptionId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await apiClient.post('/connect-wizard/handshake', {
        tenant_token: token,
        hostname: subscriptionId.trim(),
        display_label: label.trim() || `Azure ${subscriptionId.slice(0, 8)}`,
        os_name: 'Azure subscription',
        azure_subscription_id: subscriptionId.trim(),
        azure_tenant_id: tenantId.trim(),
        azure_client_id: clientId.trim(),
        azure_client_secret: clientSecret.trim(),
      });
      if (r.status >= 200 && r.status < 300) setSuccess(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to register Azure subscription');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="bg-white rounded-xl shadow-md p-8 border-2 border-green-300 text-center">
        <div className="text-5xl mb-3">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Azure subscription connected</h2>
        <p className="text-gray-600 mb-4">
          <strong>{subscriptionId}</strong> is ready for CIS scans.
        </p>
        <button
          onClick={() => window.location.replace('/dashboard')}
          className="mt-3 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Go to dashboard →
        </button>
      </div>
    );
  }

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
  return (
    <form onSubmit={submit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-slate-200">
        <span className="text-2xl">🟦</span>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Azure subscription</h2>
          <p className="text-xs text-slate-500">Service principal with Reader role. Stored Fernet-encrypted.</p>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Connection label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Prod Azure subscription" className={inputCls} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Subscription ID</label>
          <input value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" required className={inputCls + " font-mono text-xs"} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Tenant (directory) ID</label>
          <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" required className={inputCls + " font-mono text-xs"} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Client (application) ID</label>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" required className={inputCls + " font-mono text-xs"} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Client secret</label>
          <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="••••••••" required autoComplete="new-password" className={inputCls + " font-mono tracking-wider"} />
          <p className="mt-1.5 text-xs text-slate-500">Encrypted with your tenant key. Only used at scan time.</p>
        </div>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{String(error)}</div>
      )}
      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700 hover:underline">← Pick a different platform</button>
        <button type="submit" disabled={submitting} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
          {submitting ? 'Registering…' : 'Save connection'}
        </button>
      </div>
    </form>
  );
}

// ─── Kubernetes form ─────────────────────────────────────────────────────
// Two auth styles supported by the runner:
//   (a) Full kubeconfig YAML pasted in — easiest for clusters provisioned
//       by EKS/AKS/GKE since their CLIs print one.
//   (b) Direct server + bearer token + optional CA — fits in-cluster service
//       accounts and pre-existing RBAC bindings.
function KubernetesForm({ token, onCancel }: { token: string; onCancel: () => void }) {
  const [authStyle, setAuthStyle] = useState<'kubeconfig' | 'token'>('kubeconfig');
  const [kubeconfig, setKubeconfig] = useState('');
  const [server, setServer] = useState('');
  const [k8sToken, setK8sToken] = useState('');
  const [caCert, setCaCert] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const hostnameForRow = authStyle === 'kubeconfig' ? (label.trim() || 'kubernetes-cluster') : server.trim();
      const r = await apiClient.post('/connect-wizard/handshake', {
        tenant_token: token,
        hostname: hostnameForRow,
        display_label: label.trim() || hostnameForRow,
        os_name: 'Kubernetes cluster',
        kubeconfig: authStyle === 'kubeconfig' ? kubeconfig : null,
        k8s_server: authStyle === 'token' ? server.trim() : null,
        k8s_token: authStyle === 'token' ? k8sToken.trim() : null,
        k8s_ca_cert: authStyle === 'token' ? (caCert.trim() || null) : null,
      });
      if (r.status >= 200 && r.status < 300) setSuccess(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to register cluster');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="bg-white rounded-xl shadow-md p-8 border-2 border-green-300 text-center">
        <div className="text-5xl mb-3">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Cluster connected</h2>
        <p className="text-gray-600 mb-4">CIS Kubernetes Benchmark scans can now run against this cluster.</p>
        <button
          onClick={() => window.location.replace('/dashboard')}
          className="mt-3 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Go to dashboard →
        </button>
      </div>
    );
  }

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
  return (
    <form onSubmit={submit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-slate-200">
        <span className="text-2xl">☸️</span>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Kubernetes cluster</h2>
          <p className="text-xs text-slate-500">Read-only RBAC. Stored Fernet-encrypted.</p>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Connection label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="prod-eks-east" className={inputCls} />
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setAuthStyle('kubeconfig')} className={`px-3 py-1.5 rounded-md text-xs font-medium border ${authStyle === 'kubeconfig' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>Paste kubeconfig</button>
        <button type="button" onClick={() => setAuthStyle('token')} className={`px-3 py-1.5 rounded-md text-xs font-medium border ${authStyle === 'token' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>Server + bearer token</button>
      </div>
      {authStyle === 'kubeconfig' ? (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Kubeconfig YAML</label>
          <textarea
            value={kubeconfig}
            onChange={(e) => setKubeconfig(e.target.value)}
            rows={10}
            required
            placeholder={`apiVersion: v1\nkind: Config\nclusters:\n- cluster:\n    server: https://...\n  name: my-cluster\n…`}
            className={inputCls + " font-mono text-xs"}
          />
          <p className="mt-1.5 text-xs text-slate-500">Run <code className="bg-slate-100 px-1 rounded">kubectl config view --minify --flatten</code> and paste here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">API server URL</label>
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://cluster.example.com:6443" required className={inputCls + " font-mono text-xs"} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Bearer token</label>
            <input type="password" value={k8sToken} onChange={(e) => setK8sToken(e.target.value)} placeholder="eyJhbGciOiJSUzI1NiIs…" required autoComplete="new-password" className={inputCls + " font-mono text-xs"} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">CA cert (PEM, optional)</label>
            <textarea value={caCert} onChange={(e) => setCaCert(e.target.value)} rows={6} placeholder="-----BEGIN CERTIFICATE-----..." className={inputCls + " font-mono text-xs"} />
            <p className="mt-1.5 text-xs text-slate-500">Leave blank to skip TLS verification (lab clusters only).</p>
          </div>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{String(error)}</div>
      )}
      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700 hover:underline">← Pick a different platform</button>
        <button type="submit" disabled={submitting} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
          {submitting ? 'Registering…' : 'Save connection'}
        </button>
      </div>
    </form>
  );
}
