// node --test "src/app/(dashboard)/governance/documents/studio/_components/studioKit.test.ts"
// What the Comply AI Studio keeps now that it is on the design-system kit (UX revamp, Phase 1, group F3 part B), as source-text pins like studioName.test.ts: a change that
// brings an old pattern back fails here, and says which. The Studio's behaviour (what it sends, what it saves) is pinned by its own tests; these pin the contract of its screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const STUDIO = fileURLToPath(new URL('..', import.meta.url));
const DOCUMENTS = fileURLToPath(new URL('../..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}
const FILES = [...sources(STUDIO), join(DOCUMENTS, '_LinkDialog.tsx')];
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');
const lines = (file: string) => readFileSync(file, 'utf8').split(/\r?\n/).map((text, i) => ({ text, at: `${file.replace(/\\/g, '/').split('/documents/')[1]}:${i + 1}` }));
const code = (l: { text: string }) => l.text.replace(/\s\/\/ .*$/, '').trim();                       // not a comment
const isComment = (l: { text: string }) => /^(\/\/|\*|\/\*|\{\/\*)/.test(code(l));

test('no native confirm, alert or prompt in the Studio, its link dialog or the editor\'s link button', () => {
  const found: string[] = [];
  for (const f of [...FILES, join(DOCUMENTS, '_RichTextEditor.tsx')]) {
    for (const l of lines(f)) if (!isComment(l) && /window\.(confirm|alert|prompt)\b|(^|[^\w.])(alert|prompt)\(/.test(code(l))) found.push(l.at);
  }
  assert.deepEqual(found, []);
});

test('no action is shown only while the pointer is over something (a touch screen and the keyboard never see it)', () => {
  const found: string[] = [];
  for (const f of FILES) for (const l of lines(f)) if (!isComment(l) && /group-(hover|focus-within):(flex|block|inline|inline-flex|opacity-100|visible)\b|opacity-0[^'"`]*group-hover/.test(code(l))) found.push(l.at);
  assert.deepEqual(found, []);
});

test('no text under 12px, and no mint focus ring of its own', () => {
  const small: string[] = [];
  const mint: string[] = [];
  for (const f of FILES) {
    for (const l of lines(f)) {
      if (isComment(l)) continue;
      for (const m of Array.from(code(l).matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g))) if (parseFloat(m[1]) < 12) small.push(l.at);
      if (/ring-\[#1ed4b0\]/.test(code(l))) mint.push(l.at);
    }
  }
  assert.deepEqual(small, []);
  assert.deepEqual(mint, []);
  // the platform's multi-select draws a round 11px count beside "3 selected"; `compact` leaves it out (the button says it already)
  const setup = read('_components/SetupFields.tsx');
  const from = setup.indexOf('<MultiSelectDropdown');
  assert.ok(from >= 0 && /\bcompact\b/.test(setup.slice(from, setup.indexOf('/>', from))), 'the setup\'s multi-select is compact: no 11px count badge');
});

test('every message is the kit\'s (useNotify / useReportedMutation), none the old toast with the server\'s uncleaned text', () => {
  const found = FILES.filter((f) => /ToastProvider|useToast\(/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(/\\/g, '/').split('/documents/')[1]);
  assert.deepEqual(found, []);
});

test('the dialogs that hold typed input or a choice ask "Discard changes?" (dirty) before Escape, X or a press outside throws it away', () => {
  const dialogs = read('_components/dialogs.tsx');
  // Move to library, Save to library, Details (draft) and Save as a template; Export holds no typed input, and the details loading shell holds nothing
  assert.ok((dialogs.match(/\bdirty=\{/g)?.length ?? 0) >= 4, 'Move to library, Save to library, Details (draft), Save as a template');
  const start = read('page.tsx');
  assert.ok(/title="New document"[^>]*dirty=\{touched \|\| suggestedDirty\}/.test(start), 'New document (the Write tab and the suggested documents tab)');
  assert.ok(/title="Upload a document"[^>]*dirty=\{!!chosen\}/.test(start), 'Upload a document');
  assert.ok(/<AnimatedModal[^>]*\bdirty=\{address !== start\}/.test(readFileSync(join(DOCUMENTS, '_LinkDialog.tsx'), 'utf8')), 'the link dialog');          // [^>] spans lines
});

test('the start page: the kit\'s page head named in full, and a list that could not load never reads as empty', () => {
  const start = read('page.tsx');
  assert.ok(start.includes('<PageHeader variant="page" title="Comply AI Studio"'));
  for (const said of ["Couldn't load your work", "Couldn't load the templates", "Couldn't load the library", "Couldn't open the Comply AI Studio"]) assert.ok(start.includes(said), said);
  assert.ok(start.includes('lg:h-[calc(100dvh-5rem)]') && !/\bh-\[calc\(100vh/.test(start), 'the page height follows the visible window (dvh)');
  assert.ok(start.includes('workCount(sessions.length)'), 'the count says 100+ where the server cuts the list');
});

test('the editor: the kit\'s tabs below lg, real tabs for the assistant sections, a menu from the keyboard', () => {
  const page = read('[sessionId]/page.tsx');
  assert.ok(page.includes('<Tabs tabs={PANES}') && page.includes('<TabPanel tabKey="document"') && page.includes('<TabPanel tabKey="assistant"'));
  assert.ok(page.includes('<Menu label="More"'));
  assert.ok(!/role="tab(list)?"/.test(page), 'no hand-written tabs in the page');
  assert.ok(page.includes('h-[calc(100dvh-3rem)]') && !/\bh-\[calc\(100vh/.test(page));
  const side = read('_components/SideTabs.tsx');
  assert.ok(side.includes('role="tablist"') && side.includes('role="tab"') && side.includes('aria-controls={panelId(base, t.key)}') && side.includes('tabIndex={open ? 0 : -1}'));
  assert.ok(page.includes('role="tabpanel" id={panelId(sideBase, key)} aria-labelledby={tabId(sideBase, key)}'));
  assert.ok(!/role="tab(list)?"/.test(read('_components/ReferencesPanel.tsx')), 'the kind of reference is a named choice, not tabs without panels');
});

test('the editor says what could not load instead of looking empty: the conversation, the checks, the revisions, the setup choices', () => {
  assert.ok(read('_components/ChatPanel.tsx').includes("Couldn't load the conversation"));
  assert.ok(read('_components/ChecksPanel.tsx').includes("Couldn't run the checks"));
  assert.ok(read('_components/HistoryPanel.tsx').includes("Couldn't load the revisions"));
  assert.ok(read('_components/SetupFields.tsx').includes("Couldn't load the choices"));
  const dialogs = read('_components/dialogs.tsx');                                                // the frameworks of "Move to library": a line while they load, a message if they do not
  assert.ok(dialogs.includes('Loading the frameworks') && dialogs.includes("Couldn't load the frameworks"));
  assert.ok(/could not be saved\.\$\{saveWhy/.test(read('[sessionId]/page.tsx')), 'a failed autosave says why, in the server\'s (cleaned) words');
});

test('the chat is a named log, its questions are real radio buttons and checkboxes, and a request that was not sent gives the text back', () => {
  const chat = read('_components/ChatPanel.tsx');
  assert.ok(chat.includes('role="log" aria-label="Conversation with Comply Agent"'));
  assert.ok(chat.includes("type={q.kind === 'single' ? 'radio' : 'checkbox'}") && !/role=\{q\.kind === 'single' \? 'radio'/.test(chat));
  assert.ok(chat.includes('if (sent === false)'));
});

test('the link is asked in a dialog in both editors', () => {
  assert.ok(read('_components/StudioEditor.tsx').includes('<LinkDialog'));
  assert.ok(readFileSync(join(DOCUMENTS, '_RichTextEditor.tsx'), 'utf8').includes('<LinkDialog'));
});
