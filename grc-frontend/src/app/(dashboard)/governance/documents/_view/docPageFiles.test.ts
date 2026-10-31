// Run from this folder (node --test reads [id] in a path as a glob): node --test docPageFiles.test.ts
// Source-text pins for the document page on the design-system kit (Gate 4, F3 part A): the rules the page was brought up to,
// held by reading the files, so a later edit cannot quietly bring back a native dialog, a hand-rolled overlay or a hover-only action.
// The classic fallback page (_LegacyDocumentPage.tsx) is not part of this pass and is not read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DOCS = new URL('../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, DOCS), 'utf8');

const STUDIO = readdirSync(new URL('[id]/', DOCS))
  .filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\.ts$/.test(f) && f !== '_LegacyDocumentPage.tsx')
  .map((f) => `[id]/${f}`);
const PAGE_FILES = [...STUDIO, '_RouteView.tsx', '_SignoffControl.tsx'];
const VIEW_FILES = readdirSync(new URL('_view/', DOCS)).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f)).map((f) => `_view/${f}`);
const ALL = [...PAGE_FILES, ...VIEW_FILES];

// Strip comments so a sentence that explains a rule does not trip it.
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const offenders = (pattern: RegExp, files = ALL) => files.filter((f) => pattern.test(code(f)));

test('the page files are found (the pins below would pass on an empty list)', () => {
  assert.ok(STUDIO.includes('[id]/_DocumentStudio.tsx') && STUDIO.includes('[id]/_ChainTab.tsx') && STUDIO.includes('[id]/_DetailsDialog.tsx'), STUDIO.join(', '));
  assert.ok(PAGE_FILES.length >= 14 && VIEW_FILES.length >= 9, `${PAGE_FILES.length} page files, ${VIEW_FILES.length} view files`);
});

test('no browser confirm, alert or prompt: a decision is asked in the page, an outcome is a notice', () => {
  assert.deepEqual(offenders(/(?:window\.)?(?<![\w.$])(?:confirm|alert|prompt)\s*\(|window\.(?:confirm|alert|prompt)\b/), []);
});

test('no hand-rolled full-screen overlay: popups are the kit overlays (focus trap, Escape, focus returns, discard guard)', () => {
  assert.deepEqual(offenders(/fixed\s+inset-0/), []);
});

test('nothing is revealed by hovering alone: every action stays visible and reachable by keyboard', () => {
  assert.deepEqual(offenders(/opacity-0[^"'`\n]*group-hover|group-hover:(?:opacity|visible)|hover:(?:visible|opacity-100)[^"'`\n]*\binvisible\b/), []);
});

test('no text under 12px in a class (the platform CSS also lifts a bare <p>, <td> and <th>, so this pin only covers what is written)', () => {
  assert.deepEqual(offenders(/text-\[(?:[0-9]|10|11)(?:\.\d+)?px\]/, PAGE_FILES), []);
});

test('dates and numbers come from lib/format (through _view/docDates), never from the browser locale', () => {
  assert.deepEqual(offenders(/\.toLocale(?:Date|Time)?String\(|\bIntl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat)\b/), []);
});

test('the counts that can pass a thousand (words, entries, clauses, statements, acknowledgements) are written through formatCount', () => {
  for (const f of ['[id]/_ChainTab.tsx', '[id]/_GapAnalysisView.tsx', '[id]/_StatementsView.tsx', '[id]/_LifecycleTab.tsx']) {
    assert.match(code(f), /import \{ formatCount \} from '@\/lib\/format'/, f);
    assert.ok((code(f).match(/formatCount\(/g) ?? []).length >= 3, f);
  }
  assert.match(code('[id]/_ChainTab.tsx'), /\+\{formatCount\(added\)\}/);          // the words added and removed of a long document
});

test('a read the server answered with its own refusal (403, 404) offers no Retry: asking again cannot change the answer', () => {
  assert.match(code('[id]/_DocumentStudio.tsx'), /onRetryHtml=\{loadFailure\(htmlQ\.error\) === 'failed'/);
});

test('every write goes through useReportedMutation, except the six that need their own handling', () => {
  // Each stays on a plain useMutation for a stated reason; a new plain useMutation fails here until it is added with its reason.
  const ALLOWED: Record<string, number> = {
    '[id]/_DocumentStudio.tsx': 1,     // Edit: opens the Studio and navigates away, its own error toast with Retry
    '[id]/_DocumentViewer.tsx': 1,     // the classic viewer's save of edited content (classic path only)
    '[id]/_GapAnalysisView.tsx': 1,    // "suggest a fix": the answer fills the form, nothing is written
    '[id]/_SubmitDialog.tsx': 1,       // the dialog closes itself and says what the server decided
    '[id]/_TrackedChanges.tsx': 1,     // take a change back: the card shows the outcome inline
    '_SignoffControl.tsx': 1,          // sign / reject / delegate: a signature is never retried automatically
  };
  const plain = /(?<![\w$])useMutation\s*[<(]/g;
  const found: Record<string, number> = {};
  for (const f of PAGE_FILES) {
    const n = (code(f).match(plain) ?? []).length;
    if (n) found[f] = n;
  }
  assert.deepEqual(found, ALLOWED);
});

test('the view strip is the kit Tabs: one tab stop, arrow keys, linked panels (no hand-rolled role="tab" and no local Menu)', () => {
  const studio = code('[id]/_DocumentStudio.tsx');
  assert.match(studio, /<Tabs\b/);
  assert.match(studio, /<TabPanel\b/);
  assert.doesNotMatch(studio, /role=["']tab["']/);
  assert.doesNotMatch(studio, /function\s+Menu\s*\(/);
  assert.match(studio, /<Menu\b/);                                   // Download and More are the kit Menu
});

test('the wide tables sit in the kit TableFrame, and the Change log keeps its width and every column', () => {
  const chain = code('[id]/_ChainTab.tsx');
  assert.match(chain, /<TableFrame\b/);
  assert.match(chain, /min-w-\[1180px\]/);
  assert.match(chain, /sortCycle=/);
  const list = /const COLUMNS[^=]*=\s*\[([\s\S]*?)\];/.exec(chain)?.[1] ?? '';
  assert.deepEqual(Array.from(list.matchAll(/label:\s*'([^']+)'/g)).map((m) => m[1]),
    ['Ref', 'When', 'Who', 'What', 'Source', 'Version', 'Stage', 'Section or details', 'From', 'To', 'Words', 'Request and reason', 'Sources']);
  assert.match(code('[id]/_GapAnalysisView.tsx'), /<TableFrame\b/);
  // a raw <table> may stay only where the table is part of the document itself or a small before/after pair
  const RAW_OK = ['[id]/ControlPages.tsx', '[id]/_ProposalsView.tsx'];
  assert.deepEqual(PAGE_FILES.filter((f) => /<table\b/.test(code(f)) && !RAW_OK.includes(f)), []);
});

test('the deep links into the page are still read (a link that stops working breaks mail and bookmarks)', () => {
  const studio = code('[id]/_DocumentStudio.tsx');
  for (const key of ['act', 'tab', 'changes', 'read', 'details', 'version', 'proposal']) {
    assert.ok(new RegExp(`['"]${key}['"]`).test(studio + code('[id]/_ChainTab.tsx') + code('[id]/_ProposalsView.tsx') + code('[id]/_LifecycleTab.tsx')), key);
  }
});
