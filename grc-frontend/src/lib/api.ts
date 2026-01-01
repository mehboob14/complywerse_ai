import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import {
  Framework,
  Control,
  Evidence,
  Risk,
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
  getById: (id: string) => apiClient.get<Risk>(`/risks/${id}`),
  create: (data: Partial<Risk>) => apiClient.post<Risk>('/risks', data),
  update: (id: string, data: Partial<Risk>) => apiClient.put<Risk>(`/risks/${id}`, data),
  delete: (id: string) => apiClient.delete(`/risks/${id}`),
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
  getById: (id: string) => apiClient.get<ITAsset>(`/assets/${id}`),
  create: (data: Partial<ITAsset>) => apiClient.post<ITAsset>('/assets', data),
  update: (id: string, data: Partial<ITAsset>) => apiClient.put<ITAsset>(`/assets/${id}`, data),
  delete: (id: string) => apiClient.delete(`/assets/${id}`),
};

export const certificationsApi = {
  getAll: (params?: { status?: string; framework_id?: number }) => 
    apiClient.get('/certifications', { params }),
  getById: (id: number) => apiClient.get(`/certifications/${id}`),
  getFrameworkPhases: (frameworkId: number) => apiClient.get(`/grc/certifications/frameworks/${frameworkId}/phases`),
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
