'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Cloud, Plus, RefreshCw, Trash2, AlertCircle, Loader2, X, Activity, Copy, ShieldCheck,
} from 'lucide-react';
import { cloudConnectorsApi, type CloudConnector } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import {
  AwsIcon, AzureIcon, GcpIcon, NessusIcon, NexposeIcon, getProviderIcon,
} from '@/components/integrations/ProviderIcons';

// Card catalogue — drives the top-of-page card grid. Each entry maps to
// either a `CloudConnector` provider (new framework) or the legacy
// scanner integrations table. The card shows status pulled from the
// live connector list; clicking either opens the create modal pre-filled
// with the right provider, or deep-links to the legacy admin page.
type CardKind = 'cloud_connector' | 'legacy_scanner';
interface ProviderCard {
  provider: string;
  label: string;
  description: string;
  kind: CardKind;
  // Solid block colour for the icon tile (matches the IdentityProviders pattern).
  iconBg: string;
  // Either a lucide icon or one of our inline brand SVGs — both render the
  // same `<Icon size className />` props, so the type accepts both.
  icon: React.ComponentType<{ size?: number; className?: string }>;
}
const PROVIDER_CATALOGUE: ProviderCard[] = [
  {
    provider: 'aws_inspector',
    label: 'AWS Inspector v2',
    description: 'Cross-account assume-role — we never store an AWS access key.',
    kind: 'cloud_connector',
    iconBg: 'bg-orange-50',
    icon: AwsIcon,
  },
  {
    provider: 'azure_defender',
    label: 'Microsoft Defender for Cloud',
    description: 'Service principal scoped to Security Reader; secret encrypted at rest.',
    kind: 'cloud_connector',
    iconBg: 'bg-blue-50',
    icon: AzureIcon,
  },
  {
    provider: 'gcp_scc',
    label: 'Google Cloud SCC (Premium)',
    description: 'Service-account JSON key, scoped to org-level read-only roles.',
    kind: 'cloud_connector',
    iconBg: 'bg-emerald-50',
    icon: GcpIcon,
  },
  {
    provider: 'nessus',
    label: 'Tenable Nessus',
    description: 'Scanner ingest via Nessus / Tenable.io API key pair.',
    kind: 'legacy_scanner',
    iconBg: 'bg-sky-50',
    icon: NessusIcon,
  },
  {
    provider: 'nexpose',
    label: 'Rapid7 Nexpose',
    description: 'Scanner ingest via Nexpose / InsightVM console credentials.',
    kind: 'legacy_scanner',
    iconBg: 'bg-rose-50',
    icon: NexposeIcon,
  },
];

const STATUS_STYLES: Record<string, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  partial: 'border-amber-200 bg-amber-50 text-amber-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  degraded: 'border-amber-200 bg-amber-50 text-amber-700',
};

export default function CloudConnectorsAdminPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerOk, setBannerOk] = useState<string | null>(null);

  const { data: providers } = useQuery({
    queryKey: ['cloud-connector-providers'],
    queryFn: () => cloudConnectorsApi.listProviders().then((r) => r.data),
  });

  const { data: connectors, isLoading } = useQuery({
    queryKey: ['cloud-connectors'],
    queryFn: () => cloudConnectorsApi.list().then((r) => r.data),
  });

  // Unified read — cloud connectors + legacy scanner integrations in one
  // list, so the admin sees the full integration surface here.
  const { data: unified } = useQuery({
    queryKey: ['cloud-connectors-unified'],
    queryFn: () => cloudConnectorsApi.unified().then((r) => r.data),
  });
  const legacyScannerRows = (unified?.connectors || []).filter(
    (c) => c.framework === 'legacy_scanner',
  );

  const syncMutation = useMutation({
    mutationFn: (id: number) => cloudConnectorsApi.sync(id),
    onSuccess: (r, id) => {
      qc.invalidateQueries({ queryKey: ['cloud-connectors'] });
      const d = r.data;
      const msg = `Connector ${id} synced: ${d.assets_new ?? 0} new + ${d.assets_updated ?? 0} updated assets, ${d.vulnerabilities_new ?? 0} new vulns. ${d.errors?.length ? `${d.errors.length} error(s).` : ''}`;
      setBannerOk(msg);
      setBannerError(null);
    },
    onError: (e: unknown) => {
      setBannerError(
        (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ||
        (e as { message?: string })?.message || 'Sync failed',
      );
      setBannerOk(null);
    },
  });

  const healthMutation = useMutation({
    mutationFn: (id: number) => cloudConnectorsApi.healthCheck(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cloud-connectors'] });
      setBannerOk(`Health: ${r.data.status}${r.data.detail ? ' — ' + r.data.detail : ''}`);
      setBannerError(null);
    },
    onError: (e: unknown) => {
      setBannerError(
        (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ||
        (e as { message?: string })?.message || 'Health check failed',
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => cloudConnectorsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cloud-connectors'] });
      setBannerOk('Connector deleted.');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      cloudConnectorsApi.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloud-connectors'] }),
  });

  // Pre-select a provider when clicking a card so the add modal jumps
  // straight to that template. Placed alongside the other hooks so the
  // hook-call order is stable across the isLoading branch.
  const [presetProvider, setPresetProvider] = useState<string | null>(null);

  // Map provider → list of configured CloudConnector rows so each card
  // can render its own status badge ("2 connected" etc.) without
  // re-iterating the whole list.
  const grouped: Record<string, CloudConnector[]> = {};
  (connectors || []).forEach((c) => {
    (grouped[c.provider] ||= []).push(c);
  });

  if (isLoading) return <PageLoader className="h-64" />;

  return (
    <div className="space-y-4">
      {!providers?.encryption_ready && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-xs flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            <strong>Development mode — credentials stored as base64 JSON.</strong>{' '}
            Set <code className="mx-1 px-1 rounded bg-amber-100">CONNECTOR_MASTER_KEY</code>
            on the backend to enable Fernet encryption at rest. You can still add
            connectors now; existing rows will keep working after the key is set.
          </span>
        </div>
      )}
      {bannerError && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-700 text-sm flex items-center justify-between">
          <span>{bannerError}</span>
          <button onClick={() => setBannerError(null)}><X className="h-4 w-4" /></button>
        </div>
      )}
      {bannerOk && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-700 text-sm flex items-center justify-between">
          <span>{bannerOk}</span>
          <button onClick={() => setBannerOk(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Catalogue grid — same visual pattern as IdentityProvidersCard.
          Each tile is a SUPPORTED platform, regardless of whether it's
          currently configured. Click → opens the right management UI.
          Legacy scanners (Nessus / Nexpose) deep-link to the existing
          Integrations admin tab where their management lives. */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-card">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Cloud size={16} className="text-slate-600" strokeWidth={1.75} />
            Supported integrations
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Click a platform to add a connection. Status badges reflect how many
            connections you already have configured for each one.
          </p>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {PROVIDER_CATALOGUE.map((p) => {
            const configured = grouped[p.provider]?.length || 0;
            const isCloud = p.kind === 'cloud_connector';
            const isConnected = configured > 0;
            return (
              <button
                key={p.provider}
                type="button"
                onClick={() => {
                  if (isCloud) {
                    setPresetProvider(p.provider);
                    setShowAdd(true);
                  } else {
                    // Legacy scanners live in /admin → Integrations.
                    window.location.href = '/admin#integrations';
                  }
                }}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-primary-300 hover:bg-primary-50/30 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded ${p.iconBg}`}>
                    <p.icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
                      {p.label}
                      {!isCloud && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                          Legacy
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{p.description}</p>
                  </div>
                </div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                  isConnected
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {isConnected ? `${configured} connected` : (isCloud ? 'Add' : 'Manage')}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-card">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Cloud size={16} className="text-slate-600" strokeWidth={1.75} />
            Configured cloud connectors
          </h2>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                try {
                  const r = await cloudConnectorsApi.syncAll();
                  setBannerOk(`Bulk sync queued (task ${r.data.task_id}). Refresh in a minute.`);
                } catch {
                  setBannerError('Could not queue bulk sync. Check the worker.');
                }
              }}
              className="px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-sm flex items-center gap-1.5"
              disabled={!connectors?.length}
            >
              <RefreshCw size={14} />
              Sync All
            </button>
            <button
              onClick={() => { setPresetProvider(null); setShowAdd(true); }}
              className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-[#0a0a0a] rounded-lg text-sm flex items-center gap-1.5"
            >
              <Plus size={14} />
              Add Connector
            </button>
          </div>
        </div>

        <div className="p-6">
          {(!connectors || connectors.length === 0) ? (
            <div className="text-center py-12">
              <Cloud className="mx-auto h-12 w-12 text-slate-300 mb-3" />
              <p className="text-sm text-slate-500">No cloud connectors configured.</p>
              <p className="text-xs text-slate-400 mt-1">
                Add an AWS, Azure, or GCP connector to sync findings into the vulnerability register.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {connectors.map((c) => (
                <ConnectorRow
                  key={c.id}
                  connector={c}
                  onSync={() => syncMutation.mutate(c.id)}
                  onHealthCheck={() => healthMutation.mutate(c.id)}
                  onToggleActive={() => toggleActiveMutation.mutate({ id: c.id, is_active: !c.is_active })}
                  onDelete={() => {
                    if (confirm(`Delete connector "${c.display_name}"? This won't remove assets or vulns it has synced.`)) {
                      deleteMutation.mutate(c.id);
                    }
                  }}
                  isSyncing={syncMutation.isPending && syncMutation.variables === c.id}
                  isCheckingHealth={healthMutation.isPending && healthMutation.variables === c.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Legacy scanner connections (Nessus / Nexpose) live in a different
          table but are surfaced here so admins see the full integration
          surface in one place. Read-only — manage in Integrations tab. */}
      {legacyScannerRows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-card">
          <div className="p-6 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Activity size={16} className="text-slate-600" />
              Scanner connections (legacy)
            </h2>
            <span className="text-xs text-slate-500">
              {legacyScannerRows.length} legacy scanner row{legacyScannerRows.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="p-6 space-y-2">
            <p className="text-xs text-slate-500 -mt-2 mb-2">
              These connectors live in the legacy scanner-integrations table.
              They keep syncing on their own schedule; manage them in the
              Integrations tab.
            </p>
            {legacyScannerRows.map((c) => {
              const lastSync = c.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : 'Never';
              const syncStyle = STATUS_STYLES[c.last_sync_status || ''] || 'border-slate-200 bg-slate-50 text-slate-600';
              return (
                <div key={`legacy-${c.id}`} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-slate-900">{c.display_name}</h3>
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                          {c.provider}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          Legacy
                        </span>
                        {!c.is_active && (
                          <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                            Disabled
                          </span>
                        )}
                      </div>
                      {c.description && (
                        <p className="text-xs text-slate-600 mb-1">{c.description}</p>
                      )}
                      <div className="text-xs text-slate-700">
                        Last sync: <span className="text-slate-900">{lastSync}</span>
                        {c.last_sync_status && (
                          <span className={`ml-2 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${syncStyle}`}>
                            {c.last_sync_status}
                          </span>
                        )}
                      </div>
                    </div>
                    <a
                      href="/admin"
                      className="px-2 py-1 border border-slate-300 bg-white text-slate-700 rounded text-xs hover:bg-slate-50"
                      title="Manage in Integrations tab"
                    >
                      Manage →
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showAdd && providers && (
        <AddConnectorModal
          providers={providers.providers}
          presetProvider={presetProvider}
          onClose={() => { setShowAdd(false); setPresetProvider(null); }}
          onSaved={() => {
            setShowAdd(false);
            setPresetProvider(null);
            setBannerOk('Connector created — run a health check to verify credentials.');
            qc.invalidateQueries({ queryKey: ['cloud-connectors'] });
          }}
          onError={setBannerError}
        />
      )}
    </div>
  );
}

function ConnectorRow({
  connector,
  onSync,
  onHealthCheck,
  onToggleActive,
  onDelete,
  isSyncing,
  isCheckingHealth,
}: {
  connector: CloudConnector;
  onSync: () => void;
  onHealthCheck: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  isSyncing: boolean;
  isCheckingHealth: boolean;
}) {
  const lastSync = connector.last_sync_at ? new Date(connector.last_sync_at).toLocaleString() : 'Never';
  const lastHealth = connector.last_health_check_at
    ? new Date(connector.last_health_check_at).toLocaleString()
    : 'Never';
  const syncStyle = STATUS_STYLES[connector.last_sync_status || ''] || STATUS_STYLES.error;
  const healthStyle = STATUS_STYLES[connector.last_health_status || ''] || STATUS_STYLES.error;
  const metrics = (connector.health_metrics || {}) as Record<string, unknown>;

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-slate-900">{connector.display_name}</h3>
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              {connector.provider}
            </span>
            {!connector.is_active && (
              <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                Disabled
              </span>
            )}
          </div>
          {connector.description && (
            <p className="text-xs text-slate-600 mb-2">{connector.description}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs">
            <div>
              <span className="text-slate-500">Last sync:</span>{' '}
              <span className="text-slate-800">{lastSync}</span>
              {connector.last_sync_status && (
                <span className={`ml-2 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${syncStyle}`}>
                  {connector.last_sync_status}
                </span>
              )}
            </div>
            <div>
              <span className="text-slate-500">Last health:</span>{' '}
              <span className="text-slate-800">{lastHealth}</span>
              {connector.last_health_status && (
                <span className={`ml-2 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${healthStyle}`}>
                  {connector.last_health_status}
                </span>
              )}
            </div>
            {connector.last_sync_error && (
              <div className="md:col-span-2 text-rose-700">
                <AlertCircle size={11} className="inline mr-1" />
                {connector.last_sync_error}
              </div>
            )}
            {metrics.last_assets_new !== undefined && (
              <div className="md:col-span-2 text-slate-700">
                Last run added {String(metrics.last_assets_new)} assets, {String(metrics.last_vulnerabilities_new)} vulnerabilities; updated {String(metrics.last_assets_updated)} / {String(metrics.last_vulnerabilities_updated)}.
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={onHealthCheck}
            disabled={isCheckingHealth}
            className="px-2 py-1 border border-slate-300 bg-white text-slate-700 rounded text-xs hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1"
            title="Health check"
          >
            {isCheckingHealth ? <Loader2 size={11} className="animate-spin" /> : <Activity size={11} />}
            Health
          </button>
          <button
            onClick={onSync}
            disabled={isSyncing || !connector.is_active}
            className="px-2 py-1 border border-primary-300 bg-primary-50 text-primary-700 rounded text-xs hover:bg-primary-100 disabled:opacity-50 inline-flex items-center gap-1"
            title="Sync now"
          >
            {isSyncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Sync
          </button>
          <button
            onClick={onToggleActive}
            className="px-2 py-1 border border-slate-300 bg-white text-slate-700 rounded text-xs hover:bg-slate-50"
            title={connector.is_active ? 'Disable' : 'Enable'}
          >
            {connector.is_active ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={onDelete}
            className="px-2 py-1 border border-rose-300 bg-rose-50 text-rose-700 rounded text-xs hover:bg-rose-100 inline-flex items-center gap-1"
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AddConnectorModal({
  providers,
  presetProvider,
  onClose,
  onSaved,
  onError,
}: {
  providers: Array<{ provider: string; label: string; credentials_schema: Record<string, unknown>; framework?: string }>;
  presetProvider?: string | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  // Only cloud-framework providers are addable here. Legacy scanner
  // providers (Nessus / Nexpose) are advertised in the providers payload
  // but managed by a different page — filter them out of the picker.
  const addableProviders = providers.filter(
    (p) => (p.framework || 'cloud_connector') === 'cloud_connector',
  );
  const initialProvider =
    (presetProvider && addableProviders.find((p) => p.provider === presetProvider)?.provider) ||
    addableProviders[0]?.provider || '';
  const [provider, setProvider] = useState(initialProvider);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleHours, setScheduleHours] = useState(6);
  const [credsJson, setCredsJson] = useState(() => credsTemplateFor(initialProvider));
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(credsJson);
    } catch {
      onError('Credentials must be valid JSON.');
      setSaving(false);
      return;
    }
    try {
      await cloudConnectorsApi.create({
        provider,
        display_name: displayName,
        description: description || undefined,
        credentials: parsed,
        sync_schedule_seconds: scheduleHours * 60 * 60,
      });
      onSaved();
    } catch (err: unknown) {
      onError(
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ||
        (err as { message?: string })?.message ||
        'Create failed',
      );
    } finally {
      setSaving(false);
    }
  };

  // Fetch the provider-specific setup guide (External ID, IAM policies,
  // step-by-step) whenever the picked provider changes. Server stamps
  // the ExternalID off the tenant ID — stable across refreshes so the
  // customer's IAM role keeps validating.
  const { data: setup } = useQuery({
    queryKey: ['cloud-connector-setup-info', provider],
    queryFn: () => cloudConnectorsApi.setupInfo(provider).then((r) => r.data),
    enabled: !!provider,
  });

  const handleProviderChange = (p: string) => {
    setProvider(p);
    setCredsJson(credsTemplateFor(p));
  };

  // When the setup-info response carries a `credentials_template`, prefill
  // the JSON textarea with it — the customer only fills in their own
  // values (ARN, secret) on top of the stamped External ID etc.
  useEffect(() => {
    if (setup?.credentials_template) {
      setCredsJson(JSON.stringify(setup.credentials_template, null, 2));
    }
  }, [setup]);

  const ProviderIconFn = getProviderIcon(provider);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
      <div className="w-full max-w-5xl flex flex-col max-h-[90vh] rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            {ProviderIconFn && <ProviderIconFn size={18} />}
            Add Cloud Connector
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Two-column body: setup guide on the left, credentials form
            on the right. The guide pulls per-tenant secure values
            (ExternalID, recommended IAM policy) from /setup-info. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-y-auto flex-1">
          <div className="lg:border-r border-slate-200 px-5 py-4 bg-slate-50 lg:max-h-full">
            <SetupGuide setup={setup} />
          </div>

          <form id="add-connector-form" onSubmit={onSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Provider *</label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {addableProviders.map((p) => (
                <option key={p.provider} value={p.provider}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Display name *</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              placeholder="Prod AWS — Findings Account"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Sync interval (hours)
            </label>
            <input
              type="number"
              min={1}
              max={168}
              value={scheduleHours}
              onChange={(e) => setScheduleHours(Number(e.target.value) || 6)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Daily fan-out runs every 6 hours; this controls how often each connector is re-synced within that.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Credentials (JSON) *
            </label>
            <textarea
              value={credsJson}
              onChange={(e) => setCredsJson(e.target.value)}
              rows={10}
              required
              spellCheck={false}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Encrypted at rest with <code className="font-mono">CONNECTOR_MASTER_KEY</code>{' '}
              (or base64-stamped in dev mode). The values prefilled above (e.g. ExternalID) are
              stamped from the setup guide on the left — you only need to fill in the
              fields the cloud generated for you.
            </p>
          </div>
          </form>
        </div>

        {/* Sticky footer — visible regardless of scroll position. */}
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 flex-shrink-0 bg-white rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 bg-white text-slate-700 rounded-lg text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-connector-form"
            disabled={saving}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-[#0a0a0a] rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            Create connector
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SetupGuide ─────────────────────────────────────────────────────────────
// Renders the per-provider linking guide returned by /setup-info: security
// summary, what we DO and DON'T store, the per-tenant ExternalID + IAM
// policies, and the numbered step list. Each `copy_block` shows a copy
// button so the customer never has to manually type secret-bearing values.

function SetupGuide({ setup }: { setup?: {
  provider?: string;
  label?: string;
  security_model?: string;
  security_summary?: string;
  what_we_store?: string[];
  what_we_dont_store?: string[];
  copy_blocks?: Array<{ label: string; value: string; language?: string; help?: string }>;
  steps?: Array<{ title: string; body: string; code?: string }>;
  redirect?: string;
} }) {
  if (!setup) {
    return (
      <div className="text-xs text-slate-500">
        Pick a provider on the right — the setup guide will appear here.
      </div>
    );
  }

  if (setup.redirect) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">{setup.label}</h3>
        <p className="text-xs text-slate-700">{setup.security_summary}</p>
        <a
          href={setup.redirect}
          className="inline-flex items-center gap-1.5 text-xs rounded-md border border-primary-300 bg-primary-50 px-3 py-1.5 text-primary-700 hover:bg-primary-100"
        >
          Manage in Integrations →
        </a>
      </div>
    );
  }

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard denied; user can manually copy */ }
  };

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <ShieldCheck size={14} className="text-emerald-600" />
          {setup.label}
        </h3>
        <p className="text-xs text-slate-700 mt-2 leading-relaxed">
          {setup.security_summary}
        </p>
      </div>

      {(setup.what_we_store || setup.what_we_dont_store) && (
        <div className="grid grid-cols-1 gap-2 text-xs">
          {setup.what_we_store && setup.what_we_store.length > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
              <p className="font-semibold text-emerald-800 mb-1">We store</p>
              <ul className="list-disc list-inside space-y-0.5 text-emerald-900">
                {setup.what_we_store.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
          )}
          {setup.what_we_dont_store && setup.what_we_dont_store.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white p-2">
              <p className="font-semibold text-slate-700 mb-1">We never store</p>
              <ul className="list-disc list-inside space-y-0.5 text-slate-700">
                {setup.what_we_dont_store.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {setup.steps && setup.steps.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
            Step-by-step
          </p>
          <ol className="space-y-2">
            {setup.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-[10px] font-semibold">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-xs">{s.title}</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {setup.copy_blocks && setup.copy_blocks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Values to paste into the cloud console
          </p>
          {setup.copy_blocks.map((b, i) => (
            <div key={i} className="rounded-md border border-slate-200 bg-white">
              <div className="px-2 py-1 border-b border-slate-100 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  {b.label}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(b.value)}
                  className="text-[10px] text-primary-600 hover:underline inline-flex items-center gap-0.5"
                >
                  <Copy size={10} />
                  Copy
                </button>
              </div>
              <pre className="px-2 py-1.5 text-[10px] font-mono text-slate-800 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {b.value}
              </pre>
              {b.help && <p className="px-2 pb-1.5 text-[10px] text-slate-500">{b.help}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function credsTemplateFor(provider: string): string {
  if (provider === 'aws_inspector') {
    return JSON.stringify(
      {
        role_arn: 'arn:aws:iam::123456789012:role/grc-inspector',
        external_id: 'replace-with-per-tenant-uuid',
        regions: ['us-east-1', 'us-west-2'],
      },
      null,
      2,
    );
  }
  if (provider === 'azure_defender') {
    return JSON.stringify(
      {
        tenant_id: '00000000-0000-0000-0000-000000000000',
        client_id: '00000000-0000-0000-0000-000000000000',
        client_secret: 'service-principal-secret',
        subscription_id: '00000000-0000-0000-0000-000000000000',
      },
      null,
      2,
    );
  }
  if (provider === 'gcp_scc') {
    return JSON.stringify(
      {
        organization_id: '123456789012',
        service_account_json: '{ ...paste service-account JSON here... }',
      },
      null,
      2,
    );
  }
  return '{}';
}
