// node --test "src/lib/tabsModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countLabel, nextTab, panelId, reachableKeys, resolveTab, scrollDelta, tabId, withTab } from './tabsModel.ts';
import { VIEWS, viewOf } from '../app/(dashboard)/governance/documents/_view/docRoute.ts';

// ── a copy of docRoute.ts ALIASES: the legacy ?tab= names that still arrive from emails, tasks and bookmarks ──────────────────────────────
const ALIASES: Record<string, string> = {
  document: 'document', viewer: 'document',
  approvals: 'approvals', lifecycle: 'approvals', 'sign-off': 'approvals', 'review-history': 'approvals',
  discussion: 'discussion', comments: 'discussion', remarks: 'discussion',
  proposals: 'proposals', proposal: 'proposals', proposed: 'proposals', 'proposed-changes': 'proposals',
  statements: 'statements', mappings: 'mappings', controls: 'mappings',
  gaps: 'gaps', 'gap-analysis': 'gaps',
  versions: 'versions', chain: 'versions', 'change-log': 'versions', changelog: 'versions', log: 'versions', history: 'versions',
};
const KEYS = VIEWS.map((v) => v.key);
const resolve = (tab: string | null) => resolveTab(tab === null ? '' : `?tab=${encodeURIComponent(tab)}`, 'tab', KEYS, ALIASES, 'document');

// ── nextTab ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const K = ['a', 'b', 'c', 'd'];

test('ArrowRight and ArrowLeft step through the tabs and wrap at the ends', () => {
  assert.equal(nextTab(K, 'a', 'ArrowRight'), 'b');
  assert.equal(nextTab(K, 'd', 'ArrowRight'), 'a');
  assert.equal(nextTab(K, 'b', 'ArrowLeft'), 'a');
  assert.equal(nextTab(K, 'a', 'ArrowLeft'), 'd');
});

test('Home and End jump to the first and the last; any other key is not for the tabs', () => {
  assert.equal(nextTab(K, 'c', 'Home'), 'a');
  assert.equal(nextTab(K, 'a', 'End'), 'd');
  for (const key of ['Enter', ' ', 'Tab', 'ArrowDown', 'ArrowUp', 'a', 'Escape']) assert.equal(nextTab(K, 'b', key), null, key);
});

test('a current tab that is not in the list starts from before the first; an empty list moves nowhere', () => {
  assert.equal(nextTab(K, 'zzz', 'ArrowRight'), 'a');
  assert.equal(nextTab(K, 'zzz', 'ArrowLeft'), 'd');
  assert.equal(nextTab([], 'a', 'ArrowRight'), null);
  assert.equal(nextTab(['only'], 'only', 'ArrowRight'), 'only');
  assert.equal(nextTab(['only'], 'only', 'ArrowLeft'), 'only');
});

test('only shown, enabled tabs can be reached: disabled and hidden ones are skipped', () => {
  const keys = reachableKeys([{ key: 'a' }, { key: 'b', disabled: true }, { key: 'c', hidden: true }, { key: 'd' }, { key: 'e', hidden: false, disabled: false }]);
  assert.deepEqual(keys, ['a', 'd', 'e']);
  assert.equal(nextTab(keys, 'a', 'ArrowRight'), 'd');
  assert.equal(nextTab(keys, 'e', 'ArrowRight'), 'a');
  assert.equal(nextTab(keys, 'a', 'ArrowLeft'), 'e');
});

// ── resolveTab ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a legacy name leads to the tab that holds its content now: ?tab=lifecycle opens Approvals', () => {
  assert.equal(resolve('lifecycle'), 'approvals');
  assert.equal(resolve('sign-off'), 'approvals');
  assert.equal(resolve('comments'), 'discussion');
  assert.equal(resolve('controls'), 'mappings');
  assert.equal(resolve('gap-analysis'), 'gaps');
  assert.equal(resolve('change-log'), 'versions');
});

test('a name that is a tab of its own opens it; case and spaces do not matter', () => {
  assert.equal(resolve('versions'), 'versions');
  assert.equal(resolve('  Sign-Off '), 'approvals');
  assert.equal(resolve('CHAIN'), 'versions');
  assert.equal(resolveTab('?tab=Import-JSON', 'tab', ['library', 'import-json'], {}, 'library'), 'import-json');
  assert.equal(resolveTab('?tab=import-json', 'tab', ['library', 'Import-JSON'], {}, 'library'), 'Import-JSON', 'the key keeps the spelling the page gave it');
});

test('an unknown, empty or missing value opens the fallback, and so does a name that is only on the prototype', () => {
  for (const tab of ['nope', '', '   ', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(resolve(tab), 'document', JSON.stringify(tab));
  assert.equal(resolve(null), 'document');
  assert.equal(resolveTab('?other=approvals', 'tab', KEYS, ALIASES, 'document'), 'document');
});

test('it answers exactly as viewOf does for the Documents page, for every legacy name and for odd input', () => {
  const inputs = [...Object.keys(ALIASES), ...KEYS, 'Document', ' APPROVALS ', 'Sign-Off', 'nope', '', 'constructor', 'gap analysis'];
  for (const tab of inputs) assert.equal(resolve(tab), viewOf(tab), JSON.stringify(tab));
});

test('an alias that leads to a tab that is not offered today opens the fallback', () => {
  const keys = ['overview', 'risk'];                                                    // "proposals" is hidden today
  assert.equal(resolveTab('?tab=proposed', 'tab', keys, { proposed: 'proposals' }, 'overview'), 'overview');
  assert.equal(resolveTab('?tab=proposed', 'tab', keys, { proposed: 'risk' }, 'overview'), 'risk');
  assert.equal(resolveTab('?tab=Proposed', 'tab', keys, { PROPOSED: ' Risk ' }, 'overview'), 'risk', 'alias names and targets are compared the same way');
});

test('any parameter name works, other parameters are ignored, the first value wins, "?" is optional', () => {
  assert.equal(resolveTab('?view=risk&tab=overview', 'view', ['overview', 'risk'], {}, 'overview'), 'risk');
  assert.equal(resolveTab('tab=risk', 'tab', ['overview', 'risk'], {}, 'overview'), 'risk');
  assert.equal(resolveTab('?tab=risk&tab=overview', 'tab', ['overview', 'risk'], {}, 'overview'), 'risk');
  assert.equal(resolveTab('?tab=sign%20off', 'tab', ['sign off'], {}, 'x'), 'sign off');
});

// ── withTab ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('picking a tab sets the param and keeps every other param where it was', () => {
  assert.equal(withTab('?q=acme&tab=risk&page=3', 'tab', 'overview'), 'q=acme&tab=overview&page=3');
  assert.equal(withTab('q=acme&page=3', 'tab', 'risk'), 'q=acme&page=3&tab=risk');
  assert.equal(withTab('', 'tab', 'risk'), 'tab=risk');
  assert.equal(withTab('?tab=risk', 'tab', 'risk'), 'tab=risk');
});

test('the default tab has the plain address: the param goes, the others stay', () => {
  assert.equal(withTab('?q=acme&tab=risk&page=3', 'tab', 'overview', 'overview'), 'q=acme&page=3');
  assert.equal(withTab('?tab=risk', 'tab', 'overview', 'overview'), '');
  assert.equal(withTab('?q=acme', 'tab', 'overview', 'overview'), 'q=acme');
  assert.equal(withTab('?q=acme', 'tab', 'risk', 'overview'), 'q=acme&tab=risk');
});

test('repeated params of the same name collapse to one, and values with odd characters round-trip', () => {
  assert.equal(withTab('?tab=a&tab=b', 'tab', 'c'), 'tab=c');
  assert.equal(withTab('?name=A%26B&tab=a', 'tab', 'b'), 'name=A%26B&tab=b');
  assert.equal(withTab('', 'tab', 'sign off'), 'tab=sign+off');
  assert.equal(resolveTab(`?${withTab('', 'tab', 'sign off')}`, 'tab', ['sign off'], {}, 'x'), 'sign off');
});

test('what withTab writes, resolveTab reads back', () => {
  for (const key of KEYS) assert.equal(resolveTab(`?${withTab('?x=1', 'tab', key)}`, 'tab', KEYS, ALIASES, 'document'), key);
});

// ── count badge, ids, strip scrolling ─────────────────────────────────────────────────────────────────────────────────────────────────
test('the count badge caps at 99+ and says nothing when there is no count', () => {
  assert.equal(countLabel(0), '0');
  assert.equal(countLabel(7), '7');
  assert.equal(countLabel(99), '99');
  assert.equal(countLabel(100), '99+');
  assert.equal(countLabel(12345), '99+');
  assert.equal(countLabel(4.9), '4');
  assert.equal(countLabel(-3), '0');
  for (const none of [undefined, null, NaN, Infinity]) assert.equal(countLabel(none as number), '', String(none));
});

test('a tab and its panel point at each other, whatever characters the key holds', () => {
  assert.equal(tabId(':r1:', 'overview'), ':r1:-tab-overview');
  assert.equal(panelId(':r1:', 'overview'), ':r1:-panel-overview');
  assert.notEqual(tabId('b', 'x'), panelId('b', 'x'));
  assert.notEqual(tabId('b', 'a b'), tabId('b', 'a_b'));
  assert.ok(!/\s/.test(tabId('b', 'a b')));
});

test('the strip scrolls just enough to show the picked tab', () => {
  const view = { start: 100, end: 500 };
  assert.equal(scrollDelta(view, { start: 200, end: 300 }), 0);                       // in view
  assert.equal(scrollDelta(view, { start: 40, end: 140 }), -68);                      // cut off on the left: 100 - (40 - 8)
  assert.equal(scrollDelta(view, { start: 450, end: 560 }), 68);                      // cut off on the right: (560 + 8) - 500
  assert.equal(scrollDelta(view, { start: 108, end: 300 }), 0);                       // exactly the padding from the edge
  assert.equal(scrollDelta(view, { start: 107, end: 300 }), -1);
  assert.equal(scrollDelta(view, { start: 120, end: 492 }), 0);                       // 8 from the right edge
  assert.equal(scrollDelta(view, { start: 120, end: 493 }), 1);
  assert.equal(scrollDelta(view, { start: 100, end: 160 }, 0), 0);
});

test('a tab wider than the strip is lined up with its start', () => {
  assert.equal(scrollDelta({ start: 0, end: 100 }, { start: 150, end: 400 }), 142);
  assert.equal(scrollDelta({ start: 0, end: 100 }, { start: -50, end: 200 }), -58);
});
