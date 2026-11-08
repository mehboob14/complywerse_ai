// node "src/app/(dashboard)/frameworks/[id]/_registers/registerRules.test.ts"   (or the whole suite: npm test)
// Source-text pins for the Registers and Artifacts tabs of the journey page: the files written for the revamp follow the kit (no named sizes or palette,
// nothing under 12px, a size on every paragraph, cell and heading), nothing uses a native dialog, hides an action until hover, logs to the console, formats a
// date with the browser's locale or writes with a bare mutation; the old drop-down and tone classes are gone; and the names other pages import from the
// Artifacts tab and from the registers still exist, so no consumer breaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const FRAMEWORKS_ID = fileURLToPath(new URL('..', import.meta.url));            // .../frameworks/[id]
const SRC = join(FRAMEWORKS_ID, '..', '..', '..', '..');                          // .../src
const read = (abs: string) => readFileSync(abs, 'utf8');
const mine = (rel: string) => join(FRAMEWORKS_ID, rel);
const ui = (rel: string) => join(SRC, rel);

const registerFiles = readdirSync(mine('_registers')).filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)).map((n) => mine(`_registers/${n}`));
const FILES = [
  ...registerFiles,
  mine('_tabs/FrameworkRegisterTab.tsx'), mine('_tabs/FrameworkDynamicRegisterTab.tsx'), mine('_tabs/FrameworkDocumentTab.tsx'),
  mine('_tabs/_PciCdeInventoryTab.tsx'), mine('_tabs/_HipaaEphiInventoryTab.tsx'), mine('_tabs/templateConfigs.ts'), mine('_tabs/templateSequence.ts'),
  mine('_workspace/RegistersHost.tsx'),
  ui('components/compliance/ArtifactsTab.tsx'), ui('components/compliance/ArtifactModals.tsx'), ui('components/compliance/artifactsModel.ts'),
  ui('lib/statuses/frameworkRegisters.ts'),
];
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the files follow the kit: no named sizes or palette, nothing under 12px, no bare outline-none', () => {
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f.replace(SRC, '')}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

// the platform CSS gives a bare <p>, <td>, <th>, <h2> and <h3> 11.5px or 12.5px and the dark default colour (bareText.test.ts): each must name a size
const SIZE = /(?<![\w:\-[])!?text-(?:ds-(?:title|section|body|label)|\[\d[^\]]*\])(?![\w-])/;
function tagEnd(source: string, start: number, nameLength: number): number {
  let depth = 0;
  let quote = '';
  for (let i = start + 1 + nameLength; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === quote && source[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

test('every <p>, <td>, <th>, <h2> and <h3> names a text size (a bare one is repainted by the platform CSS)', () => {
  const bad: string[] = [];
  for (const f of FILES.filter((x) => x.endsWith('.tsx'))) {
    const src = code(read(f));
    for (const name of ['p', 'td', 'th', 'h2', 'h3']) {
      const re = new RegExp(`<${name}(?=[\\s>])`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const end = tagEnd(src, m.index, name.length);
        const tag = end < 0 ? src.slice(m.index, m.index + 200) : src.slice(m.index, end + 1);
        if (!SIZE.test(tag)) bad.push(`${f.replace(SRC, '')}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('no native dialog, no action hidden until hover, no console logging, no browser-locale date, no bare mutation', () => {
  const bad: string[] = [];
  for (const f of FILES) {
    const src = code(read(f));
    const name = f.replace(SRC, '');
    if (/\bwindow\.(confirm|alert|prompt)\b|(?<![\w.])(alert|prompt)\s*\(|(?<![\w.])confirm\(\s*[`'"]/.test(src)) bad.push(`${name}: native dialog`);
    if (/opacity-0[^'"`]*group-hover|group-hover:opacity-100/.test(src)) bad.push(`${name}: hover-only action`);
    if (/console\.(info|log|debug)\(/.test(src)) bad.push(`${name}: console logging`);
    if (/toLocale(Date|Time)?String\(/.test(src)) bad.push(`${name}: a date written in the browser's locale`);
    if (/\buseMutation\(/.test(src)) bad.push(`${name}: a bare useMutation (use useReportedMutation: it reports a failure)`);
    if (/useToast\b/.test(src)) bad.push(`${name}: useToast (use useNotify or useReportedMutation)`);
    if (/TONE_CLASSES|text-\[1[01]px\]|text-\[9px\]/.test(src)) bad.push(`${name}: the old palette tones or a tiny size`);
  }
  assert.deepEqual(bad, []);
});

test('the two drop-down menus are gone: the Registers tab is the list, and the deleted files stay deleted', () => {
  assert.equal(existsSync(mine('_tabs/TabDropdown.tsx')), false);
  assert.equal(existsSync(mine('_tabs/templateConfigs.tsx')), false, 'the configs hold no JSX: they are a .ts file');
  const host = read(mine('_workspace/RegistersHost.tsx'));
  assert.match(host, /<nav aria-label=/);
  assert.match(host, /key=\{open\}/, 'each item is drawn under its own key');
  assert.match(host, /UnsavedContext/, 'a document with unsaved text asks before it is replaced');
  for (const f of registerFiles) assert.doesNotMatch(read(f), /TabDropdown/);
});

test('every row action of a register is a keyboard-reachable menu or button, and the row opens its form', () => {
  const view = read(mine('_registers/RegisterView.tsx'));
  assert.match(view, /onRowActivate=\{openEdit\}/);
  assert.match(view, /<Menu iconOnly label=\{`Actions for /);
  assert.match(view, /cardActions=\{menu\}/);
  assert.match(view, /tone: 'danger'/, 'a delete and a reset are asked about');
  assert.match(view, /key: 'reset'/);
  assert.match(view, /error=\{failure\}/, 'a failed read is an error with Retry, never an empty register');
});

test('the Artifacts tab keeps every name its other pages import, and the journey page still gets the components it renders', () => {
  const tab = read(ui('components/compliance/ArtifactsTab.tsx'));
  const names = ['ArtifactDownload', 'CreateArtifactModal', 'EditArtifactModal', 'ViewArtifactModal'];
  assert.match(tab, new RegExp(`export \\{ ${names.join(', ')} \\};`));
  assert.match(tab, /export type \{ CatalogItem, TenantArtifact, TenantUser \};/);
  assert.match(tab, /export default function ArtifactsTab\(/);
  const consumers = [
    ui('app/(dashboard)/automation/soc2-controls/[code]/_workspace/DocumentsSection.tsx'),
    ui('app/(dashboard)/frameworks/[id]/_workspace/RequirementArtifactsSection.tsx'),
    ui('app/(dashboard)/frameworks/[id]/_tabs/ControlDetail.tsx'),
    ui('components/assessments/workspace/lenses/ArtifactsLens.tsx'),
  ].filter(existsSync);
  assert.ok(consumers.length >= 2, 'the consumers are read');
  const exported = new Set([...names, 'CatalogItem', 'TenantArtifact', 'TenantUser', 'default']);
  for (const f of consumers) {
    const src = read(f);
    for (const m of Array.from(src.matchAll(/import\s+([^;]*?)\s+from\s+'@\/components\/compliance\/ArtifactsTab'/g))) {
      const spec = m[1];
      const named = (spec.match(/\{([^}]*)\}/)?.[1] ?? '').split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean);
      for (const n of named) assert.ok(exported.has(n), `${f.replace(SRC, '')} imports ${n}`);
    }
  }
  // the props of the modals did not change (their consumers pass exactly these)
  const modals = read(ui('components/compliance/ArtifactModals.tsx'));
  assert.match(modals, /ViewArtifactModal\(\{ item, frameworkKey, onClose, onCreate \}/);
  assert.match(modals, /CreateArtifactModal\(\{ item, frameworkKey, frameworkName, assessmentId, tenantUsers, onConfirm, onClose, isPending \}/);
  assert.match(modals, /EditArtifactModal\(\{ artifact, tenantUsers, onSave, onClose, isPending \}/);
  assert.match(modals, /ArtifactDownload\(\{ artifact, label = '' \}/);
});

test('the journey page renders each register component with props it declares', () => {
  const ws = read(mine('_workspace/JourneyWorkspace.tsx'));
  const declared: Record<string, string[]> = {
    FrameworkRegisterTab: ['registerType', 'journeyId', 'frameworkId', 'frameworkName', 'tenantUsers', 'frameworkControls'],
    FrameworkDynamicRegisterTab: ['config', 'journeyId', 'frameworkId', 'frameworkName', 'tenantUsers', 'frameworkControls'],
    FrameworkDocumentTab: ['docType', 'journeyId', 'frameworkId', 'frameworkName', 'tenantUsers'],
    PciCdeInventoryTab: ['journeyId', 'frameworkName', 'tenantUsers'],
    HipaaEphiInventoryTab: ['journeyId', 'frameworkName', 'tenantUsers'],
  };
  for (const [component, props] of Object.entries(declared)) {
    const used = Array.from(ws.matchAll(new RegExp(`<${component}\\s([^>]*)/>`, 'g')));
    assert.ok(used.length > 0, `${component} is rendered`);
    for (const u of used) {
      const attrs = Array.from(u[1].matchAll(/(\w+)=/g)).map((a) => a[1]);
      for (const a of attrs) assert.ok(props.indexOf(a) >= 0, `${component} gets ${a}, which it does not declare`);
    }
  }
});
