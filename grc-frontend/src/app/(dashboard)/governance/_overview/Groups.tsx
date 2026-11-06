'use client';

// "By framework / By department": the groups that are weakest on reviews first, from the posture aggregate (true totals over every document the person may
// read). A group's name opens the library on it; the overdue figure opens that group's overdue reviews, so a figure always opens the records it counts.
// Documents, how many reviews are on time, overdue, what needs attention and open exceptions are plain figures (the last two have no list that holds exactly
// them). Ten groups at first, "Show all N" for the rest. It reads as a table to a screen reader (ARIA table roles on a grid: a compact row on a screen, the
// two figures that matter and a line of the others on a phone). Rules and words: postureModel.ts.
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { Button, ErrorState, Skeleton, TitleLink } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import type { PostureQuery } from './postureApi';
import { Denied, FOCUS } from './parts';
import { isRefused } from './overviewModel';
import { groupNoun, groupRow, showMoreLabel, type GroupBy, type GroupRow } from './postureModel';

// the columns: name | documents | on time | overdue | needs attention | open exceptions (a phone keeps name, on time, overdue)
const GRID = 'grid items-center gap-x-[8px] px-[4px] [grid-template-columns:minmax(0,1fr)_56px_64px_64px_88px_88px] max-sm:[grid-template-columns:minmax(0,1fr)_64px_72px]';
const NUM = 'text-right text-ds-body tabular-nums text-ds-fg';
const WIDE = 'max-sm:hidden';

function Row({ g }: { g: GroupRow }) {
  return (
    <div role="row" className={`${GRID} min-h-[36px] border-t border-ds-border first:border-t-0 hover:bg-ds-surface-hover`}>
      <div role="rowheader" className="min-w-0 py-[2px]">
        <TitleLink href={g.href} title={g.name} lines={2} size="body" />
        <p className="text-ds-label text-ds-fg-muted sm:hidden">{g.line}</p>
      </div>
      <div role="cell" className={`${NUM} ${WIDE}`}>{g.documents}</div>
      <div role="cell" className={NUM}>{g.onTime}</div>
      <div role="cell" className="flex justify-end">
        {g.overdue > 0 ? (
          <Link href={g.overdueHref} aria-label={`${g.overdueText} overdue ${g.overdue === 1 ? 'review' : 'reviews'} in ${g.name}`} className={`inline-flex min-h-ds-control items-center gap-[4px] rounded-ds-control px-[4px] text-ds-body font-[600] tabular-nums text-ds-danger hover:underline ${FOCUS}`}>
            <AlertTriangle aria-hidden className="h-[14px] w-[14px]" strokeWidth={2} />
            {g.overdueText}
          </Link>
        ) : (
          <span className={`${NUM} text-ds-fg-muted`}>0</span>
        )}
      </div>
      <div role="cell" className={`${NUM} ${WIDE}`}>{g.needsAttention}</div>
      <div role="cell" className={`${NUM} ${WIDE}`}>{g.openExceptions}</div>
    </div>
  );
}

export function GroupRows({ query, by }: { query: PostureQuery; by: GroupBy }) {
  const pages = query.data?.pages ?? [];
  const rows = pages.flatMap((p) => p.rows);
  const first = pages[0];
  const noun = groupNoun(by, 2);
  if (query.isPending) {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{`Loading by ${by}`}</span>
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="mb-[8px] h-[20px] w-full" />)}
      </div>
    );
  }
  if (query.isError && !first) {
    if (isRefused(query.error)) return <Denied what={`the ${noun}`} />;
    return <ErrorState compact title={`Couldn't load by ${by}`} message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;
  }
  if (!first || rows.length === 0) {
    return <p className="text-ds-body text-ds-fg-muted">{`No ${noun} yet. Documents ${by === 'framework' ? 'mapped to a framework' : 'filed under a department'} appear here.`}</p>;
  }
  const total = first.total;
  return (
    <div>
      <div role="table" aria-label={`Review health by ${by}, weakest first`}>
        <div role="row" className={`${GRID} pb-[4px] text-ds-label text-ds-fg-muted`}>
          <div role="columnheader">{by === 'framework' ? 'Framework' : 'Department'}</div>
          <div role="columnheader" className={`text-right ${WIDE}`}>Documents</div>
          <div role="columnheader" className="text-right">On time</div>
          <div role="columnheader" className="text-right">Overdue</div>
          <div role="columnheader" className={`text-right ${WIDE}`}>Attention</div>
          <div role="columnheader" className={`text-right ${WIDE}`}>Exceptions</div>
        </div>
        {rows.map((r) => <Row key={r.id === null ? 'none' : r.id} g={groupRow(r, by)} />)}
      </div>
      <div className="mt-[4px] flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[4px] pt-[8px] text-ds-label text-ds-fg-muted">
        <span role="status">{`Showing ${formatCount(rows.length)} of ${formatCount(total)} ${groupNoun(by, total)}, weakest first`}</span>
        <span className="flex flex-wrap items-center gap-[8px]">
          {query.hasNextPage && <Button size="sm" loading={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>{showMoreLabel(rows.length, total)}</Button>}
          {by === 'department' && <TitleLink href="/governance/documents/overview" title="Open At a glance" lines={1} tone="text" size="label" />}
        </span>
      </div>
      {query.isError && (
        <ErrorState compact className="mt-[8px]" title="Couldn't load the rest" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.fetchNextPage(); } : undefined} />
      )}
    </div>
  );
}
