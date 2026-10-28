// A supplier's contacts and their personal links to the supplier portal (signed-in side).

import { apiClient } from '@/lib/api';

export const CONTACT_ROLES = ['primary', 'security', 'privacy', 'commercial', 'legal', 'technical', 'billing'] as const;
export type ContactRole = typeof CONTACT_ROLES[number];

export interface SupplierContact {
  id: number | null;                       // null: the contact on the supplier record, not written yet
  source: 'contact' | 'supplier record';
  vendor_id: number; name: string; email: string | null; phone: string | null; job_title: string | null;
  roles: ContactRole[]; is_primary: boolean; portal_access: boolean; notes: string | null;
  last_portal_at: string | null; archived_at: string | null;
}

export interface PortalLink {
  id: number; contact: { id: number; name: string | null; email: string | null };
  purpose: 'invite' | 'reminder' | 'request' | 'questionnaire';
  created_at: string; created_by: string | null; expires_at: string; last_used_at: string | null; use_count: number;
  revoked_at: string | null; revoked_by: string | null; active: boolean;
}

export type ContactFields = Partial<Pick<SupplierContact, 'name' | 'email' | 'phone' | 'job_title' | 'roles' |
  'is_primary' | 'portal_access' | 'notes'>>;

export const portalApi = {
  contacts: (vendorId: number, includeArchived = false) =>
    apiClient.get<{ items: SupplierContact[] }>(`/vendor-risk/vendors/${vendorId}/contacts`,
      { params: { include_archived: includeArchived } }),
  addContact: (vendorId: number, data: ContactFields) =>
    apiClient.post<SupplierContact>(`/vendor-risk/vendors/${vendorId}/contacts`, data),
  updateContact: (vendorId: number, id: number, data: ContactFields) =>
    apiClient.put<SupplierContact>(`/vendor-risk/vendors/${vendorId}/contacts/${id}`, data),
  archiveContact: (vendorId: number, id: number) => apiClient.post(`/vendor-risk/vendors/${vendorId}/contacts/${id}/archive`),
  restoreContact: (vendorId: number, id: number) => apiClient.post(`/vendor-risk/vendors/${vendorId}/contacts/${id}/restore`),
  /** A fresh personal link: emailed, and in the answer once. */
  issueLink: (vendorId: number, id: number, data: { send_email: boolean; expires_in_days?: number }) =>
    apiClient.post<{ id: number; link: string; expires_at: string; emailed: boolean }>(
      `/vendor-risk/vendors/${vendorId}/contacts/${id}/portal-link`, data),
  links: (vendorId: number) => apiClient.get<{ items: PortalLink[] }>(`/vendor-risk/vendors/${vendorId}/portal-links`),
  revokeLink: (id: number) => apiClient.post<PortalLink>(`/vendor-risk/portal-links/${id}/revoke`),
  revokeAll: (vendorId: number) => apiClient.post<{ revoked: number }>(`/vendor-risk/vendors/${vendorId}/portal-links/revoke-all`),
};

/** The server gives a relative link when the app's address is not configured. */
export const absoluteLink = (link: string) =>
  link.startsWith('/') && typeof window !== 'undefined' ? `${window.location.origin}${link}` : link;
