'use client';

// DonutChart: one whole split into parts, with the total in the middle and a list beside it that IS its text alternative: every part's name, count and share,
// each a link when it opens the records. The ring is a picture (hidden from assistive technology, no tab stop); the list is real text a keyboard walks, so no
// part is reachable only by colour or only by a mouse click. Up to six parts read at a glance: a longer list folds its tail into "Other" (foldTail in the page),
// and more than that is a table or ranked bars, not a donut. Colours: SERIES in order unless a slice carries its own (a state uses STATUS).
//
//   <DonutChart label="Issues by severity" slices={[{ key: 'high', label: 'High', value: 12, color: STATUS.bad, href: '/issues/register?severity=high' }, …]} centre={{ value: '42', caption: 'issues' }} />
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCount } from '../../../lib/format';
import { chartFocusOff } from '../../ui/ds/chartText';
import { partLinkName, positive, shares, shareText, sum, withColors, type Slice } from './chartModel';
import { SURFACE, TIP } from './palette';

export interface DonutChartProps {
  /** names the figure for a screen reader: "Issues by severity" */
  label: string;
  slices: readonly Slice[];
  /** the total, in the hole: the figure and what it counts */
  centre?: { value: string; caption: string };
  /** the ring's diameter in px (default 148) */
  size?: number;
  /** what each count is called in the tooltip and the list's header for a screen reader ("issues") */
  noun?: string;
}

export function DonutChart({ label, slices, centre, size = 148, noun = 'items' }: DonutChartProps) {
  const router = useRouter();
  const parts = withColors(positive(slices));
  const total = sum(parts.map((p) => p.value));
  const pct = shares(parts.map((p) => p.value));
  const focusOff = chartFocusOff();
  const go = (entry: unknown) => { const href = (entry as { payload?: { href?: string } } | null)?.payload?.href; if (href) router.push(href); };
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-[24px] gap-y-[12px]">
      <div aria-hidden="true" className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart {...focusOff}>
            <Pie data={parts} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="96%" paddingAngle={parts.length > 1 ? 2 : 0} stroke={SURFACE} strokeWidth={2} isAnimationActive={false} cursor="pointer" onClick={go} {...focusOff}>
              {parts.map((p) => <Cell key={p.key} fill={p.color} />)}
            </Pie>
            <Tooltip contentStyle={TIP} formatter={(v: unknown, n: unknown) => [`${typeof v === 'number' ? formatCount(v) : String(v)} ${noun}`, String(n)]} />
          </PieChart>
        </ResponsiveContainer>
        {centre && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[24px] font-[600] leading-[28px] tabular-nums text-ds-fg">{centre.value}</span>
            <span className="text-ds-label text-ds-fg-muted">{centre.caption}</span>
          </div>
        )}
      </div>
      <ul aria-label={label} className="m-0 flex min-w-[180px] flex-1 list-none flex-col p-0">
        {parts.map((p, i) => (
          <li key={p.key} className="flex min-h-[28px] items-center justify-between gap-[12px]">
            <span className="flex min-w-0 items-center gap-[8px] text-ds-body text-ds-fg-body">
              <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              {p.href ? (
                <Link href={p.href} title={p.label} aria-label={partLinkName(p.label, formatCount(p.value), noun)} className="min-w-0 truncate rounded-ds-control hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{p.label}</Link>
              ) : (
                <span className="min-w-0 truncate" title={p.label}>{p.label}</span>
              )}
            </span>
            <span className="flex shrink-0 items-baseline gap-[6px] tabular-nums">
              <span className="text-ds-body text-ds-fg">{formatCount(p.value)}</span>
              <span className="w-[36px] text-right text-ds-label text-ds-fg-muted">{total > 0 ? shareText(pct[i], p.value) : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
