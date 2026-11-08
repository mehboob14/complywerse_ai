'use client';

// One role, edited in place of the roles list (?role=<id>, or ?role=new): its name and description, then the permission grid, the menu a person holding exactly this
// role would see (the sidebar's own rule applied to the draft), and a Save bar. It starts from the row the list already holds, so it needs no right of its own beyond
// the list's; the permission list needs admin:permissions:view and says so when it is refused. A role changes with admin:roles:edit (create: :create): without it the
// page is a read-only view. The Administrator role is shown as Full access and cannot be changed (the server refuses too). What a role holds is kept exactly: names
// outside the catalogue are listed and sent back on save (rolesModel). Saving a role people hold asks first and says how many it reaches.
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, ShieldCheck, Trash2, Users } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  Button, Checkbox, Disclosure, ErrorState, FormField, Notice, ReadOnlyNote, SaveBar, SectionCard, SkeletonLines, StatusPill, TextInput, Textarea, useConfirm, useReportedMutation,
} from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { statusPill } from '@/lib/status';
import { roleKind } from '@/lib/statuses/people';
import { formatCount } from '@/lib/format';
import {
  NO_MATRIX_FILTER, blankRole, catalogueNames, changeLine, createRoleBody, deleteBlock, deleteRoleText, diffHeld, formOfRole, impactLine, isFullAccess, isRoleDirty, menuPreview,
  outsideNames, roleErrors, tally, updateRoleBody, type CatalogueModule, type RoleForm, type RoleRecord,
} from '@/lib/people/rolesModel';
import { ROLES_KEY, USERS_KEY } from './peopleData';
import { PermissionGrid } from './PermissionGrid';

export interface RoleEditorProps {
  /** the role to change; null makes a new one */
  role: RoleRecord | null;
  matrix: CatalogueModule[] | undefined;
  matrixLoading: boolean;
  matrixError: unknown;
  onRetryMatrix: () => void;
  features: string[];
  canEdit: boolean;
  canDelete: boolean;
  onBack: () => void;
  onOpenMembers: () => void;
  /** a new role was saved: open it */
  onCreated: (id: number) => void;
}

export function RoleEditor({ role, matrix, matrixLoading, matrixError, onRetryMatrix, features, canEdit, canDelete, onBack, onOpenMembers, onCreated }: RoleEditorProps) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const creating = role === null;
  const locked = role !== null && isFullAccess(role);
  const readOnly = !canEdit || locked;
  const saved = useMemo<RoleForm>(() => (role ? formOfRole(role) : blankRole()), [role]);
  const [draft, setDraft] = useState<RoleForm | null>(null);
  const form = draft ?? saved;
  const dirty = draft !== null && isRoleDirty(saved, draft);
  const errors = roleErrors(form);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [filter, setFilter] = useState(NO_MATRIX_FILTER);

  useEffect(() => {                                    // leaving with unsaved changes asks first
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (!savedAt) return undefined;
    const t = window.setTimeout(() => setSavedAt(null), 4000);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ROLES_KEY }); void qc.invalidateQueries({ queryKey: USERS_KEY }); };
  const save = useReportedMutation({
    mutationFn: ({ before, after }: { before: RoleForm; after: RoleForm }): Promise<{ data: { role?: { id?: number } } }> => (creating ? adminApi.createRole(createRoleBody(after)) : adminApi.updateRole((role as RoleRecord).id, updateRoleBody(before, after))),
    success: creating ? 'Role created' : 'Role saved',
    failure: creating ? "The role wasn't created" : "The role wasn't saved",
    retryable: false,
    toast: 'success',
    onSuccess: (r, { after }) => {
      // the list shows what was just saved at once (no flash of the old values while it is read again)
      if (role) qc.setQueryData<RoleRecord[]>(ROLES_KEY, (old) => old?.map((x) => (x.id === role.id ? { ...x, name: after.name.trim(), description: after.description.trim(), permissions: after.held.slice() } : x)));
      refresh();
      setDraft(null); setServerError(null); setSavedAt(Date.now());
      if (creating) { const id = Number(r.data?.role?.id); if (id) onCreated(id); }
    },
    onError: (e) => setServerError(errorMessage(e, 'The role could not be saved. Try again.')),
  });
  const remove = useReportedMutation({
    mutationFn: () => adminApi.deleteRole((role as RoleRecord).id),
    success: (_r) => `The role "${role?.name}" was deleted`,
    failure: "The role wasn't deleted",
    onSuccess: () => { refresh(); onBack(); },
  });

  const names = useMemo(() => (matrix ? catalogueNames(matrix) : []), [matrix]);
  const heldSet = useMemo(() => new Set(form.held), [form.held]);
  const total = matrix ? tally(names, heldSet) : null;
  const outside = useMemo(() => (matrix ? outsideNames(matrix, form.held) : []), [matrix, form.held]);
  const diff = diffHeld(saved.held, form.held);
  const permissionsChanged = diff.added.length > 0 || diff.removed.length > 0;
  const preview = useMemo(() => (role || draft ? menuPreview(form.held, role ?? { name: form.name }, features) : []), [form.held, form.name, role, draft, features]);

  const onSave = async () => {
    setShowErrors(true);
    if (!dirty || errors.name) return;
    const impact = role ? impactLine(role.user_count, permissionsChanged) : '';
    if (impact) {
      const ok = await confirm({ title: `Save changes to "${saved.name}"?`, message: `${changeLine(diff)}. ${impact}`, confirmLabel: 'Save changes' });
      if (!ok) return;
    }
    setServerError(null);
    save.mutate({ before: saved, after: form });
  };

  const leave = async () => {
    if (dirty && !(await confirm({ title: 'Leave without saving?', message: 'Your changes to this role have not been saved and will be lost.', confirmLabel: 'Leave and discard', cancelLabel: 'Keep editing', tone: 'danger' }))) return;
    onBack();
  };

  const block = role ? deleteBlock(role) : null;
  const title = creating ? 'New role' : role.name;

  return (
    <div className="flex flex-col gap-[16px] pb-[24px]">
      <PageHeader
        variant="page"
        title={title}
        info="A role is a named set of permissions. Give it to people on the Users page; they get what the role holds."
        chips={role ? <StatusPill {...statusPill(roleKind, role.is_system_role ? 'system' : 'custom')} /> : undefined}
        meta={role ? `${formatCount(role.user_count)} ${role.user_count === 1 ? 'person' : 'people'}` : undefined}
        actions={role ? (
          <>
            <Button leftIcon={<ArrowLeft aria-hidden />} onClick={() => { void leave(); }}>All roles</Button>
            {role.user_count > 0 && <Button leftIcon={<Users aria-hidden />} onClick={onOpenMembers}>See the people</Button>}
            {canDelete && !role.is_system_role && (
              <Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} loading={remove.isPending} disabled={block !== null} title={block ?? undefined}
                onClick={async () => { if (await confirm({ ...deleteRoleText(role.name), tone: 'danger' })) remove.mutate(); }}>Delete role</Button>
            )}
          </>
        ) : <Button leftIcon={<ArrowLeft aria-hidden />} onClick={() => { void leave(); }}>All roles</Button>}
      />
      {role && canDelete && !role.is_system_role && block && <p className="-mt-[8px] text-ds-label text-ds-fg-muted">{block}</p>}
      {!canEdit && !locked && <ReadOnlyNote>View only<InfoTip text="Changing a role needs the right to edit roles. An administrator can give it to you." label="Why this role is view only" /></ReadOnlyNote>}

      <SectionCard id="role" title="Role">
        <div className="grid gap-[16px] sm:grid-cols-2">
          <FormField label="Name" required error={showErrors || !creating ? errors.name : undefined}>
            <TextInput value={form.name} maxLength={100} readOnly={readOnly} autoComplete="off" onChange={(e) => { setDraft({ ...form, name: e.target.value }); setServerError(null); }} />
          </FormField>
          <FormField label="Description" optional>
            <Textarea rows={2} value={form.description} readOnly={readOnly} onChange={(e) => { setDraft({ ...form, description: e.target.value }); setServerError(null); }} />
          </FormField>
        </div>
      </SectionCard>

      {locked ? (
        <Notice tone="info" icon={ShieldCheck} title="Full access">People with the Administrator role can do everything on the platform, so there is nothing to tick, and the role cannot be changed.</Notice>
      ) : (
        <SectionCard
          id="permissions"
          title="Permissions"
          info="Tick what people with this role may do. View lets them open it, Create adds, Edit changes, Delete removes; Other holds the special actions of an area."
          meta={total ? `${formatCount(total.granted)} of ${formatCount(total.total)} granted` : undefined}
        >
          {matrixLoading ? <SkeletonLines lines={6} label="Loading the permission list" />
            : matrixError || !matrix ? (statusOf(matrixError) === 403
              ? <Notice tone="warning" title="You can't see the permission list">Seeing and ticking permissions needs the right to view permissions. Name and description can still be changed.</Notice>
              : <ErrorState compact title="Couldn't load the permission list" message={errorMessage(matrixError)} onRetry={canRetry(matrixError) ? onRetryMatrix : undefined} />)
            : (
              <div className="flex flex-col gap-[12px]">
                <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[4px]">
                  <TextInput className="w-full sm:w-[280px]" type="search" aria-label="Search permissions" placeholder="Search permissions" leftAdornment={<Search aria-hidden />}
                    value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
                  <Checkbox label="Granted only" checked={filter.grantedOnly} onChange={(e) => setFilter({ ...filter, grantedOnly: e.target.checked })} />
                </div>
                {outside.length > 0 && (
                  <Notice tone="info" title={`${outside.length} ${outside.length === 1 ? 'permission' : 'permissions'} outside the list`}>
                    This role also holds {outside.length === 1 ? 'a permission' : 'permissions'} the list does not show (older names). {outside.length === 1 ? 'It is' : 'They are'} kept when you save: {outside.slice(0, 5).join(', ')}{outside.length > 5 ? `, and ${outside.length - 5} more` : ''}.
                  </Notice>
                )}
                <PermissionGrid matrix={matrix} held={form.held} readOnly={readOnly} filter={filter} onChange={(held) => { setDraft({ ...form, held }); setServerError(null); }} />
              </div>
            )}
        </SectionCard>
      )}

      {(role || draft) && (
        <Disclosure label={`In the menu, a person with ${locked ? 'this role' : 'exactly these permissions'} sees`} count={preview.length} countLabel="areas" level={2}>
          {preview.length === 0 ? <p className="text-ds-body text-ds-fg-muted">Nothing in the menu yet.</p> : (
            <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
              {preview.map((g) => (
                <li key={g.label} className="text-ds-body text-ds-fg-body">
                  <span className="font-[600] text-ds-fg">{g.label}</span>
                  {g.names.length > 1 || g.names[0] !== g.label ? <span className="text-ds-fg-muted"> · {g.names.join(', ')}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      )}

      {confirmDialog}
      <SaveBar
        label={creating ? 'Create the role' : 'Save the role'} saveLabel={creating ? 'Create role' : 'Save role'}
        canEdit={!readOnly} dirty={dirty} invalid={!!errors.name} saving={save.isPending} justSaved={savedAt !== null} error={serverError}
        onSave={() => { void onSave(); }} onDiscard={() => { setDraft(null); setServerError(null); setShowErrors(false); }}
      />
    </div>
  );
}
