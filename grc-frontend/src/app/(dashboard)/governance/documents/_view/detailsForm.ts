// The document page's Details popup: the form it starts from and what Save sends. Pure, so `node --test` pins it (detailsForm.test.ts): Save sends ONLY the fields that
// changed (PUT /governance/documents/{id}), text trimmed, an emptied optional text or date sent as null, a list compared as a set. Moved out of _DetailsDialog.tsx unchanged
// when the dialog moved onto the kit's fields, so the request is exactly what it was.
import { addMonths } from '../_detailsRead.ts';

export type DetailsForm = {
  title: string; doc_type: string; classification: string;
  owner_id: number | null; department_id: number | null; review_cycle_months: number | null;
  effective_date: string; next_review_date: string; applicable_framework_ids: number[];
  parent_document_id: number | null; tags: string[]; description: string;
};

/** The form as the document is now. The dates are the day as stored (naive-UTC midnight): the first ten characters. */
export const fromDoc = (doc: any): DetailsForm => ({
  title: doc?.title || '',
  doc_type: doc?.doc_type || '',
  classification: String(doc?.classification || '').toLowerCase(),
  owner_id: doc?.owner_id ?? null,
  department_id: doc?.department_id ?? null,
  review_cycle_months: doc?.review_cycle_months ?? null,
  effective_date: String(doc?.effective_date || '').slice(0, 10),
  next_review_date: String(doc?.next_review_date || '').slice(0, 10),
  applicable_framework_ids: [...(doc?.applicable_framework_ids || [])],
  parent_document_id: doc?.parent_document_id ?? null,
  tags: [...(doc?.tags || [])],
  description: doc?.description || '',
});

export const NULL_WHEN_EMPTY = new Set<string>(['description', 'effective_date', 'next_review_date']);

/** Only the fields that differ from `base`; text trimmed, an emptied optional text or date sent as null. */
export function changes(base: DetailsForm, form: DetailsForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(form) as (keyof DetailsForm)[]) {
    let a: unknown = base[k];
    let b: unknown = form[k];
    if (typeof b === 'string') { b = b.trim(); a = String(a ?? '').trim(); }
    const same = Array.isArray(b)
      ? JSON.stringify([...b].sort()) === JSON.stringify([...(a as unknown[])].sort())
      : a === b;
    if (!same) patch[k] = b === '' && NULL_WHEN_EMPTY.has(k) ? null : b;
  }
  return patch;
}

/** The next review the effective date and the cycle make ('' when either is missing). */
export const suggestNext = (f: DetailsForm): string => (f.effective_date && f.review_cycle_months ? addMonths(f.effective_date, f.review_cycle_months) : '');
