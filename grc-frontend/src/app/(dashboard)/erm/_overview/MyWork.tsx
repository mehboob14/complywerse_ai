'use client';

/**
 * "My work" on the Risk Management Overview, slim (Overview rule R3): at most three one-line rows (the title, how late or when due, the action), "See all N" for the rest, and one line
 * when nothing waits. The work is the person's own, built from the requests the module has (risks they hold, reviews, mitigation actions, KRIs to report, incidents): there is no
 * shared inbox for it, so this card has the look of the kit's MyWorkCard over the page's own list, and "See all" opens the full list in a sheet. Each request loads, fails and has nothing
 * on its own: a failed one is said with Retry, never "all caught up" over a failure.
 */
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Lock } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Sheet, SkeletonRows, StatusPill, WorkRow } from '@/components/ui/ds';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { canRetry, statusOf } from '@/components/ui/ds/reportOutcome';
import { MY_WORK_ROWS, compactDue } from '@/components/overview/workList';
import { formatCount } from '@/lib/format';
import type { Feed } from './parts';
import { SHEET_WORK, URGENCY_LABEL, WORK_KIND, groupWork, type WorkItem } from './overviewModel';

export interface MyWorkProps {
  items: WorkItem[];
  now: Date;
  /** the requests the list is built from, each with its own state */
  sources: Array<{ label: string; feed: Feed }>;
}

const INFO = 'What waits for you: risks you hold that need scoring or treating, reviews you carry out, overdue mitigation actions you own, indicators to report and incidents assigned to you. Most urgent first.';

export function MyWorkCard({ items, now, sources }: MyWorkProps) {
  const failedAll = sources.filter((s) => s.feed.isError && s.feed.data === undefined);
  // a request the server refused is not work the person has: it is not a failure to retry, and when every one was refused that is said once
  const refused = failedAll.filter((s) => statusOf(s.feed.error) === 403);
  const failed = failedAll.filter((s) => statusOf(s.feed.error) !== 403);
  const noAccess = refused.length === sources.length;
  const loading = sources.some((s) => s.feed.isPending);
  const overdue = items.filter((i) => i.overdue).length;
  const shown = items.slice(0, MY_WORK_ROWS);
  const known = !loading && failed.length === 0 && !noAccess;
  return (
    <section id="work" aria-labelledby="work-h" className="min-w-0 scroll-mt-[64px] rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[12px]">
      <div className="flex flex-wrap items-center gap-x-[4px] gap-y-[4px]">
        <h2 id="work-h" className="min-w-0 break-words !text-ds-section !text-ds-fg">My work</h2>
        <InfoTip text={INFO} label="About my work" />
        {items.length > 0 && (
          <span className="ml-[4px] text-ds-body text-ds-fg-muted">
            {formatCount(items.length)}{overdue > 0 && <> · <span className="font-[600] text-ds-danger">{`${formatCount(overdue)} overdue`}</span></>}
          </span>
        )}
        {items.length > MY_WORK_ROWS && (
          <Link href={SHEET_WORK} aria-label={`See all ${formatCount(items.length)} items in my work`} className={`ml-auto inline-flex items-center gap-[2px] ${linkClasses({ tone: 'text', size: 'label' })}`}>
            {`See all ${formatCount(items.length)}`}<ArrowRight aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />
          </Link>
        )}
      </div>

      {loading && items.length === 0 && <div className="mt-[8px]"><SkeletonRows rows={MY_WORK_ROWS} columns={3} label="Loading your work" /></div>}

      {noAccess && (
        <p role="status" className="mt-[4px] flex min-h-[32px] items-center gap-[6px] text-ds-body text-ds-fg-muted">
          <Lock aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={1.75} />
          Your role has no risk work to show.
        </p>
      )}

      {failed.map((s) => (
        <p key={s.label} role="status" className="mt-[4px] flex flex-wrap items-center gap-x-[8px] text-ds-label text-ds-fg-muted">
          {`${s.label} could not be loaded`}
          {canRetry(s.feed.error) && <Button size="sm" variant="link" onClick={() => { void s.feed.refetch(); }}>Retry</Button>}
        </p>
      ))}

      {known && items.length === 0 && (
        <p className="mt-[4px] flex min-h-[32px] items-center gap-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          All caught up
        </p>
      )}

      {shown.length > 0 && (
        <ul aria-label="My work" className="m-0 mt-[4px] list-none p-0">
          {shown.map((it) => {
            const due = compactDue({ due: it.due, overdue: it.overdue }, now);
            return (
              <li key={it.key} className="relative flex min-h-[40px] items-center gap-[8px] border-t border-ds-border px-[4px] py-[4px] first:border-t-0 hover:bg-ds-surface-hover has-[:focus-visible]:bg-ds-surface-hover">
                <Link href={it.action.href} aria-label={`${it.action.label}: ${it.title}`} className="min-w-0 flex-1 truncate rounded-ds-control text-ds-body font-[500] text-ds-fg after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{it.title}</Link>
                {it.due !== null || it.overdue ? <StatusPill size="sm" tone={due.tone} label={due.text} className="shrink-0" /> : null}
                <span aria-hidden className="hidden shrink-0 text-ds-label font-[500] text-ds-primary-text sm:inline">{it.action.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The whole list, grouped Overdue / This week / To do, in a sheet ("See all N" opens it; its state is the address's, so Back closes it). */
export function MyWorkSheet({ open, onClose, items, now }: { open: boolean; onClose: () => void; items: WorkItem[]; now: Date }) {
  const [shown, setShown] = useState(25);
  const groups = groupWork(items, now, shown);
  const overdue = items.filter((i) => i.overdue).length;
  return (
    <Sheet open={open} onClose={onClose} title="My work" subtitle={`${formatCount(items.length)} ${items.length === 1 ? 'item' : 'items'}${overdue > 0 ? ` · ${formatCount(overdue)} overdue` : ''}`} width="lg">
      {groups.map((g) => (
        <section key={g.group} aria-label={URGENCY_LABEL[g.group]}>
          <h3 className="m-0 px-[8px] pb-[2px] pt-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">{URGENCY_LABEL[g.group]}</h3>
          <ul className="m-0 list-none p-0">
            {g.items.map((it) => (
              <WorkRow key={it.key} kind={WORK_KIND[it.kind]} title={it.title} href={it.href} context={it.context} due={it.due ?? undefined} overdue={it.due ? it.overdue : undefined} action={{ label: it.action.label, href: it.action.href }} />
            ))}
          </ul>
        </section>
      ))}
      {items.length > shown && (
        <div className="mt-[4px] flex flex-wrap items-center justify-between gap-[8px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label text-ds-fg-muted">
          <span role="status">{`Showing ${formatCount(shown)} of ${formatCount(items.length)}`}</span>
          <Button variant="link" size="sm" onClick={() => setShown((n) => n + 25)}>Show more</Button>
        </div>
      )}
    </Sheet>
  );
}
