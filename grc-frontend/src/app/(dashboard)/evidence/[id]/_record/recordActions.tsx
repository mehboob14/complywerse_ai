'use client';

/**
 * What a person can do to the open file, and what each says once the server has answered: send it for review, approve it or send it back (with a note), renew it, read it again, rate it
 * again, delete it (asks first, and again when the server warns that it is linked to controls), link records to it and unlink them (asks first). Every action is a useReportedMutation:
 * the confirmation comes after the server answers, a failure stays with its words and a Retry where repeating is safe. The endpoints and payloads are the ones the page always sent.
 * The one thing it draws is its confirm dialog.
 */
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { useConfirm, useNotify, useReportedMutation } from '@/components/ui/ds';
import { formatCount, truncate } from '@/lib/format';
import { deleteEvidence, processOCR, reviewEvidence, runAssessment, submitForReview } from '../../_workspace/api';
import { LIBRARY_REFRESH, renewEvidence } from '../../_library/libraryData';
import type { ClauseMapping, EvidenceDetail } from './recordTypes';
import { LINK_ONE, type LinkType, type LinkedItem } from './linkModel';

const short = (name: string) => truncate(name, 60).text;

/** What a link request carries, by kind. */
export type LinkRequest =
  | { kind: 'common_controls'; recs: Array<{ scfId: string; artifactName?: string | null }> }
  | { kind: 'risks' | 'assets' | 'incidents' | 'policy_statements'; ids: number[] }
  | { kind: 'audit_observations'; recs: Array<{ auditKind: string; recordId: number }> }
  | { kind: 'clause'; clause: ClauseMapping };

export function useRecordActions(evidence: Pick<EvidenceDetail, 'id' | 'name' | 'validity_period_days'> | undefined) {
  const id = evidence?.id ?? 0;
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const name = () => short(evidence?.name ?? 'this evidence');
  const record = [['evidence-detail', id], ['evidence-review', id], ...LIBRARY_REFRESH, ['pending-approvals']] as const;
  const links = [['evidence-all-links', id], ['evidence-controls', id], ['evidence-detail', id], ['evidence-ai-link-status', id], ['evidence-audit-options', id], ['evidence-by-control'], ...LIBRARY_REFRESH] as const;

  const submit = useReportedMutation<unknown, void>({
    mutationFn: async () => (await submitForReview(id)).data,
    success: () => ({ title: `Sent “${name()}” for review`, message: 'It now waits for a reviewer.' }),
    failure: "Couldn't send the evidence for review", invalidate: record,
  });
  const approve = useReportedMutation<unknown, string>({
    mutationFn: async (note) => (await reviewEvidence(id, 'approve', note.trim() || undefined)).data,
    success: () => `Approved “${name()}”`, failure: "Couldn't approve the evidence", invalidate: record,
  });
  const sendBack = useReportedMutation<unknown, string>({
    mutationFn: async (note) => (await reviewEvidence(id, 'reject', note.trim() || undefined)).data,
    success: () => ({ title: `Sent “${name()}” back`, message: 'It is a draft again, with your note, until its owner sends it for review again.' }),
    failure: "Couldn't send the evidence back", invalidate: record,
  });
  const renewMutation = useReportedMutation<unknown, void>({
    mutationFn: async () => (await renewEvidence(id)).data,
    success: () => ({ title: `Renewed “${name()}”`, message: 'It is a draft again and needs a new review before it counts.' }),
    failure: "Couldn't renew the evidence", invalidate: record,
  });
  const readAgain = useReportedMutation<unknown, void>({
    mutationFn: async () => (await processOCR(id)).data,
    success: 'Reading the file again. The AI review starts when it is read.', failure: "Couldn't read the file again",
    invalidate: [['evidence-ocr', id], ['evidence-review', id], ['evidence-detail', id], ['ev-ws-items']],
  });
  const rateAgain = useReportedMutation<unknown, void>({
    mutationFn: async () => (await runAssessment(id)).data,
    success: 'The AI review has started. The rating appears here in a few seconds.', failure: "Couldn't start the AI review",
    invalidate: [['evidence-review', id], ['evidence-detail', id], ['evidence-assessment', id], ...LIBRARY_REFRESH],
  });
  const remove = useReportedMutation<{ warning?: boolean; message?: string } | undefined, boolean>({
    mutationFn: async (force) => (await deleteEvidence(id, force)).data as { warning?: boolean; message?: string } | undefined,
    success: 'Evidence deleted', failure: "Couldn't delete the evidence", toast: 'errors',
    onSuccess: (data) => {
      if (data?.warning) { void askForce(data.message); return; }
      notify.success(`Deleted “${name()}”`);
      LIBRARY_REFRESH.forEach((key) => { void qc.invalidateQueries({ queryKey: key }); });
      router.push('/evidence');
    },
  });
  const askForce = async (message: string | undefined) => {
    const yes = await confirm({ title: 'Delete it anyway?', message: message || 'This evidence is linked to controls.', confirmLabel: 'Delete anyway', tone: 'danger' });
    if (yes) remove.mutate(true);
  };

  const link = useReportedMutation<{ said: string }, LinkRequest>({
    mutationFn: async (req) => {
      switch (req.kind) {
        case 'common_controls':
          for (const r of req.recs) await apiClient.post(`/automation/common/controls/${encodeURIComponent(r.scfId)}/assurance/evidence`, { evidence_id: id, artifact_name: r.artifactName || null });
          return { said: req.recs.length === 1 ? 'Common control linked' : `${formatCount(req.recs.length)} common controls linked` };
        case 'audit_observations': {
          const statutory = req.recs.filter((r) => r.auditKind !== 'issue').map((r) => r.recordId);
          const issues = req.recs.filter((r) => r.auditKind === 'issue').map((r) => r.recordId);
          if (statutory.length) await apiClient.post(`/evidence-mgmt/cross-links/${id}/audit-observations`, { observation_ids: statutory });
          if (issues.length) await apiClient.post(`/evidence-mgmt/cross-links/${id}/audit-issues`, { issue_ids: issues });
          return { said: req.recs.length === 1 ? 'Audit observation linked' : `${formatCount(req.recs.length)} audit observations linked` };
        }
        case 'clause': {
          const c = req.clause;
          const r = (await apiClient.post(`/evidence-mgmt/links/${id}/link-from-ai`, {
            framework_name: c.framework_name, control_id: c.control_id, clause_reference: c.clause_reference, confidence: c.confidence, matching_rationale: c.matching_rationale,
          })).data as { already_linked?: boolean; control_id?: string; control_title?: string };
          return { said: r.already_linked ? `Already linked to ${r.control_id ?? c.control_id}` : `Linked to ${r.control_id ?? c.control_id}${r.control_title ? `: ${short(r.control_title)}` : ''}` };
        }
        default: {
          const body = { risks: { risk_ids: req.ids }, assets: { asset_ids: req.ids }, incidents: { incident_ids: req.ids }, policy_statements: { statement_ids: req.ids } }[req.kind];
          const path = { risks: 'risks', assets: 'assets', incidents: 'incidents', policy_statements: 'policy-statements' }[req.kind];
          await apiClient.post(`/evidence-mgmt/cross-links/${id}/${path}`, body);
          const one = LINK_ONE[req.kind];
          return { said: req.ids.length === 1 ? `${one[0].toUpperCase()}${one.slice(1)} linked` : `${formatCount(req.ids.length)} ${one}s linked` };
        }
      }
    },
    success: (data) => data.said,
    failure: "Couldn't link it",
    invalidate: links,
  });

  const unlinkMutation = useReportedMutation<unknown, NonNullable<LinkedItem['unlink']>>({
    mutationFn: async (u) => {
      if (u.kind === 'control') return apiClient.delete(`/evidence-mgmt/links/${id}/controls/${u.id}`);
      const segment = u.kind === 'audit' ? (u.auditKind === 'issue' ? 'audit-issues' : 'audit-observations') : { risk: 'risks', asset: 'assets', incident: 'incidents', policy: 'policy-statements' }[u.kind];
      return apiClient.delete(`/evidence-mgmt/cross-links/${id}/${segment}/${u.id}`);
    },
    success: 'Link removed', failure: "Couldn't remove the link", invalidate: links,
  });
  const unlink = async (item: LinkedItem, type: LinkType) => {
    if (!item.unlink) return;
    const yes = await confirm({
      title: `Remove this ${LINK_ONE[type]}?`,
      message: `“${short(item.title)}” stays where it is. Only its link to “${name()}” goes.`,
      confirmLabel: 'Remove link', tone: 'danger',
    });
    if (yes) unlinkMutation.mutate(item.unlink);
  };

  const askDelete = async () => {
    const yes = await confirm({ title: 'Delete this evidence?', message: `“${name()}” will be deleted. This can't be undone.`, confirmLabel: 'Delete evidence', tone: 'danger' });
    if (yes) remove.mutate(false);
  };
  const askRenew = async () => {
    const days = evidence?.validity_period_days || 365;
    const yes = await confirm({
      title: 'Renew this evidence?',
      message: `Its collection date becomes today and it is valid for ${formatCount(days)} ${days === 1 ? 'day' : 'days'} from now. It goes back to Draft and needs a new review before it counts again.`,
      confirmLabel: 'Renew evidence',
    });
    if (yes) renewMutation.mutate();
  };

  return {
    ui: confirmDialog,
    pending: { submit: submit.isPending, approve: approve.isPending, sendBack: sendBack.isPending, renew: renewMutation.isPending, readAgain: readAgain.isPending, rateAgain: rateAgain.isPending, remove: remove.isPending, link: link.isPending, unlink: unlinkMutation.isPending },
    submit: () => submit.mutate(),
    approve: (note: string, onDone?: () => void) => approve.mutate(note, { onSuccess: onDone }),
    sendBack: (note: string, onDone?: () => void) => sendBack.mutate(note, { onSuccess: onDone }),
    renew: () => { void askRenew(); },
    readAgain: () => readAgain.mutate(),
    rateAgain: () => rateAgain.mutate(),
    remove: () => { void askDelete(); },
    link: (req: LinkRequest, onDone?: () => void) => link.mutate(req, { onSuccess: onDone }),
    unlink,
  };
}
