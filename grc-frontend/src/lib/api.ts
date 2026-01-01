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
  linkAsset: (id: number, data: Record<string, unknown>) => apiClient.post(`/risks/${id}/assets`, data),
  linkEvidence: (id: number, data: Record<string, unknown>) => apiClient.post(`/risks/${id}/evidence`, data),
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

export default apiClient;
