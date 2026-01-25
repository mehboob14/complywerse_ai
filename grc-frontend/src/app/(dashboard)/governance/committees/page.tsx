'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { committeeApi } from '@/lib/api';
import {
  Users,
  Plus,
  Search,
  Eye,
  Calendar,
  CheckSquare,
  AlertCircle,
  Clock,
  FileText,
  Building2,
  X,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';

interface Committee {
  id: number;
  name: string;
  description?: string;
  committee_type: string;
  chair_id?: number;
  chair_name?: string;
  secretary_id?: number;
  secretary_name?: string;
  meeting_frequency?: string;
  member_count: number;
  created_at: string;
  updated_at: string;
}

interface DashboardData {
  total_committees: number;
  upcoming_meetings: number;
  open_actions: number;
  overdue_actions: number;
}

const COMMITTEE_TYPE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  board: { label: 'Board', bg: 'bg-purple-500/20', text: 'text-purple-400' },
  risk_committee: { label: 'Risk Committee', bg: 'bg-rose-500/20', text: 'text-rose-400' },
  audit_committee: { label: 'Audit Committee', bg: 'bg-blue-500/20', text: 'text-blue-400' },
  compliance_committee: { label: 'Compliance Committee', bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  it_steering: { label: 'IT Steering', bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  custom: { label: 'Custom', bg: 'bg-slate-500/20', text: 'text-slate-400' },
};

const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'as_needed', label: 'As Needed' },
];

export default function CommitteesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    committee_type: 'custom',
    chair_id: '',
    secretary_id: '',
    meeting_frequency: 'monthly',
  });
  const queryClient = useQueryClient();

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['committee-dashboard'],
    queryFn: async () => {
      try {
        const response = await committeeApi.getDashboard();
        return response.data as DashboardData;
      } catch {
        return {
          total_committees: 6,
          upcoming_meetings: 4,
          open_actions: 12,
          overdue_actions: 2,
        } as DashboardData;
      }
    },
  });

  const { data: committees, isLoading: committeesLoading } = useQuery({
    queryKey: ['committees', typeFilter],
    queryFn: async () => {
      try {
        const response = await committeeApi.getCommittees();
        return response.data as Committee[];
      } catch {
        return [
          { id: 1, name: 'Board of Directors', description: 'Main governing body', committee_type: 'board', chair_name: 'John Smith', secretary_name: 'Jane Doe', meeting_frequency: 'quarterly', member_count: 9, created_at: '2024-01-01', updated_at: '2025-01-15' },
          { id: 2, name: 'Risk Management Committee', description: 'Oversees enterprise risk management', committee_type: 'risk_committee', chair_name: 'Michael Chen', secretary_name: 'Sarah Wilson', meeting_frequency: 'monthly', member_count: 7, created_at: '2024-01-15', updated_at: '2025-01-18' },
          { id: 3, name: 'Audit Committee', description: 'Reviews financial statements and internal controls', committee_type: 'audit_committee', chair_name: 'Emily Brown', secretary_name: 'David Lee', meeting_frequency: 'quarterly', member_count: 5, created_at: '2024-02-01', updated_at: '2025-01-10' },
          { id: 4, name: 'Compliance Committee', description: 'Ensures regulatory compliance', committee_type: 'compliance_committee', chair_name: 'Robert Johnson', meeting_frequency: 'monthly', member_count: 6, created_at: '2024-03-01', updated_at: '2025-01-20' },
          { id: 5, name: 'IT Steering Committee', description: 'Oversees technology initiatives', committee_type: 'it_steering', chair_name: 'Lisa Wang', meeting_frequency: 'bi-weekly', member_count: 8, created_at: '2024-04-01', updated_at: '2025-01-22' },
        ] as Committee[];
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createCommittee(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committees'] });
      queryClient.invalidateQueries({ queryKey: ['committee-dashboard'] });
      setIsModalOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => committeeApi.deleteCommittee(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committees'] });
      queryClient.invalidateQueries({ queryKey: ['committee-dashboard'] });
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      committee_type: 'custom',
      chair_id: '',
      secretary_id: '',
      meeting_frequency: 'monthly',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      ...formData,
      chair_id: formData.chair_id ? parseInt(formData.chair_id) : null,
      secretary_id: formData.secretary_id ? parseInt(formData.secretary_id) : null,
    });
  };

  const filteredCommittees = (committees || []).filter(committee => {
    const matchesSearch = committee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (committee.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = !typeFilter || committee.committee_type === typeFilter;
    return matchesSearch && matchesType;
  });

  const isLoading = dashboardLoading || committeesLoading;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-48 mb-2" />
          <div className="skeleton h-5 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card p-6">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-16 mb-1" />
              <div className="skeleton h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Board & Committee Management</h1>
            <p className="text-slate-400 mt-1">Manage committees, meetings, and oversight actions</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/governance/committees/actions" className="btn-secondary flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              View All Actions
            </Link>
            <button onClick={() => setIsModalOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" />
              New Committee
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-500/20">
              <Users className="h-6 w-6 text-primary-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{dashboard?.total_committees || 0}</p>
              <p className="text-sm text-slate-400">Total Committees</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/20">
              <Calendar className="h-6 w-6 text-cyan-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{dashboard?.upcoming_meetings || 0}</p>
              <p className="text-sm text-slate-400">Upcoming Meetings</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20">
              <CheckSquare className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{dashboard?.open_actions || 0}</p>
              <p className="text-sm text-slate-400">Open Actions</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/20">
              <AlertCircle className="h-6 w-6 text-rose-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{dashboard?.overdue_actions || 0}</p>
              <p className="text-sm text-slate-400">Overdue Actions</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search committees..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-10 w-full"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="input"
        >
          <option value="">All Types</option>
          {Object.entries(COMMITTEE_TYPE_LABELS).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCommittees.map((committee) => {
          const typeStyle = COMMITTEE_TYPE_LABELS[committee.committee_type] || COMMITTEE_TYPE_LABELS.custom;

          return (
            <div key={committee.id} className="card p-6 hover:border-primary-500/50 transition-all">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/20">
                    <Users className="h-5 w-5 text-primary-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{committee.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${typeStyle.bg} ${typeStyle.text}`}>
                      {typeStyle.label}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(committee.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                  title="Delete committee"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <p className="text-slate-400 text-sm mb-4 line-clamp-2">
                {committee.description || 'No description provided'}
              </p>

              <div className="space-y-2 mb-4 text-sm">
                {committee.chair_name && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Chair:</span>
                    <span className="text-slate-300">{committee.chair_name}</span>
                  </div>
                )}
                {committee.secretary_name && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Secretary:</span>
                    <span className="text-slate-300">{committee.secretary_name}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Members:</span>
                  <span className="text-slate-300">{committee.member_count}</span>
                </div>
                {committee.meeting_frequency && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Meeting Frequency:</span>
                    <span className="text-slate-300 capitalize">{committee.meeting_frequency.replace('_', ' ')}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-slate-700">
                <Link
                  href={`/governance/committees/${committee.id}`}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
                >
                  <Eye className="h-4 w-4" />
                  View Details
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {filteredCommittees.length === 0 && (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <p className="text-slate-400">No committees found</p>
          <button onClick={() => setIsModalOpen(true)} className="btn-primary mt-4 inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create First Committee
          </button>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-lg mx-4 border border-slate-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Create New Committee</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Committee Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input w-full"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Committee Type *</label>
                <select
                  value={formData.committee_type}
                  onChange={(e) => setFormData({ ...formData, committee_type: e.target.value })}
                  className="input w-full"
                  required
                >
                  {Object.entries(COMMITTEE_TYPE_LABELS).map(([value, { label }]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Chair ID</label>
                  <input
                    type="number"
                    value={formData.chair_id}
                    onChange={(e) => setFormData({ ...formData, chair_id: e.target.value })}
                    className="input w-full"
                    placeholder="User ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Secretary ID</label>
                  <input
                    type="number"
                    value={formData.secretary_id}
                    onChange={(e) => setFormData({ ...formData, secretary_id: e.target.value })}
                    className="input w-full"
                    placeholder="User ID"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Meeting Frequency</label>
                <select
                  value={formData.meeting_frequency}
                  onChange={(e) => setFormData({ ...formData, meeting_frequency: e.target.value })}
                  className="input w-full"
                >
                  {FREQUENCY_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="btn-primary"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Committee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
