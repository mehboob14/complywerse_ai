// node --test "src/components/compliance/scoping/kitRules.test.ts"
// The scoping screens are built on the design-system kit, so they follow its rules (components/ui/ds/kitRules.ts): no palette class, named text size,
// named radius or shadow, no bare outline-none. The kit guard reads only the kit's own folder; this reads this one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { findViolations } from '../../ui/ds/kitRules.ts';

const DIR = 'src/components/compliance/scoping';

test('every screen of the scoping folder follows the kit rules', () => {
  const files = readdirSync(DIR).filter((n) => /\.tsx$/.test(n));
  assert.ok(files.length >= 7, 'the screens are there');
  const bad = files.flatMap((n) => findViolations(readFileSync(`${DIR}/${n}`, 'utf8')).map((v) => `${n}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});
