'use client';

/**
 * RegisterView: every evidence item as a sortable, exportable register (a table from 768px, cards below), a page at a time with the true count. A row opens the
 * file's preview (the same panel the Workbench shows) instead of expanding a second, different copy of it in the page. It is built, and open from the address
 * (?view=register); the switcher does not offer it. Export writes what the person sees: the filtered, sorted set, not only the page.
 */
import { Download } from 'lucide-react';
import { Button, Pager, PersonChip, RegisterTable, sortRows, type RegisterColumn, type SortState } from '@/components/ui/ds';
import { EMPTY, formatCount } from '@/lib/format';
import { evidenceStatus } from '@/lib/statuses/evidence';
import { type EvidenceItem, normPct, ownerOf, pageOfRows, registerCsv, typeLabel } from './evidenceModel';
import { ExpiryText, LetterTile, MaturityMeter, StatusBadges } from './lib';
import type { ReactNode } from 'react';

const PAGE_SIZES = [25, 50, 100] as const;
const MUTED = 'text-ds-fg-muted';

const sortValue = (e: EvidenceItem, key: string): string | number | null => {
  switch (key) {
    case 'name': return e.name;
    case 'status': return evidenceStatus.label(e.status);
    case 'owner': return ownerOf(e) ?? null;
    case 'controls': return e.control_mappings_count ?? 0;
    case 'maturity': return normPct(e.quality_score);
    case 'expiry': return e.expiry_date ? Date.parse(e.expiry_date) : null;
    default: return null;
  }
};

/** Writes the register's CSV and hands it to the browser as a file. */
function download(items: EvidenceItem[]) {
  const blob = new Blob([registerCsv(items)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'evidence-register.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function RegisterView({ items, sort, onSort, page, pageSize, onPage, onPageSize, selectedId, onOpen, loading, error, empty }: {
  items: EvidenceItem[];
  sort: SortState;
  onSort: (next: SortState) => void;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  selectedId: number | null;
  onOpen: (id: number) => void;
  loading: boolean;
  error: { message: string; onRetry?: () => void } | null;
  empty: ReactNode;
}) {
  const sorted = sortRows(items, sort, sortValue);
  const { range, rows } = pageOfRows(sorted, page, pageSize);

  const columns: RegisterColumn<EvidenceItem>[] = [
    {
      key: 'name', header: 'Evidence', isRowHeader: true, sortable: true,
      cell: (e) => (
        <span className="flex min-w-0 items-center gap-[12px]">
          <LetterTile name={e.name} size={24} />
          <span className="min-w-0">
            <span className="line-clamp-2 break-words font-[500] text-ds-fg" title={e.name} dir="auto">{e.name}</span>
            <span className={`block text-ds-label ${MUTED}`}>{typeLabel(e.evidence_type)}</span>
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', width: 'w-[160px]', sortable: true, card: 'meta', cell: (e) => <StatusBadges item={e} /> },
    { key: 'owner', header: 'Owner', width: 'w-[180px]', priority: 2, sortable: true, card: 'meta', cell: (e) => <PersonChip name={ownerOf(e)} /> },
    {
      key: 'controls', header: 'Controls', width: 'w-[112px]', priority: 3, sortable: true, firstDir: 'desc', align: 'right', card: 'meta', cardLabel: 'Controls linked',
      cell: (e) => ((e.control_mappings_count ?? 0) > 0 ? <span className="tabular-nums">{formatCount(e.control_mappings_count)}</span> : <span className={MUTED}>{EMPTY}</span>),
    },
    { key: 'maturity', header: 'Maturity', width: 'w-[136px]', priority: 2, sortable: true, firstDir: 'desc', card: 'meta', cell: (e) => <MaturityMeter score={normPct(e.quality_score)} review={e.ai_review} /> },
    { key: 'expiry', header: 'Expiry', width: 'w-[140px]', priority: 3, sortable: true, card: 'meta', cell: (e) => <ExpiryText expiry={e.expiry_date} /> },
  ];

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className={`text-ds-body ${MUTED}`}>{formatCount(items.length)} {items.length === 1 ? 'item' : 'items'}</p>
        <Button leftIcon={<Download aria-hidden />} disabled={items.length === 0} onClick={() => download(sorted)}>Export CSV</Button>
      </div>
      <RegisterTable
        caption="Evidence register"
        columns={columns}
        rows={rows}
        getRowId={(e) => e.id}
        sort={sort}
        onSortChange={onSort}
        selectedId={selectedId}
        onRowActivate={(e) => onOpen(e.id)}
        loading={loading}
        error={error}
        empty={empty}
        stickyHead
        cardTitle={(e) => <span className="line-clamp-3 break-words" title={e.name} dir="auto">{e.name}</span>}
        footer={items.length > 0 ? (
          <Pager page={range.page} pageSize={pageSize} total={items.length} noun={{ one: 'evidence item', other: 'evidence items' }} pageSizes={PAGE_SIZES} onPage={onPage} onPageSize={onPageSize} />
        ) : undefined}
      />
    </div>
  );
}
