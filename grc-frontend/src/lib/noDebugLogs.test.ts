import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test('no debug console.log (payloads, responses) in the API client, the governance screens or the document proxy routes', () => {
  const found = [join(SRC, 'lib', 'api.ts'), ...files(join(SRC, 'app', '(dashboard)', 'governance')), ...files(join(SRC, 'app', 'api', 'governance', 'documents'))]
    .filter((path) => /console\.log\(/.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(SRC.length));
  assert.deepEqual(found, []);
});
