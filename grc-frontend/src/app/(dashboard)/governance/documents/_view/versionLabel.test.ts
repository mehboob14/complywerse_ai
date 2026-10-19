import { test } from 'node:test';
import assert from 'node:assert/strict';

import { versionLabel } from './versionLabel.ts';

test('"v" only before a bare number; any other version as it is given', () => {
  assert.equal(versionLabel('8.0'), 'v8.0');
  assert.equal(versionLabel('2'), 'v2');
  assert.equal(versionLabel(4), 'v4');
  assert.equal(versionLabel(' 2.1.3 '), 'v2.1.3');
  assert.equal(versionLabel('v8.0'), 'v8.0');
  assert.equal(versionLabel('Regulation (EU) 2022/2554'), 'Regulation (EU) 2022/2554');
  assert.equal(versionLabel('First edition 2023-12'), 'First edition 2023-12');
  assert.equal(versionLabel(''), '');
  assert.equal(versionLabel(null), '');
});
