// The dates the document page prints, in one place over lib/format.ts: "12 Nov 2026" and "12 Nov 2026, 14:05" (24-hour clock) for every viewer, whatever the
// browser's language. Pure, so node --test runs docDates.test.ts in three time zones.
// The server writes times in naive UTC, and a value is one of two things:
//   - a MOMENT (a request's due time, when something was done, proposed, archived, a version made): the viewer's own day and clock -> day / dateTime / clock;
//   - a DAY that arrives as a DateTime (effective date, next review: "2026-11-12T00:00:00"): the day as written, in every zone -> calendarDay.
// lib/documentLifecycle.ts has its own day()/dateTime() (browser-locale text, no year on dateTime) that other pages and the library's hover card still use; this
// page does not.
import { formatDate, formatDateTime } from '../../../../../lib/format.ts';

type Stored = string | number | Date | null | undefined;

/** A moment as the viewer's own day: "12 Nov 2026"; "—" when there is none. */
export const day = (value: Stored): string => formatDate(value);

/** A moment with its clock time: "12 Nov 2026, 14:05"; "—" when there is none. */
export const dateTime = (value: Stored): string => formatDateTime(value);

/** A day that is stored as a DateTime, or as a plain date: the day as written ("2026-11-12T00:00:00" is the 12th west of UTC too). */
export const calendarDay = (value: Stored, empty?: string): string => formatDate(value, { calendar: true, ...(empty !== undefined ? { empty } : {}) });

/** The clock time of a moment, "14:05" in the viewer's zone; '' when there is none or it is a plain date. */
export function clock(value: Stored): string {
  const text = formatDateTime(value, { empty: '' });
  const at = text.lastIndexOf(', ');
  return at >= 0 ? text.slice(at + 2) : '';
}
