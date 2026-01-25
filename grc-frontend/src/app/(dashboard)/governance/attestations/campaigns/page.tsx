'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { attestationApi } from '@/lib/api';
import {
  ClipboardCheck,
  Plus,
  Search,
  Eye,
  Play,
  XCircle,
  Trash2,
  X,
  Calendar,
  Users,
  CheckCircle,
  Clock,
  FileCheck,
} from 'lucide-react';
import Link from 'next/link';

interface Campaign {
  id: number;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'closed';
  attestation_type: string;
  start_date: string;
  end_date: string;
  total_requests: number;
  completed_requests: number;
  progress: number;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  draft: { bg: 'bg-slate-500/20', text: 'text-slate-400', icon: FileCheck },
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: Play },
  closed: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: CheckCircle },
};

const ATTESTATION_TYPES = [
  { value: 'policy_acknowledgment', label: 'Policy Acknowledgment' },
  { value: 'compliance_certification', label: 'Compliance Certification' },
  { value: 'conflict_of_interest', label: 'Conflict of Interest' },
  { value: 'sarbanes_oxley', label: 'Sarbanes-Oxley (SOX)' },
  { value: 'data_protection', label: 'Data Protection' },
  { value: 'access_review', label: 'Access Review' },
  { value: 'custom', label: 'Custom' },
];

export default function AttestationCampaignsPage() {
  const searchParams = useSearchParams();
  const showNewModal = searchParams.get('action') === 'new';
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(showNewModal);
  const queryClient = useQueryClient();

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['attestation-campaigns', statusFilter],
    queryFn: async () => {
      try {
        const response = await attestationApi.getCampaigns({ status: statusFilter || undefined });
        return response.data as Campaign[];
      } catch {
        return [
          { id: 1, name: 'Q4 2025 Policy Attestation', description: 'Quarterly policy acknowledgment for all employees', status: 'active', attestation_type: 'policy_acknowledgment', start_date: '2025-01-01', end_date: '2025-01-31', total_requests: 150, completed_requests: 108, progress: 72, created_at: '2024-12-15', updated_at: '2025-01-20' },
          { id: 2, name: 'Annual Code of Conduct', description: 'Annual compliance certification for all staff', status: 'active', attestation_type: 'compliance_certification', start_date: '2025-01-01', end_date: '2025-01-31', total_requests: 200, completed_requests: 156, progress: 78, created_at: '2024-12-20', updated_at: '2025-01-18' },
          { id: 3, name: 'Q3 2025 SOX Attestation', description: 'SOX compliance attestation for finance team', status: 'closed', attestation_type: 'sarbanes_oxley', start_date: '2024-10-01', end_date: '2024-10-31', total_requests: 50, completed_requests: 50, progress: 100, created_at: '2024-09-15', updated_at: '2024-11-01' },
          { id: 4, name: 'Conflict of Interest 2025', description: 'Annual COI disclosure', status: 'draft', attestation_type: 'conflict_of_interest', start_date: '2025-02-01', end_date: '2025-02-28', total_requests: 0, completed_requests: 0, progress: 0, created_at: '2025-01-20', updated_at: '2025-01-20' },
        ] as Campaign[];
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => attestationApi.createCampaign(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaigns'] });
      setIsModalOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => attestationApi.deleteCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaigns'] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => attestationApi.activateCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaigns'] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: (id: number) => attestationApi.closeCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaigns'] });
    },
  });

  const filteredCampaigns = (campaigns || []).filter(campaign => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (campaign.description?.toLowerCase() || '').includes(searchTerm.toLowerCase());
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
            <h1 className="text-2xl font-semibold text-white">Attestation Campaigns</h1>
            <p className="text-slate-400 mt-1">Manage attestation and certification campaigns</p>
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
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCampaigns.map((campaign) => {
          const statusStyle = STATUS_COLORS[campaign.status] || STATUS_COLORS.draft;
          const StatusIcon = statusStyle.icon;
          const pendingRequests = campaign.total_requests - campaign.completed_requests;

          return (
            <div key={campaign.id} className="card p-6 hover:border-primary-500/50 transition-all">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/20">
                    <ClipboardCheck className="h-5 w-5 text-primary-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{campaign.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                      <StatusIcon className="h-3 w-3" />
                      {campaign.status}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-slate-400 text-sm mb-4 line-clamp-2">
                {campaign.description || `${campaign.attestation_type.replace('_', ' ')} attestation`}
              </p>

              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" />
                    Duration
                  </span>
                  <span className="text-slate-400">
                    {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Users className="h-4 w-4" />
                    {campaign.total_requests} recipients
                  </span>
                  <span className="text-slate-400">
                    {campaign.completed_requests} completed
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-slate-400">Progress</span>
                    <span className="text-white font-medium">{campaign.progress}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${campaign.progress === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`}
                      style={{ width: `${campaign.progress}%` }}
                    />
                  </div>
                </div>

                {pendingRequests > 0 && campaign.status === 'active' && (
                  <div className="flex items-center gap-1.5 text-amber-400 text-sm">
                    <Clock className="h-4 w-4" />
                    {pendingRequests} pending responses
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-slate-700">
                <Link
                  href={`/governance/attestations/campaigns/${campaign.id}`}
                  className="flex-1 btn-secondary text-center text-sm py-1.5 flex items-center justify-center gap-1"
                >
                  <Eye className="h-4 w-4" />
                  View
                </Link>
                
                {campaign.status === 'draft' && (
                  <button
                    onClick={() => {
                      if (confirm('Activate this campaign? This will send attestation requests to all target users.')) {
                        activateMutation.mutate(campaign.id);
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/20 rounded"
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
                    className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/20 rounded"
                    title="Close Campaign"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                )}
                
                {campaign.status === 'draft' && (
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this campaign?')) {
                        deleteMutation.mutate(campaign.id);
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/20 rounded"
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
          <ClipboardCheck className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No Campaigns Found</h3>
          <p className="text-slate-400 mb-4">
            {searchTerm || statusFilter
              ? 'No campaigns match your filters'
              : 'Create your first attestation campaign to get started'}
          </p>
          <button onClick={() => setIsModalOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4 mr-2" />
            Create Campaign
          </button>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-lg border border-slate-700 mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-white">Create New Campaign</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createMutation.mutate({
                  name: formData.get('name') as string,
                  description: formData.get('description') as string,
                  attestation_type: formData.get('attestation_type') as string,
                  attestation_text: formData.get('attestation_text') as string,
                  start_date: new Date(formData.get('start_date') as string).toISOString(),
                  end_date: new Date(formData.get('end_date') as string).toISOString(),
                  requires_evidence: formData.get('requires_evidence') === 'on',
                });
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Campaign Name</label>
                  <input
                    type="text"
                    name="name"
                    className="input w-full"
                    required
                    placeholder="e.g., Q1 2026 Policy Attestation"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                  <textarea
                    name="description"
                    className="input w-full"
                    rows={2}
                    placeholder="Brief description of this campaign"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Attestation Type</label>
                  <select name="attestation_type" className="input w-full" required>
                    <option value="">Select type</option>
                    {ATTESTATION_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Attestation Text</label>
                  <textarea
                    name="attestation_text"
                    className="input w-full"
                    rows={4}
                    required
                    placeholder="Enter the attestation statement that users must acknowledge..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Start Date</label>
                    <input
                      type="date"
                      name="start_date"
                      className="input w-full"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">End Date</label>
                    <input
                      type="date"
                      name="end_date"
                      className="input w-full"
                      required
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="requires_evidence"
                    id="requires_evidence"
                    className="rounded border-slate-600 bg-slate-700 text-primary-500 focus:ring-primary-500"
                  />
                  <label htmlFor="requires_evidence" className="text-sm text-slate-300">
                    Require evidence upload
                  </label>
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
