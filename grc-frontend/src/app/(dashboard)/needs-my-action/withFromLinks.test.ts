// node --test "src/app/(dashboard)/needs-my-action/withFromLinks.test.ts"
// Every link of the Needs my action page that opens a record carries the page it was opened from (`?from=`, the shell's withFrom): the menu keeps Needs my action lit for a person who has
// no entry for the record, and the trail names the queue as the way back. The page's address (`here`) is read once, by the page, and handed down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { withFrom } from '../../../components/shell/withFrom.ts';

const PAGE = 'src/app/(dashboard)/needs-my-action';
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const read = (file: string) => code(readFileSync(`${PAGE}/${file}`, 'utf8'));
/** What follows each `href={` of a source: the first characters are enough to see whether the address goes through withFrom. */
const hrefsOf = (src: string) => src.split('href={').slice(1).map((rest) => rest.slice(0, 48));

test('a link that opens a record is the record\'s address plus ?from= this page (and keeps what it already asked for)', () => {
  assert.equal(withFrom('/governance/documents/47?act=sign', '/needs-my-action'), '/governance/documents/47?act=sign&from=%2Fneeds-my-action');
  assert.equal(withFrom('/compliance/assessments/approvals', '/needs-my-action?section=ack'), '/compliance/assessments/approvals?from=%2Fneeds-my-action%3Fsection%3Dack');
});

test('every href of the row and of the dialog goes through withFrom: the row link, the extra links, "See what changed", "Read the document", "Open the assessment approval"', () => {
  for (const [file, count] of [['_InboxRow.tsx', 2], ['_DecisionDialog.tsx', 3]] as const) {
    const src = read(file);
    assert.match(src, /import \{ withFrom \} from '@\/components\/shell\/withFrom'/, file);
    const hrefs = hrefsOf(src);
    assert.equal(hrefs.length, count, `${file}: the links it draws`);
    hrefs.forEach((h) => assert.ok(h.startsWith('withFrom('), `${file}: ${h}`));
  }
  assert.match(read('_InboxRow.tsx'), /withFrom\(item\.href, here\)/);
  assert.match(read('_InboxRow.tsx'), /withFrom\(link\.href, here\)/);
  const dialog = read('_DecisionDialog.tsx');
  assert.match(dialog, /withFrom\(changes, here\)/);
  assert.match(dialog, /withFrom\(`\/governance\/documents\/\$\{documentId\}`, here\)/);
  assert.match(dialog, /withFrom\(item\.href, here\)/);
});

test('the page reads its own address once (without how it was opened) and hands it to the sections and the dialog', () => {
  const page = read('page.tsx');
  assert.match(page, /const here = useHere\(\)/);
  assert.match(page, /<InboxSection[\s\S]*?here=\{here\}[\s\S]*?\/>/);
  assert.match(page, /<DecisionDialog[\s\S]*?here=\{here\}[\s\S]*?\/>/);
  assert.match(read('_Section.tsx'), /<InboxRow item=\{item\} now=\{now\} here=\{here\} onOpen=\{onOpenItem\} \/>/);
  const hook = readFileSync('src/components/shell/useShellRoute.ts', 'utf8');
  assert.match(hook, /export function useHere\(\): string/);
  assert.match(hook, /cleanQuery\(search\)/, 'a `from` of its own would nest: the parameters that only say how the page was opened are dropped');
});
