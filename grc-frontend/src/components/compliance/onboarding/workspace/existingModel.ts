/**
 * What the "What exists" section of the onboarding decides without a screen: the blank form, how a saved item becomes the form and back into what the server takes
 * (a blank box is "not given", never an empty string), what is wrong with the form before it is sent, the one line of facts under an item, and who may be asked
 * to review it. Pure, so `node --test` pins it (existingModel.test.ts). The rules that count are the server's (`backend/grc/modules/framework_onboarding/existing.py`).
 */
import type { ExistingInput, ExistingRecord, FileRef } from '@/lib/frameworkOnboarding';
import type { Tone } from '@/lib/status';

export interface ExistingForm {
  type: string;
  date: string;
  validUntil: string;
  issuer: string;
  version: string;
  from: string;
  to: string;
  coverage: string;
  note: string;
  files: FileRef[];
}

export const emptyForm = (): ExistingForm => ({ type: '', date: '', validUntil: '', issuer: '', version: '', from: '', to: '', coverage: '', note: '', files: [] });

export const formOf = (r: ExistingRecord): ExistingForm => ({
  type: r.assessment_type, date: r.assessment_date ?? '', validUntil: r.valid_until ?? '', issuer: r.assessor_or_issuer ?? '', version: r.framework_version ?? '',
  from: r.period_start ?? '', to: r.period_end ?? '', coverage: r.scope_coverage ?? '', note: r.note ?? '', files: r.files,
});

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** What the server takes: every key (a key left out would be left as it was), a blank box as null. */
export const payloadOf = (f: ExistingForm): ExistingInput => ({
  assessment_type: f.type, assessment_date: orNull(f.date), valid_until: orNull(f.validUntil), assessor_or_issuer: orNull(f.issuer), framework_version: orNull(f.version),
  period_start: orNull(f.from), period_end: orNull(f.to), scope_coverage: orNull(f.coverage), note: orNull(f.note), evidence_ids: f.files.map((x) => x.id),
});

/** What is wrong with the form, in words for the person; null when it can be sent. Only the kind is needed. */
export function formProblem(f: ExistingForm, types: readonly string[]): string | null {
  if (!types.includes(f.type)) return 'Choose what exists.';
  if (f.date && f.validUntil && f.validUntil < f.date) return 'The expiry cannot be before the assessment date.';
  if (f.from && f.to && f.to < f.from) return 'The period cannot end before it starts.';
  return null;
}

/** Has the form changed from what is saved (an item being edited) or from nothing (a new one)? */
export function formChanged(a: ExistingForm, b: ExistingForm): boolean {
  return JSON.stringify({ ...a, files: a.files.map((x) => x.id) }) !== JSON.stringify({ ...b, files: b.files.map((x) => x.id) });
}

/** "Assessed 1 Mar 2026 · valid until 1 Mar 2027 · NQA": the facts that were given, in the order a person reads them. `fmt` writes a date. */
export function recordFacts(r: ExistingRecord, fmt: (iso: string) => string): string {
  const parts: string[] = [];
  if (r.assessment_date) parts.push(`Assessed ${fmt(r.assessment_date)}`);
  if (r.period_start || r.period_end) parts.push(`Covers ${r.period_start ? fmt(r.period_start) : '…'} to ${r.period_end ? fmt(r.period_end) : '…'}`);
  if (r.valid_until) parts.push(`${r.expired ? 'Expired' : 'Valid until'} ${fmt(r.valid_until)}`);
  if (r.assessor_or_issuer) parts.push(r.assessor_or_issuer);
  if (r.framework_version) parts.push(`Version ${r.framework_version}`);
  return parts.join(' · ');
}

export const VERIFICATION_TONE: Record<ExistingRecord['verification_status'], Tone> = { declared: 'neutral', evidence_received: 'progress', reviewed: 'success', verified: 'success' };

/** The reviews that can be asked of an item: never without a document (the server refuses it), and never one it already holds. */
export function reviewsOf(r: ExistingRecord): Array<'reviewed' | 'verified'> {
  if (r.files.length === 0) return [];
  return (['reviewed', 'verified'] as const).filter((s) => s !== r.verification_status);
}
