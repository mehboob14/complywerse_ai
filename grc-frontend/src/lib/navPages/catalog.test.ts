// node --test "src/lib/navPages/catalog.test.ts"
// The navigation-registry entries of the Control Catalog, the Control Library and Control Assurance: every page of controls/ and control-library/ has exactly one entry, the three surfaces of the strip
// (Catalog | Library | Assurance) have one name each, the pages that draw the kit head say so (the top bar then names only the section), and the pages that only forward say nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { breadcrumbFor, ownHeadingSection, routes, titleFor } from '../navRegistry.ts';

const DASHBOARD = fileURLToPath(new URL('../../app/(dashboard)/', import.meta.url));
const SECTION = 'Compliance Management';

/** Every page of a folder: `controls/configure-frameworks/page.tsx` -> `/controls/configure-frameworks`; a `[id]` folder is the registry's `:id`. */
function pagesOf(folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, url: string) => {
    if (existsSync(`${DASHBOARD}${dir}/page.tsx`)) out.push(url);
    for (const e of readdirSync(`${DASHBOARD}${dir}`, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('_')) walk(`${dir}/${e.name}`, `${url}/${/^\[(.+)\]$/.test(e.name) ? `:${e.name.slice(1, -1)}` : e.name}`);
    }
  };
  walk(folder, `/${folder}`);
  return out.sort();
}
const entry = (path: string) => routes.filter((e) => e.path === path);

test('every page of controls/ and control-library/ has exactly one entry', () => {
  const pages = [...pagesOf('controls'), ...pagesOf('control-library')].sort();
  assert.deepEqual(pages, [
    '/control-library', '/control-library/:id', '/control-library/assurance', '/control-library/compare', '/control-library/coverage', '/control-library/evidence', '/control-library/gaps',
    '/control-library/pipeline-lab', '/control-library/review', '/control-library/templates', '/controls', '/controls/configure-frameworks', '/controls/overview', '/controls/workbench',
  ].sort());
  for (const page of pages) assert.equal(entry(page).length, 1, page);
});

test('the three surfaces have one name each: Control Catalog, Control Library, Control Assurance', () => {
  assert.equal(titleFor('/controls'), 'Control Catalog');
  assert.equal(titleFor('/control-library'), 'Control Library');
  assert.equal(titleFor('/control-library/assurance'), 'Control Assurance');
  assert.ok(entry('/control-library')[0].keywords?.includes('Unified Control Library'), 'the old name stays findable');
  assert.ok(entry('/control-library/assurance')[0].keywords?.includes('Control Testing & Assurance'), 'and so does the old Assurance name');
  assert.deepEqual(breadcrumbFor('/control-library/7').map((c) => c.label), [SECTION, 'Overview', 'Control Library', 'Control domain']);
});

test('the pages that draw the kit head say so, and the ones that forward do not', () => {
  for (const path of ['/controls', '/controls/configure-frameworks', '/control-library', '/control-library/assurance', '/control-library/review', '/control-library/:id']) {
    assert.equal(entry(path)[0].ownHeading, true, path);
  }
  for (const url of ['/controls', '/controls/configure-frameworks', '/control-library', '/control-library/assurance', '/control-library/review', '/control-library/7']) assert.equal(ownHeadingSection(url), SECTION, url);
  for (const path of ['/controls/overview', '/controls/workbench', '/control-library/compare', '/control-library/coverage', '/control-library/evidence', '/control-library/gaps', '/control-library/pipeline-lab', '/control-library/templates']) {
    assert.equal(entry(path)[0].ownHeading, undefined, `${path} only forwards`);
    assert.match(entry(path)[0].hidden ?? '', /forwards to the Control (Catalog|Library)/, path);
  }
});
