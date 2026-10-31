// node --test "src/components/ui/ds/tableGuard.test.ts"
// Source-text guards (like kitGuard.test.ts) for the table kit: the promises about headers, names and the keyboard that a refactor could
// quietly drop. There is no DOM here, so these read Table.tsx and RegisterTable.tsx; the behaviour itself is checked in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DIR = 'src/components/ui/ds';
const withoutComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const table = withoutComments(readFileSync(`${DIR}/Table.tsx`, 'utf8'));
const register = withoutComments(readFileSync(`${DIR}/RegisterTable.tsx`, 'utf8'));

/** The text of every opening tag `<name ...>` of a JSX source. Attributes may hold `=>`, `{...}` and quotes, so a tag ends at the first `>`
 *  that is outside braces and quotes. */
function openingTags(source: string, name: string): string[] {
  const tags: string[] = [];
  for (const m of Array.from(source.matchAll(new RegExp(`<${name}(?=[\\s/>])`, 'g')))) {
    const start = m.index ?? 0;
    let depth = 0;
    let quote = '';
    for (let i = start + 1 + name.length; i < source.length; i++) {
      const c = source[i];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { tags.push(source.slice(start, i + 1)); break; }
    }
  }
  return tags;
}

test('the tag scanner reads a tag whose attributes hold arrows, braces and quotes', () => {
  const sample = `<th scope="col" onClick={(e) => { if (a > b) go('x>y'); }} className="a>b">x</th><th>y</th><thead>z</thead>`;
  const tags = openingTags(sample, 'th');
  assert.equal(tags.length, 2);
  assert.ok(tags[0].includes('scope="col"') && tags[0].endsWith('className="a>b">'));
  assert.equal(tags[1], '<th>');
  assert.deepEqual(openingTags(sample, 'thead'), ['<thead>']);
});

test('every header cell of the kit carries a scope: col for a column header, row for the cell that names its row', () => {
  for (const [file, source] of [['Table.tsx', table], ['RegisterTable.tsx', register]]) {
    for (const tag of openingTags(source, 'th')) assert.match(tag, /\bscope=/, `${file}: ${tag}`);
  }
  const scopes = openingTags(table, 'th').map((t) => /scope="(\w+)"/.exec(t)?.[1]);
  assert.deepEqual(scopes.sort(), ['col', 'row']);
});

test('a Table cannot be drawn without its caption, and says it to assistive technology only', () => {
  assert.match(table, /interface TableProps[^{]*\{[^}]*\bcaption: string;/);
  assert.match(register, /interface RegisterTableProps<T> \{\s*caption: string;/);
  assert.doesNotMatch(table + register, /\bcaption\?:/);
  assert.match(table, /<caption className="sr-only">\{caption\}<\/caption>/);
});

test('the scroll frame is a labelled region that the keyboard can reach', () => {
  assert.match(table, /interface TableFrameProps \{\s*'aria-label': string;/);
  const frame = openingTags(table, 'div')[0];
  assert.match(frame, /role="region"/);
  assert.match(frame, /tabIndex=\{0\}/);
  assert.match(frame, /aria-label=\{label\}/);
});

test('a row or a card that opens is a tab stop', () => {
  assert.match(table, /tabIndex=\{onActivate \? 0 : undefined\}/);
  assert.match(register, /tabIndex=\{open \? 0 : undefined\}/);
});

test('rows and cards open through rowHandlers (one rule for the click and the keys), never through a bare onClick', () => {
  for (const [source, name] of [[table, 'tr'], [register, 'li']]) {
    const tags = openingTags(source, name);
    assert.ok(tags.length > 0, name);
    for (const tag of tags) assert.doesNotMatch(tag, /\bonClick=|\bonKeyDown=/, tag);
  }
  assert.match(table, /\{\.\.\.rowHandlers<HTMLTableRowElement>\(onActivate\)\}/);
  assert.match(register, /\{\.\.\.rowHandlers<HTMLLIElement>\(open\)\}/);
});

test('a sortable header is a real button named by its text, with the sort state on the cell', () => {
  const buttons = openingTags(table, 'button');
  assert.equal(buttons.length, 1);
  assert.match(buttons[0], /type="button"/);
  assert.doesNotMatch(buttons[0], /aria-label/);
  assert.match(table, /aria-sort=\{state\}/);
});

test('the register is built from the primitives, not from bare table tags', () => {
  for (const tag of ['table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption']) assert.deepEqual(openingTags(register, tag), [], tag);
});

test('the classes that outrank the dashboard CSS on bare table elements are still there', () => {
  // `.cw-dashboard thead th`, `.cw-dashboard tbody tr:nth-child(even)`, `.cw-dashboard table`, `.governance-light table td/th`: see the top of Table.tsx
  for (const cls of ['!border-separate', '!bg-transparent', '!bg-ds-surface-subtle', '!text-ds-label', '!text-ds-fg-muted', '!text-ds-body', '[&&]:!py-[8px]', '[&&]:!py-[10px]']) {
    assert.ok(table.includes(cls), cls);
  }
});
