// node --test "src/app/(dashboard)/control-library/_library/domainModel.test.ts"
// A control domain of the Library: what is on screen for a built view of some frameworks, and the figures that follow it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { artifactDocument, artifactFileName, frameworkChoices, membersOfPicked, scopeSet, searchFw, searchSets, searchStandalone, setFrameworks, viewOf, type Rich, type SetT } from './domainModel.ts';

const set = (id: string, title: string, fws: string[], over: Partial<SetT> = {}): SetT => ({
  set_id: id, normalized_title: title, member_count: fws.length, frameworks: fws,
  members: fws.map((f, i) => ({ framework: f, control_id: `${id}.${i}`, original_title: `${title} in ${f}` })),
  normalized_evidence: [{ name: 'Policy', sources: ['ISO/IEC 27001 A.5'] }, { name: 'Log', sources: ['PCI DSS 10.2'] }, { name: 'Any' }], normalized_artifacts: [{ name: 'Standard', sources: ['PCI DSS 1.1'] }], ...over,
});

const rich: Rich = {
  domain: 'Identity', controls_in: 6, frameworks: ['ISO/IEC 27001', 'PCI DSS 4', 'SOC 2'], framework_count: 3,
  absent_frameworks: [{ name: 'HIPAA', reason: '' }, { name: 'SOC 2', reason: '' }],
  framework_catalog_artifacts: [], normalized_sets: 2, standalone: 2,
  sets: [set('a', 'MFA', ['ISO/IEC 27001', 'PCI DSS 4']), set('b', 'Access review', ['PCI DSS 4', 'SOC 2'])],
  standalone_controls: [set('c', 'Badges', ['SOC 2']), set('d', 'Passwords', ['ISO/IEC 27001'])],
};

test('the framework choices: the ones with controls here, and apart the ones with none', () => {
  assert.deepEqual(frameworkChoices(rich), { all: ['ISO 27001', 'PCI DSS', 'SOC 2'], absent: ['HIPAA'] });
});

test('with no view, everything is shown and the figures are the domain\'s own', () => {
  const v = viewOf(rich, []);
  assert.equal(v.filterOn, false);
  assert.deepEqual([v.sets.length, v.standalone.length, v.byFw.length], [2, 2, 3]);
  assert.deepEqual(v.stats, { controls: 6, frameworks: 3, sets: 2, standalone: 2, evidence: 6, artifacts: 4 });
  assert.deepEqual(v.bannerFrameworks, rich.frameworks);
});

test('a view keeps the sets that involve a picked framework, with all their members, and scopes evidence and artifacts to the picked frameworks', () => {
  const v = viewOf(rich, ['ISO 27001']);
  assert.equal(v.filterOn, true);
  assert.deepEqual(v.sets.map((s) => s.set_id), ['a']);
  assert.equal(v.sets[0].members.length, 2, 'the cross-framework mapping stays whole');
  assert.deepEqual(v.sets[0].normalized_evidence.map((e) => e.name), ['Policy', 'Any'], 'evidence of an unpicked framework is hidden, evidence from none in particular stays');
  assert.deepEqual(v.sets[0].normalized_artifacts, [], 'an artifact of an unpicked framework is hidden');
  assert.deepEqual(v.standalone.map((s) => s.set_id), ['d']);
  assert.deepEqual(v.byFw.map(([f]) => f), ['ISO 27001']);
  // the standalone controls of a picked framework are shown as they are: only a set's evidence and artifacts are scoped (as the page always did)
  assert.deepEqual(v.stats, { controls: 2, frameworks: 1, sets: 1, standalone: 1, evidence: 5, artifacts: 1 });
  assert.deepEqual(v.bannerFrameworks, ['ISO/IEC 27001']);
});

test('controls of a view count the members that belong to the picked frameworks', () => {
  assert.equal(membersOfPicked(rich.sets[0], ['ISO 27001']), 1);
  assert.equal(membersOfPicked(rich.sets[0], []), 2);
  assert.deepEqual(scopeSet(rich.sets[0], []), rich.sets[0]);
});

test('by framework: each framework\'s controls, in a set or alone, the biggest first', () => {
  const v = viewOf(rich, []);
  assert.deepEqual(v.byFw.map(([f, list]) => [f, list.length]), [['ISO 27001', 2], ['PCI DSS', 2], ['SOC 2', 2]], 'a tie keeps the order first seen');
  assert.deepEqual(v.byFw[0][1].map((c) => c.set), ['MFA', null]);
  assert.deepEqual(v.byFw[1][1].map((c) => c.set), ['MFA', 'Access review']);
  assert.equal(v.standaloneByFw.length, 2);
});

test('searches look in titles, codes and framework names, and ignore case', () => {
  assert.deepEqual(searchSets(rich.sets, 'MFA').map((s) => s.set_id), ['a']);
  assert.deepEqual(searchSets(rich.sets, 'soc').map((s) => s.set_id), ['b']);
  assert.equal(searchSets(rich.sets, '  ').length, 2);
  assert.deepEqual(searchStandalone(rich.standalone_controls, 'badges').map((s) => s.set_id), ['c']);
  assert.deepEqual(searchStandalone(rich.standalone_controls, 'd.0').map((s) => s.set_id), ['d']);
  assert.equal(searchFw(viewOf(rich, []).byFw[1][1], 'access').length, 1);
});

test('the frameworks of a set are short and distinct, the picked first under a view', () => {
  assert.deepEqual(setFrameworks(rich.sets[1], []), ['PCI DSS', 'SOC 2']);
  assert.deepEqual(setFrameworks(rich.sets[1], ['SOC 2']), ['SOC 2', 'PCI DSS']);
});

test('an artifact becomes a blank starter document, escaped', () => {
  const html = artifactDocument({ name: 'Policy <A&B>', type: 'Policy', sources: ['ISO 27001'] }, 'Identity');
  assert.match(html, /Policy &lt;A&amp;B&gt;/);
  assert.match(html, /<b>Domain:<\/b> Identity/);
  assert.match(html, /<b>Maps to:<\/b> ISO 27001/);
  assert.equal(artifactFileName({ name: 'Access policy (v2)' }), 'Access_policy_v2_.doc');
});
