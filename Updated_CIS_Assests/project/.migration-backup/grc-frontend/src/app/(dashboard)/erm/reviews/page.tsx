'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ermApi, evidenceApi, risksApi, tenantApi } from '@/lib/api';
import {
  RiskReview,
  RiskReviewCreate,
  Risk,
  ReviewCycle,
  ReviewType,
} from '@/types';
import {
  Calendar,
  CheckCircle,
  Clock,
  Loader2,
  Plus,
  AlertCircle,
  Upload,
  User,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { MultiSelectDropdown, RightSlidePanel } from '@/components/ui';

interface TenantUserOption {
  id: number;
  display_name: string;
  email: string;
}

const REVIEW_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  in_review: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  skipped: 'bg-slate-500/20 text-slate-600',
  overdue: 'bg-red-500/20 text-red-400',
};

export default function ReviewsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:risk_assessments:create');

  const { data: reviews, isLoading } = useQuery({
    queryKey: ['erm-reviews', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status_filter = statusFilter;
      const response = await ermApi.reviews.getAll(params);
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  const { data: pendingReviews } = useQuery({
    queryKey: ['erm-pending-reviews'],
    queryFn: async () => {
      const response = await ermApi.reviews.getPending();
      return response.data;
    },
  });

  const { data: overdueReviews } = useQuery({
    queryKey: ['erm-overdue-reviews'],
    queryFn: async () => {
      const response = await ermApi.reviews.getOverdue();
      return response.data;
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['erm-risks-list'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ['erm-reviews-tenant-users'],
    queryFn: async () => {
      const response = await tenantApi.getTenantUsers();
      return (response.data || []) as TenantUserOption[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-3 sm:px-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-yellow-400" />
            <div>
              <p className="text-xl font-bold text-slate-900">{pendingReviews?.length || 0}</p>
              <p className="text-xs text-yellow-400">Pending Reviews</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div>
              <p className="text-xl font-bold text-slate-900">{overdueReviews?.length || 0}</p>
              <p className="text-xs text-red-400">Overdue Reviews</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-400" />
            <div>
              <p className="text-xl font-bold text-slate-900">
                {reviews?.filter((r) => r.status === 'completed').length || 0}
              </p>
              <p className="text-xs text-green-400">Completed This Month</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <MultiSelectDropdown
          title="Status"
          items={[
            { value: 'pending', label: 'Pending' },
            { value: 'in_review', label: 'In Review' },
            { value: 'completed', label: 'Completed' },
            { value: 'overdue', label: 'Overdue' },
          ]}
          selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
          onApply={(values) => setStatusFilter(values[0] || 'all')}
          multiSelect={false}
          placeholder="All Statuses"
        />
        {canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
          >
            <Plus className="h-4 w-4" />
            Schedule Review
          </button>
        )}
      </div>

      {reviews && reviews.length > 0 ? (
        <div className="space-y-3">
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              tenantUsers={tenantUsers || []}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-200 bg-white">
          <Calendar className="h-10 w-10 text-slate-500" />
          <h3 className="mt-4 text-sm font-semibold text-slate-900">No reviews scheduled</h3>
          <p className="mt-1 text-xs text-slate-600">Schedule risk reviews to maintain compliance</p>
        </div>
      )}

      {showCreateModal && (
        <ReviewModal
          risks={risks || []}
          tenantUsers={tenantUsers || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['erm-reviews'] });
            queryClient.invalidateQueries({ queryKey: ['erm-pending-reviews'] });
          }}
        />
      )}
    </div>
  );
}

function ReviewCard({ review, tenantUsers }: { review: RiskReview; tenantUsers: TenantUserOption[] }) {
  const statusColor = REVIEW_STATUS_COLORS[review.status] || REVIEW_STATUS_COLORS.pending;
  const isOverdue = new Date(review.due_date) < new Date() && review.status !== 'completed';
  const [showStartModal, setShowStartModal] = useState(false);
  const reviewerName = tenantUsers.find((u) => u.id === review.reviewer_id)?.display_name;

  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${isOverdue ? 'border-red-500/50 bg-red-500/5' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{review.risk_title || `Risk #${review.risk_id}`}</h3>
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor}`}>
              {review.status.replace('_', ' ')}
            </span>
            <span className="text-xs text-slate-600">
              {review.review_type} • {review.review_cycle}
            </span>
            {reviewerName && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                <User className="h-3 w-3" />
                {reviewerName}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className={`text-xs font-medium ${isOverdue ? 'text-red-400' : 'text-slate-700'}`}>
            Due: {new Date(review.due_date).toLocaleDateString()}
          </p>
          {isOverdue && <p className="text-xs text-red-400">Overdue</p>}
        </div>
      </div>

      {review.status === 'pending' && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setShowStartModal(true)}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-500"
          >
            Start Review
          </button>
        </div>
      )}

      {review.status === 'in_review' && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setShowStartModal(true)}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-500"
          >
            Complete Review
          </button>
        </div>
      )}

      {review.findings && (
        <div className="mt-3 rounded bg-white p-3">
          <p className="text-xs text-slate-700">{review.findings}</p>
        </div>
      )}

      {showStartModal && (
        <StartReviewModal
          review={review}
          onClose={() => setShowStartModal(false)}
        />
      )}
    </div>
  );
}

function ReviewModal({
  risks,
  tenantUsers,
  onClose,
  onSuccess,
}: {
  risks: Risk[];
  tenantUsers: TenantUserOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskReviewCreate>>({
    risk_id: risks[0]?.id || 0,
    review_cycle: 'quarterly',
    review_type: 'periodic',
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    reviewer_id: undefined,
  });

  const createMutation = useMutation({
    mutationFn: (data: RiskReviewCreate) => ermApi.reviews.create(data),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData as RiskReviewCreate);
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="Schedule Review"
    >
      <div className="px-6 py-4">
        <form id="review-schedule-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Risk *</label>
            <MultiSelectDropdown
              title="Risk"
              items={risks.map((risk) => ({
                value: String(risk.id),
                label: risk.title,
                subLabel: risk.risk_category,
              }))}
              selectedValues={formData.risk_id ? [String(formData.risk_id)] : []}
              onApply={(values) => setFormData({ ...formData, risk_id: values[0] ? Number(values[0]) : 0 })}
              multiSelect={false}
              triggerVariant="input"
              triggerClassName="w-full"
              forceSearch
              searchPlaceholder="Search risk by title..."
              placeholder="Select Risk"
              size="md"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Review Cycle</label>
              <MultiSelectDropdown
                title="Cycle"
                items={[
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'quarterly', label: 'Quarterly' },
                  { value: 'semi_annual', label: 'Semi-Annual' },
                  { value: 'annual', label: 'Annual' },
                ]}
                selectedValues={formData.review_cycle ? [formData.review_cycle] : []}
                onApply={(values) => setFormData({ ...formData, review_cycle: (values[0] as ReviewCycle) || 'quarterly' })}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Select Cycle"
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Review Type</label>
              <MultiSelectDropdown
                title="Type"
                items={[
                  { value: 'periodic', label: 'Periodic' },
                  { value: 'triggered', label: 'Triggered' },
                  { value: 'ad_hoc', label: 'Ad Hoc' },
                  { value: 'audit', label: 'Audit' },
                ]}
                selectedValues={formData.review_type ? [formData.review_type] : []}
                onApply={(values) => setFormData({ ...formData, review_type: (values[0] as ReviewType) || 'periodic' })}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Select Type"
                size="md"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Assign To</label>
            <MultiSelectDropdown
              title="Assignee"
              items={tenantUsers.map((user) => ({
                value: String(user.id),
                label: user.display_name,
                subLabel: user.email,
              }))}
              selectedValues={formData.reviewer_id ? [String(formData.reviewer_id)] : []}
              onApply={(values) =>
                setFormData({
                  ...formData,
                  reviewer_id: values[0] ? Number(values[0]) : undefined,
                })
              }
              multiSelect={false}
              triggerVariant="input"
              triggerClassName="w-full"
              forceSearch
              placeholder="Unassigned"
              size="md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Due Date *</label>
            <input
              type="date"
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="review-schedule-form"
              disabled={createMutation.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Schedule'
              )}
            </button>
          </div>
        </form>
      </div>
    </RightSlidePanel>
  );
}

function StartReviewModal({
  review,
  onClose,
}: {
  review: RiskReview;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: risk } = useQuery({
    queryKey: ['erm-risk-for-review', review.risk_id],
    queryFn: async () => {
      const response = await ermApi.risks.getById(review.risk_id);
      return response.data;
    },
  });

  const [inherentLikelihood, setInherentLikelihood] = useState<string>('');
  const [inherentImpact, setInherentImpact] = useState<string>('');
  const [residualLikelihood, setResidualLikelihood] = useState<string>('');
  const [residualImpact, setResidualImpact] = useState<string>('');
  const [findings, setFindings] = useState<string>(review.findings || '');
  const [recommendations, setRecommendations] = useState<string>(review.recommendations || '');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceName, setEvidenceName] = useState<string>('');
  const [evidenceDescription, setEvidenceDescription] = useState<string>('');

  useEffect(() => {
    if (risk) {
      setInherentLikelihood(risk.inherent_likelihood?.toString() ?? '');
      setInherentImpact(risk.inherent_impact?.toString() ?? '');
      setResidualLikelihood(risk.residual_likelihood?.toString() ?? '');
      setResidualImpact(risk.residual_impact?.toString() ?? '');
    }
  }, [risk]);

  useEffect(() => {
    if (review.status === 'pending') {
      ermApi.reviews
        .update(review.id, { status: 'in_review' as any })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['erm-reviews'] });
          queryClient.invalidateQueries({ queryKey: ['erm-pending-reviews'] });
          queryClient.invalidateQueries({ queryKey: ['erm-overdue-reviews'] });
        })
        .catch(() => {
          // ignore — user can still complete the review
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeMutation = useMutation({
    mutationFn: async () => {
      const inhL = inherentLikelihood !== '' ? Number(inherentLikelihood) : undefined;
      const inhI = inherentImpact !== '' ? Number(inherentImpact) : undefined;
      const resL = residualLikelihood !== '' ? Number(residualLikelihood) : undefined;
      const resI = residualImpact !== '' ? Number(residualImpact) : undefined;

      const riskUpdate: Partial<Risk> = {};
      if (inhL !== undefined && inhL !== risk?.inherent_likelihood) riskUpdate.inherent_likelihood = inhL;
      if (inhI !== undefined && inhI !== risk?.inherent_impact) riskUpdate.inherent_impact = inhI;
      if (resL !== undefined && resL !== risk?.residual_likelihood) riskUpdate.residual_likelihood = resL;
      if (resI !== undefined && resI !== risk?.residual_impact) riskUpdate.residual_impact = resI;

      if (Object.keys(riskUpdate).length > 0) {
        await ermApi.risks.update(review.risk_id, riskUpdate);
      }

      if (evidenceFile) {
        const formData = new FormData();
        formData.append('name', evidenceName.trim() || evidenceFile.name);
        if (evidenceDescription.trim()) {
          formData.append('description', evidenceDescription.trim());
        }
        formData.append('file', evidenceFile);

        const uploadRes = await evidenceApi.create(formData);
        const uploadedEvidenceId = uploadRes.data?.id;
        if (uploadedEvidenceId) {
          try {
            await risksApi.linkEvidence(review.risk_id, { evidence_id: uploadedEvidenceId });
          } catch {
            // best-effort linking; proceed if endpoint not available
          }
        }
      }

      const newInherentScore = inhL !== undefined && inhI !== undefined ? inhL * inhI : undefined;
      const newResidualScore = resL !== undefined && resI !== undefined ? resL * resI : undefined;

      await ermApi.reviews.update(review.id, {
        status: 'completed' as any,
        new_inherent_score: newInherentScore,
        new_residual_score: newResidualScore,
        findings: findings.trim() || undefined,
        recommendations: recommendations.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['erm-pending-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['erm-overdue-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-list'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risk-for-review', review.risk_id] });
      onClose();
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : err?.message || 'Failed to complete review.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    completeMutation.mutate();
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      width="w-full max-w-2xl"
      title={review.status === 'pending' ? 'Start Review' : 'Complete Review'}
      subtitle={`${review.risk_title || `Risk #${review.risk_id}`} • Update risk values, optionally attach evidence, then complete the review.`}
    >
      <div className="px-6 py-4">
        <form id="start-review-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Inherent Risk</h3>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Likelihood (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={inherentLikelihood}
                  onChange={(e) => setInherentLikelihood(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Impact (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={inherentImpact}
                  onChange={(e) => setInherentImpact(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Residual Risk</h3>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Likelihood (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={residualLikelihood}
                  onChange={(e) => setResidualLikelihood(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Impact (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={residualImpact}
                  onChange={(e) => setResidualImpact(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Findings (optional)</label>
            <textarea
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Summary of review findings..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Recommendations (optional)</label>
            <textarea
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Any recommended next steps..."
            />
          </div>

          <div className="rounded-lg border border-dashed border-gray-300 p-4">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Attach Evidence (optional)
            </h3>
            <div className="mt-3 space-y-3">
              <input
                type="file"
                onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-600 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-primary-500"
              />
              {evidenceFile && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Evidence Name</label>
                    <input
                      type="text"
                      value={evidenceName}
                      onChange={(e) => setEvidenceName(e.target.value)}
                      placeholder={evidenceFile.name}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Description</label>
                    <input
                      type="text"
                      value={evidenceDescription}
                      onChange={(e) => setEvidenceDescription(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="start-review-form"
              disabled={completeMutation.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {completeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Complete Review'
              )}
            </button>
          </div>
        </form>
      </div>
    </RightSlidePanel>
  );
}
