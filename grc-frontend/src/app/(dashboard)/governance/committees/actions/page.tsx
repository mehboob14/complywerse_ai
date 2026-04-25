'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { committeeApi } from '@/lib/api';
import {
  CheckSquare,
  AlertCircle,
  Clock,
  CheckCircle,
  ArrowLeft,
  Calendar,
  Users,
  Building2,
  Plus,
  Sparkles,
  Upload,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { SearchInput } from '@/components/ui/SearchInput';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';

interface Action {
  id: number;
  committee_id: number;
  committee_name: string;
  meeting_id?: number;
  meeting_title?: string;
  title: string;
  description?: string;
  action_type: 'follow_up' | 'policy_approval' | 'risk_review' | 'audit_response';
  status: 'open' | 'in_progress' | 'completed' | 'overdue';
  due_date: string;
  assigned_to_id?: number;
  assigned_to_name?: string;
  created_at: string;
  updated_at: string;
}

interface Committee {
  id: number;
  name: string;
}

interface CommitteeMeeting {
  id: number;
  title: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  open: { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: Clock },
  in_progress: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: Clock },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: CheckCircle },
  overdue: { bg: 'bg-rose-500/20', text: 'text-rose-400', icon: AlertCircle },
};

const ACTION_TYPE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  follow_up: { label: 'Follow Up', bg: 'bg-slate-500/20', text: 'text-slate-400' },
  policy_approval: { label: 'Policy Approval', bg: 'bg-blue-500/20', text: 'text-blue-400' },
  risk_review: { label: 'Risk Review', bg: 'bg-rose-500/20', text: 'text-rose-400' },
  audit_response: { label: 'Audit Response', bg: 'bg-purple-500/20', text: 'text-purple-400' },
};

export default function ActionsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [committeeFilter, setCommitteeFilter] = useState<string>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    committee_id: '',
    meeting_id: '',
    title: '',
    description: '',
    action_type: 'follow_up',
    due_date: '',
  });
  const [aiFile, setAiFile] = useState<File | null>(null);
  const queryClient = useQueryClient();

  const { data: committees } = useQuery({
    queryKey: ['committees-list'],
    queryFn: async () => {
      try {
        const response = await committeeApi.getCommittees();
        return response.data as Committee[];
      } catch {
        return [
          { id: 1, name: 'Board of Directors' },
          { id: 2, name: 'Risk Management Committee' },
          { id: 3, name: 'Audit Committee' },
          { id: 4, name: 'Compliance Committee' },
          { id: 5, name: 'IT Steering Committee' },
        ] as Committee[];
      }
    },
  });

  const { data: actions, isLoading } = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['all-actions', statusFilter, committeeFilter, overdueOnly],
    queryFn: async () => {
      try {
        const response = await committeeApi.getActions({
          status: statusFilter || undefined,
          committee_id: committeeFilter ? parseInt(committeeFilter) : undefined,
          overdue_only: overdueOnly || undefined,
        });
        const payload = response.data as unknown;
        const rawItems = Array.isArray(payload)
          ? payload
          : (((payload as { items?: unknown[] })?.items || []) as unknown[]);

        return rawItems.map((item: any) => ({
          ...item,
          assigned_to_name: item.assigned_to_name || item.assignee_name || '',
        })) as Action[];
      } catch {
        return [
          { id: 1, committee_id: 2, committee_name: 'Risk Management Committee', meeting_id: 2, meeting_title: 'January Risk Update', title: 'Update Risk Register for Q1', description: 'Review and update the enterprise risk register', action_type: 'risk_review', status: 'in_progress', due_date: '2025-02-01', assigned_to_name: 'David Lee', created_at: '2025-01-20', updated_at: '2025-01-22' },
          { id: 2, committee_id: 2, committee_name: 'Risk Management Committee', meeting_id: 2, meeting_title: 'January Risk Update', title: 'Review Cyber Insurance Policy', description: 'Evaluate current cyber insurance coverage', action_type: 'policy_approval', status: 'open', due_date: '2025-02-15', assigned_to_name: 'Emily Brown', created_at: '2025-01-20', updated_at: '2025-01-20' },
          { id: 3, committee_id: 2, committee_name: 'Risk Management Committee', meeting_id: 3, meeting_title: 'Emergency Cyber Incident Review', title: 'Incident Response Improvement Plan', description: 'Develop improvement plan based on incident review', action_type: 'follow_up', status: 'overdue', due_date: '2025-01-25', assigned_to_name: 'Robert Johnson', created_at: '2025-01-10', updated_at: '2025-01-15' },
          { id: 4, committee_id: 3, committee_name: 'Audit Committee', meeting_id: 5, meeting_title: 'Q4 Audit Review', title: 'Address Internal Audit Finding #12', description: 'Remediate control weakness identified in audit', action_type: 'audit_response', status: 'in_progress', due_date: '2025-02-28', assigned_to_name: 'Sarah Wilson', created_at: '2025-01-05', updated_at: '2025-01-18' },
          { id: 5, committee_id: 4, committee_name: 'Compliance Committee', meeting_id: 8, meeting_title: 'Regulatory Update Meeting', title: 'Update Compliance Training Materials', description: 'Incorporate new regulatory requirements', action_type: 'follow_up', status: 'open', due_date: '2025-03-01', assigned_to_name: 'Michael Chen', created_at: '2025-01-15', updated_at: '2025-01-15' },
          { id: 6, committee_id: 1, committee_name: 'Board of Directors', meeting_id: 10, meeting_title: 'Board Strategy Session', title: 'Review Executive Compensation Policy', description: 'Annual review of compensation structure', action_type: 'policy_approval', status: 'open', due_date: '2025-02-20', assigned_to_name: 'HR Director', created_at: '2025-01-10', updated_at: '2025-01-10' },
          { id: 7, committee_id: 5, committee_name: 'IT Steering Committee', meeting_id: 12, meeting_title: 'Technology Roadmap Review', title: 'Evaluate Cloud Migration Progress', description: 'Assess Phase 2 cloud migration milestones', action_type: 'risk_review', status: 'completed', due_date: '2025-01-20', assigned_to_name: 'CTO', created_at: '2025-01-05', updated_at: '2025-01-20' },
        ] as Action[];
      }
    },
  });

  const { data: meetings = [], isLoading: isMeetingsLoading } = useQuery({
    queryKey: ['committee-meetings-for-actions', createFormData.committee_id],
    enabled: !!createFormData.committee_id,
    queryFn: async () => {
      const response = await committeeApi.getMeetings(parseInt(createFormData.committee_id, 10));
      const payload = response.data as any;
      const items = Array.isArray(payload) ? payload : payload.items || [];
      return items.map((m: any) => ({ id: m.id, title: m.title })) as CommitteeMeeting[];
    },
  });

  const updateActionMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { status: string } }) => committeeApi.updateAction(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-actions'] });
    },
  });

  const createActionMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createManualAction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-actions'] });
      setIsCreateModalOpen(false);
      setCreateFormData({
        committee_id: '',
        meeting_id: '',
        title: '',
        description: '',
        action_type: 'follow_up',
        due_date: '',
      });
      setAiFile(null);
    },
  });

  const aiRewordMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (createFormData.description.trim()) {
        formData.append('text', createFormData.description.trim());
      }
      if (aiFile) {
        formData.append('file', aiFile);
      }
      formData.append('tone', 'professional');
      const response = await committeeApi.aiRewordActionText(formData);
      return response.data as { text: string };
    },
    onSuccess: (result) => {
      setCreateFormData((prev) => ({ ...prev, description: result.text || prev.description }));
    },
  });

  const aiSummaryMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (createFormData.description.trim()) {
        formData.append('text', createFormData.description.trim());
      }
      if (aiFile) {
        formData.append('file', aiFile);
      }
      const response = await committeeApi.aiSummarizeActionText(formData);
      return response.data as { text: string };
    },
    onSuccess: (result) => {
      setCreateFormData((prev) => ({
        ...prev,
        description: result.text || prev.description,
      }));
    },
  });

  const handleCreateManualAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createFormData.committee_id || !createFormData.title.trim()) return;

    const payload: Record<string, unknown> = {
      committee_id: parseInt(createFormData.committee_id, 10),
      title: createFormData.title.trim(),
      action_type: createFormData.action_type,
    };

    if (createFormData.meeting_id) payload.meeting_id = parseInt(createFormData.meeting_id, 10);
    if (createFormData.description.trim()) payload.description = createFormData.description.trim();
    if (createFormData.due_date) payload.due_date = createFormData.due_date;

    createActionMutation.mutate(payload);
  };

  const filteredActions = (actions || []).filter(action => {
    const matchesSearch = action.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (action.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (action.assigned_to_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const openCount = (actions || []).filter(a => a.status === 'open').length;
  const inProgressCount = (actions || []).filter(a => a.status === 'in_progress').length;
  const overdueCount = (actions || []).filter(a => a.status === 'overdue').length;
  const completedCount = (actions || []).filter(a => a.status === 'completed').length;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-48 mb-2" />
          <div className="skeleton h-5 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card p-6">
              <div className="skeleton h-6 w-3/4 mb-2" />
              <div className="skeleton h-4 w-full mb-4" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const statusItems = [
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'overdue', label: 'Overdue' },
  ];
  const committeeItems = useMemo(
    () => (committees || []).map((c) => ({ value: String(c.id), label: c.name })),
    [committees],
  );
  const actionTypeItems = [
    { value: 'follow_up', label: 'Follow Up' },
    { value: 'policy_approval', label: 'Policy Approval' },
    { value: 'risk_review', label: 'Risk Review' },
    { value: 'audit_response', label: 'Audit Response' },
  ];
  const meetingItems = useMemo(
    () => meetings.map((m) => ({ value: String(m.id), label: m.title })),
    [meetings],
  );

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="page-header">
        <div>
          <Link href="/governance/committees" className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back to Committees
          </Link>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Oversight Actions</h1>
          <p className="text-slate-600 mt-1">Track and manage actions across all committees</p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="mt-4 sm:mt-0 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          Add Manual Action
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20">
              <Clock className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{openCount}</p>
              <p className="text-sm text-slate-600">Open</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20">
              <Clock className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{inProgressCount}</p>
              <p className="text-sm text-slate-600">In Progress</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/20">
              <AlertCircle className="h-6 w-6 text-rose-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{overdueCount}</p>
              <p className="text-sm text-slate-600">Overdue</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
              <CheckCircle className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{completedCount}</p>
              <p className="text-sm text-slate-600">Completed</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-md">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search actions..."
            size="md"
          />
        </div>
        <MultiSelectDropdown
          title="Status"
          items={statusItems}
          selectedValues={statusFilter ? [statusFilter] : []}
          onApply={(values) => setStatusFilter(values[0] || '')}
          multiSelect={false}
        />
        <MultiSelectDropdown
          title="Committee"
          items={committeeItems}
          selectedValues={committeeFilter ? [committeeFilter] : []}
          onApply={(values) => setCommitteeFilter(values[0] || '')}
          multiSelect={false}
        />
        <label className="flex items-center gap-2 text-slate-700 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
            className="rounded border-slate-300 bg-white text-primary-500 focus:ring-primary-500"
          />
          Overdue Only
        </label>
      </div>

      <div className="space-y-4">
        {filteredActions.map((action) => {
          const statusStyle = STATUS_COLORS[action.status] || STATUS_COLORS.open;
          const StatusIcon = statusStyle.icon;
          const typeStyle = ACTION_TYPE_LABELS[action.action_type] || ACTION_TYPE_LABELS.follow_up;
          const isOverdue = action.status === 'overdue';

          return (
            <div key={action.id} className={`card p-6 ${isOverdue ? 'border-rose-500/30' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-slate-900 font-medium">{action.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                      <StatusIcon className="h-3 w-3" />
                      {action.status.replace('_', ' ')}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${typeStyle.bg} ${typeStyle.text}`}>
                      {typeStyle.label}
                    </span>
                  </div>
                  {action.description && (
                    <p className="text-slate-600 text-sm mb-3">{action.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <Building2 className="h-4 w-4" />
                      {action.committee_name}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4" />
                      Due: {new Date(action.due_date).toLocaleDateString()}
                    </span>
                    {action.assigned_to_name && (
                      <span className="flex items-center gap-1.5">
                        <Users className="h-4 w-4" />
                        {action.assigned_to_name}
                      </span>
                    )}
                    {action.meeting_title && (
                      <span className="text-slate-600">
                        From: {action.meeting_title}
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-4">
                  <MultiSelectDropdown
                    title="Status"
                    items={[
                      { value: 'open', label: 'Open' },
                      { value: 'in_progress', label: 'In Progress' },
                      { value: 'completed', label: 'Completed' },
                    ]}
                    selectedValues={[action.status]}
                    onApply={(values) => {
                      const next = values[0];
                      if (next && next !== action.status) {
                        updateActionMutation.mutate({ id: action.id, data: { status: next } });
                      }
                    }}
                    multiSelect={false}
                    triggerVariant="input"
                    showSelectionInTrigger
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredActions.length === 0 && (
        <div className="text-center py-12">
          <CheckSquare className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <p className="text-slate-400">No actions found</p>
        </div>
      )}

      <RightSlidePanel
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Add Manual Action Item"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-action-form"
              disabled={createActionMutation.isPending || !createFormData.committee_id || !createFormData.title.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {createActionMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Action
            </button>
          </div>
        }
      >
        <form id="create-action-form" onSubmit={handleCreateManualAction} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Committee *</label>
              <MultiSelectDropdown
                title="Committee"
                items={committeeItems}
                selectedValues={createFormData.committee_id ? [createFormData.committee_id] : []}
                onApply={(values) =>
                  setCreateFormData((prev) => ({
                    ...prev,
                    committee_id: values[0] || '',
                    meeting_id: '',
                  }))
                }
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select committee"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Meeting (Optional)</label>
              <MultiSelectDropdown
                title="Meeting"
                items={meetingItems}
                selectedValues={createFormData.meeting_id ? [createFormData.meeting_id] : []}
                onApply={(values) =>
                  setCreateFormData((prev) => ({ ...prev, meeting_id: values[0] || '' }))
                }
                multiSelect={false}
                triggerVariant="input"
                placeholder={
                  !createFormData.committee_id
                    ? 'Select committee first'
                    : isMeetingsLoading
                      ? 'Loading meetings...'
                      : 'No linked meeting'
                }
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Title *</label>
            <input
              type="text"
              value={createFormData.title}
              onChange={(e) => setCreateFormData((prev) => ({ ...prev, title: e.target.value }))}
              className="input w-full"
              placeholder="Action item title"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Action Type</label>
              <MultiSelectDropdown
                title="Action Type"
                items={actionTypeItems}
                selectedValues={[createFormData.action_type]}
                onApply={(values) =>
                  setCreateFormData((prev) => ({ ...prev, action_type: values[0] || 'follow_up' }))
                }
                multiSelect={false}
                triggerVariant="input"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Due Date</label>
              <input
                type="date"
                value={createFormData.due_date}
                onChange={(e) => setCreateFormData((prev) => ({ ...prev, due_date: e.target.value }))}
                className="input w-full"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
            <textarea
              value={createFormData.description}
              onChange={(e) => setCreateFormData((prev) => ({ ...prev, description: e.target.value }))}
              className="input w-full h-28"
              placeholder="Describe the action item"
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="mb-2 text-sm font-medium text-slate-800">AI Assistant</p>
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">Upload reference file (optional)</label>
              <input
                type="file"
                onChange={(e) => setAiFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                accept=".txt,.md,.csv,.json,.pdf,.doc,.docx"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => aiRewordMutation.mutate()}
                disabled={aiRewordMutation.isPending || (!createFormData.description.trim() && !aiFile)}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              >
                {aiRewordMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                AI Reword
              </button>
              <button
                type="button"
                onClick={() => aiSummaryMutation.mutate()}
                disabled={aiSummaryMutation.isPending || (!createFormData.description.trim() && !aiFile)}
                className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {aiSummaryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Generate Summary
              </button>
            </div>
          </div>

          {createActionMutation.isError && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-600">
              Failed to create action item. Please check required fields and try again.
            </div>
          )}
        </form>
      </RightSlidePanel>
    </div>
  );
}
