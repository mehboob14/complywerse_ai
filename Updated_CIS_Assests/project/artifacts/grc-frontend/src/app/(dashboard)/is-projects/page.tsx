'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/lib/navigation';
import { usePermissions } from '@/hooks/usePermissions';
import { isProjectsApi, tenantApi } from '@/lib/api';
import { RightSlidePanel, MultiSelectDropdown, SearchInput } from '@/components/ui';
import {
  FolderKanban,
  Loader2,
  AlertCircle,
  Plus,
  LayoutGrid,
  List,
  Calendar,
  Users,
  Target,
  DollarSign,
  ChevronRight,
  Milestone,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import PortfolioDashboardPage from './dashboard/page';
import MyProjectsPage from './my-projects/page';

interface TenantUserOption {
  id: number;
  display_name: string;
  email: string;
}

const STATUSES = ['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const CATEGORIES = ['Infrastructure', 'Application Security', 'Compliance', 'Risk Remediation', 'Training', 'DR/BCP', 'Other'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const HEALTH_OPTIONS = ['On Track', 'At Risk', 'Off Track'];

const healthColor = (h: string) => {
  if (h === 'On Track') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (h === 'At Risk') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
};

const healthDot = (h: string) => {
  if (h === 'On Track') return 'bg-emerald-500';
  if (h === 'At Risk') return 'bg-amber-500';
  return 'bg-red-500';
};

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    'Planning': 'bg-blue-50 text-blue-700 border-blue-200',
    'In Progress': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    'On Hold': 'bg-yellow-50 text-yellow-700 border-yellow-200',
    'Completed': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Cancelled': 'bg-gray-50 text-gray-500 border-gray-200',
  };
  return map[s] || 'bg-gray-50 text-gray-600 border-gray-200';
};

const priorityBadge = (p: string) => {
  const map: Record<string, string> = {
    'Critical': 'bg-red-50 text-red-700 border-red-200',
    'High': 'bg-orange-50 text-orange-700 border-orange-200',
    'Medium': 'bg-yellow-50 text-yellow-700 border-yellow-200',
    'Low': 'bg-green-50 text-green-700 border-green-200',
  };
  return map[p] || 'bg-gray-50 text-gray-600 border-gray-200';
};

interface ISProject {
  id: number;
  name: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  health: string;
  project_owner_name: string | null;
  sponsor: string | null;
  department: string | null;
  start_date: string | null;
  target_end_date: string | null;
  budget_estimated: number;
  budget_actual: number;
  completion_percentage: number;
  milestones_count: number;
  tasks_count: number;
  team_count: number;
  open_risks_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export default function ISProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('is_projects:projects:create');
  const canDelete = hasPermission('is_projects:projects:delete');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'my-projects'>('overview');

  const projectTabs = [
    { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
    { id: 'projects' as const, label: 'Projects', icon: FolderKanban },
    { id: 'my-projects' as const, label: 'My Projects', icon: Users },
  ];

  const [form, setForm] = useState({
    name: '',
    description: '',
    category: 'Other',
    priority: 'Medium',
    project_owner_id: null as number | null,
    project_owner_name: '',
    sponsor_id: null as number | null,
    sponsor: '',
    department: '',
    start_date: '',
    target_end_date: '',
    budget_estimated: '',
    business_justification: '',
  });

  const { data: tenantUsers = [] } = useQuery({
    queryKey: ['is-projects-tenant-users'],
    queryFn: async () => {
      const res = await tenantApi.getTenantUsers();
      return (res.data || []) as TenantUserOption[];
    },
  });

  const tenantUserItems = useMemo(
    () => tenantUsers.map((u) => ({ value: String(u.id), label: u.display_name, subLabel: u.email })),
    [tenantUsers]
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ['is-projects', statusFilter, categoryFilter, priorityFilter, healthFilter, ownerFilter, search],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (categoryFilter) params.category = categoryFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (healthFilter) params.health = healthFilter;
      if (search) params.search = search;
      if (ownerFilter) params.owner_name = ownerFilter;
      const res = await isProjectsApi.getAll(params);
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['is-projects'] });
      setShowCreateModal(false);
      setForm({
        name: '',
        description: '',
        category: 'Other',
        priority: 'Medium',
        project_owner_id: null,
        project_owner_name: '',
        sponsor_id: null,
        sponsor: '',
        department: '',
        start_date: '',
        target_end_date: '',
        budget_estimated: '',
        business_justification: '',
      });
    },
  });

  const handleCreate = () => {
    const payload: Record<string, unknown> = {
      name: form.name,
      description: form.description,
      category: form.category,
      priority: form.priority,
      project_owner_name: form.project_owner_name,
      sponsor: form.sponsor,
      department: form.department,
      start_date: form.start_date,
      target_end_date: form.target_end_date,
      business_justification: form.business_justification,
      budget_estimated: form.budget_estimated ? parseFloat(form.budget_estimated) : 0,
    };
    if (form.project_owner_id) payload.project_owner_id = form.project_owner_id;
    createMutation.mutate(payload);
  };

  const projects: ISProject[] = data?.items || [];

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="-m-4 lg:-m-5 text-[var(--color-text)]">
      <div className="border-b border-gray-200 px-3 sm:px-6 pt-3 overflow-x-auto">
        <div className="flex items-center gap-0 min-w-max">
          {projectTabs.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-6">
      {activeTab === 'overview' && <PortfolioDashboardPage />}

      {activeTab === 'projects' && (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold text-black tracking-tight">Projects</h1>
              <p className="mt-1 text-sm text-slate-600">Browse, filter and create information security projects</p>
            </div>
            {canCreate && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="cw-btn-primary flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-sm font-medium flex-shrink-0"
              >
                <Plus size={16} /> <span className="hidden sm:inline">New Project</span><span className="sm:hidden">New</span>
              </button>
            )}
          </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[180px] sm:min-w-[260px]">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search projects..."
            size="md"
          />
        </div>

        <MultiSelectDropdown
          title="Status"
          items={STATUSES.map((s) => ({ value: s, label: s }))}
          selectedValues={statusFilter ? [statusFilter] : []}
          onApply={(v) => setStatusFilter(v[0] || '')}
          multiSelect={false}
          autoApply
          placeholder="All Statuses"
          size="md"
        />
        <MultiSelectDropdown
          title="Category"
          items={CATEGORIES.map((c) => ({ value: c, label: c }))}
          selectedValues={categoryFilter ? [categoryFilter] : []}
          onApply={(v) => setCategoryFilter(v[0] || '')}
          multiSelect={false}
          autoApply
          placeholder="All Categories"
          size="md"
        />
        <MultiSelectDropdown
          title="Priority"
          items={PRIORITIES.map((p) => ({ value: p, label: p }))}
          selectedValues={priorityFilter ? [priorityFilter] : []}
          onApply={(v) => setPriorityFilter(v[0] || '')}
          multiSelect={false}
          autoApply
          placeholder="All Priorities"
          size="md"
        />
        <MultiSelectDropdown
          title="Health"
          items={HEALTH_OPTIONS.map((h) => ({ value: h, label: h }))}
          selectedValues={healthFilter ? [healthFilter] : []}
          onApply={(v) => setHealthFilter(v[0] || '')}
          multiSelect={false}
          autoApply
          placeholder="All Health"
          size="md"
        />
        <MultiSelectDropdown
          title="Owner"
          items={tenantUserItems}
          selectedValues={
            ownerFilter
              ? (() => {
                  const match = tenantUsers.find((u) => u.display_name === ownerFilter);
                  return match ? [String(match.id)] : [];
                })()
              : []
          }
          onApply={(v) => {
            const id = v[0] ? Number(v[0]) : null;
            const user = id ? tenantUsers.find((u) => u.id === id) : null;
            setOwnerFilter(user?.display_name || '');
          }}
          multiSelect={false}
          autoApply
          forceSearch
          placeholder="All Owners"
          searchPlaceholder="Search users"
          size="md"
        />

        <div className="flex items-center rounded-full border border-[var(--color-border)] bg-white overflow-hidden ml-auto">
          <button
            onClick={() => setViewMode('card')}
            className={`p-2 transition-colors ${viewMode === 'card' ? 'bg-primary-600 text-white' : 'text-[var(--color-muted)] hover:bg-slate-50'}`}
            aria-label="Card view"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`p-2 transition-colors ${viewMode === 'table' ? 'bg-primary-600 text-white' : 'text-[var(--color-muted)] hover:bg-slate-50'}`}
            aria-label="Table view"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-blue-600" size={32} />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle size={16} /> Failed to load projects
        </div>
      )}

      {!isLoading && !error && projects.length === 0 && (
        <div className="cw-card p-12 text-center">
          <FolderKanban size={48} className="mx-auto text-[var(--color-muted)] opacity-40 mb-4" />
          <h3 className="text-lg font-semibold text-[var(--color-text)]">No projects yet</h3>
          <p className="text-sm text-[var(--color-muted)] mt-1">Create your first IS project to get started</p>
          <button onClick={() => setShowCreateModal(true)} className="cw-btn-primary mt-4 px-4 py-2 rounded-lg text-sm font-medium">
            <Plus size={16} className="inline mr-1" /> Create Project
          </button>
        </div>
      )}

      {!isLoading && !error && projects.length > 0 && viewMode === 'card' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/is-projects/${p.id}`)}
              className="cw-card p-5 hover:shadow-md transition-shadow cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-[var(--color-text)] truncate group-hover:text-blue-700 transition-colors">{p.name}</h3>
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">{p.category} · {p.department || 'No dept'}</p>
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border ${healthColor(p.health)}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${healthDot(p.health)}`} />
                  {p.health}
                </div>
              </div>
              {p.description && <p className="text-xs text-[var(--color-muted)] line-clamp-2 mb-3">{p.description}</p>}
              <div className="flex items-center gap-2 mb-3">
                <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusBadge(p.status)}`}>{p.status}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium border ${priorityBadge(p.priority)}`}>{p.priority}</span>
              </div>
              <div className="cw-progress-track w-full rounded-full h-1.5 mb-3">
                <div className="cw-progress-fill-success h-1.5 rounded-full transition-all" style={{ width: `${Math.min(p.completion_percentage, 100)}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1"><Milestone size={12} />{p.milestones_count}</span>
                  <span className="flex items-center gap-1"><CheckCircle2 size={12} />{p.tasks_count}</span>
                  <span className="flex items-center gap-1"><Users size={12} />{p.team_count}</span>
                  {p.open_risks_count > 0 && <span className="flex items-center gap-1 text-amber-600"><AlertTriangle size={12} />{p.open_risks_count}</span>}
                </div>
                <span className="flex items-center gap-1"><Calendar size={12} />{formatDate(p.target_end_date)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && projects.length > 0 && viewMode === 'table' && (
        <div className="cw-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-subtle)]">
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Project</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Health</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Priority</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Owner</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Progress</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Target Date</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/is-projects/${p.id}`)}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-subtle)] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-[var(--color-text)]">{p.name}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">{p.category}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusBadge(p.status)}`}>{p.status}</span></td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border w-fit ${healthColor(p.health)}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${healthDot(p.health)}`} />{p.health}
                      </span>
                    </td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium border ${priorityBadge(p.priority)}`}>{p.priority}</span></td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">{p.project_owner_name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="cw-progress-track w-16 rounded-full h-1.5">
                          <div className="cw-progress-fill-success h-1.5 rounded-full" style={{ width: `${Math.min(p.completion_percentage, 100)}%` }} />
                        </div>
                        <span className="text-xs text-[var(--color-muted)]">{Math.round(p.completion_percentage)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">{formatDate(p.target_end_date)}</td>
                    <td className="px-4 py-3"><ChevronRight size={14} className="text-[var(--color-muted)]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

        </>
      )}

      {activeTab === 'my-projects' && <MyProjectsPage />}
      </div>

      <RightSlidePanel
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create IS Project"
        widthClassName="w-[780px]"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!form.name || createMutation.isPending}
              className="cw-btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Create Project
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Project Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              placeholder="e.g., SIEM Platform Upgrade"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              placeholder="Describe the project objectives..."
            />
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Project Owner</label>
              <MultiSelectDropdown
                title="Owner"
                items={tenantUserItems}
                selectedValues={form.project_owner_id ? [String(form.project_owner_id)] : []}
                onApply={(values) => {
                  const id = values[0] ? Number(values[0]) : null;
                  const user = id ? tenantUsers.find((u) => u.id === id) : null;
                  setForm({
                    ...form,
                    project_owner_id: id,
                    project_owner_name: user?.display_name || '',
                  });
                }}
                multiSelect={false}
                autoApply
                forceSearch
                triggerVariant="input"
                placeholder="Select owner"
                searchPlaceholder="Search users"
                size="sm"
                triggerClassName="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Sponsor</label>
              <MultiSelectDropdown
                title="Sponsor"
                items={tenantUserItems}
                selectedValues={form.sponsor_id ? [String(form.sponsor_id)] : []}
                onApply={(values) => {
                  const id = values[0] ? Number(values[0]) : null;
                  const user = id ? tenantUsers.find((u) => u.id === id) : null;
                  setForm({
                    ...form,
                    sponsor_id: id,
                    sponsor: user?.display_name || '',
                  });
                }}
                multiSelect={false}
                autoApply
                forceSearch
                triggerVariant="input"
                placeholder="Select sponsor"
                searchPlaceholder="Search users"
                size="sm"
                triggerClassName="w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Department</label>
            <input
              type="text"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              placeholder="e.g., Information Security"
            />
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Start Date</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Target End Date</label>
              <input
                type="date"
                value={form.target_end_date}
                onChange={(e) => setForm({ ...form, target_end_date: e.target.value })}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Estimated Budget</label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="number"
                value={form.budget_estimated}
                onChange={(e) => setForm({ ...form, budget_estimated: e.target.value })}
                className="w-full rounded border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Business Justification</label>
            <textarea
              value={form.business_justification}
              onChange={(e) => setForm({ ...form, business_justification: e.target.value })}
              rows={3}
              className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              placeholder="Why is this project needed?"
            />
          </div>
        </div>
      </RightSlidePanel>
    </div>
  );
}
