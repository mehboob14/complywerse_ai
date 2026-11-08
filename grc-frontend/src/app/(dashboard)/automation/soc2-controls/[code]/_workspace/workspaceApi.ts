// The calls of the control workspace that lib/api.ts has no method for (the applicability routes, the work item, the Workbench's sample files). Kept beside the workspace so the shared api file
// is not edited by parallel groups. Every path is one the server already serves (scf/router.py, automation/assurance.py, control_library/routers/workbench.py).
import apiClient, { automationApi } from '@/lib/api';

const control = (code: string) => `/automation/common/controls/${encodeURIComponent(code)}`;

/** Ask for a control to be marked applicable or not applicable. A different person with the right to manage frameworks decides. */
export const requestApplicability = (scopeId: number, code: string, body: { is_applicable: boolean; reason: string }) =>
  apiClient.post(`/scf/scopes/${scopeId}/controls/${encodeURIComponent(code)}/applicability`, body);

/** Rule on a pending request. The server refuses the person who asked. */
export const reviewApplicability = (scopeId: number, code: string, body: { approve: boolean; comment: string | null }) =>
  apiClient.post(`/scf/scopes/${scopeId}/controls/${encodeURIComponent(code)}/applicability/review`, body);

/** Start tracking the control for testing: creates its work item (idempotent). The reads no longer do it, so a first sample file needs this. */
export const trackControl = async (code: string): Promise<number> => {
  const r = await apiClient.post(`${control(code)}/assurance/track`);
  return (r.data as { work_item: { work_item_id: number } }).work_item.work_item_id;
};

/** The control's work item id, tracking the control first when nobody has acted on it (that needs the right to record tests; a control that already has an item needs nothing). */
export const ensureWorkItem = async (code: string): Promise<number> => {
  const a = (await automationApi.getControlAssurance(code)).data as { work_item: { work_item_id: number | null } };
  return a.work_item.work_item_id ?? trackControl(code);
};

/** Upload a file as a sample (against a procedure, or the control), or link one from the evidence library (`evidence_id`). */
export const attachSample = (workItemId: number, fields: Record<string, string | Blob>) => {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  return apiClient.post(`/control-library/workbench/items/${workItemId}/evidence`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
};

/** Approve or reject a sample file that is waiting. */
export const reviewSample = (evidenceRowId: number, action: 'approved' | 'rejected') =>
  apiClient.post(`/control-library/workbench/evidence/${evidenceRowId}/review`, { action });

/** The evidence library, searched on the server (30 at most). */
export const searchLibrary = async (q: string) =>
  (await apiClient.get('/control-library/workbench/evidence-library', { params: { limit: 30, ...(q ? { q } : {}) } })).data as {
    items: { id: number; name: string; file_name?: string; evidence_type?: string; status?: string }[];
  };
