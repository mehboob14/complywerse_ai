/**
 * What the onboarding workspace decides without a server or a screen: the stages (the framework's steps and a last one, Review), how far each is, what a
 * readiness check jumps to, which actions the state allows and why one is off, the sentences of the history and of the banners, the words of a refusal, and
 * how an AI suggestion becomes a change of one field. The rules themselves (what is required, when a field is asked, when it is ready) are the server's
 * (`engine.py`); this only arranges its answer.
 */
import type { AiKind, Check, OnboardingEvent, OnboardingState, OnboardingView, Problem, Readiness, Refs, Step } from '@/lib/frameworkOnboarding';

export const REVIEW = 'review';
export const ORG_HREF = '/compliance/organisation';

export interface Stage { key: string; label: string; review: boolean }

/** The framework's steps in the catalog's order, then Review. */
export function stagesOf(steps: ReadonlyArray<Pick<Step, 'key' | 'label'>>): Stage[] {
  return [...steps.map((s) => ({ key: s.key, label: s.label, review: false })), { key: REVIEW, label: 'Review', review: true }];
}

/** The stage a page opens on when the address names none: the first step with a required answer open, else Review. */
export function openingStage(stages: readonly Stage[], readiness: Pick<Readiness, 'steps'>): string {
  const open = stages.find((s) => !s.review && readiness.steps.some((p) => p.key === s.key && !p.complete));
  return open?.key ?? REVIEW;
}

/** The stage the address names, if the framework has it; else `fallback`. */
export const resolveStage = (stages: readonly Stage[], wanted: string, fallback: string): string => (stages.some((s) => s.key === wanted) ? wanted : fallback);

export function neighbours(stages: readonly Stage[], key: string): { prev: Stage | null; next: Stage | null } {
  const i = stages.findIndex((s) => s.key === key);
  return { prev: i > 0 ? stages[i - 1] : null, next: i >= 0 && i < stages.length - 1 ? stages[i + 1] : null };
}

export interface StageCount { done: number; total: number; complete: boolean; badge: string; words: string }

/** How many required answers of a stage are in, from `readiness.steps`; the Review stage counts everything required (the framework's and the organisation's). */
export function stageCount(readiness: Pick<Readiness, 'steps' | 'counts'>, key: string): StageCount {
  const found = key === REVIEW
    ? { done: readiness.counts.required_ok, total: readiness.counts.required_total }
    : (() => { const s = readiness.steps.find((p) => p.key === key); return { done: s?.required_ok ?? 0, total: s?.required_total ?? 0 }; })();
  const complete = found.done >= found.total;
  return {
    ...found, complete,
    badge: found.total > 0 ? `${found.done}/${found.total}` : '',
    words: found.total > 0 ? `${found.done} of ${found.total} required` : 'Nothing required',
  };
}

// ── fields, edits and refusals ──────────────────────────────────────────────────────────────────────────────────
/** "step.field": how the server names a field in readiness, in errors and in locked keys. */
export const fieldRef = (step: string, field: string): string => `${step}.${field}`;
export function splitRef(ref: string): { step: string; field: string } {
  const i = ref.indexOf('.');
  return i < 0 ? { step: ref, field: '' } : { step: ref.slice(0, i), field: ref.slice(i + 1) };
}

/** What the person has changed and the server has not yet saved: the whole new value of each field, by "step.field". */
export type Edits = Record<string, unknown>;

/** The edits grouped as the server takes them (one save per step; each key replaces its field whole). */
export function editsByStep(edits: Edits): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [ref, value] of Object.entries(edits)) {
    const { step, field } = splitRef(ref);
    (out[step] ??= {})[field] = value;
  }
  return out;
}

/** The value a field shows: what was typed and is not yet saved, else the saved answer. */
export function valueOf(answers: OnboardingView['answers'], edits: Edits, step: string, field: string): unknown {
  const ref = fieldRef(step, field);
  return ref in edits ? edits[ref] : answers?.[step]?.[field];
}

/** The fields of a step that are asked now (the ones an earlier answer switched off are not drawn). */
export const visibleFields = (step: Step, readiness: Pick<Readiness, 'hidden'>): Step['fields'] => step.fields.filter((f) => !readiness.hidden.includes(fieldRef(step.key, f.key)));

/** The server's message for each field it refused, by "step.field" (the first one wins). */
export function errorsByField(p: Pick<Problem, 'errors'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of p.errors) if (e.field && e.message && !(e.field in out)) out[e.field] = e.message;
  return out;
}

/** "Scope statement: Too short." for each refused field the page can name (a field it cannot name is left out, never printed as a key). */
export function refusalLines(p: Pick<Problem, 'errors'>, labelOf: (ref: string) => string | null): string[] {
  const lines: string[] = [];
  for (const [ref, message] of Object.entries(errorsByField(p))) {
    const label = labelOf(ref);
    if (label) lines.push(`${label}: ${message}`);
  }
  return lines;
}

/** The approved onboarding refused a change (409 naming the locked keys). */
export const isLockedRefusal = (p: Pick<Problem, 'status' | 'locked'>): boolean => p.status === 409 && p.locked.length > 0;

export type ActionKey = 'submit' | 'approve' | 'reopen' | 'underway';

/** Words for a refusal, in plain terms: who may do it when the answer is 403, else what the server said. */
export function actionRefusal(action: ActionKey | 'edit', p: Pick<Problem, 'status' | 'message'>): string {
  if (p.status === 403) {
    if (action === 'approve') return 'You need the approve right. Ask an administrator.';
    if (action === 'reopen' || action === 'underway') return 'You need the override right. Ask an administrator.';
    return 'You need the right to edit frameworks. Ask an administrator.';
  }
  return p.message;
}

// ── readiness ───────────────────────────────────────────────────────────────────────────────────────────────────
export function splitChecks(checks: readonly Check[]): { required: Check[]; advice: Check[]; done: Check[] } {
  return { required: checks.filter((c) => c.required && !c.ok), advice: checks.filter((c) => !c.required && !c.ok), done: checks.filter((c) => c.ok) };
}

/** The organisation checks, in two lists: what this framework itself asks of the profile (key org.need.*), and the profile's own. */
export function splitOrgChecks(checks: readonly Check[]): { needed: Check[]; profile: Check[] } {
  return { needed: checks.filter((c) => c.key.startsWith('org.need.')), profile: checks.filter((c) => !c.key.startsWith('org.need.')) };
}

export type Jump = { kind: 'field'; stage: string; field: string } | { kind: 'org'; href: string } | { kind: 'none' };

/** Where a check is put right: a field of a stage, the organisation profile, or nowhere (a check across several answers is explained by its hint). */
export function jumpOf(check: Pick<Check, 'key' | 'kind' | 'step'>, stages: readonly Stage[]): Jump {
  if (check.kind === 'org') return { kind: 'org', href: ORG_HREF };
  if (check.kind === 'field' && check.step && stages.some((s) => s.key === check.step && !s.review)) {
    const { field } = splitRef(check.key);
    return field ? { kind: 'field', stage: check.step, field } : { kind: 'none' };
  }
  return { kind: 'none' };
}

/** Where a "step.field" key of an AI question goes, if the framework has that field. */
export function jumpToRef(ref: string, steps: ReadonlyArray<Pick<Step, 'key' | 'fields'>>): { stage: string; field: string } | null {
  const { step, field } = splitRef(ref);
  return steps.some((s) => s.key === step && s.fields.some((f) => f.key === field)) ? { stage: step, field } : null;
}

/** The label of a "step.field" key (null for one the framework does not have). */
export function labelOfRef(ref: string, steps: ReadonlyArray<Pick<Step, 'key' | 'fields'>>): string | null {
  const { step, field } = splitRef(ref);
  return steps.find((s) => s.key === step)?.fields.find((f) => f.key === field)?.label ?? null;
}

// ── actions ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ActionState { shown: boolean; enabled: boolean; reason: string | null }
export type Actions = Record<ActionKey, ActionState>;

export const openCount = (r: Pick<Readiness, 'counts'>): number => Math.max(0, r.counts.required_total - r.counts.required_ok);
const openWords = (n: number): string => `${n} required ${n === 1 ? 'item is' : 'items are'} still open`;

/**
 * Which decisions the state allows (the server's state machine): Submit from a draft, Approve from ready or underway, Reopen from ready or complete, Mark
 * underway from a draft or ready. A button that is shown and off says why in `reason`; one that does not apply to the state is not shown.
 */
export function actionsOf(state: Exclude<OnboardingState, 'not_started'>, readiness: Pick<Readiness, 'ready' | 'counts'>): Actions {
  const open = openCount(readiness);
  const need = readiness.ready ? { enabled: true, reason: null } : { enabled: false, reason: openWords(open) };
  return {
    submit: { shown: state === 'draft', ...need },
    approve: { shown: state === 'ready' || state === 'underway', ...need },
    reopen: { shown: state === 'ready' || state === 'complete', enabled: true, reason: null },
    underway: { shown: state === 'draft' || state === 'ready', enabled: true, reason: null },
  };
}

/** The reason or note a person types: null when it is long enough, else what is missing. */
export function reasonProblem(text: string, min: number): string | null {
  const n = text.trim().length;
  return n >= min ? null : `Write at least ${min} characters (${n} so far).`;
}

// ── history and banners ─────────────────────────────────────────────────────────────────────────────────────────
const sentence = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** One event of the history in plain words ("Submitted by Sana", "Reopened by Ada: the scope changes"); never a key, an id or raw data. */
export function eventSentence(ev: Pick<OnboardingEvent, 'kind' | 'by' | 'detail'>, stepLabel: (key: string) => string | null): string {
  const by = ev.by ? ` by ${ev.by}` : '';
  const d = ev.detail ?? {};
  switch (ev.kind) {
    case 'created': return `Onboarding started${by}`;
    case 'saved': {
      const label = stepLabel(str(d.step));
      const n = Array.isArray(d.fields) ? d.fields.length : 0;
      const what = label ? `Edited ${label}` : 'Edited answers';
      return `${what}${n > 0 ? ` (${n} ${n === 1 ? 'field' : 'fields'})` : ''}${by}${d.reopened_review ? '. Sent back to draft' : ''}`;
    }
    case 'submitted': return `Submitted${by}`;
    case 'approved': return `Approved${by}${str(d.note) ? `: ${str(d.note)}` : ''}`;
    case 'reopened': return `Reopened${by}${str(d.reason) ? `: ${str(d.reason)}` : ''}`;
    case 'marked_underway': {
      if (d.source === 'legacy') return 'Marked underway: a journey existed before onboarding';
      const kind = str(d.kind);
      return `Marked underway${by}${kind ? ` (${kind})` : ''}${str(d.reason) ? `: ${str(d.reason)}` : ''}`;
    }
    case 'journey_started': return `Journey started${by}`;
    case 'journey_blocked': {
      const n = typeof d.unmet === 'number' ? d.unmet : 0;
      return n > 0 ? `Journey blocked: ${n} required ${n === 1 ? 'item was' : 'items were'} open` : 'Journey blocked: waiting for approval';
    }
    default: return sentence(ev.kind.replace(/[_-]+/g, ' ').trim()) || 'Changed';
  }
}

export interface Banner { tone: 'info' | 'warning'; title: string; text: string; action: 'reopen' | 'review' | null }

type BannerView = Pick<OnboardingView, 'state' | 'underway' | 'underway_by' | 'approved_at' | 'approved_by' | 'approval_note' | 'submitted_by' | 'submitted_at'>;

/** The line under the heading that says where the onboarding stands, for the states that need one (a draft needs none). `fmt` writes a server time as a date. */
export function bannerOf(view: BannerView, fmt: (iso: string | null) => string): Banner | null {
  const when = (iso: string | null) => (fmt(iso) ? ` on ${fmt(iso)}` : '');
  switch (view.state) {
    case 'underway': {
      const u = view.underway;
      if (!u || u.source === 'legacy') return { tone: 'warning', title: 'Already underway', text: 'A journey existed before onboarding. What is open stays listed.', action: null };
      const since = fmt(u.at);
      return {
        tone: 'warning', title: 'Already underway', action: null,
        text: `Underway${since ? ` since ${since}` : ''}${view.underway_by ? ` by ${view.underway_by}` : ''}${u.reason ? ` because ${u.reason.replace(/[.\s]+$/, '')}` : ''}. What is open stays listed.`,
      };
    }
    case 'complete':
      return { tone: 'info', title: 'Approved and locked', action: 'reopen', text: `Approved${view.approved_by ? ` by ${view.approved_by}` : ''}${when(view.approved_at)}.${view.approval_note ? ` ${view.approval_note}` : ''}` };
    case 'ready':
      return { tone: 'info', title: 'Waiting for approval', action: 'review', text: `Submitted${view.submitted_by ? ` by ${view.submitted_by}` : ''}${when(view.submitted_at)}. Changing an answer sends it back to draft.` };
    default: return null;
  }
}

// ── names the fields point at ───────────────────────────────────────────────────────────────────────────────────
/** The names a page already knows plus the ones a picker has just been told, so a person just chosen shows by name before the next read. */
export function mergeRefs(base: Refs, extra: Partial<Refs>): Refs {
  return {
    users: { ...base.users, ...extra.users },
    assets: { ...base.assets, ...extra.assets },
    vendors: { ...base.vendors, ...extra.vendors },
    departments: { ...base.departments, ...extra.departments },
  };
}

/** Does the framework ask for departments anywhere (a pick of them, or the derived list)? Only then the profile is read, for its department tree. */
export const needsDepartments = (steps: ReadonlyArray<Pick<Step, 'fields'>>): boolean =>
  steps.some((s) => s.fields.some((f) => f.type === 'departments_derived' || (f.type === 'org_pick' && f.of === 'departments')));

// ── AI ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Where each kind of help sits: beside the field it writes to. Review-stage help (gap_review) has no field. */
export const AI_PLACE: Record<AiKind, { step: string; field: string } | null> = {
  scope_draft: { step: 'scope', field: 'statement' },
  exclusions_check: { step: 'scope', field: 'exclusions' },
  parties_suggest: { step: 'context', field: 'interested_parties' },
  gap_review: null,
};
export const AI_TITLE: Record<AiKind, string> = { scope_draft: 'Scope draft', exclusions_check: 'Exclusions check', parties_suggest: 'Suggested parties', gap_review: 'Gap review' };
/** Said to a screen reader after "Ask AI", so the button says what it asks about. */
export const AI_FOR: Record<AiKind, string> = { scope_draft: 'a scope statement', exclusions_check: 'the exclusions', parties_suggest: 'the interested parties', gap_review: 'the gaps an auditor would find' };

/** The kinds of help that sit after one field, when the framework has that field. */
export function aiKindsAfter(steps: ReadonlyArray<Pick<Step, 'key' | 'fields'>>, stepKey: string, fieldKey: string): AiKind[] {
  return (Object.keys(AI_PLACE) as AiKind[]).filter((k) => {
    const at = AI_PLACE[k];
    return !!at && at.step === stepKey && at.field === fieldKey && steps.some((s) => s.key === stepKey && s.fields.some((f) => f.key === fieldKey));
  });
}

export function aiOrigin(by: 'ai' | 'rules'): { tag: 'AI' | 'Rules'; note: string } {
  return by === 'ai'
    ? { tag: 'AI', note: 'Written by AI from your organisation profile and your answers. Check it before you accept it.' }
    : { tag: 'Rules', note: 'Made without AI, from what the organisation profile and your answers already hold.' };
}

type Loose = Record<string, unknown>;
const asObjects = (v: unknown): Loose[] => (Array.isArray(v) ? v.filter((x): x is Loose => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function draftStatement(s: unknown): string { return text((s as Loose | null)?.statement); }

/** The rows an exclusions check or a parties suggestion proposes, as the columns of the table they would join (empty rows are dropped). */
export function suggestedRows(kind: 'exclusions_check' | 'parties_suggest', s: unknown): Array<Record<string, string>> {
  const o = (s ?? {}) as Loose;
  const cols = kind === 'exclusions_check' ? ['item', 'reason'] : ['party', 'kind', 'requirement'];
  const list = asObjects(kind === 'exclusions_check' ? o.exclusions : o.rows);
  return list.map((r) => Object.fromEntries(cols.map((c) => [c, text(r[c])]))).filter((r) => r[cols[0]]);
}

export const exclusionQuestions = (s: unknown): Array<{ item: string; why: string }> =>
  asObjects((s as Loose | null)?.questions).map((q) => ({ item: text(q.item), why: text(q.why) })).filter((q) => q.item && q.why);

export const gapQuestions = (s: unknown): Array<{ field: string; question: string }> =>
  asObjects((s as Loose | null)?.questions).map((q) => ({ field: text(q.field), question: text(q.question) })).filter((q) => q.question);

/** The rows of a table with the new ones after them; a row whose key column is already there (any case) is not added twice. */
export function appendRows(current: unknown, add: ReadonlyArray<Record<string, string>>, keyColumn: string): { value: unknown[]; added: number } {
  const rows = asObjects(current);
  const have = new Set(rows.map((r) => text(r[keyColumn]).toLowerCase()));
  const fresh = add.filter((r) => {
    const k = (r[keyColumn] ?? '').toLowerCase();
    if (!k || have.has(k)) return false;
    have.add(k);
    return true;
  });
  return { value: [...rows, ...fresh], added: fresh.length };
}

export interface AiChange { step: string; field: string; value: unknown; added: number }
const KEY_COLUMN = { exclusions_check: 'item', parties_suggest: 'party' } as const;

/**
 * The change an accepted suggestion makes to one field, for the normal autosave to save: a scope draft replaces the statement; exclusions and parties are
 * appended to the rows already there (the ones in `picked`, or all). Null when there is nothing to write (a gap review only shows questions).
 */
export function aiChange(kind: AiKind, suggestion: unknown, current: unknown, pick: { text?: string; rows?: readonly number[] } = {}): AiChange | null {
  const at = AI_PLACE[kind];
  if (!at) return null;
  if (kind === 'scope_draft') {
    const statement = (pick.text ?? draftStatement(suggestion)).trim();
    return statement ? { ...at, value: statement, added: 1 } : null;
  }
  const all = suggestedRows(kind as 'exclusions_check' | 'parties_suggest', suggestion);
  const chosen = pick.rows ? all.filter((_, i) => pick.rows!.includes(i)) : all;
  const { value, added } = appendRows(current, chosen, KEY_COLUMN[kind as 'exclusions_check' | 'parties_suggest']);
  return added > 0 ? { ...at, value, added } : null;
}
