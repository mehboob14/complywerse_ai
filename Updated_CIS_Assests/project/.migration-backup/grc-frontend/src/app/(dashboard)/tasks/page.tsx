'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { criticalTasksApi, risksApi, ermApi, vulnManagementApi, regulatoryApi, committeeApi } from '@/lib/api';
import Link from 'next/link';
import MyTasksPage from './my-tasks/page';
import TaskReportsPage from './reports/page';
import TasksSLAConfigPage from './sla/page';
import { TASK_SLA_LABELS, TASK_SLA_ORDER, TaskSLALevel, getTaskSLAConfig } from './slaConfig';
import { RightSlidePanel, MultiSelectDropdown, SearchInput } from '@/components/ui';
import {
  Plus, X,
  ArrowUpDown, MoreHorizontal, Target, Loader2,
  LayoutList, Columns3, Sparkles, Copy, RefreshCw,
  ListTodo, ClipboardList, BarChart3, Clock,
} from 'lucide-react';

interface TaskUser {
  id: number;
  username?: string | null;
  display_name: string | null;
  email: string;
}

interface CriticalTaskItem {
  id: number;
  tenant_id: number;
  title: string;
  description: string | null;
  source: string;
  source_module: string | null;
  source_entity_id: number | null;
  source_entity_type: string | null;
  priority: string;
  severity: string | null;
  status: string;
  category: string;
  assigned_owner_id: number | null;
  reviewer_id: number | null;
  created_by_id: number | null;
  due_date: string | null;
  sla_days: number | null;
  sla_status: string;
  escalation_level: number;
  linked_risk_id: number | null;
  linked_control_id: number | null;
  linked_finding_id: number | null;
  linked_vulnerability_id: number | null;
  evidence_notes: string | null;
  completed_at: string | null;
  verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  assigned_owner: TaskUser | null;
  reviewer: TaskUser | null;
  created_by: TaskUser | null;
}

interface TaskListResponse {
  items: CriticalTaskItem[];
  total: number;
}

const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  High: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  Medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  Low: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'In Progress': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'Under Review': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  Completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  Verified: 'bg-green-500/20 text-green-400 border-green-500/30',
  Reopened: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const KANBAN_BORDER_COLORS: Record<string, string> = {
  Open: 'border-t-blue-500',
  'In Progress': 'border-t-amber-500',
  'Under Review': 'border-t-purple-500',
  Completed: 'border-t-emerald-500',
  Verified: 'border-t-green-500',
  Reopened: 'border-t-red-500',
};

const SLA_COLORS: Record<string, string> = {
  'On Track': 'text-emerald-400',
  'At Risk': 'text-amber-400',
  Breached: 'text-red-400',
  Completed: 'text-slate-400',
  'No SLA': 'text-slate-500',
};

const SOURCES = ['Audit', 'Risk', 'Compliance', 'Vulnerability', 'Manual'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const STATUSES = ['Open', 'In Progress', 'Under Review', 'Completed', 'Verified', 'Reopened'];
const CATEGORIES = ['Remediation', 'Implementation', 'Review', 'Reporting', 'Other'];
const SOURCE_MODULES = ['Audit Findings', 'Risk Register', 'Compliance Assessment', 'Vulnerability Scan', 'Manual'];

export default function TaskBoardPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('critical_tasks:tasks:create');
  const canDelete = hasPermission('critical_tasks:tasks:delete');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<number[]>([]);
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [users, setUsers] = useState<TaskUser[]>([]);
  const [activeTab, setActiveTab] = useState<'board' | 'my-tasks' | 'sla' | 'reports'>('board');
  const taskTabs = [
    { id: 'board' as const, label: 'Task Board', icon: ListTodo },
    { id: 'my-tasks' as const, label: 'My Tasks', icon: ClipboardList },
    { id: 'sla' as const, label: 'SLA Configuration', icon: Clock },
    { id: 'reports' as const, label: 'Reports', icon: BarChart3 },
  ];
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showAiResult, setShowAiResult] = useState(false);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDescLoading, setAiDescLoading] = useState(false);
  const [riskOptions, setRiskOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [controlOptions, setControlOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [vulnOptions, setVulnOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [regulatoryChangeOptions, setRegulatoryChangeOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [committeeOptions, setCommitteeOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [aiContextLoading, setAiContextLoading] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '', description: '', source: 'Manual', priority: 'Medium',
    severity: '', category: 'Other', assigned_owner_id: '',
    reviewer_id: '', due_date: '', sla_level: '' as TaskSLALevel | '', sla_days: '', evidence_notes: '',
    source_module: '', source_entity_type: '',
    linked_risk_id: '', linked_control_id: '', linked_vulnerability_id: '',
    linked_regulatory_change_id: '', linked_committee_id: '',
    recurrence_pattern: '', recurrence_interval: '1', approval_required: false,
  });

  useEffect(() => {
    criticalTasksApi.getTenantUsers().then(r => setUsers(r.data || [])).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    let active = true;
    const normalizeList = (value: unknown): Record<string, unknown>[] => {
      if (Array.isArray(value)) return value as Record<string, unknown>[];
      const maybeItems = (value as Record<string, unknown> | undefined)?.items;
      return Array.isArray(maybeItems) ? (maybeItems as Record<string, unknown>[]) : [];
    };

    Promise.all([
      risksApi.getAll().then(r => normalizeList(r.data)).catch(() => []),
      ermApi.internalControls.getAll().then(r => normalizeList(r.data)).catch(() => []),
      vulnManagementApi.vulnerabilities.getAll().then(r => normalizeList(r.data)).catch(() => []),
      regulatoryApi.getChanges().then(r => normalizeList(r.data)).catch(() => []),
      committeeApi.getCommittees().then(r => normalizeList(r.data)).catch(() => []),
    ]).then(([risks, controls, vulnerabilities, regChanges, committees]) => {
      if (!active) return;
      setRiskOptions(
        risks
          .map((r) => {
            const id = Number(r.id);
            if (!id) return null;
            const label = String(r.title || r.name || r.risk_event || r.risk_description || `Risk #${id}`);
            return { id, label };
          })
          .filter(Boolean) as Array<{ id: number; label: string }>
      );
      setControlOptions(
        controls
          .map((c) => {
            const id = Number(c.id);
            if (!id) return null;
            const base = String(c.name || c.control_name || c.title || `Control #${id}`);
            const code = c.control_id ? `${String(c.control_id)} - ` : '';
            return { id, label: `${code}${base}` };
          })
          .filter(Boolean) as Array<{ id: number; label: string }>
      );
      setVulnOptions(
        vulnerabilities
          .map((v) => {
            const id = Number(v.id);
            if (!id) return null;
            const label = String(v.title || v.vulnerability_name || v.cve_id || `Vulnerability #${id}`);
            return { id, label };
          })
          .filter(Boolean) as Array<{ id: number; label: string }>
      );
      setRegulatoryChangeOptions(
        regChanges
          .map((r) => {
            const id = Number(r.id);
            if (!id) return null;
            const ref = r.reference_number ? `${String(r.reference_number)} - ` : '';
            const label = String(r.title || r.name || `Change #${id}`);
            return { id, label: `${ref}${label}` };
          })
          .filter(Boolean) as Array<{ id: number; label: string }>
      );
      setCommitteeOptions(
        committees
          .map((c) => {
            const id = Number(c.id);
            if (!id) return null;
            const label = String(c.name || c.committee_name || `Committee #${id}`);
            return { id, label };
          })
          .filter(Boolean) as Array<{ id: number; label: string }>
      );
    });

    return () => {
      active = false;
    };
  }, []);

  const { data: templates } = useQuery({
    queryKey: ['task-templates'],
    queryFn: async () => { const res = await criticalTasksApi.listTemplates(); return res.data; },
  });

  const templateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => criticalTasksApi.createFromTemplate(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['critical-tasks'] });
      setShowTemplateModal(false);
    },
  });

  const handleAiReprioritize = async () => {
    setAiLoading(true);
    try {
      const res = await criticalTasksApi.aiPrioritize();
      setAiResult(res.data);
      setShowAiResult(true);
    } catch { /* handled */ }
    setAiLoading(false);
  };

  const handleAiGenerateDescription = async () => {
    if (!newTask.title.trim()) return;
    setAiDescLoading(true);
    try {
      const res = await criticalTasksApi.aiGenerateDescription({
        title: newTask.title,
        category: newTask.category,
        source: newTask.source,
        priority: newTask.priority,
      });
      const desc = res.data?.description;
      if (desc) {
        const parts = [desc.summary || '', desc.detailed_description || ''].filter(Boolean);
        if (desc.acceptance_criteria?.length) {
          parts.push('\nAcceptance Criteria:\n' + desc.acceptance_criteria.map((c: string) => `- ${c}`).join('\n'));
        }
        setNewTask(f => ({ ...f, description: parts.join('\n\n') }));
      }
    } catch { /* handled */ }
    setAiDescLoading(false);
  };

  const handleAiGenerateFromContext = async () => {
    // Build context from any of the 5 linked entities the user has selected.
    const ctx: { source: string; label: string }[] = [];
    const findOpt = (options: Array<{ id: number; label: string }>, id: string) => {
      const num = Number(id);
      if (!num) return null;
      return options.find((o) => o.id === num) || null;
    };
    const r = findOpt(riskOptions, newTask.linked_risk_id);
    if (r) ctx.push({ source: 'Risk', label: r.label });
    const c = findOpt(controlOptions, newTask.linked_control_id);
    if (c) ctx.push({ source: 'Internal Control', label: c.label });
    const v = findOpt(vulnOptions, newTask.linked_vulnerability_id);
    if (v) ctx.push({ source: 'Vulnerability', label: v.label });
    const rc = findOpt(regulatoryChangeOptions, newTask.linked_regulatory_change_id);
    if (rc) ctx.push({ source: 'Regulatory Change', label: rc.label });
    const cm = findOpt(committeeOptions, newTask.linked_committee_id);
    if (cm) ctx.push({ source: 'Committee', label: cm.label });

    if (ctx.length === 0) {
      // Nothing to derive context from — fall back to title-based AI if title exists.
      if (newTask.title.trim()) return handleAiGenerateDescription();
      return;
    }

    setAiContextLoading(true);
    try {
      // Auto-derive a working title from the first linked entity so the existing
      // AI description endpoint can produce a richer description.
      const primary = ctx[0];
      const synthTitle = `Action for ${primary.source}: ${primary.label}`;
      const inferredCategory =
        primary.source === 'Vulnerability' ? 'Security' :
        primary.source === 'Risk' ? 'Risk Mitigation' :
        primary.source === 'Internal Control' ? 'Compliance' :
        primary.source === 'Regulatory Change' ? 'Compliance' :
        primary.source === 'Committee' ? 'Governance' : 'Other';
      const inferredSource = primary.source === 'Vulnerability' ? 'Vulnerability' :
        primary.source === 'Risk' ? 'Risk' :
        primary.source === 'Internal Control' ? 'Control' :
        primary.source === 'Regulatory Change' ? 'Regulatory' :
        primary.source === 'Committee' ? 'Committee' : 'Manual';

      const res = await criticalTasksApi.aiGenerateDescription({
        title: synthTitle,
        category: inferredCategory,
        source: inferredSource,
        priority: newTask.priority || 'Medium',
        context: ctx.map((c) => `${c.source}: ${c.label}`).join('\n'),
      });
      const desc = res.data?.description;
      const parts: string[] = [];
      if (desc?.summary) parts.push(desc.summary);
      if (desc?.detailed_description) parts.push(desc.detailed_description);
      if (desc?.acceptance_criteria?.length) {
        parts.push('\nAcceptance Criteria:\n' + desc.acceptance_criteria.map((c: string) => `- ${c}`).join('\n'));
      }
      const generatedDesc = parts.length ? parts.join('\n\n') : ctx.map((c) => `${c.source}: ${c.label}`).join('\n');
      const generatedTitle = (desc?.title as string) || synthTitle;
      setNewTask((f) => ({
        ...f,
        title: f.title || generatedTitle,
        description: f.description || generatedDesc,
        category: f.category && f.category !== 'Other' ? f.category : inferredCategory,
        source: f.source && f.source !== 'Manual' ? f.source : inferredSource,
      }));
    } catch {
      // Fallback: just pre-fill from linked context locally.
      const fallbackDesc = ctx.map((c) => `${c.source}: ${c.label}`).join('\n');
      setNewTask((f) => ({
        ...f,
        title: f.title || `Action for ${ctx[0].source}: ${ctx[0].label}`,
        description: f.description || fallbackDesc,
      }));
    }
    setAiContextLoading(false);
  };

  const { data, isLoading } = useQuery<TaskListResponse>({
    queryKey: ['critical-tasks', search, filters, sortBy, sortOrder],
    queryFn: async () => {
      const params: Record<string, unknown> = { sort_by: sortBy, sort_order: sortOrder };
      if (search) params.search = search;
      if (filters.source) params.source = filters.source;
      if (filters.priority) params.priority = filters.priority;
      if (filters.status) params.status = filters.status;
      if (filters.category) params.category = filters.category;
      if (filters.assigned_owner_id) params.assigned_owner_id = filters.assigned_owner_id;
      if (filters.due_after) params.due_after = filters.due_after;
      if (filters.due_before) params.due_before = filters.due_before;
      const res = await criticalTasksApi.list(params);
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => criticalTasksApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['critical-tasks'] });
      setShowCreate(false);
      setNewTask({
        title: '', description: '', source: 'Manual', priority: 'Medium',
        severity: '', category: 'Other', assigned_owner_id: '',
        reviewer_id: '', due_date: '', sla_level: '', sla_days: '', evidence_notes: '',
        source_module: '', source_entity_type: '',
        linked_risk_id: '', linked_control_id: '', linked_vulnerability_id: '',
        linked_regulatory_change_id: '', linked_committee_id: '',
        recurrence_pattern: '', recurrence_interval: '1', approval_required: false,
      });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => criticalTasksApi.bulkAction(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['critical-tasks'] });
      setSelectedTasks([]);
      setShowBulkMenu(false);
      setBulkAssignId('');
    },
  });

  const handleCreate = () => {
    const payload: Record<string, unknown> = { ...newTask };
    if (payload.assigned_owner_id) payload.assigned_owner_id = Number(payload.assigned_owner_id);
    else delete payload.assigned_owner_id;
    if (payload.reviewer_id) payload.reviewer_id = Number(payload.reviewer_id);
    else delete payload.reviewer_id;
    // sla_level is a UI-only helper that resolves to sla_days via the configured map.
    delete payload.sla_level;
    if (payload.sla_days) payload.sla_days = Number(payload.sla_days);
    else delete payload.sla_days;
    if (!payload.source_module) delete payload.source_module;
    if (!payload.source_entity_type) delete payload.source_entity_type;
    ['linked_risk_id', 'linked_control_id', 'linked_vulnerability_id', 'linked_regulatory_change_id', 'linked_committee_id'].forEach(k => {
      if (payload[k]) payload[k] = Number(payload[k]);
      else delete payload[k];
    });
    if (!payload.due_date) delete payload.due_date;
    if (!payload.severity) delete payload.severity;
    if (!payload.evidence_notes) delete payload.evidence_notes;
    if (payload.recurrence_pattern) {
      payload.recurrence_interval = Number(payload.recurrence_interval) || 1;
    } else {
      delete payload.recurrence_pattern;
      delete payload.recurrence_interval;
    }
    if (!payload.approval_required) delete payload.approval_required;
    createMutation.mutate(payload);
  };

  const toggleSelect = (id: number) => {
    setSelectedTasks(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (!data?.items) return;
    if (selectedTasks.length === data.items.length) {
      setSelectedTasks([]);
    } else {
      setSelectedTasks(data.items.map((t: CriticalTaskItem) => t.id));
    }
  };

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortOrder('asc');
    }
  };

  const tasks = data?.items || [];
  const total = data?.total || 0;

  const kanbanColumns: Record<string, CriticalTaskItem[]> = {};
  STATUSES.forEach(s => { kanbanColumns[s] = []; });
  tasks.forEach(t => {
    if (kanbanColumns[t.status]) kanbanColumns[t.status].push(t);
  });

  const setSingleFilter = (key: string, value: string) => {
    setFilters((f) => {
      const n = { ...f };
      if (value) n[key] = value;
      else delete n[key];
      return n;
    });
  };

  const userItems = users.map((u) => ({
    value: String(u.id),
    label: u.display_name || u.username || u.email || `User #${u.id}`,
    subLabel: u.email,
  }));

  return (
    <div className="-m-4 lg:-m-5 text-[var(--color-text)]">
      <div className="border-b border-gray-200 px-3 sm:px-6 pt-3 overflow-x-auto">
        <div className="flex items-center gap-0 min-w-max">
          {taskTabs.map(({ id, label, icon: Icon }) => {
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
      {activeTab === 'board' && (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold text-black tracking-tight">Task Board</h1>
              <p className="mt-1 text-sm text-slate-600">Centralized critical task management — {total} tasks</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center rounded-full border border-[var(--color-border)] bg-white overflow-hidden">
                <button onClick={() => setViewMode('table')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-slate-50'}`}>
                  <LayoutList size={14} /> <span className="hidden sm:inline">Table</span>
                </button>
                <button onClick={() => setViewMode('kanban')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'kanban' ? 'bg-blue-600 text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-slate-50'}`}>
                  <Columns3 size={14} /> <span className="hidden sm:inline">Kanban</span>
                </button>
              </div>
              <button onClick={handleAiReprioritize} disabled={aiLoading}
                className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors disabled:opacity-50">
                {aiLoading ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                <span className="hidden md:inline">AI Reprioritize</span>
                <span className="md:hidden">AI</span>
              </button>
              <button onClick={() => setShowTemplateModal(true)}
                className="cw-btn-secondary flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium">
                <Copy size={14} />
                <span className="hidden md:inline">From Template</span>
                <span className="md:hidden">Template</span>
              </button>
              {canCreate && (
                <button onClick={() => setShowCreate(true)}
                  className="cw-btn-primary flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-2 text-sm font-medium">
                  <Plus size={16} />
                  <span className="hidden sm:inline">New Task</span>
                  <span className="sm:hidden">New</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[180px] sm:min-w-[260px] max-w-md">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search tasks..."
                size="md"
              />
            </div>

            <MultiSelectDropdown
              title="Source"
              items={SOURCES.map((s) => ({ value: s, label: s }))}
              selectedValues={filters.source ? [filters.source] : []}
              onApply={(v) => setSingleFilter('source', v[0] || '')}
              multiSelect={false}
              autoApply
              placeholder="All Sources"
              size="md"
            />
            <MultiSelectDropdown
              title="Priority"
              items={PRIORITIES.map((p) => ({ value: p, label: p }))}
              selectedValues={filters.priority ? [filters.priority] : []}
              onApply={(v) => setSingleFilter('priority', v[0] || '')}
              multiSelect={false}
              autoApply
              placeholder="All Priorities"
              size="md"
            />
            <MultiSelectDropdown
              title="Status"
              items={STATUSES.map((s) => ({ value: s, label: s }))}
              selectedValues={filters.status ? [filters.status] : []}
              onApply={(v) => setSingleFilter('status', v[0] || '')}
              multiSelect={false}
              autoApply
              placeholder="All Statuses"
              size="md"
            />
            <MultiSelectDropdown
              title="Category"
              items={CATEGORIES.map((c) => ({ value: c, label: c }))}
              selectedValues={filters.category ? [filters.category] : []}
              onApply={(v) => setSingleFilter('category', v[0] || '')}
              multiSelect={false}
              autoApply
              placeholder="All Categories"
              size="md"
            />
            <MultiSelectDropdown
              title="Owner"
              items={userItems}
              selectedValues={filters.assigned_owner_id ? [filters.assigned_owner_id] : []}
              onApply={(v) => setSingleFilter('assigned_owner_id', v[0] || '')}
              multiSelect={false}
              autoApply
              forceSearch
              placeholder="All Owners"
              searchPlaceholder="Search users"
              size="md"
            />
            {Object.keys(filters).length > 0 && (
              <button onClick={() => setFilters({})} className="text-sm text-red-600 hover:text-red-700 ml-1">Clear</button>
            )}

            {selectedTasks.length > 0 && (
              <div className="relative ml-auto">
                <button onClick={() => setShowBulkMenu(!showBulkMenu)}
                  className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  <MoreHorizontal size={16} /> Bulk ({selectedTasks.length})
                </button>
                {showBulkMenu && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 cw-card p-1 shadow-xl">
                    <div className="px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] uppercase">Priority</div>
                    {PRIORITIES.map(p => (
                      <button key={p} onClick={() => bulkMutation.mutate({ task_ids: selectedTasks, action: 'change_priority', value: p })}
                        className="w-full rounded px-3 py-1.5 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-subtle)]">
                        Set → {p}
                      </button>
                    ))}
                    <hr className="my-1 border-[var(--color-border)]" />
                    <div className="px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] uppercase">Status</div>
                    {['In Progress', 'Completed'].map(s => (
                      <button key={s} onClick={() => bulkMutation.mutate({ task_ids: selectedTasks, action: 'change_status', value: s })}
                        className="w-full rounded px-3 py-1.5 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-subtle)]">
                        Set → {s}
                      </button>
                    ))}
                    <hr className="my-1 border-[var(--color-border)]" />
                    <div className="px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] uppercase">Assign</div>
                    <div className="flex items-center gap-1 px-2 py-1">
                      <select value={bulkAssignId} onChange={e => setBulkAssignId(e.target.value)}
                        className="cw-field flex-1 px-2 py-1 text-xs">
                        <option value="">Select user</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                      </select>
                      <button disabled={!bulkAssignId}
                        onClick={() => bulkMutation.mutate({ task_ids: selectedTasks, action: 'assign', assigned_owner_id: Number(bulkAssignId) })}
                        className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-40">
                        Go
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

      {viewMode === 'table' ? (
        <div className="cw-card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[var(--color-muted)]">
              <Target size={48} className="mb-4 opacity-50" />
              <p className="text-lg font-medium">No tasks found</p>
              <p className="text-sm">Create a new task to get started</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-subtle)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={selectedTasks.length === tasks.length && tasks.length > 0}
                      onChange={toggleSelectAll} className="rounded border-[var(--color-border)]" />
                  </th>
                  <th className="px-4 py-3 cursor-pointer hover:text-[var(--color-text)]" onClick={() => handleSort('title')}>
                    <span className="flex items-center gap-1">Title <ArrowUpDown size={12} /></span>
                  </th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3 cursor-pointer hover:text-[var(--color-text)]" onClick={() => handleSort('priority')}>
                    <span className="flex items-center gap-1">Priority <ArrowUpDown size={12} /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer hover:text-[var(--color-text)]" onClick={() => handleSort('status')}>
                    <span className="flex items-center gap-1">Status <ArrowUpDown size={12} /></span>
                  </th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3 cursor-pointer hover:text-[var(--color-text)]" onClick={() => handleSort('due_date')}>
                    <span className="flex items-center gap-1">Due Date <ArrowUpDown size={12} /></span>
                  </th>
                  <th className="px-4 py-3">SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {tasks.map((task: CriticalTaskItem) => (
                  <tr key={task.id} className="hover:bg-[var(--color-subtle)] transition-colors">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedTasks.includes(task.id)}
                        onChange={() => toggleSelect(task.id)} className="rounded border-[var(--color-border)]" />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/tasks/${task.id}`} className="text-sm font-medium text-[var(--color-text)] hover:text-blue-600 transition-colors">
                        {task.title}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        {task.category && <span className="text-xs text-[var(--color-muted)]">{task.category}</span>}
                        {task.source_module && <span className="text-xs text-blue-600/70">via {task.source_module}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className="text-xs text-[var(--color-muted)]">{task.source}</span></td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[task.priority] || ''}`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[task.status] || ''}`}>
                        {task.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[var(--color-muted)]">
                        {task.assigned_owner?.display_name || task.assigned_owner?.username || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[var(--color-muted)]">
                        {task.due_date ? new Date(task.due_date).toLocaleDateString() : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${SLA_COLORS[task.sla_status] || ''}`}>
                        {task.sla_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-3 overflow-x-auto">
          {isLoading ? (
            <div className="col-span-6 flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
          ) : (
            STATUSES.map(status => (
              <div key={status} className={`cw-card p-0 border-t-2 ${KANBAN_BORDER_COLORS[status] || ''}`}>
                <div className="px-3 py-2.5 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">{status}</span>
                    <span className="text-xs text-[var(--color-muted)] bg-[var(--color-subtle)] rounded-full px-1.5 py-0.5">{kanbanColumns[status]?.length || 0}</span>
                  </div>
                </div>
                <div className="p-2 space-y-2 max-h-[600px] overflow-y-auto">
                  {(kanbanColumns[status] || []).length === 0 ? (
                    <p className="text-xs text-[var(--color-muted)] text-center py-4">No tasks</p>
                  ) : (
                    (kanbanColumns[status] || []).map((task: CriticalTaskItem) => (
                      <Link key={task.id} href={`/tasks/${task.id}`}
                        className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 hover:bg-[var(--color-subtle)] transition-colors">
                        <p className="text-xs font-medium text-[var(--color-text)] mb-2 line-clamp-2">{task.title}</p>
                        <div className="flex items-center justify-between">
                          <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_COLORS[task.priority] || ''}`}>
                            {task.priority}
                          </span>
                          <span className={`text-[10px] font-medium ${SLA_COLORS[task.sla_status] || ''}`}>
                            {task.sla_status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] text-[var(--color-muted)]">{task.source}</span>
                          <span className="text-[10px] text-[var(--color-muted)]">
                            {task.assigned_owner?.display_name || task.assigned_owner?.username || 'Unassigned'}
                          </span>
                        </div>
                        {task.due_date && (
                          <span className="text-[10px] text-[var(--color-muted)] mt-1 block">Due: {new Date(task.due_date).toLocaleDateString()}</span>
                        )}
                      </Link>
                    ))
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <RightSlidePanel
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create New Task"
        widthClassName="w-[780px]"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newTask.title || createMutation.isPending}
              className="cw-btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {createMutation.isPending && <Loader2 className="animate-spin" size={14} />}
              Create Task
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {/* Linked entities + AI generate */}
          <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-purple-700" />
                <span className="text-xs font-semibold text-slate-700">Link Source (optional)</span>
              </div>
              <button
                type="button"
                onClick={handleAiGenerateFromContext}
                disabled={aiContextLoading}
                className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {aiContextLoading ? <Loader2 className="animate-spin" size={12} /> : <Sparkles size={12} />}
                AI Generate
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Risk</label>
                <MultiSelectDropdown
                  title="Risk"
                  items={riskOptions.map((r) => ({ value: String(r.id), label: r.label }))}
                  selectedValues={newTask.linked_risk_id ? [String(newTask.linked_risk_id)] : []}
                  onApply={(v) => setNewTask(f => ({ ...f, linked_risk_id: v[0] || '' }))}
                  multiSelect={false}
                  forceSearch
                  triggerVariant="input"
                  placeholder="None"
                  searchPlaceholder="Search risks"
                  size="sm"
                  triggerClassName="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Internal Control</label>
                <MultiSelectDropdown
                  title="Internal Control"
                  items={controlOptions.map((c) => ({ value: String(c.id), label: c.label }))}
                  selectedValues={newTask.linked_control_id ? [String(newTask.linked_control_id)] : []}
                  onApply={(v) => setNewTask(f => ({ ...f, linked_control_id: v[0] || '' }))}
                  multiSelect={false}
                  forceSearch
                  triggerVariant="input"
                  placeholder="None"
                  searchPlaceholder="Search controls"
                  size="sm"
                  triggerClassName="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Vulnerability</label>
                <MultiSelectDropdown
                  title="Vulnerability"
                  items={vulnOptions.map((v) => ({ value: String(v.id), label: v.label }))}
                  selectedValues={newTask.linked_vulnerability_id ? [String(newTask.linked_vulnerability_id)] : []}
                  onApply={(v) => setNewTask(f => ({ ...f, linked_vulnerability_id: v[0] || '' }))}
                  multiSelect={false}
                  forceSearch
                  triggerVariant="input"
                  placeholder="None"
                  searchPlaceholder="Search vulnerabilities"
                  size="sm"
                  triggerClassName="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Regulatory Change</label>
                <MultiSelectDropdown
                  title="Regulatory Change"
                  items={regulatoryChangeOptions.map((r) => ({ value: String(r.id), label: r.label }))}
                  selectedValues={newTask.linked_regulatory_change_id ? [String(newTask.linked_regulatory_change_id)] : []}
                  onApply={(v) => setNewTask(f => ({ ...f, linked_regulatory_change_id: v[0] || '' }))}
                  multiSelect={false}
                  forceSearch
                  triggerVariant="input"
                  placeholder="None"
                  searchPlaceholder="Search regulatory changes"
                  size="sm"
                  triggerClassName="w-full"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Committee</label>
                <MultiSelectDropdown
                  title="Committee"
                  items={committeeOptions.map((c) => ({ value: String(c.id), label: c.label }))}
                  selectedValues={newTask.linked_committee_id ? [String(newTask.linked_committee_id)] : []}
                  onApply={(v) => setNewTask(f => ({ ...f, linked_committee_id: v[0] || '' }))}
                  multiSelect={false}
                  forceSearch
                  triggerVariant="input"
                  placeholder="None"
                  searchPlaceholder="Search committees"
                  size="sm"
                  triggerClassName="w-full"
                />
              </div>
            </div>
            {/* <p className="text-[11px] text-slate-500">Pick any source above, then click <span className="font-medium text-purple-700">AI Generate</span> — title, description, category and source will be auto-filled based on the selected context.</p> */}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Title *</label>
            <input
              type="text"
              value={newTask.title}
              onChange={e => setNewTask(f => ({ ...f, title: e.target.value }))}
              className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              placeholder="Task title"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="block text-xs font-medium text-slate-600">Description</label>
              {/* <button
                type="button"
                onClick={handleAiGenerateDescription}
                disabled={aiDescLoading || !newTask.title.trim()}
                className="flex items-center gap-1 text-xs text-purple-700 hover:text-purple-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {aiDescLoading ? <Loader2 className="animate-spin" size={12} /> : <Sparkles size={12} />} AI Generate
              </button> */}
            </div>
            <textarea
              value={newTask.description}
              onChange={e => setNewTask(f => ({ ...f, description: e.target.value }))}
              className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              rows={3}
              placeholder="Task description"
            />
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Source</label>
              <select
                value={newTask.source}
                onChange={e => setNewTask(f => ({ ...f, source: e.target.value }))}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Priority</label>
              <select
                value={newTask.priority}
                onChange={e => setNewTask(f => ({ ...f, priority: e.target.value }))}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Category</label>
              <select
                value={newTask.category}
                onChange={e => setNewTask(f => ({ ...f, category: e.target.value }))}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Severity</label>
              <select
                value={newTask.severity}
                onChange={e => setNewTask(f => ({ ...f, severity: e.target.value }))}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                <option value="">None</option>
                <option value="Critical">Critical</option><option value="High">High</option>
                <option value="Medium">Medium</option><option value="Low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Assigned Owner</label>
              <MultiSelectDropdown
                title="Owner"
                items={userItems}
                selectedValues={newTask.assigned_owner_id ? [newTask.assigned_owner_id] : []}
                onApply={(v) => setNewTask(f => ({ ...f, assigned_owner_id: v[0] || '' }))}
                multiSelect={false}
                autoApply
                forceSearch
                triggerVariant="input"
                placeholder="Unassigned"
                searchPlaceholder="Search users"
                size="sm"
                triggerClassName="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Reviewer</label>
              <MultiSelectDropdown
                title="Reviewer"
                items={userItems}
                selectedValues={newTask.reviewer_id ? [newTask.reviewer_id] : []}
                onApply={(v) => setNewTask(f => ({ ...f, reviewer_id: v[0] || '' }))}
                multiSelect={false}
                autoApply
                forceSearch
                triggerVariant="input"
                placeholder="None"
                searchPlaceholder="Search users"
                size="sm"
                triggerClassName="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Due Date</label>
              <input
                type="date"
                value={newTask.due_date}
                onChange={e => setNewTask(f => ({ ...f, due_date: e.target.value }))}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-0.5">SLA Level</label>
              <MultiSelectDropdown
                title="SLA Level"
                items={TASK_SLA_ORDER.map((level) => {
                  const cfg = getTaskSLAConfig();
                  return { value: level, label: `${TASK_SLA_LABELS[level]} (${cfg[level]} days)` };
                })}
                selectedValues={newTask.sla_level ? [newTask.sla_level] : []}
                onApply={(v) => {
                  const level = (v[0] || '') as TaskSLALevel | '';
                  if (level) {
                    const days = getTaskSLAConfig()[level];
                    setNewTask(f => ({ ...f, sla_level: level, sla_days: String(days) }));
                  } else {
                    setNewTask(f => ({ ...f, sla_level: '', sla_days: '' }));
                  }
                }}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select SLA level"
                size="sm"
                triggerClassName="w-full"
              />
              {newTask.sla_days && (
                <p className="mt-1 text-[11px] text-slate-500">Applies a {newTask.sla_days}-day deadline window.</p>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3 mt-1">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
              <RefreshCw size={12} /> Recurrence & Approval
            </h3>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Recurrence</label>
                <select
                  value={newTask.recurrence_pattern}
                  onChange={e => setNewTask(f => ({ ...f, recurrence_pattern: e.target.value }))}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">None</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
              {newTask.recurrence_pattern && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Interval</label>
                  <input
                    type="number"
                    min="1"
                    value={newTask.recurrence_interval}
                    onChange={e => setNewTask(f => ({ ...f, recurrence_interval: e.target.value }))}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    placeholder="Every N periods"
                  />
                </div>
              )}
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer pb-1">
                  <input
                    type="checkbox"
                    checked={newTask.approval_required}
                    onChange={e => setNewTask(f => ({ ...f, approval_required: e.target.checked }))}
                    className="rounded border-slate-300"
                  />
                  <span className="text-xs text-slate-600">Requires Approval</span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Evidence / Notes</label>
            <textarea
              value={newTask.evidence_notes}
              onChange={e => setNewTask(f => ({ ...f, evidence_notes: e.target.value }))}
              className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              rows={2}
              placeholder="Supporting evidence or notes"
            />
          </div>

        </div>
      </RightSlidePanel>

      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center cw-overlay p-4">
          <div className="cw-modal-panel rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-[var(--color-text)] flex items-center gap-2"><Copy size={18} /> Create from Template</h2>
              <button onClick={() => setShowTemplateModal(false)} className="text-[var(--color-muted)] hover:text-[var(--color-text)]"><X size={20} /></button>
            </div>
            {(templates as Record<string, unknown>[] | undefined)?.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)] text-center py-8">No templates available</p>
            ) : (
              <div className="space-y-3">
                {(templates as Record<string, unknown>[] | undefined)?.map((t: Record<string, unknown>) => (
                  <div key={t.id as number} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:bg-[var(--color-subtle)] transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-medium text-[var(--color-text)]">{t.name as string}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${t.is_system ? 'border-blue-200 text-blue-700 bg-blue-50' : 'border-[var(--color-border)] text-[var(--color-muted)] bg-[var(--color-subtle)]'}`}>
                        {t.is_system ? 'System' : 'Custom'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-muted)] mb-3">{t.description as string}</p>
                    <div className="flex items-center gap-2 text-xs text-[var(--color-muted)] mb-3">
                      <span>Priority: {t.priority as string}</span>
                      <span>·</span>
                      <span>Category: {t.category as string}</span>
                      {(t.sla_days as number) && <><span>·</span><span>SLA: {t.sla_days as number}d</span></>}
                    </div>
                    <button onClick={() => templateMutation.mutate({ template_id: t.id, template_name: t.name, title: `${t.name} - ${new Date().toLocaleDateString()}` })}
                      disabled={templateMutation.isPending}
                      className="cw-btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                      {templateMutation.isPending ? <Loader2 className="animate-spin" size={12} /> : <Plus size={12} />} Create Task
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

          {showAiResult && aiResult && (
            <div className="fixed inset-0 z-50 flex items-center justify-center cw-overlay p-4">
              <div className="cw-modal-panel rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-[var(--color-text)] flex items-center gap-2"><Sparkles size={18} className="text-purple-600" /> AI Priority Suggestions</h2>
                  <button onClick={() => setShowAiResult(false)} className="text-[var(--color-muted)] hover:text-[var(--color-text)]"><X size={20} /></button>
                </div>
                {(aiResult.suggestions as Record<string, unknown>[])?.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted)] text-center py-8">All tasks are optimally prioritized.</p>
                ) : (
                  <>
                    <div className="space-y-3">
                      {(aiResult.suggestions as Record<string, unknown>[])?.map((s: Record<string, unknown>, i: number) => (
                        <div key={i} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-xs text-[var(--color-muted)]">Task #{s.task_id as number}</span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[s.current_priority as string] || ''}`}>
                              {s.current_priority as string}
                            </span>
                            <span className="text-[var(--color-muted)]">→</span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[s.suggested_priority as string] || ''}`}>
                              {s.suggested_priority as string}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--color-muted)]">{s.justification as string}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[var(--color-border)]">
                      <button onClick={() => setShowAiResult(false)}
                        className="cw-btn-secondary px-4 py-2 text-sm">
                        Discard
                      </button>
                      <button onClick={async () => {
                        const suggestions = aiResult.suggestions as Record<string, unknown>[];
                        for (const s of suggestions) {
                          if (s.task_id && s.suggested_priority) {
                            try {
                              await criticalTasksApi.update(s.task_id as number, { priority: s.suggested_priority as string });
                            } catch { /* skip failed updates */ }
                          }
                        }
                        queryClient.invalidateQueries({ queryKey: ['critical-tasks'] });
                        setShowAiResult(false);
                        setAiResult(null);
                      }}
                        className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors">
                        Apply All Changes
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'my-tasks' && <MyTasksPage />}
      {activeTab === 'sla' && <TasksSLAConfigPage />}
      {activeTab === 'reports' && <TaskReportsPage />}
      </div>
    </div>
  );
}
