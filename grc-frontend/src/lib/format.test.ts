// node --test "src/lib/format.test.ts"
// The one place a date, an empty value, a count and a label are written (src/lib/format.ts). What a date says depends on the viewer's time
// zone, so those rules run in child processes started with TZ set (six zones, clock changes included); the rest is plain text and arithmetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  EMPTY, NOT_SET, UNASSIGNED, formatCompact, formatCount, formatDate, formatDateTime, formatPercent, formatRelative, moreCount, orEmpty, statusLabel, truncate,
} from './format.ts';

// ── empty values ─────────────────────────────────────────────────────────────
test('the three words for "no value" are fixed: an em dash, "Not set", "Unassigned"', () => {
  assert.equal(EMPTY, '—');                                     // not "-", not an en dash, never "N/A" / "None" / "Unknown"
  assert.equal(NOT_SET, 'Not set');
  assert.equal(UNASSIGNED, 'Unassigned');
});

test('a missing, blank or broken date is the empty text; the caller can ask for "Not set" or its own words', () => {
  const none = [null, undefined, '', '   ', '\n\t', 'not a date', '2026-13-45', '2026-00-10', '2026-11-00', Number.NaN, new Date(Number.NaN)];
  for (const value of none) {
    assert.equal(formatDate(value), EMPTY, String(value));
    assert.equal(formatDateTime(value), EMPTY, String(value));
    assert.equal(formatDate(value, { empty: NOT_SET }), 'Not set', String(value));
    assert.equal(formatDateTime(value, { empty: 'No date' }), 'No date', String(value));
    assert.equal(formatRelative(value), '', String(value));            // the date beside it already says there is none
  }
});

test('orEmpty: the value, or the empty text for nothing, blank and not-a-number; 0 is a value', () => {
  for (const none of [null, undefined, '', ' ', '\n\t ', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(orEmpty(none), EMPTY, String(none));
    assert.equal(orEmpty(none, NOT_SET), 'Not set', String(none));
    assert.equal(orEmpty(none, UNASSIGNED), 'Unassigned', String(none));
  }
  assert.equal(orEmpty('Acme'), 'Acme');
  assert.equal(orEmpty(' Acme '), ' Acme ');                         // the value as it is: only "nothing" is replaced
  assert.equal(orEmpty(0), '0');
  assert.equal(orEmpty('0'), '0');
  assert.equal(orEmpty(-3.5), '-3.5');
});

// ── dates that do not depend on the zone ─────────────────────────────────────
test('the month names are our own list and a day has no leading zero', () => {
  const months = Array.from({ length: 12 }, (_, i) => formatDate(`2026-${String(i + 1).padStart(2, '0')}-05`));
  assert.deepEqual(months, [
    '5 Jan 2026', '5 Feb 2026', '5 Mar 2026', '5 Apr 2026', '5 May 2026', '5 Jun 2026',
    '5 Jul 2026', '5 Aug 2026', '5 Sep 2026', '5 Oct 2026', '5 Nov 2026', '5 Dec 2026',                // Intl en-GB says "Sept"
  ]);
  assert.equal(formatDate('2026-11-12'), '12 Nov 2026');
});

test('a day the month does not have is no date (V8 would roll it into the next month)', () => {
  const impossible = ['2026-02-30', '2026-02-31', '2027-02-29', '2100-02-29', '2026-04-31', '2026-06-31', '2026-02-30T10:00:00', '2027-02-29T10:00:00Z'];
  for (const value of impossible) assert.equal(formatDate(value), EMPTY, value);
  assert.equal(formatDate('2028-02-29'), '29 Feb 2028');
  assert.equal(formatDate('2000-02-29'), '29 Feb 2000');             // divisible by 400: a leap year after all
  assert.equal(formatDate('2026-04-30'), '30 Apr 2026');
  assert.equal(formatDate('2026-12-31'), '31 Dec 2026');
});

test('calendar: whatever is not a date, or not written as one, is still the empty text', () => {
  const none = [
    null, undefined, '', '   ', 'not a date', '2026-13-45', '2026-00-10', '2026-11-00', '2026-02-30T00:00:00', '2027-02-29T10:00:00Z', '2100-02-29T00:00:00',
    'T00:00:00', '12 Nov 2026', '20261112', '2026-11-12Tjunk', Number.NaN, new Date(Number.NaN),
  ];
  for (const value of none) {
    assert.equal(formatDate(value, { calendar: true }), EMPTY, String(value));
    assert.equal(formatDateTime(value, { calendar: true }), EMPTY, String(value));
    assert.equal(formatDate(value, { calendar: true, empty: NOT_SET }), 'Not set', String(value));
    assert.equal(formatDateTime(value, { calendar: true, empty: 'No date' }), 'No date', String(value));
    assert.equal(formatRelative(value, new Date(2026, 10, 12, 15, 0), { calendar: true }), '', String(value));
  }
  assert.equal(formatDate('2000-02-29T00:00:00', { calendar: true }), '29 Feb 2000');       // a real leap day is a date
});

// ── numbers ──────────────────────────────────────────────────────────────────
test('formatCount: thousands separators, whole numbers, "—" for nothing', () => {
  assert.deepEqual([0, 7, 999, 1000, 12345, 1234567, -1234].map((n) => formatCount(n)), ['0', '7', '999', '1,000', '12,345', '1,234,567', '-1,234']);
  assert.equal(formatCount(1234.4), '1,234');
  assert.equal(formatCount(1234.5), '1,235');
  assert.equal(formatCount(-0.4), '0');                              // never "-0"
  for (const none of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formatCount(none), EMPTY, String(none));
  assert.equal(formatCount(null, NOT_SET), 'Not set');
});

test('formatPercent: whole numbers, one decimal only below 10, decided after rounding', () => {
  const cases: Array<[number, string]> = [
    [0, '0%'], [5, '5%'], [7.5, '7.5%'], [9.94, '9.9%'], [9.95, '10%'], [10, '10%'], [10.4, '10%'], [10.5, '11%'],     // 9.95 is "10%", not "10.0%" or "9.9%"
    [99.5, '100%'], [100, '100%'], [250, '250%'], [0.04, '0%'], [0.05, '0.1%'], [-3.25, '-3.3%'], [-0.04, '0%'], [-12.6, '-13%'],
  ];
  for (const [n, want] of cases) assert.equal(formatPercent(n), want, String(n));
  for (const none of [null, undefined, Number.NaN, Number.NEGATIVE_INFINITY]) assert.equal(formatPercent(none), EMPTY, String(none));
  assert.equal(formatPercent(undefined, NOT_SET), 'Not set');
});

test('formatCompact: 999, 1k, 1.2k, 12k, 3.4M; rounding up into the next unit rolls over', () => {
  const cases: Array<[number, string]> = [
    [0, '0'], [7, '7'], [9.95, '10'], [10, '10'], [999, '999'], [999.4, '999'], [999.6, '1k'], [1000, '1k'], [1234, '1.2k'], [1500, '1.5k'],
    [9949, '9.9k'], [9950, '10k'], [12345, '12k'], [999499, '999k'], [999500, '1M'], [999999, '1M'], [1_000_000, '1M'], [1_234_567, '1.2M'],
    [3_400_000, '3.4M'], [2_500_000_000, '2.5B'], [4_000_000_000_000, '4T'], [-1234, '-1.2k'], [-0.04, '0'],
  ];
  for (const [n, want] of cases) assert.equal(formatCompact(n), want, String(n));
  for (const none of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formatCompact(none), EMPTY, String(none));
});

// ── text ─────────────────────────────────────────────────────────────────────
test('statusLabel: a status word as a label; "—" (or the caller\'s words) when there is none', () => {
  assert.equal(statusLabel('in_remediation'), 'In remediation');
  assert.equal(statusLabel('Under-review'), 'Under review');
  assert.equal(statusLabel('ACTIVE'), 'Active');
  assert.equal(statusLabel('  pending   approval '), 'Pending approval');
  for (const none of [null, undefined, '', '  ', '_', '-']) {
    assert.equal(statusLabel(none), EMPTY, String(none));
    assert.equal(statusLabel(none, ''), '', String(none));
  }
});

test('truncate leaves a text that fits alone and says whether it cut', () => {
  assert.deepEqual(truncate('Short title', 60), { text: 'Short title', truncated: false, full: 'Short title' });
  const exact = 'x'.repeat(60);
  assert.deepEqual(truncate(exact, 60), { text: exact, truncated: false, full: exact });                // at the limit: untouched
  const over = truncate('x'.repeat(61), 60);
  assert.deepEqual(over, { text: `${'x'.repeat(59)}…`, truncated: true, full: 'x'.repeat(61) });        // 59 characters and the "…" make 60
  for (const none of ['', null, undefined]) assert.deepEqual(truncate(none, 10), { text: '', truncated: false, full: '' });
});

test('truncate: a 500-character title with no spaces is cut hard and never runs past the limit', () => {
  const title = 'A'.repeat(500);
  for (const max of [1, 2, 10, 60, 120, 499]) {
    const cut = truncate(title, max);
    assert.equal(cut.text, `${'A'.repeat(max - 1)}…`, String(max));
    assert.equal(cut.text.length, max, String(max));
    assert.equal(cut.truncated, true);
    assert.equal(cut.full, title);
  }
  assert.deepEqual(truncate(title, 500), { text: title, truncated: false, full: title });
});

test('truncate cuts at a word boundary when that keeps at least half of the room', () => {
  const sentence = 'The quick brown fox jumps over the lazy dog';
  assert.equal(truncate(sentence, 20).text, 'The quick brown fox…');                     // the word ends right at the limit: kept
  assert.equal(truncate(sentence, 18).text, 'The quick brown…');                         // "fox" does not fit: dropped whole, not "…brown fo…"
  assert.equal(truncate(sentence, 11).text, 'The quick…');
  assert.equal(truncate(sentence, 10).text, 'The quick…');
  assert.equal(truncate('aaaa bbbb', 6).text, 'aaaa…');
  assert.equal(truncate('The quick  brown', 12).text, 'The quick…');                      // spaces before the cut do not stay in front of the "…"
  assert.equal(truncate('a      bcdefg', 5).text, 'a…');                                   // a hard cut that lands on spaces drops them too
  for (const max of [5, 9, 14, 20, 31]) assert.ok(truncate(sentence, max).text.length <= max, String(max));
});

test('truncate: a long first word or an early space does not shrink the preview to nothing', () => {
  assert.equal(truncate('Supercalifragilisticexpialidocious is long', 10).text, 'Supercali…');
  assert.equal(truncate(`ab ${'x'.repeat(100)}`, 50).text, `ab ${'x'.repeat(46)}…`);
});

test('truncate never leaves half an emoji, and a limit below 1 is read as 1', () => {
  const faces = '😀'.repeat(10);                                                          // 20 UTF-16 units
  assert.equal(truncate(faces, 6).text, '😀😀…');                                          // 5 units would split the third face: back to 4
  assert.equal(truncate(faces, 5).text, '😀😀…');
  assert.equal(truncate(faces, 7).text, '😀😀😀…');
  for (const max of [0, -5, 0.5]) assert.equal(truncate('abc', max).text, '…', String(max));
});

test('moreCount: the first two and +N, for 0, 1, 2, 3 and 40 items', () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
  assert.deepEqual(moreCount(people(0)), { shown: [], rest: [], more: 0 });
  assert.deepEqual(moreCount(people(1)), { shown: ['p1'], rest: [], more: 0 });
  assert.deepEqual(moreCount(people(2)), { shown: ['p1', 'p2'], rest: [], more: 0 });
  assert.deepEqual(moreCount(people(3)), { shown: ['p1', 'p2'], rest: ['p3'], more: 1 });
  const forty = moreCount(people(40));
  assert.deepEqual(forty.shown, ['p1', 'p2']);
  assert.equal(forty.more, 38);
  assert.deepEqual(forty.rest, people(40).slice(2));                                       // nothing lost, order kept
});

test('moreCount: another number shown, no list, and the list itself is never changed', () => {
  const abc = ['a', 'b', 'c'];
  assert.deepEqual(moreCount(abc, 3), { shown: ['a', 'b', 'c'], rest: [], more: 0 });
  assert.deepEqual(moreCount(abc, 10), { shown: ['a', 'b', 'c'], rest: [], more: 0 });
  assert.deepEqual(moreCount(abc, 0), { shown: [], rest: ['a', 'b', 'c'], more: 3 });
  assert.deepEqual(moreCount(abc, -1), { shown: [], rest: ['a', 'b', 'c'], more: 3 });
  assert.deepEqual(moreCount(abc, 1.9), { shown: ['a'], rest: ['b', 'c'], more: 2 });
  assert.deepEqual(moreCount(null), { shown: [], rest: [], more: 0 });
  assert.deepEqual(moreCount(undefined), { shown: [], rest: [], more: 0 });
  const input = ['a', 'b', 'c', 'd'];
  moreCount(input);
  assert.deepEqual(input, ['a', 'b', 'c', 'd']);
});

// ── dates in other time zones ────────────────────────────────────────────────
const MODULE = new URL('./format.ts', import.meta.url).href;
const ZONES = { HNL: 'Pacific/Honolulu', LAX: 'America/Los_Angeles', UTC: 'UTC', MSK: 'Europe/Moscow', KHI: 'Asia/Karachi', AKL: 'Pacific/Auckland' };
type Code = keyof typeof ZONES;
const CODES = Object.keys(ZONES) as Code[];
// getTimezoneOffset() on 15 Jan and 15 Jul 2026: the zones are what the expectations below assume (UTC-10, UTC-8/-7, UTC, UTC+3, UTC+5, UTC+13/+12)
const OFFSETS: Record<Code, [number, number]> = { HNL: [600, 600], LAX: [480, 420], UTC: [0, 0], MSK: [-180, -180], KHI: [-300, -300], AKL: [-780, -720] };

type Call = [fn: string, ...args: unknown[]];
// A Date, which JSON cannot carry: an instant, or a moment on the viewer's own clock (local(2026, 10, 12, 15) is 15:00 on 12 Nov in any zone).
const at = (iso: string) => ({ $date: iso });
const local = (...fields: number[]) => ({ $local: fields });

// Runs the calls in a fresh node process whose clock is in `zone`: they go in on stdin as JSON, the answers come out the same way.
const CHILD = [
  'const m = await import(process.argv[1]);',
  "let text = ''; for await (const chunk of process.stdin) text += chunk;",
  "const revive = (key, v) => { if (v && typeof v === 'object') { if ('$date' in v) return new Date(v.$date); if ('$local' in v) return new Date(...v.$local); } return v; };",
  'const calls = JSON.parse(text, revive);',
  'process.stdout.write(JSON.stringify({ offsets: [new Date(2026, 0, 15).getTimezoneOffset(), new Date(2026, 6, 15).getTimezoneOffset()],',
  'results: calls.map(([fn, ...args]) => m[fn](...args)) }));',
].join(' ');

function inZone(zone: string, calls: Call[]): { offsets: [number, number]; results: string[] } {
  const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', CHILD, MODULE], {
    env: { ...process.env, TZ: zone }, input: JSON.stringify(calls), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(run.status, 0, `${zone}: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

type Want = string | Partial<Record<Code, string>>;               // one text for every zone, or a text per zone (a zone left out is not checked)

const NOW = at('2026-11-12T22:30:00Z');                           // 12:30 on 12 Nov in Honolulu, 03:30 on 13 Nov in Karachi
const TODAY = local(2026, 10, 12, 15, 0);                         // 15:00 on 12 Nov, on the viewer's own clock in every zone
const AT_2230 = { HNL: '12 Nov 2026, 12:30', LAX: '12 Nov 2026, 14:30', UTC: '12 Nov 2026, 22:30', MSK: '13 Nov 2026, 01:30', KHI: '13 Nov 2026, 03:30', AKL: '13 Nov 2026, 11:30' };
const SAME_DAY = { HNL: '12 Nov 2026', LAX: '12 Nov 2026', UTC: '12 Nov 2026', MSK: '13 Nov 2026', KHI: '13 Nov 2026', AKL: '13 Nov 2026' };

const TABLE: Array<[Call, Want]> = [
  // a date with no time is that day, in every zone
  [['formatDate', '2026-11-12'], '12 Nov 2026'],
  [['formatDate', ' 2026-11-12 '], '12 Nov 2026'],
  [['formatDateTime', '2026-11-12'], '12 Nov 2026'],                                  // and has no clock to show
  [['formatDate', '2026-12-31'], '31 Dec 2026'],
  [['formatDate', '2027-01-01'], '1 Jan 2027'],
  [['formatDate', '2028-02-29'], '29 Feb 2028'],                                      // leap day
  [['formatDateTime', '2028-02-29'], '29 Feb 2028'],

  // a moment is the viewer's own day: 22:30 UTC is still the 12th west of Greenwich and already the 13th east of it
  [['formatDate', '2026-11-12T22:30:00'], SAME_DAY],
  [['formatDate', '2026-11-12T22:30:00Z'], SAME_DAY],
  [['formatDateTime', '2026-11-12T22:30:00'], AT_2230],
  [['formatDateTime', '2026-11-12T22:30:00Z'], AT_2230],
  [['formatDateTime', '2026-11-12T22:30'], AT_2230],                                  // no seconds
  [['formatDateTime', '2026-11-12 22:30:00'], AT_2230],                               // a space instead of the T
  [['formatDateTime', '2026-11-12T22:30:00.123456'], AT_2230],                        // microseconds
  [['formatDateTime', Date.UTC(2026, 10, 12, 22, 30)], AT_2230],                      // an epoch in milliseconds
  [['formatDateTime', NOW], AT_2230],                                                 // a Date
  [['formatDateTime', '2026-11-12T22:30:00+05:00'], {                                 // a time that names its own zone is left as it is: 17:30 UTC
    HNL: '12 Nov 2026, 07:30', LAX: '12 Nov 2026, 09:30', UTC: '12 Nov 2026, 17:30', MSK: '12 Nov 2026, 20:30', KHI: '12 Nov 2026, 22:30', AKL: '13 Nov 2026, 06:30',
  }],

  // the clock is 24-hour, to the minute (seconds are dropped, not rounded)
  [['formatDateTime', '2026-11-12T00:05:00'], { UTC: '12 Nov 2026, 00:05' }],
  [['formatDateTime', '2026-11-12T12:00:00'], { UTC: '12 Nov 2026, 12:00' }],
  [['formatDateTime', '2026-11-12T09:07:59'], { UTC: '12 Nov 2026, 09:07' }],
  [['formatDateTime', '2026-11-12T23:59:59'], { UTC: '12 Nov 2026, 23:59' }],

  // year boundary: 23:30 UTC on New Year's Eve is already 2027 in Moscow, Karachi and Auckland
  [['formatDate', '2026-12-31T23:30:00'], { HNL: '31 Dec 2026', LAX: '31 Dec 2026', UTC: '31 Dec 2026', MSK: '1 Jan 2027', KHI: '1 Jan 2027', AKL: '1 Jan 2027' }],
  [['formatDateTime', '2026-12-31T23:30:00'], {
    HNL: '31 Dec 2026, 13:30', LAX: '31 Dec 2026, 15:30', UTC: '31 Dec 2026, 23:30', MSK: '1 Jan 2027, 02:30', KHI: '1 Jan 2027, 04:30', AKL: '1 Jan 2027, 12:30',
  }],

  // leap day: a moment that is the 29th only east of UTC, and one that has already left it
  [['formatDate', '2028-02-28T20:00:00'], { HNL: '28 Feb 2028', LAX: '28 Feb 2028', UTC: '28 Feb 2028', MSK: '28 Feb 2028', KHI: '29 Feb 2028', AKL: '29 Feb 2028' }],
  [['formatDate', '2028-02-29T23:30:00'], { HNL: '29 Feb 2028', LAX: '29 Feb 2028', UTC: '29 Feb 2028', MSK: '1 Mar 2028', KHI: '1 Mar 2028', AKL: '1 Mar 2028' }],
  [['formatDateTime', '2028-02-29T23:30:00'], {
    HNL: '29 Feb 2028, 13:30', LAX: '29 Feb 2028, 15:30', UTC: '29 Feb 2028, 23:30', MSK: '1 Mar 2028, 02:30', KHI: '1 Mar 2028, 04:30', AKL: '1 Mar 2028, 12:30',
  }],

  // US clocks go forward on 8 Mar 2026 at 10:00 UTC (02:00 -> 03:00 in Los Angeles) and back on 1 Nov at 09:00 UTC
  [['formatDateTime', '2026-03-08T09:59:00'], { LAX: '8 Mar 2026, 01:59' }],
  [['formatDateTime', '2026-03-08T10:00:00'], { LAX: '8 Mar 2026, 03:00' }],          // there is no 02:xx that day
  [['formatDateTime', '2026-03-08T10:30:00'], {
    HNL: '8 Mar 2026, 00:30', LAX: '8 Mar 2026, 03:30', UTC: '8 Mar 2026, 10:30', MSK: '8 Mar 2026, 13:30', KHI: '8 Mar 2026, 15:30', AKL: '8 Mar 2026, 23:30',
  }],
  [['formatDate', '2026-03-09T06:59:00'], { HNL: '8 Mar 2026', LAX: '8 Mar 2026', UTC: '9 Mar 2026', MSK: '9 Mar 2026', KHI: '9 Mar 2026', AKL: '9 Mar 2026' }],
  [['formatDate', '2026-03-09T07:00:00'], { HNL: '8 Mar 2026', LAX: '9 Mar 2026', UTC: '9 Mar 2026', MSK: '9 Mar 2026', KHI: '9 Mar 2026', AKL: '9 Mar 2026' }],   // midnight PDT, not 23:00 PST
  [['formatDateTime', '2026-11-01T08:30:00'], { LAX: '1 Nov 2026, 01:30' }],          // 01:30 PDT ...
  [['formatDateTime', '2026-11-01T09:30:00'], { LAX: '1 Nov 2026, 01:30' }],          // ... and an hour later 01:30 PST
  [['formatDateTime', '2026-09-26T13:59:00'], { AKL: '27 Sep 2026, 01:59' }],         // New Zealand goes forward at 14:00 UTC on 26 Sep (02:00 -> 03:00)
  [['formatDateTime', '2026-09-26T14:00:00'], { AKL: '27 Sep 2026, 03:00' }],

  // "today" and "in N days" count calendar days of the viewer's own calendar, so the same instant is a different day on either side of midnight
  [['formatRelative', '2026-11-13', NOW], { HNL: 'in 1 day', LAX: 'in 1 day', UTC: 'in 1 day', MSK: 'today', KHI: 'today', AKL: 'today' }],
  [['formatRelative', '2026-11-12', NOW], { HNL: 'today', LAX: 'today', UTC: 'today', MSK: '1 day ago', KHI: '1 day ago', AKL: '1 day ago' }],
  [['formatRelative', '2026-11-19', NOW], { HNL: 'in 7 days', LAX: 'in 7 days', UTC: 'in 7 days', MSK: 'in 6 days', KHI: 'in 6 days', AKL: 'in 6 days' }],
  [['formatRelative', '2026-11-12T22:30:00', NOW], 'today'],                          // the moment itself is today wherever you are
  [['formatRelative', '2026-11-13T01:00:00', NOW], { HNL: 'today', LAX: 'today', UTC: 'in 1 day', MSK: 'today', KHI: 'today', AKL: 'today' }],
  [['formatRelative', '2026-03-09', at('2026-03-07T20:00:00Z')], { LAX: 'in 2 days' }],      // across the spring change: still 2 calendar days
  [['formatRelative', '2026-11-02', at('2026-10-31T19:00:00Z')], { LAX: 'in 2 days' }],      // and across the autumn one
  [['formatRelative', '2026-03-08', at('2026-03-08T08:30:00Z')], { LAX: 'today' }],

  // `calendar`: a field that means a DAY but arrives as a DateTime ("...T00:00:00") is the day as written, in every zone, with no clock
  [['formatDate', '2026-11-12T00:00:00', { calendar: true }], '12 Nov 2026'],
  [['formatDate', '2026-11-12T23:59:59', { calendar: true }], '12 Nov 2026'],
  [['formatDateTime', '2026-11-12T00:00:00', { calendar: true }], '12 Nov 2026'],
  [['formatDateTime', '2026-11-12T23:59:59', { calendar: true }], '12 Nov 2026'],
  [['formatDate', '2026-11-12T00:00:00Z', { calendar: true }], '12 Nov 2026'],
  [['formatDate', '2026-11-12 00:00:00', { calendar: true }], '12 Nov 2026'],
  [['formatDate', '2026-11-12T00:00:00.000000', { calendar: true }], '12 Nov 2026'],
  [['formatDate', '2026-11-12T23:59:59+05:00', { calendar: true }], '12 Nov 2026'],         // a zone after the time does not move it either ...
  [['formatDate', '2026-11-12T00:00:00+05:00', { calendar: true }], '12 Nov 2026'],         // ... this is 19:00 UTC on the 11th, and still the 12th as written
  [['formatDate', '2026-11-12T00:00:00-08:00', { calendar: true }], '12 Nov 2026'],
  [['formatDate', ' 2026-11-12T00:00:00 ', { calendar: true }], '12 Nov 2026'],
  [['formatDate', '2026-11-12', { calendar: true }], '12 Nov 2026'],                         // a date with no time is the same either way
  [['formatDate', '2026-12-31T23:59:59', { calendar: true }], '31 Dec 2026'],               // year boundary: never 1 Jan 2027 ...
  [['formatDate', '2027-01-01T00:00:00', { calendar: true }], '1 Jan 2027'],                // ... and never 31 Dec 2026
  [['formatDate', '2028-02-29T00:00:00', { calendar: true }], '29 Feb 2028'],               // leap day
  [['formatDate', at('2026-11-12T00:00:00Z'), { calendar: true }], '12 Nov 2026'],          // a Date has no written date: its UTC fields are the day ...
  [['formatDate', at('2026-11-12T23:59:59Z'), { calendar: true }], '12 Nov 2026'],
  [['formatDate', Date.UTC(2026, 10, 12, 23, 59), { calendar: true }], '12 Nov 2026'],      // ... and so are an epoch's
  // the same strings without the flag are moments, as before: midnight UTC is still the day before west of Greenwich
  [['formatDate', '2026-11-12T00:00:00'], { HNL: '11 Nov 2026', LAX: '11 Nov 2026', UTC: '12 Nov 2026', MSK: '12 Nov 2026', KHI: '12 Nov 2026', AKL: '12 Nov 2026' }],
  [['formatDate', '2026-11-12T00:00:00', { calendar: false }], { HNL: '11 Nov 2026', LAX: '11 Nov 2026', UTC: '12 Nov 2026', MSK: '12 Nov 2026', KHI: '12 Nov 2026', AKL: '12 Nov 2026' }],
  [['formatDate', '2026-11-12T23:59:59'], { HNL: '12 Nov 2026', LAX: '12 Nov 2026', UTC: '12 Nov 2026', MSK: '13 Nov 2026', KHI: '13 Nov 2026', AKL: '13 Nov 2026' }],
  [['formatDateTime', '2026-11-12T00:00:00'], {
    HNL: '11 Nov 2026, 14:00', LAX: '11 Nov 2026, 16:00', UTC: '12 Nov 2026, 00:00', MSK: '12 Nov 2026, 03:00', KHI: '12 Nov 2026, 05:00', AKL: '12 Nov 2026, 13:00',
  }],
  [['formatDateTime', '2026-11-12T23:59:59'], {
    HNL: '12 Nov 2026, 13:59', LAX: '12 Nov 2026, 15:59', UTC: '12 Nov 2026, 23:59', MSK: '13 Nov 2026, 02:59', KHI: '13 Nov 2026, 04:59', AKL: '13 Nov 2026, 12:59',
  }],
  // with `calendar` the days are counted the same in every zone when "today" is the same day on the viewer's clock
  [['formatRelative', '2026-11-12T00:00:00', TODAY, { calendar: true }], 'today'],
  [['formatRelative', '2026-11-12T23:59:59', TODAY, { calendar: true }], 'today'],
  [['formatRelative', '2026-11-13T00:00:00', TODAY, { calendar: true }], 'in 1 day'],
  [['formatRelative', '2026-11-21T00:00:00', TODAY, { calendar: true }], 'in 9 days'],
  [['formatRelative', '2026-11-21T23:59:59', TODAY, { calendar: true }], 'in 9 days'],
  [['formatRelative', '2026-11-21T00:00:00-08:00', TODAY, { calendar: true }], 'in 9 days'],
  [['formatRelative', '2026-11-21', TODAY, { calendar: true }], 'in 9 days'],
  [['formatRelative', '2026-11-03T23:59:59', TODAY, { calendar: true }], '9 days ago'],
  [['formatRelative', at('2026-11-21T00:00:00Z'), TODAY, { calendar: true }], 'in 9 days'],
  [['formatRelative', '2026-03-09T00:00:00', local(2026, 2, 7, 12, 0), { calendar: true }], 'in 2 days'],     // across the US spring change
  // without it the same strings are moments: midnight UTC on the 12th is still the 11th in Honolulu and Los Angeles
  [['formatRelative', '2026-11-12T00:00:00', TODAY], { HNL: '1 day ago', LAX: '1 day ago', UTC: 'today', MSK: 'today', KHI: 'today', AKL: 'today' }],
  [['formatRelative', '2026-11-21T00:00:00', TODAY], { HNL: 'in 8 days', LAX: 'in 8 days', UTC: 'in 9 days', MSK: 'in 9 days', KHI: 'in 9 days', AKL: 'in 9 days' }],
  // `today` stays the viewer's own: 22:30 UTC on the 12th is already the 13th in Moscow, Karachi and Auckland
  [['formatRelative', '2026-11-12T00:00:00', NOW, { calendar: true }], { HNL: 'today', LAX: 'today', UTC: 'today', MSK: '1 day ago', KHI: '1 day ago', AKL: '1 day ago' }],
];

test('what a date says in six time zones: a date with no time never moves, a moment is the viewer\'s own day and clock, a calendar day is the one written', () => {
  const wrong: string[] = [];
  for (const code of CODES) {
    const { offsets, results } = inZone(ZONES[code], TABLE.map(([call]) => call));
    assert.deepEqual(offsets, OFFSETS[code], `${ZONES[code]} is not the zone the expectations assume`);
    TABLE.forEach(([call, want], i) => {
      const expected = typeof want === 'string' ? want : want[code];
      if (expected !== undefined && results[i] !== expected) wrong.push(`${code} ${JSON.stringify(call)}: got "${results[i]}", want "${expected}"`);
    });
  }
  assert.deepEqual(wrong, []);
});

// Every clock time against Intl, which is given the zone by name rather than through TZ: a fixed offset, a wrong month or a missed clock change shows up.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const INTL = Object.fromEntries(CODES.map((code): [Code, Intl.DateTimeFormat] => [
  code, new Intl.DateTimeFormat('en-GB', { timeZone: ZONES[code], year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
])) as Record<Code, Intl.DateTimeFormat>;
function intlSays(code: Code, ms: number): string {
  const parts = Object.fromEntries(INTL[code].formatToParts(new Date(ms)).map((p): [string, string] => [p.type, p.value]));
  return `${Number(parts.day)} ${MONTH_NAMES[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

const INSTANTS: number[] = [];
for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2029, 0, 1); t += 6 * 3_600_000 + 53 * 60_000) INSTANTS.push(t);          // every 6 h 53 min for three years
const CLOCK_CHANGES = [                                                                                                      // US: 2nd Sunday of March 10:00 UTC, 1st Sunday of November 09:00 UTC
  '2026-03-08T10:00', '2026-11-01T09:00', '2027-03-14T10:00', '2027-11-07T09:00', '2028-03-12T10:00', '2028-11-05T09:00',     // New Zealand: 1st Sunday of April and last of September, 14:00 UTC the day before
  '2026-04-04T14:00', '2026-09-26T14:00', '2027-04-03T14:00', '2027-09-25T14:00', '2028-04-01T14:00', '2028-09-23T14:00',
];
for (const change of CLOCK_CHANGES) INSTANTS.push(Date.parse(`${change}:00Z`) - 60_000, Date.parse(`${change}:00Z`), Date.parse(`${change}:00Z`) + 60_000);

test('every clock time agrees with Intl in each zone, a minute either side of every clock change included', () => {
  const stored = INSTANTS.map((ms) => new Date(ms).toISOString().slice(0, 19));                                             // the server's naive UTC
  for (const code of CODES) {
    const { offsets, results } = inZone(ZONES[code], stored.map((iso): Call => ['formatDateTime', iso]));
    assert.deepEqual(offsets, OFFSETS[code], `${ZONES[code]} is not the zone the expectations assume`);
    const wrong = results.flatMap((got, i) => (got === intlSays(code, INSTANTS[i]) ? [] : [`${code} ${stored[i]}: got "${got}", Intl says "${intlSays(code, INSTANTS[i])}"`]));
    assert.deepEqual(wrong.slice(0, 10), []);
  }
});
