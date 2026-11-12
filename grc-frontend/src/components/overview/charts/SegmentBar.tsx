'use client';

// SegmentBar: one whole as a single bar cut into its parts (the dataviz "tall segmented bar"), with a 2px gap of the surface between the parts and a legend of
// names and figures under it. For a split read at a glance and standing alone in a card (status mix, severity mix, the share of controls by state). To COMPARE parts
// or rank them use BarList; for a split over time use StackedBars. The bar is a picture; the legend is the text (name, count, share) and links when a part opens
// the records, and a click on a part of the bar itself opens it too (the legend is the keyboard's way to the same links: the bar is a picture). Parts with
// nothing in them are left out of the bar and kept in the legend (a state that has none is still a fact).
//
//   <SegmentBar label="Controls by state" parts={[{ key: 'ok', label: 'Passing', value: 90, color: STATUS.good }, { key: 'bad', label: 'Failing', value: 6, color: STATUS.bad }]} height={16} />
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { formatCount } from '../../../lib/format';
import { partLinkName, shares, shareText, sum, withColors, type Slice } from './chartModel';
import { SURFACE, TRACK } from './palette';

export interface SegmentBarProps {
  label: string;
  parts: readonly Slice[];
  /** the bar's height in px (default 16; 8 is a thin bar for a table cell: pass legend={false}) */
  height?: number;
  /** the legend under the bar (default true) */
  legend?: boolean;
  /** what a part counts: "controls" */
  noun?: string;
}

export function SegmentBar({ label, parts, height = 16, legend = true, noun }: SegmentBarProps) {
  const router = useRouter();
  const coloured = withColors(parts);
  const total = sum(coloured.map((p) => p.value));
  const pct = shares(coloured.map((p) => p.value));
  const text = coloured.map((p) => `${p.label} ${formatCount(p.value)}`).join(', ');
  return (
    <div>
      <div role="img" aria-label={`${label}: ${text}`} className="flex w-full overflow-hidden rounded-full" style={{ height, backgroundColor: total > 0 ? SURFACE : TRACK, gap: 2 }}>
        {coloured.filter((p) => p.value > 0).map((p) => (
          <span key={p.key} title={`${p.label}: ${formatCount(p.value)}`} onClick={p.href ? () => router.push(p.href as string) : undefined} className={clsx('block h-full min-w-[4px]', p.href && 'cursor-pointer hover:opacity-80')} style={{ flexGrow: p.value, flexBasis: 0, backgroundColor: p.color }} />
        ))}
      </div>
      {legend && (
        <ul aria-label={`${label}, by part`} className="m-0 mt-[8px] flex list-none flex-wrap gap-x-[16px] gap-y-[4px] p-0">
          {coloured.map((p, i) => (
            <li key={p.key} className="flex items-center gap-[6px] text-ds-label text-ds-fg-muted">
              <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              {p.href ? <Link href={p.href} aria-label={partLinkName(p.label, formatCount(p.value), noun)} className="rounded-ds-control text-ds-fg-body hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{p.label}</Link> : <span className="text-ds-fg-body">{p.label}</span>}
              <span className="tabular-nums text-ds-fg">{formatCount(p.value)}{noun ? ` ${noun}` : ''}</span>
              {total > 0 && <span className="tabular-nums">{shareText(pct[i], p.value)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
