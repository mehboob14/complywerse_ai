// node --test "src/components/overview/overviewKit.test.ts"
// Source-text pins for the cockpit frame (components/overview): it stays on the design-system kit (no native dialogs, no hover-only actions, no text under
// 12px, no platform-remapped utilities, no bare <p>/<td>/<th>/<h2>/<h3>), it knows no module (the Governance words live in the page's folder), it asks for
// nothing itself, and it is configuration-driven: the page hands it a band, a worklist, a posture and a list of breakdowns. The bare-text guard of the kit
// reads page folders only, so this file holds the frame to the same rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../ui/ds/kitRules.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const SOURCES = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((file) => ({ file, text: readFileSync(`${DIR}${file}`, 'utf8') }));
const TSX = SOURCES.filter((s) => s.file.endsWith('.tsx'));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the folder is what the pins read: the frame, the band, the worklist card, the narrow hook and the two rule files', () => {
  assert.deepEqual(SOURCES.map((s) => s.file).sort(), ['CounterBand.tsx', 'Cockpit.tsx', 'WorkListCard.tsx', 'cockpitModel.ts', 'useNarrow.ts', 'workList.ts'].sort());
});

test('no native dialog: the browser\'s confirm, alert and prompt are never used', () => {
  for (const { file, text } of SOURCES) {
    const src = code(text);
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\s*\(/, file);
    assert.doesNotMatch(src, /(^|[^\w.$])(alert|prompt|confirm)\s*\(/m, `${file}: a bare alert(, prompt( or confirm(`);
  }
});

test('no action that appears only on hover, no text under 12px, no platform-remapped utility, no legacy governance scope', () => {
  for (const { file, text } of TSX) {
    const src = code(text);
    assert.doesNotMatch(src, /opacity-0[^'"`\n]*group-hover|group-hover[^'"`\n]*opacity-0/, `${file}: hover-only`);
    assert.doesNotMatch(src, /governance-light/, `${file}: the legacy scope`);
    const found = findViolations(text);
    assert.deepEqual(found, [], `${file}: ${found.map((v) => `${v.rule}@${v.line}`).join(', ')}`);
  }
});

test('no bare <p>, <td>, <th>, <h2> or <h3>: each names its text size (the platform CSS gives a bare one 11.5px)', () => {
  const SIZE = /(?<![\w:-])!?text-(?:ds-(?:title|section|body|label)|\[\d)/;
  for (const { file, text } of TSX) {
    const src = code(text);
    const tag = /<(p|td|th|h2|h3)(\s[^>]*?)?>/g;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(src)) !== null) {
      const open = src.slice(m.index, m.index + 400).split('>')[0] + '>';
      assert.match(open, SIZE, `${file}:${src.slice(0, m.index).split('\n').length} <${m[1]}> has no text size: ${open.slice(0, 90)}`);
    }
  }
});

test('the frame knows no module: no Governance address, word or request anywhere in it', () => {
  for (const { file, text } of SOURCES) {
    const src = code(text);
    assert.doesNotMatch(src, /\/governance|Governance|useQuery|useInfiniteQuery|apiClient|axios/, file);
  }
});

test('the frame is configuration-driven: the page hands it the band, the work, the posture and a list of breakdowns', () => {
  const frame = code(SOURCES.find((s) => s.file === 'Cockpit.tsx')!.text);
  assert.match(frame, /export interface CockpitProps \{[\s\S]*mode: CockpitMode;[\s\S]*band: ReactNode;[\s\S]*work: ReactNode;[\s\S]*posture: ReactNode;[\s\S]*breakdowns: readonly Breakdown\[\];/);
  assert.match(frame, /breakdowns\.map\(\(b\) => <BreakdownCard key=\{b\.id\} b=\{b\} narrow=\{narrow\} \/>\)/);
  const band = code(SOURCES.find((s) => s.file === 'CounterBand.tsx')!.text);
  assert.match(band, /counters: readonly BandCounter\[\];/);
});

test('on a phone each breakdown is a closed disclosure with its controls inside; on a screen it is a section card', () => {
  const frame = code(SOURCES.find((s) => s.file === 'Cockpit.tsx')!.text);
  assert.match(frame, /<Disclosure label=\{b\.title\} level=\{2\}>/);
  assert.doesNotMatch(frame, /defaultOpen/, 'closed until the person opens it');
  assert.match(frame, /<SectionCard id=\{b\.id\} title=\{b\.title\} info=\{b\.info\} meta=\{b\.meta\} actions=\{b\.actions\}>/);
});

test('the top row wraps by what its parts need (flex bases), not by the window, so a docked panel that narrows the page stacks it at the right moment', () => {
  const frame = code(SOURCES.find((s) => s.file === 'Cockpit.tsx')!.text);
  assert.match(frame, /flex-\[8_1_600px\]/, 'the work: a row of it needs about 600px for its title to have a line of its own');
  assert.match(frame, /flex-\[5_1_340px\]/, 'the posture: its bars give way before its names do');
});

test('the narrow hook is drawn wide on the server and corrected on the client (a desktop is never drawn as a phone first)', () => {
  const hook = code(SOURCES.find((s) => s.file === 'useNarrow.ts')!.text);
  assert.match(hook, /useSyncExternalStore\(subscribe, \(\) => window\.matchMedia\(QUERY\)\.matches, \(\) => false\)/);
  assert.match(hook, /\(max-width: 639\.98px\)/, 'the kit\'s sm step, where a WorkRow stacks');
});
