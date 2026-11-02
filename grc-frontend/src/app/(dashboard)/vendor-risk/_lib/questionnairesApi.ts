// Questionnaire templates: the list, the builder, archive, copy, and the tiers one is sent to by default
// (backend: vendor_risk/routers/questionnaires.py). The rules of the builder are in ./questionnaires/model.ts.

import { apiClient } from '@/lib/api';
import type { Question, Template } from './questionnaires/types';

export type { Question, Template } from './questionnaires/types';

export const LIST_HREF = '/vendor-risk/questionnaires';
/** The builder is at /questionnaires/<id>/builder, not /questionnaires/<id>: that address is the supplier's public link (<token>),
 *  and two pages cannot share it. */
export const builderHref = (id: number) => `${LIST_HREF}/${id}/builder`;

/** Every page that shows templates refreshes from this one key. */
export const templatesKey = ['tprm-questionnaire-templates'] as const;
export const templateKey = (id: number) => ['tprm-questionnaire-template', id] as const;

/** What a save may change. `default_tiers` is the tier policy's own list (Settings edits the same one). */
export interface TemplateChange {
  name?: string;
  description?: string;
  category?: string;
  questions?: Question[];
  default_tiers?: string[];
}

const BASE = '/vendor-risk/questionnaire-templates';

export const questionnairesApi = {
  /** All of the organisation's templates; archived ones only on request. */
  list: (includeArchived: boolean) =>
    apiClient.get<{ items: Template[]; total: number }>(BASE, { params: { include_archived: includeArchived, limit: 500 } }),
  get: (id: number) => apiClient.get<Template>(`${BASE}/${id}`),
  create: (data: { name: string; description?: string; category?: string; questions: Question[] }) =>
    apiClient.post<Template>(BASE, data),
  update: (id: number, data: TemplateChange) => apiClient.put<Template>(`${BASE}/${id}`, data),
  archive: (id: number) => apiClient.post<Template>(`${BASE}/${id}/archive`),
  restore: (id: number) => apiClient.post<Template>(`${BASE}/${id}/restore`),
  duplicate: (id: number) => apiClient.post<Template>(`${BASE}/${id}/duplicate`),
  /** Only a template that was never sent can go; the server says so otherwise. */
  remove: (id: number) => apiClient.delete(`${BASE}/${id}`),
  /** The onboarding questions, which are what a tier is worked out from (edited in Settings). */
  onboardingQuestions: () =>
    apiClient.get<{ sections: Array<{ key: string; title: string; questions: Array<{ key: string }> }> }>('/vendor-risk/intake/questions'),
};
