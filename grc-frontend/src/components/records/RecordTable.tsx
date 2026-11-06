'use client';

// The list of a record explorer, on the kit's table primitives: a table (sortable headers with aria-sort, a tick column, a row that opens from the keyboard) or the same rows as cards.
// Which one, and which columns of the table, is decided by the room the list has (the width of its own box, explorerFit.fitColumns), never by the window's width: under the shell the
// window says 1440 and the list has 746px. The first column (the title) keeps at least TITLE_MIN of it; the columns that matter least give way in the order they ask for; when even
// the ones that always stay leave the title less than that, the list is cards. Only the one that is drawn is in the page (a library of thousands of rows is not two lists of work), and
// the width is measured before anything is painted.
// The page hands it ITEMS: records (with a depth for a tree, a "context" flag for a row shown only because something under it matches, and the caret that opens what is under it),
// a group header (a folder) and a "Show more" line. It does not sort, filter or page: the order is the page's and so is the pager under it. It does not scroll inside a box either:
// the page scrolls and the header stays at the top of it (`maxHeight`, a class written out in full, is for a configuration that wants a table of its own that scrolls).
import { Fragment, useRef, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Checkbox, Table, TableFrame, TBody, Td, Th, THead, Tr, type SortState } from '@/components/ui/ds';
import { allColumns, fitColumns, type FitColumn } from './explorerFit';
import type { TickState } from './explorerModel';
import { useContainerWidth } from './useContainerWidth';

export interface RecordRow<R> {
  kind: 'row';
  id: number;
  record: R;
  /** levels under a parent (0: a top row) */
  depth: number;
  /** shown only because a record under it matches: greyed, never ticked */
  context?: boolean;
  /** what the caret opens: the records under this one */
  nested?: { count: number; open: boolean; label: string; onToggle: () => void };
}
/** A line that is not a record: a group header (a folder) or a "Show more". It is a whole table row (`table` gets the number of columns to span) and a whole card (an `<li>`). */
export interface RecordLine { kind: 'group' | 'more'; id: string; table: (columns: number) => ReactNode; card: ReactNode }
export type RecordItem<R> = RecordRow<R> | RecordLine;

export interface RecordColumn<R> {
  key: string;
  header: string;
  /** How wide the column is and how it gives way (explorerFit.FitColumn without its key). The FIRST column has none: it takes what the others leave. */
  fit?: Omit<FitColumn, 'key'>;
  /** the header sorts by this key */
  sortKey?: string;
  firstDir?: 'asc' | 'desc';
  /** `look.wide`: the column took its wider look (the owner's name beside the avatar) */
  cell: (row: RecordRow<R>, look: { wide: boolean }) => ReactNode;
}

export interface RecordSelection<R> {
  ticked: ReadonlySet<number>;
  onToggle: (id: number) => void;
  /** the header's tick box: the rows on the page */
  state: TickState;
  onToggleAll: () => void;
  headLabel: string;
  rowLabel: (record: R) => string;
}

export interface RecordTableProps<R> {
  caption: string;
  columns: RecordColumn<R>[];
  items: RecordItem<R>[];
  sort: SortState;
  /** a header was pressed: the page decides the next order (its own cycle: first direction, the other, the default) */
  onSort: (key: string) => void;
  selection?: RecordSelection<R>;
  /** the record whose details are open */
  activeId?: number | null;
  /** the record under the j / k cursor */
  cursorId?: number | null;
  onActivate: (record: R) => void;
  /** the row's menu: the last cell of a row and the top right of a card */
  actions?: (record: R) => ReactNode;
  /** a card where the list has no room for a table: its title and facts */
  card: (row: RecordRow<R>) => ReactNode;
  /** one line a row, tighter */
  compact?: boolean;
  /** a max-height class written out in full: the table scrolls inside it under a header that stays. Without one the page scrolls and the header stays at the top of the page. */
  maxHeight?: string;
  className?: string;
}

const STEP = 20;
/** The tick column and the menu column the table adds to the page's columns. */
export const TICK_WIDTH = 44;
export const MENU_WIDTH = 48;
/** What a row or a focused control scrolls clear of: the header that stays at the top of the page. */
const CLEAR_HEADER = 'scroll-mt-[44px]';
/** The header sticks at the content edge of the page's scroll box, which sits under its padding (16 to 20px of the page's own background above it): the header's fill reaches up through that
 *  strip, so the rows that scroll past are not seen above it. Where the table is at rest it is above the frame, which clips it. */
const HEAD_FILL = 'shadow-[0_-24px_0_var(--ds-surface-subtle)]';

function Caret<R>({ row, big = false }: { row: RecordRow<R>; big?: boolean }) {
  const n = row.nested;
  const w = big ? 'w-[44px]' : 'w-[24px]';
  if (!n || n.count === 0) return <span aria-hidden className={clsx('inline-block h-ds-control-sm shrink-0', w)} />;
  const Icon = n.open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-expanded={n.open}
      aria-label={n.label}
      title={n.label}
      onClick={(e) => { e.stopPropagation(); n.onToggle(); }}
      className={clsx('inline-grid h-ds-control-sm shrink-0 place-items-center rounded-ds-control text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:w-[44px]', w)}
    >
      <Icon aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
    </button>
  );
}

/** What the first cell of a row is built from: the indent and the caret, then the page's own content. */
export function RowLead<R>({ row, children }: { row: RecordRow<R>; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-[6px]" style={{ paddingLeft: row.depth * STEP }}>
      <Caret row={row} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function RecordTable<R>({
  caption, columns, items, sort, onSort, selection, activeId = null, cursorId = null, onActivate, actions, card, compact = false, maxHeight, className,
}: RecordTableProps<R>) {
  const box = useRef<HTMLDivElement>(null);
  const room = useContainerWidth(box);
  const chrome = (selection ? TICK_WIDTH : 0) + (actions ? MENU_WIDTH : 0);
  const [lead, ...rest] = columns;
  const asked: FitColumn[] = rest.map((c) => ({ key: c.key, px: 0, ...c.fit }));
  const fit = room == null ? allColumns(asked) : fitColumns(asked, room, chrome);
  const shown = fit ? [lead, ...rest.filter((c) => fit.keys.includes(c.key))] : [];
  const span = shown.length + (selection ? 1 : 0) + (actions ? 1 : 0);
  const cellPad = compact ? '[&&]:!py-[2px]' : '[&&]:!py-[3px]';

  const table = fit && (
    <Table caption={caption} className="table-fixed">
      <colgroup>
        {selection && <col style={{ width: TICK_WIDTH }} />}
        <col />
        {shown.slice(1).map((c) => <col key={c.key} style={{ width: fit.widths[c.key] }} />)}
        {actions && <col style={{ width: MENU_WIDTH }} />}
      </colgroup>
      <THead>
        <Tr>
          {selection && (
            <Th sticky className={clsx('[&&]:!pr-0', HEAD_FILL)}>
              <Checkbox aria-label={selection.headLabel} checked={selection.state === 'all'} indeterminate={selection.state === 'some'} onChange={selection.onToggleAll} />
            </Th>
          )}
          {shown.map((c) => (
            <Th key={c.key} sticky className={HEAD_FILL} sortKey={c.sortKey} sort={sort} onSortChange={c.sortKey ? () => onSort(c.sortKey!) : undefined} firstDir={c.firstDir}>
              {c.header}
            </Th>
          ))}
          {actions && <Th sticky className={HEAD_FILL}><span className="sr-only">Actions</span></Th>}
        </Tr>
      </THead>
      <TBody>
        {items.map((item) => {
          if (item.kind !== 'row') return <Fragment key={`${item.kind}-${item.id}`}>{item.table(span)}</Fragment>;
          const { id, record } = item;
          const active = activeId === id;
          const cursor = cursorId === id;
          return (
            <Tr
              key={id}
              data-record-row={id}
              selected={active}
              onActivate={() => onActivate(record)}
              className={clsx(CLEAR_HEADER, item.context && 'text-ds-fg-muted', cursor && '[&>td:first-child]:shadow-[inset_3px_0_0_var(--ds-primary)] [&>th:first-child]:shadow-[inset_3px_0_0_var(--ds-primary)]')}
            >
              {selection && (
                <Td className={clsx('[&&]:!pr-0', cellPad)}>
                  {!item.context && (
                    <Checkbox aria-label={selection.rowLabel(record)} checked={selection.ticked.has(id)} onChange={() => selection.onToggle(id)} />
                  )}
                </Td>
              )}
              {shown.map((c) => <Td key={c.key} className={cellPad}>{c.cell(item, { wide: fit.wide.includes(c.key) })}</Td>)}
              {actions && <Td className={clsx('[&&]:!pl-0', cellPad)}>{actions(record)}</Td>}
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );

  return (
    <div ref={box} className={clsx('min-w-0 max-w-full', className)}>
      {table ? (
        maxHeight
          ? <TableFrame aria-label={caption} maxHeight={maxHeight}>{table}</TableFrame>
          // no scroll box of its own (overflow: clip is not one): the header sticks to the top of the page's scroll, and the rounded frame still clips what is drawn in it
          : <div className="relative min-w-0 max-w-full overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">{table}</div>
      ) : (
        <ul aria-label={caption} className="m-0 flex list-none flex-col gap-[8px] p-0">
          {items.map((item) => {
            if (item.kind !== 'row') return <Fragment key={`${item.kind}-${item.id}`}>{item.card}</Fragment>;
            const { id, record } = item;
            const active = activeId === id;
            return (
              <li
                key={id}
                data-record-row={id}
                style={{ marginLeft: item.depth * 12 }}
                className={clsx('flex items-start gap-[4px] rounded-ds-card border', CLEAR_HEADER, active ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border bg-ds-surface', item.context && 'text-ds-fg-muted')}
              >
                {selection && !item.context && (
                  <label className="flex min-h-ds-control min-w-[44px] shrink-0 items-center justify-center">
                    <Checkbox aria-label={selection.rowLabel(record)} checked={selection.ticked.has(id)} onChange={() => selection.onToggle(id)} />
                  </label>
                )}
                <button type="button" onClick={() => onActivate(record)} aria-current={active ? 'true' : undefined} className="min-h-ds-control min-w-0 flex-1 px-[8px] py-[6px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring">
                  {card(item)}
                </button>
                {item.nested && item.nested.count > 0 && <div className="pt-[2px]"><Caret row={item} big /></div>}
                {actions && <div className="shrink-0 pr-[2px] pt-[2px]">{actions(record)}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
