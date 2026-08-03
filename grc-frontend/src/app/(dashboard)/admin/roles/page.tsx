'use client';

import { useState, useEffect, useMemo } from 'react';
import { DataTable, IfPermission, SearchInput, PageLoader } from '@/components/ui';
import { Edit2, Eye, Plus, Trash2, Users, X } from 'lucide-react';
import { adminApi, AdminRole, PermissionModule } from '@/lib/api';
import { authedFetch } from '@/lib/auth-fetch';

// Shape of the GET /admin/roles/{id}/members response — kept local because
// only this page consumes it.
interface RoleMember {
  user_id: number;
  username: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  assigned_at: string | null;
  assigned_by_user_id: number | null;
  user_role_id: number;
}
interface RoleMembersResponse {
  role_id: number;
  role_name: string;
  member_count: number;
  members: RoleMember[];
}

async function ensureTenantContext(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const existingSlug = localStorage.getItem('tenant_slug');
  if (existingSlug) return true;

  try {
    const response = await authedFetch('/api/auth/me');
    if (!response.ok) return false;
    
    const data = await response.json();
    if (data.authenticated && data.tenant) {
      localStorage.setItem('tenant_slug', data.tenant.slug || '');
      localStorage.setItem('tenant_name', data.tenant.name || '');
      localStorage.setItem('tenant_id', String(data.tenant.id || ''));
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export default function RolesManagementPage() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [permissionMatrix, setPermissionMatrix] = useState<PermissionModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<AdminRole | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permission_names: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  // Members drill-down — clicking the user count opens a modal with the
  // actual list of users assigned to that role.
  const [membersForRole, setMembersForRole] = useState<RoleMembersResponse | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const handleViewMembers = async (role: AdminRole) => {
    setMembersForRole({ role_id: role.id, role_name: role.name, member_count: role.user_count ?? 0, members: [] });
    setMembersError(null);
    setMembersLoading(true);
    try {
      const res = await adminApi.getRoleMembers(role.id);
      setMembersForRole(res.data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message ||
        'Failed to load role members';
      setMembersError(msg);
    } finally {
      setMembersLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const ready = await ensureTenantContext();
      if (ready) {
        fetchData();
      } else {
        setLoading(false);
        setError('No organization context found. Please log out and log in with your organization credentials.');
      }
    };
    init();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [rolesRes, matrixRes] = await Promise.all([
        adminApi.getRoles(),
        adminApi.getPermissionMatrix(),
      ]);
      setRoles(rolesRes.data);
      setPermissionMatrix(matrixRes.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingRole(null);
    setFormData({
      name: '',
      description: '',
      permission_names: [],
    });
    setExpandedModules(new Set());
    setShowModal(true);
  };

  const handleEdit = async (role: AdminRole) => {
    try {
      const response = await adminApi.getRole(role.id);
      setEditingRole(response.data);
      setFormData({
        name: response.data.name,
        description: response.data.description || '',
        permission_names: response.data.permissions,
      });
      setExpandedModules(new Set());
      setShowModal(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load role details');
    }
  };

  const handleDelete = async (role: AdminRole) => {
    if (role.is_system_role) {
      setError('Cannot delete system roles');
      return;
    }
    if (!confirm(`Are you sure you want to delete role "${role.name}"?`)) {
      return;
    }
    try {
      await adminApi.deleteRole(role.id);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete role');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      if (editingRole) {
        await adminApi.updateRole(editingRole.id, {
          name: formData.name,
          description: formData.description,
          permission_names: formData.permission_names,
        });
      } else {
        await adminApi.createRole({
          name: formData.name,
          description: formData.description,
          permission_names: formData.permission_names,
        });
      }
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = (permName: string) => {
    setFormData((prev) => ({
      ...prev,
      permission_names: prev.permission_names.includes(permName)
        ? prev.permission_names.filter((p) => p !== permName)
        : [...prev.permission_names, permName],
    }));
  };

  const toggleModuleExpand = (module: string) => {
    const newExpanded = new Set(expandedModules);
    if (newExpanded.has(module)) {
      newExpanded.delete(module);
    } else {
      newExpanded.add(module);
    }
    setExpandedModules(newExpanded);
  };

  const toggleAllModulePermissions = (module: PermissionModule, checked: boolean) => {
    const modulePerms: string[] = [];
    module.submodules.forEach((sub) => {
      sub.actions.forEach((action) => {
        modulePerms.push(`${module.module}:${sub.name}:${action}`);
      });
    });

    setFormData((prev) => ({
      ...prev,
      permission_names: checked
        ? Array.from(new Set([...prev.permission_names, ...modulePerms]))
        : prev.permission_names.filter((p) => !modulePerms.includes(p)),
    }));
  };

  const isModuleFullySelected = (module: PermissionModule): boolean => {
    const modulePerms: string[] = [];
    module.submodules.forEach((sub) => {
      sub.actions.forEach((action) => {
        modulePerms.push(`${module.module}:${sub.name}:${action}`);
      });
    });
    return modulePerms.every((p) => formData.permission_names.includes(p));
  };

  const isModulePartiallySelected = (module: PermissionModule): boolean => {
    const modulePerms: string[] = [];
    module.submodules.forEach((sub) => {
      sub.actions.forEach((action) => {
        modulePerms.push(`${module.module}:${sub.name}:${action}`);
      });
    });
    const selected = modulePerms.filter((p) => formData.permission_names.includes(p));
    return selected.length > 0 && selected.length < modulePerms.length;
  };

  const columns = [
    {
      id: 'role',
      header: 'Role',
      accessor: (role: AdminRole) => (
        <div>
          <div className="font-medium text-slate-900 flex items-center gap-2">
            {role.name}
            {role.is_system_role && (
              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">
                System
              </span>
            )}
          </div>
          {role.description && (
            <div className="text-sm text-slate-600">{role.description}</div>
          )}
        </div>
      ),
    },
    {
      id: 'users',
      header: 'Users',
      accessor: (role: AdminRole) => (
        // Clickable count opens the members modal. Falls back to a plain
        // span when there are zero members so the cell isn't visually noisy.
        (role.user_count ?? 0) > 0 ? (
          <button
            type="button"
            onClick={() => handleViewMembers(role)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-slate-700 hover:bg-slate-100 hover:text-primary-600 transition-colors"
            title="View users assigned to this role"
          >
            <Users size={14} />
            <span>{role.user_count}</span>
          </button>
        ) : (
          <span className="text-slate-400">0</span>
        )
      ),
    },
    {
      id: 'permissions',
      header: 'Permissions',
      accessor: (role: AdminRole) => (
        <span className="text-slate-600">{role.permissions.length}</span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      accessor: (role: AdminRole) => (
        <div className="flex items-center gap-1">
          <IfPermission required={["admin:roles:edit", "admin:roles:view"]}>
            <button
              onClick={() => handleEdit(role)}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary-600 transition-colors"
              title={role.is_system_role ? 'View role' : 'Edit role'}
              aria-label={role.is_system_role ? 'View role' : 'Edit role'}
            >
              {role.is_system_role ? <Eye size={16} /> : <Edit2 size={16} />}
            </button>
          </IfPermission>
          {!role.is_system_role && (
            <IfPermission required="admin:roles:delete">
              <button
                onClick={() => handleDelete(role)}
                className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                title="Delete role"
                aria-label="Delete role"
              >
                <Trash2 size={16} />
              </button>
            </IfPermission>
          )}
        </div>
      ),
    },
  ];

  const filteredRoles = useMemo(() => {
    if (!searchTerm.trim()) return roles;
    const q = searchTerm.toLowerCase();
    return roles.filter((r) =>
      r.name?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q)
    );
  }, [roles, searchTerm]);

  if (loading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">Role Management</h1>
          <p className="mt-1 text-sm text-slate-600">Create and manage roles with granular permissions</p>
        </div>
        <IfPermission required="admin:roles:create">
          <button
            onClick={handleCreate}
            className="cw-btn-primary flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-2 text-sm font-medium flex-shrink-0"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Create Role</span>
            <span className="sm:hidden">New</span>
          </button>
        </IfPermission>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-700">
          {error}
          <button onClick={() => setError(null)} className="ml-4 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[180px] sm:max-w-md">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search roles..."
            size="md"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <DataTable data={filteredRoles} columns={columns} />
      </div>

      {showModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowModal(false)} />
          <div className="fixed inset-y-0 right-0 z-50 flex w-[800px] flex-col bg-white shadow-2xl border-l border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
              <h2 className="text-sm font-semibold text-slate-900">
                {editingRole ? (editingRole.is_system_role ? 'View Role' : 'Edit Role') : 'Create Role'}
              </h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">
                      Role Name
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, name: e.target.value }))
                      }
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500"
                      required
                      disabled={editingRole?.is_system_role}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">
                      Description
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, description: e.target.value }))
                      }
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500"
                      disabled={editingRole?.is_system_role}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Permissions Matrix
                  </label>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    {permissionMatrix.map((module) => (
                      <div key={module.module} className="border-b border-slate-200 last:border-b-0">
                        <div
                          className="flex items-center justify-between p-3 bg-slate-50 cursor-pointer hover:bg-white"
                          onClick={() => toggleModuleExpand(module.module)}
                        >
                          <div className="flex items-center space-x-3">
                            <input
                              type="checkbox"
                              checked={isModuleFullySelected(module)}
                              ref={(el) => {
                                if (el) el.indeterminate = isModulePartiallySelected(module);
                              }}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleAllModulePermissions(module, e.target.checked);
                              }}
                              className="w-4 h-4 rounded border-slate-300 bg-slate-50 text-primary-600 focus:ring-primary-500"
                              disabled={editingRole?.is_system_role}
                            />
                            <span className="text-sm font-medium text-slate-900">{module.display_name}</span>
                          </div>
                          <svg
                            className={`w-4 h-4 text-slate-500 transition-transform ${
                              expandedModules.has(module.module) ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>

                        {expandedModules.has(module.module) && (
                          <div className="bg-white/50 px-4 py-3">
                            {module.submodules.map((sub) => (
                              <div key={sub.name} className="mb-3 last:mb-0">
                                <div className="text-xs font-medium text-slate-500 mb-1.5">
                                  {sub.display_name}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {sub.actions.map((action) => {
                                    const permName = `${module.module}:${sub.name}:${action}`;
                                    const isSelected = formData.permission_names.includes(permName);
                                    return (
                                      <label
                                        key={action}
                                        className={`flex items-center space-x-2 px-2.5 py-1 rounded cursor-pointer transition-colors ${
                                          isSelected
                                            ? 'bg-primary-50 border border-primary-500'
                                            : 'bg-slate-100 border border-slate-300 hover:border-slate-400'
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => togglePermission(permName)}
                                          className="hidden"
                                          disabled={editingRole?.is_system_role}
                                        />
                                        <span
                                          className={`text-xs ${
                                            isSelected ? 'text-primary-700' : 'text-slate-600'
                                          }`}
                                        >
                                          {action.replace('_', ' ')}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 px-6 py-4 flex justify-between items-center flex-shrink-0">
                <div className="text-xs text-slate-500">
                  {formData.permission_names.length} permission(s) selected
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded text-sm"
                  >
                    {editingRole?.is_system_role ? 'Close' : 'Cancel'}
                  </button>
                  {!editingRole?.is_system_role && (
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-[color:var(--color-on-base,#0a0a0a)] rounded text-sm disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : editingRole ? 'Update Role' : 'Create Role'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Role members modal — opened by clicking the user count in the table.
          Read-only list of users assigned to the role with assignment date.
          Closing the modal does not refresh the table (the count is already
          there); we only need it open while the admin checks who has access. */}
      {membersForRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMembersForRole(null)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Users size={16} className="text-slate-600" />
                  Members of <span className="text-primary-700">{membersForRole.role_name}</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {membersForRole.member_count} user{membersForRole.member_count === 1 ? '' : 's'} assigned
                </p>
              </div>
              <button
                onClick={() => setMembersForRole(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              {membersLoading && (
                <p className="text-sm text-slate-500 italic">Loading members…</p>
              )}
              {membersError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {membersError}
                </p>
              )}
              {!membersLoading && !membersError && membersForRole.members.length === 0 && (
                <p className="text-sm text-slate-500 italic">No users are currently assigned to this role.</p>
              )}
              {!membersLoading && membersForRole.members.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {membersForRole.members.map((m) => (
                    <li key={m.user_role_id} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {m.display_name || m.username}
                          {!m.is_active && (
                            <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                              Inactive
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-500">{m.email}</p>
                      </div>
                      <p className="ml-3 flex-shrink-0 text-xs text-slate-400">
                        {m.assigned_at ? new Date(m.assigned_at).toLocaleDateString() : '—'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-end border-t border-slate-100 bg-slate-50 px-5 py-3 rounded-b-2xl">
              <button
                onClick={() => setMembersForRole(null)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
