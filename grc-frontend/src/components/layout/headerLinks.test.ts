import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appPath, approvalAnchor, assessmentApprovalHref, docRequestHref, notificationHref } from './headerLinks.ts';
import { actionHref } from '../../lib/documentTasks.ts';

test('only a page of this app is opened, never another site', () => {
  assert.equal(appPath('/governance/documents/3?tab=lifecycle'), '/governance/documents/3?tab=lifecycle');
  assert.equal(appPath('  /tasks  '), '/tasks');
  for (const bad of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', 'governance/documents/3', '', null, undefined]) {
    assert.equal(appPath(bad), null, String(bad));
  }
  // the browser drops tabs and line breaks, so these would open evil.example
  for (const bad of ['/\t/evil.example/x', '/\n/evil.example', '/\r\\evil.example', '/\t\\evil.example']) {
    assert.equal(new URL(bad, 'https://app.test/').host === 'app.test', false, JSON.stringify(bad));   // what makes them dangerous
    assert.equal(appPath(bad), null, JSON.stringify(bad));
  }
});

test('a notification opens its link first', () => {
  assert.equal(notificationHref({ link: '/governance/documents/5?tab=lifecycle', message: 'Open: /vendor-risk/vendors/1' }), '/governance/documents/5?tab=lifecycle');
  assert.equal(notificationHref({ link: null, url: '/tasks/9' }), '/tasks/9');
  // a link to another site is not followed; the text's page is the next choice
  assert.equal(notificationHref({ link: 'https://evil.example', message: 'Open: /vendor-risk/vendors/4?stage=findings&finding=2' }), '/vendor-risk/vendors/4?stage=findings&finding=2');
});

test('one without a link opens the page its text names, without the sentence around it', () => {
  assert.equal(notificationHref({ message: 'Payroll Co: contract expiring.\n\nOpen: /vendor-risk/contracts?contract=7' }), '/vendor-risk/contracts?contract=7');
  assert.equal(notificationHref({ message: 'Open it at /governance/documents/3 (its Approvals).' }), '/governance/documents/3');
  assert.equal(notificationHref({ message: 'Open it at /governance/documents/3.' }), '/governance/documents/3');
  assert.equal(notificationHref({ message: '/my-work has two items' }), '/my-work');
  assert.equal(notificationHref({ message: '<p>Open: /vendor-risk/vendors/4</p>' }), '/vendor-risk/vendors/4');
});

test('one with nothing to open is plain text', () => {
  for (const message of ['You have been assigned SCF control IAC-01.', 'Due 1/2 of the items', 'and/or later', 'see //evil.example', 'Ratio 3 / 4', '', undefined]) {
    assert.equal(notificationHref({ message }), null, String(message));
  }
});

test('a document request opens the person\'s own step, as My Approvals and Task Management do', () => {
  assert.equal(docRequestHref({ kind: 'acknowledgement', document_id: 3 }), '/governance/documents/3?act=ack');
  assert.equal(docRequestHref({ kind: 'review', document_id: 3 }), '/governance/documents/3?act=sign');
  assert.equal(docRequestHref({ kind: 'approval', document_id: 8 }), '/governance/documents/8?act=sign');
  assert.equal(docRequestHref({ kind: 'approval', document_id: 8 }), actionHref(8, 'approval'));
  // a decision on a proposed change (the owner) or the proposer's revision opens Proposed changes on it
  assert.equal(docRequestHref({ kind: 'decide', document_id: 8, proposal_id: 4 }), '/governance/documents/8?tab=proposals&proposal=4');
  assert.equal(docRequestHref({ kind: 'revise', document_id: 8 }), '/governance/documents/8?tab=proposals');
});

test('an evidence approval opens the approvals page at its own item', () => {
  assert.equal(assessmentApprovalHref({ id: 12 }), '/compliance/assessments/approvals#approval-compliance-12');
  assert.equal(approvalAnchor('evidence', 12) === approvalAnchor('compliance', 12), false);
});
