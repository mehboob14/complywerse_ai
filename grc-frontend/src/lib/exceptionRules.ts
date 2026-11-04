// Governance > Settings > Exception approvals: the rules that say who reviews and approves a policy exception, as plain functions (no React, no @/
// imports) so `node --test` runs exceptionRules.test.ts against them: what a rule says in words, what the editor starts with and sends, what it checks
// before it sends, and how the tester's answer reads. The server (modules/governance/exception_rules.py) checks everything again and its sentences are
// shown as they are; the checks here only save a round trip, and say what it says.
import { statusLabel } from './format.ts';
import { levelLabel } from './departments.ts';

// ─── What the server sends ───────────────────────────────────────────────────────────────────────────────────────────────

export type StepKind = 'review' | 'approval';
export type StepOrder = 'together' | 'in_turn';
export type StepRule = 'all' | 'any' | 'at_least';
export type PersonType = 'user' | 'role' | 'unit_owner' | 'parent_owner';

export interface RulePerson { type: PersonType; id?: number; label: string }
export interface RuleStep {
  position: number; name: string; kind: StepKind; order: StepOrder; rule: StepRule; min_count: number | null; due_days: number | null;
  allow_changes: boolean; allow_reject: boolean; people: RulePerson[];
}
export interface ExceptionRule {
  id: number; name: string; department_id: number | null;
  /** the names from the top department down to the rule's own; [] for the whole organisation */
  department_path: string[];
  department_level: number | null;
  priorities: string[]; doc_types: string[]; steps: RuleStep[]; is_active: boolean; created_at: string | null; updated_at: string | null;
}
/** What the editor picks from; the server sends it only to people who can change the rules. */
export interface RuleOptions {
  users: { id: number; name: string; email: string | null }[];
  roles: { id: number; name: string; user_count: number }[];
  priorities: string[];
  doc_types: string[];
}
export interface RulesAnswer { rules: ExceptionRule[]; can_edit: boolean; options: RuleOptions | null; level_labels: string[] }

/** What POST / PUT take. */
export interface RulePayload {
  name: string; department_id: number | null; priorities: string[]; doc_types: string[]; is_active: boolean;
  steps: Array<{
    name: string; kind: StepKind; order: StepOrder; rule: StepRule; min_count: number | null; due_days: number | null;
    allow_reject: boolean; allow_changes: boolean; people: Array<{ type: PersonType; id?: number }>;
  }>;
}

/** The tester's answer (POST .../preview): the rule an exception like that follows, and who each step asks now. A step here is the rule's as stored: no labels on its people. */
export interface PreviewSlot { key: string; type: PersonType; ref: number | null; label: string; members: number[] }
export type PreviewStep = Omit<RuleStep, 'people'> & { people: Array<{ type: PersonType; id?: number }>; slots: PreviewSlot[] };
export interface PreviewAnswer { rule: { id: number; name: string; department_id: number | null } | null; steps: PreviewStep[]; problems: string[] }

// ─── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The query key of the rules; their editor and the tester refresh with it (the tester's keys start with it). */
export const RULES_KEY = ['exception-approval-rules'];
export const MAX_STEPS = 8;
export const NAME_MAX = 120;
export const WHOLE_ORGANISATION = 'Whole organisation';
export const PRIORITY_ORDER = ['low', 'medium', 'high', 'critical'];
export const KIND_ORDER = ['policy', 'standard', 'procedure', 'guideline', 'charter', 'framework'];
export const KINDS: { value: StepKind; label: string }[] = [{ value: 'review', label: 'Review' }, { value: 'approval', label: 'Approval' }];
export const ORDERS: { value: StepOrder; label: string }[] = [{ value: 'together', label: 'Together' }, { value: 'in_turn', label: 'One after another' }];
export const RULES: { value: StepRule; label: string }[] = [{ value: 'all', label: 'Everyone' }, { value: 'any', label: 'Any one' }, { value: 'at_least', label: 'At least' }];
export const kindName = (kind: StepKind): string => (kind === 'approval' ? 'Approval' : 'Review');

/** The (i) notes of the card, the editor and the tester: what the card used to say in sentences. */
export const RULE_NOTES = {
  card: "Who reviews and approves a policy exception, for the whole organisation or for a department, sub-department or unit. The most specific rule wins: the deepest department, then the rule with more conditions, then the oldest. A department's rule covers its sub-departments and units until one has its own. With no rule, anyone allowed to approve exceptions decides, as before.",
  none: 'Until there is a rule, anyone allowed to approve exceptions decides, as before.',
  submitted: 'A rule applies when an exception is submitted. One already waiting keeps the steps it started with.',
  decides: 'The person who raised an exception never decides it. Only the people asked decide, administrators included.',
  inTurn: 'Choose them in the order they are asked.',
  tester: 'Pick what an exception is like to see the rule it would follow and who each step would ask. Rules are read as saved.',
  noRule: 'No rule applies. Anyone allowed to approve exceptions decides.',
};

// ─── A rule in words ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Operations › Support" with the level it sits at ("Sub-department", in the organisation's own words), or the whole organisation. */
export function scopeOf(
  rule: Pick<ExceptionRule, 'department_id' | 'department_path' | 'department_level'>,
  labels?: readonly string[],
): { text: string; level: string | null } {
  if (rule.department_id == null) return { text: WHOLE_ORGANISATION, level: null };
  if (rule.department_path.length === 0) return { text: 'Unknown department', level: null };                  // a department the tree no longer holds: the rule never matches
  return { text: rule.department_path.join(' › '), level: levelLabel(rule.department_level ?? rule.department_path.length, labels) };
}

/** The priorities and kinds of policy a rule is limited to, as words ("High", "Policy"); none: it applies to any. */
export const conditionChips = (rule: Pick<ExceptionRule, 'priorities' | 'doc_types'>): string[] => [...rule.priorities, ...rule.doc_types].map((w) => statusLabel(w));

/** The same in a sentence, for a screen reader and a tooltip: "Priority: High, Critical. Policy kind: Policy", or "Any priority and kind of policy". */
export function conditionsLong(rule: Pick<ExceptionRule, 'priorities' | 'doc_types'>): string {
  const parts = [
    rule.priorities.length ? `Priority: ${rule.priorities.map((w) => statusLabel(w)).join(', ')}` : '',
    rule.doc_types.length ? `Policy kind: ${rule.doc_types.map((w) => statusLabel(w)).join(', ')}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('. ') : 'Any priority and kind of policy';
}

/** "3 rules · 1 off" */
export function rulesSummary(rules: readonly { is_active: boolean }[]): string {
  const off = rules.filter((r) => !r.is_active).length;
  return `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}${off ? ` · ${off} off` : ''}`;
}

/** Who a step asks, as the table says it: the two owners in the organisation's words, a role with its word, a person by name. */
export function personLabel(p: Pick<RulePerson, 'type' | 'label'>): string {
  if (p.type === 'unit_owner') return 'Owner of the unit';
  if (p.type === 'parent_owner') return 'Owner of its parent department';
  return p.type === 'role' ? `Role: ${p.label}` : p.label;
}

/** "Review: Rev1, Rev2 +1": the step's name and its first people. */
export function stepText(step: { name: string; people: readonly Pick<RulePerson, 'type' | 'label'>[] }, max = 2): string {
  const labels = step.people.map(personLabel);
  return `${step.name}: ${labels.slice(0, max).join(', ')}${labels.length > max ? ` +${labels.length - max}` : ''}`;
}

/** The whole chain, short enough for a cell: "Review: Rev1, Rev2 → Approval: Owner of the unit". */
export const stepsLine = (steps: readonly RuleStep[]): string => steps.map((s) => stepText(s)).join(' → ');

/** How a step's people answer, and how long they have: "One after another · 3 days", "Any one", "At least 2 · 5 days"; '' for one person with no days. */
export function stepHow(step: { order: StepOrder; rule: StepRule; min_count: number | null; due_days: number | null; people: readonly unknown[] }): string {
  const parts: string[] = [];
  if (step.people.length > 1) parts.push(step.order === 'in_turn' ? 'One after another' : step.rule === 'any' ? 'Any one' : step.rule === 'at_least' ? `At least ${step.min_count}` : 'Everyone');
  if (step.due_days) parts.push(`${step.due_days} ${step.due_days === 1 ? 'day' : 'days'}`);
  return parts.join(' · ');
}

/** Every step in full, one to a line, for a tooltip: "Review: Rev1, Rev2, Rev3 (Any one · 3 days)". */
export function stepsLong(steps: readonly RuleStep[]): string {
  return steps.map((s) => {
    const how = stepHow(s);
    return `${stepText(s, s.people.length)}${how ? ` (${how})` : ''}`;
  }).join('\n');
}

/** What a slot asks, and who would answer for it: "Role: Approvers · App1, App2 +1"; a person is only their name; nobody who can act is said. */
export function slotText(label: string, names: readonly string[], max = 3): string {
  if (names.length === 1 && names[0] === label) return label;
  if (names.length === 0) return /\(none set\)$/.test(label) ? label : `${label} · nobody`;
  return `${label} · ${names.slice(0, max).join(', ')}${names.length > max ? ` +${names.length - max}` : ''}`;
}

// ─── The tester ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A slot of the tester's answer in words; its people are ids, `nameOf` gives their names (the editor's list of people). */
export const slotLine = (slot: PreviewSlot, nameOf: (id: number) => string): string =>
  slotText(slot.label, slot.type === 'user' ? (slot.members.length ? [slot.label] : []) : slot.members.map(nameOf));

/** The steps of the tester's answer: the name, how its people answer, and who it would ask now. */
export const previewSteps = (answer: PreviewAnswer, nameOf: (id: number) => string): Array<{ position: number; name: string; how: string; who: string[] }> =>
  answer.steps.map((s) => ({ position: s.position, name: s.name, how: stepHow(s), who: s.slots.map((slot) => slotLine(slot, nameOf)) }));

// ─── The editor: what it starts with ─────────────────────────────────────────────────────────────────────────────────────

/** A person, role or owner as the picker holds it: "user:12", "role:3", "unit_owner", "parent_owner". */
export const personKey = (p: { type: PersonType; id?: number }): string => (p.type === 'user' || p.type === 'role' ? `${p.type}:${p.id}` : p.type);
export function personFromKey(key: string): { type: PersonType; id?: number } {
  const [type, id] = key.split(':');
  return type === 'user' || type === 'role' ? { type, id: Number(id) } : { type: type as PersonType };
}

export interface DraftStep {
  key: string;
  /** '' is the kind's own name (Review, Approval): the server names the step so */
  name: string;
  kind: StepKind; order: StepOrder; rule: StepRule;
  /** a number being typed */
  min_count: string;
  due_days: string;
  allow_reject: boolean; allow_changes: boolean;
  /** personKey of each, in the order they were chosen (the order they are asked, for one after another) */
  people: string[];
}
export interface RuleForm { name: string; /** '' is the whole organisation */ department_id: string; priorities: string[]; doc_types: string[]; is_active: boolean; steps: DraftStep[] }

let made = 0;

/** A step with nobody chosen yet; a review may not reject unless told to, an approval may (the server's own defaults). */
export function blankStep(kind: StepKind = 'approval'): DraftStep {
  return { key: `step-${++made}`, name: '', kind, order: 'together', rule: 'all', min_count: '2', due_days: '', allow_reject: kind === 'approval', allow_changes: true, people: [] };
}

/** A new rule starts with the one step every rule needs: somebody decides. */
export const emptyRuleForm = (): RuleForm => ({ name: '', department_id: '', priorities: [], doc_types: [], is_active: true, steps: [blankStep('approval')] });

/** Edit starts with the rule as it is saved. */
export function formFromRule(rule: ExceptionRule): RuleForm {
  return {
    name: rule.name,
    department_id: rule.department_id == null ? '' : String(rule.department_id),
    priorities: rule.priorities,
    doc_types: rule.doc_types,
    is_active: rule.is_active,
    steps: rule.steps.map((s) => ({
      key: `step-${++made}`, name: s.name === kindName(s.kind) ? '' : s.name, kind: s.kind, order: s.order, rule: s.rule, min_count: String(s.min_count ?? 2),
      due_days: s.due_days == null ? '' : String(s.due_days), allow_reject: s.allow_reject, allow_changes: s.allow_changes, people: s.people.map(personKey),
    })),
  };
}

/** Whether two forms say the same (the step keys are only for React): what decides that closing the drawer has something to lose. */
export function sameRuleForm(a: RuleForm, b: RuleForm): boolean {
  const flat = (f: RuleForm) => JSON.stringify({ ...f, priorities: [...f.priorities].sort(), doc_types: [...f.doc_types].sort(), steps: f.steps.map(({ key, ...s }) => s) });
  return flat(a) === flat(b);
}

/** Every person, role and owner a step can ask, for its picker: the two owners, the roles (with how many people hold each) and the people. Someone a saved
 *  rule asks who the lists no longer hold (a person who left, a role that was removed) is kept so it shows, and can be taken off. */
export function askOptions(options: RuleOptions | null, saved: readonly RulePerson[] = []): Array<{ value: string; label: string; description?: string }> {
  const out: Array<{ value: string; label: string; description?: string }> = [
    { value: 'unit_owner', label: 'Owner of the unit', description: "The head of the exception's department" },
    { value: 'parent_owner', label: 'Owner of its parent department', description: 'The head of the department above it' },
    ...(options?.roles ?? []).map((r) => ({ value: `role:${r.id}`, label: `Role: ${r.name}`, description: `${r.user_count} ${r.user_count === 1 ? 'person' : 'people'}` })),
    ...(options?.users ?? []).map((u) => ({ value: `user:${u.id}`, label: u.name, description: u.email ?? undefined })),
  ];
  saved.forEach((p) => { if (!out.some((o) => o.value === personKey(p))) out.push({ value: personKey(p), label: personLabel(p) }); });
  return out;
}

/** The people of a step as a line, in the order they are asked: "Rev1, then Rev2, then Rev3" (what the form names for one after another). */
export function turnLine(keys: readonly string[], options: readonly { value: string; label: string }[]): string {
  return keys.map((k) => options.find((o) => o.value === k)?.label ?? k).join(', then ');
}

// ─── The editor: what it sends ───────────────────────────────────────────────────────────────────────────────────────────

const inOrder = (values: readonly string[], order: readonly string[]): string[] =>
  [...values].sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));

type PayloadStep = RulePayload['steps'][number];

/** What POST / PUT take for the form: one after another is always everyone (the server says so too), "at least" sends its number, empty days are none. */
export function payloadOf(form: RuleForm): RulePayload {
  return {
    name: form.name.trim(),
    department_id: form.department_id ? Number(form.department_id) : null,
    priorities: inOrder(form.priorities, PRIORITY_ORDER),
    doc_types: inOrder(form.doc_types, KIND_ORDER),
    is_active: form.is_active,
    steps: form.steps.map((s): PayloadStep => {
      const inTurn = s.order === 'in_turn';
      return {
        name: s.name.trim(), kind: s.kind, order: s.order, rule: inTurn ? 'all' : s.rule,
        min_count: !inTurn && s.rule === 'at_least' ? Number(s.min_count) : null,
        due_days: s.due_days.trim() === '' ? null : Number(s.due_days),
        allow_reject: s.allow_reject, allow_changes: s.allow_changes,
        people: s.people.map(personFromKey),
      };
    }),
  };
}

/** A saved rule as PUT takes it, with its switch set: Switch off and Switch on send the whole rule (the server replaces it). */
export function payloadOfRule(rule: ExceptionRule, isActive: boolean): RulePayload {
  return {
    name: rule.name, department_id: rule.department_id, priorities: rule.priorities, doc_types: rule.doc_types, is_active: isActive,
    steps: rule.steps.map((s): PayloadStep => ({
      name: s.name, kind: s.kind, order: s.order, rule: s.rule, min_count: s.min_count, due_days: s.due_days, allow_reject: s.allow_reject, allow_changes: s.allow_changes,
      people: s.people.map(({ type, id }) => (id == null ? { type } : { type, id })),
    })),
  };
}

// ─── The editor: what it checks ──────────────────────────────────────────────────────────────────────────────────────────

export interface StepErrors { people?: string; min_count?: string; due_days?: string }
export interface RuleErrors {
  name?: string;
  /** about the steps together: none, too many, the last is not an approval */
  steps?: string;
  /** by the step's key */
  byStep: Record<string, StepErrors>;
}

/** The obvious refusals, in the server's own words (without its "Step 2 (Approval): " in front: each sits under its step). */
export function ruleErrors(form: RuleForm): RuleErrors {
  const out: RuleErrors = { byStep: {} };
  const name = form.name.trim();
  if (!name) out.name = 'A rule needs a name.';
  else if (name.length > NAME_MAX) out.name = `A rule's name is at most ${NAME_MAX} characters.`;
  if (form.steps.length === 0) out.steps = 'A rule needs at least one step.';
  else if (form.steps.length > MAX_STEPS) out.steps = `A rule has at most ${MAX_STEPS} steps.`;
  else if (form.steps[form.steps.length - 1].kind !== 'approval') out.steps = 'The last step has to be an approval: somebody decides.';
  form.steps.forEach((s) => {
    const e: StepErrors = {};
    const people = new Set(s.people).size;
    if (people === 0) e.people = 'Choose who is asked.';
    if (people > 0 && s.order !== 'in_turn' && s.rule === 'at_least') {
      const n = Number(s.min_count);
      if (s.min_count.trim() === '' || !Number.isInteger(n) || n < 1 || n > people) e.min_count = `At least how many have to decide? A number from 1 to ${people}.`;
    }
    if (s.due_days.trim() !== '') {
      const n = Number(s.due_days);
      if (!Number.isFinite(n)) e.due_days = 'The days to act must be a number.';
      else if (!Number.isInteger(n) || n < 1 || n > 365) e.due_days = 'The days to act must be from 1 to 365.';
    }
    if (e.people || e.min_count || e.due_days) out.byStep[s.key] = e;
  });
  return out;
}

export const hasRuleErrors = (e: RuleErrors): boolean => Boolean(e.name || e.steps || Object.keys(e.byStep).length);

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** The first thing wrong, as the server would say it ("Step 1 (Approval): choose who is asked."), for the line above the Save button; '' when nothing is. */
export function ruleProblem(form: RuleForm): string {
  const e = ruleErrors(form);
  if (e.name) return e.name;
  if (e.steps) return e.steps;
  for (let i = 0; i < form.steps.length; i += 1) {
    const s = form.steps[i];
    const first = e.byStep[s.key]?.people ?? e.byStep[s.key]?.min_count ?? e.byStep[s.key]?.due_days;
    if (first) return `Step ${i + 1} (${s.name.trim() || kindName(s.kind)}): ${lowerFirst(first)}`;
  }
  return '';
}
