'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ssoApi,
  adminApi,
  AdminRole,
  IdpConfig,
  IdpGraphGroup,
  IdpGroupMapping,
} from '@/lib/api';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';

const PROVIDER_LABEL = 'Microsoft Entra ID';
type Tab = 'config' | 'mappings';

const STATUS_BANNER: Record<string, { kind: 'ok' | 'err'; msg: string }> = {
  connected: { kind: 'ok', msg: 'Microsoft Entra ID connected successfully.' },
  token_exchange_failed: { kind: 'err', msg: 'Microsoft rejected the consent. Please try again.' },
  id_token_invalid: { kind: 'err', msg: 'Microsoft sign-in could not be verified. Please try again.' },
  no_id_token: { kind: 'err', msg: 'Microsoft did not return an ID token.' },
  no_tid: { kind: 'err', msg: 'Microsoft did not return a directory ID.' },
  provider_error: { kind: 'err', msg: 'Microsoft returned an error during consent. Check the backend log for the AADSTS code.' },
  viral_tenant: {
    kind: 'err',
    msg:
      "This Microsoft directory is in an unmanaged ('viral') state. A Microsoft 365 admin must claim the domain via DNS verification at admin.microsoft.com before our app can be consented. Try connecting from a managed Entra tenant (e.g. an *.onmicrosoft.com admin) instead for now.",
  },
  user_not_in_tenant: {
    kind: 'err',
    msg: 'The chosen Microsoft account is not a member of any organizational directory. Sign in with a real work/school account.',
  },
  needs_admin_consent: {
    kind: 'err',
    msg: "Admin consent is required and your account isn't a Microsoft directory admin. Have a Global Administrator complete the connect.",
  },
};

export function IdentityProvidersCard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Google Workspace card opens a separate info panel — the OAuth flow
  // isn't wired up yet, so this panel just explains what's coming.
  const [googleOpen, setGoogleOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('config');
  const [config, setConfig] = useState<IdpConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [domainsInput, setDomainsInput] = useState('');
  const [autoProvision, setAutoProvision] = useState(true);
  const [isEnabled, setIsEnabled] = useState(true);

  const [mappings, setMappings] = useState<IdpGroupMapping[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [groupQuery, setGroupQuery] = useState('');
  const [groupResults, setGroupResults] = useState<IdpGraphGroup[]>([]);
  const [groupSearchLoading, setGroupSearchLoading] = useState(false);
  const [pendingGroup, setPendingGroup] = useState<IdpGraphGroup | null>(null);
  const [pendingRoleId, setPendingRoleId] = useState<number | ''>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusParam = searchParams?.get('focus');
  const tabParam = searchParams?.get('tab');
  const entraStatus = searchParams?.get('entra_status');

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await ssoApi.getConfig();
      const c = res.data as IdpConfig;
      const isConfigured = !!(c as any)?.configured;
      setConfig(isConfigured ? c : null);
      if (isConfigured) {
        setIsEnabled(!!c.is_enabled);
        setAutoProvision(!!c.auto_provision_on_signin);
        setDomainsInput((c.allowed_email_domains || []).join(', '));
      }
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConfig(); }, []);

  // Auto-open when ?focus=identity (used by /integrations deep-link) OR
  // when admin lands here after the consent callback (?tab=identity&entra_status=...)
  useEffect(() => {
    if (focusParam === 'identity' && !open) setOpen(true);
    if (tabParam === 'identity' && entraStatus && !open) setOpen(true);
  }, [focusParam, tabParam, entraStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Surface entra_status banner after callback redirect
  useEffect(() => {
    if (!entraStatus) return;
    const m = STATUS_BANNER[entraStatus];
    if (m?.kind === 'ok') setSuccess(m.msg);
    else if (m?.kind === 'err') setError(m.msg);
  }, [entraStatus]);

  useEffect(() => {
    if (!open || !config) return;
    (async () => {
      try {
        const [m, r] = await Promise.all([
          ssoApi.listGroupMappings(),
          adminApi.getRoles(),
        ]);
        setMappings(m.data.mappings || []);
        setRoles(r.data || []);
      } catch { /* non-fatal */ }
    })();
  }, [open, config]);

  useEffect(() => {
    if (!open || tab !== 'mappings' || !config) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setGroupSearchLoading(true);
      try {
        const res = await ssoApi.searchGroups(groupQuery);
        setGroupResults(res.data.groups || []);
      } catch {
        setGroupResults([]);
      } finally {
        setGroupSearchLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [groupQuery, open, tab, config]);

  const closePanel = () => {
    setOpen(false);
    setError(null);
    setSuccess(null);
    if (focusParam === 'identity' || tabParam === 'identity' || entraStatus) {
      const params = new URLSearchParams(searchParams?.toString());
      params.delete('focus');
      params.delete('entra_status');
      // keep tab=identity if the admin was browsing the admin tabs
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : '?');
    }
  };

  const handleConnect = async () => {
    setError(null);
    setSuccess(null);
    try {
      // Use axios so the request goes through the auth interceptor
      // (Bearer + X-Tenant-Slug). The backend sets the state cookie on this
      // JSON response, and we navigate the browser to the authorize URL.
      const res = await ssoApi.connectInit();
      const target = res.data?.authorize_url;
      if (!target) {
        setError('Failed to start the Microsoft consent flow.');
        return;
      }
      window.location.href = target;
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to start Microsoft consent flow');
    }
  };

  const handleSavePrefs = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const domains = domainsInput.split(',').map((d) => d.trim()).filter(Boolean);
      const res = await ssoApi.updateConfig({
        is_enabled: isEnabled,
        auto_provision_on_signin: autoProvision,
        allowed_email_domains: domains,
      });
      setConfig(res.data as IdpConfig);
      setSuccess('Settings saved');
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      await ssoApi.testConfig();
      setSuccess('Connection OK — Microsoft accepted the credentials.');
      await loadConfig();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleProvision = async () => {
    setProvisioning(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await ssoApi.provisionUsers();
      const { created, skipped, roles_applied } = res.data;
      setSuccess(`Imported: ${created} created, ${skipped} skipped, ${roles_applied} role assignments applied.`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Provisioning failed');
    } finally {
      setProvisioning(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Microsoft Entra ID? Existing federated users keep their accounts; sign-in via Microsoft will stop working until you reconnect.')) {
      return;
    }
    setSaving(true);
    try {
      await ssoApi.deleteConfig();
      setConfig(null);
      setSuccess('Disconnected.');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Disconnect failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddMapping = async () => {
    if (!pendingGroup || !pendingRoleId) return;
    try {
      await ssoApi.createGroupMapping({
        entra_group_id: pendingGroup.id,
        entra_group_name: pendingGroup.display_name,
        role_id: Number(pendingRoleId),
      });
      const refreshed = await ssoApi.listGroupMappings();
      setMappings(refreshed.data.mappings || []);
      setPendingGroup(null);
      setPendingRoleId('');
      setGroupQuery('');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to add mapping');
    }
  };

  const handleDeleteMapping = async (id: number) => {
    try {
      await ssoApi.deleteGroupMapping(id);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to remove mapping');
    }
  };

  const status = useMemo(() => {
    if (!config || !config.entra_directory_id) return { label: 'Not connected', cls: 'bg-slate-100 text-slate-600' };
    if (!config.is_enabled) return { label: 'Disabled', cls: 'bg-amber-100 text-amber-700' };
    if (config.last_test_status === 'failed') return { label: 'Error', cls: 'bg-rose-100 text-rose-700' };
    if (config.last_test_status === 'ok') return { label: 'Connected', cls: 'bg-emerald-100 text-emerald-700' };
    return { label: 'Connected', cls: 'bg-emerald-100 text-emerald-700' };
  }, [config]);

  const isConnected = !!config?.entra_directory_id;

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Building2 size={16} className="text-blue-600" />
            Identity Providers
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Microsoft Entra ID — live */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={loading}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/30 transition"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-blue-50 text-blue-600">
                {/* Microsoft 4-square logo */}
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 23 23">
                  <path fill="#f35325" d="M1 1h10v10H1z"/>
                  <path fill="#81bc06" d="M12 1h10v10H12z"/>
                  <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                  <path fill="#ffba08" d="M12 12h10v10H12z"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{PROVIDER_LABEL}</p>
                <p className="text-xs text-slate-500 truncate">SSO sign-in + user provisioning</p>
              </div>
            </div>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${status.cls}`}>
              {loading ? '…' : status.label}
            </span>
          </button>

          {/* Google Workspace — visible in the picker; backend wiring is
              on the roadmap. Clicking opens an informational panel rather
              than starting an OAuth flow that doesn't exist yet. */}
          <button
            type="button"
            onClick={() => setGoogleOpen(true)}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/30 transition"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-slate-50">
                {/* Google "G" logo */}
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                  <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
                  <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
                  <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">Google Workspace</p>
                <p className="text-xs text-slate-500 truncate">SSO sign-in + user provisioning</p>
              </div>
            </div>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-slate-100 text-slate-600">
              Not configured
            </span>
          </button>
        </div>
      </div>

      {/* Informational slide-over for Google Workspace until the OAuth
          flow ships. Same visual style as the Entra panel so the page
          feels consistent. */}
      <RightSlidePanel
        isOpen={googleOpen}
        onClose={() => setGoogleOpen(false)}
        title="Google Workspace"
        subtitle="OAuth sign-in + Cloud Identity user provisioning"
        width="w-full max-w-2xl"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
            <p className="font-medium">Coming soon</p>
            <p>
              The Google Workspace connector is on the roadmap. When it ships you'll be
              able to: sign in with a Google Workspace account, sync directory users
              from Cloud Identity, and map Google Groups to GRC roles — the same way
              Microsoft Entra works today.
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-700 space-y-1">
            <p className="font-medium">What it will do</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>OAuth 2.0 + OIDC consent flow with your Workspace domain.</li>
              <li>Auto-provision new users from the domain on first sign-in.</li>
              <li>Map Google Groups (e.g. <code className="font-mono">security@yourco.com</code>) → GRC roles.</li>
              <li>Optional domain allowlist (mirrors the Entra setting).</li>
            </ul>
          </div>
          <div className="text-xs text-slate-500">
            Need this sooner? Tell us — we'll prioritise based on which side has the
            larger user base.
          </div>
        </div>
      </RightSlidePanel>

      <RightSlidePanel
        isOpen={open}
        onClose={closePanel}
        title={PROVIDER_LABEL}
        subtitle="Connect your Microsoft Entra directory"
        width="w-full max-w-2xl"
      >
        <div className="flex border-b border-slate-200 px-1 -mt-2 mb-4 sticky top-0 bg-white z-10">
          <button
            type="button"
            onClick={() => setTab('config')}
            className={`px-4 py-2 text-sm border-b-2 ${tab === 'config' ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-slate-500'}`}
          >
            Connection
          </button>
          <button
            type="button"
            onClick={() => setTab('mappings')}
            disabled={!isConnected}
            className={`px-4 py-2 text-sm border-b-2 disabled:opacity-50 ${tab === 'mappings' ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-slate-500'}`}
            title={isConnected ? '' : 'Connect a directory first'}
          >
            Group → Role mappings
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-md bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 flex items-start gap-2">
            <XCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mb-3 rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700 flex items-start gap-2">
            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {tab === 'config' && (
          <div className="space-y-4">
            {!isConnected ? (
              <>
                <div className="rounded-md bg-blue-50/60 border border-blue-200 p-3 text-xs text-blue-800 space-y-1">
                  <p className="font-medium">How this works</p>
                  <p>Click <strong>Connect</strong> below. You'll be redirected to Microsoft to sign in as a directory admin and consent to the Compliverse application. After approval, your Microsoft directory ID is bound to this organization.</p>
                </div>
                <button
                  type="button"
                  onClick={handleConnect}
                  className="flex items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 w-full py-2.5 text-sm font-medium"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 23 23">
                    <path fill="#f3f3f3" d="M0 0h23v23H0z"/>
                    <path fill="#f35325" d="M1 1h10v10H1z"/>
                    <path fill="#81bc06" d="M12 1h10v10H12z"/>
                    <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                    <path fill="#ffba08" d="M12 12h10v10H12z"/>
                  </svg>
                  Connect with Microsoft
                </button>
              </>
            ) : (
              <>
                <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3 text-xs text-emerald-800 space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 size={14} />
                    Connected
                  </div>
                  <p><span className="text-slate-500">Microsoft directory ID:</span> <code className="font-mono">{config?.entra_directory_id}</code></p>
                  {config?.connected_at && <p className="text-slate-500">Connected on {new Date(config.connected_at).toLocaleString()}</p>}
                </div>

                <Field label="Allowed email domains (comma-separated)" hint="Empty = any. Users with emails outside this list are rejected on first sign-in.">
                  <input className={inputCls} value={domainsInput} onChange={(e) => setDomainsInput(e.target.value)} placeholder="ubl.com.pk" />
                </Field>

                <div className="flex items-center gap-6 pt-1">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} />
                    Enabled (show "Sign in with Microsoft" on /login)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={autoProvision} onChange={(e) => setAutoProvision(e.target.checked)} />
                    Auto-provision new users
                  </label>
                </div>

                <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-200">
                  <button type="button" onClick={handleSavePrefs} disabled={saving} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5">
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    Save settings
                  </button>
                  <button type="button" onClick={handleTest} disabled={testing} className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5">
                    {testing && <Loader2 size={14} className="animate-spin" />}
                    Test connection
                  </button>
                  <button type="button" onClick={handleProvision} disabled={provisioning} className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5">
                    {provisioning && <Loader2 size={14} className="animate-spin" />}
                    Import users now
                  </button>
                  <button type="button" onClick={handleConnect} disabled={saving} className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded text-sm disabled:opacity-50">
                    Re-consent
                  </button>
                  <button type="button" onClick={handleDisconnect} disabled={saving} className="ml-auto px-3 py-1.5 border border-rose-200 text-rose-700 hover:bg-rose-50 rounded text-sm">
                    Disconnect
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'mappings' && (
          <div className="space-y-3">
            {mappings.length === 0 ? (
              <p className="text-sm text-slate-500 italic">
                No group mappings yet. Users who sign in via SSO will land without any role until you map their groups here.
              </p>
            ) : (
              <ul className="rounded border border-slate-200 divide-y divide-slate-100">
                {mappings.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 truncate">{m.entra_group_name || m.entra_group_id}</p>
                      <p className="text-xs text-slate-500 truncate">→ {m.role_name || `Role #${m.role_id}`}</p>
                    </div>
                    <button onClick={() => handleDeleteMapping(m.id)} className="p-1.5 text-slate-400 hover:text-rose-600" title="Remove mapping">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="rounded border border-dashed border-slate-300 p-3 space-y-2">
              <p className="text-xs font-medium text-slate-600 flex items-center gap-1"><Plus size={12} /> Add mapping</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">Entra group</label>
                  <input
                    className={inputCls}
                    value={pendingGroup ? pendingGroup.display_name : groupQuery}
                    onChange={(e) => { setPendingGroup(null); setGroupQuery(e.target.value); }}
                    placeholder="Search group by name…"
                  />
                  {!pendingGroup && groupQuery && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200 bg-white shadow-sm">
                      {groupSearchLoading && <p className="px-2 py-1 text-xs text-slate-400">Searching…</p>}
                      {!groupSearchLoading && groupResults.length === 0 && (
                        <p className="px-2 py-1 text-xs text-slate-400">No matches</p>
                      )}
                      {groupResults.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => { setPendingGroup(g); setGroupQuery(''); }}
                          className="block w-full text-left px-2 py-1 text-xs hover:bg-slate-50 truncate"
                        >
                          {g.display_name}
                          <span className="text-slate-400 ml-1">{g.id.slice(0, 8)}…</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">GRC role</label>
                  <select className={inputCls} value={pendingRoleId} onChange={(e) => setPendingRoleId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">Select a role…</option>
                    {roles.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!pendingGroup || !pendingRoleId}
                  onClick={handleAddMapping}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </RightSlidePanel>
    </>
  );
}

const inputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
