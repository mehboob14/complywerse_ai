// node --test "src/app/(dashboard)/issues/[[]id]/_linked/linkedModel.test.ts"
// The Linked records tab of an issue: nine kinds, counts that add up, a row that says what it is and opens its record, and the id each server REMOVE route takes (read from the router itself,
// because a wrong id there unlinks nothing and says nothing), what an ADD sends, and what is already linked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { FAMILIES, addBody, countOf, familiesWithRecords, familyOf, linkedRow, linkedTotal, linkedValues, sourceHref } from './linkedModel.ts';

const BACKEND = fileURLToPath(new URL('../../../../../../../backend/grc/modules/issue_management/routers/', import.meta.url));
const links = readFileSync(`${BACKEND}links.py`, 'utf8');
const issues = readFileSync(`${BACKEND}issues.py`, 'utf8');

test('every kind of record the server counts for an issue has a place, and the tab counts all of them', () => {
  const block = /payload\["link_counts"\] = \{([\s\S]*?)\n    \}/.exec(issues)![1];
  const served = Array.from(block.matchAll(/"([a-z]+)":/g)).map((m) => m[1]).filter((k) => k !== 'actions' && k !== 'comments').sort();
  assert.deepEqual(FAMILIES.map((f) => f.count).slice().sort(), served, 'the families are exactly the counts GET /issues/{id} returns (apart from actions and comments, which have their own tabs)');
  const counts = { vulnerabilities: 1, risks: 2, assets: 0, controls: 3, evidence: 0, vendors: 0, projects: 1, governance: 2, tasks: 1, actions: 9, comments: 9 };
  assert.equal(linkedTotal(counts), 10, 'actions and comments are not linked records');
  assert.deepEqual(familiesWithRecords(counts).map((f) => f.key), ['vulns', 'risks', 'controls', 'projects', 'governance', 'tasks']);
  assert.equal(linkedTotal(undefined), 0);
  assert.equal(countOf({ risks: 4 }, familyOf('risks')), 4);
  assert.equal(countOf({}, familyOf('tasks')), 0, 'an older server that does not count tasks says none, not NaN');
});

test('a risk, an asset, a vulnerability, evidence, a vendor and a project open their pages and unlink by the RECORD id', () => {
  const risk = linkedRow('risks', { id: 11, risk_id: 5, title: 'Payments outage', status: 'open', residual_score: 12.4 });
  assert.deepEqual([risk.title, risk.sub, risk.href, risk.unlink], ['Payments outage', 'Open · Residual 12', '/erm/risks/5', { family: 'risks', id: 5 }]);
  assert.deepEqual(linkedRow('assets', { id: 1, asset_id: 8, name: 'Core switch', type: 'network', criticality: 'high' }).href, '/cyber-assurance/assets/8');
  const vuln = linkedRow('vulns', { id: 2, vulnerability_id: 3, vuln_id: 'CVE-2026-1', title: 'Weak TLS', severity: 'high', cvss_score: 7.5, kev_flag: true });
  assert.deepEqual([vuln.title, vuln.sub, vuln.href, vuln.unlink, vuln.severity], ['Weak TLS', 'CVE-2026-1 · Known exploited · CVSS 7.5', '/cyber-assurance/vulnerabilities/3', { family: 'vulns', id: 3 }, 'high']);
  assert.equal(linkedRow('vulns', { id: 2, vulnerability_id: 3, vuln_id: 'CVE-2026-1', title: null }).title, 'CVE-2026-1');
  assert.equal(linkedRow('evidence', { id: 4, evidence_id: 9, name: 'Scan report', relationship_type: 'proof' }).sub, 'Proof');
  assert.equal(linkedRow('vendors', { id: 4, vendor_id: 2, name: 'Acme', contract_reference: 'C-7', breach_clause: '4.2' }).sub, 'Contract C-7 · Clause 4.2');
  assert.equal(linkedRow('projects', { id: 4, is_project_id: 6, name: 'SOC build', status: 'active', health: 'on_track' }).sub, 'Active · On track');
  // the server's remove routes take the record's id for these six, and the link row's id for controls and documents
  for (const route of ['vulns/{vuln_id}', 'risks/{risk_id}', 'assets/{asset_id}', 'evidence/{evidence_id}', 'vendors/{vendor_id}', 'projects/{project_id}', 'controls/{link_id}', 'governance/{link_id}']) {
    assert.ok(links.includes(`/links/${route}"`), route);
  }
});

test('a control and a document unlink by the LINK row\'s id, and open only where they have a page', () => {
  const internal = linkedRow('controls', { id: 31, target_type: 'internal', control_id: 5, code: 'IC-5', name: 'Patching' });
  assert.deepEqual([internal.title, internal.sub, internal.href, internal.unlink], ['Patching', 'IC-5 · Internal control', '/erm/internal-controls/5', { family: 'controls', id: 31 }]);
  assert.equal(linkedRow('controls', { id: 32, target_type: 'normalized', control_id: 9, code: 'IAC-01', name: null }).title, 'Control IAC-01');
  assert.equal(linkedRow('controls', { id: 32, target_type: 'normalized', control_id: 9, name: 'Access' }).href, '/control-library/9');
  assert.equal(linkedRow('controls', { id: 33, target_type: 'framework', control_id: 9, name: 'Access' }).href, null, 'a framework requirement has no page of its own here');
  const doc = linkedRow('governance', { id: 41, target_type: 'governance_document', target_id: 12, title: 'Access policy', code: 'POL-1' });
  assert.deepEqual([doc.sub, doc.href, doc.unlink], ['Document · POL-1', '/governance/documents/12', { family: 'governance', id: 41 }]);
  const statement = linkedRow('governance', { id: 42, target_type: 'policy_statement', target_id: 3, title: null });
  assert.deepEqual([statement.title, statement.href, statement.unlink], ['A policy statement', null, { family: 'governance', id: 42 }]);
});

test('a task opens in Task Management and cannot be unlinked here', () => {
  const task = linkedRow('tasks', { id: 7, task_id: 7, title: 'Patch it', status: 'In Progress', priority: 'High', from_action: true });
  assert.deepEqual([task.title, task.sub, task.href, task.unlink], ['Patch it', 'In Progress · High · From a corrective action', '/tasks/7', null]);
  assert.equal(familyOf('tasks').canAdd, false);
  assert.equal(addBody('tasks', '7'), null);
});

test('a row whose record was deleted under the link still reads as a sentence, never a blank or an id', () => {
  for (const family of FAMILIES) {
    const row = linkedRow(family.key, { id: 1 });
    assert.match(row.title, /^An? /, family.key);
    assert.equal(row.href, family.key === 'tasks' ? '/tasks/1' : null, `${family.key}: a link row with no record id opens nothing (a task's row id is the task's)`);
  }
});

test('an ADD sends what the server reads: the record\'s id, or the kind and id of a control or document', () => {
  assert.deepEqual(addBody('risks', '5'), { risk_id: 5 });
  assert.deepEqual(addBody('vulns', '5'), { vulnerability_id: 5 });
  assert.deepEqual(addBody('assets', '5'), { asset_id: 5 });
  assert.deepEqual(addBody('evidence', '5'), { evidence_id: 5 });
  assert.deepEqual(addBody('vendors', '5'), { vendor_id: 5 });
  assert.deepEqual(addBody('projects', '5'), { is_project_id: 5 });
  assert.deepEqual(addBody('controls', 'internal:5'), { target_type: 'internal', control_id: 5 });
  assert.deepEqual(addBody('controls', 'normalized:9'), { target_type: 'normalized', control_id: 9 });
  assert.deepEqual(addBody('governance', 'policy_statement:3'), { target_type: 'policy_statement', target_id: 3 });
  assert.equal(addBody('controls', '5'), null, 'a control needs its kind');
  assert.equal(addBody('governance', 'invoice:3'), null);
  assert.equal(addBody('risks', 'abc'), null);
  assert.equal(addBody('risks', '0'), null);
});

test('what is already linked is not offered again', () => {
  assert.deepEqual(Array.from(linkedValues('risks', [{ risk_id: 5 }, { risk_id: 6 }])).sort(), ['5', '6']);
  assert.deepEqual(Array.from(linkedValues('controls', [{ id: 31, target_type: 'internal', control_id: 5 }])), ['internal:5']);
  assert.deepEqual(Array.from(linkedValues('governance', [{ id: 1, target_type: 'governance_document', target_id: 12 }])), ['governance_document:12']);
  assert.equal(linkedValues('tasks', [{ id: 1 }]).size, 0);
});

test('the record an issue was raised from opens when it has a page of its own, and nothing else is guessed', () => {
  assert.equal(sourceHref('risk', 5), '/erm/risks/5');
  assert.equal(sourceHref('vulnerability', 3), '/cyber-assurance/vulnerabilities/3');
  assert.equal(sourceHref('asset', 8), '/cyber-assurance/assets/8');
  assert.equal(sourceHref('governance_document', 2), '/governance/documents/2');
  assert.equal(sourceHref('control_internal', 4), '/erm/internal-controls/4');
  for (const none of ['manual', 'import', 'workflow', 'kri_breach', 'risk_incident', null, undefined]) assert.equal(sourceHref(none as never, 5), null, String(none));
  assert.equal(sourceHref('risk', null), null);
  assert.equal(sourceHref('risk', 0), null);
});
