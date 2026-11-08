'use client';

/**
 * The rows of the Risk Register's list, as configuration for records/RecordTable: the columns (Risk, Level, Status, Owner, SLA, Review), the card a phone gets, the row's menu.
 * The title is shown in full (two lines, clamped; the whole text is the link's title and the details panel), the level is a word and the two scores ("Not scored" when there
 * is none, never "low"), the owner is a person or "Unassigned", nothing appears only on hover. What a cell says is decided in riskModel.ts.
 */
import Link from 'next/link';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { Menu, PersonChip, StatusPill, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { EMPTY, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { riskLevel, riskSla, riskStatus } from '@/lib/statuses/risk';
import { BUCKET_LABEL, categoryKey, categoryLabel, levelOf, reviewOf, statusBucket, type RiskRow } from './riskModel';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const RISK_FIT: Record<'level' | 'status' | 'owner' | 'sla' | 'review', Omit<FitColumn, 'key'>> = {
  level: { px: 150 },
  status: { px: 128 },
  owner: { px: 68, dropRank: 2, wide: { px: 176, titleMin: 420 } },
  sla: { px: 112, dropRank: 1 },
  review: { px: 124, dropRank: 3 },
};

export interface RowEnv {
  now: Date;
  reviews: ReadonlyMap<number, string>;
  compact: boolean;
  hrefOf: (id: number) => string;
  /** the title was pressed: the details open over the list */
  onPeek: (id: number) => void;
  onOpen: (id: number) => void;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (row: RiskRow) => void;
  onDelete: (row: RiskRow) => void;
}

/** "Operational · NCA Template · Payments": what a risk is filed under, in one line under its title. */
export function subline(r: RiskRow): string {
  return [categoryLabel(categoryKey(r)), r.register_type?.trim(), r.business_unit_name].filter(Boolean).join(' · ');
}

function RiskTitle({ row, env }: { row: RecordRow<RiskRow>; env: RowEnv }) {
  const r = row.record;
  const line = subline(r);
  return (
    <div className="min-w-0">
      <div dir="auto" className={`min-w-0 text-ds-body [overflow-wrap:anywhere] ${env.compact ? 'truncate' : 'line-clamp-2'}`}>
        <Link
          href={env.hrefOf(r.id)}
          prefetch={false}
          title={r.title}
          onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onPeek(r.id); } }}
          className="scroll-mt-[44px] rounded-ds-control py-[1px] font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none"
        >
          {r.title}
        </Link>
      </div>
      {!env.compact && line && <p className="m-0 truncate text-ds-label text-ds-fg-muted" title={line}>{line}</p>}
    </div>
  );
}

/** "Critical" with its two scores: "16 → 12" (inherent, then residual). A missing score is a dash, never a zero. */
export function LevelCell({ row, withScores = true }: { row: RiskRow; withScores?: boolean }) {
  const level = levelOf(row);
  const inh = row.inherent_score != null ? String(Math.round(row.inherent_score)) : EMPTY;
  const res = row.residual_score != null ? String(Math.round(row.residual_score)) : EMPTY;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
      <StatusPill size="sm" {...statusPill(riskLevel, level)} />
      {withScores && level !== 'none' && (
        <span className="whitespace-nowrap text-ds-label tabular-nums text-ds-fg-muted" title={`Inherent score ${inh}, residual score ${res}`}>
          {inh}<span aria-hidden> → </span><span className="sr-only"> then </span>{res}
        </span>
      )}
    </span>
  );
}

export function OwnerCell({ row, withName = false }: { row: RiskRow; withName?: boolean }) {
  const name = row.owner_name?.trim() || row.business_owner_name?.trim() || null;
  const which = row.owner_name?.trim() ? 'Risk owner' : row.business_owner_name?.trim() ? 'Business owner' : null;
  if (!name) return <span className="text-ds-body text-ds-fg-muted" title="Nobody owns this risk"><span aria-hidden>{EMPTY}</span><span className="sr-only">Unassigned</span></span>;
  return withName ? <PersonChip name={name} /> : (
    <span className="inline-flex" title={`${which}: ${name}`}><PersonChip name={name} className="[&>span:last-child]:sr-only" /></span>
  );
}

export function SlaCell({ row }: { row: RiskRow }) {
  const state = row.sla?.state;
  if (!state || state === 'no_due_date' || state === 'closed') return <span className="text-ds-body text-ds-fg-muted">{EMPTY}<span className="sr-only">{riskSla.label(state || 'no_due_date')}</span></span>;
  const days = state === 'breached' && row.sla?.days_overdue ? `${row.sla.days_overdue} d` : state === 'due_soon' && row.sla?.due_in_days != null ? `in ${row.sla.due_in_days} d` : '';
  return (
    <span className="inline-flex flex-wrap items-center gap-x-[6px]">
      <StatusPill size="sm" {...statusPill(riskSla, state)} />
      {days && <span className="whitespace-nowrap text-ds-label text-ds-fg-muted">{days}</span>}
    </span>
  );
}

export function ReviewCell({ row, env }: { row: RiskRow; env: Pick<RowEnv, 'now' | 'reviews'> }) {
  const s = reviewOf(row, env.reviews, env.now);
  if (s.state === 'none' || !s.due) return <span className="text-ds-body text-ds-fg-muted">{EMPTY}<span className="sr-only">Review not scheduled</span></span>;
  return (
    <span className={`whitespace-nowrap text-ds-body ${s.state === 'overdue' ? 'font-[600] text-ds-danger' : 'text-ds-fg-body'}`}>
      {formatDate(s.due)}{s.state === 'overdue' && <span className="ml-[4px] text-ds-label">overdue</span>}
    </span>
  );
}

export function riskColumns(env: RowEnv): RecordColumn<RiskRow>[] {
  return [
    { key: 'title', header: 'Risk', sortKey: 'title', cell: (row) => <RowLead row={row}><RiskTitle row={row} env={env} /></RowLead> },
    { key: 'level', header: 'Level', sortKey: 'level', firstDir: 'desc', fit: RISK_FIT.level, cell: (row) => <LevelCell row={row.record} /> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: RISK_FIT.status, cell: (row) => <StatusPill size="sm" {...statusPill(riskStatus, row.record.status || 'open')} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: RISK_FIT.owner, cell: (row, look) => <OwnerCell row={row.record} withName={look.wide} /> },
    { key: 'sla', header: 'SLA', fit: RISK_FIT.sla, cell: (row) => <SlaCell row={row.record} /> },
    { key: 'review', header: 'Review', sortKey: 'review', fit: RISK_FIT.review, cell: (row) => <ReviewCell row={row.record} env={env} /> },
  ];
}

/** The card a row is where the list has no room for a table: the title (two lines), then the level, the status and the owner. */
export function RiskCard({ row, env }: { row: RecordRow<RiskRow>; env: RowEnv }) {
  const r = row.record;
  const s = reviewOf(r, env.reviews, env.now);
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={r.title} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.title}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <LevelCell row={r} withScores={false} />
        <StatusPill size="sm" {...statusPill(riskStatus, r.status || 'open')} />
        {s.state === 'overdue' && <span className="whitespace-nowrap text-ds-label font-[600] text-ds-danger">Review overdue</span>}
        <span className="ml-auto"><OwnerCell row={r} /></span>
      </span>
    </div>
  );
}

/** The row's menu: Open, Edit, Delete, for the person who may. Always drawn; reachable by Tab, Enter and the arrow keys. */
export function RowMenu({ row, env }: { row: RiskRow; env: RowEnv }) {
  const items: MenuItem[] = [
    { key: 'open', label: 'Open', icon: Eye, onSelect: () => env.onOpen(row.id) },
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => env.onEdit(row), hidden: !env.canEdit },
    { key: 'delete', label: 'Delete', icon: Trash2, onSelect: () => env.onDelete(row), danger: true, hidden: !env.canDelete },
  ];
  return <Menu label={`Actions for ${truncate(row.title, 60).text}`} iconOnly items={items} />;
}

export { BUCKET_LABEL, statusBucket };
