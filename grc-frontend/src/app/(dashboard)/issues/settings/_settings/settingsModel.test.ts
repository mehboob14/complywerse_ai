// node --test "src/app/(dashboard)/issues/settings/_settings/settingsModel.test.ts"
// The Issue settings page's decisions: the matrix is nine places whatever the server sent, hours are said in days from two days up, a cell is saved with its acknowledge window UNCHANGED
// (the server resets a missing one), and the automation switch clears the "all on" override when it is turned off (or it would stay on).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { cellName, cellPayload, draftOf, gridOf, hoursError, hoursHint, isDirty, kriOn, kriPayload, slaWords, LEVELS, type MatrixCell } from './settingsModel.ts';
import { SEVERITY_OPTIONS } from '../../../../../lib/issues/words.ts';

const cell = (impact: string, urgency: string, o: Partial<MatrixCell> = {}): MatrixCell => ({ impact, urgency, severity: 'medium', sla_ack_hours: 24, sla_resolve_hours: 168, is_default: true, ...o });

test('the grid is nine places, impact down and urgency across (high first), and a cell the server did not send is empty', () => {
  const rows = gridOf([cell('high', 'high', { severity: 'critical' }), cell('low', 'low', { severity: 'informational' })]);
  assert.deepEqual(rows.map((r) => r.impact), [...LEVELS]);
  assert.ok(rows.every((r) => r.cells.length === 3 && r.cells.map((c) => c.urgency).join() === 'high,medium,low'));
  assert.equal(rows[0].cells[0].cell?.severity, 'critical');
  assert.equal(rows[2].cells[2].cell?.severity, 'informational');
  assert.equal(rows[1].cells[1].cell, null);
  assert.equal(gridOf(undefined).flatMap((r) => r.cells).filter((c) => c.cell === null).length, 9);
});

test('hours are said in days from two days up, in hours otherwise', () => {
  assert.deepEqual([1, 24, 36, 47, 48, 72, 100, 168, 720].map(slaWords), ['1 hour', '24 hours', '36 hours', '47 hours', '2 days', '3 days', '100 hours', '7 days', '30 days']);
  assert.equal(cellName(cell('high', 'medium', { sla_resolve_hours: 72 }), 'High'), 'High impact, medium urgency: High, fixed within 3 days');
});

test('the hours must be a whole number of at least 1; the form is dirty only when something changed', () => {
  for (const bad of ['', '  ', '0', '-3', '1.5', '12h', 'abc']) assert.ok(hoursError(bad), `"${bad}"`);
  for (const good of ['1', '72', ' 168 ']) assert.equal(hoursError(good), null, good);
  const c = cell('high', 'high', { sla_resolve_hours: 72, severity: 'critical' });
  assert.equal(isDirty(c, draftOf(c)), false);
  assert.equal(isDirty(c, { ...draftOf(c), hours: '73' }), true);
  assert.equal(isDirty(c, { ...draftOf(c), severity: 'high' }), true);
  assert.equal(isDirty(c, { ...draftOf(c), hours: ' 72 ' }), false, 'spaces are not a change');
});

test('the line under the hours says the days only when the number is a whole number of days', () => {
  assert.deepEqual(['72', '168', '48'].map(hoursHint), ['That is 3 days.', 'That is 7 days.', 'That is 2 days.']);
  assert.deepEqual(['24', '36', '', 'abc', '100'].map(hoursHint), Array(5).fill('A whole number of hours.'));
});

test('saving a cell sends the acknowledge window unchanged, because the server resets a missing one to 24 hours', () => {
  const c = cell('medium', 'low', { sla_ack_hours: 8, sla_resolve_hours: 120, severity: 'low' });
  assert.deepEqual(cellPayload(c, { severity: 'medium', hours: ' 96 ' }), { severity: 'medium', sla_ack_hours: 8, sla_resolve_hours: 96 });
});

test('the severity words offered are the five the server accepts', () => {
  assert.deepEqual(SEVERITY_OPTIONS.map((o) => o.value), ['critical', 'high', 'medium', 'low', 'informational']);
});

test('the automation switch is on when its own flag or the "all on" override is; off clears both, on sets only its own', () => {
  assert.equal(kriOn(undefined), false);
  assert.equal(kriOn({}), false);
  assert.equal(kriOn({ kri_red_breach: true }), true);
  assert.equal(kriOn({ all_enabled: true }), true);
  assert.equal(kriOn({ kri_red_breach: false, all_enabled: false, overdue_mitigation: true }), false, 'a flag nothing reads does not turn it on');
  assert.deepEqual(kriPayload(true), { kri_red_breach: true });
  assert.deepEqual(kriPayload(false), { kri_red_breach: false, all_enabled: false });
});

test('the three switches nothing reads are never written by this page', () => {
  for (const on of [true, false]) assert.deepEqual(Object.keys(kriPayload(on)).filter((k) => !['kri_red_breach', 'all_enabled'].includes(k)), []);
});

test('the claim the page rests on: of the four flags only kri_red_breach is passed to the issue creator anywhere in the backend', () => {
  const backend = fileURLToPath(new URL('../../../../../../../backend/grc/', import.meta.url));
  let files: string[] = [];
  try { files = (readdirSync(backend, { recursive: true }) as string[]).filter((f) => f.endsWith('.py')); } catch { return; }          // the backend is not part of every checkout of the frontend
  const used = new Set<string>();
  files.forEach((f) => { for (const m of Array.from(readFileSync(`${backend}${f}`, 'utf8').matchAll(/feature_flag="([a-z_]+)"/g))) used.add(m[1]); });
  assert.deepEqual(Array.from(used), ['kri_red_breach']);
});
