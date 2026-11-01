// node --test "src/app/(dashboard)/bcm/bcmModel.test.ts"
// The rules of the Business Continuity pages. The rules that were already there (the filters, the payloads, the percent text, the pass-rate colours) are pinned
// against a frozen copy of the expression the old pages used; the ones that are new (hours that are whole numbers, what a list says when the server cut it, what a
// delete says it takes with it, the address of a list) are pinned as what they now are.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../lib/addressState.ts';
import {
  BIA_SORT_KEYS, DRILL_FLOW, DRILL_LIST_SCHEMA, FINDING_HINT, HOURS_MAX, NAME_MAX, OPTION_CAPS, PLAN_FILTERS, PLAN_LIST_SCHEMA, PLAN_SORT_KEYS,
  asPage, biaCompleteness, biaCreatePayload, coverageTile, biaDirty, biaErrors, biaSortValue, blankBiaForm, blankDependencyForm, blankDrillForm, blankFindingForm, blankPlanForm,
  blankStrategyForm, cutHint, cutNotice, dependencyDeleteWords, dependencyErrors, dependencyPayload, drillCreatePayload, drillDeleteWords, drillDirty, drillErrors,
  drillFormFrom, drillMoves, drillSchedulePayload, drillSortValue, drillUpdatePayload, filterDrills, filterPlans, findingCount, findingDeleteWords, findingErrors,
  findingPayload, fmtHours, isEmptyTenant, linkageOf, listCut, optionsCut, ordered, pageOf, parseHours, percentText, pickOptions, planCount, planCreatePayload,
  planDeleteWords, planDirty, planErrors, planFormFrom, planMoves, planSortValue, planUpdatePayload, plural, rateTone, resultDirty, resultErrors, resultFormFrom,
  resultPayload, retryRead, strategyDeleteWords, strategyPayload, triLabel, type Dashboard, type Drill, type Plan,
} from './bcmModel.ts';

const plan = (o: Partial<Plan> = {}): Plan => ({
  id: 1, title: 'Core Banking Plan', description: null, business_unit: 'Retail Banking', status: 'draft', document_ref_id: null, document_title: null, owner_id: null, owner_name: null,
  rto_hours: null, rpo_hours: null, testing_frequency: 'annual', version: 1, approved_by_name: null, approved_date: null, next_review_due: null, bia_count: 0, drill_count: 0, ...o,
});
const drill = (o: Partial<Drill> = {}): Drill => ({
  id: 1, plan_id: 7, plan_title: 'Core Banking Plan', title: 'Q3 failover tabletop', drill_type: 'tabletop', scenario: null, scheduled_date: null, actual_start: null, actual_end: null,
  owner_id: null, owner_name: null, status: 'scheduled', is_overdue: false, effective_status: 'scheduled', source_type: 'scheduled_test', linked_incident_id: null,
  linked_incident_title: null, has_result: false, finding_count: 0, ...o,
});

// ── the answer of a list route ──
test('a list answer is a page: its rows and the TRUE total; anything else is not a page and is never drawn as an empty list', () => {
  assert.deepEqual(asPage({ items: [1, 2], total: 250, skip: 0, limit: 200 }), { items: [1, 2], total: 250 });
  assert.deepEqual(asPage({ items: [1, 2] }), { items: [1, 2], total: 2 }, 'a missing total is the rows that came');
  assert.deepEqual(asPage({ items: [1, 2, 3], total: 1 }), { items: [1, 2, 3], total: 3 }, 'a total smaller than the rows is no total');
  for (const bad of [null, undefined, [], 'x', 7, {}, { items: 'x' }, { items: null }]) assert.equal(asPage(bad), null, String(bad));
});

test('a read is tried again only where trying again can help: not for a refusal or a missing record', () => {
  const http = (status: number) => ({ response: { status } });
  assert.equal(retryRead(0, http(403)), false);
  assert.equal(retryRead(0, http(404)), false);
  assert.equal(retryRead(0, http(500)), true);
  assert.equal(retryRead(1, http(503)), true);
  assert.equal(retryRead(2, http(500)), false, 'twice more, then it is said');
  assert.equal(retryRead(0, new Error('network')), true);
});

// ── hours ──
test('an hours figure is written as it always was: a dash for none, else "8h" (0 is a value)', () => {
  assert.equal(fmtHours(null), '—');
  assert.equal(fmtHours(undefined), '—');
  assert.equal(fmtHours(8), '8h');
  assert.equal(fmtHours(0), '0h');
});

test('what a person types in an hours field: nothing is none recorded, a whole number from 0 is that number, anything else is refused before the server answers 422 or 500', () => {
  assert.deepEqual(parseHours(''), { ok: true, value: null });
  assert.deepEqual(parseHours('   '), { ok: true, value: null });
  assert.deepEqual(parseHours(null), { ok: true, value: null });
  assert.deepEqual(parseHours('0'), { ok: true, value: 0 });
  assert.deepEqual(parseHours(' 24 '), { ok: true, value: 24 });
  assert.deepEqual(parseHours('08'), { ok: true, value: 8 });
  assert.deepEqual(parseHours(String(HOURS_MAX)), { ok: true, value: HOURS_MAX });
  for (const bad of ['1.5', '-5', 'abc', '1e3', '+4', '4h', '99999999999', String(HOURS_MAX + 1)]) assert.equal(parseHours(bad).ok, false, bad);
});

test('"1 drill", "2 drills", "0 drills"; "1 business impact analysis process"', () => {
  assert.equal(plural(1, 'drill'), '1 drill');
  assert.equal(plural(0, 'drill'), '0 drills');
  assert.equal(plural(1200, 'finding'), '1,200 findings');
  assert.equal(plural(1, 'process', 'processes'), '1 process');
  assert.equal(plural(2, 'process', 'processes'), '2 processes');
});

// ── the plan form ──
test('Add plan and Edit plan send exactly what the old forms sent', () => {
  const f = { ...blankPlanForm(), title: 'Payments continuity', business_unit: 'Treasury', description: 'Covers payments.', owner_id: 9, owner_name: 'Ayla', document_ref_id: 4, document_title: 'BCP', rto_hours: '8', rpo_hours: '2', testing_frequency: 'quarterly', next_review_due: '2026-12-31' };
  // the old CreatePlanModal mutationFn
  const oldCreate = (form: typeof f) => ({
    title: form.title, business_unit: form.business_unit || null, description: form.description || null, owner_id: form.owner_id, document_ref_id: form.document_ref_id,
    rto_hours: form.rto_hours === '' ? null : Number(form.rto_hours), rpo_hours: form.rpo_hours === '' ? null : Number(form.rpo_hours), testing_frequency: form.testing_frequency,
    next_review_due: form.next_review_due || null,
  });
  // the old EditPlanModal mutationFn
  const oldUpdate = (form: typeof f) => ({
    title: form.title, business_unit: form.business_unit || null, description: form.description || null, rto_hours: form.rto_hours === '' ? null : Number(form.rto_hours),
    rpo_hours: form.rpo_hours === '' ? null : Number(form.rpo_hours), testing_frequency: form.testing_frequency, next_review_due: form.next_review_due || null,
    document_ref_id: form.document_ref_id, owner_id: form.owner_id,
  });
  assert.deepEqual(planCreatePayload(f), oldCreate(f));
  assert.deepEqual(planUpdatePayload(f), oldUpdate(f));
  const empty = blankPlanForm();
  assert.deepEqual(planCreatePayload(empty), oldCreate(empty as typeof f));
  assert.deepEqual(planCreatePayload(empty), { title: '', business_unit: null, description: null, owner_id: null, document_ref_id: null, rto_hours: null, rpo_hours: null, testing_frequency: 'annual', next_review_due: null });
  assert.deepEqual(Object.keys(planUpdatePayload(f)).sort(), ['business_unit', 'description', 'document_ref_id', 'next_review_due', 'owner_id', 'rpo_hours', 'rto_hours', 'testing_frequency', 'title']);
});

test('the form of a plan being edited holds what it holds today; the review day is the stored day', () => {
  const f = planFormFrom(plan({ title: 'T', business_unit: null, description: null, rto_hours: 0, rpo_hours: null, owner_id: 3, owner_name: 'Sam', next_review_due: '2026-11-05T00:00:00', document_ref_id: 2, document_title: 'Doc' }));
  assert.deepEqual(f, { title: 'T', business_unit: '', description: '', owner_id: 3, owner_name: 'Sam', document_ref_id: 2, document_title: 'Doc', rto_hours: '0', rpo_hours: '', testing_frequency: 'annual', next_review_due: '2026-11-05' });
  assert.equal(planFormFrom(plan({ next_review_due: null })).next_review_due, '');
});

test('a plan form refuses a blank title, a title the column cannot hold and an hours figure that is not whole hours: each is said before the request', () => {
  assert.deepEqual(planErrors({ ...blankPlanForm(), title: 'Ok' }), {});
  assert.deepEqual(planErrors(blankPlanForm()), { title: 'Enter a title.' });
  assert.deepEqual(planErrors({ ...blankPlanForm(), title: '   ' }), { title: 'Enter a title.' });
  assert.equal(planErrors({ ...blankPlanForm(), title: 'x'.repeat(NAME_MAX) }).title, undefined, '255 is stored');
  assert.equal(planErrors({ ...blankPlanForm(), title: 'x'.repeat(NAME_MAX + 1) }).title, 'Use at most 255 characters.', '256 is a bare 500 from the server');
  const e = planErrors({ ...blankPlanForm(), title: 'T', rto_hours: '1.5', rpo_hours: '-1' });
  assert.deepEqual(Object.keys(e).sort(), ['rpo_hours', 'rto_hours']);
});

test('a plan form is dirty when a field differs from where it opened (the name shown for a picked owner is display, not input)', () => {
  const opened = blankPlanForm();
  assert.equal(planDirty(opened, { ...opened }), false);
  assert.equal(planDirty(opened, { ...opened, owner_name: 'Ayla' }), false);
  assert.equal(planDirty(opened, { ...opened, title: 'x' }), true);
  assert.equal(planDirty(opened, { ...opened, owner_id: 4 }), true);
  assert.equal(planDirty(opened, { ...opened, rto_hours: '4' }), true);
});

// ── the drill forms ──
test('Schedule Drill (the Drills page), Schedule drill (a plan) and Edit drill send exactly what the old forms sent', () => {
  const f = { ...blankDrillForm(), plan_id: '12', title: 'Q3 failover', drill_type: 'simulation', source_type: 'incident_triggered', scheduled_date: '2026-11-09', scenario: 'Power loss', incident_id: 5, owner_id: 3 };
  // old CreateDrillModal
  const oldCreate = (s: typeof f) => ({
    plan_id: Number(s.plan_id), title: s.title, drill_type: s.drill_type, source_type: s.source_type, scheduled_date: s.scheduled_date || null, scenario: s.scenario || null,
    linked_incident_id: s.source_type === 'incident_triggered' ? s.incident_id : null,
  });
  assert.deepEqual(drillCreatePayload(f), oldCreate(f));
  const test2 = { ...f, source_type: 'scheduled_test', scheduled_date: '', scenario: '' };
  assert.deepEqual(drillCreatePayload(test2), oldCreate(test2));
  assert.equal(drillCreatePayload(test2).linked_incident_id, null, 'a rehearsed test links no incident even if one was picked before the switch');
  // old ScheduleDrillModal (on a plan)
  assert.deepEqual(drillSchedulePayload(7, f), { plan_id: 7, title: 'Q3 failover', drill_type: 'simulation', scheduled_date: '2026-11-09', scenario: 'Power loss', source_type: 'scheduled_test' });
  // old EditDrillModal
  assert.deepEqual(drillUpdatePayload(f, true), { title: 'Q3 failover', drill_type: 'simulation', scenario: 'Power loss', scheduled_date: '2026-11-09', owner_id: 3, linked_incident_id: 5 });
  assert.deepEqual(drillUpdatePayload(f, false), { title: 'Q3 failover', drill_type: 'simulation', scenario: 'Power loss', scheduled_date: '2026-11-09', owner_id: 3, linked_incident_id: null });
});

test('the form of a drill being edited holds what it holds today; a drill form is dirty when a field differs', () => {
  const d = drill({ plan_id: 7, title: 'T', scheduled_date: '2026-11-09T00:00:00', owner_id: 2, owner_name: 'Rana', linked_incident_id: 4, linked_incident_title: 'Outage', source_type: 'incident_triggered' });
  const f = drillFormFrom(d);
  assert.deepEqual(f, { plan_id: '7', title: 'T', drill_type: 'tabletop', source_type: 'incident_triggered', scheduled_date: '2026-11-09', scenario: '', incident_id: 4, incident_title: 'Outage', owner_id: 2, owner_name: 'Rana' });
  assert.equal(drillDirty(f, { ...f }), false);
  assert.equal(drillDirty(f, { ...f, scenario: 'x' }), true);
  assert.equal(drillDirty(f, { ...f, incident_title: 'other' }), false);
});

test('a drill form says what is missing: the plan (only where it is chosen), the title, the incident of an activation', () => {
  const ok = { ...blankDrillForm(), plan_id: '3', title: 'T' };
  assert.deepEqual(drillErrors(ok, { needsPlan: true }), {});
  assert.deepEqual(drillErrors({ ...ok, plan_id: '' }, { needsPlan: true }), { plan_id: 'Choose a plan.' });
  assert.deepEqual(drillErrors({ ...ok, plan_id: '' }, { needsPlan: false }), {});
  assert.deepEqual(drillErrors({ ...ok, title: ' ' }, { needsPlan: true }), { title: 'Enter a title.' });
  assert.equal(drillErrors({ ...ok, title: 'x'.repeat(256) }, { needsPlan: true }).title, 'Use at most 255 characters.');
  assert.deepEqual(drillErrors({ ...ok, source_type: 'incident_triggered' }, { needsPlan: true }), { incident_id: 'Choose the incident this activation answered.' });
  assert.deepEqual(drillErrors({ ...ok, source_type: 'incident_triggered', incident_id: 2 }, { needsPlan: true }), {});
});

// ── the BIA forms ──
test('Add process sends what it always sent; RTO shorter than MTPD is said before the request, exactly as the server enforces it (both set, RTO below MTPD)', () => {
  const f = { ...blankBiaForm(), process_name: 'Payment authorisation', criticality_rating: 'critical', rto_hours: '2', rpo_hours: '1', mtpd_hours: '8', linked_asset_ids: [3, 4] };
  assert.deepEqual(biaCreatePayload(f), { process_name: 'Payment authorisation', criticality_rating: 'critical', description: null, rto_hours: 2, rpo_hours: 1, mtpd_hours: 8, linked_asset_ids: [3, 4] });
  assert.deepEqual(biaCreatePayload(blankBiaForm()), { process_name: '', criticality_rating: 'medium', description: null, rto_hours: null, rpo_hours: null, mtpd_hours: null, linked_asset_ids: [] });
  assert.deepEqual(biaErrors(f), {});
  assert.equal(biaErrors({ ...f, rto_hours: '8' }).mtpd_hours, 'RTO must be shorter than MTPD.', 'RTO equal to MTPD is refused by the server too');
  assert.equal(biaErrors({ ...f, rto_hours: '9' }).mtpd_hours, 'RTO must be shorter than MTPD.');
  assert.equal(biaErrors({ ...f, rto_hours: '', mtpd_hours: '8' }).mtpd_hours, undefined, 'one of them missing: the server asks nothing');
  assert.equal(biaErrors({ ...f, mtpd_hours: '' }).mtpd_hours, undefined);
  assert.equal(biaErrors({ ...f, rto_hours: '0', mtpd_hours: '0' }).mtpd_hours, 'RTO must be shorter than MTPD.');
  assert.deepEqual(biaErrors(blankBiaForm()), { process_name: 'Enter a process name.' });
  assert.equal(biaErrors({ ...f, process_name: 'x'.repeat(256) }).process_name, 'Use at most 255 characters.');
  assert.equal(biaDirty(blankBiaForm()), false);
  assert.equal(biaDirty({ ...blankBiaForm(), linked_asset_ids: [1] }), true);
  assert.equal(biaDirty({ ...blankBiaForm(), rto_hours: '1' }), true);
});

test('a dependency is sent as it always was, except that a non-vendor no longer carries a vendor choice made before the type was changed', () => {
  // old: external_bcp_status: type === 'vendor' ? (ext || 'requested') : (ext || null)
  assert.deepEqual(dependencyPayload({ dependency_type: 'vendor', name: 'Acme Cloud', criticality: 'high', external_bcp_status: '' }), { dependency_type: 'vendor', name: 'Acme Cloud', criticality: 'high', external_bcp_status: 'requested' });
  assert.equal(dependencyPayload({ dependency_type: 'vendor', name: 'A', criticality: 'high', external_bcp_status: 'confirmed' }).external_bcp_status, 'confirmed');
  assert.equal(dependencyPayload({ dependency_type: 'system', name: 'Core DB', criticality: 'medium', external_bcp_status: '' }).external_bcp_status, null);
  assert.equal(dependencyPayload({ dependency_type: 'system', name: 'Core DB', criticality: 'medium', external_bcp_status: 'confirmed' }).external_bcp_status, null, 'the field is not on the form for a system');
  assert.deepEqual(dependencyErrors(blankDependencyForm()), { name: 'Enter the name.' });
  assert.deepEqual(dependencyErrors({ ...blankDependencyForm(), name: 'Core DB' }), {});
  assert.equal(dependencyErrors({ ...blankDependencyForm(), name: 'x'.repeat(256) }).name, 'Use at most 255 characters.');
});

test('a strategy and a finding are sent as they always were', () => {
  assert.deepEqual(strategyPayload({ ...blankStrategyForm(), description: '' }), { strategy_type: 'alternate_site', description: null });
  assert.deepEqual(strategyPayload({ strategy_type: 'warm_site', description: 'Move to B' }), { strategy_type: 'warm_site', description: 'Move to B' });
  assert.deepEqual(findingPayload({ title: 'Failover too slow', description: '', severity: 'high' }), { title: 'Failover too slow', description: null, severity: 'high' });
  assert.deepEqual(findingErrors(blankFindingForm()), { title: 'Enter a title.' });
  assert.deepEqual(findingErrors({ ...blankFindingForm(), title: 'T' }), {});
  assert.match(FINDING_HINT, /issue threshold \(High by default\)/, 'the rule is a tenant setting, said so');
});

// ── the drill's result ──
test('Save result sends what it always sent; the tri-state reads Not assessed / met / missed', () => {
  // old ResultCard mutationFn
  const old = (f: { rto_met: string; rpo_met: string; actual_rto_hours: string | number; actual_rpo_hours: string | number; summary: string }) => ({
    rto_met: f.rto_met === '' ? null : f.rto_met === 'yes', rpo_met: f.rpo_met === '' ? null : f.rpo_met === 'yes',
    actual_rto_hours: f.actual_rto_hours === '' ? null : Number(f.actual_rto_hours), actual_rpo_hours: f.actual_rpo_hours === '' ? null : Number(f.actual_rpo_hours), summary: f.summary || null,
  });
  const forms = [
    { rto_met: 'yes', rpo_met: 'no', actual_rto_hours: '3', actual_rpo_hours: '0', summary: 'Went well.' },
    { rto_met: '', rpo_met: '', actual_rto_hours: '', actual_rpo_hours: '', summary: '' },
  ] as const;
  for (const f of forms) assert.deepEqual(resultPayload(f), old(f));
  assert.deepEqual(resultFormFrom(null), { rto_met: '', rpo_met: '', actual_rto_hours: '', actual_rpo_hours: '', summary: '' });
  assert.deepEqual(resultFormFrom({ id: 1, drill_id: 1, rto_met: false, rpo_met: true, actual_rto_hours: 9, actual_rpo_hours: 0, summary: 'S', recorded_by_name: 'A', recorded_at: null }),
    { rto_met: 'no', rpo_met: 'yes', actual_rto_hours: '9', actual_rpo_hours: '0', summary: 'S' });
  assert.deepEqual([true, false, null, undefined].map(triLabel), ['Yes — met', 'No — missed', 'Not assessed', 'Not assessed']);
  assert.deepEqual(resultErrors({ ...forms[1], actual_rto_hours: '2.5' }), { actual_rto_hours: 'Enter whole hours, 0 or more.' });
  assert.equal(resultDirty(resultFormFrom(null), resultFormFrom(null)), false);
  assert.equal(resultDirty(resultFormFrom(null), { ...resultFormFrom(null), summary: 'x' }), true);
});

// ── the moves ──
test('a plan can be moved to every other state, a drill to every other stored state (never to the derived "overdue")', () => {
  assert.deepEqual(planMoves('draft'), ['under_review', 'approved', 'retired']);
  assert.deepEqual(planMoves('approved'), ['draft', 'under_review', 'retired']);
  assert.deepEqual(drillMoves('scheduled'), ['in_progress', 'completed', 'under_review', 'closed', 'cancelled']);
  assert.deepEqual(DRILL_FLOW.slice(), ['scheduled', 'in_progress', 'completed', 'under_review', 'closed', 'cancelled']);
  assert.ok(!drillMoves('closed').includes('overdue'));
});

// ── the lists ──
test('the plan filters are the old ones: the status the plan has, a search in the title or the business unit in any case', () => {
  // the old expression of plans/page.tsx at 4722ba67
  const old = (data: Plan[], statusFilter: string, search: string) => {
    let rows = data || [];
    if (statusFilter !== 'all') rows = rows.filter((p) => p.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((p) => (p.title || '').toLowerCase().includes(q) || (p.business_unit || '').toLowerCase().includes(q));
    }
    return rows;
  };
  const data = [
    plan({ id: 1, title: 'Core Banking Plan', business_unit: 'Retail Banking', status: 'approved' }),
    plan({ id: 2, title: 'Treasury recovery', business_unit: null, status: 'draft' }),
    plan({ id: 3, title: 'Card services', business_unit: 'Cards & BANKING', status: 'draft' }),
    plan({ id: 4, title: 'HR', business_unit: 'People', status: 'retired' }),
  ];
  for (const status of ['all', 'draft', 'approved', 'retired', 'under_review']) {
    for (const q of ['', 'banking', 'BANK', 'treasury', 'people', 'zzz', '  ']) {
      assert.deepEqual(filterPlans(data, { q, status }).map((p) => p.id), old(data, status, q).map((p) => p.id), `${status} / "${q}"`);
    }
  }
  assert.deepEqual(filterPlans(data, { q: ' banking ', status: 'all' }).map((p) => p.id), [1, 3], 'spaces around the search are ignored (the address keeps it trimmed)');
});

test('the drill filters are the old ones: the EFFECTIVE status, the type, the source, a search in the title or the plan\'s title', () => {
  const old = (data: Drill[], s: string, t: string, so: string, search: string) => {
    let rows = data || [];
    if (s !== 'all') rows = rows.filter((d) => d.effective_status === s);
    if (t !== 'all') rows = rows.filter((d) => d.drill_type === t);
    if (so !== 'all') rows = rows.filter((d) => d.source_type === so);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((d) => (d.title || '').toLowerCase().includes(q) || (d.plan_title || '').toLowerCase().includes(q));
    }
    return rows;
  };
  const data = [
    drill({ id: 1, title: 'Tabletop one', plan_title: 'Core Banking', effective_status: 'overdue', status: 'scheduled' }),
    drill({ id: 2, title: 'Failover', plan_title: 'Treasury', drill_type: 'full_failover', effective_status: 'completed', status: 'completed' }),
    drill({ id: 3, title: 'Real activation', plan_title: null, source_type: 'incident_triggered', drill_type: 'call_tree', effective_status: 'closed', status: 'closed' }),
  ];
  for (const s of ['all', 'overdue', 'scheduled', 'completed']) for (const t of ['all', 'tabletop', 'full_failover']) for (const so of ['all', 'incident_triggered']) for (const q of ['', 'core', 'FAIL', 'zzz']) {
    assert.deepEqual(filterDrills(data, { q, status: s, type: t, source: so }).map((d) => d.id), old(data, s, t, so, q).map((d) => d.id), `${s}/${t}/${so}/"${q}"`);
  }
});

test('sorting: text in natural order, numbers by value, a day by its date, a status by its place in the flow, nothing last whichever way; no sort keeps the server order', () => {
  const rows = [
    plan({ id: 1, title: 'Plan 10', rto_hours: 24, status: 'approved', next_review_due: '2026-12-01T00:00:00', owner_name: 'Zed', testing_frequency: 'quarterly' }),
    plan({ id: 2, title: 'plan 2', rto_hours: null, status: 'draft', next_review_due: null, owner_name: null, testing_frequency: 'annual' }),
    plan({ id: 3, title: 'Plan 1', rto_hours: 4, status: 'retired', next_review_due: '2026-11-01T00:00:00', owner_name: 'Amy', testing_frequency: 'semi_annual' }),
  ];
  const ids = (sort: Parameters<typeof ordered<Plan>>[1]) => ordered(rows, sort, planSortValue).map((p) => p.id);
  assert.deepEqual(ids(null), [1, 2, 3]);
  assert.deepEqual(ids({ key: 'title', dir: 'asc' }), [3, 2, 1], 'Plan 1, plan 2, Plan 10');
  assert.deepEqual(ids({ key: 'rto', dir: 'asc' }), [3, 1, 2], 'an empty RTO is last');
  assert.deepEqual(ids({ key: 'rto', dir: 'desc' }), [1, 3, 2], 'and last again descending');
  assert.deepEqual(ids({ key: 'status', dir: 'asc' }), [2, 1, 3], 'draft, approved, retired');
  assert.deepEqual(ids({ key: 'review', dir: 'asc' }), [3, 1, 2]);
  assert.deepEqual(ids({ key: 'owner', dir: 'asc' }), [3, 1, 2]);
  assert.deepEqual(ids({ key: 'cadence', dir: 'asc' }), [2, 3, 1], 'annual, semi-annual, quarterly');
  assert.equal(planSortValue(rows[0], 'nope'), null);
  assert.deepEqual(PLAN_SORT_KEYS.map((k) => k), ['title', 'status', 'rto', 'rpo', 'review', 'owner', 'cadence', 'bia', 'drills']);
  const drills = [drill({ id: 1, effective_status: 'overdue', drill_type: 'call_tree', scheduled_date: '2026-10-01T00:00:00' }), drill({ id: 2, effective_status: 'scheduled', drill_type: 'tabletop', scheduled_date: null }), drill({ id: 3, effective_status: 'closed', drill_type: 'simulation', scheduled_date: '2026-09-01T00:00:00' })];
  assert.deepEqual(ordered(drills, { key: 'status', dir: 'asc' }, drillSortValue).map((d) => d.id), [2, 3, 1], 'scheduled, closed, overdue: the order of the flow');
  assert.deepEqual(ordered(drills, { key: 'scheduled', dir: 'asc' }, drillSortValue).map((d) => d.id), [3, 1, 2]);
  assert.deepEqual(ordered(drills, { key: 'type', dir: 'asc' }, drillSortValue).map((d) => d.id), [2, 3, 1]);
  const bias = [
    { id: 1, plan_id: 1, process_name: 'B', description: null, criticality_rating: 'low', rto_hours: 1, rpo_hours: null, mtpd_hours: 9, linked_risk_id: null, is_complete: true, dependency_count: 2, strategy_count: 1, linked_assets: [{ id: 1, name: 'a' }] },
    { id: 2, plan_id: 1, process_name: 'A', description: null, criticality_rating: 'critical', rto_hours: 8, rpo_hours: 1, mtpd_hours: 12, linked_risk_id: null, is_complete: false, dependency_count: 0, strategy_count: 0 },
  ];
  assert.deepEqual(ordered(bias, { key: 'criticality', dir: 'asc' }, biaSortValue).map((b) => b.id), [2, 1], 'critical first');
  assert.deepEqual(ordered(bias, { key: 'complete', dir: 'asc' }, biaSortValue).map((b) => b.id), [2, 1], 'the ones that need a strategy first');
  assert.deepEqual(BIA_SORT_KEYS.slice(0, 3), ['process', 'criticality', 'rto']);
});

test('a page of rows is cut from the whole list and its range clamped (page 9 of 3 is page 3)', () => {
  const rows = Array.from({ length: 60 }, (_, i) => i + 1);
  assert.deepEqual(pageOf(rows, 1, 25).rows.length, 25);
  assert.equal(pageOf(rows, 3, 25).rows.length, 10);
  assert.equal(pageOf(rows, 9, 25).range.page, 3);
  assert.deepEqual(pageOf([], 1, 25).rows, []);
  assert.equal(pageOf(rows, 2, 25).range.from, 26);
});

test('the address of the Plans list keeps the filters, the sort and the page; a link that says something unusable is the default; the plain address has no params', () => {
  const state = readAddress(PLAN_LIST_SCHEMA, '?q=bank&status=Approved&sort=review:desc&page=3&size=50&new=1');
  assert.deepEqual(state, { q: 'bank', status: 'approved', sort: { key: 'review', dir: 'desc' }, page: 3, size: 50, new: true });
  assert.deepEqual(readAddress(PLAN_LIST_SCHEMA, ''), { q: '', status: 'all', sort: null, page: 1, size: 25, new: false });
  assert.deepEqual(readAddress(PLAN_LIST_SCHEMA, '?status=zzz&sort=owner:up&page=0&size=9999&new=maybe'), { q: '', status: 'all', sort: null, page: 1, size: 25, new: false });
  assert.equal(writeAddress(PLAN_LIST_SCHEMA, '', readAddress(PLAN_LIST_SCHEMA, '')), '');
  assert.equal(writeAddress(PLAN_LIST_SCHEMA, '?id=7', state), 'id=7&q=bank&status=approved&sort=review%3Adesc&page=3&size=50&new=1');
  assert.deepEqual(PLAN_FILTERS, ['all', 'draft', 'under_review', 'approved', 'retired']);
});

test('the address of the Drills list: the Overview\'s overdue counter opens ?status=overdue, the activations counter ?source=incident_triggered', () => {
  assert.deepEqual(readAddress(DRILL_LIST_SCHEMA, '?status=overdue').status, 'overdue');
  assert.equal(readAddress(DRILL_LIST_SCHEMA, '?source=incident_triggered').source, 'incident_triggered');
  assert.equal(readAddress(DRILL_LIST_SCHEMA, '?type=full_failover&q=Q3').type, 'full_failover');
  assert.deepEqual(readAddress(DRILL_LIST_SCHEMA, '?status=zzz&type=zzz&source=zzz'), { q: '', status: 'all', type: 'all', source: 'all', sort: null, page: 1, size: 25, new: false });
  assert.equal(writeAddress(DRILL_LIST_SCHEMA, '', { ...readAddress(DRILL_LIST_SCHEMA, ''), status: 'overdue' }), 'status=overdue');
});

test('a list the server cut says the true total and what search and sort then work on; a list that is all there says nothing', () => {
  const noun = { one: 'plan', other: 'plans' };
  assert.equal(cutNotice({ loaded: 200, total: 200, noun }), null);
  assert.equal(cutNotice({ loaded: 5, total: 5, noun }), null);
  assert.deepEqual(cutNotice({ loaded: 200, total: 1240, noun }), {
    title: 'Showing 200 of 1,240 plans',
    message: 'The server sends the 200 most recently updated. Search, filters and sorting work on these 200.',
  });
  assert.equal(cutNotice({ loaded: 200, total: 201, noun: { one: 'drill', other: 'drills' }, order: 'latest scheduled' })?.message, 'The server sends the 200 latest scheduled. Search, filters and sorting work on these 200.');
});

// ── deletes ──
test('a delete says what else goes with it, in counts that are true (the plan\'s own BIA and drill counts)', () => {
  assert.deepEqual(planDeleteWords({ title: 'Core Banking', bia_count: 1, drill_count: 0 }), {
    title: 'Delete this plan?',
    message: '“Core Banking” will be deleted with its 1 business impact analysis process and 0 drills (and their results and findings). Issues and risks raised from them stay. This can\'t be undone.',
    confirmLabel: 'Delete plan',
  });
  assert.match(planDeleteWords({ title: 'P', bia_count: 6, drill_count: 16 }).message, /6 business impact analysis processes and 16 drills/);
  assert.match(planDeleteWords({ title: 'x'.repeat(300), bia_count: 0, drill_count: 0 }).message, /^“x{79}…” will/, 'a long name is cut in the question');
  assert.deepEqual(drillDeleteWords({ title: 'Q3 tabletop', finding_count: 2 }), {
    title: 'Delete this drill?',
    message: '“Q3 tabletop” will be deleted with its result and 2 findings. Issues and risks raised from the findings stay. This can\'t be undone.',
    confirmLabel: 'Delete drill',
  });
  assert.equal(dependencyDeleteWords('Core DB').confirmLabel, 'Remove dependency');
  assert.match(strategyDeleteWords('Warm Site').message, /last one, the process is marked as needing a recovery strategy again/);
  assert.match(findingDeleteWords('Slow failover').message, /An issue or a risk raised from it stays/);
});

// ── the pickers ──
test('a picker offers the record already linked first, then what the server listed, each id once, with the second line as a description', () => {
  const out = pickOptions([{ value: 9, label: 'Linked owner' }], [{ value: 1, label: 'A', subLabel: 'a@x.com' }, { value: 9, label: 'Linked owner again' }, { value: 2, label: 'B', subLabel: null }]);
  assert.deepEqual(out, [{ value: '9', label: 'Linked owner', description: undefined }, { value: '1', label: 'A', description: 'a@x.com' }, { value: '2', label: 'B', description: undefined }]);
  assert.deepEqual(pickOptions(undefined, undefined), []);
});

test('a list the server returns at its cap may have been cut, and the field says so', () => {
  assert.deepEqual(OPTION_CAPS, { documents: 50, incidents: 50, risks: 50, users: 100, assets: 100 });
  assert.equal(optionsCut('documents', 49), false);
  assert.equal(optionsCut('documents', 50), true);
  assert.equal(optionsCut('users', 99), false);
  assert.equal(optionsCut('users', 100), true);
  assert.equal(cutHint('users'), 'Only the first 100 people are listed here.');
  assert.equal(cutHint('documents'), 'Only the first 50 documents are listed here.');
});

// ── the Overview ──
const dash = (o: Partial<Dashboard> = {}): Dashboard => ({
  totals: { plans: 170, active_plans: 129, drills: 138, overdue_drills: 15, bia_records: 6, open_findings: 54 }, plans_by_status: { draft: 40, approved: 80 }, drills_by_status: {},
  drill_coverage_pct: 11.6, coverage_detail: { covered: 15, active_plans: 129 }, rto_pass_rate: 66.7, rpo_pass_rate: null, results_scored: 3,
  open_findings_by_severity: { critical: 1, high: 2, medium: 3, low: 4 }, linkage: { open_capas: 2, total_capas: 5, risks_linked: 4, incident_invocations: 6 }, recent_drills: [], overdue_drills: [], ...o,
});

test('a rate is the server\'s number and a percent sign, never rounded again; none recorded is the dash', () => {
  assert.equal(percentText(11.6), '11.6%');
  assert.equal(percentText(100), '100%');
  assert.equal(percentText(0), '0%');
  assert.equal(percentText(null), '—');
  assert.equal(`${11.6}%`, percentText(11.6), 'the old template literal');
});

test('the pass-rate bar keeps its colours: 80 and over on track, 50 and over a watch, below off target; no rate has no bar and no colour', () => {
  // old: (row.v ?? 0) >= 80 ? emerald : (row.v ?? 0) >= 50 ? amber : rose
  const old = (v: number | null) => ((v ?? 0) >= 80 ? 'success' : (v ?? 0) >= 50 ? 'warning' : 'danger');
  for (const v of [0, 10, 49.9, 50, 79.9, 80, 100]) assert.equal(rateTone(v), old(v), String(v));
  assert.equal(rateTone(null), null, 'not assessed is not 0%: the old page painted it as 0% in the failing colour');
  assert.equal(rateTone(undefined), null);
});

test('the coverage tile says the server\'s percentage and what it counts; with no active plan there is no rate: Not recorded, not 0%', () => {
  assert.deepEqual(coverageTile(dash()), { value: '11.6%', progress: 11.6, note: '15 of 129 active plans tested in the last 12 months' });
  assert.equal(coverageTile(dash({ coverage_detail: { covered: 1, active_plans: 1 }, drill_coverage_pct: 100 })).note, '1 of 1 active plan tested in the last 12 months');
  assert.deepEqual(coverageTile(dash({ coverage_detail: { covered: 0, active_plans: 0 }, drill_coverage_pct: 0 })), { value: null, progress: null, note: '' });
  assert.equal(coverageTile(dash({ coverage_detail: { covered: 0, active_plans: 4 }, drill_coverage_pct: 0 })).value, '0%', 'four plans and none tested is a true 0%');
});

test('an empty tenant has no plan and no drill; the cross-module rollup is absent for an older server and is then not recorded, never zeros', () => {
  assert.equal(isEmptyTenant(dash()), false);
  assert.equal(isEmptyTenant(dash({ totals: { plans: 0, active_plans: 0, drills: 0, overdue_drills: 0, bia_records: 0, open_findings: 0 } })), true);
  assert.equal(isEmptyTenant(dash({ totals: { plans: 3, active_plans: 3, drills: 0, overdue_drills: 0, bia_records: 0, open_findings: 0 } })), false, 'plans and no drill yet: the figures are true zeros');
  assert.equal(linkageOf(dash())?.open_capas, 2);
  const noLinkage = dash(); delete noLinkage.linkage;
  assert.equal(linkageOf(noLinkage), null);
});

test('the counters: a status the server does not list has no plan (a true 0); the lists are cut at six and say so', () => {
  assert.equal(planCount(dash(), 'approved'), 80);
  assert.equal(planCount(dash(), 'retired'), 0);
  assert.equal(findingCount(dash(), 'high'), 2);
  assert.equal(findingCount(dash(), 'nope'), 0);
  assert.equal(listCut(6, 15), 'Showing 6 of 15');
  assert.equal(listCut(6, 6), null);
  assert.equal(listCut(2, 2), null);
});

test('a BIA process says whether it has a recovery strategy (the server marks it complete on the first one)', () => {
  assert.deepEqual(biaCompleteness({ is_complete: true }), { complete: true, label: 'Complete' });
  assert.deepEqual(biaCompleteness({ is_complete: false }), { complete: false, label: 'Needs a recovery strategy' });
});
