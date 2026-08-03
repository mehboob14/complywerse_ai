'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import {
  CheckCircle,
  XCircle,
  Eye,
  Loader2,
  AlertCircle,
  Building2,
  User,
  Calendar,
  Clock,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { SearchInput } from '@/components/ui/SearchInput';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';

interface PendingApproval {
  id: number;
  campaign_id: number;
  campaign_name: string;
  business_unit: string;
  assessor_name: string;
  submission_date: string;
  current_tier: number;
  total_tiers: number;
  score: number;
  ai_quality_score?: number;
}

interface Campaign {
  id: number;
  name: string;
}

function formatDate(dateString?: string) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface ActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (comments: string) => void;
  title: string;
  assessmentName: string;
  actionType: 'approve' | 'reject';
  isLoading: boolean;
}

function ActionModal({ isOpen, onClose, onConfirm, title, assessmentName, actionType, isLoading }: ActionModalProps) {
  const [comments, setComments] = useState('');

  const handleSubmit = () => {
    if (actionType === 'reject' && !comments.trim()) return;
    onConfirm(comments);
    setComments('');
  };

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={
        actionType === 'approve'
          ? `You are about to approve the assessment for "${assessmentName}".`
          : `You are about to reject the assessment for "${assessmentName}". Please provide a reason.`
      }
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || (actionType === 'reject' && !comments.trim())}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-white disabled:opacity-50 ${
              actionType === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {isLoading && <Loader2 size={16} className="animate-spin" />}
            {actionType === 'approve' ? 'Approve' : 'Reject'}
          </button>
        </div>
      }
    >
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Comments {actionType === 'reject' && <span className="text-red-400">*</span>}
        </label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder={actionType === 'approve' ? 'Optional comments...' : 'Reason for rejection...'}
          className="h-32 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        {actionType === 'reject' && !comments.trim() && (
          <p className="mt-1 text-xs text-red-500">Comments are required when rejecting</p>
        )}
      </div>
    </RightSlidePanel>
  );
}

export default function RCSAApprovalsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [campaignFilter, setCampaignFilter] = useState<string>('');
  const [selectedApproval, setSelectedApproval] = useState<PendingApproval | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject'>('approve');
  const queryClient = useQueryClient();

  const { data: pendingApprovals, isLoading, error } = useQuery({
    queryKey: ['rcsa-pending-approvals', campaignFilter],
    queryFn: async () => {
      try {
        const params: Record<string, unknown> = {};
        if (campaignFilter) params.campaign_id = campaignFilter;
        const response = await rcsaApi.getPendingApprovals(params);
        return response.data as PendingApproval[];
      } catch {
        return [] as PendingApproval[];
      }
    },
  });

  const { data: campaigns } = useQuery({
    queryKey: ['rcsa-campaigns-list'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getCampaigns();
        return response.data as Campaign[];
      } catch {
        return [] as Campaign[];
      }
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, comments }: { id: number; comments: string }) => 
      rcsaApi.approveAssessment(id, { comments }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-pending-approvals'] });
      setSelectedApproval(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, comments }: { id: number; comments: string }) => 
      rcsaApi.rejectAssessment(id, { comments }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-pending-approvals'] });
      setSelectedApproval(null);
    },
  });

  const filteredApprovals = useMemo(() => {
    if (!pendingApprovals) return [];
    return pendingApprovals.filter(approval => {
      const matchesSearch = !searchTerm || 
        approval.campaign_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        approval.business_unit.toLowerCase().includes(searchTerm.toLowerCase()) ||
        approval.assessor_name.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });
  }, [pendingApprovals, searchTerm]);

  const handleAction = (approval: PendingApproval, type: 'approve' | 'reject') => {
    setSelectedApproval(approval);
    setActionType(type);
  };

  const handleConfirmAction = (comments: string) => {
    if (!selectedApproval) return;
    if (actionType === 'approve') {
      approveMutation.mutate({ id: selectedApproval.id, comments });
    } else {
      rejectMutation.mutate({ id: selectedApproval.id, comments });
    }
  };

  const campaignItems = useMemo(
    () => (campaigns || []).map((c) => ({ value: String(c.id), label: c.name })),
    [campaigns]
  );

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-red-400">Failed to load pending approvals</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">RCSA Approvals</h1>
            <p className="text-slate-600 mt-1 text-sm">Review and approve submitted risk assessments</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-md">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search approvals..."
          />
        </div>
        <MultiSelectDropdown
          title="Campaign"
          items={campaignItems}
          selectedValues={campaignFilter ? [campaignFilter] : []}
          onApply={(vals) => setCampaignFilter(vals[0] || '')}
          multiSelect={false}
        />
      </div>

      <div className="grid gap-4">
        {filteredApprovals.map((approval) => (
          <div key={approval.id} className="card p-4 hover:border-primary-500/50 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-500/20">
                  <Clock className="h-6 w-6 text-primary-400" />
                </div>
                <div>
                  <h3 className="text-slate-900 font-medium">{approval.campaign_name}</h3>
                  <div className="flex items-center gap-4 text-sm text-slate-600 mt-1">
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" />
                      {approval.business_unit}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      {approval.assessor_name}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      Submitted {formatDate(approval.submission_date)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-xs text-slate-600">Approval Tier</p>
                  <p className="text-slate-900 font-medium">{approval.current_tier} of {approval.total_tiers}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-600">Score</p>
                  <p className={`font-medium ${
                    approval.score >= 80 ? 'text-green-400' : 
                    approval.score >= 60 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {approval.score}%
                  </p>
                </div>
                {approval.ai_quality_score && (
                  <div className="text-center">
                    <p className="text-xs text-slate-600">AI Quality</p>
                    <p className={`font-medium ${
                      approval.ai_quality_score >= 80 ? 'text-green-400' : 
                      approval.ai_quality_score >= 60 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {approval.ai_quality_score}%
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Link
                    href={`/risks/rcsa/approvals/${approval.id}`}
                    className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    title="Review Details"
                  >
                    <Eye className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => handleAction(approval, 'approve')}
                    className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50"
                    title="Approve"
                  >
                    <CheckCircle className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleAction(approval, 'reject')}
                    className="p-2 rounded-lg text-red-600 hover:bg-red-50"
                    title="Reject"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredApprovals.length === 0 && (
        <div className="card p-12 text-center">
          <CheckCircle className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No Pending Approvals</h3>
          <p className="text-slate-600">
            {searchTerm || campaignFilter
              ? 'No approvals match your filters'
              : 'All assessments have been reviewed'}
          </p>
        </div>
      )}

      <ActionModal
        isOpen={!!selectedApproval}
        onClose={() => setSelectedApproval(null)}
        onConfirm={handleConfirmAction}
        title={actionType === 'approve' ? 'Approve Assessment' : 'Reject Assessment'}
        assessmentName={selectedApproval ? `${selectedApproval.business_unit}` : ''}
        actionType={actionType}
        isLoading={approveMutation.isPending || rejectMutation.isPending}
      />
    </div>
  );
}
