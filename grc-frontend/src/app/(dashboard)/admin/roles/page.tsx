'use client';

import { useState, useEffect } from 'react';
import { PageHeader, DataTable } from '@/components/ui';
import { adminApi, AdminRole, PermissionModule } from '@/lib/api';

async function ensureTenantContext(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  
  const existingSlug = localStorage.getItem('tenant_slug');
  if (existingSlug) return true;
  
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
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
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permission_names: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

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
          <div className="font-medium text-black flex items-center gap-2">
            {role.name}
            {role.is_system_role && (
              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
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
        <span className="text-slate-600">{role.user_count}</span>
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
        <div className="flex space-x-2">
          <button
            onClick={() => handleEdit(role)}
            className="px-3 py-1 bg-slate-600 hover:bg-slate-500 text-black rounded text-sm"
          >
            {role.is_system_role ? 'View' : 'Edit'}
          </button>
          {!role.is_system_role && (
            <button
              onClick={() => handleDelete(role)}
              className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-600 rounded text-sm"
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role Management"
        subtitle="Create and manage roles with granular permissions"
      />

      {error && (
        <div className="bg-red-50 border border-red-500/50 rounded-lg p-4 text-red-600">
          {error}
          <button onClick={() => setError(null)} className="ml-4 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm transition-colors"
        >
          + Create Role
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <DataTable data={roles} columns={columns} />
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-4xl my-8">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-black">
                {editingRole ? (editingRole.is_system_role ? 'View Role' : 'Edit Role') : 'Create Role'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Role Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500"
                    required
                    disabled={editingRole?.is_system_role}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, description: e.target.value }))
                    }
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500"
                    disabled={editingRole?.is_system_role}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-4">
                  Permissions Matrix
                </label>
                <div className="border border-slate-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                  {permissionMatrix.map((module) => (
                    <div key={module.module} className="border-b border-slate-200 last:border-b-0">
                      <div
                        className="flex items-center justify-between p-4 bg-slate-50 cursor-pointer hover:bg-white"
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
                          <span className="font-medium text-black">{module.display_name}</span>
                        </div>
                        <svg
                          className={`w-5 h-5 text-slate-600 transition-transform ${
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
                        <div className="bg-white/50 p-4">
                          {module.submodules.map((sub) => (
                            <div key={sub.name} className="mb-4 last:mb-0">
                              <div className="text-sm font-medium text-slate-600 mb-2">
                                {sub.display_name}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {sub.actions.map((action) => {
                                  const permName = `${module.module}:${sub.name}:${action}`;
                                  const isSelected = formData.permission_names.includes(permName);
                                  return (
                                    <label
                                      key={action}
                                      className={`flex items-center space-x-2 px-3 py-1.5 rounded cursor-pointer transition-colors ${
                                        isSelected
                                          ? 'bg-primary-500/30 border border-primary-500'
                                          : 'bg-slate-200 border border-slate-300 hover:border-slate-400'
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
                                        className={`text-sm ${
                                          isSelected ? 'text-primary-500' : 'text-slate-600'
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

              <div className="flex justify-between items-center pt-4 border-t border-slate-200">
                <div className="text-sm text-slate-600">
                  {formData.permission_names.length} permission(s) selected
                </div>
                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-black rounded-lg text-sm"
                  >
                    {editingRole?.is_system_role ? 'Close' : 'Cancel'}
                  </button>
                  {!editingRole?.is_system_role && (
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : editingRole ? 'Update Role' : 'Create Role'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
