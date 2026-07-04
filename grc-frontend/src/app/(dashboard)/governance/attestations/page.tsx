'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { attestationApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import {
  ClipboardCheck,
  Clock,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Plus,
  Eye,
  ArrowRight,
  Calendar,
  FileCheck,
  Play,
  AlertCircle,
  Link2,
  Filter,
  X,
} from 'lucide-react';
import Link from 'next/link';

interface DashboardData {
  total_campaigns: number;
  active_campaigns: number;
  pending_attestations: number;
  overdue_attestations: number;
  completion_rate: number;
}

interface MyAttestation {
  id: number;
  campaign_id: number;
  campaign_name: string;
  attestation_type: string;
  status: 'pending' | 'completed' | 'overdue';
  due_date: string;
  attestation_text: string;
  linked_to_evidence?: boolean;
}

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
}

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', icon: Clock },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle },
  overdue: { bg: 'bg-rose-50', text: 'text-rose-700', icon: AlertCircle },
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', icon: FileCheck },
  active: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: Play },
  closed: { bg: 'bg-slate-100', text: 'text-slate-600', icon: CheckCircle },
};

export default function AttestationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAttestations, setSelectedAttestations] = useState<number[]>([]);
  const [expandedAttestation, setExpandedAttestation] = useState<number | null>(null);
  const [showUnlinkedOnly, setShowUnlinkedOnly] = useState(false);

  const { data: dashboard, isLoading: dashboardLoading, isError: dashboardError } = useQuery({
    queryKey: ['attestation-dashboard'],
    queryFn: async () => {
      const response = await attestationApi.getDashboard();
      return response.data as DashboardData;
    },
  });

  const { data: myAttestations, isLoading: myAttestationsLoading } = useQuery({
    queryKey: ['my-attestations'],
    queryFn: async () => {
      const response = await attestationApi.getMyAttestations();
      return response.data as MyAttestation[];
    },
  });

  const { data: recentCampaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['recent-attestation-campaigns'],
    queryFn: async () => {
      const response = await attestationApi.getCampaigns();
      return (response.data as Campaign[]).slice(0, 5);
    },
  });

  const linkToEvidenceMutation = useMutation({
    mutationFn: (id: number) => attestationApi.linkToEvidence(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-attestations'] });
      toast({
        title: 'Evidence Linked',
        message: 'Attestation successfully linked to evidence repository',
        type: 'success',
      });
    },
    onError: () => {
      toast({
        title: 'Link Failed',
        message: 'Failed to link attestation to evidence',
        type: 'error',
      });
    },
  });

  const bulkLinkToEvidenceMutation = useMutation({
    mutationFn: (ids: number[]) => attestationApi.bulkLinkToEvidence(ids),
    onSuccess: (response) => {
      const data = response.data as { created_count: number; skipped_count: number };
      queryClient.invalidateQueries({ queryKey: ['my-attestations'] });
      setSelectedAttestations([]);
      toast({
        title: 'Evidence Linked',
        message: `Successfully linked ${data.created_count} attestation(s) to evidence${data.skipped_count > 0 ? ` (${data.skipped_count} skipped)` : ''}`,
        type: 'success',
      });
    },
    onError: () => {
      toast({
        title: 'Bulk Link Failed',
        message: 'Failed to link attestations to evidence',
        type: 'error',
      });
    },
  });

  const isLoading = dashboardLoading || myAttestationsLoading || campaignsLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="page-header">
          <div className="skeleton h-5 w-48 mb-1" />
          <div className="skeleton h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card p-3">
              <div className="skeleton h-8 w-8 rounded mb-2" />
              <div className="skeleton h-5 w-12 mb-1" />
              <div className="skeleton h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const pendingAttestations = (myAttestations || []).filter(a => a.status === 'pending' || a.status === 'overdue');
  const completedAttestations = (myAttestations || []).filter(a => a.status === 'completed');
  
  const filteredCompletedAttestations = showUnlinkedOnly 
    ? completedAttestations.filter(a => !a.linked_to_evidence)
    : completedAttestations;

  const selectedCompletedIds = selectedAttestations.filter(id => 
    completedAttestations.some(a => a.id === id && !a.linked_to_evidence)
  );

  const handleSelectAttestation = (id: number) => {
    setSelectedAttestations(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSelectAllCompleted = () => {
    const unlinkedCompletedIds = filteredCompletedAttestations
      .filter(a => !a.linked_to_evidence)
      .map(a => a.id);
    
    if (unlinkedCompletedIds.every(id => selectedAttestations.includes(id))) {
      setSelectedAttestations(prev => prev.filter(id => !unlinkedCompletedIds.includes(id)));
    } else {
      setSelectedAttestations(prev => Array.from(new Set([...prev, ...unlinkedCompletedIds])));
    }
  };

  const handleBulkLinkToEvidence = () => {
    if (selectedCompletedIds.length === 0) {
      toast({
        title: 'No Selection',
        message: 'Please select completed attestations to link to evidence',
        type: 'warning',
      });
      return;
    }
    bulkLinkToEvidenceMutation.mutate(selectedCompletedIds);
  };

  const unlinkedCompletedCount = completedAttestations.filter(a => !a.linked_to_evidence).length;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Attestations & Certifications</h1>
            <p className="mt-0.5 text-xs text-slate-500">Manage attestation campaigns and track compliance certifications</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/governance/attestations/my" className="btn-secondary flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" strokeWidth={1.75} />
              My Attestations
            </Link>
            <Link href="/governance/attestations/campaigns" className="btn-secondary flex items-center gap-2">
              <Eye className="h-4 w-4" strokeWidth={1.75} />
              View All Campaigns
            </Link>
            <Link href="/governance/attestations/campaigns?action=new" className="btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              New Campaign
            </Link>
          </div>
        </div>
      </div>

      {dashboardError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-center gap-2 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
          Unable to load attestation metrics. Please retry.
        </div>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary-50">
              <ClipboardCheck className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{dashboard?.total_campaigns || 0}</p>
              <p className="text-xs text-slate-500">Total Campaigns</p>
            </div>
          </div>
        </div>

        <div className="card p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-amber-50">
              <Clock className="h-4 w-4 text-amber-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{dashboard?.pending_attestations || 0}</p>
              <p className="text-xs text-slate-500">Pending Attestations</p>
            </div>
          </div>
        </div>

        <div className="card p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-rose-50">
              <AlertTriangle className="h-4 w-4 text-rose-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{dashboard?.overdue_attestations || 0}</p>
              <p className="text-xs text-slate-500">Overdue</p>
            </div>
          </div>
        </div>

        <div className="card p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-emerald-50">
              <TrendingUp className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{dashboard?.completion_rate || 0}%</p>
              <p className="text-xs text-slate-500">Completion Rate</p>
            </div>
          </div>
        </div>
      </div>

      {pendingAttestations.length > 0 && (
        <div className="card p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-amber-600" strokeWidth={1.75} />
              My Pending Attestations
            </h3>
          </div>

          <div className="space-y-1.5">
            {pendingAttestations.map((attestation) => {
              const statusStyle = STATUS_COLORS[attestation.status] || STATUS_COLORS.pending;
              const StatusIcon = statusStyle.icon;
              const isOverdue = attestation.status === 'overdue';
              const isExpanded = expandedAttestation === attestation.id;

              return (
                <div key={attestation.id} className={`rounded border transition-all ${isOverdue ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
                  <button
                    type="button"
                    onClick={() => setExpandedAttestation(isExpanded ? null : attestation.id)}
                    className="w-full px-3 py-2 flex items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <h4 className="text-slate-900 font-medium text-sm truncate">{attestation.campaign_name}</h4>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 flex-shrink-0 ${statusStyle.bg} ${statusStyle.text}`}>
                        <StatusIcon className="h-3 w-3" strokeWidth={1.75} />
                        {attestation.status}
                      </span>
                      <span className="text-xs text-slate-400 flex-shrink-0 hidden sm:inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" strokeWidth={1.75} />
                        Due: {new Date(attestation.due_date).toLocaleDateString()}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 ml-2">{isExpanded ? '▲' : '▼'}</span>
                  </button>
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-slate-100 mt-1 pt-2">
                      <p className="text-slate-500 text-xs mb-2">{attestation.attestation_text}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400 capitalize">{attestation.attestation_type?.replace(/_/g, ' ')}</span>
                        <Link
                          href={`/governance/attestations/complete/${attestation.id}`}
                          className="btn-primary text-xs py-1 px-3 flex items-center gap-1.5"
                        >
                          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                          Complete Now
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {completedAttestations.length > 0 && (
        <div className="card p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.75} />
              Completed Attestations
            </h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowUnlinkedOnly(!showUnlinkedOnly)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  showUnlinkedOnly
                    ? 'bg-primary-50 text-primary-700 border border-primary-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                }`}
              >
                <Filter className="h-4 w-4" strokeWidth={1.75} />
                Unlinked Only ({unlinkedCompletedCount})
                {showUnlinkedOnly && <X className="h-3 w-3" strokeWidth={1.75} />}
              </button>
            </div>
          </div>

          {selectedCompletedIds.length > 0 && (
            <div className="mb-4 p-3 bg-primary-50 border border-primary-200 rounded-lg flex items-center justify-between">
              <span className="text-sm text-primary-700">
                {selectedCompletedIds.length} attestation(s) selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedAttestations([])}
                  className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1"
                >
                  Clear Selection
                </button>
                <button
                  onClick={handleBulkLinkToEvidence}
                  disabled={bulkLinkToEvidenceMutation.isPending}
                  className="btn-primary text-sm py-1.5 flex items-center gap-2"
                >
                  <Link2 className="h-4 w-4" strokeWidth={1.75} />
                  {bulkLinkToEvidenceMutation.isPending ? 'Linking...' : 'Bulk Link to Evidence'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-3 px-4 py-2 text-sm text-slate-600 border-b border-slate-200">
              <input
                type="checkbox"
                checked={
                  filteredCompletedAttestations.filter(a => !a.linked_to_evidence).length > 0 &&
                  filteredCompletedAttestations
                    .filter(a => !a.linked_to_evidence)
                    .every(a => selectedAttestations.includes(a.id))
                }
                onChange={handleSelectAllCompleted}
                className="rounded border-slate-300 bg-white text-primary-600 focus:ring-primary-500"
                disabled={filteredCompletedAttestations.filter(a => !a.linked_to_evidence).length === 0}
              />
              <span>Select All Unlinked</span>
            </div>

            {filteredCompletedAttestations.map((attestation) => {
              const isLinked = attestation.linked_to_evidence;

              return (
                <div key={attestation.id} className="p-4 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-4">
                    <input
                      type="checkbox"
                      checked={selectedAttestations.includes(attestation.id)}
                      onChange={() => handleSelectAttestation(attestation.id)}
                      disabled={isLinked}
                      className="rounded border-slate-300 bg-white text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <h4 className="text-slate-900 font-medium">{attestation.campaign_name}</h4>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" strokeWidth={1.75} />
                          completed
                        </span>
                        {isLinked && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 inline-flex items-center gap-1">
                            <Link2 className="h-3 w-3" strokeWidth={1.75} />
                            linked to evidence
                          </span>
                        )}
                      </div>
                      <p className="text-slate-600 text-sm line-clamp-1">{attestation.attestation_text}</p>
                      <div className="flex items-center gap-4 text-sm text-slate-700 mt-1">
                        <span className="capitalize">{attestation.attestation_type.replace('_', ' ')}</span>
                        <span>Completed: {new Date(attestation.due_date).toLocaleDateString()}</span>
                      </div>
                    </div>
                    {!isLinked && (
                      <button
                        onClick={() => linkToEvidenceMutation.mutate(attestation.id)}
                        disabled={linkToEvidenceMutation.isPending}
                        className="btn-secondary text-sm py-1.5 flex items-center gap-2"
                      >
                        <Link2 className="h-4 w-4" strokeWidth={1.75} />
                        Link to Evidence
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredCompletedAttestations.length === 0 && (
              <div className="text-center py-8 text-slate-600">
                {showUnlinkedOnly
                  ? 'All completed attestations have been linked to evidence'
                  : 'No completed attestations found'
                }
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-slate-900 flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
            Recent Campaigns
          </h3>
          <Link href="/governance/attestations/campaigns" className="text-primary-600 hover:text-primary-700 text-sm flex items-center gap-1">
            View All <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Campaign</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Type</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Duration</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Progress</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(recentCampaigns || []).map((campaign) => {
                const statusStyle = STATUS_COLORS[campaign.status] || STATUS_COLORS.draft;
                const StatusIcon = statusStyle.icon;

                return (
                  <tr key={campaign.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div>
                        <p className="text-slate-900 font-medium">{campaign.name}</p>
                        {campaign.description && (
                          <p className="text-xs text-slate-500">{campaign.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-slate-700 capitalize text-sm">{campaign.campaign_type?.replace(/_/g, ' ') ?? ''}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                        <StatusIcon className="h-3 w-3" strokeWidth={1.75} />
                        {campaign.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.due_date).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${campaign.completion_rate === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`}
                            style={{ width: `${campaign.completion_rate}%` }}
                          />
                        </div>
                        <span className="text-sm text-slate-600">{campaign.completion_rate}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/governance/attestations/campaigns/${campaign.id}`}
                        className="text-primary-600 hover:text-primary-700 text-sm"
                      >
                        View Details
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(!recentCampaigns || recentCampaigns.length === 0) && (
          <div className="text-center py-8">
            <ClipboardCheck className="h-12 w-12 text-slate-300 mx-auto mb-4" strokeWidth={1.75} />
            <p className="text-slate-600">No campaigns found</p>
            <Link href="/governance/attestations/campaigns?action=new" className="btn-primary mt-4 inline-flex items-center gap-2">
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Create First Campaign
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
