// node --test "src/components/ui/ds/useTabParam.test.ts"
// Source-text contract for the useTabParam hook (there is no React renderer in this repo; the address rules are in lib/tabsModel.ts and tested there).
// Found by the style guide's accessibility probe: the open tab was read from the address only, and the router's replace is a round trip, so for
// 200 to 300 ms (measured on a local dev server) the tab the keyboard had moved to was not selected and the old panel was still showing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./useTabParam.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

test('a pick is shown at once and the address catches up after it', () => {
  assert.match(source, /const \[picked, setPicked\] = useState<K \| null>\(null\);/);
  assert.match(source, /setPicked\(key\);\n\s*const next = withTab\(search, paramName, key, fallback\);/);      // before the router is asked
  assert.match(source, /router\.replace\(next \? `\$\{pathname\}\?\$\{next\}` : pathname, \{ scroll: false \}\);/);
  assert.match(source, /return \[picked \?\? fromAddress, select\];/);
});

test('when the address changes (the router caught up, Back, a link) it is the truth again', () => {
  assert.match(source, /useEffect\(\(\) => \{ setPicked\(null\); \}, \[search\]\);/);
  assert.match(source, /const fromAddress = resolveTab\(search, paramName, keys, aliases, fallback\) as K;/);
});
