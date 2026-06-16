'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plug, Plus, RefreshCw, CheckCircle, AlertCircle, Loader2, X, ExternalLink,
  Ticket, Activity, ShieldAlert, MessageSquare, Mic, BookOpenCheck, Trash2,
} from 'lucide-react';
import { connectorsApi, type ConnectorProviderMeta, type ConnectorRow } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';

// Visual metadata per category — drives the tab pills and icon per card.
const CATEGORY_META: Record<string, { label: string; icon: typeof Ticket; description: string; }> = {
  ticketing:  { label: 'Ticketing',     icon: Ticket,         description: 'Push vulnerabilities and exceptions to your ITSM. Two-way status sync.' },
  siem:       { label: 'SIEM',          icon: Activity,       description: 'Pull active-exploitation signals to enrich vulnerability priority.' },
  pentest:    { label: 'Pen-test',      icon: ShieldAlert,    description: 'Pull confirmed exploit sessions to boost vulnerability priority.' },
  collab:     { label: 'Collaboration', icon: MessageSquare,  description: 'Post alerts to channels, schedule committee meetings.' },
  transcribe: { label: 'Transcription', icon: Mic,            description: 'Pull meeting transcripts to auto-create committee meeting minutes.' },
};

const CATEGORY_ORDER = ['ticketing', 'siem', 'pentest', 'collab', 'transcribe'] as const;

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
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Plug className="h-5 w-5 text-blue-600" />
            External Connectors
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Wire ServiceNow, Splunk, MS Teams, Fireflies.ai and more. Credentials are encrypted at rest;
            OAuth2 connectors authorise per-tenant through their vendor's consent screen.
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
        <div className="flex items-center gap-2 text-sm text-gray-500">
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
          <section key={category} className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                {meta.label}
              </h3>
              <span className="text-xs text-gray-400">— {meta.description}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {providers.map((p) => (
                <ProviderCard
                  key={p.provider}
                  provider={p}
                  connections={connectionsByProvider[p.provider] || []}
                  onAdd={() => setOpenSetupFor(p)}
                  onEdit={(c) => setEditingConnector(c)}
                />
              ))}
            </div>
          </section>
        );
      })}

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

// ─── Provider card ────────────────────────────────────────────────

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
    onSuccess: (resp, id) => {
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
    <div className="rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-300 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900">{provider.label}</h4>
            {provider.beta && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 uppercase">
                Beta
              </span>
            )}
            {provider.auth_method === 'oauth2' && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                OAuth2
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{provider.description}</p>
        </div>
        {provider.docs_url && (
          <a
            href={provider.docs_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-600 shrink-0"
            title="Vendor docs"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {connections.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
          {connections.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <StatusDot status={c.status} />
              <button
                type="button"
                onClick={() => onEdit(c)}
                className="flex-1 text-left text-gray-700 hover:text-blue-600 truncate"
              >
                {c.connection_name}
              </button>
              <button
                type="button"
                onClick={() => testMutation.mutate(c.id)}
                disabled={testMutation.isPending}
                className="text-gray-400 hover:text-blue-600"
                title="Test"
              >
                {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpenCheck className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => syncMutation.mutate(c.id)}
                disabled={syncMutation.isPending}
                className="text-gray-400 hover:text-blue-600"
                title="Sync now"
              >
                {syncMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => { if (confirm(`Remove "${c.connection_name}"?`)) deleteMutation.mutate(c.id); }}
                className="text-gray-400 hover:text-red-600"
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
        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Add {provider.label} connection
      </button>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'connected' ? 'bg-green-500' :
    status === 'error' ? 'bg-red-500' :
    'bg-amber-400';
  return <span className={`h-1.5 w-1.5 rounded-full ${color} shrink-0`} title={status} />;
}

// ─── Setup modal ──────────────────────────────────────────────────

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
        <header className="flex items-start justify-between gap-2 border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              {isEdit ? 'Edit' : 'Add'} {provider.label} connection
              {provider.beta && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 uppercase">
                  Beta
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500 mt-1">{provider.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Connection name
            </label>
            <input
              type="text"
              required
              value={connectionName}
              onChange={(e) => setConnectionName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder={`${provider.label} (primary)`}
            />
            <p className="mt-1 text-xs text-gray-500">
              A label for this connection. You can wire multiple {provider.label} connections (e.g. dev and prod).
            </p>
          </div>

          {provider.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {field.label}
                {field.required && <span className="text-red-500 ml-0.5">*</span>}
                {field.is_credential && !isEdit && (
                  <span className="ml-2 text-[10px] font-normal text-gray-400">(encrypted at rest)</span>
                )}
                {field.is_credential && isEdit && (
                  <span className="ml-2 text-[10px] font-normal text-gray-400">(leave blank to keep existing)</span>
                )}
              </label>
              {field.kind === 'textarea' ? (
                <textarea
                  required={field.required && !isEdit}
                  value={fields[field.key] || ''}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              ) : (
                <input
                  type={field.kind === 'password' ? 'password' : field.kind === 'url' ? 'url' : 'text'}
                  required={field.required && (!isEdit || !field.is_credential)}
                  value={fields[field.key] || ''}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              )}
              {field.help_text && (
                <p className="mt-1 text-xs text-gray-500">{field.help_text}</p>
              )}
            </div>
          ))}

          {provider.auth_method === 'oauth2' && !isEdit && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
              <strong>OAuth2 flow:</strong> after saving, a popup will open the {provider.label} consent screen.
              Authorise once and refresh tokens are stored encrypted for ongoing sync.
            </div>
          )}
        </form>

        <footer className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
