'use client';

/**
 * "My work" on the Third-Party Vendor Risk Overview, slim (Overview rule R3): the person's own work in this module (items of the Work queue they own, onboarding requests waiting for a
 * decision, their planned actions that are due), at most three ONE-LINE rows, the most urgent first: the title (a link named "<action>: <title>"), a due or overdue pill and the action word.
 * Header "My work · 12 · 6 overdue" and "See all 12" (the Work queue, My vendors). With nothing: one line, "All caught up". Each source loads and fails on its own: a failed one is said in
 * one line with Retry and never reads as "all caught up". It is the same look as the kit's MyWorkCard, which is built on the document inbox; this module's work is not in that inbox.
 */
import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { dueBadge } from '@/components/ui/ds/workModel';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { lateCount, type WorkItem } from './workModel';

export interface Feed { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

export interface WorkCardProps {
  id: string;
  items: WorkItem[];
  /** the sources that feed it, each with its own state */
  sources: Array<{ label: string; feed: Feed }>;
  /** how many one-line rows before "See all" (default 3) */
  limit?: number;
}

const SEE_ALL = '/vendor-risk/attention?scope=mine';

/** The pill of a row: its due day in words ("Overdue 3d", "Due today"), "Overdue" for a late queue item, nothing for one that is not late. */
function pillOf(it: WorkItem): { text: string; tone: 'danger' | 'warning' | 'neutral' } | null {
  if (it.due) {
    const b = dueBadge({ due: it.due, calendar: true, overdue: it.overdue });
    return { text: b.text.replace(/^Overdue by (\d+) days?$/, 'Overdue $1d').replace(/^Due in (\d+) days?$/, 'Due in $1d'), tone: b.tone === 'danger' ? 'danger' : b.tone === 'warning' ? 'warning' : 'neutral' };
  }
  return it.late ? { text: 'Overdue', tone: 'danger' } : null;
}

export function WorkCard({ id, items, sources, limit = 3 }: WorkCardProps) {
  const failed = sources.filter((s) => s.feed.isError);
  const loading = sources.some((s) => s.feed.isPending);
  const late = lateCount(items);
  const rows = items.slice(0, Math.max(1, limit));
  const known = !loading && failed.length === 0;
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="min-w-0 scroll-mt-[64px] rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[12px]">
      <div className="flex flex-wrap items-center gap-x-[4px] gap-y-[4px]">
        <h2 id={`${id}-h`} className="min-w-0 break-words !text-ds-section !text-ds-fg">My work</h2>
        <InfoTip text="What waits for you in this module: items of the Work queue that you own or were given, onboarding requests waiting for a decision, and your planned actions that are due. Late work first, then the oldest." label="About my work" />
        {known && items.length > 0 && (
          <span className="ml-[4px] text-ds-body text-ds-fg-muted">
            {formatCount(items.length)}
            {late > 0 && <> · <span className="font-[600] text-ds-danger">{`${formatCount(late)} overdue`}</span></>}
          </span>
        )}
        {items.length > 0 && (
          <Link href={SEE_ALL} aria-label={items.length > rows.length ? `See all ${formatCount(items.length)} items in my work` : 'Open my work'} className={clsx('ml-auto inline-flex items-center gap-[2px]', linkClasses({ tone: 'text', size: 'label' }))}>
            {items.length > rows.length ? `See all ${formatCount(items.length)}` : 'Open'}
            <ArrowRight aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />
          </Link>
        )}
      </div>

      {failed.map((s) => (
        <p key={s.label} role="status" className="mt-[4px] flex flex-wrap items-center gap-x-[8px] text-ds-label text-ds-fg-muted">
          {`${s.label} could not be loaded: ${errorMessage(s.feed.error)}`}
          {canRetry(s.feed.error) && <Button size="sm" variant="link" onClick={() => { void s.feed.refetch(); }}>Retry</Button>}
        </p>
      ))}
      {loading && items.length === 0 && <div className="mt-[8px]"><SkeletonRows rows={limit} columns={3} label="Loading your work" /></div>}
      {known && items.length === 0 && (
        <p className="mt-[4px] flex min-h-[32px] items-center gap-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          All caught up
        </p>
      )}
      {rows.length > 0 && (
        <ul aria-label="My work" className="m-0 mt-[4px] list-none p-0">
          {rows.map((it) => {
            const pill = pillOf(it);
            return (
              <li key={it.key} className="relative flex min-h-[40px] items-center gap-[8px] border-t border-ds-border px-[4px] py-[4px] first:border-t-0 hover:bg-ds-surface-hover has-[:focus-visible]:bg-ds-surface-hover">
                <Link href={it.href} title={it.title} aria-label={`${it.action.label}: ${it.title}`} className="min-w-0 flex-1 truncate rounded-ds-control text-ds-body font-[500] text-ds-fg after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{it.title}</Link>
                {pill && <StatusPill size="sm" tone={pill.tone} label={pill.text} className="shrink-0" />}
                <span aria-hidden className="hidden shrink-0 text-ds-label font-[500] text-ds-primary-text sm:inline">{it.action.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
