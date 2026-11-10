// What the yearly Check-ins page works out from what the server gives (GET /vendor-risk/checkins: a row per supplier with the state of its yearly check-in and the counts): the five views, the
// words for how far away a due date is, the page's address (state, scope, q, vendor) and when a check-in may be saved. Pure, so `node --test` runs checkinsModel.test.ts against it. The state of a
// check-in (overdue, due soon, upcoming, done) is the server's; the page never works it out again.
import { integer, oneOf, text, type Schema } from '../../../../lib/addressState.ts';

export type CheckinState = 'overdue' | 'due_soon' | 'upcoming' | 'done';
export interface CheckinRow {
  vendor_id: number; name: string; tier: string | null; owner: { id: number; name: string | null } | null;
  last: { at: string; by: string | null; changed: boolean } | null;
  due_date: string; state: CheckinState; days: number; can_check_in: boolean;
}
export interface CheckinBoard { items: CheckinRow[]; counts: Record<CheckinState, number>; every_days: number }
export interface PastCheckin {
  id: number; completed_at: string; by: string | null; on_time: boolean; still_owner: boolean; new_owner: string | null;
  changed: boolean; change_notes: string | null; contact_current: boolean; contact_update: Record<string, string> | null;
}
export interface CheckinHistory {
  vendor: { id: number; name: string; owner_id: number | null; owner: string | null; primary_contact_name: string | null; primary_contact_email: string | null; primary_contact_phone: string | null };
  due_date: string; state: string; can_check_in: boolean; items: PastCheckin[];
}

export const STATES: readonly CheckinState[] = ['overdue', 'due_soon', 'upcoming', 'done'];
export type ShowKey = CheckinState | 'all';
export const SHOWS: ReadonlyArray<{ key: ShowKey; label: string }> = [
  { key: 'overdue', label: 'Overdue' }, { key: 'due_soon', label: 'Due within 30 days' }, { key: 'upcoming', label: 'Upcoming' }, { key: 'done', label: 'Done recently' }, { key: 'all', label: 'All' },
];

/** `?state=due_soon&scope=all&q=acme&vendor=7`. `vendor` opens that supplier's check-in (a reminder or the attention queue links to it). The default is the people's own overdue ones. */
export const CHECKIN_SCHEMA: Schema = {
  state: oneOf(SHOWS.map((s) => s.key), 'overdue'),
  scope: oneOf(['mine', 'all'] as const, 'mine'),
  q: text(),
  vendor: integer(0, { min: 1 }),
};

export const rowsFor = (items: readonly CheckinRow[], show: ShowKey): CheckinRow[] => items.filter((r) => show === 'all' || r.state === show);

/** How far away a due date is: "3 days overdue", "due today", "in 12 days". */
export const when = (days: number): string => (days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'due today' : `in ${days} day${days === 1 ? '' : 's'}`);

/** "once a year" or "every 180 days": the cadence the policy sets. */
export const cadence = (everyDays?: number): string => (everyDays && everyDays !== 365 ? `every ${everyDays} days` : 'a year');

export interface Answers { stillOwner: boolean | null; newOwner: number | ''; changed: boolean | null; notes: string; contactOk: boolean | null }
export const NOTES_MIN = 10;

/** A check-in may be saved when all three questions are answered, a new owner is named if the owner changed, and a change is described in words. */
export const ready = (a: Answers): boolean => a.stillOwner !== null && a.changed !== null && a.contactOk !== null && (a.stillOwner || !!a.newOwner) && (!a.changed || a.notes.trim().length >= NOTES_MIN);
