'use client';

import { clsx } from 'clsx';
import { formatCount } from '@/lib/format';

/** A row that is a button: a label, a proportional bar, the count and its share. Used by Insights on the home and on an assessment. A row with nothing to open is plain text. */
export function BarRow({ label, value, total, color, onPress, hint }: { label: string; value: number; total: number; color: string; onPress?: () => void; hint?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const body = (
    <>
      <span className="w-[120px] shrink-0 truncate text-ds-body text-ds-fg-body sm:w-[160px]" title={label}>{label}</span>
      <span aria-hidden className="relative h-[8px] min-w-0 flex-1 rounded-full bg-ds-border">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${value > 0 ? Math.max(pct, 2) : 0}%`, background: color }} />
      </span>
      <span className="w-[72px] shrink-0 text-right text-ds-body tabular-nums text-ds-fg">{formatCount(value)}<span className="ml-[4px] text-ds-label text-ds-fg-muted">{pct}%</span></span>
    </>
  );
  const cls = 'flex min-h-ds-control w-full items-center gap-[12px] rounded-ds-control px-[4px] text-left';
  return onPress ? (
    <button type="button" onClick={onPress} title={hint} className={clsx(cls, 'hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring')}>{body}</button>
  ) : <div className={cls}>{body}</div>;
}
