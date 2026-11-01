// node --test "src/app/(dashboard)/evidence-requirements/requirementsPage.test.ts"
// Source-text pins for the Evidence Requirements page: it is on the kit and stays there (no named utilities the platform CSS repaints, no text under 12px, no bare
// <p>/<td>/<th>/<h2>/<h3>, no native dialogs, no hover-only actions, no legacy scope), and the behaviours that were contracts are still in the code: the endpoints,
// the payloads, the rights, the address, the reported steps. A source-text test only says what it validates in its title.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bareText, kitViolations, legacyLeftovers, read, tsxFiles } from '../evidence/_kitScan.ts';

const DIR = 'src/app/(dashboard)/evidence-requirements';
const files = tsxFiles(DIR);
const page = read(`${DIR}/page.tsx`);
const queries = read(`${DIR}/_queries.ts`);
const steps = read(`${DIR}/_useSteps.ts`);

test('every file of the page folder follows the kit rules: no named utility the shell repaints, no text under 12px, no bare outline', () => {
  assert.ok(files.length >= 4, 'the page and its pieces are found');
  assert.deepEqual(kitViolations(files), []);
});

test('no bare <p>, <td>, <th>, <h2> or <h3> (the platform gives them 11.5px), no native dialog, no hover-only action, no legacy scope, no browser-locale date', () => {
  assert.deepEqual(bareText(files), []);
  assert.deepEqual(legacyLeftovers(files), []);
});

test('the page draws the kit head and the kit register, with a pager that counts the true total, and keeps its state in the address', () => {
  assert.match(page, /<PageHeader\s+variant="page"\s+title="Evidence requirements"/);
  assert.match(page, /<RegisterTable/);
  assert.match(page, /<Pager/);
  assert.match(page, /useAddressState\(SCHEMA\)/);
  for (const name of ['framework', 'q', 'status', 'priority', 'type', 'open', 'page']) assert.match(page, new RegExp(`\\b${name}: (?:integer|text|listOf)\\(`), `?${name}= is in the address`);
  assert.match(page, /noun=\{\{ one: 'requirement', other: 'requirements' \}\}/);
});

test('contract: the endpoints, the page size of 500 followed to the server\'s total, and the four step routes are the ones the page always called', () => {
  assert.match(queries, /'\/framework-upload\/upload'/);
  assert.match(queries, /`\/framework-upload\/parser\/\$\{framework\}\/evidence-requirements`/);
  assert.match(queries, /`\/framework-upload\/parser\/\$\{framework\}\/controls`/);
  assert.match(queries, /REQUIREMENTS_PAGE = 500/);
  assert.match(queries, /nextSkips\(rows\.length, first\.total, REQUIREMENTS_PAGE\)/);
  assert.match(queries, /f\.upload_status === 'completed' \|\| f\.upload_status === 'parsed' \|\| f\.upload_status === 'published'/);
  assert.match(queries, /`\/framework-upload\/parser\/evidence-requirements\/\$\{id\}\/\$\{key\}`/);
  assert.match(steps, /key === 'reject' \? \{ reason \} : \{\}/, 'reject sends the reason, the others an empty body');
});

test('contract: the query keys the rest of the app can invalidate are kept, and the rights are the ones the page always checked', () => {
  assert.match(page, /\['uploaded-frameworks-for-evidence'\]/);
  assert.match(page, /\['parsed-controls-for-evidence', framework\]/);
  assert.match(page, /\['evidence-requirements', framework\]/);
  assert.match(page, /hasPermission\('evidence:evidence_library:edit'\)/);
  assert.doesNotMatch(page, /hasPermission\('evidence:evidence_library:(?:create|delete|view)'\)/, 'no right is added');
});

test('every step goes through useReportedMutation (said after the server answers, in its words); no bare useMutation, no silent failure', () => {
  assert.match(steps, /useReportedMutation</);
  assert.doesNotMatch(steps + page, /\buseMutation\(/);
  assert.match(steps, /toast: 'success'|const reject = useStep\('reject', framework, 'success'/, 'a rejection says its failure inside its dialog');
  for (const f of files) assert.doesNotMatch(read(f), /console\.(?:log|error)\(/, f);
});

test('a failed read is an error with Retry, never an empty table; the three states of the catalogue are loading, failed and loaded', () => {
  assert.match(page, /<ErrorState\s+title="Couldn't load the requirements"/);
  assert.match(page, /title="Couldn't load the frameworks"/);
  assert.match(page, /const failed = framework !== null && catalogueQ\.isError && !catalogue/);
  assert.match(page, /loading=\{loading\}/);
});
