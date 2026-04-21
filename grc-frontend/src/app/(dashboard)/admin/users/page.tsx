'use client';

import { useState, useEffect } from 'react';
import { PageHeader, DataTable, IfPermission } from '@/components/ui';
import { adminApi, AdminUser, AdminRole } from '@/lib/api';

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

export default function UsersManagementPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    display_name: '',
    department: '',
    group: '',
    division: '',
    designation: '',
    role_ids: [] as number[],
  });
  const [saving, setSaving] = useState(false);

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
      const [usersRes, rolesRes] = await Promise.all([
        adminApi.getUsers(),
        adminApi.getRoles(),
      ]);
      setUsers(usersRes.data);
      setRoles(rolesRes.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingUser(null);
    setFormData({
      username: '',
      email: '',
      password: '',
      display_name: '',
      department: '',
      group: '',
      division: '',
      designation: '',
      role_ids: [],
    });
    setShowModal(true);
  };

  const handleEdit = (user: AdminUser) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email,
      password: '',
      display_name: user.display_name,
      department: user.department || '',
      group: user.group || '',
      division: user.division || '',
      designation: user.designation || '',
      role_ids: user.roles.map((r) => r.id),
    });
    setShowModal(true);
  };

  const handleDelete = async (user: AdminUser) => {
    if (!confirm(`Are you sure you want to delete user "${user.display_name}"?`)) {
      return;
    }
    try {
      await adminApi.deleteUser(user.id);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete user');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      if (editingUser) {
        await adminApi.updateUser(editingUser.id, {
          display_name: formData.display_name,
          email: formData.email,
          department: formData.department,
          group: formData.group,
          division: formData.division,
          designation: formData.designation,
          role_ids: formData.role_ids,
        });
      } else {
        await adminApi.createUser({
          username: formData.username,
          email: formData.email,
          password: formData.password,
          display_name: formData.display_name,
          department: formData.department,
          group: formData.group,
          division: formData.division,
          designation: formData.designation,
          role_ids: formData.role_ids,
        });
      }
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  const toggleRole = (roleId: number) => {
    setFormData((prev) => ({
      ...prev,
      role_ids: prev.role_ids.includes(roleId)
        ? prev.role_ids.filter((id) => id !== roleId)
        : [...prev.role_ids, roleId],
    }));
  };

  const columns = [
    {
      id: 'user',
      header: 'User',
      accessor: (user: AdminUser) => (
        <div>
          <div className="font-medium text-black">{user.display_name}</div>
          <div className="text-sm text-slate-600">@{user.username}</div>
        </div>
      ),
    },
    {
      id: 'email',
      header: 'Email',
      accessor: (user: AdminUser) => <span className="text-slate-600">{user.email}</span>,
    },
    {
      id: 'roles',
      header: 'Roles',
      accessor: (user: AdminUser) => (
        <div className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <span
              key={role.id}
              className="px-2 py-0.5 bg-primary-50 text-primary-700 rounded text-xs"
            >
              {role.name}
            </span>
          ))}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (user: AdminUser) => (
        <span
          className={`px-2 py-1 rounded text-xs ${
            user.is_active
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {user.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      id: 'last-login',
      header: 'Last Login',
      accessor: (user: AdminUser) => (
        <span className="text-slate-600 text-sm">
          {user.last_login
            ? new Date(user.last_login).toLocaleDateString()
            : 'Never'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      accessor: (user: AdminUser) => (
        <div className="flex space-x-2">
          <IfPermission required="admin:users:edit">
            <button
              onClick={() => handleEdit(user)}
              className="px-3 py-1 bg-slate-600 hover:bg-slate-500 text-black rounded text-sm"
            >
              Edit
            </button>
          </IfPermission>
          <IfPermission required="admin:users:delete">
            <button
              onClick={() => handleDelete(user)}
              className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-600 rounded text-sm"
            >
              Delete
            </button>
          </IfPermission>
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
        title="User Management"
        subtitle="Create and manage user accounts"
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
        <IfPermission required="admin:users:create">
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm transition-colors"
          >
            + Create User
          </button>
        </IfPermission>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <DataTable data={users} columns={columns} />
      </div>

      {showModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowModal(false)} />
          <div className="fixed inset-y-0 right-0 z-50 flex w-[520px] flex-col bg-white shadow-2xl border-l border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
              <h2 className="text-sm font-semibold text-slate-900">
                {editingUser ? 'Edit User' : 'Create User'}
              </h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {!editingUser && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">
                      Username
                    </label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, username: e.target.value }))
                      }
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500"
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, email: e.target.value }))
                    }
                    className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500"
                    required
                  />
                </div>

                {!editingUser && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">
                      Password
                    </label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, password: e.target.value }))
                      }
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500"
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={formData.display_name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, display_name: e.target.value }))
                    }
                    className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">
                      Department
                    </label>
                    <input
                      type="text"
                      value={formData.department}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, department: e.target.value }))
                      }
                      placeholder="e.g., IT, Finance, HR"
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">
                      Group
                    </label>
                    <input
                      type="text"
                      value={formData.group}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, group: e.target.value }))
                      }
                      placeholder="e.g., Engineering, Operations"
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">
                      Division
                    </label>
                    <input
                      type="text"
                      value={formData.division}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, division: e.target.value }))
                      }
                      placeholder="e.g., North America, EMEA"
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">
                      Designation
                    </label>
                    <input
                      type="text"
                      value={formData.designation}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, designation: e.target.value }))
                      }
                      placeholder="e.g., Senior Manager, Director"
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-primary-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">
                    Assign Roles
                  </label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto mt-1">
                    {roles.map((role) => (
                      <label
                        key={role.id}
                        className="flex items-center space-x-3 p-2 bg-slate-50 rounded cursor-pointer hover:bg-slate-100"
                      >
                        <input
                          type="checkbox"
                          checked={formData.role_ids.includes(role.id)}
                          onChange={() => toggleRole(role.id)}
                          className="w-4 h-4 rounded border-slate-300 bg-slate-50 text-primary-600 focus:ring-primary-500"
                        />
                        <div>
                          <span className="text-sm text-slate-900">{role.name}</span>
                          {role.description && (
                            <p className="text-xs text-slate-500">{role.description}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 px-6 py-4 flex justify-end gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded text-sm disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
