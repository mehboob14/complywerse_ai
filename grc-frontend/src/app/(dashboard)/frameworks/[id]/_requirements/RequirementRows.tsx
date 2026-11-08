'use client';

/**
 * The rows of the Requirements tab, as configuration for records/RecordTable and BoardColumns: the columns (Requirement with its code, name and what is left to tick; Status;
 * Evidence; Owner; Priority), the card a narrow room gets, the board's card, the row's menu and the line over each section. Status is a word with a tone (journey statuses, the same
 * as every other page of the journey); evidence is "2 of 6 approved" with the files still waiting said under it; an owner is a person or "Unassigned"; nothing appears only on hover.
 * What a cell says is decided in reqModel.ts.
 */
import Link from 'next/link';
import { Eye, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { Menu, PersonChip, PersonStack, StatusPill, Td, Tr, type MenuItem } from '@/components/ui/ds';
import type { RecordColumn, RecordItem, RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { EMPTY, formatCount, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { requirementState } from '@/lib/statuses/frameworkJourney';
import { evidenceLine, type GroupInfo, type ListItem, type ReqRow } from './reqModel';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const REQ_FIT: Record<'status' | 'evidence' | 'owner' | 'priority', Omit<FitColumn, 'key'>> = {
  status: { px: 148 },
  evidence: { px: 156, dropRank: 2 },
  owner: { px: 76, dropRank: 3, wide: { px: 168, titleMin: 460 } },
  priority: { px: 84, dropRank: 1 },
};

export interface RowEnv {
  /** the journey's address for one requirement (a link to it opens the drawer) */
  hrefOf: (id: number) => string;
  onPeek: (id: number) => void;
  canAssign: boolean;
  /** a scope request may be asked for (the journey is linked to a framework in the library) */
  canScope: boolean;
  onAssign: (id: number) => void;
  onScope: (id: number) => void;
}

const checklistWords = (r: ReqRow): string | null => {
  if (!r.checklist) return null;
  const what = r.checklist.kind === 'subcontrols' ? 'sub-controls' : 'criteria';
  return `${r.checklist.met} of ${r.checklist.total} ${what} met`;
};

function Title({ row, env }: { row: RecordRow<ReqRow>; env: RowEnv }) {
  const r = row.record;
  const words = checklistWords(r);
  return (
    <div className="min-w-0">
      <div dir="auto" className="line-clamp-2 min-w-0 text-ds-body [overflow-wrap:anywhere]">
        <span className="mr-[6px] font-mono text-ds-label text-ds-primary-text">{r.code}</span>
        <Link
          href={env.hrefOf(r.id)}
          prefetch={false}
          title={r.name}
          onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onPeek(r.id); } }}
          className="scroll-mt-[44px] rounded-ds-control py-[1px] font-[500] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none"
        >
          {r.name || 'Untitled requirement'}
        </Link>
      </div>
      {(r.critical || !r.inScope || words) && (
        <p className="m-0 mt-[2px] flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label text-ds-fg-muted">
          {!r.inScope && <StatusPill size="sm" tone="warning" label="Out of scope" />}
          {r.critical && <StatusPill size="sm" tone="danger" label="Critical" />}
          {words && <span className="min-w-0 truncate">{words}</span>}
        </p>
      )}
    </div>
  );
}

export function StatusCell({ row }: { row: ReqRow }) {
  return <StatusPill size="sm" {...statusPill(requirementState, row.status)} />;
}

export function EvidenceCell({ row }: { row: ReqRow }) {
  const e = row.evidence;
  return (
    <div className="min-w-0">
      <span className="block truncate text-ds-body tabular-nums text-ds-fg">{evidenceLine(e)}</span>
      {e.pending > 0 && <span className="block truncate text-ds-label text-ds-fg-muted">{`${formatCount(e.pending)} waiting for review`}</span>}
    </div>
  );
}

export function OwnerCell({ row, wide = false }: { row: ReqRow; wide?: boolean }) {
  if (row.owners.length === 0) return <span className="text-ds-body text-ds-fg-muted" title="Nobody owns it"><span aria-hidden>{EMPTY}</span><span className="sr-only">Unassigned</span></span>;
  if (!wide) return <PersonStack people={row.owners} max={2} size={24} label="Owners" />;
  return (
    <span className="inline-flex min-w-0 items-center gap-[6px]">
      <PersonChip name={row.owners[0]} />
      {row.owners.length > 1 && <span className="shrink-0 text-ds-label text-ds-fg-muted" title={row.owners.slice(1).join(', ')}>{`+${row.owners.length - 1}`}</span>}
    </span>
  );
}

export function PriorityCell({ row }: { row: ReqRow }) {
  if (!row.tier) return <span className="text-ds-body text-ds-fg-muted"><span aria-hidden>{EMPTY}</span><span className="sr-only">No priority</span></span>;
  return <span className="inline-flex items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] py-[1px] text-ds-label font-[500] text-ds-fg-body" title={`Priority ${row.tier} of 4: the order the standard suggests for planning`}>{row.tier}</span>;
}

export function reqColumns(env: RowEnv, hasPriority: boolean): RecordColumn<ReqRow>[] {
  const cols: RecordColumn<ReqRow>[] = [
    { key: 'requirement', header: 'Requirement', sortKey: 'order', cell: (row) => <Title row={row} env={env} /> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: REQ_FIT.status, cell: (row) => <StatusCell row={row.record} /> },
    { key: 'evidence', header: 'Evidence', sortKey: 'evidence', fit: REQ_FIT.evidence, cell: (row) => <EvidenceCell row={row.record} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: REQ_FIT.owner, cell: (row, look) => <OwnerCell row={row.record} wide={look.wide} /> },
  ];
  if (hasPriority) cols.push({ key: 'priority', header: 'Priority', sortKey: 'priority', fit: REQ_FIT.priority, cell: (row) => <PriorityCell row={row.record} /> });
  return cols;
}

/** The card a row is where the list has no room for a table. */
export function ReqCard({ row }: { row: RecordRow<ReqRow> }) {
  const r = row.record;
  const words = checklistWords(r);
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={r.name} className="line-clamp-2 text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">
        <span className="mr-[6px] font-mono text-ds-label font-normal text-ds-primary-text">{r.code}</span>
        {r.name || 'Untitled requirement'}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusCell row={r} />
        {!r.inScope && <StatusPill size="sm" tone="warning" label="Out of scope" />}
        {r.critical && <StatusPill size="sm" tone="danger" label="Critical" />}
        {r.tier && <PriorityCell row={r} />}
        <span className="ml-auto"><OwnerCell row={r} /></span>
      </span>
      <span className="truncate text-ds-label text-ds-fg-muted">
        {evidenceLine(r.evidence)}{r.evidence.pending > 0 ? `, ${formatCount(r.evidence.pending)} waiting for review` : ''}{words ? ` · ${words}` : ''}
      </span>
    </div>
  );
}

/** What a card of the board holds: the requirement, how far its evidence is and who owns it. */
export function BoardCard({ row }: { row: ReqRow }) {
  return (
    <>
      <span dir="auto" className="line-clamp-3 text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">
        <span className="mr-[6px] font-mono text-ds-label font-normal text-ds-primary-text">{row.code}</span>
        {row.name || 'Untitled requirement'}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label text-ds-fg-muted">
        {row.critical && <StatusPill size="sm" tone="danger" label="Critical" />}
        <span className="tabular-nums">{evidenceLine(row.evidence)}</span>
        <span className="ml-auto"><OwnerCell row={row} /></span>
      </span>
    </>
  );
}

export const boardCardLabel = (r: ReqRow): string => `${r.code} ${truncate(r.name, 80).text}, ${requirementState.label(r.status)}`;

export function rowActions(row: ReqRow, env: RowEnv): MenuItem[] {
  return [
    { key: 'open', label: 'Open details', icon: Eye, onSelect: () => env.onPeek(row.id) },
    { key: 'assign', label: 'Assign owners', icon: UserPlus, hidden: !env.canAssign, onSelect: () => env.onAssign(row.id) },
    { key: 'scope', label: row.inScope ? 'Ask to put out of scope' : 'Ask to put back in scope', icon: row.inScope ? ShieldOff : ShieldCheck, hidden: !env.canScope, onSelect: () => env.onScope(row.id) },
  ];
}

export function RowMenu({ row, env }: { row: ReqRow; env: RowEnv }) {
  return <Menu label={`Actions for ${row.code} ${truncate(row.name, 50).text}`} iconOnly items={rowActions(row, env)} />;
}

// ── the line over a section ──────────────────────────────────────────────────────────────────────────────────────────────

const doneWords = (g: GroupInfo): string => `${formatCount(g.done)} of ${formatCount(g.total)} implemented`;
const aboutText = (g: GroupInfo): string => g.fields.map((f) => `${f.label}: ${f.items && f.items.length > 0 ? f.items.join('; ') : f.text}`).join(' ');

function GroupHead({ g }: { g: GroupInfo }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]" style={{ paddingLeft: g.level === 2 ? 16 : 0 }}>
      {g.id && <span className="font-mono text-ds-label font-[600] text-ds-primary-text">{g.id}</span>}
      <span className={`min-w-0 text-ds-body text-ds-fg [overflow-wrap:anywhere] ${g.level === 1 ? 'font-[600]' : 'font-[500]'}`}>{g.title}</span>
      <span className="shrink-0 text-ds-label tabular-nums text-ds-fg-muted">{doneWords(g)}</span>
      {g.fields.length > 0 && <InfoTip text={aboutText(g)} label={`What the standard says about ${g.id || g.title}`} />}
    </span>
  );
}

/** The page's rows with their section lines, as the items a RecordTable draws. */
export function listItems(items: readonly ListItem[]): RecordItem<ReqRow>[] {
  return items.map((it, i) => {
    if (it.kind === 'row') return { kind: 'row' as const, id: it.row.id, record: it.row, depth: 0 };
    const g = it.group;
    return {
      kind: 'group' as const,
      id: `${g.key}-${i}`,
      table: (span: number) => (
        <Tr><Td colSpan={span} className="[&&]:!bg-ds-surface-subtle [&&]:!py-[6px]"><GroupHead g={g} /></Td></Tr>
      ),
      card: <li className="px-[4px] pt-[8px]"><GroupHead g={g} /></li>,
    };
  });
}
