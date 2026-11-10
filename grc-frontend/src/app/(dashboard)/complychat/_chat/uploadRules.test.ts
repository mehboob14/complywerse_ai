// node --test "src/app/(dashboard)/complychat/_chat/uploadRules.test.ts"
// What can be attached, in the same words the server uses (backend CHAT_UPLOAD_TYPES / CHAT_UPLOAD_MAX_BYTES, pinned by tests/test_complychat_states.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ACCEPT_ATTR, ACCEPTED_TYPES, checkFiles, extensionOf, formatSize, MAX_FILE_BYTES, MAX_PENDING, refusalFor, UPLOAD_HELP } from './uploadRules.ts';

test('the six types and ten megabytes: the same list as the server\'s', () => {
  assert.deepEqual([...ACCEPTED_TYPES], ['txt', 'md', 'csv', 'pdf', 'docx', 'pptx']);
  assert.equal(MAX_FILE_BYTES, 10 * 1024 * 1024);
  assert.equal(ACCEPT_ATTR, '.txt,.md,.csv,.pdf,.docx,.pptx');
  const server = readFileSync(fileURLToPath(new URL('../../../../../../backend/grc/modules/chatbot/router.py', import.meta.url)), 'utf8');
  assert.match(server, /CHAT_UPLOAD_TYPES = frozenset\(\{"\.txt", "\.md", "\.csv", "\.pdf", "\.docx", "\.pptx"\}\)/);
  assert.match(server, /CHAT_UPLOAD_MAX_BYTES = 10 \* 1024 \* 1024/);
  assert.match(UPLOAD_HELP, /up to 10 MB each/);
});

test('a file is refused with a sentence that says why; a good one is not', () => {
  assert.equal(refusalFor({ name: 'policy.PDF', size: 1000 }), null);
  assert.equal(refusalFor({ name: 'model.xlsx', size: 1000 }), "model.xlsx can't be attached. Use a text, Markdown, CSV, PDF, Word or PowerPoint file.");
  assert.equal(refusalFor({ name: 'noext', size: 1000 }), "noext can't be attached. Use a text, Markdown, CSV, PDF, Word or PowerPoint file.");
  assert.equal(refusalFor({ name: 'big.csv', size: MAX_FILE_BYTES + 1 }), 'big.csv is larger than 10 MB.');
  assert.equal(refusalFor({ name: 'big.csv', size: MAX_FILE_BYTES }), null);
  assert.equal(refusalFor({ name: 'empty.txt', size: 0 }), 'empty.txt is empty.');
  assert.equal(extensionOf('a.b.TXT'), 'txt');
});

test('what is picked is split into what waits and what is refused; at most five wait', () => {
  const picked = [{ name: 'a.txt', size: 5 }, { name: 'b.xlsx', size: 5 }, { name: 'c.md', size: 5 }];
  const { accepted, refused } = checkFiles(picked);
  assert.deepEqual(accepted.map((f) => f.name), ['a.txt', 'c.md']);
  assert.deepEqual(refused.map((r) => r.name), ['b.xlsx']);
  const many = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.txt`, size: 5 }));
  const capped = checkFiles(many, MAX_PENDING - 2);
  assert.equal(capped.accepted.length, 2);
  assert.equal(capped.refused.length, 2);
  assert.match(capped.refused[0].reason, /at most 5 files/);
});

test('sizes read plainly', () => {
  assert.equal(formatSize(1), '1 byte');
  assert.equal(formatSize(12), '12 bytes');
  assert.equal(formatSize(2048), '2 KB');
  assert.equal(formatSize(5 * 1024 * 1024), '5 MB');
  assert.equal(formatSize(2.5 * 1024 * 1024), '2.5 MB');
  assert.equal(formatSize(-1), '');
});
