/**
 * Framework onboarding and the organisation profile (`backend/grc/modules/framework_onboarding/`, plan `docs/framework-onboarding-plan.md`):
 * the shapes the server answers and the calls. The catalog (steps, fields, notes, sources) is shipped data; the server resolves it per framework.
 */
import type { QueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';

export type FieldType =
  | 'text' | 'longtext' | 'number' | 'date' | 'bool' | 'choice' | 'multichoice' | 'person' | 'country' | 'countries'
  | 'table' | 'asset_refs' | 'vendor_ref' | 'org_pick' | 'departments_derived' | 'files';
export type Level = 'required' | 'advised' | 'optional';
export type Confidence = 'verified' | 'secondary' | 'unverified';
/** org_pick `of`: which rows of the organisation profile a framework scope picks from. */
export type OrgPickOf = 'entities' | 'sites' | 'systems' | 'third_parties' | 'data_types' | 'departments';

export interface Source { ref: string; asked_by: string; confidence: Confidence; urls?: string[] }
export interface When { field: string; eq?: unknown; ne?: unknown; in?: unknown[]; includes?: unknown; truthy?: boolean }

export interface Column {
  key: string;
  label: string;
  type: Exclude<FieldType, 'table' | 'org_pick' | 'departments_derived' | 'files'>;
  required?: boolean;
  options?: string[];
  suggestions?: string[];
}

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  level: Level;
  /** One or two sentences: why it is asked and who asks. Shown behind an (i). */
  note: string;
  options?: string[];
  suggestions?: string[];
  columns?: Column[];
  min_rows?: number;
  min?: number;
  of?: OrgPickOf;
  when?: When;
  applies_to?: string[];
  prefill_from?: string;
  /** `tenant.<column>`: the value lives on the organisation record (Administration > Organization) and is written through. */
  maps_to?: string;
  /** The field's own source, else its step's/group's (the server fills `source` in for a framework's fields). */
  source?: Source | null;
}

export interface Step { key: string; label: string; source: Source | null; fields: Field[] }
export interface Group { key: string; label: string; source: Source | null; fields: Field[] }

/** A person: a user of the platform, or someone outside. */
export type Person = { user_id: number } | { name: string; email?: string; organisation?: string };
/** A document on an answer (a `files` field): the Evidence record it is kept in, and its file name. */
export interface FileRef { id: number; name: string }
/** A row of a table field: its columns' values plus a stable id the server generates (a framework scope picks rows by it). */
export type Row = { id: string } & Record<string, unknown>;

export interface Check {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
  hint: string | null;
  kind?: 'field' | 'gate' | 'org';
  step?: string;
}
export interface StepProgress { key: string; label: string; required_total: number; required_ok: number; complete: boolean }
export interface Readiness {
  ready: boolean;
  /** this framework's own checks: its unfilled required/advised fields, then its gate checks */
  checks: Check[];
  /** always empty: the organisation profile gates nothing (kept so nothing that read it breaks) */
  org_checks: Check[];
  steps: StepProgress[];
  /** `step.field` of the fields that are not asked now because of an earlier answer */
  hidden: string[];
  counts: { required_total: number; required_ok: number; advised_open: number };
}

export interface OrgGroupState { label: string; required_total: number; required_ok: number; advised_open: number; complete: boolean; reviewed: boolean }
export interface OrgEvaluation {
  complete: boolean;
  groups: Record<string, OrgGroupState>;
  checks: Check[];
  missing: Array<{ group: string; field: string; label: string }>;
}

/** Names for the people, assets, vendors and departments that values point at (keys are ids as text). The screen shows names, never ids. */
export interface Refs {
  users: Record<string, string>;
  assets: Record<string, { name: string; asset_type: string | null; criticality: string | null }>;
  vendors: Record<string, string>;
  departments: Record<string, string>;
}
export interface Department { id: number; name: string; parent_id: number | null }
/** The profile's rows a framework scope can pick, by `of` (assets and departments are picked by their own ids). */
export interface OrgRows { entities: Row[]; sites: Row[]; third_parties: Row[]; data_types: Row[] }

export type Values = Record<string, Record<string, unknown>>;

export interface ProfileCatalog {
  version: number;
  label: string;
  summary: string;
  groups: Group[];
  checks: Array<{ key: string; label: string; level: 'required' | 'advised'; hint: string }>;
  org_pick_source: Record<OrgPickOf, string>;
}
export interface ProfileView {
  values: Values;
  evaluation: OrgEvaluation;
  refs: Refs;
  departments: Department[];
  catalog_version: number;
  updated_at: string | null;
}

export type OnboardingState = 'not_started' | 'draft' | 'ready' | 'complete' | 'underway';
export type UnderwayKind =
  | 'Running before onboarding existed' | 'Certified or attested outside the platform' | 'Regulator-mandated start' | 'Other';

export interface RegisterRow {
  uploaded_framework_id: number;
  name: string;
  version: string | null;
  slug: string | null;
  family: string;
  family_label: string | null;
  label: string;
  onboarding_id: number | null;
  state: OnboardingState;
  journey: { id: number; status: string } | null;
  progress: { done: number; total: number } | null;
  updated_at: string | null;
  underway: { kind: string | null; at: string | null; legacy: boolean } | null;
}
export interface Register {
  frameworks: RegisterRow[];
  counts: Record<OnboardingState, number>;
  meta: { underway_kinds: UnderwayKind[]; min_underway_reason: number; min_reopen_reason: number };
}

export interface OnboardingEvent { kind: string; by: string | null; at: string | null; detail: Record<string, unknown> }

export interface OnboardingView {
  id: number;
  uploaded_framework_id: number;
  framework: { name: string | null; slug: string | null; label: string | null; family: string; family_label: string | null; summary: string | null; flow_id: string | null; not_in_library: boolean };
  state: Exclude<OnboardingState, 'not_started'>;
  locked: boolean;
  underway: { kind: string | null; reason: string | null; at: string | null; source: 'manual' | 'legacy' | null } | null;
  underway_by: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approval_note: string | null;
  reopened_count: number;
  updated_at: string | null;
  steps: Step[];
  /** always empty (kept in the answer) */
  requires_org: Array<{ field: string; reason: string }>;
  answers: Record<string, Record<string, unknown>>;
  readiness: Readiness;
  refs: Refs;
  org_rows: OrgRows;
  journey: { id: number; status: string; name: string } | null;
  events: OnboardingEvent[];
  catalog_version: number;
  current_catalog_version: number;
}

export interface GateDecision {
  allowed: boolean;
  state: OnboardingState;
  onboarding_id: number | null;
  uploaded_framework_id: number;
  framework: string | null;
  family: string;
  reason: string;
  unmet: Array<{ key: string; label: string; hint: string | null }>;
}

export type AiKind = 'scope_draft' | 'exclusions_check' | 'gap_review';
export interface AiSuggestion<T = Record<string, unknown>> { kind: AiKind; suggestion: T; by: 'ai' | 'rules' }
export interface ScopeDraft { statement: string }
export interface ExclusionsCheck { exclusions: Array<{ item: string; reason: string }>; questions: Array<{ item: string; why: string }> }
export interface GapReview { questions: Array<{ field: string; question: string }> }

/** What a refused call carries (`detail` of the 4xx answer), whatever its shape. `code === 'onboarding_required'` is the gate's 409. */
export interface Problem {
  status: number | null;
  message: string;
  errors: Array<{ field: string; message: string }>;
  /** `step.field` keys that are locked because the onboarding is approved */
  locked: string[];
  /** frameworks whose approved onboarding uses a profile row that was about to be removed */
  usedBy: string[];
  /** unmet required checks of a submit/approve/gate refusal */
  checks: Array<{ key: string; label: string; hint: string | null }>;
  code: string | null;
  onboardingId: number | null;
  state: OnboardingState | null;
}

export function problemOf(err: unknown): Problem {
  const e = err as { response?: { status?: number; data?: { detail?: unknown } }; message?: string };
  const d = e?.response?.data?.detail;
  const obj = d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
  const text = typeof d === 'string' ? d : typeof obj.message === 'string' ? obj.message : '';
  return {
    status: e?.response?.status ?? null,
    message: text || 'Something went wrong. Try again.',
    errors: Array.isArray(obj.errors) ? (obj.errors as Problem['errors']) : [],
    locked: Array.isArray(obj.locked) ? (obj.locked as string[]) : [],
    usedBy: Array.isArray(obj.used_by) ? (obj.used_by as string[]) : [],
    checks: Array.isArray(obj.checks) ? (obj.checks as Problem['checks']) : Array.isArray(obj.unmet) ? (obj.unmet as Problem['checks']) : [],
    code: typeof obj.code === 'string' ? obj.code : null,
    onboardingId: typeof obj.onboarding_id === 'number' ? obj.onboarding_id : null,
    state: typeof obj.state === 'string' ? (obj.state as OnboardingState) : null,
  };
}

const P = '/compliance/org-profile';
const O = '/compliance/framework-onboarding';

export const onboardingApi = {
  profileCatalog: async (): Promise<ProfileCatalog> => (await apiClient.get(`${P}/catalog`)).data,
  profile: async (): Promise<ProfileView> => (await apiClient.get(P)).data,
  /** each key ("group.field") replaces that field whole; nothing is saved when any key is refused (422 with `errors`) */
  saveProfile: async (values: Record<string, unknown>): Promise<ProfileView> => (await apiClient.put(P, { values })).data,
  reviewGroup: async (group: string): Promise<ProfileView> => (await apiClient.post(`${P}/groups/${group}/review`)).data,

  register: async (): Promise<Register> => (await apiClient.get(O)).data,
  gate: async (uploadedFrameworkId: number): Promise<GateDecision> => (await apiClient.get(`${O}/gate/${uploadedFrameworkId}`)).data,
  start: async (uploadedFrameworkId: number): Promise<OnboardingView> => (await apiClient.post(O, { uploaded_framework_id: uploadedFrameworkId })).data,
  detail: async (id: number): Promise<OnboardingView> => (await apiClient.get(`${O}/${id}`)).data,
  /** one step's fields; each key replaces that field whole (422 with `errors` saves nothing; 409 with `locked` when approved) */
  saveAnswers: async (id: number, step: string, values: Record<string, unknown>): Promise<OnboardingView> =>
    (await apiClient.put(`${O}/${id}/answers`, { step, values })).data,
  /** One document, kept in Evidence. The answer that carries it is saved with `saveAnswers` like any other. */
  uploadFile: async (file: File): Promise<FileRef> => {
    const form = new FormData();
    form.append('file', file);
    return (await apiClient.post(`${O}/files`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
  },
  downloadFile: async (doc: FileRef): Promise<void> => {
    const res = await apiClient.get(`${O}/files/${doc.id}`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
  ai: async <T = Record<string, unknown>>(id: number, kind: AiKind): Promise<AiSuggestion<T>> => (await apiClient.post(`${O}/${id}/ai/${kind}`, {})).data,
  submit: async (id: number): Promise<OnboardingView> => (await apiClient.post(`${O}/${id}/submit`)).data,
  approve: async (id: number, note?: string): Promise<OnboardingView> => (await apiClient.post(`${O}/${id}/approve`, { note: note || null })).data,
  reopen: async (id: number, reason: string): Promise<OnboardingView> => (await apiClient.post(`${O}/${id}/reopen`, { reason })).data,
  underway: async (id: number, kind: UnderwayKind, reason: string): Promise<OnboardingView> => (await apiClient.post(`${O}/${id}/underway`, { kind, reason })).data,
};

/** Query keys, so every screen that shows onboarding state reads again after a change. */
export const ONBOARDING_KEYS = { profile: ['org-profile'], register: ['fw-onboarding-register'], detail: (id: number) => ['fw-onboarding', id], gate: (fwId: number) => ['fw-onboarding-gate', fwId] } as const;

export function refreshOnboarding(qc: QueryClient): void {
  for (const key of ['org-profile', 'fw-onboarding-register', 'fw-onboarding', 'fw-onboarding-gate']) void qc.invalidateQueries({ queryKey: [key] });
}

export const STATE_LABEL: Record<OnboardingState, string> = {
  not_started: 'Not started',
  draft: 'Draft',
  ready: 'Ready',
  complete: 'Complete',
  underway: 'Underway',
};

/** Does the framework's journey wait for onboarding? (the same rule as the server's gate, for words on a button; the server decides) */
export function journeyBlocked(state: OnboardingState, hasJourney: boolean): boolean {
  return !hasJourney && state !== 'complete' && state !== 'underway';
}

/** Props every field input takes, so the profile page and a framework's workspace render the same kinds of field the same way. */
export interface FieldInputProps {
  field: Field | Column;
  value: unknown;
  /** the new whole value of the field; the caller saves it (autosave) */
  onChange: (value: unknown) => void;
  error?: string | null;
  readOnly?: boolean;
  /** dom id base so a label can point at the input */
  id?: string;
  refs: Refs;
  /** a picker tells the page the names of what it chose, so they show before the next read */
  onRefs?: (patch: Partial<Refs>) => void;
  /** org_pick of entities | sites | third_parties | data_types */
  orgRows?: OrgRows;
  /** org_pick of departments / departments_derived */
  departments?: Department[];
}
