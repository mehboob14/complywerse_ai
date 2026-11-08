// node --test "src/components/assessments/workspace/kinds.test.ts"
// The kinds of assessment: names, groups, and which formats keep structured data in `remarks` (the generic editor leaves that field out for them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { isNist, kindOf, KINDS } from './kinds.ts';

test('known formats have their name and the board\'s group; an unknown one reads as itself in Other', () => {
  assert.deepEqual([kindOf('asvs_checklist').label, kindOf('asvs_checklist').category], ['OWASP ASVS', 'Cyber Security']);
  assert.equal(kindOf('pdpl_assessment_toolkit').category, 'Privacy & Data');
  assert.equal(kindOf('ubl_audit_master_tracking').category, 'Audit');
  assert.deepEqual([kindOf('cis_windows_server_2012_r2_pdf').label, kindOf('cis_windows_server_2012_r2_pdf').category], ['CIS benchmark', 'Cyber Security']);
  assert.deepEqual([kindOf('nca_new_thing').label, kindOf('nca_new_thing').category], ['Nca new thing', 'NCA']);
  assert.deepEqual([kindOf('brand_new_format').label, kindOf('brand_new_format').category], ['Brand new format', 'Other']);
  assert.equal(kindOf(null).label, 'Assessment');
  assert.equal(kindOf('constructor').category, 'Other', 'not an inherited property');
});

test('the formats whose score reads `remarks` do not offer it as free text; the plain checklists do', () => {
  for (const f of ['asvs_checklist', 'mobile_app_security', 'xlsx_maturity', 'digital_ops_maturity', 'csir_maturity', 'dpia_pia', 'nca_risk_register', 'pdpl_assessment_toolkit']) assert.equal(kindOf(f).structuredRemarks, true, f);
  for (const f of ['standard', 'owasp_v4_testing_checklist', 'ubl_audit_master_tracking', 'nist_800_53a']) assert.equal(kindOf(f).structuredRemarks, false, f);
});

test('every category the server assigns is the one this table says (backend scoring.CATEGORY)', () => {
  const url = new URL('../../../../../backend/grc/modules/assessments/scoring.py', import.meta.url);
  if (!existsSync(url)) return;
  const block = /CATEGORY = \{([\s\S]*?)\n\}/.exec(readFileSync(url, 'utf8'));
  assert.ok(block, 'the backend lists its categories');
  const pairs = Array.from((block as RegExpExecArray)[1].matchAll(/"([a-z0-9_]+)":\s*"([^"]+)"/g));
  assert.ok(pairs.length >= 18);
  for (const [, format, category] of pairs) assert.equal(kindOf(format).category, category, format);
});

test('isNist names the two library-made formats', () => {
  assert.ok(isNist('nist_800_53a') && isNist('nist_csf2') && !isNist('asvs_checklist') && !isNist(null));
  assert.ok(Object.keys(KINDS).length > 15);
});
