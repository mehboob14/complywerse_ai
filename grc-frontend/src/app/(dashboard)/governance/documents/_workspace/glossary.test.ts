// node --test "src/app/(dashboard)/governance/documents/_workspace/glossary.test.ts"
// The plain meanings: the seven words of the sample are all there, each is one to three short sentences, none holds an id or a model name, and none uses a word it does not itself
// explain (a meaning that needed another meaning would be the jargon problem again).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GLOSSARY, HOW_BLOCKERS, HOW_STEPS, TERM_KEYS, plainOf, termLabel } from './glossary.ts';
import { STEPS } from './tracker/detailModel.ts';

test('the eight words, each with its library spelling and a plain meaning', () => {
  assert.deepEqual(TERM_KEYS.map((k) => GLOSSARY[k].word), ['Attestation', 'Acknowledgement', 'Published', 'Review cycle', 'Owner', 'Approver', 'Out of date', 'Framework']);
  assert.deepEqual(Object.keys(GLOSSARY).sort(), [...TERM_KEYS].sort());
  for (const k of TERM_KEYS) {
    const plain = plainOf(k);
    assert.ok(plain.length >= 40 && plain.length <= 260, `${k}: ${plain.length} characters`);
    assert.ok((plain.match(/[.?!"]( |$)/g) ?? []).length <= 3, `${k}: more than three sentences`);
    assert.ok(/[.]$/.test(plain), `${k} ends with a full stop`);
    assert.ok(termLabel(k).includes(GLOSSARY[k].word));
  }
});

test('no meaning leans on jargon, an id or a vendor: the words of the glossary are not used to explain each other, and nothing names a model', () => {
  const jargon = ['attestation', 'acknowledgement', 'crosswalk', 'control objective', 'SCF', 'RACI', 'SLA', 'tier'];
  for (const k of TERM_KEYS) {
    const plain = GLOSSARY[k].plain;
    for (const j of jargon) assert.ok(!new RegExp(`\\b${j}\\b`, 'i').test(plain), `${k} uses "${j}"`);
    assert.ok(!/\b(gpt|openai|anthropic|claude)\b/i.test(plain), k);
    assert.ok(!/#\d|[0-9a-f]{16,}/i.test(plain), k);
  }
  // "out of date" says expired and overdue are not the same thing; "published" says it holds while a newer version is written
  assert.ok(/expired/i.test(GLOSSARY.out_of_date.plain) && /check-up/i.test(GLOSSARY.out_of_date.plain));
  assert.ok(/newer version/i.test(GLOSSARY.in_force.plain));
  assert.ok(/Not always the person who wrote it/.test(GLOSSARY.owner.plain));
});

test('seven steps, the same as the stepper of a document detail, each with a sentence and who does it; and what can hold a document up', () => {
  assert.deepEqual(HOW_STEPS.map((s) => s.title), STEPS.map((s) => s.name));
  assert.equal(HOW_STEPS.length, 7);
  for (const s of HOW_STEPS) {
    assert.ok(s.title && s.text.length > 20 && s.who, s.title);
    assert.ok(!/(gpt|openai|anthropic)/i.test(s.text) && !/in force/i.test(s.text), s.title);
  }
  assert.deepEqual(HOW_BLOCKERS.map((b) => b.title), ['Waiting on someone', 'Stuck', 'Changes requested', 'Changes proposed', 'Review overdue']);
  for (const b of HOW_BLOCKERS) assert.ok(b.text.length > 30 && /\.$/.test(b.text) && !/in force/i.test(b.text), b.title);
});
