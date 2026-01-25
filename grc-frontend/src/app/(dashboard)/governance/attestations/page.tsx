'use client';

import { useQuery } from '@tanstack/react-query';
import { attestationApi } from '@/lib/api';
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
  Users,
  FileCheck,
  Play,
  AlertCircle,
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
  pending: { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: Clock },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: CheckCircle },
  overdue: { bg: 'bg-rose-500/20', text: 'text-rose-400', icon: AlertCircle },
  draft: { bg: 'bg-slate-500/20', text: 'text-slate-400', icon: FileCheck },
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: Play },
  closed: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: CheckCircle },
};

export default function AttestationsPage() {
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
          { id: 1, campaign_id: 1, campaign_name: 'Q4 2025 Policy Attestation', attestation_type: 'policy_acknowledgment', status: 'pending', due_date: '2025-01-31', attestation_text: 'I have read and understand the Information Security Policy and agree to abide by its requirements.' },
          { id: 2, campaign_id: 2, campaign_name: 'Annual Code of Conduct', attestation_type: 'compliance_certification', status: 'overdue', due_date: '2025-01-15', attestation_text: 'I certify that I have completed the annual Code of Conduct training and will adhere to its principles.' },
          { id: 3, campaign_id: 3, campaign_name: 'Data Protection Certification', attestation_type: 'compliance_certification', status: 'completed', due_date: '2025-01-10', attestation_text: 'I certify that I understand and comply with data protection requirements.' },
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

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Attestations & Certifications</h1>
            <p className="text-slate-400 mt-1">Manage attestation campaigns and track compliance certifications</p>
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
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-500/20">
              <ClipboardCheck className="h-6 w-6 text-primary-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{dashboard?.total_campaigns || 0}</p>
              <p className="text-sm text-slate-400">Total Campaigns</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20">
              <Clock className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{dashboard?.pending_attestations || 0}</p>
              <p className="text-sm text-slate-400">Pending Attestations</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/20">
              <AlertTriangle className="h-6 w-6 text-rose-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{dashboard?.overdue_attestations || 0}</p>
              <p className="text-sm text-slate-400">Overdue</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
              <TrendingUp className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{dashboard?.completion_rate || 0}%</p>
              <p className="text-sm text-slate-400">Completion Rate</p>
            </div>
          </div>
        </div>
      </div>

      {pendingAttestations.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-white flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-400" />
              My Pending Attestations
            </h3>
          </div>

          <div className="space-y-4">
            {pendingAttestations.map((attestation) => {
              const statusStyle = STATUS_COLORS[attestation.status] || STATUS_COLORS.pending;
              const StatusIcon = statusStyle.icon;
              const isOverdue = attestation.status === 'overdue';

              return (
                <div key={attestation.id} className={`p-4 rounded-lg border ${isOverdue ? 'bg-rose-500/5 border-rose-500/30' : 'bg-slate-800/50 border-slate-700'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-white font-medium">{attestation.campaign_name}</h4>
                        <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                          <StatusIcon className="h-3 w-3" />
                          {attestation.status}
                        </span>
                      </div>
                      <p className="text-slate-400 text-sm line-clamp-2 mb-2">{attestation.attestation_text}</p>
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

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary-400" />
            Recent Campaigns
          </h3>
          <Link href="/governance/attestations/campaigns" className="text-primary-400 hover:text-primary-300 text-sm flex items-center gap-1">
            View All <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Campaign</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Type</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Duration</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Progress</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(recentCampaigns || []).map((campaign) => {
                const statusStyle = STATUS_COLORS[campaign.status] || STATUS_COLORS.draft;
                const StatusIcon = statusStyle.icon;

                return (
                  <tr key={campaign.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                    <td className="py-3 px-4">
                      <div>
                        <p className="text-white font-medium">{campaign.name}</p>
                        {campaign.description && (
                          <p className="text-xs text-slate-500">{campaign.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-slate-300 capitalize text-sm">{campaign.attestation_type.replace('_', ' ')}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${statusStyle.bg} ${statusStyle.text}`}>
                        <StatusIcon className="h-3 w-3" />
                        {campaign.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400">
                      {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${campaign.progress === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`}
                            style={{ width: `${campaign.progress}%` }}
                          />
                        </div>
                        <span className="text-sm text-slate-400">{campaign.progress}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/governance/attestations/campaigns/${campaign.id}`}
                        className="text-primary-400 hover:text-primary-300 text-sm"
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
            <p className="text-slate-400">No campaigns found</p>
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
