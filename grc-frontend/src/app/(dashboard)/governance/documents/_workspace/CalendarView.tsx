'use client';

/**
 * The Calendar layout of the library: the documents that owe a review, in a card for what is overdue, one for each of the next twelve months (by their next review date), one for what is
 * due later and one for what has no review date. Each card has its count and its first documents (the whole line opens the document, as a row does); "+N more" asks the page to show
 * the rest (a filter or the list) or, without a page that answers, lists them all in place. A quiet month says "Nothing due". Read-only, like the Board: a review date changes in the
 * document or in bulk, never by dragging. Which documents are in which card, and the line under a title, is libraryCalendar.ts; the cards are laid out by the room the calendar has (as many
 * as fit, 220px at the least), never by the window, so a phone gets one column and nothing scrolls sideways.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { formatCount } from '@/lib/format';
import type { GovDoc } from './lib';
import { CALENDAR_SHOWN, calendarAria, calendarEmpty, calendarLine, type Calendar, type CalendarColumn } from './libraryCalendar';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';

export interface CalendarViewProps {
  calendar: Calendar<GovDoc>;
  /** the instant the dates are read at (the page's `now`) */
  now: Date;
  /** the document whose details are open */
  activeId?: number | null;
  onOpen: (doc: GovDoc) => void;
  /** "+N more" on a card: the page filters or opens the list (libraryCalendar.calendarShowAll says what fits); without it the card lists all its documents in place */
  onShowAll?: (column: CalendarColumn<GovDoc>) => void;
  /** documents a card lists before "+N more" (default 5) */
  limit?: number;
}

function Card({ column, now, activeId, onOpen, onShowAll, limit, all, onToggleAll }: {
  column: CalendarColumn<GovDoc>;
  now: Date;
  activeId: number | null;
  onOpen: (doc: GovDoc) => void;
  onShowAll?: (column: CalendarColumn<GovDoc>) => void;
  limit: number;
  /** listed in full, in place */
  all: boolean;
  onToggleAll: () => void;
}) {
  const late = column.kind === 'overdue';
  const shown = all ? column.docs : column.docs.slice(0, limit);
  const more = column.docs.length - shown.length;
  return (
    <section aria-label={calendarAria(column)} className={`flex min-h-0 min-w-0 flex-col rounded-ds-card border bg-ds-surface-subtle ${late && column.docs.length > 0 ? 'border-ds-danger-border' : 'border-ds-border'}`}>
      <h3 className="m-0 flex items-center gap-[6px] px-[10px] py-[8px] !text-ds-body !font-[600] !text-ds-fg">
        <span className="min-w-0 flex-1 truncate">{column.label}</span>
        {column.current && <span className="shrink-0 rounded-ds-control bg-ds-primary-soft px-[6px] text-ds-label !font-normal text-ds-primary-text">This month</span>}
        <span className={`shrink-0 rounded-full px-[6px] tabular-nums text-ds-label !font-normal ${late && column.docs.length > 0 ? 'bg-ds-danger-soft text-ds-danger' : 'bg-ds-border text-ds-fg-body'}`}>{formatCount(column.docs.length)}</span>
      </h3>
      <ul className="m-0 flex min-h-0 list-none flex-col gap-[6px] px-[8px] pb-[8px]">
        {shown.map((d) => (
          <li key={d.id} data-record-row={d.id}>
            <button
              type="button"
              onClick={() => onOpen(d)}
              aria-current={activeId === d.id ? 'true' : undefined}
              className={`flex min-h-ds-control w-full min-w-0 flex-col gap-[2px] rounded-ds-card border px-[10px] py-[6px] text-left hover:bg-ds-surface-hover ${FOCUS} ${activeId === d.id ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border-strong bg-ds-surface'}`}
            >
              <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{d.title}</span>
              <span className="truncate text-ds-label text-ds-fg-muted">{calendarLine(d, column.kind, now)}</span>
            </button>
          </li>
        ))}
        {column.docs.length === 0 && <li className="px-[2px] py-[4px] text-ds-label text-ds-fg-muted">{calendarEmpty(column.kind)}</li>}
        {more > 0 && (
          <li>
            <Button variant="link" size="sm" aria-label={`Show ${formatCount(more)} more documents in ${column.label}`} onClick={() => (onShowAll ? onShowAll(column) : onToggleAll())}>
              {`+${formatCount(more)} more`}
            </Button>
          </li>
        )}
        {more === 0 && all && column.docs.length > limit && (
          <li><Button variant="link" size="sm" aria-label={`Show fewer documents in ${column.label}`} onClick={onToggleAll}>Show fewer</Button></li>
        )}
      </ul>
    </section>
  );
}

export function CalendarView({ calendar, now, activeId = null, onOpen, onShowAll, limit = CALENDAR_SHOWN }: CalendarViewProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const next = new Set(s); if (!next.delete(id)) next.add(id); return next; });
  return (
    <div>
      <div role="group" aria-label="Reviews by month" className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-start gap-[10px] p-[10px]">
        {calendar.columns.map((c) => (
          <Card key={c.id} column={c} now={now} activeId={activeId} onOpen={onOpen} onShowAll={onShowAll} limit={limit} all={open.has(c.id)} onToggleAll={() => toggle(c.id)} />
        ))}
      </div>
      {calendar.notOwed > 0 && (
        <div className="flex items-center gap-1 px-[12px] pb-[10px] text-ds-label text-ds-fg-muted">
          <span role="status">{`${formatCount(calendar.notOwed)} not on the calendar`}</span>
          <InfoTip label="About the calendar" text="Drafts, expired and archived documents owe no review, so they are not on the calendar." />
        </div>
      )}
    </div>
  );
}
