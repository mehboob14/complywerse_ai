'use client';

export const dynamic = 'force-dynamic';

// RCSA > Campaigns: every round of self-assessment as a register on the facet explorer — status, owner, due day and progress in the row, filters with live counts, quick views (running, draft,
// closed, late), search, sort, a details panel and a CSV of the rows that match. The list is a COMPLETE load (the old page showed the first 100 and counted them) and its cards read the fields
// the list really sends (the old ones read names the API does not have: blank periods, "Invalid Date", "%"). Making, starting, closing and deleting a campaign are the risk team's
// (`New campaign` and the row menu); everyone who can open RCSA can read.
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Eye, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, Fact, FactList, Menu, Notice, ProgressBar, SidePanel, StatusPill, TitleLink } from '@/components/ui/ds';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { campaignStatus } from '@/lib/statuses/rcsa';
import { csvName, toCsv } from '@/lib/rcsa/csv';
import { saveBlob } from '@/lib/rcsa/saveBlob';
import { csvOf, dueWords, isLate, progressOf, type CampaignRow } from '@/lib/rcsa/campaignsModel';
import { progressTone } from '@/lib/rcsa/scores';
import { RcsaExplorer, type ExplorerFacet, type ExplorerQuick, type ExplorerSort } from '../_parts/RcsaExplorer';
import { RcsaNav } from '../_parts/RcsaNav';
import { KEYS, fetchAll, useRcsaRights } from '../_parts/rcsaData';
import { LaunchSheet } from './_parts/LaunchSheet';
import { useCampaignActions } from './_parts/useCampaignActions';

const PERIOD_NONE = 'No period';
const OWNER_NONE = 'Unknown';
const periodOf = (c: CampaignRow) => (c.period_label || '').trim() || PERIOD_NONE;
const ownerOf = (c: CampaignRow) => c.created_by_name || OWNER_NONE;
const unique = (rows: readonly CampaignRow[], pick: (c: CampaignRow) => string, label: (v: string) => string = (v) => v) =>
  Array.from(new Set(rows.map(pick))).map((value) => ({ value, label: label(value) })).sort((a, b) => a.label.localeCompare(b.label));

const FACETS: ExplorerFacet<CampaignRow>[] = [
  { key: 'status', label: 'Status', values: (c) => [c.status], options: (rows) => unique(rows, (c) => c.status, (v) => statusPill(campaignStatus, v).label), defaultOpen: true },
  { key: 'owner', label: 'Owner', values: (c) => [ownerOf(c)], options: (rows) => unique(rows, ownerOf), searchable: true },
  { key: 'period', label: 'Period', values: (c) => [periodOf(c)], options: (rows) => unique(rows, periodOf), searchable: true },
  { key: 'questionnaire', label: 'Questionnaire', values: (c) => [c.template_name || 'Unknown'], options: (rows) => unique(rows, (c) => c.template_name || 'Unknown'), searchable: true },
];
const QUICK: ExplorerQuick<CampaignRow>[] = [
  { key: 'active', label: 'Running', test: (c) => c.status === 'active' },
  { key: 'draft', label: 'Draft', test: (c) => c.status === 'draft' },
  { key: 'late', label: 'Late', test: (c) => isLate(c) },
  { key: 'closed', label: 'Closed', test: (c) => c.status === 'closed' },
];
const SORTS: ExplorerSort<CampaignRow>[] = [
  { key: 'due', value: (c) => c.due_date },
  { key: 'name', value: (c) => c.name },
  { key: 'status', value: (c) => c.status },
  { key: 'progress', value: (c) => progressOf(c), firstDir: 'desc' },
  { key: 'findings', value: (c) => c.open_findings ?? 0, firstDir: 'desc' },
];
const DEFAULT_SORT = { key: 'due', dir: 'desc' as const };
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function Progress({ c }: { c: CampaignRow }) {
  const pct = progressOf(c);
  const tone = progressTone(pct, isLate(c));
  return <ProgressBar value={pct} label={`${c.name} approved`} valueText={`${formatCount(c.completed_count)} of ${formatCount(c.assessment_count)}`} tone={tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'primary'} />;
}

function Due({ c }: { c: CampaignRow }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="whitespace-nowrap text-ds-body text-ds-fg">{formatDate(c.due_date, { calendar: true })}</span>
      <span className={`text-ds-label ${isLate(c) ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>{dueWords(c)}</span>
    </span>
  );
}

const COLUMNS: RecordColumn<CampaignRow>[] = [
  {
    key: 'name', header: 'Campaign', sortKey: 'name',
    cell: (row) => (
      <div className="flex min-w-0 flex-col gap-[2px]" onClick={stop}>
        <TitleLink href={`/erm/rcsa/campaigns/${row.record.id}`} title={row.record.name} prefetch={false} />
        <span className="line-clamp-1 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{[row.record.template_name, periodOf(row.record) === PERIOD_NONE ? null : periodOf(row.record)].filter(Boolean).join(' · ')}</span>
      </div>
    ),
  },
  { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 112 }, cell: (row) => <StatusPill size="sm" {...statusPill(campaignStatus, row.record.status)} /> },
  { key: 'due', header: 'Due', sortKey: 'due', firstDir: 'desc', fit: { px: 132 }, cell: (row) => <Due c={row.record} /> },
  { key: 'progress', header: 'Approved', sortKey: 'progress', firstDir: 'desc', fit: { px: 168, dropRank: 2 }, cell: (row) => <Progress c={row.record} /> },
  { key: 'findings', header: 'Open findings', sortKey: 'findings', firstDir: 'desc', fit: { px: 112, dropRank: 1 }, cell: (row) => <span className={`text-ds-body tabular-nums ${(row.record.open_findings ?? 0) > 0 ? 'font-[600] text-ds-warning' : 'text-ds-fg-muted'}`}>{formatCount(row.record.open_findings ?? 0)}</span> },
  { key: 'owner', header: 'Owner', fit: { px: 148, dropRank: 3 }, cell: (row) => <span className="line-clamp-1 text-ds-body text-ds-fg [overflow-wrap:anywhere]">{row.record.created_by_name || '—'}</span> },
];

const card = (row: RecordRow<CampaignRow>) => {
  const c = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <span dir="auto" title={c.name} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{c.name}</span>
      <span className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px] text-ds-label text-ds-fg-muted">
        <StatusPill size="sm" {...statusPill(campaignStatus, c.status)} />
        <span>{`Due ${formatDate(c.due_date, { calendar: true })}`}</span>
        <span className={isLate(c) ? 'font-[600] text-ds-danger' : undefined}>{dueWords(c)}</span>
      </span>
      <Progress c={c} />
    </div>
  );
};

function Campaigns() {
  const router = useRouter();
  const { manage } = useRcsaRights();
  const list = useQuery({ queryKey: KEYS.campaigns, queryFn: () => fetchAll<CampaignRow>('/erm/rcsa/campaigns') });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const [making, setMaking] = useState(false);
  const actions = useCampaignActions(manage);

  // /erm/rcsa/campaigns?new=1 (the Worklist's button) opens the sheet once, then leaves the address clean
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('new') === '1') {
      setMaking(true);
      q.delete('new');
      const rest = q.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
    }
  }, []);

  const exportCsv = (shown: CampaignRow[]) => {
    const { header, rows: lines } = csvOf(shown);
    saveBlob(new Blob([toCsv(header, lines)], { type: 'text/csv;charset=utf-8' }), csvName('campaigns'));
  };

  const empty = (
    <EmptyState
      kind="firstUse"
      title="No campaigns yet"
      description={manage ? 'A campaign asks every department to answer a questionnaire by a due day. Create one, then start it when you are ready.' : 'A campaign asks every department to answer a questionnaire by a due day. None has been created yet.'}
      action={manage ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setMaking(true)}>New campaign</Button> : undefined}
    />
  );

  return (
    <>
      <RcsaExplorer<CampaignRow>
        label="Campaigns"
        noun={{ one: 'campaign', other: 'campaigns' }}
        rows={rows}
        loading={list.isLoading}
        error={list.isError ? { message: errorMessage(list.error), onRetry: () => { void list.refetch(); } } : null}
        facets={FACETS}
        quick={QUICK}
        searchText={(c) => `${c.name} ${c.template_name ?? ''} ${periodOf(c)} ${ownerOf(c)}`}
        columns={COLUMNS}
        card={card}
        sorts={SORTS}
        defaultSort={DEFAULT_SORT}
        head={() => (
          <div className="flex min-w-0 flex-col gap-[12px]">
            <PageHeader
              variant="page"
              title="RCSA Campaigns"
              info="A campaign asks every department to answer one questionnaire by a due day. Open one to chase late units, review answers and read the findings."
              meta={list.isLoading || (list.isError && rows.length === 0) ? undefined : `${formatCount(rows.length)} ${rows.length === 1 ? 'campaign' : 'campaigns'}`}
              actions={manage ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setMaking(true)}>New campaign</Button> : undefined}
            />
            <RcsaNav active="campaigns" />
          </div>
        )}
        notices={list.isError && rows.length > 0 ? (
          <Notice tone="danger" title="Couldn't refresh the campaigns" action={<Button size="sm" onClick={() => { void list.refetch(); }}>Retry</Button>}>{`${errorMessage(list.error)} What is shown may be out of date.`}</Notice>
        ) : undefined}
        empty={empty}
        rowActions={(c) => <Menu label={`Actions for ${truncate(c.name, 60).text}`} iconOnly items={[{ key: 'open', label: 'Open', icon: Eye, onSelect: () => router.push(`/erm/rcsa/campaigns/${c.id}`) }, ...actions.items(c)]} />}
        onExport={exportCsv}
        detail={(open, close) => (
          <SidePanel
            open={!!open}
            onClose={close}
            title={<span dir="auto" className="line-clamp-3 break-words" title={open?.name}>{open?.name}</span>}
            subtitle={open ? statusPill(campaignStatus, open.status).label : undefined}
            dockFrom={Infinity}
            width="md"
            footer={open && <Button variant="primary" href={`/erm/rcsa/campaigns/${open.id}`} rightIcon={<ArrowUpRight aria-hidden />}>Open the campaign</Button>}
          >
            {open && (
              <div className="flex flex-col gap-[16px]">
                <Progress c={open} />
                <FactList min={140}>
                  <Fact label="Questionnaire">{open.template_name}</Fact>
                  <Fact label="Period">{open.period_label}</Fact>
                  <Fact label="Starts">{formatDate(open.start_date, { calendar: true })}</Fact>
                  <Fact label="Due">{`${formatDate(open.due_date, { calendar: true })} · ${dueWords(open)}`}</Fact>
                  <Fact label="Units">{formatCount(open.assessment_count)}</Fact>
                  <Fact label="Approved">{formatCount(open.completed_count)}</Fact>
                  <Fact label="Open findings">{formatCount(open.open_findings ?? 0)}</Fact>
                  <Fact label="Owner">{open.created_by_name}</Fact>
                </FactList>
                {open.description && <p className="whitespace-pre-line text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{open.description}</p>}
              </div>
            )}
          </SidePanel>
        )}
      />
      <LaunchSheet open={making} onClose={() => setMaking(false)} />
      {actions.dialog}
    </>
  );
}

export default function RcsaCampaignsPage() {
  return <Suspense fallback={null}><Campaigns /></Suspense>;
}
