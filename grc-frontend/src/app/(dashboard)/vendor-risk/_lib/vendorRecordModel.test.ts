// node --test "src/app/(dashboard)/vendor-risk/_lib/vendorRecordModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cadenceFor, cadenceLabel, classificationTone, contactLine, dataShared, daysUntil, findingFrom, isTiered, lifecycleHref, metaParts,
  localToServer, nextReview, openScopes, pickEngagement, recordHref, reviewClock, settled, sourceLabel, tabFor, targetTiered, tierHref, tierTarget,
  webHost, webHref, type Scope,
} from './vendorRecordModel.ts';
import { fmt } from '../_ui/fmt.ts';

const TODAY = new Date(2026, 9, 29, 15, 30);          // 29 Oct 2026, mid-afternoon, the viewer's own day

test('every old tab key lands on the tab that now holds it, and an unknown one on the Overview', () => {
  const rows: Array<[string | null, string]> = [
    ['overview', 'overview'], ['lifecycle', 'lifecycle'], ['assessments', 'assessments'], ['findings', 'findings'],
    ['paperwork', 'paperwork'], ['monitoring', 'monitoring'],
    ['engagements', 'overview'], ['dependencies', 'overview'], ['portal', 'assessments'], ['exposure', 'assessments'],
    ['actions', 'findings'], ['sla', 'paperwork'], ['outside-in', 'monitoring'], ['incidents', 'monitoring'],
    ['  Outside-In ', 'monitoring'], ['PAPERWORK', 'paperwork'],
    ['nonsense', 'overview'], ['', 'overview'], [null, 'overview'],
  ];
  for (const [tab, want] of rows) assert.equal(tabFor({ tab }), want, String(tab));
  assert.equal(tabFor({}), 'overview');
});

test('a link to a stage opens the Lifecycle, a link to a finding the Findings tab, and the finding wins when a link names both', () => {
  assert.equal(tabFor({ stage: 'approval' }), 'lifecycle');
  assert.equal(tabFor({ finding: '12' }), 'findings');
  assert.equal(tabFor({ stage: 'findings', finding: '12' }), 'findings');            // what an alert or a signal links to
  assert.equal(tabFor({ stage: 'approval', tab: 'paperwork' }), 'lifecycle');       // the stage is the more specific ask
  assert.equal(tabFor({ finding: 'abc', tab: 'sla' }), 'paperwork');                // not a finding id: ignored
  assert.equal(tabFor({ finding: '' }), 'overview');
  assert.equal(findingFrom('12'), 12);
  for (const bad of ['', 'x', '0', '-3', '1.5', null, undefined]) assert.equal(findingFrom(bad as string), null, String(bad));
});

test('addresses: only the parameters with a value, tiering through the Lifecycle tab', () => {
  assert.equal(recordHref(5), '/vendor-risk/vendors/5');
  assert.equal(recordHref(5, { tab: 'findings', finding: 9, engagement: null, tier: '' }), '/vendor-risk/vendors/5?tab=findings&finding=9');
  assert.equal(tierHref(5, null), '/vendor-risk/vendors/5?tab=lifecycle&tier=1');
  assert.equal(tierHref(5, 12), '/vendor-risk/vendors/5?tab=lifecycle&tier=1&engagement=12');
  assert.equal(lifecycleHref(5, 12), '/vendor-risk/vendors/5?tab=lifecycle&engagement=12');
});

const general: Scope = { id: null, is_general: true, name: 'General', status: 'active', tier: 'medium', inherent_risk_score: null };
const payroll: Scope = { id: 12, name: 'Payroll', status: 'active', tier: 'high', inherent_risk_score: 61 };
const crm: Scope = { id: 13, name: 'CRM', status: 'active', tier: null, inherent_risk_score: null };
const old: Scope = { id: 14, name: 'Old', status: 'ended', tier: null, inherent_risk_score: null };

test('tiered means a score was worked out, never the seeded tier alone', () => {
  assert.equal(isTiered(general), false);                                           // General carries the seeded "medium"
  assert.equal(isTiered(payroll), true);
  assert.equal(isTiered({ inherent_risk_score: 0 }), true);                         // a score of 0 is still a score
  assert.equal(isTiered(null), false);
  assert.equal(isTiered(undefined), false);
});

test('the picked engagement is General when it is not one in use, and taken as given until the list is there', () => {
  const items = [general, payroll, crm, old];
  assert.equal(pickEngagement(items, 12), 12);
  assert.equal(pickEngagement(items, 14), null);                                    // ended
  assert.equal(pickEngagement(items, 99), null);                                    // a stale link
  assert.equal(pickEngagement(items, null), null);
  assert.equal(pickEngagement(undefined, 12), 12);
  assert.deepEqual(openScopes(items).map((e) => e.name), ['General', 'Payroll', 'CRM']);
  assert.deepEqual(openScopes(undefined), []);
});

test('Tier engagement is for the picked engagement when it has no tier, else the first one that has none', () => {
  const items = [general, payroll, crm, old];
  assert.equal(tierTarget(items, 12), null);                      // payroll is tiered; General (the first untiered) is next: null is General
  assert.equal(tierTarget(items, null), null);                    // General, picked and untiered
  assert.equal(tierTarget(items, 13), 13);                        // CRM picked and untiered
  assert.equal(tierTarget([{ ...general, inherent_risk_score: 40 }, payroll, crm], 12), 13);
  assert.equal(tierTarget([{ ...general, inherent_risk_score: 40 }, payroll], 12), 12);      // everything tiered: the one picked, to re-tier
  assert.equal(tierTarget([{ ...general, id: 7 }], null), null);                              // General's own row id is never sent as an engagement
  assert.equal(tierTarget(undefined, 12), 12);
  assert.equal(targetTiered(items, 12), true);
  assert.equal(targetTiered(items, 13), false);
  assert.equal(targetTiered(items, null), false);                                             // General
  assert.equal(targetTiered(undefined, null), false);
});

test('days are counted in calendar days, a date with no time as written and a moment as the viewer\'s own day', () => {
  assert.equal(daysUntil('2026-11-07', TODAY), 9);
  assert.equal(daysUntil('2026-10-29', TODAY), 0);
  assert.equal(daysUntil('2026-10-17', TODAY), -12);
  assert.equal(daysUntil('2026-11-07T00:00:00', TODAY) === 9 || daysUntil('2026-11-07T00:00:00', TODAY) === 8 || daysUntil('2026-11-07T00:00:00', TODAY) === 10, true);
  assert.equal(daysUntil(null, TODAY), null);
  assert.equal(daysUntil('not a date', TODAY), null);
  // the number and the words never disagree
  for (const day of ['2026-11-07', '2026-10-29', '2026-10-17', '2027-04-27']) {
    const n = daysUntil(day, TODAY) as number;
    const words = fmt.countdown(day, TODAY);
    assert.equal(words, n === 0 ? 'today' : n > 0 ? `in ${n} ${n === 1 ? 'day' : 'days'}` : `${-n} ${n === -1 ? 'day' : 'days'} ago`, day);
  }
});

test('a review date reads red once it has passed, amber in the month before, green after', () => {
  assert.deepEqual(reviewClock('2026-10-17', TODAY), { tone: 'danger', label: 'Overdue 12 days ago' });
  assert.deepEqual(reviewClock('2026-10-28', TODAY), { tone: 'danger', label: 'Overdue 1 day ago' });
  assert.deepEqual(reviewClock('2026-10-29', TODAY), { tone: 'warning', label: 'Due today' });
  assert.deepEqual(reviewClock('2026-11-07', TODAY), { tone: 'warning', label: 'Due in 9 days' });
  assert.deepEqual(reviewClock('2026-11-28', TODAY), { tone: 'warning', label: 'Due in 30 days' });
  assert.deepEqual(reviewClock('2026-11-29', TODAY), { tone: 'success', label: 'Due in 31 days' });
  assert.deepEqual(reviewClock('2027-04-27', TODAY), { tone: 'success', label: 'Due in 180 days' });
  assert.equal(reviewClock(null, TODAY), null);
});

test('the next review is the earliest among the engagements in use, the supplier\'s own date when there is no list', () => {
  const items: Scope[] = [
    { ...general, next_reassessment_date: '2027-05-01T00:00:00' },
    { ...payroll, next_reassessment_date: '2027-01-15T00:00:00' },
    { ...crm, next_reassessment_date: null },
    { ...old, next_reassessment_date: '2026-01-01T00:00:00' },                      // ended: not counted
  ];
  assert.equal(nextReview(items, '2030-01-01'), '2027-01-15T00:00:00');
  assert.equal(nextReview([{ ...crm }], '2030-01-01'), null);                        // a list with no date says none, whatever the supplier holds
  assert.equal(nextReview(undefined, '2030-01-01'), '2030-01-01');
  assert.equal(nextReview(undefined, null), null);
  assert.equal(nextReview([], null), null);
});

test('a cadence reads in the words that suit it, and an engagement\'s own beats the policy for its tier', () => {
  const rows: Array<[number | null | undefined, string]> = [
    [180, 'every 6 months'], [90, 'every 3 months'], [30, 'every month'], [365, 'every year'], [730, 'every 2 years'],
    [1095, 'every 3 years'], [45, 'every 45 days'], [1, 'every 1 days'], [0, 'not set'], [null, 'not set'], [undefined, 'not set'],
  ];
  for (const [days, words] of rows) assert.equal(cadenceLabel(days), words, String(days));
  const policy = { critical: 180, high: 365, medium: 730, low: 1095 };
  assert.equal(cadenceFor({ tier: 'High', reassessment_cadence_days: null }, policy), 365);
  assert.equal(cadenceFor({ tier: 'high', reassessment_cadence_days: 60 }, policy), 60);
  assert.equal(cadenceFor({ tier: null, reassessment_cadence_days: null }, policy), null);
  assert.equal(cadenceFor({ tier: 'high', reassessment_cadence_days: null }, undefined), null);
});

test('settled stages are the complete ones and the ones the policy skipped', () => {
  const stages = ['complete', 'skipped', 'in_progress', 'blocked', 'not_started'].map((status) => ({ status }));
  assert.deepEqual(settled(stages), { done: 2, total: 5 });
  assert.equal(settled([]), null);
  assert.equal(settled(undefined), null);
});

test('the facts under a vendor\'s name and in its right column', () => {
  assert.equal(sourceLabel({ intake_status: 'approved' }), 'Onboarding request');
  assert.equal(sourceLabel({ intake_status: null }), 'Added directly');
  assert.equal(sourceLabel(undefined), 'Added directly');
  assert.equal(classificationTone('Restricted'), 'danger');
  assert.equal(classificationTone('confidential'), 'warning');
  assert.equal(classificationTone('internal'), 'neutral');
  assert.equal(classificationTone(null), 'neutral');
  assert.deepEqual(metaParts({ vendor_type: 'Supplier', industry: ' Payroll ', business_unit: { name: 'People' } }), ['Supplier', 'Payroll', 'People']);
  assert.deepEqual(metaParts({ vendor_type: null, industry: '', business_unit: null }), []);
  assert.equal(webHref('acme.example/about'), 'https://acme.example/about');
  assert.equal(webHref('http://acme.example'), 'http://acme.example');
  assert.equal(webHref('javascript:alert(1)'), null);
  assert.equal(webHref('ftp://acme.example'), null);
  assert.equal(webHref('acme.example:8080/x'), 'https://acme.example:8080/x');
  assert.equal(webHref('  '), null);
  assert.equal(webHref(null), null);
  assert.equal(webHost('https://www.acme.example/about?x=1'), 'acme.example');
  assert.equal(webHost('acme.example'), 'acme.example');
  assert.deepEqual(dataShared({ data_types_accessed: ['PII', ' ', 'Payroll'], holds_personal_data: false }), { chips: ['PII', 'Payroll'], note: null });
  assert.deepEqual(dataShared({ data_types_accessed: [], holds_personal_data: true }), { chips: [], note: 'Personal data, types not itemised' });
  assert.deepEqual(dataShared({ data_types_accessed: null, holds_personal_data: null }), { chips: [], note: 'None recorded' });
  assert.equal(contactLine({ roles: ['primary', 'security'], email: 'dana@acme.example' }), 'Security · dana@acme.example');
  assert.equal(contactLine({ roles: ['security'], email: 'dana@acme.example', phone: '+44 20 7946 0000' }), 'Security · dana@acme.example · +44 20 7946 0000');
  assert.equal(contactLine({ roles: ['primary'], email: null }), 'No details');
  assert.equal(contactLine({ roles: ['security', 'privacy'], email: null }), 'Security, Privacy');
});

test('a time typed into a datetime-local box goes to the server as naive UTC', () => {
  const sent = localToServer('2026-10-29T14:30');
  assert.match(sent, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);                 // no zone, no milliseconds
  assert.equal(new Date(`${sent}Z`).getTime(), new Date('2026-10-29T14:30').getTime());   // the same moment, whatever the viewer's zone
  assert.equal(localToServer('not a time'), 'not a time');
});
