'use client';

// A breakdown card's rows: a label, its true count and a bar (its share of the whole). A row with an address is ONE link to All tasks showing exactly the tasks it counts (one tab stop, a 32px
// target, 44px on a phone); a row with none (no filter of the register says it, or the word cannot travel in an address) is plain text. A long list shows its first rows and a button for the rest.
import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Button, ProgressBar, type ProgressTone } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';

export interface DrillRow {
  key: string;
  label: string;
  count: number;
  /** 0-100: the width of the bar */
  percent: number;
  /** where the row opens; null: it is not a link */
  href: string | null;
  tone?: ProgressTone;
  /** what is written at the end of the row instead of the count ("14 of 54 (26%)") */
  detail?: string;
  /** what the bar says to a screen reader beside the label ("14 of 54") */
  valueText?: string;
}

// the ring is inset: a card that clips would cut an outer one
const LINE = 'flex min-h-ds-control items-center justify-between gap-[8px] rounded-ds-control px-[8px]';
const TARGET = 'hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

export function DrillBars({ rows, noun, empty, limit }: {
  rows: readonly DrillRow[];
  /** what a row counts, for a screen reader: "tasks" */
  noun: string;
  /** said when there is nothing to list */
  empty: string;
  /** show this many rows and a "Show all" button for the rest */
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return <p className="py-[8px] text-center text-ds-body text-ds-fg-muted">{empty}</p>;
  const shown = limit && !all ? rows.slice(0, limit) : rows;
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
        {shown.map((r) => {
          const words = r.detail ?? formatCount(r.count);
          const line = (
            <>
              <span className="min-w-0 text-ds-body text-ds-fg [overflow-wrap:anywhere]">{r.label}</span>
              <span className="flex shrink-0 items-center gap-[4px] tabular-nums text-ds-body text-ds-fg-muted">{words}{r.href && <ChevronRight aria-hidden className="h-[16px] w-[16px]" />}</span>
            </>
          );
          return (
            <li key={r.key}>
              {r.href
                ? <Link href={r.href} aria-label={`${r.label}: ${words} ${noun}. Open them in All tasks`} className={`${LINE} ${TARGET}`}>{line}</Link>
                : <div className={LINE}>{line}</div>}
              <div className="px-[8px] pb-[4px]">
                <ProgressBar value={r.percent} label={`${r.label}: ${noun}`} valueText={r.valueText ?? `${formatCount(r.count)}`} showValue={false} tone={r.tone} />
              </div>
            </li>
          );
        })}
      </ul>
      {limit && rows.length > limit && (
        <div className="mt-[8px]"><Button aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${formatCount(rows.length)}`}</Button></div>
      )}
    </>
  );
}
