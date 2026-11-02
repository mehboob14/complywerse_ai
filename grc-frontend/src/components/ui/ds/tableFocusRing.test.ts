// node --test "src/components/ui/ds/tableFocusRing.test.ts"
// Source-text contract for where the table kit draws its focus rings (there is no React renderer in this repo). Found by the style guide's accessibility
// probe: the sort button of a header cell sits 2px below the top of the scrolling frame, so its 4px outer ring had its outer 2px cut off by the frame.
// Anything that can sit against the frame's edge draws its ring inside itself; only the frame draws an outer one (around itself, where nothing clips it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Table.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

test('the sort header button draws its focus ring inside itself', () => {
  const line = source.split('\n').find((l) => l.includes('const SORT_BUTTON')) ?? '';
  assert.match(line, /focus-visible:shadow-\[inset_0_0_0_2px_var\(--ds-focus\)\]/);
  assert.doesNotMatch(line, /focus-visible:shadow-ds-ring/);
});

test('the only outer ring in the table kit is the frame\'s own, and a pressable row takes an outline inside itself', () => {
  const outer = source.split('\n').filter((l) => l.includes('focus-visible:shadow-ds-ring'));
  assert.equal(outer.length, 1);
  assert.match(outer[0], /overflow-auto rounded-ds-card border border-ds-border bg-ds-surface/);                      // TableFrame
  assert.match(source, /ROW_PRESSABLE = 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2/);
});
