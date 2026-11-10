'use client';

// The Register tab: every finding in the client's own words on the Facet explorer (the shared RegisterFrame), five columns instead of thirteen (the rest is in the drawer), facets with live
// counts (source, status, risk, report, line of business, owner), five chips that answer "what is mine / waiting for me / late" at once, a board by status, and the state in the address (?source=,
// ?quick=, ?id=...). The list is the whole register read once; the server's real total says when it was cut. The finding opens in a drawer (FindingDrawer) that every other tab uses too.
import { useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, Plus, Trash2 } from 'lucide-react';
import { Menu, StatusPill, type MenuItem } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { OwnerCell } from '@/components/records/cells';
import { RegisterFrame } from '@/components/records/RegisterFrame';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { findingStatus, riskRating } from '@/lib/statuses/auditRegister';
import { can, type RegisterRights } from '@/lib/auditRegister/rights';
import {
  OWNER_SCHEMA, REGISTER_SCHEMA, dueOf, hasOwnerToMap, isOpen, ownerName, referenceOf, registerDef, reportLabel, sourceWord, type RegisterRow,
} from '@/lib/auditRegister/registerDef';
import { FindingDrawer, type DeleteTarget } from './FindingDrawer';

const MUTED = 'text-ds-fg-muted';
const DEF = registerDef();

function Flags({ row }: { row: RegisterRow }) {
  const flags = [row.awaiting_validation && isOpen(row) ? 'Awaiting validation' : null, row.extension_requested && isOpen(row) ? 'Extension asked' : null].filter(Boolean);
  return flags.length ? <span className={`block text-ds-label ${MUTED}`}>{flags.join(' · ')}</span> : null;
}

function RiskCell({ row }: { row: RegisterRow }) {
  return row.risk_rating ? <StatusPill size="sm" {...statusPill(riskRating, row.risk_rating)} /> : <span className={`text-ds-body ${MUTED}`}><span aria-hidden>—</span><span className="sr-only">No rating</span></span>;
}

function OwnerCol({ row, wide }: { row: RegisterRow; wide: boolean }) {
  if (!row.owner_id && hasOwnerToMap(row)) {
    return <span className="flex min-w-0 flex-col"><span className="truncate text-ds-body text-ds-fg-body" title={row.owner || ''}>{row.owner}</span><span className="text-ds-label text-ds-warning">Not matched to a person</span></span>;
  }
  return <OwnerCell name={ownerName(row)} wide={wide} />;
}

function DueCell({ row }: { row: RegisterRow }) {
  const due = dueOf(row);
  const late = isOpen(row) && row.days_past_due && row.days_past_due > 0 ? row.days_past_due : 0;
  return (
    <span className="flex flex-col">
      <span className={`whitespace-nowrap text-ds-body ${due ? 'text-ds-fg-body' : MUTED}`}>{formatDate(due, { calendar: true })}</span>
      {late > 0 && <span className="whitespace-nowrap text-ds-label font-[600] text-ds-danger">{formatCount(late)} {late === 1 ? 'day' : 'days'} past due</span>}
    </span>
  );
}

const metaOf = (r: RegisterRow): string => [referenceOf(r), sourceWord(r.source), reportLabel(r)].filter(Boolean).join(' · ');

export interface RegisterTabProps {
  rows: readonly RegisterRow[];
  serverTotal: number;
  loading: boolean;
  error: unknown;
  refreshError?: unknown;
  onRetry: () => void;
  rights: RegisterRights;
  /** a person who owns findings without being Audit Services: the register opens on "Mine" */
  ownerRole: boolean;
  /** what shows when the register has nothing in it (the page knows the actions the person has) */
  emptyFirst: ReactNode;
  onAddOnReport: (row: RegisterRow) => void;
  onDelete: (target: DeleteTarget) => void;
}

export function RegisterTab({ rows, serverTotal, loading, error, refreshError, onRetry, rights, ownerRole, emptyFirst, onAddOnReport, onDelete }: RegisterTabProps) {
  const router = useRouter();
  const search = useSearchParams();
  const stray = Number(search?.get('id')) || 0;       // an open finding the loaded list does not hold (deleted since, or beyond the server's cap): its drawer still opens
  const known = useMemo(() => new Set(rows.map((r) => r.issue_id)), [rows]);

  const columns: RecordColumn<RegisterRow>[] = [
    {
      key: 'finding', header: 'Finding', sortKey: 'ref',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]" title={row.record.title || ''}>{row.record.title || 'Untitled finding'}</span>
          <span className={`block truncate text-ds-label ${MUTED}`} title={metaOf(row.record)}>{metaOf(row.record)}</span>
        </div>
      ),
    },
    { key: 'risk', header: 'Risk', sortKey: 'risk', fit: { px: 112, dropRank: 2 }, cell: (row) => <RiskCell row={row.record} /> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 168 }, cell: (row) => <div className="flex flex-col items-start gap-[2px]"><StatusPill size="sm" {...statusPill(findingStatus, row.record.status)} /><Flags row={row.record} /></div> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: { px: 96, dropRank: 3, wide: { px: 176, titleMin: 420 } }, cell: (row, look) => <OwnerCol row={row.record} wide={look.wide} /> },
    { key: 'due', header: 'Target', sortKey: 'due', fit: { px: 136, dropRank: 1 }, cell: (row) => <DueCell row={row.record} /> },
  ];
  const card = (row: RecordRow<RegisterRow>) => (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{row.record.title || 'Untitled finding'}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><StatusPill size="sm" {...statusPill(findingStatus, row.record.status)} />{row.record.risk_rating && <RiskCell row={row.record} />}</span>
      <Flags row={row.record} />
      <span className={`truncate text-ds-label ${MUTED}`}>{metaOf(row.record)}</span>
      <span className={`text-ds-label ${MUTED}`}>{[ownerName(row.record) || 'Unassigned', dueOf(row.record) ? `target ${formatDate(dueOf(row.record), { calendar: true })}` : null].filter(Boolean).join(' · ')}</span>
    </div>
  );
  const boardCard = (r: RegisterRow) => (
    <>
      <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.title || 'Untitled finding'}</span>
      <span className="flex flex-wrap items-center gap-[8px]">{r.risk_rating && <RiskCell row={r} />}<Flags row={r} /></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{[referenceOf(r), ownerName(r) || 'Unassigned', dueOf(r) ? formatDate(dueOf(r), { calendar: true }) : null].filter(Boolean).join(' · ')}</span>
    </>
  );
  const rowMenu = (r: RegisterRow): MenuItem[] => [
    { key: 'issue', label: 'Open the full issue', icon: ArrowUpRight, onSelect: () => router.push(`/issues/${r.issue_id}`) },
    { key: 'add', label: 'Add a finding on this report', icon: Plus, hidden: !can(rights, 'addFinding'), onSelect: () => onAddOnReport(r) },
    { key: 'delete', label: 'Delete this finding', icon: Trash2, danger: true, hidden: !can(rights, 'deleteFinding'), onSelect: () => onDelete({ id: r.issue_id, label: [referenceOf(r), r.title].filter(Boolean).join(' · '), source: r.source, addedInPlatform: r.added_in_platform }) },
  ];

  return (
    <RegisterFrame<RegisterRow>
      def={DEF}
      schema={ownerRole ? OWNER_SCHEMA : REGISTER_SCHEMA}
      label="Findings"
      rows={rows}
      loading={loading}
      error={error}
      onRetry={onRetry}
      refreshError={refreshError}
      serverTotal={serverTotal}
      head={() => null}
      columns={columns}
      card={card}
      boardCard={boardCard}
      boardLabel={(r) => r.title || 'Untitled finding'}
      rowActions={(r) => <Menu iconOnly label={`Actions for ${truncate(r.title || 'this finding', 60).text}`} items={rowMenu(r)} />}
      rowLabel={(r) => `Select ${truncate(r.title || 'this finding', 60).text}`}
      searchLabel="Search findings by issue number, title, owner, report or line of business"
      noAccess={{ title: "You don't have access to the register", reason: errorMessage(error) }}
      emptyFirst={emptyFirst}
      detail={(open, nav) => {
        const id = open?.issue_id ?? (stray && !loading && !known.has(stray) ? stray : null);
        return (
          <FindingDrawer
            id={id}
            row={open}
            rights={rights}
            nav={open ? { onStep: nav.onStep, hasPrev: nav.hasPrev, hasNext: nav.hasNext } : undefined}
            onClose={nav.onClose}
            onAddOnReport={onAddOnReport}
            onDelete={onDelete}
          />
        );
      }}
    />
  );
}
