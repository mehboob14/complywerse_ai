// node --test "src/components/compliance/scoping/kitRules.test.ts"
// The scoping screens are built on the design-system kit, so they follow its rules (components/ui/ds/kitRules.ts): no palette class, named text size,
// named radius or shadow, no bare outline-none. The kit guard reads only the kit's own folder; this reads this one and the NIST assessments' folder inside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { findViolations } from '../../ui/ds/kitRules.ts';

const DIR = 'src/components/compliance/scoping';
const DIRS = [DIR, `${DIR}/nist`];

test('every screen of the scoping folders follows the kit rules', () => {
  const files = DIRS.flatMap((d) => readdirSync(d).filter((n) => /\.tsx$/.test(n)).map((n) => `${d}/${n}`));
  assert.ok(files.length >= 12, 'the screens are there');
  assert.ok(files.some((f) => f.includes('/nist/')), 'the NIST screens are read');
  const bad = files.flatMap((f) => findViolations(readFileSync(f, 'utf8')).map((v) => `${f.slice(DIR.length + 1)}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});
