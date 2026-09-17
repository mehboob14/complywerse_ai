'use client';

// Administration → All Connections. The whole connector universe in one grid:
// the connectors this platform collects evidence from today (wired to the
// live_api engine — Save credentials · Test · Collect), plus the full Steampipe
// plugin catalog as discovery entries ("Available via Steampipe", not yet wired).
// Data comes from GET /automation/soc2/catalog, so the count always matches the
// backend PROVIDER_API — no static frontend list to drift out of sync.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plug, Search } from 'lucide-react';
import { automationApi } from '@/lib/api';
import { BrandLogo } from '@/components/integrations/BrandLogo';
import { ConnectorDialog, type CatalogConnector } from './ConnectorDialog';

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

function ConnectorCard({ connector, onOpen }: { connector: CatalogConnector; onOpen: () => void }) {
  return (
    <div className={`flex h-full flex-col rounded-xl border p-5 transition-shadow hover:shadow-sm ${connector.supported ? 'border-slate-200 bg-white hover:border-slate-300' : 'border-slate-200/70 bg-slate-50/50 hover:border-slate-300'}`}>
      <div className="flex items-start gap-3.5">
        <BrandLogo id={connector.id} name={connector.name} size={48} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate font-semibold text-slate-800">{connector.name}</p>
          <div className="mt-1">
            {connector.supported
              ? <StatusDot connected={connector.connected} />
              : <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-600"><span className="size-1.5 rounded-full bg-sky-400" />Via Steampipe</span>}
          </div>
        </div>
      </div>
      <div className="mt-3.5"><CategoryChips categories={connector.categories} /></div>
      <div className="mt-auto pt-5">
        <button onClick={onOpen} className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${connector.supported ? 'bg-primary-50 text-primary-700 hover:bg-primary-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
          {connector.supported ? 'View and connect' : 'View details'}
        </button>
      </div>
    </div>
  );
}

export default function AllConnectionsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('available');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<CatalogConnector | null>(null);

  // ?connector=aws opens that connector straight away; ?return= is where the
  // person came from. Only same-site paths are followed back.
  const searchParams = useSearchParams();
  const wanted = searchParams.get('connector');
  const rawReturn = searchParams.get('return');
  const returnTo = rawReturn && rawReturn.startsWith('/') && !rawReturn.startsWith('//') ? rawReturn : null;
  const returnLabel = returnTo ? decodeURIComponent(returnTo.split('?')[0].split('/').filter(Boolean).pop() || 'control') : null;
  const openedFromLink = useRef(false);

  const { data } = useQuery({
    queryKey: ['soc2-catalog'],
    queryFn: () => automationApi.listCatalog().then((r) => r.data as { connectors: CatalogConnector[]; counts: { total: number; supported: number; connected: number; catalog: number } }),
  });
  const connectors = useMemo(() => data?.connectors ?? [], [data]);
  const counts = data?.counts;
  // the open dialog follows the catalogue, so it sees a connection the moment it is saved
  const current = selected ? connectors.find((c) => c.id === selected.id) ?? selected : null;

  useEffect(() => {
    if (openedFromLink.current || !wanted || !connectors.length) return;
    const match = connectors.find((c) => c.id === wanted || c.provider === wanted);
    if (!match) return;
    openedFromLink.current = true;
    setTab('available');
    setSearch(match.name);
    setSelected(match);
  }, [wanted, connectors]);

  const categories = useMemo(
    () => Array.from(new Set(connectors.map((c) => c.category))).sort(),
    [connectors],
  );

  const pool = useMemo(() => {
    if (tab === 'active') return connectors.filter((c) => c.connected);
    return connectors; // "Available" now lists the whole catalog
  }, [connectors, tab]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pool.filter(
      (c) =>
        (category === 'all' || c.category === category) &&
        (!q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)),
    );
  }, [pool, search, category]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['soc2-catalog'] });

  const tabLabel: Record<Tab, string> = {
    active: `Active${counts ? ` (${counts.connected})` : ''}`,
    available: `Available${counts ? ` (${counts.total})` : ''}`,
  };

  return (
    <div className="mx-auto max-w-[1200px] px-1 py-1">
      {returnTo && (
        <Link href={returnTo} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to {returnLabel}
        </Link>
      )}
      <h1 className="text-2xl font-bold text-slate-900">All Connections</h1>
      <p className="mt-1 text-sm text-slate-500">
        {counts
          ? `${counts.supported} connectors wired for live evidence collection · ${counts.catalog} more in the Steampipe catalog.`
          : 'Loading the connector catalog…'}
      </p>

      <nav className="mb-6 mt-4 flex gap-1 border-b border-slate-200" aria-label="Connections sections">
        {(['active', 'available'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative -mb-px px-3 py-2.5 text-sm font-medium transition-colors ${tab === t ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {tabLabel[t]}
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
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p aria-live="polite" className="ml-auto text-xs text-slate-400">
              Showing <span className="tabular-nums">{visible.length}</span> of <span className="tabular-nums">{pool.length}</span> connectors
            </p>
          </div>

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => (
              <li key={c.id}>
                <ConnectorCard connector={c} onOpen={() => setSelected(c)} />
              </li>
            ))}
          </ul>
        </>
      )}

      {current && (
        <ConnectorDialog
          connector={current}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          returnTo={returnTo}
          returnLabel={returnLabel}
        />
      )}
    </div>
  );
}
