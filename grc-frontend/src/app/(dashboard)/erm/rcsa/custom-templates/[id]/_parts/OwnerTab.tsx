'use client';

// The owner tab of an item: who is named as its owner. The person is chosen from the organisation's people; choosing again changes it and clearing it makes the item unassigned. The change is
// saved at once (there is nothing else on this tab to save) and said in a toast. The list of people needs the RCSA view right: without it the tab says so, with a Retry, and never offers an
// empty list as if nobody could be chosen.
import { Combobox, ErrorState, FormField, PersonChip, SkeletonLines, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { rcsaApi } from '@/lib/api';
import { peopleOptions, usePeople } from '../../../_parts/rcsaData';
import { itemsChanged } from './registerData';

export function OwnerTab({ templateId, rowId, ownerId, ownerName, canEdit }: { templateId: number; rowId: number; ownerId: number | null; ownerName: string | null; canEdit: boolean }) {
  const people = usePeople(true);
  const assign = useReportedMutation({
    mutationFn: (userId: number | null) => rcsaApi.customTemplates.assignRow(templateId, rowId, userId),
    success: (_, userId) => (userId == null ? 'Owner cleared' : 'Owner changed'),
    failure: "The owner wasn't changed",
    toast: 'always',
    retryable: true,
    invalidate: itemsChanged(templateId),
  });
  return (
    <div className="flex flex-col gap-[12px]">
      <p className="text-ds-body text-ds-fg-muted">The owner is named on this item and finds it under "Assigned to me" in the Templates library.</p>
      <div className="flex flex-col gap-[4px]">
        <span className="text-ds-label text-ds-fg-muted">Owner now</span>
        <PersonChip name={ownerName} size={32} />
      </div>
      {canEdit && (people.isLoading ? (
        <SkeletonLines lines={2} label="Loading the people" />
      ) : people.isError ? (
        <ErrorState compact title="Couldn't load the people" message={errorMessage(people.error)} onRetry={() => { void people.refetch(); }} />
      ) : (
        <FormField label="Change the owner" hint={assign.isPending ? 'Saving…' : ownerId != null ? 'Choose the same person again to leave the item unassigned.' : undefined}>
          <Combobox
            label="Owner"
            options={peopleOptions(people.data)}
            value={ownerId == null ? null : String(ownerId)}
            onChange={(v) => assign.mutate(v == null ? null : Number(v))}
            placeholder="Unassigned"
            searchable
            clearable
            disabled={assign.isPending}
          />
        </FormField>
      ))}
    </div>
  );
}
