/**
 * AI Studio API (`/governance/studio`). The studio keeps a document as Markdown and cuts it into blocks; the AI proposes
 * changes to blocks, the person accepts them. Every call goes through the shared axios client (token + tenant header).
 */
import apiClient from '@/lib/api';
import type { ChainHunk } from '@/lib/documentChain';

const base = '/governance/studio';

// ── types ────────────────────────────────────────────────────────────────────
export interface StudioStatus {
  enabled: boolean;
  ai_configured?: boolean;
  doc_types?: string[];
  max_upload_mb?: number;
  /** an administrator may make a template the organisation's default */
  is_admin?: boolean;
}

export type LogoPosition = 'header-left' | 'header-center' | 'header-right' | 'footer-left' | 'footer-center' | 'footer-right';

export interface Instructions {
  entity_name?: string;
  logo_asset_id?: number | null;
  logo_position?: LogoPosition;
  logo_required?: boolean;
  /** a faint word across every page of an exported Word, PDF or web page ("DRAFT" when no text is given) */
  watermark?: boolean;
  watermark_text?: string;
  focus_areas?: string;
  tone?: string;
  language?: string;
  audience?: string;
  citation_style?: string;
  /** how the document was set up before it was written (`SetupOptions` lists the choices); Comply Agent does not ask about these again */
  entity_type?: string;
  country?: string;
  other_countries?: string[];
  regulators?: string[];
  regulations?: string[];
  regulatory_notes?: string;
  domains?: string[];
  departments?: string[];
  length?: 'short' | 'standard' | 'comprehensive' | '';
  classification?: string;
  review_cycle?: string;
  [key: string]: unknown;
}

/** What a new document can be set up with: the organisation's own data first (its departments, the regulators it follows, its
 * regulatory register, the platform's frameworks), then the usual choices. */
export interface SetupOptions {
  entity_types: string[];
  countries: string[];
  country_from_profile: string;
  regulators: Record<string, string[]>;
  regulators_followed: { label: string; country: string }[];
  regulations: { label: string; detail: string }[];
  frameworks: { id: number; label: string; attached: boolean }[];
  domains: string[];
  departments: string[];
  audiences: string[];
  lengths: { value: 'short' | 'standard' | 'comprehensive'; label: string; detail: string }[];
  classifications: string[];
  review_cycles: string[];
}

export interface Reference {
  id: number;
  key: string;
  kind: 'parent_document' | 'document' | 'framework' | 'upload' | 'template';
  title: string;
  label: string | null;
  source_id: number | null;
  chars: number;
  truncated: boolean;
  include: boolean;
  /** `query`: the topic of a "controls about a topic" selection (a server that keeps it) */
  scope: { mode?: string; domains?: string[]; count?: number; total?: number; query?: string } | null;
  notes: string[];
}

export interface Session {
  id: number;
  title: string;
  kind: 'new' | 'upload' | 'library';
  doc_type: string;
  status: string;
  document_id: number | null;
  /** the library document's own version (the one its file states, then major or minor by each change) */
  document_version?: string | null;
  /** the library document's status (draft, pending_review, pending_approval, approved, published …) */
  document_status?: string | null;
  /** the studio's text differs from the library version it is based on: Save to the library makes it the next version */
  unsaved_in_library?: boolean;
  /** the version everyone else reads while this one is on its way (null: none or the same) */
  document_version_in_force?: string | null;
  /** the person may save it back to the library (Save to the library, Move to the library); missing: allowed */
  may_save?: boolean;
  revision: number;
  base_label: string | null;
  instructions: Instructions;
  settings: { auto_apply?: boolean };
  template_id: string | null;
  source: { kind: string | null; name: string | null; in_place: boolean };
  references: Reference[];
  reference_chars: number;
  words: number;
  blocks: number;
  created_at: string | null;
  updated_at: string | null;
  content?: string;
}

export type OpStatus = 'pending' | 'accepted' | 'rejected' | 'conflict' | 'reverted';

export interface Op {
  id: string;
  /** `tidy`: the spacing of a Word file (stray spaces, line breaks, empty lines), which is not in the text */
  kind: 'replace' | 'insert' | 'delete' | 'replace_all' | 'tidy';
  start: string;
  end: string;
  markdown: string;
  reason: string;
  refs: string[];
  status: OpStatus;
  why?: string;
  words_added: number;
  words_removed: number;
  before: { index: number; kind: string; text: string }[];
  before_count: number;
  after: { kind: string; level?: number; text: string }[];
  after_count: number;
  /** who accepted it and in which revision (accepted changes), and who took it back */
  accepted_by?: number | null;
  accepted_at?: string | null;
  revision?: number;
  reverted_by?: number | null;
  reverted_at?: string | null;
}

export interface ReferenceUsed {
  ref: string;
  title: string;
  kind: string;
  locator: string;
  quote: string;
  how: string;
  basis: 'reference' | 'general_knowledge' | 'instruction';
  verified: boolean | null;
  locator_ok: boolean | null;
}

export interface Verdict {
  requirement: string;
  status: 'met' | 'partly' | 'not_met';
  evidence: string;
  block?: number | null;
}

export interface Stats {
  inserted: number;
  deleted: number;
  modified: number;
  words_added: number;
  words_removed: number;
}

export interface Issue {
  id: string;
  kind: string;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  block: number | null;
  quote: string;
  message: string;
  suggestion: string | null;
  fix: Record<string, unknown> | null;
}

export interface CompareDifference {
  topic: string;
  in_a: string;
  in_b: string;
  importance: 'high' | 'medium' | 'low';
  recommendation: string;
}

/** What the screen shows while a turn works, beyond one line: the steps taken, the text written so far, and for a whole document each part. */
export interface LiveView {
  seq: number;
  steps?: { label: string; state: 'done' | 'active'; detail?: string }[];
  /** the reply as far as it is written; with `text_label` it is not a reply but what the label says (the approach of a document being planned) */
  text?: string;
  text_label?: string;
  /** what has been produced so far: the changes being prepared, the choices made, the areas to cover */
  groups?: { label: string; items: string[] }[];
  parts?: { id: string; label: string; state: 'todo' | 'writing' | 'rewriting' | 'done' | 'failed'; words: number; phase?: 'reading' | 'thinking' | 'writing'; note?: string }[];
  /** the last lines of the text being written, and what it is */
  tail?: string;
  tail_label?: string;
  /** a whole document being written: grows each time more of it can be shown (`studioApi.draftPreview`) */
  preview_seq?: number;
}

export interface Progress {
  id: number;
  status: 'working' | 'done' | 'error' | 'stopped';
  stage: string | null;
  live: LiveView | null;
}

export interface QuestionOption {
  label: string;
  /** what the choice means, or when it applies: Comply Agent teaches as it asks */
  detail: string;
  recommended: boolean;
}

/** A question Comply Agent asks before (or after) it writes, answered by clicking one option, several, or in words. */
export interface Question {
  id: string;
  question: string;
  why: string;
  kind: 'single' | 'multiple' | 'text';
  options: QuestionOption[];
  /** the person may answer in their own words as well */
  other: boolean;
  /** once answered: what was chosen, or that Comply Agent was left to decide */
  answer?: { id: string; chosen?: string[]; other?: string; decide?: boolean };
}

export interface AnswerItem {
  id: string;
  chosen: string[];
  other?: string;
  question?: string;
}

/** A file attached in the chat: it is a reference of the session (R3 ...) */
export interface Attachment {
  id: number;
  key: string;
  title: string;
}

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  kind: 'chat' | 'checks' | 'compare';
  content: string;
  /** stopped: the person pressed Stop and nothing it was writing was applied */
  status: 'working' | 'done' | 'error' | 'stopped';
  stage: string | null;
  /** present while the turn works (an older server sends none) */
  live?: LiveView | null;
  error: string | null;
  proposal:
    | null
    | ({ ops?: Op[]; base_revision?: number; stats?: Stats | null; placeholders?: number; requirements?: Verdict[] } & {
        issues?: Issue[];
        summary?: string;
        revision?: number;
        differences?: CompareDifference[];
        recommendation?: string;
        other_title?: string;
        /** "draft": a whole new document asked these questions before it was written */
        ask_first?: string;
      });
  references_used: ReferenceUsed[];
  /** what Comply Agent asks; an older message holds plain strings */
  questions: Array<Question | string>;
  /** on a person's message: their answers to the questions of the message it replies to */
  answers?: { reply_to: number; items: AnswerItem[]; decide?: string[] } | null;
  /** on a person's message: the files attached with it in the chat (references of the session) */
  attachments?: Attachment[];
  notes: string[];
  base_revision: number | null;
  usage: { input_tokens?: number; output_tokens?: number; cached_tokens?: number } | null;
  created_at: string | null;
}

export interface Revision {
  number: number;
  author_type: 'user' | 'ai' | 'import' | 'system' | 'restore' | 'revert';
  author: string | null;
  summary: string;
  stats: Stats | null;
  created_at: string | null;
  words: number;
}

export type Segment = [op: 'equal' | 'insert' | 'delete', text: string];

export interface RedlineRow {
  status: 'equal' | 'modified' | 'inserted' | 'deleted';
  kind: 'heading' | 'paragraph' | 'list_item' | 'table' | 'quote' | 'code' | 'hr' | 'raw';
  level: number;
  ordered: boolean;
  base_index: number | null;
  cur_index: number | null;
  format_only: boolean;
  segments?: Segment[];
  table?: { status: string; cells: Segment[][] }[];
  was?: { kind: string; level: number; ordered?: boolean };
  /** how the block's place in the outline changed ("Heading 2 → Heading 3", "Renumbered 3 → 4") */
  structure?: string[];
  /** the change this block belongs to (see `Redline.hunks`); null when unchanged */
  hunk?: number | null;
}

export interface Redline {
  rows: RedlineRow[];
  stats: Stats;
  from?: number | null;
  /** Tracked changes (GET …/tracked): what it is counted from ("Changes since v1.0 (the original)") and that library version */
  label?: string;
  from_version_id?: number | null;
  to?: number;
  other_title?: string;
  ai_message?: Message;
  applied?: string[];
  /** the changes (for a redline of the session's own revisions), who made each, and whether they can be taken back */
  hunks?: ChainHunk[];
  hash?: string;
  can_revert?: boolean;
}

export interface TemplateItem {
  id: string;
  name: string;
  doc_type: string;
  description: string;
  content: string;
  structure: { sections: { key: string; title: string; required?: boolean; annex?: boolean }[] } | null;
  builtin: boolean;
  is_default: boolean;
  replaced_by_default?: boolean;
  updated_at?: string | null;
}

export interface LibraryDoc {
  id: number;
  title: string;
  code: string | null;
  doc_type: string;
  status: string;
  version: string;
  has_file: boolean;
  has_text: boolean;
}

export interface FrameworkItem {
  id: number;
  name: string;
  version: string | null;
  organisation: string | null;
  controls: number;
  domains: string[];
}

export interface Asset {
  id: number;
  kind: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  is_default: boolean;
  created_at: string | null;
}

export interface ExportNote {
  level: 'error' | 'warning' | 'info';
  rule: string;
  text: string;
  count?: number;
}

export interface ExportOptions {
  format: 'docx' | 'pdf' | 'md' | 'html';
  logo_asset_id?: number | null;
  no_logo?: boolean;
  entity_name?: string | null;
  logo_position?: string | null;
  highlight_placeholders?: boolean;
}

export interface ReferenceScope {
  mode?: 'all' | 'domains' | 'controls' | 'query';
  domains?: string[];
  control_refs?: string[];
  query?: string;
}

export interface MoveToLibrary {
  title?: string;
  doc_type?: string;
  classification?: string;
  parent_document_id?: number | null;
  framework_ids?: number[];
  description?: string;
  owner_id?: number;
  department_id?: number;
  review_cycle_months?: number;
  effective_date?: string;                       // YYYY-MM-DD
  next_review_date?: string;                     // the effective date (or today) + the review cycle when left out
}

/** The sentence the server wrote for a failed call (never a stack trace). */
export function problemOf(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = error as { response?: { data?: { detail?: unknown } }; message?: string };
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) return String((detail[0] as { msg?: string })?.msg || fallback);
  return fallback;
}

export function isConflict(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 409;
}

// ── calls ────────────────────────────────────────────────────────────────────
const get = async <T>(path: string, params?: Record<string, unknown>): Promise<T> => (await apiClient.get(`${base}${path}`, { params })).data;
const post = async <T>(path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> => (await apiClient.post(`${base}${path}`, body ?? {}, { params })).data;
const put = async <T>(path: string, body?: unknown): Promise<T> => (await apiClient.put(`${base}${path}`, body ?? {})).data;
const patch = async <T>(path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> => (await apiClient.patch(`${base}${path}`, body ?? {}, { params })).data;
const del = async <T>(path: string): Promise<T> => (await apiClient.delete(`${base}${path}`)).data;

export const studioApi = {
  status: () => get<StudioStatus>('/status'),
  documents: (q = '', limit = 30) => get<{ items: LibraryDoc[] }>('/documents', { q, limit }),
  frameworks: () => get<{ items: FrameworkItem[] }>('/frameworks'),

  templates: () => get<{ items: TemplateItem[] }>('/templates'),
  saveTemplate: (body: { session_id?: number; name: string; doc_type?: string; description?: string; content?: string; make_default?: boolean }) =>
    post<TemplateItem>('/templates', body),
  updateTemplate: (id: number, body: { name: string; doc_type?: string; description?: string; content?: string; make_default?: boolean }) =>
    put<TemplateItem>(`/templates/${id}`, body),
  deleteTemplate: (id: number) => del<{ deleted: boolean }>(`/templates/${id}`),

  sessions: () => get<{ items: Session[] }>('/sessions'),
  /** `content` + `template_name`: a new document started from a template of the platform's catalogue (its Markdown). */
  createSession: (body: { kind: 'new' | 'library'; title?: string; doc_type?: string; template_id?: string | null; document_id?: number | null; instructions?: Instructions; content?: string; template_name?: string }) =>
    post<Session>('/sessions', body),
  /** `details`: what the library document is created with (classification, description, owner_id, department_id,
   *  review_cycle_months, effective_date, next_review_date, parent_document_id), as the person confirmed them. */
  uploadSession: async (file: File, docType: string, title = '', details: Record<string, string | number> = {}): Promise<Session> => {
    const form = new FormData();
    form.append('file', file);
    form.append('doc_type', docType);
    form.append('title', title);
    for (const [key, value] of Object.entries(details)) if (!['doc_type', 'title'].includes(key)) form.append(key, String(value));
    return (await apiClient.post(`${base}/sessions/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
  },
  session: (id: number) => get<Session>(`/sessions/${id}`),
  /** the person opened the workspace (the GET only reads) */
  opened: (id: number) => post<{ ok: boolean }>(`/sessions/${id}/opened`),
  patchSession: (id: number, body: { title?: string; doc_type?: string; instructions?: Instructions; settings?: { auto_apply?: boolean } }) =>
    patch<Session>(`/sessions/${id}`, body),
  deleteSession: (id: number) => del<{ deleted: boolean }>(`/sessions/${id}`),
  /** the choices a document can be set up with (saved as instructions) */
  setupOptions: (id: number) => get<SetupOptions>(`/sessions/${id}/setup`),
  saveContent: (id: number, content: string, baseRevision?: number, summary?: string) =>
    put<{ revision: number; saved: boolean; words: number }>(`/sessions/${id}/content`, { content, base_revision: baseRevision, summary }),

  addReference: (id: number, body: { kind: Reference['kind']; source_id?: number | null; scope?: ReferenceScope; template_id?: string }) =>
    post<Reference>(`/sessions/${id}/references`, body),
  uploadReference: async (id: number, file: File): Promise<Reference> => {
    const form = new FormData();
    form.append('file', file);
    return (await apiClient.post(`${base}/sessions/${id}/references/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
  },
  toggleReference: (id: number, refId: number, include: boolean) => patch<Reference>(`/sessions/${id}/references/${refId}`, {}, { include }),
  removeReference: (id: number, refId: number) => del<{ deleted: boolean }>(`/sessions/${id}/references/${refId}`),
  readReference: (id: number, refId: number) => get<Reference & { text: string }>(`/sessions/${id}/references/${refId}`),

  messages: (id: number) => get<{ items: Message[] }>(`/sessions/${id}/messages`),
  /** the state of the latest turns, small enough to ask for several times a second while the AI works */
  progress: (id: number) => get<{ items: Progress[] }>(`/sessions/${id}/progress`),
  send: (id: number, text: string, extra?: { reply_to?: number; answers?: AnswerItem[]; decide?: boolean; attachments?: number[] }) =>
    post<Message>(`/sessions/${id}/messages`, { text, ...(extra ?? {}) }),
  message: (id: number, messageId: number) => get<Message>(`/sessions/${id}/messages/${messageId}`),
  /** stop Comply Agent where it is: nothing it was writing is applied (409 once it has finished) */
  stop: (id: number, messageId: number) => post<Message>(`/sessions/${id}/messages/${messageId}/stop`),
  /** a whole document as far as it is written, while Comply Agent writes it */
  draftPreview: (id: number, messageId: number) => get<{ seq: number; markdown: string }>(`/sessions/${id}/messages/${messageId}/preview`),
  /** `library_version`: a library document's next version, made by the accept (null when the document is not in the library) */
  accept: (id: number, messageId: number, body: { op_ids?: string[]; overrides?: Record<string, string> } = {}) =>
    post<{ accepted: number; conflicts: number; revision: number; content: string; message: Message; library_version?: LibraryVersion | null }>(`/sessions/${id}/messages/${messageId}/accept`, body),
  reject: (id: number, messageId: number, body: { op_ids?: string[] } = {}) => post<{ message: Message }>(`/sessions/${id}/messages/${messageId}/reject`, body),
  /** take a change that was accepted back out of the document (a new revision; `library_version` only if a server saves it too) */
  revertOp: (id: number, messageId: number, opId: string) =>
    post<{ content: string; revision: number; message: Message; library_version?: LibraryVersion | null }>(`/sessions/${id}/messages/${messageId}/ops/${opId}/revert`),
  /** take chosen changes since a revision back out of the document as it is now */
  revertChanges: (id: number, body: { frm: number; hunks: number[]; hash?: string; version_id?: number | null }) => post<{ content: string; revision: number }>(`/sessions/${id}/changes/revert`, body),
  preview: (id: number, messageId: number) => get<Redline>(`/sessions/${id}/messages/${messageId}/redline`),

  checks: (id: number, ai = false) => post<{ revision: number; issues: Issue[]; summary: { total: number; by_kind: Record<string, number>; by_severity: Record<string, number>; must_fill: number }; ai_message?: Message }>(`/sessions/${id}/checks`, {}, { ai }),
  lastAiCheck: (id: number) => get<{ message: Message | null; stale?: boolean }>(`/sessions/${id}/checks/ai`),
  fix: (id: number, fix: Record<string, unknown>, message?: string) => post<{ revision: number; content: string }>(`/sessions/${id}/checks/fix`, { fix, message }),
  fixAll: (id: number, kinds?: string[]) => post<{ fixed: number; revision: number; content: string }>(`/sessions/${id}/checks/fix-all`, { kinds }),
  /** every fix the checks offer, Comply Agent's suggestions and added sections too, in one revision; `skipped`: fixes that no longer fit */
  applyAll: (id: number) => post<{ fixed: number; skipped: number; revision: number; content: string }>(`/sessions/${id}/checks/fix-all`, { all: true }),

  revisions: (id: number) => get<{ items: Revision[]; base_label: string | null }>(`/sessions/${id}/revisions`),
  diff: (id: number, from: number, to?: number) => get<Redline>(`/sessions/${id}/diff`, { from, to }),
  /** Tracked changes: since the version in force, or the original until the document is published */
  tracked: (id: number) => get<Redline>(`/sessions/${id}/tracked`),
  restore: (id: number, number: number) => post<{ revision: number; content: string }>(`/sessions/${id}/restore/${number}`),
  compare: (id: number, body: { document_id?: number; revision?: number; reference_id?: number; ai?: boolean }) =>
    post<Redline>(`/sessions/${id}/compare`, body),

  moveToLibrary: (id: number, body: MoveToLibrary) => post<{ document_id: number; title: string; version: string }>(`/sessions/${id}/move-to-library`, body),
  saveToDocument: (id: number, body: { change_reason?: string; force?: boolean } = {}) =>
    post<{ document_id: number; version: string; status: string; change?: 'major' | 'minor' | null; in_place?: boolean }>(`/sessions/${id}/save-to-document`, body),

  assets: () => get<{ items: Asset[] }>('/assets'),
  uploadAsset: async (file: File, makeDefault = false): Promise<Asset> => {
    const form = new FormData();
    form.append('file', file);
    form.append('make_default', String(makeDefault));
    return (await apiClient.post(`${base}/assets`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
  },
  updateAsset: (id: number, body: { name?: string; is_default?: boolean }) => put<Asset>(`/assets/${id}`, body),
  deleteAsset: (id: number) => del<{ ok: boolean }>(`/assets/${id}`),
  assetBlob: async (id: number): Promise<Blob> => (await apiClient.get(`${base}/assets/${id}/file`, { responseType: 'blob' })).data,

  exportCheck: (id: number, options: ExportOptions) => post<{ format: string; notes: ExportNote[]; can_export: boolean }>(`/sessions/${id}/export/check`, options),
  exportFile: async (id: number, options: ExportOptions): Promise<{ blob: Blob; filename: string }> => {
    const res = await apiClient.post(`${base}/sessions/${id}/export`, options, { responseType: 'blob' });
    const header = String(res.headers['content-disposition'] || '');
    const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
    const plain = /filename="?([^";]+)"?/i.exec(header);
    return { blob: res.data as Blob, filename: star ? decodeURIComponent(star[1]) : plain ? plain[1] : `document.${options.format}` };
  },
  /** a Word file edited in place: what Word shows for each block that its text does not hold (numbers, indents) */
  layout: (id: number) => get<{ revision: number; blocks: BlockLook[] }>(`/sessions/${id}/layout`),
  /** the PDF the text was read from, as it is */
  sourceFile: async (id: number): Promise<Blob> => (await apiClient.get(`${base}/sessions/${id}/source-file`, { responseType: 'blob' })).data,
};

/** What Word shows for a block: the number in front of it, its indent in points (`hang`: the part the number sits in),
 *  `body` for a clause numbered through a heading style that looks like body text, and `locked` for what Word makes or draws
 *  itself (its table of contents, a text box, a diagram): shown, not edited here. */
export interface BlockLook { label?: string; left?: number; hang?: number; body?: boolean; locked?: boolean }

/** An accept that made the library document's next version (`change`: major is +1.0, minor +0.1), or why it did not */
export interface LibraryVersion { saved: boolean; version?: string; change?: 'major' | 'minor' | null; status?: string; why?: string; in_place?: boolean }

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A failed blob download carries its sentence inside the blob. */
export async function problemOfBlob(error: unknown): Promise<string> {
  const data = (error as { response?: { data?: Blob } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (typeof parsed?.detail === 'string') return parsed.detail;
    } catch {
      /* fall through */
    }
  }
  return problemOf(error);
}

export const DOC_TYPE_LABEL: Record<string, string> = {
  policy: 'Policy',
  standard: 'Standard',
  procedure: 'Procedure',
  guideline: 'Guideline',
  charter: 'Charter',
  other: 'Other document',
};
