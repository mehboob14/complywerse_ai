// node --test "src/app/(dashboard)/governance/settings/settingsPage.test.ts"
// What Governance > Settings promises and a screenshot cannot hold for long: the cache entry it shares with the document page's summary card, the anchors
// other pages link to, the unload guard, "saved" said only by the kit after the server has answered, and that nothing of the legacy page came back.
// (The rules the page applies are in lib/governanceSettings.ts and tested there; the Departments card's own pins are in lib/departments.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('./page.tsx');
const section = read('./_DepartmentsSection.tsx');
const editor = read('../../../../components/admin/DepartmentsEditor.tsx');          // the departments are edited in Administration: the tree editor lives there now

test('the settings live under the key and the address the document page\'s summary card reads, and a save updates that cache entry', () => {
  const card = read('../documents/[id]/_LifecycleTab.tsx');
  for (const text of [page, card]) {
    assert.match(text, /\['document-lifecycle-settings'\]/);
    assert.match(text, /\/governance\/documents\/lifecycle\/settings/);
  }
  assert.match(page, /queryClient\.setQueryData\(SETTINGS_KEY, answer\)/);                 // the answer of the save is the new cache entry: no refetch, no flash
  assert.match(page, /apiClient\.put\(SETTINGS_URL, patch\)/);                              // and what is sent is only what changed (changes())
});

test('who edits, who reads and who sees "No access" is still decided by the server\'s answer', () => {
  assert.match(page, /const canEdit = !!data\?\.can_edit/);
  assert.match(page, /noAccess\(error\)/);
  assert.match(page, /retry: retrySettings/);
  assert.match(page, /<SaveBar[^>]*canEdit=\{canEdit\}/);                                   // a view-only person never gets the bar
  assert.match(page, /readOnly=\{ro\}/);
});

test('every card keeps its anchor, and the days in the task table still link to Due dates', () => {
  for (const id of ['due', 'approvals', 'reminders', 'escalation', 'notifications', 'tasks']) assert.match(page, new RegExp(`<SectionCard id="${id}"`), id);
  assert.match(section, /id="departments"/);
  assert.match(page, /href="#due"/);
});

test('leaving with unsaved changes asks, and the confirmation is the kit\'s: said after the server answered, never for a refusal', () => {
  assert.match(page, /addEventListener\('beforeunload'/);
  assert.match(page, /useReportedMutation\(/);
  assert.match(page, /success: \{ title: 'Settings saved', message: 'New requests, reminders and escalations use them from now on\.' \}/);   // a headline and a line, as it always read
  assert.doesNotMatch(page, /useMutation\(/);
  assert.doesNotMatch(page, /\btoast\(/);                                                  // no hand-made toast: useReportedMutation and useNotify say it
  assert.match(page, /onError: \(e\) => setServerError\(errorMessage\(e, /);                // the bar carries the refusal, cleaned
});

test('the page is on the design-system kit: no legacy head, button strings, hex colours or bare form controls', () => {
  for (const [name, text] of [['page', page], ['section', section], ['editor', editor]] as const) {
    assert.doesNotMatch(text, /DocPageHeader|docUi|PageLoader|governance-light/, name);
    assert.doesNotMatch(text, /#[0-9a-fA-F]{6}\b/, `${name}: colours come from the --ds tokens`);
    assert.doesNotMatch(text, /<(button|select|textarea|input)\b/, `${name}: the kit's Button, Select, Textarea, TextInput, Checkbox and SegmentedControl`);
  }
  assert.match(page, /<PageHeader\s+variant="page"/);
  assert.match(editor, /<RegisterTable<Row>/);
});

test('a number of days is the kit\'s TextInput with its unit inside the box, not a box with a word of its own beside it', () => {
  assert.match(page, /<TextInput type="number"[^>]*\bunit=\{unit\}/);
  assert.doesNotMatch(page, /\{unit\}<\/span>/);
  assert.equal((page.match(/<DaysField /g) ?? []).length, 7);                              // the seven numbers of days on the page
});
