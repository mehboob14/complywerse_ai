'use client';

// "Periodic review" card for the Approvals view: when the next review is due, the cycle, the last review, recording a
// review, and the review events. Backend: governance/routers/reviews.py (GET /{id}/history = document audit rows
// 'reviewed' | 'review_skipped' | 'review_cycle_updated', newest first; POST /{id}/complete).
// The next review is a DAY stored as a DateTime (shown as written, in every time zone); when someone last reviewed and the events are moments.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, ErrorState, FormField, Select, SkeletonLines, Textarea, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { parseUtc } from '@/lib/serverTime';
import { calendarDay, day } from '../_view/docDates';

type ReviewEvent = {
  id: number; action: 'reviewed' | 'review_skipped' | 'review_cycle_updated' | string; action_details: string | null;
  field_changed: string | null; old_value: string | null; new_value: string | null;
  performed_by: number | null; performer_name: string | null; performed_at: string | null;
};

const OUTCOMES = ['No changes needed', 'Minor update needed', 'Major revision needed', 'Retire it'];

const cycle = (m?: number | null) =>
  !m ? 'Not set' : m === 12 ? 'Every year' : m % 12 === 0 ? `Every ${m / 12} years` : m === 1 ? 'Every month' : `Every ${m} months`;

const label = (e: ReviewEvent) =>
  e.action === 'review_skipped' ? 'Skipped'
    : e.action === 'review_cycle_updated' ? 'Review cycle changed'
      : (e.action_details || '').startsWith('Review cycle started') ? 'Review started' : 'Reviewed';

// the label already says what happened: drop the server's own lead-in ("Review completed.", "Review skipped." ...)
const details = (e: ReviewEvent) =>
  (e.action_details || '').replace(/^(Review (completed|cycle started|skipped)\.|Review cycle changed)\s*/i, '');

export default function ReviewHistory({ documentId, doc, canEdit }: { documentId: number; doc: any; canEdit: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState(OUTCOMES[0]);
  const [notes, setNotes] = useState('');
  const [all, setAll] = useState(false);

  // ponytail: the endpoint returns the newest 50; page with skip/limit if a document ever has more review events
  const { data: events = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['review-history', documentId],
    queryFn: async () => ((await governanceApi.getDocumentReviewHistory(documentId)).data?.items ?? []) as ReviewEvent[],
    enabled: !!documentId,
  });

  const save = useReportedMutation({
    // the helper joins notes and outcome with ". ": trim a trailing full stop so it does not double up
    mutationFn: async () =>
      (await governanceApi.completeDocumentReview(documentId, { review_notes: notes.trim().replace(/[.\s]+$/, '') || undefined, outcome })).data,
    success: (r: any) => ({ title: 'Review recorded', message: r?.next_review_date ? `Next review ${calendarDay(r.next_review_date)}` : 'Saved.' }),
    failure: 'Not recorded',
    fallback: 'Could not record the review.',
    retryable: false,                                  // a second try could record a second review
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['review-history', documentId] });
      qc.invalidateQueries({ queryKey: ['governance-document', documentId] });
      setOpen(false);
      setOutcome(OUTCOMES[0]);
      setNotes('');
    },
  });

  const next = parseUtc(doc?.next_review_date);
  const overdue = !!next && next.getTime() < Date.now();
  const shown = all ? events : events.slice(0, 5);

  return (
    <section className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-4" aria-label="Periodic review">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[#1f2933]">Periodic review</h3>
        {canEdit && <Button variant="link" size="sm" className="ml-auto" onClick={() => setOpen(true)}>Record review</Button>}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-[#586472]">Next review</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[#26323d]">
            {next ? calendarDay(doc.next_review_date) : 'Not scheduled'}
            {overdue && <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-px text-xs font-medium text-rose-800">Overdue</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[#586472]">Cycle</dt>
          <dd className="mt-0.5 text-xs font-semibold text-[#26323d]">{cycle(doc?.review_cycle_months)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#586472]">Last reviewed</dt>
          <dd className="mt-0.5 text-xs font-semibold text-[#26323d]">{doc?.last_reviewed_at ? day(doc.last_reviewed_at) : 'Never'}</dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-[#e1e6eb] pt-3">
        {isLoading ? (
          <SkeletonLines lines={3} label="Loading the review history" />
        ) : isError ? (
          <ErrorState compact title="Couldn't load the review history" message={errorMessage(error)} onRetry={() => { void refetch(); }} />
        ) : events.length === 0 ? (
          <p className="text-xs text-[#586472]">No reviews yet</p>
        ) : (
          <ol className="space-y-2">
            {shown.map((e) => (
              <li key={e.id} className="text-xs text-[#26323d]">
                <span className="font-semibold text-[#1f2933]">{label(e)}</span>
                <span className="text-[#586472]"> · {e.performer_name || 'Someone'} · {day(e.performed_at)}</span>
                {details(e) && <span className="block text-xs text-[#586472]">{details(e)}</span>}
              </li>
            ))}
          </ol>
        )}
        {events.length > 5 && (
          <Button variant="link" size="sm" className="mt-2" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? 'Show less' : `Show all ${events.length}`}
          </Button>
        )}
      </div>

      <AnimatedModal
        isOpen={open}
        onClose={() => setOpen(false)}
        size="md"
        title="Record review"
        subtitle={doc?.title}
        dirty={notes.trim() !== '' || outcome !== OUTCOMES[0]}
        className="max-sm:max-h-[100dvh] max-sm:h-[100dvh] max-sm:rounded-none"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </div>
        }
      >
        <div className="space-y-3 px-5 py-4">
          <FormField label="Outcome">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </FormField>
          <FormField label="Notes" optional>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </FormField>
        </div>
      </AnimatedModal>
    </section>
  );
}
