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
  RiskAuditFindingLink,
  LikelihoodImpactScale,
  GovernanceDocument,
  GovernanceDocumentVersion,
  DocumentApprovalStep,
  GovernanceDashboard,
} from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  (config) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
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
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const frameworksApi = {
  getAll: () => apiClient.get<Framework[]>('/frameworks'),
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
  uploadRiskRegister: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<{ message: string; created: number; skipped: number; errors: string[] }>('/risks/upload', formData, {
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
  create: (data: {
    name: string;
    description?: string;
    asset_type: string;
    owner_id?: number;
    criticality?: string;
    confidentiality_rating?: number;
    integrity_rating?: number;
    availability_rating?: number;
    valuation?: number;
    vendor?: string;
    location?: string;
  }) => apiClient.post<ITAsset>('/assets', data),
  update: (id: number, data: Partial<ITAsset>) => apiClient.put<ITAsset>(`/assets/${id}`, data),
  delete: (id: number) => apiClient.delete(`/assets/${id}`),
  linkFrameworkControl: (id: number, data: {framework_control_id: number, coverage_status?: string}) => 
    apiClient.post(`/assets/${id}/link-framework-control`, data),
  unlinkFrameworkControl: (id: number, linkId: number) => 
    apiClient.delete(`/assets/${id}/link-framework-control/${linkId}`),
  linkEvidence: (id: number, data: {evidence_id: number, relationship_type?: string}) => 
    apiClient.post(`/assets/${id}/link-evidence`, data),
  unlinkEvidence: (id: number, linkId: number) => 
    apiClient.delete(`/assets/${id}/link-evidence/${linkId}`),
  getCoverageAnalysis: (id: number) => apiClient.get(`/assets/${id}/coverage-analysis`),
  assessRisk: (id: number) => apiClient.post(`/assets/${id}/assess`),
};

export const certificationsApi = {
  getAll: (params?: { status?: string; framework_id?: number }) => 
    apiClient.get('/certifications', { params }),
  getById: (id: number) => apiClient.get(`/certifications/${id}`),
  getFrameworkPhases: (frameworkId: number) => apiClient.get(`/certifications/frameworks/${frameworkId}/phases`),
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
};

export const ermApi = {
  risks: {
    getAll: () => apiClient.get<Risk[]>('/erm/risks'),
    getById: (id: number) => apiClient.get<Risk>(`/erm/risks/${id}`),
    getDetail: (id: number) => apiClient.get<RiskDetail>(`/erm/risks/${id}/detail`),
    getDashboard: () => apiClient.get<RiskDashboard>('/erm/risks/dashboard'),
    getHeatmap: (riskType?: string) => apiClient.get<HeatmapCell[]>(`/erm/risks/heatmap${riskType ? `?risk_type=${riskType}` : ''}`),
    create: (data: Partial<Risk>) => apiClient.post<Risk>('/erm/risks', data),
    update: (id: number, data: Partial<Risk>) => apiClient.put<Risk>(`/erm/risks/${id}`, data),
    delete: (id: number) => apiClient.delete(`/erm/risks/${id}`),
    uploadRiskRegister: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.post<{ message: string; created: number; skipped: number; errors: string[] }>('/erm/risks/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    closeRisk: (riskId: number, notes: string) => 
      apiClient.post<Risk>(`/erm/risks/${riskId}/close`, { notes }),
    reopenRisk: (riskId: number) => 
      apiClient.post<Risk>(`/erm/risks/${riskId}/reopen`),
    getRiskAging: () => 
      apiClient.get<Array<{ risk_id: number; title: string; days_open: number; status: string }>>('/erm/risks/aging'),
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
  },
  auditFindings: {
    link: (riskId: number, issueId: number, notes?: string) => 
      apiClient.post<RiskAuditFindingLink>(`/erm/risks/${riskId}/audit-findings`, { issue_id: issueId, notes }),
    unlink: (riskId: number, linkId: number) => 
      apiClient.delete(`/erm/risks/${riskId}/audit-findings/${linkId}`),
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
  },
  incidents: {
    getAll: (params?: { risk_id?: number; severity?: string; status_filter?: string; start_date?: string; end_date?: string }) => 
      apiClient.get<RiskIncident[]>('/erm/incidents', { params }),
    getById: (id: number) => apiClient.get<RiskIncident>(`/erm/incidents/${id}`),
    create: (data: RiskIncidentCreate) => apiClient.post<RiskIncident>('/erm/incidents', data),
    update: (id: number, data: RiskIncidentUpdate) => apiClient.put<RiskIncident>(`/erm/incidents/${id}`, data),
    delete: (id: number) => apiClient.delete(`/erm/incidents/${id}`),
    getDashboard: () => apiClient.get<IncidentDashboard>('/erm/incidents/dashboard'),
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
    seedDefaults: (tenantId: number) => 
      apiClient.post(`/erm/appetite/seed-defaults?tenant_id=${tenantId}`),
  },
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

export default apiClient;
