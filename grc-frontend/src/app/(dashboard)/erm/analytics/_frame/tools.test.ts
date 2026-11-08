// node --test "src/app/(dashboard)/erm/analytics/_frame/tools.test.ts"
// The Analytics strip: six tools in order, every address that ever opened one still opens it, and each tool has a page file that draws the frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TOOLS, toolFor } from './tools.ts';

const FOLDER = fileURLToPath(new URL('../', import.meta.url));

test('six tools in the order of the strip, each with its own address', () => {
  assert.deepEqual(TOOLS.map((t) => t.label), ['Heat map', 'Aggregation', 'Scenario', 'Bow-tie', 'KRI triggers', 'Dependencies']);
  assert.equal(new Set(TOOLS.map((t) => t.href)).size, TOOLS.length);
});

test('every address that opened a tool before still opens it, a trailing slash included', () => {
  const at: Array<[string, string | null]> = [
    ['/erm/analytics', 'heatmap'], ['/erm/analytics/heatmap', 'heatmap'], ['/erm/analytics/aggregation', 'aggregation'], ['/erm/analytics/scenario', 'scenario'],
    ['/erm/analytics/bowtie', 'bowtie'], ['/erm/analytics/kri-triggers', 'kri-triggers'], ['/erm/dependencies', 'dependencies'], ['/erm/analytics/dependencies', 'dependencies'],
    ['/erm/analytics/', 'heatmap'], ['/erm/risks', null], [null as unknown as string, null],
  ];
  at.forEach(([path, tool]) => assert.equal(toolFor(path)?.key ?? null, tool, String(path)));
});

test('every tool has a page that draws the frame for it, and the frame draws the kit\'s page head', () => {
  TOOLS.forEach((t) => {
    const rel = t.href === '/erm/analytics' ? '' : t.href.replace('/erm/analytics/', '');
    const file = `${FOLDER}${rel ? `${rel}/` : ''}page.tsx`;
    assert.ok(existsSync(file), `${t.href} has a page.tsx`);
    assert.match(readFileSync(file, 'utf8'), new RegExp(`<AnalyticsFrame\\s+tool="${t.key}"`), `${t.href}: draws the frame for ${t.key}`);
  });
  assert.ok(existsSync(`${FOLDER}heatmap/page.tsx`), '/erm/analytics/heatmap still has a page');
  assert.match(readFileSync(`${FOLDER}_frame/AnalyticsFrame.tsx`, 'utf8'), /<PageHeader\s+variant="page"/);
});
