// node --test "src/components/assessments/lenses/lensRules.test.ts"
// The type lenses are built on the design-system kit, so they follow its rules (components/ui/ds/kitRules.ts) and the reviewer's: no palette class, named text size, radius or shadow, no
// text under 12px, no bare outline-none; no native confirm/alert/prompt; no action that shows only on hover; a <p>, <td>, <th>, <h2>, <h3> with a size of its own; nothing technical in a
// sentence a person reads (Rule U1); an edit travels as a JSON body, never in the query string; a GET never writes (the KPI snapshot is a POST after the read); every older tab of
// components/compliance is a bridge to its lens; and the registry knows every type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { findViolations } from '../../ui/ds/kitRules.ts';

const DIR = 'src/components/assessments/lenses';
const BRIDGES = ['ASVSAssessmentTab', 'OwaspTestingTab', 'MobileAppSecurityTab', 'MaturityAssessmentTab', 'PDPLAssessmentTab', 'DpiaAssessmentTab', 'DccToolTab', 'NcaRegisterTab', 'KpiReportTab', 'NcaTab']
  .map((n) => `src/components/compliance/${n}.tsx`);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name).replace(/\\/g, '/');
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}
const FILES = walk(DIR);
const TSX = [...FILES, ...BRIDGES].filter((f) => f.endsWith('.tsx'));
const src = (f: string) => readFileSync(f, 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('every file of the lenses and every bridge follows the kit rules', () => {
  assert.ok(FILES.length >= 20, 'the files are there');
  const bad = TSX.flatMap((f) => findViolations(src(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native dialog, no hover-only action, no download link to an API path', () => {
  for (const f of [...TSX, 'src/components/compliance/ArtifactsTab.tsx']) {
    const s = code(src(f));
    assert.doesNotMatch(s, /(?<![\w.])window\.(confirm|alert|prompt)\(|(?<![\w.])(alert|prompt)\(|(?<!await )(?<![\w.])confirm\(/, `${f}: a native dialog (the kit's useConfirm is awaited)`);
    assert.doesNotMatch(s, /opacity-0[^'"`]*group-hover|group-hover:opacity-100/, `${f}: an action that shows only on hover`);
    assert.doesNotMatch(s, /href=\{?[`'"]\/api\//, `${f}: a download is authedFetch or the api client, not a link to /api`);
  }
});

test('the shared Artifacts tab has no text under 12px class left', () => {
  assert.doesNotMatch(src('src/components/compliance/ArtifactsTab.tsx'), /text-\[(9|10|10\.5|11|11\.5)px\]/);
});

test('a <p>, <td>, <th>, <h2> or <h3> names its own text size (the platform gives a bare one 11.5px)', () => {
  const bad: string[] = [];
  for (const f of TSX) for (const m of Array.from(code(src(f)).matchAll(/<(p|td|th|h2|h3)(\s[^>]*)?>/g))) if (!/text-ds-(title|section|body|label)|text-\[\d/.test(m[0])) bad.push(`${f}: ${m[0].slice(0, 80)}`);
  assert.deepEqual(bad, []);
});

test('nothing technical reaches a screen: no id, hash, endpoint or HTTP word in the sentences', () => {
  const words = /\b(sha-?256|checksum|fingerprint|uuid|stack ?trace|endpoint|HTTP \d{3}|\/api\/|remarks)\b/i;
  for (const f of TSX) {
    const text = Array.from(code(src(f)).matchAll(/>\s*([A-Z][^<>{}]{12,})</g)).map((m) => m[1]).concat(Array.from(code(src(f)).matchAll(/(?:title|description|message|label|hint|info|note)=["']([^"']{12,})["']/g)).map((m) => m[1]));
    for (const t of text) assert.doesNotMatch(t, words, `${f}: "${t.slice(0, 60)}"`);
  }
});

test('an edit travels as a JSON body: the answer, the details and the screening are never in the URL', () => {
  const api = src(`${DIR}/lensApi.ts`);
  assert.match(api, /apiClient\.put\(`\$\{BASE\}\/items\/\$\{itemId\}`, body\.compliance_status \?/);
  for (const f of FILES) assert.doesNotMatch(code(src(f)), /params:\s*\{?\s*(remarks|compliance_status|maturity_score|gaps_identified|proposed_solution)\b/, `${f}: a field in the query string`);
  assert.match(src(`${DIR}/DpiaLens.tsx`), /workspaceApi\.updateItem\(item\.id, \{ remarks: withField/);
});

test('Not answered is never sent as in_progress (the server saves that as Partially complied)', () => {
  const api = src(`${DIR}/lensApi.ts`);
  assert.match(api, /answerWord\(body\.compliance_status\)/);
  const data = src(`${DIR}/lensData.ts`);
  assert.match(data, /status === 'in_progress' \? 'pending' : status/);
});

test('a GET never writes: the KPI values are read by GET and the snapshot is one POST after the read', () => {
  const api = src(`${DIR}/lensApi.ts`);
  assert.match(api, /kpiLive: async[^\n]*apiClient\.get\(`\$\{BASE\}\/kpi-live`\)/);
  assert.match(api, /snapshotKpis: async[^\n]*apiClient\.post\(`\$\{BASE\}\/kpi-live\/snapshot`\)/);
  const lens = code(src(`${DIR}/KpiLens.tsx`));
  assert.match(lens, /if \(!live\.isSuccess \|\| kept\.current\) return;/, 'once per visit, after the read has succeeded');
  assert.match(lens, /lensApi\.snapshotKpis\(\)\.catch\(\(\) => undefined\)/, 'fire and forget');
  for (const f of ['src/components/compliance/KpiReportTab.tsx', 'src/components/compliance/NcaTab.tsx']) assert.doesNotMatch(code(src(f)), /kpi-live|nca\/container/, `${f}: the bridge reads through the lens`);
});

test('every older tab of components/compliance is a bridge to its lens: no query of its own, no dialog of its own', () => {
  for (const f of BRIDGES) {
    const s = code(src(f));
    assert.ok(s.split('\n').filter((l) => l.trim()).length < 45, `${f}: a bridge is short`);
    assert.doesNotMatch(s, /useQuery|useMutation|apiClient|<table/, `${f}: it asks for nothing itself`);
    assert.match(s, /components\/assessments\/lenses\//, `${f}: it draws the lens`);
  }
  for (const gone of ['DCCAssessmentTab', 'AuditPlanTab']) assert.throws(() => readFileSync(`src/components/compliance/${gone}.tsx`), /ENOENT/, `${gone} is replaced by a lens`);
});

test('a workbook upload names the kind of workbook it expects, so one kind cannot land under another', () => {
  assert.match(src(`${DIR}/Standalone.tsx`), /fd\.append\('expected_format', format\)/);
});

test('the registry gives every type of this group a lens, in the one list of the workspace', () => {
  const reg = src('src/components/assessments/workspace/lensRegistry.tsx');
  for (const f of ['asvs_checklist', 'owasp_v4_testing_checklist', 'mobile_app_security', 'nca_dcc_tool', 'pdpl_assessment_toolkit', 'dpia_pia', 'kpi_report', 'nca_vuln_register', 'nca_audit_register', 'nca_risk_register', 'nca_container'])
    assert.match(reg, new RegExp(`'${f}'`), `${f} has a lens`);
  for (const m of ['csir_maturity', 'cti_maturity', 'incident_maturity', 'itsecops_maturity', 'digital_ops_maturity']) assert.match(reg, new RegExp(`'${m}'`), `${m} has a lens`);
  const keys = Array.from(reg.matchAll(/\{ key: '([a-z-]+)'/g)).map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, 'a key is registered once');
  for (const reserved of ['controls', 'remediation', 'scope', 'people', 'plan']) assert.ok(!keys.includes(reserved), `${reserved} is a built-in tab`);
  for (const target of Array.from(reg.matchAll(/import\('\.\.\/lenses\/(\w+)'\)/g)).map((m) => m[1])) assert.ok(FILES.some((f) => f.endsWith(`/${target}.tsx`)), `${target} exists`);
});
