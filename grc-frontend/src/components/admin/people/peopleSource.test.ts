// node --test "src/components/admin/people/peopleSource.test.ts"
// Source-text pins for the Users and Roles pages (adm-people): they follow the design-system kit's rules (components/ui/ds/kitRules.ts), draw no native dialog and no
// bare <p>/<td>/<th>/<h2>/<h3> (the platform CSS gives those 11.5px: PITFALLS 100), and do what their comments say. React behaviour is checked in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../../ui/ds/kitRules.ts';

const PEOPLE = 'src/components/admin/people';
const PAGES = 'src/app/(dashboard)';
const TSX = [
  `${PEOPLE}/UsersRegister.tsx`, `${PEOPLE}/UserSheet.tsx`, `${PEOPLE}/usersActions.tsx`, `${PEOPLE}/RolesRegister.tsx`, `${PEOPLE}/RoleEditor.tsx`,
  `${PEOPLE}/PermissionGrid.tsx`, `${PEOPLE}/MembersSheet.tsx`,
  `${PAGES}/admin/users/page.tsx`, `${PAGES}/admin/users/[id]/usage/page.tsx`, `${PAGES}/admin/roles/page.tsx`, `${PAGES}/users/page.tsx`,
];
const FILES = TSX.concat([`${PEOPLE}/peopleData.ts`, 'src/lib/people/usersModel.ts', 'src/lib/people/rolesModel.ts', 'src/lib/statuses/people.ts']);
const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

test('the files follow the kit rules: no palette class, named text size, named radius or shadow, no bare outline-none, nothing under 12px', () => {
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no <p>, <td>, <th>, <h2> or <h3> is bare: each names a text size (directly, or through an upper-case class constant the file defines with one)', () => {
  const bad = TSX.flatMap((f) => {
    const src = read(f);
    const sized = (name: string) => new RegExp(`const ${name} = '[^']*!?text-ds-(?:body|label)`).test(src);
    return Array.from(src.matchAll(/<(p|td|th|h2|h3)\b([^>]*)>/g))
      .filter((m) => !/(^|[\s"'`!])text-(ds-(title|section|body|label)|\[\d)/.test(m[2]))
      .filter((m) => !(m[2].match(/\b[A-Z]{3,}\b/g) ?? []).some((name) => sized(name)))
      .map((m) => `${f}: <${m[1]}${m[2].slice(0, 60)}`);
  });
  assert.deepEqual(bad, []);
});

test('no native dialog (confirm, alert, prompt), no reveal-on-hover action, no hidden checkbox, no fixed-width drawer', () => {
  for (const f of TSX) {
    const src = read(f);
    assert.doesNotMatch(src, /\bwindow\.(?:confirm|alert|prompt)\(|(?<![\w.])(?:alert|prompt)\(|(?<![\w.])(?<!await )confirm\(/, `${f}: a native dialog`);
    assert.doesNotMatch(src, /opacity-0[^'"`]*group-hover/, `${f}: an action revealed by hover`);
    assert.doesNotMatch(src, /className="hidden"/, `${f}: a hidden checkbox cannot be reached by keyboard`);
    assert.doesNotMatch(src, /\bw-\[(?:520|800|480)px\]/, `${f}: a fixed-width drawer`);
  }
});

test('the Users register is the one list of people: /users and /admin/users both draw it, the old pages\' private lists and their free-text fields are gone', () => {
  assert.match(read(`${PAGES}/admin/users/page.tsx`), /<UsersRegister \/>/);
  const door = read(`${PAGES}/users/page.tsx`);
  assert.match(door, /<PermissionGuard required=\{navPermissions\('\/users'\)\}><UsersRegister \/><\/PermissionGuard>/, 'the page behind the user menu keeps its guard');
  const all = TSX.map(read).join('\n').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');       // (comments may name the old shape)
  assert.doesNotMatch(all, /tenants\/\$\{|\/tenants\//, 'nothing reads the nested /tenants/{id}/users shape any more');
  assert.doesNotMatch(all, /\b(?:designation|division)\b/i, 'the four free-text fields the server never stored are not offered');
  assert.match(read(`${PEOPLE}/peopleData.ts`), /adminApi\.getUsers\(\)/, 'the flat, complete list');
});

test('Deactivate comes before Remove permanently in the row menu and in the sheet; both are held back from your own account', () => {
  const menu = read(`${PEOPLE}/UsersRegister.tsx`);
  const rows = menu.slice(menu.indexOf('const rowMenu'));
  assert.ok(rows.indexOf("key: 'deactivate'") > 0 && rows.indexOf("key: 'deactivate'") < rows.indexOf("key: 'remove'"));
  assert.match(menu, /disabled: self !== null, reason: self \?\? undefined, onSelect: \(\) => \{ void actions\.askDeactivate/);
  const sheet = read(`${PEOPLE}/UserSheet.tsx`);
  assert.ok(sheet.indexOf('askDeactivate') < sheet.indexOf('askRemove'), 'Remove is the last thing in the account section');
  assert.match(sheet, /disabled=\{self !== null\}/);
  assert.match(read(`${PEOPLE}/usersActions.tsx`), /tone: 'danger' \}\)\) remove\.mutate/, 'removing asks in danger tone');
  assert.match(read(`${PEOPLE}/usersActions.tsx`), /updateUser\(user\.id, \{ is_active: active \}\)/, 'deactivating sends only the status');
});

test('the sheet sends only what changed and never touches roles it could not read', () => {
  const sheet = read(`${PEOPLE}/UserSheet.tsx`);
  assert.match(sheet, /updateBody\(saved, form, rolesKnown\)/);
  assert.match(sheet, /createBody\(form\)/);
  assert.match(sheet, /autoComplete="new-password"/, 'the password field is a password field');
  assert.doesNotMatch(sheet, /console\.|localStorage|sessionStorage/, 'nothing about the password is logged or stored');
});

test('the role editor keeps what a role holds exactly: whole-list save, outside names listed, the Administrator role shown as Full access, an ask before a role people hold changes', () => {
  const editor = read(`${PEOPLE}/RoleEditor.tsx`);
  assert.match(editor, /updateRoleBody\(before, after\)/);
  assert.match(editor, /outsideNames\(matrix, form\.held\)/);
  assert.match(editor, /isFullAccess\(role\)/);
  assert.match(editor, /title="Full access"/);
  assert.match(editor, /impactLine\(role\.user_count, permissionsChanged\)/);
  assert.match(editor, /menuPreview\(form\.held/, 'the menu the draft would give');
  const grid = read(`${PEOPLE}/PermissionGrid.tsx`);
  assert.match(grid, /setNames\(held as string\[\], names, on\)/, 'every change goes through the one function that leaves other names alone');
  assert.match(grid, /<Checkbox/);
});

test('every request of the two pages has an error branch with its words (a refusal is not an empty list)', () => {
  for (const f of [`${PEOPLE}/UsersRegister.tsx`, `${PEOPLE}/RolesRegister.tsx`]) {
    const src = read(f);
    assert.match(src, /<ErrorState title="Couldn't load/, `${f}: a failed list says so`);
    assert.match(src, /<NoAccessState/, `${f}: a refused list says it was refused`);
  }
  assert.match(read(`${PEOPLE}/MembersSheet.tsx`), /<ErrorState/);
  assert.match(read(`${PEOPLE}/RoleEditor.tsx`), /<ErrorState compact title="Couldn't load the permission list"/);
});

test('a refusal is said in plain words: the pages never print the server\'s "Permission denied: <key>" (they use plainError, which turns a 403 into one sentence)', () => {
  for (const f of ['UsersRegister', 'UserSheet', 'RolesRegister', 'RoleEditor']) {
    const src = read(`${PEOPLE}/${f}.tsx`);
    assert.doesNotMatch(src, /\berrorMessage\(/, `${f}: use plainError`);
    assert.match(src, /plainError\(/, f);
  }
  assert.match(read(`${PEOPLE}/peopleData.ts`), /statusOf\(error\) === 403 \? NO_RIGHT/);
  assert.match(read(`${PEOPLE}/RolesRegister.tsx`), /forbidden\s*\?\s*<NoAccessState title="You don't have access to the roles"/, 'the editor address of a person without the right says so too');
});
