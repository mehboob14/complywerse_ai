// node --test "src/app/(dashboard)/erm/incidents/lossEvents.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BUSINESS_LINES, EVENT_TYPES, formatMoney, lossPayload, netLoss, type Option } from './lossEvents.ts';

const backend = readFileSync(new URL('../../../../../../backend/grc/modules/erm/loss_taxonomy.py', import.meta.url), 'utf8');

function pythonTable(name: string): Option[] {
  const body = backend.split(`${name}: Dict[str, str] = {`)[1].split('}')[0];
  return Array.from(body.matchAll(/"([^"]+)":\s*"([^"]+)"/g)).map(([, value, label]) => ({ value, label }));
}

test('the taxonomy is the backend taxonomy, keys, labels and order', () => {
  assert.deepEqual(EVENT_TYPES, pythonTable('EVENT_TYPES'));
  assert.deepEqual(BUSINESS_LINES, pythonTable('BUSINESS_LINES'));
  assert.equal(EVENT_TYPES.length, 7);
  assert.equal(BUSINESS_LINES.length, 8);
});

test('net loss is gross less recoveries, never negative, and empty without a gross loss', () => {
  assert.equal(netLoss(1000, 300), 700);
  assert.equal(netLoss(1000, 1500), 0);
  assert.equal(netLoss(100.1, 0.2), 99.9);
  assert.equal(netLoss(500, null), 500);
  assert.equal(netLoss(null, 100), null);
});

test('an amount carries its own currency code, or none for older records', () => {
  assert.ok(formatMoney(1200, 'EUR').startsWith('EUR '));
  assert.ok(!formatMoney(1200, null).includes('$'));
});

test('blank form fields go to the API as null so an unchanged form does not re-open validation', () => {
  const p = lossPayload({ event_type: '', event_type_l2: '  ', currency: 'usd', accounting_date: '', gross_loss: undefined });
  assert.equal(p.event_type, null);
  assert.equal(p.event_type_l2, null);
  assert.equal(p.currency, 'USD');
  assert.equal(p.accounting_date, null);
  assert.equal(p.gross_loss, null);
  assert.equal(p.is_near_miss, false);
  assert.equal(p.boundary_type, 'none');
  assert.equal(p.discovered_date, undefined);           // omitted: the server keeps or defaults it
});
