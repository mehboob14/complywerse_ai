'use client';

import { useState, useEffect } from 'react';
import { PageHeader, DataTable } from '@/components/ui';
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
          <button
            onClick={() => handleEdit(user)}
            className="px-3 py-1 bg-slate-600 hover:bg-slate-500 text-black rounded text-sm"
          >
            Edit
          </button>
          <button
            onClick={() => handleDelete(user)}
            className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-600 rounded text-sm"
          >
            Delete
          </button>
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
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm transition-colors"
        >
          + Create User
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <DataTable data={users} columns={columns} />
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg mx-4">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-black">
                {editingUser ? 'Edit User' : 'Create User'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, username: e.target.value }))
                    }
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, email: e.target.value }))
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500"
                  required
                />
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, password: e.target.value }))
                    }
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  value={formData.display_name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, display_name: e.target.value }))
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Department
                  </label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, department: e.target.value }))
                    }
                    placeholder="e.g., IT, Finance, HR"
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Group
                  </label>
                  <input
                    type="text"
                    value={formData.group}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, group: e.target.value }))
                    }
                    placeholder="e.g., Engineering, Operations"
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Division
                  </label>
                  <input
                    type="text"
                    value={formData.division}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, division: e.target.value }))
                    }
                    placeholder="e.g., North America, EMEA"
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">
                    Designation
                  </label>
                  <input
                    type="text"
                    value={formData.designation}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, designation: e.target.value }))
                    }
                    placeholder="e.g., Senior Manager, Director"
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-2">
                  Assign Roles
                </label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {roles.map((role) => (
                    <label
                      key={role.id}
                      className="flex items-center space-x-3 p-2 bg-slate-50 rounded cursor-pointer hover:bg-slate-200"
                    >
                      <input
                        type="checkbox"
                        checked={formData.role_ids.includes(role.id)}
                        onChange={() => toggleRole(role.id)}
                        className="w-4 h-4 rounded border-slate-300 bg-slate-50 text-primary-600 focus:ring-primary-500"
                      />
                      <div>
                        <span className="text-black">{role.name}</span>
                        {role.description && (
                          <p className="text-xs text-slate-600">{role.description}</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-black rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
