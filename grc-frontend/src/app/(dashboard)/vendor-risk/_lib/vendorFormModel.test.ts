// node --test "src/app/(dashboard)/vendor-risk/_lib/vendorFormModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createBody, emptyForm, formFrom, problems, splitList, updateBody } from './vendorFormModel.ts';

const vendor = {
  id: 7, name: 'Meridian Payroll', vendor_type: 'Supplier', industry: 'Payroll', website: 'meridian.example', description: null,
  tier: 'high', status: 'active', data_access_level: 'confidential', business_unit_id: 3, owner_id: 11, security_owner_id: null,
  relationship_owner_id: null, services_provided: ['Payroll', 'Filings'], data_types_accessed: [], systems_in_scope: ['SAP'], tags: null,
  holds_personal_data: true, data_classification: 'restricted', data_location: 'EU (Dublin)', notes: null,
  primary_contact_name: 'Dana', primary_contact_email: 'dana@meridian.example', primary_contact_phone: null,
  contract_start_date: '2026-03-01T00:00:00', contract_end_date: null, contract_value: 42000,
};

test('lists are split on commas, trimmed, and each name kept once', () => {
  assert.deepEqual(splitList(' a, b ,,a , c'), ['a', 'b', 'c']);
  assert.deepEqual(splitList(''), []);
  assert.deepEqual(splitList(' , '), []);
});

test('a new vendor with only a name sends no tier or status: tiering and approval set those', () => {
  assert.deepEqual(createBody({ ...emptyForm(), name: '  Acme Analytics ' }), {
    name: 'Acme Analytics', data_access_level: 'internal', holds_personal_data: false,
    services_provided: [], data_types_accessed: [], systems_in_scope: [], tags: [],
  });
  assert.deepEqual(Object.keys(createBody({ ...emptyForm(), name: 'Acme', tier: 'low', status: 'active' })).filter((k) => k === 'tier' || k === 'status'), []);
});

test('a new vendor sends every field it was given, as the server takes it', () => {
  const body = createBody({
    ...emptyForm(), name: 'Acme', vendor_type: 'Vendor', industry: ' Marketing ', website: 'https://acme.example', business_unit_id: '4',
    services_provided: 'Attribution, Reporting', holds_personal_data: true, data_classification: 'confidential', data_location: 'EU (Frankfurt)',
    systems_in_scope: 'Salesforce, AWS production', data_types_accessed: 'PII, Email', tags: 'preferred',
    owner_id: '11', security_owner_id: '12', relationship_owner_id: '', primary_contact_email: 'a@acme.example',
    contract_start_date: '2026-03-01', contract_value: '42000.5', notes: 'Renewal in the spring',
  });
  assert.deepEqual(body, {
    name: 'Acme', data_access_level: 'internal', holds_personal_data: true,
    vendor_type: 'Vendor', industry: 'Marketing', website: 'https://acme.example', notes: 'Renewal in the spring', data_location: 'EU (Frankfurt)',
    data_classification: 'confidential', primary_contact_email: 'a@acme.example', contract_start_date: '2026-03-01',
    services_provided: ['Attribution', 'Reporting'], data_types_accessed: ['PII', 'Email'], systems_in_scope: ['Salesforce', 'AWS production'],
    tags: ['preferred'], owner_id: 11, security_owner_id: 12, business_unit_id: 4, contract_value: 42000.5,
  });
  assert.equal('relationship_owner_id' in body, false);                          // none chosen: left out, not sent as 0
});

test('the form of an existing vendor reads every field back, and saving it unchanged sends nothing', () => {
  const was = formFrom(vendor);
  assert.equal(was.contract_start_date, '2026-03-01');                          // a stored moment shows as the day
  assert.equal(was.contract_value, '42000');
  assert.equal(was.services_provided, 'Payroll, Filings');
  assert.equal(was.holds_personal_data, true);
  assert.equal(was.owner_id, '11');
  assert.equal(was.security_owner_id, '');
  assert.equal(was.tags, '');
  assert.deepEqual(updateBody({ ...was }, was), {});
  // an unset personal-data flag shows unticked and stays unset until it is ticked
  const unset = formFrom({ ...vendor, holds_personal_data: null });
  assert.equal(unset.holds_personal_data, false);
  assert.deepEqual(updateBody({ ...unset }, unset), {});
  assert.deepEqual(updateBody({ ...unset, holds_personal_data: true }, unset), { holds_personal_data: true });
});

test('editing sends only what changed, and a cleared field as null', () => {
  const was = formFrom(vendor);
  const body = updateBody({
    ...was, name: ' Meridian Payroll Ltd ', industry: '', website: 'https://meridian.example', services_provided: 'Payroll, Filings, Tax',
    systems_in_scope: '', owner_id: '', relationship_owner_id: '14', contract_value: '', data_classification: 'confidential',
    holds_personal_data: false,
  }, was);
  assert.deepEqual(body, {
    name: 'Meridian Payroll Ltd', industry: null, website: 'https://meridian.example', data_classification: 'confidential',
    services_provided: ['Payroll', 'Filings', 'Tax'], systems_in_scope: [], owner_id: null, relationship_owner_id: 14,
    contract_value: null, holds_personal_data: false,
  });
  // a list written in another order is a change; the same names with spaces are not
  assert.deepEqual(updateBody({ ...was, services_provided: 'Filings,Payroll' }, was), { services_provided: ['Filings', 'Payroll'] });
  assert.deepEqual(updateBody({ ...was, services_provided: ' Payroll ,  Filings' }, was), {});
});

test('a changed tier goes with its justification, the status and data access with their own words', () => {
  const was = formFrom(vendor);
  assert.deepEqual(updateBody({ ...was, tier: 'critical', tier_justification: '  Holds all payroll for 4,000 staff ' }, was),
    { tier: 'critical', tier_justification: 'Holds all payroll for 4,000 staff' });
  assert.deepEqual(updateBody({ ...was, tier: 'critical' }, was), { tier: 'critical' });
  assert.deepEqual(updateBody({ ...was, tier_justification: 'a reason nobody asked for' }, was), {});          // no tier change: no override
  assert.deepEqual(updateBody({ ...was, status: 'suspended', data_access_level: 'restricted' }, was), { status: 'suspended', data_access_level: 'restricted' });
});

test('what stops a save is said in words, and a tier override needs a reason only when the tier was worked out', () => {
  assert.deepEqual(problems({ ...emptyForm(), name: 'Acme' }, null, false), []);
  assert.deepEqual(problems({ ...emptyForm(), name: '  ' }, null, false), ['Give the vendor a name.']);
  const was = formFrom(vendor);
  assert.deepEqual(problems({ ...was, tier: 'critical' }, was, true), ['Say why the tier changes (at least 10 characters).']);
  assert.deepEqual(problems({ ...was, tier: 'critical', tier_justification: 'too short' }, was, true), ['Say why the tier changes (at least 10 characters).']);
  assert.deepEqual(problems({ ...was, tier: 'critical', tier_justification: 'Holds all payroll data' }, was, true), []);
  assert.deepEqual(problems({ ...was, tier: 'critical' }, was, false), []);                                // not tiered: the tier is only a starting value
  assert.deepEqual(problems({ ...was, contract_start_date: '2026-05-01', contract_end_date: '2026-04-01' }, was, false), ['The contract ends before it starts.']);
  assert.deepEqual(problems({ ...was, contract_value: 'a lot' }, was, false), ['The contract value is not a number.']);
});
