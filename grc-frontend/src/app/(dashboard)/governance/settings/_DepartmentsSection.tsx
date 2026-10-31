'use client';

// Governance > Settings > Departments: add, edit and deactivate the organisation's departments from here. They are the very same
// records as Administration → Departments (the former Teams): the list is GET /admin/departments, the form is the same component
// (components/admin/DepartmentForm, drawn here as the design-system drawer that asks before it discards typed input), and a department made
// here also exists as the picker record other modules store. There is no delete - documents and assignments point at a department, so it
// is deactivated (and can be activated again); its documents keep it. Everybody who can open this page reads the table; changing needs
// admin:organization:edit (the server enforces it too). Members and roles stay in Administration. The ordering and the wording of the
// cells are in lib/departments.ts (departmentRows, documentsLabel, departmentsSummary). On the design-system kit: SectionCard, RegisterTable
// (cards below 768px), Menu for the row's actions, StatusPill, useConfirm for the "deactivate?" question, useReportedMutation for what it does.
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Building2, CornerDownRight, Pencil, Plus, Power } from 'lucide-react';
import { clsx } from 'clsx';
import { departmentsApi, type Department } from '@/lib/api';
import { EMPTY } from '@/lib/format';
import {
  DEACTIVATE_NOTE, activatedText, deactivatedText, departmentRows, departmentsSummary, documentsLabel, refreshDepartments,
} from '@/lib/departments';
import { departmentStatus, statusPill } from '@/lib/status';
import { usePermissions } from '@/hooks/usePermissions';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, Menu, ReadOnlyNote, RegisterTable, SectionCard, StatusPill, type MenuItem, type RegisterColumn } from '@/components/ui/ds';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useNotify } from '@/components/ui/ds/useNotify';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { DepartmentFormModal, useAdminDepartments, useTenantUsers } from '@/components/admin/DepartmentForm';

/** The right a person needs to add or change a department (the server asks for the same one). */
const EDIT_RIGHT = 'admin:organization:edit';

type Row = { department: Department; depth: number };

/** Nothing recorded in a cell: the dash for the eye, the word for a screen reader. */
const None = () => (<><span aria-hidden className="text-ds-fg-muted">{EMPTY}</span><span className="sr-only">None</span></>);

/** The name (indented under its parent), its code and, on a phone, the head of the card. */
function NameCell({ department: d, depth }: Row) {
  const off = d.is_active === false;
  return (
    <div className="flex min-w-0 items-center gap-[6px]" style={{ paddingLeft: Math.min(depth, 4) * 20 }}>
      {depth > 0 && <CornerDownRight aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />}
      <span className={clsx('line-clamp-2 min-w-0 font-[600]', off ? 'text-ds-fg-muted' : 'text-ds-fg')} title={d.name}>{d.name}</span>
      {d.code && (
        <span className="shrink-0 rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[6px] font-mono text-ds-label font-normal text-ds-fg-muted">{d.code}</span>
      )}
    </div>
  );
}

export function DepartmentsSection() {
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canEdit = !permsLoading && hasPermission(EDIT_RIGHT);
  const list = useAdminDepartments();
  useTenantUsers(canEdit);                                  // the people for the Lead field are there by the time the form opens
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);

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

  const actionsOf = ({ department: d }: Row) => {
    if (!canEdit) return null;                              // (while the rights load the column is there, empty)
    const items: MenuItem[] = [
      { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setEditing(d) },
      d.is_active === false
        ? { key: 'activate', label: 'Activate', icon: Power, onSelect: () => activate.mutate(d), disabled: activate.isPending }
        : { key: 'deactivate', label: 'Deactivate', icon: Power, danger: true, onSelect: () => { void askToDeactivate(d); } },
    ];
    return <Menu label={`Actions for ${d.name}`} iconOnly items={items} />;
  };

  // The columns in the order the table has always had; the narrower the window, the fewer: Parent goes below 1024px, Lead and Documents below 768px
  // (where each department is a card with the same facts as lines).
  const columns: RegisterColumn<Row>[] = [
    { key: 'name', header: 'Name', isRowHeader: true, cell: (r) => <NameCell {...r} /> },
    {
      key: 'parent', header: 'Parent', priority: 3, width: 'w-[120px]', card: 'meta',
      cell: ({ department: d }) => (d.parent_department_name ? <span className="line-clamp-2" title={d.parent_department_name}>{d.parent_department_name}</span> : <None />),
    },
    {
      key: 'lead', header: 'Lead', priority: 2, width: 'w-[120px]', card: 'meta',
      cell: ({ department: d }) => (d.department_head_name ? <span className="line-clamp-2" title={d.department_head_name}>{d.department_head_name}</span> : <None />),
    },
    {
      key: 'documents', header: 'Documents', priority: 2, align: 'right', width: 'w-[88px]', card: 'meta',
      cell: ({ department: d }) => {
        const documents = documentsLabel(d.document_count);
        return (<><span className="sr-only">{documents.long}</span><span aria-hidden className="tabular-nums">{documents.text}</span></>);
      },
    },
    {
      key: 'status', header: 'Status', width: 'w-[88px]', card: 'meta',
      cell: ({ department: d }) => <StatusPill size="sm" {...statusPill(departmentStatus, d.is_active === false ? 'inactive' : 'active')} />,
    },
    ...(withActions ? [{ key: 'actions', header: 'Actions', align: 'right' as const, width: 'w-[56px]', cell: actionsOf }] : []),
  ];

  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setCreateOpen(true)}>Add department</Button>;

  return (
    <>
      <SectionCard
        id="departments"
        title="Departments"
        info="The same departments as Administration → Departments, also the teams used for sign-off and assignments. A department added here appears there."
        meta={list.data && !empty ? departmentsSummary(list.data) : undefined}
        actions={canEdit ? (
          <>
            <Button href="/admin?tab=departments" variant="link" rightIcon={<ArrowUpRight aria-hidden />}>Members and roles</Button>
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

      {createOpen && (
        <DepartmentFormModal drawer mode="create" departments={list.data ?? []} onClose={() => setCreateOpen(false)} onSaved={saved(() => setCreateOpen(false))} />
      )}
      {editing && (
        <DepartmentFormModal drawer mode="edit" department={editing} departments={list.data ?? []} onClose={() => setEditing(null)} onSaved={saved(() => setEditing(null))} />
      )}
      {confirmDialog}
    </>
  );
}
