'use client';

// The one bar list of this page: a name that is a link (with at most one muted line under it), a bar on a 0 to 100 baseline in the colour the caller gives (a grade or a tone: always
// with its word beside it), an optional dark tick for a target on the same baseline, and a figure at the end in a column of one fixed width, so every bar of a list has the same length for
// the same value. Plain HTML, so the list is its own text alternative and every name a real link in a list; the name of each link says where it goes and what it holds (`linkName`).
// On a phone the name takes its own line and the bar the next. (Promote to the chart kit: a BarList with a line under the name, a fixed figure column and a target tick, if a second
// Overview wants it.)
import type { ReactNode } from 'react';
import Link from 'next/link';
import { INK_STRONG, TRACK } from '@/components/overview/charts/palette';

export interface NamedBar {
  key: string;
  label: string;
  /** what the link is called for a screen reader and in its tooltip: "Open Governance: 72 out of 100, good, 13 below target" (the visible name is inside it) */
  linkName?: string;
  /** one line under the name (a link to the records it counts, or plain words) */
  note?: ReactNode;
  href: string;
  /** 0 to `max` */
  value: number;
  /** the colour of the bar (palette.ts STATUS) */
  color: string;
  /** a target on the same scale (drawn as a tick), or none */
  tick?: number | null;
  /** the tooltip of the bar: "Target 85" */
  tip?: string;
  /** the end of the row: the figure, and a pill with the grade's word */
  figure: ReactNode;
}

const pct = (n: number, max: number): number => (max > 0 ? Math.max(0, Math.min(100, (n / max) * 100)) : 0);

export function NamedBars({ rows, label, max = 100, nameWidth = 200, figureWidth = 48 }: { rows: readonly NamedBar[]; label: string; max?: number; nameWidth?: number; figureWidth?: number }) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-[12px] p-0">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid items-center gap-x-[12px] gap-y-[4px] [grid-template-columns:minmax(0,1fr)_auto] min-[420px]:[grid-template-columns:var(--bar-name)_minmax(0,1fr)_var(--bar-figure)]"
          style={{ ['--bar-name' as string]: `${nameWidth}px`, ['--bar-figure' as string]: `${figureWidth}px` }}
        >
          <span className="col-start-1 row-start-1 min-w-0">
            <Link href={r.href} title={r.linkName ?? r.label} aria-label={r.linkName} className="block truncate rounded-ds-control text-ds-body text-ds-fg-body hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.label}</Link>
            {r.note && <span className="block break-words text-ds-label text-ds-fg-muted">{r.note}</span>}
          </span>
          <span aria-hidden title={r.tip} className="relative col-span-2 row-start-2 min-[420px]:col-span-1 min-[420px]:col-start-2 min-[420px]:row-start-1">
            <span className="block h-[10px] w-full overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
              <span className="block h-[10px] rounded-full" style={{ width: `${r.value > 0 ? Math.max(1, pct(r.value, max)) : 0}%`, backgroundColor: r.color }} />
            </span>
            {r.tick != null && <span className="absolute top-[-3px] block h-[16px] w-[2px] rounded-full" style={{ left: `calc(${pct(r.tick, max)}% - 1px)`, backgroundColor: INK_STRONG }} />}
          </span>
          <span className="col-start-2 row-start-1 flex items-center justify-end gap-[8px] min-[420px]:col-start-3">{r.figure}</span>
        </li>
      ))}
    </ul>
  );
}
