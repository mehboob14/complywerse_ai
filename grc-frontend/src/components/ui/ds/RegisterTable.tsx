'use client';

// The register: rows of one kind of record, with sortable columns, a row that opens, and a state for every moment the list can be in.
// At 768px and wider it is the table (Table.tsx) with its less important columns dropped as the window narrows; below that the same rows
// are a list of cards. Both are drawn and CSS shows one (`hidden md:block` / `md:hidden`), so there is no flash of the wrong layout
// and the hidden one is not read out. Which also means a column's `cell` is rendered twice per row: no ids in it.
//
// It does not sort, filter or page. The page owns the order (`sort` + `onSortChange`, rows already in that order: tableModel.sortRows for a
// list held on the client), the filters and the pager (`footer`), and says what the list is (`empty`, `error`, `loading`).
//
// The columns lay themselves out (browser table layout, not fixed): a column's `width` is its preferred width and the columns without one
// share what is left, so hiding a column by priority needs no arithmetic. Long text in a cell wraps: give it `line-clamp-2` with the full
// text in `title`. A single line with "…" (`truncate`) only truncates where the cell has a cap, e.g. `block max-w-[320px] truncate`.
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { RowHeaderCell, Table, TableFrame, TBody, Td, Th, THead, Tr, rowHandlers, type CellAlign } from './Table';
import type { ColumnPriority, SortDir, SortState } from './tableModel';

export interface RegisterColumn<T> {
  key: string;
  /** the column's name: the header text, and the label of its line on a card (unless `cardLabel`) */
  header: string;
  /** the cell; it is drawn in the table and on the card, so give it no ids */
  cell: (row: T) => ReactNode;
  /** 1 (default) is always shown; 2 from 768px; 3 from 1024px. Cards ignore it (see `card`). */
  priority?: ColumnPriority;
  align?: CellAlign;
  /** a click on the header sorts by this column (needs the register's `onSortChange`); `key` is what `sort` holds */
  sortable?: boolean;
  /** the direction a first click on this column sorts in (default ascending) */
  firstDir?: SortDir;
  /** a Tailwind width class with an arbitrary value, written out in full: 'w-[160px]' */
  width?: string;
  /** the cell names its row (its <th scope="row">): the document, the exception */
  isRowHeader?: boolean;
  /** On a card: 'meta' makes the column a line "label: value" under the title (`cardTitle`). Any other column ('hide', or none given) is
   *  not on the card. */
  card?: 'meta' | 'hide';
  /** the label of the card line, when the header is not the right word there */
  cardLabel?: string;
}

export interface RegisterTableProps<T> {
  /** names the table (and its scrolling region and the card list): read out, not drawn */
  caption: string;
  columns: RegisterColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string | number;
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
  /** a row (or card) opens: it becomes a tab stop; click, Enter and Space call this (tableModel.shouldActivateRow / isInteractiveTarget) */
  onRowActivate?: (row: T) => void;
  /** the row that is open or chosen */
  selectedId?: string | number | null;
  /** the list has not answered yet: the header and skeleton rows, no count, no footer */
  loading?: boolean;
  /** how many skeleton rows (default 6) */
  loadingRows?: number;
  /** the request failed: a message (and Retry) in place of rows. Never an empty table. */
  error?: { message: string; onRetry?: () => void } | null;
  /** what to show when the list answered and is empty: the page's own empty state, drawn in place of the table */
  empty?: ReactNode;
  /** under the frame, in every state but loading: the page's pager and count (tableModel.rowCountText) */
  footer?: ReactNode;
  /** the first thing on a card */
  cardTitle: (row: T) => ReactNode;
  /** the header stays in view while the rows scroll in the frame */
  stickyHead?: boolean;
  /** a Tailwind max-height class with an arbitrary value, written out in full: 'max-h-[70vh]'. With `stickyHead` and none given the frame is
   *  as tall as the window leaves under the page's own header and cards (the library's measure). */
  maxHeight?: string;
}

const STICKY_FRAME = 'max-h-[calc(100vh-14rem)]';
const CARD = 'rounded-ds-card border p-3';
const CARD_PLAIN = 'border-ds-border bg-ds-surface';
const CARD_SELECTED = 'border-ds-primary bg-ds-primary-soft';
const CARD_PRESSABLE = 'cursor-pointer focus-visible:outline-none focus-visible:shadow-ds-ring';

/** A placeholder line for a cell that has not arrived. */
function Bar({ width }: { width: string }) {
  return <span className="block h-[12px] animate-pulse rounded-ds-control bg-ds-border motion-reduce:animate-none" style={{ width }} />;
}

// The Retry button is plain until the kit has its Button; `!text-[13px]` because the governance pages' CSS sets 12px on every button.
const RETRY = 'inline-flex h-ds-control shrink-0 items-center justify-center rounded-ds-control border border-ds-border-strong bg-ds-surface px-[12px] !text-[13px] font-medium text-ds-fg-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring';

function Failure({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <span className="min-w-0 text-ds-body text-ds-danger [overflow-wrap:anywhere]">{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className={RETRY}>Retry</button>}
    </div>
  );
}

export function RegisterTable<T>({
  caption, columns, rows, getRowId, sort = null, onSortChange, onRowActivate, selectedId = null, loading = false, loadingRows = 6,
  error = null, empty, footer, cardTitle, stickyHead = false, maxHeight,
}: RegisterTableProps<T>) {
  const failed = !loading && error != null;
  const isEmpty = !loading && !failed && rows.length === 0;
  const meta = columns.filter((c) => c.card === 'meta');
  const placeholders = Array.from({ length: Math.max(1, loadingRows) }, (_, i) => i);
  const isSelected = (id: string | number) => selectedId != null && String(id) === String(selectedId);

  return (
    <div className="min-w-0 max-w-full">
      {isEmpty ? (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          {empty ?? <div className="px-[16px] py-[32px] text-center text-ds-body text-ds-fg-muted">Nothing to show</div>}
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <TableFrame aria-label={caption} maxHeight={maxHeight ?? (stickyHead ? STICKY_FRAME : undefined)}>
              <Table caption={caption} aria-busy={loading || undefined}>
                <THead>
                  <Tr>
                    {columns.map((c) => (
                      <Th
                        key={c.key}
                        align={c.align}
                        priority={c.priority}
                        sticky={stickyHead}
                        className={c.width}
                        sortKey={c.sortable && onSortChange ? c.key : undefined}
                        sort={sort}
                        onSortChange={onSortChange}
                        firstDir={c.firstDir}
                      >
                        {c.header}
                      </Th>
                    ))}
                  </Tr>
                </THead>
                <TBody>
                  {loading ? (
                    placeholders.map((i) => (
                      <Tr key={i} aria-hidden>
                        {columns.map((c) => <Td key={c.key} priority={c.priority}><Bar width={c.isRowHeader ? '65%' : '70%'} /></Td>)}
                      </Tr>
                    ))
                  ) : failed ? (
                    <Tr><Td colSpan={columns.length}><Failure message={error.message} onRetry={error.onRetry} /></Td></Tr>
                  ) : (
                    rows.map((row) => {
                      const id = getRowId(row);
                      return (
                        <Tr key={id} selected={isSelected(id)} onActivate={onRowActivate && (() => onRowActivate(row))}>
                          {columns.map((c) => {
                            const Cell = c.isRowHeader ? RowHeaderCell : Td;
                            return <Cell key={c.key} align={c.align} priority={c.priority}>{c.cell(row)}</Cell>;
                          })}
                        </Tr>
                      );
                    })
                  )}
                </TBody>
              </Table>
            </TableFrame>
          </div>

          <ul role="list" aria-label={caption} aria-busy={loading || undefined} className="flex flex-col gap-2 md:hidden">
            {loading ? (
              placeholders.map((i) => (
                <li key={i} aria-hidden className={clsx(CARD, CARD_PLAIN)}>
                  <Bar width="60%" />
                  <div className="mt-2"><Bar width="85%" /></div>
                </li>
              ))
            ) : failed ? (
              <li className={clsx(CARD, CARD_PLAIN)}><Failure message={error.message} onRetry={error.onRetry} /></li>
            ) : (
              rows.map((row) => {
                const id = getRowId(row);
                const selected = isSelected(id);
                const open = onRowActivate && (() => onRowActivate(row));
                return (
                  <li
                    key={id}
                    tabIndex={open ? 0 : undefined}
                    aria-current={selected || undefined}
                    {...rowHandlers<HTMLLIElement>(open)}
                    className={clsx(CARD, selected ? CARD_SELECTED : CARD_PLAIN, open && CARD_PRESSABLE)}
                  >
                    <div className="min-w-0 text-ds-body font-medium text-ds-fg [overflow-wrap:anywhere]">{cardTitle(row)}</div>
                    {meta.length > 0 && (
                      <dl className="mt-2 flex flex-col gap-1">
                        {meta.map((c) => (
                          <div key={c.key} className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-2">
                            <dt className="text-ds-label text-ds-fg-muted">{c.cardLabel ?? c.header}</dt>
                            <dd className="min-w-0 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{c.cell(row)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </>
      )}
      {!loading && Boolean(footer) && <div className="mt-3">{footer}</div>}
    </div>
  );
}
