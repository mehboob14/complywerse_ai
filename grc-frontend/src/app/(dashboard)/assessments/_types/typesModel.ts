// The Types page's decisions, apart from React so `node --test` pins them (typesModel.test.ts): which kinds of assessment there are, in what groups, what each needs before it starts, how it
// begins (Start for the kinds made per application, function or system; Upload for the kinds that arrive as a workbook; Open for the NCA workspace), and what the table says about each.
// The words of the nine Cyber Security kinds are the scoping screens' (scopingModel.ts); the workbook kinds are written here, short and in plain words.
import { KINDS, kindOf, type Category } from '../../../../components/assessments/workspace/kinds.ts';
import { NIST_INFO, TYPE_INFO, infoOf } from '../../../../components/compliance/scoping/scopingModel.ts';
import { CATEGORIES } from '../_data/categories.ts';
import type { ListRow, Template } from '../_data/types.ts';

export type Begin = 'start' | 'upload' | 'open';

export interface TypeSpec {
  format: string;
  label: string;
  category: Category;
  begin: Begin;
  /** what it is of: "application", "function", "system", or "workbook" */
  subject: string;
  about: string;
  needs: readonly string[];
  /** how it is answered; null for a workbook kind (its own sheets say) */
  how: string | null;
  /** NIST kinds: what each control lists */
  method: string | null;
  /** a workbook kind is uploaded under its own name (the server then refuses another kind of workbook); the generic one accepts any */
  expectFormat: string | null;
}

const WORKBOOK = (format: string, about: string, needs: readonly string[], over: Partial<TypeSpec> = {}): TypeSpec => ({
  format, label: kindOf(format).label, category: kindOf(format).category, begin: 'upload', subject: 'workbook', about, needs, how: null, method: null, expectFormat: format, ...over,
});

const SCORED = (format: string): TypeSpec => {
  const info = infoOf(format) as NonNullable<ReturnType<typeof infoOf>>;
  return {
    format, label: info.label, category: kindOf(format).category, begin: 'start', subject: info.subject, about: info.about, needs: info.needs, how: info.how, method: NIST_INFO[format]?.method ?? null, expectFormat: null,
  };
};

/** The workbook kinds: assessments that arrive as an Excel file (or, for the NCA controls and benchmarks, a PDF) and are kept as it was filled in. */
export const WORKBOOKS: readonly TypeSpec[] = [
  WORKBOOK('nca_dcc_tool', 'The NCA data cybersecurity controls (DCC) assessment workbook. Every control is answered with its status, remarks and the evidence behind it.', ['The DCC assessment workbook (.xlsx)']),
  WORKBOOK('nca_cloud_cybersecurity_controls_pdf', 'The NCA cloud cybersecurity controls as a PDF: each control becomes a row to answer.', ['The NCA cloud cybersecurity controls document (.pdf)'], { expectFormat: null, subject: 'document' }),
  WORKBOOK('nca_data_cybersecurity_controls_pdf', 'The NCA data cybersecurity controls as a PDF: each control becomes a row to answer.', ['The NCA data cybersecurity controls document (.pdf)'], { expectFormat: null, subject: 'document' }),
  WORKBOOK('nca_vuln_register', 'The vulnerability register workbook: each row is a vulnerability with its severity, owner and remediation status.', ['The vulnerability register workbook (.xlsx)']),
  WORKBOOK('nca_audit_register', 'The audit plan workbook: each row is a planned audit with its scope, owner and dates.', ['The audit plan workbook (.xlsx)']),
  WORKBOOK('nca_risk_register', 'The risk register workbook: each row is a risk with its likelihood, impact and treatment.', ['The risk register workbook (.xlsx)']),
  WORKBOOK('digital_ops_maturity', 'The Digital Operations Maturity workbook: each capability is scored from 1 to 5 against its target.', ['The Digital Operations Maturity workbook (.xlsx)']),
  WORKBOOK('xlsx_maturity', 'A maturity-model workbook: each subcategory has a policy maturity and a practice maturity.', ['The maturity-model workbook (.xlsx)']),
  WORKBOOK('dpia_pia', 'The data protection impact assessment workbook: a screening, the risks with their likelihood and impact, and how each is treated.', ['The DPIA / PIA workbook (.xlsx)']),
  WORKBOOK('pdpl_assessment_toolkit', 'The Saudi Personal Data Protection Law assessment toolkit: its controls, their status and a remediation plan.', ['The PDPL assessment toolkit (.xlsx)']),
  WORKBOOK('kpi_report', 'The cyber security KPI report workbook, shown beside live figures from the platform.', ['The KPI report workbook (.xlsx)']),
  WORKBOOK('ubl_audit_master_tracking', 'The internal audit master tracking workbook: audit points with their owner, status and closure. Internal audits are also kept in the Auditor Portal.', ['The internal audit tracking workbook (.xlsx)']),
  WORKBOOK('standard', 'Any other standard or checklist workbook, for example a CIS benchmark: each row becomes a control.', ['The workbook (.xlsx, .xls, .csv) or a supported PDF'], { label: 'Other standard or benchmark', category: 'Other', expectFormat: null }),
];

/** The NCA workspace the organization keeps inside the platform (the DCC catalogue and the audit plan): it is opened, never uploaded. */
export const NCA_WORKSPACE: TypeSpec = {
  format: 'nca_container', label: kindOf('nca_container').label, category: 'NCA', begin: 'open', subject: 'workspace', expectFormat: null, how: null, method: null,
  about: 'The organization\'s own NCA workspace: the data cybersecurity controls catalogue and the audit plan, kept inside the platform.',
  needs: [],
};

/** Every kind, in the order the page lists them inside a group: the nine made per application, function or system, then the NCA workspace, then the workbooks. */
export const SPECS: readonly TypeSpec[] = [
  ...[...Object.keys(TYPE_INFO), ...Object.keys(NIST_INFO)].map(SCORED),
  NCA_WORKSPACE,
  ...WORKBOOKS,
];

export const specOf = (format: string | null | undefined): TypeSpec | undefined => SPECS.find((s) => s.format === (format ?? '').trim());

export type Questionnaire = { state: 'uploaded'; name: string; items: number } | { state: 'missing' } | { state: 'library' } | { state: 'none' };

export interface TypeRow extends TypeSpec {
  /** how many assessments of this kind there are (from the register's list) */
  count: number;
  /** in the scoped kinds: how many are being scoped and how many are under way */
  scoping: number;
  inProgress: number;
  questionnaire: Questionnaire;
  /** Start needs the questionnaire the assessment is made from */
  canBegin: boolean;
  /** where "Open" goes: its register view, or the one assessment's workspace */
  openHref: string | null;
  /** the questionnaire's own page (the scoped kinds made from a workbook) */
  questionnaireHref: string | null;
}

function questionnaireOf(spec: TypeSpec, template: Template | undefined): Questionnaire {
  if (spec.begin !== 'start') return { state: 'none' };
  if (NIST_INFO[spec.format]) return { state: 'library' };
  const q = template?.questionnaire;
  return q ? { state: 'uploaded', name: q.name, items: q.items } : { state: 'missing' };
}

/** The table's rows: every kind with the number of assessments of it and what it starts from. `list` and `templates` are undefined while they have not answered (counts are then 0 and Start waits). */
export function typeRows(list: readonly ListRow[] | undefined, templates: readonly Template[] | undefined): TypeRow[] {
  const byFormat = new Map<string, ListRow[]>();
  (list ?? []).forEach((r) => byFormat.set(r.assessment_format, [...(byFormat.get(r.assessment_format) ?? []), r]));
  return SPECS.map((spec) => {
    const rows = byFormat.get(spec.format) ?? [];
    const template = templates?.find((t) => t.assessment_format === spec.format);
    const questionnaire = questionnaireOf(spec, template);
    const only = rows.length === 1 ? rows[0] : null;
    return {
      ...spec,
      count: rows.length,
      scoping: rows.filter((r) => r.phase === 'scoping').length,
      inProgress: rows.filter((r) => r.phase === 'in_progress').length,
      questionnaire,
      canBegin: spec.begin !== 'start' || questionnaire.state === 'uploaded' || questionnaire.state === 'library',
      openHref: spec.format === 'nca_container' ? '/assessments/a/nca' : only ? `/assessments/a/${only.id}` : rows.length > 1 ? `/assessments/register?type=${spec.format}` : null,
      questionnaireHref: spec.begin === 'start' && !NIST_INFO[spec.format] ? `/cyber-security/questionnaires/${spec.format}` : null,
    };
  });
}

export interface TypeGroup { category: Category; rows: TypeRow[] }

/** The rows in groups, in the order of the server's categories; a group with no kind is left out. */
export function groupRows(rows: readonly TypeRow[]): TypeGroup[] {
  return CATEGORIES.map((c) => ({ category: c.name as Category, rows: rows.filter((r) => r.category === c.name) })).filter((g) => g.rows.length > 0);
}

/** The count in words: "3 assessments (1 being scoped)", "1 assessment", "None yet". */
export function countWords(r: Pick<TypeRow, 'count' | 'scoping'>): string {
  if (r.count === 0) return 'None yet';
  const base = `${r.count} ${r.count === 1 ? 'assessment' : 'assessments'}`;
  return r.scoping > 0 ? `${base} (${r.scoping} being scoped)` : base;
}

/** What the questionnaire column says. */
export function questionnaireWords(q: Questionnaire): string {
  switch (q.state) {
    case 'uploaded': return `${q.items} ${q.items === 1 ? 'question' : 'questions'}`;
    case 'missing': return 'Not uploaded yet';
    case 'library': return 'From the NIST library';
    default: return '—';
  }
}

/** The files the server reads as a workbook (the upload route says the same). */
export const WORKBOOK_ACCEPT = '.xlsx,.xls,.xlsm,.csv,.pdf';
export const WORKBOOK_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.csv', '.pdf'] as const;

/** What is wrong with the chosen file ("" when nothing): it has a name the server reads, and is not empty. */
export function fileProblem(file: { name: string; size: number } | null | undefined): string {
  if (!file) return 'Choose the workbook to upload.';
  const lower = file.name.toLowerCase();
  if (!WORKBOOK_EXTENSIONS.some((e) => lower.endsWith(e))) return 'The file must be an Excel workbook (.xlsx, .xls), a CSV file or a supported PDF.';
  if (file.size <= 0) return 'The file is empty.';
  return '';
}

/** A format the page knows by name (the address `?type=`); anything else is not a type. */
export const isKnownFormat = (format: string | null | undefined): boolean => !!specOf(format) || (!!format && Object.prototype.hasOwnProperty.call(KINDS, format));
