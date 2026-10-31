// The calendar of Governance > Reviews as pure functions (calendarModel.test.ts runs them in six time zones). No React.
//
// A review date is a DAY. The server stores it as a DateTime ("2026-11-12T00:00:00", or with the time of day in it when completing a review
// schedules the next one) and sends it without a zone. The day a person sees is the date AS WRITTEN: no zone conversion, ever. The old calendar keyed
// every cell with `new Date(y, m, d).toISOString().split('T')[0]`: a local midnight turned into UTC, so east of Greenwich (Pakistan, the Gulf,
// Moscow, New Zealand) every cell was keyed the day BEFORE the day it drew, and the reviews of the 12th sat in the cell of the 11th. Nothing in this
// file turns a local date into UTC or back: a day is a "YYYY-MM-DD" key, and its arithmetic is done on year / month / day numbers (Date.UTC and the
// getUTC* readers, which have no zone). The one place the viewer's clock matters is `todayKey`, the viewer's own calendar date.
//
// What is NOT a day: a timestamp (completed at, created at) is a moment in naive UTC; lib/format.ts (formatDate / formatDateTime) writes it.
// Whether a review is overdue stays the server's rule (reviews.py: the date's moment is before now); `dueState` repeats it for the cells that carry no flag.
import { formatDate } from '../../../../lib/format.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';

/** "2026-11-12": a calendar day. */
export type DayKey = string;
/** A month: `month` is 1-12 (the API's and the address's numbering; JavaScript's own is 0-11). */
export interface Month { year: number; month: number }
export interface Cell { key: DayKey; year: number; month: number; day: number; /** 0 = Sunday */ weekday: number; inMonth: boolean }

const DAY_MS = 86_400_000;
const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The calendar's week starts on Sunday, as it always has. */
export const WEEK_STARTS_ON = 0;
export const WEEKDAYS: ReadonlyArray<{ short: string; long: string }> = [
  { short: 'Sun', long: 'Sunday' }, { short: 'Mon', long: 'Monday' }, { short: 'Tue', long: 'Tuesday' }, { short: 'Wed', long: 'Wednesday' },
  { short: 'Thu', long: 'Thursday' }, { short: 'Fri', long: 'Friday' }, { short: 'Sat', long: 'Saturday' },
];

// ── days ─────────────────────────────────────────────────────────────────────
export const dayKey = (year: number, month: number, day: number): DayKey => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();                      // day 0 of the NEXT month (JavaScript's months are 0-11)
}

/** The parts of a day key; null when it is not "YYYY-MM-DD" or names a day the month does not have ("2027-02-29"). */
export function parseDay(key: string | null | undefined): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  if (!m) return null;
  const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) ? { year, month, day } : null;
}

/** The day a stored review date stands for: the date as written (the first ten characters, "2026-11-12T00:00:00" or "2026-11-12T14:05:00.123456"
 *  alike), whatever the viewer's zone. null for a missing or broken date, or one that names a day the month does not have. */
export function dayOf(value: string | null | undefined): DayKey | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(text)) return null;
  const key = text.slice(0, 10);
  return parseDay(key) ? key : null;
}

/** The viewer's own calendar date, read from their clock (the only zone-dependent function here). */
export function todayKey(now: Date = new Date()): DayKey {
  return dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Whole days since 1970-01-01 of a day key (zone-free). */
export function dayNumber(key: DayKey): number {
  const d = parseDay(key);
  if (!d) throw new Error(`not a day: ${key}`);
  return Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;
}

/** Calendar days from `from` to `to`: 3 for 12 Nov to 15 Nov, negative when `to` is earlier. */
export const diffDays = (from: DayKey, to: DayKey): number => dayNumber(to) - dayNumber(from);

export function addDays(key: DayKey, n: number): DayKey {
  const d = parseDay(key);
  if (!d) throw new Error(`not a day: ${key}`);
  const at = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return dayKey(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/** 0 = Sunday. */
export function weekdayOf(key: DayKey): number {
  const d = parseDay(key);
  if (!d) throw new Error(`not a day: ${key}`);
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

// ── months ───────────────────────────────────────────────────────────────────
export const monthOf = (key: DayKey): Month => {
  const d = parseDay(key);
  if (!d) throw new Error(`not a day: ${key}`);
  return { year: d.year, month: d.month };
};

export const sameMonth = (a: Month, b: Month): boolean => a.year === b.year && a.month === b.month;

/** The month `n` months from `m` (negative: earlier), across year ends. */
export function addMonths(m: Month, n: number): Month {
  const at = m.year * 12 + (m.month - 1) + n;
  return { year: Math.floor(at / 12), month: (((at % 12) + 12) % 12) + 1 };
}

/** The same day `n` months on, or the last day of that month when it has no such day (31 Jan + 1 month = 28 Feb, or 29 in a leap year). */
export function addMonthsToDay(key: DayKey, n: number): DayKey {
  const d = parseDay(key);
  if (!d) throw new Error(`not a day: ${key}`);
  const to = addMonths({ year: d.year, month: d.month }, n);
  return dayKey(to.year, to.month, Math.min(d.day, daysInMonth(to.year, to.month)));
}

export const monthKey = (m: Month): string => `${pad(m.year, 4)}-${pad(m.month)}`;

/** "2026-11" as a month; null for anything else (the address is typed by people and carried in e-mails). */
export function parseMonth(text: string | null | undefined): Month | null {
  const m = /^(\d{4})-(\d{2})$/.exec(text ?? '');
  if (!m) return null;
  const year = Number(m[1]); const month = Number(m[2]);
  return month >= 1 && month <= 12 && year >= 1900 && year <= 2200 ? { year, month } : null;
}

export const monthLabel = (m: Month): string => `${MONTH_NAMES[m.month - 1]} ${m.year}`;

/** The month grid: always six weeks (42 cells) so the calendar keeps its height from month to month; the days before and after the month are
 *  there to complete the weeks (`inMonth: false`). Weeks start on Sunday. */
export function monthGrid(m: Month): Cell[] {
  const first = dayKey(m.year, m.month, 1);
  const lead = (weekdayOf(first) - WEEK_STARTS_ON + 7) % 7;
  const start = addDays(first, -lead);
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const key = addDays(start, i);
    const d = parseDay(key)!;
    cells.push({ key, year: d.year, month: d.month, day: d.day, weekday: weekdayOf(key), inMonth: d.year === m.year && d.month === m.month });
  }
  return cells;
}

// ── reviews on their days ────────────────────────────────────────────────────
/** The reviews by the day they are due. A review with no date, or a broken one, is on no day. Each day's list keeps the order given, or `compare`'s. */
export function bucketByDay<T>(items: readonly T[], dateOf: (item: T) => string | null | undefined, compare?: (a: T, b: T) => number): Map<DayKey, T[]> {
  const days = new Map<DayKey, T[]>();
  for (const item of items) {
    const key = dayOf(dateOf(item));
    if (!key) continue;
    const list = days.get(key);
    if (list) list.push(item); else days.set(key, [item]);
  }
  if (compare) days.forEach((list) => list.sort(compare));
  return days;
}

/** The days that have reviews, earliest first: the agenda of a phone. */
export function agendaOf<T>(days: ReadonlyMap<DayKey, readonly T[]>): Array<{ key: DayKey; items: readonly T[] }> {
  return Array.from(days.keys()).sort().map((key) => ({ key, items: days.get(key)! }));
}

// ── due, overdue ─────────────────────────────────────────────────────────────
export type DueState = 'overdue' | 'due_soon' | 'on_track';
/** A review within this many days (the server's `days_until_review <= 7`, the amber of the list) is due soon. */
export const DUE_SOON_DAYS = 7;

/** The server's rule for a review date, for the cells that come with no flag (reviews.py serialize_review_document): the date, read in naive UTC as the
 *  server reads it, is before now: overdue; else under eight whole days away (`days_until_review <= 7`): due soon; else on track. Not a zone question:
 *  both sides are instants. null without a date. */
export function dueState(value: string | null | undefined, now: Date = new Date()): DueState | null {
  const due = parseUtc(typeof value === 'string' ? value.trim() : value);
  if (!due) return null;
  const ahead = due.getTime() - now.getTime();
  if (ahead < 0) return 'overdue';
  return Math.floor(ahead / DAY_MS) <= DUE_SOON_DAYS ? 'due_soon' : 'on_track';
}

/** What a due date says in words, counted in calendar days from `today` (the viewer's calendar): "12 days late", "Due today", "Due tomorrow", "In 12 days".
 *  An overdue review on its own due day is "Due today" (the platform counts it overdue from the start of that day). '' when there is no date or state. */
export function dueWords(day: DayKey | null, today: DayKey, state: DueState | null): string {
  if (!day || !state) return '';
  const ahead = diffDays(today, day);
  if (state === 'overdue') {
    const late = Math.max(0, -ahead);
    return late === 0 ? 'Due today' : `${late} ${late === 1 ? 'day' : 'days'} late`;
  }
  if (ahead <= 0) return 'Due today';
  return ahead === 1 ? 'Due tomorrow' : `In ${ahead} days`;
}

/** "no reviews", "1 review", "12 reviews". */
export const reviewsWord = (n: number): string => (n === 0 ? 'no reviews' : n === 1 ? '1 review' : `${n} reviews`);

/** What a day's button says to a screen reader: "12 Nov 2026, 3 reviews, 2 overdue, today". */
export function dayLabel(key: DayKey, count: number, { overdue = 0, today = false }: { overdue?: number; today?: boolean } = {}): string {
  return [formatDate(key), reviewsWord(count), overdue > 0 ? `${overdue} overdue` : '', today ? 'today' : ''].filter(Boolean).join(', ');
}

// ── the keyboard ─────────────────────────────────────────────────────────────
/** Where a key pressed on a day of the grid moves to: arrows by a day or a week, Home / End to the start / end of the week, PageUp / PageDown by a
 *  month (the same day, or the month's last). null for any other key. */
export function moveDay(key: DayKey, pressed: string): DayKey | null {
  const lead = (weekdayOf(key) - WEEK_STARTS_ON + 7) % 7;
  switch (pressed) {
    case 'ArrowLeft': return addDays(key, -1);
    case 'ArrowRight': return addDays(key, 1);
    case 'ArrowUp': return addDays(key, -7);
    case 'ArrowDown': return addDays(key, 7);
    case 'Home': return addDays(key, -lead);
    case 'End': return addDays(key, 6 - lead);
    case 'PageUp': return addMonthsToDay(key, -1);
    case 'PageDown': return addMonthsToDay(key, 1);
    default: return null;
  }
}
