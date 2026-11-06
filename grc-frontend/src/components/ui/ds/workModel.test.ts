// node --test "src/components/ui/ds/workModel.test.ts"
// The rules of WorkRow and CountRow apart from React: the words and tone of a due date, which control the title is, the names a screen reader gets for the
// action and the menu, and how a count and its change are read.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { actionName, countText, daysUntil, deltaWords, dueBadge, isZero, menuName, rowTitle, titleControl } from './workModel.ts';

const TODAY = new Date(2026, 10, 6, 10, 30);                                 // Friday 6 Nov 2026, 10:30 on the viewer's wall

test('days until a date count calendar days, whatever the clock says', () => {
  assert.equal(daysUntil('2026-11-06', TODAY), 0);
  assert.equal(daysUntil('2026-11-07', TODAY), 1);
  assert.equal(daysUntil('2026-11-03', TODAY), -3);
  assert.equal(daysUntil('2026-12-06', TODAY), 30);
  assert.equal(daysUntil(new Date(2026, 10, 6, 0, 5), new Date(2026, 10, 6, 23, 59)), 0);    // the same day, hours apart
  for (const none of [null, undefined, '', 'soon', '2027-02-29']) assert.equal(daysUntil(none as string, TODAY), null, String(none));
});

test('a date-only value keeps its day; a DateTime that means a day does with calendar', () => {
  assert.equal(daysUntil('2026-11-09T00:00:00', TODAY, true), 3);
  assert.equal(daysUntil('2026-11-09T23:30:00', TODAY, true), 3);
  assert.equal(daysUntil('2026-11-09', TODAY, true), 3);
  assert.equal(daysUntil('not a date', TODAY, true), null);
});

test('the due badge says it in words: overdue, today, tomorrow, soon, this week, then the date', () => {
  const at = (day: string, extra: Partial<Parameters<typeof dueBadge>[0]> = {}) => dueBadge({ due: day, today: TODAY, ...extra });
  assert.deepEqual(at('2026-11-03'), { text: 'Overdue by 3 days', tone: 'danger', overdue: true });
  assert.deepEqual(at('2026-11-05'), { text: 'Overdue by 1 day', tone: 'danger', overdue: true });
  assert.deepEqual(at('2026-11-06'), { text: 'Due today', tone: 'warning', overdue: false });
  assert.deepEqual(at('2026-11-07'), { text: 'Due tomorrow', tone: 'warning', overdue: false });
  assert.deepEqual(at('2026-11-08'), { text: 'Due in 2 days', tone: 'warning', overdue: false });
  assert.deepEqual(at('2026-11-09'), { text: 'Due in 3 days', tone: 'warning', overdue: false });
  assert.deepEqual(at('2026-11-10'), { text: 'Due in 4 days', tone: 'neutral', overdue: false });
  assert.deepEqual(at('2026-11-13'), { text: 'Due in 7 days', tone: 'neutral', overdue: false });
  assert.deepEqual(at('2026-11-14'), { text: 'Due 14 Nov 2026', tone: 'neutral', overdue: false });
  assert.deepEqual(at('2027-01-02'), { text: 'Due 2 Jan 2027', tone: 'neutral', overdue: false });
});

test('the due badge never reads like the due text of another module: the thresholds are the inbox\'s (3 days warm, 7 plain)', () => {
  const tone = (n: number) => dueBadge({ due: new Date(2026, 10, 6 + n, 12), today: TODAY }).tone;
  assert.deepEqual([0, 1, 2, 3].map(tone), ['warning', 'warning', 'warning', 'warning']);
  assert.deepEqual([4, 5, 6, 7, 8, 40].map(tone), ['neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral']);
});

test('the server\'s own overdue flag wins over the date: forced on, forced off, or derived when the page says nothing', () => {
  assert.deepEqual(dueBadge({ due: '2026-11-20', today: TODAY, overdue: true }), { text: 'Overdue', tone: 'danger', overdue: true });        // an SLA that breached, the date still ahead
  assert.deepEqual(dueBadge({ due: '2026-11-03', today: TODAY, overdue: true }), { text: 'Overdue by 3 days', tone: 'danger', overdue: true });
  assert.deepEqual(dueBadge({ due: '2026-11-03', today: TODAY, overdue: false }), { text: 'Due 3 Nov 2026', tone: 'neutral', overdue: false }); // a finished action
  assert.deepEqual(dueBadge({ due: '2026-11-06', today: TODAY, overdue: false }), { text: 'Due today', tone: 'warning', overdue: false });
  assert.equal(dueBadge({ due: '2026-11-03', today: TODAY, overdue: undefined }).overdue, true);
});

test('no date reads "No due date" (or "Overdue" when forced), never a blank or a zero', () => {
  for (const none of [null, undefined, '', 'tomorrow-ish']) assert.deepEqual(dueBadge({ due: none as string, today: TODAY }), { text: 'No due date', tone: 'neutral', overdue: false }, String(none));
  assert.deepEqual(dueBadge({ due: null, today: TODAY, overdue: true }), { text: 'Overdue', tone: 'danger', overdue: true });
  assert.equal(dueBadge({ due: null, today: TODAY, overdue: false }).text, 'No due date');
});

test('a due date that means a day reads as that day with calendar, even when it arrives as a DateTime', () => {
  assert.equal(dueBadge({ due: '2026-11-14T00:00:00', today: TODAY, calendar: true }).text, 'Due 14 Nov 2026');
  assert.equal(dueBadge({ due: '2026-11-07T00:00:00', today: TODAY, calendar: true }).text, 'Due tomorrow');
  assert.equal(dueBadge({ due: '2026-11-04T00:00:00', today: TODAY, calendar: true }).text, 'Overdue by 2 days');
});

test('the title is a link when it has an address, a button when it only has something to run, else text', () => {
  assert.equal(titleControl({ href: '/governance/documents/7' }), 'link');
  assert.equal(titleControl({ onOpen: () => undefined }), 'button');
  assert.equal(titleControl({ href: '/a', onOpen: () => undefined }), 'link');          // the address wins
  assert.equal(titleControl({ href: '' }), 'text');
  assert.equal(titleControl({}), 'text');
});

test('the action is named by its word and what it is about, so fifty rows are not fifty buttons called "Approve"', () => {
  assert.equal(actionName({ label: 'Approve', title: 'Information security policy' }), 'Approve: Information security policy');
  assert.equal(actionName({ label: ' Review ', title: '  Retention standard ' }), 'Review: Retention standard');
  assert.equal(actionName({ label: 'Open', title: '' }), 'Open');
  assert.equal(actionName({ label: 'Approve', title: 'x', ariaLabel: 'Approve version 2 of the policy' }), 'Approve version 2 of the policy');
  assert.equal(actionName({ label: 'Approve', title: 'x', ariaLabel: '   ' }), 'Approve: x');
  // the visible word is always inside the default name (WCAG 2.5.3 label in name)
  assert.ok(actionName({ label: 'Acknowledge', title: 'Code of conduct' }).startsWith('Acknowledge'));
});

test('the menu is named for the row it belongs to unless the page names it', () => {
  assert.equal(menuName({ title: 'Retention standard' }), 'Actions for Retention standard');
  assert.equal(menuName({ title: 'Retention standard', label: 'More about this request' }), 'More about this request');
  assert.equal(menuName({ title: '  ' }), 'Actions');
});

test('a row always says something as its title', () => {
  assert.equal(rowTitle('  Review the minutes '), 'Review the minutes');
  for (const none of ['', '   ', null, undefined]) assert.equal(rowTitle(none), '—');
});

test('a count is the true number with its separator; not recorded is a dash, never a zero', () => {
  assert.equal(countText(1247), '1,247');
  assert.equal(countText(0), '0');
  assert.equal(countText(1234567), '1,234,567');
  assert.equal(countText(-3), '0');                                                   // a count is never negative
  for (const none of [null, undefined, NaN, Infinity]) assert.equal(countText(none as number), '—', String(none));
  assert.equal(isZero(0), true);
  for (const other of [1, null, undefined, NaN]) assert.equal(isZero(other as number), false, String(other));
});

test('the change beside a count is words with a sign, and says nothing about good or bad', () => {
  assert.equal(deltaWords(3, 'this week'), '+3 this week');
  assert.equal(deltaWords(-2, 'since Monday'), '-2 since Monday');
  assert.equal(deltaWords(0, 'this week'), 'No change this week');
  assert.equal(deltaWords(1200), '+1,200');
  assert.equal(deltaWords(0), 'No change');
  assert.equal(deltaWords(0.4, 'this week'), 'No change this week');                  // rounds to a whole count
  for (const none of [null, undefined, NaN]) assert.equal(deltaWords(none as number, 'this week'), '', String(none));
});
