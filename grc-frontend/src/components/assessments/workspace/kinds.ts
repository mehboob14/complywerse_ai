// What kind of assessment a format is: its name, the group the board puts it in, and whether its controls keep structured data in the free-text `remarks` column.
// Pure (`node --test kinds.test.ts`). The category list mirrors `CATEGORY` in `backend/grc/modules/assessments/scoring.py`: the server's own names, so the workspace and the
// board speak of the same group. A format nobody listed reads as its readable form in "Other".

export type Category = 'Cyber Security' | 'NCA' | 'Digital Operations' | 'Privacy & Data' | 'Audit' | 'Other';

export interface KindInfo {
  label: string;
  category: Category;
  /** The score reads data out of `remarks` for this format (ASVS level, maturity weighting and target, DPIA ratings, register rows...). Editing `remarks` as plain text can change a
   *  score without anyone meaning it, so the generic editor does not offer the field (audit P-3, decision 5). */
  structuredRemarks: boolean;
}

const k = (label: string, category: Category, structuredRemarks = false): KindInfo => ({ label, category, structuredRemarks });

export const KINDS: Readonly<Record<string, KindInfo>> = {
  asvs_checklist: k('OWASP ASVS', 'Cyber Security', true),
  owasp_v4_testing_checklist: k('OWASP Testing', 'Cyber Security'),
  mobile_app_security: k('Mobile App Security', 'Cyber Security', true),
  csir_maturity: k('CSIR Maturity', 'Cyber Security', true),
  cti_maturity: k('CTI Maturity', 'Cyber Security', true),
  incident_maturity: k('Incident Management', 'Cyber Security', true),
  itsecops_maturity: k('IT Security Operations', 'Cyber Security', true),
  nist_800_53a: k('NIST SP 800-53A', 'Cyber Security'),
  nist_csf2: k('NIST CSF 2.0', 'Cyber Security'),
  nca_dcc_tool: k('NCA DCC assessment', 'NCA'),
  nca_vuln_register: k('NCA vulnerability register', 'NCA', true),
  nca_audit_register: k('NCA audit plan', 'NCA', true),
  nca_risk_register: k('NCA risk register', 'NCA', true),
  nca_cloud_cybersecurity_controls_pdf: k('NCA cloud controls', 'NCA'),
  nca_data_cybersecurity_controls_pdf: k('NCA data controls', 'NCA'),
  nca_container: k('NCA workspace', 'NCA'),
  digital_ops_maturity: k('Digital Operations Maturity', 'Digital Operations', true),
  xlsx_maturity: k('Maturity model', 'Digital Operations', true),
  dpia_pia: k('DPIA / PIA', 'Privacy & Data', true),
  pdpl_assessment_toolkit: k('Saudi PDPL', 'Privacy & Data', true),
  ubl_audit_master_tracking: k('Internal audit', 'Audit'),
  kpi_report: k('KPI report', 'Other'),
  standard: k('Standard', 'Other'),
};

/** "cis_windows_server_2012_r2_pdf" -> "Cis windows server 2012 r2 pdf": the readable form of a format nobody named. */
function readable(format: string): string {
  const words = format.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Assessment';
}

export function kindOf(format: string | null | undefined): KindInfo {
  const f = (format ?? '').trim();
  const known = Object.prototype.hasOwnProperty.call(KINDS, f) ? KINDS[f] : undefined;
  if (known) return known;
  if (f.startsWith('cis_')) return k('CIS benchmark', 'Cyber Security');
  if (f.startsWith('nca_')) return k(readable(f), 'NCA');
  return k(readable(f), 'Other');
}

export const isNist = (format: string | null | undefined): boolean => format === 'nist_800_53a' || format === 'nist_csf2';
