// node --test "src/app/(dashboard)/auditor-portal/_front/frontRules.test.ts"
// Overview v2 of the Auditor Portal: the journeys as small multiples, the slim "Waiting for a decision" card, where "See all" opens, and the five regulators.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { JOURNEYS_ANCHOR, JOURNEY_WORDS, WAITING_ROWS, journeyTiles, share, topRegulators, waitedDays, waitingRows, waitingTarget } from './frontRules.ts';
import { tilesOf } from '../../../../components/overview/charts/areaModel.ts';
import type { JourneyCard, WorkRowPayload } from '../../../../lib/auditorPortal/portalModel.ts';
import type { ObservationSummary } from '../../../../lib/auditorPortal/frontModel.ts';

const NOW = new Date('2026-11-12T12:00:00Z');
let n = 0;
const card = (o: Partial<JourneyCard> & { pending?: number; approved?: number; rejected?: number; scopePending?: number } = {}): JourneyCard => {
  n += 1;
  const { pending = 0, approved = 0, rejected = 0, scopePending = 0, ...rest } = o;
  return { id: n, name: `Journey ${n}`, status: 'in_progress', framework: 'ISO 27001', version: '2022', files: { pending, approved, rejected, total: pending + approved + rejected }, scope: { pending: scopePending, approved: 0, rejected: 0, total: scopePending }, controls_total: 10, no_request: 0, ...rest };
};
const row = (o: Partial<WorkRowPayload> = {}): WorkRowPayload => { n += 1; return { kind: 'file', id: n, journey_id: 8, journey: 'SOC 2', title: `f${n}.pdf`, context: null, since: '2026-05-04T00:00:00', by: 'Paula', ...o }; };

test('one tile per journey, the ones with the most waiting first; ring = the share of its files decided', () => {
  const quiet = card({ approved: 10, name: 'Quiet' });
  const busy = card({ pending: 29, approved: 23, scopePending: 3, name: 'Busy' });
  const empty = card({ name: 'No files yet' });
  const tiles = journeyTiles([quiet, empty, busy]);
  assert.deepEqual(tiles.map((t) => t.label), ['Busy', 'No files yet', 'Quiet'], 'then by name, as the old list did');
  assert.deepEqual([tiles[0].value, tiles[0].display, tiles[0].tone], [44, '44%', 'warn']);
  assert.deepEqual([tiles[2].value, tiles[2].tone], [100, 'good']);
  assert.deepEqual([tiles[1].value, tiles[1].tone, tiles[1].display], [null, 'neutral', undefined], 'nothing to decide is not 0% and not green');
  assert.equal(tiles[0].href, `/auditor-portal/${busy.id}`);
  assert.match(tiles[0].note ?? '', /29 files to review · 3 scope requests · 23 of 52 files decided/);
  assert.match(tiles[0].note ?? '', /^In progress/);
  assert.equal(JOURNEY_WORDS.good, 'Nothing waiting');
});

test('the tiles feed AreaTiles as they are: twelve then "See all", the colours named with their words', () => {
  const many = Array.from({ length: 14 }, (_, i) => card({ pending: i, approved: 5 }));
  const t = tilesOf(journeyTiles(many), 12, JOURNEY_WORDS);
  assert.equal(t.shown.length, 12);
  assert.equal(t.hidden, 2);
  assert.equal(t.shown[0].word, 'Waiting for a decision');
  assert.ok(t.shown.every((x) => x.href?.startsWith('/auditor-portal/')));
});

test('how long something has waited, never negative, null with no date', () => {
  assert.equal(waitedDays('2026-11-02T12:00:00Z', NOW), 10);
  assert.equal(waitedDays('2026-12-01T00:00:00Z', NOW), 0);
  assert.equal(waitedDays(null, NOW), null);
  assert.equal(waitedDays('not a date', NOW), null);
});

test('the slim card: three rows, the oldest first as the server lists them, the wait in words with the cuts of the age buckets', () => {
  const rows = [row({ since: '2026-05-04T00:00:00Z' }), row({ kind: 'scope', since: '2026-09-30T00:00:00Z', title: null }), row({ since: '2026-11-10T00:00:00Z' }), row()];
  const out = waitingRows(rows, NOW);
  assert.equal(WAITING_ROWS, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => [r.action, r.wait?.text, r.wait?.tone]), [['Review', 'Waiting 192d', 'danger'], ['Decide', 'Waiting 43d', 'warning'], ['Review', 'Waiting 2d', 'neutral']]);
  assert.equal(out[1].title, 'A scope request');
  assert.match(out[0].name, /^Review: f\d+\.pdf, SOC 2, waiting 192d$/);
  assert.ok(out[0].href.startsWith('/auditor-portal/8?'), 'the row opens its journey with the decision ready');
  assert.equal(waitingRows([row({ since: null })], NOW)[0].wait, null);
});

test('"See all" opens the queue of the one journey that holds the work, else the journey tiles', () => {
  const a = card({ pending: 4 });
  const b = card({ approved: 3 });
  assert.equal(waitingTarget([a, b]), `/auditor-portal/${a.id}`);
  const s = card({ scopePending: 2 });
  assert.equal(waitingTarget([b, s]), `/auditor-portal/${s.id}?kind=scope`);
  assert.equal(waitingTarget([a, s]), JOURNEYS_ANCHOR);
  assert.equal(waitingTarget([]), JOURNEYS_ANCHOR);
});

test('regulators: the five with the most open, each opening the register on it; the others are counted, not drawn', () => {
  const s = { regulators: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, i) => ({ name, open: 10 - i, total: 12 })).concat({ name: 'Z', open: 0, total: 3 }) } as ObservationSummary;
  const out = topRegulators(s);
  assert.deepEqual(out?.rows.map((r) => r.label), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(out?.more, 2, 'F and G; a regulator with none open is not "more"');
  assert.equal(out?.rows[0].href, '/auditor-portal/statutory-audit?regulator=A');
  assert.ok(out?.rows.every((r) => r.note === undefined), 'no "24 in all" line under a bar');
  assert.equal(topRegulators(undefined), null);
  assert.deepEqual([share(6, 28), share(0, 0), share(30, 10)], [21, null, 100]);
});
