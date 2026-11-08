'use client';

/**
 * What a person can DO from the hub, each as a mutation that reports for itself: start a journey (the server's onboarding gate decides; its refusal becomes the "Onboarding needed" notice
 * with the button that fixes it, never a toast), delete a journey, delete a framework (both ask first, in the kit's dialog), and have AI write the evidence recommendations of a framework.
 * The old pages did all of this with bare mutations: a failed start only wrote to the console, a failed delete was red text in a hand-made modal, and the journey's delete button
 * appeared only on hover. Who may delete is the page's own gate (`frameworks:framework_library:delete`, as the Manage page had it); the server checks nothing but the sign-in.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import apiClient, { certificationsApi } from '@/lib/api';
import { ONBOARDING_KEYS, onboardingApi, problemOf } from '@/lib/frameworkOnboarding';
import { refusalFromProblem, type Refusal } from '@/components/compliance/onboarding/gate/gateModel';
import { startRefusalWords, workspaceHref } from '@/components/compliance/onboarding/register/registerModel';
import { useConfirm, useNotify, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { AGGREGATE_KEY, JOURNEYS_KEY, LIBRARY_KEY, REGISTER_KEY } from './hubData';
import { journeyHref, type HubRow } from './hubModel';

export interface StartRefusal { frameworkId: number; name: string; why: Refusal }

/** What the server answers a start of an onboarding with when the person may not (EDIT_ONBOARDING): said on the button, so it does not look usable. */
export const ONBOARD_REASON = 'Needs the right to edit frameworks';

export interface HubActions {
  canDelete: boolean;
  /** the server lets a person make an onboarding with `compliance:framework_onboarding:edit` or `compliance:frameworks:edit`; reading one is open to every signed-in person */
  canOnboard: boolean;
  /** the framework whose journey is being created, and the one whose onboarding is being started */
  starting: number | null;
  startingOnboarding: number | null;
  start: (row: HubRow, targetDay?: string) => void;
  /** makes the framework's onboarding (a draft) and opens it */
  startOnboarding: (row: HubRow) => void;
  refusal: StartRefusal | null;
  clearRefusal: () => void;
  removeJourney: (row: HubRow) => void;
  removeFramework: (row: HubRow) => void;
  enhance: (row: HubRow) => void;
  enhancing: number | null;
  /** the question box of the two deletes: render it once, anywhere */
  dialog: React.ReactNode;
}

export function useHubActions({ onRemovedFramework }: { onRemovedFramework?: (frameworkId: number) => void } = {}): HubActions {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const { hasPermission } = usePermissions();
  const { confirm, confirmDialog } = useConfirm();
  const [refusal, setRefusal] = useState<StartRefusal | null>(null);
  const canDelete = hasPermission('frameworks:framework_library:delete');
  const canOnboard = hasPermission('compliance:framework_onboarding:edit') || hasPermission('compliance:frameworks:edit');

  const startM = useReportedMutation({
    mutationFn: async (v: { frameworkId: number; name: string; targetDay?: string }) => {
      const body: { framework_id: number; name: string; target_date?: string } = { framework_id: v.frameworkId, name: v.name };
      if (v.targetDay) body.target_date = v.targetDay;
      return (await certificationsApi.create(body)).data as { id: number };
    },
    failure: "Couldn't start the journey",
    toast: 'none',
    invalidate: [[...JOURNEYS_KEY], [...AGGREGATE_KEY], [...REGISTER_KEY]],
    onSuccess: (journey) => { setRefusal(null); if (journey?.id) router.push(journeyHref(journey.id)); },
    onError: (error, v) => {
      const why = refusalFromProblem(problemOf(error));
      if (why) {                                                                 // the onboarding is not finished: the register on the screen was stale
        setRefusal({ frameworkId: v.frameworkId, name: v.name, why });
        void qc.invalidateQueries({ queryKey: [...REGISTER_KEY] });
        return;
      }
      notify.error(errorMessage(error), { title: "Couldn't start the journey", retry: canRetry(error) ? () => startM.mutate(v) : undefined });
    },
  });

  const onboardM = useReportedMutation({
    mutationFn: (frameworkId: number) => onboardingApi.start(frameworkId),
    failure: "Couldn't start the onboarding",
    toast: 'none',
    invalidate: [[...REGISTER_KEY]],
    onSuccess: (view) => { qc.setQueryData(ONBOARDING_KEYS.detail(view.id), view); router.push(workspaceHref(view.id)); },
    onError: (error) => { const p = problemOf(error); notify.error(startRefusalWords(p.status, p.message), { title: "Couldn't start the onboarding" }); },
  });

  const deleteJourneyM = useReportedMutation({
    mutationFn: (id: number) => certificationsApi.delete(id),
    success: 'Journey deleted',
    failure: "Couldn't delete the journey",
    invalidate: [[...JOURNEYS_KEY], [...AGGREGATE_KEY], [...REGISTER_KEY]],
  });

  const deleteFrameworkM = useReportedMutation({
    mutationFn: (id: number) => apiClient.delete(`/framework-upload/upload/${id}`),
    success: 'Framework deleted',
    failure: "Couldn't delete the framework",
    invalidate: [[...LIBRARY_KEY], [...REGISTER_KEY]],
    onSuccess: (_, id) => onRemovedFramework?.(id),
  });

  const [enhancing, setEnhancing] = useState<number | null>(null);
  const enhanceM = useReportedMutation({
    mutationFn: async (id: number) => (await apiClient.post(`/framework-upload/parser/frameworks/${id}/enhance`)).data as { total_controls?: number; estimated_time_minutes?: number },
    success: (data) => {
      const n = data?.total_controls ?? 0;
      const minutes = Math.max(1, data?.estimated_time_minutes ?? 1);
      return { title: 'Evidence recommendations are being written', message: `AI is going through ${n} ${n === 1 ? 'requirement' : 'requirements'}. It takes about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.` };
    },
    failure: "Couldn't start the evidence recommendations",
    invalidate: [[...LIBRARY_KEY]],
  });

  return {
    canDelete,
    canOnboard,
    starting: startM.isPending ? (startM.variables?.frameworkId ?? null) : null,
    startingOnboarding: onboardM.isPending ? (onboardM.variables ?? null) : null,
    startOnboarding: (row) => { if (row.frameworkId != null) onboardM.mutate(row.frameworkId); },
    start: (row, targetDay) => {
      if (row.frameworkId == null) return;
      setRefusal(null);
      startM.mutate({ frameworkId: row.frameworkId, name: row.name, targetDay });
    },
    refusal,
    clearRefusal: () => setRefusal(null),
    removeJourney: (row) => {
      if (!row.journey) return;
      const id = row.journey.id;
      void confirm({
        title: `Delete "${row.name}"?`,
        message: 'This permanently removes the journey with all its progress, the requirement records and the evidence attached to them. It can\'t be undone.',
        confirmLabel: 'Delete journey', tone: 'danger',
      }).then((yes) => { if (yes) deleteJourneyM.mutate(id); });
    },
    removeFramework: (row) => {
      if (row.frameworkId == null) return;
      const id = row.frameworkId;
      void confirm({
        title: `Delete "${row.name}"?`,
        message: 'This permanently removes the framework and all its requirements from the library. It can\'t be undone.',
        confirmLabel: 'Delete framework', tone: 'danger',
      }).then((yes) => { if (yes) deleteFrameworkM.mutate(id); });
    },
    enhance: (row) => {
      if (row.frameworkId == null) return;
      setEnhancing(row.frameworkId);
      enhanceM.mutate(row.frameworkId, { onSettled: () => setEnhancing(null) });
    },
    enhancing,
    dialog: confirmDialog,
  };
}
