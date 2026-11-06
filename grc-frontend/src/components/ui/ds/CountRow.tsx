'use client';

// CountRow: a label and the TRUE number of records behind it, as ONE target that opens them ("Overdue reviews 12"). Two looks: `row` (a line of a list:
// a dot in the tone, the label, the count at its end, a chevron when it opens something) and `chip` (a pill: the dot, the count, the label; for a wrapped
// strip of counters). A count of 0 is muted with a hollow dot, still a target (the list behind it is empty on purpose). The count is never "99+" and never
// a 0 that stands for something else: `null` is "not recorded" (a dash, said so for a screen reader), a request that failed is `error` (the label with
// "unavailable" and its own Retry), a request still running is `loading`. A change beside the count is words ("+3 this week"): the kit does not know
// whether up is bad, so it never colours it. It is a list item (`as="div"` outside a list). Reading rules: workModel.ts.
//
//   <CountRow label="Overdue reviews" count={12} tone="danger" href="/governance/documents?review=overdue" delta={3} deltaLabel="this week" />
import Link from 'next/link';
import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import { TONE, type Tone } from '@/lib/status';
import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { countText, deltaWords, isZero } from './workModel';

export interface CountRowProps {
  /** What is counted: "Overdue reviews". */
  label: string;
  /** The true total (1,247). `null`: nothing is recorded, drawn as a dash and read as "not recorded", never as 0. */
  count: number | null;
  /** The row opens the records behind the count. One target, one tab stop. */
  href?: string;
  /** Or it runs this (a button). `href` wins when both are given. With neither, the row is plain text. */
  onClick?: () => void;
  /** The change since the page's own reference point; drawn as words with a sign after the count. Not coloured: only the page knows whether up is bad. */
  delta?: number | null;
  /** What the change is measured against: "this week". */
  deltaLabel?: string;
  /** The colour of the dot ("danger" for what is wrong). A count of 0 or none has a hollow dot whatever the tone. */
  tone?: Tone;
  /** `row` (default) is a line of a list; `chip` is a pill for a wrapped strip. */
  layout?: 'row' | 'chip';
  /** The request has not answered: a skeleton, announced as loading. */
  loading?: boolean;
  /** The request failed: "<label>: unavailable", and a Retry when `onRetry` is given (the row is then not one target any more: the label and its Retry). */
  error?: { onRetry?: () => void } | null;
  /** `li` (default) or `div`. */
  as?: 'li' | 'div';
  /** Layout only (margin, width). */
  className?: string;
}

const ROW_BOX = 'flex min-h-ds-control w-full min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px] rounded-ds-control px-[8px] py-[4px] text-left text-ds-body';
const CHIP_BOX = 'inline-flex min-h-ds-control max-w-full min-w-0 items-center gap-[6px] rounded-ds-control border px-[10px] text-ds-body';
// the ring of a row is inset: a card around the list may clip an outer one
const ROW_TARGET = 'hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const CHIP_TARGET = 'hover:border-ds-border-strong hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring';

export function CountRow({ label, count, href, onClick, delta, deltaLabel, tone = 'neutral', layout = 'row', loading = false, error = null, as: Tag = 'li', className }: CountRowProps) {
  const chip = layout === 'chip';
  const wrap = clsx(chip ? 'min-w-0 max-w-full' : 'min-w-0 border-b border-ds-border last:border-b-0', className);

  if (loading) {
    return (
      <Tag data-count-row="" className={wrap}>
        <div role="status" aria-busy="true" className={clsx(chip ? CHIP_BOX : ROW_BOX, chip && 'border-ds-border')}>
          <span className="sr-only">{`Loading ${label}`}</span>
          <Skeleton className={chip ? 'h-[16px] w-[120px]' : 'h-[16px] w-[60%]'} />
        </div>
      </Tag>
    );
  }

  if (error) {
    return (
      <Tag data-count-row="" className={wrap}>
        <div className={clsx(chip ? CHIP_BOX : ROW_BOX, chip && 'border-dashed border-ds-border-strong', 'text-ds-fg-muted')}>
          <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--ds-border-control)]" />
          <span className="min-w-0 flex-1 break-words">{`${label}: unavailable`}</span>
          {error.onRetry && <Button variant="link" size="sm" onClick={error.onRetry} aria-label={`Retry: ${label}`}>Retry</Button>}
        </div>
      </Tag>
    );
  }

  const recorded = typeof count === 'number' && Number.isFinite(count);
  const quiet = !recorded || isZero(count);                                        // a recorded zero and a missing count: a hollow dot, muted words
  const text = countText(count);
  const change = deltaWords(delta, deltaLabel);
  const target = href ? 'link' : onClick ? 'button' : 'text';
  const dot = quiet
    ? <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--ds-border-control)]" />
    : <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: TONE[tone].dot }} />;
  const figure = (
    <span className={clsx('shrink-0 tabular-nums', quiet ? 'font-medium' : 'font-[600]')}>
      {text}
      {!recorded && <span className="sr-only"> not recorded</span>}
    </span>
  );
  const words = <span className="min-w-0 break-words">{label}</span>;
  const delta_ = change ? <span className="shrink-0 text-ds-label font-normal text-ds-fg-muted">{change}</span> : null;
  // a row: the label asks for 10rem and takes the rest; when the count, its change and the chevron do not fit beside it they drop to the next line (at the
  // end), instead of squeezing the label into a column of single words
  const body = chip ? (
    <>{dot}{figure}{words}{delta_}</>
  ) : (
    <>
      {dot}
      <span className="min-w-0 flex-1 basis-[10rem] break-words [overflow-wrap:anywhere]">{label}<span className="sr-only">: </span></span>
      <span className="ml-auto flex shrink-0 items-center gap-[8px]">
        {figure}{delta_}{target !== 'text' && <ChevronRight aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />}
      </span>
    </>
  );
  const shape = chip
    ? clsx(CHIP_BOX, quiet ? 'border-ds-border bg-transparent text-ds-fg-muted' : 'border-ds-border bg-ds-surface-subtle text-ds-fg', target !== 'text' && CHIP_TARGET)
    : clsx(ROW_BOX, quiet ? 'text-ds-fg-muted' : 'text-ds-fg', target !== 'text' && ROW_TARGET);

  return (
    <Tag data-count-row="" className={wrap}>
      {target === 'link' && <Link href={href as string} className={shape}>{body}</Link>}
      {target === 'button' && <button type="button" onClick={onClick} className={shape}>{body}</button>}
      {target === 'text' && <div className={shape}>{body}</div>}
    </Tag>
  );
}
