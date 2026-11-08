'use client';

/**
 * The rows of the Controls list, as configuration for records/RecordTable: the columns (Control, Frameworks, Owner, Type, Next test, Status), the card a phone gets and the row's menu.
 * The code is a mono chip beside the name (the name is a link to the control, two lines then cut, the whole text is its title), the frameworks are the first two and a "+N" that opens
 * the rest, the owner is a person or an explicit "Unassigned", the status is a pill with its word, and nothing appears only on hover. What a cell says is decided in controlsModel.ts.
 */
import Link from 'next/link';
import { ClipboardCheck, Eye } from 'lucide-react';
import { ChipList, Menu, PersonChip, StatusPill, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { EMPTY, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { controlStatus } from '@/lib/statuses/controls';
import { frameworksOf, subline, testOverdue, type Row } from './controlsModel';

export const hrefOf = (code: string): string => `/automation/soc2-controls/${encodeURIComponent(code)}`;

export const CONTROL_FIT: Record<'frameworks' | 'owner' | 'type' | 'next' | 'status', Omit<FitColumn, 'key'>> = {
  frameworks: { px: 200, dropRank: 3 },
  owner: { px: 68, dropRank: 2, wide: { px: 176, titleMin: 420 } },
  type: { px: 96, dropRank: 1 },
  next: { px: 124, dropRank: 4 },
  status: { px: 150 },
};

export interface RowEnv {
  now: Date;
  compact: boolean;
  frameworkName: (key: string) => string;
  onOpen: (code: string, tab?: string) => void;
}

function CodeChip({ code }: { code: string }) {
  return <span className="inline-flex shrink-0 rounded-ds-control bg-ds-primary-soft px-[6px] py-[1px] font-mono text-ds-label font-[600] text-ds-primary-text">{code}</span>;
}

function Title({ row, env }: { row: RecordRow<Row>; env: RowEnv }) {
  const r = row.record;
  const line = subline(r);
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-[8px]">
        <CodeChip code={r.control_id} />
        <Link
          href={hrefOf(r.control_id)}
          prefetch={false}
          title={r.title}
          onClick={(e) => e.stopPropagation()}
          dir="auto"
          className={`min-w-0 scroll-mt-[44px] rounded-ds-control py-[1px] text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere] hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none ${env.compact ? 'truncate' : 'line-clamp-2'}`}
        >
          {r.title}
        </Link>
      </div>
      {!env.compact && line && <p className="m-0 truncate text-ds-label text-ds-fg-muted" title={line}>{line}</p>}
    </div>
  );
}

export function OwnerCell({ row, withName = false }: { row: Row; withName?: boolean }) {
  const name = row.owner_name?.trim() || null;
  const late = row.ownership_status === 'overdue';
  if (!name) return <span className="text-ds-body text-ds-fg-muted" title="Nobody owns this control"><span aria-hidden>{EMPTY}</span><span className="sr-only">Unassigned</span></span>;
  return (
    <span className="inline-flex min-w-0 flex-col" title={late ? `${name}: the date for their next review has passed` : name}>
      {withName ? <PersonChip name={name} /> : <PersonChip name={name} className="[&>span:last-child]:sr-only" />}
      {late && <span className="text-ds-label font-[600] text-ds-danger">{withName ? 'Overdue' : <span className="sr-only">Overdue</span>}</span>}
    </span>
  );
}

export function NextTestCell({ row, now }: { row: Row; now: Date }) {
  if (!row.next_test_date) return <span className="text-ds-body text-ds-fg-muted">{EMPTY}<span className="sr-only">No test scheduled</span></span>;
  const late = testOverdue(row, now);
  return (
    <span className={`whitespace-nowrap text-ds-body ${late ? 'font-[600] text-ds-danger' : 'text-ds-fg-body'}`}>
      {formatDate(row.next_test_date)}{late && <span className="ml-[4px] text-ds-label">overdue</span>}
    </span>
  );
}

export function StatusCell({ row, size = 'sm' }: { row: Row; size?: 'sm' | 'md' }) {
  return <StatusPill size={size} {...statusPill(controlStatus, row.overall_status || 'not_run')} />;
}

export function FrameworksCell({ row, env }: { row: Row; env: RowEnv }) {
  const keys = frameworksOf(row);
  if (keys.length === 0) return <span className="text-ds-label text-ds-fg-muted">None of your frameworks</span>;
  return <ChipList items={keys.map(env.frameworkName)} label="frameworks" shown={2} />;
}

export function controlColumns(env: RowEnv): RecordColumn<Row>[] {
  return [
    { key: 'title', header: 'Control', sortKey: 'code', cell: (row) => <RowLead row={row}><Title row={row} env={env} /></RowLead> },
    { key: 'frameworks', header: 'Frameworks', fit: CONTROL_FIT.frameworks, cell: (row) => <FrameworksCell row={row.record} env={env} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: CONTROL_FIT.owner, cell: (row, look) => <OwnerCell row={row.record} withName={look.wide} /> },
    { key: 'type', header: 'Type', fit: CONTROL_FIT.type, cell: (row) => <span className="text-ds-body text-ds-fg-body">{row.record.sub_type || EMPTY}</span> },
    { key: 'next', header: 'Next test', sortKey: 'next', fit: CONTROL_FIT.next, cell: (row) => <NextTestCell row={row.record} now={env.now} /> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: CONTROL_FIT.status, cell: (row) => <StatusCell row={row.record} /> },
  ];
}

/** The card a row is where the list has no room for a table: the code and name (two lines), then the status, the owner and, when it has passed, the test date. */
export function ControlCard({ row, env }: { row: RecordRow<Row>; env: RowEnv }) {
  const r = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span className="flex min-w-0 items-start gap-[8px]">
        <CodeChip code={r.control_id} />
        <span dir="auto" title={r.title} className="line-clamp-2 min-w-0 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.title}</span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusCell row={r} />
        {testOverdue(r, env.now) && <span className="whitespace-nowrap text-ds-label font-[600] text-ds-danger">Test overdue</span>}
        <span className="ml-auto"><OwnerCell row={r} /></span>
      </span>
    </div>
  );
}

/** The row's menu: Open, and its tests when it has checks. Always drawn; reachable by Tab, Enter and the arrow keys. */
export function RowMenu({ row, env }: { row: Row; env: RowEnv }) {
  const items: MenuItem[] = [
    { key: 'open', label: 'Open', icon: Eye, onSelect: () => env.onOpen(row.control_id) },
    { key: 'tests', label: 'Read its tests', icon: ClipboardCheck, onSelect: () => env.onOpen(row.control_id, 'tests'), hidden: row.checks_count === 0 },
  ];
  return <Menu label={`Actions for ${truncate(row.control_id, 40).text}`} iconOnly items={items} />;
}
