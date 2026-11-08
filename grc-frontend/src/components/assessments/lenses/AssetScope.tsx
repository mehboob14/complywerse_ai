'use client';

/**
 * The applications an uploaded ASVS, OWASP or MASVS workbook covers (an assessment made for one application has its application in its scope and shows none of this).
 * Choosing applications is saved at once. For ASVS each application has its own answers and its own target level: pick the one to look at, set its target, and choose whether the
 * requirements above that level are hidden or shown greyed.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Disclosure, FormField, MultiSelect, Notice, SegmentedControl, Select, useReportedMutation, type ListOption } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { LENS_KEYS, lensApi } from './lensApi';

export function AssetScope({ assessmentId, linked, perApplication, activeId, targetLevel, outOfScope, readOnly, onPick, onOutOfScope, onChanged }: {
  assessmentId: number;
  linked: readonly number[];
  /** ASVS: each application has its own answers and target level */
  perApplication: boolean;
  activeId: number | null;
  targetLevel: number | null;
  outOfScope: 'hide' | 'show';
  readOnly: boolean;
  onPick: (assetId: number) => void;
  onOutOfScope: (mode: 'hide' | 'show') => void;
  onChanged: () => void;
}) {
  const apps = useQuery({ queryKey: LENS_KEYS.applications, queryFn: lensApi.applications, staleTime: 60_000 });
  const options = useMemo<ListOption[]>(() => {
    const seen = new Set<string>();
    const out: ListOption[] = [];
    for (const id of linked) { const a = (apps.data ?? []).find((x) => x.id === id); seen.add(String(id)); out.push({ value: String(id), label: a?.name ?? 'An application', description: a?.asset_type ?? undefined }); }
    for (const a of apps.data ?? []) if (!seen.has(String(a.id))) out.push({ value: String(a.id), label: a.name, description: a.asset_type ?? undefined });
    return out;
  }, [apps.data, linked]);
  const nameOf = (id: number): string => options.find((o) => o.value === String(id))?.label ?? 'An application';

  const save = useReportedMutation({
    mutationFn: (ids: number[]) => lensApi.setApplications(assessmentId, ids),
    failure: "Couldn't save the applications",
    onSuccess: onChanged,
  });
  const level = useReportedMutation({
    mutationFn: ({ asset, value }: { asset: number; value: number }) => lensApi.setTargetLevel(assessmentId, asset, value),
    success: 'Target level saved',
    failure: "Couldn't save the target level",
    onSuccess: onChanged,
  });

  return (
    <Disclosure label={`Applications in scope${linked.length ? ` (${linked.length})` : ''}`} defaultOpen={false}>
      <div className="flex flex-col gap-[12px] pt-[8px]">
        {apps.isError && (
          <Notice tone="danger" title="Couldn't load the applications" action={canRetry(apps.error) ? <button type="button" className="text-ds-label text-ds-primary-text underline" onClick={() => { void apps.refetch(); }}>Try again</button> : undefined}>{errorMessage(apps.error)}</Notice>
        )}
        <FormField label="Applications" hint={perApplication ? 'Each application has its own answers and its own target level. The control panel edits the control for everyone; the table shows the application chosen.' : 'The application this assessment covers.'}>
          <MultiSelect
            label="Applications" options={options} value={linked.map(String)} display="chips" placeholder="No application linked" searchPlaceholder="Search applications"
            disabled={readOnly || save.isPending}
            onChange={(next) => save.mutate(next.map(Number))}
          />
        </FormField>
        {perApplication && linked.length > 0 && activeId != null && (
          <div className="flex flex-wrap items-end gap-[16px]">
            {linked.length > 1 && (
              <FormField label="Showing the results of">
                <Select value={String(activeId)} onChange={(e) => onPick(Number(e.target.value))}>
                  {linked.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
                </Select>
              </FormField>
            )}
            <FormField label="Target ASVS level" info="The requirements above this level do not apply to the application.">
              <Select value={targetLevel ?? ''} disabled={readOnly || level.isPending} onChange={(e) => e.target.value && level.mutate({ asset: activeId, value: Number(e.target.value) })}>
                <option value="" disabled>Choose a level</option>
                <option value={1}>Level 1 · baseline</option>
                <option value={2}>Level 2 · sensitive data</option>
                <option value={3}>Level 3 · critical</option>
              </Select>
            </FormField>
            <div>
              <p className="mb-[4px] text-ds-label text-ds-fg-muted">Requirements above the target</p>
              <SegmentedControl label="Requirements above the target" name="asvs-out-of-scope" value={outOfScope} onChange={onOutOfScope} options={[{ value: 'hide', label: 'Hide' }, { value: 'show', label: 'Show greyed' }]} />
            </div>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
