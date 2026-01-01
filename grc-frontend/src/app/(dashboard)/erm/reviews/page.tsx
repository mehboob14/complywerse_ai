'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { advancedErmApi, risksApi } from '@/lib/api';
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
  X,
  AlertCircle,
} from 'lucide-react';

const REVIEW_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  in_review: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  skipped: 'bg-slate-500/20 text-slate-400',
  overdue: 'bg-red-500/20 text-red-400',
};

export default function ReviewsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const queryClient = useQueryClient();

  const { data: reviews, isLoading } = useQuery({
    queryKey: ['reviews', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status_filter = statusFilter;
      const response = await advancedErmApi.getReviews(params);
      return response.data;
    },
  });

  const { data: pendingReviews } = useQuery({
    queryKey: ['pending-reviews'],
    queryFn: async () => {
      const response = await advancedErmApi.getPendingReviews();
      return response.data;
    },
  });

  const { data: overdueReviews } = useQuery({
    queryKey: ['overdue-reviews'],
    queryFn: async () => {
      const response = await advancedErmApi.getOverdueReviews();
      return response.data;
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['risks-list'],
    queryFn: async () => {
      const response = await risksApi.getAll();
      return response.data;
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
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-8 w-8 text-yellow-400" />
            <div>
              <p className="text-2xl font-bold text-white">{pendingReviews?.length || 0}</p>
              <p className="text-sm text-yellow-400">Pending Reviews</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <div>
              <p className="text-2xl font-bold text-white">{overdueReviews?.length || 0}</p>
              <p className="text-sm text-red-400">Overdue Reviews</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-green-400" />
            <div>
              <p className="text-2xl font-bold text-white">
                {reviews?.filter((r) => r.status === 'completed').length || 0}
              </p>
              <p className="text-sm text-green-400">Completed This Month</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_review">In Review</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
        >
          <Plus className="h-4 w-4" />
          Schedule Review
        </button>
      </div>

      {reviews && reviews.length > 0 ? (
        <div className="space-y-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-700 bg-slate-800">
          <Calendar className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-white">No reviews scheduled</h3>
          <p className="mt-1 text-slate-400">Schedule risk reviews to maintain compliance</p>
        </div>
      )}

      {showCreateModal && (
        <ReviewModal
          risks={risks || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: ['pending-reviews'] });
          }}
        />
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: RiskReview }) {
  const statusColor = REVIEW_STATUS_COLORS[review.status] || REVIEW_STATUS_COLORS.pending;
  const isOverdue = new Date(review.due_date) < new Date() && review.status !== 'completed';
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (status: string) => advancedErmApi.updateReview(review.id, { status: status as any }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      queryClient.invalidateQueries({ queryKey: ['pending-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['overdue-reviews'] });
    },
  });

  return (
    <div className={`rounded-xl border p-4 ${isOverdue ? 'border-red-500/50 bg-red-500/5' : 'border-slate-700 bg-slate-800'}`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium text-white">{review.risk_title || `Risk #${review.risk_id}`}</h3>
          <div className="mt-1 flex items-center gap-3">
            <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor}`}>
              {review.status.replace('_', ' ')}
            </span>
            <span className="text-sm text-slate-400">
              {review.review_type} • {review.review_cycle}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-sm font-medium ${isOverdue ? 'text-red-400' : 'text-slate-300'}`}>
            Due: {new Date(review.due_date).toLocaleDateString()}
          </p>
          {isOverdue && <p className="text-xs text-red-400">Overdue</p>}
        </div>
      </div>

      {review.status === 'pending' && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => updateMutation.mutate('in_review')}
            disabled={updateMutation.isPending}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-500"
          >
            Start Review
          </button>
        </div>
      )}

      {review.status === 'in_review' && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => updateMutation.mutate('completed')}
            disabled={updateMutation.isPending}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-500"
          >
            Complete Review
          </button>
        </div>
      )}

      {review.findings && (
        <div className="mt-3 rounded bg-slate-900 p-3">
          <p className="text-sm text-slate-300">{review.findings}</p>
        </div>
      )}
    </div>
  );
}

function ReviewModal({
  risks,
  onClose,
  onSuccess,
}: {
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskReviewCreate>>({
    risk_id: risks[0]?.id || 0,
    review_cycle: 'quarterly',
    review_type: 'periodic',
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  });

  const createMutation = useMutation({
    mutationFn: (data: RiskReviewCreate) => advancedErmApi.createReview(data),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData as RiskReviewCreate);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-slate-800 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Schedule Review</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-400">Risk</label>
            <select
              value={formData.risk_id}
              onChange={(e) => setFormData({ ...formData, risk_id: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              required
            >
              {risks.map((risk) => (
                <option key={risk.id} value={risk.id}>
                  {risk.title}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Review Cycle</label>
              <select
                value={formData.review_cycle}
                onChange={(e) => setFormData({ ...formData, review_cycle: e.target.value as ReviewCycle })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi_annual">Semi-Annual</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400">Review Type</label>
              <select
                value={formData.review_type}
                onChange={(e) => setFormData({ ...formData, review_type: e.target.value as ReviewType })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              >
                <option value="periodic">Periodic</option>
                <option value="triggered">Triggered</option>
                <option value="ad_hoc">Ad Hoc</option>
                <option value="audit">Audit</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Due Date</label>
            <input
              type="date"
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Schedule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
