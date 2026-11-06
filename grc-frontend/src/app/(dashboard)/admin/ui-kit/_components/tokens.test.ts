// node --test "src/app/(dashboard)/admin/ui-kit/_components/tokens.test.ts"
// The style guide's token page against styles/tokens.css: a token nobody listed fails here, a listed token the file lost fails here, and the
// ratios the guide prints are the ones the contrast test holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ALL_SHOWN, SWATCH_GROUPS, formatRatio, needs, pairRows, partnerOf } from './tokens.ts';
import { TOKEN_PAIRS } from '../../../../../lib/dsTokenPairs.ts';

const css = readFileSync('styles/tokens.css', 'utf8');
const values: Record<string, string> = {};
for (const m of Array.from(css.matchAll(/--(ds-[a-z0-9-]+)\s*:\s*([^;]+);/g))) values[m[1]] = m[2].trim();

test('every --ds token is on the page, and nothing is listed that the file does not define', () => {
  const defined = Object.keys(values).sort();
  assert.deepEqual(defined.filter((n) => !ALL_SHOWN.includes(n)), [], 'a token the guide does not show');
  assert.deepEqual(ALL_SHOWN.filter((n) => !(n in values)), [], 'a token the guide shows and the file does not define');
  assert.equal(new Set(ALL_SHOWN).size, ALL_SHOWN.length, 'a token listed twice');
});

test('every pair of the contrast list is a token the guide shows, and passes with the values in the file', () => {
  const rows = pairRows(values);
  assert.equal(rows.length, TOKEN_PAIRS.length);
  assert.deepEqual(rows.filter((r) => r.ratio === null).map((r) => `${r.fg} on ${r.bg}`), [], 'a pair with no ratio');
  assert.deepEqual(rows.filter((r) => r.pass !== true).map((r) => `${r.fg} on ${r.bg}: ${formatRatio(r.ratio)} < ${needs(r.min)}`), []);
  for (const r of rows) for (const token of [r.fg, r.bg]) assert.ok(ALL_SHOWN.includes(token), `${token} is in a pair and not on the page`);
});

test('a ratio is cut, never rounded up; a value that is not a hex colour has no ratio', () => {
  assert.equal(formatRatio(4.49), '4.4:1');
  assert.equal(formatRatio(4.5), '4.5:1');
  assert.equal(formatRatio(14.19), '14.1:1');
  assert.equal(formatRatio(null), '—');
  const row = pairRows({ a: 'rgba(0,0,0,0.5)', b: '#fff' }, [['a', 'b', 4.5]])[0];
  assert.equal(row.ratio, null);
  assert.equal(row.pass, null);
  assert.equal(pairRows({ a: '#000', b: '#fff' }, [['a', 'b', 4.5]])[0].pass, true);
  assert.equal(pairRows({ a: '#777', b: '#fff' }, [['a', 'b', 4.5]])[0].pass, false);        // 4.48: the classic near miss
});

test('a swatch finds the pair it is checked in; a decorative token has none', () => {
  assert.deepEqual(partnerOf('ds-on-primary'), { fg: 'ds-on-primary', bg: 'ds-primary', min: 4.5 });
  assert.deepEqual(partnerOf('ds-surface-subtle'), { fg: 'ds-fg', bg: 'ds-surface-subtle', min: 4.5 });
  assert.equal(partnerOf('ds-border-strong'), null);
  assert.equal(partnerOf('ds-scrim'), null);
});

test('the groups have a title and a use for every swatch', () => {
  for (const g of SWATCH_GROUPS) {
    assert.ok(g.title && g.swatches.length > 0);
    for (const s of g.swatches) assert.ok(s.use.length > 8, s.token);
  }
});
