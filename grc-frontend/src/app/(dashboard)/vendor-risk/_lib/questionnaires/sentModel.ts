// The Sent tab of Questionnaires, apart from React (`sentModel.test.ts`): the rows the lean read answers, the register's definition (facets, quick chips, sorts, board), what a row can do, and how an
// answer is read aloud. WHAT a status means is the server's (tpra/portal.py: waiting on the supplier = pending, in progress, returned); this file only says which chip keeps which, once.
import { buildSchema, type RegisterDef } from '../../../../../components/records/registerModel.ts';
import { parseUtc } from '../../../../../lib/serverTime.ts';
import { IN_REVIEW, STATUS_ORDER, WAITING_ON_SUPPLIER, assessmentKind, questionnaireStatus } from '../../../../../lib/statuses/vendorQuestionnaires.ts';
import { answerLabel, optLabel, optValue } from './model.ts';
import type { Question } from './types.ts';

/** One line of the Sent list: `GET /vendor-risk/questionnaire-responses?lean=1` (no answers, no comments, no token). */
export interface SentRow {
  id: number;
  vendor_id: number;
  vendor_name: string | null;
  vendor_archived: boolean;
  assessment_id: number | null;
  assessment_type: string | null;
  assessment_status: string | null;
  template_id: number | null;
  template_name: string | null;
  template_version_no: number | null;
  respondent_name: string | null;
  respondent_email: string | null;
  contact_id: number | null;
  status: string;
  /** a link of its own still works (a questionnaire sent before personal links, not yet accepted): the person may copy or open it */
  own_link: boolean;
  due_date: string | null;
  expires_at: string | null;
  last_sent_at: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  created_at: string | null;
  answered: number;
  question_count: number;
}

export interface SentAnswer { items: SentRow[]; total: number; skip: number; limit: number }

/** One questionnaire in full (`GET .../questionnaire-responses/{id}`): the answers and the questions it was sent on. */
export interface SentDetail {
  id: number;
  responses: Record<string, unknown>;
  comments: Record<string, unknown>;
  questions: Question[];
  token: string | null;
  attested_by: { name: string | null; title: string | null; email: string | null; at: string | null } | null;
  respondent_name: string | null;
  respondent_email: string | null;
}

export const NONE = 'none';

// ── what a row is ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const isWaitingOnSupplier = (r: Pick<SentRow, 'status'>): boolean => (WAITING_ON_SUPPLIER as readonly string[]).includes(r.status);
export const isInReview = (r: Pick<SentRow, 'status'>): boolean => (IN_REVIEW as readonly string[]).includes(r.status);
/** Late: still waiting on the supplier and the due day has passed. A questionnaire with no due date is never late. */
export function isLate(r: Pick<SentRow, 'status' | 'due_date'>, now: Date): boolean {
  if (!isWaitingOnSupplier(r)) return false;
  const due = parseUtc(r.due_date);
  return !!due && due.getTime() < now.getTime();
}

export const supplierName = (r: Pick<SentRow, 'vendor_name'>): string => r.vendor_name || 'A supplier that is no longer listed';
export const templateName = (r: Pick<SentRow, 'template_name' | 'template_id'>): string => r.template_name || (r.template_id ? 'A questionnaire that was deleted' : 'No questionnaire');
const ms = (value: string | null): number | null => parseUtc(value)?.getTime() ?? null;

/** "12 of 48" (the questions it was sent on); "12" when the server knows no count. */
export function answeredText(r: Pick<SentRow, 'answered' | 'question_count'>): string {
  return r.question_count > 0 ? `${r.answered} of ${r.question_count}` : `${r.answered}`;
}
/** 0..1 for sorting; a questionnaire with no known count sorts by what it has. */
export const answeredShare = (r: Pick<SentRow, 'answered' | 'question_count'>): number => (r.question_count > 0 ? Math.min(1, r.answered / r.question_count) : r.answered > 0 ? 1 : 0);

/** The assessment a questionnaire hangs on, in words: "Annual assessment" (the kind), never its number. */
export function assessmentText(r: Pick<SentRow, 'assessment_id' | 'assessment_type'>): string | null {
  if (!r.assessment_id) return null;
  return r.assessment_type ? `${assessmentKind.label(r.assessment_type)} assessment` : 'An assessment';
}

// ── the register ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });

export function sentDef(): RegisterDef<SentRow> {
  return {
    key: 'sent',
    noun: { one: 'questionnaire', other: 'questionnaires' },
    idOf: (r) => r.id,
    text: (r) => [supplierName(r), templateName(r), r.respondent_name, r.respondent_email, questionnaireStatus.label(r.status), assessmentText(r)].filter(Boolean).join(' '),
    facets: [
      { key: 'status', label: 'Status', defaultOpen: true, values: (r) => [r.status], options: () => STATUS_ORDER.map((value) => ({ value, label: questionnaireStatus.label(value) })) },
      {
        key: 'template', label: 'Questionnaire', searchable: true, limit: 7, defaultOpen: true,
        values: (r) => [r.template_id ? String(r.template_id) : NONE],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((r) => { if (r.template_id) seen.set(String(r.template_id), templateName(r)); });
          return Array.from(seen.entries()).map(([value, label]) => ({ value, label })).sort(byLabel).concat({ value: NONE, label: 'No questionnaire' });
        },
      },
      {
        key: 'supplier', label: 'Supplier', searchable: true, limit: 7,
        values: (r) => [String(r.vendor_id)],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((r) => seen.set(String(r.vendor_id), supplierName(r)));
          return Array.from(seen.entries()).map(([value, label]) => ({ value, label })).sort(byLabel);
        },
      },
      { key: 'assessment', label: 'Assessment', values: (r) => [r.assessment_id ? 'linked' : 'none'], options: () => [{ value: 'linked', label: 'Linked to one' }, { value: 'none', label: 'Not linked' }] },
    ],
    quick: [
      { key: 'waiting', label: 'Waiting on supplier', test: (r) => isWaitingOnSupplier(r), title: 'Sent, being answered or returned: the supplier has the next move' },
      { key: 'review', label: 'In review', test: (r) => isInReview(r), title: 'Submitted by the supplier: we have the next move' },
      { key: 'returned', label: 'Returned', test: (r) => r.status === 'returned', title: 'Sent back to the supplier with questions' },
      { key: 'late', label: 'Late', test: (r, now) => isLate(r, now), title: 'Waiting on the supplier and past the due day' },
    ],
    sorts: [
      { key: 'sent', label: 'Sent (newest first)', firstDir: 'desc', value: (r) => ms(r.created_at) },
      { key: 'due', label: 'Due day', firstDir: 'asc', value: (r) => ms(r.due_date) },
      { key: 'supplier', label: 'Supplier', firstDir: 'asc', value: (r) => supplierName(r) },
      { key: 'status', label: 'Status', firstDir: 'asc', value: (r) => STATUS_ORDER.indexOf(r.status as (typeof STATUS_ORDER)[number]) },
      { key: 'answered', label: 'How much is answered', firstDir: 'desc', value: (r) => answeredShare(r) },
    ],
    defaultSort: { key: 'sent', dir: 'desc' },
    board: { label: 'Questionnaires by status', columns: STATUS_ORDER.map((id) => ({ id, label: questionnaireStatus.label(id), test: (r: SentRow) => r.status === id })) },
    pageSize: 25,
  };
}

/** Defined once, outside any component (the address hook reads the address again for a new schema). */
export const SENT_SCHEMA = buildSchema(sentDef());

/** "128 questionnaires · 14 waiting on a supplier · 3 late", over the rows read. */
export function headLine(rows: readonly SentRow[], now: Date): string {
  const waiting = rows.filter(isWaitingOnSupplier).length;
  const late = rows.filter((r) => isLate(r, now)).length;
  const bits = [`${rows.length.toLocaleString('en-GB')} ${rows.length === 1 ? 'questionnaire' : 'questionnaires'}`];
  if (waiting > 0) bits.push(`${waiting.toLocaleString('en-GB')} waiting on a supplier`);
  if (late > 0) bits.push(`${late.toLocaleString('en-GB')} late`);
  return bits.join(' · ');
}

// ── what a person may do to a row ────────────────────────────────────────────────────────────────────────────────────────

export type SentAction = 'answers' | 'copy_link' | 'open_link' | 'copy_contact_link' | 'send_new_link' | 'open_assessment';

/** The rights the server checks: a new link needs `assessments:edit`; a personal link is issued on the supplier (`vendors:edit`). Reading the answers is open to everyone who reaches the page. */
export function sentActions(r: Pick<SentRow, 'status' | 'own_link' | 'contact_id' | 'assessment_id'>, can: { resend: boolean; vendors: boolean }): SentAction[] {
  const out: SentAction[] = ['answers'];
  const waiting = isWaitingOnSupplier(r);
  if (r.own_link) out.push('copy_link', 'open_link');
  else if (waiting && r.contact_id && can.vendors) out.push('copy_contact_link');
  if (can.resend && waiting) out.push('send_new_link');
  if (r.assessment_id) out.push('open_assessment');
  return out;
}

/** What the confirmation before a new link says: the old link of its own stops working; a personal link is emailed to the contact. */
export function newLinkAsk(r: Pick<SentRow, 'own_link'>): { title: string; message: string; confirmLabel: string } {
  return r.own_link
    ? { title: 'Send a new link?', message: 'The current link stops working. The contact gets a new personal link and 14 more days to answer. The new link is copied for you.', confirmLabel: 'Send a new link' }
    : { title: 'Email the contact a new link?', message: 'The contact is emailed a new personal link and gets 14 more days to answer. It is copied for you too.', confirmLabel: 'Email the link' };
}

// ── the answers, read aloud ──────────────────────────────────────────────────────────────────────────────────────────────

const NA = 'Not applicable';
/** One answer as a person reads it: "Yes", "Not applicable", the label of the option picked, "4 of 5", the words typed. Never raw JSON. */
export function answerText(q: Pick<Question, 'type' | 'options'>, raw: unknown): string {
  let value: unknown = raw;
  if (value && typeof value === 'object' && 'answer' in (value as Record<string, unknown>)) value = (value as Record<string, unknown>).answer;
  if (value === null || value === undefined || value === '') return 'No answer';
  if (typeof value === 'object') return 'Answered';
  const text = String(value);
  if (q.type === 'yes_no') return text.toLowerCase() === 'n-a' ? NA : answerLabel(q, text.toLowerCase());
  if (q.type === 'rating') return `${text} of 5`;
  if (q.type === 'multiple_choice') {
    const found = (q.options || []).find((o) => optValue(o) === text);
    return found === undefined ? text : optLabel(found);
  }
  return text;
}

/** The question-and-answer lines of the drawer, in the order the questions were asked; a question never answered says so. */
export function answerLines(detail: Pick<SentDetail, 'questions' | 'responses' | 'comments'>): Array<{ id: string; number: number; text: string; answer: string; answered: boolean; comment: string | null }> {
  return (detail.questions || []).map((q, i) => {
    const raw = (detail.responses || {})[q.id];
    const answer = answerText(q, raw);
    const comment = (detail.comments || {})[q.id];
    return { id: q.id, number: i + 1, text: q.text, answer, answered: answer !== 'No answer', comment: typeof comment === 'string' && comment.trim() ? comment.trim() : null };
  });
}

/** Answers on file that no question of the version names (a question removed since): said as a count, never as raw keys. */
export function strayAnswers(detail: Pick<SentDetail, 'questions' | 'responses'>): number {
  const asked = new Set((detail.questions || []).map((q) => q.id));
  return Object.keys(detail.responses || {}).filter((k) => !asked.has(k)).length;
}
