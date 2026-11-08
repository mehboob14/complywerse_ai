// node --test "src/app/(dashboard)/compliance/statements/_register/statementsPage.test.ts"
// What the Statements register keeps and how it is built now (a facet register), pinned in the files that carry it (there is no React renderer here; behaviour is checked in a browser):
// the list is loaded whole with the server's own limit and true total, its state lives in the address, every write goes through the kit's reported mutation (a failure is visible, with
// Retry), the old invalidation keys still reach the widgets that read them, no native dialog, the drawer follows the server's assign rule, and the kit's rules hold in every file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';
import { ownHeadingSection, registryNamesPage, routeFor, titleFor } from '../../../../../lib/navRegistry.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const UP = fileURLToPath(new URL('../', import.meta.url));
const SOURCES = [
  ...readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((file) => ({ file, text: readFileSync(`${DIR}${file}`, 'utf8') })),
  { file: '_StatementLinkagePanel.tsx', text: readFileSync(`${UP}_StatementLinkagePanel.tsx`, 'utf8') },
  { file: 'page.tsx', text: readFileSync(`${UP}page.tsx`, 'utf8') },
];
const TSX = SOURCES.filter((s) => s.file.endsWith('.tsx'));
const src = (file: string) => SOURCES.find((s) => s.file === file)!.text;
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the page is a thin shell: the address holds the state, the register draws it', () => {
  const page = code(src('page.tsx'));
  assert.ok(src('page.tsx').split('\n').length < 14);
  assert.match(page, /useAddressState\(STATEMENTS_SCHEMA\)/);
  assert.match(page, /<StatementsRegister address=\{address\} setAddress=\{setAddress\} \/>/);
});

test('the list is loaded whole: the server\'s own limit, its true total, one query key, a failure is an error and not an empty register', () => {
  const data = code(src('statementData.ts'));
  assert.match(data, /export const PAGE = 1000;/, 'statements.py allows at most 1,000 a request');
  assert.match(data, /complianceApi\.statements\.getAll\(\{ skip: page \* PAGE, limit: PAGE \}\)/);
  assert.match(data, /total = typeof data\.total === 'number' \? data\.total : items\.length;/);
  assert.match(data, /queryKey: \[\.\.\.STATEMENTS_KEY\]/);
  assert.doesNotMatch(data, /\bcatch\b/, 'nothing is swallowed into an empty list');
  const reg = code(src('StatementsRegister.tsx'));
  assert.match(reg, /const noList = listQ\.isError && !listQ\.data;/);
  assert.match(reg, /Couldn't load the statements/);
  assert.match(reg, /onRetry=\{canRetry\(listQ\.error\)/);
  assert.match(reg, /SkeletonRows/);
  assert.match(reg, /kind="noMatches"/);
  assert.match(reg, /kind="firstUse"/);
});

test('every write is a reported mutation (a confirmation after the server answered, a failure that stays with Retry), and the old keys are still refreshed', () => {
  for (const file of ['StatementDrawer.tsx', 'ConvertDialog.tsx']) {
    const c = code(src(file));
    assert.doesNotMatch(c, /useMutation\(/, `${file}: a bare useMutation would fail silently`);
    assert.match(c, /useReportedMutation\(/, file);
    assert.match(c, /failure: /, `${file}: names its failure`);
  }
  const data = code(src('statementData.ts'));
  for (const key of ["['compliance-statements']", "['compliance-dashboard-summary']", '[...SCORECARD_QUERY_KEYS.compliance]']) assert.ok(data.includes(key), key);
  assert.equal((code(src('StatementDrawer.tsx')).match(/useReportedMutation\(/g) ?? []).length, 2, 'save and assign');
});

test('the endpoints are the ones the old page called, with the same payload keys', () => {
  const drawer = code(src('StatementDrawer.tsx'));
  assert.match(drawer, /complianceApi\.statements\.updateCompliance\(row\.id, data\)/);
  assert.match(drawer, /complianceApi\.statements\.linkEvidence\(row\.id, v\.add\)/);
  assert.match(drawer, /complianceApi\.statements\.assign\(row\.id, userId\)/);
  assert.match(drawer, /compliance_status: v\.status/);
  assert.match(drawer, /data\.remediation_notes = v\.remediation/);
  assert.match(drawer, /data\.next_assessment_date = v\.next/);
  assert.match(code(src('ConvertDialog.tsx')), /complianceApi\.statements\.convertToControls\(v\.documentId, \{ statement_ids: v\.ids/);
});

test('the drawer follows the server\'s assign rule: a statement assigned to someone else cannot be saved or reassigned from here', () => {
  const drawer = code(src('StatementDrawer.tsx'));
  assert.match(drawer, /const allowed = mayAssess\(detail\.assigned_to_user_id, me, isAdmin\);/);
  assert.match(drawer, /disabled=\{locked \|\| !changed\}/, 'Save is off for a statement the server would refuse');
  assert.match(drawer, /\(!canEdit && !isAdmin\) \|\| locked/, 'Assign keeps its old gate and the lock');
  assert.match(drawer, /Only the assignee or an administrator/);
});

test('state lives in the address and a quick view, search and every facet are part of it', () => {
  const addr = code(src('statementAddress.ts'));
  for (const name of ['q:', 'status:', 'priority:', 'category:', 'doc:', 'assignee:', 'quick:', 'sort:', 'open:']) assert.ok(addr.includes(name), name);
  assert.match(code(src('StatementsRegister.tsx')), /pageOf\(address as unknown as StatementsAddress\)/);
});

test('no native dialog (Convert used to alert about several documents), no hover-only action, no text under 12px, no platform-remapped utility', () => {
  for (const { file, text } of SOURCES) {
    const c = code(text);
    assert.doesNotMatch(c, /window\.(confirm|alert|prompt)\s*\(/, file);
    assert.doesNotMatch(c, /(^|[^\w.$])(alert|prompt|confirm)\s*\(/m, `${file}: a bare alert(, prompt( or confirm(`);
  }
  for (const { file, text } of TSX) {
    const c = code(text);
    assert.doesNotMatch(c, /opacity-0[^'"`\n]*group-hover|group-hover[^'"`\n]*opacity-0/, `${file}: hover-only`);
    assert.doesNotMatch(c, /governance-light/, `${file}: the legacy scope`);
    const found = findViolations(text);
    assert.deepEqual(found, [], `${file}: ${found.map((v) => `${v.rule}@${v.line}`).join(', ')}`);
  }
});

test('no bare <p>, <td>, <th>, <h2>, <h3> or <h4>: each names its text size', () => {
  const SIZE = /(?<![\w:-])!?text-(?:ds-(?:title|section|body|label)|\[\d)/;
  for (const { file, text } of TSX) {
    const c = code(text);
    const tag = /<(p|td|th|h2|h3|h4)(\s[^>]*?)?>/g;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(c)) !== null) {
      const open = c.slice(m.index, m.index + 400).split('>')[0] + '>';
      assert.match(open, SIZE, `${file}:${c.slice(0, m.index).split('\n').length} <${m[1]}> has no text size: ${open.slice(0, 90)}`);
    }
  }
});

test('the registry says the page draws its own head, the page really renders the kit\'s page head, and the area layout draws no second heading', () => {
  assert.equal(routeFor('/compliance/statements')?.ownHeading, true);
  assert.equal(registryNamesPage('/compliance/statements'), true);
  assert.equal(titleFor('/compliance/statements'), 'Statements');
  assert.equal(ownHeadingSection('/compliance/statements'), 'Compliance Management');
  const reg = src('StatementsRegister.tsx');
  assert.match(reg, /<PageHeader\s+variant="page"/);
  assert.match(reg, /title=\{titleFor\('\/compliance\/statements'\) \?\? 'Statements'\}/);
  assert.match(reg, /<ComplianceStrip current="statements" \/>/);
  assert.match(readFileSync(`${UP}../layout.tsx`, 'utf8'), /pathname\.startsWith\('\/compliance\/statements'\)/);
});
