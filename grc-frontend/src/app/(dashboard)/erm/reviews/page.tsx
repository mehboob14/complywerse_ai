'use client';

// Risk Management > Risk Reviews. The review schedule as a register on the kit: the true counts (pending, in review, overdue, completed) over the COMPLETE list, a filter that works
// (the old "Overdue" filter asked the server for a status it never writes, and the list stopped at 100 reviews), a table that is cards on a phone, one action a row (Start, then Complete),
// and the two panels (Schedule, Complete) in ReviewPanels. The risks a review can be scheduled for are the complete register, not the newest 100.
// A review opened from the Overview (?review=<id>) opens its panel. Behaviour kept: pending -> in review -> completed, the evidence file, who may schedule (a right that only
// administrators hold today: recorded as a gap), the keys other pages invalidate.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, CountRow, EmptyState, PersonChip, Pager, RegisterTable, SegmentedControl, StatusPill, TextInput, useAddressState, useNotify, useReportedMutation, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { ermApi } from '@/lib/api';
import { flag, integer, oneOf, text } from '@/lib/addressState';
import { formatCount, formatDate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { statusPill } from '@/lib/status';
import { riskReviewStatus } from '@/lib/statuses/risk';
import { useRiskRows, useTenantUsers } from '../risks/_register/riskData';
import { CompletePanel, SchedulePanel, useReviewRefresh } from './_review/ReviewPanels';
import { FILTERS, FILTER_LABEL, countsOf, daysLate, isOverdue, matchesFilter, matchesSearch, sortReviews, type Review, type ReviewFilter, type Sort, type SortKey } from './_review/reviewsModel';

const SCHEMA = {
  show: oneOf(FILTERS as readonly ReviewFilter[], 'all'),
  q: text(),
  review: integer(0, { min: 1 }),
  new: flag(),
  risk: integer(0, { min: 1 }),
};
const PAGE_SIZES = [25, 50, 100] as const;

const words = (s: string | null | undefined): string => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');

export default function ReviewsPage() {
  const notify = useNotify();
  const { hasPermission } = usePermissions();
  // the key the server's catalogue never had (G-4): only administrators hold it, as before; the schedule route itself lets any signed-in person write
  const canSchedule = hasPermission('erm:risk_assessments:create');
  const [address, setAddress] = useAddressState(SCHEMA);
  const filter = address.show as ReviewFilter;
  const [sortState, setSortState] = useState<SortState>({ key: 'due', dir: 'asc' });
  const sort: Sort = { key: (sortState?.key as SortKey) || 'due', dir: sortState?.dir === 'desc' ? 'desc' : 'asc' };
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [scheduling, setScheduling] = useState(false);
  const refresh = useReviewRefresh();

  const reviewsQ = useQuery({
    queryKey: ['erm-reviews-all'],
    queryFn: async () => (await ermApi.reviews.getAll({ limit: 5000 })).data as unknown as Review[],
    retry: (f, e) => f < 3 && canRetry(e),
  });
  const risks = useRiskRows();
  const users = useTenantUsers();
  const reviews = useMemo(() => reviewsQ.data ?? [], [reviewsQ.data]);
  const now = useMemo(() => new Date(), [reviewsQ.data]);          // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => countsOf(reviews, now), [reviews, now]);
  const people = users.data ?? [];
  const reviewerOf = (id?: number | null) => people.find((u) => u.id === id)?.display_name;

  const shown = useMemo(() => sortReviews(reviews.filter((r) => matchesFilter(r, filter, now) && matchesSearch(r, address.q)), sort), [reviews, filter, address.q, sort.key, sort.dir, now]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const page = Math.min(Math.max(1, pageNo), pages);
  const rows = shown.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPageNo(1); }, [filter, address.q, sort.key, sort.dir, pageSize]);

  // the panel on a review: the address names it (?review=<id>), so a link from the Overview opens it
  const open = address.review ? reviews.find((r) => r.id === address.review) ?? null : null;
  const [completing, setCompleting] = useState<Review | null>(null);
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || reviewsQ.isPending) return;
    if (address.new) { arrived.current = true; setScheduling(true); setAddress({ new: false }); return; }
    if (address.review) {
      arrived.current = true;
      if (open) { setCompleting(open); } else { notify.warning('That review is not on the schedule any more.', { title: 'Review not found' }); }
      setAddress({ review: 0 });
    }
  }, [address.new, address.review, reviewsQ.isPending, open, notify, setAddress]);

  const start = useReportedMutation({
    mutationFn: (r: Review) => ermApi.reviews.update(r.id, { status: 'in_review' as never }),
    success: 'The review is in progress.',
    failure: "Couldn't start the review",
    toast: 'errors',
    onSuccess: (_d, r) => { refresh(); setCompleting({ ...r, status: 'in_review' }); },
  });
  const act = (r: Review) => { if (r.status === 'pending') start.mutate(r); else setCompleting(r); };

  const canAct = (r: Review) => r.status === 'pending' || r.status === 'in_review';
  const columns: RegisterColumn<Review>[] = [
    {
      key: 'risk', header: 'Risk', sortable: true, isRowHeader: true,
      cell: (r) => <Link href={`/erm/risks/${r.risk_id}`} title={r.risk_title || undefined} className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere] hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.risk_title || 'A risk that was deleted'}</Link>,
    },
    {
      key: 'status', header: 'Status', sortable: true, width: 'w-[200px]',
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-[6px]">
          <StatusPill size="sm" {...statusPill(riskReviewStatus, r.status)} />
          {isOverdue(r, now) && <StatusPill size="sm" {...statusPill(riskReviewStatus, 'overdue')} />}
        </span>
      ),
    },
    { key: 'kind', header: 'Kind', priority: 2, width: 'w-[180px]', cell: (r) => <span className="text-ds-body text-ds-fg-body">{[words(r.review_type), words(r.review_cycle)].filter(Boolean).join(' · ')}</span> },
    { key: 'reviewer', header: 'Carried out by', priority: 2, width: 'w-[180px]', cell: (r) => <PersonChip name={reviewerOf(r.reviewer_id)} /> },
    {
      key: 'due', header: 'Due', sortable: true, width: 'w-[150px]',
      cell: (r) => (
        <span className={`whitespace-nowrap text-ds-body ${isOverdue(r, now) ? 'font-[600] text-ds-danger' : 'text-ds-fg-body'}`}>
          {formatDate(r.due_date)}{daysLate(r, now) > 0 && <span className="ml-[6px] text-ds-label">{`${daysLate(r, now)} d late`}</span>}
        </span>
      ),
    },
    {
      key: 'act', header: 'Action', width: 'w-[140px]', card: 'meta',
      cell: (r) => canAct(r) ? <Button variant={r.status === 'in_review' ? 'primary' : 'secondary'} loading={start.isPending && start.variables?.id === r.id} onClick={() => act(r)}>{r.status === 'in_review' ? 'Complete' : 'Start'}</Button> : <span className="text-ds-fg-muted">—</span>,
    },
  ];

  const title = routeFor('/erm/reviews')?.label ?? 'Risk Reviews';
  const failed = reviewsQ.isError && !reviewsQ.data;
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={title}
        info="Reviews keep each risk's scores and treatment honest. Start a review, update the scores if they changed, record what you found and complete it."
        meta={reviewsQ.isPending ? undefined : `${formatCount(counts.all)} ${counts.all === 1 ? 'review' : 'reviews'}`}
        actions={canSchedule ? <Button variant="primary" leftIcon={<CalendarPlus aria-hidden />} onClick={() => setScheduling(true)}>Schedule review</Button> : undefined}
      />

      <ul aria-label="Where the reviews stand" className="m-0 flex list-none flex-wrap gap-[8px] p-0">
        {(['pending', 'overdue', 'completed'] as const).map((f) => (
          <CountRow key={f} layout="chip" label={FILTER_LABEL[f]} count={reviewsQ.isPending || failed ? null : counts[f]} loading={reviewsQ.isPending} tone={f === 'overdue' ? 'danger' : f === 'pending' ? 'pending' : 'success'} onClick={() => setAddress({ show: f })}
            error={failed ? { onRetry: () => { void reviewsQ.refetch(); } } : null} />
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-[8px]">
        <SegmentedControl<ReviewFilter> label="Show reviews" name="review-filter" options={FILTERS.map((f) => ({ value: f, label: reviewsQ.isPending || failed ? FILTER_LABEL[f] : `${FILTER_LABEL[f]} ${formatCount(counts[f])}` }))} value={filter} onChange={(v) => setAddress({ show: v })} />
        <TextInput type="search" value={address.q} onChange={(e) => setAddress({ q: e.target.value })} aria-label="Search reviews by risk" placeholder="Search by risk" autoComplete="off" className="min-w-[160px] max-w-[320px] flex-1" />
      </div>

      <RegisterTable<Review>
        caption="Risk reviews"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={sortState}
        onSortChange={setSortState}
        loading={reviewsQ.isPending}
        error={failed ? { message: errorMessage(reviewsQ.error), onRetry: canRetry(reviewsQ.error) ? () => { void reviewsQ.refetch(); } : undefined } : null}
        empty={reviews.length === 0
          ? <EmptyState kind="firstUse" bare icon={CalendarPlus} title="No reviews scheduled" description="Schedule a review to keep a risk's scores and treatment current." action={canSchedule ? <Button variant="primary" onClick={() => setScheduling(true)}>Schedule review</Button> : undefined} />
          : <EmptyState kind="noMatches" bare title="No reviews match" description="Loosen the filter or the search." onClearFilters={() => setAddress({ show: 'all', q: '' })} />}
        cardTitle={(r) => <span className="line-clamp-2 break-words font-[600] text-ds-fg">{r.risk_title || 'A risk that was deleted'}</span>}
        footer={shown.length > 0 ? <Pager page={page} pageSize={pageSize} total={shown.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={{ one: 'review', other: 'reviews' }} /> : undefined}
      />

      <SchedulePanel open={scheduling} onClose={() => setScheduling(false)} risks={risks.rows} risksFailed={risks.isError && !risks.data} people={people} initialRiskId={address.risk || undefined} />
      <CompletePanel review={completing} onClose={() => setCompleting(null)} />
    </div>
  );
}
