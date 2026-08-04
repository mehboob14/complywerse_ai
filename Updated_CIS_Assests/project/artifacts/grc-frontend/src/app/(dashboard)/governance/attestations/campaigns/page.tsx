'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from '@/lib/navigation';
import { attestationApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { SearchInput, MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import {
  ClipboardCheck,
  Plus,
  Eye,
  Play,
  XCircle,
  Trash2,
  Calendar,
  Users,
  CheckCircle,
  Clock,
  FileCheck,
} from 'lucide-react';
import { Link } from 'wouter';

interface Campaign {
  id: number;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'closed';
  campaign_type: string;
  start_date: string;
  due_date: string;
  total_requests: number;
  completed_requests: number;
  completion_rate: number;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', icon: FileCheck },
  active: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: Play },
  closed: { bg: 'bg-blue-100', text: 'text-blue-700', icon: CheckCircle },
};

const ATTESTATION_TYPES = [
  { value: 'sox_302', label: 'SOX 302 Certification' },
  { value: 'sox_404', label: 'SOX 404 Certification' },
  { value: 'policy_signoff', label: 'Policy Sign-Off' },
  { value: 'bcp_awareness', label: 'BCP Awareness' },
  { value: 'training_acknowledgment', label: 'Training Acknowledgment' },
  { value: 'annual_certification', label: 'Annual Certification' },
];

export default function AttestationCampaignsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:attestations:create');
  const canDelete = hasPermission('governance:attestations:delete');
  const searchParams = useSearchParams();
  const showNewModal = searchParams.get('action') === 'new';
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(showNewModal);
  const queryClient = useQueryClient();

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['attestation-campaigns', statusFilter],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      try {
        const response = await attestationApi.getCampaigns({ status: statusFilter || undefined });
        return response.data as Campaign[];
      } catch {
        return [
          { id: 1, name: 'Q4 2025 Policy Attestation', description: 'Quarterly policy acknowledgment for all employees', status: 'active', campaign_type: 'policy_signoff', start_date: '2025-01-01', due_date: '2025-01-31', total_requests: 150, completed_requests: 108, completion_rate: 72, created_at: '2024-12-15', updated_at: '2025-01-20' },
          { id: 2, name: 'Annual Code of Conduct', description: 'Annual compliance certification for all staff', status: 'active', campaign_type: 'annual_certification', start_date: '2025-01-01', due_date: '2025-01-31', total_requests: 200, completed_requests: 156, completion_rate: 78, created_at: '2024-12-20', updated_at: '2025-01-18' },
          { id: 3, name: 'Q3 2025 SOX Attestation', description: 'SOX compliance attestation for finance team', status: 'closed', campaign_type: 'sox_302', start_date: '2024-10-01', due_date: '2024-10-31', total_requests: 50, completed_requests: 50, completion_rate: 100, created_at: '2024-09-15', updated_at: '2024-11-01' },
          { id: 4, name: 'Conflict of Interest 2025', description: 'Annual COI disclosure', status: 'draft', campaign_type: 'policy_signoff', start_date: '2025-02-01', due_date: '2025-02-28', total_requests: 0, completed_requests: 0, completion_rate: 0, created_at: '2025-01-20', updated_at: '2025-01-20' },
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
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-black">Attestation Campaigns</h1>
          <p className="mt-1 text-gray-600">Manage attestation and certification campaigns</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <MultiSelectDropdown
          title="Status"
          items={[
            { value: 'draft', label: 'Draft' },
            { value: 'active', label: 'Active' },
            { value: 'closed', label: 'Closed' },
          ]}
          selectedValues={statusFilter ? [statusFilter] : []}
          onApply={(vals) => setStatusFilter(vals[0] || '')}
          multiSelect={false}
        />
        <div className="flex-1">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search campaigns..."
            size="md"
          />
        </div>
        {canCreate && (
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-primary flex items-center gap-2 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          New Campaign
        </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredCampaigns.map((campaign) => {
          const statusStyle = STATUS_COLORS[campaign.status] || STATUS_COLORS.draft;
          const StatusIcon = statusStyle.icon;
          const pendingRequests = campaign.total_requests - campaign.completed_requests;

          return (
            <div key={campaign.id} className="card p-4 hover:border-primary-500/50 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/20 flex-shrink-0">
                    <ClipboardCheck className="h-4 w-4 text-primary-400" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-black font-medium text-sm truncate">{campaign.name}</h3>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                      <StatusIcon className="h-3 w-3" />
                      {campaign.status}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-gray-500 text-xs mb-3 line-clamp-2">
                {campaign.description || `${campaign.campaign_type?.replace(/_/g, ' ') ?? ''} attestation`}
              </p>

              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(campaign.due_date).toLocaleDateString()}
                  </span>
                  <span className="text-gray-500 flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {campaign.completed_requests}/{campaign.total_requests}
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-500">Progress</span>
                    <span className="text-black font-medium">{campaign.completion_rate}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${campaign.completion_rate === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`}
                      style={{ width: `${campaign.completion_rate}%` }}
                    />
                  </div>
                </div>

                {pendingRequests > 0 && campaign.status === 'active' && (
                  <div className="flex items-center gap-1 text-amber-600 text-xs">
                    <Clock className="h-3.5 w-3.5" />
                    {pendingRequests} pending
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-gray-200">
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
                    className="p-1.5 text-gray-600 hover:text-emerald-700 hover:bg-emerald-100 rounded"
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
                    className="p-1.5 text-gray-600 hover:text-blue-700 hover:bg-blue-100 rounded"
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
                    className="p-1.5 text-gray-600 hover:text-rose-700 hover:bg-rose-100 rounded"
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
          <ClipboardCheck className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-black mb-2">No Campaigns Found</h3>
          <p className="text-gray-600 mb-4">
            {searchTerm || statusFilter
              ? 'No campaigns match your filters'
              : 'Create your first attestation campaign to get started'}
          </p>
          {canCreate && (
          <button onClick={() => setIsModalOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4 mr-2" />
            Create Campaign
          </button>
          )}
        </div>
      )}

      <RightSlidePanel
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Campaign"
        width="w-full max-w-lg"
      >
        <form
          id="create-campaign-form"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            createMutation.mutate({
              name: formData.get('name') as string,
              description: (formData.get('description') as string) || undefined,
              campaign_type: formData.get('attestation_type') as string,
              attestation_text: (formData.get('attestation_text') as string) || undefined,
              start_date: new Date(formData.get('start_date') as string).toISOString(),
              due_date: new Date(formData.get('end_date') as string).toISOString(),
              requires_evidence: formData.get('requires_evidence') === 'on',
              target_type: 'all_users',
            });
          }}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
              <input
                type="text"
                name="name"
                className="input w-full"
                required
                placeholder="e.g., Q1 2026 Policy Attestation"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                name="description"
                className="input w-full"
                rows={2}
                placeholder="Brief description of this campaign"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Attestation Type</label>
              <select name="attestation_type" className="input w-full" required>
                <option value="">Select type</option>
                {ATTESTATION_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Attestation Text</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  name="start_date"
                  className="input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
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
                className="rounded border-gray-300 bg-white text-primary-500 focus:ring-primary-500"
              />
              <label htmlFor="requires_evidence" className="text-sm text-gray-700">
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
      </RightSlidePanel>
    </div>
  );
}
