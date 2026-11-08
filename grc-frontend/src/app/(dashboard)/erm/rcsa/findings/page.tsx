'use client';

export const dynamic = 'force-dynamic';

// RCSA > Findings: what the self-assessments found, as a register on the facet explorer — severity, status, owner and fix-by day in the row, filters with live counts (status, severity, kind,
// campaign, unit, owner, whether it is tied to a risk), quick views, search, sort, a CSV of the rows that match, and a details panel that replaces the old finding page. The list is a complete
// load, and every count is the length of what was loaded (the old one filtered by names the API ignored and threw on a search). `?status=open,in_progress` is where the Worklist's counter lands;
// `?open=ID` opens a finding (the Worklist, a unit and the old finding addresses use it). Anyone who can open RCSA can change a finding: that is the server's rule.
import { Suspense, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui';
import { EmptyState, Notice, Button, StatusPill } from '@/components/ui/ds';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { findingSeverity, findingStatus, findingType } from '@/lib/statuses/rcsa';
import { csvName, toCsv } from '@/lib/rcsa/csv';
import { saveBlob } from '@/lib/rcsa/saveBlob';
import { isForbidden, retryUnlessRefused } from '@/lib/rcsa/registerModel';
import { csvOf, isLate, isOpen, linksText, severityRank, type FindingRow } from '@/lib/rcsa/findingsModel';
import { RcsaExplorer, type ExplorerFacet, type ExplorerQuick, type ExplorerSort } from '../_parts/RcsaExplorer';
import { RcsaNav } from '../_parts/RcsaNav';
import { KEYS, fetchAll } from '../_parts/rcsaData';
import { FindingPanel } from './_parts/FindingPanel';

const UNASSIGNED = 'Unassigned';
const unitOf = (f: FindingRow) => f.business_unit_name || 'Unknown unit';
const campaignOf = (f: FindingRow) => f.campaign_name || 'Unknown campaign';
const ownerOf = (f: FindingRow) => f.remediation_owner_name || UNASSIGNED;
const unique = (rows: readonly FindingRow[], pick: (f: FindingRow) => string, label: (v: string) => string = (v) => v) =>
  Array.from(new Set(rows.map(pick))).map((value) => ({ value, label: label(value) })).sort((a, b) => a.label.localeCompare(b.label));

const FACETS: ExplorerFacet<FindingRow>[] = [
  { key: 'status', label: 'Status', values: (f) => [f.status], options: (rows) => unique(rows, (f) => f.status, (v) => statusPill(findingStatus, v).label), defaultOpen: true },
  { key: 'severity', label: 'Severity', values: (f) => [f.severity], options: (rows) => unique(rows, (f) => f.severity, (v) => statusPill(findingSeverity, v).label).sort((a, b) => severityRank(b.value) - severityRank(a.value)), defaultOpen: true },
  { key: 'kind', label: 'Kind', values: (f) => [f.finding_type], options: (rows) => unique(rows, (f) => f.finding_type, (v) => statusPill(findingType, v).label) },
  { key: 'campaign', label: 'Campaign', values: (f) => [campaignOf(f)], options: (rows) => unique(rows, campaignOf), searchable: true },
  { key: 'unit', label: 'Unit', values: (f) => [unitOf(f)], options: (rows) => unique(rows, unitOf), searchable: true },
  { key: 'owner', label: 'Owner', values: (f) => [ownerOf(f)], options: (rows) => unique(rows, ownerOf), searchable: true },
  { key: 'risk', label: 'Risk register', values: (f) => [f.linked_risk_id ? 'linked' : 'not'], options: (rows) => (rows.length ? [{ value: 'linked', label: 'Tied to a risk' }, { value: 'not', label: 'Not tied to a risk' }] : []) },
];
const QUICK: ExplorerQuick<FindingRow>[] = [
  { key: 'open', label: 'Open', test: isOpen },
  { key: 'late', label: 'Late', test: (f) => isLate(f) },
  { key: 'serious', label: 'Critical or high', test: (f) => isOpen(f) && severityRank(f.severity) >= 3 },
  { key: 'unowned', label: 'No owner', test: (f) => isOpen(f) && !f.remediation_owner_id },
];
const SORTS: ExplorerSort<FindingRow>[] = [
  { key: 'severity', value: (f) => severityRank(f.severity), firstDir: 'desc' },
  { key: 'title', value: (f) => f.title },
  { key: 'status', value: (f) => f.status },
  { key: 'due', value: (f) => f.remediation_due_date ?? null },
  { key: 'raised', value: (f) => f.created_at, firstDir: 'desc' },
];
const DEFAULT_SORT = { key: 'severity', dir: 'desc' as const };

const COLUMNS: RecordColumn<FindingRow>[] = [
  {
    key: 'title', header: 'Finding', sortKey: 'title',
    cell: (row) => (
      <div className="flex min-w-0 flex-col gap-[2px]">
        {/* the row is the control (it opens the details panel and keeps the filters in the address); a link to ?open= would drop them */}
        <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{row.record.title}</span>
        <span className="line-clamp-1 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{[unitOf(row.record), campaignOf(row.record)].join(' · ')}</span>
      </div>
    ),
  },
  { key: 'severity', header: 'Severity', sortKey: 'severity', firstDir: 'desc', fit: { px: 108 }, cell: (row) => <StatusPill size="sm" {...statusPill(findingSeverity, row.record.severity)} /> },
  { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 120 }, cell: (row) => <StatusPill size="sm" {...statusPill(findingStatus, row.record.status)} /> },
  { key: 'owner', header: 'Owner', fit: { px: 148, dropRank: 2 }, cell: (row) => <span className={`line-clamp-1 text-ds-body [overflow-wrap:anywhere] ${row.record.remediation_owner_name ? 'text-ds-fg' : 'text-ds-fg-muted'}`}>{ownerOf(row.record)}</span> },
  {
    key: 'due', header: 'Fix by', sortKey: 'due', fit: { px: 120, dropRank: 1 },
    cell: (row) => <span className={`whitespace-nowrap text-ds-body ${isLate(row.record) ? 'font-[600] text-ds-danger' : 'text-ds-fg'}`}>{row.record.remediation_due_date ? formatDate(row.record.remediation_due_date, { calendar: true }) : 'Not set'}</span>,
  },
  { key: 'links', header: 'Tied to', fit: { px: 120, dropRank: 3 }, cell: (row) => <span className="text-ds-body text-ds-fg-muted">{linksText(row.record)}</span> },
];

const card = (row: RecordRow<FindingRow>) => {
  const f = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={f.title} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{f.title}</span>
      <span className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px] text-ds-label text-ds-fg-muted">
        <StatusPill size="sm" {...statusPill(findingSeverity, f.severity)} />
        <StatusPill size="sm" {...statusPill(findingStatus, f.status)} />
        <span>{unitOf(f)}</span>
        {f.remediation_due_date && <span className={isLate(f) ? 'font-[600] text-ds-danger' : undefined}>{`Fix by ${formatDate(f.remediation_due_date, { calendar: true })}`}</span>}
      </span>
    </div>
  );
};

function Findings() {
  const list = useQuery({ queryKey: [...KEYS.findings, 'all'], queryFn: () => fetchAll<FindingRow>('/erm/rcsa/findings'), retry: retryUnlessRefused });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const exportCsv = (shown: FindingRow[]) => {
    const { header, rows: lines } = csvOf(shown);
    saveBlob(new Blob([toCsv(header, lines)], { type: 'text/csv;charset=utf-8' }), csvName('findings'));
  };
  return (
    <RcsaExplorer<FindingRow>
      label="Findings"
      noun={{ one: 'finding', other: 'findings' }}
      rows={rows}
      loading={list.isLoading}
      error={list.isError ? { message: errorMessage(list.error), onRetry: () => { void list.refetch(); }, forbidden: isForbidden(list.error) } : null}
      facets={FACETS}
      quick={QUICK}
      searchText={(f) => `${f.title} ${f.description ?? ''} ${unitOf(f)} ${campaignOf(f)} ${ownerOf(f)} ${f.linked_risk_title ?? ''}`}
      columns={COLUMNS}
      card={card}
      sorts={SORTS}
      defaultSort={DEFAULT_SORT}
      head={() => (
        <div className="flex min-w-0 flex-col gap-[12px]">
          <PageHeader
            variant="page"
            title="RCSA Findings"
            info="Gaps and weaknesses raised on a unit's self-assessment. Tie a finding to a risk or a control and make a mitigation action from it."
            meta={list.isLoading || (list.isError && rows.length === 0) ? undefined : `${formatCount(rows.filter(isOpen).length)} open of ${formatCount(rows.length)}`}
          />
          <RcsaNav active="findings" counts={list.data ? { findings: rows.filter(isOpen).length } : undefined} />
        </div>
      )}
      notices={list.isError && rows.length > 0 ? (
        <Notice tone="danger" title="Couldn't refresh the findings" action={<Button size="sm" onClick={() => { void list.refetch(); }}>Retry</Button>}>{`${errorMessage(list.error)} What is shown may be out of date.`}</Notice>
      ) : undefined}
      empty={<EmptyState kind="firstUse" title="No findings yet" description="A reviewer or an assessor raises a finding from a unit's page when an answer shows a gap. It then appears here." />}
      detail={(open, close) => <FindingPanel finding={open} onClose={close} />}
      onExport={exportCsv}
    />
  );
}

export default function RcsaFindingsPage() {
  return <Suspense fallback={null}><Findings /></Suspense>;
}
