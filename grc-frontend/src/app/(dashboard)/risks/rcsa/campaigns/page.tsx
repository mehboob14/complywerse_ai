'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { rcsaApi } from '@/lib/api';
import {
  ClipboardList,
  Plus,
  Search,
  Eye,
  Play,
  XCircle,
  Trash2,
  X,
  Calendar,
  Building2,
  Users,
  CheckCircle,
  Clock,
  AlertCircle,
  FileText,
} from 'lucide-react';
import Link from 'next/link';

interface Campaign {
  id: number;
  name: string;
  description?: string;
  template_id: number;
  template_name: string;
  status: 'draft' | 'active' | 'closed';
  period: string;
  start_date: string;
  end_date: string;
  progress: number;
  assigned_units: number;
  completed_units: number;
  pending_assessments: number;
  created_at: string;
  updated_at: string;
}

interface Template {
  id: number;
  name: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  draft: { bg: 'bg-slate-500/20', text: 'text-slate-600', icon: FileText },
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: Play },
  closed: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: CheckCircle },
};

const PERIOD_OPTIONS = [
  { value: '', label: 'All Periods' },
  { value: 'Q1 2025', label: 'Q1 2025' },
  { value: 'Q2 2025', label: 'Q2 2025' },
  { value: 'Q3 2025', label: 'Q3 2025' },
  { value: 'Q4 2025', label: 'Q4 2025' },
  { value: 'Annual 2025', label: 'Annual 2025' },
];

export default function RCSACampaignsPage() {
  const searchParams = useSearchParams();
  const showNewModal = searchParams.get('action') === 'new';
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [periodFilter, setPeriodFilter] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(showNewModal);
  const queryClient = useQueryClient();

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['rcsa-campaigns', statusFilter, periodFilter],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getCampaigns({ status: statusFilter || undefined, period: periodFilter || undefined });
        return response.data as Campaign[];
      } catch {
        return [] as Campaign[];
      }
    },
  });

  const { data: templates } = useQuery({
    queryKey: ['rcsa-templates-list'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getTemplates();
        return response.data as Template[];
      } catch {
        return [] as Template[];
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => rcsaApi.createCampaign(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-campaigns'] });
      setIsModalOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => rcsaApi.deleteCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-campaigns'] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => rcsaApi.activateCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-campaigns'] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: (id: number) => rcsaApi.closeCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-campaigns'] });
    },
  });

  const filteredCampaigns = (campaigns || []).filter(campaign => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         campaign.template_name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-48 mb-2" />
          <div className="skeleton h-5 w-80" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4].map((i) => (
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">RCSA Campaigns</h1>
            <p className="text-slate-600 mt-1">Manage Risk & Control Self-Assessment campaigns</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New Campaign
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-600" />
          <input
            type="text"
            placeholder="Search campaigns..."
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
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={periodFilter}
          onChange={(e) => setPeriodFilter(e.target.value)}
          className="input"
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCampaigns.map((campaign) => {
          const statusStyle = STATUS_COLORS[campaign.status] || STATUS_COLORS.draft;
          const StatusIcon = statusStyle.icon;

          return (
            <div key={campaign.id} className="card p-6 hover:border-primary-500/50 transition-all">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/20">
                    <ClipboardList className="h-5 w-5 text-primary-400" />
                  </div>
                  <div>
                    <h3 className="text-slate-900 font-medium">{campaign.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                      <StatusIcon className="h-3 w-3" />
                      {campaign.status}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-slate-600 text-sm mb-4 line-clamp-2">
                {campaign.description || `Using ${campaign.template_name} template`}
              </p>

              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" />
                    {campaign.period}
                  </span>
                  <span className="text-slate-600">
                    {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <Building2 className="h-4 w-4" />
                    {campaign.assigned_units} units assigned
                  </span>
                  <span className="text-slate-600">
                    {campaign.completed_units} completed
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-slate-600">Progress</span>
                    <span className="text-slate-900 font-medium">{campaign.progress}%</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${campaign.progress === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`}
                      style={{ width: `${campaign.progress}%` }}
                    />
                  </div>
                </div>

                {campaign.pending_assessments > 0 && (
                  <div className="flex items-center gap-1.5 text-amber-400 text-sm">
                    <Clock className="h-4 w-4" />
                    {campaign.pending_assessments} pending assessments
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-slate-200">
                <Link
                  href={`/risks/rcsa/campaigns/${campaign.id}`}
                  className="flex-1 btn-secondary text-center text-sm py-1.5 flex items-center justify-center gap-1"
                >
                  <Eye className="h-4 w-4" />
                  View
                </Link>
                
                {campaign.status === 'draft' && (
                  <button
                    onClick={() => {
                      if (confirm('Activate this campaign?')) {
                        activateMutation.mutate(campaign.id);
                      }
                    }}
                    className="p-1.5 text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/20 rounded"
                    title="Activate Campaign"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                )}
                
                {campaign.status === 'active' && (
                  <button
                    onClick={() => {
                      if (confirm('Close this campaign?')) {
                        closeMutation.mutate(campaign.id);
                      }
                    }}
                    className="p-1.5 text-slate-600 hover:text-blue-400 hover:bg-blue-500/20 rounded"
                    title="Close Campaign"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                )}
                
                {campaign.status !== 'active' && (
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this campaign?')) {
                        deleteMutation.mutate(campaign.id);
                      }
                    }}
                    className="p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/20 rounded"
                    title="Delete Campaign"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredCampaigns.length === 0 && (
        <div className="card p-12 text-center">
          <ClipboardList className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No Campaigns Found</h3>
          <p className="text-slate-600 mb-4">
            {searchTerm || statusFilter || periodFilter
              ? 'No campaigns match your filters'
              : 'Create your first RCSA campaign to get started'}
          </p>
          <button onClick={() => setIsModalOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4 mr-2" />
            Create Campaign
          </button>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg border border-slate-200 mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-slate-900">Create New Campaign</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const periodValue = formData.get('period') as string;
                const periodType = periodValue.startsWith('Q') ? 'quarterly' : 'annual';
                createMutation.mutate({
                  name: formData.get('name') as string,
                  description: formData.get('description') as string,
                  template_id: Number(formData.get('template_id')),
                  period_type: periodType,
                  period_label: periodValue,
                  start_date: new Date(formData.get('start_date') as string).toISOString(),
                  due_date: new Date(formData.get('end_date') as string).toISOString(),
                  business_unit_ids: [],
                });
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Campaign Name</label>
                  <input
                    type="text"
                    name="name"
                    className="input w-full"
                    required
                    placeholder="e.g., Q1 2026 RCSA"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <textarea
                    name="description"
                    className="input w-full"
                    rows={2}
                    placeholder="Brief description of this campaign"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Template</label>
                  <select name="template_id" className="input w-full" required>
                    <option value="">Select a template</option>
                    {(templates || []).map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Period</label>
                  <select name="period" className="input w-full" required>
                    <option value="">Select period</option>
                    <option value="Q1 2026">Q1 2026</option>
                    <option value="Q2 2026">Q2 2026</option>
                    <option value="Q3 2026">Q3 2026</option>
                    <option value="Q4 2026">Q4 2026</option>
                    <option value="Annual 2026">Annual 2026</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      name="start_date"
                      className="input w-full"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                    <input
                      type="date"
                      name="end_date"
                      className="input w-full"
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
