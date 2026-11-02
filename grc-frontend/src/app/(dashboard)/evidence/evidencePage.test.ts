// node --test "src/app/(dashboard)/evidence/evidencePage.test.ts"
// Source-text pins for the Evidence workspace (the pages /evidence and its _workspace folder, the upload drawer and the three dialogs): it is on the kit and stays there
// (no named utilities the shell repaints, no text under 12px, no bare <p>/<td>/<th>/<h2>/<h3>, no native dialogs, no hover-only actions, no legacy scope, no browser-locale
// date), and the behaviours that were contracts are still in the code: the endpoints, the query keys other pages invalidate, the rights, the address, the reported
// actions, the shared exports the item page imports. The item page, the audit packages, the coverage page and _review.tsx are not this group's and are not scanned.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bareText, kitViolations, legacyLeftovers, read, tsxFiles } from './_kitScan.ts';

const DIR = 'src/app/(dashboard)/evidence';
const OTHERS = ['[id]', 'audit-packages', 'coverage', '_review.tsx'];             // the next builders' pages, and the AI-review pieces shared with the Auditor Portal and ERM
const files = tsxFiles(DIR, OTHERS);
const page = read(`${DIR}/page.tsx`);
const workspace = read(`${DIR}/_workspace/EvidenceWorkspace.tsx`);
const api = read(`${DIR}/_workspace/api.ts`);
const preview = read(`${DIR}/_workspace/DetailPreview.tsx`);
const drawer = read(`${DIR}/_UploadDrawer.tsx`);

test('every file of the Evidence workspace follows the kit rules: no named utility the shell repaints, no text under 12px, no bare outline', () => {
  assert.ok(files.length >= 14, `the workspace's pieces are found (${files.length})`);
  assert.ok(!files.some((f) => OTHERS.some((o) => f.includes(`/${o}`))), 'none of the next builders\' files is scanned');
  assert.deepEqual(kitViolations(files), []);
});

test('no bare <p>, <td>, <th>, <h2> or <h3>, no native dialog, no hover-only action, no legacy scope, no browser-locale date', () => {
  assert.deepEqual(bareText(files), []);
  assert.deepEqual(legacyLeftovers(files), []);
});

test('the shell draws the kit head named as the registry names it, owns the upload, and keeps section, view, filters and the open file in the address', () => {
  assert.match(page, /<PageHeader\s+variant="page"\s+title="Evidence Management"/);
  assert.match(page, /useAddressState\(SCHEMA\)/);
  assert.doesNotMatch(page, /ModuleSettingsSwitch/, 'the shared Records | Settings switch is replaced here by the kit\'s (the shared component is untouched)');
  assert.match(page, /<ModuleSettingsPanel moduleKey="evidence" \/>/, 'the Settings panel is the shared one, unchanged');
  assert.match(workspace, /OFFERED_VIEWS/);
  for (const name of ['view', 'section', 'q', 'status', 'evidence_type', 'open', 'page']) assert.match(read(`${DIR}/_workspace/workspaceAddress.ts`), new RegExp(`\\b${name}: (?:oneOf|text|listOf|integer)\\(`), `?${name}=`);
});

test('contract: the endpoints and the page size the workspace always asked for, and a failed read is never an empty answer', () => {
  for (const url of ['/evidence-mgmt/items/dashboard/summary', "'/evidence-mgmt/items'", '/evidence-mgmt/items/types', '/evidence-mgmt/lifecycle/expiring-soon', '/evidence-mgmt/items/dashboard/by-owner',
    '/evidence-mgmt/ai/${id}/latest-assessment', '/evidence-mgmt/ai/${id}/clause-mappings', '/evidence-mgmt/cross-links/${id}/all-links', '/evidence-mgmt/links/${id}/controls',
    '/evidence-mgmt/ocr/${id}/ocr-content', '/evidence-mgmt/ocr/${id}/process-ocr', '/evidence-mgmt/lifecycle/${id}/submit', '/evidence-mgmt/lifecycle/${id}/review', '/evidence-mgmt/ai/${id}/review']) {
    assert.ok(api.includes(url), url);
  }
  assert.match(workspace, /fetchItems\(\{ limit: 1000 \}\)/);
  assert.match(api, /catch \(e\) \{ if \(notFound\(e\)\) return null; throw e; \}/, 'only a 404 reads as "no assessment"; any other failure is thrown');
  assert.doesNotMatch(api, /catch \{ return (?:null|\[\]); \}/, 'no loader swallows every error into an empty answer');
  assert.match(api, /params: \{ force \}/, 'delete keeps its force flag');
  assert.match(api, /params: \{ force: true \}/, 'the AI review is started with force, as before');
});

test('contract: the query keys other pages and the AI-review hook invalidate are unchanged', () => {
  for (const key of ["'ev-ws-summary'", "'ev-ws-items'", "'ev-ws-expiring'"]) assert.ok(workspace.includes(key), key);
  for (const key of ["'evidence-detail'", "'evidence-assessment'", "'evidence-clauses'", "'evidence-all-links'", "'evidence-controls'", "'evidence-ocr'"]) assert.ok(preview.includes(key), key);
  for (const key of ["'evidence-items'", "'evidence-summary'", "'ev-ws-items'", "'ev-ws-summary'", "'ev-ws-expiring'"]) assert.ok(page.includes(key), key);
  assert.match(drawer, /\['tenant-users-evidence'\]/);
  assert.match(drawer, /\['assets-evidence-link'\]/);
});

test('contract: the rights are the ones the page always checked, and none is added', () => {
  assert.match(page, /hasPermission\('evidence:evidence_library:create'\)/);
  assert.match(page, /hasPermission\('evidence:evidence_library:delete'\)/);
  for (const f of files) assert.doesNotMatch(read(f), /hasPermission\('evidence:evidence_library:(?:view|edit)'\)|hasPermission\('evidence:evidence_upload/, f);
});

test('every action says what happened after the server answers (useReportedMutation); delete asks first, and again when the server warns; no bare useMutation, no silent failure', () => {
  assert.match(page, /useReportedMutation</);
  assert.match(workspace, /useReportedMutation</);
  assert.match(preview, /useReportedMutation</);
  for (const f of files) assert.doesNotMatch(read(f), /\buseMutation\(/, f);
  assert.match(workspace, /title: 'Delete this evidence\?'/);
  assert.match(workspace, /title: 'Delete it anyway\?'/);
  assert.match(workspace, /deleteEvidence\(id, force\)/);
  assert.match(page, /toast: 'success'/, 'an upload failure is said inside the drawer, once');
  assert.match(page, /linkFailures/, 'assets that could not be linked are said, not swallowed');
});

test('the preview keeps its review behaviour: the shared hook starts a review once per visit, a failed or stopped review can be tried again, and counts that failed are a dash', () => {
  assert.match(preview, /useEvidenceReview\(evidenceId, \{ start: true \}\)/);
  assert.match(preview, /canTryAgain/);
  assert.match(preview, /onReassess\(evidenceId\)/);
  assert.match(preview, /failed=\{!controlsOk\}/);
  assert.match(preview, /<ErrorState compact title="Couldn't load this evidence"/);
});

test('the upload drawer: a real file input behind a visible button, a dropped file checked like a chosen one, the form kept on failure, Discard guard on typed input', () => {
  assert.match(drawer, /type="file" accept=\{ACCEPT\}/);
  assert.match(drawer, /fileProblem\(picked\.name\)/);
  assert.match(drawer, /dirty=\{dirty\}/);
  assert.match(drawer, /maxLength=\{NAME_MAX\}/);
  assert.match(drawer, /uploadFields\(/);
  assert.match(drawer, /title="The file was not uploaded"/);
});

test('shared exports stay: the item page imports normPct from the workspace lib and the two dialogs by their props', () => {
  assert.match(read(`${DIR}/_workspace/lib.tsx`), /export \{ normPct \} from '\.\/evidenceModel'/);
  const dialogs = read(`${DIR}/_QualityBreakdownModal.tsx`) + read(`${DIR}/_OcrContentModal.tsx`);
  for (const prop of ['isOpen', 'onClose', 'qualityScore', 'assessment', 'ocrStatus', 'isAssessing', 'ocrContent', 'ocrProcessedAt', 'processMessage', 'onReprocess', 'isReprocessing']) assert.ok(dialogs.includes(prop), prop);
});
