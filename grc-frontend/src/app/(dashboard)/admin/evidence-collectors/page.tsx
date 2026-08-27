'use client';

// Administration → All Connections. Faithful to the Verity reference
// connections-page: Active/Available tabs, a search + category band, and a card
// grid (brand mark · name · status · category chips · "View and connect"). The
// view-and-connect modal shows what a provider syncs; for the connectors this
// platform's live_api engine supports it also configures credentials and runs a
// live Test / Collect (the GitHub end-to-end flow, unchanged).

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, X, Plug } from 'lucide-react';
import { automationApi } from '@/lib/api';
import { BrandLogo } from '@/components/integrations/BrandLogo';
import {
  CONNECTORS,
  CONNECTOR_CATEGORIES,
  type Connector,
} from '@/components/integrations/connector-catalogue';

// Reference catalogue id → this platform's live_api provider key. Only these are
// wired to the collector engine today; the rest render as "connecting soon",
// exactly as the reference does for its whole catalogue.
const SUPPORTED: Record<string, string> = {
  github: 'github', gitlab: 'gitlab', bitbucket: 'bitbucket', okta: 'okta',
  gws: 'google_workspace', cloudflare: 'cloudflare', heroku: 'heroku',
  digitalocean: 'digitalocean', datadog: 'datadog', sentry: 'sentry',
  pagerduty: 'pagerduty', jira: 'jira', linear: 'linear', asana: 'asana', slack: 'slack',
};

interface Collector {
  provider: string;
  connected: boolean;
  connection_id: number | null;
  last_run: { status: string; started_at?: string | null } | null;
}
interface Finding { control_codes?: string[]; check: string; resource?: string; status: string; detail?: string }

type Tab = 'active' | 'available';

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${connected ? 'text-emerald-600' : 'text-slate-400'}`}>
      <span className={`size-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {connected ? 'Connected' : 'Not connected'}
    </span>
  );
}
function CategoryChips({ categories }: { categories: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {categories.map((c) => (
        <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{c}</span>
      ))}
    </span>
  );
}

function ConnectorCard({ connector, connected, onOpen }: { connector: Connector; connected: boolean; onOpen: () => void }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:border-slate-300 hover:shadow-sm">
      <div className="flex items-start gap-3.5">
        <BrandLogo id={connector.id} name={connector.name} size={48} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate font-semibold text-slate-800">{connector.name}</p>
          <div className="mt-1"><StatusDot connected={connected} /></div>
        </div>
      </div>
      <div className="mt-3.5"><CategoryChips categories={connector.categories} /></div>
      <div className="mt-auto pt-5">
        <button onClick={onOpen} className="w-full rounded-lg bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-100">
          View and connect
        </button>
      </div>
    </div>
  );
}

function ConnectDialog({
  connector, collector, onClose, onChanged,
}: {
  connector: Connector;
  collector: Collector | undefined;
  onClose: () => void;
  onChanged: () => void;
}) {
  const provider = SUPPORTED[connector.id];
  const supported = Boolean(provider);
  const connected = Boolean(collector?.connected);
  const [reconfig, setReconfig] = useState(!connected);
  const [token, setToken] = useState('');
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'collect' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);

  const save = async () => {
    if (!token.trim()) { setMsg({ tone: 'err', text: 'Paste an API token first.' }); return; }
    setBusy('save'); setMsg(null);
    try {
      await automationApi.connectCollector(provider, { token: token.trim(), domain: domain.trim() || undefined, email: email.trim() || undefined });
      setMsg({ tone: 'ok', text: 'Credentials saved (encrypted).' });
      setReconfig(false); setToken('');
      onChanged();
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not save credentials.' });
    } finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test'); setMsg(null); setFindings(null);
    try {
      const r = await automationApi.testCollector(provider);
      const d = r.data as { connectivity: string; summary: string; findings: Finding[] };
      setFindings(d.findings || []);
      setMsg({ tone: d.connectivity === 'ok' ? 'ok' : 'err', text: `Connectivity ${d.connectivity} — ${d.summary}` });
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Test failed.' });
    } finally { setBusy(null); }
  };
  const collect = async () => {
    setBusy('collect'); setMsg(null);
    try {
      const r = await automationApi.runCollector(provider);
      const d = r.data as { status: string; run_id: number };
      setMsg({ tone: d.status === 'passed' ? 'ok' : 'err', text: `Collected — run #${d.run_id}, status ${d.status}. Evidence cascaded to controls.` });
      onChanged();
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Collection failed.' });
    } finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3.5 border-b border-slate-100 p-5">
          <BrandLogo id={connector.id} name={connector.name} size={48} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-slate-900">{connector.name}</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {supported
                ? connected ? 'Connected — collecting evidence for the mapped SOC 2 controls.' : 'Connect with a read-only API token to collect live evidence.'
                : `Preview — the ${connector.name} sync arrives soon.`}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 overflow-auto p-5">
          <section className="grid grid-cols-1 divide-y divide-slate-100 rounded-xl border border-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="px-4 py-3">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status</h3>
              <StatusDot connected={connected} />
            </div>
            <div className="px-4 py-3">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Categories</h3>
              <CategoryChips categories={connector.categories} />
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">What this collects</h3>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {connector.syncs.map((s) => (
                <li key={s} className="px-3.5 py-2.5 text-sm text-slate-600">{s}</li>
              ))}
            </ul>
          </section>

          {supported && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Credentials</h3>
                {connected && !reconfig && (
                  <button onClick={() => setReconfig(true)} className="text-xs font-semibold text-primary-700 hover:underline">Reconfigure</button>
                )}
              </div>
              {reconfig ? (
                <div className="space-y-2">
                  <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Read-only API token (stored encrypted)"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Domain (Okta/Jira)"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (Jira)"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
                  </div>
                  <p className="text-[11px] text-slate-400">The token is encrypted at rest; only its scopes are ever read. Paste it here — never share it in chat.</p>
                </div>
              ) : (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">A token is configured. Use Reconfigure to replace it.</p>
              )}
            </section>
          )}

          {msg && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${msg.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{msg.text}</div>
          )}

          {findings && findings.length > 0 && (
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Findings</h3>
              <ul className="space-y-1.5">
                {findings.map((f, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium text-slate-700">{f.check}</span>
                      {f.detail && <p className="text-[11px] text-slate-400">{f.detail}</p>}
                      {f.control_codes?.length ? <p className="mt-0.5 text-[10px] text-slate-400">{f.control_codes.join(' · ')}</p> : null}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${f.status === 'pass' ? 'bg-emerald-100 text-emerald-700' : f.status === 'fail' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{f.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 p-4">
          {supported ? (
            <>
              <p className="text-[11px] text-slate-400">{connected ? 'Live evidence collection' : 'Read-only · encrypted'}</p>
              <div className="flex gap-2">
                {reconfig && (
                  <button onClick={save} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                    {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
                  </button>
                )}
                <button onClick={test} disabled={busy !== null || (!connected && reconfig)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Test
                </button>
                <button onClick={collect} disabled={busy !== null || !connected} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
                  {busy === 'collect' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Collect
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400">Connecting arrives soon.</p>
              <button disabled className="cursor-not-allowed rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-400">Connect {connector.name}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AllConnectionsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('available');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<Connector | null>(null);

  const { data } = useQuery({
    queryKey: ['soc2-collectors'],
    queryFn: () => automationApi.listCollectors().then((r) => (r.data as { collectors: Collector[] }).collectors),
  });
  const byProvider = useMemo(() => {
    const m: Record<string, Collector> = {};
    for (const c of data ?? []) m[c.provider] = c;
    return m;
  }, [data]);
  const collectorFor = (c: Connector) => {
    const p = SUPPORTED[c.id];
    return p ? byProvider[p] : undefined;
  };
  const isConnected = (c: Connector) => Boolean(collectorFor(c)?.connected);

  const pool = tab === 'active' ? CONNECTORS.filter(isConnected) : CONNECTORS;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pool.filter(
      (c) =>
        (category === 'all' || c.categories.includes(category as (typeof CONNECTOR_CATEGORIES)[number])) &&
        (!q || c.name.toLowerCase().includes(q)),
    );
  }, [pool, search, category]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['soc2-collectors'] });

  return (
    <div className="mx-auto max-w-[1200px] px-1 py-1">
      <h1 className="text-2xl font-bold text-slate-900">All Connections</h1>

      <nav className="mb-6 mt-4 flex gap-1 border-b border-slate-200" aria-label="Connections sections">
        {(['active', 'available'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative -mb-px px-3 py-2.5 text-sm font-medium capitalize transition-colors ${tab === t ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {t}
            {tab === t && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary-600" />}
          </button>
        ))}
      </nav>

      {tab === 'active' && visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <Plug className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">No active connections yet</p>
          <p className="mt-1 text-sm text-slate-400">Connect a provider from Available to start collecting evidence.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2" role="search">
            <div className="relative w-full min-w-0 sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search connectors…"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-2 text-sm focus:border-primary-500 focus:outline-none" />
            </div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-600">
              <option value="all">Category: All</option>
              {CONNECTOR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p aria-live="polite" className="ml-auto text-xs text-slate-400">
              Showing <span className="tabular-nums">{visible.length}</span> of <span className="tabular-nums">{pool.length}</span> connectors
            </p>
          </div>

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => (
              <li key={c.id}>
                <ConnectorCard connector={c} connected={isConnected(c)} onOpen={() => setSelected(c)} />
              </li>
            ))}
          </ul>
        </>
      )}

      {selected && (
        <ConnectDialog
          connector={selected}
          collector={collectorFor(selected)}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
