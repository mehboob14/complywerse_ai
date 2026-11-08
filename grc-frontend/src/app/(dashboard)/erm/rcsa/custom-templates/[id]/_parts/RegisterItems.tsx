'use client';

// The items of a register on the facet explorer: a table a person can search, filter by owner, level, evidence or the Risk Register, sort (residual score, high to low, by default) and page, with
// the inherent and residual levels as labelled pills with their score (never colour alone). A row opens the item in a side panel; `?open=` in the address does the same, which is how the
// Worklist's and "Assigned to me" links land on an item. Every number is the true count of the complete load.
import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Avatar, Button, EmptyState, PersonChip, StatusPill, TitleLink } from '@/components/ui/ds';
import type { ExplorerFit } from '@/components/records/explorerFit';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { csvName, toCsv } from '@/lib/rcsa/csv';
import { saveBlob } from '@/lib/rcsa/saveBlob';
import {
  CSV_HEADER, EVIDENCE_OPTIONS, LINKED_OPTIONS, csvRow, evidenceValue, keyColumns, levelOptions, levelSort, levelValue, levelWord, linkedValue, ownerOptions, ownerValue, referenceOf, scoreText,
  searchTextOf, titleOf, valueOf, type ColumnSchema, type KeyColumns, type RegisterRow,
} from '@/lib/rcsa/registerModel';
import { statusPill } from '@/lib/status';
import { registerLevel } from '@/lib/statuses/rcsa';
import { RcsaExplorer, type ExplorerFacet, type ExplorerQuick, type ExplorerSort } from '../../../_parts/RcsaExplorer';
import { ItemDrawer } from './ItemDrawer';

const label = (word: string) => statusPill(registerLevel, word).label;
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
const HIGH = ['critical', 'very_high', 'high'];

/** Opens an item the way the explorer's own row click does: `open` in the address (Next folds history.replaceState into the search params the explorer reads). */
function openItem(id: number): void {
  const url = new URL(window.location.href);
  url.searchParams.set('open', String(id));
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function Level({ name, text, score }: { name: string; text?: string | null; score?: number | null }) {
  if (!text) return <span className="text-ds-body text-ds-fg-muted">Not rated</span>;
  const pill = statusPill(registerLevel, levelWord(text));
  return (
    <span className="inline-flex flex-wrap items-center gap-x-[6px] gap-y-[2px]">
      <StatusPill size="sm" tone={pill.tone} label={pill.label} />
      {typeof score === 'number' && <span className="text-ds-label tabular-nums text-ds-fg-muted" title={`${name} ${scoreText(score).toLowerCase()}`}><span className="sr-only">{`${name} score `}</span>{score}</span>}
    </span>
  );
}

function columnsFor(keys: KeyColumns): RecordColumn<RegisterRow>[] {
  const cols: RecordColumn<RegisterRow>[] = [
    {
      key: 'item', header: 'Item', sortKey: 'item',
      cell: (row) => (
        // a plain click opens the item over the list: the explorer keeps the open item in the address, so the address is what changes; a click with a modifier is the browser's (a new tab at ?open=)
        <TitleLink href={`?open=${row.record.id}`} title={titleOf(row.record, keys)} prefetch={false} onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); openItem(row.record.id); } }} />
      ),
    },
  ];
  if (keys.reference) cols.push({ key: 'reference', header: keys.reference.label, sortKey: 'reference', fit: { px: 110, dropRank: 5 }, cell: (row) => <span className="line-clamp-1 text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">{referenceOf(row.record, keys) || '—'}</span> });
  if (keys.process) cols.push({ key: 'process', header: keys.process.label, sortKey: 'process', fit: { px: 150, dropRank: 3 }, cell: (row) => <span className="line-clamp-2 text-ds-body text-ds-fg [overflow-wrap:anywhere]">{valueOf(row.record, keys.process) || '—'}</span> });
  cols.push(
    { key: 'inherent', header: 'Inherent', sortKey: 'inherent', firstDir: 'desc', fit: { px: 140, dropRank: 4 }, cell: (row) => <Level name="Inherent" text={row.record.inherent_overall_label} score={row.record.inherent_overall_score} /> },
    { key: 'residual', header: 'Residual', sortKey: 'residual', firstDir: 'desc', fit: { px: 140 }, cell: (row) => <Level name="Residual" text={row.record.residual_overall_label} score={row.record.residual_overall_score} /> },
    {
      key: 'owner', header: 'Owner', sortKey: 'owner', fit: { px: 88, dropRank: 6, wide: { px: 176, titleMin: 520 } },
      cell: (row, look) => (look.wide ? <PersonChip name={row.record.assigned_user_name} /> : (
        <span title={row.record.assigned_user_name || 'Unassigned'}>
          <Avatar name={row.record.assigned_user_name} size={24} />
          {!row.record.assigned_user_name && <span className="sr-only">Unassigned</span>}
        </span>
      )),
    },
    { key: 'evidence', header: 'Evidence', sortKey: 'evidence', firstDir: 'desc', fit: { px: 100, dropRank: 2 }, cell: (row) => <span className="text-ds-body tabular-nums text-ds-fg">{(row.record.evidence_count ?? 0) > 0 ? row.record.evidence_count : <span className="text-ds-fg-muted">—<span className="sr-only">No evidence</span></span>}</span> },
    {
      key: 'linked', header: 'In the register', fit: { px: 124, dropRank: 1 },
      cell: (row) => (row.record.linked_risk_id
        ? <Link href={`/erm/risks/${row.record.linked_risk_id}`} onClick={stop} className="text-ds-body text-ds-primary-text underline focus-visible:outline-none focus-visible:shadow-ds-ring">In the register</Link>
        : <span className="text-ds-body text-ds-fg-muted">—<span className="sr-only">Not in the Risk Register</span></span>),
    },
  );
  return cols;
}

export function RegisterItems({ templateId, schema, rows, loading, error, canEdit, head, notices, empty, onAdd }: {
  templateId: number; schema: ColumnSchema; rows: readonly RegisterRow[]; loading: boolean; error: { message: string; onRetry?: () => void } | null; canEdit: boolean;
  head: (fit: ExplorerFit) => ReactNode; notices?: ReactNode; empty?: ReactNode; onAdd?: () => void;
}) {
  const keys = useMemo(() => keyColumns(schema), [schema]);
  const columns = useMemo(() => columnsFor(keys), [keys]);
  const facets = useMemo<ExplorerFacet<RegisterRow>[]>(() => [
    { key: 'owner', label: 'Owner', values: (r) => [ownerValue(r)], options: (rs) => ownerOptions(rs), searchable: true, defaultOpen: true },
    { key: 'residual', label: 'Residual', values: (r) => [levelValue(r.residual_overall_label)], options: (rs) => levelOptions(rs, (r) => r.residual_overall_label, label), defaultOpen: true },
    { key: 'inherent', label: 'Inherent', values: (r) => [levelValue(r.inherent_overall_label)], options: (rs) => levelOptions(rs, (r) => r.inherent_overall_label, label) },
    { key: 'evidence', label: 'Evidence', values: (r) => [evidenceValue(r)], options: (rs) => (rs.length ? EVIDENCE_OPTIONS : []) },
    { key: 'register', label: 'In the Risk Register', values: (r) => [linkedValue(r)], options: (rs) => (rs.length ? LINKED_OPTIONS : []) },
  ], []);
  const quick = useMemo<ExplorerQuick<RegisterRow>[]>(() => [
    { key: 'unassigned', label: 'Unassigned', test: (r) => !r.assigned_user_id },
    { key: 'high', label: 'High residual risk', test: (r) => HIGH.indexOf(levelWord(r.residual_overall_label)) >= 0 },
    { key: 'noevidence', label: 'No evidence', test: (r) => (r.evidence_count ?? 0) === 0 },
  ], []);
  const sorts = useMemo<ExplorerSort<RegisterRow>[]>(() => [
    { key: 'item', value: (r) => titleOf(r, keys) },
    { key: 'reference', value: (r) => referenceOf(r, keys) },
    { key: 'process', value: (r) => valueOf(r, keys.process) },
    { key: 'inherent', value: (r) => levelSort(r.inherent_overall_label, r.inherent_overall_score), firstDir: 'desc' },
    { key: 'residual', value: (r) => levelSort(r.residual_overall_label, r.residual_overall_score), firstDir: 'desc' },
    { key: 'owner', value: (r) => r.assigned_user_name || null },
    { key: 'evidence', value: (r) => r.evidence_count ?? 0, firstDir: 'desc' },
  ], [keys]);

  const card = (row: RecordRow<RegisterRow>) => {
    const r = row.record;
    return (
      <div className="flex min-w-0 flex-col gap-[6px]">
        <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{titleOf(r, keys)}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px] text-ds-label text-ds-fg-muted">
          <Level name="Residual" text={r.residual_overall_label} score={r.residual_overall_score} />
          <span>{r.assigned_user_name || 'Unassigned'}</span>
          <span>{(r.evidence_count ?? 0) > 0 ? `${r.evidence_count} evidence` : 'No evidence'}</span>
        </span>
      </div>
    );
  };

  const exportCsv = (shown: RegisterRow[]) => saveBlob(new Blob([toCsv(CSV_HEADER, shown.map((r) => csvRow(r, keys)))], { type: 'text/csv;charset=utf-8' }), csvName('register-items'));

  return (
    <RcsaExplorer<RegisterRow>
      label="Items"
      noun={{ one: 'item', other: 'items' }}
      rows={rows}
      loading={loading}
      error={error}
      facets={facets}
      quick={quick}
      searchText={searchTextOf}
      columns={columns}
      card={card}
      sorts={sorts}
      defaultSort={{ key: 'residual', dir: 'desc' }}
      head={head}
      notices={notices}
      empty={empty ?? (
        <EmptyState
          kind="firstUse"
          title="No items yet"
          description={canEdit ? 'Add the first item. Each item is one row of the register, with its owner and its evidence.' : 'This register has no items yet.'}
          action={canEdit && onAdd ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onAdd}>Add an item</Button> : undefined}
        />
      )}
      onExport={exportCsv}
      detail={(open, close) => <ItemDrawer templateId={templateId} schema={schema} row={open} canEdit={canEdit} onClose={close} />}
    />
  );
}

