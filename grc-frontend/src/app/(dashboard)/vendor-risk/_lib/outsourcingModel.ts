// The outsourcing steps on a vendor's lifecycle (EBA/GL/2019/02, SBP outsourcing framework): what the rail says about materiality, the
// exit plan, sub-outsourcing and the regulator's notice, and what the forms and the loss-event dialog accept. Mirrors
// backend vendor_risk/tpra/outsourcing.py. Pure, so `node --test "src/app/(dashboard)/vendor-risk/_lib/outsourcingModel.test.ts"` runs.
import type { Tone } from '../_ui/tones.ts';

interface Stamp { by?: number | null; at?: string | null }
export interface SubOutsourcer {
  id: number; name: string; service?: string | null; location?: string | null;
  approval_status?: 'pending' | 'approved' | 'rejected' | null; created_by?: number | null;
}
export interface Outsourcing {
  critical_important: boolean | null;
  materiality?: ({ reason?: string | null } & Stamp) | null;
  exit_plan?: ({ status?: string | null; summary?: string | null; link?: string | null } & Stamp) | null;
  regulator?: ({ required?: boolean | null; sent_on?: string | null; reference?: string | null } & Stamp) | null;
  sub_outsourcers?: SubOutsourcer[];
  /** set on a materiality save that sent an approved scope back to its Approval stage */
  approval_reopened?: { assessment_id: number; stage: string } | null;
}

export const MIN_REASON = 10;
export const EXIT_STATUSES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'draft', label: 'Draft' }, { value: 'approved', label: 'Approved' }, { value: 'tested', label: 'Tested' },
];
const IN_PLACE = ['approved', 'tested'];

export const materialityWord = (ci: boolean | null | undefined): string =>
  ci === true ? 'Critical or important' : ci === false ? 'Not critical or important' : 'Not classified';

export type RailKey = 'materiality' | 'exit_plan' | 'sub_outsourcing' | 'regulator';
export interface RailRow { key: RailKey; label: string; value: string; tone: Tone; open: boolean }

const row = (key: RailKey, label: string, value: string, tone: Tone, open = false): RailRow => ({ key, label, value, tone, open });

/** The four lines the lifecycle shows. Past materiality, a scope that is not critical or important needs none of them. */
export function outsourcingRows(o: Outsourcing | null | undefined): RailRow[] {
  const ci = o?.critical_important ?? null;
  const out = [row('materiality', 'Materiality', materialityWord(ci), ci === null ? 'warning' : ci ? 'danger' : 'neutral', ci === null)];
  if (ci !== true) {   // unclassified: the answer decides whether these are owed, so do not say "not required" yet
    const word = ci === null ? 'Depends on materiality' : 'Not required';
    return [...out, ...(['exit_plan', 'sub_outsourcing', 'regulator'] as const).map((k) => row(k, LABEL[k], word, 'neutral'))];
  }
  const plan = o?.exit_plan?.status ?? null;
  const exitRow = plan && IN_PLACE.includes(plan)
    ? row('exit_plan', LABEL.exit_plan, plan === 'tested' ? 'Tested' : 'Approved', 'success')
    : row('exit_plan', LABEL.exit_plan, plan === 'draft' ? 'Draft' : 'None yet', 'warning', true);
  const subs = o?.sub_outsourcers ?? [];
  const waiting = subs.filter((s) => s.approval_status === 'pending').length;
  const rejected = subs.filter((s) => s.approval_status === 'rejected').length;
  const subRow = rejected ? row('sub_outsourcing', LABEL.sub_outsourcing, `${rejected} rejected`, 'danger', true)
    : waiting ? row('sub_outsourcing', LABEL.sub_outsourcing, `${waiting} waiting`, 'warning', true)
      : row('sub_outsourcing', LABEL.sub_outsourcing, subs.length ? `${subs.length} approved` : 'None listed', 'success');
  const notice = o?.regulator;
  const required = notice?.required ?? null;
  const noticeRow = required === null ? row('regulator', LABEL.regulator, 'Not decided', 'warning', true)
    : required === false ? row('regulator', LABEL.regulator, 'Not required', 'neutral')
      : notice?.sent_on ? row('regulator', LABEL.regulator, `Sent ${notice.sent_on}`, 'success')
        : row('regulator', LABEL.regulator, 'Due before go-live', 'warning', true);
  return [...out, exitRow, subRow, noticeRow];
}
const LABEL: Record<RailKey, string> = {
  materiality: 'Materiality', exit_plan: 'Exit plan', sub_outsourcing: 'Sub-outsourcing', regulator: 'Regulator notice',
};

export const openRows = (o: Outsourcing | null | undefined): number => outsourcingRows(o).filter((r) => r.open).length;

// ── what the forms accept (the server says the same) ─────────────────────────

export const reasonReady = (reason: string): boolean => reason.trim().length >= MIN_REASON;

/** Whether saving this answer changes the classification, which sends an approved scope back to approval (set_materiality):
 *  a saved answer turned the other way; a first answer is not a change. */
export const materialityChanges = (saved: boolean | null | undefined, chosen: boolean | null): boolean =>
  saved != null && chosen !== null && saved !== chosen;

/** An exit plan in place (approved or tested) is written down: a summary or a link. */
export const exitPlanReady = (status: string, summary: string, link: string): boolean =>
  !!status && (!IN_PLACE.includes(status) || !!summary.trim() || /^https?:\/\/\S+$/.test(link.trim())) &&
  (!link.trim() || /^https?:\/\/\S+$/.test(link.trim()));

/** A notice is never dated in the future; `today` is "YYYY-MM-DD". */
export const noticeReady = (required: boolean | null, sentOn: string, today: string): boolean =>
  required !== null && (!required || !sentOn || sentOn <= today);

/** A critical or important outsourcing is approved by a committee at a meeting; deferring or rejecting needs none. */
export const needsMeeting = (ci: boolean | null | undefined, decision: string): boolean => ci === true && decision.startsWith('approve');

// ── a vendor incident as a loss event ────────────────────────────────────────

const amount = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/** Gross less recoveries, never below zero; null while there is no gross figure. */
export function netLoss(gross: string, recoveries: string): number | null {
  const g = amount(gross);
  if (g === null || !Number.isFinite(g)) return null;
  const r = amount(recoveries) ?? 0;
  return Math.max(0, g - (Number.isFinite(r) ? r : 0));
}

/** What stops the loss event being recorded, or null: amounts are numbers at or above zero, and money has a currency. */
export function lossEventProblem(gross: string, recoveries: string, currency: string): string | null {
  const g = amount(gross), r = amount(recoveries);
  if ((g !== null && !(g >= 0)) || (r !== null && !(r >= 0))) return 'Amounts are numbers, zero or more.';
  if ((g !== null || r !== null) && !/^[A-Za-z]{3}$/.test(currency.trim())) return 'Give the currency, such as USD.';
  return null;
}
