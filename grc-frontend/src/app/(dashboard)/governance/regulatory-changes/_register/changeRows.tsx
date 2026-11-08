'use client';

/**
 * The rows of the Changes register, as configuration for records/RecordTable: the columns (Circular, Status, Priority, Takes effect, Tasks, Obligations, Owner), the card a narrow list gets, the
 * row's menu. The title is shown in full (two lines, clamped; the whole text is the link's title and the drawer), what the change waits for is words under the title, nothing appears only on
 * hover. What a cell says is decided in _lib/regulatoryModel.ts.
 */
import Link from 'next/link';
import { Eye, Trash2 } from 'lucide-react';
import { Menu, StatusPill, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { EMPTY, truncate } from '@/lib/format';
import { priority, statusPill } from '@/lib/status';
import { attentionOf } from '../_lib/regulatoryModel';
import type { ChangeRow } from '../_lib/types';
import { EffectiveCell, OwnerCell, RegulatorCell, StatusCell, TasksCell } from '../_parts/shared';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const CHANGE_FIT: Record<'status' | 'priority' | 'effective' | 'tasks' | 'obligations' | 'owner', Omit<FitColumn, 'key'>> = {
  status: { px: 148 },
  tasks: { px: 132, dropRank: 5 },
  effective: { px: 112, dropRank: 4 },
  priority: { px: 92, dropRank: 3 },
  obligations: { px: 112, dropRank: 2 },
  owner: { px: 68, dropRank: 1, wide: { px: 168, titleMin: 420 } },
};

export interface RowEnv {
  today: Date;
  compact: boolean;
  hrefOf: (id: number) => string;
  /** the title was pressed: the details open over the list */
  onPeek: (id: number) => void;
  onOpen: (id: number) => void;
  canDelete: boolean;
  onDelete: (row: ChangeRow) => void;
}

const TONE_CLASS = { danger: 'text-ds-danger', warning: 'text-ds-warning', progress: 'text-ds-info', neutral: 'text-ds-fg-muted' } as const;

/** What the change waits for, in words under its title (the first two; the drawer has them all). */
export function Needs({ change, limit = 2 }: { change: ChangeRow; limit?: number }) {
  const list = attentionOf(change);
  if (list.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-[8px]">
      {list.slice(0, limit).map((a) => <span key={a.key} className={`whitespace-nowrap text-ds-label font-[600] ${TONE_CLASS[a.tone]}`}>{a.label}</span>)}
      {list.length > limit && <span className="whitespace-nowrap text-ds-label text-ds-fg-muted">{`+${list.length - limit} more`}</span>}
    </span>
  );
}

function ChangeTitle({ row, env }: { row: RecordRow<ChangeRow>; env: RowEnv }) {
  const c = row.record;
  const line = [c.reference_number].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0">
      <div dir="auto" className={`min-w-0 text-ds-body [overflow-wrap:anywhere] ${env.compact ? 'truncate' : 'line-clamp-2'}`}>
        <Link
          href={env.hrefOf(c.id)}
          prefetch={false}
          title={c.title}
          onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onPeek(c.id); } }}
          className="scroll-mt-[44px] rounded-ds-control py-[1px] font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none"
        >
          {c.title}
        </Link>
      </div>
      {!env.compact && (
        <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-[8px] text-ds-label text-ds-fg-muted">
          <RegulatorCell source={c.source} />
          {line && <span className="min-w-0 truncate" title={line}>{line}</span>}
          <Needs change={c} />
        </p>
      )}
    </div>
  );
}

const PriorityCell = ({ value }: { value: string }) => <StatusPill size="sm" {...statusPill(priority, value)} />;

export function ObligationsCell({ change }: { change: ChangeRow }) {
  const n = change.obligation_count ?? 0;
  if (n === 0) return <span className="text-ds-body text-ds-fg-muted">{EMPTY}<span className="sr-only">No obligations yet</span></span>;
  return <span className="whitespace-nowrap text-ds-body text-ds-fg"><span className="tabular-nums">{n}</span><span className="text-ds-label text-ds-fg-muted">{` · ${change.met_count ?? 0} met`}</span></span>;
}

export function changeColumns(env: RowEnv): RecordColumn<ChangeRow>[] {
  return [
    { key: 'title', header: 'Circular', sortKey: 'title', cell: (row) => <RowLead row={row}><ChangeTitle row={row} env={env} /></RowLead> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: CHANGE_FIT.status, cell: (row) => <StatusCell status={row.record.status} /> },
    { key: 'priority', header: 'Priority', sortKey: 'priority', fit: CHANGE_FIT.priority, cell: (row) => <PriorityCell value={row.record.priority} /> },
    { key: 'effective', header: 'Takes effect', sortKey: 'effective', fit: CHANGE_FIT.effective, cell: (row) => <EffectiveCell change={row.record} today={env.today} /> },
    { key: 'tasks', header: 'Tasks', fit: CHANGE_FIT.tasks, cell: (row) => <TasksCell change={row.record} /> },
    { key: 'obligations', header: 'Obligations', fit: CHANGE_FIT.obligations, cell: (row) => <ObligationsCell change={row.record} /> },
    { key: 'owner', header: 'Owner', fit: CHANGE_FIT.owner, cell: (row, look) => <OwnerCell change={row.record} withName={look.wide} /> },
  ];
}

/** The card a row is where the list has no room for a table: the title (two lines), what it waits for, then the status, the priority and when it takes effect. */
export function ChangeCard({ row, env }: { row: RecordRow<ChangeRow>; env: RowEnv }) {
  const c = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={c.title} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{c.title}</span>
      <Needs change={c} limit={3} />
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusCell status={c.status} />
        <PriorityCell value={c.priority} />
        <span className="ml-auto"><EffectiveCell change={c} today={env.today} /></span>
      </span>
    </div>
  );
}

/** The row's menu: Open, and Delete for the person who may. Always drawn; reachable by Tab, Enter and the arrow keys. */
export function RowMenu({ row, env }: { row: ChangeRow; env: RowEnv }) {
  const items: MenuItem[] = [
    { key: 'open', label: 'Open', icon: Eye, onSelect: () => env.onOpen(row.id) },
    { key: 'delete', label: 'Delete', icon: Trash2, onSelect: () => env.onDelete(row), danger: true, hidden: !env.canDelete },
  ];
  return <Menu label={`Actions for ${truncate(row.title, 60).text}`} iconOnly items={items} />;
}
