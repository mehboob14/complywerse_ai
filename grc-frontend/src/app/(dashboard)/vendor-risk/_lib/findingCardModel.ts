// What the findings cards work out from the server's story of a finding: whether it is open, what is due and whether that is late,
// whether closing it needs a note, the words for its source and treatment. Pure, so `node --test` runs findingsModel.test.ts against it.

import { fmt } from '../_ui/fmt.ts';
import type { Tone } from '../_ui/tones.ts';

export const OPEN_STATUSES = ['open', 'in_remediation'] as const;

/** Still work: raised, or being worked. Accepted is a decision, closed is done. */
export const isOpen = (status?: string | null): boolean => (OPEN_STATUSES as readonly string[]).includes(String(status));
export const isSettled = (status?: string | null): boolean => status === 'closed' || status === 'accepted';

/** Where a finding came from (the server's `source`), in the words a person reads. */
export const SOURCE_LABEL: Record<string, string> = {
  assessment: 'Assessment', manual: 'Manual', sla_breach: 'Service level', signal: 'Signal',
  document_review: 'Document review', offboarding: 'Offboarding',
};
export const sourceLabel = (source?: string | null): string => SOURCE_LABEL[String(source)] ?? fmt.status(source);

/** What is being done about it. */
export const TREATMENT_LABEL: Record<string, string> = { remediate: 'Remediate', mitigate: 'Mitigate', transfer: 'Transfer', accept: 'Accept' };
export const treatmentLabel = (treatment?: string | null): string => TREATMENT_LABEL[String(treatment)] ?? fmt.status(treatment);

interface Closable { severity?: string | null; is_blocking?: boolean | null; is_critical_control_fail?: boolean | null; fix_done?: boolean | null }

/** A critical or blocking finding (a failed critical control is both) is closed with a note on how it was resolved. */
export const noteRequired = (f: Closable): boolean =>
  f.severity === 'critical' || !!f.is_blocking || !!f.is_critical_control_fail;

/** Why the Close dialog asks for the note, or null when it may be left empty: a fix on record is evidence enough. */
export function closeNeeds(f: Closable): string | null {
  if (noteRequired(f)) return 'Required for a critical or blocking finding.';
  if (!f.fix_done) return 'Required when no fix is recorded.';
  return null;
}

/** An acceptance of a critical or high finding runs to a date; for the others the date may be left open. */
export const acceptNeedsDate = (severity?: string | null): boolean => severity === 'critical' || severity === 'high';

interface Dated { status?: string | null; due_date?: string | null; sla_due?: string | null }

/** When the fix is due and whether that is late. The date is the fix under way's, else the end of the policy's window for the
 *  severity. Only a finding still open is due: a closed or accepted one is not chased. */
export function dueOf(f: Dated, today: Date = new Date()): { date: string | null; text: string; overdue: boolean } {
  const date = f.due_date || f.sla_due || null;
  if (!date || !isOpen(f.status)) return { date: null, text: '', overdue: false };
  const when = fmt.countdown(date, today);
  return { date, text: when ? `due ${when}` : '', overdue: when.endsWith(' ago') };
}

/** "3 blocking the approval gate", or null when none do. */
export function blockingLine(items: Array<{ status?: string | null; is_blocking?: boolean | null }>, total?: number): string | null {
  const n = total ?? items.filter((f) => isOpen(f.status) && f.is_blocking).length;
  return n > 0 ? `${n} blocking the approval gate` : null;
}

/** The calendar day `offset` days from `from`, as the YYYY-MM-DD a date field takes (the viewer's own day). */
export function isoDay(offset = 0, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A signal's decision: new waits for one, acknowledged was seen, dismissed was ruled out. */
export type SignalStatus = 'new' | 'acknowledged' | 'dismissed';
export const SIGNAL_STATUS: Record<SignalStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'warning' },
  acknowledged: { label: 'Acknowledged', tone: 'success' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};
export const signalStatus = (s: { status?: string | null; acknowledged?: boolean | null }): SignalStatus =>
  s.status === 'dismissed' || s.status === 'acknowledged' || s.status === 'new' ? s.status : s.acknowledged ? 'acknowledged' : 'new';

/** How many signals wait on a decision, as the panel's description. */
export const waitingLine = (signals: Array<{ status?: string | null; acknowledged?: boolean | null }>): string | null => {
  const n = signals.filter((s) => signalStatus(s) === 'new').length;
  return n > 0 ? `${n} waiting on a decision` : null;
};

/** What kind of signal, in the words a person reads. */
export const SIGNAL_TYPE_LABEL: Record<string, string> = {
  breach: 'Breach', adverse_media: 'Adverse news', security_rating: 'Rating change', financial: 'Financial', sla: 'Service level',
  cert_expiry: 'Certificate lapsed', vulnerability: 'Vulnerability',
};
export const signalTypeLabel = (type?: string | null): string => SIGNAL_TYPE_LABEL[String(type)] ?? fmt.status(type);
