// node --test "src/app/(dashboard)/governance/reviews/calendarModel.test.ts"
// The review calendar's days, months and due rules. What a calendar says depends on the viewer's time zone only where it reads their clock, so the
// rules that must NOT depend on it run in child processes started with TZ set to six zones (Karachi, UTC, Moscow, Los Angeles, Auckland and
// Kiritimati, which is UTC+14), around month ends, a leap day, clock changes and midnight. The old calendar's way of keying a day is replayed in those
// zones too: it is the reported date shift, and east of Greenwich it was wrong on every cell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  WEEKDAYS, addDays, addMonths, addMonthsToDay, agendaOf, bucketByDay, dayKey, dayLabel, dayNumber, dayOf, daysInMonth, diffDays, dueState, dueWords, moveDay, monthGrid,
  monthKey, monthLabel, monthOf, parseDay, parseMonth, reviewsWord, sameMonth, weekdayOf,
} from './calendarModel.ts';

// ── days that do not depend on the zone ──────────────────────────────────────
test('daysInMonth: 28 to 31, February by the leap rule (a century year is not a leap year unless it divides by 400)', () => {
  assert.deepEqual(Array.from({ length: 12 }, (_, i) => daysInMonth(2026, i + 1)), [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
});

test('parseDay: a real day or nothing (V8 would roll "2027-02-29" into March)', () => {
  assert.deepEqual(parseDay('2026-11-12'), { year: 2026, month: 11, day: 12 });
  assert.deepEqual(parseDay('2028-02-29'), { year: 2028, month: 2, day: 29 });
  for (const bad of ['2027-02-29', '2026-13-01', '2026-00-10', '2026-11-00', '2026-04-31', '2026-11-12T00:00:00', '2026-1-12', '12 Nov 2026', '', null, undefined]) {
    assert.equal(parseDay(bad), null, String(bad));
  }
});

test('dayOf: the day AS WRITTEN, with or without a time, a zone or microseconds', () => {
  for (const value of ['2026-11-12', '2026-11-12T00:00:00', '2026-11-12T23:59:59', '2026-11-12T00:00:00.000000', '2026-11-12T14:05:00.123456', '2026-11-12 08:30:00', ' 2026-11-12T00:00:00 ',
    '2026-11-12T00:00:00Z', '2026-11-12T00:00:00+05:00', '2026-11-12T23:59:59-08:00']) {
    assert.equal(dayOf(value), '2026-11-12', value);
  }
  assert.equal(dayOf('2028-02-29T00:00:00'), '2028-02-29');
  assert.equal(dayOf('2026-12-31T23:59:59'), '2026-12-31');
  assert.equal(dayOf('2027-01-01T00:00:00'), '2027-01-01');
  for (const bad of [null, undefined, '', '   ', 'soon', '2026-02-30T00:00:00', '2027-02-29', '20261112', '2026-11-12junk', 'T00:00:00', '12/11/2026', 12, {}] as unknown[]) {
    assert.equal(dayOf(bad as string), null, String(bad));
  }
});

test('day arithmetic is on the calendar: month ends, a leap day, year ends, no clock in it', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2026-11-12', 0), '2026-11-12');
  assert.equal(addDays('2026-11-12', -378), '2025-10-30');       // 365 days back is 12 Nov 2025, 13 more is 30 Oct
  assert.equal(diffDays('2026-11-12', '2026-11-15'), 3);
  assert.equal(diffDays('2026-11-15', '2026-11-12'), -3);
  assert.equal(diffDays('2026-02-28', '2026-03-01'), 1);
  assert.equal(diffDays('2028-02-28', '2028-03-01'), 2);
  assert.equal(diffDays('2026-12-31', '2027-01-01'), 1);
  assert.equal(dayNumber('1970-01-01'), 0);
  assert.equal(dayNumber('1970-01-02'), 1);
  assert.throws(() => addDays('2026-02-30', 1));
});

test('weekdayOf: 0 is Sunday', () => {
  assert.equal(weekdayOf('2026-11-01'), 0);
  assert.equal(weekdayOf('2026-11-12'), 4);                         // a Thursday
  assert.equal(weekdayOf('2028-02-29'), 2);                         // a Tuesday
  assert.equal(weekdayOf('2026-10-31'), 6);
  assert.deepEqual(WEEKDAYS.map((d) => d.short), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
});

test('months: across a year end, the same day clamped to a shorter month, and the address form', () => {
  assert.deepEqual(addMonths({ year: 2026, month: 11 }, 1), { year: 2026, month: 12 });
  assert.deepEqual(addMonths({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(addMonths({ year: 2027, month: 1 }, -1), { year: 2026, month: 12 });
  assert.deepEqual(addMonths({ year: 2026, month: 1 }, -13), { year: 2024, month: 12 });
  assert.deepEqual(addMonths({ year: 2026, month: 11 }, 0), { year: 2026, month: 11 });
  assert.deepEqual(addMonths({ year: 2026, month: 3 }, 24), { year: 2028, month: 3 });
  assert.equal(addMonthsToDay('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsToDay('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonthsToDay('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonthsToDay('2028-02-29', 12), '2029-02-28');
  assert.equal(addMonthsToDay('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonthsToDay('2026-11-30', 3), '2027-02-28');
  assert.equal(monthKey({ year: 2026, month: 3 }), '2026-03');
  assert.deepEqual(parseMonth('2026-11'), { year: 2026, month: 11 });
  for (const bad of ['2026-13', '2026-00', '2026-1', '2026', '2026-11-12', 'Nov 2026', '', null, undefined, '0000-01', '9999-12']) assert.equal(parseMonth(bad), null, String(bad));
  assert.equal(monthLabel({ year: 2026, month: 11 }), 'November 2026');
  assert.deepEqual(monthOf('2026-11-12'), { year: 2026, month: 11 });
  assert.equal(sameMonth({ year: 2026, month: 11 }, { year: 2026, month: 11 }), true);
  assert.equal(sameMonth({ year: 2026, month: 11 }, { year: 2027, month: 11 }), false);
});

test('monthGrid: six weeks of seven, Sunday first, the days around the month there to complete the weeks', () => {
  const nov = monthGrid({ year: 2026, month: 11 });                 // 1 Nov 2026 is a Sunday: no days before it
  assert.equal(nov.length, 42);
  assert.equal(nov[0].key, '2026-11-01');
  assert.equal(nov[29].key, '2026-11-30');
  assert.equal(nov[41].key, '2026-12-12');
  assert.equal(nov.filter((c) => c.inMonth).length, 30);
  const feb = monthGrid({ year: 2028, month: 2 });                  // 1 Feb 2028 is a Tuesday and 2028 is a leap year
  assert.equal(feb[0].key, '2028-01-30');
  assert.equal(feb[2].key, '2028-02-01');
  assert.equal(feb.filter((c) => c.inMonth).length, 29);
  assert.equal(feb.find((c) => c.key === '2028-02-29')?.inMonth, true);
  assert.equal(feb[41].key, '2028-03-11');
  const jan = monthGrid({ year: 2027, month: 1 });                  // starts on a Friday: the grid begins in December
  assert.equal(jan[0].key, '2026-12-27');
  assert.equal(jan[5].key, '2027-01-01');
  assert.equal(jan[5].weekday, 5);
  const short = monthGrid({ year: 2026, month: 2 });                // 1 Feb 2026 is a Sunday and has 28 days: four full weeks, then the next month fills two more
  assert.equal(short[0].key, '2026-02-01');
  assert.equal(short[27].key, '2026-02-28');
  assert.equal(short[28].inMonth, false);
  for (const grid of [nov, feb, jan, short]) {
    grid.forEach((cell, i) => {
      assert.equal(cell.weekday, i % 7, `${cell.key} sits in the column of its weekday`);
      if (i > 0) assert.equal(diffDays(grid[i - 1].key, cell.key), 1, `${cell.key} follows the cell before it`);
      assert.deepEqual([cell.year, cell.month, cell.day], [Number(cell.key.slice(0, 4)), Number(cell.key.slice(5, 7)), Number(cell.key.slice(8))]);
    });
  }
});

test('every month of 2026, 2027 and 2028 has a grid that holds exactly the days of the month, once, in order', () => {
  for (const year of [2026, 2027, 2028]) {
    for (let month = 1; month <= 12; month++) {
      const inMonth = monthGrid({ year, month }).filter((c) => c.inMonth).map((c) => c.key);
      assert.deepEqual(inMonth, Array.from({ length: daysInMonth(year, month) }, (_, i) => dayKey(year, month, i + 1)), `${year}-${month}`);
    }
  }
});

test('bucketByDay: reviews on the day they are written for; none, no date and a broken date are on no day; 12 on one day stay 12', () => {
  const doc = (id: number, d: string | null, title = `Doc ${id}`) => ({ id, d, title });
  const twelve = Array.from({ length: 12 }, (_, i) => doc(i + 1, '2026-11-12T00:00:00', `Review ${String.fromCharCode(76 - i)}`));
  const items = [...twelve, doc(20, '2026-11-13T23:59:59'), doc(21, null), doc(22, 'soon'), doc(23, '2026-02-30T00:00:00'), doc(24, '2026-11-12T14:05:00.5')];
  const days = bucketByDay(items, (i) => i.d);
  assert.deepEqual(Array.from(days.keys()), ['2026-11-12', '2026-11-13']);
  assert.equal(days.get('2026-11-12')?.length, 13);                 // 12 at midnight and one with a time of day: the same day
  assert.deepEqual(days.get('2026-11-12')?.map((i) => i.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24]);   // the order given
  assert.equal(days.get('2026-11-13')?.length, 1);
  const byTitle = bucketByDay(items, (i) => i.d, (a, b) => a.title.localeCompare(b.title));
  assert.deepEqual(byTitle.get('2026-11-12')?.map((i) => i.title).slice(0, 3), ['Doc 24', 'Review A', 'Review B']);
  assert.equal(bucketByDay([], (i: { d: string }) => i.d).size, 0);
  assert.deepEqual(agendaOf(days).map((d) => [d.key, d.items.length]), [['2026-11-12', 13], ['2026-11-13', 1]]);
  assert.deepEqual(agendaOf(new Map([['2027-01-01', [1]], ['2026-12-31', [2, 3]]])).map((d) => d.key), ['2026-12-31', '2027-01-01']);    // earliest first
});

test('dueState is the server\'s rule on instants: before now is overdue (the day it is due counts), under eight whole days away is due soon', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  const table: Array<[string | null, string | null]> = [
    ['2026-11-11', 'overdue'],
    ['2026-11-11T23:59:59', 'overdue'],
    ['2026-11-12T00:00:00', 'overdue'],                             // its day has begun in UTC: the lists and the statistics count it overdue too
    ['2026-11-12T09:59:59', 'overdue'],
    ['2026-11-12T10:00:00', 'due_soon'],                            // not before now
    ['2026-11-13T00:00:00', 'due_soon'],
    ['2026-11-19T09:59:59', 'due_soon'],
    ['2026-11-19T10:00:01', 'due_soon'],                            // 7 days and a second away: days_until_review is 7
    ['2026-11-20T09:59:59', 'due_soon'],                            // 7 days and 23:59:59 away: still 7
    ['2026-11-20T10:00:00', 'on_track'],                            // 8 days away
    ['2027-03-01', 'on_track'],
    [null, null],
    ['', null],
    ['not a date', null],
  ];
  for (const [value, want] of table) assert.equal(dueState(value, now), want, String(value));
  assert.equal(dueState(undefined, now), null);
});

test('dueWords: calendar days from the viewer\'s today; an overdue review on its due day is "Due today", never "1 day late"', () => {
  const today = '2026-11-12';
  assert.equal(dueWords('2026-11-12', today, 'overdue'), 'Due today');
  assert.equal(dueWords('2026-11-11', today, 'overdue'), '1 day late');
  assert.equal(dueWords('2026-08-02', today, 'overdue'), '102 days late');
  assert.equal(dueWords('2026-11-13', today, 'overdue'), 'Due today');         // the platform counts it overdue already (west of UTC the viewer's day is behind)
  assert.equal(dueWords('2026-11-12', today, 'due_soon'), 'Due today');
  assert.equal(dueWords('2026-11-13', today, 'due_soon'), 'Due tomorrow');
  assert.equal(dueWords('2026-11-19', today, 'due_soon'), 'In 7 days');
  assert.equal(dueWords('2027-01-01', today, 'on_track'), 'In 50 days');
  assert.equal(dueWords('2026-11-11', today, 'due_soon'), 'Due today');         // not overdue yet by the clock, a day behind by the viewer's calendar
  assert.equal(dueWords(null, today, 'overdue'), '');
  assert.equal(dueWords('2026-11-12', today, null), '');
  assert.equal(dueWords('2027-02-28', '2026-02-28', 'on_track'), 'In 365 days');
});

test('the words a day\'s button says', () => {
  assert.equal(reviewsWord(0), 'no reviews');
  assert.equal(reviewsWord(1), '1 review');
  assert.equal(reviewsWord(12), '12 reviews');
  assert.equal(dayLabel('2026-11-12', 3), '12 Nov 2026, 3 reviews');
  assert.equal(dayLabel('2026-11-12', 3, { overdue: 2 }), '12 Nov 2026, 3 reviews, 2 overdue');
  assert.equal(dayLabel('2026-11-12', 1, { today: true }), '12 Nov 2026, 1 review, today');
  assert.equal(dayLabel('2026-11-13', 0), '13 Nov 2026, no reviews');
  assert.equal(dayLabel('2028-02-29', 12, { overdue: 12, today: true }), '29 Feb 2028, 12 reviews, 12 overdue, today');
});

test('moveDay: arrows by a day or a week, Home and End to the ends of the week, PageUp and PageDown by a month; any other key is null', () => {
  assert.equal(moveDay('2026-11-12', 'ArrowLeft'), '2026-11-11');
  assert.equal(moveDay('2026-11-12', 'ArrowRight'), '2026-11-13');
  assert.equal(moveDay('2026-11-12', 'ArrowUp'), '2026-11-05');
  assert.equal(moveDay('2026-11-12', 'ArrowDown'), '2026-11-19');
  assert.equal(moveDay('2026-11-12', 'Home'), '2026-11-08');                    // the Sunday of that week
  assert.equal(moveDay('2026-11-12', 'End'), '2026-11-14');                     // the Saturday
  assert.equal(moveDay('2026-11-08', 'Home'), '2026-11-08');
  assert.equal(moveDay('2026-11-14', 'End'), '2026-11-14');
  assert.equal(moveDay('2026-11-14', 'Home'), '2026-11-08');
  assert.equal(moveDay('2026-11-08', 'End'), '2026-11-14');
  assert.equal(moveDay('2026-11-30', 'ArrowRight'), '2026-12-01');             // across a month end
  assert.equal(moveDay('2026-12-31', 'ArrowRight'), '2027-01-01');             // and a year end
  assert.equal(moveDay('2026-03-31', 'PageUp'), '2026-02-28');
  assert.equal(moveDay('2026-01-31', 'PageDown'), '2026-02-28');
  assert.equal(moveDay('2026-12-15', 'PageDown'), '2027-01-15');
  assert.equal(moveDay('2028-01-31', 'PageDown'), '2028-02-29');
  for (const other of ['Enter', ' ', 'a', 'Tab', 'Escape', 'Shift']) assert.equal(moveDay('2026-11-12', other), null, other);
});

// ── the same rules in six time zones ─────────────────────────────────────────
const MODULE = new URL('./calendarModel.ts', import.meta.url).href;
const ZONES = {
  KHI: 'Asia/Karachi', UTC: 'UTC', MSK: 'Europe/Moscow', LAX: 'America/Los_Angeles', AKL: 'Pacific/Auckland', KIR: 'Pacific/Kiritimati',
} as const;
type Code = keyof typeof ZONES;
const CODES = Object.keys(ZONES) as Code[];
// getTimezoneOffset() on 15 Jan and 15 Jul 2026, so the zones are what the expectations assume: UTC+5, UTC, UTC+3, UTC-8/-7, UTC+13/+12, UTC+14
const OFFSETS: Record<Code, [number, number]> = { KHI: [-300, -300], UTC: [0, 0], MSK: [-180, -180], LAX: [480, 420], AKL: [-780, -720], KIR: [-840, -840] };

type Call = [fn: string, ...args: unknown[]];
const at = (iso: string) => ({ $date: iso });
const local = (...fields: number[]) => ({ $local: fields });          // a moment on the viewer's own clock: local(2026, 10, 12, 15) is 15:00 on 12 Nov in any zone

// The old calendar's key for a cell: a local midnight turned into UTC. Replayed here, in the zones, to show the shift it caused.
const CHILD = [
  'const m = await import(process.argv[1]);',
  "let text = ''; for await (const chunk of process.stdin) text += chunk;",
  "const revive = (key, v) => { if (v && typeof v === 'object') { if ('$date' in v) return new Date(v.$date); if ('$local' in v) return new Date(...v.$local); } return v; };",
  'const calls = JSON.parse(text, revive);',
  'const helpers = {',
  "  legacyKey: (y, mi, d) => new Date(y, mi, d).toISOString().split('T')[0],",
  '  gridKeys: (year, month) => m.monthGrid({ year, month }).map((c) => c.key),',
  '  bucketCounts: (dates) => Array.from(m.bucketByDay(dates, (d) => d)).map(([k, v]) => [k, v.length]),',
  '  month: (d) => m.monthOf(m.todayKey(d)),',
  '};',
  'process.stdout.write(JSON.stringify({ offsets: [new Date(2026, 0, 15).getTimezoneOffset(), new Date(2026, 6, 15).getTimezoneOffset()],',
  'results: calls.map(([fn, ...args]) => (helpers[fn] || m[fn])(...args)) }));',
].join(' ');

function inZone(zone: string, calls: Call[]): { offsets: [number, number]; results: unknown[] } {
  const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', CHILD, MODULE], {
    env: { ...process.env, TZ: zone }, input: JSON.stringify(calls), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(run.status, 0, `${zone}: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

type Want = unknown | Partial<Record<Code, unknown>>;
const perZone = (want: Want): want is Partial<Record<Code, unknown>> =>
  !!want && typeof want === 'object' && !Array.isArray(want) && Object.keys(want).length > 0 && Object.keys(want).every((k) => k in ZONES);

/** The grid of a month by independent arithmetic (Date.UTC and toISOString: no zone in it), the check the module's own days are held to. */
const expectedGrid = (year: number, month: number): string[] => {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(year, month - 1, 1 - lead + i)).toISOString().slice(0, 10));
};

const NOW = at('2026-11-12T22:30:00Z');                           // 14:30 on 12 Nov in Los Angeles, 03:30 on 13 Nov in Karachi, 12:30 on 13 Nov in Kiritimati

const TABLE: Array<[Call, Want]> = [
  // a review date is the day as written, in every zone (this is the reported shift: a date turned into a moment and back)
  [['dayOf', '2026-11-12T00:00:00'], '2026-11-12'],
  [['dayOf', '2026-11-12T23:59:59'], '2026-11-12'],
  [['dayOf', '2026-11-12'], '2026-11-12'],
  [['dayOf', '2026-12-31T00:00:00'], '2026-12-31'],
  [['dayOf', '2027-01-01T00:00:00'], '2027-01-01'],
  [['dayOf', '2028-02-29T00:00:00'], '2028-02-29'],
  [['dayOf', '2026-03-08T02:30:00'], '2026-03-08'],                // a time that does not exist in Los Angeles that day (clocks go forward): still the 8th
  [['dayOf', '2026-11-01T01:30:00'], '2026-11-01'],               // a time that happens twice there
  [['dayOf', '2026-09-27T02:30:00'], '2026-09-27'],               // and one that does not exist in Auckland

  // the viewer's own date: the same instant is a different day on either side of midnight
  [['todayKey', NOW], { KHI: '2026-11-13', UTC: '2026-11-12', MSK: '2026-11-13', LAX: '2026-11-12', AKL: '2026-11-13', KIR: '2026-11-13' }],
  [['todayKey', at('2026-11-12T08:30:00Z')], { KHI: '2026-11-12', UTC: '2026-11-12', MSK: '2026-11-12', LAX: '2026-11-12', AKL: '2026-11-12', KIR: '2026-11-12' }],
  [['todayKey', at('2026-11-12T07:59:59Z')], { KHI: '2026-11-12', UTC: '2026-11-12', MSK: '2026-11-12', LAX: '2026-11-11', AKL: '2026-11-12', KIR: '2026-11-12' }],     // 23:59:59 on the 11th in Los Angeles
  [['todayKey', at('2026-11-12T09:59:59Z')], { KHI: '2026-11-12', UTC: '2026-11-12', MSK: '2026-11-12', LAX: '2026-11-12', AKL: '2026-11-12', KIR: '2026-11-12' }],
  [['todayKey', at('2026-11-11T09:59:59Z')], { KHI: '2026-11-11', UTC: '2026-11-11', MSK: '2026-11-11', LAX: '2026-11-11', AKL: '2026-11-11', KIR: '2026-11-11' }],
  [['todayKey', at('2026-11-11T10:00:00Z')], { KHI: '2026-11-11', UTC: '2026-11-11', MSK: '2026-11-11', LAX: '2026-11-11', AKL: '2026-11-11', KIR: '2026-11-12' }],     // midnight in Kiritimati
  [['todayKey', local(2026, 10, 12, 0, 0, 0)], '2026-11-12'],      // midnight on the viewer's own clock is that day wherever they are
  [['todayKey', local(2026, 10, 12, 23, 59, 59)], '2026-11-12'],
  [['todayKey', local(2026, 11, 31, 23, 59)], '2026-12-31'],
  [['todayKey', local(2027, 0, 1, 0, 0)], '2027-01-01'],
  [['todayKey', local(2028, 1, 29, 12, 0)], '2028-02-29'],         // a leap day
  [['todayKey', local(2026, 2, 8, 12, 0)], '2026-03-08'],          // the day clocks go forward in the US
  [['todayKey', local(2026, 10, 1, 12, 0)], '2026-11-01'],         // and back
  [['month', NOW], { KHI: { year: 2026, month: 11 }, LAX: { year: 2026, month: 11 } }],
  [['month', at('2026-10-31T20:00:00Z')], { KHI: { year: 2026, month: 11 }, UTC: { year: 2026, month: 10 }, MSK: { year: 2026, month: 10 }, LAX: { year: 2026, month: 10 }, AKL: { year: 2026, month: 11 }, KIR: { year: 2026, month: 11 } }],   // the month changes at the viewer's midnight

  // the rule for overdue compares two instants, so the viewer's zone cannot change it
  [['dueState', '2026-11-12T00:00:00', at('2026-11-12T10:00:00Z')], 'overdue'],
  [['dueState', '2026-11-12T00:00:00', at('2026-11-11T23:59:59Z')], 'due_soon'],
  [['dueState', '2026-11-13T00:00:00', at('2026-11-12T10:00:00Z')], 'due_soon'],
  [['dueState', '2026-11-20T10:00:00', at('2026-11-12T10:00:00Z')], 'on_track'],
  [['dueState', '2026-02-28T00:00:00', at('2026-11-12T10:00:00Z')], 'overdue'],

  // day arithmetic across the clock changes: a day is a day, whatever its length in hours
  [['addDays', '2026-03-07', 1], '2026-03-08'],
  [['addDays', '2026-03-08', 1], '2026-03-09'],
  [['addDays', '2026-11-01', 1], '2026-11-02'],
  [['addDays', '2026-09-26', 1], '2026-09-27'],
  [['diffDays', '2026-03-07', '2026-03-09'], 2],
  [['diffDays', '2026-10-31', '2026-11-02'], 2],
  [['diffDays', '2026-09-25', '2026-09-28'], 3],
  [['diffDays', '2028-02-28', '2028-03-01'], 2],
  [['weekdayOf', '2026-03-08'], 0],
  [['weekdayOf', '2026-11-01'], 0],
  [['moveDay', '2026-03-08', 'ArrowRight'], '2026-03-09'],
  [['moveDay', '2026-11-01', 'ArrowLeft'], '2026-10-31'],
  [['addMonthsToDay', '2026-01-31', 1], '2026-02-28'],

  // twelve reviews due on one day, and none: the same count in every zone
  [['bucketCounts', Array.from({ length: 12 }, () => '2026-11-12T00:00:00').concat(['2026-11-13T00:00:00'])], [['2026-11-12', 12], ['2026-11-13', 1]]],
  [['bucketCounts', []], []],

  // the old calendar's key for a cell, `new Date(y, m, d).toISOString().split('T')[0]`, is right only west of Greenwich: this is the reported date shift
  [['legacyKey', 2026, 10, 12], { LAX: '2026-11-12', UTC: '2026-11-12', MSK: '2026-11-11', KHI: '2026-11-11', AKL: '2026-11-11', KIR: '2026-11-11' }],
  [['legacyKey', 2026, 11, 31], { LAX: '2026-12-31', UTC: '2026-12-31', MSK: '2026-12-30', KHI: '2026-12-30', AKL: '2026-12-30', KIR: '2026-12-30' }],
  [['legacyKey', 2028, 1, 29], { LAX: '2028-02-29', UTC: '2028-02-29', MSK: '2028-02-28', KHI: '2028-02-28', AKL: '2028-02-28', KIR: '2028-02-28' }],
  [['legacyKey', 2027, 0, 1], { LAX: '2027-01-01', UTC: '2027-01-01', MSK: '2026-12-31', KHI: '2026-12-31', AKL: '2026-12-31', KIR: '2026-12-31' }],
];

test('the six zones are the zones the expectations assume', () => {
  for (const code of CODES) assert.deepEqual(inZone(ZONES[code], []).offsets, OFFSETS[code], ZONES[code]);
});

test('every rule in the table gives the same answer in six time zones, or the answer the table gives for that zone', () => {
  const calls = TABLE.map(([call]) => call);
  for (const code of CODES) {
    const { results } = inZone(ZONES[code], calls);
    TABLE.forEach(([call, want], i) => {
      const expected = perZone(want) ? want[code] : want;
      if (perZone(want) && !(code in want)) return;                // a zone the row leaves out is not checked
      assert.deepEqual(results[i], expected, `${ZONES[code]}: ${JSON.stringify(call)}`);
    });
  }
});

test('the month grid is the same days in every zone, for every month of three years, checked against arithmetic that has no zone in it', () => {
  const months: Array<[number, number]> = [];
  for (const year of [2026, 2027, 2028]) for (let month = 1; month <= 12; month++) months.push([year, month]);
  const calls: Call[] = months.map(([year, month]) => ['gridKeys', year, month]);
  for (const code of CODES) {
    const { results } = inZone(ZONES[code], calls);
    months.forEach(([year, month], i) => assert.deepEqual(results[i], expectedGrid(year, month), `${ZONES[code]} ${year}-${month}`));
  }
});

test('the reviews of a month sit on the same days in every zone: what the server writes is the day shown', () => {
  const dates = ['2026-11-01T00:00:00', '2026-11-12T00:00:00', '2026-11-12T00:00:00', '2026-11-30T00:00:00', '2026-11-30T23:59:59', '2026-12-01T00:00:00'];
  const calls: Call[] = [['bucketCounts', dates]];
  for (const code of CODES) {
    const { results } = inZone(ZONES[code], calls);
    assert.deepEqual(results[0], [['2026-11-01', 1], ['2026-11-12', 2], ['2026-11-30', 2], ['2026-12-01', 1]], ZONES[code]);
  }
});
