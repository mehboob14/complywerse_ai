// The questionnaire's rules apart from React so `node --test` pins them (answers.test.ts): what an answer is, when a question counts as answered, how many of the
// required ones are, and the exact body the server stores. The server reads the fields below; it ignores every other key and then OVERWRITES the stored row
// with what it read, so a page that sends other names (the old one sent likelihood / impact / effectiveness / yes_no_value / text_value) stores nothing and
// blanks what was there. `savePayload` is the one place those names are written.

export type QuestionType = 'risk_rating' | 'control_rating' | 'yes_no' | 'text' | 'multiple_choice';

export interface Question {
  id: number;
  section?: string | null;
  question_text: string;
  guidance?: string | null;
  question_type: string;
  is_required: boolean;
  sequence?: number;
  question_order?: number;
  ai_suggestion_enabled?: boolean;
  risk_category?: string | null;
  control_objective?: string | null;
  options?: string[];
}

/** One answer as the form holds it. Only the fields of the question's own type are set. */
export interface Answer {
  likelihood?: number | null;
  impact?: number | null;
  effectiveness?: string | null;
  /** true = yes, false = no, null/undefined = not answered */
  yesNo?: boolean | null;
  /** free text, and the chosen option of a multiple-choice question */
  text?: string | null;
}

/** An answer as the detail endpoint returns it. */
export interface ServerAnswer {
  question_id: number;
  likelihood?: number | null;
  impact?: number | null;
  effectiveness?: string | null;
  yes_no_value?: boolean | null;
  text_value?: string | null;
  evidence?: Array<{ id: number; filename: string; file_size: number; uploaded_at?: string | null }>;
}

/** What the server accepts for one question (RCSAResponseCreate). */
export interface SavedResponse {
  question_id: number;
  response_value: string | null;
  likelihood_rating: number | null;
  impact_rating: number | null;
  control_effectiveness: string | null;
}

export const EFFECTIVENESS = ['effective', 'partially_effective', 'ineffective', 'not_applicable'] as const;

export function answerFromServer(r: ServerAnswer): Answer {
  return {
    likelihood: r.likelihood ?? null,
    impact: r.impact ?? null,
    effectiveness: r.effectiveness ?? null,
    yesNo: r.yes_no_value ?? null,
    text: r.text_value ?? null,
  };
}

/** The body the server stores for one question. A question stores only what its type asks for, so a stale value of another type never goes along. */
export function savePayload(question: Pick<Question, 'id' | 'question_type'>, answer: Answer): SavedResponse {
  const base: SavedResponse = { question_id: question.id, response_value: null, likelihood_rating: null, impact_rating: null, control_effectiveness: null };
  switch (question.question_type) {
    case 'risk_rating':
      return { ...base, likelihood_rating: answer.likelihood ?? null, impact_rating: answer.impact ?? null };
    case 'control_rating':
      return { ...base, control_effectiveness: answer.effectiveness ?? null };
    case 'yes_no':
      return { ...base, response_value: answer.yesNo == null ? null : answer.yesNo ? 'yes' : 'no' };
    default:
      return { ...base, response_value: answer.text == null || answer.text === '' ? null : answer.text };
  }
}

/** The rule the server's Worklist applies as well (backend rcsa_work.is_answered): a risk rating needs both numbers, a yes/no needs a side, text needs a word. */
export function isAnswered(question: Pick<Question, 'question_type'>, answer: Answer | undefined): boolean {
  if (!answer) return false;
  switch (question.question_type) {
    case 'risk_rating': return !!(answer.likelihood && answer.impact);
    case 'control_rating': return !!answer.effectiveness;
    case 'yes_no': return answer.yesNo === true || answer.yesNo === false;
    default: return !!(answer.text && answer.text.trim());
  }
}

/** A question that has been started and not finished (one number of a risk rating): the form says what is missing. */
export function isPartial(question: Pick<Question, 'question_type'>, answer: Answer | undefined): boolean {
  if (!answer || isAnswered(question, answer)) return false;
  return question.question_type === 'risk_rating' && !!(answer.likelihood || answer.impact);
}

export interface Completion {
  required: number;
  answeredRequired: number;
  /** the required questions still to answer, in the order of the form */
  missing: number[];
  answered: number;
  total: number;
  /** whole percent of the required questions answered (0 when none is required) */
  percent: number;
}

export function completion(questions: readonly Question[], answers: Readonly<Record<number, Answer>>): Completion {
  const ordered = sortedQuestions(questions);
  const required = ordered.filter((q) => q.is_required);
  const missing = required.filter((q) => !isAnswered(q, answers[q.id])).map((q) => q.id);
  const answeredRequired = required.length - missing.length;
  return {
    required: required.length,
    answeredRequired,
    missing,
    answered: ordered.filter((q) => isAnswered(q, answers[q.id])).length,
    total: ordered.length,
    percent: required.length > 0 ? Math.floor((answeredRequired * 100) / required.length) : 0,
  };
}

/** The form's order: by section as the template lists them (first appearance), then by the question's own order. */
export function sortedQuestions(questions: readonly Question[]): Question[] {
  const order = (q: Question) => q.question_order ?? q.sequence ?? 0;
  const first = new Map<string, number>();
  questions.forEach((q, i) => { const s = q.section ?? ''; if (!first.has(s)) first.set(s, i); });
  return questions.slice().sort((a, b) => (first.get(a.section ?? '') ?? 0) - (first.get(b.section ?? '') ?? 0) || order(a) - order(b) || a.id - b.id);
}

export interface Section { name: string; questions: Question[]; answered: number; required: number }

/** The sections of the form with how much of each is done ("Controls 6 of 9"). */
export function sections(questions: readonly Question[], answers: Readonly<Record<number, Answer>>): Section[] {
  const out: Section[] = [];
  const byName = new Map<string, Section>();
  for (const q of sortedQuestions(questions)) {
    const name = q.section?.trim() || 'Questions';
    let s = byName.get(name);
    if (!s) { s = { name, questions: [], answered: 0, required: 0 }; byName.set(name, s); out.push(s); }
    s.questions.push(q);
    if (q.is_required) { s.required += 1; if (isAnswered(q, answers[q.id])) s.answered += 1; }
  }
  return out;
}

/** A risk rating's score (likelihood x impact, 1 to 25), or null while one number is missing. The server computes the same on save. */
export const ratingScore = (a: Answer | undefined): number | null => (a?.likelihood && a?.impact ? a.likelihood * a.impact : null);

/** Whether the answer on screen differs from the one the server holds (an unsaved change). */
export function differs(question: Pick<Question, 'id' | 'question_type'>, now: Answer | undefined, saved: Answer | undefined): boolean {
  const a = savePayload(question, now ?? {});
  const b = savePayload(question, saved ?? {});
  return a.response_value !== b.response_value || a.likelihood_rating !== b.likelihood_rating || a.impact_rating !== b.impact_rating || a.control_effectiveness !== b.control_effectiveness;
}

/** Why a reviewer should look at an answer first ("exceptions first"), or null when it is unremarkable: a required question left empty, a high risk rating (12 or more, the
 *  register's band) or a control that is not fully effective. The review view opens on these and folds the rest away. */
export function needsLook(question: Pick<Question, 'question_type' | 'is_required'>, answer: Answer | undefined): string | null {
  if (!isAnswered(question, answer)) return question.is_required ? 'Required, not answered' : null;
  const a = answer as Answer;
  if (question.question_type === 'risk_rating' && (ratingScore(a) ?? 0) >= 12) return 'High risk rating';
  if (question.question_type === 'control_rating' && (a.effectiveness === 'ineffective' || a.effectiveness === 'partially_effective')) {
    return a.effectiveness === 'ineffective' ? 'Control not effective' : 'Control only partly effective';
  }
  return null;
}
