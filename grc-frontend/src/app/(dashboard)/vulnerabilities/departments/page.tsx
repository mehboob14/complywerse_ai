'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import {
  Users,
  Plus,
  Loader2,
  Search,
  MoreVertical,
  Edit2,
  Trash2,
  X,
  UserPlus,
  Bug,
  ChevronRight,
  Building2,
  Route,
} from 'lucide-react';
import Link from 'next/link';

interface Department {
  id: number;
  name: string;
  code?: string;
  description?: string;
  parent_department_id?: number;
  department_head_user_id?: number;
  member_count?: number;
  vulnerability_count?: number;
  created_at: string;
}

interface DepartmentMember {
  id: number;
  user_id: number;
  user_name?: string;
  user_email?: string;
  role: string;
  email_notifications_enabled?: boolean;
  escalation_order?: number;
  added_at: string;
}

interface DepartmentVulnerability {
  id: number;
  vulnerability_id: number;
  vuln_id: string;
  title: string;
  severity: string;
  status: string;
  priority: string;
}

interface EscalationPath {
  id: number;
  name: string;
  description?: string;
  escalation_order: number;
  target_user_id?: number;
  target_role?: string;
  time_threshold_hours?: number;
}

export default function DepartmentsManagementPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showEscalationModal, setShowEscalationModal] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);

  const { data: departments, isLoading } = useQuery({
    queryKey: ['all-departments'],
    queryFn: async () => {
      const response = await vulnManagementApi.departments.getAll();
      return response.data as Department[];
    },
  });

  const { data: departmentMembers } = useQuery({
    queryKey: ['department-members', selectedDepartment?.id],
    queryFn: async () => {
      if (!selectedDepartment) return [];
      const response = await vulnManagementApi.departments.getMembers(selectedDepartment.id);
      return response.data as DepartmentMember[];
    },
    enabled: !!selectedDepartment && showMemberModal,
  });

  const { data: departmentVulnerabilities } = useQuery({
    queryKey: ['department-vulnerabilities', selectedDepartment?.id],
    queryFn: async () => {
      if (!selectedDepartment) return [];
      const response = await vulnManagementApi.departments.getDepartmentVulnerabilities(selectedDepartment.id);
      return response.data as DepartmentVulnerability[];
    },
    enabled: !!selectedDepartment,
  });

  const { data: escalationPaths } = useQuery({
    queryKey: ['escalation-paths', selectedDepartment?.id],
    queryFn: async () => {
      if (!selectedDepartment) return [];
      const response = await vulnManagementApi.departments.getEscalationPaths(selectedDepartment.id);
      return response.data as EscalationPath[];
    },
    enabled: !!selectedDepartment && showEscalationModal,
  });

  const createDepartmentMutation = useMutation({
    mutationFn: (data: { name: string; code?: string; description?: string }) => 
      vulnManagementApi.departments.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-departments'] });
      setShowCreateModal(false);
    },
  });

  const updateDepartmentMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; code?: string; description?: string } }) => 
      vulnManagementApi.departments.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-departments'] });
      setShowEditModal(false);
      setSelectedDepartment(null);
    },
  });

  const deleteDepartmentMutation = useMutation({
    mutationFn: (id: number) => vulnManagementApi.departments.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-departments'] });
      setActiveMenuId(null);
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ deptId, data }: { deptId: number; data: { user_id: number; role?: string; email_notifications_enabled?: boolean; escalation_order?: number } }) => 
      vulnManagementApi.departments.addMember(deptId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['department-members', selectedDepartment?.id] });
      queryClient.invalidateQueries({ queryKey: ['all-departments'] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ deptId, memberId }: { deptId: number; memberId: number }) => 
      vulnManagementApi.departments.removeMember(deptId, memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['department-members', selectedDepartment?.id] });
      queryClient.invalidateQueries({ queryKey: ['all-departments'] });
    },
  });

  const createEscalationPathMutation = useMutation({
    mutationFn: ({ deptId, data }: { deptId: number; data: Record<string, unknown> }) => 
      vulnManagementApi.departments.createEscalationPath(deptId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalation-paths', selectedDepartment?.id] });
    },
  });

  const filteredDepartments = departments?.filter(dept => 
    dept.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    dept.code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    dept.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const severityStyles: Record<string, string> = {
    critical: 'bg-red-50 text-red-700',
    high: 'bg-orange-50 text-orange-700',
    medium: 'bg-yellow-50 text-yellow-700',
    low: 'bg-blue-50 text-blue-700',
    info: 'bg-slate-50 text-slate-700',
  };

  const priorityStyles: Record<string, string> = {
    high: 'bg-red-50 text-red-700',
    medium: 'bg-yellow-50 text-yellow-700',
    low: 'bg-green-50 text-green-700',
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black">Vulnerability Departments</h1>
          <p className="text-slate-600 mt-1">Manage departments responsible for vulnerability remediation</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={16} />
          Create Department
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search departments..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {(!filteredDepartments || filteredDepartments.length === 0) ? (
          <div className="col-span-full rounded-xl border border-slate-200 bg-white p-12 text-center">
            <Building2 className="h-12 w-12 mx-auto text-slate-600 mb-4" />
            <h3 className="text-lg font-medium text-black mb-2">No departments found</h3>
            <p className="text-slate-600 mb-4">Create your first department to start assigning vulnerabilities</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus size={16} />
              Create Department
            </button>
          </div>
        ) : (
          filteredDepartments.map((dept) => (
            <div
              key={dept.id}
              className="rounded-xl border border-slate-200 bg-white p-6 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50">
                    <Building2 className="h-5 w-5 text-primary-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-black">{dept.name}</h3>
                      {dept.code && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 font-mono">
                          {dept.code}
                        </span>
                      )}
                    </div>
                    {dept.description && (
                      <p className="text-sm text-slate-600 line-clamp-1">{dept.description}</p>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setActiveMenuId(activeMenuId === dept.id ? null : dept.id)}
                    className="p-1 text-slate-600 hover:text-slate-900 rounded"
                  >
                    <MoreVertical size={16} />
                  </button>
                  {activeMenuId === dept.id && (
                    <div className="absolute right-0 mt-1 w-40 rounded-lg border border-slate-200 bg-white shadow-xl z-10">
                      <button
                        onClick={() => {
                          setSelectedDepartment(dept);
                          setShowEditModal(true);
                          setActiveMenuId(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200"
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          setSelectedDepartment(dept);
                          setShowMemberModal(true);
                          setActiveMenuId(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200"
                      >
                        <UserPlus size={14} />
                        Members
                      </button>
                      <button
                        onClick={() => {
                          setSelectedDepartment(dept);
                          setShowEscalationModal(true);
                          setActiveMenuId(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200"
                      >
                        <Route size={14} />
                        Escalation Paths
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this department?')) {
                            deleteDepartmentMutation.mutate(dept.id);
                          }
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-slate-200"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 text-sm mb-4">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <Users size={14} />
                  <span>{dept.member_count || 0} members</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <Bug size={14} />
                  <span>{dept.vulnerability_count || 0} vulnerabilities</span>
                </div>
              </div>

              <button
                onClick={() => setSelectedDepartment(selectedDepartment?.id === dept.id ? null : dept)}
                className="w-full text-left text-sm text-primary-600 hover:text-primary-300 flex items-center gap-1"
              >
                View assigned vulnerabilities
                <ChevronRight size={14} className={selectedDepartment?.id === dept.id ? 'rotate-90' : ''} />
              </button>

              {selectedDepartment?.id === dept.id && departmentVulnerabilities && (
                <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
                  {departmentVulnerabilities.length === 0 ? (
                    <p className="text-sm text-slate-500">No vulnerabilities assigned</p>
                  ) : (
                    departmentVulnerabilities.slice(0, 5).map((vuln) => (
                      <Link
                        key={vuln.id}
                        href={`/vulnerabilities/${vuln.vulnerability_id}`}
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-200/50 hover:bg-slate-200 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${severityStyles[vuln.severity] || severityStyles.info}`}>
                            {vuln.severity}
                          </span>
                          <span className="text-sm text-black truncate max-w-[150px]">{vuln.title}</span>
                        </div>
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${priorityStyles[vuln.priority] || 'bg-slate-50 text-slate-700'}`}>
                          {vuln.priority}
                        </span>
                      </Link>
                    ))
                  )}
                  {departmentVulnerabilities.length > 5 && (
                    <p className="text-xs text-slate-500 text-center">
                      +{departmentVulnerabilities.length - 5} more
                    </p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Create Department</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createDepartmentMutation.mutate({
                  name: formData.get('name') as string,
                  code: formData.get('code') as string || undefined,
                  description: formData.get('description') as string || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Department Name *</label>
                <input type="text" name="name" required className="input-field w-full" placeholder="e.g., Security Operations" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Department Code</label>
                <input type="text" name="code" className="input-field w-full" placeholder="e.g., SEC-OPS" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
                <textarea name="description" rows={3} className="input-field w-full" placeholder="Department responsibilities..." />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createDepartmentMutation.isPending} className="btn-primary">
                  {createDepartmentMutation.isPending ? 'Creating...' : 'Create Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && selectedDepartment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Edit Department</h2>
              <button onClick={() => { setShowEditModal(false); setSelectedDepartment(null); }} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                updateDepartmentMutation.mutate({
                  id: selectedDepartment.id,
                  data: {
                    name: formData.get('name') as string,
                    code: formData.get('code') as string || undefined,
                    description: formData.get('description') as string || undefined,
                  },
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Department Name *</label>
                <input type="text" name="name" required defaultValue={selectedDepartment.name} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Department Code</label>
                <input type="text" name="code" defaultValue={selectedDepartment.code || ''} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
                <textarea name="description" rows={3} defaultValue={selectedDepartment.description || ''} className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => { setShowEditModal(false); setSelectedDepartment(null); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={updateDepartmentMutation.isPending} className="btn-primary">
                  {updateDepartmentMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMemberModal && selectedDepartment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Department Members - {selectedDepartment.name}</h2>
              <button onClick={() => { setShowMemberModal(false); setSelectedDepartment(null); }} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const userId = parseInt(formData.get('user_id') as string);
                if (userId) {
                  addMemberMutation.mutate({
                    deptId: selectedDepartment.id,
                    data: {
                      user_id: userId,
                      role: formData.get('role') as string || 'member',
                      email_notifications_enabled: formData.get('email_notifications') === 'on',
                      escalation_order: parseInt(formData.get('escalation_order') as string) || undefined,
                    },
                  });
                  (e.target as HTMLFormElement).reset();
                }
              }}
              className="flex gap-2 mb-4 flex-wrap"
            >
              <input
                type="number"
                name="user_id"
                placeholder="User ID"
                className="input-field flex-1 min-w-[100px]"
                required
              />
              <select name="role" className="input-field w-28">
                <option value="member">Member</option>
                <option value="lead">Lead</option>
                <option value="head">Head</option>
              </select>
              <input
                type="number"
                name="escalation_order"
                placeholder="Order"
                className="input-field w-20"
              />
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" name="email_notifications" defaultChecked className="rounded" />
                Email
              </label>
              <button type="submit" disabled={addMemberMutation.isPending} className="btn-primary">
                <UserPlus size={16} />
              </button>
            </form>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(!departmentMembers || departmentMembers.length === 0) ? (
                <p className="text-sm text-slate-500 text-center py-4">No members in this department</p>
              ) : (
                departmentMembers.map((member) => (
                  <div key={member.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-200/50">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-primary-700 text-sm font-medium">
                        {(member.user_name || 'U')[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-black">{member.user_name || `User #${member.user_id}`}</p>
                        <p className="text-xs text-slate-600">{member.user_email || ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          member.role === 'head' ? 'bg-primary-50 text-primary-700' :
                          member.role === 'lead' ? 'bg-blue-50 text-blue-700' :
                          'bg-slate-50 text-slate-700'
                        }`}>
                          {member.role}
                        </span>
                        {member.escalation_order && (
                          <span className="ml-2 text-xs text-slate-500">#{member.escalation_order}</span>
                        )}
                      </div>
                      <button
                        onClick={() => removeMemberMutation.mutate({ deptId: selectedDepartment.id, memberId: member.id })}
                        className="text-slate-600 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={() => { setShowMemberModal(false); setSelectedDepartment(null); }} className="btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showEscalationModal && selectedDepartment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Escalation Paths - {selectedDepartment.name}</h2>
              <button onClick={() => { setShowEscalationModal(false); setSelectedDepartment(null); }} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createEscalationPathMutation.mutate({
                  deptId: selectedDepartment.id,
                  data: {
                    name: formData.get('name') as string,
                    description: formData.get('description') as string || undefined,
                    escalation_order: parseInt(formData.get('escalation_order') as string) || 1,
                    target_role: formData.get('target_role') as string || undefined,
                    time_threshold_hours: parseInt(formData.get('time_threshold_hours') as string) || undefined,
                  },
                });
                (e.target as HTMLFormElement).reset();
              }}
              className="space-y-3 mb-4 p-3 rounded-lg bg-slate-200/50"
            >
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  name="name"
                  placeholder="Path name *"
                  className="input-field"
                  required
                />
                <select name="target_role" className="input-field">
                  <option value="">Target role</option>
                  <option value="head">Head</option>
                  <option value="lead">Lead</option>
                  <option value="member">Member</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  name="escalation_order"
                  placeholder="Order (1, 2, 3...)"
                  className="input-field"
                />
                <input
                  type="number"
                  name="time_threshold_hours"
                  placeholder="Hours threshold"
                  className="input-field"
                />
              </div>
              <input
                type="text"
                name="description"
                placeholder="Description (optional)"
                className="input-field w-full"
              />
              <button type="submit" disabled={createEscalationPathMutation.isPending} className="btn-primary w-full">
                {createEscalationPathMutation.isPending ? 'Adding...' : 'Add Escalation Path'}
              </button>
            </form>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(!escalationPaths || escalationPaths.length === 0) ? (
                <p className="text-sm text-slate-500 text-center py-4">No escalation paths configured</p>
              ) : (
                escalationPaths.map((path) => (
                  <div key={path.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-200/50">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-700 text-sm font-medium">
                        {path.escalation_order}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-black">{path.name}</p>
                        <p className="text-xs text-slate-600">
                          {path.target_role && `To: ${path.target_role}`}
                          {path.time_threshold_hours && ` | After ${path.time_threshold_hours}h`}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={() => { setShowEscalationModal(false); setSelectedDepartment(null); }} className="btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
