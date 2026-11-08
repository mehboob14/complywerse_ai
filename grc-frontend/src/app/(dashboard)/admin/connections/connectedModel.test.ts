// node --test "src/app/(dashboard)/admin/connections/connectedModel.test.ts"
// The register of Connected systems: how each kind's own fields become one row with one health word, the counts, the filter and the order, what "Connect a system" offers,
// and the page's address. Every fixture is made up; none holds a credential (no endpoint returns one).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { connectionHealth } from '../../../../lib/statuses/connections.ts';
import type { Connector } from '../evidence-collectors/connectionsModel.ts';
import {
  CONNECTIONS_SCHEMA, KINDS, catalogueOf, cloudRows, countsOf, entryForProvider, evidenceRows, healthOf, hostOf, isScanner, logoOf, plainProblem, scannerRows, summaryLine, toolRows,
  visibleCatalogue, visibleRows, type CloudRaw, type ScannerRaw, type ToolRaw,
} from './connectedModel.ts';

const scanner = (o: Partial<ScannerRaw> = {}): ScannerRaw => ({
  id: 1, connection_name: 'Prod Nexpose', integration_type: 'nexpose', console_url: 'https://nexpose.corp.example/', console_port: 3780, is_active: true, status: 'connected',
  last_sync_at: '2026-11-07T09:00:00', last_sync_status: 'success', ...o,
});
const cloud = (o: Partial<CloudRaw> = {}): CloudRaw => ({ id: 2, provider: 'aws_inspector', display_name: 'Prod AWS', is_active: true, last_sync_at: '2026-11-07T10:00:00', last_sync_status: 'ok', ...o });
const tool = (o: Partial<ToolRaw> = {}): ToolRaw => ({
  id: 3, provider: 'servicenow', provider_label: 'ServiceNow', category: 'ticketing', connection_name: 'Service desk', console_url: 'https://corp.service-now.example', is_active: true,
  status: 'connected', last_sync_at: null, last_sync_status: null, ...o,
});
const source = (o: Partial<Connector> = {}): Connector => ({
  id: 'github', name: 'GitHub', category: 'Dev', categories: ['Dev'], provider: 'github', supported: true, connected: true, connection_id: 9, last_run: { status: 'ok', started_at: '2026-11-06T01:00:00' }, ...o,
});

test('the four kinds are scanners, cloud security, business tools and evidence sources', () => {
  assert.deepEqual([...KINDS], ['scanners', 'cloud', 'tools', 'evidence']);
});

test('health: a pause beats everything, a failed status, run or check is failing, partial is a look, nothing proven is not run yet', () => {
  assert.equal(healthOf({ active: false, status: 'error', proven: true }), 'paused');
  assert.equal(healthOf({ active: true, status: 'deactivated', proven: true }), 'paused');
  assert.equal(healthOf({ active: true, status: 'error', proven: true }), 'failing');
  assert.equal(healthOf({ active: true, sync: 'failed', proven: true }), 'failing');
  assert.equal(healthOf({ active: true, sync: 'ok', check: 'error', proven: true }), 'failing');
  assert.equal(healthOf({ active: true, sync: 'partial', proven: true }), 'degraded');
  assert.equal(healthOf({ active: true, check: 'degraded', proven: true }), 'degraded');
  assert.equal(healthOf({ active: true, proven: false }), 'never_run');
  assert.equal(healthOf({ active: true, sync: 'success', proven: true }), 'healthy');
  for (const word of ['healthy', 'degraded', 'failing', 'never_run', 'paused']) assert.ok(connectionHealth.has(word), `${word} is a registered word`);
});

test('scanners: only Nexpose and Nessus are scanners (the endpoint returns every connection of the tenant, evidence collectors and tools too)', () => {
  const mixed = [scanner(), scanner({ id: 4, integration_type: 'github', connection_name: 'GitHub evidence collector' }), scanner({ id: 5, integration_type: 'servicenow', connection_name: 'Service desk' }), scanner({ id: 6, integration_type: 'Nessus', connection_name: 'Tenable' })];
  assert.deepEqual(mixed.filter(isScanner).map((c) => c.id), [1, 6]);
  const rows = scannerRows(mixed);
  assert.deepEqual(rows.map((r) => r.key), ['scanners:1', 'scanners:6']);
  assert.equal(rows[0].type, 'Rapid7 Nexpose');
  assert.equal(rows[1].type, 'Tenable Nessus');
  assert.equal(rows[0].detail, 'nexpose.corp.example', 'the address without scheme or trailing slash');
  assert.equal(rows[0].health, 'healthy');
  assert.equal(scannerRows([scanner({ last_sync_at: null, last_sync_status: null })])[0].health, 'never_run');
  assert.equal(scannerRows([scanner({ is_active: false })])[0].health, 'paused');
  assert.equal(scannerRows([scanner({ status: 'error', last_sync_status: 'failed' })])[0].health, 'failing');
});

test('cloud: the later of the sync and the health check is the last run, an error text loses its program-error prefix', () => {
  const row = cloudRows([cloud({ last_health_check_at: '2026-11-08T08:00:00', last_health_status: 'ok', last_sync_status: 'error', last_sync_error: 'ClientError: AccessDenied for sts:AssumeRole' })])[0];
  assert.equal(row.lastRun, '2026-11-08T08:00:00');
  assert.equal(row.health, 'failing');
  assert.equal(row.problem, 'AccessDenied for sts:AssumeRole');
  assert.equal(row.type, 'AWS Inspector v2');
  assert.equal(cloudRows([cloud({ last_sync_at: null, last_sync_status: null })])[0].health, 'never_run');
  assert.equal(cloudRows([cloud({ last_sync_status: 'partial' })])[0].health, 'degraded');
  assert.equal(cloudRows([cloud({ is_active: false })])[0].health, 'paused');
});

test('tools: a tool that passed its test is connected before anything has synced; an error status fails; a tool with no label reads its code', () => {
  assert.equal(toolRows([tool()])[0].health, 'healthy');
  assert.equal(toolRows([tool({ status: 'pending' })])[0].health, 'never_run');
  assert.equal(toolRows([tool({ status: 'error' })])[0].health, 'failing');
  assert.equal(toolRows([tool({ provider_label: '' })])[0].type, 'servicenow');
  assert.equal(toolRows([tool()])[0].detail, 'corp.service-now.example');
});

test('evidence: only connected sources are rows, a failing last run is failing, no run yet is not run yet', () => {
  const rows = evidenceRows([source(), source({ id: 'okta', name: 'Okta', provider: 'okta', connected: false, last_run: null }), source({ id: 'aws', name: 'AWS', provider: 'aws', last_run: { status: 'error', started_at: '2026-11-05T01:00:00' } }), source({ id: 'jira', name: 'Jira', provider: 'jira', last_run: null }), source({ id: 'x', name: 'Soon', provider: null, supported: false, connected: false })]);
  assert.deepEqual(rows.map((r) => [r.name, r.health]), [['GitHub', 'healthy'], ['AWS', 'failing'], ['Jira', 'never_run']]);
});

test('counts are over the rows, attention is failing plus a look, and the line under the title says it in words', () => {
  const rows = [...scannerRows([scanner(), scanner({ id: 7, status: 'error' })]), ...cloudRows([cloud({ last_sync_status: 'partial' }), cloud({ id: 8, is_active: false })]), ...evidenceRows([source()])];
  const c = countsOf(rows);
  assert.deepEqual(c.byKind, { scanners: 2, cloud: 2, tools: 0, evidence: 1 });
  assert.equal(c.total, 5);
  assert.equal(c.failing, 1);
  assert.equal(c.attention, 2);
  assert.equal(c.paused, 1);
  assert.equal(summaryLine(c), '5 systems · 2 need attention · 1 paused');
  assert.equal(summaryLine(countsOf(rows.slice(0, 1))), '1 system');
  assert.equal(summaryLine(countsOf([...rows.slice(0, 1), ...scannerRows([scanner({ id: 9, status: 'error' })])])), '2 systems · 1 needs attention');
});

test('the filter: kind, status and a search that ignores case and accents; failing first, then by name', () => {
  const rows = [...scannerRows([scanner({ id: 1, connection_name: 'Zeta' }), scanner({ id: 2, connection_name: 'Alpha', status: 'error' })]), ...cloudRows([cloud({ display_name: 'Beta', is_active: false })]), ...evidenceRows([source({ name: 'Café Git' })])];
  assert.deepEqual(visibleRows(rows, { kind: 'all', query: '', status: 'all' }).map((r) => r.name), ['Alpha', 'Café Git', 'Zeta', 'Beta'], 'failing, healthy by name, paused last');
  assert.deepEqual(visibleRows(rows, { kind: 'scanners', query: '', status: 'all' }).map((r) => r.name), ['Alpha', 'Zeta']);
  assert.deepEqual(visibleRows(rows, { kind: 'all', query: '', status: 'attention' }).map((r) => r.name), ['Alpha']);
  assert.deepEqual(visibleRows(rows, { kind: 'all', query: '', status: 'paused' }).map((r) => r.name), ['Beta']);
  assert.deepEqual(visibleRows(rows, { kind: 'all', query: 'cafe', status: 'all' }).map((r) => r.name), ['Café Git']);
  assert.deepEqual(visibleRows(rows, { kind: 'all', query: 'rapid7', status: 'all' }).map((r) => r.name), ['Alpha', 'Zeta'], 'the type is searched too');
  assert.deepEqual(visibleRows(rows, { kind: 'all', query: 'nothing here', status: 'all' }), []);
});

test('the connect catalogue offers scanners, cloud providers, tools by group and only the evidence sources that can collect; a connected one says how many', () => {
  const connected = [...scannerRows([scanner()]), ...cloudRows([cloud(), cloud({ id: 5, display_name: 'Second AWS' })]), ...evidenceRows([source()])];
  const entries = catalogueOf({
    cloudProviders: [{ provider: 'aws_inspector', label: 'AWS Inspector v2' }, { provider: 'gcp_scc', label: 'GCP', framework: 'cloud_connector' }, { provider: 'nessus', label: 'Tenable Nessus (legacy)', framework: 'legacy_scanner' }],
    toolProviders: [{ provider: 'splunk', label: 'Splunk', category: 'siem', description: 'Pull signals' }, { provider: 'servicenow', label: 'ServiceNow', category: 'ticketing', description: 'Tickets' }],
    evidence: [source(), source({ id: 'okta', name: 'Okta', provider: 'okta', connected: false }), source({ id: 'later', name: 'Later', provider: null, supported: false, connected: false })],
    connected,
  });
  assert.deepEqual(entries.map((e) => e.key), ['scanners:nexpose', 'scanners:nessus', 'cloud:aws_inspector', 'cloud:gcp_scc', 'tools:servicenow', 'tools:splunk', 'evidence:github', 'evidence:okta']);
  assert.equal(entries.find((e) => e.key === 'scanners:nexpose')?.connected, 1);
  assert.equal(entries.find((e) => e.key === 'cloud:aws_inspector')?.connected, 2);
  assert.equal(entries.find((e) => e.key === 'evidence:okta')?.connected, 0);
  assert.equal(entries.find((e) => e.key === 'tools:servicenow')?.group, 'ticketing');
  assert.deepEqual(visibleCatalogue(entries, { kind: 'tools', query: '' }).map((e) => e.provider), ['servicenow', 'splunk']);
  assert.deepEqual(visibleCatalogue(entries, { kind: 'all', query: 'tenable' }).map((e) => e.provider), ['nessus']);
  assert.equal(entryForProvider(entries, 'AWS_Inspector')?.kind, 'cloud', 'a ?provider= link is matched without case');
  assert.equal(entryForProvider(entries, 'nope'), undefined);
  assert.equal(entryForProvider(entries, ''), undefined);
});

test('helpers: a console address loses its scheme, a failure its program-error name, a logo maps to a bundled file', () => {
  assert.equal(hostOf('HTTPS://nexpose.corp.example:3780/'), 'nexpose.corp.example:3780');
  assert.equal(hostOf(null), '');
  assert.equal(plainProblem('  '), null);
  assert.equal(plainProblem('requests.exceptions.ConnectionError: the host did not answer'), 'the host did not answer');
  assert.equal(plainProblem('Timed out waiting for the scanner'), 'Timed out waiting for the scanner');
  assert.ok((plainProblem('x'.repeat(600)) ?? '').length <= 240);
  assert.equal(logoOf('aws_inspector'), 'aws');
  assert.equal(logoOf('nessus'), 'tenable');
  assert.equal(logoOf('servicenow'), 'servicenow');
});

test('the address keeps kind, search and status, and every link that already exists keeps working', () => {
  assert.deepEqual(readAddress(CONNECTIONS_SCHEMA, 'kind=cloud&q=prod&status=attention'), { kind: 'cloud', q: 'prod', status: 'attention', provider: '', connector: '', return: '' });
  assert.equal(readAddress(CONNECTIONS_SCHEMA, 'kind=banana').kind, 'all', 'a kind nobody knows is all');
  assert.equal(readAddress(CONNECTIONS_SCHEMA, '').status, 'all');
  const old = readAddress(CONNECTIONS_SCHEMA, 'kind=evidence&connector=github&return=%2Fautomation%2Fsoc2-controls%2FIAC-06');
  assert.equal(old.connector, 'github');
  assert.equal(old.return, '/automation/soc2-controls/IAC-06');
  assert.equal(readAddress(CONNECTIONS_SCHEMA, 'provider=aws_inspector').provider, 'aws_inspector');
  assert.equal(writeAddress(CONNECTIONS_SCHEMA, 'kind=cloud&foo=1', { ...readAddress(CONNECTIONS_SCHEMA, 'kind=cloud&foo=1'), kind: 'all' }).includes('foo=1'), true, 'a parameter the schema does not list is left alone');
});
