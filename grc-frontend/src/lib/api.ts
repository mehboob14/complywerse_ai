import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import {
  Framework,
  Control,
  Evidence,
  Risk,
  RiskDetail,
  RiskDashboard,
  HeatmapCell,
  GovernanceObjective,
  Exception,
  Issue,
  Document,
  ITAsset,
  NormalizedControl,
  ControlMapping,
  RiskKRI,
  RiskKRICreate,
  RiskKRIUpdate,
  RiskKRIMeasurement,
  RiskIncident,
  RiskIncidentCreate,
  RiskIncidentUpdate,
  RiskReview,
  RiskReviewCreate,
  FrameworkMethodology,
  RiskReviewUpdate,
  RiskDependency,
  RiskDependencyCreate,
  CascadeAnalysis,
  RiskReport,
  RiskReportCreate,
  ExecutiveDashboard,
  BoardReportData,
  DepartmentRiskSummary,
  AggregatedRiskView,
  AppetiteBreach,
  RiskTrendData,
  IncidentDashboard,
  RiskMitigationAction,
  LikelihoodImpactScale,
  GovernanceDocument,
  GovernanceDocumentVersion,
  DocumentApprovalStep,
  GovernanceDashboard,
  AssetType,
} from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

// Bare IPv4 hosts (e.g. 68.183.198.54 in IP-only deployments) split into
// 4 numeric parts; without this guard parts[0] would be returned as a
// tenant slug ("68"), which is wrong.
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const getTenantSlugFromHost = (): string | null => {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return null;
  if (IPV4_RE.test(host)) return null;
  if (host.endsWith('.localhost')) {
    const parts = host.split('.');
    if (parts.length === 2) return parts[0];
  }
  const parts = host.split('.');
  if (parts.length >= 3) return parts[0];
  return null;
};

/** Returns the active tenant slug for use in manual fetch() calls that bypass the axios interceptor. */
export const getTenantSlug = (): string | null => {
  if (typeof window === 'undefined') return null;
  return getTenantSlugFromHost() || localStorage.getItem('tenant_slug');
};

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 900000, // 15 minutes for long-running operations like policy parsing
  headers: {
    'Content-Type': 'application/json',
  },
});

export { apiClient };

apiClient.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      const hostTenant = getTenantSlugFromHost();
      const tenantSlug = hostTenant || localStorage.getItem('tenant_slug');
      // We deliberately do NOT mirror hostTenant back into localStorage here.
      // localStorage.tenant_slug is owned by the login flow (set from the
      // /auth/login response). If we keep stamping it from the hostname,
      // any user who lands on the wrong subdomain has their canonical
      // tenant context silently overwritten, which is the root cause of
      // the post-login bounce loop.
      if (tenantSlug) {
        config.headers['X-Tenant-Slug'] = tenantSlug;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const url = (error.config?.url || '').toString();
      const host = window.location.hostname.toLowerCase();

      // Wrong-subdomain detection. localStorage knows the canonical tenant
      // subdomain (set by login). If the browser is on a different
      // subdomain — e.g. user pasted a layeron link while logged in to acme,
      // or a stale tab navigated cross-tenant — redirect to the canonical
      // subdomain WITHOUT clearing storage. This is preserved from before.
      const canonicalSub = localStorage.getItem('tenant_subdomain') || localStorage.getItem('tenant_slug');
      let currentSub: string | null = null;
      if (host.endsWith('.localhost')) {
        const parts = host.split('.');
        if (parts.length === 2) currentSub = parts[0];
      } else if (host !== 'localhost' && host !== '127.0.0.1' && !IPV4_RE.test(host)) {
        // Skip IPv4 — bare-IP deployments have no subdomain to extract.
        const parts = host.split('.');
        if (parts.length >= 3) currentSub = parts[0];
      }
      if (canonicalSub && currentSub && canonicalSub !== currentSub) {
        const { protocol, port } = window.location;
        const baseHost = host.endsWith('.localhost')
          ? 'localhost'
          : host.split('.').slice(-2).join('.');
        window.location.href = `${protocol}//${canonicalSub}.${baseHost}${port ? ':' + port : ''}/dashboard`;
        return Promise.reject(error);
      }

      // Auto-logout policy: only force a logout when /auth/me itself returns
      // 401 (meaning we are PROVABLY unauthenticated). A 401 from any other
      // endpoint can mean "you don't have access to this specific resource"
      // — which should NOT kick the user out of the entire app. Previously
      // any single 401 nuked localStorage and bounced to /login, which made
      // tenant-scoped permission errors look like sudden logouts.
      const isAuthMeCall = /\/auth\/me(?:[/?#]|$)/.test(url);
      const isAuthRefresh = /\/auth\/refresh(?:[/?#]|$)/.test(url);
      if (isAuthMeCall || isAuthRefresh) {
        localStorage.clear();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      // Otherwise: surface the 401 to the caller and let it decide. No
      // auto-clear, no auto-redirect.
    }
    return Promise.reject(error);
  }
);

export const frameworksApi = {
  getAll: () => apiClient.get<Framework[]>('/frameworks'),
  getAvailable: () => apiClient.get('/frameworks/available'),
  getById: (id: string) => apiClient.get<Framework>(`/frameworks/${id}`),
  create: (data: Partial<Framework>) => apiClient.post<Framework>('/frameworks', data),
  update: (id: string, data: Partial<Framework>) => apiClient.put<Framework>(`/frameworks/${id}`, data),
  delete: (id: string) => apiClient.delete(`/frameworks/${id}`),
};

export const controlsApi = {
  getAll: () => apiClient.get<Control[]>('/controls'),
  getById: (id: string) => apiClient.get<Control>(`/controls/${id}`),
  create: (data: Partial<Control>) => apiClient.post<Control>('/controls', data),
  update: (id: string, data: Partial<Control>) => apiClient.put<Control>(`/controls/${id}`, data),
  delete: (id: string) => apiClient.delete(`/controls/${id}`),
  getNormalized: () => apiClient.get<NormalizedControl[]>('/controls/normalized'),
  getMappings: () => apiClient.get<ControlMapping[]>('/controls/mappings'),
  getAIRecommendations: (data: { control_id: number; control_title: string; control_description?: string; framework_name?: string }) =>
    apiClient.post<{
      control_id: number;
      test_procedures: Array<{
        procedure_type: string;
        description: string;
        frequency: string;
        sample_size: string;
      }>;
      evidence_requirements: Array<{
        evidence_type: string;
        title: string;
        description: string;
        mandatory: boolean;
      }>;
      key_risks_addressed: string[];
      audit_focus_areas: string[];
      addressed_risks: Array<{
        id: number; title: string; category: string | null; status: string | null;
        inherent_score: number | null; residual_score: number | null; mitigation_effectiveness: string | null;
      }>;
      risks_if_not_implemented: Array<{
        title: string; description?: string; category?: string; severity?: string;
        likelihood?: number; impact?: number; rationale?: string;
      }>;
      }>('/controls/ai-recommendations', data),
  promoteControlRisk: (data: {
    control_id: number; framework_name?: string; title: string; description?: string;
    register_type?: string; category?: string; risk_sub_category?: string;
    inherent_likelihood?: number; inherent_impact?: number;
    residual_likelihood?: number; residual_impact?: number;
    owner_id?: number; business_owner_id?: number;
    treatment_plan?: string; root_cause?: string; recommendations?: string; due_date?: string;
  }) => apiClient.post('/controls/ai-recommendations/promote-risk', data),
  getFrameworkControlsSummary: () => apiClient.get('/controls/framework-controls/summary'),
  getFrameworkControlsStatusSummary: (frameworkId?: number) =>
    apiClient.get('/controls/framework-controls/status-summary', {
      params: frameworkId ? { framework_id: frameworkId } : undefined,
    }),
  getFrameworkControls: (params?: {
    framework_id?: number;
    domain?: string;
    search?: string;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    skip?: number;
    limit?: number;
  }) => apiClient.get('/controls/framework-controls', { params }),
  getFrameworkControlEvidence: (frameworkControlId: number) =>
    apiClient.get(`/controls/framework-control/${frameworkControlId}/evidence`),
  linkFrameworkControlEvidence: (frameworkControlId: number, data: { evidence_id: number }) =>
    apiClient.post(`/controls/framework-control/${frameworkControlId}/evidence`, data),
  unlinkFrameworkControlEvidence: (frameworkControlId: number, linkId: number) =>
    apiClient.delete(`/controls/framework-control/${frameworkControlId}/evidence/${linkId}`),
};

export const evidenceApi = {
  getAll: () => apiClient.get<Evidence[]>('/evidence'),
  getById: (id: string) => apiClient.get<Evidence>(`/evidence/${id}`),
  create: (data: FormData) => apiClient.post<Evidence>('/evidence', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  update: (id: string, data: Partial<Evidence>) => apiClient.put<Evidence>(`/evidence/${id}`, data),
  delete: (id: string) => apiClient.delete(`/evidence/${id}`),
  uploadVersion: (id: string, data: FormData) => apiClient.post(`/evidence/${id}/versions`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
};

export const risksApi = {
  getAll: () => apiClient.get<Risk[]>('/risks'),
  getById: (id: number) => apiClient.get<Risk>(`/risks/${id}`),
  getDetail: (id: number) => apiClient.get<RiskDetail>(`/risks/${id}/detail`),
  getDashboard: () => apiClient.get<RiskDashboard>('/risks/dashboard'),
  getHeatmap: (riskType?: string) => apiClient.get<HeatmapCell[]>(`/risks/heatmap${riskType ? `?risk_type=${riskType}` : ''}`),
  create: (data: Partial<Risk>) => apiClient.post<Risk>('/risks', data),
  update: (id: number, data: Partial<Risk>) => apiClient.put<Risk>(`/risks/${id}`, data),
  delete: (id: number) => apiClient.delete(`/risks/${id}`),
  assess: (id: number, data: Record<string, unknown>) => apiClient.post(`/risks/${id}/assess`, data),
  updateTreatment: (id: number, plan: string) => apiClient.post(`/risks/${id}/treatment`, { treatment_plan: plan }),
  linkFrameworkControl: (id: number, data: Record<string, unknown>) => apiClient.post(`/risks/${id}/link-framework-control`, data),
  unlinkFrameworkControl: (id: number, linkId: number) => apiClient.delete(`/risks/${id}/link-framework-control/${linkId}`),
  linkGovernance: (id: number, data: Record<string, unknown>) => apiClient.post(`/risks/${id}/link-governance`, data),
  unlinkGovernance: (id: number, linkId: number) => apiClient.delete(`/risks/${id}/link-governance/${linkId}`),
  linkControl: (id: number, data: Record<string, unknown>) => apiClient.post(`/risks/${id}/controls`, data),
  unlinkControl: (id: number, linkId: number) => apiClient.delete(`/risks/${id}/controls/${linkId}`),
  linkAsset: (id: number, data: Record<string, unknown>) => apiClient.post(`/risks/${id}/assets`, data),
  unlinkAsset: (id: number, linkId: number) => apiClient.delete(`/risks/${id}/assets/${linkId}`),
  linkEvidence: (id: number, data: Record<string, unknown>) => apiClient.post(`/risks/${id}/evidence`, data),
  unlinkEvidence: (id: number, linkId: number) => apiClient.delete(`/risks/${id}/evidence/${linkId}`),
  uploadRiskRegister: (file: File, registerType?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    const params = registerType ? `?register_type=${encodeURIComponent(registerType)}` : '';
    return apiClient.post<{ message: string; created: number; skipped: number; errors: string[] }>(`/risks/upload${params}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const governanceApi = {
  getObjectives: () => apiClient.get<GovernanceObjective[]>('/governance/objectives'),
  getObjectiveById: (id: string) => apiClient.get<GovernanceObjective>(`/governance/objectives/${id}`),
  createObjective: (data: Partial<GovernanceObjective>) => apiClient.post<GovernanceObjective>('/governance/objectives', data),
  updateObjective: (id: string, data: Partial<GovernanceObjective>) => apiClient.put<GovernanceObjective>(`/governance/objectives/${id}`, data),
  deleteObjective: (id: string) => apiClient.delete(`/governance/objectives/${id}`),
  
  getExceptions: () => apiClient.get<Exception[]>('/governance/exceptions'),
  createException: (data: Partial<Exception>) => apiClient.post<Exception>('/governance/exceptions', data),
  
  getIssues: () => apiClient.get<Issue[]>('/governance/issues'),
  createIssue: (data: Partial<Issue>) => apiClient.post<Issue>('/governance/issues', data),

  getDocuments: (params?: { doc_type?: string; status?: string; owner_id?: number; search?: string; sort_by?: string; sort_order?: string; skip?: number; limit?: number }) =>
    apiClient.get<GovernanceDocument[]>('/governance/documents', { params }),
  getDocumentHierarchy: (params?: { tenant_id?: number; parent_id?: number }) =>
    apiClient.get('/governance/documents/hierarchy', { params }),
  getDocument: (id: number) => apiClient.get<GovernanceDocument>(`/governance/documents/${id}`),
  createDocument: (data: Partial<GovernanceDocument>) =>
    apiClient.post<GovernanceDocument>('/governance/documents', data),
  updateDocument: (id: number, data: Partial<GovernanceDocument>) =>
    apiClient.put<GovernanceDocument>(`/governance/documents/${id}`, data),
  deleteDocument: (id: number) => apiClient.delete(`/governance/documents/${id}`),
  getDashboard: () => apiClient.get<GovernanceDashboard>('/governance/dashboard'),
  getDashboardSummary: () => apiClient.get('/governance/dashboard/summary'),
  getExpiringSoon: (days: number = 30) => apiClient.get(`/governance/dashboard/expiring-soon?days=${days}`),
  getDashboardPendingApprovals: () => apiClient.get('/governance/dashboard/pending-approvals'),
  getDashboardOverdueReviews: () => apiClient.get('/governance/dashboard/overdue-reviews'),
  getRecentlyPublished: (limit: number = 10) => apiClient.get(`/governance/dashboard/recently-published?limit=${limit}`),
  getDocumentVersions: (documentId: number) =>
    apiClient.get<GovernanceDocumentVersion[]>(`/governance/versions/document/${documentId}`),
  // Diff two content versions (version ROW ids) + restore a prior version.
  compareDocumentVersions: (versionAId: number, versionBId: number) =>
    apiClient.get(`/governance/versions/compare/${versionAId}/${versionBId}`),
  rollbackDocumentVersion: (documentId: number, versionId: number) =>
    apiClient.post(`/governance/versions/document/${documentId}/rollback/${versionId}`, {}),
  // Edit document body content with a version snapshot + audit ("why").
  editDocumentContent: (documentId: number, data: { content: string; change_reason?: string }) =>
    apiClient.put(`/governance/documents/${documentId}`, data),
  // Fill the Approval Signoff + Document Description tables (sign / fill
  // placeholders later); snapshots a version + audits.
  signoffDocument: (documentId: number, data: {
    signoffs?: Array<{ role: string; name?: string; designation?: string; date?: string }>;
    effective_date?: string; version?: string; next_review_date?: string;
    classification?: string; approval_authority?: string; mark_approved?: boolean;
  }) => apiClient.post(`/governance/documents/${documentId}/signoff`, data),
  // ── Production Sign-off & Document Control (participants + send + sign) ──
  getDocumentSignoff: (documentId: number) =>
    apiClient.get(`/governance/documents/${documentId}/signoff`),
  setSignoffParticipants: (documentId: number, data: {
    prepared_by?: Array<{ target_type: string; target_id: number }>;
    reviewers?: Array<{ target_type: string; target_id: number }>;
    approvers?: Array<{ target_type: string; target_id: number }>;
  }) => apiClient.put(`/governance/documents/${documentId}/signoff/participants`, data),
  sendDocumentForReview: (documentId: number) =>
    apiClient.post(`/governance/documents/${documentId}/signoff/send-for-review`, {}),
  signDocumentOff: (documentId: number, data: { comment?: string; signature_text?: string }) =>
    apiClient.post(`/governance/documents/${documentId}/signoff/sign`, data),
  rejectDocumentSignoff: (documentId: number, data: { comment: string }) =>
    apiClient.post(`/governance/documents/${documentId}/signoff/reject`, data),
  getMySignoffPending: () =>
    apiClient.get('/governance/documents/signoff/my-pending'),
  getPendingApprovals: (params?: { include_delegated?: boolean; skip?: number; limit?: number }) =>
    apiClient.get('/governance/workflows/pending', { params }),
  getWorkflowDashboard: () => apiClient.get('/governance/workflows/dashboard'),
  getOverdueApprovals: (params?: { skip?: number; limit?: number }) =>
    apiClient.get('/governance/workflows/overdue', { params }),
  getUpcomingReviews: (params?: { days?: number; doc_type?: string }) => 
    apiClient.get('/governance/reviews/upcoming', { params }),
  getOverdueReviews: (params?: { doc_type?: string }) => 
    apiClient.get('/governance/reviews/overdue', { params }),
  getReviewStatistics: () => apiClient.get('/governance/reviews/statistics'),
  completeReview: (documentId: number, data?: { notes?: string; next_review_date?: string }) => 
    apiClient.post(`/governance/reviews/${documentId}/complete`, data || {}),
  getReviewCalendar: (params?: { year?: number; month?: number; group_by?: string }) =>
    apiClient.get('/governance/reviews/calendar', { params }),
  approveStep: (stepId: number, comments?: string) =>
    apiClient.post(`/governance/workflows/steps/${stepId}/approve`, { comments }),
  rejectStep: (stepId: number, comments?: string) =>
    apiClient.post(`/governance/workflows/steps/${stepId}/reject`, { comments }),
  delegateStep: (stepId: number, delegateToUserId: number, reason?: string) =>
    apiClient.post(`/governance/workflows/steps/${stepId}/delegate`, { delegate_to_user_id: delegateToUserId, reason }),
  getApprovalHistory: (status?: string, skip?: number, limit?: number) =>
    apiClient.get('/governance/workflows/history', { params: { status, skip, limit } }),
  uploadDocumentWithFile: (formData: FormData) =>
    apiClient.post('/governance/documents/upload-with-file', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  uploadFileToDocument: (documentId: number, formData: FormData) =>
    apiClient.post(`/governance/documents/${documentId}/upload-file`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  downloadDocumentFile: (documentId: number) =>
    apiClient.get(`/governance/documents/${documentId}/download-file`, {
      responseType: 'blob',
    }),
  parsePolicy: (documentId: number) =>
    apiClient.post(`/governance/documents/${documentId}/parse-policy`, {}, {
      timeout: 900000, // 15 minutes for large document parsing
    }),
  getDocumentPolicyStatements: (documentId: number) =>
    apiClient.get(`/governance/documents/${documentId}/policy-statements`),
  addStatement: (documentId: number, data: any) => {
    console.log('[API] addStatement called with:', { documentId, data });
    return apiClient.post(`/governance/documents/${documentId}/statements`, data).then(res => {
      console.log('[API] addStatement response:', res);
      return res;
    });
  },
  updateStatement: (documentId: number, statementId: number, data: any) =>
    apiClient.put(`/governance/documents/${documentId}/statements/${statementId}`, data),
  deleteStatement: (documentId: number, statementId: number) =>
    apiClient.delete(`/governance/documents/${documentId}/statements/${statementId}`),
  getDocumentViewHtml: (documentId: number) =>
    apiClient.get(`/governance/documents/${documentId}/view-html`),
  getStatementVersions: (documentId: number, statementId: number) =>
    apiClient.get(`/governance/documents/${documentId}/statements/${statementId}/versions`),
  getStatementDiff: (documentId: number, statementId: number, versionA: number, versionB: number) =>
    apiClient.get(`/governance/documents/${documentId}/statements/${statementId}/diff`, { params: { version_a: versionA, version_b: versionB } }),
  rollbackStatement: (documentId: number, statementId: number, versionId: number) =>
    apiClient.post(`/governance/documents/${documentId}/statements/${statementId}/rollback`, { version_id: versionId }),
  getReparseProposals: (documentId: number) =>
    apiClient.get(`/governance/documents/${documentId}/reparse-proposals`),
  applyReparseProposals: (documentId: number, decisions: Array<{index: number, action: string}>) =>
    apiClient.post(`/governance/documents/${documentId}/reparse-proposals/apply`, { decisions }),
  exportPolicyStatements: (documentId: number) =>
    apiClient.get(`/governance/reports/policy-statements/${documentId}/csv`, { responseType: 'blob' }),
  exportComplianceSummary: () =>
    apiClient.get('/governance/reports/compliance-summary/csv', { responseType: 'blob' }),
  exportAuditLog: (days: number = 90) =>
    apiClient.get('/governance/reports/audit-log/csv', { params: { days }, responseType: 'blob' }),
  getGapAnalysisRuns: (documentId: number) =>
    apiClient.get(`/governance/gap-analysis/runs/${documentId}`),
  getComplianceSummary: (documentId: number) =>
    apiClient.get(`/governance/gap-analysis/compliance-summary/${documentId}`),
  runGapAnalysis: (data: { document_id: number; framework_ids?: number[]; run_all?: boolean }) =>
    apiClient.post('/governance/gap-analysis/run', data, { timeout: 30000 }),
  generatePolicyDraft: (data: { doc_type: string; title: string; framework_ids?: number[]; regulatory_scope?: string[]; description?: string; include_sections?: string[]; parent_document_id?: number }) =>
    apiClient.post('/governance/documents/ai-draft', data),
  suggestPoliciesForFramework: (data: { framework_ids: number[]; doc_type?: string }) =>
    apiClient.post('/governance/documents/ai-suggest-policies', data),
  getWorkflowTemplates: (params?: { tenant_id?: number; is_active?: boolean; doc_type?: string; skip?: number; limit?: number }) =>
    apiClient.get('/governance/workflows/templates', { params }),
  getWorkflowTemplate: (id: number) =>
    apiClient.get(`/governance/workflows/templates/${id}`),
  createWorkflowTemplate: (data: { tenant_id: number; name: string; description?: string; doc_types?: string[]; is_default?: boolean; is_active?: boolean; allow_skip?: boolean; require_all_approvers?: boolean; auto_publish_on_complete?: boolean }) =>
    apiClient.post('/governance/workflows/templates', data, { params: { tenant_id: data.tenant_id } }),
  updateWorkflowTemplate: (id: number, data: { name?: string; description?: string; doc_types?: string[]; is_default?: boolean; is_active?: boolean; allow_skip?: boolean; require_all_approvers?: boolean; auto_publish_on_complete?: boolean }) =>
    apiClient.put(`/governance/workflows/templates/${id}`, data),
  deleteWorkflowTemplate: (id: number) =>
    apiClient.delete(`/governance/workflows/templates/${id}`),
  createWorkflowStep: (templateId: number, data: { name: string; description?: string; sequence: number; step_type?: string; approval_mode?: string; is_required?: boolean; timeout_days?: number }) =>
    apiClient.post(`/governance/workflows/templates/${templateId}/steps`, data),
  updateWorkflowStep: (templateId: number, stepId: number, data: { name?: string; description?: string; step_type?: string; approval_mode?: string; is_required?: boolean; timeout_days?: number }) =>
    apiClient.put(`/governance/workflows/templates/${templateId}/steps/${stepId}`, data),
  deleteWorkflowStep: (templateId: number, stepId: number) =>
    apiClient.delete(`/governance/workflows/templates/${templateId}/steps/${stepId}`),
  reorderWorkflowSteps: (templateId: number, steps: { step_id: number; sequence: number }[]) =>
    apiClient.put(`/governance/workflows/templates/${templateId}/steps/reorder`, { steps }),
  addStepApprover: (templateId: number, stepId: number, data: { approver_type: string; user_id?: number; role_id?: number; is_required?: boolean; sequence?: number }) =>
    apiClient.post(`/governance/workflows/templates/${templateId}/steps/${stepId}/approvers`, data),
  removeStepApprover: (templateId: number, stepId: number, approverId: number) =>
    apiClient.delete(`/governance/workflows/templates/${templateId}/steps/${stepId}/approvers/${approverId}`),
  seedDefaultTemplates: (tenantId: number) =>
    apiClient.post('/governance/workflows/templates/seed-defaults', null, { params: { tenant_id: tenantId } }),
  getDocumentMappings: (documentId: number) =>
    apiClient.get(`/governance/mappings/document/${documentId}`),
  // Control coverage of a document vs its applicable frameworks: per-framework
  // mapped / recommended / missing (gap) controls.
  getDocumentCoverage: (documentId: number, frameworkIds?: number[]) =>
    apiClient.get(`/governance/mappings/document/${documentId}/coverage`, {
      params: frameworkIds && frameworkIds.length ? { framework_ids: frameworkIds.join(',') } : {},
    }),
  getFrameworkApplicability: (frameworkId: number) =>
    apiClient.get(`/governance/applicability/framework/${frameworkId}`),
  getApplicabilityAuditLog: (frameworkId: number) =>
    apiClient.get(`/governance/applicability/audit-log/${frameworkId}`),
  setClauseApplicability: (data: { control_id: number; uploaded_framework_id: number; is_applicable: boolean; justification: string }) =>
    apiClient.post('/governance/applicability', data),
  reviewApplicability: (applicabilityId: number, data: { status: string; review_comment?: string }) =>
    apiClient.put(`/governance/applicability/${applicabilityId}/review`, data),
  linkControl: (data: { document_id: number; internal_control_id: number; link_type?: string; notes?: string; force_relink?: boolean }) =>
    apiClient.post('/governance/mappings/control', data),
  unlinkControl: (linkId: number) =>
    apiClient.delete(`/governance/mappings/control/${linkId}`),
  linkRecommendedControl: (documentId: number, data: { control_kind: string; control_code: string | null; link: boolean }) =>
    apiClient.post(`/governance/mappings/document/${documentId}/recommended-controls/link`, data),
  linkDocumentToRisk: (data: { document_id: number; risk_id: number; link_type?: string; notes?: string }) =>
    apiClient.post('/governance/mappings/risk', data),
  unlinkDocumentFromRisk: (linkId: number) =>
    apiClient.delete(`/governance/mappings/risk/${linkId}`),
  getDocumentsByRisk: (riskId: number) =>
    apiClient.get(`/governance/mappings/by-risk/${riskId}`),
  getMappingCoverage: () =>
    apiClient.get('/governance/mappings/coverage'),
  getComplianceCoverage: () =>
    apiClient.get('/governance/dashboard/compliance-coverage'),
  getComplianceByFramework: () =>
    apiClient.get('/governance/dashboard/compliance-by-framework'),
  getOpenGapsSummary: () =>
    apiClient.get('/governance/dashboard/open-gaps-summary'),
  getRemediationProgress: () =>
    apiClient.get('/governance/dashboard/remediation-progress'),
  getUpcomingReviewsDashboard: () =>
    apiClient.get('/governance/dashboard/upcoming-reviews'),
  getAcceptedRisks: () =>
    apiClient.get('/governance/dashboard/accepted-risks'),
  getTrends: (months: number = 12) =>
    apiClient.get(`/governance/dashboard/trends?months=${months}`),
  updateDocumentStatus: (documentId: number, status: string) =>
    apiClient.put(`/governance/documents/${documentId}/status`, { status }),
  submitDocumentForReview: (documentId: number, data?: { due_days?: number; message?: string }) =>
    apiClient.post('/governance/workflows/submit', {
      document_id: documentId,
      due_days: data?.due_days ?? 7,
      message: data?.message,
    }),
  publishDocument: (documentId: number) =>
    apiClient.post(`/governance/documents/${documentId}/publish`),
  requestAttestation: (documentId: number, data: { user_ids: number[]; attestation_type?: string; due_date?: string }) =>
    apiClient.post('/governance/attestations/request', {
      document_id: documentId,
      user_ids: data.user_ids,
      attestation_type: data.attestation_type || 'acknowledgment',
      due_date: data.due_date,
    }),
  getParseStatus: (documentId: number) =>
    apiClient.get(`/governance/documents/${documentId}/parse-status`),
  getDocumentGapFindings: (documentId: number, params?: Record<string, any>) =>
    apiClient.get(`/governance/gap-analysis/findings/document/${documentId}`, { params }),
  exportGapFindings: (documentId: number) =>
    apiClient.get(`/governance/gap-analysis/export/${documentId}`, { responseType: 'blob' }),
  updateGapFinding: (findingId: number, data: Record<string, any>) =>
    apiClient.put(`/governance/gap-analysis/findings/${findingId}`, data),
  overrideGapFinding: (findingId: number, data: { override_status: string; override_justification: string }) =>
    apiClient.put(`/governance/gap-analysis/findings/${findingId}/override`, data),
  acceptGapRisk: (findingId: number, data: { justification: string; expiry_date?: string }) =>
    apiClient.put(`/governance/gap-analysis/findings/${findingId}/accept-risk`, {
      risk_acceptance_justification: data.justification,
      risk_acceptance_expiry_date: data.expiry_date || null
    }),
  // Apply-fix workflow: AI drafts the clause text (replacing an existing
  // section or appending), user reviews/edits in a side-by-side popup, then
  // applies. The apply step also snapshots the prior document state into a
  // version row so the change is auditable.
  generateGapFix: (findingId: number) =>
    apiClient.post(`/governance/gap-analysis/findings/${findingId}/generate-fix`, {}, { timeout: 60000 }),
  applyGapFix: (
    findingId: number,
    data: {
      mode: 'replace' | 'append';
      proposed_text: string;
      current_text?: string | null;
      section_heading?: string;
      change_reason?: string;
    }
  ) =>
    apiClient.post(`/governance/gap-analysis/findings/${findingId}/apply-fix`, data),
  getTenantUsers: (tenantId: number) =>
    apiClient.get(`/tenants/${tenantId}/users`),
  
  // Governance Action Review endpoints
  getPendingGovernanceActions: (params?: { action_type?: string; entity_type?: string; skip?: number; limit?: number }) =>
    apiClient.get('/governance/reviews/governance-actions/pending', { params }),
  getAllGovernanceActions: (params?: { status_filter?: string; action_type?: string; skip?: number; limit?: number }) =>
    apiClient.get('/governance/reviews/governance-actions', { params }),
  updateGovernanceAction: (reviewId: number, data: { review_status: string; review_notes?: string }) =>
    apiClient.put(`/governance/reviews/governance-actions/${reviewId}`, data),
  getMyPendingReviews: (params?: { action_type?: string; entity_type?: string; skip?: number; limit?: number }) =>
    apiClient.get('/governance/reviews/my-pending-reviews', { params }),
  getMyPendingApprovals: (params?: { action_type?: string; entity_type?: string; skip?: number; limit?: number }) =>
    apiClient.get('/governance/reviews/my-pending-approvals', { params }),
  // Document periodic-review lifecycle
  getDocumentReviewHistory: (documentId: number) =>
    apiClient.get(`/governance/reviews/${documentId}/history`),
  startDocumentReview: (documentId: number) =>
    apiClient.post(`/governance/reviews/${documentId}/start`),
  completeDocumentReview: (documentId: number, data: { review_notes?: string; changes_made?: string; outcome?: string }) =>
    apiClient.post(`/governance/reviews/${documentId}/complete`, {
      notes: [data.review_notes, data.changes_made, data.outcome].filter(Boolean).join('. ') || undefined,
    }),
};

export const policyExceptionApi = {
  getSummary: () => apiClient.get('/governance/policy-exceptions/summary'),
  getExpiringSoon: () => apiClient.get('/governance/policy-exceptions/expiring-soon'),
  getAll: (params?: Record<string, string | number>) =>
    apiClient.get('/governance/policy-exceptions', { params }),
  suggestContent: (data: { title: string; document_id: number }) =>
    apiClient.post('/governance/policy-exceptions/suggest-content', data),
  // Search any sentence/keyword across policy/document content + parsed clauses.
  searchPolicies: (q: string, limit = 20) =>
    apiClient.get('/governance/policy-exceptions/search-policies', { params: { q, limit } }),
  // AI-driven candidate exceptions across policies (or focused on one document).
  suggestCandidates: (params?: { document_id?: number; limit?: number }) =>
    apiClient.get('/governance/policy-exceptions/suggest-candidates', { params: params || {} }),
  getById: (id: number) => apiClient.get(`/governance/policy-exceptions/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/governance/policy-exceptions', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put(`/governance/policy-exceptions/${id}`, data),
  delete: (id: number) => apiClient.delete(`/governance/policy-exceptions/${id}`),
  submit: (id: number) => apiClient.post(`/governance/policy-exceptions/${id}/submit`),
  approve: (id: number, data?: { comments?: string }) =>
    apiClient.post(`/governance/policy-exceptions/${id}/approve`, data || {}),
  reject: (id: number, data: { rejection_reason: string }) =>
    apiClient.post(`/governance/policy-exceptions/${id}/reject`, data),
  revoke: (id: number, data?: { reason?: string }) =>
    apiClient.post(`/governance/policy-exceptions/${id}/revoke`, data || {}),
  getComments: (id: number) => apiClient.get(`/governance/policy-exceptions/${id}/comments`),
  addComment: (id: number, data: { comment: string }) =>
    apiClient.post(`/governance/policy-exceptions/${id}/comments`, data),
  // Create an ERM risk-register entry from an exception's potential risks so the
  // likelihood/impact assessment can be completed in the risk module.
  promoteToRisk: (id: number) => apiClient.post(`/governance/policy-exceptions/${id}/promote-to-risk`),
  // Asset-weighted risk posture + aging + closure-timeliness for the charts.
  getAnalytics: () => apiClient.get('/governance/policy-exceptions/analytics'),
  // Real posture-over-time trend from the snapshot history layer.
  getTrend: (metric = 'exception_risk_posture', days = 180) =>
    apiClient.get('/enriched-dashboard/metric-trend', { params: { metric, days } }),
};

export const documentsApi = {
  getAll: () => apiClient.get<Document[]>('/documents'),
  getById: (id: string) => apiClient.get<Document>(`/documents/${id}`),
  create: (data: FormData) => apiClient.post<Document>('/documents', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  update: (id: string, data: Partial<Document>) => apiClient.put<Document>(`/documents/${id}`, data),
  delete: (id: string) => apiClient.delete(`/documents/${id}`),
};

export const assetsApi = {
  // Pass filters through query params. Defaults preserved when called with
  // no args, so existing callers (e.g. `assetsApi.getAll()`) are unchanged.
  getAll: (params?: {
    asset_type?: string;
    criticality?: string;
    owner_id?: number;
    status_filter?: string;
    lifecycle_state?: string;
    data_classification?: string;
    internet_facing?: boolean;
    stale_only?: boolean;
    stale_days?: number;
    skip?: number;
    limit?: number;
  }) => apiClient.get<ITAsset[]>('/assets', { params }),
  getById: (id: number) => apiClient.get<ITAsset>(`/assets/${id}`),
  getDetail: (id: number) => apiClient.get(`/assets/${id}/detail`),
  // Phase 5.3 — Lifecycle state transition. Backend enforces the FSM and
  // returns the new state + a count of auto-closed vulnerabilities.
  transitionLifecycle: (
    id: number,
    payload: { to_state: string; reason?: string; replacement_asset_id?: number },
  ) => apiClient.post<{
    asset_id: number;
    from_state: string;
    to_state: string;
    lifecycle_state: string;
    decommissioned_at: string | null;
    retirement_reason: string | null;
    replacement_asset_id: number | null;
    auto_closed_vulnerabilities: number;
  }>(`/assets/${id}/lifecycle-transition`, payload),
  getDashboard: () => apiClient.get('/assets/dashboard'),
  getTenantUsers: () => apiClient.get<Array<{id: number; display_name: string; email: string}>>('/assets/tenant-users'),
  getCIARecommendation: (data: {
    name: string;
    description?: string;
    asset_type: string;
    vendor?: string;
    location?: string;
    criticality?: 'low' | 'medium' | 'high' | 'critical';
  }) => apiClient.post<{
    recommendation: string;
    confidentiality_rating: number;
    integrity_rating: number;
    availability_rating: number;
  }>('/assets/cia-recommendation', data),
  create: (data: {
    name: string;
    description?: string;
    asset_type: AssetType;
    owner_id?: number;
    owner_name?: string;
    custodian?: string;
    host_name?: string;
    ip_address?: string;
    criticality?: 'low' | 'medium' | 'high' | 'critical';
    confidentiality_rating?: number;
    integrity_rating?: number;
    availability_rating?: number;
    valuation?: number;
    vendor?: string;
    location?: string;
    cde_environment?: boolean;
  }) => apiClient.post<ITAsset>('/assets', data),
  update: (id: number, data: Partial<ITAsset>) => apiClient.put<ITAsset>(`/assets/${id}`, data),
  delete: (id: number) => apiClient.delete(`/assets/${id}`),
  linkControl: (id: number, data: { normalized_control_id: number; coverage_status?: string }) =>
    apiClient.post(`/assets/${id}/controls`, data),
  unlinkControl: (id: number, linkId: number) =>
    apiClient.delete(`/assets/${id}/controls/${linkId}`),
  linkInternalControl: (id: number, data: { internal_control_id: number; coverage_status?: string }) =>
    apiClient.post(`/assets/${id}/internal-controls`, data),
  unlinkInternalControl: (id: number, linkId: number) =>
    apiClient.delete(`/assets/${id}/internal-controls/${linkId}`),
  linkFrameworkControl: (id: number, data: {framework_control_id: number, coverage_status?: string}) => 
    apiClient.post(`/assets/${id}/link-framework-control`, data),
  unlinkFrameworkControl: (id: number, linkId: number) => 
    apiClient.delete(`/assets/${id}/link-framework-control/${linkId}`),
  linkEvidence: (id: number, data: {evidence_id: number, relationship_type?: string}) => 
    apiClient.post(`/assets/${id}/link-evidence`, data),
  unlinkEvidence: (id: number, linkId: number) => 
    apiClient.delete(`/assets/${id}/link-evidence/${linkId}`),
  getCoverageAnalysis: (id: number) => apiClient.get(`/assets/${id}/coverage-analysis`),
  // IP-group composite scoring (room-and-chair). One endpoint returns every
  // asset at the same IP plus the composite breakdown the host applications
  // panel renders.
  getIPPeers: (id: number) => apiClient.get(`/assets/${id}/ip-peers`),
  getCompositeWeights: () => apiClient.get<{ weights: Record<string, number>; is_custom: boolean; defaults: Record<string, number> }>(`/assets/composite-weights`),
  updateCompositeWeights: (weights: { low: number; medium: number; high: number; critical: number }) =>
    apiClient.put<{ weights: Record<string, number>; is_custom: boolean; defaults: Record<string, number> }>(`/assets/composite-weights`, weights),
  resetCompositeWeights: () =>
    apiClient.delete<{ weights: Record<string, number>; is_custom: boolean; defaults: Record<string, number> }>(`/assets/composite-weights`),
  // Detected software inventory and promote-to-child-asset flow.
  getDetectedSoftware: (id: number) => apiClient.get(`/assets/${id}/detected-software`),
  promoteSoftware: (id: number, software_keys: string[], criticality?: string) =>
    apiClient.post(`/assets/${id}/promote-software`, { software_keys, criticality }),
  getMappingRecommendations: (
    id: number,
    params?: { framework_id?: number; min_score?: number; limit?: number; include_linked?: boolean }
  ) => apiClient.get(`/assets/${id}/mapping-recommendations`, { params }),
  acceptMappingRecommendations: (
    id: number,
    framework_control_ids: number[],
    coverage_status: 'partial' | 'full' | 'minimal' = 'partial',
    notes?: string
  ) =>
    apiClient.post(`/assets/${id}/mapping-recommendations/accept`, {
      framework_control_ids,
      coverage_status,
      notes,
    }),
  assessRisk: (id: number) => apiClient.post(`/assets/${id}/assess`),
  // Trajectory map data: Asset → Vulnerabilities → Controls → Risks (one-shot
  // aggregate). Powers the interactive xyflow diagram on the asset detail
  // page's Trajectory tab.
  getTrajectory: (id: number) => apiClient.get(`/assets/${id}/trajectory`),
  downloadTemplate: async () => {
    const response = await apiClient.get('/assets/template/download', {
      responseType: 'blob'
    });
    const blob = new Blob([response.data], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'it_assets_template.csv';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },
  importAssets: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<{
      success: boolean;
      imported: number;
      total_rows: number;
      errors: string[];
      total_errors: number;
      message: string;
    }>('/assets/import/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const isProjectsApi = {
  getAll: (params?: Record<string, string>) => apiClient.get('/is-projects', { params }),
  getById: (id: number) => apiClient.get(`/is-projects/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/is-projects', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put(`/is-projects/${id}`, data),
  delete: (id: number) => apiClient.delete(`/is-projects/${id}`),
  getMyProjects: () => apiClient.get('/is-projects/my-projects'),
  getDashboard: () => apiClient.get('/is-projects/dashboard'),
  getEnhancedAnalytics: () => apiClient.get('/is-projects/dashboard/enhanced-analytics'),
  getHealthTrend: () => apiClient.get('/is-projects/dashboard/health-trend'),
  createMilestone: (projectId: number, data: Record<string, unknown>) =>
    apiClient.post(`/is-projects/${projectId}/milestones`, data),
  updateMilestone: (projectId: number, milestoneId: number, data: Record<string, unknown>) =>
    apiClient.put(`/is-projects/${projectId}/milestones/${milestoneId}`, data),
  deleteMilestone: (projectId: number, milestoneId: number) =>
    apiClient.delete(`/is-projects/${projectId}/milestones/${milestoneId}`),
  getMilestoneEvidence: (projectId: number, milestoneId: number) =>
    apiClient.get(`/is-projects/${projectId}/milestones/${milestoneId}/evidence`),
  uploadMilestoneEvidence: (projectId: number, milestoneId: number, formData: FormData) =>
    apiClient.post(`/is-projects/${projectId}/milestones/${milestoneId}/evidence`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  deleteMilestoneEvidence: (projectId: number, milestoneId: number, linkId: number) =>
    apiClient.delete(`/is-projects/${projectId}/milestones/${milestoneId}/evidence/${linkId}`),
  createTask: (projectId: number, data: Record<string, unknown>) =>
    apiClient.post(`/is-projects/${projectId}/tasks`, data),
  updateTask: (projectId: number, taskId: number, data: Record<string, unknown>) =>
    apiClient.put(`/is-projects/${projectId}/tasks/${taskId}`, data),
  deleteTask: (projectId: number, taskId: number) =>
    apiClient.delete(`/is-projects/${projectId}/tasks/${taskId}`),
  addTeamMember: (projectId: number, data: Record<string, unknown>) =>
    apiClient.post(`/is-projects/${projectId}/team`, data),
  updateTeamMember: (projectId: number, memberId: number, data: Record<string, unknown>) =>
    apiClient.put(`/is-projects/${projectId}/team/${memberId}`, data),
  removeTeamMember: (projectId: number, memberId: number) =>
    apiClient.delete(`/is-projects/${projectId}/team/${memberId}`),
  createUpdate: (projectId: number, data: Record<string, unknown>) =>
    apiClient.post(`/is-projects/${projectId}/updates`, data),
  updateUpdate: (projectId: number, updateId: number, data: Record<string, unknown>) =>
    apiClient.put(`/is-projects/${projectId}/updates/${updateId}`, data),
  deleteUpdate: (projectId: number, updateId: number) =>
    apiClient.delete(`/is-projects/${projectId}/updates/${updateId}`),
  createRisk: (projectId: number, data: Record<string, unknown>) =>
    apiClient.post(`/is-projects/${projectId}/risks`, data),
  updateRisk: (projectId: number, riskId: number, data: Record<string, unknown>) =>
    apiClient.put(`/is-projects/${projectId}/risks/${riskId}`, data),
  deleteRisk: (projectId: number, riskId: number) =>
    apiClient.delete(`/is-projects/${projectId}/risks/${riskId}`),
  addDocument: (projectId: number, data: Record<string, unknown>) =>
    apiClient.post(`/is-projects/${projectId}/documents`, data),
  uploadDocument: (projectId: number, formData: FormData) =>
    apiClient.post(`/is-projects/${projectId}/documents/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  downloadDocument: (projectId: number, documentId: number) =>
    apiClient.get(`/is-projects/${projectId}/documents/${documentId}/download`, {
      responseType: 'blob',
    }),
  updateDocument: (projectId: number, documentId: number, data: Record<string, unknown>) =>
    apiClient.put(`/is-projects/${projectId}/documents/${documentId}`, data),
  removeDocument: (projectId: number, documentId: number) =>
    apiClient.delete(`/is-projects/${projectId}/documents/${documentId}`),
  getBudgetItems: (projectId: number) => apiClient.get(`/is-projects/${projectId}/budget-items`),
  createBudgetItem: (projectId: number, data: Record<string, unknown>) =>
    apiClient.post(`/is-projects/${projectId}/budget-items`, data),
  updateBudgetItem: (projectId: number, itemId: number, data: Record<string, unknown>) =>
    apiClient.put(`/is-projects/${projectId}/budget-items/${itemId}`, data),
  deleteBudgetItem: (projectId: number, itemId: number) =>
    apiClient.delete(`/is-projects/${projectId}/budget-items/${itemId}`),
  getComplianceMappings: (projectId: number) => apiClient.get(`/is-projects/${projectId}/compliance-mappings`),
  createComplianceMapping: (projectId: number, data: Record<string, unknown>) =>
    apiClient.post(`/is-projects/${projectId}/compliance-mappings`, data),
  updateComplianceMapping: (projectId: number, mappingId: number, data: Record<string, unknown>) =>
    apiClient.put(`/is-projects/${projectId}/compliance-mappings/${mappingId}`, data),
  deleteComplianceMapping: (projectId: number, mappingId: number) =>
    apiClient.delete(`/is-projects/${projectId}/compliance-mappings/${mappingId}`),
  getLessonsLearned: (projectId: number) => apiClient.get(`/is-projects/${projectId}/lessons-learned`),
  createLessonLearned: (projectId: number, data: Record<string, unknown>) =>
    apiClient.post(`/is-projects/${projectId}/lessons-learned`, data),
  updateLessonLearned: (projectId: number, lessonId: number, data: Record<string, unknown>) =>
    apiClient.put(`/is-projects/${projectId}/lessons-learned/${lessonId}`, data),
  deleteLessonLearned: (projectId: number, lessonId: number) =>
    apiClient.delete(`/is-projects/${projectId}/lessons-learned/${lessonId}`),
  getDependencies: (projectId: number) => apiClient.get(`/is-projects/${projectId}/dependencies`),
  createDependency: (projectId: number, data: Record<string, unknown>) =>
    apiClient.post(`/is-projects/${projectId}/dependencies`, data),
  updateDependency: (projectId: number, depId: number, data: Record<string, unknown>) =>
    apiClient.put(`/is-projects/${projectId}/dependencies/${depId}`, data),
  deleteDependency: (projectId: number, depId: number) =>
    apiClient.delete(`/is-projects/${projectId}/dependencies/${depId}`),
  aiGeneratePlan: (projectId: number) =>
    apiClient.post(`/is-projects/${projectId}/ai/generate-plan`),
  aiAssessRisks: (projectId: number) =>
    apiClient.post(`/is-projects/${projectId}/ai/assess-risks`),
  aiDraftStatusReport: (projectId: number) =>
    apiClient.post(`/is-projects/${projectId}/ai/draft-status-report`),
  aiSuggestTeam: (projectId: number) =>
    apiClient.post(`/is-projects/${projectId}/ai/suggest-team`),
  aiEstimateBudget: (projectId: number) =>
    apiClient.post(`/is-projects/${projectId}/ai/estimate-budget`),
};

export const criticalTasksApi = {
  list: (params?: Record<string, unknown>) => apiClient.get('/critical-tasks', { params }),
  myTasks: () => apiClient.get('/critical-tasks/my-tasks'),
  getTenantUsers: () => apiClient.get('/critical-tasks/tenant-users'),
  get: (id: number) => apiClient.get(`/critical-tasks/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/critical-tasks', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put(`/critical-tasks/${id}`, data),
  delete: (id: number) => apiClient.delete(`/critical-tasks/${id}`),
  transition: (id: number, data: Record<string, unknown>) => apiClient.post(`/critical-tasks/${id}/transition`, data),
  addComment: (id: number, data: Record<string, unknown>) => apiClient.post(`/critical-tasks/${id}/comments`, data),
  getHistory: (id: number) => apiClient.get(`/critical-tasks/${id}/history`),
  createSubTask: (id: number, data: Record<string, unknown>) => apiClient.post(`/critical-tasks/${id}/sub-tasks`, data),
  updateSubTask: (id: number, subId: number, data: Record<string, unknown>) =>
    apiClient.put(`/critical-tasks/${id}/sub-tasks/${subId}`, data),
  deleteSubTask: (id: number, subId: number) => apiClient.delete(`/critical-tasks/${id}/sub-tasks/${subId}`),
  reportsSummary: () => apiClient.get('/critical-tasks/reports/summary'),
  bulkAction: (data: Record<string, unknown>) => apiClient.post('/critical-tasks/bulk-action', data),
  listTemplates: () => apiClient.get('/critical-tasks/templates/list'),
  createFromTemplate: (data: Record<string, unknown>) => apiClient.post('/critical-tasks/create-from-template', data),
  requestApproval: (id: number, data: Record<string, unknown>) => apiClient.post(`/critical-tasks/${id}/request-approval`, data),
  approveTask: (id: number, data: Record<string, unknown>) => apiClient.post(`/critical-tasks/${id}/approve`, data),
  rejectTask: (id: number, data: Record<string, unknown>) => apiClient.post(`/critical-tasks/${id}/reject`, data),
  aiPrioritize: () => apiClient.post('/critical-tasks/ai/prioritize-tasks', {}),
  aiRootCause: (id: number) => apiClient.post(`/critical-tasks/${id}/ai/analyze-root-cause`, {}),
  aiGenerateDescription: (data: Record<string, unknown>) => apiClient.post('/critical-tasks/ai/generate-description', data),
  aiPredictEscalations: () => apiClient.post('/critical-tasks/ai/predict-escalations', {}),
  aiBalanceWorkload: () => apiClient.post('/critical-tasks/ai/balance-workload', {}),
};

export const certificationsApi = {
  getAll: (params?: { status?: string; framework_id?: number }) => 
    apiClient.get('/certifications', { params }),
  getById: (id: number) => apiClient.get(`/certifications/${id}`),
  getFrameworkPhases: (frameworkId: number) => apiClient.get(`/certifications/uploaded-frameworks/${frameworkId}/phases`),
  generatePhases: (frameworkId: number) => apiClient.post(`/certifications/frameworks/${frameworkId}/generate-phases`),
  create: (data: { framework_id: number; name: string; target_date?: string }) => 
    apiClient.post('/certifications', data),
  update: (id: number, data: { status?: string; target_date?: string; notes?: string }) => 
    apiClient.patch(`/certifications/${id}`, data),
  delete: (id: number) => apiClient.delete(`/certifications/${id}`),
  
  getControls: (id: number, params?: { status?: string; domain_id?: number }) => 
    apiClient.get(`/certifications/${id}/controls`, { params }),
  getControlDetail: (journeyId: number, controlId: number) =>
    apiClient.get(`/certifications/${journeyId}/controls/${controlId}`),
  updateControl: (journeyId: number, controlId: number, data: { status?: string; notes?: string; priority?: number; is_applicable?: boolean }) =>
    apiClient.patch(`/certifications/${journeyId}/controls/${controlId}`, data),
  // Critical-clause AI analysis. POST kicks off a synchronous classification
  // pass over the framework's parsed controls; GET returns whatever has been
  // persisted (cheap DB read, used to render the panel).
  analyzeCriticalControls: (journeyId: number) =>
    apiClient.post(`/certifications/${journeyId}/analyze-critical`),
  getCriticalControls: (journeyId: number) =>
    apiClient.get(`/certifications/${journeyId}/critical-controls`),
  
  uploadEvidence: (journeyId: number, controlId: number, formData: FormData) => 
    apiClient.post(`/certifications/${journeyId}/controls/${controlId}/evidence`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }),
  assessEvidence: (journeyId: number, controlId: number, evidenceId: number) => 
    apiClient.post(`/certifications/${journeyId}/controls/${controlId}/evidence/${evidenceId}/assess`),
  reviewEvidence: (journeyId: number, controlId: number, evidenceId: number, data: { action: string; notes?: string }) => 
    apiClient.post(`/certifications/${journeyId}/controls/${controlId}/evidence/${evidenceId}/review`, data),
  
  getProgress: (id: number) => apiClient.get(`/certifications/${id}/progress`),
  getCharts: (id: number) => apiClient.get(`/certifications/${id}/charts`),
  getGaps: (id: number) => apiClient.get(`/certifications/${id}/gaps`),
  getCDESystems: () => apiClient.get('/certifications/cde-systems'),
  updateCDESystemScope: (assetId: number, data: { cde_environment: boolean }) =>
    apiClient.put(`/certifications/cde-systems/${assetId}/scope`, data),

  assignControl: (journeyId: number, controlId: number, userIds: number[]) =>
    apiClient.patch(`/certifications/${journeyId}/controls/${controlId}/assign`, {
      assigned_user_ids: userIds,
    }),
  getTenantUsers: () =>
    apiClient.get<Array<{ id: number; username: string; display_name: string; email: string }>>(
      '/certifications/meta/tenant-users'
    ),
};

export const ermApi = {
  risks: {
    getAll: (filters?: { category?: string; register_type?: string; status?: string; min_score?: number; max_score?: number }) => {
      const params = new URLSearchParams();
      if (filters?.category) params.append('category', filters.category);
      if (filters?.register_type) params.append('register_type', filters.register_type);
      if (filters?.status) params.append('status_filter', filters.status);
      if (filters?.min_score !== undefined) params.append('min_score', filters.min_score.toString());
      if (filters?.max_score !== undefined) params.append('max_score', filters.max_score.toString());
      const queryString = params.toString();
      return apiClient.get<Risk[]>(`/erm/risks${queryString ? `?${queryString}` : ''}`);
    },
    getById: (id: number) => apiClient.get<Risk>(`/erm/risks/${id}`),
    getDetail: (id: number) => apiClient.get<RiskDetail>(`/erm/risks/${id}/detail`),
    getDashboard: () => apiClient.get<RiskDashboard>('/erm/risks/dashboard'),
    getDashboardByRegister: () => apiClient.get<{
      total_risks: number;
      registers: Array<{
        register_type: string;
        total: number;
        by_status: { open: number; in_treatment: number; mitigated: number; accepted: number; closed: number };
        by_category: Record<string, number>;
        by_score_range: { critical: number; high: number; medium: number; low: number };
        top_owners: Array<{ owner: string; count: number }>;
        contributors: number;
        avg_residual_score: number;
      }>;
    }>('/erm/risks/dashboard/by-register'),
    getDashboardBySource: () => apiClient.get<{
      total_risks: number;
      sources: Array<{
        source_type: string;
        total: number;
        by_status: { open: number; in_treatment: number; mitigated: number; accepted: number; closed: number };
      }>;
    }>('/erm/risks/dashboard/by-source'),
    getHeatmap: (riskType?: string) => apiClient.get<HeatmapCell[]>(`/erm/risks/heatmap${riskType ? `?risk_type=${riskType}` : ''}`),
    create: (data: Partial<Risk>) => apiClient.post<Risk>('/erm/risks', data),
    update: (id: number, data: Partial<Risk>) => apiClient.put<Risk>(`/erm/risks/${id}`, data),
    delete: (id: number) => apiClient.delete(`/erm/risks/${id}`),
    uploadRiskRegister: (file: File, registerType?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      const params = registerType ? `?register_type=${encodeURIComponent(registerType)}` : '';
      return apiClient.post<{ message: string; created: number; skipped: number; errors: string[] }>(`/erm/risks/upload${params}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    downloadTemplate: () =>
      apiClient.get('/erm/risks/template/download', {
        responseType: 'blob',
      }),
    closeRisk: (riskId: number, notes?: string) =>
      // Backend expects closure_notes as a query param (not a body).
      apiClient.post<Risk>(`/erm/risks/${riskId}/close`, null, notes ? { params: { closure_notes: notes } } : undefined),
    reopenRisk: (riskId: number) => 
      apiClient.post<Risk>(`/erm/risks/${riskId}/reopen`),
    getRiskAging: () => 
      apiClient.get<Array<{ risk_id: number; title: string; days_open: number; status: string }>>('/erm/risks/aging'),
    getAISuggestions: (data: { name: string; category?: string; sub_category?: string; description?: string }) =>
      apiClient.post<{
        suggested_description: string;
        suggested_causes: string[];
        suggested_consequences: string[];
        recommended_controls: Array<{
          control_id: number;
          control_name: string;
          control_code?: string;
          relevance: string;
          rationale: string;
        }>;
        suggested_likelihood: number;
        suggested_impact: number;
        risk_treatment_options: string[];
      }>('/erm/risks/ai-suggest', data),
    generateTreatmentPlan: (riskId: number) =>
      apiClient.post<{ treatment_plan: string }>(`/erm/risks/${riskId}/ai-treatment-plan`),
    linkAsset: (id: number, data: { asset_id: number }) =>
      apiClient.post(`/erm/risks/${id}/assets`, data),
    unlinkAsset: (id: number, linkId: number) =>
      apiClient.delete(`/erm/risks/${id}/assets/${linkId}`),
  },
  mitigationActions: {
    getAll: (riskId: number) => 
      apiClient.get<RiskMitigationAction[]>(`/erm/risks/${riskId}/mitigation-actions`),
    create: (riskId: number, data: Partial<RiskMitigationAction>) => 
      apiClient.post<RiskMitigationAction>(`/erm/risks/${riskId}/mitigation-actions`, data),
    update: (actionId: number, data: Partial<RiskMitigationAction>) => 
      apiClient.put<RiskMitigationAction>(`/erm/mitigation-actions/${actionId}`, data),
    delete: (actionId: number) => 
      apiClient.delete(`/erm/mitigation-actions/${actionId}`),
    complete: (actionId: number, actualReduction?: number) => 
      apiClient.post<RiskMitigationAction>(`/erm/mitigation-actions/${actionId}/complete`, { actual_residual_reduction: actualReduction }),
    getOverdue: () => 
      apiClient.get<RiskMitigationAction[]>('/erm/mitigation-actions/overdue'),
    aiSuggest: (data: { risk_id?: number; title?: string }) =>
      apiClient.post<{
        suggestions: Array<{
          title: string;
          description: string;
          action_type: string;
          priority: string;
          expected_residual_reduction: number;
        }>;
      }>('/erm/mitigation-actions/ai-suggest', data),
    // Evidence linkage — same shape as `internalControls.{getEvidence,linkEvidence,unlinkEvidence}`.
    getEvidence: (actionId: number) =>
      apiClient.get<Array<{
        id: number;
        evidence_id: number;
        title: string;
        description?: string | null;
        evidence_type?: string | null;
        status?: string | null;
        file_name?: string | null;
        file_url?: string | null;
        notes?: string | null;
        linked_at?: string | null;
      }>>(`/erm/mitigation-actions/${actionId}/evidence`),
    linkEvidence: (actionId: number, data: { evidence_id: number; notes?: string }) =>
      apiClient.post(`/erm/mitigation-actions/${actionId}/evidence`, data),
    unlinkEvidence: (actionId: number, linkId: number) =>
      apiClient.delete(`/erm/mitigation-actions/${actionId}/evidence/${linkId}`),
  },
  scales: {
    getAll: () => 
      apiClient.get<LikelihoodImpactScale[]>('/erm/scales'),
    seedDefaults: () => 
      apiClient.post<{ message: string }>('/erm/scales/seed-defaults'),
  },
  kris: {
    getAll: (params?: { risk_id?: number; status_filter?: string; is_active?: boolean }) => 
      apiClient.get<RiskKRI[]>('/erm/kris', { params }),
    getById: (id: number) => apiClient.get<RiskKRI>(`/erm/kris/${id}`),
    create: (data: RiskKRICreate) => apiClient.post<RiskKRI>('/erm/kris', data),
    update: (id: number, data: RiskKRIUpdate) => apiClient.put<RiskKRI>(`/erm/kris/${id}`, data),
    delete: (id: number) => apiClient.delete(`/erm/kris/${id}`),
    measure: (id: number, data: { value: number; notes?: string }) => 
      apiClient.post<RiskKRIMeasurement>(`/erm/kris/${id}/measure`, data),
    getTrend: (id: number, days?: number) => 
      apiClient.get<RiskKRIMeasurement[]>(`/erm/kris/${id}/trend`, { params: { days } }),
    getAlerts: () => apiClient.get<RiskKRI[]>('/erm/kris/alerts'),
    upload: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.post<{ message: string; created: number; skipped: number; errors: string[] }>(
        '/erm/kris/upload',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
    },
    uploadRegister: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.post<{ message: string; created: number; skipped: number; errors: string[] }>(
        '/erm/kris/upload',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
    },
    aiSuggestManual: (data: { name: string; description?: string; risk_id?: number; metric_hint?: string }) =>
      apiClient.post<{
        name: string;
        suggestion: {
          description: string;
          metric_type: string;
          unit?: string;
          threshold_direction: string;
          frequency: string;
          green_threshold?: number;
          amber_threshold?: number;
          data_source?: string;
          rationale?: string;
        };
      }>('/erm/kris/ai-suggest', data),
  },
  incidents: {
    getAll: (params?: { risk_id?: number; severity?: string; status_filter?: string; start_date?: string; end_date?: string }) => 
      apiClient.get<RiskIncident[]>('/erm/incidents', { params }),
    getById: (id: number) => apiClient.get<RiskIncident>(`/erm/incidents/${id}`),
    create: (data: RiskIncidentCreate) => apiClient.post<RiskIncident>('/erm/incidents', data),
    update: (id: number, data: RiskIncidentUpdate) => apiClient.put<RiskIncident>(`/erm/incidents/${id}`, data),
    delete: (id: number) => apiClient.delete(`/erm/incidents/${id}`),
    getDashboard: () => apiClient.get<IncidentDashboard>('/erm/incidents/dashboard'),
    analyzeWithAI: (data: { title: string; description: string; severity?: string; incident_date?: string; department?: string }) =>
      apiClient.post<{
        root_cause_analysis: {
          primary_cause: string;
          contributing_factors: string[];
          category: string;
          preventability: string;
        };
        related_risks: Array<{
          risk_id: number;
          risk_title: string;
          relevance: string;
          explanation: string;
        }>;
        related_controls: Array<{
          control_id: number;
          control_title: string;
          framework: string;
          relevance: string;
          status_recommendation: string;
        }>;
        recommended_actions: string[];
        similar_incidents: Array<{
          incident_id: number;
          title: string;
          similarity: number;
        }>;
        impact_assessment: {
          financial_impact: string;
          reputational_impact: string;
          regulatory_impact: string;
          operational_impact: string;
        };
      }>('/erm/incidents/ai-analyze', data),
    aiSuggestManual: (data: { title: string; description?: string; severity?: string; risk_id?: number }) =>
      apiClient.post<{
        title: string;
        suggestion: {
          suggested_severity: string;
          root_cause?: string;
          corrective_actions?: string;
          operational_impact?: string;
          rationale?: string;
        };
      }>('/erm/incidents/ai-suggest', data),
  },
  reviews: {
    getAll: (params?: { risk_id?: number; status_filter?: string; reviewer_id?: number }) => 
      apiClient.get<RiskReview[]>('/erm/reviews', { params }),
    getById: (id: number) => apiClient.get<RiskReview>(`/erm/reviews/${id}`),
    create: (data: RiskReviewCreate) => apiClient.post<RiskReview>('/erm/reviews', data),
    update: (id: number, data: RiskReviewUpdate) => apiClient.put<RiskReview>(`/erm/reviews/${id}`, data),
    complete: (id: number, data: { findings?: string; recommendations?: string; new_inherent_score?: number; new_residual_score?: number }) => 
      apiClient.post<RiskReview>(`/erm/reviews/${id}/complete`, data),
    getPending: () => apiClient.get<RiskReview[]>('/erm/reviews/pending'),
    getOverdue: () => apiClient.get<RiskReview[]>('/erm/reviews/overdue'),
  },
  dependencies: {
    getAll: (params?: { risk_id?: number }) => 
      apiClient.get<RiskDependency[]>('/erm/dependencies', { params }),
    create: (data: RiskDependencyCreate) => apiClient.post<RiskDependency>('/erm/dependencies', data),
    delete: (id: number) => apiClient.delete(`/erm/dependencies/${id}`),
    getCascadeAnalysis: (riskId: number) => apiClient.get<CascadeAnalysis>(`/erm/dependencies/${riskId}/cascade`),
    getGraph: (riskId?: number) => 
      apiClient.get(`/erm/dependencies/graph`, { params: { risk_id: riskId } }),
  },
  reports: {
    getAll: (params?: { report_type?: string; status?: string }) => 
      apiClient.get<RiskReport[]>('/erm/reports', { params }),
    getById: (id: number) => apiClient.get<RiskReport>(`/erm/reports/${id}`),
    generate: (data: RiskReportCreate) => apiClient.post<RiskReport>('/erm/reports', data),
    delete: (id: number) => apiClient.delete(`/erm/reports/${id}`),
    getExecutiveDashboard: () => apiClient.get<ExecutiveDashboard>('/erm/reports/executive-dashboard'),
    getBoardSummary: (params?: { period?: string }) => 
      apiClient.get<BoardReportData>('/erm/reports/board-summary', { params }),
    getDepartmentSummary: (departmentId: number) => 
      apiClient.get<DepartmentRiskSummary>(`/erm/reports/department/${departmentId}`),
    getAggregatedView: (groupBy?: string) => 
      apiClient.get<AggregatedRiskView[]>('/erm/analytics/aggregated', { params: { group_by: groupBy } }),
    getAppetiteBreaches: () => apiClient.get<AppetiteBreach[]>('/erm/analytics/appetite-breaches'),
    getRiskTrends: (days?: number) => 
      apiClient.get<RiskTrendData[]>('/erm/analytics/trends', { params: { days } }),
  },
  appetite: {
    getAll: () => apiClient.get('/erm/appetite'),
    getWithStats: () => apiClient.get('/erm/appetite/with-stats'),
    getBreaches: () => apiClient.get('/erm/appetite/breaches'),
    update: (id: number, data: Record<string, unknown>) => 
      apiClient.put(`/erm/appetite/${id}`, data),
    create: (tenantId: number, data: Record<string, unknown>) => 
      apiClient.post(`/erm/appetite?tenant_id=${tenantId}`, data),
    delete: (id: number) =>
      apiClient.delete(`/erm/appetite/${id}`),
    seedDefaults: (tenantId?: number) => 
      apiClient.post(`/erm/appetite/seed-defaults${tenantId ? `?tenant_id=${tenantId}` : ''}`),
    aiSuggest: (data: { category: string; description?: string }) =>
      apiClient.post<{
        category: string;
        appetite_level: string;
        tolerance_threshold: number;
        max_acceptable_score: number;
        description: string;
        escalation_criteria: string;
        rationale: string;
      }>('/erm/appetite/ai-suggest', data),
  },
  internalControls: {
    getAll: (params?: { status_filter?: string; category?: string; department_id?: number; control_type?: string; is_key_control?: boolean }) =>
      apiClient.get('/erm/internal-controls', { params }),
    getById: (id: number) => apiClient.get(`/erm/internal-controls/${id}`),
    getDashboard: () => apiClient.get('/erm/internal-controls/dashboard'),
    create: (data: Record<string, unknown>) => apiClient.post('/erm/internal-controls', data),
    update: (id: number, data: Record<string, unknown>) => apiClient.put(`/erm/internal-controls/${id}`, data),
    delete: (id: number) => apiClient.delete(`/erm/internal-controls/${id}`),
    submit: (id: number, comments?: string) => apiClient.post(`/erm/internal-controls/${id}/submit`, { comments }),
    approve: (id: number, comments?: string) => apiClient.post(`/erm/internal-controls/${id}/approve`, { comments }),
    reject: (id: number, comments?: string) => apiClient.post(`/erm/internal-controls/${id}/reject`, { comments }),
    getTests: (id: number) => apiClient.get(`/erm/internal-controls/${id}/tests`),
    createTest: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/internal-controls/${id}/tests`, data),
    getRisks: (id: number) => apiClient.get(`/erm/internal-controls/${id}/risks`),
    linkRisk: (id: number, data: { risk_id: number; link_type?: string; effectiveness_rating?: string }) => 
      apiClient.post(`/erm/internal-controls/${id}/risks`, data),
    unlinkRisk: (id: number, linkId: number) => apiClient.delete(`/erm/internal-controls/${id}/risks/${linkId}`),
    getEscalations: (id: number) => apiClient.get(`/erm/internal-controls/${id}/escalations`),
    createEscalation: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/internal-controls/${id}/escalations`, data),
    deleteEscalation: (id: number, escId: number) => apiClient.delete(`/erm/internal-controls/${id}/escalations/${escId}`),
    getWorkflowHistory: (id: number) => apiClient.get(`/erm/internal-controls/${id}/workflow-history`),
    getFrameworkLinks: (id: number) => apiClient.get(`/erm/internal-controls/${id}/framework-links`),
    createFrameworkLink: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/internal-controls/${id}/framework-links`, data),
    deleteFrameworkLink: (id: number, linkId: number) => apiClient.delete(`/erm/internal-controls/${id}/framework-links/${linkId}`),
    getEvidence: (id: number) => apiClient.get(`/erm/internal-controls/${id}/evidence`),
    linkEvidence: (id: number, data: { evidence_id: number; notes?: string }) => apiClient.post(`/erm/internal-controls/${id}/evidence`, data),
    unlinkEvidence: (id: number, linkId: number) => apiClient.delete(`/erm/internal-controls/${id}/evidence/${linkId}`),
    getAISuggestions: (data: { name: string; description?: string }) =>
      apiClient.post<{
        suggested_category: string;
        suggested_subcategory: string;
        suggested_description?: string;
        suggested_control_type?: string;
        suggested_control_nature?: string;
        suggested_frequency?: string;
        suggested_priority?: string;
        suggestion_confidence: number;
      }>(
        '/erm/internal-controls/ai-suggest-category',
        data
      ),
    uploadManualWithAI: (file: File, autoCreate: boolean = false) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('auto_create', String(autoCreate));
      return apiClient.post<{
        message: string;
        file_name: string;
        auto_create: boolean;
        extracted_count: number;
        suggested_count: number;
        created: number;
        skipped: number;
        errors: string[];
        preview: Array<Record<string, unknown>>;
      }>('/erm/internal-controls/upload-manual', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
    },
    getSubcategories: (category: string) =>
      apiClient.get<{ category: string; subcategories: string[] }>(`/erm/internal-controls/subcategories/${category}`),
  },
  analytics: {
    getInteractiveHeatmap: (params?: { risk_type?: string; category?: string; treatment?: string; business_unit_id?: number; score_type?: string }) =>
      apiClient.get('/erm/analytics/heatmap', { params }),
    getBowTie: (riskId: number) =>
      apiClient.get(`/erm/analytics/bowtie/${riskId}`),
    runScenarioAnalysis: (data: { scenarios: Array<{ risk_id: number; adjusted_likelihood: number; adjusted_impact: number; scenario_name?: string; notes?: string }> }, scoreType?: string) =>
      apiClient.post(`/erm/analytics/scenario-analysis${scoreType ? `?score_type=${scoreType}` : ''}`, data),
    getScenarioPresets: () =>
      apiClient.get('/erm/analytics/scenario-presets'),
    getAggregation: () =>
      apiClient.get('/erm/analytics/aggregation'),
    getKRITriggers: (params?: { severity?: string; acknowledged?: boolean }) =>
      apiClient.get('/erm/analytics/kri-triggers', { params }),
    generateBowTieNarrative: (riskId: number) =>
      apiClient.post(`/erm/analytics/bowtie/${riskId}/ai-narrative`),
    aiExplainScenario: (data: { results: any[]; summary: any; scenario_type?: string }) =>
      apiClient.post<{ explanation: string }>('/erm/analytics/scenario-analysis/ai-explain', data),
  },
  riskAssessments: {
    getAll: (params?: { skip?: number; limit?: number; status?: string; assessment_type?: string }) => 
      apiClient.get('/erm/risk-assessments', { params }),
    getById: (id: number) => apiClient.get(`/erm/risk-assessments/${id}`),
    getDetail: (id: number) => apiClient.get(`/erm/risk-assessments/${id}/detail`),
    create: (data: Record<string, unknown>) => apiClient.post('/erm/risk-assessments', data),
    update: (id: number, data: Record<string, unknown>) => apiClient.put(`/erm/risk-assessments/${id}`, data),
    delete: (id: number) => apiClient.delete(`/erm/risk-assessments/${id}`),
    updateStatus: (id: number, data: { status: string; notes?: string }) => 
      apiClient.post(`/erm/risk-assessments/${id}/status`, data),
    addRisk: (id: number, data: Record<string, unknown>) => 
      apiClient.post(`/erm/risk-assessments/${id}/risks`, data),
    updateRisk: (assessmentId: number, assessmentRiskId: number, data: Record<string, unknown>) => 
      apiClient.put(`/erm/risk-assessments/${assessmentId}/risks/${assessmentRiskId}`, data),
    removeRisk: (assessmentId: number, assessmentRiskId: number) => 
      apiClient.delete(`/erm/risk-assessments/${assessmentId}/risks/${assessmentRiskId}`),
    bulkAddRisks: (id: number, risk_ids: number[]) => 
      apiClient.post(`/erm/risk-assessments/${id}/risks/bulk`, { risk_ids }),
    getAssessedRisks: (id: number, params?: { skip?: number; limit?: number }) => 
      apiClient.get(`/erm/risk-assessments/${id}/risks`, { params }),
    getAvailableRisks: (id: number) => 
      apiClient.get(`/erm/risk-assessments/${id}/available-risks`),
    linkKRI: (assessmentId: number, assessmentRiskId: number, data: Record<string, unknown>) => 
      apiClient.post(`/erm/risk-assessments/${assessmentId}/risks/${assessmentRiskId}/kris`, data),
    unlinkKRI: (assessmentId: number, assessmentRiskId: number, linkId: number) => 
      apiClient.delete(`/erm/risk-assessments/${assessmentId}/risks/${assessmentRiskId}/kris/${linkId}`),
    linkIncident: (assessmentId: number, assessmentRiskId: number, data: Record<string, unknown>) => 
      apiClient.post(`/erm/risk-assessments/${assessmentId}/risks/${assessmentRiskId}/incidents`, data),
    unlinkIncident: (assessmentId: number, assessmentRiskId: number, linkId: number) => 
      apiClient.delete(`/erm/risk-assessments/${assessmentId}/risks/${assessmentRiskId}/incidents/${linkId}`),
    linkRCSAFinding: (assessmentId: number, assessmentRiskId: number, data: Record<string, unknown>) => 
      apiClient.post(`/erm/risk-assessments/${assessmentId}/risks/${assessmentRiskId}/rcsa-findings`, data),
    unlinkRCSAFinding: (assessmentId: number, assessmentRiskId: number, linkId: number) => 
      apiClient.delete(`/erm/risk-assessments/${assessmentId}/risks/${assessmentRiskId}/rcsa-findings/${linkId}`),
    aiSuggestRisk: (assessmentId: number, assessmentRiskId: number) =>
      apiClient.post(`/erm/risk-assessments/${assessmentId}/risks/${assessmentRiskId}/ai-suggest`),
    getSummary: (id: number) => apiClient.get(`/erm/risk-assessments/${id}/summary`),
    getDashboard: () => apiClient.get<{
      total: number;
      by_status: { draft: number; in_progress: number; under_review: number; approved: number; closed: number; [k: string]: number };
      by_type: Record<string, number>;
      by_methodology: Record<string, number>;
      top_assessors: Array<{ assessor: string; count: number }>;
      monthly_trend: Array<{ month: string; count: number }>;
      risks_per_assessment_avg: number;
      total_risks_assessed: number;
      // ---- Framework-driven assessments (added Issue #2 fix) ----
      frameworks: {
        total: number;
        by_status: { in_progress: number; completed: number; archived: number; [k: string]: number };
        by_framework: Array<{ framework: string; count: number }>;
        top_creators: Array<{ creator: string; count: number }>;
        monthly_trend: Array<{ month: string; count: number }>;
        questions_total: number;
        questions_per_assessment_avg: number;
      };
      combined_total: number;
    }>('/erm/risk-assessments/dashboard'),
    getRiskBreakdown: (id: number) => apiClient.get<{
      assessment_id: number;
      assessment_name: string;
      status: string;
      total_risks: number;
      by_rating: { critical: number; high: number; medium: number; low: number };
      by_treatment: { accept: number; mitigate: number; transfer: number; avoid: number };
      by_effectiveness: { effective: number; partially_effective: number; ineffective: number; unrated: number };
      by_score_range: { critical: number; high: number; medium: number; low: number };
      avg_inherent_score: number;
      avg_residual_score: number;
      score_reduction: number;
    }>(`/erm/risk-assessments/${id}/risk-breakdown`),
    uploadExcel: (formData: FormData) =>
      apiClient.post<{
        assessment_id: number;
        assessment_name: string;
        risks_created: number;
        rows_skipped: number;
        rows_errored: number;
        skipped_details: Array<{ row: number; reason: string }>;
        error_details: Array<{ row: number; error: string }>;
        mapped_columns: string[];
      }>('/erm/risk-assessments/upload-excel', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
  },
  frameworkRiskAssessments: {
    getAll: () => apiClient.get('/erm/framework-risk-assessments'),
    getMyAssignedQuestions: () => apiClient.get('/erm/framework-risk-assessments/my-assigned-questions'),
    getAvailableFrameworks: () => apiClient.get('/erm/framework-risk-assessments/available-frameworks'),
    getMethodologies: () => apiClient.get<{ methodologies: FrameworkMethodology[] }>(
      '/erm/framework-risk-assessments/methodologies'
    ),
    detectMethodology: (uploadedFrameworkId: number) =>
      apiClient.get<{
        framework_id: number;
        framework_name: string;
        methodology: FrameworkMethodology | null;
        fallback_will_use_ai: boolean;
      }>(`/erm/framework-risk-assessments/available-frameworks/${uploadedFrameworkId}/methodology`),
    getById: (id: number) => apiClient.get(`/erm/framework-risk-assessments/${id}`),
    create: (data: Record<string, unknown>) => apiClient.post('/erm/framework-risk-assessments', data),
    update: (id: number, data: Record<string, unknown>) => apiClient.put(`/erm/framework-risk-assessments/${id}`, data),
    delete: (id: number) => apiClient.delete(`/erm/framework-risk-assessments/${id}`),
    generateQuestions: (
      id: number,
      data?: {
        count?: number;
        replace_existing?: boolean;
        scope?: 'full' | 'sample';
        methodology_code?: string;
      }
    ) => apiClient.post(`/erm/framework-risk-assessments/${id}/generate-questions`, data || {}),
    addQuestion: (id: number, data: Record<string, unknown>) =>
      apiClient.post(`/erm/framework-risk-assessments/${id}/questions`, data),
    updateQuestion: (assessmentId: number, questionId: number, data: Record<string, unknown>) =>
      apiClient.put(`/erm/framework-risk-assessments/${assessmentId}/questions/${questionId}`, data),
    moveQuestionToRiskRegister: (assessmentId: number, questionId: number, data?: Record<string, unknown>) =>
      apiClient.post(`/erm/framework-risk-assessments/${assessmentId}/questions/${questionId}/move-to-risk-register`, data || {}),
    aiSuggestQuestion: (assessmentId: number, questionId: number, contextHint?: string) =>
      apiClient.post<{
        methodology_code: string;
        suggestions: Record<string, string>;
        recommendations: string;
        rationale: string;
        recommended_scores: {
          inherent_likelihood: number | null;
          inherent_impact: number | null;
          residual_likelihood: number | null;
          residual_impact: number | null;
        };
      }>(`/erm/framework-risk-assessments/${assessmentId}/questions/${questionId}/ai-suggest`, {
        context_hint: contextHint,
      }),
    deleteQuestion: (assessmentId: number, questionId: number) =>
      apiClient.delete(`/erm/framework-risk-assessments/${assessmentId}/questions/${questionId}`),
    uploadEvidence: (assessmentId: number, questionId: number, formData: FormData) =>
      apiClient.post(`/erm/framework-risk-assessments/${assessmentId}/questions/${questionId}/evidence`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    listEvidence: (assessmentId: number, questionId: number) =>
      apiClient.get(`/erm/framework-risk-assessments/${assessmentId}/questions/${questionId}/evidence`),
    deleteEvidence: (assessmentId: number, evidenceId: number) =>
      apiClient.delete(`/erm/framework-risk-assessments/${assessmentId}/evidence/${evidenceId}`),
  },
};

// Alias for backward compatibility
export const riskAssessmentApi = ermApi.riskAssessments;

// AI Risk Assessment template ingestion + CRUD + AI suggest. Mirrors the
// 13 column template workbook supplied by the user.
export interface AIRiskEntry {
  id: number;
  risk_id_external: string | null;
  ai_system_use_case: string | null;
  risk_description: string | null;
  risk_category: string | null;
  likelihood: number | null;
  impact: number | null;
  risk_score: number | null;
  existing_controls: string | null;
  residual_risk_level: string | null;
  mitigation_plan: string | null;
  risk_owner: string | null;
  risk_owner_user_id: number | null;
  target_review_date: string | null;
  status: string | null;
  bridged_risk_id: number | null;
  ai_suggested_mitigation: string | null;
  ai_suggested_controls: string | null;
  ai_suggested_likelihood: number | null;
  ai_suggested_impact: number | null;
  ai_suggested_residual_level: string | null;
  ai_rationale: string | null;
  ai_generated_at: string | null;
  ai_model: string | null;
  ai_suggestion_accepted: boolean;
  source: string | null;
  source_file_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export const aiRiskAssessmentApi = {
  list: () => apiClient.get<AIRiskEntry[]>('/erm/ai-risk-assessment'),
  get: (id: number) => apiClient.get<AIRiskEntry>(`/erm/ai-risk-assessment/${id}`),
  create: (body: Partial<AIRiskEntry>) =>
    apiClient.post<AIRiskEntry>('/erm/ai-risk-assessment', body),
  update: (id: number, body: Partial<AIRiskEntry>) =>
    apiClient.put<AIRiskEntry>(`/erm/ai-risk-assessment/${id}`, body),
  delete: (id: number) => apiClient.delete(`/erm/ai-risk-assessment/${id}`),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiClient.post<{ imported: Array<{ id: number; row: number; ai_system_use_case: string | null }>; errors: Array<{ row: number; error: string }>; summary: { imported_count: number; error_count: number; file_name: string } }>(
      '/erm/ai-risk-assessment/upload',
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
  },
  templateUrl: () => '/api/erm/ai-risk-assessment/template',
  aiSuggest: (id: number, focus?: string) =>
    apiClient.post<{ source: string; entry: AIRiskEntry }>(`/erm/ai-risk-assessment/${id}/ai-suggest`, focus ? { focus } : {}),
  acceptAi: (id: number) =>
    apiClient.post<AIRiskEntry>(`/erm/ai-risk-assessment/${id}/accept-ai`, {}),
  bridgeToRisk: (id: number) =>
    apiClient.post<{ risk_id: number; created: boolean }>(`/erm/ai-risk-assessment/${id}/bridge-to-risk`, {}),
  // ── Tenant users (for the Risk Owner picker) ────────────────────────────
  getTenantUsers: () =>
    apiClient.get<Array<{ id: number; display_name: string; email: string | null; username: string | null }>>(
      '/erm/ai-risk-assessment/meta/tenant-users'
    ),
  // ── Evidence: list, upload+link, link existing, unlink, download ────────
  listEvidence: (entryId: number) =>
    apiClient.get<Array<AIRiskEvidence>>(`/erm/ai-risk-assessment/${entryId}/evidence`),
  uploadEvidence: (entryId: number, file: File, evidenceType?: string, relationshipType?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    const params = new URLSearchParams();
    if (evidenceType) params.set('evidence_type', evidenceType);
    if (relationshipType) params.set('relationship_type', relationshipType);
    const qs = params.toString();
    return apiClient.post<AIRiskEvidence>(
      `/erm/ai-risk-assessment/${entryId}/evidence/upload${qs ? '?' + qs : ''}`,
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
  },
  linkEvidence: (entryId: number, evidenceId: number, relationshipType?: string) =>
    apiClient.post<AIRiskEvidence>(`/erm/ai-risk-assessment/${entryId}/evidence/link`, {
      evidence_id: evidenceId,
      relationship_type: relationshipType || 'supports',
    }),
  unlinkEvidence: (entryId: number, linkId: number) =>
    apiClient.delete(`/erm/ai-risk-assessment/${entryId}/evidence/${linkId}`),
  evidenceDownloadUrl: (entryId: number, linkId: number) =>
    `/api/erm/ai-risk-assessment/${entryId}/evidence/${linkId}/download`,
};

export interface AIRiskEvidence {
  evidence_id: number;
  link_id: number | null;
  name: string;
  description: string | null;
  file_name: string | null;
  file_type: string | null;
  file_path: string | null;
  evidence_type: string | null;
  uploaded_at: string | null;
  uploaded_by: number | null;
  status: string | null;
  relationship_type: string;
}

export const tenantApi = {
  getTenantUsers: async (tenantId?: number) => {
    if (tenantId) {
      return apiClient.get(`/tenants/${tenantId}/users`);
    }
    try {
      return await apiClient.get('/assets/tenant-users');
    } catch {
      throw new Error('Unable to load tenant users');
    }
  },
};


// ─── Criticality Assessments (ISCA + IACA) ───────────────────────────────
// Mirrors the bank-provided templates: each assessment type has its own
// CRUD family, and the shared `/users` + `/assets` pickers drive the
// dropdowns on the create/edit drawer.

export type CriticalityUserOption = {
  id: number;
  display_name: string;
  email?: string | null;
  designation?: string | null;
};

export type CriticalityAssetOwnerDetail = {
  user_id?: number | null;
  name?: string | null;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type CriticalityAssetOption = {
  id: number;
  name: string;
  asset_type?: string | null;
  criticality?: string | null;
  description?: string | null;
  location?: string | null;
  vendor?: string | null;
  host_name?: string | null;
  ip_address?: string | null;
  address?: string | null;
  associated_ips?: string | null;
  business_owner?: CriticalityAssetOwnerDetail | null;
  primary_owner?: CriticalityAssetOwnerDetail | null;
  secondary_owner?: CriticalityAssetOwnerDetail | null;
};

// Phase 2 additions shared across both kinds.
export type CriticalityApprovalStatus =
  | 'draft'
  | 'submitted'
  | 'business_owner_review'
  | 'ciso_review'
  | 'approved'
  | 'rejected'
  | 'returned';

type CriticalityApprovalFields = {
  approval_status?: CriticalityApprovalStatus | null;
  current_approval_tier?: number | null;
  submitted_at?: string | null;
  submitted_by?: number | null;
  submitted_by_name?: string | null;
  approved_at?: string | null;
  approved_by?: number | null;
  approved_by_name?: string | null;
  rejected_at?: string | null;
  rejected_by?: number | null;
  rejected_by_name?: string | null;
  rejection_reason?: string | null;
  linked_risk_id?: number | null;
  evidence_count?: number;
  comment_count?: number;
};

export type IscaItem = CriticalityApprovalFields & {
  id: number;
  tenant_id: number;
  linked_asset_id?: number | null;
  linked_asset_name?: string | null;
  name: string;
  description?: string | null;
  address?: string | null;
  business_owner_user_id?: number | null;
  business_owner_user_name?: string | null;
  business_owner_name?: string | null;
  business_owner_designation?: string | null;
  business_owner_phone?: string | null;
  business_owner_email?: string | null;
  service_owner_user_id?: number | null;
  service_owner_user_name?: string | null;
  service_owner_name?: string | null;
  service_owner_designation?: string | null;
  service_owner_phone?: string | null;
  service_owner_email?: string | null;
  assessor_user_id?: number | null;
  assessor_user_name?: string | null;
  assessor_name?: string | null;
  assessor_designation?: string | null;
  assessor_phone?: string | null;
  assessor_email?: string | null;
  date_of_assessment?: string | null;
  operational_dependency?: number | null;
  financial_impact?: number | null;
  customer_stakeholder_impact?: number | null;
  data_sensitivity?: number | null;
  unauthorized_access_risk?: number | null;
  rto_rpo_requirements?: number | null;
  internet_facing?: number | null;
  b2b_exposure?: number | null;
  total_score?: number | null;
  criticality_level?: 'mission_critical' | 'high' | 'moderate' | 'low' | null;
  comments?: string | null;
  created_at: string;
  updated_at: string;
};

export type IacaItem = CriticalityApprovalFields & {
  id: number;
  tenant_id: number;
  linked_asset_id?: number | null;
  linked_asset_name?: string | null;
  name: string;
  description?: string | null;
  make_model?: string | null;
  location?: string | null;
  associated_ips?: string | null;
  fault_tolerance?: string | null;
  custodian_user_id?: number | null;
  custodian_user_name?: string | null;
  custodian_name?: string | null;
  custodian_designation?: string | null;
  custodian_phone?: string | null;
  custodian_email?: string | null;
  administrator_user_id?: number | null;
  administrator_user_name?: string | null;
  administrator_name?: string | null;
  administrator_designation?: string | null;
  administrator_phone?: string | null;
  administrator_email?: string | null;
  assessor_user_id?: number | null;
  assessor_user_name?: string | null;
  assessor_name?: string | null;
  assessor_designation?: string | null;
  assessor_phone?: string | null;
  assessor_email?: string | null;
  date_of_assessment?: string | null;
  business_impact?: number | null;
  service_dependency?: number | null;
  data_sensitivity?: number | null;
  redundancy_failover?: number | null;
  rto?: number | null;
  availability_requirement?: number | null;
  operational_disruption?: number | null;
  regulatory_dependency?: number | null;
  exposure?: number | null;
  total_score?: number | null;
  criticality_level?: 'mission_critical' | 'high' | 'moderate' | 'low' | null;
  comments?: string | null;
  created_at: string;
  updated_at: string;
};

export type CriticalityActivityRow = {
  id: number;
  type: string;
  user: { id?: number | null; display_name?: string | null };
  payload: Record<string, unknown>;
  created_at: string;
};

export type CriticalityCommentRow = {
  id: number;
  parent_id?: number | null;
  body: string;
  user: { id?: number | null; display_name?: string | null };
  created_at: string;
  edited_at?: string | null;
};

export type CriticalityEvidenceRow = {
  id: number;
  file_name: string;
  file_size?: number | null;
  mime_type?: string | null;
  description?: string | null;
  uploaded_by?: number | null;
  uploaded_by_name?: string | null;
  uploaded_at: string;
};

export type CriticalityCoverage = {
  total_assets: number;
  assessed_assets: number;
  unassessed_assets: number;
  by_band: Record<string, number>;
  by_kind: Record<string, number>;
  by_approval_status: Record<string, number>;
};

export type CriticalityKind = 'isca' | 'iaca';

export const criticalityApi = {
  // Pickers
  listUsers: () =>
    apiClient.get<CriticalityUserOption[]>('/criticality-assessments/users'),
  listAssets: (params?: { asset_type?: string; search?: string }) =>
    apiClient.get<CriticalityAssetOption[]>('/criticality-assessments/assets', { params }),

  // Information System Criticality Assessment
  infoSystem: {
    list: () => apiClient.get<IscaItem[]>('/criticality-assessments/info-system'),
    get: (id: number) =>
      apiClient.get<IscaItem>(`/criticality-assessments/info-system/${id}`),
    create: (data: Partial<IscaItem>) =>
      apiClient.post<IscaItem>('/criticality-assessments/info-system', data),
    update: (id: number, data: Partial<IscaItem>) =>
      apiClient.put<IscaItem>(`/criticality-assessments/info-system/${id}`, data),
    delete: (id: number) =>
      apiClient.delete(`/criticality-assessments/info-system/${id}`),
  },

  // Infrastructure Asset Criticality Assessment
  infraAsset: {
    list: () => apiClient.get<IacaItem[]>('/criticality-assessments/infra-asset'),
    get: (id: number) =>
      apiClient.get<IacaItem>(`/criticality-assessments/infra-asset/${id}`),
    create: (data: Partial<IacaItem>) =>
      apiClient.post<IacaItem>('/criticality-assessments/infra-asset', data),
    update: (id: number, data: Partial<IacaItem>) =>
      apiClient.put<IacaItem>(`/criticality-assessments/infra-asset/${id}`, data),
    delete: (id: number) =>
      apiClient.delete(`/criticality-assessments/infra-asset/${id}`),
  },

  // ── Phase 2: kind-discriminated families ──────────────────────────
  activity: {
    list: (kind: CriticalityKind, itemId: number, limit = 200) =>
      apiClient.get<CriticalityActivityRow[]>(
        `/criticality-assessments/${kind}/${itemId}/activity`,
        { params: { limit } },
      ),
  },
  comments: {
    list: (kind: CriticalityKind, itemId: number) =>
      apiClient.get<CriticalityCommentRow[]>(
        `/criticality-assessments/${kind}/${itemId}/comments`,
      ),
    add: (kind: CriticalityKind, itemId: number, body: string, parentId?: number | null) =>
      apiClient.post<CriticalityCommentRow>(
        `/criticality-assessments/${kind}/${itemId}/comments`,
        { body, parent_id: parentId ?? null },
      ),
  },
  evidence: {
    list: (kind: CriticalityKind, itemId: number) =>
      apiClient.get<CriticalityEvidenceRow[]>(
        `/criticality-assessments/${kind}/${itemId}/evidence`,
      ),
    upload: (kind: CriticalityKind, itemId: number, file: File, description?: string) => {
      const fd = new FormData();
      fd.append('file', file);
      if (description) fd.append('description', description);
      return apiClient.post<CriticalityEvidenceRow>(
        `/criticality-assessments/${kind}/${itemId}/evidence`,
        fd,
        { headers: { 'Content-Type': undefined }, timeout: 2 * 60 * 1000 },
      );
    },
    delete: (kind: CriticalityKind, itemId: number, evidenceId: number) =>
      apiClient.delete(
        `/criticality-assessments/${kind}/${itemId}/evidence/${evidenceId}`,
      ),
    downloadUrl: (kind: CriticalityKind, itemId: number, evidenceId: number) =>
      `/criticality-assessments/${kind}/${itemId}/evidence/${evidenceId}/download`,
  },
  approval: {
    submit: (kind: CriticalityKind, itemId: number) =>
      apiClient.post<IscaItem | IacaItem>(
        `/criticality-assessments/${kind}/${itemId}/submit`,
      ),
    approveBusinessOwner: (kind: CriticalityKind, itemId: number, notes?: string) =>
      apiClient.post<IscaItem | IacaItem>(
        `/criticality-assessments/${kind}/${itemId}/approve`,
        { notes: notes ?? null },
      ),
    approveCiso: (kind: CriticalityKind, itemId: number, notes?: string) =>
      apiClient.post<IscaItem | IacaItem>(
        `/criticality-assessments/${kind}/${itemId}/ciso-approve`,
        { notes: notes ?? null },
      ),
    reject: (kind: CriticalityKind, itemId: number, reason: string) =>
      apiClient.post<IscaItem | IacaItem>(
        `/criticality-assessments/${kind}/${itemId}/reject`,
        { reason },
      ),
    return: (kind: CriticalityKind, itemId: number, reason: string) =>
      apiClient.post<IscaItem | IacaItem>(
        `/criticality-assessments/${kind}/${itemId}/return`,
        { reason },
      ),
  },
  promote: {
    toRisk: (kind: CriticalityKind, itemId: number) =>
      apiClient.post<{ risk_id: number; created: boolean }>(
        `/criticality-assessments/${kind}/${itemId}/promote-to-risk`,
      ),
  },
  followUpTask: (
    kind: CriticalityKind,
    itemId: number,
    data?: { title?: string; description?: string; due_in_days?: number; assignee_user_id?: number | null },
  ) =>
    apiClient.post<{ task_id: number; title: string }>(
      `/criticality-assessments/${kind}/${itemId}/follow-up-task`,
      data || {},
    ),
  byAsset: (assetId: number) =>
    apiClient.get<{ isca: IscaItem[]; iaca: IacaItem[] }>(
      `/criticality-assessments/by-asset/${assetId}`,
    ),
  coverage: () =>
    apiClient.get<CriticalityCoverage>('/criticality-assessments/coverage'),
  exportXlsxUrl: (kind: CriticalityKind, itemId: number) =>
    `/criticality-assessments/${kind}/${itemId}/export.xlsx`,
  bulkImport: (kind: CriticalityKind, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiClient.post<{ imported: Array<{ row: number; item_id: number; name: string }>; errors: Array<{ row: number; message: string }> }>(
      `/criticality-assessments/${kind}/bulk-import`,
      fd,
      { headers: { 'Content-Type': undefined }, timeout: 2 * 60 * 1000 },
    );
  },
};

export const vendorRiskApi = {
  getModuleInfo: () => apiClient.get('/vendor-risk'),

  getDashboard: async () => {
    try {
      return await apiClient.get('/vendor-risk/vendors/dashboard');
    } catch {
      try {
        return await apiClient.get('/vendor-risk/dashboard');
      } catch {
        return await apiClient.get('/vendor-risk');
      }
    }
  },
  getVendors: (params?: {
    tier?: string;
    status?: string;
    search?: string;
    vendor_type?: string;
    data_access_level?: string;
    skip?: number;
    limit?: number;
  }) => apiClient.get('/vendor-risk/vendors', { params }),
  createVendor: (data: Record<string, unknown>) => apiClient.post('/vendor-risk/vendors', data),
  getVendor: (vendorId: number) => apiClient.get(`/vendor-risk/vendors/${vendorId}`),
  updateVendor: (vendorId: number, data: Record<string, unknown>) => apiClient.put(`/vendor-risk/vendors/${vendorId}`, data),
  deleteVendor: (vendorId: number) => apiClient.delete(`/vendor-risk/vendors/${vendorId}`),

  // Assessments
  getAssessments: (params?: {
    vendor_id?: number;
    status?: string;
    type?: string;
    skip?: number;
    limit?: number;
  }) => apiClient.get('/vendor-risk/assessments', { params }),
  createAssessment: (data: Record<string, unknown>) => apiClient.post('/vendor-risk/assessments', data),
  getAssessment: (assessmentId: number) => apiClient.get(`/vendor-risk/assessments/${assessmentId}`),
  updateAssessment: (assessmentId: number, data: Record<string, unknown>) => apiClient.put(`/vendor-risk/assessments/${assessmentId}`, data),
  deleteAssessment: (assessmentId: number) => apiClient.delete(`/vendor-risk/assessments/${assessmentId}`),
  scoreAssessment: (assessmentId: number, responseId?: number) =>
    apiClient.post(`/vendor-risk/assessments/${assessmentId}/score`, responseId ? { response_id: responseId } : {}),
  approveAssessment: (assessmentId: number, data?: Record<string, unknown>) =>
    apiClient.post(`/vendor-risk/assessments/${assessmentId}/approve`, data || {}),

  // Monitoring
  getVendorSLA: (vendorId: number, params?: { measurement_period?: string; is_compliant?: boolean; skip?: number; limit?: number }) =>
    apiClient.get(`/vendor-risk/vendors/${vendorId}/sla`, { params }),
  createVendorSLA: (vendorId: number, data: Record<string, unknown>) => apiClient.post(`/vendor-risk/vendors/${vendorId}/sla`, data),
  getVendorIncidents: (vendorId: number, params?: { severity?: string; status?: string; skip?: number; limit?: number }) =>
    apiClient.get(`/vendor-risk/vendors/${vendorId}/incidents`, { params }),
  createVendorIncident: (vendorId: number, data: Record<string, unknown>) =>
    apiClient.post(`/vendor-risk/vendors/${vendorId}/incidents`, data),
  updateVendorIncident: (vendorId: number, incidentId: number, data: Record<string, unknown>) =>
    apiClient.put(`/vendor-risk/vendors/${vendorId}/incidents/${incidentId}`, data),

  // Questionnaires
  getTemplates: (params?: { category?: string; search?: string; skip?: number; limit?: number }) =>
    apiClient.get('/vendor-risk/questionnaire-templates', { params }),
  createTemplate: (data: Record<string, unknown>) => apiClient.post('/vendor-risk/questionnaire-templates', data),
  updateTemplate: (templateId: number, data: Record<string, unknown>) =>
    apiClient.put(`/vendor-risk/questionnaire-templates/${templateId}`, data),
  deleteTemplate: (templateId: number) => apiClient.delete(`/vendor-risk/questionnaire-templates/${templateId}`),
  sendQuestionnaire: (data: {
    vendor_id: number;
    assessment_id?: number;
    template_id?: number | null;
    respondent_name?: string;
    respondent_email?: string;
    expires_in_days?: number;
  }) => apiClient.post('/vendor-risk/questionnaires/send', data),
  getQuestionnaireResponses: (params?: { vendor_id?: number; assessment_id?: number }) =>
    apiClient.get('/vendor-risk/questionnaire-responses', { params }),
  updateQuestionnaireResponse: (responseId: number, data: { assessment_id?: number }) =>
    apiClient.patch(`/vendor-risk/questionnaire-responses/${responseId}`, data),

  // ── TPRA 8-stage lifecycle ──
  getLifecycleStages: () => apiClient.get('/vendor-risk/lifecycle/stages'),
  advanceStage: (vendorId: number, data?: { target_stage?: string; note?: string }) =>
    apiClient.post(`/vendor-risk/vendors/${vendorId}/advance-stage`, data || {}),
  // Remediation tracker (stage 5)
  getRemediation: (vendorId: number) => apiClient.get(`/vendor-risk/vendors/${vendorId}/remediation`),
  addRemediation: (vendorId: number, data: Record<string, unknown>) =>
    apiClient.post(`/vendor-risk/vendors/${vendorId}/remediation`, data),
  updateRemediation: (vendorId: number, actionId: string, data: Record<string, unknown>) =>
    apiClient.patch(`/vendor-risk/vendors/${vendorId}/remediation/${actionId}`, data),
  deleteRemediation: (vendorId: number, actionId: string) =>
    apiClient.delete(`/vendor-risk/vendors/${vendorId}/remediation/${actionId}`),
  // Reassessment scheduling (stage 7)
  scheduleReassessment: (vendorId: number, data?: { cadence_days?: number; next_date?: string }) =>
    apiClient.post(`/vendor-risk/vendors/${vendorId}/schedule-reassessment`, data || {}),
  // Offboarding checklist (stage 8)
  getOffboarding: (vendorId: number) => apiClient.get(`/vendor-risk/vendors/${vendorId}/offboarding`),
  updateOffboarding: (vendorId: number, items: Array<{ item: string; done: boolean }>) =>
    apiClient.patch(`/vendor-risk/vendors/${vendorId}/offboarding`, { items }),
  // TPRA AI (graceful — never 503)
  aiRecommendTier: (vendorId: number) => apiClient.post('/vendor-risk/ai/recommend-tier', { vendor_id: vendorId }),
  aiGapAnalysis: (assessmentId: number) => apiClient.post('/vendor-risk/ai/gap-analysis', { assessment_id: assessmentId }),
  aiRemediationPlan: (vendorId: number, assessmentId?: number) =>
    apiClient.post('/vendor-risk/ai/remediation-plan', { vendor_id: vendorId, assessment_id: assessmentId }),
};

// ── TPRA productionized 11-stage lifecycle (normalized) ──────────────────────
// Talks to /vendor-risk/tpra/*. Separate from the legacy vendorRiskApi flat
// methods above so the new lifecycle UI has a clean, grouped client surface.
export const tpraApi = {
  // Program dashboard + analytics
  dashboard: (scope: 'portfolio' | 'mine' = 'portfolio') =>
    apiClient.get('/vendor-risk/tpra/dashboard', { params: { scope } }),
  riskTrend: (params?: { scope?: 'portfolio' | 'vendor'; vendor_id?: number; months?: number }) =>
    apiClient.get('/vendor-risk/tpra/risk-trend', { params: params || {} }),
  findingsRegister: (params?: {
    status?: string; severity?: string; domain?: string; vendor_id?: number;
    overdue_only?: boolean; sort?: string; order?: 'asc' | 'desc'; skip?: number; limit?: number;
  }) => apiClient.get('/vendor-risk/tpra/findings-register', { params: params || {} }),
  monitoringFeed: (params?: {
    severity?: string; signal_type?: string; acknowledged?: boolean; vendor_id?: number;
    skip?: number; limit?: number;
  }) => apiClient.get('/vendor-risk/tpra/monitoring-feed', { params: params || {} }),
  riskRegister: () => apiClient.get('/vendor-risk/tpra/risk-register'),
  // Lifecycle
  getStages: () => apiClient.get('/vendor-risk/tpra/stages'),
  getBoard: () => apiClient.get('/vendor-risk/tpra/board'),
  getLifecycle: (vendorId: number) => apiClient.get(`/vendor-risk/tpra/vendors/${vendorId}/lifecycle`),
  initLifecycle: (vendorId: number) => apiClient.post(`/vendor-risk/tpra/vendors/${vendorId}/lifecycle/init`, {}),
  listAssessmentVersions: (vendorId: number) => apiClient.get(`/vendor-risk/tpra/vendors/${vendorId}/assessments`),
  advance: (assessmentId: number, data?: { note?: string }) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/advance`, data || {}),
  sendBack: (assessmentId: number, data: { target_stage: string; reason: string }) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/send-back`, data),
  skip: (assessmentId: number, data: { stage_key: string; reason: string }) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/skip`, data),
  gateDecision: (assessmentId: number, data: { stage_key: string; decision: string; rationale?: string }) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/gate-decision`, data),
  runTiering: (assessmentId: number, data?: { factors?: Record<string, number> }) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/run-tiering`, data || {}),
  runScoring: (assessmentId: number) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/run-scoring`, {}),
  reassess: (vendorId: number, data: { reason: string; assessment_type?: string }) =>
    apiClient.post(`/vendor-risk/tpra/vendors/${vendorId}/reassess`, data),

  // Findings + remediation + acceptance
  listFindings: (assessmentId: number, params?: {
    status?: string; domain?: string; severity?: string;
    sort?: string; order?: string; skip?: number; limit?: number; include_deleted?: boolean;
  }) => apiClient.get(`/vendor-risk/tpra/assessments/${assessmentId}/findings`, { params }),
  createFinding: (assessmentId: number, data: Record<string, unknown>) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/findings`, data),
  getFinding: (findingId: number) => apiClient.get(`/vendor-risk/tpra/findings/${findingId}`),
  updateFinding: (findingId: number, data: Record<string, unknown>) =>
    apiClient.put(`/vendor-risk/tpra/findings/${findingId}`, data),
  deleteFinding: (findingId: number) => apiClient.delete(`/vendor-risk/tpra/findings/${findingId}`),
  restoreFinding: (findingId: number) => apiClient.post(`/vendor-risk/tpra/findings/${findingId}/restore`, {}),
  listRemediations: (findingId: number) => apiClient.get(`/vendor-risk/tpra/findings/${findingId}/remediations`),
  createRemediation: (findingId: number, data: Record<string, unknown>) =>
    apiClient.post(`/vendor-risk/tpra/findings/${findingId}/remediations`, data),
  updateRemediation: (remId: number, data: Record<string, unknown>) =>
    apiClient.put(`/vendor-risk/tpra/remediations/${remId}`, data),
  deleteRemediation: (remId: number) => apiClient.delete(`/vendor-risk/tpra/remediations/${remId}`),
  createAcceptance: (findingId: number, data: { rationale: string; expiry?: string }) =>
    apiClient.post(`/vendor-risk/tpra/findings/${findingId}/acceptances`, data),
  revokeAcceptance: (accId: number) => apiClient.delete(`/vendor-risk/tpra/acceptances/${accId}`),
  // Move a finding into the ERM Risk Register as a vendor-sourced risk.
  promoteFindingToRegister: (findingId: number) =>
    apiClient.post(`/vendor-risk/tpra/findings/${findingId}/promote-to-register`, {}),

  // Evidence — upload OR link existing (assessment-level pack + per-finding)
  listEvidence: (assessmentId: number, params?: { finding_id?: number }) =>
    apiClient.get(`/vendor-risk/tpra/assessments/${assessmentId}/evidence`, { params: params || {} }),
  uploadEvidence: (assessmentId: number, data: FormData) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/evidence/upload`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  linkEvidence: (assessmentId: number, data: { evidence_id: number; finding_id?: number; response_id?: number; note?: string }) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/evidence/link`, data),
  unlinkEvidence: (linkId: number) => apiClient.delete(`/vendor-risk/tpra/evidence-links/${linkId}`),

  // Contracts + obligations
  listContracts: (vendorId: number) => apiClient.get(`/vendor-risk/tpra/vendors/${vendorId}/contracts`),
  createContract: (vendorId: number, data: Record<string, unknown>) =>
    apiClient.post(`/vendor-risk/tpra/vendors/${vendorId}/contracts`, data),
  updateContract: (contractId: number, data: Record<string, unknown>) =>
    apiClient.put(`/vendor-risk/tpra/contracts/${contractId}`, data),
  deleteContract: (contractId: number) => apiClient.delete(`/vendor-risk/tpra/contracts/${contractId}`),
  listObligations: (contractId: number) => apiClient.get(`/vendor-risk/tpra/contracts/${contractId}/obligations`),
  createObligation: (contractId: number, data: Record<string, unknown>) =>
    apiClient.post(`/vendor-risk/tpra/contracts/${contractId}/obligations`, data),
  updateObligation: (oblId: number, data: Record<string, unknown>) =>
    apiClient.put(`/vendor-risk/tpra/obligations/${oblId}`, data),
  deleteObligation: (oblId: number) => apiClient.delete(`/vendor-risk/tpra/obligations/${oblId}`),

  // Approvals (append-only)
  listApprovals: (assessmentId: number) => apiClient.get(`/vendor-risk/tpra/assessments/${assessmentId}/approvals`),
  createApproval: (assessmentId: number, data: { decision: string; conditions?: string[]; rationale?: string }) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/approvals`, data),

  // Per-stage task checklist + DD-planning
  saveChecklist: (
    assessmentId: number, stageKey: string,
    items: Array<{ text: string; done: boolean; note?: string | null; owner_id?: number | null; due_date?: string | null }>,
  ) => apiClient.put(`/vendor-risk/tpra/assessments/${assessmentId}/stages/${stageKey}/checklist`, { items }),
  savePlan: (assessmentId: number, data: { template_id?: number; reviewed_by?: number; due_date?: string }) =>
    apiClient.post(`/vendor-risk/tpra/assessments/${assessmentId}/plan`, data),
  saveRoles: (assessmentId: number, stageKey: string, assigned_roles: Array<{ role: string; user_id: number }>) =>
    apiClient.put(`/vendor-risk/tpra/assessments/${assessmentId}/stages/${stageKey}/roles`, { assigned_roles }),
  saveTeam: (assessmentId: number, roster: Record<string, number>) =>
    apiClient.put(`/vendor-risk/tpra/assessments/${assessmentId}/team`, { roster }),
  // Admin / Settings — program config (tiering weights, thresholds, cadence)
  getConfig: () => apiClient.get('/vendor-risk/tpra/config'),
  saveConfig: (data: { weights?: Record<string, number>; thresholds?: Record<string, number>; cadence_days?: Record<string, number> }) =>
    apiClient.put('/vendor-risk/tpra/config', data),
  getVendorAudit: (vendorId: number, limit = 100) =>
    apiClient.get(`/vendor-risk/tpra/vendors/${vendorId}/audit`, { params: { limit } }),
  getCoverage: () => apiClient.get('/vendor-risk/tpra/coverage'),

  // Monitoring signals
  listSignals: (vendorId: number) => apiClient.get(`/vendor-risk/tpra/vendors/${vendorId}/signals`),
  createSignal: (vendorId: number, data: Record<string, unknown>) =>
    apiClient.post(`/vendor-risk/tpra/vendors/${vendorId}/signals`, data),
  updateSignal: (signalId: number, data: Record<string, unknown>) =>
    apiClient.put(`/vendor-risk/tpra/signals/${signalId}`, data),
  deleteSignal: (signalId: number) => apiClient.delete(`/vendor-risk/tpra/signals/${signalId}`),
};

// ── Tenant artifacts (documents) — the same store the compliance ArtifactsTab uses.
// Reused by the TPRA lifecycle by namespacing framework_key = `tpra-vendor-{id}`.
export const artifactsApi = {
  list: (params: { framework_key?: string; assessment_id?: number; assessment_type?: string; status?: string }) =>
    apiClient.get('/artifacts', { params }),
  get: (id: number) => apiClient.get(`/artifacts/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/artifacts', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put(`/artifacts/${id}`, data),
  remove: (id: number) => apiClient.delete(`/artifacts/${id}`),
  export: (id: number, fmt: string) => apiClient.get(`/artifacts/${id}/export`, { params: { fmt }, responseType: 'blob' }),
  catalogContent: (artifactId: string, frameworkKey: string) =>
    apiClient.get('/artifacts/catalog/content', { params: { artifact_id: artifactId, framework_key: frameworkKey } }),
};

// Generic AI-recommendation store — save a reviewed AI output so it persists
// per tenant and every user with module access sees the same saved result.
export const aiRecommendationsApi = {
  list: (params: { module: string; entity_type?: string; entity_id?: string | number; recommendation_type?: string }) =>
    apiClient.get('/ai-recommendations', { params }),
  save: (data: {
    module: string;
    recommendation_type: string;
    entity_type?: string;
    entity_id?: string | number;
    title?: string;
    summary?: string;
    output: Record<string, unknown>;
    model?: string;
  }) => apiClient.post('/ai-recommendations', data),
  remove: (id: number) => apiClient.delete(`/ai-recommendations/${id}`),
};

export const frameworkUploadApi = {
  uploadFramework: (formData: FormData) => 
    apiClient.post('/framework-upload/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getFrameworks: (params?: { status?: string; search?: string; skip?: number; limit?: number }) => 
    apiClient.get('/framework-upload/upload', { params }),
  getFramework: (id: number) => 
    apiClient.get(`/framework-upload/upload/${id}`),
  deleteFramework: (id: number) => 
    apiClient.delete(`/framework-upload/upload/${id}`),
  extractText: (id: number) => 
    apiClient.post(`/framework-upload/upload/${id}/extract-text`),
  parseFramework: (id: number) => 
    apiClient.post(`/framework-upload/parser/${id}/parse`),
  getParsedControls: (frameworkId: number, params?: { status?: string; category?: string; search?: string; skip?: number; limit?: number }) => 
    apiClient.get(`/framework-upload/parser/${frameworkId}/controls`, { params }),
  updateControl: (id: number, data: Record<string, unknown>) => 
    apiClient.put(`/framework-upload/parser/controls/${id}`, data),
  verifyControl: (id: number) => 
    apiClient.post(`/framework-upload/parser/controls/${id}/verify`),
  analyzeAlignment: (frameworkId: number) => 
    apiClient.post(`/framework-upload/alignment/${frameworkId}/analyze`),
  getAlignments: (frameworkId: number, params?: { alignment_type?: string; is_verified?: boolean; skip?: number; limit?: number }) => 
    apiClient.get(`/framework-upload/alignment/${frameworkId}`, { params }),
  getAlignmentSummary: (frameworkId: number) => 
    apiClient.get(`/framework-upload/alignment/summary/${frameworkId}`),
  confirmAlignment: (alignmentId: number) => 
    apiClient.post(`/framework-upload/alignment/${alignmentId}/confirm`),
  updateAlignment: (alignmentId: number, data: { alignment_type?: string; normalized_control_id?: number; framework_control_id?: number; match_reason?: string }) => 
    apiClient.put(`/framework-upload/alignment/${alignmentId}`, data),
  createNewControls: (frameworkId: number) => 
    apiClient.post(`/framework-upload/alignment/${frameworkId}/create-new-controls`),
  listFrameworks: (params?: { status?: string; search?: string; skip?: number; limit?: number }) => 
    apiClient.get('/framework-upload/upload', { params }),
  createAssessment: (data: { uploaded_framework_id: number; name: string; description?: string; target_completion_date?: string }) => 
    apiClient.post('/framework-upload/assessment', data),
  getAssessments: (params?: { uploaded_framework_id?: number; status?: string; skip?: number; limit?: number }) => 
    apiClient.get('/framework-upload/assessment', { params }),
  getAssessment: (id: number) => 
    apiClient.get(`/framework-upload/assessment/${id}`),
  getAssessmentItems: (assessmentId: number, params?: { status?: string; skip?: number; limit?: number }) => 
    apiClient.get(`/framework-upload/assessment/${assessmentId}/items`, { params }),
  updateAssessmentItem: (id: number, data: Record<string, unknown>) => 
    apiClient.put(`/framework-upload/assessment/items/${id}`, data),
  getAssessmentDashboard: (id: number) => 
    apiClient.get(`/framework-upload/assessment/${id}/dashboard`),
  uploadEvidence: (itemId: number, formData: FormData) => 
    apiClient.post(`/framework-upload/evidence/item/${itemId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getItemEvidence: (itemId: number) => 
    apiClient.get(`/framework-upload/evidence/item/${itemId}`),
  getEvidenceTypes: () => 
    apiClient.get('/framework-upload/evidence/types'),
  updateAssessment: (id: number, data: Record<string, unknown>) => 
    apiClient.put(`/framework-upload/assessment/${id}`, data),
  createRemediation: (itemId: number, data: { title: string; description?: string; priority?: string; due_date?: string; owner_id?: number; estimated_effort?: string }) => 
    apiClient.post(`/framework-upload/assessment/items/${itemId}/remediation`, data),
  getRemediations: (itemId: number) => 
    apiClient.get(`/framework-upload/assessment/items/${itemId}/remediation`),
  getPublishStatus: (frameworkId: number) => 
    apiClient.get(`/framework-upload/publish/${frameworkId}/status`),
  publishFramework: (frameworkId: number, data: { short_code: string; regulator?: string; jurisdiction?: string; region?: string; is_mandatory?: boolean; enforcement_type?: string }) => 
    apiClient.post(`/framework-upload/publish/${frameworkId}`, data),
  unpublishFramework: (frameworkId: number) => 
    apiClient.delete(`/framework-upload/publish/${frameworkId}/unpublish`),
};

export const complianceApi = {
  dashboard: {
    getSummary: (params?: { tenant_id?: number; document_id?: number }) =>
      apiClient.get('/compliance/policies/dashboard/summary', { params }),
    getTrends: (params?: { tenant_id?: number; months?: number }) =>
      apiClient.get('/compliance/policies/dashboard/trends', { params }),
    getOverdue: (params?: { tenant_id?: number; limit?: number }) =>
      apiClient.get('/compliance/policies/dashboard/overdue', { params }),
    getByDocument: (params?: { tenant_id?: number; limit?: number }) =>
      apiClient.get('/compliance/policies/dashboard/by-document', { params }),
    // One-shot aggregate for the comprehensive /frameworks dashboard.
    // Returns KPIs + status mix + per-framework rollup + domain breakdown +
    // recent activity in one round trip, so the page doesn't N+1 across all
    // active journeys.
    getFrameworksAggregate: (params?: { tenant_id?: number }) =>
      apiClient.get('/compliance/policies/dashboard/frameworks-aggregate', { params }),
    getComplianceTrend: (days: number) =>
      apiClient.get('/compliance/policies/dashboard/compliance-trend', { params: { days } }),
  },
  statements: {
    getAll: (params?: {
      tenant_id?: number;
      document_id?: number;
      category?: string;
      compliance_status?: string;
      priority?: string;
      statement_status?: string;
      skip?: number;
      limit?: number;
    }) => apiClient.get('/compliance/policies/statements', { params }),
    getById: (id: number) =>
      apiClient.get(`/compliance/policies/statements/${id}`),
    // 360° auto-mapped linkage: controls (normalized/framework/parsed/internal) + evidence.
    getLinkage: (id: number) =>
      apiClient.get(`/compliance/policies/statements/${id}/linkage`),
    getByDocument: (documentId: number, params?: { category?: string; compliance_status?: string }) =>
      apiClient.get(`/compliance/policies/statements/by-document/${documentId}`, { params }),
    update: (id: number, data: {
      category?: string;
      sub_category?: string;
      priority?: string;
      status?: string;
      is_mandatory?: boolean;
      review_date?: string;
    }) => apiClient.put(`/compliance/policies/statements/${id}`, data),
    updateCompliance: (id: number, data: {
      compliance_status: string;
      compliance_score?: number;
      findings?: string;
      remediation_notes?: string;
      remediation_due_date?: string;
      next_assessment_date?: string;
      owner_id?: number;
      department?: string;
    }) => apiClient.put(`/compliance/policies/statements/${id}/compliance`, data),
    linkEvidence: (id: number, evidenceIds: number[]) =>
      apiClient.post(`/compliance/policies/statements/${id}/evidence`, { evidence_ids: evidenceIds }),
    assign: (id: number, userId: number | null) =>
      apiClient.patch(`/compliance/policies/statements/${id}/assign`, { assigned_to_user_id: userId }),
    getTenantUsers: () =>
      apiClient.get<Array<{ id: number; username: string; display_name: string; email: string }>>(
        '/compliance/policies/statements/meta/tenant-users'
      ),
    convertToControls: (documentId: number, data: { statement_ids: number[]; category?: string; priority?: string }) =>
      apiClient.post(`/governance/documents/${documentId}/statements/convert-to-controls`, data),
  },
};

export const advancedErmApi = {
  // KRI endpoints
  getKRIs: (params?: { risk_id?: number; status_filter?: string; is_active?: boolean }) => 
    apiClient.get<RiskKRI[]>('/advanced-erm/kris', { params }),
  getKRI: (id: number) => apiClient.get<RiskKRI>(`/advanced-erm/kris/${id}`),
  createKRI: (data: RiskKRICreate) => apiClient.post<RiskKRI>('/advanced-erm/kris', data),
  updateKRI: (id: number, data: RiskKRIUpdate) => apiClient.put<RiskKRI>(`/advanced-erm/kris/${id}`, data),
  deleteKRI: (id: number) => apiClient.delete(`/advanced-erm/kris/${id}`),
  measureKRI: (id: number, data: { value: number; notes?: string }) => 
    apiClient.post<RiskKRIMeasurement>(`/advanced-erm/kris/${id}/measure`, data),
  getKRITrend: (id: number, days?: number) => 
    apiClient.get<RiskKRIMeasurement[]>(`/advanced-erm/kris/${id}/trend`, { params: { days } }),
  getKRIAlerts: () => apiClient.get<RiskKRI[]>('/advanced-erm/kris/alerts'),

  // Incident endpoints
  getIncidents: (params?: { risk_id?: number; severity?: string; status_filter?: string; start_date?: string; end_date?: string }) => 
    apiClient.get<RiskIncident[]>('/advanced-erm/incidents', { params }),
  getIncident: (id: number) => apiClient.get<RiskIncident>(`/advanced-erm/incidents/${id}`),
  createIncident: (data: RiskIncidentCreate) => apiClient.post<RiskIncident>('/advanced-erm/incidents', data),
  updateIncident: (id: number, data: RiskIncidentUpdate) => apiClient.put<RiskIncident>(`/advanced-erm/incidents/${id}`, data),
  deleteIncident: (id: number) => apiClient.delete(`/advanced-erm/incidents/${id}`),
  getIncidentDashboard: () => apiClient.get<IncidentDashboard>('/advanced-erm/incidents/dashboard'),

  // Review endpoints
  getReviews: (params?: { risk_id?: number; status_filter?: string; reviewer_id?: number }) => 
    apiClient.get<RiskReview[]>('/advanced-erm/reviews', { params }),
  getReview: (id: number) => apiClient.get<RiskReview>(`/advanced-erm/reviews/${id}`),
  createReview: (data: RiskReviewCreate) => apiClient.post<RiskReview>('/advanced-erm/reviews', data),
  updateReview: (id: number, data: RiskReviewUpdate) => apiClient.put<RiskReview>(`/advanced-erm/reviews/${id}`, data),
  completeReview: (id: number, data: { findings?: string; recommendations?: string; new_inherent_score?: number; new_residual_score?: number }) => 
    apiClient.post<RiskReview>(`/advanced-erm/reviews/${id}/complete`, data),
  getPendingReviews: () => apiClient.get<RiskReview[]>('/advanced-erm/reviews/pending'),
  getOverdueReviews: () => apiClient.get<RiskReview[]>('/advanced-erm/reviews/overdue'),

  // Dependency endpoints
  getDependencies: (params?: { risk_id?: number }) => 
    apiClient.get<RiskDependency[]>('/advanced-erm/dependencies', { params }),
  createDependency: (data: RiskDependencyCreate) => apiClient.post<RiskDependency>('/advanced-erm/dependencies', data),
  deleteDependency: (id: number) => apiClient.delete(`/advanced-erm/dependencies/${id}`),
  getCascadeAnalysis: (riskId: number) => apiClient.get<CascadeAnalysis>(`/advanced-erm/dependencies/${riskId}/cascade`),
  getDependencyGraph: (riskId?: number) => 
    apiClient.get(`/advanced-erm/dependencies/graph`, { params: { risk_id: riskId } }),

  // Report endpoints
  getReports: (params?: { report_type?: string; status?: string }) => 
    apiClient.get<RiskReport[]>('/advanced-erm/reports', { params }),
  getReport: (id: number) => apiClient.get<RiskReport>(`/advanced-erm/reports/${id}`),
  generateReport: (data: RiskReportCreate) => apiClient.post<RiskReport>('/advanced-erm/reports', data),
  deleteReport: (id: number) => apiClient.delete(`/advanced-erm/reports/${id}`),
  getExecutiveDashboard: () => apiClient.get<ExecutiveDashboard>('/advanced-erm/reports/executive-dashboard'),
  getBoardSummary: (params?: { period?: string }) => 
    apiClient.get<BoardReportData>('/advanced-erm/reports/board-summary', { params }),
  getDepartmentSummary: (departmentId: number) => 
    apiClient.get<DepartmentRiskSummary>(`/advanced-erm/reports/department/${departmentId}`),

  // Analytics endpoints
  getAggregatedView: (groupBy?: string) => 
    apiClient.get<AggregatedRiskView[]>('/advanced-erm/analytics/aggregated', { params: { group_by: groupBy } }),
  getAppetiteBreaches: () => apiClient.get<AppetiteBreach[]>('/advanced-erm/analytics/appetite-breaches'),
  getRiskTrends: (days?: number) => 
    apiClient.get<RiskTrendData[]>('/advanced-erm/analytics/trends', { params: { days } }),
  getScoreHistory: (riskId: number, days?: number) => 
    apiClient.get(`/advanced-erm/risks/${riskId}/score-history`, { params: { days } }),
};

export const vulnManagementApi = {
  reports: {
    getAll: () => apiClient.get('/vuln-management/reports'),
    create: (formData: FormData) => 
      apiClient.post('/vuln-management/reports', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    getById: (id: number) => apiClient.get(`/vuln-management/reports/${id}`),
    delete: (id: number) => apiClient.delete(`/vuln-management/reports/${id}`),
  },
  vulnerabilities: {
    getAll: (params?: {
      status?: string;
      severity?: string;
      report_id?: number;
      search?: string;
      // Closed/mitigated vulns are hidden by default. Pass `true` to mix
      // them back in, or `closed_only=true` to show only closed/mitigated.
      include_closed?: boolean;
      closed_only?: boolean;
      // Filter by template source. "NCA Template" → only NCA-bridged vulns,
      // "_general" → only non-template vulns, omit/undefined → all.
      template_type?: string;
    }) =>
      apiClient.get('/vuln-management/vulnerabilities', {
        params: params ? {
          status_filter: params.status,
          severity: params.severity,
          report_id: params.report_id,
          search: params.search,
          include_closed: params.include_closed,
          closed_only: params.closed_only,
          template_type: params.template_type,
        } : undefined
      }),
    getById: (id: number) => apiClient.get(`/vuln-management/vulnerabilities/${id}`),
    create: (data: Record<string, unknown>) => 
      apiClient.post('/vuln-management/vulnerabilities', data),
    bulkUpload: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.post<{ message: string; created: number; skipped: number; errors: string[] }>(
        '/vuln-management/vulnerabilities/bulk-upload', formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
    },
    update: (id: number, data: Record<string, unknown>) => 
      apiClient.put(`/vuln-management/vulnerabilities/${id}`, data),
    delete: (id: number) => apiClient.delete(`/vuln-management/vulnerabilities/${id}`),
    assign: (id: number, userId: number) => 
      apiClient.post(`/vuln-management/vulnerabilities/${id}/assign`, { user_id: userId }),
    changeStatus: (id: number, status: string, notes?: string) =>
      apiClient.post(`/vuln-management/vulnerabilities/${id}/status`, { status, notes }),
    // CVE auto-fill from a free-text title. Returns matched CVE metadata
    // (cvss, severity, cwe, description) when the title either contains a
    // CVE-ID outright or matches a curated nickname (Log4Shell, etc.). The
    // frontend uses this to offer one-click pre-fill on the Add modal.
    lookupByTitle: (body: { title: string; cve_id?: string }) =>
      apiClient.post(`/vuln-management/vulnerabilities/lookup-by-title`, body),
    // Vulnerability dependency chains — declare that vuln A is only
    // exploitable when vuln B is also present. Bi-directional listing
    // (prerequisites + dependents) in one call so the UI graph renders
    // without a second fetch.
    listDependencies: (id: number) =>
      apiClient.get(`/vuln-management/vulnerabilities/${id}/dependencies`),
    addDependency: (id: number, body: {
      prerequisite_vuln_id: number;
      notes?: string;
      chain_stage?: string;
    }) => apiClient.post(`/vuln-management/vulnerabilities/${id}/dependencies`, body),
    removeDependency: (id: number, dependencyId: number) =>
      apiClient.delete(`/vuln-management/vulnerabilities/${id}/dependencies/${dependencyId}`),
    // Threat-intelligence enrichment: pulls NVD canonical metadata, EPSS
    // exploit probability, and CISA KEV flag for the vuln's CVE-ID, then
    // recomputes composite_priority. Idempotent — safe to call repeatedly.
    enrich: (id: number) =>
      apiClient.post(`/vuln-management/vulnerabilities/${id}/enrich`),
    // Bulk backfill: queues a Celery job to enrich every open vuln in the
    // tenant. Returns immediately with {queued, task_id}. Used by the
    // "Enrich all" button on the list page after rolling out the feature.
    enrichAll: () =>
      apiClient.post(`/vuln-management/vulnerabilities/enrich-all`),
    // Phase 6 — Vendor patch intelligence (MSRC first). Asks the upstream
    // PSIRT for KB articles + advisory IDs + remediation text for this
    // vuln's CVE. Idempotent re-sync; non-Microsoft CVEs are cached as
    // negative hits so subsequent calls are cheap.
    syncPatchInfo: (id: number) =>
      apiClient.post(`/vuln-management/vulnerabilities/${id}/sync-patch-info`),
    // Bulk patch-intel sync — queues a Celery job to walk every open
    // CVE-bearing vuln in the tenant.
    syncPatchInfoAll: () =>
      apiClient.post(`/vuln-management/vulnerabilities/sync-patch-info-all`),
    // Phase 8 — Exception workflow. Each verb is a discrete state-machine
    // transition; the backend rejects invalid moves with a 400 and
    // enforces separation of duties (the requester cannot also approve).
    exceptionRequest: (id: number, body: {
      justification: string;
      compensating_controls?: string[];
      expires_at?: string;
    }) => apiClient.post(`/vuln-management/vulnerabilities/${id}/exception/request`, body),
    exceptionApprove: (id: number, body: { comment?: string; expires_at?: string }) =>
      apiClient.post(`/vuln-management/vulnerabilities/${id}/exception/approve`, body),
    exceptionDeny: (id: number, body: { denial_reason: string }) =>
      apiClient.post(`/vuln-management/vulnerabilities/${id}/exception/deny`, body),
    exceptionRevoke: (id: number, body: { reason?: string }) =>
      apiClient.post(`/vuln-management/vulnerabilities/${id}/exception/revoke`, body),
    // Bulk exception request — one justification + expiry applies to N vulns.
    bulkExceptionRequest: (body: {
      vulnerability_ids: number[];
      justification: string;
      compensating_controls?: string[];
      expires_at?: string;
    }) => apiClient.post<{ requested: number; skipped: number; errors: Array<{ id: number; msg: string }> }>(
      `/vuln-management/vulnerabilities/exception/bulk-request`, body,
    ),
    // Cross-tenant queue view for the Exceptions page.
    exceptionQueue: (params?: { state?: string; skip?: number; limit?: number }) =>
      apiClient.get<{
        total: number;
        rows: Array<{
          id: number;
          vuln_id: string;
          title: string;
          severity: string;
          cve_id?: string;
          exception_status: string;
          exception_requested_by_id?: number;
          exception_requested_at?: string;
          exception_approved_at?: string;
          exception_expires_at?: string;
          exception_justification?: string;
          composite_priority?: number;
        }>;
      }>('/vuln-management/vulnerabilities/exception-queue', { params }),
  },
  mitigations: {
    list: (vulnId: number) => 
      apiClient.get(`/vuln-management/vulnerabilities/${vulnId}/mitigations`),
    create: (vulnId: number, data: Record<string, unknown>) => 
      apiClient.post(`/vuln-management/vulnerabilities/${vulnId}/mitigations`, data),
    update: (vulnId: number, mitigationId: number, data: Record<string, unknown>) => 
      apiClient.put(`/vuln-management/vulnerabilities/${vulnId}/mitigations/${mitigationId}`, data),
    delete: (vulnId: number, mitigationId: number) => 
      apiClient.delete(`/vuln-management/vulnerabilities/${vulnId}/mitigations/${mitigationId}`),
  },
  assetLinks: {
    list: (vulnId: number) => 
      apiClient.get(`/vuln-management/vulnerabilities/${vulnId}/assets`),
    create: (vulnId: number, data: { asset_id: number; relationship_type?: string }) => 
      apiClient.post(`/vuln-management/vulnerabilities/${vulnId}/assets`, data),
    delete: (vulnId: number, linkId: number) => 
      apiClient.delete(`/vuln-management/vulnerabilities/${vulnId}/assets/${linkId}`),
  },
  controlLinks: {
    list: (vulnId: number) =>
      apiClient.get(`/vuln-management/vulnerabilities/${vulnId}/controls`),
    create: (vulnId: number, data: { control_type: string; framework_control_id?: number; internal_control_id?: number }) =>
      apiClient.post(`/vuln-management/vulnerabilities/${vulnId}/controls`, data),
    delete: (vulnId: number, linkId: number) =>
      apiClient.delete(`/vuln-management/vulnerabilities/${vulnId}/controls/${linkId}`),
    // Re-run the CWE → framework-control auto-mapper for one vuln.
    // Idempotent; only touches rows tagged `auto:cwe:*`. Returns
    // {matched_controls, added, kept, removed_stale, errors}.
    autoMap: (vulnId: number) =>
      apiClient.post(`/vuln-management/vulnerabilities/${vulnId}/controls/auto-map`),

    // Per-tenant CWE → control overrides (compliance team customisation).
    listOverrides: () =>
      apiClient.get(`/vuln-management/cwe-overrides`),
    createOverride: (body: {
      cwe_id: string;
      framework_prefix: string;
      control_code_pattern: string;
      action: 'add' | 'remove';
      notes?: string;
    }) => apiClient.post(`/vuln-management/cwe-overrides`, body),
    deleteOverride: (id: number) =>
      apiClient.delete(`/vuln-management/cwe-overrides/${id}`),
    previewOverrides: (params: { cwe_id?: string; has_cve?: boolean; is_kev?: boolean }) =>
      apiClient.get(`/vuln-management/cwe-overrides/preview`, { params }),
    // Reverse lookup: which open vulns affect this framework control.
    // Returns {control, summary, items}. `controlType` is "parsed" (the
    // upload-driven seed table, where the 27 active frameworks live) or
    // "legacy" (the older FrameworkControl chain). Defaults to "parsed"
    // because that's where the data actually is.
    listEvidenceForControl: (
      controlId: number,
      includeResolved = false,
      controlType: 'parsed' | 'legacy' = 'parsed',
    ) =>
      apiClient.get(
        `/vuln-management/framework-controls/${controlId}/vulnerability-evidence`,
        { params: { include_resolved: includeResolved, control_type: controlType } },
      ),
  },
  retests: {
    list: (vulnId: number) => 
      apiClient.get(`/vuln-management/vulnerabilities/${vulnId}/retests`),
    create: (vulnId: number, data: Record<string, unknown>) => 
      apiClient.post(`/vuln-management/vulnerabilities/${vulnId}/retests`, data),
  },
  ai: {
    analyzeReport: (reportId: number) => 
      apiClient.post(`/vuln-management/ai/analyze-report/${reportId}`),
    suggestFix: (vulnId: number) => 
      apiClient.post(`/vuln-management/ai/suggest-fix/${vulnId}`),
    getJobs: () => apiClient.get('/vuln-management/ai/jobs'),
    getJob: (jobId: string) => apiClient.get(`/vuln-management/ai/jobs/${jobId}`),
  },
  sla: {
    get: () => apiClient.get('/vuln-management/sla'),
    create: (data: Record<string, unknown> | Array<Record<string, unknown>>) =>
      apiClient.post('/vuln-management/sla', Array.isArray(data) ? data : [data]),
    update: (severity: string, data: Record<string, unknown>) =>
      apiClient.put(`/vuln-management/sla/${encodeURIComponent(severity)}`, data),
  },
  exceptions: {
    list: () => 
      apiClient.get(`/vuln-management/exceptions`),
    create: (vulnId: number, data: Record<string, unknown>) => 
      apiClient.post(`/vuln-management/vulnerabilities/${vulnId}/exception`, data),
    update: (vulnId: number, data: Record<string, unknown>) => 
      apiClient.put(`/vuln-management/vulnerabilities/${vulnId}/exception`, data),
  },
  departments: {
    getAll: () => apiClient.get('/vuln-management/departments'),
    getById: (id: number) => apiClient.get(`/vuln-management/departments/${id}`),
    create: (data: Record<string, unknown>) => 
      apiClient.post('/vuln-management/departments', data),
    update: (id: number, data: Record<string, unknown>) => 
      apiClient.put(`/vuln-management/departments/${id}`, data),
    delete: (id: number) => apiClient.delete(`/vuln-management/departments/${id}`),
    addMember: (deptId: number, data: { user_id: number; role?: string; email_notifications_enabled?: boolean; escalation_order?: number }) => 
      apiClient.post(`/vuln-management/departments/${deptId}/members`, data),
    removeMember: (deptId: number, memberId: number) => 
      apiClient.delete(`/vuln-management/departments/${deptId}/members/${memberId}`),
    getMembers: (deptId: number) =>
      apiClient.get(`/vuln-management/departments/${deptId}/members`),
    getVulnerabilityDepartments: (vulnId: number) => 
      apiClient.get(`/vuln-management/vulnerabilities/${vulnId}/departments`),
    assignDepartment: (vulnId: number, data: { department_id: number; priority?: string; sla_override_days?: number; notes?: string }) => 
      apiClient.post(`/vuln-management/vulnerabilities/${vulnId}/assign-department`, data),
    removeDepartmentAssignment: (vulnId: number, assignmentId: number) => 
      apiClient.delete(`/vuln-management/vulnerabilities/${vulnId}/assign-department/${assignmentId}`),
    getDepartmentVulnerabilities: (deptId: number) =>
      apiClient.get(`/vuln-management/departments/${deptId}/vulnerabilities`),
    getEscalationPaths: (deptId: number) =>
      apiClient.get(`/vuln-management/departments/${deptId}/escalation-paths`),
    createEscalationPath: (deptId: number, data: Record<string, unknown>) =>
      apiClient.post(`/vuln-management/departments/${deptId}/escalation-paths`, data),
    bulkAssign: (data: { vulnerability_ids: number[]; department_id: number; priority?: string; notes?: string }) =>
      apiClient.post('/vuln-management/vulnerabilities/bulk-assign', data),
  },
  workflows: {
    getAvailableTransitions: (vulnId: number) => 
      apiClient.get(`/vuln-management/workflows/vulnerabilities/${vulnId}/available-transitions`),
    getHistory: (vulnId: number) => 
      apiClient.get(`/vuln-management/workflows/vulnerabilities/${vulnId}/history`),
    transition: (vulnId: number, data: { transition_name: string; comment?: string }) => 
      apiClient.post(`/vuln-management/workflows/vulnerabilities/${vulnId}/transition`, data),
  },
  escalations: {
    getVulnerabilityEscalations: (vulnId: number) => 
      apiClient.get(`/vuln-management/escalations/vulnerabilities/${vulnId}/escalations`),
  },
  notifications: {
    getAll: () => apiClient.get('/vuln-management/notifications'),
    getUnreadCount: () => apiClient.get('/vuln-management/notifications/unread-count'),
    markAsRead: (id: number) => 
      apiClient.put(`/vuln-management/notifications/${id}/read`),
    markAllAsRead: () => 
      apiClient.put('/vuln-management/notifications/read-all'),
  },
  dashboard: {
    get: () => apiClient.get('/vuln-management/dashboard'),
    getOverdue: () => apiClient.get('/vuln-management/dashboard/overdue'),
    getAssetExposure: () => apiClient.get('/vuln-management/dashboard/asset-exposure'),
    getDepartmentMetrics: () => apiClient.get('/vuln-management/dashboard/department-metrics'),
    getSLATrends: () => apiClient.get('/vuln-management/dashboard/sla-trends'),
    getWorkflowMetrics: () => apiClient.get('/vuln-management/dashboard/workflow-metrics'),
    getControlCoverage: () => apiClient.get('/vuln-management/dashboard/control-coverage'),
    getSLAComplianceTrends: (weeks?: number) => 
      apiClient.get('/vuln-management/dashboard/sla-compliance-trends', { params: { weeks } }),
    getDepartmentWorkload: () => apiClient.get('/vuln-management/dashboard/department-workload'),
    getAgingByDepartment: () => apiClient.get('/vuln-management/dashboard/aging-by-department'),
    getEscalationMetrics: () => apiClient.get('/vuln-management/dashboard/escalation-metrics'),
    // Threat-intelligence metrics — KEV exposure, composite-priority buckets,
    // EPSS bands, asset-criticality matrix, top-10 priority table. Returns
    // empty/zero series when the tenant hasn't enriched anything yet.
    getThreatIntel: (params?: { tenant_id?: number }) =>
      apiClient.get('/vuln-management/dashboard/threat-intel', { params }),
    // Asset risk heatmap (treemap data). One row per asset with at least
    // one open vuln; size = asset criticality, value = total open priority.
    // Designed for "where should the next patching cycle focus?" answer.
    getAssetRiskHeatmap: (params?: { tenant_id?: number; limit?: number }) =>
      apiClient.get('/vuln-management/dashboard/asset-risk-heatmap', { params }),
    // Trend series + report download for the overview "intuitive graphs"
    // section. `period` accepts "60d", "90d", "quarter", "180d", "365d".
    // `start_date` + `end_date` (ISO YYYY-MM-DD) override `period` when both
    // are supplied — that's the custom date-range path. `bucket` is
    // auto-resolved by the backend; pass to override.
    getTrends: (params?: {
      period?: string;
      bucket?: 'day' | 'week' | 'month';
      tenant_id?: number;
      start_date?: string;
      end_date?: string;
    }) => apiClient.get('/vuln-management/dashboard/trends', { params }),
    downloadReport: (params?: {
      period?: string;
      bucket?: 'day' | 'week' | 'month';
      fmt?: 'pdf' | 'text';
      start_date?: string;
      end_date?: string;
    }) =>
      apiClient.get('/vuln-management/dashboard/report', {
        params,
        responseType: 'blob',
      }),
  },
};

export const regulatoryApi = {
  getChanges: (params?: { source?: string; status?: string; priority?: string; search?: string }) => 
    apiClient.get('/governance/regulatory-changes/changes', { params }),
  getChange: (id: number) => apiClient.get(`/governance/regulatory-changes/changes/${id}`),
  createChange: (data: Record<string, unknown>) => apiClient.post('/governance/regulatory-changes/changes', data),
  updateChange: (id: number, data: Record<string, unknown>) => apiClient.put(`/governance/regulatory-changes/changes/${id}`, data),
  deleteChange: (id: number) => apiClient.delete(`/governance/regulatory-changes/changes/${id}`),
  getAssessments: (changeId: number) => apiClient.get(`/governance/regulatory-changes/changes/${changeId}/assessments`),
  createAssessment: (changeId: number, data: Record<string, unknown>) => apiClient.post(`/governance/regulatory-changes/changes/${changeId}/assessments`, data),
  getTasks: (changeId: number) => apiClient.get(`/governance/regulatory-changes/changes/${changeId}/tasks`),
  createTask: (changeId: number, data: Record<string, unknown>) => apiClient.post(`/governance/regulatory-changes/changes/${changeId}/tasks`, data),
  updateTask: (taskId: number, data: Record<string, unknown>) => apiClient.patch(`/governance/regulatory-changes/tasks/${taskId}`, data),
  deleteTask: (taskId: number) => apiClient.delete(`/governance/regulatory-changes/tasks/${taskId}`),
  getDashboard: () => apiClient.get('/governance/regulatory-changes/dashboard'),
  getGapAnalysis: (changeId: number) => apiClient.get(`/governance/regulatory-changes/changes/${changeId}/gap-analysis`),
  getClosureReadiness: (changeId: number) => apiClient.get(`/governance/regulatory-changes/changes/${changeId}/closure-readiness`),
  closeChange: (changeId: number) => apiClient.post(`/governance/regulatory-changes/changes/${changeId}/close`),
};

export const rcsaApi = {
  getTemplates: () => apiClient.get('/erm/rcsa/templates'),
  getTemplate: (id: number) => apiClient.get(`/erm/rcsa/templates/${id}`),
  createTemplate: (data: Record<string, unknown>) => apiClient.post('/erm/rcsa/templates', data),
  updateTemplate: (id: number, data: Record<string, unknown>) => apiClient.put(`/erm/rcsa/templates/${id}`, data),
  deleteTemplate: (id: number) => apiClient.delete(`/erm/rcsa/templates/${id}`),
  cloneTemplate: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/rcsa/templates/${id}/clone`, data),
  uploadTemplate: (formData: FormData, params: { name: string; category: string }) =>
    apiClient.post('/erm/rcsa/templates/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params,
    }),
  downloadTemplate: (id: number) => apiClient.get(`/erm/rcsa/templates/download/${id}`, { responseType: 'blob' }),

  // ── Custom (bring-your-own-Excel) RCSA templates ─────────────────────────
  // Upload an Excel file once; the platform parses its column structure and
  // drives every downstream feature (row CRUD, export, AI suggestions, risk
  // register linking) using that exact layout. Coexists with the question-
  // based template endpoints above — neither replaces the other.
  customTemplates: {
    list: (includeInactive = false) =>
      apiClient.get('/erm/rcsa/custom-templates', { params: { include_inactive: includeInactive } }),
    get: (id: number) => apiClient.get(`/erm/rcsa/custom-templates/${id}`),
    upload: (
      file: File,
      opts?: { name?: string; description?: string; function_area?: string; sheet_name?: string; seed_from_file?: boolean },
    ) => {
      const fd = new FormData();
      fd.append('file', file);
      if (opts?.name) fd.append('name', opts.name);
      if (opts?.description) fd.append('description', opts.description);
      if (opts?.function_area) fd.append('function_area', opts.function_area);
      if (opts?.sheet_name) fd.append('sheet_name', opts.sheet_name);
      // Default seed=true on backend — only send false explicitly when needed.
      if (opts?.seed_from_file === false) fd.append('seed_from_file', 'false');
      // Do NOT set Content-Type manually — axios needs to attach the
      // multipart boundary itself; specifying a bare value strips it.
      return apiClient.post('/erm/rcsa/custom-templates', fd, {
        headers: { 'Content-Type': undefined },
        timeout: 2 * 60 * 1000,
      });
    },
    deactivate: (id: number) => apiClient.delete(`/erm/rcsa/custom-templates/${id}`),
    download: (id: number) =>
      apiClient.get(`/erm/rcsa/custom-templates/${id}/download`, { responseType: 'blob' }),
    exportCurrent: (id: number) =>
      apiClient.post(`/erm/rcsa/custom-templates/${id}/export`, undefined, { responseType: 'blob' }),
    reimport: (id: number, replace = false) =>
      apiClient.post(`/erm/rcsa/custom-templates/${id}/import-rows`, undefined, { params: { replace } }),
    listRows: (id: number, params?: { limit?: number; offset?: number }) =>
      apiClient.get(`/erm/rcsa/custom-templates/${id}/rows`, { params }),
    createRow: (id: number, data: { data: Record<string, unknown>; risk_id_text?: string }) =>
      apiClient.post(`/erm/rcsa/custom-templates/${id}/rows`, data),
    getRow: (id: number, rowId: number) =>
      apiClient.get(`/erm/rcsa/custom-templates/${id}/rows/${rowId}`),
    updateRow: (id: number, rowId: number, data: { data?: Record<string, unknown>; risk_id_text?: string }) =>
      apiClient.put(`/erm/rcsa/custom-templates/${id}/rows/${rowId}`, data),
    deleteRow: (id: number, rowId: number) =>
      apiClient.delete(`/erm/rcsa/custom-templates/${id}/rows/${rowId}`),
    promoteRowToRisk: (id: number, rowId: number, data: { title_override?: string; description_override?: string } = {}) =>
      apiClient.post(`/erm/rcsa/custom-templates/${id}/rows/${rowId}/promote-to-risk`, data),

    // ── Tenant users available for row assignment ─────────────────────
    listTenantUsers: () =>
      apiClient.get<Array<{ id: number; display_name: string; email?: string | null }>>(
        '/erm/rcsa/custom-templates/tenant-users',
      ),

    // ── Row-level: AI explanation, evidence, assignment ───────────────
    assignRow: (id: number, rowId: number, assignedUserId: number | null) =>
      apiClient.patch(
        `/erm/rcsa/custom-templates/${id}/rows/${rowId}/assign`,
        { assigned_user_id: assignedUserId },
      ),
    explainRow: (id: number, rowId: number, refresh = false) =>
      apiClient.post<{
        row_id: number;
        explanation: string;
        generated_at: string;
        from_cache: boolean;
      }>(`/erm/rcsa/custom-templates/${id}/rows/${rowId}/explain`, undefined, {
        params: { refresh },
      }),
    listRowEvidence: (id: number, rowId: number) =>
      apiClient.get<Array<{
        id: number;
        row_id: number;
        file_name: string;
        file_size?: number | null;
        mime_type?: string | null;
        description?: string | null;
        uploaded_by?: number | null;
        uploaded_by_name?: string | null;
        uploaded_at: string;
        linked_evidence_id?: number | null;
      }>>(`/erm/rcsa/custom-templates/${id}/rows/${rowId}/evidence`),
    uploadRowEvidence: (id: number, rowId: number, file: File, description?: string) => {
      const fd = new FormData();
      fd.append('file', file);
      if (description) fd.append('description', description);
      return apiClient.post(`/erm/rcsa/custom-templates/${id}/rows/${rowId}/evidence`, fd, {
        headers: { 'Content-Type': undefined },
        timeout: 2 * 60 * 1000,
      });
    },
    /** Link an existing Evidence Library item to the assessment item. */
    linkRowEvidenceFromLibrary: (id: number, rowId: number, evidenceId: number, description?: string) =>
      apiClient.post(
        `/erm/rcsa/custom-templates/${id}/rows/${rowId}/evidence/from-library`,
        { evidence_id: evidenceId, description: description || null },
      ),
    deleteRowEvidence: (id: number, rowId: number, evidenceId: number) =>
      apiClient.delete(`/erm/rcsa/custom-templates/${id}/rows/${rowId}/evidence/${evidenceId}`),
    downloadRowEvidenceUrl: (id: number, rowId: number, evidenceId: number) =>
      `/erm/rcsa/custom-templates/${id}/rows/${rowId}/evidence/${evidenceId}/download`,

    // ── Evidence Library search (drives the "Pick from library" combobox) ──
    listEvidenceLibrary: (search?: string) =>
      apiClient.get<Array<{
        id: number;
        name: string;
        file_name?: string | null;
        file_type?: string | null;
        evidence_type?: string | null;
        status?: string | null;
        uploaded_at?: string | null;
      }>>('/erm/rcsa/custom-templates/evidence-library', {
        params: search ? { search } : undefined,
      }),

    // ── Cross-template "My Assignments" — items owned by the caller ───
    listMyAssignments: () =>
      apiClient.get<Array<{
        row_id: number;
        template_id: number;
        template_name: string;
        risk_id_text?: string | null;
        inherent_overall_label?: string | null;
        residual_overall_label?: string | null;
        inherent_overall_score?: number | null;
        residual_overall_score?: number | null;
        evidence_count: number;
        updated_at: string;
      }>>('/erm/rcsa/custom-templates/my-assignments'),
  },

  getCampaigns: (params?: { status?: string; period?: string }) => apiClient.get('/erm/rcsa/campaigns', { params }),
  getCampaign: (id: number) => apiClient.get(`/erm/rcsa/campaigns/${id}`),
  getCampaignDetail: (id: number) => apiClient.get(`/erm/rcsa/campaigns/${id}/detail`),
  createCampaign: (data: Record<string, unknown>) => apiClient.post('/erm/rcsa/campaigns', data),
  updateCampaign: (id: number, data: Record<string, unknown>) => apiClient.put(`/erm/rcsa/campaigns/${id}`, data),
  deleteCampaign: (id: number) => apiClient.delete(`/erm/rcsa/campaigns/${id}`),
  activateCampaign: (id: number) => apiClient.post(`/erm/rcsa/campaigns/${id}/activate`),
  closeCampaign: (id: number) => apiClient.post(`/erm/rcsa/campaigns/${id}/close`),
  assignBusinessUnits: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/rcsa/campaigns/${id}/assign`, data),
  sendReminders: (id: number) => apiClient.post(`/erm/rcsa/campaigns/${id}/reminders`),
  exportResults: (id: number) => apiClient.get(`/erm/rcsa/campaigns/${id}/export`, { responseType: 'blob' }),
  
  getDashboardSummary: () => apiClient.get('/erm/rcsa/dashboard/summary'),
  getFindingsBySeverity: () => apiClient.get('/erm/rcsa/dashboard/findings-by-severity'),
  getBUProgress: () => apiClient.get('/erm/rcsa/dashboard/business-unit-progress'),
  getRecentCampaigns: () => apiClient.get('/erm/rcsa/dashboard/recent-campaigns'),

  getAssessments: (params?: Record<string, unknown>) => apiClient.get('/erm/rcsa/assessments', { params }),
  getAssessment: (id: number) => apiClient.get(`/erm/rcsa/assessments/${id}/detail`),
  startAssessment: (id: number) => apiClient.post(`/erm/rcsa/assessments/${id}/start`),
  saveResponses: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/rcsa/assessments/${id}/save`, data),
  submitAssessment: (id: number) => apiClient.post(`/erm/rcsa/assessments/${id}/submit`),
  getAISuggestions: (id: number, questionId?: number) =>
    apiClient.get(`/erm/rcsa/assessments/${id}/ai-suggestions`, {
      params: questionId ? { question_id: questionId } : undefined,
    }),

  approveAssessment: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/rcsa/assessments/${id}/approve`, data),
  rejectAssessment: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/rcsa/assessments/${id}/reject`, data),
  returnAssessment: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/rcsa/assessments/${id}/return`, data),
  delegateAssessment: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/rcsa/assessments/${id}/delegate`, data),
  getPendingApprovals: (params?: Record<string, unknown>) => apiClient.get('/erm/rcsa/assessments/pending-approvals', { params }),

  getFindings: (params?: Record<string, unknown>) => apiClient.get('/erm/rcsa/findings', { params }),
  getFinding: (id: number) => apiClient.get(`/erm/rcsa/findings/${id}`),
  createFinding: (data: Record<string, unknown>) => apiClient.post('/erm/rcsa/findings', data),
  updateFinding: (id: number, data: Record<string, unknown>) => apiClient.put(`/erm/rcsa/findings/${id}`, data),
  linkFindingToRisk: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/rcsa/findings/${id}/link-risk`, data),
  linkFindingToControl: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/rcsa/findings/${id}/link-control`, data),
  createFindingAction: (id: number, data: Record<string, unknown>) => apiClient.post(`/erm/rcsa/findings/${id}/create-action`, data),

  getApprovalWorkflows: () => apiClient.get('/erm/rcsa/approval-workflows'),
  createApprovalWorkflow: (data: Record<string, unknown>) => apiClient.post('/erm/rcsa/approval-workflows', data),
  updateApprovalWorkflow: (id: number, data: Record<string, unknown>) => apiClient.put(`/erm/rcsa/approval-workflows/${id}`, data),
};

export const dashboardApi = {
  getStats: () => apiClient.get('/dashboard/stats'),
  getFrameworkCompliance: (frameworkId: number) => apiClient.get(`/dashboard/compliance/${frameworkId}`),
  getUnified: (tenantId?: number) => apiClient.get('/dashboard/unified', { params: tenantId ? { tenant_id: tenantId } : {} }),
  getAIInsights: (tenantId?: number) => apiClient.get('/dashboard/ai-insights', { params: tenantId ? { tenant_id: tenantId } : {} }),
  getEnhancedStats: (tenantId?: number) => apiClient.get('/dashboard/enhanced-stats', { params: tenantId ? { tenant_id: tenantId } : {} }),
};

// ── Phase 7: Cloud connectors ────────────────────────────────────────────────
export interface CloudConnector {
  id: number;
  tenant_id: number;
  provider: string;
  display_name: string;
  description?: string | null;
  sync_schedule_seconds?: number | null;
  is_active: boolean;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  last_sync_error?: string | null;
  last_health_check_at?: string | null;
  last_health_status?: string | null;
  health_metrics?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ───────────────────────────────────────────────────────────────────
// External connector framework (Ticketing / SIEM / Pen-test / Collab /
// Transcribe). Distinct from `cloudConnectorsApi` (AWS/Azure/GCP) and
// from `integrationsApi` (legacy Nessus/Nexpose scanner connections).
// ───────────────────────────────────────────────────────────────────
export interface ConnectorProviderField {
  key: string;
  label: string;
  kind: 'text' | 'password' | 'url' | 'textarea' | 'select' | 'toggle';
  required: boolean;
  placeholder?: string;
  help_text?: string;
  options?: Array<{ value: string; label: string }>;
  is_credential: boolean;
}

export interface ConnectorProviderMeta {
  provider: string;
  label: string;
  category: 'ticketing' | 'siem' | 'pentest' | 'collab' | 'transcribe';
  description: string;
  auth_method: 'api_key' | 'basic' | 'oauth2' | 'token';
  beta: boolean;
  docs_url?: string;
  oauth_scopes?: string[];
  fields: ConnectorProviderField[];
}

export interface ConnectorRow {
  id: number;
  provider: string;
  provider_label: string;
  category: string;
  connection_name: string;
  console_url: string;
  auth_method: string;
  sync_schedule: string;
  is_active: boolean;
  status: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_stats: Record<string, unknown> | null;
  consecutive_failures: number;
  provider_config: Record<string, unknown>;
  has_credentials: boolean;
  beta: boolean;
  created_at: string | null;
}

export const connectorsApi = {
  listProviders: (category?: string) => apiClient.get<{
    encryption_enabled: boolean;
    categories: string[];
    providers: ConnectorProviderMeta[];
  }>('/connectors/providers', category ? { params: { category } } : undefined),
  list: () => apiClient.get<{ items: ConnectorRow[] }>('/connectors'),
  create: (data: {
    provider: string;
    connection_name: string;
    console_url?: string;
    fields: Record<string, unknown>;
    sync_schedule?: string;
    verify_ssl?: boolean;
  }) => apiClient.post<{
    connection: ConnectorRow;
    test_result: { success: boolean; message: string; server_version?: string; details?: Record<string, unknown> };
  }>('/connectors', data),
  update: (id: number, data: Partial<{
    connection_name: string;
    console_url: string;
    fields: Record<string, unknown>;
    sync_schedule: string;
    is_active: boolean;
    verify_ssl: boolean;
  }>) => apiClient.patch<{ connection: ConnectorRow }>(`/connectors/${id}`, data),
  test: (id: number) => apiClient.post<{
    success: boolean; message: string; server_version?: string; details?: Record<string, unknown>;
  }>(`/connectors/${id}/test`),
  sync: (id: number) => apiClient.post<{
    queued: boolean; connector_id?: number; inline?: boolean; result?: Record<string, unknown>;
  }>(`/connectors/${id}/sync`),
  remove: (id: number) => apiClient.delete(`/connectors/${id}`),
  oauthStart: (provider: string, connectorId: number) => apiClient.get<{
    authorize_url: string; state: string;
  }>('/connectors/oauth/start', { params: { provider, connector_id: connectorId } }),
};

export const cloudConnectorsApi = {
  listProviders: () => apiClient.get<{
    providers: Array<{ provider: string; label: string; credentials_schema: Record<string, unknown> }>;
    encryption_ready: boolean;
  }>('/cloud-connectors/providers'),
  list: () => apiClient.get<CloudConnector[]>('/cloud-connectors'),
  create: (data: {
    provider: string;
    display_name: string;
    description?: string;
    credentials: Record<string, unknown>;
    sync_schedule_seconds?: number;
  }) => apiClient.post<CloudConnector>('/cloud-connectors', data),
  update: (id: number, data: Partial<{
    display_name: string;
    description: string;
    credentials: Record<string, unknown>;
    sync_schedule_seconds: number;
    is_active: boolean;
  }>) => apiClient.patch<CloudConnector>(`/cloud-connectors/${id}`, data),
  healthCheck: (id: number) =>
    apiClient.post<{ status: string; detail?: string; latency_ms?: number; checked_at?: string }>(
      `/cloud-connectors/${id}/health-check`,
    ),
  sync: (id: number) =>
    apiClient.post<{
      status: string;
      connector_id: number;
      assets_new?: number;
      assets_updated?: number;
      vulnerabilities_new?: number;
      vulnerabilities_updated?: number;
      errors?: string[];
    }>(`/cloud-connectors/${id}/sync`),
  syncAll: () =>
    apiClient.post<{ queued: boolean; task_id: string }>(`/cloud-connectors/sync-all`),
  delete: (id: number) => apiClient.delete(`/cloud-connectors/${id}`),
  // Per-provider setup guide + auto-generated secure values (per-tenant
  // External ID for AWS, IAM policies, role assignment text, …). Used by
  // the Add Connector modal to show step-by-step linking instructions.
  setupInfo: (provider: string) =>
    apiClient.get<{
      provider: string;
      label: string;
      security_model: string;
      security_summary: string;
      what_we_store?: string[];
      what_we_dont_store?: string[];
      copy_blocks?: Array<{ label: string; value: string; language?: string; help?: string }>;
      steps: Array<{ title: string; body: string; code?: string }>;
      credentials_template?: Record<string, unknown>;
      redirect?: string;
    }>(`/cloud-connectors/setup-info/${provider}`),
  // Unified discovery view — returns BOTH cloud connectors (new framework)
  // AND legacy scanner integrations (Nessus / Nexpose) in one list so the
  // admin sees the full integration surface in one place.
  unified: () => apiClient.get<{
    connectors: Array<{
      id: number;
      framework: 'cloud_connector' | 'legacy_scanner';
      provider: string;
      display_name: string;
      description?: string | null;
      is_active: boolean;
      last_sync_at?: string | null;
      last_sync_status?: string | null;
      last_sync_error?: string | null;
      last_health_status?: string | null;
      manage_path: string;
    }>;
    total: number;
  }>('/cloud-connectors/unified'),
};

// ── Teams (admin) ────────────────────────────────────────────────────────────
// Tenant-scoped org teams used by the asset ownership-chain dropdown.

export interface Team {
  id: number;
  tenant_id: number;
  name: string;
  description?: string | null;
  lead_user_id?: number | null;
  lead_user_name?: string | null;
  is_active: boolean;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: number;
  user_id: number;
  user_display_name?: string | null;
  user_email?: string | null;
  role_in_team: string;
  added_at: string;
}

export const teamsApi = {
  list: (includeInactive = false) =>
    apiClient.get<Team[]>('/admin/teams', { params: { include_inactive: includeInactive } }),
  get: (id: number) =>
    apiClient.get<Team & { members: TeamMember[] }>(`/admin/teams/${id}`),
  create: (data: { name: string; description?: string; lead_user_id?: number }) =>
    apiClient.post<Team>('/admin/teams', data),
  update: (id: number, data: Partial<{ name: string; description: string; lead_user_id: number; is_active: boolean }>) =>
    apiClient.patch<Team>(`/admin/teams/${id}`, data),
  delete: (id: number) => apiClient.delete(`/admin/teams/${id}`),
  listMembers: (teamId: number) =>
    apiClient.get<TeamMember[]>(`/admin/teams/${teamId}/members`),
  addMember: (teamId: number, data: { user_id: number; role_in_team?: 'lead' | 'member' | 'viewer' }) =>
    apiClient.post<TeamMember>(`/admin/teams/${teamId}/members`, data),
  updateMember: (teamId: number, memberId: number, data: { role_in_team: 'lead' | 'member' | 'viewer' }) =>
    apiClient.patch<TeamMember>(`/admin/teams/${teamId}/members/${memberId}`, data),
  removeMember: (teamId: number, memberId: number) =>
    apiClient.delete(`/admin/teams/${teamId}/members/${memberId}`),
};

// ── Phase 4: Software identifier (CPE / PURL) inventory per asset ───────────
export const softwareIdentifiersApi = {
  list: (assetId: number) =>
    apiClient.get<Array<{
      id: number;
      identifier_type: 'cpe' | 'purl';
      identifier: string;
      vendor?: string | null;
      product?: string | null;
      version?: string | null;
      source?: string | null;
      created_at: string;
    }>>(`/assets/${assetId}/software-identifiers`),
  create: (assetId: number, body: {
    identifier_type: 'cpe' | 'purl';
    identifier: string;
    vendor?: string;
    product?: string;
    version?: string;
    source?: string;
  }) => apiClient.post(`/assets/${assetId}/software-identifiers`, body),
  delete: (assetId: number, identifierId: number) =>
    apiClient.delete(`/assets/${assetId}/software-identifiers/${identifierId}`),
};

// ── Phase 9: Power search + analytics ────────────────────────────────────────
export const searchApi = {
  power: (params: {
    q: string;
    domains?: string;
    per_domain_limit?: number;
  }) => apiClient.get<{
    q: string;
    total: number;
    results: Record<string, Array<{
      type: string;
      id: number;
      title: string;
      subtitle?: string | null;
      url: string;
      severity?: string;
      status?: string;
      asset_type?: string;
      criticality?: string;
    }>>;
  }>('/search/power', { params }),
  exceptionAging: () =>
    apiClient.get<{
      generated_at: string;
      counts_by_state: Record<string, number>;
      active_aging_buckets: Record<string, number>;
      expiring_within: Record<string, number>;
      expired_unactioned: number;
      pending_request_aging: Record<string, number>;
    }>('/analytics/exception-aging'),
  executiveDashboard: () =>
    apiClient.get<Record<string, unknown>>('/analytics/executive-dashboard'),
  analystDashboard: () =>
    apiClient.get<Record<string, unknown>>('/analytics/analyst-dashboard'),
  correlation: () =>
    apiClient.get<{
      by_kb: Array<{ kb_id: string; finding_count: number; affected_assets: number }>;
      by_cve: Array<{ cve_id: string; finding_count: number; affected_assets: number }>;
    }>('/analytics/patch-correlation'),
  vendorRisk: () =>
    apiClient.get<{
      by_vendor: Array<{
        vendor: string;
        vuln_count: number;
        critical_count: number;
        high_count: number;
        medium_count: number;
        low_count: number;
      }>;
      by_cwe: Array<{ cwe_id: string; count: number }>;
    }>('/analytics/vendor-risk'),
};

// ── Phase 9: Compliance reports (CSV / Excel exports) ────────────────────────
export const reportsApi = {
  exceptionsActive: (params?: { start_date?: string; end_date?: string; format?: 'csv' | 'xlsx' }) =>
    apiClient.get('/reports/exceptions-active', {
      params,
      responseType: 'blob',
    }),
  remediationTimeline: (params?: { format?: 'csv' | 'xlsx' }) =>
    apiClient.get('/reports/remediation-timeline', {
      params,
      responseType: 'blob',
    }),
  assetRegister: (params?: { format?: 'csv' | 'xlsx' }) =>
    apiClient.get('/reports/asset-register', {
      params,
      responseType: 'blob',
    }),
  patchEvidence: (params?: { format?: 'csv' | 'xlsx' }) =>
    apiClient.get('/reports/patch-evidence', {
      params,
      responseType: 'blob',
    }),
};

export const enrichedDashboardApi = {
  getExecutiveRiskVelocity: (days?: number) => apiClient.get('/enriched-dashboard/executive/risk-velocity', { params: days ? { days } : {} }),
  getExecutiveRiskAppetiteGauge: () => apiClient.get('/enriched-dashboard/executive/risk-appetite-gauge'),
  getExecutiveEmergingRisks: () => apiClient.get('/enriched-dashboard/executive/emerging-risks'),
  getExecutiveRiskConcentration: () => apiClient.get('/enriched-dashboard/executive/risk-concentration'),
  getExecutiveBoardReadiness: () => apiClient.get('/enriched-dashboard/executive/board-readiness'),
  getExecutiveSummary: () => apiClient.get('/enriched-dashboard/executive/summary'),
  getCompliancePosture: () => apiClient.get('/enriched-dashboard/compliance-health/posture'),
  getControlEffectiveness: () => apiClient.get('/enriched-dashboard/compliance-health/control-effectiveness'),
  getAuditReadiness: () => apiClient.get('/enriched-dashboard/compliance-health/audit-readiness'),
  getAttestationStatus: () => apiClient.get('/enriched-dashboard/compliance-health/attestation-status'),
  getExceptionAging: () => apiClient.get('/enriched-dashboard/compliance-health/exception-aging'),
  getEvidenceStatus: () => apiClient.get('/enriched-dashboard/compliance-health/evidence-status'),
  getTreatmentPortfolio: () => apiClient.get('/enriched-dashboard/treatment/portfolio'),
  getTreatmentEffectiveness: () => apiClient.get('/enriched-dashboard/treatment/effectiveness'),
  getTreatmentStrategyMix: () => apiClient.get('/enriched-dashboard/treatment/strategy-mix'),
  getTreatmentActionVelocity: () => apiClient.get('/enriched-dashboard/treatment/action-velocity'),
  getTreatmentBurndown: (months?: number) => apiClient.get('/enriched-dashboard/treatment/burndown', { params: months ? { months } : {} }),
  getIncidentSummary: () => apiClient.get('/enriched-dashboard/incidents/summary'),
  getIncidentResponseTimes: () => apiClient.get('/enriched-dashboard/incidents/response-times'),
  getIncidentRootCauses: () => apiClient.get('/enriched-dashboard/incidents/root-causes'),
  getIncidentTrends: (months?: number) => apiClient.get('/enriched-dashboard/incidents/trends', { params: months ? { months } : {} }),
  getIncidentLessonsLearned: () => apiClient.get('/enriched-dashboard/incidents/lessons-learned'),
  getControlTestingSummary: () => apiClient.get('/enriched-dashboard/controls/testing-summary'),
  getControlDeficiencyTracker: () => apiClient.get('/enriched-dashboard/controls/deficiency-tracker'),
  getControlEffectivenessByType: () => apiClient.get('/enriched-dashboard/controls/effectiveness-by-type'),
  getControlUpcomingTests: () => apiClient.get('/enriched-dashboard/controls/upcoming-tests'),
  getRegulatoryChangeTracker: () => apiClient.get('/enriched-dashboard/regulatory/change-tracker'),
  getRegulatoryImpactSummary: () => apiClient.get('/enriched-dashboard/regulatory/impact-summary'),
  getRegulatoryImplementationProgress: () => apiClient.get('/enriched-dashboard/regulatory/implementation-progress'),
  getRegulatoryFeedAnalysis: () => apiClient.get('/enriched-dashboard/regulatory/feed-analysis'),
};

export const attestationApi = {
  getCampaigns: (params?: { status?: string }) => apiClient.get('/governance/attestation-campaigns/campaigns', { params }),
  getCampaign: (id: number) => apiClient.get(`/governance/attestation-campaigns/campaigns/${id}`),
  createCampaign: (data: Record<string, unknown>) => apiClient.post('/governance/attestation-campaigns/campaigns', data),
  updateCampaign: (id: number, data: Record<string, unknown>) => apiClient.put(`/governance/attestation-campaigns/campaigns/${id}`, data),
  deleteCampaign: (id: number) => apiClient.delete(`/governance/attestation-campaigns/campaigns/${id}`),
  activateCampaign: (id: number) => apiClient.post(`/governance/attestation-campaigns/campaigns/${id}/activate`),
  closeCampaign: (id: number) => apiClient.post(`/governance/attestation-campaigns/campaigns/${id}/close`),
  getCampaignRequests: (id: number, params?: { status?: string }) => apiClient.get(`/governance/attestation-campaigns/campaigns/${id}/requests`, { params }),
  completeAttestation: (id: number, data: Record<string, unknown>) => apiClient.post(`/governance/attestation-campaigns/requests/${id}/complete`, data),
  sendReminder: (id: number) => apiClient.post(`/governance/attestation-campaigns/requests/${id}/remind`),
  escalateRequest: (id: number) => apiClient.post(`/governance/attestation-campaigns/requests/${id}/escalate`),
  getMyAttestations: (params?: { status?: string }) => apiClient.get('/governance/attestation-campaigns/my-attestations', { params }),
  getDashboard: () => apiClient.get('/governance/attestation-campaigns/dashboard'),
  getAttestation: (id: number) => apiClient.get(`/governance/attestation-campaigns/requests/${id}`),
  linkToEvidence: (id: number) => apiClient.post(`/governance/attestations/${id}/link-to-evidence`),
  bulkLinkToEvidence: (attestationIds: number[]) => apiClient.post('/governance/attestations/bulk-link-evidence', { attestation_ids: attestationIds }),
  addEscalationChain: (campaignId: number, data: Record<string, unknown>) => apiClient.post(`/governance/attestation-campaigns/campaigns/${campaignId}/escalation-chains`, data),
  deleteEscalationChain: (chainId: number) => apiClient.delete(`/governance/attestation-campaigns/escalation-chains/${chainId}`),
  exportCampaignReport: (id: number) => apiClient.get(`/governance/reports/campaigns/${id}/export-csv`, { responseType: 'blob' }),
};

export const committeeApi = {
  getCommittees: () => apiClient.get('/governance/committees'),
  getCommittee: (id: number) => apiClient.get(`/governance/committees/${id}`),
  createCommittee: (data: any) => apiClient.post('/governance/committees', data),
  updateCommittee: (id: number, data: any) => apiClient.put(`/governance/committees/${id}`, data),
  deleteCommittee: (id: number) => apiClient.delete(`/governance/committees/${id}`),
  getMembers: (committeeId: number) => apiClient.get(`/governance/committees/${committeeId}/members`),
  addMember: (committeeId: number, data: any) => apiClient.post(`/governance/committees/${committeeId}/members`, data),
  removeMember: (committeeId: number, userId: number) => apiClient.delete(`/governance/committees/${committeeId}/members/${userId}`),
  getCharters: (committeeId: number) => apiClient.get(`/governance/committees/${committeeId}/charters`),
  createCharter: (committeeId: number, data: any) => apiClient.post(`/governance/committees/${committeeId}/charters`, data),
  updateCharter: (charterId: number, data: any) => apiClient.put(`/governance/committees/charters/${charterId}`, data),
  deleteCharter: (committeeId: number, charterId: number) => apiClient.delete(`/governance/committees/${committeeId}/charters/${charterId}`),
  uploadCharterFile: (committeeId: number, charterId: number, formData: FormData) =>
    apiClient.post(`/governance/committees/${committeeId}/charters/${charterId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }),
  // Single-shot: takes a PDF/DOCX/TXT, creates a new charter with the
  // extracted text as content + the file saved alongside. Used by the
  // "Upload Charter" button placed before "AI Generate Charter".
  uploadNewCharter: (committeeId: number, file: File, opts?: { title?: string; version?: string; status?: string }) => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts?.title) fd.append('title', opts.title);
    if (opts?.version) fd.append('version', opts.version);
    if (opts?.status) fd.append('status_value', opts.status);
    return apiClient.post(`/governance/committees/${committeeId}/charters/upload-new`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  downloadCharterFile: (charterId: number) => 
    apiClient.get(`/governance/committees/charters/${charterId}/download`, { responseType: 'blob' }),
  aiGenerateCharter: (committeeId: number, frameworkIds?: number[]) => apiClient.post(`/governance/committees/${committeeId}/ai-generate-charter`, { framework_ids: frameworkIds || [] }),
  aiCompareCharter: (committeeId: number, data: { charter_id?: number; charter_text?: string }) =>
    apiClient.post(`/governance/committees/${committeeId}/ai-compare-charter`, data),
  getMeetings: (committeeId: number) => apiClient.get(`/governance/committees/${committeeId}/meetings`),
  createMeeting: (committeeId: number, data: any) => apiClient.post(`/governance/committees/${committeeId}/meetings`, data),
  getMeeting: (meetingId: number) => apiClient.get(`/governance/committees/meetings/${meetingId}`),
  updateMeeting: (meetingId: number, data: any) => apiClient.put(`/governance/committees/meetings/${meetingId}`, data),
  getAgenda: (meetingId: number) => apiClient.get(`/governance/committees/meetings/${meetingId}/agenda`),
  addAgendaItem: (meetingId: number, data: any) => apiClient.post(`/governance/committees/meetings/${meetingId}/agenda`, data),
  updateAgendaItem: (itemId: number, data: any) => apiClient.put(`/governance/committees/meetings/agenda/${itemId}`, data),
  // Upload PDF / DOCX / TXT agenda doc → backend extracts text +
  // heuristic-parses + AI fallback when needed → inserts MeetingAgendaItem rows.
  uploadAgendaForParse: (meetingId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiClient.post(`/governance/committees/meetings/${meetingId}/agenda/upload-parse`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // Voting on agenda items — each committee member can record one
  // agree / disagree / partial / abstain vote per item with optional
  // comment. Re-posting updates the existing vote (upsert).
  voteAgendaItem: (itemId: number, vote: 'agreed' | 'disagreed' | 'partial' | 'abstain', comment?: string) =>
    apiClient.post(`/governance/committees/meetings/agenda/${itemId}/votes`, { vote, comment }),
  listAgendaVotes: (itemId: number) =>
    apiClient.get<{
      total: number;
      tally: { agreed: number; disagreed: number; partial: number; abstain: number };
      my_vote: null | { vote: string; comment?: string };
      votes: Array<{ id: number; user_id: number; user_name: string; vote: string; comment?: string; voted_at: string }>;
    }>(`/governance/committees/meetings/agenda/${itemId}/votes`),
  deleteAgendaItem: (itemId: number) => apiClient.delete(`/governance/committees/meetings/agenda/${itemId}`),
  getMeetingAttachments: (meetingId: number) =>
    apiClient.get(`/governance/committees/meetings/${meetingId}/attachments`),
  uploadMeetingAttachment: (meetingId: number, formData: FormData) =>
    apiClient.post(`/governance/committees/meetings/${meetingId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  downloadMeetingAttachment: (attachmentId: number) =>
    apiClient.get(`/governance/committees/meetings/attachments/${attachmentId}/download`, { responseType: 'blob' }),
  deleteMeetingAttachment: (attachmentId: number) =>
    apiClient.delete(`/governance/committees/meetings/attachments/${attachmentId}`),
  createMinutes: (meetingId: number, data: any) => apiClient.post(`/governance/committees/meetings/${meetingId}/minutes`, data),
  updateMinutes: (minutesId: number, data: any) => apiClient.put(`/governance/committees/minutes/${minutesId}`, data),
  // Upload a PDF / DOCX / TXT minutes document — backend extracts the
  // text and stores it as the minutes content, dropping any previously
  // approved status back to draft so reviewers see the change.
  uploadMinutesDoc: (meetingId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiClient.post(`/governance/committees/meetings/${meetingId}/minutes/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  createAction: (meetingId: number, data: any) => apiClient.post(`/governance/committees/meetings/${meetingId}/actions`, data),
  createManualAction: (data: any) => apiClient.post('/governance/committees/actions/manual', data),
  getActions: (params?: { status?: string; committee_id?: number; overdue_only?: boolean }) => apiClient.get('/governance/committees/actions', { params }),
  updateAction: (actionId: number, data: any) => apiClient.patch(`/governance/committees/actions/${actionId}`, data),
  aiRewordActionText: (formData: FormData) =>
    apiClient.post('/governance/committees/actions/ai/reword', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  aiSummarizeActionText: (formData: FormData) =>
    apiClient.post('/governance/committees/actions/ai/summary', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getDashboard: () => apiClient.get('/governance/committees/dashboard'),
  getOverview: () => apiClient.get('/governance/committees/overview'),
  getSuggestedAgendaItems: (meetingId: number) => 
    apiClient.get(`/governance/committees/meetings/${meetingId}/suggested-agenda-items`),
  autoPopulateAgenda: (meetingId: number, data: { include_documents?: boolean; include_exceptions?: boolean; include_regulatory_changes?: boolean }) => 
    apiClient.post(`/governance/committees/meetings/${meetingId}/auto-populate-agenda`, data),
};

export interface QuickAssessRequest {
  evidence_name: string;
  file_name: string;
  file_type: string;
  description?: string;
  evidence_type?: string;
}

export interface QuickAssessResponse {
  initial_assessment: {
    relevance_estimate: 'high' | 'medium' | 'low';
    suggested_type: string;
    detected_frameworks: string[];
    suggested_controls: string[];
    quality_tips: string[];
    completeness_check: {
      has_date: boolean;
      has_version: boolean;
      has_approval: boolean;
    };
  };
}

export const evidenceAIApi = {
  quickAssess: async (data: QuickAssessRequest): Promise<QuickAssessResponse> => {
    const response = await apiClient.post<QuickAssessResponse>('/evidence-mgmt/ai/quick-assess', data);
    return response.data;
  },
};

export const controlLibraryApi = {
  // Groups Module
  groups: {
    getCategories: () => apiClient.get('/control-library/groups/categories'),
    getDomains: () => apiClient.get('/control-library/groups/domains'),
    getAll: (params?: { category?: string; domain?: string; search?: string; skip?: number; limit?: number }) =>
      apiClient.get('/control-library/groups', { params }),
    getById: (groupId: number) => apiClient.get(`/control-library/groups/${groupId}`),
    create: (data: { code: string; name: string; description?: string; category?: string; domain?: string; keywords?: string[]; evidence_types?: string[] }) =>
      apiClient.post('/control-library/groups', data),
    update: (groupId: number, data: { code?: string; name?: string; description?: string; category?: string; domain?: string; keywords?: string[]; evidence_types?: string[]; ai_summary?: string }) =>
      apiClient.put(`/control-library/groups/${groupId}`, data),
    delete: (groupId: number) => apiClient.delete(`/control-library/groups/${groupId}`),
    addControls: (groupId: number, data: { normalized_control_ids?: number[]; framework_control_ids?: number[]; parsed_control_ids?: number[] }) =>
      apiClient.post(`/control-library/groups/${groupId}/controls`, data),
    removeControl: (groupId: number, mappingId: number) =>
      apiClient.delete(`/control-library/groups/${groupId}/controls/${mappingId}`),
    autoGroup: (data?: { framework_ids?: number[] }) =>
      apiClient.post('/control-library/groups/auto-group', data || {}),
    getFrameworks: (groupId: number) => apiClient.get(`/control-library/groups/${groupId}/frameworks`),
    generateSummary: (groupId: number, data?: { regenerate_keywords?: boolean }) =>
      apiClient.post(`/control-library/groups/${groupId}/generate-summary`, data || { regenerate_keywords: true }),
    populateFromFrameworks: (groupId: number) =>
      apiClient.post(`/control-library/groups/${groupId}/populate-from-frameworks`),
    populateAllGroups: () => apiClient.post('/control-library/groups/populate-all-groups'),
    getSimilarities: (groupId: number) => apiClient.get(`/control-library/groups/${groupId}/similarities`),
  },

  // AI Mapping Module
  aiMapping: {
    getSimilarities: (params?: { source_type?: string; source_id?: number; min_score?: number; framework_id?: number; skip?: number; limit?: number }) =>
      apiClient.get('/control-library/ai-mapping/similarities', { params }),
    getAnalysis: (analysisId: number) => apiClient.get(`/control-library/ai-mapping/analysis/${analysisId}`),
    getSuggestions: (controlType: 'normalized' | 'framework', controlId: number) =>
      apiClient.get(`/control-library/ai-mapping/suggestions/${controlType}/${controlId}`),
    analyze: (data?: { framework_ids?: number[] }) =>
      apiClient.post('/control-library/ai-mapping/analyze', data || {}),
    analyzePair: (data: { source_type: string; source_control_id: number; target_type: string; target_control_id: number }) =>
      apiClient.post('/control-library/ai-mapping/analyze-pair', data),
    verifySimilarity: (similarityId: number, data: { verified: boolean; adjusted_score?: number }) =>
      apiClient.put(`/control-library/ai-mapping/similarities/${similarityId}/verify`, data),
  },

  // Inheritance Module
  inheritance: {
    getAll: (params?: { parent_type?: 'normalized' | 'framework'; parent_id?: number; child_type?: 'normalized' | 'framework'; inheritance_type?: 'full' | 'partial' | 'conditional'; skip?: number; limit?: number }) =>
      apiClient.get('/control-library/inheritance', { params }),
    getById: (inheritanceId: number) => apiClient.get(`/control-library/inheritance/${inheritanceId}`),
    getAsParent: (controlType: 'normalized' | 'framework', controlId: number) =>
      apiClient.get(`/control-library/inheritance/parent/${controlType}/${controlId}`),
    getAsChild: (controlType: 'normalized' | 'framework', controlId: number) =>
      apiClient.get(`/control-library/inheritance/child/${controlType}/${controlId}`),
    getTree: (controlType: 'normalized' | 'framework', controlId: number) =>
      apiClient.get(`/control-library/inheritance/tree/${controlType}/${controlId}`),
    create: (data: { parent_type: 'normalized' | 'framework'; parent_control_id: number; child_type: 'normalized' | 'framework'; child_control_id: number; inheritance_type: 'full' | 'partial' | 'conditional'; condition_description?: string; coverage_percentage?: number }) =>
      apiClient.post('/control-library/inheritance', data),
    analyzeInheritance: (data: { control_type: 'normalized' | 'framework'; control_id: number }) =>
      apiClient.post('/control-library/inheritance/analyze-inheritance', data),
    update: (inheritanceId: number, data: { inheritance_type?: 'full' | 'partial' | 'conditional'; condition_description?: string; coverage_percentage?: number }) =>
      apiClient.put(`/control-library/inheritance/${inheritanceId}`, data),
    delete: (inheritanceId: number) => apiClient.delete(`/control-library/inheritance/${inheritanceId}`),
  },

  // Evidence Recommendations Module
  evidenceRecs: {
    getAll: (params?: { group_id?: number; control_type?: string; control_id?: number; priority?: string; skip?: number; limit?: number }) =>
      apiClient.get('/control-library/evidence-recs', { params }),
    getEvidenceTypes: () => apiClient.get('/control-library/evidence-recs/evidence-types'),
    getPrioritySummary: () => apiClient.get('/control-library/evidence-recs/priority-summary'),
    getForControl: (controlType: 'normalized' | 'framework', controlId: number) =>
      apiClient.get(`/control-library/evidence-recs/for-control/${controlType}/${controlId}`),
    getForGroup: (groupId: number) => apiClient.get(`/control-library/evidence-recs/for-group/${groupId}`),
    generateForControl: (controlType: 'normalized' | 'framework', controlId: number) =>
      apiClient.post(`/control-library/evidence-recs/generate/${controlType}/${controlId}`),
    generateForGroup: (groupId: number) =>
      apiClient.post(`/control-library/evidence-recs/generate-for-group/${groupId}`),
    bulkGenerate: (data: { control_ids: Array<{ type: string; id: number }> }) =>
      apiClient.post('/control-library/evidence-recs/bulk-generate', data),
    update: (recommendationId: number, data: { evidence_type?: string; evidence_description?: string; priority?: string; sample_evidence_names?: string[] }) =>
      apiClient.put(`/control-library/evidence-recs/${recommendationId}`, data),
    delete: (recommendationId: number) => apiClient.delete(`/control-library/evidence-recs/${recommendationId}`),
  },

  // Gap Analysis Module
  gapAnalysis: {
    getUnmappedControls: (params?: { framework_id?: number; control_type?: 'normalized' | 'framework' | 'parsed'; skip?: number; limit?: number }) =>
      apiClient.get('/control-library/gap-analysis/unmapped-controls', { params }),
    getControlsWithoutEvidence: (params?: { framework_id?: number; control_type?: string; skip?: number; limit?: number }) =>
      apiClient.get('/control-library/gap-analysis/controls-without-evidence', { params }),
    getControlsWithLowCoverage: (params?: { threshold?: number; framework_id?: number; skip?: number; limit?: number }) =>
      apiClient.get('/control-library/gap-analysis/controls-with-low-coverage', { params }),
    getUnmappedSummary: () => apiClient.get('/control-library/gap-analysis/unmapped-summary'),
    getEvidenceGaps: (params?: { framework_id?: number; skip?: number; limit?: number }) =>
      apiClient.get('/control-library/gap-analysis/evidence-gaps', { params }),
    getFrameworkGaps: (frameworkId: number, params?: { framework_type?: 'legacy' | 'uploaded' }) =>
      apiClient.get(`/control-library/gap-analysis/framework-gaps/${frameworkId}`, { params }),
    getGroupGaps: (groupId: number) => apiClient.get(`/control-library/gap-analysis/group-gaps/${groupId}`),
    getDashboard: () => apiClient.get('/control-library/gap-analysis/dashboard'),
    export: (data?: { format?: 'json' | 'csv'; include_details?: boolean }) =>
      apiClient.post('/control-library/gap-analysis/export', data || {}),
    prioritizeWithAI: (data?: { framework_id?: number; max_gaps?: number }) =>
      apiClient.post('/control-library/gap-analysis/ai-prioritize', data || {}),
  },

  // Comparison Module
  comparison: {
    getFrameworks: () => apiClient.get('/control-library/comparison/frameworks'),
    getControls: (params: { framework_ids: number[]; category?: string; domain?: string; skip?: number; limit?: number }) =>
      apiClient.get('/control-library/comparison/controls', { params }),
    getGroup: (groupId: number) => apiClient.get(`/control-library/comparison/group/${groupId}`),
    getControl: (controlType: 'normalized' | 'framework', controlId: number) =>
      apiClient.get(`/control-library/comparison/control/${controlType}/${controlId}`),
    getDifferences: (controlType: 'normalized' | 'framework', controlId: number) =>
      apiClient.get(`/control-library/comparison/differences/${controlType}/${controlId}`),
    getMatrix: (params?: { framework_ids?: number[] }) =>
      apiClient.get('/control-library/comparison/matrix', { params }),
    // Positional parameter version for frontend compatibility
    getCrosswalk: (sourceFrameworkId: number, destFrameworkId: number, skip?: number, limit?: number) =>
      apiClient.get('/control-library/comparison/crosswalk', { 
        params: { source_framework_id: sourceFrameworkId, destination_framework_id: destFrameworkId, skip, limit } 
      }),
    sideBySide: (data: { control_pairs: Array<{ control1_type: string; control1_id: number; control2_type: string; control2_id: number }> }) =>
      apiClient.post('/control-library/comparison/side-by-side', data),
    exportComparison: (data: { framework_ids: number[]; format?: 'csv' | 'xlsx' }) =>
      apiClient.post('/control-library/comparison/export-comparison', data, { responseType: 'blob' }),
    // Positional parameter version for frontend compatibility
    aiMapControl: (sourceFrameworkId: number, destFrameworkId: number, sourceControlId: number) =>
      apiClient.post('/control-library/comparison/crosswalk/ai-map', null, {
        params: { source_framework_id: sourceFrameworkId, destination_framework_id: destFrameworkId, source_control_id: sourceControlId }
      }),

    // AI cross-framework comparison (Celery-backed, cached per pair)
    aiCompareLookup: (sourceFrameworkId: number, destFrameworkId: number) =>
      apiClient.get('/control-library/comparison/ai-compare/lookup', {
        params: { source_framework_id: sourceFrameworkId, dest_framework_id: destFrameworkId },
      }),
    aiCompareRun: (sourceFrameworkId: number, destFrameworkId: number, refresh = false) =>
      apiClient.post('/control-library/comparison/ai-compare/run', {
        source_framework_id: sourceFrameworkId,
        dest_framework_id: destFrameworkId,
        refresh,
      }),
    aiCompareStatus: (runId: number) =>
      apiClient.get(`/control-library/comparison/ai-compare/runs/${runId}`),
    aiCompareMappings: (runId: number) =>
      apiClient.get(`/control-library/comparison/ai-compare/runs/${runId}/mappings`),
    aiCompareList: () =>
      apiClient.get('/control-library/comparison/ai-compare/runs'),
  },

  // Coverage Module
  coverage: {
    getMatrix: () => apiClient.get('/control-library/coverage/matrix'),
    getByFramework: () => apiClient.get('/control-library/coverage/by-framework'),
    getByCategory: () => apiClient.get('/control-library/coverage/by-category'),
    getByDomain: () => apiClient.get('/control-library/coverage/by-domain'),
    getHeatmapData: () => apiClient.get('/control-library/coverage/heatmap-data'),
    getFrameworkCoverage: (frameworkId: number) => apiClient.get(`/control-library/coverage/framework/${frameworkId}`),
    getGroupCoverage: (groupId: number) => apiClient.get(`/control-library/coverage/group/${groupId}`),
    getEvidenceReuse: () => apiClient.get('/control-library/coverage/evidence-reuse'),
    getAuditSavings: () => apiClient.get('/control-library/coverage/audit-savings'),
    getTrends: (params?: { period?: 'weekly' | 'monthly' }) =>
      apiClient.get('/control-library/coverage/trends', { params }),
  },

  // Reports Module
  reports: {
    getHarmonization: () => apiClient.get('/control-library/reports/harmonization'),
    getFramework: (frameworkId: number) => apiClient.get(`/control-library/reports/framework/${frameworkId}`),
    getAuditReady: () => apiClient.get('/control-library/reports/audit-ready'),
    getCrossFrameworkMapping: () => apiClient.get('/control-library/reports/cross-framework-mapping'),
    getEvidenceRequirements: () => apiClient.get('/control-library/reports/evidence-requirements'),
    download: (reportId: string) => apiClient.get(`/control-library/reports/download/${reportId}`, { responseType: 'blob' }),
    getHistory: (params?: { skip?: number; limit?: number }) =>
      apiClient.get('/control-library/reports/history', { params }),
    export: (data?: { format?: 'xlsx' | 'csv'; framework_ids?: number[]; include_sections?: string[] }) =>
      apiClient.post('/control-library/reports/export', data || {}, { responseType: 'blob' }),
    generateExecutiveSummary: (data?: { include_recommendations?: boolean; focus_areas?: string[] }) =>
      apiClient.post('/control-library/reports/generate-executive-summary', data || {}),
  },
};

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  display_name: string;
  department?: string;
  group?: string;
  division?: string;
  designation?: string;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
  roles: { id: number; name: string }[];
}

export interface AdminRole {
  id: number;
  name: string;
  description: string;
  is_system_role: boolean;
  user_count: number;
  permissions: string[];
  created_at: string;
}

export interface OrganizationProfile {
  id: number | null;
  name: string;
  legal_entity?: string;
  industry?: string;
  company_size?: string;
  geography?: string;
  regulatory_scope?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  primary_contact_phone?: string;
  address?: string;
  website?: string;
  logo_url?: string;
  settings?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface PermissionModule {
  module: string;
  display_name: string;
  submodules: {
    name: string;
    display_name: string;
    actions: string[];
  }[];
}

export const adminApi = {
  getOrganization: () => apiClient.get<OrganizationProfile>('/admin/organization'),
  updateOrganization: (data: Partial<OrganizationProfile>) => 
    apiClient.put('/admin/organization', data),

  getUsers: () => apiClient.get<AdminUser[]>('/admin/users'),
  getUser: (id: number) => apiClient.get<AdminUser>(`/admin/users/${id}`),
  createUser: (data: { 
    username: string; 
    email: string; 
    password: string; 
    display_name?: string; 
    department?: string;
    group?: string;
    division?: string;
    designation?: string;
    role_ids?: number[] 
  }) => apiClient.post('/admin/users', data),
  updateUser: (id: number, data: { 
    display_name?: string; 
    email?: string; 
    department?: string;
    group?: string;
    division?: string;
    designation?: string;
    is_active?: boolean; 
    role_ids?: number[] 
  }) => apiClient.put(`/admin/users/${id}`, data),
  deleteUser: (id: number) => apiClient.delete(`/admin/users/${id}`),

  getRoles: () => apiClient.get<AdminRole[]>('/admin/roles'),
  getRole: (id: number) => apiClient.get<AdminRole>(`/admin/roles/${id}`),
  createRole: (data: { 
    name: string; 
    description?: string; 
    permission_names: string[] 
  }) => apiClient.post('/admin/roles', data),
  updateRole: (id: number, data: { 
    name?: string; 
    description?: string; 
    permission_names?: string[] 
  }) => apiClient.put(`/admin/roles/${id}`, data),
  deleteRole: (id: number) => apiClient.delete(`/admin/roles/${id}`),
  // Drill-down: returns the users assigned to a role with assignment metadata.
  // Used by the Role Management page's "view members" button.
  getRoleMembers: (id: number) =>
    apiClient.get<{
      role_id: number;
      role_name: string;
      member_count: number;
      members: Array<{
        user_id: number;
        username: string;
        email: string;
        display_name: string | null;
        is_active: boolean;
        assigned_at: string | null;
        assigned_by_user_id: number | null;
        user_role_id: number;
      }>;
    }>(`/admin/roles/${id}/members`),

  // Password / lockout policy ─ used by the Administration → Password Policy
  // page and by the dashboard's idle-timeout sentinel.
  getPasswordPolicy: () =>
    apiClient.get<{
      id: number;
      min_length: number;
      require_uppercase: boolean;
      require_lowercase: boolean;
      require_digit: boolean;
      require_special: boolean;
      lockout_threshold: number;
      lockout_minutes: number;
      session_idle_timeout_minutes: number;
      password_history_count: number;
      max_password_age_days: number;
      updated_at: string | null;
    }>('/admin/password-policy'),
  updatePasswordPolicy: (data: Record<string, unknown>) =>
    apiClient.put('/admin/password-policy', data),

  getPermissions: () => apiClient.get<{ name: string; module: string; submodule: string; action: string; description: string }[]>('/admin/permissions'),
  getPermissionMatrix: () => apiClient.get<PermissionModule[]>('/admin/permissions/matrix'),

  getAuditLogs: (params?: { limit?: number; offset?: number; action?: string; module?: string; user_id?: number; start_date?: string; end_date?: string }) =>
    apiClient.get('/admin/audit-logs', { params }),
  getAuditLogFilters: () => apiClient.get<{ actions: string[]; modules: string[]; date_presets: string[] }>('/admin/audit-logs/filters'),
  // v2 audit-AI: lazily generate (or fetch cached) a human-readable summary
  // for one audit-log row. Set force=true to bypass the server-side cache and
  // re-generate. Backend caches the result on the row's `changes.ai_summary`.
  generateAuditLogAiSummary: (logId: number, force = false) =>
    apiClient.post<{ ai_summary: string | null; cached: boolean; fallback: boolean }>(
      `/admin/audit-logs/${logId}/ai-summary`,
      { force },
    ),
};

export interface IdpConfig {
  configured?: boolean;
  connected?: boolean;
  id?: number;
  provider?: string;
  is_enabled?: boolean;
  // SaaS multi-tenant fields
  entra_directory_id?: string | null;
  connected_at?: string | null;
  // Preferences
  auto_provision_on_signin?: boolean;
  allowed_email_domains?: string[];
  // Connection-test status
  last_tested_at?: string | null;
  last_test_status?: string | null;
  last_test_message?: string | null;
  updated_at?: string | null;
}

export interface IdpConfigUpsert {
  is_enabled?: boolean;
  auto_provision_on_signin?: boolean;
  allowed_email_domains?: string[];
}

export interface IdpGroupMapping {
  id: number;
  entra_group_id: string;
  entra_group_name?: string | null;
  role_id: number;
  role_name?: string | null;
  created_at?: string | null;
}

export interface IdpGraphGroup {
  id: string;
  display_name: string;
}

export const ssoApi = {
  getConfig: () => apiClient.get<IdpConfig>('/sso/config'),
  updateConfig: (data: IdpConfigUpsert) => apiClient.put<IdpConfig>('/sso/config', data),
  deleteConfig: () => apiClient.delete<{ deleted: boolean }>('/sso/config'),
  testConfig: () => apiClient.post<{ ok: boolean; last_test_status: string; last_tested_at: string }>('/sso/config/test'),
  connectInit: () => apiClient.post<{ authorize_url: string }>('/sso/connect/init'),
  provisionUsers: () => apiClient.post<{ created: number; skipped: number; roles_applied: number }>('/sso/provision'),
  // Public-friendly: backend doesn't require auth, but the axios interceptor still attaches X-Tenant-Slug.
  getAvailability: () => apiClient.get<{ enabled: boolean }>('/sso/availability'),
  searchGroups: (q: string) =>
    apiClient.get<{ groups: IdpGraphGroup[] }>('/sso/graph/groups', { params: { q } }),
  listGroupMappings: () => apiClient.get<{ mappings: IdpGroupMapping[] }>('/sso/group-mappings'),
  createGroupMapping: (data: { entra_group_id: string; entra_group_name?: string; role_id: number }) =>
    apiClient.post<{ id: number; created?: boolean; duplicate?: boolean }>('/sso/group-mappings', data),
  deleteGroupMapping: (id: number) => apiClient.delete<{ deleted: boolean }>(`/sso/group-mappings/${id}`),
};

export const tenantAuthApi = {
  login: (data: { username: string; password: string }, subdomain: string) => 
    apiClient.post('/auth/tenant-login', data, { params: { subdomain } }),
  getMe: () => apiClient.get('/auth/tenant-me'),
  registerOrganization: (data: {
    email: string;
    password: string;
    display_name: string;
    organization_name: string;
    legal_entity?: string;
    industry?: string;
    regulatory_scope?: string;
    company_size?: string;
    geography?: string;
    primary_contact_phone?: string;
  }) => apiClient.post('/auth/register-organization', data),
};

export const integrationsApi = {
  listConnections: (params?: Record<string, unknown>) =>
    apiClient.get('/integrations/connections', { params }),
  getConnection: (id: number) =>
    apiClient.get(`/integrations/connections/${id}`),
  createConnection: (data: Record<string, unknown>) =>
    apiClient.post('/integrations/connections', data),
  updateConnection: (id: number, data: Record<string, unknown>) =>
    apiClient.put(`/integrations/connections/${id}`, data),
  deleteConnection: (id: number) =>
    apiClient.delete(`/integrations/connections/${id}`),
  testConnection: (id: number) =>
    apiClient.post(`/integrations/connections/${id}/test`),
  triggerSync: (id: number) =>
    apiClient.post(`/integrations/connections/${id}/sync`),
  getSyncHistory: (id: number, params?: Record<string, unknown>) =>
    apiClient.get(`/integrations/connections/${id}/history`, { params }),
  getAuditLog: (id: number, params?: Record<string, unknown>) =>
    apiClient.get(`/integrations/connections/${id}/audit-log`, { params }),

  listExceptions: (params?: Record<string, unknown>) =>
    apiClient.get('/integrations/exceptions', { params }),
  getException: (id: number) =>
    apiClient.get(`/integrations/exceptions/${id}`),
  createException: (data: Record<string, unknown>) =>
    apiClient.post('/integrations/exceptions', data),
  approveException: (id: number, data: Record<string, unknown>) =>
    apiClient.post(`/integrations/exceptions/${id}/approve`, data),
  rejectException: (id: number, data: Record<string, unknown>) =>
    apiClient.post(`/integrations/exceptions/${id}/reject`, data),
  revokeException: (id: number, data: Record<string, unknown>) =>
    apiClient.post(`/integrations/exceptions/${id}/revoke`, data),
  withdrawException: (id: number) =>
    apiClient.post(`/integrations/exceptions/${id}/withdraw`),

  recalculateVulnScore: (vulnId: number) =>
    apiClient.post(`/integrations/scoring/recalculate/${vulnId}`),
  batchRecalculateScores: (params?: Record<string, unknown>) =>
    apiClient.post('/integrations/scoring/batch-recalculate', {}, { params }),

  assignSLADeadlines: (params?: Record<string, unknown>) =>
    apiClient.post('/integrations/sla/assign-deadlines', {}, { params }),
  getSLABreaches: () =>
    apiClient.get('/integrations/sla/breaches'),
  sendSLANotifications: () =>
    apiClient.post('/integrations/sla/send-notifications'),

  autoMapControls: (vulnId: number, params?: Record<string, unknown>) =>
    apiClient.post(`/integrations/control-mapping/auto-map/${vulnId}`, {}, { params }),
  batchMapControls: (params?: Record<string, unknown>) =>
    apiClient.post('/integrations/control-mapping/batch-map', {}, { params }),

  analyticsOverview: (params?: Record<string, unknown>) =>
    apiClient.get('/integrations/analytics/overview', { params }),
  analyticsTrends: (params?: Record<string, unknown>) =>
    apiClient.get('/integrations/analytics/trends', { params }),
  analyticsMTTR: (params?: Record<string, unknown>) =>
    apiClient.get('/integrations/analytics/mttr', { params }),
  analyticsSLACompliance: (params?: Record<string, unknown>) =>
    apiClient.get('/integrations/analytics/sla-compliance', { params }),
  analyticsTopAssets: (params?: Record<string, unknown>) =>
    apiClient.get('/integrations/analytics/top-assets', { params }),
  analyticsScannerCoverage: (params?: Record<string, unknown>) =>
    apiClient.get('/integrations/analytics/scanner-coverage', { params }),
  analyticsConnectionStats: (params?: Record<string, unknown>) =>
    apiClient.get('/integrations/analytics/connection-stats', { params }),
};

export const workflowEngineApi = {
  definitions: {
    list: (params?: Record<string, unknown>) => apiClient.get('/workflow-engine/definitions', { params }),
    getById: (id: number) => apiClient.get(`/workflow-engine/definitions/${id}`),
    create: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/definitions', data),
    update: (id: number, data: Record<string, unknown>) => apiClient.put(`/workflow-engine/definitions/${id}`, data),
    delete: (id: number) => apiClient.delete(`/workflow-engine/definitions/${id}`),
    listVersions: (id: number) => apiClient.get(`/workflow-engine/definitions/${id}/versions`),
    rollback: (id: number, versionId: number) => apiClient.post(`/workflow-engine/definitions/${id}/rollback/${versionId}`),
  },
  executions: {
    trigger: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/executions/trigger', data),
    listInstances: (params?: Record<string, unknown>) => apiClient.get('/workflow-engine/executions/instances', { params }),
    getInstance: (id: number) => apiClient.get(`/workflow-engine/executions/instances/${id}`),
    resumeInstance: (id: number) => apiClient.post(`/workflow-engine/executions/instances/${id}/resume`),
    decideApproval: (approvalRequestId: number, data: Record<string, unknown>) => apiClient.post(`/workflow-engine/executions/approvals/${approvalRequestId}/decision`, data),
    inbox: (params?: Record<string, unknown>) => apiClient.get('/workflow-engine/executions/approvals/inbox', { params }),
  },
  catalog: {
    nodeTypes: () => apiClient.get('/workflow-engine/catalog/node-types'),
    nodeConfigOptions: () => apiClient.get('/workflow-engine/catalog/node-config-options'),
    nodeParamSchemas: () => apiClient.get('/workflow-engine/catalog/node-param-schemas'),
    lookup: (entity: string, q?: string) => apiClient.get(`/workflow-engine/catalog/lookup/${encodeURIComponent(entity)}`, { params: q ? { q } : {} }),
    templatesLibrary: () => apiClient.get('/workflow-engine/catalog/templates/library'),
    integrationPoints: () => apiClient.get('/workflow-engine/catalog/integrations'),
    users: (params?: Record<string, unknown>) => apiClient.get('/workflow-engine/catalog/actors/users', { params }),
    roles: () => apiClient.get('/workflow-engine/catalog/actors/roles'),
  },
  templates: {
    list: (params?: Record<string, unknown>) => apiClient.get('/workflow-engine/templates', { params }),
    create: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/templates', data),
    instantiate: (templateId: number, name?: string) => apiClient.post(`/workflow-engine/templates/${templateId}/instantiate`, undefined, {
      params: name ? { name } : {},
    }),
  },
  links: {
    list: (params?: Record<string, unknown>) => apiClient.get('/workflow-engine/links', { params }),
    create: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/links', data),
    delete: (id: number) => apiClient.delete(`/workflow-engine/links/${id}`),
  },
  escalationConfigs: {
    list: () => apiClient.get('/workflow-engine/escalation-configs'),
    create: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/escalation-configs', data),
    update: (id: number, data: Record<string, unknown>) => apiClient.patch(`/workflow-engine/escalation-configs/${id}`, data),
    delete: (id: number) => apiClient.delete(`/workflow-engine/escalation-configs/${id}`),
  },
  integrations: {
    listSchedules: () => apiClient.get('/workflow-engine/integrations/schedules'),
    createSchedule: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/integrations/schedules', data),
    listWebhooks: () => apiClient.get('/workflow-engine/integrations/webhooks'),
    createWebhook: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/integrations/webhooks', data),
    publishExternal: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/integrations/events/publish-external', data),
  },
  analytics: {
    overview: (params?: Record<string, unknown>) => apiClient.get('/workflow-engine/analytics/overview', { params }),
    bottlenecks: (params?: Record<string, unknown>) => apiClient.get('/workflow-engine/analytics/bottlenecks', { params }),
    liveStatus: (params?: Record<string, unknown>) => apiClient.get('/workflow-engine/analytics/live-status', { params }),
  },
  ai: {
    suggestions: () => apiClient.get('/workflow-engine/ai/suggestions'),
    naturalLanguage: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/ai/natural-language', data),
    optimize: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/ai/optimize', data),
    intelligentRouting: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/ai/intelligent-routing', data),
    anomalies: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/ai/anomalies', data),
  },
  events: {
    publish: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/events/publish', data),
  },
  notifications: {
    checkSetup: () => apiClient.get('/workflow-engine/notifications/check-setup'),
    listEmailConfigs: () => apiClient.get('/workflow-engine/notifications/email-config'),
    createEmailConfig: (data: Record<string, unknown>) => apiClient.post('/workflow-engine/notifications/email-config', data),
    updateEmailConfig: (id: number, data: Record<string, unknown>) => apiClient.patch(`/workflow-engine/notifications/email-config/${id}`, data),
    testEmailConfig: (id: number, testEmail: string) =>
      apiClient.post(`/workflow-engine/notifications/email-config/${id}/test`, undefined, { params: { test_email: testEmail } }),
  },
};

// ── Issue Management ────────────────────────────────────────────────────
// CRUD + transitions + linkages + CAPA + matrices for the Issues module
// (sibling to Critical Tasks). Backend at /issue-management/*.
/**
 * Inline-linkage payload for `POST /issue-management/issues`. Each list is
 * optional; the backend silently drops unknown / cross-tenant ids so a
 * malformed pick never blocks the create. Controls have two paths —
 * `linked_internal_control_ids` is the common case the IssueForm uses;
 * `linked_controls` is the polymorphic escape hatch for framework /
 * parsed / normalized control links.
 */
export type IssueCreateLinkages = {
  linked_vulnerability_ids?: number[];
  linked_risk_ids?: number[];
  linked_asset_ids?: number[];
  linked_evidence_ids?: number[];
  linked_vendor_ids?: number[];
  linked_is_project_ids?: number[];
  linked_governance_document_ids?: number[];
  linked_policy_statement_ids?: number[];
  linked_internal_control_ids?: number[];
  linked_controls?: Array<{
    target_type: 'framework' | 'parsed' | 'normalized' | 'internal';
    control_id: number;
  }>;
  linked_task_ids?: number[];
};

export const issuesApi = {
  list: (params?: {
    search?: string;
    severity?: string;
    workflow_state?: string;
    issue_type?: string;
    category?: string;
    assignee_id?: number;
    source_type?: string;
    sla_breached?: boolean;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    skip?: number;
    limit?: number;
  }) => apiClient.get('/issue-management/issues', { params }),
  get: (id: number) => apiClient.get(`/issue-management/issues/${id}`),
  create: (body: Record<string, unknown>) =>
    apiClient.post('/issue-management/issues', body),
  patch: (id: number, body: Record<string, unknown>) =>
    apiClient.patch(`/issue-management/issues/${id}`, body),
  transition: (id: number, body: { to_state: string; notes?: string }) =>
    apiClient.post(`/issue-management/issues/${id}/transition`, body),
  close: (id: number, body: { closure_notes: string }) =>
    apiClient.post(`/issue-management/issues/${id}/close`, body),
  reopen: (id: number, body: { reason: string }) =>
    apiClient.post(`/issue-management/issues/${id}/reopen`, body),
  delete: (id: number) => apiClient.delete(`/issue-management/issues/${id}`),

  // "Create Issue from <upstream>" — used by the +button on vuln/risk/asset/control detail pages.
  fromSource: (body: {
    source_type:
      | 'vulnerability' | 'risk' | 'asset'
      | 'control_framework' | 'control_parsed' | 'control_normalized' | 'control_internal'
      // v2 — governance + policy source types accepted by /issues/from-source
      | 'governance_document' | 'policy_statement';
    source_id: number;
    title?: string;
    description?: string;
    impact?: string;
    urgency?: string;
    severity_override?: string;
    severity_override_reason?: string;
    category?: string;
    issue_type?: string;
    owner_id?: number;
    assignee_id?: number;
  }) => apiClient.post('/issue-management/issues/from-source', body),

  actions: {
    listForIssue: (issueId: number) =>
      apiClient.get(`/issue-management/issues/${issueId}/actions`),
    create: (issueId: number, body: Record<string, unknown>) =>
      apiClient.post(`/issue-management/issues/${issueId}/actions`, body),
    listAll: (params?: { status_filter?: string; action_type?: string; assignee_id?: number }) =>
      apiClient.get('/issue-management/actions', { params }),
    patch: (actionId: number, body: Record<string, unknown>) =>
      apiClient.patch(`/issue-management/actions/${actionId}`, body),
    verify: (actionId: number, body: { effectiveness_review_at?: string; notes?: string }) =>
      apiClient.post(`/issue-management/actions/${actionId}/verify`, body),
    delete: (actionId: number) =>
      apiClient.delete(`/issue-management/actions/${actionId}`),
    // v2 — promote a CAPA action into the Critical Tasks register; returns
    // {task_id, code, already_linked}.
    promoteToTask: (actionId: number, body?: { title?: string; description?: string; priority?: string; sla_days?: number }) =>
      apiClient.post(`/issue-management/actions/${actionId}/promote-to-task`, body || {}),
  },

  links: {
    vulns: {
      list: (issueId: number) => apiClient.get(`/issue-management/issues/${issueId}/links/vulns`),
      add: (issueId: number, body: { vulnerability_id: number; notes?: string }) =>
        apiClient.post(`/issue-management/issues/${issueId}/links/vulns`, body),
      remove: (issueId: number, vulnId: number) =>
        apiClient.delete(`/issue-management/issues/${issueId}/links/vulns/${vulnId}`),
    },
    risks: {
      list: (issueId: number) => apiClient.get(`/issue-management/issues/${issueId}/links/risks`),
      add: (issueId: number, body: { risk_id: number; link_type?: string; notes?: string }) =>
        apiClient.post(`/issue-management/issues/${issueId}/links/risks`, body),
      remove: (issueId: number, riskId: number) =>
        apiClient.delete(`/issue-management/issues/${issueId}/links/risks/${riskId}`),
    },
    assets: {
      list: (issueId: number) => apiClient.get(`/issue-management/issues/${issueId}/links/assets`),
      add: (issueId: number, body: { asset_id: number; notes?: string }) =>
        apiClient.post(`/issue-management/issues/${issueId}/links/assets`, body),
      remove: (issueId: number, assetId: number) =>
        apiClient.delete(`/issue-management/issues/${issueId}/links/assets/${assetId}`),
    },
    controls: {
      list: (issueId: number) => apiClient.get(`/issue-management/issues/${issueId}/links/controls`),
      add: (issueId: number, body: {
        target_type: 'framework' | 'parsed' | 'normalized' | 'internal';
        control_id: number;
        link_type?: string;
        notes?: string;
      }) => apiClient.post(`/issue-management/issues/${issueId}/links/controls`, body),
      remove: (issueId: number, linkId: number) =>
        apiClient.delete(`/issue-management/issues/${issueId}/links/controls/${linkId}`),
    },
    evidence: {
      list: (issueId: number) => apiClient.get(`/issue-management/issues/${issueId}/links/evidence`),
      add: (issueId: number, body: { evidence_id: number; relationship_type?: string; notes?: string }) =>
        apiClient.post(`/issue-management/issues/${issueId}/links/evidence`, body),
      remove: (issueId: number, evidenceId: number) =>
        apiClient.delete(`/issue-management/issues/${issueId}/links/evidence/${evidenceId}`),
    },
    vendors: {
      list: (issueId: number) => apiClient.get(`/issue-management/issues/${issueId}/links/vendors`),
      add: (issueId: number, body: { vendor_id: number; contract_reference?: string; breach_clause?: string; notes?: string }) =>
        apiClient.post(`/issue-management/issues/${issueId}/links/vendors`, body),
      remove: (issueId: number, vendorId: number) =>
        apiClient.delete(`/issue-management/issues/${issueId}/links/vendors/${vendorId}`),
    },
    // v2 — new linkage families.
    projects: {
      list: (issueId: number) => apiClient.get(`/issue-management/issues/${issueId}/links/projects`),
      add: (issueId: number, body: { is_project_id: number; role?: string; notes?: string }) =>
        apiClient.post(`/issue-management/issues/${issueId}/links/projects`, body),
      remove: (issueId: number, projectId: number) =>
        apiClient.delete(`/issue-management/issues/${issueId}/links/projects/${projectId}`),
    },
    governance: {
      list: (issueId: number) => apiClient.get(`/issue-management/issues/${issueId}/links/governance`),
      add: (issueId: number, body: { target_type: 'governance_document' | 'policy_statement'; target_id: number; link_type?: string; notes?: string }) =>
        apiClient.post(`/issue-management/issues/${issueId}/links/governance`, body),
      remove: (issueId: number, linkId: number) =>
        apiClient.delete(`/issue-management/issues/${issueId}/links/governance/${linkId}`),
    },
  },

  // v2 — reverse-direction lookup: "what issues are linked to <entity>?".
  // Used by the shared <RelatedIssuesPanel> component dropped onto every
  // detail page in the platform.
  bySource: (sourceType: string, sourceId: number, includeClosed = false) =>
    apiClient.get(`/issue-management/by-source/${sourceType}/${sourceId}`, {
      params: { include_closed: includeClosed },
    }),

  // v2 — per-tenant automation toggles (KRI red breach, overdue mitigation,
  // governance review fast-forward, control evidence rejected). All default
  // OFF so v1 behaviour is preserved until the tenant opts in.
  automationFlags: {
    get: () => apiClient.get('/issue-management/automation-flags'),
    update: (body: Partial<{
      refresh_document_review: boolean;
      kri_red_breach: boolean;
      overdue_mitigation: boolean;
      control_evidence_rejected: boolean;
      all_enabled: boolean;
    }>) => apiClient.put('/issue-management/automation-flags', body),
  },

  comments: {
    list: (issueId: number) => apiClient.get(`/issue-management/issues/${issueId}/comments`),
    create: (issueId: number, body: { body: string; parent_id?: number }) =>
      apiClient.post(`/issue-management/issues/${issueId}/comments`, body),
  },
  activity: {
    list: (issueId: number, limit = 100) =>
      apiClient.get(`/issue-management/issues/${issueId}/activity`, { params: { limit } }),
  },

  dashboard: () => apiClient.get('/issue-management/dashboard/aggregate'),

  matrices: {
    getSeverity: () => apiClient.get('/issue-management/matrices/severity'),
    putSeverityCell: (impact: string, urgency: string, body: { severity: string; sla_ack_hours: number; sla_resolve_hours: number }) =>
      apiClient.put(`/issue-management/matrices/severity/${impact}/${urgency}`, body),
    getClassification: () => apiClient.get('/issue-management/matrices/classification'),
    putClassificationCell: (issueType: string, severity: string, body: {
      default_owner_team_id?: number | null;
      default_owner_user_id?: number | null;
      response_sla_hours?: number | null;
      escalation_sla_hours?: number | null;
    }) => apiClient.put(`/issue-management/matrices/classification/${issueType}/${severity}`, body),
  },
};

// =============================================================================
// CIS Integration — Compliance Plugins, Risk Posture, Agents, Onboarding
// All endpoints live under /grc and are tenant-scoped server-side. Purely
// additive: no existing api group is changed.
// =============================================================================

export const compliancePluginsApi = {
  list: (params?: Record<string, unknown>) => apiClient.get('/compliance-plugins', { params }),
  get: (id: number) => apiClient.get(`/compliance-plugins/${id}`),
  benchmarks: () => apiClient.get('/compliance-plugins/benchmarks'),
  seed: () => apiClient.post('/compliance-plugins/seed'),
  execute: (pluginId: number, data: { asset_id?: number; connection_id?: number; manual_result?: string; manual_note?: string }) =>
    apiClient.post(`/compliance-plugins/${pluginId}/runs`, data),
  listRuns: (params?: Record<string, unknown>) => apiClient.get('/compliance-plugins/runs', { params }),
  getRun: (runId: number) => apiClient.get(`/compliance-plugins/runs/${runId}`),
  createControlMapping: (pluginId: number, data: Record<string, unknown>) =>
    apiClient.post(`/compliance-plugins/${pluginId}/control-mappings`, data),
  listControlMappings: (pluginId: number) =>
    apiClient.get(`/compliance-plugins/${pluginId}/control-mappings`),
  scanAll: (data: Record<string, unknown> = {}) =>
    apiClient.post('/compliance-plugins/scan-all', {}, { params: data }),
  perUserSummary: () => apiClient.get('/compliance-plugins/per-user-summary'),
  assetsOverview: () => apiClient.get('/compliance-plugins/assets-overview'),
  perAssetCoverage: (assetId: number) =>
    apiClient.get('/compliance-plugins/per-asset-coverage', { params: { asset_id: assetId } }),
  reviewBulk: (pluginIds: number[], decision: 'approve' | 'reject') =>
    apiClient.post('/compliance-plugins/review-bulk', { plugin_ids: pluginIds, decision }),
  updateSchedule: (pluginId: number, cron: string | null) =>
    apiClient.patch(`/compliance-plugins/${pluginId}/schedule`, { schedule_cron: cron }),
  getAssetScope: (pluginId: number) => apiClient.get(`/compliance-plugins/${pluginId}/asset-scope`),
  updateAssetScope: (pluginId: number, mode: 'all' | 'include' | 'exclude', assetIds: number[]) =>
    apiClient.put(`/compliance-plugins/${pluginId}/asset-scope`, { mode, asset_ids: assetIds }),
  ingestPdf: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    // The apiClient instance defaults Content-Type to application/json.
    // For multipart uploads we MUST clear that so axios falls back to its
    // FormData branch and emits the correct
    // 'multipart/form-data; boundary=...' header. Setting it to undefined
    // (not a string) is the documented way to delete a default header on
    // a per-request basis. Long parser timeout (synchronous PDF→OCR).
    return apiClient.post('/compliance-plugins/ingest', fd, {
      headers: { 'Content-Type': undefined },
      timeout: 5 * 60 * 1000,
    });
  },
  listIngestJobs: () => apiClient.get('/compliance-plugins/ingest'),
  getIngestJob: (jobId: number) => apiClient.get(`/compliance-plugins/ingest/${jobId}`),
  reparseIngestJob: (jobId: number) => apiClient.post(`/compliance-plugins/ingest/${jobId}/reparse`),
  deleteIngestJob: (jobId: number) => apiClient.delete(`/compliance-plugins/ingest/${jobId}`),
  getReviewQueue: (params?: { ingest_job_id?: number }) =>
    apiClient.get('/compliance-plugins/review-queue', { params }),
  reviewPlugin: (
    pluginId: number,
    decision: 'approve' | 'reject',
    patch?: {
      check_definition?: Record<string, unknown>;
      runner_type?: string;
      severity?: string;
      title?: string;
      description?: string | null;
      rationale?: string | null;
      remediation?: string | null;
    },
  ) => apiClient.post(`/compliance-plugins/${pluginId}/review`, { decision, ...(patch || {}) }),
  importJson: (plugins: unknown[], autoApprove = false) =>
    apiClient.post('/compliance-plugins/import-json', { plugins, auto_approve: autoApprove }),

  // ─── CIS Phase 4 backend additions ────────────────────────────────────
  // Wrappers for the 18 new endpoints surfaced by the compliance_plugins
  // router merge: benchmark-mappings CRUD, library-tree navigation, OS
  // registry, match-preview, classify-stream, normalise-os, connection
  // scope-preview + persistence, asset OS re-detection, benchmark promote.

  /** List integration connections this user can scan against, grouped by category. */
  listConnections: () => apiClient.get('/compliance-plugins/connections'),
  /** Preview which assets a scope would cover BEFORE saving it. */
  previewConnectionScope: (connectionId: number, body: Record<string, unknown>) =>
    apiClient.post(`/compliance-plugins/connections/${connectionId}/scope-preview`, body),
  /** Persist the scope (which assets to scan via this connection). */
  updateConnectionScope: (connectionId: number, body: Record<string, unknown>) =>
    apiClient.put(`/compliance-plugins/connections/${connectionId}/scope`, body),

  /** Hierarchical library: vendor → product → benchmark → rule. */
  libraryTree: (params?: Record<string, unknown>) =>
    apiClient.get('/compliance-plugins/library-tree', { params }),
  /** Section-level breakdown for one benchmark. */
  libraryTreeBenchmarkSections: (params?: Record<string, unknown>) =>
    apiClient.get('/compliance-plugins/library-tree/benchmark-sections', { params }),
  /** Rule-target counts per (benchmark, runner_type). */
  libraryTreeRuleTargets: (params?: Record<string, unknown>) =>
    apiClient.get('/compliance-plugins/library-tree/rule-targets', { params }),
  /** Positional-arg aliases — the CIS-merged Library / per-plugin pages
   *  call these by benchmark name / rule id. Kept alongside the
   *  params-dict variants above for back-compat. */
  benchmarkSections: (benchmark: string) =>
    apiClient.get('/compliance-plugins/library-tree/benchmark-sections', { params: { benchmark } }),
  ruleTargets: (ruleId: number) =>
    apiClient.get('/compliance-plugins/library-tree/rule-targets', { params: { rule_id: ruleId } }),

  /** Canonical OS taxonomy used by the strict-match table. */
  osRegistry: () => apiClient.get('/compliance-plugins/os-registry'),
  /** Coerce a free-form OS string into the canonical normalized form. */
  normaliseOs: (raw: string) =>
    apiClient.post('/compliance-plugins/normalise-os', { os: raw }),
  /** Re-probe and re-store an asset's OS profile (uses os_detector under the hood). */
  reDetectOs: (assetId: number) =>
    apiClient.post(`/compliance-plugins/assets/${assetId}/re-detect-os`),

  /** What benchmark would match this OS pattern right now? */
  matchPreview: (params: { os_normalized?: string; asset_id?: number } | number) =>
    typeof params === 'number'
      ? apiClient.get('/compliance-plugins/match-preview', { params: { asset_id: params } })
      : apiClient.get('/compliance-plugins/match-preview', { params }),
  /** Re-trigger OS detection on an asset (probes via WinRM / SSH / etc).
   *  Used by the Compliance tab's "Re-detect OS" button to refresh the
   *  AI Classification block + recompute matched benchmark count. */
  reDetectAssetOs: (assetId: number) =>
    apiClient.post(`/compliance-plugins/assets/${assetId}/re-detect-os`, {}),

  // ── Benchmark-OS mappings (strict-single-stage matcher) ──
  listBenchmarkMappings: () =>
    apiClient.get('/compliance-plugins/benchmark-mappings'),
  /** AI-assisted mapping suggestions for the unmapped OS patterns. */
  suggestBenchmarkMapping: (params?: Record<string, unknown>) =>
    apiClient.get('/compliance-plugins/benchmark-mappings/suggest', { params }),
  /** Per-asset suggestion (one row picked for one asset's os_normalized). */
  suggestBenchmarkMappingForAsset: (assetId: number) =>
    apiClient.get(`/compliance-plugins/benchmark-mappings/suggest-for-asset/${assetId}`),
  /** Same endpoint, package-style alias used by the Compliance tab's
   *  NoMappingCallout component. Kept alongside the longer name for
   *  back-compat with other callers. */
  suggestMappingForAsset: (assetId: number) =>
    apiClient.get(`/compliance-plugins/benchmark-mappings/suggest-for-asset/${assetId}`),
  createBenchmarkMapping: (body: Record<string, unknown>) =>
    apiClient.post('/compliance-plugins/benchmark-mappings', body),
  deleteBenchmarkMapping: (mappingId: number) =>
    apiClient.delete(`/compliance-plugins/benchmark-mappings/${mappingId}`),

  /** Promote a benchmark to "active" version (archives older same-product
   *  benchmarks + flips active mapping rows). Operator action. */
  promoteBenchmark: (body: Record<string, unknown>) =>
    apiClient.post('/compliance-plugins/benchmarks/promote', body),

  /** SSE stream of OS-classification progress for a batch of assets. */
  classifyStreamUrl: '/compliance-plugins/classify-stream',
  /** Classification stats (passed/failed/skipped counts per OS family). */
  classificationStats: () =>
    apiClient.get('/compliance-plugins/classification-stats'),
};

// ─── CIS Phase 3 agent installer + scan-push helpers ─────────────────────
// agentsApi already exists elsewhere in this file; these helpers wrap the
// new per-OS installer endpoints + scan-now-push the backend ships with
// the agents/router.py merge. Kept as a sibling export so the InstallerButtons
// component on /admin/agents can call them with type safety.
export const agentsCisApi = {
  /** Stream the per-OS installer .cmd / .sh / .command as a binary
   *  download. Caller is responsible for turning the response into a
   *  Blob + triggering the browser download (see InstallerButtons in
   *  /admin/agents/page.tsx). Pass `fleet=1` + `expires_hours` to mint
   *  a multi-host fleet token. */
  downloadInstaller: (
    ext: 'cmd' | 'sh' | 'command',
    params: Record<string, string | number>,
  ) => apiClient.get(`/agents/installer.${ext}`, { params, responseType: 'blob' }),

  /** Skip the agent's 30s heartbeat tick — next /jobs poll returns the
   *  asset's full rule batch immediately. */
  scanNowPush: (assetId: number) =>
    apiClient.post(`/agents/scan-now-push/${assetId}`),
};

// ─── CIS Connect Wizard handshake API ────────────────────────────────────
// Used by the ConnectWizard.tsx page (translated to Next.js at
// /connect-wizard) to mint a one-time token, poll status, and complete
// the handshake when the bank's installer / collector dials home with
// stored credentials.
export const connectWizardApi = {
  issueToken: (body: Record<string, unknown>) =>
    apiClient.post('/connect-wizard/issue-token', body),
  status: (nonce: string) =>
    apiClient.get(`/connect-wizard/status/${nonce}`),
  /** Plain-text Windows install snippet streamed under the token URL. */
  windowsScript: (token: string) =>
    apiClient.get(`/connect-wizard/windows/${token}`, { responseType: 'text' }),
  /** Plain-text Linux install snippet. */
  linuxScript: (token: string) =>
    apiClient.get(`/connect-wizard/linux/${token}`, { responseType: 'text' }),
  /** Final handshake — installer POSTs creds, server stores them
   *  encrypted + auto-creates the asset record + probes the OS. */
  handshake: (body: Record<string, unknown>) =>
    apiClient.post('/connect-wizard/handshake', body),
};

export const riskPostureApi = {
  dashboard: () => apiClient.get('/risk-posture/dashboard'),
  asset: (assetId: number) => apiClient.get(`/risk-posture/asset/${assetId}`),
  /** v2 live-preview: send proposed Business Context toggles and get
   *  back what the asset's risk score WOULD be without persisting.
   *  Used by the asset detail page's Live Preview pane so the operator
   *  can see the score impact before clicking Save. */
  previewAsset: (assetId: number, body: Record<string, unknown>) =>
    apiClient.post(`/risk-posture/asset/${assetId}/preview`, body),
  getWeights: () => apiClient.get('/risk-posture/weights'),
  updateWeights: (data: {
    weight_cis: number;
    weight_vuln: number;
    weight_cia: number;
    weight_ctrl: number;
    weight_risk: number;
    preset_name?: string;
  }) => apiClient.put('/risk-posture/weights', data),
};

export const agentsApi = {
  list: () => apiClient.get('/agents'),
  enroll: (data: { agent_name: string; mode?: 'collector' | 'endpoint'; asset_id?: number; os_family?: string }) =>
    apiClient.post('/agents', data),
  bulkEnroll: (data: {
    hosts: Array<{ hostname: string; mode?: 'collector' | 'endpoint'; os_family?: string; asset_id?: number }>;
    backend_url?: string;
  }) => apiClient.post('/agents/bulk-enroll', data),
  revoke: (agentId: number, reason?: string) =>
    apiClient.post(`/agents/${agentId}/revoke${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`),
};

export const onboardingApi = {
  discover: (data: { cidr: string; runner_type?: string; port_override?: number; timeout_s?: number }) =>
    apiClient.post('/onboarding/discover', data),
  bulkImport: (data: {
    runner_type: string;
    asset_type?: string;
    criticality?: string;
    asset_name_prefix?: string;
    username: string;
    password: string;
    port?: number;
    hosts: Array<{ ip: string; hostname?: string | null; asset_name?: string | null }>;
  }) => apiClient.post('/onboarding/import', data),
};

export default apiClient;
