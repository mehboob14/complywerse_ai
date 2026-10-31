// node --test "src/app/(dashboard)/governance/documents/studio/_components/homeWorkCount.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORK_LIMIT, workCount } from './homeLists.ts';

test('the count beside "Your work" is the number listed', () => {
  assert.equal(workCount(0), '0');
  assert.equal(workCount(8), '8');
  assert.equal(workCount(99), '99');
});

test('at the server\'s limit the count says "or more", not an exact total it does not have', () => {
  assert.equal(WORK_LIMIT, 100);
  assert.equal(workCount(100), '100+');
  assert.equal(workCount(101), '100+');
});
