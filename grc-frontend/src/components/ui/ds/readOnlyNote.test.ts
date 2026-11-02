// node --test "src/components/ui/ds/readOnlyNote.test.ts"
// ReadOnlyNote: the notice of a view-only page or card. No renderer here, so the markup it promises is read from source; how it looks was checked
// in a browser next to the two copies it replaced (Governance Settings: the page head and the Departments card): the same pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from './kitRules.ts';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const source = read('src/components/ui/ds/ReadOnlyNote.tsx');

test('it is a note with a lock that the reader skips and the page\'s own words after it', () => {
  assert.ok(source.startsWith("'use client';"));
  assert.match(source, /<span role="note" className="[^"]*">/);
  assert.match(source, /<Lock size=\{14\} aria-hidden className="shrink-0" \/>\s*\{children\}/);                  // shrink-0: words that wrap squeezed the lock to 5px
  assert.match(source, /children: ReactNode;/);                                    // the words are the page's: it prints none of its own
  assert.ok(!/View only/.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no words of its own in the code (a comment may show an example)');
});

test('it is a line of facts: inline, in the muted words colour at the body size, tokens only', () => {
  const classes = /<span role="note" className="([^"]*)"/.exec(source)?.[1] ?? '';
  for (const c of ['inline-flex', 'items-center', 'gap-[6px]', 'text-ds-body', 'text-ds-fg-muted']) assert.ok(classes.split(' ').includes(c), c);
  assert.deepEqual(findViolations(source), []);
});

test('it is exported from the kit index and from the ui barrel', () => {
  assert.match(read('src/components/ui/ds/index.ts'), /export \{ ReadOnlyNote, type ReadOnlyNoteProps \} from '\.\/ReadOnlyNote';/);
  assert.match(read('src/components/ui/index.ts'), /export \{ ReadOnlyNote, type ReadOnlyNoteProps \} from '\.\/ds\/ReadOnlyNote';/);
});

test('Governance Settings uses it for both of its view-only notices, with the words it always had, and keeps no copy of its own', () => {
  const page = read('src/app/(dashboard)/governance/settings/page.tsx');
  const section = read('src/app/(dashboard)/governance/settings/_DepartmentsSection.tsx');
  assert.match(page, /<ReadOnlyNote>\s*View only\s*<InfoTip text="Only an administrator, or someone given the Governance Settings right, can change them\." label="Why these settings are view only" \/>\s*<\/ReadOnlyNote>/);
  assert.match(section, /<ReadOnlyNote>\s*View only\s*<InfoTip text="Only an administrator, or someone whose role lets them edit the organisation, can add or change departments\." label="Why departments are view only" \/>\s*<\/ReadOnlyNote>/);
  for (const [name, text] of [['page', page], ['section', section]] as const) {
    assert.doesNotMatch(text, /<Lock size=\{14\}/, `${name}: the lock is the note's`);
  }
});
