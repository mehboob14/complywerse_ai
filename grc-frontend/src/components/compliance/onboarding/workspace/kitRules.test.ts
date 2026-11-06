// node --test "src/components/compliance/onboarding/workspace/kitRules.test.ts"
// The onboarding register, workspace and gate notices are built on the design-system kit, so they follow its rules (components/ui/ds/kitRules.ts): no palette
// class, named text size, named radius or shadow, no bare outline-none. The kit guard reads only the kit's own folder; this reads these three.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { findViolations } from '../../../ui/ds/kitRules.ts';

const BASE = 'src/components/compliance/onboarding';

for (const dir of ['register', 'workspace', 'gate']) {
  test(`every screen of onboarding/${dir} follows the kit rules`, () => {
    const files = readdirSync(`${BASE}/${dir}`).filter((n) => /\.tsx$/.test(n));
    assert.ok(files.length >= 1, 'the screens are there');
    const bad = files.flatMap((n) => findViolations(readFileSync(`${BASE}/${dir}/${n}`, 'utf8')).map((v) => `${n}:${v.line} ${v.rule}: ${v.text}`));
    assert.deepEqual(bad, []);
  });
}
