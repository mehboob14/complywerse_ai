/**
 * The AI Studio's view of a library document: what the person may do with it and their one draft of it
 * (backend: modules/governance/routers/document_access.py).
 */
import apiClient from '@/lib/api';

export interface DocumentAccess {
  document_id: number;
  status: string;
  version: string;
  /** owner, author, governance:policies:edit, administrators */
  can_edit: boolean;
  /** governance:policies:publish, administrators */
  can_publish: boolean;
  /** the organisation has the approvals and acknowledgements life cycle */
  lifecycle: boolean;
  /** the AI Studio can open it; `reason` says why not */
  openable: boolean;
  reason: string | null;
  draft: { session_id: number; behind: boolean; unsaved: boolean; base_label: string | null; updated_at: string | null } | null;
}

export interface DraftOpened {
  session_id: number;
  created: boolean;
  /** the draft has unsaved work on an older version of the document: the person chooses to go on with it or start again */
  stale: boolean;
  replaced: number | null;
  base_label: string | null;
  library_version: string;
}

const base = (id: number) => `/governance/studio/documents/${id}`;

export const documentApi = {
  access: async (id: number) => (await apiClient.get<DocumentAccess>(`${base(id)}/access`)).data,
  /** the person's one draft of the document: reused, or started (`fresh`: start again from the library version) */
  draft: async (id: number, fresh = false) => (await apiClient.post<DraftOpened>(`${base(id)}/draft`, { fresh })).data,
};
