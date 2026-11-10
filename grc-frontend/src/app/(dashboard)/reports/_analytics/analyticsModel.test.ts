// node --test "src/app/(dashboard)/reports/_analytics/analyticsModel.test.ts"
// The Analytics launcher's rules: the status in plain words (and from an older server's keys), how each ready-made dashboard opens, and what a failed open says (never the server's own words).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONNECTED, CONNECTED_DETAIL, NOT_SET_UP, NOT_SET_UP_DETAIL, openFailure, openHow, openLabel, readStatus, statusOf, validFor } from './analyticsModel.ts';

const DASHES = [
  { key: 'risk_posture', title: 'Risk posture', hint: 'Open risks, residual, aging', metabase_dashboard_id: 7 },
  { key: 'vendor_tpra', title: 'Vendor & TPRA', hint: 'Tiers, findings, residual', metabase_dashboard_id: null },
];

test('the status is read in the words the server gives (headline and detail), and a missing answer is an honest "not set up"', () => {
  const s = readStatus({ ready: true, can_embed: true, headline: 'Connected', detail: 'Open it.', starter_dashboards: DASHES });
  assert.deepEqual([s.ready, s.canEmbed, s.headline, s.detail], [true, true, 'Connected', 'Open it.']);
  assert.deepEqual(s.dashboards.map((d) => [d.key, d.viewId]), [['risk_posture', '7'], ['vendor_tpra', null]]);
  for (const raw of [null, undefined, {}, { ready: false }]) {
    const none = readStatus(raw);
    assert.deepEqual([none.ready, none.canEmbed, none.headline, none.detail, none.dashboards], [false, false, NOT_SET_UP, NOT_SET_UP_DETAIL, []]);
  }
});

test('a server older than the plain-words keys still works: `configured` is ready and `static_embed` is can-embed, with the page\'s own words', () => {
  const old = readStatus({ configured: true, static_embed: true, mode: 'static_embed', site_url: 'http://x', starter_dashboards: DASHES });
  assert.deepEqual([old.ready, old.canEmbed, old.headline, old.detail], [true, true, CONNECTED, CONNECTED_DETAIL]);
  assert.equal(readStatus({ configured: true }).canEmbed, false);
  assert.equal(readStatus({ configured: false, static_embed: true }).canEmbed, false, 'an embed needs the tool to be set up');
  assert.equal(readStatus({ ready: false, configured: true }).ready, false, 'the new key wins over the old one');
});

test('the words of the page never carry a product, a setting or an address', () => {
  const words = [NOT_SET_UP, NOT_SET_UP_DETAIL, CONNECTED, CONNECTED_DETAIL, openFailure(undefined), openFailure(503), openFailure(403), openFailure(500), openLabel('here'), openLabel('tab')].join(' ');
  assert.doesNotMatch(words, /metabase|env|jwt|sso|deploy|licen[cs]e|http|localhost|\.py|\/api/i);
});

test('a dashboard opens in the page only when the server can embed it AND it has a view; otherwise in a new tab', () => {
  const ready = readStatus({ ready: true, can_embed: true, starter_dashboards: DASHES });
  assert.deepEqual(ready.dashboards.map((d) => openHow(ready, d)), ['here', 'tab']);
  const plain = readStatus({ ready: true, can_embed: false, starter_dashboards: DASHES });
  assert.deepEqual(plain.dashboards.map((d) => openHow(plain, d)), ['tab', 'tab']);
  assert.deepEqual([openLabel('here'), openLabel('tab')], ['View here', 'Open in a new tab']);
});

test('a dashboard with no key is dropped, and one with no title is named by its key', () => {
  const s = readStatus({ ready: true, starter_dashboards: [{ title: 'No key' }, { key: 'evidence_compliance' }, 'junk', null] });
  assert.deepEqual(s.dashboards.map((d) => [d.key, d.title]), [['evidence_compliance', 'evidence_compliance']]);
});

test('a failed open says why in words: no answer, not set up, no right, anything else', () => {
  assert.match(openFailure(undefined), /could not be reached/);
  assert.equal(openFailure(503), NOT_SET_UP_DETAIL);
  assert.match(openFailure(401), /does not include advanced analytics/);
  assert.match(openFailure(403), /does not include advanced analytics/);
  assert.match(openFailure(500), /Try again/);
  assert.equal(statusOf({ response: { status: 503 } }), 503);
  assert.equal(statusOf(new Error('Network Error')), undefined);
  assert.equal(statusOf(null), undefined);
});

test('how long an embedded view stays open, from the seconds the server says', () => {
  assert.equal(validFor(600), 'about 10 minutes');
  assert.equal(validFor(60), 'about 1 minute');
  assert.equal(validFor(20), '');
  assert.equal(validFor(undefined), '');
  assert.equal(validFor('600'), '');
});
