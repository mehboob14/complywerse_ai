// What the Issue & Incident Overview v2 decides on top of overviewModel / chartModel, apart from React so `node --test` pins it (v2Model.test.ts): the address the page keeps (which view of the
// twelve-month card, whether the score sheet and the full work list are open), where each graphic opens, and the slim "My work" card (its header, its three rows, how a due date reads in one line).
// Every address here is one the registers already read (`?quick=`, `?state=`, `?severity=`, `?assignee=`, `?sort=key:dir`: components/records/registerModel.ts buildSchema); the register has no
// age filter, so a cell of "Open by severity and age" opens that severity's open issues, oldest first.
import { dueBadge } from '../../../../components/ui/ds/workModel.ts';
import { flag, oneOf } from '../../../../lib/addressState.ts';
import type { Tone } from '../../../../lib/status.ts';
import { urgencyOf, type WorkItem } from './overviewModel.ts';

// ── what the address keeps (Overview rule R7: what changes what the page shows lives in the address) ──────────────

export const TRENDS = ['flow', 'backlog'] as const;
export type Trend = (typeof TRENDS)[number];
/** `?trend=backlog`: the open backlog instead of raised and closed; `?work=1`: the full work list in its sheet; `?score=1`: the score sheet. The defaults have the plain address. */
export const ADDRESS = { trend: oneOf(TRENDS, 'flow'), work: flag(), score: flag() };
export const TREND_LABEL: Record<Trend, string> = { flow: 'Raised and closed', backlog: 'Open backlog' };

// ── where the graphics open ───────────────────────────────────────────────────────────────────────────────────────────

const REGISTER = '/issues/register';
export const LINKS = {
  register: REGISTER,
  open: `${REGISTER}?quick=open`,
  closed: `${REGISTER}?state=closed`,
  actions: '/issues/actions',
  lateActions: '/issues/actions?quick=late',
  incidents: '/erm/incidents',
  openIncidents: '/erm/incidents?quick=open',
  owners: `${REGISTER}?quick=open&sort=assignee:asc`,
} as const;

/** A cell of "Open by severity and age": the open issues of that severity ('none' is the register's own "No severity"), the oldest first. */
export const ageHref = (severity: string): string => `${REGISTER}?quick=open&severity=${encodeURIComponent(severity)}&sort=created:asc`;

/** A share of a whole as a whole percent for a tile's bar; null when there is no whole (nothing open is not 0%). */
export function shareOf(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

// ── the slim "My work" (Overview rule R3) ─────────────────────────────────────────────────────────────────────────────

/** Three one-line rows on the page; the rest is one press away in the sheet. */
export const WORK_ROWS = 3;

export interface WorkHead { count: number; overdue: number }
export const workHead = (items: readonly Pick<WorkItem, 'overdue'>[]): WorkHead => ({ count: items.length, overdue: items.filter((i) => i.overdue).length });

/** A due date in the few characters a one-line row has ("Overdue 200d", "Due in 2d", "Due today"): the word is always there, the tone only backs it up. null: no date. */
export function shortDue(item: Pick<WorkItem, 'due' | 'overdue' | 'calendar'>, today: Date): { text: string; tone: Tone } | null {
  if (!item.due && !item.overdue) return null;
  const b = dueBadge({ due: item.due, overdue: item.overdue, calendar: item.calendar, today });
  return { text: b.text.replace(/^Overdue by (\d+) days?$/, 'Overdue $1d').replace(/^Due in (\d+) days?$/, 'Due in $1d'), tone: b.tone };
}

/** The first `limit` items (the list is already most urgent first) and what the header and the "See all" link say. */
export function slimWork(items: readonly WorkItem[], now: Date, limit = WORK_ROWS): { rows: Array<{ item: WorkItem; due: ReturnType<typeof shortDue>; urgency: ReturnType<typeof urgencyOf> }>; head: WorkHead; cut: boolean } {
  return { rows: items.slice(0, Math.max(1, limit)).map((item) => ({ item, due: shortDue(item, now), urgency: urgencyOf(item, now) })), head: workHead(items), cut: items.length > limit };
}

/** The name of a row's link for a screen reader: what it is, then where it stands ("Issue: Fire exit signage missing, overdue"). */
export const rowName = (title: string, due: { text: string } | null): string => (due ? `${title}, ${due.text.toLowerCase()}` : title);

/** What a part needs to know about a request: waiting, failed (with no data to show), the words of the failure and how to ask again. */
export interface FeedStatus { isPending: boolean; isError: boolean; hasData: boolean; error: unknown; refetch: () => unknown }
