'use client';

// Administration > Roles & permissions: the register of roles (name, how many people hold it, how much of the permission list it holds) and, when one is opened
// (?role=<id>) or a new one started (?role=new), the role editor in its place. Everything the old page did is here: search, the people who hold a role, create,
// view or edit, delete. Rights are the server's: the list needs admin:users:view, the permission list admin:permissions:view, the people of a role admin:roles:view,
// create / edit / delete admin:roles:create / :edit / :delete; a person sees each action only if they hold its right. Rules and words: lib/people/rolesModel.ts.
import { useMemo } from 'react';
import { Pencil, Plus, Search, ShieldCheck, Trash2, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Button, EmptyState, ErrorState, Menu, NoAccessState, Notice, RegisterTable, SkeletonLines, StatusPill, TextInput, useAddressState, useConfirm, useReportedMutation,
  type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, statusOf } from '@/components/ui/ds/reportOutcome';
import { integer, sortOf, text } from '@/lib/addressState';
import { adminApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { roleKind } from '@/lib/statuses/people';
import { DEFAULT_ROLE_SORT, ROLE_SORT_KEYS, deleteBlock, deleteRoleText, filterRoles, permissionSummary, sortRoles, type RoleRecord } from '@/lib/people/rolesModel';
import { ROLES_KEY, USERS_KEY, plainError, useMatrix, useMe, useRoles } from './peopleData';
import { useQueryClient } from '@tanstack/react-query';
import { MembersSheet } from './MembersSheet';
import { RoleEditor } from './RoleEditor';

const SCHEMA = { q: text(), sort: sortOf(ROLE_SORT_KEYS, DEFAULT_ROLE_SORT), role: text(), people: integer(0, { min: 1 }) };
const short = (name: string, max: number) => (name.length > max ? `${name.slice(0, max)}…` : name);

export default function RolesRegister() {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('admin:roles:create');
  const canEdit = hasPermission('admin:roles:edit');
  const canDelete = hasPermission('admin:roles:delete');
  const [a, set] = useAddressState(SCHEMA);
  const rolesQ = useRoles();
  const matrixQ = useMatrix();
  const me = useMe();
  const { confirm, confirmDialog } = useConfirm();

  const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
  const shown = useMemo(() => sortRoles(filterRoles(roles, a.q), a.sort), [roles, a.q, a.sort]);
  const noList = rolesQ.isError && !rolesQ.data;
  const forbidden = noList && statusOf(rolesQ.error) === 403;
  const matrix = matrixQ.data;

  const remove = useReportedMutation({
    mutationFn: (role: RoleRecord) => adminApi.deleteRole(role.id),
    success: (_r, role) => `The role "${role.name}" was deleted`,
    failure: "The role wasn't deleted",
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ROLES_KEY }); void qc.invalidateQueries({ queryKey: USERS_KEY }); },
  });
  const askDelete = async (role: RoleRecord) => {
    if (await confirm({ ...deleteRoleText(role.name), tone: 'danger' })) remove.mutate(role);
  };

  // ---- the editor takes the page when a role is open ----
  const editing = a.role !== '';
  const editedId = /^\d+$/.test(a.role) ? Number(a.role) : null;
  const edited = editedId !== null ? roles.find((r) => r.id === editedId) ?? null : null;
  const back = () => set({ role: '' });

  if (editing) {
    const creating = a.role === 'new';
    return (
      <>
        {rolesQ.isLoading ? (
          <div className="flex flex-col gap-[16px]"><PageHeader variant="page" title="Roles & permissions" /><SkeletonLines lines={6} label="Loading the role" /></div>
        ) : noList ? (
          <div className="flex flex-col gap-[16px]">
            <PageHeader variant="page" title="Roles & permissions" />
            {forbidden
              ? <NoAccessState title="You don't have access to the roles" reason="Seeing roles needs the users right. Ask an administrator." action={<Button onClick={back}>Back to roles</Button>} />
              : <ErrorState title="Couldn't load the role" message={plainError(rolesQ.error)} onRetry={canRetry(rolesQ.error) ? () => { void rolesQ.refetch(); } : undefined} />}
          </div>
        ) : creating && !canCreate ? (
          <div className="flex flex-col gap-[16px]">
            <PageHeader variant="page" title="Roles & permissions" />
            <NoAccessState title="You can't create roles" reason="Creating a role needs the right to create roles. Ask an administrator." action={<Button onClick={back}>Back to roles</Button>} />
          </div>
        ) : !creating && !edited ? (
          <div className="flex flex-col gap-[16px]">
            <PageHeader variant="page" title="Roles & permissions" />
            <Notice tone="warning" title="That role is not in the list" action={<Button variant="ghost" onClick={back}>Back to roles</Button>}>It may have been deleted.</Notice>
          </div>
        ) : (
          <RoleEditor
            key={creating ? 'new' : edited?.id}
            role={creating ? null : edited}
            matrix={matrix} matrixLoading={matrixQ.isLoading} matrixError={matrixQ.isError ? matrixQ.error : null} onRetryMatrix={() => { void matrixQ.refetch(); }}
            features={me.data?.features ?? []}
            canEdit={creating ? canCreate : canEdit} canDelete={canDelete}
            onBack={back} onOpenMembers={() => set({ people: edited?.id ?? 0 })}
            onCreated={(id) => set({ role: String(id) })}
          />
        )}
        {a.people > 0 && edited && edited.id === a.people && <MembersSheet role={edited} onClose={() => set({ people: 0 })} />}
        {confirmDialog}
      </>
    );
  }

  // ---- the register ----
  const peopleRole = a.people > 0 ? roles.find((r) => r.id === a.people) ?? null : null;
  const rowMenu = (r: RoleRecord): MenuItem[] => {
    const block = deleteBlock(r);
    return [
      { key: 'open', label: canEdit && r.name !== 'Administrator' ? 'Open and edit' : 'Open', icon: Pencil, onSelect: () => set({ role: String(r.id) }) },
      { key: 'people', label: 'See the people', icon: Users, hidden: r.user_count === 0, onSelect: () => set({ people: r.id }) },
      { key: 'delete', label: 'Delete role', icon: Trash2, danger: true, hidden: !canDelete || r.is_system_role, disabled: block !== null, reason: block ?? undefined, onSelect: () => { void askDelete(r); } },
    ];
  };

  const columns: RegisterColumn<RoleRecord>[] = [
    {
      key: 'name', header: 'Role', isRowHeader: true, sortable: true,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-[8px]">
            <button type="button" onClick={() => set({ role: String(r.id) })} title={r.name} dir="auto" className="line-clamp-1 max-w-full break-words rounded-ds-control py-[2px] text-left font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.name}</button>
            {r.is_system_role && <StatusPill size="sm" {...statusPill(roleKind, 'system')} />}
          </span>
          {r.description && <span className="line-clamp-2 break-words text-ds-label text-ds-fg-muted" title={r.description}>{r.description}</span>}
        </span>
      ),
    },
    {
      key: 'people', header: 'People', sortable: true, firstDir: 'desc', align: 'right', width: 'w-[110px]', card: 'meta',
      cell: (r) => (r.user_count > 0
        ? <button type="button" onClick={() => set({ people: r.id })} aria-label={`${r.user_count} ${r.user_count === 1 ? 'person holds' : 'people hold'} ${r.name}. See them`} className="inline-flex min-h-ds-control-sm items-center gap-[4px] rounded-ds-control px-[6px] tabular-nums text-ds-fg-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"><Users aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />{formatCount(r.user_count)}</button>
        : <span className="tabular-nums text-ds-fg-muted">0</span>),
    },
    {
      key: 'permissions', header: 'Permissions', sortable: true, firstDir: 'desc', width: 'w-[150px]', card: 'meta',
      cell: (r) => <span className="inline-flex items-center gap-[4px] tabular-nums text-ds-body text-ds-fg-body">{r.name === 'Administrator' && <ShieldCheck aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />}{permissionSummary(r, matrix ?? null)}</span>,
    },
    { key: 'menu', header: 'Actions', align: 'right', width: 'w-[56px]', cell: (r) => <Menu label={`Actions for ${short(r.name, 60)}`} iconOnly items={rowMenu(r)} /> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="Roles & permissions"
        info="A role is a named set of permissions. Give roles to people on the Users page. Open a role to see and change what it may do."
        meta={rolesQ.isLoading || noList ? undefined : `${formatCount(roles.length)} ${roles.length === 1 ? 'role' : 'roles'}`}
        actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => set({ role: 'new' })}>New role</Button> : undefined}
      />

      {forbidden ? (
        <NoAccessState title="You don't have access to the roles" reason="Seeing the list of roles needs the users right. Ask an administrator." />
      ) : noList ? (
        <ErrorState title="Couldn't load the roles" message={plainError(rolesQ.error)} onRetry={canRetry(rolesQ.error) ? () => { void rolesQ.refetch(); } : undefined} />
      ) : (
        <>
          {rolesQ.isError && rolesQ.data && <ErrorState compact title="Couldn't refresh the roles" message={`${plainError(rolesQ.error)} What is shown may be out of date.`} onRetry={canRetry(rolesQ.error) ? () => { void rolesQ.refetch(); } : undefined} />}
          {matrixQ.isError && statusOf(matrixQ.error) === 403 && <Notice tone="info">You can see the roles but not the permission list, so the Permissions column shows counts only.</Notice>}
          <div className="flex flex-wrap items-center gap-[8px]">
            <TextInput
              className="w-full sm:w-[320px]" type="search" aria-label="Search roles" placeholder="Search roles" maxLength={100} leftAdornment={<Search aria-hidden />}
              value={a.q} onChange={(e) => set({ q: e.target.value })}
            />
          </div>
          <RegisterTable
            caption="Roles"
            columns={columns}
            rows={shown}
            getRowId={(r) => r.id}
            loading={rolesQ.isLoading}
            loadingRows={5}
            sort={a.sort}
            onSortChange={(next) => set({ sort: next })}
            onRowActivate={(r) => set({ role: String(r.id) })}
            empty={roles.length === 0
              ? <EmptyState bare kind="firstUse" title="No roles yet" description="A role is a named set of permissions." action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => set({ role: 'new' })}>New role</Button> : undefined} />
              : <EmptyState bare kind="noMatches" title="No role matches" description="Try other words." onClearFilters={a.q.trim() ? () => set({ q: '' }) : undefined} />}
            cardTitle={(r) => <span className="block min-w-0"><span className="line-clamp-1 break-words" dir="auto">{r.name}</span>{r.description && <span className="line-clamp-2 break-words text-ds-label font-normal text-ds-fg-muted">{r.description}</span>}</span>}
            cardActions={(r) => <Menu label={`Actions for ${short(r.name, 50)}`} iconOnly items={rowMenu(r)} />}
          />
        </>
      )}
      {peopleRole && <MembersSheet role={peopleRole} onClose={() => set({ people: 0 })} />}
      {confirmDialog}
    </div>
  );
}
