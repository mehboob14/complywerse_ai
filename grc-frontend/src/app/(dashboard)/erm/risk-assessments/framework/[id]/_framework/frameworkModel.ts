// What a framework assessment's workspace decides, apart from React so `node --test` pins it (frameworkModel.test.ts): the question as the server sends it, the counts of the counters band, the
// filters (a person's own questions, the blocked ones, a phase, an assignee, a status, a search), "the next one still to answer", what a regenerate would delete (said in numbers BEFORE it
// happens), the phases' progress, and the notice that says how the questions were written. The score band is the area's one (assessmentModel.ratingOf: critical >= 20 ...).
import { fold, ratingOf, searchTerms, type Band } from '../../../_register/assessmentModel.ts';
import { flag, listOf, text, type ParamSpec } from '../../../../../../../lib/addressState.ts';
import { formatCount } from '../../../../../../../lib/format.ts';

export interface Evidence { id: number; file_name: string; description?: string | null; uploaded_at?: string | null; uploader_name?: string | null }

export interface Question {
  id: number;
  assessment_id?: number;
  question_text: string;
  status: string;
  assigned_user_id?: number | null;
  assigned_user_name?: string | null;
  inherent_likelihood?: number | null;
  inherent_impact?: number | null;
  inherent_score?: number | null;
  residual_likelihood?: number | null;
  residual_impact?: number | null;
  residual_score?: number | null;
  is_risk_accepted?: boolean;
  acceptance_notes?: string | null;
  linked_risk_id?: number | null;
  moved_to_risk_register_at?: string | null;
  order_index?: number | null;
  methodology_code?: string | null;
  phase_code?: string | null;
  clause_reference?: string | null;
  methodology_fields?: Record<string, string> | null;
  source_quote?: string | null;
  evidence?: Evidence[];
}

export interface FrameworkAssessment {
  id: number;
  tenant_id: number;
  name: string;
  description?: string | null;
  status: string;
  framework_name?: string | null;
  creator_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  questions: Question[];
  questions_count?: number;
}

export const QUESTION_STATUSES = ['not_started', 'in_progress', 'completed', 'blocked'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export const isDone = (q: Pick<Question, 'status'>): boolean => q.status === 'completed';
export const isBlocked = (q: Pick<Question, 'status'>): boolean => q.status === 'blocked';
export const rating = (q: Question): Band => ratingOf(q);

// ── counts ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Counts {
  total: number;
  byStatus: Record<QuestionStatus, number>;
  mine: number;
  unassigned: number;
  evidence: number;
  accepted: number;
  moved: number;
  /** the share completed, a whole percent; null with no questions */
  pct: number | null;
}

export function countsOf(qs: readonly Question[], me: number | null): Counts {
  const byStatus = { not_started: 0, in_progress: 0, completed: 0, blocked: 0 } as Record<QuestionStatus, number>;
  let mine = 0; let unassigned = 0; let evidence = 0; let accepted = 0; let moved = 0;
  qs.forEach((q) => {
    byStatus[(QUESTION_STATUSES as readonly string[]).includes(q.status) ? (q.status as QuestionStatus) : 'in_progress'] += 1;
    if (me != null && q.assigned_user_id === me && !isDone(q)) mine += 1;
    if (q.assigned_user_id == null) unassigned += 1;
    evidence += q.evidence?.length ?? 0;
    if (q.is_risk_accepted) accepted += 1;
    if (q.linked_risk_id) moved += 1;
  });
  return { total: qs.length, byStatus, mine, unassigned, evidence, accepted, moved, pct: qs.length ? Math.round((byStatus.completed / qs.length) * 100) : null };
}

// ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type QuickId = 'all' | 'mine' | 'blocked' | 'todo' | 'unassigned';
export const QUICK_IDS: readonly QuickId[] = ['all', 'mine', 'todo', 'blocked', 'unassigned'];
export const QUICK_LABEL: Record<QuickId, string> = { all: 'All questions', mine: 'Mine', todo: 'Still to answer', blocked: 'Blocked', unassigned: 'No one assigned' };

export interface QFilters { search: string; quick: QuickId; status: string[]; phase: string[]; assignee: string[] }
export const NO_QFILTERS: QFilters = { search: '', quick: 'all', status: [], phase: [], assignee: [] };

export function inQuick(id: QuickId, q: Question, me: number | null): boolean {
  switch (id) {
    case 'mine': return me != null && q.assigned_user_id === me;
    case 'blocked': return isBlocked(q);
    case 'todo': return !isDone(q);
    case 'unassigned': return q.assigned_user_id == null;
    default: return true;
  }
}

const textOf = (q: Question): string => fold([q.question_text, q.clause_reference, q.assigned_user_name, ...Object.values(q.methodology_fields ?? {})].filter(Boolean).join(' '));

export function filterQuestions(qs: readonly Question[], f: QFilters, me: number | null): Question[] {
  const terms = searchTerms(f.search);
  return qs.filter((q) => {
    if (!inQuick(f.quick, q, me)) return false;
    if (f.status.length && !f.status.includes(q.status)) return false;
    if (f.phase.length && !f.phase.includes(q.phase_code || 'none')) return false;
    if (f.assignee.length && !f.assignee.includes(q.assigned_user_id == null ? 'none' : String(q.assigned_user_id))) return false;
    if (terms.length) { const t = textOf(q); if (!terms.every((w) => t.includes(w))) return false; }
    return true;
  });
}

export const filterCount = (f: QFilters): number => (f.search.trim() ? 1 : 0) + (f.quick !== 'all' ? 1 : 0) + f.status.length + f.phase.length + f.assignee.length;

/** The next question after `currentId` (in the list as shown, wrapping round) that is not completed; null when every one is. */
export function nextToAnswer(shown: readonly Question[], currentId: number | null): Question | null {
  if (shown.length === 0) return null;
  const at = shown.findIndex((q) => q.id === currentId);
  for (let step = 1; step <= shown.length; step += 1) {
    const q = shown[(at + step + shown.length) % shown.length];
    if (!isDone(q) && q.id !== currentId) return q;
  }
  return null;
}

// ── the address ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const quick = (): ParamSpec<QuickId> => ({
  default: 'all',
  read: ([first]) => ((QUICK_IDS as readonly string[]).includes((first ?? '').trim()) ? ((first ?? '').trim() as QuickId) : undefined),
  write: (v) => (v === 'all' ? [] : [v]),
});

/** ?q=access&quick=mine&status=blocked&phase=identify&assignee=7&question=412 ; the old links: ?mine=1 is the quick view Mine, ?made=ai is read once for the notice. */
export const FRAMEWORK_SCHEMA = {
  q: text(),
  quick: quick(),
  status: listOf(QUESTION_STATUSES),
  phase: listOf(),
  assignee: listOf(),
  question: text(),
  mine: flag(),
  made: text(),
  page: text(),
};
export interface FrameworkAddress { q: string; quick: QuickId; status: string[]; phase: string[]; assignee: string[]; question: string; mine: boolean; made: string; page: string }
export function filtersOf(a: FrameworkAddress): QFilters {
  return { search: a.q, quick: a.quick !== 'all' ? a.quick : a.mine ? 'mine' : 'all', status: a.status, phase: a.phase, assignee: a.assignee };
}
export const filtersPatch = (f: QFilters): Partial<FrameworkAddress> => ({ q: f.search, quick: f.quick, status: f.status, phase: f.phase, assignee: f.assignee, mine: false });
export function questionIdOf(a: Pick<FrameworkAddress, 'question'>): number | null {
  const n = Number(a.question);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── a regenerate, said before it happens ─────────────────────────────────────────────────────────────────────────────────

export interface RegenerateFacts { total: number; withWork: number; withEvidence: number; evidenceFiles: number; moved: number }

/** A question "has work in it" when it is past not started, has a score, a methodology answer, an acceptance or a file. */
export function hasWork(q: Question): boolean {
  return q.status !== 'not_started' || q.inherent_score != null || q.residual_score != null || q.is_risk_accepted === true || (q.evidence?.length ?? 0) > 0
    || Object.values(q.methodology_fields ?? {}).some((v) => String(v ?? '').trim() !== '');
}

export function regenerateFacts(qs: readonly Question[]): RegenerateFacts {
  return {
    total: qs.length,
    withWork: qs.filter(hasWork).length,
    withEvidence: qs.filter((q) => (q.evidence?.length ?? 0) > 0).length,
    evidenceFiles: qs.reduce((n, q) => n + (q.evidence?.length ?? 0), 0),
    moved: qs.filter((q) => q.linked_risk_id).length,
  };
}

const plural = (n: number, one: string, many: string): string => `${formatCount(n)} ${n === 1 ? one : many}`;

/** The sentence a confirmation says: what goes, in numbers. */
export function regenerateWords(f: RegenerateFacts): string {
  if (f.total === 0) return 'There are no questions yet, so nothing is lost.';
  const parts = [`All ${plural(f.total, 'question', 'questions')} will be deleted and written again.`];
  if (f.withWork > 0) parts.push(`${plural(f.withWork, 'question has', 'questions have')} work in it (a status, scores, answers or a file) that will be lost.`);
  if (f.evidenceFiles > 0) parts.push(`${plural(f.evidenceFiles, 'uploaded file', 'uploaded files')} will be deleted.`);
  if (f.moved > 0) parts.push(`${plural(f.moved, 'risk', 'risks')} already moved to the Risk Register stay there, but lose their link to the question.`);
  parts.push('This cannot be undone.');
  return parts.join(' ');
}

// ── the phases ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PhaseRow { code: string; name: string; total: number; done: number; blocked: number }
export function phaseRows(qs: readonly Question[], phases: ReadonlyArray<{ code: string; name: string; order: number }>): PhaseRow[] {
  const known = phases.slice().sort((a, b) => a.order - b.order).map((p) => ({ code: p.code, name: p.name }));
  const rows: PhaseRow[] = known.map((p) => ({ ...p, total: 0, done: 0, blocked: 0 }));
  const other: PhaseRow = { code: 'none', name: 'No phase', total: 0, done: 0, blocked: 0 };
  qs.forEach((q) => {
    const row = rows.find((r) => r.code === q.phase_code) ?? other;
    row.total += 1;
    if (isDone(q)) row.done += 1;
    if (isBlocked(q)) row.blocked += 1;
  });
  return [...rows, other].filter((r) => r.total > 0);
}

export interface PersonRow { id: string; name: string; total: number; done: number; open: number }
export function assigneeRows(qs: readonly Question[]): PersonRow[] {
  const m = new Map<string, PersonRow>();
  qs.forEach((q) => {
    const id = q.assigned_user_id == null ? 'none' : String(q.assigned_user_id);
    const row = m.get(id) ?? { id, name: q.assigned_user_name || (id === 'none' ? 'No one assigned' : 'Someone no longer here'), total: 0, done: 0, open: 0 };
    row.total += 1;
    if (isDone(q)) row.done += 1; else row.open += 1;
    m.set(id, row);
  });
  return Array.from(m.values()).sort((a, b) => (a.id === 'none' ? 1 : b.id === 'none' ? -1 : b.open - a.open || a.name.localeCompare(b.name)));
}

// ── how the questions were written ───────────────────────────────────────────────────────────────────────────────────────

export type Made = 'methodology' | 'ai' | 'template';
export function madeOf(value: string | null | undefined): Made | null {
  return value === 'methodology' || value === 'ai' || value === 'template' ? value : null;
}
/** The notice above the questions after they were written: which way, and what to do about a template. */
export function madeNotice(made: Made, methodologyName?: string | null): { tone: 'info' | 'warning'; title: string; text: string } {
  if (made === 'methodology') return { tone: 'info', title: `Questions follow ${methodologyName ?? 'the assessment method'}`, text: 'One question for each requirement, in the phases of the method. Assign them, then follow the progress here.' };
  if (made === 'ai') return { tone: 'info', title: 'Questions were written by the AI', text: 'They come from the framework\'s own requirements. Read them before you assign them; edit or delete any that do not fit.' };
  return { tone: 'warning', title: 'Standard questions were used', text: 'The AI was not available, so generic questions were written ("Describe how your organization addresses ... requirement"). Regenerate when it is back, or edit them.' };
}

/** A bulk change is many calls; this is what to say when some of them failed. */
export function batchWords(done: number, failed: number, what: string): { ok: boolean; title: string; message: string } {
  if (failed === 0) return { ok: true, title: `${what}: done`, message: `${plural(done, 'question is', 'questions are')} updated.` };
  if (done === 0) return { ok: false, title: `${what}: not done`, message: `None of the ${plural(failed, 'question', 'questions')} could be updated.` };
  return { ok: false, title: `${what}: done in part`, message: `${plural(done, 'question was', 'questions were')} updated and ${plural(failed, 'was', 'were')} not.` };
}
