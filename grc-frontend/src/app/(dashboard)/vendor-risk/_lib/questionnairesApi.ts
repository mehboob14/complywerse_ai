// Questionnaire templates: the list, the builder, archive, copy, and the tiers one is sent to by default
// (backend: vendor_risk/routers/questionnaires.py). The rules of the builder are in ./questionnaires/model.ts.

import { apiClient } from '@/lib/api';
import type { SentAnswer, SentDetail } from './questionnaires/sentModel';
import type { VendorOptions } from './questionnaires/sharedModel';
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
  /** the stamp of the questionnaire as this person last saw it: a different one on the server means someone else saved first, and the save is refused (409) */
  expected_updated_at?: string | null;
}

/** What the Sent tab reads and what a change refreshes: the list, one questionnaire opened in the drawer, the suppliers a picker offers, the exchange. */
export const SENT_KEY = 'tprm-sent-questionnaires';
export const SENT_ONE_KEY = 'tprm-sent-questionnaire';
export const VENDOR_OPTIONS_KEY = 'tprm-vendor-options';
export const SHARED_KEY = 'tpra-shared';
const RESPONSES = '/vendor-risk/questionnaire-responses';

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
  /** Everything sent, as the Sent tab reads it: one lean row each, newest first, read whole (the server's cap is 5,000 and `total` says when it is more). */
  sent: (limit = 5000) => apiClient.get<SentAnswer>(RESPONSES, { params: { lean: 1, limit } }),
  /** One sent questionnaire with its answers and the questions it was sent on, read when its drawer opens. */
  sentOne: (id: number) => apiClient.get<SentDetail>(`${RESPONSES}/${id}`),
  /** The suppliers a picker offers: every supplier in use by name, or (with an active assessment) the ones the exchange can publish. */
  vendorOptions: (params: { with_assessment?: boolean; limit?: number } = {}) =>
    apiClient.get<VendorOptions>('/vendor-risk/vendor-options', { params: { limit: params.limit ?? 5000, ...(params.with_assessment ? { with_assessment: 1 } : {}) } }),
  /** The onboarding questions, which are what a tier is worked out from (edited in Settings). */
  onboardingQuestions: () =>
    apiClient.get<{ sections: Array<{ key: string; title: string; questions: Array<{ key: string }> }> }>('/vendor-risk/intake/questions'),
};
