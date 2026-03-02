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

const COMMITTEE_TYPE_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  board: { label: 'Board', bg: 'rgba(28, 43, 58, 0.06)', color: 'var(--color-base)' },
  risk_committee: { label: 'Risk Committee', bg: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)' },
  audit_committee: { label: 'Audit Committee', bg: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' },
  compliance_committee: { label: 'Compliance Committee', bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' },
  it_steering: { label: 'IT Steering', bg: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' },
  custom: { label: 'Custom', bg: 'var(--color-subtle)', color: 'var(--color-muted)' },
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
      const response = await committeeApi.getDashboard();
      return response.data as DashboardData;
    },
  });

  const { data: committees, isLoading: committeesLoading, error: committeesError } = useQuery({
    queryKey: ['committees', typeFilter],
    queryFn: async () => {
      const response = await committeeApi.getCommittees();
      const data = response.data as { items: Committee[]; total: number };
      return data.items || [];
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
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>Board & Committee Management</h1>
            <p className="mt-1" style={{ color: 'var(--color-muted)' }}>Manage committees, meetings, and oversight actions</p>
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
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Users className="h-6 w-6" style={{ color: 'var(--color-base)' }} />
            </div>
            <div>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{dashboard?.total_committees || 0}</p>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Total Committees</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Calendar className="h-6 w-6" style={{ color: 'var(--color-base)' }} />
            </div>
            <div>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{dashboard?.upcoming_meetings || 0}</p>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Upcoming Meetings</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(146, 87, 14, 0.1)' }}>
              <CheckSquare className="h-6 w-6" style={{ color: 'var(--color-warning)' }} />
            </div>
            <div>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{dashboard?.open_actions || 0}</p>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Open Actions</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)' }}>
              <AlertCircle className="h-6 w-6" style={{ color: 'var(--color-danger)' }} />
            </div>
            <div>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{dashboard?.overdue_actions || 0}</p>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Overdue Actions</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5" style={{ color: 'var(--color-muted)' }} />
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
          {Object.entries(COMMITTEE_TYPE_STYLES).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCommittees.map((committee) => {
          const typeStyle = COMMITTEE_TYPE_STYLES[committee.committee_type] || COMMITTEE_TYPE_STYLES.custom;

          return (
            <div key={committee.id} className="card p-6 hover:border-primary-500/50 transition-all">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
                    <Users className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
                  </div>
                  <div>
                    <h3 className="font-medium" style={{ color: 'var(--color-text)' }}>{committee.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: typeStyle.bg, color: typeStyle.color }}>
                      {typeStyle.label}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(committee.id)}
                  className="p-1.5 transition-colors"
                  style={{ color: 'var(--color-muted)' }}
                  title="Delete committee"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <p className="text-sm mb-4 line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                {committee.description || 'No description provided'}
              </p>

              <div className="space-y-2 mb-4 text-sm">
                {committee.chair_name && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--color-muted)' }}>Chair:</span>
                    <span style={{ color: 'var(--color-text)' }}>{committee.chair_name}</span>
                  </div>
                )}
                {committee.secretary_name && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--color-muted)' }}>Secretary:</span>
                    <span style={{ color: 'var(--color-text)' }}>{committee.secretary_name}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--color-muted)' }}>Members:</span>
                  <span style={{ color: 'var(--color-text)' }}>{committee.member_count}</span>
                </div>
                {committee.meeting_frequency && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--color-muted)' }}>Meeting Frequency:</span>
                    <span className="capitalize" style={{ color: 'var(--color-text)' }}>{committee.meeting_frequency.replace('_', ' ')}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
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
          <Users className="h-12 w-12 mx-auto mb-4" style={{ color: 'var(--color-muted)' }} />
          <p style={{ color: 'var(--color-muted)' }}>No committees found</p>
          <button onClick={() => setIsModalOpen(true)} className="btn-primary mt-4 inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create First Committee
          </button>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-xl p-6 w-full max-w-lg mx-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Create New Committee</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ color: 'var(--color-muted)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Committee Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input w-full"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Committee Type *</label>
                <select
                  value={formData.committee_type}
                  onChange={(e) => setFormData({ ...formData, committee_type: e.target.value })}
                  className="input w-full"
                  required
                >
                  {Object.entries(COMMITTEE_TYPE_STYLES).map(([value, { label }]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Chair ID</label>
                  <input
                    type="number"
                    value={formData.chair_id}
                    onChange={(e) => setFormData({ ...formData, chair_id: e.target.value })}
                    className="input w-full"
                    placeholder="User ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Secretary ID</label>
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
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Meeting Frequency</label>
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
