// Reviewers per section of a supplier's questionnaire, and comments on its answers (signed-in side).

import { apiClient } from '@/lib/api';
import type { Sent, SupplierMessage } from './requestsApi';

export type ReviewStatus = 'assigned' | 'in_review' | 'done';

export interface ReviewSection { key: string; label: string; questions: string[]; undecided: number }

export interface ReviewAssignment {
  id: number; section_key: string | null; section_label: string;
  reviewer: { id: number; name: string | null }; status: ReviewStatus;
  undecided: number;                       // questions of its section still without a decision
  note: string | null; assigned_by: string | null; assigned_at: string | null;
  started_at: string | null; done_at: string | null;
  mine: boolean; can_act: boolean;         // can_act: the reviewer, the TPRM lead or an administrator
}

export interface Reviewers { sections: ReviewSection[]; assignments: ReviewAssignment[]; lead: boolean }

const base = (responseId: number) => `/vendor-risk/questionnaire-responses/${responseId}/reviewers`;

export const reviewsApi = {
  reviewers: (responseId: number) => apiClient.get<Reviewers>(base(responseId)),
  /** No section: the whole questionnaire. */
  assign: (responseId: number, data: { reviewer_id: number; section_key: string | null }) =>
    apiClient.post<ReviewAssignment>(base(responseId), data),
  setStatus: (responseId: number, id: number, status: 'in_review' | 'done') =>
    apiClient.put<ReviewAssignment>(`${base(responseId)}/${id}`, { status }),
  unassign: (responseId: number, id: number) => apiClient.delete(`${base(responseId)}/${id}`),
  /** Planning's count of different reviewers, and how many the tier needs: the stage gate's own facts. */
  planning: (assessmentId: number) =>
    apiClient.get<{ assigned: number; required: number; roles: string[] }>(`/vendor-risk/assessments/${assessmentId}/reviewers`),
  /** Every question's comments on a questionnaire, internal and shared. */
  comments: (vendorId: number, responseId: number) =>
    apiClient.get<{ items: SupplierMessage[] }>(`/vendor-risk/vendors/${vendorId}/messages`,
      { params: { subject_type: 'questionnaire', subject_id: responseId } }),
  /** A shared comment is emailed to the supplier and shows on the question in the portal. */
  comment: (vendorId: number, data: { subject_id: number; question_key: string; visibility: 'internal' | 'shared'; body: string }) =>
    apiClient.post<SupplierMessage & { sent: Sent[] }>(`/vendor-risk/vendors/${vendorId}/messages`,
      { subject_type: 'questionnaire', ...data }),
};

export const reviewersKey = (responseId: number) => ['tpra-reviewers', responseId];
export const commentsKey = (responseId: number) => ['tpra-question-comments', responseId];

/** A question's section, read as the server reads it (tpra/reviews.py section_of). */
export function sectionKey(q: { section?: string | null; category?: string | null; domain?: string | null }): string {
  const key = String(q.section || q.category || q.domain || 'general').trim().toLowerCase().split(/[\s_]+/).join(' ');
  return key.slice(0, 100) || 'general';
}

export const sectionLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
