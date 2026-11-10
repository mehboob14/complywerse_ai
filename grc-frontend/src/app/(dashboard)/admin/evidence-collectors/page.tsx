'use client';

// Connections: the systems this platform collects evidence from. A register, not a wall of 124 cards: Active (the connected ones, the useful default), Failing and All, a search and a category, one row a
// connector with its status, when it last collected and ONE action (Manage, Connect, or Details for one that cannot collect yet). Connecting is a guide in a Sheet (ConnectorSheet). Data is
// GET /automation/soc2/catalog, so the count always matches what the backend can collect from; nothing is listed from a static frontend list.
// This is the Controls Automation menu's "Connections" page (the full list of evidence sources, the ones that cannot collect yet included). The sources that ARE connected are also rows of Administration >
// Connected systems, which opens the same sheet (ConnectorSheet). The links into this page keep working: ?connector=<id> opens that connector, ?return=<path> says where Back goes, ?show=failing|active|all picks the tab.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Pager, SegmentedControl, Select, SkeletonRows, StatusPill, TextInput, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { BrandLogo } from '@/components/integrations/BrandLogo';
import { automationApi } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import { titleFor } from '@/lib/navRegistry';
import { statusPill } from '@/lib/status';
import { collectionHealth, connection } from '@/lib/statuses/controls';
import { CATEGORY_LABEL } from '../../automation/overview/_overview/overviewModel';
import { useRights } from '../../automation/soc2-controls/_explorer/controlsRights';
import {
  CONNECTIONS_SCHEMA, SHOWS, SHOW_LABEL, categoriesOf, countsOf, defaultShow, lastCollected, readingOf, returnLabel, safeReturn, visibleConnectors, type Connector, type Show,
} from './connectionsModel';
import { ConnectorSheet } from './ConnectorSheet';

const PAGE_SIZES = [25, 50, 100] as const;
const categoryWord = (c: string): string => CATEGORY_LABEL[c] || c.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

interface Catalog { connectors: Connector[]; counts: { total: number; supported: number; connected: number; catalog: number } }

function StateCell({ c }: { c: Connector }) {
  const r = readingOf(c);
  if (r.kind === 'unavailable') return <StatusPill size="sm" tone="neutral" label="Not available yet" />;
  if (r.kind === 'not_connected') return <StatusPill size="sm" {...statusPill(connection, 'not_connected')} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-[6px]">
      <StatusPill size="sm" {...statusPill(connection, 'connected')} />
      {r.health !== 'healthy' && <StatusPill size="sm" {...statusPill(collectionHealth, r.health)} />}
    </span>
  );
}

function ConnectorRow({ c, onOpen }: { c: Connector; onOpen: () => void }) {
  const r = readingOf(c);
  const when = lastCollected(c, (iso) => formatDate(iso));
  const action = r.kind === 'connected' ? 'Manage' : r.kind === 'not_connected' ? 'Connect' : 'Details';
  return (
    <li className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] border-t border-ds-border px-[12px] py-[8px] first:border-t-0">
      <BrandLogo id={c.id} name={c.name} size={36} />
      <div className="min-w-[160px] flex-[1_1_200px]">
        <p className="m-0 truncate text-ds-body font-[600] text-ds-fg" title={c.name}>{c.name}</p>
        <p className="m-0 truncate text-ds-label text-ds-fg-muted">{(c.categories.length ? c.categories : [c.category]).slice(0, 3).map(categoryWord).join(' · ')}</p>
      </div>
      <div className="flex min-w-[150px] flex-[1_1_180px] flex-col gap-[2px]">
        <StateCell c={c} />
        {when && <span className="text-ds-label text-ds-fg-muted">{when}</span>}
      </div>
      <Button variant={r.kind === 'not_connected' ? 'primary' : 'secondary'} onClick={onOpen} aria-label={`${action} ${c.name}`}>{action}</Button>
    </li>
  );
}

export default function ConnectionsPage() {
  const qc = useQueryClient();
  const canConnect = useRights().can('scan');

  const [address, setAddress] = useAddressState(CONNECTIONS_SCHEMA);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const catalogQ = useQuery({
    queryKey: ['soc2-catalog'],
    queryFn: () => automationApi.listCatalog().then((r) => r.data as Catalog),
    retry: (failures, e) => failures < 3 && canRetry(e),
  });
  const connectors = useMemo(() => catalogQ.data?.connectors ?? [], [catalogQ.data]);
  const counts = useMemo(() => countsOf(connectors), [connectors]);
  const categories = useMemo(() => categoriesOf(connectors), [connectors]);
  const show: Show = address.show === 'auto' ? defaultShow(connectors) : address.show;
  const visible = useMemo(() => visibleConnectors(connectors, { show, query: address.q, category: address.category }), [connectors, show, address.q, address.category]);
  const selected = selectedId ? connectors.find((c) => c.id === selectedId) ?? null : null;     // the open sheet follows the catalogue, so it sees a connection the moment it is saved

  // ?connector=aws opens that connector straight away (once); ?return= is where the person came from, followed only when it is a path on this site
  const returnTo = safeReturn(address.return);
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !address.connector || connectors.length === 0) return;
    const match = connectors.find((c) => c.id === address.connector || c.provider === address.connector);
    opened.current = true;
    if (!match) return;
    setSelectedId(match.id);
    setAddress({ connector: '', ...(address.show === 'auto' ? { show: 'all' as const } : {}) });
  }, [address.connector, address.show, connectors, setAddress]);

  const [seen, setSeen] = useState('');
  const key = `${show}|${address.q}|${address.category}|${pageSize}`;
  if (seen !== key) { setSeen(key); setPageNo(1); }
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageClamped = Math.min(pageNo, pages);
  const rows = visible.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['soc2-catalog'] }); void qc.invalidateQueries({ queryKey: ['automation-common'] }); void qc.invalidateQueries({ queryKey: ['common-overview'] }); };
  const title = titleFor('/admin/evidence-collectors') ?? 'Connections';
  const meta = catalogQ.data ? `${formatCount(counts.wired)} can collect evidence · ${formatCount(counts.active)} connected${counts.failing ? ` · ${formatCount(counts.failing)} failing` : ''}` : undefined;
  const noData = catalogQ.isError && !catalogQ.data;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-[12px]">
      <PageHeader variant="page" title={title} meta={meta} info="The systems your evidence is collected from. Connect any one source in a category; its checks then run daily and the controls it covers read passing or failing. Everything else this platform connects to is under Administration > Connected systems." />

      <div className="flex flex-wrap items-center gap-[8px]" role="search" aria-label="Find a connection">
        <SegmentedControl
          label="Which connections"
          name="connections-show"
          options={SHOWS.map((s) => ({ value: s, label: catalogQ.data ? `${SHOW_LABEL[s]} ${formatCount(counts[s])}` : SHOW_LABEL[s] }))}
          value={show}
          onChange={(v) => setAddress({ show: v as Show })}
        />
        <TextInput
          type="search" value={address.q} onChange={(e) => setAddress({ q: e.target.value })} aria-label="Search connections" placeholder="Search connections" autoComplete="off"
          className="min-w-[160px] max-w-[320px] flex-1" leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />}
        />
        <Select aria-label="Category" value={address.category} onChange={(e) => setAddress({ category: e.target.value })} className="w-[200px] max-w-full">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{categoryWord(c)}</option>)}
        </Select>
        {catalogQ.data && <span role="status" className="ml-auto text-ds-label tabular-nums text-ds-fg-muted">{`${formatCount(visible.length)} of ${formatCount(connectors.length)}`}</span>}
      </div>

      {catalogQ.isPending && <SkeletonRows rows={8} columns={3} label="Loading the connections" />}
      {noData && <ErrorState title="Couldn’t load the connections" message={errorMessage(catalogQ.error)} onRetry={canRetry(catalogQ.error) ? () => { void catalogQ.refetch(); } : undefined} />}
      {catalogQ.isError && catalogQ.data && <ErrorState compact title="Couldn’t refresh the connections" message={`${errorMessage(catalogQ.error)} What is shown may be out of date.`} onRetry={canRetry(catalogQ.error) ? () => { void catalogQ.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}

      {catalogQ.data && visible.length === 0 && (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          {show === 'active' && !address.q && !address.category ? (
            <EmptyState kind="firstUse" bare icon={Plug} title="Nothing is connected yet" description="Connect a source to start collecting evidence." action={<Button variant="primary" onClick={() => setAddress({ show: 'all' })}>Show every connection</Button>} />
          ) : show === 'failing' && !address.q && !address.category ? (
            <EmptyState kind="firstUse" bare icon={Plug} title="Nothing is failing" description="Every connection that has collected did so without an error." />
          ) : (
            <EmptyState kind="noMatches" bare title="No connections match" description="Loosen the search or the category." onClearFilters={() => setAddress({ q: '', category: '' })} />
          )}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <ul aria-label="Connections" className="m-0 list-none overflow-clip rounded-ds-card border border-ds-border bg-ds-surface p-0">
            {rows.map((c) => <ConnectorRow key={c.id} c={c} onOpen={() => setSelectedId(c.id)} />)}
          </ul>
          <Pager page={pageClamped} pageSize={pageSize} total={visible.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={{ one: 'connection', other: 'connections' }} />
        </>
      )}

      {selected && (
        <ConnectorSheet
          key={selected.id}
          connector={selected}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
          returnTo={returnTo}
          returnLabel={returnLabel(returnTo)}
          canConnect={canConnect}
        />
      )}
    </div>
  );
}
