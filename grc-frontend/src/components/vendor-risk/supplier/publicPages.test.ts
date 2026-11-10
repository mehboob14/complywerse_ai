// node --test "src/components/vendor-risk/supplier/publicPages.test.ts"
// The supplier side of Vendor Risk is public: a personal link, an examiner link or a questionnaire's own link is the only key, and it sits in the address.
// So (1) every public layout keeps the address out of a Referer header and out of search engines, (2) these pages never print the server's own words about
// a tenant, (3) nothing here uses a native dialog or text under 12px, and (4) the pages never write the link into browser storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(`${SRC}${rel}`, 'utf8').replace(/\r\n/g, '\n');

/** Every public layout: the supplier portal, the examiner and legacy questionnaire links, the document attestation. */
const PUBLIC_LAYOUTS = ['app/supplier/layout.tsx', 'app/vendor-risk/layout.tsx', 'app/attest/layout.tsx'];

test('every public layout sends no Referer and asks search engines to stay away', () => {
  for (const file of PUBLIC_LAYOUTS) {
    assert.ok(existsSync(`${SRC}${file}`), `${file} exists`);
    const text = read(file);
    assert.match(text, /referrer:\s*'no-referrer'/, `${file}: referrer`);
    assert.match(text, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/, `${file}: robots`);
  }
});

test('the vendor-risk public layout covers both public routes of that folder and no staff page', () => {
  const walk = (dir: string): string[] => readdirSync(`${SRC}${dir}`, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name === 'page.tsx')
    .map((e) => `${e.parentPath ?? e.path}/${e.name}`.replace(/\\/g, '/').split('/src/')[1]);
  assert.deepEqual(walk('app/vendor-risk').sort(), ['app/vendor-risk/examiner/[token]/page.tsx', 'app/vendor-risk/questionnaires/[token]/page.tsx']);
});

const FILES = [
  'app/supplier/_shared.tsx', 'app/supplier/page.tsx', 'app/supplier/[token]/page.tsx', 'app/supplier/[token]/questionnaires/[qid]/page.tsx',
  'app/supplier/[token]/requests/[id]/page.tsx', 'app/vendor-risk/examiner/[token]/page.tsx', 'app/vendor-risk/questionnaires/[token]/page.tsx',
  'components/vendor-risk/SupplierQuestionnaire.tsx',
  ...readdirSync(`${SRC}components/vendor-risk/supplier`).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => `components/vendor-risk/supplier/${f}`),
];

test('none of the public pages uses a native dialog, a hand-built overlay or text under 12px', () => {
  for (const file of FILES) {
    const text = read(file);
    assert.doesNotMatch(text, /window\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt)\(/, `${file}: native dialog`);   // the kit's useConfirm is named `confirm`: allowed
    assert.doesNotMatch(text, /fixed inset-0/, `${file}: hand-built overlay`);
    assert.doesNotMatch(text, /text-\[(?:[0-9]|10|11)(?:\.\d+)?px\]/, `${file}: text under 12px`);
  }
});

test("the pages never write the link to browser storage, and only the classifier knows the server's words about a tenant", () => {
  for (const file of FILES) {
    const text = read(file);
    assert.doesNotMatch(text, /localStorage\s*[.[]/, `${file}: localStorage`);
    if (file.endsWith('/portalProblem.ts')) continue;
    assert.doesNotMatch(text, /Tenant context|X-Tenant-Slug|subdomain/i, `${file}: a server sentence about a tenant`);
  }
});

test('the pages name their greys with the kit tokens: the platform stylesheet repaints every text-gray/slate class to one muted grey (and bg-gray to white), so a named grey is no hierarchy at all', () => {
  for (const file of FILES) {
    assert.doesNotMatch(read(file), /(?:text|bg|border|divide)-(?:gray|slate)-\d+/, `${file}: a named grey`);
  }
});
