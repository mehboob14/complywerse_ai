'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Loader2,
  Plus,
  Server,
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
import { authedFetch } from '@/lib/auth-fetch';

const PROVIDER_LABEL = 'Microsoft Entra ID';
type Tab = 'config' | 'mappings';
interface IgaVendor {
  key: string; label: string; kind: string; auth: string;
  fields: { name: string; label: string; secret: boolean }[]; default_url: string;
}

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
  // Okta connector (access-review population). Token is sent per-sync, not stored.
  const [oktaOpen, setOktaOpen] = useState(false);
  const [oktaDomain, setOktaDomain] = useState('');
  const [oktaToken, setOktaToken] = useState('');
  const [oktaBusy, setOktaBusy] = useState(false);
  const [oktaMsg, setOktaMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [oktaConnected, setOktaConnected] = useState<{ domain: string } | null>(null);
  // Google Workspace connector (access-review population).
  const [googleToken, setGoogleToken] = useState('');
  const [googleCustomer, setGoogleCustomer] = useState('my_customer');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleMsg, setGoogleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  // On-prem AD/LDAP connector. Bind password is sent per-sync, not stored.
  const [ldapOpen, setLdapOpen] = useState(false);
  const [ldapServer, setLdapServer] = useState('');
  const [ldapBaseDn, setLdapBaseDn] = useState('');
  const [ldapBindDn, setLdapBindDn] = useState('');
  const [ldapBindPw, setLdapBindPw] = useState('');
  const [ldapSsl, setLdapSsl] = useState(false);
  const [ldapBusy, setLdapBusy] = useState(false);
  const [ldapMsg, setLdapMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ldapConnected, setLdapConnected] = useState<{ server: string } | null>(null);
  // Tier-2 IGA / IAM governance connector (generic — vendor picked at runtime).
  // Credentials are sent per-sync, never stored.
  const [igaOpen, setIgaOpen] = useState(false);
  const [igaVendors, setIgaVendors] = useState<IgaVendor[]>([]);
  const [igaVendor, setIgaVendor] = useState('sailpoint');
  const [igaBaseUrl, setIgaBaseUrl] = useState('');
  const [igaCreds, setIgaCreds] = useState<Record<string, string>>({});
  const [igaBusy, setIgaBusy] = useState(false);
  const [igaMsg, setIgaMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [igaConnected, setIgaConnected] = useState<{ vendor: string; base_url: string } | null>(null);
  const selVendor = igaVendors.find((v) => v.key === igaVendor) || null;
  // Tier-3 business-app connector (generic — app picked at runtime).
  const [appsOpen, setAppsOpen] = useState(false);
  const [appsList, setAppsList] = useState<IgaVendor[]>([]);
  const [appKey, setAppKey] = useState('core_banking');
  const [appBaseUrl, setAppBaseUrl] = useState('');
  const [appCreds, setAppCreds] = useState<Record<string, string>>({});
  const [appBusy, setAppBusy] = useState(false);
  const [appMsg, setAppMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [appConnected, setAppConnected] = useState<{ app: string; base_url: string } | null>(null);
  const selApp = appsList.find((a) => a.key === appKey) || null;

  useEffect(() => {
    authedFetch('/api/access-reviews/connectors')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.okta?.connected) { setOktaConnected({ domain: d.okta.domain }); setOktaDomain(d.okta.domain || ''); }
        if (d?.google?.connected) setGoogleConnected(true);
        if (d?.ldap?.connected) {
          setLdapConnected({ server: d.ldap.server });
          setLdapServer(d.ldap.server || ''); setLdapBaseDn(d.ldap.base_dn || '');
        }
        if (d?.iga?.connected) {
          setIgaConnected({ vendor: d.iga.vendor, base_url: d.iga.base_url });
          setIgaVendor(d.iga.vendor || 'sailpoint'); setIgaBaseUrl(d.iga.base_url || '');
        }
        if (d?.apps?.connected) {
          setAppConnected({ app: d.apps.app, base_url: d.apps.base_url });
          setAppKey(d.apps.app || 'core_banking'); setAppBaseUrl(d.apps.base_url || '');
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (appsList.length) return;
    authedFetch('/api/access-reviews/connectors/apps/catalog')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.apps) setAppsList(d.apps); })
      .catch(() => {});
  }, [appsList.length]);

  const pickApp = (key: string) => {
    setAppKey(key); setAppCreds({}); setAppMsg(null);
    const a = appsList.find((x) => x.key === key);
    setAppBaseUrl(a?.default_url || '');
  };

  const appsSync = async (sample = false) => {
    setAppBusy(true); setAppMsg(null);
    try {
      const r = await authedFetch('/api/access-reviews/connectors/apps/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: appKey, base_url: appBaseUrl.trim(), credentials: appCreds, sample }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Sync failed');
      setAppConnected({ app: appKey, base_url: d.base_url });
      setAppMsg({ ok: true, text: `${sample ? 'Loaded sample data for' : 'Connected to'} ${selApp?.label || appKey}. Pulled ${d.created + d.updated} users, ${d.entitlements_linked} permissions (${d.total_in_directory} total).` });
      setAppCreds({});
    } catch (e: unknown) {
      setAppMsg({ ok: false, text: e instanceof Error ? e.message : 'Sync failed' });
    } finally { setAppBusy(false); }
  };

  // Load the vendor catalog (labels + credential fields) on mount so each
  // vendor renders as its own card.
  useEffect(() => {
    if (igaVendors.length) return;
    authedFetch('/api/access-reviews/connectors/iga/vendors')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.vendors) setIgaVendors(d.vendors); })
      .catch(() => {});
  }, [igaVendors.length]);

  const pickVendor = (key: string) => {
    setIgaVendor(key); setIgaCreds({}); setIgaMsg(null);
    const v = igaVendors.find((x) => x.key === key);
    setIgaBaseUrl(v?.default_url || '');
  };

  const igaSync = async (sample = false) => {
    setIgaBusy(true); setIgaMsg(null);
    try {
      const r = await authedFetch('/api/access-reviews/connectors/iga/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor: igaVendor, base_url: igaBaseUrl.trim(), credentials: igaCreds, sample }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Sync failed');
      setIgaConnected({ vendor: igaVendor, base_url: d.base_url });
      setIgaMsg({ ok: true, text: `${sample ? 'Loaded sample data for' : 'Connected to'} ${selVendor?.label || igaVendor}. Pulled ${d.created + d.updated} identities, ${d.entitlements_linked} entitlements (${d.total_in_directory} total).` });
      setIgaCreds({});
    } catch (e: unknown) {
      setIgaMsg({ ok: false, text: e instanceof Error ? e.message : 'Sync failed' });
    } finally { setIgaBusy(false); }
  };

  const ldapSync = async () => {
    setLdapBusy(true); setLdapMsg(null);
    try {
      const r = await authedFetch('/api/access-reviews/connectors/ldap/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: ldapServer.trim(), base_dn: ldapBaseDn.trim(),
          bind_dn: ldapBindDn.trim(), bind_password: ldapBindPw, use_ssl: ldapSsl,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'LDAP sync failed');
      setLdapConnected({ server: d.server });
      setLdapMsg({ ok: true, text: `Connected. Pulled ${d.created + d.updated} users (${d.total_in_directory} in directory).` });
      setLdapBindPw('');
    } catch (e: unknown) {
      setLdapMsg({ ok: false, text: e instanceof Error ? e.message : 'LDAP sync failed' });
    } finally { setLdapBusy(false); }
  };

  const googleSync = async () => {
    setGoogleBusy(true); setGoogleMsg(null);
    try {
      const r = await authedFetch('/api/access-reviews/connectors/google/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: googleToken.trim(), customer: googleCustomer.trim() || 'my_customer' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Google sync failed');
      setGoogleConnected(true);
      setGoogleMsg({ ok: true, text: `Connected. Pulled ${d.created + d.updated} users (${d.total_in_directory} in directory).` });
      setGoogleToken('');
    } catch (e: unknown) {
      setGoogleMsg({ ok: false, text: e instanceof Error ? e.message : 'Google sync failed' });
    } finally { setGoogleBusy(false); }
  };

  const oktaSync = async () => {
    setOktaBusy(true); setOktaMsg(null);
    try {
      const r = await authedFetch('/api/access-reviews/connectors/okta/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: oktaDomain.trim(), token: oktaToken.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Okta sync failed');
      setOktaConnected({ domain: d.domain });
      setOktaMsg({ ok: true, text: `Connected. Pulled ${d.created + d.updated} users (${d.total_in_directory} in Okta).` });
      setOktaToken('');
    } catch (e: unknown) {
      setOktaMsg({ ok: false, text: e instanceof Error ? e.message : 'Okta sync failed' });
    } finally { setOktaBusy(false); }
  };
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
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Building2 size={16} className="text-blue-600" />
            Access connectors
          </h2>
          <span className="text-xs text-slate-400">3 tiers · directories → governance → apps</span>
        </div>

        {/* ───────── Tier 1 ───────── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-blue-50 text-blue-700 text-[11px] font-semibold">1</span>
            <span className="text-sm font-semibold text-slate-700">Directories &amp; login</span>
            <span className="text-xs text-slate-400">— identity + basic roles</span>
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
                <p className="text-xs text-slate-500 truncate">Pull users for access reviews (access token)</p>
              </div>
            </div>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${googleConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
              {googleConnected ? 'Connected' : 'Not connected'}
            </span>
          </button>

          {/* Okta — live connector for access-review population (domain + API token). */}
          <button
            type="button"
            onClick={() => { setOktaMsg(null); setOktaOpen(true); }}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/30 transition"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[#00297A]">
                <span className="text-white font-bold text-sm tracking-tight">O</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">Okta</p>
                <p className="text-xs text-slate-500 truncate">Pull users for access reviews (API token)</p>
              </div>
            </div>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${oktaConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
              {oktaConnected ? 'Connected' : 'Not connected'}
            </span>
          </button>

          {/* On-prem Active Directory / LDAP — live connector for orgs that run
              identity on-premises (server + base DN; bind password per-sync). */}
          <button
            type="button"
            onClick={() => { setLdapMsg(null); setLdapOpen(true); }}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/30 transition"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-slate-700">
                <Server size={18} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">Active Directory / LDAP</p>
                <p className="text-xs text-slate-500 truncate">On-prem directory for access reviews</p>
              </div>
            </div>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${ldapConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
              {ldapConnected ? 'Connected' : 'Not connected'}
            </span>
          </button>

          </div>
        </div>

        {/* ───────── Tier 2 ───────── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-violet-50 text-violet-700 text-[11px] font-semibold">2</span>
            <span className="text-sm font-semibold text-slate-700">IAM / IGA governance</span>
            <span className="text-xs text-slate-400">— full entitlements, requests &amp; approvals</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* One card per IGA / PAM vendor — opens the panel pre-selected. */}
          {igaVendors.map((v) => (
            <button key={v.key} type="button"
              onClick={() => { pickVendor(v.key); setIgaMsg(null); setIgaOpen(true); }}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/30 transition">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded text-white text-[10px] font-bold ${v.kind === 'PAM' ? 'bg-slate-700' : 'bg-[#0033A0]'}`}>
                  {v.label.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{v.label} <span className="text-[10px] text-slate-400">{v.kind}</span></p>
                  <p className="text-xs text-slate-500 truncate">identities + entitlements</p>
                </div>
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${igaConnected?.vendor === v.key ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {igaConnected?.vendor === v.key ? 'Connected' : 'Not connected'}
              </span>
            </button>
          ))}

          </div>
        </div>

        {/* ───────── Tier 3 ───────── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-200 text-slate-700 text-[11px] font-semibold">3</span>
            <span className="text-sm font-semibold text-slate-700">Business apps</span>
            <span className="text-xs text-slate-400">— app-level permissions where the risk sits</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* One card per business app — opens the panel pre-selected. */}
          {appsList.map((a) => (
            <button key={a.key} type="button"
              onClick={() => { pickApp(a.key); setAppMsg(null); setAppsOpen(true); }}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/30 transition">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-slate-800 text-white">
                  {a.key === 'database' ? <Server size={18} /> : <Building2 size={18} />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{a.label}</p>
                  <p className="text-xs text-slate-500 truncate">{a.key === 'database' ? 'accounts + granted privileges' : 'users + app-level permissions'}</p>
                </div>
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${appConnected?.app === a.key ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {appConnected?.app === a.key ? 'Connected' : 'Not connected'}
              </span>
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* Okta connect + sync panel */}
      <RightSlidePanel
        isOpen={oktaOpen}
        onClose={() => setOktaOpen(false)}
        title="Okta"
        subtitle="Pull the user population for access reviews"
        width="w-full max-w-2xl"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1">
            <p className="font-medium">How this works</p>
            <p>
              Enter your Okta org domain and an API token (Okta admin → Security → API → Tokens).
              We pull users from <code>/api/v1/users</code> into the population — the token is used
              for this sync only and is <b>not stored</b>. Then run a review as usual.
            </p>
          </div>
          {oktaMsg && (
            <div className={`rounded-md px-3 py-2 text-sm ${oktaMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {oktaMsg.text}
            </div>
          )}
          {oktaConnected && (
            <p className="text-xs text-slate-500">Currently connected to <b>{oktaConnected.domain}</b>. Re-enter the token to re-sync.</p>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Okta domain</label>
            <input value={oktaDomain} onChange={(e) => setOktaDomain(e.target.value)}
              placeholder="acme.okta.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">API token (SSWS)</label>
            <input type="password" value={oktaToken} onChange={(e) => setOktaToken(e.target.value)}
              placeholder="00abc..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <button onClick={oktaSync} disabled={oktaBusy || !oktaDomain.trim() || !oktaToken.trim()}
            className="cw-btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {oktaBusy ? 'Connecting & syncing…' : 'Connect & sync users'}
          </button>
        </div>
      </RightSlidePanel>

      {/* On-prem AD/LDAP connect + sync panel */}
      <RightSlidePanel
        isOpen={ldapOpen}
        onClose={() => setLdapOpen(false)}
        title="Active Directory / LDAP"
        subtitle="Pull the user population from an on-prem directory"
        width="w-full max-w-2xl"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1">
            <p className="font-medium">How this works</p>
            <p>
              Point us at your domain controller (e.g. <code>dc01.acme.local</code>), give the
              search base DN and a read-only service account to bind with. We page through the
              directory into the population — reading <code>userAccountControl</code> (so disabled
              accounts are flagged), department, title and last logon. The bind password is used
              for this sync only and is <b>not stored</b>.
            </p>
          </div>
          {ldapMsg && (
            <div className={`rounded-md px-3 py-2 text-sm ${ldapMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {ldapMsg.text}
            </div>
          )}
          {ldapConnected && (
            <p className="text-xs text-slate-500">Currently connected to <b>{ldapConnected.server}</b>. Re-enter the bind password to re-sync.</p>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Server (host or ldap:// URL)</label>
            <input value={ldapServer} onChange={(e) => setLdapServer(e.target.value)}
              placeholder="dc01.acme.local"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Base DN (search root)</label>
            <input value={ldapBaseDn} onChange={(e) => setLdapBaseDn(e.target.value)}
              placeholder="DC=acme,DC=local"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Bind DN (service account)</label>
            <input value={ldapBindDn} onChange={(e) => setLdapBindDn(e.target.value)}
              placeholder="CN=svc-grc,OU=Service,DC=acme,DC=local"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Bind password</label>
            <input type="password" value={ldapBindPw} onChange={(e) => setLdapBindPw(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={ldapSsl} onChange={(e) => setLdapSsl(e.target.checked)} />
            Use LDAPS (SSL, port 636)
          </label>
          <button onClick={ldapSync}
            disabled={ldapBusy || !ldapServer.trim() || !ldapBaseDn.trim() || !ldapBindDn.trim() || !ldapBindPw}
            className="cw-btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {ldapBusy ? 'Connecting & syncing…' : 'Connect & sync users'}
          </button>
        </div>
      </RightSlidePanel>

      {/* Tier-2 IGA / IAM governance — generic connect + sync panel (any vendor) */}
      <RightSlidePanel
        isOpen={igaOpen}
        onClose={() => setIgaOpen(false)}
        title="IAM / IGA governance (Tier 2)"
        subtitle="Pull identities + their full entitlements from your governance system"
        width="w-full max-w-2xl"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1">
            <p className="font-medium">Why this is different from a directory</p>
            <p>
              A directory (Entra/Okta) gives login + basic roles. An <b>IGA system</b> holds every
              <b> entitlement / access profile</b> a person has across apps. We pull those and write
              them as roles — so the privilege, SoD and over-privilege checks finally run on real
              governance data. Credentials are used for this sync only and are <b>not stored</b>.
            </p>
          </div>
          {igaMsg && (
            <div className={`rounded-md px-3 py-2 text-sm ${igaMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {igaMsg.text}
            </div>
          )}
          {igaConnected && (
            <p className="text-xs text-slate-500">Currently connected to <b>{igaConnected.vendor}</b> at <b>{igaConnected.base_url}</b>. Re-enter credentials to re-sync.</p>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Governance system</label>
            <select value={igaVendor} onChange={(e) => pickVendor(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30">
              {igaVendors.length === 0 && <option value="sailpoint">Loading…</option>}
              {igaVendors.map((v) => (
                <option key={v.key} value={v.key}>{v.label} · {v.kind}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">API base URL</label>
            <input value={igaBaseUrl} onChange={(e) => setIgaBaseUrl(e.target.value)}
              placeholder={selVendor?.default_url || 'https://your-iga.example.com'}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          {(selVendor?.fields || []).map((f) => (
            <div key={f.name}>
              <label className="block text-sm font-medium text-slate-700 mb-1">{f.label}</label>
              <input type={f.secret ? 'password' : 'text'}
                value={igaCreds[f.name] || ''}
                onChange={(e) => setIgaCreds((c) => ({ ...c, [f.name]: e.target.value }))}
                placeholder={f.secret ? '••••••••' : f.label}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button onClick={() => igaSync(false)}
              disabled={igaBusy || !igaBaseUrl.trim() || !selVendor || selVendor.fields.some((f) => !(igaCreds[f.name] || '').trim())}
              className="cw-btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {igaBusy ? 'Connecting & syncing…' : `Connect & sync ${selVendor?.label || ''}`}
            </button>
            <button onClick={() => igaSync(true)} disabled={igaBusy}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Load sample data
            </button>
          </div>
          <p className="text-[11px] text-slate-400">No live {selVendor?.label || 'IGA'} tenant? “Load sample data” pulls a representative population (tagged <code>.sample</code>) so you can run the full review.</p>
        </div>
      </RightSlidePanel>

      {/* Tier-3 business-app — generic connect + sync panel (any app) */}
      <RightSlidePanel
        isOpen={appsOpen}
        onClose={() => setAppsOpen(false)}
        title="Business apps (Tier 3)"
        subtitle="Pull users + app-level permissions from the systems where access really lives"
        width="w-full max-w-2xl"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1">
            <p className="font-medium">The real risk lives here</p>
            <p>
              These are the business apps an auditor actually inspects — core banking, SAP, the
              database. We read each user's <b>app-level permissions</b> (profiles, roles, grants)
              and write them as roles, so the SoD / over-privilege / DBA checks run on real app
              access. Credentials are used for this sync only and are <b>not stored</b>.
            </p>
          </div>
          {appMsg && (
            <div className={`rounded-md px-3 py-2 text-sm ${appMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {appMsg.text}
            </div>
          )}
          {appConnected && (
            <p className="text-xs text-slate-500">Currently connected to <b>{appConnected.app}</b>. Re-enter credentials to re-sync.</p>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Business app</label>
            <select value={appKey} onChange={(e) => pickApp(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30">
              {appsList.length === 0 && <option value="core_banking">Loading…</option>}
              {appsList.map((a) => (<option key={a.key} value={a.key}>{a.label}</option>))}
            </select>
          </div>
          {selApp && selApp.auth !== 'db' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">API base URL</label>
              <input value={appBaseUrl} onChange={(e) => setAppBaseUrl(e.target.value)}
                placeholder={selApp?.default_url || 'https://app.example.com'}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
            </div>
          )}
          {(selApp?.fields || []).map((f) => (
            <div key={f.name}>
              <label className="block text-sm font-medium text-slate-700 mb-1">{f.label}</label>
              <input type={f.secret ? 'password' : 'text'}
                value={appCreds[f.name] || ''}
                onChange={(e) => setAppCreds((c) => ({ ...c, [f.name]: e.target.value }))}
                placeholder={f.secret ? '••••••••' : f.label}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button onClick={() => appsSync(false)}
              disabled={appBusy || !selApp || (selApp.auth !== 'db' && !appBaseUrl.trim()) || selApp.fields.some((f) => !(appCreds[f.name] || '').trim())}
              className="cw-btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {appBusy ? 'Connecting & syncing…' : `Connect & sync ${selApp?.label || ''}`}
            </button>
            <button onClick={() => appsSync(true)} disabled={appBusy}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Load sample data
            </button>
          </div>
          <p className="text-[11px] text-slate-400">No live {selApp?.label || 'app'}? “Load sample data” pulls a representative population (tagged <code>.sample</code>) so you can run the full review.</p>
        </div>
      </RightSlidePanel>

      {/* Informational slide-over for Google Workspace until the OAuth
          flow ships. Same visual style as the Entra panel so the page
          feels consistent. */}
      <RightSlidePanel
        isOpen={googleOpen}
        onClose={() => setGoogleOpen(false)}
        title="Google Workspace"
        subtitle="Pull the user population for access reviews"
        width="w-full max-w-2xl"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1">
            <p className="font-medium">How this works</p>
            <p>
              Provide a Google Admin SDK <b>access token</b> (Directory API scope) and your
              customer id (default <code>my_customer</code>). We pull users from the Directory
              API into the population — including MFA enrollment and last-login. The token is
              used for this sync only and is <b>not stored</b>.
            </p>
          </div>
          {googleMsg && (
            <div className={`rounded-md px-3 py-2 text-sm ${googleMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {googleMsg.text}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Access token (Bearer)</label>
            <input type="password" value={googleToken} onChange={(e) => setGoogleToken(e.target.value)}
              placeholder="ya29...."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Customer id</label>
            <input value={googleCustomer} onChange={(e) => setGoogleCustomer(e.target.value)}
              placeholder="my_customer"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <button onClick={googleSync} disabled={googleBusy || !googleToken.trim()}
            className="cw-btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {googleBusy ? 'Connecting & syncing…' : 'Connect & sync users'}
          </button>
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
