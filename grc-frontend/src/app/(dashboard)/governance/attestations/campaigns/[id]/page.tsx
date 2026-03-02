'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { attestationApi } from '@/lib/api';
import {
  ClipboardCheck,
  ArrowLeft,
  Play,
  XCircle,
  Download,
  Send,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  BarChart3,
  Users,
  FileCheck,
  Mail,
  AlertTriangle,
  User,
} from 'lucide-react';
import Link from 'next/link';

interface AttestationRequest {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  department?: string;
  status: 'pending' | 'completed' | 'overdue' | 'escalated';
  completed_at?: string;
  comments?: string;
  has_evidence: boolean;
}

interface Campaign {
  id: number;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'closed';
  attestation_type: string;
  attestation_text: string;
  start_date: string;
  end_date: string;
  total_requests: number;
  completed_requests: number;
  overdue_requests: number;
  progress: number;
  requires_evidence: boolean;
  requests: AttestationRequest[];
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  closed: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
};

const REQUEST_STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  pending: { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: Clock },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: CheckCircle },
  overdue: { bg: 'bg-rose-500/20', text: 'text-rose-400', icon: AlertCircle },
  escalated: { bg: 'bg-purple-500/20', text: 'text-purple-400', icon: AlertTriangle },
};

export default function CampaignDetailPage() {
  const params = useParams();
  const campaignId = Number(params.id);
  const queryClient = useQueryClient();

  const [selectedRequests, setSelectedRequests] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: campaign, isLoading, error } = useQuery({
    queryKey: ['attestation-campaign', campaignId],
    queryFn: async () => {
      const response = await attestationApi.getCampaign(campaignId);
      return response.data as Campaign;
    },
  });

  const activateMutation = useMutation({
    mutationFn: () => attestationApi.activateCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaign', campaignId] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => attestationApi.closeCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaign', campaignId] });
    },
  });

  const sendReminderMutation = useMutation({
    mutationFn: (requestId: number) => attestationApi.sendReminder(requestId),
    onSuccess: () => {
      alert('Reminder sent successfully');
    },
  });

  const escalateMutation = useMutation({
    mutationFn: (requestId: number) => attestationApi.escalateRequest(requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attestation-campaign', campaignId] });
      alert('Request escalated');
    },
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const filteredIds = filteredRequests.map(r => r.id);
      setSelectedRequests(filteredIds);
    } else {
      setSelectedRequests([]);
    }
  };

  const handleSelectRequest = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedRequests([...selectedRequests, id]);
    } else {
      setSelectedRequests(selectedRequests.filter(rid => rid !== id));
    }
  };

  const handleBulkReminder = () => {
    if (confirm(`Send reminders to ${selectedRequests.length} users?`)) {
      selectedRequests.forEach(id => sendReminderMutation.mutate(id));
      setSelectedRequests([]);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="skeleton h-8 w-64 mb-2" />
        <div className="skeleton h-5 w-96" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="card p-4">
              <div className="skeleton h-6 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="space-y-8">
        <Link href="/governance/attestations/campaigns" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Campaigns
        </Link>
        <div className="card p-12 text-center">
          <AlertCircle className="h-12 w-12 text-rose-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Campaign Not Found</h2>
          <p className="text-slate-400 mb-6">The campaign you're looking for doesn't exist or you don't have access to it.</p>
          <Link href="/governance/attestations/campaigns" className="btn-primary inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Link>
        </div>
      </div>
    );
  }

  const statusStyle = STATUS_COLORS[campaign.status] || STATUS_COLORS.draft;
  const filteredRequests = campaign.requests.filter(r => !statusFilter || r.status === statusFilter);
  const pendingRequests = campaign.requests.filter(a => a.status === 'pending' || a.status === 'overdue');

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/governance/attestations/campaigns" className="text-slate-400 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-white">{campaign.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                {campaign.status}
              </span>
            </div>
            <p className="text-slate-400 mt-1">{campaign.description || `${campaign.attestation_type.replace('_', ' ')} attestation`}</p>
          </div>
          <div className="flex items-center gap-3">
            {campaign.status === 'draft' && (
              <button
                onClick={() => {
                  if (confirm('Activate this campaign? This will send attestation requests to all target users.')) {
                    activateMutation.mutate();
                  }
                }}
                className="btn-primary flex items-center gap-2"
                disabled={activateMutation.isPending}
              >
                <Play className="h-4 w-4" />
                Activate Campaign
              </button>
            )}
            {campaign.status === 'active' && (
              <button
                onClick={() => {
                  if (confirm('Close this campaign?')) {
                    closeMutation.mutate();
                  }
                }}
                className="btn-secondary flex items-center gap-2"
                disabled={closeMutation.isPending}
              >
                <XCircle className="h-4 w-4" />
                Close Campaign
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-6">
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Type</p>
            <p className="text-white font-medium capitalize">{campaign.attestation_type.replace('_', ' ')}</p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Duration</p>
            <p className="text-white font-medium text-sm">
              {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Total Requests</p>
            <p className="text-white font-medium">{campaign.total_requests}</p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Completed</p>
            <p className="text-emerald-400 font-medium">{campaign.completed_requests}</p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Overdue</p>
            <p className="text-rose-400 font-medium">{campaign.overdue_requests}</p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Progress</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full"
                  style={{ width: `${campaign.progress}%` }}
                />
              </div>
              <span className="text-white font-medium text-sm">{campaign.progress}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-primary-400" />
            Attestation Statement
          </h3>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
          <p className="text-slate-300">{campaign.attestation_text}</p>
        </div>
        {campaign.requires_evidence && (
          <p className="text-sm text-amber-400 mt-2 flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" />
            Evidence upload is required for this attestation
          </p>
        )}
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-primary-400" />
            Attestation Requests ({filteredRequests.length})
          </h3>
          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input text-sm"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="overdue">Overdue</option>
              <option value="escalated">Escalated</option>
            </select>
            {selectedRequests.length > 0 && (
              <button
                onClick={handleBulkReminder}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Mail className="h-4 w-4" />
                Send Reminder ({selectedRequests.length})
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selectedRequests.length === filteredRequests.length && filteredRequests.length > 0}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-700 text-primary-500 focus:ring-primary-500"
                  />
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">User</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Department</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Completed</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Evidence</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map((request) => {
                const rstyle = REQUEST_STATUS_COLORS[request.status] || REQUEST_STATUS_COLORS.pending;
                const StatusIcon = rstyle.icon;

                return (
                  <tr key={request.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={selectedRequests.includes(request.id)}
                        onChange={(e) => handleSelectRequest(request.id, e.target.checked)}
                        className="rounded border-slate-600 bg-slate-700 text-primary-500 focus:ring-primary-500"
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-slate-400" />
                        <div>
                          <p className="text-white font-medium">{request.user_name}</p>
                          <p className="text-xs text-slate-500">{request.user_email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-sm">
                      {request.department || '-'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${rstyle.bg} ${rstyle.text}`}>
                        <StatusIcon className="h-3 w-3" />
                        {request.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400">
                      {request.completed_at ? new Date(request.completed_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="py-3 px-4">
                      {request.has_evidence ? (
                        <span className="text-emerald-400 text-sm">Yes</span>
                      ) : (
                        <span className="text-slate-500 text-sm">No</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {(request.status === 'pending' || request.status === 'overdue') && (
                          <>
                            <button
                              onClick={() => sendReminderMutation.mutate(request.id)}
                              className="p-1.5 text-slate-400 hover:text-primary-400 hover:bg-primary-500/20 rounded"
                              title="Send Reminder"
                            >
                              <Send className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Escalate this request to management?')) {
                                  escalateMutation.mutate(request.id);
                                }
                              }}
                              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-amber-500/20 rounded"
                              title="Escalate"
                            >
                              <AlertTriangle className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary-400" />
            Status Summary
          </h3>
          <div className="space-y-3">
            {Object.entries(REQUEST_STATUS_COLORS).map(([status, style]) => {
              const count = campaign.requests.filter(a => a.status === status).length;
              const StatusIcon = style.icon;
              return (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon className={`h-4 w-4 ${style.text}`} />
                    <span className="text-slate-300 capitalize">{status}</span>
                  </div>
                  <span className={`font-medium ${style.text}`}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-400" />
            Pending Actions
          </h3>
          {pendingRequests.length > 0 ? (
            <div className="space-y-3">
              {pendingRequests.slice(0, 5).map((request) => (
                <div key={request.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <User className="h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-white text-sm">{request.user_name}</p>
                      <p className="text-xs text-slate-500">{request.department}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${REQUEST_STATUS_COLORS[request.status]?.bg} ${REQUEST_STATUS_COLORS[request.status]?.text}`}>
                    {request.status}
                  </span>
                </div>
              ))}
              {pendingRequests.length > 5 && (
                <p className="text-sm text-slate-500 text-center">+ {pendingRequests.length - 5} more</p>
              )}
            </div>
          ) : (
            <p className="text-slate-400 text-center py-4">All attestations completed</p>
          )}
        </div>
      </div>
    </div>
  );
}
