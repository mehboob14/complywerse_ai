'use client';

/**
 * The NCA workspace's controls: the 66 DCC-1:2022 controls the tenant's container holds, as the DCC requirements lens (one answer select per row, Essential and sub-controls, the
 * bilingual text with the Arabic second). A container with no control yet offers to load them (`POST /{id}/dcc/initialize`, which loads them once and never twice). A new control
 * can be added by hand. The audit plan is the lens tab beside it.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Shield } from 'lucide-react';
import apiClient from '@/lib/api';
import { Button, EmptyState, Notice, useReportedMutation } from '@/components/ui/ds';
import type { LensItem } from './lensData';
import type { LensProps } from '../workspace/lens';
import { AddControlPanel } from '../workspace/AddControlPanel';
import { DCC } from './profiles';
import { RequirementsLens } from './RequirementsLens';
import { useLensData } from './useLensData';

export default function NcaDccLens(props: LensProps) {
  const { assessmentId, readOnly, onChanged } = props;
  const qc = useQueryClient();
  const { query, items } = useLensData(assessmentId);
  const [adding, setAdding] = useState(false);
  // the control type (Essential or sub-control) is only on the DCC read of the container, not on the assessment's
  const dcc = useQuery({
    queryKey: ['assessment-lens-dcc', assessmentId], staleTime: 60_000,
    queryFn: async () => ((await apiClient.get(`/compliance/assessments/${assessmentId}/dcc`)).data?.domains ?? []) as Array<{ items: Array<{ id: number; control_type: string | null }> }>,
  });
  const types = useMemo(() => new Map((dcc.data ?? []).flatMap((d) => d.items.map((i) => [i.id, (i.control_type ?? '').toLowerCase()] as const))), [dcc.data]);
  const enrich = useCallback((list: LensItem[]) => list.map((i) => (types.has(i.id) ? { ...i, controlType: types.get(i.id) ?? '' } : i)), [types]);
  const load = useReportedMutation({
    mutationFn: async () => (await apiClient.post(`/compliance/assessments/${assessmentId}/dcc/initialize`)).data,
    success: 'The DCC controls are loaded',
    failure: "Couldn't load the DCC controls",
    retryable: false,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['assessment-workspace', assessmentId] }); void qc.invalidateQueries({ queryKey: ['assessment-lens-dcc', assessmentId] }); onChanged(); },
  });

  if (query.isSuccess && items.length === 0) {
    return (
      <EmptyState
        kind="firstUse" icon={Shield} title="Load the DCC controls"
        description="This loads the 66 controls of the NCA Data Cybersecurity Controls (DCC-1:2022) into the workspace, ready to be answered, assigned and backed with evidence."
        action={readOnly ? undefined : <Button variant="primary" loading={load.isPending} onClick={() => load.mutate()}>Load the 66 controls</Button>}
      />
    );
  }
  return (
    <>
      {dcc.isError && <div className="mb-[12px]"><Notice tone="warning" title="Essential controls are not told apart" action={<Button size="sm" onClick={() => { void dcc.refetch(); }}>Try again</Button>}>The control types could not be loaded, so every control reads as a sub-control for now.</Notice></div>}
      <RequirementsLens
        profile={DCC} {...props} enrich={enrich}
        toolbar={!readOnly ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add control</Button> : undefined}
      />
      {adding && <AddControlPanel assessmentId={assessmentId} domains={Array.from(new Set(items.map((i) => i.domain)))} onClose={() => setAdding(false)} onAdded={() => { void qc.invalidateQueries({ queryKey: ['assessment-workspace', assessmentId] }); onChanged(); }} />}
    </>
  );
}
