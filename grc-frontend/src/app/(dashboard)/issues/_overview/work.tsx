'use client';

/**
 * "My work" on the Issue & Incident Overview, slim (Overview rule R3): the header says how many things wait for the person and how many are late ("My work · 12 · 8 overdue"), then the THREE most
 * urgent as one-line rows (the title as the link that opens the record, a due pill whose word says how late, and the one step the row can take, as a button), and "See all 12" opens the full list in a
 * side sheet (kept in the address, `?work=1`, so Back closes it). With nothing waiting it is one line, "All caught up"; a list that failed is said with Retry, never "all caught up". The rows are
 * v2Model.ts slimWork over overviewModel.ts buildWork; a step is the registers' own (useWorkSteps), so a step taken here and in the register cannot disagree.
 */
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Sheet, SkeletonRows, StatusPill, WorkRow } from '@/components/ui/ds';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { formatCount } from '@/lib/format';
import { URGENCY_LABEL, WORK_KIND, actLabel, groupWork, type WorkAct, type WorkItem } from './overviewModel';
import { WORK_ROWS, rowName, slimWork, type FeedStatus } from './v2Model';

export interface MyWorkProps {
  id?: string;
  items: WorkItem[];
  now: Date;
  /** the lists that feed it, each with its own state */
  sources: Array<{ label: string; feed: FeedStatus }>;
  run: (act: WorkAct) => void;
  busy: (key: string) => boolean;
  /** "See all": the full list in its sheet */
  onAll: () => void;
}

export function MyWork({ id = 'work', items, now, sources, run, busy, onAll }: MyWorkProps) {
  const failed = sources.filter((s) => s.feed.isError && !s.feed.hasData);
  const loading = sources.some((s) => !s.feed.hasData && s.feed.isPending);
  const { rows, head, cut } = slimWork(items, now);
  const known = !loading && failed.length === 0;
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="min-w-0 scroll-mt-[64px] rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[12px]">
      <div className="flex flex-wrap items-center gap-x-[4px] gap-y-[4px]">
        <h2 id={`${id}-h`} className="min-w-0 break-words !text-ds-section !text-ds-fg">My work</h2>
        <InfoTip label="About my work" text="What waits for you: issues assigned to you, issues waiting for a closure approval (if you can edit issues), your corrective actions and your incidents. The three most urgent are here; the button on a row takes the next step." />
        {head.count > 0 && (
          <span className="ml-[4px] text-ds-body text-ds-fg-muted">
            {formatCount(head.count)}
            {head.overdue > 0 && <> · <span className="font-[600] text-ds-danger">{`${formatCount(head.overdue)} overdue`}</span></>}
          </span>
        )}
        {cut && (
          <button type="button" onClick={onAll} aria-label={`See all ${formatCount(head.count)} items in my work`} className={clsx('ml-auto inline-flex items-center gap-[2px]', linkClasses({ tone: 'text', size: 'label' }))}>
            {`See all ${formatCount(head.count)}`}
            <ArrowRight aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />
          </button>
        )}
      </div>

      {failed.map((s) => (
        <p key={s.label} role="status" className="mt-[4px] flex flex-wrap items-center gap-x-[8px] text-ds-label text-ds-fg-muted">
          {`${s.label} could not be loaded`}
          <Button size="sm" variant="link" onClick={() => { void s.feed.refetch(); }}>Retry</Button>
        </p>
      ))}
      {loading && items.length === 0 && <div className="mt-[8px]"><SkeletonRows rows={WORK_ROWS} columns={3} label="Loading your work" /></div>}
      {known && items.length === 0 && (
        <p className="mt-[4px] flex min-h-[32px] items-center gap-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          All caught up
        </p>
      )}
      {rows.length > 0 && (
        <ul aria-label="My work" className="m-0 mt-[4px] list-none p-0">
          {rows.map(({ item, due }) => (
            <li key={item.key} className="relative flex min-h-[40px] flex-wrap items-center gap-x-[8px] gap-y-[2px] border-t border-ds-border px-[4px] py-[4px] first:border-t-0 hover:bg-ds-surface-hover has-[:focus-visible]:bg-ds-surface-hover">
              <Link href={item.href} aria-label={rowName(item.title, due)} className="min-w-0 flex-1 basis-[9rem] truncate rounded-ds-control text-ds-body font-[500] text-ds-fg after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{item.title}</Link>
              {due && <StatusPill size="sm" tone={due.tone} label={due.text} className="shrink-0" />}
              {item.act.type !== 'link' && (
                <Button size="sm" variant="primary" loading={busy(item.key)} onClick={() => run(item.act)} aria-label={`${actLabel(item.act)}: ${item.title}`} className="relative z-[1] shrink-0">{actLabel(item.act)}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The full list, in a side sheet: grouped Overdue / This week / To do, each row with its one step, twenty-five more at a time. */
export function WorkSheet({ open, onClose, items, now, run, busy }: { open: boolean; onClose: () => void; items: WorkItem[]; now: Date; run: (act: WorkAct) => void; busy: (key: string) => boolean }) {
  const [shown, setShown] = useState(25);
  const overdue = items.filter((i) => i.overdue).length;
  const groups = groupWork(items, now, shown);
  return (
    <Sheet open={open} onClose={onClose} title="My work" subtitle={`${formatCount(items.length)} ${items.length === 1 ? 'item' : 'items'}${overdue > 0 ? ` · ${formatCount(overdue)} overdue` : ''}`} width="lg">
      {groups.map((g) => (
        <section key={g.group} aria-label={URGENCY_LABEL[g.group]}>
          <h3 className="m-0 px-[8px] pb-[2px] pt-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">{URGENCY_LABEL[g.group]}</h3>
          <ul className="m-0 list-none p-0">
            {g.items.map((it) => (
              <WorkRow
                key={it.key} kind={WORK_KIND[it.kind]} title={it.title} href={it.href} context={it.context} due={it.due ?? undefined} calendar={it.calendar} overdue={it.due ? it.overdue : undefined}
                action={it.act.type === 'link' ? { label: it.act.label, href: it.act.href } : { label: actLabel(it.act), onClick: () => run(it.act), loading: busy(it.key), variant: 'primary' }}
              />
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
