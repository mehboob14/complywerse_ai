'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Risk, RiskMitigationAction } from '@/types';
import {
  Loader2,
  Plus,
  X,
  Edit2,
  Trash2,
  CheckCircle,
  Clock,
  AlertTriangle,
  ListTodo,
  Search,
  Link as LinkIcon,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

type ActionType = 'mitigate' | 'transfer' | 'avoid' | 'accept';
type ActionStatus = 'open' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';
type ActionPriority = 'critical' | 'high' | 'medium' | 'low';

const ACTION_TYPES: { value: ActionType; label: string; color: string }[] = [
  { value: 'mitigate', label: 'Mitigate', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'transfer', label: 'Transfer', color: 'bg-purple-500/20 text-purple-400' },
  { value: 'avoid', label: 'Avoid', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'accept', label: 'Accept', color: 'bg-slate-500/20 text-slate-600' },
];

const ACTION_STATUSES: { value: ActionStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Open', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'completed', label: 'Completed', color: 'bg-green-500/20 text-green-400' },
  { value: 'overdue', label: 'Overdue', color: 'bg-red-500/20 text-red-400' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-slate-500/20 text-slate-600' },
];

const ACTION_PRIORITIES: { value: ActionPriority; label: string; color: string }[] = [
  { value: 'critical', label: 'Critical', color: 'bg-red-500/20 text-red-400' },
  { value: 'high', label: 'High', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'low', label: 'Low', color: 'bg-green-500/20 text-green-400' },
];

interface MitigationActionFormData {
  title: string;
  description?: string;
  risk_id: number;
  action_type: ActionType;
  priority: ActionPriority;
  status: ActionStatus;
  owner_id?: number;
  due_date?: string;
  expected_residual_reduction?: number;
  notes?: string;
}

export default function MitigationActionsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:mitigation_actions:create');
  const canDelete = hasPermission('erm:mitigation_actions:delete');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAction, setEditingAction] = useState<RiskMitigationAction | null>(null);
  const [completingAction, setCompletingAction] = useState<RiskMitigationAction | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('all');
  const queryClient = useQueryClient();

  const { data: risks, isLoading: risksLoading } = useQuery({
    queryKey: ['erm-risks-list'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const { data: overdueActions } = useQuery({
    queryKey: ['erm-mitigation-actions-overdue'],
    queryFn: async () => {
      const response = await ermApi.mitigationActions.getOverdue();
      return response.data;
    },
  });

  const { data: allActions, isLoading: actionsLoading } = useQuery({
    queryKey: ['erm-all-mitigation-actions', risks?.map(r => r.id)],
    queryFn: async () => {
      if (!risks || risks.length === 0) return [];
      const actionsPromises = risks.map(async (risk) => {
        try {
          const response = await ermApi.mitigationActions.getAll(risk.id);
          return response.data.map((action: RiskMitigationAction) => ({
            ...action,
            riskTitle: risk.title,
          }));
        } catch {
          return [];
        }
      });
      const results = await Promise.all(actionsPromises);
      return results.flat();
    },
    enabled: !!risks && risks.length > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ermApi.mitigationActions.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-all-mitigation-actions'] });
      queryClient.invalidateQueries({ queryKey: ['erm-mitigation-actions-overdue'] });
    },
  });

  const filteredActions = useMemo(() => {
    if (!allActions) return [];
    return allActions.filter((action: RiskMitigationAction & { riskTitle: string }) => {
      const matchesSearch = !searchTerm || 
        action.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        action.riskTitle?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || action.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || action.priority === priorityFilter;
      const matchesType = actionTypeFilter === 'all' || action.action_type === actionTypeFilter;
      return matchesSearch && matchesStatus && matchesPriority && matchesType;
    });
  }, [allActions, searchTerm, statusFilter, priorityFilter, actionTypeFilter]);

  const stats = useMemo(() => {
    if (!allActions) return { total: 0, open: 0, overdue: 0, completedThisMonth: 0 };
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    return {
      total: allActions.length,
      open: allActions.filter((a: RiskMitigationAction) => a.status === 'open' || a.status === 'in_progress').length,
      overdue: overdueActions?.length || allActions.filter((a: RiskMitigationAction) => a.status === 'overdue').length,
      completedThisMonth: allActions.filter((a: RiskMitigationAction) => 
        a.status === 'completed' && a.completed_at && new Date(a.completed_at) >= startOfMonth
      ).length,
    };
  }, [allActions, overdueActions]);

  const isLoading = risksLoading || actionsLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <ListTodo className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
              <p className="text-sm text-slate-600">Total Actions</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-500/20 p-2">
              <Clock className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.open}</p>
              <p className="text-sm text-slate-600">Open Actions</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-red-700/50 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-400">{stats.overdue}</p>
              <p className="text-sm text-slate-600">Overdue Actions</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.completedThisMonth}</p>
              <p className="text-sm text-slate-600">Completed (Month)</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Search actions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-lg border border-slate-300 bg-slate-100 py-2 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-600"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900"
          >
            <option value="all">All Statuses</option>
            {ACTION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900"
          >
            <option value="all">All Priorities</option>
            {ACTION_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <select
            value={actionTypeFilter}
            onChange={(e) => setActionTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900"
          >
            <option value="all">All Types</option>
            {ACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        {canCreate && (
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
        >
          <Plus className="h-4 w-4" />
          Add Action
        </button>
        )}
      </div>

      {filteredActions && filteredActions.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Title</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Risk</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Priority</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Owner</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Due Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Expected Reduction</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredActions.map((action: RiskMitigationAction & { riskTitle?: string }) => {
                const typeStyle = ACTION_TYPES.find((t) => t.value === action.action_type);
                const statusStyle = ACTION_STATUSES.find((s) => s.value === action.status);
                const priorityStyle = ACTION_PRIORITIES.find((p) => p.value === action.priority);
                const isOverdue = action.due_date && new Date(action.due_date) < new Date() && 
                  action.status !== 'completed' && action.status !== 'cancelled';
                
                return (
                  <tr key={action.id} className="border-b border-slate-200/50 hover:bg-slate-100/30">
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900">{action.title}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link 
                        href={`/erm/risks`}
                        className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300"
                      >
                        <LinkIcon className="h-3 w-3" />
                        {action.riskTitle || `Risk #${action.risk_id}`}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${typeStyle?.color || ''}`}>
                        {action.action_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle?.color || ''}`}>
                        {action.status?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${priorityStyle?.color || ''}`}>
                        {action.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {action.owner?.full_name || action.owner?.email || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {action.due_date ? (
                        <span className={`text-sm ${isOverdue ? 'text-red-400 font-medium' : 'text-slate-700'}`}>
                          {new Date(action.due_date).toLocaleDateString()}
                          {isOverdue && ' (Overdue)'}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {action.expected_residual_reduction !== undefined && action.expected_residual_reduction !== null
                        ? `${action.expected_residual_reduction}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {action.status !== 'completed' && action.status !== 'cancelled' && (
                          <button
                            onClick={() => setCompletingAction(action)}
                            className="rounded p-1.5 text-slate-600 hover:bg-green-500/20 hover:text-green-400"
                            title="Complete Action"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditingAction(action)}
                          className="rounded p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this action?')) {
                              deleteMutation.mutate(action.id);
                            }
                          }}
                          className="rounded p-1.5 text-slate-600 hover:bg-red-500/20 hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-200 bg-white">
          <ListTodo className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-slate-900">No mitigation actions found</h3>
          <p className="mt-1 text-slate-600">Create mitigation actions to track risk treatment progress</p>
        </div>
      )}

      {(showCreateModal || editingAction) && (
        <ActionModal
          action={editingAction}
          risks={risks || []}
          onClose={() => {
            setShowCreateModal(false);
            setEditingAction(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setEditingAction(null);
            queryClient.invalidateQueries({ queryKey: ['erm-all-mitigation-actions'] });
            queryClient.invalidateQueries({ queryKey: ['erm-mitigation-actions-overdue'] });
          }}
        />
      )}

      {completingAction && (
        <CompleteActionModal
          action={completingAction}
          onClose={() => setCompletingAction(null)}
          onSuccess={() => {
            setCompletingAction(null);
            queryClient.invalidateQueries({ queryKey: ['erm-all-mitigation-actions'] });
            queryClient.invalidateQueries({ queryKey: ['erm-mitigation-actions-overdue'] });
          }}
        />
      )}
    </div>
  );
}

function ActionModal({
  action,
  risks,
  onClose,
  onSuccess,
}: {
  action: RiskMitigationAction | null;
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<MitigationActionFormData>({
    title: action?.title || '',
    description: action?.description || '',
    risk_id: action?.risk_id || (risks[0]?.id || 0),
    action_type: action?.action_type || 'mitigate',
    priority: action?.priority || 'medium',
    status: action?.status || 'open',
    owner_id: action?.owner_id,
    due_date: action?.due_date?.split('T')[0] || '',
    expected_residual_reduction: action?.expected_residual_reduction,
    notes: action?.notes || '',
  });

  const [aiSuggestions, setAiSuggestions] = useState<Array<{
    title: string;
    description: string;
    action_type: string;
    priority: string;
    expected_residual_reduction: number;
  }>>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [riskSearch, setRiskSearch] = useState('');

  const filteredRisks = useMemo(() => {
    const term = riskSearch.trim().toLowerCase();
    if (!term) return risks;
    const matches = risks.filter((risk) => {
      const title = (risk.title || '').toLowerCase();
      const category = (risk.risk_category || '').toLowerCase();
      return title.includes(term) || category.includes(term) || String(risk.id).includes(term);
    });
    if (matches.some((risk) => risk.id === formData.risk_id)) return matches;
    const selected = risks.find((risk) => risk.id === formData.risk_id);
    return selected ? [selected, ...matches] : matches;
  }, [risks, riskSearch, formData.risk_id]);

  const handleAiSuggest = async () => {
    if (!formData.risk_id && !formData.title) return;
    setAiLoading(true);
    setAiError('');
    setAiSuggestions([]);
    try {
      const response = await ermApi.mitigationActions.aiSuggest({
        risk_id: formData.risk_id || undefined,
        title: formData.title || undefined,
      });
      setAiSuggestions(response.data.suggestions);
    } catch (err: any) {
      setAiError(err?.response?.data?.detail || 'Failed to get AI suggestions');
    } finally {
      setAiLoading(false);
    }
  };

  const applySuggestion = (suggestion: typeof aiSuggestions[0]) => {
    setFormData({
      ...formData,
      title: suggestion.title,
      description: suggestion.description,
      action_type: suggestion.action_type as ActionType,
      priority: suggestion.priority as ActionPriority,
      expected_residual_reduction: suggestion.expected_residual_reduction,
    });
    setAiSuggestions([]);
  };

  const createMutation = useMutation({
    mutationFn: (data: MitigationActionFormData) => {
      const { risk_id, ...actionData } = data;
      return ermApi.mitigationActions.create(risk_id, actionData);
    },
    onSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; updates: Partial<MitigationActionFormData> }) =>
      ermApi.mitigationActions.update(data.id, data.updates),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submissionData = {
      ...formData,
      due_date: formData.due_date || new Date().toISOString().split('T')[0],
    };

    if (action) {
      updateMutation.mutate({ id: action.id, updates: submissionData });
    } else {
      createMutation.mutate(submissionData);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {action ? 'Edit Mitigation Action' : 'Create Mitigation Action'}
          </h2>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-600">Risk *</label>
            {!action && (
              <input
                type="text"
                value={riskSearch}
                onChange={(e) => setRiskSearch(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
                placeholder="Search risk by title..."
              />
            )}
            <select
              value={formData.risk_id}
              onChange={(e) => setFormData({ ...formData, risk_id: Number(e.target.value) })}
              className={`${action ? 'mt-1' : 'mt-2'} w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900`}
              required
              disabled={!!action}
            >
              {filteredRisks.map((risk) => (
                <option key={risk.id} value={risk.id}>
                  {risk.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Title *</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
                required
              />
              {!action && (
                <button
                  type="button"
                  onClick={handleAiSuggest}
                  disabled={aiLoading || (!formData.risk_id && !formData.title)}
                  className="mt-1 flex items-center gap-1.5 whitespace-nowrap rounded-lg btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  AI Suggest
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              rows={2}
            />
          </div>

          {aiError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {aiError}
            </div>
          )}

          {aiSuggestions.length > 0 && (
            <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary-600" />
                <span className="text-sm font-medium text-primary-700">AI Suggested Mitigations</span>
                <span className="text-xs text-slate-500">Click to apply</span>
              </div>
              <div className="space-y-2">
                {aiSuggestions.map((s, idx) => {
                  const typeStyle = ACTION_TYPES.find((t) => t.value === s.action_type);
                  const priorityStyle = ACTION_PRIORITIES.find((p) => p.value === s.priority);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => applySuggestion(s)}
                      className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-primary-300 hover:bg-primary-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">{s.title}</span>
                        <div className="flex shrink-0 gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeStyle?.color || ''}`}>
                            {s.action_type}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityStyle?.color || ''}`}>
                            {s.priority}
                          </span>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 line-clamp-2">{s.description}</p>
                      <div className="mt-1 text-xs text-slate-500">
                        Expected reduction: {s.expected_residual_reduction}%
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Action Type</label>
              <select
                value={formData.action_type}
                onChange={(e) => setFormData({ ...formData, action_type: e.target.value as ActionType })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              >
                {ACTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600">Priority</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as ActionPriority })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              >
                {ACTION_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as ActionStatus })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              >
                {ACTION_STATUSES.filter(s => s.value !== 'overdue').map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600">Due Date</label>
              <input
                type="date"
                value={formData.due_date || ''}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Expected Residual Reduction (%)</label>
            <input
              type="number"
              min="0"
              max="100"
              value={formData.expected_residual_reduction || ''}
              onChange={(e) => setFormData({ 
                ...formData, 
                expected_residual_reduction: e.target.value ? Number(e.target.value) : undefined 
              })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              placeholder="e.g., 25"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {action ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CompleteActionModal({
  action,
  onClose,
  onSuccess,
}: {
  action: RiskMitigationAction;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [actualReduction, setActualReduction] = useState<number>(
    action.expected_residual_reduction || 0
  );

  const completeMutation = useMutation({
    mutationFn: (reduction?: number) => ermApi.mitigationActions.complete(action.id, reduction),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    completeMutation.mutate(actualReduction || undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Complete Action</h2>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-slate-600">{action.title}</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-600">Actual Residual Reduction Achieved (%)</label>
            <div className="mt-2 text-xs text-slate-500">
              Expected: {action.expected_residual_reduction ?? '—'}%
            </div>
            <input
              type="number"
              min="0"
              max="100"
              value={actualReduction}
              onChange={(e) => setActualReduction(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={completeMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm text-slate-900 hover:bg-green-500 disabled:opacity-50"
            >
              {completeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Mark Complete
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
