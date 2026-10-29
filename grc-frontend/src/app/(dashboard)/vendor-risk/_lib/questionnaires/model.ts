// The rules of the questionnaire builder, with no screen in them: how a question is read, edited and checked, which questions
// show for which answers, how sections and order are kept, and what the library picker offers. Pure, so `node --test` runs
// model.test.ts against it. The server stores the template's questions as one JSON list and freezes a copy when it is sent
// (tpra/versions.py); these functions only ever hand back a new list.
import { STARTER_SETS } from './starterSets.ts';
import type { EvidenceMode, LibrarySet, OptionDef, Question, QuestionType, Template } from './types.ts';

type Opt = string | OptionDef;

export const optLabel = (o: Opt): string => (typeof o === 'string' ? o : o.label ?? o.value);
export const optValue = (o: Opt): string => (typeof o === 'string' ? o : o.value);
export const optScore = (o: Opt): number | null => (typeof o === 'string' ? null : o.score ?? null);
export const optFlag = (o: Opt, flag: 'na' | 'comment_required'): boolean =>
  typeof o !== 'string' && (flag === 'na' ? !!(o.na || (o as { not_applicable?: boolean }).not_applicable) : !!o[flag]);

export const TYPES: QuestionType[] = ['yes_no', 'multiple_choice', 'text', 'rating', 'file'];
export const TYPE_LABEL: Record<QuestionType, string> = {
  yes_no: 'Yes / No', multiple_choice: 'Multiple choice', text: 'Text answer', rating: 'Rating 1-5', file: 'File upload',
};
/** The three answers a Yes / No question offers (Not applicable is always there too, and always needs a reason). */
export const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'partial', label: 'Partial' }, { value: 'no', label: 'No' }] as const;
/** Types whose answer is scored: they carry a weight and can be a critical control. */
export const isScored = (t: QuestionType): boolean => t === 'yes_no' || t === 'multiple_choice' || t === 'rating';
/** Types whose answer can be the trigger of a rule (show another question, owe evidence, send a follow-up). */
export const isChoice = (t: QuestionType): boolean => t === 'yes_no' || t === 'multiple_choice';

export const EVIDENCE_LABEL: Record<EvidenceMode, string> = { none: 'No evidence', optional: 'Evidence optional', required: 'Evidence required' };
export const WEIGHT = { min: 0.5, max: 5, step: 0.5 } as const;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 50;

/** The answers a rule can name: Yes / Partial / No, or a choice's options. */
export const answerValues = (q: Pick<Question, 'type' | 'options'>): string[] =>
  q.type === 'yes_no' ? YES_NO.map((a) => a.value) : q.type === 'multiple_choice' ? (q.options || []).map(optValue) : [];

/** The words for an answer of a question: "Yes" for yes, an option's label. */
export function answerLabel(q: Pick<Question, 'type' | 'options'>, value: string): string {
  if (q.type === 'yes_no') return YES_NO.find((a) => a.value === value)?.label ?? value;
  const found = (q.options || []).find((o) => optValue(o) === value);
  return found === undefined ? value : optLabel(found);
}

// A question written before the evidence rules: evidence_required meant "on Yes or Partial".
export const evidenceOf = (q: Pick<Question, 'evidence' | 'evidence_required'>): EvidenceMode =>
  q.evidence ?? (q.evidence_required ? 'required' : 'optional');
export const evidenceOnOf = (q: Pick<Question, 'evidence' | 'evidence_required' | 'evidence_on' | 'type'>): string[] =>
  (q.evidence ? q.evidence_on || [] : q.evidence_required && q.type === 'yes_no' ? ['yes', 'partial'] : []);

/** Saved as shown: the rule made explicit, answers it names that the question cannot have dropped. */
export function withRules(q: Question): Question {
  const evidence: EvidenceMode = q.type === 'file' ? 'none' : evidenceOf(q);
  const values = answerValues(q);
  return {
    ...q, evidence, evidence_on: evidence === 'required' ? evidenceOnOf(q).filter((v) => values.includes(v)) : [],
    evidence_required: evidence === 'required',
  };
}

// ── sections ────────────────────────────────────────────────────────────────

/** What the server groups reviewers by (tpra/reviews.section_of): a question's own section, else its risk domain (built-in
 *  templates), else "general"; lower case, words apart, so "Access" and "access " are one. */
export function sectionKey(q: Pick<Question, 'section' | 'domain'>): string {
  const raw = (q.section || '').trim() || String(q.domain || '').trim() || 'general';
  return raw.toLowerCase().split(/[\s_]+/).filter(Boolean).join(' ') || 'general';
}

/** The section a question is shown under, worded as the reviewers' list words it: its own text, else its key with a capital. */
export function sectionName(q: Pick<Question, 'section' | 'domain'>): string {
  const own = (q.section || '').trim();
  if (own) return own;
  const key = sectionKey(q);
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export interface Run { key: string; name: string; from: number; questions: Question[] }

/** Consecutive questions that share a section, in the order they are asked. A section split by another is two runs: order is
 *  never changed to tidy it, because a question can only depend on one asked before it. `from` is the first one's place in the list. */
export function sectionsOf(questions: Question[]): Run[] {
  const out: Run[] = [];
  questions.forEach((q, i) => {
    const key = sectionKey(q);
    const last = out[out.length - 1];
    if (last && last.key === key) last.questions.push(q);
    else out.push({ key, name: sectionName(q), from: i, questions: [q] });
  });
  return out;
}

/** The section a new question lands in: that of the one it is added below, else the last one, else "General". */
export function sectionFor(questions: Question[], afterId: string | null): string {
  const near = questions.find((q) => q.id === afterId) ?? questions[questions.length - 1];
  return near ? sectionName(near) : 'General';
}

// ── which questions show ────────────────────────────────────────────────────

/** The questions asked for these answers: the server's rule (portal.visible_questions). One with `show_if` shows only when the
 *  earlier question it names shows and was answered with one of its values (compared in lower case, trimmed). */
export function visibleIds(questions: Question[], answers: Record<string, string>): Set<string> {
  const shown = new Set<string>();
  for (const q of questions) {
    const rule = q.show_if;
    if (rule?.question) {
      const allowed = (rule.in || []).map((v) => String(v).trim().toLowerCase());
      if (!shown.has(rule.question) || !allowed.includes((answers[rule.question] || '').trim().toLowerCase())) continue;
    }
    shown.add(q.id);
  }
  return shown;
}

/** Questions whose rule names a question that is not asked before them. */
export function brokenBranches(questions: Question[]): Question[] {
  const before = new Set<string>();
  const out: Question[] = [];
  for (const q of questions) {
    if (q.show_if?.question && !before.has(q.show_if.question)) out.push(q);
    before.add(q.id);
  }
  return out;
}

/** Why this order is not allowed, or null: a question has to stay below the one it depends on. */
export function orderProblem(questions: Question[]): string | null {
  const bad = brokenBranches(questions)[0];
  if (!bad) return null;
  const at = (id: string) => questions.findIndex((q) => q.id === id) + 1;
  const parent = bad.show_if ? at(bad.show_if.question) : 0;
  return parent > 0 ? `Q${at(bad.id)} only shows after Q${parent}, so it has to stay below it.` : `Q${at(bad.id)} depends on a question that is gone.`;
}

/** Questions that depend on this one. */
export const dependentsOf = (questions: Question[], id: string): Question[] => questions.filter((q) => q.show_if?.question === id);

// ── changing the list ───────────────────────────────────────────────────────

/** The list with the question put in after `afterId` (at the end when there is no such question). */
export function insertAfter(questions: Question[], afterId: string | null, q: Question): Question[] {
  const at = afterId === null ? -1 : questions.findIndex((x) => x.id === afterId);
  const place = at < 0 ? questions.length : at + 1;
  return [...questions.slice(0, place), q, ...questions.slice(place)];
}

export const replaceQuestion = (questions: Question[], q: Question): Question[] => questions.map((x) => (x.id === q.id ? q : x));

/** The list without the question; those that depended on it are asked always from now on. */
export function removeQuestion(questions: Question[], id: string): Question[] {
  return questions.filter((q) => q.id !== id).map((q) => {
    if (q.show_if?.question !== id) return q;
    const { show_if: _gone, ...rest } = q;
    return rest as Question;
  });
}

/** One place up or down, within its own section; null at the edge of it. */
export function moveQuestion(questions: Question[], id: string, delta: -1 | 1): Question[] | null {
  const at = questions.findIndex((q) => q.id === id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= questions.length || sectionKey(questions[to]) !== sectionKey(questions[at])) return null;
  const next = [...questions];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** A whole run of a section up or down past its neighbour; null at either end. */
export function moveRun(questions: Question[], runIndex: number, delta: -1 | 1): Question[] | null {
  const runs = sectionsOf(questions);
  const to = runIndex + delta;
  if (runIndex < 0 || runIndex >= runs.length || to < 0 || to >= runs.length) return null;
  const order = [...runs];
  [order[runIndex], order[to]] = [order[to], order[runIndex]];
  return order.flatMap((r) => r.questions);
}

// ── drafts: a question as the editor holds it ───────────────────────────────

export interface OptionDraft {
  uid: string;
  /** What is stored and answered. Empty for a new answer until the question is saved, then its label. Never changes after. */
  value: string;
  label: string;
  /** Percent of full credit, or null for an answer that does not count. */
  score: number | null;
  na: boolean;
  note: boolean;
}

export interface Draft {
  id: string;
  text: string;
  help: string;
  type: QuestionType;
  section: string;
  required: boolean;
  weight: number;
  options: OptionDraft[];
  /** Yes / No: which of yes, partial, no need a note. */
  noteOn: string[];
  evidence: EvidenceMode;
  /** Which answers owe the evidence: yes / partial / no for Yes / No, an option's uid for a choice. */
  evidenceOn: string[];
  domain: string;
  critical: boolean;
  certificate: boolean;
  showIfQuestion: string;
  showIfAnswers: string[];
  /** The answers that send the follow-up, named the way evidenceOn names them. */
  followWhen: string[];
  followTemplate: number | null;
}

let counter = 0;
export const uid = (): string => `o${(counter += 1)}`;
export const newId = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `q${Date.now().toString(36)}${(counter += 1).toString(36)}`);

export const blankOption = (label = ''): OptionDraft => ({ uid: uid(), value: '', label, score: null, na: false, note: false });

export function blankDraft(section: string): Draft {
  return {
    id: newId(), text: '', help: '', type: 'yes_no', section, required: true, weight: 3, options: [], noteOn: [],
    evidence: 'optional', evidenceOn: [], domain: '', critical: false, certificate: false, showIfQuestion: '',
    showIfAnswers: [], followWhen: [], followTemplate: null,
  };
}

export function draftFrom(q: Question): Draft {
  const options: OptionDraft[] = q.type === 'multiple_choice'
    ? (q.options || []).map((o) => {
      const score = optScore(o);
      return { uid: uid(), value: optValue(o), label: optLabel(o), score: score === null ? null : Math.round(score * 100), na: optFlag(o, 'na'), note: optFlag(o, 'comment_required') };
    })
    : [];
  const owed = evidenceOnOf(q);
  return {
    id: q.id, text: q.text, help: q.help || '', type: q.type, section: (q.section || '').trim(),   // blank: it uses its risk domain
    required: !!q.required, weight: Number.isFinite(q.weight) && q.weight > 0 ? q.weight : 3, options,
    noteOn: q.type === 'yes_no'
      ? (q.options || []).filter((o) => optFlag(o, 'comment_required') && YES_NO.some((a) => a.value === optValue(o))).map(optValue)
      : [],
    evidence: q.type === 'file' ? 'none' : evidenceOf(q),
    evidenceOn: q.type === 'multiple_choice' ? options.filter((o) => owed.includes(o.value)).map((o) => o.uid) : owed.filter((v) => YES_NO.some((a) => a.value === v)),
    domain: typeof q.domain === 'string' ? q.domain : '', critical: !!q.critical_control, certificate: !!q.certificate_covers,
    showIfQuestion: q.show_if?.question || '', showIfAnswers: q.show_if?.in || [],
    followWhen: q.type === 'multiple_choice' ? options.filter((o) => (q.follow_up?.when || []).includes(o.value)).map((o) => o.uid) : q.follow_up?.when || [],
    followTemplate: q.follow_up?.template_id || null,
  };
}

/** A value for a new answer: its label, made unique among the answers beside it. */
export function uniqueValue(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = label.trim();
  let value = base;
  for (let n = 2; used.has(value); n += 1) value = `${base} (${n})`;
  return value;
}

/** The question this draft makes. Starts from the question it replaces, so what the editor does not show (a built-in template's
 *  key, framework, control reference) is kept; what it shows is written, or removed when it is empty. */
export function questionFrom(d: Draft, base?: Question): Question {
  const choice = d.type === 'multiple_choice';
  const taken: string[] = d.options.map((o) => o.value).filter(Boolean);
  const options: OptionDef[] = choice ? d.options.map((o) => {
    const value = o.value || uniqueValue(o.label, taken);
    taken.push(value);
    const def: OptionDef = { value, label: o.label.trim(), score: o.na || o.score === null ? null : Math.max(0, Math.min(100, o.score)) / 100 };
    if (o.na) def.na = true;
    if (o.note) def.comment_required = true;
    return def;
  }) : d.type === 'yes_no' ? d.noteOn.map((value) => ({ value, comment_required: true })) : [];
  const valueOf = (draftUid: string) => options[d.options.findIndex((o) => o.uid === draftUid)]?.value;
  const evidence: EvidenceMode = d.type === 'file' ? 'none' : d.evidence;
  const owed = evidence === 'required' && isChoice(d.type)
    ? (choice ? d.evidenceOn.map(valueOf).filter((v): v is string => !!v) : d.evidenceOn)
    : [];

  const out: Record<string, unknown> = { ...(base || {}) };
  const put = (key: string, value: unknown) => { if (value === undefined || value === '') delete out[key]; else out[key] = value; };
  Object.assign(out, {
    id: d.id, text: d.text.trim(), type: d.type, required: d.required, options,
    evidence, evidence_on: owed, evidence_required: evidence === 'required',
    weight: Number.isFinite(d.weight) ? Math.max(WEIGHT.min, Math.min(WEIGHT.max, d.weight)) : 1,
  });
  if ('qtype' in out) out.qtype = d.type;                              // the built-in templates carry the type twice
  put('section', d.section.trim());
  put('help', d.help.trim());
  put('domain', d.domain);
  put('critical_control', isScored(d.type) && d.critical ? true : undefined);
  put('certificate_covers', d.type === 'yes_no' && d.certificate ? true : undefined);
  put('show_if', d.showIfQuestion ? { question: d.showIfQuestion, in: d.showIfAnswers } : undefined);
  const when = choice ? d.followWhen.map(valueOf).filter((v): v is string => !!v) : d.followWhen;
  put('follow_up', isChoice(d.type) && d.followTemplate ? { when, template_id: d.followTemplate } : undefined);
  return out as unknown as Question;
}

/** What stops the question being saved, the first problem first. */
export function draftProblems(d: Draft): string[] {
  const list: string[] = [];
  if (!d.text.trim()) list.push('Write the question.');
  if (d.type === 'multiple_choice') {
    if (d.options.length < MIN_OPTIONS) list.push('Add at least two answers.');
    if (d.options.some((o) => !o.label.trim())) list.push('Every answer needs a label.');
  }
  if (isScored(d.type) && !(Number.isFinite(d.weight) && d.weight >= WEIGHT.min && d.weight <= WEIGHT.max)) {
    list.push(`Weight is ${WEIGHT.min} to ${WEIGHT.max}.`);
  }
  if (d.showIfQuestion && d.showIfAnswers.length === 0) list.push('Pick which answers show this question.');
  if (isChoice(d.type) && d.followTemplate !== null && d.followWhen.length === 0) list.push('Pick which answers send the follow-up.');
  if (isChoice(d.type) && d.followWhen.length > 0 && d.followTemplate === null) list.push('Choose the follow-up questionnaire.');
  return list;
}

// ── what a row of the builder says ──────────────────────────────────────────

export interface Chip { key: string; text: string; tone: 'neutral' | 'accent' | 'danger' | 'warn'; title?: string }

/** The chips under a question: only what departs from the ordinary. `parent` is the question its `show_if` names. */
export function chipsFor(q: Question, ctx: { number: number; parent?: { number: number; question: Question }; followName?: string }): Chip[] {
  const out: Chip[] = [{ key: 'type', text: TYPE_LABEL[q.type] ?? q.type, tone: 'neutral' }];
  if (!q.required) out.push({ key: 'optional', text: 'Optional', tone: 'neutral' });
  const evidence = q.type === 'file' ? 'optional' : evidenceOf(q);       // optional is what a question gets: not worth a chip
  if (evidence === 'required') out.push({ key: 'evidence', text: EVIDENCE_LABEL.required, tone: 'accent' });
  else if (evidence === 'none') out.push({ key: 'evidence', text: EVIDENCE_LABEL.none, tone: 'neutral' });
  if (q.show_if && ctx.parent) {
    const words = (q.show_if.in || []).map((v) => answerLabel(ctx.parent!.question, v));
    out.push({ key: 'branch', text: `If Q${ctx.parent.number} is ${words.join(' or ') || '…'}`, tone: 'accent' });
  }
  if (q.critical_control) out.push({ key: 'critical', text: 'Critical', tone: 'danger', title: 'A gap here raises a critical finding, which blocks approval' });
  if (q.certificate_covers) out.push({ key: 'certificate', text: 'Certificate can answer', tone: 'neutral' });
  if (q.follow_up?.template_id) out.push({ key: 'follow', text: `Follow-up: ${ctx.followName || 'a questionnaire'}`, tone: 'neutral' });
  if (isScored(q.type) && q.weight !== 1) out.push({ key: 'weight', text: `Weight ${q.weight}`, tone: 'neutral' });
  return out;
}

/** An answer that raises a finding: it counts, and counts for half credit or less. */
export const isGap = (o: Opt): boolean => !optFlag(o, 'na') && optScore(o) !== null && (optScore(o) as number) <= 0.5;

/** The answers of a choice question in one line: "Continuous · Weekly · Never (gap)". */
export function optionsLine(q: Question): string {
  return q.type === 'multiple_choice' ? (q.options || []).map((o) => `${optLabel(o)}${isGap(o) ? ' (gap)' : ''}`).join('   ·   ') : '';
}

// ── the library ─────────────────────────────────────────────────────────────

export const normText = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** What the picker and the "New questionnaire" dialog offer: the starter sets, then the organisation's other questionnaires
 *  that are not archived and have questions. */
export function librarySets(templates: Template[], excludeId?: number): LibrarySet[] {
  const own = templates.filter((t) => !t.archived_at && t.id !== excludeId && (t.questions || []).length > 0)
    .map((t): LibrarySet => ({ key: `questionnaire-${t.id}`, name: t.name, description: t.description, source: 'questionnaire', questions: t.questions }));
  return [...STARTER_SETS, ...own];
}

export interface LibraryGroup { section: string; rows: Array<{ q: Question; added: boolean }> }

/** A set's questions that match the search, grouped by section; those the questionnaire already has are marked added. */
export function libraryGroups(set: LibrarySet, existing: Question[], search: string): LibraryGroup[] {
  const have = new Set(existing.map((q) => normText(q.text)));
  const needle = search.trim().toLowerCase();
  const out: LibraryGroup[] = [];
  for (const q of set.questions) {
    const section = sectionName(q);
    if (needle && !q.text.toLowerCase().includes(needle) && !section.toLowerCase().includes(needle)) continue;
    const group = out.find((g) => g.section === section);
    const row = { q, added: have.has(normText(q.text)) };
    if (group) group.rows.push(row);
    else out.push({ section, rows: [row] });
  }
  return out;
}

/** The questions with these copied in at the end under new ids. A copy's rule keeps pointing at a question that came with it,
 *  and is dropped when the question it names did not. */
export function addFromLibrary(existing: Question[], picked: Question[], makeId: () => string = newId): Question[] {
  const ids = new Map(picked.map((q) => [q.id, makeId()]));
  const copies = picked.map((q) => {
    const copy: Question = { ...JSON.parse(JSON.stringify(q)), id: ids.get(q.id) as string };
    if (copy.show_if) {
      const parent = ids.get(copy.show_if.question);
      if (parent) copy.show_if = { ...copy.show_if, question: parent };
      else delete copy.show_if;
    }
    return withRules(copy);
  });
  return [...existing, ...copies];
}
