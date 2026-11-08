// node "src/app/(dashboard)/evidence/[id]/_record/recordPage.test.ts"   (a bracketed folder name is a glob for `node --test <path>`; `npm test` and a direct run both work)
// Source-text pins for the evidence record page (/evidence/[id]): it is on the kit, it opens with five requests and leaves the rest to the tab, dialog or sheet that needs it, every write
// reports, the rights are the ones the old page asked, and what the old page did is still in the code (the endpoints, the query keys other pages refresh, the dialogs' props, the
// hook call). Whether it LOOKS right is checked in a browser; these only say what each rule validates in its title.
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bareText, kitViolations, legacyLeftovers, read, tsxFiles } from '../../_kitScan.ts';

const DIR = 'src/app/(dashboard)/evidence/[id]';
const files = tsxFiles(DIR);
const page = read(`${DIR}/page.tsx`);
const data = read(`${DIR}/_record/recordData.ts`);
const actions = read(`${DIR}/_record/recordActions.tsx`);
const sheet = read(`${DIR}/_record/LinkSheet.tsx`);
const edit = read(`${DIR}/_record/EditSheet.tsx`);
const all = files.map(read).join('\n');

test('the record folder follows the kit rules: no named utility the shell repaints, no text under 12px, no bare <p>/<h2>/<h3>, no native dialog, no hover-only action, no browser-locale date', () => {
  assert.ok(files.length >= 14, `the pieces are found (${files.length})`);
  assert.deepEqual(kitViolations(files), []);
  assert.deepEqual(bareText(files), []);
  assert.deepEqual(legacyLeftovers(files), []);
  assert.doesNotMatch(all, /fixed inset-0|window\.history\.back|slate-\d|primary-\d{3}/, 'no hand-rolled overlay and no palette class');
});

test('the old page\'s dead code and legacy pieces are gone', () => {
  for (const gone of ['_LinksCoverage.tsx', '_EvidenceTimeline.tsx', '_ReviewerActionPanel.tsx', '_RelationshipsPanel.tsx', '_EvidenceCrossMap.tsx', '_AuditReadinessCard.tsx', '_CommonControlDialog.tsx', '_linkedGroups.ts']) {
    assert.equal(existsSync(`${DIR}/${gone}`), false, gone);
  }
  assert.ok(page.split('\n').length < 320, 'the page is a composition, not 3,000 lines');
  assert.doesNotMatch(all, /available-controls|ControlsTab|CrossLinksTab|RecommendTargetsPanel|AiSuggestionsPanel/, 'the unreachable modals and panels are not rebuilt');
});

test('the page draws the kit head with the name of the file, and Back is the browser\'s history (the Frameworks journey returns through it), the Library when there is none', () => {
  assert.match(page, /<PageHeader\s+variant="page"\s+title=\{evidence\.name\}/);
  assert.match(page, /backTo\(typeof window === 'undefined' \? 0 : window\.history\.length\) === 'history'\) router\.back\(\); else router\.push\('\/evidence'\)/);
  assert.match(page, /useTabParam\('tab', RECORD_TABS/);
  assert.match(page, /<RecordTimeline steps=\{steps\} \/>/);
});

test('opening the record asks for five things (the file, the AI review, the controls, the links, the people) and the rest waits for its tab, dialog or sheet', () => {
  assert.match(page, /useDetail\(id\)/);
  assert.match(page, /useEvidenceReview\(valid \? id : null, \{ start: true \}\)/, 'the shared hook is called as it always was: it starts a review the file never had');
  assert.match(page, /useControls\(id, valid\)/);
  assert.match(page, /useLinks\(id, valid\)/);
  assert.match(page, /useTenantUsers\(\)/);
  assert.match(page, /useRating\(id, opened\.current\.ai && !!evidence, running\)/, 'the rating\'s detail waits for the AI review tab');
  assert.match(page, /useClauses\(id, opened\.current\.ai && !!evidence\)/);
  assert.match(page, /useLinkStatus\(id, opened\.current\.ai && !!evidence\)/);
  assert.match(page, /useOcrText\(id, ocrOpen\)/, 'the extracted text waits for its dialog');
  for (const heavy of ['useRisks', 'useAssets', 'useIncidents', 'useCommonControls', 'useDocuments', 'useAuditOptions']) {
    assert.doesNotMatch(page, new RegExp(heavy), `${heavy}: the lists a person links from are the link sheet's, read when their tab opens`);
    assert.ok(sheet.includes(`${heavy}(`), heavy);
  }
  assert.match(sheet, /useRisks\(open && tab === 'risks'\)/);
  assert.match(edit, /useModuleSettings\('evidence'\)/, 'the module settings are read when the edit sheet opens');
  assert.doesNotMatch(page, /useModuleSettings/);
});

test('contract: the endpoints the page always used, with the payloads it always sent', () => {
  for (const url of ['/evidence-mgmt/links/${id}/ai-link-status', '/evidence-mgmt/cross-links/${id}/audit-observation-options', '/evidence-mgmt/links/common-control-options', '/risks', '/assets', '/erm/incidents', '/governance/documents/${documentId}/policy-statements']) {
    assert.ok(data.includes(url), url);
  }
  for (const url of ['/automation/common/controls/${encodeURIComponent(r.scfId)}/assurance/evidence', '/evidence-mgmt/cross-links/${id}/audit-observations', '/evidence-mgmt/cross-links/${id}/audit-issues',
    '/evidence-mgmt/links/${id}/link-from-ai', '/evidence-mgmt/links/${id}/controls/${u.id}', '/evidence-mgmt/cross-links/${id}/${segment}/${u.id}', '/evidence-mgmt/cross-links/${id}/${path}']) {
    assert.ok(actions.includes(url), url);
  }
  assert.match(actions, /\{ evidence_id: id, artifact_name: r\.artifactName \|\| null \}/);
  assert.match(actions, /risks: \{ risk_ids: req\.ids \}, assets: \{ asset_ids: req\.ids \}, incidents: \{ incident_ids: req\.ids \}, policy_statements: \{ statement_ids: req\.ids \}/);
  assert.match(actions, /\{ observation_ids: statutory \}/);
  assert.match(actions, /\{ issue_ids: issues \}/);
  assert.match(actions, /framework_name: c\.framework_name, control_id: c\.control_id, clause_reference: c\.clause_reference, confidence: c\.confidence, matching_rationale: c\.matching_rationale/);
  assert.match(edit, /apiClient\.put\(`\/evidence-mgmt\/items\/\$\{evidence\.id\}`, editBody\(form, valuesToSave\(settings, custom, evidence\.custom_values \|\| \{\}\)\)\)/);
  assert.match(actions, /reviewEvidence\(id, 'approve'/);
  assert.match(actions, /reviewEvidence\(id, 'reject'/);
  assert.match(actions, /deleteEvidence\(id, force\)/);
});

test('contract: the query keys the AI-review hook and the Library refresh are the ones the record reads, so a rating that lands shows up here', () => {
  for (const key of ["'evidence-detail'", "'evidence-assessment'", "'evidence-clause-mappings'", "'evidence-ai-link-status'", "'evidence-ocr'", "'evidence-all-links'", "'evidence-controls'"]) assert.ok(data.includes(key), key);
  assert.match(actions, /\.\.\.LIBRARY_REFRESH/, 'a change to the file refreshes the Library, the Insights and the packages');
  assert.match(actions, /\['evidence-review', id\]/);
});

test('contract: the rights are the ones the old page checked (edit, delete); sending a draft and linking are open to every signed-in person, as the server allows', () => {
  assert.match(page, /hasPermission\('evidence:evidence_library:edit'\)/);
  assert.match(page, /hasPermission\('evidence:evidence_library:delete'\)/);
  const keys = Array.from(all.matchAll(/hasPermission\('([^']+)'\)/g), (m) => m[1]).sort();
  assert.deepEqual(Array.from(new Set(keys)), ['evidence:evidence_library:delete', 'evidence:evidence_library:edit']);
});

test('every write reports (useReportedMutation): it says what happened, a failure stays with its words; delete asks, and asks again when the server warns; a submit stays on the page', () => {
  assert.doesNotMatch(all, /\buseMutation\(/, 'no bare useMutation');
  for (const f of [actions, edit]) assert.match(f, /useReportedMutation</);
  assert.match(actions, /title: 'Delete this evidence\?'/);
  assert.match(actions, /title: 'Delete it anyway\?'/);
  assert.match(actions, /title: 'Renew this evidence\?'/);
  assert.match(actions, /title: `Remove this \$\{LINK_ONE\[type\]\}\?`/);
  assert.doesNotMatch(all, /compliance\/assessments\/approvals/, 'sending a draft for review no longer leaves the file for the Pending Approvals page');
  assert.match(edit, /toast: 'success'/, 'a failed save is said inside the sheet, once');
  assert.match(edit, /dirty=\{dirty\}/);
});

test('the dialogs keep their props: the maturity breakdown and the OCR text are the shared ones, and the file opens in the shared viewer by its evidence id', () => {
  for (const prop of ['isOpen=', 'onClose=', 'qualityScore=', 'assessment=', 'ocrStatus=', 'isAssessing=']) assert.ok(page.includes(prop), prop);
  for (const prop of ['ocrContent=', 'ocrProcessedAt=', 'processMessage=', 'onReprocess=', 'isReprocessing=']) assert.ok(page.includes(prop), prop);
  assert.match(page, /evidence_id: evidence\.id, file_name: evidence\.file_name \|\| evidence\.name, mime_type: evidence\.file_type, file_size: null/);
});

test('Rule U1: no id, hash or path is a title or a word on the record (an unnamed record is "A risk")', () => {
  assert.doesNotMatch(all, /#\$\{|Risk #|Asset #|Incident #|Statement #|Assessment #/);
  assert.doesNotMatch(all, /file_path:/, "the file path on the server is never sent to the viewer (it opens the file by its evidence id)");
});
