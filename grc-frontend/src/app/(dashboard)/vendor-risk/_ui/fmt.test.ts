// node --test "src/app/(dashboard)/vendor-risk/_ui/*.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fmt } from './fmt.ts';

test('a date is "5 Mar 2026"; the month names do not depend on the locale', () => {
  assert.equal(fmt.date('2026-03-05'), '5 Mar 2026');
  assert.equal(fmt.date('2026-09-26'), '26 Sep 2026');                 // Intl en-GB would say "Sept"
  assert.equal(fmt.date('2027-12-31'), '31 Dec 2027');
  assert.equal(fmt.date('2026-03-05T12:00:00'), '5 Mar 2026');          // the server's naive UTC
  assert.equal(fmt.date('2026-03-05T12:00:00Z'), '5 Mar 2026');
});

test('a missing or broken date says so', () => {
  for (const none of [null, undefined, '', 'not a date', '2026-13-45']) assert.equal(fmt.date(none), 'No date', String(none));
  assert.equal(fmt.countdown(null), '');
  assert.equal(fmt.countdown('nope'), '');
});

test('a date with no time is that day wherever the viewer is; a moment is the viewer\'s own day (naive UTC read as UTC)', () => {
  const was = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Karachi';                                   // UTC+5: 22:30 UTC is already tomorrow
    assert.equal(fmt.date('2026-03-05'), '5 Mar 2026');
    assert.equal(fmt.date('2026-03-05T22:30:00'), '6 Mar 2026');
    process.env.TZ = 'Pacific/Honolulu';                               // UTC-10: midnight UTC is still the day before
    assert.equal(fmt.date('2026-03-05'), '5 Mar 2026');
    assert.equal(fmt.date('2026-03-05T05:00:00'), '4 Mar 2026');
  } finally {
    if (was === undefined) delete process.env.TZ; else process.env.TZ = was;
  }
});

test('a countdown counts calendar days: "in 9 days", "today", "12 days ago"', () => {
  const today = new Date(2026, 2, 5, 15, 0);                           // 5 Mar 2026, local
  assert.equal(fmt.countdown('2026-03-14', today), 'in 9 days');
  assert.equal(fmt.countdown('2026-03-05', today), 'today');
  assert.equal(fmt.countdown('2026-02-21', today), '12 days ago');
  assert.equal(fmt.countdown('2026-03-06', today), 'in 1 day');
  assert.equal(fmt.countdown('2026-03-04', today), '1 day ago');
  assert.equal(fmt.countdown('2027-03-05', today), 'in 365 days');
});

test('a countdown does not care what time of day it is now', () => {
  assert.equal(fmt.countdown('2026-03-06', new Date(2026, 2, 5, 0, 1)), 'in 1 day');
  assert.equal(fmt.countdown('2026-03-06', new Date(2026, 2, 5, 23, 59)), 'in 1 day');     // not "today"
  assert.equal(fmt.countdown('2026-03-30', new Date(2026, 2, 28, 12, 0)), 'in 2 days');     // across a clock change, if the zone has one
});

test('money is US dollars with no cents, or "Not set"', () => {
  assert.equal(fmt.money(42000), '$42,000');
  assert.equal(fmt.money(0), '$0');
  assert.equal(fmt.money(1234567.89), '$1,234,568');
  assert.equal(fmt.money(-1500), '-$1,500');
  for (const none of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(fmt.money(none), 'Not set', String(none));
});

test('a status word as a label', () => {
  assert.equal(fmt.status('in_remediation'), 'In remediation');
  assert.equal(fmt.status('Under-review'), 'Under review');
  assert.equal(fmt.status('active'), 'Active');
  assert.equal(fmt.status(null), '');
  assert.equal(fmt.status('  '), '');
});
