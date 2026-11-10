// The Alerts register's definition (facets, quick chips, sorts, board) and the rules around one alert, apart from React (`alertModel.test.ts`). Monitoring is ONE record, a monitoring signal
// (TPRAMonitoringSignal), that used to be shown on four surfaces; the rows are `GET /vendor-risk/alerts?kinds=all` (every kind of signal, read whole, with `stage`: acknowledged is not closed).
// What a filter or a count MEANS is here, once; the facet engine and the frame are components/records.
import { buildSchema, type RegisterDef } from '../../../../components/records/registerModel.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import {
  ALERT_KINDS, KIND_ORDER, SEVERITY_ORDER, STAGE_ORDER, alertStage, signalKind, signalSeverity, type Stage,
} from '../../../../lib/statuses/vendorMonitoring.ts';

export interface AlertRow {
  id: number;
  vendor: { id: number; name: string; tier: string | null };
  /** the signal's kind (breach, adverse_media, vulnerability, security_rating, financial, sla, cert_expiry) */
  type: string;
  severity: string | null;
  title: string | null;
  source: string | null;
  occurred_at: string | null;
  /** the word older readers use (an acknowledged alert reads "closed" there): never read it for the register */
  status: string;
  stage: Stage;
  owner: { id: number; name: string | null } | null;
  verified: boolean;
  sources: number;
  researched: boolean;
  finding_id: number | null;
  acknowledged: boolean;
  triggered_reassessment: boolean;
}

export interface AlertsAnswer {
  items: AlertRow[];
  total: number;
  truncated: boolean;
  stage_counts: Record<string, number>;
}

export const NONE = 'none';

export const isAlertKind = (kind: string): boolean => (ALERT_KINDS as readonly string[]).includes(kind);
/** Still waiting for a decision: new, acknowledged or being investigated. */
export const needsDecision = (r: Pick<AlertRow, 'stage'>): boolean => r.stage === 'new' || r.stage === 'acknowledged' || r.stage === 'investigating';
export const isSevere = (r: Pick<AlertRow, 'severity'>): boolean => r.severity === 'critical' || r.severity === 'high';

/** What a title says when the feed gave none: "Rating change". */
export const titleOf = (r: Pick<AlertRow, 'title' | 'type'>): string => (r.title && r.title.trim()) || signalKind.label(r.type);

/** The moment a signal happened, in milliseconds (0 when it has none), for sorting. */
export const momentOf = (r: Pick<AlertRow, 'occurred_at'>): number => parseUtc(r.occurred_at)?.getTime() ?? 0;

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
/** Most severe first, then newest first, as one number (the old feed sorted severity-first on the 25 rows of a page: now over all of them). */
export const severityKey = (r: Pick<AlertRow, 'severity' | 'occurred_at'>): number => (SEV_RANK[r.severity ?? ''] ?? 5) * 1e13 + (1e13 - momentOf(r));

// ── the steps ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The moves of an alert (tpra/alerts.py MOVES): the same table the server checks, held to it by alertModel.test.ts. The drawer takes the server's own `moves` when it has them. */
export const MOVES: Readonly<Record<string, readonly string[]>> = {
  new: ['investigating', 'confirmed', 'not_relevant'],
  acknowledged: ['investigating', 'confirmed', 'not_relevant'],
  investigating: ['new', 'confirmed', 'not_relevant'],
  confirmed: ['investigating', 'closed'],
  not_relevant: ['investigating', 'closed'],
  closed: ['investigating'],
};
/** A decision says why (alerts.py NOTE_NEEDED). */
export const NEEDS_NOTE: readonly string[] = ['confirmed', 'not_relevant', 'closed'];
export const MOVE_LABEL: Readonly<Record<string, string>> = {
  new: 'Back to new', investigating: 'Investigate', confirmed: 'Confirm', not_relevant: 'Not relevant', closed: 'Close',
};
/** What the note asks. */
export const NOTE_ASK: Readonly<Record<string, string>> = { confirmed: 'What confirms it?', not_relevant: 'Why is it not relevant?', closed: 'What was done?' };
/** The one-line result of a move, for the toast. */
export const MOVED_SAYS: Readonly<Record<string, string>> = {
  new: 'is back to new', investigating: 'is being investigated', confirmed: 'is confirmed', not_relevant: 'is marked not relevant', closed: 'is closed',
};

/** What a person may do to a row without opening it. An alert kind can be acknowledged while it is new and taken on (investigate); the rest of its steps (which say why) are in its details.
 *  Every other kind of signal can be acknowledged, dismissed (nothing to act on) or raised as a finding. */
export type RowAction = 'acknowledge' | 'investigate' | 'dismiss' | 'raise_finding';
export function rowActions(row: Pick<AlertRow, 'type' | 'stage' | 'finding_id'>, can: { edit: boolean; raise: boolean }): RowAction[] {
  const out: RowAction[] = [];
  if (can.edit) {
    if (row.stage === 'new') out.push('acknowledge');
    if (isAlertKind(row.type)) { if (MOVES[row.stage]?.includes('investigating')) out.push('investigate'); }
    else if (row.stage !== 'not_relevant') out.push('dismiss');
  }
  if (!isAlertKind(row.type) && can.raise && !row.finding_id) out.push('raise_finding');
  return out;
}

// ── the register ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

export function alertDef(me: number | null): RegisterDef<AlertRow> {
  return {
    key: 'alert',
    noun: { one: 'alert', other: 'alerts' },
    idOf: (r) => r.id,
    text: (r) => [titleOf(r), r.vendor.name, r.source, signalKind.label(r.type), r.owner?.name, alertStage.label(r.stage)].filter(Boolean).join(' '),
    facets: [
      { key: 'stage', label: 'Status', defaultOpen: true, values: (r) => [r.stage], options: () => STAGE_ORDER.map((value) => ({ value, label: alertStage.label(value) })) },
      { key: 'kind', label: 'Kind', defaultOpen: true, values: (r) => [r.type], options: () => KIND_ORDER.map((value) => ({ value, label: signalKind.label(value) })) },
      { key: 'severity', label: 'Severity', defaultOpen: true, values: (r) => [r.severity ?? 'medium'], options: () => SEVERITY_ORDER.map((value) => ({ value, label: signalSeverity.label(value) })) },
      {
        key: 'tier', label: 'Supplier tier',
        values: (r) => [r.vendor.tier ? r.vendor.tier.toLowerCase() : NONE],
        options: () => [...['critical', 'high', 'medium', 'low'].map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })), { value: NONE, label: 'Not tiered' }],
      },
      {
        key: 'owner', label: 'With', searchable: true, limit: 7,
        values: (r) => [r.owner ? String(r.owner.id) : NONE],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((r) => { if (r.owner) seen.set(String(r.owner.id), r.owner.name || `Someone no longer here`); });
          const list = Array.from(seen.entries()).map(([value, label]) => ({ value, label })).sort(byLabel);
          return list.concat({ value: NONE, label: 'Nobody yet' });
        },
      },
      { key: 'reassess', label: 'Reassessment', values: (r) => [r.triggered_reassessment ? 'yes' : 'no'], options: () => [{ value: 'yes', label: 'Triggered one' }, { value: 'no', label: 'Did not' }] },
      { key: 'proof', label: 'Verification', values: (r) => [r.verified ? 'verified' : 'unverified'], options: () => [{ value: 'verified', label: 'Verified' }, { value: 'unverified', label: 'Unverified' }] },
    ],
    quick: [
      { key: 'open', label: 'Needs a decision', test: (r) => needsDecision(r), title: 'New, acknowledged or being investigated' },
      { key: 'new', label: 'New', test: (r) => r.stage === 'new', title: 'Not acknowledged and not taken on' },
      ...(me != null ? [{ key: 'mine', label: 'With me', test: (r: AlertRow) => r.owner?.id === me, title: 'Alerts you are investigating' }] : []),
      { key: 'reassess', label: 'Reassessment', test: (r) => r.triggered_reassessment, title: 'Signals that reopened a supplier\'s assessment' },
      { key: 'severe', label: 'Critical or high, open', test: (r) => needsDecision(r) && isSevere(r) },
    ],
    sorts: [
      { key: 'severity', label: 'Severity (worst first)', firstDir: 'asc', value: (r) => severityKey(r) },
      { key: 'occurred', label: 'Date', firstDir: 'desc', value: (r) => momentOf(r) },
      { key: 'vendor', label: 'Supplier', firstDir: 'asc', value: (r) => r.vendor.name },
      { key: 'stage', label: 'Status', firstDir: 'asc', value: (r) => STAGE_ORDER.indexOf(r.stage) },
      { key: 'kind', label: 'Kind', firstDir: 'asc', value: (r) => signalKind.label(r.type) },
    ],
    defaultSort: { key: 'severity', dir: 'asc' },
    board: {
      label: 'Alerts by status',
      columns: STAGE_ORDER.map((id) => ({ id, label: alertStage.label(id), test: (r: AlertRow) => r.stage === id })),
    },
    pageSize: 25,
  };
}

/** Defined once, outside any component (the address hook reads the address again for a new schema). A person is in a chip's key, so the schema is built with one. */
export const ALERT_SCHEMA = buildSchema(alertDef(0));

// ── the number the page says ─────────────────────────────────────────────────────────────────────────────────────────────

/** "7 new · 3 investigating": the head line, over the rows read (the server's stage counts say the same over what it holds). */
export function headLine(total: number, counts: Record<string, number>): string {
  const bits = [`${total.toLocaleString('en-GB')} ${total === 1 ? 'alert' : 'alerts'}`];
  const say = (stage: string, word: string) => { if ((counts[stage] ?? 0) > 0) bits.push(`${counts[stage].toLocaleString('en-GB')} ${word}`); };
  say('new', 'new'); say('acknowledged', 'acknowledged'); say('investigating', 'investigating');
  return bits.join(' · ');
}

// ── links that existed before ────────────────────────────────────────────────────────────────────────────────────────────

/** The address of the old Breach alerts page (`/alerts?alert=41`, in e-mails, reminders and the Attention queue) as the register's (`?id=41`): the query string to go to, or null when the
 *  address has nothing to change. Every other param stays where it is. */
export function registerAddress(search: string): string | null {
  const query = new URLSearchParams(search);
  if (!query.has('alert')) return null;
  const id = /^\d+$/.test((query.get('alert') ?? '').trim()) ? (query.get('alert') ?? '').trim() : '';
  query.delete('alert');
  if (id) query.set('id', id);
  return query.toString();
}

/** The periods the register can read (days), the first is the one it opens with. */
export const PERIODS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 365, label: 'Last 12 months' }, { days: 90, label: 'Last 90 days' }, { days: 1825, label: 'Last 5 years' },
];
export const periodLabel = (days: number): string => PERIODS.find((p) => p.days === days)?.label ?? 'Last 12 months';

// ── what the drawer says ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A source's date as a feed writes it ("20261105T143000Z") as the day it names ("2026-11-05"), or null when it is not one. */
export function seenOn(raw: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(raw ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const WORDS: Record<string, string> = {
  create: 'Recorded', research: 'Researched by AI', update: 'Updated', dismiss: 'Dismissed: nothing to act on', raise_finding: 'Raised as a finding', verify: 'Verified from outside', reject: 'Ruled out as not about this supplier',
};
/** One line of a signal's history in words: "New → Investigating", "Researched by AI". */
export function historyWords(h: { action: string; from: string | null; to: string | null }): string {
  if (h.action === 'triage') return `${alertStage.label(h.from || 'new')} → ${alertStage.label(h.to || 'new')}`;
  return WORDS[h.action] ?? (h.action.charAt(0).toUpperCase() + h.action.slice(1).replace(/_/g, ' '));
}

/** What the AI's reading says about whether our data is involved. */
export const AFFECTS: Readonly<Record<string, string>> = {
  likely: 'Our data is likely involved', possible: 'Our data may be involved', unlikely: 'Our data is unlikely to be involved', unknown: 'Whether our data is involved is not stated',
};
