'use client';

// Data providers — per-tenant Thomson Reuters / LSEG connections (World-Check One,
// CLEAR, Regulatory Intelligence). Secrets are write-only: the API reports which
// fields are stored, never their values. "Simulated" mode needs no credentials and
// labels everything it produces as SIMULATED.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Database, KeyRound, Loader2, PlugZap, Save, ShieldAlert, XCircle } from 'lucide-react';
import { trDataApi, type TrProvider } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { DOMAIN_LABELS, fmtDate } from '../_lib/tprmShared';

interface Field {
  key: string; label: string; kind: string; secret: boolean; required: boolean;
  help_text?: string | null; options: { value: string; label: string }[]; default?: unknown;
}
export interface ProviderConnection {
  provider: TrProvider; label: string; vendor: string; category: string; module: string; description: string;
  credential_fields: Field[]; config_fields: Field[]; default_base_url: string; docs_url?: string;
  encryption_configured: boolean; configured: boolean; is_active: boolean; mode: 'simulated' | 'live' | null;
  base_url?: string | null; config: Record<string, unknown>; credentials_set: Record<string, boolean>;
  status: string; last_tested_at?: string | null; last_success_at?: string | null; last_error?: string | null;
}

const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-50';
const HIT_CLASSES = ['sanctions', 'law_enforcement', 'pep', 'adverse_media', 'other'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

function StatusChip({ c }: { c: ProviderConnection }) {
  if (!c.configured) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">Not configured</span>;
  if (!c.is_active) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">Disabled</span>;
  const mode = c.mode === 'live'
    ? <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">Live</span>
    : <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">Simulated</span>;
  const health = c.status === 'connected'
    ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Connected</span>
    : c.status === 'error'
      ? <span className="inline-flex items-center gap-1 text-[11px] text-red-600"><XCircle className="h-3 w-3" /> Error</span>
      : <span className="text-[11px] text-gray-500">Not tested</span>;
  return <span className="inline-flex items-center gap-2">{mode}{health}</span>;
}

function ProviderCard({ conn, canEdit }: { conn: ProviderConnection; canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [mode, setMode] = useState<'simulated' | 'live'>(conn.mode || 'simulated');
  const [active, setActive] = useState<boolean>(conn.configured ? conn.is_active : true);
  const [baseUrl, setBaseUrl] = useState(conn.base_url || '');
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, unknown>>(conn.config || {});
  const [groups, setGroups] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    setMode(conn.mode || 'simulated');
    setActive(conn.configured ? conn.is_active : true);
    setBaseUrl(conn.base_url || '');
    setConfig(conn.config || {});
    setSecrets({});
  }, [conn]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['tr-connections'] });

  const save = useMutation({
    mutationFn: () => trDataApi.saveConnection(conn.provider, {
      mode, is_active: active, base_url: baseUrl,
      credentials: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)),
      config,
    }),
    onSuccess: () => { refresh(); toast({ type: 'success', title: `${conn.label} saved` }); },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });
  const test = useMutation({
    mutationFn: () => trDataApi.testConnection(conn.provider),
    onSuccess: (res) => {
      refresh();
      const d = res.data as { ok: boolean; message: string };
      toast({ type: d.ok ? 'success' : 'error', title: d.ok ? 'Connection OK' : 'Connection failed', message: d.message });
    },
    onError: (e) => toast({ type: 'error', title: 'Test failed', message: errMsg(e, 'Save the connection first.') }),
  });
  const loadGroups = useMutation({
    mutationFn: () => trDataApi.wc1Groups(),
    onSuccess: (res) => setGroups((res.data as { items: { id: string; name: string }[] }).items),
    onError: (e) => toast({ type: 'error', title: 'Could not load groups', message: errMsg(e, 'Save and test the connection first.') }),
  });

  const setCfg = (k: string, v: unknown) => setConfig((c) => ({ ...c, [k]: v }));
  const disabled = !canEdit;

  const renderConfig = (f: Field) => {
    const val = config[f.key];
    if (f.kind === 'toggle') {
      return (
        <label key={f.key} className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" disabled={disabled} checked={!!val} onChange={(e) => setCfg(f.key, e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600" />
          {f.label}
        </label>
      );
    }
    if (f.kind === 'multiselect') {
      const list = Array.isArray(val) ? (val as string[]) : [];
      return (
        <fieldset key={f.key}>
          <legend className="mb-1 text-xs font-medium text-gray-700">{f.label}</legend>
          <div className="flex flex-wrap gap-3">
            {f.options.map((o) => (
              <label key={o.value} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="checkbox" disabled={disabled} checked={list.includes(o.value)}
                  onChange={(e) => setCfg(f.key, e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600" />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    if (f.kind === 'finding_map') {
      const map = (val && typeof val === 'object' ? val : {}) as Record<string, { severity?: string; domain?: string }>;
      const defaults: Record<string, { severity: string; domain: string }> = {
        sanctions: { severity: 'critical', domain: 'compliance' }, law_enforcement: { severity: 'high', domain: 'compliance' },
        pep: { severity: 'high', domain: 'compliance' }, adverse_media: { severity: 'medium', domain: 'reputational' },
        other: { severity: 'medium', domain: 'compliance' },
      };
      const update = (hc: string, k: 'severity' | 'domain', v: string) =>
        setCfg(f.key, { ...map, [hc]: { ...defaults[hc], ...map[hc], [k]: v } });
      return (
        <div key={f.key}>
          <p className="mb-1 text-xs font-medium text-gray-700">{f.label}</p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr><th className="px-3 py-2 text-left font-medium">Confirmed hit</th><th className="px-3 py-2 text-left font-medium">Finding severity</th><th className="px-3 py-2 text-left font-medium">Risk domain</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {HIT_CLASSES.map((hc) => {
                  const row = { ...defaults[hc], ...(map[hc] || {}) };
                  return (
                    <tr key={hc}>
                      <td className="px-3 py-1.5 capitalize text-gray-700">{hc.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-1.5">
                        <select aria-label={`${hc} finding severity`} disabled={disabled} value={row.severity}
                          onChange={(e) => update(hc, 'severity', e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs">
                          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <select aria-label={`${hc} risk domain`} disabled={disabled} value={row.domain}
                          onChange={(e) => update(hc, 'domain', e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs">
                          {Object.entries(DOMAIN_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {f.help_text && <p className="mt-1 text-[11px] text-gray-500">{f.help_text}</p>}
        </div>
      );
    }
    const isGroup = conn.provider === 'lseg_world_check_one' && f.key === 'group_id';
    return (
      <div key={f.key}>
        <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor={`${conn.provider}-${f.key}`}>{f.label}</label>
        <div className="flex gap-2">
          {isGroup && groups ? (
            <select id={`${conn.provider}-${f.key}`} disabled={disabled} className={inputCls} value={String(val ?? '')}
              onChange={(e) => setCfg(f.key, e.target.value)}>
              <option value="">Select a group…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
            </select>
          ) : (
            <input id={`${conn.provider}-${f.key}`} disabled={disabled} className={inputCls} value={String(val ?? '')}
              onChange={(e) => setCfg(f.key, e.target.value)} />
          )}
          {isGroup && (
            <button type="button" onClick={() => loadGroups.mutate()} disabled={disabled || loadGroups.isPending || !conn.configured}
              className="whitespace-nowrap rounded-lg border border-gray-300 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {loadGroups.isPending ? 'Loading…' : 'Load groups'}
            </button>
          )}
        </div>
        {f.help_text && <p className="mt-1 text-[11px] text-gray-500">{f.help_text}</p>}
      </div>
    );
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white" aria-labelledby={`prov-${conn.provider}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <h3 id={`prov-${conn.provider}`} className="text-sm font-semibold text-slate-900">
            {conn.label} <span className="font-normal text-gray-500">· {conn.vendor}</span>
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">{conn.description}</p>
        </div>
        <StatusChip c={conn} />
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="inline-flex rounded-lg border border-gray-300 p-0.5" role="radiogroup" aria-label={`${conn.label} mode`}>
            {(['simulated', 'live'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={disabled} onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${mode === m ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                {m}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" disabled={disabled} checked={active} onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600" /> Enabled
          </label>
        </div>

        {mode === 'simulated' ? (
          <p className="rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-xs text-violet-800">
            Simulated mode makes no external calls. It returns fictitious, deterministic data (labelled SIMULATED everywhere) so
            the workflow can be demonstrated and tested before you have {conn.vendor.split(' (')[0]} credentials.
          </p>
        ) : (
          <>
            {!conn.encryption_configured && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                Encrypted credential storage is not configured on the server (CONNECTOR_MASTER_KEY). Live credentials cannot be saved until it is.
              </p>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor={`${conn.provider}-base`}>Base URL</label>
              <input id={`${conn.provider}-base`} disabled={disabled} className={inputCls} value={baseUrl}
                placeholder={conn.default_base_url} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {conn.credential_fields.map((f) => {
                const stored = !!conn.credentials_set?.[f.key];
                const common = {
                  id: `${conn.provider}-${f.key}`, disabled, className: inputCls, autoComplete: 'off',
                  value: secrets[f.key] || '',
                  placeholder: stored ? '•••••••• stored — leave blank to keep' : (f.required ? 'Required' : 'Optional'),
                };
                return (
                  <div key={f.key} className={f.kind === 'textarea' ? 'sm:col-span-2' : ''}>
                    <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-700" htmlFor={common.id}>
                      <KeyRound className="h-3 w-3" /> {f.label}
                      {stored && <span className="ml-1 rounded bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700">stored</span>}
                    </label>
                    {f.kind === 'textarea'
                      ? <textarea {...common} rows={3} onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))} />
                      : <input {...common} type="password" onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))} />}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {conn.config_fields.length > 0 && (
          <div className="space-y-3 border-t border-gray-100 pt-4">{conn.config_fields.map(renderConfig)}</div>
        )}

        {conn.last_error && conn.status === 'error' && (
          <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {conn.last_error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-gray-400">
            {conn.last_success_at ? `Last successful call ${fmtDate(conn.last_success_at)}` : 'No successful call yet'}
            {conn.docs_url && <> · <a href={conn.docs_url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">API docs</a></>}
          </p>
          {canEdit && (
            <div className="flex gap-2">
              <button type="button" onClick={() => test.mutate()} disabled={!conn.configured || test.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Test connection
              </button>
              <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function DataProviders() {
  const { hasAnyPermission } = usePermissions();
  const canEdit = hasAnyPermission(['vendor_risk:integrations:manage', 'integrations:connections:edit']);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tr-connections'],
    queryFn: async () => (await trDataApi.listConnections()).data as { items: ProviderConnection[] },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
        <h2 className="text-sm font-semibold text-slate-900">Data providers</h2>
      </div>
      <p className="text-xs text-gray-500">
        Thomson Reuters / LSEG connections for this tenant: sanctions/PEP screening, due-diligence enrichment and
        regulatory-change content. Credentials belong to your organisation&apos;s own subscriptions.
      </p>
      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading providers…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load data providers. <button onClick={() => refetch()} className="font-medium underline">Retry</button>
        </div>
      ) : (
        (data?.items || []).map((c) => <ProviderCard key={c.provider} conn={c} canEdit={canEdit} />)
      )}
    </div>
  );
}
