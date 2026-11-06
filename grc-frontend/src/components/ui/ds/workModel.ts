// What a WorkRow and a CountRow decide, apart from React so `node --test` can pin it (workModel.test.ts): the words and the tone of a due date, the
// accessible names of a row's action and menu, whether the title is a link, a button or plain text, and how a count and its change are read. The
// components are WorkRow.tsx and CountRow.tsx.
import { EMPTY, formatCount, formatDate, formatRelative, type DateInput } from '../../../lib/format.ts';

export type DueTone = 'danger' | 'warning' | 'neutral';

export interface DueBadge {
  /** The words: "Overdue by 3 days", "Due today", "Due in 4 days", "Due 12 Nov 2026", "No due date". */
  text: string;
  tone: DueTone;
  overdue: boolean;
}

/** Whole calendar days from `today` to `due` (negative: in the past), by the rules of formatRelative; null when `due` is not a date. */
export function daysUntil(due: DateInput, today: Date = new Date(), calendar: boolean = false): number | null {
  const relative = formatRelative(due, today, { calendar });
  if (!relative) return null;
  if (relative === 'today') return 0;
  const parts = /^(?:in (\d+) days?|(\d+) days? ago)$/.exec(relative);
  if (!parts) return null;
  return parts[1] !== undefined ? Number(parts[1]) : -Number(parts[2]);
}

const days = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * The due badge of a work row, in words (colour only backs them up). Thresholds are the Needs-my-action inbox's: today, tomorrow and up to three days
 * ahead are warm; four to seven are plain; further out is the date. `overdue` is the server's own flag when the page has one: left out, a day in the past
 * is overdue; `true` forces it (an SLA that breached with the date still ahead says just "Overdue"); `false` never flags it (a finished action whose date
 * has passed reads "Due 3 Nov 2026"). A missing or unreadable date is "No due date" (or "Overdue" when forced). `calendar` is for a field that means a
 * day although it arrives as a DateTime (a due date), as in lib/format.ts.
 */
export function dueBadge({ due, today = new Date(), calendar = false, overdue }: { due: DateInput; today?: Date; calendar?: boolean; overdue?: boolean }): DueBadge {
  const left = daysUntil(due, today, calendar);
  if (left === null) return overdue === true ? { text: 'Overdue', tone: 'danger', overdue: true } : { text: 'No due date', tone: 'neutral', overdue: false };
  const late = overdue === undefined ? left < 0 : overdue;
  if (late) return { text: left < 0 ? `Overdue by ${days(-left)}` : 'Overdue', tone: 'danger', overdue: true };
  if (left === 0) return { text: 'Due today', tone: 'warning', overdue: false };
  if (left === 1) return { text: 'Due tomorrow', tone: 'warning', overdue: false };
  if (left >= 2 && left <= 3) return { text: `Due in ${days(left)}`, tone: 'warning', overdue: false };
  if (left >= 4 && left <= 7) return { text: `Due in ${days(left)}`, tone: 'neutral', overdue: false };
  return { text: `Due ${formatDate(due, { calendar })}`, tone: 'neutral', overdue: false };
}

export type TitleControl = 'link' | 'button' | 'text';

/** What the title of a row is: a link when it has an address (that wins when both are given), a button when it only has something to run, else plain text
 *  (a row whose own controls are its action, its menu and its tick). */
export function titleControl({ href, onOpen }: { href?: string; onOpen?: () => void }): TitleControl {
  if (href) return 'link';
  return onOpen ? 'button' : 'text';
}

/** The name of a row's action for a screen reader: the visible word, then what it is about ("Approve: Information security policy"), because a list of
 *  fifty rows must not be fifty buttons called "Approve". The page's own `ariaLabel` wins and must contain the visible word (WCAG 2.5.3). */
export function actionName({ label, title, ariaLabel }: { label: string; title: string; ariaLabel?: string }): string {
  const own = ariaLabel?.trim();
  if (own) return own;
  const word = label.trim();
  const about = title.trim();
  return about ? `${word}: ${about}` : word;
}

/** The name of a row's menu button: "Actions for <title>" unless the page names it. */
export function menuName({ label, title }: { label?: string; title: string }): string {
  const own = label?.trim();
  if (own) return own;
  const about = title.trim();
  return about ? `Actions for ${about}` : 'Actions';
}

/** The title a row says: the words, or the dash when there are none (a row never has an empty heading line). */
export function rowTitle(title: string | null | undefined): string {
  return title?.trim() || EMPTY;
}

// ── a count ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A count as a row draws it: the true number with its separator ("1,247"); the dash when nothing is recorded (null, not a number). 0 is a count. */
export function countText(count: number | null | undefined): string {
  return typeof count === 'number' && Number.isFinite(count) ? formatCount(Math.max(0, count)) : EMPTY;
}

/** Whether a count is a recorded zero (drawn muted with a hollow dot). Not recorded is not zero. */
export function isZero(count: number | null | undefined): boolean {
  return typeof count === 'number' && Number.isFinite(count) && count === 0;
}

/** The change beside a count, in words: "+3 this week", "-2 this week", "No change this week". Nothing when there is no change to report (missing, not a
 *  number). It does not say whether up is good: only the page knows. */
export function deltaWords(delta: number | null | undefined, label?: string): string {
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return '';
  const tail = label?.trim() ? ` ${label.trim()}` : '';
  const whole = Math.round(delta);
  if (whole === 0) return `No change${tail}`;
  return `${whole > 0 ? '+' : '-'}${formatCount(Math.abs(whole))}${tail}`;
}
