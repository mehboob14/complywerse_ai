// node --test "src/app/(dashboard)/erm/risks/_components/registerTypeLabel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registerTypeLabel } from './registerTypeLabel.ts';

test('a stored value that names a client reads as a neutral label, however it was spelled', () => {
  assert.equal(registerTypeLabel('UBL Template'), 'Template');
  assert.equal(registerTypeLabel('ubl_template'), 'Template');
  assert.equal(registerTypeLabel('1LINK'), '3×3 Template');
  assert.equal(registerTypeLabel('1LINK ERM RCSA'), '3×3 Template');
});

test('every other register type reads as it was stored', () => {
  assert.equal(registerTypeLabel('PCI-DSS'), 'PCI-DSS');
  assert.equal(registerTypeLabel('third_party'), 'third party');
  assert.equal(registerTypeLabel(null), '');
});
