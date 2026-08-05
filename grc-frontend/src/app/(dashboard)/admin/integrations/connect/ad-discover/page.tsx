'use client';

export const dynamic = 'force-dynamic';

/**
 * Active Directory enumeration page — "connect with credential, discover
 * targets" model.
 *
 * Operator workflow:
 *   Step 1 — paste AD bind creds (LDAP URL + bind DN + password + base DN)
 *   Step 2 — click Discover. Backend binds, paged-searches the computers
 *            OU, returns up to 5000 hostnames
 *   Step 3 — table with checkboxes appears. Tick which to onboard
 *   Step 4 — paste shared WinRM creds (often same service account that
 *            does the AD bind). Backend creates ITAsset + IntegrationConnection
 *            rows in bulk. One credential covers all targets — matches the
 *            real bank reality of one service account per domain.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';

type ADComputer = {
  cn: string;
  dns_hostname: string | null;
  operating_system: string | null;
  operating_system_version: string | null;
  distinguished_name: string;
};

type DiscoverResp = {
  computers: ADComputer[];
  total: number;
  truncated: boolean;
  note: string | null;
};

export default function ADDiscoverPage() {
  const router = useRouter();
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canManage = hasPermission('compliance:agents:manage');

  // Step 1 inputs
  const [ldapUrl, setLdapUrl] = useState('ldap://');
  const [bindDn, setBindDn] = useState('');
  const [bindPassword, setBindPassword] = useState('');
  const [baseDn, setBaseDn] = useState('');
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  // Save-only: persist the LDAP bind credential without binding/discovering.
  const [savingCreds, setSavingCreds] = useState(false);
  const [savedCreds, setSavedCreds] = useState(false);
  const [saveCredError, setSaveCredError] = useState<string | null>(null);

  // Step 2 results
  const [discovered, setDiscovered] = useState<DiscoverResp | null>(null);
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState('');

  // Step 3 onboard inputs
  const [reuseBindAsScan, setReuseBindAsScan] = useState(true);
  const [winrmUser, setWinrmUser] = useState('');
  const [winrmPwd, setWinrmPwd] = useState('');
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  if (!permsLoading && !canManage) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-2xl mx-auto px-4 py-16">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-8 text-center">
            <div className="text-5xl mb-3">🔒</div>
            <h1 className="text-xl font-semibold text-slate-900 mb-2">AD Discovery is locked</h1>
            <p className="text-sm text-slate-600 mb-4">
              Bulk-onboarding via Active Directory requires the
              {' '}<strong>compliance:agents:manage</strong> permission.
            </p>
            <button onClick={() => router.push('/dashboard')} className="px-4 py-2 bg-primary-600 text-[color:var(--color-on-base,#0a0a0a)] text-sm rounded-md hover:bg-primary-700">
              ← Back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const discover = async (e: React.FormEvent | null, demo = false) => {
    if (e) e.preventDefault();
    setDiscoverError(null);
    setDiscovered(null);
    setSelectedHosts(new Set());
    setDiscovering(true);
    try {
      const body = demo
        ? {
            ldap_url: 'mock://demo',
            bind_dn: 'demo',
            bind_password: 'demo',
            base_dn: 'DC=bank,DC=local',
          }
        : {
            ldap_url: ldapUrl.trim(),
            bind_dn: bindDn.trim(),
            bind_password: bindPassword,
            base_dn: baseDn.trim(),
          };
      // Pre-fill the visible form fields when running demo mode so the
      // operator sees what realistic inputs look like.
      if (demo) {
        setLdapUrl(body.ldap_url);
        setBindDn('BANK\\compliance_scanner');
        setBindPassword('demo-mode-fake-password');
        setBaseDn(body.base_dn);
      }
      const r = await apiClient.post('/onboarding/ad/discover', body);
      setDiscovered(r.data as DiscoverResp);
      // Pre-select all on first discover
      const allHosts = (r.data as DiscoverResp).computers
        .map((c) => c.dns_hostname || c.cn)
        .filter(Boolean) as string[];
      setSelectedHosts(new Set(allHosts));
    } catch (e: any) {
      setDiscoverError(e?.response?.data?.detail || e?.message || 'AD discovery failed');
    } finally {
      setDiscovering(false);
    }
  };

  // Save-only: park the LDAP bind credential (encrypted, status 'pending')
  // WITHOUT binding/enumerating — for when the DC isn't reachable yet. Issues
  // an 'ad' wizard token, then persists via the shared save-connection endpoint
  // (identical shape to a later verified connect).
  const saveCredentials = async () => {
    setSaveCredError(null);
    setSavingCreds(true);
    try {
      const raw = ldapUrl.trim();
      const useSsl = /^ldaps:\/\//i.test(raw);
      const host = raw.replace(/^ldaps?:\/\//i, '').replace(/[/:].*$/, '').trim() || raw;
      const tk = await apiClient.post('/connect-wizard/issue-token', { platform: 'ad' });
      await apiClient.post('/connect-wizard/save-connection', {
        tenant_token: (tk.data as { token: string }).token,
        hostname: host,
        display_label: baseDn.trim() || host,
        service_account: bindDn.trim(),
        agent_password: bindPassword,
        ldap_bind_dn: bindDn.trim(),
        ldap_use_ssl: useSsl,
      });
      setSavedCreds(true);
    } catch (e: any) {
      setSaveCredError(e?.response?.data?.detail || e?.message || 'Failed to save AD credentials');
    } finally {
      setSavingCreds(false);
    }
  };

  const filteredComputers = useMemo(() => {
    if (!discovered) return [];
    const q = filterText.trim().toLowerCase();
    if (!q) return discovered.computers;
    return discovered.computers.filter((c) =>
      (c.cn || '').toLowerCase().includes(q) ||
      (c.dns_hostname || '').toLowerCase().includes(q) ||
      (c.operating_system || '').toLowerCase().includes(q)
    );
  }, [discovered, filterText]);

  const toggleHost = (host: string) => {
    setSelectedHosts((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host); else next.add(host);
      return next;
    });
  };

  const selectAllVisible = () => {
    const hosts = filteredComputers.map((c) => c.dns_hostname || c.cn).filter(Boolean) as string[];
    setSelectedHosts(new Set(hosts));
  };

  const clearSelection = () => setSelectedHosts(new Set());

  const onboard = async () => {
    if (selectedHosts.size === 0) {
      setOnboardError('Pick at least one host to onboard.');
      return;
    }
    const scanUser = reuseBindAsScan ? bindDn : winrmUser;
    const scanPwd = reuseBindAsScan ? bindPassword : winrmPwd;
    if (!scanUser || !scanPwd) {
      setOnboardError('Need a WinRM username + password to apply to the discovered hosts.');
      return;
    }
    setOnboardError(null);
    setOnboarding(true);
    try {
      const r = await apiClient.post('/onboarding/ad/onboard', {
        hostnames: Array.from(selectedHosts),
        winrm_username: scanUser,
        winrm_password: scanPwd,
        winrm_port: 5986,
        integration_type: 'windows_winrm',
        connection_label_prefix: 'AD',
      });
      setResult(r.data);
    } catch (e: any) {
      setOnboardError(e?.response?.data?.detail || e?.message || 'Onboard failed');
    } finally {
      setOnboarding(false);
    }
  };

  if (result) {
    return (
      <div className="min-h-screen bg-slate-50 py-12">
        <div className="max-w-2xl mx-auto px-4">
          <div className="bg-white rounded-xl shadow-md border-2 border-emerald-200 p-8 text-center">
            <div className="text-5xl mb-3">✅</div>
            <h1 className="text-2xl font-bold text-slate-900 mb-3">Onboarded</h1>
            <div className="grid grid-cols-3 gap-4 my-6">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <div className="text-3xl font-bold text-emerald-700">{result.created_assets}</div>
                <div className="mt-1 text-xs text-emerald-800">new asset rows</div>
              </div>
              <div className="rounded-lg border border-primary-200 bg-primary-50 p-4">
                <div className="text-3xl font-bold text-primary-700">{result.created_connections}</div>
                <div className="mt-1 text-xs text-primary-800">new connections</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-3xl font-bold text-slate-700">{result.skipped?.length || 0}</div>
                <div className="mt-1 text-xs text-slate-600">skipped (already existed)</div>
              </div>
            </div>
            {result.updated_assets > 0 && (
              <p className="text-xs text-slate-600 mb-4">
                {result.updated_assets} existing asset(s) were updated with owner info.
              </p>
            )}
            <div className="flex gap-3 justify-center">
              <button onClick={() => router.push('/assets')} className="px-5 py-2 bg-primary-600 text-[color:var(--color-on-base,#0a0a0a)] rounded-lg text-sm font-medium hover:bg-primary-700">
                View IT Assets →
              </button>
              <button onClick={() => router.push('/risk-posture')} className="px-5 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200">
                Risk Posture
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-5xl mx-auto px-4 space-y-6">
        <div>
          <button onClick={() => router.back()} className="text-sm text-slate-600 hover:text-slate-900 mb-2">← Back</button>
          <h1 className="text-3xl font-bold text-slate-900">Active Directory discovery</h1>
          <p className="mt-2 text-slate-600 max-w-2xl">
            Bind to AD with one service account, enumerate every domain-joined computer, then onboard them in bulk.
            <strong> No IPs, no CIDR scan</strong> — AD already knows every machine.
          </p>
        </div>

        {/* Demo mode banner — for walking through the flow without a real DC */}
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">✨</span>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-primary-900">No AD server handy? Try it with demo data</h3>
              <p className="mt-1 text-xs text-primary-800">
                We'll return 8 realistic-looking fake hosts (DC-01, WEB-PROD-01, FILE-SRV-01, etc.) so you can walk
                through the rest of the flow — selecting, onboarding, then seeing the assets appear in IT Assets.
                Onboarding still writes <strong>real DB rows in your tenant</strong> (with placeholder credentials),
                so you can delete them afterwards from <a href="/assets" className="underline">/assets</a> if needed.
              </p>
              <button
                type="button"
                onClick={() => discover(null, true)}
                disabled={discovering}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-xs font-semibold text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 disabled:opacity-50"
              >
                {discovering ? 'Loading demo…' : '✨ Try with demo data'}
              </button>
            </div>
          </div>
        </div>

        {/* Step 1: AD bind credentials */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-1 flex items-center gap-2">
            <span className="w-6 h-6 rounded bg-primary-100 text-primary-700 inline-flex items-center justify-center text-xs font-bold">1</span>
            Connect to Active Directory
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Service account that can read computer objects under the base DN. Typically the same account that has WinRM access on the fleet.
          </p>
          <form onSubmit={discover} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">LDAP URL</label>
                <input
                  type="text"
                  value={ldapUrl}
                  onChange={(e) => setLdapUrl(e.target.value)}
                  placeholder="ldap://dc01.bank.local:389  or  ldaps://dc01.bank.local:636"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Base DN (search root)</label>
                <input
                  type="text"
                  value={baseDn}
                  onChange={(e) => setBaseDn(e.target.value)}
                  placeholder="DC=bank,DC=local   or   OU=Workstations,DC=bank,DC=local"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Bind DN  <span className="text-slate-400">(or DOMAIN\\user for NTLM)</span></label>
                <input
                  type="text"
                  value={bindDn}
                  onChange={(e) => setBindDn(e.target.value)}
                  placeholder="CN=svc-compliverse,OU=Service Accounts,DC=bank,DC=local"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  value={bindPassword}
                  onChange={(e) => setBindPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
            {discoverError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{discoverError}</div>
            )}
            {saveCredError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{saveCredError}</div>
            )}
            {savedCreds && (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                Bind credential <strong>saved (not verified)</strong>. Run Test / Sync from Integrations → Connections once the domain controller is reachable.
              </div>
            )}
            <div className="flex justify-end gap-2">
              {/* Save-only: park the bind credential without discovering. */}
              <button
                type="button"
                disabled={savingCreds || discovering || !bindDn.trim() || !bindPassword}
                onClick={saveCredentials}
                className="rounded-md border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {savingCreds ? 'Saving…' : 'Save without connecting'}
              </button>
              <button
                type="submit"
                disabled={discovering}
                className="rounded-md bg-primary-600 px-5 py-2 text-sm font-semibold text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 disabled:opacity-50"
              >
                {discovering ? 'Discovering…' : 'Discover computers'}
              </button>
            </div>
          </form>
        </div>

        {/* Step 2: results table */}
        {discovered && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-1 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-primary-100 text-primary-700 inline-flex items-center justify-center text-xs font-bold">2</span>
              Discovered {discovered.total} computer{discovered.total === 1 ? '' : 's'}
              {discovered.truncated && <span className="text-xs text-amber-700 font-normal">(truncated at 5000)</span>}
            </h2>
            {discovered.note && <p className="text-xs text-slate-500 mb-3">{discovered.note}</p>}

            <div className="flex items-center justify-between gap-3 mb-3">
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter by name or OS…"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="text-xs text-slate-600">
                <strong>{selectedHosts.size}</strong> of {filteredComputers.length} selected
              </div>
              <button onClick={selectAllVisible} className="text-xs text-primary-700 hover:underline">Select all visible</button>
              <button onClick={clearSelection} className="text-xs text-slate-600 hover:underline">Clear</button>
            </div>

            <div className="rounded-lg border border-slate-200 max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-center text-[11px] uppercase text-slate-500" style={{width: 32}} />
                    <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-500">CN</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-500">DNS hostname</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-500">OS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredComputers.map((c) => {
                    const host = c.dns_hostname || c.cn;
                    return (
                      <tr key={c.distinguished_name} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedHosts.has(host)}
                            onChange={() => toggleHost(host)}
                            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-900">{c.cn}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{c.dns_hostname || <span className="text-slate-400 italic">(no DNS name)</span>}</td>
                        <td className="px-3 py-2 text-xs text-slate-700">{c.operating_system || '—'} {c.operating_system_version && <span className="text-slate-400">({c.operating_system_version})</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Step 3: scan credential + onboard */}
            <div className="mt-5 rounded-lg border border-primary-200 bg-primary-50/50 p-4">
              <h3 className="text-sm font-semibold text-primary-900 mb-1">
                <span className="w-6 h-6 rounded bg-primary-100 text-primary-700 inline-flex items-center justify-center text-xs font-bold mr-2">3</span>
                Shared WinRM credential for all selected hosts
              </h3>
              <label className="flex items-center gap-2 mt-3 text-xs">
                <input type="checkbox" checked={reuseBindAsScan} onChange={(e) => setReuseBindAsScan(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                <span className="text-slate-700">Use the same AD bind credentials above for WinRM scans (typical for AD service accounts)</span>
              </label>
              {!reuseBindAsScan && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">WinRM username</label>
                    <input
                      type="text"
                      value={winrmUser}
                      onChange={(e) => setWinrmUser(e.target.value)}
                      placeholder="BANK\\compliverse_scanner"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">WinRM password</label>
                    <input
                      type="password"
                      value={winrmPwd}
                      onChange={(e) => setWinrmPwd(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                </div>
              )}
              {onboardError && (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{onboardError}</div>
              )}
              <div className="mt-4 flex justify-end">
                <button
                  onClick={onboard}
                  disabled={onboarding || selectedHosts.size === 0}
                  className="rounded-md bg-primary-600 px-5 py-2 text-sm font-semibold text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 disabled:opacity-50"
                >
                  {onboarding ? 'Onboarding…' : `Onboard ${selectedHosts.size} selected`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
