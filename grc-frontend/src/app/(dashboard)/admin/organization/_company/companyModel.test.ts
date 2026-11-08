// node --test "src/app/(dashboard)/admin/organization/_company/companyModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bodyOf, contactEmailChanged, contactEmailQuestion, EMPTY_FORM, errorsOf, formOf, hasErrors, isDirty, LIMITS } from './companyModel.ts';

const saved = formOf({ name: 'Acme Bank', primary_contact_name: 'Sam Lee', primary_contact_email: 'sam@acme.example', primary_contact_phone: '+971 4 000 0000' });

test('the form is the saved record; a missing value is an empty box', () => {
  assert.deepEqual(saved, { name: 'Acme Bank', contactName: 'Sam Lee', contactEmail: 'sam@acme.example', contactPhone: '+971 4 000 0000' });
  assert.deepEqual(formOf({ name: 'X' }), { ...EMPTY_FORM, name: 'X' });
  assert.deepEqual(formOf(null), EMPTY_FORM);
  assert.deepEqual(formOf({ name: null, primary_contact_email: null }), EMPTY_FORM);
});

test('only what changed is sent, trimmed, under the server\'s names; address and website are never sent (the server has no column for them)', () => {
  assert.deepEqual(bodyOf(saved, saved), {});
  assert.deepEqual(bodyOf(saved, { ...saved, name: '  Acme Bank Ltd ' }), { name: 'Acme Bank Ltd' });
  assert.deepEqual(bodyOf(saved, { ...saved, contactName: 'Pat', contactPhone: '' }), { primary_contact_name: 'Pat', primary_contact_phone: '' });
  assert.deepEqual(Object.keys(bodyOf(saved, { name: 'a', contactName: 'b', contactEmail: 'c@d.ee', contactPhone: 'e' })).sort(), ['name', 'primary_contact_email', 'primary_contact_name', 'primary_contact_phone']);
  assert.ok(!('address' in bodyOf(saved, { ...saved, name: 'Z' })) && !('website' in bodyOf(saved, { ...saved, name: 'Z' })));
});

test('spaces round a value are not a change', () => {
  assert.equal(isDirty(saved, saved), false);
  assert.equal(isDirty(saved, { ...saved, name: ' Acme Bank ' }), false);
  assert.equal(isDirty(saved, { ...saved, name: 'Acme Bank 2' }), true);
  assert.equal(isDirty(saved, { ...saved, contactEmail: '' }), true);
});

test('the checks: a name is needed, an e-mail must look like one (and may be empty), the lengths are the columns\'', () => {
  assert.deepEqual(errorsOf(saved), {});
  assert.equal(hasErrors(saved), false);
  assert.match(errorsOf({ ...saved, name: '   ' }).name ?? '', /Enter the name/);
  assert.match(errorsOf({ ...saved, contactEmail: 'sam@' }).contactEmail ?? '', /name@company\.com/);
  assert.match(errorsOf({ ...saved, contactEmail: 'two words@x.io' }).contactEmail ?? '', /name@company\.com/);
  assert.deepEqual(errorsOf({ ...saved, contactEmail: '' }), {}, 'no contact e-mail is allowed');
  assert.match(errorsOf({ ...saved, name: 'x'.repeat(LIMITS.name + 1) }).name ?? '', /at most 255/);
  assert.match(errorsOf({ ...saved, contactPhone: '1'.repeat(LIMITS.contactPhone + 1) }).contactPhone ?? '', /at most 50/);
  assert.match(errorsOf({ ...saved, contactName: 'n'.repeat(LIMITS.contactName + 1) }).contactName ?? '', /at most 255/);
  assert.equal(hasErrors({ ...saved, name: '' }), true);
});

test('changing the primary contact e-mail is asked about, in words that say what it does; its case and spaces do not count', () => {
  assert.equal(contactEmailChanged(saved, saved), false);
  assert.equal(contactEmailChanged(saved, { ...saved, contactEmail: ' SAM@acme.example ' }), false);
  assert.equal(contactEmailChanged(saved, { ...saved, contactEmail: 'pat@acme.example' }), true);
  assert.equal(contactEmailChanged(saved, { ...saved, contactEmail: '' }), true);
  const q = contactEmailQuestion(saved, { ...saved, contactEmail: 'pat@acme.example' });
  assert.equal(q.title, 'Change the primary contact e-mail?');
  assert.match(q.message, /^pat@acme\.example becomes an administrator/);
  assert.match(q.message, /same domain/);
  assert.match(q.message, /sam@acme\.example stays an administrator only if they hold the Administrator role/);
  const none = contactEmailQuestion(saved, { ...saved, contactEmail: '' });
  assert.match(none.message, /nobody is an administrator through the primary contact/);
  assert.equal(contactEmailQuestion(EMPTY_FORM, { ...EMPTY_FORM, contactEmail: 'a@b.cd' }).message.includes('stays'), false, 'no earlier contact to mention');
});
