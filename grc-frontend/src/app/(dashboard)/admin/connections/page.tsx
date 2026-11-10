'use client';

// Administration > Connected systems: ONE register of what is connected, whatever it is. Four kinds (scanners, cloud security feeds, business tools, evidence sources) were four pages
// under five tab names; a person who wanted to connect something had to guess which. Now: a register with a kind control, a search and a status filter, one row a connection with its
// health and when it last ran, one action (Manage); and "Connect a system", a catalogue in a sheet. Every kind keeps its own endpoints and its own sheet (connectedModel.ts holds the
// adapters). The state is in the address (?kind= ?q= ?status=) and the older links still work: ?provider=<code> opens the connect form for that provider, ?connector=<id> opens an
// evidence source, ?return=<path> says where Back goes from it; /admin/cloud-connectors, /admin/connectors and /integrations/connections forward here with their kind.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plug, Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, Menu, Notice, Pager, RegisterTable, SegmentedControl, Select, TextInput, sortRows, useAddressState, useReportedMutation, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { cloudConnectorsApi } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import { useRights } from '../../automation/soc2-controls/_explorer/controlsRights';
import { ConnectorSheet } from '../evidence-collectors/ConnectorSheet';
import { returnLabel, safeReturn } from '../evidence-collectors/connectionsModel';
import {
  CONNECTIONS_SCHEMA, HEALTH_RANK, KINDS, KIND_LABEL, KIND_ONE, STATUS_FILTERS, STATUS_FILTER_LABEL, countsOf, entryForProvider, summaryLine, visibleRows,
  type CatalogueEntry, type ConnectedRow, type Kind, type StatusFilter,
} from './connectedModel';
import type { ScannerType } from './credentialModel';
import { useConnected, wasRefused } from './_useConnected';
import { HealthPill, Logo } from './_parts';
import { CatalogueSheet } from './_CatalogueSheet';
import { ScannerConnectSheet, ScannerManageSheet } from './_ScannerSheets';
import { CloudConnectSheet, CloudManageSheet } from './_CloudSheets';
import { ToolManageSheet, ToolSheet } from './_ToolSheets';

type Panel =
  | { mode: 'catalogue' }
  | { mode: 'connect'; entry: CatalogueEntry }
  | { mode: 'manage'; key: string }
  | { mode: 'change-tool'; id: number }
  | { mode: 'evidence'; id: string }
  | null;

const PAGE_SIZES = [25, 50, 100] as const;
const NOUN: Record<Kind, string> = { scanners: 'scanners', cloud: 'cloud security connections', tools: 'business tools', evidence: 'evidence sources' };

export default function ConnectedSystemsPage() {
  const qc = useQueryClient();
  const data = useConnected();
  const { hasPermission } = usePermissions();
  const canScan = { create: hasPermission('admin:integrations:create'), edit: hasPermission('admin:integrations:edit'), remove: hasPermission('admin:integrations:delete') };
  const canCollect = useRights().can('scan');

  const [address, setAddress] = useAddressState(CONNECTIONS_SCHEMA);
  const [panel, setPanel] = useState<Panel>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const counts = useMemo(() => countsOf(data.rows), [data.rows]);
  const visible = useMemo(() => visibleRows(data.rows, { kind: address.kind, query: address.q, status: address.status }), [data.rows, address.kind, address.q, address.status]);
  const ordered = useMemo(() => sortRows(visible, sort, (r, key) => (key === 'status' ? HEALTH_RANK[r.health] : key === 'kind' ? KIND_ONE[r.kind] : key === 'last' ? r.lastRun : r.name)), [visible, sort]);
  const [seen, setSeen] = useState('');
  const key = `${address.kind}|${address.q}|${address.status}|${pageSize}|${sort?.key}${sort?.dir}`;
  if (seen !== key) { setSeen(key); setPageNo(1); }
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = Math.min(pageNo, pages);
  const rows = ordered.slice((page - 1) * pageSize, page * pageSize);
  const failedKinds = KINDS.filter((k) => k in data.failed);
  const filtered = Boolean(address.q || address.kind !== 'all' || address.status !== 'all');

  const syncAll = useReportedMutation({
    mutationFn: () => cloudConnectorsApi.syncAll(),
    success: { title: 'Sync queued', message: 'Every cloud security connection is read in the background; the results show here when it finishes.' },
    failure: "Couldn't queue the sync",
    fallback: 'The background worker did not take it. Try again in a moment.',
    invalidate: [['cloud-connectors']],
  });

  const openEntry = (entry: CatalogueEntry) => {
    if (entry.kind === 'evidence') {
      const match = data.evidence.find((c) => c.provider === entry.provider);
      if (match) setPanel({ mode: 'evidence', id: match.id });
    } else setPanel({ mode: 'connect', entry });
  };
  const openRow = (row: ConnectedRow) => setPanel(row.kind === 'evidence' ? { mode: 'evidence', id: String(row.id) } : { mode: 'manage', key: row.key });

  // the links that already exist: ?provider=<code> and ?connector=<id>, each followed once the lists have answered, then dropped from the address (Back must not reopen it)
  const followed = useRef({ provider: false, connector: false });
  useEffect(() => {
    if (!data.ready) return;
    if (address.provider && !followed.current.provider) {
      followed.current.provider = true;
      const entry = entryForProvider(data.entries, address.provider);
      setAddress({ provider: '' });
      if (entry) openEntry(entry);
    }
    if (address.connector && !followed.current.connector) {
      followed.current.connector = true;
      const match = data.evidence.find((c) => c.id === address.connector || c.provider === address.connector);
      setAddress({ connector: '', ...(address.kind === 'all' ? { kind: 'evidence' as const } : {}) });
      if (match) setPanel({ mode: 'evidence', id: match.id });
    }
  }, [data.ready, data.entries, data.evidence, address.provider, address.connector, address.kind]);        // eslint-disable-line react-hooks/exhaustive-deps

  const refreshEvidence = () => { void qc.invalidateQueries({ queryKey: ['soc2-catalog'] }); void qc.invalidateQueries({ queryKey: ['automation-common'] }); void qc.invalidateQueries({ queryKey: ['common-overview'] }); };
  const close = () => setPanel(null);
  const returnTo = safeReturn(address.return);

  const columns: RegisterColumn<ConnectedRow>[] = [
    {
      key: 'name', header: 'System', sortable: true, isRowHeader: true, card: 'hide',
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-[10px]">
          <Logo provider={r.provider} name={r.name} />
          <span className="min-w-0">
            <span className="block max-w-[420px] truncate font-[600] text-ds-fg" title={r.name}>{r.name}</span>
            <span className="block max-w-[420px] truncate text-ds-label text-ds-fg-muted" title={[r.type, r.detail].filter(Boolean).join(' · ')}>{[r.type, r.detail].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
      ),
    },
    { key: 'kind', header: 'Kind', priority: 2, sortable: true, card: 'meta', cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg">{KIND_ONE[r.kind]}</span> },
    { key: 'status', header: 'Status', sortable: true, card: 'meta', cell: (r) => <HealthPill health={r.health} /> },
    { key: 'last', header: 'Last run', priority: 2, sortable: true, firstDir: 'desc', card: 'meta', cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg">{r.lastRun ? formatDate(r.lastRun) : 'Never'}</span> },
    { key: 'manage', header: 'Actions', align: 'right', card: 'hide', width: 'w-[110px]', cell: (r) => <Button size="sm" onClick={() => openRow(r)} aria-label={`Manage ${r.name}`}>Manage</Button> },
  ];

  const empty = filtered ? (
    <EmptyState kind="noMatches" bare title="No connected system matches" description="Loosen the search, or choose another kind or status." onClearFilters={() => setAddress({ q: '', kind: 'all', status: 'all' })} />
  ) : failedKinds.length > 0 ? (
    <EmptyState kind="firstUse" bare icon={Plug} title="Nothing to show yet" description="Some connections could not be read; the notices above say which." />
  ) : (
    <EmptyState kind="firstUse" bare icon={Plug} title="Nothing is connected yet" description="Connect a scanner, a cloud security service, a business tool or an evidence source."
      action={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setPanel({ mode: 'catalogue' })}>Connect a system</Button>} />
  );

  // ── the open sheet (one at a time) ──
  let sheet: React.ReactNode = null;
  if (panel?.mode === 'catalogue') {
    sheet = <CatalogueSheet entries={data.entries} canConnectScanner={canScan.create} startKind={address.kind} onClose={close} onPick={openEntry} />;
  } else if (panel?.mode === 'connect') {
    const e = panel.entry;
    const back = () => setPanel({ mode: 'catalogue' });
    if (e.kind === 'scanners') sheet = <ScannerConnectSheet initialType={e.provider as ScannerType} onClose={close} onBack={back} />;
    else if (e.kind === 'cloud') sheet = <CloudConnectSheet provider={e.provider} label={e.label} onClose={close} onBack={back} />;
    else if (e.kind === 'tools') {
      const meta = data.toolProviders.find((p) => p.provider === e.provider);
      sheet = meta ? <ToolSheet meta={meta} existing={null} onClose={close} onBack={back} /> : null;
    }
  } else if (panel?.mode === 'manage') {
    const row = data.rows.find((r) => r.key === panel.key);
    if (row?.kind === 'scanners') { const c = data.scanners.find((s) => s.id === row.id); if (c) sheet = <ScannerManageSheet conn={c} canEdit={canScan.edit} canDelete={canScan.remove} onClose={close} />; }
    else if (row?.kind === 'cloud') { const c = data.cloud.find((s) => s.id === row.id); if (c) sheet = <CloudManageSheet conn={c} onClose={close} />; }
    else if (row?.kind === 'tools') {
      const c = data.tools.find((s) => s.id === row.id);
      if (c) sheet = <ToolManageSheet conn={c} meta={data.toolProviders.find((p) => p.provider === c.provider)} onEdit={() => setPanel({ mode: 'change-tool', id: c.id })} onClose={close} />;
    }
  } else if (panel?.mode === 'change-tool') {
    const c = data.tools.find((s) => s.id === panel.id);
    const meta = c ? data.toolProviders.find((p) => p.provider === c.provider) : undefined;
    if (c && meta) sheet = <ToolSheet meta={meta} existing={c} onClose={() => setPanel({ mode: 'manage', key: `tools:${c.id}` })} />;
  } else if (panel?.mode === 'evidence') {
    const c = data.evidence.find((s) => s.id === panel.id);
    if (c) sheet = <ConnectorSheet key={c.id} connector={c} onClose={close} onChanged={refreshEvidence} returnTo={returnTo} returnLabel={returnLabel(returnTo)} canConnect={canCollect} />;
  }

  const meta = !data.loading && data.rows.length > 0 ? summaryLine(counts) : undefined;
  return (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page" title="Connected systems" meta={meta}
        info="The systems this platform reads from or works with: vulnerability scanners, cloud security services, business tools such as your service desk, and the evidence sources its checks run against. Credentials are typed once and never shown again."
        actions={(
          <>
            <Menu label="More" items={[{ key: 'sync-all', label: 'Sync every cloud security connection', hidden: counts.byKind.cloud === 0, disabled: syncAll.isPending, onSelect: () => syncAll.mutate() }]} />
            <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setPanel({ mode: 'catalogue' })}>Connect a system</Button>
          </>
        )}
      />

      {data.unencrypted && (
        <Notice tone="warning" title="Saved credentials are not encrypted on this server">Credentials you save for scanners, cloud security services and business tools are stored in a form that can be read back. Ask whoever runs the platform to switch encryption on before you connect a real system.</Notice>
      )}
      {failedKinds.map((k) => (
        <Notice key={k} tone="danger" title={`Couldn’t read the ${NOUN[k]}`}
          action={!wasRefused(data.failed[k]) && canRetry(data.failed[k]) ? <Button onClick={() => data.retryKind(k)}>Retry</Button> : undefined}>
          {wasRefused(data.failed[k]) ? `You do not have access to the ${NOUN[k]}.` : errorMessage(data.failed[k])}
        </Notice>
      ))}

      <div className="flex flex-wrap items-center gap-[8px]" role="search" aria-label="Find a connected system">
        <SegmentedControl
          label="Kind of system" name="connected-kind" value={address.kind} onChange={(v) => setAddress({ kind: v as Kind | 'all' })}
          options={[{ value: 'all', label: data.loading ? 'All' : `All ${formatCount(counts.total)}` }, ...KINDS.map((k) => ({ value: k, label: data.loading ? KIND_LABEL[k] : `${KIND_LABEL[k]} ${formatCount(counts.byKind[k])}` }))]}
        />
        <TextInput
          type="search" value={address.q} onChange={(e) => setAddress({ q: e.target.value })} aria-label="Search connected systems" placeholder="Search systems" autoComplete="off"
          className="min-w-[180px] max-w-[320px] flex-1" leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />}
        />
        <Select aria-label="Status" value={address.status} onChange={(e) => setAddress({ status: e.target.value as StatusFilter })} className="w-[170px] max-w-full">
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{STATUS_FILTER_LABEL[s]}</option>)}
        </Select>
        {!data.loading && <span role="status" className="ml-auto text-ds-label tabular-nums text-ds-fg-muted">{`${formatCount(visible.length)} of ${formatCount(counts.total)}`}</span>}
      </div>

      <RegisterTable
        caption="Connected systems"
        columns={columns} rows={rows} getRowId={(r) => r.key} sort={sort} onSortChange={setSort}
        onRowActivate={openRow} selectedId={panel?.mode === 'manage' ? panel.key : null}
        loading={data.loading} error={failedKinds.length === KINDS.length ? { message: 'None of the connections could be read.', onRetry: data.refetchAll } : null}
        empty={empty}
        cardTitle={(r) => (<span className="flex min-w-0 items-center gap-[8px]"><Logo provider={r.provider} name={r.name} size={28} /><span className="min-w-0 truncate" title={r.name}>{r.name}</span></span>)}
        cardActions={(r) => <Button size="sm" onClick={() => openRow(r)} aria-label={`Manage ${r.name}`}>Manage</Button>}
        footer={rows.length > 0 ? <Pager page={page} pageSize={pageSize} total={visible.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={{ one: 'system', other: 'systems' }} /> : undefined}
      />

      {sheet}
    </div>
  );
}
