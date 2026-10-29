// node --test "src/app/(dashboard)/vendor-risk/_lib/vendorSave.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyForm, formFrom } from './vendorFormModel.ts';
import { addVendor, editVendor, type VendorCalls } from './vendorSave.ts';

/** Fake calls that record what was asked, in order; `fail` names the ones that throw. */
function fake(fail: Partial<Record<keyof VendorCalls, unknown>> = {}) {
  const log: Array<[string, ...unknown[]]> = [];
  const calls: VendorCalls = {
    createVendor: async (body) => { log.push(['createVendor', body]); if (fail.createVendor) throw fail.createVendor; return { id: 41, name: body.name, ...body }; },
    updateVendor: async (id, body) => { log.push(['updateVendor', id, body]); if (fail.updateVendor) throw fail.updateVendor; return { id, ...body }; },
    addEngagement: async (vendorId, name) => { log.push(['addEngagement', vendorId, name]); if (fail.addEngagement) throw fail.addEngagement; return 77; },
    startLifecycle: async (vendorId, engagementId) => { log.push(['startLifecycle', vendorId, engagementId]); if (fail.startLifecycle) throw fail.startLifecycle; return {}; },
  };
  return { calls, log, names: () => log.map((l) => l[0]) };
}

const form = { ...emptyForm(), name: 'Acme Analytics' };
const added = { form, firstEngagement: '', startLifecycle: true, allowDuplicate: false };

test('a new vendor goes with the tenant\'s own fields, and its lifecycle starts afterwards', async () => {
  const { calls, log } = fake();
  const custom = { region: 'EMEA', renewal_owner: null };
  const done = await addVendor(calls, { ...added, customValues: custom });
  assert.deepEqual(log.map((l) => l[0]), ['createVendor', 'startLifecycle']);
  assert.deepEqual((log[0][1] as Record<string, unknown>).custom_values, custom);        // the custom fields are saved with the vendor
  assert.deepEqual(log[1], ['startLifecycle', 41, null]);                               // General's lifecycle: the vendor has no engagement
  assert.equal(done.saved.id, 41);
  assert.equal(done.note, null);
});

test('a tenant with no custom fields sends none, and unticking "Start the lifecycle now" starts nothing', async () => {
  const { calls, log, names } = fake();
  await addVendor(calls, { ...added, customValues: undefined, startLifecycle: false });
  assert.deepEqual(names(), ['createVendor']);
  assert.equal('custom_values' in (log[0][1] as object), false);
  assert.equal('allow_duplicate' in (log[0][1] as object), false);
});

test('a vendor that may duplicate one on record is sent with the override only when the person chose to add it', async () => {
  const { calls, log } = fake();
  await addVendor(calls, { ...added, allowDuplicate: true });
  assert.equal((log[0][1] as Record<string, unknown>).allow_duplicate, true);
});

test('a first engagement is made after the vendor, and the lifecycle starts on it', async () => {
  const { calls, log, names } = fake();
  const done = await addVendor(calls, { ...added, firstEngagement: '  Campaign attribution ' });
  assert.deepEqual(names(), ['createVendor', 'addEngagement', 'startLifecycle']);
  assert.deepEqual(log[1], ['addEngagement', 41, 'Campaign attribution']);
  assert.deepEqual(log[2], ['startLifecycle', 41, 77]);
  assert.equal(done.note, null);
});

test('an engagement that is refused leaves the vendor added, says so, and the lifecycle starts on General', async () => {
  const { calls, log } = fake({ addEngagement: { response: { data: { detail: 'General is the vendor itself: name what this engagement is for' } } } });
  const done = await addVendor(calls, { ...added, firstEngagement: 'General' });
  assert.equal(done.saved.id, 41);
  assert.equal(done.note, 'The engagement was not added: General is the vendor itself: name what this engagement is for');
  assert.deepEqual(log[log.length - 1], ['startLifecycle', 41, null]);
});

test('a lifecycle that cannot start never undoes the vendor', async () => {
  const { calls, names } = fake({ startLifecycle: new Error('boom') });
  const done = await addVendor(calls, added);
  assert.deepEqual(names(), ['createVendor', 'startLifecycle']);
  assert.equal(done.saved.id, 41);
  assert.equal(done.note, null);
});

test('a vendor the server refuses stops everything after it, and the refusal reaches the dialog', async () => {
  const refusal = { response: { status: 409, data: { detail: 'A vendor named “Acme Analytics” already exists (ID 5).' } } };
  const { calls, names } = fake({ createVendor: refusal });
  await assert.rejects(addVendor(calls, { ...added, firstEngagement: 'Payroll' }), (e) => e === refusal);
  assert.deepEqual(names(), ['createVendor']);
});

const vendor = {
  id: 7, name: 'Meridian Payroll', vendor_type: 'Supplier', industry: 'Payroll', website: 'meridian.example', tier: 'high', status: 'active',
  data_access_level: 'confidential', services_provided: ['Payroll'], custom_values: { region: 'UK' }, contract_value: 42000,
};

test('saving an edit nobody changed sends nothing', async () => {
  const { calls, log } = fake();
  const was = formFrom(vendor);
  const done = await editVendor(calls, vendor, { form: { ...was }, was });
  assert.deepEqual(log, []);
  assert.equal(done.saved, vendor);
});

test('an edit sends only what changed, and the tenant\'s own fields that changed', async () => {
  const { calls, log } = fake();
  const was = formFrom(vendor);
  const done = await editVendor(calls, vendor, { form: { ...was, industry: 'Payroll and tax' }, was, customValues: { region: 'EMEA' } });
  assert.deepEqual(log, [['updateVendor', 7, { industry: 'Payroll and tax', custom_values: { region: 'EMEA' } }]]);
  assert.equal(done.saved.industry, 'Payroll and tax');
});

test('an edit of only the tenant\'s own fields still saves them', async () => {
  const { calls, log } = fake();
  const was = formFrom(vendor);
  await editVendor(calls, vendor, { form: { ...was }, was, customValues: { region: null } });
  assert.deepEqual(log, [['updateVendor', 7, { custom_values: { region: null } }]]);       // a cleared field goes as null
});
