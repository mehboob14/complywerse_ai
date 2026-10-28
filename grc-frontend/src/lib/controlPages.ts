/**
 * The document control pages that are part of every document: "Document Description", the review and approval pages (a signature cell
 * for each person, stage by stage), "Revision History" and "Approval History". The platform builds them from the document's own
 * workflow and signatures (GET /governance/documents/{id}/controlled-content, lib/approvalRecord.ts); nobody types them. A platform
 * document shows them where its own sections are; a Word or PDF file comes with them inserted after the cover.
 * The words, dates and fallbacks below are pure, so they are tested with node --test (controlPages.test.ts); the pages are drawn by
 * documents/[id]/ControlPages.tsx (the Tailwind classes must live under src/app or src/components, so none are here).
 */
import {
  NONE, decisionLabel, formatDateTime, formatDay, headerOf, onBehalfLine, ruleLine, stageStatusLabel, stageSummary, statusLabel, typeLabel,
  type ApprovalRecord, type ControlSlot, type ControlledContent, type ControlledSegment, type FormatOptions, type RecordApprovalRow,
  type RecordPerson, type RecordRevision, type RecordStage,
} from './approvalRecord.ts';
import { parseUtc } from './serverTime.ts';

/** The title a page brings when the document has no section of its own for it (`heading: true`). */
export const SECTION_TITLE: Record<ControlSlot, string> = {
  description: 'Document Description',
  signoff: 'Review and Approval',
  revision: 'Revision History',
};

const SLOTS: readonly string[] = ['description', 'signoff', 'revision'];

// ── what to draw, and what to draw when the answer is not what was expected ───────────────────────────────
/** The segments of a platform document to draw in order, or null: the document is drawn as it is (loading, failed, a file, nothing to cut, a payload that is not what was asked). */
export function usableSegments(content: Partial<ControlledContent> | null | undefined): ControlledSegment[] | null {
  if (!content || content.kind !== 'markdown' || !Array.isArray(content.segments)) return null;
  const out = content.segments.filter((s): s is ControlledSegment =>
    !!s && ((s.type === 'markdown' && typeof s.text === 'string') || (s.type === 'slot' && typeof s.slot === 'string' && SLOTS.includes(s.slot))));
  return out.length ? out : null;
}

/**
 * The React Query key of the pages inside a platform document: it starts with the document's own, so every refresh of the document (a
 * signature, a publish) refreshes them. `stamp`: the text the document has now (its current version), so that a text that has changed is
 * never shown from what was kept of the one before it; a signature changes no text, so the pages are swapped without a blank.
 */
export const controlledContentKey = (documentId: number, version?: string | null, stamp?: string | null) =>
  ['governance-document', documentId, 'controlled-content', version || 'current', stamp ?? ''] as const;

/** The key of a Word or PDF file with the pages inserted: the version read, and a stamp of the record, so it is made again when the record has changed. */
export const controlledFileKey = (documentId: number | undefined, readingId: number | null | undefined, stamp: string) =>
  ['governance-document', documentId ?? 0, 'controlled-file', readingId ?? 'current', stamp] as const;

/** What changes whenever the record does: the version, the status and the row's own update time. */
export function recordStamp(doc: { current_version?: string | null; status?: string | null; updated_at?: string | null } | null | undefined): string {
  return [doc?.current_version, doc?.status, doc?.updated_at].map((v) => v ?? '').join('|');
}

/** Whether the file came with the pages inside it (`X-Controlled-Copy`); null when the server does not say. */
export function controlledCopy(headers: unknown): boolean | null {
  const v = headerOf(headers, 'x-controlled-copy').trim().toLowerCase();
  return v === 'true' ? true : v === 'false' ? false : null;
}

// ── dates and words ─────────────────────────────────────────────────────────────────────────────────────────
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MIDNIGHT = /T00:00:00(?:\.0+)?$/;

/**
 * A date on a page ("Date of approval", a revision's date): a calendar date is that day wherever it is read (the server keeps such
 * dates as UTC midnight); a moment is the day it was in the reader's own zone. Nothing valid: "—".
 */
export function formatPageDate(value: string | null | undefined, { locale, timeZone }: FormatOptions = {}): string {
  const d = parseUtc(value);
  if (!d) return NONE;
  if (typeof value === 'string' && (DATE_ONLY.test(value) || MIDNIGHT.test(value))) return formatDay(value, { locale });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', ...(timeZone ? { timeZone } : {}) });
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** A comment on a signature, cut for a page: one paragraph, at a word, with "…" (the whole of it is the cell's tooltip and the Change log's). */
export function cutComment(value: string | null | undefined, max = 240): string {
  const t = text(value).replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const space = head.lastIndexOf(' ');
  return `${(space > max * 0.6 ? head.slice(0, space) : head).replace(/[\s,;:.\-–—]+$/, '')}…`;
}

// ── the review and approval pages ───────────────────────────────────────────────────────────────────────────
/** The stages to draw, each with the people that are there: a payload with holes in it (a null stage, a null person) is drawn without them. */
export function stagesOf(rec: Partial<Pick<ApprovalRecord, 'stages'>> | null | undefined): RecordStage[] {
  return (Array.isArray(rec?.stages) ? rec.stages : []).filter(Boolean).map((s) => ({ ...s, people: (Array.isArray(s.people) ? s.people : []).filter(Boolean) }));
}

/** "STAGE 2 — APPROVED BY · Board approval": the bar over a stage's signatures (the route's own name for the stage after the dot). */
export function stageTitle(stage: Pick<RecordStage, 'position' | 'label' | 'name'>): string {
  const n = Number.isFinite(stage.position) ? ` ${stage.position}` : '';
  const head = `STAGE${n}${stage.label ? ` — ${stage.label.toUpperCase()}` : ''}`;
  return stage.name ? `${head} · ${stage.name}` : head;
}

/** What the bar says about the stage: "Complete · 3 of 3 signed"; the rule only when it is not everyone ("Any one of the 3 signs"). */
export function stageNote(stage: Pick<RecordStage, 'status' | 'people' | 'rule' | 'min_count'>): string {
  const rule = stage.rule && stage.rule !== 'all' ? ruleLine(stage) : '';
  return [stageStatusLabel(stage.status), stageSummary(stage), rule].filter((part) => part && part !== NONE).join(' · ');
}

/** What stands in the empty place of a drawn signature (nothing when there is one). */
export function signatureCaption(person: Pick<RecordPerson, 'decision' | 'signature'>, stageStatus?: string): string {
  if (person.signature) return '';
  if (person.decision === 'pending') return stageStatus === 'complete' ? 'Not required' : 'Awaiting signature';
  return person.decision === 'signed' ? 'No drawn signature' : '';
}

/** One person's cell: the printed name and designation, and what they did and when ("Signed 21 Oct 2026, 14:30 GMT+5"). */
export interface Cell {
  name: string;
  designation: string;
  /** "on behalf of Rana Qureshi" */
  behalf: string;
  status: string;
  caption: string;
  comment: string;
  fullComment: string;
}

export function personCell(person: RecordPerson, stage: Pick<RecordStage, 'status' | 'people'>, opts: FormatOptions = {}): Cell {
  const at = (v: string | null | undefined) => { const t = v ? formatDateTime(v, opts) : ''; return t && t !== NONE ? ` ${t}` : ''; };
  let status: string;
  switch (person.decision) {
    case 'signed': status = `Signed${at(person.signed_at)}`; break;
    case 'rejected': status = `Rejected${at(person.signed_at)}`; break;
    case 'changes_requested': status = `Asked for changes${at(person.signed_at)}`; break;
    case 'delegated': {
      const to = (stage.people ?? []).find((p) => p.on_behalf_of && p.on_behalf_of === person.name);
      status = to?.name ? `Delegated to ${to.name}` : 'Delegated';
      break;
    }
    default: status = decisionLabel(person.decision, stage.status);
  }
  const full = text(person.comment);
  return {
    name: text(person.name) || NONE,
    designation: text(person.designation),
    behalf: onBehalfLine(person),
    status,
    caption: signatureCaption(person, stage.status),
    comment: cutComment(full),
    fullComment: full,
  };
}

// ── the description ─────────────────────────────────────────────────────────────────────────────────────────
export interface DescriptionRow { label: string; value: string }

/**
 * The rows of the Document Description: the control fields the platform keeps, each falling back to the document's own when the
 * control field is missing. A row with nothing in it is left out, except Title, Version and Status.
 */
export function descriptionRows(rec: Partial<Pick<ApprovalRecord, 'control' | 'document'>> | null | undefined, opts: FormatOptions = {}): DescriptionRow[] {
  const c = rec?.control ?? null;
  const d = rec?.document ?? null;
  const first = (...v: unknown[]): string => v.map(text).find(Boolean) ?? '';
  const day = (...v: Array<string | null | undefined>): string => {
    const t = formatPageDate(v.find((x) => !!x), opts);
    return t === NONE ? '' : t;
  };
  const type = c?.type_label ? text(c.type_label) : c?.type || d?.type ? typeLabel(first(c?.type, d?.type)) : '';
  const classification = first(c?.classification, d?.classification);          // stored as typed ("internal"); the Word and PDF pages print it capitalised
  const rows: Array<[string, string, boolean]> = [
    ['Title', first(c?.title, d?.title), true],
    ['Document code', first(c?.code, d?.code), false],
    ['Version', first(c?.version, d?.version), true],
    ['Document type', type, false],
    ['Classification', classification ? typeLabel(classification) : '', false],
    ['Ownership', first(c?.ownership), false],
    ['Owner', first(c?.owner, d?.owner), false],
    ['Department', first(c?.department, d?.department), false],
    ['Approving authority', first(c?.approving_authority), false],
    ['Date of approval', day(c?.date_of_approval, d?.approved_at), false],
    ['Date of implementation', day(c?.date_of_implementation, d?.effective_date), false],
    ['Review frequency', first(c?.review_frequency), false],
    ['Last approval date', day(c?.last_approval_date), false],
    ['Next review date', day(c?.next_review_date, d?.next_review_date), false],
    ['Status', first(c?.status, d?.status) ? statusLabel(first(c?.status, d?.status)) : '', true],
  ];
  return rows.filter(([, value, always]) => value || always).map(([label, value]) => ({ label, value: value || NONE }));
}

// ── revision and approval history ───────────────────────────────────────────────────────────────────────────
export interface RevisionLine { version: string; mark: string; date: string; changeType: string; summary: string; updatedBy: string }

/** The Revision History table, oldest first as the server sends it; the version being worked on, not yet released, is marked "In progress". */
export function revisionRows(rows: RecordRevision[] | null | undefined, opts: FormatOptions = {}): RevisionLine[] {
  return (Array.isArray(rows) ? rows : []).filter(Boolean).map((r) => ({
    version: text(r.version) || NONE,
    mark: r.released === false ? 'In progress' : '',
    date: formatPageDate(r.date, opts),
    changeType: typeLabel(r.change_type),
    summary: text(r.summary) || NONE,
    updatedBy: text(r.updated_by) || NONE,
  }));
}

export interface ApprovalLine { version: string; reviewers: string[]; approvers: string[]; date: string }

/** The Approval History table: who reviewed and who approved each version ("Name, Designation"; an approver's stage after it), when. */
export function approvalRows(rows: RecordApprovalRow[] | null | undefined, opts: FormatOptions = {}): ApprovalLine[] {
  const who = (p: { name?: string | null; designation?: string | null; stage?: string | null }): string => {
    const name = text(p?.name);
    return name ? `${name}${text(p.designation) ? `, ${text(p.designation)}` : ''}${text(p.stage) ? ` (${text(p.stage)})` : ''}` : '';
  };
  return (Array.isArray(rows) ? rows : []).filter(Boolean).map((r) => ({
    version: text(r.version) || NONE,
    reviewers: (Array.isArray(r.reviewed_by) ? r.reviewed_by : []).map(who).filter(Boolean),
    approvers: (Array.isArray(r.approved_by) ? r.approved_by : []).map(who).filter(Boolean),
    date: formatPageDate(r.approval_date, opts),
  }));
}

/** "Record reference DAR-5-1.2-ab12cd34 · Generated 25 Oct 2026, 10:00 GMT+5": quote it when asking about these pages. */
export function referenceLine(rec: Pick<ApprovalRecord, 'reference' | 'generated_at'> | null | undefined, opts: FormatOptions = {}): string {
  const generated = rec?.generated_at ? formatDateTime(rec.generated_at, opts) : '';
  return [rec?.reference ? `Record reference ${rec.reference}` : '', generated && generated !== NONE ? `Generated ${generated}` : ''].filter(Boolean).join(' · ');
}
