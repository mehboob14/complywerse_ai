// node --test "src/lib/navPages/rcsa.test.ts"
// The RCSA pages in the navigation registry (lib/navPages/risk.ts): every page under erm/rcsa has exactly one entry, every entry that says its page draws its own heading has a page that renders the
// kit's head (PageHeader variant="page"), the old addresses are entries that say they forward and draw nothing, and the top bar names only the section on the pages that draw their own head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ownHeadingSection, routes } from '../navRegistry.ts';

const APP = fileURLToPath(new URL('../../app/(dashboard)/erm/rcsa/', import.meta.url)).replace(/\\/g, '/');
const pages = (readdirSync(APP, { recursive: true }) as string[])
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'))
  .map((f) => ({ file: f, path: `/erm/rcsa${f.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`.replace(/\[([A-Za-z]+)\]/g, ':$1') }));

const FORWARDS = ['/erm/rcsa/approvals', '/erm/rcsa/approvals/:id', '/erm/rcsa/assessments', '/erm/rcsa/custom-templates', '/erm/rcsa/findings/:id'];

/** A page and the parts of its own folder (a workspace hands its head to a part). */
function withParts(file: string): string {
  const folder = file.slice(0, file.lastIndexOf('/') + 1);
  const own = readFileSync(`${APP}${file}`, 'utf8');
  if (/PageHeader/.test(own)) return own;
  return (readdirSync(`${APP}${folder}`, { recursive: true }) as string[]).filter((f) => /\.tsx$/.test(f)).map((f) => readFileSync(`${APP}${folder}${f}`, 'utf8')).join('\n');
}

test('every page under erm/rcsa is exactly one registry entry', () => {
  for (const p of pages) assert.equal(routes.filter((e) => e.path === p.path).length, 1, p.path);
  assert.deepEqual(pages.map((p) => p.path).sort(), [
    '/erm/rcsa', '/erm/rcsa/approvals', '/erm/rcsa/approvals/:id', '/erm/rcsa/assessments', '/erm/rcsa/assessments/:id', '/erm/rcsa/campaigns', '/erm/rcsa/campaigns/:id',
    '/erm/rcsa/custom-templates', '/erm/rcsa/custom-templates/:id', '/erm/rcsa/findings', '/erm/rcsa/findings/:id', '/erm/rcsa/templates', '/erm/rcsa/templates/:id',
  ]);
});

test('an entry that says its page draws its own heading has a page that renders PageHeader variant="page"; the forwards draw nothing', () => {
  for (const p of pages) {
    const entry = routes.find((e) => e.path === p.path);
    if (FORWARDS.includes(p.path)) {
      assert.ok(!entry?.ownHeading, p.path);
      assert.doesNotMatch(readFileSync(`${APP}${p.file}`, 'utf8'), /PageHeader/, p.path);
      continue;
    }
    assert.ok(entry?.ownHeading, `${p.path} draws its own head`);
    assert.match(withParts(p.file), /<PageHeader[\s\S]{0,40}variant="page"/, p.path);
  }
});

test('the top bar names only the section on the pages that draw their own head', () => {
  assert.ok(ownHeadingSection('/erm/rcsa/campaigns') !== undefined);
  assert.ok(ownHeadingSection('/erm/rcsa/findings') !== undefined);
  assert.equal(ownHeadingSection('/erm/rcsa/approvals'), undefined);
});
