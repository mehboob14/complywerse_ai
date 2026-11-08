// node --test "src/app/(dashboard)/governance/regulatory-changes/regulatoryPages.test.ts"
// Source-text pins for the Regulatory Changes and Feed folders (the revamp's rules, held where a browser test cannot): the kit's class rules (nothing the platform CSS repaints, no text under 12px), no native
// dialogs, no action that appears only on hover, every mutation reported (no bare useMutation), the pickers read the people list any signed-in person may read (never the administrator's), no model name,
// and the one legacy file that is left (_ui.tsx, kept for three Vendor Risk imports) is only what they import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const GOV = fileURLToPath(new URL('../', import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}${e.name}/`) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [`${dir}${e.name}`] : []));
}
const LEGACY = 'regulatory-changes/_ui.tsx';
const files = [...walk(`${GOV}regulatory-changes/`), ...walk(`${GOV}regulatory-feeds/`)].filter((f) => !f.replace(/\\/g, '/').endsWith(LEGACY));
const source = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/\s.*$/, '$1')).join('\n');

test('the folders are the pages, the parts and the models of this group (a new file is looked at by every test below)', () => {
  assert.ok(files.length >= 30, `${files.length} files`);
  assert.ok(files.some((f) => f.endsWith('ChangesRegister.tsx')) && files.some((f) => f.endsWith('FeedInbox.tsx')) && files.some((f) => f.includes('[id]')));
});

test('no file uses a class the platform CSS repaints, a value outside the tokens, or text under 12px', () => {
  const bad = files.flatMap((f) => findViolations(readFileSync(f, 'utf8')).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native dialog, no action that shows only on hover, no bare useMutation, no cursor-pointer row that is not a control', () => {
  for (const f of files) {
    const s = source(f);
    assert.doesNotMatch(s, /window\.(?:confirm|alert|prompt)\(|(?<![.\w])(?:alert|prompt)\(|(?:if \(|!)confirm\(/, `${f}: native dialog (the kit's useConfirm is awaited)`);
    assert.doesNotMatch(s, /opacity-0[^'"`]*group-hover|group-hover:opacity|hidden group-hover/, `${f}: hover-only action`);
    assert.doesNotMatch(s, /\buseMutation\(/, `${f}: a bare useMutation (use useReportedMutation)`);
    assert.doesNotMatch(s, /className="[^"]*\bcursor-pointer\b/, `${f}: a clickable div (use a button or the table's row activation)`);
  }
});

test('the pickers read the people list any signed-in person may read: never the administrator\'s user list, and a failure is shown, not swallowed to an empty list', () => {
  for (const f of files) {
    const s = source(f);
    assert.doesNotMatch(s, /adminApi|\/admin\/users|admin-users/, `${f}: the administrator's user list`);
  }
  const data = source(`${GOV}regulatory-changes/_lib/data.ts`);
  assert.match(data, /regulatoryExtra\.people\(\)/);
  assert.doesNotMatch(data, /catch\s*\{\s*return\s*\[\]/, 'no failure becomes an empty list');
  const shared = source(`${GOV}regulatory-changes/_parts/shared.tsx`);
  assert.match(shared, /PeopleProblem/);
  assert.match(shared, /The list of people could not be loaded/);
});

test('the screens never name a model or a vendor, and never print an id, a hash or a raw error', () => {
  for (const f of files) {
    const s = source(f);
    assert.doesNotMatch(s, /model_used|gpt-|openai|anthropic|claude/i, `${f}: a model or vendor name`);
    if (f.endsWith('.tsx')) assert.doesNotMatch(s, /analysis\.error|\.raw_response|\bUUID\b|sha-?256/i, `${f}: a raw error or a technical word`);
  }
});

test('the status of a change is moved from a menu and Completed only through Close (the server would take it on PUT: the screen does not offer it)', () => {
  const page = source(`${GOV}regulatory-changes/[id]/page.tsx`);
  assert.match(page, /MOVES\.map/);
  const model = source(`${GOV}regulatory-changes/_lib/regulatoryModel.ts`);
  assert.match(model, /export const MOVES = \['identified', 'under_assessment', 'implementation', 'not_applicable'\]/);
  assert.match(source(`${GOV}regulatory-changes/[id]/_head.tsx`), /closeChange|regulatoryApi\.closeChange/);
});

test('the legacy file is only what the three Vendor Risk files import', () => {
  const s = readFileSync(`${GOV}${LEGACY}`, 'utf8');
  const exported = Array.from(s.matchAll(/^export (?:const|function|type) (\w+)/gm)).map((m) => m[1]).sort();
  assert.deepEqual(exported, ['Option', 'Segmented', 'fmtDate', 'inDays', 'isoDay']);
  const vendor = fileURLToPath(new URL('../../vendor-risk/vendors/[id]/', import.meta.url));
  const users = walk(vendor).filter((f) => readFileSync(f, 'utf8').includes('governance/regulatory-changes/_ui'));
  assert.equal(users.length, 3, 'SendDialog, RenewalDialog and PortalPanel');
});

test('the Feed offers Not relevant and says what Convert made; the seeded defaults are named for what they add', () => {
  const inbox = source(`${GOV}regulatory-feeds/_feed/FeedInbox.tsx`);
  assert.match(inbox, /feedApi\.dismiss/);
  assert.match(inbox, /Open the change/);
  assert.match(source(`${GOV}regulatory-feeds/_feed/SourcesSheet.tsx`), /Add Federal Reserve and ECB feeds/);
});
