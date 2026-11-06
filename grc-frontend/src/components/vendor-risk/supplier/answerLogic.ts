// What a supplier's questionnaire needs before it can be sent, with no React in it so each rule can be tested on
// its own. These mirror the server (backend tpra/portal.py): which questions apply, when an answer still needs
// its words, when a document is owed. The server applies them again when the answers are sent.

export type QuestionType = 'text' | 'yes_no' | 'multiple_choice' | 'rating' | 'file' | 'number' | 'date';

/** An answer option. `na`/`not_applicable`: picking it needs a reason; `comment_required`: a note. */
export interface QuestionOption {
  value: string; label?: string; score?: number | null;
  na?: boolean; not_applicable?: boolean; comment_required?: boolean;
}

/** What the question rules read (tpra/portal.py). */
export interface RuleQuestion {
  type?: string;
  evidence?: 'none' | 'optional' | 'required';
  evidence_on?: string[];                  // answers that owe the evidence; empty: any answer
  evidence_required?: boolean;             // before the rules: owed on Yes or Partial
  options?: Array<string | QuestionOption>;
}

/** A question as the supplier is sent it: what to ask and how to answer, never how an answer scores. */
export interface PortalQuestion extends RuleQuestion {
  id: string;
  text: string;
  type: QuestionType;
  required: boolean;
  help?: string | null;                                // what the builder writes under a question
  help_text?: string | null;
  show_if?: { question: string; in: string[] };       // asked only when an earlier question was answered with one of these
  locked?: boolean;                                    // answered by a certificate; cannot be changed
  section?: string; category?: string; domain?: string;
}

export type EvidenceFile = { id: number; file_name: string; file_type: string | null; file_size: number | null };
export type FilesByQuestion = Record<string, readonly unknown[] | undefined>;

export type EvidenceMode = 'none' | 'optional' | 'required';

export function evidenceRule(q: RuleQuestion): { mode: EvidenceMode; on: string[] } {
  if (q.evidence === 'none' || q.evidence === 'optional' || q.evidence === 'required') {
    return { mode: q.evidence, on: (q.evidence_on || []).map((v) => String(v).trim().toLowerCase()) };
  }
  return q.evidence_required ? { mode: 'required', on: ['yes', 'partial'] } : { mode: 'optional', on: [] };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const optionOf = (q: RuleQuestion, value: string) => (q.options || []).find(
  (o): o is QuestionOption => typeof o !== 'string' && same(String(o.value), value));

export const isNotApplicable = (o?: QuestionOption | null) => !!o && !!(o.na || o.not_applicable);

/** Whether this answer owes evidence: a file question's file is its answer; N/A owes a reason instead.
 *  ponytail: answers here are always an option's own value, so the server's Yes/No spellings ("Y", "true") are not read. */
export function owesEvidence(q: RuleQuestion, answer: string): boolean {
  const { mode, on } = evidenceRule(q);
  const value = (answer || '').trim();
  if (mode !== 'required' || !value || q.type === 'file' || isNotApplicable(optionOf(q, value))) return false;
  return on.length === 0 || on.includes(value.toLowerCase());
}

/** 'reason' for a not-applicable answer, 'note' for one whose option asks for a note. */
export function noteNeeded(q: RuleQuestion, answer: string): 'reason' | 'note' | null {
  const option = optionOf(q, answer || '');
  if (isNotApplicable(option)) return 'reason';
  return option?.comment_required ? 'note' : null;
}

// ── how a question is answered ──────────────────────────────────────────────

/** A date input reports a value while it is still being typed (year 0002 on the way to 2026): only a whole date with a
 *  four-digit year is an answer yet. */
export const isWholeDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1000;

export function controlOf(q: { type?: string }): 'choice' | 'text' | 'number' | 'date' | 'file' {
  return q.type === 'text' || q.type === 'number' || q.type === 'date' || q.type === 'file' ? q.type : 'choice';
}

/** The answers a choice question offers; a question that names none is a plain Yes / No. */
export function choicesOf(q: RuleQuestion): Array<{ value: string; label: string }> {
  if (q.type === 'rating') return [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));
  const own = (q.options || []).map((o) => (typeof o === 'string'
    ? { value: o, label: o } : { value: String(o.value), label: String(o.label ?? o.value) }));
  return own.length ? own : [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
}

/** Short answers sit in a row of chips; longer or more of them stack. */
export const asChips = (choices: Array<{ label: string }>) => choices.length <= 5 && choices.every((c) => c.label.length <= 24);

// ── which questions apply ───────────────────────────────────────────────────

/** A question with show_if applies only when the earlier question it names applies and was answered with one of its values. */
export function applicable<T extends { id: string; show_if?: { question: string; in: string[] } }>(
  questions: T[], answers: Record<string, string>): T[] {
  const shown: T[] = [];
  const keys = new Set<string>();
  for (const q of questions) {
    const rule = q.show_if;
    if (rule?.question) {
      const allowed = (rule.in || []).map((v) => String(v).trim().toLowerCase());
      if (!keys.has(rule.question) || !allowed.includes((answers[rule.question] || '').trim().toLowerCase())) continue;
    }
    shown.push(q);
    keys.add(q.id);
  }
  return shown;
}

/** The answers that still apply. The server drops the others when it saves, so the page forgets them at the same moment. */
export function keepApplicable<T extends { id: string; show_if?: { question: string; in: string[] } }>(
  questions: T[], answers: Record<string, string>): Record<string, string> {
  const keep = new Set(applicable(questions, answers).map((q) => q.id));
  return Object.fromEntries(Object.entries(answers).filter(([id]) => keep.has(id)));
}

// ── sections ────────────────────────────────────────────────────────────────

/** A question's section as the reviewers see it: its own, else its category, else its risk domain, else General. */
export function sectionLabel(q: { section?: string; category?: string; domain?: string }): string {
  const words = String(q.section || q.category || q.domain || 'general').trim().toLowerCase().split(/[\s_]+/).filter(Boolean).join(' ');
  return (words.charAt(0).toUpperCase() + words.slice(1)) || 'General';
}

/** Runs of questions in the same section, in the order they were written. */
export function sectionsOf<T extends { section?: string; category?: string; domain?: string }>(
  questions: T[]): Array<{ label: string; questions: T[] }> {
  const out: Array<{ label: string; questions: T[] }> = [];
  for (const q of questions) {
    const label = sectionLabel(q);
    const last = out[out.length - 1];
    if (last && last.label === label) last.questions.push(q);
    else out.push({ label, questions: [q] });
  }
  return out;
}

// ── what is still to do ─────────────────────────────────────────────────────

/** A file question is answered by its file; any other by a value. */
export const isAnswered = (q: { type?: string }, value: string, fileCount: number) =>
  q.type === 'file' ? fileCount > 0 : !!(value || '').trim();

export interface Gaps {
  need: 'reason' | 'note' | null;     // the words this answer asks for
  answer: boolean;                    // required, and not answered
  note: boolean;                      // an answer that asks for words has none
  document: boolean;                  // an answer that owes a document has none
}

export function gapsOf(q: PortalQuestion, value: string, comment: string, fileCount: number): Gaps {
  const answered = isAnswered(q, value, fileCount);
  const need = answered ? noteNeeded(q, value) : null;
  return {
    need,
    answer: !answered && q.required,
    note: !!need && !(comment || '').trim(),
    document: answered && owesEvidence(q, value) && fileCount === 0,
  };
}

export interface Readiness {
  shown: PortalQuestion[];            // the questions that apply, in page order
  answered: number;                   // of those, how many have an answer
  left: string[];                     // questions still to answer (or to give their words)
  missing: string[];                  // documents still owed
  open: string[];                     // either, in page order
  ready: boolean;
}

/** What stands between the supplier and sending. `canEdit` limits it to what can change now: a returned
 *  questionnaire asks only about the questions its reviewer sent back. */
export function readiness(questions: PortalQuestion[], answers: Record<string, string>, comments: Record<string, string>,
  files: FilesByQuestion, canEdit: (q: PortalQuestion) => boolean = () => true): Readiness {
  const shown = applicable(questions, answers);
  const left: string[] = [];
  const missing: string[] = [];
  let answered = 0;
  for (const q of shown) {
    const value = answers[q.id] || '';
    const count = files[q.id]?.length ?? 0;
    if (isAnswered(q, value, count)) answered += 1;
    if (!canEdit(q)) continue;
    const gaps = gapsOf(q, value, comments[q.id] || '', count);
    if (gaps.answer || gaps.note) left.push(q.id);
    if (gaps.document) missing.push(q.id);
  }
  const open = shown.map((q) => q.id).filter((id) => left.includes(id) || missing.includes(id));
  return { shown, answered, left, missing, open, ready: open.length === 0 };
}

/** The open item after the one last jumped to, in page order, starting again at the top. */
export function nextOpen(open: string[], order: string[], after: string | null): string | null {
  if (!open.length) return null;
  const wanted = new Set(open);
  const start = after ? order.indexOf(after) + 1 : 0;
  for (let i = 0; i < order.length; i += 1) {
    const id = order[(start + i) % order.length];
    if (wanted.has(id)) return id;
  }
  return open[0];
}

// ── the upload box ──────────────────────────────────────────────────────────

export type EvidenceTone = 'attached' | 'owed' | 'optional' | 'later';

/** Whether a question shows an upload box and in what state: attached (green), owed (amber), optional (grey), or
 *  asked for only on some answers and not answered yet (grey). `quiet`: the box is only offered, behind a link, until the
 *  supplier wants it, so a questionnaire whose questions all allow a document is not a wall of upload boxes. */
export function evidenceBox(q: PortalQuestion, value: string, fileCount: number):
  { show: boolean; tone: EvidenceTone; badge: string; quiet: boolean } {
  const { mode, on } = evidenceRule(q);
  if (q.type === 'file') {                                      // the document is the answer
    const tone = fileCount ? 'attached' : q.required ? 'owed' : 'optional';
    return { show: true, tone, badge: tone === 'owed' ? 'Required' : 'Optional', quiet: false };
  }
  if (fileCount) return { show: true, tone: 'attached', badge: '', quiet: false };
  if (mode === 'none') return { show: false, tone: 'optional', badge: '', quiet: false };
  if (mode === 'optional') return { show: true, tone: 'optional', badge: 'Optional', quiet: true };
  if (owesEvidence(q, value)) return { show: true, tone: 'owed', badge: 'Required', quiet: false };
  if ((value || '').trim()) return { show: true, tone: 'optional', badge: 'Optional', quiet: false };      // an answer that needs none
  return { show: true, tone: 'later', badge: on.length ? 'Needed for some answers' : 'Required', quiet: false };
}

// ── picking an answer, and the words it asks for ────────────────────────────

export interface Saved { value: string; comment: string }

/** The words that stay when an answer goes or changes: a reason belongs to "not applicable" and goes with it. */
export const wordsKept = (q: RuleQuestion, saved: Saved) => (noteNeeded(q, saved.value) === 'reason' ? '' : saved.comment);

/** What picking an answer does: save it now (with these words), or wait for the words it asks for. A "not applicable"
 *  pick always waits for a reason of its own; an option that asks for a note takes the note already given. */
export function pickAnswer(q: RuleQuestion, picked: string, saved: Saved): { act: 'wait' } | { act: 'save'; words: string } {
  const need = noteNeeded(q, picked);
  if (need) {
    return need === noteNeeded(q, saved.value) && saved.comment.trim() ? { act: 'save', words: saved.comment } : { act: 'wait' };
  }
  return { act: 'save', words: wordsKept(q, saved) };
}

/** What leaving the words box does. `pending`: a pick still waiting for these words. An answer that asks for words never
 *  loses them to an empty box: the saved ones come back. */
export function leaveNote(q: RuleQuestion, now: { pending: string | null; saved: Saved; draft: string }):
  { act: 'keep' } | { act: 'restore' } | { act: 'save'; value: string; words: string } {
  const words = now.draft.trim();
  if (now.pending !== null) return words ? { act: 'save', value: now.pending, words } : { act: 'keep' };
  if (words === now.saved.comment.trim()) return { act: 'keep' };
  if (noteNeeded(q, now.saved.value) && !words) return { act: 'restore' };
  return { act: 'save', value: now.saved.value, words };
}
