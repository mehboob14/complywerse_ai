'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { isProjectsApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import {
  FolderKanban,
  Loader2,
  AlertCircle,
  Search,
  Plus,
  X,
  LayoutGrid,
  List,
  Calendar,
  Users,
  Target,
  DollarSign,
  ChevronRight,
  Milestone,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import PortfolioDashboardPage from './dashboard/page';
import MyProjectsPage from './my-projects/page';

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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'projects' | 'dashboard' | 'my-projects'>('projects');

  const projectTabs = [
    { id: 'projects' as const, label: 'Projects' },
    { id: 'dashboard' as const, label: 'Portfolio Dashboard' },
    { id: 'my-projects' as const, label: 'My Projects' },
  ];

  const [form, setForm] = useState({
    name: '', description: '', category: 'Other', priority: 'Medium',
    project_owner_name: '', sponsor: '', department: '',
    start_date: '', target_end_date: '', budget_estimated: '',
    business_justification: '',
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['is-projects', statusFilter, categoryFilter, priorityFilter, healthFilter, ownerFilter, search, dateFrom, dateTo],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (categoryFilter) params.category = categoryFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (healthFilter) params.health = healthFilter;
      if (search) params.search = search;
      if (ownerFilter) params.owner_name = ownerFilter;
      if (dateFrom) params.start_date_from = dateFrom;
      if (dateTo) params.end_date_to = dateTo;
      const res = await isProjectsApi.getAll(params);
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['is-projects'] });
      setShowCreateModal(false);
      setForm({ name: '', description: '', category: 'Other', priority: 'Medium', project_owner_name: '', sponsor: '', department: '', start_date: '', target_end_date: '', budget_estimated: '', business_justification: '' });
    },
  });

  const handleCreate = () => {
    createMutation.mutate({
      ...form,
      budget_estimated: form.budget_estimated ? parseFloat(form.budget_estimated) : 0,
    });
  };

  const projects: ISProject[] = data?.items || [];

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="space-y-6 text-[var(--color-text)]">
      <div className="rounded-xl border border-slate-200 bg-white px-2 py-2 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {projectTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'projects' && (
        <>
          <PageHeader
            title="IS Projects"
            subtitle="Track and manage information security projects across the organization"
            icon={FolderKanban}
            actions={(
              <button
                onClick={() => setShowCreateModal(true)}
                className="cw-btn-primary flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
              >
                <Plus size={16} /> New Project
              </button>
            )}
          />

      <div className="cw-card p-4">
        <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="cw-field w-full pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="cw-field px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="cw-field px-3 py-2 text-sm">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="cw-field px-3 py-2 text-sm">
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} className="cw-field px-3 py-2 text-sm">
          <option value="">All Health</option>
          {HEALTH_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <input type="text" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} placeholder="Filter by owner..." className="cw-field px-3 py-2 text-sm w-40" />
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="Start date from" placeholder="From" className="cw-field px-3 py-2 text-sm" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="End date to" placeholder="To" className="cw-field px-3 py-2 text-sm" />
        <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <button onClick={() => setViewMode('card')} className={`p-2 ${viewMode === 'card' ? 'cw-btn-primary text-white' : 'text-[var(--color-muted)]'}`}>
            <LayoutGrid size={16} />
          </button>
          <button onClick={() => setViewMode('table')} className={`p-2 ${viewMode === 'table' ? 'cw-btn-primary text-white' : 'text-[var(--color-muted)]'}`}>
            <List size={16} />
          </button>
        </div>
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

          {showCreateModal && (
            <div className="fixed inset-0 cw-overlay flex items-center justify-center z-50 p-4" onClick={() => setShowCreateModal(false)}>
              <div className="cw-modal-panel rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
                  <h2 className="text-lg font-semibold text-[var(--color-text)]">Create IS Project</h2>
                  <button onClick={() => setShowCreateModal(false)} className="p-1 rounded hover:bg-[var(--color-subtle)]"><X size={18} /></button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Project Name <span className="cw-required">*</span></label>
                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" placeholder="e.g., SIEM Platform Upgrade" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Description</label>
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="cw-field w-full px-3 py-2 text-sm" placeholder="Describe the project objectives..." />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Category</label>
                      <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Priority</label>
                      <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">
                        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Project Owner</label>
                      <input type="text" value={form.project_owner_name} onChange={(e) => setForm({ ...form, project_owner_name: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" placeholder="Owner name" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Sponsor</label>
                      <input type="text" value={form.sponsor} onChange={(e) => setForm({ ...form, sponsor: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" placeholder="Executive sponsor" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Department</label>
                    <input type="text" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" placeholder="e.g., Information Security" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Start Date</label>
                      <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Target End Date</label>
                      <input type="date" value={form.target_end_date} onChange={(e) => setForm({ ...form, target_end_date: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Estimated Budget</label>
                    <div className="relative">
                      <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
                      <input type="number" value={form.budget_estimated} onChange={(e) => setForm({ ...form, budget_estimated: e.target.value })} className="cw-field w-full pl-8 pr-3 py-2 text-sm" placeholder="0.00" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Business Justification</label>
                    <textarea value={form.business_justification} onChange={(e) => setForm({ ...form, business_justification: e.target.value })} rows={3} className="cw-field w-full px-3 py-2 text-sm" placeholder="Why is this project needed?" />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 p-6 border-t border-[var(--color-border)]">
                  <button onClick={() => setShowCreateModal(false)} className="cw-btn-secondary px-4 py-2 rounded-lg text-sm">Cancel</button>
                  <button onClick={handleCreate} disabled={!form.name || createMutation.isPending} className="cw-btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                    Create Project
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'dashboard' && <PortfolioDashboardPage />}
      {activeTab === 'my-projects' && <MyProjectsPage />}
    </div>
  );
}
