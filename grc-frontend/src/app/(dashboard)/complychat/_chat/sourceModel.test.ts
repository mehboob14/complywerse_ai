// node --test "src/app/(dashboard)/complychat/_chat/sourceModel.test.ts"
// How sources read on screen: a kind's plain name, a title, a short extract, a link only when the page is known, no type key, no id, no score;
// and every link the model can make resolves in the navigation registry (a dead link is a test failure, not a 404 for the person).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LINKED_TYPES, sourcesLabel, viewOfSource, viewsOf } from './sourceModel.ts';
import { routeFor } from '../../../../lib/navRegistry.ts';
import type { ChatSource } from './chatModel.ts';

test('a stored document names its kind, links to its page and shows no key, id or score', () => {
  const v = viewOfSource({ rank: 1, entity_type: 'governance_document', entity_id: '12', framework_code: 'Governance Document', control_code: '12', control_name: 'Access control policy', relevance_score: 0.83, snippet: 'All access must be approved.', kind: 'record', label: 'Document' }, 0);
  assert.deepEqual({ ...v, key: '' }, { key: '', label: 'Document', title: 'Access control policy', snippet: 'All access must be approved.', href: '/governance/documents/12', kind: 'record' });
  const shown = JSON.stringify([v.label, v.title, v.snippet]);
  for (const hidden of ['governance_document', '0.83', '83', 'Governance Document']) assert.equal(shown.includes(hidden), false, hidden);
});

test('the three kinds with a page link to it; a type with no page of its own links nowhere; a non-numeric id never makes a link', () => {
  assert.equal(viewOfSource({ entity_type: 'evidence_file', entity_id: '7', control_name: 'Backup log' }, 0).href, '/evidence/7');
  assert.equal(viewOfSource({ entity_type: 'grc_compliance_assessment', entity_id: '4' }, 0).href, '/compliance/assessments/4');
  assert.equal(viewOfSource({ entity_type: 'policy_statement', entity_id: '4' }, 0).href, null);
  assert.equal(viewOfSource({ entity_type: 'governance_document', entity_id: '../../admin' }, 0).href, null);
  assert.equal(viewOfSource({ entity_type: 'governance_document', entity_id: '' }, 0).href, null);
  assert.equal(viewOfSource({ entity_type: 'governance_document', entity_id: null }, 0).href, null);
  assert.equal(viewOfSource({ entity_type: 'constructor', entity_id: '1' }, 0).href, null, 'a type named like an Object method is no page');
});

test('every link the page can make resolves to a page in the navigation registry', () => {
  const expected: Record<string, string> = { governance_document: '/governance/documents/:id', evidence_file: '/evidence/:id', grc_compliance_assessment: '/compliance/assessments/:id' };
  assert.deepEqual(LINKED_TYPES.sort(), Object.keys(expected).sort());
  for (const type of LINKED_TYPES) {
    const href = viewOfSource({ entity_type: type, entity_id: '5' }, 0).href;
    assert.ok(href, type);
    assert.equal(routeFor(href as string)?.path, expected[type], `${type} -> ${href}`);
  }
});

test('the platform\'s own records and an attached file are named plainly, whatever the type key says', () => {
  const live = viewOfSource({ entity_type: 'risks', framework_code: 'Live Data', control_name: 'Risks — 10 item(s) found', snippet: '10 record(s) retrieved from your platform', kind: 'live_data', label: 'Risks' }, 0);
  assert.deepEqual([live.label, live.kind, live.snippet, live.href], ['Platform records', 'live_data', '', null]);
  const older = viewOfSource({ entity_type: 'risks', framework_code: 'Live Data', control_name: 'Risks — 10 item(s) found' }, 0);
  assert.equal(older.kind, 'live_data', 'a chat kept before kind existed reads the same');
  const file = viewOfSource({ entity_type: 'chat_upload', entity_id: 'abc123', control_name: 'policy.pdf', snippet: 'text of the file' }, 0);
  assert.deepEqual([file.label, file.kind, file.href, file.title], ['Your file', 'your_file', null, 'policy.pdf']);
});

test('an unknown type is named in words, a missing title falls back to the kind, a long extract is cut', () => {
  assert.equal(viewOfSource({ entity_type: 'some_new_type', entity_id: '1' }, 0).label, 'Some new type');
  assert.equal(viewOfSource({ entity_type: 'some_new_type' }, 0).title, 'Some new type');
  assert.equal(viewOfSource({}, 0).label, 'Source');
  const long = viewOfSource({ entity_type: 'evidence_file', entity_id: '1', snippet: 'word '.repeat(200) }, 0);
  assert.ok(long.snippet.length <= 220 && long.snippet.endsWith('…'));
});

test('a record cited twice is listed once, in the server\'s order; sources with no id are all kept', () => {
  const s: ChatSource[] = [
    { entity_type: 'evidence_file', entity_id: '1', control_name: 'A' }, { entity_type: 'evidence_file', entity_id: '1', control_name: 'A again' },
    { entity_type: 'governance_document', entity_id: '2', control_name: 'B' }, { entity_type: 'risks', control_name: 'live 1' }, { entity_type: 'risks', control_name: 'live 2' },
  ];
  assert.deepEqual(viewsOf(s).map((v) => v.title), ['A', 'B', 'live 1', 'live 2']);
  assert.deepEqual(viewsOf(undefined), []);
  assert.equal(sourcesLabel(3), 'Sources (3)');
});
