'use client';

// The register of Catalog controls every view uses (a domain's group, a framework, All controls, My work, the internal controls): one row per control with its name, where it comes from, how far it
// has got, whether its design and its operation are effective, and who works on it. It is the kit's RegisterTable, so below 768px each control is a card. A row opens the control's drawer (click,
// Enter or Space); nothing appears only on hover. Every state of the list is the page's to say (loading, error with Retry, empty); this draws the rows.
import type { ReactNode } from 'react';
import { Star } from 'lucide-react';
import { PersonStack, RegisterTable, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { controlSource } from '@/lib/statuses/catalog';
import { testResult, workProgress } from '@/lib/statuses/controls';
import { formatCount } from '@/lib/format';
import { subtitleOf, type CatalogRow } from './catalogModel';

export const rowKey = (r: CatalogRow): string => `${r.source_type}-${r.source_id}`;

function Title({ row }: { row: CatalogRow }) {
  const sub = subtitleOf(row);
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-[6px]">
        {row.is_key_control && (
          <>
            <Star aria-hidden className="mt-[3px] h-[14px] w-[14px] shrink-0 fill-current text-ds-warning" strokeWidth={1.75} />
            <span className="sr-only">Key control.</span>
          </>
        )}
        <span dir="auto" title={row.name || undefined} className="line-clamp-2 min-w-0 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{row.name || '—'}</span>
        {row.overdue && <StatusPill tone="danger" label="Test overdue" size="sm" className="shrink-0" />}
      </div>
      {sub && <p className="m-0 truncate text-ds-label text-ds-fg-muted" title={sub}>{sub}</p>}
    </div>
  );
}

function Source({ row }: { row: CatalogRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-[6px] gap-y-[2px]">
      <StatusPill size="sm" {...statusPill(controlSource, row.source_type)} />
      {row.source_type === 'normalized' && (row.member_count ?? 0) > 0 && <span className="text-ds-label text-ds-fg-muted">{`${formatCount(row.member_count)} frameworks`}</span>}
    </span>
  );
}

const Progress = ({ row }: { row: CatalogRow }) => <StatusPill size="sm" {...statusPill(workProgress, row.implementation_status || 'not_started')} />;
const Effect = ({ word }: { word?: string | null }) => <StatusPill size="sm" {...statusPill(testResult, word || 'not_tested')} />;

function Assigned({ row }: { row: CatalogRow }) {
  const names = (row.assignees ?? []).map((a) => a.display_name);
  return <PersonStack people={names} max={3} label="Assigned to" emptyLabel="Unassigned" />;
}

export function controlColumns(showDomain: boolean): RegisterColumn<CatalogRow>[] {
  return [
    { key: 'name', header: 'Control', isRowHeader: true, cell: (r) => <Title row={r} /> },
    ...(showDomain ? [{ key: 'domain', header: 'Domain', priority: 3 as const, card: 'meta' as const, cell: (r: CatalogRow) => <span className="text-ds-label text-ds-fg-body">{r.canonical_domain || r.domain || '—'}</span> }] : []),
    { key: 'source', header: 'Source', priority: 3, card: 'meta', cell: (r) => <Source row={r} /> },
    { key: 'progress', header: 'Progress', priority: 2, card: 'meta', cell: (r) => <Progress row={r} /> },
    { key: 'design', header: 'Design', priority: 2, card: 'meta', cell: (r) => <Effect word={r.design_effectiveness} /> },
    { key: 'operating', header: 'Operating', priority: 2, card: 'meta', cell: (r) => <Effect word={r.operating_effectiveness} /> },
    { key: 'assigned', header: 'Assigned to', card: 'meta', cell: (r) => <Assigned row={r} /> },
  ];
}

export interface ControlRegisterProps {
  caption: string;
  rows: CatalogRow[];
  showDomain?: boolean;
  loading?: boolean;
  error?: { message: string; onRetry?: () => void } | null;
  empty?: ReactNode;
  footer?: ReactNode;
  onOpen: (row: CatalogRow) => void;
}

export function ControlRegister({ caption, rows, showDomain = false, loading, error, empty, footer, onOpen }: ControlRegisterProps) {
  return (
    <RegisterTable
      caption={caption}
      columns={controlColumns(showDomain)}
      rows={rows}
      getRowId={rowKey}
      onRowActivate={onOpen}
      loading={loading}
      error={error}
      empty={empty}
      footer={footer}
      cardTitle={(r) => <Title row={r} />}
    />
  );
}
