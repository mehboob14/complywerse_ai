'use client';

// What a person can do to a requirement of a journey, each one a reported mutation: the confirmation comes when the server has answered, a failure stays on screen with its words
// and a Retry where repeating is safe. The endpoints and payloads are the ones the page always called; the rights are the page's (assign, approve, assess and the status: edit; upload:
// create; unlink: delete; asking for a scope decision and ticking a criterion: none, the server lets any signed-in person, as the page always did): the screen decides who sees a
// button, this file only does the call. A bulk action is one single request after the other (the server's pool is small and there is no bulk route), and says how many it did.
import { certificationsApi, governanceApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { useReportedMutation } from '@/components/ui/ds';
import { truncate } from '@/lib/format';
import { bulkSummary, mergeOwners, type BulkKind, type OwnerMode, type ReqRow } from './reqModel';

export interface EvidenceToRemove { id: number; item_type?: string; linked_evidence_id?: number }

export interface BulkOutcome { done: number; failed: number; failedIds: number[]; skipped: number; why: string }

const short = (s: string) => truncate(s, 50).text;

export function useRequirementActions({ journeyId, appFwId, rows, onBulkDone }: {
  journeyId: number;
  /** the uploaded framework's id: scope decisions are keyed by it */
  appFwId: number | null;
  rows: readonly ReqRow[];
  /** a bulk action ended: the ticks of the ones that failed are kept for another try */
  onBulkDone?: (outcome: BulkOutcome) => void;
}) {
  const refresh = [['certification-controls', journeyId], ['certification-progress', journeyId]];
  const named = (id: number) => { const r = rows.find((x) => x.id === id); return r ? `${r.code} ${short(r.name)}`.trim() : 'the requirement'; };

  const upload = useReportedMutation<unknown, { controlId: number; file: File; subControlCode?: string }>({
    mutationFn: async ({ controlId, file, subControlCode }) => {
      const form = new FormData();
      form.append('file', file);
      if (subControlCode) form.append('sub_control_code', subControlCode);
      return (await certificationsApi.uploadEvidence(journeyId, controlId, form)).data;
    },
    success: (_d, v) => ({ title: 'Evidence uploaded', message: `It is attached to ${named(v.controlId)} and waits for a reviewer.` }),
    failure: "Couldn't upload the file",
    retryable: false,
    invalidate: refresh,
  });

  const assess = useReportedMutation<unknown, { evidenceId: number }>({
    mutationFn: async ({ evidenceId }) => apiClient.post(`/evidence-mgmt/ai/${evidenceId}/review`, null, { params: { force: true } }),
    success: 'AI review finished',
    failure: "AI couldn't review the file",
    invalidate: [...refresh, ['evidence-review']],
  });

  const review = useReportedMutation<unknown, { evidenceId: number; action: 'approve' | 'reject' }>({
    mutationFn: async ({ evidenceId, action }) => apiClient.put(`/certifications/evidence/${evidenceId}/review`, { action }),
    success: (_d, v) => (v.action === 'approve' ? 'Evidence approved' : 'Evidence turned down'),
    failure: "Couldn't record the review",
    invalidate: refresh,
  });

  const unlink = useReportedMutation<unknown, EvidenceToRemove>({
    mutationFn: async (ev) => {
      if (ev.item_type === 'ecm' && ev.linked_evidence_id) return apiClient.delete(`/evidence-mgmt/links/${ev.linked_evidence_id}/controls/${ev.id}`);       // an item of the evidence library: unlink it there
      return apiClient.delete(`/certifications/evidence/${ev.id}`);                                                                                              // a file attached here
    },
    success: 'Evidence unlinked',
    failure: "Couldn't unlink the evidence",
    invalidate: refresh,
  });

  const assign = useReportedMutation<unknown, { controlId: number; userIds: number[] }>({
    mutationFn: async ({ controlId, userIds }) => (await certificationsApi.assignControl(journeyId, controlId, userIds)).data,
    success: (_d, v) => (v.userIds.length ? 'Owners saved' : 'Owners withdrawn'),
    failure: "Couldn't save the owners",
    invalidate: [['certification-controls', journeyId]],
  });

  const assignSub = useReportedMutation<unknown, { controlId: number; code: string; userIds: number[] }>({
    mutationFn: async ({ controlId, code, userIds }) => (await certificationsApi.assignSubControl(journeyId, controlId, code, userIds)).data,
    success: (_d, v) => (v.userIds.length ? 'Owners saved' : 'Owners withdrawn'),
    failure: "Couldn't save the owners",
    invalidate: [['certification-controls', journeyId]],
  });

  const setStatus = useReportedMutation<unknown, { controlId: number; status: string }>({
    mutationFn: async ({ controlId, status }) => (await certificationsApi.updateControl(journeyId, controlId, { status })).data,
    success: (_d, v) => `${named(v.controlId)} is now ${v.status.replace(/_/g, ' ')}`,
    failure: "Couldn't change the status",
    invalidate: refresh,
  });

  /** Ask for a scope decision. The server keeps EVERY such request waiting for a reviewer; the requirement changes only when one approves. */
  const askScope = useReportedMutation<unknown, { control: { id: number; parsedId: number | null }; applicable: boolean; justification: string }>({
    mutationFn: async ({ control, applicable, justification }) => {
      if (!appFwId) throw new Error('This journey is not linked to a framework in the library.');
      return (await governanceApi.setClauseApplicability({ control_id: control.parsedId ?? control.id, uploaded_framework_id: appFwId, is_applicable: applicable, justification })).data;
    },
    success: (_d, v) => ({
      title: 'Request sent to a reviewer',
      message: `The requirement stays as it is until a reviewer decides${v.applicable ? '' : '; if it is approved it leaves the scope'}.`,
    }),
    failure: "Couldn't send the request",
    invalidate: [['applicability'], ...refresh],
  });

  const bulkAssign = useReportedMutation<BulkOutcome, { ids: number[]; picked: number[]; mode: OwnerMode; skipped: number; why: string }>({
    mutationFn: async ({ ids, picked, mode, skipped, why }) => {
      const failedIds: number[] = [];
      let lastError: unknown = null;
      for (const id of ids) {
        const row = rows.find((r) => r.id === id);
        try { await certificationsApi.assignControl(journeyId, id, mergeOwners(row?.ownerIds ?? [], picked, mode)); } catch (e) { failedIds.push(id); lastError = e; }
      }
      if (failedIds.length === ids.length && ids.length > 0) throw lastError instanceof Error ? lastError : new Error('None of the requirements could be changed.');
      return { done: ids.length - failedIds.length, failed: failedIds.length, failedIds, skipped, why };
    },
    success: (r, v) => bulkSummary(v.picked.length === 0 && v.mode === 'replace' ? 'Withdrew the owners of' : 'Set the owners of', { one: 'requirement', other: 'requirements' }, r, r.why),
    failure: "Couldn't change the owners",
    invalidate: [['certification-controls', journeyId]],
    onSuccess: (r) => onBulkDone?.(r),
  });

  const bulkScope = useReportedMutation<BulkOutcome, { kind: Exclude<BulkKind, 'assign'>; items: Array<{ id: number; parsedId: number | null }>; justification: string; skipped: number; why: string }>({
    mutationFn: async ({ kind, items, justification, skipped, why }) => {
      if (!appFwId) throw new Error('This journey is not linked to a framework in the library.');
      const failedIds: number[] = [];
      let lastError: unknown = null;
      for (const it of items) {
        try {
          await governanceApi.setClauseApplicability({ control_id: it.parsedId ?? it.id, uploaded_framework_id: appFwId, is_applicable: kind === 'scope_in', justification });
        } catch (e) { failedIds.push(it.id); lastError = e; }
      }
      if (failedIds.length === items.length && items.length > 0) throw lastError instanceof Error ? lastError : new Error('None of the requests could be sent.');
      return { done: items.length - failedIds.length, failed: failedIds.length, failedIds, skipped, why };
    },
    success: (r) => {
      const s = bulkSummary('Sent', { one: 'request', other: 'requests' }, r, r.why);
      return { title: `${s.title} to a reviewer`, message: [s.message, 'The requirements stay as they are until a reviewer decides.'].filter(Boolean).join(' ') };
    },
    failure: "Couldn't send the requests",
    invalidate: [['applicability'], ...refresh],
    onSuccess: (r) => onBulkDone?.(r),
  });

  return {
    upload, assess, review, unlink, assign, assignSub, setStatus, askScope, bulkAssign, bulkScope,
    /** the control being uploaded to / whose file is under review right now (a button shows its spinner) */
    uploadingId: upload.isPending ? upload.variables?.controlId ?? null : null,
    assessingId: assess.isPending ? assess.variables?.evidenceId ?? null : null,
    busyBulk: bulkAssign.isPending || bulkScope.isPending,
  };
}
