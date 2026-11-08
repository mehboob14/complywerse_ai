// Where the old addresses of Assessments go now, apart from React so `node --test` pins it (forwardModel.test.ts). Every address a bookmark, an e-mail or a task may hold keeps working:
//   /assessments/<key>           the old type pages (the sidebar's DPIA / PIA, Saudi PDPL and Digital Operations Maturity, the KPI report link of the Performance Overview, the typed keys)
//   /cyber-security?tab=<tab>    the Cyber Security hub (its Overview, its seven types, the NIST library)
//   /nca?tab=<tab>               the NCA hub (its Overview, the DCC tool, the three registers)
//   /compliance/assessments      the Assessment Control Center      /compliance/assessments/approvals   Pending Approvals
// A kind that is one workbook (DPIA, PDPL, the NCA registers ...) goes to its assessment when there is exactly one, to Types (where it is uploaded) when there is none, and to the register
// filtered by the kind when there are several; a kind that is made per application goes to the register filtered by it. A forward never loses the person: an address it cannot read goes to the register.
import { KINDS } from '../../../../components/assessments/workspace/kinds.ts';
import { NIST_INFO, TYPE_INFO, typeOfTab } from '../../../../components/compliance/scoping/scopingModel.ts';

export const OVERVIEW = '/assessments';
export const REGISTER = '/assessments/register';
export const TYPES = '/assessments/types';
export const NCA_WORKSPACE = '/assessments/a/nca';

/** Where to go: an address now, or a kind whose assessments must be looked up first. */
export type Plan = { go: string } | { resolve: string; orElse?: string };

// the keys of /assessments/<key> (the Control Center's tab keys) and the format each one is
const FORMAT_OF_KEY: Readonly<Record<string, string>> = {
  internal_audit: 'ubl_audit_master_tracking',
  maturity: 'xlsx_maturity',
  asvs: 'asvs_checklist',
  owasp_testing: 'owasp_v4_testing_checklist',
  cs_mobile: 'mobile_app_security',
  cs_csir: 'csir_maturity',
  cs_cti: 'cti_maturity',
  cs_incident: 'incident_maturity',
  cs_itsecops: 'itsecops_maturity',
  cs_kpi: 'kpi_report',
  dpia: 'dpia_pia',
  standard: 'standard',
  nca_vuln: 'nca_vuln_register',
  nca_audit: 'nca_audit_register',
  nca_risk: 'nca_risk_register',
  nca_dcc: 'nca_dcc_tool',
  pdpl: 'pdpl_assessment_toolkit',
  digital_ops_maturity: 'digital_ops_maturity',
};

/** A kind made per application, function or system: it has many assessments, so its address is the register, never one of them. */
export const isMadePerSubject = (format: string): boolean => format in TYPE_INFO || format in NIST_INFO;

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** `/assessments/<key>`. */
export function planForKey(raw: string | null | undefined): Plan {
  let key = String(raw ?? '').trim().toLowerCase();
  try { key = decodeURIComponent(key); } catch { /* an address that is not text stays as it is */ }
  if (key === '' || key === 'overview') return { go: OVERVIEW };
  // the old NCA page showed the organization's own DCC workbook when it had uploaded one, else the NCA workspace: so do we
  if (key === 'nca') return { resolve: 'nca_dcc_tool', orElse: NCA_WORKSPACE };
  if (key === 'nca_container') return { go: NCA_WORKSPACE };
  if (key === 'cis' || key.startsWith('cis_')) return { go: `${REGISTER}?q=cis` };
  const format = has(FORMAT_OF_KEY, key) ? FORMAT_OF_KEY[key] : has(KINDS, key) ? key : null;
  if (!format) return { go: REGISTER };
  return isMadePerSubject(format) ? { go: `${REGISTER}?type=${format}` } : { resolve: format };
}

/** What to do once the assessments of a kind are known: `total` is the server's true count, `rows` at most the first two; `orElse` is where none goes (Types, where it is uploaded, when it names nothing). */
export function targetFor(format: string, found: { rows: ReadonlyArray<{ id: number }>; total: number }, orElse?: string): string {
  if (found.total === 1 && found.rows[0]) return `/assessments/a/${found.rows[0].id}`;
  if (found.total === 0) return orElse ?? `${TYPES}?type=${format}`;
  return `${REGISTER}?type=${format}`;
}

/** `/cyber-security?tab=<tab>[&assessment=<format>]`: the hub's Overview is the Overview, a type tab is the register of that type, the NIST library is a tab of Types. */
export function cyberTarget(tab: string | null | undefined, assessment?: string | null): string {
  const t = String(tab ?? '').trim();
  if (t === 'nist_library') {
    const a = String(assessment ?? '').trim();
    return `${TYPES}?tab=nist${has(NIST_INFO, a) ? `&assessment=${a}` : ''}`;
  }
  const format = typeOfTab(t);
  return format ? `${REGISTER}?type=${format}` : OVERVIEW;
}

/** `/nca?tab=<tab>`: the hub's Overview is the register on NCA; a tab is that workbook's assessment. */
export function ncaPlan(tab: string | null | undefined): Plan {
  const t = String(tab ?? '').trim();
  const format = t === 'dcc' ? 'nca_dcc_tool' : has(FORMAT_OF_KEY, t) && t.startsWith('nca_') ? FORMAT_OF_KEY[t] : null;
  return format ? { resolve: format } : { go: `${REGISTER}?category=nca` };
}

/** The Assessment Control Center and Pending Approvals. */
export const CONTROL_CENTER = TYPES;
export const APPROVALS = `${REGISTER}?quick=waiting`;
