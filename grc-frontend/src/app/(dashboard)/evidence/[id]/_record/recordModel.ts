// The rules of the evidence record page, apart from React so `node --test` can pin them (recordModel.test.ts): the timeline of what happened to the file, which actions a person is
// offered, the tabs and their numbers, where Back goes. The formulas are the workspace's (evidenceModel.ts: the 30-day line, the percent rule, the AI-review word; libraryModel.ts:
// what is lapsed, when a file counts as sent back); this file only reads them together. Times are the server's naive UTC (parseUtc).
import { parseUtc } from '../../../../../lib/serverTime.ts';
import { reviewState } from '../../../../../lib/statuses/evidence.ts';
import { expiryReading, normPct, reviewWord, type EvidenceItem } from '../../_workspace/evidenceModel.ts';
import { isLapsed, returnedNote } from '../../_library/libraryModel.ts';
import type { ReviewBrief } from '../../_review.tsx';
import type { EvidenceDetail } from './recordTypes.ts';

// ── where Back goes ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Back is the browser's: the Frameworks journey, a control and the Library all link here and expect to be returned to. With no history to go back to (a pasted address) it is the Library. */
export const backTo = (historyLength: number): 'history' | '/evidence' => (historyLength > 1 ? 'history' : '/evidence');

// ── the tabs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const RECORD_TABS = ['overview', 'linked', 'ai', 'file', 'details'] as const;
export type RecordTab = (typeof RECORD_TABS)[number];
export const TAB_LABEL: Record<RecordTab, string> = { overview: 'Overview', linked: 'Linked', ai: 'AI review', file: 'File & versions', details: 'Details' };
/** Names an address may carry for a tab (none existed on the old page; these are what the sections were called). */
export const TAB_ALIASES: Readonly<Record<string, RecordTab>> = { links: 'linked', coverage: 'linked', assessment: 'ai', review: 'ai', versions: 'file', ocr: 'file', info: 'details' };

export interface TabSpec { key: RecordTab; label: string; count?: number }
/** The tabs with their numbers: what is linked (all kinds) and the versions of the file; a number that is not known yet is left off rather than drawn as 0. */
export function recordTabs(counts: { linked?: number | null; versions?: number | null }): TabSpec[] {
  const n = (v?: number | null) => (typeof v === 'number' && v > 0 ? v : undefined);
  return RECORD_TABS.map((key) => ({ key, label: TAB_LABEL[key], count: key === 'linked' ? n(counts.linked) : key === 'file' ? n(counts.versions) : undefined }));
}

// ── the score ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** How mature the file is, 0-100: its score, else the audit readiness of its latest rating (the panel's rule). Null when it was never rated. */
export const scoreOf = (d: Pick<EvidenceDetail, 'quality_score' | 'latest_assessment'>): number | null => normPct(d.quality_score) ?? normPct(d.latest_assessment?.audit_readiness);

// ── past its date ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Past its validity: the server's word (`lapsed`, or the flag it still sends as `is_stale`), the expired status, or a date that has gone by since. An archived file never lapses. */
export const lapsedNow = (d: Pick<EvidenceDetail, 'status' | 'lapsed' | 'is_stale' | 'expiry_date'>, now: number): boolean =>
  d.status !== 'archived' && (Boolean(d.lapsed) || Boolean(d.is_stale) || isLapsed(d, now));

// ── what a person may do ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface Rights { canEdit: boolean; canDelete: boolean }
export interface Offered {
  /** send a draft for review (everyone, as the server lets any signed-in person) */
  submit: boolean;
  /** approve or send back a file that is waiting (the edit right, as the old page asked) */
  decide: boolean;
  /** renew a file past its date (the edit right, as in the Library's panel) */
  renew: boolean;
  edit: boolean;
  remove: boolean;
  openFile: boolean;
  /** the file's text was never read (or failed): read it again */
  readAgain: boolean;
  /** the one thing to do next, drawn as the primary button; a decision has its own bar */
  primary: 'submit' | 'renew' | null;
}

export function offeredTo(d: Pick<EvidenceDetail, 'status' | 'ocr_status' | 'file_path' | 'expiry_date' | 'lapsed' | 'is_stale'>, rights: Rights, now: number): Offered {
  const lapsed = lapsedNow(d, now);
  const submit = d.status === 'draft';
  const decide = rights.canEdit && d.status === 'pending_review';
  const renew = rights.canEdit && lapsed && (d.status === 'approved' || d.status === 'expired');
  return {
    submit, decide, renew,
    edit: rights.canEdit,
    remove: rights.canDelete,
    openFile: !!d.file_path,
    readAgain: d.ocr_status !== 'completed' && d.ocr_status !== 'not_applicable',
    primary: submit ? 'submit' : renew ? 'renew' : null,
  };
}

// ── the timeline ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type StepState = 'done' | 'now' | 'todo' | 'warn' | 'bad';
export interface TimelineStep {
  key: 'uploaded' | 'read' | 'rated' | 'sent' | 'decision' | 'validity';
  label: string;
  state: StepState;
  /** the moment it happened (naive UTC), when it did */
  when: string | null;
  who: string | null;
  /** a few words under it: the score, the days left, the reviewer's note */
  text: string | null;
}

export type TimelineInput = Pick<EvidenceDetail,
  'uploaded_at' | 'uploader_name' | 'ocr_status' | 'ocr_processed_at' | 'quality_score' | 'latest_assessment' | 'submitted_at' | 'submitted_by' | 'status' | 'reviewed_at' | 'reviewed_by'
  | 'review_comments' | 'approved_at' | 'approved_by' | 'expiry_date' | 'lapsed' | 'is_stale'>;

const NOTE_CUT = 140;
const clip = (s: string): string => (s.length > NOTE_CUT ? `${s.slice(0, NOTE_CUT).trimEnd()}…` : s);

/**
 * What happened to the file, in order: uploaded, its text read, rated by the AI, sent for review, the decision, and how long it is valid. A step that does not apply is left out
 * (a file with no text to read, one with no expiry). `review` is the AI review as the server last said it (fresher than the record's own copy while it runs); `nameOf` turns a user id
 * into a name where it can (a failed lookup just means no names).
 */
export function timelineOf(
  d: TimelineInput,
  now: number,
  { review = null, ocrStalled = false, nameOf = () => null }: { review?: ReviewBrief | null; ocrStalled?: boolean; nameOf?: (id: number | null | undefined) => string | null } = {},
): TimelineStep[] {
  const steps: TimelineStep[] = [];
  steps.push({ key: 'uploaded', label: 'Uploaded', state: 'done', when: d.uploaded_at, who: d.uploader_name, text: null });

  // the file's text
  if (d.ocr_status !== 'not_applicable') {
    if (d.ocr_status === 'completed') steps.push({ key: 'read', label: 'Text read', state: 'done', when: d.ocr_processed_at, who: null, text: null });
    else if (d.ocr_status === 'failed') steps.push({ key: 'read', label: 'Could not be read', state: 'bad', when: null, who: null, text: null });
    else if (d.ocr_status === 'processing' || d.ocr_status === 'pending') steps.push({ key: 'read', label: 'Reading the file', state: 'now', when: null, who: null, text: null });
    else steps.push({ key: 'read', label: 'Not read yet', state: 'todo', when: null, who: null, text: null });
  }

  // the AI's rating
  const score = scoreOf(d);
  const word = reviewWord({ score, review, ocrStalled });
  const label = reviewState.label(word);
  if (word === 'rated') steps.push({ key: 'rated', label: 'AI rated', state: 'done', when: d.latest_assessment?.assessed_at ?? null, who: null, text: `${score}% mature` });
  else if (word === 'queued' || word === 'reading' || word === 'rating' || word === 'matching') steps.push({ key: 'rated', label, state: 'now', when: null, who: null, text: null });
  else if (word === 'failed' || word === 'stopped') steps.push({ key: 'rated', label: 'Not rated', state: 'bad', when: null, who: null, text: null });
  else if (word === 'ocr_stalled') steps.push({ key: 'rated', label, state: 'warn', when: null, who: null, text: null });
  else steps.push({ key: 'rated', label: word === 'unavailable' ? "Can't be rated by AI" : 'Not rated yet', state: 'todo', when: null, who: null, text: null });

  // sent for review, and what was decided
  if (d.submitted_at) steps.push({ key: 'sent', label: 'Sent for review', state: 'done', when: d.submitted_at, who: nameOf(d.submitted_by), text: null });
  else if (d.status === 'draft') steps.push({ key: 'sent', label: 'Not sent for review', state: 'todo', when: null, who: null, text: null });

  const back = returnedNote(d);
  if (d.status === 'pending_review') steps.push({ key: 'decision', label: 'Waiting for review', state: 'now', when: null, who: null, text: null });
  else if (d.status === 'approved' || (d.status === 'expired' && d.approved_at)) steps.push({ key: 'decision', label: 'Approved', state: 'done', when: d.approved_at, who: nameOf(d.approved_by), text: null });
  else if (d.status === 'rejected') steps.push({ key: 'decision', label: 'Rejected', state: 'bad', when: d.reviewed_at, who: nameOf(d.reviewed_by), text: d.review_comments ? clip(d.review_comments) : null });
  else if (d.status === 'draft' && back) steps.push({ key: 'decision', label: 'Sent back', state: 'warn', when: d.reviewed_at, who: nameOf(d.reviewed_by), text: null });   // the note is said in full under the strip (the page), not cut here
  else if (d.status === 'draft') steps.push({ key: 'decision', label: 'Not reviewed yet', state: 'todo', when: null, who: null, text: null });

  // how long it is valid
  if (d.expiry_date && d.status !== 'archived') {
    const reading = expiryReading(d.expiry_date, now);
    if (lapsedNow(d, now)) steps.push({ key: 'validity', label: 'Lapsed', state: 'bad', when: d.expiry_date, who: null, text: reading.word === 'expired' ? reading.text : null });
    else steps.push({ key: 'validity', label: 'Valid until', state: reading.word === 'expiring' ? 'warn' : 'todo', when: d.expiry_date, who: null, text: reading.text });
  }
  return steps;
}

// ── the facts under the head ─────────────────────────────────────────────────────────────────────────────────────────────
/** Whose the file is: its owner, else whoever uploaded it, else nobody (the page says "Unassigned"). */
export const holderOf = (d: Pick<EvidenceItem, 'owner_name' | 'uploader_name'>): string | null => d.owner_name || d.uploader_name || null;

/** The AI review as the page last heard it: the hook's answer once it has one, else the record's copy. */
export const reviewOf = (hook: ReviewBrief | null | undefined, record: ReviewBrief | null | undefined): ReviewBrief | null => hook ?? record ?? null;

/** What kind of file it is, in words ("PDF document"), from its name's ending or its type; never the raw type string. Null when there is no file. */
export function fileKindOf(fileName: string | null | undefined, mime?: string | null): string | null {
  const ending = (fileName ?? '').toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? '';
  const type = (mime ?? '').toLowerCase();
  const by = (re: RegExp) => re.test(ending) || re.test(type);
  if (!fileName && !mime) return null;
  if (by(/^pdf$|pdf/)) return 'PDF document';
  if (by(/^docx?$|msword|wordprocessingml/)) return 'Word document';
  if (by(/^xlsx?$|^csv$|spreadsheet|excel|csv/)) return 'Spreadsheet';
  if (by(/^pptx?$|presentation|powerpoint/)) return 'Presentation';
  if (by(/^(png|jpe?g|gif|webp|bmp|tiff?|svg)$|^image\//)) return 'Image';
  if (by(/^(txt|md|log|json|xml)$|^text\//)) return 'Text file';
  if (by(/^(zip|gz|tar|7z|rar)$|zip/)) return 'Archive';
  return ending ? `${ending.toUpperCase()} file` : 'File';
}

// ── the edit form ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface EditForm { name: string; description: string; evidence_type: string; collection_date: string; validity_period_days: string; source_system: string }

/** The form as the file stands. The collection date is the calendar day as the server stored it (the first ten characters), not a moment pushed through the viewer's time zone. */
export const editFormOf = (d: Pick<EvidenceDetail, 'name' | 'description' | 'evidence_type' | 'collection_date' | 'validity_period_days' | 'source_system'>): EditForm => ({
  name: d.name || '',
  description: d.description || '',
  evidence_type: d.evidence_type || '',
  collection_date: d.collection_date ? d.collection_date.slice(0, 10) : '',
  validity_period_days: d.validity_period_days ? String(d.validity_period_days) : '',
  source_system: d.source_system || '',
});

/** What the save sends (PUT /evidence-mgmt/items/{id}), the fields the page always sent: an empty one is cleared, the collection day starts at midnight, the validity is a whole number. */
export function editBody(form: EditForm, customValues: Record<string, unknown> | null | undefined) {
  return {
    name: form.name,
    description: form.description || null,
    evidence_type: form.evidence_type || null,
    collection_date: form.collection_date ? `${form.collection_date}T00:00:00` : null,
    validity_period_days: form.validity_period_days ? Number(form.validity_period_days) : null,
    source_system: form.source_system || null,
    custom_values: customValues ?? null,
  };
}

/** Whether the form differs from the file (typed input is not thrown away without asking). */
export const editDirty = (form: EditForm, start: EditForm): boolean => (Object.keys(form) as Array<keyof EditForm>).some((k) => form[k] !== start[k]);

/** Why the form cannot be saved, or null: a name is needed, and a validity is a whole number of days from 1. */
export function editProblem(form: EditForm): string | null {
  if (!form.name.trim()) return 'Enter a name.';
  if (form.validity_period_days) {
    const n = Number(form.validity_period_days);
    if (!Number.isInteger(n) || n < 1) return 'The validity is a whole number of days, 1 or more.';
  }
  return null;
}

// ── the review trail (Details tab) ───────────────────────────────────────────────────────────────────────────────────────
export interface TrailStep { label: string; at: string; by: string | null }

/** Who did what and when, oldest first. An approval stamps the review at the same moment, so it is said once (as the approval); a review that was not an approval is a return or a rejection. */
export function trailOf(
  d: Pick<EvidenceDetail, 'status' | 'submitted_at' | 'submitted_by' | 'reviewed_at' | 'reviewed_by' | 'approved_at' | 'approved_by'>,
  sentBack: string | null,
  nameOf: (id: number | null | undefined) => string | null = () => null,
): TrailStep[] {
  const steps: Array<TrailStep & { t: number }> = [];
  const add = (label: string, at: string | null, by: number | null) => {
    const t = parseUtc(at)?.getTime();
    if (at && t !== undefined) steps.push({ label, at, by: nameOf(by), t });
  };
  add('Sent for review', d.submitted_at, d.submitted_by);
  const sameMoment = !!d.approved_at && !!d.reviewed_at && parseUtc(d.approved_at)?.getTime() === parseUtc(d.reviewed_at)?.getTime();
  if (!sameMoment) add(d.status === 'rejected' ? 'Rejected' : sentBack ? 'Sent back' : 'Reviewed', d.reviewed_at, d.reviewed_by);
  add('Approved', d.approved_at, d.approved_by);
  return steps.sort((a, b) => a.t - b.t).map(({ label, at, by }) => ({ label, at, by }));
}
