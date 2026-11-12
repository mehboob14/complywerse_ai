// node --test "src/app/(dashboard)/governance/documents/_workspace/folders/approvalsModel.test.ts"
// What the Directory's Approvals tab decides apart from the screen: the defaults badges of the Details table (unknown is not "none"), and what each default's card shows and
// offers for a unit that sets its own, inherits, sits under a lock, has one that is not in force, or is read by someone who may not change it. Also what the tabs promise as
// sources: the server decides which default applies, nothing here works it out; every state is drawn; nothing is written without the server's `can_edit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseAnswer, parseRow, type DefaultRow, type SubjectState } from '../../../../../../lib/approvalDefaults.ts';
import { cardView, organisationLine, rowWords, withDefaults } from './approvalsModel.ts';
import { badgesOf, type DirectoryNode } from './directoryModel.ts';
import { findViolations } from '../../../../../../components/ui/ds/kitRules.ts';

const node = (id: number): DirectoryNode => ({
  id, parent_department_id: null, name: `Unit ${id}`, code: null, level: 1, level_label: 'Department', head: null, is_active: true, counts: { documents: 0, members: 0, children: 0 }, can_manage: true,
});
const row = (over: Record<string, unknown> = {}): DefaultRow => parseRow({ id: 1, department_id: 5, subject: 'doc_review', people: [{ type: 'user', id: 7, label: 'Rana' }], route: null, locked: false, is_active: true, ...over }) as DefaultRow;
const src = (id: number | null, name: string, inherited: boolean) => ({ department_id: id, name, inherited });
const state = (over: Partial<SubjectState> = {}): SubjectState => ({ own: null, effective: null, source: null, locked_above: false, ...over });

test('the badges: a unit the overview lists defines those; one it does not list defines none; an answer that is not an overview draws nothing at all', () => {
  const nodes = [node(1), node(2), node(3)];
  const out = withDefaults(nodes, { units: { '1': { doc_review: true, doc_approval: false, doc_route: false, exc_implementer: true } }, organisation: { doc_review: false } });
  assert.deepEqual(badgesOf(out[0]), ['Reviewers', 'Implementer']);
  assert.deepEqual(badgesOf(out[1]), [], 'listed nowhere: defines none');
  assert.deepEqual(out[1].defaults, { doc_review: false, doc_approval: false, doc_route: false, exc_implementer: false });
  assert.equal(withDefaults(nodes, undefined), nodes, 'not read yet: the same nodes, no `defaults` (unknown is not none)');
  assert.equal(withDefaults(nodes, null), nodes);
  assert.equal(withDefaults(nodes, '<html>'), nodes);
  assert.equal(withDefaults(nodes, { units: [] }), nodes);
  assert.equal(nodes[0].defaults, undefined, 'the input is not changed');
  assert.deepEqual(badgesOf(withDefaults([node(9)], { units: { '9': { doc_route: true, doc_approval: true } } })[0]), ['Approvers', 'Workflow']);
});

test('nothing set anywhere: "Not set"; a person who may change it can Set it, one who may not reads that', () => {
  const v = cardView(state(), { canEdit: true, org: false });
  assert.deepEqual(v.pills, [{ label: 'Not set', tone: 'neutral' }]);
  assert.deepEqual(v.can, { set: true, edit: false, override: false, revert: false });
  assert.equal(v.row, null);
  assert.deepEqual(cardView(state(), { canEdit: false, org: false }).can, { set: false, edit: false, override: false, revert: false });
});

test('a unit\'s own default in force: "Set here" (for the organisation in its own popup), Edit and Revert; Locked is a second pill', () => {
  const own = row({ id: 4 });
  const s = state({ own, effective: own, source: src(5, 'Operations', false) });
  const v = cardView(s, { canEdit: true, org: false });
  assert.deepEqual(v.pills.map((p) => p.label), ['Set here']);
  assert.deepEqual(v.can, { set: false, edit: true, override: false, revert: true });
  assert.equal(v.own && !v.idle, true);
  assert.deepEqual(cardView(s, { canEdit: true, org: true }).pills.map((p) => p.label), ['Set for the organisation']);
  const locked = row({ id: 4, locked: true });
  assert.deepEqual(cardView(state({ own: locked, effective: locked, source: src(5, 'Operations', false) }), { canEdit: true, org: false }).pills.map((p) => p.label), ['Set here', 'Locked']);
  assert.deepEqual(cardView(s, { canEdit: false, org: false }).can, { set: false, edit: false, override: false, revert: false });
});

test('an inherited default: "Inherited from X" (the organisation by that word), Override, nothing to revert', () => {
  const eff = row({ id: 2, department_id: 3 });
  const v = cardView(state({ effective: eff, source: src(3, 'Finance', true) }), { canEdit: true, org: false });
  assert.deepEqual(v.pills.map((p) => p.label), ['Inherited from Finance']);
  assert.deepEqual(v.can, { set: false, edit: false, override: true, revert: false });
  assert.equal(v.row, eff);
  assert.equal(v.own, false);
  const all = cardView(state({ effective: row({ id: 9, department_id: null }), source: src(null, 'The organisation', true) }), { canEdit: true, org: false });
  assert.deepEqual(all.pills.map((p) => p.label), ['Inherited from the organisation']);
});

test('under a lock: the card says who locked it and offers nothing that would be refused; only a leftover default of the unit\'s own can still be reverted', () => {
  const eff = row({ id: 2, department_id: 3, locked: true });
  const s = state({ effective: eff, source: src(3, 'Finance', true), locked_above: true });
  const v = cardView(s, { canEdit: true, org: false });
  assert.equal(v.lockedBy?.name, 'Finance');
  assert.deepEqual(v.pills.map((p) => p.label), ['Inherited from Finance', 'Locked']);
  assert.deepEqual(v.can, { set: false, edit: false, override: false, revert: false });
  const mine = row({ id: 5, department_id: 7 });
  const left = cardView({ ...s, own: mine }, { canEdit: true, org: false });
  assert.equal(left.idle, true, 'its own is not in force: the lock stands over it');
  assert.equal(left.instead?.source.name, 'Finance');
  assert.deepEqual(left.pills.map((p) => p.label), ['Not active']);
  assert.deepEqual(left.can, { set: false, edit: false, override: false, revert: true }, 'removing it is allowed, changing it is refused (409)');
  assert.equal(cardView(state({ effective: row({ locked: false }), source: src(null, 'The organisation', true) }), { canEdit: true, org: false }).lockedBy, null, 'an unlocked default above is not a lock');
});

test('a default of the unit\'s own that is switched off is not in force: it says so, and what applies instead', () => {
  const off = row({ id: 6, is_active: false });
  const above = row({ id: 2, department_id: 3 });
  const v = cardView(state({ own: off, effective: above, source: src(3, 'Finance', true) }), { canEdit: true, org: false });
  assert.equal(v.idle, true);
  assert.deepEqual(v.pills.map((p) => p.label), ['Switched off']);
  assert.equal(v.instead?.row, above);
  assert.deepEqual(v.can, { set: false, edit: true, override: false, revert: true }, 'it can be switched on again');
  const alone = cardView(state({ own: off }), { canEdit: true, org: false });
  assert.equal(alone.instead, null);
});

test('a default in words: the people, or the route as a sentence; the organisation\'s own default is a line only where another one applies', () => {
  assert.equal(rowWords(row({ people: [{ type: 'user', id: 7, label: 'Rana' }, { type: 'role', id: 3, label: 'Approvers' }] })), 'Rana, Role: Approvers');
  assert.equal(rowWords(row({ subject: 'doc_route', people: [], route: [{ position: 1, name: 'Review', kind: 'review', order: 'together', rule: 'all', people: [{ target_type: 'user', target_id: 7, label: 'Rana' }] }] })), 'Rana reviews.');
  const orgRow = row({ id: 9, department_id: null, people: [{ type: 'user', id: 8, label: 'Chen' }] });
  const org = state({ own: orgRow, effective: orgRow, source: src(null, 'The organisation', false) });
  const own = row({ id: 4 });
  assert.equal(organisationLine(org, state({ own, effective: own, source: src(5, 'Operations', false) })), 'The organisation: Chen');
  assert.equal(organisationLine(org, state({ effective: orgRow, source: src(null, 'The organisation', true) })), null, 'the organisation\'s default is the one that applies: the pill says so');
  assert.equal(organisationLine(null, state()), null);
  assert.equal(organisationLine(state(), state()), null);
  assert.equal(organisationLine(state({ own: row({ id: 9, department_id: null, is_active: false }) }), state({ own })), null, 'switched off: it applies to nothing');
});

test('the answer of a backend without a field is read as nothing, never as a refusal or an empty default', () => {
  const a = parseAnswer({ department_id: 5, department_name: 'Operations', subjects: { doc_review: { own: { id: 'x' }, effective: null, source: null } } });
  assert.equal(a?.subjects.doc_review.own, null, 'a row that is not one');
  assert.equal(a?.can_edit, false);
  assert.equal(a?.document, null);
});

// ── the tabs, read from their sources (the repo's habit for pages) ───────────────────────────────────────────────────────────────

const DIR = new URL('./', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const FILES = ['ApprovalsTab.tsx', 'ExceptionsTab.tsx', 'DefaultCard.tsx', 'DefaultsGate.tsx', 'RouteEditor.tsx', 'defaultsData.ts', 'approvalsModel.ts', 'exceptionsModel.ts'];

test('the tabs are on the kit: the token rules hold, no hex, no model or vendor name, no bare <p>/<h2>/<h3> without a ds size, no console, no id printed', () => {
  for (const f of FILES) {
    assert.deepEqual(findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}`), []);
    assert.ok(!/\b(gpt|openai|anthropic|claude)\b/i.test(code(read(f))), f);
    assert.ok(!/\bconsole\.(log|warn|error|info|debug)\(/.test(code(read(f))), f);
    for (const tag of code(read(f)).match(/<(?:p|h2|h3)\b[^>]*>/g) ?? []) assert.ok(/text-ds-/.test(tag), `${f}: ${tag}`);
    assert.ok(!/>\s*\{[\w.?!]*\bid\}\s*</.test(code(read(f))), `${f}: an id printed as text`);
  }
});

test('every read has its states: loading, refused (not an error), failed with Retry, view only; a write needs the server\'s can_edit', () => {
  const gate = code(read('DefaultsGate.tsx'));
  assert.ok(gate.includes('<SkeletonLines') && gate.includes('statusOf(query.error) === 403') && gate.includes('<NoAccessState') && gate.includes('<ErrorState') && gate.includes('canRetry(query.error)') && gate.includes('<ReadOnlyNote>'));
  const data = code(read('defaultsData.ts'));
  assert.ok(data.includes('can_edit === true') && data.includes('useTargets(unit, canEdit)'), 'who can be asked is only read when something can be changed');
  assert.ok(data.includes('retry: false') && data.includes('useOrganisationDefaults'), 'the organisation\'s own is read quietly');
  const card = code(read('DefaultCard.tsx'));
  assert.ok(card.includes('cardView(state, { canEdit, org: isOrg })') && card.includes('view.can.set') && card.includes('view.can.override') && card.includes('view.can.edit') && card.includes('view.can.revert'));
  assert.ok(card.includes('<FormError') && card.includes('onError: (e) => setProblem(e)') && card.includes('retryable: false'), 'a refusal is shown above the fields in the server\'s words, with what was typed kept');
  assert.ok(card.includes('await confirm({') && card.includes("tone: 'danger'") && !/window\.(confirm|alert)\(/.test(card), 'Revert asks first, with the kit\'s dialog');
  assert.ok(card.includes('draftProblem(subject, draft)') && card.includes('<Checkbox label="Locked"') && card.includes('LOCK_NOTE'), 'checked before sending, with the server\'s sentences; Locked has its (i)');
  assert.ok(card.includes('Locked by ${sourceName(view.lockedBy)}') && card.includes('openUnit'), 'a lock above names who locked it and opens that unit');
  assert.ok(card.includes('report.current(subject, changed)'), 'typed input is reported, so the popup asks before it is closed');
});

test('the tabs mount for a unit or for the organisation, and the Approvals tab names the three cards; Exceptions has the rules and the implementer', () => {
  const approvals = code(read('ApprovalsTab.tsx'));
  assert.ok(approvals.includes("departmentId: number | 'org'") && approvals.includes("['doc_review', 'doc_approval', 'doc_route']") && approvals.includes('followsWords(data.document)'));
  const exceptions = code(read('ExceptionsTab.tsx'));
  assert.ok(exceptions.includes('exceptionRulesApi.list()') && exceptions.includes('RULES_KEY') && exceptions.includes('rulesFor(') && exceptions.includes('subject="exc_implementer"'));
  assert.ok(exceptions.includes('href="/governance/settings#exception-approvals"') && exceptions.includes('canRules') && !exceptions.includes('_RuleDrawer'), 'rules are changed in Settings (its drawer would open behind this popup), for those who may change rules');
  const tabs = code(read('directoryTabs.ts'));
  assert.ok(tabs.includes("ENABLED_TABS: readonly TabId[] = ['details', 'people', 'access', 'approvals', 'exceptions']"));
  assert.ok(tabs.includes('defaultsParam(props.node)'), 'the organisation popup mounts the same two tabs with "org"');
  const data = code(read('directoryData.ts'));
  assert.ok(data.includes('OVERVIEW_KEY') && data.includes('withDefaults(base.nodes, overview.data)'), 'the badges come from the overview, and a failed overview is no badge');
});
