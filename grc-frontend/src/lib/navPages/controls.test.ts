// node --test "src/lib/navPages/controls.test.ts"
// The navigation-registry entries of the Controls Automation pages this group rebuilt (the Overview, Common Controls and its strip, Audit periods, Connections, the forward of Automated Checks): every page of
// `automation/` except the control page `[code]` (the next builder's) has exactly one entry, every entry that says it draws its own heading has a page whose folder does (the head is drawn by a
// component in a `_folder` for the three pages that hold a facet explorer, a triage and a register), the heading is the registry's name, and the top bar names the section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ownHeadingSection, routes, titleFor } from '../navRegistry.ts';

const DASHBOARD = fileURLToPath(new URL('../../app/(dashboard)/', import.meta.url));
const OWN_SECTION = 'Controls Automation';

/** Every page of `automation/` but the control page: `automation/soc2-controls/coverage/page.tsx` -> `/automation/soc2-controls/coverage`. */
function ownPages(): string[] {
  const out: string[] = [];
  const walk = (folder: string) => {
    if (existsSync(`${DASHBOARD}${folder}/page.tsx`)) out.push(`/${folder}`);
    for (const e of readdirSync(`${DASHBOARD}${folder}`, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('[')) walk(`${folder}/${e.name}`);
    }
  };
  walk('automation');
  return out.sort();
}

/** The text of a page and of the `_folders` beside it: where a head is drawn when the page only places a component. */
function headSource(path: string): string {
  const folder = `${DASHBOARD}${path.slice(1)}`;
  const files = [`${folder}/page.tsx`];
  for (const e of readdirSync(folder, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith('_')) for (const f of readdirSync(`${folder}/${e.name}`)) if (f.endsWith('.tsx')) files.push(`${folder}/${e.name}/${f}`);
  }
  // the Controls explorer's folder is shared with the Overview and the Connections page, so a page's own folder is enough here
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}
const entry = (path: string) => routes.filter((e) => e.path === path);
const draws = (path: string) => /<PageHeader[\s\S]{0,80}variant="page"/.test(headSource(path));

test('every page of automation/ (but the control page) has exactly one entry, and every automation URL of the registry is a page', () => {
  const pages = ownPages();
  assert.deepEqual(pages, ['/automation/assurance', '/automation/checks', '/automation/overview', '/automation/scope', '/automation/soc2-controls', '/automation/soc2-controls/coverage', '/automation/soc2-controls/new', '/automation/soc2-controls/review']);
  for (const page of pages) assert.equal(entry(page).length, 1, page);
  const urls = routes.filter((e) => e.path.startsWith('/automation')).map((e) => e.path);
  for (const url of urls) assert.ok(url === '/automation/soc2-controls/:code' || pages.includes(url), `${url} has no page`);
});

test('the pages that say they draw their own heading do, and the ones that forward do not', () => {
  const flagged = ['/automation/overview', '/automation/soc2-controls', '/automation/soc2-controls/new', '/automation/soc2-controls/coverage', '/automation/soc2-controls/review', '/automation/assurance', '/admin/evidence-collectors'];
  for (const path of flagged) {
    assert.equal(entry(path)[0].ownHeading, true, `${path} is flagged`);
    assert.ok(path === '/admin/evidence-collectors' ? /<PageHeader[\s\S]{0,300}variant="page"/.test(readFileSync(`${DASHBOARD}admin/evidence-collectors/page.tsx`, 'utf8')) : draws(path), `${path} draws the kit head`);
  }
  for (const path of ['/automation/checks', '/automation/scope']) assert.equal(entry(path)[0].ownHeading, undefined, `${path} only forwards`);
});

test('the heading of each page is the name the registry gives it, and the top bar names only the section', () => {
  assert.equal(titleFor('/automation/overview'), 'Controls Automation Overview');
  assert.equal(titleFor('/automation/assurance'), 'Audit periods');
  assert.equal(titleFor('/automation/soc2-controls/coverage'), 'Requirement coverage');
  assert.equal(titleFor('/automation/soc2-controls/review'), 'Mapping review');
  assert.equal(titleFor('/admin/evidence-collectors'), 'Connections');
  for (const url of ['/automation/soc2-controls/coverage', '/automation/soc2-controls/review', '/automation/assurance', '/automation/soc2-controls/new']) assert.equal(ownHeadingSection(url), OWN_SECTION, url);
  assert.equal(ownHeadingSection('/automation/soc2-controls/IAC-06'), undefined, 'the control page is the next builder\'s: its heading is drawn by the top bar');
});

test('the old names stay findable', () => {
  assert.ok(entry('/automation/assurance')[0].keywords?.includes('Statement of Applicability'));
  assert.ok(entry('/admin/evidence-collectors')[0].keywords?.includes('All Connections'));
});
