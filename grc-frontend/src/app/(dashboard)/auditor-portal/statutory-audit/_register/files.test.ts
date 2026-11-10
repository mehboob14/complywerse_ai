// node --test "src/app/(dashboard)/auditor-portal/statutory-audit/_register/files.test.ts"   (or the whole suite: npm test)
// The file types and the 25 MB are the server's: the Python lists are re-read here, so one side cannot change without the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EVIDENCE_EXTENSIONS, IMPORT_EXTENSIONS, MAX_BYTES, acceptOf, extensionOf, fileProblem, readNotice, sizeText } from './files.ts';

const server = readFileSync(fileURLToPath(new URL('../../../../../../../backend/grc/modules/auditor_portal/routers/statutory_audit.py', import.meta.url)), 'utf8');
const words = (block: string): string[] => Array.from(block.matchAll(/"([a-z]+)"/g)).map((m) => m[1]).sort();

test('the types and the size are the server\'s', () => {
  assert.deepEqual([...IMPORT_EXTENSIONS].sort(), words(/_AI_IMPORT_EXTS = \{([^}]*)\}/.exec(server)![1]));
  assert.deepEqual([...EVIDENCE_EXTENSIONS].sort(), words(/EVIDENCE_EXTENSIONS = \{([^}]*)\}/.exec(server)![1]));
  assert.match(server, /_MAX_UPLOAD_BYTES = 25 \* 1024 \* 1024/);
  assert.equal(MAX_BYTES, 25 * 1024 * 1024);
});

test('a file is refused in plain words: the type, an empty file and the size', () => {
  assert.equal(fileProblem({ name: 'circular.PDF', size: 1000 }, 'import'), null);
  assert.equal(fileProblem({ name: 'photo.png', size: 1000 }, 'evidence'), null);
  assert.match(fileProblem({ name: 'photo.png', size: 1000 }, 'import')!, /can't be read/, 'an image is evidence but cannot be read by the import');
  assert.match(fileProblem({ name: 'setup.exe', size: 1000 }, 'evidence')!, /can't be attached/);
  assert.match(fileProblem({ name: 'no-extension', size: 1000 }, 'evidence')!, /can't be attached/);
  assert.equal(fileProblem({ name: 'a.pdf', size: 0 }, 'import'), 'This file is empty.');
  assert.equal(fileProblem({ name: 'a.pdf', size: MAX_BYTES }, 'import'), null, '25 MB exactly is allowed');
  assert.equal(fileProblem({ name: 'a.pdf', size: MAX_BYTES + 1 }, 'import'), 'This file is 25.0 MB. The most that can be used is 25 MB.');
  assert.doesNotMatch(fileProblem({ name: 'a.zip', size: 1 }, 'import')!, /[{}]|undefined/);
});

test('the pieces: the accept list, the extension, the size', () => {
  assert.equal(acceptOf(['pdf', 'docx']), '.pdf,.docx');
  assert.equal(extensionOf('Report.final.XLSX'), 'xlsx');
  assert.equal(extensionOf('noext'), '');
  assert.equal(extensionOf(null), '');
  assert.equal(sizeText(0), '—');
  assert.equal(sizeText(512), '512 B');
  assert.equal(sizeText(2048), '2 KB');
  assert.equal(sizeText(1.5 * 1024 * 1024), '1.5 MB');
});

test('a long document says that the rest was not read, and a short one says nothing', () => {
  assert.equal(readNotice(null), null);
  assert.equal(readNotice({ truncated: false, characters_read: 500, characters_total: 500 }), null);
  assert.match(readNotice({ truncated: true, characters_read: 14000, characters_total: 56000 })!, /only the first part was read \(about 25% of it\)/);
  assert.match(readNotice({ truncated: true })!, /only the first part was read\./);
  assert.match(readNotice({ truncated: true, characters_read: 14000, characters_total: 14001 })!, /about 99%/, 'never "100%" for a document that was cut');
});
