'use client';

// "Periodic review" card for the Approvals view: when the next review is due, the cycle, the last review, recording a
// review, and the review events. Backend: governance/routers/reviews.py (GET /{id}/history = document audit rows
// 'reviewed' | 'review_skipped' | 'review_cycle_updated', newest first; POST /{id}/complete).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { useToast } from '@/components/ui/ToastProvider';
import { parseUtc } from '@/lib/serverTime';

type ReviewEvent = {
  id: number; action: 'reviewed' | 'review_skipped' | 'review_cycle_updated' | string; action_details: string | null;
  field_changed: string | null; old_value: string | null; new_value: string | null;
  performed_by: number | null; performer_name: string | null; performed_at: string | null;
};

const OUTCOMES = ['No changes needed', 'Minor update needed', 'Major revision needed', 'Retire it'];
const INPUT = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-sm text-[#1f2933] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';

// next_review_date is a calendar date stored as a UTC datetime: read it in UTC so midnight does not slip a day
const day = (v: string | null | undefined, utc = false) =>
  parseUtc(v)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: utc ? 'UTC' : undefined }) ?? '';

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
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState(OUTCOMES[0]);
  const [notes, setNotes] = useState('');
  const [all, setAll] = useState(false);

  // ponytail: the endpoint returns the newest 50; page with skip/limit if a document ever has more review events
  const { data: events = [], isLoading, isError } = useQuery({
    queryKey: ['review-history', documentId],
    queryFn: async () => ((await governanceApi.getDocumentReviewHistory(documentId)).data?.items ?? []) as ReviewEvent[],
    enabled: !!documentId,
  });

  const save = useMutation({
    // the helper joins notes and outcome with ". ": trim a trailing full stop so it does not double up
    mutationFn: async () =>
      (await governanceApi.completeDocumentReview(documentId, { review_notes: notes.trim().replace(/[.\s]+$/, '') || undefined, outcome })).data,
    onSuccess: (r: any) => {
      toast({ type: 'success', title: 'Review recorded', message: r?.next_review_date ? `Next review ${day(r.next_review_date, true)}` : 'Saved.' });
      qc.invalidateQueries({ queryKey: ['review-history', documentId] });
      qc.invalidateQueries({ queryKey: ['governance-document', documentId] });
      setOpen(false);
      setOutcome(OUTCOMES[0]);
      setNotes('');
    },
    onError: (e: any) => {
      const d = e?.response?.data?.detail;
      toast({ type: 'error', title: 'Not recorded', message: typeof d === 'string' && d ? d : 'Could not record the review.' });
    },
  });

  const next = parseUtc(doc?.next_review_date);
  const overdue = !!next && next.getTime() < Date.now();
  const shown = all ? events : events.slice(0, 5);

  return (
    <section className="rounded-xl border border-[#d5dbe1] bg-white p-4" aria-label="Periodic review">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[#1f2933]">Periodic review</h3>
        {canEdit && (
          <button type="button" onClick={() => setOpen(true)}
            className="ml-auto rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#26323d] hover:bg-[#f3f6f8]">
            Record a review
          </button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] text-[#586472]">Next review</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[#26323d]">
            {next ? day(doc.next_review_date, true) : 'Not scheduled'}
            {overdue && <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-px text-[11px] font-medium text-rose-800">Overdue</span>}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-[#586472]">Cycle</dt>
          <dd className="mt-0.5 text-xs font-semibold text-[#26323d]">{cycle(doc?.review_cycle_months)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-[#586472]">Last reviewed</dt>
          <dd className="mt-0.5 text-xs font-semibold text-[#26323d]">{doc?.last_reviewed_at ? day(doc.last_reviewed_at) : 'Never'}</dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-[#e6eaee] pt-3">
        {isLoading ? (
          <p className="flex items-center gap-1.5 text-xs text-[#586472]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…</p>
        ) : isError ? (
          <p className="text-xs text-rose-700">Could not load the review history.</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-[#586472]">No periodic review recorded yet.</p>
        ) : (
          <ol className="space-y-2">
            {shown.map((e) => (
              <li key={e.id} className="text-xs text-[#26323d]">
                <span className="font-semibold text-[#1f2933]">{label(e)}</span>
                <span className="text-[#586472]"> · {e.performer_name || 'Someone'} · {day(e.performed_at)}</span>
                {details(e) && <span className="block text-[11px] text-[#586472]">{details(e)}</span>}
              </li>
            ))}
          </ol>
        )}
        {events.length > 5 && (
          <button type="button" onClick={() => setAll(!all)} aria-expanded={all}
            className="mt-2 text-xs font-semibold text-[#0f766e] hover:underline">
            {all ? 'Show less' : `Show all ${events.length}`}
          </button>
        )}
      </div>

      <AnimatedModal
        isOpen={open}
        onClose={() => setOpen(false)}
        size="md"
        title="Record a review"
        subtitle={doc?.title}
        className="max-sm:max-h-[100dvh] max-sm:h-[100dvh] max-sm:rounded-none"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)}
              className="rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#26323d] hover:bg-[#f3f6f8]">
              Cancel
            </button>
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save
            </button>
          </div>
        }
      >
        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[#26323d]">Outcome</span>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={INPUT}>
              {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[#26323d]">Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional" className={`${INPUT} resize-none`} />
          </label>
        </div>
      </AnimatedModal>
    </section>
  );
}
