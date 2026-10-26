'use client';

// Administration → Departments: the one list of departments that documents, sign-off, assets, assessments, stage owners and risks
// pick from. A department's people are those added by hand, its lead, and everyone who holds one of its roles (they join and leave
// with the role). The rules that can be tested without a screen are in lib/departments.ts.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Building2, Edit2, Loader2, Plus, Power, UserPlus, X } from 'lucide-react';
import { departmentsApi, type Department, type DepartmentMember, type DepartmentMemberRole } from '@/lib/api';
import { apiErrorText } from '@/lib/apiError';
import { parseUtc } from '@/lib/serverTime';
import {
  MEMBER_ROLES, activatedText, deactivatedText, howChips, memberSummary, refreshDepartments, removeBlock, roleChips, userItems,
} from '@/lib/departments';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { PageLoader } from '@/components/ui';
// the create/edit form and the "deactivate?" question are shared with Governance → Settings → Departments (one implementation)
import {
  DeactivateModal, DepartmentFormModal, FOCUS, Modal, PLAIN, PRIMARY, TRIGGER, useAdminDepartments, useTenantUsers, type TenantUser,
} from '@/components/admin/DepartmentForm';

const SMALL = `inline-flex items-center gap-1 rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
// teal tints for the lead and for people added by hand, grey for those who come through a role (never blue or purple)
const CHIP: Record<'lead' | 'hand' | 'role', string> = {
  lead: 'border-primary-300 bg-primary-100 text-[#0b5f58]',
  hand: 'border-primary-200 bg-primary-50 text-[#0f766e]',
  role: 'border-[#d5dbe1] bg-[#f3f6f8] text-[#26323d]',
};
const CHIP_BASE = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium';

// ── page ─────────────────────────────────────────────────────────────────────

export default function DepartmentsAdminPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [managing, setManaging] = useState<Department | null>(null);
  const [switching, setSwitching] = useState<Department | null>(null);      // asked before it is switched off
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const list = useAdminDepartments();
  const usersQ = useTenantUsers();

  // every picker that reads the departments is out of date as soon as one changes
  const refresh = () => refreshDepartments(qc);

  const deactivate = useMutation({
    mutationFn: (d: Department) => departmentsApi.deactivate(d.id),
    onSuccess: (_r, d) => {
      setSwitching(null);
      refresh();
      setOkMessage(deactivatedText(d.name));
    },
  });
  const activate = useMutation({
    mutationFn: (d: Department) => departmentsApi.update(d.id, { is_active: true }),
    onSuccess: (_r, d) => {
      refresh();
      setOkMessage(activatedText(d.name));
    },
    onError: (e: unknown) => setError(apiErrorText(e, 'Could not activate the department.')),
  });

  const rows = useMemo(
    () => (list.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [list.data],
  );
  const users = usersQ.data ?? [];

  if (list.isLoading) return <PageLoader className="h-64" />;

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-[#7a1616]">
          <span className="flex items-center gap-2"><AlertCircle size={14} aria-hidden />{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className={`rounded ${FOCUS}`}><X className="h-4 w-4" aria-hidden /></button>
        </div>
      )}
      {okMessage && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-[#14532d]">
          <span>{okMessage}</span>
          <button type="button" onClick={() => setOkMessage(null)} aria-label="Dismiss" className={`rounded ${FOCUS}`}><X className="h-4 w-4" aria-hidden /></button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-6">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Building2 size={16} className="text-slate-600" aria-hidden />
              Departments
            </h2>
            <p className="mt-0.5 text-xs text-[#586472]">Documents, sign-off, assets, assessments and risks pick from this list.</p>
          </div>
          <button type="button" onClick={() => setCreateOpen(true)} className={PRIMARY}>
            <Plus size={14} aria-hidden />
            New Department
          </button>
        </div>

        <div className="p-4 sm:p-6">
          {list.isError ? (
            <div role="alert" className="py-10 text-center">
              <p className="text-sm text-[#7a1616]">{apiErrorText(list.error, 'The departments could not be loaded.')}</p>
              <button type="button" onClick={() => list.refetch()} className={`${PLAIN} mt-3`}>Try again</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center">
              <Building2 className="mx-auto mb-3 h-12 w-12 text-slate-300" aria-hidden />
              <p className="mx-auto max-w-xl text-sm text-[#3f4b58]">
                No departments yet. Create departments such as Compliance, IT Security or Risk — pick the roles whose people belong to each,
                or add people by hand. Documents, sign-off, assets and assessments pick from this list.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">Name</th>
                    <th scope="col" className="px-3 py-2 text-left">Lead</th>
                    <th scope="col" className="px-3 py-2 text-left">Roles</th>
                    <th scope="col" className="px-3 py-2 text-left">Members</th>
                    <th scope="col" className="px-3 py-2 text-left">Status</th>
                    <th scope="col" className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <p className="text-[13px] font-medium text-slate-900">
                          {d.name}
                          {d.code && <span className="ml-1.5 rounded border border-[#d5dbe1] bg-[#f3f6f8] px-1.5 py-0.5 font-mono text-[10.5px] font-normal text-[#3f4b58]">{d.code}</span>}
                        </p>
                        {d.description && <p className="mt-0.5 max-w-md truncate text-xs text-[#586472]" title={d.description}>{d.description}</p>}
                        {d.parent_department_name && <p className="mt-0.5 text-xs text-[#586472]">Under {d.parent_department_name}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-[13px] text-slate-700">{d.department_head_name || '—'}</td>
                      <td className="px-3 py-2.5 text-[13px]"><RoleChips roles={d.roles} /></td>
                      <td className="px-3 py-2.5 text-[13px] text-slate-700" title={`${d.manual_member_count} added by hand`}>{d.member_count}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${d.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-100 text-[#3f4b58]'}`}>
                          {d.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <button type="button" onClick={() => setManaging(d)} aria-label={`Members of ${d.name}`}
                            className={`${SMALL} border-primary-200 bg-primary-50 text-[#0f766e] hover:bg-primary-100`}>
                            <UserPlus size={12} aria-hidden /> Members
                          </button>
                          <button type="button" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}
                            className={`${SMALL} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
                            <Edit2 size={12} aria-hidden /> Edit
                          </button>
                          {d.is_active ? (
                            <button type="button" onClick={() => { deactivate.reset(); setSwitching(d); }} aria-label={`Deactivate ${d.name}`}
                              className={`${SMALL} border-rose-300 bg-rose-50 text-[#9b1c1c] hover:bg-rose-100`}>
                              <Power size={12} aria-hidden /> Deactivate
                            </button>
                          ) : (
                            <button type="button" onClick={() => activate.mutate(d)} disabled={activate.isPending} aria-label={`Activate ${d.name}`}
                              className={`${SMALL} border-primary-200 bg-primary-50 text-[#0f766e] hover:bg-primary-100`}>
                              <Power size={12} aria-hidden /> Activate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <DepartmentFormModal
          mode="create"
          departments={rows}
          onClose={() => setCreateOpen(false)}
          onSaved={(message) => { setCreateOpen(false); refresh(); setOkMessage(message); }}
        />
      )}
      {editing && (
        <DepartmentFormModal
          mode="edit"
          department={editing}
          departments={rows}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); refresh(); setOkMessage(message); }}
        />
      )}
      {managing && (
        <MembersModal department={managing} users={users} onClose={() => setManaging(null)} onChanged={refresh} />
      )}
      {switching && (
        <DeactivateModal department={switching} pending={deactivate.isPending} error={deactivate.error}
          onConfirm={() => deactivate.mutate(switching)} onClose={() => setSwitching(null)} />
      )}
    </div>
  );
}

function RoleChips({ roles }: { roles: Department['roles'] }) {
  const { names, more } = roleChips(roles);
  if (names.length === 0) return <span className="text-[#586472]">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {names.map((name, i) => <span key={`${name}-${i}`} className={`${CHIP_BASE} ${CHIP.role}`}>{name}</span>)}
      {more > 0 && <span className="text-xs text-[#586472]" title={roles.map((r) => r.name).join(', ')}>+{more} more</span>}
    </span>
  );
}

// ── members ──────────────────────────────────────────────────────────────────

function MembersModal({ department, users, onClose, onChanged }: {
  department: Department;
  users: TenantUser[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [addUserId, setAddUserId] = useState<number | null>(null);
  const [addRole, setAddRole] = useState<DepartmentMemberRole>('member');
  const [problem, setProblem] = useState<string | null>(null);
  const key = ['admin-department', department.id];

  const detail = useQuery({
    queryKey: key,
    queryFn: () => departmentsApi.get(department.id).then((r) => r.data),
  });
  const members = detail.data?.members ?? [];

  const changed = () => {
    setProblem(null);
    qc.invalidateQueries({ queryKey: key });
    onChanged();
  };
  const failed = (fallback: string) => (e: unknown) => setProblem(apiErrorText(e, fallback));       // a 409 says why, as the server worded it

  const add = useMutation({
    mutationFn: () => departmentsApi.addMember(department.id, { user_id: addUserId as number, role: addRole }),
    onSuccess: () => { setAddUserId(null); changed(); },
    onError: failed('The person could not be added.'),
  });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: DepartmentMemberRole }) => departmentsApi.updateMember(department.id, userId, { role }),
    onSuccess: changed,
    onError: failed('The role could not be changed.'),
  });
  const remove = useMutation({
    mutationFn: (userId: number) => departmentsApi.removeMember(department.id, userId),
    onSuccess: changed,
    onError: failed('The person could not be removed.'),
  });
  const busy = add.isPending || setRole.isPending || remove.isPending;

  // anyone can be added by hand, also a person who belongs through a role (they then stay if the role is taken off)
  const candidates = useMemo(
    () => userItems(users.filter((u) => !members.some((m) => m.user_id === u.id && m.how.includes('manual')))),
    [users, members],
  );

  return (
    <Modal
      title={`Members — ${department.name}`}
      subtitle={detail.data ? memberSummary(members) : `${department.member_count} ${department.member_count === 1 ? 'person' : 'people'}`}
      size="xl"
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className={PLAIN}>Close</button>}
    >
      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 text-xs font-medium text-[#3f4b58]">Add a member</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[200px] flex-1">
            <MultiSelectDropdown title="Person" items={candidates} selectedValues={addUserId == null ? [] : [String(addUserId)]}
              onApply={(v) => setAddUserId(v[0] ? Number(v[0]) : null)} multiSelect={false} autoApply forceSearch triggerVariant="input"
              size="sm" placeholder="Choose a person" searchPlaceholder="Search people" triggerClassName={TRIGGER} />
          </div>
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as DepartmentMemberRole)} aria-label="Role in the department"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900">
            {MEMBER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button type="button" onClick={() => addUserId != null && add.mutate()} disabled={addUserId == null || busy} className={PRIMARY}>
            {add.isPending && <Loader2 size={12} className="animate-spin" aria-hidden />}
            Add
          </button>
        </div>
      </div>

      {problem && <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-[#7a1616]">{problem}</p>}

      {detail.isLoading ? (
        <PageLoader className="h-32" />
      ) : detail.isError ? (
        <div role="alert" className="py-6 text-center">
          <p className="text-sm text-[#7a1616]">{apiErrorText(detail.error, 'The members could not be loaded.')}</p>
          <button type="button" onClick={() => detail.refetch()} className={`${PLAIN} mt-3`}>Try again</button>
        </div>
      ) : members.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[#3f4b58]">No members yet. Add a person above, or give the department a role under Edit.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Person</th>
                <th scope="col" className="px-3 py-2 text-left">How</th>
                <th scope="col" className="px-3 py-2 text-left">Role</th>
                <th scope="col" className="px-3 py-2 text-left">Added</th>
                <th scope="col" className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <MemberRow key={m.user_id} m={m} busy={busy}
                  onRole={(role) => setRole.mutate({ userId: m.user_id, role })} onRemove={() => remove.mutate(m.user_id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function MemberRow({ m, busy, onRole, onRemove }: { m: DepartmentMember; busy: boolean; onRole: (role: DepartmentMemberRole) => void; onRemove: () => void }) {
  const byHand = m.how.includes('manual');
  const blocked = removeBlock(m);
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-3 py-2.5">
        <p className="text-[13px] font-medium text-slate-900">{m.name}</p>
        <p className="text-xs text-[#586472]">{m.email}</p>
        {m.designation && <p className="text-xs text-[#586472]">{m.designation}</p>}
      </td>
      <td className="px-3 py-2.5">
        <span className="flex flex-wrap gap-1">
          {howChips(m).map((c) => <span key={c.key} className={`${CHIP_BASE} ${CHIP[c.kind]}`}>{c.label}</span>)}
        </span>
      </td>
      <td className="px-3 py-2.5">
        {byHand ? (
          <select value={m.member_role ?? 'member'} onChange={(e) => onRole(e.target.value as DepartmentMemberRole)} disabled={busy}
            aria-label={`Role of ${m.name} in the department`}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 disabled:opacity-60">
            {MEMBER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        ) : <span className="text-[13px] text-[#586472]">—</span>}
      </td>
      <td className="px-3 py-2.5 text-xs text-[#3f4b58]">{parseUtc(m.added_at)?.toLocaleDateString() ?? '—'}</td>
      <td className="px-3 py-2.5 text-right">
        <button type="button" onClick={onRemove} disabled={busy || blocked != null} title={blocked ?? `Remove ${m.name} from the department`}
          aria-label={`Remove ${m.name}`}
          className={`${SMALL} border-rose-300 bg-rose-50 text-[#9b1c1c] hover:bg-rose-100`}>
          <X size={11} aria-hidden /> Remove
        </button>
      </td>
    </tr>
  );
}
