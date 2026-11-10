// The contract drawer's form, apart from React so `node --test` pins it (contractForm.test.ts): the text form a contract is edited as, the payload it becomes (clauses are saved by their
// own endpoint, before the terms), what changed, the last day to give notice, and how a history row is said in words. Nothing here is new: it is what ContractDrawer.tsx did inline.
import type { ContractRow, HistoryRow, RenewalType } from './shared.ts';
import { CONTRACT_TYPES, FIELD_LABEL, RENEWAL_LABEL, STATUS_LABEL } from './shared.ts';
import { formatDate } from '../../../../../lib/format.ts';

export const PRICE_KEYS = ['unit_price', 'included_units', 'overage_price', 'one_time_fees', 'price_cap_pct'] as const;
export const PRICE_LABEL: Record<(typeof PRICE_KEYS)[number], string> = {
  unit_price: 'Price per unit or seat', included_units: 'Units included', overage_price: 'Price per extra unit',
  one_time_fees: 'One-off fees', price_cap_pct: 'Cap on yearly price rises (%)',
};

export type YesNo = '' | 'yes' | 'no';
export type Form = {
  title: string; contract_type: string; status: string; reference: string; record_link: string;
  effective_date: string; renewal_date: string; expiry_date: string; renewal_type: string; notice_days: string;
  annual_value: string; currency: string; billing: string; termination: string; terms: string;
  unit_price: string; included_units: string; overage_price: string; one_time_fees: string; price_cap_pct: string;
  uplift: YesNo;
  right_to_audit: YesNo; subprocessor_terms: YesNo; exit_data_return: YesNo; security_addendum: YesNo;
  breach_notification_hours: string;
  engagement_id: string;      // '' is the whole supplier
};

export const EMPTY: Form = {
  title: '', contract_type: 'master', status: 'active', reference: '', record_link: '', effective_date: '',
  renewal_date: '', expiry_date: '', renewal_type: '', notice_days: '', annual_value: '', currency: '', billing: '',
  termination: '', terms: '', unit_price: '', included_units: '', overage_price: '', one_time_fees: '',
  price_cap_pct: '', uplift: '', right_to_audit: '', subprocessor_terms: '', exit_data_return: '', security_addendum: '',
  breach_notification_hours: '', engagement_id: '',
};

// Saved by their own endpoint (tpra/contracts.py), before the terms.
export const CLAUSE_KEYS = ['right_to_audit', 'subprocessor_terms', 'exit_data_return', 'security_addendum', 'breach_notification_hours'];

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const yesNo = (v: boolean | null | undefined): YesNo => (v === true ? 'yes' : v === false ? 'no' : '');
const fromYesNo = (v: YesNo) => (v === 'yes' ? true : v === 'no' ? false : null);

/** A payload in two: the clauses, and everything else. */
export function split(values: Record<string, unknown>) {
  const clauses: Record<string, unknown> = {};
  const terms: Record<string, unknown> = {};
  Object.entries(values).forEach(([k, v]) => { (CLAUSE_KEYS.includes(k) ? clauses : terms)[k] = v; });
  return { clauses, terms };
}

export function toForm(c: ContractRow): Form {
  const p = c.pricing || {};
  return {
    title: text(c.title), contract_type: c.contract_type || 'master', status: c.status || 'draft',
    reference: text(c.reference), record_link: text(c.record_link), effective_date: text(c.effective_date).slice(0, 10),
    renewal_date: text(c.renewal_date).slice(0, 10), expiry_date: text(c.expiry_date).slice(0, 10),
    renewal_type: text(c.renewal_type), notice_days: text(c.notice_days), annual_value: text(c.annual_value),
    currency: text(c.currency), billing: text(c.billing), termination: text(c.termination), terms: text(c.terms),
    unit_price: text(p.unit_price), included_units: text(p.included_units), overage_price: text(p.overage_price),
    one_time_fees: text(p.one_time_fees), price_cap_pct: text(p.price_cap_pct),
    uplift: p.uplift === undefined ? '' : p.uplift ? 'yes' : 'no',
    right_to_audit: yesNo(c.right_to_audit), subprocessor_terms: yesNo(c.subprocessor_terms),
    exit_data_return: yesNo(c.exit_data_return), security_addendum: yesNo(c.security_addendum),
    breach_notification_hours: text(c.breach_notification_hours), engagement_id: text(c.engagement_id),
  };
}

export function toPayload(f: Form): Record<string, unknown> {
  const t = (v: string) => (v.trim() ? v.trim() : null);
  const n = (v: string) => (v.trim() ? Number(v) : null);
  const pricing: Record<string, unknown> = {};
  PRICE_KEYS.forEach((k) => { if (f[k].trim()) pricing[k] = Number(f[k]); });
  if (f.uplift) pricing.uplift = f.uplift === 'yes';
  return {
    title: t(f.title), contract_type: f.contract_type, status: f.status, reference: t(f.reference),
    record_link: t(f.record_link), effective_date: t(f.effective_date), renewal_date: t(f.renewal_date),
    expiry_date: t(f.expiry_date), renewal_type: t(f.renewal_type), notice_days: n(f.notice_days),
    annual_value: n(f.annual_value), currency: t(f.currency.toUpperCase()), billing: t(f.billing),
    termination: t(f.termination), terms: t(f.terms), pricing: Object.keys(pricing).length ? pricing : null,
    right_to_audit: fromYesNo(f.right_to_audit), subprocessor_terms: fromYesNo(f.subprocessor_terms),
    exit_data_return: fromYesNo(f.exit_data_return), security_addendum: fromYesNo(f.security_addendum),
    breach_notification_hours: n(f.breach_notification_hours), engagement_id: n(f.engagement_id),
  };
}

/** What differs between two forms, as the payload a save sends. */
export function changedPayload(now: Form, before: Form): Record<string, unknown> {
  const a = toPayload(now);
  const b = toPayload(before);
  return Object.fromEntries(Object.entries(a).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(b[k])));
}

/** The last day to give notice, as the form currently has it: the earlier of the renewal and end dates, less the notice days. */
export function noticeBy(f: Pick<Form, 'renewal_date' | 'expiry_date' | 'notice_days'>): string | null {
  const ends = [f.renewal_date, f.expiry_date].filter(Boolean).sort()[0];
  if (!ends) return null;
  const d = new Date(ends);
  d.setDate(d.getDate() - (Number(f.notice_days) || 0));
  return d.toISOString().slice(0, 10);
}

// ── the history, in words ────────────────────────────────────────────────────────────────────────────────────────────────

const day = (v: string | null | undefined): string => formatDate(v, { calendar: true });

function shown(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key.endsWith('_date')) return day(String(value));
  if (key === 'status') return STATUS_LABEL[String(value)]?.split(' (')[0] || String(value);
  if (key === 'contract_type') return CONTRACT_TYPES[String(value)] || String(value);
  if (key === 'renewal_type') return RENEWAL_LABEL[value as RenewalType] || String(value);
  if (key === 'notice_days') return `${value} days`;
  if (key === 'breach_notification_hours') return `${value} hours`;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return 'updated';
  return String(value);
}

/** One history row as a sentence: "Changed end date 12 Nov 2026 → 12 Nov 2027". */
export function describe(h: HistoryRow): string {
  if (h.entity === 'obligation') return `Obligation ${h.action === 'create' ? 'added' : h.action === 'delete' ? 'removed' : 'updated'}`;
  if (h.action === 'create') return 'Added';
  if (h.action === 'delete') return 'Deleted';
  if (h.action === 'attach_file') return `Signed copy attached${h.reason ? `: ${h.reason}` : ''}`;
  if (h.action === 'renew') return `Renewed: now runs to ${day(h.to_value)}${h.from_value ? ` (was ${day(h.from_value)})` : ''}`;
  const parts = Object.entries(h.changes || {}).map(([k, [a, b]]) =>
    k === 'terms' || k === 'termination' || k === 'pricing' ? FIELD_LABEL[k] || k : `${FIELD_LABEL[k] || k} ${shown(k, a)} → ${shown(k, b)}`);
  return parts.length ? `Changed ${parts.join('; ')}` : 'Updated';
}

// ── what the AI read from the signed copy ────────────────────────────────────────────────────────────────────────────────

/** The form with the terms the AI read out of the signed copy put in (`suggested` is the server's {field: value}, with `pricing` an object), and the names of the fields it filled so they can be marked. */
export function applySuggestions(form: Form, suggested: Record<string, unknown>): { form: Form; keys: string[] } {
  const next: Form = { ...form };
  const bag = next as unknown as Record<string, string>;
  const keys: string[] = [];
  Object.entries(suggested).forEach(([k, v]) => {
    if (k === 'pricing' && v && typeof v === 'object') {
      Object.entries(v as Record<string, unknown>).forEach(([pk, pv]) => {
        if (pk === 'uplift') next.uplift = pv ? 'yes' : 'no';
        else if (pk in bag) bag[pk] = String(pv);
        keys.push(pk);
      });
    } else if (k in bag) {
      bag[k] = String(v);
      keys.push(k);
    }
  });
  return { form: next, keys };
}
