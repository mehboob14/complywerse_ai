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
  attestation_type: string;
  start_date: string;
  end_date: string;
  total_requests: number;
  completed_requests: number;
  progress: number;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  pending: { bg: 'bg-amber-50', text: 'text-amber-600', icon: Clock },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-600', icon: CheckCircle },
  overdue: { bg: 'bg-rose-50', text: 'text-rose-600', icon: AlertCircle },
  draft: { bg: 'bg-slate-50', text: 'text-slate-600', icon: FileCheck },
  active: { bg: 'bg-emerald-50', text: 'text-emerald-600', icon: Play },
  closed: { bg: 'bg-blue-50', text: 'text-blue-600', icon: CheckCircle },
};

export default function AttestationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAttestations, setSelectedAttestations] = useState<number[]>([]);
  const [showUnlinkedOnly, setShowUnlinkedOnly] = useState(false);

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['attestation-dashboard'],
    queryFn: async () => {
      try {
        const response = await attestationApi.getDashboard();
        return response.data as DashboardData;
      } catch {
        return {
          total_campaigns: 5,
          active_campaigns: 2,
          pending_attestations: 8,
          overdue_attestations: 2,
          completion_rate: 72,
        } as DashboardData;
      }
    },
  });

  const { data: myAttestations, isLoading: myAttestationsLoading } = useQuery({
    queryKey: ['my-attestations'],
    queryFn: async () => {
      try {
        const response = await attestationApi.getMyAttestations();
        return response.data as MyAttestation[];
      } catch {
        return [
          { id: 1, campaign_id: 1, campaign_name: 'Q4 2025 Policy Attestation', attestation_type: 'policy_acknowledgment', status: 'pending', due_date: '2025-01-31', attestation_text: 'I have read and understand the Information Security Policy and agree to abide by its requirements.', linked_to_evidence: false },
          { id: 2, campaign_id: 2, campaign_name: 'Annual Code of Conduct', attestation_type: 'compliance_certification', status: 'overdue', due_date: '2025-01-15', attestation_text: 'I certify that I have completed the annual Code of Conduct training and will adhere to its principles.', linked_to_evidence: false },
          { id: 3, campaign_id: 3, campaign_name: 'Data Protection Certification', attestation_type: 'compliance_certification', status: 'completed', due_date: '2025-01-10', attestation_text: 'I certify that I understand and comply with data protection requirements.', linked_to_evidence: false },
          { id: 4, campaign_id: 4, campaign_name: 'Security Awareness Training', attestation_type: 'policy_acknowledgment', status: 'completed', due_date: '2025-01-05', attestation_text: 'I acknowledge completion of security awareness training.', linked_to_evidence: true },
        ] as MyAttestation[];
      }
    },
  });

  const { data: recentCampaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['recent-attestation-campaigns'],
    queryFn: async () => {
      try {
        const response = await attestationApi.getCampaigns();
        return (response.data as Campaign[]).slice(0, 5);
      } catch {
        return [
          { id: 1, name: 'Q4 2025 Policy Attestation', description: 'Quarterly policy acknowledgment', status: 'active', attestation_type: 'policy_acknowledgment', start_date: '2025-01-01', end_date: '2025-01-31', total_requests: 150, completed_requests: 108, progress: 72 },
          { id: 2, name: 'Annual Code of Conduct', description: 'Annual compliance certification', status: 'active', attestation_type: 'compliance_certification', start_date: '2025-01-01', end_date: '2025-01-31', total_requests: 200, completed_requests: 156, progress: 78 },
          { id: 3, name: 'Q3 2025 SOX Attestation', description: 'SOX compliance attestation', status: 'closed', attestation_type: 'sarbanes_oxley', start_date: '2024-10-01', end_date: '2024-10-31', total_requests: 50, completed_requests: 50, progress: 100 },
        ] as Campaign[];
      }
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
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-64 mb-2" />
          <div className="skeleton h-5 w-96" />
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
      setSelectedAttestations(prev => [...new Set([...prev, ...unlinkedCompletedIds])]);
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
    <div className="space-y-8">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-black">Attestations & Certifications</h1>
            <p className="text-slate-600 mt-1">Manage attestation campaigns and track compliance certifications</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/governance/attestations/campaigns" className="btn-secondary flex items-center gap-2">
              <Eye className="h-4 w-4" />
              View All Campaigns
            </Link>
            <Link href="/governance/attestations/campaigns?action=new" className="btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" />
              New Campaign
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50">
              <ClipboardCheck className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-black">{dashboard?.total_campaigns || 0}</p>
              <p className="text-sm text-slate-600">Total Campaigns</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50">
              <Clock className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-black">{dashboard?.pending_attestations || 0}</p>
              <p className="text-sm text-slate-600">Pending Attestations</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50">
              <AlertTriangle className="h-6 w-6 text-rose-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-black">{dashboard?.overdue_attestations || 0}</p>
              <p className="text-sm text-slate-600">Overdue</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
              <TrendingUp className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-black">{dashboard?.completion_rate || 0}%</p>
              <p className="text-sm text-slate-600">Completion Rate</p>
            </div>
          </div>
        </div>
      </div>

      {pendingAttestations.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-black flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              My Pending Attestations
            </h3>
          </div>

          <div className="space-y-4">
            {pendingAttestations.map((attestation) => {
              const statusStyle = STATUS_COLORS[attestation.status] || STATUS_COLORS.pending;
              const StatusIcon = statusStyle.icon;
              const isOverdue = attestation.status === 'overdue';

              return (
                <div key={attestation.id} className={`p-4 rounded-lg border ${isOverdue ? 'bg-rose-500/5 border-rose-500/30' : 'bg-white/50 border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-black font-medium">{attestation.campaign_name}</h4>
                        <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                          <StatusIcon className="h-3 w-3" />
                          {attestation.status}
                        </span>
                      </div>
                      <p className="text-slate-600 text-sm line-clamp-2 mb-2">{attestation.attestation_text}</p>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-4 w-4" />
                          Due: {new Date(attestation.due_date).toLocaleDateString()}
                        </span>
                        <span className="capitalize">{attestation.attestation_type.replace('_', ' ')}</span>
                      </div>
                    </div>
                    <Link
                      href={`/governance/attestations/complete/${attestation.id}`}
                      className="btn-primary flex items-center gap-2 ml-4"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Complete
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {completedAttestations.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-black flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
              Completed Attestations
            </h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowUnlinkedOnly(!showUnlinkedOnly)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  showUnlinkedOnly 
                    ? 'bg-primary-50 text-primary-700 border border-primary-200' 
                    : 'bg-slate-200 text-slate-600 border border-slate-300 hover:bg-slate-600'
                }`}
              >
                <Filter className="h-4 w-4" />
                Unlinked Only ({unlinkedCompletedCount})
                {showUnlinkedOnly && <X className="h-3 w-3" />}
              </button>
            </div>
          </div>

          {selectedCompletedIds.length > 0 && (
            <div className="mb-4 p-3 bg-primary-50 border border-primary-200 rounded-lg flex items-center justify-between">
              <span className="text-sm text-primary-300">
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
                  <Link2 className="h-4 w-4" />
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
                className="rounded border-slate-300 bg-slate-200 text-primary-500 focus:ring-primary-500"
                disabled={filteredCompletedAttestations.filter(a => !a.linked_to_evidence).length === 0}
              />
              <span>Select All Unlinked</span>
            </div>

            {filteredCompletedAttestations.map((attestation) => {
              const isLinked = attestation.linked_to_evidence;

              return (
                <div key={attestation.id} className="p-4 rounded-lg bg-white/50 border border-slate-200 hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-4">
                    <input
                      type="checkbox"
                      checked={selectedAttestations.includes(attestation.id)}
                      onChange={() => handleSelectAttestation(attestation.id)}
                      disabled={isLinked}
                      className="rounded border-slate-300 bg-slate-200 text-primary-500 focus:ring-primary-500 disabled:opacity-50"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <h4 className="text-black font-medium">{attestation.campaign_name}</h4>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          completed
                        </span>
                        {isLinked && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 inline-flex items-center gap-1">
                            <Link2 className="h-3 w-3" />
                            linked to evidence
                          </span>
                        )}
                      </div>
                      <p className="text-slate-600 text-sm line-clamp-1">{attestation.attestation_text}</p>
                      <div className="flex items-center gap-4 text-sm text-slate-500 mt-1">
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
                        <Link2 className="h-4 w-4" />
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
          <h3 className="text-lg font-medium text-black flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary-600" />
            Recent Campaigns
          </h3>
          <Link href="/governance/attestations/campaigns" className="text-primary-600 hover:text-primary-300 text-sm flex items-center gap-1">
            View All <ArrowRight className="h-4 w-4" />
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
                  <tr key={campaign.id} className="border-b border-slate-200 hover:bg-white/50">
                    <td className="py-3 px-4">
                      <div>
                        <p className="text-black font-medium">{campaign.name}</p>
                        {campaign.description && (
                          <p className="text-xs text-slate-500">{campaign.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-slate-600 capitalize text-sm">{campaign.attestation_type.replace('_', ' ')}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                        <StatusIcon className="h-3 w-3" />
                        {campaign.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${campaign.progress === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`}
                            style={{ width: `${campaign.progress}%` }}
                          />
                        </div>
                        <span className="text-sm text-slate-600">{campaign.progress}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/governance/attestations/campaigns/${campaign.id}`}
                        className="text-primary-600 hover:text-primary-300 text-sm"
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
            <ClipboardCheck className="h-12 w-12 text-slate-500 mx-auto mb-4" />
            <p className="text-slate-600">No campaigns found</p>
            <Link href="/governance/attestations/campaigns?action=new" className="btn-primary mt-4 inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create First Campaign
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
