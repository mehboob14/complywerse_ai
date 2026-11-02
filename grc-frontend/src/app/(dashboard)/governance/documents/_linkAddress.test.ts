// node --test "src/app/(dashboard)/governance/documents/_linkAddress.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINK_START, addressToLink, startingAddress } from './_linkAddress.ts';

test('the field starts with the link under the cursor, else with https:// as the browser prompt did', () => {
  assert.equal(startingAddress('https://example.test/policy'), 'https://example.test/policy');
  assert.equal(startingAddress(undefined), LINK_START);
  assert.equal(startingAddress(null), LINK_START);
  assert.equal(startingAddress(''), LINK_START);
  assert.equal(startingAddress('   '), LINK_START);
  assert.equal(LINK_START, 'https://');
});

test('an address is linked as typed, with the spaces around it taken off', () => {
  assert.equal(addressToLink('https://example.test/a b'), 'https://example.test/a b');
  assert.equal(addressToLink('  https://example.test  '), 'https://example.test');
  assert.equal(addressToLink('mailto:ciso@example.test'), 'mailto:ciso@example.test');
  assert.equal(addressToLink('/governance/documents/44'), '/governance/documents/44');
});

test('nothing to link to: blank, spaces only, or just the start that was offered', () => {
  assert.equal(addressToLink(''), null);
  assert.equal(addressToLink('   \n'), null);
  assert.equal(addressToLink(LINK_START), null);
  assert.equal(addressToLink(`  ${LINK_START} `), null);
});

test('an address that only begins with the start is an address', () => {
  assert.equal(addressToLink('https://a'), 'https://a');
  assert.equal(addressToLink('http://'), 'http://');
});
