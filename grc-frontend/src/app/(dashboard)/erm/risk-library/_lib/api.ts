import { apiClient } from '@/lib/api';
import type { LibraryRisk, Proposal, Suggestion } from './model';

export interface LibraryFramework { key: string; name: string; version?: string | null; families: number; objectives: number; risks: number }
export interface Facets {
  families: { id: string; name: string; kind: string; count: number }[];
  objectives: { id: string; family_id: string; title: string; count: number }[];
}
export interface LibraryList {
  framework: LibraryFramework | null;
  frameworks: LibraryFramework[];
  items: LibraryRisk[];
  total: number;
  skip: number;
  limit: number;
  in_register_total: number;
  facets: Facets;
  /** The organisation's own copy of the framework the library comes from; null when it has not installed it (nothing can be linked). */
  installed_framework: { id: number; name: string } | null;
}
export interface AddedRisk {
  risk: { id: number; title: string; category: string; status: string; inherent_score: number | null; priority: string | null };
  linked_controls: string[];
  controls_not_installed: string[];
  library_risk: LibraryRisk;
  proposal: Proposal;
}
export interface Suggestions { unit: { id: number; name: string }; framework: LibraryFramework | null; items: Suggestion[]; total: number }

const proposalUrl = (id: number, action: string) => `/erm/risk-library/proposals/${id}/${action}`;

export const riskLibraryApi = {
  list: (params: Record<string, string | number | boolean>) =>
    apiClient.get<LibraryList>('/erm/risk-library', { params }).then((r) => r.data),
  people: () => apiClient.get<{ items: { id: number; name: string }[] }>('/erm/risk-library/people').then((r) => r.data.items),
  add: (id: string, body: Record<string, unknown>) =>
    apiClient.post<AddedRisk>(`/erm/risk-library/${encodeURIComponent(id)}/add-to-register`, body).then((r) => r.data),
  units: () => apiClient.get<{ items: { id: number; name: string }[] }>('/erm/risk-library/units').then((r) => r.data.items),
  suggestions: (unitId: number, framework?: string) =>
    apiClient.get<Suggestions>('/erm/risk-library/suggestions', { params: { business_unit_id: unitId, limit: 100, ...(framework ? { framework } : {}) } })
      .then((r) => r.data),
  propose: (id: string, body: Record<string, unknown>) =>
    apiClient.post<Proposal>(`/erm/risk-library/${encodeURIComponent(id)}/propose`, body).then((r) => r.data),
  proposals: () => apiClient.get<{ items: Proposal[] }>('/erm/risk-library/proposals').then((r) => r.data.items),
  proposal: (id: number) => apiClient.get<Proposal>(`/erm/risk-library/proposals/${id}`).then((r) => r.data),
  draft: (id: number, body: Record<string, unknown>) => apiClient.post<Proposal>(proposalUrl(id, 'draft'), body).then((r) => r.data),
  decline: (id: number, reason: string) => apiClient.post<Proposal>(proposalUrl(id, 'decline'), { reason }).then((r) => r.data),
  accept: (id: number, comment: string) => apiClient.post<Proposal>(proposalUrl(id, 'accept'), { comment }).then((r) => r.data),
  sendBack: (id: number, comment: string) => apiClient.post<Proposal>(proposalUrl(id, 'return'), { comment }).then((r) => r.data),
};
