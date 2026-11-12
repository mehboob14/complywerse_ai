// node --test "src/components/overview/overviewKit.test.ts"
// Source-text pins for the cockpit frame (components/overview): it stays on the design-system kit (no native dialogs, no hover-only actions, no text under
// 12px, no platform-remapped utilities, no bare <p>/<td>/<th>/<h2>/<h3>), it knows no module (the Governance words live in the page's folder), it asks for
// nothing itself, and it is configuration-driven: the page hands it a band, a worklist, a posture and a list of breakdowns. The bare-text guard of the kit
// reads page folders only, so this file holds the frame to the same rule. Overview v2 adds the slim MyWorkCard, the Back rule (useReturnToPlace) and a guard that
// the overview pages of the v2 round no longer draw the chips wall (CounterBand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../ui/ds/kitRules.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const SOURCES = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((file) => ({ file, text: readFileSync(`${DIR}${file}`, 'utf8') }));
const TSX = SOURCES.filter((s) => s.file.endsWith('.tsx'));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the folder is what the pins read: the frame, the band, the two worklist cards, the narrow hook, the Back hook and the rule files', () => {
  assert.deepEqual(SOURCES.map((s) => s.file).sort(), ['CounterBand.tsx', 'Cockpit.tsx', 'MyWorkCard.tsx', 'WorkListCard.tsx', 'cockpitModel.ts', 'returnToPlaceModel.ts', 'useNarrow.ts', 'useReturnToPlace.ts', 'workList.ts'].sort());
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

test('the frame is configuration-driven: the page hands it the hero, the visuals and the work; the band, the posture and the breakdowns are optional and absent by default', () => {
  const frame = code(SOURCES.find((s) => s.file === 'Cockpit.tsx')!.text);
  assert.match(frame, /export interface CockpitProps \{[\s\S]*mode\?: CockpitMode;[\s\S]*band\?: ReactNode;[\s\S]*hero\?: ReactNode;[\s\S]*visuals\?: ReactNode;[\s\S]*work: ReactNode;[\s\S]*posture\?: ReactNode;[\s\S]*breakdowns\?: readonly Breakdown\[\];/);
  assert.match(frame, /breakdowns = \[\]/, 'no breakdowns: no empty grid');
  assert.match(frame, /\{hero\}\s*\{band\}\s*\{visuals\}/, 'posture first (R1): the figures, the band if a page still has one, the graphics, then the work');
  assert.match(frame, /mode === 'solo' \|\| !posture/, 'without a posture card the work takes the row');
  assert.match(frame, /breakdowns\.map\(\(b\) => <BreakdownCard key=\{b\.id\} b=\{b\} narrow=\{narrow\} \/>\)/);
  const band = code(SOURCES.find((s) => s.file === 'CounterBand.tsx')!.text);
  assert.match(band, /counters: readonly BandCounter\[\];/);
});

test('on a phone each breakdown is a closed disclosure with its controls inside; on a screen it is a section card', () => {
  const frame = code(SOURCES.find((s) => s.file === 'Cockpit.tsx')!.text);
  assert.match(frame, /<Disclosure label=\{b\.title\} level=\{2\} open=\{open\} onOpenChange=\{setOpen\}>/);
  assert.match(frame, /const \[open, setOpen\] = useState\(false\);/, 'closed until the person opens it');
  assert.match(frame, /\{open && \(\s*<>[\s\S]*\{b\.children\}/, 'the content is drawn once it is opened: a chart in a shut panel has no width to measure');
  assert.doesNotMatch(frame, /defaultOpen/);
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

test('MyWorkCard is slim: three one-line rows by default, one tab stop a row, a header with the count and "See all N", the all-clear in one line', () => {
  const card = code(SOURCES.find((s) => s.file === 'MyWorkCard.tsx')!.text);
  assert.match(card, /limit = MY_WORK_ROWS/, 'three rows unless the page asks for more');
  assert.match(card, /lengthOf\(itemsFor\(work, chosen\), Math\.max\(1, limit\)\)/);
  assert.match(card, /See all \$\{formatCount\(page\.total\)\}/, 'the true total, not the cut');
  assert.match(card, /aria-label=\{rowLinkName\(r\)\}/, 'a row link is named by its action and its title');
  assert.match(card, /truncate/, 'a row is one line');
  assert.match(card, /All caught up/);
  assert.doesNotMatch(card, /SegmentedControl|WorkRow|useQuery/, 'no filter control, no two-line row, asks for nothing itself');
  for (const s of ['loading', 'unavailable', 'empty', 'content']) assert.match(card, new RegExp(`work\\.state === '${s}'`), s);
  assert.match(card, /onRetry=\{\(\) => failed\.forEach/, 'a failed source asks again');
  assert.match(card, /<ErrorState compact/);
});

test('the Back rule: the scroller is the layout main element, every storage call is in a try/catch, nothing is written while the place is put back, and the history listener is module level', () => {
  const hook = code(SOURCES.find((s) => s.file === 'useReturnToPlace.ts')!.text);
  assert.match(hook, /getElementById\('main-content'\)/);
  assert.match(hook, /try \{ return parsePlaces\(window\.sessionStorage\.getItem\(STORE_KEY\)\); \} catch/);
  assert.match(hook, /try \{ window\.sessionStorage\.setItem\(STORE_KEY[\s\S]*\} catch/);
  assert.equal((hook.match(/sessionStorage/g) ?? []).length, 2, 'sessionStorage is touched in two guarded places only');
  assert.match(hook, /window\.addEventListener\('popstate'/);
  assert.match(hook, /window\.addEventListener\('pagehide'/);
  assert.match(hook, /if \(!done\.current\) return;/, 'while the place is being put back nothing is written over it');
  assert.match(hook, /useLayoutEffect/, 'the position is read in a layout cleanup, before the elements of the page go');
  assert.match(hook, /if \(!ready \|\| want\.current === null \|\| done\.current\) return;/, 'put back only once the data has rendered');
  assert.match(hook, /decided\.current/, 'decided once, so the dev remount does not lose the place');
  assert.match(hook, /window\.addEventListener\('popstate', \(\) => popped\('popstate'\), true\)/, 'the Back press is heard in the CAPTURE phase: before the router has mounted the cached page');
  assert.match(hook, /navigation\?\.addEventListener\('navigate'/, 'the Navigation API says "traverse" even earlier where it exists');
  assert.match(hook, /isTraverse\(e\.navigationType\)/);
  const mount = hook.slice(hook.indexOf('if (!decided.current) {'), hook.indexOf('const place = decided.current.place;'));
  assert.doesNotMatch(mount, /arrival\.poppedAt = null/, 'a page mounted twice for one Back decides the same twice: the press ends with the next click, a push or 15s');
  assert.match(hook, /setTimeout\(\(\) => \{[\s\S]*isReturn\(arrival, keyRef\.current, now\)[\s\S]*DECIDE_LATE_MS\)/, 'no Navigation API: a page that looks fresh decides after a late popstate had its chance');
  assert.match(hook, /\[ready, verdict\]/, 'a late verdict makes the put-back effect look again');
  assert.match(hook, /mayWrite\(\{ y, touched, sinceMountMs/, 'a page nobody touched does not write "the top" over a kept place');
});

test('the overview pages of the v2 round draw no chips wall: none of them imports CounterBand (Overview rule R2)', () => {
  const root = fileURLToPath(new URL('../../app/(dashboard)/', import.meta.url));
  const src = fileURLToPath(new URL('../../', import.meta.url));
  const compliance = fileURLToPath(new URL('../compliance/overview/', import.meta.url));
  const FILES = [
    `${root}dashboard/page.tsx`, `${root}governance/page.tsx`, `${root}erm/page.tsx`, `${root}vendor-risk/page.tsx`, `${root}compliance/page.tsx`,
    `${root}assessments/page.tsx`, `${root}issues/page.tsx`, `${root}auditor-portal/page.tsx`,
  ];
  const folders = [`${root}dashboard/_overview/`, `${root}vendor-risk/_overview/`, `${root}issues/_overview/`, `${root}auditor-portal/_front/`, `${root}assessments/_overview/`, `${root}governance/_overview/`, compliance];
  const found: string[] = [];
  const scan = (file: string) => {
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { return; }
    if (/\.test\.tsx?$/.test(file)) return;
    if (/import[^;]*\bCounterBand\b[^;]*from/.test(code(text))) found.push(file.slice(src.length).split('\\').join('/'));
  };
  FILES.forEach(scan);
  for (const dir of folders) {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { continue; }
    names.filter((n) => /\.tsx?$/.test(n)).forEach((n) => scan(`${dir}${n}`));
  }
  assert.deepEqual(found, [], `these overview pages still draw the counters band: ${found.join(', ')}`);
});
