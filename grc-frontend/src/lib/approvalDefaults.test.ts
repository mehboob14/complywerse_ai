// node --test "src/lib/approvalDefaults.test.ts"
// The approval defaults apart from the screen: how the server's answers are read (a row, a route's stages, the answer for a unit, what a form asks to resolve), the words
// (a person, a source, what a document follows), what the pickers offer, what an editor starts with and sends, what it checks first, and how a LOCKED default keeps its people in
// a document's sign-off ("Submit for review") and starts an exception's implementer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NOBODY, SUBJECTS, bodyOf, draftOf, draftProblem, followsWords, fromWords, implementerKeys, implementerNote, isOwner, keepLocked, keysOfPeople, lockedNeeds, sameKeys, parseAnswer,
  parseNote, parseResolved, parseRow, peopleBody, peopleLine, personWords, pickKey, pickOptions, requiredIn, resolvedWho, routeLine, sameDraft, sourceName, stagesFromRoute,
  type DefaultRow, type Resolved, type Targets,
} from './approvalDefaults.ts';
import { blankStage } from './approvalRoutes.ts';

const person = (type: string, id: number | null, label: string, extra: Record<string, unknown> = {}) => ({ type, id, label, ...extra });
const row = (over: Record<string, unknown> = {}) => ({ id: 1, department_id: 5, subject: 'doc_review', people: [person('user', 7, 'Rana')], route: null, locked: false, is_active: true, updated_at: '2026-11-11T08:00:00', ...over });
const stage = (over: Record<string, unknown> = {}) => ({
  position: 1, name: 'Review', kind: 'review', order: 'together', rule: 'all', min_count: null, due_days: null, signature: true, allow_reject: true, allow_delegate: true,
  people: [{ target_type: 'user', target_id: 7, label: 'Rana' }], ...over,
});
const parsed = (raw: unknown): DefaultRow => parseRow(raw) as DefaultRow;

test('a row is read as the server sends it; one that is not a row is nothing', () => {
  const r = parsed(row({ locked: true, people: [person('user', 7, 'Rana'), person('unit_owner', null, 'Owner of the unit', { holder: 'Sam' }), person('role', 3, 'A role that was removed', { gone: true })] }));
  assert.equal(r.id, 1);
  assert.equal(r.department_id, 5);
  assert.equal(r.locked, true);
  assert.deepEqual(r.people.map((p) => [p.type, p.id, p.holder, p.gone]), [['user', 7, null, false], ['unit_owner', null, 'Sam', false], ['role', 3, null, true]]);
  assert.equal(parseRow(null), null);
  assert.equal(parseRow({ id: 1, subject: 'nonsense', people: [] }), null);
  assert.equal(parseRow({ subject: 'doc_review', people: [] }), null, 'no id');
  assert.equal(parsed(row({ department_id: null })).department_id, null, 'the organisation');
  assert.equal(parsed(row({ is_active: false })).is_active, false);
  assert.deepEqual(parsed(row({ people: [{ type: 'alien', id: 1, label: 'x' }, person('user', 1, 'Ok')] })).people.map((p) => p.label), ['Ok'], 'a kind the server does not have is dropped');
});

test('a route is read stage by stage, with its people by name; a kind, order or rule that is unknown is the plain one', () => {
  const r = parsed(row({ subject: 'doc_route', people: [], route: [stage(), stage({ position: 2, name: 'Approval', kind: 'approval', order: 'in_turn', rule: 'at_least', min_count: 2, due_days: 5, people: [{ target_type: 'unit_owner', label: 'Owner of the unit', holder: 'Sam' }] }), stage({ kind: 'weird', order: 'x', rule: 'y' })] }));
  assert.equal(r.route?.length, 3);
  assert.deepEqual(r.route?.[1].people.map((p) => [p.target_type, p.target_id, p.holder]), [['unit_owner', null, 'Sam']]);
  assert.deepEqual([r.route?.[2].kind, r.route?.[2].order, r.route?.[2].rule], ['review', 'together', 'all']);
  assert.equal(r.route?.[1].due_days, 5);
  assert.equal(parsed(row({ route: [] })).route, null, 'an empty route is no route');
});

test('the answer for a unit: every subject is there, and nothing set is nothing, never an error', () => {
  const a = parseAnswer({
    department_id: 5, department_name: 'Operations', document: 'people', can_edit: true,
    subjects: { doc_review: { own: row(), effective: row(), source: { department_id: 5, name: 'Operations', inherited: false }, locked_above: false }, exc_implementer: { own: null, effective: null, source: null, locked_above: false } },
  });
  assert.ok(a);
  assert.deepEqual(Object.keys(a.subjects), [...SUBJECTS]);
  assert.equal(a.subjects.doc_review.own?.people[0].label, 'Rana');
  assert.equal(a.subjects.doc_route.effective, null, 'a subject the answer left out is not set');
  assert.equal(a.can_edit, true);
  assert.equal(a.document, 'people');
  assert.equal(parseAnswer({ department_id: null, subjects: {}, document: 'something' })?.document, null);
  assert.equal(parseAnswer({ department_id: null, subjects: {} })?.can_edit, false, 'no "can_edit" is no right');
  assert.equal(parseAnswer('<html>'), null);
  assert.equal(parseAnswer({ nodes: [] }), null, 'something that is not an answer');
});

test('what a form asks to resolve is read for one subject or for all', () => {
  const src = { department_id: 5, name: 'Operations', inherited: true };
  const one = parseResolved({ department_id: 5, subject: 'exc_implementer', effective: row({ subject: 'exc_implementer' }), source: src, document: 'route' }) as Resolved;
  assert.equal(one.subjects.exc_implementer?.effective?.people[0].label, 'Rana');
  assert.equal(one.subjects.exc_implementer?.source?.inherited, true);
  const all = parseResolved({ department_id: null, subjects: { doc_review: { effective: row(), source: src }, doc_route: { effective: null, source: null } }, document: 'people' }) as Resolved;
  assert.deepEqual(Object.keys(all.subjects), ['doc_review', 'doc_approval', 'doc_route', 'exc_implementer'].filter((s) => s === 'doc_review' || s === 'doc_route'));
  assert.equal(all.document, 'people');
  assert.equal(parseResolved(null), null);
});

test('the words: a person, the organisation, a source, what a document follows, a route as a sentence', () => {
  assert.equal(personWords({ type: 'user', label: 'Rana' }), 'Rana');
  assert.equal(personWords({ type: 'role', label: 'Approvers' }), 'Role: Approvers');
  assert.equal(personWords({ type: 'team', label: 'Support' }), 'Department: Support');
  assert.equal(personWords({ type: 'unit_owner', label: 'x' }), 'Owner of the unit');
  assert.equal(personWords({ type: 'parent_owner', label: 'x', holder: 'Sam Lee' }), 'Owner of the unit above (Sam Lee)');
  assert.equal(sourceName({ department_id: null, name: 'The organisation' }), 'the organisation');
  assert.equal(sourceName({ department_id: 5, name: 'Operations' }), 'Operations');
  assert.equal(peopleLine([person('user', 1, 'A'), person('user', 2, 'B'), person('role', 3, 'C')], 2), 'A, B +1');
  assert.equal(peopleLine([]), '');
  assert.equal(followsWords('route'), 'The custom route');
  assert.equal(followsWords('people'), 'Reviewers, then approvers');
  assert.equal(followsWords(null), 'Whoever its author names');
  assert.ok(isOwner('unit_owner') && isOwner('parent_owner') && !isOwner('user'));
  const route = parsed(row({ subject: 'doc_route', people: [], route: [stage({ people: [{ target_type: 'user', target_id: 7, label: 'Rana' }] }), stage({ position: 2, kind: 'approval', name: 'Approval', people: [{ target_type: 'role', target_id: 3, label: 'Approvers' }, { target_type: 'unit_owner', label: 'Owner of the unit' }], rule: 'any' })] })).route ?? [];
  assert.equal(routeLine(route), 'Rana reviews; then any one of Role: Approvers or Owner of the unit approves.');
});

test('the pickers: owners first, then people, roles and (where allowed) departments; nobody that left is lost; an owner has no id', () => {
  const targets: Targets = {
    users: [{ id: 2, name: 'Zed', email: 'z@x.test' }, { id: 1, name: 'Ana', email: null }],
    roles: [{ id: 3, name: 'Approvers', user_count: 2 }], teams: [{ id: 9, name: 'Support', member_count: 1 }],
    owners: [{ type: 'unit_owner', person: 'Sam Lee' }, { type: 'parent_owner', person: null }],
  };
  const all = pickOptions(targets, { teams: true });
  assert.deepEqual(all.map((o) => o.value), ['unit_owner:0', 'parent_owner:0', 'user:1', 'user:2', 'role:3', 'team:9']);
  assert.equal(all[0].description, 'Today: Sam Lee');
  assert.equal(all[1].description, 'The head of the unit above it');
  assert.equal(all.find((o) => o.value === 'role:3')?.label, 'Role: Approvers');
  assert.equal(all.find((o) => o.value === 'role:3')?.description, '2 people');
  assert.deepEqual(pickOptions(targets, { teams: false }).map((o) => o.value), ['unit_owner:0', 'parent_owner:0', 'user:1', 'user:2', 'role:3'], 'an implementer is no department');
  const kept = pickOptions(targets, { teams: false, keep: [{ type: 'user', id: 99, label: 'Someone who left' }, { type: 'user', id: 1, label: 'Ana' }] });
  assert.equal(kept[kept.length - 1].label, 'Someone who left');
  assert.equal(kept.filter((o) => o.value === 'user:1').length, 1, 'one already on offer is not listed twice');
  assert.equal(pickOptions(null, { teams: true }).length, 2, 'before the lists load: the two owners');
  assert.equal(pickKey('unit_owner', 5), 'unit_owner:0');
  assert.deepEqual(keysOfPeople([{ type: 'user', id: 4 }, { type: 'parent_owner', id: null }]), ['user:4', 'parent_owner:0']);
  assert.deepEqual(peopleBody(['user:4', 'parent_owner:0', 'user:4']), [{ type: 'user', id: 4 }, { type: 'parent_owner' }]);
});

test('an editor opens on the row and sends reviewers, approvers and the implementer as people, a route as stages', () => {
  const d = draftOf(parsed(row({ locked: true, people: [person('user', 7, 'Rana'), person('role', 3, 'Approvers')] })));
  assert.deepEqual(d.people, ['user:7', 'role:3']);
  assert.equal(d.locked, true);
  assert.deepEqual(bodyOf('doc_review', d), { people: [{ type: 'user', id: 7 }, { type: 'role', id: 3 }], locked: true, is_active: true });
  const blank = draftOf(null);
  assert.deepEqual([blank.people, blank.locked, blank.active, blank.stages.length], [[], false, true, 2], 'a new route starts with today\'s two stages');
  assert.equal(draftProblem('doc_review', blank), NOBODY.doc_review);
  assert.equal(draftProblem('doc_approval', blank), 'Choose at least one approver.');
  assert.equal(draftProblem('exc_implementer', blank), 'Choose who carries the exception out.');
  assert.equal(draftProblem('doc_review', d), '');
  assert.equal(draftProblem('doc_route', blank), 'A route needs at least one stage.');
  const withRoute = draftOf(parsed(row({ subject: 'doc_route', people: [], route: [stage({ order: 'in_turn', people: [{ target_type: 'user', target_id: 7, label: 'Rana' }, { target_type: 'user', target_id: 8, label: 'Raf' }], due_days: 3 })] })));
  assert.equal(draftProblem('doc_route', withRoute), '', 'a review stage with people is a route');
  const told = draftOf(parsed(row({ subject: 'doc_route', people: [], route: [stage({ kind: 'information', name: 'For information' })] })));
  assert.equal(draftProblem('doc_route', told), 'Add a stage where someone reviews or approves.', 'a route that only tells people is refused, in the servers words');
  const body = bodyOf('doc_route', withRoute);
  assert.deepEqual(body.people, []);
  assert.deepEqual(body.route, [{ name: 'Review', kind: 'review', order: 'in_turn', rule: 'all', min_count: null, due_days: 3, people: [{ target_type: 'user', target_id: 7 }, { target_type: 'user', target_id: 8 }] }]);
});

test('a route that is changed is a change; the same people in another order are not, except in a route where the order is the turn', () => {
  const a = draftOf(parsed(row({ people: [person('user', 7, 'Rana'), person('user', 8, 'Raf')] })));
  assert.ok(sameDraft('doc_review', a, { ...a, people: ['user:8', 'user:7'] }));
  assert.ok(!sameDraft('doc_review', a, { ...a, locked: true }));
  assert.ok(!sameDraft('doc_review', a, { ...a, active: false }));
  const r = draftOf(parsed(row({ subject: 'doc_route', people: [], route: [stage({ order: 'in_turn', people: [{ target_type: 'user', target_id: 7, label: 'Rana' }, { target_type: 'user', target_id: 8, label: 'Raf' }] })] })));
  const swapped = { ...r, stages: [{ ...r.stages[0], people: [...r.stages[0].people].reverse() }] };
  assert.ok(!sameDraft('doc_route', r, swapped), 'one after another: the order is the turn');
  assert.ok(sameDraft('doc_route', r, { ...r, stages: r.stages.map((s) => ({ ...s, key: `other-${s.key}` })) }), 'keys are only for React');
});

test('an owner in a route has no id, and a route comes back as the stages the dialog edits', () => {
  const stages = stagesFromRoute([{ position: 1, name: 'Review', kind: 'review', order: 'together', rule: 'all', min_count: null, due_days: null, people: [{ target_type: 'unit_owner', target_id: null, label: 'Owner of the unit', holder: 'Sam', gone: false }, { target_type: 'user', target_id: 7, label: 'Rana', holder: null, gone: false }] }]);
  assert.deepEqual(stages[0].people.map((p) => [p.target_type, p.target_id, p.display]), [['unit_owner', 0, 'Owner of the unit (Sam)'], ['user', 7, 'Rana']]);
  assert.equal(stagesFromRoute(null).length, 2);
  assert.equal(stagesFromRoute([]).length, 2);
});

const lockedPeople = (): Resolved => parseResolved({
  department_id: 5, document: 'people', subjects: {
    doc_review: { effective: row({ locked: true, people: [person('user', 7, 'Rana'), person('unit_owner', null, 'Owner of the unit')] }), source: { department_id: null, name: 'The organisation', inherited: true } },
    doc_approval: { effective: row({ id: 2, subject: 'doc_approval', locked: false, people: [person('role', 3, 'Approvers')] }), source: { department_id: 5, name: 'Operations', inherited: false } },
  },
}) as Resolved;

test('a lock keeps its people in: those the sign-off lacks go back into the first stage of their kind; unlocked defaults ask nothing', () => {
  const needs = lockedNeeds(lockedPeople());
  assert.deepEqual(needs.map((n) => [n.role, n.key, n.owner, n.source]), [['reviewer', 'user:7', false, 'the organisation'], ['reviewer', 'unit_owner:0', true, 'the organisation']], 'the approvers default is not locked');
  const review = { ...blankStage('review'), people: [] };
  const approval = { ...blankStage('approval'), people: [{ target_type: 'role', target_id: 3 }] };
  const kept = keepLocked([review, approval], needs);
  assert.deepEqual(kept[0].people.map((p) => [p.target_type, p.target_id]), [['user', 7]], 'put back; the owner is the server\'s to hold');
  assert.deepEqual(kept[1].people, approval.people, 'an approval stage is not touched by a reviewer\'s lock');
  assert.equal(keepLocked(kept, needs), kept, 'nothing missing: the same list');
  const second = { ...blankStage('review'), people: [{ target_type: 'user', target_id: 7 }] };
  assert.equal(keepLocked([review, second], needs)[0].people.length, 0, 'held by any stage of its kind');
  assert.deepEqual(requiredIn(kept[0], needs).map((n) => n.key), ['user:7']);
  assert.deepEqual(requiredIn(kept[1], needs), []);
  assert.equal(keepLocked([approval], needs)[0], approval, 'no stage of its kind: left to the server, which refuses in words');
  assert.deepEqual(lockedNeeds(null), []);
  assert.deepEqual(lockedNeeds({ document: null, subjects: {} }), []);
});

test('a locked route asks its approval stages\' people as approvers and every other stage\'s as reviewers', () => {
  const r = parseResolved({
    department_id: 5, document: 'route', subjects: { doc_route: { source: { department_id: 4, name: 'Finance', inherited: true }, effective: row({ id: 9, subject: 'doc_route', locked: true, people: [], route: [stage(), stage({ position: 2, kind: 'approval', name: 'Approval', people: [{ target_type: 'role', target_id: 3, label: 'Approvers' }] })] }) } },
  }) as Resolved;
  assert.deepEqual(lockedNeeds(r).map((n) => [n.role, n.key, n.source]), [['reviewer', 'user:7', 'Finance'], ['approver', 'role:3', 'Finance']]);
});

test('what a document would get, in words, for the notice', () => {
  assert.equal(resolvedWho(lockedPeople()), 'Reviewers: Rana, Owner of the unit. Approvers: Role: Approvers.');
  assert.equal(resolvedWho(null), '');
  assert.equal(resolvedWho({ document: null, subjects: {} }), '');
  const note = parseNote({ subject: 'doc_people', subjects: ['doc_review', 'doc_approval'], source: { department_id: 5, name: 'Operations', inherited: false }, sources: ['Operations', 'The organisation'] });
  assert.equal(fromWords(note!), 'Defaults from Operations and the organisation');
  assert.equal(fromWords({ source: { department_id: null, name: 'The organisation', inherited: true }, sources: [] }), 'Defaults from the organisation');
  assert.equal(parseNote(null), null);
});

test('an exception starts with its unit\'s implementer: people, roles and owners that still exist, in the keys the form holds', () => {
  const r = parsed(row({ subject: 'exc_implementer', people: [person('user', 7, 'Rana'), person('role', 3, 'Implementers'), person('unit_owner', null, 'Owner of the unit'), person('team', 4, 'Support'), person('user', 8, 'Someone who left', { gone: true })] }));
  assert.deepEqual(implementerKeys(r), ['user:7', 'role:3', 'unit_owner']);
  assert.deepEqual(implementerKeys(null), []);
  assert.equal(implementerNote({ department_id: 5, name: 'Operations', inherited: true }, false), 'Default from Operations. You may change it.');
  assert.equal(implementerNote({ department_id: null, name: 'The organisation', inherited: true }, true), 'Default from the organisation. It is locked: they stay among the implementers.');
  assert.equal(implementerNote(null, false), '');
});

test('two lists of people are the same whatever their order', () => {
  assert.ok(sameKeys(['user:1', 'role:2'], ['role:2', 'user:1']));
  assert.ok(!sameKeys(['user:1'], ['user:1', 'role:2']));
  assert.ok(sameKeys([], []));
});

test('the shared model stays pure: no React, no @/ import, no model or vendor name', () => {
  const src = readFileSync(new URL('./approvalDefaults.ts', import.meta.url), 'utf8');
  assert.ok(!/from 'react'|from '@\//.test(src));
  assert.ok(!/\b(gpt|openai|anthropic|claude)\b/i.test(src.replace(/\/\/.*$/gm, '')));
});
