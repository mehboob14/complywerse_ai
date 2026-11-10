'use client';

// The strip under the head: where the work on this supplier is (who the lifecycle's next step goes to), when it is next reviewed, and who owns it. The review and the owner are on the
// first paint (the vendor and its engagements are already read); who is next is read after it, so while it loads its place is held by a line, and when the read fails the strip says
// so with a Retry instead of going quiet.
import { Button, PersonChip, Skeleton } from '@/components/ui/ds';
import { clsx } from 'clsx';
import { nextUp, nextUpText, reviewWords, type ReviewWords } from '../../../_lib/recordShellModel';
import type { Scope } from '../../../_lib/vendorRecordModel';
import type { useNextUp, VendorRecord } from './recordData';

const TONE_TEXT: Record<ReviewWords['tone'], string> = { danger: 'text-ds-danger', warning: 'text-ds-warning', neutral: 'text-ds-fg-body' };

export default function NextUpStrip({ vendor, items, next }: { vendor: VendorRecord; items: Scope[] | undefined; next: ReturnType<typeof useNextUp> }) {
  const review = reviewWords(items, vendor.next_reassessment_date);
  const step = nextUp(next.data);
  return (
    <section aria-label="Where this supplier stands" className="flex flex-wrap items-center gap-x-[24px] gap-y-[8px] rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[8px] text-ds-body text-ds-fg-body">
      <div className="min-w-0 flex-1 basis-[16rem]">
        <span className="mr-[8px] text-ds-label font-[600] uppercase tracking-[0.04em] text-ds-fg-muted">Next up</span>
        {next.isError ? (
          <span>
            Couldn’t read who is next.{' '}
            <Button size="sm" onClick={() => { void next.refetch(); }}>Retry</Button>
          </span>
        ) : next.isPending ? (
          <Skeleton className="inline-block h-[12px] w-[220px] align-middle" />
        ) : step ? (
          <span>{nextUpText(step)}</span>
        ) : (
          <span className="text-ds-fg-muted">No step is waiting</span>
        )}
      </div>
      <span className={clsx('min-w-0', TONE_TEXT[review.tone])}>{review.text}</span>
      <span className="inline-flex min-w-0 items-center gap-[8px]">
        <span className="text-ds-fg-muted">Owner</span>
        <PersonChip name={vendor.owner?.full_name} size={20} />
      </span>
    </section>
  );
}
