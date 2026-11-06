'use client';

// The register: rows of one kind of record, with sortable columns, a row that opens, and a state for every moment the list can be in.
// At 768px and wider it is the table (Table.tsx) with its less important columns dropped as the window narrows; below that the same rows
// are a list of cards. Both are drawn and CSS shows one (`hidden md:block` / `md:hidden`), so there is no flash of the wrong layout
// and the hidden one is not read out. Which also means a column's `cell` is rendered twice per row: no ids in it. A cell that must exist once (an
// input with an id, a control a label points at) gets a `cardCell`, the card's own version of it, or is left off the card (`card: 'hide'`). The
// card has a row-actions slot of its own (`cardActions`: a Menu at the top right), because the table's actions column is not on a card.
//
// It does not sort, filter or page. The page owns the order (`sort` + `onSortChange`, rows already in that order: tableModel.sortRows for a
// list held on the client), the filters and the pager (`footer`), and says what the list is (`empty`, `error`, `loading`).
//
// Two optional columns the page holds the state of (`chosen` / `open` ids, like `sort`): `selection` is a column of ticks with a header tick for the rows
// LISTED (none, some, all: the mixed state is drawn), the page's bulk bar says how many are chosen and offers "all N matching"; `expand` is a toggle that opens
// a panel under the row across every column, and inside the card on a phone. The tick and the toggle are controls of their own: pressing one is not pressing
// the row. Neither prop given, the register is exactly what it was. Rules: tableModel.ts (chosenState, toggleId, toggleAllListed).
//
// The columns lay themselves out (browser table layout, not fixed): a column's `width` is its preferred width and the columns without one
// share what is left, so hiding a column by priority needs no arithmetic. Long text in a cell wraps: give it `line-clamp-2` with the full
// text in `title`. A single line with "…" (`truncate`) only truncates where the cell has a cap, e.g. `block max-w-[320px] truncate`.
import { Fragment, useId, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { RowHeaderCell, Table, TableFrame, TBody, Td, Th, THead, Tr, rowHandlers, type CellAlign } from './Table';
import { chosenState, includesId, toggleAllListed, toggleId, type ColumnPriority, type RowId, type SortDir, type SortState } from './tableModel';

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
  /** what the card's line holds instead of `cell`, when the cell is an inline control (an input, a select) that must not be drawn twice: show its
   *  value, as words. Only for a column that is on the card (`card: 'meta'`); without it the card draws `cell`. */
  cardCell?: (row: T) => ReactNode;
}

export interface RegisterSelection<T> {
  /** the ids that are chosen: the page holds them (across pages: an id of another page stays when this page's tick is pressed) */
  chosen: ReadonlyArray<RowId>;
  /** the ids after a tick was pressed, a row's or the header's (every row LISTED: all of them when some or none were, none when all were) */
  onChange: (next: RowId[]) => void;
  /** names a row's tick for a screen reader: "Select Information security policy" */
  label: (row: T) => string;
  /** names the header's tick: "Select all documents on this page" (default "Select all rows on this page") */
  allLabel?: string;
}

export interface RegisterExpand<T> {
  /** the ids of the rows that are open: the page holds them */
  open: ReadonlyArray<RowId>;
  /** the ids after a toggle was pressed */
  onChange: (next: RowId[]) => void;
  /** what an open row shows: drawn under the row across every column, and inside the card on a phone (so it is drawn twice: give it no ids). A press inside it is not a press on the row. */
  render: (row: T) => ReactNode;
  /** names a row's toggle for a screen reader: "Details of Information security policy". It must contain the word "Details": the card's button says it. */
  label: (row: T) => string;
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
  /** a column of ticks (and a tick on each card); the header's tick is for the rows listed */
  selection?: RegisterSelection<T>;
  /** a toggle that opens a panel under the row (inside the card on a phone) */
  expand?: RegisterExpand<T>;
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
  /** the row's actions on a card, at the top right beside the title: a Menu ("⋯"). A press anywhere in it is not a press on the card, and its 44px
   *  touch target bleeds into the card's padding so the card does not grow. The table has no such slot: its actions are a column. Left out, the
   *  card is as it always was. */
  cardActions?: (row: T) => ReactNode;
  /** the header stays in view while the rows scroll in the frame */
  stickyHead?: boolean;
  /** the header row is not drawn but is still read out (`sr-only` on the <thead>, never display:none): for a table whose columns the caption and the
   *  cells already make plain. A column's `width` still applies (it moves to the cells). The cards are unaffected: they have no header row. */
  hideHeader?: boolean;
  /** a Tailwind max-height class with an arbitrary value, written out in full: 'max-h-[70vh]'. With `stickyHead` and none given the frame is
   *  as tall as the window leaves under the page's own header and cards (the library's measure). */
  maxHeight?: string;
}

const STICKY_FRAME = 'max-h-[calc(100vh-14rem)]';
const CARD = 'rounded-ds-card border p-3';
const CARD_PLAIN = 'border-ds-border bg-ds-surface';
const CARD_SELECTED = 'border-ds-primary bg-ds-primary-soft';
const CARD_PRESSABLE = 'cursor-pointer focus-visible:outline-none focus-visible:shadow-ds-ring';
// the tick and the toggle cells are as wide as a control and have no padding of their own: the control fills the cell (32px, 44px on touch)
const EXTRA_CELL = 'w-[44px] !px-0 [&&]:!py-0';
const TICK = 'inline-grid h-ds-control w-[var(--ds-control-h)] shrink-0 cursor-pointer place-items-center';
const TOGGLE = 'grid h-ds-control w-[var(--ds-control-h)] place-items-center rounded-ds-control text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

/** A placeholder line for a cell that has not arrived. */
function Bar({ width }: { width: string }) {
  return <span className="block h-[12px] animate-pulse rounded-ds-control bg-ds-border motion-reduce:animate-none" style={{ width }} />;
}

function Failure({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <span className="min-w-0 text-ds-body text-ds-danger [overflow-wrap:anywhere]">{message}</span>
      {onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function RegisterTable<T>({
  caption, columns, rows, getRowId, sort = null, onSortChange, onRowActivate, selectedId = null, selection, expand, loading = false, loadingRows = 6,
  error = null, empty, footer, cardTitle, cardActions, stickyHead = false, hideHeader = false, maxHeight,
}: RegisterTableProps<T>) {
  const failed = !loading && error != null;
  const isEmpty = !loading && !failed && rows.length === 0;
  const meta = columns.filter((c) => c.card === 'meta');
  const placeholders = Array.from({ length: Math.max(1, loadingRows) }, (_, i) => i);
  const isSelected = (id: string | number) => selectedId != null && String(id) === String(selectedId);
  // with the header out of the layout (an absolutely positioned <thead> takes no part in column sizing) the columns are sized by their cells
  const cellWidth = (c: RegisterColumn<T>) => (hideHeader ? c.width : undefined);
  const span = columns.length + (selection ? 1 : 0) + (expand ? 1 : 0);
  const listed = rows.map(getRowId);
  const all = selection ? chosenState(listed, selection.chosen) : 'none';
  const uid = useId();
  // the table and the cards are both in the page (CSS shows one), so each has its own id for a row's panel; no spaces: aria-controls is a list of ids
  const panelId = (id: RowId, where: 'table' | 'card') => `${uid}-${where}-details-${encodeURIComponent(String(id))}`;

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
                <THead className={hideHeader ? 'sr-only' : undefined}>
                  <Tr>
                    {selection && (
                      <Th sticky={stickyHead} className={EXTRA_CELL}>
                        <label className={TICK}>
                          <Checkbox
                            aria-label={selection.allLabel ?? 'Select all rows on this page'}
                            checked={all === 'all'}
                            indeterminate={all === 'some'}
                            disabled={loading || failed || rows.length === 0}
                            onChange={() => selection.onChange(toggleAllListed(listed, selection.chosen))}
                          />
                        </label>
                      </Th>
                    )}
                    {expand && <Th sticky={stickyHead} className={EXTRA_CELL}><span className="sr-only">Details</span></Th>}
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
                        {selection && <Td className={EXTRA_CELL} />}
                        {expand && <Td className={EXTRA_CELL} />}
                        {columns.map((c) => <Td key={c.key} priority={c.priority} className={cellWidth(c)}><Bar width={c.isRowHeader ? '65%' : '70%'} /></Td>)}
                      </Tr>
                    ))
                  ) : failed ? (
                    <Tr><Td colSpan={span}><Failure message={error.message} onRetry={error.onRetry} /></Td></Tr>
                  ) : (
                    rows.map((row) => {
                      const id = getRowId(row);
                      const chosen = selection ? includesId(selection.chosen, id) : false;
                      const open = expand ? includesId(expand.open, id) : false;
                      return (
                        <Fragment key={id}>
                          <Tr selected={isSelected(id)} chosen={chosen} onActivate={onRowActivate && (() => onRowActivate(row))}>
                            {selection && (
                              <Td className={EXTRA_CELL}>
                                <label className={TICK}>
                                  <Checkbox aria-label={selection.label(row)} checked={chosen} onChange={() => selection.onChange(toggleId(selection.chosen, id))} />
                                </label>
                              </Td>
                            )}
                            {expand && (
                              <Td className={EXTRA_CELL}>
                                <button
                                  type="button"
                                  aria-expanded={open}
                                  aria-controls={open ? panelId(id, 'table') : undefined}
                                  aria-label={expand.label(row)}
                                  title={expand.label(row)}
                                  onClick={() => expand.onChange(toggleId(expand.open, id))}
                                  className={TOGGLE}
                                >
                                  <ChevronRight aria-hidden strokeWidth={1.75} className={clsx('h-[16px] w-[16px] transition-transform', open && 'rotate-90')} />
                                </button>
                              </Td>
                            )}
                            {columns.map((c) => {
                              const Cell = c.isRowHeader ? RowHeaderCell : Td;
                              return <Cell key={c.key} align={c.align} priority={c.priority} className={cellWidth(c)}>{c.cell(row)}</Cell>;
                            })}
                          </Tr>
                          {expand && open && (
                            <Tr id={panelId(id, 'table')}>
                              <Td colSpan={span} className="bg-ds-surface-subtle">{expand.render(row)}</Td>
                            </Tr>
                          )}
                        </Fragment>
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
                const chosen = selection ? includesId(selection.chosen, id) : false;
                const isOpen = expand ? includesId(expand.open, id) : false;
                const open = onRowActivate && (() => onRowActivate(row));
                const title = <div className="min-w-0 text-ds-body font-medium text-ds-fg [overflow-wrap:anywhere]">{cardTitle(row)}</div>;
                return (
                  <li
                    key={id}
                    tabIndex={open ? 0 : undefined}
                    aria-current={selected || undefined}
                    {...rowHandlers<HTMLLIElement>(open)}
                    className={clsx(CARD, selected || chosen ? CARD_SELECTED : CARD_PLAIN, open && CARD_PRESSABLE, selection && 'relative pl-[44px]')}
                  >
                    {/* a tick at the card's top left, over the room its left padding leaves: the title below is drawn exactly as it is without a selection */}
                    {selection && (
                      <label className={clsx(TICK, 'absolute left-0 top-0')}>
                        <Checkbox aria-label={selection.label(row)} checked={chosen} onChange={() => selection.onChange(toggleId(selection.chosen, id))} />
                      </label>
                    )}
                    {cardActions ? (
                      <div className="flex items-start justify-between gap-2">
                        {title}
                        <div data-row-ignore className="-my-[12px] shrink-0">{cardActions(row)}</div>
                      </div>
                    ) : title}
                    {meta.length > 0 && (
                      <dl className="mt-2 flex flex-col gap-1">
                        {meta.map((c) => (
                          <div key={c.key} className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-2">
                            <dt className="text-ds-label text-ds-fg-muted">{c.cardLabel ?? c.header}</dt>
                            <dd className="min-w-0 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{(c.cardCell ?? c.cell)(row)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {expand && (
                      <div className="mt-2">
                        <Button
                          variant="link"
                          size="sm"
                          className="-ml-[8px]"
                          aria-expanded={isOpen}
                          aria-controls={isOpen ? panelId(id, 'card') : undefined}
                          aria-label={expand.label(row)}
                          rightIcon={<ChevronDown aria-hidden className={clsx('transition-transform', isOpen && 'rotate-180')} />}
                          onClick={() => expand.onChange(toggleId(expand.open, id))}
                        >
                          Details
                        </Button>
                        {isOpen && <div id={panelId(id, 'card')} data-row-ignore className="mt-2 border-t border-ds-border pt-2">{expand.render(row)}</div>}
                      </div>
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
