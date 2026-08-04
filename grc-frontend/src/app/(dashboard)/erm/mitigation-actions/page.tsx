'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ermApi, criticalTasksApi, evidenceApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Risk, RiskMitigationAction } from '@/types';
import {
  Loader2,
  Plus,
  Edit2,
  Trash2,
  CheckCircle,
  Clock,
  AlertTriangle,
  ListTodo,
  Link as LinkIcon,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Paperclip,
  X as XIcon,
  UserCircle2,
} from 'lucide-react';
import Link from 'next/link';
import { MultiSelectDropdown, RightSlidePanel, SearchInput, PageLoader } from '@/components/ui';

type ActionType = 'mitigate' | 'transfer' | 'avoid' | 'accept';
type ActionStatus = 'open' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';
type ActionPriority = 'critical' | 'high' | 'medium' | 'low';

const ACTION_TYPES: { value: ActionType; label: string; color: string }[] = [
  { value: 'mitigate', label: 'Mitigate', color: 'bg-primary-50 text-primary-700' },
  { value: 'transfer', label: 'Transfer', color: 'bg-primary-50 text-primary-700' },
  { value: 'avoid', label: 'Avoid', color: 'bg-orange-50 text-orange-700' },
  { value: 'accept', label: 'Accept', color: 'bg-slate-100 text-slate-600' },
];

const ACTION_STATUSES: { value: ActionStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Open', color: 'bg-primary-50 text-primary-700' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-amber-50 text-amber-700' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-50 text-emerald-700' },
  { value: 'overdue', label: 'Overdue', color: 'bg-rose-50 text-rose-700' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-slate-100 text-slate-600' },
];

const ACTION_PRIORITIES: { value: ActionPriority; label: string; color: string }[] = [
  { value: 'critical', label: 'Critical', color: 'bg-rose-50 text-rose-700' },
  { value: 'high', label: 'High', color: 'bg-orange-50 text-orange-700' },
  { value: 'medium', label: 'Medium', color: 'bg-amber-50 text-amber-700' },
  { value: 'low', label: 'Low', color: 'bg-emerald-50 text-emerald-700' },
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
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
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
    placeholderData: keepPreviousData,
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
      <PageLoader className="h-64" />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-50 p-2">
              <ListTodo className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
              <p className="text-sm text-slate-600">Total Actions</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.open}</p>
              <p className="text-sm text-slate-600">Open Actions</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-rose-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-rose-50 p-2">
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-rose-600">{stats.overdue}</p>
              <p className="text-sm text-slate-600">Overdue Actions</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.completedThisMonth}</p>
              <p className="text-sm text-slate-600">Completed (Month)</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="w-64">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search actions..."
              size="md"
            />
          </div>
          <MultiSelectDropdown
            title="Status"
            items={ACTION_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
            selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
            onApply={(values) => setStatusFilter(values[0] || 'all')}
            multiSelect={false}
            placeholder="All Statuses"
          />
          <MultiSelectDropdown
            title="Priority"
            items={ACTION_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
            selectedValues={priorityFilter !== 'all' ? [priorityFilter] : []}
            onApply={(values) => setPriorityFilter(values[0] || 'all')}
            multiSelect={false}
            placeholder="All Priorities"
          />
          <MultiSelectDropdown
            title="Type"
            items={ACTION_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            selectedValues={actionTypeFilter !== 'all' ? [actionTypeFilter] : []}
            onApply={(values) => setActionTypeFilter(values[0] || 'all')}
            multiSelect={false}
            placeholder="All Types"
          />
        </div>
        {canCreate && (
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-[#0a0a0a] hover:bg-primary-700"
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
                <th className="w-10 px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filteredActions.map((action: RiskMitigationAction & { riskTitle?: string }) => {
                const typeStyle = ACTION_TYPES.find((t) => t.value === action.action_type);
                const statusStyle = ACTION_STATUSES.find((s) => s.value === action.status);
                const priorityStyle = ACTION_PRIORITIES.find((p) => p.value === action.priority);
                const isOverdue = action.due_date && new Date(action.due_date) < new Date() &&
                  action.status !== 'completed' && action.status !== 'cancelled';
                const isExpanded = expandedRows.has(action.id);

                // Main row stays compact (single-line clamp on the long
                // text columns). The expanded detail is rendered as a
                // separate full-width row beneath, so the long risk
                // description / notes / linked evidence get the full
                // table width instead of stretching one narrow column.
                return (
                  <>
                    <tr
                      key={action.id}
                      className="border-b border-slate-200/50 hover:bg-slate-100/30 cursor-pointer"
                      onClick={(e) => {
                        // Don't toggle when clicking the row's own action
                        // buttons (edit/delete/complete/expand).
                        const target = e.target as HTMLElement;
                        if (target.closest('button') || target.closest('a')) return;
                        toggleExpand(action.id);
                      }}
                    >
                      <td className="px-4 py-3 max-w-xs">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900 text-sm line-clamp-1">{action.title}</span>
                          {action.description && (
                            <span className="text-xs text-slate-500 line-clamp-1">
                              {action.description}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <Link
                          href={`/erm/risks/${action.risk_id}`}
                          className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
                        >
                          <LinkIcon className="h-3 w-3 flex-shrink-0" />
                          <span className="min-w-0 truncate">{action.riskTitle || `Risk #${action.risk_id}`}</span>
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
                          <span className={`text-sm ${isOverdue ? 'text-rose-600 font-medium' : 'text-slate-700'}`}>
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
                              className="rounded p-1.5 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600"
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
                            className="rounded p-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-600"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                      <td className="w-10 px-2 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => toggleExpand(action.id)}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          title={isExpanded ? 'Collapse row' : 'Expand row'}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${action.id}-detail`} className="border-b border-slate-200/70 bg-slate-50/60">
                        <td colSpan={10} className="px-4 py-4">
                          <ExpandedActionDetail action={action} />
                        </td>
                      </tr>
                    )}
                  </>
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


/**
 * Full-width expanded detail panel for a mitigation action row.
 *
 * The collapsed row keeps every column compact (single-line clamps) so the
 * table stays readable even when a risk's title or description is long.
 * When the user expands a row, this component renders **beneath** the row
 * and spans every column, using a 12-column grid so long text and the
 * linked-evidence picker each get sensible width — instead of stretching
 * the original narrow Title cell down the page.
 */
function ExpandedActionDetail({ action }: { action: RiskMitigationAction & { riskTitle?: string } }) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('erm:mitigation_actions:edit');

  // Linked evidence list for this action.
  const { data: linkedEvidence, isLoading: linksLoading } = useQuery({
    queryKey: ['mitigation-action-evidence', action.id],
    queryFn: async () => {
      const res = await ermApi.mitigationActions.getEvidence(action.id);
      return res.data;
    },
  });

  // All tenant evidence (used to populate the search/link dropdown).
  // Lazy: only fired when the row is expanded since that's when this
  // component mounts.
  const { data: allEvidence } = useQuery({
    queryKey: ['evidence-list-for-mitigation-link'],
    queryFn: async () => {
      const res = await evidenceApi.getAll();
      return Array.isArray(res.data) ? (res.data as any[]) : [];
    },
  });

  const [pendingEvidenceId, setPendingEvidenceId] = useState<string>('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const linkedIds = new Set((linkedEvidence || []).map((l) => l.evidence_id));

  const linkMutation = useMutation({
    mutationFn: async (evidenceId: number) =>
      ermApi.mitigationActions.linkEvidence(action.id, { evidence_id: evidenceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mitigation-action-evidence', action.id] });
      setPendingEvidenceId('');
      setLinkError(null);
    },
    onError: (err: any) => {
      setLinkError(err?.response?.data?.detail || 'Failed to link evidence');
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: number) =>
      ermApi.mitigationActions.unlinkEvidence(action.id, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mitigation-action-evidence', action.id] });
    },
  });

  // The dropdown options exclude evidence already linked, so the user
  // can't accidentally pick the same record twice.
  const evidenceOptions = (allEvidence || [])
    .filter((ev: any) => !linkedIds.has(ev.id))
    .map((ev: any) => ({
      value: String(ev.id),
      label: ev.name || ev.title || ev.file_name || `Evidence #${ev.id}`,
      subLabel: ev.evidence_type || ev.status || undefined,
    }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Description / context — left half */}
      <div className="lg:col-span-7 space-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Title</p>
          <p className="text-sm text-slate-900 whitespace-pre-wrap break-words">{action.title}</p>
        </div>
        {action.description && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Description</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{action.description}</p>
          </div>
        )}
        {action.notes && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Notes</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{action.notes}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
          <span>
            <span className="text-slate-500">Risk:</span>{' '}
            <span className="text-slate-800">{action.riskTitle || `#${action.risk_id}`}</span>
          </span>
          <span>
            <span className="text-slate-500">Owner:</span>{' '}
            <span className="text-slate-800">
              {action.owner?.full_name || action.owner?.email || 'Unassigned'}
            </span>
          </span>
          {action.expected_residual_reduction != null && (
            <span>
              <span className="text-slate-500">Expected reduction:</span>{' '}
              <span className="text-slate-800">{action.expected_residual_reduction}%</span>
            </span>
          )}
          {action.actual_residual_reduction != null && (
            <span>
              <span className="text-slate-500">Actual reduction:</span>{' '}
              <span className="text-slate-800">{action.actual_residual_reduction}%</span>
            </span>
          )}
        </div>
      </div>

      {/* Linked evidence — right half. Search/select to link, X to unlink. */}
      <div className="lg:col-span-5">
        <div className="flex items-center gap-2 mb-2">
          <Paperclip className="h-3.5 w-3.5 text-slate-500" />
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Linked Evidence</p>
          <span className="text-xs text-slate-400">({(linkedEvidence || []).length})</span>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <MultiSelectDropdown
                title="Evidence"
                items={evidenceOptions}
                selectedValues={pendingEvidenceId ? [pendingEvidenceId] : []}
                onApply={(v) => setPendingEvidenceId(v[0] || '')}
                multiSelect={false}
                forceSearch
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder={
                  evidenceOptions.length === 0
                    ? 'No evidence available to link'
                    : 'Search & select evidence...'
                }
                searchPlaceholder="Search evidence"
                size="sm"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                if (!pendingEvidenceId) return;
                linkMutation.mutate(Number(pendingEvidenceId));
              }}
              disabled={!pendingEvidenceId || linkMutation.isPending}
              className="flex items-center gap-1 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {linkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <LinkIcon className="h-3 w-3" />}
              Link
            </button>
          </div>
        )}

        {linkError && (
          <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
            {linkError}
          </div>
        )}

        {linksLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" /> loading evidence...
          </div>
        ) : (linkedEvidence || []).length === 0 ? (
          <p className="text-xs italic text-slate-400">No evidence linked to this action yet.</p>
        ) : (
          <ul className="space-y-1">
            {(linkedEvidence || []).map((lnk) => (
              <li
                key={lnk.id}
                className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate text-slate-800">{lnk.title}</p>
                  {(lnk.evidence_type || lnk.status) && (
                    <p className="truncate text-[10px] text-slate-500">
                      {[lnk.evidence_type, lnk.status].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => unlinkMutation.mutate(lnk.id)}
                    disabled={unlinkMutation.isPending}
                    className="flex-shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Unlink evidence"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
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

  // Tenant users for the assignee dropdown. Reuses the same endpoint that
  // every other "assignee" picker in the app now uses (per-tenant DB,
  // includes the current user as a fallback so the list is never empty).
  const [tenantUsers, setTenantUsers] = useState<Array<{ id: number; display_name: string; username?: string; email?: string }>>([]);
  useEffect(() => {
    let active = true;
    criticalTasksApi.getTenantUsers()
      .then((r) => { if (active) setTenantUsers(((r.data as any[]) || []) as any); })
      .catch(() => { if (active) setTenantUsers([]); });
    return () => { active = false; };
  }, []);

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
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={action ? 'Edit Mitigation Action' : 'Create Mitigation Action'}
    >
      <form id="mitigation-action-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Risk *</label>
          {action ? (
            <input
              type="text"
              value={risks.find((r) => r.id === formData.risk_id)?.title || `Risk #${formData.risk_id}`}
              disabled
              className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700"
            />
          ) : (
            <MultiSelectDropdown
              title="Risk"
              items={risks.map((risk) => ({
                value: String(risk.id),
                label: risk.title,
                subLabel: risk.risk_category,
              }))}
              selectedValues={formData.risk_id ? [String(formData.risk_id)] : []}
              onApply={(values) => setFormData({ ...formData, risk_id: values[0] ? Number(values[0]) : 0 })}
              multiSelect={false}
              triggerVariant="input"
              triggerClassName="w-full"
              forceSearch
              searchPlaceholder="Search risk by title..."
              placeholder="Select Risk"
              size="md"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              required
            />
            {!action && (
              <button
                type="button"
                onClick={handleAiSuggest}
                disabled={aiLoading || (!formData.risk_id && !formData.title)}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                AI Suggest
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            rows={2}
          />
        </div>

        {aiError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Action Type</label>
            <MultiSelectDropdown
              title="Action Type"
              items={ACTION_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              selectedValues={formData.action_type ? [formData.action_type] : []}
              onApply={(values) => setFormData({ ...formData, action_type: (values[0] as ActionType) || 'mitigate' })}
              multiSelect={false}
              triggerVariant="input"
              triggerClassName="w-full"
              placeholder="Select Action Type"
              size="md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
            <MultiSelectDropdown
              title="Priority"
              items={ACTION_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
              selectedValues={formData.priority ? [formData.priority] : []}
              onApply={(values) => setFormData({ ...formData, priority: (values[0] as ActionPriority) || 'medium' })}
              multiSelect={false}
              triggerVariant="input"
              triggerClassName="w-full"
              placeholder="Select Priority"
              size="md"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <MultiSelectDropdown
              title="Status"
              items={ACTION_STATUSES.filter(s => s.value !== 'overdue').map((s) => ({ value: s.value, label: s.label }))}
              selectedValues={formData.status ? [formData.status] : []}
              onApply={(values) => setFormData({ ...formData, status: (values[0] as ActionStatus) || 'open' })}
              multiSelect={false}
              triggerVariant="input"
              triggerClassName="w-full"
              placeholder="Select Status"
              size="md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
            <input
              type="date"
              value={formData.due_date || ''}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1">
              <UserCircle2 className="h-3.5 w-3.5 text-slate-500" />
              Assignee
            </label>
            <MultiSelectDropdown
              title="Assignee"
              items={tenantUsers.map((u) => ({
                value: String(u.id),
                label: u.display_name || u.username || u.email || `User #${u.id}`,
                subLabel: u.email,
              }))}
              selectedValues={formData.owner_id ? [String(formData.owner_id)] : []}
              onApply={(values) =>
                setFormData({
                  ...formData,
                  owner_id: values[0] ? Number(values[0]) : undefined,
                })
              }
              multiSelect={false}
              forceSearch
              triggerVariant="input"
              triggerClassName="w-full"
              placeholder="Unassigned"
              searchPlaceholder="Search users"
              size="md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Expected Residual Reduction (%)</label>
            <input
              type="number"
              min="0"
              max="100"
              value={formData.expected_residual_reduction || ''}
              onChange={(e) => setFormData({
                ...formData,
                expected_residual_reduction: e.target.value ? Number(e.target.value) : undefined
              })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="e.g., 25"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="mitigation-action-form"
            disabled={isLoading}
            className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              action ? 'Update' : 'Create'
            )}
          </button>
        </div>
      </form>
    </RightSlidePanel>
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
    <RightSlidePanel
      isOpen
      onClose={onClose}
      width="w-full max-w-md"
      title="Complete Action"
      subtitle={action.title}
    >
      <form id="complete-action-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Actual Residual Reduction Achieved (%)</label>
          <div className="mb-2 text-xs text-slate-500">
            Expected: {action.expected_residual_reduction ?? '—'}%
          </div>
          <input
            type="number"
            min="0"
            max="100"
            value={actualReduction}
            onChange={(e) => setActualReduction(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="complete-action-form"
            disabled={completeMutation.isPending}
            className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {completeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Mark Complete'
            )}
          </button>
        </div>
      </form>
    </RightSlidePanel>
  );
}
