// node --test "src/app/(dashboard)/vendor-risk/_lib/portfolioModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { badgeText, headerStats, isActive, isDrillDown, shellKey } from './portfolioModel.ts';

test('the header line states the facts, drops a part that is zero, and keeps the vendors', () => {
  assert.equal(headerStats({ vendors: 12, critical: 2, open_findings: 1, intake_pending: 3 }), '12 vendors · 2 critical · 1 open finding');
  assert.equal(headerStats({ vendors: 12, critical: 0, open_findings: 5, intake_pending: 0 }), '12 vendors · 5 open findings');
  assert.equal(headerStats({ vendors: 1, critical: 1, open_findings: 0, intake_pending: 0 }), '1 vendor · 1 critical');
  assert.equal(headerStats({ vendors: 0, critical: 0, open_findings: 0, intake_pending: 0 }), '0 vendors');
  assert.equal(headerStats({ vendors: 1204, critical: 0, open_findings: 0, intake_pending: 0 }), '1,204 vendors');
});

test('until the numbers are in (or when they could not be read) the line says what the module is', () => {
  assert.equal(headerStats(undefined), 'Third-party risk');
  assert.equal(headerStats(null), 'Third-party risk');
  assert.equal(headerStats({}), 'Third-party risk');
});

test('a rail badge shows nothing for zero and stops at 99+', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(undefined), '');
  assert.equal(badgeText(null), '');
  assert.equal(badgeText(-2), '');
  assert.equal(badgeText(3), '3');
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '99+');
});

test('a vendor record and the questionnaire builder draw their own header; every other page gets the module header', () => {
  for (const path of ['/vendor-risk/vendors/12', '/vendor-risk/vendors/12/summary', '/vendor-risk/vendors/12?tab=findings',
    '/vendor-risk/questionnaires/abc123/builder', '/vendor-risk/questionnaires/abc123/builder/']) {
    assert.equal(isDrillDown(path), true, path);
  }
  for (const path of ['/vendor-risk', '/vendor-risk/vendors', '/vendor-risk/vendors?tier=high', '/vendor-risk/intake', '/vendor-risk/intake/4',
    '/vendor-risk/findings', '/vendor-risk/roster', '/vendor-risk/policy', '/vendor-risk/settings/emails', '/vendor-risk/questionnaires',
    '/vendor-risk/questionnaires/abc123', '/vendor-risk/assessments/9', '/vendor-risk/vendors/new', '']) {
    assert.equal(isDrillDown(path), false, path);
  }
});

test('the shell remounts per vendor record and is one shell for every other page', () => {
  assert.equal(shellKey('/vendor-risk/vendors/12'), '/vendor-risk/vendors/12');
  assert.equal(shellKey('/vendor-risk/vendors/13/summary'), '/vendor-risk/vendors/13/summary');
  assert.equal(shellKey('/vendor-risk/vendors'), 'vendor-risk-shell');
  assert.equal(shellKey('/vendor-risk/findings'), 'vendor-risk-shell');
});

test('the rail entry on is the page itself and the pages beneath it; the Overview only on its own', () => {
  assert.equal(isActive('/vendor-risk', '/vendor-risk', true), true);
  assert.equal(isActive('/vendor-risk/vendors', '/vendor-risk', true), false);
  assert.equal(isActive('/vendor-risk/vendors', '/vendor-risk/vendors'), true);
  assert.equal(isActive('/vendor-risk/vendors/12', '/vendor-risk/vendors'), true);       // a record keeps the Register lit
  assert.equal(isActive('/vendor-risk/questionnaires/abc/builder', '/vendor-risk/questionnaires'), true);
  assert.equal(isActive('/vendor-risk/vendors-old', '/vendor-risk/vendors'), false);     // a sibling that only starts the same way
  assert.equal(isActive('/vendor-risk/settings/emails', '/vendor-risk/settings'), true);
  assert.equal(isActive('/vendor-risk/policy/', '/vendor-risk/policy'), true);
  assert.equal(isActive('/vendor-risk/roster', '/vendor-risk/policy'), false);
});
