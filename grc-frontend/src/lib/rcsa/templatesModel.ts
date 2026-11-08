// The questionnaire workspace and the template library apart from React, so `node --test` pins them (templatesModel.test.ts).
//
// A questionnaire is edited as a DRAFT in the browser and saved as a whole: the server upserts the questions by id and DELETES every question that is not in the body, together with
// the answers given to it (rcsa.py update_template). So the one rule of this file is the payload: a question that exists keeps its id, a question that is new carries none (a made-up
// id that matches nothing is what the old page sent), the order is the list order, and a section is just the name every question of it carries. The server returns the questions
// sorted by section NAME, so the order the person sees is rebuilt from `question_order` (the first appearance of a section places it).
//
// Everything a person reads here is plain words: no ids, no field names.

export type QuestionKind = 'risk_rating' | 'control_rating' | 'yes_no' | 'text' | 'multiple_choice';

export const QUESTION_KINDS: ReadonlyArray<{ value: QuestionKind; label: string; description: string }> = [
  { value: 'risk_rating', label: 'Risk rating', description: 'The assessor rates likelihood and impact from 1 to 5; the score is worked out for them.' },
  { value: 'control_rating', label: 'Control rating', description: 'The assessor says how well the control works: effective, partly effective, ineffective or not applicable.' },
  { value: 'yes_no', label: 'Yes or no', description: 'A plain yes or no.' },
  { value: 'text', label: 'Text', description: 'A free-text answer.' },
  { value: 'multiple_choice', label: 'Multiple choice', description: 'The assessor picks one of the choices you list.' },
];

/** A question as the template detail endpoint sends it (the fields this page reads). */
export interface ServerQuestion {
  id: number;
  section?: string | null;
  question_order?: number | null;
  sequence?: number | null;
  question_text: string;
  question_type: string;
  is_required?: boolean;
  options?: string[] | null;
  risk_category?: string | null;
  control_objective?: string | null;
  guidance_text?: string | null;
  guidance?: string | null;
  ai_suggestion_enabled?: boolean;
}

/** One question of the draft. `key` is its identity while editing; `id` is the server's, null until the question is saved. */
export interface DraftQuestion {
  key: string;
  id: number | null;
  text: string;
  kind: string;
  required: boolean;
  options: string[];
  guidance: string;
  riskCategory: string;
  controlObjective: string;
  aiSuggestions: boolean;
}

export interface DraftSection {
  key: string;
  /** '' = the questions that belong to no section */
  name: string;
  questions: DraftQuestion[];
}

export type Draft = DraftSection[];

/** The body of one question in `PUT /erm/rcsa/templates/{id}` (the server's field names; `id` only for a question that exists). */
export interface PutQuestion {
  id?: number;
  question_text: string;
  question_type: string;
  is_required: boolean;
  options: string[];
  section: string | null;
  question_order: number;
  guidance_text: string | null;
  risk_category: string | null;
  control_objective: string | null;
  ai_suggestion_enabled: boolean;
}

export const NO_SECTION = 'No section';

let counter = 0;
export const newKey = (prefix: string): string => { counter += 1; return `${prefix}${counter}`; };

const cleanName = (s: string | null | undefined): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const sameName = (a: string, b: string): boolean => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

export const sectionLabel = (name: string): string => cleanName(name) || NO_SECTION;
export const kindLabel = (kind: string): string => QUESTION_KINDS.find((k) => k.value === kind)?.label ?? 'Text';

// ── building the draft ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function questionFromServer(q: ServerQuestion): DraftQuestion {
  return {
    key: `q${q.id}`,
    id: q.id,
    text: q.question_text,
    kind: q.question_type,
    required: q.is_required !== false,
    options: Array.isArray(q.options) ? q.options.slice() : [],
    guidance: q.guidance_text ?? q.guidance ?? '',
    riskCategory: q.risk_category ?? '',
    controlObjective: q.control_objective ?? '',
    aiSuggestions: q.ai_suggestion_enabled !== false,
  };
}

/** The draft of a questionnaire: questions in `question_order` (then id), grouped by section in the order the sections first appear. */
export function fromServer(questions: readonly ServerQuestion[]): Draft {
  const ordered = questions.slice().sort((a, b) => ((a.question_order ?? a.sequence ?? 0) - (b.question_order ?? b.sequence ?? 0)) || (a.id - b.id));
  const sections: DraftSection[] = [];
  ordered.forEach((q) => {
    const name = cleanName(q.section);
    let at = sections.find((s) => sameName(s.name, name));
    if (!at) { at = { key: `s:${name.toLowerCase()}`, name, questions: [] }; sections.push(at); }
    at.questions.push(questionFromServer(q));
  });
  return sections;
}

export function blankQuestion(kind = 'text'): DraftQuestion {
  return { key: newKey('n'), id: null, text: '', kind, required: true, options: [], guidance: '', riskCategory: '', controlObjective: '', aiSuggestions: true };
}

// ── reading the draft ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const allQuestions = (draft: Draft): DraftQuestion[] => draft.reduce<DraftQuestion[]>((all, s) => all.concat(s.questions), []);
export const questionCount = (draft: Draft): number => allQuestions(draft).length;
export const requiredCount = (draft: Draft): number => allQuestions(draft).filter((q) => q.required).length;
export const sectionNames = (draft: Draft): string[] => draft.map((s) => s.name);

export function sectionOf(draft: Draft, key: string): DraftSection | undefined {
  return draft.find((s) => s.questions.some((q) => q.key === key));
}

export function findQuestion(draft: Draft, key: string): DraftQuestion | undefined {
  return allQuestions(draft).find((q) => q.key === key);
}

/** The position of a question in the whole questionnaire, 1-based (the number the assessor sees). */
export function numberOf(draft: Draft, key: string): number {
  return allQuestions(draft).findIndex((q) => q.key === key) + 1;
}

// ── the payload ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Choices without the blank ones, trimmed; only a multiple-choice question keeps any. */
export function cleanOptions(q: Pick<DraftQuestion, 'kind' | 'options'>): string[] {
  return q.kind === 'multiple_choice' ? q.options.map((o) => o.trim()).filter(Boolean) : [];
}

/** The body of the PUT: every question in list order. A question that exists keeps its id; a new one has none, so the server creates it. */
export function toPayload(draft: Draft): PutQuestion[] {
  const out: PutQuestion[] = [];
  draft.forEach((s) => s.questions.forEach((q) => {
    const body: PutQuestion = {
      question_text: q.text.trim(),
      question_type: q.kind,
      is_required: q.required,
      options: cleanOptions(q),
      section: cleanName(s.name) || null,
      question_order: out.length + 1,
      guidance_text: q.guidance.trim() || null,
      risk_category: q.riskCategory.trim() || null,
      control_objective: q.controlObjective.trim() || null,
      ai_suggestion_enabled: q.aiSuggestions,
    };
    if (q.id != null) body.id = q.id;
    out.push(body);
  }));
  return out;
}

/** The draft differs from what was last saved (the saved draft is rebuilt from the server after every save). */
export function isDirty(draft: Draft, saved: Draft): boolean {
  return JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(saved));
}

// ── checking a question ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface QuestionProblems { text?: string; options?: string }

export function questionProblems(q: Pick<DraftQuestion, 'text' | 'kind' | 'options'>): QuestionProblems {
  const out: QuestionProblems = {};
  if (!q.text.trim()) out.text = 'Write the question the assessor will answer.';
  if (q.kind === 'multiple_choice') {
    const filled = q.options.map((o) => o.trim());
    const seen: string[] = [];
    const duplicate = filled.some((o) => { if (!o) return false; const low = o.toLowerCase(); if (seen.indexOf(low) >= 0) return true; seen.push(low); return false; });
    if (filled.some((o) => !o)) out.options = 'Fill in each choice or remove the empty one.';
    else if (filled.length < 2) out.options = 'Give at least two choices.';
    else if (duplicate) out.options = 'Two of the choices are the same.';
  }
  return out;
}

export const hasProblems = (p: QuestionProblems): boolean => !!(p.text || p.options);

/** The questions that cannot be saved as they are, in order (their position and the first thing wrong). */
export function draftProblems(draft: Draft): Array<{ key: string; number: number; message: string }> {
  const found: Array<{ key: string; number: number; message: string }> = [];
  allQuestions(draft).forEach((q, i) => {
    const p = questionProblems(q);
    if (hasProblems(p)) found.push({ key: q.key, number: i + 1, message: (p.text || p.options) as string });
  });
  return found;
}

/** A section name that cannot be used, in words ('' when it can). `except` is the section being renamed. */
export function sectionNameProblem(draft: Draft, name: string, except?: string): string {
  const n = cleanName(name);
  if (!n) return 'Give the section a name.';
  if (n.length > 255) return 'Keep the name under 255 characters.';
  if (draft.some((s) => s.key !== except && sameName(s.name, n))) return 'A section with this name already exists.';
  return '';
}

// ── changing the draft (each returns a new draft; the old one is untouched) ──────────────────────────────────────────────────────────────

const mapSection = (draft: Draft, key: string, fn: (s: DraftSection) => DraftSection): Draft => draft.map((s) => (s.key === key ? fn(s) : s));

function swap<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list.slice();
  const copy = list.slice();
  const moved = copy.splice(from, 1)[0];
  copy.splice(to, 0, moved);
  return copy;
}

export function addSection(draft: Draft, name: string): Draft {
  const n = cleanName(name);
  if (sectionNameProblem(draft, n)) return draft;
  return draft.concat([{ key: newKey('s'), name: n, questions: [] }]);
}

export function renameSection(draft: Draft, key: string, name: string): Draft {
  const n = cleanName(name);
  if (sectionNameProblem(draft, n, key)) return draft;
  return mapSection(draft, key, (s) => ({ ...s, name: n }));
}

/** Only a section with no question left can go: a section is nothing but the name its questions carry. */
export function removeSection(draft: Draft, key: string): Draft {
  return draft.filter((s) => s.key !== key || s.questions.length > 0);
}

export function moveSection(draft: Draft, key: string, dir: -1 | 1): Draft {
  const at = draft.findIndex((s) => s.key === key);
  return at < 0 ? draft : swap(draft, at, at + dir);
}

export function canMoveSection(draft: Draft, key: string, dir: -1 | 1): boolean {
  const at = draft.findIndex((s) => s.key === key);
  return at >= 0 && at + dir >= 0 && at + dir < draft.length;
}

/** Puts a new question at the end of a section; `sectionName` names a section that may not exist yet (it is created at the end). */
export function addQuestion(draft: Draft, sectionName: string, q: DraftQuestion): Draft {
  const name = cleanName(sectionName);
  if (draft.some((s) => sameName(s.name, name))) return draft.map((s) => (sameName(s.name, name) ? { ...s, questions: s.questions.concat([q]) } : s));
  return draft.concat([{ key: newKey('s'), name, questions: [q] }]);
}

/** Replaces a question; when its section changed it moves to the end of the section it was given (created when it is new). */
export function updateQuestion(draft: Draft, key: string, next: DraftQuestion, sectionName?: string): Draft {
  const here = sectionOf(draft, key);
  if (!here) return draft;
  const target = sectionName == null ? here.name : cleanName(sectionName);
  if (sameName(target, here.name)) return mapSection(draft, here.key, (s) => ({ ...s, questions: s.questions.map((q) => (q.key === key ? next : q)) }));
  return addQuestion(draft.map((s) => (s.key === here.key ? { ...s, questions: s.questions.filter((q) => q.key !== key) } : s)), target, next);
}

export function removeQuestion(draft: Draft, key: string): Draft {
  return draft.map((s) => ({ ...s, questions: s.questions.filter((q) => q.key !== key) }));
}

/** A copy right after the question: new, so it has no id and no answers. */
export function duplicateQuestion(draft: Draft, key: string): Draft {
  return draft.map((s) => {
    const at = s.questions.findIndex((q) => q.key === key);
    if (at < 0) return s;
    const copy: DraftQuestion = { ...s.questions[at], key: newKey('n'), id: null, options: s.questions[at].options.slice() };
    return { ...s, questions: s.questions.slice(0, at + 1).concat([copy], s.questions.slice(at + 1)) };
  });
}

/** Up or down inside its section (the section is changed in the question's own form). */
export function moveQuestion(draft: Draft, key: string, dir: -1 | 1): Draft {
  return draft.map((s) => {
    const at = s.questions.findIndex((q) => q.key === key);
    return at < 0 ? s : { ...s, questions: swap(s.questions, at, at + dir) };
  });
}

export function canMoveQuestion(draft: Draft, key: string, dir: -1 | 1): boolean {
  const s = sectionOf(draft, key);
  if (!s) return false;
  const at = s.questions.findIndex((q) => q.key === key);
  return at + dir >= 0 && at + dir < s.questions.length;
}

// ── sentences ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const plural = (n: number, one: string, other = `${one}s`): string => `${n} ${n === 1 ? one : other}`;

/** What deleting a question costs, said before it is done. */
export function deleteCost(q: Pick<DraftQuestion, 'id'>, campaigns: number | null): string {
  if (q.id == null) return 'It has not been saved yet, so nothing else is lost.';
  if (campaigns === null) return 'When you save, it is deleted with any answers already given to it in campaigns.';
  if (campaigns > 0) return `This questionnaire is used by ${plural(campaigns, 'campaign')}. When you save, the answers already given to this question in ${campaigns === 1 ? 'that campaign are' : 'those campaigns are'} deleted with it.`;
  return 'It is removed when you save. No campaign uses this questionnaire yet, so no answers are lost.';
}

/** The saved questions the draft no longer has: saving deletes them, and the answers given to them. */
export function removedQuestions(draft: Draft, saved: Draft): DraftQuestion[] {
  const kept = allQuestions(draft).map((q) => q.id);
  return allQuestions(saved).filter((q) => q.id != null && kept.indexOf(q.id) < 0);
}

/** The warning before a save that deletes saved questions of a questionnaire campaigns use ('' when nothing is lost). */
export function saveWarning(removed: number, campaigns: number | null): string {
  if (removed === 0 || campaigns === 0) return '';
  if (campaigns === null) return `${plural(removed, 'question')} will be deleted, with any answers already given to ${removed === 1 ? 'it' : 'them'} in campaigns. This cannot be undone.`;
  return `${plural(removed, 'question')} will be deleted, with the answers already given to ${removed === 1 ? 'it' : 'them'} in ${plural(campaigns, 'campaign')}. This cannot be undone.`;
}

/** What the section's name stands for when someone removes the last question of it. */
export function emptySectionNote(count: number): string {
  return count === 0 ? 'This section has no questions. It is kept only once it has one.' : '';
}

/** "3 campaigns" / "Not used": the library's In use column. */
export function inUseText(campaigns: number | null | undefined): string {
  const n = campaigns ?? 0;
  return n > 0 ? plural(n, 'campaign') : 'Not used';
}

/** Why a questionnaire cannot be deleted, or null when it can. The server refuses both cases. */
export function deleteBlock(t: { is_system_template?: boolean; campaign_count?: number | null }): string | null {
  if (t.is_system_template) return 'Provided with the platform; it cannot be deleted.';
  if ((t.campaign_count ?? 0) > 0) return `Used by ${plural(t.campaign_count as number, 'campaign')}.`;
  return null;
}

/** The file a downloaded questionnaire is saved as. */
export function templateFileName(name: string): string {
  const base = cleanName(name).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80);
  return `${base || 'questionnaire'}.xlsx`;
}

/** The name a clone is offered with. */
export const cloneName = (name: string): string => `${cleanName(name)} (copy)`.slice(0, 255);

export const WHO = { provided: 'Provided', yours: 'Yours' } as const;
export const whoOf = (t: { is_system_template?: boolean }): string => (t.is_system_template ? WHO.provided : WHO.yours);

/** The workspace is read only: a template the platform provides (clone it to change it) or one the person cannot change. */
export function readOnlyReason(t: { is_system_template?: boolean }): string | null {
  return t.is_system_template ? 'This questionnaire is provided with the platform. Clone it to make your own copy that you can change.' : null;
}

/** A question as the assessor's form takes it (the preview reuses the real answer controls); a question not saved yet gets a negative number. */
export function previewQuestion(q: DraftQuestion, position: number) {
  return {
    id: q.id ?? -position,
    question_text: q.text.trim() || 'Your question will appear here',
    question_type: q.kind,
    is_required: q.required,
    guidance: q.guidance.trim() || null,
    options: cleanOptions(q),
  };
}

/** The details of a questionnaire (the small form). */
export interface TemplateDetails { name: string; description: string; category: string; version: string }

export function detailsProblems(d: TemplateDetails): { name?: string; category?: string; version?: string } {
  const out: { name?: string; category?: string; version?: string } = {};
  if (!d.name.trim()) out.name = 'Give the questionnaire a name.';
  if (!d.category.trim()) out.category = 'Say what kind of risk it covers, for example Operational Risk.';
  if (!d.version.trim()) out.version = 'Give it a version, for example 1.0.';
  return out;
}

export function detailsPayload(d: TemplateDetails) {
  return { name: d.name.trim(), description: d.description.trim() || null, category: d.category.trim(), version: d.version.trim() };
}
