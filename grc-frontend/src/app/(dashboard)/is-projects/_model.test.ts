// node --test "src/app/(dashboard)/is-projects/_model.test.ts"
// The rules of the Projects pages, pinned against what the old pages computed inline (the old expressions are copied into this file as `old*` so the
// two can be compared on a spread of inputs): the calculations are unchanged, the forms send what they sent, and what is new (the page asked for, the
// Control ID that the server can store) is said where it differs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES, DEFAULT_PAGE_SIZE, DETAIL_TAB_KEYS, HEALTH_OPTIONS, LIST_TAB_KEYS, NO_FILTERS, PAGE_SIZES, PRIORITIES, STATUSES,
  alignmentOf, blankForm, blankProject, budgetShare, burnRows, burnTone, categorySummary, clampPercent, documentFields, editErrors, editFormOf, editPayload, estimateText,
  filtersActive, formFromItem, frameworkTone, healthScore, heatmapOf, isoDay, lines, listParams, loadPercent, loadTone, matchRisks, matchUsers, money, newProjectErrors,
  newProjectPayload, normalizeSeverity, normalizeTenantUser, readProjectPage, recordErrors, recordPayload, sameForm, scoreTone, statusSlices, statusSummary,
  tenantRisksOf, tenantUsersOf, trendSummary, utilizationTone, type RecordKind, type TenantUserOption,
} from './_model.ts';

// ── what the old pages did, word for word ────────────────────────────────────────────────────────────────────────────────────────
const oldBudgetUtil = (est: number, act: number) => (est > 0 ? Math.round((act / est) * 100) : 0);                                   // [id]/page.tsx:666
const oldUtilBar = (u: number) => (u > 90 ? 'bg-rose-500' : u > 70 ? 'bg-amber-500' : 'bg-emerald-500');                           // dashboard/page.tsx:203
const oldBurnBar = (p: number) => (p > 100 ? 'bg-rose-500' : p > 80 ? 'bg-amber-500' : 'bg-emerald-500');                          // dashboard/page.tsx:360, [id]/page.tsx:790
const oldHealthScore = (hd: Record<string, number>) => { const total = Object.values(hd).reduce((a: number, b: number) => a + b, 0) || 1; return Math.round(((hd['On Track'] || 0) / total) * 100); };
const oldScoreColor = (s: number) => (s >= 70 ? 'text-emerald-600' : s >= 40 ? 'text-amber-600' : 'text-rose-600');                 // dashboard/page.tsx:291
const oldLoad = (n: number) => Math.min(n * 25, 100);                                                                               // dashboard/page.tsx:391
const oldLoadColor = (l: number) => (l >= 100 ? 'bg-rose-500' : l >= 75 ? 'bg-amber-500' : l >= 50 ? 'bg-primary-500' : 'bg-emerald-500');
const oldStatusColor = (s: string) => {                                                                                              // dashboard/page.tsx:449
  const sl = s.toLowerCase();
  if (sl.includes('compliant') || sl.includes('met') || sl.includes('complete')) return 'bg-emerald-500';
  if (sl.includes('partial') || sl.includes('progress')) return 'bg-amber-400';
  if (sl.includes('gap') || sl.includes('non') || sl.includes('fail')) return 'bg-rose-500';
  return 'bg-primary-400';
};
const TONE_OF_BAR: Record<string, string> = { 'bg-rose-500': 'danger', 'bg-amber-500': 'warning', 'bg-emerald-500': 'success', 'bg-primary-500': 'progress', 'bg-amber-400': 'warning', 'bg-primary-400': 'progress' };

// ── option lists, tabs, the list's query ─────────────────────────────────────────────────────────────────────────────────────────
test('the selects offer what they offered, and the tabs keep the names the address will carry', () => {
  assert.deepEqual(STATUSES, ['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled']);
  assert.deepEqual(HEALTH_OPTIONS, ['On Track', 'At Risk', 'Off Track']);
  assert.deepEqual(PRIORITIES, ['Critical', 'High', 'Medium', 'Low']);
  assert.equal(CATEGORIES.length, 7);
  assert.deepEqual(LIST_TAB_KEYS, ['overview', 'projects', 'my-projects']);
  assert.deepEqual(DETAIL_TAB_KEYS, ['overview', 'milestones', 'tasks', 'team', 'risks', 'updates', 'documents', 'budget', 'compliance', 'lessons', 'dependencies']);
});

test('the list asks with the same names as before, each only when set, and now says which page', () => {
  assert.deepEqual(listParams(NO_FILTERS, 1, 50), { page: '1', page_size: '50' });
  assert.deepEqual(
    listParams({ status: 'On Hold', category: 'Compliance', priority: 'High', health: 'At Risk', owner: 'Olivia Author', search: '  siem ' }, 3, 25),
    { status: 'On Hold', category: 'Compliance', priority: 'High', health: 'At Risk', owner_name: 'Olivia Author', search: 'siem', page: '3', page_size: '25' },
  );
  assert.deepEqual(listParams(NO_FILTERS, 0, 7), { page: '1', page_size: String(DEFAULT_PAGE_SIZE) }, 'a page below 1 and a size the server would not take fall back');
  assert.ok(PAGE_SIZES.every((n) => n <= 200), 'the server takes at most 200');
  assert.equal(filtersActive(NO_FILTERS), false);
  assert.equal(filtersActive({ ...NO_FILTERS, search: ' ' }), false, 'a blank search filters nothing');
  assert.equal(filtersActive({ ...NO_FILTERS, health: 'At Risk' }), true);
});

test('the page the server answered: its rows and the true total, never the length of what came back', () => {
  assert.deepEqual(readProjectPage({ items: [{ id: 1 }, { id: 2 }], total: 150, page: 1, page_size: 50 }), { items: [{ id: 1 }, { id: 2 }], total: 150 });
  assert.deepEqual(readProjectPage({ items: [{ id: 1 }] }), { items: [{ id: 1 }], total: 1 }, 'no total sent: only what is known is said');
  assert.deepEqual(readProjectPage({ items: [{ id: 1 }, { id: 2 }], total: 1 }), { items: [{ id: 1 }, { id: 2 }], total: 2 }, 'a total smaller than the rows is not believed');
  for (const bad of [null, undefined, 'x', 3, {}, { items: 'no' }]) assert.deepEqual(readProjectPage(bad), { items: [], total: 0 });
});

// ── the calculations ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the budget share is the detail page\'s own: a whole percent of the estimate, 0 without one', () => {
  for (const est of [0, 1, 7.5, 100, 1000, 12_500_000]) for (const act of [0, 1, 99, 100, 1000, 5_000_000, 20_000_000]) assert.equal(budgetShare(est, act), oldBudgetUtil(est, act), `${est} ${act}`);
  assert.equal(budgetShare(null, 5), 0);
  assert.equal(budgetShare(undefined, undefined), 0);
  assert.equal(budgetShare(100, null), 0);
});

test('the thresholds of the three bars are the ones the old classes had (90/70, 100/80, 70/40) and the tone names say the same colour', () => {
  const colour = { danger: 'bg-rose-500', warning: 'bg-amber-500', success: 'bg-emerald-500' } as Record<string, string>;
  for (const n of [0, 50, 70, 70.5, 71, 80, 80.5, 90, 90.1, 91, 100, 100.4, 101, 250]) {
    assert.equal(colour[utilizationTone(n)], oldUtilBar(n), `utilization ${n}`);
    assert.equal(colour[burnTone(n)], oldBurnBar(n), `burn ${n}`);
  }
  const scoreClass: Record<string, string> = { success: 'text-emerald-600', warning: 'text-amber-600', danger: 'text-rose-600' };
  for (const s of [0, 39, 40, 69, 70, 100]) assert.equal(scoreClass[scoreTone(s)], oldScoreColor(s), `score ${s}`);
});

test('the health score, a member\'s load and the framework colours match the old computations', () => {
  const distributions: Array<Record<string, number>> = [{}, { 'On Track': 0, 'At Risk': 0, 'Off Track': 0 }, { 'On Track': 51, 'At Risk': 50, 'Off Track': 49 }, { 'On Track': 1 }, { 'At Risk': 3 }, { 'On Track': 2, Other: 1 }];
  for (const hd of distributions) {
    assert.equal(healthScore(hd), oldHealthScore(hd), JSON.stringify(hd));
  }
  assert.equal(healthScore(null), 0);
  for (const n of [0, 1, 2, 3, 4, 5, 9]) {
    assert.equal(loadPercent(n), oldLoad(n));
    assert.equal(TONE_OF_BAR[oldLoadColor(oldLoad(n))], loadTone(loadPercent(n)), `load ${n}`);
  }
  for (const s of ['Compliant', 'Fully Met', 'complete', 'Partial', 'In Progress', 'Gap', 'Non-compliant', 'Fail', 'Mapped', 'Planning', '', 'Hold']) {
    assert.equal(TONE_OF_BAR[oldStatusColor(s)], frameworkTone(s), s);
  }
});

test('the heatmap takes the first 10 members and the first 6 projects that appear; the alignment the first 8 projects', () => {
  const team = Array.from({ length: 14 }, (_, i) => ({ name: `M${i}`, total_projects: i, projects: [{ project_name: `P${i % 9}`, role: 'Lead' }, { project_name: `P${(i + 3) % 9}`, role: 'Member' }] }));
  const { members, columns } = heatmapOf(team);
  assert.equal(members.length, 10);
  assert.deepEqual(columns, ['P0', 'P3', 'P1', 'P4', 'P2', 'P5']);
  assert.deepEqual(heatmapOf(null), { members: [], columns: [] });
  const alignment: Record<string, Array<{ project_id: number; project_name: string; status: string }>> = {
    'ISO 27001': Array.from({ length: 10 }, (_, i) => ({ project_id: i + 1, project_name: `Pr${i + 1}`, status: i % 2 ? 'In Progress' : '' })),
    'NCA ECC': [{ project_id: 2, project_name: 'Pr2', status: 'Completed' }],
  };
  const a = alignmentOf(alignment);
  assert.deepEqual(a.frameworks, ['ISO 27001', 'NCA ECC']);
  assert.equal(a.rows.length, 8);
  assert.deepEqual(a.rows[0], { id: 1, name: 'Pr1', cells: { 'ISO 27001': 'Mapped' } }, 'no status word is "Mapped"');
  assert.deepEqual(a.rows[1].cells, { 'ISO 27001': 'In Progress', 'NCA ECC': 'Completed' });
  assert.deepEqual(alignmentOf(undefined), { frameworks: [], rows: [] });
  assert.equal(burnRows(Array.from({ length: 12 }, (_, i) => i)).length, 8);
});

// ── how numbers are written ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('a bar never leaves its track, and money reads as the platform reads a number', () => {
  assert.deepEqual([clampPercent(150), clampPercent(-5), clampPercent(42.5), clampPercent('x'), clampPercent(null), clampPercent(undefined)], [100, 0, 42.5, 0, 0, 0]);
  assert.deepEqual([money(0), money(500), money(1234), money(75_000), money(12_500_000), money(175_000_000), money(2_000_000), money(-2500), money(null), money(NaN)],
    ['$0', '$500', '$1.2K', '$75K', '$12.5M', '$175M', '$2M', '-$2.5K', '—', '—']);
  assert.deepEqual([money(999_949), money(999_950), money(423_600_000), money(7.5)], ['$999.9K', '$1M', '$423.6M', '$8'], 'a figure that rounds up into the next unit says so');
  assert.deepEqual([estimateText(0), estimateText(null), estimateText(undefined), estimateText(15000)], ['Not set', 'Not set', 'Not set', '$15K']);
});

test('what a chart says for a screen reader names every slice with its number and its share', () => {
  const dist = [{ name: 'In Progress', value: 32 }, { name: 'On Hold', value: 30 }, { name: 'Completed', value: 38 }];
  assert.deepEqual(statusSlices(dist).map((s) => [s.label, s.value, s.percent, s.tone]), [['In progress', 32, 32, 'progress'], ['On hold', 30, 30, 'warning'], ['Completed', 38, 38, 'success']]);
  assert.equal(statusSummary(dist), '100 projects by status: In progress 32 (32%), On hold 30 (30%), Completed 38 (38%).');
  assert.equal(statusSummary([{ name: 'Planning', value: 1 }]), '1 project by status: Planning 1 (100%).');
  assert.equal(statusSummary([]), 'No projects by status.');
  assert.equal(statusSummary(null), 'No projects by status.');
  assert.deepEqual(statusSlices([{ name: 'Planning', value: 0 }]).map((s) => s.percent), [0], 'no total: no NaN');
  assert.equal(categorySummary([{ name: 'Compliance', value: 21 }, { name: 'Other', value: 1 }]), '22 projects by category: Compliance 21, Other 1.');
  assert.equal(categorySummary(undefined), 'No projects by category.');
  const t = [{ date: '2026-10-28', on_track: 1, at_risk: 1, off_track: 0, total: 2, health_score: 50 }, { date: '2026-10-29', on_track: 2, at_risk: 0, off_track: 0, total: 2, health_score: 100 }];
  assert.equal(trendSummary(t), 'Health score over 2 snapshots: 50% on 28 Oct 2026, 100% on 29 Oct 2026.');
  assert.equal(trendSummary([t[0]]), 'One health snapshot so far: 50% on track on 28 Oct 2026.');
  assert.equal(trendSummary([]), 'No health snapshots yet.');
});

// ── people and risks for the pickers ─────────────────────────────────────────────────────────────────────────────────────────────
test('people come from either shape of the users list, once each, by name', () => {
  assert.deepEqual(normalizeTenantUser({ id: 3, display_name: 'Sara Reviewer', email: 's@x.test' }), { id: 3, displayName: 'Sara Reviewer', email: 's@x.test' });
  assert.deepEqual(normalizeTenantUser({ id: 9, user: { id: 4, username: 'khalid', email: 'k@x.test' } }), { id: 9, displayName: 'khalid', email: 'k@x.test' });
  assert.deepEqual(normalizeTenantUser({ user_id: 5, email: 'a@x.test' }), { id: 5, displayName: 'a@x.test', email: 'a@x.test' });
  assert.deepEqual(normalizeTenantUser({ id: 7 }), { id: 7, displayName: 'User 7', email: '' });
  for (const bad of [null, 'x', {}, { id: 0 }, { id: -2 }, { id: 'abc' }]) assert.equal(normalizeTenantUser(bad), null);
  const users = tenantUsersOf([{ id: 2, display_name: 'Zed' }, { id: 1, display_name: 'Amy' }, { id: 2, display_name: 'Zed again' }, null]);
  assert.deepEqual(users.map((u) => u.displayName), ['Amy', 'Zed again'], 'one per id (the last wins), sorted');
  assert.deepEqual(matchUsers(users, ' AM ').map((u) => u.id), [1]);
  assert.equal(matchUsers(users, '').length, 2);
});

test('a risk from the register keeps its words, its severity in the project\'s scale and its owner from the users', () => {
  const byId = new Map<number, TenantUserOption>([[8, { id: 8, displayName: 'Rita Risk', email: '' }]]);
  const risks = tenantRisksOf([
    { id: 2, title: 'Zeta', severity: 'high' }, { id: 1, title: ' Alpha ', risk_level: 13, owner_id: 8 }, { id: 3, title: '' }, { id: 0, title: 'No id' },
    { id: 4, title: 'Beta', residual_score: 4, treatment_plan: 'Accept', owner_name: 'Named' },
  ], byId);
  assert.deepEqual(risks.map((r) => [r.id, r.title, r.severity, r.ownerName, r.mitigation]), [[1, 'Alpha', 'High', 'Rita Risk', ''], [4, 'Beta', 'Low', 'Named', 'Accept'], [2, 'Zeta', 'High', '', '']]);
  assert.deepEqual([normalizeSeverity(16), normalizeSeverity(12), normalizeSeverity(6), normalizeSeverity(5), normalizeSeverity('CRITICAL'), normalizeSeverity('x'), normalizeSeverity(null)], ['Critical', 'High', 'Medium', 'Low', 'Critical', 'Medium', 'Medium']);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `Risk ${i}`, description: i === 25 ? 'special' : '', severity: 'Medium', mitigation: '', ownerName: '' }));
  assert.equal(matchRisks(many, '').length, 20, 'at most 20 are listed');
  assert.deepEqual(matchRisks(many, 'SPECIAL').map((r) => r.id), [26], 'found by its description too');
});

// ── the record forms ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const users = new Map<number, TenantUserOption>([[4, { id: 4, displayName: 'Sara Reviewer', email: 'sara@x.test' }]]);

// the old save buttons, copied from [id]/page.tsx:1820-1874 (modalForm is a Record<string,string>)
const oldMilestone = (m: Record<string, string>) => ({ ...m, completion_percentage: parseFloat(m.completion_percentage || '0'), deliverables: (m.deliverables || '').split('\n').map((s) => s.trim()).filter(Boolean) });
const oldTask = (m: Record<string, string>) => ({ ...m, progress: parseFloat(m.progress || '0'), dependencies: (m.dependencies || '').split('\n').map((s) => s.trim()).filter(Boolean) });
const oldTeam = (m: Record<string, string>) => { const u = users.get(Number(m.user_id || 0)); return { ...m, user_id: u?.id || Number(m.user_id || 0) || undefined, user_name: u?.displayName || m.user_name || '', email: u?.email || m.email || '' }; };
const oldRisk = (m: Record<string, string>) => { const o = users.get(Number(m.owner_user_id || 0)); const rest = { ...m }; delete rest.owner_user_id; delete rest.linked_risk_id; return { ...rest, owner_name: o?.displayName || m.owner_name || '' }; };
const oldBudget = (m: Record<string, string>) => ({ ...m, amount: parseFloat(m.amount || '0') });

test('every form starts with what the old buttons put in it (an update at the project\'s health)', () => {
  assert.deepEqual(blankForm('milestone'), { name: '', description: '', target_date: '', status: 'Pending', completion_percentage: '0', deliverables: '' });
  assert.deepEqual(blankForm('task'), { title: '', description: '', assignee_name: '', priority: 'Medium', status: 'To Do', due_date: '', progress: '0', dependencies: '' });
  assert.deepEqual(blankForm('team'), { user_id: '', user_name: '', email: '', role: 'Member', responsibilities: '' });
  assert.deepEqual(blankForm('risk'), { linked_risk_id: '', title: '', description: '', type: 'Risk', severity: 'Medium', mitigation: '', owner_user_id: '', owner_name: '' });
  assert.deepEqual(blankForm('update', 'At Risk'), { health_status: 'At Risk', what_was_done: '', whats_planned: '', blockers: '', notes: '' });
  assert.deepEqual(blankForm('document'), { title: '', description: '', document_type: 'Reference', url: '' });
  assert.deepEqual(blankForm('budget'), { category: 'Hardware', description: '', amount: '', status: 'Pending', approved_by: '', notes: '', date: '' });
  assert.deepEqual(blankForm('compliance'), { framework_name: '', control_id: '', control_name: '', coverage_status: 'Planned', requirement_description: '', deliverable: '', notes: '' });
  assert.deepEqual(blankForm('lesson'), { title: '', description: '', category: 'Recommendation', impact: 'Medium' });
  assert.deepEqual(blankForm('dependency'), { dependency_type: 'internal', dependent_project_name: '', external_dependency: '', description: '', status: 'Active', direction: 'depends_on', impact_if_delayed: '', expected_date: '' });
});

test('the forms send what the old save buttons sent', () => {
  const m = { ...blankForm('milestone'), name: 'Go live', completion_percentage: '45', deliverables: ' Runbook \n\n  Parser pack\n' };
  assert.deepEqual(recordPayload('milestone', m, users), oldMilestone(m));
  assert.deepEqual(recordPayload('milestone', blankForm('milestone'), users), oldMilestone(blankForm('milestone')));
  const t = { ...blankForm('task'), title: 'Wire it', progress: '', dependencies: 'Task 1\nTask 2' };
  assert.deepEqual(recordPayload('task', t, users), oldTask(t));
  for (const user_id of ['', '4', '99']) assert.deepEqual(recordPayload('team', { ...blankForm('team'), user_id, user_name: 'Typed', email: 'typed@x.test' }, users), oldTeam({ ...blankForm('team'), user_id, user_name: 'Typed', email: 'typed@x.test' }));
  for (const owner_user_id of ['', '4']) {
    const r = { ...blankForm('risk'), title: 'Leak', linked_risk_id: '12', owner_user_id, owner_name: 'Someone' };
    assert.deepEqual(recordPayload('risk', r, users), oldRisk(r));
    assert.ok(!('linked_risk_id' in recordPayload('risk', r, users)) && !('owner_user_id' in recordPayload('risk', r, users)));
  }
  const b = { ...blankForm('budget'), description: 'Licences', amount: '1250.5' };
  assert.deepEqual(recordPayload('budget', b, users), oldBudget(b));
  assert.deepEqual(recordPayload('budget', blankForm('budget'), users), oldBudget(blankForm('budget')));
  for (const kind of ['update', 'document', 'lesson', 'dependency'] as RecordKind[]) assert.deepEqual(recordPayload(kind, blankForm(kind), users), blankForm(kind), `${kind} is sent as typed`);
});

test('the compliance Control ID is a whole number or null: the empty box that used to be "" (and was refused by the server) is now null', () => {
  const c = { ...blankForm('compliance'), framework_name: 'ISO 27001', control_name: 'Logging' };
  assert.equal(recordPayload('compliance', c, users).control_id, null);
  assert.equal(recordPayload('compliance', { ...c, control_id: ' 12 ' }, users).control_id, 12);
  assert.deepEqual(recordPayload('compliance', c, users), { ...c, control_id: null });
  assert.deepEqual(recordErrors('compliance', { ...c, control_id: 'A.5.1' }), { control_id: 'Enter a whole number, or leave it empty' });
  assert.deepEqual(recordErrors('compliance', { ...c, control_id: '12' }), {});
  assert.deepEqual(recordErrors('compliance', { ...c, control_id: '' }), {});
});

test('a form can be saved when what it marks as required is filled in, and not before; a percent outside 0 to 100 is refused', () => {
  assert.deepEqual(recordErrors('milestone', blankForm('milestone')), { name: 'Enter a name' });
  assert.deepEqual(recordErrors('milestone', { ...blankForm('milestone'), name: 'x', completion_percentage: '150' }), { completion_percentage: 'Enter a number from 0 to 100' });
  assert.deepEqual(recordErrors('milestone', { ...blankForm('milestone'), name: 'x', completion_percentage: '' }), {}, 'an empty box is 0, as before');
  assert.deepEqual(recordErrors('task', blankForm('task')), { title: 'Enter a title' });
  assert.deepEqual(recordErrors('task', { ...blankForm('task'), title: 't', progress: '-1' }), { progress: 'Enter a number from 0 to 100' });
  assert.deepEqual(recordErrors('team', blankForm('team')), { user_id: 'Choose a person' });
  assert.deepEqual(recordErrors('team', { ...blankForm('team'), user_id: '4' }), {});
  assert.deepEqual(recordErrors('risk', { ...blankForm('risk'), title: '   ' }), { title: 'Enter a title' });
  assert.deepEqual(recordErrors('document', blankForm('document')), { title: 'Enter a title' });
  assert.deepEqual(recordErrors('budget', blankForm('budget')), { description: 'Enter a description' });
  assert.deepEqual(recordErrors('lesson', blankForm('lesson')), { title: 'Enter a title' });
  assert.deepEqual(recordErrors('compliance', blankForm('compliance')), { framework_name: 'Enter a framework', control_name: 'Enter a control name' });
  for (const kind of ['update', 'dependency'] as RecordKind[]) assert.deepEqual(recordErrors(kind, blankForm(kind)), {}, `${kind} marks nothing as required`);
});

test('an existing line opens its form with its dates as days (a date box cannot show a time), and the document file is sent with the words that have text', () => {
  assert.equal(isoDay('2026-03-15T00:00:00'), '2026-03-15');
  assert.equal(isoDay('2026-03-15'), '2026-03-15');
  assert.deepEqual([isoDay(null), isoDay(''), isoDay('soon'), isoDay(20260315)], ['', '', '', '']);
  assert.deepEqual(formFromItem('budget', { id: 1, category: 'Software', description: null, amount: 35000, status: 'Approved', approved_by: 'CFO', notes: null, date: '2026-03-15T00:00:00' }),
    { category: 'Software', description: '', amount: '35000', status: 'Approved', approved_by: 'CFO', notes: '', date: '2026-03-15' });
  assert.equal(formFromItem('compliance', { control_id: 12, control_name: 'x', framework_name: 'y', coverage_status: 'Verified' }).control_id, '12');
  assert.equal(formFromItem('compliance', { control_id: null, control_name: 'x', framework_name: 'y' }).control_id, '');
  assert.deepEqual(formFromItem('lesson', { title: 'T', category: null, impact: null }), { title: 'T', description: '', category: 'Recommendation', impact: 'Medium' });
  assert.equal(formFromItem('dependency', { dependency_type: 'external', expected_date: '2026-11-28T00:00:00', direction: null }).direction, 'depends_on');
  assert.equal(formFromItem('dependency', { expected_date: '2026-11-28T00:00:00' }).expected_date, '2026-11-28');
  assert.deepEqual(documentFields({ title: 'T', description: '', document_type: 'Policy', url: 'https://x' }), [['title', 'T'], ['document_type', 'Policy']]);
  assert.deepEqual(lines(' a \n\n b\n'), ['a', 'b']);
  assert.deepEqual(lines(null), []);
});

// ── the project ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('creating a project sends what the old button sent: the owner\'s id only when one was picked, the budget as a number', () => {
  const f = { ...blankProject(), name: 'SIEM', department: 'Security', budget_estimated: '2500.50', project_owner_name: 'Olivia' };
  assert.deepEqual(newProjectPayload(f), {
    name: 'SIEM', description: '', category: 'Other', priority: 'Medium', project_owner_name: 'Olivia', sponsor: '', department: 'Security', start_date: '', target_end_date: '',
    business_justification: '', budget_estimated: 2500.5,
  });
  assert.equal(newProjectPayload({ ...f, project_owner_id: 7 }).project_owner_id, 7);
  assert.equal('project_owner_id' in newProjectPayload(f), false);
  assert.equal(newProjectPayload(blankProject()).budget_estimated, 0);
  assert.deepEqual(newProjectErrors(blankProject()), { name: 'Enter a project name' });
  assert.deepEqual(newProjectErrors({ ...blankProject(), name: '   ' }), { name: 'Enter a project name' }, 'a name of spaces is no name (it used to be accepted)');
  assert.deepEqual(newProjectErrors({ ...blankProject(), name: 'x' }), {});
});

test('editing a project round-trips: the form shows what the project holds and sends what the old Save Changes sent', () => {
  const project = {
    id: 1, name: 'SIEM', description: null, status: 'In Progress', health: 'At Risk', priority: 'High', category: 'Infrastructure', project_owner_name: 'Olivia', sponsor: null, department: 'Security',
    budget_estimated: 2400000, budget_actual: 0, completion_percentage: 24.5, business_justification: 'Why', start_date: '2026-02-02T00:00:00', target_end_date: null,
    linked_risks: ['R-12', 'R-31'], linked_controls: [], linked_frameworks: ['ISO 27001'],
  };
  const f = editFormOf(project);
  assert.deepEqual(f, {
    name: 'SIEM', description: '', status: 'In Progress', health: 'At Risk', priority: 'High', category: 'Infrastructure', project_owner_name: 'Olivia', sponsor: '', department: 'Security',
    budget_estimated: '2400000', budget_actual: '', completion_percentage: '24.5', business_justification: 'Why', start_date: '2026-02-02', target_end_date: '',
    linked_risks_text: 'R-12\nR-31', linked_controls_text: '', linked_frameworks_text: 'ISO 27001',
  });
  // the old payload (page.tsx:1925), from the old editForm (page.tsx:688)
  const oldForm: Record<string, unknown> = {
    name: 'SIEM', description: '', status: 'In Progress', health: 'At Risk', priority: 'High', category: 'Infrastructure', project_owner_name: 'Olivia', sponsor: '', department: 'Security',
    budget_estimated: 2400000, budget_actual: 0, completion_percentage: 24.5, business_justification: 'Why', start_date: '2026-02-02', target_end_date: '',
    linked_risks_text: 'R-12\nR-31', linked_controls_text: '', linked_frameworks_text: 'ISO 27001',
  };
  const { linked_risks_text, linked_controls_text, linked_frameworks_text, ...rest } = oldForm;
  const oldPayload = { ...rest, linked_risks: String(linked_risks_text || '').split('\n').map((s) => s.trim()).filter(Boolean), linked_controls: String(linked_controls_text || '').split('\n').map((s) => s.trim()).filter(Boolean), linked_frameworks: String(linked_frameworks_text || '').split('\n').map((s) => s.trim()).filter(Boolean) };
  assert.deepEqual(editPayload(f), oldPayload);
  assert.deepEqual(editFormOf({}).linked_risks_text, '', 'a project with no lists');
  assert.deepEqual(editErrors({ ...f, name: ' ' }), { name: 'Enter a project name' });
  assert.deepEqual(editErrors({ ...f, completion_percentage: '101' }), { completion_percentage: 'Enter a number from 0 to 100' });
  assert.deepEqual(editErrors(f), {});
  assert.equal(sameForm(f, editFormOf(project)), true);
  assert.equal(sameForm(f, { ...f, name: 'SIEM2' }), false);
});
