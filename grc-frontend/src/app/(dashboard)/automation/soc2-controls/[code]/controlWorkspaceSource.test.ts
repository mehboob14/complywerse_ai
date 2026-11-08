// node --test "src/app/(dashboard)/automation/soc2-controls/[code]/controlWorkspaceSource.test.ts"   (a path with [code] is read as a glob by --test: run this file with `node <path>` or through npm test)
// The source rules of the control workspace (`[code]/page.tsx` and `_workspace/`), held where a screen test cannot reach: no native confirm / alert / prompt (every question is the kit's ConfirmDialog),
// no text under 12px, nothing that appears only on hover, none of the named utilities the platform stylesheet repaints inside the shell, no id or technical word in a visible string (Rule U1), no model or
// vendor name, no read of the platform's wildcard permission (the rights are read as the server reads them), no date written with the viewer's locale, and no read of the first 100 of a register to
// fill a picker. The custom control form (components/soc2) keeps the 12px floor and the no-native-dialog rule while it waits for its own re-skin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const SOC2 = fileURLToPath(new URL('../../../../../components/soc2/', import.meta.url));

function sources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [{ file: 'page.tsx', text: readFileSync(`${HERE}page.tsx`, 'utf8') }];
  for (const f of readdirSync(`${HERE}_workspace`, { recursive: true }) as string[]) {
    const rel = f.replace(/\\/g, '/');
    if (/\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)) out.push({ file: `_workspace/${rel}`, text: readFileSync(`${HERE}_workspace/${rel}`, 'utf8') });
  }
  return out;
}

/** The code without comments: a rule is about what runs and what is drawn. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const offenders = (re: RegExp) => sources().filter((s) => re.test(code(s.text))).map((s) => s.file);

test('there are sources to read, so the rules below are not holding nothing', () => {
  const files = sources().map((s) => s.file);
  assert.ok(files.length >= 25, `${files.length} files`);
  for (const must of ['page.tsx', '_workspace/ControlWorkspace.tsx', '_workspace/SummaryTab.tsx', '_workspace/RecordTestSheet.tsx', '_workspace/ApplicabilitySheet.tsx']) assert.ok(files.includes(must), must);
  assert.equal(existsSync(`${HERE}_assurance`), false, 'the old assurance folder is gone: its parts are in _workspace');
});

test('the page is only the address', () => {
  const page = readFileSync(`${HERE}page.tsx`, 'utf8');
  assert.ok(page.split('\n').length < 20, 'page.tsx is a few lines');
  assert.ok(/<ControlWorkspace\s/.test(page));
});

test('no native confirm, alert or prompt: a question is the kit\'s ConfirmDialog (useConfirm), a report a toast or a notice', () => {
  assert.deepEqual(offenders(/\bwindow\.(?:confirm|alert|prompt)\b|(?<![\w.])(?:alert|prompt)\(|(?<![\w.])confirm\(\s*['"`]/), []);
});

test('no text under 12px', () => {
  assert.deepEqual(offenders(/(?<![\w-])text-\[(?:[0-9]|10|11)(?:\.\d+)?px\]/), []);
  for (const f of ['CustomControlForm', 'RecordLinker', 'ScfControlPicker', 'CreateControlDialog']) {
    assert.equal(/(?<![\w-])text-\[(?:[0-9]|10|11)(?:\.\d+)?px\]/.test(readFileSync(`${SOC2}${f}.tsx`, 'utf8')), false, f);
    assert.equal(/window\.(?:confirm|alert|prompt)|(?<![\w.])confirm\(\s*['"`]/.test(code(readFileSync(`${SOC2}${f}.tsx`, 'utf8'))), false, `${f}: no native dialog`);
  }
});

test('nothing appears only on hover (a control reachable by keyboard and touch is drawn)', () => {
  assert.deepEqual(offenders(/opacity-0[^"'`]*group-hover|group-hover:opacity|invisible[^"'`]*group-hover/), []);
});

test('none of the utilities the platform stylesheet repaints in the shell: palette colours, named sizes, bold, named shadows and radii', () => {
  const palette = /(?<![\w-])(?:bg|text|border|ring|divide|from|to|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|primary)(?:-\d{2,3})?(?![\w-])/;
  assert.deepEqual(offenders(palette), [], 'palette colours');
  assert.deepEqual(offenders(/(?<![\w-])text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl)(?![\w-])/), [], 'named text sizes');
  assert.deepEqual(offenders(/(?<![\w-])font-(?:bold|semibold|extrabold)(?![\w-])/), [], 'named weights');
  assert.deepEqual(offenders(/(?<![\w-])shadow-(?:sm|md|lg|xl|2xl)(?![\w-])/), [], 'named shadows');
  assert.deepEqual(offenders(/(?<![\w-])rounded-(?:sm|md|lg|xl|2xl|3xl)(?![\w-])/), [], 'named radii');
});

test('no model or vendor name, and no screen says "Steampipe"', () => {
  assert.deepEqual(offenders(/Steampipe|gpt-|openai|anthropic/i), []);
});

test('the buttons ask for the rights as the server reads them, never the platform\'s wildcard reading', () => {
  assert.deepEqual(offenders(/hasPermission\(|hasAnyPermission\(/), []);
});

test('no id or technical word is drawn (Rule U1): no "#" + id, no "User 12", no vendor #, no raw ISO date, no viewer-locale date', () => {
  assert.deepEqual(offenders(/`[^`]*(?:vendor|Vendor|Exception|exception|User|user) #?\$\{/), [], 'an id in a sentence');
  assert.deepEqual(offenders(/(?:vendor|Exception) #\$\{|`User \$\{|\bUser \{/), [], 'an id behind a label');
  assert.deepEqual(offenders(/toLocale(?:Date|Time)?String\(|toISOString\(\)\.slice/), [], 'a date written with the viewer\'s locale or as raw ISO');
});

test('a picker never reads the first 100 of a register (risksApi.getAll, assetsApi.getAll): it searches on the server', () => {
  assert.deepEqual(offenders(/risksApi\.getAll|assetsApi\.getAll/), []);
});

test('a mutation reports: no bare useMutation in the workspace (useReportedMutation, or the run hook that reports)', () => {
  assert.deepEqual(offenders(/(?<![\w.])useMutation\(/), []);
});
