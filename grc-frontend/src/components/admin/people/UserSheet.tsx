'use client';

// One person, in a sheet over the Users register: to add a user, or to see and change one. Details (display name, e-mail; the username is fixed), Roles (a checkbox
// each, with a search when there are many) and Account (status, last sign-in, when added, the AI usage, Deactivate / Reactivate, and Remove permanently last).
// Only what changed is sent (usersModel.updateBody); a person who cannot edit reads the same facts. The sheet asks before typed input is thrown away. A refusal
// stays in the sheet in the server's own words. The password of a new user is checked line by line against the policy the server reads (the server stays the judge)
// and is never shown again, stored or logged by this page.
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, Check, Circle, UserCheck, UserX } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  blankForm, createBody, formErrors, formOfUser, isDirty, nameOf, ownAccountReason, passwordChecks, passwordProblems, toggleId, updateBody, type UserForm, type UserRecord,
} from '@/lib/people/usersModel';
import type { RoleRecord } from '@/lib/people/rolesModel';
import { userStatus } from '@/lib/statuses/people';
import { statusPill } from '@/lib/status';
import {
  Button, ErrorState, FactList, Fact, FormField, Notice, Sheet, SkeletonLines, StatusPill, TextInput, Checkbox, useReportedMutation,
} from '@/components/ui/ds';
import { ROLES_KEY, USERS_KEY, plainError, usePolicy } from './peopleData';
import type { UserActions } from './usersActions';

const SEARCH_ROLES_FROM = 8;
const HEADING = '!text-ds-label !text-ds-fg font-[600]';

export interface UserSheetProps {
  /** a person to see or change; null adds a new user */
  user: UserRecord | null;
  roles: RoleRecord[] | undefined;
  rolesLoading: boolean;
  rolesError: unknown;
  onRetryRoles: () => void;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSeeUsage: boolean;
  myId: number | null;
  actions: UserActions;
  onClose: () => void;
}

export function UserSheet({ user, roles, rolesLoading, rolesError, onRetryRoles, canCreate, canEdit, canDelete, canSeeUsage, myId, actions, onClose }: UserSheetProps) {
  const qc = useQueryClient();
  const creating = user === null;
  const mayChange = creating ? canCreate : canEdit;
  const saved = useMemo(() => (user ? formOfUser(user) : blankForm()), [user]);
  const [form, setForm] = useState<UserForm>(saved);
  const [serverError, setServerError] = useState<string | null>(null);
  const [roleSearch, setRoleSearch] = useState('');
  const policy = usePolicy(creating);
  const rolesKnown = roles !== undefined;

  const problems = creating ? passwordProblems(policy.data, form.password) : [];
  const errors = formErrors(form, creating ? 'create' : 'edit', problems);
  const invalid = Object.keys(errors).length > 0;
  const dirty = creating ? (form.username !== '' || form.email !== '' || form.displayName !== '' || form.password !== '' || form.roleIds.length > 0) : isDirty(saved, form);
  const [showErrors, setShowErrors] = useState(false);

  const refresh = () => { void qc.invalidateQueries({ queryKey: USERS_KEY }); void qc.invalidateQueries({ queryKey: ROLES_KEY }); };
  const create = useReportedMutation({
    mutationFn: () => adminApi.createUser(createBody(form)),
    // an account an access review had imported with this e-mail became this user: the server says so in its own words
    success: (r) => (r.data?.adopted ? `${r.data.message}.` : `${form.displayName.trim() || form.username.trim()} was added`),
    failure: "The user wasn't added",
    retryable: false,
    toast: 'success',
    onSuccess: () => { refresh(); onClose(); },
    onError: (e) => setServerError(plainError(e, "The user wasn't added. Try again.")),
  });
  const update = useReportedMutation({
    mutationFn: () => adminApi.updateUser((user as UserRecord).id, updateBody(saved, form, rolesKnown)),
    success: 'Changes saved',
    failure: "The changes weren't saved",
    retryable: false,
    toast: 'success',
    onSuccess: () => { refresh(); onClose(); },
    onError: (e) => setServerError(plainError(e, "The changes weren't saved. Try again.")),
  });
  const saving = create.isPending || update.isPending;

  const set = (patch: Partial<UserForm>) => { setForm({ ...form, ...patch }); setServerError(null); };
  const submit = () => {
    setShowErrors(true);
    if (invalid || !dirty) return;
    setServerError(null);
    (creating ? create : update).mutate();
  };

  // the roles the person held when the sheet opened come first (a person's own roles are what one looks for), the rest by name; the order does not move as boxes are ticked
  const held = (id: number) => (saved.roleIds.includes(id) ? 0 : 1);
  const visibleRoles = (roles ?? []).slice().sort((x, y) => held(x.id) - held(y.id) || x.name.localeCompare(y.name))
    .filter((r) => roleSearch.trim() === '' || r.name.toLowerCase().includes(roleSearch.trim().toLowerCase()) || (r.description ?? '').toLowerCase().includes(roleSearch.trim().toLowerCase()));
  const self = user ? ownAccountReason(user, myId) : null;
  const busy = user !== null && actions.busyId === user.id;

  const footer = mayChange ? (
    <div className="flex flex-wrap justify-end gap-[8px]">
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={saving} disabled={!creating && !dirty} onClick={submit}>{creating ? 'Add user' : 'Save changes'}</Button>
    </div>
  ) : <Button onClick={onClose}>Close</Button>;

  return (
    <Sheet
      open
      onClose={onClose}
      title={creating ? 'Add a user' : nameOf(user as UserRecord)}
      subtitle={creating ? undefined : <span className="inline-flex flex-wrap items-center gap-x-[8px] gap-y-[4px]"><StatusPill size="sm" {...statusPill(userStatus, (user as UserRecord).is_active ? 'active' : 'inactive')} /><span>@{(user as UserRecord).username}</span></span>}
      width="md"
      dirty={dirty && mayChange}
      footer={footer}
    >
      <div className="flex flex-col gap-[20px]">
        {serverError && <Notice tone="danger" title={creating ? "The user wasn't added" : "The changes weren't saved"}>{serverError}</Notice>}
        {!mayChange && <Notice tone="info">{creating ? "You don't have the right to add users." : "You can look at this account but not change it."}</Notice>}

        <section aria-label="Details" className="flex flex-col gap-[12px]">
          <h3 className={HEADING}>Details</h3>
          {creating && (
            <FormField label="Username" required error={showErrors ? errors.username : undefined} hint="They sign in with this. It can't be changed later.">
              <TextInput value={form.username} autoComplete="off" maxLength={100} onChange={(e) => set({ username: e.target.value })} />
            </FormField>
          )}
          <FormField label="Display name" optional={creating} hint={creating ? 'Shown across the platform. The username is used if you leave it blank.' : undefined}>
            <TextInput value={form.displayName} autoComplete="off" maxLength={150} readOnly={!mayChange} onChange={(e) => set({ displayName: e.target.value })} />
          </FormField>
          <FormField label="E-mail" required error={showErrors || !creating ? errors.email : undefined}>
            <TextInput type="email" value={form.email} autoComplete="off" maxLength={200} readOnly={!mayChange} onChange={(e) => set({ email: e.target.value })} />
          </FormField>
          {creating && (
            <FormField label="Password" required error={showErrors ? errors.password : undefined} hint="They can use it to sign in straight away. Pass it on safely; it is not shown again.">
              <TextInput type="password" value={form.password} autoComplete="new-password" onChange={(e) => set({ password: e.target.value })} />
              <PasswordChecklist loading={policy.isLoading} failed={policy.isError} checks={passwordChecks(policy.data, form.password)} />
            </FormField>
          )}
        </section>

        <section aria-label="Roles" className="flex flex-col gap-[8px]">
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <h3 className={HEADING}>Roles{rolesKnown ? <span className="ml-[6px] font-normal text-ds-fg-muted">{form.roleIds.length} of {roles.length}</span> : null}</h3>
          </div>
          {rolesLoading ? <SkeletonLines lines={3} label="Loading the roles" />
            : rolesError ? <ErrorState compact title="Couldn't load the roles" message={plainError(rolesError)} onRetry={onRetryRoles} />
            : roles && roles.length === 0 ? <p className="text-ds-body text-ds-fg-muted">There are no roles yet. Create one under Roles & permissions.</p>
            : (
              <>
                {roles && roles.length >= SEARCH_ROLES_FROM && (
                  <TextInput type="search" aria-label="Search roles" placeholder="Search roles" value={roleSearch} onChange={(e) => setRoleSearch(e.target.value)} />
                )}
                <ul className="m-0 flex max-h-[320px] list-none flex-col overflow-y-auto rounded-ds-card border border-ds-border p-0">
                  {visibleRoles.map((r) => (
                    <li key={r.id} className="border-b border-ds-border px-[12px] last:border-b-0">
                      <Checkbox
                        label={<span className="block"><span className="font-[500] text-ds-fg">{r.name}</span>{r.description ? <span className="block text-ds-label text-ds-fg-muted">{r.description}</span> : null}</span>}
                        checked={form.roleIds.includes(r.id)} disabled={!mayChange} onChange={() => set({ roleIds: toggleId(form.roleIds, r.id) })}
                      />
                    </li>
                  ))}
                  {visibleRoles.length === 0 && <li className="px-[12px] py-[12px] text-ds-body text-ds-fg-muted">No role matches.</li>}
                </ul>
              </>
            )}
        </section>

        {!creating && user && (
          <section aria-label="Account" className="flex flex-col gap-[12px]">
            <h3 className={HEADING}>Account</h3>
            <FactList min={140}>
              <Fact label="Last sign-in" empty="Never">{user.last_login ? formatDateTime(user.last_login) : null}</Fact>
              <Fact label="Added">{user.created_at ? formatDate(user.created_at) : null}</Fact>
            </FactList>
            <div className="flex flex-wrap items-center gap-[8px]">
              {canSeeUsage && <Button href={`/admin/users/${user.id}/usage`} leftIcon={<BarChart3 aria-hidden />}>AI usage</Button>}
              {canEdit && (user.is_active
                ? <Button leftIcon={<UserX aria-hidden />} loading={busy} disabled={self !== null} onClick={() => { void actions.askDeactivate(user); }}>Deactivate</Button>
                : <Button leftIcon={<UserCheck aria-hidden />} loading={busy} onClick={() => actions.reactivate(user)}>Reactivate</Button>)}
            </div>
            {canEdit && self && user.is_active && <p className="text-ds-label text-ds-fg-muted">{self}</p>}
            {canDelete && (
              <div className="mt-[4px] flex flex-wrap items-center justify-between gap-[8px] rounded-ds-card border border-ds-danger-border px-[12px] py-[8px]">
                <p className="min-w-0 flex-1 basis-[12rem] text-ds-label text-ds-fg-muted">{self ?? 'Removing deletes the account for good. Deactivate it instead to keep its history.'}</p>
                <Button
                  variant="dangerOutline" disabled={self !== null} loading={busy}
                  onClick={() => { void actions.askRemove(user); }}
                >Remove permanently</Button>
              </div>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}

function PasswordChecklist({ checks, loading, failed }: { checks: Array<{ key: string; label: string; met: boolean }>; loading: boolean; failed: boolean }) {
  if (loading) return <p className="mt-[6px] text-ds-label text-ds-fg-muted">Checking the password rules</p>;
  if (failed || checks.length === 0) return <p className="mt-[6px] text-ds-label text-ds-fg-muted">The password rules couldn't be read. The server checks the password when you add the user.</p>;
  return (
    <ul aria-label="Password rules" className="mt-[6px] flex list-none flex-col gap-[2px] p-0">
      {checks.map((c) => (
        <li key={c.key} className={`flex items-center gap-[6px] text-ds-label ${c.met ? 'text-ds-success' : 'text-ds-fg-muted'}`}>
          {c.met ? <Check aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px] shrink-0" /> : <Circle aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px] shrink-0" />}
          <span>{c.label}<span className="sr-only">{c.met ? ' (met)' : ' (not met yet)'}</span></span>
        </li>
      ))}
    </ul>
  );
}
