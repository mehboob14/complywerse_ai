// node --test "src/app/(dashboard)/automation/automationSource.test.ts"
// The source rules of the Controls Automation pages this group rebuilt (the Overview, the Controls explorer, Coverage, Mapping review, Audit periods, Connections), held where a screen test cannot reach: no native
// confirm / alert / prompt (every question is the kit's ConfirmDialog, every report a toast or a notice), no text under 12px, nothing that appears only on hover, and none of the named utilities the platform
// stylesheet repaints inside the shell (palette colours, named sizes, bold). The kit's own guard (components/ui/ds/kitGuard.test.ts) holds the kit folder to the same list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DASHBOARD = fileURLToPath(new URL('../', import.meta.url));

// the folders and files of the group (never the control page `[code]`, the Catalog or the Library: other builders')
const FOLDERS = [
  'automation/overview', 'automation/soc2-controls/_explorer', 'automation/soc2-controls/coverage', 'automation/soc2-controls/review', 'automation/assurance', 'automation/checks',
  'admin/evidence-collectors',
];
const FILES = ['automation/soc2-controls/page.tsx', 'automation/soc2-controls/new/page.tsx'];

function sources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const folder of FOLDERS) {
    for (const f of readdirSync(`${DASHBOARD}${folder}`, { recursive: true }) as string[]) {
      const rel = f.replace(/\\/g, '/');
      if (/\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)) out.push({ file: `${folder}/${rel}`, text: readFileSync(`${DASHBOARD}${folder}/${rel}`, 'utf8') });
    }
  }
  for (const file of FILES) out.push({ file, text: readFileSync(`${DASHBOARD}${file}`, 'utf8') });
  return out;
}

/** The code without comments: a rule is about what runs and what is drawn. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const offenders = (re: RegExp) => sources().filter((s) => re.test(code(s.text))).map((s) => s.file);

test('there are sources to read, so the rules below are not holding nothing', () => {
  const files = sources().map((s) => s.file);
  assert.ok(files.length >= 25, `${files.length} files`);
  for (const must of ['automation/overview/page.tsx', 'automation/soc2-controls/_explorer/ControlsExplorer.tsx', 'admin/evidence-collectors/ConnectorSheet.tsx', 'automation/assurance/_periods/AuditPeriods.tsx']) assert.ok(files.includes(must), must);
});

test('no native confirm, alert or prompt: a question is the kit\'s ConfirmDialog (useConfirm), a report is a toast or a notice', () => {
  assert.deepEqual(offenders(/\bwindow\.(?:confirm|alert|prompt)\b|(?<![\w.])(?:alert|prompt)\(|(?<![\w.])confirm\(\s*['"`]/), []);
});

test('no text under 12px', () => {
  assert.deepEqual(offenders(/(?<![\w-])text-\[(?:[0-9]|10|11)(?:\.\d+)?px\]/), []);
});

test('nothing appears only on hover (a control reachable by keyboard and touch is drawn)', () => {
  assert.deepEqual(offenders(/opacity-0[^"'`]*group-hover|group-hover:opacity|invisible[^"'`]*group-hover/), []);
});

test('none of the utilities the platform stylesheet repaints in the shell: palette colours, named sizes, bold, named shadows and radii', () => {
  const palette = /(?<![\w-])(?:bg|text|border|ring|divide|from|to|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|primary)(?:-\d{2,3})?(?![\w-])/;
  const sizes = /(?<![\w-])text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl)(?![\w-])/;
  const weights = /(?<![\w-])font-(?:bold|semibold|extrabold)(?![\w-])/;
  const shadows = /(?<![\w-])shadow-(?:sm|md|lg|xl|2xl)(?![\w-])/;
  const radii = /(?<![\w-])rounded-(?:sm|md|lg|xl|2xl|3xl)(?![\w-])/;
  // the connector sheet and the explorer rows are drawn inside portals and the shell alike: they take tokens only
  assert.deepEqual(offenders(palette), [], 'palette colours');
  assert.deepEqual(offenders(sizes), [], 'named text sizes');
  assert.deepEqual(offenders(weights), [], 'named weights');
  assert.deepEqual(offenders(shadows), [], 'named shadows');
  assert.deepEqual(offenders(radii), [], 'named radii');
});

test('the Overview and the explorer name no model or vendor, and no screen says "Steampipe"', () => {
  assert.deepEqual(offenders(/Steampipe|gpt-|openai|anthropic/i), []);
});

test("the buttons ask for the rights as the server reads them (useRights), never the platform's wildcard reading", () => {
  assert.deepEqual(offenders(/hasPermission\(|hasAnyPermission\(/), []);
});
