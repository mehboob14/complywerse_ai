// Run: node --test "src/app/(dashboard)/reports/_reports/calcColumns.test.ts"
// Node's built-in runner strips the types — no test framework to install.
//
// What these guard is the difference between "no value" and "zero", which is
// the only way a derived column can lie quietly. A blank start date must not
// produce a 0-day age, and a zero denominator must not produce a 0% coverage:
// both would sail through the UI as real numbers and into an average.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TODAY, buildCalcColumn, calcIsComplete, type CalcColumnDef } from './calcColumns.ts';
import type { ColumnDef, Row } from './types.ts';

const COLS: ColumnDef[] = [
  { key: 'created_at', label: 'Created', type: 'date' },
  { key: 'closed_at', label: 'Closed', type: 'date' },
  { key: 'inherent', label: 'Inherent', type: 'number' },
  { key: 'residual', label: 'Residual', type: 'number' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'owner', label: 'Owner', type: 'text' },
];
const resolve = (k: string) => COLS.find((c) => c.key === k);
const value = (def: CalcColumnDef, row: Row) => buildCalcColumn(def, resolve).accessor!(row);
const shown = (def: CalcColumnDef, row: Row) => {
  const col = buildCalcColumn(def, resolve);
  return col.format!(col.accessor!(row), row);
};

const days = (over: Partial<CalcColumnDef> = {}): CalcColumnDef => ({
  id: 'd', label: 'Days open', kind: 'days_between', a: 'created_at', b: 'closed_at', ...over,
});

test('days between two dates counts whole days', () => {
  assert.equal(value(days(), { created_at: '2026-01-01', closed_at: '2026-01-11' }), 10);
});

test('days between ignores the time of day', () => {
  // Stamps 2 minutes apart on either side of midnight are one day, not zero.
  const row = { created_at: '2026-01-01T23:59:00', closed_at: '2026-01-02T00:01:00' };
  assert.equal(value(days(), row), 1);
});

test('days between is negative when the second date is earlier', () => {
  assert.equal(value(days(), { created_at: '2026-01-11', closed_at: '2026-01-01' }), -10);
});

test('a missing date yields no value, not a zero-day age', () => {
  assert.equal(value(days({ b: TODAY }), { created_at: null }), null);
  assert.equal(value(days(), { created_at: '2026-01-01', closed_at: '' }), null);
});

test('TODAY resolves to a real number of days', () => {
  const v = value(days({ a: 'created_at', b: TODAY }), { created_at: '2026-01-01' }) as number;
  assert.equal(typeof v, 'number');
  assert.ok(v > 0);
});

test('difference subtracts in the stated order', () => {
  const def: CalcColumnDef = { id: 'x', label: 'Reduction', kind: 'difference', a: 'inherent', b: 'residual' };
  assert.equal(value(def, { inherent: 20, residual: 8 }), 12);
});

test('difference against a blank operand is blank, and zero stays zero', () => {
  const def: CalcColumnDef = { id: 'x', label: 'Reduction', kind: 'difference', a: 'inherent', b: 'residual' };
  assert.equal(value(def, { inherent: 20, residual: null }), null);
  assert.equal(value(def, { inherent: 0, residual: 0 }), 0);
});

test('ratio as a percentage', () => {
  const def: CalcColumnDef = { id: 'r', label: 'Coverage', kind: 'ratio', a: 'residual', b: 'inherent', asPercent: true };
  assert.equal(value(def, { residual: 5, inherent: 20 }), 25);
  assert.equal(shown(def, { residual: 5, inherent: 20 }), '25.0%');
});

test('dividing by zero is blank, not zero or infinity', () => {
  const def: CalcColumnDef = { id: 'r', label: 'Coverage', kind: 'ratio', a: 'residual', b: 'inherent', asPercent: true };
  assert.equal(value(def, { residual: 5, inherent: 0 }), null);
  assert.equal(shown(def, { residual: 5, inherent: 0 }), '');
});

test('bands are inclusive of their upper bound and the last one is open', () => {
  const def: CalcColumnDef = {
    id: 'b', label: 'Severity', kind: 'bucket', a: 'inherent',
    bands: [{ max: 4, label: 'Low' }, { max: 9, label: 'Medium' }, { max: null, label: 'High' }],
  };
  assert.equal(value(def, { inherent: 4 }), 'Low');
  assert.equal(value(def, { inherent: 5 }), 'Medium');
  assert.equal(value(def, { inherent: 9 }), 'Medium');
  assert.equal(value(def, { inherent: 400 }), 'High');
});

test('an unrated row is not banded into the lowest band', () => {
  const def: CalcColumnDef = {
    id: 'b', label: 'Severity', kind: 'bucket', a: 'inherent',
    bands: [{ max: 4, label: 'Low' }, { max: null, label: 'High' }],
  };
  assert.equal(value(def, { inherent: null }), null);
  assert.equal(value(def, {}), null);
});

test('join skips a blank side rather than leaving a dangling separator', () => {
  const def: CalcColumnDef = { id: 'c', label: 'Who', kind: 'concat', a: 'title', b: 'owner', separator: ' — ' };
  assert.equal(value(def, { title: 'Risk A', owner: 'Sam' }), 'Risk A — Sam');
  assert.equal(value(def, { title: 'Risk A', owner: null }), 'Risk A');
  assert.equal(value(def, { title: null, owner: null }), null);
});

test('a column the calculation points at no longer existing yields blank', () => {
  const def: CalcColumnDef = { id: 'g', label: 'Gone', kind: 'difference', a: 'inherent', b: 'deleted_field' };
  assert.equal(value(def, { inherent: 5, deleted_field: 3 }), null);
});

test('incomplete definitions are never built into columns', () => {
  assert.equal(calcIsComplete({ id: 'i', label: '', kind: 'difference', a: 'inherent', b: 'residual' }), false);
  assert.equal(calcIsComplete({ id: 'i', label: 'X', kind: 'difference', a: 'inherent' }), false);
  assert.equal(calcIsComplete({ id: 'i', label: 'X', kind: 'bucket', a: 'inherent' }), true);
});
