'use client';

// The review calendar: one month, a day per button. From 768px a grid of weeks (Sunday first) with the chosen day's reviews in a panel beside it (from 1024px)
// or under it; below 768px an agenda, the days that have reviews in date order. A review sits on the day it is written for, in every time zone (calendarModel.ts:
// the old calendar keyed its cells through toISOString and put every review one cell off east of Greenwich). Every day of the month is a real button with a name
// ("12 Nov 2026, 3 reviews, 2 overdue, today"); the grid is one tab stop and the arrow keys, Home, End, PageUp and PageDown move through it (moveDay).
// A day with overdue reviews says "overdue" in words. The month and the day are the page's address (the page passes them in).
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatCount, formatDate } from '@/lib/format';
import { Button, EmptyState, ErrorState, IconButton, PersonChip, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import {
  WEEKDAYS, addMonths, agendaOf, bucketByDay, dayKey, dayLabel, dueState, monthGrid, monthLabel, monthOf, moveDay, reviewsWord, sameMonth,
  type DayKey, type Month,
} from './calendarModel';
import { DocumentLink, DueStatus } from './_parts';
import { useReviewCalendar, type CalendarDoc } from './_queries';
import { typeLabel } from './reviewsModel';

const CELL = 'flex min-h-[88px] w-full flex-col items-start gap-[2px] rounded-ds-control border p-[8px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring';
const CELL_IDLE = 'border-ds-border bg-ds-surface hover:bg-ds-surface-hover';
const CELL_PICKED = 'border-ds-primary bg-ds-primary-soft';
const HEADING = 'min-w-0 break-words !text-ds-section !text-ds-fg';

const byTitle = (a: CalendarDoc, b: CalendarDoc): number => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) || a.id - b.id;

/** One review under a day: its title (the link that opens the document), what kind it is, who owns it and where its date stands. */
function ReviewLine({ doc, now, today }: { doc: CalendarDoc; now: Date; today: DayKey }) {
  return (
    <li className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      <div className="min-w-0">
        <DocumentLink id={doc.id} title={doc.title} />
        <div className="mt-[2px] text-ds-label font-normal text-ds-fg-muted">{typeLabel(doc.doc_type)}</div>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[8px]">
        <PersonChip name={doc.owner_name} size={20} />
        <DueStatus state={dueState(doc.next_review_date, now)} due={doc.next_review_date} today={today} />
      </div>
    </li>
  );
}

export interface ReviewCalendarProps {
  month: Month;
  today: DayKey;
  /** the chosen day, if it is in the month shown */
  selected: DayKey | null;
  onMonth: (month: Month) => void;
  onSelect: (day: DayKey | null) => void;
}

export function ReviewCalendar({ month, today, selected, onMonth, onSelect }: ReviewCalendarProps) {
  const cal = useReviewCalendar(month.year, month.month);
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const pendingFocus = useRef<DayKey | null>(null);       // a key press that crossed into another month: focus that day once its month has arrived
  const pickedHere = useRef(false);                       // the day was chosen by the person, not by the address: only then does the panel take focus
  const [rovingKey, setRovingKey] = useState<DayKey | null>(null);      // the day the arrow keys were last on: the grid's one tab stop follows it
  const headingId = useId();
  const panelHeading = useId();

  const items = useMemo(() => cal.data ?? [], [cal.data]);
  const now = useMemo(() => new Date(), [cal.dataUpdatedAt]);          // the clock of this answer: every card and day is measured against the same moment
  const days = useMemo(() => bucketByDay(items, (d) => d.next_review_date, byTitle), [items]);
  const cells = useMemo(() => monthGrid(month), [month]);
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7)), [cells]);
  const agenda = useMemo(() => agendaOf(days), [days]);
  const overdueOf = (list: readonly CalendarDoc[]) => list.filter((d) => dueState(d.next_review_date, now) === 'overdue').length;
  const monthOverdue = overdueOf(items);

  const inMonth = (key: DayKey) => sameMonth(monthOf(key), month);
  const first = dayKey(month.year, month.month, 1);
  const chosen = selected && inMonth(selected) ? selected : null;
  const stop = rovingKey && inMonth(rovingKey) ? rovingKey : chosen ?? (inMonth(today) ? today : first);   // the one day the Tab key lands on
  const chosenItems = chosen ? days.get(chosen) ?? [] : [];

  const focusDay = (key: DayKey): boolean => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-review-day="${key}"]`);
    if (!el) return false;
    el.focus();
    return true;
  };

  // a key press that left the month: its day takes focus when that month's grid is on screen
  useEffect(() => {
    const key = pendingFocus.current;
    if (key && inMonth(key) && focusDay(key)) pendingFocus.current = null;
  });

  // the day the person chose: its reviews are scrolled into view (they are under the grid below 1024px) and take focus
  useEffect(() => {
    if (!chosen || !pickedHere.current) return;
    pickedHere.current = false;
    panelRef.current?.focus({ preventScroll: true });
    panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [chosen]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, key: DayKey) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const to = moveDay(key, e.key);
    if (!to) return;
    e.preventDefault();
    setRovingKey(to);
    if (inMonth(to)) { focusDay(to); return; }
    pendingFocus.current = to;
    onMonth(monthOf(to));
  };

  const pick = (key: DayKey) => {
    pickedHere.current = chosen !== key;
    onSelect(chosen === key ? null : key);
  };

  const summary = cal.isSuccess
    ? (items.length === 0 ? 'No reviews' : `${formatCount(items.length)} ${items.length === 1 ? 'review' : 'reviews'}${monthOverdue > 0 ? ` · ${formatCount(monthOverdue)} overdue` : ''}`)
    : '';

  // ARIA roles on divs rather than a <table>: the platform CSS styles bare table, th and td elements (collapsed borders, 10px padding, 11.5px text) with rules
  // no utility outranks, and a calendar needs none of it
  const grid = (
    <div ref={gridRef} role="grid" aria-label={`Review calendar, ${monthLabel(month)}`} aria-busy={cal.isPending || undefined} className="flex flex-col gap-[4px]">
      <div role="row" className="grid grid-cols-7 gap-[4px]">
        {WEEKDAYS.map((d) => (
          <div key={d.short} role="columnheader" aria-label={d.long} className="pb-[2px] text-center text-ds-label font-normal text-ds-fg-muted">{d.short}</div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0].key} role="row" className="grid grid-cols-7 gap-[4px]">
          {week.map((cell) => {
            if (!cell.inMonth) {
              return <div key={cell.key} role="gridcell" aria-hidden className="min-h-[88px] rounded-ds-control bg-ds-surface-subtle p-[8px] text-ds-body text-ds-fg-muted">{cell.day}</div>;
            }
            const list = days.get(cell.key) ?? [];
            const overdue = overdueOf(list);
            const isToday = cell.key === today;
            const picked = cell.key === chosen;
            return (
              <div key={cell.key} role="gridcell" className="min-w-0">
                <button
                  type="button"
                  data-review-day={cell.key}
                  aria-label={dayLabel(cell.key, list.length, { overdue, today: isToday })}
                  aria-pressed={picked}
                  aria-current={isToday ? 'date' : undefined}
                  tabIndex={cell.key === stop ? 0 : -1}
                  onClick={() => pick(cell.key)}
                  onFocus={() => setRovingKey(cell.key)}
                  onKeyDown={(e) => onKey(e, cell.key)}
                  className={clsx(CELL, picked ? CELL_PICKED : CELL_IDLE)}
                >
                  <span className={clsx('inline-flex h-[24px] min-w-[24px] items-center justify-center rounded-full px-[4px] text-ds-body font-[500]', isToday ? 'bg-ds-primary text-ds-on-primary' : 'text-ds-fg')}>{cell.day}</span>
                  {list.length > 0 && <span className="text-ds-label font-normal text-ds-fg-body">{formatCount(list.length)} {list.length === 1 ? 'review' : 'reviews'}</span>}
                  {overdue > 0 && <span className="text-ds-label font-[600] text-ds-danger">{formatCount(overdue)} overdue</span>}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  const panel = (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby={panelHeading}
      className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px] focus-visible:outline-none focus-visible:shadow-ds-ring"
    >
      {chosen ? (
        <>
          <div className="flex items-start justify-between gap-[8px]">
            <div className="min-w-0">
              <h3 id={panelHeading} className={HEADING}>{formatDate(chosen)}</h3>
              <p className="text-ds-body text-ds-fg-muted">{reviewsWord(chosenItems.length)}</p>
            </div>
            <IconButton label="Clear the chosen day" onClick={() => { pendingFocus.current = chosen; onSelect(null); }}><X /></IconButton>
          </div>
          {chosenItems.length > 0 ? (
            <ul role="list" className="mt-[12px] flex flex-col gap-[8px] lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:p-[2px]">
              {chosenItems.map((d) => <ReviewLine key={d.id} doc={d} now={now} today={today} />)}
            </ul>
          ) : (
            <p className="mt-[12px] text-ds-body text-ds-fg-muted">No reviews are due on {formatDate(chosen)}.</p>
          )}
        </>
      ) : (
        <>
          <h3 id={panelHeading} className={HEADING}>{monthLabel(month)}</h3>
          <p className="mt-[4px] text-ds-body text-ds-fg-muted">{cal.isSuccess ? (items.length === 0 ? `No reviews are due in ${monthLabel(month)}.` : `${summary}. Choose a day to see its reviews.`) : 'Choose a day to see its reviews.'}</p>
        </>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px]">
        <div className="flex min-w-0 items-center gap-[8px]">
          <IconButton label="Previous month" variant="secondary" onClick={() => onMonth(addMonths(month, -1))}><ChevronLeft /></IconButton>
          <IconButton label="Next month" variant="secondary" onClick={() => onMonth(addMonths(month, 1))}><ChevronRight /></IconButton>
          <h2 id={headingId} aria-live="polite" className={clsx(HEADING, 'ml-[4px]')}>{monthLabel(month)}</h2>
        </div>
        <div className="flex items-center gap-[12px]">
          {summary && <span className="text-ds-body text-ds-fg-muted">{summary}</span>}
          <Button onClick={() => onMonth(monthOf(today))} disabled={inMonth(today)}>Today</Button>
        </div>
      </div>

      {cal.isError ? (
        <ErrorState title="Couldn't load the calendar" message={errorMessage(cal.error, 'The reviews of this month did not load.')} onRetry={canRetry(cal.error) ? () => { void cal.refetch(); } : undefined} />
      ) : cal.isPending ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading the calendar</span>
          <Skeleton className="h-[420px] w-full" />
        </div>
      ) : (
        <>
          <div className="hidden gap-[16px] md:flex md:flex-col lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">{grid}</div>
            <div className="w-full shrink-0 lg:sticky lg:top-0 lg:w-[320px]">{panel}</div>
          </div>

          <div className="flex flex-col gap-[16px] md:hidden">
            {agenda.length === 0 ? (
              <EmptyState bare kind="firstUse" title={`No reviews are due in ${monthLabel(month)}`} />
            ) : agenda.map(({ key, items: due }) => (
              <section key={key} aria-label={`${formatDate(key)}, ${reviewsWord(due.length)}`}>
                <h3 className="mb-[8px] !text-ds-body !font-[600] !text-ds-fg">{formatDate(key)} <span className="font-normal text-ds-fg-muted">· {reviewsWord(due.length)}</span></h3>
                <ul role="list" className="flex flex-col gap-[8px]">
                  {due.map((d) => <ReviewLine key={d.id} doc={d} now={now} today={today} />)}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
