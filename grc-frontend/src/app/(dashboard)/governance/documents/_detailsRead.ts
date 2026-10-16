/**
 * A new document's details form, and what reading its file fills in (POST /governance/documents/read-details): only the fields the
 * person has not touched, and only with what the file (or Comply Agent) gave; a field the file leaves open goes back to its
 * default. Pure, so `node --test` checks it.
 */
export type Origin = 'file' | 'ai' | 'default';

export interface ReadField { value: unknown; from: Origin; stated?: string | null }
export interface ReadResult { fields: Record<string, ReadField | undefined>; ai: 'used' | 'not_needed' | 'unavailable' }

export interface Details {
  title: string; doc_type: string; classification: string; description: string;
  owner_id: number | null; department_id: number | null; review_cycle_months: number;
  effective_date: string; next_review_date: string;      // YYYY-MM-DD, '' when not set
}
export type DetailKey = keyof Details;
export const DETAIL_KEYS: DetailKey[] = ['title', 'doc_type', 'classification', 'description', 'owner_id', 'department_id',
  'review_cycle_months', 'effective_date', 'next_review_date'];

export const EMPTY_DETAILS: Details = {
  title: '', doc_type: 'policy', classification: 'internal', description: '', owner_id: null, department_id: null,
  review_cycle_months: 12, effective_date: '', next_review_date: '',
};

/** YYYY-MM-DD plus whole months, the day clamped to the month's end (31 Jan + 1 = 28/29 Feb). */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return '';
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export const suggestNext = (f: Pick<Details, 'effective_date' | 'review_cycle_months'>) =>
  (f.effective_date && f.review_cycle_months ? addMonths(f.effective_date, f.review_cycle_months) : '');

/** A change the person made; a Next review that was empty or still the old suggestion follows the effective date and the cycle. */
export function change(form: Details, patch: Partial<Details>): Details {
  const next = { ...form, ...patch };
  if (!('next_review_date' in patch) && ('effective_date' in patch || 'review_cycle_months' in patch)) {
    const s = suggestNext(next);
    if (s && (!form.next_review_date || form.next_review_date === suggestNext(form))) next.next_review_date = s;
  }
  return next;
}

/** The read laid over the form: untouched fields start again from `initial`, then take what the file or Comply Agent gave. */
export function applyRead(initial: Details, form: Details, touched: ReadonlySet<string>, read: ReadResult):
  { form: Details; from: Partial<Record<DetailKey, Origin>>; ownerStated: string | null } {
  const out: Record<string, unknown> = { ...form };
  const from: Partial<Record<DetailKey, Origin>> = {};
  for (const key of DETAIL_KEYS) {
    if (touched.has(key)) continue;
    out[key] = initial[key];
    const f = read.fields[key];
    if (!f || (f.from !== 'file' && f.from !== 'ai') || f.value === null || f.value === undefined || f.value === '') continue;
    out[key] = typeof initial[key] === 'number' || initial[key] === null ? Number(f.value) : String(f.value);
    from[key] = f.from;
  }
  const result = out as unknown as Details;
  if (!touched.has('next_review_date') && !from.next_review_date) result.next_review_date = suggestNext(result);
  const owner = read.fields.owner_id;
  const ownerStated = !from.owner_id && owner?.stated ? String(owner.stated) : null;
  return { form: result, from, ownerStated };
}

/** The details as the save routes take them (a multipart form or a JSON body): empty ones left out. */
export function detailsPayload(d: Details): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of DETAIL_KEYS) {
    const v = d[key];
    if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) continue;
    out[key] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}
