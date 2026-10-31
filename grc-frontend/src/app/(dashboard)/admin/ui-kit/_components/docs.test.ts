// node --test "src/app/(dashboard)/admin/ui-kit/_components/docs.test.ts"
// Keeps the style guide's hand-written documentation (docs.ts) true to the kit: a prop added to a component must be documented, a documented prop must
// still exist, each import line must resolve to a file that exports the name, and every component the kit exports must have an entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { DOCS } from './docs.ts';

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The names an interface declares at its own top level (two-space indent), from `interface Name … {` to the closing brace at column 0. */
function declaredProps(source: string, iface: string): string[] {
  const head = new RegExp(`interface\\s+${iface}\\b[^{]*\\{`).exec(source);
  assert.ok(head, `no interface ${iface}`);
  const body = source.slice(head.index + head[0].length).split(/\r?\n\}/)[0];
  return Array.from(body.matchAll(/^ {2}(?:readonly )?(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\??:/gm), (m) => m[1] ?? m[2] ?? m[3]);
}

const parts = Object.values(DOCS).flatMap((doc) => doc.parts.map((part) => ({ doc, part })));

test('the keys are the names, and every entry says when to use it', () => {
  for (const key of Object.keys(DOCS)) {
    assert.equal(DOCS[key].name, key);
    assert.ok(DOCS[key].use.trim().length > 20, `${key}: no "use when"`);
    assert.ok(DOCS[key].parts.length > 0, `${key}: no parts`);
  }
});

test('every prop a component declares is documented, and every documented prop still exists', () => {
  const problems: string[] = [];
  for (const { doc, part } of parts) {
    if (!part.source || !part.own) continue;
    const source = readFileSync(part.source, 'utf8');
    const declared = declaredProps(source, part.own);
    const documented = part.props.map((p) => p.name);
    for (const name of declared) if (!documented.includes(name)) problems.push(`${doc.name}/${part.name}: "${name}" is declared in ${part.own} and not documented`);
    for (const p of part.props) {
      if (declared.includes(p.name) || p.native) continue;
      if (!new RegExp(`(?<![\\w-])${escape(p.name)}(?![\\w-])`).test(source)) problems.push(`${doc.name}/${part.name}: "${p.name}" is documented and not in ${part.source}`);
    }
    assert.ok(declared.length > 0, `${part.name}: no props found in ${part.own}`);
  }
  assert.deepEqual(problems, []);
});

test('every import line resolves to a file that exports the names it imports', () => {
  const problems: string[] = [];
  for (const doc of Object.values(DOCS)) {
    const base = doc.importFrom.replace(/^@\//, 'src/');
    const file = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((p) => existsSync(p));
    if (!file) { problems.push(`${doc.name}: cannot resolve ${doc.importFrom}`); continue; }
    const text = readFileSync(file, 'utf8');
    for (const name of doc.imports ?? [doc.parts[0].name]) {
      const exported = new RegExp(`export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|class|interface|type)\\s+${name}\\b|export\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}`).test(text);
      if (!exported) problems.push(`${doc.name}: ${file} does not export ${name}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every component and helper the kit index exports has an entry in the guide', () => {
  const index = readFileSync('src/components/ui/ds/index.ts', 'utf8');
  const exported = Array.from(index.matchAll(/export \{([^}]*)\} from/g)).flatMap((m) => m[1].split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('type ')));
  assert.ok(exported.length > 30);
  const known = parts.map(({ part }) => part.name);
  assert.deepEqual(exported.filter((name) => !known.includes(name)), []);
});
