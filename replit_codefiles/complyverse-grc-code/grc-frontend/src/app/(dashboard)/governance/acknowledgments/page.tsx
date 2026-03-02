'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { policyAcknowledgmentApi } from '@/lib/api';
import {
  FileText,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Send,
  Users,
  Loader2,
  AlertCircle,
  Mail,
  Eye,
} from 'lucide-react';

interface PolicyAckUser {
  user_id: number;
  user_name: string;
  email: string;
  status: string;
  completed_at: string | null;
  due_date: string | null;
}

interface PolicyAckSummary {
  document_id: number;
  document_title: string;
  total_required: number;
  completed: number;
  pending: number;
  overdue: number;
  completion_percentage: number;
}

interface DashboardData {
  total_policies: number;
  overall_completion_rate: number;
  total_pending: number;
  total_overdue: number;
  policies: PolicyAckSummary[];
}

interface OverdueItem {
  user_id: number;
  user_name: string;
  email: string;
  document_id: number;
  document_title: string;
  due_date: string;
  days_overdue: number;
}

function getCompletionColor(pct: number) {
  if (pct >= 80) return 'var(--color-success)';
  if (pct >= 50) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function getCompletionTextColor(pct: number) {
  if (pct >= 80) return 'var(--color-success)';
  if (pct >= 50) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function ProgressRing({ percentage, size = 80 }: { percentage: number; size?: number }) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;
  const color = getCompletionColor(percentage);

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="var(--color-border)"
        strokeWidth={strokeWidth}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-500"
      />
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    completed: { bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)', label: 'Completed' },
    pending: { bg: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)', label: 'Pending' },
    overdue: { bg: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)', label: 'Overdue' },
  };
  const style = styles[status] || styles.pending;
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: style.bg, color: style.color }}>
      {style.label}
    </span>
  );
}

function PolicyDetailPanel({ documentId, onClose }: { documentId: number; onClose: () => void }) {
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery({
    queryKey: ['policy-ack-users', documentId],
    queryFn: async () => {
      const response = await policyAcknowledgmentApi.getPolicyUsers(documentId);
      return response.data as PolicyAckUser[];
    },
  });

  const sendReminderMutation = useMutation({
    mutationFn: async (docId: number) => {
      await policyAcknowledgmentApi.sendReminders(docId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-ack-users', documentId] });
    },
  });

  return (
    <div className="mt-2 rounded-lg p-4" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>User Acknowledgment Status</h4>
        <button onClick={onClose} className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Close
        </button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
        </div>
      ) : !users || users.length === 0 ? (
        <p className="text-sm text-center py-4" style={{ color: 'var(--color-muted)' }}>No users assigned to this policy</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--color-muted)' }}>User</th>
                <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--color-muted)' }}>Email</th>
                <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--color-muted)' }}>Status</th>
                <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--color-muted)' }}>Completed At</th>
                <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--color-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.user_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="py-2 px-3" style={{ color: 'var(--color-text)' }}>{user.user_name}</td>
                  <td className="py-2 px-3" style={{ color: 'var(--color-muted)' }}>{user.email}</td>
                  <td className="py-2 px-3">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="py-2 px-3" style={{ color: 'var(--color-muted)' }}>
                    {user.completed_at
                      ? new Date(user.completed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                      : '-'}
                  </td>
                  <td className="py-2 px-3">
                    {(user.status === 'overdue' || user.status === 'pending') && (
                      <button
                        onClick={() => sendReminderMutation.mutate(documentId)}
                        disabled={sendReminderMutation.isPending}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors"
                        style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' }}
                      >
                        <Mail className="h-3 w-3" />
                        Send Reminder
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PolicyAcknowledgmentPage() {
  const [activeTab, setActiveTab] = useState<'policies' | 'overdue'>('policies');
  const [expandedPolicy, setExpandedPolicy] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['policy-ack-dashboard'],
    queryFn: async () => {
      const response = await policyAcknowledgmentApi.getDashboard();
      return response.data as DashboardData;
    },
  });

  const { data: overdueItems, isLoading: overdueLoading } = useQuery({
    queryKey: ['policy-ack-overdue'],
    queryFn: async () => {
      const response = await policyAcknowledgmentApi.getOverdue();
      return response.data as OverdueItem[];
    },
    enabled: activeTab === 'overdue',
  });

  const sendRemindersMutation = useMutation({
    mutationFn: async (documentId: number) => {
      await policyAcknowledgmentApi.sendReminders(documentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-ack-dashboard'] });
    },
  });

  if (dashboardLoading) {
    return (
      <div className="space-y-8">
        <div>
          <div className="h-8 w-72 rounded animate-pulse mb-2" style={{ backgroundColor: 'var(--color-subtle)' }} />
          <div className="h-5 w-96 rounded animate-pulse" style={{ backgroundColor: 'var(--color-subtle)' }} />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card">
              <div className="h-12 w-12 rounded-xl animate-pulse mb-4" style={{ backgroundColor: 'var(--color-subtle)' }} />
              <div className="h-8 w-20 rounded animate-pulse mb-2" style={{ backgroundColor: 'var(--color-subtle)' }} />
              <div className="h-4 w-32 rounded animate-pulse" style={{ backgroundColor: 'var(--color-subtle)' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const totalPolicies = dashboard?.total_policies || 0;
  const overallRate = dashboard?.overall_completion_rate || 0;
  const totalPending = dashboard?.total_pending || 0;
  const totalOverdue = dashboard?.total_overdue || 0;
  const policies = dashboard?.policies || [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3" style={{ color: 'var(--color-text)' }}>
          <FileText className="h-7 w-7 text-primary-400" />
          Policy Acknowledgment Tracking
        </h1>
        <p className="mt-1" style={{ color: 'var(--color-muted)' }}>
          Track and manage policy acknowledgments across your organization
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <FileText className="h-6 w-6 text-primary-400" />
            </div>
          </div>
          <p className="stat-value">{totalPolicies}</p>
          <p className="stat-label">Total Policies Tracked</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(45, 106, 79, 0.1)' }}>
              <div className="relative">
                <ProgressRing percentage={overallRate} size={48} />
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: getCompletionTextColor(overallRate) }}>
                  {Math.round(overallRate)}%
                </span>
              </div>
            </div>
          </div>
          <p className="stat-value">{Math.round(overallRate)}%</p>
          <p className="stat-label">Overall Completion Rate</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(146, 87, 14, 0.1)' }}>
              <Clock className="h-6 w-6" style={{ color: 'var(--color-warning)' }} />
            </div>
          </div>
          <p className="stat-value">{totalPending}</p>
          <p className="stat-label">Total Pending</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)' }}>
              <AlertTriangle className="h-6 w-6" style={{ color: 'var(--color-danger)' }} />
            </div>
          </div>
          <p className="stat-value">{totalOverdue}</p>
          <p className="stat-label">Total Overdue</p>
        </div>
      </div>

      <div className="flex gap-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button
          onClick={() => setActiveTab('policies')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'policies'
              ? 'border-primary-500 text-primary-400'
              : 'border-transparent'
          }`}
          style={activeTab !== 'policies' ? { color: 'var(--color-muted)' } : undefined}
        >
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Policy Breakdown
          </span>
        </button>
        <button
          onClick={() => setActiveTab('overdue')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'overdue'
              ? 'border-b-2'
              : 'border-transparent'
          }`}
          style={activeTab === 'overdue' ? { borderColor: 'var(--color-danger)', color: 'var(--color-danger)' } : { color: 'var(--color-muted)' }}
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Overdue ({totalOverdue})
          </span>
        </button>
      </div>

      {activeTab === 'policies' && (
        <div className="space-y-4">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>Policy Name</th>
                  <th>Total Required</th>
                  <th>Completed</th>
                  <th>Pending</th>
                  <th>Overdue</th>
                  <th>Completion %</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12">
                      <FileText className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--color-muted)' }} />
                      <p style={{ color: 'var(--color-muted)' }}>No policies tracked yet</p>
                      <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                        Publish policies and assign acknowledgments to start tracking
                      </p>
                    </td>
                  </tr>
                ) : (
                  policies.map((policy) => (
                    <>
                      <tr key={policy.document_id}>
                        <td>
                          <button
                            onClick={() =>
                              setExpandedPolicy(
                                expandedPolicy === policy.document_id ? null : policy.document_id
                              )
                            }
                            style={{ color: 'var(--color-muted)' }}
                          >
                            {expandedPolicy === policy.document_id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td>
                          <span className="font-medium" style={{ color: 'var(--color-text)' }}>{policy.document_title}</span>
                        </td>
                        <td style={{ color: 'var(--color-text)' }}>{policy.total_required}</td>
                        <td>
                          <span style={{ color: 'var(--color-success)' }}>{policy.completed}</span>
                        </td>
                        <td>
                          <span style={{ color: 'var(--color-warning)' }}>{policy.pending}</span>
                        </td>
                        <td>
                          <span style={{ color: 'var(--color-danger)' }}>{policy.overdue}</span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2 min-w-[140px]">
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-subtle)' }}>
                              <div
                                className="h-full transition-all duration-300"
                                style={{ width: `${policy.completion_percentage}%`, backgroundColor: getCompletionColor(policy.completion_percentage) }}
                              />
                            </div>
                            <span className="text-sm font-medium" style={{ color: getCompletionTextColor(policy.completion_percentage) }}>
                              {Math.round(policy.completion_percentage)}%
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() =>
                                setExpandedPolicy(
                                  expandedPolicy === policy.document_id ? null : policy.document_id
                                )
                              }
                              className="btn-ghost btn-sm"
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => sendRemindersMutation.mutate(policy.document_id)}
                              disabled={sendRemindersMutation.isPending || policy.pending + policy.overdue === 0}
                              className="btn-ghost btn-sm"
                              title="Send Reminders"
                              style={{ color: 'var(--color-base)' }}
                            >
                              <Send className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedPolicy === policy.document_id && (
                        <tr key={`detail-${policy.document_id}`}>
                          <td colSpan={8} className="p-0">
                            <div className="px-4 pb-4">
                              <PolicyDetailPanel
                                documentId={policy.document_id}
                                onClose={() => setExpandedPolicy(null)}
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'overdue' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />
                Overdue Acknowledgments
              </h2>
              <p className="card-description">All overdue policy acknowledgments across the organization</p>
            </div>
          </div>
          {overdueLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
            </div>
          ) : !overdueItems || overdueItems.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--color-success)' }} />
              <p className="font-medium" style={{ color: 'var(--color-text)' }}>No Overdue Acknowledgments</p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>All policy acknowledgments are up to date</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Policy</th>
                    <th>Due Date</th>
                    <th>Days Overdue</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueItems.map((item, idx) => (
                    <tr key={idx}>
                      <td className="font-medium" style={{ color: 'var(--color-text)' }}>{item.user_name}</td>
                      <td style={{ color: 'var(--color-muted)' }}>{item.email}</td>
                      <td style={{ color: 'var(--color-text)' }}>{item.document_title}</td>
                      <td style={{ color: 'var(--color-muted)' }}>
                        {new Date(item.due_date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)' }}>
                          {item.days_overdue} days
                        </span>
                      </td>
                      <td>
                        <button
                          onClick={() => sendRemindersMutation.mutate(item.document_id)}
                          disabled={sendRemindersMutation.isPending}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors"
                          style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' }}
                        >
                          <Mail className="h-3 w-3" />
                          Send Reminder
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
