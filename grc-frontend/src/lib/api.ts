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

const getTenantSlugFromHost = (): string | null => {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return null;
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
      } else if (host !== 'localhost' && host !== '127.0.0.1') {
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
      }>('/controls/ai-recommendations', data),
  getFrameworkControlsSummary: () => apiClient.get('/controls/framework-controls/summary'),
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
  getAll: () => apiClient.get<ITAsset[]>('/assets'),
  getById: (id: number) => apiClient.get<ITAsset>(`/assets/${id}`),
  getDetail: (id: number) => apiClient.get(`/assets/${id}/detail`),
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
  getSecurityComplianceControls: (
    id: number,
    params?: {
      search?: string;
      sort_by?: 'control_id' | 'title' | 'level' | 'section';
      sort_order?: 'asc' | 'desc';
      level?: string;
      section?: string;
      selected_only?: boolean;
      skip?: number;
      limit?: number;
    }
  ) => apiClient.get(`/assets/${id}/security-compliance/controls`, { params }),
  getSecurityComplianceSelections: (id: number) =>
    apiClient.get(`/assets/${id}/security-compliance/selections`),
  addSecurityComplianceSelections: (id: number, controlIds: string[]) =>
    apiClient.post(`/assets/${id}/security-compliance/selections`, { control_ids: controlIds }),
  removeSecurityComplianceSelection: (id: number, controlId: string) =>
    apiClient.delete(`/assets/${id}/security-compliance/selections/${encodeURIComponent(controlId)}`),
  getCoverageAnalysis: (id: number) => apiClient.get(`/assets/${id}/coverage-analysis`),
  assessRisk: (id: number) => apiClient.post(`/assets/${id}/assess`),
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
  
  uploadEvidence: (journeyId: number, controlId: number, formData: FormData) => 
    apiClient.post(`/certifications/${journeyId}/controls/${controlId}/evidence`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }),
  assessEvidence: (journeyId: number, controlId: number, evidenceId: number) => 
    apiClient.post(`/certifications/${journeyId}/controls/${controlId}/evidence/${evidenceId}/assess`),
  reviewEvidence: (journeyId: number, controlId: number, evidenceId: number, data: { action: string; notes?: string }) => 
    apiClient.post(`/certifications/${journeyId}/controls/${controlId}/evidence/${evidenceId}/review`, data),
  
  getProgress: (id: number) => apiClient.get(`/certifications/${id}/progress`),
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
    closeRisk: (riskId: number, notes: string) => 
      apiClient.post<Risk>(`/erm/risks/${riskId}/close`, { notes }),
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
    getDashboard: () => apiClient.get('/erm/risk-assessments/dashboard'),
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
    getById: (id: number) => apiClient.get(`/erm/framework-risk-assessments/${id}`),
    create: (data: Record<string, unknown>) => apiClient.post('/erm/framework-risk-assessments', data),
    update: (id: number, data: Record<string, unknown>) => apiClient.put(`/erm/framework-risk-assessments/${id}`, data),
    delete: (id: number) => apiClient.delete(`/erm/framework-risk-assessments/${id}`),
    generateQuestions: (id: number, data?: { count?: number; replace_existing?: boolean }) =>
      apiClient.post(`/erm/framework-risk-assessments/${id}/generate-questions`, data || {}),
    addQuestion: (id: number, data: Record<string, unknown>) =>
      apiClient.post(`/erm/framework-risk-assessments/${id}/questions`, data),
    updateQuestion: (assessmentId: number, questionId: number, data: Record<string, unknown>) =>
      apiClient.put(`/erm/framework-risk-assessments/${assessmentId}/questions/${questionId}`, data),
    moveQuestionToRiskRegister: (assessmentId: number, questionId: number, data?: Record<string, unknown>) =>
      apiClient.post(`/erm/framework-risk-assessments/${assessmentId}/questions/${questionId}/move-to-risk-register`, data || {}),
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
    }) =>
      apiClient.get('/vuln-management/vulnerabilities', {
        params: params ? {
          status_filter: params.status,
          severity: params.severity,
          report_id: params.report_id,
          search: params.search,
          include_closed: params.include_closed,
          closed_only: params.closed_only,
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
    // Trend series + report download for the overview "intuitive graphs"
    // section. `period` accepts "60d", "90d", "quarter", "180d", "365d".
    // `bucket` is auto-resolved by the backend; pass to override.
    getTrends: (params?: { period?: string; bucket?: 'day' | 'week' | 'month'; tenant_id?: number }) =>
      apiClient.get('/vuln-management/dashboard/trends', { params }),
    downloadReport: (params?: { period?: string; bucket?: 'day' | 'week' | 'month'; fmt?: 'pdf' | 'text' }) =>
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
  updateAgendaItem: (itemId: number, data: any) => apiClient.put(`/governance/committees/agenda/${itemId}`, data),
  createMinutes: (meetingId: number, data: any) => apiClient.post(`/governance/committees/meetings/${meetingId}/minutes`, data),
  updateMinutes: (minutesId: number, data: any) => apiClient.put(`/governance/committees/minutes/${minutesId}`, data),
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

  getPermissions: () => apiClient.get<{ name: string; module: string; submodule: string; action: string; description: string }[]>('/admin/permissions'),
  getPermissionMatrix: () => apiClient.get<PermissionModule[]>('/admin/permissions/matrix'),

  getAuditLogs: (params?: { limit?: number; offset?: number; action?: string; module?: string; user_id?: number; start_date?: string; end_date?: string }) => 
    apiClient.get('/admin/audit-logs', { params }),
  getAuditLogFilters: () => apiClient.get<{ actions: string[]; modules: string[]; date_presets: string[] }>('/admin/audit-logs/filters'),
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

export default apiClient;
