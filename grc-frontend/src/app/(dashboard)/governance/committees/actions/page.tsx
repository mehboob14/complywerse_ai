'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { committeeApi } from '@/lib/api';
import {
  CheckSquare,
  Search,
  Filter,
  AlertCircle,
  Clock,
  CheckCircle,
  ArrowLeft,
  Calendar,
  Users,
  Building2,
} from 'lucide-react';
import Link from 'next/link';

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
    queryKey: ['all-actions', statusFilter, committeeFilter, overdueOnly],
    queryFn: async () => {
      try {
        const response = await committeeApi.getActions({
          status: statusFilter || undefined,
          committee_id: committeeFilter ? parseInt(committeeFilter) : undefined,
          overdue_only: overdueOnly || undefined,
        });
        return response.data as Action[];
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

  const updateActionMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { status: string } }) => committeeApi.updateAction(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-actions'] });
    },
  });

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

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <Link href="/governance/committees" className="flex items-center gap-2 text-slate-400 hover:text-white mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back to Committees
          </Link>
          <h1 className="text-2xl font-semibold text-white">Oversight Actions</h1>
          <p className="text-slate-400 mt-1">Track and manage actions across all committees</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20">
              <Clock className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{openCount}</p>
              <p className="text-sm text-slate-400">Open</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20">
              <Clock className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{inProgressCount}</p>
              <p className="text-sm text-slate-400">In Progress</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/20">
              <AlertCircle className="h-6 w-6 text-rose-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{overdueCount}</p>
              <p className="text-sm text-slate-400">Overdue</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
              <CheckCircle className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{completedCount}</p>
              <p className="text-sm text-slate-400">Completed</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search actions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-10 w-full"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input"
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>
        <select
          value={committeeFilter}
          onChange={(e) => setCommitteeFilter(e.target.value)}
          className="input"
        >
          <option value="">All Committees</option>
          {(committees || []).map((committee) => (
            <option key={committee.id} value={committee.id}>{committee.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-slate-400 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
            className="rounded border-slate-600 bg-slate-700 text-primary-500 focus:ring-primary-500"
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
                    <h3 className="text-white font-medium">{action.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                      <StatusIcon className="h-3 w-3" />
                      {action.status.replace('_', ' ')}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${typeStyle.bg} ${typeStyle.text}`}>
                      {typeStyle.label}
                    </span>
                  </div>
                  {action.description && (
                    <p className="text-slate-400 text-sm mb-3">{action.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
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
                      <span className="text-slate-500">
                        From: {action.meeting_title}
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-4">
                  <select
                    value={action.status}
                    onChange={(e) => updateActionMutation.mutate({ id: action.id, data: { status: e.target.value } })}
                    className="input text-sm"
                    disabled={updateActionMutation.isPending}
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
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
    </div>
  );
}
