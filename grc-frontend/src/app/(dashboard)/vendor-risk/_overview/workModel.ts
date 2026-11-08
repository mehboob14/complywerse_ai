// "My work" on the Overview, apart from React so `node --test` pins it (workModel.test.ts): the person's own work in this module, composed from three requests that already exist, ONE ROW EACH
// and the most urgent first. Nothing is computed that a source did not say: a row is in the list because a source put it there.
//   the Work queue   GET /vendor-risk/tpra/attention?scope=mine   items the person owns or was assigned (tone red = already late)
//   requests         the dashboard's `intake_pending`             onboarding requests waiting for a decision (the whole tenant's: a request has no owner until someone takes it)
//   planned actions  GET /vendor-risk/actions?state=due&scope=mine  the person's own actions that are due now
// Order: late first (a red queue item, an action past its day), then the requests, then the actions due today, then the queue's other items; the oldest first inside each.
import { formatDate } from '../../../../lib/format.ts';
import type { Tone } from '../../../../lib/status.ts';
import { vendorTier } from '../../../../lib/statuses/vendor.ts';
import type { QueueItem } from '../_lib/attentionModel.ts';

export interface RequestLike { id: number; name: string; requested_by: string | null; submitted_at: string | null; duplicate: boolean }
export interface ActionLike {
  id: number; vendor: { id: number; name: string | null }; kind_label: string; title: string; due_on: string; overdue_days: number; engagement?: { name: string | null } | null;
}

export interface WorkItem {
  key: string;
  kind: { label: string; tone: Tone };
  title: string;
  href: string;
  /** what it is about, as text (a row's context takes no link) */
  context: string;
  requester?: { name: string; role: string };
  /** a day (YYYY-MM-DD): the planned action's own */
  due?: string;
  overdue?: boolean;
  action: { label: string; href: string };
  /** already late: counted as "N overdue" over the list */
  late: boolean;
  rank: number;
  /** the day it began or is due: the oldest first inside a rank */
  at: string;
}

const REGISTER = '/vendor-risk/vendors';
const LATE = 0;
const REQUEST = 1;
const DUE = 2;
const OTHER = 3;

const day = (v: string | null | undefined): string => (v ?? '').slice(0, 10);

export function queueWork(i: QueueItem): WorkItem {
  const tier = i.vendor_tier ? `${vendorTier.label(i.vendor_tier)} tier` : '';
  const late = i.tone === 'red';
  return {
    key: `queue:${i.key}`,
    kind: { label: i.label, tone: late ? 'danger' : 'warning' },
    title: i.title,
    href: i.link,
    context: [i.badge, tier, i.assignee_name ? `Assigned to ${i.assignee_name}` : '', i.since ? `since ${formatDate(i.since)}` : ''].filter(Boolean).join(' · '),
    action: { label: 'Open', href: i.link },
    late, rank: late ? LATE : OTHER, at: day(i.since),
  };
}

export function requestWork(r: RequestLike): WorkItem {
  return {
    key: `request:${r.id}`,
    kind: { label: 'Request', tone: 'pending' },
    title: r.name,
    href: `/vendor-risk/intake/${r.id}`,
    context: [r.submitted_at ? `Sent ${formatDate(r.submitted_at)}` : '', r.duplicate ? 'May be a duplicate' : ''].filter(Boolean).join(' · '),
    requester: r.requested_by ? { name: r.requested_by, role: 'Asked by' } : undefined,
    action: { label: 'Review', href: `/vendor-risk/intake/${r.id}` },
    late: false, rank: REQUEST, at: day(r.submitted_at),
  };
}

export function actionWork(a: ActionLike): WorkItem {
  const late = a.overdue_days > 0;
  return {
    key: `action:${a.id}`,
    kind: { label: a.kind_label || 'Planned action', tone: 'progress' },
    title: a.title,
    href: `${REGISTER}/${a.vendor.id}?tab=actions`,
    context: [a.vendor.name || 'A vendor', a.engagement?.name ?? ''].filter(Boolean).join(' · '),
    due: a.due_on, overdue: late,
    action: { label: 'Open', href: `${REGISTER}/${a.vendor.id}?tab=actions` },
    late, rank: late ? LATE : DUE, at: day(a.due_on),
  };
}

/** The list: every source's rows, urgent first, the oldest first inside a rank, ties by title so the order never shuffles between two loads. */
export function buildWork(sources: { queue?: readonly QueueItem[]; requests?: readonly RequestLike[]; actions?: readonly ActionLike[] }): WorkItem[] {
  const rows = (sources.queue ?? []).map(queueWork).concat((sources.requests ?? []).map(requestWork), (sources.actions ?? []).map(actionWork));
  return rows.sort((a, b) => a.rank - b.rank || a.at.localeCompare(b.at) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

/** "12 items · 3 overdue" for the card's header. */
export const lateCount = (rows: readonly WorkItem[]): number => rows.filter((r) => r.late).length;
