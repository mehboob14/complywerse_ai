'use client';

// The rows of the Findings register, as configuration for records/RecordTable: the columns (Finding, Severity, Vendor, Status, Fix due, Owner), the card a phone gets and the row's menu. The
// finding is shown in full (two lines, clamped; the whole text is the link's title and the drawer), its badges say what holds it up (Blocking, a failed critical control), the owner is a person or
// "Unassigned", the fix date is a countdown that is red only while the finding is open and late, and nothing appears only on hover. What a cell says is decided in findingsModel.ts.
import Link from 'next/link';
import { ArrowUpRight, Building2, Eye } from 'lucide-react';
import { Menu, PersonChip, StatusPill, linkClasses, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { EMPTY, truncate } from '@/lib/format';
import { sourceLabel } from '../../_lib/findingCardModel';
import { acceptedLine, dueView, recordHref, vendorHref, type RegisterFinding } from '../../_lib/findingsModel';
import { DOMAIN_LABELS } from '../../_lib/tprmShared';
import { FindingStatus, SeverityPill } from '../../vendors/[id]/_tpra/FindingCard';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const FINDING_FIT: Record<'severity' | 'vendor' | 'status' | 'due' | 'owner', Omit<FitColumn, 'key'>> = {
  severity: { px: 96 },
  status: { px: 152 },
  due: { px: 116, dropRank: 1 },
  vendor: { px: 168, dropRank: 2 },
  owner: { px: 68, dropRank: 3, wide: { px: 176, titleMin: 420 } },
};

export interface RowEnv {
  now: Date;
  /** the title was pressed: the finding opens over the list */
  onPeek: (id: number) => void;
  /** go to a page (the vendor, the finding on its vendor's page) */
  go: (href: string) => void;
}

/** "Cybersecurity · Assessment": what a finding is about and where it came from, in one line under its title. */
export const subline = (r: RegisterFinding): string => [DOMAIN_LABELS[r.domain] || r.domain, sourceLabel(r.source), r.engagement?.name].filter(Boolean).join(' · ');

function FindingTitle({ row, env }: { row: RecordRow<RegisterFinding>; env: RowEnv }) {
  const r = row.record;
  return (
    <div className="min-w-0">
      <div dir="auto" className="line-clamp-2 min-w-0 text-ds-body [overflow-wrap:anywhere]">
        <Link
          href={recordHref(r)}
          prefetch={false}
          title={r.title || undefined}
          onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onPeek(r.id); } }}
          className="scroll-mt-[44px] rounded-ds-control py-[1px] font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none"
        >
          {r.title || 'Untitled finding'}
        </Link>
      </div>
      <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-[6px] gap-y-[2px] text-ds-label text-ds-fg-muted">
        {r.is_blocking && <StatusPill size="sm" tone="danger" label="Blocking" />}
        {r.is_critical_control_fail && <StatusPill size="sm" tone="danger" label="Critical control" />}
        <span className="min-w-0 truncate" title={subline(r)}>{subline(r)}</span>
      </p>
    </div>
  );
}

export function OwnerCell({ row, withName = false }: { row: RegisterFinding; withName?: boolean }) {
  const name = row.owner?.name?.trim() || (row.owner ? 'A former colleague' : null);
  if (!name) return <span className="text-ds-body text-ds-fg-muted" title="Nobody owns this finding"><span aria-hidden>{EMPTY}</span><span className="sr-only">Unassigned</span></span>;
  return withName ? <PersonChip name={name} /> : <span className="inline-flex" title={`Owner: ${name}`}><PersonChip name={name} className="[&>span:last-child]:sr-only" /></span>;
}

export function DueCell({ row, now }: { row: RegisterFinding; now: Date }) {
  const due = dueView(row, now);
  if (due.text === EMPTY) return <span className="text-ds-body text-ds-fg-muted">{EMPTY}<span className="sr-only">No fix date</span></span>;
  return (
    <span title={due.title} className={`whitespace-nowrap text-ds-body ${due.late ? 'font-[600] text-ds-danger' : 'text-ds-fg-body'}`}>
      {due.text}{due.late && <span className="sr-only"> (late)</span>}
    </span>
  );
}

export function findingColumns(env: RowEnv): RecordColumn<RegisterFinding>[] {
  return [
    { key: 'title', header: 'Finding', sortKey: 'finding', cell: (row) => <RowLead row={row}><FindingTitle row={row} env={env} /></RowLead> },
    { key: 'severity', header: 'Severity', sortKey: 'severity', firstDir: 'desc', fit: FINDING_FIT.severity, cell: (row) => <SeverityPill severity={row.record.severity} /> },
    {
      key: 'vendor', header: 'Vendor', sortKey: 'vendor', fit: FINDING_FIT.vendor,
      cell: (row) => (row.record.vendor_name
        ? <Link href={vendorHref(row.record)} prefetch={false} onClick={(e) => e.stopPropagation()} className={`block min-w-0 truncate ${linkClasses({ tone: 'text' })}`} title={row.record.vendor_name}>{row.record.vendor_name}</Link>
        : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>),
    },
    {
      key: 'status', header: 'Status', sortKey: 'status', fit: FINDING_FIT.status,
      cell: (row) => {
        const until = acceptedLine(row.record);
        return (
          <span className="flex min-w-0 flex-col items-start gap-[2px]">
            <FindingStatus status={row.record.status} />
            {until && <span className="text-ds-label text-ds-fg-muted">{until}</span>}
          </span>
        );
      },
    },
    { key: 'due', header: 'Fix due', sortKey: 'due', fit: FINDING_FIT.due, cell: (row) => <DueCell row={row.record} now={env.now} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: FINDING_FIT.owner, cell: (row, look) => <OwnerCell row={row.record} withName={look.wide} /> },
  ];
}

/** The card a row is where the list has no room for a table: the title (two lines), then the severity, the status, the fix date and the owner. */
export function FindingCard({ row, env }: { row: RecordRow<RegisterFinding>; env: RowEnv }) {
  const r = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={r.title || undefined} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.title || 'Untitled finding'}</span>
      <span className="truncate text-ds-label text-ds-fg-muted" title={r.vendor_name || undefined}>{r.vendor_name || EMPTY}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px]">
        <SeverityPill severity={r.severity} />
        <FindingStatus status={r.status} />
        {r.is_blocking && <StatusPill size="sm" tone="danger" label="Blocking" />}
        <DueCell row={r} now={env.now} />
        <span className="ml-auto"><OwnerCell row={r} /></span>
      </span>
    </div>
  );
}

/** The row's menu: Open, the vendor, the finding on its vendor's page. Always drawn; reachable by Tab, Enter and the arrow keys. */
export function RowMenu({ row, env }: { row: RegisterFinding; env: RowEnv }) {
  const items: MenuItem[] = [
    { key: 'open', label: 'Open', icon: Eye, onSelect: () => env.onPeek(row.id) },
    { key: 'vendor', label: 'Open the vendor', icon: Building2, onSelect: () => env.go(vendorHref(row)) },
    { key: 'record', label: 'Open on the vendor’s page', icon: ArrowUpRight, onSelect: () => env.go(recordHref(row)) },
  ];
  return <Menu label={`Actions for ${truncate(row.title || 'this finding', 60).text}`} iconOnly items={items} />;
}
