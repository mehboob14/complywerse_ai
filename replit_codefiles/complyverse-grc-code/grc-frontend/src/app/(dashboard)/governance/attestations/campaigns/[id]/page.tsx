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

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  draft: { bg: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-muted)' },
  active: { bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' },
  closed: { bg: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' },
};

const REQUEST_STATUS_STYLES: Record<string, { bg: string; color: string; icon: React.ElementType }> = {
  pending: { bg: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)', icon: Clock },
  completed: { bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)', icon: CheckCircle },
  overdue: { bg: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)', icon: AlertCircle },
  escalated: { bg: 'rgba(28, 43, 58, 0.06)', color: 'var(--color-base)', icon: AlertTriangle },
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
        <Link href="/governance/attestations/campaigns" className="inline-flex items-center gap-2 transition-colors" style={{ color: 'var(--color-muted)' }}>
          <ArrowLeft className="h-4 w-4" />
          Back to Campaigns
        </Link>
        <div className="card p-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4" style={{ color: 'var(--color-danger)' }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Campaign Not Found</h2>
          <p className="mb-6" style={{ color: 'var(--color-muted)' }}>The campaign you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
          <Link href="/governance/attestations/campaigns" className="btn-primary inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Link>
        </div>
      </div>
    );
  }

  const statusStyle = STATUS_STYLES[campaign.status] || STATUS_STYLES.draft;
  const filteredRequests = campaign.requests.filter(r => !statusFilter || r.status === statusFilter);
  const pendingRequests = campaign.requests.filter(a => a.status === 'pending' || a.status === 'overdue');

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/governance/attestations/campaigns" style={{ color: 'var(--color-muted)' }}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{campaign.name}</h1>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: statusStyle.bg, color: statusStyle.color }}
              >
                {campaign.status}
              </span>
            </div>
            <p className="mt-1" style={{ color: 'var(--color-muted)' }}>{campaign.description || `${campaign.attestation_type.replace('_', ' ')} attestation`}</p>
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
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Type</p>
            <p className="font-medium capitalize" style={{ color: 'var(--color-text)' }}>{campaign.attestation_type.replace('_', ' ')}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Duration</p>
            <p className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
              {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Total Requests</p>
            <p className="font-medium" style={{ color: 'var(--color-text)' }}>{campaign.total_requests}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Completed</p>
            <p className="font-medium" style={{ color: 'var(--color-success)' }}>{campaign.completed_requests}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Overdue</p>
            <p className="font-medium" style={{ color: 'var(--color-danger)' }}>{campaign.overdue_requests}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Progress</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-subtle)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${campaign.progress}%`, backgroundColor: 'var(--color-base)' }}
                />
              </div>
              <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{campaign.progress}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <FileCheck className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
            Attestation Statement
          </h3>
        </div>
        <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
          <p style={{ color: 'var(--color-text)' }}>{campaign.attestation_text}</p>
        </div>
        {campaign.requires_evidence && (
          <p className="text-sm mt-2 flex items-center gap-1.5" style={{ color: 'var(--color-warning)' }}>
            <AlertCircle className="h-4 w-4" />
            Evidence upload is required for this attestation
          </p>
        )}
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Users className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
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
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th className="text-left py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selectedRequests.length === filteredRequests.length && filteredRequests.length > 0}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                  />
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>User</th>
                <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>Department</th>
                <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>Completed</th>
                <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>Evidence</th>
                <th className="text-left py-3 px-4 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map((request) => {
                const rstyle = REQUEST_STATUS_STYLES[request.status] || REQUEST_STATUS_STYLES.pending;
                const StatusIcon = rstyle.icon;

                return (
                  <tr key={request.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={selectedRequests.includes(request.id)}
                        onChange={(e) => handleSelectRequest(request.id, e.target.checked)}
                        className="rounded"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
                        <div>
                          <p className="font-medium" style={{ color: 'var(--color-text)' }}>{request.user_name}</p>
                          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{request.user_email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm" style={{ color: 'var(--color-muted)' }}>
                      {request.department || '-'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className="px-2 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1"
                        style={{ backgroundColor: rstyle.bg, color: rstyle.color }}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {request.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm" style={{ color: 'var(--color-muted)' }}>
                      {request.completed_at ? new Date(request.completed_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="py-3 px-4">
                      {request.has_evidence ? (
                        <span className="text-sm" style={{ color: 'var(--color-success)' }}>Yes</span>
                      ) : (
                        <span className="text-sm" style={{ color: 'var(--color-muted)' }}>No</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {(request.status === 'pending' || request.status === 'overdue') && (
                          <>
                            <button
                              onClick={() => sendReminderMutation.mutate(request.id)}
                              className="p-1.5 rounded transition-colors"
                              style={{ color: 'var(--color-muted)' }}
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
                              className="p-1.5 rounded transition-colors"
                              style={{ color: 'var(--color-muted)' }}
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
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <BarChart3 className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
            Status Summary
          </h3>
          <div className="space-y-3">
            {Object.entries(REQUEST_STATUS_STYLES).map(([status, style]) => {
              const count = campaign.requests.filter(a => a.status === status).length;
              const StatusIcon = style.icon;
              return (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon className="h-4 w-4" style={{ color: style.color }} />
                    <span className="capitalize" style={{ color: 'var(--color-text)' }}>{status}</span>
                  </div>
                  <span className="font-medium" style={{ color: style.color }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <AlertCircle className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
            Pending Actions
          </h3>
          {pendingRequests.length > 0 ? (
            <div className="space-y-3">
              {pendingRequests.slice(0, 5).map((request) => (
                <div key={request.id} className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--color-subtle)' }}>
                  <div className="flex items-center gap-3">
                    <User className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
                    <div>
                      <p className="text-sm" style={{ color: 'var(--color-text)' }}>{request.user_name}</p>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{request.department}</p>
                    </div>
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded-full"
                    style={{ backgroundColor: REQUEST_STATUS_STYLES[request.status]?.bg, color: REQUEST_STATUS_STYLES[request.status]?.color }}
                  >
                    {request.status}
                  </span>
                </div>
              ))}
              {pendingRequests.length > 5 && (
                <p className="text-sm text-center" style={{ color: 'var(--color-muted)' }}>+ {pendingRequests.length - 5} more</p>
              )}
            </div>
          ) : (
            <p className="text-center py-4" style={{ color: 'var(--color-muted)' }}>All attestations completed</p>
          )}
        </div>
      </div>
    </div>
  );
}
