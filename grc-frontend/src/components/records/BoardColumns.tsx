'use client';

// A read-only board: records in columns by a rule (a document's lifecycle status), each column with its true count and its first cards, "Show all N" for the rest. There is NO
// drag: a status changes only through the workflow, so a card is something to open, never something to move. A card is a button (Enter and Space open it). On a phone the
// columns stack; from 768px they sit side by side and the board scrolls sideways inside its frame.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import type { BoardColumn } from './explorerModel';

export interface BoardColumnsProps<R> {
  columns: BoardColumn<R>[];
  getId: (row: R) => number;
  /** the card's content: a title and two small facts */
  renderCard: (row: R) => ReactNode;
  /** the card's name for a screen reader */
  cardLabel: (row: R) => string;
  onOpen: (row: R) => void;
  /** the record whose details are open */
  activeId?: number | null;
  /** cards shown in a column before "Show all N" (default 8) */
  limit?: number;
  onShowAll: (column: string) => void;
  /** names the board for a screen reader */
  label: string;
  empty?: string;
}

export function BoardColumns<R>({ columns, getId, renderCard, cardLabel, onOpen, activeId = null, limit = 8, onShowAll, label, empty = 'Nothing here' }: BoardColumnsProps<R>) {
  return (
    <div role="group" aria-label={label} className="grid max-h-[calc(100vh-15rem)] grid-flow-row auto-rows-min gap-[10px] overflow-auto p-[10px] md:grid-flow-col md:auto-cols-[minmax(220px,1fr)] md:items-start">
      {columns.map((col) => {
        const shown = col.rows.slice(0, limit);
        return (
          <section key={col.id} aria-label={`${col.label}, ${formatCount(col.rows.length)}`} className="flex min-h-0 min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface-subtle">
            <h3 className="m-0 flex items-center gap-[6px] px-[10px] py-[8px] !text-ds-body !font-[600] !text-ds-fg">
              <span className="min-w-0 flex-1 truncate">{col.label}</span>
              <span className="shrink-0 tabular-nums text-ds-label !font-normal text-ds-fg-muted">{formatCount(col.rows.length)}</span>
            </h3>
            <ul className="m-0 flex min-h-0 list-none flex-col gap-[6px] overflow-auto px-[8px] pb-[8px]">
              {shown.map((row) => {
                const id = getId(row);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-label={cardLabel(row)}
                      aria-current={activeId === id ? 'true' : undefined}
                      data-record-row={id}
                      onClick={() => onOpen(row)}
                      className={`flex w-full min-h-ds-control flex-col gap-[4px] rounded-ds-card border px-[10px] py-[8px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring hover:bg-ds-surface-hover ${activeId === id ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border-strong bg-ds-surface'}`}
                    >
                      {renderCard(row)}
                    </button>
                  </li>
                );
              })}
              {col.rows.length === 0 && <li className="px-[2px] py-[4px] text-ds-label text-ds-fg-muted">{empty}</li>}
              {col.rows.length > shown.length && (
                <li><Button variant="link" size="sm" onClick={() => onShowAll(col.id)}>{`Show all ${formatCount(col.rows.length)}`}</Button></li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
