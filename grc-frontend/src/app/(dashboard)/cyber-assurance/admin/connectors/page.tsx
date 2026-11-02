'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plug, Plus, RefreshCw, CheckCircle, AlertCircle, Loader2, X, ExternalLink,
  Ticket, Activity, ShieldAlert, MessageSquare, Mic, BookOpenCheck, Trash2, Radar, Gauge, Cloud, ShieldBan, Cpu, Fingerprint, Globe,
} from 'lucide-react';
import {
  connectorsApi, integrationsApi, cloudConnectorsApi,
  type ConnectorProviderMeta, type ConnectorRow, type CloudConnector,
} from '@/cyber-assurance/lib/api';
import { useToast } from '@/cyber-assurance/components/ui/ToastProvider';
import { AwsIcon, AzureIcon, GcpIcon, NessusIcon } from '@/cyber-assurance/components/integrations/ProviderIcons';

// Visual metadata per category — drives the section header + icon per card.
const CATEGORY_META: Record<string, { label: string; icon: typeof Ticket; description: string; }> = {
  ticketing:  { label: 'Ticketing',     icon: Ticket,         description: 'Push vulnerabilities and exceptions to your ITSM. Two-way status sync.' },
  siem:       { label: 'SIEM',          icon: Activity,       description: 'Pull active-exploitation signals to enrich vulnerability priority.' },
  edr:        { label: 'Endpoint / EDR', icon: Cpu,           description: 'Pull endpoint detections and host posture to enrich vulnerability priority.' },
  identity:   { label: 'Identity',      icon: Fingerprint,    description: 'Pull sign-in and audit telemetry from your IdP to flag risky identity activity.' },
  pentest:    { label: 'Pen-test',      icon: ShieldAlert,    description: 'Pull confirmed exploit sessions to boost vulnerability priority.' },
  collab:     { label: 'Collaboration', icon: MessageSquare,  description: 'Post alerts and findings to your team channels.' },
  transcribe: { label: 'Transcription', icon: Mic,            description: 'Pull meeting transcripts to auto-create committee meeting minutes.' },
  easm_source: { label: 'Attack surface', icon: Radar,      description: 'Passive internet data (Shodan, Censys, SecurityTrails) for asset discovery and supplier scans.' },
  security_rating: { label: 'Security ratings', icon: Gauge, description: "Read each supplier's rating from UpGuard, SecurityScorecard or BitSight." },
  saas_discovery: { label: 'SaaS discovery', icon: Cloud, description: 'Bring the apps your people use (Grip Security) into Shadow SaaS for a decision.' },
  web_gateway: { label: 'Web gateway', icon: ShieldBan, description: 'Block the domain of an app third-party risk denies (Zscaler Internet Access).' },
};

const CATEGORY_ORDER = ['ticketing', 'siem', 'edr', 'identity', 'pentest', 'collab', 'transcribe', 'easm_source', 'security_rating', 'saas_discovery', 'web_gateway'] as const;

// Official brand logos, bundled locally in /public/logos/connectors (no runtime
// CDN, no CSP concern). Keyed by provider id. SVGs are monochrome marks; PNGs are
// the vendor's own logo. A provider with no entry (or a logo that fails to load)
// falls back to its category icon — never a broken image.
const PROVIDER_LOGO: Record<string, string> = {
  okta: 'okta.svg', splunk: 'splunk.svg', zoom: 'zoom.svg', metasploit: 'metasploit.svg',
  crowdstrike: 'crowdstrike.png', servicenow: 'servicenow.png', censys: 'censys.png',
  fireflies: 'fireflies.png', sentinelone: 'sentinelone.png', wazuh: 'wazuh.png',
  qradar: 'qradar.png', msteams: 'msteams.png', office365: 'office365.png',
  defender: 'defender.png', core_impact: 'core_impact.png', halo_itsm: 'halo_itsm.png',
  entra: 'entra.png', shodan: 'shodan.png', securitytrails: 'securitytrails.png',
  bmc_remedy: 'bmc_remedy.png',
};

function ProviderLogo({ provider }: { provider: ConnectorProviderMeta }) {
  const [failed, setFailed] = useState(false);
  const file = PROVIDER_LOGO[provider.provider];
  const Fallback = CATEGORY_META[provider.category]?.icon ?? Plug;
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
      {file && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/logos/connectors/${file}`} alt=""
          className="h-5 w-5 object-contain" onError={() => setFailed(true)} />
      ) : (
        <Fallback className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
      )}
    </div>
  );
}

const CLOUD_PROVIDERS = [
  { provider: 'aws_inspector', label: 'AWS Inspector v2', icon: AwsIcon, description: 'Cross-account assume-role — we never store an AWS access key.' },
  { provider: 'azure_defender', label: 'Microsoft Defender for Cloud', icon: AzureIcon, description: 'Service principal scoped to Security Reader; secret encrypted at rest.' },
  { provider: 'gcp_scc', label: 'Google Cloud SCC', icon: GcpIcon, description: 'Service-account JSON key, scoped to org-level read-only roles.' },
] as const;

export default function ConnectorsAdminPage() {
  const [openSetupFor, setOpenSetupFor] = useState<ConnectorProviderMeta | null>(null);
  const [editingConnector, setEditingConnector] = useState<ConnectorRow | null>(null);

  const { data: catalog, isLoading: catalogLoading } = useQuery({
    queryKey: ['connectors', 'providers'],
    queryFn: async () => (await connectorsApi.listProviders()).data,
  });

  const { data: connections, isLoading: connsLoading } = useQuery({
    queryKey: ['connectors', 'list'],
    queryFn: async () => (await connectorsApi.list()).data.items,
  });

  // Group existing connections by provider so each provider card can show
  // how many connections of that kind the tenant already has.
  const connectionsByProvider = useMemo(() => {
    const map: Record<string, ConnectorRow[]> = {};
    for (const c of connections || []) {
      (map[c.provider] ||= []).push(c);
    }
    return map;
  }, [connections]);

  const isLoading = catalogLoading || connsLoading;

  return (
    <div className="space-y-3">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Plug className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
            Connectors
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every integration in one place — ticketing, SIEM, EDR, identity, pen-test, vulnerability
            scanners and cloud. Credentials are encrypted at rest; OAuth2 authorises per-tenant.
          </p>
        </div>
        {catalog && !catalog.encryption_enabled && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircle className="h-4 w-4" />
            <span>
              <strong>Dev mode:</strong> CONNECTOR_MASTER_KEY not set. Credentials are stored unencrypted.
            </span>
          </div>
        )}
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading provider catalogue…
        </div>
      )}

      {catalog && CATEGORY_ORDER.map((category) => {
        const providers = catalog.providers.filter((p) => p.category === category);
        if (providers.length === 0) return null;
        const meta = CATEGORY_META[category];
        const Icon = meta.icon;
        return (
          <section key={category} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-slate-500" />
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                {meta.label}
              </h3>
              <span className="text-xs text-slate-400">— {meta.description}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {providers.map((p) => (
                <ProviderCard
                  key={p.provider}
                  provider={p}
                  connections={connectionsByProvider[p.provider] || []}
                  onAdd={() => setOpenSetupFor(p)}
                  onEdit={(c) => setEditingConnector(c)}
                />
              ))}
              {/* Nessus sits with the offensive-security tools; its connections show inline. */}
              {category === 'pentest' && <ScannerCard />}
            </div>
          </section>
        );
      })}

      {/* Cloud posture — each provider shows its own connectors inline. */}
      {catalog && (
        <section className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-slate-500" />
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Cloud</h3>
            <span className="text-xs text-slate-400">— Pull vulnerability findings from your cloud security posture (AWS / Azure / GCP).</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {CLOUD_PROVIDERS.map((p) => (
              <CloudProviderCard key={p.provider} provider={p.provider} label={p.label} icon={p.icon} description={p.description} />
            ))}
          </div>
        </section>
      )}

      {openSetupFor && (
        <SetupModal
          provider={openSetupFor}
          existing={null}
          onClose={() => setOpenSetupFor(null)}
        />
      )}
      {editingConnector && catalog && (
        (() => {
          const meta = catalog.providers.find((p) => p.provider === editingConnector.provider);
          if (!meta) return null;
          return (
            <SetupModal
              provider={meta}
              existing={editingConnector}
              onClose={() => setEditingConnector(null)}
            />
          );
        })()
      )}
    </div>
  );
}

// ─── Inline connection row (shared by scanner + cloud cards) ─────────

function ConnRow({ name, status, onTest, testing, onSync, syncing, onRemove }: {
  name: string; status: string;
  onTest: () => void; testing?: boolean;
  onSync: () => void; syncing?: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <StatusDot status={status} />
      <span className="flex-1 truncate text-left text-slate-700" title={status}>{name}</span>
      <button type="button" onClick={onTest} disabled={testing} className="text-slate-400 hover:text-primary-600" title="Test / health-check">
        {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpenCheck className="h-3 w-3" />}
      </button>
      <button type="button" onClick={onSync} disabled={syncing} className="text-slate-400 hover:text-primary-600" title="Sync now">
        {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      </button>
      <button type="button" onClick={onRemove} className="text-slate-400 hover:text-rose-600" title="Remove">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── Nessus (vulnerability scanner) card — inline connections ────────

type ScannerConn = { id: number; connection_name: string; status: string };

function ScannerCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['connections'],
    queryFn: () => integrationsApi.listConnections({ scanners_only: true }),
  });
  const conns: ScannerConn[] = (data?.data?.connections ?? []) as ScannerConn[];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['connections'] });

  const testM = useMutation({
    mutationFn: (id: number) => integrationsApi.testConnection(id),
    onSuccess: (r) => { toast({ title: r?.data?.success ? 'Connection OK' : 'Connection failed', message: r?.data?.message }); invalidate(); },
  });
  const syncM = useMutation({ mutationFn: (id: number) => integrationsApi.triggerSync(id), onSuccess: () => { toast({ title: 'Sync queued' }); invalidate(); } });
  const delM = useMutation({ mutationFn: (id: number) => integrationsApi.deleteConnection(id, true), onSuccess: () => { toast({ title: 'Connection removed' }); invalidate(); } });

  return (
    <div className="group rounded-xl border border-slate-200 bg-white p-3 transition-all hover:border-[var(--color-base)] hover:shadow-sm">
      <div className="flex items-start gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
          <NessusIcon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="truncate text-sm font-semibold text-slate-900">Tenable Nessus</h4>
            {conns.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                <CheckCircle className="h-2.5 w-2.5" />{conns.length} connected
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Authenticated vulnerability scanner. Pull findings into the register; two-way sync and auto-close on re-scan.</p>
        </div>
      </div>

      {conns.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {conns.map((c) => (
            <ConnRow key={c.id} name={c.connection_name} status={c.status}
              onTest={() => testM.mutate(c.id)} testing={testM.isPending}
              onSync={() => syncM.mutate(c.id)} syncing={syncM.isPending}
              onRemove={() => { if (confirm(`Remove "${c.connection_name}"?`)) delM.mutate(c.id); }} />
          ))}
        </div>
      )}

      <button type="button" onClick={() => setAddOpen(true)}
        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-primary-400 hover:text-primary-600 transition-colors">
        <Plus className="h-3.5 w-3.5" /> Add Nessus connection
      </button>

      {addOpen && <ScannerAddModal onClose={() => setAddOpen(false)} onSaved={() => { invalidate(); setAddOpen(false); }} />}
    </div>
  );
}

// ─── Cloud posture card (per provider) — inline connectors ───────────

function CloudProviderCard({ provider, label, icon: Icon, description }: {
  provider: string; label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);

  const { data } = useQuery({ queryKey: ['cloud-connectors'], queryFn: () => cloudConnectorsApi.list() });
  const all: CloudConnector[] = data?.data ?? [];
  const conns = all.filter((c) => c.provider === provider);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['cloud-connectors'] });

  const statusOf = (c: CloudConnector): string =>
    !c.is_active ? 'disconnected'
      : c.last_health_status === 'healthy' ? 'connected'
      : c.last_health_status ? 'error'
      : 'pending';

  const hcM = useMutation({ mutationFn: (id: number) => cloudConnectorsApi.healthCheck(id), onSuccess: (r) => { toast({ title: `Health: ${r?.data?.status ?? 'checked'}`, message: r?.data?.detail }); invalidate(); } });
  const syncM = useMutation({ mutationFn: (id: number) => cloudConnectorsApi.sync(id), onSuccess: () => { toast({ title: 'Sync queued' }); invalidate(); } });
  const delM = useMutation({ mutationFn: (id: number) => cloudConnectorsApi.delete(id), onSuccess: () => { toast({ title: 'Connector removed' }); invalidate(); } });

  return (
    <div className="group rounded-xl border border-slate-200 bg-white p-3 transition-all hover:border-[var(--color-base)] hover:shadow-sm">
      <div className="flex items-start gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="truncate text-sm font-semibold text-slate-900">{label}</h4>
            {conns.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                <CheckCircle className="h-2.5 w-2.5" />{conns.length} connected
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
        </div>
      </div>

      {conns.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {conns.map((c) => (
            <ConnRow key={c.id} name={c.display_name} status={statusOf(c)}
              onTest={() => hcM.mutate(c.id)} testing={hcM.isPending}
              onSync={() => syncM.mutate(c.id)} syncing={syncM.isPending}
              onRemove={() => { if (confirm(`Delete connector "${c.display_name}"? This won't remove assets or vulns it has synced.`)) delM.mutate(c.id); }} />
          ))}
        </div>
      )}

      <button type="button" onClick={() => setAddOpen(true)}
        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-primary-400 hover:text-primary-600 transition-colors">
        <Plus className="h-3.5 w-3.5" /> Add {label} connection
      </button>

      {addOpen && <CloudAddModal provider={provider} label={label} onClose={() => setAddOpen(false)} onSaved={() => { invalidate(); setAddOpen(false); }} />}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'connected' ? 'bg-emerald-500' :
    status === 'error' ? 'bg-rose-500' :
    status === 'disconnected' ? 'bg-slate-400' :
    'bg-amber-400';
  return <span className={`h-1.5 w-1.5 rounded-full ${color} shrink-0`} title={status} />;
}

// ─── Modal shell (shared by the scanner + cloud add modals) ──────────

function ModalShell({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-xl bg-white shadow-2xl flex flex-col">
        <header className="flex items-start justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const INPUT_CLS = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

// ─── Scanner (Nessus) add modal ──────────────────────────────────────

function ScannerAddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: (data: Record<string, unknown>) => integrationsApi.createConnection(data),
    onSuccess: (r) => {
      const res = r?.data?.test_result ?? r?.data;
      toast({ title: 'Nessus connection created', message: res?.message });
      onSaved();
    },
    onError: (err: any) => toast({ title: 'Create failed', message: err?.response?.data?.detail || String(err) }),
  });

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // Payload copied verbatim from the old scanner page's handleCreate.
    m.mutate({
      connection_name: f.get('connection_name') as string,
      integration_type: 'nessus',
      console_url: f.get('console_url') as string,
      console_port: parseInt(f.get('console_port') as string) || 8834,
      access_key: (f.get('access_key') as string) || undefined,
      secret_key: (f.get('secret_key') as string) || undefined,
      api_key: (f.get('api_key') as string) || undefined,
      username: (f.get('username') as string) || undefined,
      password: (f.get('password') as string) || undefined,
      sync_schedule: (f.get('sync_schedule') as string) || '0 */4 * * *',
    });
  };

  return (
    <ModalShell title="Add Tenable Nessus connection" subtitle="Authenticated scanner — credentials encrypted at rest." onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Connection name <span className="text-rose-500">*</span></label>
            <input name="connection_name" required className={INPUT_CLS} placeholder="Production Nessus" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Console URL <span className="text-rose-500">*</span></label>
            <input name="console_url" type="url" required className={INPUT_CLS} placeholder="https://nessus.company.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Console port</label>
            <input name="console_port" defaultValue="8834" className={INPUT_CLS} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Access key <span className="ml-1 text-[10px] font-normal text-slate-400">(Tenable API)</span></label>
              <input name="access_key" type="password" className={INPUT_CLS} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Secret key</label>
              <input name="secret_key" type="password" className={INPUT_CLS} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Username <span className="ml-1 text-[10px] font-normal text-slate-400">(optional)</span></label>
              <input name="username" className={INPUT_CLS} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Password <span className="ml-1 text-[10px] font-normal text-slate-400">(optional)</span></label>
              <input name="password" type="password" className={INPUT_CLS} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Sync schedule (cron)</label>
            <input name="sync_schedule" defaultValue="0 */4 * * *" className={INPUT_CLS} />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} disabled={m.isPending} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={m.isPending} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50">
            {m.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating + testing…</> : <><CheckCircle className="h-4 w-4" /> Create connection</>}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}

// ─── Cloud add modal ─────────────────────────────────────────────────

function CloudAddModal({ provider, label, onClose, onSaved }: {
  provider: string; label: string; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState('');
  const [creds, setCreds] = useState('{}');
  const [hours, setHours] = useState(6);

  // Prefill the credentials JSON with the provider's template (stamps the
  // tenant's stable External ID etc.) so the user only fills their own values.
  const { data: setup } = useQuery({
    queryKey: ['cloud-setup', provider],
    queryFn: () => cloudConnectorsApi.setupInfo(provider).then((r) => r.data),
  });
  useEffect(() => {
    if (setup?.credentials_template) setCreds(JSON.stringify(setup.credentials_template, null, 2));
  }, [setup]);

  const m = useMutation({
    mutationFn: (payload: Parameters<typeof cloudConnectorsApi.create>[0]) => cloudConnectorsApi.create(payload),
    onSuccess: () => { toast({ title: `${label} connector created` }); onSaved(); },
    onError: (err: any) => toast({ title: 'Create failed', message: err?.response?.data?.detail || String(err) }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(creds); } catch { toast({ title: 'Credentials must be valid JSON.' }); return; }
    m.mutate({ provider, display_name: displayName, credentials: parsed, sync_schedule_seconds: hours * 3600 });
  };

  return (
    <ModalShell title={`Add ${label} connection`} subtitle="Read-only cloud posture — credentials encrypted at rest." onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Display name <span className="text-rose-500">*</span></label>
            <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={INPUT_CLS} placeholder={`${label} (primary)`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Credentials (JSON)</label>
            <textarea value={creds} onChange={(e) => setCreds(e.target.value)} rows={8}
              className={`${INPUT_CLS} font-mono text-xs`} spellCheck={false} />
            {setup?.security_summary && (
              <p className="mt-1 text-[11px] text-slate-500">{setup.security_summary}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Sync schedule (hours)</label>
            <input type="number" min={1} value={hours} onChange={(e) => setHours(parseInt(e.target.value) || 6)} className={INPUT_CLS} />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} disabled={m.isPending} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={m.isPending} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50">
            {m.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : <><CheckCircle className="h-4 w-4" /> Create connector</>}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}

// ─── Provider card (registry connectors) ──────────────────────────────

interface ProviderCardProps {
  provider: ConnectorProviderMeta;
  connections: ConnectorRow[];
  onAdd: () => void;
  onEdit: (c: ConnectorRow) => void;
}

function ProviderCard({ provider, connections, onAdd, onEdit }: ProviderCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const testMutation = useMutation({
    mutationFn: (id: number) => connectorsApi.test(id),
    onSuccess: (resp) => {
      toast({
        title: resp.data.success ? 'Connection OK' : 'Connection failed',
        message: resp.data.message,
      });
      queryClient.invalidateQueries({ queryKey: ['connectors', 'list'] });
    },
  });
  const syncMutation = useMutation({
    mutationFn: (id: number) => connectorsApi.sync(id),
    onSuccess: () => {
      toast({ title: 'Sync queued' });
      queryClient.invalidateQueries({ queryKey: ['connectors', 'list'] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => connectorsApi.remove(id),
    onSuccess: () => {
      toast({ title: 'Connector removed' });
      queryClient.invalidateQueries({ queryKey: ['connectors', 'list'] });
    },
  });

  return (
    <div className="group rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-[var(--color-base)] hover:shadow-sm">
      <div className="flex items-start gap-3">
        <ProviderLogo provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="truncate text-sm font-semibold text-slate-900">{provider.label}</h4>
            {connections.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                <CheckCircle className="h-2.5 w-2.5" />{connections.length} connected
              </span>
            )}
            {provider.beta && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase bg-amber-100 text-amber-700">
                Beta
              </span>
            )}
            {provider.auth_method === 'oauth2' && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-base-soft)] text-[var(--color-base)]">
                OAuth2
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{provider.description}</p>
        </div>
        {provider.docs_url && (
          <a
            href={provider.docs_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-slate-400 hover:text-[var(--color-base)]"
            title="Vendor docs"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {connections.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {connections.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <StatusDot status={c.status} />
              <button
                type="button"
                onClick={() => onEdit(c)}
                className="flex-1 text-left text-slate-700 hover:text-primary-600 truncate"
              >
                {c.connection_name}
              </button>
              <button
                type="button"
                onClick={() => testMutation.mutate(c.id)}
                disabled={testMutation.isPending}
                className="text-slate-400 hover:text-primary-600"
                title="Test"
              >
                {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpenCheck className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => syncMutation.mutate(c.id)}
                disabled={syncMutation.isPending}
                className="text-slate-400 hover:text-primary-600"
                title="Sync now"
              >
                {syncMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => { if (confirm(`Remove "${c.connection_name}"?`)) deleteMutation.mutate(c.id); }}
                className="text-slate-400 hover:text-rose-600"
                title="Remove"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onAdd}
        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-primary-400 hover:text-primary-600 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Add {provider.label} connection
      </button>
    </div>
  );
}

// ─── Setup modal (registry connectors) ────────────────────────────────

interface SetupModalProps {
  provider: ConnectorProviderMeta;
  existing: ConnectorRow | null;
  onClose: () => void;
}

function SetupModal({ provider, existing, onClose }: SetupModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isEdit = Boolean(existing);

  const [connectionName, setConnectionName] = useState(existing?.connection_name || `${provider.label} (primary)`);
  // Pre-fill with existing console_url + non-credential config; credentials
  // never round-trip back from the API.
  const initialFields: Record<string, string> = {};
  if (existing?.console_url) initialFields.console_url = existing.console_url;
  if (existing?.provider_config) {
    for (const [k, v] of Object.entries(existing.provider_config)) {
      if (k.startsWith('_')) continue;
      initialFields[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
  }
  const [fields, setFields] = useState<Record<string, string>>(initialFields);

  const setField = (key: string, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const createMutation = useMutation({
    mutationFn: () => connectorsApi.create({
      provider: provider.provider,
      connection_name: connectionName,
      console_url: fields.console_url,
      fields,
    }),
    onSuccess: (resp) => {
      const result = resp.data.test_result;
      toast({
        title: result.success ? 'Connector created — connection OK' : 'Connector created — test failed',
        message: result.message,
      });
      queryClient.invalidateQueries({ queryKey: ['connectors', 'list'] });
      if (provider.auth_method === 'oauth2' && resp.data.connection.id) {
        // For OAuth2 providers, kick off the consent flow right after save.
        connectorsApi.oauthStart(provider.provider, resp.data.connection.id).then((r) => {
          window.open(r.data.authorize_url, '_blank', 'noopener,width=720,height=820');
        }).catch((err) => {
          toast({
            title: 'OAuth start failed',
            message: err?.response?.data?.detail || String(err),
          });
        });
      }
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Connector creation failed',
        message: err?.response?.data?.detail || String(err),
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => connectorsApi.update(existing!.id, {
      connection_name: connectionName,
      console_url: fields.console_url,
      fields,
    }),
    onSuccess: () => {
      toast({ title: 'Connector updated' });
      queryClient.invalidateQueries({ queryKey: ['connectors', 'list'] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit) updateMutation.mutate(); else createMutation.mutate();
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-white shadow-2xl flex flex-col">
        <header className="flex items-start justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              {isEdit ? 'Edit' : 'Add'} {provider.label} connection
              {provider.beta && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 uppercase">
                  Beta
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 mt-1">{provider.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Connection name
            </label>
            <input
              type="text"
              required
              value={connectionName}
              onChange={(e) => setConnectionName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder={`${provider.label} (primary)`}
            />
            <p className="mt-1 text-xs text-slate-500">
              A label for this connection. You can wire multiple {provider.label} connections (e.g. dev and prod).
            </p>
          </div>

          {provider.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {field.label}
                {field.required && <span className="text-rose-500 ml-0.5">*</span>}
                {field.is_credential && !isEdit && (
                  <span className="ml-2 text-[10px] font-normal text-slate-400">(encrypted at rest)</span>
                )}
                {field.is_credential && isEdit && (
                  <span className="ml-2 text-[10px] font-normal text-slate-400">(leave blank to keep existing)</span>
                )}
              </label>
              {field.kind === 'textarea' ? (
                <textarea
                  required={field.required && !isEdit}
                  value={fields[field.key] || ''}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              ) : (
                <input
                  type={field.kind === 'password' ? 'password' : field.kind === 'url' ? 'url' : 'text'}
                  required={field.required && (!isEdit || !field.is_credential)}
                  value={fields[field.key] || ''}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              )}
              {field.help_text && (
                <p className="mt-1 text-xs text-slate-500">{field.help_text}</p>
              )}
            </div>
          ))}

          {provider.auth_method === 'oauth2' && !isEdit && (
            <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-xs text-primary-800">
              <strong>OAuth2 flow:</strong> after saving, a popup will open the {provider.label} consent screen.
              Authorise once and refresh tokens are stored encrypted for ongoing sync.
            </div>
          )}
        </form>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEdit ? 'Saving…' : 'Creating + testing…'}
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4" />
                {isEdit ? 'Save changes' : 'Create connector'}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
