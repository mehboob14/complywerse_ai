'use client';

// The severity from which a finding opens an issue in Issues / CAPA by itself (a tenant setting; High by default). The drill page's Add finding form used to state "High/Critical" as a fixed
// fact. Anyone who may read BCM reads it here; changing it needs `bcm:plans:edit`, the right the server asks for it (the person sees the value read-only without it).
import { useState } from 'react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { optionsOf, severity } from '@/lib/statuses/bcm';
import { Button, ErrorState, FormField, Select, Sheet, Skeleton, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { SETTINGS_KEY, useIssueThreshold } from '../bcmData';

export function ThresholdSheet({ onClose }: { onClose: () => void }) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('bcm:plans:edit');
  const q = useIssueThreshold();
  const [picked, setPicked] = useState<string | null>(null);
  const saved = q.data ?? null;
  const value = picked ?? saved ?? 'high';
  const save = useReportedMutation({
    mutationFn: async (v: string) => (await bcmApi.settings.update({ finding_issue_threshold: v })).data,
    success: 'Issue threshold saved', failure: "Couldn't save the issue threshold", invalidate: [[...SETTINGS_KEY]],
    onSuccess: () => onClose(),
  });
  const dirty = saved !== null && value !== saved;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Issue threshold"
      subtitle="When a finding opens an issue"
      width="sm"
      dirty={dirty}
      footer={canEdit ? (
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(value)}>Save</Button>
        </div>
      ) : undefined}
    >
      <div className="flex flex-col gap-[12px] p-[16px]">
        {q.isPending && <Skeleton className="h-[32px] w-full" />}
        {q.isError && !q.data && <ErrorState compact title="Couldn't read the threshold" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />}
        {saved !== null && (
          <>
            <p className="m-0 text-ds-body text-ds-fg-body">
              {`A finding raised at ${severity.label(saved)} or above opens an issue in Issues / CAPA by itself. A lower one can be handed over by hand from its panel.`}
            </p>
            {canEdit ? (
              <FormField label="Open an issue from" info="Findings at or above this severity open an issue the moment they are raised.">
                <Select value={value} onChange={(e) => setPicked(e.target.value)}>
                  {optionsOf(severity).slice().reverse().map((o) => <option key={o.value} value={o.value}>{`${o.label} and above`}</option>)}
                </Select>
              </FormField>
            ) : (
              <p className="m-0 text-ds-label text-ds-fg-muted">Only people who may edit plans can change this.</p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
