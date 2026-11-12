// Approval defaults: who reviews and approves the documents of a department, sub-department or unit by default, and who carries out its exceptions, as plain
// functions (no React, no @/ imports) so `node --test` runs approvalDefaults.test.ts against them. Backend: services/approval_defaults.py and
// modules/governance/routers/approval_defaults.py (`/governance/approval-defaults`). Used by the Directory's Approvals and Exceptions tabs, by "Submit for review"
// (a notice that defaults apply, and the people a lock keeps in) and by the exception form (the implementer starts as the unit's default).
//
// What the server decides, in short: per subject the nearest ACTIVE default up the tree wins (the unit, the ones above it, then the organisation's); a LOCKED one
// stands over every unlocked one below it (a write below is refused with 409); a route beats reviewers and approvers set at its own level or above; the default is copied
// into a document's sign-off when it is sent for review and nobody is named; a locked default's people must stay among the participants. This file reads the
// answers, builds what a form starts with and sends, and says it in words; it never decides which default applies (the server's `effective` and `source` do).
import { KIND_OPTIONS, blankStage, defaultStages, routeProblem, routeSummary, toApi, used, type DraftStage, type RouteStageIn, type StageKind, type StageOrder, type StageRule, type Target } from './approvalRoutes.ts';
import { personKey as ruleKey, stepHow } from './exceptionRules.ts';

// ─── What the server sends ───────────────────────────────────────────────────────────────────────────────────────────────

export const SUBJECTS = ['doc_review', 'doc_approval', 'doc_route', 'exc_implementer'] as const;
export type Subject = (typeof SUBJECTS)[number];
export type PersonType = 'user' | 'role' | 'team' | 'unit_owner' | 'parent_owner';
const PERSON_TYPES: readonly string[] = ['user', 'role', 'team', 'unit_owner', 'parent_owner'];
const KINDS: readonly string[] = KIND_OPTIONS.map((k) => k.value);

/** Somebody a default asks: by name (`label`), never by id on a screen. An owner has no id; `holder` is who it is today. `gone`: the person or role no longer exists. */
export interface DefaultPerson { type: PersonType; id: number | null; label: string; holder: string | null; gone: boolean }
export interface RouteRowPerson { target_type: PersonType; target_id: number | null; label: string; holder: string | null; gone: boolean }
export interface RouteRowStage {
  position: number; name: string; kind: StageKind; order: StageOrder; rule: StageRule; min_count: number | null; due_days: number | null; people: RouteRowPerson[];
}
export interface DefaultRow {
  id: number; department_id: number | null; subject: Subject; people: DefaultPerson[]; route: RouteRowStage[] | null; locked: boolean; is_active: boolean; updated_at: string | null;
}
/** Where a default that applies comes from: `department_id` null is the whole organisation; `inherited` is true when it is not the unit asked about. */
export interface Source { department_id: number | null; name: string; inherited: boolean }
export interface SubjectState { own: DefaultRow | null; effective: DefaultRow | null; source: Source | null; locked_above: boolean }
export type DocumentFollows = 'route' | 'people' | null;
export interface DefaultsAnswer {
  department_id: number | null; department_name: string; document: DocumentFollows; can_edit: boolean; subjects: Record<Subject, SubjectState>;
}
/** `GET /resolve`: what a document or an exception of a unit would get (for forms). */
export interface Resolved { document: DocumentFollows; subjects: Partial<Record<Subject, { effective: DefaultRow | null; source: Source | null }>> }

const rec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const kind = (v: unknown): StageKind => (typeof v === 'string' && KINDS.includes(v) ? (v as StageKind) : 'review');

function personOf(raw: unknown, typeKey: 'type' | 'target_type', idKey: 'id' | 'target_id'): { type: PersonType; id: number | null; label: string; holder: string | null; gone: boolean } | null {
  if (!rec(raw) || typeof raw[typeKey] !== 'string' || !PERSON_TYPES.includes(raw[typeKey] as string)) return null;
  return { type: raw[typeKey] as PersonType, id: whole(raw[idKey]), label: text(raw.label), holder: typeof raw.holder === 'string' ? raw.holder : null, gone: raw.gone === true };
}

function stageOf(raw: unknown, i: number): RouteRowStage | null {
  if (!rec(raw)) return null;
  const people = (Array.isArray(raw.people) ? raw.people : []).flatMap((p) => {
    const x = personOf(p, 'target_type', 'target_id');
    return x ? [{ target_type: x.type, target_id: x.id, label: x.label, holder: x.holder, gone: x.gone }] : [];
  });
  const order = raw.order === 'in_turn' ? 'in_turn' : 'together';
  const rule = raw.rule === 'any' || raw.rule === 'at_least' ? raw.rule : 'all';
  return { position: whole(raw.position) ?? i + 1, name: text(raw.name), kind: kind(raw.kind), order, rule, min_count: whole(raw.min_count), due_days: whole(raw.due_days), people };
}

/** A row of the answer; null when it is not one (the caller then treats the subject as not set). */
export function parseRow(raw: unknown): DefaultRow | null {
  if (!rec(raw) || whole(raw.id) === null || !(SUBJECTS as readonly string[]).includes(text(raw.subject))) return null;
  const people = (Array.isArray(raw.people) ? raw.people : []).flatMap((p) => { const x = personOf(p, 'type', 'id'); return x ? [x] : []; });
  const route = Array.isArray(raw.route) && raw.route.length ? raw.route.flatMap((s, i) => { const x = stageOf(s, i); return x ? [x] : []; }) : null;
  return {
    id: raw.id as number, department_id: whole(raw.department_id), subject: raw.subject as Subject, people, route, locked: raw.locked === true,
    is_active: raw.is_active !== false, updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : null,
  };
}

function parseSource(raw: unknown): Source | null {
  return rec(raw) ? { department_id: whole(raw.department_id), name: text(raw.name), inherited: raw.inherited === true } : null;
}

const NOTHING: SubjectState = { own: null, effective: null, source: null, locked_above: false };

function parseState(raw: unknown): SubjectState {
  if (!rec(raw)) return NOTHING;
  return { own: parseRow(raw.own), effective: parseRow(raw.effective), source: parseSource(raw.source), locked_above: raw.locked_above === true };
}

const follows = (v: unknown): DocumentFollows => (v === 'route' || v === 'people' ? v : null);

/** `GET /governance/approval-defaults?department_id=`; null when the answer is not that (a backend without the API answers something else). */
export function parseAnswer(payload: unknown): DefaultsAnswer | null {
  if (!rec(payload) || !rec(payload.subjects)) return null;
  const subjects = Object.fromEntries(SUBJECTS.map((s) => [s, parseState((payload.subjects as Record<string, unknown>)[s])])) as Record<Subject, SubjectState>;
  return { department_id: whole(payload.department_id), department_name: text(payload.department_name), document: follows(payload.document), can_edit: payload.can_edit === true, subjects };
}

/** `GET /resolve` with or without a `subject`. */
export function parseResolved(payload: unknown): Resolved | null {
  if (!rec(payload)) return null;
  const subjects: Resolved['subjects'] = {};
  const one = (s: unknown, raw: unknown) => { if (typeof s === 'string' && (SUBJECTS as readonly string[]).includes(s) && rec(raw)) subjects[s as Subject] = { effective: parseRow(raw.effective), source: parseSource(raw.source) }; };
  if (rec(payload.subjects)) for (const s of SUBJECTS) one(s, (payload.subjects as Record<string, unknown>)[s]);
  else one(payload.subject, payload);
  return { document: follows(payload.document), subjects };
}

// ─── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SUBJECT_TITLE: Record<Subject, string> = { doc_review: 'Reviewers', doc_approval: 'Approvers', doc_route: 'Custom route', exc_implementer: 'Default implementer' };
/** What each says when nobody is chosen (the server's own sentences, so the check before sending says the same). */
export const NOBODY: Record<Subject, string> = {
  doc_review: 'Choose at least one reviewer.', doc_approval: 'Choose at least one approver.', doc_route: 'A route needs at least one stage.', exc_implementer: 'Choose who carries the exception out.',
};
export const OWNER_WORDS: Record<'unit_owner' | 'parent_owner', string> = { unit_owner: 'Owner of the unit', parent_owner: 'Owner of the unit above' };
export const isOwner = (type: string): boolean => type === 'unit_owner' || type === 'parent_owner';

/** "the organisation" for the organisation's own default (the server names it "The organisation"), else the unit's name. */
export const sourceName = (s: Pick<Source, 'department_id' | 'name'>): string => (s.department_id === null ? 'the organisation' : s.name);

/** One person as a line: a person by name, "Role: Approvers", "Department: Support", "Owner of the unit (Sam Lee)". */
export function personWords(p: { type: string; label: string; holder?: string | null }): string {
  if (p.type === 'unit_owner' || p.type === 'parent_owner') return p.holder ? `${OWNER_WORDS[p.type]} (${p.holder})` : OWNER_WORDS[p.type];
  if (p.type === 'role') return `Role: ${p.label}`;
  if (p.type === 'team') return `Department: ${p.label}`;
  return p.label;
}

/** "Rana, Role: Approvers, Owner of the unit +2": the first people and a count of the rest. */
export function peopleLine(people: readonly { type: string; label: string; holder?: string | null }[], max = 4): string {
  const names = people.map(personWords);
  return `${names.slice(0, max).join(', ')}${names.length > max ? ` +${names.length - max}` : ''}`;
}

/** What a stage's people answer and how long they have ("One after another · 3 days"); '' for one person with no days. */
export const stageHow = (s: Pick<RouteRowStage, 'order' | 'rule' | 'min_count' | 'due_days' | 'people'>): string => stepHow(s);

export const KIND_LABEL = Object.fromEntries(KIND_OPTIONS.map((k) => [k.value, k.label])) as Record<StageKind, string>;

/** A route as one sentence, the way "Submit for review" says it: "Rana reviews; then any one of Approvers approves." */
export function routeLine(route: readonly RouteRowStage[]): string {
  return routeSummary(stagesFromRoute(route), (t) => t.display || `${t.target_type} ${t.target_id}`);
}

/** What a document of the unit follows, in words. */
export function followsWords(document: DocumentFollows): string {
  if (document === 'route') return 'The custom route';
  if (document === 'people') return 'Reviewers, then approvers';
  return 'Whoever its author names';
}

// ─── Pickers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `GET /governance/documents/signoff/targets?department_id=`: who can be asked, and the two owners by the person they are today for that unit. */
export interface Targets {
  users: { id: number; name: string; email?: string | null }[];
  roles: { id: number; name: string; user_count: number }[];
  teams: { id: number; name: string; member_count: number }[];
  owners?: { type: 'unit_owner' | 'parent_owner'; name?: string; person: string | null }[];
}
export interface PickOption { value: string; label: string; description?: string }

/** A person as the pickers hold it: "user:12", "role:3", "team:5", and "unit_owner:0" for an owner (it has no id). */
export const pickKey = (type: string, id: number | null | undefined): string => `${type}:${isOwner(type) ? 0 : id ?? 0}`;
export const keysOfPeople = (people: readonly { type: string; id?: number | null }[]): string[] => people.map((p) => pickKey(p.type, p.id));

/** What PUT takes for the keys chosen (each once, in the order chosen): an owner without an id. */
export function peopleBody(keys: readonly string[]): { type: PersonType; id?: number }[] {
  return Array.from(new Set(keys)).map((k) => {
    const [type, id] = k.split(':');
    return isOwner(type) ? { type: type as PersonType } : { type: type as PersonType, id: Number(id) };
  });
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * Everything that can be chosen to be asked: the two owners first (named by who they are today when the unit is known), then people, roles and departments (a department only
 * where `teams`: someone who carries out an exception is a person, a role or an owner). A person the saved default names who the lists no longer hold (`keep`) stays so it
 * shows, and can be taken off.
 */
export function pickOptions(targets: Targets | null | undefined, opts: { teams: boolean; keep?: readonly { type: string; id?: number | null; label: string; holder?: string | null }[] }): PickOption[] {
  const holder = (type: 'unit_owner' | 'parent_owner') => targets?.owners?.find((o) => o.type === type)?.person ?? null;
  const out: PickOption[] = [
    { value: pickKey('unit_owner', 0), label: OWNER_WORDS.unit_owner, description: holder('unit_owner') ? `Today: ${holder('unit_owner')}` : "The head of the document's unit" },
    { value: pickKey('parent_owner', 0), label: OWNER_WORDS.parent_owner, description: holder('parent_owner') ? `Today: ${holder('parent_owner')}` : 'The head of the unit above it' },
    ...[...(targets?.users ?? [])].sort(byName).map((u) => ({ value: pickKey('user', u.id), label: u.name, description: u.email || undefined })),
    ...[...(targets?.roles ?? [])].sort(byName).map((r) => ({ value: pickKey('role', r.id), label: `Role: ${r.name}`, description: count(r.user_count, 'person', 'people') })),
    ...(opts.teams ? [...(targets?.teams ?? [])].sort(byName).map((t) => ({ value: pickKey('team', t.id), label: `Department: ${t.name}`, description: count(t.member_count, 'member', 'members') })) : []),
  ];
  (opts.keep ?? []).forEach((p) => {
    const value = pickKey(p.type, p.id);
    if (!out.some((o) => o.value === value)) out.push({ value, label: personWords(p), description: 'No longer on offer: remove it' });
  });
  return out;
}

// ─── What a form starts with and sends ───────────────────────────────────────────────────────────────────────────────────

/** A default being edited: the people (reviewers, approvers, implementer), or the stages of a route; whether it is locked and in force. */
export interface Draft { people: string[]; stages: DraftStage[]; locked: boolean; active: boolean }

const targetOf = (p: RouteRowPerson): Target => ({ target_type: p.target_type, target_id: isOwner(p.target_type) ? 0 : p.target_id ?? 0, display: personWords({ type: p.target_type, label: p.label, holder: p.holder }) });

/** The stages of a saved route, to change them; today's two (reviewers, approvers) when there is none. */
export function stagesFromRoute(route: readonly RouteRowStage[] | null | undefined): DraftStage[] {
  if (!route || route.length === 0) return defaultStages([], []);
  return route.map((s) => ({ ...blankStage(s.kind), name: s.name, kind: s.kind, order: s.order, rule: s.rule, min_count: s.min_count ?? 2, due_days: s.due_days, people: s.people.map(targetOf) }));
}

/** What an editor opens with: the row's own values (a unit overriding starts from what it inherits: change it, then save), or an empty default. */
export function draftOf(row: DefaultRow | null): Draft {
  return { people: row ? keysOfPeople(row.people) : [], stages: stagesFromRoute(row?.route), locked: row?.locked ?? false, active: row?.is_active ?? true };
}

/** What PUT takes. A route's people are `{target_type, target_id}`; an owner's id is ignored by the server. */
export function bodyOf(subject: Subject, d: Draft): { people: { type: PersonType; id?: number }[]; route?: RouteStageIn[]; locked: boolean; is_active: boolean } {
  return subject === 'doc_route'
    ? { people: [], route: toApi(d.stages), locked: d.locked, is_active: d.active }
    : { people: peopleBody(d.people), locked: d.locked, is_active: d.active };
}

/** What is wrong before it is sent ("" when nothing): the server's own sentences. */
export function draftProblem(subject: Subject, d: Draft): string {
  if (subject === 'doc_route') return d.stages.some((s) => s.people.length) ? routeProblem(d.stages) : NOBODY.doc_route;
  return d.people.length === 0 ? NOBODY[subject] : '';
}

/** Whether two drafts say the same: what decides that closing the editor has something to lose. People are a set, except in a route, where their order is the turn. */
export function sameDraft(subject: Subject, a: Draft, b: Draft): boolean {
  const flat = (d: Draft) => JSON.stringify(subject === 'doc_route' ? { route: toApi(d.stages), l: d.locked, a: d.active } : { p: [...d.people].sort(), l: d.locked, a: d.active });
  return flat(a) === flat(b);
}

/** How many stages of the draft hold somebody (an empty one is left out when it is sent). */
export const stagesUsed = (d: Draft): number => used(d.stages).length;

// ─── A document's sign-off: what a lock keeps in ─────────────────────────────────────────────────────────────────────────

export type NeedRole = 'reviewer' | 'approver';
/** Somebody a LOCKED default requires among the participants of every document of the unit (and under it): `owner` ones are held by the server only (they are stored as the owner of a unit). */
export interface Need { role: NeedRole; key: string; label: string; source: string; owner: boolean }

/** What the locked default that applies asks of a document's sign-off: each person, as a reviewer or an approver, and who locked it. A route's approval stages ask approvers, every other stage reviewers. */
export function lockedNeeds(resolved: Resolved | null | undefined): Need[] {
  if (!resolved) return [];
  const out: Need[] = [];
  const add = (role: NeedRole, p: { type: string; id: number | null; label: string; holder: string | null }, source: Source | null) =>
    out.push({ role, key: pickKey(p.type, p.id), label: personWords(p), source: source ? sourceName(source) : 'a default', owner: isOwner(p.type) });
  if (resolved.document === 'route') {
    const r = resolved.subjects.doc_route;
    if (r?.effective?.locked) for (const s of r.effective.route ?? []) for (const p of s.people) add(s.kind === 'approval' ? 'approver' : 'reviewer', { type: p.target_type, id: p.target_id, label: p.label, holder: p.holder }, r.source);
  } else if (resolved.document === 'people') {
    for (const [subject, role] of [['doc_review', 'reviewer'], ['doc_approval', 'approver']] as const) {
      const r = resolved.subjects[subject];
      if (r?.effective?.locked) for (const p of r.effective.people) add(role, p, r.source);
    }
  }
  return out;
}

const roleOf = (k: StageKind): NeedRole => (k === 'approval' ? 'approver' : 'reviewer');

/**
 * The stages with the people a lock requires put back: one that no stage of its kind holds goes into the first stage of that kind. The same list (same reference) when nothing
 * is missing. Owners are left to the server, which refuses a Send without them in words.
 */
export function keepLocked(stages: DraftStage[], needs: readonly Need[]): DraftStage[] {
  let next = stages;
  for (const n of needs) {
    if (n.owner) continue;
    const holds = (s: DraftStage) => s.people.some((p) => pickKey(p.target_type, p.target_id) === n.key);
    if (next.some((s) => roleOf(s.kind) === n.role && holds(s))) continue;
    const at = next.findIndex((s) => roleOf(s.kind) === n.role);
    if (at < 0) continue;
    const [type, id] = n.key.split(':');
    next = next.map((s, i) => (i === at ? { ...s, people: [...s.people, { target_type: type, target_id: Number(id), display: n.label }] } : s));
  }
  return next;
}

/** Who a stage must keep (what `keepLocked` holds in it), for the line under its people. */
export function requiredIn(stage: DraftStage, needs: readonly Need[]): Need[] {
  return needs.filter((n) => !n.owner && n.role === roleOf(stage.kind) && stage.people.some((p) => pickKey(p.target_type, p.target_id) === n.key));
}

/** The default a document would get, in a few words: "Reviewers: Rana. Approvers: Role: Approvers." or the route as a sentence; '' when none applies. */
export function resolvedWho(resolved: Resolved | null | undefined): string {
  if (!resolved) return '';
  if (resolved.document === 'route') {
    const row = resolved.subjects.doc_route?.effective;
    return row?.route ? routeLine(row.route) : '';
  }
  if (resolved.document === 'people') {
    const part = (label: string, subject: 'doc_review' | 'doc_approval') => {
      const row = resolved.subjects[subject]?.effective;
      return row && row.people.length ? `${label}: ${peopleLine(row.people)}.` : '';
    };
    return [part('Reviewers', 'doc_review'), part('Approvers', 'doc_approval')].filter(Boolean).join(' ');
  }
  return '';
}

/** What a sign-off says about defaults (`defaults_available`: what Send would copy in now; `defaults_applied`: what filled it). */
export interface DefaultsNote { subject: string; subjects: string[]; source: Source | null; sources: string[] }

export function parseNote(raw: unknown): DefaultsNote | null {
  if (!rec(raw)) return null;
  return {
    subject: text(raw.subject), subjects: Array.isArray(raw.subjects) ? raw.subjects.filter((s): s is string => typeof s === 'string') : [],
    source: parseSource(raw.source), sources: Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === 'string') : [],
  };
}

/** "Defaults from Operations and the organisation" (the sources a note names, each by name). */
export function fromWords(note: Pick<DefaultsNote, 'source' | 'sources'>): string {
  const names = note.sources.length ? note.sources.map((n) => (n === 'The organisation' ? 'the organisation' : n)) : note.source ? [sourceName(note.source)] : [];
  const list = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Defaults from ${list || 'the unit'}`;
}

// ─── The exception form ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The implementer an exception of the unit starts with, as the exception form holds it ("user:12", "role:3", "unit_owner"): people, roles and owners that still exist (a department is no implementer). */
export function implementerKeys(row: DefaultRow | null | undefined): string[] {
  if (!row) return [];
  return row.people.filter((p) => p.type !== 'team' && !p.gone && (isOwner(p.type) || (p.id ?? 0) > 0)).map((p) => ruleKey({ type: p.type as 'user' | 'role' | 'unit_owner' | 'parent_owner', id: p.id ?? undefined }));
}

/** Whether two lists of keys hold the same people (order aside). */
export const sameKeys = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** The note under an implementer field that started from a default: where it comes from, and whether it can be changed. */
export function implementerNote(source: Source | null, locked: boolean): string {
  if (!source) return '';
  return `Default from ${sourceName(source)}.${locked ? ' It is locked: they stay among the implementers.' : ' You may change it.'}`;
}
