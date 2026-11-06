// node --test "src/app/(dashboard)/governance/documents/overview/overviewPage.test.ts"
// What the Documents Overview page promises, read from its sources (the repo's habit for pages, like libraryKit.test.ts): it stays on the design-system kit and holds
// its token rules, every number is a Figure (a link to the library, or text) with a name a screen reader can read, a wait is a skeleton and a failure is "Unavailable"
// with Retry (never a 0), the scope is in the address and has a name, and no screen names a model or a vendor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const DIR = new URL('./', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const files = readdirSync(DIR).filter((n) => /\.tsx?$/.test(n) && !/\.test\.ts$/.test(n));
const tsx = files.filter((n) => n.endsWith('.tsx'));
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the page is on the kit: its files hold the token rules (no named text size, palette colour, hex, named shadow or radius, no text under 12px)', () => {
  const found: string[] = [];
  for (const name of tsx) for (const v of findViolations(read(name))) found.push(`${name}:${v.line} ${v.rule} ${v.text}`);
  assert.deepEqual(found, []);
});

test('the page has left the legacy governance scope, and no screen names a model or a vendor', () => {
  for (const name of files) {
    assert.ok(!/governance-light/.test(read(name)), name);
    assert.ok(!/\b(gpt|openai|anthropic|claude)\b/i.test(read(name)), name);
  }
});

test('every number is a Figure; the page and its cards draw no bare count of their own', () => {
  const sections = code(read('_Sections.tsx'));
  const figures = sections.match(/<Figure\b[^>]*>/g) ?? [];
  assert.ok(figures.length >= 10, `${figures.length} figures`);
  for (const tag of figures) assert.ok(/\bnoun=/.test(tag) && /\bvalue=/.test(tag) && /\bhref=/.test(tag), tag);       // each says what it counts, and where it opens (or null: text)
  assert.ok(!/>\s*\{(?:data|row|b|r|step|stage)\.[A-Za-z_.]*(?:count|pending|overdue|in_force|inForce|dueSoon)\}\s*</.test(sections), 'a count printed as text, without a Figure');
  const figure = code(read('_Figure.tsx'));
  assert.ok(figure.includes('figureName(value, noun)') && figure.includes('formatCount(value)'));
  assert.ok(figure.includes("value === 0 ? 'text-ds-fg-muted'"), 'a zero is quiet');
  assert.ok(figure.includes('focus-visible:shadow-ds-ring'), 'a link shows where the keyboard is');
});

test('the tiles are the kit\'s StatTile: a skeleton while loading, a link on every figure, and the two that jump point at sections of the page', () => {
  const tiles = code(read('_Tiles.tsx'));
  assert.ok(tiles.includes('<StatTile') && tiles.includes('loading') && tiles.includes('link={t.href ?'));
  assert.ok(tiles.includes('tileLinkName(t)'));
  const sections = code(read('_Sections.tsx'));
  for (const id of ['departments', 'types', 'status', 'waiting', 'reviews', 'issues']) assert.ok(sections.includes(`id="${id}"`), id);
});

test('the lists are the kit\'s: the steps waiting longest are a RegisterTable (cards below 768px) whose rows open the document in the library', () => {
  const sections = code(read('_Sections.tsx'));
  assert.ok(sections.includes('<RegisterTable<WaitingRow>') && sections.includes('caption="Steps waiting longest"'));
  assert.ok(sections.includes('openHref(r.document_id)'));
  assert.ok(sections.includes('isRowHeader: true'));
  assert.ok(!/<table\b|<th\b|<thead\b|<td\b/.test(sections), 'no bare table elements: the kit\'s primitives');
  assert.ok(sections.includes('Nothing is late'), 'an empty list says so');
});

test('the department table is the kit\'s RegisterTable, shown first and only when there is more than one department, and its names open the department\'s own overview', () => {
  const sections = code(read('_Sections.tsx'));
  assert.ok(sections.includes('<RegisterTable<DepartmentLine>') && sections.includes('caption="Documents by department"'));
  assert.ok(sections.includes('hasDepartmentTable(data) &&'), 'a unit with nothing under it has no table');
  assert.ok(sections.indexOf('<ByDepartment data={data} />') < sections.indexOf('<ByType data={data} />'), 'the top-to-bottom view comes first');
  assert.ok(sections.includes('href={line.open}') && sections.includes('departmentLines(data)'));
  assert.ok(/opens=\{l\.here \? 'Go to the list below' : 'Open its overview'\}/.test(sections), 'the Issues figure says where it leads');
  assert.ok(sections.includes('cardTitle={(l) => <DepartmentName line={l} flat />}'), 'a phone shows each department as a card');
});

test('a bar is only a picture: hidden from a screen reader, the numbers beside it are what is read', () => {
  const sections = code(read('_Sections.tsx'));
  const bars = sections.split('\n').filter((l) => /style=\{\{ width:/.test(l));
  assert.ok(bars.length >= 2, `${bars.length} bars`);                                                                // a type's bar and a review state's segment
  for (const l of bars) assert.ok(!/role="progressbar"/.test(l));
  assert.ok((sections.match(/aria-hidden className="(?:block|mb-\[12px\] flex)/g) ?? []).length >= 2, 'their containers are aria-hidden');
});

test('a wait is a skeleton and a failure is "Unavailable" with Retry, never a 0; a refusal says so and offers the way out', () => {
  const page = code(read('page.tsx'));
  assert.ok(page.includes('query.isPending') && page.includes('<TilesSkeleton />') && page.includes('<CardsSkeleton />'));
  assert.ok(page.includes('<ErrorState title="Unavailable"') && page.includes('onRetry={canRetry(query.error)'));
  assert.ok(page.includes('<NoAccessState title="No access"') && page.includes('title="Not your department"') && page.includes('title="Department not found"'));
  assert.ok(page.includes('Show mine'), 'a department that is not yours (or gone) is left with one button to the own scope');
  assert.ok(page.includes('What is shown may be out of date.'), 'a refresh that failed says the figures may be old');
  assert.ok(page.includes('<EmptyState kind="firstUse"') && page.includes('Open library'), 'an empty scope has one button to the library');
  assert.ok(code(read('_Tiles.tsx')).includes('loading />') || code(read('_Tiles.tsx')).includes(' loading '), 'the tiles say they are loading');
  assert.ok(!/\?\?\s*0\b|\|\|\s*0\b/.test(page), 'the page never turns a missing answer into 0');
});

test('the scope is in the address and has a name: ?dept=, a picker that names every department by its path, kept while another scope loads', () => {
  const page = code(read('page.tsx'));
  assert.ok(page.includes('dept: text()') && page.includes('useAddressState(ADDRESS)') && page.includes('setAddress({ dept: e.target.value })'));
  assert.ok(page.includes('<Select aria-label="Scope"'), 'the picker has a name');
  assert.ok(page.includes('scopeOptions(choices)') && page.includes('setOffered(data.choices)'));
  assert.ok(page.includes("export const dynamic = 'force-dynamic'"), 'like the library: the address is read on the client');
  assert.ok(page.includes('<PageHeader') && page.includes('variant="page"'));
  assert.ok(page.includes("routeFor('/governance/documents/overview')"), 'the title is the registry\'s name');
});

test('only the server\'s numbers are shown: the page reads one endpoint and the library; it writes nothing', () => {
  const all = files.map((n) => code(read(n))).join('\n');
  assert.ok(!/\.(post|put|patch|delete)\(/.test(all), 'a read-only page');
  assert.equal((all.match(/apiClient\.get\(/g) ?? []).length, 1);
  assert.ok(code(read('_model.ts')).includes("export const ENDPOINT = '/governance/document-overview'"));
});
