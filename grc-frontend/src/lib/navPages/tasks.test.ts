// node --test "src/lib/navPages/tasks.test.ts"
// The Task Management group's entries in the navigation registry: every page of its folders has exactly one entry, every entry that says its page draws its own heading has a page that does, the
// page's heading is the entry's label, and the top bar names only the section (nothing on the module's top page, which says its name in its body).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { breadcrumbFor, ownHeadingSection, registryNamesPage, routeFor, routes, titleFor } from '../navRegistry.ts';
import { LEAVES, PAGES } from './tasks.ts';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));

/** `tasks/[id]/page.tsx` -> `/tasks/:id` for every page of a folder of the app (the helper of navRegistry.test.ts). */
function pagesOf(folder: string, base: string): string[] {
  return (readdirSync(`${APP}${folder}`, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
    .map((file) => `${base}${file.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`.replace(/\[([A-Za-z]+)\]/g, ':$1'));
}

const pages = [...pagesOf('(dashboard)/tasks', '/tasks'), ...pagesOf('(dashboard)/my-work', '/my-work')];
/** the page file of a registry path of this group */
const FILE: Record<string, string> = {
  '/tasks': '(dashboard)/tasks/page.tsx',
  '/tasks/:id': '(dashboard)/tasks/[id]/page.tsx',
  '/tasks/reports': '(dashboard)/tasks/reports/page.tsx',
  '/tasks/my-tasks': '(dashboard)/tasks/my-tasks/page.tsx',
  '/tasks/sla': '(dashboard)/tasks/sla/page.tsx',
  '/my-work': '(dashboard)/my-work/page.tsx',
};

test('every page of the Tasks and My Work folders is exactly one entry, and every entry of this group is a page', () => {
  assert.deepEqual(pages.slice().sort(), Object.keys(FILE).sort(), 'the six pages of the group');
  for (const page of pages) assert.equal(routes.filter((e) => e.path === page).length, 1, page);
  for (const spec of PAGES) assert.ok(pages.includes(spec.path), `${spec.path} has no page.tsx`);
  assert.ok(Object.keys(LEAVES).every((href) => pages.includes(href)), 'the leaf is a page');
});

test('the group\'s entries: the sidebar leaf says its heading, the other five hang under Task Management and say where they open from', () => {
  assert.deepEqual(Object.keys(LEAVES), ['/tasks']);
  assert.deepEqual(PAGES.map((p) => p.path).sort(), ['/my-work', '/tasks/:id', '/tasks/my-tasks', '/tasks/reports', '/tasks/sla']);
  for (const spec of PAGES) {
    assert.equal(spec.area, 'task-management', spec.path);
    assert.equal(spec.parent, '/tasks', spec.path);
    assert.ok(spec.hidden && spec.hidden.length > 20, `${spec.path}: where it opens from`);
  }
  assert.equal(routeFor('/tasks')?.label, 'Task Management', 'the sidebar\'s name');
  assert.deepEqual(PAGES.map((p) => p.label).sort(), ['My tasks', 'My work', 'Task', 'Task SLA levels', 'Task reports']);
});

test('every entry that says its page draws its own heading has a page that renders the kit head (PageHeader variant="page"), and the other way round', () => {
  const flagged = routes.filter((e) => e.area === 'task-management' && (e.path === '/tasks' || e.path.startsWith('/tasks/') || e.path === '/my-work') && e.ownHeading).map((e) => e.path);
  assert.deepEqual(flagged.sort(), Object.keys(FILE).sort(), 'all six pages draw their own head');
  for (const path of flagged) {
    const source = readFileSync(`${APP}${FILE[path]}`, 'utf8');
    assert.match(source, /<PageHeader[\s\S]{0,40}variant="page"/, `${path}: ${FILE[path]}`);
  }
});

test('the heading of a page is its registry label (the task page keeps the task\'s own title)', () => {
  for (const path of ['/tasks', '/tasks/reports', '/tasks/my-tasks', '/tasks/sla', '/my-work']) {
    const source = readFileSync(`${APP}${FILE[path]}`, 'utf8');
    assert.match(source, new RegExp(`routeFor\\('${path}'\\)\\?\\.label`), `${path} reads its heading from the registry`);
  }
});

test('the top bar names only the section: nothing on the module\'s top page, "Task Management" on its other pages', () => {
  assert.equal(ownHeadingSection('/tasks'), '');
  for (const url of ['/tasks/7', '/tasks/reports', '/tasks/my-tasks', '/tasks/sla', '/my-work']) assert.equal(ownHeadingSection(url), 'Task Management', url);
  for (const url of ['/tasks', '/tasks/7', '/my-work']) assert.equal(registryNamesPage(url), true, url);
  assert.equal(titleFor('/tasks'), 'Task Management');
  assert.equal(titleFor('/my-work'), 'My work');
  const trail = breadcrumbFor('/tasks/7');
  assert.equal(trail[0].label, 'Task Management');
  assert.equal(trail[trail.length - 1].label, 'Task');
});
