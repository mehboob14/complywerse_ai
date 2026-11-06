'use client';

// One section of Needs my action: a heading that is the button that opens and closes it (with the TRUE count and, for the decisions, how many are overdue), the notices of the sources that feed
// it (could not be loaded + Retry; could not be refreshed), a skeleton while one of them loads, its rows 50 at a time ("Showing 50 of 150", "Show 50 more"), and what it says when it is empty.
// Page-local until the kit's Disclosure lands.
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, RotateCw } from 'lucide-react';
import { Button, Notice, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import type { Inbox, InboxItem } from '@/lib/inbox/buildInbox';
import { clockOf, pageOf, sectionStatus, sentCutLine, type SectionSpec } from '@/lib/inbox/inboxView';
import { InboxRow } from './_InboxRow';

export interface SectionProps {
  spec: SectionSpec;
  inbox: Inbox;
  open: boolean;
  onToggle: () => void;
  /** how many rows are shown (a multiple of the page size) */
  shown: number;
  onMore: () => void;
  now: Date;
  onOpenItem: (item: InboxItem) => void;
  onRetry: (source: InboxItem['source']) => void;
  /** the sources being asked right now (a Retry shows it) */
  fetching: Partial<Record<InboxItem['source'], boolean>>;
}

export function InboxSection({ spec, inbox, open, onToggle, shown, onMore, now, onOpenItem, onRetry, fetching }: SectionProps) {
  const items = inbox.bySection[spec.section];
  const status = sectionStatus(inbox, spec.section);
  const decisions = spec.key === 'decide';
  // the true number: the decisions are the ones addressed to the person (the badge's number); acknowledgements are all of them; the sent requests are as many as the server counts (it lists the 200 most urgent)
  const count = decisions ? inbox.counts.decision : spec.key === 'sent' ? inbox.counts.sentTotal : items.length;
  const cut = spec.key === 'sent' ? sentCutLine(inbox.counts) : '';
  const overdue = decisions ? inbox.counts.overdue : spec.key === 'ack' ? inbox.counts.ackOverdue : 0;
  const page = pageOf(items, shown);
  const firstOther = decisions ? page.rows.findIndex((i) => !i.counted) : -1;
  const headingId = `inbox-heading-${spec.key}`;
  const regionId = `inbox-region-${spec.key}`;

  return (
    <section id={`inbox-section-${spec.key}`} aria-labelledby={headingId} className="scroll-mt-[16px] rounded-ds-card border border-ds-border bg-ds-surface">
      <h2 className="!text-ds-section !text-ds-fg">
        <button
          id={headingId}
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={onToggle}
          className="flex min-h-ds-control w-full items-center gap-[8px] rounded-ds-card px-[12px] py-[10px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
        >
          {open ? <ChevronDown aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} /> : <ChevronRight aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />}
          <span className="min-w-0 text-ds-section text-ds-fg">{spec.title}</span>
          <span className="text-ds-body font-normal text-ds-fg-muted">{status.loading && count === 0 ? '…' : formatCount(count)}</span>
          {overdue > 0 && <StatusPill size="sm" tone="danger" label={`${formatCount(overdue)} overdue`} />}
        </button>
      </h2>

      {open && (
        <div id={regionId} className="border-t border-ds-border">
          {status.notices.map((n) => (
            <div key={n.source} className="p-[12px]">
              {n.state === 'unavailable' ? (
                <Notice tone="warning" title={`${n.label} could not be loaded`} action={<Button leftIcon={<RotateCw aria-hidden />} loading={!!fetching[n.source]} onClick={() => onRetry(n.source)}>Retry</Button>}>
                  {n.message} What it holds is not in these numbers.
                </Notice>
              ) : (
                <Notice tone="info" title={`${n.label} could not be refreshed`} action={<Button leftIcon={<RotateCw aria-hidden />} loading={!!fetching[n.source]} onClick={() => onRetry(n.source)}>Retry</Button>}>
                  Showing what it said at {clockOf(n.at)}.
                </Notice>
              )}
            </div>
          ))}
          {status.loading && items.length === 0 && <div className="p-[12px]"><SkeletonRows rows={3} columns={3} label={spec.loading} /></div>}
          {items.length === 0 && !status.loading && status.notices.length === 0 && <p className="px-[12px] py-[16px] text-ds-body text-ds-fg-muted">{spec.empty}</p>}
          {items.length > 0 && (
            <ul className="m-0 list-none p-0" aria-label={spec.title}>
              {page.rows.map((item, i) => (
                <FragmentRow key={item.key} divider={i === firstOther && i >= 0 ? `You can also decide · ${formatCount(inbox.counts.canDecide)}` : null}>
                  <InboxRow item={item} now={now} onOpen={onOpenItem} />
                </FragmentRow>
              ))}
            </ul>
          )}
          {page.more && (
            <div className={clsx('flex flex-wrap items-center justify-between gap-[8px] border-t border-ds-border px-[12px] py-[8px]')}>
              <span role="status" className="text-ds-label text-ds-fg-muted">{page.summary}</span>
              <Button onClick={onMore}>{page.more}</Button>
            </div>
          )}
          {cut && <p className="border-t border-ds-border px-[12px] py-[8px] text-ds-label text-ds-fg-muted">{cut}</p>}
        </div>
      )}
    </section>
  );
}

/** A row, preceded by a small heading when it starts a group ("You can also decide"). */
function FragmentRow({ divider, children }: { divider: string | null; children: React.ReactNode }) {
  return (
    <>
      {divider && <li role="presentation" className="border-t border-ds-border bg-ds-surface-subtle px-[12px] py-[6px] text-ds-label font-[600] text-ds-fg-muted">{divider}</li>}
      {children}
    </>
  );
}
