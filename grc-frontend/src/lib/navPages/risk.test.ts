// node --test "src/lib/navPages/risk.test.ts"
// The Risk Management pages of the register group (Overview, Risk Register, a risk, Reviews, Reports) in the navigation registry: each is flagged ownHeading and its page file draws the kit's
// page head (the register through RiskRegister.tsx), the top bar names only the section, the heading of the page is its registry name, and the two old register addresses are forwards that
// keep their parameters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ownHeadingSection, routeFor, routes, titleFor } from '../navRegistry.ts';

const ERM = fileURLToPath(new URL('../../app/(dashboard)/erm/', import.meta.url));
const read = (rel: string): string => readFileSync(`${ERM}${rel}`, 'utf8');

const PAGES: Array<[string, string, string]> = [
  ['/erm', 'page.tsx', 'Risk Management Overview'],
  ['/erm/risks', 'risks/_register/RiskRegister.tsx', 'Risk Register'],
  ['/erm/risks/:id', 'risks/[id]/page.tsx', 'Risk'],
  ['/erm/reviews', 'reviews/page.tsx', 'Risk Reviews'],
  ['/erm/reports', 'reports/page.tsx', 'Reports & Analytics'],
];

test('each page of the group is flagged ownHeading and draws the kit page head, so the top bar names only the section', () => {
  for (const [path, file] of PAGES) {
    const entry = routes.find((r) => r.path === path);
    assert.equal(entry?.ownHeading, true, `${path}: ownHeading`);
    assert.match(read(file), /<PageHeader[\s\S]{0,80}variant="page"/, `${path}: ${file} renders PageHeader variant="page"`);
    assert.equal(ownHeadingSection(path.replace(':id', '12')), 'Risk Management', path);
  }
});

test('the heading of a page is its registry name (the risk page names the record itself)', () => {
  assert.equal(titleFor('/erm'), 'Risk Management Overview');
  assert.equal(titleFor('/erm/risks'), 'Risk Register');
  assert.equal(routeFor('/erm/reviews')?.label, 'Risk Reviews');
  assert.equal(routeFor('/erm/reports')?.label, 'Reports & Analytics');
  assert.match(read('risks/_register/RiskRegister.tsx'), /routeFor\('\/erm\/risks'\)\?\.label \?\? 'Risk Register'/);
  assert.match(read('reviews/page.tsx'), /routeFor\('\/erm\/reviews'\)\?\.label \?\? 'Risk Reviews'/);
  assert.match(read('reports/page.tsx'), /routeFor\('\/erm\/reports'\)\?\.label \?\? 'Reports & Analytics'/);
  assert.match(read('page.tsx'), /titleFor\('\/erm'\) \?\? 'Risk Management Overview'/);
  assert.match(read('risks/[id]/page.tsx'), /title=\{risk\.title\}/);
});

test('the old register addresses forward to the register with their parameters, and the old dashboard to its Insights view', () => {
  for (const alias of ['/erm/risks/list', '/erm/risks/dashboard']) assert.equal(routes.find((r) => r.path === alias)?.aliasOf, '/erm/risks', alias);
  assert.match(read('risks/list/page.tsx'), /redirect\(`\/erm\/risks\$\{qs \? `\?\$\{qs\}` : ''\}`\)/);
  assert.match(read('risks/list/page.tsx'), /searchParams/);
  assert.match(read('risks/dashboard/page.tsx'), /redirect\('\/erm\/risks\?view=insights'\)/);
});

test('the register page itself is one component and the dead pieces are gone', () => {
  assert.match(read('risks/page.tsx'), /<RiskRegister \/>/);
  for (const gone of ['../../../components/risks/NcaRiskRegisterTab.tsx', '../../../components/risks/RiskViewSwitcher.tsx', '../../../components/dashboard/erm/types.ts']) {
    assert.throws(() => read(gone), /ENOENT/, `${gone} was deleted`);
  }
});
