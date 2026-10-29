// Dates, countdowns and money in the words a reader acts on (Verity's "5 Mar 2026", "in 9 days", "$42,000").
// Pure, so `node --test` runs fmt.test.ts against it. The server stamps times in naive UTC, so every value goes through parseUtc.
import { parseUtc } from '../../../../lib/serverTime.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];   // fixed: Intl says "Sept" in en-GB
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** The calendar day a stored value stands for, as [year, month 0-11, day]. A date with no time ("2026-03-25") is that day as
 *  written, whatever the viewer's zone; a moment ("2026-03-25T22:30:00") is the viewer's own day, as every other time on the platform. */
function calendarDay(value: string | null | undefined): [number, number, number] | null {
  const at = parseUtc(value);
  if (!at) return null;
  return DATE_ONLY.test(String(value)) ? [at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()] : [at.getFullYear(), at.getMonth(), at.getDate()];
}

export const fmt = {
  /** "5 Mar 2026"; "No date" when there is none (or it is not a date). */
  date(value?: string | null): string {
    const day = calendarDay(value);
    return day ? `${day[2]} ${MONTHS[day[1]]} ${day[0]}` : 'No date';
  },

  /** "in 9 days", "today", "12 days ago", counted in calendar days against `today`; '' when there is no date. */
  countdown(value?: string | null, today: Date = new Date()): string {
    const day = calendarDay(value);
    if (!day) return '';
    const diff = Math.round((Date.UTC(day[0], day[1], day[2]) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
    if (diff === 0) return 'today';
    const n = Math.abs(diff);
    const days = `${n} ${n === 1 ? 'day' : 'days'}`;
    return diff > 0 ? `in ${days}` : `${days} ago`;
  },

  /** "$42,000" (US dollars, no cents); "Not set" when there is no amount. */
  money(amount?: number | null): string {
    return typeof amount === 'number' && Number.isFinite(amount) ? USD.format(amount) : 'Not set';
  },

  /** A status word as a label: "in_remediation" -> "In remediation". Added to the contract; '' when there is none. */
  status(value?: string | null): string {
    const text = String(value ?? '').trim().replace(/[_\s-]+/g, ' ').toLowerCase();
    return text ? text[0].toUpperCase() + text.slice(1) : '';
  },
};
