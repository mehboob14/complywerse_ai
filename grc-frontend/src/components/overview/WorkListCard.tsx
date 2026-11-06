'use client';

// "Needs my action" on an Overview: the person's own prioritised work, ONE action per row, drawn with the kit's WorkRow from the shared inbox (the same model
// as the top bar's badge and the Needs-my-action page: workList.ts narrows it to one module's sources). A header with the true count and how many are late,
// a filter (All / Decide / Acknowledge) when both kinds are there, the first rows, and "See all N" to the Needs-my-action page when there are more. Its
// own states: a skeleton while the sources load, a failed source said with Retry (never "nothing needs you" over a failure), a source that could not be
// refreshed said with the time of the answer that is shown, and an all-clear. The card does not decide anything: the document opens at the right step.
import { CheckCircle2, RotateCw } from 'lucide-react';
import { Button, ErrorState, Notice, SectionCard, SegmentedControl, SkeletonRows, TitleLink, WorkRow } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import type { SourceId } from '@/lib/inbox/buildInbox';
import { clockOf } from '@/lib/inbox/inboxView';
import { effectiveFilter, filterOptions, itemsFor, lengthOf, rowOf, seeAllHref, type Work, type WorkFilter } from './workList';

export interface WorkListCardProps {
  /** the anchor of the card */
  id: string;
  title: string;
  info: string;
  work: Work;
  filter: WorkFilter;
  onFilter: (filter: WorkFilter) => void;
  /** how many rows before "See all" */
  limit: number;
  /** a source that could not be loaded asks again */
  onRetry: (source: SourceId) => void;
  /** the sources being asked right now (a Retry shows it) */
  fetching: Partial<Record<SourceId, boolean>>;
  /** every address the card links to goes through this: the page adds the place the person came from (the shell keeps its menu entry lit by it) */
  link: (href: string) => string;
}

function Late({ n }: { n: number }) {
  return <span className="font-[600] text-ds-danger">{`${formatCount(n)} overdue`}</span>;
}

export function WorkListCard({ id, title, info, work, filter, onFilter, limit, onRetry, fetching, link }: WorkListCardProps) {
  const options = filterOptions(work);
  const chosen = effectiveFilter(work, filter);
  const { all, overdue } = work.counts;
  const page = lengthOf(itemsFor(work, chosen), limit);
  const failed = work.notices.filter((n) => n.state === 'unavailable');

  return (
    <SectionCard
      id={id}
      title={title}
      info={info}
      meta={work.state === 'content' ? <>{`${formatCount(all)} ${all === 1 ? 'item' : 'items'}`}{overdue > 0 && <> · <Late n={overdue} /></>}</> : undefined}
      actions={options.length > 0 ? (
        <SegmentedControl label="Show" name={`${id}-filter`} options={options.map((o) => ({ value: o.value, label: `${o.label} ${formatCount(o.count)}` }))} value={chosen} onChange={onFilter} />
      ) : undefined}
    >
      {work.state === 'loading' && <SkeletonRows rows={Math.min(limit, 5)} columns={3} label="Loading what needs your action" />}

      {work.state === 'unavailable' && (
        <ErrorState compact title="Couldn't load what needs your action" message={failed[0]?.message} onRetry={() => failed.forEach((n) => onRetry(n.source))} />
      )}

      {work.state === 'empty' && (
        <p className="flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          You&apos;re all caught up. New requests, reviews and acknowledgements appear here.
        </p>
      )}

      {work.state === 'content' && (
        <>
          {work.notices.map((n) => (
            <Notice
              key={n.source}
              tone={n.state === 'unavailable' ? 'warning' : 'info'}
              title={n.state === 'unavailable' ? `${n.label} could not be loaded` : `${n.label} could not be refreshed`}
              className="mb-[8px]"
              action={<Button leftIcon={<RotateCw aria-hidden />} loading={!!fetching[n.source]} onClick={() => onRetry(n.source)}>Retry</Button>}
            >
              {n.state === 'unavailable' ? `${n.message} What it holds is not in this list.` : `Showing what it said at ${clockOf(n.at)}.`}
            </Notice>
          ))}
          <ul aria-label={title} className="m-0 list-none p-0">
            {page.rows.map((item) => {
              const r = rowOf(item);
              return (
                <li key={r.key} className="border-t border-ds-border first:border-t-0">
                  <WorkRow as="div" kind={r.kind} title={r.title} href={link(r.href)} context={r.context || undefined} requester={r.requester} due={r.due} overdue={r.overdue} action={{ label: r.action.label, href: link(r.action.href) }} />
                  {r.extraLink && <TitleLink href={link(r.extraLink.href)} title={r.extraLink.label} lines={1} tone="text" size="label" className="mb-[8px] ml-[12px]" />}
                </li>
              );
            })}
          </ul>
          <div className="mt-[4px] flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label text-ds-fg-muted">
            <span role="status">{page.cut ? `Showing ${formatCount(page.rows.length)} of ${formatCount(page.total)}` : `${formatCount(page.total)} ${page.total === 1 ? 'item' : 'items'}`}</span>
            <TitleLink href={link(seeAllHref(chosen))} title={page.cut ? `See all ${formatCount(page.total)}` : 'Open Needs my action'} lines={1} tone="text" size="label" />
          </div>
        </>
      )}
    </SectionCard>
  );
}
