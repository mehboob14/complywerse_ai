// The Work queue (the 23-condition queue of GET /vendor-risk/tpra/attention) as the Overview and its own page read it: the shapes of the answer, what each action is called in the
// history ("added a note"), and the arithmetic of a snooze date. Pure, so `node --test` runs attentionModel.test.ts against it. The queue is NOT the Overview's "Vendors by next step"
// card: that one counts vendors by the one thing each waits on (10 codes, backend routers/vendors.py), this one counts items (23 conditions, tpra/attention.py), so its number is higher.

export type QueueView = 'open' | 'snoozed' | 'closed';
export type QueueAction = 'note' | 'assign' | 'snooze' | 'unsnooze' | 'close' | 'reopen';
/** The four actions that ask for something before they run. */
export type QueueForm = 'note' | 'assign' | 'snooze' | 'close';

export interface QueueItem {
  key: string;
  condition: string;
  label: string;
  record_type: string;
  record_id: number;
  vendor_id: number;
  vendor_name: string;
  vendor_tier: string | null;
  owner_name: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  title: string;
  badge: string;
  tone: 'red' | 'amber';
  /** the day the thing began (YYYY-MM-DD) */
  since: string;
  link: string;
  snoozed_until: string | null;
  snooze_reason: string | null;
  state: QueueView;
}

export interface QueueAnswer {
  items: QueueItem[];
  counts: { open: number; urgent: number; snoozed: number; closed: number };
  conditions: Record<string, string>;
  can_act: boolean;
  assignees: Array<{ id: number; name: string }>;
}

export interface QueueActivity {
  id: number;
  action: QueueAction;
  text: string | null;
  actor_name: string | null;
  assignee_name: string | null;
  created_at: string | null;
}

/** What the person did, as the page says it afterwards ("You added a note") and as the history lists it ("Dana added a note"). */
export const DID: Record<QueueAction, string> = {
  note: 'added a note', assign: 'assigned it', snooze: 'snoozed it', unsnooze: 'woke it up', close: 'closed it', reopen: 'reopened it',
};

/** The sentence one history row starts with. */
export function didWhat(a: Pick<QueueActivity, 'action' | 'assignee_name'>): string {
  return a.action === 'assign' ? (a.assignee_name ? `assigned it to ${a.assignee_name}` : 'unassigned it') : DID[a.action];
}

/** The words of the button and the field of each form action. */
export const FORM_WORDS: Record<QueueForm, { title: string; field: string; submit: string }> = {
  note: { title: 'Add a note', field: 'Note', submit: 'Add note' },
  assign: { title: 'Assign', field: 'Note for them (optional)', submit: 'Assign' },
  snooze: { title: 'Snooze', field: 'Why it can wait', submit: 'Snooze' },
  close: { title: 'Close', field: 'Closing note', submit: 'Close item' },
};

/** A snooze date: the server takes a day from tomorrow to a year from today, on the UTC calendar it judges dates by. */
export function snoozeDay(offsetDays: number, now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
  return d.toISOString().slice(0, 10);
}

export const SNOOZE_DEFAULT_DAYS = 7;
export const SNOOZE_MAX_DAYS = 365;

/** How many items each condition holds in a list (the filter chips of the page). */
export function perCondition(items: readonly Pick<QueueItem, 'condition'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  items.forEach((i) => { out[i.condition] = (out[i.condition] ?? 0) + 1; });
  return out;
}

/** The empty-list sentence of each view. */
export const EMPTY: Record<QueueView, string> = {
  open: 'Nothing needs attention right now.',
  snoozed: 'Nothing is snoozed.',
  closed: 'Nothing is closed. Closed items that are still true show here, so they can be reopened.',
};
