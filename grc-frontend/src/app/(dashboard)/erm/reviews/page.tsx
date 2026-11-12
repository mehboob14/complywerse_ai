'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi, evidenceApi, risksApi, tenantApi } from '@/lib/api';
import {
  RiskReviewCreate,
  Risk,
  ReviewCycle,
  ReviewType,
} from '@/types';
import {
  Calendar,
  CalendarClock,
  CheckCircle,
  FileText,
  Hourglass,
  Loader2,
  Plus,
  AlertCircle,
  Upload,
  User,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { MultiSelectDropdown, RightSlidePanel, PageLoader } from '@/components/ui';
import {
  approvedScores, compareScores, DONE, isReviewOverdue, reviewTab, WORKING,
  type ReviewRow, type ReviewTab, type ScoreRow,
} from './_reviewModel';
import ReassignReviewer from './ReassignReviewer';

interface TenantUserOption {
  id: number;
  display_name: string;
  email: string;
}

const SCHEDULED: [string, string] = ['Scheduled', 'bg-slate-100 text-slate-600 border-slate-200'];
const STATUS: Record<string, [string, string]> = {
  pending: SCHEDULED,
  scheduled: SCHEDULED,
  in_review: ['In review', 'bg-blue-50 text-blue-700 border-blue-200'],
  submitted: ['Awaiting approval', 'bg-amber-50 text-amber-700 border-amber-200'],
  approved: ['Approved', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  completed: ['Completed', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  rejected: ['Rejected', 'bg-rose-50 text-rose-700 border-rose-200'],
};
const RETURNED: [string, string] = ['Returned', 'bg-orange-50 text-orange-700 border-orange-200'];

const TABS: Array<{ key: ReviewTab; label: string; icon: typeof Calendar; empty: string }> = [
  { key: 'due', label: 'Due this month', icon: Calendar, empty: 'No reviews due.' },
  { key: 'overdue', label: 'Overdue', icon: AlertCircle, empty: 'No overdue reviews.' },
  { key: 'awaiting', label: 'Awaiting approval', icon: Hourglass, empty: 'Nothing is awaiting approval.' },
  { key: 'upcoming', label: 'Upcoming', icon: CalendarClock, empty: 'No reviews scheduled after this month.' },
  { key: 'completed', label: 'Completed', icon: CheckCircle, empty: 'No completed reviews yet.' },
];

const NOTICE = {
  ok: 'border-emerald-200 bg-emerald-50/40 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
};

const PROPOSAL_FIELDS = [
  ['inherent_likelihood', 'Before controls: likelihood'],
  ['inherent_impact', 'Before controls: impact'],
  ['residual_likelihood', 'After controls: likelihood'],
  ['residual_impact', 'After controls: impact'],
] as const;
type ProposalField = typeof PROPOSAL_FIELDS[number][0];

const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

/** The server's own message (a 409 says who must approve); otherwise the fallback. */
const errorText = (err: unknown, fallback: string): string => {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function ReviewsPage() {
  const [tab, setTab] = useState<ReviewTab>('due');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [openReview, setOpenReview] = useState<ReviewRow | null>(null);
  const [notice, setNotice] = useState<{ tone: keyof typeof NOTICE; text: string } | null>(null);
  const queryClient = useQueryClient();
  const { hasAnyPermission } = usePermissions();
  // The same grants the server checks: the risk assessment permission, or the ERM risk one.
  const canCreate = hasAnyPermission(['risks:risk_assessment:create', 'erm:risks:create']);
  const canEdit = hasAnyPermission(['risks:risk_assessment:edit', 'erm:risks:edit']);

  // shortcut: one fetch of up to 1000 reviews, split into tabs here; page through the server past 1000.
  const { data: reviews, isLoading } = useQuery({
    queryKey: ['erm-reviews'],
    queryFn: async () => (await ermApi.reviews.getAll({ limit: 1000 })).data as unknown as ReviewRow[],
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

  const scheduleDue = useMutation({
    mutationFn: () => ermApi.reviews.scheduleDue(),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['erm-reviews'] });
      const missing = data.without_owner;
      const names = missing.slice(0, 5).map((r) => r.risk_title).join(', ') + (missing.length > 5 ? ` and ${missing.length - 5} more` : '');
      setNotice({
        tone: missing.length ? 'warn' : 'ok',
        text: `${plural(data.created.length, 'review', 'reviews')} scheduled.`
          + (missing.length ? ` ${plural(missing.length, 'risk has', 'risks have')} no risk owner, so the review is unassigned: ${names}.` : ''),
      });
    },
    onError: (err) => setNotice({ tone: 'error', text: errorText(err, 'Could not schedule the due reviews.') }),
  });

  // A notification links to /erm/reviews?review=<id>: open that review once the list is in, then drop the parameter.
  useEffect(() => {
    const hit = reviews?.find((r) => r.id === Number(new URLSearchParams(window.location.search).get('review')));
    if (hit) {
      setOpenReview(hit);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [reviews]);

  if (isLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  const now = new Date();
  const inTab = (key: ReviewTab) => (reviews || []).filter((r) => reviewTab(r, now) === key);
  const shown = inTab(tab);
  const userName = (id?: number | null) => tenantUsers?.find((u) => u.id === id)?.display_name;

  return (
    <div className="space-y-4 px-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900">Risk Reviews</h2>
          <p className="text-sm text-slate-600">
            Each risk is reviewed on a cycle set by its band. A changed score takes effect when someone other than the reviewer approves it.
          </p>
        </div>
        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setNotice(null); scheduleDue.mutate(); }}
              disabled={scheduleDue.isPending}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-900 hover:bg-slate-200 disabled:opacity-50"
            >
              {scheduleDue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              Schedule due reviews
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-[#0a0a0a] hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Schedule Review
            </button>
          </div>
        )}
      </div>

      {notice && <div className={`rounded-lg border p-3 text-sm ${NOTICE[notice.tone]}`}>{notice.text}</div>}

      <div className="rounded-lg border border-gray-200 bg-white px-3">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`inline-flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                {inTab(key).length}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {shown.length > 0 ? (
        <div className="space-y-3">
          {shown.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              reviewerName={userName(review.reviewer_id)}
              canEdit={canEdit}
              onOpen={() => setOpenReview(review)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-200 bg-white">
          <Calendar className="h-10 w-10 text-slate-500" />
          <h3 className="mt-4 text-sm font-semibold text-slate-900">{TABS.find((t) => t.key === tab)?.empty}</h3>
        </div>
      )}

      {openReview && (
        <ReviewPanel
          review={openReview}
          canEdit={canEdit}
          userName={userName}
          onClose={() => setOpenReview(null)}
        />
      )}

      {showCreateModal && (
        <ReviewModal
          risks={risks || []}
          tenantUsers={tenantUsers || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['erm-reviews'] });
          }}
        />
      )}
    </div>
  );
}

function ReviewCard({ review, reviewerName, canEdit, onOpen }: {
  review: ReviewRow;
  reviewerName?: string;
  canEdit: boolean;
  onOpen: () => void;
}) {
  const returned = review.status === 'in_review' && !!review.approval_notes;
  const [label, color] = returned ? RETURNED : STATUS[review.status] || [review.status, SCHEDULED[1]];
  const isOverdue = isReviewOverdue(review, new Date());
  const action = canEdit
    ? ({ pending: 'Start review', scheduled: 'Start review', in_review: 'Continue review', submitted: 'Review changes' } as Record<string, string>)[review.status]
    : undefined;

  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${isOverdue ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{review.risk_title || `Risk #${review.risk_id}`}</h3>
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>
            <span className="text-xs text-slate-600">
              {review.review_type} • {review.review_cycle.replace('_', '-')}
            </span>
            {reviewerName ? (
              <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                <User className="h-3 w-3" />
                {reviewerName}
              </span>
            ) : !review.reviewer_id && (
              <span className="text-xs font-medium text-amber-700">Unassigned</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-xs font-medium ${isOverdue ? 'text-rose-600' : 'text-slate-700'}`}>
            {review.completed_at
              ? `Completed ${new Date(review.completed_at).toLocaleDateString()}`
              : `Due ${new Date(review.due_date).toLocaleDateString()}`}
          </p>
          {isOverdue && <p className="text-xs text-rose-600">Overdue</p>}
        </div>
      </div>

      {review.findings && <p className="mt-2 line-clamp-2 text-xs text-slate-700">{review.findings}</p>}

      <div className="mt-3">
        <button
          onClick={onOpen}
          className={action
            ? 'rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-[#0a0a0a] hover:bg-primary-700'
            : 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50'}
        >
          {action || 'View'}
        </button>
      </div>
    </div>
  );
}

function ScoreTable({ rows, beforeLabel, afterLabel }: { rows: ScoreRow[]; beforeLabel: string; afterLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 pr-2 font-medium"><span className="sr-only">Measure</span></th>
            <th className="py-1 pr-2 font-medium">{beforeLabel}</th>
            <th className="py-1 pr-2 font-medium">{afterLabel}</th>
            <th className="py-1 font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const changed = row.before !== row.after;
            return (
              <tr key={row.label} className={changed ? 'bg-amber-50' : ''}>
                <td className="py-1 pr-2 text-slate-700">{row.label}</td>
                <td className="py-1 pr-2 text-slate-900">{row.before ?? '—'}</td>
                <td className={`py-1 pr-2 text-slate-900 ${changed ? 'font-semibold' : ''}`}>{row.after ?? '—'}</td>
                <td className={`py-1 font-medium ${!row.delta ? 'text-slate-400' : row.delta > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {row.delta ? (row.delta > 0 ? `+${row.delta}` : row.delta) : changed ? 'set' : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
    risk_id: undefined,   // chosen by the user, never defaulted to the first risk in the list
    review_cycle: 'quarterly',
    review_type: 'periodic',
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    reviewer_id: undefined,
  });
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: RiskReviewCreate) => ermApi.reviews.create(data),
    onSuccess,
    onError: (err: unknown) => setFormError(errorText(err, 'Could not schedule the review.')),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.risk_id) {
      setFormError('Choose the risk to review.');
      return;
    }
    setFormError(null);
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Risk *</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Review Cycle</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Review Type</label>
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Assign To</label>
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Due Date *</label>
            <input
              type="date"
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              className={INPUT}
              required
            />
          </div>

          {formError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{formError}</div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
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

/** One review end to end: the reviewer proposes and submits; someone else approves the change or returns it with a note. */
function ReviewPanel({
  review,
  canEdit,
  userName,
  onClose,
}: {
  review: ReviewRow;
  canEdit: boolean;
  userName: (id?: number | null) => string | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const editable = canEdit && WORKING.includes(review.status);
  const done = DONE.includes(review.status);
  const awaiting = review.status === 'submitted';

  // The register's current values are the last approved ones; the detail also lists the risk's evidence.
  const { data: risk } = useQuery({
    queryKey: ['erm-risk-for-review', review.risk_id],
    queryFn: async () => (await risksApi.getDetail(review.risk_id)).data,
  });

  const [values, setValues] = useState<Record<ProposalField, string>>({
    inherent_likelihood: '', inherent_impact: '', residual_likelihood: '', residual_impact: '',
  });
  const [findings, setFindings] = useState<string>(review.findings || '');
  const [recommendations, setRecommendations] = useState<string>(review.recommendations || '');
  const [notes, setNotes] = useState<string>('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceName, setEvidenceName] = useState<string>('');
  const [evidenceDescription, setEvidenceDescription] = useState<string>('');

  useEffect(() => {
    if (risk) {
      const start = (field: ProposalField) => String(review[`proposed_${field}`] ?? risk[field] ?? '');
      setValues({
        inherent_likelihood: start('inherent_likelihood'), inherent_impact: start('inherent_impact'),
        residual_likelihood: start('residual_likelihood'), residual_impact: start('residual_impact'),
      });
    }
  }, [risk, review]);

  const typed = (field: ProposalField) => (values[field] !== '' ? Number(values[field]) : undefined);
  const typedProposal = {
    proposed_inherent_likelihood: typed('inherent_likelihood'), proposed_inherent_impact: typed('inherent_impact'),
    proposed_residual_likelihood: typed('residual_likelihood'), proposed_residual_impact: typed('residual_impact'),
  };
  const proposal: Partial<ReviewRow> = editable ? typedProposal : review;

  const finish = () => {
    queryClient.invalidateQueries({ queryKey: ['erm-reviews'] });
    queryClient.invalidateQueries({ queryKey: ['erm-risk-for-review', review.risk_id] });
    queryClient.invalidateQueries({ queryKey: ['erm-risks-list'] });
    onClose();
  };
  const failed = (fallback: string) => (err: unknown) => setError(errorText(err, fallback));

  // Opening the panel changes nothing: a review moves to "in review" only when the user starts it here.
  const startMutation = useMutation({
    mutationFn: () => ermApi.reviews.start(review.id),
    onSuccess: finish,
    onError: failed('Could not start the review.'),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
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
      // A proposal only: the risk changes when someone other than the reviewer approves it.
      await ermApi.reviews.submit(review.id, {
        ...typedProposal,
        findings: findings.trim() || undefined,
        recommendations: recommendations.trim() || undefined,
      });
    },
    onSuccess: finish,
    onError: failed('Could not submit the review. Likelihood and impact are whole numbers from 1 to 5.'),
  });

  const approveMutation = useMutation({
    mutationFn: () => ermApi.reviews.approve(review.id, notes.trim() || undefined),
    onSuccess: finish,
    onError: failed('Could not approve the review.'),
  });

  const challengeMutation = useMutation({
    mutationFn: () => ermApi.reviews.challenge(review.id, notes.trim()),
    onSuccess: finish,
    onError: failed('Could not return the review.'),
  });

  const busy = startMutation.isPending || submitMutation.isPending || approveMutation.isPending || challengeMutation.isPending;
  const act = (run: () => void) => { setError(null); run(); };
  const challenge = () => (notes.trim() ? challengeMutation.mutate() : setError('Say what the reviewer needs to change.'));
  const evidence = risk?.linked_evidence || [];
  const returned = review.status === 'in_review' && !!review.approval_notes;

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      width="w-full max-w-2xl"
      title={review.risk_title || `Risk #${review.risk_id}`}
      subtitle={`${(returned ? RETURNED : STATUS[review.status] || SCHEDULED)[0]} • Due ${new Date(review.due_date).toLocaleDateString()}`
        + (userName(review.reviewer_id) ? ` • Reviewer: ${userName(review.reviewer_id)}` : ' • Unassigned')}
    >
      <div className="space-y-4 px-6 py-4">
        {returned && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
            <span className="font-semibold">Returned:</span> {review.approval_notes}
          </div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            {done ? 'What the review changed' : 'Last approved and proposed'}
          </h3>
          {editable && (
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PROPOSAL_FIELDS.map(([field, label]) => (
                <label key={field} className="block text-xs font-medium text-slate-700">
                  {label}
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={values[field]}
                    onChange={(e) => setValues({ ...values, [field]: e.target.value })}
                    className={`${INPUT} mt-1`}
                  />
                </label>
              ))}
            </div>
          )}
          <ScoreTable
            rows={done ? approvedScores(review) : compareScores(risk || {}, proposal)}
            beforeLabel={done ? 'Before' : 'Last approved'}
            afterLabel={done ? 'Approved' : 'Proposed'}
          />
        </section>

        {editable ? (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Findings</label>
              <textarea
                value={findings}
                onChange={(e) => setFindings(e.target.value)}
                rows={3}
                className={INPUT}
                placeholder="Is the risk still right? What changed in its controls and actions?"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Recommendations (optional)</label>
              <textarea
                value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)}
                rows={2}
                className={INPUT}
                placeholder="Any recommended next steps..."
              />
            </div>
          </>
        ) : (
          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Findings</h3>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{review.findings || 'No findings recorded.'}</p>
            {review.recommendations && (
              <>
                <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Recommendations</h3>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{review.recommendations}</p>
              </>
            )}
          </section>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">Evidence on this risk</h3>
          {evidence.length ? (
            <ul className="space-y-1">
              {evidence.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <FileText className="h-4 w-4 text-slate-500" />
                  {item.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No evidence linked to this risk.</p>
          )}
          {editable && (
            <div className="mt-3 space-y-3 rounded-lg border border-dashed border-slate-300 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <Upload className="h-4 w-4" />
                Attach evidence (optional)
              </p>
              <input
                type="file"
                onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-600 file:px-3 file:py-1.5 file:text-sm file:text-[#0a0a0a] hover:file:bg-primary-700"
              />
              {evidenceFile && (
                <>
                  <input
                    type="text"
                    aria-label="Evidence name"
                    value={evidenceName}
                    onChange={(e) => setEvidenceName(e.target.value)}
                    placeholder={evidenceFile.name}
                    className={INPUT}
                  />
                  <input
                    type="text"
                    aria-label="Evidence description"
                    value={evidenceDescription}
                    onChange={(e) => setEvidenceDescription(e.target.value)}
                    placeholder="Description"
                    className={INPUT}
                  />
                </>
              )}
            </div>
          )}
        </section>

        {awaiting && canEdit && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Note to the reviewer</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={INPUT}
              placeholder="Required to return the review; optional when approving."
            />
          </div>
        )}

        {done && (
          <p className="text-sm text-slate-600">
            {review.approver_id ? `Approved by ${userName(review.approver_id) || `user #${review.approver_id}`}` : 'Completed'}
            {review.completed_at && ` on ${new Date(review.completed_at).toLocaleDateString()}`}
            {review.approval_notes && `: ${review.approval_notes}`}
          </p>
        )}

        {editable && <ReassignReviewer reviewId={review.id} reviewerId={review.reviewer_id} onDone={finish} />}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
          {editable && review.status !== 'in_review' && (
            <button
              type="button"
              onClick={() => act(() => startMutation.mutate())}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {startMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Start review
            </button>
          )}
          {editable && (
            <button
              type="button"
              onClick={() => act(() => submitMutation.mutate())}
              disabled={busy}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {submitMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit for approval
            </button>
          )}
          {awaiting && canEdit && (
            <>
              <button
                type="button"
                onClick={() => act(challenge)}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100 transition-colors disabled:opacity-50"
              >
                {challengeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Return to reviewer
              </button>
              <button
                type="button"
                onClick={() => act(() => approveMutation.mutate())}
                disabled={busy}
                className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {approveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Approve change
              </button>
            </>
          )}
        </div>
      </div>
    </RightSlidePanel>
  );
}
