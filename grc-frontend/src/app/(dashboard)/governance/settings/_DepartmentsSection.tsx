'use client';

// Governance > Settings > Departments: add, edit and deactivate the organisation's departments from here. They are the very same
// records as Administration → Departments (the former Teams): the list is GET /admin/departments, the form and the "deactivate?"
// question are the same components (components/admin/DepartmentForm), and a department made here also exists as the picker record
// other modules store. There is no delete - documents and assignments point at a department, so it is deactivated (and can be
// activated again); its documents keep it. Everybody who can open this page reads the table; changing needs admin:organization:edit
// (the server enforces it too). Members and roles stay in Administration. The ordering and the wording of the cells are in
// lib/departments.ts (departmentRows, documentsLabel, departmentsSummary).
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Building2, CornerDownRight, Lock, Pencil, Plus, Power } from 'lucide-react';
import { clsx } from 'clsx';
import { departmentsApi, type Department } from '@/lib/api';
import { apiErrorText } from '@/lib/apiError';
import { activatedText, deactivatedText, departmentRows, departmentsSummary, documentsLabel, refreshDepartments } from '@/lib/departments';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/ToastProvider';
import { InfoTip } from '@/components/ui/InfoTip';
import { BTN, BTN_PRIMARY, BTN_TEXT } from '@/components/governance/docUi';
import { DeactivateModal, DepartmentFormModal, useAdminDepartments, useTenantUsers } from '@/components/admin/DepartmentForm';
import { Section } from './_Section';

/** The right a person needs to add or change a department (the server asks for the same one). */
const EDIT_RIGHT = 'admin:organization:edit';

type Col = 'name' | 'parent' | 'lead' | 'documents' | 'status' | 'actions';
const COLUMNS: { id: Col; label: string; width?: number; right?: boolean }[] = [
  { id: 'name', label: 'Name' },
  { id: 'parent', label: 'Parent', width: 140 },
  { id: 'lead', label: 'Lead', width: 140 },
  { id: 'documents', label: 'Documents', width: 100, right: true },
  { id: 'status', label: 'Status', width: 96 },
  { id: 'actions', label: 'Actions', width: 170 },
];
const SKELETON_ROWS = 4;

// The library's table look (PITFALLS 100: explicit hex colours and sizes, an opaque fill on every cell - the dashboard paints zebra
// stripes on the <tr> and sizes bare cells itself - and the row height on the <tr>).
const HEAD = 'border-b border-[#d5dbe1] px-[12px] align-middle !bg-[#f3f6f8]';
const HEAD_TEXT = 'whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-[#586472]';
const CELL = 'overflow-hidden border-b border-[#e1e6eb] bg-[#fff] px-[12px] align-middle group-hover:bg-[#f7f9fb]';
const ROW_BUTTON = `${BTN_TEXT} inline-flex h-8 items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50`;
const STATE = 'flex flex-col items-center gap-2 py-8 text-center';

const Dash = () => (<><span aria-hidden className="text-[13px] text-[#7b8794]">—</span><span className="sr-only">None</span></>);

export function DepartmentsSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canEdit = !permsLoading && hasPermission(EDIT_RIGHT);
  const list = useAdminDepartments();
  useTenantUsers(canEdit);                                  // the people for the Lead field are there by the time the form opens
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [switching, setSwitching] = useState<Department | null>(null);       // asked before it is switched off

  const rows = useMemo(() => departmentRows(list.data ?? []), [list.data]);
  const failed = list.isError && !list.data;
  const empty = !list.isLoading && !failed && rows.length === 0;
  // the Actions column is kept while the person's rights are still loading, so the table does not jump for those who can use it
  const cols = COLUMNS.filter((c) => c.id !== 'actions' || permsLoading || canEdit);

  const refresh = () => refreshDepartments(qc);               // the library, the document form and every picker read the change
  const saved = (close: () => void) => (message: string) => { close(); refresh(); toast({ type: 'success', title: message }); };
  const deactivate = useMutation({
    mutationFn: (d: Department) => departmentsApi.deactivate(d.id),
    onSuccess: (_r, d) => { setSwitching(null); refresh(); toast({ type: 'success', title: deactivatedText(d.name) }); },
  });
  const activate = useMutation({
    mutationFn: (d: Department) => departmentsApi.update(d.id, { is_active: true }),
    onSuccess: (_r, d) => { refresh(); toast({ type: 'success', title: activatedText(d.name) }); },
    onError: (e: unknown) => toast({ type: 'error', title: 'Not activated', message: apiErrorText(e, 'Could not activate the department.') }),
  });

  const add = (
    <button type="button" onClick={() => setCreateOpen(true)} className={BTN_PRIMARY}>
      <Plus size={14} aria-hidden /> Add department
    </button>
  );

  return (
    <>
      <Section
        id="departments"
        title="Departments"
        info="The same departments as Administration → Departments, also the teams used for sign-off and assignments. A department added here appears there."
        meta={list.data && !empty ? departmentsSummary(list.data) : undefined}
        actions={canEdit ? (
          <>
            <Link href="/admin?tab=departments" className={`${BTN_TEXT} inline-flex h-8 items-center gap-1`}>
              Members and roles <ArrowUpRight size={13} aria-hidden />
            </Link>
            {!empty && !failed && add}
          </>
        ) : permsLoading ? undefined : (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-[#586472]">
            <Lock size={13} aria-hidden /> View only
            <InfoTip text="Only an administrator, or someone whose role lets them edit the organisation, can add or change departments." label="Why departments are view only" />
          </span>
        )}
      >
        {failed ? (
          <div role="alert" className={STATE}>
            <AlertTriangle className="h-8 w-8 text-[#b42318]" strokeWidth={1.5} aria-hidden />
            <p className="text-[15px] font-semibold text-[#1f2933]">Could not load the departments</p>
            <button type="button" onClick={() => list.refetch()} className={BTN}>Try again</button>
          </div>
        ) : empty ? (
          <div className={STATE}>
            <Building2 className="h-8 w-8 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden />
            <p className="text-[15px] font-semibold text-[#1f2933]">No departments yet</p>
            {canEdit && add}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#e1e6eb]">
            <table className="w-full table-fixed !border-separate border-spacing-0 text-left" style={{ minWidth: cols.length > 5 ? 760 : 600 }}>
              <caption className="sr-only">{list.isLoading ? 'Loading the departments' : 'Departments'}</caption>
              <colgroup>{cols.map((c) => <col key={c.id} style={c.width ? { width: c.width } : undefined} />)}</colgroup>
              <thead>
                <tr className="h-10">
                  {cols.map((c) => (
                    <th key={c.id} scope="col" className={clsx(HEAD, c.right ? 'text-right' : 'text-left')}>
                      {c.id === 'actions' ? <span className="sr-only">{c.label}</span> : <span className={HEAD_TEXT}>{c.label}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody aria-busy={list.isLoading || undefined} className="[&_tr:last-child_td]:border-b-0">
                {list.isLoading
                  ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                      <tr key={i} aria-hidden className="h-14">
                        {cols.map((c) => (
                          <td key={c.id} className={CELL}>
                            <span className="block h-3.5 animate-pulse rounded bg-[#e1e6eb] motion-reduce:animate-none" style={{ width: c.id === 'name' ? '60%' : '70%' }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map(({ department: d, depth }) => {
                      const off = d.is_active === false;
                      const ink = off ? 'text-[#586472]' : 'text-[#26323d]';                 // a switched-off department reads quieter
                      const documents = documentsLabel(d.document_count);
                      return (
                        <tr key={d.id} className="group h-14">
                          <td className={CELL}>
                            <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: Math.min(depth, 4) * 20 }}>
                              {depth > 0 && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-[#9aa5b1]" aria-hidden />}
                              <span className={clsx('truncate text-[13px] font-semibold', off ? 'text-[#586472]' : 'text-[#1f2933]')} title={d.name}>{d.name}</span>
                              {d.code && (
                                <span className="shrink-0 rounded border border-[#d5dbe1] bg-[#f3f6f8] px-1.5 py-0.5 font-mono text-[10.5px] text-[#3f4b58]">{d.code}</span>
                              )}
                            </div>
                          </td>
                          <td className={CELL}>
                            {d.parent_department_name
                              ? <span className={clsx('block truncate text-[13px]', ink)} title={d.parent_department_name}>{d.parent_department_name}</span>
                              : <Dash />}
                          </td>
                          <td className={CELL}>
                            {d.department_head_name
                              ? <span className={clsx('block truncate text-[13px]', ink)} title={d.department_head_name}>{d.department_head_name}</span>
                              : <Dash />}
                          </td>
                          <td className={clsx(CELL, 'text-right')}>
                            <span className="sr-only">{documents.long}</span>
                            <span aria-hidden className={clsx('text-[13px] tabular-nums', ink)}>{documents.text}</span>
                          </td>
                          <td className={CELL}>
                            <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                              off ? 'border-[#d5dbe1] bg-[#f3f6f8] text-[#586472]' : 'border-[#a7f3d0] bg-[#ecfdf5] text-[#047857]')}>
                              {off ? 'Inactive' : 'Active'}
                            </span>
                          </td>
                          {cols.some((c) => c.id === 'actions') && (
                            <td className={clsx(CELL, 'text-right')}>
                              {canEdit && (
                                <div className="inline-flex items-center justify-end gap-1">
                                  <button type="button" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`} className={ROW_BUTTON}>
                                    <Pencil size={13} aria-hidden /> Edit
                                  </button>
                                  {off ? (
                                    <button type="button" onClick={() => activate.mutate(d)} disabled={activate.isPending} aria-label={`Activate ${d.name}`} className={ROW_BUTTON}>
                                      <Power size={13} aria-hidden /> Activate
                                    </button>
                                  ) : (
                                    <button type="button" onClick={() => { deactivate.reset(); setSwitching(d); }} aria-label={`Deactivate ${d.name}`} className={ROW_BUTTON}>
                                      <Power size={13} aria-hidden /> Deactivate
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* (contents: the page's space-y rule would otherwise push the dialogs' fixed overlay down by its margin) */}
      <div className="contents">
        {createOpen && (
          <DepartmentFormModal mode="create" departments={list.data ?? []} onClose={() => setCreateOpen(false)} onSaved={saved(() => setCreateOpen(false))} />
        )}
        {editing && (
          <DepartmentFormModal mode="edit" department={editing} departments={list.data ?? []} onClose={() => setEditing(null)} onSaved={saved(() => setEditing(null))} />
        )}
        {switching && (
          <DeactivateModal department={switching} pending={deactivate.isPending} error={deactivate.error}
            onConfirm={() => deactivate.mutate(switching)} onClose={() => setSwitching(null)} />
        )}
      </div>
    </>
  );
}
