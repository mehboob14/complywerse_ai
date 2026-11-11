'use client';

// The fields of a unit, for both ways in: the New dialog (a unit that does not exist yet, started under the unit the person was in) and the Details tab of the popup (a
// unit that does: saved as a patch of only what changed). Name, where it sits (the places lib/departments.ts allows, so a move is a change of this field), the owner and
// a description. The words and rules are lib/departments.ts's (the same body, the same patch, the same "Will be: Sub-department" as Administration → Departments), and
// the server's refusals (a name already taken, a unit that would be too deep) are shown as it says them, with what was typed kept. A person who may not change the
// unit sees the same facts as text. Roles and people are the People tab's; switching a unit off is its own question (useToggleActive).
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MAX_DEPTH, departmentCreateBody, departmentFormDirty, departmentPatch, userItems, willBeText, type DepartmentForm } from '@/lib/departments';
import { departmentsApi, type Department, type DepartmentDetail } from '@/lib/api';
import { Button, Combobox, FormError, FormField, Select, TextInput, Textarea, useReportedMutation, type ListOption } from '@/components/ui/ds';
import { useTenantUsers } from '@/components/admin/DepartmentForm';
import { useRefreshDirectory } from './directoryData';
import { moveChoices, newPlaceChoices, type DirectoryTree } from './directoryModel';

interface Props {
  mode: 'create' | 'edit';
  /** edit: the unit's full record (its roles, its description); the form is made from it, so give it a new `key` when it is saved again */
  department?: DepartmentDetail;
  tree: DirectoryTree;
  levels: readonly string[];
  canTop: boolean;
  /** create: the unit it is opened under (null: at the top) */
  start?: number | null;
  /** the person may read, not change: the facts as text */
  readOnly?: boolean;
  onSaved: (saved: Department) => void;
  onCancel?: () => void;
  /** what typed input there is, so the popup or dialog around asks before it is thrown away */
  onDirty?: (dirty: boolean) => void;
}

const NAME_MAX = 200;

export function UnitForm({ mode, department, tree, levels, canTop, start = null, readOnly = false, onSaved, onCancel, onDirty }: Props) {
  const refresh = useRefreshDirectory();
  const [form, setForm] = useState<DepartmentForm>(() => ({
    name: department?.name ?? '',
    description: department?.description ?? '',
    parentId: department ? department.parent_department_id ?? null : start,
    leadId: department?.department_head_user_id ?? null,
    roleIds: department?.roles.map((r) => r.id) ?? [],       // not edited here: the patch leaves them as they are
    active: department?.is_active ?? true,
  }));
  const [problem, setProblem] = useState<unknown>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const set = (patch: Partial<DepartmentForm>) => setForm((f) => ({ ...f, ...patch }));
  const users = useTenantUsers(!readOnly);

  const dirty = !readOnly && departmentFormDirty(mode, department, form, start);
  const report = useRef(onDirty);                          // the latest callback, so a caller that makes a new one every render does not reset the flag
  report.current = onDirty;
  useEffect(() => { report.current?.(dirty); }, [dirty]);
  useEffect(() => () => report.current?.(false), []);

  const places = useMemo(
    () => (mode === 'edit' && department ? moveChoices(tree, department.id, { canTop, levels }) : newPlaceChoices(tree, start, { canTop, levels })),
    [mode, department, tree, canTop, levels, start],
  );
  const owners = useMemo<ListOption[]>(() => {
    const list = userItems(users.data).map((u) => ({ value: u.value, label: u.label, description: u.subLabel }));
    // an owner who is no longer among the people on offer still shows, and can be chosen away
    if (form.leadId != null && !list.some((o) => o.value === String(form.leadId))) list.unshift({ value: String(form.leadId), label: department?.department_head_name || 'Current owner', description: undefined });
    return list;
  }, [users.data, form.leadId, department?.department_head_name]);

  const save = useReportedMutation({
    mutationFn: async () => {
      if (mode === 'create') return (await departmentsApi.create(departmentCreateBody(form))).data;
      return (await departmentsApi.update((department as DepartmentDetail).id, departmentPatch(department as DepartmentDetail, form))).data;
    },
    success: (saved) => (mode === 'create' ? `${saved.name} created` : `${saved.name} saved`),
    failure: mode === 'create' ? "The unit wasn't created" : "The unit wasn't saved",
    toast: 'success',                                       // a refusal is said here, above the fields, in the server's words
    onSuccess: (saved) => { refresh(); onSaved(saved); },
    onError: (e) => setProblem(e),
    retryable: false,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!form.name.trim()) { setNameError('Give the unit a name'); return; }
    setNameError(null);
    if (mode === 'edit' && !dirty) return;
    save.mutate();
  };

  const hasUnder = mode === 'edit' && department != null && tree.height(department.id) > 0;
  const parentNote = `Units go ${MAX_DEPTH} levels deep: ${levels.slice(0, MAX_DEPTH).join(', ')}. ${hasUnder ? 'A unit with units under it has fewer places to go. ' : ''}Switched-off units and places you cannot manage are not listed.`;
  const placeName = (parentId: number | null) => (parentId === null ? 'Organisation (top level)' : tree.path(parentId).map((p) => p.name).join(' › '));

  if (readOnly && department) {
    return (
      <dl className="grid grid-cols-1 gap-x-[16px] gap-y-[12px] sm:grid-cols-2">
        <ReadFact label="Name">{department.name}</ReadFact>
        <ReadFact label="Sits under">{placeName(department.parent_department_id ?? null)}</ReadFact>
        <ReadFact label="Owner">{department.department_head_name}</ReadFact>
        <ReadFact label="Description" wide>{department.description}</ReadFact>
      </dl>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-[12px]">
      <FormError title={mode === 'create' ? "Couldn't create the unit" : "Couldn't save the unit"} error={problem} />
      <div className="grid grid-cols-1 gap-x-[16px] gap-y-[12px] sm:grid-cols-2">
        <FormField label="Name" required error={nameError} className="sm:col-span-2">
          <TextInput value={form.name} maxLength={NAME_MAX} autoComplete="off" autoFocus={mode === 'create'} onChange={(e) => { set({ name: e.target.value }); setNameError(null); }} />
        </FormField>
        <FormField label={mode === 'create' ? 'Under' : 'Sits under'} info={parentNote} hint={willBeText(tree.nodes, form.parentId, [...levels])} className="sm:col-span-2">
          <Select value={form.parentId === null ? '' : String(form.parentId)} onChange={(e) => set({ parentId: e.target.value ? Number(e.target.value) : null })}>
            {places.map((p) => <option key={p.value} value={p.value}>{p.label}{p.subLabel ? ` · ${p.subLabel}` : ''}</option>)}
          </Select>
        </FormField>
        <FormField label="Owner" info="Sees the Documents overview for this unit and everything under it.">
          <Combobox label="Owner" options={owners} value={form.leadId === null ? null : String(form.leadId)} onChange={(v) => set({ leadId: v === null ? null : Number(v) })}
            clearable placeholder={users.isLoading ? 'Loading people' : 'No owner'} searchPlaceholder="Search people" disabled={users.isLoading} />
        </FormField>
        <FormField label="Description" optional className="sm:col-span-2">
          <Textarea rows={3} value={form.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
        </FormField>
      </div>
      <div className="flex flex-wrap justify-end gap-[8px]">
        {onCancel && <Button onClick={onCancel}>{mode === 'create' ? 'Cancel' : 'Discard'}</Button>}
        <Button type="submit" variant="primary" loading={save.isPending} disabled={mode === 'edit' && !dirty}>{mode === 'create' ? 'Create' : 'Save'}</Button>
      </div>
    </form>
  );
}

function ReadFact({ label, wide, children }: { label: string; wide?: boolean; children?: string | null }) {
  return (
    <div className={wide ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
      <dt className="text-ds-label font-normal text-ds-fg-muted">{label}</dt>
      <dd className="mt-[2px] min-w-0 break-words text-ds-body text-ds-fg">{children ? children : <span className="text-ds-fg-muted">Not set</span>}</dd>
    </div>
  );
}
