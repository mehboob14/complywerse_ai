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
          role_ids: formData.role_ids,
        });
      } else {
        await adminApi.createUser({
          username: formData.username,
          email: formData.email,
          password: formData.password,
          display_name: formData.display_name,
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
      header: 'User',
      accessor: (user: AdminUser) => (
        <div>
          <div className="font-medium text-slate-800">{user.display_name}</div>
          <div className="text-sm text-slate-400">@{user.username}</div>
        </div>
      ),
    },
    {
      header: 'Email',
      accessor: (user: AdminUser) => <span className="text-slate-600">{user.email}</span>,
    },
    {
      header: 'Roles',
      accessor: (user: AdminUser) => (
        <div className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <span
              key={role.id}
              className="px-2 py-0.5 bg-primary-500/20 text-primary-600 rounded text-xs"
            >
              {role.name}
            </span>
          ))}
        </div>
      ),
    },
    {
      header: 'Status',
      accessor: (user: AdminUser) => (
        <span
          className={`px-2 py-1 rounded text-xs ${
            user.is_active
              ? 'bg-green-500/20 text-green-400'
              : 'bg-red-500/20 text-red-400'
          }`}
        >
          {user.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      header: 'Last Login',
      accessor: (user: AdminUser) => (
        <span className="text-slate-400 text-sm">
          {user.last_login
            ? new Date(user.last_login).toLocaleDateString()
            : 'Never'}
        </span>
      ),
    },
    {
      header: 'Actions',
      accessor: (user: AdminUser) => (
        <div className="flex space-x-2">
          <button
            onClick={() => handleEdit(user)}
            className="px-3 py-1 bg-slate-600 hover:bg-slate-500 text-slate-800 rounded text-sm"
          >
            Edit
          </button>
          <button
            onClick={() => handleDelete(user)}
            className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-sm"
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
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-400">
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
              <h2 className="text-lg font-semibold text-slate-800">
                {editingUser ? 'Edit User' : 'Create User'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, username: e.target.value }))
                    }
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-primary-500"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, email: e.target.value }))
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-primary-500"
                  required
                />
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, password: e.target.value }))
                    }
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-primary-500"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  value={formData.display_name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, display_name: e.target.value }))
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
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
                        <span className="text-slate-800">{role.name}</span>
                        {role.description && (
                          <p className="text-xs text-slate-400">{role.description}</p>
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
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-slate-800 rounded-lg text-sm"
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
