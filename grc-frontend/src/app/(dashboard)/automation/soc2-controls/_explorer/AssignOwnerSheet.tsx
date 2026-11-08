'use client';

// "Assign owner" for the controls that are ticked: one person, chosen from the organisation's people, becomes the owner of every ticked control. It runs nothing itself (the page's mutation
// does, and says how many controls the SERVER changed). Closing it with a person chosen asks first (the kit's dirty guard).
import { useEffect, useMemo, useState } from 'react';
import { Button, Combobox, FormField, Notice, Sheet } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { userName, type TenantUser } from './controlsData';

export interface AssignOwnerSheetProps {
  open: boolean;
  onClose: () => void;
  /** how many controls are ticked */
  count: number;
  people: readonly TenantUser[] | undefined;
  peopleFailed: boolean;
  onRetryPeople: () => void;
  pending: boolean;
  onAssign: (ownerId: number) => void;
}

export function AssignOwnerSheet({ open, onClose, count, people, peopleFailed, onRetryPeople, pending, onAssign }: AssignOwnerSheetProps) {
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => { if (!open) setOwner(null); }, [open]);
  const options = useMemo(
    () => (people ?? []).map((u) => ({ value: String(u.id), label: userName(u), description: u.email || undefined })).sort((a, b) => a.label.localeCompare(b.label)),
    [people],
  );
  const noun = count === 1 ? 'control' : 'controls';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Assign owner"
      subtitle={`${formatCount(count)} ${noun} ticked`}
      width="sm"
      dirty={owner != null}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={owner == null} onClick={() => { if (owner != null) onAssign(Number(owner)); }}>
            {`Assign to ${formatCount(count)} ${noun}`}
          </Button>
        </>
      )}
    >
      {peopleFailed && (
        <Notice tone="warning" title="The list of people could not be loaded" className="mb-[12px]" action={<Button onClick={onRetryPeople}>Retry</Button>}>
          Without it nobody can be chosen.
        </Notice>
      )}
      <FormField label="New owner" required hint="They become the owner of every ticked control. A control that already had an owner is handed over.">
        <Combobox label="New owner" options={options} value={owner} onChange={setOwner} placeholder="Choose a person" disabled={peopleFailed || options.length === 0} />
      </FormField>
    </Sheet>
  );
}
