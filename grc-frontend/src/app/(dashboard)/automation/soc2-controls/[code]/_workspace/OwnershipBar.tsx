'use client';

// Who owns the control, who reviews it, who works on it: three pickers that save as soon as a person is chosen, and say so. The server keeps the old owner or reviewer when it is sent none
// (scf/ownership.py assign_ownership), so those two are replaced, never cleared; the assignees can be emptied. Without the right to assign, the pickers are shown, disabled, with the reason.
import { useEffect, useMemo, useState } from 'react';
import { Combobox, MultiSelect, Button, type ListOption } from '@/components/ui/ds';
import { useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { scfApi } from '@/lib/api';
import { useTenantUsers, userName } from '../../_explorer/controlsData';

interface Props {
  code: string;
  scopeId: number | null | undefined;
  ownerId: number | null | undefined;
  reviewerId: number | null | undefined;
  assignedIds: readonly number[] | null | undefined;
  canAssign: boolean;
  noRight?: string;
  onSaved: () => void;
}

const Label = ({ children }: { children: string }) => <p className="mb-[2px] text-ds-label text-ds-fg-muted">{children}</p>;

export function OwnershipBar({ code, scopeId, ownerId, reviewerId, assignedIds, canAssign, noRight, onSaved }: Props) {
  const users = useTenantUsers();
  const [owner, setOwner] = useState<string | null>(ownerId != null ? String(ownerId) : null);
  const [reviewer, setReviewer] = useState<string | null>(reviewerId != null ? String(reviewerId) : null);
  const [assignees, setAssignees] = useState<string[]>((assignedIds ?? []).map(String));
  const assignedKey = (assignedIds ?? []).join(',');
  useEffect(() => { setOwner(ownerId != null ? String(ownerId) : null); }, [ownerId]);
  useEffect(() => { setReviewer(reviewerId != null ? String(reviewerId) : null); }, [reviewerId]);
  useEffect(() => { setAssignees((assignedIds ?? []).map(String)); }, [assignedKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const options: ListOption[] = useMemo(() => (users.data ?? []).map((u) => ({ value: String(u.id), label: userName(u), description: u.email || undefined })), [users.data]);

  const save = useReportedMutation({
    mutationFn: async (next: { owner: string | null; reviewer: string | null; assignees: string[] }) => {
      if (!scopeId) throw new Error('The scope of your controls has not been set up yet.');
      return scfApi.setOwnership(scopeId, code, {
        owner_user_id: next.owner ? Number(next.owner) : null,
        reviewer_user_id: next.reviewer ? Number(next.reviewer) : null,
        assigned_user_ids: next.assignees.map(Number),
      });
    },
    success: { title: 'Saved', message: 'The owner, reviewer and assignees are updated.' },
    failure: "Couldn't save who is responsible",
    onSuccess: onSaved,
    onError: () => { setOwner(ownerId != null ? String(ownerId) : null); setReviewer(reviewerId != null ? String(reviewerId) : null); setAssignees((assignedIds ?? []).map(String)); },
  });
  const pick = (patch: Partial<{ owner: string | null; reviewer: string | null; assignees: string[] }>) => {
    const next = { owner, reviewer, assignees, ...patch };
    setOwner(next.owner); setReviewer(next.reviewer); setAssignees(next.assignees);
    save.mutate(next);
  };

  const off = !canAssign || !scopeId || users.isPending || users.isError;
  const reason = !canAssign ? noRight : !scopeId ? 'Choose your frameworks first: owners are set within a scope.' : undefined;
  return (
    <div className="flex flex-wrap items-end gap-x-[16px] gap-y-[8px]" aria-busy={save.isPending || undefined}>
      <div className="w-full sm:w-[200px]" title={reason}>
        <Label>Owner</Label>
        <Combobox label="Owner" options={options} value={owner} onChange={(v) => { if (v) pick({ owner: v }); }} placeholder="Unassigned" disabled={off || save.isPending} searchPlaceholder="Search people" />
      </div>
      <div className="w-full sm:w-[200px]" title={reason}>
        <Label>Reviewer</Label>
        <Combobox label="Reviewer" options={options} value={reviewer} onChange={(v) => { if (v) pick({ reviewer: v }); }} placeholder="Unassigned" disabled={off || save.isPending} searchPlaceholder="Search people" />
      </div>
      <div className="w-full sm:w-[220px]" title={reason}>
        <Label>Assignees</Label>
        <MultiSelect label="Assignees" options={options} value={assignees} onChange={(v) => pick({ assignees: v })} placeholder="Nobody yet" display="chips" disabled={off || save.isPending} searchPlaceholder="Search people" />
      </div>
      {users.isError && (
        <div className="flex items-center gap-[8px] pb-[4px]">
          <span className="text-ds-label text-ds-danger">{`People couldn’t be loaded. ${errorMessage(users.error)}`}</span>
          <Button size="sm" onClick={() => { void users.refetch(); }}>Retry</Button>
        </div>
      )}
    </div>
  );
}
