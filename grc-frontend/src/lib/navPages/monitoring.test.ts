// node --test "src/lib/navPages/monitoring.test.ts"
// The Risk Management monitoring pages in the navigation registry (KRIs, Incidents, Mitigation Actions, Risk Appetite and the Advanced Analytics tools): every page.tsx of these
// folders is exactly one entry, every page that draws the kit's page head (itself, or through the Analytics frame) is flagged ownHeading, its heading is the registry's name,
// and the old addresses forward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ownHeadingSection, registryNamesPage, routeFor, routes, titleFor } from '../navRegistry.ts';

const ERM = fileURLToPath(new URL('../../app/(dashboard)/erm/', import.meta.url));
const FOLDERS = ['kris', 'incidents', 'mitigation-actions', 'appetite', 'dependencies', 'analytics'];

function pagesOf(folder: string): string[] {
  return (readdirSync(`${ERM}${folder}`, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'))
    .map((f) => `/erm/${folder}${f.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`);
}
const PAGES = FOLDERS.flatMap(pagesOf);
const fileOf = (path: string) => readFileSync(`${ERM}${path.replace('/erm/', '')}/page.tsx`, 'utf8');

test('every page.tsx of the monitoring folders is exactly one registry entry', () => {
  assert.deepEqual(PAGES.slice().sort(), [
    '/erm/analytics', '/erm/analytics/aggregation', '/erm/analytics/bowtie', '/erm/analytics/dependencies', '/erm/analytics/heatmap', '/erm/analytics/kri-triggers', '/erm/analytics/scenario',
    '/erm/appetite', '/erm/dependencies', '/erm/incidents', '/erm/kris', '/erm/mitigation-actions',
  ].map((p) => p));
  PAGES.forEach((page) => assert.equal(routes.filter((e) => e.path === page).length, 1, page));
});

test('the pages that draw a head are flagged ownHeading, and each really draws the kit\'s page head', () => {
  const direct = ['/erm/kris', '/erm/incidents', '/erm/mitigation-actions', '/erm/appetite'];
  const tools = ['/erm/analytics', '/erm/analytics/aggregation', '/erm/analytics/bowtie', '/erm/analytics/dependencies', '/erm/analytics/kri-triggers', '/erm/analytics/scenario'];
  [...direct, ...tools].forEach((page) => assert.equal(routeFor(page)?.ownHeading, true, `${page}: ownHeading`));
  direct.forEach((page) => assert.match(readFileSync(`${ERM}_monitoring/${{ '/erm/kris': 'KriRegister', '/erm/incidents': 'IncidentRegister', '/erm/mitigation-actions': 'MitigationRegister', '/erm/appetite': 'AppetiteBoard' }[page]}.tsx`, 'utf8'), /<PageHeader\s+variant="page"/, page));
  assert.match(readFileSync(`${ERM}analytics/_frame/AnalyticsFrame.tsx`, 'utf8'), /<PageHeader\s+variant="page"/);
  tools.forEach((page) => assert.match(fileOf(page), /<AnalyticsFrame\s+tool="/, page));
  [...direct, ...tools].forEach((page) => assert.equal(registryNamesPage(page), true, page));
});

test('the heading of each page is its registry name (the pages read it from the registry)', () => {
  const names: Array<[string, string]> = [
    ['/erm/kris', 'KRIs'], ['/erm/incidents', 'Incidents'], ['/erm/mitigation-actions', 'Mitigation Actions'], ['/erm/appetite', 'Risk Appetite'],
    ['/erm/analytics', 'Advanced Analytics'], ['/erm/analytics/aggregation', 'Risk Aggregation'], ['/erm/analytics/scenario', 'Scenario Analysis'], ['/erm/analytics/bowtie', 'Bow-Tie Analysis'],
    ['/erm/analytics/kri-triggers', 'KRI Triggers'], ['/erm/analytics/dependencies', 'Risk Dependencies'],
  ];
  names.forEach(([path, name]) => assert.equal(routeFor(path)?.label, name, path));
  assert.match(fileOf('/erm/kris'), /routeFor\('\/erm\/kris'\)\?\.label/);
  assert.match(fileOf('/erm/incidents'), /routeFor\('\/erm\/incidents'\)\?\.label/);
  assert.match(fileOf('/erm/mitigation-actions'), /routeFor\('\/erm\/mitigation-actions'\)\?\.label/);
  assert.match(fileOf('/erm/appetite'), /routeFor\('\/erm\/appetite'\)\?\.label/);
  assert.match(readFileSync(`${ERM}analytics/_frame/AnalyticsFrame.tsx`, 'utf8'), /routeFor\(current\.href\)\?\.label/);
});

test('the top bar names only the section on these pages (the page names itself)', () => {
  PAGES.filter((p) => p !== '/erm/dependencies').forEach((page) => assert.ok(ownHeadingSection(page), `${page}: the top bar names a section`));
  assert.equal(titleFor('/erm/analytics/scenario'), 'Scenario Analysis');
});

test('the old addresses forward: Dependencies is an alias of the Analytics tool, the heat map\'s own address of the home', () => {
  assert.equal(routeFor('/erm/dependencies')?.aliasOf, '/erm/analytics/dependencies');
  assert.equal(routeFor('/erm/analytics/heatmap')?.aliasOf, '/erm/analytics');
  assert.match(fileOf('/erm/dependencies'), /redirect\(`\/erm\/analytics\/dependencies/);
  const hub = routes.filter((r) => r.path.startsWith('/erm/analytics')).map((r) => r.label);
  assert.ok(!hub.includes('Interactive Risk Heat Map') && !hub.includes('Automated KRI Triggers'), 'the cards of the old hub are no longer pages');
});
