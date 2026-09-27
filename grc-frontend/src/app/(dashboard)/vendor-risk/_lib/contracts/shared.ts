// Shapes and wording shared by the Contracts page and the vendor's contract panel.

export type ContractState = 'lapsed' | 'decide' | 'ending' | 'in_force' | 'draft' | 'ended';
export type RenewalType = 'auto' | 'manual' | 'evergreen';

export interface Pricing {
  unit_price?: number; included_units?: number; overage_price?: number; one_time_fees?: number;
  price_cap_pct?: number; uplift?: boolean;
}

export interface ContractRow {
  id: number;
  vendor: { id: number; name: string; tier: string | null; owner_id: number | null };
  title: string | null; contract_type: string; type_label: string; status: string; state: ContractState;
  effective_date: string | null; renewal_date: string | null; expiry_date: string | null;
  ends_on: string | null; act_by: string | null; days_left: number | null;
  reference: string | null; record_link: string | null; renewal_type: RenewalType | null; notice_days: number | null;
  annual_value: number | null; currency: string | null; billing: string | null; pricing: Pricing | null;
  termination: string | null; terms: string | null; evidence_id: number | null; assessment_id: number | null;
  row_version: number;
}

export interface Obligation {
  id: number; obligation: string; control_ref: string | null; renewal_date: string | null; status: string; row_version: number;
}

export interface HistoryRow {
  id: number; entity: string; action: string; by: string | null; from_value: string | null; to_value: string | null;
  reason: string | null; changes: Record<string, [unknown, unknown]> | null; at: string;
}

export interface ContractDetail extends ContractRow {
  obligations: Obligation[];
  file: { evidence_id: number; name: string; uploaded_at: string | null; read: boolean } | null;
  history: HistoryRow[];
}

export interface Register {
  items: ContractRow[]; counts: Record<ContractState, number>; annual_value: Record<string, number>;
  decide_days: number; inbox_days: number; types: Record<string, string>;
}

export const CONTRACT_TYPES: Record<string, string> = {
  master: 'Master agreement', dpa: 'Data processing agreement', sla: 'Service levels',
  security_addendum: 'Security addendum', nda: 'Non-disclosure', order_form: 'Order form',
  purchase_order: 'Purchase order', sow: 'Statement of work', other: 'Other',
};

export const STATE_META: Record<ContractState, { label: string; cls: string }> = {
  lapsed: { label: 'Past its date', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  decide: { label: 'Decide now', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  ending: { label: 'Ending soon', cls: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  in_force: { label: 'In force', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  draft: { label: 'Draft', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  ended: { label: 'Ended', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

export const RENEWAL_LABEL: Record<RenewalType, string> = {
  auto: 'Renews automatically', manual: 'Renewed by hand', evergreen: 'No end date',
};

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft (not signed yet)', active: 'In force (signed)', expired: 'Expired', terminated: 'Terminated',
};

export const OBLIGATION_STATUS = ['open', 'met', 'breached', 'waived'] as const;

export const FIELD_LABEL: Record<string, string> = {
  title: 'title', contract_type: 'type', status: 'status', reference: 'reference', record_link: 'link',
  effective_date: 'start date', renewal_date: 'renewal date', expiry_date: 'end date', renewal_type: 'renewal',
  notice_days: 'notice', annual_value: 'annual value', currency: 'currency', billing: 'billing', pricing: 'pricing',
  termination: 'termination', terms: 'notes', assessment_id: 'assessment', document_id: 'document',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function money(value: number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined) return '—';
  try {
    if (currency) return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch { /* an unknown code falls through to a plain number */ }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)}${currency ? ` ${currency}` : ''}`;
}

/** What the clock says about a contract, in words. */
export function countdown(c: Pick<ContractRow, 'state' | 'days_left' | 'notice_days' | 'renewal_type' | 'act_by' | 'ends_on'>): string {
  if (c.days_left === null || !c.act_by) return '';
  const days = c.days_left;
  const noticed = !!c.notice_days && c.act_by !== c.ends_on;
  if (days < 0) {
    if (c.state === 'lapsed') return c.renewal_type === 'auto' ? `Renewal date passed ${plural(-days, 'day')} ago` : `Ended ${plural(-days, 'day')} ago`;
    return `Notice was due ${plural(-days, 'day')} ago`;
  }
  if (days === 0) return noticed ? 'Last day to give notice' : 'Ends today';
  return noticed ? `Give notice within ${plural(days, 'day')}` : `Ends in ${plural(days, 'day')}`;
}

/** The dates of a new term: each date the contract uses, a year on. */
export function nextTerm(c: Pick<ContractRow, 'renewal_date' | 'expiry_date'>) {
  const yearOn = (d: string | null) => {
    if (!d) return '';
    const t = new Date(d);
    t.setFullYear(t.getFullYear() + 1);
    return t.toISOString().slice(0, 10);
  };
  return { renewal_date: yearOn(c.renewal_date), expiry_date: yearOn(c.expiry_date) };
}
