// node --test "src/app/(dashboard)/vendor-risk/_lib/questionnaires/questionnairesGuard.test.ts"
// The source pins of Questionnaires (vendor-questionnaires, 2026-11-10): the Library, Sent and Shared tabs, the builder and the forward of the old Exchange address are built on the kit and stay so. No native
// dialog, no hand-built overlay, no text under 12px, no named utility the platform stylesheet repaints, no palette class, no `_ui`, no bare mutation, no bare paragraph; the page draws the kit head and its
// tabs; the Sent list is the one wiring of the explorer and reads the lean list; every read says when it failed; the writes keep their endpoints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));                       // .../vendor-risk/
const read = (rel: string): string => readFileSync(`${root}${rel}`, 'utf8');
function walk(dir: string): string[] {
  return readdirSync(`${root}${dir}`).flatMap((f) => {
    const rel = `${dir}/${f}`;
    return statSync(`${root}${rel}`).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [rel] : [];
  });
}
const FILES = [...walk('questionnaires'), 'exchange/page.tsx'];
const SOURCES: Array<[string, string]> = FILES.map((f) => [f, read(f)]);
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the tabs, the builder and the forward are all here, and the old parts folder is gone', () => {
  const names = FILES;
  for (const f of ['questionnaires/page.tsx', 'questionnaires/_library/LibraryTab.tsx', 'questionnaires/_sent/SentTab.tsx', 'questionnaires/_sent/SentDrawer.tsx', 'questionnaires/_sent/SendSheet.tsx',
    'questionnaires/_shared/SharedTab.tsx', 'questionnaires/_shared/SharedSheets.tsx', 'questionnaires/[token]/builder/page.tsx', 'questionnaires/_builder/QuestionEditor.tsx', 'exchange/page.tsx']) assert.ok(names.includes(f), f);
  assert.ok(!names.some((f) => f.includes('_parts/')), 'the older _parts dialogs are replaced by the sheets');
});

test('no native dialog, no hand-built overlay, no hover-only action', () => {
  for (const [file, src] of SOURCES) {
    const code = strip(src);
    assert.ok(!/window\.(confirm|alert|prompt)|(^|[^.\w])(confirm|alert|prompt)\(/.test(code.replace(/useConfirm|confirm\(\{/g, '')), `${file}: a native dialog`);
    assert.ok(!/fixed inset-0/.test(code), `${file}: a hand-built overlay (use Sheet / SidePanel / ConfirmDialog)`);
    assert.ok(!/opacity-0[^"']*group-hover|group-hover[^"']*opacity-0/.test(code), `${file}: an action only a hover shows`);
  }
});

test('the kit rules hold in every file: no text under 12px, no named size, palette class, shadow, radius or remapped spacing, no bare outline-none', () => {
  for (const [file, src] of SOURCES) assert.deepEqual(findViolations(src).map((v) => `${v.line}: ${v.rule}`), [], file);
});

test('every <p>, <td>, <th>, <h2> and <h3> with a class names a text size (a bare one gets 11.5px and dark text in the shell)', () => {
  const SIZE = /(?<![\w:\-[])!?text-(?:ds-(?:title|section|body|label)|\[\d[^\]]*\])(?![\w-])/;
  for (const [file, src] of SOURCES) {
    for (const m of Array.from(strip(src).matchAll(/<(p|td|th|h2|h3)\b([^>]*)>/g))) {
      const attrs = m[2];
      const literal = /className="([^"]*)"/.exec(attrs);
      if (/className=\{/.test(attrs) && !literal) continue;                               // built from a constant: the platform guard (bareText.test.ts) follows those
      assert.ok(literal && SIZE.test(literal[1]), `${file}: <${m[1]}${attrs.slice(0, 70)}> has no text size`);
    }
  }
});

test('the pages are on the kit: no _ui import, no legacy toast, no bare mutation, no browser date parsing, every external link says noopener', () => {
  for (const [file, src] of SOURCES) {
    const code = strip(src);
    assert.ok(!/from '\.\.?(\/\.\.)*\/_ui[/']|\/_ui'/.test(code), `${file}: imports the older _ui kit`);
    assert.ok(!/ToastProvider|useToast\b/.test(code), `${file}: the older toast (use useNotify / useReportedMutation)`);
    assert.ok(!/\buseMutation\(/.test(code), `${file}: a bare mutation (use useReportedMutation: it reports the answer, and a failure stays on screen)`);
    assert.ok(!/new Date\((?!\))/.test(code), `${file}: new Date( on a stored value (use lib/format.ts: server times are naive UTC)`);
    assert.ok(!/toLocale(Date|Time)?String/.test(code), `${file}: toLocale*String (use lib/format.ts)`);
    for (const m of Array.from(code.matchAll(/<(?:a|Button)\b[^>]*target="_blank"[^>]*>/g))) assert.match(m[0], /rel="noopener|rel="noreferrer/, `${file}: ${m[0].slice(0, 60)}`);
  }
});

test('Rule U1: nothing technical on a screen: no id, key name or code word in the words a person reads', () => {
  for (const [file, src] of SOURCES) {
    const code = strip(src);
    assert.ok(!/>[^<{]*(?:vendor_risk|erm):[a-z_*]+:[a-z*]+[^<{]*</.test(code), `${file}: a permission key in visible text`);
    assert.ok(!/>[^<{]*#\{?[a-z.]*id\b/i.test(code), `${file}: an id in visible text`);
    assert.ok(!/(Vendor|Questionnaire|Response|Assessment|Template|Contact) #|`[^`]*#\$\{[^}]*\}[^`]*`/.test(code), `${file}: a record number in words`);
    assert.ok(!/Questionnaire Response|raw responses|JSON\.stringify\(answer/i.test(code), `${file}: raw answers`);
  }
});

test('the page draws the kit head and the three tabs, each tab only while it is open; the builder draws its own head with a way back', () => {
  const page = read('questionnaires/page.tsx');
  assert.match(page, /<PageHeader[\s\S]{0,80}variant="page"/);
  assert.match(page, /<Tabs\b/);
  for (const key of ['library', 'sent', 'shared']) assert.match(page, new RegExp(`<TabPanel tabKey="${key}"`), key);
  assert.match(page, /tab === 'sent' &&/);
  assert.match(page, /router\.replace\(tabHref\(pathname, key\)/, 'a tab starts clean: it carries none of another tab\'s params');
  const builder = read('questionnaires/[token]/builder/page.tsx');
  assert.match(builder, /<PageHeader[\s\S]{0,80}variant="page"/);
  assert.match(builder, /back=\{back\}|back=\{\{/);
});

test('Sent is the one wiring of the explorer over the lean list, a failed read is never drawn as an empty list, and the answers are read on demand', () => {
  const tab = read('questionnaires/_sent/SentTab.tsx');
  assert.match(tab, /<RegisterFrame/);
  assert.match(tab, /error=\{list\.isError && !list\.data \? list\.error : undefined\}/);
  const api = read('_lib/questionnairesApi.ts');
  assert.match(api, /lean: 1/, 'the lean list: no answers, no token');
  assert.match(api, /`\$\{RESPONSES\}\/\$\{id\}`/, 'one questionnaire, read when its drawer opens');
  const drawer = read('questionnaires/_sent/SentDrawer.tsx');
  assert.match(drawer, /one\.isError && !detail/);
  assert.match(drawer, /Couldn't load the answers/);
});

test('every file that reads says when the read failed, and says it with Retry', () => {
  for (const f of FILES.filter((x) => /(useQuery|useSent|useSentOne|useShared|useVendorOptions|useTemplates)\(/.test(read(x)) && x.endsWith('.tsx'))) {
    const code = strip(read(f));
    assert.ok(/isError|\.error\b|error=/.test(code), `${f}: no failed state`);
  }
  assert.match(read('questionnaires/_shared/SharedTab.tsx'), /Couldn't load the shared assessments/);
  assert.match(read('questionnaires/_library/LibraryTab.tsx'), /Couldn't load the questionnaires/);
  assert.match(read('questionnaires/_sent/SendSheet.tsx'), /Couldn't load the suppliers/);
});

test('the writes keep the endpoints and payloads they always had', () => {
  assert.match(read('questionnaires/_sent/SendSheet.tsx'), /vendorRiskApi\.sendQuestionnaire\(/);
  assert.match(read('questionnaires/_sent/SendSheet.tsx'), /certificate_mode: form\.mode/);
  assert.match(read('questionnaires/_sent/useSentActions.tsx'), /vendorRiskApi\.resendQuestionnaire\(r\.id\)/);
  assert.match(read('questionnaires/_sent/useSentActions.tsx'), /portalApi\.issueLink\(r\.vendor_id, r\.contact_id as number, \{ send_email: false \}\)/);
  const shared = read('questionnaires/_shared/SharedSheets.tsx') + read('questionnaires/_shared/SharedTab.tsx');
  for (const call of ['tpraApi.publishShared(', 'tpraApi.importShared(', 'tpraApi.revokeShared(', 'tpraApi.sharedPackage(']) assert.ok(shared.includes(call), call);
  const builder = read('questionnaires/[token]/builder/page.tsx');
  assert.match(builder, /questionnairesApi\.update\(id, \{ questions: v\.next, expected_updated_at/);
});

test('the old Exchange address forwards to the Shared tab with every param it came with, as a server redirect (no page flash)', () => {
  const page = read('exchange/page.tsx');
  assert.match(page, /redirect\(`\/vendor-risk\/questionnaires\?\$\{exchangeQuery\(/);
  assert.match(page, /searchParams/);
  assert.ok(!/'use client'/.test(page));
});
