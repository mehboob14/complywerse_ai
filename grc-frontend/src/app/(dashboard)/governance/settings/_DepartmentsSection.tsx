'use client';

// Governance > Settings > Departments: the organisation's departments as a tree, three levels deep (a Department, its Sub-departments, their
// Units: the names are the organisation's own, set from "Level names"), added, edited and deactivated from here. They are the very same records as
// Administration → Departments (the former Teams): the list is GET /admin/departments, the form is the same component (components/admin/DepartmentForm,
// drawn here as the design-system drawer that asks before it discards typing), and a department made here also exists as the picker record other
// modules store. "Add Sub-department" on a row opens that form with the row as its Parent. There is no delete - documents and assignments point at a
// department, so it is deactivated (and can be activated again); its documents keep it. Everybody who can open this page reads the table; changing
// needs admin:organization:edit (the server enforces it too). Members and roles stay in Administration. The ordering and the wording of the cells
// are in lib/departments.ts (departmentRows, documentsLabel, departmentsSummary, addUnderLabel, levelNames…). On the design-system kit: SectionCard,
// RegisterTable (cards below 768px), Menu for the row's actions, StatusPill, useConfirm for the "deactivate?" question, useReportedMutation for what it does.
import { useId, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Building2, CornerDownRight, ListTree, Pencil, Plus, Power } from 'lucide-react';
import { clsx } from 'clsx';
import { departmentsApi, type Department, type DepartmentLevels } from '@/lib/api';
import { EMPTY } from '@/lib/format';
import {
  DEACTIVATE_NOTE, DEFAULT_LEVEL_LABELS, LEVEL_NAME_MAX, MAX_DEPTH, activatedText, addUnderLabel, deactivatedText, departmentRows, departmentsSummary,
  documentsLabel, levelInputs, levelLabel, levelNamesBody, levelNamesChanged, refreshDepartments,
} from '@/lib/departments';
import { departmentStatus, statusPill } from '@/lib/status';
import { usePermissions } from '@/hooks/usePermissions';
import { InfoTip } from '@/components/ui/InfoTip';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { Button, EmptyState, FormField, Menu, ReadOnlyNote, RegisterTable, SectionCard, StatusPill, TextInput, type MenuItem, type RegisterColumn } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useNotify } from '@/components/ui/ds/useNotify';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { DepartmentFormModal, useAdminDepartments, useDepartmentLevels, useTenantUsers } from '@/components/admin/DepartmentForm';

/** The right a person needs to add or change a department (the server asks for the same one). */
const EDIT_RIGHT = 'admin:organization:edit';

type Row = { department: Department; depth: number };

/** 1 for a top department: what the server says (`level`), else how far in the table has indented it. */
const levelOf = ({ department: d, depth }: Row): number => d.level ?? depth + 1;

/** Nothing recorded in a cell: the dash for the eye, the word for a screen reader. */
const None = () => (<><span aria-hidden className="text-ds-fg-muted">{EMPTY}</span><span className="sr-only">None</span></>);

/** The name (indented under its parent), its code and, on a phone, the head of the card. */
function NameCell({ department: d, depth }: Row) {
  const off = d.is_active === false;
  return (
    <div className="flex min-w-0 items-center gap-[6px]" style={{ paddingLeft: Math.min(depth, 4) * 20 }}>
      {depth > 0 && <CornerDownRight aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />}
      <span className={clsx('line-clamp-2 min-w-0 font-[600]', off ? 'text-ds-fg-muted' : 'text-ds-fg')} title={d.path && d.path.length > 1 ? d.path.join(' › ') : d.name}>{d.name}</span>
      {d.code && (
        <span className="shrink-0 rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] font-mono text-ds-label font-normal text-ds-fg-muted">{d.code}</span>
      )}
    </div>
  );
}

/** The level in the organisation's own word ("Sub-department"); its whole path on hover. */
function LevelChip({ row, names }: { row: Row; names?: readonly string[] }) {
  const d = row.department;
  return (
    <span
      className="inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label text-ds-fg-body"
      title={d.path && d.path.length > 0 ? d.path.join(' › ') : undefined}
    >
      <span className="truncate">{d.level_label || levelLabel(levelOf(row), names)}</span>
    </span>
  );
}

/** "Level names": the drawer where the organisation names its three levels. A box left empty is that level's default (its placeholder);
 *  the server refuses two levels with one name or a name that is too long, and its sentence is shown as it is. */
function LevelNamesPanel({ levels, onClose, onSaved }: { levels: DepartmentLevels | undefined; onClose: () => void; onSaved: () => void }) {
  const formId = useId();
  const [typed, setTyped] = useState<string[]>(() => levelInputs(levels));
  const [problem, setProblem] = useState<string | null>(null);
  const changed = levelNamesChanged(levels, typed);
  const defaults = levels?.defaults?.length === MAX_DEPTH ? levels.defaults : DEFAULT_LEVEL_LABELS;
  const save = useReportedMutation({
    mutationFn: () => departmentsApi.setLevels(levelNamesBody(typed)),
    success: 'Level names saved',
    failure: 'Level names not saved',
    toast: 'success',                                       // a refusal is said here, beside the boxes, in the server's words
    onSuccess: onSaved,
    onError: (e) => setProblem(errorMessage(e)),
  });
  const submit = () => {
    setProblem(null);
    if (changed) save.mutate();
    else onClose();                                         // nothing was changed: nothing to save
  };
  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="Level names"
      dirty={changed}
      footer={(
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>Save</Button>
        </div>
      )}
    >
      <form id={formId} onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-[12px]">
        {typed.map((value, i) => (
          <FormField key={i} label={['Top level', 'Second level', 'Third level'][i] ?? `Level ${i + 1}`}>
            <TextInput
              value={value}
              maxLength={LEVEL_NAME_MAX}
              placeholder={defaults[i]}
              autoComplete="off"
              autoFocus={i === 0}
              onChange={(e) => setTyped((all) => all.map((v, j) => (j === i ? e.target.value : v)))}
            />
          </FormField>
        ))}
        {problem && (
          <p role="alert" className="rounded-ds-control border border-ds-danger-border bg-ds-danger-soft px-[12px] py-[8px] text-ds-label text-ds-danger">{problem}</p>
        )}
      </form>
    </RightSlidePanel>
  );
}

export function DepartmentsSection() {
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canEdit = !permsLoading && hasPermission(EDIT_RIGHT);
  const list = useAdminDepartments();
  const levels = useDepartmentLevels();
  const names = levels.data?.labels;                        // undefined until they arrive (or if they cannot be read): the default names
  useTenantUsers(canEdit);                                  // the people for the Owner field are there by the time the form opens
  const [creating, setCreating] = useState<{ parent: Department | null } | null>(null);     // a new department; `parent`: opened by "Add Sub-department" on that row
  const [editing, setEditing] = useState<Department | null>(null);
  const [naming, setNaming] = useState(false);

  const rows = useMemo(() => departmentRows(list.data ?? []), [list.data]);
  const failed = list.isError && !list.data;
  const empty = !list.isLoading && !failed && rows.length === 0;
  // the Actions column is kept while the person's rights are still loading, so the table does not jump for those who can use it
  const withActions = permsLoading || canEdit;

  const refresh = () => refreshDepartments(qc);               // the library, the document form and every picker read the change
  const saved = (close: () => void) => (message: string) => { close(); refresh(); notify.success(message); };
  const deactivate = useReportedMutation({
    mutationFn: (d: Department) => departmentsApi.deactivate(d.id),
    success: (_r, d) => deactivatedText(d.name),
    failure: 'Not deactivated',
    onSuccess: refresh,
  });
  const activate = useReportedMutation({
    mutationFn: (d: Department) => departmentsApi.update(d.id, { is_active: true }),
    success: (_r, d) => activatedText(d.name),
    failure: 'Not activated',
    onSuccess: refresh,
  });
  const askToDeactivate = async (d: Department) => {
    if (await confirm({ title: `Deactivate ${d.name}?`, message: DEACTIVATE_NOTE, confirmLabel: 'Deactivate', tone: 'danger' })) deactivate.mutate(d);
  };

  const actionsOf = (row: Row) => {
    if (!canEdit) return null;                              // (while the rights load the column is there, empty)
    const d = row.department;
    // "Add Sub-department": not on the deepest level (nothing sits under it) and not on a department that is switched off (the server refuses it as a parent)
    const under = d.is_active === false ? null : addUnderLabel(levelOf(row), names);
    const items: MenuItem[] = [
      ...(under ? [{ key: 'add', label: under, icon: Plus, onSelect: () => setCreating({ parent: d }) }] : []),
      { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setEditing(d) },
      d.is_active === false
        ? { key: 'activate', label: 'Activate', icon: Power, onSelect: () => activate.mutate(d), disabled: activate.isPending }
        : { key: 'deactivate', label: 'Deactivate', icon: Power, danger: true, onSelect: () => { void askToDeactivate(d); } },
    ];
    return <Menu label={`Actions for ${d.name}`} iconOnly items={items} />;
  };

  // The tree is the Name column (indented under its parent, so there is no Parent column); the narrower the window, the fewer columns: Level goes
  // below 1024px (the indent still shows it), and below 768px each department is a card with the same facts as lines.
  const columns: RegisterColumn<Row>[] = [
    { key: 'name', header: 'Name', isRowHeader: true, cell: (r) => <NameCell {...r} /> },
    { key: 'level', header: 'Level', priority: 3, width: 'w-[128px]', card: 'meta', cell: (r) => <LevelChip row={r} names={names} /> },
    {
      key: 'owner', header: 'Owner', priority: 2, width: 'w-[120px]', card: 'meta',
      cell: ({ department: d }) => (d.department_head_name ? <span className="line-clamp-2" title={d.department_head_name}>{d.department_head_name}</span> : <None />),
    },
    {
      key: 'documents', header: 'Documents', priority: 2, align: 'right', width: 'w-[88px]', card: 'meta',
      cell: ({ department: d }) => {
        // its own number, and (quieter) the number with everything under it when that is more; the words are for the tooltip and the screen reader
        const documents = documentsLabel(d.document_count, d.document_count_total);
        return (
          <span title={documents.long}>
            <span className="sr-only">{documents.long}</span>
            <span aria-hidden className="tabular-nums">{documents.text}</span>
            {documents.total && <span aria-hidden className="tabular-nums text-ds-fg-muted"> / {documents.total}</span>}
          </span>
        );
      },
    },
    {
      key: 'status', header: 'Status', width: 'w-[88px]', card: 'meta',
      cell: ({ department: d }) => <StatusPill size="sm" {...statusPill(departmentStatus, d.is_active === false ? 'inactive' : 'active')} />,
    },
    ...(withActions ? [{ key: 'actions', header: 'Actions', align: 'right' as const, width: 'w-[56px]', cell: actionsOf }] : []),
  ];

  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setCreating({ parent: null })}>Add department</Button>;

  return (
    <>
      <SectionCard
        id="departments"
        title="Departments"
        info={`The same departments as Administration → Departments, also the teams used for sign-off and assignments. A department added here appears there. They nest up to ${MAX_DEPTH} levels.`}
        meta={list.data && !empty ? departmentsSummary(list.data) : undefined}
        actions={canEdit ? (
          <>
            <Button href="/admin?tab=departments" variant="link" rightIcon={<ArrowUpRight aria-hidden />}>Members and roles</Button>
            <Button leftIcon={<ListTree aria-hidden />} onClick={() => setNaming(true)} disabled={levels.isLoading}>Level names</Button>
            {!empty && !failed && add}
          </>
        ) : permsLoading ? undefined : (
          <ReadOnlyNote>
            View only
            <InfoTip text="Only an administrator, or someone whose role lets them edit the organisation, can add or change departments." label="Why departments are view only" />
          </ReadOnlyNote>
        )}
      >
        {empty ? (
          <EmptyState kind="firstUse" bare icon={Building2} title="No departments yet" action={canEdit ? add : undefined} />
        ) : (
          <RegisterTable<Row>
            caption="Departments"
            columns={columns}
            rows={rows}
            getRowId={(r) => r.department.id}
            loading={list.isLoading}
            loadingRows={4}
            error={failed ? { message: 'Could not load the departments', onRetry: () => { void list.refetch(); } } : null}
            cardTitle={(r) => (
              <div className="flex items-start justify-between gap-[8px]">
                <div className="min-w-0 flex-1"><NameCell {...r} /></div>
                {actionsOf(r)}
              </div>
            )}
          />
        )}
      </SectionCard>

      {creating && (
        <DepartmentFormModal drawer mode="create" parentId={creating.parent?.id ?? null} departments={list.data ?? []} onClose={() => setCreating(null)} onSaved={saved(() => setCreating(null))} />
      )}
      {editing && (
        <DepartmentFormModal drawer mode="edit" department={editing} departments={list.data ?? []} onClose={() => setEditing(null)} onSaved={saved(() => setEditing(null))} />
      )}
      {naming && <LevelNamesPanel levels={levels.data} onClose={() => setNaming(false)} onSaved={() => { setNaming(false); refresh(); }} />}
      {confirmDialog}
    </>
  );
}
