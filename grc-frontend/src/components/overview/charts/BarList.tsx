'use client';

// BarList: ranked horizontal bars as plain HTML: a name (a link when it opens the records), a bar on one baseline and the figure at its end. It is the answer to
// "compare the parts, rank them, read more than six of them": bars on one baseline compare more exactly than slices. Real text throughout, so it needs no
// separate text alternative, and it wraps to a phone's width (the name takes its own line under 420px). One hue (the chart's single series), or a colour per row when
// the rows are states (STATUS). The track is the full scale (`max`, default the largest row), so two lists on one card can share a scale.
//
//   <BarList label="Vendors by tier" rows={[{ key: 't1', label: 'Tier 1', value: 12, href: '/vendor-risk/vendors?tier=1' }, …]} />
import Link from 'next/link';
import { formatCount } from '../../../lib/format';
import { partLinkName } from './chartModel';
import { BRAND, TRACK } from './palette';

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** replaces the figure at the end: "78%", "12 of 40" */
  valueText?: string;
  /** a hue for this row (a state); the list's `color` otherwise */
  color?: string;
  /** a line of facts under the name: "3 overdue" */
  note?: string;
  href?: string;
}

export interface BarListProps {
  /** names the list for a screen reader */
  label: string;
  rows: readonly BarRow[];
  /** the full scale of the track (default: the largest row) */
  max?: number;
  /** one hue for every bar (default the brand teal) */
  color?: string;
  /** the width of the name column on a screen, in px (default 140) */
  nameWidth?: number;
  /** what a bar counts, for the name of its link ("issues": "Open High: 12 issues") */
  noun?: string;
}

export function BarList({ label, rows, max, color = BRAND, nameWidth = 140, noun }: BarListProps) {
  const scale = max ?? Math.max(1, ...rows.map((r) => (Number.isFinite(r.value) ? r.value : 0)));
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-[8px] p-0">
      {rows.map((r) => {
        const width = Number.isFinite(r.value) && r.value > 0 ? Math.max(2, Math.min(100, (r.value / scale) * 100)) : 0;
        const name = r.href
          ? <Link href={r.href} title={r.label} aria-label={partLinkName(r.label, r.valueText ?? formatCount(r.value), noun)} className="rounded-ds-control hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.label}</Link>
          : r.label;
        return (
          <li key={r.key} className="grid items-center gap-x-[12px] gap-y-[4px] [grid-template-columns:minmax(0,1fr)_auto] min-[420px]:[grid-template-columns:var(--bar-name)_minmax(0,1fr)_auto]" style={{ ['--bar-name' as string]: `${nameWidth}px` }}>
            <span className="col-start-1 row-start-1 min-w-0 truncate text-ds-body text-ds-fg-body" title={r.label}>{name}</span>
            <span aria-hidden className="col-span-2 row-start-2 min-[420px]:col-span-1 min-[420px]:col-start-2 min-[420px]:row-start-1">
              <span className="block h-[8px] w-full overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
                <span className="block h-[8px] rounded-full" style={{ width: `${width}%`, backgroundColor: r.color ?? color }} />
              </span>
            </span>
            <span className="col-start-2 row-start-1 min-w-[28px] text-right text-ds-body tabular-nums text-ds-fg min-[420px]:col-start-3">{r.valueText ?? formatCount(r.value)}</span>
            {r.note && <span className="col-span-full row-start-3 text-ds-label text-ds-fg-muted">{r.note}</span>}
          </li>
        );
      })}
    </ul>
  );
}
