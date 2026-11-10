// node --test "src/app/(dashboard)/vendor-risk/_lib/questionnaires/hubModel.test.ts"
// The Questionnaires page's tabs and the Library's rules: which tab an address opens (the old Exchange address too), what the Library lists and offers a person, and that the old Library links still mean what they meant.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../../lib/addressState.ts';
import { LIBRARY_SCHEMA, TAB_KEYS, beyond, exchangeForward, libraryHead, tabHref, tabOf, templateActions, visibleTemplates } from './hubModel.ts';
import type { Template } from './types.ts';

const tpl = (over: Partial<Template> = {}): Template => ({
  id: 1, name: 'Security basics', description: 'Access, encryption and backups', category: 'security', questions: [], question_count: 12, section_count: 3, latest_version: 2, used: true, archived_at: null,
  default_tiers: [], updated_by_name: null, created_at: '2026-10-01T00:00:00', updated_at: '2026-10-02T00:00:00', ...over,
});

test('the tabs are Library, Sent and Shared; an address opens one of them, the old Exchange name opens Shared, anything else opens the Library', () => {
  assert.deepEqual(Array.from(TAB_KEYS), ['library', 'sent', 'shared']);
  assert.equal(tabOf(''), 'library');
  assert.equal(tabOf('?tab=sent'), 'sent');
  assert.equal(tabOf('?tab=SHARED'), 'shared');
  assert.equal(tabOf('?tab=exchange'), 'shared');
  assert.equal(tabOf('?tab=constructor'), 'library');
  assert.equal(tabOf('?purpose=tiering'), 'library', 'an old Library link opens the Library');
});

test('a tab picked from the strip starts clean: the Library is the plain address, the others carry only their name', () => {
  assert.equal(tabHref('/vendor-risk/questionnaires', 'library'), '/vendor-risk/questionnaires');
  assert.equal(tabHref('/vendor-risk/questionnaires', 'sent'), '/vendor-risk/questionnaires?tab=sent');
});

test('the old Exchange address goes to the Shared tab and keeps whatever came with it', () => {
  assert.equal(exchangeForward(''), '/vendor-risk/questionnaires?tab=shared');
  assert.equal(exchangeForward('utm=mail&x=1'), '/vendor-risk/questionnaires?utm=mail&x=1&tab=shared');
  assert.equal(exchangeForward('tab=sent'), '/vendor-risk/questionnaires?tab=shared', 'the tab it asks for is the Shared one');
});

test('the old Library links mean what they meant: ?purpose=tiering, ?archived=1, and the new view and search', () => {
  assert.deepEqual(readAddress(LIBRARY_SCHEMA, ''), { purpose: 'due_diligence', view: 'cards', archived: false, q: '' });
  assert.deepEqual(readAddress(LIBRARY_SCHEMA, '?purpose=tiering&archived=1'), { purpose: 'tiering', view: 'cards', archived: true, q: '' });
  assert.deepEqual(readAddress(LIBRARY_SCHEMA, '?view=list&q=vendor%20risk'), { purpose: 'due_diligence', view: 'list', archived: false, q: 'vendor risk' });
  assert.equal(writeAddress(LIBRARY_SCHEMA, '?tab=library', { purpose: 'tiering', view: 'list', archived: true, q: ' soc ' }), 'tab=library&purpose=tiering&view=list&archived=1&q=soc');
});

test('the Library lists by name, category and description, hides archived ones until asked, and says how many are put away', () => {
  const all = [tpl(), tpl({ id: 2, name: 'Privacy review', category: 'privacy', description: null }), tpl({ id: 3, name: 'Old SOC 2 set', archived_at: '2026-09-01T00:00:00', category: 'compliance' })];
  assert.deepEqual(visibleTemplates(all, { q: '', archived: false }).map((t) => t.id), [1, 2]);
  assert.deepEqual(visibleTemplates(all, { q: '', archived: true }).map((t) => t.id), [1, 2, 3]);
  assert.deepEqual(visibleTemplates(all, { q: 'privacy', archived: false }).map((t) => t.id), [2], 'the category');
  assert.deepEqual(visibleTemplates(all, { q: 'encryption backups', archived: false }).map((t) => t.id), [1], 'every word, in the description');
  assert.deepEqual(visibleTemplates(all, { q: 'soc', archived: false }).map((t) => t.id), [], 'an archived one is not found unless asked for');
  assert.equal(libraryHead(all), '2 questionnaires · 1 archived');
  assert.equal(libraryHead([tpl()]), '1 questionnaire');
  assert.equal(beyond(undefined, 5), 0);
  assert.equal(beyond(500, 500), 0);
  assert.equal(beyond(620, 500), 120, 'the list is cut: the page says by how much');
});

test('what a person may do to a questionnaire follows the rights the server checks, and an archived one can only be opened, copied or restored', () => {
  const all = { create: true, edit: true, remove: true, send: true };
  assert.deepEqual(templateActions(tpl({ used: false }), all), ['edit', 'send', 'preview', 'duplicate', 'default_tiers', 'archive', 'delete']);
  assert.deepEqual(templateActions(tpl(), all), ['edit', 'send', 'preview', 'duplicate', 'default_tiers', 'archive'], 'one that was sent can be archived and never deleted');
  assert.deepEqual(templateActions(tpl({ archived_at: '2026-09-01T00:00:00' }), all), ['open', 'preview', 'duplicate', 'restore']);
  assert.deepEqual(templateActions(tpl({ question_count: 0, used: false }), all), ['edit', 'duplicate', 'default_tiers', 'archive', 'delete'], 'nothing to send or preview in an empty one');
  assert.deepEqual(templateActions(tpl(), { create: false, edit: false, remove: false, send: false }), ['open', 'preview'], 'a person with no right sees no button for it');
});
