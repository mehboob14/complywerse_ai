'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  Users,
  Search,
  Shield,
  Building2,
  Mail,
  UserCheck,
  UserX,
  Clock,
  AlertCircle,
} from 'lucide-react';

interface TenantUser {
  id: number;
  user_id: number;
  tenant_id: number;
  email: string;
  name: string;
  role_id?: number;
  role_name?: string;
  department_id?: number;
  department_name?: string;
  is_active: boolean;
  created_at: string;
}

interface CurrentUser {
  authenticated: boolean;
  user?: {
    id: number;
    primary_tenant_id: number;
  };
}

const STATUS_LABELS: Record<string, { label: string; bg: string; text: string; icon: typeof UserCheck }> = {
  active: { label: 'Active', bg: 'bg-emerald-50', text: 'text-emerald-600', icon: UserCheck },
  inactive: { label: 'Inactive', bg: 'bg-slate-50', text: 'text-slate-600', icon: UserX },
};

export default function UsersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const response = await apiClient.get<CurrentUser>('/auth/me');
      return response.data;
    },
  });

  const tenantId = currentUser?.user?.primary_tenant_id;

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ['tenant-users', tenantId],
    queryFn: async () => {
      const response = await apiClient.get<TenantUser[]>(`/tenants/${tenantId}/users`);
      return response.data;
    },
    enabled: !!tenantId,
  });

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.role_name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      !statusFilter ||
      (statusFilter === 'active' && user.is_active) ||
      (statusFilter === 'inactive' && !user.is_active);
    return matchesSearch && matchesStatus;
  });

  const activeCount = users.filter((u) => u.is_active).length;
  const inactiveCount = users.filter((u) => !u.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold cw-text-default">User Management</h1>
          <p className="text-sm cw-text-muted mt-1">
            Manage users, roles, and permissions for your organization
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="cw-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50">
              <Users className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold cw-text-default">{users.length}</p>
              <p className="text-xs cw-text-muted">Total Users</p>
            </div>
          </div>
        </div>

        <div className="cw-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
              <UserCheck className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold cw-text-default">{activeCount}</p>
              <p className="text-xs cw-text-muted">Active Users</p>
            </div>
          </div>
        </div>

        <div className="cw-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50">
              <UserX className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <p className="text-2xl font-bold cw-text-default">{inactiveCount}</p>
              <p className="text-xs cw-text-muted">Inactive Users</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 cw-text-muted" />
          <input
            type="text"
            placeholder="Search users by name, email, or role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="cw-field w-full py-2.5 pl-10 pr-4 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="cw-field px-4 py-2.5 text-sm"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="cw-card overflow-hidden">
        {error ? (
          <div className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-rose-500 mx-auto mb-3" />
            <p className="text-rose-600">Failed to load users</p>
            <p className="text-sm cw-text-muted mt-1">
              Please check your connection and try again
            </p>
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent mx-auto" />
            <p className="mt-3 text-sm cw-text-muted">Loading users...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="h-12 w-12 cw-text-muted mx-auto mb-3" />
            <p className="cw-text-muted">No users found</p>
            {searchTerm && (
              <p className="text-sm cw-text-muted mt-1">
                Try adjusting your search criteria
              </p>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-subtle)]">
                <th className="px-4 py-3 text-left text-xs font-medium cw-text-muted uppercase tracking-wider">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium cw-text-muted uppercase tracking-wider">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium cw-text-muted uppercase tracking-wider">
                  Department
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium cw-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium cw-text-muted uppercase tracking-wider">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filteredUsers.map((user) => {
                const statusInfo = user.is_active
                  ? STATUS_LABELS.active
                  : STATUS_LABELS.inactive;
                const StatusIcon = statusInfo.icon;

                return (
                  <tr
                    key={user.id}
                    className="hover:bg-[var(--color-hover)] transition-colors"
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700 font-medium">
                          {user.name?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div>
                          <p className="font-medium cw-text-default">{user.name || 'Unknown User'}</p>
                          <p className="text-xs cw-text-muted flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 cw-text-muted" />
                        <span className="text-sm cw-text-muted">
                          {user.role_name || 'No Role'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 cw-text-muted" />
                        <span className="text-sm cw-text-muted">
                          {user.department_name || 'No Department'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusInfo.bg} ${statusInfo.text}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 text-sm cw-text-muted">
                        <Clock className="h-4 w-4" />
                        {new Date(user.created_at).toLocaleDateString()}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
