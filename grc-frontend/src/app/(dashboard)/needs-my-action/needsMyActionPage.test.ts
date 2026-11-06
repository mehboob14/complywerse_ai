// node --test "src/app/(dashboard)/needs-my-action/needsMyActionPage.test.ts"
// Source-text pins for Needs my action (the page, its section, its row, its dialog and lib/inbox): the page stays on the kit (no native dialogs, no hover-only actions, no text under 12px, no
// platform-remapped utilities, no bare <p>/<td>/<th>/<h2>/<h3>), every write goes through useReportedMutation and ONLY to the endpoints the document page and the assessment approvals page already
// write to (no new transition), the requests carry the timeouts and the legacy keys of the contract, and the page keeps the behaviours the brief names. A pin that must change says in its title what
// contract it now holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findViolations } from '../../../components/ui/ds/kitRules.ts';

const PAGE = 'src/app/(dashboard)/needs-my-action';
const LIB = 'src/lib/inbox';
const sourcesOf = (dir: string) => (readdirSync(dir) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => ({ file: `${dir}/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
const ALL = [...sourcesOf(PAGE), ...sourcesOf(LIB)];
const TSX = ALL.filter((s) => s.file.endsWith('.tsx'));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const read = (file: string) => code(readFileSync(file, 'utf8'));

test('the folders are what the pins read: the page, its section, row and dialog, and the model, view, decision, source-state and request files', () => {
  assert.deepEqual(TSX.map((s) => s.file.split('/').pop()).sort(), ['_DecisionDialog.tsx', '_InboxRow.tsx', '_Section.tsx', 'page.tsx']);
  assert.deepEqual(ALL.filter((s) => s.file.startsWith(LIB)).map((s) => s.file.split('/').pop()).sort(), ['buildInbox.ts', 'decisionModel.ts', 'inboxApi.ts', 'inboxView.ts', 'sourceState.ts']);
});

test('no native dialog: the browser\'s confirm, alert and prompt are never used', () => {
  for (const { file, text } of ALL) {
    const src = code(text);
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\s*\(/, file);
    assert.doesNotMatch(src, /(^|[^\w.$])(alert|prompt|confirm)\s*\(/m, `${file}: a bare alert(, prompt( or confirm(`);
  }
});

test('no action that appears only on hover, no text under 12px, no platform-remapped utility, no legacy governance scope', () => {
  for (const { file, text } of TSX) {
    const src = code(text);
    assert.doesNotMatch(src, /opacity-0[^'"`\n]*group-hover|group-hover[^'"`\n]*opacity-0/, `${file}: hover-only`);
    assert.doesNotMatch(src, /governance-light/, `${file}: the legacy scope`);
    const found = findViolations(text);
    assert.deepEqual(found, [], `${file}: ${found.map((v) => `${v.rule}@${v.line}`).join(', ')}`);
  }
});

test('no bare <p>, <td>, <th>, <h2> or <h3>: each names its text size (the platform CSS gives a bare one 11.5px)', () => {
  const SIZE = /(?<![\w:-])!?text-(?:ds-(?:title|section|body|label)|\[\d)/;
  for (const { file, text } of TSX) {
    const src = code(text);
    const tag = /<(p|td|th|h2|h3)(\s[^>]*?)?>/g;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(src)) !== null) {
      const open = src.slice(m.index, m.index + 400).split('>')[0] + '>';
      assert.match(open, SIZE, `${file}:${src.slice(0, m.index).split('\n').length} <${m[1]}> has no text size: ${open.slice(0, 90)}`);
    }
  }
});

test('the page draws the kit\'s page head and keeps the contract\'s states: skeleton, per-source error with Retry, empty, content', () => {
  const page = read(`${PAGE}/page.tsx`);
  assert.match(page, /<PageHeader[\s\S]{0,40}variant="page"/);
  for (const state of ["state === 'loading'", "state === 'unavailable'", "state === 'empty'", "state === 'content'"]) assert.ok(page.includes(state), state);
  assert.match(page, /<ErrorState[\s\S]{0,200}onRetry=/, 'a page whose every source failed says so, with Retry');
  assert.match(page, /title="Nothing needs you"/);
  const section = read(`${PAGE}/_Section.tsx`);
  assert.match(section, /could not be loaded/);
  assert.match(section, /could not be refreshed/);
  assert.match(section, /onClick=\{\(\) => onRetry\(n\.source\)\}/, 'each notice retries its own source');
});

test('a section is a button with aria-expanded and shows the true count, 50 rows at a time, "Show N more"', () => {
  const section = read(`${PAGE}/_Section.tsx`);
  assert.match(section, /aria-expanded=\{open\}/);
  assert.match(section, /aria-controls=\{regionId\}/);
  assert.match(section, /pageOf\(items, shown\)/);
  assert.match(section, /formatCount\(count\)/);
  assert.match(section, /page\.summary/);
  assert.match(section, /You can also decide/);
});

test('a row is one control: a button that opens the dialog for the kinds one endpoint decides, a link for the rest; Space works on the link too', () => {
  const row = read(`${PAGE}/_InboxRow.tsx`);
  assert.match(row, /KIND_META\[item\.kind\]\.inDialog/);
  assert.match(row, /aria-haspopup="dialog"/);
  assert.match(row, /e\.key === ' '/);
  assert.match(row, /title=\{item\.title\}/, 'the whole title is the tooltip of the two-line cut');
  assert.match(row, /line-clamp-2/);
  assert.doesNotMatch(row, /<a [^>]*>[\s\S]*<button/, 'no button inside a link');
});

test('the dialog writes ONLY to the endpoints the document page and the assessment approvals page write to: sign, reject, request changes, and the evidence approval', () => {
  const dialog = read(`${PAGE}/_DecisionDialog.tsx`);
  const calls = Array.from(dialog.matchAll(/(governanceApi|apiClient)\.(\w+)\(/g)).map((m) => `${m[1]}.${m[2]}`).sort();
  assert.deepEqual(Array.from(new Set(calls)), ['apiClient.post', 'governanceApi.rejectDocumentSignoff', 'governanceApi.requestSignoffChanges', 'governanceApi.signDocumentOff']);
  assert.match(dialog, /apiClient\.post\(`\/compliance\/assessments\/evidence\/\$\{item\.recordId\}\/approval`, evidenceRequest\(c\.id, comment\)\)/);
  for (const forbidden of ['delegateSignoff', 'resubmitSignoff', 'withdrawSignoff', 'proposalsApi', 'updateGovernanceAction']) assert.ok(!dialog.includes(forbidden), `${forbidden}: not a decision of this dialog`);
  assert.equal((dialog.match(/useReportedMutation\(/g) ?? []).length, 2, 'both forms report through useReportedMutation');
  assert.doesNotMatch(dialog, /\buseMutation\s*[(<]/, 'no bare useMutation');
});

test('a failed decision is said inside the dialog (the toast is for the success), in the server\'s words, with Try again; the form is kept and cannot be sent twice', () => {
  const dialog = read(`${PAGE}/_DecisionDialog.tsx`);
  assert.equal((dialog.match(/toast: 'success'/g) ?? []).length, 2);
  assert.equal((dialog.match(/onError: \(error\) => \{ const f = failureOf\(error\); setFailure\(f\); if \(f\.kind === 'stale' \|\| f\.kind === 'changed'\) onStale\(item\); \},/g) ?? []).length, 2, 'both forms say the failure in the dialog and ask the lists again when the item is no longer theirs');
  assert.match(dialog, /Try again/);
  assert.match(dialog, /setFinished\(true\)/);
  assert.match(dialog, /This is no longer waiting for you/);
  assert.match(dialog, /dirty=\{dirty\}/, 'Escape and the close button ask before a drawn signature or a typed reason is thrown away');
  assert.match(dialog, /signRoleOf\(data\)/, 'the signing choices come from the step the server says is the person\'s now');
});

test('the requests: the legacy keys, a 20 second timeout, one retry a second later, staleness of 60 s, polled at 60/120/60 s, the sent list asked only on the page', () => {
  const api = read(`${LIB}/inboxApi.ts`);
  for (const key of ["['my-document-requests']", "['my-signoff-pending']", "['header-pending-approvals']", "['my-document-requests-sent']"]) assert.ok(api.includes(`key: ${key}`), key);
  assert.match(api, /TIMEOUT_MS = 20_000/);
  assert.match(api, /timeout: TIMEOUT_MS/);
  assert.match(api, /signal/);
  assert.match(api, /retryDelay: 1000/);
  assert.match(api, /count < 1/);
  assert.match(api, /STALE_MS = 60_000/);
  assert.match(api, /refetchOnWindowFocus: true/);
  assert.match(api, /'doc\.lifecycle': \{[^}]*pollMs: 60_000/);
  assert.match(api, /'doc\.signoff': \{[^}]*pollMs: 120_000/);
  assert.match(api, /'assessment\.evidence': \{[^}]*pollMs: 60_000/);
  assert.match(api, /'doc\.sent': \{[^}]*pollMs: false[^}]*missingMeansOff: true/);
  assert.match(api, /includeSent \? \[\.\.\.BADGE_SOURCES, 'doc\.sent'\] : BADGE_SOURCES/, 'the top bar never asks for the sent list');
  assert.match(api, /path: '\/governance\/documents\/lifecycle\/mine'/);
  assert.match(api, /path: '\/governance\/documents\/signoff\/my-pending'/);
  assert.match(api, /path: '\/compliance\/assessments\/pending-approvals'/);
  assert.match(api, /path: '\/governance\/documents\/lifecycle\/sent'/);
});

// The Pending approvals dropdown of the top bar became the Work and context panel (components/shell, S2-SH): the shell asks the inbox ONCE (ShellProvider), and the rail, the top bar's
// button and the panel read that answer. The pins moved with the code.
test('the shell uses the same hook and the same model: the number on the rail and on the panel button is the page\'s To decide count, and the panel opens the page', () => {
  const provider = read('src/components/shell/ShellProvider.tsx');
  const panel = read('src/components/shell/WorkPanel.tsx');
  const header = read('src/components/layout/Header.tsx');
  assert.match(provider, /useInbox\(\{ enabled: access\.signedIn \}\)/);
  assert.match(provider, /badgeText\(inboxState\.inbox\.badge\)/);
  assert.match(provider, /badgeLabel\(inboxState\.inbox\)/);
  assert.match(panel, /dropdownOf\(queue\.inbox, 6\)/);
  assert.match(panel, /href="\/needs-my-action"/);
  assert.match(panel, /href="\/needs-my-action\?section=ack"/);
  assert.match(header, /queue\.text/);
  for (const [name, source] of [['Header', header], ['WorkPanel', panel], ['ShellProvider', provider]]) {
    assert.doesNotMatch(source, /\/governance\/approvals/, name);
    assert.doesNotMatch(source, /queryKey: \['header-pending-approvals'\]|queryKey: \['my-document-requests'\]/, `${name}: the two private queries are gone: one hook asks`);
  }
});

test('a decision refreshes the lists it came from and the document it was about, so the row is gone and the number has dropped when the dialog closes', () => {
  const page = read(`${PAGE}/page.tsx`);
  assert.match(page, /keysAfterDecision\(item\.documentId\)/);
  assert.match(page, /await Promise\.all\(/);
  assert.match(page, /setDeciding\(null\)/);
  assert.match(page, /data-inbox-row/, 'focus moves to the neighbouring row, not to the top of the page');
});

test('?section= opens and brings a section into view', () => {
  const page = read(`${PAGE}/page.tsx`);
  assert.match(page, /sectionParam\(search\?\.get\('section'\)\)/);
  assert.match(page, /scrollIntoView/);
});
