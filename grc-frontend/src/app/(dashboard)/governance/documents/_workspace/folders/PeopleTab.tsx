'use client';

// The People tab of a unit's popup: who belongs to it and how. A unit's people are the ones added by hand, its owner, and everyone who holds one of its roles (they join and
// leave with the role). Anyone who can open the library reads the list; a person who may manage the unit adds someone by hand with a role (Lead, Member, Viewer), changes
// that role, removes someone added by hand, and chooses which roles give membership. Someone who belongs through a role or as the owner is not removed here: the row says
// how to (lib/departments.ts removeBlock). Roles give membership only: they grant no access to documents. Every change says what happened, or why not in the server's
// words; a failed one can be tried again. The requests and rules are the ones Administration → Departments uses (departmentsApi, lib/departments.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { departmentsApi, type DepartmentMember, type DepartmentMemberRole } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { MEMBER_ROLES, howChips, memberSummary, removeBlock, roleItems, userItems } from '@/lib/departments';
import { Button, Combobox, EmptyState, ErrorState, FormField, MultiSelect, Select, SkeletonRows, StatusPill, useReportedMutation, type ListOption } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { InfoTip } from '@/components/ui/InfoTip';
import { useTenantUsers } from '@/components/admin/DepartmentForm';
import { useRefreshDirectory } from './directoryData';
import type { DirectoryTabProps } from './directoryTabs';

const CHIP_TONE = { lead: 'success', hand: 'progress', role: 'neutral' } as const;
const ROLES_NOTE = 'Everyone who holds one of these roles is a member of this unit. Roles give membership only: they grant no access to documents.';

export function PeopleTab({ node, canManage, setDirty }: DirectoryTabProps) {
  const refresh = useRefreshDirectory();
  const key = ['admin-department', node.id];
  const detail = useQuery({ queryKey: key, queryFn: () => departmentsApi.get(node.id).then((r) => r.data) });
  const users = useTenantUsers(canManage);
  const [person, setPerson] = useState<string | null>(null);
  const [role, setRole] = useState<DepartmentMemberRole>('member');
  const members = detail.data?.members ?? [];

  const add = useReportedMutation({
    mutationFn: () => departmentsApi.addMember(node.id, { user_id: Number(person), role }),
    success: `Added to ${node.name}`,
    failure: "The person wasn't added",
    onSuccess: () => { setPerson(null); refresh(); },
  });
  const changeRole = useReportedMutation({
    mutationFn: ({ userId, next }: { userId: number; next: DepartmentMemberRole }) => departmentsApi.updateMember(node.id, userId, { role: next }),
    success: 'Role changed',
    failure: "The role wasn't changed",
    onSuccess: refresh,
  });
  const remove = useReportedMutation({
    mutationFn: (m: DepartmentMember) => departmentsApi.removeMember(node.id, m.user_id),
    success: (_r, m) => `${m.name} removed from ${node.name}`,
    failure: "The person wasn't removed",
    onSuccess: refresh,
  });
  const busy = add.isPending || changeRole.isPending || remove.isPending;

  // anyone can be added by hand, also a person who belongs through a role (they then stay if the role is taken off)
  const options = useMemo<ListOption[]>(
    () => userItems(users.data).filter((u) => !members.some((m) => String(m.user_id) === u.value && m.how.includes('manual'))).map((u) => ({ value: u.value, label: u.label, description: u.subLabel })),
    [users.data, members],
  );

  return (
    <div className="flex flex-col gap-[16px]">
      {canManage && (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          <div className="flex flex-wrap items-end gap-[8px]">
            <FormField label="Add a person" className="min-w-[200px] flex-1">
              <Combobox label="Person" options={options} value={person} onChange={setPerson} placeholder={users.isLoading ? 'Loading people' : 'Choose a person'} searchPlaceholder="Search people" disabled={users.isLoading || users.isError} />
            </FormField>
            <FormField label="Role" info="Lead, Member or Viewer: what the person is in this unit. It grants no access to documents.">
              <Select value={role} onChange={(e) => setRole(e.target.value as DepartmentMemberRole)} className="w-[140px]">
                {MEMBER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </FormField>
            <Button variant="primary" leftIcon={<UserPlus aria-hidden />} loading={add.isPending} disabled={person === null || busy} onClick={() => add.mutate()}>Add</Button>
          </div>
          {users.isError && <p role="alert" className="mt-[8px] text-ds-label font-normal text-ds-danger">The people could not be loaded. {errorMessage(users.error)}</p>}
        </div>
      )}

      {detail.isLoading ? (
        <SkeletonRows rows={4} columns={3} label="Loading the people" />
      ) : detail.isError ? (
        <ErrorState title="Couldn't load the people" message={errorMessage(detail.error)} onRetry={canRetry(detail.error) ? () => { void detail.refetch(); } : undefined} />
      ) : (
        <section aria-label="People" className="min-w-0">
          {members.length > 0 && <p className="mb-[4px] text-ds-body text-ds-fg-muted">{memberSummary(members)}</p>}
          {members.length === 0 ? (
            <EmptyState kind="firstUse" bare icon={UserPlus} title="No people yet" info={canManage ? 'Add a person above, or choose a role below: everyone who holds it joins.' : undefined} />
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {members.map((m) => {
                const byHand = m.how.includes('manual');
                const why = removeBlock(m);
                return (
                  <li key={m.user_id} className="flex flex-wrap items-start gap-x-[16px] gap-y-[8px] border-b border-ds-border py-[12px] last:border-b-0">
                    <div className="min-w-[180px] flex-1">
                      <p className="text-ds-body font-[600] text-ds-fg">{m.name}</p>
                      <p className="break-all text-ds-label font-normal text-ds-fg-muted">{m.email}{m.designation ? ` · ${m.designation}` : ''}</p>
                      <div className="mt-[6px] flex flex-wrap gap-[6px]">
                        {howChips(m).map((c) => <StatusPill key={c.key} size="sm" tone={CHIP_TONE[c.kind]} label={c.label} />)}
                      </div>
                      {m.added_at && <p className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">Added {formatDate(m.added_at)}</p>}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-[8px]">
                        {byHand && (
                          <Select aria-label={`Role of ${m.name} in ${node.name}`} value={m.member_role ?? 'member'} disabled={busy} className="w-[120px]"
                            onChange={(e) => changeRole.mutate({ userId: m.user_id, next: e.target.value as DepartmentMemberRole })}>
                            {MEMBER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </Select>
                        )}
                        {why === null
                          ? <Button size="sm" leftIcon={<X aria-hidden />} disabled={busy} onClick={() => remove.mutate(m)}>Remove<span className="sr-only"> {m.name}</span></Button>
                          : <span className="max-w-[220px] text-ds-label font-normal text-ds-fg-muted">{why}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {detail.data && <RolesBox key={detail.data.updated_at} node={node} canManage={canManage} roles={detail.data.roles} setDirty={setDirty} onSaved={refresh} />}
    </div>
  );
}

/** The roles that give membership: chosen here, saved together (a PUT replaces the set). Without the right to manage the unit they are read as chips. */
function RolesBox({ node, canManage, roles, setDirty, onSaved }: { node: DirectoryTabProps['node']; canManage: boolean; roles: Array<{ id: number; name: string }>; setDirty: (dirty: boolean) => void; onSaved: () => void }) {
  const options = useQuery({ queryKey: ['department-role-options'], queryFn: () => departmentsApi.roleOptions().then((r) => r.data), staleTime: 60_000, enabled: canManage });
  const [ids, setIds] = useState<string[]>(() => roles.map((r) => String(r.id)));
  const was = useMemo(() => roles.map((r) => String(r.id)).sort().join(','), [roles]);
  const changed = [...ids].sort().join(',') !== was;
  const report = useRef(setDirty);
  report.current = setDirty;
  useEffect(() => { report.current(changed); }, [changed]);
  useEffect(() => () => report.current(false), []);
  const items = useMemo(() => roleItems(options.data, roles), [options.data, roles]);
  const save = useReportedMutation({
    mutationFn: () => departmentsApi.setRoles(node.id, ids.map(Number)),
    success: `Roles of ${node.name} saved`,
    failure: "The roles weren't saved",
    onSuccess: onSaved,
  });
  return (
    <section aria-label="Roles" className="min-w-0 border-t border-ds-border pt-[16px]">
      <div className="mb-[8px] flex items-center gap-[4px]">
        <h3 className="!text-ds-section !text-ds-fg">Roles</h3>
        <InfoTip text={ROLES_NOTE} label="About roles" />
      </div>
      {!canManage ? (
        roles.length === 0 ? <p className="text-ds-body text-ds-fg-muted">No roles</p> : (
          <div className="flex flex-wrap gap-[6px]">{roles.map((r) => <StatusPill key={r.id} size="sm" tone="neutral" label={r.name} />)}</div>
        )
      ) : options.isError ? (
        <ErrorState compact title="Couldn't load the roles" message={errorMessage(options.error)} onRetry={canRetry(options.error) ? () => { void options.refetch(); } : undefined} />
      ) : (
        <div className="flex flex-wrap items-center gap-[8px]">
          <div className="min-w-[220px] flex-1">
            <MultiSelect label="Roles" options={items.map((i) => ({ value: i.value, label: i.label, description: i.subLabel }))} value={ids} onChange={setIds}
              display="chips" placeholder={options.isLoading ? 'Loading roles' : 'No roles'} searchPlaceholder="Search roles" disabled={options.isLoading} />
          </div>
          <Button variant="primary" loading={save.isPending} disabled={!changed} onClick={() => save.mutate()}>Save roles</Button>
        </div>
      )}
    </section>
  );
}
