'use client';

/**
 * The rows of the Statements register's list, as configuration for records/RecordTable: the columns (Statement with its document under it, Status, Priority, Assignee), the card a narrow room gets and
 * the row's menu. The statement is its code and its first two lines (the whole text is in the drawer); status and priority are a word with a tone; a statement with no priority shows a
 * dash (the old page invented "medium"); an assignee is a person or "Unassigned"; nothing appears only on hover. What a cell says is decided in statementModel.ts.
 */
import Link from 'next/link';
import { Eye, FileText } from 'lucide-react';
import { Menu, PersonChip, StatusPill, type MenuItem } from '@/components/ui/ds';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { EMPTY, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { statementCompliance, statementPriority } from '@/lib/statuses/complianceStatements';
import { NONE, documentName, priorityKey, statementTitle, type StatementRow } from './statementModel';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const STATEMENT_FIT: Record<'status' | 'priority' | 'assignee', Omit<FitColumn, 'key'>> = {
  status: { px: 172 },
  priority: { px: 116, dropRank: 1 },
  assignee: { px: 76, dropRank: 2, wide: { px: 176, titleMin: 420 } },
};

export interface RowEnv {
  /** the title was pressed: the details open over the list */
  onPeek: (id: number) => void;
  onDocument: (documentId: number) => void;
}

const peekHref = (id: number) => `/compliance/statements?open=${id}`;

function Title({ row, env }: { row: RecordRow<StatementRow>; env: RowEnv }) {
  const r = row.record;
  const code = (r.statement_code ?? '').trim();
  return (
    <div className="min-w-0">
      <div dir="auto" className="line-clamp-2 min-w-0 text-ds-body [overflow-wrap:anywhere]">
        {code && <span className="mr-[6px] font-mono text-ds-label text-ds-primary-text">{code}</span>}
        <Link
          href={peekHref(r.id)}
          prefetch={false}
          title={statementTitle(r)}
          onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onPeek(r.id); } }}
          className="scroll-mt-[44px] rounded-ds-control py-[1px] font-[500] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none"
        >
          {statementTitle(r)}
        </Link>
      </div>
      <p className="m-0 truncate text-ds-label text-ds-fg-muted" title={documentName(r)}>{documentName(r)}</p>
    </div>
  );
}

export function ComplianceCell({ row }: { row: StatementRow }) {
  return <StatusPill size="sm" {...statusPill(statementCompliance, row.compliance_status || 'not_assessed')} />;
}

export function PriorityCell({ row }: { row: StatementRow }) {
  if (priorityKey(row) === NONE) return <span className="text-ds-body text-ds-fg-muted"><span aria-hidden>{EMPTY}</span><span className="sr-only">No priority</span></span>;
  return <StatusPill size="sm" {...statusPill(statementPriority, priorityKey(row))} />;
}

export function AssigneeCell({ row, withName = false }: { row: StatementRow; withName?: boolean }) {
  const name = (row.assignee_name ?? '').trim();
  if (row.assigned_to_user_id == null) return <span className="text-ds-body text-ds-fg-muted" title="Nobody is assigned"><span aria-hidden>{EMPTY}</span><span className="sr-only">Unassigned</span></span>;
  const shown = name || 'Someone no longer here';
  return withName ? <PersonChip name={shown} /> : (
    <span className="inline-flex" title={`Assigned to ${shown}`}><PersonChip name={shown} className="[&>span:last-child]:sr-only" /></span>
  );
}

export function statementColumns(env: RowEnv): RecordColumn<StatementRow>[] {
  return [
    { key: 'statement', header: 'Statement', sortKey: 'code', cell: (row) => <Title row={row} env={env} /> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: STATEMENT_FIT.status, cell: (row) => <ComplianceCell row={row.record} /> },
    { key: 'priority', header: 'Priority', sortKey: 'priority', fit: STATEMENT_FIT.priority, cell: (row) => <PriorityCell row={row.record} /> },
    { key: 'assignee', header: 'Assignee', fit: STATEMENT_FIT.assignee, cell: (row, look) => <AssigneeCell row={row.record} withName={look.wide} /> },
  ];
}

/** The card a row is where the list has no room for a table. */
export function StatementCard({ row }: { row: RecordRow<StatementRow> }) {
  const r = row.record;
  const code = (r.statement_code ?? '').trim();
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={statementTitle(r)} className="line-clamp-2 text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">
        {code && <span className="mr-[6px] font-mono text-ds-label text-ds-primary-text">{code}</span>}
        {statementTitle(r)}
      </span>
      <span className="truncate text-ds-label text-ds-fg-muted">{documentName(r)}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <ComplianceCell row={r} />
        {priorityKey(r) !== NONE && <PriorityCell row={r} />}
        <span className="ml-auto"><AssigneeCell row={r} /></span>
      </span>
    </div>
  );
}

export function rowActions(row: StatementRow, env: RowEnv): MenuItem[] {
  return [
    { key: 'open', label: 'Open details', icon: Eye, onSelect: () => env.onPeek(row.id) },
    { key: 'document', label: 'Open the document', icon: FileText, onSelect: () => env.onDocument(row.document_id) },
  ];
}

export function RowMenu({ row, env }: { row: StatementRow; env: RowEnv }) {
  return <Menu label={`Actions for ${truncate(statementTitle(row), 60).text}`} iconOnly items={rowActions(row, env)} />;
}
