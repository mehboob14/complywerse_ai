// node --test "src/app/(dashboard)/governance/documents/_workspace/folders/directoryModel.test.ts"
// The folders' rules: the nodes from either backend answer, the tree, what each action may do and why not, the choices of Move and New and the popup's tabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ORGANISATION, ORG_NODE_ID, ORG_PARAM, badgesOf, buildTree, defaultsParam, isOrgAddress, organisationNode, countText, fromDirectory, fromList, libraryHref, moveChoices, newPlaceChoices,
  shownTabs, tabOr, unitActions, unitFromAddress, viewOnly, type Directory, type ListRow,
} from './directoryModel.ts';

// the scratch tenant: Operations > Support, Information Security > SOC Operations, and six departments with nothing under them
const LIST: ListRow[] = [
  { id: 3, name: 'Finance', code: 'FINA', parent_department_id: null, level: 1, level_label: 'Department', is_active: true, member_count: 2, document_count: 8, child_count: 0 },
  { id: 7, name: 'Human Resources', code: 'HR', parent_department_id: null, level: 1, level_label: 'Department', is_active: true, member_count: 0, document_count: 7, child_count: 0, department_head_user_id: 9, department_head_name: 'Hana Head' },
  { id: 4, name: 'Information Security', code: 'IS', parent_department_id: null, level: 1, level_label: 'Department', is_active: true, member_count: 5, document_count: 11, child_count: 1 },
  { id: 1, name: 'Operations', code: 'OPER', parent_department_id: null, level: 1, level_label: 'Department', is_active: true, member_count: 3, document_count: 5, child_count: 1 },
  { id: 5, name: 'SOC Operations', code: 'SO', parent_department_id: 4, level: 2, level_label: 'Sub-department', is_active: true, member_count: 1, document_count: 4, child_count: 0 },
  { id: 2, name: 'Support', code: 'SUPP', parent_department_id: 1, level: 2, level_label: 'Sub-department', is_active: false, member_count: 0, document_count: 4, child_count: 0 },
  { id: 6, name: 'Legal', code: 'LEGA', parent_department_id: null, level: 1, level_label: 'Department', is_active: true, member_count: 0, document_count: 6, child_count: 0 },
];
const LEVELS = ['Department', 'Sub-department', 'Unit'];
const dir = (canManage = true): Directory => fromList(LIST, canManage);
const ctx = { canTop: true, levels: LEVELS, tabs: ['details', 'people'] };

test('the flat list becomes nodes: every unit, the owner as a name, the counts, and the global right as can_manage', () => {
  const d = dir(true);
  assert.equal(d.source, 'list');
  assert.equal(d.nodes.length, 7);
  const hr = d.nodes.find((n) => n.id === 7)!;
  assert.deepEqual(hr.head, { id: 9, name: 'Hana Head' });
  assert.deepEqual(hr.counts, { documents: 7, members: 0, children: 0 });
  assert.equal(d.nodes.find((n) => n.id === 2)!.is_active, false);
  assert.ok(d.nodes.every((n) => n.can_manage));
  assert.ok(dir(false).nodes.every((n) => !n.can_manage));
  assert.deepEqual(d.levels, LEVELS);
  assert.deepEqual(fromList(LIST, true, ['Division', 'Team', 'Cell']).levels, ['Division', 'Team', 'Cell'], 'the organisation\'s own names');
  assert.deepEqual(fromList(LIST, true, ['only one']).levels, LEVELS, 'a list of the wrong length is not used');
});

test('a row without a level or a count is still a node: the level comes from the tree, a missing count is 0', () => {
  const d = fromList([{ id: 1, name: 'A', is_active: true }, { id: 2, name: 'B', parent_department_id: 1, is_active: true }, { id: 3, name: 'C', parent_department_id: 2, is_active: true }], false);
  assert.deepEqual(d.nodes.map((n) => [n.level, n.level_label, n.counts.children]), [[1, 'Department', 1], [2, 'Sub-department', 1], [3, 'Unit', 0]]);
  assert.deepEqual(d.nodes[0].counts, { documents: 0, members: 0, children: 1 });
});

test('a department that is its own parent, or whose parent is gone, is a top one (nothing is lost)', () => {
  const d = fromList([{ id: 1, name: 'Loop', parent_department_id: 1, is_active: true }, { id: 2, name: 'Orphan', parent_department_id: 99, is_active: true }], true);
  const tree = buildTree(d.nodes);
  assert.deepEqual(tree.childrenOf(null).map((n) => n.id), [1, 2]);
  assert.equal(d.nodes[0].parent_department_id, null);
});

test('the Directory API answer is read as it is, with its level names and per-unit can_manage; anything else is "not the Directory API"', () => {
  const answer = {
    levels: ['Division', 'Team', 'Cell'],
    nodes: [
      { id: 1, parent_id: null, name: 'Operations', code: 'OPER', level: 1, level_label: 'Division', head: { id: 4, name: 'Olivia Owner' }, is_active: true, counts: { documents: 5, members: 3, children: 1 }, can_manage: true },
      { id: 2, parent_id: 1, name: 'Support', code: 'SUPP', level: 2, level_label: '', head: null, is_active: false, counts: { documents: 4 }, can_manage: false },
    ],
  };
  const d = fromDirectory(answer)!;
  assert.equal(d.source, 'directory');
  assert.deepEqual(d.levels, ['Division', 'Team', 'Cell']);
  assert.deepEqual(d.nodes.map((n) => [n.id, n.parent_department_id, n.can_manage, n.is_active, n.level_label]), [[1, null, true, true, 'Division'], [2, 1, false, false, 'Team']]);
  assert.deepEqual(d.nodes[1].counts, { documents: 4, members: 0, children: 0 });
  assert.deepEqual(d.nodes[0].head, { id: 4, name: 'Olivia Owner' });
  for (const odd of [null, undefined, 'x', 7, [], {}, { nodes: 'no' }, { detail: [{ type: 'int_parsing' }] }, { nodes: [{ id: 1 }] }, { nodes: [null] }, { nodes: [{ id: 'a', name: 'x' }] }]) {
    assert.equal(fromDirectory(odd), null, JSON.stringify(odd));
  }
  assert.equal(fromDirectory({ nodes: [] })!.nodes.length, 0, 'an organisation with no departments yet is an answer');
  assert.deepEqual(fromDirectory({ nodes: [] })!.levels, LEVELS);
});

test('the Directory API\'s own can_create_top and documents_total are kept when it says them, and the flat list says neither', () => {
  const node = (id: number, parent: number | null, docs: number, total?: number) => ({ id, parent_id: parent, name: `U${id}`, level: parent ? 2 : 1, head: null, is_active: true, counts: { documents: docs, members: 0, children: 0, ...(total === undefined ? {} : { documents_total: total }) }, can_manage: false });
  const d = fromDirectory({ levels: LEVELS, can_create_top: true, nodes: [node(1, null, 2, 9), node(2, 1, 4)] })!;
  assert.equal(d.canCreateTop, true);
  assert.equal(fromDirectory({ nodes: [node(1, null, 2)], can_create_top: false })!.canCreateTop, false);
  assert.equal(fromDirectory({ nodes: [node(1, null, 2)] })!.canCreateTop, undefined, 'not said: the caller uses the global right');
  assert.equal(fromDirectory({ nodes: [node(1, null, 2)], can_create_top: 'yes' })!.canCreateTop, undefined);
  assert.equal(d.nodes[0].counts.documentsTotal, 9);
  assert.equal(d.nodes[1].counts.documentsTotal, undefined);
  const tree = buildTree(d.nodes);
  assert.equal(tree.documentsTotal(1), 9, 'the server\'s total wins where it gives one');
  assert.equal(tree.documentsTotal(2), 4, 'else the unit with what is under it, summed');
  assert.equal(fromDirectory({ nodes: [node(1, null, 2, 0)] })!.nodes[0].counts.documentsTotal, 0, 'a total of 0 is a total');
  assert.equal(dir().canCreateTop, undefined);
});

test('the tree: top units A-Z, children A-Z, paths, subtrees and the documents of a unit with everything under it', () => {
  const tree = buildTree(dir().nodes);
  assert.deepEqual(tree.childrenOf(null).map((n) => n.name), ['Finance', 'Human Resources', 'Information Security', 'Legal', 'Operations']);
  assert.deepEqual(tree.childrenOf(1).map((n) => n.name), ['Support']);
  assert.deepEqual(tree.path(5).map((n) => n.name), ['Information Security', 'SOC Operations']);
  assert.deepEqual(tree.path(null), []);
  assert.equal(tree.parentOf(5), 4);
  assert.equal(tree.parentOf(4), null);
  assert.deepEqual(Array.from(tree.subtree(4)).sort(), [4, 5]);
  assert.equal(tree.documentsTotal(4), 15);
  assert.equal(tree.documentsTotal(1), 9);
  assert.equal(tree.documentsTotal(null), 8 + 7 + 11 + 5 + 4 + 4 + 6);
  assert.equal(tree.height(4), 1);
  assert.equal(tree.node(404), undefined);
});

test('actions of a unit the person manages: New names the next level, Move, Deactivate; Access and Approvals only when their tab exists', () => {
  const tree = buildTree(dir().nodes);
  const a = (id: number | null, c = ctx) => Object.fromEntries(unitActions(tree, id, c).map((x) => [x.key, x]));
  const ops = a(1);
  assert.equal(ops.new.label, 'New Sub-department');
  assert.deepEqual([ops.new.hidden, ops.new.disabled], [false, false]);
  assert.equal(ops.edit.label, 'Edit details');
  assert.deepEqual([ops.properties.label, ops.properties.hidden, ops.properties.disabled], ['Properties', false, false], 'the popup is Properties');
  assert.deepEqual(unitActions(tree, 1, ctx).map((x) => x.key), ['new', 'properties', 'edit', 'move', 'toggle', 'access', 'approvals', 'exceptions']);
  assert.deepEqual([ops.move.hidden, ops.move.disabled], [false, false]);
  assert.equal(ops.toggle.label, 'Deactivate');
  assert.ok(ops.access.hidden && ops.approvals.hidden && ops.exceptions.hidden, 'no Access, Approvals or Exceptions tab yet');
  const later = a(1, { ...ctx, tabs: ['details', 'people', 'access', 'approvals', 'exceptions'] });
  assert.ok(!later.access.hidden && !later.approvals.hidden && !later.exceptions.hidden);
  assert.equal(later.access.label, 'Access');
  assert.equal(later.exceptions.label, 'Exceptions');
});

test('actions: a switched-off unit holds nothing new and is activated, not deactivated', () => {
  const tree = buildTree(dir().nodes);
  const support = Object.fromEntries(unitActions(tree, 2, ctx).map((x) => [x.key, x]));
  assert.equal(support.new.disabled, true);
  assert.equal(support.new.reason, 'Switched off: activate it first');
  assert.equal(support.toggle.label, 'Activate');
  assert.equal(support.toggle.disabled, false);
  assert.equal(Object.fromEntries(unitActions(tree, 1, ctx).map((x) => [x.key, x])).toggle.label, 'Deactivate');
});

test('actions: nothing can be added under the deepest level, and the reason says so', () => {
  const three = fromList([{ id: 1, name: 'A', is_active: true }, { id: 2, name: 'B', parent_department_id: 1, is_active: true }, { id: 3, name: 'C', parent_department_id: 2, is_active: true }], true);
  const tree = buildTree(three.nodes);
  const c = Object.fromEntries(unitActions(tree, 3, ctx).map((x) => [x.key, x]));
  assert.equal(c.new.disabled, true);
  assert.equal(c.new.reason, 'Units go 3 levels deep');
  assert.equal(c.new.label, 'New Unit', 'still named by the deepest level');
});

test('actions for a person who manages nothing: only Properties is offered, and the page is view only', () => {
  const nodes = dir(false).nodes;
  const tree = buildTree(nodes);
  const ops = Object.fromEntries(unitActions(tree, 1, { ...ctx, canTop: false }).map((x) => [x.key, x]));
  assert.deepEqual([ops.properties.label, ops.properties.hidden], ['Properties', false], 'a reader opens Properties (read-only)');
  assert.ok(ops.new.hidden && ops.edit.hidden && ops.move.hidden && ops.toggle.hidden);
  assert.equal(viewOnly(nodes, false), true);
  assert.equal(viewOnly(nodes, true), false, 'the global right alone is not view only');
  assert.equal(viewOnly(dir(true).nodes, false), false);
  const one = nodes.map((n) => (n.id === 2 ? { ...n, can_manage: true } : n));
  assert.equal(viewOnly(one, false), false, 'managing one unit is enough to have something to do');
});

test('actions per unit follow can_manage per unit (the Directory API), and the organisation\'s New needs the global right', () => {
  const nodes = dir(false).nodes.map((n) => (n.id === 4 ? { ...n, can_manage: true } : n));
  const tree = buildTree(nodes);
  const is = Object.fromEntries(unitActions(tree, 4, { ...ctx, canTop: false }).map((x) => [x.key, x]));
  assert.ok(!is.new.hidden && !is.move.hidden && !is.toggle.hidden);
  const soc = Object.fromEntries(unitActions(tree, 5, { ...ctx, canTop: false }).map((x) => [x.key, x]));
  assert.ok(soc.new.hidden, 'not managed: its parent being managed does not give it');
  assert.equal(unitActions(tree, null, { ...ctx, canTop: false }).find((x) => x.key === 'new')!.hidden, true);
  const root = unitActions(tree, null, ctx);
  assert.equal(root.find((x) => x.key === 'new')!.label, 'New Department');
  assert.equal(root.find((x) => x.key === 'new')!.hidden, false);
  assert.ok(root.filter((x) => x.key !== 'new').every((x) => x.hidden));
  assert.ok(unitActions(tree, 404, ctx).every((x) => x.hidden), 'a unit that is not in the tree has no actions');
});

test('Move lists the places allowed (not itself, not under itself, not too deep, not switched off), the top where the person may add departments, and the unit\'s own place', () => {
  const tree = buildTree(dir().nodes);
  const names = (items: { label: string }[]) => items.map((i) => i.label);
  // SOC Operations (under Information Security): the five other departments are places, and the top; Support is switched off, itself is excluded
  assert.deepEqual(names(moveChoices(tree, 5, ctx)), [`${ORGANISATION} (top level)`, 'Finance', 'Human Resources', 'Information Security', 'Legal', 'Operations']);
  // Information Security has a unit under it: it cannot go under another department's unit (that would be four deep), nor under its own
  assert.deepEqual(names(moveChoices(tree, 4, ctx)), [`${ORGANISATION} (top level)`, 'Finance', 'Human Resources', 'Legal', 'Operations']);
  assert.deepEqual(names(moveChoices(tree, 4, { ...ctx, canTop: false })), [`${ORGANISATION} (top level)`, 'Finance', 'Human Resources', 'Legal', 'Operations'], 'a top department is at the top now: that place stays listed');
  assert.deepEqual(names(moveChoices(tree, 5, { ...ctx, canTop: false })), ['Finance', 'Human Resources', 'Information Security', 'Legal', 'Operations'], 'without the right to add departments, the top is not offered to a unit that is under one');
  assert.equal(moveChoices(tree, 5, ctx)[0].value, '', 'the top is the empty value: no parent');
  // a place the person does not manage is not offered, unless it is where the unit is now
  const part = buildTree(dir(false).nodes.map((n) => (n.id === 3 || n.id === 5 ? { ...n, can_manage: true } : n)));
  assert.deepEqual(names(moveChoices(part, 5, { ...ctx, canTop: false })), ['Finance', 'Information Security'], 'Finance (managed) and its present place');
});

test('Move says nowhere to go when the unit\'s own place is the only one', () => {
  const only = fromList([{ id: 1, name: 'Solo', is_active: true }], true);
  const tree = buildTree(only.nodes);
  const m = unitActions(tree, 1, { ...ctx, canTop: false }).find((x) => x.key === 'move')!;
  assert.deepEqual([m.disabled, m.reason], [true, 'Nowhere else it can go']);
  assert.ok(!unitActions(buildTree(dir().nodes), 3, ctx).find((x) => x.key === 'move')!.disabled);
});

test('New lists the places a unit can be added under, started on the unit it is opened under', () => {
  const tree = buildTree(dir().nodes);
  const items = newPlaceChoices(tree, 1, ctx);
  assert.deepEqual(items.map((i) => i.label), [`${ORGANISATION} (top level)`, 'Finance', 'Human Resources', 'Information Security', 'Information Security › SOC Operations', 'Legal', 'Operations']);
  assert.ok(!items.some((i) => i.label.includes('Support')), 'a switched-off unit holds nothing new');
  assert.equal(items.find((i) => i.label === 'Operations')!.subLabel, 'Department');
  assert.equal(newPlaceChoices(tree, null, { ...ctx, canTop: false })[0].value, '', 'opened at the top, the top is shown even without the right (it is where the dialog starts)');
});

test('the words and addresses: counts, the library link, and a unit named by the address', () => {
  assert.equal(countText(1, 'document'), '1 document');
  assert.equal(countText(0, 'person', 'people'), '0 people');
  assert.equal(countText(5, 'unit'), '5 units');
  assert.equal(libraryHref(4), '/governance/documents?view=folders&dept=4');
  assert.equal(libraryHref(null), '/governance/documents?view=folders');
  const tree = buildTree(dir().nodes);
  assert.equal(unitFromAddress('4', tree), 4);
  assert.equal(unitFromAddress(' 4 ', tree), 4);
  for (const odd of ['', 'x', '4x', '-1', '999', '1.5', '0x4', '12345678901234']) assert.equal(unitFromAddress(odd, tree), null, odd);
});

test('defaults badges are drawn only for what a unit defines itself; unknown is not "none"', () => {
  assert.deepEqual(badgesOf({}), []);
  assert.deepEqual(badgesOf({ defaults: {} }), []);
  assert.deepEqual(badgesOf({ defaults: { doc_approval: true, doc_review: true, exc_implementer: false } }), ['Reviewers', 'Approvers']);
});

test('the popup lists the registered tabs that are enabled, in registry order; an address naming another tab opens the first', () => {
  const registry = [{ id: 'details' }, { id: 'people' }, { id: 'access' }, { id: 'approvals' }, { id: 'exceptions' }];
  const shown = shownTabs(registry, ['people', 'details']);
  assert.deepEqual(shown.map((t) => t.id), ['details', 'people']);
  assert.deepEqual(shownTabs(registry, ['access', 'nowhere']).map((t) => t.id), ['access'], 'an id nobody registered is not a tab');
  assert.deepEqual(shownTabs(registry, []), []);
  assert.equal(tabOr('people', shown), 'people');
  assert.equal(tabOr('access', shown), 'details', 'not enabled: the first tab');
  assert.equal(tabOr('', shown), 'details');
  assert.equal(tabOr('x', []), 'details');
});

test('the organisation as a popup subject: a stand-in node that is no unit, the "org" the defaults API and the address call it, and who may change it', () => {
  const org = organisationNode(true);
  assert.equal(org.id, ORG_NODE_ID);
  assert.ok(!LIST.some((u) => u.id === ORG_NODE_ID), 'no unit has that id');
  assert.equal(org.name, ORGANISATION);
  assert.equal(org.can_manage, true);
  assert.equal(organisationNode(false).can_manage, false, 'a reader of the defaults gets the popup read-only');
  assert.equal(defaultsParam(org), ORG_PARAM);
  assert.equal(defaultsParam({ id: 7 }), 7, 'a unit is asked by its number');
  assert.equal(ORG_PARAM, 'org');
  assert.deepEqual(['org', ' ORG ', 'Org'].map(isOrgAddress), [true, true, true]);
  assert.deepEqual(['', '7', 'organisation', 'orgs'].map(isOrgAddress), [false, false, false, false]);
  const tree = buildTree(dir(true).nodes);
  assert.equal(unitFromAddress('org', tree), null, 'the address ?open=org is not a unit');
});
