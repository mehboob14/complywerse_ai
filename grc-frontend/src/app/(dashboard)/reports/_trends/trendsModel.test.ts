// node --test "src/app/(dashboard)/reports/_trends/trendsModel.test.ts"
// The Trends board's rules: how a value reads, which cards a filter keeps and in what order, the day a change is measured from (the server's rule), the sentence a chart is summed up in, the sparkline,
// the tables beside the charts, the address, and whether a typed target makes sense.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { TRENDS_SCHEMA, metricHref, rangeOf } from './trendsAddress.ts';
import {
  RAG_ORDER, RANGES, axisDate, checkTarget, chartSlices, daysBetween, deltaView, directionWords, filterCards, formatDay, formatValue, groupByModule, hasSeries, lastCaptured, orderCards, previousPoint,
  levelsHint, sinceWords, sliceRows, sortCards, sparkPath, staleDays, statusCounts, summarySentence, targetChanged, totalPoints, unitTag, valueRows, yDomain, type Direction, type Rag, type TrendCard, type TrendPoint, type Unit,
} from './trendsModel.ts';

const pts = (...xs: Array<[string, number | null]>): TrendPoint[] => xs.map(([date, value]) => ({ date, value }));
const card = (over: Partial<TrendCard> = {}): TrendCard => ({
  key: 'k', label: 'Open risks', module: 'risk', module_label: 'Risk', unit: 'count', direction: 'down_good', dimension: null, definition: '', target: 40, warn: 60, critical: null,
  current: 55, previous: 62, delta_abs: -7, delta_pct: -11.3, status: 'warn', as_of: '2026-11-09', points: [], ...over,
});

test('a value reads in its unit, a missing one is a dash, and a count has its thousands separator', () => {
  assert.equal(formatValue(55.04, 'pct'), '55%');
  assert.equal(formatValue(62.46, 'score'), '62.5');
  assert.equal(formatValue(9.5, 'days'), '9.5 days');
  assert.equal(formatValue(1204.4, 'count'), '1,204');
  for (const u of ['pct', 'score', 'days', 'count'] as Unit[]) { assert.equal(formatValue(null, u), '—'); assert.equal(formatValue(NaN, u), '—'); }
  assert.deepEqual((['pct', 'score', 'days', 'count'] as Unit[]).map(unitTag), ['%', '/100', 'days', '']);
});

test('dates: an axis tick is "12 Nov", a snapshot day is "12 Nov 2026" and never moves with the time zone, no date is empty', () => {
  assert.equal(axisDate('2026-11-12'), '12 Nov');
  assert.equal(axisDate('2026-11-12T23:59:00'), '12 Nov');
  assert.equal(axisDate(null), '');
  assert.equal(axisDate('nonsense'), '');
  assert.equal(formatDay('2026-11-12'), '12 Nov 2026');
  assert.equal(formatDay(null), '—');
  assert.equal(daysBetween('2026-10-12', '2026-11-12'), 31);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('the four ranges, in words', () => {
  assert.deepEqual(RANGES.map((r) => [r.days, r.label]), [[30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '1 year']]);
});

test('status counts, the filter and the two orders: a filter keeps the chosen statuses, "needs attention first" is off target, watch, on target, no target, ties in catalog order', () => {
  const cards = [card({ key: 'a', status: 'ok' }), card({ key: 'b', status: 'none' }), card({ key: 'c', status: 'critical' }), card({ key: 'd', status: 'warn' }), card({ key: 'e', status: 'critical' }), card({ key: 'f', status: 'ok' })];
  assert.deepEqual(statusCounts(cards), { critical: 2, warn: 1, ok: 2, none: 1 });
  assert.deepEqual(statusCounts([card({ status: 'weird' as Rag })]), { critical: 0, warn: 0, ok: 0, none: 1 }, 'an unknown word counts as no target');
  assert.deepEqual(filterCards(cards, []).map((c) => c.key), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(filterCards(cards, ['critical', 'warn']).map((c) => c.key), ['c', 'd', 'e']);
  assert.deepEqual(orderCards(cards, 'module').map((c) => c.key), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(orderCards(cards, 'attention').map((c) => c.key), ['c', 'e', 'd', 'a', 'f', 'b']);
  assert.deepEqual(cards.map((c) => c.key), ['a', 'b', 'c', 'd', 'e', 'f'], 'the input is not touched');
  assert.deepEqual(RAG_ORDER, ['critical', 'warn', 'ok', 'none']);
});

test('the table sorts by the column asked for: name, module in catalog order, value, change, status; a card with no value is last either way', () => {
  const cards = [card({ key: 'a', label: 'Zeta', module: 'risk', current: 5, delta_abs: -1, status: 'ok' }), card({ key: 'b', label: 'Alpha', module: 'vendors', current: null, delta_abs: null, status: 'critical' }), card({ key: 'c', label: 'Mid', module: 'risk', current: 9, delta_abs: 4, status: 'warn' })];
  const keys = (sort: Parameters<typeof sortCards>[1]) => sortCards(cards, sort).map((c) => c.key);
  assert.deepEqual(keys(null), ['a', 'b', 'c']);
  assert.deepEqual(keys({ key: 'figure', dir: 'asc' }), ['b', 'c', 'a']);
  assert.deepEqual(keys({ key: 'module', dir: 'asc' }), ['a', 'c', 'b']);
  assert.deepEqual(keys({ key: 'now', dir: 'desc' }), ['c', 'a', 'b']);
  assert.deepEqual(keys({ key: 'now', dir: 'asc' }), ['a', 'c', 'b']);
  assert.deepEqual(keys({ key: 'change', dir: 'desc' }), ['c', 'a', 'b']);
  assert.deepEqual(keys({ key: 'status', dir: 'asc' }), ['b', 'c', 'a']);
});

test('the cards group by module in the order the modules first appear, each with its own label', () => {
  const cards = [card({ key: 'a', module: 'risk', module_label: 'Risk' }), card({ key: 'b', module: 'vendors', module_label: 'Vendor Risk' }), card({ key: 'c', module: 'risk', module_label: 'Risk' })];
  assert.deepEqual(groupByModule(cards).map((g) => [g.module, g.label, g.cards.map((c) => c.key)]), [['risk', 'Risk', ['a', 'c']], ['vendors', 'Vendor Risk', ['b']]]);
  assert.deepEqual(groupByModule([]), []);
});

test('history: a line needs two real points, nothing captured is zero points, the newest day is the last captured, and a week with no capture is old', () => {
  assert.equal(hasSeries(pts(['2026-11-01', 1])), false);
  assert.equal(hasSeries(pts(['2026-11-01', 1], ['2026-11-02', null])), false);
  assert.equal(hasSeries(pts(['2026-11-01', 1], ['2026-11-02', 2])), true);
  assert.equal(hasSeries(undefined), false);
  assert.equal(totalPoints([card({ points: pts(['2026-11-01', 1], ['2026-11-02', null]) }), card({ points: [] })]), 1);
  assert.equal(lastCaptured([card({ as_of: '2026-11-03' }), card({ as_of: '2026-11-09T10:00:00' }), card({ as_of: null })]), '2026-11-09');
  assert.equal(lastCaptured([card({ as_of: null })]), null);
  assert.equal(staleDays('2026-11-03', '2026-11-10'), null, 'seven days is not yet old');
  assert.equal(staleDays('2026-11-02', '2026-11-10'), 8);
  assert.equal(staleDays(null, '2026-11-10'), null);
});

test('the day a change is measured from is the server\'s rule: the last point at or before 30 days earlier, else the first point', () => {
  const long = pts(['2026-09-01', 10], ['2026-10-05', 20], ['2026-10-10', 30], ['2026-11-09', 40]);
  assert.equal(previousPoint(long)?.date, '2026-10-10', 'exactly 30 days before 9 Nov is 10 Oct');
  assert.equal(previousPoint(pts(['2026-11-01', 10], ['2026-11-09', 40]))?.date, '2026-11-01', 'less than 30 days of history: the first point');
  assert.equal(previousPoint(pts(['2026-11-09', 40])), null);
  assert.equal(previousPoint([]), null);
  assert.equal(previousPoint(pts(['2026-09-01', null], ['2026-11-09', 40]))?.date, '2026-09-01', 'a gap at the day falls back to the first point, as the server does');
  assert.equal(sinceWords(long), 'since 10 Oct 2026');
  assert.equal(sinceWords([]), '');
});

test('a change says its direction, its size and whether it is the good way: in words as well as in colour', () => {
  const down = deltaView(card({ delta_abs: -7, previous: 62, direction: 'down_good', unit: 'count' }));
  assert.deepEqual([down.arrow, down.text, down.good, down.verdict], ['down', '−7', true, 'better']);
  const up = deltaView(card({ delta_abs: 3.24, previous: 50, direction: 'down_good', unit: 'score' }));
  assert.deepEqual([up.arrow, up.text, up.good, up.verdict], ['up', '+3.2', false, 'worse']);
  assert.notEqual(down.color, up.color);
  const pct = deltaView(card({ delta_abs: 2, previous: 70, direction: 'up_good', unit: 'pct' }));
  assert.equal(pct.text, '+2 pp');
  const neutral = deltaView(card({ delta_abs: 12, previous: 100, direction: 'neutral', unit: 'count' }));
  assert.deepEqual([neutral.good, neutral.verdict], [null, null], 'a figure with no direction is neither better nor worse');
  const same = deltaView(card({ delta_abs: 0, previous: 5 }));
  assert.deepEqual([same.arrow, same.text, same.verdict], ['flat', 'no change', null]);
  assert.deepEqual(deltaView(card({ delta_abs: null, previous: null })).text, '—');
  assert.equal(deltaView(card({ delta_abs: 1500, previous: 1, unit: 'count', direction: 'neutral' })).text, '+1,500');
  assert.deepEqual((['down_good', 'up_good', 'neutral'] as Direction[]).map(directionWords), ['Lower is better', 'Higher is better', 'No better or worse direction']);
});

test('the editor says what the two levels mean for the direction of a figure', () => {
  assert.match(levelsHint('up_good'), /Below the warning level is Off target/);
  assert.match(levelsHint('down_good'), /Above the warning level is Off target/);
  assert.match(levelsHint('neutral'), /does not give it a status/);
});

test('the sentence that sums a chart up: first value and day, last value and day, the target; nothing when there is no line', () => {
  const c = card({ points: pts(['2026-08-12', 62], ['2026-10-01', null], ['2026-11-09', 55]), unit: 'score', target: 40, label: 'Avg residual risk' });
  assert.equal(summarySentence(c), 'Avg residual risk: from 62 on 12 Aug 2026 to 55 on 9 Nov 2026 (target 40).');
  assert.equal(summarySentence({ ...c, target: null }), 'Avg residual risk: from 62 on 12 Aug 2026 to 55 on 9 Nov 2026.');
  assert.equal(summarySentence({ ...c, points: pts(['2026-11-09', 55]) }), '');
});

test('a sparkline fits its box, leaves a gap out, puts the target line inside the box, and is null with fewer than two points', () => {
  assert.equal(sparkPath(pts(['2026-11-01', 1]), null, 100, 30), null);
  const s = sparkPath(pts(['2026-11-01', 10], ['2026-11-02', null], ['2026-11-03', 30], ['2026-11-04', 20]), 25, 100, 30)!;
  assert.ok(s.line.startsWith('M0.0,') && !/NaN|Infinity/.test(s.line + s.area));
  assert.equal(s.line.split('L').length, 3, 'three real points: one M and two L');
  assert.ok(s.targetY! > 0 && s.targetY! < 30);
  assert.ok(s.last.x === 100 && s.last.y >= 0 && s.last.y <= 30);
  const flat = sparkPath(pts(['2026-11-01', 5], ['2026-11-02', 5]), null, 100, 30)!;
  assert.ok(!/NaN/.test(flat.line), 'a flat line has a range of its own');
  assert.equal(sparkPath(pts(['2026-11-01', 5], ['2026-11-02', 6]), null, 100, 30)!.targetY, null);
});

test('the y range keeps a percentage inside 0 to 100, starts a count at 0, and has a range for no data', () => {
  assert.deepEqual(yDomain([], 'pct'), [0, 100]);
  assert.deepEqual(yDomain([], 'count'), [0, 1]);
  const [lo, hi] = yDomain([40, 99], 'pct', [100]);
  assert.ok(lo >= 0 && hi <= 100);
  assert.equal(yDomain([200, 400], 'count')[0], 0);
  const [a, b] = yDomain([7, 7], 'score');
  assert.ok(a < b, 'a flat line still has a range');
});

test('the visible table of a line chart: every captured value, newest first, a gap left out (it is not 0)', () => {
  const rows = valueRows(pts(['2026-11-01', 10], ['2026-11-02', null], ['2026-11-03', 12.46]), 'score');
  assert.deepEqual(rows, [{ date: '2026-11-03', day: '3 Nov 2026', value: '12.5' }, { date: '2026-11-01', day: '1 Nov 2026', value: '10' }]);
});

test('the table of a breakdown lists every slice, largest first, a slice with no value last; the chart draws the largest eight and says how many it left out', () => {
  const series = [
    { key: 'low', points: pts(['2026-10-01', 4], ['2026-11-01', 6]) },
    { key: 'critical', points: pts(['2026-10-01', 9], ['2026-11-01', 2]) },
    { key: 'none', points: pts(['2026-10-01', null]) },
    { key: 'high', points: pts(['2026-11-01', 20]) },
  ];
  const rows = sliceRows(series);
  assert.deepEqual(rows.map((r) => [r.key, r.latest, r.change]), [['high', 20, null], ['low', 6, 2], ['critical', 2, -7], ['none', null, null]]);
  const many = Array.from({ length: 12 }, (_, i) => ({ key: `s${i}`, points: pts(['2026-11-01', i]) }));
  const { keys, hidden } = chartSlices(sliceRows(many));
  assert.equal(keys.length, 8);
  assert.equal(hidden, 4);
  assert.equal(keys[0], 's11');
  assert.deepEqual(chartSlices([]), { keys: [], hidden: 0 });
});

test('a typed target: blank is none, text that is not a number is an error (it used to be sent as NaN), and the warning level sits on the right side of the target', () => {
  assert.deepEqual(checkTarget('up_good', '', ''), { target: null, warn: null, error: null });
  assert.deepEqual(checkTarget('up_good', '90', '75'), { target: 90, warn: 75, error: null });
  assert.deepEqual(checkTarget('down_good', ' 40 ', '60'), { target: 40, warn: 60, error: null });
  assert.match(checkTarget('up_good', 'abc', '')!.error!, /target must be a number/);
  assert.match(checkTarget('up_good', '90', '1e999')!.error!, /warning level must be a number/);
  assert.match(checkTarget('up_good', '90', '95')!.error!, /higher is better/);
  assert.match(checkTarget('down_good', '40', '30')!.error!, /lower is better/);
  assert.match(checkTarget('down_good', '', '30')!.error!, /needs a target/);
  assert.equal(checkTarget('neutral', '40', '30').error, null, 'a figure with no direction has no side to check');
  assert.equal(checkTarget('down_good', '40', '40').error, null, 'a warning level equal to the target is allowed');
});

test('the editor knows when its boxes differ from the saved target', () => {
  const c = card({ target: 40, warn: 60 });
  assert.equal(targetChanged(c, '40', '60'), false);
  assert.equal(targetChanged(c, '41', '60'), true);
  assert.equal(targetChanged(c, '40', ''), true);
  assert.equal(targetChanged(card({ target: null, warn: null }), '', ''), false);
});

test('the address: the defaults are the plain address, a link opens the same view, junk is the default, and a figure\'s link keeps what the board shows', () => {
  assert.equal(writeAddress(TRENDS_SCHEMA, '', readAddress(TRENDS_SCHEMA, '')), '');
  const s = readAddress(TRENDS_SCHEMA, '?view=Table&order=attention&status=critical,warn,bogus&range=90&metric=open_risks&sort=now:desc');
  assert.deepEqual(s, { view: 'table', order: 'attention', status: ['critical', 'warn'], range: 90, metric: 'open_risks', sort: { key: 'now', dir: 'desc' } });
  assert.equal(writeAddress(TRENDS_SCHEMA, '', s), 'view=table&order=attention&status=critical%2Cwarn&range=90&metric=open_risks&sort=now%3Adesc');
  assert.deepEqual(readAddress(TRENDS_SCHEMA, '?view=cards&order=x&range=abc&sort=x:y'), { view: 'board', order: 'module', status: [], range: 180, metric: '', sort: null });
  assert.equal(rangeOf(90), 90);
  assert.equal(rangeOf(45), 180, 'a range nobody offers is the default');
  assert.equal(metricHref('open_risks', 'view=table&range=90'), '/reports/trends?view=table&range=90&metric=open_risks');
});
