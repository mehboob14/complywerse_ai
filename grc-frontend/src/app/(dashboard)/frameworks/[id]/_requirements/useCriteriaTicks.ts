'use client';

// The ticks of a requirement's checklist (assessment criteria, or the standard's sub-controls that are criteria). A tick shows at once and is saved; ticking moves the requirement's
// status on the server (all met = implemented, some = in progress), so the list and the journey's numbers are read again. A tick that could not be saved is put back and said.
// The journey page holds this hook because the Overview's roadmap reads the same unsaved ticks as the Requirements tab.
import { useState } from 'react';
import apiClient from '@/lib/api';
import { useReportedMutation } from '@/components/ui/ds';
import type { CertificationControl } from '@/types';

export type Ticks = Record<number, Record<string, boolean>>;

export function useCriteriaTicks(journeyId: number) {
  // Local override of per-requirement check state (control id -> {criterion index: met}); what the server sent is the base.
  const [criteriaState, setCriteriaState] = useState<Ticks>({});
  const mutation = useReportedMutation<unknown, { controlId: number; next: Record<string, boolean>; current: Record<string, boolean> }>({
    mutationFn: async ({ controlId, next }) => apiClient.patch(`/certifications/${journeyId}/controls/${controlId}/criteria`, { criteria_status: next }),
    failure: "Couldn't save the tick",
    invalidate: [['certification-controls', journeyId], ['certification-progress', journeyId]],
    onError: (_e, vars) => setCriteriaState((prev) => ({ ...prev, [vars.controlId]: vars.current })),
  });
  const toggleCriterion = (control: Pick<CertificationControl, 'id' | 'criteria_status'>, index: number) => {
    const current = criteriaState[control.id] ?? control.criteria_status ?? {};
    const next = { ...current, [String(index)]: !current[String(index)] };
    setCriteriaState((prev) => ({ ...prev, [control.id]: next }));
    mutation.mutate({ controlId: control.id, next, current });
  };
  return { criteriaState, toggleCriterion, saving: mutation.isPending };
}
