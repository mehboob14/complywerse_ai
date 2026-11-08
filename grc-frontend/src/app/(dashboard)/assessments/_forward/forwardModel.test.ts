// node --test "src/app/(dashboard)/assessments/_forward/forwardModel.test.ts"
// The old addresses of Assessments and where each goes now: no bookmark, e-mail or task link is lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { APPROVALS, CONTROL_CENTER, cyberTarget, isMadePerSubject, ncaPlan, planForKey, targetFor } from './forwardModel.ts';
import { TYPE_INFO } from '../../../../components/compliance/scoping/scopingModel.ts';

test('/assessments/<key>: a kind that is one workbook is looked up; a kind made per application is the register of it', () => {
  assert.deepEqual(planForKey('dpia'), { resolve: 'dpia_pia' });
  assert.deepEqual(planForKey('pdpl'), { resolve: 'pdpl_assessment_toolkit' });
  assert.deepEqual(planForKey('digital_ops_maturity'), { resolve: 'digital_ops_maturity' });
  assert.deepEqual(planForKey('cs_kpi'), { resolve: 'kpi_report' }, 'the Performance Overview links here');
  assert.deepEqual(planForKey('internal_audit'), { resolve: 'ubl_audit_master_tracking' });
  assert.deepEqual(planForKey('maturity'), { resolve: 'xlsx_maturity' });
  assert.deepEqual(planForKey('nca_vuln'), { resolve: 'nca_vuln_register' });
  assert.deepEqual(planForKey('asvs'), { go: '/assessments/register?type=asvs_checklist' });
  assert.deepEqual(planForKey('cs_mobile'), { go: '/assessments/register?type=mobile_app_security' });
  assert.deepEqual(planForKey('owasp_testing'), { go: '/assessments/register?type=owasp_v4_testing_checklist' });
});

test('/assessments/nca: the organization\'s own DCC workbook when there is one, else the NCA workspace, as the old page did', () => {
  assert.deepEqual(planForKey('nca'), { resolve: 'nca_dcc_tool', orElse: '/assessments/a/nca' });
  assert.deepEqual(planForKey('NCA'), { resolve: 'nca_dcc_tool', orElse: '/assessments/a/nca' });
  assert.deepEqual(planForKey('nca_container'), { go: '/assessments/a/nca' });
});

test('a key nobody knows, the Overview and a CIS benchmark go somewhere that makes sense; a real format typed in full is understood', () => {
  assert.deepEqual(planForKey(undefined), { go: '/assessments' });
  assert.deepEqual(planForKey('overview'), { go: '/assessments' });
  assert.deepEqual(planForKey('nonsense'), { go: '/assessments/register' });
  assert.deepEqual(planForKey('%E0%A4%A'), { go: '/assessments/register' }, 'an address that is not text is not an error');
  assert.deepEqual(planForKey('cis'), { go: '/assessments/register?q=cis' });
  assert.deepEqual(planForKey('cis_windows_server_2012_r2_pdf'), { go: '/assessments/register?q=cis' });
  assert.deepEqual(planForKey('dpia_pia'), { resolve: 'dpia_pia' });
  assert.deepEqual(planForKey('constructor'), { go: '/assessments/register' }, 'not a key of any table');
  assert.deepEqual(planForKey('__proto__'), { go: '/assessments/register' });
});

test('once the assessments of a kind are known: one opens, none goes where it is uploaded, several go to the register', () => {
  assert.equal(targetFor('dpia_pia', { rows: [{ id: 12 }], total: 1 }), '/assessments/a/12');
  assert.equal(targetFor('dpia_pia', { rows: [], total: 0 }), '/assessments/types?type=dpia_pia');
  assert.equal(targetFor('dpia_pia', { rows: [{ id: 1 }, { id: 2 }], total: 2 }), '/assessments/register?type=dpia_pia');
  assert.equal(targetFor('dpia_pia', { rows: [{ id: 1 }, { id: 2 }], total: 40 }), '/assessments/register?type=dpia_pia', 'the true total decides, not the two rows asked for');
  assert.equal(targetFor('nca_dcc_tool', { rows: [], total: 0 }, '/assessments/a/nca'), '/assessments/a/nca');
});

test('/cyber-security?tab=: the hub\'s Overview, each type and the NIST library', () => {
  assert.equal(cyberTarget(undefined), '/assessments');
  assert.equal(cyberTarget('overview'), '/assessments');
  assert.equal(cyberTarget('bogus'), '/assessments');
  for (const [format, info] of Object.entries(TYPE_INFO)) assert.equal(cyberTarget(info.tab), `/assessments/register?type=${format}`, info.tab);
  assert.equal(cyberTarget('nist_library'), '/assessments/types?tab=nist');
  assert.equal(cyberTarget('nist_library', 'nist_csf2'), '/assessments/types?tab=nist&assessment=nist_csf2');
  assert.equal(cyberTarget('nist_library', 'x'), '/assessments/types?tab=nist');
});

test('/nca?tab=: the Overview is the register on NCA; a tab is that workbook', () => {
  assert.deepEqual(ncaPlan(undefined), { go: '/assessments/register?category=nca' });
  assert.deepEqual(ncaPlan('overview'), { go: '/assessments/register?category=nca' });
  assert.deepEqual(ncaPlan('dcc'), { resolve: 'nca_dcc_tool' });
  assert.deepEqual(ncaPlan('nca_vuln'), { resolve: 'nca_vuln_register' });
  assert.deepEqual(ncaPlan('nca_audit'), { resolve: 'nca_audit_register' });
  assert.deepEqual(ncaPlan('nca_risk'), { resolve: 'nca_risk_register' });
  assert.deepEqual(ncaPlan('pdpl'), { go: '/assessments/register?category=nca' }, 'only an NCA tab');
});

test('the Control Center is where workbooks are uploaded now; Pending Approvals is the register\'s Waiting for me view', () => {
  assert.equal(CONTROL_CENTER, '/assessments/types');
  assert.equal(APPROVALS, '/assessments/register?quick=waiting');
  assert.equal(isMadePerSubject('asvs_checklist'), true);
  assert.equal(isMadePerSubject('nist_csf2'), true);
  assert.equal(isMadePerSubject('dpia_pia'), false);
});
