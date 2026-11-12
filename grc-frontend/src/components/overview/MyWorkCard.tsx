'use client';

// MyWorkCard: the person's own work on an Overview, slim (Overview rule R3). Header "My work · 12 · 3 overdue" and "See all 12" at the end of it, then at most
// `limit` (default 3) ONE-LINE rows: the title (a link that opens the item at the right step, named "<action>: <title>"), a due pill whose word says "Overdue 3d" or
// "Due today" (colour backs the word up), and the action word. It is never taller than three rows: nothing in it grows with the work. It is the same list as the
// inbox, the Needs-my-action page and the top bar's badge (workList.ts narrows the shared inbox to one module's sources), in the order buildInbox gave it. Its states:
// a skeleton of three rows while the sources load, a failed source said with Retry (never "all caught up" over a failure), a source that could not be refreshed said
// in one line with Retry, and the all-clear in ONE line. It takes the props of WorkListCard (the kit's other worklist, kept for the pages that show the long list)
// so a page can swap one for the other; `filter` narrows the rows and the link to the inbox, and no control is drawn for it (a filter is not a slim card's job).
//
//   <MyWorkCard id="work" work={work} onRetry={retry} fetching={fetching} link={(href) => withFrom(href, here)} />
import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { formatCount } from '@/lib/format';
import type { SourceId } from '@/lib/inbox/buildInbox';
import { MY_WORK_ROWS, compactDue, effectiveFilter, itemsFor, lengthOf, rowLinkName, rowOf, seeAllHref, workHeader, type Work, type WorkFilter } from './workList';

export interface MyWorkCardProps {
  /** the anchor of the card (default "work") */
  id?: string;
  /** default "My work" */
  title?: string;
  /** what the list rests on, from an (i) */
  info?: string;
  work: Work;
  /** how many one-line rows before "See all" (default 3) */
  limit?: number;
  /** a source that could not be loaded asks again */
  onRetry: (source: SourceId) => void;
  /** the sources being asked right now (a Retry shows it) */
  fetching?: Partial<Record<SourceId, boolean>>;
  /** every address the card links to goes through this: the page adds the place the person came from */
  link?: (href: string) => string;
  /** narrows the rows and the "See all" address; the card draws no control for it */
  filter?: WorkFilter;
  /** accepted so a page can pass what it passed to WorkListCard; not used */
  onFilter?: (filter: WorkFilter) => void;
}

const SAME = (href: string): string => href;

export function MyWorkCard({ id = 'work', title = 'My work', info = 'What is waiting for you: reviews, approvals and acknowledgements. The same list as your inbox.', work, limit = MY_WORK_ROWS, onRetry, fetching = {}, link = SAME, filter = 'all' }: MyWorkCardProps) {
  const chosen = effectiveFilter(work, filter);
  const page = lengthOf(itemsFor(work, chosen), Math.max(1, limit));
  const head = workHeader(work);
  const failed = work.notices.filter((n) => n.state === 'unavailable');
  const seeAll = link(seeAllHref(chosen));

  return (
    <section id={id} aria-labelledby={`${id}-h`} className="min-w-0 scroll-mt-[64px] rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[12px]">
      <div className="flex flex-wrap items-center gap-x-[4px] gap-y-[4px]">
        <h2 id={`${id}-h`} className="min-w-0 break-words !text-ds-section !text-ds-fg">{title}</h2>
        {info && <InfoTip text={info} label={`About ${title.toLowerCase()}`} />}
        {head && (
          <span className="ml-[4px] text-ds-body text-ds-fg-muted">
            {head.count}
            {head.overdue && <> · <span className="font-[600] text-ds-danger">{head.overdue}</span></>}
          </span>
        )}
        {head && (
          <Link href={seeAll} aria-label={page.cut ? `See all ${formatCount(page.total)} items in my work` : 'Open my work'} className={clsx('ml-auto inline-flex items-center gap-[2px]', linkClasses({ tone: 'text', size: 'label' }))}>
            {page.cut ? `See all ${formatCount(page.total)}` : 'Open'}
            <ArrowRight aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />
          </Link>
        )}
      </div>

      {work.state === 'loading' && <div className="mt-[8px]"><SkeletonRows rows={Math.max(1, limit)} columns={3} label="Loading your work" /></div>}

      {work.state === 'unavailable' && (
        <ErrorState compact title="Couldn't load your work" message={failed[0]?.message} onRetry={() => failed.forEach((n) => onRetry(n.source))} />
      )}

      {work.state === 'empty' && (
        <p className="mt-[4px] flex min-h-[32px] items-center gap-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          All caught up
        </p>
      )}

      {work.state === 'content' && (
        <>
          {work.notices.map((n) => (
            <p key={n.source} role="status" className="mt-[4px] flex flex-wrap items-center gap-x-[8px] text-ds-label text-ds-fg-muted">
              {n.state === 'unavailable' ? `${n.label} could not be loaded` : `${n.label} could not be refreshed`}
              <Button size="sm" variant="link" loading={!!fetching[n.source]} onClick={() => onRetry(n.source)}>Retry</Button>
            </p>
          ))}
          <ul aria-label={title} className="m-0 mt-[4px] list-none p-0">
            {page.rows.map((item) => {
              const r = rowOf(item);
              const due = compactDue(r);
              return (
                <li key={r.key} className="relative flex min-h-[40px] items-center gap-[8px] border-t border-ds-border px-[4px] py-[4px] first:border-t-0 hover:bg-ds-surface-hover has-[:focus-visible]:bg-ds-surface-hover">
                  <Link href={link(r.href)} aria-label={rowLinkName(r)} className="min-w-0 flex-1 truncate rounded-ds-control text-ds-body font-[500] text-ds-fg after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.title}</Link>
                  {r.due !== null || r.overdue ? <StatusPill size="sm" tone={due.tone} label={due.text} className="shrink-0" /> : null}
                  <span aria-hidden className="hidden shrink-0 text-ds-label font-[500] text-ds-primary-text sm:inline">{r.action.label}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
