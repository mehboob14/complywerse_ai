// node --test "src/app/(dashboard)/governance/_metrics/metricModel.test.ts"
// The KPI / KRI report's rules, pinned apart from React: status words, how a value is written (negative, huge, none), the sparkline's numbers and its
// words, when a measurement is due (a day, not a moment: the same answer in every time zone), search and filter, the sort keys, and what the form and a
// measurement send (the payloads are what the report has always sent: a manual measurement is APPROVED at once).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sortRows } from '../../../../components/ui/ds/tableModel.ts';
import {
  FREQUENCIES, LIMITS, RAG_RANK, applyTemplate, blankForm, byCreation, defaultDirection, describeTrend, filterMetrics, formDirty, formFromMetric,
  formatMetricValue, isDue, measureDirty, measurePayload, nameError, pickMetric, ragOf, sortValue, sourceOf, sparkGeometry, toPayload, valueError,
  type Metric, type MetricFormState, type MetricOption, type Point, type Template,
} from './metricModel.ts';

const metric = (over: Partial<Metric> = {}): Metric => ({
  id: 1, name: 'Patched within SLA', kind: 'kpi', current_value: 88, current_status: 'amber', green_threshold: 90, amber_threshold: 75,
  threshold_direction: 'higher_is_better', frequency: 'monthly', is_live: false, target: 95, unit: '%', category: 'Cyber Security', ...over,
});
const pts = (...values: Array<number | null>): Point[] => values.map((value, i) => ({ date: `2026-0${(i % 9) + 1}-01`, value }));

test('a status is one of four words; none, or a word nobody expected, is "unknown" (it used to crash the card)', () => {
  assert.deepEqual(['green', 'amber', 'red', 'unknown'].map(ragOf), ['green', 'amber', 'red', 'unknown']);
  for (const odd of [null, undefined, '', 'purple', 'constructor', 'GREEN']) assert.equal(ragOf(odd as string), 'unknown', String(odd));
  assert.deepEqual(Object.keys(RAG_RANK).sort(), ['amber', 'green', 'red', 'unknown']);
  assert.ok(RAG_RANK.red < RAG_RANK.amber && RAG_RANK.amber < RAG_RANK.green && RAG_RANK.green < RAG_RANK.unknown, 'worst first');
});

test('a value is written with its unit, one decimal at most, the same text for every viewer', () => {
  assert.equal(formatMetricValue(88, '%'), '88%');
  assert.equal(formatMetricValue(88.04, 'pct'), '88%');
  assert.equal(formatMetricValue(88.26, '%'), '88.3%');
  assert.equal(formatMetricValue(21, 'days'), '21d');
  assert.equal(formatMetricValue(68, 'score'), '68');
  assert.equal(formatMetricValue(1234567, 'count'), '1,234,567');
  assert.equal(formatMetricValue(12, null), '12');
  assert.equal(formatMetricValue(12345.678, 'count'), '12,345.7', 'a fraction keeps the separators a whole number has');
});

test('negative, huge, zero and missing values', () => {
  assert.equal(formatMetricValue(-42.5, 'count'), '-42.5');
  assert.equal(formatMetricValue(-0.04, 'count'), '0', '-0 is 0');
  assert.equal(formatMetricValue(-0.04, '%'), '0%');
  assert.equal(formatMetricValue(0, '%'), '0%', '0 is a value');
  assert.equal(formatMetricValue(98765432101, 'count'), '98,765,432,101');
  assert.equal(formatMetricValue(1e21, 'count'), '1,000,000,000,000,000,000,000');
  assert.equal(formatMetricValue(1.7e308, '%'), '1.7e+308%', 'too big to round: left as it is, not "Infinity"');
  for (const none of [null, undefined, NaN, Infinity]) assert.equal(formatMetricValue(none as number, '%'), '—', String(none));
});

test('the sparkline draws the numbers it always drew', () => {
  assert.equal(sparkGeometry(pts(1)), null, 'one measurement draws nothing');
  assert.equal(sparkGeometry(pts(null, 5, null)), null, 'a missing value is not a measurement');
  assert.equal(sparkGeometry([]), null);
  assert.equal(sparkGeometry(undefined), null);
  const s = sparkGeometry(pts(10, 20, 30))!;
  assert.equal(s.line, 'M0.0,31.8 L60.0,18.0 L120.0,4.2');           // 15% room above and below, one step along per measurement
  assert.equal(s.area, 'M0.0,31.8 L60.0,18.0 L120.0,4.2 L120,36 L0,36 Z');
  assert.deepEqual(s.last, { x: 120, y: 36 - ((30 - (10 - 3)) / (30 + 3 - (10 - 3))) * 36 });
  const flat = sparkGeometry(pts(5, 5, 5))!;
  assert.ok(!/NaN|Infinity/.test(flat.line), 'a flat series still draws a line');
  const spaced = sparkGeometry(pts(1, null, 3))!;
  assert.equal(spaced.line.split('L').length, 2, 'the gap is skipped: two points, one segment');
  assert.ok(!/NaN|Infinity/.test(sparkGeometry(pts(5, 98765432101))!.line), 'a huge value scales');
  assert.ok(!/NaN|Infinity/.test(sparkGeometry(pts(-10, -42.5))!.line), 'a negative one too');
});

test('the sparkline in words: how many, from where to where, which way', () => {
  assert.equal(describeTrend(pts(70, 74, 79, 83, 86, 88), '%'), 'Trend over 6 measurements: rising, from 70% to 88%');
  assert.equal(describeTrend(pts(21, 9), 'days'), 'Trend over 2 measurements: falling, from 21d to 9d');
  assert.equal(describeTrend(pts(5, 7, 5), 'count'), 'Trend over 3 measurements: steady, from 5 to 5');
  assert.equal(describeTrend(pts(88.01, 88.04), '%'), 'Trend over 2 measurements: steady, from 88% to 88%', 'a move the text cannot show reads as steady');
  assert.equal(describeTrend(pts(-10, -42.5), 'count'), 'Trend over 2 measurements: falling, from -10 to -42.5');
  assert.equal(describeTrend(pts(1), '%'), 'Not enough measurements for a trend yet');
  assert.equal(describeTrend(undefined), 'Not enough measurements for a trend yet');
});

test('a manual metric is due from the start of its due day, whatever the clock or the zone; a live one never is', () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);       // the viewer's own wall clock
  assert.equal(isDue('2026-10-31T00:00:00', false, at(2026, 10, 30, 23)), false, 'the day before');
  assert.equal(isDue('2026-10-31T00:00:00', false, at(2026, 10, 31, 0)), true, 'the due day itself, from its first minute');
  assert.equal(isDue('2026-10-31T05:00:00', false, at(2026, 10, 31, 1)), true, 'the time of day the server stored does not move the day');
  assert.equal(isDue('2026-10-31T00:00:00', false, at(2026, 11, 20)), true, 'and after');
  assert.equal(isDue('2026-10-31', false, at(2026, 10, 31)), true, 'a plain date works too');
  assert.equal(isDue('2026-10-31T00:00:00', true, at(2026, 11, 20)), false, 'nobody measures a live-fed metric');
  for (const none of [null, undefined, '', 'not a date']) assert.equal(isDue(none, false, at(2026, 11, 20)), false, String(none));
});

test('search looks in the name, category, source and definition; the status filter keeps one rating', () => {
  const list = [
    metric({ id: 1, name: 'Patched within SLA', category: 'Cyber Security', current_status: 'red' }),
    metric({ id: 2, name: 'Policy review completion', category: 'Governance', current_status: 'green', formula: 'reviews done ÷ reviews due' }),
    metric({ id: 3, name: 'Average residual risk', category: 'Risk', is_live: true, module_label: 'Risk', current_status: null }),
  ];
  const names = (rows: Metric[]) => rows.map((m) => m.id);
  assert.deepEqual(names(filterMetrics(list, { q: '', status: 'all' })), [1, 2, 3]);
  assert.deepEqual(names(filterMetrics(list, { q: '  PATCHED ', status: 'all' })), [1], 'case and edge spaces do not matter');
  assert.deepEqual(names(filterMetrics(list, { q: 'governance', status: 'all' })), [2], 'category');
  assert.deepEqual(names(filterMetrics(list, { q: 'reviews due', status: 'all' })), [2], 'definition');
  assert.deepEqual(names(filterMetrics(list, { q: 'live', status: 'all' })), [3], 'source');
  assert.deepEqual(names(filterMetrics(list, { q: 'manual', status: 'all' })), [1, 2]);
  assert.deepEqual(names(filterMetrics(list, { q: '', status: 'red' })), [1]);
  assert.deepEqual(names(filterMetrics(list, { q: '', status: 'unknown' })), [3], 'no status counts as not rated');
  assert.deepEqual(names(filterMetrics(list, { q: 'patched', status: 'green' })), [], 'a filter that hides everything gives none');
  assert.equal(filterMetrics(list, { q: '', status: 'all' }).length, 3);
});

test('the sort keys: worst status first, numbers by value, text in natural order, nothing last, ties in creation order', () => {
  const list = [
    metric({ id: 3, name: 'Item 10', current_status: 'green', current_value: 5, target: null, category: null, next_due_date: '2026-12-15T00:00:00' }),
    metric({ id: 1, name: 'Item 2', current_status: 'red', current_value: -2, target: 40, category: 'Risk', next_due_date: '2026-10-01T05:00:00' }),
    metric({ id: 2, name: 'item 1', current_status: null, current_value: null, target: 7, category: 'Cyber', next_due_date: null }),
  ];
  const order = (key: string, dir: 'asc' | 'desc') => sortRows(list, { key, dir }, sortValue).map((m) => m.id);
  assert.deepEqual(order('name', 'asc'), [2, 1, 3], 'Item 2 before Item 10, case ignored');
  assert.deepEqual(order('status', 'asc'), [1, 3, 2], 'red, green, then not rated');
  assert.deepEqual(order('value', 'asc'), [1, 3, 2], 'the one with no value is last');
  assert.deepEqual(order('value', 'desc'), [3, 1, 2], 'and last when descending too');
  assert.deepEqual(order('target', 'asc'), [2, 1, 3], 'no target last');
  assert.deepEqual(order('category', 'asc'), [2, 1, 3], 'no category last');
  assert.deepEqual(order('due', 'asc'), [1, 3, 2], 'by day; none last');
  assert.equal(sortValue(list[0], 'nothing'), null);
  assert.deepEqual(byCreation(list).map((m) => m.id), [1, 2, 3]);
  assert.deepEqual(list.map((m) => m.id), [3, 1, 2], 'the list it was given is not reordered');
});

test('a new form is blank, with the direction its kind usually wants; an edit form is the metric as it is', () => {
  assert.equal(defaultDirection('kpi'), 'higher_is_better');
  assert.equal(defaultDirection('kri'), 'lower_is_better');
  assert.deepEqual(blankForm('kri'), {
    name: '', description: '', category: '', formula: '', metric_key: '', unit: '', target: '', green_threshold: '', amber_threshold: '',
    threshold_direction: 'lower_is_better', frequency: 'monthly', next_due_date: '',
  });
  const m = metric({ description: 'd', formula: 'a ÷ b', metric_key: null, next_due_date: '2026-10-01T05:00:00', target: 0, green_threshold: 90.5, amber_threshold: -3 });
  assert.deepEqual(formFromMetric(m, 'kpi'), {
    name: 'Patched within SLA', description: 'd', category: 'Cyber Security', formula: 'a ÷ b', metric_key: '', unit: '%', target: '0', green_threshold: '90.5',
    amber_threshold: '-3', threshold_direction: 'higher_is_better', frequency: 'monthly', next_due_date: '2026-10-01',
  });
  const bare = formFromMetric(metric({ target: null, green_threshold: null, amber_threshold: null, category: null, unit: null, threshold_direction: '', frequency: '' }), 'kri');
  assert.equal(bare.target, '');
  assert.equal(bare.threshold_direction, 'lower_is_better');
  assert.equal(bare.frequency, 'monthly');
  assert.equal(sourceOf(null), 'manual');
  assert.equal(sourceOf(metric({ metric_key: 'portfolio_avg_residual' })), 'live');
  assert.equal(sourceOf(metric({ metric_key: '' })), 'manual');
});

test('the drawer is dirty when a field or the value source differs from what it opened with', () => {
  const opened = { form: formFromMetric(metric(), 'kpi'), source: 'manual' as const };
  assert.equal(formDirty(opened, { form: { ...opened.form }, source: 'manual' }), false);
  assert.equal(formDirty(opened, { form: { ...opened.form, name: 'Patched within SLA ' }, source: 'manual' }), true, 'a typed space counts');
  assert.equal(formDirty(opened, { form: { ...opened.form }, source: 'live' }), true);
  const blank = { form: blankForm('kpi'), source: 'manual' as const };
  assert.equal(formDirty(blank, { form: blankForm('kpi'), source: 'manual' }), false);
  for (const key of Object.keys(blank.form) as (keyof MetricFormState)[]) {
    assert.equal(formDirty(blank, { form: { ...blank.form, [key]: 'x' }, source: 'manual' }), true, key);
  }
});

const template: Template = {
  key: 'patch_sla', name: '% Patches applied within SLA', kind: 'kpi', category: 'Cyber Security', unit: '%', threshold_direction: 'higher_is_better',
  target: 95, green_threshold: 95, amber_threshold: 85, frequency: 'quarterly', formula: 'Patches applied within SLA ÷ total patches due',
};
const option = (over: Partial<MetricOption> = {}): MetricOption => ({
  key: 'portfolio_avg_residual', label: 'Avg residual risk', module_label: 'Risk', unit: 'score', direction: 'down_good', definition: '', suggested_target: 40, suggested_warn: 60, ...over,
});

test('a template fills the definition and clears the platform metric; the description and the due day are left as they were', () => {
  const f = applyTemplate({ ...blankForm('kpi'), metric_key: 'x', description: 'keep', next_due_date: '2026-11-01' }, template);
  assert.equal(f.name, '% Patches applied within SLA');
  assert.deepEqual([f.target, f.green_threshold, f.amber_threshold, f.frequency, f.unit, f.category], ['95', '95', '85', 'quarterly', '%', 'Cyber Security']);
  assert.equal(f.metric_key, '');
  assert.equal(f.description, 'keep');
  assert.equal(f.next_due_date, '2026-11-01');
});

test('a platform metric brings its unit, direction and suggested target (also the green threshold) and warning', () => {
  const base = { ...blankForm('kpi'), unit: 'count', target: '1', green_threshold: '2', amber_threshold: '3' };
  const down = pickMetric(base, 'portfolio_avg_residual', option());
  assert.deepEqual([down.metric_key, down.unit, down.threshold_direction, down.target, down.green_threshold, down.amber_threshold], ['portfolio_avg_residual', 'score', 'lower_is_better', '40', '40', '60']);
  assert.equal(pickMetric(base, 'k', option({ direction: 'up_good' })).threshold_direction, 'higher_is_better');
  const nothing = pickMetric(base, 'k', option({ unit: '', suggested_target: null, suggested_warn: null }));
  assert.deepEqual([nothing.unit, nothing.target, nothing.green_threshold, nothing.amber_threshold], ['count', '1', '2', '3'], 'what the option does not suggest stays');
  const cleared = pickMetric(base, '', undefined);
  assert.deepEqual([cleared.metric_key, cleared.unit, cleared.threshold_direction, cleared.target], ['', 'count', 'higher_is_better', '1'], 'choosing "pick a metric" again clears only the key');
});

test('the create / edit payload is what the report has always sent', () => {
  const form: MetricFormState = {
    ...blankForm('kpi'), name: '  Patched  ', category: 'Cyber', unit: '%', target: '95', green_threshold: '90', amber_threshold: '75', next_due_date: '2026-11-12', formula: 'a ÷ b',
  };
  assert.deepEqual(toPayload(form, 'manual', 'kpi'), {
    name: 'Patched', description: null, kind: 'kpi', category: 'Cyber', formula: 'a ÷ b', target: 95, metric_key: null, unit: '%', green_threshold: 90, amber_threshold: 75,
    threshold_direction: 'higher_is_better', frequency: 'monthly', next_due_date: '2026-11-12T00:00:00.000Z',
  });
  const live = toPayload({ ...form, metric_key: 'portfolio_avg_residual', target: '', green_threshold: '0', amber_threshold: '-3.5', next_due_date: '', description: 'd' }, 'live', 'kri');
  assert.equal(live.metric_key, 'portfolio_avg_residual');
  assert.equal(live.target, null, 'no target is null, not 0');
  assert.equal(live.green_threshold, 0, '0 is a value');
  assert.equal(live.amber_threshold, -3.5);
  assert.equal(live.next_due_date, null);
  assert.equal(live.description, 'd');
  assert.equal(live.kind, 'kri');
  assert.equal(toPayload({ ...form, metric_key: 'left over' }, 'manual', 'kpi').metric_key, null, 'a manual metric has no platform key, even one left in the form');
  assert.equal(toPayload({ ...form, metric_key: '' }, 'live', 'kpi').metric_key, null, 'live with nothing picked sends none');
  assert.equal(toPayload({ ...form, target: '1e21' }, 'manual', 'kpi').target, 1e21, 'a huge number goes as it is');
});

test('a name is asked for; the limits are the database columns', () => {
  assert.equal(nameError(blankForm('kpi')), 'Enter a name.');
  assert.equal(nameError({ ...blankForm('kpi'), name: '   ' }), 'Enter a name.');
  assert.equal(nameError({ ...blankForm('kpi'), name: 'x' }), undefined);
  assert.deepEqual(LIMITS, { name: 255, category: 100, unit: 50, period: 40 });
  assert.deepEqual(FREQUENCIES, ['daily', 'weekly', 'monthly', 'quarterly', 'annual']);
});

test('a measurement: a number is asked for, and it is recorded as approved at once (a workflow question, kept as it is)', () => {
  assert.equal(valueError({ value: '', period: '', notes: '' }), 'Enter a number.');
  assert.equal(valueError({ value: '0', period: '', notes: '' }), undefined, '0 is a value');
  assert.equal(valueError({ value: '-42.5', period: '', notes: '' }), undefined);
  assert.equal(valueError({ value: 'abc', period: '', notes: '' }), 'Enter a number.');
  assert.equal(measureDirty({ value: '', period: '', notes: '' }), false);
  for (const typed of [{ value: '1', period: '', notes: '' }, { value: '', period: '2026-Q1', notes: '' }, { value: '', period: '', notes: 'x' }]) assert.equal(measureDirty(typed), true);
  assert.deepEqual(measurePayload({ value: '88.5', period: '2026-Q1', notes: 'ok' }), { value: 88.5, period_label: '2026-Q1', notes: 'ok', review_status: 'approved' });
  assert.deepEqual(measurePayload({ value: '0', period: '', notes: '' }), { value: 0, period_label: undefined, notes: undefined, review_status: 'approved' });
});
