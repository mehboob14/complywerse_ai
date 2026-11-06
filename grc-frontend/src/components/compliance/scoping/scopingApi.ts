/**
 * The Cyber Security assessments' scoping and initiation (`backend/grc/modules/assessments/scope_router.py`): the types of what the server answers
 * and the calls. An assessment of one application or one function is made from the type's questionnaire: a draft that is scoped first and started when
 * the scope is ready (`features/cyber-assessment-scoping.md`).
 */
import type { QueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';

export type ScopeModel = 'asset' | 'process';
export type Phase = 'scoping' | 'in_progress';
export type ParticipantRole = 'owner' | 'contributor' | 'assessor' | 'reviewer' | 'approver' | 'sponsor' | 'observer';
export type AssetRole = 'primary' | 'component' | 'supporting' | 'sample' | 'excluded';
export type Environment = 'production' | 'staging' | 'test' | 'development' | 'other';
export type Platform = 'android' | 'ios' | 'web' | 'api';

export interface Participant {
  kind: 'user' | 'team' | 'external';
  user_id: number | null;
  team_id: number | null;
  name: string;
  organisation: string;
  role: ParticipantRole;
  domains: string[];
  independent: boolean;
  note: string;
}
export interface AssetRef { asset_id: number; role: AssetRole; reason: string }
export interface Exclusion { what: string; reason: string }
export interface RulesOfEngagement { approved_by: string; approved_on: string | null; notes: string }
export interface EvidencePlan { deadline: string | null; interviews: string; records: string; sampling: string }

/** Every key of both kinds of scope: the server stores the keys of its own kind and reads back all of them with their defaults. */
export interface Scope {
  // an application
  environment?: Environment | null;
  version?: string;
  level?: number | null;
  level_reason?: string;
  platforms?: Platform[];
  test_roles?: string[];
  window_start?: string | null;
  window_end?: string | null;
  intrusive?: boolean;
  rules_of_engagement?: RulesOfEngagement;
  // a function
  organisation?: string;
  legal_entity?: string;
  business_unit?: string;
  function?: string;
  period_start?: string | null;
  period_end?: string | null;
  geography?: string[];
  services?: string[];
  evidence_plan?: EvidencePlan;
  // both
  exclusions?: Exclusion[];
  trigger?: string | null;
  assets?: AssetRef[];
  participants?: Participant[];
  notes?: string;
}

export interface Check { key: string; label: string; ok: boolean; required: boolean; hint: string }
export interface Readiness { ready: boolean; checks: Check[] }

export interface AssetFacts {
  asset_id: number;
  name: string;
  asset_type: string | null;
  owner: string | null;
  owner_id: number | null;
  department: string | null;
  environment: string | null;
  criticality: string | null;
  data_classification: string | null;
  internet_facing: boolean;
  status: string | null;
  lifecycle_state: string | null;
  business_function: string | null;
  host_name: string | null;
}
export interface RelatedAsset { asset_id: number; name: string; asset_type: string | null; relationship: string; direction: 'outgoing' | 'incoming' }
export interface Domain { name: string; count: number }

export interface Snapshot {
  taken_at: string;
  taken_by: { id: number; name: string | null };
  template: { id: number; name: string; items: number; file_name: string | null; uploaded_at: string | null };
  owner: { id: number | null; name: string | null };
  assets: Array<AssetRef & Partial<AssetFacts>>;
  participants: Array<Participant & { display: string | null }>;
}

/** One assessment's scope, readiness and snapshot (GET/PUT /{id}/scope, initiate, start). `scope_model` is null for a questionnaire. */
export interface ScopeView {
  id: number;
  name: string;
  assessment_format: string;
  format_label: string | null;
  scope_model: ScopeModel | null;
  family: 'technical' | 'process' | null;
  phase: Phase | null;
  status: string | null;
  locked: boolean;
  owner: { id: number; name: string | null } | null;
  due_date: string | null;
  started_at: string | null;
  total_items: number;
  template: { id: number; name: string; items: number } | null;
  scope: Scope;
  facts: Record<string, AssetFacts>;
  participant_names: Record<string, string>;
  primary_asset: AssetFacts | null;
  related_assets: RelatedAsset[];
  domains: Domain[];
  snapshot: Snapshot | null;
  subject_summary: string | null;
  readiness: Readiness | null;
}

export interface TemplateRow {
  assessment_format: string;
  label: string;
  scope_model: ScopeModel;
  family: 'technical' | 'process';
  questionnaire: { assessment_id: number; name: string; items: number; domains: Domain[] } | null;
  scoping: number;
  in_progress: number;
}

/** A row of GET /compliance/assessments. */
export interface AssessmentRow {
  id: number;
  name: string;
  assessment_format: string;
  status: string | null;
  due_date: string | null;
  overall_score: number | null;
  total_items: number | null;
  complied_count: number | null;
  partially_complied_count: number | null;
  not_complied_count: number | null;
  in_progress_count: number | null;
  na_count: number | null;
  scope_model: ScopeModel | null;
  phase: Phase | null;
  template_id: number | null;
  owner_id: number | null;
  owner_name: string | null;
  primary_asset_id: number | null;
  primary_asset_name: string | null;
  started_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface AssetRow {
  id: number;
  name: string;
  asset_type: string | null;
  criticality: string | null;
  environment: string | null;
  owner_name?: string | null;
  host_name?: string | null;
  internet_facing?: boolean | null;
}

export interface ScopePatch {
  name?: string;
  owner_id?: number;
  /** null clears it */
  due_date?: string | null;
  /** the keys to replace, each whole */
  scope?: Scope;
}

const BASE = '/compliance/assessments';

export const scopingApi = {
  templates: async (): Promise<TemplateRow[]> => (await apiClient.get(`${BASE}/templates`)).data.templates,
  initiate: async (body: { assessment_format: string; asset_id?: number; subject?: string; name?: string }): Promise<ScopeView> =>
    (await apiClient.post(`${BASE}/initiate`, body)).data,
  scope: async (id: number): Promise<ScopeView> => (await apiClient.get(`${BASE}/${id}/scope`)).data,
  save: async (id: number, patch: ScopePatch): Promise<ScopeView> => (await apiClient.put(`${BASE}/${id}/scope`, patch)).data,
  start: async (id: number): Promise<ScopeView> => (await apiClient.post(`${BASE}/${id}/start`)).data,
  remove: async (id: number): Promise<void> => { await apiClient.delete(`${BASE}/${id}`); },
  list: async (params: { assessment_format?: string; scope_model?: ScopeModel; phase?: Phase; owner_id?: number; asset_id?: number; limit?: number }): Promise<AssessmentRow[]> =>
    (await apiClient.get(BASE, { params: { limit: 100, ...params } })).data?.assessments ?? [],
  assets: async (search: string, limit = 25, assetType?: string): Promise<AssetRow[]> =>
    (await apiClient.get('/assets', { params: { search: search || undefined, limit, asset_type: assetType || undefined } })).data ?? [],
  people: async (): Promise<Array<{ id: number; display_name: string; email?: string }>> => (await apiClient.get('/assets/tenant-users')).data ?? [],
  teams: async (): Promise<Array<{ id: number; name: string }>> => (await apiClient.get('/admin/teams')).data ?? [],
};

/** Every list that shows assessments reads again (a draft was made, started or discarded; a scope changed): the types' registers, the templates, the hub and the Assessments page. */
export function refreshAssessmentLists(qc: QueryClient): void {
  for (const key of ['scoping-list', 'scoping-templates', 'cyber-security-assessments', 'redesign-assessments']) void qc.invalidateQueries({ queryKey: [key] });
}
