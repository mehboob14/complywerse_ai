// node --test "src/app/(dashboard)/vendor-risk/_lib/recordShellModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONE_SHOT, BACK, metaLine, nextUp, nextUpText, openFindingCount, recordTabs, reviewWords, showsPicker, tabPatch, type NextStageLike } from './recordShellModel.ts';
import { TABS, tabFor } from './vendorRecordModel.ts';
import { headOf } from './railModel.ts';

const TODAY = new Date(2026, 10, 10, 12, 0, 0);       // 10 Nov 2026, the viewer's own noon

test('the record has the six tabs people know, in their order, and a count only where the work is', () => {
  assert.deepEqual(recordTabs().map((t) => t.key), ['overview', 'lifecycle', 'assessments', 'findings', 'paperwork', 'monitoring']);
  assert.deepEqual(recordTabs().map((t) => t.key), TABS.map((t) => t.key));
  assert.ok(recordTabs().every((t) => t.count === undefined), 'no list read yet: no badge, never a 0');
  const counted = recordTabs({ findings: 3, assessments: 2 });
  assert.equal(counted.find((t) => t.key === 'findings')?.count, 3);
  assert.equal(counted.find((t) => t.key === 'assessments')?.count, 2);
  assert.equal(counted.find((t) => t.key === 'overview')?.count, undefined);
  assert.equal(recordTabs({ findings: 0 }).find((t) => t.key === 'findings')?.count, undefined, 'nothing open is no badge');
  assert.equal(recordTabs({ findings: null }).find((t) => t.key === 'findings')?.count, undefined);
});

test('a tab click drops every one-shot parameter, so a stage, a finding or the tiering dialog does not fire again', () => {
  assert.deepEqual(ONE_SHOT.slice().sort(), ['finding', 'request', 'stage', 'tier']);
  assert.deepEqual(tabPatch('findings'), { tab: 'findings', stage: '', finding: '', tier: '', request: '' });
  // the old addresses still land where they did: a finding on the Findings tab, a stage on the Lifecycle, an old key on the tab that holds it now
  assert.equal(tabFor({ finding: '3', stage: 'findings' }), 'findings');
  assert.equal(tabFor({ stage: 'approval' }), 'lifecycle');
  assert.equal(tabFor({ tab: 'actions' }), 'findings');
  assert.equal(tabFor({ tab: 'sla' }), 'paperwork');
  assert.equal(tabFor({}), 'overview');
});

test('open findings are the ones open or in remediation; nothing is counted before the list is read', () => {
  assert.equal(openFindingCount(undefined), null);
  assert.equal(openFindingCount(null), null);
  assert.equal(openFindingCount([]), 0);
  assert.equal(openFindingCount([{ status: 'open' }, { status: 'in_remediation' }, { status: 'closed' }, { status: 'accepted' }, {}]), 2);
});

const stage = (over: Partial<NextStageLike> = {}): NextStageLike => ({ stage_key: 'approval', stage_label: 'Approval', roles: [], anyone_who_can_approve: false, ...over });

test('the next step says who it goes to, by role, and what is missing from the roster', () => {
  assert.equal(nextUp(undefined), null);
  assert.equal(nextUp(stage({ stage_key: null })), null, 'no next step to show');
  const held = nextUp(stage({ roles: [{ key: 'sec', label: 'Security', members: [{ name: 'S. Ali' }, { name: 'L. Ng' }], missing: false }] }));
  assert.equal(held && nextUpText(held), 'Approval goes to S. Ali, L. Ng (Security)');
  const gap = nextUp(stage({ roles: [{ key: 'sec', label: 'Security', members: [{ name: 'S. Ali' }], missing: false }, { key: 'leg', label: 'Legal', members: [], missing: true }] }));
  assert.equal(gap && nextUpText(gap), 'Approval goes to S. Ali (Security). No Legal on the roster');
  const anyone = nextUp(stage({ anyone_who_can_approve: true }));
  assert.equal(anyone && nextUpText(anyone), 'Approval goes to anyone who can approve vendors');
  const nobody = nextUp(stage({ roles: [{ key: 'leg', label: 'Legal', members: [], missing: true }] }));
  assert.equal(nobody && nextUpText(nobody), 'Approval. No Legal on the roster');
  const bare = nextUp(stage());
  assert.equal(bare && nextUpText(bare), 'Approval');
  const held2 = nextUp(stage({ anyone_who_can_approve: true, roles: [{ key: 'sec', label: 'Security', members: [{ name: 'S. Ali' }], missing: false }] }));
  assert.equal(held2?.anyApprover, false, 'when somebody holds the role the "anyone" line is not said');
});

test('the review line: in words, a month or less is a warning, a passed date is red, none before tiering', () => {
  assert.deepEqual(reviewWords([], null, TODAY), { text: 'Reassessment is set once it is tiered', tone: 'neutral' });
  assert.deepEqual(reviewWords(undefined, '2027-01-20', TODAY), { text: 'Reassessment in 71 days', tone: 'neutral' });
  assert.deepEqual(reviewWords(undefined, '2026-11-25', TODAY), { text: 'Reassessment in 15 days', tone: 'warning' });
  assert.deepEqual(reviewWords(undefined, '2026-11-10', TODAY), { text: 'Reassessment today', tone: 'warning' });
  assert.deepEqual(reviewWords(undefined, '2026-11-07', TODAY), { text: 'Reassessment overdue, was due 3 days ago', tone: 'danger' });
  // the earliest of the engagements in use wins; an ended one does not count
  const items = [
    { id: 1, name: 'A', status: 'active', next_reassessment_date: '2027-02-01' },
    { id: 2, name: 'B', status: 'active', next_reassessment_date: '2026-12-01' },
    { id: 3, name: 'C', status: 'ended', next_reassessment_date: '2026-11-01' },
  ];
  assert.equal(reviewWords(items, null, TODAY).text, 'Reassessment in 21 days');
});

test('the picker is drawn on the Lifecycle and Assessments tabs, and only when there is a choice; the head words are the ones the register uses', () => {
  assert.equal(showsPicker('lifecycle', 2), true);
  assert.equal(showsPicker('assessments', 3), true);
  assert.equal(showsPicker('lifecycle', 1), false);
  assert.equal(showsPicker('findings', 5), false);
  assert.equal(showsPicker('overview', 5), false);
  assert.deepEqual(BACK, { href: '/vendor-risk/vendors', label: 'Vendors' });
  assert.equal(metaLine(['Analytics', '', 'Finance']), 'Analytics · Finance');
});

test("a vendor's record draws its own head (the top bar names only the section); its summary is a print page and does not", () => {
  assert.equal(headOf('/vendor-risk/vendors/12'), 'page');
  assert.equal(headOf('/vendor-risk/vendors/12/'), 'page');
  assert.equal(headOf('/vendor-risk/vendors/12?tab=findings'), 'page');
  assert.equal(headOf('/vendor-risk/vendors/12/summary'), 'legacy');
  assert.equal(headOf('/vendor-risk/vendors'), headOf('/vendor-risk/vendors'), "the register is its own group's row");
});
