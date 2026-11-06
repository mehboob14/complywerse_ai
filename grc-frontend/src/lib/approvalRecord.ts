/**
 * The approval record of every governance document: who prepared, reviewed and approved it, in which stages, with their signatures and
 * dates, the workflow that ran from draft to publication, the revision history and the approval history of earlier versions. The platform
 * builds it from the document's own workflow and signatures; nobody types it. Its pages ("document control pages") are PART of the
 * document: a platform document shows them in its own sections (GET /governance/documents/{id}/controlled-content), a Word or PDF file
 * comes with them inserted after the cover (download-file / export with `with_record=true`), and .../approval-record/export?format=pdf
 * is the pages alone. The words, dates and rules below are pure, so they are tested with node --test (approvalRecord.test.ts, and
 * controlPages.test.ts for the pages); the pages are drawn by documents/[id]/ControlPages.tsx.
 */
import { parseUtc } from './serverTime.ts';

// ── what the server answers ──────────────────────────────────────────────────
export type RecordState = 'published' | 'approved' | 'in_approval' | 'in_review' | 'draft' | 'archived';
export type StageStatus = 'complete' | 'pending' | 'changes_requested' | 'rejected';
export type StageRule = 'all' | 'any' | 'at_least';
export type Decision = 'signed' | 'rejected' | 'pending' | 'changes_requested' | 'delegated';
export type MilestoneEvent =
  | 'Prepared' | 'Sent for review' | 'Stage complete' | 'Changes requested' | 'Resubmitted' | 'Rejected' | 'Approved' | 'Published' | 'Archived';

/** The drawn signature behind a signed row: fetched with the sign-in (SignatureImage), its short seal code, checked by Verify. */
export interface RecordSignature { id: number; drawn: boolean; seal_short: string }

export interface RecordPerson {
  name: string;
  designation: string | null;
  decision: Decision;
  /** what signing means here: "Reviewed by", "Approved by" */
  meaning: string;
  signed_at: string | null;
  comment: string | null;
  /** a delegate signs for someone: that person's name */
  on_behalf_of: string | null;
  signature: RecordSignature | null;
}

export interface RecordStage {
  position: number;
  /** "Reviewed by", "Approved by" */
  label: string;
  /** the stage's own name when its route gave one ("Compliance review") */
  name: string | null;
  rule: StageRule;
  min_count: number | null;
  status: StageStatus;
  people: RecordPerson[];
}

export interface RecordMilestone { at: string | null; event: MilestoneEvent; actor: string | null; detail: string | null }

export interface RecordHistoryRow {
  version: string;
  approved_at: string | null;
  published_at: string | null;
  summary: string | null;
  prepared_by: string | null;
  approvers: Array<{ name: string; designation: string | null; meaning: string; signed_at: string | null }>;
}

export interface RecordDocument {
  id: number;
  code: string | null;
  title: string;
  type: string | null;
  classification: string | null;
  version: string | null;
  status: string | null;
  department: string | null;
  owner: string | null;
  author: string | null;
  effective_date: string | null;
  next_review_date: string | null;
  approved_at: string | null;
  published_at: string | null;
  published_by: string | null;
}

export interface RecordRound { version: string | null; started_at: string | null; completed_at: string | null; complete: boolean }

/** The "Document Description" fields the platform keeps for the document (strings or null; dates are ISO, UTC without a zone). */
export interface RecordControl {
  title: string | null;
  code: string | null;
  version: string | null;
  type: string | null;
  /** the type as people say it ("Policy") */
  type_label: string | null;
  classification: string | null;
  owner: string | null;
  department: string | null;
  /** the function that owns it ("Governance and Risk Office") */
  ownership: string | null;
  approving_authority: string | null;
  date_of_approval: string | null;
  date_of_implementation: string | null;
  review_frequency: string | null;
  last_approval_date: string | null;
  next_review_date: string | null;
  status: string | null;
}

/** One row of the Revision History, oldest first; `released` false: the version being worked on. */
export interface RecordRevision {
  version: string;
  date: string | null;
  change_type: string | null;
  summary: string | null;
  updated_by: string | null;
  released: boolean;
}

export interface RecordSignatory { name: string; designation: string | null }
/** `stage`: the stage the approver signed at, when the document had more than one. */
export interface RecordApprover extends RecordSignatory { stage: string | null }

/** One row of the Approval History, oldest first. */
export interface RecordApprovalRow { version: string; reviewed_by: RecordSignatory[]; approved_by: RecordApprover[]; approval_date: string | null }

export interface ApprovalRecord {
  /** "DAR-5-1.2-ab12cd34": quote it when asking about this record */
  reference: string;
  generated_at: string;
  document: RecordDocument;
  state: RecordState;
  round: RecordRound | null;
  prepared_by: { name: string | null; designation: string | null; at: string | null } | null;
  stages: RecordStage[];
  milestones: RecordMilestone[];
  history: RecordHistoryRow[];
  notes: string[];
  /** the three below are the control pages' own data; a server from before them leaves them out */
  control?: RecordControl | null;
  revision_history?: RecordRevision[] | null;
  approval_history?: RecordApprovalRow[] | null;
}

/** Where a platform document's pages go: its Document Description, its review and approval pages, its Revision History. */
export type ControlSlot = 'description' | 'signoff' | 'revision';

/** The document cut where its own sections are: the text between them, and the places the platform fills (`heading` false: the document's own heading stays above the slot; true: it had none, the slot brings its title). */
export type ControlledSegment = { type: 'markdown'; text: string } | { type: 'slot'; slot: ControlSlot; heading?: boolean };

/** GET /governance/documents/{id}/controlled-content[?version=]: `kind` "file" (Word, PDF) has no segments, its pages are inside the file. */
export interface ControlledContent { kind: 'markdown' | 'file'; segments: ControlledSegment[] | null; record: ApprovalRecord }

// ── words ────────────────────────────────────────────────────────────────────
/** What an empty cell says (a date nobody has set, a signature nobody has given). */
export const NONE = '—';

const humanize = (s: string | null | undefined): string => {
  const t = (s ?? '').replace(/_/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

/** The document's own status (the "Status" of the Document Description), as the rest of the page says it. */
const STATUS: Record<string, string> = {
  draft: 'Draft', pending_review: 'In review', pending_approval: 'Awaiting approval', approved: 'Approved', published: 'Published',
  expired: 'Expired', archived: 'Archived',
};
export const statusLabel = (status: string | null | undefined): string => STATUS[status ?? ''] ?? (humanize(status) || NONE);
export const typeLabel = (type: string | null | undefined): string => humanize(type) || NONE;

const STAGE: Record<StageStatus, string> = {
  complete: 'Complete',
  pending: 'Pending',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
};
export const stageStatusLabel = (status: string): string => STAGE[status as StageStatus] ?? (humanize(status) || NONE);

const DECISION: Record<Decision, string> = {
  signed: 'Signed',
  rejected: 'Rejected',
  pending: 'Waiting',
  changes_requested: 'Asked for changes',
  delegated: 'Delegated',
};
/** In a stage that is complete (any one of them, at least N) the others are no longer waited for. */
const notNeeded = (decision: string, stageStatus?: string): boolean => decision === 'pending' && stageStatus === 'complete';

/** A person who has not signed yet is "Waiting", never an empty cell; once their stage is complete without them, "Not needed". */
export const decisionLabel = (decision: string, stageStatus?: string): string =>
  notNeeded(decision, stageStatus) ? 'Not needed' : DECISION[decision as Decision] ?? (humanize(decision) || NONE);

/** The people a stage counts: someone who handed the step to a delegate is not asked to sign as well. */
export const countedPeople = (people: RecordPerson[] | null | undefined): RecordPerson[] => (people ?? []).filter((p) => p.decision !== 'delegated');

/** "2 of 3 signed". */
export function stageSummary(stage: Pick<RecordStage, 'people'>): string {
  const people = countedPeople(stage.people);
  if (!people.length) return 'Nobody asked';
  return `${people.filter((p) => p.decision === 'signed').length} of ${people.length} signed`;
}

/** What the stage needs, when that is not everyone: "Any one of the 3 signs", "At least 2 of the 3 sign". */
export function ruleLine(stage: Pick<RecordStage, 'rule' | 'min_count' | 'people'>): string {
  const n = countedPeople(stage.people).length;
  if (n < 2) return '';
  if (stage.rule === 'any') return `Any one of the ${n} signs`;
  if (stage.rule === 'at_least') return `At least ${Math.max(1, Math.min(stage.min_count ?? 1, n))} of the ${n} sign`;
  return 'Everyone signs';
}

/** "on behalf of Rana Qureshi" under a delegate's name; nothing otherwise. */
export const onBehalfLine = (p: Pick<RecordPerson, 'on_behalf_of'>): string => (p.on_behalf_of ? `on behalf of ${p.on_behalf_of}` : '');

/** What stands where the stage tables would be, when nobody was ever asked. */
export function noStagesLine(state: string | null | undefined): string {
  if (state === 'draft') return 'Not yet sent for review.';
  if (state === 'archived') return 'No review or approval was recorded for this version.';
  return 'No review or approval stages are recorded for this version.';
}

// ── dates ────────────────────────────────────────────────────────────────────
/** (a language and a zone are only given by tests; the screen shows the reader's own) */
export interface FormatOptions { locale?: string; timeZone?: string }

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date (effective, next review): that day itself, whatever zone the reader is in; the server keeps such dates as UTC midnight. */
export function formatDay(value: string | null | undefined, { locale }: Pick<FormatOptions, 'locale'> = {}): string {
  const d = parseUtc(value);
  return d ? d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : NONE;
}

/** A moment (a signature, a step) in the reader's own zone, with the zone's name: "21 Oct 2026, 14:30 GMT+5". The server's times are UTC without a zone. */
export function formatDateTime(value: string | null | undefined, { locale, timeZone }: FormatOptions = {}): string {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return formatDay(value, { locale });
  const d = parseUtc(value);
  if (!d) return NONE;
  return d.toLocaleString(locale, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', ...(timeZone ? { timeZone } : {}),
  });
}

/** "Version 1.2: started …, completed …" / "…, still in progress"; nothing before a round has started. */
export function roundLine(round: RecordRound | null | undefined, opts: FormatOptions = {}): string {
  if (!round?.started_at) return '';
  const head = `${round.version ? `Version ${round.version}: ` : ''}started ${formatDateTime(round.started_at, opts)}`;
  return round.complete && round.completed_at ? `${head}, completed ${formatDateTime(round.completed_at, opts)}` : `${head}, still in progress`;
}

// ── downloads ────────────────────────────────────────────────────────────────
/** One response header, by its lower-case name; "" when there is none. */
export const headerOf = (headers: unknown, name: string): string => {
  if (!headers || typeof headers !== 'object') return '';
  const h = headers as Record<string, unknown>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name);
  return key ? String(h[key] ?? '') : '';
};

/**
 * What a download says about itself: the file's name (Content-Disposition, else `fallbackName`) and whether the approval record could not be put
 * inside it and comes as a file of its own (`X-Approval-Record: separate`, for a file type the platform does not rewrite).
 */
export function exportReply(headers: unknown, fallbackName: string): { filename: string; separate: boolean } {
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(headerOf(headers, 'content-disposition'))?.[1];
  let filename = fallbackName;
  if (named) {
    try { filename = decodeURIComponent(named); } catch { filename = named; }
  }
  return { filename, separate: headerOf(headers, 'x-approval-record').trim().toLowerCase() === 'separate' };
}

/** "Access Control Policy v1.2 - approval record.pdf": a name every system accepts. */
export function recordFileName(title: string | null | undefined, version?: string | null): string {
  const clean = (title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${clean || 'Document'}${version ? ` v${version}` : ''} - approval record.pdf`;
}

// the axios client is loaded when a call is made, so the rules above also run under node --test (no app, no '@/' paths)
const http = async () => (await import('@/lib/api')).default;

/** The approval record alone, as a PDF (`version`: the one being read, when it is not the current one). */
export async function approvalRecordExport(
  documentId: number,
  { version, fallbackName }: { version?: string | null; fallbackName?: string } = {},
): Promise<{ blob: Blob; filename: string }> {
  const res = await (await http()).get(`/governance/documents/${documentId}/approval-record/export`, {
    params: { format: 'pdf', ...(version ? { version } : {}) },
    responseType: 'blob',
  });
  return { blob: res.data as Blob, filename: exportReply(res.headers, fallbackName || 'approval-record.pdf').filename };
}
