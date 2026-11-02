'use client';

// The Documents section of Reviews: the server's counts (four tiles and the by-type strip), then the one set of reviews as a List or as a Calendar. A failed
// statistics request says so and offers Retry (the tiles used to read 0). The counts are the server's, with the windows they have always had.
import { type ReactNode } from 'react';
import { clsx } from 'clsx';
import { EMPTY, formatCount } from '@/lib/format';
import { InfoTip } from '@/components/ui/InfoTip';
import { ErrorState, Skeleton, TabPanel, Tabs } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { monthOf, sameMonth, type DayKey } from './calendarModel';
import { ReviewCalendar } from './_ReviewCalendar';
import { ReviewList } from './_ReviewList';
import { useReviewStatistics } from './_queries';
import { typeLabel, type ReviewDoc, type ReviewsLocation, type View } from './reviewsModel';

const TILE = 'flex min-w-0 flex-col gap-[4px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px]';

function Tile({ label, info, value, danger = false }: { label: string; info: string; value: ReactNode; danger?: boolean }) {
  return (
    <div className={TILE}>
      <div className="flex items-center gap-[4px] text-ds-label font-normal text-ds-fg-muted">
        <span>{label}</span>
        <InfoTip text={info} label={`About ${label}`} />
      </div>
      <div className={clsx('text-ds-title tabular-nums', danger ? 'text-ds-danger' : 'text-ds-fg')}>{value}</div>
    </div>
  );
}

export interface DocumentReviewsProps {
  loc: ReviewsLocation;
  go: (patch: Partial<ReviewsLocation>) => void;
  canEdit: boolean;
  today: DayKey;
  onComplete: (doc: ReviewDoc) => void;
  pendingId: number | null;
}

export function DocumentReviews({ loc, go, canEdit, today, onComplete, pendingId }: DocumentReviewsProps) {
  const stats = useReviewStatistics();
  const s = stats.data;
  const month = loc.month ?? monthOf(today);
  const number = (n: number | undefined) => (n === undefined ? EMPTY : formatCount(n));
  const types = s ? Object.entries(s.by_doc_type) : [];

  return (
    <div className="flex flex-col gap-[12px]">
      {stats.isError ? (
        <ErrorState compact title="Couldn't load the review counts" message={errorMessage(stats.error)} onRetry={canRetry(stats.error) ? () => { void stats.refetch(); } : undefined}
          className="rounded-ds-card border border-ds-border bg-ds-surface" />
      ) : (
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
          {stats.isPending ? (
            Array.from({ length: 4 }, (_, i) => <div key={i} className={TILE}><Skeleton className="h-[16px] w-[60%]" /><Skeleton className="h-[28px] w-[40%]" /></div>)
          ) : (
            <>
              <Tile label="Next 30 days" info="Reviews due from now to 30 days ahead." value={number(s?.due_next_30_days)} />
              <Tile label="Overdue" info="Reviews whose date has been reached." value={number(s?.overdue)} danger={(s?.overdue ?? 0) > 0} />
              <Tile label="On track" info="Reviews due in 8 to 30 days." value={number(s?.by_status?.on_track)} />
              <Tile label="Due this week" info="Reviews due before the end of this week." value={number(s?.due_this_week)} />
            </>
          )}
        </div>
      )}

      {types.length > 0 && (
        <div className="flex items-center gap-[12px] overflow-x-auto rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[8px] [scrollbar-width:thin]">
          <span className="flex shrink-0 items-center gap-[4px] whitespace-nowrap text-ds-label text-ds-fg-muted">
            By type
            <InfoTip text="Reviews that are overdue or due in the next 30 days, by document type." label="About the by-type counts" />
          </span>
          <ul role="list" className="flex items-center gap-[8px]">
            {types.map(([type, n]) => (
              <li key={type} className="flex shrink-0 items-center gap-[8px] whitespace-nowrap rounded-ds-control border border-ds-border px-[8px] py-[4px] text-ds-label font-normal text-ds-fg-body">
                <span className="font-medium text-ds-fg">{typeLabel(type)}</span>
                <span>{formatCount(n.total)}</span>
                {n.overdue > 0 && <span className="font-[600] text-ds-danger">{formatCount(n.overdue)} overdue</span>}
                {n.due_soon > 0 && <span className="text-ds-warning">{formatCount(n.due_soon)} due soon</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Tabs
        ariaLabel="Review views"
        value={loc.view}
        onChange={(view) => go({ view: view as View, day: null })}
        tabs={[{ key: 'list', label: 'List' }, { key: 'calendar', label: 'Calendar' }]}
      >
        <TabPanel tabKey="list" className="pt-[12px]">
          <ReviewList tab={loc.tab} onTab={(tab) => go({ tab })} canEdit={canEdit} today={today} onComplete={onComplete} pendingId={pendingId} active={loc.view === 'list'} />
        </TabPanel>
        <TabPanel tabKey="calendar" className="pt-[12px]">
          {loc.view === 'calendar' && (
            <ReviewCalendar
              month={month}
              today={today}
              selected={loc.day}
              onMonth={(next) => go({ month: sameMonth(next, monthOf(today)) ? null : next, day: null })}
              onSelect={(day) => go({ day })}
            />
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}
