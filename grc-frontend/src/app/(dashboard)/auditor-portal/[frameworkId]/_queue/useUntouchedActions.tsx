'use client';

// Auto-approve, kept: one click marks a routine requirement that nobody asked about as in scope and approved
// (POST /auditor-portal/{id}/controls/{control}/auto-approve). The server records the same person as the one who asked and the one who approved, which the
// platform's own scope review never allows, so the question says so before it is sent. A critical requirement has no Auto-approve (the server refuses it).
import { useConfirm, useReportedMutation } from '@/components/ui/ds';
import apiClient from '@/lib/api';
import { controlLine, type UntouchedItem } from '@/lib/auditorPortal/portalModel';
import { afterDecision } from '../../_front/portalData';

export function useUntouchedActions(journeyId: number) {
  const { confirm, confirmDialog } = useConfirm();
  const approve = useReportedMutation({
    mutationFn: async (item: UntouchedItem) => (await apiClient.post(`/auditor-portal/${journeyId}/controls/${item.id}/auto-approve`)).data,
    success: (_d, item) => ({ title: 'Marked in scope', message: `${controlLine(item.control)} is in scope and approved, recorded under your name.` }),
    failure: "Couldn't mark it in scope",
    invalidate: afterDecision(journeyId),
  });

  const askAutoApprove = async (item: UntouchedItem) => {
    const ok = await confirm({
      title: `Auto-approve ${item.control.ref || 'this requirement'}?`,
      message: 'It will be marked in scope and approved at once. You are recorded as both the person who asked and the person who approved, so nobody else sees this decision. Use it for routine requirements; if a second person should decide, ask in Frameworks instead.',
      confirmLabel: 'Auto-approve',
    });
    if (ok) approve.mutate(item);
  };

  return { askAutoApprove, busyId: approve.isPending ? approve.variables?.id ?? null : null, confirmDialog };
}
