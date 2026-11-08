// node --test "src/lib/navPages/assessmentWorkspace.test.ts"
// The registry entries of the assessment workspace (assess-workspace): the one page `/assessments/a/<id>` that opens every assessment (the NCA workspace is `/assessments/a/nca`, the same page),
// its heading is its own (the top bar names only the section), the sidebar keeps Assessments lit on it, and the two older detail addresses stay in the registry as forwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { activeNavHref } from '../../components/layout/navActive.ts';
import { navigation } from '../../components/layout/navAccess.ts';
import { breadcrumbFor, ownHeadingSection, routeFor, routes } from '../navRegistry.ts';

test('/assessments/a/<id> is one entry, flagged because the page draws the kit head, and it names the section only', () => {
  const entries = routes.filter((e) => e.path === '/assessments/a/:id');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'Assessment');
  assert.equal(entries[0].ownHeading, true);
  assert.equal(entries[0].parent, '/assessments');
  assert.ok(existsSync('src/app/(dashboard)/assessments/a/[id]/page.tsx'));
  assert.match(readFileSync('src/app/(dashboard)/assessments/a/[id]/page.tsx', 'utf8'), /<PageHeader variant="page"/);
  for (const url of ['/assessments/a/12', '/assessments/a/nca']) {
    assert.equal(routeFor(url)?.path, '/assessments/a/:id', url);
    assert.equal(ownHeadingSection(url), 'Compliance Management', url);
  }
  assert.equal(routeFor('/assessments/dpia')?.path, '/assessments/:framework', 'a type address is the forward, not the workspace');
  assert.equal(routeFor('/assessments/cs_kpi')?.path, '/assessments/:framework');
});

test('the trail of a workspace goes through Assessments, and the sidebar keeps Assessments lit on it', () => {
  const trail = breadcrumbFor('/assessments/a/12').map((c) => c.label);
  assert.equal(trail[trail.length - 1], 'Assessment');
  assert.ok(trail.includes('Compliance Management'));
  assert.equal(activeNavHref('/assessments/a/12', navigation), '/assessments');
  assert.equal(activeNavHref('/assessments/a/nca', navigation), '/assessments');
});

test('the two older detail addresses are forwards that stay in the registry, with no heading of their own', () => {
  for (const path of ['/compliance/assessments/:id', '/cyber-security/assessments/:id']) {
    const e = routes.find((x) => x.path === path);
    assert.ok(e, path);
    assert.equal(e?.ownHeading, undefined, `${path} draws nothing`);
    assert.match(e?.hidden ?? '', /forwards to the assessment workspace/, path);
  }
});
