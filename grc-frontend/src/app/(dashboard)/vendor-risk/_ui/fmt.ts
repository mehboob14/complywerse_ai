// Dates, countdowns and money in the words a reader acts on (Verity's "5 Mar 2026", "in 9 days", "$42,000").
// Pure, so `node --test` runs fmt.test.ts against it. The calendar-day, countdown and status-label rules are src/lib/format.ts's (one
// implementation for the platform); this is the vendor kit's contract on top of them: its own words for "none" and its dollar amounts.
import { NOT_SET, formatDate, formatRelative, statusLabel } from '../../../../lib/format.ts';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const fmt = {
  /** "5 Mar 2026"; "No date" when there is none (or it is not a date). */
  date(value?: string | null): string {
    return formatDate(value, { empty: 'No date' });
  },

  /** "in 9 days", "today", "12 days ago", counted in calendar days against `today`; '' when there is no date. */
  countdown(value?: string | null, today: Date = new Date()): string {
    return formatRelative(value, today);
  },

  /** "$42,000" (US dollars, no cents); "Not set" when there is no amount. */
  money(amount?: number | null): string {
    return typeof amount === 'number' && Number.isFinite(amount) ? USD.format(amount) : NOT_SET;
  },

  /** A status word as a label: "in_remediation" -> "In remediation". Added to the contract; '' when there is none. */
  status(value?: string | null): string {
    return statusLabel(value, '');
  },
};
