// node --test "src/app/(dashboard)/admin/_shell/adminShell.test.ts"
// Source-text pins for the files of the Administration shell group (adm-shell): the section list, the new section pages and the pages rebuilt by this group follow the
// design-system kit's rules (components/ui/ds/kitRules.ts), draw no native dialog and no bare <p>/<td>/<th>/<h2>/<h3> (the platform CSS gives those 11.5px: PITFALLS 100),
// and the shell does what its comments say. React behaviour is checked in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const ADMIN = 'src/app/(dashboard)/admin';
const FILES = [
  `${ADMIN}/layout.tsx`, `${ADMIN}/page.tsx`, `${ADMIN}/_shell/SettingsLayout.tsx`,
  `${ADMIN}/settings/page.tsx`, `${ADMIN}/sso/page.tsx`, `${ADMIN}/connections/page.tsx`, `${ADMIN}/teams/page.tsx`,
  `${ADMIN}/password-policy/page.tsx`, `${ADMIN}/password-policy/passwordPolicyModel.ts`,
  `${ADMIN}/organization/page.tsx`, `${ADMIN}/organization/_company/CompanyDetails.tsx`, `${ADMIN}/organization/_company/companyModel.ts`,
  'src/lib/adminSections.ts', 'src/lib/navPages/admin.ts',
].filter((f) => existsSync(f));
const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

test('the shell group\'s files follow the kit rules: no palette class, named text size, named radius or shadow, no bare outline-none, nothing under 12px', () => {
  assert.ok(FILES.length >= 13, 'the files are there');
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no <p>, <td>, <th>, <h2> or <h3> is bare: each names a text size', () => {
  const bad = FILES.filter((f) => f.endsWith('.tsx')).flatMap((f) => Array.from(read(f).matchAll(/<(p|td|th|h2|h3)\b([^>]*)>/g))
    .filter((m) => !/(^|[\s"'`!])text-(ds-(title|section|body|label)|\[\d)/.test(m[2]))
    .map((m) => `${f}: <${m[1]}${m[2].slice(0, 60)}`));
  assert.deepEqual(bad, []);
});

test('no native dialog (confirm, alert, prompt) and no reveal-on-hover action in these files', () => {
  for (const f of FILES.filter((x) => x.endsWith('.tsx'))) {
    const src = read(f);
    // the kit's useConfirm is called as `await confirm(…)`: that is not the browser's
    assert.doesNotMatch(src, /\bwindow\.(?:confirm|alert|prompt)\(|(?<![\w.])(?:alert|prompt)\(|(?<![\w.])(?<!await )confirm\(/, `${f}: a native dialog`);
    assert.doesNotMatch(src, /opacity-0[^'"`]*group-hover/, `${f}: an action revealed by hover`);
  }
});

test('the section list is the registry\'s: grouped, the open section marked for a screen reader, a select below 1280px, administrators only', () => {
  const src = read(`${ADMIN}/_shell/SettingsLayout.tsx`);
  assert.match(src, /groupedSections\(visibleSections\(\{ isAdmin \}\)\)/, 'the same list as the menu, and only for an administrator');
  assert.match(src, /aria-label="Administration sections"/);
  assert.match(src, /aria-current=\{on \? 'page' : undefined\}/);
  assert.match(src, /xl:hidden/, 'the select under 1280px');
  assert.match(src, /aria-label="Administration section"/, 'the select is named');
  assert.match(src, /current\.layout === 'full'/, 'the workflow builder is drawn full width');
  assert.match(read(`${ADMIN}/layout.tsx`), /<SettingsLayout>/);
});

test('/admin only forwards: the old tab host is gone, and every old address keeps its query through the registry', () => {
  const src = read(`${ADMIN}/page.tsx`);
  assert.match(src, /redirect\(legacyTarget\(searchParams\)\.href\)/);
  assert.doesNotMatch(src, /'use client'/, 'a server page: the forward is instant');
  assert.doesNotMatch(src, /useState|useEffect/);
});

test('Company & profile: the company stage saves as a whole with its own bar, asks before the primary contact e-mail changes, and sends no address or website', () => {
  const stage = read(`${ADMIN}/organization/_company/CompanyDetails.tsx`);
  assert.match(stage, /<SaveBar[\s\S]*?label="Save the company details"/);
  assert.match(stage, /contactEmailChanged\(saved, form\) && !\(await confirm\(/, 'the e-mail change is asked about');
  assert.match(stage, /usePermissions\(\)/, 'the right the server asks decides who edits');
  assert.match(stage, /admin:organization:edit/);
  const model = read(`${ADMIN}/organization/_company/companyModel.ts`).replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(stage + model, /website|address/i, 'no address or website field: the server has no column for them');
  const page = read(`${ADMIN}/organization/page.tsx`);
  assert.match(page, /lead=\{\{ key: 'company'/, 'the company is the lead stage of the profile');
  const profile = read('src/components/compliance/onboarding/profile/OrganisationProfile.tsx');
  assert.match(profile, /hidden=\{!onLead\}/, 'the lead stage stays mounted (nothing typed is lost) while another stage is open');
  assert.match(profile, /FIRST_OPEN = 'profile'/, '?stage=profile still opens the first stage that is open (the framework onboarding pages link there)');
});
