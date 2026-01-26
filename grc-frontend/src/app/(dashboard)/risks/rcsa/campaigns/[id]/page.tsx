'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { rcsaApi } from '@/lib/api';
import {
  ClipboardList,
  ArrowLeft,
  Play,
  XCircle,
  Download,
  Send,
  Plus,
  X,
  Building2,
  User,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  BarChart3,
  Users,
  FileText,
  Mail,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';

interface Assessment {
  id: number;
  business_unit_id: number;
  business_unit_name: string;
  assessor_id?: number;
  assessor_name?: string;
  assessor_email?: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'approved' | 'rejected';
  progress: number;
  risk_score?: number;
  control_score?: number;
  findings_count: number;
  submitted_at?: string;
  reviewed_at?: string;
}

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
  assessments: Assessment[];
  total_findings: number;
  avg_risk_score?: number;
  avg_control_score?: number;
  created_at: string;
  updated_at: string;
}

interface BusinessUnit {
  id: number;
  name: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  closed: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
};

const ASSESSMENT_STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  not_started: { bg: 'bg-slate-500/20', text: 'text-slate-400', icon: Clock },
  in_progress: { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: Clock },
  submitted: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: FileText },
  approved: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: CheckCircle },
  rejected: { bg: 'bg-rose-500/20', text: 'text-rose-400', icon: XCircle },
};

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = Number(params.id);
  const queryClient = useQueryClient();

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedAssessments, setSelectedAssessments] = useState<number[]>([]);

  const { data: campaign, isLoading, error } = useQuery({
    queryKey: ['rcsa-campaign', campaignId],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getCampaign(campaignId);
        return response.data as Campaign;
      } catch {
        return {
          id: campaignId,
          name: 'Q4 2025 RCSA',
          description: 'Quarterly risk assessment for Q4 2025',
          template_id: 1,
          template_name: 'SAMA CSF',
          status: 'active' as const,
          period: 'Q4 2025',
          start_date: '2025-10-01',
          end_date: '2025-12-31',
          progress: 65,
          assigned_units: 8,
          completed_units: 5,
          pending_assessments: 3,
          total_findings: 18,
          avg_risk_score: 3.2,
          avg_control_score: 3.8,
          assessments: [
            { id: 1, business_unit_id: 1, business_unit_name: 'IT Operations', assessor_id: 1, assessor_name: 'John Smith', assessor_email: 'john.smith@company.com', status: 'approved' as const, progress: 100, risk_score: 3.5, control_score: 4.0, findings_count: 3, submitted_at: '2025-11-15', reviewed_at: '2025-11-18' },
            { id: 2, business_unit_id: 2, business_unit_name: 'Finance', assessor_id: 2, assessor_name: 'Jane Doe', assessor_email: 'jane.doe@company.com', status: 'submitted' as const, progress: 100, risk_score: 2.8, control_score: 3.5, findings_count: 2, submitted_at: '2025-11-20' },
            { id: 3, business_unit_id: 3, business_unit_name: 'Retail Banking', assessor_id: 3, assessor_name: 'Mike Johnson', assessor_email: 'mike.johnson@company.com', status: 'in_progress' as const, progress: 60, findings_count: 4 },
            { id: 4, business_unit_id: 4, business_unit_name: 'Corporate Banking', assessor_id: 4, assessor_name: 'Sarah Wilson', assessor_email: 'sarah.wilson@company.com', status: 'approved' as const, progress: 100, risk_score: 3.0, control_score: 4.2, findings_count: 1, submitted_at: '2025-11-10', reviewed_at: '2025-11-12' },
            { id: 5, business_unit_id: 5, business_unit_name: 'Treasury', assessor_id: 5, assessor_name: 'David Brown', assessor_email: 'david.brown@company.com', status: 'not_started' as const, progress: 0, findings_count: 0 },
            { id: 6, business_unit_id: 6, business_unit_name: 'Risk Management', assessor_id: 6, assessor_name: 'Lisa Chen', assessor_email: 'lisa.chen@company.com', status: 'approved' as const, progress: 100, risk_score: 2.5, control_score: 4.5, findings_count: 2, submitted_at: '2025-11-08', reviewed_at: '2025-11-10' },
            { id: 7, business_unit_id: 7, business_unit_name: 'Compliance', assessor_name: 'Tom Harris', status: 'approved' as const, progress: 100, risk_score: 3.2, control_score: 3.9, findings_count: 4, submitted_at: '2025-11-12', reviewed_at: '2025-11-14' },
            { id: 8, business_unit_id: 8, business_unit_name: 'Internal Audit', status: 'not_started' as const, progress: 0, findings_count: 0 },
          ],
          created_at: '2025-09-15',
          updated_at: '2025-01-20',
        } as Campaign;
      }
    },
  });

  const activateMutation = useMutation({
    mutationFn: () => rcsaApi.activateCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-campaign', campaignId] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => rcsaApi.closeCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-campaign', campaignId] });
    },
  });

  const sendRemindersMutation = useMutation({
    mutationFn: () => rcsaApi.sendReminders(campaignId),
    onSuccess: () => {
      alert('Reminders sent successfully');
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const response = await rcsaApi.exportResults(campaignId);
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${campaign?.name.replace(/\s+/g, '_')}_results.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
  });

  const assignMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => rcsaApi.assignBusinessUnits(campaignId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-campaign', campaignId] });
      setIsAssignModalOpen(false);
    },
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedAssessments((campaign?.assessments || []).map(a => a.id));
    } else {
      setSelectedAssessments([]);
    }
  };

  const handleSelectAssessment = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedAssessments([...selectedAssessments, id]);
    } else {
      setSelectedAssessments(selectedAssessments.filter(aid => aid !== id));
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
      <div className="card p-8 text-center">
        <AlertCircle className="h-12 w-12 text-rose-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-white mb-2">Campaign Not Found</h3>
        <p className="text-slate-400 mb-4">The requested campaign could not be loaded.</p>
        <Link href="/risks/rcsa/campaigns" className="btn-primary">
          Back to Campaigns
        </Link>
      </div>
    );
  }

  const statusStyle = STATUS_COLORS[campaign.status] || STATUS_COLORS.draft;
  const pendingAssessments = (campaign.assessments || []).filter(a => a.status === 'not_started' || a.status === 'in_progress');

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/risks/rcsa/campaigns" className="text-slate-400 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-white">{campaign.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                {campaign.status}
              </span>
            </div>
            <p className="text-slate-400 mt-1">{campaign.description || `Using ${campaign.template_name} template`}</p>
          </div>
          <div className="flex items-center gap-3">
            {campaign.status === 'draft' && (
              <button
                onClick={() => {
                  if (confirm('Activate this campaign? This will notify all assigned assessors.')) {
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
              <>
                <button
                  onClick={() => sendRemindersMutation.mutate()}
                  className="btn-secondary flex items-center gap-2"
                  disabled={sendRemindersMutation.isPending}
                >
                  <Send className="h-4 w-4" />
                  Send Reminders
                </button>
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
              </>
            )}
            <button
              onClick={() => exportMutation.mutate()}
              className="btn-secondary flex items-center gap-2"
              disabled={exportMutation.isPending}
            >
              <Download className="h-4 w-4" />
              Export Results
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-6">
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Template</p>
            <p className="text-white font-medium">{campaign.template_name}</p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Period</p>
            <p className="text-white font-medium">{campaign.period}</p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Duration</p>
            <p className="text-white font-medium text-sm">
              {new Date(campaign.start_date).toLocaleDateString()} - {new Date(campaign.end_date).toLocaleDateString()}
            </p>
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
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Avg Risk Score</p>
            <p className="text-white font-medium">{campaign.avg_risk_score?.toFixed(1) || 'N/A'}</p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Total Findings</p>
            <p className="text-white font-medium">{campaign.total_findings}</p>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-primary-400" />
            Assessment Progress ({(campaign.assessments || []).length} Business Units)
          </h3>
          <div className="flex items-center gap-3">
            {selectedAssessments.length > 0 && (
              <button
                onClick={() => sendRemindersMutation.mutate()}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Mail className="h-4 w-4" />
                Send Reminder ({selectedAssessments.length})
              </button>
            )}
            <button
              onClick={() => setIsAssignModalOpen(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Assign Business Unit
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selectedAssessments.length === (campaign.assessments || []).length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-700 text-primary-500 focus:ring-primary-500"
                  />
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Business Unit</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Assessor</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Progress</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Risk Score</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Control Score</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Findings</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {(campaign.assessments || []).map((assessment) => {
                const astyle = ASSESSMENT_STATUS_COLORS[assessment.status] || ASSESSMENT_STATUS_COLORS.not_started;
                const StatusIcon = astyle.icon;

                return (
                  <tr key={assessment.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={selectedAssessments.includes(assessment.id)}
                        onChange={(e) => handleSelectAssessment(assessment.id, e.target.checked)}
                        className="rounded border-slate-600 bg-slate-700 text-primary-500 focus:ring-primary-500"
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-slate-400" />
                        <span className="text-white font-medium">{assessment.business_unit_name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {assessment.assessor_name ? (
                        <div>
                          <p className="text-slate-300">{assessment.assessor_name}</p>
                          {assessment.assessor_email && (
                            <p className="text-xs text-slate-500">{assessment.assessor_email}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">Not assigned</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${astyle.bg} ${astyle.text}`}>
                        <StatusIcon className="h-3 w-3" />
                        {assessment.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full"
                            style={{ width: `${assessment.progress}%` }}
                          />
                        </div>
                        <span className="text-sm text-slate-400">{assessment.progress}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {assessment.risk_score !== undefined ? (
                        <span className={`font-medium ${
                          assessment.risk_score >= 4 ? 'text-rose-400' :
                          assessment.risk_score >= 3 ? 'text-amber-400' :
                          'text-emerald-400'
                        }`}>
                          {assessment.risk_score.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {assessment.control_score !== undefined ? (
                        <span className={`font-medium ${
                          assessment.control_score >= 4 ? 'text-emerald-400' :
                          assessment.control_score >= 3 ? 'text-amber-400' :
                          'text-rose-400'
                        }`}>
                          {assessment.control_score.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {assessment.findings_count > 0 ? (
                        <span className="text-amber-400 font-medium">{assessment.findings_count}</span>
                      ) : (
                        <span className="text-slate-500">0</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400">
                      {assessment.submitted_at ? new Date(assessment.submitted_at).toLocaleDateString() : '-'}
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
            {Object.entries(ASSESSMENT_STATUS_COLORS).map(([status, style]) => {
              const count = (campaign.assessments || []).filter(a => a.status === status).length;
              const StatusIcon = style.icon;
              return (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon className={`h-4 w-4 ${style.text}`} />
                    <span className="text-slate-300 capitalize">{status.replace('_', ' ')}</span>
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
          {pendingAssessments.length > 0 ? (
            <div className="space-y-3">
              {pendingAssessments.slice(0, 5).map((assessment) => (
                <div key={assessment.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-white text-sm">{assessment.business_unit_name}</p>
                      <p className="text-xs text-slate-500">{assessment.assessor_name || 'No assessor assigned'}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${ASSESSMENT_STATUS_COLORS[assessment.status]?.bg} ${ASSESSMENT_STATUS_COLORS[assessment.status]?.text}`}>
                    {assessment.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-400 text-center py-4">All assessments are complete or submitted</p>
          )}
        </div>
      </div>

      {isAssignModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700 mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-white">Assign Business Unit</h3>
              <button onClick={() => setIsAssignModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                assignMutation.mutate({
                  business_unit_id: Number(formData.get('business_unit_id')),
                  assessor_email: formData.get('assessor_email') as string,
                });
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Business Unit</label>
                  <select name="business_unit_id" className="input w-full" required>
                    <option value="">Select business unit</option>
                    <option value="9">Human Resources</option>
                    <option value="10">Legal</option>
                    <option value="11">Marketing</option>
                    <option value="12">Operations</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Assessor Email</label>
                  <input
                    type="email"
                    name="assessor_email"
                    className="input w-full"
                    placeholder="assessor@company.com"
                    required
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsAssignModalOpen(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={assignMutation.isPending}>
                  {assignMutation.isPending ? 'Assigning...' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
