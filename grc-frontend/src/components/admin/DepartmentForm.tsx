'use client';

// The department dialogs that Administration → Departments and Governance → Settings → Departments both open: the create/edit form and
// the "deactivate?" question, with the small dialog shell and field they are built from, and the two lists they read. One
// implementation, so a department is validated, saved and switched off the same way from either page. A department is never deleted
// (documents and assignments point at it): the only way out is to deactivate it, and it can be activated again.
// The rules that can be tested without a screen are in lib/departments.ts.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { assetsApi, departmentsApi, type Department } from '@/lib/api';
import { apiErrorText } from '@/lib/apiError';
import { DEACTIVATE_NOTE, departmentCreateBody, departmentPatch, parentChoices, roleItems, userItems, type DepartmentForm } from '@/lib/departments';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';

export type TenantUser = { id: number; display_name: string; email: string };

const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
const LABEL = 'mb-1 block text-xs font-medium text-[#3f4b58]';
export const TRIGGER = 'w-full !h-[38px] !text-[13px]';
export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1';
export const PRIMARY = `inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 disabled:opacity-50 ${FOCUS}`;
export const PLAIN = `rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 ${FOCUS}`;
const DANGER = `inline-flex items-center gap-1.5 rounded-lg bg-[#b42318] px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-[#912018] disabled:opacity-50 ${FOCUS}`;

// ── the lists both pages read ────────────────────────────────────────────────

/** Every department of the organisation, the switched-off ones too (one cache entry for both pages). */
export function useAdminDepartments() {
  return useQuery({
    queryKey: ['admin-departments'],
    queryFn: () => departmentsApi.list(true).then((r) => r.data),
  });
}

/** The people a lead or a member can be chosen from. */
export function useTenantUsers(enabled = true) {
  return useQuery({
    queryKey: ['admin-departments-users'],
    queryFn: () => assetsApi.getTenantUsers().then((r) => r.data as TenantUser[]),
    staleTime: 60 * 1000,
    enabled,
  });
}

// ── modal shell ──────────────────────────────────────────────────────────────

export function Modal({ title, subtitle, size = 'lg', onClose, footer, children }: {
  title: string;
  subtitle?: string;
  size?: 'md' | 'lg' | 'xl';
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // focus goes into the dialog (to its first field when it has one that asked for it)
  useEffect(() => { if (!box.current?.contains(document.activeElement)) box.current?.focus(); }, []);
  useEffect(() => {
    // Escape closes the dialog unless a picker inside it was open: that one handled the key (and said so)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const width = size === 'md' ? 'max-w-md' : size === 'xl' ? 'max-w-4xl' : 'max-w-xl';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/30 p-2 sm:items-center sm:p-4">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`flex max-h-[92vh] w-full ${width} flex-col rounded-xl border border-slate-200 bg-white shadow-xl focus:outline-none`}>
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-[#586472]">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={`rounded text-slate-500 hover:text-slate-900 ${FOCUS}`}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">{footer}</div>}
      </div>
    </div>
  );
}

function Field({ label, htmlFor, hint, wide, children }: { label: string; htmlFor?: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      {/* a picker's trigger names itself (aria-label), so its caption is not a label for anything */}
      {htmlFor ? <label htmlFor={htmlFor} className={LABEL}>{label}</label> : <span className={LABEL}>{label}</span>}
      {children}
      {hint && <p className="mt-1 text-[11px] text-[#586472]">{hint}</p>}
    </div>
  );
}

// ── create / edit ────────────────────────────────────────────────────────────

/** `departments`: every department (the parent choices come from it). `onSaved(message)`: it was saved - the caller closes the
 *  dialog, refreshes the lists (refreshDepartments) and says `message`. */
export function DepartmentFormModal({ mode, department, departments, onClose, onSaved }: {
  mode: 'create' | 'edit';
  department?: Department;
  departments: Department[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const id = useId();
  const [form, setForm] = useState<DepartmentForm>(() => ({
    name: department?.name ?? '',
    description: department?.description ?? '',
    parentId: department?.parent_department_id ?? null,
    leadId: department?.department_head_user_id ?? null,
    roleIds: department?.roles.map((r) => r.id) ?? [],
    active: department?.is_active ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<DepartmentForm>) => setForm((f) => ({ ...f, ...patch }));

  const rolesQ = useQuery({
    queryKey: ['department-role-options'],
    queryFn: () => departmentsApi.roleOptions().then((r) => r.data),
    staleTime: 60 * 1000,
  });
  const usersQ = useTenantUsers();
  const roleList = useMemo(() => roleItems(rolesQ.data, department?.roles), [rolesQ.data, department]);
  const peopleList = useMemo(() => {
    const items = userItems(usersQ.data);
    // a lead who is no longer among the people the list offers still shows, and a chosen lead can be taken off again
    if (form.leadId != null && !items.some((i) => i.value === String(form.leadId))) {
      items.unshift({ value: String(form.leadId), label: department?.department_head_name || `User ${form.leadId}` });
    }
    return form.leadId != null ? [{ value: '', label: 'No lead' }, ...items] : items;
  }, [usersQ.data, form.leadId, department?.department_head_name]);
  const parents = useMemo(
    () => parentChoices(departments, department?.id ?? null, department?.parent_department_id ?? null),
    [departments, department],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setProblem('Give the department a name.');
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      if (mode === 'create') {
        await departmentsApi.create(departmentCreateBody(form));
        onSaved('Department created.');
      } else if (department) {
        const patch = departmentPatch(department, form);
        if (Object.keys(patch).length === 0) {
          onClose();                                           // nothing was changed: nothing to save
          return;
        }
        await departmentsApi.update(department.id, patch);
        onSaved('Department updated.');
      }
    } catch (err: unknown) {
      setProblem(apiErrorText(err, 'The department could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const formId = `${id}-form`;
  return (
    <Modal
      title={mode === 'create' ? 'New department' : `Edit department — ${department?.name}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={PLAIN}>Cancel</button>
          <button type="submit" form={formId} disabled={saving} className={PRIMARY}>
            {saving && <Loader2 size={13} className="animate-spin" aria-hidden />}
            {mode === 'create' ? 'Create' : 'Save'}
          </button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name *" htmlFor={`${id}-name`} wide>
          <input id={`${id}-name`} value={form.name} onChange={(e) => set({ name: e.target.value })} required autoFocus className={INPUT}
            placeholder="Compliance / IT Security / Risk" />
        </Field>
        <Field label="Parent department" htmlFor={`${id}-parent`} wide>
          <select id={`${id}-parent`} value={form.parentId ?? ''} onChange={(e) => set({ parentId: e.target.value ? Number(e.target.value) : null })} className={INPUT}>
            <option value="">— None —</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </Field>
        <Field label="Description" htmlFor={`${id}-description`} wide>
          <textarea id={`${id}-description`} value={form.description} onChange={(e) => set({ description: e.target.value })} rows={2} className={INPUT} />
        </Field>
        <Field label="Lead">
          <MultiSelectDropdown title="Lead" items={peopleList} selectedValues={form.leadId == null ? [] : [String(form.leadId)]}
            onApply={(v) => set({ leadId: v[0] ? Number(v[0]) : null })} multiSelect={false} autoApply forceSearch triggerVariant="input"
            size="sm" placeholder="— None —" searchPlaceholder="Search people" triggerClassName={TRIGGER} />
        </Field>
        <Field label="Roles" hint="Everyone who holds these roles belongs to this department automatically">
          <MultiSelectDropdown title="Roles" items={roleList} selectedValues={form.roleIds.map(String)}
            onApply={(v) => set({ roleIds: v.map(Number) })} multiSelect autoApply forceSearch triggerVariant="input" namesInTrigger
            showAvatars={false} size="sm" searchPlaceholder="Search roles"
            placeholder={rolesQ.isLoading ? 'Loading roles…' : rolesQ.isError ? "Couldn't load the roles" : 'None'} triggerClassName={TRIGGER} />
          {rolesQ.isError && <p role="alert" className="mt-1 text-[11px] text-[#7a1616]">{apiErrorText(rolesQ.error, 'The roles could not be loaded.')}</p>}
        </Field>
        {mode === 'edit' && (
          <label className="flex items-center gap-2 text-[13px] text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
            Active
          </label>
        )}
        {problem && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#7a1616] sm:col-span-2">{problem}</p>
        )}
      </form>
    </Modal>
  );
}

// ── deactivate ───────────────────────────────────────────────────────────────

/** "Deactivate X?": what it does (DEACTIVATE_NOTE), Cancel and Deactivate. `error`: the failed call's error, shown under the note. */
export function DeactivateModal({ department, pending, error, onConfirm, onClose }: {
  department: Department;
  pending: boolean;
  error?: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`Deactivate ${department.name}?`}
      size="md"
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={PLAIN}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={pending} className={DANGER}>
            {pending && <Loader2 size={13} className="animate-spin" aria-hidden />}
            Deactivate
          </button>
        </>
      )}
    >
      <p className="text-[13px] text-[#26323d]">{DEACTIVATE_NOTE}</p>
      {error != null && (
        <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#7a1616]">
          {apiErrorText(error, 'Could not deactivate the department.')}
        </p>
      )}
    </Modal>
  );
}
