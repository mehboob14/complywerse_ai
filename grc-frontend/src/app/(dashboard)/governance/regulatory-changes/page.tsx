'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { regulatoryApi } from '@/lib/api';
import {
  FileWarning,
  Plus,
  Search,
  Eye,
  Trash2,
  X,
  AlertTriangle,
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  Building2,
  BarChart3,
  Filter,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';

interface RegulatoryChange {
  id: number;
  title: string;
  description?: string;
  source: string;
  regulatory_body?: string;
  reference_number?: string;
  effective_date?: string;
  publication_date?: string;
  status: string;
  priority: string;
  impact_summary?: string;
  gap_count?: number;
  created_at: string;
  updated_at?: string;
}

interface Dashboard {
  total_changes: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_source: Record<string, number>;
  gaps_identified: number;
  changes_this_month: number;
  pending_assessments: number;
}

const SOURCE_OPTIONS = [
  { value: '', label: 'All Sources' },
  { value: 'OCC', label: 'OCC' },
  { value: 'Fed', label: 'Fed' },
  { value: 'EBA', label: 'EBA' },
  { value: 'PRA', label: 'PRA' },
  { value: 'SEC', label: 'SEC' },
  { value: 'FINRA', label: 'FINRA' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'identified', label: 'Identified' },
  { value: 'under_assessment', label: 'Under Assessment' },
  { value: 'implementation', label: 'Implementation' },
  { value: 'completed', label: 'Completed' },
  { value: 'not_applicable', label: 'Not Applicable' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  identified: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: FileText },
  under_assessment: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: Clock },
  implementation: { bg: 'bg-purple-500/20', text: 'text-purple-400', icon: AlertCircle },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: CheckCircle },
  not_applicable: { bg: 'bg-slate-500/20', text: 'text-gray-600', icon: FileText },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-500/20', text: 'text-red-400' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  low: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] || STATUS_STYLES.identified;
}

function getPriorityStyle(priority: string) {
  return PRIORITY_STYLES[priority?.toLowerCase()] || PRIORITY_STYLES.medium;
}

export default function RegulatoryChangesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    source: 'OCC',
    regulatory_body: '',
    reference_number: '',
    effective_date: '',
    publication_date: '',
    priority: 'medium',
    impact_summary: '',
  });
  const queryClient = useQueryClient();

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['regulatory-dashboard'],
    queryFn: async () => {
      try {
        const response = await regulatoryApi.getDashboard();
        return response.data as Dashboard;
      } catch {
        return {
          total_changes: 0,
          by_status: {},
          by_priority: {},
          by_source: {},
          gaps_identified: 0,
          changes_this_month: 0,
          pending_assessments: 0,
        };
      }
    },
  });

  const { data: changes, isLoading: changesLoading } = useQuery({
    queryKey: ['regulatory-changes', sourceFilter, statusFilter, priorityFilter, searchTerm],
    queryFn: async () => {
      try {
        const response = await regulatoryApi.getChanges({
          source: sourceFilter || undefined,
          status: statusFilter || undefined,
          priority: priorityFilter || undefined,
          search: searchTerm || undefined,
        });
        return response.data as RegulatoryChange[];
      } catch {
        return [];
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => regulatoryApi.createChange(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-changes'] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-dashboard'] });
      setIsModalOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => regulatoryApi.deleteChange(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-changes'] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-dashboard'] });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => 
      regulatoryApi.updateChange(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-changes'] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-dashboard'] });
    },
  });

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      source: 'OCC',
      regulatory_body: '',
      reference_number: '',
      effective_date: '',
      publication_date: '',
      priority: 'medium',
      impact_summary: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const isLoading = dashboardLoading || changesLoading;

  const stats = [
    {
      name: 'Total Changes',
      value: dashboard?.total_changes || 0,
      icon: FileWarning,
      iconColor: 'text-primary-400',
      bgColor: 'from-primary-500/20 to-primary-600/10',
    },
    {
      name: 'Under Assessment',
      value: dashboard?.by_status?.under_assessment || 0,
      icon: Clock,
      iconColor: 'text-yellow-400',
      bgColor: 'from-yellow-500/20 to-yellow-600/10',
    },
    {
      name: 'In Implementation',
      value: dashboard?.by_status?.implementation || 0,
      icon: AlertCircle,
      iconColor: 'text-purple-400',
      bgColor: 'from-purple-500/20 to-purple-600/10',
    },
    {
      name: 'Gaps Identified',
      value: dashboard?.gaps_identified || 0,
      icon: AlertTriangle,
      iconColor: 'text-rose-400',
      bgColor: 'from-rose-500/20 to-rose-600/10',
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-56 mb-2" />
          <div className="skeleton h-5 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-gray-300 bg-white p-5">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-20 mb-2" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black">Regulatory Change Management</h1>
          <p className="text-gray-600 mt-1">Track and manage regulatory changes and their implementation</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New Change
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.name}
            className="rounded-xl border border-gray-300 bg-white p-5"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${stat.bgColor}`}>
                <stat.icon className={`h-6 w-6 ${stat.iconColor}`} />
              </div>
            </div>
            <p className="text-3xl font-bold text-black">{stat.value}</p>
            <p className="text-sm text-gray-600 mt-1">{stat.name}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-300 bg-white">
        <div className="flex flex-col gap-4 border-b border-gray-300 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-600" />
            <input
              type="text"
              placeholder="Search changes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-gray-100 pl-10 pr-4 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Filter className="h-4 w-4 text-gray-600" />
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
            >
              {SOURCE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
            >
              {PRIORITY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          {(!changes || changes.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <FileWarning className="h-12 w-12 mb-4" />
              <p className="text-lg font-medium">No regulatory changes found</p>
              <p className="text-sm">Create a new change to get started</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-white/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Change</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Priority</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Effective Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Gaps</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {changes.map((change) => {
                  const statusStyle = getStatusStyle(change.status);
                  const priorityStyle = getPriorityStyle(change.priority);
                  const StatusIcon = statusStyle.icon;

                  return (
                    <tr key={change.id} className="hover:bg-gray-100/50 transition-colors">
                      <td className="px-4 py-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary-500/20">
                            <FileWarning className="h-5 w-5 text-primary-400" />
                          </div>
                          <div className="min-w-0">
                            <Link href={`/governance/regulatory-changes/${change.id}`} className="font-medium text-black hover:text-primary-400">
                              {change.title}
                            </Link>
                            {change.reference_number && (
                              <p className="text-xs text-gray-700 font-mono mt-0.5">{change.reference_number}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-gray-600" />
                          <span className="text-sm text-gray-800">{change.source}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          <StatusIcon className="h-3 w-3" />
                          {change.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${priorityStyle.bg} ${priorityStyle.text}`}>
                          {change.priority}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-800">
                        {change.effective_date ? new Date(change.effective_date).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-4 py-4">
                        {(change.gap_count || 0) > 0 ? (
                          <span className="inline-flex items-center gap-1 text-sm text-rose-400">
                            <AlertTriangle className="h-4 w-4" />
                            {change.gap_count}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-700">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/governance/regulatory-changes/${change.id}`}
                            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-black transition-colors"
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => deleteMutation.mutate(change.id)}
                            disabled={deleteMutation.isPending}
                            className="rounded-lg p-2 text-gray-600 hover:bg-red-500/20 hover:text-red-400 transition-colors disabled:opacity-50"
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
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-gray-300 bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-black">New Regulatory Change</h2>
              <button
                onClick={() => { setIsModalOpen(false); resetForm(); }}
                className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-black transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                  placeholder="Enter change title"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Source *</label>
                  <select
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-black focus:border-primary-500 focus:outline-none"
                  >
                    {SOURCE_OPTIONS.filter(o => o.value).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Priority *</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-black focus:border-primary-500 focus:outline-none"
                  >
                    {PRIORITY_OPTIONS.filter(o => o.value).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Regulatory Body</label>
                  <input
                    type="text"
                    value={formData.regulatory_body}
                    onChange={(e) => setFormData({ ...formData, regulatory_body: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                    placeholder="e.g., Federal Reserve"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Reference Number</label>
                  <input
                    type="text"
                    value={formData.reference_number}
                    onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                    placeholder="e.g., REG-2025-001"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Publication Date</label>
                  <input
                    type="date"
                    value={formData.publication_date}
                    onChange={(e) => setFormData({ ...formData, publication_date: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-black focus:border-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Effective Date</label>
                  <input
                    type="date"
                    value={formData.effective_date}
                    onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-black focus:border-primary-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
                  placeholder="Describe the regulatory change..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Impact Summary</label>
                <textarea
                  value={formData.impact_summary}
                  onChange={(e) => setFormData({ ...formData, impact_summary: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
                  placeholder="Summarize the potential impact..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-300">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); resetForm(); }}
                  className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Create Change
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
