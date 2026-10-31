'use client';

// The Reviews list: the documents whose review is overdue, due in the next 90 days, or both, as a register (a table from 768px, cards below) with a
// search, a document-type filter, sortable columns and a pager that says how many reviews there are. The page asks the server for up to REVIEW_FETCH_LIMIT
// rows a list and searches, sorts and pages them here; when the server has more than it sent, the list says so instead of passing a page of 1,000 off as
// everything. A title opens its document. Complete Review (for the people who always had the button) asks first and says what happened (_useCompleteReview).
import { useMemo, useState } from 'react';
import { CheckCircle2, Search } from 'lucide-react';
import { EMPTY, NOT_SET, formatCount, formatDate } from '@/lib/format';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, PersonChip, Pager, RegisterTable, SegmentedControl, Select, TextInput, type RegisterColumn, type SortState } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import type { DayKey } from './calendarModel';
import { DocumentLink, DueStatus } from './_parts';
import { useOverdueReviews, useUpcomingReviews } from './_queries';
import {
  DOCUMENT_TYPES, coverage, mergeAll, pageOf, rowState, searchReviews, sortReviews, typeLabel, type ListTab, type ReviewDoc,
} from './reviewsModel';

const TAB_EMPTY: Record<ListTab, { title: string; info: string }> = {
  overdue: { title: 'Nothing is overdue', info: 'Documents whose review date has been reached appear here until their review is completed.' },
  upcoming: { title: 'Nothing is due in the next 90 days', info: 'Documents whose review date falls in the next 90 days appear here.' },
  all: { title: 'No reviews are scheduled', info: 'Documents with a review date appear here. A document gets its date from its details.' },
};
const NOUN: Record<ListTab, string> = { overdue: 'overdue reviews', upcoming: 'upcoming reviews', all: 'reviews' };

export interface ReviewListProps {
  tab: ListTab;
  onTab: (tab: ListTab) => void;
  /** the people who have always had Complete Review (governance:document_management:edit) */
  canEdit: boolean;
  today: DayKey;
  onComplete: (doc: ReviewDoc) => void;
  /** the review being completed now (its button shows it) */
  pendingId: number | null;
  /** the list is the view on screen. The list stays mounted while the calendar shows (the search, the filter, the sort and the page survive a look at the calendar),
   *  and asks the server for nothing while it is out of sight. */
  active: boolean;
}

export function ReviewList({ tab, onTab, canEdit, today, onComplete, pendingId, active }: ReviewListProps) {
  const [type, setType] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const overdue = useOverdueReviews(type, active);
  const upcoming = useUpcomingReviews(type, active);
  const q = tab === 'overdue' ? overdue : upcoming;

  const overdueRows = useMemo(() => overdue.data?.items ?? [], [overdue.data]);
  const upcomingRows = useMemo(() => upcoming.data?.items ?? [], [upcoming.data]);
  const allRows = useMemo(() => mergeAll(overdueRows, upcomingRows), [overdueRows, upcomingRows]);

  // the rows the tab holds, how many the server has, and whether the tab can be read at all
  const loading = tab === 'all' ? overdue.isPending || upcoming.isPending : q.isPending;
  const failed = tab === 'all' ? overdue.isError || upcoming.isError : q.isError;
  const failure = tab === 'all' ? (overdue.isError ? overdue.error : upcoming.error) : q.error;
  const rows = tab === 'overdue' ? overdueRows : tab === 'upcoming' ? upcomingRows.filter((d) => !d.is_overdue) : allRows;
  const serverTotal = tab === 'overdue' ? overdue.data?.total : tab === 'upcoming' ? upcoming.data?.total
    : (overdue.data && upcoming.data ? overdue.data.total + upcoming.data.total - (overdueRows.length + upcomingRows.length - allRows.length) : undefined);
  const counts: Record<ListTab, number | null> = {
    overdue: overdue.data ? overdue.data.total : null,
    upcoming: upcoming.data ? upcoming.data.total : null,
    all: overdue.data && upcoming.data ? overdue.data.total + upcoming.data.total - (overdueRows.length + upcomingRows.length - allRows.length) : null,
  };

  const noMatch = type !== '' || (query.trim() !== '' && rows.length > 0);                // a filter is what leaves nothing, not an empty list
  const shown = useMemo(() => sortReviews(searchReviews(rows, query), sort), [rows, query, sort]);
  const cover = coverage(rows.length, serverTotal);
  const visible = pageOf(shown, page, pageSize);

  const retry = () => { if (tab !== 'upcoming') void overdue.refetch(); if (tab !== 'overdue') void upcoming.refetch(); };
  const reset = () => { setQuery(''); setType(''); setPage(1); };
  const label = (name: string, n: number | null) => (n === null ? name : `${name} ${formatCount(n)}`);

  const columns: RegisterColumn<ReviewDoc>[] = [
    {
      key: 'title', header: 'Document', isRowHeader: true, sortable: true,
      cell: (d) => (
        <div className="min-w-0">
          <DocumentLink id={d.id} title={d.title} />
          <div className="mt-[2px] text-ds-label font-normal text-ds-fg-muted [overflow-wrap:anywhere]">{typeLabel(d.doc_type)}{d.document_code ? ` · ${d.document_code}` : ''}</div>
        </div>
      ),
    },
    { key: 'owner', header: 'Owner', priority: 2, sortable: true, card: 'meta', cell: (d) => <PersonChip name={d.owner_name} size={20} /> },
    { key: 'next', header: 'Next review', sortable: true, card: 'meta', cell: (d) => <span className="whitespace-nowrap">{formatDate(d.next_review_date, { calendar: true, empty: NOT_SET })}</span> },
    { key: 'status', header: 'Status', card: 'meta', cell: (d) => <DueStatus state={rowState(d)} due={d.next_review_date} today={today} /> },
    { key: 'last', header: 'Last reviewed', priority: 3, sortable: true, card: 'meta', cell: (d) => <span className="whitespace-nowrap">{formatDate(d.last_reviewed_at)}</span> },
    { key: 'cycle', header: 'Cycle', priority: 3, sortable: true, card: 'meta', cell: (d) => <span className="whitespace-nowrap">{d.review_cycle_months ? `${d.review_cycle_months} months` : EMPTY}</span> },
  ];
  if (canEdit) {
    columns.push({
      key: 'action', header: 'Action', card: 'meta',
      cell: (d) => (
        <Button size="sm" leftIcon={<CheckCircle2 aria-hidden />} loading={pendingId === d.id} onClick={() => onComplete(d)} aria-label={`Complete review: ${d.title}`}>
          Complete review
        </Button>
      ),
    });
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-col gap-[12px] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-[4px]">
          <SegmentedControl
            label="Which reviews"
            name="review-list-tab"
            value={tab}
            onChange={(next: ListTab) => { onTab(next); setPage(1); }}
            options={[{ value: 'overdue', label: label('Overdue', counts.overdue) }, { value: 'upcoming', label: label('Upcoming', counts.upcoming) }, { value: 'all', label: label('All', counts.all) }]}
          />
          <InfoTip text="Upcoming is every review due in the next 90 days. All is the overdue and the upcoming reviews together." label="About the review lists" />
        </div>
        <div className="flex flex-col gap-[8px] sm:flex-row sm:items-center">
          <TextInput
            type="search"
            aria-label="Search reviews"
            placeholder="Search title, code or owner"
            leftAdornment={<Search aria-hidden />}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            className="sm:w-[260px]"
          />
          <Select aria-label="Document type" placeholder="All types" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="sm:w-[160px]">
            {DOCUMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </div>
      </div>

      {!loading && !failed && cover.cut && (
        <p role="status" className="rounded-ds-card border border-ds-border bg-ds-warning-soft px-[12px] py-[8px] text-ds-body text-ds-warning">
          Showing the first {formatCount(cover.loaded)} of {formatCount(cover.total)} {NOUN[tab]}. Search and paging cover these; narrow the list with the document type.
        </p>
      )}

      <RegisterTable
        caption={`Document reviews: ${tab === 'all' ? 'overdue and upcoming' : tab}`}
        columns={columns}
        rows={visible}
        getRowId={(d) => d.id}
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        loading={loading}
        error={failed ? { message: errorMessage(failure, "Couldn't load the reviews."), onRetry: retry } : null}
        cardTitle={(d) => (
          <div className="min-w-0">
            <DocumentLink id={d.id} title={d.title} />
            <div className="mt-[2px] text-ds-label font-normal text-ds-fg-muted [overflow-wrap:anywhere]">{typeLabel(d.doc_type)}{d.document_code ? ` · ${d.document_code}` : ''}</div>
          </div>
        )}
        empty={noMatch
          ? <EmptyState bare kind="noMatches" title="No reviews match" onClearFilters={reset} />
          : <EmptyState bare kind="firstUse" title={TAB_EMPTY[tab].title} info={TAB_EMPTY[tab].info} />}
        footer={shown.length > 0 ? (
          <Pager page={page} pageSize={pageSize} total={shown.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun={NOUN[tab]} />
        ) : undefined}
      />
    </div>
  );
}

