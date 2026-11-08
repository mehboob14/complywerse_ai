// node --test "src/app/(dashboard)/admin/connections/credentialModel.test.ts"
// The connect forms of Connected systems: what is wrong with what was typed (in words, never with the value), the exact payloads, and the one rule about credentials: they are
// write-only, so a blank secret is never sent on a change and no message repeats what was typed. Every credential in this file is a made-up value.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SCHEDULE, SCANNER_PORT, cloudCredentials, cloudFields, cloudProblems, emptyScanner, isSecretField, isServiceAccountKey, scannerKeysPatch, scannerPayload, scannerProblems,
  scheduleLabel, splitRegions, syncSeconds, toolFieldsToSend, toolInitialValues, toolProblems, type ToolFieldMeta,
} from './credentialModel.ts';

const FAKE_SECRET = 'fake-secret-value-0000';
const FAKE_KEY = JSON.stringify({ type: 'service_account', project_id: 'demo', private_key: 'FAKE-PRIVATE-KEY' });

test('a new scanner form starts on the type\'s own port and the 4-hour schedule', () => {
  assert.equal(emptyScanner('nexpose').port, String(SCANNER_PORT.nexpose));
  assert.equal(emptyScanner('nessus').port, '8834');
  assert.equal(emptyScanner().schedule, DEFAULT_SCHEDULE);
  assert.equal(scheduleLabel('0 */4 * * *'), 'Every 4 hours');
  assert.equal(scheduleLabel('15 3 * * 1'), 'Custom schedule');
  assert.equal(scheduleLabel(''), 'Not set');
});

test('scanner problems are said field by field and an empty form says them all', () => {
  const p = scannerProblems(emptyScanner());
  assert.deepEqual(Object.keys(p).sort(), ['accessKey', 'name', 'secretKey', 'url']);
  assert.equal(scannerProblems({ ...emptyScanner(), name: 'A', url: 'nexpose.corp', accessKey: 'a', secretKey: 'b' }).url, 'Start the address with https:// (or http://).');
  assert.equal(scannerProblems({ ...emptyScanner(), name: 'A', url: 'https://x', accessKey: 'a', secretKey: 'b', port: '99999' }).port, 'Enter a port between 1 and 65535.');
  assert.deepEqual(scannerProblems({ ...emptyScanner(), name: 'A', url: 'https://x', accessKey: 'a', secretKey: 'b' }), {});
  assert.deepEqual(Object.keys(scannerProblems({ ...emptyScanner(), name: 'A', url: 'https://x', mode: 'server' })), ['prefix'], 'the server-settings path needs its prefix, not keys');
});

test('the scanner payload sends keys typed here, or the server prefix, never both, and leaves an untyped optional out', () => {
  const keys = scannerPayload({ ...emptyScanner('nessus'), name: ' Prod ', url: ' https://nessus.corp ', port: '8834', accessKey: 'AK', secretKey: FAKE_SECRET });
  assert.deepEqual(keys, { connection_name: 'Prod', integration_type: 'nessus', console_url: 'https://nessus.corp', console_port: 8834, sync_schedule: DEFAULT_SCHEDULE, access_key: 'AK', secret_key: FAKE_SECRET });
  assert.equal('credential_env_prefix' in keys, false);
  assert.equal('username' in keys && 'password' in keys, false);
  const server = scannerPayload({ ...emptyScanner(), name: 'P', url: 'https://x', mode: 'server', prefix: ' NEXPOSE_PROD ', username: 'svc', password: FAKE_SECRET, accessKey: 'ignored', secretKey: 'ignored' });
  assert.equal(server.credential_env_prefix, 'NEXPOSE_PROD');
  assert.equal('access_key' in server, false);
  assert.equal(server.username, 'svc');
  assert.equal(server.password, FAKE_SECRET, 'a password is sent exactly as typed (no trimming of a secret)');
});

test('replacing scanner keys sends only the key that was typed, and nothing when nothing was', () => {
  assert.deepEqual(scannerKeysPatch(' AK ', ''), { access_key: 'AK' });
  assert.deepEqual(scannerKeysPatch('', FAKE_SECRET), { secret_key: FAKE_SECRET });
  assert.equal(scannerKeysPatch('  ', ''), null);
});

test('cloud: each provider asks for its own fields, the secret ones are masked, and AWS has no secret at all', () => {
  assert.deepEqual(cloudFields('aws_inspector').map((f) => f.key), ['role_arn', 'external_id', 'regions']);
  assert.equal(cloudFields('aws_inspector').some((f) => f.secret), false);
  assert.deepEqual(cloudFields('azure_defender').filter((f) => f.secret).map((f) => f.key), ['client_secret']);
  assert.deepEqual(cloudFields('gcp_scc').filter((f) => f.secret).map((f) => f.key), ['service_account_json']);
  assert.deepEqual(cloudFields('nobody'), []);
});

test('cloud: the credentials object is built from the typed fields (no JSON is typed by hand)', () => {
  assert.deepEqual(cloudCredentials('aws_inspector', { role_arn: ' arn:aws:iam::123456789012:role/R ', external_id: 'ext', regions: 'us-east-1, EU-west-1\nus-east-1' }), { role_arn: 'arn:aws:iam::123456789012:role/R', external_id: 'ext', regions: ['us-east-1', 'eu-west-1'] });
  assert.deepEqual(cloudCredentials('azure_defender', { tenant_id: ' t ', client_id: 'c', client_secret: FAKE_SECRET, subscription_id: 's' }), { tenant_id: 't', client_id: 'c', client_secret: FAKE_SECRET, subscription_id: 's' });
  assert.deepEqual(cloudCredentials('gcp_scc', { organization_id: '123', service_account_json: FAKE_KEY }), { organization_id: '123', service_account_json: FAKE_KEY });
  assert.deepEqual(splitRegions(''), []);
});

test('cloud problems: said in words per field, the AWS shapes follow the server, and no message repeats a typed value', () => {
  const aws = cloudProblems('aws_inspector', { role_arn: 'not-an-arn', external_id: '', regions: 'us-east-1, mars' }, '');
  assert.deepEqual(Object.keys(aws).sort(), ['external_id', 'name', 'regions', 'role_arn']);
  assert.match(aws.regions, /One region does not look like an AWS region/);
  assert.deepEqual(cloudProblems('aws_inspector', { role_arn: 'arn:aws:iam::123456789012:role/GRC-Reader', external_id: 'x', regions: 'us-east-1' }, 'Prod'), {});
  const azure = cloudProblems('azure_defender', { tenant_id: 'not a uuid!', client_id: '00000000-0000-0000-0000-000000000000', client_secret: FAKE_SECRET, subscription_id: '00000000-0000-0000-0000-000000000000' }, 'Az');
  assert.deepEqual(Object.keys(azure), ['tenant_id']);
  const gcp = cloudProblems('gcp_scc', { organization_id: 'abc', service_account_json: `{"type":"user","private_key":"${FAKE_SECRET}"}` }, 'G');
  assert.deepEqual(Object.keys(gcp).sort(), ['organization_id', 'service_account_json']);
  for (const message of Object.values({ ...aws, ...azure, ...gcp })) assert.equal(message.includes(FAKE_SECRET) || message.includes('not-an-arn') || message.includes('mars'), false, `"${message}" repeats a typed value`);
  assert.deepEqual(cloudProblems('gcp_scc', { organization_id: '1', service_account_json: FAKE_KEY }, 'G'), {});
});

test('a key file counts only when it is a service account key', () => {
  assert.equal(isServiceAccountKey(FAKE_KEY), true);
  assert.equal(isServiceAccountKey('{"type":"authorized_user"}'), false);
  assert.equal(isServiceAccountKey('not json'), false);
  assert.equal(isServiceAccountKey('null'), false);
});

test('the sync interval in hours is seconds for the server and falls back to 6 hours when it is not a whole number in range', () => {
  assert.equal(syncSeconds('6'), 21600);
  assert.equal(syncSeconds(' 24 '), 86400);
  assert.equal(syncSeconds('0'), 21600);
  assert.equal(syncSeconds('999'), 21600);
  assert.equal(syncSeconds('abc'), 21600);
});

const FIELDS: ToolFieldMeta[] = [
  { key: 'console_url', label: 'Instance URL', kind: 'url', required: true, is_credential: false },
  { key: 'username', label: 'User name', kind: 'text', required: true, is_credential: false },
  { key: 'api_token', label: 'API token', kind: 'password', required: true, is_credential: true },
  { key: 'webhook', label: 'Webhook', kind: 'textarea', required: false, is_credential: true },
  { key: 'verify', label: 'Verify certificates', kind: 'toggle', required: false, is_credential: false },
];

test('tools: a secret is a field the server marks as a credential or one typed as a password', () => {
  assert.deepEqual(FIELDS.filter(isSecretField).map((f) => f.key), ['api_token', 'webhook']);
});

test('tools: creating asks for every required field; changing a connection keeps its saved secrets without asking again', () => {
  assert.deepEqual(Object.keys(toolProblems(FIELDS, {}, '', false)).sort(), ['api_token', 'console_url', 'name', 'username']);
  assert.deepEqual(Object.keys(toolProblems(FIELDS, { console_url: 'https://x', username: 'u' }, 'N', true)), [], 'a saved token need not be typed again');
  assert.deepEqual(Object.keys(toolProblems(FIELDS, { console_url: 'https://x', username: '' }, 'N', true)), ['username']);
});

test('tools: on a change a blank secret is NOT sent (the server would overwrite the saved one with blank); on create blanks are left out', () => {
  assert.deepEqual(toolFieldsToSend(FIELDS, { console_url: ' https://x ', username: ' u ', api_token: '', webhook: '' }, true), { console_url: 'https://x', username: 'u' });
  assert.deepEqual(toolFieldsToSend(FIELDS, { console_url: 'https://x', username: 'u', api_token: FAKE_SECRET }, true), { console_url: 'https://x', username: 'u', api_token: FAKE_SECRET });
  assert.deepEqual(toolFieldsToSend(FIELDS, { console_url: 'https://x', username: 'u', api_token: FAKE_SECRET, webhook: '  ' }, false), { console_url: 'https://x', username: 'u', api_token: FAKE_SECRET });
  assert.equal(toolFieldsToSend(FIELDS, { api_token: ' pad ' }, false).api_token, ' pad ', 'a secret is sent as typed');
});

test('tools: the change form starts from the saved address and settings and never from a credential', () => {
  const v = toolInitialValues(FIELDS, { console_url: 'https://x', provider_config: { username: 'u', api_token: 'SHOULD-NEVER-COME-BACK', _oauth: 'internal', verify: true, nested: { a: 1 } } });
  assert.deepEqual(v, { console_url: 'https://x', username: 'u', verify: 'true', nested: '{"a":1}' });
  assert.equal(Object.values(v).includes('SHOULD-NEVER-COME-BACK'), false);
  assert.deepEqual(toolInitialValues(FIELDS, null), {});
});
