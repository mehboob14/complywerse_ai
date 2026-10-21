// A document's approval route (backend: modules/governance/routes.py; PUT .../signoff/route, GET .../signoff `route`): the
// stages it goes through, built in Submit for review, and where it stands. Pure helpers, tested in approvalRoutes.test.ts.

export type StageKind = 'review' | 'concurrence' | 'recommendation' | 'approval' | 'information';
export type StageOrder = 'together' | 'in_turn';
export type StageRule = 'all' | 'any' | 'at_least';
export type Target = { target_type: string; target_id: number; display?: string };

/** What PUT .../signoff/route takes for each stage. */
export interface RouteStageIn {
  name?: string; kind: StageKind; order: StageOrder; rule: StageRule; min_count?: number | null; due_days?: number | null;
  people: { target_type: string; target_id: number }[];
}

/** A stage being built in the dialog. */
export interface DraftStage {
  key: string; name: string; kind: StageKind; order: StageOrder; rule: StageRule; min_count: number; due_days: number | null; people: Target[];
}

/** Where each person of a stage is this round (routes.view). */
export type PersonState = 'signed' | 'waiting' | 'not_yet' | 'changes_requested' | 'delegated' | 'not_needed' | 'informed';
/** What a person did at a stage before it started again after changes (routes.view `earlier`): signed (that signature no longer
 *  counts) or asked for the changes. */
export interface Earlier { kind: 'signed' | 'changes'; at: string | null; by: string | null; on_behalf_of: string | null; version: string | null; comment: string | null }
export interface RoutePerson {
  assignment_id: number; target_type: string; target_id: number; display: string; state: PersonState;
  signer: string | null; on_behalf_of: string | null; at: string | null; comment: string | null; due_date: string | null; delegated_to: string | null;
  /** servers from before stages started again after changes leave it out */
  earlier?: Earlier | null;
}
export type StageStatus = 'done' | 'current' | 'on_hold' | 'waiting' | 'not_started' | 'skipped' | 'informed';
export interface RouteStage {
  position: number; name: string; kind: StageKind; kind_label: string; order: StageOrder; rule: StageRule; min_count: number | null;
  due_days: number | null; signature: boolean; allow_reject: boolean; allow_delegate: boolean; status: StageStatus; people: RoutePerson[];
  progress: { required: number; signed: number } | null;
  /** it started again after changes asked for at it were resubmitted */
  restarted?: boolean;
}
export interface RouteHold { id: number; stage_position: number | null; requested_by: string | null; requested_by_id: number; requested_at: string | null; comment: string }
export interface RouteView { custom: boolean; current: number | null; stages: RouteStage[]; hold: RouteHold | null }
/** Why someone is asked again at a stage that started again after changes (routes.again_for: my_step, My Approvals, a task):
 *  they had signed it or asked for the changes; the version then (its row: "See what changed" compares from it) and now. */
export interface Again {
  kind: 'signed' | 'changes'; stage: string; stage_kind: StageKind; at: string | null; version: string | null; version_id: number | null;
  comment: string | null; now: string | null; changed: boolean; by: string | null; note: string | null;
}
/** The step the person reading may take now (GET .../signoff `my_step`). */
export interface MyStep {
  stage_position: number; stage_name: string; kind: StageKind; kind_label: string; role_type: 'reviewer' | 'approver'; in_turn: boolean;
  can_reject: boolean; can_delegate: boolean; on_behalf_of: string | null;
  /** asked again after changes (servers from before leave it out) */
  again?: Again | null;
}

export const KIND_OPTIONS: { value: StageKind; label: string }[] = [
  { value: 'review', label: 'Review' }, { value: 'concurrence', label: 'Concurrence' }, { value: 'recommendation', label: 'Recommendation' },
  { value: 'approval', label: 'Approval' }, { value: 'information', label: 'For information' },
];
const KIND_NAME: Record<StageKind, string> = Object.fromEntries(KIND_OPTIONS.map((k) => [k.value, k.label])) as Record<StageKind, string>;
/** the button that signs at a stage of each kind, and the bar's button that opens it */
export const SIGN_LABEL: Record<StageKind, string> = {
  review: 'Sign as reviewed', concurrence: 'Concur and sign', recommendation: 'Recommend and sign', approval: 'Sign and approve', information: 'Sign',
};
export const STEP_LABEL: Record<StageKind, string> = {
  review: 'Review and sign', concurrence: 'Concur and sign', recommendation: 'Recommend and sign', approval: 'Approve and sign', information: 'Sign',
};
/** "Your review is needed", "Your concurrence is needed" */
export const STEP_NOUN: Record<StageKind, string> = {
  review: 'review', concurrence: 'concurrence', recommendation: 'recommendation', approval: 'approval', information: 'step',
};
const VERB: Record<StageKind, [string, string]> = {          // [one person, several]
  review: ['reviews', 'review'], concurrence: ['concurs', 'concur'], recommendation: ['recommends', 'recommend'],
  approval: ['approves', 'approve'], information: ['is told', 'are told'],
};

let made = 0;
const key = () => `stage-${++made}`;

export function blankStage(kind: StageKind = 'review'): DraftStage {
  return { key: key(), name: KIND_NAME[kind], kind, order: 'together', rule: 'all', min_count: 2, due_days: null, people: [] };
}

/** What a route opens with: today's two stages, the reviewers then the approvers. */
export function defaultStages(reviewers: Target[], approvers: Target[]): DraftStage[] {
  return [{ ...blankStage('review'), people: reviewers }, { ...blankStage('approval'), people: approvers }];
}

/** The route as the server keeps it, to change it (its people in their turn order); the two default stages when it has none. */
export function stagesOf(route: RouteView | null | undefined, reviewers: Target[], approvers: Target[]): DraftStage[] {
  if (!route?.custom) return defaultStages(reviewers, approvers);
  return route.stages.map((s) => ({
    key: key(), name: s.name, kind: s.kind, order: s.order, rule: s.rule, min_count: s.min_count ?? 2, due_days: s.due_days,
    people: s.people.map((p) => ({ target_type: p.target_type, target_id: p.target_id, display: p.display })),
  }));
}

/** The stages that are sent: a stage with nobody chosen is left out (the route skips it). */
export const used = (stages: DraftStage[]) => stages.filter((s) => s.people.length > 0);

/** Today's flow: reviewers all at once (everyone signs), then approvers likewise, no days of their own. Sent as reviewers and
 *  approvers, so a document keeps the default route until its route is changed. */
export function isDefaultShape(stages: DraftStage[]): boolean {
  const u = used(stages);
  const plain = (s: DraftStage, kind: StageKind) => s.kind === kind && s.order === 'together' && s.rule === 'all' && s.due_days == null
    && s.name.trim() === KIND_NAME[kind];
  if (u.length > 2) return false;
  if (u.length === 2) return plain(u[0], 'review') && plain(u[1], 'approval');
  return u.length === 1 && (plain(u[0], 'review') || plain(u[0], 'approval'));
}

export function toApi(stages: DraftStage[]): RouteStageIn[] {
  return used(stages).map((s) => ({
    name: s.name.trim() || KIND_NAME[s.kind], kind: s.kind, order: s.order, rule: s.order === 'in_turn' ? 'all' : s.rule,
    min_count: s.rule === 'at_least' && s.order !== 'in_turn' ? s.min_count : null, due_days: s.due_days,
    people: s.people.map(({ target_type, target_id }) => ({ target_type, target_id })),
  }));
}

/** What is wrong with the route before it is sent ("" when nothing). */
export function routeProblem(stages: DraftStage[]): string {
  const u = used(stages);
  if (!u.length) return 'Choose who reviews or approves it.';
  if (u.every((s) => s.kind === 'information')) return 'Add a stage where someone reviews or approves.';
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (s.people.length && s.order !== 'in_turn' && s.rule === 'at_least') {
      const people = s.people.every((p: Target) => p.target_type === 'user') ? s.people.length : Infinity;
      if (!Number.isInteger(s.min_count) || s.min_count < 1 || s.min_count > people) {
        return `Stage ${i + 1}: at least how many have to sign? A number from 1${people !== Infinity ? ` to ${people}` : ''}.`;
      }
    }
    if (s.due_days != null && (!Number.isInteger(s.due_days) || s.due_days < 1 || s.due_days > 365)) return `Stage ${i + 1}: days to act must be from 1 to 365.`;
  }
  return '';
}

const list = (names: string[], last: string) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${last} ${names[names.length - 1]}`);

/** The route in words, as the dialog says it before sending: "Rana, then Rafay, then Uma review; then any one of Approvers approves." */
export function routeSummary(stages: DraftStage[], nameOf: (t: Target) => string): string {
  const parts = used(stages).map((s) => {
    const names = s.people.map(nameOf);
    const [one, many] = VERB[s.kind];
    if (s.kind === 'information') return `${list(names, 'and')} ${names.length === 1 ? one : many}`;
    if (s.order === 'in_turn' && names.length > 1) return `${names.join(', then ')} ${many}, one after another`;
    if (names.length === 1) return `${names[0]} ${one}`;
    if (s.rule === 'any') return `any one of ${list(names, 'or')} ${one}`;
    if (s.rule === 'at_least') return `at least ${s.min_count} of ${list(names, 'and')} ${many}`;
    return `${list(names, 'and')} ${many}`;
  });
  if (!parts.length) return '';
  const text = parts.join('; then ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

const DID: Record<StageKind, string> = {
  review: 'reviewed', concurrence: 'concurred with', recommendation: 'recommended', approval: 'approved', information: 'read',
};
const DO: Record<StageKind, string> = { review: 'review', concurrence: 'concur with', recommendation: 'recommend', approval: 'approve', information: 'read' };

/** Why the person is asked again, as their step, My Approvals and their task say it (the message says the same): "You reviewed this
 *  on 21 Oct 2026 (v1.0). Olivia made changes since (v1.0 → v1.2). Please review it again." or "You asked for changes on 21 Oct 2026:
 *  “…”. Olivia resubmitted it (v1.2) — see what changed." `day` writes a date in the reader's words. */
export function againLine(a: Again, day: (iso: string | null) => string): string {
  const on = a.at ? ` on ${day(a.at)}` : '';
  const by = a.by || 'The author';
  const now = a.now ? ` (v${a.now})` : '';
  const unchanged = `${by} resubmitted it without changing the text${now}.`;
  if (a.kind === 'changes') return `You asked for changes${on}: “${a.comment ?? ''}”. ${a.changed ? `${by} resubmitted it${now} — see what changed.` : unchanged}`;
  const since = !a.changed ? unchanged : a.version && a.now ? `${by} made changes since (v${a.version} → v${a.now}).` : `${by} made changes since.`;
  return `You ${DID[a.stage_kind] ?? 'reviewed'} this${on}${a.version ? ` (v${a.version})` : ''}. ${since} Please ${DO[a.stage_kind] ?? 'review'} it again.`;
}

/** Where "See what changed" goes: the document with its changes marked since the version they signed or asked on; null when the
 *  text did not change or that version is not known. */
export function seeChangesHref(documentId: number, a: Again | null | undefined): string | null {
  return a?.changed && a.version_id ? `/governance/documents/${documentId}?changes=${a.version_id}` : null;
}

/** A person's step before their stage started again, in the route view: "Signed v1.0 · asked again after changes". */
export function earlierLine(e: Earlier): string {
  const what = e.kind === 'signed' ? `Signed${e.version ? ` v${e.version}` : ''}` : `Asked for changes${e.version ? ` on v${e.version}` : ''}`;
  return `${what} · asked again after changes`;
}

/** A request someone was asked again later (their stage started again after changes, or a new round): the earlier one is history. */
export function askedAgain(rows: { id: number; user_id: number; kind: string }[], row: { id: number; user_id: number; kind: string }): boolean {
  return rows.some((r) => r.user_id === row.user_id && r.kind === row.kind && r.id > row.id);
}

/** Swap a stage, or a person within a stage, with its neighbour (`by` -1 up, +1 down); the list unchanged at either end. */
export function moved<T>(items: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= items.length) return items;
  const out = [...items];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

/** The people picked in the dropdown, in their turn order: those already chosen keep their place, new ones come last. */
export function picked(values: string[], chosen: Target[]): Target[] {
  const keyOf = (p: Target) => `${p.target_type}:${p.target_id}`;
  const kept = chosen.filter((p) => values.includes(keyOf(p)));
  const added = values.filter((v) => !chosen.some((p) => keyOf(p) === v))
    .map((v) => ({ target_type: v.split(':')[0], target_id: Number(v.split(':')[1]) }));
  return [...kept, ...added];
}
