// The calls of the Intake page and of Shadow SaaS (backend vendor_risk/tpra/onboarding.py and shadow_saas.py).
// The request questions themselves stay with IntakeForm (_lib/intake/); these are the cards, the request dialog,
// the decisions, and the two Shadow SaaS additions (record an app by hand, link it to a supplier we already have).

import { apiClient } from '@/lib/api';
import type { RequestStatus } from './intake/types';

export type Urgency = 'low' | 'normal' | 'high';
export type Screening = 'flagged' | 'screened';

/** Something already on record that a request may be (name or website), as the server screens it. */
export interface Duplicate {
  id: number;
  name: string;
  /** a sentence that starts in lower case: "the name matches once case, punctuation and company endings are ignored" */
  reason: string;
  match: 'name' | 'website' | 'both';
  archived: boolean;
  status: string | null;
  /** set when the match is itself a request (draft, submitted, in review, approved, declined) */
  intake_status: RequestStatus | null;
}

export interface Decision { by: string | null; at: string | null; reason: string | null }

export interface RequestRow {
  id: number; name: string; website: string | null; host: string;
  intake_status: RequestStatus; vendor_status: string | null; tier: string | null; tiered: boolean;
  requested_by: { id: number; name: string | null } | null; owner: { id: number; name: string | null } | null;
  submitted_at: string | null; created_at: string | null; updated_at: string | null;
  stage: { key: string; label: string | null } | null; open_problems: number;
  department: string | null; urgency: Urgency; purpose: string | null; data_shared: string[];
  /** null once a request is decided: only one still open is screened */
  screening: Screening | null; duplicates: Duplicate[]; duplicate_of: number | null;
  decision: Decision | null;
}

export interface RequestListing {
  items: RequestRow[];
  counts: Record<RequestStatus, number>;
  can_create: boolean;
  can_review: boolean;
}

export interface NewRequest {
  name: string;
  website?: string;
  department?: string;
  urgency?: Urgency;
  /** what they will do for us: the answer to the purpose question */
  intended_use?: string;
}

/** The part of a request that is not a question (saved with the answers). */
export interface RequestFields { department: string | null; urgency: Urgency; engagement: string | null }

export const requestsKey = ['tprm-requests'] as const;

export const intakeApi = {
  list: (params: { scope: 'all' | 'mine'; search?: string }) =>
    apiClient.get<RequestListing>('/vendor-risk/intake/requests', { params }),
  /** The request is filed even when it may already be on record: `duplicates` says what it may be. */
  create: (body: NewRequest) =>
    apiClient.post<{ id: number; duplicates: Duplicate[] }>('/vendor-risk/intake/requests', body),
  /** "Approve and create": the supplier's lifecycle starts, and the first engagement is made when the request named one. */
  approve: (id: number) =>
    apiClient.post<{ intake_status: RequestStatus; engagement_id: number | null }>(`/vendor-risk/vendors/${id}/intake/review`),
  decline: (id: number, reason: string) => apiClient.post(`/vendor-risk/vendors/${id}/intake/reject`, { reason }),
  sendBack: (id: number, reason: string) => apiClient.post(`/vendor-risk/vendors/${id}/intake/return`, { reason }),
  /** Save as you go: only what is sent changes. */
  save: (id: number, body: {
    answers?: Record<string, unknown>; justifications?: Record<string, string>;
    vendor?: Record<string, unknown>; request?: Partial<RequestFields>;
  }) => apiClient.put(`/vendor-risk/vendors/${id}/intake`, body),
};

// ── Shadow SaaS ──────────────────────────────────────────────────────────────

export interface VendorHit { id: number; name: string; website: string | null; tier: string | null }

export const shadowApi = {
  /** An app someone knows is in use, entered by hand (source "manual"). */
  record: (body: { name: string; users?: number | null; domain?: string }) =>
    apiClient.post('/vendor-risk/shadow-saas', body),
  /** The app is a supplier we already have: settles it as "Already ours". */
  link: (id: number, vendorId: number, note?: string) =>
    apiClient.post(`/vendor-risk/shadow-saas/${id}/link`, { vendor_id: vendorId, note: note || undefined }),
  /** The register's own search, for the picker. */
  vendors: (search: string) =>
    apiClient.get<{ items: VendorHit[] }>('/vendor-risk/vendors', { params: { search: search || undefined, limit: 8 } }),
};
