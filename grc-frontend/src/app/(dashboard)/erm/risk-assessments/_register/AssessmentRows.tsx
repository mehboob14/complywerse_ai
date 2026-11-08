'use client';

/**
 * The rows of the Risk Assessments list, as configuration for records/RecordTable: the columns (Assessment, Stage, Owner, Progress, Changed), the card a phone gets and the row's menu.
 * One status word per kind in its own words ("Completed" for a framework assessment, "Approved" for a manual one) and one pill tone for both (statuses/assessments.ts). Nothing appears only
 * on hover; the owner is a person or "Unassigned"; the progress says what it counts ("18 of 40 answered").
 */
import Link from 'next/link';
import { Eye, Trash2 } from 'lucide-react';
import { Menu, PersonChip, ProgressBar, StatusPill, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { EMPTY, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { assessmentStatus, frameworkAssessmentStatus } from '@/lib/statuses/riskAssessments';
import { hrefOf, progressOf, progressWords, type AssessmentRow } from './assessmentModel';

const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const FIT: Record<'status' | 'owner' | 'progress' | 'changed', Omit<FitColumn, 'key'>> = {
  status: { px: 140 },
  progress: { px: 230, dropRank: 1 },
  owner: { px: 68, dropRank: 2, wide: { px: 176, titleMin: 420 } },
  changed: { px: 116, dropRank: 3 },
};

export interface RowEnv {
  onPeek: (row: AssessmentRow) => void;
  canWrite: boolean;
  onDelete: (row: AssessmentRow) => void;
  compact: boolean;
}

/** "Framework · ISO 27005" / "Manual · Periodic · Qualitative": what an assessment is, in one line under its name. */
export function subline(r: AssessmentRow): string {
  const words = (s?: string | null) => (s ? `${s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}` : '');
  return r.kind === 'framework'
    ? ['Framework', r.framework_name].filter(Boolean).join(' · ')
    : ['Manual', words(r.assessment_type), words(r.methodology)].filter(Boolean).join(' · ');
}

export function StatusCell({ row }: { row: AssessmentRow }) {
  return <StatusPill size="sm" {...statusPill(row.kind === 'framework' ? frameworkAssessmentStatus : assessmentStatus, row.status)} />;
}

export function OwnerCell({ row, withName = false }: { row: AssessmentRow; withName?: boolean }) {
  const name = row.owner_name?.trim();
  if (!name) return <span className="text-ds-body text-ds-fg-muted" title="Nobody is named"><span aria-hidden>{EMPTY}</span><span className="sr-only">Unassigned</span></span>;
  const which = row.kind === 'framework' ? 'Created by' : 'Lead assessor';
  return withName ? <PersonChip name={name} /> : <span className="inline-flex" title={`${which}: ${name}`}><PersonChip name={name} className="[&>span:last-child]:sr-only" /></span>;
}

export function ProgressCell({ row }: { row: AssessmentRow }) {
  const p = progressOf(row);
  const blocked = row.blocked_items;
  return (
    <div className="min-w-0">
      {p.pct == null ? <span className="text-ds-body text-ds-fg-muted">{progressWords(row)}</span> : (
        <ProgressBar value={p.pct} label={`${row.name}: ${progressWords(row)}`} valueText={progressWords(row)} showValue={false} tone={p.pct === 100 ? 'success' : 'primary'} className="w-full max-w-[160px]" />
      )}
      {p.pct != null && <p className="m-0 truncate text-ds-label text-ds-fg-muted">{progressWords(row)}{blocked > 0 && <span className="font-[600] text-ds-danger"> · {blocked} blocked</span>}</p>}
    </div>
  );
}

function Title({ row, env }: { row: RecordRow<AssessmentRow>; env: RowEnv }) {
  const r = row.record;
  const line = subline(r);
  return (
    <div className="min-w-0">
      <div dir="auto" className={`min-w-0 text-ds-body [overflow-wrap:anywhere] ${env.compact ? 'truncate' : 'line-clamp-2'}`}>
        <Link
          href={hrefOf(r)}
          prefetch={false}
          title={r.name}
          onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onPeek(r); } }}
          className="scroll-mt-[44px] rounded-ds-control py-[1px] font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none"
        >
          {r.name}
        </Link>
      </div>
      {!env.compact && line && <p className="m-0 truncate text-ds-label text-ds-fg-muted" title={line}>{line}</p>}
    </div>
  );
}

export function assessmentColumns(env: RowEnv): RecordColumn<AssessmentRow>[] {
  return [
    { key: 'name', header: 'Assessment', sortKey: 'name', cell: (row) => <RowLead row={row}><Title row={row} env={env} /></RowLead> },
    { key: 'status', header: 'Stage', sortKey: 'status', fit: FIT.status, cell: (row) => <StatusCell row={row.record} /> },
    { key: 'progress', header: 'Progress', sortKey: 'progress', fit: FIT.progress, cell: (row) => <ProgressCell row={row.record} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: FIT.owner, cell: (row, look) => <OwnerCell row={row.record} withName={look.wide} /> },
    { key: 'changed', header: 'Changed', sortKey: 'updated', fit: FIT.changed, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(row.record.updated_at)}</span> },
  ];
}

/** The card a row is where the list has no room for a table: the name (two lines), then the stage, the progress and the owner. */
export function AssessmentCard({ row }: { row: RecordRow<AssessmentRow> }) {
  const r = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={r.name} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.name}</span>
      <span className="truncate text-ds-label text-ds-fg-muted">{subline(r)}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusCell row={r} />
        <span className="text-ds-label text-ds-fg-muted">{progressWords(r)}</span>
        {r.blocked_items > 0 && <span className="whitespace-nowrap text-ds-label font-[600] text-ds-danger">{r.blocked_items} blocked</span>}
        <span className="ml-auto"><OwnerCell row={r} /></span>
      </span>
    </div>
  );
}

export function RowMenu({ row, env, onOpen }: { row: AssessmentRow; env: Pick<RowEnv, 'canWrite' | 'onDelete'>; onOpen: (row: AssessmentRow) => void }) {
  const items: MenuItem[] = [
    { key: 'open', label: 'Open', icon: Eye, onSelect: () => onOpen(row) },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !env.canWrite, onSelect: () => env.onDelete(row) },
  ];
  return <Menu label={`Actions for ${truncate(row.name, 60).text}`} iconOnly items={items} />;
}
