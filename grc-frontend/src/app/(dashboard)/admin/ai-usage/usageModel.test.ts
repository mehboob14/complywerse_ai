// node --test "src/app/(dashboard)/admin/ai-usage/usageModel.test.ts"
// AI usage's rules: numbers are said the way the old Token usage page said them, the budget cut-offs are the server's (70 and 85), a period starts where it always did, the
// search keeps a module whole when its name matches, the chart's totals leave out switched-off modules, the address keeps the view, and the tracing view never names a service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import {
  ACTIVITY_OFF, axisLabel, budgetBand, chartRows, fmtTokens, mayReadRunText, money, periodRange, quotaTone, rangeLabel, rangeStart, runText, searchModules, seconds, stackTotals, trendOf,
  USAGE_SCHEMA, type SeriesPoint,
} from './usageModel.ts';

test('tokens are said as K, M and B with no trailing .0; money keeps two places, and a cost under a cent can show four', () => {
  assert.deepEqual([0, 7, 999, 1000, 1234, 15600, 1_000_000, 1_250_000, 3_400_000_000].map(fmtTokens), ['0', '7', '999', '1K', '1.2K', '15.6K', '1M', '1.3M', '3.4B']);
  assert.equal(fmtTokens(null), '0');
  assert.equal(fmtTokens(-2500), '-2.5K');
  assert.equal(money(4.5), '$4.50');
  assert.equal(money(1234567.891), '$1,234,567.89');
  assert.equal(money(0), '$0.00');
  assert.equal(money(0.0042, { fine: true }), '$0.0042');
  assert.equal(money(0.0042), '$0.00');
});

test('a trend says more or less against the period before, never a bare arrow', () => {
  assert.deepEqual(trendOf(12.34), { direction: 'more', text: '12.3% more' });
  assert.deepEqual(trendOf(-5), { direction: 'less', text: '5.0% less' });
  assert.deepEqual(trendOf(0), { direction: 'same', text: 'No change' });
  assert.deepEqual(trendOf(undefined), { direction: 'same', text: 'No change' });
});

test('a budget is "nearing" from 70 percent and "near the limit" from 85 (the server alerts at 85); the quota bar turns red strictly above 85', () => {
  assert.deepEqual([0, 69.9, 70, 84.9, 85, 120].map(budgetBand), ['ok', 'ok', 'watch', 'watch', 'over', 'over']);
  assert.equal(quotaTone(85), 'primary');
  assert.equal(quotaTone(85.1), 'danger');
  assert.equal(quotaTone(undefined), 'primary');
});

test('a period starts where the page always started it: 24 hours back, N days back, or the 1st of the month for the billing cycle', () => {
  const now = new Date(2026, 10, 18, 15, 30, 0);
  assert.equal(rangeStart('24h', now).getTime(), new Date(2026, 10, 17, 15, 30, 0).getTime());
  assert.equal(rangeStart('7d', now).getDate(), 11);
  assert.equal(rangeStart('90d', now).getMonth(), 7);
  const cycle = rangeStart('cycle', now);
  assert.deepEqual([cycle.getMonth(), cycle.getDate(), cycle.getHours(), cycle.getMinutes()], [10, 1, 0, 0]);
  assert.equal(rangeStart('weird', now).getTime(), new Date(2026, 9, 19, 15, 30, 0).getTime(), 'an unknown range counts 30 days');
  assert.equal(rangeLabel('cycle'), 'Billing cycle');
  assert.equal(rangeLabel('nope'), '24 hours');
  const p = periodRange(30, now);
  assert.equal(new Date(p.end).getTime() - new Date(p.start).getTime(), 30 * 86400000);
});

test('the chart axis says the clock hour for an hourly view and the day otherwise, in fixed words', () => {
  const stamp = new Date(2026, 10, 3, 14, 0, 0).toISOString();
  assert.equal(axisLabel(stamp, 'hour'), '14:00');
  assert.equal(axisLabel(stamp, 'day'), '3 Nov');
  assert.equal(axisLabel('not a date', 'day'), '');
});

test('the search keeps a module whole when its name matches, else only the features that match, and drops the rest', () => {
  const modules = [
    { module_key: 'risk', label: 'Risk Management', features: [{ feature_key: 'score', label: 'Risk scoring' }, { feature_key: 'draft', label: 'Drafting' }] },
    { module_key: 'gov', label: 'Governance', features: [{ feature_key: 'summary', label: 'Document summary' }, { feature_key: 'rewrite', label: 'Rewrite' }] },
  ];
  assert.equal(searchModules(modules, '').length, 2);
  assert.deepEqual(searchModules(modules, 'risk').map((m) => [m.module_key, m.features.length]), [['risk', 2]]);
  assert.deepEqual(searchModules(modules, 'summary').map((m) => [m.module_key, m.features.map((f) => f.feature_key)]), [['gov', ['summary']]]);
  assert.deepEqual(searchModules(modules, 'zzz'), []);
  assert.deepEqual(searchModules(modules, '  GOV  ').map((m) => m.module_key), ['gov'], 'case and spaces do not matter');
});

test('the stacked bars add up only the modules that are on, and the tallest bar is never zero', () => {
  const series: SeriesPoint[] = [{ date: 'a', values: { risk: 10, gov: 5 } }, { date: 'b', values: { risk: 2 } }, { date: 'c', values: {} }];
  assert.deepEqual(stackTotals(series, ['risk', 'gov']), { totals: [15, 2, 0], max: 15 });
  assert.deepEqual(stackTotals(series, ['gov']), { totals: [5, 0, 0], max: 5 });
  assert.deepEqual(stackTotals(series, []), { totals: [0, 0, 0], max: 1 });
  assert.deepEqual(stackTotals([], ['risk']), { totals: [], max: 1 });
  assert.deepEqual(chartRows([{ date: new Date(2026, 10, 3, 9).toISOString(), values: { risk: 4 } }], ['risk'], 'day'), [['3 Nov', 4]]);
});

test('the address keeps the view, the period and the person; a junk value is the default', () => {
  const state = { view: 'people' as const, range: '30d' as const, person: '12' };
  assert.deepEqual(readAddress(USAGE_SCHEMA, writeAddress(USAGE_SCHEMA, '', state)), state);
  assert.equal(writeAddress(USAGE_SCHEMA, '', { view: 'tokens', range: '24h', person: '' }), '');
  assert.equal(readAddress(USAGE_SCHEMA, 'view=oops&range=1y').view, 'tokens');
  assert.equal(readAddress(USAGE_SCHEMA, 'view=oops&range=1y').range, '24h');
  assert.equal(writeAddress(USAGE_SCHEMA, 'other=1', { view: 'activity', range: '24h', person: '' }), 'other=1&view=activity');
});

test('run text is shown only to who may read prompts, and the activity view names no service or setting', () => {
  assert.equal(mayReadRunText({ isAdmin: true, hasPermission: () => false }), true);
  assert.equal(mayReadRunText({ isAdmin: false, hasPermission: (k) => k === 'admin:ai_governance:payloads' }), true);
  assert.equal(mayReadRunText({ isAdmin: false, hasPermission: (k) => k === 'admin:organization:view' }), false);
  assert.equal(runText(null), null);
  assert.equal(runText('plain'), 'plain');
  assert.equal(runText({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(seconds(1400), '1.4 s');
  assert.equal(seconds(null), '—');
  const words = `${ACTIVITY_OFF.title} ${ACTIVITY_OFF.message}`;
  assert.doesNotMatch(words, /langsmith|openai|gpt|claude|anthropic|api[_ ]?key|env/i);
  const src = readFileSync(new URL('./usageModel.ts', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /langsmith/i, 'no vendor or variable name in the model');
});

test('the budgets form speaks millions of tokens and saves whole tokens, refuses what the server would silently clamp, and knows when it changed', async () => {
  const { budgetDirty, budgetErrors, budgetForm, budgetPayload, hasBudgetErrors } = await import('./usageModel.ts');
  const source = { monthly_quota: 2_500_000, blended_rate_per_million: 4.5, billing_cycle_day: 12, modules: [{ module_key: 'risk', monthly_budget: 500_000 }, { module_key: 'gov', monthly_budget: 0 }] };
  const form = budgetForm(source);
  assert.deepEqual(form, { quotaM: '2.5', rate: '4.5', cycleDay: '12', modules: { risk: '0.5', gov: '0' } });
  assert.deepEqual(budgetPayload(form, source), { monthly_quota: 2_500_000, blended_rate_per_million: 4.5, billing_cycle_day: 12, modules: [{ module_key: 'risk', monthly_budget: 500_000 }, { module_key: 'gov', monthly_budget: 0 }] });
  assert.equal(hasBudgetErrors(budgetErrors(form)), false);
  assert.equal(budgetDirty(form, { ...form }), false);
  assert.equal(budgetDirty(form, { ...form, rate: '5' }), true);
  const bad = budgetErrors({ quotaM: '', rate: '-1', cycleDay: '31', modules: { risk: 'x', gov: '2' } });
  assert.ok(bad.quotaM && bad.rate && bad.cycleDay && bad.modules.risk);
  assert.equal(bad.modules.gov, undefined);
  assert.ok(budgetErrors({ ...form, cycleDay: '2.5' }).cycleDay, 'a day is a whole number');
  assert.deepEqual(budgetPayload({ ...form, quotaM: '0.0000004' }, source).monthly_quota, 0, 'under a token is none');
});
