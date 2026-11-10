// node --test "src/lib/navPages/complychat.test.ts"
// Comply Agent in the navigation registry: the one page of the folder has exactly one entry, no sidebar leaf (the top bar opens it), the right the page checks,
// and it draws the kit's head from its chat component, so the top bar names nothing and the name is on screen once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ownHeadingSection, routeFor, routes } from '../navRegistry.ts';
import { navPermissions } from '../../components/layout/navAccess.ts';
import { LEAVES, PAGES } from './complychat.ts';

const APP = fileURLToPath(new URL('../../app/(dashboard)/complychat/', import.meta.url));
const read = (file: string) => readFileSync(`${APP}${file}`, 'utf8');

test('the folder holds one page and the registry has exactly one entry for it, with no sidebar leaf', () => {
  const pages = (readdirSync(APP, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'));
  assert.deepEqual(pages, ['page.tsx']);
  assert.equal(routes.filter((e) => e.path === '/complychat').length, 1);
  assert.deepEqual(Object.keys(LEAVES), []);
  assert.deepEqual(PAGES.map((p) => p.path), ['/complychat']);
});

test('the entry says where it opens from, and the page checks the right the registry gives it', () => {
  const entry = routeFor('/complychat');
  assert.equal(entry?.label, 'Comply Agent');
  assert.match(entry?.hidden ?? '', /top bar/);
  assert.deepEqual(entry?.permissions, ['dashboard:ai_insights:view']);
  assert.deepEqual(navPermissions('/complychat'), ['dashboard:ai_insights:view']);
  assert.match(read('page.tsx'), /navPermissions\('\/complychat'\)/);
});

test('the page draws the kit head, so the entry is flagged and the top bar names nothing; the head says the entry\'s name', () => {
  assert.equal(routeFor('/complychat')?.ownHeading, true);
  assert.equal(ownHeadingSection('/complychat'), '', 'its section is its own name');
  const chat = read('_chat/ChatPage.tsx');
  assert.match(chat, /<PageHeader[\s\S]{0,80}variant="page"/);
  assert.match(chat, /title="Comply Agent"/);
});

test('the top bar\'s box still lands on the page with the question in `q`, and the page reads it', () => {
  const header = readFileSync(fileURLToPath(new URL('../../components/layout/Header.tsx', import.meta.url)), 'utf8');
  assert.match(header, /\/complychat\?q=\$\{encodeURIComponent\(q\)\}/);
  assert.match(read('_chat/ChatPage.tsx'), /questionFromAddress\(search\.toString\(\)\)/);
});
