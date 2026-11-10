// The calls a supplier's questionnaire makes. `base` is the questionnaire's path, which differs by how the supplier got in
// (a contact's personal link, or a questionnaire's own link sent before those); everything under it has the same shape.
// No sign-in: the link is the key.

import apiClient from '@/lib/api';
import type { EvidenceFile, PortalQuestion } from './answerLogic';
import type { Change } from './answerSaver';
import { actionText, canRetry } from './portalProblem';

export interface QuestionMessage { id: number; from_supplier: boolean; author: string | null; body: string; created_at: string }
export interface Attestation { name: string; title: string; email: string }

export interface QuestionnaireData {
  questionnaire_id: number;
  title?: string | null;
  organisation?: string | null;
  vendor_name: string | null;
  respondent_name: string | null;
  respondent_email: string | null;
  status: string;
  expires_at: string | null;
  due_date: string | null;
  submitted_at?: string | null;
  questions: PortalQuestion[];
  existing_responses: Record<string, unknown>;
  comments: Record<string, string>;
  clarifications: Record<string, string | null>;
  attestation: { name: string | null; title: string | null; email: string | null };
  certificate: { name: string; mode: string; expires: string | null } | null;
  evidence: Record<string, EvidenceFile[]>;
  messages?: Record<string, QuestionMessage[]>;     // in the supplier portal: the comments shared on each question
}

/** A refusal's reason when the server gave one in words, else `fallback` (the address and busy cases are said the same way on every public page). */
export const messageOf = (e: unknown, fallback = 'That did not save.'): string => actionText(e, fallback);
export { canRetry };

const file = (name: string, f: File, extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.append(name, f);
  Object.entries(extra).forEach(([k, v]) => { if (v) form.append(k, v); });
  return form;
};
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export const portalCalls = {
  load: (base: string) => apiClient.get<QuestionnaireData>(base),
  /** One answer and its note; an empty value clears the answer. A save that hangs fails after 30 s, so it does not hold up the rest. */
  saveAnswer: (base: string, id: string, change: Change) =>
    apiClient.put(`${base}/answers/${encodeURIComponent(id)}`, { value: change.value, comment: change.comment }, { timeout: 30000 }),
  /** Sending needs no answers in the request: what is saved is what is checked. */
  send: (base: string, who: Attestation) =>
    apiClient.post<{ status: string; submitted_at: string | null }>(base, {
      respondent_name: who.name, respondent_email: who.email, attestation: { ...who, confirm: true }, submit: true,
    }),
  evidence: (base: string) => apiClient.get<Record<string, EvidenceFile[]>>(`${base}/evidence`),
  upload: (base: string, id: string, f: File, expiresOn: string) =>
    apiClient.post(`${base}/evidence/${encodeURIComponent(id)}`, file('file', f, { expires_on: expiresOn }), multipart),
  removeFile: (base: string, fileId: number) => apiClient.delete(`${base}/evidence/${fileId}`),
  reply: (base: string, id: string, body: string) =>
    apiClient.post<QuestionMessage>(`${base}/messages`, { question_key: id, body }),
  /** The questionnaire as a workbook or a fillable PDF, to answer offline. */
  download: (base: string, as: 'xlsx' | 'pdf') =>
    apiClient.get(`${base}/${as === 'pdf' ? 'pdf' : 'workbook'}`, { responseType: 'blob' }),
  importFile: (base: string, f: File) => apiClient.post(`${base}/workbook`, file('file', f), multipart),
};
