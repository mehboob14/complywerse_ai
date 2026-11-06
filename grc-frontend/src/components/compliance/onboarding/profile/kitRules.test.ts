// node --test "src/components/compliance/onboarding/profile/kitRules.test.ts"
// The field inputs and the organisation profile are built on the design-system kit, so they follow its rules (components/ui/ds/kitRules.ts): no palette class, named
// text size, named radius or shadow, no bare outline-none. The kit guard reads only the kit's own folder; this reads these. A bare <p>, <td>, <th>, <h2> or <h3> gets the
// platform's 11.5px and dark text (PITFALLS 100), so each of those here names a text size (the full scanner of ds/bareText.test.ts was run over these files too).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { findViolations } from '../../../ui/ds/kitRules.ts';

const ROOT = 'src/components/compliance/onboarding';
const FOLDERS = [`${ROOT}/inputs`, `${ROOT}/profile`];
const FILES = [`${ROOT}/FieldInput.tsx`, `${ROOT}/FieldBlock.tsx`, `${ROOT}/SourceChip.tsx`, 'src/app/(dashboard)/compliance/organisation/page.tsx'];

const mine = (): string[] => [...FOLDERS.flatMap((d) => readdirSync(d).filter((n) => /\.tsx$/.test(n)).map((n) => `${d}/${n}`)), ...FILES];

test('every file of the field inputs and the organisation profile follows the kit rules', () => {
  const files = mine();
  assert.ok(files.length >= 12, 'the screens are there');
  const bad = files.flatMap((f) => findViolations(readFileSync(f, 'utf8')).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no <p>, <td>, <th>, <h2> or <h3> is bare: each names a text size', () => {
  const bad = mine().flatMap((f) => Array.from(readFileSync(f, 'utf8').matchAll(/<(p|td|th|h2|h3)\b([^>]*)>/g))
    .filter((m) => !/(^|[\s"'`!])text-(ds-(title|section|body|label)|\[\d)/.test(m[2]))
    .map((m) => `${f}: <${m[1]}${m[2].slice(0, 60)}`));
  assert.deepEqual(bad, []);
});
