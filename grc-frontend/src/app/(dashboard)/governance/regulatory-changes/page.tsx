'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { regulatoryApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { SearchInput, MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import {
  FileWarning,
  Plus,
  Eye,
  Trash2,
  AlertTriangle,
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  Building2,
  Loader2,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
  identified: { bg: 'bg-teal-50', text: 'text-teal-700', icon: FileText },
  under_assessment: { bg: 'bg-amber-50', text: 'text-amber-700', icon: Clock },
  implementation: { bg: 'bg-violet-50', text: 'text-violet-700', icon: AlertCircle },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle },
  not_applicable: { bg: 'bg-slate-100', text: 'text-slate-600', icon: FileText },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-rose-50', text: 'text-rose-700' },
  high: { bg: 'bg-orange-50', text: 'text-orange-700' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700' },
  low: { bg: 'bg-teal-50', text: 'text-teal-700' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] || STATUS_STYLES.identified;
}

function getPriorityStyle(priority: string) {
  return PRIORITY_STYLES[priority?.toLowerCase()] || PRIORITY_STYLES.medium;
}

export default function RegulatoryChangesPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:regulatory_changes:create');
  const canDelete = hasPermission('governance:regulatory_changes:delete');
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSource, setUploadSource] = useState('custom');
  const [uploadTitleHint, setUploadTitleHint] = useState('');
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
  const router = useRouter();

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
    placeholderData: keepPreviousData,
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

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) {
        throw new Error('No file selected.');
      }
      const response = await regulatoryApi.uploadChangeDocument(uploadFile, {
        source: uploadSource,
        title_hint: uploadTitleHint || undefined,
      });
      return response.data as RegulatoryChange;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-changes'] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-dashboard'] });
      setIsUploadOpen(false);
      setUploadFile(null);
      setUploadTitleHint('');
      setUploadSource('custom');
      router.push(`/governance/regulatory-changes/${created.id}`);
    },
    onError: () => {
      // keep UX simple — errors will surface via UI toast component used elsewhere
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
      chip: 'bg-slate-100 text-slate-700',
      accent: 'border-l-slate-400',
    },
    {
      name: 'Under Assessment',
      value: dashboard?.by_status?.under_assessment || 0,
      icon: Clock,
      chip: 'bg-amber-50 text-amber-700',
      accent: 'border-l-amber-500',
    },
    {
      name: 'In Implementation',
      value: dashboard?.by_status?.implementation || 0,
      icon: AlertCircle,
      chip: 'bg-violet-50 text-violet-700',
      accent: 'border-l-violet-500',
    },
    {
      name: 'Gaps Identified',
      value: dashboard?.gaps_identified || 0,
      icon: AlertTriangle,
      chip: 'bg-rose-50 text-rose-700',
      accent: 'border-l-rose-500',
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
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-5">
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
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Regulatory Change Management</h1>
          <p className="mt-1 text-slate-500">Track and manage regulatory changes and their implementation</p>
        </div>

      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.name}
            className={`rounded-xl border border-slate-200 border-l-4 ${stat.accent} bg-white p-3`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${stat.chip}`}>
                <stat.icon className="h-4 w-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-900">{stat.value}</p>
            <p className="text-sm text-slate-500 mt-1">{stat.name}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="flex-1 min-w-[180px] sm:min-w-[260px] max-w-md">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search changes..."
              size="md"
            />
          </div>

          <MultiSelectDropdown
            title="Source"
            items={SOURCE_OPTIONS.filter(o => o.value).map(o => ({ value: o.value, label: o.label }))}
            selectedValues={sourceFilter ? [sourceFilter] : []}
            onApply={(vals) => setSourceFilter(vals[0] || '')}
            multiSelect={false}
          />
          <MultiSelectDropdown
            title="Status"
            items={STATUS_OPTIONS.filter(o => o.value).map(o => ({ value: o.value, label: o.label }))}
            selectedValues={statusFilter ? [statusFilter] : []}
            onApply={(vals) => setStatusFilter(vals[0] || '')}
            multiSelect={false}
          />
          <MultiSelectDropdown
            title="Priority"
            items={PRIORITY_OPTIONS.filter(o => o.value).map(o => ({ value: o.value, label: o.label }))}
            selectedValues={priorityFilter ? [priorityFilter] : []}
            onApply={(vals) => setPriorityFilter(vals[0] || '')}
            multiSelect={false}
          />
        </div>

        {canCreate && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsUploadOpen(true)}
              className="btn-primary flex items-center gap-2"
              disabled={uploadMutation.isPending}
            >
              <Upload className="h-4 w-4" />
              Upload Document
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              New Change
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          {(!changes || changes.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
              <FileWarning className="h-12 w-12 mb-4" strokeWidth={1.75} />
              <p className="text-lg font-medium">No regulatory changes found</p>
              <p className="text-sm">Create a new change to get started</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Change</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Priority</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Effective Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Gaps</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {changes.map((change) => {
                  const statusStyle = getStatusStyle(change.status);
                  const priorityStyle = getPriorityStyle(change.priority);

                  return (
                    <tr key={change.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                            <FileWarning className="h-5 w-5" strokeWidth={1.75} />
                          </div>
                          <div className="min-w-0">
                            <Link href={`/governance/regulatory-changes/${change.id}`} className="font-medium text-slate-900 hover:text-primary-600">
                              {change.title}
                            </Link>
                            {change.reference_number && (
                              <p className="text-xs text-slate-500 font-mono mt-0.5">{change.reference_number}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
                          <span className="text-sm text-slate-700">{change.source}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <select
                          value={change.status}
                          onChange={(e) => updateStatusMutation.mutate({ id: change.id, status: e.target.value })}
                          disabled={updateStatusMutation.isPending}
                          className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${statusStyle.bg} ${statusStyle.text} focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:opacity-50`}
                          title="Change status"
                        >
                          {STATUS_OPTIONS.filter((o) => o.value).map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${priorityStyle.bg} ${priorityStyle.text}`}>
                          {change.priority}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700">
                        {change.effective_date ? new Date(change.effective_date).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-4 py-4">
                        {(change.gap_count || 0) > 0 ? (
                          <span className="inline-flex items-center gap-1 text-sm text-rose-600">
                            <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
                            {change.gap_count}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/governance/regulatory-changes/${change.id}`}
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                            title="View details"
                          >
                            <Eye className="h-4 w-4" strokeWidth={1.75} />
                          </Link>
                          {canDelete && (
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete "${change.title}"? This cannot be undone.`)) {
                                deleteMutation.mutate(change.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-50"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                          )}
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

      <RightSlidePanel
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title="New Regulatory Change"
        width="w-full max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  placeholder="Enter change title"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Source *</label>
                  <select
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  >
                    {SOURCE_OPTIONS.filter(o => o.value).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priority *</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  >
                    {PRIORITY_OPTIONS.filter(o => o.value).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Regulatory Body</label>
                  <input
                    type="text"
                    value={formData.regulatory_body}
                    onChange={(e) => setFormData({ ...formData, regulatory_body: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    placeholder="e.g., Federal Reserve"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Reference Number</label>
                  <input
                    type="text"
                    value={formData.reference_number}
                    onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    placeholder="e.g., REG-2025-001"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Publication Date</label>
                  <input
                    type="date"
                    value={formData.publication_date}
                    onChange={(e) => setFormData({ ...formData, publication_date: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Effective Date</label>
                  <input
                    type="date"
                    value={formData.effective_date}
                    onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
                  placeholder="Describe the regulatory change..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Impact Summary</label>
                <textarea
                  value={formData.impact_summary}
                  onChange={(e) => setFormData({ ...formData, impact_summary: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
                  placeholder="Summarize the potential impact..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); resetForm(); }}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
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
      </RightSlidePanel>

      <RightSlidePanel
        isOpen={isUploadOpen}
        onClose={() => {
          setIsUploadOpen(false);
          setUploadFile(null);
          setUploadTitleHint('');
          setUploadSource('custom');
        }}
        title="Upload Regulatory Document"
        width="w-full max-w-2xl"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            uploadMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Document *</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setUploadFile(f);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            />
            {uploadFile && (
              <p className="mt-2 text-xs text-slate-500">Selected: {uploadFile.name}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Source</label>
              <select
                value={uploadSource}
                onChange={(e) => setUploadSource(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                {SOURCE_OPTIONS.filter((o) => o.value).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title hint</label>
              <input
                type="text"
                value={uploadTitleHint}
                onChange={(e) => setUploadTitleHint(e.target.value)}
                placeholder="Optional short name"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-900">AI will do the heavy lifting</p>
                <p className="text-xs text-amber-800 mt-0.5">
                  We will extract requirements, map impacted controls to your platform, and generate implementation tasks and compliance gaps.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => {
                setIsUploadOpen(false);
                setUploadFile(null);
                setUploadTitleHint('');
                setUploadSource('custom');
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploadMutation.isPending || !uploadFile}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload & Extract
            </button>
          </div>
        </form>
      </RightSlidePanel>
    </div>
  );
}
