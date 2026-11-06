// Requests to a supplier (documents, information, shared findings) and messages with them (signed-in side).

import { apiClient } from '@/lib/api';

export type RequestKind = 'document' | 'finding' | 'information';
export type RequestStatus = 'open' | 'submitted' | 'returned' | 'accepted' | 'cancelled';
export type ThreadType = 'vendor' | 'request' | 'questionnaire';
export type FindingAction = 'keep' | 'plan' | 'close';

export interface RequestFile {
  id: number; file_name: string; file_size: number | null; coverage_from: string | null; coverage_to: string | null;
  expiry_date: string | null; uploaded_at: string | null; evidence_id: number; link_id: number | null;
}

export interface SupplierRequest {
  id: number; vendor_id: number; assessment_id: number | null; kind: RequestKind; title: string; detail: string | null;
  evidence_kind: string | null; evidence_label: string | null;
  finding: { id: number; title: string | null; severity: string; status: string; assessment_id: number; removed: boolean } | null;
  contact: { id: number; name: string; email: string | null } | null;     // null: every contact with portal access
  due_date: string | null; overdue: boolean; status: RequestStatus;
  requested_by_name: string | null; requested_at: string;
  response_text: string | null; plan_text: string | null; target_date: string | null;
  responded_at: string | null; responded_by: string | null;
  reviewed_by_name: string | null; reviewed_at: string | null; review_note: string | null;
  files: RequestFile[];
}

/** Who an email went to, and whether it went. */
export interface Sent { contact_id: number; name: string; email: string | null; emailed: boolean }

export interface SupplierMessage {
  id: number; from_supplier: boolean; author: string | null; body: string; created_at: string;
  subject_type: ThreadType; subject_id: number | null; question_key: string | null;
  visibility: 'internal' | 'shared'; author_kind: 'user' | 'contact' | 'system';
}

export interface RequestFields {
  kind?: 'document' | 'information'; title?: string | null; detail?: string | null; evidence_kind?: string | null;
  due_date?: string | null; contact_id?: number | null;
}

const base = (vendorId: number) => `/vendor-risk/vendors/${vendorId}`;

export const requestsApi = {
  list: (vendorId: number) =>
    apiClient.get<{ items: SupplierRequest[]; evidence_kinds: { key: string; label: string }[] }>(`${base(vendorId)}/supplier-requests`),
  create: (vendorId: number, data: RequestFields) =>
    apiClient.post<SupplierRequest & { sent: Sent[] }>(`${base(vendorId)}/supplier-requests`, data),
  cancel: (vendorId: number, id: number) => apiClient.post<SupplierRequest>(`${base(vendorId)}/supplier-requests/${id}/cancel`, {}),
  accept: (vendorId: number, id: number, data: { note?: string; finding?: FindingAction }) =>
    apiClient.post<SupplierRequest>(`${base(vendorId)}/supplier-requests/${id}/accept`, data),
  sendBack: (vendorId: number, id: number, note: string) =>
    apiClient.post<SupplierRequest & { sent: Sent[] }>(`${base(vendorId)}/supplier-requests/${id}/return`, { note }),
  /** What the supplier reads is the title and note given here; never the finding's severity or scores. */
  shareFinding: (findingId: number, data: { title?: string; note?: string; due_date: string; contact_id?: number | null }) =>
    apiClient.post<SupplierRequest & { sent: Sent[] }>(`/vendor-risk/tpra/findings/${findingId}/share`, data),
  messages: (vendorId: number, subjectType: ThreadType = 'vendor', subjectId?: number) =>
    apiClient.get<{ items: SupplierMessage[] }>(`${base(vendorId)}/messages`,
      { params: { subject_type: subjectType, subject_id: subjectId } }),
  sendMessage: (vendorId: number, data: { subject_type: ThreadType; subject_id?: number; visibility: 'internal' | 'shared'; body: string }) =>
    apiClient.post<SupplierMessage & { sent: Sent[] }>(`${base(vendorId)}/messages`, data),
};

/** Statuses as our people read them. */
export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: string }> = {
  open: { label: 'With supplier', tone: 'bg-[#eff6ff] text-[#1d4ed8]' },
  returned: { label: 'Returned', tone: 'bg-[#fef3c7] text-[#92400e]' },
  submitted: { label: 'To review', tone: 'bg-[#ecfdf5] text-[#047857]' },
  accepted: { label: 'Accepted', tone: 'bg-[#f1f3f5] text-[#4b5563]' },
  cancelled: { label: 'Cancelled', tone: 'bg-[#f1f3f5] text-[#4b5563]' },
};

/** "N contacts emailed", or why nobody was. */
export function sentNote(sent: Sent[]): { ok: boolean; text: string } {
  const went = sent.filter((s) => s.emailed).length;
  if (!sent.length) return { ok: false, text: 'No contact can get a link yet: add one with an email and portal access.' };
  if (!went) return { ok: false, text: 'Email not sent. Send the contact a link from Contacts.' };
  return { ok: true, text: `Emailed ${went === 1 ? sent.find((s) => s.emailed)?.name : `${went} contacts`}` };
}
