// node --test "src/lib/statuses/catalog.test.ts"
// The words of the Control Catalog and Library: every word has a tone and a label, the words are the ones the server writes (the backend files are re-read), and an unknown word is
// neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { TONE, type Statuses } from '../status.ts';
import { CATALOG_REGISTRIES, controlSource, unifiedReview } from './catalog.ts';

const BACKEND = new URL('../../../../backend/grc/', import.meta.url);
const read = (rel: string) => {
  const url = new URL(rel, BACKEND);
  return existsSync(url) ? readFileSync(url, 'utf8') : null;
};
const have = read('modules/control_library/routers/workbench.py') != null;

test('every registry has a tone that exists and a label for every word', () => {
  for (const reg of Object.values(CATALOG_REGISTRIES) as Statuses[]) {
    assert.ok(reg.words.length > 0, `${reg.record} has words`);
    for (const word of reg.words) {
      assert.ok(reg.tone(word) in TONE, `${reg.record}: ${word} has a tone`);
      assert.ok(reg.label(word).length > 1 && reg.label(word) !== '—', `${reg.record}: ${word} has a label`);
    }
  }
});

test('the sources are the three the Catalog list builds, and the reviews are the ones the Library writes', { skip: !have }, () => {
  const workbench = read('modules/control_library/routers/workbench.py') as string;
  const groups = read('modules/control_library/routers/groups.py') as string;
  for (const word of controlSource.words) assert.ok(workbench.includes(`("${word}", `), `${word} is a source of workbench.py`);
  assert.deepEqual([...controlSource.words].sort(), ['framework', 'internal', 'normalized']);
  for (const word of ['approved', 'flagged']) assert.ok(groups.includes(`"${word}"`) && unifiedReview.has(word), `${word} is written by groups.py`);
  assert.ok(groups.includes('"pending"'), 'a unified control with no decision reads pending');
});

test('an unknown word is neutral with a readable label', () => {
  assert.equal(controlSource.tone('something_new'), 'neutral');
  assert.equal(unifiedReview.label('in_review'), 'In review');
});

test('a source is a kind: no colour ranks one above another', () => {
  assert.deepEqual(new Set(controlSource.words.map((w) => controlSource.tone(w))), new Set(['neutral']));
});
