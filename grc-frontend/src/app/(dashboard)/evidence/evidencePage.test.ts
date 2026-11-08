// node --test "src/app/(dashboard)/evidence/evidencePage.test.ts"
// Source-text pins for the Evidence Management pages (the shell /evidence with its Library, Insights and Settings, the audit packages, the coverage forward, the upload drawer and the
// details panel): they are on the kit and stay there (no named utilities the shell repaints, no text under 12px, no bare <p>/<td>/<th>/<h2>/<h3>, no native dialogs, no hover-only
// actions, no legacy scope, no browser-locale date), and the behaviours that were contracts are still in the code: the endpoints, the query keys, the rights, the address, the reported
// actions, the shared exports the record page imports. The record page ([id], pinned in its own test: [id]/_record/recordPage.test.ts) is scanned with the rest; _review.tsx (shared with six other modules, legacy chrome, frozen) is not. A source-text test only says what it validates in its title.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bareText, kitViolations, legacyLeftovers, read, tsxFiles } from './_kitScan.ts';

const DIR = 'src/app/(dashboard)/evidence';
const OTHERS = ['_review.tsx'];                              // the AI-review pieces shared with the Auditor Portal, ERM, Frameworks, IS projects and Vendor Risk
const files = tsxFiles(DIR, OTHERS);
const page = read(`${DIR}/page.tsx`);
const explorer = read(`${DIR}/_library/LibraryExplorer.tsx`);
const actions = read(`${DIR}/_library/libraryActions.tsx`);
const data = read(`${DIR}/_library/libraryData.ts`);
const drawer = read(`${DIR}/_library/LibraryDrawer.tsx`);
const rows = read(`${DIR}/_library/LibraryRows.tsx`);
const preview = read(`${DIR}/_workspace/DetailPreview.tsx`);
const api = read(`${DIR}/_workspace/api.ts`);
const upload = read(`${DIR}/_UploadDrawer.tsx`);
const packages = read(`${DIR}/audit-packages/page.tsx`);
const packageActions = read(`${DIR}/audit-packages/packagesActions.tsx`);
const insights = read(`${DIR}/_insights/InsightsView.tsx`);

test('every file of the Evidence pages follows the kit rules: no named utility the shell repaints, no text under 12px, no bare outline', () => {
  assert.ok(files.length >= 24, `the pages' pieces are found (${files.length})`);
  assert.ok(files.some((f) => f.includes('/[id]/_record/')), 'the record page files are scanned');
  assert.ok(!files.some((f) => OTHERS.some((o) => f.includes(`/${o}`))), 'the shared AI-review file is not scanned');
  assert.deepEqual(kitViolations(files), []);
});

test('no bare <p>, <td>, <th>, <h2> or <h3>, no native dialog, no hover-only action, no legacy scope, no browser-locale date', () => {
  assert.deepEqual(bareText(files), []);
  assert.deepEqual(legacyLeftovers(files), []);
});

test('the shell draws the kit head named as the registry names it, with the strip of tabs, owns the upload, and keeps view, filters, sort and the open file in the address', () => {
  assert.match(page, /<PageHeader\s+variant="page"\s+title="Evidence Management"/);
  assert.match(page, /<EvidenceTabs current=\{current\} \/>/);
  assert.match(page, /useAddressState\(LIBRARY_SCHEMA\)/);
  assert.doesNotMatch(page, /ModuleSettingsSwitch/, 'the shared Records | Settings switch is replaced by the Settings tab (the shared component is untouched)');
  assert.match(page, /<ModuleSettingsPanel moduleKey="evidence" \/>/, 'the Settings panel is the shared one, unchanged');
  const address = read(`${DIR}/_library/libraryAddress.ts`);
  for (const name of ['q', 'status', 'evidence_type', 'owner', 'fw', 'fresh', 'maturity', 'quick', 'sort', 'view', 'open', 'section']) assert.match(address, new RegExp(`\\b${name}: (?:oneOf|text|listOf|integer|quick|sortOf|view)\\(`), `?${name}=`);
  assert.match(packages, /<PageHeader\s+variant="page"\s+title="Audit packages"/);
  assert.match(packages, /<EvidenceTabs current="packages" \/>/);
  assert.match(read('src/app/(dashboard)/evidence-requirements/page.tsx'), /<EvidenceTabs current="requirements" \/>/);
});

test('the Library is the facet explorer over ONE complete load, and the Board and the details panel are part of it', () => {
  assert.match(explorer, /<RecordExplorer/);
  assert.match(explorer, /<BoardColumns/);
  assert.match(explorer, /<BulkBar/);
  assert.match(explorer, /<RecordTable/);
  assert.match(explorer, /<LibraryDrawer/);
  assert.match(explorer, /useExplorerKeys\(/);
  assert.match(data, /params: \{ lean: 1, limit: LEAN_LIMIT \}/, 'the complete load, not the newest 1,000');
  assert.doesNotMatch(explorer + data, /limit: 1000/, 'the old cut is gone');
  assert.match(explorer, /Only part of the library is loaded/, 'a load the server could not hold whole says so, with the true total');
  assert.match(explorer, /ErrorState \{\.\.\.failureWords\(libQ\.error\)\}/, 'a failed load is an error with Retry, never an empty library');
});

test('contract: the endpoints the pages always asked for, and a failed read is never an empty answer', () => {
  assert.match(data, /'\/evidence-mgmt\/items\/dashboard\/summary'/);
  assert.match(insights, /'\/evidence-mgmt\/links\/coverage'/);
  for (const url of ['/evidence-mgmt/ai/${id}/latest-assessment', '/evidence-mgmt/ai/${id}/clause-mappings', '/evidence-mgmt/cross-links/${id}/all-links', '/evidence-mgmt/links/${id}/controls',
    '/evidence-mgmt/ocr/${id}/ocr-content', '/evidence-mgmt/ocr/${id}/process-ocr', '/evidence-mgmt/lifecycle/${id}/submit', '/evidence-mgmt/lifecycle/${id}/review', '/evidence-mgmt/ai/${id}/review']) {
    assert.ok(api.includes(url), url);
  }
  assert.match(data, /\/evidence-mgmt\/lifecycle\/\$\{id\}\/renew/);
  assert.match(api, /catch \(e\) \{ if \(notFound\(e\)\) return null; throw e; \}/, 'only a 404 reads as "no assessment"; any other failure is thrown');
  assert.doesNotMatch(api, /catch \{ return (?:null|\[\]); \}/, 'no loader swallows every error into an empty answer');
  assert.match(api, /params: \{ force \}/, 'delete keeps its force flag');
  assert.match(api, /params: \{ force: true \}/, 'the AI review is started with force, as before');
  assert.match(preview, /enabled: enabled && ocrOpen/, 'the extracted text is read when its popup opens, not with every file looked at');
});

test('contract: the query keys other pages and the AI-review hook invalidate are unchanged', () => {
  for (const key of ["'ev-ws-items'", "'ev-ws-summary'", "'evidence-items'", "'evidence-summary'"]) assert.ok(data.includes(key), key);
  for (const key of ["'evidence-detail'", "'evidence-assessment'", "'evidence-clauses'", "'evidence-all-links'", "'evidence-controls'", "'evidence-ocr'"]) assert.ok(preview.includes(key), key);
  assert.match(page, /LIBRARY_REFRESH/);
  assert.match(upload, /\['tenant-users-evidence'\]/);
  assert.match(upload, /\['assets-evidence-link'\]/);
});

test('contract: the rights are the ones the pages always checked (Renew asks for edit, as the record page does); packages need create; none else is added', () => {
  assert.match(page, /hasPermission\('evidence:evidence_library:create'\)/);
  assert.match(explorer, /hasPermission\('evidence:evidence_library:create'\)/);
  assert.match(explorer, /hasPermission\('evidence:evidence_library:edit'\)/);
  assert.match(explorer, /hasPermission\('evidence:evidence_library:delete'\)/);
  assert.match(packages, /hasPermission\('evidence:evidence_library:create'\)/);
  for (const f of files) assert.doesNotMatch(read(f), /hasPermission\('evidence:(?:evidence_upload|audit_packages)/, f);
  assert.match(drawer, /canReview && row\.status === 'pending_review'/);
});

test('every action says what happened after the server answers (useReportedMutation); delete asks first, and again when the server warns; no bare useMutation, no silent failure', () => {
  assert.match(page, /useReportedMutation</);
  assert.match(actions, /useReportedMutation</);
  assert.match(preview, /useReportedMutation</);
  assert.match(packageActions, /useReportedMutation</);
  for (const f of files) assert.doesNotMatch(read(f), /\buseMutation\(/, f);
  assert.match(actions, /title: 'Delete this evidence\?'/);
  assert.match(actions, /title: 'Delete it anyway\?'/);
  assert.match(actions, /deleteEvidence\(id, force\)/);
  assert.match(actions, /title: 'Renew this evidence\?'/);
  assert.match(page, /toast: 'success'/, 'an upload failure is said inside the drawer, once');
  assert.match(page, /linkFailures/, 'assets that could not be linked are said, not swallowed');
  assert.match(actions, /deleteEvidence\(id, false\)/, 'a bulk delete never forces: a file linked to controls is left in place and said');
});

test('the details panel keeps the review behaviour: the shared hook starts a review once per visit, a failed or stopped review can be tried again, and counts that failed are a dash', () => {
  assert.match(preview, /useEvidenceReview\(evidenceId, \{ start: true \}\)/);
  assert.match(preview, /canTryAgain/);
  assert.match(preview, /onReassess\(evidenceId\)/);
  assert.match(preview, /failed=\{!controlsOk\}/);
  assert.match(preview, /<ErrorState compact title="Couldn't load this evidence"/);
  assert.match(drawer, /<DetailPreview evidenceId=\{row\.id\}/);
  assert.match(rows, /StatusPill size="sm" \{\.\.\.statusPill\(evidenceStatus, 'lapsed'\)\}/, 'a file can be Approved and Lapsed: both words are on the row');
});

test('the audit packages: every step asks or says in words (no native dialog), Download is a signed-in request for the zip, and a file moves by a swap of two numbers', () => {
  assert.match(packageActions, /\/download`, \{ responseType: 'blob' \}/);
  assert.match(packageActions, /onSuccess: \(_, p\) => \{ setExporting\(null\); download\.mutate\(p\); \}/, 'export downloads the zip it built');
  for (const title of ['Delete “', 'Finalize “', 'Put “', 'Remove this file from the package?']) assert.ok(packageActions.includes(title), title);
  assert.match(packageActions, /for \(const step of plan\) await apiClient\.put/);
  assert.match(packages, /<PackageRecord/);
  assert.doesNotMatch(packages + packageActions, /window\.(?:confirm|alert|prompt)\(/);
});

test('the coverage page forwards to the Insights tab (no client code, nothing to render), and the Insights card says what covered means', () => {
  const forward = read(`${DIR}/coverage/page.tsx`);
  assert.match(forward, /redirect\('\/evidence\?view=insights'\)/);
  assert.doesNotMatch(forward, /'use client'/);
  assert.match(insights, /A control counts as covered when any evidence is linked to it, whatever its status/);
  assert.match(insights, /approved evidence that is still in date/);
});

test('the upload drawer: a real file input behind a visible button, a dropped file checked like a chosen one, the form kept on failure, Discard guard on typed input', () => {
  assert.match(upload, /type="file" accept=\{ACCEPT\}/);
  assert.match(upload, /fileProblem\(picked\.name\)/);
  assert.match(upload, /dirty=\{dirty\}/);
  assert.match(upload, /maxLength=\{NAME_MAX\}/);
  assert.match(upload, /uploadFields\(/);
  assert.match(upload, /title="The file was not uploaded"/);
});

test('shared exports stay: the record page imports normPct from the workspace lib and the two dialogs by their props', () => {
  assert.match(read(`${DIR}/_workspace/lib.tsx`), /export \{ normPct \} from '\.\/evidenceModel'/);
  const dialogs = read(`${DIR}/_QualityBreakdownModal.tsx`) + read(`${DIR}/_OcrContentModal.tsx`);
  for (const prop of ['isOpen', 'onClose', 'qualityScore', 'assessment', 'ocrStatus', 'isAssessing', 'ocrContent', 'ocrProcessedAt', 'processMessage', 'onReprocess', 'isReprocessing']) assert.ok(dialogs.includes(prop), prop);
});
