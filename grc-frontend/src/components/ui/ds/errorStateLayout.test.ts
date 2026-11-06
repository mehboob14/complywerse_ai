// node --test "src/components/ui/ds/errorStateLayout.test.ts"
// Source-text contract for the compact ErrorState (there is no React renderer in this repo). Found by the style guide's accessibility probe: in a
// narrow card the words sat in a `flex-1 min-w-0` column beside Retry, which `flex-wrap` never moved below them, so "Couldn't load documents"
// was drawn a word, then a letter, per line. The icon and the words are now ONE item that asks for 12rem, so only Retry gives way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ErrorState.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const start = source.indexOf('if (compact)');
const compact = source.slice(start, source.indexOf('\n  return (', start));               // the compact branch: from its `if` to the framed state's `return`

test('compact: the icon and the words are one item with a basis, so Retry is what wraps', () => {
  assert.match(compact, /flex flex-wrap items-start gap-\[12px\]/);                                   // the row that wraps
  assert.match(compact, /<div className="flex min-w-0 flex-1 basis-\[12rem\] items-start gap-\[12px\]">/);   // icon + words together
  const group = compact.indexOf('basis-[12rem]');
  assert.ok(group > 0 && group < compact.indexOf('<AlertTriangle') && compact.indexOf('<AlertTriangle') < compact.indexOf('{retry}'), 'the icon is inside the group and Retry is outside it');
  assert.doesNotMatch(compact, /<\/div>\s*<div className="min-w-0 flex-1">\s*<p/);                      // the old shape: the words as their own flex-1 sibling of the icon
});

test('compact is still an alert with the title, the optional message and Retry', () => {
  assert.match(compact, /role="alert"/);
  assert.match(compact, /\{title\}/);
  assert.match(compact, /\{message && /);
  assert.match(compact, /\{retry\}/);
});
