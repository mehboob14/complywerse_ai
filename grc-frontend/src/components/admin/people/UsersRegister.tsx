'use client';

// Administration > Users: the register of the people who can sign in (also the page behind the user menu's "Users" for a person who holds admin:users:view and is
// not an administrator: one register, two doors). A row opens the person in a sheet (?open=<id>); "Add user" opens the same sheet empty (?add=1). The chips are
// the access-hygiene views (never signed in, no sign-in for 90 days, no role) with their true counts from the complete list; the search, the chip, the role and
// the order live in the address. The row menu offers Deactivate first and Remove permanently last. Rights are the server's: the list needs admin:users:view,
// add :create, change and (de)activate :edit, remove :delete; each action is shown to who holds it. Rules and words: lib/people/usersModel.ts.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Pencil, Plus, Search, UserCheck, UserX, Trash2, Users as UsersIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Avatar, Button, ChipList, EmptyState, ErrorState, FilterChips, Menu, NoAccessState, Pager, RegisterTable, Select, StatusPill, TextInput, useAddressState,
  type FilterChip, type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, statusOf } from '@/components/ui/ds/reportOutcome';
import { flag, integer, oneOf, sortOf, text } from '@/lib/addressState';
import { formatCount, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { userStatus } from '@/lib/statuses/people';
import {
  DEFAULT_USER_SORT, USER_SORT_KEYS, USER_VIEWS, VIEW_HELP, VIEW_LABEL, countsOf, filterUsers, isFiltering, nameOf, ownAccountReason, peopleLine, sortUsers,
  type UserRecord, type UserView,
} from '@/lib/people/usersModel';
import { plainError, useMe, useRoles, useUsers } from './peopleData';
import { useUserActions } from './usersActions';
import { UserSheet } from './UserSheet';

const SCHEMA = { q: text(), view: oneOf(USER_VIEWS, 'all'), role: integer(0, { min: 0 }), sort: sortOf(USER_SORT_KEYS, DEFAULT_USER_SORT), open: integer(0, { min: 1 }), add: flag() };
const PAGE_SIZES = [25, 50, 100] as const;
const short = (name: string, max: number) => (name.length > max ? `${name.slice(0, max)}…` : name);

export default function UsersRegister() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('admin:users:create');
  const canEdit = hasPermission('admin:users:edit');
  const canDelete = hasPermission('admin:users:delete');
  const canSeeUsage = hasPermission('admin:users:view');
  const [a, set] = useAddressState(SCHEMA);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const usersQ = useUsers();
  const rolesQ = useRoles();
  const me = useMe();
  const myId = me.data?.id ?? null;
  const users = useMemo(() => usersQ.data ?? [], [usersQ.data]);
  const now = useMemo(() => Date.now(), [usersQ.dataUpdatedAt]);          // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => countsOf(users, now), [users, now]);
  const filter = useMemo(() => ({ q: a.q, view: a.view as UserView, roleId: a.role }), [a.q, a.view, a.role]);
  const shown = useMemo(() => sortUsers(filterUsers(users, filter, now), a.sort), [users, filter, now, a.sort]);
  const pageClamped = Math.min(pageNo, Math.max(1, Math.ceil(shown.length / pageSize)));
  const pageRows = shown.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);
  const opened = a.open ? users.find((u) => u.id === a.open) ?? null : null;
  const noList = usersQ.isError && !usersQ.data;
  const forbidden = noList && statusOf(usersQ.error) === 403;
  const filtering = isFiltering(filter);

  const actions = useUserActions((u) => { if (a.open === u.id) set({ open: 0 }); });
  const refilter = (patch: Partial<typeof a>) => { set(patch); setPageNo(1); };
  const clear = () => refilter({ q: '', view: 'all', role: 0 });

  const chips: FilterChip[] = USER_VIEWS.map((v) => ({ key: v, label: VIEW_LABEL[v], count: counts[v], active: a.view === v, title: VIEW_HELP[v], hidden: v === 'inactive' && counts.inactive === 0 && a.view !== 'inactive' }));

  const rowMenu = (u: UserRecord): MenuItem[] => {
    const self = ownAccountReason(u, myId);
    return [
      { key: 'open', label: canEdit ? 'Open and edit' : 'Open', icon: Pencil, onSelect: () => set({ open: u.id }) },
      { key: 'usage', label: 'AI usage', icon: BarChart3, hidden: !canSeeUsage, onSelect: () => router.push(`/admin/users/${u.id}/usage`) },
      { key: 'deactivate', label: 'Deactivate', icon: UserX, hidden: !canEdit || !u.is_active, disabled: self !== null, reason: self ?? undefined, onSelect: () => { void actions.askDeactivate(u); } },
      { key: 'reactivate', label: 'Reactivate', icon: UserCheck, hidden: !canEdit || u.is_active, onSelect: () => actions.reactivate(u) },
      { key: 'remove', label: 'Remove permanently', icon: Trash2, danger: true, hidden: !canDelete, disabled: self !== null, reason: self ?? undefined, onSelect: () => { void actions.askRemove(u); } },
    ];
  };

  const columns: RegisterColumn<UserRecord>[] = [
    {
      key: 'name', header: 'Person', isRowHeader: true, sortable: true,
      cell: (u) => (
        <span className="flex min-w-0 items-center gap-[10px]">
          <Avatar name={nameOf(u)} size={32} decorative />
          <span className="block min-w-0">
            <button type="button" onClick={() => set({ open: u.id })} title={nameOf(u)} dir="auto" className="line-clamp-1 max-w-full break-words rounded-ds-control py-[2px] text-left font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{nameOf(u)}</button>
            <span className="block max-w-[320px] truncate text-ds-label text-ds-fg-muted" title={u.email}>{u.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'roles', header: 'Roles', card: 'meta',
      cell: (u) => (u.roles.length === 0 ? <span className="text-ds-fg-muted">No role</span> : <ChipList items={u.roles.map((r) => r.name)} label="roles" />),
    },
    { key: 'seen', header: 'Last sign-in', sortable: true, firstDir: 'desc', priority: 2, width: 'w-[140px]', card: 'meta', cell: (u) => <span className={u.last_login ? 'text-ds-body text-ds-fg-body' : 'text-ds-body text-ds-fg-muted'}>{u.last_login ? formatDate(u.last_login) : 'Never'}</span> },
    { key: 'status', header: 'Status', width: 'w-[120px]', card: 'meta', cell: (u) => <StatusPill size="sm" {...statusPill(userStatus, u.is_active ? 'active' : 'inactive')} /> },
    { key: 'added', header: 'Added', sortable: true, firstDir: 'desc', priority: 3, width: 'w-[130px]', cell: (u) => <span className="text-ds-body text-ds-fg-body">{formatDate(u.created_at)}</span> },
    { key: 'menu', header: 'Actions', align: 'right', width: 'w-[56px]', cell: (u) => <Menu label={`Actions for ${short(nameOf(u), 60)}`} iconOnly items={rowMenu(u)} /> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="Users"
        info="The people who can sign in to this platform. Deactivate an account to stop its sign-in and keep its history; remove it only when it should not exist at all."
        meta={usersQ.isLoading || noList ? undefined : peopleLine(users)}
        actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => set({ add: true })}>Add user</Button> : undefined}
      />

      {forbidden ? (
        <NoAccessState title="You don't have access to the users" reason="Seeing the list of users needs the users right. Ask an administrator." />
      ) : noList ? (
        <ErrorState title="Couldn't load the users" message={plainError(usersQ.error)} onRetry={canRetry(usersQ.error) ? () => { void usersQ.refetch(); } : undefined} />
      ) : (
        <>
          {usersQ.isError && usersQ.data && <ErrorState compact title="Couldn't refresh the users" message={`${plainError(usersQ.error)} What is shown may be out of date.`} onRetry={canRetry(usersQ.error) ? () => { void usersQ.refetch(); } : undefined} />}
          <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
            <FilterChips label="Views" chips={usersQ.isLoading ? [] : chips} onToggle={(key) => refilter({ view: key === a.view && key !== 'all' ? 'all' : (key as UserView) })} overflow="scroll" className="min-w-0 max-w-full" />
            <div className="flex w-full flex-wrap items-center gap-[8px] sm:ml-auto sm:w-auto">
              {(rolesQ.data?.length ?? 0) > 0 && (
                <Select aria-label="Role" className="w-full sm:w-[200px]" value={String(a.role)} onChange={(e) => refilter({ role: Number(e.target.value) })}>
                  <option value="0">All roles</option>
                  {(rolesQ.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.user_count})</option>)}
                </Select>
              )}
              <TextInput
                className="w-full sm:w-[260px]" type="search" aria-label="Search users" placeholder="Search name, username or e-mail" maxLength={100} leftAdornment={<Search aria-hidden />}
                value={a.q} onChange={(e) => refilter({ q: e.target.value })}
              />
            </div>
          </div>

          <RegisterTable
            caption="Users"
            columns={columns}
            rows={pageRows}
            getRowId={(u) => u.id}
            loading={usersQ.isLoading}
            loadingRows={6}
            sort={a.sort}
            onSortChange={(next) => set({ sort: next })}
            selectedId={a.open || null}
            onRowActivate={(u) => set({ open: u.id })}
            empty={users.length === 0 ? (
              <EmptyState bare kind="firstUse" icon={UsersIcon} title="No users yet" description="Add the people who should be able to sign in."
                action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => set({ add: true })}>Add user</Button> : undefined} />
            ) : <EmptyState bare kind="noMatches" title="No user matches" description="Try other words, another view or another role." onClearFilters={filtering ? clear : undefined} />}
            cardTitle={(u) => <span className="flex min-w-0 items-center gap-[8px]"><Avatar name={nameOf(u)} size={32} decorative /><span className="block min-w-0"><span className="line-clamp-1 break-words" dir="auto">{nameOf(u)}</span><span className="block truncate text-ds-label font-normal text-ds-fg-muted">{u.email}</span></span></span>}
            cardActions={(u) => <Menu label={`Actions for ${short(nameOf(u), 50)}`} iconOnly items={rowMenu(u)} />}
            footer={shown.length > 0 ? <Pager page={pageClamped} pageSize={pageSize} total={shown.length} noun={{ one: 'user', other: 'users' }} pageSizes={PAGE_SIZES} onPage={setPageNo} onPageSize={(n) => { setPageSize(n); setPageNo(1); }} /> : undefined}
          />
          {!usersQ.isLoading && filtering && users.length > 0 && <p className="text-ds-label text-ds-fg-muted">Showing {formatCount(shown.length)} of {formatCount(users.length)} users.</p>}
        </>
      )}

      {(a.add || (a.open > 0 && opened)) && (
        <UserSheet
          key={a.add ? 'new' : opened?.id}
          user={a.add ? null : opened}
          roles={rolesQ.data}
          rolesLoading={rolesQ.isLoading}
          rolesError={rolesQ.isError && !rolesQ.data ? rolesQ.error : null}
          onRetryRoles={() => { void rolesQ.refetch(); }}
          canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} canSeeUsage={canSeeUsage}
          myId={myId} actions={actions}
          onClose={() => set({ open: 0, add: false })}
        />
      )}
      {a.open > 0 && !opened && !usersQ.isLoading && !noList && (
        <p role="status" className="text-ds-body text-ds-fg-muted">That user is not in the list. They may have been removed.</p>
      )}
      {actions.ui}
    </div>
  );
}
