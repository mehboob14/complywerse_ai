/**
 * What the scoping screens decide without a server or a screen: the words of each assessment type, which stage a check belongs to, how far each stage
 * is, what a register row says, and how a participant is named. The rules of what must be filled before the questions open are the server's
 * (`scoping.readiness`); this only arranges its answer.
 */
import type { AssessmentRow, AssetRole, Check, Participant, ParticipantRole, Phase, ScopeModel, ScopeView } from './scopingApi';

export type Stage = 'scope' | 'people' | 'plan' | 'assessment';
export const STAGES: readonly Stage[] = ['scope', 'people', 'plan', 'assessment'];
export const STAGE_LABEL: Record<Stage, string> = { scope: 'Scope', people: 'People', plan: 'Plan', assessment: 'Assessment' };

export interface TypeInfo {
  /** the hub's tab key: where this type lives at /cyber-security?tab= */
  tab: string;
  label: string;
  model: ScopeModel;
  /** what a person calls the subject: an application, a function */
  subject: string;
  about: string;
  needs: readonly string[];
  how: string;
}

/** The words of each type: what it assesses, what a person needs before starting, and how it is answered. */
export const TYPE_INFO: Record<string, TypeInfo> = {
  asvs_checklist: {
    tab: 'asvs', label: 'OWASP ASVS', model: 'asset', subject: 'application',
    about: 'Verifies one application against the OWASP Application Security Verification Standard. You choose the level; the requirements above it are marked not applicable.',
    needs: ['The application, chosen from the asset library', 'The environment and the version or build to verify', 'Who owns the application and who will verify it', 'Test accounts for each role, if you test with logins'],
    how: 'Each requirement is marked pass, fail or not applicable, with the evidence behind it.',
  },
  owasp_v4_testing_checklist: {
    tab: 'owasp_testing', label: 'OWASP Testing', model: 'asset', subject: 'application',
    about: 'A checklist of web application tests from the OWASP Web Security Testing Guide, recorded against one application: what was tested, the result and the evidence.',
    needs: ['The web application, chosen from the asset library', 'The environment and the version or build to test', 'Who owns it and who will test it', 'Rules of engagement for any test on production'],
    how: 'Each test is marked pass, fail or not applicable, with the evidence behind it.',
  },
  mobile_app_security: {
    tab: 'cs_mobile', label: 'Mobile App Security', model: 'asset', subject: 'mobile app',
    about: 'Verifies one mobile app against the OWASP mobile application security standard, for the platforms you choose. It covers the app on the device; assess its backend APIs in a separate ASVS assessment.',
    needs: ['The mobile app, chosen from the asset library', 'The platforms (Android, iOS) and the build', 'Who owns the app and who will test it', 'Its backend API in the library, to assess separately'],
    how: 'Each requirement is marked pass, fail or not applicable, with the evidence behind it.',
  },
  csir_maturity: {
    tab: 'cs_csir', label: 'CSIR Maturity', model: 'process', subject: 'function',
    about: 'Scores how well the incident response team is prepared, responds and follows up. It evaluates a function, not a server: assets are listed only as context for the evidence.',
    needs: ['The team or function assessed', 'The period whose operation is reviewed', 'The process owner and the people who contribute', 'Procedures and incident records to sample as evidence'],
    how: 'Each statement is rated for how far it is in place, then challenged by a reviewer from outside the team.',
  },
  cti_maturity: {
    tab: 'cs_cti', label: 'CTI Maturity', model: 'process', subject: 'function',
    about: 'Scores how well the organisation collects, analyses and uses threat intelligence for its defenders and its decisions. It evaluates a function, not a tool.',
    needs: ['The threat intelligence function assessed', 'The period whose operation is reviewed', 'Its head, its analysts and the teams that use the intelligence', 'Outside providers taking part, named as theirs'],
    how: 'Each statement is rated for how far it is in place, with evidence for the rating.',
  },
  incident_maturity: {
    tab: 'cs_incident', label: 'Incident Management', model: 'process', subject: 'process',
    about: 'Scores the end-to-end handling of security incidents: preparation, response and follow-up, across every team that takes part.',
    needs: ['The process and the part of the organisation it covers', 'The period whose operation is reviewed', 'The process owner and every team involved (security operations, IT, legal, compliance)', 'Incident tickets and records to sample as evidence'],
    how: 'Each statement is rated for how far it is in place, with evidence from real incidents.',
  },
  itsecops_maturity: {
    tab: 'cs_itsecops', label: 'IT Security Operations', model: 'process', subject: 'function',
    about: 'Scores the security operations function: monitoring, vulnerability management, threat intelligence and incident response.',
    needs: ['The function, for example the Security Operations Centre', 'The period whose operation is reviewed', 'Its owner, and the teams and providers that operate it', 'The tools it relies on, from the asset library, as context'],
    how: 'Each statement is rated for how far it is in place, with evidence for the rating.',
  },
};

export const typeOfTab = (tab: string): string | undefined => Object.keys(TYPE_INFO).find((f) => TYPE_INFO[f].tab === tab);

/** The NIST assessments, made from the NIST library tab (modules/assessments/nist.py): their words, like TYPE_INFO's. They have no workbook to upload. */
export const NIST_INFO: Record<string, TypeInfo & { publication: string; method: string }> = {
  nist_800_53a: {
    tab: 'nist_library', label: 'NIST SP 800-53A', model: 'system', subject: 'system', publication: 'SP800-53A',
    about: 'Assesses the security and privacy controls of one system the way NIST SP 800-53A Rev. 5 describes: the controls of the baseline you choose, each with its assessment objectives, the methods (examine, interview, test) and the objects to look at.',
    needs: ['The system and its authorization boundary', 'Its impact level, to choose the Low, Moderate or High baseline', 'The system owner and the assessor, ideally independent of the team', 'Policies, procedures, records and configurations to examine'],
    how: 'Each objective is determined Satisfied, Other than satisfied or Not applicable, with the evidence behind it. A control is satisfied only when every objective is.',
    method: 'Each control lists the assessment objects NIST names: what to examine, whom to interview, what to test.',
  },
  nist_csf2: {
    tab: 'nist_library', label: 'NIST CSF 2.0', model: 'system', subject: 'organisation or unit', publication: 'CSF2',
    about: 'Builds a Cybersecurity Framework 2.0 profile of one organisation or unit: how far each outcome is implemented today, and where it should be.',
    needs: ['The organisation or unit the profile is of', 'Which of the six functions the profile covers', 'The profile owner and who rates the outcomes', 'Policies, records and examples that show each outcome in practice'],
    how: 'Each subcategory is rated not, partially, largely or fully implemented, with a target, so the gaps between current and target show where to act.',
    method: 'Each subcategory lists the implementation examples NIST gives for it.',
  },
};
/** The words of any assessment type: one of the seven, or a NIST one. */
export const infoOf = (format: string): (TypeInfo & { publication?: string; method?: string }) | undefined => TYPE_INFO[format] ?? NIST_INFO[format];
export const isNistFormat = (format: string): boolean => format in NIST_INFO;
/** Where the page of a type lives in the hub: its own tab, or the NIST library tab with the assessment named. */
export const typeHref = (format: string): string => (isNistFormat(format) ? `/cyber-security?tab=nist_library&assessment=${format}` : `/cyber-security?tab=${TYPE_INFO[format]?.tab ?? 'overview'}`);

export const PHASE_LABEL: Record<Phase, string> = { scoping: 'Scoping', in_progress: 'In progress' };
export const PHASE_TONE: Record<Phase, 'pending' | 'progress'> = { scoping: 'pending', in_progress: 'progress' };

export const ROLE_LABEL = (role: ParticipantRole, model: ScopeModel | null, format?: string): string => {
  const own = model === 'process' ? 'Process owner' : model === 'system' ? (format === 'nist_csf2' ? 'Profile owner' : 'System owner') : 'Application owner';
  const approver = model === 'system' ? 'Authorizing official' : 'Approver';
  return ({ owner: own, contributor: 'Contributor', assessor: 'Assessor', reviewer: model === 'process' ? 'Independent reviewer' : 'Reviewer', approver, sponsor: 'Sponsor', observer: 'Observer' } as const)[role];
};

/** The roles offered for a kind of assessment, in the order a person fills them. */
export const ROLES_OF: Record<ScopeModel, readonly ParticipantRole[]> = {
  asset: ['owner', 'assessor', 'reviewer', 'approver', 'contributor', 'observer'],
  process: ['owner', 'sponsor', 'contributor', 'reviewer', 'assessor', 'observer'],
  system: ['owner', 'assessor', 'reviewer', 'approver', 'contributor', 'sponsor', 'observer'],
};

export const ASSET_ROLE_LABEL: Record<AssetRole, string> = {
  primary: 'The application', component: 'Component in scope', supporting: 'Supporting', sample: 'Sample', excluded: 'Excluded',
};
/** What a related or listed asset can be to the assessment (the primary application is not one of these). */
export const ASSET_ROLES_OF: Record<ScopeModel, readonly AssetRole[]> = { asset: ['component', 'supporting', 'sample', 'excluded'], process: ['supporting', 'sample', 'excluded'], system: ['supporting', 'sample', 'excluded'] };

export const ENVIRONMENTS = [['production', 'Production'], ['staging', 'Staging'], ['test', 'Test'], ['development', 'Development'], ['other', 'Other']] as const;
export const TRIGGERS = [['periodic', 'Periodic review'], ['regulatory', 'Regulatory requirement'], ['change', 'A major change'], ['incident', 'After an incident'], ['audit', 'An audit finding'], ['third_party', 'Third-party assurance'], ['other', 'Other']] as const;
export const LEVELS = [[1, 'Level 1', 'The minimum for every application.'], [2, 'Level 2', 'Most applications: those that hold sensitive data.'], [3, 'Level 3', 'The highest assurance: critical applications.']] as const;

// ── stages ──────────────────────────────────────────────────────────────────────────────────────────────────────
const CHECK_STAGE: Record<string, Exclude<Stage, 'assessment'>> = {
  subject: 'scope', environment: 'scope', version: 'scope', level: 'scope', platforms: 'scope', function: 'scope', organisation: 'scope', period: 'scope', assets: 'scope',
  system: 'scope', baseline: 'scope', functions: 'scope',
  owner: 'people', application_owner: 'people', process_owner: 'people', system_owner: 'people', assessor: 'people', reviewer: 'people', sponsor: 'people', contributors: 'people', independence: 'people',
  rules_of_engagement: 'plan', window: 'plan', evidence_plan: 'plan', as_of: 'plan',
};
export const stageOfCheck = (key: string): Exclude<Stage, 'assessment'> => CHECK_STAGE[key] ?? 'scope';

export interface StageState {
  /** required checks not yet met in this stage */
  missing: number;
  /** advice not yet followed */
  advice: number;
  done: boolean;
}

export function stageState(view: Pick<ScopeView, 'readiness'>, stage: Stage): StageState {
  if (stage === 'assessment') return { missing: 0, advice: 0, done: false };
  const checks = (view.readiness?.checks ?? []).filter((c) => stageOfCheck(c.key) === stage);
  const missing = checks.filter((c) => c.required && !c.ok).length;
  return { missing, advice: checks.filter((c) => !c.required && !c.ok).length, done: missing === 0 };
}

export function unmet(readiness: ScopeView['readiness']): { required: Check[]; advice: Check[] } {
  const checks = readiness?.checks ?? [];
  return { required: checks.filter((c) => c.required && !c.ok), advice: checks.filter((c) => !c.required && !c.ok) };
}

// ── registers and names ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * How far the questions are answered: what is marked (compliant, partly, not compliant) over what applies. A question that is not applicable is no work, so it
 * is in neither count: an assessment just started for a level-2 application, with its level-3 requirements already not applicable, is at 0%, not 33%.
 */
export function progressOf(row: Pick<AssessmentRow, 'total_items' | 'complied_count' | 'partially_complied_count' | 'not_complied_count' | 'na_count'>): number {
  const total = row.total_items ?? 0;
  const applicable = total - (row.na_count ?? 0);
  if (applicable <= 0) return total > 0 ? 100 : 0;                                  // everything is not applicable: nothing is left to do
  const done = (row.complied_count ?? 0) + (row.partially_complied_count ?? 0) + (row.not_complied_count ?? 0);
  return Math.min(100, Math.round((done / applicable) * 100));
}

/** What an assessment is of, for a register: the application's name, or the function (read out of the name made at initiation). */
export function subjectOf(row: Pick<AssessmentRow, 'name' | 'primary_asset_name' | 'scope_model' | 'assessment_format'>): string {
  if (row.primary_asset_name) return row.primary_asset_name;
  const label = infoOf(row.assessment_format)?.label;
  if (label && row.name.startsWith(`${label} - `)) return row.name.slice(label.length + 3);
  return row.name;
}

export const isQuestionnaire = (row: Pick<AssessmentRow, 'scope_model'>): boolean => !row.scope_model;

type Counts = Pick<AssessmentRow, 'complied_count' | 'partially_complied_count' | 'not_complied_count' | 'na_count'>;
const answered = (row: Counts): number => (row.complied_count ?? 0) + (row.partially_complied_count ?? 0) + (row.not_complied_count ?? 0) + (row.na_count ?? 0);

/**
 * The assessments of ONE type that an Overview counts (the server's board, `GET /overview`, applies the same rule): every one started for an application or
 * function; a draft never (it has no questions yet); the questionnaire itself only while nothing has been started from it, or when someone answered it
 * (an unanswered template would count every question as open for ever).
 */
export function countedForOverview<T extends Counts & Pick<AssessmentRow, 'scope_model' | 'phase'>>(rows: readonly T[]): T[] {
  const madeFrom = rows.some((r) => r.scope_model && r.phase !== 'scoping');
  return rows.filter((r) => (r.scope_model ? r.phase !== 'scoping' : !madeFrom || answered(r) > 0));
}

/** On an Overview's "in flight" list: a draft being scoped, or a started assessment whose questions are not all marked yet. Never the questionnaire. */
export function inFlight(row: Pick<AssessmentRow, 'scope_model' | 'phase' | 'total_items'> & Counts): boolean {
  return !!row.scope_model && (row.phase === 'scoping' || progressOf(row) < 100);
}

export type PhaseFilter = 'all' | 'scoping' | 'in_progress';

/** A type's register: the assessments made for one application or function (the questionnaire has a card of its own), by phase and by what is typed. */
export function inRegister(rows: readonly AssessmentRow[], phase: PhaseFilter, text: string): AssessmentRow[] {
  const q = text.trim().toLowerCase();
  return rows.filter((r) => !!r.scope_model && (phase === 'all' || r.phase === phase)
    && (!q || [subjectOf(r), r.owner_name ?? '', r.name].some((s) => s.toLowerCase().includes(q))));
}

/** What a register column sorts by. */
export function registerSortValue(row: AssessmentRow, key: string): string | number | null {
  switch (key) {
    case 'subject': return subjectOf(row).toLowerCase();
    case 'phase': return row.phase === 'scoping' ? 0 : 1;
    case 'owner': return row.owner_name?.toLowerCase() ?? null;
    case 'due': return row.due_date;
    case 'progress': return row.phase === 'scoping' ? null : progressOf(row);
    case 'score': return row.overall_score;
    default: return row.updated_at ?? row.created_at;
  }
}

export function participantLabel(p: Participant, people: Record<string, string>, teams: Record<string, string> = {}): string {
  if (p.kind === 'user') return people[String(p.user_id)] ?? `Person ${p.user_id}`;
  if (p.kind === 'team') return teams[String(p.team_id)] ?? `Team ${p.team_id}`;
  return p.organisation ? `${p.name} (${p.organisation})` : p.name;
}

export function newParticipant(kind: Participant['kind'], role: ParticipantRole): Participant {
  return { kind, user_id: null, team_id: null, name: '', organisation: '', role, domains: [], independent: false, note: '' };
}

/** A participant that can be saved: the person or team chosen, or an outside party with a name and an organisation. */
export const participantComplete = (p: Participant): boolean =>
  p.kind === 'user' ? !!p.user_id : p.kind === 'team' ? !!p.team_id : !!(p.name.trim() && p.organisation.trim());

/** The server's field messages of a 422 ({detail: {errors: [{field, message}]}}), by field: what the form shows under each. */
export function fieldErrors(error: unknown): Record<string, string> {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  const list = detail && typeof detail === 'object' && Array.isArray((detail as { errors?: unknown }).errors) ? (detail as { errors: Array<{ field?: string; message?: string }> }).errors : [];
  const out: Record<string, string> = {};
  for (const e of list) if (e.field && e.message && !out[e.field.split('.')[0]]) out[e.field.split('.')[0]] = e.message;
  return out;
}

/** Text for an input type=date from a stored day ('' for none) and back (null for none). */
export const toDateValue = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');
export const fromDateValue = (v: string): string | null => (v ? v : null);

/** A list kept as text, one entry per line or comma ("Android, iOS"), as the entries it holds. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    const t = part.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
