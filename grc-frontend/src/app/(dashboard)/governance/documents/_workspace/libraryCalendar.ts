// The Calendar layout of the Governance → Documents library, without React, so `node --test` checks it (libraryCalendar.test.ts): the documents that owe a review, in a column for
// what is overdue, one for each of the next twelve calendar months by their next review date, one for what is due later and one for what has no review date. The rules are the
// library's own and are USED here, not copied: whether a review is owed and whether it is overdue is libraryModel.reviewState (the rule the Review filter and the Governance
// overview use), and the server's dates are naive UTC (parseUtc), so a month is a UTC month and "now" is passed in (a test fixes it). No tier or criticality is shown: the data
// has none.
import { reviewState, type LibDoc } from './libraryModel.ts';

export const CALENDAR_MONTHS = 12;
/** Documents a card lists before "+N more". */
export const CALENDAR_SHOWN = 5;

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** "November 2026" */
export const monthLabel = (year: number, month0: number): string => `${MONTH_NAMES[month0]} ${year}`;
/** The month a date falls in, as one number that sorts (year * 12 + month, from 0). */
export const monthIndex = (d: Date): number => d.getUTCFullYear() * 12 + d.getUTCMonth();
/** "12 Nov" */
export const shortDay = (d: Date): string => `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;

export type CalendarKind = 'overdue' | 'month' | 'later' | 'none';

export interface CalendarColumn<D> {
  /** unique in a calendar: `overdue`, `m2026-11`, `later`, `none` */
  id: string;
  kind: CalendarKind;
  /** "Overdue", "November 2026", "Later", "No review date" */
  label: string;
  /** this month (the first month column) */
  current: boolean;
  /** every document in it: the oldest review date first, then by title */
  docs: D[];
}

export interface Calendar<D> {
  /** Overdue, the months, and the two catch-alls (Later and No review date) only when something is in them */
  columns: CalendarColumn<D>[];
  /** documents that owe no review (a draft, an expired or an archived one): the calendar leaves them out and says how many */
  notOwed: number;
  /** the documents on the calendar */
  total: number;
}

const byDue = <D extends LibDoc>(now: Date) => (a: D, b: D): number => {
  const x = reviewState(a, now).due?.getTime() ?? Infinity;
  const y = reviewState(b, now).due?.getTime() ?? Infinity;
  return x - y || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) || a.id - b.id;
};

/** The documents on the calendar. `now`: the instant every rule is read at. */
export function buildCalendar<D extends LibDoc>(docs: readonly D[], now: Date, months: number = CALENDAR_MONTHS): Calendar<D> {
  const start = monthIndex(now);
  const overdue: CalendarColumn<D> = { id: 'overdue', kind: 'overdue', label: 'Overdue', current: false, docs: [] };
  const ahead: CalendarColumn<D>[] = Array.from({ length: months }, (_, i) => ({
    id: `m${Math.floor((start + i) / 12)}-${String(((start + i) % 12) + 1).padStart(2, '0')}`,
    kind: 'month' as const,
    label: monthLabel(Math.floor((start + i) / 12), (start + i) % 12),
    current: i === 0,
    docs: [],
  }));
  const later: CalendarColumn<D> = { id: 'later', kind: 'later', label: 'Later', current: false, docs: [] };
  const none: CalendarColumn<D> = { id: 'none', kind: 'none', label: 'No review date', current: false, docs: [] };
  let notOwed = 0;
  for (const d of docs) {
    const s = reviewState(d, now);
    if (!s.bucket) { notOwed += 1; continue; }
    if (s.bucket === 'overdue') overdue.docs.push(d);
    else if (s.bucket === 'unscheduled' || !s.due) none.docs.push(d);
    else {
      const at = monthIndex(s.due) - start;
      if (at < 0) overdue.docs.push(d);                       // cannot happen (a date not yet passed is not before this month); kept so no document is ever dropped
      else if (at >= months) later.docs.push(d);
      else ahead[at].docs.push(d);
    }
  }
  const columns = [overdue, ...ahead, ...(later.docs.length ? [later] : []), ...(none.docs.length ? [none] : [])];
  const order = byDue<D>(now);
  columns.forEach((c) => c.docs.sort(order));
  return { columns, notOwed, total: columns.reduce((n, c) => n + c.docs.length, 0) };
}

/** What a column says when it holds nothing. */
export const calendarEmpty = (kind: CalendarKind): string => (kind === 'overdue' ? 'Nothing overdue' : 'Nothing due');

/** The line under a document's title in a card: when its review is due (how late, for an overdue one) and who owns it. */
export function calendarLine(d: LibDoc, kind: CalendarKind, now: Date): string {
  const s = reviewState(d, now);
  const when = kind === 'overdue' ? s.label : kind === 'month' && s.due ? shortDay(s.due) : kind === 'later' && s.due ? `${shortDay(s.due)} ${s.due.getUTCFullYear()}` : '';
  return [when, d.owner_name?.trim() || 'No owner'].filter(Boolean).join(' · ');
}

/** The words a screen reader hears for a card: "November 2026, 3 documents". */
export const calendarAria = (c: { label: string; docs: readonly unknown[] }): string => `${c.label}, ${c.docs.length} ${c.docs.length === 1 ? 'document' : 'documents'}`;

/** What "+N more" on a card can set in the library's own filters: the Review filter has the buckets (overdue, no date) but not a month, so for a month the caller opens the list
 *  grouped by review month. */
export function calendarShowAll(c: Pick<CalendarColumn<unknown>, 'kind'>): { review: ('overdue' | 'unscheduled')[] } | { group: 'review' } {
  return c.kind === 'overdue' ? { review: ['overdue'] } : c.kind === 'none' ? { review: ['unscheduled'] } : { group: 'review' };
}
