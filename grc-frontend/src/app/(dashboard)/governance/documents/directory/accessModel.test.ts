// node --test "src/app/(dashboard)/governance/documents/directory/accessModel.test.ts"
// The Access tab's rules: what the server's answer becomes, the words of a level and of where it comes from, why a person is listed, what Remove does, what the picker lists,
// and the body and the confirmation of each write.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCESS_NOTE, GRANT_LEVELS, LEVEL_NOTE, addBody, canOverride, fromAccess, fromPrincipals, givenText, grantWord, grantedText, howWords, levelBody, levelPill, levelWord, overrideBody,
  peopleSummary, personPill, pickItems, removeSteps, removedText, takenOffText, whereText, type Grant, type LevelFrom,
} from './accessModel.ts';

// what `GET /admin/departments/{Helpdesk}/access` answers for the scratch units Operations > Support > Helpdesk (the backend's own test names)
const ANSWER = {
  department: { id: 4, name: 'Helpdesk' },
  people: [
    { user_id: 5, name: 'Sam Other', email: 'sam@x.test', how: ['grant'], via: ['Unit readers'], level: 'edit', level_from: { department_id: 4, name: 'Helpdesk', inherited: false, principal_type: 'role', principal_label: 'Unit readers' }, grant_id: null, can_remove: false, remove_blocked: 'Sam Other has access through the role Unit readers.' },
    { user_id: 6, name: 'Olivia Owner', email: 'olivia@x.test', how: ['grant'], via: [], level: 'edit', level_from: { department_id: 3, name: 'Support', inherited: true, principal_type: 'user', principal_label: 'Olivia Owner' }, grant_id: null, can_remove: false, remove_blocked: 'Olivia Owner has access inherited from a unit above; change it there, or block it here.' },
    { user_id: 7, name: 'Otto Okta', email: null, how: ['head'], via: ['Operations'], level: 'view', level_from: { department_id: 1, name: 'Operations', inherited: true, principal_type: 'owner', principal_label: 'Owner' }, can_remove: false, remove_blocked: 'Otto Okta owns Operations, above this unit.' },
    { user_id: 8, name: 'Pat Publisher', email: 'pat@x.test', how: ['manual', 'grant'], via: [], level: 'view', level_from: { department_id: 4, name: 'Helpdesk', inherited: false, principal_type: 'user', principal_label: 'Pat Publisher' }, grant_id: 12, can_remove: true, remove_blocked: null, remains: null },
    { user_id: 9, name: 'Mia Member', email: 'mia@x.test', how: ['manual'], via: [], level: 'none', level_from: null, can_remove: true, remove_blocked: null },
  ],
  grants: [
    { id: 11, principal_type: 'role', principal_id: 20, principal_label: 'Unit readers', level: 'edit' },
    { id: 12, principal_type: 'user', principal_id: 8, principal_label: 'Pat Publisher', level: 'view' },
    { id: 13, principal_type: 'user', principal_id: 3, principal_label: 'Anna Author', level: 'none' },
  ],
  inherited_grants: [
    { from_department_id: 1, from_name: 'Operations', principal_type: 'role', principal_id: 20, principal_label: 'Unit readers', level: 'view', overridden: true },
    { from_department_id: 3, from_name: 'Support', principal_type: 'user', principal_id: 6, principal_label: 'Olivia Owner', level: 'edit', overridden: false },
  ],
};

test('the answer becomes people, the unit\'s own grants and the inherited ones; a field a backend leaves out reads as nothing, never as a level', () => {
  const a = fromAccess(ANSWER)!;
  assert.equal(a.people.length, 5);
  assert.deepEqual(a.people.map((p) => p.name), ['Sam Other', 'Olivia Owner', 'Otto Okta', 'Pat Publisher', 'Mia Member'], 'the server\'s order is kept');
  assert.equal(a.people[2].email, null);
  assert.equal(a.people[4].remains, null);
  assert.deepEqual(a.grants.map((g) => [g.principal_label, g.level]), [['Unit readers', 'edit'], ['Pat Publisher', 'view'], ['Anna Author', 'none']]);
  assert.deepEqual(a.inherited.map((g) => [g.from_name, g.overridden]), [['Operations', true], ['Support', false]]);
  const bare = fromAccess({ people: [{ user_id: 1, name: 'Bare', how: ['manual', 'nonsense'], level: 'superuser' }] })!;
  assert.deepEqual(bare.people[0].how, ['manual'], 'an unknown way in is dropped');
  assert.equal(bare.people[0].level, 'none', 'an unknown level is no level');
  assert.equal(bare.people[0].level_from, null);
  assert.deepEqual([bare.grants, bare.inherited], [[], []]);
  for (const bad of [null, 'x', [], {}, { people: 'x' }, { people: [null] }, { people: [{ name: 'no id' }] }, { people: [], grants: [{ id: 'x' }] }, { people: [], inherited_grants: [{ from_department_id: 1, principal_type: 'team', principal_id: 1 }] }]) {
    assert.equal(fromAccess(bad), null, JSON.stringify(bad));
  }
});

test('the four levels have a word and a tone each; a person with no level of their own is a member only, not "no access"', () => {
  assert.deepEqual(['none', 'view', 'edit', 'manage'].map((l) => levelWord(l as never)), ['Blocked', 'View', 'Edit', 'Manage']);
  assert.equal(new Set(['none', 'view', 'edit', 'manage'].map((l) => levelPill(l as never).tone)).size, 4, 'four tones: the word is never the only thing, nor the colour');
  assert.deepEqual(levelPill('none'), { tone: 'danger', label: 'Blocked' });
  assert.deepEqual(personPill({ level: 'none', level_from: null }), { tone: 'neutral', label: 'Member only' });
  assert.deepEqual(personPill({ level: 'none', level_from: { department_id: 1, name: 'Operations', inherited: true, principal_type: 'user', principal_label: 'Ann' } }), { tone: 'danger', label: 'Blocked' });
  assert.deepEqual(personPill({ level: 'edit', level_from: null }), { tone: 'progress', label: 'Edit' });
  assert.deepEqual(GRANT_LEVELS.map((l) => l.value), ['view', 'edit', 'manage'], 'a block is its own action, not a level to give');
  assert.equal(grantWord({ level: 'none' }), 'Blocked here');
  assert.equal(grantWord({ level: 'manage' }), 'Manage');
});

test('where a level comes from is said in words: granted here, inherited from a unit, blocked here or from a unit, the owner\'s seat, and the role that gave it', () => {
  const from = (over: Partial<LevelFrom>): LevelFrom => ({ department_id: 1, name: 'Operations', inherited: false, principal_type: 'user', principal_label: 'Pat', ...over });
  assert.equal(whereText(null, 'none'), null);
  assert.equal(whereText(from({}), 'edit'), 'Granted here');
  assert.equal(whereText(from({ inherited: true }), 'edit'), 'Inherited from Operations');
  assert.equal(whereText(from({}), 'none'), 'Blocked here');
  assert.equal(whereText(from({ inherited: true }), 'none'), 'Blocked from Operations');
  assert.equal(whereText(from({ principal_type: 'role', principal_label: 'Unit readers' }), 'view'), 'Granted here · role Unit readers');
  assert.equal(whereText(from({ principal_type: 'role', principal_label: 'Unit readers', inherited: true }), 'view'), 'Inherited from Operations · role Unit readers');
  assert.equal(whereText(from({ principal_type: 'owner' }), 'view'), 'Owner of this unit');
  assert.equal(whereText(from({ principal_type: 'owner', inherited: true }), 'view'), 'Owner of Operations');
  const a = fromAccess(ANSWER)!;
  assert.deepEqual(a.people.map((p) => whereText(p.level_from, p.level)), ['Granted here · role Unit readers', 'Inherited from Support', 'Owner of Operations', 'Granted here', null]);
});

test('why a person is listed: the ways in as words, in the server\'s order; the summary counts those with a level', () => {
  const a = fromAccess(ANSWER)!;
  assert.deepEqual(howWords(a.people[3]).map((h) => h.label), ['Added by hand', 'Given access']);
  assert.deepEqual(howWords(a.people[2]).map((h) => h.label), ['Owner']);
  assert.deepEqual(howWords({ how: ['head', 'manual', 'role', 'grant'] }).map((h) => h.label), ['Owner', 'Added by hand', 'Through role', 'Given access']);
  assert.equal(peopleSummary(a.people), '5 people · 4 with a level');
  assert.equal(peopleSummary([{ level: 'none' }]), '1 person · 0 with a level');
});

test('Remove takes a person off the members added by hand and off the level given to them on this unit; a block of theirs is not access and stays', () => {
  const a = fromAccess(ANSWER)!;
  assert.deepEqual(removeSteps(a.people[3], a.grants), { member: true, grantId: 12 }, 'added by hand and given a level');
  assert.deepEqual(removeSteps(a.people[4], a.grants), { member: true, grantId: null }, 'a member only');
  const blocked: Grant[] = [{ id: 30, principal_type: 'user', principal_id: 9, principal_label: 'Mia Member', level: 'none' }];
  assert.deepEqual(removeSteps(a.people[4], blocked), { member: true, grantId: null }, 'her block stays: Lift block is its own button');
  assert.deepEqual(removeSteps({ user_id: 5, how: ['grant'] }, a.grants), { member: false, grantId: null }, 'a level through a role is the role\'s row, not hers');
  assert.deepEqual(removeSteps({ user_id: 8, how: ['grant'] }, [{ id: 40, principal_type: 'role', principal_id: 8, principal_label: 'A role with her number', level: 'edit' }]), { member: false, grantId: null }, 'a role is not a person');
});

test('the picker lists people first, then roles, each with a second line and what it already has on this unit', () => {
  const found = fromPrincipals({
    people: [{ id: 8, name: 'Pat Publisher', email: 'pat@x.test', designation: 'Publisher', granted: 'view' }, { id: 9, name: 'Mia Member', email: null, granted: null }, { id: 'x', name: 'bad row' }],
    roles: [{ id: 20, name: 'Unit readers', user_count: 3, granted: 'edit' }, { id: 21, name: 'Solo', user_count: 1 }, { id: 22, name: 'Blocked role', granted: 'none' }],
  });
  const items = pickItems(found);
  assert.deepEqual(items.map((i) => i.key), ['user:8', 'user:9', 'role:20', 'role:21', 'role:22'], 'a row without a number is dropped');
  assert.deepEqual(items.map((i) => i.sub), ['pat@x.test', '', '3 people', '1 person', '']);
  assert.deepEqual(items.map((i) => grantedText(i.granted)), ['Has View here', null, 'Has Edit here', null, 'Blocked here']);
  assert.deepEqual(fromPrincipals(null), { people: [], roles: [] });
  assert.deepEqual(fromPrincipals({ people: 'x' }), { people: [], roles: [] });
});

test('the writes: a new level, a change, an override and a block are all a PUT of the same shape; the words after each name who and what', () => {
  const [pat, readers] = pickItems(fromPrincipals({ people: [{ id: 8, name: 'Pat Publisher' }], roles: [{ id: 20, name: 'Unit readers' }] }));
  assert.deepEqual(addBody(pat, 'edit'), { principal_type: 'user', principal_id: 8, level: 'edit' });
  assert.deepEqual(addBody(readers, 'view'), { principal_type: 'role', principal_id: 20, level: 'view' });
  const a = fromAccess(ANSWER)!;
  assert.deepEqual(overrideBody(a.inherited[1], 'none'), { principal_type: 'user', principal_id: 6, level: 'none' }, 'Block here');
  assert.deepEqual(overrideBody(a.inherited[1], 'view'), { principal_type: 'user', principal_id: 6, level: 'view' }, 'a nearer level for the same person');
  assert.deepEqual(levelBody(a.grants[0], 'manage'), { principal_type: 'role', principal_id: 20, level: 'manage' });
  assert.equal(givenText('Pat Publisher', 'edit', 'Helpdesk'), 'Pat Publisher can now edit Helpdesk');
  assert.equal(givenText('Pat Publisher', 'view', 'Helpdesk'), 'Pat Publisher can now view Helpdesk');
  assert.equal(givenText('Pat Publisher', 'manage', 'Helpdesk'), 'Pat Publisher can now manage Helpdesk');
  assert.equal(givenText('Anna Author', 'none', 'Helpdesk'), 'Anna Author is blocked on Helpdesk');
  assert.equal(removedText('Anna Author', 'none', 'Helpdesk'), 'The block on Anna Author is lifted');
  assert.equal(removedText('Pat Publisher', 'view', 'Helpdesk'), 'Pat Publisher no longer has a level given on Helpdesk');
  assert.equal(takenOffText('Pat Publisher', 'Helpdesk'), 'Pat Publisher removed from Helpdesk');
});

test('an inherited level can be overridden or blocked here only while a nearer one has not done it already', () => {
  const a = fromAccess(ANSWER)!;
  assert.deepEqual(a.inherited.map(canOverride), [false, true]);
});

test('the (i) notes say cascade, nearest wins and add-only in two sentences, and what the three levels allow; no id, no model, no vendor', () => {
  assert.equal(ACCESS_NOTE.split(/(?<=\.)\s/).length, 2);
  for (const word of ['every unit under it', 'nearest', 'overrides', 'Block here', 'only adds', 'never takes away']) assert.ok(ACCESS_NOTE.includes(word), word);
  for (const word of ['View', 'Edit', 'Manage']) assert.ok(LEVEL_NOTE.includes(word), word);
  assert.ok(!/\b(gpt|openai|anthropic|claude|id)\b/i.test(ACCESS_NOTE + LEVEL_NOTE));
});
