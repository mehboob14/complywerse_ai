'use client';

// The members of one department, in a sheet over the departments page (Administration > Departments). A department's people are the ones added by hand, its owner,
// and everyone who holds one of its roles (they join and leave with the role: the roles are chosen under Edit). Anyone who can open the page reads the list; adding,
// changing a role and removing need admin:organization:edit (the server asks for it too). Every change says what happened or why it did not (a refusal keeps the
// server's own words), and a failed one can be tried again. The words and rules that need no screen are in lib/departments.ts.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { departmentsApi, type Department, type DepartmentMember, type DepartmentMemberRole } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { MEMBER_ROLES, howChips, memberSummary, removeBlock } from '@/lib/departments';
import { Button, Combobox, EmptyState, ErrorState, FormField, Select, Sheet, SkeletonRows, StatusPill, useReportedMutation, type ListOption } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useTenantUsers } from '@/components/admin/DepartmentForm';

const CHIP_TONE = { lead: 'success', hand: 'progress', role: 'neutral' } as const;

export function DepartmentMembers({ department, canEdit, onClose, onChanged }: { department: Department; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const key = ['admin-department', department.id];
  const detail = useQuery({ queryKey: key, queryFn: () => departmentsApi.get(department.id).then((r) => r.data) });
  const users = useTenantUsers(canEdit);
  const [person, setPerson] = useState<string | null>(null);
  const [role, setRole] = useState<DepartmentMemberRole>('member');
  const members = detail.data?.members ?? [];

  const changed = () => { void qc.invalidateQueries({ queryKey: key }); onChanged(); };
  const add = useReportedMutation({
    mutationFn: () => departmentsApi.addMember(department.id, { user_id: Number(person), role }),
    success: () => `Added to ${department.name}`,
    failure: "The person wasn't added",
    onSuccess: () => { setPerson(null); changed(); },
  });
  const setMemberRole = useReportedMutation({
    mutationFn: ({ userId, next }: { userId: number; next: DepartmentMemberRole }) => departmentsApi.updateMember(department.id, userId, { role: next }),
    success: 'Role changed',
    failure: "The role wasn't changed",
    onSuccess: changed,
  });
  const remove = useReportedMutation({
    mutationFn: (m: DepartmentMember) => departmentsApi.removeMember(department.id, m.user_id),
    success: (_r, m) => `${m.name} removed from ${department.name}`,
    failure: "The person wasn't removed",
    onSuccess: changed,
  });
  const busy = add.isPending || setMemberRole.isPending || remove.isPending;

  // anyone can be added by hand, also a person who belongs through a role (they then stay if the role is taken off)
  const options = useMemo<ListOption[]>(
    () => (users.data ?? []).filter((u) => !members.some((m) => m.user_id === u.id && m.how.includes('manual'))).map((u) => ({ value: String(u.id), label: u.display_name, description: u.email })),
    [users.data, members],
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Members of ${department.name}`}
      subtitle={detail.data ? (members.length === 0 ? 'No members yet' : memberSummary(members)) : undefined}
      width="lg"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {canEdit && (
        <div className="mb-[16px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          <div className="flex flex-wrap items-end gap-[8px]">
            <FormField label="Add a person" className="min-w-[200px] flex-1">
              <Combobox label="Person" options={options} value={person} onChange={setPerson} placeholder={users.isLoading ? 'Loading people' : 'Choose a person'} searchPlaceholder="Search people" disabled={users.isLoading || users.isError} />
            </FormField>
            <FormField label="Role in the department">
              <Select value={role} onChange={(e) => setRole(e.target.value as DepartmentMemberRole)} className="w-[140px]">
                {MEMBER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </FormField>
            <Button variant="primary" leftIcon={<UserPlus aria-hidden />} loading={add.isPending} disabled={person === null || busy} onClick={() => add.mutate()}>Add</Button>
          </div>
          {users.isError && <p role="alert" className="mt-[8px] text-ds-label text-ds-danger">The people could not be loaded. {errorMessage(users.error)}</p>}
        </div>
      )}

      {detail.isLoading ? (
        <SkeletonRows rows={4} columns={3} label="Loading the members" />
      ) : detail.isError ? (
        <ErrorState title="Couldn't load the members" message={errorMessage(detail.error)} onRetry={canRetry(detail.error) ? () => { void detail.refetch(); } : undefined} />
      ) : members.length === 0 ? (
        <EmptyState kind="firstUse" bare icon={UserPlus} title="No members yet" info={canEdit ? 'Add a person above, or give the department a role under Edit.' : undefined} />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {members.map((m) => {
            const byHand = m.how.includes('manual');
            return (
              <li key={m.user_id} className="flex flex-wrap items-start gap-x-[16px] gap-y-[8px] border-b border-ds-border py-[12px] last:border-b-0">
                <div className="min-w-[180px] flex-1">
                  <p className="text-ds-body font-[600] text-ds-fg">{m.name}</p>
                  <p className="break-all text-ds-label text-ds-fg-muted">{m.email}{m.designation ? ` · ${m.designation}` : ''}</p>
                  <div className="mt-[6px] flex flex-wrap gap-[6px]">
                    {howChips(m).map((c) => <StatusPill key={c.key} size="sm" tone={CHIP_TONE[c.kind]} label={c.label} />)}
                  </div>
                  {m.added_at && <p className="mt-[4px] text-ds-label text-ds-fg-muted">Added {formatDate(m.added_at)}</p>}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-[8px]">
                    {byHand && (
                      <Select aria-label={`Role of ${m.name} in the department`} value={m.member_role ?? 'member'} disabled={busy} className="w-[120px]"
                        onChange={(e) => setMemberRole.mutate({ userId: m.user_id, next: e.target.value as DepartmentMemberRole })}>
                        {MEMBER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </Select>
                    )}
                    {removeBlock(m) === null
                      ? <Button size="sm" leftIcon={<X aria-hidden />} disabled={busy} onClick={() => remove.mutate(m)}>Remove<span className="sr-only"> {m.name}</span></Button>
                      : <span className="max-w-[200px] text-ds-label text-ds-fg-muted">{removeBlock(m)}</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
