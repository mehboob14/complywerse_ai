// Run from this folder: node --test docDates.test.ts
// What a date says depends on the viewer's time zone, so the zone-dependent checks run in child processes started with TZ set:
// UTC+5 (Karachi), UTC-8 (Los Angeles, standard time in November) and UTC+13 (Auckland, daylight time in November).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { calendarDay, clock, dateTime, day } from './docDates.ts';

test('nothing stored reads as the dash, never as a hyphen or "Invalid Date"', () => {
  for (const none of [null, undefined, '', '  ', 'not a date']) {
    assert.equal(day(none), '—', String(none));
    assert.equal(dateTime(none), '—', String(none));
    assert.equal(calendarDay(none), '—', String(none));
    assert.equal(clock(none), '', String(none));
  }
  assert.equal(calendarDay(null, 'Not scheduled'), 'Not scheduled');             // the caller can say its own word for a value the person can set
});

test('a plain date is that day in every language: day month-name year, no leading zero', () => {
  assert.equal(day('2026-11-08'), '8 Nov 2026');
  assert.equal(calendarDay('2026-11-08'), '8 Nov 2026');
  assert.equal(dateTime('2026-11-08'), '8 Nov 2026');                              // no time to show
  assert.equal(clock('2026-11-08'), '');
});

const ZONES: Array<[string, string]> = [['Asia/Karachi', 'UTC+5'], ['America/Los_Angeles', 'UTC-8'], ['Pacific/Auckland', 'UTC+13']];

function inZone(tz: string, expression: string): string {
  const code = `import('./docDates.ts').then((d) => { const { day, dateTime, calendarDay, clock } = d; process.stdout.write(JSON.stringify(${expression})); })`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: new URL('.', import.meta.url), env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim().split('\n').pop() as string;
}

test('a next review that arrives as a DateTime is the same day in every zone (calendarDay); a moment is the viewer\'s own day', () => {
  const stored = '2026-11-12T00:00:00';                                              // naive UTC midnight, as the server writes the review date
  for (const [tz, label] of ZONES) {
    assert.equal(JSON.parse(inZone(tz, `calendarDay('${stored}')`)), '12 Nov 2026', `${label}: the review date is the 12th`);
  }
  // as a MOMENT the same text is 05:00 in Karachi, 16:00 the day before in Los Angeles, 13:00 in Auckland: the reason calendarDay exists
  assert.equal(JSON.parse(inZone('Asia/Karachi', `day('${stored}')`)), '12 Nov 2026');
  assert.equal(JSON.parse(inZone('America/Los_Angeles', `day('${stored}')`)), '11 Nov 2026');
  assert.equal(JSON.parse(inZone('Pacific/Auckland', `day('${stored}')`)), '12 Nov 2026');
});

test('a moment shows the viewer\'s own day and a 24-hour clock', () => {
  const stored = '2026-11-12T22:30:00';                                              // 22:30 UTC
  assert.deepEqual(JSON.parse(inZone('Asia/Karachi', `[day('${stored}'), dateTime('${stored}'), clock('${stored}')]`)), ['13 Nov 2026', '13 Nov 2026, 03:30', '03:30']);
  assert.deepEqual(JSON.parse(inZone('America/Los_Angeles', `[day('${stored}'), dateTime('${stored}'), clock('${stored}')]`)), ['12 Nov 2026', '12 Nov 2026, 14:30', '14:30']);
  assert.deepEqual(JSON.parse(inZone('Pacific/Auckland', `[day('${stored}'), dateTime('${stored}'), clock('${stored}')]`)), ['13 Nov 2026', '13 Nov 2026, 11:30', '11:30']);
});

test('a moment without a zone is UTC, one that names its zone is left as it is (parseUtc)', () => {
  assert.equal(JSON.parse(inZone('Asia/Karachi', `dateTime('2026-11-12T22:30:00Z')`)), '13 Nov 2026, 03:30');
  assert.equal(JSON.parse(inZone('Asia/Karachi', `dateTime('2026-11-12T22:30:00+00:00')`)), '13 Nov 2026, 03:30');
  assert.equal(JSON.parse(inZone('Asia/Karachi', `dateTime('2026-11-12T22:30:00+05:00')`)), '12 Nov 2026, 22:30');
});
