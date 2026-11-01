// node --test "src/lib/statuses/bcm.test.ts"
// The words of the Business Continuity module: every word the server accepts has a tone and a label (and nothing else is registered), every word keeps the label
// the module showed before the registry (the old label maps of bcm/_bcm-ui.tsx, written out below as the contract), the colours keep their meaning, and a word nobody
// registered reads neutral with a readable label. The server's own lists are read from backend/grc/modules/bcm/routers/_common.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { priority, statusPill, TONE, type Statuses, type Tone } from '../status.ts';
import {
  dependencyType, drillStatus, drillType, externalBcp, findingStatus, frequency, optionsOf, planStatus, severity, sourceType, strategyStatus, strategyType,
} from './bcm.ts';

const ALL: Statuses[] = [planStatus, drillStatus, severity, strategyStatus, findingStatus, drillType, sourceType, strategyType, dependencyType, externalBcp, frequency];
const FAMILIES = Object.keys(TONE);

// ── the old label maps (bcm/_bcm-ui.tsx at 4722ba67): "every word keeps its current label" ──
const OLD_LABELS: Array<[Statuses, Record<string, string>]> = [
  [planStatus, { draft: 'Draft', under_review: 'Under Review', approved: 'Approved', retired: 'Retired' }],
  [drillStatus, { scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed', under_review: 'Under Review', closed: 'Closed', cancelled: 'Cancelled', overdue: 'Overdue' }],
  [drillType, { tabletop: 'Tabletop', simulation: 'Simulation', full_failover: 'Full Failover', call_tree: 'Call Tree' }],
  [sourceType, { scheduled_test: 'Scheduled Test', incident_triggered: 'Incident-Triggered' }],
  [strategyType, { alternate_site: 'Alternate Site', remote_work: 'Remote Work', manual_workaround: 'Manual Workaround', vendor_failover: 'Vendor Failover', warm_site: 'Warm Site', cold_site: 'Cold Site', hot_site: 'Hot Site' }],
  [strategyStatus, { proposed: 'Proposed', approved: 'Approved', rejected: 'Rejected' }],
  [dependencyType, { system: 'System', vendor: 'Vendor', staff: 'Staff', facility: 'Facility' }],
  [externalBcp, { confirmed: 'BCP Confirmed', requested: 'BCP Requested', not_provided: 'No BCP', na: 'N/A' }],
  [frequency, { annual: 'Annual', semi_annual: 'Semi-Annual', quarterly: 'Quarterly' }],
  [severity, { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }],     // the old badge printed the word with CSS `capitalize`
  // the old IssueStatusBadge: 'Open' for open, else the state with its underscores as spaces and each word capitalised by CSS
  [findingStatus, { open: 'Open', new: 'New', triage: 'Triage', in_progress: 'In Progress', resolution: 'Resolution', closure_review: 'Closure Review', closed: 'Closed', cancelled: 'Cancelled' }],
];

test('every word keeps the label it had, and the select options are in the order the old maps listed them', () => {
  for (const [registry, labels] of OLD_LABELS) {
    assert.deepEqual(registry.words, Object.keys(labels), `${registry.record}: the words, in the old order`);
    for (const [word, label] of Object.entries(labels)) assert.equal(registry.label(word), label, `${registry.record}.${word}`);
    assert.deepEqual(optionsOf(registry), Object.entries(labels).map(([value, label]) => ({ value, label })), registry.record);
  }
});

test('every word has a tone of the platform\'s six families', () => {
  for (const registry of ALL) for (const word of registry.words) assert.ok(FAMILIES.includes(registry.tone(word)), `${registry.record}.${word}`);
});

test('the colours keep their meaning: waiting purple, moving blue, done green, held amber, refused or late red, at rest grey', () => {
  assert.deepEqual(planStatus.words.map((w) => planStatus.tone(w)), ['neutral', 'pending', 'success', 'neutral']);
  assert.deepEqual(drillStatus.words.map((w) => drillStatus.tone(w)), ['pending', 'progress', 'success', 'pending', 'neutral', 'neutral', 'danger']);
  assert.deepEqual(strategyStatus.words.map((w) => strategyStatus.tone(w)), ['pending', 'success', 'danger']);
  assert.deepEqual(findingStatus.words.map((w) => findingStatus.tone(w)), ['warning', 'pending', 'pending', 'progress', 'progress', 'pending', 'success', 'neutral']);
  for (const kind of [drillType, sourceType, strategyType, dependencyType, externalBcp, frequency]) for (const word of kind.words) assert.equal(kind.tone(word), 'neutral', `${kind.record}.${word}: a kind has no meaning to colour`);
});

test('severity and criticality read as the platform\'s priority scale: one scale for the whole product', () => {
  for (const word of severity.words) assert.equal(severity.tone(word), priority.tone(word), word);
  assert.deepEqual(severity.words.map((w) => severity.tone(w)), ['danger', 'warning', 'progress', 'neutral']);
});

test('a pill always has its word; an unknown word is neutral with its own readable label and a missing one is the dash', () => {
  assert.deepEqual(statusPill(planStatus, 'under_review'), { tone: 'pending', label: 'Under Review' });
  assert.deepEqual(statusPill(drillStatus, 'overdue'), { tone: 'danger', label: 'Overdue' });
  assert.deepEqual(statusPill(drillStatus, 'postponed'), { tone: 'neutral', label: 'Postponed' });
  assert.deepEqual(statusPill(findingStatus, 'awaiting_validation'), { tone: 'neutral', label: 'Awaiting validation' });
  assert.deepEqual(statusPill(planStatus, null), { tone: 'neutral', label: '—' });
  assert.equal(severity.tone('constructor'), 'neutral');
});

// ── the server's own lists ──
const COMMON = new URL('../../../../backend/grc/modules/bcm/routers/_common.py', import.meta.url);
const source = existsSync(COMMON) ? readFileSync(COMMON, 'utf8') : null;

/** The words of `NAME = {"a", "b"}` in _common.py. */
function wordsOf(name: string): string[] {
  const hit = new RegExp(`^${name}\\s*=\\s*\\{([^}]*)\\}`, 'm').exec(source ?? '');
  assert.ok(hit, `${name} is not in _common.py any more (did the file change shape?)`);
  return Array.from((hit as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g), (m) => m[1]);
}

const same = (registry: Statuses, listed: string[]) => assert.deepEqual(registry.words.slice().sort(), listed.slice().sort(), registry.record);

test('the registries hold exactly the words the server validates and writes (a word the server starts writing fails here until it has a tone)', (t) => {
  if (!source) { t.skip('the backend is not beside the frontend'); return; }
  same(planStatus, wordsOf('PLAN_STATUSES'));
  same(drillStatus, [...wordsOf('DRILL_STATUSES'), 'overdue']);                       // `overdue` is derived at read time, never stored
  same(drillType, wordsOf('DRILL_TYPES'));
  same(sourceType, wordsOf('SOURCE_TYPES'));
  same(severity, wordsOf('SEVERITIES'));
  same(severity, wordsOf('CRITICALITIES'));
  same(dependencyType, wordsOf('DEPENDENCY_TYPES'));
  same(externalBcp, wordsOf('EXTERNAL_BCP_STATUSES'));
  same(strategyType, wordsOf('STRATEGY_TYPES'));
  same(strategyStatus, wordsOf('STRATEGY_STATUSES'));
  same(frequency, wordsOf('TESTING_FREQUENCIES'));
});

test('a finding\'s remediation words are the issue\'s open states, its two closing states and "open" (no issue yet)', (t) => {
  if (!source) { t.skip('the backend is not beside the frontend'); return; }
  const open = wordsOf('ISSUE_OPEN_STATES');
  for (const word of open) assert.ok(findingStatus.has(word), `the open issue state "${word}" has no word`);
  same(findingStatus, [...open, 'closed', 'cancelled', 'open']);
});

test('the tones are plain family names (no stray tone can slip in as a typo: defineStatuses throws on one)', () => {
  const tones = new Set<Tone>();
  for (const registry of ALL) for (const word of registry.words) tones.add(registry.tone(word));
  for (const tone of tones) assert.ok(FAMILIES.includes(tone));
});
