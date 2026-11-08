// node --test "src/app/(dashboard)/governance/regulatory-feeds/_feed/feedModel.test.ts"
// The Regulatory Feed: the tabs and their true counts, what a person may do with an item in each state, the plain text of an item, a source's assignees and the Add feed form's rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES, FEED_TABS, actionsOf, analysisFailed, analysisOf, assigneeKey, assigneeLabel, categoryLabel, descriptionOf, feedFormProblem, firstTab, isFeedTab, parseAssignee, plainText, statusOfTab,
  tabCount, validFeedUrl,
} from './feedModel.ts';

const COUNTS = { new: 7, analyzed: 2, processed: 1, ignored: 30, total: 40 };

test('the tabs: New, Analyzed, Converted, Not relevant, All; the number is the server\'s count, not the page\'s; "All" asks for no status', () => {
  assert.deepEqual(FEED_TABS.map((t) => t.label), ['New', 'Analyzed', 'Converted', 'Not relevant', 'All']);
  assert.deepEqual(FEED_TABS.map((t) => tabCount(COUNTS, t.value)), [7, 2, 1, 30, 40]);
  assert.equal(tabCount(undefined, 'new'), null, 'unknown is not 0');
  assert.equal(statusOfTab('all'), '');
  assert.equal(statusOfTab('processed'), 'processed');
  assert.equal(isFeedTab('ignored'), true);
  assert.equal(isFeedTab('error'), false);
});

test('the first tab is New while there is anything new, else the first with something in it', () => {
  assert.equal(firstTab(COUNTS), 'new');
  assert.equal(firstTab(undefined), 'new');
  assert.equal(firstTab({ ...COUNTS, new: 0 }), 'analyzed');
  assert.equal(firstTab({ new: 0, analyzed: 0, processed: 0, ignored: 3, total: 3 }), 'ignored');
  assert.equal(firstTab({ new: 0, analyzed: 0, processed: 0, ignored: 0, total: 0 }), 'new');
});

test('the plain text of an item drops the feed\'s markup and entities, scripts included', () => {
  assert.equal(plainText('<p>Banks &amp; DFIs must <b>report</b>&nbsp;within 24&#39;h</p><script>alert(1)</script>'), "Banks & DFIs must report within 24'h");
  assert.equal(plainText(null), '');
  assert.equal(descriptionOf({ description: '', content: '<div>The body</div>' }), 'The body', 'the content when the description is empty');
});

test('what a person may do with an item follows its state; a converted one opens its change; one already a change cannot be dismissed', () => {
  assert.deepEqual(actionsOf({ status: 'new', ai_analysis: null, regulatory_change_id: null }), { analyze: 'analyze', convert: false, dismiss: true, restore: false, openChange: false });
  assert.deepEqual(actionsOf({ status: 'analyzed', ai_analysis: { summary: 's' }, regulatory_change_id: null }), { analyze: null, convert: true, dismiss: true, restore: false, openChange: false });
  assert.deepEqual(actionsOf({ status: 'analyzed', ai_analysis: { error: 'could not read' }, regulatory_change_id: null }), { analyze: 'again', convert: true, dismiss: true, restore: false, openChange: false });
  assert.deepEqual(actionsOf({ status: 'processed', ai_analysis: { summary: 's' }, regulatory_change_id: 9 }), { analyze: null, convert: false, dismiss: false, restore: false, openChange: true });
  assert.deepEqual(actionsOf({ status: 'ignored', ai_analysis: null, regulatory_change_id: null }), { analyze: null, convert: false, dismiss: false, restore: true, openChange: false });
  assert.equal(actionsOf({ status: 'analyzed', ai_analysis: { summary: 's' }, regulatory_change_id: 9 }).convert, false, 'already converted');
});

test('an analysis that carries an error is not read as an analysis', () => {
  assert.equal(analysisFailed({ ai_analysis: { error: 'x' } }), true);
  assert.equal(analysisFailed({ ai_analysis: { summary: 's' } }), false);
  assert.equal(analysisFailed({ ai_analysis: null }), false);
  assert.equal(analysisOf({ ai_analysis: { error: 'x' } }), null);
  assert.deepEqual(analysisOf({ ai_analysis: { summary: 's' } }), { summary: 's' });
});

test('assignees: parse "user:5" / "role:2", refuse anything else, label the first two and count the rest', () => {
  assert.deepEqual(parseAssignee('user:5'), { type: 'user', id: 5 });
  assert.deepEqual(parseAssignee('role:2'), { type: 'role', id: 2 });
  assert.equal(parseAssignee('team:2'), null);
  assert.equal(parseAssignee('user:x'), null);
  assert.equal(parseAssignee('user:0'), null);
  assert.equal(assigneeKey({ type: 'role', id: 2 }), 'role:2');
  assert.equal(assigneeLabel({}), 'Unassigned');
  assert.equal(assigneeLabel({ assignees: [{ type: 'user', id: 1, name: 'Ayesha' }, { type: 'role', id: 2, name: 'Compliance' }, { type: 'user', id: 3, name: 'C' }, { type: 'user', id: 4, name: 'D' }] }), 'Ayesha, Compliance +2');
  assert.equal(assigneeLabel({ assignees: [{ type: 'role', id: 2 }] }), 'A role');
});

test('categories keep the words the form always offered; an odd category reads as words', () => {
  assert.deepEqual(CATEGORIES.map((c) => c.value), ['general', 'press_releases', 'regulatory_policy', 'notices', 'monetary_policy', 'enforcement', 'guidance']);
  assert.equal(categoryLabel('press_releases'), 'Press releases');
  assert.equal(categoryLabel('legal_updates'), 'Legal updates');
  assert.equal(categoryLabel(null), '—');
});

test('the Add feed form: a name, an http(s) address with a host, 1 to 168 hours; it says what is missing in words', () => {
  assert.equal(validFeedUrl('https://www.sbp.org.pk/rss.xml'), true);
  assert.equal(validFeedUrl('ftp://x.test/feed'), false);
  assert.equal(validFeedUrl('not a url'), false);
  assert.equal(feedFormProblem({ name: '', source_url: 'https://a.test/rss', poll_interval_hours: 24 }), 'Give the feed a name.');
  assert.match(feedFormProblem({ name: 'SBP', source_url: 'sbp', poll_interval_hours: 24 }), /address/);
  assert.match(feedFormProblem({ name: 'SBP', source_url: 'https://a.test/rss', poll_interval_hours: 0 }), /1 to 168/);
  assert.equal(feedFormProblem({ name: 'SBP', source_url: 'https://a.test/rss', poll_interval_hours: 24 }), '');
});
