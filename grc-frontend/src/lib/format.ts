// How the platform writes a date, a missing value, a count and a label: "12 Nov 2026", "—" when nothing is recorded, "Not set" when the
// person can set the value. Pure, so `node --test` runs format.test.ts against it (the date rules in six time zones). The server stamps
// times in naive UTC, so every date goes through parseUtc. No toLocale*String here: month names, the 24-hour clock and the separators
// must read the same for every viewer (Intl says "Sept" in en-GB).
import { parseUtc } from './serverTime.ts';

/** Nothing is recorded: a value the person cannot set, or that the system has not produced yet. Never "N/A", "None", "Unknown" or "-". */
export const EMPTY = '—';
/** A value the person can configure and has not. */
export const NOT_SET = 'Not set';
/** An owner or assignee nobody has been chosen for. */
export const UNASSIGNED = 'Unassigned';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];   // fixed: Intl says "Sept" in en-GB
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const COUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const pad = (n: number): string => String(n).padStart(2, '0');
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// ── dates ────────────────────────────────────────────────────────────────────
/** A stored date or time: the server's text (naive UTC), an epoch in milliseconds, or a Date. */
export type DateInput = string | number | Date | null | undefined;

/** The calendar day a value stands for (month 0-11) and, for a moment, the clock time on the viewer's wall ("14:05"). */
interface Day { year: number; month: number; date: number; time: string | null }

/** A date with no time ("2026-03-25") is that day as written, in every zone. A moment ("2026-03-25T22:30:00", naive = UTC) is the viewer's
 *  own day and clock. null when the value is not a date; V8 reads "2027-02-29" as 1 Mar 2027, so a day the month does not have is none. */
function readDate(value: DateInput): Day | null {
  const text = typeof value === 'string' ? value.trim() : value;
  const at = parseUtc(text);
  if (!at || Number.isNaN(at.getTime())) return null;
  if (typeof text === 'string') {
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (ymd && Number(ymd[3]) > new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]), 0)).getUTCDate()) return null;
    if (DATE_ONLY.test(text)) return { year: at.getUTCFullYear(), month: at.getUTCMonth(), date: at.getUTCDate(), time: null };
  }
  return { year: at.getFullYear(), month: at.getMonth(), date: at.getDate(), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
}

const dayWords = (d: Day): string => `${d.date} ${MONTHS[d.month]} ${d.year}`;

/** "12 Nov 2026"; `empty` (default "—") when there is no date. A date with no time never moves; a moment shows the viewer's own day. */
export function formatDate(value: DateInput, { empty = EMPTY }: { empty?: string } = {}): string {
  const day = readDate(value);
  return day ? dayWords(day) : empty;
}

/** "12 Nov 2026, 14:05": 24-hour clock in the viewer's zone. A date with no time shows just the date. */
export function formatDateTime(value: DateInput, { empty = EMPTY }: { empty?: string } = {}): string {
  const day = readDate(value);
  return day ? `${dayWords(day)}${day.time ? `, ${day.time}` : ''}` : empty;
}

/** "today", "in 9 days", "3 days ago", counted in calendar days against `today` (the viewer's calendar); '' when there is no date. */
export function formatRelative(value: DateInput, today: Date = new Date()): string {
  const day = readDate(value);
  if (!day) return '';
  const diff = (Date.UTC(day.year, day.month, day.date) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000;
  if (diff === 0) return 'today';
  const n = Math.abs(diff);
  const days = `${n} ${n === 1 ? 'day' : 'days'}`;
  return diff > 0 ? `in ${days}` : `${days} ago`;
}

// ── empty values and numbers ─────────────────────────────────────────────────
/** The value as text, or `empty` (default "—") when it is missing, blank or not a number. 0 is a value. */
export function orEmpty(value: string | number | null | undefined, empty: string = EMPTY): string {
  if (value == null) return empty;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : empty;
  return value.trim() ? value : empty;
}

/** "1,234": whole numbers with thousands separators. */
export function formatCount(n: number | null | undefined, empty: string = EMPTY): string {
  return isNum(n) ? COUNT.format(Math.round(n) || 0) : empty;                 // `|| 0`: a count that rounds to -0 would print "-0"
}

/** One decimal below 10, a whole number from 10 up, never a trailing ".0": 9.94 -> 9.9, 9.95 -> 10, 12.4 -> 12. (toFixed(1) says "9.9" for 9.95.) */
const shortNumber = (abs: number): number => (abs < 10 ? Math.round(abs * 10) / 10 : Math.round(abs));

/** "7.5%", "12%", "100%": `n` is already a percent (not a fraction); one decimal only below 10. */
export function formatPercent(n: number | null | undefined, empty: string = EMPTY): string {
  if (!isNum(n)) return empty;
  const shown = shortNumber(Math.abs(n));
  return `${n < 0 && shown !== 0 ? '-' : ''}${shown}%`;
}

const UNITS = ['', 'k', 'M', 'B', 'T'];

/** "999", "1k", "1.2k", "12k", "3.4M": a number in a tile. Rounding up into the next unit rolls over (999,600 is "1M", not "1000k"). */
export function formatCompact(n: number | null | undefined, empty: string = EMPTY): string {
  if (!isNum(n)) return empty;
  let v = Math.abs(n);
  let unit = 0;
  while (unit < UNITS.length - 1 && shortNumber(v) >= 1000) { v /= 1000; unit++; }
  const shown = shortNumber(v);
  return `${n < 0 && shown !== 0 ? '-' : ''}${shown}${UNITS[unit]}`;
}

// ── text ─────────────────────────────────────────────────────────────────────
/** A status word as a label: "in_remediation" -> "In remediation"; `empty` (default "—") when there is none. */
export function statusLabel(value: string | null | undefined, empty: string = EMPTY): string {
  const text = String(value ?? '').replace(/[_\s-]+/g, ' ').trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : empty;
}

/** A preview of `text` of at most `max` characters, the "…" included. It is cut at a word boundary when that keeps at least half of the
 *  room, else mid-word. `full` is what a tooltip or "show more" shows. Missing text is ''. */
export function truncate(text: string | null | undefined, max: number): { text: string; truncated: boolean; full: string } {
  const full = text ?? '';
  const limit = Math.max(1, Math.floor(max));
  if (full.length <= limit) return { text: full, truncated: false, full };
  const space = /\s+\S*$/.exec(full.slice(0, limit))?.index ?? -1;              // the last word boundary that fits
  let end = space >= limit / 2 ? space : limit - 1;                             // else a hard cut, leaving room for the "…"
  if ((full.charCodeAt(end - 1) & 0xfc00) === 0xd800) end--;                    // never half an emoji
  return { text: `${full.slice(0, end).trimEnd()}…`, truncated: true, full };
}

/** The "first two and +N" split of a list: the first `shown` items (default 2) come back as `shown`, the others as `rest`, and `more` is how many
 *  others there are (the N in "+N"). */
export function moreCount<T>(items: readonly T[] | null | undefined, shown: number = 2): { shown: T[]; rest: T[]; more: number } {
  const list = items ?? [];
  const n = Math.max(0, Math.floor(shown));
  const rest = list.slice(n);
  return { shown: list.slice(0, n), rest, more: rest.length };
}
